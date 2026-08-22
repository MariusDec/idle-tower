# Effects System

**File:** `src/systems/EffectsManager.ts`

## Overview

Manages transient visual effects: particles, floating damage numbers, and expanding shockwave rings.

## Constants

| Constant | Value | Description |
|----------|-------|-------------|
| PARTICLE_GRAVITY | 320 | Downward acceleration |
| PARTICLE_DRAG_PER_SEC | 0.55 | Velocity decay factor |
| DMG_FLOAT_SPEED | 48 | Upward float speed |
| DMG_BASE_LIFE | 0.85 | Normal damage number lifetime |
| DMG_CRIT_LIFE | 1.25 | Critical damage number lifetime |
| SHOCKWAVE_SPEED | 700 | Expansion speed |

## Particle Types

| Method | Description |
|--------|-------------|
| `emitHitSparks(x, y, color, count)` | Burst of small particles on enemy hit |
| `emitDeathBurst(x, y, color, radius)` | Larger burst on enemy death |
| `emitBossDeathShockwave(x, y)` | Ring of particles on boss death |
| `emitRainOfArrows(cx, cy)` | Falling arrow particles |
| `emitFrostNovaRing(cx, cy)` | Expanding ice ring particles |
| `emitBerserkPulse(cx, cy)` | Short-lived red burst |
| `emitGoldRushSparkle(cx, cy)` | Rising golden sparkles |
| `emitShockwaveRing(cx, cy, radius)` | Expanding ring shockwave effect |

## Damage Numbers

- Created on enemy hit (`emitDamageNumber`)
- Float upward with velocity decay
- Crit numbers: larger font, yellow color, exclamation mark, longer life
- Jitter offset based on `amount % 7` for visual variety

## Tick Physics

- Particles: apply gravity, drag, remove when `age >= life`
- Damage numbers: float upward, velocity decays by `pow(0.35, dt)`, remove when expired
- Shockwaves: expand radius linearly from 0 to max, remove when expired

## Rendering

Renderer draws in layers:
1. `behind` particles
2. Enemies
3. Projectiles
4. `front` particles
5. The additive pass (UI plan §5.A)
6. Damage numbers

### The additive pass

A particle carries a `layer` field — `'behind' | 'front' | 'additive'` — and
`pushParticle` stamps `'front'` on anything an emitter left blank. The renderer
routes on that field; it no longer sniffs the colour string to decide what sits
behind the enemies.

`Renderer.drawAdditivePass` is the single `globalCompositeOperation = 'lighter'`
block in the frame. It paints, in order: `additive` particles, shockwaves, chain
lightning, tracers, the muzzle flash — everything that is *light* rather than
matter. Additive particles fade on `pow(lifeRatio, 1.6) * 0.85` rather than
`lifeRatio`, because additive over a near-black ground blows out fast.

Rules for a new emitter:

- Ground haze and smoke that must sit under the enemies: `'behind'`.
- Debris, shards, sparks, slashes — matter: `'front'` (the default).
- Glows, novas, auras, sparkles — light: `'additive'`.
- Nothing on the additive pass may draw at full alpha in near-white at a radius
  over ~24 world units. Big soft puffs stay on `'behind'`.

## Pool Caps (plan §5.3)

Both pools are bounded and evict oldest-first:

| Pool | Cap |
|---|---|
| `particles` | 600 |
| `damageNumbers` | 80 |

Every emitter routes through `pushParticle` / `pushDamageNumber`. **Pushing
directly onto the arrays defeats the cap** — a new emitter must use the
helpers.

Damage numbers landing within 16 px of a live one younger than 0.22 s are
merged into it: the amount is added and the float restarts, so a fast tower
putting six shots into one enemy shows one climbing number rather than six
overlapping labels. Merging is matched on kind, so crits and heals keep their
own (differently coloured) labels.
