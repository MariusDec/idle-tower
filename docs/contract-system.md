# Contracts

Three short-horizon objectives, live at all times, run-scoped
(gameplay plan §5). `src/data/contracts.ts`, `src/systems/ContractManager.ts`,
`src/ui/ContractTracker.ts`.

The gap this closes is §0.5: between wave 12 and wave 47 the game had no goal
with a horizon shorter than "ascend eventually". Achievements are lifetime and
fire perhaps twice an hour; milestones are informational. A contract completes
roughly **every two to three waves** (`npm run sim`), which is a readout the
mid-run did not have.

## The model

| | |
|---|---|
| Slots | **3**, always. A completion draws its replacement inside the same call. A fourth slot is unlocked by the Watch's `board_expansion` chapter (see [watch-system.md](watch-system.md)) — the slot count is then `Math.max(CONTRACT_SLOTS, slots())` where `slots()` is an injected dep on `ContractManager`. The sim reads the constant directly; the UI reads `game.contractSlotCount()`. |
| Pool | 28 defs in three overlapping wave bands |
| Scope | Run-scoped — cleared on ascend and on transcend, like blessings |
| Progress | Event-driven (`ContractManager.note`), never polled |
| Persistence | Live slots in full, save **v12** (`GameState.contracts`) |

### Wave bands

Tiering is `minWave` / `maxWave` per def, which is what stops a wave-8 tower
being handed "kill a wave-60 boss":

| Band | Waves | Shape |
|---|---|---|
| A | 1–24 | Small counts, retired once the player outgrows them |
| B | 12–59 | The mid-run |
| C | 40+ | Evergreen, sized for a tower that clears a wave in seconds |

Underneath the tuning sits a correctness floor, `goalAvailableFromWave(goal)` —
the earliest wave at which the goal's *subject* exists at all: a `kill_type`
enemy's `unlockWave`, or wave 10 for `cast_abilities`, `boss_under` and
`survive_mutator` (mana, the first boss and the first guaranteed mutator offer
all land there). `tests/contracts.test.ts` asserts `minWave` is never below it,
so a contract cannot ship asking for something that does not exist yet.

## Goal kinds must have a consumer

`ContractGoal` is a closed union and `CONTRACT_PROGRESS` in `ContractManager`
is a `Record` over `ContractGoal['kind']`. It is not a documentation table that
can drift — it *is* the progress implementation, so a goal kind added without a
consumer does not compile.

| Goal kind | Fed by | Emitted from |
|---|---|---|
| `kill_type` | `enemy_killed` | `Game`'s `enemy_killed` handler |
| `kill_count` | `enemy_killed` | same |
| `clear_waves` | `wave_cleared` | `Game`'s `wave_cleared` handler |
| `flawless_waves` | `wave_cleared` (`flawless`) | same — see below |
| `boss_under` | `boss_encounter` | `Game.resolveBossEncounter` |
| `collect_orbs` | `orb_collected` | `Game.payOrb` |
| `cast_abilities` | `ability_cast` | `AbilityManager`'s `onCast` |
| `reach_wave` | `wave_cleared` (`wave`) | `Game`'s `wave_cleared` handler |
| `survive_mutator` | `wave_cleared` (`mutatorActive`) | same |
| `spend_gold` | `gold_spent` | `Game`'s `upgrade_purchased` handler |

Every wave-scoped kind rides **one** `wave_cleared` event carrying `wave`,
`flawless` and `mutatorActive`, rather than four subscriptions racing for the
same tick.

Each handler returns the contract's **new progress value**, not a delta, so
`reach_wave` (monotonic, measured against an absolute wave) and `kill_count`
(accumulating) share one shape.

### Flawless is the same rule bosses use

`flawless_waves` reads a `waveFlawless` flag on `Game`, set false at the *same
site* in the `tower_damaged` handler that clears Part 3's per-encounter flag —
after the dodge → research DR → mana-shield → wall → shield → armour chain has
run. "Flawless" therefore means the same thing for a wave as for a boss: HP
came off the bar, not merely that something hit the tower. It resets on
`wave_started`. There is deliberately no second mechanism.

## Rewards

Small and frequent, per plan §5.2:

| Reward | Size | Paid by |
|---|---|---|
| `goldWaves` | 1.2–4.0 **waves of current income** | `Game`'s `contract_completed` handler, via `estimateWaveGold` |
| `rerolls` | 1 | `BlessingManager.grantRerollToken` |
| `rp` | 1–3 | `ResearchTree.addRP` |
| `apBonusPct` | +3% each, **capped at +50% for the run** | `PrestigeManager.setRunApBonus(…, 'contract')` |

The band was **0.4–1.2** through the first cut and was raised 3x. At the old
figures a completion paid under half a wave's income into an economy where the
next upgrade costs several waves of it, so the payout arrived as a toast and
changed nothing — the reward existed but did not read as one. The measured
share of a run's income moved from 1.2–4.1% to **3.9–9.1%**, and the §4.5
idle-parity gate went *down* (see [Balance](#balance)).

Gold is stored as a *ratio* rather than a flat number. §5.1's `reward.gold?:
number` cannot work: a literal figure is trivial at wave 80 and impossible at
wave 8, and §5.2 itself describes the reward as "~2 waves' income at the
current wave", which is a ratio. It resolves against `Game.estimateWaveGold` at
both display and payout time, so a contract carried across ten waves pays what
those ten waves are worth.

### The AP cap

`ContractManager.grantReward` clamps the grant against
`CONTRACT_TUNING.apBonusCap` and returns **what was actually banked**, which is
zero once the run is at the ceiling. The payer pays what the event says, not
what the def asked for, so the cap cannot be routed around by a future second
consumer. `tests/contracts.test.ts` drives a run past the ceiling and asserts
both halves: the running total stops, and further completions pay `0`.

A deep run reaches about **+24%** of the +50% ceiling (`npm run sim`), so the
cap is a real bound on a pathological run rather than something a normal run
bumps into.

### The prestige channel

`PrestigeManager` keeps one run-scoped AP channel keyed by source:

```ts
private runApBonusBySource: Record<RunApSource, number> = { boss: 0, contract: 0 };
```

`previewAP` composes it as `apForWave(wave) × (1 + achievementBonus) × (1 +
runBonus)`. It is keyed rather than a single scalar because two systems bank
into it — flawless boss encounters (§3.4) and contracts (§5.2) — each with its
own ceiling and its own persistence block. One shared number would mean a
contract restore silently erasing the boss bonus. Both are *set* from their own
saved figure on load, and summed at read.

## UI

- **Tracker** (`src/ui/ContractTracker.ts`) — three rows in the bottom-left
  corner, `name · 12 / 40` over a progress fill, with the reward on the right.
  The milestone strip sits directly above it, offset by
  `--contract-tracker-height`.
- The tracker is drawn at **full opacity**, with 11px names on a near-opaque
  row. It shipped at `opacity: 0.62` with 9–10px text over a 0.78-alpha fill,
  and the result was scenery: the one live readout in the corner that a player
  stopped registering was there. The play area behind that corner is bright
  during a wave, which is also why the row background is near-opaque rather
  than translucent — text was being lost to whatever passed under it.
- A row past **80% fill** takes `.is-close`: a nature-green border and a soft
  glow. The completion flourish used to be the first and only signal, which
  arrives one frame *after* the thing worth looking up for.
- Rows key on the contract's **instance id** (`uid`), not its def id. That is
  what lets a completed contract flourish in place while its replacement slides
  in underneath — including when the replacement is the same def drawn again.
- The flourish listens on **`contract_reward`**, not `contract_completed`:
  the latter is emitted by the manager *before* anything is paid, and
  `UIManager` subscribes first, so the reward text would always be a frame
  behind. `Game` emits `contract_reward` once the payout is resolved, still
  inside the same completion.
- A row that vanishes without a `contract_reward` — an ascension, a save load —
  is dropped silently. "Completed" and "replaced" look identical from the
  outside and only one deserves a celebration.
- **Progression tab** carries the full section: the three live contracts with
  their goal text and reward, the run's completed list, and the AP-bonus
  readout against the cap.
- The completed list is behind a **disclosure**, collapsed by default, with the
  count in its header. By wave 60 it is forty rows, and forty rows of history
  above the milestone list buried the live contracts that the section is
  actually for. Expanded, it opens on a totals row — the run's whole contract
  take — over one card per completion: the wave, the name, and one colour-coded
  chip per reward part. The open state is a panel field that survives a tab
  switch, and the header and body are built once so toggling never waits for an
  update tick.
- Chips and blurbs come from one producer, `rewardParts` in
  `src/data/contracts.ts`, so the corner tracker and the history cannot word
  the same payout differently. Gold formats through `formatNumber`, not
  `toLocaleString` — a late-run payout is nine digits.

Everything here runs from `frameUpdate`, never the substep loop, and only
rebuilds DOM when the set of live uids changes.

## Persistence

`GameState.contracts` (`ContractRunState`), save **v12**:

```ts
{ active: ActiveContractState[]; completed: string[];
  log?: CompletedContractState[];
  completedCount: number; apBonusPct: number; uidSeq: number }
```

`log` carries each completion's **payout** — the wave, the resolved gold, and
the rerolls / RP / AP actually banked — which is what the Progression tab's
history renders. It is optional and additive rather than a version bump: a save
written before it existed still has `completed`, and `restore` falls back to
that, filling the entries with a zero wave and no reward, which is exactly what
that save can tell us. Both fields are written.

The gold figure is stored **resolved**, not as the def's `goldWaves` ratio. The
reward is denominated in waves of income *at the wave it completed on*, so
re-resolving it at read time against a much later wave would report a payout
the player never received. `apBonusPct` is stored for the same reason: past the
run's cap a completion banks zero, and the history should say zero rather than
the +3% the def asked for.

Live slots are stored **in full**, unlike the blessing *offer*. A contract is
not a choice, so there is nothing a reload would silently take away by
re-rolling it; a blessing offer is, which is why that one is dropped.

`migrateV11toV12` seeds an empty block, and `ContractManager.restore` refills
to three — so a pre-v12 save loads straight into three live contracts, and a
slot whose def was removed in a later patch is replaced rather than leaving a
hole. `uidSeq` survives so a reload cannot hand out an id the tracker is
already showing.

## Balance

Contracts are a gold faucet, so `sim/model.ts` runs the **real**
`ContractManager` — the band gating, the three-slot refill and the AP cap are
the shipping ones rather than a second implementation that can drift. It has
its own RNG stream derived from the run seed, so a contract draw cannot perturb
the blessing draft and move the §1.6 table on a change that touched no card.

Four of the ten goal kinds ask about systems the model deliberately does not
have (abilities, mutators, tower HP). `CONTRACT_MODEL` names each assumption,
and every one is chosen to make the faucet look *larger* — the safe direction
for a check whose job is to catch contracts moving the curve.

`npm run sim`, §5 table:

| Lifetime AP | Wall (no contracts) | Wall (contracts) | Δ | Completed | AP bonus | gold share |
|---|---|---|---|---|---|---|
| 0 | 27 | 30 | +3 | 15 | +3% | 9.1% |
| 100 | 110 | 114 | +4 | 33 | +3% | 5.5% |
| 1 K | 146 | 148 | +2 | 45 | +15% | 3.9% |
| 10 K | 193 | 194 | +1 | 60 | +30% | 4.4% |
| 100 K | 240 | 241 | +1 | 77 | +48% | 4.1% |

Contract gold is 3.9–9.1% of a run's income — the same order as the orb faucet
Part 4 added, and for the same reason it mostly disappears into the upgrade
curve's rounding. Idle wall-wave drift is no longer *zero*: the 0-AP tier gains
three waves and the 100-AP tier four. That is the 3x raise landing where it was
aimed. Early runs are short enough that a couple of contract payouts are a real
fraction of everything the run earns, and the deep tiers — where a wave of
income dwarfs anything a faucet adds — move by one wave or not at all.

The 3x raise was measured as a **controlled A/B on one tree**, both runs with
nothing changed but the sixteen `goldWaves` figures:

| | gold share, 0 AP → 100 K | idle wall Δ | active advantage, 0 AP → 100 K |
|---|---|---|---|
| 0.4–1.2 | 4.1% → 1.3% | +1 +4 +2 +1 +1 | +34.8% → +25.5% |
| 1.2–4.0 | 9.1% → 4.1% | +3 +4 +2 +1 +1 | +30.5% → +25.5% |

### What contracts do to the idle-parity check

Contract gold is denominated in *waves of income*, and income already carries
the player's gold multiplier — so it multiplies whatever gold advantage active
play has rather than adding a flat amount. §4.5's table moves accordingly:

| Lifetime AP | Advantage before Part 5 | After |
|---|---|---|
| 0 | +45.2% | +49.5% |
| 100 | +35.4% | +43.9% |
| 1 K | +34.7% | +43.6% |
| 10 K | +34.8% | +36.2% |
| 100 K | +33.9% | +34.5% |

Those figures are the Part 5 measurement and the economy has moved several
times since. On the tree the 3x raise was measured against, the advantage runs
**+30.5% / +28.1% / +25.5% / +25.5% / +25.5%** — inside §4.5's preferred
+25–40% band at every tier, well under its +50% hard gate, and the raise
*lowered* the 0-AP tier rather than raising it (+34.8% before).

Worth knowing before re-tuning: **this metric is not monotonic in contract
income**, which is why the raise could improve it. It is composed DPS at a
single wave, and the greedy buyer crosses upgrade breakpoints, so it moves in
steps. Scaling every `goldWaves` down by 0.6x was measured back at the Part 5
values and made the 0-AP tier *worse* (+51.1%) while improving the middle.
Part 4's own finding was that `MANUAL_AIM.fireRateMult` filled the band on its
own; it has since been removed and the charged shot re-tuned to carry the
budget alone. Re-measure before assuming any of these numbers still hold.

## Known limits

- A contract whose goal the player never engages with occupies its slot until
  they do. Nothing jams in practice — mutators are offered on every boss wave,
  abilities auto-cast, orbs drift home on their own — but there is no expiry
  and no reroll. If a future change makes one of those optional, this becomes a
  real dead slot.
- `spend_gold` counts upgrade purchases only (`upgrade_purchased.goldSpent`),
  not ability upgrades or equipment.
