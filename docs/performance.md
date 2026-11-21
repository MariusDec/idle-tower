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
| enemy motion | gait, squash and pops change only the `drawImage` rectangle; per-body memory in a pooled map; amplitudes halved by 300 bodies ([render.md](render.md#motion)) |
| DOM updates | cached setters in `ui/dom.ts`: no write when nothing changed |
| a busy frame | the loop pays at most 12 steps a frame; past that, time is dropped and the game slows rather than freezing |

## Quality tiers

| Tier | Particles | Particle cap | Additive glow | DPR cap | Motion |
|---|---|---|---|---|---|
| high | ×1 | 600 | yes | 2 | full |
| medium | ×0.5 | 360 | yes | 1.5 | full |
| low | ×0.25 | 200 | no | 1 | lite |

**Starting tier.** `initialQualityTier()` starts every device with ≥ 4
cores at `high`, and anything weaker at `low`; the scaler settles it from
real frames. (The legacy guess, which needed 16 cores on a touch device and
demoted any phone above DPR 2, kept every phone, flagships included, at
`medium` or below.) A stored preference (`blue-hour-quality` in
`localStorage`, per device) overrides the guess and idles the scaler.

**The quality scaler.** `QualityScaler`, while the preference is Auto and
a run is on screen and moving: it drops 30 warm-up frames, then averages
two-second windows of real frames, timing `Renderer.render` alongside.

- A window whose mean frame is over 17 ms drops one tier.
- Three windows in a row under 17 ms *and* under 6 ms mean draw time climb
  one. The frame interval cannot show headroom (vsync clamps it to the
  refresh), so the draw time does; 6 ms leaves room for the next tier's
  roughly doubled fill cost. Canvas raster can land outside `render`, which
  is why the frame interval, not the draw time, decides a drop.
- A tier dropped from may not be retried for 30 measured seconds, then 60,
  120…, for the session: a device on a tier's edge settles below it rather
  than oscillating, and each change rebakes the sprites.
- Under the player's frame cap (below) the budget is the cap's own frame
  plus 2% (`frameBudget`): 34 ms at 30 fps, still 17 ms at 60. A 30 fps
  cap read against 17 ms would drop a tier every two seconds.
- Every change, a hidden page, a paused arena, a new frame cap or a dev
  `bench()` drops the window under way and warms up again. Speeds above 1× are measured: the
  sim's extra steps are part of the frame the player feels.

Settings shows the tier in force under Auto, so the scaler's moves are
visible.

## Measuring

**CI: `tests/perf.test.ts`.** The sim's share of a frame, headless: a run
with every Forge node bought out (the keystones and the masteries
aside: `inspect`'s `all` preset), the bot's draft and its evolutions,
against 300 bodies that never fall, 600 steps after a warm-up. It first
checks that every stat is finite: a mastery "bought out" to its endless
last level once made the build kill everything at once, so the field
refilled instead of being shot at. The mean step must stay
under 2 ms on a dev machine; at 3× that is three steps a frame, and a
mid-range phone is several times slower.

**Dev: `tower.bench()`.** In a dev build, during a run:

```js
await tower.bench({ enemies: 300, seconds: 6, tier: 'low', motion: 'base' })
// → { tier, motion, frames, p50, p95, worst, drawP50, drawP95, enemies }   ms
```

`motion` (optional) overrides the enemy animation for the measurement:
`off` is the look before it (reduced motion's), `base` the tier's own,
`lean` the tilt still on trial (until it exists, the same as `base`).
Unset, the player's setting holds. The bench puts it back afterwards.

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

### Enemy motion (to measure)

The enemy and boss animation landed on 2026-11-20 without a measurement;
its check is step 7 of [plans/enemy-animation.md](../plans/enemy-animation.md)
(§10): `off` against `base` (and `lean`) on each tier at 300 bodies, on
desktop with 4× CPU throttling and on a mid-range phone, plus a two-minute
soak on Auto. `base` passes if it adds at most 0.15 ms `drawP95` over `off`
on `low` on the phone, with the frame `p95` unchanged. The numbers go here.

## Frame cap

Settings › Display › Frame rate: 30, 60 (the default) or Device (R5 §2).
`Loop.setFrameCap` skips vsyncs that come sooner than the cap's interval
(less 2 ms of slack for rAF's jitter), and stamps each drawn frame on the
ideal grid (`capGate`: one interval on from the last, not `now`), so a
display that is no multiple of the cap still averages it: 90 and 144 Hz
under 60 draw 60, 120 Hz under 30 draws 30. A skipped vsync banks no time,
so the next drawn frame pays out both frames' sim steps, each still
`SIM_DT`: the sim, and so every bot reading, is the same at any cap.
Measured in the browser on a 60 Hz display: 30 / 60 / 60 draws a second at
30 / 60 / Device; a run at 30 kept its sim rate and stayed on `high`.

On a 120 Hz phone the default halves the GPU's work against Device. The
battery and temperature it saves are part of the phone check.

## Screen kept on in runs

Settings › Display › Screen on (R5 §4), default On: the screen stays awake
while a run's arena moves, and keeps the device's timeout in the hub, on
the results, when paused and while a choice holds the arena. A hands-off
run is a designed way to play (Stored Light's ×2 left alone), and a screen
that sleeps hides the page, which pauses the run; so On is the default and
the battery cost is what the frame cap is for. `platform/awake.ts` asks
the web's Screen Wake Lock in a browser, and inside the Android app the
game's own `ScreenAwake` plugin (`ScreenAwakePlugin.java`), which sets the
window's `FLAG_KEEP_SCREEN_ON`: a WebView need not grant the web lock, and
the flag needs no permission. A refusal is asked again after 30 s or on
the page's return, not every frame.

## The hub's `tile memory limits exceeded`

Chromium's compositor logs it when the tiles a frame needs exceed the GPU
memory budget, which the WebView sizes from the device; it is not
reproducible on a desktop, and was not reproduced for R5. What the hub
composites, read in the browser at 375×812 on a post-Blight profile
(seed 2): the canvas (563×1218 at Android's 1.5 cap), the tab bar's glass
(`backdrop-filter` on `high`, over a canvas redrawn every frame), and
three long scrollers: the Feats list (5869 px of content), the Collection
(3925 px) and the Map (2073 px). No view keeps an infinite animation on a
large element; the Forge's only one is a node's 72×62 hint. Hidden hub
views are `display: none` and cost no tiles.

To place it on the phone (part of the phone check): `adb logcat | grep -i
tile` while opening each hub view in turn, then again on Quality › Low (no
glass). If it follows the Feats or the Collection, the next step is
`content-visibility: auto` on their entries; if it follows the glass, no
`backdrop-filter` on Android, as the arena already has none.
