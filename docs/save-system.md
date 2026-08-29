# Save System

**File:** `src/systems/SaveManager.ts`

## Overview

Persists game state to `localStorage` under key `the-tower-save`.

## Save Format (`PersistentState`)

```typescript
interface PersistentState {
  version: number;       // current = 21
  savedAt: number;       // Date.now()
  tower: TowerState;
  resources: ResourceState;
  upgrades: Record<string, number>;
  research: string[];
  abilities: Record<string, AbilityState>;    // levels only, cooldowns reset
  prestige: PrestigeState;
  wave: WaveState;
  stats: GameStats;
  blessings: BlessingRunState;                // v10+
  bossRun: BossRunState;                      // v11+
  contracts: ContractRunState;                // v12+
  cores: CoreRunState;                        // v13+
  pacing: PacingState;                        // v14+
  watch: WatchState;                          // v19+
}
```

## Migration ladder

| Step | What it adds |
|---|---|
| v2 → v3 | run history + `runStartedAt` |
| v3 → v4 | research levels as a map, RP, research-in-progress target level |
| v4 → v5 | the wave-modifier block |
| v5 → v6 | tower XP, talents, passives, equipment |
| v6 → v7 | `unlocked` on each passive |
| v7 → v8 | equipment slot/def renames |
| v8 → v9 | per-ability auto-cast, auto-buy strategy/reserve, multi-wave mutator fields |
| v9 → v10 | `blessings` — the run's draft (`docs/blessing-system.md`) |
| v10 → v11 | `bossRun` — boss encounter rewards banked this run (`docs/boss-encounters.md`) |
| v11 → v12 | `contracts` — the run's three live contracts (`docs/contract-system.md`) |
| v12 → v13 | `cores` — unlocked tower cores and the run's selection (`docs/core-system.md`) |
| v13 → v14 | `pacing` — the risk dial, early-call momentum and the kill combo (`docs/wave-system.md`) |
| v14 → v15 | the offline cap became **derived** — 8h base + 8h/level of `ap_idle_time` (no field to seed; see below) |
| v15 → v16 | the `multishot` ability was renamed `rocket_barrage` — its state key in `abilities` and its key in `prestige.autoCastEnabled` move with it, values kept |
| v16 → v17 | the levelling redesign: 0-based levels become 1-based, XP restated onto the new polynomial+geometric curve, `talents.allocated` emptied (full refund — all talent ids changed) |
| v17 → v18 | the passive redesign: `passiveAbilities` cleared (new 12-passive structure with per-passive XP curves, milestones, and gold+XP upgrade costs; old prices were negligible vs new ones so no gold refund) |
| v18 → v19 | the Long Watch. Purely additive — `data.watch = defaultWatch()`. |
| v19 → v20 | the ability redesign. No state-shape change — `migrateV19toV20` only clamps each stored ability level into `[1, maxLevel]` as a safety net. The `instantCast` **localStorage** preference (never part of the save) is read once into `autoCastAutoAim` and removed. |
| v20 → v21 | the upgrades revamp's balance migration — `upgradeDiscount` → `prospecting`, `tp_midas` → `tp_salvage`, and every upgrade/perk level clamped to its new ceiling (see below) |

Every step is additive: it fills in defaults rather than transforming, and
nothing is ever dropped. `migrateV9toV10` seeds an empty blessing run, so a
pre-v10 save loads as a run that has simply not drafted yet. The *offer* is
deliberately not persisted — see `docs/blessing-system.md`.

`migrateV10toV11` seeds an empty `bossRun`. Only the *earned* half of a boss
encounter is stored — the flawless AP bonus and the two counters. Mid-fight
state (phase, pattern timers, the bulwark shield, the encounter clock) is
deliberately absent, because live enemies have never been part of the save
format: a load starts with an empty roster and `WaveManager` clears the wave
rather than resuming half a boss. See
[boss-encounters.md](boss-encounters.md#persistence).

`migrateV11toV12` seeds an empty contract block. Unlike the blessing *offer*,
the live contract slots are persisted **in full** — progress, resolved target,
instance id and the wave each was drawn at. A contract is not a choice, so
there is nothing a reload would silently take away by re-rolling it; a blessing
offer is, which is why that one is dropped instead. The seeded default is empty
rather than pre-drawn because the draw needs the run's current wave and
`Game.estimateWaveGold`, neither of which the save layer has;
`ContractManager.restore` refills to three the moment the game wires itself up,
so a pre-v12 save loads straight into three live contracts. See
[contract-system.md](contract-system.md#persistence).

`migrateV12toV13` seeds `{ unlocked: ['marksman'], preferred: 'marksman',
selected: 'marksman' }`. That is a restatement rather than a grant: the default
core is the only one a pre-v13 save could have owned, and `marksman`'s shot
behavior is what every pre-v13 tower was already doing. The block carries **two
lifetimes at once** — `unlocked` and `preferred` are permanent (an ascension
must not un-buy a core, and an auto-ascending run must not silently revert to
the default), while `selected` is run-scoped and restored from `preferred` on
reset. `CoreManager.restore` rejects unrecognised ids and refuses to select a
core the player does not own, so a hand-edited save loads as the default rather
than as an unpayable grant. See [core-system.md](core-system.md#persistence).

`migrateV13toV14` seeds `{ risk: 0, committedRisk: 0, momentum: 0,
momentumWaves: 0, comboBest: 0 }`. Another restatement rather than a grant:
gameplay plan §7.8's gate is that **risk 0 reproduces the pre-Part-7 curve
exactly**, so a pre-v14 save was already playing at risk 0 with nothing banked.

Like `cores`, the block carries **two lifetimes**. `risk` is permanent — it is a
preference about how the player wants to play, and an auto-ascending run reaches
the ascension reset several times an hour with nobody watching, so resetting the
dial there would silently un-set it. Everything else is run-scoped.

A **live combo is deliberately not persisted**, only the run's best.
`PacingManager.restore` clears it: a combo decays in two seconds and a load is
never inside that window, so restoring one would be restoring a number that was
already gone. Same rule as live enemies (`bossRun`) and live orbs
(`docs/loot-system.md`). See [wave-system.md](wave-system.md#risk-dial-gameplay-plan-74).

`migrateV15toV16` is the ladder's first **rename** rather than a seed: the
`multishot` ability became `rocket_barrage`, so its key moves in `abilities`
(stored level and XP untouched) and in `prestige.autoCastEnabled` (the player's
per-ability on/off choice untouched). Both containers are guarded for absence
or a shape mismatch before they are touched, so a hand-edited or partially
formed save cannot crash the walk.

`migrateV18toV19` seeds `data.watch = defaultWatch()`. The block is purely
additive — a pre-v19 save has no campaign state, so the first poll credits
every chapter the player's existing lifetime counters already satisfy.
That is the intended behaviour, not a migration shortcut (see
[watch-system.md](watch-system.md#why-progress-is-derived-not-stored)).
The seven counters that did not exist before this version start at zero
and accrue from the update forward; that is the one place a returning
player loses credit, and it is unavoidable: the data was never written
down.

### v20 → v21: the upgrades revamp

`migrateV20toV21` is a **balance** migration, not an accounting one: no refunds
anywhere — gold, AP and TP all stay as they are. The revamp plan wrote this step
as v14 → v15, but the ladder moved on while it was being built and several of
its bullets landed on their own along the way, so only what was still
outstanding is done here.

| What | How |
|---|---|
| `upgradeDiscount` → `prospecting` | `min(20, ceil(old / 2))`, taking the max against any existing `prospecting`, then the old key is deleted |
| Every upgrade level | clamped to `[startLevel ?? 0, maxLevel]` from `UPGRADE_BY_ID` |
| `tp_midas` → `tp_salvage` | level 1 if owned, old key deleted |
| AP and TP perk levels | clamped to the table's `maxLevel` via `clampPerkLevels`; ids the table no longer defines are dropped |
| `ap_warlord` / `ap_tycoon` | now `exclusive` — a save holding both keeps the one with more spent levels; a tie keeps `ap_warlord`, first of the pair in table order |

The retired `upgradeDiscount` id was **already** being ignored on load —
`UpgradeManager.replaceLevels` walks `UPGRADES` rather than the saved map, so
its levels were silently dropped rather than translated. This step is the
translation. `upgradeCostDiscount` survives as a *stat key*, written by talents
and achievements; what went away is the gold upgrade that fed it. See
[upgrade-system.md](upgrade-system.md#economy-5).

The perk clamps cover the plan's hand-written list (Twin/Rear/Scatter to 1,
`ap_wave_skipper` 15, `tp_wave_start` 8, `tp_game_speed` 6, `tp_head_start` 12,
`tp_fire_rate` 20, `tp_crit` 25, `tp_treasure`/`tp_mana` 15) **without
restating any of those numbers** — they are read from `AP_PERK_BY_ID` /
`TP_PERK_BY_ID`, so the migration stays correct if the tables are retuned again.

## WatchState (v19+)

The Long Watch campaign — `GameState.watch`. Two fields:

- `completed: string[]` — chapter ids completed, in completion order. The
  `WatchManager` rebuilds the unlock set from this list on every mutation,
  so the unlock map and the completed list cannot drift.
- `counters: WatchCounters` — the seven lifetime counters no existing
  field covers: `killsByType` (per-enemy-type lifetime kills),
  `flawlessWaves`, `swiftBosses`, `contractsDone`, `blessingPicks`,
  `mutatorWaves`, and `riskWaves` (a per-step histogram indexed by the
  risk level in force when the wave was cleared).

**Permanent.** Neither `applySavedStateReset` nor
`applyFullTranscendenceReset` may touch this block — it is
meta-progression, like achievements and unlocked cores. A reset that wiped
it would delete the only long-horizon goal the game has.

**Objective progress is deliberately not stored.** It is derived from the
counters on every read, so there is nothing here that a save/load can
disagree with. See [watch-system.md](watch-system.md#why-progress-is-derived-not-stored).

`normalizeWatch(w)` repairs malformed saves in place: missing or
non-array `completed` → `[]`; missing or non-object `counters` →
`defaultWatch().counters`; missing or non-object `killsByType` → `{}`;
the five scalar counters missing or non-finite → `0`; `riskWaves`
missing, short, or with non-finite entries → resized to
`MAX_RISK_CEILING + 1` zeros, valid entries copied in. The `riskWaves`
array is sized to `MAX_RISK_CEILING + 1` (7 indices today, indexed 0–6)
so a future Watch unlock that raises the dial cannot land out of bounds.

## Auto-Save

`SaveManager.tick(realDt, state, onSave)` is called once per frame from
`Game.frameUpdate` on **wall-clock** delta, so the save cadence does not
accelerate with game speed.

Two triggers:

- **Debounced (5 s).** Nine game events — purchases, wave starts, research,
  ability upgrades, AP/TP spends, achievements — call
  `SaveManager.requestSave()`, which only marks the state dirty. `tick` flushes
  at most once per `SAVE_DEBOUNCE_SECONDS`. These used to write the full JSON
  save synchronously on every event, which with auto-buy meant several
  `JSON.stringify` calls of the whole state per second.
- **Backstop (30 s).** `AUTO_SAVE_INTERVAL` writes even when nothing requested
  it.

`save(state)` writes immediately and clears the pending flag; use it for
anything that must survive an immediate close. `Game.bindVisibilityEvents`
calls it when the tab goes hidden, which is what flushes a pending debounced
write.

## Validation

`validate()` checks:
- version is 2..21 (anything older than the current version is walked up the migration ladder; anything outside the range is rejected)
- All required fields exist and have correct types (object, array, number checks)

## Offline Progress

Computed on load via `computeOfflineProgress(persisted, now)`:

1. **Elapsed time:** `max(0, (now - savedAt) / 1000)`, capped at the current
   idle cap — 8h base, +8h per level of the `ap_idle_time` AP perk, up to 4
   days (11 levels). The cap is derived from `prestige.apSpent` via a
   `getIdleCapSeconds` callback injected into `SaveManager`; nothing about it
   is persisted, which is why `migrateV14toV15` is a no-op.
2. **Effective DPS:** `estimateDPS(tower) * 0.7` (70% efficiency)
3. **Gold earned:** `floor(effectiveDPS * elapsed * goldPerDamage)`
   - goldPerDamage = `goldDropForWave / enemyHPForWave`
4. **Waves cleared:** `floor(elapsed / 18)` (18s average wave duration)

Applied via `applyOfflineProgress(state, result)`:
- Adds gold to `resources.gold`, `resources.lifetimeGold`, `stats.goldEarned`
- Waves cleared is informational only (displayed in modal)

## Welcome Back Modal

When offline progress > 0, `welcome_back` event triggers `WelcomeBackModal.show()`:
- Shows duration, gold earned, waves cleared, effective DPS
- Capped notice if the absence exceeded the idle cap, naming the cap
  (`capped at 8h`, `capped at 1d 8h`, …)
- Modal overlay with Continue button

## Manual Operations

| Method | Purpose |
|--------|---------|
| `save(state)` | Serialize and write to localStorage |
| `load()` | Read and validate from localStorage |
| `clear()` | Remove save |
| `hasSave()` | Check existence |
