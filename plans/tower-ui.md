# The Tower — Visible Upgrades

**Date:** 2026-08-27
**Branch:** `main`
**Owns:** `src/data/towerMarks.ts` (new), `src/data/tower.ts`, `src/types.ts`, `src/game/Game.ts`,
`src/game/Renderer.ts`, `src/systems/EffectsManager.ts`, `src/ui/UpgradePanel.ts`,
`src/styles/main.css`, `tests/tower-marks.test.ts` (new), `tests/content-coverage.test.ts`,
`docs/tower-system.md`, `docs/upgrade-system.md`, `docs/performance.md`, `docs/event-bus.md`,
`AGENTS.md`.

**Status:** implementation brief. Everything below is written to be executed by someone who has
not read the other plans in `plans/`. Each part restates what it owns, gives the exact code, and
names its own acceptance check.

---

## 0. The problem, in one paragraph

Buying `Sharper Arrows` for the fortieth time changes a number in a panel and nothing else. The
tower on the battlefield is the player's avatar and the only object on screen that is
unambiguously theirs, and it currently reacts to exactly two things: the run's **core** (the
crystal tint) and the **tower-XP level** (`TOWER_VISUAL.detailTiers` — merlons at L10, banners at
L25, an arcane ring at L50). Gold spent on damage, health, armour, range, crit, mana and gold
itself — the thing the player actually does minute to minute — is invisible.

This plan makes ten upgrade lines rebuild the tower as they are levelled. A player who has poured
everything into damage has a long, pronged, gold-chased barrel on a plain drum; a player who went
defence has a squat, buttressed, iron-plated keep with a stubby barrel. The silhouette becomes a
readout of the build.

### 0.1 Ground truth verified in the tree on 2026-08-27

| Fact | Where |
|---|---|
| The tower is painted from five methods: `drawTowerBase` → `paintPlinth`, `drawWall` → `getWallSegment`, `drawTowerTop` → `paintDrum`, `drawTurret`, `drawCoreCrystal` | `src/game/Renderer.ts:1526,1552,1682,1712,1783,1828,1952,2168` |
| All of it is **baked** into offscreen sprites via `Renderer.part(key, size, paint)` and blitted. A `createRadialGradient` in a per-frame loop is a bug here | `Renderer.ts:588` (`part`), `docs/performance.md` §"Renderer sprite cache" |
| `partSprites` is a `Map` that **never evicts**. Correct for a fixed variant space, fatal for a combinatorial one | `Renderer.ts:508` |
| The snapshot already carries presentation-only fields `coreId` and `towerLevel` | `src/types.ts:879`, `Game.ts:5032` |
| Level changes funnel through exactly two events, both emitted by `UpgradeManager` for `buy`, `buyBulk`, `reset` **and** `replaceLevels` | `src/systems/UpgradeManager.ts:153,154,189,190,260,269` |
| `TOWER_VISUAL.wallRadius`, `plinthRadius`, `shieldRadius` and `turretLength` are read **only** by `Renderer.ts`. `bodyRadius` is also read by `Game.ts` (floating-text offsets) and by `TOWER_HIT_RADIUS` | `grep` over `src/`, `tests/`, `sim/` |
| A `Shockwave` with no `damage` field is purely cosmetic — `EffectsManager.tick` only calls `onShockwaveDamage` when `s.damage` is set | `EffectsManager.ts:758` |
| A literal colour in `Renderer.ts`, `EffectsManager.ts`, `Game.ts` or `src/ui/*.ts` is a **failing test**. Only `'#ffffff'` and `'#000'` are whitelisted | `tests/palette.test.ts:188` |

### 0.2 Rules for every part below

1. **Green baseline or it does not land:** `npm run typecheck`, `npm test`, `npm run checks`.
   `npm run sim` must be **byte-identical** to `HEAD` — this plan touches nothing that feeds a
   balance curve, so any diff at all is a bug in the change.
2. **Presentation may not change simulation.** Every value added here is written by `Game` and
   read by `Renderer`. Nothing in the render path may branch on it for behaviour, and no
   `TOWER_VISUAL` constant may change value — the painters scale *inside* their own sprites.
3. **Tokens, not literals.** Every colour comes from `src/data/palette.ts` (`FX`, `INK`,
   `withAlpha`, `mix`, `lighten`). `'#ffffff'` and `'#000'` are the only exceptions.
4. **Everything static is baked.** Nothing added here may allocate per frame. The one animated
   addition (§D.7's conduit pulse) is a `globalAlpha` on a cached blit.
5. **Every drawn size goes through `entity()`** from `src/data/arena.ts`, like the code around it.
6. **Per the repo's `CLAUDE.md`:** run `impact({target, direction: "upstream"})` before editing any
   symbol named below and report the blast radius; run `detect_changes()` before each commit.

### 0.3 What is deliberately *not* in scope

- The **wall** (`wall` upgrade) and the **shield** (`defenseShield`) already have battlefield
  presence driven by their *stat*. §D.10 levels the wall's blocks; the shield is left alone,
  because its facet count is already the charge count and overloading it would make the charge
  unreadable.
- `thorns`, `lifesteal`, `healthRegen`, `landMines`, `pierce`, `splash`, `doubleShotChance`,
  `quickShotChance/Time`, `xpGain`, `goldOnKill`, `critGold`, `waveGold`, `abilityCostReduction`.
  These have no free anatomy left that would not collide with an existing signal. §A.4 is the
  recipe for adding one later; the whole point of the table shape is that adding an eleventh mark
  is a data edit plus one painter.

---

## 1. The idea

A **mark** is a small integer, 0..N, derived from one or two upgrade levels by a threshold table.
It is *not* a stat and nothing reads it for behaviour. Ten marks are computed once whenever levels
change, frozen into an object with a precomputed cache key, handed to the renderer in the
snapshot, and used both to select what the tower painters draw **and** to invalidate the sprites
they baked.

```
UpgradeManager.buy()
  └─ emit 'upgrade_purchased' ─→ Game.refreshTowerMarks(announce: true)
  └─ emit 'upgrades_changed'  ─→ Game.refreshTowerMarks(announce: false)
                                    │
                                    ├─ computeTowerMarks(levels) → frozen TowerMarks {key, steps}
                                    ├─ diff vs previous → emit 'tower_mark_changed' per step gained
                                    │                      └─ toast + EffectsManager.emitTowerForge()
                                    └─ stored on Game, put in every RenderSnapshot
                                                        │
                                              Renderer.draw()
                                                        ├─ signature changed? → towerSprites.clear()
                                                        └─ painters read this.marks.steps.*
```

### 1.1 The mark → anatomy map

Each mark owns a **distinct piece of the tower**, so ten marks compose into one object instead of
fighting over the same pixels.

| Mark | Fed by | Anatomy it rebuilds | Painted in |
|---|---|---|---|
| `barrel` | `damage` | the turret barrel — length, bands, blade, prongs, inlay | `drawTurret` |
| `autoloader` | `fireRate` | magazine drums and feed rails at the breech | `drawTurret` |
| `optics` | `critChance` + `critDamage` | sight post, scope tube, lens and crosshair | `drawTurret` |
| `masonry` | `health` | courses, merlon count, arrow slits, parapet, buttresses | `paintDrum`, `paintPlinth` |
| `plating` | `defense` + `armor` | riveted iron straps, girdle plate, faceted plate ring | `paintDrum` |
| `gilding` | `goldMulti` + `prospecting` | gilded joints, filigree, coin studs, banner fringe | `paintDrum` |
| `conduits` | `manaRegen` + `maxMana` | violet channels feeding the crystal, and a live pulse | `paintDrum`, `drawTowerTop` |
| `mast` | `range` | a spotter's mast, pennant, lantern; ticks on the range rim | `paintDrum`, `drawRangeRing` |
| `resonator` | `shockwave` | raised emitter rings on the plinth face | `paintPlinth` |
| `bulwark` | `wall` | merlon caps, thicker blocks, iron banding on the wall ring | `getWallSegment` |

Colour discipline, per `docs/art-direction.md`:

- Stone is the `INK` ramp (`TOWER_VISUAL.stoneLit/Mid/Dark/Deep`, `mortar`, `plinth`).
- Everything the player *owns* is `FX.gold` (`TOWER_VISUAL.rim`, `TOWER_VISUAL.banner`).
- Iron plate is `INK['200']` — colder and brighter than stone, so plating reads as a different
  material rather than as lighter masonry.
- Mana conduits are `FX.mana`. Resonator nodes are `FX.frost` (its evolution is a slow).
- **`FX.blood` and `FX.critical` appear nowhere in this plan.** Blood means "an enemy" and
  critical means "the tower is in peril"; a purchase is the opposite of both.

### 1.2 Why thresholds and not "every level"

Measured with the shipping tables through `sim/model.ts` (greedy buyer, marksman, idle, no risk,
2026-08-27) the levels a run actually reaches are:

| Wave | 5 | 10 | 20 | 30 | 50 | 75 | 100 | 125 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `damage` (fresh run) | 4 | 10 | 21 | 30 | 44 | 63 | 81 | 96 |
| `damage` (6x prestige) | 10 | 20 | 31 | 40 | 57 | 77 | 93 | 107 |
| `fireRate` (fresh) | 0 | 2 | 7 | 11 | 20 | 31 | 42 | 45 (cap) |
| `goldMulti` (fresh) | 0 | 0 | 0 | 0 | 5 | 15 | 29 | 40 |

Repainting on every level would mean a rebake every ~20 seconds for a change nobody can see. The
thresholds in §A.2 are picked off this table so that **the first step of the two lines the player
buys from wave one lands inside the first ten waves**, and the last step is reachable but not
guaranteed — six barrel steps across a run that reaches `damage` L96–L107.

---

## 2. Part A — the mark table

### A.1 New file: `src/data/towerMarks.ts`

Create it exactly as below.

```ts
import type { IconId } from './icons';

/**
 * Upgrade levels, made visible on the tower itself (`plans/tower-ui.md`).
 *
 * A **mark** is a small integer 0..N derived from one or two upgrade levels by
 * a threshold table. It is presentation only: `Game` computes it, the snapshot
 * carries it, `Renderer` paints with it, and *nothing anywhere may branch on it
 * for behaviour*. The tower's `detailTiers` do the same job for tower-XP level;
 * this is the same idea for the thing the player spends gold on.
 *
 * The table is the whole feature. Each mark owns one piece of the tower's
 * anatomy — the barrel, the masonry, the plating — so ten of them compose into
 * one object instead of overpainting each other. Adding an eleventh is a row
 * here plus one painter in `Renderer.ts`; `tests/content-coverage.test.ts`
 * fails until the painter exists.
 */
export type TowerMarkId =
  | 'barrel'
  | 'autoloader'
  | 'optics'
  | 'masonry'
  | 'plating'
  | 'gilding'
  | 'conduits'
  | 'mast'
  | 'resonator'
  | 'bulwark';

export interface TowerMarkDef {
  id: TowerMarkId;
  /** Upgrade ids whose levels feed this mark. */
  sources: readonly string[];
  /** How several sources become one number before the thresholds are applied. */
  combine: 'max' | 'sum';
  /**
   * Ascending level thresholds. The mark's step is how many of them the
   * combined level has reached, so `steps.length` is the highest step.
   */
  thresholds: readonly number[];
  /** Player-facing name of the piece that changes. Used by the toast. */
  part: string;
  /** Icon for the toast and the upgrade-panel hint. */
  icon: IconId;
  /**
   * One line per step, `announce[0]` describing the move to step 1. Length must
   * equal `thresholds.length` — `tests/tower-marks.test.ts` asserts it.
   */
  announce: readonly string[];
}

/**
 * The ten marks, in the order they are packed into the cache key.
 *
 * The thresholds are read off `sim/model.ts` — see `plans/tower-ui.md` §1.2 for
 * the measured level-by-wave table they were picked against. In short: the
 * first step of `barrel` and `masonry` lands inside the first ten waves because
 * those are the two lines a player buys from wave one, and the last step of
 * each is reachable in a long run without being guaranteed.
 */
export const TOWER_MARKS: readonly TowerMarkDef[] = [
  {
    id: 'barrel',
    sources: ['damage'],
    combine: 'max',
    thresholds: [4, 12, 25, 45, 75, 120],
    part: 'Turret',
    icon: 'crossbow',
    announce: [
      'the barrel is bored out and braced',
      'a dorsal blade is welded along the shaft',
      'the breech gains a reinforcing sleeve',
      'twin prongs are forged onto the muzzle',
      'gold inlay is chased down the barrel',
      'a charged channel is cut through the core',
    ],
  },
  {
    id: 'autoloader',
    sources: ['fireRate'],
    combine: 'max',
    thresholds: [6, 16, 30],
    part: 'Autoloader',
    icon: 'imbricated-arrows',
    announce: [
      'a magazine drum is mounted at the breech',
      'a second drum and a pair of feed rails',
      'the drums are wound to the core',
    ],
  },
  {
    id: 'optics',
    sources: ['critChance', 'critDamage'],
    combine: 'sum',
    thresholds: [8, 22, 45],
    part: 'Sights',
    icon: 'dead-eye',
    announce: [
      'a sight post and a rear notch',
      'a scope tube is fitted over the barrel',
      'the lens is ground and cross-etched',
    ],
  },
  {
    id: 'masonry',
    sources: ['health'],
    combine: 'max',
    thresholds: [5, 15, 30, 55, 90],
    part: 'Masonry',
    icon: 'stone-wall',
    announce: [
      'four buttresses are set into the footing',
      'a second kerb and capped merlons',
      'a belt course rings the drum',
      'sixteen merlons, each with an arrow slit',
      'a parapet skirt and a stepped footing',
    ],
  },
  {
    id: 'plating',
    sources: ['defense', 'armor'],
    combine: 'sum',
    thresholds: [15, 45, 100],
    part: 'Plating',
    icon: 'layered-armor',
    announce: [
      'four iron straps are riveted over the stone',
      'eight straps and a girdle plate',
      'the outer course is faced in plate',
    ],
  },
  {
    id: 'gilding',
    sources: ['goldMulti', 'prospecting'],
    combine: 'sum',
    thresholds: [8, 22, 45],
    part: 'Gilding',
    icon: 'gold-bar',
    announce: [
      'the joints are gilded',
      'filigree is scrolled above the belt course',
      'coin studs are set around the drum',
    ],
  },
  {
    id: 'conduits',
    sources: ['manaRegen', 'maxMana'],
    combine: 'sum',
    thresholds: [6, 18, 40],
    part: 'Conduits',
    icon: 'magic-swirl',
    announce: [
      'three channels are cut to the crystal well',
      'six channels and a collector ring',
      'the channels branch, and begin to pulse',
    ],
  },
  {
    id: 'mast',
    sources: ['range'],
    combine: 'max',
    thresholds: [6, 18, 35],
    part: 'Mast',
    icon: 'telescope',
    announce: [
      "a spotter's mast rises from the drum",
      'a pennant and a lookout lantern',
      'a second mast, and ticks on the range rim',
    ],
  },
  {
    id: 'resonator',
    sources: ['shockwave'],
    combine: 'max',
    thresholds: [1, 15, 35],
    part: 'Resonator',
    icon: 'echo-ripples',
    announce: [
      'an emitter ring is laid into the footing',
      'a second ring and four emitter nodes',
      'three rings, and the nodes take a charge',
    ],
  },
  {
    id: 'bulwark',
    sources: ['wall'],
    combine: 'max',
    thresholds: [1, 10, 22],
    part: 'Bulwark',
    icon: 'brick-wall',
    announce: [
      'the wall blocks are crowned with merlons',
      'the courses are laid thicker',
      'iron banding and spiked crowns',
    ],
  },
];

export const TOWER_MARK_BY_ID: Record<TowerMarkId, TowerMarkDef> =
  Object.fromEntries(TOWER_MARKS.map(m => [m.id, m])) as Record<TowerMarkId, TowerMarkDef>;

/** The mark ids, in table order. */
export const TOWER_MARK_IDS: readonly TowerMarkId[] = TOWER_MARKS.map(m => m.id);

export type TowerMarkSteps = Readonly<Record<TowerMarkId, number>>;

/**
 * What the snapshot carries and the renderer keys its sprite cache on.
 *
 * `key` is precomputed rather than derived on demand for one reason: the
 * renderer needs to know "did this change" every frame, and building a string
 * sixty times a second to answer it would allocate sixty strings a second for a
 * fact that changes a couple of dozen times in a whole run. It is built once,
 * here, when the marks are.
 */
export interface TowerMarks {
  readonly key: string;
  readonly steps: TowerMarkSteps;
}

/** Step of one mark, given the combined source level. */
function stepFor(def: TowerMarkDef, level: number): number {
  let step = 0;
  for (const at of def.thresholds) {
    if (level >= at) step++;
    else break;
  }
  return step;
}

/**
 * Marks for a set of upgrade levels.
 *
 * Allocates — call it when levels change, never per frame. `Game` holds the
 * result and hands the same frozen object to every snapshot until the next
 * purchase.
 */
export function computeTowerMarks(levels: Record<string, number>): TowerMarks {
  const steps = {} as Record<TowerMarkId, number>;
  let key = '';
  for (const def of TOWER_MARKS) {
    let level = 0;
    if (def.combine === 'sum') {
      for (const id of def.sources) level += levels[id] ?? 0;
    } else {
      for (const id of def.sources) level = Math.max(level, levels[id] ?? 0);
    }
    const step = stepFor(def, level);
    steps[def.id] = step;
    key += step;
    key += '.';
  }
  return Object.freeze({ key, steps: Object.freeze(steps) });
}

/** Every mark at step 0. The tower a fresh save paints. */
export const DEFAULT_TOWER_MARKS: TowerMarks = computeTowerMarks({});
```

### A.2 Threshold rationale, so a re-tune is not a guess

| Mark | Thresholds | Reached at roughly (fresh run) |
|---|---|---|
| `barrel` | 4, 12, 25, 45, 75, 120 | waves 5, 12, 24, 51, 90, never-to-late |
| `masonry` | 5, 15, 30, 55, 90 | `health` is priced near `damage` (25/1.15 vs 8/1.18 — L26 of health costs what L30 of damage does), but it is a secondary spend, so the ladder is deliberately one notch behind the barrel's |
| `autoloader` | 6, 16, 30 | waves 18, 42, 72 — `fireRate` caps at L45 around wave 100, so step 3 is the "line is nearly maxed" mark |
| `optics` | 8, 22, 45 | combined cap is 40 + 50 = 90, so step 3 is halfway to both caps |
| `plating` | 15, 45, 100 | combined cap 150 + 160 = 310; these lines are cheap per level and bought in bulk |
| `gilding` | 8, 22, 45 | combined cap 50 + 20 = 70; `goldMulti` first appears around wave 40 in the sim |
| `conduits` | 6, 18, 40 | combined cap 60 + 40 = 100 |
| `mast` | 6, 18, 35 | cap 50 |
| `resonator` | 1, 15, 35 | cap 60. **Step 1 at level 1** — the line is a single deliberate purchase and buying it at all should show |
| `bulwark` | 1, 10, 22 | cap 35, same reasoning as `resonator` |

**If you re-tune:** the only constraint the code enforces is `thresholds` ascending and
`announce.length === thresholds.length`. Everything else is taste.

---

## 3. Part B — plumbing

### B.1 `src/types.ts`

Add the import at the top, beside the existing three:

```ts
import type { TowerMarks } from './data/towerMarks';
```

Add the field to `RenderSnapshot`, immediately after `towerLevel` (`src/types.ts:923`):

```ts
  /**
   * Upgrade levels made visible on the tower (`plans/tower-ui.md`).
   *
   * Ten small integers derived from upgrade levels by a threshold table, and a
   * precomputed key the renderer compares to know when to drop the sprites it
   * baked. `Game` rebuilds this object only when levels change, so the renderer
   * can compare it by identity. Presentation only — nothing in the render path
   * may branch on it for behaviour.
   */
  towerMarks?: TowerMarks;
```

### B.2 `src/game/Game.ts`

**Import** (with the other `src/data` imports near the top):

```ts
import {
  computeTowerMarks, TOWER_MARK_BY_ID, DEFAULT_TOWER_MARKS,
  type TowerMarkId, type TowerMarks,
} from '../data/towerMarks';
```

**Field** — put it beside `upgradeMgr` (`Game.ts:436`):

```ts
  /**
   * The tower's upgrade marks (`plans/tower-ui.md`).
   *
   * Rebuilt only when upgrade levels change, and handed to every snapshot as
   * the same frozen object in between, so the renderer's "has this changed"
   * check is a reference compare rather than sixty string builds a second.
   */
  private towerMarks: TowerMarks = DEFAULT_TOWER_MARKS;
```

**Method** — put it next to `applyUpgradeEffects` (`Game.ts:3388`):

```ts
  /**
   * Recompute the tower's upgrade marks, and announce any that stepped up.
   *
   * `announce` is false on every path that is not a purchase — a save load, an
   * ascension reset, a `replaceLevels` — because those move every mark at once
   * and a wall of ten toasts on page load is not a reward, it is noise. The
   * purchase path is the only one that earns the flourish.
   *
   * Reads `upgradeMgr.snapshot()` rather than `state.upgrades` so it is correct
   * whichever of the two level events called it: `UpgradeManager` emits
   * `upgrade_purchased` *before* `upgrades_changed`, so `state.upgrades` is one
   * event stale at the moment the announcement has to be made.
   */
  private refreshTowerMarks(announce: boolean): void {
    const next = computeTowerMarks(this.upgradeMgr.snapshot());
    if (next.key === this.towerMarks.key) return;
    const prev = this.towerMarks;
    this.towerMarks = next;
    if (!announce) return;
    const t = this.tower.snapshot;
    let flourished = false;
    for (const id of Object.keys(next.steps) as TowerMarkId[]) {
      const step = next.steps[id];
      if (step <= prev.steps[id]) continue;
      const def = TOWER_MARK_BY_ID[id];
      this.bus.emit('tower_mark_changed', { id, step, def });
      this.bus.emit('toast', {
        kind: 'milestone',
        text: `${def.part}: ${def.announce[step - 1]}.`,
        life: 4,
      });
      // One flourish per purchase, however many marks a bulk buy crossed —
      // ten overlapping rings is a smear, not a moment.
      if (!flourished) {
        this.effects.emitTowerForge(t.x, t.y, TOWER_VISUAL.plinthRadius);
        flourished = true;
      }
    }
  }
```

> `TOWER_VISUAL` is already imported in `Game.ts` (it is used for the floating-text offsets at
> `Game.ts:824`). `this.effects` is the `EffectsManager`; `this.tower.snapshot` is the
> `TowerState`. Both are existing fields.

**Wiring** — in the two existing handlers (`Game.ts:1607` and `Game.ts:1614`):

```ts
    this.bus.on('upgrades_changed', (levels: Record<string, number>) => {
      this.state.upgrades = { ...(levels as Record<string, number>) };
      this.applyUpgradeEffects();
      // Silent: this event also fires on reset and on load.
      this.refreshTowerMarks(false);
    });
    this.bus.on('upgrade_purchased', (payload: unknown) => {
      const p = payload as { levelsGained?: number; goldSpent?: number };
      this.state.stats.totalUpgradesPurchased += Math.max(1, p.levelsGained ?? 1);
      if (p.goldSpent && p.goldSpent > 0) {
        this.contractMgr.note({ kind: 'gold_spent', amount: p.goldSpent });
      }
      // The only path that earns the toast and the forge flourish.
      this.refreshTowerMarks(true);
    });
```

Add one silent seed at the end of the constructor, immediately after the existing
`this.applyUpgradeEffects()` at `Game.ts:798`, so a fresh boot with `startLevel: 1` on `damage`
and `health` is correct before the first purchase:

```ts
    this.refreshTowerMarks(false);
```

**Snapshot** — in `Game.draw()` (`Game.ts:5033`), after `towerLevel`:

```ts
      towerLevel: this.state.towerXp.level,
      // Presentation only (`plans/tower-ui.md`): upgrade levels, as a tower.
      towerMarks: this.towerMarks,
```

**Acceptance for Part B:** `npm run typecheck` clean. In the browser, `console.log` inside
`refreshTowerMarks` fires once on boot with `key === '0.0.0.0.0.0.0.0.0.0.'` and again on the
first `damage` purchase that reaches L4.

---

## 4. Part C — the renderer's second sprite cache

`partSprites` never evicts, which is exactly right for its current key space (a couple of dozen
sprites, all baked on first use, none re-baked while the run lasts) and exactly wrong for this
one. The drum sprite is `(bodyRadius + entity(30)) * 2 ≈ 197` px square — about **155 KB** of
backing store each — and the mark key space is `7 x 4 x 4 x 6 x 4 x 4 x 4 x 4` combinations. Baked
into `partSprites` that is a memory leak measured in hundreds of megabytes.

The fix is a second map that is **dropped wholesale** whenever the signature moves. Marks change a
couple of dozen times across a long run; a rebake is five painters and costs less than one frame
of the per-frame gradients Part 3 of the UI plan already removed.

### C.1 New state on `Renderer`

Add beside the `partSprites` declaration (`Renderer.ts:508`):

```ts
  /**
   * Sprites whose art depends on the tower's upgrade marks
   * (`plans/tower-ui.md` §C).
   *
   * Kept apart from `partSprites` because the key space is *combinatorial*
   * while the number of keys live at any one time is exactly one per family.
   * `partSprites` never evicts — correct there, a leak here. So the whole map
   * is dropped the moment `towerSig` moves, and the five tower painters rebake
   * lazily on the next frame.
   */
  private readonly towerSprites = new Map<string, HTMLCanvasElement>();
  /**
   * The marks the tower is currently painted from. Replaced by reference at
   * the top of `draw`; the painters read it instead of threading a parameter
   * through five call sites.
   */
  private marks: TowerMarks = DEFAULT_TOWER_MARKS;
  /** `marks.key` + core + detail tier — everything the tower's art depends on. */
  private towerSig = '';
```

Add the import beside the existing `TOWER_VISUAL` one (`Renderer.ts:5`):

```ts
import { DEFAULT_TOWER_MARKS, type TowerMarks } from '../data/towerMarks';
```

### C.2 The accessor

Add directly under `part()` (`Renderer.ts:588`):

```ts
  /**
   * The same as `part()`, but in the evictable tower cache.
   *
   * Keys here are plain family names (`'drum'`, `'turret'`) with no variant
   * suffix: the map only ever holds sprites for the *current* signature,
   * because `syncTowerMarks` empties it when the signature moves.
   */
  private towerPart(
    key: string,
    size: number,
    paint: (g: CanvasRenderingContext2D) => void,
  ): HTMLCanvasElement {
    const cached = this.towerSprites.get(key);
    if (cached) return cached;
    const sprite = this.makeSprite(size, paint);
    this.towerSprites.set(key, sprite);
    return sprite;
  }

  /**
   * Adopt this frame's marks, and drop the baked tower if anything about its
   * art changed. One string compare and, a couple of dozen times per run, a
   * `Map.clear()`.
   */
  private syncTowerMarks(snap: RenderSnapshot): void {
    this.marks = snap.towerMarks ?? DEFAULT_TOWER_MARKS;
    const sig = `${this.marks.key}${this.core}|${this.towerTier(snap)}`;
    if (sig === this.towerSig) return;
    this.towerSig = sig;
    this.towerSprites.clear();
  }
```

### C.3 Call it

In `draw()` (`Renderer.ts:695` region), immediately after `this.core = this.coreOf(snapshot);` and
**before** `this.advance(snapshot)`:

```ts
    this.core = this.coreOf(snapshot);
    this.syncTowerMarks(snapshot);
    this.advance(snapshot);
```

### C.4 The barrel length helper

`drawTurret`, `drawMuzzleFlash` and `drawTracers` all place things at
`TOWER_VISUAL.turretLength`. §D.1 makes the barrel grow, so all three must agree. Add next to
`towerTier` (`Renderer.ts:613`):

```ts
  /**
   * The barrel's drawn length this frame.
   *
   * `TOWER_VISUAL.turretLength` is the *unupgraded* length and stays a
   * constant — §D.1 grows the barrel by painting a longer one, and the muzzle
   * flash and the tracers have to be placed at the tip of what was actually
   * drawn or they detach from it.
   */
  private get drawnTurretLength(): number {
    return TOWER_VISUAL.turretLength * (1 + this.marks.steps.barrel * 0.045);
  }
```

Then in `drawMuzzleFlash` (`Renderer.ts:2036`) replace:

```ts
    const len = TOWER_VISUAL.turretLength;
```

with:

```ts
    const len = this.drawnTurretLength;
```

and in `drawTracers` (`Renderer.ts:2121`) replace:

```ts
      ctx.translate(TOWER_VISUAL.turretLength, 0);
```

with:

```ts
      ctx.translate(this.drawnTurretLength, 0);
```

### C.5 Move the five tower painters onto `towerPart`

Mechanical, no behaviour change yet. Do this before writing any painter, and verify the tower
looks identical.

| At | Replace | With |
|---|---|---|
| `drawTowerBase` (~`Renderer.ts:1546`) | `this.part('tower-plinth', TOWER_VISUAL.plinthRadius * 2.3, (g) => {` | `this.towerPart('plinth', TOWER_VISUAL.plinthRadius * 2.7, (g) => {` |
| `getWallSegment` (~`Renderer.ts:1716`) | `return this.part(\`wall\|${state}\`, size, (g) => {` | `return this.towerPart(\`wall\|${state}\`, size, (g) => {` |
| `drawTowerTop` (~`Renderer.ts:1789`) | `this.part(\`tower-drum\|${tier}\`, (TOWER_VISUAL.bodyRadius + entity(24)) * 2, (g) => {` | `this.towerPart('drum', (TOWER_VISUAL.bodyRadius + entity(30)) * 2, (g) => {` |
| `drawTowerTop` (~`Renderer.ts:1795`) | `this.part(\`tower-ring\|${core}\`, …` | `this.towerPart('arcane-ring', …` |
| `drawTurret` (~`Renderer.ts:1956`) | `this.part(\`turret\|${tier}\|${core}\`, (len + entity(12)) * 2, (g) => {` | `this.towerPart('turret', (len + entity(20)) * 2, (g) => {` |

`tower-shadow`, `tower-flash`, `shield-pip`, `muzzle|*`, `tracer|*` and everything enemy-side stay
in `partSprites` — none of them depend on a mark.

**Acceptance for Part C:** the tower is pixel-identical to `HEAD`. `npm run typecheck` and
`npm test` clean. In the browser console, `performance.memory` (Chromium) does not climb across a
hundred purchases.

---

## 5. Part D — the painters

Every snippet below goes inside a `towerPart` painter, so `g` is an offscreen 2D context already
translated so that `(0, 0)` is the tower's centre. Read the mark steps from `this.marks.steps`.

Two shared locals every painter uses:

```ts
const light = TOWER_VISUAL.lightAngle;   // radians, up and a little left
const R = TOWER_VISUAL.bodyRadius;       // the drum's radius
```

and the standard lighting term for a wedge whose middle is at angle `a`:

```ts
const lit = 0.5 + 0.5 * Math.cos(a - light);   // 1 on the lit side, 0 on the dark
```

Every new piece must use it. A consistent key light is most of what separates "drawn" from
"assembled from primitives", and it is the reason the existing tower reads as an object.

### D.1 `barrel` — the turret (steps 0..6)

Replace the whole of `drawTurret` (`Renderer.ts:1952`) with:

```ts
  /**
   * The turret: it points where the tower is shooting, kicks back when it does,
   * and flashes at the muzzle (UI plan §3.3) — and it is rebuilt as `damage`,
   * `fireRate` and the crit lines are levelled (`plans/tower-ui.md` §D.1–3).
   *
   * The heading is read off the projectiles, so the barrel is aimed by the same
   * fact that aimed the shot rather than by a copy of the targeting rules.
   */
  private drawTurret(ctx: CanvasRenderingContext2D, snap: RenderSnapshot, tier: number, core: CoreId): void {
    const t = snap.tower;
    const tint = CORE_BY_ID[core].color;
    const m = this.marks.steps;
    const b = m.barrel;
    const len = this.drawnTurretLength;
    const sprite = this.towerPart('turret', (len + entity(20)) * 2, (g) => {
      const w = TOWER_VISUAL.turretWidth * (1 + b * 0.03);
      const base = entity(3);

      // §D.2: the autoloader sits under the barrel, at the breech.
      this.paintAutoloader(g, base, w, len, m.autoloader, tint);

      // Underside first, so the barrel sits on its own shadow.
      g.fillStyle = withAlpha(INK['950'], 0.55);
      g.beginPath();
      g.moveTo(base, -w * 0.5 + entity(2));
      g.lineTo(len, -w * 0.34 + entity(2));
      g.lineTo(len, w * 0.34 + entity(2.5));
      g.lineTo(base, w * 0.5 + entity(2.5));
      g.closePath();
      g.fill();

      // b >= 3: a reinforcing sleeve at the breech. Painted before the shaft so
      // the shaft's outline crosses it and the two read as one assembly.
      if (b >= 3) {
        g.fillStyle = TOWER_VISUAL.stoneMid;
        g.fillRect(base - entity(2), -w * 0.78, (len - base) * 0.36, w * 1.56);
        g.strokeStyle = withAlpha(INK['950'], 0.8);
        g.lineWidth = entity(1.4);
        g.strokeRect(base - entity(2), -w * 0.78, (len - base) * 0.36, w * 1.56);
        g.strokeStyle = withAlpha(TOWER_VISUAL.rim, 0.4);
        g.lineWidth = entity(1.2);
        g.beginPath();
        g.moveTo(base - entity(2), -w * 0.78 + entity(1));
        g.lineTo(base - entity(2) + (len - base) * 0.36, -w * 0.78 + entity(1));
        g.stroke();
      }

      g.fillStyle = TOWER_VISUAL.stoneLit;
      g.beginPath();
      g.moveTo(base, -w * 0.5);
      g.lineTo(len, -w * 0.34);
      g.lineTo(len, w * 0.34);
      g.lineTo(base, w * 0.5);
      g.closePath();
      g.fill();
      // A dark outline, because the barrel is stone on stone and needs a
      // silhouette of its own to read at this zoom.
      g.strokeStyle = withAlpha(INK['950'], 0.85);
      g.lineWidth = entity(1.6);
      g.stroke();
      // Lit top edge.
      g.strokeStyle = withAlpha(TOWER_VISUAL.rim, 0.65);
      g.lineWidth = entity(1.6);
      g.beginPath();
      g.moveTo(base, -w * 0.5 + entity(0.9));
      g.lineTo(len, -w * 0.34 + entity(0.9));
      g.stroke();

      // b >= 2: a dorsal blade along the top of the shaft. This is the first
      // change that alters the *silhouette* rather than the surface, which is
      // why it is early in the ladder.
      if (b >= 2) {
        g.fillStyle = TOWER_VISUAL.stoneMid;
        g.beginPath();
        g.moveTo(base + (len - base) * 0.24, -w * 0.5);
        g.lineTo(len - entity(3), -w * 0.5 - entity(4.5));
        g.lineTo(len - entity(3), -w * 0.34);
        g.closePath();
        g.fill();
        g.strokeStyle = withAlpha(INK['950'], 0.8);
        g.lineWidth = entity(1.1);
        g.stroke();
        g.strokeStyle = withAlpha(TOWER_VISUAL.rim, 0.5);
        g.lineWidth = entity(1);
        g.beginPath();
        g.moveTo(base + (len - base) * 0.24, -w * 0.5);
        g.lineTo(len - entity(3), -w * 0.5 - entity(4.5));
        g.stroke();
      }

      // Amber banding. More bands as the line is levelled: the barrel is
      // reinforced, not merely longer.
      const bands = b >= 5 ? [0.22, 0.4, 0.58, 0.74, 0.87]
        : b >= 3 ? [0.28, 0.5, 0.7, 0.86]
          : b >= 1 ? [0.3, 0.55, 0.8]
            : tier >= 2 ? [0.32, 0.58, 0.8] : [0.4, 0.72];
      g.fillStyle = withAlpha(TOWER_VISUAL.rim, 0.55);
      for (const at of bands) {
        const x = base + (len - base) * at;
        g.fillRect(x, -w * 0.5, entity(2.4), w);
      }

      // b >= 5: gold inlay chased along the shaft, between the bands.
      if (b >= 5) {
        g.strokeStyle = withAlpha(TOWER_VISUAL.rim, 0.45);
        g.lineWidth = entity(1);
        for (let i = 0; i < 6; i++) {
          const x = base + (len - base) * (0.16 + i * 0.13);
          g.beginPath();
          g.moveTo(x, -w * 0.34);
          g.lineTo(x + entity(4), w * 0.34);
          g.stroke();
        }
      }

      // b >= 6: a charged channel cut down the middle, fed by the core.
      if (b >= 6) {
        g.fillStyle = withAlpha(tint, 0.55);
        g.fillRect(base + entity(2), -w * 0.12, len - base - entity(4), w * 0.24);
        g.fillStyle = withAlpha(INK['050'], 0.35);
        g.fillRect(base + entity(2), -w * 0.05, len - base - entity(4), w * 0.1);
      }

      // The muzzle collar, in the core's colour, so the shot's colour is
      // announced before it leaves. It thickens at the top of the ladder.
      const collar = b >= 6 ? entity(6) : entity(3);
      g.fillStyle = withAlpha(tint, 0.85);
      g.fillRect(len - collar, -w * 0.4, collar, w * 0.8);

      // b >= 1: a muzzle brake — two notches cut across the collar.
      if (b >= 1) {
        g.fillStyle = withAlpha(INK['950'], 0.75);
        g.fillRect(len - collar - entity(3), -w * 0.5, entity(1.6), w);
        g.fillRect(len - collar - entity(7), -w * 0.5, entity(1.6), w);
      }

      // b >= 4: twin prongs, swept forward off the muzzle. The heaviest
      // silhouette change on the ladder — this is what a maxed barrel is.
      if (b >= 4) {
        g.fillStyle = TOWER_VISUAL.stoneLit;
        g.strokeStyle = withAlpha(INK['950'], 0.85);
        g.lineWidth = entity(1.2);
        for (const dir of [-1, 1]) {
          g.beginPath();
          g.moveTo(len - entity(6), dir * w * 0.34);
          g.lineTo(len + entity(8), dir * (w * 0.62 + (b >= 6 ? entity(3) : 0)));
          g.lineTo(len + entity(3), dir * w * 0.28);
          g.closePath();
          g.fill();
          g.stroke();
        }
      }

      // Tier 2+: side vanes, so a levelled *tower* has a heavier silhouette
      // too. This is the tower-XP tier, not a mark — leave it alone.
      if (tier >= 2) {
        g.fillStyle = TOWER_VISUAL.stoneDark;
        for (const dir of [-1, 1]) {
          g.beginPath();
          g.moveTo(base + entity(4), dir * w * 0.5);
          g.lineTo(base + entity(14), dir * (w * 0.5 + entity(4)));
          g.lineTo(base + entity(16), dir * w * 0.5);
          g.closePath();
          g.fill();
        }
      }

      // §D.3: the sights sit on top of everything.
      this.paintOptics(g, base, w, len, m.optics, tint);
    });

    const back = TOWER_VISUAL.recoilDistance * easeOutCubic(this.recoil);
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.rotate(this.turretAngle);
    ctx.translate(-back, 0);
    ctx.drawImage(sprite, -sprite.width / 2, -sprite.height / 2);
    ctx.restore();
  }
```

### D.2 `autoloader` — magazine drums (steps 0..3)

New method, directly after `drawTurret`:

```ts
  /**
   * Feed gear at the breech, from the `fireRate` line
   * (`plans/tower-ui.md` §D.2).
   *
   * Painted *before* the barrel so the barrel overlaps the drums' inboard
   * edges — the gear reads as bolted under the weapon rather than floating
   * beside it.
   */
  private paintAutoloader(
    g: CanvasRenderingContext2D,
    base: number,
    w: number,
    len: number,
    step: number,
    tint: string,
  ): void {
    if (step <= 0) return;
    const cx = base + (len - base) * 0.16;
    const r = entity(6.5);
    const sides: number[] = step >= 2 ? [-1, 1] : [-1];

    for (const dir of sides) {
      const cy = dir * (w * 0.62 + r * 0.6);
      g.fillStyle = TOWER_VISUAL.stoneMid;
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = withAlpha(INK['950'], 0.85);
      g.lineWidth = entity(1.3);
      g.stroke();
      // Four spokes, so the drum reads as a drum and not as a dot.
      g.strokeStyle = withAlpha(INK['950'], 0.6);
      g.lineWidth = entity(1.1);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI * 0.25;
        g.beginPath();
        g.moveTo(cx, cy);
        g.lineTo(cx + Math.cos(a) * r * 0.85, cy + Math.sin(a) * r * 0.85);
        g.stroke();
      }
      g.fillStyle = withAlpha(TOWER_VISUAL.rim, 0.5);
      g.beginPath();
      g.arc(cx, cy, r * 0.3, 0, Math.PI * 2);
      g.fill();
      // step 3: the drums are wound to the core and glow with it.
      if (step >= 3) {
        g.fillStyle = withAlpha(tint, 0.75);
        g.beginPath();
        g.arc(cx, cy, r * 0.5, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = withAlpha(INK['050'], 0.5);
        g.beginPath();
        g.arc(cx, cy, r * 0.2, 0, Math.PI * 2);
        g.fill();
      }
    }

    // step 2+: feed rails running forward along the flanks.
    if (step >= 2) {
      g.fillStyle = withAlpha(INK['200'], 0.85);
      for (const dir of [-1, 1]) {
        g.fillRect(cx, dir * w * 0.5 - (dir < 0 ? entity(1.8) : 0), (len - cx) * 0.62, entity(1.8));
      }
    }
    // step 3: a third rail over the top.
    if (step >= 3) {
      g.fillStyle = withAlpha(INK['200'], 0.7);
      g.fillRect(cx, -entity(0.9), (len - cx) * 0.5, entity(1.8));
    }
  }
```

Also let the flash grow with the ladder. In `drawMuzzleFlash` (`Renderer.ts:2072`), replace:

```ts
    const burst = 1 + Math.min(5, this.muzzleBurst - 1) * 0.16;
```

with:

```ts
    // §D.1/§D.2: a bigger barrel and a fed autoloader throw a bigger flash.
    const gear = 1 + this.marks.steps.barrel * 0.05 + this.marks.steps.autoloader * 0.07;
    const burst = (1 + Math.min(5, this.muzzleBurst - 1) * 0.16) * gear;
```

### D.3 `optics` — sights and scope (steps 0..3)

New method, after `paintAutoloader`:

```ts
  /**
   * Sights, from the two crit lines (`plans/tower-ui.md` §D.3).
   *
   * Painted last, over the barrel, because a scope is bolted on top of a
   * weapon and its silhouette has to break the barrel's outline to read as a
   * separate object. Crit is precision, so this is the one piece of the tower
   * allowed a hard white highlight (`'#ffffff'`, whitelisted).
   */
  private paintOptics(
    g: CanvasRenderingContext2D,
    base: number,
    w: number,
    len: number,
    step: number,
    tint: string,
  ): void {
    if (step <= 0) return;

    // step 1: a front sight post and a rear notch.
    g.fillStyle = TOWER_VISUAL.stoneMid;
    g.strokeStyle = withAlpha(INK['950'], 0.8);
    g.lineWidth = entity(1);
    g.beginPath();
    g.rect(len - entity(10), -w * 0.5 - entity(4), entity(1.8), entity(4));
    g.fill();
    g.stroke();
    g.beginPath();
    g.rect(base + (len - base) * 0.2, -w * 0.5 - entity(3), entity(3.4), entity(3));
    g.fill();
    g.stroke();

    if (step < 2) return;

    // step 2: a scope tube over the barrel, on two mounts.
    const x0 = base + (len - base) * 0.3;
    const x1 = base + (len - base) * 0.78;
    const cy = -w * 0.5 - entity(5.5);
    const th = entity(5);
    g.fillStyle = withAlpha(INK['200'], 0.9);
    for (const at of [x0 + entity(2), x1 - entity(4)]) {
      g.fillRect(at, cy, entity(2.2), entity(6));
    }
    g.fillStyle = TOWER_VISUAL.stoneLit;
    g.beginPath();
    g.rect(x0, cy - th / 2, x1 - x0, th);
    g.fill();
    g.strokeStyle = withAlpha(INK['950'], 0.85);
    g.lineWidth = entity(1.3);
    g.stroke();
    g.strokeStyle = withAlpha(TOWER_VISUAL.rim, 0.55);
    g.lineWidth = entity(1);
    g.beginPath();
    g.moveTo(x0 + entity(1), cy - th / 2 + entity(1));
    g.lineTo(x1 - entity(1), cy - th / 2 + entity(1));
    g.stroke();

    // The objective lens, in the core's colour.
    g.fillStyle = withAlpha(tint, 0.85);
    g.beginPath();
    g.ellipse(x1, cy, entity(1.6), th * 0.55, 0, 0, Math.PI * 2);
    g.fill();

    if (step < 3) return;

    // step 3: the lens is ground and cross-etched, and a windage drum is fitted.
    g.strokeStyle = withAlpha('#ffffff', 0.85);
    g.lineWidth = entity(0.8);
    g.beginPath();
    g.moveTo(x1, cy - th * 0.5);
    g.lineTo(x1, cy + th * 0.5);
    g.moveTo(x1 - entity(1.5), cy);
    g.lineTo(x1 + entity(1.5), cy);
    g.stroke();
    g.fillStyle = withAlpha('#ffffff', 0.55);
    g.beginPath();
    g.ellipse(x1 - entity(0.4), cy - th * 0.2, entity(0.5), th * 0.16, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = withAlpha(TOWER_VISUAL.rim, 0.8);
    g.beginPath();
    g.arc((x0 + x1) / 2, cy - th * 0.55, entity(2), 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = withAlpha(INK['950'], 0.7);
    g.lineWidth = entity(0.9);
    g.stroke();
  }
```

### D.4 `masonry` — the drum, and §D.5–D.8 hooks

Replace `paintDrum` (`Renderer.ts:1828`) with the version below. It keeps every existing line and
adds the mark hooks in the right paint order (stone → plate → gold → mana → battlements → mast →
banners → rim → crystal well).

```ts
  /** Banded masonry, battlements, and whatever level and gold have earned. */
  private paintDrum(g: CanvasRenderingContext2D, tier: number): void {
    const R = TOWER_VISUAL.bodyRadius;
    const light = TOWER_VISUAL.lightAngle;
    const m = this.marks.steps;
    const rand = mulberry32(0x2b19f + tier);

    g.fillStyle = TOWER_VISUAL.stoneDark;
    g.beginPath();
    g.arc(0, 0, R, 0, Math.PI * 2);
    g.fill();

    // Courses of masonry, laid with the joints offset. The second course is
    // the tower's first *level* reward; the third is `health`'s belt course.
    const courses: Array<[number, number, number]> = [[R * 0.74, R, 18]];
    if (tier >= 1) courses.push([R * 0.44, R * 0.7, 12]);
    if (m.masonry >= 3) courses.push([R * 0.66, R * 0.735, 24]);
    for (const [from, to, count] of courses) {
      const step = (Math.PI * 2) / count;
      for (let i = 0; i < count; i++) {
        const a0 = i * step + step * 0.08;
        const a1 = (i + 1) * step - step * 0.08;
        const mid = (a0 + a1) / 2;
        const lit = 0.5 + 0.5 * Math.cos(mid - light);
        g.beginPath();
        g.arc(0, 0, to, a0, a1);
        g.arc(0, 0, from, a1, a0, true);
        g.closePath();
        g.fillStyle = rand() > 0.62 ? TOWER_VISUAL.stoneLit : TOWER_VISUAL.stoneMid;
        g.fill();
        g.fillStyle = withAlpha(TOWER_VISUAL.rim, 0.2 * lit * lit);
        g.fill();
        g.fillStyle = withAlpha(INK['950'], 0.34 * (1 - lit));
        g.fill();
      }
      g.strokeStyle = withAlpha(TOWER_VISUAL.mortar, 0.75);
      g.lineWidth = entity(1.4);
      g.beginPath();
      g.arc(0, 0, from, 0, Math.PI * 2);
      g.stroke();
    }

    this.paintPlating(g, R, light, m.plating);
    this.paintGilding(g, R, m.gilding, tier);
    this.paintConduits(g, R, m.conduits);

    // Battlements. More merlons is the tier-1 silhouette change you can read
    // from across the arena; `masonry` 4 adds four more on top of that.
    const merlons = m.masonry >= 4 ? 16 : tier >= 1 ? 12 : 8;
    const mStep = (Math.PI * 2) / merlons;
    const outerMerlon = R + entity(5);
    for (let i = 0; i < merlons; i++) {
      const a0 = i * mStep + mStep * 0.2;
      const a1 = (i + 1) * mStep - mStep * 0.2;
      const mid = (a0 + a1) / 2;
      const lit = 0.5 + 0.5 * Math.cos(mid - light);
      g.beginPath();
      g.arc(0, 0, outerMerlon, a0, a1);
      g.arc(0, 0, R - entity(1), a1, a0, true);
      g.closePath();
      g.fillStyle = m.plating >= 3 ? INK['200'] : TOWER_VISUAL.stoneMid;
      g.fill();
      g.fillStyle = withAlpha(TOWER_VISUAL.rim, 0.18 * lit);
      g.fill();
      g.fillStyle = withAlpha(INK['950'], 0.45 * (1 - lit));
      g.fill();

      // masonry 2: a capstone slab on every merlon.
      if (m.masonry >= 2) {
        g.beginPath();
        g.arc(0, 0, outerMerlon + entity(1.4), a0 - mStep * 0.05, a1 + mStep * 0.05);
        g.arc(0, 0, outerMerlon - entity(1), a1 + mStep * 0.05, a0 - mStep * 0.05, true);
        g.closePath();
        g.fillStyle = TOWER_VISUAL.stoneLit;
        g.fill();
        g.fillStyle = withAlpha(INK['950'], 0.4 * (1 - lit));
        g.fill();
      }
      // masonry 4: an arrow slit cut through each merlon.
      if (m.masonry >= 4) {
        g.strokeStyle = withAlpha(INK['950'], 0.85);
        g.lineWidth = entity(1.4);
        g.beginPath();
        g.moveTo(Math.cos(mid) * (R + entity(0.5)), Math.sin(mid) * (R + entity(0.5)));
        g.lineTo(Math.cos(mid) * (outerMerlon - entity(0.5)), Math.sin(mid) * (outerMerlon - entity(0.5)));
        g.stroke();
      }
    }

    // masonry 5: a parapet skirt filling the crenels partway, so the crown
    // reads as a solid wall-walk rather than a row of teeth.
    if (m.masonry >= 5) {
      g.strokeStyle = withAlpha(TOWER_VISUAL.stoneMid, 0.95);
      g.lineWidth = entity(3.2);
      g.beginPath();
      g.arc(0, 0, R + entity(2.2), 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = withAlpha(TOWER_VISUAL.rim, 0.3);
      g.lineWidth = entity(1);
      g.beginPath();
      g.arc(0, 0, R + entity(3.4), light - 1.2, light + 1.2);
      g.stroke();
    }

    this.paintMast(g, R, light, m.mast);

    // Tier 2: banners. The old flag was a three-point red triangle; red is the
    // enemy's colour now (docs/art-direction.md), so the tower flies amber.
    if (tier >= 2) {
      for (const dir of [-1, 1]) {
        g.save();
        g.rotate(dir * Math.PI * 0.5);
        g.fillStyle = withAlpha(TOWER_VISUAL.banner, 0.85);
        g.beginPath();
        g.moveTo(R - entity(2), -entity(4));
        g.lineTo(R + entity(17), -entity(1));
        g.lineTo(R + entity(12), entity(3));
        g.lineTo(R + entity(17), entity(7));
        g.lineTo(R - entity(2), entity(5));
        g.closePath();
        g.fill();
        g.strokeStyle = withAlpha(INK['950'], 0.4);
        g.lineWidth = entity(1);
        g.stroke();
        // gilding 2: a fringe along the banner's trailing edge.
        if (m.gilding >= 2) {
          g.strokeStyle = withAlpha(lighten(TOWER_VISUAL.banner, 0.4), 0.9);
          g.lineWidth = entity(0.9);
          for (let i = 0; i < 5; i++) {
            const x = R + entity(13) + i * entity(1);
            g.beginPath();
            g.moveTo(x, -entity(1) + i * entity(0.3));
            g.lineTo(x + entity(2), entity(1) + i * entity(0.3));
            g.stroke();
          }
        }
        g.restore();
      }
    }

    // Rim light along the lit edge. Segmented rather than one long stroke, so
    // it falls off toward the terminator instead of ending as a hard hoop.
    g.lineWidth = entity(2);
    for (let i = -4; i <= 4; i++) {
      const a = light + i * 0.26;
      const fall = 1 - Math.abs(i) / 5;
      g.strokeStyle = withAlpha(TOWER_VISUAL.rim, 0.4 * fall * fall);
      g.beginPath();
      g.arc(0, 0, R + entity(1.4), a - 0.14, a + 0.14);
      g.stroke();
    }

    // The chamber the crystal sits in: a floor, then an occlusion falloff, so
    // the middle of the tower is a recess rather than a hole cut in the page.
    g.fillStyle = TOWER_VISUAL.stoneDeep;
    g.beginPath();
    g.arc(0, 0, R * 0.42, 0, Math.PI * 2);
    g.fill();
    const well = g.createRadialGradient(0, 0, R * 0.1, 0, 0, R * 0.46);
    well.addColorStop(0, withAlpha(INK['950'], 0.55));
    well.addColorStop(1, withAlpha(INK['950'], 0));
    g.fillStyle = well;
    g.beginPath();
    g.arc(0, 0, R * 0.46, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = withAlpha(INK['950'], 0.7);
    g.lineWidth = entity(1.6);
    g.beginPath();
    g.arc(0, 0, R * 0.42, 0, Math.PI * 2);
    g.stroke();
  }
```

> `lighten` is already imported in `Renderer.ts` (`Renderer.ts:7`).

### D.5 `plating` — iron over stone (steps 0..3)

```ts
  /**
   * Iron strapping from the `defense` + `armor` lines
   * (`plans/tower-ui.md` §D.5).
   *
   * The plate is `INK['200']` — brighter *and* colder than any of the
   * `TOWER_VISUAL.stone*` steps — because a plate that is merely a lighter
   * stone reads as a lighting change, not as a second material. The rivets are
   * `rim` gold: the plating is still something the player owns.
   */
  private paintPlating(
    g: CanvasRenderingContext2D,
    R: number,
    light: number,
    step: number,
  ): void {
    if (step <= 0) return;
    const plate = INK['200'];

    // step 2: a girdle plate under the straps, so they have something to bite.
    if (step >= 2) {
      g.strokeStyle = withAlpha(plate, 0.75);
      g.lineWidth = R * 0.16;
      g.beginPath();
      g.arc(0, 0, R * 0.59, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = withAlpha(INK['950'], 0.5);
      g.lineWidth = entity(1.2);
      g.beginPath();
      g.arc(0, 0, R * 0.67, 0, Math.PI * 2);
      g.stroke();
    }

    const straps = step >= 2 ? 8 : 4;
    const halfWidth = step >= 2 ? 0.1 : 0.13;
    for (let i = 0; i < straps; i++) {
      const a = (i / straps) * Math.PI * 2 + Math.PI * 0.25;
      const lit = 0.5 + 0.5 * Math.cos(a - light);
      g.beginPath();
      g.arc(0, 0, R + entity(2), a - halfWidth, a + halfWidth);
      g.arc(0, 0, R * 0.42, a + halfWidth, a - halfWidth, true);
      g.closePath();
      g.fillStyle = plate;
      g.fill();
      g.fillStyle = withAlpha('#ffffff', 0.12 * lit);
      g.fill();
      g.fillStyle = withAlpha(INK['950'], 0.42 * (1 - lit));
      g.fill();
      g.strokeStyle = withAlpha(INK['950'], 0.7);
      g.lineWidth = entity(1);
      g.stroke();
      // Three rivets down each strap.
      g.fillStyle = withAlpha(TOWER_VISUAL.rim, 0.5 + 0.3 * lit);
      for (const at of [0.55, 0.75, 0.94]) {
        g.beginPath();
        g.arc(Math.cos(a) * R * at, Math.sin(a) * R * at, entity(1.1), 0, Math.PI * 2);
        g.fill();
      }
    }

    // step 3: the outer course is faced in plate — sixteen flat facets with
    // lit edges, which is what turns "banded stone" into "an armoured keep".
    if (step >= 3) {
      const facets = 16;
      const fStep = (Math.PI * 2) / facets;
      for (let i = 0; i < facets; i++) {
        const a0 = i * fStep;
        const a1 = (i + 1) * fStep;
        const mid = (a0 + a1) / 2;
        const lit = 0.5 + 0.5 * Math.cos(mid - light);
        g.beginPath();
        g.moveTo(Math.cos(a0) * R, Math.sin(a0) * R);
        g.lineTo(Math.cos(a1) * R, Math.sin(a1) * R);
        g.lineTo(Math.cos(a1) * R * 0.8, Math.sin(a1) * R * 0.8);
        g.lineTo(Math.cos(a0) * R * 0.8, Math.sin(a0) * R * 0.8);
        g.closePath();
        g.fillStyle = plate;
        g.fill();
        g.fillStyle = withAlpha('#ffffff', 0.14 * lit * lit);
        g.fill();
        g.fillStyle = withAlpha(INK['950'], 0.45 * (1 - lit));
        g.fill();
        g.strokeStyle = withAlpha(INK['950'], 0.55);
        g.lineWidth = entity(0.9);
        g.stroke();
      }
    }
  }
```

### D.6 `gilding` — gold on the stone (steps 0..3)

```ts
  /**
   * Gold trim from the `goldMulti` + `prospecting` lines
   * (`plans/tower-ui.md` §D.6).
   *
   * Amber is already the player's colour, so gilding is the one mark that adds
   * no new hue — it adds *quantity* of the colour that is already there. That
   * is deliberate: a rich tower should look like the same tower with more gold
   * on it, not like a different faction's.
   */
  private paintGilding(
    g: CanvasRenderingContext2D,
    R: number,
    step: number,
    tier: number,
  ): void {
    if (step <= 0) return;
    const gold = TOWER_VISUAL.rim;

    // step 1: the mortar joints of the outer course are gilded.
    g.strokeStyle = withAlpha(gold, 0.3);
    g.lineWidth = entity(1.2);
    g.beginPath();
    g.arc(0, 0, R * 0.74, 0, Math.PI * 2);
    g.stroke();
    const joints = 18;
    for (let i = 0; i < joints; i++) {
      const a = (i / joints) * Math.PI * 2;
      g.beginPath();
      g.moveTo(Math.cos(a) * R * 0.74, Math.sin(a) * R * 0.74);
      g.lineTo(Math.cos(a) * R, Math.sin(a) * R);
      g.stroke();
    }

    if (step < 2) return;

    // step 2: filigree — a scrolled band of small arcs above the belt course.
    g.strokeStyle = withAlpha(lighten(gold, 0.3), 0.55);
    g.lineWidth = entity(1.1);
    const scrolls = tier >= 1 ? 12 : 9;
    for (let i = 0; i < scrolls; i++) {
      const a = (i / scrolls) * Math.PI * 2;
      g.beginPath();
      g.arc(Math.cos(a) * R * 0.63, Math.sin(a) * R * 0.63, entity(3.2), a - 2.2, a + 0.9);
      g.stroke();
    }

    if (step < 3) return;

    // step 3: coin studs set around the drum.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const x = Math.cos(a) * R * 0.86;
      const y = Math.sin(a) * R * 0.86;
      g.fillStyle = withAlpha(INK['950'], 0.6);
      g.beginPath();
      g.arc(x, y, entity(3.1), 0, Math.PI * 2);
      g.fill();
      g.fillStyle = gold;
      g.beginPath();
      g.arc(x, y, entity(2.4), 0, Math.PI * 2);
      g.fill();
      g.fillStyle = withAlpha(lighten(gold, 0.55), 0.8);
      g.beginPath();
      g.arc(x - entity(0.7), y - entity(0.7), entity(0.9), 0, Math.PI * 2);
      g.fill();
    }
  }
```

### D.7 `conduits` — mana channels (steps 0..3, plus one live pulse)

```ts
  /**
   * Mana channels from the `manaRegen` + `maxMana` lines
   * (`plans/tower-ui.md` §D.7).
   *
   * They run *inward*, to the crystal well, because that is where the tower's
   * power visibly is — a conduit that ended nowhere would be a decoration.
   * `FX.mana` is the mana pool's own colour, so a player who reads the HUD
   * bar already knows what these are.
   */
  private paintConduits(g: CanvasRenderingContext2D, R: number, step: number): void {
    if (step <= 0) return;
    const n = step >= 2 ? 6 : 3;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.PI / n;
      const ux = Math.cos(a);
      const uy = Math.sin(a);
      // The groove first, so the glow sits in a channel rather than on the face.
      g.strokeStyle = withAlpha(INK['950'], 0.7);
      g.lineWidth = entity(3.4);
      g.beginPath();
      g.moveTo(ux * R * 0.42, uy * R * 0.42);
      g.lineTo(ux * R * 0.9, uy * R * 0.9);
      g.stroke();
      g.strokeStyle = withAlpha(FX.mana, 0.55);
      g.lineWidth = entity(1.8);
      g.beginPath();
      g.moveTo(ux * R * 0.44, uy * R * 0.44);
      g.lineTo(ux * R * 0.88, uy * R * 0.88);
      g.stroke();
      // step 3: each channel forks near the rim.
      if (step >= 3) {
        for (const spread of [-0.22, 0.22]) {
          const b = a + spread;
          g.beginPath();
          g.moveTo(ux * R * 0.78, uy * R * 0.78);
          g.lineTo(Math.cos(b) * R * 0.97, Math.sin(b) * R * 0.97);
          g.stroke();
        }
      }
    }
    // step 2: a collector ring the channels feed out of.
    if (step >= 2) {
      g.strokeStyle = withAlpha(FX.mana, 0.4);
      g.lineWidth = entity(1.4);
      g.beginPath();
      g.arc(0, 0, R * 0.86, 0, Math.PI * 2);
      g.stroke();
    }
  }
```

The **live pulse** at step 3 goes in `drawTowerTop`, immediately after the drum blit and before the
tier-3 arcane ring block:

```ts
    // §D.7 step 3: the conduits pulse. One cached sprite, one `globalAlpha`,
    // no allocation — and it holds still under `prefers-reduced-motion` and at
    // the `low` quality tier, where the additive budget is spent elsewhere.
    if (m.conduits >= 3 && this.profile.additive && !this.reducedMotion) {
      const pulse = this.towerPart('conduit-pulse', (TOWER_VISUAL.bodyRadius + entity(6)) * 2, (g) => {
        const R = TOWER_VISUAL.bodyRadius;
        g.strokeStyle = withAlpha(lighten(FX.mana, 0.4), 0.8);
        g.lineWidth = entity(2.4);
        g.lineCap = 'round';
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
          g.beginPath();
          g.moveTo(Math.cos(a) * R * 0.5, Math.sin(a) * R * 0.5);
          g.lineTo(Math.cos(a) * R * 0.66, Math.sin(a) * R * 0.66);
          g.stroke();
        }
      });
      ctx.save();
      ctx.globalAlpha = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(this.time * 2.4));
      this.blit(ctx, pulse, t.x, t.y, 1 + 0.35 * (0.5 + 0.5 * Math.sin(this.time * 2.4)));
      ctx.restore();
    }
```

`drawTowerTop` needs `const m = this.marks.steps;` at the top for this. Add it after
`const tint = CORE_BY_ID[core].color;`.

### D.8 `mast` — the spotter's mast (steps 0..3)

```ts
  /**
   * A spotter's mast from the `range` line (`plans/tower-ui.md` §D.8).
   *
   * It leans along the key light, which at this near-top-down angle is what
   * reads as "up" — a mast drawn straight along +x would read as a spar
   * sticking sideways out of the wall. `range` is the one stat with an existing
   * battlefield expression (the ring), so this is the piece of tower that
   * *explains* the ring rather than duplicating it.
   */
  private paintMast(
    g: CanvasRenderingContext2D,
    R: number,
    light: number,
    step: number,
  ): void {
    if (step <= 0) return;
    const angles = step >= 3 ? [light, light + Math.PI] : [light];
    for (const a of angles) {
      const ux = Math.cos(a);
      const uy = Math.sin(a);
      const x0 = ux * R * 0.5;
      const y0 = uy * R * 0.5;
      const x1 = ux * (R + entity(13));
      const y1 = uy * (R + entity(13));
      // The pole, with its own shadow line so it lifts off the drum.
      g.strokeStyle = withAlpha(INK['950'], 0.6);
      g.lineWidth = entity(3);
      g.beginPath();
      g.moveTo(x0 + entity(1), y0 + entity(1.5));
      g.lineTo(x1 + entity(1), y1 + entity(1.5));
      g.stroke();
      g.strokeStyle = TOWER_VISUAL.stoneLit;
      g.lineWidth = entity(2);
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();
      // The crow's nest.
      g.fillStyle = TOWER_VISUAL.stoneMid;
      g.beginPath();
      g.arc(x1, y1, entity(4), 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = withAlpha(INK['950'], 0.8);
      g.lineWidth = entity(1.2);
      g.stroke();
      g.strokeStyle = withAlpha(TOWER_VISUAL.rim, 0.5);
      g.lineWidth = entity(1);
      g.beginPath();
      g.arc(x1, y1, entity(2.4), 0, Math.PI * 2);
      g.stroke();

      if (step < 2) continue;

      // step 2: a crossbar with a pennant, and a lookout lantern.
      const px = -uy;
      const py = ux;
      g.strokeStyle = TOWER_VISUAL.stoneLit;
      g.lineWidth = entity(1.4);
      g.beginPath();
      g.moveTo(x1 - px * entity(6), y1 - py * entity(6));
      g.lineTo(x1 + px * entity(6), y1 + py * entity(6));
      g.stroke();
      g.fillStyle = withAlpha(TOWER_VISUAL.banner, 0.85);
      g.beginPath();
      g.moveTo(x1 + px * entity(6), y1 + py * entity(6));
      g.lineTo(x1 + px * entity(6) + ux * entity(6), y1 + py * entity(6) + uy * entity(6));
      g.lineTo(x1 + px * entity(1.5) + ux * entity(4), y1 + py * entity(1.5) + uy * entity(4));
      g.closePath();
      g.fill();
      const lantern = g.createRadialGradient(
        x1 - px * entity(6), y1 - py * entity(6), 0,
        x1 - px * entity(6), y1 - py * entity(6), entity(6),
      );
      lantern.addColorStop(0, withAlpha(lighten(TOWER_VISUAL.rim, 0.5), 0.9));
      lantern.addColorStop(1, withAlpha(TOWER_VISUAL.rim, 0));
      g.fillStyle = lantern;
      g.beginPath();
      g.arc(x1 - px * entity(6), y1 - py * entity(6), entity(6), 0, Math.PI * 2);
      g.fill();
    }
  }
```

**Range-rim ticks (step 3)** — in `drawRangeRing` (`Renderer.ts:2222`), after the inner hairline
and before the sweep block:

```ts
    // §D.8 step 3: cardinal ticks on the rim, so the ring reads as *measured*
    // rather than merely drawn. Four strokes; no sprite worth baking.
    if (this.marks.steps.mast >= 3) {
      ctx.strokeStyle = withAlpha(tint, 0.5 + bloom * 0.3);
      ctx.lineWidth = entity(2.2);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        const ux = Math.cos(a);
        const uy = Math.sin(a);
        ctx.beginPath();
        ctx.moveTo(t.x + ux * (r - entity(7)), t.y + uy * (r - entity(7)));
        ctx.lineTo(t.x + ux * (r + entity(5)), t.y + uy * (r + entity(5)));
        ctx.stroke();
      }
    }
```

### D.9 `resonator` + `masonry` buttresses — the plinth

Replace `paintPlinth` (`Renderer.ts:1552`) with:

```ts
  /** Stone footing: a kerb of set blocks, a lit bevel and an occlusion ring. */
  private paintPlinth(g: CanvasRenderingContext2D): void {
    const R = TOWER_VISUAL.plinthRadius;
    const light = TOWER_VISUAL.lightAngle;
    const m = this.marks.steps;
    const rand = mulberry32(0x91af7);

    // §D.9: buttresses go under the disc, so the disc's edge cuts them and
    // they read as set *into* the footing.
    this.paintButtresses(g, R, light, m.masonry);

    g.fillStyle = TOWER_VISUAL.plinth;
    g.beginPath();
    g.arc(0, 0, R, 0, Math.PI * 2);
    g.fill();

    // Kerb blocks around the rim, each one a slightly different stone.
    const blocks = 16;
    const step = (Math.PI * 2) / blocks;
    for (let i = 0; i < blocks; i++) {
      const a0 = i * step + step * 0.09;
      const a1 = (i + 1) * step - step * 0.09;
      const mid = (a0 + a1) / 2;
      const lit = 0.5 + 0.5 * Math.cos(mid - light);
      g.beginPath();
      g.arc(0, 0, R, a0, a1);
      g.arc(0, 0, R * 0.79, a1, a0, true);
      g.closePath();
      g.fillStyle = rand() > 0.5 ? TOWER_VISUAL.stoneMid : TOWER_VISUAL.stoneDark;
      g.fill();
      g.fillStyle = withAlpha(TOWER_VISUAL.rim, 0.10 * lit);
      g.fill();
      g.fillStyle = withAlpha(INK['950'], 0.34 * (1 - lit));
      g.fill();
    }

    // masonry 2+: a second, finer kerb inside the first — the footing is
    // stepped, which is the cheapest way to say "this is thicker than it was".
    if (m.masonry >= 2) {
      const inner = 24;
      const iStep = (Math.PI * 2) / inner;
      for (let i = 0; i < inner; i++) {
        const a0 = i * iStep + iStep * 0.12;
        const a1 = (i + 1) * iStep - iStep * 0.12;
        const mid = (a0 + a1) / 2;
        const lit = 0.5 + 0.5 * Math.cos(mid - light);
        g.beginPath();
        g.arc(0, 0, R * 0.77, a0, a1);
        g.arc(0, 0, R * 0.64, a1, a0, true);
        g.closePath();
        g.fillStyle = rand() > 0.5 ? TOWER_VISUAL.stoneMid : TOWER_VISUAL.stoneDark;
        g.fill();
        g.fillStyle = withAlpha(TOWER_VISUAL.rim, 0.08 * lit);
        g.fill();
        g.fillStyle = withAlpha(INK['950'], 0.3 * (1 - lit));
        g.fill();
      }
    }

    // masonry 5: a stepped second tier, drawn as a raised lip.
    if (m.masonry >= 5) {
      g.strokeStyle = withAlpha(TOWER_VISUAL.stoneLit, 0.9);
      g.lineWidth = entity(2.4);
      g.beginPath();
      g.arc(0, 0, R * 0.61, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = withAlpha(INK['950'], 0.55);
      g.lineWidth = entity(1.4);
      g.beginPath();
      g.arc(0, 0, R * 0.585, 0, Math.PI * 2);
      g.stroke();
    }

    this.paintResonator(g, R, light, m.resonator);

    // Bevel highlight on the lit side, and the occlusion ring where the drum
    // meets the footing — the two cheapest cues that this is a solid object.
    g.strokeStyle = withAlpha(TOWER_VISUAL.rim, 0.22);
    g.lineWidth = entity(2);
    g.beginPath();
    g.arc(0, 0, R * 0.9, light - 1.15, light + 1.15);
    g.stroke();

    const ao = g.createRadialGradient(0, 0, TOWER_VISUAL.bodyRadius * 0.85, 0, 0, TOWER_VISUAL.bodyRadius * 1.28);
    ao.addColorStop(0, withAlpha(INK['950'], 0.5));
    ao.addColorStop(1, withAlpha(INK['950'], 0));
    g.fillStyle = ao;
    g.beginPath();
    g.arc(0, 0, TOWER_VISUAL.bodyRadius * 1.28, 0, Math.PI * 2);
    g.fill();
  }

  /**
   * Buttresses from the `health` line (`plans/tower-ui.md` §D.9).
   *
   * The only mark that grows the tower's *footprint*, which is why the plinth
   * sprite is baked at `plinthRadius * 2.7` rather than `2.3`. It does not
   * touch `TOWER_VISUAL.plinthRadius` itself: the charge ring reads that
   * constant (`Renderer.drawChargeRing`) and moving it would drag an unrelated
   * indicator outward.
   */
  private paintButtresses(
    g: CanvasRenderingContext2D,
    R: number,
    light: number,
    step: number,
  ): void {
    if (step <= 0) return;
    const n = step >= 3 ? 8 : 4;
    const reach = R + entity(step >= 3 ? 8 : 5.5);
    const half = step >= 3 ? 0.15 : 0.19;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.PI / n;
      const lit = 0.5 + 0.5 * Math.cos(a - light);
      g.beginPath();
      g.moveTo(Math.cos(a - half) * R * 0.9, Math.sin(a - half) * R * 0.9);
      g.lineTo(Math.cos(a - half * 0.45) * reach, Math.sin(a - half * 0.45) * reach);
      g.lineTo(Math.cos(a + half * 0.45) * reach, Math.sin(a + half * 0.45) * reach);
      g.lineTo(Math.cos(a + half) * R * 0.9, Math.sin(a + half) * R * 0.9);
      g.closePath();
      g.fillStyle = TOWER_VISUAL.stoneDark;
      g.fill();
      g.fillStyle = withAlpha(TOWER_VISUAL.rim, 0.12 * lit);
      g.fill();
      g.fillStyle = withAlpha(INK['950'], 0.4 * (1 - lit));
      g.fill();
      g.strokeStyle = withAlpha(INK['950'], 0.7);
      g.lineWidth = entity(1.2);
      g.stroke();
      // step 3: a stepped shoulder on each buttress.
      if (step >= 3) {
        g.strokeStyle = withAlpha(TOWER_VISUAL.rim, 0.25 * lit);
        g.lineWidth = entity(1.1);
        g.beginPath();
        g.arc(0, 0, (R + reach) / 2, a - half * 0.7, a + half * 0.7);
        g.stroke();
      }
    }
  }

  /**
   * Emitter rings from the `shockwave` line (`plans/tower-ui.md` §D.9).
   *
   * Frost, not gold: `shockwave`'s evolution is a slow, and frost is the
   * palette's slow/chill family (`docs/art-direction.md`). It is also the one
   * mark whose step 1 is at upgrade level 1 — the line is a single deliberate
   * purchase, so buying it at all has to show.
   */
  private paintResonator(
    g: CanvasRenderingContext2D,
    R: number,
    light: number,
    step: number,
  ): void {
    if (step <= 0) return;
    const radii = step >= 3 ? [0.42, 0.52, 0.62] : step >= 2 ? [0.46, 0.58] : [0.52];
    for (const at of radii) {
      g.strokeStyle = withAlpha(INK['950'], 0.55);
      g.lineWidth = entity(3);
      g.beginPath();
      g.arc(0, 0, R * at, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = withAlpha(TOWER_VISUAL.stoneLit, 0.8);
      g.lineWidth = entity(1.6);
      g.beginPath();
      g.arc(0, 0, R * at - entity(0.6), light - 1.4, light + 1.4);
      g.stroke();
    }
    if (step < 2) return;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const x = Math.cos(a) * R * 0.57;
      const y = Math.sin(a) * R * 0.57;
      g.fillStyle = withAlpha(INK['950'], 0.7);
      g.beginPath();
      g.arc(x, y, entity(3.4), 0, Math.PI * 2);
      g.fill();
      g.fillStyle = withAlpha(TOWER_VISUAL.shield, step >= 3 ? 0.85 : 0.5);
      g.beginPath();
      g.arc(x, y, entity(2.2), 0, Math.PI * 2);
      g.fill();
      if (step >= 3) {
        const glow = g.createRadialGradient(x, y, 0, x, y, entity(7));
        glow.addColorStop(0, withAlpha(TOWER_VISUAL.shield, 0.45));
        glow.addColorStop(1, withAlpha(TOWER_VISUAL.shield, 0));
        g.fillStyle = glow;
        g.beginPath();
        g.arc(x, y, entity(7), 0, Math.PI * 2);
        g.fill();
      }
    }
  }
```

### D.10 `bulwark` — the wall ring (steps 0..3)

Two edits.

**`drawWall`** (`Renderer.ts:1690`), replace:

```ts
    const thickness = entity(11);
```

with:

```ts
    // §D.10: the courses are laid thicker as `wall` is levelled. Purely a
    // drawn dimension — `TOWER_VISUAL.wallRadius` is untouched, and nothing
    // outside this renderer reads either number.
    const thickness = entity(11) * (1 + this.marks.steps.bulwark * 0.09);
```

**`getWallSegment`** — add the mark's features inside the existing painter, after the
`state === 'cracked'` block and before the closing `});`:

```ts
      const bw = this.marks.steps.bulwark;
      if (bw >= 1) {
        // A merlon crowning the block's outward face.
        g.beginPath();
        g.arc(0, 0, outer + thickness * 0.3, a0 + span * 0.3, a1 - span * 0.3);
        g.arc(0, 0, outer - entity(0.5), a1 - span * 0.3, a0 + span * 0.3, true);
        g.closePath();
        g.fillStyle = state === 'full' ? TOWER_VISUAL.stoneLit : TOWER_VISUAL.stoneMid;
        g.fill();
        g.strokeStyle = withAlpha(INK['950'], 0.7);
        g.lineWidth = entity(1);
        g.stroke();
      }
      if (bw >= 3) {
        // Iron banding across the block, and spikes on the crown.
        g.strokeStyle = withAlpha(INK['200'], 0.85);
        g.lineWidth = entity(1.6);
        for (const at of [0.3, 0.7]) {
          const a = a0 + (a1 - a0) * at;
          g.beginPath();
          g.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
          g.lineTo(Math.cos(a) * outer, Math.sin(a) * outer);
          g.stroke();
          g.fillStyle = withAlpha(TOWER_VISUAL.rim, 0.55);
          g.beginPath();
          g.arc(Math.cos(a) * (inner + thickness * 0.5), Math.sin(a) * (inner + thickness * 0.5), entity(0.9), 0, Math.PI * 2);
          g.fill();
        }
        if (state === 'full') {
          g.fillStyle = INK['200'];
          for (const at of [0.35, 0.65]) {
            const a = a0 + (a1 - a0) * at;
            const bx = Math.cos(a) * (outer + thickness * 0.3);
            const by = Math.sin(a) * (outer + thickness * 0.3);
            g.beginPath();
            g.moveTo(bx, by);
            g.lineTo(Math.cos(a) * (outer + thickness * 0.85), Math.sin(a) * (outer + thickness * 0.85));
            g.lineTo(Math.cos(a + span * 0.06) * (outer + thickness * 0.3), Math.sin(a + span * 0.06) * (outer + thickness * 0.3));
            g.closePath();
            g.fill();
          }
        }
      }
```

The `size` local in `getWallSegment` is already derived from `thickness`, so a thicker block
automatically gets a bigger sprite. Add `+ entity(6)` of extra slack so the crown and spikes are
not clipped: change

```ts
    const size = Math.max(thickness * 2, 2 * (R + thickness) * Math.sin(span / 2)) + entity(8);
```

to

```ts
    const size = Math.max(thickness * 3, 2 * (R + thickness) * Math.sin(span / 2)) + entity(14);
```

**Acceptance for Part D:** with the browser console, drive each mark to its top step and confirm
the tower still reads as one object at 1x zoom and at the phone viewport (375x812). Use:

```js
// in the dev console, with the game running
window.__game.debugSetUpgradeLevels?.({ damage: 200, health: 200, defense: 150, armor: 160 })
```

If no such hook exists, buy through the panel with a debug gold grant, or temporarily hard-code
`DEFAULT_TOWER_MARKS` in `Renderer.syncTowerMarks` to a maxed object. **Remove the hard-code
before committing** — a `computeTowerMarks` shim left in the render path is exactly the kind of
presentation/simulation leak rule 2 forbids.

---

## 6. Part E — the arrows

The user's ask names the arrows explicitly, and the barrel mark is the natural driver: a heavier
barrel throws a heavier bolt.

In `getBoltSprite` (`Renderer.ts:4226`), change the signature and the cache key:

```ts
  private getBoltSprite(core: CoreId, splash: boolean): HTMLCanvasElement {
    const style = SHOT_STYLES[core];
    const tint = CORE_BY_ID[core].color;
    const head = splash ? 'shell' : style.head;
    const b = this.marks.steps.barrel;
    // §E: the bolt grows with the barrel that fired it. Keyed into `part`
    // rather than `towerPart` on purpose — a bolt sprite is ~60 px square, the
    // variant space is 5 cores x 3 heads x 7 barrel steps = 105 worst case at
    // ~14 KB each, and unlike the drum these are hit tens of times a frame, so
    // a cache that empties on every threshold crossing would be the wrong
    // trade.
    const L = BOLT_LENGTH * (head === 'shell' ? 1.2 : 1) * (1 + b * 0.035);
    return this.part(`bolt|${core}|${head}|${b}`, L * 3.4, (g) => {
```

Then, inside the `case 'bolt':` branch, after the two existing fletching triangles, add:

```ts
          // §E: barbs at b >= 2, a lit edge at b >= 4, a gold band at b >= 6.
          if (b >= 2) {
            g.fillStyle = tint;
            for (const dir of [-1, 1]) {
              g.beginPath();
              g.moveTo(L * 0.45, dir * L * 0.06);
              g.lineTo(L * 0.1, dir * L * 0.3);
              g.lineTo(L * 0.3, dir * L * 0.07);
              g.closePath();
              g.fill();
            }
          }
          if (b >= 4) {
            g.strokeStyle = withAlpha(INK['050'], 0.7);
            g.lineWidth = entity(0.8);
            g.beginPath();
            g.moveTo(L, 0);
            g.lineTo(L * 0.35, -L * 0.36);
            g.stroke();
          }
          if (b >= 6) {
            g.fillStyle = withAlpha(FX.gold, 0.9);
            g.fillRect(-L * 0.3, -L * 0.13, L * 0.16, L * 0.26);
          }
```

Add the same three-line treatment to `case 'shard':` and `case 'shell':` only if it reads well —
a shard is meant to be thin and a shell blunt, and the plan's preference is **no change** there
over a change that muddies the core's identity. Ship `bolt` only if in doubt.

**Acceptance for Part E:** at `damage` L1 the bolt is byte-identical to `HEAD`. At L120 it is
visibly longer and barbed, and `SHOT_STYLES[core].head` still governs the shape family.

---

## 7. Part F — the moment

A change nobody notices happening is half a feature. Three pieces.

### F.1 `EffectsManager.emitTowerForge`

Add to `src/systems/EffectsManager.ts`, next to `emitBossEntryPulse`:

```ts
  /**
   * The flourish when an upgrade rebuilds part of the tower
   * (`plans/tower-ui.md` §F.1).
   *
   * Gold, because everything the player owns is gold, and **undamaging** —
   * the ring carries no `damage` field, so `tick` never calls
   * `onShockwaveDamage` for it. A cosmetic ring that quietly killed a wave
   * would be the worst kind of presentation leak.
   */
  emitTowerForge(cx: number, cy: number, radius: number): void {
    this.shockwaves.push({
      x: cx,
      y: cy,
      currentRadius: 0,
      maxRadius: radius * 2.2,
      age: 0,
      life: 0.55,
      color: withAlpha(FX.gold, 0.7),
      lineWidth: 4,
    });
    const n = this.n(20);
    for (let i = 0; i < n; i++) {
      const angle = (i / n) * Math.PI * 2;
      const speed = 90 + Math.random() * 70;
      this.pushParticle({
        x: cx + Math.cos(angle) * radius * 0.8,
        y: cy + Math.sin(angle) * radius * 0.8,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 40,
        age: 0,
        life: 0.45 + Math.random() * 0.3,
        size: 1.5 + Math.random() * 2,
        color: i % 3 === 0 ? lighten(FX.gold, 0.4) : FX.ember,
        layer: 'additive',
      });
    }
    // A handful of stone chips, in the ordinary pass: something was *built*.
    const chips = this.n(8);
    for (let i = 0; i < chips; i++) {
      const angle = Math.random() * Math.PI * 2;
      this.pushParticle({
        x: cx + Math.cos(angle) * radius * 0.6,
        y: cy + Math.sin(angle) * radius * 0.6,
        vx: Math.cos(angle) * 40,
        vy: Math.sin(angle) * 40 - 90,
        age: 0,
        life: 0.5 + Math.random() * 0.25,
        size: 1.5 + Math.random() * 1.5,
        color: INK['300'],
        layer: 'front',
      });
    }
  }
```

`FX`, `INK`, `lighten` and `withAlpha` are already imported in `EffectsManager.ts`; check and add
whichever is missing.

### F.2 The toast

Already wired in §B.2. It goes out with `kind: 'milestone'`, the same tier the evolution toast
uses, and reads e.g.

> **Turret: twin prongs are forged onto the muzzle.**

### F.3 The upgrade-panel hint

So a player can *aim* for the next change instead of discovering it.

**`src/ui/UpgradePanel.ts`** — add the helper next to `getNextEvolution` (`UpgradePanel.ts:49`):

```ts
import { TOWER_MARKS, type TowerMarkDef } from '../data/towerMarks';

/**
 * The next tower-visual change this upgrade's line will produce, if any
 * (`plans/tower-ui.md` §F.3).
 *
 * `combine: 'sum'` marks are fed by two lines, so the threshold is against the
 * *combined* level — the hint has to say the combined number or it will be
 * wrong for whichever line the player is looking at. That is why `levels` is
 * the whole record rather than one number.
 */
function getNextMark(
  upgradeId: string,
  levels: Record<string, number>,
): { def: TowerMarkDef; at: number; step: number } | null {
  for (const def of TOWER_MARKS) {
    if (!def.sources.includes(upgradeId)) continue;
    let level = 0;
    if (def.combine === 'sum') for (const id of def.sources) level += levels[id] ?? 0;
    else for (const id of def.sources) level = Math.max(level, levels[id] ?? 0);
    for (let i = 0; i < def.thresholds.length; i++) {
      if (level < def.thresholds[i]) return { def, at: def.thresholds[i], step: i + 1 };
    }
    return null;
  }
  return null;
}
```

In `update`, replace the whole `if (evoEl && u.evolutions) { … }` block (`UpgradePanel.ts:276`)
with the version below. Two things change: the block now runs for **every** upgrade rather than
only ones with evolutions, and the memo key covers the sibling line a `combine: 'sum'` hint reads
(levelling `critDamage` has to refresh `critChance`'s hint, and the old `!== level` check would
not have noticed).

```ts
      if (evoEl) {
        // The lines below depend on `level` and — for a `combine: 'sum'` mark
        // — on the *sibling* line's level too. Skip the full innerHTML rebuild
        // unless one of those has changed since the last render, so selecting
        // the description text isn't broken every UI tick.
        const memoKey = markMemoKey(u.id, level, state.upgrades);
        if (this.evoInfoLastLevel.get(u.id) !== memoKey) {
          this.evoInfoLastLevel.set(u.id, memoKey);
          evoEl.innerHTML = '';
          let hasContent = false;
          // Show unlocked evolution effects
          for (const evo of u.evolutions ?? []) {
            if (level >= evo.level) {
              const line = document.createElement('div');
              line.className = 'evo-line evo-unlocked';
              line.textContent = `★ ${evo.name}: ${evo.description}`;
              evoEl.appendChild(line);
              hasContent = true;
            }
          }
          // Show next evolution hint (purple, name only). `getNextEvolution`
          // already returns null for an upgrade with no evolutions.
          const nextEvo = getNextEvolution(u, level);
          if (nextEvo) {
            const line = document.createElement('div');
            line.className = 'evo-line evo-next';
            line.textContent = `Evolves at Lv${nextEvo.level}: ${nextEvo.name}`;
            evoEl.appendChild(line);
            hasContent = true;
          }
          // The next tower-visual change on this line (`plans/tower-ui.md` §F.3).
          const nextMark = getNextMark(u.id, state.upgrades);
          if (nextMark) {
            const line = document.createElement('div');
            line.className = 'evo-line mark-next';
            const combined = nextMark.def.sources.length > 1
              ? ` (${nextMark.def.sources.length} lines combined)`
              : '';
            line.textContent =
              `Lv${nextMark.at}${combined}: ${nextMark.def.part} — ${nextMark.def.announce[nextMark.step - 1]}`;
            evoEl.appendChild(line);
            hasContent = true;
          }
          setDisplay(evoEl, hasContent ? '' : 'none');
        }
      }
```

And add the memo helper at module scope, beside `getNextMark`:

```ts
/**
 * `level`, folded together with every sibling level a mark hint for this
 * upgrade would read.
 *
 * `evoInfoLastLevel` is a `Map<string, number>` and stays one — this is still
 * a number, just one that covers more than a single line. `1009` is an
 * arbitrary small prime; two lines never push the product anywhere near
 * `Number.MAX_SAFE_INTEGER` at `maxLevel` 200.
 */
function markMemoKey(upgradeId: string, level: number, levels: Record<string, number>): number {
  let key = level;
  for (const def of TOWER_MARKS) {
    if (!def.sources.includes(upgradeId)) continue;
    for (const id of def.sources) key = key * 1009 + (levels[id] ?? 0);
  }
  return key;
}
```

**`src/styles/main.css`** — beside `.evo-next` (`main.css:3152`):

```css
.mark-next {
  color: var(--fx-gold);
}
```

`--fx-gold` is a declared token (`docs/art-direction.md`), so this passes the literal guard.

**Acceptance for Part F:** buying `damage` to L4 pops one milestone toast, one gold ring, and the
barrel visibly changes in the same frame. Buying x100 at L3 pops one ring, not six.

---

## 8. Part G — tests

### G.1 New file: `tests/tower-marks.test.ts`

```ts
/**
 * The tower-mark table (`plans/tower-ui.md`).
 *
 * Marks are presentation, so nothing here checks a balance number. What it does
 * check is the two ways the table can be silently wrong: a threshold ladder
 * that is not monotonic (so a step can never be reached), and an `announce`
 * list that does not line up with it (so a toast reads the wrong line or
 * `undefined`).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  TOWER_MARKS, TOWER_MARK_IDS, TOWER_MARK_BY_ID, DEFAULT_TOWER_MARKS,
  computeTowerMarks,
} from '../src/data/towerMarks';
import { UPGRADE_BY_ID } from '../src/data/upgrades';
import { ICON_IDS } from '../src/data/icons';

describe('the tower-mark table', () => {
  it('has a unique id per mark', () => {
    expect(new Set(TOWER_MARK_IDS).size).toBe(TOWER_MARKS.length);
  });

  for (const def of TOWER_MARKS) {
    describe(def.id, () => {
      it('names only real upgrades', () => {
        expect(def.sources.length).toBeGreaterThan(0);
        for (const id of def.sources) {
          expect(UPGRADE_BY_ID[id], `${def.id} sources unknown upgrade "${id}"`).toBeDefined();
        }
      });

      it('has an ascending, positive threshold ladder', () => {
        expect(def.thresholds.length).toBeGreaterThan(0);
        for (let i = 0; i < def.thresholds.length; i++) {
          expect(def.thresholds[i]).toBeGreaterThan(0);
          if (i > 0) expect(def.thresholds[i]).toBeGreaterThan(def.thresholds[i - 1]);
        }
      });

      it('can actually reach its top step', () => {
        // `sum` marks add their sources' caps; `max` marks take the largest.
        const caps = def.sources.map(id => UPGRADE_BY_ID[id].maxLevel);
        const reachable = def.combine === 'sum'
          ? caps.reduce((a, b) => a + b, 0)
          : Math.max(...caps);
        const top = def.thresholds[def.thresholds.length - 1];
        expect(reachable, `${def.id} step ${def.thresholds.length} is unreachable`)
          .toBeGreaterThanOrEqual(top);
      });

      it('announces every step exactly once', () => {
        expect(def.announce.length).toBe(def.thresholds.length);
        for (const line of def.announce) expect(line.trim().length).toBeGreaterThan(0);
      });

      it('names an icon that exists', () => {
        expect(ICON_IDS).toContain(def.icon);
      });
    });
  }
});

describe('computeTowerMarks', () => {
  it('is all-zero for a fresh set of levels', () => {
    expect(DEFAULT_TOWER_MARKS.steps.barrel).toBe(0);
    expect(DEFAULT_TOWER_MARKS.key).toBe('0.'.repeat(TOWER_MARKS.length));
  });

  it('steps exactly at the threshold, not one level early or late', () => {
    for (const def of TOWER_MARKS) {
      const at = def.thresholds[0];
      const below: Record<string, number> = {};
      const on: Record<string, number> = {};
      // Put the whole combined level on the first source; for `sum` that is
      // the same total, for `max` it is the max.
      below[def.sources[0]] = at - 1;
      on[def.sources[0]] = at;
      expect(computeTowerMarks(below).steps[def.id], `${def.id} stepped early`).toBe(0);
      expect(computeTowerMarks(on).steps[def.id], `${def.id} did not step`).toBe(1);
    }
  });

  it('sums the sources of a `sum` mark and takes the max of a `max` one', () => {
    const optics = TOWER_MARK_BY_ID.optics;
    const half = Math.ceil(optics.thresholds[0] / 2);
    const split = { critChance: half, critDamage: optics.thresholds[0] - half };
    expect(computeTowerMarks(split).steps.optics).toBe(1);

    const barrel = TOWER_MARK_BY_ID.barrel;
    expect(barrel.combine).toBe('max');
    expect(computeTowerMarks({ damage: barrel.thresholds[0] }).steps.barrel).toBe(1);
  });

  it('gives a different key to a different set of steps', () => {
    const a = computeTowerMarks({ damage: 4 });
    const b = computeTowerMarks({ damage: 12 });
    expect(a.key).not.toBe(b.key);
    expect(a.key).not.toBe(DEFAULT_TOWER_MARKS.key);
  });

  it('freezes what it returns, so the renderer can hold it by reference', () => {
    const marks = computeTowerMarks({ damage: 30 });
    expect(Object.isFrozen(marks)).toBe(true);
    expect(Object.isFrozen(marks.steps)).toBe(true);
  });
});

/**
 * The coverage guard: a mark nobody paints is flavour text, exactly like the
 * twenty dead talents `tests/content-coverage.test.ts` was written for.
 */
describe('every mark is consumed by the renderer', () => {
  const RENDERER = readFileSync(resolve(__dirname, '../src/game/Renderer.ts'), 'utf8');
  for (const id of TOWER_MARK_IDS) {
    it(`${id} is read in Renderer.ts`, () => {
      expect(
        RENDERER.includes(`steps.${id}`),
        `no painter reads \`this.marks.steps.${id}\` — the mark changes nothing on screen`,
      ).toBe(true);
    });
  }
});
```

### G.2 The invalidation guard

Append to the same file — this is the one that catches the memory bug if someone "simplifies"
`towerPart` back into `part`:

```ts
describe('the tower sprite cache is evictable', () => {
  const RENDERER = readFileSync(resolve(__dirname, '../src/game/Renderer.ts'), 'utf8');

  it('paints the drum, plinth, turret and wall through `towerPart`', () => {
    for (const family of ["'drum'", "'plinth'", "'turret'", '`wall|${state}`']) {
      expect(
        RENDERER.includes(`towerPart(${family}`),
        `${family} must be baked in the evictable tower cache, not in \`part\` — `
        + 'the mark key space is combinatorial (see plans/tower-ui.md §C)',
      ).toBe(true);
    }
  });

  it('clears that cache when the signature moves', () => {
    expect(RENDERER).toContain('this.towerSprites.clear()');
  });
});
```

### G.3 Extend the content-coverage guard

In `tests/content-coverage.test.ts`, add the import and one block so the mark table joins the
other closed content tables the file guards:

```ts
import { TOWER_MARKS } from '../src/data/towerMarks';

describe('tower marks', () => {
  it('covers both the damage and the health line, which is the whole ask', () => {
    const sourced = new Set(TOWER_MARKS.flatMap(m => [...m.sources]));
    expect(sourced.has('damage')).toBe(true);
    expect(sourced.has('health')).toBe(true);
  });

  it('gives each upgrade line to at most one mark', () => {
    const seen = new Set<string>();
    for (const m of TOWER_MARKS) {
      for (const id of m.sources) {
        expect(seen.has(id), `${id} feeds two marks — they will fight over the same anatomy`)
          .toBe(false);
        seen.add(id);
      }
    }
  });
});
```

### G.4 The literal-colour guard runs automatically

`tests/palette.test.ts` already scans `Renderer.ts`, `EffectsManager.ts`, `Game.ts` and every
`src/ui/*.ts`. It does **not** scan `src/data/*`, so `towerMarks.ts` is unguarded — which is fine,
because it declares no colours. If you add one there, move the colour to `palette.ts` instead.

**Acceptance for Part G:** `npm test` green, with the new file's ~45 cases included. Deliberately
break one threshold ladder (make `barrel` `[12, 4, …]`) and confirm the suite goes red.

---

## 9. Part H — docs

Every one of these is a required part of the change, not a follow-up.

| File | Edit |
|---|---|
| `docs/tower-system.md` | New section **"Upgrade marks"** after "Visual constants": the table from §1.1 of this plan, the fact that marks are presentation-only, and that `computeTowerMarks` is called on level change and never per frame. |
| `docs/upgrade-system.md` | Under "Upgrade Effects Application", add: "Ten upgrade lines also drive a **tower mark** — see `docs/tower-system.md#upgrade-marks`. Marks change no stat." |
| `docs/performance.md` | Under "Renderer sprite cache", add a `towerSprites` row to the cache table, and a paragraph: the key space is combinatorial, the map is cleared on signature change, and **the invariant is that no mark-dependent sprite may go in `partSprites`**. |
| `docs/event-bus.md` | One row in the catalog: `` `tower_mark_changed` `` \| `{ id, step, def }` \| Game \| Game (toast + forge flourish). |
| `docs/art-direction.md` | In the canvas-literal section, add a line: iron plating is `INK['200']`, chosen because a lighter *stone* reads as a lighting change rather than a second material. |
| `AGENTS.md` | Add `| Tower marks | 10 | src/data/towerMarks.ts |` to the "Content at a glance" table. |

---

## 10. Acceptance for the whole change

Land nothing until all nine hold.

1. `npm run typecheck` — clean.
2. `npm test` — green, including `tests/tower-marks.test.ts`.
3. `npm run checks` — green.
4. `npm run sim` — output **byte-identical** to `HEAD`. Any diff is a bug: this plan touches no
   balance input.
5. A fresh save paints a tower **pixel-identical** to `HEAD` (every mark is 0 except `barrel` and
   `masonry`, whose first thresholds are 4 and 5 while `startLevel` is 1).
6. Buying `damage` L1→L4 changes the barrel, pops one milestone toast, and fires one gold ring.
7. A save loaded at high levels paints the upgraded tower and pops **no** toasts.
8. Frame budget holds: 250 enemies with saturated pools at 60 fps desktop and ≥45 fps at the `low`
   tier on a 375x812 viewport, unchanged from `HEAD`. The tower is five blits either way; the only
   new per-frame work is one string compare, four range-rim strokes at `mast` 3, and one extra
   blit at `conduits` 3.
9. Buying a hundred levels in a row does not grow `performance.memory.usedJSHeapSize`
   monotonically — `towerSprites` is capped by construction at one sprite per family.

### 10.1 Suggested commit split

| Commit | Contents |
|---|---|
| 1 | Part A + Part G.1's table tests. Data only, nothing renders differently. |
| 2 | Part B + Part C. Plumbing and the evictable cache; the tower is pixel-identical. Part G.2 lands here. |
| 3 | Part D.1–D.3 (the turret family). |
| 4 | Part D.4–D.8 (the drum family). |
| 5 | Part D.9–D.10 (plinth and wall) + Part E. |
| 6 | Part F (the moment) + Part G.3 + Part H. |

Run `detect_changes()` before each one, per the repo's `CLAUDE.md`.

---

## 11. Adding an eleventh mark, later

1. Add a row to `TOWER_MARKS` in `src/data/towerMarks.ts`: `sources`, `combine`, `thresholds`
   (ascending, reachable inside the sources' `maxLevel`), `part`, `icon` (must be in `ICON_IDS`),
   `announce` (one line per threshold).
2. `npm test` — `tower-marks.test.ts` now fails with "no painter reads
   `this.marks.steps.<id>`". That failure is the to-do list.
3. Write the painter. Pick an anatomy **nothing else owns** (§1.1 is the register), read the step
   from `this.marks.steps.<id>`, bake into a `towerPart` sprite, light it from
   `TOWER_VISUAL.lightAngle`, size it with `entity()`, and colour it from `palette.ts`.
4. Update §1.1's table here, `docs/tower-system.md`, and the count in `AGENTS.md`.

No change to `Game`, `types.ts`, the snapshot, the cache-invalidation logic, the toast or the
upgrade-panel hint is needed — all of them iterate the table.
