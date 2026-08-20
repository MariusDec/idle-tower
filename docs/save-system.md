# Save System

**File:** `src/systems/SaveManager.ts`

## Overview

Persists game state to `localStorage` under key `the-tower-save`.

## Save Format (`PersistentState`)

```typescript
interface PersistentState {
  version: number;       // current = 12
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
- version is 2..12 (older versions are walked up the migration ladder)
- All required fields exist and have correct types (object, array, number checks)

## Offline Progress

Computed on load via `computeOfflineProgress(persisted, now)`:

1. **Elapsed time:** `max(0, (now - savedAt) / 1000)`, capped at 7 days
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
- Capped notice if > 7 days
- Modal overlay with Continue button

## Manual Operations

| Method | Purpose |
|--------|---------|
| `save(state)` | Serialize and write to localStorage |
| `load()` | Read and validate from localStorage |
| `clear()` | Remove save |
| `hasSave()` | Check existence |
