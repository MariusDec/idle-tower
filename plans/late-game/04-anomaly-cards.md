# 04. Anomaly cards

**Status:** 2026-11-14. P1–P4 built (see [docs/anomalies.md](../../docs/anomalies.md)
for what changed in the numbers); P5–P6 not built. Supersedes §2 of
[b-moments.md](b-moments.md) (Anomaly cards) and answers its Open question
"Can an anomalised weapon still fuse?".

**In one line:** about one run in nine, a card turns up that breaks a
weapon's rule for the rest of the run. It's never suggested and never
taken for you, so only a player who is watching gets it.

---

## 1. The problem

- **The draft has nothing left to surprise you.** `rollOffer` takes a
  uniform sample of `candidateCards` (`sim/systems/draft.ts:98-151`). The
  only cards that change *what a weapon does* are evolutions and fusions,
  and both are recipes the Book spells out once found
  (`meta/recipes.ts:29-44`, `:75-84`). The first evolution lands at
  ~94–100 min (`docs/balancing.md:155`, `:196`). After that, every run's
  arc is one you have seen.
- **Nothing in the draft needs you there.** A timed-out draft takes the
  suggestion (`app/App.ts:457`), and so does every bot
  (`tools/bot.ts:24`). Whatever the draft can give, the idle player gets
  too. That's the brief's root cause, inside a run.
- **Reveal gaps.** After hour 2 the longest gap between reveals is
  46–47 min (I6 wants ≤ 30). A rare card with a collection page adds
  surprises to exactly that stretch, but only for a player who is there
  (§9 says why I6 can't be credited from the bot).

The outline's examples needed fixing after reading the code:

| Outline | Problem | Here |
|---|---|---|
| Frost Ring "leaves its orbit" | Frost Ring pulses from the tower (`combat.ts:595`). Storm Crown already orbits (`BALANCE.evolutions['storm-crown'].orbit`) | **Whiteout** drifts to the thickest crowd |
| Sunlance "Prism": splits into three | Judgment already splits the beam into three (`evolutions.ts`, `splits: 2`) | **Lighthouse**: the beam sweeps |
| Drones "Swarm": spawn every 0.5 s | Too close to Hive (kills call drones) | **Dive Swarm**: drones dive and burst |
| Chain "Grounded": burning patches | A bonus, not a broken rule (R1 asks for a new verb) | **Serpent Current**: the arc crawls on |
| Glaives "Splinter": never return | Glaives orbit; nothing returns | **Gyre**: blades circle an enemy |

## 2. What the player sees

**First encounter.** The gate opens when the profile finds its first recipe
(~1.5 h of active play). The first run after that in which a weapon
reaches level 3 deals one anomaly for certain (the R3 reveal). After that
it's rare (§3).

**In the draft (phone, 375–430 px).** The anomaly isn't one of the hand's
cards. It's an extra row **above** the hand, full width and 64 px tall:

- icon on the left, then name, weapon and its ≤ 15-word line;
- a dark card face with a **split rim**: the border drawn twice, 1.5 px
  apart, in `--fx-mana` and `--fx-ember`, which slowly drift. This
  "chromatic split" is the anomaly's signature, in the draft and in the
  arena (§5). It uses no new hue, so `palette.test.ts` and `SAFE_FX` need
  no new entry;
- the kind label reads **Anomaly**. It never wears the Suggested tag, and
  the badge row adds **Ends ⟨evolution⟩** when the weapon's recipe is known
  (U4 style, from `cardBadges`);
- the first time ever, one line underneath: "Rare. Breaks its weapon's
  rule. Never taken for you." (10 words);
- `audio/cues.ts` plays a detuned bell on `anomalyOffer`, so a player
  half-watching the arena looks down;
- reduced motion: the rim holds still and the icon doesn't shimmer
  (`:root[data-motion='reduce']`, as `.draft-card-evolution` does).

With six cards (two rows of three) plus the row, the panel grows by
~72 px. That fits at 375×812 above the HUD's bottom row (to check, D4).

**Taking one.** The weapon's mount flashes with the split rim, a ring and a
spray roll out (`render/effects.ts#ring`, `#spray`), and a toast names it.
The first time ever there's a feat and an explainer (below). The results
screen lists it among the run's discoveries through the existing NEW-card
path (`cardKey` gives `anomaly:whiteout`, `App.ts:445-450`).

**Missing one.** If the draft times out, the anomaly goes and won't come
back this run. The results screen says one line: "An anomaly came and went:
Whiteout." The Book keeps it as **Glimpsed** (§6). Nothing is lost, and it
can come again.

**Taught by** a new explainer `anomalies` (`content/explainers.ts:13`),
view `collection`, open once anything is found or glimpsed:

1. "Some cards break a weapon's rule. They're rare: one run in nine or so, and never twice in a run."
2. "They're never suggested, and a draft that runs out of time won't take one. You have to be there."
3. "An anomalised weapon keeps levelling, but it never evolves or fuses. It's the weapon's other road."
4. "Anomalies you take are kept here. Nobody says how many there are."

**Active-only:** all of it. Idle play sees the card and the Glimpsed
line, never the weapon.

## 3. The mechanic

### Rules

- **One a run, at most.** At `createRun` a new `anomaly` stream rolls
  whether this run holds one (`RunConfig.anomalyChance`). If it does, it
  also rolls a delay of 0–`delay` eligible drafts, so the anomaly doesn't
  always come at the first chance.
- **Eligible weapon:** carried, at level ≥ `minLevel` (3), not evolved,
  not half of a fusion, and with an authored anomaly. Several eligible: one
  is picked on the `anomaly` stream.
- **Offered** by `tickDraft` after the hand is rolled, as an extra card at
  the end of `run.draft.cards`. Offered once. Picked or not, it's gone
  for the run.
- **Never suggested.** `suggest` treats it like a Never-listed card, but
  always (`suggest.ts:447`). The hand always holds ≥ 2 other cards
  (`minChoices`), so the fallback "only card left" case can't happen. So a
  timeout, Take-all, the Opening, the Tactician and every bot pass it by.
- **Take-all stops** at a hand holding an anomaly. `takeSuggested`
  (`draft.ts:261`) leaves that draft open, so a present player never skips
  one unseen. The picks are the same either way.
- **Timer:** a hand holding an anomaly gets at least `seconds` (10 s), even
  with the Tactician's 6 s.
- **Rerolls keep it.** It isn't from the deck. **Banish can't strike it**
  (`banishable` already returns false for any kind but weapon or passive,
  `draft.ts:192-196`).
- **Taken:** `w.anomaly = id`. The weapon keeps its slot and keeps
  levelling to 5. Its level steps feed the anomaly's numbers, and an
  anomaly may re-word a step (§5, `steps`).
- **Forbids evolution, so fusion is out too.** `evolutionCards` skips a
  weapon with `anomaly` set. A fusion needs both halves evolved
  (`draft.ts:75-83`), so it can't come either. It's a fork: the anomaly
  now, or the evolution later.
- **Not in Trials or Boss Rush.** Those test a fixed build. `anomalyChance`
  is 0 there (`runConfig.ts:34-35` already knows both).

### Rate

| Proposed `BALANCE.anomalies` key | Value | Why |
|---|---|---|
| `minLevel` | 3 | before `evolveAt` (5): the fork comes early, with real power at stake |
| `first` | 1 | the first run after the gate that reaches level 3 deals one (R3) |
| `chance` | 0.05 | base chance per run, after the first offer |
| `dryStep` / `dryCap` | 0.01 / 0.25 | +1% per run with no offer, reset on any offer; ~1 run in 9 on average |
| `abyss` | ×2 | the Abyss is where the late game lives (README order §3) |
| `delay` | 2 | eligible drafts the offer may wait |
| `seconds` | 10 | the draft timer's floor when an anomaly is in the hand |

`dry` lives on the profile and goes up in `bankRun` only while the gate is
open. Mean gap with these numbers: 9.2 runs (worked from the sum
Σ P(no offer before k) · p_k).

### Power target

The anomaly is a **side road**, not a bigger number. Each one's numbers
are set so that `damageDps` (fitted by calibrate) at L5 is 0.9–1.15× the
evolved weapon's, and at L3 1.2–1.4× the plain L3 weapon's. Its edge is
that it comes **two levels earlier** than an evolution and needs no
partner passive or Alchemy. That's a run-shaping spike, which matters most
in Act 1. In Act 2 its cost is the fusion it forbids.

### Edge cases

- Harbinger silence, Fog-caller's dim, Last Stand and Overclock reach an
  anomalised weapon as they reach any (`tickWeapons`, `combat.ts:351`).
- The first, authored draft: weapons are level 1, so nothing is eligible.
- The Opening (banked drafts at run start): the Drilled node and the
  Drilled relic together start a new weapon at level 3 (`draft.ts:278`),
  so an Opening hand can hold an anomaly. Take-all stops there, as it does
  anywhere, and the Tactician's 2 s auto-take is cancelled for that hand.
- A snapshot mid-draft keeps the card. The anomaly plan (`run.anomaly`) is
  run state.
- A weapon that becomes eligible during a boss wave: offered as normal.
- Rifts' Blood Price (02) may deal a second offer. "One a run" counts
  anomalies *taken*, not offers.
- Damage is credited to the weapon's own pattern (`DamageSource`), so T1
  credit, Bog Lantern and Brittle's area tags work unchanged.

## 4. Content: the twelve

One per weapon (`content/weapons.ts`), each with its own rule break. Text
≤ 15 words (R4). Icons from the pinned manifest where one is unused today;
"new" means a manifest entry and `npm run icons`.

| # | Weapon | Anomaly | Card text | Rule it breaks | Icon |
|---|---|---|---|---|---|
| 1 | Frost Ring | **Whiteout** | The ring leaves the tower and drifts as a blizzard to the thickest crowd. (14) | pulses centred on the tower → a moving storm | `snowflake-1` |
| 2 | Glaives | **Gyre** | The blades leave the tower to circle the toughest enemy in range. (12) | an orbit round the tower → round a foe | `spiral-arrow` |
| 3 | Sunlance | **Lighthouse** | The beam turns like a lighthouse, burning everything it sweeps across. (11) | holds one target → sweeps all | `orbital-rays` |
| 4 | Mortar | **Creeping Barrage** | Each salvo walks a line of blasts from the fog to the wall. (12) | aimed at a crowd → a walking line | new |
| 5 | Arcane Bolt | **Murmuration** | Bolts gather in a circling flock; at twelve, they all dive at once. (12) | fire on cooldown → store, then release | new |
| 6 | Chain Lightning | **Serpent Current** | The arc never stops: it crawls body to body while anything is in reach. (14) | an instant, fixed chain → a crawling, open one | `lightning-branches` |
| 7 | Scattershot | **Cascade** | A pellet that kills bursts into three more, flying on outward. (11) | a blast ends where it lands → kills carry it on | new |
| 8 | Sentinel Drones | **Dive Swarm** | Drones hold their fire: each dives into a crowd and bursts. Another launches. (13) | standoff shooters → strikers spent on impact | new |
| 9 | Moonblade | **Hanging Moon** | Crescents stop at their farthest reach and spin there for 2.5 s. (11) | out and straight back → hangs in the crowd | new |
| 10 | Rune Traps | **Wardweb** | Runes link in a web of light; crossing any thread sets both off. (12) | a point trigger → the field between runes | new |
| 11 | Soul Tether | **Marionette** | Held bodies turn: they walk back out, striking their own kind. (11) | drain → control | `acrobatic` |
| 12 | Gilded Rail | **Kaleidoscope** | The slug glances off the light's edge, crossing the field three times. (12) | one straight line → a bouncing path | `zig-arrow` |

No name clashes with an evolution, fusion, frame or ultimate (Eclipse and
Blizzard are taken, so the obvious names are out). The lint checks this
(§6).

### Numbers and render notes (proposed `BALANCE.anomalies[id]`)

| Anomaly | Numbers | Sim | Render (`render/painters/`, `effects.ts`) |
|---|---|---|---|
| Whiteout | `damage 1.3`, `drift 80` u/s, `reach 0.6` × range, `radius 0.8` × the ring's | a cell `{x, y}` on the weapon, steered to `densest` (`combat.ts:638`). `frostPulse` (`:595`) takes a centre instead of the origin | `arsenal.ts`: a soft frost disc with flakes swirling round it (count by quality tier); the `pulse` event gains `x, y`, so `renderer.ts:239` rings at the cell |
| Gyre | `damage 1.35`, `orbit 30` beyond the target's radius, `travel 700` u/s | `sweepBlades` (`:1117`) measures distance from a centre: the `toughest` body (`:219`), else the tower. Blades fly to a new target at `travel` | `paintBlades`: blades round the target, a faint ring on it, streaks while travelling |
| Lighthouse | `damage 1.25`, `turn 1.2` rad/s (× attack speed), `width 18` | `holdBeam` (`:1046`) sweeps an angle and hits along it to range, like a rail line (`onLine`, `:230`). Heat builds while the sweep hits, and resets after an empty turn | `paintBeam`: a full-range wedge, additive glow, an afterglow arc fading over the last ~0.6 rad |
| Creeping Barrage | `blasts 5` (+1 per shell step), `stagger 0.12` s, `damage 0.55` × the shell, per blast | `lobShells` (`:720`) queues blasts along the line from the light's edge to the wall, through the densest body | a 0.3 s dotted range line, then shells landing one by one toward the tower; bomblets as now |
| Murmuration | `flock 12`, `dive 1.3` | each volley adds `count` bolts to a flock circling at 60 u. Full, they launch as homing bolts at the densest | a starling swirl of bolt sparks (jitter from `clock`, not the sim), then a dive of streaks |
| Serpent Current | `hop 0.06` s, `fade 0.9` per hop, `maxHops 24`, ≤ 2 alive | a current object steps one hop per `hop` instead of `chainStrike`'s instant loop (`:555`) | `effects.lightning` per hop, its head brighter: a visible snake through the crowd |
| Cascade | `splits 3`, `spread 0.5` rad, `generations 2`, `damage 0.8` per generation | a pellet's kill in `strike` (`:1374`) launches new pellets outward | a small pop ring at each split; pellets as now |
| Dive Swarm | `burst 3` × the shot, `radius 50`, `dive 520` u/s; one relaunch per 1/fireRate | `flyDrones` (`:1153`): a drone at its quarry dives and bursts | gold-tipped trails, a burst ring, a launch spark at the tower |
| Hanging Moon | `hang 2.5` s, `bite 26`, `ticks 4`/s | `flyCrescent` (`:776`) holds at the turn point | the crescent spinning in place with a circular blur |
| Wardweb | `link 200`, `width 10` | `tickRunes` (`:853`): a body within `width` of a segment between linked runes bursts both | `paintRunes` draws shimmering threads, which flash on a trigger |
| Marionette | `walk 0.5` × speed, `strike 1.5` × contact per s, no bosses | a held body's walk turns outward (`tickEnemies`), and its contact hits land on bodies it touches, credited `tether` | `paintTethers`: the held body outlined in `nature`, with hit sparks |
| Kaleidoscope | `bounces 3`, `falloff 0.85` per leg | `fireSlugs` (`:954`) reflects off the oval (`content/arena.ts#rimAxes`) | the `rail` event becomes a polyline; sparks at each rim point |

**Signature treatment.** Each anomaly's key shape (the cell, the blades'
ring, the wedge, the flock) gets a second pass offset by 1.5 px in `mana`
and `ember`, at low alpha. That makes it read as *wrong* at a glance, and
the eye learns to spot an anomaly in the arena. The extra pass is dropped
on the lowest quality tier (`render/quality.ts`).

**Step re-wordings** (`AnomalyDef.steps`, null = the weapon's own): only
where the weapon's line would be false. Sunlance L4: "The sweep turns 30%
faster." Mortar L4: "+1 blast in the walk." Glaives L4: "The blades circle
wider, and are bigger." holds as is.

### What ships first: 4, all Act 1

**Whiteout, Gyre, Lighthouse, Creeping Barrage.** Each reuses an existing
hit routine with a new centre or path (`frostPulse`, `sweepBlades`,
`holdBeam` with `onLine`, `lob`), so the sim work is small and the effort
goes into the spectacle. They cover four patterns and three targeting
doctrines. Frost Ring is the owner's example.
Next: Murmuration, Serpent Current, Cascade, Dive Swarm (new moving
objects, perf caps). Last: the four Act 2 weapons' anomalies, which only
appear once those weapons are lit.

## 5. Interactions with evolutions and fusions (decided)

| Option | For | Against |
|---|---|---|
| **Forbid (chosen)** | a real fork; 12 anomaly code paths, not 12 × evolution combos; the power band is easy to hold | a fusion player may skip it in Act 2 |
| Stack | no regret | Gyre + Halo, Lighthouse + Judgment, Whiteout + Absolute Zero each need joint rules; power runs away |
| Replace (it *is* the evolution) | simple | it would need the partner passive, so it comes late and isn't rare-and-early |

Absolute Zero's freeze, Halo's sweep and the rest stay with the evolution.
An anomaly never borrows them.

## 6. Data and code

| Layer | Change |
|---|---|
| content | `types.ts`: `AnomalyId` (12), `AnomalyDef { id, name, icon, weapon, text, rule, steps? }`. New `anomalies.ts`: `ANOMALIES`, `ANOMALY_BY_ID`, `ANOMALY_OF: Partial<Record<WeaponId, AnomalyDef>>` (Partial until P6, then full). `balance.ts`: `BALANCE.anomalies`. `explainers.ts`: `anomalies`. `feats.ts`: **Anomalous** (take one), **Strange Arsenal** (take five). `lint.ts`: R4, one per weapon at most, a name unique across weapons, evolutions, fusions, frames and ultimates, icon not shared (`contentReport.ts`) |
| sim | `state.ts`: `Card` gains `{ kind: 'anomaly'; id: AnomalyId }`. `WeaponState.anomaly: AnomalyId \| null`. `RunState.anomaly: { held: boolean; delay: number; offered: AnomalyId \| null; taken: AnomalyId \| null }`. New event `anomalyOffer`; `pulse` gains optional `x, y`; `rail` becomes a polyline. `run.ts`: `streams.anomaly = root.split('anomaly').state`, and the roll at `createRun`. `draft.ts`: `anomalyCard(run)` called from `tickDraft` and `rerollDraft`. `applyCard`'s new case. `evolutionCards` skips `w.anomaly`. `takeSuggested` stops at it. `arms.ts#newWeapon`: `anomaly: null`. `combat.ts`: per-anomaly branches inside each pattern's routine, through an exhaustive `switch (w.anomaly)` ending in `never` (R8). `suggest.ts`: see below |
| meta | `profile.ts`: `anomalies: { found: AnomalyId[]; glimpsed: AnomalyId[]; dry: number }`. `runConfig.ts`: `anomalyChance` (0 before the gate, in Trials and in Boss Rush; `first` until the first offer; then `chance + dry·dryStep`, capped, ×`abyss`). `results.ts#bankRun`: found or glimpsed, `dry`, the results line. `explainers.ts#explainerOpen`. `recipes.ts#anomalyBook` |
| ui | `draft.ts`: `describe` / `details` cases (long-press: weapon, the `rule` line, "No evolution or fusion this run.", "Never taken for you."); the anomaly row; the timer floor. `hub/collection.ts`: the Recipes page gets a third section, **Anomalies · N found** (found ones in full, glimpsed as name + weapon + "Not yet taken"; never a total, never `???` rows). `styles/main.css`: `.draft-card-anomaly` with the split rim |
| render | §4 table; `effects.ts` gains nothing new beyond `ring`, `spray`, `lightning`, `streak` |
| audio | `cues.ts`: `anomalyOffer` (detuned bell), `picked` of an anomaly (a reversed swell) |
| tools | `calibrate.ts`: cases L3 and L5 per shipped anomaly (`LEVELS`, `:49`, `:132`). `arsenal.ts --anomalies`. `idle.ts`: the I9 assert. `pacing.ts` / `act2.ts`: offers per seed |

**The scorer** (`sim/suggest.ts`):

- `damageDps` and `utility` take `anomaly` in their `Pick`, with one branch
  per anomaly and constants fitted by calibrate (T2's 25% band). That's
  what keeps the *other* cards' scores right once an anomaly is on the
  tower. Levelling Whiteout must be valued as Whiteout.
- `scoreCard('anomaly')` = DPS gain + `ANOMALY_VALUE` (0.6), less
  `EVOLUTION_VALUE × readiness` when the weapon's recipe is known. The
  in-game suggestion never reads it (it's filtered out first). It's used
  by `arsenal --anomalies` and a long-press "≈ +N% damage" line.
- `suggest`: `ruledOut(c)` is true for every anomaly, before the Tactician's
  `rank` (`:434`) and before the scorer.
- `scoreCard`'s `weapon` case copies `anomaly` onto `next`, as it copies
  `evolved`.
- `cardBadges`: a `fork` badge, "Ends ⟨evolution⟩", when the recipe is
  known.

**Determinism.** The roll and the weapon pick use only the new `anomaly`
stream. `split` doesn't advance the root (`core/rng.ts:71`). The anomaly is
appended *after* the hand is rolled and scored, so the `draft` stream and
the suggested index don't change. A run that declines its anomaly makes the
same picks as a run with `anomalyChance` 0.

**Saves.** `PROFILE_VERSION` 15 → next (`profile.ts:136`), with a
`migrate.ts` step adding `anomalies: { found: [], glimpsed: [], dry: 0 }`.
`SNAPSHOT_VERSION` 13 → next (`meta/save/index.ts:97`). Sibling plans bump
the same numbers, so take the next free one at build time.

**Tests.** `draft.test.ts`: never suggested over many hands, Tactician
lists included; never in `candidateCards`; at most one offer a run; rerolls
keep it; Banish refuses it; Take-all stops at it; an anomalised weapon never
gets its evolution or a fusion. `sim.test.ts`: a seed with chance 1, timed
out, matches the same seed with chance 0 wave for wave (wave, level, kills,
shards). `calibration.test.ts`: each shipped anomaly. `content.test.ts`: the
lint. `save.test.ts`: both migrations. `explainers.test.ts`: opens on found
or glimpsed. `idle.test.ts`: I9.

## 7. Interactions with the sibling plans

- **01 Stored Light:** none. Stored Light speeds shards; anomalies don't
  touch shards.
- **02 Rifts:** Blood Price's extra draft rolls an anomaly for an eligible
  weapon on the `anomaly` stream. It's the one guaranteed way to see one.
  Still one *taken* a run.
- **03 Cursed relics:** a curse could read "anomalies twice as likely,
  evolutions never". It can raise `anomalyChance` through `RunConfig`, never
  take one for you.
- **05 Secrets:** the anomaly count is never shown. A secret may reveal
  "twelve" or point at a missing weapon's anomaly.
- **07 Final Form:** an anomalised weapon counts as evolved for "every slot
  evolved or fused". Otherwise taking one would block Final Form.
- **08 Abyss strata:** `abyss` ×2 applies to every floor. A stratum's rule
  may raise it further (stratum IV, the Lightless, suits the split look).
- **10 Contracts:** "Take an anomaly" and "Take Gyre" make good contract
  goals. They're active-only by nature.
- **11 Daily Omen:** an omen "Strange stars: every run deals an anomaly"
  reuses `anomalyChance`.

## 8. Build steps

| Phase | What | Size |
|---|---|---|
| P1 | Framework: types, `BALANCE.anomalies`, the stream and roll, the offer in `tickDraft`, never suggested, forbids evolution, Take-all stop, profile and snapshot migrations, `bankRun`, the draft row with the split rim, cue, tests. **Whiteout** end to end (sim, scorer, calibrate, render) | M |
| P2 | **Gyre** and **Lighthouse**: sim, `damageDps`, calibrate, painters | M |
| P3 | **Creeping Barrage**; the Recipes page's Anomalies section, Glimpsed, the results line, explainer, feats | M |
| P4 | Tools: `arsenal --anomalies`, the idle I9 assert, offers in `pacing` and `act2`. Then the readings in §9 | S |
| P5 | Murmuration, Serpent Current, Cascade, Dive Swarm, with perf caps checked in `tower.bench` | L |
| P6 | Act 2: Hanging Moon, Wardweb, Marionette, Kaleidoscope. `ANOMALY_OF` becomes total and the lint holds one per weapon | L |

Each phase ships on its own. P1–P3 make four anomalies in Act 1, which is
enough to judge the idea before committing to P5–P6.

## 9. Checks

| Reading | Target | Invariant |
|---|---|---|
| `npm run calibrate` | every shipped anomaly at L3 and L5 within 25% | T2 |
| `npm run arsenal` | unchanged by construction (the bot never takes one); worst share ≤ 40% | I4 |
| `npm run arsenal -- --anomalies` (a present policy that takes every offer, chance forced to 1) | per anomaly, against the same seeds on the evolution path: median wave −1…+2, boss time ±15%; new-weapon shares still ≤ 40% | I4, the power band |
| `tools/idle.ts` (`npm run pacing -- --idle --hours 12 --seeds 4`) | 0 anomalies taken, > 0 offered (so the check isn't vacuous) | I9 |
| `npm run pacing -- --hours 12 --seeds 8` | first offer ≤ 2 runs after the first recipe; 3–8 offers in Act 1 after the gate; I1a, I1b, I3, I6 unchanged (the bot never takes one) | I1, I3, I6 |
| `tools/act2.ts` (`npm run pacing -- --act2 --hours 12 --seeds 4`) | offers per Abyss hour ≈ 2× Act 1's per run | none |
| `npm run inspect -- --seeds 20 --by-weapon` with a forced anomaly | its damage credited to its weapon | T1 |
| `tower.bench({ enemies: 300 })` with Serpent Current and Cascade | inside the frame budget (docs/performance.md) | none |

**What this plan doesn't claim.** Anomalies are rare, so they barely move
I7 (screen time to the Blight), and pacing's bot can't show them closing
I6's gaps because it never takes one. Their job is the "did you see that?"
moment and a collection only presence fills. The honest reading is the
Glimpsed-to-found ratio in a real profile, plus the I9 assert.

## 10. Risks

- **Spectacle is the cost.** Twelve bespoke painters and sim paths. That's
  why four ship first and the framework is judged on them.
- **A trap or a must-take.** Weaker than the evolution and players learn to
  skip it, and the moment dies. Stronger and it's "be there or lose". The
  `--anomalies` band and calibrate hold it to a side road.
- **The scorer can't price odd patterns.** Gyre's target hopping and
  Whiteout's drift are hard to estimate. If calibrate can't fit them within
  25%, use a measured constant per anomaly, as `HIVE_VALUE` does.
- **Missing out (FOMO).** "An anomaly came and went" could sting an idle
  player. It has no timer and no cost, and it recurs. If playtests say it
  stings, drop the results line and keep Glimpsed in the Book.
- **Phone space.** Six cards plus the row at 375×812 needs checking. If it
  doesn't fit, the row replaces the panel's header line.
- **Frame rate.** Serpent Current and Cascade spawn hits over time. Caps
  (`maxHops`, `generations`, ≤ 2 currents) and the bench gate P5.
- **Version collisions** with sibling migrations (§6).

## 11. Open decisions

1. **Forbid evolution and fusion, or stack?** Default: forbid (§5).
2. **The gate.** Default: the first recipe found. Alternatives: boss 2, or
   Act 2 only, which would lose the Act 1 moment the README wants.
3. **The rate.** Default: 5% a run, +1% per dry run up to 25%, ×2 in the
   Abyss, with the first one guaranteed.
4. **Show the total?** Default: never. Plan 05 may reveal it.
5. **Trials and Boss Rush.** Default: no anomalies there.
6. **The Glimpsed line on the results screen.** Default: yes, with no
   timer or penalty attached.
7. **Take-all stops at an anomaly hand.** Default: yes.
8. **Does an anomaly count as evolved for Final Form (07)?** Default: yes.
9. **A new colour token?** Default: no. The split rim in `mana`/`ember`
   is the signature.
10. **Which four first?** Default: Whiteout, Gyre, Lighthouse, Creeping
    Barrage.
