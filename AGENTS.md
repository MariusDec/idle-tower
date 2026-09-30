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
| `src/content/` | Data tables, `balance.ts` (every tunable constant), `arena.ts` (the fixed world), `icons.ts` (generated), `lint.ts` | `core/` |
| `src/sim/` | DOM-free, deterministic: `RunState`, `createRun`, `step` | `core/`, `content/` only |
| `src/meta/` | `profile.ts`, `runConfig.ts` (profile → frozen `RunConfig`), `save/` (schema, migration ladder, storage backends) | `core/`, `content/` |
| `src/render/` | `camera.ts`, `renderer.ts`, `painters/`, `palette.ts`, `quality.ts`. Reads `RunState`, never writes it | `core/`, `content/`, `sim/` types |
| `src/ui/` | DOM: HUD, screens, modal, icon helper | anything but `sim/` internals |
| `src/platform/` | Capacitor shell hooks | — |
| `tools/` | Headless: `inspect.ts` (per-wave table), `pacing.ts` (from P3) | `src/` minus DOM |

The sim's step order (`sim/run.ts`): waves place bodies → enemies walk and hit
the wall → separation spreads crowds (tangentially at the wall) → weapons
fire → projectiles fly and kill → the dead are swept → the tower regenerates
or falls. Presentation learns what happened from `RunState.events`, which the
app hands to the renderer and clears each frame.

In dev builds, `1`/`2`/`3` set sim speed and `globalThis.tower` is the `App`.
| `tests/` | Vitest, node environment | — |

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
npm run inspect -- --seed 7   # one seeded run → per-wave table (pool, clear time, carried, damage taken)
npm run inspect -- --seeds 50 # many runs → first-kill time and death-wave distribution
npm run pacing      # pacing report (stub until P3)
npm run icons       # re-fetch public/icons/sprite.svg from the pinned manifest (needs network)
```

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **idle-tower** (7485 symbols, 26476 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

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
