# Effects System

**File:** `src/systems/EffectsManager.ts`

## Overview

Manages transient visual effects: particles, floating damage numbers, and expanding shockwave rings.

## Constants

| Constant | Value | Description |
|----------|-------|-------------|
| PARTICLE_GRAVITY | 320 | Downward acceleration |
| PARTICLE_DRAG_PER_SEC | 0.55 | Velocity decay factor |
| DMG_RISE_SPEED | 74 | Upward rise at birth, in **CSS px/s** |
| DMG_RISE_DECAY | 0.35 | Per-second exponential decay on the rise |
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

## Damage Numbers (UI plan §5.B)

A damage number is **anchored in the world and typed in screen space**. `x, y`
is a world point fixed at emit time; `riseCss` is how far the label has risen in
CSS pixels. `EffectsManager` integrates the rise (CSS px is unit-agnostic, so it
needs no camera), and the renderer projects the anchor with
`camera.worldToScreen` and subtracts the rise. Before this the type was drawn at
world scale and came out around 12 CSS px at the desktop zoom — smaller than the
smallest HUD label.

**Camera shake.** Screen space is *outside* the shake translate, so damage
numbers no longer shake with the world. That is deliberate, not a regression:
jittering text is unreadable.

**Kind.** `kind: 'damage' | 'heal' | 'gold' | 'mana' | 'self'` replaces the old
`isHeal` boolean and decides the colour: `damage` runs the ink→gold ramp,
`heal` is `FX.nature`, `gold` is `FX.gold`, `mana` is `FX.mana`, and `self`
(anything happening to the tower — a hit, a wall absorb, a dodge) is
`FX.critical`, the one colour that means "the tower is in peril". Gold and mana
pickups used to be mis-coloured — gold passed "was a full-value pickup" as
`isCrit` and mana went through the heal path — which this fixes.

**Tier.** `damageTier(amount, maxHp)` buckets a hit at 6 % / 20 % / 50 % of the
target's max HP into 0–3, which drives size (`[15, 18, 22, 28]` CSS px, crits
× 1.28) and the last two colour steps. A caller with no denominator — a heal, a
pickup — gets tier 0. `self` and `gold` are pinned to the flatter
`[15, 15, 17, 19]` ramp so the tower's own numbers never out-shout an enemy's.

**Motion.** A pop-then-settle curve rather than a linear float: `easeOutBack`
from 0.62 to ~1.15 over 0.09 s, then eased back to 1.0 over 0.13 s. Crits scale
the whole curve by 1.25 and get a chromatic edge — the glyph drawn twice
source-over under the fill, once left in `FX.critical` and once right in
`FX.frost`. Jitter is `(1 - lifeRatio) * ((amount % 7) - 3) * 0.8` CSS px, crits
excluded.

## Tick Physics

- Particles: apply gravity, drag, remove when `age >= life`
- Damage numbers: accumulate `riseCss` (CSS px), rise speed decays by `pow(0.35, dt)`, remove when expired
- Shockwaves: expand radius linearly from 0 to max, remove when expired

## Rendering

Renderer draws in layers:
1. `behind` particles
2. Enemies
3. Projectiles
4. `front` particles
5. The additive pass (UI plan §5.A)

Damage numbers are painted in the **screen** block instead, after
`camera.applyScreen` and before the wave banner.

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
merged into it: the amount is added, the tier is promoted to the higher of the
two, and `age` resets so the pop re-runs — a growing total should visibly bump.
`riseCss` is **deliberately not reset**; resetting it would teleport the label
back down onto the enemy. `tests/effects.test.ts` pins that. Merging is matched
on `kind` as well as crit, so a heal never folds into a hit.
