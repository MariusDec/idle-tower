# Performance

Target: 60 fps on a mid-range Android phone at 375×812, with an evolved
four-weapon build, at 3× speed. Code: `render/quality.ts`,
`app/bench.ts`, `tests/perf.test.ts`, `BALANCE.caps`,
`BALANCE.maxEnemies`.

## Budgets and the techniques behind them (§12.5)

| Budget | How |
|---|---|
| at most 300 live enemies | `BALANCE.maxEnemies`: spawns wait while the field is full |
| capped weapon counts | `BALANCE.caps` (bolts 6, blades 8, drones 8, crescents 6, runes 8, tethers 6, slugs 4); past a cap, count becomes damage |
| pooled effects | `effects.ts`: capped arrays, swap-remove, round-robin overwrite at the cap |
| crowd separation | a spatial grid rebuilt each step (`core/spatialGrid.ts`) |
| enemy drawing | one baked sprite per type and view scale |
| DOM updates | cached setters in `ui/dom.ts`: no write when nothing changed |
| a busy frame | the loop pays at most 12 steps a frame; past that, time is dropped and the game slows rather than freezing |

## Quality tiers

| Tier | Particles | Particle cap | Additive glow | DPR cap |
|---|---|---|---|---|
| high | ×1 | 600 | yes | 2 |
| medium | ×0.5 | 360 | yes | 1.5 |
| low | ×0.25 | 200 | no | 1 |

**Starting tier.** `initialQualityTier()` guesses from device signals:
≥ 8 cores (16 on a touch device) for `high`, ≥ 4 for `medium`, else `low`;
a touch device above DPR 2 is demoted out of `high`. A stored preference
(`the-tower-quality` in `localStorage`, per device) overrides the guess.

**The quality probe.** `QualityProbe`, ported from the legacy game: once
per session, on the first run with the preference on Auto, it drops 30
warm-up frames, then averages two seconds of real frames. Over 17 ms (22
ms when already at `low`) demotes exactly one tier. It gives up if the run
goes above 1×, the page hides mid-measurement or the player picks a tier.
It never promotes: climbing back is the settings' job, and a choice there
stops the probe for good. Settings shows the tier in force under Auto, so a
demotion is visible.

## Measuring

**CI: `tests/perf.test.ts`.** The sim's share of a frame, headless: a run
with every Forge node bought out (the keystones and the endless masteries
aside: `inspect`'s `all` preset), the bot's draft and its evolutions,
against 300 bodies that never fall, 600 steps after a warm-up. It first
checks that every stat is finite: a mastery "bought out" to its endless
last level once made the build kill everything at once, so the field
refilled instead of being shot at. The mean step must stay
under 2 ms on a dev machine; at 3× that is three steps a frame, and a
mid-range phone is several times slower.

**Dev: `tower.bench()`.** In a dev build, during a run:

```js
await tower.bench({ enemies: 300, seconds: 6, tier: 'low' })
// → { tier, frames, p50, p95, worst, drawP50, drawP95, enemies }   ms
```

It keeps `enemies` bodies on the field through the sim's own
`spawnEnemy` (a spread of the region's types, so the sprite cache and every
painter work as a busy wave works them), keeps the tower standing, samples
whole frames from a rAF alongside the loop, drops the first 30 samples,
and times `Renderer.render` itself (`draw*`): at 60 Hz the frame interval
is vsync-clamped at 16.7 ms and hides the slack. It puts the quality tier
back; the run itself is spoiled.

### Measured 2026-10-01 (P9)

Desktop (Chromium, hardware GL), 375×812 viewport, 300 bodies, a level-1
Arcane Bolt tower, 6 s per tier: frames at 16.7 ms (p95 16.8) on every
tier, `Renderer.render` at 0.6–0.7 ms p50 and 0.9–1.1 ms p95.

The sim, headless (Node, same machine): natural late-game runs (Regions
3–6 and the Abyss, the Forge bought out) peak at 50–160 live bodies and
cost 0.01–0.03 ms a step. The synthetic worst case — 300 bodies that never
fall, shot at by a four-weapon build — costs about 0.45 ms a step (p95
0.7 ms). `feedMaws` (Maws feeding on every kill) rejects non-Maws with one
set lookup, so a kill no longer walks the field.

**Caveats.** These are desktop numbers; the phone check (P1's gate, now
with four-weapon evolved builds) is still open.
