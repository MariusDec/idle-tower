# Testing & Verification

Three layers, each answering a different question. None requires a browser.

| Command | Tool | Answers |
|---|---|---|
| `npm run typecheck` | `tsc --noEmit` | Does it compile, and is every exhaustive switch still exhaustive? |
| `npm run test` | Vitest | Does each unit behave as specified? |
| `npm run checks` | `sim/checks.ts` | Do the real manager classes, wired together, still behave per the plan? |
| `npm run sim` | `sim/balance.ts` | What does the balance curve look like now, versus before? |

## Vitest suite (`tests/`)

Dev dependency only — the game itself still ships with zero runtime
dependencies. Runs in the `node` environment; nothing under test touches the
DOM.

| File | Covers |
|---|---|
| `formulas.test.ts` | Snapshots of every scaling curve (enemy HP, gold, upgrade cost, AP, TP), the tower XP table, and per-upgrade value curves |
| `save.test.ts` | Save round-trip, the v2→v9 migration ladder, corrupt/future-version rejection, and the debounced write cadence |
| `systems.test.ts` | `SpatialGrid` against a brute-force reference, effect-pool caps and damage-number merging, the upgrade evolution cache against a fresh linear scan |
| `projectiles.test.ts` | Swept collision at every step size the game can produce, first-hit-along-path ordering, and lifetime culling |
| `content-coverage.test.ts` | Every declared talent stat and achievement reward type has a consumer, and no table has dangling prerequisites or duplicate ids |

### Conventions

- **Test the fast path against a reference, not against itself.** The
  optimisations in Part 5 all replaced correct-but-slow code; the risk is a
  subtly different answer, so `SpatialGrid`, the evolution cache and
  `xpToLevel` are each checked against the implementation they replaced.
- **Formula tests use inline snapshots with literal numbers.** A test that
  re-derives the formula it is testing passes regardless of what the formula
  becomes. When a deliberate re-tune moves a snapshot, `npm run sim` is what
  decides whether the new number is right, and the diff is the record.
- **Guard against vacuous assertions.** Tests that walk an optional field
  (`prerequisites`, effect lists) first assert the collection is non-empty, so
  a renamed field fails loudly instead of passing over nothing.
- **Known gaps are pinned, not omitted.** `content-coverage.test.ts` carries a
  `KNOWN_UNGRANTED` list with a test that fails if an entry is fixed, so an
  exemption cannot rot into a permanent excuse.

### Known gap

`all_stats` is read in three places in `Game` but granted by no achievement, so
those reads are permanently zero. Granting it is a balance decision, so it sits
in `KNOWN_UNGRANTED` rather than being quietly tolerated.

### Not yet covered

The plan's "golden stat test" — one fixed `StatContext` in, one resolved stat
block out — needs the pipeline refactor in Part 6. Until eight systems stop
writing into `TowerState` directly there is no single function to assert
against, so `formulas.test.ts` pins the per-upgrade curves those systems
multiply on top of instead.

`Game` itself is not unit-tested: it constructs the renderer and the whole UI
tree in its constructor, so it needs a DOM. Its behaviour is covered by
`npm run checks` (which drives the managers directly) and by in-browser
verification.

## In-browser verification

`window.__theTower` exposes `{ game, bus, ui }`. Useful when the change is
visual or depends on the frame loop:

```js
// Drive the simulation without waiting for real time to pass.
for (let i = 0; i < 3600; i++) window.__theTower.game.update(1/60, 1/60);
```

Two things to know:

- `requestAnimationFrame` does not fire while the browser pane is hidden, so
  the game loop is stopped. Call `game.update(...)` and `game.draw()` directly
  rather than waiting for frames.
- Repeated `getImageData` on the game canvas makes Chrome move it to a software
  backend, which invalidates any timing measured afterwards. Probe pixels or
  measure performance — not both in one page load.
