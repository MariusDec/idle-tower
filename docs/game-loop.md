# Game Loop

**File:** `src/game/Game.ts`

The `Game` class is the central orchestrator. It owns all system instances and runs the game loop via `requestAnimationFrame`.

## Constructor Flow

1. Creates `Renderer(canvas)`
2. Creates initial state via `makeInitialState()`
3. Instantiates all systems, passing state slices and EventBus
4. Positions tower at canvas center
5. Applies upgrade effects
6. Registers EventBus listeners for cross-system events:
   - `enemy_damaged` → lifesteal, hit sparks, damage numbers
   - `enemy_killed` → stats, boss kill tracking + shockwave, death burst
   - `tower_damaged` → damage calc (armor + defense), tower destruction handling
   - `wave_started` → milestone announcements
   - `upgrades_changed` → recalc effects
   - `research_unlocked` → recalc + toast
   - `automation_unlocked` → toast
   - `ability_visual` → particle effects per ability type

## Loop Execution (`Game.loop`)

```
requestAnimationFrame
  ├── dt = (now - lastTime) / 1000, capped at 0.05
  ├── gameDt = dt * speed (default 0.5x or 1.0x)
  ├── update(gameDt)       ← all game logic
  ├── draw()               ← Canvas rendering
  ├── ui.update(state)     ← DOM UI refresh
  ├── FPS calculation (every 0.5s)
  └── requestAnimationFrame(loop)
```

## Update Order (`Game.update`)

1. `waveMgr.tick(dt)` — spawning, intermission
2. `resourceMgr.tick(dt, wave)` — mana regen, passive gold
3. `abilityMgr.tick(dt)` — cooldowns, active timers, buffs
4. Tower health regen
5. Tower targeting & firing (if cooldown ready):
   - `acquireTarget(enemies)` — if not in manual aim mode
   - `rollShot()` — damage + crit check
   - `buildShotVariants()` — extra/scatter/back shots from AP perks
   - `projectileMgr.fire(target, ...)` — spawn projectiles
6. `projectileMgr.tick(dt)` — movement & collision
7. `enemyMgr.tick(dt, tx, ty)` — movement, attack
8. Shockwave pulse (periodic knockback ring)
9. `effects.tick(dt)` — particle physics
10. `notifications.tick(dt)` — toast lifetimes
11. `automation.tick(dt)` — auto-buy/cast/ascend/transcend
12. Save timer check (auto-save every 30s)
13. Transcendence unlock toast check

## Public API (UI callbacks)

| Method | Purpose |
|--------|---------|
| `castAbility(id)` | Try to cast an ability |
| `ascend()` | Perform ascension, reset run |
| `transcend()` | Perform transcendence, full reset |
| `spendAP(perkId)` | Purchase AP/TP perk |
| `unlockResearch(id)` | Unlock research node |
| `setAutomationEnabled(key, bool)` | Toggle automation |
| `setTargetAscendWave(n)` | Set auto-ascend target |
| `setSpeedIndex(index)` / `cycleSpeed(dir)` | Change game speed |
| `goToPrevWave()` / `goToNextWave()` | Manual wave control |
| `setAutoProgress(bool)` / `toggleAutoProgress()` | Auto-advance toggle |
| `setMouseInput(x, y, down)` | Manual aim mode |
| `tryLoadSave()` / `manualSave()` / `clearSave()` | Persistence |

## Speed System

- `GAME_SPEEDS = [0.5, 1.0, 1.5]` (default index 1, max index 1)
- `maxSpeedIndex` can be increased by research
- Speed affects the `dt` passed to `update()` but NOT rendering or UI

## Reset Types

| Method | What resets |
|--------|-------------|
| `applySavedStateReset()` | Upgrades, resources, enemies, projectiles, abilities, effects, tower HP. Keeps AP/TP/perks/research. Starts at research `startWave` |
| `applyFullTranscendenceReset()` | Same as ascension + research reset + automation reset |
| Tower destroyed | Enemies + projectiles cleared, tower HP restored, wave set to current-1 |
