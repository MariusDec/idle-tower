# The Tower, rebuilt — a ground-up redesign

**Status:** approved; decisions D1–D6 confirmed (§16). P0 and P1 are built
on the `rebuild` branch. P1's gate still needs the owner's 60-second watch
test and a frame-rate check on a mid-range Android device; P2 (§14) starts
after that.

**Supersedes:** every other file in `plans/`. Those describe the current game;
P0 (§14) moves them to `plans/archive/`.

**How to read this:** §1 explains why the game needs a rebuild and not another
balance pass. §2–§3 are the design on one page. §4–§9 cover each system in
detail. §10–§11 are presentation and the content budget. §12–§13 are how it is
built and how it is balanced. §14 is the phased work order, each phase ending
in something playable. §15 lists the risks, and §16 records the confirmed
decisions.

---

## 0. TL;DR

- **Today:** about 20 parallel progression systems and 8 currencies or XP
  tracks. There are over 300 content entries, and nearly all of them are a
  "+x%". Every one of them is on screen from the first minute, stacked on an
  exponential HP-vs-gold race. Since June that race has needed a balance plan
  most weeks: 79 of 133 commit messages mention a plan, balance, revamp or
  economy pass, and the save format is on version 25. Nothing is left to discover, and no single purchase
  can be felt. A run doesn't exist until wave 20, because before that a death
  just rewinds one wave.
- **Rebuilt:** an **incremental roguelite tower defence**. Runs are short: about
  2 minutes at first, and 6–12 minutes at the frontier. During a run the tower
  levels up and **drafts weapons and passives** (1 of 3 cards). Between runs,
  one meta currency (**Shards**) buys nodes on a fog-of-war skill web (the
  **Forge**). There are **six authored regions**, and each one ends in a boss.
  Beating the boss unlocks the next region, a new enemy family and new toys. The
  idle side comes from auto-pick, auto-restart and offline earnings. **The game
  never waits for the player.**
- **Rules that stop the old pattern from coming back:** every purchase has to be
  visible on the battlefield or be at least a 10% step. Something new appears
  about every 10 minutes for the first 2 hours. Act 1 has one meta currency. A
  system is never just a percentage.
- **Act 1** takes about 8–10 hours of active play, or about a week of idle play.
  It ends with a final boss and a real ending. **Act 2** adds Pacts (difficulty
  you opt into for more reward), a second tree and the endless Abyss.
- **Technically**, it's a rewrite in a fresh `src/` around a deterministic,
  DOM-free simulation. The same simulation drives the balance tool: a headless
  bot plays the *real* game at 1000× speed. The good leaf modules are ported:
  storage, camera, effects, audio, icons, design tokens and the Android shell.

| | Now | Rebuilt |
|---|---|---|
| First minute | ~30 controls and readouts before the first kill | HP, wave, XP bar |
| Run boundary | None until wave 20 (a death rewinds a wave) | Every run ends, the first one at ~2 min |
| Progression systems | ~20 | 7: draft, Forge, regions, relics, frames, feats, automation |
| Currencies / XP tracks | 8 | Shards and in-run XP (Act 2 adds Starlight) |
| Power feels like | +2% / +0.5% lines; fire rate capped near 3–4 shots/s | New weapons mounted on the tower, evolutions, more projectiles, faster clears |
| Goals | Wave numbers on an exponential curve | 6 bosses, 6 regions, collections, an ending |
| Balance tool | A 1.7k-line model that runs alongside the game and is kept in sync by hand | The real simulation, headless, played by a bot |

---

## 1. Diagnosis

The evidence comes from three places: playing a fresh save on the dev server,
reading `docs/` and `src/`, and the repo's own balance plans.

### 1.1 The first minute shows everything and teaches nothing

On a fresh save, before the first kill, the screen already offers:

- gold, kills, stats, enemies, wave, restart-wave, auto-progress, targeting mode,
  call-wave and the risk dial
- tower HP, mana (locked) and tower XP
- 5 nav groups holding **15 tabs**, 4 build sub-tabs, 3 upgrade categories and 3
  buy multipliers
- **29 upgrade cards**, each with a milestone line, an evolution line, a
  before→after figure and a shots-to-kill line
- a chapter strip, a next-wave hint, three contracts and a combo meter

Because every system is already on screen, there is nothing left to discover.
And the player has no way to tell which of those systems matters.

### 1.2 Twenty systems, each a thin slice of the same number

The progression layers are: upgrades (+17 evolutions), active abilities
(+ability XP), passives (+passive XP), talents (tower XP), research (real-time
RP), equipment (8 slots × 5 rarities, reforging), achievements, AP perks, TP
perks, cores, blessings, contracts, Long Watch chapters, tower marks,
milestones, deployment checkpoints, the risk dial, the combo meter and wave
modifiers. The currencies and XP tracks are gold, mana, AP, TP, RP, tower XP,
ability XP and passive XP.

Nearly all of it feeds the same stat keys through the 13 contributors in
`src/stats/contributors/`. In other words, it's one number (DPS vs HP) sliced
twenty ways. Lines like "+2% gold", "+0.5% crit" and "+1.5% double-gold chance"
can't be felt, so the player never forms a picture of *what* made them
stronger.

### 1.3 The tower barely changes

Fire rate starts at 0.9 shots/s and is capped on purpose at about 3–4
(`src/data/tower.ts`, `docs/upgrade-system.md`), because two compounding axes
used to run away. At hour 10 the tower does roughly what it did at minute 1,
just with bigger numbers. Getting stronger doesn't look like anything.

### 1.4 There's no loop until wave 20

Until ascension unlocks, a tower death rewinds one wave (`src/game/Game.ts`
around L1512, `restartCurrentWave`). So for the first 40–60 minutes there is no
run, no failure and no restart decision. The player is parked at the wall until
gold catches up.

The opening is punishing as well: 5 HP and 0.9 shots/s. In a fresh playtest the
tower lost 2 HP before the first upgrade (9 gold) was affordable, and it was
rewound on wave 2.

### 1.5 An exponential race is the whole structure, and it keeps breaking

The only things that move are enemy HP (×1.11–1.12 per wave) and gold
(×1.08–1.1). The repo's own measurements in `plans/progress.md` show where that
leads:

- Gold goes inert at wave 219, because the upgrade caps bind.
- The prestige ladder hit a fixed point around wave 359, after which runs
  gained 0–10 waves each, forever.
- A deep run took about 9 hours of simulated time, and about 88% of it was a
  risk-free spawn queue.

Each fix added another system: cap extensions, deployment checkpoints, depth
bands, greater blessings, repeatable research. Each one made §1.1 and §1.2
worse.

### 1.6 What is worth keeping

The engineering is solid:

- a fixed-timestep loop with substeps
- a DPR-aware camera
- pooled effects and quality tiers
- storage backends for web and Android
- a coherent art direction ("arcane siege": design tokens and a shared palette)
- an icon pipeline
- the boss intro presentation
- the enemy design rule "each type makes one answer correct"

All of these carry over (§12.2).

**The problem is structural, not a matter of balance.** No constant change fixes
§1.1–§1.5, so this plan rebuilds the design rather than retuning it.

---

## 2. Pillars and rules

### 2.1 Pillars

1. **Readable.** One arena, one tower, few numbers. A new player understands the
   screen within five seconds.
2. **Felt.** Every choice either changes what you see or is a step of at least
   10%. Power shows up as spectacle (more projectiles, new weapons on the tower,
   faster clears), not only as bigger numbers.
3. **Discovered.** The game starts almost empty and reveals itself: something
   new every ~10 minutes for the first 2 hours, and in every session after that.
4. **Earned.** Goals are authored (bosses, regions, collections) and come with
   ceremony. Losing a run is part of the loop, not a punishment.
5. **Idle-respectful.** The game never waits for the player and never punishes
   absence. Idle play runs at roughly 70–80% of active efficiency.

### 2.2 Rules (the review checklist for every feature and content entry)

- **R1: No pure-percentage systems.** A new system has to add a verb: a new
  decision, or a new behaviour on screen. Percentages are fine as minor nodes
  *inside* a system, but never as a system of their own.
- **R2: Currency budget.** Act 1 has one meta currency (Shards). Act 2 adds one
  more (Starlight). The only in-run resource is XP. There are never more than
  three in total.
- **R3: No UI before it's needed.** Every tab, button and readout has an unlock
  trigger in the reveal table (§7.1).
- **R4: At most 15 words of rules text** on a card, node or relic. Details go
  behind a long-press.
- **R5: Every run pays.** In Act 1, every results screen shows an affordable
  node, or at least 50% progress toward one. The bot checks this (§13).
- **R6: No real-time gates in Act 1.** No research timers. The only clock is
  time spent playing or idling.
- **R7: Difficulty is authored per region, not an open-ended race.** Infinite
  curves appear only in explicitly endless modes (overtime, the Abyss, mastery
  nodes), and no authored goal lives there.
- **R8: Content is data.** Every effect kind has an exhaustive consumer. Keep the
  current codebase's `never`-switch discipline for this.

---

## 3. The game on one page

**Fantasy.** The Blight is swallowing the world, and the last arcane Tower holds
a circle of light. Each run summons the Tower into a region of the Blight, where
it holds out as long as it can. Every boss it defeats pushes the light outward,
and the map literally brightens.

**Three loops:**

```
seconds   MOMENT  enemies close in → the tower fires → kills drop XP and shards
                  → the XP bar fills → LEVEL UP: pick 1 of 3 cards
minutes   RUN     waves 1→20 in a region → boss → overtime until the tower falls
                  → results: shards, records, discoveries, "Next: … 72%"
hours     META    spend shards in the Forge (fog-of-war web) → beat the boss
                  → new region, enemies, relic, frame → push further
```

**What a run looks like at three points in time:**

- **Minute 1.** One tower firing homing bolts at shambling Grunts. An XP bar and
  a wave counter. That's the whole screen.
- **Hour 2.** Region 3. The tower carries a chain-lightning coil, a frost ring
  and an evolved Seeker Swarm, plus two relics. The draft offered a Mortar, and
  you took it because the Glass Wastes' shieldbearers block frontal shots. The
  boss falls on the third attempt.
- **Day 5 (idle).** Auto-restart farms the Hollow's overtime overnight, and
  auto-pick follows your priority list. Offline shards paid for 6 Forge nodes
  while you were away. Tonight you push the Blight Heart by hand.

---

## 4. The run

### 4.1 Arena

Keep the current layout: a circular arena with the tower at the centre, and
enemies that spawn at the rim and walk inward. The layout is portrait-first,
for mobile via Capacitor, using the existing camera's aspect clamp. The tower's
range is shown as a faint ring.

### 4.2 Waves and regions

- **A region is 20 waves, and wave 20 is the boss.** After the boss comes
  **overtime**: endless waves with steep scaling and a rising shard payout,
  until the tower falls. A run always ends in death, or in a Retreat from the
  pause menu, which banks exactly the same rewards.
- **Waves are authored from per-region templates.** Each template has an enemy
  pool, a count curve and **beats** at waves 5, 10 and 15 (a new enemy
  introduction, an elite or a swarm). A region therefore has a recognisable
  rhythm, with seeded variation inside it.
- **Waves flow into each other.** A wave spawns over roughly 6–10 s. The next
  wave starts once the previous one has finished spawning *and* either the field
  holds 25% or less of its bodies, or 10 s have passed.
  - A strong tower chains waves quickly. Power turns into speed, and speed turns
    into more shards per minute.
  - A weak tower gets overlapped. Pressure builds until it dies.
  - This rules out the old "risk-free spawn queue" (§1.5) by construction.
- **The difficulty ramp inside a region is steep enough to require in-run
  growth** (§8.2).

### 4.3 Enemies

- **Roster.** Act 1 has 18 types, three per region, plus elites and bosses.
  Keep the existing doctrine: each type has one verb that makes one answer
  correct and the others wrong.
- **Introductions.** Types are introduced one at a time, at a wave beat. The
  first time one appears, a one-line bestiary card shows up, for example:
  *"Brute — armoured. Big hits beat many small ones."*
- **Elites (Region 2 onward).** An elite is a regular enemy with one aura. Reuse
  the current five: haste, regen, shield, split and vengeful. Elites have ×8 HP
  and drop a burst of shards plus a chance at a relic.
- **Bosses.** Each boss has 2–3 phases, with one readable pattern per phase, and
  an intro and outro ceremony (reuse the current boss intro). A boss's first
  kill is its region's biggest moment (§7.3).
- The full roster is in §11.1.

### 4.4 The tower: frame, weapons, passives

- **Frame.** The tower's chassis, chosen before a run. Act 1 has 4 frames, with
  one available at the start. A frame sets the starting weapon, one quirk and
  the ultimate. Frames replace cores.
- **Weapons.** You get 1 slot at the start, rising to 4 through the Forge. Act 1
  has 8 weapons, each with a different *pattern*: homing bolts, a cone, a chain,
  a pulse aura, lobbed AoE, a beam, orbiting blades and drones.
  - Each weapon has in-run levels 1–5. Every level is either a visible step
    (+1 projectile, +1 bounce, a bigger radius) or at least +25% damage.
  - **Each equipped weapon is drawn on the tower sprite.**
- **Passives.** You get 2 slots at the start, rising to 4. Act 1 has 12
  passives (§11.3), each with levels 1–5.
- **Evolutions.** When a weapon reaches level 5 *and* you own its paired
  passive, the next level-up offers the evolution: a new pattern and a big power
  spike. Act 1 has 8 recipes. They stay hidden until discovered and are then
  recorded in the Recipe Book. This is the main discovery hook inside a run.
- **Ultimate.** Each frame has its own ultimate, charged by kills (roughly every
  30–45 s). Tap to fire it, or unlock auto-cast in the Forge. It is the only
  active button in a run.
- **Defence.** Only a few stats: Max HP, Regen and Armour (a flat reduction).
  Keystone nodes add a few defensive mechanics on top, such as thorns and a
  revive.

### 4.5 The level-up draft

- **XP and level-ups.** Kills drop XP, which is collected automatically, so
  there is no pickup micro-management. Each level-up offers **3 cards** (4 with
  a Forge node). A card is one of: a new weapon, a weapon or passive level, or
  an evolution. Once every slot is full and maxed, fallback cards appear (heal
  30%, or bonus shards).
- **Rerolls and banishes** come from the Forge. You start with none.
- **The card pool grows as you unlock things.** A weapon appears in drafts only
  after it is unlocked in the Forge or the Collection. A "NEW" stamp marks the
  first time you see each card.
- **The game never waits for the player:**
  - During a draft the arena keeps running at 15% speed, with a 10 s timer. When
    the timer runs out, the highlighted *suggested* card is taken.
  - The very first draft of the game is the only one that pauses completely,
    because it's teaching the mechanic.
  - The Forge's Tactician nodes upgrade the suggestion into a priority list the
    player writes (§6.2).
- **The draft *is* the in-run economy. There is no gold.**
  - A gold shop in the style of *The Tower* was considered and rejected. It
    would duplicate the Forge as a second, weaker "buy the cheapest DPS" layer,
    while the draft gives every run a different shape.
  - See §16, D2.

**Level curve target:**

- Level-ups come every 15–25 s early in a run and every 30–40 s later on.
- When a run reaches the frontier boss in late Act 1, a typical build has 3 of 4
  weapons at level 4–5 and about one evolution.
- Builds are deliberately partial at the frontier. That keeps the choices
  meaningful.

### 4.6 Death and results

- **The fall.** When the tower falls there is 0.5 s of slow motion, the tower
  cracks, and the run's shards fly up to the counter. There's no failure
  language, just: *"The light recedes. Wave 14."*
- **The results screen** is a single screen, with no scrolling on mobile. It
  shows:
  - waves reached, kills, and shards earned (tap for a breakdown)
  - **NEW RECORD** callouts
  - anything discovered this run: enemy, card, recipe or relic icons with NEW
    stamps
  - one **Next:** line with a progress bar toward the nearest affordable Forge
    node or unrevealed goal
- **Buttons:** **Forge** and **Run again**. Once auto-restart is owned, Run
  again fires automatically after 5 s.

---

## 5. Between runs

### 5.1 The Forge (the one meta tree)

**Layout.** A radial web around a tower glyph, in five branches:

- **Might** (offence)
- **Bulwark** (defence)
- **Fortune** (shards and XP)
- **Arsenal** (weapons, slots and draft control)
- **Engineering** (speed, automation and offline)

Act 1 has about 120 nodes. Act 2 adds mastery nodes (§9).

**Fog of war.** Only nodes adjacent to ones you own show their effect. The ring
beyond shows silhouettes ("?") in their branch's colour and node type.

**Sealed nodes.** Some nodes stay **sealed** until a given region's boss falls,
for example *"Sealed — defeat the Bog Mother"*. This ties map progress to tree
progress, so each boss opens a new ring.

**Node types:**

- **Minor** (at most 60% of nodes). A stat with 1–5 levels and small cost
  growth, for example *Damage +15%*.
- **Notable.** A qualitative change. Examples: *Scattershot joins the draft*,
  *+1 weapon slot*, *Start runs at level 3*, *Card choices +1*, *Overkill
  carries to the next target*.
- **Keystone.** One per branch per act (Engineering has none). It defines a
  build and comes with a trade-off. Examples: *Glass Cannon* (×1.8 damage, Max
  HP halved), *Fortress* (attack speed −30%, Max HP ×2, thorns ×3), *Hoarder*
  (shards ×2, one fewer card choice).

**Costs.**

- Each ring's base cost is about ×4 the previous ring's: ring 1 costs 10–25
  shards, and ring 6 about 10k.
- Each extra level of a multi-level minor costs ×1.6 the previous one.
- These are starting values; the pacing tool sets the final ones (§13).

**Buying and refunds.**

- Nodes can be bought at any time. They take effect at the next run start, and
  carry an "applies next run" tag while a run is live.
- Between runs, notables and keystones can be refunded for free, which
  encourages experimenting.
- Minors are never refunded, so the web keeps a stable shape.

**Tower sprite.** Completing a ring raises the tower sprite's tier. Reuse the
renderer's tiered tower drawing for this.

§11.4 lists sample nodes for each branch.

### 5.2 The Map

- **Six regions** on a stylised map. The Blight retreats as each boss falls.
- **Each region card shows:** best wave, the boss trophy (with the fastest
  kill), enemies discovered (x/3), relics found (x/4) and a reminder of the
  region's rule.
- **Any unlocked region can be run.** Pushing the frontier pays best (§8.3).
  Older regions are safer for idle farming and for hunting their relics.
- **The next region is visible** as a dark silhouette with its boss's shadow, so
  the next goal is always on screen.

### 5.3 Collection (one tab, four pages)

- **Bestiary.** Every enemy and boss, revealed on first sight. Each entry has
  its one-line verb, a kill count and a line of lore.
- **Relics.** Act 1 has 24 relics, 4 per region: the boss's first-kill relic
  plus three that elites drop from that region's pool.
  - Effects are qualitative (§11.5).
  - You equip 1–5 of them; slots come from bosses.
  - Duplicate drops raise a relic's rank (I → III). There's no separate
    currency for this.
  - Undiscovered relics show as a silhouette naming the region they drop in.
- **Recipes.** Evolution recipes appear as "??? + ???" until discovered. After
  enough runs using one half of a recipe, a hint appears.
- **Frames.** All four frames, with their unlock conditions.

### 5.4 Feats

- **One finite list.** Feats replace achievements, contracts and the Long Watch.
  Act 1 has about 40.
- **Each feat pays shards once.** Each one is written to point at something
  worth discovering, for example *"Evolve any weapon"*, *"Defeat the Gatekeeper
  without dropping below half HP"*, *"Clear the Mire using only close-range
  weapons"*.
- **3–5 feats are secret.** They show as "???" with a riddle, and pay out a
  unique relic or frame.
- **The Feats tab appears after the first boss**, with a batch of feats already
  earned. That delivers a burst of rewards at the moment it lands best.

---

## 6. Idle

### 6.1 The game never waits

- Drafts resolve on their own (§4.5).
- Ultimates cast themselves once auto-cast is owned (Engineering).
- The results screen moves on by itself once auto-restart is owned.
- The only time the game stops for the player is at a run's end before
  auto-restart (~20 min into play). At that point the player is still active
  anyway.
- **Absence:** on `visibilitychange` (hidden) or a Capacitor pause event, record
  a timestamp. On return, any absence over 60 s goes through the offline
  calculation (§6.3). The simulation is never fast-forwarded to catch up.

### 6.2 Automation unlocks (Engineering branch), in reveal order

| Node | Around | Does |
|---|---|---|
| Game speed ×2 | ~12 min | Toggles between 1× and 2× |
| Auto-restart | ~20 min | Starts the next run 5 s after the results screen, in the same region |
| Offline I | First boss (~30 min) | 25% efficiency, 2 h cap |
| Tactician I | ~40 min | The draft suggestion follows a priority list you edit (drag weapons and passives into order) |
| Auto-ultimate | Region 2 | Casts when N enemies are in range, or when a boss is present |
| Offline II–IV | Region 2–5 | Efficiency rises to 75% and the cap to 12 h |
| Game speed ×3 | Region 3 | Adds a 3× setting |
| Frontier march | Region 3 | After a new boss kill, auto-restart moves to the new frontier region |
| Tactician II | Region 4 | A separate priority list per frame |

### 6.3 Offline progress

- **Earnings:** recent farm rate × time away × efficiency, up to the cap.
- **Farm rate:** the median shards per minute over the last 5 completed runs of
  at least 60 s, stored in the profile.
- **Offline pays shards only.** There's no simulated offline combat, and no
  bosses, relics or feat progress. It's simple and honest, and it can't break.
- **Welcome-back modal:** shows the time away, the shards earned, and **which
  Forge nodes are now affordable** (tap to jump to the Forge).

### 6.4 Idle vs. active

Active play has real but bounded advantages: better builds from manual picks,
ultimate timing, and choosing when to push the frontier.

- **Target:** at the same Forge state, an active player earns about 1.3× the
  shards per hour of an idle one.
- **Bosses:** an idle setup (auto-pick plus frontier march) can still clear a
  boss once it has about 20–30% more power than an active player needs.

---

## 7. Progression and pacing

### 7.1 Reveal table (Act 1, active player)

Times are targets. The bot validates them (§13).

| Time | Trigger | Revealed |
|---|---|---|
| 0:00 | Start | Arena, tower (Arcanist frame, Arcane Bolt), HP bar, wave x/20, XP bar |
| ~0:15 | First level-up | The draft (the only time it pauses): Arcane Bolt L2 / Power / Fortify |
| ~0:45 | Wave 3 | Runner, with the first bestiary card |
| ~1:30 | Wave 5 | Brute |
| ~2:00 | First death | Results screen, shards counter, **Forge** with 3 visible nodes |
| 2–10 min | Runs 2–4 | Ring 1 minors in Might, Bulwark and Fortune; the notable *Scattershot joins the draft + weapon slot 2* (about run 3) |
| ~8 min | Wave 10 | First elite (the mini-boss beat) |
| ~12 min | Engineering revealed | Game speed ×2 |
| 15–20 min | Ring 1 complete | Tower sprite tier 2; auto-restart; Chain Lightning notable; **Bestiary** tab (after 3+ enemy types seen) |
| 20–25 min | Wave 20 first reached | **Boss 1 intro.** The first attempt usually fails: you see the boss before you can beat it |
| ~30 min | Boss 1 falls | **Map** reveal and Region 2; first relic and relic slot; **Feats** (5 already earned); Offline I; ring 2 unsealed |
| 30–60 min | Region 2 | Splitter, Spitter and Mender; elites with auras; Tactician I; Frost Ring and Mortar notables |
| 60–75 min | Boss 2 | Frame #2 (Bastion); relic slot 2; **Frames** page |
| 1.5–2 h | Organic | First evolution discovered → **Recipes** page |
| 2–3 h | Region 3 | Sunlance and Glaives; keystones become visible |
| 3–5 h | Region 4 | Frame #3 (Stormcaller); weapon slot 4 |
| 5–7 h | Region 5 | Drones; relic slot 4; secret feats surface |
| 7–10 h | Region 6 → final boss | **Act 1 ending**; **Pacts** and the **Starlight** tree |

### 7.2 Cadence targets

- **First moments:** first kill within 3 s, first level-up within 20 s, first
  death after 1.5–3 min at wave 5–8.
- **Run length in Act 1:** 2–4 min early on; 6–12 min at the frontier; 8–20 min
  for overtime farming runs.
- **Reveals:** a reveal is a row in §7.1, or a new enemy, card, relic, recipe,
  frame or region. There should be at least one every 10 min for the first 2 h,
  and at least one per 30-minute session through the rest of Act 1.
- **Bosses:** 1–3 runs from first sighting a boss to first killing it.
- **Forge purchases:** a median of 2–4 per run (R5).

### 7.3 Ceremony

- **Boss kill.** Slow motion on the killing blow, a shatter and a big shard
  fountain, then a **REGION CLEARED** banner. The map cutscene follows: the
  light spreads, the next region's silhouette resolves, and the rewards stack in
  one at a time (relic, frame, sealed ring). About 6 s in total, and skippable.
- **Records.** The results screen shows **NEW RECORD** with the old value struck
  through.
- **Unlock toasts are rare on purpose** (at most one a minute), so each one
  lands.

### 7.4 Session goals

The hub always shows one **Next goal** line, chosen in this order:

1. an affordable Forge node
2. a boss not yet killed in the frontier region
3. the closest incomplete feat
4. an undiscovered relic in a region already cleared

---

## 8. Numbers

### 8.1 Currencies

| Currency | Scope | Earned from | Spent on |
|---|---|---|---|
| XP | Run | Kills, wave clears | Level-ups (drafts) |
| Shards | Meta | Kills, wave clears, elites, bosses (first kill ×5), feats, offline | Forge |
| Starlight (Act 2) | Meta | New heat records per region, Abyss depth records | Constellations |

### 8.2 The two-axis difficulty model

This is the core balance idea, and it's what the current game lacks.

- **Within a region, in-run growth answers the ramp.**
  - Enemy HP grows about ×1.17 per wave (about ×20 from wave 1 to wave 20), and
    enemy counts grow too.
  - The drafted build takes DPS up by about ×20–40, from level 1 to a full
    build.
  - A run survives the region only if its build keeps pace with the ramp, so
    the draft matters in every run.
- **Between regions, meta growth answers the step.**
  - Region *k*'s wave-1 enemies have about ×4 the HP of region *k−1*'s, so
    Region 6 is roughly ×1000 Region 1.
  - Over Act 1, the Forge, relics and frames supply about ×1000–3000.
  - Head-start nodes (a higher starting level, a higher starting weapon level)
    shorten the weak opening of each run.
- **Boss HP** is set to about 25–35 s of the DPS expected at the frontier by
  wave 20. It's tunable per boss.
- **Overtime:** HP grows ×1.25 per wave and shards ×1.12 per wave, with no cap.
  This is the only open-ended curve in a normal run, and nothing authored
  depends on it.
- **Displayed numbers** stay at or below about 10⁶ through Act 1, so K and M
  suffixes cover them. Big-number formatting only matters in Act 2 and the
  Abyss.

### 8.3 Rewards

- **Shards per kill** = the region's base rate × the enemy's weight. The base
  rate rises about ×3.5 per region, which is below the ×4 HP step. An older
  region is therefore safer but slower, and pushing is always the efficient
  play.
- **Bonuses:** each wave clear pays a bonus. Elites pay ×10, bosses ×50, and a
  boss's first kill ×250.
- **Forge ring costs** rise about ×4 per ring, in line with reward growth, so
  each region roughly pays for one ring.

### 8.4 Invariants (asserted by the pacing tool, §13)

- **I1.** With a fresh profile and the active bot, boss 1 dies within [20, 40]
  min and the Act 1 final boss within [7, 12] h.
- **I2.** With the idle bot (two check-ins a day, everything automated), Act 1
  takes [5, 10] days.
- **I3.** Every Act 1 results screen shows at least one affordable node, or at
  least 50% progress toward one (R5).
- **I4.** No weapon is picked in more than 40% of the bot's optimal drafts across
  all regions, and every weapon is part of at least one region's best build.
- **I5.** Active shards per hour divided by idle shards per hour falls within
  [1.15, 1.5].
- **I6.** No gap between reveals is longer than 10 min during the first 2 h.

---

## 9. Act 2 and the long tail

- **Pacts (heat).** After the final boss, 8 pacts unlock, each with 3–5 ranks
  that make runs harder:
  - *Hordes:* +30% enemies per rank
  - *Vigour:* +enemy HP
  - *Haste:* +enemy speed
  - *Elites:* more elites
  - *Frailty:* −Max HP
  - *Scarcity:* −1 card choice
  - *Tyranny:* bosses gain a phase
  - *Blight Surge:* the region rule is doubled

  Heat is the sum of the ranks. Shards are multiplied by (1 + 0.1 × heat).
  Clearing a region at a new heat record pays **Starlight**, once per region
  per heat level. Players choose their own difficulty (the *Hades* model)
  instead of the game inflating one exponent.
- **Constellations (the Starlight tree).** About 40 nodes of large qualitative
  unlocks:
  - 4 new weapons and their evolutions
  - 2 new frames
  - a 5th weapon slot
  - 12 new relics
  - the Forge mastery nodes
- **Forge mastery.** The end of each branch gets one node with unlimited levels:
  +3% per level, with each level costing ×1.3 more. This is the idle-forever
  sink. It is never the path to an authored goal.
- **The Abyss.** An endless descent. Each floor is 10 waves drawn from a mix of
  regions, followed by an elite boss. Floor records pay Starlight on a log
  curve. It's the only endless mode, and the only place big numbers live.
- **Considered and rejected for Act 2:** a classic prestige that wipes the Forge
  in exchange for a multiplier.
  - It would undo the discovery the Forge is built on.
  - Pacts already give the "start again harder, earn more" loop without the
    wipe.
  - Revisit only if the Act 2 playtests show the tail is flat (§16, D5).

---

## 10. Presentation

### 10.1 Screens

**Battle** (portrait, 375×812 baseline):

```
┌─────────────────────────────────┐
│ ████████░░ 84/100     Wave 7/20 │  HP · wave
│ Ashen Fields           ◆ 1,240  │  region · shards
│                                 │
│             (arena)             │
│                                 │
│ ▓▓▓▓▓▓▓▓░░░░░░░  Lv 6           │  XP
│ [❚❚] [2×]           (ULT 78%)   │  pause · speed · ultimate
└─────────────────────────────────┘
```

- **Desktop:** the same arena. The hub docks on the right between runs and
  collapses during a run.
- **Hub** (between runs, or opened during one): bottom tabs appear as they
  unlock, in the order Forge → Map → Collection → Feats. Settings sit behind a
  gear icon. A large **Run** button is always visible.
- **Draft:** three tall cards. Each card has an icon, a name, a single line of
  text with the key number highlighted, and level pips. New cards carry a NEW
  stamp, and evolution cards glow. Tap to pick; long-press for details.

### 10.2 Information rules

- **Only show readouts the player can act on.** The HUD has no kills counter and
  no DPS meter. Those numbers live in the results breakdown and on a Stats page
  under settings.
- **Damage numbers:** only crits and big hits, aggregated per target (reuse
  `damageTier`).
- **Card and node text:** effect first, number highlighted, 15 words at most
  (R4). A before→after value appears only as the highlighted number.

### 10.3 Juice

- **Hits and kills:** a hit flash and knockback on impact, and a pop on crits.
- **Bosses:** a brief hit-stop on each phase change, plus the existing intro and
  outro.
- **Level-ups:** a radial flash, with the cards flipping in.
- **Evolutions:** a 1 s spotlight on the tower while the weapon transforms.
- **Meta screens:** the light spreading across the map; a ripple running along
  the Forge web on each purchase; the tower sprite tiering up.
- **Screen shake:** small, and can be turned off.

### 10.4 Audio

Port the Web Audio synth, with a new cue list:

- **Combat:** a shot sound per weapon (quiet and pitch-varied), hit, crit, kill,
  elite spawn.
- **Tower:** tower hurt, tower fall.
- **Progression:** level-up, card pick, evolution, node purchase,
  reveal/unlock.
- **Bosses:** boss intro, boss kill.

Master, music and SFX volumes are adjustable.

### 10.5 Art

- **Keep the arcane-siege palette and the token rules.** Colour meanings stay the
  same: amber is the player's, violet is arcane, red is for enemies only, and
  scarlet means the tower is in danger.
- **Weapons:** each gets a distinct projectile silhouette and colour within its
  colour family.
- **Regions:** each gets a ground tint and one ambient particle.

---

## 11. Content budget (Act 1)

Every entry is a starting design; the region rules in particular are candidates
for P7. Each entry has to pass R1, R4 and R8.

### 11.1 Regions, enemies, bosses

| # | Region | Enemies (verb → answer) | Rule (candidate) | Boss | First kill unlocks |
|---|---|---|---|---|---|
| 1 | Ashen Fields | **Grunt** (baseline) · **Runner** (fast, comes in packs → rate or AoE) · **Brute** (armour → big hits) | None | **Gatekeeper.** Ground slams send out shockwave rings; summons Grunt packs at 66% and 33% HP | Map, Region 2, relic slot 1, Offline I, Forge ring 2 |
| 2 | Drowned Mire | **Splitter** (splits in three → AoE after the split) · **Spitter** (stops at range and lobs shots → range or priority) · **Mender** (heals nearby enemies → burst or priority) | Mist: −15% range | **Bog Mother.** Submerges (untargetable for 3 s), spawns clutches of Splitters, is healed by Menders | Bastion frame, relic slot 2, ring 3 |
| 3 | Glass Wastes | **Shieldbearer** (a frontal shield blocks projectiles → chain, aura, orbit or mortar) · **Burrower** (underground until close → close-range) · **Shardling** (bursts into shards on death that hit the tower if close → kill at range) | Brittle: area damage +25% | **The Prism.** Rotating mirrored facets bounce shots back; beams and AoE get through | Weapon slot 3, ring 4 |
| 4 | Ember Rift | **Bomber** (explodes on death → kill it far away) · **Blinker** (teleports inward → slow or burst) · **Siege Engine** (stops outside range and bombards → range or drones) | Cinders: kills leave burning ground | **Forgeheart.** Armour plates break off each phase; leaves molten pools | Stormcaller frame, relic slot 3, ring 5 |
| 5 | The Hollow | **Phantom** (phases out on a cycle → burst inside the windows) · **Leech** (drains ultimate charge on contact → kill it before contact) · **Summoner** (spawns imps until killed → priority) | Echoes: 10% of kills rise once as shades | **Hollow King.** Splits into three shades that share one HP pool; only the crowned one takes full damage | Weapon slot 4, relic slot 4, ring 6 |
| 6 | Blight Heart | **Harbinger** (silences one weapon for 4 s with a beam → burst or priority) · **Chorus** (three bodies, one HP pool → AoE) · earlier types as elites | Blight: every wave has an elite | **The Blight.** Four phases echoing bosses 1–4, then a final heart phase | Act 1 ending, Pacts, Starlight, relic slot 5 |

Where possible, reuse the current enemy art and behaviours: grunt/normal,
fast, tank, splitter, healer, shielded, siege, blinker, burrower, harbinger,
chorus and leech.

### 11.2 Weapons and evolutions

| Weapon | Pattern | Strong against | Levels 2–5 | Evolution (+ passive) | Unlock |
|---|---|---|---|---|---|
| Arcane Bolt | Homing bolt | Generalist | +1 bolt · +30% · pierce 1 · +1 bolt | **Seeker Swarm** (+Precision): crits split into 2 seekers | Arcanist start |
| Scattershot | 5-pellet cone with knockback | Packs, Runners | +2 pellets · +30% · stronger knockback · +2 pellets | **Dragonbreath** (+Power): pellets ignite, and the burn spreads on death | Forge ring 1 |
| Chain Lightning | Arcs across 3 targets | Groups, Chorus | +1 jump · +30% · +1 jump · 0.2 s stun | **Storm Crown** (+Haste): 3 permanent orbiting storms | Forge ring 1–2 |
| Frost Ring | Pulses around the tower and slows | Runners, Blinkers, Burrowers | Bigger radius · stronger slow · +30% · faster pulse | **Absolute Zero** (+Bulwark): freezes; frozen enemies shatter in AoE | Forge ring 2 |
| Mortar | Lobbed AoE at the densest cluster | Swarms, Splitters, Shieldbearers | Bigger radius · +30% · +1 shell · cluster bombs | **Meteorfall** (+Area): meteors every 3 s leave burning ground | Forge ring 2 |
| Sunlance | Beam that ramps up on one target | Brutes, bosses | Faster ramp · +30% · the beam pierces · higher ramp cap | **Judgment** (+Focus): at full ramp the beam splits across 3 targets | Forge ring 3 |
| Glaives | Blades orbiting the tower | Burrowers, Leeches, anything that reaches the wall | +1 blade · +30% · bigger radius · +1 blade | **Halo** (+Reach): the ring sweeps out through the whole range and back | Forge ring 3 |
| Sentinel Drones | Drones that hunt and fire | Siege Engines, Shieldbearers (flanking), Phantoms | +1 drone · +30% · faster fire · +1 drone | **Hive** (+Insight): kills spawn temporary drones | Forgeheart / Artificer |

Weapons whose count grows (bolts, drones, blades) have a hard cap. Anything
past the cap converts into damage, which keeps late builds at 60 fps (§12.5).

### 11.3 Passives

Each passive has 5 levels.

| Passive | Per level | Evolution partner |
|---|---|---|
| Power | +15% damage | Dragonbreath |
| Haste | +12% attack speed | Storm Crown |
| Precision | +5% crit chance, +20% crit damage | Seeker Swarm |
| Area | +15% area | Meteorfall |
| Reach | +10% range | Halo |
| Focus | +20% duration and beam ramp | Judgment |
| Bulwark | +2 armour | Absolute Zero |
| Insight | +15% XP | Hive |
| Velocity | +20% projectile speed; +1 pierce at L5 | (Act 2) |
| Fortify | +20% Max HP | (Act 2) |
| Mending | +1% Max HP per second as regen | (Act 2) |
| Greed | +15% shards | (Act 2) |

### 11.4 Forge: sample nodes

Legend: **N** = notable, **K** = keystone, and (×n) = the number of levels.

- **Might.**
  - Minors: Damage +15% (×5) · Attack speed +8% (×5) · Crit chance +3% (×5)
  - **N** *Opening Salvo*: the starting weapon begins at L2
  - **N** *Overkill*: excess damage carries to the nearest enemy
  - **N** *Executioner*: enemies under 10% HP die on hit
  - **K** *Glass Cannon*: ×1.8 damage, Max HP halved, no regen
- **Bulwark.**
  - Minors: Max HP +20% (×5) · Regen +0.5%/s (×5) · Armour +2 (×5)
  - **N** *Second Wind*: revive once per run at 50% HP
  - **N** *Thorns*: enemies that hit the tower take 50% of the damage back
  - **N** *Last Stand*: +40% attack speed below 30% HP
  - **K** *Fortress*: attack speed −30%, Max HP ×2, thorns ×3
- **Fortune.**
  - Minors: Shards +10% (×5) · XP +10% (×5)
  - **N** *Head Start*: start runs at level 3
  - **N** *Bounty*: elites drop ×3 shards
  - **N** *Choice*: +1 card per draft
  - **N** *Reroll* (×3) · **N** *Banish* (×3)
  - **K** *Hoarder*: shards ×2, one fewer card choice
- **Arsenal.**
  - **N** *\<Weapon\> joins the draft* (one per weapon)
  - **N** Weapon slot +1 (×3, spread across rings; some sealed)
  - **N** Passive slot +1 (×2)
  - **N** *Evolution Insight*: undiscovered recipes reveal their weapon half
  - **N** *Twin Mount*: start runs with a second random weapon
  - **K** *Specialist*: one weapon slot only, but that weapon does ×3 damage
    and evolves at L3
- **Engineering.**
  - Speed ×2 and ×3 · Auto-restart · Tactician I–II · Auto-ultimate
  - Offline efficiency I–IV · Offline cap I–IV · Frontier march
  - Ultimate charge +15% (×3)
  - No keystone

### 11.5 Relics (sample; 24 in Act 1)

The rule for every relic: qualitative, 15 words or fewer, and interacting with
a weapon family or a region's verb.

| Relic | Source | Effect |
|---|---|---|
| Gatekeeper's Seal | Gatekeeper (first kill) | Start every run with one extra level-up |
| Tallow Candle | Ashen Fields elite | Waves 1–5 play out 50% faster |
| Cracked Lens | Ashen Fields elite | Crits deal +100% damage; crit chance −5% |
| Hunter's Tally | Ashen Fields elite | +5% damage per 100 kills this run |
| Mother's Tear | Bog Mother (first kill) | Regen is doubled while no enemy is within half range |
| Bog Lantern | Drowned Mire elite | Enemies killed by AoE drop double XP |
| Prism Heart | The Prism (first kill) | 20% of projectiles refract into a second target |
| Frost Brand | Glass Wastes elite | Slowed enemies take +25% damage |
| Forgeheart Core | Forgeheart (first kill) | Every 10 s, each weapon's next shot deals ×5 |
| Hollow Crown | Hollow King (first kill) | Once per wave, a slain elite fights for you for 10 s |

The remaining 14 are designed in P4 and P7.

### 11.6 Frames

| Frame | Starting weapon | Quirk | Ultimate | Unlock |
|---|---|---|---|---|
| Arcanist | Arcane Bolt | +10% XP | **Nova**: a 360° burst for 600% damage, with knockback | Start |
| Bastion | Frost Ring | +50% Max HP, −15% attack speed | **Aegis**: 5 s of invulnerability; contact damage is reflected | Bog Mother |
| Stormcaller | Chain Lightning | Crits chain to one extra target | **Tempest**: a 6 s storm striking random enemies | Forgeheart |
| Artificer | Sentinel Drones | +1 weapon slot, −1 passive slot | **Overclock**: all weapons fire ×2 as fast for 6 s | Secret feat *Tinkerer* (its riddle appears in Feats after Region 4) |

### 11.7 Feats (sample; about 40 in Act 1)

- **Regular:** Defeat the Gatekeeper · Evolve any weapon · Reach level 20 in one
  run · Take no damage in waves 1–10 · Kill 10,000 enemies · Discover every
  enemy in the Mire · Clear a region with a single weapon · Beat a boss within
  20 s of its intro · Own every Arsenal notable.
- **Secret (shown as "???" with a riddle):** *"Four hands, no heart"* (clear a
  region with 4 level-5 weapons and no passives) → Artificer. More are designed
  in P7.

### 11.8 Totals

| | Act 1 | Act 2 adds |
|---|---:|---:|
| Regions | 6 | the Abyss |
| Enemy types | 18 | +4 |
| Bosses | 6 | +2 |
| Weapons / evolutions | 8 / 8 | +4 / +4 |
| Passives | 12 | +2 |
| Frames | 4 | +2 |
| Forge nodes | ~120 | +5 mastery |
| Constellation nodes | none | ~40 |
| Relics | 24 | +12 |
| Feats | ~40 | +20 |
| Pacts | none | 8 |
| Meta currencies | 1 (Shards) | +1 (Starlight) |

---

## 12. Technical plan

### 12.1 Rewrite, don't refactor

**Why:**

- `Game.ts` (6.2k lines) and `Renderer.ts` (6.1k) encode the old design all the
  way through.
- `src/stats/` has 13 contributors, mostly for systems being removed.
- The save format carries a v1→v25 migration ladder for fields that will no
  longer exist.
- About 70k lines of `src/`, 9k lines of `docs/`, 11k lines of `plans/` and 37
  test files all describe the old game.

Removing about 20 systems one at a time, each behind its own impact analysis,
would take longer than building the smaller game. It would also leave their
shape behind in whatever remained.

**Approach:**

1. Tag `main` as `legacy-final` and branch `rebuild`.
2. Move the old `src/`, `sim/`, `tests/` and `docs/` into `legacy/`. Exclude it
   from tsconfig, Vite and Vitest, and keep it as a porting reference.
3. Delete `legacy/` in P9.

### 12.2 Keep, port, drop

| Area | Current | Verdict |
|---|---|---|
| Storage backends | `src/systems/storage/*` | **Keep** as-is |
| Platform and Android | `src/platform/native.ts`, `capacitor.config.ts`, `android/` | **Keep** |
| Camera | `src/game/Camera.ts`, `src/data/arena.ts` | **Port** (same API, new arena constants) |
| Loop | Fixed-step substepping in `Game.ts` | **Port** into `app/loop.ts` (~100 lines) |
| Effects | `src/systems/EffectsManager.ts` | **Port and trim**: particles, damage numbers, rings, pools |
| Quality tiers | `src/data/quality.ts` and its auto-detect | **Keep** |
| Audio | `src/systems/AudioManager.ts` | **Port** the synth with a new cue map |
| Events | `src/game/EventBus.ts` | **Keep**, with a new event catalogue |
| Icons | `public/icons/sprite.svg`, `scripts/fetch-icons.mjs`, `src/ui/Icon.ts` | **Keep**, with a new manifest |
| Art tokens | `src/styles/tokens.css`, `src/data/palette.ts`, `public/fonts/` | **Keep** |
| Utilities | `math`, `SpatialGrid`, `longPress`, `dom`, `bigNumber` | **Keep** |
| UI primitives | `Modal.ts`, `MobileSheet.ts` | **Port** |
| Renderer | `src/game/Renderer.ts` | **Salvage** into new per-entity painters: tower tiers and turret, enemy silhouettes, portals, projectile trails, boss intro, sprite cache |
| Legacy tests worth keeping | palette, z-index, touch-targets, quality-detect, camera | **Port** |
| Everything else | `Game.ts`, `types.ts`, `stats/`, the rest of `data/`, `systems/` and the `ui/` panels, `main.css`, `sim/`, other tests, `docs/` | **Drop** (kept in `legacy/` for reference until P9) |
| Old plans | `plans/*.md` | Move to `plans/archive/` |
| Leftovers | `.balance-baseline/`, `thoughts/`, `implementation-plan.md`, `badge-check.mjs` | Delete in P0 |

**GitNexus.** The move is a wholesale replacement, so per-symbol impact analysis
on legacy code tells you nothing, and `detect_changes` will show every flow
changing. That's expected. After P0, re-run `node .gitnexus/run.cjs analyze` so
the index describes the new tree. From then on, `CLAUDE.md`'s rules apply to
the new code as normal.

### 12.3 Architecture

```
src/
  app/       main.ts · App.ts (screen state machine: boot → hub ⇄ run → results) · loop.ts
  core/      rng.ts (seeded, splittable) · events.ts · math.ts · spatialGrid.ts · format.ts
  content/   frames · weapons · passives · evolutions · enemies · bosses · regions · waves ·
             forge · relics · feats · pacts · balance.ts (every tunable constant)
  sim/       DOM-free and deterministic: RunState · createRun(config, region, seed) ·
             step(run, dt, input) · systems/{spawn, move, targeting, weapons, projectiles,
             damage, xp, draft, ultimate, boss} · stats.ts
  meta/      profile · forge.ts · collection.ts · feats.ts · offline.ts · automation.ts ·
             runConfig.ts (profile → frozen RunConfig) · save/{schema, migrate, stores}
  render/    camera.ts · renderer.ts · painters/{tower, enemies, projectiles, bosses, fx} ·
             spriteCache.ts · effects.ts · quality.ts
  ui/        hud · draft · results · hub/{forge, map, collection, feats, settings} ·
             modal · sheet · toast · icon
  audio/     synth.ts · cues.ts
tools/
  bot.ts       draft scorer + policies: active, idle (check-in schedule)
  pacing.ts    plays a fresh profile for N hours at max speed → reveal timeline + invariants
  inspect.ts   one seeded run → a per-wave table (DPS, HP pool, clear time, overlap, damage taken)
tests/
```

**Rules:**

- **`sim/` imports only `core/` and `content/`.** No DOM, no `Date.now`, no
  `Math.random`; randomness comes only from the seeded RNG. The same
  `(RunConfig, region, seed, inputs)` always produces the same run. That's what
  lets the balance tool *be* the game, not a model of it: today's `sim/model.ts`
  is a 1.7k-line approximation kept in sync with the game by hand.
- **`render/` reads a `RunState` and never writes to it.** It interpolates
  between sim steps for smooth motion.
- **`meta/` owns the profile.** `buildRunConfig(profile)` resolves the Forge,
  relic and frame effects once per run, into a frozen config that is handed to
  `sim`.
- **Stats are resolved by a small resolver over about 20 keys:** damage, attack
  speed, crit chance and multiplier, area, range, duration, projectile count,
  pierce, Max HP, regen, armour, XP gain, shard gain, and so on. It uses
  additive-then-multiplicative buckets and keeps a breakdown for the long-press
  details. Keep today's accumulator idea; drop the rest of the pipeline.
- **Effects are data**, as a small tagged union:
  - `{kind:'stat', key, add | mult}`
  - `{kind:'unlockCard', id}`
  - `{kind:'slot', slot:'weapon'|'passive', n}`
  - `{kind:'behaviour', id, params}`

  Each kind has an exhaustive consumer switch that ends in `never` (R8).
- **Timing:** a fixed timestep of 1/60 s with substeps (ported from `Game.ts`),
  at speeds of 1×, 2× and 3×. The headless tools step the sim without rendering.

### 12.4 Save

- **New key and format:** `tower-profile`, version 1, stored through the
  existing backends (IndexedDB on the web, Filesystem on Android).
- **Old saves are not migrated** (§16, D3). If an old save is found, copy it to
  a backup key once and start a fresh profile. No player-facing note is needed:
  the game is private.
- **Two parts:** the **profile** holds all meta state. A **run snapshot** (seed,
  wave, build, HP, shards and XP this run) is written at every wave start, so if
  the app is killed on mobile, the run resumes at the last wave boundary.
- **Save triggers:** run end, Forge purchase, every 30 s, and
  `visibilitychange` or a Capacitor pause event.
- **Migration ladder from day one:** ship a skeleton with a v1→v2 test fixture,
  so the first schema change isn't an emergency.

### 12.5 Performance

Keep the current budgets and techniques (see `legacy/docs/performance.md`):

- at most 300 live enemies
- pooled projectiles and particles
- a spatial grid for targeting
- a sprite cache per enemy type and scale
- quality tiers

Weapons whose count scales (bolts, drones, blades) have hard caps, and anything
past a cap converts into damage. Port the existing frame-budget harness as a
test, so multi-weapon builds hold 60 fps on the low quality tier.

### 12.6 Tests

- **Content lint:**
  - Ids are unique.
  - Every card, node and relic has an icon, a name, text of 15 words or fewer,
    and an effect with a consumer.
  - Every region has 3 enemies and a boss.
  - Every evolution's partner passive exists.
  - Every Forge node is reachable from the root.
- **Sim:**
  - Determinism: the same seed gives the same final-state hash.
  - Damage and armour arithmetic.
  - The draft never offers a new item for a slot type that's already full.
  - An evolution is offered if and only if its recipe is satisfied.
  - The wave-overlap rule.
- **Meta:**
  - Forge adjacency, fog and sealing, costs, and refunds.
  - Offline caps and the farm-rate median.
  - Save round-trip and migration.
- **Pacing:** a CI-sized, one-hour active-bot run asserts I3, I6 and the first
  half of I1. The full report runs by hand at each phase gate.

---

## 13. Balancing and validation

- **Pacing report (`npm run pacing`).** Takes a fresh profile and has the active
  bot play 12 simulated hours at maximum speed. It writes:
  - a reveal timeline (CSV)
  - a per-run table (region, wave, duration, shards, nodes bought)
  - pass/fail verdicts for I1–I6

  An idle-bot variant adds a check-in schedule and runs the offline
  calculation between check-ins.
- **Inspect (`npm run inspect -- --region 3 --forge <preset> --seed 7`).** A
  per-wave table showing build DPS against the enemy HP pool, clear time,
  overlap and tower damage taken.
- **The draft scorer** estimates DPS gain, slot fill, recipe completion, and how
  well a card counters the region's rule and enemies. **The same scorer powers
  the in-game suggested card**, so improving the bot improves idle play.
- **Tuning surface.** Every tunable number lives in `content/balance.ts` or in
  per-item data. Nothing tunable lives in `sim/` code.
- **Playtests at the P3, P4, P6 and P7 gates.** Use a fresh profile each time,
  with an observer's notes against five questions:
  1. When did you first feel stronger?
  2. What did you want to do next?
  3. When were you bored or confused?
  4. Did the boss feel fair?
  5. What did you ignore?

  A dev-only event log (reveal timestamps and the run table) can be exported
  from settings and compared with the bot's timeline. Use it to **calibrate the
  bot** against real players.

---

## 14. Phases

Every phase ends in something playable. Don't start the next phase until the
current one passes its gate. Sizes are relative: S, M, L, XL.

### P0: Foundations (S)

- Tag `legacy-final` and branch `rebuild`. Move the old code to `legacy/`,
  archive `plans/`, and delete the leftovers (§12.2).
- Scaffold the §12.3 tree and port the Keep and Port modules. Set up tsconfig,
  Vite and Vitest. Stub the `pacing` and `inspect` scripts, and add the content
  lint harness.
- Build the `App` state machine with placeholder screens: boot → hub → run
  (empty arena) → results.
- Re-index GitNexus, and update `AGENTS.md` and `README.md` to describe the new
  layout.

**Gate:** `npm run build` and `npm test` pass, and the Android debug APK builds
and boots to an empty arena.

### P1: Combat slice (M)

- **sim:** `RunState`; the seeded RNG; Region 1 wave templates for waves 1–19;
  movement; targeting; Arcane Bolt; projectiles; damage and armour; tower HP and
  regen; contact damage; wave flow and the overlap rule; death.
- **render:** the tier 1 tower, 3 enemy types, bolts, hit and death effects, and
  damage numbers (crits only).
- **ui:** the battle HUD (HP, wave, pause) and a bare results screen.
- **tools:** `inspect` prints the per-wave table.

**Gate:**

- First kill within 3 s.
- A level-1 tower with no upgrades dies around wave 4–6.
- 60 fps with 300 enemies on a mid-range Android device.
- The determinism test passes.
- The owner judges whether 60 seconds of this is pleasant to watch.

### P2: The draft (M)

- XP drops and the level curve.
- The draft modal: the 10 s slow-motion timer, the suggestion scorer, and the
  first-draft-only pause.
- Slots.
- Three weapons (Arcane Bolt, Scattershot, Chain Lightning), six passives,
  their level steps and the fallback cards.
- The Arcanist ultimate (Nova) and its button.
- The tower sprite shows its mounted weapons.

**Gate:**

- Two consecutive runs produce visibly different towers.
- With no meta progression, a bot-drafted run reaches about wave 10.
- A draft never blocks the game, apart from the very first one.

### P3: The meta loop (L)

- Shard drops, the shard counter and the full results screen.
- The Forge UI: a web with pan and zoom, fog, node types, costs and the purchase
  ripple.
- About 40 nodes: rings 1–2 of Might, Bulwark, Fortune and Arsenal, plus
  Engineering ring 1 (speed ×2, auto-restart).
- `buildRunConfig`.
- Profile save and load, and run-snapshot resume.
- First-run teaching: the single paused draft, and a highlight the first time
  the Forge opens.
- **tools:** `pacing` with the active bot over one hour, checking I3 and I6.

**Gate:**

- **Playtest #1:** the first 30 minutes on a fresh profile.
- In the pacing report, wave 20 is first reached within 15–30 min.
- Every results screen shows a purchasable node or a progress bar of at least
  50%.

### P4: Bosses, map, collection v1 (L)

- The boss framework: phases, patterns, intro and outro, and the boss bar. Build
  the Gatekeeper.
- **Region 2:** 3 enemy types, the Bog Mother and the region rule.
- Elites and auras; overtime.
- The map screen with the light spread.
- The Bestiary.
- Relics v1 (8 relics, slots 1–2) and Feats v1 (15 feats).
- The Bastion frame.
- Offline I and the welcome-back modal.
- Sealed Forge nodes and the ring 3 nodes.

**Gate:**

- **Playtest #2:** boss 1's first kill lands at 25–40 min and feels like an
  event.
- Region 2 feels different from Region 1: it needs new answers.

### P5: Arsenal depth (M)

- The remaining 5 weapons and 6 passives.
- 8 evolutions, the Recipe Book and its hints.
- A better draft scorer.
- Per-weapon audio and visuals.
- The keystones.
- Count caps that convert into damage (§12.5).
- **tests:** the I4 dominance check across Regions 1–2 (extended in P7).

**Gate:**

- The bot's pick rates show no dominant weapon.
- In playtests, recipes are discovered organically by about the 2-hour mark.

### P6: Idle (M)

- The Tactician priority editor.
- Auto-ultimate, speed ×3, the offline tiers and frontier march.
- Visibility and absence handling, and Android pause and resume.
- The idle bot with its check-in schedule in `pacing`.

**Gate:**

- I2 and I5 hold for Regions 1–2, extrapolated.
- The app can be killed at any moment and resumes within one wave.

### P7: Act 1 content (XL)

- **Regions 3–6:** 12 enemy types, 4 bosses and their rules.
- **Collections:** the remaining relics (up to 24) and feats (up to 40,
  including the secret ones).
- **Frames:** Stormcaller and Artificer.
- **Forge:** grow it to about 120 nodes.
- **Finale:** the final boss and the Act 1 ending sequence.
- **Pacing:** the full report, checking I1–I6.

**Gate:**

- **Playtest #3,** run longitudinally over several days.
- Act 1 can be completed within the target time.
- The reveal cadence holds, with no dead hour.

### P8: Act 2 (L)

- Pacts and the heat UI; Starlight; Constellations.
- Mastery nodes.
- The Abyss, with its bigNumber formatting.
- The Act 2 content.

**Gate:**

- The bot clears heat 1–10 within the target time.
- Abyss numbers scale cleanly up to about 10³⁰.

### P9: Polish and ship (M)

- A juice pass and an audio pass.
- Accessibility: reduced motion, colourblind-safe weapon colours, text size.
- A performance pass on the low quality tier.
- Settings: volume, quality, reset.
- A new `docs/` set, one file per system, following the current docs' style;
  update `AGENTS.md`.
- Delete `legacy/` and re-index GitNexus.
- An Android release build.

**Gate:** every invariant passes, and there's a release APK.

**P1–P4 on their own already make a complete short game** (two regions and a
boss each), so if the schedule has to slip, Act 2 goes first.

---

## 15. Risks

| Risk | Mitigation |
|---|---|
| **Scope.** The rebuild starts the content count from zero. | Every phase is playable, and P1–P4 are a complete short game. Act 2 can slip. |
| **The draft vs. idle play.** A pick-a-card mechanic could block idle players. | The never-block timer and the suggestion scorer ship in P2, not later. The Tactician makes auto-pick as good as the player's own plan. |
| **Bot fidelity.** A bot that plays better or worse than people skews pacing. | Calibrate the bot against the event logs from playtests #1 and #2, and keep the invariant bands wide. |
| **The old pattern comes back.** Tuning pressure tends to add systems. | R1–R8 are the review checklist. Any proposed system has to name its verb and its slot in the reveal table. There's a hard ceiling of three currencies. |
| **Performance with multi-weapon builds.** | Count caps that convert into damage (P5), plus the ported frame-budget harness as a test. |
| **Losing what worked.** | The enemy-verb doctrine, the boss presentation, the art direction and the engine modules are carried over explicitly (§12.2). |
| **Offline over-paying or being exploited.** | Offline uses the median recent farm rate, has a cap, and pays shards only: no bosses and no relics offline. |

---

## 16. Decisions (confirmed)

- **D1: Rewrite.** A fresh `src/` on the `rebuild` branch, porting the leaf
  modules listed in §12.2. The old code lives in `legacy/` until P9.
- **D2: The level-up draft is the only in-run economy. There is no gold.**
  - Chosen for fun: every level-up is a decision that changes what the tower
    does, so runs differ in shape and not just in size. Evolutions give the
    discovery hook, and the draft is what makes the per-region ramp (§8.2) a
    build puzzle rather than a purchase queue.
  - A gold shop alongside it would repeat the old "buy the cheapest DPS"
    loop, duplicate the Forge and break R2.
  - Idle is covered by the never-block timer, the suggestion scorer and the
    Tactician (§4.5, §6.2).
  - **Revisit trigger:** if playtest #1 or #2 shows players wanting something
    to *spend* during long overtime runs, add Forge-side run options first
    (for example a "buy a reroll with shards" notable), not a second currency.
- **D3: No migration.** Old saves are copied to a backup key once and ignored
  (§12.4).
- **D4: Portrait mobile first.** Design and test at 375×812. Desktop uses the
  same portrait arena, centred, with the hub docked to its right (§10.1).
  - Every screen's P-phase gate is checked at 375×812 first.
- **D5: Pacts, Constellations and the Abyss, with no wiping prestige** (§9).
  - **Revisit trigger:** if the Act 2 playtest shows the tail going flat
    (players stop setting heat records), consider an optional "Rekindle"
    prestige. It would reset Forge minors only, keep notables and keystones,
    and pay a permanent Starlight multiplier.
- **D6: Keep "The Tower" and the arcane-siege art direction,** with the new
  Blight/light framing.
  - The game is private and won't be published, so there's no naming, store
    or licensing work to plan for. Keep `ATTRIBUTION.md` for the CC BY icons
    anyway: it's free, and it keeps publishing possible later.
  - The Android release build in P9 is for sideloading onto your own devices;
    there's no store listing work.
