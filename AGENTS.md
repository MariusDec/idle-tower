# Source Code Documentation for AI Agents

This project is an idle tower defense game built with TypeScript, Vite, HTML5 Canvas, and vanilla DOM.

## Docs Index

| File | Description |
|------|-------------|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Overall project structure, tech stack, entry point, file map, data flow, state management |
| [docs/game-loop.md](docs/game-loop.md) | Core game loop, update/draw cycle, speed system, reset types, public API |
| [docs/tower-system.md](docs/tower-system.md) | Tower state, targeting modes (nearest/lowest_hp/first), damage calculation, manual aim |
| [docs/enemy-system.md](docs/enemy-system.md) | 6 enemy types, scaling per wave, movement, combat, crowd control (slow/knockback/shockwave) |
| [docs/wave-system.md](docs/wave-system.md) | Wave progression, spawning, intermission, enemy selection weights, wave skip |
| [docs/projectile-system.md](docs/projectile-system.md) | Projectile firing, shot variants (extra/scatter/back), collision, piercing, damage multipliers |
| [docs/resource-system.md](docs/resource-system.md) | Gold & mana economy, income sources, spending, passive income |
| [docs/upgrade-system.md](docs/upgrade-system.md) | 17 upgrades across 4 categories, cost formula, effect computation, upgrade panel |
| [docs/ability-system.md](docs/ability-system.md) | 4 active abilities, mana system, casting logic, cooldowns, buffs |
| [docs/prestige-system.md](docs/prestige-system.md) | Ascension (AP) & Transcendence (TP), perks, formulas, automation unlocks |
| [docs/research-system.md](docs/research-system.md) | 8 research nodes in 4 categories, RP system, effect queries, prerequisites |
| [docs/automation-system.md](docs/automation-system.md) | 4 automation features (buy/cast/ascend/transcend), timers, unlock requirements |
| [docs/effects-system.md](docs/effects-system.md) | Particles, damage numbers, shockwave rings, physics constants |
| [docs/ui-system.md](docs/ui-system.md) | 5-tab panel system, HUD components, API interfaces, callback wiring, CSS |
| [docs/event-bus.md](docs/event-bus.md) | Pub/sub event system with full event catalog (25 events) |
| [docs/data-formulas.md](docs/data-formulas.md) | All scaling formulas, upgrade value computation, static data definitions |
| [docs/save-system.md](docs/save-system.md) | localStorage persistence, save format (v2), auto-save, offline progress computation, welcome back modal |
