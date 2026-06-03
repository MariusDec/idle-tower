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

- Interval: 30 seconds
- Triggered in `SaveManager.tick(dt, state, onSave)`
- Called from `Game.update` each frame

## Validation

`validate()` checks:
- version === 2
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
