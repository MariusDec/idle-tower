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

Non-boss waves draw from a weighted pool. The weights live in
**`ENEMY_SPAWN_WEIGHTS`** (`src/data/enemies.ts`), and `spawnPoolForWave(wave)`
filters them by each type's `unlockWave`.

That table is the single source of truth: `WaveManager.pickEnemyType`, the
offline-progress wave averages in `SaveManager`, and the balance model in
`sim/model.ts` all read it. It used to be written out three times, which is
exactly how a balance change lands in the game but not in the model that is
supposed to be measuring it.

| Type | Weight | Unlock |
|---|---:|---:|
| normal | 5 | 1 |
| fast | 3 | 3 |
| tank | 2 | 5 |
| flying | 2 | 8 |
| splitter | 1 | 12 |
| healer | 1 | 15 |
| shielded | 1 | 20 |
| siege | 2 | 25 |
| thief | 1 | 30 |
| blinker | 2 | 35 |
| warden | 1 | 40 |
| burrower | 2 | 45 |
| boss | 0 | — (boss waves bypass the pool) |

Gameplay plan §2.6 requires that the five behavioural types **replace** slots
rather than adding them, so total wave HP does not rise: `normal` dropped 6→5
and `splitter` 2→1 to pay for the eight new weight points, and the new types'
base HP is budgeted so the pool's weighted mean effective HP is unchanged.
`npm run sim` reproduces the pre-change wall wave exactly at every prestige tier.

### Thief cap

At most **one thief per wave**. `WaveManager` drops it from the pool once one
has spawned, and `EnemyManager` separately enforces the 15%-of-current-gold
theft ceiling for the wave (reset by `beginWave`, which `startWave`,
`startAtWave` and `reset` all call).

### Fast packs

A `fast` roll spawns **three** enemies from one shared spawn point, scattered
over ±26 px, so it reads as a rush rather than a trickle. The pack counts
against `enemiesToSpawn` **in full** — it takes slots, it does not add them —
and the pack is truncated if fewer than three slots remain. The elite roll
happens per pack member, so packing does not change the elite rate.

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

Every entry point that changes the current wave (`startWave`, `startAtWave`,
`reset`) calls `EnemyManager.beginWave(wave)`, which resets the per-wave theft
budget. Adding a fourth entry point without that call silently gives thieves an
unbounded budget.

## Wave Controls (UI)

HUD buttons: `<<` (prev wave), `Auto` toggle, `>>` (next wave).
Keyboard: `<` / `,` = prev, `>` / `.` = next, `P` = toggle auto-progress.
