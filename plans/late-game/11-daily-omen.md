# 11. The Daily Omen

**Status:** 2026-11-17. Built: steps 1–4, and step 6's Rift-touched,
Strange Stars and Lent: Glass Crown. Not built: phase 5 (proof codes and
the replay worker; `replayOmen` exists and is tested), `tools/act2.ts
--omen`, and the modifiers whose seams don't exist yet (Gates, Narrowing,
Hollow Bell, Early Bloom). Tuning: the tower is every ring to 6 (the start
below fell near wave 13), points [6, 8]; `npm run omen -- --days 28`
meets the median run and median wave, but not band III ≤ 25% (46%), the
earliest fall (wave 10, on Blight Heart and The Hollow days) or the
active/hands-off gap (0). Planned 2026-11-14. Supersedes §2 of
[d-come-back.md](d-come-back.md), and its Omen lines in §3 (Checks) and
Open.

**In one line:** one run a day, built from the local date alone, so two
friends on the same date fight the same place, rules and waves with the
same tower, and compare a short code, all without a network.

---

## 1. The problem

- From the Blight on, the only things to do are push heat, descend the
  Abyss or race Boss Rush (docs/act2.md). All three are open-ended and
  private. None gives a reason to open the app *today* rather than
  tomorrow, and none can be compared with anyone.
- Every Act 2 run is built from the profile (`meta/runConfig.ts:32`
  `buildRunConfig(profile)`): the Forge, stars, relics, sets, the
  Tactician's lists and recipes found. Two players' runs are never the
  same run, so a score means nothing to anyone else.
- The pieces for a comparable run already exist. The sim is a pure
  function of `(RunConfig, seed, inputs by tick)` (`sim/run.ts:47-50`,
  docs/sim.md). Trials already turn a list of rules into run overrides
  (`meta/runConfig.ts:146-180` `trialRules`). Pacts already act as Trial
  "omens" (`content/trials.ts:27`). Copying text works offline
  (`platform/files.ts:43` `copyText`). The app has no INTERNET permission
  (`android/app/src/main/AndroidManifest.xml:34`), and this plan keeps it
  that way.

### What the outline got wrong (after reading the code)

| Outline (d §2) | What the code says | This plan |
|---|---|---|
| "A fixed tower … like Boss Rush's level 16" | Boss Rush keeps the player's whole Forge; only the level is fixed (`sim/run.ts:65`) | A profile-free `omenConfig(day)`: nothing in it reads the player's profile |
| "Same waves for everyone" | True of what spawns: `rollWave` is pure given the `waves` stream (`sim/systems/waves.ts:156`, `:253`). But *where* a body spawns uses the tower's light radius (`waves.ts:427`), *when* a wave starts depends on kills (`shouldAdvance`, `waves.ts:487`), and the light's oval comes from the device's screen (`app/App.ts:377` `renderer.stageOval()`) | Same spawn lists for everyone. The arena is fixed to `PHONE_OVAL` (`content/arena.ts:49`) so a tablet plays the same run as a phone |
| "Endless … on the Abyss curve" | Regions already have an endless curve: overtime, HP ×1.25 a wave (`BALANCE.overtime.hpGrowth`), Champions every fifth, the stall enrage (`waves.ts:452-465`) | The Omen is a region run with overtime. No new curve |
| "The code encodes the run's input log" | No input log exists. A log of ~80 inputs is ~340 characters of base64: too long for a chat line | A short result code (18 characters) now. The input log is an optional "proof" for a later phase (§4.7) |

## 2. What the player sees

### First encounter

The Omen opens with Act 2 (`act2Open`, `meta/collection.ts:33`), so R6
holds: Act 1 has no daily clock. When the player first returns to the hub
after the Blight's ceremony, a new **Omen** button sits beside Tactics and
Pacts in `.hub-actions` (`ui/hub/hub.ts:128`). It has a small dot while
today's scored try is still free. It never shows a toast, a badge count, a
timer or a "come back tomorrow" message.

Tapping it opens the Omen view, which is a hub view like Pacts (`HubView`,
`ui/hub/hub.ts:25`). The first visit shows the explainer
(`content/explainers.ts`, id `omen`, view `omen`):

> **The Daily Omen.** Each day brings one Omen: a run that everyone
> playing on that date faces too. Same place, same rules, same waves, and
> the same tower, whatever you have built.
>
> Your first try of the day is the one that counts. After it, practise as
> much as you like.
>
> Copy your result to send to a friend. Paste theirs to compare, or to
> play their day.

### The Omen view on a phone (375–430 px)

One column, 16 px gutters, every control ≥ 44 px (`tests/touch-targets.test.ts`):

```
 The Daily Omen                       ?
 Sat 14 Nov
 ┌──────────────────────────────────┐
 │ [icon] Ember Rift                │
 │ Stormcaller · starts Chain Light.│
 │ Pool  ⚡ ❄ ✸ ☼ ⟲   (5 icons)      │
 │ ▲ Blizzard is lit.               │
 │ ◆ Two weapon slots at most.      │
 │ ▼ Hordes II · Vigour I           │
 └──────────────────────────────────┘
  Not played yet. Your first try counts.
 [        Begin the Omen          ]   (primary, full width)
  Yesterday · Glass Wastes · wave 29 ●●○   [Copy]
  ─ Last 7 days ─  27 · 31 · — · 24 · 30 · 29 · today
 [ Paste a friend's result ]
```

- A long-press on a modifier line, a pool icon or the region shows the
  usual detail (R4: the line is ≤ 15 words, the rest behind the press).
- After the scored try, the card shows **Wave 31 · 1,204 slain** and the
  band dots (●●● for band III), with **Copy result** and **Practise**.
- If yesterday's Omen was never played, it shows **Play yesterday's** (the
  grace day, §4.2). Older days don't show.
- The 7-day strip is the player's own history (the outline's Open
  question about a personal leaderboard): the wave for each day, "—" for
  a day not played. A missed day looks exactly like a day off. It is not
  red, struck through or counted.

### The run

It starts like a Trial: a toast names the day (`App#startRun` already
toasts a Trial, `app/App.ts:398-399`). The HUD shows a small "Omen" tag
and, in practice, "Practice". Nothing else in the HUD changes.

### Results

The results screen (`ui/results.ts`) gets an Omen block in place of the
shards row:

```
 Omen · Sat 14 Nov · Ember Rift
 Wave 31 · 1,204 slain        ●●●
 +8 ✦ Starlight
 This is today's score.
 [ Copy result ]        [ Done ]
```

In practice it reads "Practice · today's score stays wave 29", with the
practice best below, and pays nothing. Auto-restart never follows an Omen
(`app/App.ts:666` gains `&& !run.omen`), and Done returns to the Omen view.

### Comparing

**Paste a friend's result** takes the whole message. The app finds the
code inside it, checks it, and shows:

```
 Sat 14 Nov · Ember Rift
 Theirs  wave 29 · 1,050 slain   resumed 0×
 Yours   wave 31 · 1,204 slain
 You held two waves longer.
 [ Play this day ]   (only if you haven't, and it's today or yesterday)
```

A code from an older date offers **Play as practice** instead. A code from
another game version (§4.6) says "Made with a different version of the
game: the runs may differ." It still compares the numbers.

### What is active-only

The whole Omen. It needs a tap to start, and the screen stays on. Neither
Frontier March nor auto-restart starts it, and the idle bot never plays
it (I9). Inside the run the Autocaster and draft timeouts work as usual,
so a hands-off Omen is possible, but it scores lower (§9 checks that gap).

## 3. Why these choices

- **Profile-free.** Comparison is the point, so a player who just reached
  Act 2 and one with every star lit must get the same run. The cost is
  that the player's own progress doesn't help, which is why the Omen pays
  only a little and only in Act 2's currency.
- **A region run, not the Abyss.** A region run reaches its boss in about
  3.5 minutes and falls in overtime in about 6–7. One look:
  `npm run inspect -- --seed 3 --forge all --region 4` fell at wave 29 after
  385 s, boss down in 21.6 s. Adding modifiers and pacts puts the target of
  8–15 minutes in reach. The Abyss's floors are ten waves each and grow
  without a cap, which is too long for a daily run.
- **The overtime wall makes scores close.** HP grows ×1.25 a wave past 20,
  so most players on a day will fall within a few waves of each other.
  Kills break ties. Close scores are what make comparing interesting.

## 4. The mechanic

### 4.1 The day

- **Day number.** `omenDay(now)` reads the device's *local* calendar date
  (`getFullYear/getMonth/getDate`, never `toISOString`, which is UTC) and
  returns `Date.UTC(y, m, d) / 86_400_000`, a whole number. The label
  "Sat 14 Nov" is built from fixed English tables, never `toLocale*`, so a
  line reads the same on every device.
- **Seed.** `const day = new Rng(hashString(`omen/${n}`))` (`core/rng.ts:22`,
  `:46`). The day's rules come from `day.split('rules')`, and the run's
  seed is `day.split('run').nextU32()`. They are separate streams, so
  changing the modifier table never moves the waves.
- **Region and frame.** Each comes from its own six-day cycle: block
  `⌊n / 6⌋` seeds a shuffle of the six regions, and another of the six
  frames, so every region and every frame comes once in six days. If the
  last day of one block repeats the first of the next, the next block's
  first two entries are swapped.
- **Pool.** `BALANCE.omen.pool` weapons (5): the frame's starting weapon
  and four drawn from the other eleven, Act 2's four included (a Trial's
  weapons are offered "unlocked or not", `meta/runConfig.ts:107`). The
  passives are every passive the normal rule admits for that pool
  (`runConfig.ts:115-118`), with the starred ones included.
- **Modifiers.** One **boon**, one **twist**, then **banes** (pacts as
  omens) until the day's points fall in `BALANCE.omen.points` (§4.3).
- **Validity.** A roll is redrawn (from the same stream, up to 8 times,
  then dropping the twist) when:
  - no pool weapon `counters` a type in the region's opening, or every one
    is `weakAgainst` one (the test `twinSpares` makes, `sim/run.ts:39-45`);
  - a boon or twist clashes with another (`clashes`), e.g. Lone Light with
    a fusion boon;
  - a fusion boon's two weapons aren't in the pool. They are forced in
    first, replacing drawn ones.

### 4.2 Which days can be played

| Date | Scored try | Practice | Pays |
|---|---|---|---|
| today | the first run started, once | after the scored try | yes, once per date |
| yesterday (grace) | the same, if not played | after the scored try | yes, once per date |
| older (from a friend's code) | never | yes | never |

- **Time zones.** Each player's day is their own local date. A friend
  eight hours away plays the 14th's Omen during their own 14th. The grace
  day covers the overlap, and a code always names its date, so comparison
  goes by date, never by "today".
- **The clock moved.** Every date pays once, ever (`omen.days`). Moving the
  clock forward only brings a later day's pay forward, and that day pays
  nothing when it really comes. Moving it back is stopped by
  `omen.since`: no date before the day the Omen first opened ever pays.
  So clock games can match a daily player but never beat one.
- **No catch-up and no punishment.** A missed day is gone, costs nothing,
  and leaves no mark.

### 4.3 Points and the tower

- **The Omen tower** is the Forge bought out up to ring
  `BALANCE.omen.ring[region]`, keystones and masteries off. It is built
  from a synthetic profile, as `tools/inspect.ts:69` `veteran` does: no
  stars, relics, sets, Trial notables, Tactician lists or keystones.
  `recipes` is every evolution, so the suggestion is at its best for
  everyone. `firstDraft: null`, `relicDrops: false`, `firstKill: false`,
  `abyssRelics: []`, `arena: PHONE_OVAL`.
- **The siblings' per-profile fields are fixed too.** Each sibling adds a
  `RunConfig` field that reads the profile. The Omen sets each one the
  same for everyone:

  | Field (plan) | Built from the profile | In an Omen |
  |---|---|---|
  | `rifts` (02 §5) | `known` (the journal, which weights unseen rifts ×`unseenWeight`), `first` | `{ first: false, known: [], act2: true }`, plus `rate` on a Rift-touched day |
  | `anomalyChance` (04 §6) | `dry`, the pity counter | 0, as 04 sets for Trials and Boss Rush; 1 on a Strange Stars day |
  | `cursed`, `cursedTable` (03 §6) | relics worn and the stratum's drops | the day's lent relic or none; `cursedTable: []` |
  | `secrets` (05 §5) | `live`, `found`, `tally` | none: 05 §3 rule 7 already keeps tallies out of authored runs |
  | `rules` (new seam for 08 §4.2) | not from the profile: 08 reads its rules from the floor (`RegionDef.abyss.rules`) | the day's stratum twist, or none |

  A test builds `omenConfig(n)` beside two profiles and requires deep
  equality (§6), so a new sibling field that leaks the profile fails at
  once.
- **Points.** Each modifier has `points`: a pact rank is 1 (its heat), a
  twist 1–3, a boon −1 to −2. Banes are drawn until the sum lies in
  `BALANCE.omen.points` (start: `[6, 9]`), with no pact above rank II.
- **Starting numbers, to tune with `tools/omen.ts` (§9):**

```ts
// content/balance.ts
omen: {
  pool: 5,                     // weapons in the day's pool, the frame's included
  ring: [0, 1, 2, 3, 4, 5, 6], // Forge rings bought out, by region index (0 unused)
  points: [6, 9],              // the day's difficulty: banes + twist − boon
  maxRank: 2,                  // no pact past rank II in an Omen
  bands: [0, 5, 10],           // band I: boss felled; II, III: this many overtime waves held
  starlight: { base: 2, band: [1, 2, 3] }, // scored try only; × the Stargazers (payStarlight)
  trims: { played: 7 },        // the Augur's Veil: seven scored Omens, any days
  keep: 60,                    // days of history kept
},
```

### 4.4 Score and bands

- **Score:** the wave the run ends in (`outcome.wave`, the Map's "Best
  wave" sense), then **kills** (`run.kills`) as the tiebreak. Both are
  whole numbers and the same for every viewer.
- A retreat scores where it stops. A fall and a retreat are not told
  apart.
- **Bands:** I, boss felled (wave 20 held). II, five overtime waves held
  (wave ≥ 26). III, ten (wave ≥ 31). These follow the overtime trophies'
  precedent (`BALANCE.trophies.overtime: [5, 10, 15]`,
  `content/balance.ts:326`), which R7 already accepts as overtime
  milestones.

### 4.5 Attempts, snapshots and midnight

- **One scored try per date.** The first Omen run started for a date that
  has no score is the scored one. Starting it sets
  `profile.omen.pending = { day, practice: false }`, as `profile.trial`
  marks a Trial.
- **Practice** opens once the scored try has banked. It is unlimited,
  pays nothing, and keeps its best (`practice`) beside the score.
- **Across midnight:** the date lives in the run (`RunState.omen.day`), so
  a run started at 23:50 banks against the 14th, whatever the clock says
  when it ends, and a snapshot resumed days later still banks against its
  own date. The snapshot already carries all of `RunState`
  (`meta/save/index.ts:117-122`), so this needs no extra work.
- **A lost snapshot** (an app update bumps `SNAPSHOT_VERSION`, and
  `loadRunSnapshot` drops it, `meta/save/index.ts:134`): at boot, a
  scored `pending` with no snapshot is cleared, so the scored try is open
  again. That is rare and not worth punishing.
- **Resumes are counted.** A killed app resumes from the last snapshot,
  taken at each wave start and at card picks (`app/App.ts:59`, `:521-524`),
  so a wave could be retried by killing the app. The app logs a `resume`
  input when it resumes an Omen (§4.7), and the count travels in the code
  ("resumed 2×"). It is shown, not punished.

### 4.6 The share code

The copied line, at most about 80 characters:

```
Omen Sat 14 Nov · Ember Rift · wave 31 · 1,204 slain · 7KQ3FX-9QX2MA-0PZ4RT
```

The code is 90 bits in Crockford base32 (18 characters, no I/L/O/U, and
case doesn't matter when read back):

| Field | Bits | Note |
|---|---|---|
| format | 4 | `1` |
| rules tag | 16 | `hashString` of `BALANCE`, `OMEN_MODS` and the content tables the run reads, folded to 16 bits, plus a hand-bumped `OMEN_SIM` for sim-code changes |
| day | 16 | days since 2000-01-01 |
| wave | 10 | |
| kills | 20 | clamped |
| resumes | 3 | 7 means 7 or more |
| practice | 1 | |
| check | 20 | a keyed hash of the 70 bits above, key in the bundle, like `meta/save/seal.ts:20-21` |

The readable parts of the line are for people. Only the code is read,
found by a pattern anywhere in the pasted text.

**What can be cheated, and whether it matters:**

| Cheat | Stopped? | Why that's fine |
|---|---|---|
| Typing a better number into the line | yes: the line's numbers are ignored, and the code is checked | |
| Forging a code | no: the key ships in the bundle (the seal's own stance, `seal.ts:5-7`) | Friends, not a leaderboard. Proof codes (§4.7) can close it later |
| Retrying a wave by killing the app | no, but shown ("resumed n×") | It's visible, and honest players have nothing to show |
| Restoring a profile backup to replay the scored try | no | It takes several taps in Settings and pays at most one more day's Starlight |
| Practising tomorrow's Omen by moving the clock | no | That uses up tomorrow's scored try. It's the same as playing it early |

Nothing here reaches anyone else's game or profile, so the honour system
is enough.

### 4.7 The input log, and later the proof

- **The log (phase 2, needed for resumes):** `RunState.omen.log: number[]`,
  flat pairs `[tick, op]`. `applyInput` (`sim/run.ts:166`) appends one
  pair per input when `run.omen` is set: retreat, pick n, reroll,
  banish n, take-all, ult, resume. Siblings' inputs (Rift choices, 02)
  add ops.
- **One timing for every input.** Today the Autocaster's cast goes in
  through `step(run, dt, { ult })` (`app/App.ts:519-520`). That applies
  it *after* `tick++` (`sim/run.ts:193-195`), while every tap applies
  between steps. For an Omen, the app casts the Autocaster's ult between
  steps too, so every logged input means "after step t". A test plays a
  run live and from its log, and checks they match.
- **The proof (phase 5, optional):** **Copy proof** puts `TWP1.` + base64
  of the log (~250–400 characters) on the clipboard. Pasted, the app
  rebuilds `omenConfig(day)`, replays the log in a Web Worker with a
  progress bar, and compares wave, kills and a hash of the final state
  (as `tests/sim.test.ts:30` `stateHash` does, with `omen` left out).
  A match shows **Verified**. A mismatch shows "Couldn't verify on this
  device", never "cheat" (see Risks: float maths across engines).

### 4.8 What an Omen banks

`bankRun` (`meta/results.ts:167`) branches early on `run.omen` to
`bankOmen`, which keeps only what is harmless:

| Kept | Not kept |
|---|---|
| `records.runs++` (the snapshot guard needs it, `meta/save/index.ts:135`), lifetime kills, `killsBy`, Bestiary sightings | shards, records, trophies, the farm rate (`recordFarm`), relics, feats, recipes, fusions, the Foreman's buys, heat records, Stored Light (01) |
| `omen.days[n]`, the Starlight, a trim when one is earned | |

## 5. Content

`content/omens.ts`: `OMEN_MODS`, 18 to ship first. Text is ≤ 15 words (R4,
linted).

| Id | Slot | Text | Rules | Points |
|---|---|---|---|---|
| `blizzard-lit` | boon | Blizzard is lit: Chain Lightning and Frost Ring can fuse. | `fusion: blizzard` | −2 |
| `firestorm-lit` | boon | Firestorm is lit: Mortar and Scattershot can fuse. | `fusion: firestorm` | −2 |
| `dawnstar-lit` | boon | Dawnstar is lit: Sunlance and Arcane Bolt can fuse. | `fusion: dawnstar` | −2 |
| `sky-hive-lit` | boon | Sky Hive is lit: Glaives and Sentinel Drones can fuse. | `fusion: sky-hive` | −2 |
| `mothers-tear` | boon | Mother's Tear rides with you, at rank III. | `relic: mothers-tear, 3` | −1 |
| `phoenix` | boon | Phoenix Feather: once, rise again at half health. | `relic: phoenix-feather, 1` | −1 |
| `early-light` | boon | Start four levels higher, the drafts banked. | `level: 4` | −1 |
| `lone-light` | twist | One weapon slot. | `slots: weapon 1` | 3 |
| `two-hands` | twist | Two weapon slots at most. | `slots: weapon 2` | 2 |
| `bare-stone` | twist | No passives. | `slots: passive 0` | 3 |
| `glass` | twist | Glass Cannon is set: damage ×1.8, Max HP and regen halved. | `keystone: glass-cannon` | 1 |
| `specialist` | twist | Specialist is set: your first weapon ×2.5, all else −25%. | `keystone: specialist` | 1 |
| `fortress` | twist | Fortress is set: slower attacks, double Max HP, fiercer Thorns. | `keystone: fortress` | 1 |
| `hordes` | bane | Waves bring 30% more enemies, per rank. | `omen: hordes` | 1/rank |
| `vigour` | bane | Enemies have 25% more health, per rank. | `omen: vigour` | 1/rank |
| `haste` | bane | Enemies move 15% faster, per rank. | `omen: haste` | 1/rank |
| `elites` | bane | Each elite wave brings one more elite, per rank. | `omen: elites` | 1/rank |
| `scarcity` | bane | One fewer card in every draft. | `omen: scarcity` (rank I only) | 1 |

Frailty, Tyranny and Blight Surge join later if `tools/omen.ts` shows the
days lack variety. Hoarder is left out because the Omen pays no shards.

**Later, from the siblings** (one `OmenRule` kind each; §7 has the
details):

| Id | Slot | Text | Rules | Points | Needs |
|---|---|---|---|---|---|
| `rift-touched` | boon | Rift-touched: rifts open twice as often. | `rifts: { rate: 2 }` | −1 | 02 |
| `strange-stars` | boon | Strange stars: an anomaly will be dealt. | `anomaly: 1` | −1 | 04 |
| `lent-glass-crown` | twist | Lent: Glass Crown. Damage ×1.5; the tower never rises again. | `cursed: glass-crown` | 1 | 03 |
| `lent-hollow-bell` | twist | Lent: Hollow Bell. The ultimate charges twice as fast, strikes half as hard. | `cursed: hollow-bell` | 0 | 03 |
| `gates` | twist | Gates: waves come only through the gates. | `stratum: gates` | 2 | 08 |
| `narrowing` | twist | Narrowing: the light closes a little every wave. | `stratum: narrowing` | 2 | 08 |
| `early-bloom` | boon | Early bloom: weapons evolve at level 4. | `evolveAt: 4` | −1 | 07's hook |

**Trims (N2's kind, cosmetic, `render/painters/tower.ts:156-185`):**

- **Augur's Veil:** seven scored Omens, on any days (a lifetime count,
  never a streak).
- **Starfall:** the first band III.

Two painters and two `TrimId`s. `meta/trials.ts:60` `wonTrims` widens to
include them.

## 6. Data and code

| Layer | File | Change |
|---|---|---|
| content | `content/types.ts` | `OmenRule = TrialRule \| { kind: 'keystone'; id } \| { kind: 'fusion'; id: FusionId } \| { kind: 'relic'; relic: RelicId; rank } \| { kind: 'level'; n }`; `OmenModDef { id, name, icon, slot, text, rules, points, weight, clashes? }`; two `TrimId`s |
| content | `content/omens.ts` (new) | `OMEN_MODS`, `OMEN_SIM` |
| content | `content/balance.ts` | `BALANCE.omen` (§4.3) |
| content | `content/explainers.ts` | `omen`; `ExplainerView` gains `'omen'` |
| content | `content/lint.ts` | R4 on `OmenModDef.text`; every id a rule names exists; points are whole numbers |
| sim | `sim/state.ts` | `RunConfig.omen?: { day; practice } \| null`; `RunState.omen: { day; practice; log: number[]; resumes } \| null` |
| sim | `sim/run.ts` | `createRun` copies `omen`; `applyInput` logs; `noteResume(run)` |
| meta | `meta/omen.ts` (new) | `omenDay`, `omenLabel`, `rollOmen(n)` → `OmenRoll`, `omenConfig(n, practice)`, `omenOpen`, `scoredFree(profile, n)`, `bankOmen`, `encodeResult`/`decodeResult`, `rulesTag`; later `replayOmen` |
| meta | `meta/runConfig.ts` | `trialRules(rules: readonly TrialRule[])` takes a rule list, so Trials and Omens share the one consumer (R8). `OmenRule`'s extra kinds fold in `meta/omen.ts`, ending in `never` |
| meta | `meta/profile.ts` + `meta/save/migrate.ts` | `omen: { since: 0, days: {}, played: 0, pending: null }`; the next free rung (v15 → v16 if it lands first; the siblings take rungs too) |
| meta | `meta/save/index.ts` | `SNAPSHOT_VERSION` 13 → next |
| meta | `meta/results.ts` | early `bankOmen` branch; `RunSummary.omen` |
| meta | `meta/collection.ts` | `hubUnlocks`: the Omen button with `act2Open` (R3) |
| app | `app/App.ts` | `startOmen(n, practice)` (seed and config from `meta/omen.ts`); resume calls `noteResume`; the Autocaster's ult goes between steps on an Omen; no auto-restart after one; a scored `pending` with no snapshot is cleared at boot |
| ui | `ui/hub/omen.ts` (new), `ui/hub/hub.ts` | the view, the home button and its dot, the paste sheet |
| ui | `ui/results.ts` | the Omen block, Copy result |
| render | `render/painters/tower.ts` | two trims |
| platform | `platform/files.ts` | none: `copyText` is enough. Reading the clipboard needs no permission when the player pastes into a field |
| tools | `tools/omen.ts` (new), `package.json` `omen` script; `tools/act2.ts` `--omen` | §9 |
| docs | `docs/act2.md` (an Omen section), `docs/save.md` (rung, snapshot), `docs/sim.md` (the log) | |

**Determinism.** The day's rolls come from a fresh `Rng` keyed by the
date, not from any run's stream. The run itself uses only `createRun`'s
existing streams, so no existing seed moves. `RunState.omen` is `null` on
every other run, and `tests/sim.test.ts` compares hashes run against run,
never against a stored value, so it is unaffected.

**Tests (`tests/omen.test.ts`):**
- `omenConfig(n)` is deep-equal when built beside two profiles at
  different stages, a fresh Act 2 one and a full sky.
- Over 365 consecutive days: every roll is valid; each region and each
  frame comes once per six-day block with no repeat across the seam;
  points lie in the band; no pact rank is above `maxRank`.
- `omenDay` at 23:59 and 00:00 local; under a UTC+13 and a UTC−11 time
  zone (`process.env.TZ`); on a daylight-saving change.
- Pay: once per date; nothing before `since`; a clock moved forward then
  back pays the same total as a straight run of days.
- The code round-trips, and any one-character edit fails the check.
- Replaying a run from its log gives the same wave, kills and state hash,
  resume included.
- A snapshot taken on the 14th and resumed on the 16th banks against the
  14th.
- `bankOmen` leaves shards, records, `farm` and relics untouched.
- The `save.test.ts` fixture for the new rung.

## 7. Interactions with the sibling plans

- **01 Stored Light:** 01 says "an Omen run burns like any run". That holds:
  01's burn is `min(pool, runShards × (mult − 1))`, and an Omen banks no
  shards (§4.8), so it burns nothing. Its Starlight is never boosted.
- **02 Rifts:** once 02 is built, every Omen has rifts at Act 2 rates,
  with the profile-free `RunConfig.rifts` from §4.3. A **Rift-touched**
  boon sets `rate` (02 §6's "×2 chance, gap 2"). Rift choices are inputs,
  so they go in the log. Rifts whose pay leaves the run (`starlight`,
  `cursed`, `echo`: Star-Tear, Deep Current, Cursed Gift, Hollow Echo)
  never roll in an Omen. Its `where` filter gains `omen: false` for them.
  Nothing goes in the rift journal, because the Omen is sealed (§4.8).
- **03 Cursed relics:** 03 §7 has "the Omen lends one cursed relic for
  the day's run, owned or not". That is a **Lent** twist, `cursed: id`,
  that wears the relic for the day with its boon and its curse. First,
  only relics that need no particular weapon: Glass Crown, Hollow Bell,
  Blunt Idol, Gnawing Crown and Starving Lamp. Nothing drops in an Omen
  (`cursedTable: []`), and Rootheart, the Hunger's relic, is never lent.
- **04 Anomaly cards:** 04 §7's **Strange Stars** boon ("every run deals
  an anomaly") sets `anomalyChance` to 1. On other days it is 0, as 04
  sets for Trials and Boss Rush. An anomaly taken in an Omen isn't
  marked found by default (Open 7), so 04's discovery isn't bypassed.
- **05 Secrets:** 05 §3 rule 7 keeps tallies out of authored runs, and
  `RunConfig.secrets` is per profile, so an Omen runs none. This differs
  from 05 §6's line "a fixed loadout may make a pair likelier": no
  secret can be found in an Omen. If 05 wants that, the find would have
  to be kept outside the comparable run, which this plan advises against.
- **07 Final Form:** works as usual. 07 §6 suggests an omen "evolutions
  need level 4". That becomes a later twist, **Early Bloom**, once 07 or 08
  adds the evolve-level hook. One code bit can add "✦ Final Form" to the
  line (format 2).
- **08 Abyss strata:** 08 §7 offers **Gates** and **Narrowing** as twists:
  they need no natives, so they spoil nothing. Inversion and Lightless can
  follow once built. This needs one seam: 08's `ruleLoad(run)` reads a
  rule from `RunConfig.rules` as well as from the floor. Gate angles come
  from the day's `rules` stream. Stratum bosses, the Hunger (the floor-30
  finale) included, never appear.
- **10 Contracts:** 10 §7 says "an Omen run is never a contract run", and
  this plan agrees: no contract points at the Omen or counts one. 10 may
  later borrow `OMEN_MODS` as modifier rows. Each row's text is already
  ≤ 15 words.

## 8. Build steps

| # | Step | Size | Ships |
|---|---|---|---|
| 1 | `content/omens.ts`, `BALANCE.omen`, `meta/omen.ts` rolls and `omenConfig`; the `trialRules` refactor; lint; the 365-day and profile-free tests; `tools/omen.ts`. No UI | M | a measured, tunable day, nothing visible |
| 2 | The run: `RunConfig`/`RunState.omen`, the log, `bankOmen`, profile field and rung, snapshot bump, `App#startOmen`, the Omen view and home button, the results block, the explainer, Starlight pay | M | the Omen, playable, scored, paid |
| 3 | Sharing: the code, Copy result, Paste a friend's result, Play this day or as practice | S | comparing with friends |
| 4 | Trims (two painters), the 7-day strip | S | the long tail |
| 5 | Proof codes and the replay worker | M | verified scores, if friends actually share |
| 6+ | Sibling modifiers as 02, 03, 04, 07 and 08 land (§5's later table), each with its profile-free `RunConfig` default (§4.3) | S each | variety |

Plan D's order still holds: build this last, after 02–08 exist, because
the day's variety comes mostly from their content.

## 9. Checks

| Check | Reading | Target | Touches |
|---|---|---|---|
| `npm test` | §6's tests | pass | determinism |
| `npm run omen -- --days 28` (new) | per day: region, frame, points; the active bot's fall wave and minutes; the hands-off policy's (Autocaster plus suggestion on timeout) | median run 8–15 min; active median fall wave 26–34; band III on ≤ 25% of days; no day where the active bot falls before wave 15 | the Omen's tuning |
| the same | active minus hands-off, median fall wave on the same day | ≥ 2 waves (skill shows in the score) | the point of comparing |
| `npm run pacing -- --act2 --hours 12 --seeds 4` with `act2.ts --omen` (one Omen per simulated day of the bot's clock) | Omen Starlight per screen-minute against the bot's | 0.5–1.0× the bot's Starlight per minute in its first 10 Act 2 hours | worth opening, not the best grind |
| the same | 30 days of band III Omens, against `STAR_WEB`'s total price (736 per B7, `plans/post-rebuild-improvements.md:209`) | ≤ ⅓ of the sky | R2 budget, Act 2 pacing |
| `npm run pacing -- --hours 12 --seeds 8 --fast` and `--idle --hours 12 --seeds 4` | I1–I6, I8 medians | unchanged (no Act 1 path changes) | R6, I8 |
| `tools/idle.ts` | I9 | the idle bot never starts an Omen or banks Omen Starlight | I9 |
| `npm run arsenal`, `npm run calibrate` | | unchanged: Omen pools never feed I4's picks | I4 |
| on a phone at 375×812 | the view, results and paste sheet with no horizontal scroll; Copy works in the APK | | D4 |

## 10. Risks

- **Float maths across engines.** `Math.sin`, `cos`, `pow` and `exp` are
  not required to round the same on every JavaScript engine. The spawn
  *lists* are integer RNG work and will match, but a whole run may drift
  between V8 (the Android WebView, Chrome) and JavaScriptCore or
  SpiderMonkey. Scores still compare fairly (same lists, same rules).
  Replay proofs (phase 5) are only promised V8 to V8, and a mismatch is
  reported as "couldn't verify".
- **Versions split friends.** Any balance or content change reshapes the
  day. The rules tag shows the mismatch, but players on different builds
  can't really compare. `OMEN_SIM` must be bumped by hand for sim-code
  changes, and that is easy to forget. A test that hashes `src/sim/**` at
  build time would catch it, at the cost of churn.
- **Seed over skill.** If the active bot and the hands-off policy land
  within a wave of each other, scores are mostly the day's luck. The §9
  gap check guards this, and Rifts and anomalies (02, 04) add decisions.
- **Obligation despite no streaks.** The home button's dot is the only
  nudge. If it still feels like a chore in play, drop the dot.
- **A phone oval on a wide screen.** Fixing `PHONE_OVAL` letterboxes the
  light on tablets and desktop. The renderer already copes with a resize
  mid-run (the oval is kept in the run, `content/arena.ts:7-9`), but
  check it on a landscape tablet.
- **Rule-list refactor.** `trialRules` takes a list instead of a
  `TrialDef`. It has one caller (`meta/runConfig.ts:36`), but every Trial
  test must stay green.

## 11. Open decisions

1. **Local date or UTC?** Default: **local**, with yesterday as a grace
   day. UTC would put the change at mid-afternoon for some players.
2. **The Omen tower: fixed Forge rings by region, or the player's own
   tower?** Default: **fixed** (`BALANCE.omen.ring`). The player's own
   tower makes scores incomparable.
3. **Practice before the scored try?** Default: **no**, so the first try
   means something.
4. **Android share sheet (`@capacitor/share`, `ACTION_SEND`, no network)?**
   Default: **copy only** at first. Add the share sheet if players ask
   for it.
5. **Proof codes and replay (phase 5)?** Default: **later**, only if
   friends share at all.
6. **Streak rewards?** Default: **none**. Lifetime counts only (Augur's
   Veil at 7) and the first band III.
7. **Do Omen finds count (recipes, fusions, anomalies from 04, rift
   journal entries from 02)?** Default: **no**. The Omen is a sealed
   room, and only Bestiary sightings and kills carry over. A Strange
   Stars day then shows an anomaly without marking it found. If the owner
   prefers, mark it "glimpsed" (04's softer state) and keep "found" for
   ordinary runs.
8. **A weekly Omen (from d's Open)?** Default: **no**. Daily is enough,
   and a second clock doubles the nudge.
9. **A personal leaderboard (from d's Open)?** Default: **the 7-day strip
   and the best wave per region**, from the 60 days kept.
10. **Score tiebreak: kills, or time held?** Default: **kills**. Time
    mixes a fast clear with a slow fall and can be read either way.
