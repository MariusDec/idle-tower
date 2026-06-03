# Wave System

**File:** `src/systems/WaveManager.ts`

## Wave Flow

```
tick() called each frame:
  if intermission:
    countdown → 0 → startWave(current + (autoProgress ? 1 : 0))
  else:
    spawnTimer -= dt
    while spawning && spawnTimer <= 0: spawnOne()
    if all enemies spawned AND alive count == 0:
      emit wave_cleared → intermission (5 seconds)
```

## Wave Properties

| Field | Formula | Description |
|-------|---------|-------------|
| Enemy count | `5 + (wave-1) * 1.5` | How many enemies to spawn |
| Spawn interval | `max(0.3, 2.0 - wave * 0.05)` | Time between spawns |
| Intermission | 5 seconds | Pause between waves |
| Auto-progress | default ON | Advance waves automatically |

## Enemy Selection

Non-boss waves pick from weighted pool:
- **normal:** weight 6 (always available)
- **fast:** weight 3 (wave 3+)
- **tank:** weight 2 (wave 5+)
- **flying:** weight 2 (wave 8+)
- **healer:** weight 1 (wave 15+)

Boss waves (every 10th) always spawn a single boss enemy.

## Spawn Position

Random edge of canvas: top (`y=-20`), right (`x=width+20`), bottom (`y=height+20`), left (`x=-20`).

## Wave Skip

If `waveSkipChance > 0` and roll succeeds:
- Zero enemies, zero spawn time
- Immediate intermission (wave cleared instantly)
- Emits `wave_cleared` + toast

## Public API

| Method | Effect |
|--------|--------|
| `startWave(wave)` | Initialize a new wave |
| `goToPrevWave()` | Decrement wave, reset enemies |
| `goToNextWave()` | Increment wave, clear enemies |
| `reset()` | Back to wave 1 |
| `startAtWave(wave)` | Jump to specific wave |
| `setAutoProgress(bool)` | Toggle auto-advance |
| `getAutoProgress()` | Current auto-progress state |
| `setWaveSkipChance(float)` | Set skip probability |

## Wave Controls (UI)

HUD buttons: `<<` (prev wave), `Auto` toggle, `>>` (next wave).
Keyboard: `<` / `,` = prev, `>` / `.` = next, `P` = toggle auto-progress.
