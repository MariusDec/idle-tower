# Source Code Documentation for AI Agents

**The Tower** is an incremental roguelite tower defence, being rebuilt from
scratch on the `rebuild` branch. The design, the phase plan and every
confirmed decision live in [plans/rebuild.md](plans/rebuild.md) — read it
first. TypeScript, Vite, HTML5 canvas and vanilla DOM; Capacitor for Android.

The old game is kept in `legacy/` as a porting reference until P9 (tag
`legacy-final` is the last commit of it on `main`). `legacy/` is excluded
from tsconfig, Vite and Vitest; never import from it.

## Layout (plan §12.3)

| Dir | What | May import |
|---|---|---|
| `src/app/` | `main.ts` boot, `App.ts` owner of profile/run/loop/screens, `loop.ts` fixed 1/60 s timestep, `screens.ts` the boot → hub ⇄ run → results state machine | anything |
| `src/core/` | `rng.ts` seeded splittable RNG, `math.ts`, `events.ts` typed bus, `spatialGrid.ts`, `format.ts` | nothing outside `core/` |
| `src/content/` | Data tables (`forge.ts` is the Forge web; `bosses.ts`, `relics.ts`, `feats.ts`; `enemies.ts` also holds the elite auras), `balance.ts` (every tunable constant), `arena.ts` (the fixed world), `icons.ts` (generated), `lint.ts` | `core/` |
| `src/sim/` | DOM-free, deterministic: `RunState`, `createRun`, `step` | `core/`, `content/` only |
| `src/meta/` | `profile.ts`, `forge.ts` (adjacency, fog, seals, costs, buy/refund, the "Next:" goal), `collection.ts` (what is unlocked: regions, frames, relic slots, hub tabs; relics worn and gained), `feats.ts`, `offline.ts` (farm rate, offline earnings), `goals.ts` (the hub's Next goal), `runConfig.ts` (profile → frozen `RunConfig`), `automation.ts` (Engineering's speed, auto-restart, offline), `results.ts` (`bankRun`: a finished run into the profile), `save/` (schema, migration ladder, run snapshot, storage backends) | `core/`, `content/`, `sim/` types |
| `src/render/` | `camera.ts`, `renderer.ts`, `painters/`, `palette.ts`, `quality.ts`. Reads `RunState`, never writes it | `core/`, `content/`, `sim/` types |
| `src/ui/` | DOM: HUD (with the boss bar), draft, results, toasts, `hub/` (home, the Forge web, the Map, the Collection, Feats), modal, icon helper | anything but `sim/` internals |
| `src/platform/` | Capacitor shell hooks | — |
| `tools/` | Headless: `bot.ts` (input policies), `inspect.ts` (per-wave table), `pacing.ts` (a fresh profile played for hours: runs, Forge buys, reveals, invariants) | `src/` minus DOM |
| `tests/` | Vitest, node environment | — |

The sim's step order (`sim/run.ts`): input → waves place bodies (wave 20 is
the boss, `systems/boss.ts`; overtime follows) → the boss acts → enemies walk
and act on their verb (hit the wall, lob a shot, mend) → separation spreads
crowds (tangentially at the wall) → weapons fire → projectiles fly and kill
(kills feed XP, shards and the ultimate; a Splitter bursts, an elite's aura
has its last word and may drop a relic; reaching a wave pays for the last) →
hostile shots and shockwaves land (`systems/tower.ts#hurtTower` is the one
way the tower takes damage) → the dead are swept → a banked draft opens →
the tower regenerates, rises on Second Wind, or falls.
Presentation learns what happened from `RunState.events`, which the app hands
to the renderer and clears each frame.

The draft never stops the sim: the sim offers cards (`systems/draft.ts`) and
`sim/suggest.ts` scores them; the app runs the arena at 15% while a draft is
open, times it out onto the suggestion, and pauses only for the very first
draft of a profile. Picks and the ultimate go through `applyInput`, between
steps. Stats are resolved by `sim/stats.ts` from `StatMod`s, once at run start
and again whenever a passive changes.

The meta loop: `meta/results.ts#bankRun` is the one place a run's rewards
reach the profile (the app and the pacing bot both call it): shards,
records, the boss's trophy and first-kill relic, relics found, feats earned
and the list of what opened up. A first boss kill sets `profile.ceremony`,
and the results screen leads to the Map, where the light spreads. The Forge's
rules live in `meta/forge.ts`; `buildRunConfig` applies every owned node's
effects once per level. `behaviour` effects become `RunConfig.behaviours`
counts the sim reads; `automation` effects are the app's
(`meta/automation.ts`). The app writes a run snapshot (`tower-run`) at every
wave start and resumes from it on boot; bump `SNAPSHOT_VERSION` in
`meta/save/index.ts` when `RunState` changes shape.

In dev builds, `1`/`2`/`3` set sim speed and `globalThis.tower` is the `App`.

## Rules that keep the sim honest

- `sim/` has no DOM, no `Date.now`, no `Math.random`. Randomness comes from
  `core/rng.ts`, one `split(label)` stream per system. Same config + seed +
  inputs ⇒ same run; `tests/` hashes the final state to prove it.
- Nothing tunable lives in `sim/` code: numbers go in `content/balance.ts` or
  per-item data.
- Effects are data (a tagged union) with exhaustive consumers ending in `never`.
- Colours come from `render/palette.ts` or `--tokens` in `styles/tokens.css`;
  `tests/palette.test.ts` fails on a literal colour in `render/` or `ui/`.
- Every screen is checked at 375×812 first (D4).

## Commands

```bash
npm run dev         # vite dev server
npm run build       # tsc + vite build
npm run typecheck   # src, then tools + tests
npm test            # vitest suite (tests/)
npm run inspect -- --seed 7   # one bot-drafted run → per-wave table (level, DPS, pool, clear time, carried, damage taken)
npm run inspect -- --seeds 50 # many runs → death waves, level-up pace, loadouts
npm run inspect -- --seeds 50 --bare  # the same, for a level-1 tower that never drafts
npm run inspect -- --seeds 50 --forge ring1  # the same with a Forge preset: none, arsenal (P2's loadout), ring1, all
npm run inspect -- --seed 3 --forge all --region 2  # a run in another region (its rule applies), with the boss's time
npm run pacing      # a fresh profile, one simulated hour: run table, reveal timeline, I1a / I3 / I6 / wave-20 verdicts
npm run pacing -- --seeds 8 --hours 1.5   # eight profiles: pass counts, median first wave 20 and first boss kills (the P3 and P4 gates' readings)
npm run icons       # re-fetch public/icons/sprite.svg from the pinned manifest (needs network)
```

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **idle-tower** (8122 symbols, 29155 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

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
