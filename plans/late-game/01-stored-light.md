# 01. Stored Light

**Status:** 2026-11-14. Plan, not built. Supersedes all of
[a-stored-light.md](a-stored-light.md), including its I5 rewrite: I7–I9
are defined here (§9.1) and the sibling plans use these definitions.

**In one line:** from Night Watch III on, most of a night away is stored
as a charge that only live runs burn at a high rate, so coming back sets
up a boosted session instead of handing over a bigger number.

---

## 1. The problem

`meta/offline.ts:45-52` pays `farmRate × minutes away × efficiency`
straight into `profile.shards` (`App.ts:294`). The tiers are
`BALANCE.offline.tiers` (`content/balance.ts:462-467`): 15% for 2 h,
15% for 4 h, 20% for 8 h, 25% for 12 h. In minutes of farm time per
12-hour night that is 18, 36, 96 and 180. A check-in session is 20
minutes (`tools/idle.ts:39`).

| Night Watch | Seal (`content/forge.ts`) | Night pays (farm min) | ÷ one 20-min session |
|---|---|---|---|
| I | Gatekeeper (`:333`) | 18 | 0.9 |
| II | Gatekeeper (`:353`) | 36 | 1.8 |
| III | Prism (`:389`) | 96 | 4.8 |
| IV | Forgeheart (`:394`) | 180 | 9.0 |

From tier III the night outweighs the session, and from IV it is nine
times bigger. Measured on 2026-11-02 with the real sim: the hands-off bot
reaches the Blight with ~3.5 h of screen time (5.0–5.5 days of two
20-minute check-ins); the always-on active bot takes ~5.2 h. Active play
earns only 1.18–1.39× idle per run hour from Region 2 on, and I5 locks
that in at 1.15–1.5.

Cutting the rate was tried (60% → 15–25%, `docs/idle.md`, Offline). It
slows idle and active alike. The fix is to change **what the night pays
for**, not how much.

**A bug found on the way.** The Night Watch node texts still quote the
old rates: 25%, 25%, 40% and 60% (`content/forge.ts:333,353,389,394`),
while `BALANCE` pays 15/15/20/25. §4 rewrites all four.

**What the outline got wrong.** It said option b (×3 live, ×1.25
hands-off) lets "idle players still collect it all, only more slowly".
At those rates they don't: a hands-off 20-minute session burns 5 farm
minutes against 126 stored per night, so the pool grows without end.
That is not a flaw to hide. Stored Light only moves screen-on against
screen-off if hands-off play realises less of it. §3.6 sets the rates
on purpose with that in mind, and I8 (§9.1) is the guard.

## 2. What the player sees

**First meeting.** The player buys Night Watch III (ring 4, after the
Prism). The next time they come back, the welcome-back card has a
second number:

> You were away 9 h 12 min. The tower gathered 2,100 shards, and
> stored 11,800 as Stored Light. Play to spend it: ×5 while you play,
> ×2 left alone.

Buttons: **Play** (primary: starts a run at the frontier) and **Forge**
when something became affordable, as today (`App.ts:316-319`).

**How it is taught.** A new explainer, `stored`, on the hub's home view
(`content/explainers.ts`), opening once `profile.storedLight > 0`:

- "From Night Watch III, most of a night away is stored as Stored
  Light instead of paid at once."
- "While you play, every shard a run earns is matched from the store,
  several times over. Left to play itself, a run spends it slowly."
- "Any touch in the last 30 seconds counts as playing. Stored Light
  never fades and never runs out on its own."

**In a run (375–430 px).** The HUD's meta row (`ui/hud.ts:71-74`) keeps
the region on the left and the shards on the right. Two things are
added, both hidden until the pool is above zero:

- a chip before the shard count: **×5** lit while the current wave
  counts as played, dimmed to **×2** while it doesn't;
- a 3 px gauge under the meta row, the full width of the top block,
  draining as the run's bonus is reserved against the pool.

The chip is 3 characters, so the row doesn't reflow at 375 px. Colour
is a new `--stored` token (warm amber), so `tests/palette.test.ts` stays
green. When the pool runs dry mid-run, one toast: "Stored Light spent".

**Results.** Under the shards (`ui/results.ts:281`) a line:
"Stored Light +18,200 · ×8 played · 4,100 left". The shard breakdown
(`:282-288`) gains a "Stored" part.

**Hub home.** The stats list (`ui/hub/hub.ts:123`) gains "Stored
Light", hidden at 0.

**Active-only.** The engaged rate (×5 / ×8) is the active-only part.
The hands-off rate is idle's by design and is not.

## 3. The mechanic

### 3.1 The split

Each Night Watch tier has an **instant** part (paid as today) and, from
tier III, a **stored** part. Both are worked out from the same farm rate
and the same time away, each with its own efficiency and cap (the
tier's own `efficiency` and `capHours` stay the instant part):

```
instant = floor(farmRate × min(away, tier.capHours) × tier.efficiency)
stored  = floor(farmRate × min(away, stored.capHours)  × stored.efficiency)
```

The instant part is frozen at tier II's 15% up to 4 h. Buying III or IV
never shrinks the welcome-back's first number; it only adds a store.

### 3.2 The burn

While a run is played, the app tallies the run's **base** shards into two
buckets per wave (§3.3): `engaged` and `handsOff`. At `bankRun` the bonus
is:

```
want  = engaged × (rates.engaged − 1) + handsOff × (rates.handsOff − 1)
bonus = floor(min(profile.storedLight, want))
```

It is added to `profile.shards`, taken off the pool, and reported.
`rates` are the highest owned tier's with a store. With the pool above 0
but no such tier (Night Watch III refunded) tier III's rates apply. Any
run burns it: regions, Trials, the Abyss, Boss Rush. Heat raises base
shards, so it burns the pool faster, not bigger.

### 3.3 Engaged, in the app only

The sim never knows. `App` keeps `lastTouch`, the wall time of the last
`pointerdown` or `keydown` on the run screen (one capture listener in
`bindLifecycle`, `App.ts:822`). That covers draft picks, take-all,
reroll, banish, the ultimate, zoom, speed, the Autocaster switch, Resume,
and plan 02's Rift taps without listing them. Nothing the app does by
itself stamps it: the draft timer (`App.ts:457`), the Opening's
take-all (`:458`), the Autocaster (`:519`) and auto-restart.

Sampling happens where `step()` already notices a new wave
(`App.ts:522`): the wave just ended counts as **engaged** when

```
lastTouch ≥ min(waveStartWall, waveEndWall − BALANCE.offline.engagedSeconds)
```

so a touch during the wave, or in the 30 s before it ended, counts. Its
base shards (`run.shards` now minus at the wave's start) go to that
bucket. `endRun` tallies the last part-wave the same way.

### 3.4 Rules that keep it honest

- **Base shards only, everywhere else.** `recordFarm` (`results.ts:205`),
  `records.bestShards` (`:188`) and the Rich Haul feat (`runShards`,
  `content/feats.ts:52`) read the run's own shards, never the bonus.
  If they read the bonus, a burn would raise the farm rate, and that
  would raise the next night's store: a loop.
- **No decay, no pool cap.** The tier's cap limits what one absence
  stores. The pool itself never fades (no FOMO) and has no ceiling.
- **Not a currency (R2).** It can't be spent or traded. It is a
  multiplier with a fuel gauge, denominated in shards.
- **R1.** It adds a decision (play now, or leave it) and a behaviour
  on screen (the lit chip, the draining gauge).
- **R6.** Nothing waits on a clock. The night already paid; it now pays
  in a different form.
- **The Foreman.** At welcome-back it buys from the instant part only
  (`App.ts:296`). The burn lands inside `bankRun` before `foremanBuy`
  (`results.ts:275`), so played runs feed the wishlist. When the next pin
  can't be afforded but the pool covers its shortfall, the card says so:
  "The Foreman's next pin needs 4,200: Stored Light holds it."
- **Mid-run absence.** The welcome-back toast adds "+11,800 stored", and
  the HUD gauge refills at once.
- **The outline's +1 draft card is dropped.** It would need the sim
  (`RunConfig`), and a hands-off player's pool is almost never empty, so
  the idle bot would get it in every run from tier III on. That breaks
  I9's spirit. Engagement isn't known at `createRun` either.

### 3.5 Proposed `BALANCE` keys

```ts
offline: {
  tiers: [
    { efficiency: 0.15, capHours: 2, stored: null },
    { efficiency: 0.15, capHours: 4, stored: null },
    { efficiency: 0.15, capHours: 4, stored: { efficiency: 0.2, capHours: 8, engaged: 5, handsOff: 2 } },
    { efficiency: 0.15, capHours: 4, stored: { efficiency: 0.25, capHours: 12, engaged: 8, handsOff: 2.5 } },
  ],
  minSeconds: 60, minRunSeconds: 60, runs: 5,
  /** A wave counts as played after a touch this recent, in wall seconds. */
  engagedSeconds: 30,
},
```

The stored efficiency and cap are today's III and IV, so the night's full
value is unchanged on paper. Only engaged play realises all of it.

### 3.6 The model behind those numbers

Per check-in (12 h away, then a 20-minute session), in minutes of the
hands-off farm rate R. The engaged player's own rate is ~1.3R (measured
2026-11-02: 1.18–1.39), so their night is worth 1.3× too. This is a model, not a
reading; P0 (§8) replaces it with one.

| Tier | Today: hands-off · engaged | Proposed: hands-off | Proposed: engaged | Ratio |
|---|---|---|---|---|
| I–II | 38–56 · 49–73 | unchanged | unchanged | 1.3 |
| III | 116 · 151 | 36 + 20 + 20 = **76** | 47 + 26 + 104 = **177** | 2.3 |
| IV | 200 · 260 | 36 + 20 + 30 = **86** | 47 + 26 + 182 = **255** | 3.0 |

(instant + session + burn). Engaged play keeps today's income (III up
17%, IV down 2%). Hands-off loses a third at III and over half at IV.
The 2026-11-02 readings put hands-off at the bottom of I2's band
(5.0–5.5 days), so it has room to slow. The ratio lands in the README's
2–3× per screen hour.

Minutes of play to burn one full night:

| | III | IV |
|---|---|---|
| Engaged | 125 / (4 × 1.3) ≈ 24 | 234 / (7 × 1.3) ≈ 26 |
| Hands-off | 96 / 1 = 96 | 180 / 1.5 = 120 |

So the first ~25 minutes of the day are the burst. A 20-minute engaged
player leaves 20–50 farm minutes in the pool each day, to be spent on a
longer session. A hands-off player's pool grows by 60–150 per check-in
and waits for them.

**Three dials, one job each:** `stored.engaged` is the I7 dial,
`stored.handsOff` is the I8 dial, and the instant part is the
welcome-back's dial. Tune them in that order.

### 3.7 Night Watch I–IV: does the cap still apply, and before Forgeheart?

- **The caps stay.** Each one limits what one absence pays or stores.
  Tier IV's 12 h still means a 3-day absence stores one night.
- **Stored Light starts at III (Prism), not IV.** At III the night
  already pays 4.8 sessions, so the fade starts there, not at
  Forgeheart. Tiers I and II pay at most 1.8 sessions, which is not the
  problem. Regions 1–2 already teach enough (I6), and the early game is
  where most of the idle bot's days go, so touching it costs I8 the most.

## 4. Content

There is no new authored content apart from text. What ships:

| Item | Text (≤ 15 words, R4) |
|---|---|
| Night Watch | "Earn shards while away: 15% of your farm rate, up to 2 h." |
| Night Watch II | "Offline earns 15% of your farm rate, up to 4 h." |
| Night Watch III | "Nights also fill Stored Light, up to 8 h. Play spends it at ×5." |
| Night Watch IV | "Stored Light fills for up to 12 h, and play spends it at ×8." |
| Explainer `stored` | three lines, §2 |
| Toast | "Stored Light spent" |

The node texts should read their numbers from `BALANCE`, or a
content test should check them against it, so they can't go stale again
(§1's bug).

## 5. Data and code

| Layer | File | Change |
|---|---|---|
| content | `balance.ts` | §3.5's keys |
| content | `forge.ts` | four node texts |
| content | `explainers.ts` | `ExplainerId` gains `'stored'`; one entry, view `home` |
| meta | `offline.ts` | `OfflineEarnings` gains `stored: number`; `offlineEarnings` returns `{ away, paid, shards, stored }` (null only when both are 0); `storedRates(profile)` |
| meta | `storedLight.ts` (new) | `BurnTally { engaged; handsOff }`, `waveEngaged(lastTouch, start, end)`, `burnBonus(profile, tally)`: pure, tested |
| meta | `profile.ts` | `storedLight: number`, `records.storedBurned: number`; `PROFILE_VERSION` 15 → 16 |
| meta | `save/migrate.ts` | rung `15: (raw) => ({ ...raw, version: 16, storedLight: 0, records: { storedBurned: 0, ...raw.records } })` |
| meta | `save/index.ts` | `RunSnapshot.burn?: BurnTally & { waveShards; waveWall }`; `loadRunSnapshot` returns it beside the run |
| meta | `results.ts` | `bankRun(…, speed, tally?)`; burn before `foremanBuy`; `RunSummary.stored: { bonus; engagedBonus; left; rate } \| null`; `RunSummary.activeOnly` (§9.1, I9) |
| meta | `explainers.ts` | `explainerOpen('stored')`: `storedLight > 0 \|\| records.storedBurned > 0` |
| app | `App.ts` | `lastTouch` listener; the tally in `step()` and `endRun`; pass it to `bankRun`; the welcome-back text and Play button; restore the tally from a snapshot |
| ui | `hud.ts` | `setStored(left, rate, played)`: the chip and the gauge, `role="meter"` |
| ui | `results.ts`, `hub/hub.ts` | §2's line and stat |
| ui | `styles/tokens.css` | `--stored` (light and dark) |
| render | `renderer.ts`, `palette.ts` | optional: the tower's glow warms while an engaged burn runs (`FX.stored`), set by the app; never reads the profile |
| audio | `cues.ts` | a low swell on a welcome-back that stored something; a short fall when the pool runs dry |
| sim | — | **no change** |
| tools | `idle.ts`, `pacing.ts` | §6 |

**Determinism.** The sim is untouched: no new RNG stream, no
`RunConfig` field, no `RunState` field. Every existing seed replays
byte for byte, so `pacing` (active), `arsenal`, `calibrate` and `act2`
must print exactly what they print today.

**Snapshot.** The tally lives in the snapshot's envelope, not in
`RunState`, so `SNAPSHOT_VERSION` (`save/index.ts:97`) needs no bump.
The field is optional: a snapshot from before the update resumes with an
empty tally, and no run is dropped. The app snapshots at every wave
start (`App.ts:522-524`), the same boundary the tally samples at, so a
killed app resumes with a tally that matches `run.shards`.

**Lint and tests.**

- `tests/content.test.ts`: stored tiers have `engaged > handsOff ≥ 1`,
  the stored cap ≥ the instant cap, and both rise with tier. Node texts
  quote `BALANCE`.
- `tests/idle.test.ts`: the split; caps; no decay across two absences;
  `burnBonus` never exceeds the pool; a refunded III still burns at
  III's rates; the farm rate after a boosted run equals the unboosted
  one.
- `tests/storedLight.test.ts` (new): `waveEngaged` at the window's
  edges; a tally over waves with mixed touches; the timer, Opening and
  Autocaster paths never stamp `lastTouch` (driven through a stub app,
  or by checking the paths call `pick` without the stamp).
- `tests/save.test.ts`: v15 → v16; a v13 snapshot without `burn`
  resumes.
- `tests/pacing.test.ts`: the CI idle profile's I2 band, re-read.

## 6. Bots: modelling engaged and hands-off

`tools/bot.ts` doesn't change: its `active` policy already acts at once.
`tools/play.ts` doesn't change either: a bot plays a whole run under one
policy, so every base shard of an `active` run is engaged and every one
of an `idle` run is hands-off. The tally is built by the caller:

```ts
const tally = policy === 'active' ? { engaged: shards, handsOff: 0 } : { engaged: 0, handsOff: shards };
```

A run resumed from a snapshot (`idle.ts:104-107`) tallies only the
shards up to that snapshot, like the app.

`tools/idle.ts`:

- `runIdle(days, seed, bosses, mode: 'hands-off' | 'engaged' = 'hands-off')`.
  `hands-off` is today's bot. `engaged` keeps the same schedule
  (`CHECKIN_EVERY`, `SESSION`, the same chores at check-in) but plays
  with the `active` policy, and between runs it shops like the pacing
  bot (chores after every run; `ACTIVE_BETWEEN`, `idle.ts:43`).
- Offline pays through the new `offlineEarnings`: `instant` to shards
  and `stored` to the pool (`idle.ts:77-81`); `bankRun` gets the tally.
- `IdleReport` gains `screen` (session wall seconds up to each boss's
  first fall), `instant`, `stored`, `burned`, `poolAtEnd`, and
  `activeOnly` (summed `RunSummary.activeOnly`).
- `farmRate` (`idle.ts:139`) sets `p.storedLight = 0` on its copies, so
  I5 still measures run efficiency and nothing else.

`tools/pacing.ts#idleVerdict` runs both modes per seed and `idleMain`
prints I7, I8 and I9 beside I2 and I5. The always-on active bot
(`runPacing`) never leaves the app, so it never has a pool: I1b, I3 and
I6 can't move.

A third, mixed bot (engaged for the first 10 minutes, then hands-off)
would need `playRun` to switch policy mid-run. It is a reading for
later, not a gate (§11).

## 7. Interactions with the sibling plans

- [02-rifts.md](02-rifts.md): a Rift tap stamps `lastTouch`; Rift loot goes in `activeOnly` (I9).
- [03-cursed-relics.md](03-cursed-relics.md): live-only drops, in `activeOnly`; a shard curse slows the burn.
- [04-anomaly-cards.md](04-anomaly-cards.md): an anomaly taken by timer or Tactician must not count (I9).
- [05-secrets.md](05-secrets.md): a secret found by touch is active-only; no secret of its own here.
- [07-final-form.md](07-final-form.md): no interaction beyond I9.
- [08-abyss-strata.md](08-abyss-strata.md): Abyss runs burn on their shards; Starlight is not boosted (§11).
- [10-contracts.md](10-contracts.md): `records.storedBurned` is there to point at; shard targets count base shards.
- [11-daily-omen.md](11-daily-omen.md): an Omen run burns like any run; no rule of its own.

## 8. Build steps

| Phase | What | Size | Shippable because |
|---|---|---|---|
| P0 | `idle.ts` engaged mode, `screen` in the report, I7's line in `pacing --idle`. No game change | S | It gives today's I7 baseline, which this plan's model guesses at |
| P1 | `BALANCE` keys, the split, `storedLight.ts`, `bankRun`'s burn, v16, the snapshot envelope, App's `lastTouch` and tally; the welcome-back text, results line and node texts; the bots' tallies | M | A player sees the new number and where it went; nothing is unexplained |
| P2 | HUD chip and gauge, hub stat, explainer, `--stored`, the two cues, the optional glow | S | Pure presentation on P1 |
| P3 | I9's `activeOnly` contract in `RunSummary` and the report; the tuning pass on the three dials; `docs/idle.md` (Offline), `docs/balancing.md` (I7–I9), `docs/save.md` (v16) | S | Siblings can build against I9 |

The whole plan is **M**. P0 is worth doing first even if nothing else
ships, because no tool reads screen time against screen time today.

## 9. Checks

### 9.1 The invariants (shared, used by every sibling plan)

| | Rule | Measured by |
|---|---|---|
| I5 (kept as is) | active ÷ idle shards per *run hour* at the same Forge state, 1.15–1.5, Region 2 on | `idle.ts#farmRatio`, pool zeroed |
| **I7** | From a fresh profile, same seed and schedule (check-ins every 12 h, 20 min each, the same chores), the **engaged** bot (`active` policy) reaches the Blight's first fall with **≤ 0.70×** the screen time of the **hands-off** bot (`idle` policy). Screen time is session wall seconds summed to the kill. Median over 4 seeds | `npm run pacing -- --idle --hours 12 --seeds 4` |
| **I8** | The hands-off bot finishes Act 1 in 5–10 days for **every** seed (I2 holds the median; I8 holds the tail), with every late-game plan switched on. Target median 6–8 days | same command |
| **I9** | No active-only reward reaches the hands-off bot: summed over all its runs, `RunSummary.activeOnly` is empty and its Stored Light tally's `engaged` is 0 | same command, and `tests/idle.test.ts` on a short hands-off profile |

**I9's contract for every plan.** A reward that needs a player is
tagged in `RunSummary.activeOnly: { kind: ActiveOnlyKind; amount: number }[]`.
Stored Light adds `'stored-played'` (the engaged part of the bonus).
Each sibling adds its own kind to the union. Sim-side rewards come only
from inputs that the idle policy (`play.ts:131-137`) and the app's
automation paths (timer pick, Opening, Autocaster) never send; plans
that add such an input list it in one `ACTIVE_INPUTS` constant, and
`play.ts` asserts the idle branch never sets one.

Diagnostic, not a gate: shards per screen hour, engaged ÷ hands-off,
from Night Watch III on. Want 2–3 (the README's form of I7).

### 9.2 Readings

| Command | Expect | Touches |
|---|---|---|
| `npm test`, `npm run typecheck` | green | all |
| `npm run pacing -- --idle --hours 12 --seeds 4` | I7 ≤ 0.70; I8 every seed ≤ 10 d, median 6–8; I9 empty; I5 unchanged PASS; prints pool at the Blight | I2, I5, I7–I9 |
| `npm run pacing -- --hours 12 --seeds 8` | byte-identical run tables to before (no absences, no pool) | I1a, I1b, I3, I6 |
| `npm run arsenal`, `npm run calibrate` | identical (sim untouched) | I4, T2 |
| `npm run pacing -- --act2 --hours 12 --seeds 4` | identical | P8 |
| A real morning at 375×812 | the card's two numbers, the chip lit while touching, the gauge visibly draining over ~25 min | feel |

## 10. Risks

- **Hands-off feels robbed.** From III the welcome-back's first number
  stops growing. Mitigation: it never drops below tier II's; the card
  puts the stored number beside it; it never fades.
- **The 20-minute engaged player can't drain tier IV.** About 50 farm
  minutes a day stay in the pool. Fine if the gauge reads as a reserve;
  bad if it reads as debt. The I7 dial can raise `engaged` to ×9–10.
- **Tapping to stay "engaged".** One touch every 30 s keeps the rate.
  Accepted: presence is what it pays for. Accessibility: a player who
  can't touch often falls to the hands-off rate; §11 offers 60 s.
- **Inflated shard numbers.** A ×8 run looks huge. Records, the farm
  rate and feats read base shards, so nothing downstream inflates.
- **I8's tail.** One seed past 10 days. The `handsOff` dial fixes it
  without touching engaged.
- **Clock tampering.** As today: each jump stores at most one tier cap.
  **Save rungs:** this plan ships first (README order) and takes v16.
- **Act 2.** Shards buy little there (`docs/act2.md`: only masteries),
  so Stored Light matters less. The Act 2 gap is the siblings' job.

## 11. Open decisions

1. **Where it starts.** Night Watch III (Prism), IV only, or I.
   *Default: III* (§3.7).
2. **The rates.** Instant frozen at 15% / 4 h; III ×5 played / ×2 left
   alone; IV ×8 / ×2.5. *Default: these*, then tune with the three
   dials in order (§3.6).
3. **What counts as engaged.** Any touch or key on the run screen in a
   30 s window, or only listed "meaningful" inputs. *Default: any
   touch, 30 s*; 60 s if the accessibility risk shows up in play.
4. **A pool cap.** None, or N nights. *Default: none* (no decay, no FOMO).
5. **The outline's +1 draft card.** *Default: dropped* (§3.4).
6. **Starlight in Act 2.** Boost Starlight too, or shards only.
   *Default: shards only.* Starlight is paid on records, not as a farm,
   and a second pool would be a second unit (R2).
7. **The form of I7.** Screen time to the Blight ≤ 0.70×, or 2–3× shards
   per screen hour. *Default: screen time is the gate*, per screen hour
   is printed as a diagnostic.
8. **A mixed bot** (engaged 10 min, then hands-off). *Default: later,
   as a reading only.* It needs `playRun` to switch policy mid-run.
