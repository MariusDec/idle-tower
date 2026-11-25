# 12. The Wake: five regions between the Blight and the Abyss

**Status:** 2026-11-25. Built (untuned): steps 1–6 are in the code. The
Omen's cutover (`BALANCE.omen.wakeFrom`) is day 20788, 2026-12-01. Step 7
(§14's readings, `QUARRY` for 9–13, `BALANCE.omen.stars`) is still to do.
Originally 2026-11-23: planned, nothing built. Comes out of the "3–4 more
maps before the Abyss" brainstorm. The owner settled the decisions in §0.1 on
2026-11-23. §0.2 lists the smaller calls made while detailing the plan
against the code. The owner accepted all of them, as written, on the same day.
Every decision in §0 is settled.

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
| 9 | **The Bell Marches** | *Toll*: bodies move only when the bell tolls. | tempo | Mortar, Rune Traps, Frost Ring (still crowds) | weapons that want a steady stream |
| 10 | **The Orrery** | *Orbit*: nothing walks straight here; everything spirals in. | how bodies move | Glaives, Frost Ring, anything that holds ground | Sunlance, shots that lead |
| 11 | **The Frozen Sea** | *Glide*: pushed bodies slide on the ice and bowl over others. | physics | Scattershot, Mortar, Frost Ring (they push here) | builds with no push |
| 12 | **Giants' Rest** | *Giants*: half the bodies, each three times as tough. | wave shape | Sunlance, single-target, crits | Chain Lightning, Mortar, splash |
| 13 | **Stormcrown** | *Storm*: lightning strikes the toughest body, unless a Conductor stands. | priority under a hazard | Drones and Sunlance (they hunt Conductors) | builds that can't pick a target |

**Why this order:**
- **The Bell Marches opens the Wake.** Its rule is the easiest to read
  ("they stop, then lurch"), and it's the cheapest to build, so it proves the
  plumbing (§12, step 1).
- **Stormcrown closes it.** Its rule asks the most of the player: a hazard
  that helps you until a native turns it against you. That makes it the right
  last lesson before the Abyss.

---

## How to use this plan (read first)

This plan is written so that it can be built step by step without
re-deriving the design. Before you start:

1. **Read** `AGENTS.md` (layout, the sim's rules, the commands),
   `docs/sim.md`, `docs/enemies-and-waves.md`, `docs/bosses.md` and
   `docs/act2.md`. This plan uses their words: *body* for an enemy on the
   field, *verb* for an `EnemyVerb`, *rule* for a `RegionRule`, *surge* for
   what the Blight Surge pact does in a region.
2. **The project's rules apply to every line of this plan:**
   - `sim/` never reads `Date.now`, `Math.random` or the DOM. Every random roll
     uses a `core/rng.ts` stream. This plan adds one stream, `wake` (§3.3).
   - No tunable number goes in `sim/` code. Each one goes in
     `content/balance.ts` (`BALANCE.wake`, `BALANCE.elites`,
     `BALANCE.relics`) or in the content entry itself.
   - Every closed union has exhaustive `switch`es that end in a `never` check.
     When you add a member, `npm run typecheck` lists every switch that needs
     a new `case`. Fix them all. Never silence one with a `default`.
   - Colours in `render/` and `ui/` come from `render/palette.ts` or CSS
     tokens. Enemy and boss body colours are content data and may be hex.
   - Card, relic, rule, trial and surge text is **≤ 15 words** (R4).
     `content/lint.ts` checks this.
3. **GitNexus (CLAUDE.md):** before editing any function listed in §16, run
   `impact({ target: "<name>", direction: "upstream" })` and note the blast
   radius in the PR. Run `detect_changes()` before every commit. The
   high-traffic ones are `regionUnlocked`, `act2Open`, `spawnEnemy`,
   `tickEnemies`, `knockBack`, `damageEnemy`, `hurtTower`, `bankRun` and
   `createRun`.
4. **After every step:** `npm run typecheck`, `npm test`, then the checks the
   step names. A step is done when it is playable in `npm run dev` and its
   tests pass.
5. **Act 1 must not change.** Every new code path is gated on a Wake rule, a
   Wake verb or a Wake relic. The determinism test and the Act 1 pacing
   readings (`npm run pacing -- --hours 12 --seeds 8 --fast`) must read the
   same before and after each step. If an Act 1 reading moves, a gate leaked.

---

## 0. Decisions

### 0.1 Settled by the owner (2026-11-23)

| # | Question | Decision |
|---|---|---|
| D-1 | Where do the regions sit? | **After the Blight, and they gate the Abyss.** The Abyss opens when Stormcrown's Thunderhead first falls. Boss Rush still opens on the Deepwarden, so it moves back with the Abyss. Act 1's ending and I1–I6 stay as they are. |
| D-2 | What indices? | **9–13.** `ABYSS_INDEX` (7) and `RUSH_INDEX` (8) stay as they are. The profile keys region records by index string, so there's no renumbering. The Map's order comes from `after`, not the index (§8.1). |
| D-3 | What opens when the Blight falls? | **Act 2, as today:** pacts, heat, Starlight, the Constellations and the Bell Marches. Only the Abyss (and so Boss Rush) waits for the Thunderhead. Each later Wake region opens when the previous region's boss falls. |
| D-4 | Pacts and Trials there? | **Both.** These are regions: `pastRegions` stays false, heat records apply, and each region has three Trials (§8.8). |
| D-5 | Starlight | **Heat records in the Wake pay ×0.5** (`BALANCE.wake.heatStarlight`), and **each Wake boss's first fall pays a lump of 25** (125 in all). |
| D-6 | HP and pay curve | **Flat, like Blight Heart.** The difficulty is the rule, not the numbers. Start at `hpBase` 2300–2600 with `hpGrowth` 1.17, and pay between the Blight Heart and ×1.3 of it, tuned with the Act 2 bot (§14). |
| D-7 | How many regions? | **Five:** the four from the brainstorm plus the Bell Marches. |
| D-8 | Frontier March | **It marches into the Wake.** After each Wake boss's first fall, `marchOn` moves the next run to the newest Wake region. Once the Thunderhead falls, the march ends at Stormcrown. It never moves a run into the Abyss, as today. *(This needs no code: see §8.1.)* |
| D-9 | Plan (monetization) | **Paid**, with no new code: `regionPaid(i)` is `i > 3`. |
| D-10 | Names | **Kept:** the Wake, the Bell Marches, the Orrery, the Frozen Sea, Giants' Rest, Stormcrown. |
| D-11 | Saves that already have the Abyss open | **Not an issue:** no released save has reached Act 2, so there's no grandfathering and no migration step. |
| D-12 | What ships in the first build? | **Everything:** the five regions, their Trials, their relics, and the Wake in the Daily Omen and Contracts. The build order (§12) still lands one region at a time. |

### 0.2 Made while detailing (accepted by the owner, 2026-11-23)

| # | Question | Decision | Why |
|---|---|---|---|
| D-13 | Do the Wake bosses open relic slots? | **Only the Thunderhead** (`relicSlot: true`). The other four are `false`. | Twenty more relics compete for the same slots. One slot at the Wake's end rewards finishing it, as the Blight's does for Act 1. |
| D-14 | Relic sets (N6) for the Wake? | **None in this plan.** `RELIC_SETS` gains no entries. A Wake elite relic past rank III melts into shards, as a boss relic does. | Each set needs a new behaviour. Sets can follow once the relics have been played. |
| D-15 | Do Wildfire and World Aflame (`heatAll`) count the Wake? | **No. They count Act 1's six regions.** Their text changes to "Clear all six Act 1 regions at heat 5 or more." | Otherwise two existing Starlight feats get much harder, and the B7 test's budget moves. |
| D-16 | Which feats move behind the Thunderhead? | **Every Abyss feat:** The Descent, Warden Fallen, Hunger Sated, Bottomless, Abyss Naturalist. Their `after` becomes `'thunderhead'`. | A feat should never name a place the player can't reach yet (R1 §2). |
| D-17 | Does Boss Rush gain the Wake bosses? | **No.** `RUSH_BOSSES` is unchanged. | Boss Rush is sized on Abyss floors. Adding stages changes `rushStarlight` and every Rush record. That's a plan of its own. |
| D-18 | How do Conductors get shot first, idle or not? | **The aim doctrines, not the Tactician.** The Tactician orders *draft picks* (`RunConfig.priority` is a `CardItemId` list), not targets. The Conductor's verb has a `standoff`, so Drones hunt it (`standoffFirst`), and `toughness()` ranks it above an elite, so Sunlance holds on it. | The original plan's "Tactician list" can't work in this codebase. The idle bot plays with the same aim as everyone. |
| D-19 | Storm and bosses | **A strike never falls on a boss, its court or its plates.** | 10% of a boss's Max HP every 5 s would end a 30 s fight on its own. |
| D-20 | Natives renamed for clashes | The Stormcrown native *Stormcaller* becomes **Squallcaller**, because Stormcaller is a frame. The Trial *Steady Hand* becomes **Held Breath**, because Steady Hand is a feat. The Trial *Lightning Rod* becomes **Bare Mast**, because Lightning Rod is now a relic. | `content/lint.ts#uniqueNames` fails on a shared name (T3c). |
| D-21 | Relics that duplicated existing ones | *Tuning Fork* (a copy of Stillwater Charm), *Carillon's Clapper* (close to Forgeheart Core), *Comet Tail*, *Skate Blade* and *Static Charge* are reworded in §8.9. | Each relic must lean on one verb and not repeat another relic. |
| D-22 | What pushes on the ice? | Under Glide, **Mortar shells, rune bursts and Frost Ring pulses push** as well as Scattershot and Nova. Today only Scattershot (16–32), Nova (160) and Field Kit crits knock bodies back. | Without this, Glide favours one weapon. The plan's own "Favours" column names Mortar. |
| D-23 | The idle gate for the Wake | **The hands-off idle bot fells the Thunderhead within 4 days of the Blight** (§14). | The original plan named an "Act 2 idle window" that doesn't exist yet. If §14's readings show 4 days is wrong, retune the Wake to meet it rather than moving the target. |
| D-24 | Abyss Starlight the Lantern stars promise | The four Lantern stars ("relics start dropping in the Abyss") **stay where they are** and are accepted as investments made ahead. | Moving them reshapes the Lantern figure. The Wake's lumps cover the wait. |
| D-25 | "Stormcrown" next to the Storm Crown evolution | **Both names stay** (D-10). | The risk was weighed and accepted: the names differ by a space and may confuse players in the Recipe Book. Don't rename either one while building. |

---

## 1. Where things stand (checked against the code on 2026-11-23)

| Fact | Where |
|---|---|
| Six `RegionDef`s with indices 1–6. Each has a pool of three, beats at 5/10/15, a `rule` and a `surge`, plus `elites.auras` with one aura of its own (N3). | `src/content/regions.ts` |
| `RegionRule` is a closed union: `stat \| areaDamage \| cinders \| echoes \| blight`. It has three consumers: `regionMods` (`sim/systems/waves.ts:108`), `damageTaken` (`combat.ts:1789`, Brittle) and `ruleOnKill` (`combat.ts:2181`). `SurgeEffect` is `rule \| stat`. | `src/content/types.ts:774`, `:793` |
| `ruleSurge(load, region)` gives Blight Surge's ranks when the surge's kind is `'rule'`, else 0. `surgeMods` gives the `stat` surge as tower mods. | `src/sim/pacts.ts` |
| `act2Open(profile)` is `bossDown(profile, FINALE)`, where `FINALE` is the boss with `finale: true` (the Blight). It has 24 calls outside its definition (§8.2). | `src/meta/collection.ts:36` |
| `regionUnlocked` opens index *k* once *k − 1*'s boss has fallen. Index 9 would look for index 8, which is Boss Rush, so it breaks. | `src/meta/collection.ts:64` |
| `frontier()` and `playableFrontier()` take the highest *unlocked index*. Wake indices are above 6, so both already pick the newest Wake region. That makes D-8 automatic. | `collection.ts:73`, `plan.ts:51` |
| `ACT_REGIONS = 6` drives the Map's light bar and the "Region 7" silhouette. | `src/ui/hub/map.ts:39`, `:138` |
| `knockBack(e, push)` moves a body **instantly** by `push / mass`, straight out. Its only callers are the projectile hit (`combat.ts:1640`), Field Kit crits (`:1834`) and Nova (`ultimate.ts:68`). Scattershot is the only weapon with `knockback` (16, doubled to 32 by an upgrade). | `combat.ts:1724` |
| Movement is a radial step `e.speed × buffSpeed × fury × slow × dash × dt`, capped at `d − stop`. Walking out is `walkOut`. | `src/sim/systems/enemies.ts:141–177` |
| `separateEnemies` rebuilds a module-level `SpatialGrid` (cell 64) each step, and `MAX_RADIUS` is the biggest body radius × the elite scale. Giants break that constant (§4.4). | `enemies.ts:17–25`, `:395` |
| `rollWave(region, n, rng, pace, extra)` is pure given the RNG. It sets the count, packs, the elite and the Champion. `spawnEnemy` is where every body enters. | `src/sim/systems/waves.ts:197`, `:357` |
| Bosses: `arriveBoss` builds the body (its `type` is `region.pool[0].enemy`). `tickBoss` runs the patterns, and `period(p)` is 0 for always-on patterns (`mirror`, `rule`). Plates (`BossPlates`, Forgeheart) are bodies with `plate = boss.id`, placed each step by `placePlates`. | `src/sim/systems/boss.ts` |
| Aim: each weapon has a `Targeting` doctrine (`nearest`, `densest`, `toughest`, `line`, `standoff`). `standoffFirst` hunts any type whose verb has a `standoff` field. `toughness()` ranks plate 3, boss 2, elite 1. | `combat.ts:194–235`, `:274` |
| Trials: three per region, `rules` of `frame`, `weapons`, `slots` or `omen`. A `frame` rule doesn't need the frame to be owned. An omen pact *replaces* the player's pacts and pays no heat. | `src/content/trials.ts`, `meta/runConfig.ts:51`, `:172` |
| Relics: four per Act 1 region. One comes from the boss's first kill (`source: { kind: 'boss' }`) and three from the region's elites (`source: { kind: 'elite', region }`). `content/lint.ts` fails a region that doesn't give exactly four. | `src/content/relics.ts`, `lint.ts:242` |
| Lint T3a: every enemy in every pool must be in the `counters` list of at least one Act 1 weapon. | `content/lint.ts:333` |
| The Daily Omen: `omenRegion(n)` cycles `REGIONS.map(r => r.index)` in shuffled blocks of `REGIONS.length` days. **Adding regions reshuffles every day, past days included.** The Omen's tower is a fresh profile with Forge rings up to `BALANCE.omen.ring[region]` bought out. | `src/meta/omen.ts:97`, `:238`; `balance.ts:792` |
| Contracts: regional targets draw from `REGIONS` filtered by `regionUnlocked`, so the Wake joins on its own. Floor, guardian and Rush targets gate on `act2Open`. | `src/meta/contracts.ts:416–430`, `:503`, `:513` |
| Heat Starlight: `recordStarlight(profile, region, h)` sums `heatStarlight(l)` for each level past the record. `recordHeat` pays it through `payStarlight`. The Pacts screen previews it through `recordStarlight`. | `src/meta/pacts.ts:60–90`, `ui/hub/pacts.ts:65` |
| A first boss fall sets `profile.ceremony`. `App#leaveResults` opens the Map, and for the `finale` boss plays `App#ending()`, whose text promises the Abyss. | `meta/results.ts:388`, `app/App.ts:545–570` |
| Save versions: `PROFILE_VERSION = 27`, `SNAPSHOT_VERSION = 22`. | `meta/profile.ts:231`, `meta/save/index.ts:104` |
| Records keyed by content id that TypeScript will make you fill in: `GAIT: Record<EnemyId, …>`, `AURA_COLOR: Record<AuraId, …>` (`render/painters/enemies.ts`), `PROFILE: Record<BossId, …>` (`render/painters/bosses.ts`), `BOSS_MOTION: Record<BossId, …>` (`render/bossMotion.ts`). | as listed |
| Music: `REGION_VOICES` (by index, 1–6) and `REGION_SHIFT` (by index; a missing index falls back to the last entry). | `src/audio/music.ts:53`, `:84` |
| Icons: `IconId` is a closed union generated from the manifest in `scripts/fetch-icons.mjs` (`[author, slug]` pairs from game-icons). A new icon is added there, then `npm run icons` (needs network) regenerates `content/icons.ts` and the sprite. | `scripts/fetch-icons.mjs:78` |
| Tools: there is **no** `npm run act2`. The Act 2 bot runs as `npm run pacing -- --act2 --hours H --seeds N` (`tools/act2.ts#runAct2`). Its `frontier` is fixed to `REGIONS[REGIONS.length − 1]`, and its region loop takes every region in `REGIONS`. | `tools/act2.ts:185`, `:212` |

---

## 2. The five regions: content

Every region follows Act 1's template: 20 waves, a native introduced at
wave 5 and wave 10, a swarm at 15, the boss at 20, then overtime,
Champions and trophies (these come free through `isChampionWave` and
`trophiesAt`). The numbers are starting points. §14 tunes them.

### 2.0 Fields every Wake region shares

```ts
// In each Wake RegionDef (content/regions.ts):
act: 2,
after: <previous region's index>,   // 9's is 6; 10's is 9; …
shardBase: 66,        // Blight Heart's 60 × 1.1; tune between 60 and 78 (D-6)
waveShards: 132,      // 2 × shardBase, as every Act 1 region
hpBase: 2400,         // tune 2300–2600 (D-6)
hpGrowth: 1.17,
damageBase: 46,
damageGrowth: 1.06,
count: { base: 6, perWave: 2 },
elites: { from: 5, every: 4, auras: [/* see each region */] },
```

Each region also gets an entry in `LAST_LIGHT` (`content/regions.ts`). Start
from the tint given below mixed 60% into the ember dusk, then darken until
`tests/contrast.test.ts` passes (every text token at 5:1). The test is the
gate, not the starting hex.

### 2.1 The Bell Marches (9): *Toll*

> *"When the Blight died, its bell kept ringing. Everything here still answers it."*

**Region data**

```ts
{
  id: 'bell-marches', index: 9, act: 2, after: 6,
  name: 'The Bell Marches', icon: <bell icon, §9.4>,
  text: 'Where the Blight’s bell still rings.',
  veil: 'A bell still rings past the Blight Heart.',
  pool: [
    { enemy: 'ringer', from: 1, weight: 1 },
    { enemy: 'sleepwalker', from: 5, weight: 0.3 },
    { enemy: 'straggler', from: 10, weight: 0.35 },
  ],
  beats: {
    5: { kind: 'introduce', enemy: 'sleepwalker', packs: 2 },
    10: { kind: 'introduce', enemy: 'straggler', packs: 2 },
    15: { kind: 'swarm', countMult: 1.5 },
  },
  rule: { name: 'Toll', text: 'Bodies move only when the bell tolls.',
          effect: { kind: 'toll', every: 3, window: 0.6 } },
  surge: { text: 'The lurch carries further: a quarter more each toll.', effect: { kind: 'rule' } },
  boss: 'carillon',
  tint: '#4a3a22',
  elites: { from: 5, every: 4, auras: ['haste', 'regen', 'shield', 'resonant', 'vengeful'] },
}
```

**The rule (§4.1).** Every `every` seconds (3 s) the bell tolls. Tolled bodies
move only during the `window` (0.6 s) after a toll, at a lurch speed that keeps
their average speed at ×0.9 of normal (`BALANCE.wake.toll.average`). Between
tolls they stand still. Bosses don't answer the bell.

**Natives** (`content/enemies.ts`; the HP, damage and armour numbers are
multiples of the region's wave values, like every enemy's)

| id | name | text (R4) | hp | speed | radius | damage | atk | armor | pack | xp | mass | shape | verb |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `ringer` | Ringer | Each one alive makes the bell toll a little sooner. | 1.2 | 70 | 22 | 1 | 1 | 0 | [1, 2] | 1.2 | 1.2 | circle | `{ kind: 'ring', hasten: 0.95 }` |
| `sleepwalker` | Sleepwalker | Deaf to the bell: it creeps in at half pace, never stopping. | 1.4 | 75 | 23 | 1.2 | 1 | 0 | [1, 1] | 1.4 | 1.4 | hexagon | `{ kind: 'sleepwalk', pace: 0.5 }` |
| `straggler` | Straggler | Lurches half a beat late, so the field never quite stills. | 0.6 | 110 | 17 | 0.7 | 0.8 | 0 | [3, 5] | 0.6 | 0.7 | diamond | `{ kind: 'offbeat' }` |

Lore lines (Bestiary, not held to R4):
- Ringer: *"They carry the bell's voice in their chests, and pass it on."*
- Sleepwalker: *"It never heard the bell. It never stopped walking."*
- Straggler: *"Always a step behind the toll, and always a step closer."*

Body colours: Ringer `#b08a3c` / border `#ffe2a0`; Sleepwalker `#5a5470` /
`#c9c2e6`; Straggler `#8a6a3a` / `#f0d6a0`.

**Elite aura: Resonant** (in place of `split`): `{ id: 'resonant', name:
'Resonant', text: 'Its neighbours lurch twice as far on every toll.', radius:
160 }`. Its strength is `BALANCE.elites.resonant: 1.8`, a speed buff (§6).

**Boss: the Carillon** (`content/bosses.ts`)

```ts
{
  id: 'carillon', name: 'The Carillon', icon: <bell icon>,
  text: 'Tolls, calls its Ringers, and rings faster as it breaks.',
  hp: 60, armor: 0.02, speed: 24, radius: 70, standoff: 240, damage: 4,
  xp: 110, shards: 520, mass: 30, relicSlot: false,
  phases: [
    { below: 1, line: 'It tolls, and its Ringers come.',
      patterns: [{ kind: 'summon', enemy: 'ringer', packs: 2, every: 8 }] },
    { below: 0.66, line: 'Each toll now rolls a shockwave at the wall.',
      patterns: [
        { kind: 'peal', speed: 420, damage: 2.5 },
        { kind: 'summon', enemy: 'straggler', packs: 1, every: 10 },
      ] },
    { below: 0.33, line: 'It rings faster and faster. Nothing stands still.',
      patterns: [
        { kind: 'peal', speed: 460, damage: 2.5 },
        { kind: 'quicken', every: 20, factor: 0.5 },
      ] },
  ],
  color: '#6b4a1e', borderColor: '#ffcf6b',
  lore: 'The Blight hung it to call its dead to war. It rings on for no one.',
}
```

`peal` and `quicken` are new `BossPattern` kinds (§7).

**Surge.** `rule`: the lurch carries `BALANCE.wake.toll.surge` (×1.25) further per
Blight Surge rank, so there are fewer tolls between a body and the wall.

**Audio.** A `toll` sim event (§3.4) plays a bell cue in `audio/cues.ts`, a
low struck partial a fifth above the run's root, so it sits on the music's
key. `REGION_VOICES[9]`: loop `[[0,3,7],[-5,-2,2],[0,3,7],[-2,2,5]]`, figure
`'toll'` (the figure exists for the Blight Heart). `REGION_SHIFT[9] = -1`.

### 2.2 The Orrery (10): *Orbit*

> *"The Blight's death set the field turning. Nothing walks straight here."*

```ts
{
  id: 'orrery', index: 10, act: 2, after: 9,
  name: 'The Orrery', icon: <ringed planet icon>,
  text: 'A field that turns like a wheel.',
  veil: 'Beyond the bell, the ground turns like a wheel.',
  pool: [
    { enemy: 'satellite', from: 1, weight: 1 },
    { enemy: 'comet', from: 5, weight: 0.35 },
    { enemy: 'moon', from: 10, weight: 0.12 },
  ],
  beats: {
    5: { kind: 'introduce', enemy: 'comet', packs: 2 },
    10: { kind: 'introduce', enemy: 'moon', packs: 1 },
    15: { kind: 'swarm', countMult: 1.5 },
  },
  rule: { name: 'Orbit', text: 'Nothing walks straight here; everything spirals in.',
          effect: { kind: 'orbit', tangent: 0.6 } },
  surge: { text: 'The spiral tightens: bodies swing wider as they close.', effect: { kind: 'rule' } },
  boss: 'astrolabe',
  tint: '#1e2a4a',
  elites: { from: 5, every: 4, auras: ['haste', 'regen', 'shield', 'tidal', 'vengeful'] },
}
```

**The rule (§4.2).** Each orbiting body's step is split into an inward part
and a sideways part. The sideways part is `tangent` (0.6) times the inward
part, so the path is a spiral. The step keeps its length, so a body arrives
about 1.17× later. That's the price of the geometry, not a speed change. The
spin direction is rolled per wave.

**Natives**

| id | name | text (R4) | hp | speed | radius | damage | atk | armor | pack | xp | mass | shape | verb |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `satellite` | Satellite | Circles as it closes in. The baseline here. | 1 | 80 | 21 | 1 | 1 | 0 | [1, 2] | 1 | 1 | circle | `{ kind: 'walker' }` |
| `comet` | Comet | Ignores the turning field and streaks straight in. Fast, and fragile. | 0.4 | 170 | 15 | 0.8 | 0.8 | 0 | [2, 3] | 0.5 | 0.5 | triangle | `{ kind: 'streak' }` |
| `moon` | Moon | Circles half the field inside your range before it closes in. | 3.2 | 60 | 30 | 2 | 1.3 | 0.1 | [1, 1] | 3 | 3 | circle | `{ kind: 'lane', radius: 320, sweep: 3.1416 }` |

Lore: Satellite *"Caught in the turning, they forgot how to walk straight."* ·
Comet *"Some broke free of the wheel. They do not slow down."* · Moon *"It
keeps its distance, round and round, until it doesn't."*

Colours: Satellite `#3c5a8a` / `#bcd2ff`; Comet `#d9e6ff` / `#5a7ab0`; Moon
`#8a8fa8` / `#f2f4ff`.

The Moon is the Orrery's decoy. It circles at 320, inside the tower's range
(380), so every `nearest` weapon shoots at it while it laps. That covers
what walks behind it. No new shield code is needed.

**Elite aura: Tidal** (in place of `split`): `{ id: 'tidal', name: 'Tidal',
text: 'Its neighbours swing round faster, but close in no sooner.', radius: 160
}`. `BALANCE.elites.tidal: 2`, the neighbours' tangent multiplier (§6).

**Boss: the Astrolabe**

```ts
{
  id: 'astrolabe', name: 'The Astrolabe', icon: <astrolabe or ringed planet icon>,
  text: 'Shielded by turning rings; it turns the field back on itself.',
  hp: 55, armor: 0.02, speed: 26, radius: 64, standoff: 240, damage: 4,
  xp: 110, shards: 520, mass: 26, relicSlot: false,
  plates: { hp: 0.06, armor: 0.02, guard: 0.4, radius: 22, orbit: 0.9 },
  phases: [
    { below: 1, line: 'Rings of stone turn about it. Break them to reach it.', plates: 6,
      patterns: [{ kind: 'summon', enemy: 'satellite', packs: 2, every: 9 }] },
    { below: 0.6, line: 'It turns the whole field the other way.', plates: 0,
      patterns: [
        { kind: 'reverse', every: 8 },
        { kind: 'summon', enemy: 'satellite', packs: 2, every: 8 },
      ] },
    { below: 0.3, line: 'It flings Comets at the wall.',
      patterns: [
        { kind: 'reverse', every: 8 },
        { kind: 'summon', enemy: 'comet', packs: 3, every: 6 },
      ] },
  ],
  color: '#24345e', borderColor: '#9ec0ff',
  lore: 'A map of the heavens, built by the old kings. The Blight taught it to turn the world instead.',
}
```

The rings reuse Forgeheart's plates. A new optional `BossPlates.orbit`
makes the plates circle the boss instead of facing the tower (§7.2). `reverse`
is a new pattern (§7).

**Surge.** `rule`: `tangent × BALANCE.wake.orbit.surge` (×1.3) per rank, capped at
`BALANCE.wake.orbit.max` (0.95), so the path stays a spiral and never becomes
a ring.

**Ground.** Deep indigo, `#1e2a4a`, with faint concentric rings that turn with
the spin (§9.1). Music: loop `[[0,3,7],[3,7,10],[5,8,12],[3,7,10]]`, figure
`'arp'`, `REGION_SHIFT[10] = 2`.

### 2.3 The Frozen Sea (11): *Glide*

> *"The Mire froze when the Blight died. Push something and it keeps going."*

```ts
{
  id: 'frozen-sea', index: 11, act: 2, after: 10,
  name: 'The Frozen Sea', icon: <iceberg or ice icon>,
  text: 'The Mire, frozen hard. Nothing stops where it is pushed.',
  veil: 'Past the turning field, the Mire lies frozen.',
  pool: [
    { enemy: 'skater', from: 1, weight: 1 },
    { enemy: 'floe', from: 5, weight: 0.15 },
    { enemy: 'sledge', from: 10, weight: 0.12 },
  ],
  beats: {
    5: { kind: 'introduce', enemy: 'floe', packs: 2 },
    10: { kind: 'introduce', enemy: 'sledge', packs: 1 },
    15: { kind: 'swarm', countMult: 1.5 },
  },
  rule: { name: 'Glide', text: 'Pushed bodies slide on the ice and bowl over others.',
          effect: { kind: 'glide', carry: 3, friction: 4, impact: 0.25 } },
  surge: { text: 'The cold bites: the tower attacks 10% slower.',
           effect: { kind: 'stat', mod: { key: 'attackSpeed', pct: -0.1 } } },
  boss: 'leviathan',
  tint: '#2e4a5a',
  elites: { from: 5, every: 4, auras: ['haste', 'regen', 'shield', 'anchored', 'vengeful'] },
}
```

**The rule (§4.3).** A push becomes a **slide**. The body gets a velocity that
decays with friction, and while it slides it doesn't walk. A sliding body that
touches another deals impact damage to both and passes on half its velocity.
Knockback stops being only a defensive stat: here it's a damage engine, and
`mass` becomes something the player reads. Under Glide, blasts push too
(D-22).

**Natives**

| id | name | text (R4) | hp | speed | radius | damage | atk | armor | pack | xp | mass | shape | verb |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `skater` | Skater | Light and quick on the ice. Easy to send flying. | 0.7 | 110 | 18 | 0.8 | 0.9 | 0 | [2, 4] | 0.7 | 0.6 | diamond | `{ kind: 'walker' }` |
| `floe` | Floe | A slab of ice. Anything slid into it shatters. | 3 | 30 | 34 | 2 | 1.5 | 0.15 | [1, 1] | 3 | 8 | square | `{ kind: 'slab', shatter: 3 }` |
| `sledge` | Sledge | Shoves the body ahead of it to the wall, as one. | 2.4 | 55 | 28 | 1.6 | 1.2 | 0.05 | [1, 1] | 2.4 | 3 | plated | `{ kind: 'sledge', reach: 14 }` |

Lore: Skater *"The Mire's drowned learned to skate the day it froze."* · Floe
*"Not a creature. Not quite ice. It moves when no one is looking."* · Sledge
*"It pushes something before it. It is never the same thing twice."*

Colours: Skater `#7fb0c8` / `#eaf8ff`; Floe `#c8e4f0` / `#5a8aa0`; Sledge
`#3a5a6a` / `#b8dcec`.

**Elite aura: Anchored** (in place of `split`): `{ id: 'anchored', name:
'Anchored', text: 'It and its neighbours cannot be pushed.', radius: 160 }`
(§6).

**Boss: the Leviathan Under the Ice**

```ts
{
  id: 'leviathan', name: 'The Leviathan Under the Ice', icon: <whale or sea-serpent icon>,
  text: 'Cracks floes from the ice, dives out of reach, and rings the wall with ice.',
  hp: 58, armor: 0.03, speed: 22, radius: 74, standoff: 250, damage: 4,
  xp: 110, shards: 520, mass: 40, relicSlot: false,
  phases: [
    { below: 1, line: 'It slams the ice, and floes crack loose. Slide them home.',
      patterns: [
        { kind: 'slam', every: 6, windup: 1.2, speed: 420, damage: 3.5 },
        { kind: 'floes', count: 3, every: 9, ring: false },
      ] },
    { below: 0.6, line: 'It dives under the ice. Skaters swarm while it hides.',
      patterns: [
        { kind: 'submerge', every: 9, seconds: 4 },
        { kind: 'summon', enemy: 'skater', packs: 3, every: 7 },
      ] },
    { below: 0.3, line: 'The ice breaks into a ring around the wall.',
      patterns: [
        { kind: 'floes', count: 8, every: 0, ring: true },
        { kind: 'slam', every: 4, windup: 1, speed: 480, damage: 3.5 },
      ] },
  ],
  color: '#1a3a4a', borderColor: '#9ee6ff',
  lore: 'It slept under the Mire for an age. The cold woke it, and it is hungry.',
}
```

`floes` is a new pattern (§7). `slam` and `submerge` already exist.

**Surge.** `stat`: the cold bites, and the tower attacks 10% slower. Glide
favours the tower, so its surge is a toll, as Brittle's is.

**Ground.** Pale blue-grey, `#2e4a5a`, with crack lines (§9.1). Music: loop
`[[0,3,7],[-4,0,3],[-2,2,5],[-4,0,3]]`, figure `'chime'`, `REGION_SHIFT[11] = 4`.

### 2.4 Giants' Rest (12): *Giants*

> *"Where the Blight laid its largest dead. Some of them still walk."*

```ts
{
  id: 'giants-rest', index: 12, act: 2, after: 11,
  name: 'Giants’ Rest', icon: <giant or troll icon>,
  text: 'Where the Blight laid its largest dead.',
  veil: 'Beyond the ice, the great dead stir.',
  pool: [
    { enemy: 'titan', from: 1, weight: 1 },
    { enemy: 'tick', from: 5, weight: 0.3 },
    { enemy: 'herdkeeper', from: 10, weight: 0.12 },
  ],
  beats: {
    5: { kind: 'introduce', enemy: 'tick', packs: 2 },
    10: { kind: 'introduce', enemy: 'herdkeeper', packs: 1 },
    15: { kind: 'swarm', countMult: 1.4 },
  },
  rule: { name: 'Giants', text: 'Half the bodies, each three times as tough.',
          effect: { kind: 'giants', count: 0.5, size: 1.6, hp: 3, reward: 2 } },
  surge: { text: 'The giants grow: a quarter larger, a quarter tougher.', effect: { kind: 'rule' } },
  boss: 'colossus',
  tint: '#4a4236',
  elites: { from: 5, every: 4, auras: ['haste', 'towering', 'shield', 'split', 'vengeful'] },
}
```

**The rule (§4.4).** Every wave brings `count` (0.5) × the bodies. Each body
has `size` (×1.6) radius, `hp` (×3) HP and `reward` (×2) XP and shards. This is
the deliberate opposite of Brittle: it favours single-target damage, ramping
weapons and crits, and strains chains and splash.

**Natives** (the radius below is *before* the ×1.6)

| id | name | text (R4) | hp | speed | radius | damage | atk | armor | pack | xp | mass | shape | verb |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `titan` | Titan | Tramples anything smaller in its way, and grows from it. | 1 | 60 | 26 | 1.2 | 1.2 | 0 | [1, 1] | 1 | 2 | circle | `{ kind: 'trample', smaller: 0.85 }` |
| `tick` | Tick | Rides a giant, out of reach, and leaps off when it falls. | 0.3 | 150 | 12 | 0.5 | 0.7 | 0 | [2, 3] | 0.4 | 0.4 | triangle | `{ kind: 'ride', reach: 220 }` |
| `herdkeeper` | Herdkeeper | Bodies near it take 30% less damage. Kill it first. | 2.5 | 45 | 20 | 1 | 1.2 | 0.05 | [1, 1] | 2.5 | 2 | hexagon | `{ kind: 'herd', radius: 200, shield: 0.7 }` |

After the ×1.6, a Titan's radius is 41.6 and a Herdkeeper's is 32. A Titan
tramples anything below 41.6 × 0.85 ≈ 35, so **a Titan tramples a
Herdkeeper**. That's intended: it's a reason to watch where the Titans walk.

Lore: Titan *"It walked for the old kings. It walks for nobody now, and steps
on everything."* · Tick *"Small things live on the great dead. They don't
like to be shaken off."* · Herdkeeper *"It herds the giants as a shepherd
would, and they let it."*

Colours: Titan `#8a7a5a` / `#f0e2c0`; Tick `#5a3a2a` / `#e0a080`;
Herdkeeper `#6a5a3a` / `#ffe0a0`.

**Elite aura: Towering** (in place of `regen`): `{ id: 'towering', name:
'Towering', text: 'It takes 40% less damage from anything but a crit.',
radius: 0 }`. `BALANCE.elites.towering: 0.6`, the share a non-crit lands (§6).

**Boss: the Sleeping Colossus**

```ts
{
  id: 'colossus', name: 'The Sleeping Colossus', icon: <giant icon>,
  text: 'Hit its heart when it turns to you. It sheds Titans, then eats them.',
  hp: 62, armor: 0.04, speed: 18, radius: 82, standoff: 250, damage: 4.5,
  xp: 110, shards: 520, mass: 50, relicSlot: false,
  phases: [
    { below: 1, line: 'Its heart turns as it walks. Strike while it faces you.',
      patterns: [{ kind: 'weakpoint', arc: 1.2, spin: 0.7, mult: 3 }] },
    { below: 0.6, line: 'Titans break off it as it is hurt.',
      patterns: [
        { kind: 'weakpoint', arc: 1.2, spin: 0.9, mult: 3 },
        { kind: 'summon', enemy: 'titan', packs: 1, every: 7 },
      ] },
    { below: 0.3, line: 'It tramples its own Titans to heal. Keep them away.',
      patterns: [
        { kind: 'summon', enemy: 'titan', packs: 1, every: 6 },
        { kind: 'feast', every: 4, radius: 220, heal: 1 },
      ] },
  ],
  color: '#5a4e3a', borderColor: '#ffe8b0',
  lore: 'The largest of the dead. The Blight never woke it; its death did.',
}
```

`weakpoint` and `feast` are new patterns (§7).

**Surge.** `rule`: giants grow ×1.25 size and ×1.25 HP per rank
(`BALANCE.wake.giants.surge`).

**Ground.** Bone-white dust and long shadows, `#4a4236`. Music: loop
`[[0,3,7],[-7,-4,0],[-5,-2,2],[-7,-4,0]]`, figure `'drone'`,
`REGION_SHIFT[12] = -3`.

### 2.5 Stormcrown (13): *Storm*. The Wake's finale

> *"The Blight's last breath, still raging over the high ground."*

```ts
{
  id: 'stormcrown', index: 13, act: 2, after: 12,
  name: 'Stormcrown', icon: <lightning icon>,
  text: 'The Blight’s last breath, raging over the high ground.',
  veil: 'A storm sits on the high ground. It never breaks.',
  pool: [
    { enemy: 'groundling', from: 1, weight: 1 },
    { enemy: 'conductor', from: 5, weight: 0.1 },
    { enemy: 'squallcaller', from: 10, weight: 0.25 },
  ],
  beats: {
    5: { kind: 'introduce', enemy: 'conductor', packs: 1 },
    10: { kind: 'introduce', enemy: 'squallcaller', packs: 2 },
    15: { kind: 'swarm', countMult: 1.5 },
  },
  rule: { name: 'Storm', text: 'Lightning strikes the toughest body, unless a Conductor stands.',
          effect: { kind: 'storm', every: 5, damage: 0.1, wall: 3 } },
  surge: { text: 'The storm quickens: strikes come a fifth sooner.', effect: { kind: 'rule' } },
  boss: 'thunderhead',
  tint: '#26303a',
  elites: { from: 5, every: 4, auras: ['haste', 'regen', 'shield', 'charged', 'vengeful'] },
}
```

**The rule (§4.5).** Every `every` (5 s), lightning strikes the targetable,
non-boss body with the most HP left, for `damage` (10%) of its Max HP. **While
a Conductor lives, the strike hits the tower instead**, for `wall` (3) × that
wave's contact damage, through `hurtTower` (so armour, Aegis, shields and
Thorns apply).

**Natives**

| id | name | text (R4) | hp | speed | radius | damage | atk | armor | pack | xp | mass | shape | verb |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `groundling` | Groundling | Grounded: the storm never strikes it. | 1 | 75 | 21 | 1 | 1 | 0 | [1, 2] | 1 | 1 | square | `{ kind: 'grounded' }` |
| `conductor` | Conductor | Plants a rod: while it stands, lightning strikes the tower. | 2.4 | 40 | 26 | 0.8 | 1 | 0.05 | [1, 1] | 2.6 | 2 | hexagon | `{ kind: 'conduct', standoff: 300 }` |
| `squallcaller` | Squallcaller | Throws bolts from afar; each one brings the next strike sooner. | 1.1 | 60 | 20 | 0.8 | 1 | 0 | [1, 2] | 1.2 | 1 | triangle | `{ kind: 'squall', standoff: 260, interval: 2.5, shotSpeed: 360, hasten: 0.75 }` |

A Conductor stops at 300, inside the tower's range. Its verb has a
`standoff`, so `standoffFirst` (Drones) hunts it, and `toughness()` ranks it
above an elite (§4.5), so Sunlance holds on it. That's D-18's answer to idle
play.

Lore: Groundling *"Born in the storm, and the storm leaves it be."* ·
Conductor *"It carries a rod of the old kings' iron. The sky remembers it."* ·
Squallcaller *"It speaks to the clouds, and the clouds answer quickly."*

Colours: Groundling `#4a4a3a` / `#c8c8a0`; Conductor `#2a3a5a` / `#ffe066`
(the halo is drawn in the palette's `gold`, §9.1); Squallcaller `#3a4a6a` /
`#a0c0ff`.

**Elite aura: Charged** (in place of `split`): `{ id: 'charged', name:
'Charged', text: 'It and its neighbours are grounded: the storm passes them by.',
radius: 160 }` (§6). This changes the original plan's "strikes the closest
body on death", which helped the player and so was no hazard.

**Boss: the Thunderhead**

```ts
{
  id: 'thunderhead', name: 'The Thunderhead', icon: <storm cloud icon>,
  text: 'Throws its own lightning, calls Conductors, then becomes the storm.',
  hp: 65, armor: 0.02, speed: 22, radius: 78, standoff: 250, damage: 4,
  xp: 130, shards: 600, mass: 30, relicSlot: true,   // D-13
  phases: [
    { below: 1, line: 'It throws its own bolts at the wall.',
      patterns: [{ kind: 'bolt', every: 6, windup: 1, damage: 3 }] },
    { below: 0.66, line: 'It calls Conductors, two at a time. Break the rods.',
      patterns: [
        { kind: 'bolt', every: 7, windup: 1, damage: 3 },
        { kind: 'summon', enemy: 'conductor', packs: 2, every: 14 },
      ] },
    { below: 0.33, line: 'It becomes the storm: strikes come twice as fast, and fork.',
      patterns: [
        { kind: 'tempest', pace: 0.5, forks: 2 },
        { kind: 'summon', enemy: 'conductor', packs: 1, every: 12 },
      ] },
  ],
  color: '#1e2630', borderColor: '#ffe066',
  lore: 'The last of the Blight, unwilling to end. It is mostly weather now.',
}
```

`bolt` and `tempest` are new patterns (§7).

**Its fall opens the Abyss.** `WAKE_FINALE = 'thunderhead'` (§8.2). The
ceremony's line *"Something stirs below"* moves here from the Blight (§8.4).

**Surge.** `rule`: the storm strikes ×0.8 as often per rank
(`BALANCE.wake.storm.surge`).

**Ground.** Slate with rain streaks, `#26303a`. The rim flashes on each strike.
Music: loop `[[0,3,7],[1,5,8],[0,3,7],[-2,1,5]]`, figure `'pulse'`,
`REGION_SHIFT[13] = 6`.

---

## 3. Shared types, state and events

### 3.1 Content types (`src/content/types.ts`)

**`RegionDef`** gains:

```ts
/** 1: Act 1's six. 2: the Wake (plans/late-game/12). The Abyss and Boss Rush build their own and inherit 1. */
readonly act: 1 | 2;
/** The region whose boss's first fall opens this one; null for the first (§8.1). */
readonly after: number | null;
/** The Map's silhouette line before it opens (≤ 15 words); Act 1's silhouettes use their boss instead. */
readonly veil?: string;
```

Act 1's six get `act: 1` and `after: index − 1` (`null` for the Ashen
Fields). `strataFloor` (`content/abyss.ts`) spreads `...REGIONS[0]` and
`rushStage` spreads its home region. Both inherit `act` and `after`, which is
harmless because `regionUnlocked` never reads them for 7 or 8. Still, set
`act: 1, after: null` explicitly in both builders, so the field means
nothing there.

**`RegionRule`** gains five members. Their numbers sit on the rule, not the
region, so a stratum could reuse one later:

```ts
/** Toll: bodies move only in the `window` s after each toll, every `every` s. */
| { readonly kind: 'toll'; readonly every: number; readonly window: number }
/** Orbit: a body's step turns sideways by `tangent` of its inward part. */
| { readonly kind: 'orbit'; readonly tangent: number }
/** Glide: a push becomes a slide of `carry` × the push, decaying at `friction` per s; touching bodies take `impact`. */
| { readonly kind: 'glide'; readonly carry: number; readonly friction: number; readonly impact: number }
/** Giants: `count` × the bodies, each `size` × the radius, `hp` × the HP and `reward` × the pay. */
| { readonly kind: 'giants'; readonly count: number; readonly size: number; readonly hp: number; readonly reward: number }
/** Storm: every `every` s a strike takes `damage` of the toughest body's Max HP; with a Conductor up, `wall` × the wave's hit lands on the tower. */
| { readonly kind: 'storm'; readonly every: number; readonly damage: number; readonly wall: number }
```

`regionMods` returns `[]` for all five. They are read where they act, as
Cinders and Echoes are.

**`EnemyId`** gains: `'ringer' | 'sleepwalker' | 'straggler' | 'satellite' |
'comet' | 'moon' | 'skater' | 'floe' | 'sledge' | 'titan' | 'tick' |
'herdkeeper' | 'groundling' | 'conductor' | 'squallcaller'`.

**`EnemyVerb`** gains (with doc comments in the file's style):

```ts
| { readonly kind: 'ring'; readonly hasten: number }          // Ringer: each alive multiplies the toll's interval by `hasten`
| { readonly kind: 'sleepwalk'; readonly pace: number }       // Sleepwalker: ignores Toll, walks at `pace` × speed
| { readonly kind: 'offbeat' }                                // Straggler: its own toll, half an interval after the bell's
| { readonly kind: 'streak' }                                 // Comet: ignores Orbit
| { readonly kind: 'lane'; readonly radius: number; readonly sweep: number } // Moon: circles at `radius` for `sweep` radians first
| { readonly kind: 'slab'; readonly shatter: number }         // Floe: a body slid into it takes `shatter` × the impact; it never slides
| { readonly kind: 'sledge'; readonly reach: number }         // Sledge: latches the body within `reach` ahead and pushes it as one
| { readonly kind: 'trample'; readonly smaller: number }      // Titan: swallows bodies under `smaller` × its radius it overlaps
| { readonly kind: 'ride'; readonly reach: number }           // Tick: rides a host within `reach`, untargetable, until it falls
| { readonly kind: 'herd'; readonly radius: number; readonly shield: number } // Herdkeeper: a walking ward
| { readonly kind: 'grounded' }                               // Groundling: the storm never strikes it
| { readonly kind: 'conduct'; readonly standoff: number }     // Conductor: while alive, strikes hit the tower
| { readonly kind: 'squall'; readonly standoff: number; readonly interval: number; readonly shotSpeed: number; readonly hasten: number } // Squallcaller
```

**`AuraId`** gains `'resonant' | 'tidal' | 'anchored' | 'towering' |
'charged'`, and `AURAS` (`content/enemies.ts`) gains the five entries given
in §2.

**`BossId`** gains `'carillon' | 'astrolabe' | 'leviathan' | 'colossus' |
'thunderhead'`.

**`BossPattern`** gains (§7 has what each does):

```ts
| { readonly kind: 'peal'; readonly speed: number; readonly damage: number }       // always on: each toll rolls a ring from the boss
| { readonly kind: 'quicken'; readonly every: number; readonly factor: number }    // every `every` s, the toll's interval × factor
| { readonly kind: 'reverse'; readonly every: number }                             // every `every` s, the Orbit's spin flips
| { readonly kind: 'floes'; readonly count: number; readonly every: number; readonly ring: boolean } // stationary Floes
| { readonly kind: 'weakpoint'; readonly arc: number; readonly spin: number; readonly mult: number } // always on
| { readonly kind: 'feast'; readonly every: number; readonly radius: number; readonly heal: number } // eats a Titan to heal
| { readonly kind: 'bolt'; readonly every: number; readonly windup: number; readonly damage: number } // a strike on the tower
| { readonly kind: 'tempest'; readonly pace: number; readonly forks: number }      // always on: the storm's clock × pace, each strike forks
```

**`BossPlates`** gains `readonly orbit?: number`: rad/s the plates circle
the boss at, evenly spaced, in place of a fan toward the tower (§7.2).

**`RelicId`** gains the 20 ids in §8.9. **`BehaviourId`** gains the
behaviour ids in §8.9. **`TrimId`** gains `'bells' | 'orrery' | 'icicles' |
'ribs' | 'rods'` (§8.8).

### 3.2 Sim state (`src/sim/state.ts`)

**`Enemy`** gains these fields. Every literal that builds an `Enemy` must set
them: `spawnEnemy` (`waves.ts`), `arriveBoss` (`boss.ts`) and
`tests/helpers/body.ts`.

```ts
/** Glide (plans/late-game/12 §4.3): slide velocity, world units/s; 0 when not sliding. */
slideX: number;
slideY: number;
/** Run time of its last impact while sliding, for the cooldown. */
impactAt: number;
/** A Sledge's load: the id it pushes (on the Sledge), and the Sledge's id (on the load). 0: none. */
towing: number;
towedBy: number;
/** A Tick: 0 looking for a host, > 0 the host's id while riding, −1 once it has ridden. */
riding: number;
/** A Moon: radians swept in its lane so far; ≥ its `sweep` once done. */
lane: number;
/** Per step, from auras (reset in `applyAuras`): Tidal's tangent multiplier, Anchored, Charged. */
buffOrbit: number;
braced: boolean;
grounded: boolean;
/** Tick Bite (a relic): marked by a crit, it takes more. */
marked: boolean;
/** Skate Blade (a relic): run time until which a pushed body takes more. */
pushedUntil: number;
```

Defaults: `0` for numbers, `false` for booleans, `buffOrbit: 1`, `riding: 0`.

**`RunState`** gains:

```ts
/** The Wake's rule state (plans/late-game/12 §3.2); null outside a Wake region. Absent on older snapshots. */
wake: WakeState | null;
```

```ts
export interface WakeState {
  /** Toll: the next toll's time, the last toll's, the boss's quickening (×, starts 1), and the last interval used. */
  toll: { next: number; last: number; pace: number; interval: number } | null;
  /** Orbit: the spin (+1 counter-clockwise, −1 clockwise) and the wave it was rolled for. */
  orbit: { spin: 1 | -1; wave: number } | null;
  /** Storm: the next strike's time. */
  storm: { next: number } | null;
}
```

`createRun` builds it from the starting region's rule (only one of the three
is non-null, the one matching the rule). `toll.next = BALANCE.waves.firstWaveDelay`,
`toll.last = −1e9`, `toll.pace = 1`, `toll.interval = every`; `orbit = { spin: 1,
wave: 0 }`; `storm.next = rule.every`. Use `null` for a non-Wake region, an
Omen in an Act 1 region, the Abyss and Boss Rush.

**`HurtBy`** gains `'storm'`. `ui/results.ts`'s label table gains
`storm: 'Lightning'`.

**`DamageSource`** (`combat.ts:130`) gains `'impact' | 'storm'`. `damageBy`
maps both to `'rule'` through its `default`, so neither counts as a weapon's
worth (I4). That's intended.

**`SNAPSHOT_VERSION`** goes 22 → 23 (`meta/save/index.ts`). `RunState` and
`Enemy` change shape. `PROFILE_VERSION` doesn't change: the profile gains no
field (D-11, §8.5).

### 3.3 The RNG stream

`createRun` adds `wake: root.split('wake').state` to `streams`. `split` leaves
the root as it is, so every existing seed plays exactly as before. The
`wake` stream is used for the Orbit's per-wave spin, where `floes` land, and
nothing else.

### 3.4 Sim events (`SimEvent`)

```ts
| { kind: 'toll'; x?: number; y?: number; relic?: boolean } // the bell (no x/y: from the rim); the Clapper relic's (relic: true)
| { kind: 'strike'; x: number; y: number; tower: boolean }  // lightning lands (on a body, or on the tower)
| { kind: 'impact'; x: number; y: number; shatter: boolean } // two bodies collide on the ice
| { kind: 'trample'; x: number; y: number }                  // a Titan or the Colossus swallows a body
| { kind: 'hop'; x: number; y: number }                      // a Tick leaps off its host
| { kind: 'orbitTurn'; spin: number }                        // the Astrolabe reverses the field
| { kind: 'floe'; x: number; y: number }                     // the Leviathan cracks a floe loose
```

Every consumer that switches on `SimEvent['kind']` exhaustively
(`audio/cues.ts`, `render/renderer.ts`, `render/effects.ts`) needs a case
(§9). Where a consumer has no use for one, add it to the list of kinds it
ignores.

### 3.5 Balance (`src/content/balance.ts`)

A new top-level section. The numbers are starting points for §14.

```ts
/** The Wake (plans/late-game/12): its rules' per-rank surges and limits, its Starlight. */
wake: {
  /** D-5: a Wake region's heat record pays this share of Starlight. */
  heatStarlight: 0.5,
  /** D-5: Starlight for each Wake boss's first fall. */
  lump: 25,
  toll: {
    /** The lurch keeps a tolled body's average speed at this share of its own. */
    average: 0.9,
    /** Blight Surge: the lurch carries this much further per rank. */
    surge: 1.25,
    /** Each Ringer alive multiplies the interval by its `hasten`, down to this share. */
    floor: 0.6,
    /** The Carillon's quickening never takes the interval below the window × this. */
    minInterval: 1.2,
  },
  orbit: {
    /** Blight Surge: the tangent's multiplier per rank, and its ceiling (below 1: a spiral, never a ring). */
    surge: 1.3,
    max: 0.95,
  },
  glide: {
    /** Below this speed (units/s) a slide ends and the body walks again. */
    min: 12,
    /** Seconds between one body's impacts. */
    cooldown: 0.3,
    /** The share of a slider's velocity passed to what it hits. */
    transfer: 0.5,
    /** Impact damage reads speed up to this (units/s), as a share of it. */
    cap: 600,
    /** Under Glide, a blast (Mortar, a rune, a shatter) pushes what it hits this far out from its centre… */
    blastPush: 24,
    /** …and a Frost Ring pulse pushes this far out from the tower. */
    pulsePush: 10,
  },
  giants: {
    /** Blight Surge: size and HP multiply by this per rank. */
    surge: 1.25,
  },
  storm: {
    /** Blight Surge: the interval multiplies by this per rank. */
    surge: 0.8,
  },
},
```

`BALANCE.elites` gains `resonant: 1.8`, `tidal: 2` and `towering: 0.6`.
`BALANCE.relics` gains the rank tables in §8.9. `BALANCE.omen` changes as in
§8.10.

---

## 4. The five rules: mechanics

Put the rule clocks in a new file, **`src/sim/systems/wake.ts`**. It holds
`tickWake(run, region, dt)` (toll clock, orbit spin, storm clock and the
Wake relics' clocks) and the small read helpers below. In `sim/run.ts#step`,
call `tickWake(run, region, dt)` **after `tickBoss` and before
`tickEnemies`**, so the toll window and storm targets are fresh when bodies
move. Its first line is `if (!run.wake && !wakeRelics(run)) return;`.

Helpers to export from `wake.ts`:

```ts
/** The run's Wake rule of `kind`, with its Blight Surge rank, or null. */
export function wakeRule<K extends RegionRule['kind']>(run: RunState, kind: K): { rule: Extract<RegionRule, { kind: K }>; surge: number } | null
```

It reads `runRegion(run).rule?.effect`, checks the kind, and pairs it with
`ruleSurge(pactLoad(run.pacts), runRegion(run))`.

### 4.1 Toll (S)

**Clock (`tickWake`).**

```ts
const t = run.wake.toll;   // non-null under Toll
if (run.time >= t.next) {
  const ringers = count of alive, non-hidden bodies whose verb is 'ring';
  const hasten = Math.max(BALANCE.wake.toll.floor, Math.pow(ringVerb.hasten, ringers));
  const minI = rule.window * BALANCE.wake.toll.minInterval;
  t.interval = Math.max(minI, rule.every * hasten * t.pace);
  t.last = run.time;
  t.next = run.time + t.interval;
  run.events.push({ kind: 'toll' });
  // The Carillon's peal (§7.1) rolls here too.
}
```

Read the Ringer count once per toll, never per step. That keeps the clock
deterministic and cheap.

**Movement (`tickEnemies`).** Add a factor `bell` to the walking step. It's
computed by a helper `tollFactor(run, e, verb)` in `wake.ts`:

```ts
// 1 when Toll doesn't apply to this body; 0 outside its window; the lurch inside it.
if (!run.wake?.toll) return 1;
if (e.boss || e.court || e.plate) return 1;
if (verb?.kind === 'sleepwalk') return verb.pace;          // never stops, half pace
if (verb?.kind === 'charge' && e.dashUntil > run.time) return 1; // mid-charge
const t = run.wake.toll;
const start = verb?.kind === 'offbeat' ? t.last + t.interval / 2 : t.last;
if (run.time < start || run.time >= start + rule.window) return 0;
const surge = Math.pow(BALANCE.wake.toll.surge, s);
return (t.interval / rule.window) * BALANCE.wake.toll.average * surge;
```

In `tickEnemies`, multiply `stepLen` by `bell` and treat `bell === 0` as
"stands this step": `e.moving = false`, and it skips to the contact or
acting branches as a body at its stop would. **Careful:** a body that stands
mid-field must not take the "at the wall" branch. Today's code goes to
contact or acting only when `d ≤ stop`, so with `bell === 0` and `d > stop`,
`continue` straight after setting `e.moving = false`.

**Exemptions:** bosses, the Hollow King's court, plates, Sleepwalkers, a
Ram mid-charge. Knockback and Glide slides are never gated. A Blinker's
blink happens in `before()`, so it is never gated either. That's fine: it
reads as "the Blinker cheats the bell".

**Stillwater Charm** (`still-target`) reads `!e.moving`, so under Toll it's
strong. That's intended ("Favours stationary-crowd weapons"). Watch it in
`npm run arsenal` (§14).

**Tests** (`tests/wake.test.ts`):
- A Ringer-free Toll run: a grunt-like body placed at 500 doesn't move while
  `run.time − toll.last ≥ window`, and over 30 s its average speed is within
  2% of 0.9 × its speed.
- Ten Ringers alive: the next interval is `every × 0.6` (the floor).
- A Sleepwalker moves every step at half pace.
- A Straggler's window starts half an interval after the bell's.
- The boss walks to its standoff ignoring the bell.

### 4.2 Orbit (S)

**Spin (`tickWake`).** When `run.wake.orbit.wave !== run.wave`, set `spin =
Rng.wrap(run.streams.wake).chance(0.5) ? 1 : −1` and `orbit.wave =
run.wave`.

**Movement.** In `tickEnemies`, replace the radial step for orbiting bodies
with a helper `orbitStep(run, e, verb, len, d, stop)` from `wake.ts`:

```ts
// k: the sideways share. 0 for bodies that walk straight.
const k = orbitShare(run, e, verb);    // tangent × 1.3^s, capped at 0.95, × e.buffOrbit; 0 if exempt
const rx = -e.x / d, ry = -e.y / d;    // inward unit
const tx = -ry * spin, ty = rx * spin; // sideways unit
const n = Math.hypot(1, k);
const inward = Math.min(len / n, d - stop);   // never past the stop
const side = (inward * k);
e.x += rx * inward + tx * side;
e.y += ry * inward + ty * side;
```

Exempt (k = 0): bosses, court, plates, `streak` (Comet), `burrow` while
under, `blink`, `phase` while hidden, and `heading < 0` (walking out has its
own function). A body in contact with the wall doesn't orbit: the
separation pass already slides crowds round the wall.

**The Moon (`lane`).** Before the orbit step: if `verb.kind === 'lane'` and
`e.lane < verb.sweep` and `d ≤ verb.radius + 1`, move purely sideways by
`len` at radius `d` (`angle += spin × len / d`, then set `x, y` from it), and
add `len / d` to `e.lane`. Otherwise walk in as usual (and, outside its
lane, orbit as everything else does).

**Exhaustive switches:** `walksIn` (`sim/strata.ts`) treats `streak` and
`lane` as walking in (`true`).

**Tests:** under Orbit with `tangent 0.6`, a body's radial distance shrinks
monotonically and its angle changes, and it reaches the wall in 1.12–1.22×
the time a straight walker takes. A Comet's angle never changes. A Moon
spends ≥ π × 320 / speed seconds at 320 ± 1.

### 4.3 Glide (M)

**The push.** Change `knockBack` to take the run and an optional origin:

```ts
export function knockBack(run: RunState, e: Enemy, push: number, from?: { x: number; y: number }): void
```

Update its three callers (`combat.ts:1640`, `:1834`, `ultimate.ts:68`).
Outside Glide it does exactly what it does today (radial, from the tower).
Under Glide (`wakeRule(run, 'glide')`):

```ts
if (e.braced || e.towedBy !== 0 && towOf(e)?.braced) return;  // Anchored
const ox = from?.x ?? 0, oy = from?.y ?? 0;
const dx = e.x - ox, dy = e.y - oy; const d = Math.hypot(dx, dy) || 1;
let mass = e.mass;
// A Sledge and its load move as one: the push is shared over both.
const pair = sledgePartner(run, e);
if (pair) mass += pair.mass;
const v = (push * leviathan(run) / Math.max(mass, leviathanFloor(run))) * rule.carry * rule.friction;
e.slideX += (dx / d) * v; e.slideY += (dy / d) * v;
if (pair) { pair.slideX = e.slideX; pair.slideY = e.slideY; }
e.inContact = false;
e.pushedUntil = run.time + skateSeconds(run);   // Skate Blade (§8.9); 0 seconds without it
```

`v` uses `× friction` so the slide's total distance (`v / friction` under
exponential decay) is `carry × push / mass`, three times today's shove.

**Blasts push under Glide (D-22).** In `burstAt(run, x, y, …, source, …)`
(`combat.ts:1224`), after damage, for each body it hit that is still alive
and not a boss: if Glide applies and `source` is `'lob'`, `'mine'` or
`'shatter'`, call `knockBack(run, e, BALANCE.wake.glide.blastPush, { x, y })`.
Find where a Frost Ring pulse damages bodies (`case 'pulse'` near
`combat.ts:399`/`:676`) and do the same with `pulsePush` and no `from`
(so outward from the tower).

**The slide (`tickEnemies`).** At the top of the per-body loop, before the
stun check, so a stunned body still slides:

```ts
if (e.slideX !== 0 || e.slideY !== 0) {
  e.x += e.slideX * dt; e.y += e.slideY * dt;
  const keep = Math.exp(-rule.friction * dt);
  e.slideX *= keep; e.slideY *= keep;
  if (Math.hypot(e.slideX, e.slideY) < BALANCE.wake.glide.min) { e.slideX = 0; e.slideY = 0; }
  // Never inside the wall: a slide toward the tower stops at the body's stop.
  clampToStop(run, e);
  e.moving = true;
  continue;   // a sliding body neither walks nor hits
}
```

`Math.exp` is deterministic on one machine and across runs of the same
build. That's the same guarantee the sim already relies on for
`Math.hypot`.

**Impacts.** A new `glideImpacts(run)` in `enemies.ts`, called from `step`
right after `separateEnemies(run)`, so it reuses the grid built there. Only
under Glide:

```ts
for each alive body s with a slide (|slide| > 0) and run.time − s.impactAt ≥ cooldown:
  for each alive, not hidden body o ≠ s overlapping s (grid query, radius s.radius + biggest):
    if (o.boss || o.plate || o.court || o.riding > 0) continue;
    const speed = Math.min(Math.hypot(s.slideX, s.slideY), BALANCE.wake.glide.cap);
    let hit = rule.impact * (speed / 100) * s.mass * waveHp(runRegion(run), s.wave);
    const slab = ENEMY_BY_ID[o.type].verb.kind === 'slab';
    damageEnemy(run, o, hit, false, 'impact');
    damageEnemy(run, s, slab ? hit * verbOf(o).shatter : hit, false, 'impact');
    if (!slab && !o.braced) { o.slideX += s.slideX * transfer; o.slideY += s.slideY * transfer; }
    s.slideX *= 1 − transfer; s.slideY *= 1 − transfer;
    s.impactAt = run.time;
    run.events.push({ kind: 'impact', x: (s.x + o.x) / 2, y: (s.y + o.y) / 2, shatter: slab });
    break;   // one impact per slider per cooldown
```

`waveHp` scales the hit with the region, so a slide is worth the same at
wave 3 and wave 19. A Floe (`slab`) is never moved by a transfer. That's
what makes it an anvil.

**The Sledge (`sledge`).** In `before()`, for a Sledge with `towing === 0`:
find the nearest turnable body `o` with `towedBy === 0` that is closer to the
tower than the Sledge, within `s.radius + o.radius + verb.reach` of it.
Latch: `s.towing = o.id; o.towedBy = s.id`. A towed body skips its own walk
(treat it like a plate in `tickEnemies`: `if (e.towedBy) continue;` after
the slide block). After the loop, `placeTowed(run)`: for each body with
`towedBy`, find its Sledge. If the Sledge is dead or its load reached its
own stop distance, release both (`towing = towedBy = 0`) and the load walks
on, attacks and is shoved as usual. Otherwise put the load at the Sledge's
position + inward unit × (`s.radius + o.radius`). Release also happens when
either dies, in `kill`.

**Performance.** The impacts pass runs only under Glide and only for
sliding bodies. Add a frame-budget case (§11) with 300 bodies, a third of
them sliding.

**Tests:**
- Glide off: `knockBack` moves a body `push / mass` straight out, exactly as
  before (a regression test on the old numbers).
- Glide on: a body pushed by 16 at mass 1 slides `carry × 16 ± 5%` and stops
  in under 1.5 s. A slider hitting a body deals the formula's damage to
  both, once per cooldown. A slider into a Floe takes ×3 and the Floe doesn't
  move.
- An Anchored elite's neighbour doesn't slide.
- A Sledge latches the body ahead, and both stop when either dies.

### 4.4 Giants (S)

**Count (`rollWave`).** After `count` is computed from the region and the
beat, and before the introduce packs are subtracted:

```ts
if (region.rule?.effect.kind === 'giants') count = Math.max(1, Math.round(count * region.rule.effect.count));
```

`rollWave` stays pure. Introduce packs and elites are unchanged, so a beat's
new type still walks in visibly.

**Size, HP and pay (`spawnEnemy`).** After `hp`, `radius` and the
elite/Champion multipliers, and before the object is built:

```ts
const g = giantsOf(run, region);   // null outside Giants; else size/hp with the surge folded in
if (g && !opts.fragment) {
  hp *= g.hp; radius *= g.size;
  xpMult = g.reward; shardMult = g.reward; massMult = g.size * g.size;
}
```

`giantsOf` folds the surge: `size × 1.25^s`, `hp × 1.25^s`, and `reward`
unchanged. Bosses don't go through `spawnEnemy`, so they aren't giants.
Their summons are.

**Radius bound (important).** `separateEnemies` finds neighbours within
`e.radius + biggest`, where `biggest` comes from the module constant
`MAX_RADIUS`. Under Giants, bodies are up to 1.6 × 1.25³ ≈ 3.1× larger.
Change the line that computes `biggest` to also multiply `MAX_RADIUS` by
`giantSize(run)` (1 outside Giants), or bodies will overlap without being
pushed apart. The same goes for `glideImpacts` and `trampleAll`.

**Trample (`trampleAll(run)`, in `enemies.ts`).** Called right after
`separateEnemies`. For each alive Titan `t`, query the grid for bodies `o`
overlapping it with `o.radius < t.radius × verb.smaller`, and not a boss,
plate, court, keeper or riding Tick. Swallow `o`: `o.alive = false`, decrement
`run.current.alive` if `o.wave === run.current.n` (as `escape` does), then
`t.hp += o.hp; t.maxHp += o.hp`, and push `{ kind: 'trample', x: o.x, y: o.y }`.
**No kill, no pay, no XP.** A trampled body was never the tower's kill.

**Ride (`ride`).** In `before()` for a Tick with `riding === 0`: find the
nearest alive, non-boss, non-Tick body within `verb.reach` that no other
Tick rides, and with `radius ≥ 30` (a giant). If one is found, set `riding =
host.id`. While `riding > 0`:
- `targetable()` returns false (add `|| e.riding > 0` next to `e.under`).
- `isHidden()` returns true, so separation ignores it.
- In `tickEnemies`, skip its walk and attack. After the loop, place it on its
  host: host position + inward unit × (host radius × 0.4), so it sits on the
  host's tower-facing side.
- When the host is dead, set `riding = −1`, put it at the host's last
  position, and push `{ kind: 'hop' }`. From then on it walks (and orbits,
  under Orbit) as a normal body.

**Herd (`herd`).** In `applyAuras`, next to the Wardstone's ward: for each
alive Herdkeeper, every other body within `verb.radius` gets `buffShield =
min(buffShield, verb.shield)`. It has no standoff and never stops walking.

**Tests:** Giants halves a wave's count (± rounding) and keeps its beats; a
giant has ×3 HP, ×1.6 radius and ×2 shards; a Titan overlapping a smaller
body swallows it and gains its HP with no kill counted; a Tick can't be
targeted while it rides and hops off when the host dies; two giants
overlapping are separated (the radius-bound fix).

### 4.5 Storm (M)

**Clock (`tickWake`).**

```ts
const st = run.wake.storm;
if (run.time >= st.next) {
  const tempest = bossTempest(run);          // the Thunderhead's phase 3, or null
  const pace = Math.pow(BALANCE.wake.storm.surge, s) * (tempest?.pace ?? 1);
  st.next = run.time + rule.every * pace;
  strike(run, rule, tempest?.forks ?? 1);
}
```

`strike(run, rule, forks)`:
1. If any alive, non-hidden body has the `conduct` verb: `hurtTower(run,
   rule.wall × waveDamage(runRegion(run), run.wave), 0, 0, null, 'storm')`,
   and push `{ kind: 'strike', x: 0, y: 0, tower: true }` once. Forks don't
   multiply a tower strike.
2. Else pick up to `forks` targets: targetable bodies that are not a boss,
   court or plate, not `grounded`, and whose verb isn't `grounded`, sorted by
   `hp` descending, then distance to the tower ascending, then `id`
   ascending. For each, `damageEnemy(run, e, e.maxHp × rule.damage, false,
   'storm')` and push `{ kind: 'strike', x: e.x, y: e.y, tower: false }`.

**The Squallcaller.** Treat `squall` exactly like `ranged` in
`tickEnemies` (stand off, lob shots). When it fires, also do
`if (run.wake?.storm) run.wake.storm.next -= verb.hasten`. This brings the
next strike sooner. It's a change from the original "hits shorten" wording,
because firing is deterministic and readable.

**The Conductor.** `stopDistance` returns `verb.standoff` for `conduct` and
`squall`. In `tickEnemies`, add `conduct` to the "stands off and never
touches the wall" line (`verb?.kind === 'ward' || 'tide'`).

**Aim (D-18).** In `combat.ts#toughness`, return 1.5 for a body whose verb is
`conduct` (between elite 1 and boss 2), so `toughest` weapons (Sunlance)
lock on to it ahead of elites. `STANDOFF` already includes every verb with a
`standoff` key, so Drones hunt Conductors and Squallcallers first. That's the
whole idle answer. The Tactician's list isn't involved.

**Grounding.** In `applyAuras`, reset `e.grounded = false` each step. A
`charged` elite sets `grounded = true` on itself and every body within 160.

**Tests:** with no Conductor, a strike lands on the highest-HP non-boss body
for 10% of its Max HP, credited `'rule'`; with a Conductor alive, it lands on
the tower through `hurtTower` (armour applies, Aegis blocks it); a Groundling
and a Charged elite's neighbours are never struck; a Squallcaller's shot
brings `storm.next` 0.75 s closer; a Conductor is `toughest`'s first pick
over an elite; Drones shoot it first.

### 4.6 Surges

| Region | `surge.effect` | What a rank does | Where it's read |
|---|---|---|---|
| Bell Marches | `rule` | the lurch × 1.25 | `tollFactor` |
| Orrery | `rule` | tangent × 1.3, max 0.95 | `orbitShare` |
| Frozen Sea | `stat` | attack speed −10% | `surgeMods` (no new code) |
| Giants' Rest | `rule` | size × 1.25, HP × 1.25 | `giantsOf` |
| Stormcrown | `rule` | interval × 0.8 | `tickWake` |

`content/lint.ts` already fails a `rule` surge on a region with no rule.

---

## 5. Natives: every switch they touch

When you add the 13 new verbs, `npm run typecheck` will flag these switches.
Here is the intended answer for each.

| Switch | New verbs and what they return |
|---|---|
| `stopDistance` (`enemies.ts`) | `conduct`, `squall` → `max(wall, verb.standoff)`; the rest → `wall` |
| `before()` (`enemies.ts`) | `sledge` → latch (§4.3); `ride` → find a host (§4.4); `ring`, `sleepwalk`, `offbeat`, `streak`, `lane`, `slab`, `trample`, `herd`, `grounded`, `conduct`, `squall` → nothing |
| `firstAct` (`waves.ts`) | `squall` → `interval × 0.5`; the rest → 0 |
| `walksIn` (`sim/strata.ts`) | `ring`, `sleepwalk`, `offbeat`, `streak`, `lane`, `slab`, `sledge`, `trample`, `ride`, `herd`, `grounded` → `true`; `conduct`, `squall` → `false` |
| `applyAuras` aura switch | `resonant`, `tidal`, `anchored`, `charged` act on neighbours (§6); `towering` → nothing here |
| any painter switch on verb | draw as `walker` unless §9.1 says otherwise |

Also give each native:
- a `GAIT` entry (`render/painters/enemies.ts`): Ringer `hop 6 1.2`;
  Sleepwalker `float 1.4 1.6`; Straggler `skitter 10 1.4`; Satellite `float
  3 1.2`; Comet `skitter 18 1`; Moon `float 1.2 1`; Skater `slither 8 1`;
  Floe `waddle 1.6 0.4`; Sledge `waddle 3 0.8`; Titan `waddle 2.6 1`; Tick
  `skitter 16 1.6`; Herdkeeper `waddle 3.2 0.8`; Groundling `hop 6 1`;
  Conductor `waddle 2.4 0.6`; Squallcaller `float 2.4 1.6`.
- a `counters` home on at least one **Act 1** weapon (lint T3a), and a
  `weakAgainst` entry where the rule strains a weapon. This also steers
  `sim/suggest.ts`'s scorer and Twin Mount (`twinSpares`), with no new
  scorer code:

| Weapon (`content/weapons.ts`) | add to `counters` | add to `weakAgainst` |
|---|---|---|
| `arcane-bolt` | `squallcaller`, `comet` | — |
| `scattershot` | `skater`, `ringer`, `straggler` | `floe` |
| `chain-lightning` | `straggler`, `satellite`, `groundling` | `titan` |
| `frost-ring` | `satellite`, `skater`, `tick` | — |
| `mortar` | `ringer`, `sleepwalker`, `skater` | `titan` |
| `sunlance` | `titan`, `herdkeeper`, `conductor`, `moon`, `floe` | `comet` |
| `glaives` | `satellite`, `comet`, `tick` | — |
| `sentinel-drones` | `conductor`, `squallcaller`, `sledge` | — |

Lint also fails a weapon that both counters and is weak against the same
type. The table avoids that.

---

## 6. Elite auras

| Aura | Region | Radius | What it does | Where |
|---|---|---|---|---|
| `resonant` | 9 | 160 | neighbours' `buffSpeed = max(buffSpeed, BALANCE.elites.resonant)`. Under Toll, moving faster in the window *is* lurching further. | `applyAuras` |
| `tidal` | 10 | 160 | neighbours' `buffOrbit = max(buffOrbit, BALANCE.elites.tidal)` (reset to 1 each step). `orbitShare` multiplies by it **before** the 0.95 cap. | `applyAuras`, `orbitShare` |
| `anchored` | 11 | 160 | it and neighbours `braced = true` (reset each step); `knockBack` and slide transfers skip braced bodies | `applyAuras`, `knockBack`, `glideImpacts` |
| `towering` | 12 | 0 | a non-crit hit on it lands at `BALANCE.elites.towering` (0.6) | `damageEnemy`, after the Mirror Shard crit line: `if (e.aura === 'towering' && !crit) raw *= …` |
| `charged` | 13 | 160 | it and neighbours `grounded = true` (reset each step) | `applyAuras`, `strike` |

Add each to `AURA_COLOR` (`render/painters/enemies.ts`): resonant `gold`,
tidal `mana`, anchored `frost`, towering `critical`, charged `arcane`. The
comment there says each region's own aura shares a colour only with an
aura its region lacks. Check that against each Wake region's list.

Each region's `elites.auras` swaps exactly one of the base five for its own,
as N3 does. `split` is listed in Giants' Rest on purpose: a split giant
bursts into three giants.

---

## 7. Bosses: new patterns and the plates' orbit

### 7.1 The pattern kinds

Extend `period(p)` in `boss.ts`. `peal`, `weakpoint` and `tempest` are always
on (return 0, like `mirror`). The rest use their `every`. Then add a
`case` in `tickBoss`'s pattern switch for each:

| Kind | In `tickBoss` | Elsewhere |
|---|---|---|
| `peal` | `b.timers[i] = ONCE` (always on) | In the Toll clock (§4.1), when a toll rings and the boss's current phase has a `peal`, push a `SlamRing` from the boss with the peal's `speed` and `damage × waveDamage(region, b.wave) × fury`, and a `slam` event. Reuses `tickRings`. |
| `quicken` | `run.wake.toll.pace *= p.factor` (the floor in §4.1 still holds) | — |
| `reverse` | `run.wake.orbit.spin *= −1`, push `{ kind: 'orbitTurn', spin }` | Bodies' next steps turn the other way at once. |
| `floes` | Spawn `p.count` Floes with `spawnEnemy(run, region, 'floe', b.wave, x, y)`, then `Object.assign(f, { speed: 0, xp: 0, shards: 0 })`. With `ring: false`, place each at a random angle (`wake` stream) at a distance between the wall + 80 and the boss's standoff − 40. With `ring: true`, place them evenly at the wall + 70, starting at the boss's angle. Push a `floe` event for each. `every: 0` means once, on entering the phase, as `summon` does. | A speed-0 Floe never walks but can be shot, slid into (×3 shatter) and pushed only by a slide transfer (never, it's a `slab`). |
| `weakpoint` | `b.timers[i] = ONCE`. Next to the mirror's line, `b.facet += p.spin × dt` while the pattern is in the phase. | In `damageTaken` (`combat.ts`), for the boss body only: if the phase has a `weakpoint` and `angleDiff(b.facet, atan2(−e.y, −e.x)) ≤ p.arc / 2`, multiply by `p.mult`. Every hit comes from the tower, so "the heart faces you" is when every weapon's hit counts. Export a `weakPoint(run)` helper (like `mirrorFacets`) for the painter. |
| `feast` | Find the nearest alive Titan within `p.radius` of the boss. Swallow it like a trample (no pay), and heal the boss `p.heal × titan.hp` (capped at Max HP). Push `trample`. | — |
| `bolt` | Like `slam`'s windup: set `b.windup = p.windup`, `b.windupPattern = i`, push `windup`. In the windup-release branch, add `if (p?.kind === 'bolt') { hurtTower(run, p.damage × waveDamage × fury, 0, 0, null, 'storm'); push strike(tower: true) }`. Only from its post, as `slam`. | — |
| `tempest` | `b.timers[i] = ONCE` | `tickWake`'s storm clock reads it through `bossTempest(run)`: the current phase's `tempest` pattern while the boss stands, else null. |

`ruleLoad` (`sim/strata.ts`) only reads `kind === 'rule'` patterns, so it
needs no change.

### 7.2 Plates that orbit (the Astrolabe's rings)

`BossPlates.orbit` (rad/s). In `wearPlates`, when `def.plates.orbit` is set,
give plate *k* of *n* the slot `k / n × 2π` (not the fan). In
`placePlates`, when the boss's spec has `orbit`, set each plate's angle to
`o.slot + run.time × orbit` around the boss (not `toward + slot`), at
distance `boss.radius + o.radius × PLATE_REACH`. Everything else (guard,
HP, armour, `dropPlate`, cracking away on a later phase's `plates: 0`) is
Forgeheart's code unchanged.

### 7.3 Painters and motion

`PROFILE` (`render/painters/bosses.ts`) and `BOSS_MOTION`
(`render/bossMotion.ts`) are `Record<BossId, …>`, so TypeScript requires an
entry for each new boss:

| Boss | Silhouette (`PROFILE`) | Motion (`BOSS_MOTION`) |
|---|---|---|
| Carillon | a bell: `1 + 0.18 × max(0, sin(a))` (wide at the bottom), with a lip at the bottom | `{ gait: 'stomp', hz: 0.9, squash: 0.06, bob: 0.02, give: 0.8, lunge: 0.06, shudder: 0.03, sway: 0.02, follow: 0.4 }` |
| Astrolabe | a ring: `0.92 + 0.08 × sign(sin(a × 12))` (a toothed wheel) | `{ gait: 'glide', hz: 0.6, squash: 0, bob: 0.02, give: 0.3, lunge: 0.05, shudder: 0, sway: 0, follow: 0 }` |
| Leviathan | a back breaking the ice: `1 + 0.1 × max(0, sin(a × 3 + t))` | `{ gait: 'roll', hz: 0.8 / (2π), squash: 0.03, bob: 0.03, give: 1, lunge: 0.1, shudder: 0, sway: 0.03, follow: 0.6 }` |
| Colossus | a great head with a jaw: `1 + 0.08 × (−sin(a) > 0.5 ? 1 : 0)` | `{ gait: 'stomp', hz: 0.8, squash: 0.05, bob: 0.03, give: 0.8, lunge: 0.06, shudder: 0.04, sway: 0, follow: 0.3 }` |
| Thunderhead | a cloud: `1 + 0.07 × sin(a × 5 + t × 0.8) + 0.04 × sin(a × 9 − t)` | `{ gait: 'pulse', hz: 0.5, squash: 0.03, bob: 0.02, give: 1.2, lunge: 0.08, shudder: 0.02, sway: 0.03, follow: 0.8 }` |

`paintDetail` cases (optional, but each boss should read as itself): the
Carillon's clapper swings on each `toll`; the Colossus's weak point glows
from `weakPoint(run)`; the Thunderhead flickers on `strike`.

`tests/bossMotion.test.ts` checks every boss in `BOSS_MOTION`. Run it.

---

## 8. Meta

### 8.1 The regions list and the chain

1. Add `act`, `after` (and `veil` on Wake regions) to all eleven
   `RegionDef`s. `REGIONS` stays one list, sorted by index.
2. **`regionUnlocked`** (`meta/collection.ts:64`), after `impact`:

   ```ts
   export function regionUnlocked(profile: Profile, index: number): boolean {
     if (index === 1) return true;
     if (index === ABYSS_INDEX) return abyssOpen(profile);
     if (index === RUSH_INDEX) return rushOpen(profile);
     const r = REGIONS.find((x) => x.index === index);
     if (!r || r.after === null) return false;
     const prev = REGIONS.find((x) => x.index === r.after);
     return !!prev && bossDown(profile, prev.boss);
   }
   ```

   For 2–6 this is the same as today (`after = index − 1`). For 9 it reads the
   Blight. Since the Blight's fall *is* `act2Open`, the Bell Marches opens
   with Act 2 (D-3).
3. Add to `content/regions.ts`:

   ```ts
   /** Act 1's regions, in order (the Map's light, the Act 1 feats and lines). */
   export const ACT1_REGIONS: readonly RegionDef[] = REGIONS.filter((r) => r.act === 1);
   /** The Wake's regions, in the order their chain opens them. */
   export const WAKE_REGIONS: readonly RegionDef[] = chainOrder(REGIONS.filter((r) => r.act === 2));
   /** The Wake's last boss: its first fall opens the Abyss (plans/late-game/12 D-1). */
   export const WAKE_FINALE: BossId = 'thunderhead';
   ```

   `chainOrder` starts at the region whose `after` is an Act 1 index and
   follows `after` links.
4. **`frontier` and `playableFrontier`** stay as they are. They take the
   highest unlocked index, which is the newest Wake region. **Frontier
   March (D-8) needs no code.** `marchOn` moves `profile.region` to
   `playableFrontier`, which never returns 7 or 8 because neither is in
   `REGIONS`. Add a test that proves it: after the Carillon's first fall
   under Frontier March, `profile.region` is 10, and after the Thunderhead's
   it stays 13.
5. **`selectedRegion`** needs no change.
6. **`content/lint.ts`**, a new rule `regionChain`:
   - exactly one region has `after: null`, and it is index 1;
   - every other region's `after` names an existing region with a lower `act`
     or the same `act`, and no two regions share an `after`;
   - following `after` from any region reaches index 1, with no cycle;
   - every `act: 2` region has a `veil` of 1–15 words;
   - the boss of the last region in the Act 2 chain is `WAKE_FINALE`. Add
     this check in step 4, when Stormcrown exists. Before then it can't
     pass.
7. **`LAST_LIGHT`** gets five entries (`tests/contrast.test.ts` holds them at
   5:1).

### 8.2 The Abyss gate: `abyssOpen` and every `act2Open`

Add to `meta/collection.ts`, next to `act2Open`:

```ts
/** The Abyss (and so Boss Rush, waypoints, cursed relics): open once the Thunderhead, the Wake's last boss, has fallen (plans/late-game/12 D-1). */
export function abyssOpen(profile: Profile): boolean {
  return act2Open(profile) && bossDown(profile, WAKE_FINALE);
}
```

and to `meta/plan.ts`:

```ts
/** The Abyss (and Boss Rush) on this plan. */
export function abyssPlayable(profile: Profile, plan: Plan): boolean {
  return abyssOpen(profile) && plan === 'full';
}
```

Then go through every `act2Open` call. **Verdicts** (put this table in the
PR):

| Call | Means | Change |
|---|---|---|
| `collection.ts` `inAbyss` | Abyss | `abyssOpen` |
| `collection.ts` `rushOpen` | Abyss | `abyssOpen(profile) && bossDown(profile, 'deepwarden')` |
| `collection.ts` `regionUnlocked` (`ABYSS_INDEX`) | Abyss | `abyssOpen` (§8.1) |
| `collection.ts` `chooseWaypoint` | Abyss | `abyssOpen` |
| `collection.ts` `listedRelics` | Act 2 | keep, **and** hide Wake relics (§8.6) |
| `collection.ts` `listedFrames` | Act 2 | keep |
| `collection.ts` `riftJournal` | Act 2 | keep |
| `collection.ts` `hubUnlocks.stars` | Act 2 | keep |
| `collection.ts` `bestiary` | both | Abyss natives and Abyss bosses: `abyssOpen`. Wake natives and Wake bosses: `act2Open` (§8.6) |
| `contracts.ts:188` (`latest`) | Act 2 | keep |
| `contracts.ts:308` (contract Starlight) | Act 2 | keep |
| `contracts.ts:363` (heat mod) | Act 2 | keep |
| `contracts.ts:398` (omen rule) | Act 2 | keep |
| `contracts.ts:425` (floor target) | Abyss | `abyssOpen` |
| `contracts.ts:427` (guardian target) | Abyss | `abyssOpen` |
| `contracts.ts:503` (`openKinds`: floor, guardian, rush) | Abyss | `abyssOpen` |
| `contracts.ts:574` (heat draws) | Act 2 | keep |
| `contracts.ts:666` (lead heat) | Act 2 | keep |
| `runConfig.ts:282` (rift rates) | Act 2 | keep |
| `pacts.ts:34`, `:42`, `:84` | Act 2 | keep |
| `results.ts:221` (`unlockList`) | both | Pacts and the Constellations stay `act2Open`. `'The Abyss'` moves to `abyssOpen`. |
| `omen.ts:352` (`omenOpen`) | Act 2 | keep |
| `plan.ts:47` (`act2Playable`) | Act 2 | keep (the Abyss callers use the new `abyssPlayable`) |
| `ui/hub/map.ts:142` (the Abyss card) | Abyss | `abyssPlayable` (§8.3) |
| `ui/hub/map.ts:367` (the Heat stat) | Act 2 | keep |
| `tools/contractBot.ts:53` | Act 2 | keep |
| `meta/explainers.ts` `case 'abyss'` | Abyss | `abyssPlayable` |
| `app/App.ts:251` (`chooseWaypoint`) | Abyss | `abyssPlayable` |

`app/App.ts:639` (`startOmen`) stays `act2Playable`.

**Feats** (`content/feats.ts`, D-16): `the-descent`, `warden-fallen`,
`hunger-sated`, `abyss-20` and `abyss-naturalist` change `after: 'blight'` to
`after: 'thunderhead'`.

### 8.3 The Map (`src/ui/hub/map.ts`)

1. Replace `const ACT_REGIONS = 6` with `ACT1_REGIONS.length`, and compute
   `cleared` from `ACT1_REGIONS` only. The light bar is Act 1's. Delete the
   "Region N, the Blight runs deeper" silhouette block (`:138–141`): with the
   filter it can never fire.
2. Split the region loop in `show()` in two:
   - **Act 1:** today's loop over `ACT1_REGIONS`, with the free plan's sealed
     card and the "Region N" silhouette, unchanged.
   - **The Wake**, only when `act2Open(profile) && plan === 'full'`: loop over
     `WAKE_REGIONS`. An unlocked one gets `this.card(...)`. The first locked
     one gets `this.silhouette(r.name, r.veil!)`, then `break`. Then push a
     heading element **after** the Wake cards (the list is reversed before
     it's drawn, so the heading shows above them):

     ```ts
     private wakeHead(): HTMLElement {
       const h = document.createElement('div');
       h.className = 'map-act-head';
       h.innerHTML = '<p class="eyebrow">The Wake</p><p class="map-act-line">What the Blight held</p>';
       return h;
     }
     ```

     Use the project's existing eyebrow style (uppercase is allowed for
     eyebrows). Don't add a new surface: no glass, no border.
3. **The Abyss card.** `if (abyssPlayable(profile, plan))` push
   `this.abyss(...)` as today. **Else if** `act2Playable(profile, plan)`, push
   a sealed shaft card: `this.pastCard`-like markup with the class
   `map-region is-abyss is-sealed`, no click handler, the title *The Abyss*,
   and the line *"Stormcrown stands over the way down."* (`rows` empty).
4. **CSS** (`styles/main.css`): `.map-act-head` gets the eyebrow spacing.
   In the two-column layouts (`:root:is([data-form='medium'],
   [data-form='expanded'])`), add
   `.map-cell:has(.map-act-head) { grid-column: 1 / -1; }` so the heading
   spans both columns.
5. **The light on a Wake boss's first fall.** `leaveResults` passes
   `spread = true` for any first fall. For a Wake boss the Act 1 light is
   already full, so nothing visible spreads. Add a class `is-arriving` to
   the newly opened Wake card for one paint (a 400 ms fade-up, off under
   `data-motion='reduce'`). Pass the newly opened index through `MapSpread`
   as `{ wake: number }` and handle it in `show()`.
6. Check at **375×812** first (D4): the heading, five cards, the sealed
   shaft and the Act 1 list must scroll with no horizontal overflow.
   `tests/touch-targets.test.ts` and `tests/z-index.test.ts` must still pass.

### 8.4 Ceremonies and copy (`app/App.ts`)

1. **The Act 1 ending** (`ending()`): replace the last sentence with
   *"But the stars have come out, and the land the Blight held is turning.
   Act 2 begins: take on Pacts for Starlight, light the Constellations, and
   walk the Wake."*
2. **The Abyss opening:** in `leaveResults`, after the `finale` check, add
   `if (boss === WAKE_FINALE) this.abyssOpens();` (and not for a later
   kill: `ceremony` is set only on a first fall). `abyssOpens()` waits 2400 ms
   like `ending()`, then shows a modal titled *"The way down"*:
   *"The Thunderhead breaks, and the storm over Stormcrown dies. Below the
   high ground, something stirs. The Abyss is open: descend floor by floor,
   for Starlight."* Use one button, `{ label: 'Onward', primary: true }`.
3. **Explainers** (`content/explainers.ts`, `meta/explainers.ts`): add an
   `ExplainerId` `'wake'` on the `map` view, shown when
   `act2Playable(profile, plan)`. Title *The Wake*. Lines: *"The Blight's
   death changed the land it held. Each region of the Wake bends one rule of
   the fight."* and *"Each boss opens the next. Stormcrown's opens the
   Abyss. Heat records here pay half the Starlight."* The `abyss`
   explainer's condition becomes `abyssPlayable` (§8.2).

### 8.5 Starlight (D-5)

1. **Heat ×0.5.** In `meta/pacts.ts#recordStarlight`, multiply the sum by
   `BALANCE.wake.heatStarlight` when `regionByIndex(region).act === 2`. Both
   `recordHeat` (the pay) and the Pacts screen (the preview,
   `ui/hub/pacts.ts:65`) read this function, so both agree. `payStarlight`
   rounds.
2. **The lump.** In `bankRun` (`meta/results.ts`), inside the
   `if (first) { … }` block of the region boss branch, add:

   ```ts
   if (regionAt(run.regionId, run.wave).act === 2) {
     wakeRecord = { boss: b.id, starlight: payStarlight(profile, BALANCE.wake.lump) };
   }
   ```

   Add `wakeRecord: { boss: BossId; starlight: number } | null` to
   `RunSummary` with a doc comment, default `null`, and return it.
3. **Results** (`ui/results.ts`, next to `stratumRecord` at `:372`): if
   `s.wakeRecord`, push `gain('round-star', `${BOSS_BY_ID[id].name} fell`,
   starlight(s.wakeRecord.starlight), 'unlock')`, and include it in the
   `is-first` toggle at `:351`.
4. **The Act 2 bot** credits it as a new source `wake` (§10.1).
5. **The B7 test** (`tests/act2.test.ts`, "every star can be lit") sums
   `recordStarlight` over `REGIONS`, so it picks up the Wake's halved heat.
   Add `+ BALANCE.wake.lump × WAKE_REGIONS.length` to its left side.

### 8.6 Bestiary, Collection, feats

1. **Bestiary** (`collection.ts#bestiary`): Wake natives (every enemy in a
   Wake region's pool) and Wake bosses are listed only once `act2Open`, as
   Abyss natives are today (but on `abyssOpen`, §8.2). Extend the test
   "Act 1's lists keep Act 2's entries out until then".
2. **Relics** (`listedRelics`): a relic whose source is a Wake region's
   elites or a Wake boss is listed only once `act2Open`.
3. **The Collection's Bestiary page** groups by region. Check
   `ui/hub/collection.ts` (or wherever the Bestiary page lays out groups) for
   an Act 1 assumption, and make Wake groups appear after the Blight Heart.
4. **Feats** (`content/feats.ts`, Act 2 block, all `after: 'blight'`):

   | id | name | text | goal | reward | starlight |
   |---|---|---|---|---|---|
   | `bell-naturalist` | Bell Naturalist | Discover every enemy in the Bell Marches. | `bestiary 9` | 300_000 | 5 |
   | `orrery-naturalist` | Orrery Naturalist | Discover every enemy in the Orrery. | `bestiary 10` | 300_000 | 5 |
   | `sea-naturalist` | Sea Naturalist | Discover every enemy in the Frozen Sea. | `bestiary 11` | 300_000 | 5 |
   | `giant-naturalist` | Giant Naturalist | Discover every enemy in Giants’ Rest. | `bestiary 12` | 300_000 | 5 |
   | `storm-naturalist` | Storm Naturalist | Discover every enemy in Stormcrown. | `bestiary 13` | 300_000 | 5 |
   | `wake-walker` | Wake Walker | Fell every boss of the Wake. | `{ kind: 'boss', boss: 'thunderhead' }` | 3_000_000 | 25 |

   The chain means the Thunderhead's fall implies every Wake boss's, so
   `wake-walker` needs no new goal kind. `meta/feats.ts#regionEnemies` reads
   a region's pool, so `bestiary 9–13` works with no change.
5. **`heatAll`** (D-15): `coolestRegion` and `hottestRegion` read
   `ACT1_REGIONS`. Change the texts of `heat-all-5` and `heat-all-10` to
   *"Clear all six Act 1 regions at heat 5 or more."* (and 10). Leave
   `hottestRegion` on Act 1 too, so `heat`-goal feats mean the same thing.
6. **Feats header comment** in `content/feats.ts`: update the counts.

### 8.7 Trials: what opens them

`trialsOpen` (`meta/trials.ts`) is `bossDown(region's boss) &&
runsPastFirst ≥ 2`, so Wake Trials open on each Wake boss's first fall with
no change. The Map's Trials list on a Wake card works unchanged. The free
plan never reaches a Wake card.

### 8.8 Trials: content (15)

Add to `content/trials.ts`, in a `// ── The Wake ──` block per region. Each
`text` is ≤ 15 words.

| id | name | region | text | rules | reward |
|---|---|---|---|---|---|
| `held-breath` | Held Breath | 9 | The Bastion frame, and no other. | `frame bastion` | relic `carillons-clapper` |
| `off-the-beat` | Off the Beat | 9 | Sunlance and Chain Lightning only. | `weapons ['sunlance','chain-lightning']` | trim `bells` "Bronze Bells" |
| `quickstep` | Quickstep | 9 | Enemies move 30% faster. | `omen haste 2` | notable **Bell-Ringer**: "+5% attack speed." `stat attackSpeed pct 0.05` |
| `fixed-star` | Fixed Star | 10 | The Arcanist frame, and no other. | `frame arcanist` | relic `astrolabe-ring` |
| `straight-lines` | Straight Lines | 10 | Sunlance and Arcane Bolt only. | `weapons ['sunlance','arcane-bolt']` | trim `orrery` "Brass Rings" |
| `crowded-sky` | Crowded Sky | 10 | Waves bring 60% more enemies. | `omen hordes 2` | notable **Wide Sky**: "+5% range." `stat range pct 0.05` |
| `thin-ice` | Thin Ice | 11 | The Lamplighter frame, and no other. | `frame lamplighter` | relic `leviathan-scale` |
| `no-push` | No Push | 11 | Arcane Bolt, Chain Lightning and Sunlance only: nothing that pushes. | `weapons ['arcane-bolt','chain-lightning','sunlance']` | trim `icicles` "Icicles" |
| `hard-frost` | Hard Frost | 11 | Enemies have nearly twice as much health. | `omen vigour 3` | notable **Cold Blood**: "+10% Max HP." `stat maxHp pct 0.1` |
| `small-fry` | Small Fry | 12 | The Artificer frame, and no other. | `frame artificer` | relic `colossus-heart` |
| `many-hands` | Many Hands | 12 | Chain Lightning and Mortar only. | `weapons ['chain-lightning','mortar']` | trim `ribs` "Giant’s Ribs" |
| `old-bones` | Old Bones | 12 | The Colossus rises twice more, with 50% more health. | `omen tyranny 2` | notable **Bonebreaker**: "Crits deal +10% damage." `stat critDamage add 0.1` |
| `bare-mast` | Bare Mast | 13 | The Gravekeeper frame, and no other. | `frame gravekeeper` | relic `thunderhead-core` |
| `blind-fire` | Blind Fire | 13 | Scattershot and Mortar only. | `weapons ['scattershot','mortar']` | trim `rods` "Storm Rods" |
| `gathering-storm` | Gathering Storm | 13 | Every elite wave brings two more elites. | `omen elites 2` | notable **Stormward**: "+5% damage." `stat damage pct 0.05` |

Every Trial uses `icon: 'checkered-flag'` like Act 1's. The frame Trials
don't need the frame owned (`trialRules` sets it directly). A weapons
Trial's first id is the one mounted at the start.

`lint.ts#uniqueNames` checks trial names and their notable/trim names
against every other entry. If one collides with a Forge or Star node, rename
the notable, not the node.

**Trims.** Add `'bells' | 'orrery' | 'icicles' | 'ribs' | 'rods'` to `TrimId`
and a `case` to `paintTrim` (`render/painters/tower.ts:126`) for each. Use
the existing trims as the pattern (each is a few strokes round the tower's
rim at radius `R`, using palette colours): small bronze bells hanging at 4
points (`gold`); two thin brass rings tilted round the drum, slowly turning
(`gold`); icicles under the parapet (`frost`); three curved ribs rising
behind the drum (`critical` at low alpha); three rods on top with a spark
that flickers (`mana`). Draw at the same scale and line weight as `ivy` and
`pennants`. Check `tests/palette.test.ts` (no literal colours in `render/`).

### 8.9 Relics (20)

Add to `content/relics.ts` after the Blight Heart's four. Every text is
≤ 15 words. `effects` apply at rank I and `perRank` once more for each rank
past I. A relic whose effect is a `behaviour` reads its strength from
`BALANCE.relics.<key>[rank − 1]` through `rankValue`, as Act 1's do.

| id | name | source | text | effects / perRank | `BALANCE.relics` | where it acts |
|---|---|---|---|---|---|---|
| `carillons-clapper` | Carillon's Clapper | boss `carillon` | Every 8 s, a toll stuns every enemy in range for half a second. | behaviour `clapper` ×1 / ×1 | `clapper: [0.5, 0.65, 0.8]`, `clapperEvery: 8` | `tickWake`: when `floor(time / every)` changes this step, stun every targetable non-boss body within range (`stunnedUntil = max(…, time + v)`), push `toll` with `relic: true` |
| `tuning-fork` | Tuning Fork | elite 9 | Stunned and frozen enemies take +30% damage. | behaviour `tuning-fork` | `tuningFork: [0.3, 0.4, 0.5]` | `damageTaken`: `e.stunnedUntil > time \|\| e.frozenUntil > time` |
| `muffled-bell` | Muffled Bell | elite 9 | Slows, stuns and burns last 20% longer. | stat `duration pct 0.2` / `pct 0.1` | — | the stat |
| `metronome` | Metronome | elite 9 | +2% damage for every 10 s the tower goes unhurt, up to 20%. | behaviour `metronome` | `metronome: [0.02, 0.025, 0.03]`, `metronomeEvery: 10`, `metronomeSteps: 10` | `damageTaken`: `steps = min(metronomeSteps, floor((time − lastHurt) / every))`, where `lastHurt = tower.hurtTick < 0 ? 0 : tower.hurtTick × dt` (store `dt` as `SIM_DT` from the loop's constant, or record `tower.hurtAt` alongside `hurtTick` in `hurtTower`; prefer the latter) |
| `astrolabe-ring` | Astrolabe Ring | boss `astrolabe` | Glaives and drones circle 30% faster. | behaviour `astrolabe` | `astrolabe: [0.3, 0.45, 0.6]` | `combat.ts`: the Glaives' angular speed (`case 'orbit'`) and the drones' speed (`BALANCE.weapons.droneSpeed`), × (1 + v) |
| `star-chart` | Star Chart | elite 10 | Homing bolts turn twice as sharply. | behaviour `star-chart` | `starChart: [2, 2.5, 3]` | `combat.ts`: where a homing projectile steers toward its target, × the turn rate |
| `tidal-lock` | Tidal Lock | elite 10 | Enemies within half your range move 15% slower. | behaviour `tidal-lock` | `tidalLock: [0.15, 0.2, 0.25]` | `tickEnemies`: × (1 − v) on the step when `d ≤ range / 2` and not a boss |
| `comet-tail` | Comet Tail | elite 10 | Enemies slain by Glaives leave burning ground for 2 s. | behaviour `comet-tail` | `cometTail: [0.1, 0.15, 0.2]`, `cometTailSeconds: 2`, `cometTailRadius: 40` | `kill`: if `source === 'orbit'`, push a `FirePatch` with `dps = e.maxHp × v` |
| `leviathan-scale` | Leviathan Scale | boss `leviathan` | Knockback pushes 50% farther; heavy enemies are pushed as if light. | behaviour `leviathan` | `leviathan: [0.5, 0.75, 1]`, `leviathanMass: 2` | `knockBack`: push × (1 + v), and `mass = min(mass, leviathanMass)` |
| `skate-blade` | Skate Blade | elite 11 | Enemies you knock back take +25% damage for 2 s. | behaviour `skate-blade` | `skateBlade: [0.25, 0.35, 0.45]`, `skateSeconds: 2` | `knockBack` sets `pushedUntil`; `damageTaken` reads it |
| `floe-shard` | Floe Shard | elite 11 | Enemies slain while slowed chill those near them by 30%. | behaviour `floe-shard` | `floeShard: [0.3, 0.4, 0.5]`, `floeShardRadius: 80`, `floeShardSeconds: 2` | `kill`: if `e.slowUntil > time`, slow every body within the radius |
| `anchor-chain` | Anchor Chain | elite 11 | +20% Max HP. | stat `maxHp pct 0.2` / `pct 0.1` | — | the stat |
| `colossus-heart` | Colossus Heart | boss `colossus` | +30% damage against enemies above half their health. | behaviour `colossus` | `colossus: [0.3, 0.4, 0.5]` | `damageTaken`: `e.hp > e.maxHp / 2` |
| `tick-bite` | Tick Bite | elite 12 | A crit marks its enemy: marked enemies take +15% damage. | behaviour `tick-bite` | `tickBite: [0.15, 0.2, 0.25]` | `damageEnemy` sets `e.marked` on a crit; `damageTaken` reads it |
| `herd-bell` | Herd Bell | elite 12 | Large enemies pay 30% more shards. | behaviour `herd-bell` | `herdBell: [0.3, 0.45, 0.6]`, `herdBellRadius: 30` | `kill`: shards × (1 + v) when `e.radius ≥ herdBellRadius` |
| `giants-toe` | Giant's Toe | elite 12 | Sunlance keeps half its heat-up when it turns to a new target. | behaviour `giants-toe` | `giantsToe: [0.5, 0.7, 0.9]` | `combat.ts`, the beam's ramp: when the target changes, keep `ramp × v` instead of resetting |
| `thunderhead-core` | Thunderhead Core | boss `thunderhead` | Every 10 s, lightning strikes the toughest non-boss enemy for 5% of its health. | behaviour `thunder-core` | `thunderCore: [0.05, 0.07, 0.1]`, `thunderCoreEvery: 10` | `tickWake`: on the 10 s boundary, strike as §4.5 step 2 (one target, `'storm'` source, never the tower, never a boss) |
| `lightning-rod` | Lightning Rod | elite 13 | Chain Lightning leaps to one more enemy. | behaviour `extra-leap` | — (the rank is the count) | `combat.ts`, Chain Lightning's jump count + rank |
| `grounding-wire` | Grounding Wire | elite 13 | The tower takes 30% less from lightning and hostile shots. | behaviour `grounding` | `grounding: [0.3, 0.4, 0.5]` | `hurtTower`: × (1 − v) when `by` is `'storm'` or `'shots'` |
| `static-charge` | Static Charge | elite 13 | Every 20 crits charge the ultimate by 1%. | behaviour `static` | `static: [0.0005, 0.00075, 0.001]` | `damageEnemy`: on a crit, add `v` to the ultimate through the same path `kill` uses (factor the charge code in `kill` into `chargeUlt(run, gain)` first, so the Engineering capstone's rules hold) |

Icons: pick from the existing `IconId` list where one fits (for example
`hourglass` for Metronome, `frozen-orb` for Floe Shard, `lightning-storm` for
Thunderhead Core). Otherwise add game-icons slugs to the manifest (§9.4).

**Rules:**
- Each relic gets a `BehaviourId` with a doc comment in the "Relics (§11.5)"
  group, and a unit test in `tests/behaviours.test.ts`: the relic at rank I
  does its thing, and at rank 0 nothing changes.
- **No relic sets** (D-14): don't add `RELIC_SETS` entries.
- **The I4 check:** with relics on, no weapon may go past 40% of the bot's
  picks in any region (`npm run arsenal`, §14).
- `content/lint.ts` already checks that each region gives exactly four
  relics. That's why a region's relics must land in the same step as the
  region (§12).

### 8.10 The Daily Omen (`meta/omen.ts`)

**The problem.** `omenRegion(n)` is `cycle(REGIONS.map(r => r.index), n,
'region')`. With eleven regions, the block size changes from 6 to 11 and
every day's region moves, past days included. A friend's code from yesterday
would then name a different region.

**The fix:**

1. `BALANCE.omen.wakeFrom: number` is the first day (Omen day number, days
   since 1970-01-01 UTC, as `omenDay` returns) on which the Wake joins. Set it
   to the release day of the build that ships this step. For example
   2026-12-07 is day 20794 (`Date.UTC(2026, 11, 7) / 86400000`).
2. Change `omenRegion`:

   ```ts
   export function omenRegion(n: number): number {
     if (n < BALANCE.omen.wakeFrom) return cycle(ACT1_REGIONS.map((r) => r.index), n, 'region');
     return cycle(REGIONS.map((r) => r.index), n, 'region-wake');
   }
   ```

   The Act 1 branch must give exactly today's answers: today's
   `REGIONS.map` *is* the six Act 1 regions in the same order, with the same
   label. The new label keeps the eleven-region shuffle independent.
3. **The seam:** the day before the cutover and the cutover day may name the
   same region. That's acceptable. Note it in the test.
4. **The tower on a Wake day.** `BALANCE.omen.ring` is indexed by region.
   Extend it to 14 entries: `[0, 6, 6, 6, 6, 6, 6, 0, 0, 7, 7, 7, 7, 7]` (7 and
   8 unused; 7 is the top Forge ring). Add `BALANCE.omen.stars:
   Partial<Record<number, readonly string[]>>`: star node ids lit at max
   level on the Omen's profile for that region. Start it empty, and fill it
   only if `npm run omen` says Wake days fall short. In `omenProfile`, after
   buying the Forge, set `p.stars[id] = node.maxLevel` for each listed id.
5. **Tests** (`tests/omen.test.ts`):
   - Golden values. Before changing the code, record `omenRegion(n)` for
     days 20700–20793 into the test as a table, then assert them after the
     change.
   - From `wakeFrom`, every block of 11 days names each region once.
   - The existing "every region once in six days" test now runs on days
     before `wakeFrom` with `ACT1_REGIONS`.
   - `omenConfig(n)` for a Wake day builds and runs 60 s headless without
     throwing.

### 8.11 Contracts

Regional contracts draw from `REGIONS` filtered by `regionUnlocked` and
`planAllows`, so the Wake joins on its own. Also:

1. The floor, guardian and Rush gates move to `abyssOpen` (§8.2).
2. **`QUARRY`** (`content/contracts.ts`) has no entries for 9–13, so the
   Wake gets no `slay` modifier (`?? []`). Add two entries per Wake region
   once §14's runs exist. Measure them the way Act 1's were set: the median
   kills of that type in a run that reaches wave 20, from
   `npm run inspect -- --seeds 50 --forge all --region N`, times 0.8, rounded
   to a tidy number. The types: 9 `ringer`, `straggler`; 10
   `satellite`, `comet`; 11 `skater`, `elite`; 12 `titan`, `tick`; 13
   `groundling`, `conductor`.
3. Run `tests/contracts.test.ts` and the contract bot
   (`npm run pacing -- --act2 --hours 12 --seeds 4 --contracts 0.33`). It
   must still clear its targets with the Wake in the pool.

---

## 9. Presentation

### 9.1 Render

| What | Where | How |
|---|---|---|
| Ground tints | `render/painters/arena.ts` | data only (`region.tint`) |
| The toll | `render/effects.ts` | on `toll` (no x/y): a thin ring rolling in from the rim, `gold`, 0.5 s. On `toll` with `relic: true`: a smaller ring at the tower. |
| Orbit rings | `render/painters/arena.ts` | when the run's rule is `orbit`: 4 faint concentric rings in the ground cache, drawn as a separate layer and rotated by `time × 0.05 × spin`. Never redraw the cached ground per frame. |
| Orbit trails | `render/painters/enemies.ts` | under `data-quality='high'` only: a short line from `(px, py)` back along the motion, 30% alpha |
| Slides | `render/painters/enemies.ts` | a body with `slideX/slideY ≠ 0`: a streak behind it, length ∝ speed, `frost` |
| Impacts | `render/effects.ts` | on `impact`: a small burst, `frost`; `shatter: true` adds shard particles |
| Strikes | `render/effects.ts` | on `strike`: a jagged bolt from the top of the view to (x, y) (or to the tower), `mana`, 0.25 s, plus a brief rim flash. Under reduced motion: no flash, a static bolt for 0.25 s. |
| Conductor halo | `render/painters/enemies.ts` | a rod (a vertical line above the body) and a ring at 1.6× radius pulsing in `gold`. It must read from across the arena on a 375 px phone. |
| Tick riding | painter | draw riders on their host, small, after the host |
| Weak point | `render/painters/bosses.ts` | from `weakPoint(run)`: a glowing arc on the Colossus's rim, brighter when it faces the tower |
| Orbiting plates | already drawn as bodies | — |

All colours by palette name (`FX`), never hex (`tests/palette.test.ts`).
Check the colourblind-safe palette (`SAFE_FX`) still separates `gold`,
`mana` and `frost` on the strike, the halo and the slides.

### 9.2 Audio (`audio/cues.ts`, `audio/music.ts`)

- `toll`: a struck bell, a fifth above the run's root, short decay. The relic
  toll: the same, an octave up and quieter.
- `strike`: a crack plus low noise. On the tower, louder, with the
  existing tower-hurt cue.
- `impact`: a dull thud; `shatter` adds glassy noise.
- `trample`: a low thump.
- `hop`, `orbitTurn`, `floe`: short cues, or none.
- `REGION_VOICES[9..13]` and `REGION_SHIFT` (extend the array to index 13;
  leave 7 and 8 at their current values) as given in §2.
- `docs/audio.md` gets a line per new cue.

### 9.3 UI copy

- The Map card shows `${rule.name}: ${rule.text}` for Wake regions, as for
  Act 1. Nothing new.
- First sight of each native shows its Bestiary card as today.
- `ui/results.ts`: the `storm` hurt label (§3.2) and the `wakeRecord` reward
  line (§8.5).

### 9.4 Icons

New `IconId`s mean entries in `scripts/fetch-icons.mjs`'s `MANIFEST`, then
`npm run icons` (network). Confirm each slug exists in
github.com/game-icons/icons before adding it. Candidates (author/slug, check
each): a bell (`lorc/ringing-bell`), a planet (`lorc/ringed-planet`), a comet
(`lorc/comet-spark`), ice (`lorc/ice-cube`, `delapouite/iceberg`), a whale
(`delapouite/whale`), a giant (`delapouite/giant`), a storm cloud
(`lorc/lightning-storm` already exists), a rod (`delapouite/lightning-rod`?).
Where a slug doesn't exist, pick another or reuse an existing id. `npm run
content-report` lists icons shared by unrelated entries. Keep that list
short.

---

## 10. Tools

### 10.1 The Act 2 bot (`tools/act2.ts`)

1. **Frontier:** replace `const frontier = REGIONS[REGIONS.length − 1].index`
   with a per-loop `frontier(profile).index` (from `meta/collection.ts`).
   Readings that compare against "the frontier" now follow it.
2. **Where next.** Before the heat ladders:

   ```ts
   const front = frontier(profile);
   if (!bossDown(profile, front.boss) && (fails.get(`${front.index}:0`) ?? 0) < FAIL_LIMIT) {
     target = { region: front.index, heat: 0 };
   }
   ```

   The heat ladders then only consider regions that are unlocked and whose
   boss is down. Heat 0 means `takePacts(profile, 0, region)` clears every
   pact.
3. **The Abyss** is picked only when `abyssOpen(profile)`. Boss Rush only
   when `rushOpen` (unchanged).
4. **Report:** add `wake: Partial<Record<BossId, number>>`, the clock seconds
   (since the Blight) of each Wake boss's first fall (from
   `summary.boss?.first` in a region with `act === 2`), and
   `sources.wake`, the lumps.
5. **`tools/pacing.ts#act2Main`** prints a line per seed: `Wake: Carillon
   0.6 h · Astrolabe 1.9 h · … · Thunderhead 7.4 h`, and the medians, with a
   ✓/✗ against §14's targets.
6. **The heat ladder order** for a Wake region: use `ORDER`. Add a
   `GIANTS_ORDER` only if §14 shows Hordes is wasted there (half the
   bodies).

### 10.2 The idle bot (`tools/idle.ts`, `tools/pacing.ts`)

Add `npm run pacing -- --idle --wake --seeds 4`. It calls
`runIdle(IDLE_DAYS_CAP + 6, seed, ['blight', 'thunderhead'])` and prints the
days from the Blight's fall to the Thunderhead's. Check what `chores()`
shops. If the idle bot never lights stars, note it in the report: an idle
player in Act 2 is a Forge-only player. D-23's target is ≤ 4 days.

### 10.3 Arsenal, inspect, omen

- **`npm run inspect -- --region 9`** works once the region exists
  (`regionAt` reads `REGIONS`). Check the per-wave table shows sensible clear
  times, and add `--wake` as a shortcut for `--forge all` plus a full
  Constellations profile, if the existing presets are too weak to reach
  wave 20 in the Wake.
- **`npm run arsenal -- --wake`**: the frontier fixtures
  (`tools/fixtures/frontiers.json`) are Act 1 only. Add a second fixture,
  `tools/fixtures/wake-frontiers.json`, written by
  `npm run pacing -- --act2 --wake-frontiers`: `runAct2` saves a clone of the
  profile at each Wake boss's first fall (the "cleared" end) and at the
  previous boss's fall (the "arrival" end). `arsenalReport` takes
  `regions = [9..13]` and reads those profiles under `--wake`.
- **`npm run omen`**: run 28 days across the cutover (§14).

---

## 11. Tests (summary)

New file **`tests/wake.test.ts`** holds the rule tests from §4. Also:

| File | Add or change |
|---|---|
| `tests/act2.test.ts` | "Act 2 opens with the Blight": `regionUnlocked(9)` true and `regionUnlocked(ABYSS_INDEX)` **false** with only Act 1 bosses down; both true once every non-Abyss boss is down. Its `act2Profile` helper fells every non-Abyss boss, so the Wake's are included: check that every test using it still means what it meant. B7 sum (§8.5). |
| `tests/collection.test.ts` | the `after` chain: 10 opens on the Carillon, 13 on the Colossus; `frontier` walks 9 → 13; Act 1's chain unchanged |
| `tests/idle.test.ts` (or a new one) | Frontier March into the Wake and its stop at 13 (§8.1) |
| `tests/q4.test.ts` | Boss Rush needs the Thunderhead *and* the Deepwarden |
| `tests/omen.test.ts` | golden days and the cutover (§8.10) |
| `tests/contracts.test.ts` | no floor or guardian card before the Thunderhead; Wake regions appear as regional targets |
| `tests/content.test.ts` | lint passes (chain, four relics per region, counters, names, R4) |
| `tests/behaviours.test.ts` | one test per new relic behaviour |
| `tests/bosses.test.ts` | each new pattern: `peal` rolls a ring on a toll; `quicken` halves the interval; `reverse` flips the spin; `floes` places stationary Floes (and a ring of 8); `weakpoint` ×3 only while facing; `feast` heals and swallows; `bolt` hurts the tower after its windup; `tempest` halves the clock and forks |
| `tests/perf.test.ts` | three cases at `BALANCE.maxEnemies` bodies: Glide with a third of the bodies sliding (§4.3); the Bell Marches with every body standing (Toll); Giants' Rest with a Champion Titan. Each inside `STEP_BUDGET_MS`. |
| `tests/sim.test.ts` | the determinism hash test for one seed in each Wake region (same config + seed ⇒ same state) |
| `tests/save.test.ts` | a snapshot taken mid-run in the Frozen Sea (bodies sliding) round-trips; an old v22 snapshot is refused as stale |
| `tests/contrast.test.ts` | five new `LAST_LIGHT` entries (automatic) |
| `tests/explainers.test.ts` | the `wake` explainer shows after the Blight, and `abyss` only after the Thunderhead |

---

## 12. Build order

Each step ends in something playable, and lints and tests green. **A
region's relics and Trials land with the region**, because the lint fails a
region that doesn't give four relics. This changes the original plan, where
relics and Trials were a later step.

### Step 1: plumbing, the gate, and the Bell Marches (L)

1. Types (§3.1): `RegionDef.act/after/veil`, the five `RegionRule`s, the new
   unions (all members, so later steps only add data and cases), `BossPlates.orbit`,
   `SimEvent`s, `HurtBy 'storm'`, `DamageSource 'impact' | 'storm'`.
2. `act`/`after` on Act 1's six; `ACT1_REGIONS`, `WAKE_REGIONS`,
   `WAKE_FINALE`, `regionChain` lint.
3. `regionUnlocked`, `abyssOpen`, `abyssPlayable`, and every verdict in §8.2.
   The Abyss feats' `after` (D-16).
4. State (§3.2), the `wake` stream, `SNAPSHOT_VERSION` 23,
   `sim/systems/wake.ts` with the Toll clock, `tickWake` in `step`.
5. The Bell Marches' content (§2.1): region, three natives, the `resonant`
   aura, the Carillon (`peal`, `quicken`), four relics, three Trials, the
   `bells` trim, feats, `LAST_LIGHT`, music, icons.
6. The Map (§8.3), the ceremonies and copy (§8.4), the `wake` explainer.
7. Starlight (§8.5): the ×0.5 and the lump, `wakeRecord` in results.
8. The Act 2 bot's changes (§10.1), so every later step can be measured.

**Done when:** a profile with the Blight down sees the Wake band with the
Bell Marches card and a sealed shaft; a run there tolls; the Carillon falls
and pays 25 Starlight; the Abyss is still sealed; and Act 1's pacing reading
hasn't moved.

**Note:** with Stormcrown not yet built, the Abyss can't be opened in a
normal game after step 1. To keep the Abyss reachable in dev builds until
step 4, have `abyssOpen` return `act2Open(profile)` while
`!REGIONS.some(r => r.boss === WAKE_FINALE)`, with a `// TODO(step 4)`
comment, and remove it in step 4. Tests should cover both paths until then.

### Step 2: Giants' Rest (M)

§2.4, §4.4 (count, size, the radius bound, trample, ride, herd), the
`towering` aura, the Colossus (`weakpoint`, `feast`), four relics, three
Trials, the `ribs` trim, the Giants perf case. **Before** this step, check
`separateEnemies`' `biggest` fix with a unit test.

The chain while the regions land one by one (the lint's "no two regions
share an `after`" holds at every step):

| After step | Chain |
|---|---|
| 1 | 6 → 9 |
| 2 | 6 → 9 → 12 (12's `after` is 9 for now) |
| 3 | 6 → 9 → 10 → 12 (12's `after` becomes 10) |
| 4 | 6 → 9 → 10 → 12 → 13 (13's `after` is 12) |
| 5 | 6 → 9 → 10 → 11 → 12 → 13 (11's `after` is 10, 12's becomes 11) |

Indices never change, so a profile's records survive each re-link.

### Step 3: the Orrery (M)

§2.2, §4.2, the `tidal` aura, the Astrolabe (orbiting plates, `reverse`),
four relics, three Trials, the `orrery` trim, the ground's rings.

### Step 4: Stormcrown (M)

§2.5, §4.5, the `charged` aura, the Thunderhead (`bolt`, `tempest`), the
`toughness` change, four relics, three Trials, the `rods` trim, the strike
render. **Remove step 1's temporary Abyss fallback.** The Abyss now opens on
the Thunderhead, and the "way down" modal plays.

### Step 5: the Frozen Sea (L)

§2.3, §4.3 (the `knockBack` signature change, slides, impacts, blast pushes,
the Sledge), the `anchored` aura, the Leviathan (`floes`), four relics,
three Trials, the `icicles` trim, the Glide perf case. This is the biggest
sim change: run the full suite and the Act 1 pacing reading twice.

### Step 6: the Omen and Contracts (S)

§8.10 and §8.11. Set `wakeFrom` to the planned release day.

### Step 7: tuning and docs (M)

§14, then §15.

Steps 2, 3 and 5 don't depend on each other once step 1 has landed. Only the
`after` chain needs re-linking as each lands (the table under step 2). Step 4
needs step 1 only. It comes before the Frozen Sea so that the biggest sim
change (Glide) is built against a game whose Abyss gate is already final.

---

## 13. Risks

- **The Wake as a wall.** The Wake now gates the Abyss, so a region the bot
  can't clear stops the descent. Each region's idle reading is a gate, not a
  note (§14).
- **Storm and idle play.** If the aim doctrines don't take Conductors down,
  the region punishes idle play (R7), and it's the last door before the
  Abyss. D-18's `toughness` and `standoff` are the answer. Measure the
  Conductor's mean lifetime in `inspect` (target: under 8 s with a frontier
  tower).
- **Glide performance and feel.** Check it at 300 bodies. Keep friction high
  enough that a slide lasts under 1 s.
- **Toll and overlap.** The overlap rule counts living bodies, and stop-go
  waves stay alive longer, so waves may overlap more. Watch the 300-body cap
  in the Bell Marches' swarm wave.
- **Stillwater Charm under Toll.** Every body is "not moving" most of the
  time. Watch its share in the arsenal with relics on.
- **Giants and the scorer.** Handled through `counters`/`weakAgainst` (§5).
  If the bot still drafts Chain Lightning there, add a Giants term to
  `suggest.ts`'s per-type HP estimate (`× giantsOf(...).hp` where it reads
  `waveHp`).
- **Orbit readability on a 375 px phone.** `max: 0.95` keeps the inward part
  ahead of the sideways part, so the path reads as a spiral, not a ring.
- **Omen codes.** The cutover day must ship with its golden test, or friends'
  codes quietly stop matching.
- **Relic creep.** Twenty new relics on top of Act 1's 24 and the Abyss's 12.
  Each leans on one verb, and I4 is checked with relics on.
- **Snapshot bump.** A player mid-run when the update lands loses that run's
  snapshot (stale version). That's the existing policy for every bump.

---

## 14. Tuning and checks

| Reading | Command | Target |
|---|---|---|
| When each Wake boss first falls after the Blight (active bot) | `npm run pacing -- --act2 --hours 16 --seeds 4` | the Carillon within 1 h; the Thunderhead (so the Abyss) within 6–10 h. The strata's own targets then start from the Thunderhead, not the Blight. |
| Hands-off idle | `npm run pacing -- --idle --wake --seeds 4` | the Thunderhead within 4 days of the Blight (D-23). **A gate.** |
| Each rule moves the picks | `npm run arsenal -- --wake` | each region moves at least one weapon's share by ≥ 10 points against the Blight Heart's; I4's 40% cap holds per region, with relics on |
| Boss fights | `npm run inspect -- --seeds 20 --forge all --region 9` (… 13) | each boss takes 25–35 s of expected DPS |
| Conductor lifetime | `inspect` with a probe on `conduct` bodies | median < 8 s from arrival in range |
| The Omen | `npm run omen` (28 days across the cutover) | Wake days meet the median targets |
| Frame budget | `npm test -- perf` | Glide at 300 bodies, the Bell's swarm, a Champion Titan |
| Act 1 unchanged | `npm run pacing -- --hours 12 --seeds 8` | I1a, I1b, I3, I6 read as before this plan |

Tune in this order: HP (`hpBase`) for the bot's pace, then pay
(`shardBase`) for the farm rate, then each rule's own numbers (toll
interval, tangent, carry and impact, the giants' multipliers, the storm's
interval and wall hit). Change one number at a time and re-read.

`docs/balancing.md` gets a "The Wake" reading with the table above and its
results.

---

## 15. Docs

- `docs/enemies-and-waves.md`: the five rules, fifteen natives and five
  auras.
- `docs/bosses.md`: five bosses and the eight new pattern kinds, plus
  orbiting plates.
- `docs/act2.md`: the Wake, the gate's move (`abyssOpen`), the Starlight
  (×0.5, lumps).
- `docs/collection.md`: fifteen Trials, five trims, twenty relics, no sets
  (D-14).
- `docs/audio.md`: the new cues.
- `docs/balancing.md`: the readings in §14.
- `docs/contracts.md` and the Omen's doc section: the cutover day.
- `AGENTS.md`: `sim/systems/wake.ts` in the step order, and the new commands
  (`--idle --wake`, `--act2 --wake-frontiers`, `arsenal -- --wake`).
- `plans/late-game/README.md`: this plan's status line as steps land.

---

## 16. Functions to run `impact` on before editing

`regionUnlocked`, `act2Open` (read-only, but check every caller against §8.2),
`inAbyss`, `rushOpen`, `chooseWaypoint`, `bestiary`, `listedRelics`,
`createRun`, `step`, `spawnEnemy`, `rollWave`, `tickEnemies`, `applyAuras`,
`before`, `stopDistance`, `separateEnemies`, `knockBack`, `burstAt`,
`damageEnemy`, `damageTaken`, `kill`, `toughness`, `hurtTower`,
`arriveBoss`, `tickBoss`, `wearPlates`, `placePlates`, `walksIn`,
`firstAct`, `bankRun`, `recordStarlight`, `omenRegion`, `omenProfile`,
`openKinds`, `targetValid`, `MapView.show`, `App.leaveResults`,
`App.ending`, `runAct2`. Report HIGH or CRITICAL results to the owner before
going on.
