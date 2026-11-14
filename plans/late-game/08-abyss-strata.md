# 08. The Abyss strata

**Status:** 2026-11-14. Plan, not built. Idea 8 of the late-game review
([README](README.md)). Supersedes [c-abyss-strata.md](c-abyss-strata.md)
except its §6 (cursed relics), which is now
[03-cursed-relics.md](03-cursed-relics.md).

**In one line:** the Abyss stops cycling Act 1's regions. It becomes five
authored strata of six floors each, every one with its own rule, native,
guardian, ground and music, down to a real bottom at floor 30. That
bottom is Act 2's ending. The endless descent, *the Below*, opens past it
as an epilogue.

---

## 1. The problem

- **It repeats.** `abyssFloor` builds every floor from
  `ORDER = [1, 3, 2, 5, 4, 6]` (`content/abyss.ts:24`, `:48-51`), so
  floor 7 is floor 1 with bigger numbers. The four natives have all
  arrived by floor 4 (`:27-32`), and both guardians have appeared by
  floor 10 (`:35`, `:54-57`, `:105-107`). After floor 10 nothing is new.
- **It opens on old ground.** Floor 1 wears the Ashen Fields' pool, rule and
  tint. Floors 1–4 end on Act 1 bosses (`floorBoss`). The renderer only
  darkens the template's tint (`render/renderer.ts:482-483`), and the music
  plays one key for every floor (`audio/music.ts:39`, index 7).
- **It has no destination.** Act 1 ends on "something stirs below"
  (`app/App.ts:342`), and the explainer promises "There is no end"
  (`content/explainers.ts:72`). Only the Blight carries `finale`
  (`content/bosses.ts:261`), and an Abyss boss never sets
  `profile.ceremony` (`meta/results.ts:216-223`). Depth pays 2 Starlight a
  floor plus 10 per guardian (`balance.ts:412`): 120 by floor 30, against
  a sky of 896 (computed from `STAR_WEB.spentOn`).
- **R7.** Its only authored goals (the guardians) live inside an endless
  curve: HP ×1.08 a wave with no cap (`balance.ts:392`, `waves.ts:62`).
- **Where the bot is.** Best floor median 9 after 12 h of Act 2
  (`docs/balancing.md:258`). The S7 targets are floor ≥ 10 at 12 h and the
  last star in 20–40 h (`plans/post-rebuild-improvements.md:497-498`).
  Floor 30 on today's curve is about 3.9 × 10¹³ HP for a weight-1 body,
  roughly 10⁷ times floor 9. Nobody gets there.

## 2. The shape

| | Stratum | Floors | Rule | Natives | Guardian (floor) |
|---|---|---|---|---|---|
| I | **The Gate** | 1–6 | *Gates*: waves come only through the floor's gates | Husk, **Lurker** (new), Wardstone | the Deepwarden, reworked (6) |
| II | **The Inversion** | 7–12 | some bodies start at the wall and walk out; an escapee drains the ultimate | Ram, **Tidecaller** (new) | **the Undertow** (12) |
| III | **The Narrowing** | 13–18 | the light closes a little every wave; a Keeper's fall opens it | Maw, **Wick** (new) | **the Iris** (18) |
| IV | **The Lightless** | 19–24 | the light reaches half as far; crits flare and light the ground | Husk, Wardstone, **Angler** (new) | **the Unlit** (24) |
| V | **The Root** | 25–30 | the earlier rules return, one or two a floor | all of them | **the Hunger**, the Act 2 finale (30) |
| | *The Below* | 31+ | strata II–V in turn, six floors each | all | their guardians again |

- **Every floor is still ten waves** (`FLOOR_WAVES`, `abyss.ts:21`).
  Floors 1–5 of a stratum end on a **Keeper wave** (§4.3). Floor 6 ends on
  the stratum's guardian, a real boss wave. Today's Act 1 bosses leave
  the Abyss. They stay in Boss Rush.
- **Where today's content goes.** The Deepwarden guards I. Its lore is
  already "something has to keep the deep from rising" (`bosses.ts:356`).
  The Hunger moves to the bottom: "The Blight was only its appetite"
  (`bosses.ts:402`) is the answer to Act 1's "something stirs below". The
  four natives are spread out, one or two a stratum, so each stratum has
  its own crowd. All of them return in V.
- **Guests.** Each floor also authors two Act 1 types as guests, so a
  floor's pool is natives plus guests (§5.2). The renderer draws guests
  30% toward the stratum's ground colour: the deep has changed them.
- **Agreed with 03.** The Hunger guards V, so Rootheart is the Hunger's
  and Gnawing Crown is the Iris's (03 updated 2026-11-14). 03's stratum names (The Gate,
  The Inversion, The Narrowing, The Lightless, The Root) and `StratumId`
  are the ones used here.

## 3. What the player sees

**First encounter.** The Blight falls. Act 1's ending still says
"something stirs below". The Map's Abyss card is now a **shaft** (§3.2),
with stratum I in colour and II as a silhouette. Floor 1 opens on a slate
ground with a frost rim and two glowing arches on its flanks. A letterboxed
banner (the boss intro's, `renderer.ts` `drawBanner`) reads:
**"Stratum I · The Gate"** and **"Waves come only through the gates."**
The music drops a fourth and a slow bell tolls.

**How it is taught.**

- `content/explainers.ts` `abyss` is rewritten (`:70-75`): *"Five strata,
  each with its own rule, natives and guardian, down to a bottom at floor
  30." / "A new deepest floor pays Starlight, and a guardian's first fall
  pays more. Pacts don't apply."*
- A new explainer, `waypoints` (view `map`), opens once the first guardian
  has fallen (`explainerOpen`: `profile.abyss.felled ≥ 1`): *"A fallen
  guardian opens its stratum's foot. Start your next descent there, with
  the tower already grown."*
- Each new native gets the Bestiary toast (`firstSight`, `waves.ts:369-372`)
  and an `introduce` beat on wave 5 of its first floor (`types.ts:750-752`).
- Each rule's banner shows on entering a stratum (a new `stratumEnter`
  event). Rule lines are ≤ 15 words (R4).

### 3.1 In a run, on a 375–430 px phone

- **Gates** are arches on the rim, 0.4 rad wide, in the stratum's rim
  colour. When they turn between waves, they slide round the rim over
  0.6 s (instant under reduced motion).
- **HUD:** the wave chip reads "Floor 3 · I" in the Abyss. Its text is
  short enough for 375 px.
- **Keeper wave:** a toast "The Keeper of floor 3", and the Champion's
  wide halo (N4) in the guardian's colours.

### 3.2 The shaft on the Map

The Abyss card (`ui/hub/map.ts:116-122`) keeps its header (deepest floor,
what the next floor pays). Under it hang five **bands** that descend in
order, I at the top, each 56 px tall and full width:

| Band state | Shows |
|---|---|
| Guardian down | ground colour, roman numeral, name, guardian icon, best floor reached in it, a **Start here** button (44 px target; `tests/touch-targets.test.ts`) |
| Reached, guardian standing | colour at 50%, name, "Guardian: floor 12" |
| Next unreached | a **silhouette**: the guardian's icon in `INK 700` on black, a faint rim glow, and the line *"Something waits at floor 12."* (≤ 15 words) |
| Deeper | black, no text |
| The Below | "Sealed" until the Hunger falls, then a band like the others |

A guardian's first fall now sets `profile.ceremony`. The results screen
leads to the Map, and that band lights from the top down over 0.8 s, the
shaft's form of the light spreading (`map.ts:83-93`). There is no
animation under reduced motion.

### 3.3 Active-only

This plan adds **no active-only reward**. The bottom must be reachable by
anyone who plays Act 2 at all. The pull to play live in the strata comes
from 03's reliquaries (a tap), 02's Abyss rifts and 04's ×2 anomaly rate.
Plan 08 only gives them a place. `RunSummary.activeOnly` gets no new kind,
and I9 is untouched.

## 4. The mechanic

### 4.1 Floors, strata and numbers

- `stratumOf(floor)`: floors 1–30 map to I–V, and 31+ to the Below's
  cycle (II, III, IV, V, six floors each, repeating).
- **Each stratum carries its own curve** (R7: authored per stratum).
  `waveHp` in the Abyss becomes `hpBase × hpGrowth^(n − from)`, where
  `from` is the stratum's first global wave (`waves.ts:61-62`). Each
  stratum's `hpBase` is the previous stratum's last wave, computed in
  `content/strata.ts`, so there is no cliff at a boundary. The guardian is
  the step. Stratum I equals today's numbers exactly.

| | I | II | III | IV | V | Below |
|---|---|---|---|---|---|---|
| `hpGrowth` / wave | 1.08 | 1.07 | 1.06 | 1.05 | 1.05 | 1.08 (`BALANCE.abyss`) |
| Last wave, weight-1 HP | 3.8 × 10⁵ | 2.2 × 10⁷ | 7.3 × 10⁸ | 1.4 × 10¹⁰ | 2.6 × 10¹¹ | grows |
| Guardian `bossHp` | 0.30 | 0.30 | 0.30 | 0.32 | 0.45 | 0.30 |
| First-fall Starlight | 20 | 25 | 30 | 35 | 60 | — |
| Waypoint level (placeholder) | 1 | 22 | 26 | 30 | 33 | 36 |

  Floor 30 lands at about today's floor 23.5 rather than 30. Damage keeps
  today's global growth (×1.025 a wave). Counts, elites and shards stay on
  `BALANCE.abyss`. The table's numbers are a start: `act2.ts` sets them
  (§9).
- **Starlight.** `abyssStarlight(f) = 2 × min(f, 30) + 1 × max(0, f − 30)`.
  The per-guardian 10 goes. Instead, `recordStratum` pays each guardian's
  lump on its first fall in the strata. To the bottom that is 60 + 200 =
  260, against 120 today. B7 still holds with room: heat 792 + strata 260 +
  feats 420 ≥ sky 896 (`tests/act2.test.ts:218-224`). Strata are about
  18% of Act 2's Starlight, so heat stays the main source.
  `BALANCE.strata.starlight = { perFloor: 2, below: 1, lump: [20, 25, 30, 35, 60] }`.

### 4.2 Rules

`StratumRule` is a closed union. `sim/strata.ts#ruleLoad(run)` is its
only switch: it turns the floor's rules, plus any rule the guardian's
phase wears (§4.5), into one `RuleLoad`, as `pactLoad` does for pacts.
Systems read the load.

| Rule | Data | Sim | Render / camera | Size |
|---|---|---|---|---|
| **Gates** (I) | `{ kind: 'gates'; count? }`; the angles are per floor | `rollWave`'s `angle()` (`waves.ts:169-171`) picks a gate, ± `arc`; boss summons (`boss.ts:298`) too | arches on the rim (`paintRim`, `painters/arena.ts`) | S |
| **Inversion** (II) | `{ kind: 'inversion'; share; drain }` | `share` of a wave's walker-like bodies spawn at `radius + r + 12` with `heading = −1`. Movement flips its sign (`sim/systems/enemies.ts:138-153`). Fully dark (`inLight` false, `arena.ts:85`) means it escapes: removed with no kill or pay, drains `drain` of the ultimate, `escape` event | a streak at the rim where it leaves | M |
| **Narrowing** (III) | `{ kind: 'narrowing'; step; max }` | `run.narrow` += `step` a wave, up to `max`. `refreshStats` multiplies range and light by `1 − narrow`, as the Fog-caller does (`draft.ts:345-349`). A Keeper's or Wick's fall takes some back | the camera holds the floor's opening extent (`camera.ts:226-229` would otherwise zoom in to follow), so the dark is seen to close | M |
| **Lightless** (IV) | `{ kind: 'lightless'; light; flare: { radius; seconds } }` | `stats.light` × `light` (0.5), so range outruns the light on purpose. Spawns keep the full rim (a new `stats.reach` for `spawnPoint`, `waves.ts:427`). A crit (`combat.ts:341-343`) opens a flare; `targetable` (`combat.ts:165-168`) also passes inside a live flare (≤ 8 at once) | `paintDark` (`painters/arena.ts:98`) cuts holes for flares; two faint eyes for bodies in the dark; the camera frames the full light | L |
| **Root** (V) | per floor, one or two of the above | `ruleLoad` folds them | each as above | S once I–IV exist |

Inversion picks its bodies on a new `strata` RNG stream, split in
`createRun`. Gates draw from the `waves` stream, which only strata floors
use in this way, so Act 1 seeds don't shift. Abyss seeds change anyway
with the new content.

**Checked against what exists.** Gates and Narrowing reuse the spawn
angle and the Fog-caller's dimming. Inversion reuses the outward heading
that the Lurker brings in stratum I (§5.1). Lightless is the costly one:
it breaks camera-and-fog's "what the tower can hit is lit" on purpose, and
it adds a draw pass on the GPU path that `plans/android-gpu-crash.md`
warns about. It ships last of I–IV and behind its own quality check.

### 4.3 Keepers

- A Keeper is a Champion (N4, `BALANCE.champions`) of one of the
  stratum's natives, wearing the stratum's aura. It walks in through a
  gate at 30% of wave 10, along with an ordinary wave.
  `isChampionWave` stays "never in the Abyss" (`waves.ts:132-134`). The
  Keeper is its own flag (`elite.keeper`).
- **The hold.** Wave 10 holds the next floor until its Keeper falls, or
  `BALANCE.strata.keeper.hold` (45 s) after its spawns finish. After that
  the next floor starts and the Keeper walks on. A Keeper never makes a
  stall that can't end. The horde enrage still covers a full field
  (`waves.ts:455`).
- **Floor clear.** `clearFloor(run)`, split out of `onBossKilled`
  (`boss.ts:474-482`), runs when a floor's next floor begins or the
  bottom's guardian falls. It counts `run.floors`, applies Abyssal Pearl,
  and sends the `floor` event.
- `BALANCE.strata.keeper = { hp: 1.5, hold: 45 }`. The `hp` is a
  multiple of a Champion's.

### 4.4 Waypoints

- `profile.abyss.felled` (0–5) counts the guardians felled in order. The
  feet of the felled strata open as waypoints: floors 1, 7, 13, 19 and 25,
  then 31 after the bottom. `profile.abyss.start` holds the chosen one.
- `RunConfig.startFloor` → `createRun`. Wave numbering begins at
  `(start − 1) × 10`, `run.floors = start − 1`, and the level is
  `BALANCE.strata.waypoint.level[k]` with its drafts banked, as Boss Rush
  does (`run.ts:65-66`). The placeholders above are replaced by the
  median level of the act2 bot as it enters that floor from floor 1.
  They stay under Final Form's ~27 (plan 07) only if the tool says so.
- Records and Starlight count from the floor reached, wherever the run
  started (`recordFloor`, `meta/pacts.ts:89-95`). A waypoint run's first
  wave takes the opening's flank arc (`n === start`).
- **Edge.** A waypoint stays open after a deeper record. It is never
  lost.

### 4.5 Guardians and the bottom

- One new `BossPattern`: `{ kind: 'rule'; rule: StratumRule }`
  (`types.ts:454`). While its phase lasts, the rule joins `ruleLoad`. The
  Deepwarden throws its gates open with it. The Hunger wears every
  stratum's rule in turn. That echoes on purpose the Blight wearing Act
  1's bosses: the Blight wore faces, and the Hunger wears the depths.
- **The bottom.** `BossDef` gains `bottom?: true` on the Hunger. `finale`
  stays the Blight's, so the four `BOSSES.find((b) => b.finale)` callers
  (`collection.ts:30`, `recipes.ts:27`, `tools/pacing.ts:154`, `App.ts:329`)
  are untouched. The Hunger's **first fall at floor 30 ends the run won**
  (`outcome: 'cleared'`, as Boss Rush, `waves.ts:473-477`). It sets
  `profile.ceremony = 'hunger'`, and the Map plays the ending (§5.4).
  Later runs pass through: the Hunger falls, and floor 31 follows.
- **The Below** (31+): `BALANCE.abyss`'s curve picks up from floor 30's
  last wave. It pays 1 Starlight a floor, no lumps and no ceremonies (R7).
  Guardians there keep kill counts only.

### 4.6 Edge cases

- **Pacts** still don't hold in the Abyss (`docs/act2.md`). A contract's
  rules (plan 10) stack with the stratum's. 10 checks validity.
- **Tyranny** can't reach the Abyss (no pacts), but the Rush has no pacts
  either, so the reworked phases are safe.
- **Leaving mid-stratum.** A retreat banks the floors cleared. There is
  no partial stratum credit.
- **The Map's chosen region** stays `ABYSS_INDEX`. The waypoint is a
  second field, so `selectedRegion` (`collection.ts:77-78`) returns
  `abyssFloor(start)`.

## 5. Content

Stratum I ships whole first. II–V are sketched to judge the idea.

### 5.1 Stratum I, the Gate (full)

**The rule: Gates.** Name "Gates". Text: *"Waves come only through the
floor's gates."* `BALANCE.strata.gates = { arc: 0.2 }` rad either side of a
gate. It asks for lanes: piercing, area on clumps, and chains. The
crowds wrap tangentially at the wall (`separateEnemies`), so the wall
isn't hit in two places only.

**The native: Lurker** (`lurker`). Verb
`{ kind: 'retreat'; below: 0.5; pace: 1.7 }`. Card text: *"Hurt, it flees
into the dark to heal. Slow it, or finish it."* (12 words).

- Below half HP it turns (`heading = −1`) and walks out at `pace` × its
  speed. Once fully dark, it heals to full, turns back and never flees
  again (`fled`). Stunned, frozen or slowed, it gets less far. Knockback
  *helps* it, so this is the one type where knockback is the wrong answer.
- Stats as multiples (as `enemies.ts` does): hp 1.6, speed 58, radius 24,
  damage 1.1, attack 1.0 s, armour 0, pack [2, 3], xp 1.8, mass 1.2,
  shape `diamond`, colour `#1f4a52`, border `#9ff0e0`, icon `bat`. Lore:
  *"It has learned the dark is safer than the light. It is right."*
- It brings the outward heading that the Inversion needs. Building it
  first is also building II's machinery.

**The floors.**

| Floor | Gates (rad; 0 right, π/2 down) | Guests | Natives (weight 0.45) | Wave 5 / 8 | Keeper |
|---|---|---|---|---|---|
| 1 | 2: 0, π (the short walk) | grunt, runner | husk | swarm ×1.3 / ×1.5 | Husk |
| 2 | 2: −π/2, π/2 (the long walk) | splitter, spitter | husk, lurker | introduce lurker / ×1.4 | Lurker |
| 3 | 3: −π/2, π/6, 5π/6 | brute, mender | husk, lurker | ×1.3 / ×1.5 | Husk |
| 4 | 2: π/3, 2π/3 (one front, below) | shieldbearer, blinker | +wardstone | introduce wardstone / ×1.4 | Husk |
| 5 | 4: ±π/4, ±3π/4 | bomber, phantom | all three | ×1.4 / ×1.5 | Lurker |
| 6 | 2, turning π/5 each wave | runner, splitter | all three | ×1.3 / ×1.5 | — (the Deepwarden) |

Elites on waves 3, 6 and 9 (`BALANCE.abyss.elites`). Auras: haste,
shield, vengeful, regen. Keepers wear *shield*.

**The guardian: the Deepwarden, reworked** (`bosses.ts:312-358`). Same
body and art, four phases instead of three:

| Below | Line (≤ 15 words) | Patterns |
|---|---|---|
| 1 | "It raises Wardstones at its gates. Break them, then it." | summon wardstone 1 / 9 s; slam / 5.5 s |
| 0.7 | "It sinks into the dark. Lurkers slip out of the gates." | submerge / 8 s, 3 s; summon lurker 2 / 7 s |
| 0.4 | "Its mirror turns. Shots that strike the glass come back." | mirror 3 facets; slam / 4.5 s |
| 0.15 | "It throws every gate open. Hold the wall." | `rule` gates (count 6); summon husk 2 / 6 s; slam / 3.5 s |

`rushOpen` (the Deepwarden's fall, `collection.ts:43-45`) and the
`warden-fallen` feat keep their meaning.

**Look.** Ground tint `#1d3540` (slate under deep water), rim `frost`
(an `FxColorName`, so the safe palette swaps it, `palette.ts:78-87`),
guests mixed 30% toward the tint. The enemy sprite cache keys by type
and stratum (`painters/enemies.ts:75-94`).

**Music.** Cold and wide. Key −5 semitones (E2). The run loop is i – ♭VII
– ♭VI – ♭VII, `[[0,3,7],[-2,2,5],[-4,0,3],[-2,2,5]]`, chord 5 s, cutoff
1000 Hz. A low root **drone** sustains under the floor, and a **bell**
(a sine at +19 semitones with a fast decay) tolls every second chord: the
gate. The boss mood keeps today's Phrygian churn in the stratum's key.

### 5.2 Strata II–V (sketch)

| | Native and verb | Guardian (icon) | Look / music |
|---|---|---|---|
| II Inversion | **Tidecaller**: every 6 s, flips the heading of bodies within 150. *"Turns the tide around it. Kill it, and they choose."* | **the Undertow** (`echo-ripples`): submerge, summons Tidecallers; last phase `rule` inversion at share 0.6 | rust-red ground, `ember` rim; bass pulse in the run mood |
| III Narrowing | **Wick**: slow; slain in the light, it gives back 0.04 of `narrow`. *"Carries a flame. Kill it to push the dark back."* | **the Iris** (`all-seeing-eye`): each phase closes the light 10%; its fall opens it all | bruised violet, `mana` rim; the chord shortens wave by wave |
| IV Lightless | **Angler**: lights 120 around itself; at the wall it bites ×3. *"Its lure lights its friends. Kill it last."* | **the Unlit** (`eclipse`): seen only by flares and its own lure | near black, `gold` rim (the tower's own light); a single voice, no pad |
| V Root | none new (all natives return) | **the Hunger**, five phases: feed (maws, pool) → `rule` gates → `rule` inversion → `rule` narrowing → `rule` lightless, *"Only a mouth in the dark. End it."* | the Blight's `arcane` back on the rim; all five keys in turn |

Floors 25–29 of the Root carry the rules in order: Gates, Inversion,
Narrowing, Lightless, then Gates with Narrowing. Each stratum also gives
02 two native rifts and 03 its drop table. Those plans own both.

### 5.3 Rewards per stratum

| | Floors pay | First fall pays | Also |
|---|---|---|---|
| I–IV | 2 ✦ each | 20 / 25 / 30 / 35 ✦ | the waypoint, the band lit, 03's boss relic |
| V | 2 ✦ each | 60 ✦ | the ending, the Below, a tower trim *Rootlight* (N5's `trims`, gaining a non-Trial source) |
| Below | 1 ✦ each | — | records only |

Existing feats keep their goals: `the-descent`, `warden-fallen`,
`hunger-sated` (now the bottom) and `abyss-20` (`content/feats.ts:78-81`).
The Bestiary's Abyss page lists the new natives, so
`abyss-naturalist` grows with them.

### 5.4 The ending

`App#depths`, beside `App#ending` (`App.ts:336-348`), is called from
`leaveResults` when the ceremony's boss has `bottom`. The shaft lights
band by band, then the modal comes after 2.4 s:

> **The bottom of the dark**
> The Hunger falls, and the deep goes still. What stirred below was never
> the Blight. The Blight was only its appetite, and now nothing is left to
> feed it. The tower's light reaches the bottom of the world. It took
> {runs} runs, {kills} enemies and {days} days since the stars came out.
> Act 2 is complete. Below the bottom, the dark goes on.

Buttons: **The Below** (sets the waypoint to 31) and **Credits** (a second
modal of authored lines in `content/ending.ts`, the owner's to fill).
The story ends here. It is not a cliffhanger. The Below is an epilogue
for records.

## 6. Data and code

| Layer | File | Change |
|---|---|---|
| content | `content/strata.ts` (new) | `StratumId = 'gate' \| 'inversion' \| 'narrowing' \| 'lightless' \| 'root'`; `StratumDef { id, name, numeral, rule text, natives, boss, hpGrowth, bossHp, tint, rim: FxColorName, guestMix, tone, landmark line, floors: FloorDef[6] }`; `FloorDef { gates, guests, natives, beats, keeper, rules }`; `stratumOf`, `stratumHome`, `waypoints` |
| content | `content/abyss.ts` | `abyssFloor` reads `stratumOf(floor)` instead of `floorTemplate` and keeps its cache (`:59-101`). `ORDER`, `floorTemplate`, `guardianFloor` and `ABYSS_BOSSES` go. `abyssStarlight` gets the new formula |
| content | `types.ts` | `RegionDef.abyss: { floor; stratum: StratumId; from; keeper; rules; gates }` (`:779`); `StratumRule`; verbs `retreat` (and later `tide`, `wick`, `lure`); `BossPattern` `rule`; `BossDef.bottom`; `EnemyId`s; `BossId`s `undertow`, `iris`, `unlit` |
| content | `enemies.ts`, `bosses.ts`, `balance.ts`, `explainers.ts`, `feats.ts`, `rush.ts` | Lurker; the Deepwarden's and the Hunger's phases; `BALANCE.strata`; the `abyss` text and `waypoints`; `homeOf` → `stratumHome` (`rush.ts:32-37`) |
| sim | `sim/strata.ts` (new) | `ruleLoad(run)`, the one `StratumRule` switch |
| sim | `systems/waves.ts` | `waveHp` from `from`; gate angles; inverted spawns; Keeper wave and its hold; `clearFloor` on floor entry |
| sim | `systems/enemies.ts`, `combat.ts`, `boss.ts`, `draft.ts`, `run.ts` | `heading`, `fled`, escape; flares in `targetable`; `rule` pattern; `narrow` and lightless in `refreshStats`; `startFloor`, the `strata` stream, the bottom's `cleared` |
| sim | `state.ts` | `Enemy.heading`, `Enemy.fled`, `RunState.narrow`, `flares`, `keeper`, `startFloor`; **`SNAPSHOT_VERSION` +1** (`save/index.ts:97`) |
| meta | `profile.ts`, `save/migrate.ts` | `abyss: { best, felled: 0, start: 1 }`; next free `PROFILE_VERSION` rung (15 today; 01, 03, 07, 10 and 11 take rungs too) |
| meta | `results.ts`, `pacts.ts`, `collection.ts`, `runConfig.ts`, `explainers.ts` | the guardian's first fall in the strata → `felled`, lump, ceremony; `recordStratum`; `selectedRegion` from `start`; `startFloor` on the config |
| ui | `hub/map.ts`, `hud.ts` | the shaft and bands, Start here, silhouettes; the floor chip |
| render | `renderer.ts`, `painters/arena.ts`, `painters/enemies.ts`, `camera.ts` | stratum tint and rim; gate arches; guest mix; the Narrowing's held extent; Lightless holes and eyes; `stratumEnter` banner |
| audio | `audio/music.ts` | `set(mood, tone)` with `Tone { shift, loop?, chord?, cutoff?, drone?, bell? }`; `toneOf(region)` in `App.ts:593` |
| app | `App.ts` | `depths()`; waypoint choice to the config |
| tools | `act2.ts`, `inspect.ts` | per-stratum report (§9); `inspect -- --floor N` from a waypoint |

**Determinism.** One new stream (`strata`), split in `createRun`. Act 1
runs and every non-Abyss seed are unchanged. `abyssFloor` stays pure and
cached by floor.

**Migration.** `abyss.best` is kept: it is what Starlight was paid
against, so no floor pays twice. The 10-per-guardian already paid stays
paid (at most 10 × ⌊best / 5⌋, a small windfall next to the new lumps).
`felled = 0`, `start = 1`: every guardian, the Deepwarden included, pays
its lump on its first fall in the strata, since the fights are new.
Deepwarden and Hunger kill counts, `rushOpen` and claimed feats stay. A
`best` above 30 means the Below's first floors pay nothing until
passed. That is not expected (median 9).

**Lint** (`content/lint.ts`). Floors 1–30 are covered once each. Every
stratum has six floors. Guests are Act 1 types. Natives and guardians
have `abyss: true`. Rule, keeper and silhouette lines are ≤ 15 words. A
rim is an `FxColorName`. A guardian's `rule` pattern names a rule from
its own stratum or earlier.

**Tests.** `act2.test.ts:315-327` rewritten for strata. `strata.test.ts`
covers `stratumOf`, continuous HP at the boundaries, the Keeper hold
ending in ≤ 45 s, a waypoint run's first wave number and level, the
Lurker fleeing once and healing, gate spawns inside ± arc, the bottom's
first fall `cleared` and its second passing to 31, Starlight and
migration (`save.test.ts`), and the shaft at 375 px
(`touch-targets.test.ts`). The B7 test reads `abyssStarlight(30)` plus
the lumps.

## 7. Interactions with the sibling plans

- **01 Stored Light:** Abyss runs burn it on shards, and Starlight isn't
  boosted (01 §11). That agrees.
- **02 Rifts:** the Abyss rate is 0.25 / 0.10 on floor waves 2–9; the
  Keeper wave (10) is not a boss wave, so a rift can open there unless 02
  excludes it. Two native rifts per stratum are 02's.
- **03 Cursed relics:** 03 owns the drop tables and the reliquary. It
  disagrees on the Hunger's stratum (§2): its Gnawing Crown goes to the
  Iris, and Rootheart to the Hunger. Keepers could drop a reliquary; 03
  decides. 03's `stratumOf` shim gives way to this one.
- **04 Anomaly cards:** ×2 on every floor. The Lightless suits a split look.
- **05 Secrets:** strata can author secrets and guardian forms later. None
  ship with this plan.
- **07 Final Form:** waypoint levels must stay under its ~27 level cap, or
  floor 13+ starts in Final Form. Check it in `inspect`.
- **10 Contracts:** `floor` targets cap at 30 (10 says "20 today"; today
  has no bottom). `stratumBoss` names the guardians (`undertow` is "the
  Inversion's guardian"). Waypoints make floor contracts short. Never in
  the Below.
- **11 Daily Omen:** Gates and Narrowing can serve as Omen twists. They
  need no natives, so they spoil nothing. Inversion and Lightless can too,
  once built.

## 8. Build steps

| # | Step | Size | Ships alone |
|---|---|---|---|
| 1 | `content/strata.ts`, `stratumOf`, `from` in `waveHp`, Keeper wave and hold, `clearFloor`, the new Starlight and lumps, profile fields and migration. Floors 7+ keep today's cycle behind a shim | M | yes |
| 2 | **Stratum I:** Gates, the Lurker (heading, retreat), the Deepwarden's `rule` phase, tint, rim, guest mix, the music tone, the banner, the explainers. *The test of the idea* | M | yes |
| 3 | The shaft, silhouettes, waypoints, the guardians' ceremony | M | yes |
| 4 | **Stratum II:** Inversion, Tidecaller, the Undertow. Decide on III–V after it | L | yes |
| 5 | Stratum III: Narrowing, the Wick, the Iris, the camera hold | M | yes |
| 6 | Stratum IV: Lightless, flares, the Angler, the Unlit, its quality gate | L | yes |
| 7 | Stratum V, the Hunger's five phases, the bottom, the ending and credits, the Below, Rootlight | L | yes |
| 8 | `act2.ts` per-stratum report and `inspect --floor` (with step 1) | S | yes |

## 9. Checks

| Reading | Want | Touches |
|---|---|---|
| `npm run pacing -- --act2 --hours 12 --seeds 4` | best floor ≥ 10 at 12 h (S7); stratum I's guardian down by ~6 h | Act 2 |
| same, `--hours 40` (new `act2.ts` lines: hour each guardian first falls, floors an hour by stratum, Starlight by source) | the bottom in 25–40 h, close to the last star (20–40 h); every stratum 4–8 h of Act 2 (about an evening of Abyss runs at `ABYSS_EVERY = 4`); strata ≤ 25% of Starlight | B7, R7 |
| `act2.ts` Rush line | full clear time within +15% of today's with the reworked Deepwarden and Hunger | Boss Rush records |
| `npm run inspect -- --floor 7 --seeds 20` (new) | a waypoint run reaches floor 9 at least as often as a floor-1 run reaching 9 | waypoint levels |
| `npm run inspect -- --floor 2 --seeds 20` | Lurkers escape < 25% of the time with the bot's Forge `all`; > 50% with knockback-heavy builds | the verb's answer |
| `npm run pacing -- --idle --hours 12 --seeds 4` | I2, I5, I7, I8 unchanged (this plan is Act 2 only); I9 unchanged (no active-only kind) | I2, I5, I7–I9 |
| `npm run arsenal`, `calibrate` | I4, T2 unchanged | — |
| `npm test` | `strata.test.ts`, migration, B7, palette (no literal colours in `render/`) | — |
| `formatNumber` | clean to 10³⁰ through floor 30 and the Below | P8 |

Play-testing check: nothing on floor 1 reads as an Act 1 region. Ask
someone who knows Act 1 which region floor 1 is. Want "none".

## 10. Risks

- **Calibration is a guess** until `act2.ts --hours 40` runs. The curve is
  per stratum, so a wrong stratum is one row to fix, not a global curve.
- **Art and music budget.** Five natives (four new), three new guardians,
  five tones. Stratum I needs one native, one rework and one tone. The
  plan stops after II if it doesn't land.
- **Lightless** costs readability and GPU time (the Android crash note).
  It may need a flat dark with no holes on the low tier.
- **Inversion** may be trivial for area builds or brutal for snipers.
  `inspect` by weapon (`--by-weapon`) on floor 8 shows it.
- **Fewer boss fights.** Keepers in place of floor bosses make floors
  shorter. That is fine for pace, but it removes the floor's beat if the
  Keeper reads weakly.
- **Boss Rush records** may become unbeatable if the reworked guardians
  are slower to kill.
- **Saves.** The `PROFILE_VERSION` and `SNAPSHOT_VERSION` numbers collide
  with five sibling plans. Take the next free rung when building.

## 11. Open decisions

1. **An ending or a cliffhanger at the bottom?** *Default: an ending.* The
   Below is an epilogue for records.
2. **Where the Hunger lives:** the bottom (this plan) or III (outline,
   03)? *Default: the bottom,* for its lore. 03's relics swap as in §2.
3. **Stratum I's guardian:** the reworked Deepwarden, or a new boss?
   *Default: the rework.* It keeps `rushOpen` and a known face, with a
   new fourth phase.
4. **Keepers instead of a boss every floor?** *Default: Keepers.* Today's
   per-floor bosses are Act 1's and repeat.
5. **The bottom's first fall ends the run?** *Default: yes* (`cleared`),
   so the ending isn't interrupted by floor 31.
6. **Pacts in the strata?** *Default: no,* as today.
7. **New guardians in Boss Rush after the bottom?** *Default: not in v1.*
   Rush stays 8 stages, so records stay comparable.
8. **A new native for V?** *Default: none.* All natives return there.
9. **Six floors a stratum, bottom at 30?** *Default: yes.* Waypoints keep
   a stratum to a 15–25 minute run.
10. **Waypoint levels:** fixed by the tool reading in §9, not by hand.
