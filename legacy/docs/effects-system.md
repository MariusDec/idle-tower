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
| `emitRicochetFlash(x, y, inAngle, outAngle, color)` | A bounce deflection: bright ring, a spark lance along the outgoing heading, a thin back-spray along the incoming one |
| `emitSplinterBurst(x, y, shards)` | Gold/white starburst at a Splinter kill point, scaled by shard count |

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
| `particles` | `QUALITY[tier].maxParticles` — 600 at `high` |
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

## The quality knob (UI plan §5.F)

`src/data/quality.ts` holds one profile per tier (`high` / `medium` / `low`) and
nothing else. `Game.setQuality(tier)` fans it out: `EffectsManager.setQuality`
takes `particleScale` and `maxParticles`, `Renderer.setQuality` takes `decals`,
`embers`, `additive`, `bgLayers` and `shadows`. Part 9 owns the Settings
control, the auto-detect and `dprCap`; the default is `high`, where every
multiplier is 1 and nothing changes.

| Field | Effect |
|---|---|
| `particleScale` | multiplies every emitter's count, via `EffectsManager.n()`, never below 1 |
| `maxParticles` | the pool ceiling; lowering it splices the oldest off immediately |
| `additive` | `false` runs the §5.A pass as `source-over` instead of `lighter` |
| `decals` / `embers` | pool ceilings in the renderer; `0` stops the push entirely |
| `bgLayers` | `2` skips `bakeTerrain` |
| `shadows` | `false` skips the enemy and tower ground shadows |

`Renderer.setQuality` calls `invalidateBackground()` when `bgLayers` or
`shadows` changes, so the stale bake does not survive the switch.

Two rules that are not negotiable:

1. **Ring emitters derive the angle from the scaled bound.** The shape is
   `const n = this.n(48); for (let i = 0; i < n; i++) { const angle = (i / n) *
   Math.PI * 2; … }`. Scaling only the loop bound would emit a quarter circle.
2. **Nothing that carries damage is ever scaled.** `emitShockwaveRing` takes an
   optional `damage` and `tick` calls `onShockwaveDamage` for it: that ring is a
   gameplay object wearing a visual's clothes. Quality touches no shockwave
   count, radius, lifetime or delay. An effect that needs both is split into a
   damaging ring plus a scalable particle garnish. `npm run sim` is what catches
   a mistake here, and it must stay byte-identical across a quality change.

## Boss intro (UI plan §5.D)

A 1.8 s letterbox cinematic — `in` 0.35 s, `hold` 1.10 s, `out` 0.35 s — that
**never pauses the simulation**. The boss is already fighting through it, and
stopping the clock would break both the wave timer and the idle contract.

The state machine (`BossIntroState`) lives in `Game`, not in `EffectsManager`
and not in the renderer:

- only `Game` has `realDt`, and the intro advances on the wall clock — on
  `gameDt` a 6.5× run would flash the whole timeline in 0.28 s;
- `Renderer.time` advances by a fixed `FRAME_DT`, which is right for a looping
  shimmer and wrong for a 1.8-second timeline;
- it is not a particle, so routing it through the 600-slot pool would be a
  category error.

`Game.bossIntroSnapshot()` hands the renderer a single eased number — the bar
extension, 0..1 — so `Renderer.drawBossIntro` carries no phase logic.

Guards, all in `beginBossIntro` / `tickBossIntro`:

| Condition | Behaviour |
|---|---|
| Same wave already introduced | Ignored — once per encounter |
| `getSpeed() > 2` at open | No intro at all (idle contract) |
| `getSpeed() > 2` mid-intro | Dropped immediately |
| `prefers-reduced-motion` | Opens straight at `hold`: static name plate for 1.10 s, no bars, no `zoomPunch`. It does **not** degrade to nothing — which boss showed up is information |
| Any canvas press or key | Jumps to `out` (a 0.35 s retract, not a hard cut) and consumes the event |

It is layered on top of the existing 0.8 s entry slow-mo and
`emitBossEntryPulse`, which still fire at the same two sites. While the intro
is up, `drawWaveBanner` skips its `BOSS WAVE n` branch so the title is not
painted twice. The pattern line ships as text: the icon sprite sheet is
DOM-side and there is no cheap icon path in the canvas renderer.

## The combo flourish (UI plan §5.C)

Kill-combo tiers come out of `PacingManager` as a step function: the tier pops
on a threshold kill and vanishes when the drain window runs out. A full-screen
glow that switched on and off with that step would read as a bug, so the tier
never reaches a painter. `Renderer.advanceCombo` maps `snapshot.combo.tier`
(0..4) through `COMBO_INTENSITY = [0, 0.28, 0.5, 0.75, 1]` to a target and
walks one scalar, `comboGlow`, toward it with a frame-rate-independent
smoother (`COMBO_TAU = 0.25 s`, `k = 1 - exp(-FRAME_DT / TAU)`). Everything
downstream reads that scalar and nothing reads the tier. Below `0.002` the
scalar snaps to `0` so both passes can early-out instead of blitting a
transparent full-screen sprite forever after a combo ends.

Two painters consume it:

- **The edge glow** (`drawComboEdge`) — an inverse vignette, transparent in the
  middle and warm at the corners, blitted in *device* space via
  `camera.applyDevice`. Two sprites are baked at backing-store size (one
  `FX.gold`, one `FX.ember`) and cross-faded by `comboGlow` rather than one
  sprite re-baked every frame the combo climbs. Peak alpha is
  `COMBO_EDGE_ALPHA = 0.22`. The bake is dropped on any resize, alongside the
  background bake. The tint is deliberately not `FX.critical` or `FX.blood` —
  see `docs/art-direction.md`.
- **Embers** — pooled drifting motes spawned at `EMBER_RATE = 14/s` scaled by
  `comboGlow`, on a random point of the ring at `0.75 ×` the drawn tower range,
  rising at 26–48 world units/s for 1.4–2.2 s. The pool is capped by the
  quality profile's `embers`; the oldest is shifted out when it is full, and a
  profile with `embers: 0` spawns none.

`prefers-reduced-motion` drops the embers and clears the pool — they are pure
motion — and keeps the edge glow, which is static within a frame.

The flourish is presentation only: nothing in either painter feeds back into
`PacingManager`, and the combo's own bonus arithmetic is untouched by it.
