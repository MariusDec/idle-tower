# Source Code Documentation for AI Agents

**The Tower** is an incremental roguelite tower defence, rebuilt from
scratch on the `rebuild` branch (P0–P9). The design, the phase plan and every
confirmed decision live in [plans/rebuild.md](plans/rebuild.md) — read it
first. [docs/](docs/README.md) has one file per system, describing the code
as it is. TypeScript, Vite, HTML5 canvas and vanilla DOM; Capacitor for
Android.

The old game is the tag `legacy-final` (the last commit of it on `main`);
P9 deleted the `legacy/` copy.

## Layout (plan §12.3)

| Dir | What | May import |
|---|---|---|
| `src/app/` | `main.ts` boot, `App.ts` owner of profile/run/loop/screens, `loop.ts` fixed 1/60 s timestep, `screens.ts` the boot → hub ⇄ run → results state machine, `settings.ts` (the one place settings reach the game: synth, renderer, `data-motion`, `--text-scale`), `bench.ts` (dev frame-budget harness) | anything |
| `src/core/` | `rng.ts` seeded splittable RNG, `math.ts`, `events.ts` typed bus, `spatialGrid.ts`, `format.ts` | nothing outside `core/` |
| `src/content/` | Data tables (`forge.ts` is the Forge web; `bosses.ts`, `relics.ts` (with the relic sets), `feats.ts`, `trials.ts`; `enemies.ts` also holds the elite auras), `balance.ts` (every tunable constant), `arena.ts` (the fixed world), `icons.ts` (generated), `lint.ts` | `core/` |
| `src/sim/` | DOM-free, deterministic: `RunState`, `createRun`, `step` | `core/`, `content/` only |
| `src/meta/` | `profile.ts`, `forge.ts` (adjacency, fog, seals, costs, buy/refund, the "Next:" goal, the tower's tier), `collection.ts` (what is unlocked: regions, frames, relic slots, hub tabs; relics worn and gained, relic sets, overtime trophies), `feats.ts`, `offline.ts` (farm rate, offline tiers and earnings), `goals.ts` (the hub's Next goal), `runConfig.ts` (profile → frozen `RunConfig`), `automation.ts` (Engineering's automation: speed, auto-restart, Frontier March, the Autocaster, the Tactician's lists and draft timer, the Foreman's wishlist), `trials.ts` (Trials: open, chosen, won and paid), `results.ts` (`bankRun`: a finished run into the profile), `save/` (schema, migration ladder, run snapshot, storage backends, `transfer.ts`: export, import and rolling backups) | `core/`, `content/`, `sim/` types |
| `src/render/` | `camera.ts`, `renderer.ts`, `painters/`, `effects.ts`, `palette.ts` (with the colourblind-safe `SAFE_FX`), `quality.ts` (tiers, stored preference, the quality probe). Reads `RunState`, never writes it | `core/`, `content/`, `sim/` types |
| `src/audio/` | `synth.ts` (Web Audio, master/sfx/music buses), `cues.ts` (sim events → sounds), `music.ts` (generative pad by mood and region) | `sim/` types |
| `src/ui/` | DOM: HUD (with the boss bar and the build strip), draft, results, toasts, `hub/` (home, the Forge web, the Map, the Collection, Feats, the Tactician's editor, Stars, Pacts), `settings.ts` (options, the save's export/import/backups, and Stats), `build.ts` (the build's icons, the stats list, tally bars), `controls.ts` (segmented control), modal, icon helper | anything but `sim/` internals |
| `src/platform/` | Capacitor shell hooks; `files.ts` (save a file, pick one, copy text) | — |
| `tools/` | Headless: `parallel.ts` (seeds in worker threads), `calibrate.ts` (T2: the scorer against the sim), `bot.ts` (input policies), `play.ts` (one run under the active or idle policy, with the wall clock), `shop.ts` (the bots' Forge buying), `inspect.ts` (per-wave table), `pacing.ts` (a fresh profile played for hours: runs, Forge buys, reveals, invariants), `idle.ts` (the idle bot's check-ins and the active/idle farm comparison), `act2.ts` (the bot past the Blight: heat, stars, the Abyss), `arsenal.ts` (I4), `contentReport.ts` (icons shared by unrelated entries) | `src/` minus DOM |
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
(`meta/automation.ts`); the one that reaches the sim is the Tactician's list,
as `RunConfig.priority`, which `sim/suggest.ts` follows ahead of its scorer.
The app writes a run snapshot (`tower-run`) at every wave start and resumes
from it on boot; bump `SNAPSHOT_VERSION` in `meta/save/index.ts` when
`RunState` changes shape. A snapshot carries the run count it was taken at,
and the app saves the banked profile before clearing it, so a kill between
the two writes never pays a run twice. Any absence (the page hidden, the
native pause, a stalled frame) settles through `App#absent`: the loop drops
the gap and offline earnings pay (§6.1); the sim is never fast-forwarded.

Settings live in `profile.settings` (volumes, shake, motion, palette, text
size; v8) except the quality tier, which is per device (`localStorage`).
`app/settings.ts#applySettings` applies them all; nothing else reads them
for presentation. Reduced motion is `:root[data-motion='reduce']` in CSS
and `ui/dom.ts#motionReduced` in the UI, never `matchMedia` directly. The
canvas palette is swapped in place (`setPaletteMode`), so never cache an
`FX` *value*; look colours up by name.

In dev builds, `1`/`2`/`3` set sim speed, `globalThis.tower` is the `App`,
and `await tower.bench({ enemies, seconds, tier })` measures frames during
a run (docs/performance.md).

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
npm run pacing -- --hours 12 --seeds 8   # the full Act 1 report: I1a, I1b, I3, I6
npm run pacing -- --idle --hours 12 --seeds 4  # the idle bot: I2 and I5
npm run pacing -- --act2 --hours 12 --seeds 4  # Act 2: heat 1–10 at the frontier
npm run arsenal     # I4: the bot's weapon picks per region
npm run arsenal -- --keystones  # T4: each keystone against none, Regions 3–6; free or trap fails
npm run calibrate   # T2: the scorer's damage estimate against the sim, every weapon and level
npm run inspect -- --seeds 20 --by-weapon  # damage landed by each weapon (T1)
npm run android:release  # release APK (signing: README.md)
npm run icons       # re-fetch public/icons/sprite.svg from the pinned manifest (needs network)
```

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **idle-tower** (3444 symbols, 10929 relationships, 294 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

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
