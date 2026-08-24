# Tower Cores

**Files:** `src/data/cores.ts`, `src/systems/CoreManager.ts`,
`src/stats/contributors/core.ts`, `src/ui/CorePickerModal.ts`,
`src/ui/PrestigePanel.ts`, `src/systems/PrestigeManager.ts`, `src/game/Game.ts`

Gameplay plan §6. A core is the run's **identity**, chosen before the first
blessing lands: it changes what the tower's shots do, and it biases the draft
toward the cards that build on it.

## Why

Blessings (Part 1) made two runs at the same power level diverge. Cores decide
what they diverge *from*. Without one, a run's character is whatever the first
few drafts happened to offer — the player discovers their build rather than
choosing it. A core is the decision that comes first, so "this is a frost run"
is a plan on wave 1 instead of an accident on wave 15.

## The five

| Core | Unlock | Stats | Shot behavior |
|---|---:|---|---|
| `marksman` | default | +6% crit chance, +20% range | Ordinary single shots |
| `artillery` | 5 AP | +65% damage, −40% fire rate | Every shot bursts for 70 px at 50% |
| `frostwork` | 10 AP | +30% fire rate, −18% damage | Hits chill (−25% speed, 2 s); Frost Nova ×2 duration |
| `bloodforge` | 15 AP | +60% max HP, +8% lifesteal, −20% gold | Kills heal 1% max HP; below 50% HP, +40% fire rate |
| `arcane` | 25 AP | −18% damage, +100% mana regen, +50% ability damage | Every 5th shot spends 3 mana and lands as magic at 250% |

Every number lives in `CORES` / `CORE_TUNING` in `src/data/cores.ts`. Nothing
else in the codebase holds a copy — `sim/model.ts` reads the same table, which
is what makes the balance section below a measurement rather than a claim.

## Two closed unions

`CoreId` is switched **exhaustively** in `stats/contributors/core.ts` with a
`never` default: adding a core without deciding what it does to the tower does
not compile. `CoreBehavior` is keyed exhaustively by `CORE_BEHAVIOR_CONSUMERS`,
so a behavior nothing reads is a type error rather than a picker card that
quietly does nothing. Same mechanism as `BlessingStat` / `BlessingBehavior`;
see [stat-pipeline.md](stat-pipeline.md).

| Behavior | Read by |
|---|---|
| `splash_shots` | `CoreManager.planShot` → `ProjectileManager.applyBlastSplash` |
| `chill_shots` | `ProjectileManager` (on hit) → `EnemyManager.applyChill` |
| `nova_extended` | `AbilityManager.getEffectiveDuration` (effect type `slow`) |
| `kill_heal` | `Game`'s `enemy_killed` handler |
| `desperate_tempo` | `stats/contributors/core` (reads `ctx.hpFraction`) |
| `mana_shot` | `CoreManager.planShot` → `ResourceManager.spendMana` |

## Three lifetimes, one block

`CoreManager` owns three pieces of state, and they do **not** expire together:

| Field | Lifetime | Why |
|---|---|---|
| `unlocked` | permanent | bought with AP; an ascension must not un-buy it |
| `preferred` | permanent | the core the player keeps choosing |
| `selected` | **run** | §6.2 — the selection is what resets, not the unlock |

`preferred` is the field the plan does not mention and the design needs.
"The selection resets with the run" and "an auto-ascending idle game silently
reverts to `marksman` every run" are the same sentence unless something
remembers the choice. `resetRun()` restores the *preference*; the picker is what
changes it. So an unattended run keeps the identity the player picked, and an
attended one gets asked again.

`resetAll()` — a full wipe — drops back to a single default core, because that
path also takes the AP away.

## The shot plan

`CoreManager.planShot(spendMana)` advances the proc cadence and returns what
the next shot does: damage multiplier, damage type override, splash radius and
fraction, and the mana actually spent. `Game.simulate` calls it once per volley,
inside the fixed substep.

It lives on the manager rather than inline in `Game.simulate` because the
cadence is *state* — a counter — and state inside the shot block is state that
cannot be tested at `dt = 1/120` and at 6.5× speed without a canvas.

Two rules the plan is emphatic about, both enforced here:

- **The arcane proc degrades, never stalls.** Out of mana the shot still fires,
  as an ordinary one (cross-cutting rule 1: every verb that costs a resource has
  a fallback that pays less).
- **Artillery's blast and the Mortar blessing's are one channel.** When both
  apply, the bigger blast wins rather than the two stacking — two splash
  payloads on one impact is one impact's worth of splash charged twice, which is
  not what either promises.

### Throughput, not shots

Every core's payload is priced against the tower's **throughput**, never against
one of its shots. This is the lesson the charged shot cost a full re-tune to
learn (see the follow-up at the end of `plans/gameplay-improvements.md`): a
bonus denominated in one shot is worth `1/fireRate` of the tower's output, so it
shrinks against every fire-rate purchase the player will ever make.

- `artillery` trades fire rate for damage at close to break-even
  (`0.6 × 1.65 = 0.99`); the splash is where its worth actually is.
- `arcane`'s proc is a **share** of shots (every 5th), which is
  throughput-proportional by construction and survives a fire-rate purchase
  intact.

§6.1's own numbers failed this test in both directions and were re-tuned; the
deltas and the reasons are recorded in-line in `src/data/cores.ts`.

## HP-gated stats

`bloodforge`'s tempo step reads `StatContext.hpFraction`, the same shape the
`last_stand` blessing and the `hp_threshold_damage` evolution have. Until Part 6
nothing recomputed when HP moved, so all three armed at the *next* resolve for
some other reason — a purchase, a buff edge, a wave clear. For a comeback
mechanic that is the wrong moment by definition.

`Game.refreshHpThresholdStats` now buckets `hpFraction` against
`HP_STAT_THRESHOLDS` and resolves only on a crossing, so a tower sitting at 29%
HP costs zero resolves and an actual crossing costs one. It fixed all three
effects at once.

## Unlocking

Cores are an AP **spend**, not an AP perk: no levels, no prerequisites, no
exclusivity. `PrestigeManager.canUnlockCore` / `spendOnCore` own the debit
(they take `alreadyUnlocked` as an argument rather than reaching for
`CoreManager`, so the AP balance and the ownership record stay in the class that
owns each). Threading a one-shot purchase through `AP_PERKS` would have meant
every consumer of that table learning about a perk with no effect value.

Buy them from the **Prestige** tab, which is also the only place that sells
them: the picker never shows a locked core, so a core the player cannot yet be
is not one of the choices a run can be. Unlocking is also the only thing the
tab's core rows do — the active core changes at the start of a run, never from
the panel, so an unlocked row shows its status and no button.

## The picker

`CorePickerModal`, opened from the **run summary's CTA** (which reads
"Choose your core" when one is due). The debrief is the one moment the player is
already thinking about the run that just ended, which is the only information a
core choice can be made with.

Two gates, both in `CoreManager.isPickerAvailable`:

1. **At least one ascension.** Before that, a new player has no information to
   choose with, so they are not asked. They are on `marksman` and the picker
   never appears.
2. **More than one core owned.** One core is not a choice.

The picker lists **unlocked cores only** — the second gate guarantees at least
two — no matter how much AP is on hand. It is a choice between what the run can
*be*, and a core that is not owned is not one of those choices; the AP a player
saves for a locked core is their reason to open the Prestige tab, not a card
here.

It is also the run's only moment of choice: the active core changes on a run
restart, never mid-run. The Prestige panel shows unlock buttons and nothing
else, so there is no "run this core" button anywhere that is not the picker.

The countdown is never off, for the same reason the blessing draft's is not:
an auto-ascending idle game reaches this modal several times an hour with nobody
in front of it. It runs on the **wall clock** (45 s) — a game-time deadline would
be seven real seconds at 6.5× speed — and timing out keeps the current
selection, which `resetRun` has already set to the player's preference. A hidden
tab resolves it immediately, same as the draft.

## Blessing preference

`BlessingDef.corePreference` weights the draft at **1.5×**
(`CORE_PREFERENCE_WEIGHT`), applied in `BlessingManager.offerWeight`. It
multiplies, it never filters: every eligible card keeps a real draw chance on
every core, because cross-core builds are most of what makes a second run of the
same core interesting. `tests/cores.test.ts` sweeps the whole weight range and
asserts no card is unreachable on any core.

Measured in-browser against the live pool: Frostbite is drawn in 9.5% of offers
on `marksman` and 12.0% on `frostwork`; Mortar Round 10.8% on `marksman` and
13.5% on `artillery`; Frostbite is still 10.6% on `artillery`.

Every core has at least one card that likes it — a core the pool ignored would
draft identically to `marksman`, which the tests also assert.

## Balance (plan §6.4)

§6.4 requires each core to land within **±15%** of `marksman`'s wall wave.
`npm run sim` prints two tables, because the wall quantises to boss waves
(steps of 10 on a base of ~40, a resolution of 25%) and a ±15% band cannot be
*steered* by a metric that coarse.

**Idle, no blessings — the drift check.** Every core, every tier:

| Core | 0 | 100 | 1 K | 10 K | 100 K | worst Δ |
|---|---:|---:|---:|---:|---:|---:|
| Marksman | 39 | 59 | 89 | 129 | 169 | +0.0% |
| Artillery | 39 | 59 | 89 | 129 | 169 | +0.0% |
| Frostwork | 39 | 59 | 89 | 129 | 169 | +0.0% |
| Bloodforge | 39 | 59 | 89 | 129 | 169 | +0.0% |
| Arcane | 39 | 59 | 89 | 129 | 169 | +0.0% |

Those are the same five numbers Parts 2–5 held. **Idle wall-wave drift is zero
for every core** — a core changes what a run *does*, not how hard the game is.

**With the draft running — where ±15% is decided.** Averaged over seven draft
seeds, so it has real resolution:

| Core | 0 | 100 | 1 K | 10 K | 100 K | worst Δ |
|---|---:|---:|---:|---:|---:|---:|
| Marksman | 54.7 | 74.7 | 107.6 | 149.0 | 189.0 | +0.0% |
| Artillery | 54.7 | 73.3 | 106.1 | 149.0 | 189.0 | −1.9% |
| Frostwork | 54.7 | 73.3 | 106.1 | 146.1 | 186.1 | −1.9% |
| Bloodforge | 53.3 | 70.4 | 106.1 | 147.6 | 187.6 | −5.7% |
| Arcane | 54.7 | 73.3 | 104.7 | 147.6 | 184.7 | −2.7% |

Worst deviation −5.7%, comfortably inside the band.

### What the model can and cannot see

`sim/model.ts` reads the **stat blocks straight from `CORE_BY_ID`**, so a
re-tune in `src/data/cores.ts` is measured rather than guessed. `CORE_MODEL`
covers only the channels the model genuinely has no simulation for, and it is a
`Record` over `CoreId` for the same reason `BEHAVIOR_DPS_CREDIT` is one: a core
the model silently scores at zero is a core whose balance was never checked.

Three pieces are worth knowing about:

- **`coreSurvivalMult`** is *derived* from the stat block, not hand-set. The
  wall condition is literally "seconds survived once a wave overruns", so a core
  that raises effective HP raises exactly that. A per-core constant would have
  meant re-tuning `bloodforge`'s `maxHpPct` moved nothing in the table meant to
  be measuring the re-tune.
- **`arcane`'s proc share is mana-limited**, not assumed. The drain is
  `fireRate / 5 × 3` and the regen is not, so the model computes uptime from
  the Meditation the greedy buyer actually decided to buy. Given an unbounded
  budget it buys exactly level 4 — precisely full uptime — which is what makes
  mana economy a real trade the core has to pay for.
- **`bloodforge` is deliberately the outlier in the DPS column** (−15% to −21%
  of `marksman`'s composed DPS). Everything it buys is survivability, which a
  DPS column cannot see; the wall table above is where it is priced, and there
  it is level with the rest. `desperate_tempo` is credited at **zero** in the
  model — the model has no tower HP, and zero is the reading that does not
  flatter the core.

### Known effects on other tables

- **§2.2b (wall with blessings) moved up 1.4–3.0 waves** at every tier, because
  `corePreference` is live now and `marksman` favours four cards it did not
  before. This is the mechanic working, not drift.
- **§4.5 idle parity moved**, entirely because of `marksman`'s +6% crit changing
  which upgrades the greedy buyer crosses first. Still inside the +50% hard gate
  at all five tiers; one tier (10 K) now sits at +19.0%, below the preferred
  +25–40% band. That is the safe direction, and Part 5 already recorded this
  metric as stepwise and non-monotonic.

## Persistence

Save **v13**. `GameState.cores` is `{ unlocked, preferred, selected }`.
`migrateV12toV13` seeds the default block: a pre-v13 save is a run on
`marksman` that has never been offered a choice, which is exactly what every
pre-v13 tower was actually shooting like. Nothing is transformed and nothing is
dropped. See [save-system.md](save-system.md).

`CoreManager.restore` refuses ids it does not recognise and refuses to select a
core the player does not own, so a hand-edited or truncated save loads as the
default rather than as an unpayable grant.

## Testing

`tests/cores.test.ts` (47 cases) pins: each stat block's resolved values as
literals, the exhaustive behavior→consumer map, artillery's blast hitting every
enemy inside it and none outside (and paying a *fraction* of the landed hit),
arcane procing on exactly every 5th shot / spending mana / landing as magic /
degrading to an ordinary shot when the pool is empty, frostwork chilling through
the per-enemy chill map (and *not* through a global slow), the extended nova
being keyed on effect type, bloodforge's tempo step firing at the threshold and
not above it, AP gating on both the affordability and already-owned paths, the
picker's two gates, the run-scoped reset restoring the preference, snapshot /
restore including a corrupt block, a full `SaveManager` round trip, and
`corePreference` biasing the draft without ever making a card unreachable.
