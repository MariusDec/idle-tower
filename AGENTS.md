# Source Code Documentation for AI Agents

This project is an idle tower defense game built with TypeScript, Vite, HTML5 Canvas, and vanilla DOM.

## Docs Index

| File | Description |
|------|-------------|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Overall project structure, tech stack, entry point, file map, data flow, state management |
| [docs/game-loop.md](docs/game-loop.md) | Core game loop, fixed-timestep substepping, speed system, reset types, public API |
| [docs/performance.md](docs/performance.md) | Frame budget: substepping, renderer sprite cache, spatial grid, effect pools, save cadence, lookup caches |
| [docs/testing.md](docs/testing.md) | Vitest suite, `npm run checks`, the balance simulator, in-browser verification |
| [docs/stat-pipeline.md](docs/stat-pipeline.md) | The single stat composition point: StatKey union, StatContext, accumulator buckets, contributors, BuffRegistry, breakdowns |
| [docs/tower-system.md](docs/tower-system.md) | Tower state, the 7 targeting modes (priority is the default), damage calculation, manual aim |
| [docs/enemy-system.md](docs/enemy-system.md) | 13 enemy types and the verb each one demands an answer to, hostile shots, targetability, elites and their 5 auras, scaling, crowd control |
| [docs/wave-system.md](docs/wave-system.md) | Wave progression, spawning, the pre-rolled roster and threat preview, calling a wave early, the risk dial, intermission length, fast packs, the thief cap, wave skip, enrage |
| [docs/wave-modifier-system.md](docs/wave-modifier-system.md) | 9 mutators, offer cadence, 3-wave duration with escalating rewards |
| [docs/boss-encounters.md](docs/boss-encounters.md) | Boss phases at 66/33%, the four patterns and their answers, the enrage timer, swift/flawless rewards, the boss bar, the durability budget |
| [docs/loot-system.md](docs/loot-system.md) | Loot orbs, the charged shot, click-placed abilities, the input routing order, and the idle-parity measurement |
| [docs/blessing-system.md](docs/blessing-system.md) | The in-run roguelite draft: 30-card pool, cadence, rerolls, behaviors, idle safety, balance |
| [docs/contract-system.md](docs/contract-system.md) | Three rolling run-scoped objectives: wave-band tiering, the goal-kind consumer map, rewards and the +50% AP cap, the tracker |
| [docs/watch-system.md](docs/watch-system.md) | The Long Watch chapter campaign — twelve ordered chapters, one active at a time, sixteen objective kinds, twelve content unlocks. |
| [docs/core-system.md](docs/core-system.md) | Five tower cores: the run's identity, AP unlocks vs run-scoped selection, shot behaviors, the picker, blessing preference, the ±15% balance table |
| [docs/projectile-system.md](docs/projectile-system.md) | Projectile firing, shot variants, swept collision, piercing, lifetime, damage multipliers |
| [docs/resource-system.md](docs/resource-system.md) | Gold & mana economy, income sources, spending, passive income |
| [docs/upgrade-system.md](docs/upgrade-system.md) | 29 upgrades across 4 categories, evolutions and the economy caps, bulk buy, cost formula, upgrade panel |
| [docs/ability-system.md](docs/ability-system.md) | 10 active abilities, mana system, casting logic, cooldowns, buffs, ability XP |
| [docs/passive-system.md](docs/passive-system.md) | 8 passive abilities, gold unlock + XP level track, persistence |
| [docs/xp-talent-system.md](docs/xp-talent-system.md) | Tower XP and level curve, talent points, the 37-node talent tree, respec |
| [docs/equipment-system.md](docs/equipment-system.md) | 8 slots, 5 rarities, drop sources and rolls, equipped bonuses, persistence |
| [docs/achievement-system.md](docs/achievement-system.md) | 18 achievements, reward types and the consumer map that keeps them wired |
| [docs/prestige-system.md](docs/prestige-system.md) | Ascension (AP) & Transcendence (TP), perk trees, formulas, automation unlocks |
| [docs/research-system.md](docs/research-system.md) | 18 research nodes in 4 categories, RP system, effect queries, prerequisites |
| [docs/automation-system.md](docs/automation-system.md) | Automation features (buy/cast/ascend/transcend), auto-buy strategies, timers, unlock requirements |
| [docs/effects-system.md](docs/effects-system.md) | Particles, damage numbers, shockwave rings, pool caps, physics constants |
| [docs/audio-system.md](docs/audio-system.md) | Web Audio synthesis, event subscriptions, volume and mute |
| [docs/ui-system.md](docs/ui-system.md) | Tab panel system, HUD components, canvas overlays (boss bar, pacing overlay), API interfaces, callback wiring, CSS |
| [docs/camera-system.md](docs/camera-system.md) | The world/screen transform, DPR-aware sizing and the resize path, the arena extents and aspect clamp, the two world scales and why `range` is exempt from them |
| [docs/art-direction.md](docs/art-direction.md) | The design token layer, the "arcane siege" palette and what each colour is allowed to mean, the shared `palette.ts` source of truth, the self-hosted display face |
| [docs/icon-system.md](docs/icon-system.md) | The committed game-icons sprite and its fetch script, the generated `IconId` union, CC BY attribution, `Icon.ts` and the CSS rarity frames |
| [docs/event-bus.md](docs/event-bus.md) | Pub/sub event system with the event catalog |
| [docs/data-formulas.md](docs/data-formulas.md) | All scaling formulas, upgrade value computation, static data definitions |
| [docs/milestones.md](docs/milestones.md) | Upcoming-events strip, progression tab, milestone table |
| [docs/run-summary.md](docs/run-summary.md) | Post-run debrief modal, per-run history ring buffer, stats tab |
| [docs/save-system.md](docs/save-system.md) | persistence (IndexedDB on the web, a private file on Android), save format (v23) and the migration ladder, debounced auto-save, offline progress |

## Content at a glance

| Table | Count | File |
|---|---:|---|
| Upgrades (with evolutions) | 29 | `src/data/upgrades.ts` |
| Upgrade evolutions | 17 | `src/data/upgrades.ts` |
| AP perks / TP perks | 13 / 18 | `src/data/prestige.ts` |
| Active abilities | 10 | `src/data/abilities.ts` |
| Passive abilities | 8 | `src/data/passiveAbilities.ts` |
| Enemy types | 13 | `src/data/enemies.ts` |
| Boss patterns | 4 | `src/data/enemies.ts` |
| Elite auras | 5 | `src/systems/EnemyManager.ts` |
| Targeting modes | 7 | `src/data/tower.ts` |
| Talents | 37 | `src/data/talentTree.ts` |
| Research nodes | 18 | `src/data/research.ts` |
| Achievements | 18 | `src/data/achievements.ts` |
| Wave modifiers | 9 | `src/data/waveModifiers.ts` |
| Blessings | 30 | `src/data/blessings.ts` |
| Tower cores | 5 | `src/data/cores.ts` |
| Core shot behaviors | 6 | `src/data/cores.ts` |
| Tower marks | 10 | `src/data/towerMarks.ts` |
| Loot orb kinds | 3 | `src/data/loot.ts` |
| Contracts | 28 | `src/data/contracts.ts` |
| Contract goal kinds | 10 | `src/data/contracts.ts` |
| Watch chapters | 12 | `src/data/watch.ts` |
| Watch unlocks | 12 | `src/data/watch.ts` |
| Placeable abilities | 3 | `src/data/abilities.ts` |
| Equipment slots / rarities | 8 / 5 | `src/data/equipment.ts` |
| Combo tiers | 4 | `src/data/pacing.ts` |
| Risk levels | 6 (0-5) | `src/data/pacing.ts` |
| Enemy threat classes | 3 | `src/data/pacing.ts` |
| Icons (distinct artwork) | 197 | `public/icons/sprite.svg` |
| Icon references across tables | 249 | `scripts/fetch-icons.mjs` |
| Save version | 23 | `src/systems/SaveManager.ts` |

## Commands

```bash
npm run dev         # vite dev server
npm run build       # tsc + vite build
npm run typecheck   # tsc --noEmit
npm run test        # vitest suite (tests/)
npm run checks      # behavioural checks driving the real managers (sim/checks.ts)
npm run sim         # balance simulator, before/after curve tables (sim/balance.ts)
npm run icons       # re-fetch public/icons/sprite.svg from the pinned manifest (needs network)
```


<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **idle-tower** (6617 symbols, 23119 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/idle-tower/context` | Codebase overview, check index freshness |
| `gitnexus://repo/idle-tower/clusters` | All functional areas |
| `gitnexus://repo/idle-tower/processes` | All execution flows |
| `gitnexus://repo/idle-tower/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
