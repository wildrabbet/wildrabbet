-- Rabbit Kit Online — Supabase schema (MVP)
-- Run in the Supabase SQL editor after creating a project.
-- Auth model: username + secret key (hashed). No email OAuth.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  display_name text,
  bio text default '',
  avatar_url text,
  secret_key_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint username_slug check (username ~ '^[a-z0-9_]{3,24}$')
);

create index if not exists profiles_username_idx on public.profiles (username);

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '90 days')
);

create index if not exists sessions_profile_idx on public.sessions (profile_id);

create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  a uuid not null references public.profiles(id) on delete cascade,
  b uuid not null references public.profiles(id) on delete cascade,
  status text not null check (status in ('pending', 'accepted')),
  requested_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (a, b),
  constraint friendship_ordered check (a < b),
  constraint friendship_not_self check (a <> b)
);

create index if not exists friendships_a_idx on public.friendships (a);
create index if not exists friendships_b_idx on public.friendships (b);

-- Public read of profiles (no secret_key_hash)
create or replace view public.public_profiles as
select id, username, display_name, bio, avatar_url, created_at
from public.profiles;

alter table public.profiles enable row level security;
alter table public.sessions enable row level security;
alter table public.friendships enable row level security;

-- With RLS on and no write policies, inserts/updates/deletes are denied by default.
-- Public profile reads are allowed; mutations go through Edge Functions (service role).

create policy "public read profiles"
  on public.profiles for select
  to anon, authenticated
  using (true);

create policy "public read friendships"
  on public.friendships for select
  to anon, authenticated
  using (true);

-- Storage bucket for avatars (create in dashboard if needed):
-- name: avatars, public: true
-- path: {username}/avatar.{ext}

-- Edge Functions to add next:
--   register({ username, secret_key, display_name? })
--   login({ username, secret_key }) -> session token
--   update_profile({ token, bio?, display_name?, avatar? })
--   friend_request({ token, username })
--   friend_accept({ token, friendship_id })
--   friends_list({ token })
