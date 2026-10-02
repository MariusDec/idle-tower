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
| `enemies.ts` | bodies from a sprite cache per type and view scale, gait, elite halos by aura (a Champion's in its region's boss colours too, N4), shields, shells, wards, slows, hit flash, HP bars |
| `bosses.ts` | the boss, its court, facets, pools, hostile shots, Aegis |
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

## Camera

`camera.ts` fits the fixed world (`content/arena.ts`) to the stage at
`min(devicePixelRatio, dprCap)`, and owns the screen shake (decays over
0.42 s, capped at 30 world units; a stronger shake wins rather than
stacking) and the zoom punch (3% for 180 ms). Both run on the wall clock.
`setMotion(reduced, shake)` turns them off: reduced motion stops both,
the shake switch stops shake only.

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
`FX`, the arena's ground and the enemy sprites, the renderer drops on a
swap, and they rebake on the next frame.

## Quality

`quality.ts` defines three tiers: particle scale and cap, the additive
glow pass, the DPR cap. See [performance.md](performance.md).
