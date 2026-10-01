# Testing

`npm test` runs Vitest over `tests/` in the node environment: everything
under test is plain logic over plain objects, so no DOM. `npm run
typecheck` checks `src/`, then `tools/` and `tests/`.

Sim tests drive the real sim (`createRun`, `step`, `applyInput`), usually
with a hand-placed body (`tests/helpers/body.ts`) or the bots in `tools/`;
nothing tests a model of the game.

| File | Covers |
|---|---|
| `sim.test.ts` | determinism (the final-state hash), damage and armour, the overlap rule, wave templates, the P1 gate, fire rates |
| `draft.test.ts` | the stat resolver, XP and levels, offers (no new item for a full slot), the ultimate, determinism with inputs, the P2 gate |
| `arsenal.test.ts` | weapon patterns, count caps, evolutions (offered iff the recipe holds), keystones, the growing pool, the Recipe Book, I4 |
| `enemies.test.ts`, `act1.test.ts` | every region's verbs, elites and auras, Act 1's bosses, frames |
| `bosses.test.ts` | the boss wave and every pattern |
| `behaviours.test.ts` | shard sources, every Forge behaviour |
| `forge.test.ts` | fog and adjacency, costs, buying, refunds, the Next goal, `buildRunConfig`, `bankRun` |
| `collection.test.ts` | unlocks, seals, relics, feats, offline, banking a boss |
| `idle.test.ts` | automation, the Autocaster rule, the Tactician, Frontier March, the kill-safe snapshot, the idle bot |
| `act2.test.ts`, `act2-bot.test.ts` | pacts and heat, Starlight, the Constellations, the Abyss and its enemies; the Act 2 bot |
| `pacing.test.ts` | a CI-sized pacing run: I3, I6 and I1a in the first hour; the idle bot's verdicts |
| `perf.test.ts` | the sim's frame budget against 300 bodies ([performance.md](performance.md)) |
| `content.test.ts` | the content lint: unique ids, icons, names, text ≤ 15 words, effects with consumers, 3 enemies and a boss per region, evolution partners exist, every Forge node reachable |
| `save.test.ts` | save round-trip, every migration rung with a fixture, the run snapshot |
| `screens.test.ts` | the screen state machine |
| `rng.test.ts` | the seeded RNG and its splits |
| `camera.test.ts`, `quality-detect.test.ts` | the view transform; the starting quality tier, the stored preference, the quality probe |
| `palette.test.ts` | palette ↔ tokens agreement, the colourblind-safe palette, no runtime network, no literal colour in `render/` or `ui/` |
| `touch-targets.test.ts`, `z-index.test.ts` | gesture guards and the 44 px floor; the overlay stacking ladder |

## Conventions

- **Name the rule.** `describe` blocks carry the plan section they guard
  (`'wave overlap rule (§4.2)'`).
- **New migration rung ⇒ new fixture** in `save.test.ts`.
- **New `RunState` field ⇒ bump `SNAPSHOT_VERSION`**, and make sure the
  determinism hash still covers it.
- **New content ⇒ the lint** catches missing icons, long text and dangling
  references; add a behaviour test for anything with a rule.
- The full pacing reports are too slow for CI; run them by hand at each
  phase gate ([balancing.md](balancing.md)).
