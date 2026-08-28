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
