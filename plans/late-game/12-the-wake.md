# 12. The Wake: five regions between the Blight and the Abyss

**Status:** 2026-11-23. Planned, nothing built. Comes out of the "3–4 more
maps before the Abyss" brainstorm. The owner settled the decisions in §0 on
2026-11-23.

**Why:** Act 2 has one way to go, and that way is down. Once the Blight falls,
the player either climbs heat in the six regions they already know or descends
into the Abyss. Neither offers new ground with new rules at the surface. Act 1's
rules also all live in a few places: **range** (Mist), **damage type**
(Brittle), **what a kill leaves** (Cinders, Echoes) and **who shows up**
(Blight). The Abyss strata take **spawn place** (Gates), **walk direction**
(Inversion) and **light** (Narrowing, Lightless). Several places are still
untouched: **tempo**, **how bodies move**, **physics**, **the shape of a wave**
and **priority under a hazard**.

**The idea:** **the Wake** is five surface regions between the Blight and the
Abyss. These are the lands the Blight held, changed by its death. Act 2 opens
when the Blight falls, as it does today, so pacts, heat, Starlight and the
Constellations are all there to help. The **Abyss opens when the Wake's last
boss falls**, so the descent starts from a tower that has learned five new
rules. Each region takes one untouched place and builds a rule, three natives,
an elite aura, a boss, three Trials and four relics around it. Each rule also
favours a different family of weapons, so the Wake rewards a build that adapts
instead of one build that wins everywhere.

| # | Region | Rule (≤ 15 words, R4) | Place it takes | Favours | Strains |
|---|---|---|---|---|---|
| 9 | **The Bell Marches** | *Toll*: bodies move only when the bell tolls. | tempo | Mortar, traps, stationary-crowd weapons | weapons that want a steady stream |
| 10 | **The Orrery** | *Orbit*: nothing walks straight here; everything spirals in. | how bodies move | Glaives, Frost Ring, anything that holds ground | Sunlance, shots that lead |
| 11 | **The Frozen Sea** | *Glide*: knocked-back bodies slide on the ice and bowl over others. | physics | Scattershot, knockback, Mortar | builds with no push |
| 12 | **Giants' Rest** | *Giants*: half the bodies, each three times the size. | wave shape | Sunlance, single-target, crits | Chain Lightning, Mortar, splash |
| 13 | **Stormcrown** | *Storm*: lightning strikes the toughest body, unless a Conductor stands. | priority under a hazard | target priority, the Tactician | builds that can't pick a target |

**Why this order:**
- **The Bell Marches opens the Wake.** Its rule is the easiest to read
  ("they stop, then lurch"), and it's the cheapest to build, so it proves the
  plumbing (§6).
- **Stormcrown closes it.** Its rule asks the most of the player: a hazard
  that helps you until a native turns it against you. That makes it the right
  last lesson before the Abyss.

---

## 0. Decisions

All settled by the owner on 2026-11-23.

| # | Question | Decision |
|---|---|---|
| D-1 | Where do the regions sit? | **After the Blight, and they gate the Abyss.** The Abyss opens when Stormcrown's Thunderhead first falls. Boss Rush still opens on the Deepwarden, so it moves back with the Abyss. Act 1's ending and I1–I6 stay as they are. |
| D-2 | What indices? | **9–13.** `ABYSS_INDEX` (7) and `RUSH_INDEX` (8) stay as they are. The profile keys region records by index string, so there's no renumbering. The Map's order comes from `after`, not the index (§4.1). |
| D-3 | What opens when the Blight falls? | **Act 2, as today:** pacts, heat, Starlight, the Constellations and the Bell Marches. Only the Abyss (and so Boss Rush) waits for the Thunderhead. Each later Wake region opens when the previous region's boss falls. |
| D-4 | Pacts and Trials there? | **Both.** These are regions: `pastRegions` stays false, heat records apply, and each region has three Trials (§4.4). |
| D-5 | Starlight | **Heat records in the Wake pay ×0.5** (`BALANCE.wake.heatStarlight`), and **each Wake boss's first fall pays a lump of 25** (125 in all). |
| D-6 | HP and pay curve | **Flat, like Blight Heart.** The difficulty is the rule, not the numbers. Start at `hpBase` 2300–2600 with `hpGrowth` 1.17, and pay between the Blight Heart and ×1.3 of it, tuned with the Act 2 bot (§8). |
| D-7 | How many regions? | **Five:** the four from the brainstorm plus the Bell Marches. |
| D-8 | Frontier March | **It marches into the Wake.** After each Wake boss's first fall, `marchOn` moves the next run to the newest Wake region. Once the Thunderhead falls, the march ends at Stormcrown. It never moves a run into the Abyss, as today. |
| D-9 | Plan (monetization) | **Paid**, with no new code: `regionPaid(i)` is `i > 3`. |
| D-10 | Names | **Kept:** the Wake, the Bell Marches, the Orrery, the Frozen Sea, Giants' Rest, Stormcrown. |
| D-11 | Saves that already have the Abyss open | **Not an issue:** no released save has reached Act 2, so there's no grandfathering and no migration step. |
| D-12 | What ships in the first build? | **Everything:** the five regions, their Trials (§4.4), their relics (§4.5), and the Wake in the Daily Omen and Contracts (§4.6). The build order (§6) still lands one region at a time. |

---

## 1. Where things stand

- `content/regions.ts`: six `RegionDef`s with indices 1–6. Each has a pool of
  three, beats at 5/10/15, a `rule` and a `surge`, plus `elites.auras` with
  one aura of its own (N3).
- `content/types.ts:774`: `RegionRule` is a closed union of `stat |
  areaDamage | cinders | echoes | blight`. `SurgeEffect` is `rule | stat`.
- `meta/collection.ts:36`: `act2Open` is `bossDown(FINALE)`. The Abyss
  depends on it in `inAbyss`, `regionUnlocked` (`ABYSS_INDEX`) and
  `chooseWaypoint`, and so do `meta/contracts.ts:425,427` (floor and guardian
  contracts). There are 24 calls to `act2Open` across 8 files, and each needs
  a look to decide "Act 2" versus "the Abyss" (§4.2).
- `meta/collection.ts:64`: `regionUnlocked` opens index *k* once *k − 1*'s
  boss has fallen. That breaks at 9, since index 8 is Boss Rush.
- `ui/hub/map.ts:39`: `ACT_REGIONS = 6` drives the Act 1 progress bar and the
  "Region 7" silhouette.
- `sim/systems/combat.ts:1724`: `knockBack` moves a body **instantly**
  (`push / mass`). There's no velocity, so Glide needs one (§3.3).
- `sim/systems/enemies.ts:124–160`: movement is a radial step
  (`e.speed × buffSpeed × fury × slow × dash`). Toll gates this step, and
  Orbit adds a sideways term.
- `sim/systems/waves.ts:197`: `rollWave` sets the count and packs. Giants
  scales it here.
- `content/trials.ts`: three Trials per region. Each has `rules` (`frame`,
  `weapons`, `omen`) and pays a `relic` rank, a `trim` or a notable.
- `content/relics.ts`: four relics per Act 1 region. One is the boss's
  first-kill relic (`source: { kind: 'boss' }`), and three drop from that
  region's elites (`source: { kind: 'elite', region }`).
- `meta/omen.ts:97`: `omenRegion(n)` cycles `REGIONS.map(r => r.index)` in
  shuffled blocks. **Adding regions changes every day's region, past days
  included** (§4.6). `BALANCE.omen.ring` is indexed by region and has seven
  entries.
- `meta/contracts.ts:513`: regional contracts draw from `REGIONS` filtered by
  `regionUnlocked`, so the Wake joins on its own once it's in `REGIONS`.

---

## 2. The five regions

Each region follows Act 1's template: 20 waves, a native introduced at
wave 5 and wave 10, a swarm at 15, the boss at 20, then overtime,
Champions and trophies (these come free through `trophiesAt` and
`isChampionWave`). Natives are new types with one readable verb each
(§4.3). The names, colours and numbers are starting points for tuning.

### 2.1 The Bell Marches (9): *Toll*

> *"When the Blight died, its bell kept ringing. Everything here still answers it."*

- **Rule.** Every `toll.every` (3 s) the bell tolls. Walker-like bodies move
  only during a `toll.window` (0.6 s) after each toll, at a lurch speed that
  keeps their average speed at about ×0.9 of normal. Between tolls they
  stand still. Bosses don't follow the bell.
- **Why it's fresh.** It changes the game's tempo, which no rule does today.
  Crowds stand still in clumps, which suits Mortar and traps. You can see the
  pressure coming: the line stands, *dong*, it's closer.
- **Natives.**
  - *Ringer* (pool 1, weight 1): a walker that, while alive, makes the bell
    toll 20% sooner (stacking to ×0.6).
  - *Sleepwalker* (wave 5): ignores the bell and creeps forward constantly at
    half speed. It's the one that sneaks in while you watch the line.
  - *Straggler* (wave 10): lurches on a toll of its own, half a beat after the
    real one, so the field never quite stands still.
- **Elite aura: Resonant** (in place of `split`). Neighbours within 160 lurch
  twice as far.
- **Boss: the Carillon.**
  - *Phase 1:* it tolls and summons Ringers.
  - *Phase 2:* each toll also sends a shockwave at the wall.
  - *Phase 3:* the bell's interval halves each 20 s until it's ringing
    constantly and the field never stops.
- **Surge.** `rule`: the lurch carries further (×1.25 per rank), so there are
  fewer tolls between a body and the wall.
- **Ground.** Bronze-brown with long furrows, `tint` around `#4a3a22`.
- **Audio.** The toll is a cue in `audio/cues.ts` and keeps the music's beat.
  `audio.md` gets a line.

### 2.2 The Orrery (10): *Orbit*

> *"The Blight's death set the field turning. Nothing walks straight here."*

- **Rule.** Every walker-like body moves on a spiral. Its step is split into
  an inward part and a sideways part (`orbit.tangent`, about 0.6 of its
  speed), so it circles as it closes in. The spin direction is per wave.
  Bodies keep their speed, so the difficulty comes from the geometry, not
  from the clock.
- **Why it's fresh.** Glaives and Frost Ring get more contact per body.
  Sunlance loses its hold time as targets slide sideways, and shots that lead
  miss more often.
- **Natives.**
  - *Satellite* (pool 1): a plain orbiter.
  - *Comet* (wave 5): ignores the orbit and dashes straight in, fast and
    fragile.
  - *Moon* (wave 10): orbits at a fixed radius for one full lap before it
    closes in. Shots stop on it (a moving Shieldbearer arc), so it covers
    what follows it in its lane.
- **Elite aura: Tidal** (in place of `split`). Neighbours orbit faster but
  close in at the same rate.
- **Boss: the Astrolabe.**
  - *Phase 1:* three rings of Satellites orbit it as a shield, and the rings
    must be broken one at a time.
  - *Phase 2:* it reverses the spin of the whole field every 8 s.
  - *Phase 3:* it launches Comets in a fan.
- **Surge.** `rule`: the orbit tightens (×1.3 `tangent` per rank).
- **Ground.** Deep indigo with faint concentric rings, `tint` around `#1e2a4a`.

### 2.3 The Frozen Sea (11): *Glide*

> *"The Mire froze when the Blight died. Push something and it keeps going."*

- **Rule.** Knockback becomes a **slide**. A pushed body gets an outward
  velocity (`push / mass` × `glide.carry`, about 3) that decays with friction.
  A sliding body that touches another deals `glide.impact` × slide speed ×
  mass to both, and passes part of its velocity on.
- **Why it's fresh.** Knockback has been a defensive stat until now. Here it's
  a damage engine, and `mass` becomes something the player reads.
- **Natives.**
  - *Skater* (pool 1): light (`mass` 0.6) and fast.
  - *Floe* (wave 5): a heavy slab (`mass` 8). A body that slides into it
    **shatters** and takes triple impact damage.
  - *Sledge* (wave 10): pushes the body in front of it, and the two move as
    one until one of them dies.
- **Elite aura: Anchored** (in place of `split`). It and its neighbours ignore
  knockback.
- **Boss: the Leviathan Under the Ice.**
  - *Phase 1:* it surfaces, slams, and cracks floes off the ground. They're
    obstacles that bodies can be bowled into.
  - *Phase 2:* it dives, untargetable, and the floes drift.
  - *Phase 3:* the ice breaks into a ring of floes around the wall.
- **Surge.** `stat`: the cold bites, and the tower attacks 10% slower.
- **Ground.** Pale blue-grey with cracks, `tint` around `#2e4a5a`.

### 2.4 Giants' Rest (12): *Giants*

> *"Where the Blight laid its largest dead. Some of them still walk."*

- **Rule.** Every wave brings `giants.count` (0.5) × the bodies, each with
  `giants.size` (×1.6 radius), `giants.hp` (×3 HP) and `giants.reward` (×2
  pay).
- **Why it's fresh.** This is the deliberate opposite of Brittle. It favours
  single-target damage, ramping weapons and crits, and it strains chains and
  splash.
- **Natives.**
  - *Titan* (pool 1): **tramples**. A smaller body it walks through dies, and
    the Titan gains that body's HP.
  - *Tick* (wave 5): rides on a giant, untargetable until its host falls,
    then jumps off fast.
  - *Herdkeeper* (wave 10): while it lives, giants within 200 take 30% less
    damage from the side.
- **Elite aura: Towering** (in place of `regen`). It takes 40% less damage
  from anything that isn't a crit.
- **Boss: the Sleeping Colossus.**
  - *Phase 1:* a weak point moves around its body, and hits on that arc deal
    ×3 damage. This uses the Shieldbearer `turnedAway` code turned inside
    out.
  - *Phase 2:* it sheds Titans as it's hurt.
  - *Phase 3:* it tramples its own Titans to heal.
- **Surge.** `rule`: giants grow larger again (×1.25 size, ×1.25 HP per rank).
- **Ground.** Bone-white dust and long shadows, `tint` around `#4a4236`.

### 2.5 Stormcrown (13): *Storm*. The Wake's finale

> *"The Blight's last breath, still raging over the high ground."*

- **Rule.** Every `storm.every` (5 s), lightning strikes the body with the
  most HP left for `storm.damage` (10% of its Max HP). **While a Conductor
  lives, the strike hits the tower instead**, for `storm.wall` × that wave's
  hit.
- **Why it's fresh.** It's a hazard with a clear "kill this first" target. It
  tests target priority, not raw damage.
- **Natives.**
  - *Groundling* (pool 1): immune to strikes.
  - *Conductor* (wave 5): a slow rod-bearer that redirects strikes onto the
    tower. Its icon and halo must read from across the arena.
  - *Stormcaller* (wave 10): a ranged body whose hits shorten the time to the
    next strike.
- **Elite aura: Charged** (in place of `split`). When it dies, it strikes the
  closest body within 200.
- **Boss: the Thunderhead.**
  - *Phase 1:* it strikes on its own clock as well as the storm's.
  - *Phase 2:* it calls Conductors in pairs.
  - *Phase 3:* the strike clock halves, and every strike splits in two.
- **Its fall opens the Abyss.** The ceremony's line moves here from the
  Blight: *"Something stirs below."*
- **Surge.** `rule`: the storm strikes more often (×0.8 `every` per rank).
- **Ground.** Slate with rain streaks, and the rim flashes on each strike,
  `tint` around `#26303a`.

---

## 3. The mechanics

Each new rule joins `RegionRule`. Rules that could suit the Root (stratum
V) later, such as Toll, Orbit and Storm, take their numbers from the rule
object, not from the region, so `ruleLoad` can fold them in.

```ts
| { readonly kind: 'toll'; readonly every: number; readonly window: number }
| { readonly kind: 'orbit'; readonly tangent: number }
| { readonly kind: 'glide'; readonly carry: number; readonly friction: number; readonly impact: number }
| { readonly kind: 'giants'; readonly count: number; readonly size: number; readonly hp: number; readonly reward: number }
| { readonly kind: 'storm'; readonly every: number; readonly damage: number; readonly wall: number }
```

### 3.1 Toll (S)

- `run.toll` holds the next toll's time and the current window's end. In
  `tickEnemies`, a walker-like body's step is 0 outside the window and
  ×(`every` / `window`) × 0.9 inside it.
- Exempt: bosses, Sleepwalkers, bodies already mid-verb (a Blinker's blink, a
  Ram's charge), and knockback.
- Ringers shorten `every` while they live. It's read each toll, so it stays
  deterministic.
- A `toll` sim event drives the cue and a ring pulse from the rim.

### 3.2 Orbit (S)

- In `tickEnemies` (`enemies.ts:~154`), the step becomes `inward × cos +
  tangent × sin` for walker-like bodies. Bosses, Comets, and burrowed or
  blinking bodies keep a straight path.
- `run.orbitSpin` (±1) is rolled per wave on the `waves` stream.
- **Render:** a faint trail behind each orbiter, and the ground's rings
  rotate with the spin.

### 3.3 Glide (M)

- Add `slideVx` and `slideVy` to `Enemy` (`sim/state.ts`). Under Glide,
  `knockBack` adds to the slide velocity instead of moving the body.
- In `tickEnemies`, a sliding body moves by its slide velocity, which decays
  by `friction`. Walking resumes below a threshold.
- **Collisions** reuse the spatial grid in `separateEnemies`. A new
  `DamageSource` `'impact'` keeps them apart in stats and the Recipe Book.
  Impacts are capped at one per pair per 0.3 s.
- **Performance:** the frame-budget test needs a case at 300 sliding bodies.

### 3.4 Giants (S)

- In `rollWave`, multiply the count by `count`, and give each entry `size`,
  `hp` and `reward` multipliers, applied at spawn as an elite's are.
- Check that a Champion Titan stays under the render's radius cap.

### 3.5 Storm (M)

- A new `sim/systems/storm.ts`. Its clock is `run.storm.next`, and its target
  is the body with the most HP left among `targetable` bodies, with ties
  broken by distance.
- While a Conductor lives, the strike goes to the tower through the tower-hit
  path, where armour, shields and Thorns apply.
- A new `DamageSource` `'storm'` keeps strikes from counting as a weapon's
  worth (I4).
- **The Tactician:** Conductor goes on the default priority list, so the idle
  bot can play the region.

### 3.6 Surges

Toll, Orbit, Giants and Storm use `{ kind: 'rule' }`. Glide's rule favours
the tower, so its surge is a `stat` toll.

---

## 4. Content and meta

### 4.1 The regions list

- `RegionDef` gains `act: 1 | 2` and `after: number | null` (the previous
  region's index). `regionUnlocked` reads `after`. Region 9's `after` is 6.
  This needs impact analysis first, since `regionUnlocked` has many callers.
- Everything that means "Act 1's regions" filters `act === 1`: the Map's
  progress bar (`ACT_REGIONS`), `goals.ts`'s Act 1 lines, `explainers.ts` and
  the Act 1 silhouette (`map.ts:138`).
- `frontier` keeps meaning the furthest region of all (D-8).
- `content/lint.ts` checks that `after` forms one chain with no gaps.
- `LAST_LIGHT` gets five entries, held at 5:1 by `tests/contrast.test.ts`.

### 4.2 The Abyss gate

- A new `abyssOpen(profile)` is `bossDown(profile, WAKE_FINALE)`, with
  `WAKE_FINALE = 'thunderhead'`. It replaces `act2Open` wherever the meaning
  is "the Abyss":
  - `inAbyss`
  - `regionUnlocked(ABYSS_INDEX)`
  - `chooseWaypoint`
  - `contracts.ts:425,427`
  - the Map's shaft
- `rushOpen` already needs the Deepwarden, so it follows.
- Each of the 24 calls to `act2Open` gets a verdict, Act 2 or Abyss, listed in
  the PR.
- `feats.ts:90`: *Abyss Naturalist*'s `after` moves from `'blight'` to
  `'thunderhead'`.
- The Blight's ceremony and Act 1's ending line point to the Wake (*"The land
  it held is turning."*). *"Something stirs below"* moves to the Thunderhead.
- `goals.ts`: in Act 2 before the Thunderhead, the goal line names the next
  Wake boss.

### 4.3 The Map

- A **Wake** band sits between Act 1's six cards and the Abyss shaft. It holds
  five cards in Act 1's card component, under the heading *"The Wake · what
  the Blight held"*. The band is hidden until the Blight falls.
- Unreached cards show as silhouettes with a line of their own (≤ 15 words).
- The shaft shows **sealed** below the Wake until the Thunderhead falls, with
  the line *"Stormcrown stands over the way down."*

### 4.4 Trials (15)

Three per region, in Act 1's shape: one each of a **frame**, a **weapons**
limit and an **omen** (a pact as a fixed rule). Each pays once:

- the **frame** Trial pays a rank of the region's boss relic
- the **weapons** Trial pays a trim
- the **omen** Trial pays a notable

Every Trial is built to work against its region's rule, so that winning it
teaches the rule. These are drafts; the numbers come from `npm run inspect`.

| Region | Frame Trial | Weapons Trial | Omen Trial |
|---|---|---|---|
| Bell Marches | *Steady Hand*: the Bastion frame | *Off the Beat*: Sunlance and Chain Lightning only (no stationary-crowd weapons) | *Quickstep*: Quickening 2 |
| Orrery | *Fixed Star*: a frame with no range bonus | *Straight Lines*: Sunlance and Arcane Bolt only | *Crowded Sky*: Hordes 2 |
| Frozen Sea | *Thin Ice*: the frame with the least Max HP | *No Push*: weapons with no knockback only | *Hard Frost*: Vigour 3 |
| Giants' Rest | *Small Fry*: the frame with the least damage | *Many Hands*: Chain Lightning and Mortar only | *Old Bones*: Tyranny 2 |
| Stormcrown | *Lightning Rod*: a frame with no armour | *Blind Fire*: Scattershot and Mortar only (no aimed single-target) | *Gathering Storm*: Elites 2 |

Which frame each Trial uses depends on the frames that exist, including the
Act 2 Lamplighter and Gravekeeper, and is chosen when building.

### 4.5 Relics (20)

Four per region, as in Act 1: the boss's first-kill relic and three that the
region's elites drop. Each relic leans on its region's verb, so it is most at
home there but still useful elsewhere. The wording below is draft, ≤ 15
words.

| Region | Boss relic | Elite relics |
|---|---|---|
| Bell Marches | **Carillon's Clapper**: every 8 s, the next volley strikes twice. | *Tuning Fork*: +25% damage to bodies standing still. · *Muffled Bell*: slows last 50% longer. · *Metronome*: +1% attack speed per 10 s without taking a hit, up to 20%. |
| Orrery | **Astrolabe Ring**: Glaives and drones orbit 30% faster. | *Star Chart*: shots curve slightly toward their target. · *Tidal Lock*: bodies within half range move 15% slower. · *Comet Tail*: projectiles leave a short burning trail. |
| Frozen Sea | **Leviathan Scale**: knockback +50%; heavy bodies are pushed as if light. | *Skate Blade*: a body knocked into another deals 20% of the hit to it. · *Floe Shard*: shatter kills chill nearby bodies. · *Anchor Chain*: +20% Max HP; the tower can't be pushed (only matters against boss shoves). |
| Giants' Rest | **Colossus Heart**: +30% damage against bodies over half their Max HP. | *Tick Bite*: crits mark a body; a marked body takes +15% damage. · *Herd Bell*: kills of large bodies pay +30% shards. · *Giant's Toe*: Sunlance's heat-up carries to the next target. |
| Stormcrown | **Thunderhead Core**: every 10 s, lightning strikes the toughest body for 5% of its Max HP. | *Lightning Rod*: Chain Lightning arcs +1 enemy. · *Grounding Wire*: −30% damage from strikes and ranged hits. · *Static Charge*: the ultimate charges 1% per crit. |

- Every relic needs a `behaviour` id or a `stat` mod, a `perRank`, and a line
  in `BALANCE.relics` where it ranks.
- Five behaviour ids already exist or are close: quick-start, tally and
  others. New ones go through `sim/` with a test each.
- The Thunderhead Core is the Storm rule carried anywhere. It is the relic
  the player takes into the Abyss.
- **Check against I4:** a relic must not push any weapon past 40% of the
  bot's picks. Run `npm run arsenal` with relics on.

### 4.6 The Daily Omen and Contracts

- **The Omen** draws its region from `cycle(REGIONS.map(r => r.index), n)`.
  Adding five regions reshuffles **every** day, past days included, so a
  friend's code from yesterday would name a different region. The fix:
  - `omenRegion(n)` keeps the six-region cycle for days before a **cutover
    day** (`BALANCE.omen.wakeFrom`) and uses the eleven-region cycle from
    then on.
  - `tests/omen.test.ts` holds a few known days on both sides of the cutover.
  - `BALANCE.omen.ring` grows to 14 entries. A Wake day's tower is the full
    Forge plus a fixed Starlight figure, set by `npm run omen`.
- **Contracts.** Regional contracts draw from `REGIONS`, so the Wake joins on
  its own. Check:
  - the `latest` line (`contracts.ts:188`), which assumes Act 1;
  - the heat contracts (`:363`), which work as they are;
  - that the contract bot (`tools/contractBot.ts`) still clears its targets
    with the Wake in the pool.

### 4.7 Enemies, auras, bosses, feats

- **15 natives.** New verbs:
  - `toll-ring` (Ringer), `sleepwalk`, `offbeat` (Straggler)
  - `orbit-break` (Comet), `lane` (Moon)
  - `slab` (Floe), `push` (Sledge)
  - `trample` (Titan), `ride` (Tick), `herd` (Herdkeeper)
  - `conduct` (Conductor), `call-storm` (Stormcaller)
  - Satellite, Skater and Groundling are walkers with stats.
- **5 auras:** Resonant, Tidal, Anchored, Towering, Charged.
- **5 bosses**, with new pattern kinds: `toll`, `rings`, `reverse`, `floes`,
  `dive`, `weakpoint`, `strike`.
- **The Bestiary** and per-region naturalist feats come through
  `meta/feats.ts#regionEnemies`.
- **One new feat**, *Wake Walker* (every Wake boss felled), gets Starlight on
  top of its shards.

### 4.8 Starlight (D-5)

- `heatStarlight` in a Wake region × `BALANCE.wake.heatStarlight` (0.5).
- A Wake boss's first fall pays `BALANCE.wake.lump` (25), through the
  same path as a stratum's guardian (`recordStratum`), or a sibling
  `recordWake`.

---

## 5. What the gate does to Act 2's shape

The Abyss used to open at the Blight. It now opens five regions later, so
every Act 2 reading that starts its clock at the Blight moves:

- **Abyss Starlight** (floors and guardians) starts later. The Wake's half
  heat pay and its lumps cover part of the gap.
- **Boss Rush** opens on the Deepwarden, so it moves back by the same amount.
- **"Heat 10 at the frontier"** (`balancing.md`): the frontier is now a Wake
  region for most of early Act 2. The reading still makes sense, but its
  baseline has to be taken again.
- **The Constellations** are open from the Blight, and the Wake is where the
  first stars get bought. Check that the Deep's figure (the descent) doesn't
  have nodes that do nothing until the Abyss opens. If it does, either move
  them later in the figure or accept them as investments made ahead.

---

## 6. Build order

Each step ends in something playable.

1. **Plumbing and the Bell Marches.** Add `act` and `after`, update
   `regionUnlocked`, add `abyssOpen` and the gate (§4.2), the Map's Wake band,
   and Toll. The Bell is the cheapest rule, so it proves the plumbing.
2. **Giants' Rest.**
3. **The Orrery.**
4. **Stormcrown**, plus the Tactician's Conductor priority. The Abyss now
   opens on the Thunderhead.
5. **The Frozen Sea**, the biggest sim change.
6. **Relics** (§4.5), then **Trials** (§4.4).
7. **Starlight** (D-5) and the *Wake Walker* feat.
8. **The Omen** (cutover day) and **Contracts** (§4.6).
9. Tuning (§8), then docs: `enemies-and-waves.md`, `act2.md`, `bosses.md`,
   `collection.md` (Trials, relics), `audio.md` (the toll), and a reading in
   `balancing.md`.

Steps 2, 3 and 5 don't depend on each other once step 1 has landed.

---

## 7. Risks

- **The Wake as a wall.** The Wake now gates the Abyss, so a region the bot
  can't clear stops the descent. Each region's idle reading is a gate, not a
  note (§8).
- **Storm and idle play.** If the bot can't prioritise Conductors, the
  region punishes idle play (R7), and it's the last door before the Abyss.
  The Tactician's list is the answer.
- **Glide performance and feel.** Check it at 300 bodies. Keep friction high
  enough that a slide lasts under 1 s.
- **Toll and overlap.** The overlap rule (§4.2) counts living bodies, and
  stop-go waves stay alive longer, so waves may overlap more. Watch the
  300-body cap in the Bell Marches' swarm wave.
- **Giants and the suggestion scorer.** Give `suggest.ts` a per-rule weight
  so the bot doesn't draft Chain Lightning there.
- **Orbit readability on a 375 px phone.** Keep `tangent` below the inward
  part at the rim, so the path reads as a spiral, not a ring.
- **Omen codes.** The cutover day must ship with tests, or friends' codes
  quietly stop matching.
- **Relic creep.** Twenty new relics on top of Act 1's 24 and the Abyss's 12.
  Each must lean on one verb, and I4 is checked with relics on.

---

## 8. Tuning and checks

- `npm run act2 -- --hours 16 --seeds 4`: when each Wake boss first falls
  after the Blight. Targets: the Carillon within 1 h, and the Thunderhead (so
  the Abyss) within 6–10 h. The strata's own targets then start from the
  Thunderhead, not the Blight.
- **The idle report:** the idle bot fells every Wake boss within the Act 2
  idle window. This is a **gate** (§7).
- `npm run arsenal`, with a Wake mode: the bot's picks per Wake region. Each
  rule moves at least one weapon's share by ≥ 10 points, and I4's 40% cap
  holds per region, with relics on.
- `npm run inspect -- --region 9..13`: boss fights of 25–35 s of expected DPS.
- `npm run omen`, 28 days across the cutover: the Wake days meet the median
  targets.
- **The frame-budget test:** Glide at 300 bodies, the Bell's swarm wave, and
  Giants with the largest Champion.
