# Rendering

Code: `render/renderer.ts`, `render/painters/`, `render/effects.ts`,
`render/camera.ts`, `render/palette.ts`, `render/quality.ts`. The renderer
reads a `RunState` and never writes it.

## A frame

`Renderer.consume(run)` turns the frame's sim events into effects, shakes
and banners (an exhaustive switch over `SimEvent`). `Renderer.render(run,
alpha, realDt)` then draws, interpolating every body and shot `alpha` of
the way between its last two positions:

1. the baked arena background (rebaked on resize or a new region's tint)
2. world space: range ring, rings, fires, runes, pools, enemies, status
   marks, the boss and its court and facets, hostile shots, the arsenal
   (orbits, drones, beams, tethers), the tower, Aegis, projectiles, world
   effects
3. screen space: damage numbers, the low-HP vignette, banners (boss intro,
   phase lines, Region cleared, Evolved)

With no run (the hub) the arena and a quiet tower still draw as the
backdrop.

## Painters

| Painter | Draws |
|---|---|
| `arena.ts` | the baked ground: tint, light, rim |
| `tower.ts` | the tower by tier (N2: a stone course, banners, a gilt edge, buttresses, lamps, a crown of light, one stage per Forge ring), a light per trophy (N4), the Trials' trims (N5), its mounts (one per weapon, aimed), hurt flare, fall |
| `enemies.ts` | bodies from a sprite cache per type and view scale, moved by their gait style, squash, hit squish and pops (see Motion below), elite halos by aura (a Champion's in its region's boss colours too, N4), shields, shells, wards, slows, hit flash, HP bars |
| `bosses.ts` | the boss in its pose, with its wind-up tells, follow-through and gaze (see Motion below), its court, facets, pools, hostile shots, Aegis |
| `projectiles.ts` | one look per weapon; crits burn gold |
| `arsenal.ts` | weapons that are not projectiles: orbits, drones, beams, tethers, runes, fires, statuses |

The tower's look (`TowerLook`) is the profile's, not the run's: the app
sets it with `Renderer#setTower` (from `towerTier`, `trophyCount` and
`trims`) on every screen change and purchase. The hub's backdrop tower
mounts the selected frame's starting weapon at its tier's level.

Enemy sprites are baked once per type at the current scale and dropped
when the scale changes. Colours are cached by *name*, never by value (see
the palette below).

## Effects

`effects.ts` (ported and trimmed from the legacy `EffectsManager`):
particles, rings, crit numbers, lightning arcs and XP motes, each in a
capped array; expired particles are swap-removed and, once the cap is
reached, new ones overwrite round-robin, O(1) however busy the fight.
Everything runs on the wall clock and may use `Math.random`; none of it
reaches the sim.

Damage numbers show **crits only** (§10.2). Crits landing on one spot
within 0.15 s add into one number, formatted with `formatNumber` so Abyss
damage reads as `1.2Qa` rather than twenty digits.

## Juice (§10.3)

| Moment | Effect |
|---|---|
| hit | sparks, a white flash on the body, knockback where the weapon has it |
| crit | gold sparks and a popping number |
| kill | a burst in the type's colour, an XP mote into the tower |
| level-up | a gold ring rolling out from the tower |
| new weapon | a pulse where its mount appears |
| evolution | a 1 s spotlight closing on the tower, the "Evolved" banner |
| Nova, revive, fall | shockwaves, zoom punch, shake |
| boss | letterboxed intro, phase lines with a hit-stop, a slow killing blow |
| low HP | a scarlet vignette that deepens below 35% |

## Motion

See [plans/enemy-animation.md](../plans/enemy-animation.md). Code:
`render/motion.ts` (the enemy curves and the `MOTION` table, pure),
`render/bossMotion.ts` (`BossAnimator`, `BOSS_MOTION`, `BOSS_POSE`, pure),
`painters/enemies.ts`, `painters/bosses.ts`. Presentation only: it reads
the wall clock, `e.id` (or `e.group`, so a Chorus hops as one) and
render-side state, never the sim's RNG, and never sets `dirty`, so a paused
arena still settles and freezes it.

**The level.** `MotionLevel` is derived once whenever the tier or the
setting changes (`Renderer.pushMotion`), never per body: `reduced` under
reduced motion, whatever the tier; otherwise `QUALITY[tier].motion`, which
is `full` on `high` and `medium` and `lite` on `low`. A lower level only
drops animations, it never swaps in different ones:

| Animation | high | medium | low | reduced motion |
|---|---|---|---|---|
| gait style offsets (dx, dy) | ✓ | ✓ | ✓ | the plain bob of before |
| gait squash and stretch | ✓ | ✓ | — | — |
| easing into and out of the gait | ✓ | ✓ | — (snaps) | — |
| hit squish | ✓ | ✓ | ✓ (half amplitude) | — (flash only) |
| pop walking in from the dark (from `rise`) | ✓ | ✓ | ✓ | — (fade only) |
| pop appearing inside the light (from time) | ✓ | ✓ | — | — |
| crowd damping | ✓ | ✓ | ✓ | n/a |
| boss poses | ✓ | ✓ | ✓ | wind-up compression and stagger droop only |
| slam afterimage | ✓ | — | — | — |
| boss wind-up tells | ✓ | ✓ | ✓ | ✓ (driven by progress) |
| boss follow-through | ✓ | ✓ | — | — |
| boss gaze | ✓ | ✓ | — | — (pupils centred) |

**Regular enemies.** `GAIT` gives each type a style, a frequency and an
amplitude: `hop` (an arc, flattening on landing, stretching at the apex),
`waddle` (a sideways sway with a dip and a light squash each step),
`slither` (a wave across the heading), `float` (a slow Lissajous drift) and
`skitter` (smooth sums of sines, never `Math.random`, which would flicker
between interpolated frames). Squash is one signed amount turned into
area-preserving scales (`sy = 1 − q`, `sx = 1/(1 − q)`, held to
`[0.85, 1.18]`), anchored at the sprite's foot, so it costs nothing but a
different `drawImage` rectangle. Every amplitude is damped by the crowd:
full up to 60 bodies, half at 300. Halos, shields, shells, rings and the HP
bar follow the offset only, so they stay crisp; the hit flash, an ellipse,
follows the squash too.

The painter keeps a little memory per body, never in the sim: a track map
by id, its entries pooled and swept every 30 frames, cleared by
`EnemyPainter.reset()` when a run is attached. It holds the gait's eased
weight, the hit squish's re-arm (a damped spring over 0.16 s, started at
most every 0.2 s, so a body under a beam pulses rather than sticking) and
what a pop inside the light watches for: first sight already in the light
(Splitter fragments, imps, Chorus), a Burrower surfacing, a shade rising, a
Blinker landing (a jump of more than 3 radii in one frame, watched on `blink`
bodies only, so a knockback never pops). The first frame after a reset seeds every body without a
pop, so a resumed save doesn't pop the whole field.

**Bosses.** A boss is drawn live, so its "frames" are poses: the
`BossAnimator` takes the boss events from `consume` (arrive, wind-up, slam,
phase, submerge, emerge) and reads the boss each frame (wind-up progress,
stagger, enrage, moving, hit), and returns one `BossPose`. The walk runs
underneath per its `BOSS_MOTION` character (stomp, lurch, glide, slide,
pulse, roll); the event poses add on top, clamped to ±25% scale and ±0.08
shear. `paintBoss` draws the shadow with the offset and `sx` only, then
puts the pose on as one transform anchored at the base: body, detail,
stroke, flash and glow go through it unchanged, and no pose adds a trace
(but the `high`-only afterimage on a slam). The Prism's facets follow the
offset; Forgeheart's plates are their own bodies and don't, which is why
its lunge is the shortest. The pose also carries the parts:

- **tell** (wind-up progress): what the charging part shows, at every tier
  and under reduced motion, since it carries information. See
  [bosses.md](bosses.md#presentation).
- **lag**: one damped spring per boss driven by the pose; it lifts the
  top-side samples of `PROFILE`, so a crown or crest wobbles a beat behind a
  landing.
- **gaze**: pupils that drift toward the nearest live projectile, or the
  tower, and lock on during a wind-up.

**The bench.** `tower.bench({ motion })` overrides the level for a
measurement: `off` forces `reduced` (the look before all this), `base` the
tier's own level. `lean` is reserved for the tilt in the plan's option 5
and, until that path exists, measures the same as `base`. See
[performance.md](performance.md#measuring).

## The light, the dark and the rim

See [plans/camera-and-fog.md](../plans/camera-and-fog.md). The arena is an
oval of light (`content/arena.ts`): its short half-axis `L` is
`RunState.stats.light` (`max(L_base, range + margin)`, dimmed by a
Fog-caller), and its shape is `RunState.arena`, the stage's own, taken
once when the run starts (`Renderer.stageOval` → `RunConfig.arena`;
headless tools use `PHONE_OVAL`). Enemies spawn just past the rim, and
`targetable` refuses anything outside it: what the tower can hit is lit.

On a large stage the oval squares off (plans/large-screens.md §5): the
shape is a superellipse `|x/a|ⁿ + |y/b|ⁿ = 1` with `n` in `Oval.n`, 2 on
every `compact` stage (a phone's ellipse, its arithmetic unchanged), 3 on
`medium` and `expanded`, 4 on an `expanded` stage of aspect ≤ 1.4
(`stageSquareness`; dev `?fog=2|3|4` forces it). Everything on the rim
goes through `rimPoint`; `inLight` grows the axes by `2^(1/n − 1/2)·r`
for n > 2, exact on the diagonal and safe on the axes. The run's opening
and each boss come from the ends of the short axis (`shortEnds`), so a
wide light starts as soon as a tall one. The Daily Omen and the headless
tools play `PHONE_OVAL`; `tools/pacing.ts --arena` plays another stage's.

`painters/arena.ts` draws it live in world units: the lit
ground, the faint guides, then — after bodies, shots and effects — the dark
past the rim (a soft gradient over the bodies, so they walk out of it) and
the thin violet rim with its glow. For n > 2 the ground is the same
gradient clipped to the shape, the rim and guides stroke a cached `Path2D`,
and the dark is a 512² texture baked once per squareness and palette in rim
units and stretched over the rim. `emergence` fades a body in over its
first steps in from the spawn line. Thin lines (rim, guides, range ring)
are sized in CSS pixels, so they stay thin at any zoom.

## Camera

`camera.ts` sets the backing store at `min(devicePixelRatio, dprCap)`,
lowered on a large screen to the tier's pixel budget (`PIXEL_BUDGET`: 4,
2.5 or 1.5 MP, never below DPR 1), and holds one value, the **extent**: world units from the tower to the stage's
short edge. Fully out (`fitExtent`), the rim sits just inside the stage's
sides and level with the HP bar at each end of the long axis (`rimBox`),
and the camera eases after the light as it grows. On a `medium` or
`expanded` stage the fit draws the base light at no more than
`RIM.maxScale` (0.6 CSS px per world unit), so bodies sized for a phone
don't draw 2–3× bigger; the rim box shrinks uniformly and the dark and the
sky take the margin. `setInsets({ right })` takes out what the hub's docked
panel covers: the tower eases to the centre of the rest. Manual zoom
(`ui/zoom.ts`: pinch, wheel, trackpad pinch; the HUD's `+ / −` with a
mouse and a Fit chip while zoomed in) frames as close as `ZOOM.close` (270);
the framing is kept at the base light and grows with it, so as range pushes
the fog back the camera draws back too, and near fully out it snaps back to
following. Always centred on the tower, no panning. The framing is a setting (`settings.framing`, v12).
While zoomed in, a marker on the stage's edge points at an off-screen boss.
Enemy sprites bake at the view scale rounded up to a step of √2, so a
pinch never rebakes every frame.

It owns the screen shake (decays over 0.42 s, capped at 30 world units,
divided by the zoom; a stronger shake wins rather than stacking) and the
zoom punch (3% for 180 ms). Both run on the wall clock.
`setMotion(reduced, shake)` turns them off: reduced motion stops both and
makes zoom changes instant, the shake switch stops shake only.

## The ground's colours

The canvas shares the DOM's ground (plans/visual-identity.md §7). `INK`
(and `--ink-*`) is the Blue hour family: navy-indigo darks and
lavender-grey lights, at the old blue-grey ramp's lightness steps, so no
`FX` colour lost contrast against it. Inside the light the ground is the
same radial (ink 600 → 800 mixed with the region's tint). Outside it, the
dark is the Last light gradient (`GROUND`: the three Blue hour stops and the
region's last light), dimmed by the fog, one memoised linear fill; the
Abyss keeps its darker mix (`ABYSS_DARK`). The rim is the identity's
violet (`ACCENT`, `--accent`), and the boss intro's letterbox bars are the
indigo stop at 92%.

## Palette

`palette.ts` is the single source of colour. `FX` (the effect colours by
meaning: gold is the player's, violet arcane, red enemies only, scarlet the
tower in danger), `INK` (the ground's ramp) and `RARITY` are mirrored as
CSS tokens in `styles/tokens.css`; `tests/palette.test.ts` fails if they
drift or a literal colour appears in `render/` or `ui/`.

`Renderer.setPalette('safe')` swaps `FX` in place for `SAFE_FX`
(`setPaletteMode`), the colourblind-safe set (Okabe & Ito, Paul Tol):
weapon families apart in lightness and on the blue–yellow axis. It is
canvas-only; the DOM keeps its tokens. Painters read `FX` when they draw,
so the swap shows on the next frame — which is why nothing may cache an
`FX` *value* (look it up by name, as `AURA_COLOR` does). What is baked from
`FX`, the enemy sprites, the renderer drops on a swap, and they rebake on
the next frame; the ground's gradients are keyed by palette.

## Quality

`quality.ts` defines three tiers: particle scale and cap, the additive
glow pass, the DPR cap, and how much enemy motion runs (`motion`, see
Motion above). See [performance.md](performance.md).
