# 03. Cursed relics

**Status:** 2026-11-14. Plan, not built. Idea 3 of the late-game review
([README](README.md)). Supersedes §6 of [c-abyss-strata.md](c-abyss-strata.md);
the strata themselves are [08-abyss-strata.md](08-abyss-strata.md).

**In one line:** the Abyss's elites, Keepers and guardians leave a reliquary
that only a tap claims; inside is a relic with one boon and one curse that
changes how you build, worn in its own slot, in the Abyss only.

---

## 1. The problem

- **Nothing in Act 2 is found by playing.** The Abyss's twelve relics drop
  once their Lantern stars are lit (`content/relics.ts:159-231`,
  `runConfig.ts:142`): bought with Starlight, then rolled by any run,
  watched or not (`combat.ts:1895-1906`).
- **Relics stop mattering past rank III.** A duplicate melts into one
  wave's pay (`results.ts:240-252`, `BALANCE.relics.peakWaves = 1`), and in
  Act 2 shards buy only masteries (docs/act2.md).
- **Every relic is a pure plus.** You wear the six best and stop thinking
  (`collection.ts:119-125`).
- **The outline's draft had faults.** "Glaives never return" names the
  wrong weapon: glaives orbit (`weapons.ts:122`), Moonblade comes back
  (`weapons.ts:156`). "Max HP −40%" is a number, not a change of play, and
  Frailty already sells it. "One random relic off each floor" fights the
  frozen `RunConfig` (`runConfig.ts:122`). Per-drop boon rolls would have a
  phone player comparing decimals, against "qualitative, ranks I–III"
  (docs/collection.md).

## 2. What the player sees

**First encounter.** The Deepwarden falls (floor 6, the Gate's guardian
in plan 08; floors 5, 15, 25… before 08 ships). A dark chest drops where it died, with a slow pulse and a
draining ring, and a toast says *"A reliquary · Tap it before it fades."*
The ring lasts 40 s of game time (80 s for a profile's first, with a
pointer). Tapped, it opens on a low chord and a toast names the relic and
its two lines. Left alone, it sinks, and the results screen says
*"1 reliquary faded."* A count, not a scolding.

**Taught by** the toast (the pattern of the Champion's "Slay it for a
relic.", `App.ts:627-634`), then a new explainer, `cursed`, on the
Collection view (`content/explainers.ts`), open once a cursed relic is owned:

- *"The Abyss's elites, Keepers and guardians can leave a reliquary. Tap
  it before it fades to claim a cursed relic."*
- *"Each has a boon and a curse. They hold only in the Abyss, in their own
  slot. Duplicates rank the boon up; the curse never changes."*

**Results.** A claimed relic shows its card and a **Wear** button (the
compare sheet if the slot is full). Cursed relics are never worn
automatically: the curse is a choice.

**Collection on a phone (375–430 px).** The Relics page gets a segmented
control (`ui/controls.ts`): **Relics | Cursed**.

```
 ┌───────────────────────────────────────────┐
 │ Cursed slot 1/1 · Bound 0 · Found 5/21    │
 ├───────────────────────────────────────────┤
 │ [icon] Unreturning          II · worn     │
 │ Crescents split in two on a kill.         │
 │ ☾ They never come back.                   │  ← curse line: own token + glyph
 │ Moonblade · deepest worn: floor 17        │
 ├───────────────────────────────────────────┤
 │ [chest] ???                               │
 │ Drops in the Narrowing (floors 13–18).    │
 └───────────────────────────────────────────┘
```

- The curse line has its own token (`--curse` in `styles/tokens.css`, with
  a colourblind-safe pair) **and** the ☾ glyph, so it never reads by
  colour alone.
- **Compare sheet** (`ui/modal.ts`): with the slot full, tapping an unworn
  relic opens a bottom sheet, worn above and new below (stacked at 375 px),
  each with its weapon (lit or not), rank and deepest floor worn. One
  **Swap**. Long-press (`ui/longPress.ts`) shows the same card.
- **Silhouettes** name the stratum once the shaft shows it (plan 08);
  deeper ones say *"Drops deeper."*
- **In a run,** the build peek (`ui/build.ts`) lists worn curses, and a
  draft card a curse leans on gets a ☾ badge (`cardBadges`,
  `suggest.ts:318`). The Map's Abyss card shows the cursed slot as a chip.

**Active-only:** claiming needs a tap. The Autocaster, auto-restart and the
idle bot never claim (I9). Wearing, ranks and binding are between runs.
The only other way in is 02's *Cursed Gift* rift, also a tap.

## 3. The mechanic

### 3.1 Where they drop

| Stratum (plan 08) | Floors | Elites and Keepers drop | Guardian (floor 6) drops |
|---|---|---|---|
| I. The Gate | 1–6 | nothing cursed (the intro stays clean) | Glass Crown (the Deepwarden) |
| II. The Inversion | 7–12 | Unreturning, Wall Saint, Hollow Bell | Turned Key (the Undertow) |
| III. The Narrowing | 13–18 | Wandering Orbit, Doorstep Rune, Burning Glass | Gnawing Crown (the Iris) |
| IV. The Lightless | 19–24 | Blunt Idol, Straight Wand, Hound Collar | Eclipse Seal (the Unlit) |
| V. The Root | 25–30 | Leaping Bone, Cinder Circlet, Leech Thread | Rootheart (the Hunger, the Act 2 finale) |
| The Below | 31+ (II–V in turn) | every stratum's elite relics, plus Starving Lamp, Wild Powder, Beggar's Mirror, Debtor's Rail | the guardian's own relic again |

- **Elites:** one cursed roll per elite, after the ordinary relic roll and
  on its own stream (§6.3), so one elite can give both.
  `BALANCE.cursed.eliteDrop` = 0.04, times Treasure Hunter's `relicLuck`
  (×2, `balance.ts:109`; `combat.ts:1899-1902`).
- **Keepers** (plan 08 §4.3: the Champion-like elite that ends floors 1–5)
  roll at `keeperDrop` = 0.12. 08 left this to 03; a Keeper is the
  floor's beat, so it should feel likelier.
- **Guardians:** the first fall in the strata always drops the relic; later
  falls at `bossDrop` = 0.35, so waypoint farming can't buy a boss relic to
  Bound in an evening.
- **Only what you can use:** a relic leaning on a weapon missing from the
  run's pool (an Act 2 weapon whose Smith star is unlit) never drops.
  `buildRunConfig` filters the table, as it does for the Lantern's sets.
- **Rate.** Elites walk on waves 3, 6 and 9 (`balance.ts:406`), one each
  (`waves.ts:198-206`): 18 a stratum, plus 5 Keepers. A pass is
  0.72 + 0.6 + 0.35 ≈ **1.7 reliquaries**. Plan 08 sizes a waypoint pass at
  15–25 minutes (08 §11.9), so about 4–7 an hour of strata play. A
  stratum's four at rank I take ~3 passes (about an hour), all four at III
  ~10 passes, all four Bound ~25. Four strata and the Below make a chase of
  roughly 40 hours, past 08's 25–40 h to the bottom.

### 3.2 How they fit the relic rules

| Rule today | Cursed relics |
|---|---|
| Qualitative, ≤ 15 words (R4, `lint.ts:9`) | Boon and curse **share** the 15 words |
| Ranks I–III by duplicates (`gainRelic`, `collection.ts:145`) | Same; a rank raises **the boon only**, the curse is fixed |
| Past III: set progress, else melt (`results.ts:240-252`) | Past III: **binding** (§3.3), then melt as today |
| Sets (N6) | None: `setOf` already returns null for a non-elite source (`relics.ts:291`) |
| Relic slots (`relicSlots`, `collection.ts:110`) | A **separate cursed slot**; ordinary slots untouched |
| A new relic is worn at once if a slot is free (`collection.ts:149`) | Never; the results screen's Wear button |
| Presets (U9, `post-rebuild-improvements.md:607`) | Not built. When they are, a preset saves both lists. Until then the cursed slot acts as one: curses hold only in the Abyss, so nothing comes off for a region run |
| Hold in every run | **Abyss only** (`inAbyss`, `collection.ts:38`): not the regions (heat records, B7), Boss Rush or Trials. One exception: an Omen twist (plan 11) that lends one holds for that run |

### 3.3 Slots, binding and lifting

- **The cursed slot** opens with the first cursed relic owned: no
  migration, no Starlight. A **second** opens when the Hunger first falls
  at the bottom (floor 30; 08's `bottom`, not Act 1's `finale` flag). No new Lantern star, so the sky's cost and B7 stay.
- **Binding.** Each duplicate past III adds a point (`BALANCE.cursed.bindAt`
  = 5, the count of a set rank, `BALANCE.sets.perRank`). At 5 the relic is
  **Bound**: it may also sit in an ordinary relic slot. Its curse stays.
  Later duplicates melt as today.
- **Cap.** At most `BALANCE.cursed.maxWorn` = 3 curses worn, in any slots.
- **Lifting? No.** A lifted curse is a stat stick with a second text, a
  second scorer estimate and a second lint entry, and it ends the choice.
  The upgrades are the boon's ranks and binding, which lets a dedicated
  player wear *more* curses, not fewer, paid in duplicates (R2). A
  Starlight cleanse was rejected: a sink outside the sky (B7) that removes
  the decision. Taking a relic off between runs is the only lift.
- **The non-farm upgrade** is plan 10's contract rider. 10 proposes
  "reroll a cursed relic's boon", but boons don't roll here (§1). The rider
  becomes **"a rank of a cursed relic you own"** (a binding point once it is
  at III): the same reward, in this plan's terms.

### 3.4 Claiming

- A drop places a **reliquary** in `RunState.reliquaries` where the body
  fell, for `claimSeconds` sim seconds. It outlives the floor's end.
- **Input:** `RunInput.claim?: number`, applied in `applyInput`
  (`run.ts:166-177`) like a pick, so it is in the replay. It joins 01's
  `ACTIVE_INPUTS` (01 §9.1), and `tools/play.ts`'s idle branch
  (`:131-136`) never sets it.
- **Two ways to tap,** both real `<button>`s, as 02 does for rifts (no
  canvas hit-testing, so pinch zoom in `ui/zoom.ts` is untouched):
  - a 48 px button over the chest (`ui/reliquaryTap.ts`, sharing 02's
    `ui/riftTap.ts` placement code), moved each frame through
    `Camera#worldToScreen` (`camera.ts:302`);
  - a 48 px **HUD chip** beside the ultimate, with a draining ring. A
    reliquary falls where the body died, so it may be under the HUD row
    or off-screen when zoomed in; the chip always works.
  Both ≥ 48 px in `tests/touch-targets.test.ts`. A claim also stamps 01's
  `lastTouch`, so it counts as engaged.
- The timer is sim time: it slows with a draft (15%) and stops while the
  app is hidden (`App#absent` never fast-forwards). Locking the phone never
  costs a reliquary. A retreat fades them all.
- Claims join `run.relics` and bank through `bankRun`, tagged
  `RunSummary.activeOnly` kind `'reliquary'` (01's I9 contract); fades
  count in `run.reliquariesFaded`.

### 3.5 Numbers (proposed `BALANCE.cursed`)

| Key | Value | Why |
|---|---|---|
| `eliteDrop`, `keeperDrop`, `bossDrop` | 0.04, 0.12, 0.35 (first guardian fall: 1) | ~1.7 a 15–25 min pass (§3.1) |
| `claimSeconds`, `firstClaimSeconds` | 40, 80 | about a wave; the first is a lesson |
| `bindAt` | 5 | the set-rank count players know |
| `maxWorn` | 3 | two cursed slots plus one Bound |
| per relic | `[I, II, III]`, as `BALANCE.relics` | e.g. `glassCrown: [1.5, 1.65, 1.8]` |

**Damage boons are `mult`, never `pct`.** A relic's `pct` sums into the
meta bucket (`types.ts:41-56`), which in Act 2 already holds the Forge's
and the sky's hundreds of percent, so "+50%" would add a few. Lint
enforces it.

### 3.6 Edge cases

- Leaping Bone and Cinder Circlet both touch burns: they stack as written,
  a pair on purpose.
- A curse on a weapon you don't hold costs nothing; the pool filter stops
  most such drops, and T5 (§9) flags a relic that is free this way.
- Turned Key drops `alchemy` and the fusions after `buildRunConfig`'s
  effects loop, so no Forge level puts them back. It also shuts out 07's
  Final Form (two evolved weapons): the long-press card says so. Rootheart clamps ordinary
  relics to rank I in the relic loop (`runConfig.ts:64-67`); sets keep
  their rank.
- Beggar's Mirror's extra elites roll for reliquaries too: it feeds the
  chase on purpose. A resumed snapshot keeps its reliquaries and timers.

## 4. Content: twenty-one cursed relics

Ship **five** first (the Gate's and the Inversion's), then four per
stratum as plan 08 ships it, then the Below's four. Text is boon, then
curse; together ≤ 15 words, counting "Curse:", which the UI draws as ☾.
Icons come from the existing sprite (`tools/contentReport.ts` checks
clashes).

| # | Relic (id) | Drops | Text | Leans on | How (boon / curse) |
|---|---|---|---|---|---|
| 1 | Glass Crown (`glass-crown`) | Gate boss | Damage ×1.5. Curse: the tower never rises again. | every weapon; Second Wind, Phoenix Feather | `damage mult` / `revives` 0 (`run.ts:136`) |
| 2 | Unreturning (`unreturning`) | II elite | Crescents split in two on a kill. Curse: they never come back. | Moonblade | crescent code (`combat.ts:815`) |
| 3 | Wall Saint (`wall-saint`) | II elite | Scattershot fires twice the pellets. Curse: it fires only while an enemy touches the wall. | Scattershot | count in `armed` / a fire gate |
| 4 | Hollow Bell (`hollow-bell`) | II elite | Your ultimate charges twice as fast. Curse: it strikes half as hard. | the ultimate | `ultCharge mult` / `systems/ultimate.ts` |
| 5 | Turned Key (`turned-key`) | II boss | +1 weapon slot. Curse: no weapon can evolve or fuse. | the draft | `slot` / no `alchemy`, no fusions |
| 6 | Wandering Orbit (`wandering-orbit`) | III elite | +2 glaive blades. Curse: they circle at the edge of range, not the wall. | Glaives | count, radius in `armed` (`arms.ts:82`) |
| 7 | Doorstep Rune (`doorstep-rune`) | III elite | Runes burst twice. Curse: they are laid only at the foot of the wall. | Rune Traps | a second burst / placement |
| 8 | Burning Glass (`burning-glass`) | III elite | Sunlance starts at full heat. Curse: other weapons fire half as fast. | Sunlance | both in `armed` (as Specialist, `arms.ts:66-67`) |
| 9 | Gnawing Crown (`gnawing-crown`) | III boss | Elites and bosses take double damage. Curse: all others take a quarter less. | elites and bosses | as `elite-bane`, `boss-bane` |
| 10 | Blunt Idol (`blunt-idol`) | IV elite | Damage ×1.6. Curse: you can never land a critical hit. | crits (Precision, Mirror Shard, Field Kit go dead) | `damage mult` / `critChance mult 0` |
| 11 | Straight Wand (`straight-wand`) | IV elite | Arcane Bolts pierce every enemy. Curse: they fly straight and never steer. | Arcane Bolt | pierce in `armed` / homing off |
| 12 | Hound Collar (`hound-collar`) | IV elite | +2 Sentinel Drones. Curse: drones hunt only elites and bosses. | Sentinel Drones | count in `armed` / a target filter |
| 13 | Eclipse Seal (`eclipse-seal`) | IV boss | Your ultimate strikes twice. Curse: only elite and boss kills charge it. | the ultimate | a second strike / charge gate (`combat.ts:1699`) |
| 14 | Leaping Bone (`leaping-bone`) | V elite | Lightning never fades between leaps. Curse: it leaps only to slowed or burning enemies. | Chain Lightning with frost or fire | no fade / a leap filter |
| 15 | Cinder Circlet (`cinder-circlet`) | V elite | Frost Ring burns and reaches 50% farther. Curse: it no longer slows. | Frost Ring, Ember Ward | radius, burn in `armed` / `slowSeconds` 0 |
| 16 | Leech Thread (`leech-thread`) | V elite | Soul Tether's drain mends the tower. Curse: regen no longer works. | Soul Tether | Max HP per held body a second / `regen mult 0` |
| 17 | Rootheart (`rootheart`) | V boss (finale) | Each curse you wear adds 15% damage. Curse: other relics count as rank I. | the curses themselves | both in `buildRunConfig` |
| 18 | Starving Lamp (`starving-lamp`) | the Below | +1 card in every draft. Curse: no rerolls, no banishes. | the draft | `extra-choice` / `reroll`, `banish` 0 |
| 19 | Wild Powder (`wild-powder`) | the Below | Mortar shells drop twice the bomblets. Curse: they land anywhere in range. | Mortar | bomblets in `armed` / aim from the `curse` stream |
| 20 | Beggar's Mirror (`beggars-mirror`) | the Below | Reliquaries drop twice as often. Curse: every wave brings an elite. | the chase; elites | drop ×2 / elite gate (`waves.ts:122`) |
| 21 | Debtor's Rail (`debtors-rail`) | the Below | A killing slug fires again. Curse: a slug that kills nothing costs 2% HP. | Gilded Rail | refire / `hurtTower` (`tower.ts`) |

All twelve weapons have one, and five verbs do (rising, the ultimate, the
draft, crits, elites). Each stratum's relics lean on its plan-08 rule:

- **II, the Inversion** (some bodies start at the wall and walk out; an
  escapee drains the ultimate): Wall Saint loves a wave's opening, Hollow
  Bell races the drain, Unreturning's crescents go out with the crowd.
- **III, the Narrowing** (the light closes each wave; a Keeper's fall opens
  it): Wandering Orbit's edge and Doorstep Rune's wall close in on each other.
- **IV, the Lightless** (the light reaches half as far; crits flare and
  light the ground): Blunt Idol's curse puts the flares out, so only the
  half light is targetable; Straight Wand fires blind down a line.
- **V, the Root** (the earlier rules return, one or two a floor): Leaping
  Bone and Cinder Circlet are a pair; Rootheart, the Hunger's, pays for
  wearing everything you found.

Ranks (T5 tunes them): multipliers rise by about a third of the rank-I gain
(1.5, 1.65, 1.8); counts by one (+2, +3, +4); shares toward 1 (0.7, 0.85, 1).

## 5. The draft scorer and the suggestion

The scorer prices a card through `buildDps` and `armed()`
(`suggest.ts:182-190`, `arms.ts:61`). Curses come in three kinds:

1. **Every weapon alike** (Glass Crown, Blunt Idol, Gnawing Crown,
   Rootheart): no ranking between cards changes, and the stats are in
   `run.stats` already, so Precision under Blunt Idol scores ~0 offence by
   itself. Nothing to do.
2. **A weapon's numbers** (pellets, blades, radius, fire rate, slow,
   bomblets, pierce, drone count): **into `armed()`** through a new third
   argument, `curseArms: Partial<Record<WeaponId, ArmsCurse>>`. The scorer
   calls `armed`, so it sees them for free.
3. **A weapon's behaviour** (fires only at the wall, never steers, never
   returns, leaps only to slowed or burning, hunts only elites, lands
   anywhere): each relic carries a calibrated `bias`, a multiplier on its
   weapon in `weaponDps`. `npm run calibrate -- --cursed` measures it in
   T2's sealed arena and holds it within `MAX_DRIFT` (0.25,
   `calibrate.ts:34`). Hound Collar alone needs context: `foesOf` gains
   `eliteShare`, the wave's HP in elites and bosses.

`cardBadges` adds `{ kind: 'cursed', relic }`. The Tactician's list still
comes first (`suggest.ts:447`): a list made before a curse may pick into
one, and the badge shows it. The Never list (U7) is the player's answer.

## 6. Data and code

**Content.** `content/types.ts`: `RelicId` += 21; `RelicSource` +=
`{ kind: 'cursed'; stratum: StratumId | 'below'; boss: boolean }`
(`types.ts:816-819`; `StratumId` is 08's `'gate' | 'inversion' |
'narrowing' | 'lightless' | 'root'` in `content/strata.ts`); `RelicDef` gains optional
`curse?: { text; effects }`, `leans?: WeaponId`, `bias?: number`; about 25
new `BehaviourId`s, one consumer each (R8). `content/cursed.ts` (new) holds
the defs, spread into `RELICS` so `RELIC_BY_ID` and banking just work.
`BALANCE.cursed`; the `cursed` explainer. Exhaustive `RelicSource` switches
to extend: `regionRelics` (`collection.ts:191-207`), `relicWhere`
(`ui/hub/collection.ts:40-54`), the region lint (`lint.ts:202-240`).

**Sim.** `RunConfig`: `cursed` (worn), `cursedTable` (by stratum, pool-
filtered), `curseArms`, `curseBias`. `RunState`: `reliquaries: { id; relic;
x; y; until }[]`, `reliquariesFaded`; events `reliquary`, `reliquaryClaim`,
`reliquaryFade` beside `relicDrop` (`state.ts:499`). The roll in
`eliteDeath` (`combat.ts:1866`), at `keeperDrop` for 08's `elite.keeper`,
and on a guardian's fall (`systems/boss.ts`); the table comes from
`stratumOf(floorOf(run.wave))`; claim in `applyInput`, fade in `step`;
`armed(stats, w, curse?)`.

**Determinism.** One new stream, `curse: root.split('curse')`, in
`createRun` (`run.ts:148-154`); `split` never advances the root
(`core/rng.ts:8-13`), so no seed moves. A run with no curse worn and no
reliquary is byte-identical to today (`tests/sim.test.ts` hashes).
`SNAPSHOT_VERSION` +1 (13 today, `meta/save/index.ts:97`); 08 bumps it
too, so take the next free number when building.

**Meta.** `meta/profile.ts`: `cursedWorn: RelicId[]`, `bound`, `cursedBest`
(deepest floor worn, for the compare sheet); ranks stay in `profile.relics`.
`PROFILE_VERSION` takes the next free rung (15 today, `profile.ts:136`;
01, 07, 08, 10 and 11 take rungs too), a `migrate.ts` step adding the
empty fields. `meta/collection.ts`: `cursedSlots`, `wornCursed` (empty
outside the Abyss), `toggleCursed`, the `maxWorn` cap; `gainRelic` never
auto-wears a cursed relic; `equippedRelics` admits a Bound one.
`meta/runConfig.ts`: boons at rank, curses once, Turned Key, Starving Lamp,
Rootheart. `meta/results.ts`: binding before melting, `cursedBest`, the
faded line, the `'reliquary'` kind in `RunSummary.activeOnly` (01).

**UI, render, audio.** `ui/reliquaryTap.ts` (on 02's placement code) and
the HUD chip; the Cursed segment
and compare sheet (`ui/hub/collection.ts`); Wear on `ui/results.ts`; worn
curses in `ui/build.ts`. A reliquary painter in `render/painters/`, drawn
above the fog so the Lightless can't hide it, colours from
`render/palette.ts`. Three cues in `audio/cues.ts`: drop, claim, fade.

**Lint.** A `cursed` source ⇔ a `curse`; `text` + `curse.text` ≤ 15 words;
strata II–V each three elite relics and one boss relic, the Gate one, the
Below four; no `pct` damage in a cursed relic; `leans` names a weapon.

**Tests.** `tests/cursed.test.ts`: Abyss-only drops from the stratum's
table; the pool filter; a claim inside the window banks, outside doesn't;
the timer stops while absent; `idle` never claims; ranks, binding at 5,
melt; `maxWorn`; Abyss-only effects; Rootheart's clamp; all 210 pairs of
curses run 3 floors with no throw or `NaN`. `save.test.ts`: the new rung.
`explainers.test.ts`: `cursed`. `calibration.test.ts`: every `bias`.

**Tools.** `tools/bot.ts`: `active` claims on the frame a reliquary appears,
with `--claim-rate` (default 0.9); `idle` and `bare` never claim.
`tools/act2.ts`: reliquaries seen, claimed and faded an hour; ranks and
binding over time; a wear policy (the best T5 reading for the bot's build).
`tools/arsenal.ts --cursed` (**T5**, like T4's keystones,
`arsenal.ts:9-12, 205`): each relic against none through its stratum,
deepest floor, time per floor, the leaned weapon's pick rate; "free" (only
gains) or "trap" (only loses) fails. `tools/inspect.ts --cursed <id>`,
beside 08's `--floor N`. `tools/idle.ts`: the `'reliquary'` kind stays
empty for the hands-off bot (01's I9), and it reports reliquaries faded
per idle hour.

## 7. Interactions with the sibling plans

- **01 Stored Light:** a claim stamps `lastTouch` (engaged); `claim` is in
  `ACTIVE_INPUTS`; claims are tagged `'reliquary'` in `activeOnly`. No curse
  touches shards, so none slows the burn (01 §7 guessed one might).
- **02 Rifts:** the reliquary button reuses `ui/riftTap.ts`'s placement.
  *Cursed Gift* (Act 2, legendary) is the one way to get a cursed relic
  outside the Abyss; it should draw from the tables of strata already
  reached, so it never spoils a silhouette.
- **04 Anomaly cards:** reuse §5's `bias` for the scorer. 04's "anomalies
  twice as likely, evolutions never" is a fair candidate for a later Below
  relic; Turned Key already owns "no evolutions", so it would need another curse.
- **05 Secrets:** none in 05's first fourteen. Later, a hidden 22nd relic
  ("fell the Hunger wearing three curses") whose silhouette never shows.
- **07 Final Form:** curses hold through the transformation. Turned Key
  forbids it (no evolutions); that is part of the curse. T5 runs Rootheart
  with Final Form.
- **08 Abyss strata:** authoritative on strata, guardians, Keepers,
  waypoints and `StratumId`. This plan owns the drop tables (with Gnawing
  Crown on the Iris and Rootheart on the Hunger, per 08 §2) and decides
  Keepers' drops (§3.1).
- **10 Contracts:** condition `cursed` (wear one) as 10 has it; the rider
  becomes "a rank of a cursed relic you own", not a boon reroll (§3.3).
- **11 Daily Omen:** the twist `cursed: id` lends one for the day's run,
  boon and curse, in any region; nothing drops in an Omen.

## 8. Build steps

| Phase | What | Size | Ships alone? |
|---|---|---|---|
| 1 | Types, `content/cursed.ts` with Glass Crown, `BALANCE.cursed`, lint, the profile rung, the cursed slot, wear and compare UI, Abyss-only config, explainer | M | hidden until a drop exists (R3) |
| 2 | Reliquaries: the stream, drops, `RunInput.claim`, tap and chip, painter, cues, results line, snapshot bump, bot claims, the I9 assert. Glass Crown from **today's** Deepwarden (floors 5, 15, 25…) | M | yes, before plan 08 |
| 3 | Stratum II's four, Keeper drops, `curseArms`, `bias`, `calibrate --cursed`, T5, badges | M | with 08's step 4 (stratum II) |
| 4 | Strata III, IV, V, with 08's steps 5–7; the second slot with the Hunger's first fall | S each | yes |
| 5 | The Below's four; binding and `cursedBest` polish | S | yes |

Phases 1–2 need nothing from 08. Phase 3 reads 08's `stratumOf`, whose
own shim (08 step 1) keeps floors 7+ on today's cycle until each stratum
lands. Whole plan: **L** (five M/S phases).

## 9. Checks

| Check | Reading | Invariant |
|---|---|---|
| `npm test` | §6's suites; Act 1 hashes unchanged | determinism |
| `npm run calibrate -- --cursed` | every `bias` within 0.25 | T2 |
| `npm run arsenal -- --cursed` | every relic PASS, neither free nor a trap | T5 (new) |
| `npm run pacing -- --idle --hours 12 --seeds 4` | hands-off bot: `activeOnly` has no `'reliquary'`, 0 cursed relics; faded per idle hour | I9 |
| `npm run pacing -- --act2 --hours 40 --seeds 4` | first cursed relic within the first hour in stratum II; 4–7 reliquaries per hour of strata play (~1.7 a pass); with claims ≥ 3 floors deeper than the same bot without, at the same star state, after 10 h in the strata; the bottom still in 08's 25–40 h | I9's point; 08 §9 |
| `npm run pacing -- --hours 12 --seeds 8` | identical to before | I1–I6, I8 |
| `npm run inspect -- --floor 13 --cursed wandering-orbit --seeds 30` | spot checks while tuning (08's `--floor`) | — |

I7 (Act 1 screen time) is untouched by design: this is Act 2's answer to
the same complaint.

## 10. Risks

- **The suggestion builds into a curse** (an idle-drafted run under Wall
  Saint takes Scattershot and stalls). T5, `calibrate --cursed` and the
  badge.
- **Stacking.** Three curses and Rootheart could trivialise the Below.
  `maxWorn` caps it; T5 runs Rootheart with two others.
- **Taps on a phone.** Bodies draw at 12–16 px and a chest may land under
  the HUD. Real buttons (as 02's) and the HUD chip are the safe path.
- **Waypoint farming.** 15–25 minute passes make guardians cheap to repeat;
  `bossDrop` 0.35 after the first fall keeps a boss relic's ranks earned.
- **FOMO.** Sim-time timer, stopped while hidden; a faded relic stays in
  the table; the results line is a count.
- **Content cost.** ~25 behaviours. Ship five, and stop if T5 shows the
  curses blurring together.
- **Plan 08 slips.** Phases 1–2 (Glass Crown from today's Deepwarden)
  still ship and test the tap; the rest waits on 08's strata.

## 11. Open decisions

1. **Where curses hold.** Abyss only, or Boss Rush too? *Default: Abyss only.*
2. **The claim window.** 40 sim seconds, or until the floor ends?
   *Default: 40 s (80 s the first time), plus the HUD chip.*
3. **The faded line.** Tell the player? *Default: yes, as a count.*
4. **The second cursed slot.** The finale, or a Lantern star? *Default: the
   finale (no Starlight change).*
5. **Binding.** Bound at 5 duplicates past III, three curses at most?
   *Default: yes.*
6. **Lifting.** Can a curse ever be removed? *Default: no.*
7. **Rolls.** Per-drop boon rolls, as the outline had? *Default: no; ranks.*
8. **Rootheart and sets.** Should its clamp hit set ranks? *Default: no.*
9. **The Gate's elites.** Drop anything cursed? *Default: no; only the
   Deepwarden, as the lesson.*
10. **Keepers** (08 left it to 03). Their own, higher chance? *Default:
    yes, `keeperDrop` 0.12 against an elite's 0.04.*
11. **Plan 10's rider.** A boon reroll, or a rank? *Default: a rank (or a
    binding point), since boons don't roll.*
