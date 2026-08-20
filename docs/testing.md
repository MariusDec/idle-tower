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
| `save.test.ts` | Save round-trip, the v2→v10 migration ladder, corrupt/future-version rejection, and the debounced write cadence |
| `systems.test.ts` | `SpatialGrid` against a brute-force reference, effect-pool caps and damage-number merging, the upgrade evolution cache against a fresh linear scan |
| `projectiles.test.ts` | Swept collision at every step size the game can produce, first-hit-along-path ordering, and lifetime culling |
| `content-coverage.test.ts` | Every declared talent stat, achievement reward type, blessing stat/behavior and **enemy type** has a consumer — an enemy needs a paintable renderer shape, a distinct colour, a milestone on its real unlock wave, a named behaviour branch and a spawn weight — and no table has dangling prerequisites or duplicate ids |
| `enemies.test.ts` | The behavioural roster: thief theft/flee/×2 recovery/escape and the per-wave ceiling, blinker cadence and knockback immunity, warden ward absorb/refresh/collapse, burrower untargetability across `Tower.acquireTarget`, projectiles and the ability pickers, siege standoff and `tower_damaged` routing, tank body-block, healer flee, splitter spawn protection, shielded regeneration, priority targeting, the spawn pool and the thief cap |
| `blessings.test.ts` | The in-run draft: offer rules (no duplicates, no maxed or deferred cards, `requires` and wave gates), reroll order, the 30-pick cap, stat summation across stacks, the behavior cache against a linear scan, snapshot/restore |
| `stats.test.ts` | Golden stat resolution: a literal `StatContext` in, a pinned damage/fire-rate/gold/mana figure out, plus clamps, breakdown reconstruction, and one case per bug in Part 1 |

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

### Known gaps

`all_stats` is read by the achievements contributor but granted by no
achievement, so those reads are permanently zero. Granting it is a balance
decision, so it sits in `KNOWN_UNGRANTED` rather than being quietly tolerated.

`knockback_pct` is the same shape on the equipment side: gear can roll it, the
pipeline consumes it, and it still resolves to nothing, because
`knockbackForce` has no additive source anywhere and a multiplier has zero to
multiply. Pinned in `stats.test.ts` under `known-dead content`.

### Golden stat tests

The plan's golden stat test — one fixed `StatContext` in, one resolved stat
block out — landed with the Part 6 pipeline. `tests/stats.test.ts` is the
regression suite for Part 1 as a class: every bug there is now a case that
fails if the composition rule regresses.

- **Damage** composes prestige x achievements x mutator x talents x passives x
  gear, and is asserted to be independent of the order sources are listed in.
- **Fire rate** multiplies all three buff sources instead of letting the last
  writer win (§1.3).
- **Gold** keeps every additive source, scales them by research and
  transcendence, and multiplies the flat sources on top (§1.1, §1.2); the
  breakdown is asserted to multiply back to exactly the applied number.
- **Health regen** survives a recompute during a buff (§1.8), and **max mana**
  survives unlocking a mana passive (§1.7).
- Each once-dead talent stat is asserted to reach a resolved key (§1.4), as are
  the achievement reward types (§1.5).

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
