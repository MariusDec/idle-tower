# Blessings — the in-run draft

**Files:** `src/data/blessings.ts`, `src/systems/BlessingManager.ts`,
`src/stats/contributors/blessings.ts`, `src/ui/BlessingDraftModal.ts`,
the blessing section of `src/ui/ProgressionPanel.ts`

## Why it exists

Every other progression layer in this game is vertical. Upgrades are 27 strictly
good purchases, talents are allocated once and persist, research persists, gear
drifts upward. Two runs at the same lifetime AP therefore differ only in *how
far the same numbers got* — there is no run-scoped choice that changes what the
tower does, so there is no discovery, no synergy hunting, and no reason for run
#40 to feel different from run #4.

Blessings are the answer: three offers every few waves, chosen by the player,
**wiped on ascension**. Being wiped is the point. A run is distinct because its
blessings are, and the next run gets to be a different one.

## Cadence

| | |
|---|---|
| First draft | after clearing **wave 3** |
| Then | every **4 waves** (3, 7, 11, 15, …) |
| Offers | **3**, drawn without replacement within the offer |
| Rerolls | **1 free per draft**, plus any banked tokens (Part 5 grants them) |
| Cap | **30 picks per run** |

`BlessingManager.isDraftDue(clearedWave)` owns the whole rule, so the sim and
the game agree on it by construction rather than by inspection.

## The run's core biases the offer

`BlessingDef.corePreference` is **live** as of Part 6. It is a
`Partial<Record<CoreId, number>>`, and every declaration in the pool uses one
shared constant, `CORE_PREFERENCE_WEIGHT` — a per-card literal is how one of
them quietly becomes 3x during a re-tune.

```ts
// BlessingManager.offerWeight
const pref = core ? def.corePreference?.[core] ?? 1 : 1;
return Math.max(0.0001, def.weight * pref);
```

**1.5x, and never exclusive.** The weight *multiplies*, it never filters, so
every eligible card keeps a real draw chance on every core — cross-core builds
are most of what makes a second run of the same core interesting.
`tests/cores.test.ts` sweeps the entire weight range and asserts that no card is
unreachable on any core, and that every core has at least one card that likes it
(a core the pool ignored would draft identically to `marksman`).

Measured in-browser against the live pool:

| Card | on `marksman` | on its own core |
|---|---:|---:|
| Frostbite (`bl_frost`) | 9.5% of offers | **12.0%** (`frostwork`) |
| Mortar Round (`bl_mortar`) | 10.8% of offers | **13.5%** (`artillery`) |

Frostbite is still drawn in 10.6% of `artillery` offers, which is the point.

`Game` passes `coreMgr.current` into `openDraft` and `reroll`; `sim/model.ts`
passes the run's core too, so the §1.6 table measures the draft the player
actually sees. See [core-system.md](core-system.md).

## The draft pauses the intermission, not the game

`Game.maybeOfferBlessingDraft` calls `WaveManager.pauseIntermission()` — never
`pauseSpawning`, never anything that stops `simulate`. Projectiles keep
travelling, enemies keep moving, abilities keep ticking; only the countdown to
the next wave is held.

> Every exit from the draft goes through `Game.closeBlessingDraft`, which is the
> single place `resumeIntermission()` is called. That is deliberate: choose,
> skip and auto-pick are three ways out, and the same obligation documented in
> `docs/wave-modifier-system.md` was easy to forget at one of them.

## Idle safety

The idle contract is not negotiable, so the draft can never be what stops an
unattended run:

- The setting `autoPickBlessings` (Settings → Blessings, default **off**,
  persisted in `localStorage`) resolves the draft after **20 s**.
- It is **forced on** once `autoBuy` is unlocked — a player with automation
  running is by definition not watching the screen.
- With the setting off there is still a **120 s** safety timeout, because
  "nothing blocks on a modal forever" is a rule rather than a preference.
- Going to a hidden tab resolves an open draft immediately: the frame loop stops
  while hidden, so a draft left open would freeze the intermission until the
  player came back.

The auto-pick takes the **highest-weight** offer, which means the commonest
card. That is on purpose: commons are the plain stat gains with no trade-off
attached, and an unattended run should not be handed Glass Cannon.

Both timers run on the **wall clock**, not the simulation clock — at 6.5× a 20 s
game-time deadline is three real seconds, which is not long enough to read three
cards.

## The pool

30 entries in `BLESSINGS`, in three rarities.

| Rarity | Weight | Stacks | Role |
|---|---:|---|---|
| common | 10 | 3–4 | filler that makes a rare feel earned |
| rare | 5 | 1–2 | behaviors that change the picture |
| epic | 2 | 1 | run-defining, plus every trade-off card |

**Common:** `bl_sharpen` (+3% damage), `bl_tempo` (+2.5% fire rate), `bl_focus`
(+2% crit chance), `bl_cruelty` (+12% crit damage), `bl_reach` (+15% range),
`bl_avarice` (+10% gold), `bl_vigor` (+20% max HP), `bl_wellspring` (+25% mana
regen).

**Rare:** `bl_ricochet`, `bl_mortar`, `bl_frost`, `bl_split`, `bl_homing`,
`bl_siphon`, `bl_pierce` (+2 pierce), `bl_sunder` (+4 armour pen), `bl_arcane`
(+30% ability damage), `bl_bulwark` (+5% lifesteal).

**Epic:** `bl_executioner`, `bl_crit_chain`, `bl_overkill`, `bl_last_stand`,
`bl_greed_engine`, and the four trade-off cards — `bl_glass` (+35% damage, −35%
max HP), `bl_sniper` (−30% range, +20% fire rate), `bl_reckless` (+20% enemy
speed, +25% gold), `bl_brittle` (−10% enemy HP, +25% enemy damage). Two epics are
synergy follow-ups gated behind `requires`: `bl_shatter` needs `bl_frost`, and
`bl_ricochet_power` needs `bl_ricochet`.

The trade-off cards are the point of the epic tier. They are the first decisions
in this game a player can get *wrong*, which is what makes the right ones feel
like anything.

`bl_magnet` (Lodestone, `orb_magnet`) **is live as of Part 4**. It spent Parts
1–3 in the table carrying `offerable: false` — a card that does nothing is worse
than a card that is not there — and the flag came off when `LootManager`
shipped. It now raises the loot-orb auto-collect rate from 40% to 100% and
halves the drift time, which makes it the one blessing aimed squarely at a
player who is *not* clicking. The `offerable` escape hatch still exists and is
still enforced by the offer roll; nothing is currently using it, and
`tests/content-coverage.test.ts` asserts that nothing quietly starts to.

## Two closed unions, two compile-time guards

`BlessingStat` is switched **exhaustively** in `stats/contributors/blessings.ts`
with a `never` default, so a stat added to `BLESSING_STATS` without a consumer
does not compile. `BlessingBehavior` is keyed **exhaustively** by
`BLESSING_BEHAVIOR_CONSUMERS`, which records where each behavior is actually
read. This is the mechanism that killed the last plan's twenty inert talents;
`tests/content-coverage.test.ts` guards the parts the type system cannot see
(a card that declares nothing, a dangling `requires`, a placeholder consumer).
`CoreId` and `CoreBehavior` are the same pattern one layer up — see
[core-system.md](core-system.md#two-closed-unions).

## How a blessing becomes a number

```
BlessingManager.rebuildCaches()   →  statCache: Partial<Record<BlessingStat, number>>
                                     behaviorCache: Set<BlessingBehavior>
        │
        ├── Game.buildStatContext →  ctx.blessings  →  contributeBlessings  →  ResolvedStats
        └── ProjectileManager / Game.simulate / enemy_killed  →  has(behavior)
```

Scaling blessings go through the pipeline like everything else, so a blessing's
damage composes with prestige, talents and gear instead of racing them. Its gold
is **additive** (`goldAdditive`), which is what puts it in the Stats panel's
gold breakdown as a named `Blessings` source.

Three stats deliberately do not touch the tower. `enemySpeedPct`, `enemyHpPct`
and `enemyDamagePct` resolve to `enemySpeedMult` / `enemyHpMult` /
`enemyDamageMult`, and `Game.applyResolvedStats` writes them to `EnemyManager`
on channels of their own — separate from the wave mutator's, so a Reckless Greed
run under Glass Cannon gets both rather than one silently winning.

`armorPenFlat` is a new `StatKey`. The existing `armorPen` is a *fraction*, so a
card worth "+4 armour penetration" had nowhere to go in it; enemy armour is
itself a flat subtraction, so a flat channel is the honest shape.

### Behaviors

Read per shot and per kill, so they come from the rebuilt `behaviorCache` rather
than a scan of the pool — the same lookup-cache pattern
`UpgradeManager.rebuildEvolutionCache` uses.

| Behavior | Where it fires |
|---|---|
| `ricochet` / `ricochet_power` | `ProjectileManager.applyRicochet` on impact |
| `mortar` | shot cadence counted in `Game.simulate`; the blast in `ProjectileManager.applyBlastSplash` |
| `crit_chain` | `ProjectileManager.applyCritChain`, reusing the chain-lightning visual |
| `frost_shots` | `EnemyManager.applyChill` on impact (per-enemy, not the global slow) |
| `shatter` | impact damage, against `EnemyManager.isSlowed(enemy)` |
| `split_on_kill` | `Game.fireSplitShards` from the `enemy_killed` handler |
| `homing` | `fire({ isHoming })`, only for an auto-acquired target |
| `overkill_carry` | `ProjectileManager.applyOverkill` on a killing blow |
| `siphon` | `enemy_killed` handler |
| `executioner` | `ProjectileManager.tryExecute`, before damage, non-boss only |
| `last_stand` | the stat contributor, off `ctx.hpFraction` |
| `greed_engine` | folded into `goldPct` by `BlessingManager.getStatTotals` |
| `orb_magnet` | `LootManager.setMagnet` — auto-collect rate and drift speed |

`split_on_kill` applies direct damage rather than spawning projectiles, and is
guarded by a reentrancy flag: `EnemyManager.damage` emits `enemy_killed`
synchronously, and shards that spawn shards would cascade without bound in a
dense wave.

`frost_shots` needed a **per-enemy** chill map on `EnemyManager` rather than the
existing global `slowFactor`, because `shatter` has to be able to ask whether
*this* target is slowed. Chills age on the simulation clock and are dropped when
their enemy dies.

## Persistence

`GameState.blessings` (`BlessingRunState`) holds `held`, `picksTaken`,
`rerolls`, `pendingOfferForWave` and `wavesClearedThisRun`. `SAVE_VERSION` is
**10**; `migrateV9toV10` seeds an empty run, which is all a pre-v10 save needs
because the change is purely additive.

The *offer* is not persisted. `BlessingManager.restore` drops any draft that was
open when the save was written — rolling a fresh one on load would hand the
player a different choice than the one they were looking at.

Blessings are cleared in `Game.applySavedStateReset`, which covers both
ascension and transcendence (the latter calls the former), and in `clearSave`.

## Balance

Verified with `npm run sim`, which drives the **real** `BlessingManager` with a
seeded RNG — so the offer rules the model obeys are the shipping ones. Behavior
cards, which have no spatial model, are credited through
`BEHAVIOR_DPS_CREDIT`, a `Record` over the union: a new behavior without a
balance estimate does not compile.

The wall is quantised to boss waves, so a single draft sequence reports 49 or 59
with nothing in between. The tables average seven seeds for that reason.

| Lifetime AP | Wall (no blessings) | Wall (blessings) | Picks | Run power |
|---:|---:|---:|---:|---:|
| 0 | 39 | 53.3 | 13.3 | 1.73× |
| 100 | 59 | 71.9 | 17.9 | 2.11× |
| 1 K | 89 | 104.7 | 26.1 | 2.87× |
| 10 K | 129 | 147.6 | 30.0 | 3.63× |
| 100 K | 169 | 184.7 | 30.0 | 3.43× |

Run power is composed DPS at the wave the *un-blessed* run walls on, so it
includes the upgrades the extra gold bought, not just the stats the cards
granted. A ~26-pick run lands at 2.87×, inside the plan's 2.5×–3.5× band.

`bl_greed_engine` is uncapped by design at +1% gold per wave cleared; a 100-wave
run reaches 2× baseline gold, well inside the 6× ceiling the plan set.

> The plan's §1.3 table quoted much larger values (+18% damage per common, +120%
> damage for Glass Cannon). Those are roughly 4–6× what its own §1.6 wall-wave
> target allows: this game's HP curve compounds, so 13 picks of +18% damage put
> the sim past wave 89. The values shipped are the ones that hit the stated
> balance target.

## Verification

- `tests/blessings.test.ts` — offer never duplicates, never offers a maxed or
  deferred card (and asserts that no card is deferred any more), `requires` gating, wave gates, reroll order (free then tokens
  then refuse), the 30-pick cap, stat summation across stacks, the behavior
  cache against a fresh linear scan, snapshot/restore.
- `tests/stats.test.ts` — the golden case: a literal `StatContext` with two
  blessings resolving to a pinned damage figure, plus the enemy-side keys and
  the Last Stand threshold.
- `tests/save.test.ts` — v9 → v10 both ways: an empty run seeded for a v9 save,
  and held stacks carried through the ladder.
- `tests/content-coverage.test.ts` — the guards the type system cannot provide.
- `npm run sim` — the before/after table above.
