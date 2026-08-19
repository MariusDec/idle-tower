# Save System

**File:** `src/systems/SaveManager.ts`

## Overview

Persists game state to `localStorage` under key `the-tower-save`.

## Save Format (`PersistentState`)

```typescript
interface PersistentState {
  version: number;       // current = 2
  savedAt: number;       // Date.now()
  tower: TowerState;
  resources: ResourceState;
  upgrades: Record<string, number>;
  research: string[];
  abilities: Record<string, AbilityState>;    // levels only, cooldowns reset
  prestige: PrestigeState;
  wave: WaveState;
  stats: GameStats;
}
```

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
- version is 2..9 (older versions are walked up the migration ladder)
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
