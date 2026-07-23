# DIS — HOW TO SURVIVE IN HELL
### Full Game Design & Build Plan (v1.0)

> *"That's the one rule of Hell, the strong take from the weak. Get used to the idea and you might just make it through the afterlife."*

A first-person, ultra-hostile survival sim adapted **very heavily** from the r/nosleep story
**"How to Survive in Hell" by u/Ratrotted (2017)** —
https://www.reddit.com/r/nosleep/comments/63ubzl/how_to_survive_in_hell/

You die. Minutes later you wake up drowning in a birthing sac stuck to a wall in Dis, the endless
city of Hell. You are naked, you have nothing, and the first person who sees you is probably
hungry. Fight out of the sac, kill, scavenge, clothe yourself, claim a ruin, boil the rain, and
survive long enough to reach a **pillar of fire** — a séance held by the living, and the only way
out — before malnutrition, the rain, or the other damned take you back to the sac.

---

## 0. How to use this document (read first, GPT 5.6 Sol)

- This is the **complete spec**. Read all of it before writing code. Do not invent systems that
  contradict it; do not skip systems listed in §3 — §3 is the contract.
- Build **milestone by milestone** (§13), in order. Finish a milestone's acceptance checklist
  before starting the next. Each milestone produces a playable build.
- **House style (non-negotiable):** one self-contained `index.html` in `games/dis/`.
  Three.js **r160** as ES module from CDN (`three@0.160.0/build/three.module.js` — same as
  `games/mc/mc9.html`). Vanilla JS, no bundler, no build step, runs on GitHub Pages
  (www.rabbet.lol). The only external assets are the skybox images in `games/dis/sky/`.
- All textures other than skyboxes are **generated at runtime** (canvas-procedural), matching the
  existing games in this repo.
- Desktop-first: pointer lock + WASD. Keep the code structured so touch controls can be added
  later (the repo's other games do this).
- When numbers are unspecified, use §12 (tuning tables). When behavior is unspecified, pick the
  option that is **more brutal and more realistic**, in that order.

---

## 1. Pitch & design pillars

**Pitch:** A permadeath-ish survival roguelike where death is not the end — it's the respawn
mechanic, exactly as in the story. Every life begins naked in a sac. The world, your corpses,
your shelters, and your reputation persist. The score is **days survived** (the narrator's record:
one year). The win is riding a pillar of fire out.

**Pillars — every design decision is tested against these:**

1. **The story is the spec.** Every hardship the narrator describes exists in the game (§3).
   When in doubt, re-read the story excerpt quoted in the relevant section.
2. **Death is the loop.** Dying is frequent, expected, and instructive. You lose everything
   material; you keep knowledge, map memory, and the Handbook pages you've unlocked.
3. **Everyone here is a person.** No demons, no monsters — *"demons aren't real."* Every threat
   is human: desperate, organized, insane, or legendary. AI behavior should read as *people
   surviving*, not videogame aggro.
4. **Brutal realism.** Limb-level injuries, disease, cold, wetness, noise, weight, lethal melee.
   Anything you can lift, you can throw. No health bar regen, no magic, no minimap.
5. **Nobody stays on top.** Long-term decay (malnutrition) guarantees every run ends. The game
   is about how far you get, not whether you die.

**Score/meta:** `Days survived (best life)` · `Total deaths` · `Escapes` — shown on the death
screen and title screen, persisted in localStorage.

---

## 2. Source material & credit

- Adaptation of **"How to Survive in Hell"** (parts 1–4) by **u/Ratrotted**, r/nosleep, 2017.
  Credit the author on the title screen: *"After 'How to Survive in Hell' by u/Ratrotted."*
  Before any public promotion beyond the site, it's polite (and smart) to ping the author;
  if ever needed the game can ship under the standalone title **DIS** with the story credited
  as inspiration.
- Skyboxes: **"Brutal Skyboxes" by Pizza Doggy** — https://pizzadoggy.itch.io/brutal-skyboxes
  (32 skyboxes, v1.4.1, paid pack with its own Game Asset License Agreement PDF — see §9/§15).
- The narrator's voice (second-person survival handbook, profane, fatalistic) is the game's UI
  voice: death screens, loading tips, and the in-game Handbook quote or closely paraphrase him.

---

## 3. THE MASTER LIST — everything the narrator says that makes Hell hard to survive

**This section is the contract.** Each entry is a fact stated by the protagonist, followed by the
mechanic that implements it. Status legend: **[SIM]** fully simulated system · **[EVT]** scripted
event/encounter · **[LORE]** environmental storytelling & Handbook text (not simulated —
see §4 for why).

### A. Being born (the sac)

| # | What the narrator says | In the game |
|---|---|---|
| A1 | You wake in a **birthing sac** minutes after death, choking on amniotic fluid, and must claw through the fleshy walls yourself. | **[SIM]** Every life starts inside the sac: muffled audio, red-brown membrane view, an air meter draining, and a mash/claw struggle (rapid alternating strikes tear the wall). Slow clawing = drowning damage. |
| A2 | Sacs are *"horrible, yellow-brown pimples growing out of the brick"* — buildings all over Dis are covered in them. | **[SIM]** Sac props generated on building walls citywide. They are a world object: NPCs are born from them too, and they can be harvested (see A6/E-row hazards). |
| A3 | Sacs **repair themselves over time**. | **[SIM]** Harvested/torn sacs regrow on a timer. This is the world's spawner infrastructure. |
| A4 | **You get the body you had just before you died.** Died old, young, sick or crippled — *"tough shit"*, you may lack the strength to ever break out, drowning over and over. | **[SIM]** First spawn rolls a **Body**: Strength, Stamina cap, Size, Age modifiers. A weak roll makes the sac struggle genuinely harder (and everything after). On the very first game start, guarantee a viable body; NG lives keep the same body — your body is your identity across deaths. Flavor deaths of *other* sacs never opening are visible in the world (still, twitching sacs). |
| A5 | Birth dumps you **onto the street below** — the narrator twisted his ankle on landing. | **[SIM]** You tear out and fall 2–4 m; bad luck or a weak body = sprained ankle debuff on arrival (limp for the first minutes). |
| A6 | Newborns are **easy prey**; the first person who sees you will probably be hungry. *"Aim to kill the first person you see."* Very few survive the first hour, let alone the first night. | **[SIM]** Fresh-meat spawn logic guarantees nearby danger: 60% chance a resident is within earshot of a birth (the wet ripping sound is a dinner bell — noise system). NPC residents actively patrol sac-dense streets. Expected first-life survival: **minutes**. |
| A7 | His own first minutes: a resident **stomped his face, broke his jaw, snapped his limbs, and ate him alive.** | **[SIM]** NPCs execute downed targets: stomps target head and limbs, they eat kills on the spot. Downed state is survivable only if the attacker is interrupted or you crawl away unseen. |
| A8 | **When you die you emerge from a new sac in another part of the city** and start over as fresh meat. Everyone *"learns to attack the first person they see."* | **[SIM]** Core respawn loop: death → new sac at a random sac cluster elsewhere in Dis → naked, nothing. World state persists (your corpse with all gear stays where you died — recoverable if you can get back before scavengers strip it). |

### B. The environment itself

| # | What the narrator says | In the game |
|---|---|---|
| B1 | **It never stops raining in Dis.** Cold rain, all the time. | **[SIM]** Permanent rain (intensity varies 0.4–1.0, never 0). Rain drives Wetness. |
| B2 | **Pneumonia is a shitty way to die** — exposure kills. | **[SIM]** Wetness + Cold → Chill meter → **Pneumonia** disease track (cough noise that betrays your position, stamina cap loss, death in ~2 days untreated). Cure: stay dry + warm by a fire + rest. Clothing slows Chill; being naked in the rain is a death timer. |
| B3 | **The rain is teeming with disease** — it must be **boiled** before drinking; you need fire and a metal bowl. | **[SIM]** Drinking raw rainwater/puddles: quenches thirst but rolls Gut-rot disease (vomiting = dehydration spiral). The safe pipeline is: scrap bowl → collect rain → campfire → boil → drink/store. |
| B4 | The **sky boils with storm clouds and non-stop lightning**. | **[SIM]** Storm skybox set + continuous lightning system: random sky flashes (brightness pulse on ambient + directional light), thunder delayed by distance. Lightning matters mechanically in Phlegethon (F-row). |
| B5 | The city is an **insane medley of architecture** — *"modern to the prehistoric"* — all of it crumbling. | **[SIM]** Procedural district generator mixes eras per block: concrete/modern, Victorian brick, medieval timber, mud-brick/prehistoric hovels. Ruined variants: holes in roofs (rain leaks!), collapsed floors, rubble. |
| B6 | Streets are a **labyrinth**; *"taking a wrong turn is a fucking death sentence."* You need street smarts to know where not to go. | **[SIM]** No minimap, no compass. Navigation by landmarks only. Territory danger is signposted diegetically: skin trophies, billboards, bone piles, chalk marks. The player's real skill progression is map knowledge across deaths. |
| B7 | **There are no plants and no animals in Hell.** Cannibalism is the only food; starve and you start over. | **[SIM]** The only food chain is people (and the sac-flesh trap, E7). Zero forage, zero wildlife anywhere. Corpses are the resource node: flesh (roastable), bone (tools), skin (clothing/armor), hair (thread), fat (fuel). |
| B8 | **Human flesh + boiled rainwater = malnutrition.** *"Sooner or later even the strongest resident dies of malnutrition. I did well to last a year on it, though the last few months were agony."* Nobody stays on top of the food chain for long. | **[SIM]** **Malnutrition is a one-way long-term clock** — the run-length governor. It climbs slowly no matter how well-fed you are; variety (organ meat, marrow, blood broth) slows but never stops it. Symptoms ramp: stamina cap decay → strength decay → sores (infection risk) → agony (constant pain) → death around day 300–400 for a perfect player. The narrator's 1-year record is the target to beat. |
| B9 | Mud everywhere; the narrator **trips and loses footing in chases** on muddy ground. | **[SIM]** Mud surfaces reduce traction; sprinting through mud has a slip chance (worse when turning hard or downhill). Chases are decided by footing choices. |
| B10 | Scrap **iron is scarce** in some districts (*"barely enough to make myself a water bowl"*); the best houses come with **scrap metal and timber**. | **[SIM]** Loot density varies by district era. Modern/industrial blocks = metal-rich; hovel slums = metal-poor (bone/wood tech only). Shelter choice is a strategic resource decision. |
| B11 | Buildings have **squatters**; *"pick a building, kill any squatters you find and move in."* | **[SIM]** Claimable shelters. Occupied ones must be cleared. Your claim persists across your deaths — but the world doesn't respect it: NPCs can re-squat while you're away or dead (and your stash is theirs if they find it). |

### C. The damned (people are the monsters)

| # | What the narrator says | In the game |
|---|---|---|
| C1 | **The one rule: the strong take from the weak.** | **[SIM]** Universal AI doctrine: every NPC continuously sizes up (gear + size + posture + health + group) vs. you and acts accordingly — rob, kill, enslave, ignore, or flee. There are no "friendly" spawns, only currently-unprofitable fights. |
| C2 | Two castes: **fresh meat** (newborn, naked, desperate for clothes and tools) and **residents** (established; see fresh meat as *"a quick and easy supply of food, leather and bone"*). | **[SIM]** NPC lifecycle: NPCs are born from sacs naked, scavenge, gear up, claim shelters, join tribes — the same game you're playing. Residents actively hunt sac streets for newborns. You are indistinguishable from an NPC to other NPCs. |
| C3 | Residents have **armour of tanned skin, scavenged metal and bone**, and *"almost certainly a shiv, club or axe."* All of it is yours if you can take it. | **[SIM]** Full gear transfer: everything an NPC wears/carries is lootable. Gear tiers: rags → leather/skin → bone-plated → metal-scrap (Cocytus tier). |
| C4 | **Residents victimise each other** as much as the fresh meat; protection is extorted from the weak. | **[SIM]** NPC-vs-NPC predation runs constantly (you'll hear and stumble into it). Weak NPCs attach themselves to strong ones, paying tribute (food/loot) for protection — the player can be either side of that deal. (See §4 — the story's sexual-violence content is translated to extortion/predation and is not depicted.) |
| C5 | Hell's demographics: **young, strong bodies of men who died in wars** run things. Might makes right; *"if you can't fight them, you better do as they tell you."* | **[SIM]** Body rolls for NPCs skew toward war-dead soldier archetypes (era-mixed: legionaries to modern infantry — dress hints at era). Big NPCs issue demands to small ones (drop food, leave territory, carry this); complying is often survival. Player receives and can issue demands. |
| C6 | **Tribes** = safety in numbers, the closest thing to civilization: ~50 soldiers, territory, **violent initiations** (*"a few scars and a broken nose"*), honor codes that mostly stop backstabbing. Membership lasts only while you live — die and *"it's back to being fresh meat."* | **[SIM]** Tribe system: 4–8 procedurally seeded tribes hold Dis territories. Join via initiation (survive a 2-on-1 ritual brawl, or bring a tribute kill). Perks: shared fire, food pool, sleep in guarded shelter (finally, safe sleep), surgeon access, backup in fights. Obligations: tribute, patrols, raids. **Your membership is void on death** — your reborn self must re-earn it (they remember you, though — reputation persists per soul, C7). |
| C7 | People **meet each other again across deaths** (*"somebody I'd meet years later and eventually kill"*; "you owe me one… we'll run into each other eventually"). | **[SIM]** Persistent named NPCs with memory of you across your deaths — grudges, debts, favors. The man who ate you in life 1 is still out there in life 5, wearing your old boots. |
| C8 | Even honor codes collapse — *"Hell has ways of fucking over a good thing"*; tribes shatter instantly when a pillar appears, or when food runs short. | **[SIM]** Tribe cohesion meter driven by food stock and events. Scarcity → internal murders; pillar event → instant total defection (I-row). Alliances in Cocytus always end in betrayal (F-row). |
| C9 | **Third-party opportunism:** *"if you see a resident fighting fresh meat, kill both of them while they're distracted."* | **[SIM]** AI rule: NPCs witnessing a fight evaluate joining against the winner mid-fight. Every fight you start can summon vultures — including the player being coached to do the same (Handbook unlock). |
| C10 | Downed ≠ dead: attackers **go for the eyes**, break limbs to disable, and finish kills deliberately. | **[SIM]** Execution behaviors on downed targets (eye gouge = permanent-for-this-life vision damage if you survive; limb stomps). Playing dead is possible vs. low-cunning NPCs; hellhounds aren't fooled. |

### D. The special districts of Dis

| # | What the narrator says | In the game |
|---|---|---|
| D1 | **Skin Street:** a single dead-straight street, miles long, visibility killed by rain and dark. Feels horribly **exposed** — nowhere to hide. | **[SIM]** A unique generated landmark: one straight boulevard cutting across districts. No cover down the middle, long sightlines, heavy fog. |
| D2 | Every building and lamp is **decorated with flayed skin** — trophies left *"as bait for the ignorant."* | **[SIM]** Skin/trophy décor marks the zone (also your only warning signpost). Free "loot" (clothing scraps, weapons on display) is bait — taking it triggers ambush checks. |
| D3 | Its people are the **loners, serial killers, stalkers and psychos** — ambush predators who strike from shadows with expert precision (his death there: skull cracked from behind, eyes gouged, flayed). | **[SIM]** Skin Street NPC archetype: solo stealth killers. They stalk (you'll hear one wet footstep too many), attack from behind with crit damage, and prioritize blinding. Handbook counsel becomes literal strategy: *"forget clothing, grab a weapon, stay out of the shadows, keep checking behind you, get out fast."* |
| D4 | **Perdition Farms:** the outskirts are *"littered with billboards"* promising **free food and safety** — a lie to lure the stupid and the desperate. | **[SIM]** Billboard props ring the zone (readable: "FREE FOOD — SAFETY — ALL WELCOME"). New players will absolutely walk in. Once. |
| D5 | Farm tribes don't kill — they **herd people** off the streets and **take slaves**. | **[SIM]** Slaver squads with nets/clubs run herding drives on surrounding streets (blocking escape vectors, driving toward the gates — flee-AI aware). Downed by slavers = captured alive → **slavery gameplay state**: forced labor (sac harvesting, vat grinding), guards, meager broth rations. Escape paths: riot event, tunnel gap, feign death at the corpse pit, or die and respawn free. |
| D6 | The Farms' project: **organized food production** — slaves harvest birthing sacs from walls, grind them in **industrial vats**, mix with *"blood, body parts, rainwater"* into broth; slaves are the **guinea pigs** for each concoction, and eventually get eaten as *"real meat."* | **[SIM]** The zone interior is a functioning horror-factory (vats, sac racks, corpse pits — environmental storytelling). As a slave you're periodically forced to taste-test broth (random poison/disease roll). Stay too long and you're butchered. |
| D7 | **Amniotic fluid is drinkable if desperate** — too much and *"you empty your stomach from every available orifice."* | **[SIM]** Sacs can be drunk from: small thirst relief, vomiting threshold if you exceed ~2 doses/day (vomiting dumps hunger+thirst and makes noise). True emergency option, coded as such. |
| D8 | **Eating birthing-sac flesh grows a new sac inside you** over days — *"you'll be dead shortly after your stomach bursts."* | **[SIM]** Sac flesh is abundant, filling, and a **delayed death sentence**: hidden gestation timer (~3 days) with escalating symptoms (gut pain → visible distension → death by rupture). No cure. The game's cruelest trap food — the Handbook page for it unlocks only after your first rupture death. |
| D9 | The narrator's advice on the Farms: better to **cut your own throat** than be taken. | **[SIM]** An "accept death" action exists whenever you're captured or downed (framed as embracing the respawn — death is the loop, §1). Costs everything, as always. Sometimes it's genuinely the right play, exactly as the narrator says. |
| D10 | **The Boneyard:** once a cathedral in an endless cemetery, now a **shanty town of scavenged temples** run by zealots — the fanatics *"who decided Hell just isn't hellish enough."* **Masked gangs prowl for fresh converts**; the pastime is **mortification of the flesh** and virtuoso torture in the name of redemption. | **[SIM]** Zone: cathedral ruin + tent-temples + bone architecture. Ambient sermon audio, processions of flagellants. Masked press-gangs patrol beyond the borders hunting converts: capture = ritual sequence (damage-over-time spectacle with staged escape windows) ending in sacrifice. Atrocity content is conveyed by aftermath and silhouette, not interactive detail (§4). Handbook: *"Stay away from the Boneyard."* |
| D11 | *"Even if I wrote a library's worth of novels… I still couldn't tell you everything about the city."* Hell is functionally **infinite and unmappable**. | **[SIM]** Seeded infinite chunk generation — Dis extends as far as you walk (special zones are placed; generic districts are endless). |

### E. Hunger, thirst, medicine, sleep, and your own mind

| # | What the narrator says | In the game |
|---|---|---|
| E1 | Hunger and thirst are constant pressures; **starving to death means starting over.** | **[SIM]** Thirst kills in ~1.5 days, hunger in ~4 (see §12). Both throttle stamina regen and strength before they kill. |
| E2 | Meat must be **cooked** (*"a big slab of meat roasting over a campfire"*); fires need shelter from the eternal rain, and fire **light/smoke/smell is a beacon**. | **[SIM]** Raw flesh = high disease roll; roasting requires a sheltered fire. Fires emit light through windows and smoke — both raise a detection radius around your shelter. Eating well and staying hidden are in tension, permanently. |
| E3 | **Sleep is both vital and dangerous.** The spot must be *"sheltered, hidden and with access to an escape route"*; you *"never get more than a few hours at a time"*; any noise should wake and terrify you. | **[SIM]** Exhaustion meter forces sleep (hallucination microsleeps if ignored). Sleeping = time-skip in ~2h chunks with wake-checks: the game scores your spot on shelter/hiddenness/escape-routes; bad spots roll discovery events (robbed, dragged, eaten). Tribe shelters with watch rotations are the only near-safe sleep (C6). |
| E4 | **Injury is granular and permanent-for-this-life:** broken jaws, snapped limbs, gouged eyes, cracked skulls, infected sores, pus that must be drained. **No anaesthetic exists.** | **[SIM]** Per-part injury model: head (concussion/vision), jaw (eating slowed, no speech barks), each arm (weapon handling, two-handing), each leg (limp/crawl), torso (bleeding, stamina). Untreated wounds → infection → fever → death. Self-treatment (splints, cauterizing, draining) is a painful minigame that costs Composure (E6) — treatment *hurts*, always. |
| E5 | **Tribal surgeons** patch people up with flint/slate/glass scalpels, human-hair thread, iron-sliver needles. **Freelance surgeons** (currently dressing as **plague doctors** — beaked masks, coats of fire-blackened skin) are rare, unvetted, and *"usually sadistic fucking psychopaths"* — or impostors who killed a surgeon for the outfit. *"Freelancers aren't worth the risk."* | **[SIM]** Surgeon NPCs: tribal (reliable heal-for-barter, members only) vs. freelance plague-doctor encounters — same model, hidden variant: genuine (heals for steep barter) / robber / sadist (heals you into a trap). No tell before you're on the table. Risk literacy is the gameplay. |
| E6 | **Your feelings can kill you.** Skin Street's trophies reminded him of Christmas with his kids: *"Feelings like that get you killed."* Long enough in Hell *"starts to break you down"* — the hollowed-out take the walk into Gehenna (F1). | **[SIM]** **Composure** meter: memory triggers (certain décor, children's items in ruins, music-box audio) start intrusive memory events — vision blur, slowed reactions, audible sobbing (noise!). Suppressing them costs Composure permanently for that life; at zero Composure the only prompts left are "walk to Gehenna" or fight on with permanent shakes. Kills, torture witnessed, and betrayals all tax it. |
| E7 | *"If you're able to read, you've already got the intellectual advantage."* Knowledge is the real progression. | **[SIM]** The **Handbook** meta-system: the narrator's actual text (quoted/paraphrased) unlocks page-by-page as you die to the thing each page warns about. Death screens deliver the relevant passage. Across deaths, the Handbook is your persistent progression — the game literally teaches you the creepypasta. |

### F. The world beyond the streets (outer zones)

| # | What the narrator says | In the game |
|---|---|---|
| F1 | **Gehenna** — the wasteland ringing Dis: *"an empty expanse of grey stretching out into infinity."* The rain **stops**; sludge becomes **grey ash**; above the clouds the sky is **flat grey with a white sun**, devoid of warmth. Walking it, you **lose the urge to eat, drink or sleep**; the body **wastes away** (*"skin started to peel away and my bones were exposed"*) and the mind hollows. **Space is broken:** days or weeks outbound, but turn around and *"Dis was only a few steps away."* Return, and your body finally falls apart → sac. | **[SIM]** Leave the city edge: rain fades, unique skybox swap (flat grey/white sun), fog opens to an endless ash plane. All survival meters **freeze**; a Dissolution meter climbs instead (visual: skin/hands degrade, desaturation, audio hollowing). Turn 180° at any point — the city is impossibly ~50 m behind you. Walk far enough without turning: the **Hollowing** — a secret "give up" ending (life ends, sac respawn, unique Handbook page). Gehenna is also the fast-travel-shaped trap: it cannot be used to go anywhere. |
| F2 | Rainwater drains **into Gehenna's ash, into the sewers beneath Dis, and into Phlegethon Swamp**. | **[SIM]** **Sewers** exist as a sub-layer under Dis: dark traversal shortcuts, drainage currents, squatter hermits, and the origin of Phlegethon's vortices. Flashlight = torch (rain can't reach, but air is foul). |
| F3 | **Phlegethon Swamp:** the city's runoff cesspit. The water is lethal **no matter what you do with it** — boiling doesn't help; it's disease + rot + **chemical waste**; *"one pool might simply be undrinkable but another might dissolve your flesh."* **Skin contact can be deadly.** | **[SIM]** Zone: drowned district, inky water. Water contact deals corrosion damage (per-pool severity rolled from seed; visually identical — test before you touch). Nothing here is potable, ever. |
| F4 | The water is **inky black; depth is unknowable** — *"an inch or it could be a mile"* — and **unseen vortices** (sewer drains) *"drag down even the strongest of the damned."* | **[SIM]** Depth is real but invisible: pools are 0.1 m–bottomless, indistinguishable by sight. **Probe mechanic: throw things** (rocks/debris — splash and sink audio reads depth) or pole-test. Vortex tiles pull with force scaling — strong bodies can fight out of the edge, nobody swims out of the center. |
| F5 | Navigation is via **crumbled buildings as stepping stones**; corroded timber **collapses**; go slow and keep balance *"or subject yourself to a fucking agonising death."* | **[SIM]** Traversal-puzzle platforming across debris; wooden pieces have hidden integrity (creak warnings), balance matters (no sprinting on beams). Falls = corrosion + vortex risk. |
| F6 | **Wildfires:** chemical waste + decaying gas makes the swamp volatile — *"a lightning strike or build-up of gasses"* triggers **immense explosions that ignite the surface for miles.** *"Wildfires move fast. I guarantee you that you won't outrun one."* No tribe settles here permanently. | **[EVT]** Telegraphed zone event: gas shimmer + rising drone + a lightning strike (B4 ties in) → detonation → a fire wall propagates across the water surface faster than sprint speed. Survival = being on high debris or off the water when it passes, not outrunning it. No safe zones = no NPC settlements, only scavenger transients. |
| F7 | **Cocytus:** a quarry-pit *"dozens of miles wide and several times as deep"*, dug by a slave alliance either to **tunnel out of Hell** or for **resources**. The paths down are **labyrinthine**; caverns hold **shanty towns and crude smelting facilities**, some **lost to cave-ins**. | **[SIM]** Zone: vast terraced pit east of Dis with descending switchback paths, cavern networks, inhabited and abandoned camps, collapse hazards (props + supports you can build — building system synergy). |
| F8 | Deep caverns hold **veins of iron and copper**; sheltered from the rain, fires burn **hot enough to smelt ore**. Tribes forever **ally, mine, and betray** over the veins; *"when hunger, cold and greed are your constant companions, none of the damned can be trusted."* | **[SIM]** Mining + smelting = the **top gear tier** (metal tools/weapons/armor). Untapped veins are deep and contested. Cocytus tribes run the strongest alliances and the most scripted betrayals (cohesion events, C8). This is the endgame economy zone. |
| F9 | **Digging deeper does not lead out of Hell** — and there's no magma: **the deeper, the colder.** At the bottom *"the air is cold enough to freeze your blood and shatter your skin"*; walls become **more ice than rock**; **narrow icy walkways** are death traps. | **[SIM]** Cold gradient by depth: layered clothing + carried torches required; frostbite injury track (fingers → grip penalty, feet → speed). Bottom tiers are lethal-cold with ice traversal (slip physics on narrow paths). At the true bottom: no exit — only the richest veins, the dark, and a unique Handbook page confirming there is no way out **down**. |

### G. The named legends (apex humans, not demons)

| # | What the narrator says | In the game |
|---|---|---|
| G1 | *"Very few people are strong enough, mean enough and downright psychotic enough to earn a reputation in Hell. Those few… are people you never want to meet."* Known names: **The Slaughter Man, The Pale Witch, The Ripper, The Grim Doctor, The Tyrant.** | **[SIM/EVT]** Legends are rare roaming world-bosses — each a human with one impossible trait. Encounter rate ≈ once per several in-game days, announced by dread tells (fleeing NPCs, sudden silence, distant single voice). Fighting them is almost always the wrong answer. |
| G2 | **The Slaughter Man:** huge, bearded, **filed teeth, bloodshot eyes, foam on his lips**; tore a dozen armed slavers apart **barehanded, naked, on his birth day**, shrugging off clubs and whips; possibly the **berserker of Stamford Bridge**; has spoken exactly one word — *"VALHALLA!"* | **[EVT]** Rampage event: he walks a straight line through anything, one-shots grabs (the jaw pull), ignores stagger, cannot be meaningfully killed by one player-life. Hearing "VALHALLA!" through the rain = leave the district. Killing him is a hidden 100-hour-class achievement, not a quest. |
| G3 | **The Pale Witch:** an adult **cambion** (born in Hell — an impossibility). Waifish, naked, **feels no pain** (fights on a broken leg without noticing), unbothered by cold and rain, blows barely affect her; hardened residents are **terrified** of her. Her gaze **paralyzes** (*"I looked into her eyes and I couldn't fucking move"*); she tortures **without purpose or comprehension** ("Hmmm?"), then leaves victims alive and crippled. | **[EVT]** Unique NPC: ignores pain/stagger/weather entirely; damage doesn't change her behavior. Direct eye contact within range = screen-lock fear paralysis (break by wrenching the camera away — literally the counterplay the narrator used: don't look, run). She cripples and leaves you alive: the only enemy whose "win" is you surviving, maimed. She never eats, never loots, never shelters. |
| G4 | **Cambion lore** — children born in Hell, dead doll eyes, vanishingly rare; babies otherwise don't survive Dis. | **[LORE]** Referenced only via the Pale Witch's Handbook page and NPC rumor barks. No children exist or appear in-game (§4). |
| G5 | **Hellhounds:** the damned who **lost their minds after centuries** — beast-people on all fours. They keep **animal cunning**: hunt as **packs**, use **bait tactics** — one appears weak/alone/starving, flees prey into the ambush, even **stops dead mid-chase to trip you**. *"Human teeth and fingernails are perfectly capable of ripping flesh from the bone."* | **[SIM]** Pack archetype (4–12): a "bait" unit with deliberately pitiful stats lures (fake limp, exposed position). Pursue and the pack closes a ring; the bait stop-trip is a scripted trick vs. sprinting players. They ignore gear, go straight to grapple-bites, can't be intimidated, and *aren't fooled by playing dead* (C10). Their howl vocabulary telegraphs the state (bait-cry / triumph-howl / ring-closing yips) — learnable, like everything here. |

### H. Society's ugliest institutions

| # | What the narrator says | In the game |
|---|---|---|
| H1 | **Slavery is normal** — slaver tribes with clubs and whips take fresh meat captive (the Slaughter Man's origin story); Perdition Farms industrialized it. | **[SIM]** Slaver archetype exists city-wide, not just at the Farms (capture-preference AI). Slaves appear in the world as NPCs with jobs and escape attempts you can aid, ignore, or exploit. |
| H2 | **Trophy culture:** most of the damned use the whole body of a kill; Skin Street's people take **trophies** and display them. | **[SIM]** NPC corpse-use behaviors are visible world-building (butchering, tanning racks, trophy hanging). Trophies double as territory warnings (B6). |
| H3 | **Barter, no currency:** services and safety are paid in *"tools, clothes or slaves"* — meat, water, bone, skin, ore. | **[SIM]** Barter UI with NPCs (offer/demand slots, value from scarcity). No money anywhere. |
| H4 | **Advertising is a weapon:** Farms billboards (D4), surgeon uniforms (E5), skin-trophy bait (D2) — *"advertising doesn't always work as intended in Dis."* | **[SIM]** A running design rule: every "helpful" signal in the world (signs, uniforms, free loot, cries for help) has a deception variant. Trust nothing at face value — verify or pay. |

### I. Escape (the win condition)

| # | What the narrator says | In the game |
|---|---|---|
| I1 | The living who genuinely reach the dead (séances, spirit boards) open a gate seen from Hell as **a pillar of fire stretching down from the clouds.** | **[EVT]** The **Pillar of Fire** event: at random long intervals (see §12), a roaring fire-beam drops from the storm ceiling somewhere in Dis — visible city-wide (unique skybox treatment + light column + sound carrying for kilometers). |
| I2 | *"As soon as one of those pillars shows up, the damned scramble to be the first to get to it."* **Thousands swarm** — kicking, biting, clawing; *"contacting the dead always results in a bloodbath"*; **only one soul can leave**; even the most civilised tribes **fall apart instantly.** | **[EVT]** Every NPC in radius drops everything and converges (tribes dissolve mid-stride — allies become rivals, C8). At the pillar: a churning kill-zone crowd. To win you must reach the beam's core *first* through the densest brawl in the game. Positioning, timing (pillars burn ~3–5 min), body strength, and ruthlessness decide it. Most attempts should end in death — the stampede is the hardest fight in the game **by crowd, not by boss**. |
| I3 | Escape = **taking over a living body.** *"Demons aren't real. What the living see as demonic possession is just one of the damned testing out their new body."* Sooner or later the host dies or an **exorcist** sends you back — *"then we're fresh out of the birthing sac and on the streets again."* | **[EVT]** Win sequence: ride the pillar → short possession epilogue on Earth (text-over-vignette in the narrator's voice; player's stats read out) → **Escapes +1** on the permanent record → the inevitable return (exorcism) restarts the loop as NG+: same persistent world, your legend grows (NPC rumor barks reference your escape). "Escaped and stayed out" is the roll-credits state after the first escape; continuing is optional and endless. |
| I4 | There is **no other way out**: not down (Cocytus, F9), not outward (Gehenna, F1), not through faith (the Boneyard's lie, D10). *"Forget about redemption… The only way out of Hell is by riding a pillar of fire."* | **[SIM]** Hard rule. Every false exit is implemented, explorable, and terminally disproven in-world. The Handbook's final page states it plainly. |

**Coverage check:** every survival-relevant claim in parts 1–4 appears above (A1–I4). The only
story elements deliberately **not** simulated are listed with reasons in §4.

---

## 4. Content boundaries (what we adapt, what we translate)

The game keeps the story's brutality: murder, cannibalism, dismemberment, body horror, disease,
torture *themes*, slavery, and total bleakness. It is an adults-only horror game in the
Agony / Manhunt tradition. Three translations, so it stays shippable and playable:

1. **Sexual violence** in the source (rape, prostitution-for-protection) is **not depicted or
   referenced** in-game. The underlying survival logic it represents — the strong extorting the
   weak, protection bought with tribute — is fully present as violence, robbery, tribute, and
   enslavement (C4, C5, H1).
2. **No minors, ever.** No babies in sacs, no child victims in the Boneyard, no cambion infants.
   The cambion concept survives only as the adult Pale Witch and rumor lore (G3, G4).
3. **Torture spectacle** (Skin Street, Boneyard, Farms) is conveyed through aftermath,
   silhouette, audio, and environment — not interactive close-up detail. The player can be a
   victim of these systems mechanically (captured, crippled, executed) without the camera
   lingering.

Add a **gore toggle** (full / reduced) and a content note on the title screen. Handbook text may
keep the narrator's profanity.

---

## 5. Core loop & player journey

```
DIE (intro or previous life)
  └─> SAC: claw out before you drown  ..............  (30 seconds of panic)
       └─> FRESH MEAT: naked, hunted  ...............  (first 10 minutes: weapon > clothes > kill)
            └─> SCAVENGER: clothes, shiv, first meal   (hour 1: don't die of the rain)
                 └─> RESIDENT: claimed shelter, fire,
                     boiled water, food logistics ....  (days 1–10: the survival sim opens up)
                      └─> TRIBAL: initiation, safety,
                          territory, surgeon, raids ..  (days 10–100: the social sim opens up)
                           └─> VETERAN: Cocytus metal,
                               legend encounters,
                               malnutrition closing in   (days 100+: the clock is winning)
                                └─> THE PILLAR: stampede
                                     ├─ die → SAC (keep Handbook, map, reputation)
                                     └─ escape → EPILOGUE → NG+
```

- **Session shape:** lives last minutes (early) to hours (skilled). Death screens deliver
  Handbook pages = the "one more life" hook.
- **Difficulty philosophy:** never fair, always legible *in hindsight*. Every death must be
  explainable by a rule the Handbook can teach.

---

## 6. World structure

```
                          GEHENNA  (infinite grey ash — all directions, beyond the last district)
        ┌─────────────────────────────────────────────────────┐
        │                        D I S                        │
        │   [sac-dense slums]      [modern blocks: metal]     │
        │        SKIN STREET ═══════════════════════════      │
        │   [medieval maze]         [Victorian rows]          │
        │                                                     │
        │   PERDITION FARMS          THE BONEYARD             │
        │   (industrial NW)          (cathedral SE)           │
        │                                                     │
        │   PHLEGETHON SWAMP (drowned S)    COCYTUS (pit E)   │
        │            └── SEWERS run beneath everything ──┘    │
        └─────────────────────────────────────────────────────┘
```

- **Generation:** seeded, deterministic, chunked (streamed in a radius around the player, like
  `mc9.html`'s world). Special zones are placed at fixed bearings/distances from the origin
  spawn region so veterans can navigate by memory. Generic districts continue infinitely.
- **Persistence:** one world per save slot. Diffs (claims, stashes, corpses, harvested sacs,
  NPC deaths, reputation) stored in localStorage; chunk regen replays diffs.
- **Distances:** special zones ≈ 400–800 m from origin — reachable in one careful life, far
  enough that reaching them *is* the run.

---

## 7. Systems specifications

### 7.1 The Body (per-soul, permanent across deaths)
Rolled once at game start (guaranteed viable): Strength (melee damage, grapples, sac escape,
carry), Stamina cap, Size (hitbox, intimidation, food need), Age band (recovery speed).
NPCs roll on the same table, skewed strong (C5).

### 7.2 Vital meters
Health (per-part, no regen past light wounds) · Stamina (sprint/swing/grapple) · Thirst ·
Hunger · Warmth/Wetness → Chill · Exhaustion → forced sleep · Composure (E6) ·
Malnutrition (one-way, B8) · Disease states: Gut-rot, Pneumonia, Infection, Fever,
Sac-gestation (D8), Frostbite (F9).

### 7.3 Injury model
Parts: head, jaw, eyes(2), arms(2), legs(2), torso. States: bruised → fractured → broken →
mangled. Effects per §3 (E4, C10). Bleeding stacks; treatments: pressure, cauterize, splint,
stitch (hair thread + needle), drain. All treatment hurts (Composure/scream noise).

### 7.4 Combat
- Stamina-costed swings with wind-up/recovery; hit location from aim; blocking with weapons/arms
  (arms take the damage); shoves, grapples (Strength contest), stomps on downed targets.
- Lethality: 2–4 solid hits kill an unarmored human. Armor (skin/bone/metal) soaks by location.
- **Throwing — flagship mechanic:** any carryable prop or weapon can be thrown. Hold to charge,
  ballistic arc (no UI arc — learn the feel), damage = kinetic energy × sharpness; heavy
  two-hand heaves for rocks/beams. Thrown items persist where they land (world physics props).
  Uses beyond combat: depth-probing pools (F4), triggering ambush bait, distraction noise,
  breaking windows, feeding a chasing pack by throwing meat.
- Weapon tiers: fists → rock/plank → club/shiv (bone/wood) → axe/spear → metal blades (Cocytus).
  Durability real; weapons stick in bodies.

### 7.5 Stealth, noise & senses
Noise events (footsteps by surface, combat, chopping, screams, coughing, sobbing, sac-births)
propagate with radius; NPCs investigate. Vision: fog + rain + darkness; crouch profile; shadows
matter (Skin Street). Smell/light: fires and roasting raise shelter detection (E2). Blood
trails after wounds — yours and theirs — are followable both ways.

### 7.6 Scavenging, crafting & building
- Loot: scrap metal, timber, brick, bone, skin/leather, hair, glass, flint/slate, cordage, ore
  (F8). Corpse processing yields flesh/bone/skin/hair.
- Craft (no benches; some need fire): shiv, club, axe, spear, bowl, waterskin (stomach),
  bone needle, splint, torch, skin clothing tiers, bone/metal armor, drying rack.
- Build (socketed on structures + a few freeform props): door brace, window barricade, fire pit,
  rain catcher, bone-chime alarm (noise tripwire), stash cache (hidden container), cave supports
  (Cocytus anti-collapse). Claims per B11; raids and re-squatting per world sim.
- Smelting (Cocytus only): ore + hot fire → metal tier. The reason veterans go east.

### 7.7 NPC & society simulation
- ~24 fully-simulated NPCs around the player; abstracted population beyond (districts have
  demographic pressure: births from sacs, deaths, tribe recruiting — so the world doesn't
  depopulate).
- Archetypes: fresh meat, scavenger, resident, tribal soldier, slaver, Skin Street stalker,
  Boneyard zealot, hellhound pack, surgeon (tribal/freelance), slave, legend.
- Universal doctrine per C1/C9 (size-up → rob/kill/enslave/ignore/flee; opportunism on
  witnessed fights). Named persistent NPCs with cross-death memory (C7): grudges, debts
  ("you owe me one"), recognition barks.
- Tribes per C6/C8: territory, cohesion, initiation, perks, obligations, betrayal triggers.

### 7.8 The Handbook (meta-progression)
Pages = quotes/paraphrases from the story, unlocked by relevant deaths/discoveries; readable
from a diegetic journal UI. The final unlockable page is the narrator's sign-off (§3 I4).
Handbook state, records, and world diffs persist in localStorage.

---

## 8. Zone gameplay summaries

| Zone | Fantasy | Core loop there | Key systems |
|---|---|---|---|
| Dis districts | Urban predation | Scavenge, claim, hunt/be hunted | Everything baseline |
| Skin Street | Exposed gauntlet | Cross it fast, loot bait, don't be followed | Stealth, ambush AI, fear |
| Perdition Farms | Industrial slaver hell | Avoid herds; if taken: labor + escape | Capture state, riot events |
| The Boneyard | Zealot theocracy | Avoid press-gangs; witness; rare loot (iron relics) | Capture rituals, processions |
| Phlegethon | Toxic traversal | Stepping-stone routes, probe depths, flee wildfires | Throwing-as-probe, balance, EVT fire |
| Cocytus | Frozen mining abyss | Descend, mine, smelt, ally, get betrayed | Cold, collapse, top-tier economy |
| Sewers | Dark shortcuts | Fast transit, hermits, vortex sources | Light, foul air |
| Gehenna | The give-up horizon | One-way psychological setpiece | Dissolution, secret ending |

---

## 9. Skyboxes, weather & atmosphere

**Asset source:** *Brutal Skyboxes* by Pizza Doggy (32 skyboxes, v1.4.1 zip). The user downloads
the pack and drops chosen images into `games/dis/sky/`. **All 32 will be used**, assigned across
zones and states via a manifest — plus optional extra "gruesome" packs later (the manifest is
open-ended).

```js
// SKY_MANIFEST — user fills filenames after unzipping the pack; roles are the contract.
const SKY_MANIFEST = {
  dis_storm:      ['storm_a.png','storm_b.png','storm_c.png'], // rotating variants, lightning-flashed
  dis_deepnight:  [], gehenna_grey: [], gehenna_sun: [],
  swamp_murk:     [], swamp_fire:  [],  // wildfire event sky
  cocytus_mouth:  [],                    // seen from the pit rim
  boneyard:       [], farms_smoke: [],
  pillar_event:   [],                    // sky treatment while a pillar burns
  gruesome_extra: [],                    // any additional packs
};
```

- Loader: cube or equirect (support both; detect by aspect). **Procedural fallback sky**
  (shader gradient + noise clouds) so the game runs before assets are dropped in.
- Per-zone sky cross-fades; lightning system flashes the sky material + scene lights (B4);
  thunder distance-delayed.
- Rain: GPU particle sheet + surface ripple decals + interior drip audio where roofs are holed.
- Palette: desaturated, fog-heavy, PSX-adjacent (low-poly kitbash + dithered gradients) — the
  pack's look is the art direction anchor.
- Audio: layered rain (exterior/interior), thunder, distant screams and dogs-that-aren't-dogs,
  mud footsteps, sac ambience. WebAudio-synthesized where possible to stay single-file.
- **License note:** the pack's Game Asset License permits use in games but the PDF should be
  checked regarding raw-file redistribution before committing the images to this public repo;
  worst case, ship them slightly recompressed/atlased as part of the build (standard practice).

---

## 10. Tech architecture

- `games/dis/index.html` — everything: CSS, JS modules via import map (three@0.160.0 CDN).
- Internal structure (single file, clearly sectioned): `Config/Tuning` → `RNG/Seed` →
  `SkyManager` → `Weather` → `ChunkGen (districts/zones)` → `Props/Sacs` → `Physics (simple
  capsule + prop impulses)` → `Player (body, meters, injuries)` → `Combat/Throwing` →
  `NPC (archetypes, doctrine, tribes)` → `Events (pillar, wildfire, legends)` → `Crafting/
  Building` → `Persistence` → `UI/HUD/Handbook` → `Main loop`.
- Performance budget: 60 fps mid-laptop. InstancedMesh for buildings/props/sacs; ≤ ~300 draw
  calls; fog culls the horizon (it's atmospheric anyway); ≤ 24 active NPCs; rain as one
  Points system; chunk radius ~3.
- HUD: realistic-minimal. No bars on screen by default — diegetic signals (breathing, limp
  camera, shiver, stomach audio, vignette). Tab = status panel (meters, injuries, diseases).
  Dot crosshair. Interaction prompts contextual.
- Saves: localStorage JSON `{seed, bodyRoll, worldDiffs, handbook, records, npcMemory}`.

---

## 11. UI voice & narrative delivery

- **Title:** "HOW TO SURVIVE IN HELL" over a storm skybox; records line; content note; credit.
- **Death screen:** cause of death in the narrator's voice + the newly unlocked Handbook page +
  records. ("Pneumonia. Told you it was a shitty way to die. — page unlocked: *Shelter*")
- **The narrator himself:** exists as an unmarked persistent NPC somewhere in the world.
  Meeting him is rare and unceremonious; helping him or being robbed by him unlocks the
  final flavor line: *"Told you we'd run into each other. You owe me one."*

---

## 12. Tuning tables (v0 — expect iteration)

| Meter | Full→empty | Empty effect |
|---|---|---|
| Thirst | 36 in-game hours | Health drain → death ~+12 h |
| Hunger | 96 h | Stamina cap ↓ then health drain |
| Chill (wet+cold) | ~20 min naked in rain | Pneumonia roll/min at max |
| Exhaustion | 20 h awake | Microsleeps, then collapse |
| Composure | event-driven | Shakes, sobbing noise, Gehenna prompt |
| Malnutrition | ~300–400 days (variety-slowed) | Stat decay stages, then death |
| Sac-gestation (D8) | ~3 days after eating sac flesh | Death (rupture), no cure |

- Time scale: 1 in-game day ≈ 24 real minutes (sleep skips). "One year" ≈ 145 real hours of
  survival — the narrator's record is meant to be near-mythical.
- Pillar of Fire: first at day 2–4 (tutorializing failure), then mean interval ~6 days,
  burn 3–5 min, audible ~1.5 km, NPC convergence radius ~800 m.
- Fresh-meat spawn: 60% armed-resident within 80 m; first weapon within 30 m (rubble rocks
  always available).
- Melee: fist 8–15 dmg, club 25–40, axe 35–55, metal 50–75; head ×2, downed ×3.
  Throw: KE-scaled, rock ≈ club-hit at 15 m; heavy heave can fracture through block.

---

## 13. Milestones (build order for GPT 5.6 Sol)

**M0 — Storm skeleton.** Pointer-lock FPS controller, chunked district gen (era-mixed blocks,
interiors enterable), fog, rain particles, SkyManager with manifest + procedural fallback,
lightning/thunder. ✓: walk the city at 60 fps; lightning flashes feel oppressive.

**M1 — Born wet.** Sac intro (air meter, claw-out struggle, fall), body roll, vital meters
(thirst/hunger/wet/chill/exhaustion), death → new sac elsewhere, corpse persistence, records.
✓: die of exposure naked in the rain; respawn; find your own corpse.

**M2 — Tooth and nail.** Combat (swings, locations, per-part injury, downed/executions),
**throwing everything**, first NPC archetypes (fresh meat, scavenger, resident with doctrine
C1/C9), noise system, blood trails. ✓: kill the first person you see; be killed by the second;
win a fight with a thrown brick.

**M3 — Resident.** Loot/scavenge, crafting, corpse processing, cooking/boiling, shelter claims,
barricades, stash, sleep system with spot scoring + wake events, disease tracks. ✓: full
survival loop sustains a multi-day life indoors; sleeping in the open gets you robbed.

**M4 — Society.** Tribes (territory, initiation, perks, obligations, cohesion/betrayal),
named persistent NPCs with cross-death memory, barter, surgeons (tribal + plague-doctor
variants), slavers + capture state. ✓: join a tribe, sleep safely, get betrayed over food.

**M5 — The districts.** Skin Street (stalkers, bait loot), Perdition Farms (billboards,
herding, slavery + escapes), Boneyard (press-gangs, processions, rituals). ✓: each zone kills
a confident M4 player in a new way; Handbook pages unlock for each.

**M6 — Beyond the streets.** Sewers, Phlegethon (corrosive pools, depth-probing, debris
traversal, wildfire event), Cocytus (descent, cold gradient, mining/smelting, cave-ins,
alliance betrayal events), Gehenna (dissolution, broken space, Hollowing ending). ✓: metal
gear obtainable; wildfire is survivable only by reading tells; Gehenna gives one player chills.

**M7 — Legends & the narrator.** Slaughter Man rampage, Pale Witch (pain-immune, gaze-lock),
Ripper/Grim Doctor/Tyrant variants, narrator NPC, hellhound packs with bait tricks (if not
already in M4). ✓: veterans have a "you won't believe what I saw" story.

**M8 — The way out.** Pillar of Fire event (sky treatment, city-wide convergence, tribe
dissolution, stampede crowd combat), escape epilogue, NG+ legend status, full Handbook,
gore toggle, balance pass, title screen, add the game card to the site's `index.html`.
✓: someone escapes Hell and immediately starts a new run.

---

## 14. Kickoff prompt (paste this to GPT 5.6 Sol)

> You are building **DIS — How to Survive in Hell**, a single-file Three.js survival horror
> game. The complete, binding spec is in `games/dis/PLAN.md` — read ALL of it before coding.
> Rules: one self-contained `games/dis/index.html`; Three.js r160 ESM from CDN via import map
> (match `games/mc/mc9.html`); vanilla JS; no build step; procedural textures except skyboxes
> loaded per §9's manifest (implement the procedural fallback sky first — image files may not
> exist yet). Implement **Milestone M0 only** (§13), meeting every acceptance criterion, with
> the code sectioned exactly as §10 describes so later milestones slot in. Do not stub future
> systems with placeholder gameplay; do not invent features not in the plan. When the plan
> gives a number use it; when it doesn't, §12 or "more brutal, more realistic" decides.
> Deliver: the full file + a short test script (what to click/press to verify each criterion).
> Then stop and wait for me to say "M1".

---

## 15. Asset & credit checklist

- [ ] Buy/download **Brutal Skyboxes v1.4.1** (pizzadoggy.itch.io/brutal-skyboxes), read the
      Game Asset License PDF (note §9's redistribution caveat), unzip into `games/dis/sky/`,
      fill `SKY_MANIFEST` filenames (all 32 assigned; roles in §9).
- [ ] Optional: pick additional "gruesome" sky packs → `gruesome_extra` slots.
- [ ] Title-screen credit: *After "How to Survive in Hell" by u/Ratrotted (r/nosleep, 2017)* +
      skybox credit *Skies: Pizza Doggy*. Consider messaging u/Ratrotted before promoting.
- [ ] Content note + gore toggle wired (§4).
- [ ] Game card added to site `index.html` when M8 ships.

*The plan ends here. There's no grand revelation, no clever twist, no purpose, no redemption,
no hope. Now go build it.*
