# Save System

**File:** `src/systems/SaveManager.ts`

## Overview

Persists game state to `localStorage` under key `the-tower-save`.

## Save Format (`PersistentState`)

```typescript
interface PersistentState {
  version: number;       // current = 15
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
- version is 2..15 (older versions are walked up the migration ladder)
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
