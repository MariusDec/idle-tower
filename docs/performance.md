# Performance & Simulation Timing

How the game keeps a late wave (200+ enemies, several elites) inside a frame
budget, and which invariants the optimisations depend on. Implemented per the
improvements plan, Part 5.

## Fixed-timestep simulation

`Game.update(dt, realDt)` splits into two halves:

| Method | Cadence | Contains |
|---|---|---|
| `Game.simulate(step)` | fixed substeps of `FIXED_STEP` (1/60 s), up to `MAX_SUBSTEPS` (6) per frame | waves, resources, abilities, tower firing, projectiles, enemies, mines, shockwaves, shield recharge |
| `Game.frameUpdate(dt, realDt)` | once per frame | particles, notifications, automation, HUD tweening, research, auto-save, achievements, audio |

`dt` reaching `simulate` is the *game* delta — wall-clock delta clamped to
0.05 s, times game speed (up to 6.5x with the Accelerator TP perk), times the
slow-mo factor. Without substepping that is a single 0.325 s physics step in
the worst case, which quietly changes the game: enemy movement overshoots,
attack cadence coarsens, and the tower fires at most once per frame no matter
what its fire rate says.

The substep count is `ceil(dt / FIXED_STEP)`, clamped to `MAX_SUBSTEPS`. When
the clamp bites, the **step size grows rather than time being dropped** — the
simulation never runs in slow motion under load, it just gets coarser.

Measured DPS relative to 1x speed, 40 stationary targets:

| Condition | Before | After |
|---|---|---|
| 6.5x speed at 60 fps | −23.1% | +0.6% |
| 6.5x speed at 20 fps (sustained hitch) | −46.3% | −15.3% |

**Invariant:** anything time-integrated or cadence-driven belongs in
`simulate`. Anything that polls state, or that must run on wall-clock time
(research timers, auto-save), belongs in `frameUpdate`. Putting a `realDt`
consumer in `simulate` would make it run six times per frame at high speed.

## Renderer sprite cache

`Renderer` pre-renders static art to offscreen canvases keyed by variant, then
blits with `drawImage`:

| Cache | Key | Contents |
|---|---|---|
| `enemySprites` | type, elite, enraged | body fill, outline, glyph, tank inner ring, splitter core |
| `shadowSprites` | radius | ground ellipse gradient |
| `auraSprites` | boss/healer/elite + aura + radius | radial glow at unpulsed size |
| `crownSprites` | colour + size | elite crown glyph, including its blurred glow pass |
| `magicProjectileSprite` | — | magic bolt glow |
| `towerSprites` | family name (`'drum'`, `'turret'`, …) — see below | plinth, drum, arcane ring, turret, wall segment — the five tower painters whose art depends on the upgrade marks |

Everything genuinely animated is still drawn live and allocates nothing: the
wing flap (`drawWings`), the boss/splitter pulse (a transform around the blit),
the shield arcs, and the retribution ring. Pulsing auras scale the cached
sprite via `drawImage` rather than rebuilding the gradient.

`towerSprites` is kept apart from `partSprites` because the upgrade-mark key
space is **combinatorial** — seven dimensions, each up to six steps — while the
number of keys live at any one time is exactly one per family. `partSprites`
never evicts (correct there, a leak here), so the whole `towerSprites` map is
**dropped wholesale** the moment `towerSig` (`marks.key` + core + detail tier)
moves, and the five tower painters rebake lazily on the next frame. Marks
change a couple of dozen times across a long run; a rebake is five painters
and costs less than one frame of the per-frame gradients Part 5 of the UI
plan removed. **The invariant is that no mark-dependent sprite may go in
`partSprites`** — putting a tower sprite in the no-evict cache is a memory leak
measured in hundreds of megabytes by wave 30.

At 253 enemies with 12 elites this took `createRadialGradient` calls per frame
from **266 to 0**, and `drawEnemies` from 2.24 ms to 1.26 ms.

**Invariant:** if a visual detail varies per enemy *instance* (not per type),
it must not go in the body sprite. Add it to the live pass, or add it to the
sprite key.

## Spatial grid

`src/utils/SpatialGrid.ts` is a uniform grid. `EnemyManager` owns one
(`GRID_CELL_SIZE` = 128) and exposes `queryRadius(x, y, radius, out?)`.

### It is deliberately used in only some places

The plan (§5.4) assumed every radius query was an all-pairs `O(n^2)` scan.
Measured, most of them are not — the outer loop is over a *handful* of things
(aura elites, healers, mines), so they are `O(k x n)` with a small `k`, and a
flat array walk with an inlined distance test beats a hashed grid that has to
rebuild an `O(n)` index first.

Measured in one page load, grid versus the direct scan it would replace:

| Path | 64 enemies | 250 | 420 |
|---|---|---|---|
| Haste + vitality auras | **0.25x** | **0.40x** | **0.62x** |
| Mine detonation (15 mines) | — | 1.05x | 1.16x |
| Per-kill AoE (40 kills) | — | 1.36x | 1.29x |

So the grid backs only the paths where it wins:

| Uses the grid | Uses a direct scan |
|---|---|
| Mine detonation (`Game`) | Haste aura (`EnemyManager`) |
| AoE splash on hit (`Game`) | Vitality aura (`EnemyManager`) |
| Chain-kill AoE (`Game`) | Healer target search (`EnemyManager`) |
| Shockwave damage band (`Game`) | Retribution on elite death (`EnemyManager`) |
| Crit splash (`ProjectileManager`) | Shockwave displacement (`EnemyManager`) |

The wins are real but small in absolute terms — roughly 0.01-0.02 ms of a
~3 ms frame. The direct-scan sites carry a comment saying why they are not
using the grid, so the measurement is not re-litigated by the next reader.

### Invariants

- The index is **lazily rebuilt**: `gridStale` is set when the roster or any
  position changes, and `ensureGrid` re-indexes on the next query. A frame with
  no mines, splash or chain kills pays nothing.
- Any code that mutates enemy positions must set `gridStale`.
  `EnemyManager.tick` and `applyShockwave` do.
- **`queryRadius` returns a fresh array by default, and must.** It originally
  handed out one shared scratch buffer. Nearly every caller damages what it
  finds, and `damage` emits `enemy_killed` / `enemy_damaged`, whose handlers
  query again — so the inner query cleared and refilled the array the outer
  loop was still walking, silently skipping enemies from mine blasts, splash
  and chain kills. Pass `out` only where re-entrancy is provably impossible.

## Bounded effect pools

`EffectsManager` caps `particles` at 600 and `damageNumbers` at 80, evicting
oldest-first. Damage numbers landing within 16 px of a live one younger than
0.22 s are **merged** into it (amount added, float restarted) instead of
stacking — matched on kind, so a crit or heal keeps its own label.

Every particle emitter routes through `pushParticle`; every damage/heal label
through `pushDamageNumber`. Adding a new emitter that pushes directly onto the
arrays defeats the cap.

## Projectile lifetime

Projectiles retire on three conditions: hitting (with pierce exhausted),
leaving the play field by a 120 px margin (`setBounds`), or reaching
`MAX_PROJECTILE_AGE` (4 s). Every projectile ages, not just homing ones — the
age cap is what retires a shot that is pinned or circling a target it cannot
catch.

Seeking is cheaper than the steering it replaced. A homing shot re-scans for a
target with one spatial-grid `queryRadius` — into a scratch buffer shared by
every seeker, which is safe here precisely because the seek damages nothing, so
no handler can re-enter and refill it mid-loop — and only on the
`HOMING.retargetInterval` (0.12 s) cadence, or when its target dies, becomes
un-targetable, or gets pierced. Between scans the shot holds a cached `Enemy`
reference, so a steering step is two field reads. The old code resolved
`homingTargetId` with an O(enemies) `list.find` on **every** homing projectile
**every tick**, so even with acquisition added this is strictly less work.

## Save cadence

Nine game events (purchases, wave starts, research, ability upgrades…) used to
write the full JSON save synchronously. They now call
`SaveManager.requestSave()`, which only marks the state dirty;
`SaveManager.tick` flushes at most once per `SAVE_DEBOUNCE_SECONDS` (5 s), with
the 30 s `AUTO_SAVE_INTERVAL` as the backstop for a quiet session.

Anything that must survive an immediate close still calls `save()` directly —
notably the `visibilitychange` handler in `Game.bindVisibilityEvents`.

## Lookup caches

- `UPGRADE_BY_ID` (`src/data/upgrades.ts`) replaces `UPGRADES.find(...)` in
  every `UpgradeManager` cost/max/affordability path.
- `UpgradeManager` caches active evolutions in `activeEvolutionIds` (a set, for
  `hasEvolutionEffect`) and `activeEvolutionValues` (a map, for
  `getEvolutionEffectValue`), rebuilt by `rebuildEvolutionCache()` on every
  level mutation — construction, `buy`, `buyBulk`, `reset`, `replaceLevels`.
  `hasEvolutionEffect` is called several times per frame from `Game.simulate`.
- `xpToLevel` binary-searches the 2 000-entry `TOWER_XP_TABLE` instead of
  scanning it. It is called on every kill.

**Invariant:** any new writer of `UpgradeManager.levels` must call
`rebuildEvolutionCache()`.

## The budget harness (`__theTower.bench`)

UI plan §10.B. It lives in `src/main.ts` and hangs off the existing
`window.__theTower` global rather than adding a second one:

```js
await __theTower.bench({ enemies: 250, seconds: 10, tier: 'low' })
// → { tier, frames, p50, p95, worst, particles, enemies }   // ms per frame
```

What it does, and why each piece is there:

- **Enemies come from the real `EnemyManager.spawn`**, topped back up to
  `enemies` every frame, in a spread of six types. Spawning through the manager
  is the point: the spatial grid, the per-type sprite cache and the whole
  render path are exercised the way a busy wave exercises them, which a
  synthetic array of stubs would not do.
- **The particle pool is saturated**, not merely used: a 48-particle
  `emitDeathBurst` every third frame is ~960 particles/second against a ~1 s
  particle life, which overruns every tier's cap (600 / 360 / 200) even after
  `particleScale` has taken its cut. `particles` in the result is the check —
  if it comes back below the tier's cap, the run did not measure a full pool.
- **Samples are frame deltas from a rAF that rides alongside `Game`'s own
  loop**, so what is measured is the whole frame — update, draw, UI — as the
  player receives it.
- **The first 30 samples are discarded**, for the same reason the §9.D quality
  probe discards them: JIT warm-up and the first background bake are not the
  frame cost anyone lives with.
- **It puts the field back.** The enemies it spawned are spliced out by id and
  the tier is restored with `setQuality`, never `setQualityPreference` — a
  measurement must not persist itself as the player's choice.

`p50` at 60 Hz is vsync-clamped at ~16.7 ms, so the median reports *whether*
frames are being hit, not how much slack is left; `p95` and `worst` are where
the headroom shows.

### Measured 2026-08-27

Chromium (`--headless=new`, hardware GL), 250 enemies, 10 s per tier, pool
saturated at every tier. Milliseconds per frame.

**Before Part 5** — commit `0412584` (the parent of the first Part 5 commit) in
a scratch worktree. No quality tiers existed yet, so there is one row per DPR:

| viewport         | p50  | p95  | worst | particles |
|------------------|------|------|-------|-----------|
| 1280×800, DPR 1  | 16.7 | 18.1 | 21.2  | 600       |
| 1280×800, DPR 2  | 16.8 | 21.1 | 45.8  | 600       |

**After Parts 5 / 8 / 9:**

| viewport         | tier   | p50  | p95  | worst | particles |
|------------------|--------|------|------|-------|-----------|
| 1280×800, DPR 1  | high   | 16.7 | 18.1 | 21.2  | 599       |
| 1280×800, DPR 1  | medium | 16.7 | 18.1 | 21.0  | 360       |
| 1280×800, DPR 1  | low    | 16.7 | 18.0 | 20.6  | 200       |
| 1280×800, DPR 2  | high   | 16.7 | 19.1 | 35.6  | 600       |
| 1280×800, DPR 2  | medium | 16.6 | 19.0 | 27.9  | 360       |
| 1280×800, DPR 2  | low    | 16.6 | 18.6 | 22.7  | 199       |
| 375×812, DPR 2   | high   | 16.7 | 18.7 | 24.9  | 600       |
| 375×812, DPR 2   | medium | 16.6 | 18.3 | 21.8  | 360       |
| 375×812, DPR 2   | low    | 16.7 | 18.7 | 21.5  | 200       |

Every configuration holds 60 fps at the median with 250 enemies and a full
particle pool. Part 5 did not cost anything at DPR 1 and *improved* the DPR 2
tail (p95 21.1 → 19.1, worst 45.8 → 35.6) — the routed additive pass replaced
several `globalCompositeOperation` flips per frame with one.

**Caveats.** These are desktop-GPU numbers throughout; the 375×812 rows are a
phone-shaped *viewport* under CDP device emulation, not phone-class silicon, so
they bound the layout cost and say nothing about a mid-range Android's fill
rate. Software rasterisation (`--use-gl=swiftshader`) misses 60 fps at DPR 2
before the harness spawns anything, which is the rasteriser and not the game —
if a run shows the idle page already over budget, the number is not about this
codebase. And a headless tab whose pane is not composited throttles rAF to
roughly 1 Hz, which makes the harness unusable there; it needs a tab that is
actually painting.

## The quality probe (UI plan §9.D)

The harness above is a developer tool. The probe is what the player gets: a
one-shot, 2-second frame-time measurement that may demote the quality tier, and
may never promote it.

**Where the starting tier comes from.** `initialQualityTier()` guesses from
device signals only — `navigator.hardwareConcurrency` (≥ 8 cores for `high`, or
≥ 16 on a coarse pointer, ≥ 4 for `medium`, otherwise `low`), demoting a coarse
pointer above DPR 2 out of `high`. `readStoredQuality()` overrides that with the
player's stored preference; anything unrecognised falls back to `'auto'`.

**When it runs.** `Game.startQualityProbe()` is called on the first frame of
wave 1 of the session, and returns immediately unless the preference is
`'auto'`. `tickQualityProbe(realDt)` runs on the **wall clock**, not the
simulation clock.

**What it measures.** The first 30 frames are discarded (JIT warm-up and the
first background bake), then it accumulates `realDt` for 2 seconds and compares
the **mean** frame time against a budget: 22 ms (a 45 fps floor) when already at
`low`, 17 ms (60 fps) otherwise. Over budget demotes exactly one tier, clamping
at `low`. The mean and not the worst frame, because a single 40 ms hitch from a
save write or a sprite bake is not a reason to drop a desktop to `low`.

**When it gives up.** The probe is abandoned — set to `null`, never restarted —
if the document is hidden, or if the game speed is above 1×. Both would measure
something other than a real frame.

**Why it never promotes.** Promotion is a decision with a cost the player pays
and a benefit only they can judge, and a probe that could climb back would
oscillate on any load spike — a background tab, a save flush, a system update —
re-baking the background and the edge-glow sprites each time. So the probe fires
once per session, in one direction. Climbing back up is the Settings control's
job: the segmented `Auto / High / Medium / Low` control in `SettingsPanel`
writes an explicit preference, which disables the probe permanently for that
device, and the hint line under it reports the tier actually in force so an
`'auto'` run that was demoted is visible rather than mysterious.

## Verifying a change

```bash
npm run test
```

See [testing.md](testing.md). `tests/systems.test.ts` checks the grid against a
brute-force reference and the evolution cache against a fresh linear scan, so a
divergence fails rather than silently changing the game.
