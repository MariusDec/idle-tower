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
  ├── dt = (now - lastTime) / 1000, capped at 0.05   ← wall clock
  ├── gameDt = dt * speed * slowMo                   ← up to 6.5x from the Accelerator perk
  ├── update(gameDt, dt)   ← all game logic
  │     ├── simulate(step) x N   ← fixed substeps of 1/60 s, max 6
  │     └── frameUpdate(gameDt, dt)
  ├── draw()               ← Canvas rendering
  ├── ui.update(state)     ← DOM UI refresh
  ├── FPS calculation (every 0.5s)
  └── requestAnimationFrame(loop)
```

`update` never simulates a step larger than it has to: it runs
`ceil(gameDt / FIXED_STEP)` substeps, clamped to `MAX_SUBSTEPS` (6). At 1x
speed that is one step and the loop is unchanged; at 6.5x it is six. When the
clamp bites, step size grows rather than time being dropped, so the game never
runs in slow motion under load. See [performance.md](performance.md).

## Update Order (`Game.simulate`, once per substep)

0. Buff ageing, HP-threshold restate, **combo decay + pacing restate**
1. `waveMgr.tick(dt)` — spawning, intermission
2. `resourceMgr.tick(dt, wave)` — mana regen, passive gold
3. `abilityMgr.tick(dt)` — cooldowns, active timers, buffs
4. Tower health regen
5. Tower targeting & firing (if cooldown ready):
   - `acquireTarget(enemies)` — if not in manual aim mode
   - `rollShot()` — damage + crit check
   - `buildShotVariants()` — extra/scatter/back shots from AP perks
   - `projectileMgr.fire(target, ...)` — spawn projectiles
6. Charged shot — fires the projectile a mouse-release armed last frame
7. `projectileMgr.tick(dt)` — movement & swept collision
8. `enemyMgr.tick(dt, tx, ty)` — movement, attack, auras
9. `lootMgr.tick(dt)` — loot-orb drift and auto-collect
10. Shockwave pulse (periodic knockback ring)
11. Land mines — placement and detonation
12. Shield recharge

### The two clocks

Every timer in the game runs on exactly one of two clocks, and which one is a
design decision rather than an implementation detail:

| Clock | Runs in | For |
|---|---|---|
| **Simulation** (`dt`, scaled by game speed and slow-mo) | `simulate` | anything that measures *the field* |
| **Wall clock** (`realDt`) | `frameUpdate` | anything that measures *a person* |

The rule: **if the quantity being timed is produced by the simulation, it is
simulation time.** The gameplay plan's §7.2 combo window is the clearest case.
Kills are simulation events, so the interval between two of them is a
simulation-time quantity; a 2 s window on the wall clock would be 0.3 s at 6.5x
speed and no combo would ever chain, which would make the same play pay
differently depending on a speed setting that is supposed to cost nothing
(`PacingManager.tickCombo`, `COMBO_WINDOW_SECONDS`).

The three `realDt` timers are the exceptions that prove it, and all three are
measuring a human rather than the field:

- the **blessing draft countdown** (§1.1) — 20 s to read three cards is 20 s of
  the player's life, not 3 s at high speed;
- the **charged-shot hold and cooldown** (§4.2) — 1.2 s of holding still, and a
  4 s cooldown that must not become 0.6 s the moment the Accelerator unlocks;
- **research progress and passive RP** — deliberately real-time systems.

Boss enrage, the boss encounter clock, orb drift, the combo window, mutator
cadences and every enemy behaviour cadence are all simulation time.

## Frame Order (`Game.frameUpdate`, once per frame)

1. `effects.tick(dt)` — particle physics
2. `notifications.tick(dt)` — toast lifetimes
3. `automation.tick(dt)` — auto-buy/cast/ascend/transcend
4. `ui.tickDisplayHud(dt, state)` — HUD tweening
4b. `ui.setPacingData(...)` — one §7 snapshot per frame, shared by the HUD
   controls, the pacing overlay and the canvas lane markers
5. `charge.tick(realDt, ...)` — the charged-shot hold and cooldown, on
   **`realDt`**: it measures a person holding still, so 1.2 s must be 1.2 s of
   the player's life at every game speed (gameplay plan §4.2)
6. Research + passive RP, on **`realDt`** — these are real-time systems and
   must not accelerate with game speed
7. Transcendence unlock toast check
8. `saveMgr.tick(realDt, ...)` — debounced save flush
9. Achievements, audio, vignette

> Anything time-integrated or cadence-driven goes in `simulate`. Anything that
> polls state, or that consumes `realDt`, goes in `frameUpdate` — a `realDt`
> consumer in `simulate` would run six times per frame at high speed.

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
| `setMouseInput(x, y, down)` | Manual aim, and the charged-shot hold (§4.2) |
| `handleCanvasPress(x, y)` | A press on the battlefield: **orb, then placement, then aim** (§4.1/§4.3). Returns true if it was consumed |
| `cancelPlacement()` | Leave ability-placement mode; `Escape` calls it first |
| `setInstantCast(bool)` / `isInstantCast()` | Cast on hotkey (default) vs. click-to-place |
| `tryLoadSave()` / `manualSave()` / `clearSave()` | Persistence |

## The input model (gameplay plan §4)

`main.ts` attaches three mouse listeners and three touch listeners, and both
sets funnel presses through **one** `pressAt(x, y)` helper, so mouse and touch
cannot drift apart. `pressAt` calls `Game.handleCanvasPress`, which resolves the
press in a fixed order:

1. a **loot orb** inside the catch radius → collect it, consume the press;
2. an **armed ability** → place it, consume the press;
3. otherwise → the press becomes an ordinary manual-aim hold.

A consumed press still updates the aim point, so clicking an orb does not snap
the tower's aim back to where the cursor previously was.

The split between clocks matters here. A DOM event never simulates anything: a
release that arms a charged shot sets a flag, and the *next fixed substep* fires
the projectile. Orb drift is time-integrated movement, so it runs on the
simulation clock (8 game-seconds at any speed); the charge timer measures a
human, so it runs on `realDt`. See
[loot-system.md](loot-system.md#why-the-timers-are-wall-clock).

## Speed System

- `GAME_SPEEDS = [0.5, 1.0, 1.5]` (default index 1, max index 1)
- `maxSpeedIndex` can be increased by research; the Accelerator TP perk extends
  it to 6.5x via `computeSpeedForIndex`
- Speed scales the simulation delta, not rendering or UI. Substepping keeps the
  physics step fixed regardless, so DPS at 6.5x matches 1x within ~1%

## Reset Types

| Method | What resets |
|--------|-------------|
| `applySavedStateReset()` | Upgrades, resources, enemies, projectiles, abilities, effects, tower HP. Keeps AP/TP/perks/research. Starts at research `startWave` |
| `applyFullTranscendenceReset()` | Same as ascension + research reset + automation reset |
| Tower destroyed | Enemies + projectiles cleared, tower HP restored, wave set to current-1 |
