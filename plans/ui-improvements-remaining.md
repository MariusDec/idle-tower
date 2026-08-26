# The Tower — UI Plan, Parts 5 / 8 / 9 / 10

**Date:** 2026-08-22
**Branch:** `gameplay-improvements`
**Parent plan:** `plans/ui-improvements.md` — Parts 1, 2, 3, 4, 6 and 7 are implemented.
**Baseline at the time of writing:** `npm run typecheck` clean · **426/426** vitest · `npm run sim`
and `npm run checks` green. Every part below must land with that baseline still green.

This document is the implementation brief for the four remaining parts. It is written to be
executed by an implementer who has *not* read the parent plan end to end, so each part restates
what it owns, what already exists (do not rebuild it), the exact algorithms for anything with
non-obvious arithmetic, and its own acceptance test.

---

## 0. Ground truth (verified 2026-08-22, not assumed)

### 0.1 What is already done

| Part | State | Evidence in the tree |
|---|---|---|
| 1 — Camera & zoom-out | done | `src/game/Camera.ts`, `src/data/arena.ts`, `tests/camera.test.ts`, `docs/camera-system.md` |
| 2 — Design tokens | done | `src/styles/tokens.css` (415 lines), `src/data/palette.ts`, `tests/palette.test.ts`, `docs/art-direction.md` |
| 3 — Ground, tower, range, portals | done | `Renderer.bakeFarField` / `bakeTerrain` / `bakeLattice` / `drawRangeRing` / `drawTowerBase` / `drawCoreCrystal` / `drawWall` / `drawShield` / `drawSpawnPortals` |
| 4 — Enemies, projectiles, impacts | done, **including 4.3 and 4.4** | `SHOT_STYLES` per core, `advanceImpacts` + `IMPACT_CAP` decals, `advanceTurret` recoil/muzzle, `pushTracer` + `TRACER_CAP`, hit flash, directional death, locomotion bob |
| 6 — Icon system | done | `public/icons/sprite.svg`, `scripts/fetch-icons.mjs`, `src/data/icons.ts` + `iconMap.ts`, `src/ui/Icon.ts`, `ATTRIBUTION.md`, `docs/icon-system.md`; 13 data tables carry `icon:` and 17 UI modules render them |
| 7 — HUD & combat overlays | done | resource chips, bars with ghost + segments, wave header, ability **dock** with radial cooldown and hold-to-inspect, segmented boss bar with rim enrage clock, tiered toasts, 44 px sweep, reduced-motion pass |

Anything in this document that says "already exists" was checked against the source, not inferred
from a commit message.

### 0.2 Four gaps the survey turned up

These were not in the parent plan's part list but belong to the parts below. They are stated here so
they are not rediscovered as bugs.

1. **The canvas never got the Part 2 sweep.** `main.css` is clean (one `#000` left), but
   `Renderer.ts` still carries **22** literal hexes, `EffectsManager.ts` **26**, and `Game.ts` three
   (`'#7a5a30'`, `'#9aa7ff'`, `'#9be7ff'`). Parent-plan §12 criterion 5 is about CSS, but §2.2's whole
   point was one palette across canvas and DOM. Fixed in **§5.E**.
2. **`Camera.zoomPunch()` exists and is called from nowhere.** It was built in Part 1 for
   "boss death and enrage" and never wired. Wired in **§5.D**.
3. **The talent tree is DOM, not canvas.** Parent-plan §8 says "keep the canvas, restyle it";
   `TalentPanel.ts` renders per-branch DOM node lists and there is no canvas anywhere in it. §8.D
   below plans the real thing and says why the deviation is the right call.
4. **Two pickup numbers wear the wrong colour.** `Game.ts:2141` calls
   `emitDamageNumber(x, y, gold, full)` — passing "was a full-value pickup" as `isCrit`, so gold
   renders in the crit colour; and the mana orb next to it goes through `emitHealNumber`, so mana
   renders green. Both fixed by the `kind` field in **§5.B**.

### 0.3 Rules for every part below

1. **Green baseline or it does not land:** `npm run typecheck`, `npm test`, `npm run checks`.
   Part 5 additionally needs `npm run sim` byte-compared against `HEAD` — it touches nothing that
   should move a curve, so any diff at all is a bug in the change.
2. **Frame budget holds:** 250 enemies + saturated pools at 60 fps desktop, ≥45 fps at the `low`
   tier on a phone-class viewport. Anything per-entity and static gets cached the way
   `Renderer.part()` / `getEnemySprite` already do.
3. **Presentation may not change simulation.** Every value this plan adds is read by the renderer
   and written by `Game`; nothing in the render path may branch on it for behaviour. The one place
   this is easy to get wrong is §5.F — read the warning there about damaging shockwaves.
4. **Tokens, not literals.** After §5.E a literal colour anywhere in `src/` is a test failure.
5. **Per the repo's `CLAUDE.md`:** run `impact({target, direction: "upstream"})` before editing any
   symbol named below and report the blast radius; run `detect_changes()` before each commit.

---

## 5. Effects, juice and the additive layer

**Owns:** `src/systems/EffectsManager.ts`, `src/game/Renderer.ts` (effect passes, damage numbers,
combo furniture, boss intro), `src/game/Game.ts` (event → effect wiring, the intro state machine),
`src/types.ts` (`Particle`, `DamageNumber`, `RenderSnapshot`), `src/data/palette.ts` (+`mix`),
`src/data/quality.ts` (new), `docs/effects-system.md`.

**Depends on:** Parts 3 and 4 (done). **Blocks:** nothing — §8 is disjoint.

### 5.A The additive pass

Today every glow in the game composites in `source-over` and reads as flat paint. There are exactly
three `globalCompositeOperation = 'lighter'` sites in `Renderer.ts` (lines ~1862, ~3315, ~3935),
each a local save/set/restore inside a per-entity painter — which is both the wrong visual result
and the wrong shape, because the state flips several times per frame.

Replace with **one routed pass**.

**Route particles explicitly.** `drawParticles` currently splits `behind` / `front` by sniffing the
colour string:

```ts
if (layer === 'front' && p.color.startsWith('rgba(255, 255, 255')) continue;
```

That is load-bearing (it is what keeps smoke behind the enemies) and it is a string compare per
particle per frame. Replace it with a field:

```ts
// src/types.ts
export type ParticleLayer = 'behind' | 'front' | 'additive';
export interface Particle {
  …
  /** Which pass paints this. Defaults to 'front' when an emitter omits it. */
  layer?: ParticleLayer;
}
```

`EffectsManager.pushParticle` stamps `p.layer ??= 'front'`. Assign per emitter:

| Emitter | Layer |
|---|---|
| the `rgba(255,255,255,0.18)` smoke puffs in `emitDeathBurst`, `emitMineExplosion`, `emitExecuteSlash` | `behind` |
| `emitHitSparks`, `emitDeathBurst` shards, `emitSplitBurst`, `emitAttackSlash`, `emitRainOfArrows` | `front` |
| `emitBossDeathShockwave`, `emitBossEntryPulse`, `emitFrostNovaRing`, `emitMeteor`, `emitPrecisionGlow`, `emitGoldRushSparkle`, `emitVampiricAura`, `emitBerserkPulse`, `emitHealParticles`, `emitShieldAbsorb`, `emitEnemyShieldBreak` | `additive` |

**One pass, one state flip.** In `Renderer.draw`, after `drawParticles(ctx, …, 'front')` and before
`drawOrbs`, insert:

```ts
this.drawAdditivePass(ctx, snapshot, options);
```

```ts
private drawAdditivePass(ctx, snap, options): void {
  if (!this.quality.additive) {           // §5.F: the low tier drops the pass entirely
    this.drawParticles(ctx, snap.particles, 'additive');   // still painted, source-over
    this.drawShockwaves(ctx, snap.shockwaves);
    this.drawChainLightning(ctx, options?.chainPaths);
    this.drawComboEmbers(ctx);
    return;
  }
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  this.drawParticles(ctx, snap.particles, 'additive');
  this.drawShockwaves(ctx, snap.shockwaves);
  this.drawChainLightning(ctx, options?.chainPaths);
  this.drawComboEmbers(ctx);      // §5.C
  this.drawTracers(ctx);          // moved out of advanceTurret's painter
  this.drawMuzzleFlash(ctx, snap);// moved out of drawTurret
  ctx.restore();
}
```

Then **delete** the three local `lighter` save/restore blocks and call their bodies from here.
`drawShockwaves` and `drawChainLightning` move out of the world pass into this one; keep their call
order relative to each other unchanged.

**Saturation control.** Additive over a near-black ground blows out fast. Two rules:

- Additive particles fade on a steeper curve than source-over ones:
  `alpha = Math.pow(lifeRatio, 1.6) * 0.85` instead of `alpha = lifeRatio`.
- Nothing in the pass may draw at `globalAlpha === 1` **and** a near-white fill at a radius over
  ~24 world units. The two that would (the `emitExecuteSlash` 30–50 px puffs and the boss entry
  pulse) stay on `behind` / source-over.

**Cost.** The pass adds zero draw calls — it moves existing ones. It removes two per-frame
`globalCompositeOperation` flips and one string compare per particle per frame. Expect it to be
neutral-to-cheaper; confirm with the §10 harness.

### 5.B Damage numbers, in screen space

The single biggest legibility problem left. Today numbers are drawn in **world** space at
`entity(15)` = 25.5 world units, which at the 16:9 desktop zoom is about **12 CSS pixels** — smaller
than the HUD's smallest text — and they rise at 48 world units/s ≈ 23 CSS px/s.

**Move the anchor to world, the type and the motion to screen.**

Keep `x, y` as the **world anchor**, fixed at emit time. Add a rise accumulated in **CSS pixels**,
integrated by `EffectsManager` (which needs no camera for it — CSS px is unit-agnostic here) and
applied by the renderer after projecting the anchor:

```ts
// src/types.ts
export type DamageKind = 'damage' | 'heal' | 'gold' | 'mana' | 'self';
export interface DamageNumber {
  /** World anchor, fixed at emit. */
  x: number;
  y: number;
  amount: number;
  isCrit: boolean;
  kind: DamageKind;
  /** 0..3, from `damageTier()`. Drives size and colour. */
  tier: number;
  age: number;
  life: number;
  /** CSS pixels risen so far, and the CSS px/s it is still rising at. */
  riseCss: number;
  vy: number;
}
```

`isHeal` goes away; `kind: 'heal'` replaces it. `Game.ts:2141`'s gold number becomes
`kind: 'gold', isCrit: false` — see §0.2 gap 4.

**The tier formula.** One exported pure function so it is testable and there is one copy:

```ts
// src/systems/EffectsManager.ts (exported)
/**
 * How big a bite this hit took out of the thing it hit, bucketed.
 * `maxHp <= 0` (a heal, a gold pop, an unknown target) is always tier 0 —
 * a number with no denominator has no business shouting.
 */
export function damageTier(amount: number, maxHp: number): 0 | 1 | 2 | 3 {
  if (!(maxHp > 0)) return 0;
  const f = amount / maxHp;
  if (f >= 0.50) return 3;
  if (f >= 0.20) return 2;
  if (f >= 0.06) return 1;
  return 0;
}
```

`emitDamageNumber` gains an options bag rather than a fifth positional boolean:

```ts
emitDamageNumber(x, y, amount, isCrit, opts?: { maxHp?: number; kind?: DamageKind }): void
```

Call sites and what each passes:

| Site | `maxHp` | `kind` |
|---|---|---|
| `Game.ts:639` `enemy_damaged` | `p.enemy.maxHp` (already in the payload) | `damage` |
| `Game.ts:953` `enemy_healed` | — | `heal` |
| `Game.ts:960` dodge (`amount 0`) | — | `self` |
| `Game.ts:983` wall absorb | `ts.wallMaxHp` | `self` |
| `Game.ts:1027` tower damage | `ts.maxHp` | `self` |
| `Game.ts:2141` gold pickup | — | `gold` |
| `Game.ts:2146` mana orb (via `emitHealNumber`) | — | `mana` |
| `emitHealNumber` (`645`, `909`) | — | `heal` |

**Sizes, in CSS pixels.** `SIZE_BY_TIER = [15, 18, 22, 28]`, crits `× 1.28`, `self` and `gold`
pinned to `[15, 15, 17, 19]` (the tower's own numbers must never out-shout an enemy's).

**Colour.** Through `FX` (§5.E), never a literal:

| kind / tier | fill |
|---|---|
| `damage` tier 0–1 | `INK['050']` |
| `damage` tier 2 | `mix(INK['050'], FX.gold, 0.45)` |
| `damage` tier 3 | `FX.gold` |
| `damage` crit (any tier) | `FX.gold`, plus the chromatic edge below |
| `heal` | `FX.nature` |
| `gold` | `FX.gold` |
| `mana` | `FX.mana` — a mana orb currently pops green through `emitHealNumber`, which says "you were healed" |
| `self` | `FX.critical` — the tower is being hurt, which is the one thing that colour means |

Outline for all of them: `withAlpha(INK['950'], 0.85)` at `lineWidth = size * 0.16`.

**The pop-then-settle curve.** Replace the current linear float:

```ts
const POP = 0.09;      // seconds spent growing
const SETTLE = 0.13;   // seconds easing back to rest
// easeOutBack, overshoot 1.7 — the standard one, written out so nobody has to guess:
const easeOutBack = (t: number) => { const c1 = 1.70158, c3 = c1 + 1; const u = t - 1;
  return 1 + c3 * u * u * u + c1 * u * u; };

function popScale(age: number): number {
  if (age < POP)          return 0.62 + 0.53 * easeOutBack(age / POP);   // 0.62 → ~1.15
  if (age < POP + SETTLE) return 1.15 - 0.15 * ((age - POP) / SETTLE);   // 1.15 → 1.00
  return 1.0;
}
```

Crits multiply the whole curve by `1.25` and add a **chromatic edge**: draw the same glyph twice,
source-over, *before* the main fill — once at `x - 1.5` in `withAlpha(FX.critical, 0.38)`, once at
`x + 1.5` in `withAlpha(FX.frost, 0.38)` — then the main fill on top. **Delete the `'!'` glyph
hack** at the end of `drawDamageNumbers`.

**The rise, in CSS px.** In `EffectsManager.tick`:

```ts
const DMG_RISE_SPEED = 74;    // CSS px/s at birth
const DMG_RISE_DECAY = 0.35;  // per second, the existing exponential
for (const d of this.damageNumbers) {
  d.age += dt;
  d.riseCss += d.vy * dt;
  d.vy *= Math.pow(DMG_RISE_DECAY, dt);
}
```

**The merge must not reset the rise.** The existing merge window (16 world units / 0.22 s) is doing
real work and stays. But it currently does `d.age = 0; d.vy = DMG_FLOAT_SPEED;` — under the new
model resetting `age` re-runs the pop, which is what you want (a growing total should visibly bump),
while resetting `riseCss` would teleport the label back down onto the enemy. So:

```ts
d.amount += next.amount;
d.tier = Math.max(d.tier, next.tier);   // a merge that crosses a threshold promotes
d.age = 0;                              // re-pop, and restart the life clock
d.vy = DMG_RISE_SPEED;                  // re-kick the rise
// d.riseCss: DELIBERATELY UNTOUCHED. See tests/effects.test.ts.
```

Merge matching gains `kind` alongside the existing crit check: a heal must never fold into a hit.

**Drawing.** `drawDamageNumbers` moves from the world block to the screen block in `draw()` —
after `applyScreen(ctx)`, before `drawWaveBanner`. Per number:

```ts
const p = this.camera.worldToScreen(d.x, d.y);
const sy = p.y - d.riseCss;
if (p.x < -100 || p.x > cssW + 100 || sy < -60 || sy > cssH + 60) continue;  // cheap cull
const scale = popScale(d.age) * (d.isCrit ? 1.25 : 1);
const size  = sizeFor(d) * scale;
const alpha = Math.min(1, d.age / 0.06) * Math.min(1, (1 - d.age / d.life) * 1.6);
ctx.font = `${weightFor(d)} ${size.toFixed(1)}px ${DISPLAY_FONT_STACK}`;
```

Use the Part 2 display face (`'Oswald', <condensed fallback stack>`) — numbers are exactly what it
was self-hosted for. Declare the stack as one const in `Renderer.ts` sourced from the same string
`tokens.css` uses.

The existing `jitterX` stays but becomes CSS px: `(1 - lifeRatio) * ((d.amount % 7) - 3) * 0.8`,
crits excluded.

**Camera shake.** Screen space is *outside* the shake translate, so numbers will stop shaking with
the world. That is correct and deliberate — HUD text that jitters is unreadable — but note it in
`docs/effects-system.md` so it is not filed as a regression.

### 5.C The combo flourish

`src/data/pacing.ts` defines four combo tiers (`Chain` 10, `Streak` 25, `Rampage` 50, `Massacre`
100). Today the only expression is the `PacingOverlay` meter. Give the battlefield three escalating
signals.

**Getting the value to the renderer.** `Game.frameUpdate` already computes `this.pacingHud` every
frame with `comboTier` and `comboFraction` on it. Add to `RenderSnapshot`:

```ts
/** Kill-combo tier 0..4 and the drain bar's fill, for the §5.C flourish. Presentation only. */
combo?: { tier: number; fraction: number };
```

and pass `combo: this.pacingHud ? { tier: this.pacingHud.comboTier, fraction: this.pacingHud.comboFraction } : undefined`
from `Game.draw()`.

**Smooth the tier, do not step it.** A tier that pops on the 10th kill and vanishes on the drain
looks like a bug. Ease a single scalar in `Renderer.advance`:

```ts
private comboGlow = 0;                 // 0..1, the eased intensity
private static readonly COMBO_TAU = 0.25;   // seconds to ~63% of a step

private advanceCombo(snap: RenderSnapshot): void {
  const tier = snap.combo?.tier ?? 0;
  const target = COMBO_INTENSITY[Math.min(tier, 4)];      // [0, 0.28, 0.50, 0.75, 1.0]
  const k = 1 - Math.exp(-FRAME_DT / Renderer.COMBO_TAU); // frame-rate-independent smoother
  this.comboGlow += (target - this.comboGlow) * k;
  if (this.comboGlow < 0.002) this.comboGlow = 0;         // snap to off so the pass can early-out
}
```

**1. Edge glow (screen space).** A cached inverse-vignette sprite per viewport size, blitted at
`globalAlpha = comboGlow * 0.22`. **Bake it, do not build a gradient per frame** — a
`createRadialGradient` over a 2×-DPR backing store every frame is exactly the cost Part 3 removed:

```ts
private comboEdge: HTMLCanvasElement | null = null;   // invalidated alongside bgCanvas
// bake: radial gradient centred, stop 0 = transparent at r = 0.55·min(w,h),
//       stop 1 = FX.ember at the corners, painted over the full backing store.
```

Colour: `FX.gold` blended toward `FX.ember` as intensity rises —
`mix(FX.gold, FX.ember, comboGlow)`. **Not `FX.critical` and not `FX.blood`**: per
`docs/art-direction.md` those two mean "the tower is in peril" and "an enemy", and a combo is the
opposite of both. Bake two sprites (gold, ember) and cross-fade rather than re-baking on every
intensity change.

**2. Heat tint.** Folded into the same sprite — the edge glow *is* the heat tint. Do not add a
second full-screen fill; at DPR 2 on a phone that is a measurable fill-rate cost for a few percent
of warmth.

**3. Ember drift (world space, additive pass).** A dedicated ring buffer in `Renderer`, in the same
shape as `tracers` / `impacts` / `emergences`:

```ts
interface ComboEmber { x: number; y: number; vy: number; age: number; life: number; size: number; }
private readonly embers: ComboEmber[] = [];
private emberDebt = 0;
const EMBER_CAP = 48;              // scaled by quality tier (§5.F)

// in advanceCombo, after the smoother:
this.emberDebt += this.comboGlow * EMBER_RATE * FRAME_DT;   // EMBER_RATE = 14/s at full glow
while (this.emberDebt >= 1) {
  this.emberDebt -= 1;
  this.pushEmber();          // spawn on a random point of a ring at 0.75·rangeDrawn,
                             // vy = -(26 + rand·22) world units/s, life 1.4–2.2 s,
                             // size entity(1.2 + rand·1.4)
}
for (let i = this.embers.length - 1; i >= 0; i--) {
  const e = this.embers[i];
  e.age += FRAME_DT;
  e.y += e.vy * FRAME_DT;
  if (e.age >= e.life) this.embers.splice(i, 1);
}
```

`drawComboEmbers` runs inside the additive pass at
`alpha = sin(π · age/life) * 0.5 * comboGlow` — a sine so they fade in *and* out and never pop.
This deliberately does **not** go through `EffectsManager`: it is pure decoration on a renderer
clock, and routing it through the shared 600-particle pool would let a combo evict the sparks the
player is actually reading.

Under `prefers-reduced-motion`, keep the edge glow (it is static per frame) and skip the embers.

### 5.D The boss intro

**Requirements:** short, skippable on tap/key, camera punch, letterbox bars, the boss name and its
pattern, auto-skipped above 2× speed, and — the one that matters — **the simulation never pauses**.
The boss is already fighting during the intro; a cinematic that stopped the clock would break both
the wave timer and the idle contract.

**Ownership.** The state machine lives in `Game` (which has `realDt`, `getSpeed()`, the boss data
and the input), and the renderer only paints values handed to it. This is on purpose:
`Renderer.time` advances by a fixed `FRAME_DT` regardless of the real frame time, which is fine for
a looping shimmer and wrong for a 1.8-second timeline.

```ts
// src/game/Game.ts
interface BossIntroState {
  phase: 'in' | 'hold' | 'out';
  t: number;              // seconds elapsed in the current phase, wall clock
  wave: number;
  name: string;
  pattern: string | null;
}
const INTRO_IN = 0.35, INTRO_HOLD = 1.10, INTRO_OUT = 0.35;   // 1.80 s total
```

**Trigger.** At the two existing boss-entry sites (`Game.ts:882-890` and `:1173-1177`), where
`triggerBossEntrySlowMo()` and `emitBossEntryPulse()` already fire, add `beginBossIntro(...)`:

```ts
private beginBossIntro(wave: number, name: string, pattern: string | null): void {
  if (this.bossIntro && this.bossIntro.wave === wave) return;  // once per encounter
  if (this.getSpeed() > 2) return;                             // idle contract: no cinematic at speed
  if (this.reducedMotion) { this.bossIntro = { phase: 'hold', t: 0, wave, name, pattern }; return; }
  this.bossIntro = { phase: 'in', t: 0, wave, name, pattern };
  this.camera.zoomPunch();     // §0.2 gap 2 — this is what it was built for
}
```

Under reduced motion the intro degrades to a static name plate for `INTRO_HOLD` seconds: no bars, no
punch, no scale. It does not degrade to nothing — knowing which boss showed up is information, not
decoration.

**Advance,** in `frameUpdate` on `realDt` (never `gameDt` — a 6.5× run would flash it for 0.28 s):

```ts
private tickBossIntro(realDt: number): void {
  const s = this.bossIntro;
  if (!s) return;
  if (this.getSpeed() > 2) { this.bossIntro = null; return; }   // speed raised mid-intro
  s.t += realDt;
  const cap = s.phase === 'in' ? INTRO_IN : s.phase === 'hold' ? INTRO_HOLD : INTRO_OUT;
  if (s.t < cap) return;
  s.t -= cap;
  if (s.phase === 'in') s.phase = 'hold';
  else if (s.phase === 'hold') s.phase = 'out';
  else this.bossIntro = null;
}
```

**Skip.** Any `pointerdown` on the canvas or any `keydown` while `bossIntro` is non-null jumps it to
`{ phase: 'out', t: 0 }` (a hard cut is jarring; a 0.35 s retract is not). Wire in `main.ts` next to
the existing canvas input, **before** the placement/charge routing so a skip tap does not also fire
an ability, and consume the event. Document the routing order alongside the existing one in
`docs/loot-system.md`'s input section.

**Painting** (screen space, after `drawWaveBanner`). `Game.draw()` passes:

```ts
bossIntro: this.bossIntro && { progress, name, pattern, wave }   // see below
```

where `progress` is the **bar extension**, 0..1, so the renderer needs no phase logic:

```ts
// in Game, when building the option:
const p = s.phase === 'in'  ? easeOutCubic(s.t / INTRO_IN)
        : s.phase === 'hold' ? 1
        : 1 - easeOutCubic(s.t / INTRO_OUT);
```

Renderer:

- two bars, `height = cssHeight * 0.10 * progress`, at the top and bottom, filled
  `withAlpha(INK['950'], 0.92)`;
- the boss name centred, display face, `36px`, `mix(FX.blood, INK['050'], 0.5)`, at
  `alpha = progress` and `scale = 1.06 - 0.06 * progress`;
- the pattern name below it at `15px`, `withAlpha(INK['100'], 0.75 * progress)`, prefixed by the
  pattern's icon if one is available cheaply — if not, ship the text and note it.

**Suppress the double title:** while `bossIntro` is non-null, `drawWaveBanner` skips its
`BOSS WAVE n` branch.

**Do not touch** the existing 0.8 s entry slow-mo or `emitBossEntryPulse` — they already fire at the
same sites and the intro is layered on top of them, not a replacement.

### 5.E The palette sweep for the canvas

Mechanical, and it is what makes §10's guard test possible. First add two helpers to
`src/data/palette.ts` (with tests in `tests/palette.test.ts`):

```ts
/** Linear sRGB-naive blend. `t = 0` → `a`, `t = 1` → `b`. Good enough for effect tints. */
export function mix(a: string, b: string, t: number): string;
/** `mix(hex, INK['050'], amount)` — the common case, spelled once. */
export function lighten(hex: string, amount: number): string;
```

Then replace every literal. The mapping (write it into `docs/art-direction.md` as the reference
table, because the next person will want to know why `#ff6633` became ember and not blood):

| Literal | Files | Becomes |
|---|---|---|
| `#ff5050`, `#ff4040`, `#ff4a4a`, `#c44a4a`, `#d04848`, `rgba(220,60,60,…)` | Effects, Renderer | `FX.blood` (± `lighten`) |
| `#ff6633`, `#ff7a1a`, `#ff3a00`, `#ff6a4a`, `#ff8844`, `#ff8a3c`, `#ff6420`, `#cc4422` | Effects, Renderer | `FX.ember` (± `lighten` / `mix` toward gold) |
| `#ffcc00`, `#ffd24a`, `#ffd34a`, `#ffe27a`, `#fff0a0`, `#fff3b0`, `#ffb04a`, `#f7d774`, `#ffd700`, `#e8a93b` | Effects, Renderer | `FX.gold` (± `lighten`) |
| `#3edc81`, `#3edc64`, `#3ec46d`, `#aaf2c0` | Effects, Renderer | `FX.nature` (± `lighten`) |
| `#a3d2ff`, `#e0f0ff`, `#64b4ff`, `#a0d8ff`, `#3cb4ff`, `#9be7ff` | Effects, Renderer, Game | `FX.frost` (± `lighten`) |
| `#a020f0`, `#b432dc`, `#c098ff`, `#9aa7ff` | Effects, Renderer, Game | `FX.arcane` (± `lighten`) |
| `#0c0e12`, `#1c2028`, `#5a2a00`, `#7a5a30` | Renderer, Game | `INK['900']` / `INK['600']` / `withAlpha(FX.ember, …)` |
| `#3a0000`, `#0a3a1a` (number outlines) | Renderer | `withAlpha(INK['950'], 0.85)` — one outline for both, per §5.B |
| `#f0f0f0`, `#ff8a8a` (wave banner) | Renderer | `INK['050']`, `mix(FX.blood, INK['050'], 0.45)` |
| `'#ffffff'`, `'#000'` | anywhere | **allowed**, and the only two literals the §10 test whitelists |

Where a colour is used at several alphas, go through `withAlpha(FX.x, a)` rather than pre-baking a
second hex — the whole reason `withAlpha` exists.

### 5.F The quality knob

Part 9 owns the Settings control and the auto-detect. Part 5 introduces the **table and the wiring**,
defaulting to `high`, so §9 only has to call a setter.

```ts
// src/data/quality.ts  (new)
export type QualityTier = 'high' | 'medium' | 'low';

export interface QualityProfile {
  /** Multiplier on every emitter's particle count. */
  particleScale: number;
  /** Ceiling on the live particle pool. */
  maxParticles: number;
  /** Whether the §5.A additive pass runs as `lighter`. */
  additive: boolean;
  /** Ground-impact decals (Part 4.3) kept alive. */
  decals: number;
  /** §5.C combo embers kept alive. */
  embers: number;
  /** Cap handed to the camera's `min(devicePixelRatio, cap)`. */
  dprCap: number;
  /** Background layers baked: 3 = far field + terrain + lattice, 2 drops the terrain noise. */
  bgLayers: 2 | 3;
  /** Cached drop shadows under entities. */
  shadows: boolean;
}

export const QUALITY: Record<QualityTier, QualityProfile> = {
  high:   { particleScale: 1.00, maxParticles: 600, additive: true,  decals: 48, embers: 48, dprCap: 2.0, bgLayers: 3, shadows: true  },
  medium: { particleScale: 0.50, maxParticles: 360, additive: true,  decals: 24, embers: 24, dprCap: 1.5, bgLayers: 3, shadows: true  },
  low:    { particleScale: 0.25, maxParticles: 200, additive: false, decals: 0,  embers: 0,  dprCap: 1.0, bgLayers: 2, shadows: false },
};
```

**Scaling the emitters — the fiddly part.** Every emitter in `EffectsManager` has a literal loop
bound, and several of them use that same literal as the *ring resolution*:

```ts
for (let i = 0; i < 48; i++) { const angle = (i / 48) * Math.PI * 2; … }
```

Scaling only the bound would emit a quarter-circle. The mechanical rule, applied to **all 18**
emitters (`emitHitSparks`, `emitDeathBurst` — both loops, `emitBossDeathShockwave`,
`emitBossEntryPulse`, `emitRainOfArrows`, `emitFrostNovaRing`, `emitBerserkPulse`,
`emitGoldRushSparkle`, `emitMeteor` — both loops, `emitPrecisionGlow` — both loops,
`emitVampiricAura`, `emitExecuteSlash` — both loops, `emitMineExplosion` — both loops,
`emitShieldAbsorb`, `emitEnemyShieldBreak`, `emitHealParticles`, `emitSplitBurst`,
`emitAttackSlash`):

```ts
/** Scale a particle count by the quality tier, never below 1. */
private n(count: number): number {
  return Math.max(1, Math.round(count * this.profile.particleScale));
}

// then, at every site, hoist the bound and derive the angle from it:
const n = this.n(48);
for (let i = 0; i < n; i++) { const angle = (i / n) * Math.PI * 2; … }
```

`emitHealParticles`'s count is already derived (`min(8, max(2, dist/30))`) — wrap the result in
`this.n(...)`. `emitMeteor`'s trail parameterises on `t = i / trailCount`; scale `trailCount` and the
`t` follows.

> **Do not scale anything that carries damage.** `emitShockwaveRing` takes an optional `damage` and
> `EffectsManager.tick` calls `onShockwaveDamage` for it — that ring is a *gameplay* object wearing a
> visual's clothes. Quality must never touch shockwave counts, radii, lifetimes or the delay. If a
> future effect needs both, split it: a damaging ring plus a scalable particle garnish. This is the
> one place in Part 5 where a mistake changes the balance, and `npm run sim` is what catches it.

**Shrinking the cap.** `MAX_PARTICLES` becomes a field. On a tier change:

```ts
setQuality(tier: QualityTier): void {
  this.profile = QUALITY[tier];
  const over = this.particles.length - this.profile.maxParticles;
  if (over > 0) this.particles.splice(0, over);   // drop the oldest, same policy as pushParticle
}
```

`Renderer.setQuality` mirrors it for `decals` / `embers` / `additive` / `bgLayers` / `shadows`, and
must call `invalidateBackground()` when `bgLayers` or `shadows` changes. `Camera.setDprCap` is §9's.

### 5.G Part 5 acceptance

- `npm run sim` output is **byte-identical** to `HEAD`'s. Part 5 touches no simulation input; any
  diff means a damaging shockwave or an emitter with a gameplay side effect got scaled.
- `npm run checks` green; `npm test` green plus the new `tests/effects.test.ts`.
- Visually, at a 1280×800 desktop viewport: damage numbers are legible at rest, crits are obviously
  crits without a `!`, a 50-kill combo visibly warms the screen edges, and a boss entry produces
  bars-name-pattern in under two seconds and skips on any tap.
- At 4× speed a boss entry produces **no** cinematic at all.

---

## 8. Panels, tabs and content surfaces

**Owns:** `src/ui/UIManager.ts`, `src/ui/navGroups.ts` (new), `src/ui/Modal.ts` (new),
`src/ui/{UpgradePanel,AbilityPanel,EquipmentPanel,ResearchPanel,TalentPanel,PrestigePanel,`
`TranscendencePanel,ProgressionPanel,StatsPanel,AchievementPanel,SettingsPanel,MobileSheet,`
`BottomNav}.ts`, the seven modal modules, and their CSS sections in `main.css`.

**Depends on:** Parts 2, 6, 7 (done). Independent of Part 5 — the two can proceed in parallel.

### 8.A Two-level navigation

Today: `UIManager.ts:51` holds an 11-entry flat `TABS` array rendered as a wrapping
`flex-wrap: wrap` grid of `.tab-btn`s (four rows before the panel content starts at a 320 px panel),
and `UIManager.ts:665` holds a *separate*, unrelated 4-entry mobile nav with a `'more'` bucket that
opens the Prestige tab. Two information architectures for one app.

**One table, two consumers.**

```ts
// src/ui/navGroups.ts  (new)
import type { PanelTab } from '../types';
import type { IconId } from '../data/icons';

export type NavGroupId = 'build' | 'research' | 'prestige' | 'progress' | 'system';

export interface NavGroup {
  id: NavGroupId;
  label: string;
  icon: IconId;
  tabs: readonly { id: PanelTab; label: string }[];
}

export const NAV_GROUPS: readonly NavGroup[] = [
  { id: 'build',    label: 'Build',    icon: …, tabs: [upgrades, abilities, equipment] },
  { id: 'research', label: 'Research', icon: …, tabs: [research, talents] },
  { id: 'prestige', label: 'Prestige', icon: …, tabs: [prestige, transcendence] },
  { id: 'progress', label: 'Progress', icon: …, tabs: [progression, achievements, stats] },
  { id: 'system',   label: 'System',   icon: …, tabs: [settings] },
];

/** Reverse index, built once at module load. */
export const GROUP_OF: Readonly<Record<PanelTab, NavGroupId>> = /* derived from NAV_GROUPS */;
```

Pick the five icons from the existing pinned manifest (`src/data/icons.ts`) — if a suitable id is
missing, add it to `scripts/fetch-icons.mjs`'s manifest, re-run `npm run icons`, and commit the
regenerated sprite and `ATTRIBUTION.md`.

**Desktop.** `.panel-tabs` becomes two elements: a 5-button vertical **rail** on the panel's leading
edge (44 px targets, icon + a 10 px label) and a horizontal **sub-strip** of the active group's tabs
above the content. `showTab(id)` gains a group step:

```ts
private lastTabPerGroup = new Map<NavGroupId, PanelTab>();   // seeded from NAV_GROUPS[i].tabs[0]

private showGroup(g: NavGroupId): void {
  this.showTab(this.lastTabPerGroup.get(g) ?? firstTabOf(g));
}
private showTab(id: PanelTab): void {
  this.activeTab = id;
  this.activeGroup = GROUP_OF[id];
  this.lastTabPerGroup.set(this.activeGroup, id);
  this.renderSubStrip(this.activeGroup);
  … existing mount/update switch, unchanged …
}
```

Persist `activeTab` to `localStorage` under `the-tower-nav-tab`, alongside the existing
`the-tower-panel-width` / `the-tower-panel-collapsed` keys, and restore it in `mount()`. A player who
was mid-way through the talent tree should not land on Upgrades every reload.

**The talent badge.** `UIManager.ts:1124` targets `[data-tab-badge="talents"]`, which is about to be
inside a collapsed group half the time. Render the badge on the sub-tab button **and** on its group
rail button, with the group's count being the sum over its tabs. Generalise the mechanism now
(`setTabBadge(tab: PanelTab, count: number)`) rather than special-casing talents twice.

**Mobile.** `installMobileChrome`'s ad-hoc `navItems` and `applyMobileMode`'s 11-entry
`MobileSheetTab[]` both come from `NAV_GROUPS`: the `BottomNav` gets the five groups, and opening a
group opens `MobileSheet` with **only that group's tabs** in the segmented strip. `handleMobileNav`'s
`'more'` / `'progress'` special-cases go away. `BottomNav.icon` changes from a `string` glyph to an
`IconId` rendered through `Icon.ts` — it is currently `'▲'`, `'⚗'`, `'★'`, `'…'`,
which is the last of the ASCII icon layer Part 6 was supposed to have removed.

**Layout budget.** The rail costs ~52 px. Raise `PANEL_MIN` from 280 → 332 and check
`CANVAS_MIN` (420) still leaves the arena a sane short axis at 1280 wide.

### 8.B Cards

Upgrade / ability / research rows become one shared card primitive rather than three near-identical
row layouts. **CSS-only where possible** — the panels already emit an icon (Part 6), a name, a
level, an effect and a button; this is mostly a grid and a state attribute.

```css
.card {
  display: grid;
  grid-template-columns: var(--card-icon) 1fr auto;   /* 40px | text | action */
  gap: var(--space-3);
  align-items: center;
  padding: var(--space-3);
  background: var(--surface-2);
  border: 1px solid var(--stroke-subtle);
  border-radius: var(--radius-lg);
}
.card[data-afford="no"]    { /* dim the action, keep the text at full contrast */ }
.card[data-afford="maxed"] { /* collapse the action to a check, tint the border */ }
.card[data-evolution="near"]::after { /* corner ribbon */ }
```

The affordability state must be legible **without colour** (a disabled action plus a cost that reads
as unmet), because it is the state a player scans a whole panel for.

The evolution ribbon fires when an upgrade's next `evolutions` threshold is within one level —
`UpgradePanel` already knows the thresholds; it just does not say so until they fire.

### 8.C Equipment

Already present, do not rebuild: `.eq-slots` grid, `.eq-inventory` cards with rarity badges, sort
bar, a working stat-delta `.eq-compare-tooltip`, and a drag-to-equip path (`body.eq-dragging`).

Remaining work:
1. **Tower silhouette layout.** Position the eight slots around a central tower graphic instead of a
   flat grid. Reuse the icon sprite for the tower, or a simple CSS shape — do **not** port
   `Renderer`'s tower painter into the DOM.
2. **Rarity frames** via `iconFrame(id, { variant: 'item', rarity })` from `Icon.ts`, replacing the
   inline `style="background:${color}"` in the compare tooltip markup (which is a literal-colour
   escape hatch — §0.3 rule 4).
3. **A touch route.** Verify the drag path is pointer-events based; if it is `mousedown`-based, add
   tap-to-select → tap-slot-to-equip. Give the compare tooltip a 350 ms long-press trigger on touch.

### 8.D The talent tree — a deviation, and why

The parent plan says "keep the canvas, restyle it". **There is no canvas.** `TalentPanel.ts` renders
per-branch DOM lists of nodes with prerequisite text. Rebuilding it as a canvas to satisfy the plan's
wording would cost the tree its keyboard access, its screen-reader text, its text selection and its
free hit-testing, to buy curved lines.

**Do this instead:** keep the DOM nodes, add an SVG **link layer** behind them.

```ts
// one <svg> per branch panel, position: absolute; inset: 0; pointer-events: none;
// recomputed on mount and on ResizeObserver(panel), never per frame.
for (const [parent, child] of edges) {
  const a = rectOf(parent), b = rectOf(child);          // relative to the panel, not the viewport
  const x0 = a.left + a.width / 2, y0 = a.bottom;
  const x1 = b.left + b.width / 2, y1 = b.top;
  const dy = y1 - y0;
  path.setAttribute('d', `M ${x0} ${y0} C ${x0} ${y0 + dy * 0.45}, ${x1} ${y1 - dy * 0.45}, ${x1} ${y1}`);
  path.setAttribute('class', `talent-link is-${state}`);   // spent | available | locked
}
```

Use `getBoundingClientRect()` of each node minus the panel's own rect (so it survives the panel's
scroll and the resizable width), and recompute in a single batched pass — read all rects, then write
all paths, never interleaved, or every node triggers a layout.

**Tri-state without relying on colour** (this is the accessibility requirement in the parent plan):

| State | Link | Node |
|---|---|---|
| spent | solid, 2 px, `FX.gold` | filled, a check glyph, 1.0 opacity |
| available | solid, 2 px, `FX.nature`, a slow dash-offset animation | ring outline, 1.0 opacity |
| locked | dashed 4/4, 1 px, `withAlpha(INK['300'], 0.5)` | 0.45 opacity, a lock glyph |

**Pan/pinch:** skip it. Give the branch panel `overflow: auto` + `touch-action: pan-x pan-y` and let
the platform scroll. A bespoke pinch layer over DOM nodes is a lot of gesture code for a tree that
fits a phone screen at a branch at a time. Note the deviation in `docs/xp-talent-system.md`.

### 8.E The blessing draft

The one modal with existing presentational ambition. Bring it to the new rarity frames, plus:

- stagger-in: `.blessing-card:nth-child(n)` with `animation-delay: calc((n - 1) * 70ms)`, total
  ≤ 210 ms, using `--dur-base` / `--ease-spring`;
- press tilt: `transform: perspective(600px) rotateX(<= 4deg)` on `:active` / `:hover`, bounded —
  a tilt that overshoots reads as broken, not juicy;
- both disabled under `@media (prefers-reduced-motion: reduce)`, which already has three blocks in
  `main.css` to extend.

### 8.F One modal shell

Today there are **three** independent shells plus an overlay: `welcome-modal*` (WelcomeBack,
RunSummary, RunFailed), `blessing-modal*` (BlessingDraft, CorePicker), `wave-mod-modal*`
(WaveModifier), and `KeybindsOverlay`. Each re-implements backdrop, visibility transition and
dismissal, and none has a focus trap.

```ts
// src/ui/Modal.ts  (new)
export interface ModalOptions {
  id: string;                   // → data-modal="…" for CSS hooks and tests
  title: string;
  sub?: string;
  width?: number;               // CSS px, capped by `min(width, 100vw - 2 * safe-inset - 32px)`
  dismissible?: boolean;        // Escape + backdrop tap. Default true.
  onClose?: () => void;
}

export class Modal {
  constructor(opts: ModalOptions);
  readonly body: HTMLElement;    // adopters render into this and nothing else
  open(): void;
  close(): void;
  isOpen(): boolean;
  destroy(): void;
  /** Every open modal, so `UIManager.isModalOpen()` cannot forget one. */
  static anyOpen(): boolean;
}
```

Provides: backdrop with `backdrop-filter: blur(6px)`, a spring-in on the card
(`translateY(12px) scale(0.98)` → rest over `--dur-base`), Escape and backdrop-tap when
`dismissible`, safe-area padding, `role="dialog"` + `aria-modal="true"` + `aria-labelledby`,
`overscroll-behavior: contain` on the card, and a focus trap:

```ts
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),' +
                  'textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

private onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && this.opts.dismissible !== false) { e.preventDefault(); this.close(); return; }
  if (e.key !== 'Tab') return;
  const nodes = [...this.card.querySelectorAll<HTMLElement>(FOCUSABLE)]
    .filter(n => n.offsetParent !== null);          // skip hidden
  if (nodes.length === 0) { e.preventDefault(); return; }
  const first = nodes[0], last = nodes[nodes.length - 1];
  if (e.shiftKey && document.activeElement === first) { last.focus();  e.preventDefault(); }
  else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
}
// open():  remember document.activeElement, focus the first node (or the card).
// close(): restore focus to the remembered element if it is still in the document.
```

**Migrate all seven** — RunSummary, RunFailed, WaveModifier, CorePicker, WelcomeBack, BlessingDraft,
Keybinds — and collapse the three CSS shells into one `.modal*` block, keeping each modal's *content*
classes (`.run-summary-stats`, `.blessing-card`, `.wave-mod-card`, …) untouched so their layouts
survive.

**Collapse the two hand-written open-modal lists.** `Game.isModalOpen()` (`Game.ts:2349`) names four
modals and `UIManager.isModalOpen()` (`UIManager.ts:1330`) names four more; together they are correct
today, and they are correct only because two people remembered to edit both. Point `UIManager`'s at
`Modal.anyOpen()` and drop the UIManager-owned names from `Game`'s, leaving it with just the modals
it owns itself. A new modal then answers the Space-binding gate for free instead of by convention.

Z-index becomes a token ladder in `tokens.css` (`--z-canvas-overlay`, `--z-dock`, `--z-sheet`,
`--z-modal`, `--z-toast`), replacing the hand-tuned `z-index: 110` at `main.css:3051` and friends.

### 8.G Part 8 acceptance

- The panel nav is five rail buttons and a sub-strip; nothing wraps to a second row at
  `PANEL_MIN` width.
- The bottom nav and the desktop rail show the **same** five groups in the same order.
- Every modal in the game closes on Escape, traps Tab, and restores focus on close.
- `grep -n "z-index: [0-9]" src/styles/main.css` returns only token references.
- The talent tree shows curved links whose state is distinguishable in greyscale.

---

## 9. Mobile and the Capacitor build

**Owns:** `index.html`, `src/styles/tokens.css` + the mobile blocks of `main.css`,
`src/ui/{MobileSheet,BottomNav,SettingsPanel}.ts`, `src/game/Camera.ts` (DPR cap),
`src/game/Game.ts` (the probe), `vite.config.ts`, `docs/ui-system.md`.

**Depends on:** 1, 5 (the quality table), 7, 8.

### 9.A Safe areas — what is left

Part 7 already applied `env(safe-area-inset-*)` to the ability dock, the bottom nav, the toast stack
and the corner-overlay ladder (`--corner-stack-base`). What is **not** covered: the HUD's top inset
(a notch will eat the wave header), the panel, the mobile sheet, and every modal.

Add a token quartet so component rules never call `env()` directly:

```css
:root {
  --safe-t: env(safe-area-inset-top, 0px);
  --safe-r: env(safe-area-inset-right, 0px);
  --safe-b: env(safe-area-inset-bottom, 0px);
  --safe-l: env(safe-area-inset-left, 0px);
}
```

then apply: `.hud-root { padding-top: max(var(--space-2), var(--safe-t)); }`, the sheet's
`padding-bottom: max(var(--space-3), var(--safe-b))`, and the modal shell's padding on all four.

### 9.B Portrait

Part 1's aspect-driven arena means portrait already produces a tall world with a 936 short
half-extent — the layout is what still assumes landscape. Add
`@media (orientation: portrait) and (max-width: 768px)`:

- HUD compressed to two rows (`--hud-height-mobile` is already declared at 90 px — verify it against
  the Part 7 HUD, which grew);
- the ability dock sits above the bottom nav (already true via `--corner-stack-base`) — verify at
  375×812 with a simulated 34 px bottom inset;
- the panel opens as a full-height sheet rather than a bottom sheet (`.mobile-sheet` gets
  `height: calc(100dvh - var(--safe-t))` in this branch);
- `100dvh`, not `100vh`, everywhere in the mobile blocks — `vh` on iOS includes the retracting
  browser chrome and will clip the dock.

### 9.C Touch hardening

None of this exists yet:

```css
html, body, #app { overscroll-behavior: none; }        /* pull-to-refresh mid-run = a lost run */
#app { -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; }
.panel-content, .mobile-sheet-body, .modal-card { overscroll-behavior: contain; }
```

`touch-action: none` stays on the canvas only (already at `main.css:115`) — putting it on the app
root would kill panel scrolling.

**44 px audit.** Part 7 swept the HUD and the dock. Still to check: `.tab-btn` (about to be replaced
by the rail — size the rail right the first time), `.eq-sort-btn`, `.btn-buy` / `.btn-sell`,
`.mobile-sheet-segmented-btn`, `.mobile-sheet-close`, talent nodes, research nodes, and the modal
close buttons. Where the visual can't be 44 px, use a transparent `::before` expanding the hit area.

**Hover-only affordances still needing a touch route:** the equipment compare tooltip (§8.C), the
upgrade row tooltips, and the talent node tooltips. The ability dock's hold-to-inspect landed in
Part 7 — reuse its long-press helper rather than writing a second one.

### 9.D Quality tiers

**Storage.** `localStorage['the-tower-quality']` holds `'auto'` or an explicit
`'high' | 'medium' | 'low'`. `'auto'` means "the game may still demote me"; an explicit value is
never overridden.

**First-run pick,** before any frame has been drawn:

```ts
function initialTier(): QualityTier {
  const cores  = navigator.hardwareConcurrency ?? 4;
  const dpr    = window.devicePixelRatio || 1;
  const coarse = matchMedia('(pointer: coarse)').matches;
  let t: QualityTier = cores >= 8 && !coarse ? 'high' : cores >= 4 ? 'medium' : 'low';
  // A 3x phone buffer is a 2.25x fill-rate tax before a single enemy is drawn.
  if (coarse && dpr > 2 && t === 'high') t = 'medium';
  return t;
}
```

**The 2-second probe.** Refines the guess with a measurement, and only ever **downward**:

```ts
private probe: { frames: number; sum: number; elapsed: number } | null = null;

// started once, on the first frame of wave 1 of the session, and only when the
// stored preference is 'auto'.
private tickQualityProbe(realDt: number): void {
  const p = this.probe;
  if (!p) return;
  // Abandon rather than mis-measure: a hidden tab throttles rAF to 1 Hz, and a
  // sped-up run is not the frame cost the player will live with.
  if (document.hidden || this.getSpeed() > 1) { this.probe = null; return; }
  if (++p.frames <= 30) return;             // skip JIT warm-up and the first background bake
  p.sum += realDt;
  p.elapsed += realDt;
  if (p.elapsed < 2) return;
  const meanMs = (p.sum / (p.frames - 30)) * 1000;
  const budget = this.qualityTier === 'low' ? 22 : 17;   // 45 fps floor at low, 60 fps target above
  if (meanMs > budget) this.setQuality(demote(this.qualityTier));
  this.probe = null;                        // once per session, never again
}
```

Use the **mean**, not the worst frame: a single 40 ms hitch from a save write or a sprite bake is not
a reason to drop a desktop to `low`. Never auto-promote — a promotion that stutters is worse than a
demotion that does not, and the Settings control is right there.

**Applying a tier** fans out to four owners:

```ts
setQuality(tier: QualityTier): void {
  this.qualityTier = tier;
  const q = QUALITY[tier];
  this.effects.setQuality(tier);       // particle scale + pool trim (§5.F)
  this.renderer.setQuality(tier);      // decals, embers, additive, bg layers, shadows
  this.camera.setDprCap(q.dprCap);     // re-measures, re-sizes the backing store
  this.renderer.invalidateBackground();
  persist(tier);
}
```

> **`setDprCap` must not run the enemy-rescale path.** `Camera`'s resize handler rescales live enemy
> positions when the **world extents** change, so a mid-wave resize does not teleport anything out of
> bounds. A DPR change leaves the world extents *identical* — only the backing store and `scale`
> move. Calling the rescale path here would shift every enemy for no reason. Split the resize
> handling so the rescale is conditional on `worldWidth`/`worldHeight` actually changing, and cover
> it in `tests/camera.test.ts`.

**The control.** `SettingsPanel` gets a "Graphics" section above "Save Data": a segmented
`Auto | High | Medium | Low` control (44 px), with a one-line hint under it naming what the current
tier costs ("Low: fewer particles, no glow pass, 1× resolution"). Follow the existing
`renderAudioSection` / `renderAbilitySection` shape and add `onQualityChange` + `currentQuality` to
`SettingsAPI` — the panel must not reach into `Game`.

### 9.E Capacitor readiness

Not adding the Capacitor project — making sure nothing blocks it:

- `<meta name="theme-color" content="#0a0d14">` in `index.html`, matching `--surface-0`. Keep it
  in sync with the token by hand and note the pairing in a comment, the same way `tokens.css`
  documents the palette duplication.
- `vite.config.ts` gets `base: './'` so `dist/` is relative-pathed. **Verify the icon sprite still
  resolves** — `ICON_SPRITE_PATH` is already relative (`'icons/sprite.svg'`), which is exactly why.
- Fonts are already self-hosted under `public/fonts/`; the icon sprite is already committed. Add a
  guard test (§10) so a future `@import url(https://…)` cannot regress it.
- Document the `npx cap add android` path, the splash background (`--surface-0`), and the status-bar
  style in a new `## Capacitor` section of `docs/ui-system.md`.

### 9.F Part 9 acceptance

At 375×812 with simulated insets of 47 px top / 34 px bottom: nothing in the HUD, dock, nav, sheet or
any modal is clipped; every interactive target measures ≥ 44 px; pull-to-refresh does not fire on a
downward drag over the canvas or a scrolled panel; and the three quality tiers are switchable at
runtime with a visible difference and no reload.

---

## 10. Performance, verification and docs

**Owns:** `src/main.ts` (the harness), `tests/`, `docs/{performance,effects-system,ui-system,`
`art-direction,xp-talent-system}.md`, `AGENTS.md`.

### 10.A Layer canvases — measure before building

The parent plan proposes moving the entity pass and the effects pass onto separate offscreen
canvases. **Do not do this speculatively.** The static ground is already baked and blitted once
(Part 3), which was the expensive half; `lighter` on the main context needs no second canvas, and
compositing two full-size canvases per frame at DPR 2 costs real fill rate. Run the harness first
and only split a layer if the numbers demand it. If the numbers do demand it, record them here
before writing the code.

### 10.B The budget harness

Extend the existing `window.__theTower` (`src/main.ts:339`) rather than adding a new global:

```ts
__theTower.bench({ enemies = 250, seconds = 10, tier });
// → { tier, frames, p50, p95, worst, particles, enemies }
```

It spawns `enemies` through the real `EnemyManager` (so the spatial grid, the sprite cache and the
render path are all exercised), saturates the particle pool by calling `emitDeathBurst` on a timer,
samples `performance.now()` deltas in the RAF loop, and reports percentiles:

```ts
// Small n, one shot, no allocation pressure that matters: a plain sort is fine.
function percentile(samples: number[], p: number): number {
  const s = [...samples].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}
```

Discard the first 30 samples for the same reason the §9.D probe does. Run it at each tier and record
the table in `docs/performance.md` — before Part 5 (capture it from `HEAD` in a scratch worktree)
and after Parts 5/8/9 — the same before/after discipline §1.5 of the parent plan used.

### 10.C Tests

New `tests/effects.test.ts`:
- `damageTier` boundaries: `(5, 100) → 0`, `(6, 100) → 1`, `(20, 100) → 2`, `(50, 100) → 3`,
  `(50, 0) → 0`, `(1, 1) → 3`.
- The merge keeps `riseCss` and promotes `tier`; a heal never merges into a hit.
- Pool caps hold: 5 000 `emitHitSparks` leaves `particleList.length <= maxParticles`, and the
  survivors are the newest.
- Quality scaling reduces particle counts monotonically across the three tiers, and **never** changes
  the number, radius, lifetime, delay or damage of a shockwave carrying `damage`.
- `setQuality('low')` on a saturated pool trims to the new cap from the front.

New `tests/quality.test.ts`: `QUALITY` is monotonic high → medium → low on `particleScale`,
`maxParticles`, `decals`, `embers`, `dprCap`, and `additive` never turns back on as the tier drops.

Extend `tests/palette.test.ts`:
- `mix` / `lighten` round-trip at `t = 0` and `t = 1`, and clamp outside `[0, 1]`.
- **No literal colour in the render path.** Scan `src/game/Renderer.ts`,
  `src/systems/EffectsManager.ts`, `src/game/Game.ts` and `src/ui/*.ts` for
  `/#[0-9a-fA-F]{3,8}\b/` and `/rgba?\(/`, whitelisting only `'#ffffff'` and `'#000'`. This is what
  makes §5.E stick.
- **No runtime network.** Scan `index.html` and `src/styles/*.css` for `http://` / `https://` outside
  comments.

Extend `tests/content-coverage.test.ts`:
- Every `PanelTab` appears in exactly one `NAV_GROUPS` entry, and every group has ≥ 1 tab and a
  valid `IconId`.
- Every `BottomNav` item id is a `NavGroupId`.

Extend `tests/camera.test.ts`:
- `setDprCap` changes `pixelWidth`/`pixelHeight` and `scale` but leaves `worldWidth`/`worldHeight`
  untouched (the §9.D rescale guard).

### 10.D Docs

| File | What lands |
|---|---|
| `docs/effects-system.md` | the additive pass and its routing table, screen-space damage numbers (tiers, the pop curve, the merge/`riseCss` rule, why they no longer shake), the combo flourish, the boss intro state machine, the quality table |
| `docs/performance.md` | the harness, the before/after percentile tables per tier, the §9.D probe and why it never promotes |
| `docs/ui-system.md` | nav groups and the two-level nav, the card primitive, the shared modal shell and the focus trap, the quality control, portrait, and the new `## Capacitor` section |
| `docs/art-direction.md` | the §5.E literal → token mapping table, `mix` / `lighten`, and the rule that `critical` and `blood` are off-limits to the combo flourish |
| `docs/xp-talent-system.md` | the SVG link layer and the documented no-pinch deviation |
| `docs/camera-system.md` | `setDprCap` and the extents-unchanged rescale guard |
| `AGENTS.md` | index rows for any new doc; refresh the "Content at a glance" counts if any table grew |
| `plans/ui-improvements.md` | a short measured/status block per implemented part, matching the §1.5 precedent — the parent plan currently only records Part 1 |

---

## 11. Execution order, commits and risk

| # | Part | Depends on | Can run parallel with | Primary files |
|---|---|---|---|---|
| 5 | Effects & the additive layer | 3, 4 | 8 | `EffectsManager`, `Renderer`, `Game`, `types`, `palette`, `data/quality.ts` |
| 8 | Panels, tabs, modals | 2, 6, 7 | 5 | `UIManager`, `ui/navGroups.ts`, `ui/Modal.ts`, all panels, `main.css` |
| 9 | Mobile & Capacitor | 1, 5, 7, 8 | — | `index.html`, `tokens.css`, mobile CSS, `MobileSheet`, `BottomNav`, `SettingsPanel`, `Camera`, `Game` |
| 10 | Perf, tests, docs | all | — | `main.ts`, `tests/`, `docs/`, `AGENTS.md` |

Parts 5 and 8 touch disjoint files (`Renderer`/`EffectsManager` vs `ui/*`), with `Game.ts` the only
overlap — §5 edits the effect wiring and the intro state machine, §8 edits nothing in it. They may
be worked in either order or concurrently. Parts 9 and 10 are strictly last.

**Commit granularity:** follow the existing convention on this branch — one commit per sub-part with
a prose subject naming what changed and why, tagged with the plan section, e.g.
`Damage numbers: put them in screen space and give them a tier (UI plan Part 5.B)`. Each commit is
independently green on `typecheck` + `test` + `checks`.

**Highest-risk edits, in order:**

1. `EffectsManager` emitter loop bounds (§5.F) — 18 emitters, ~25 loops, and a wrong denominator
   silently turns a ring into an arc. Do them one emitter per diff hunk and eyeball each.
2. The `DamageNumber` shape change (§5.B) — 9 call sites, a removed field (`isHeal`) and a changed
   coordinate space. `tsc` catches the shape; only the tests catch the merge/`riseCss` rule.
3. The modal migration (§8.F) — seven adopters and three CSS shells collapsing into one. Migrate one
   modal per commit, keeping the old shell's CSS alive until the last adopter moves.
4. `Camera.setDprCap` (§9.D) — the enemy-rescale guard. Get the test in before the code.

**Per `CLAUDE.md`:** run `impact({target, direction: "upstream"})` on `EffectsManager.tick`,
`Renderer.draw`, `Game.draw`, `UIManager.showTab` and `Camera.resize` before touching them, report
the blast radius, and run `detect_changes()` before every commit.

---

## 12. Definition of done

Mapping back to the parent plan's §12, the four criteria still open:

4. *(icons)* — already met by Part 6, **except** `BottomNav`'s four ASCII glyphs. Closed by §8.A.
5. *(no literals)* — met in CSS; closed for the canvas and the UI modules by §5.E and enforced by the
   §10.C scan.
6. *(frame budget)* — measured, not asserted: §10.B's table shows ≥ 60 fps at `high` on desktop and
   ≥ 45 fps at `low` at a phone-class viewport with 250 enemies and saturated pools.
7. *(touch)* — closed by §9.A–§9.C: every target ≥ 44 px, safe-area respected, and no affordance
   reachable only by hover.
8. *(green + documented)* — `typecheck`, `test`, `checks` green, `sim` byte-identical across Part 5,
   and `docs/` updated per §10.D.

Plus two this document adds:

9. The nav is one information architecture, shared by desktop and mobile, driven by `NAV_GROUPS`.
10. Every modal in the game is the same shell: Escape closes it, Tab is trapped inside it, and focus
    returns where it came from.
