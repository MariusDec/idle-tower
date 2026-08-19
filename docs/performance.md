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

Everything genuinely animated is still drawn live and allocates nothing: the
wing flap (`drawWings`), the boss/splitter pulse (a transform around the blit),
the shield arcs, and the retribution ring. Pulsing auras scale the cached
sprite via `drawImage` rather than rebuilding the gradient.

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

## Verifying a change

```bash
npm run test
```

See [testing.md](testing.md). `tests/systems.test.ts` checks the grid against a
brute-force reference and the evolution cache against a fresh linear scan, so a
divergence fails rather than silently changing the game.
