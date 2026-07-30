# Rabbit's Realm — The Full Plan

**A game you play. An engine you keep. Everything you make in it is yours.**

Rabbit's Realm is not a game with an editor bolted on, and it is not an engine
with a demo level. It is a single thing: a fully-fleshed-out game whose act of
playing *is* the act of creating. You wander the Realm, you build inside it,
and at any moment you can carve out what you built, export it as a `.rabbet`
file, turn that into a standalone game — web build or EXE — and sell it on
Steam. No royalties. No license fees. No asterisks except the ones spelled out
in this document.

---

## 1. Vision

### The two analogies, decoded

**"Do to the EXE what Steam did to game launchers."**
Steam didn't kill the game — it replaced the dead ritual around the game
(discs, installers, patches from websites) with a living platform. The EXE is
today's dead ritual: a frozen, opaque, final artifact. A compiled EXE knows
nothing about where it came from and can never become anything else.

**"The EXE should be to today's EXE what modern AI is to Cookie Clicker's NPCs."**
Cookie Clicker's grannies aren't AI — they're PNGs. A static image wearing the
costume of intelligence. Today's EXE is the same thing: a static blob wearing
the costume of a game. The gap between a PNG-granny and a modern language model
is the gap we want between a compiled binary and a **Realm export**.

So the deliverable of Rabbit's Realm is the **Living Export**:

- Every exported game **carries the full engine inside it**. Not a stripped
  runtime — the whole thing, editor included (creator's choice to lock it).
- Every exported game **remains a `.rabbet` at heart**. The EXE is a shell;
  the game inside can be re-opened, remixed, modded, and re-exported by anyone
  the creator permits.
- Every exported game can **stay alive**: opt-in update channels (the same
  `update.json` mechanism Rabbit Kit already ships with), mod folders, and
  local hosting — no central server required, ever.

A traditional EXE is a photograph of a game. A Realm export is the game.

### The three promises

1. **Free forever.** No product we release will ever cost money. The only
   exception: games that structurally require a paid third-party API key
   (e.g. AI-driven games), where the player brings their own key (BYOK). We
   never take a cut, we never resell access, we never paywall.
2. **Yours forever.** Everything you make inside the Realm — worlds, games,
   scripts, and any first-party assets you use — is yours to sell
   commercially with zero royalties.
3. **Open forever.** The engine, the runtime, the export tooling, and the
   hosting stack are open source. If rabbet.lol vanished tomorrow, everything
   still works from a local folder.

---

## 2. What already exists (the foundation)

This plan does not start from zero. The repo already contains:

| Asset | What it is | Role in the Realm |
|---|---|---|
| **rabbet.lol** (this repo, GitHub Pages) | The hub site with games, gallery, library | Becomes the Realm's front door and the hosted mod hub |
| **Rabbit Kit** (`/rabbit-kit`) | A Windows desktop app with an installer, versioned `update.json` + SHA-256, and a Supabase schema | Becomes the **desktop shell**: the EXE wrapper, the updater, and the local runtime for exports |
| **Six shipped games** (`/games`) | Self-contained HTML/JS games (SoGoDing, Heroine, Mosaic, Datura Protocol, mc, true) | Seed content: the first "made in the Realm" ports, proof the pipeline works, and free starter templates |
| **Supabase schema** (`rabbit-kit/supabase-schema.sql`) | Existing backend schema | Grows into the optional community backend (accounts, mod listings) — optional because everything must work offline |

The stack is therefore decided by reality, not preference: **the Realm is
web-native** (TypeScript, HTML5 canvas/WebGL/WebGPU), wrapped in a desktop
shell for EXE export. This is also the only stack where "export to literally
anything" is honest — a web-native game exports to web, EXE, and anything
that can run a browser engine.

---

## 3. The player journey (the whole product in five steps)

1. **Play.** You launch Rabbit's Realm (browser or Rabbit Kit). It is a real
   game: a hub world, characters, progression, secrets. First-time players
   should not realize they're holding an engine.
2. **Build.** Creation tools are diegetic — in-world objects and abilities,
   not menus. You claim a plot ("a Warren"), place things, script behaviors,
   terraform. The build mode *is* gameplay, G-mod style.
3. **Deepen.** When in-world tools hit their ceiling, you open the Burrow —
   the full editor underneath (scene tree, script editor, asset manager).
   Same world, professional tools. The transition is one keypress, not a
   separate application.
4. **Export.** You select your Warren (or a whole standalone project) and
   export a `.rabbet` file — one portable file containing the entire game.
5. **Ship.** From a `.rabbet`, the exporter produces: a static web build you
   can host anywhere (including locally), a Windows EXE (Rabbit Kit shell),
   and later Linux/macOS builds. Upload the EXE to Steam, sell it, keep 100%
   of what Steam doesn't take. We are not in that transaction.

---

## 4. Architecture

### 4.1 Layer map

```
┌─────────────────────────────────────────────────────┐
│  Rabbit's Realm (the game)                          │
│  hub world · quests · diegetic build tools          │
├─────────────────────────────────────────────────────┤
│  The Burrow (the editor)                            │
│  scene tree · script editor · asset manager · play  │
├─────────────────────────────────────────────────────┤
│  Realm Core (the engine)  — open source             │
│  ECS · 2D/3D renderer · physics · audio · input     │
│  scripting VM · save system · .rabbet loader        │
├──────────────────────────┬──────────────────────────┤
│  Web runtime             │  Rabbit Kit shell        │
│  (any browser, any host) │  (EXE, updater, mods dir)│
└──────────────────────────┴──────────────────────────┘
```

Everything above the bottom row is one codebase. The bottom row is two thin
targets for the same build.

### 4.2 Realm Core (the engine)

- **Language:** TypeScript. Runs in every browser and in the desktop shell.
- **World model:** Entity–Component–System. Every object in the Realm — a
  tree, an NPC, a whole minigame — is entities + components, serializable to
  JSON. This is what makes "the game is the editor" possible: the running
  game and the edited scene are the same data.
- **Rendering:** one renderer, two profiles.
  - **2D profile:** sprite/tilemap pipeline (canvas2D/WebGL) — covers games
    like Mosaic and mc today.
  - **3D profile:** WebGL2 now, WebGPU when it's boring. Start with
    Three.js as the rendering backend (mature, permissively licensed) rather
    than writing a renderer from scratch; the ECS wraps it so it can be
    swapped later without breaking `.rabbet` files.
- **Physics:** 2D — a lightweight AABB/arcade layer built in; 3D — Rapier
  (Rust→WASM, permissive license) as an optional module.
- **Scripting:** two tiers, both saved into the `.rabbet`:
  1. **Signals** — visual, node-based event scripting (when X → do Y) for
     in-world building. This is the tier most players will live in.
  2. **Scripts** — sandboxed JavaScript/TypeScript with the full engine API,
     edited in the Burrow. Sandboxing (no raw DOM/network by default,
     capability-based permissions) is what makes community mods safe to run.
- **Audio:** WebAudio; positional audio in the 3D profile.
- **Saves:** every save is itself a `.rabbet` delta — playing and editing use
  the same persistence path. This single decision keeps game and engine from
  ever diverging.

### 4.3 The Burrow (the editor)

- Lives inside the game binary; toggled per-world by the world's owner.
- Scene tree, inspector, asset browser, Signals graph editor, code editor
  (Monaco), play-in-place with hot state.
- **Everything the Burrow can do must be scriptable** — the editor calls the
  same public engine API mods use. This is the G-mod lesson: the community
  will build better tools than we will, if the tools can build tools.

### 4.4 Rabbit Kit (the desktop shell)

Rabbit Kit graduates from "installer for the hub" to **the universal shell**:

- Wraps the web runtime in a native window (current approach continues;
  evaluate Tauri for a smaller footprint than a bundled browser).
- Provides what browsers can't: real filesystem access for projects and mods,
  a `mods/` drop-in folder per game, deep links (`rabbet://`), and the
  auto-updater already proven by `update.json` + SHA-256.
- **Is the EXE exporter's output.** Exporting to EXE = Rabbit Kit shell +
  embedded `.rabbet` + creator branding/config, packed into one installer or
  portable EXE. The creator's game gets its own icon, name, and (optional)
  its own update channel — a creator can point `update.json` at their own
  static host and ship patches to their players with zero infrastructure
  beyond a folder of files.

---

## 5. The `.rabbet` format

One file. The whole game. Openable forever.

- **Container:** a ZIP with a fixed layout (like `.docx` and `.love` — boring
  on purpose; any unzip tool can open it, no special software needed to
  inspect what's inside).

```
mygame.rabbet
├── manifest.json      # format version, engine version range, game id,
│                      # title, author, entry scene, permissions requested
├── licenses.json      # per-asset provenance & license (see §7)
├── world/             # scenes as JSON (ECS entity/component dumps)
├── scripts/           # Signals graphs (JSON) + JS/TS sources
├── assets/            # glTF/GLB, PNG/WebP, OGG/MP3, fonts
├── mods/              # optional bundled mods (each is itself a .rabbet)
└── lock.json          # optional: creator's export locks (editor off,
                       # remix policy, update channel URL)
```

- **Versioned and migratable:** `manifest.json` declares the format version;
  the engine ships migrators so a 2026 `.rabbet` opens in the 2036 engine.
  Format spec lives in this repo as an open document from day one.
- **Composable:** a `.rabbet` can depend on or embed other `.rabbet`s. A mod
  is a `.rabbet`. A save is a `.rabbet` delta. An asset pack is a `.rabbet`.
  One format for everything is what makes the ecosystem simple.
- **Remix policy is the creator's, machine-readable:** `lock.json` records
  whether the exported game is open-remix (anyone can re-open it in the
  Realm), attribution-remix, or sealed. The engine honors it; the license
  travels with the file.

---

## 6. Export pipeline

From any `.rabbet`, the exporter (in the Burrow and as a CLI) produces:

1. **Web build** — a static folder: `index.html` + engine + the `.rabbet`.
   Host on GitHub Pages, itch.io, a USB stick, or `localhost`. This is the
   local-hosting guarantee: `python -m http.server` is a valid game server.
2. **Single-file HTML** — everything inlined into one `.html` (the SoGoDing
   pattern this repo already uses). The most portable game format on Earth.
3. **Windows EXE** — Rabbit Kit shell + embedded game (see §4.4), as a
   portable EXE and/or installer. **Steam-ready**: an exported EXE plus the
   creator's Steam depot config is a shippable Steam build; a Steamworks
   integration module (achievements, cloud saves via the shell) follows later.
4. **Linux / macOS** — same shell, other targets (Tauri makes this nearly
   free). Phase-gated, not day-one.

Export always runs a **rights check** against `licenses.json` (§7): assets
marked personal-use-only are flagged and must be removed or replaced before a
commercial export proceeds. This is how "sell it on Steam" stays a safe
promise rather than a lawsuit generator.

---

## 7. Licensing & rights (the load-bearing wall)

This is the part that makes the whole promise real, so it gets precision:

- **Engine, editor, shell, exporter: MIT License.**
  Not GPL/AGPL — copyleft on the engine would infect exported games and
  poison the "sell it with no strings" promise. MIT means anyone can ship,
  sell, fork, or embed, forever. (Apache-2.0 is the fallback if we ever want
  explicit patent protection; MIT is simpler and fits the spirit.)
- **First-party assets (everything we make): CC0.**
  Not CC-BY — attribution requirements are a tax on creators we said we
  wouldn't tax. CC0 = public domain dedication = zero obligations.
- **Third-party engine dependencies:** permissive-only allowlist (MIT, BSD,
  Apache-2.0, zlib). No GPL/LGPL in the runtime or export path, ever. A
  `THIRD_PARTY_LICENSES` file ships in every export automatically.
- **Community uploads (the mod hub):** every upload requires the uploader to
  (a) affirm they hold the rights, and (b) tag a license from a fixed menu:
  CC0 / CC-BY / personal-use-only. `licenses.json` records this per asset,
  travels inside every `.rabbet`, and the exporter enforces it (§6).
  A straightforward DMCA takedown process covers the inevitable bad uploads.
- **Creator games:** 100% owned by the creator. We claim no rights over
  anything made in the Realm — no "we get a license to your content" clause.
  The hub's hosting terms grant us only the minimum needed to display what
  they choose to publish there.
- **BYOK exception, formalized:** games requiring paid third-party APIs ship
  free with a key-entry flow; keys stay on the player's machine (shell
  keychain or localStorage), never touch our servers, and the game must
  degrade gracefully (or clearly gate) without one.

---

## 8. The Warren Exchange (community & mods)

The G-mod-style layer, named for where rabbits actually live together:

- **What's shared:** worlds, games, mods, asset packs, Signals libraries,
  templates — all as `.rabbet` files. One format, one hub.
- **How it's hosted:** listings and metadata in Supabase (extending the
  existing schema); files on cheap static storage. But the hub is a
  convenience, not a dependency — the engine can install a mod from any URL
  or local file, and a "warren index" is just a JSON file, so anyone can run
  a community index on a GitHub Pages repo. Decentralized like RSS, not
  centralized like an app store.
- **Safety:** mods run in the script sandbox with a capability manifest
  ("this mod wants: network access to api.example.com, filesystem: none") the
  player approves on install — visible permissions, like a phone app, not a
  raw code drop like classic mod folders.
- **In-Realm presence:** the Exchange is browsable from inside the game
  (a literal marketplace district in the hub world) as well as on rabbet.lol.

---

## 9. Multiplayer & the shared Realm (later, but designed-for now)

Full MMO-style shared building is a money pit; we're broke; so:

- **Phase-gated:** single-player Realm first. But the ECS is authored with
  deterministic simulation and entity ownership from day one, so networking
  is an addition, not a rewrite.
- **First multiplayer step:** peer-hosted visiting — a player hosts their
  Warren from their own machine (Rabbit Kit shell opens the socket; WebRTC
  with a tiny free-tier signaling relay), friends join via `rabbet://` link.
  Local-first, zero server cost, on-brand.
- **Never:** centralized always-on world servers we pay for.

---

## 10. Roadmap

Phases are gates, not dates — each one ships something usable and true to
the promises on its own. Rough order of magnitude for a solo/small effort is
noted honestly.

**Phase 0 — Foundation (weeks)**
- This plan merged; `.rabbet` format spec v0 drafted as an open doc.
- Repo restructure: `realm/` engine workspace (TypeScript, Vite, tests)
  alongside the existing site. LICENSE (MIT) + asset licensing (CC0) declared.
- Realm Core skeleton: ECS, game loop, 2D renderer, input, JSON scene
  load/save — proven by porting **one** existing game (Mosaic is the best
  candidate: small, self-contained, already has separated app.js) to run as
  data inside the engine.

**Phase 1 — The engine is real (months)**
- `.rabbet` v1: container, manifest, loader, saves-as-deltas.
- Signals (visual scripting) v1 + sandboxed JS scripting v1.
- Burrow v1: scene tree, inspector, asset browser, play-in-place.
- Web export + single-file HTML export.
- **Milestone:** a stranger downloads nothing, opens rabbet.lol, builds a
  tiny game in the browser, exports a `.rabbet`, reopens it. The loop exists.

**Phase 2 — The Living EXE (months)**
- Rabbit Kit shell generalized: any `.rabbet` → branded portable EXE with
  own icon/name/update channel; rights check wired into every export.
- Creator-owned update channels (their own `update.json`, our proven format).
- **Milestone:** one of our own games, exported through the pipeline, is
  live as a free title on a store page (itch.io first, Steam when the $100
  fee is affordable). We eat our own dog food before promising it feeds
  anyone else.

**Phase 3 — The game (months, overlapping 2)**
- The actual Rabbit's Realm hub world: art direction, a Warren to claim,
  diegetic build tools, progression that teaches the engine as gameplay.
  (The tutorial *is* the game. The game *is* the tutorial.)
- 3D profile lands (Three.js backend, glTF import, Rapier physics module).
- Existing games ported in as playable districts/templates.

**Phase 4 — The Warren Exchange (months)**
- Upload/browse/install flow, license tagging, capability manifests, DMCA
  process. In-game marketplace district. Decentralized index format published.

**Phase 5 — The horizon**
- Peer-hosted multiplayer visiting (§9). Linux/macOS export. Steamworks
  module. WebGPU renderer. Whatever the Exchange community proves it needs.

---

## 11. Risks, named honestly

- **Scope is the boss fight.** "Engine + game + platform + community" has
  killed a thousand projects. Defense: every phase ends in something
  shippable alone; the porting of existing games is the forcing function
  that keeps the engine honest (it must run *real* games at every step).
- **Money.** No revenue is the point, but Steam fees, storage, and domains
  cost something. Defense: static-first architecture keeps infra near $0;
  donations/sponsorship (GitHub Sponsors, Ko-fi) are acceptable — gifts,
  not products — without breaking the free-forever promise.
- **Rights disputes on community content.** Defense: license tagging at
  upload, export-time rights checks, DMCA process — designed in at §7/§8,
  not patched in after the first takedown.
- **Sandbox escapes.** User scripts running on other people's machines is
  the single biggest technical risk. Defense: capability-based sandbox from
  v1, no raw eval of mod code outside it, permissive-by-approval like phone
  apps.
- **The analogy trap.** A "living EXE" must still, above all, *run the game
  instantly and reliably* — the revolutionary parts are opt-in layers on a
  boring, dependable core. Cookie Clicker's grannies work every time; so
  must we.

---

## 12. Immediate next steps

1. Ratify §7 licensing decisions (MIT + CC0) — everything downstream depends
   on them and they're near-impossible to change later.
2. Draft `rabbits-realm/RABBET-FORMAT.md` — the `.rabbet` v0 spec.
3. Scaffold `realm/` engine workspace; port Mosaic as the proof-of-life.
4. Add a Rabbit's Realm teaser section to rabbet.lol so the vision is public
   and the promise is on the record.

---

*Rabbit's Realm: the game is the engine, the engine is yours, and yours means yours.*
