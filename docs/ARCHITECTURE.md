# Project Architecture

**Tech Stack:** TypeScript 5.4, Vite 5.2 (bundler), HTML5 Canvas 2D (rendering), Vanilla DOM (UI), localStorage (persistence)

## Entry Point

`src/main.ts` — waits for `DOMContentLoaded`, calls `bootstrap()`:
1. Queries DOM roots (`#game-canvas`, `#hud-root`, `#panel-tabs`, `#panel-content`, `#toast-root`, `#modal-root`)
2. Creates `EventBus` (shared pub/sub) and `UIManager` (owns all panel instances)
3. Creates `Game` (central orchestrator, owns all systems)
4. Wires UI callbacks → `Game` methods
5. Attaches mouse (mousemove/mousedown/mouseup on canvas) and keyboard (`1-4` abilities, `<>` waves, `P` auto-progress, `-+` speed) listeners
6. Calls `game.tryLoadSave()` then `game.start()`
7. Exposes `window.__theTower` for debugging

## File Map

```
src/
  main.ts                         — Bootstrap entry point
  types.ts                        — ALL shared types/interfaces
  game/
    Game.ts                       — Core loop, orchestrator
    EventBus.ts                   — Pub/sub event system
    Renderer.ts                   — Canvas 2D drawing
  systems/
    Tower.ts                      — Tower state, targeting, damage
    EnemyManager.ts               — Enemy spawning, movement, combat
    ProjectileManager.ts          — Projectile physics, collisions
    WaveManager.ts                — Wave progression, spawning
    ResourceManager.ts            — Gold/mana management
    UpgradeManager.ts             — Upgrade purchases
    AbilityManager.ts             — Active ability casting
    PrestigeManager.ts            — Ascension/Transcendence/perks
    ResearchTree.ts               — Research node unlocking
    AutomationManager.ts          — Auto-buy/cast/ascend/transcend
    EffectsManager.ts             — Particles, damage numbers, shockwaves
    NotificationManager.ts        — Toast notifications
    SaveManager.ts                — localStorage persistence
  data/
    tower.ts                      — Tower base stats & visuals
    enemies.ts                    — Enemy type definitions
    upgrades.ts                   — 17 upgrade definitions
    abilities.ts                  — 4 ability definitions
    formulas.ts                   — Scaling formulas
    prestige.ts                   — Prestige perks & formulas
    research.ts                   — Research tree (8 nodes)
  ui/
    UIManager.ts                  — Tab system, panel orchestration
    HUD.ts                        — Top bar (gold, mana, HP, wave, speed)
    UpgradePanel.ts               — Buy upgrades (3 sub-tabs)
    AbilityPanel.ts               — Cast abilities, hotkeys
    PrestigePanel.ts              — Ascension card, AP perks
    TranscendencePanel.ts         — Transcendence card, TP perks, automation
    ResearchPanel.ts              — Research tree (4 categories)
    WelcomeBackModal.ts           — Offline progress dialog
  utils/
    bigNumber.ts                  — Number formatting (up to Vigintillion)
    math.ts                       — clamp, lerp, distance, nextId, etc.
  styles/
    main.css                      — Complete dark-theme CSS (~1300 lines)
```

## Data Flow

```
main.ts
  ├── EventBus (shared)
  ├── UIManager ─── panels ─── callbacks ──┐
  └── Game                                  │
        ├── Tower ◄─────────────────────────┤
        ├── EnemyManager ◄──────────────────┤
        ├── ProjectileManager ◄─────────────┤
        ├── WaveManager ◄───────────────────┤
        ├── ResourceManager ◄───────────────┤
        ├── UpgradeManager ◄────────────────┤
        ├── AbilityManager ◄────────────────┤
        ├── PrestigeManager ◄───────────────┤
        ├── ResearchTree ◄──────────────────┤
        ├── AutomationManager ◄─────────────┤
        ├── EffectsManager ◄────────────────┤
        ├── NotificationManager ◄───────────┤
        └── SaveManager ◄───────────────────┘
```

Game loop (`Game.loop`) calls `update(dt)` → systems tick → `draw()` → `ui.update(state)`.

## State Management

- Single root `GameState` object created by `makeInitialState()` in `Game.ts`
- Each system owns a slice of state (passed via constructor)
- Systems mutate state directly in `tick()` methods
- EventBus provides cross-system communication
- UI reads state each frame — `Game.update()` ends with `this.ui.update(this.state)`
- UI callbacks go through setter-wired methods on `Game` (no direct state mutation from UI)
