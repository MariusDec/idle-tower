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
| Slots | **3**, always. A completion draws its replacement inside the same call. |
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
| `goldWaves` | 0.4–1.2 **waves of current income** | `Game`'s `contract_completed` handler, via `estimateWaveGold` |
| `rerolls` | 1 | `BlessingManager.grantRerollToken` |
| `rp` | 1–3 | `ResearchTree.addRP` |
| `apBonusPct` | +3% each, **capped at +50% for the run** | `PrestigeManager.setRunApBonus(…, 'contract')` |

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

Everything here runs from `frameUpdate`, never the substep loop, and only
rebuilds DOM when the set of live uids changes.

## Persistence

`GameState.contracts` (`ContractRunState`), save **v12**:

```ts
{ active: ActiveContractState[]; completed: string[];
  completedCount: number; apBonusPct: number; uidSeq: number }
```

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
| 0 | 39 | 39 | 0 | 16 | +3% | 3.4% |
| 100 | 59 | 59 | 0 | 21 | +3% | 2.8% |
| 1 K | 89 | 89 | 0 | 33 | +6% | 9.2% |
| 10 K | 129 | 129 | 0 | 43 | +15% | 8.2% |
| 100 K | 169 | 169 | 0 | 54 | +24% | 7.1% |

Idle wall-wave drift is **zero at every tier**, the standard Parts 2–4 held.
Contract gold is 3–9% of a run's income — the same order as the orb faucet
Part 4 added, and for the same reason it disappears into the upgrade curve's
rounding.

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

Still inside §4.5's hard gate (+50%) at every tier, and outside its preferred
+25–40% band at three of five — which Part 4's status block already recorded as
spent before Part 5 added anything.

Worth knowing before re-tuning: **this metric is not monotonic in contract
income.** It is composed DPS at a single wave, and the greedy buyer crosses
upgrade breakpoints, so it moves in steps. Scaling every `goldWaves` down by
0.6x was measured and made the 0-AP tier *worse* (+51.1%) while improving the
middle — the shipped values are the better of the two on the gate, not merely
the untuned ones. Part 4's own finding was that `MANUAL_AIM.fireRateMult` filled the band on its
own; it has since been removed and the charged shot re-tuned to carry the
budget alone, which brought every tier back inside +25-40%. Re-measure before
assuming these numbers still hold.

## Known limits

- A contract whose goal the player never engages with occupies its slot until
  they do. Nothing jams in practice — mutators are offered on every boss wave,
  abilities auto-cast, orbs drift home on their own — but there is no expiry
  and no reroll. If a future change makes one of those optional, this becomes a
  real dead slot.
- `spend_gold` counts upgrade purchases only (`upgrade_purchased.goldSpent`),
  not ability upgrades or equipment.
