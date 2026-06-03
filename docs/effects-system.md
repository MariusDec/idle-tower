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
1. Background particles
2. Shockwaves
3. Enemies
4. Projectiles
5. Front particles (non-white)
6. Damage numbers
