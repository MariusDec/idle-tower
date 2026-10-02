/**
 * The profile: all meta state (§12.4). Owned by `meta/`; `sim/` never sees it,
 * only the frozen `RunConfig` that `buildRunConfig` derives from it.
 *
 * It starts small: fields arrive with the phase that uses them, and
 * each arrival that changes the shape is a new version on the ladder in
 * `save/migrate.ts`.
 */
export interface Profile {
  version: 11;
  /** Wall-clock ms the profile was created. */
  createdAt: number;
  /** The meta currency (§8.1), spent in the Forge. Whole shards only. */
  shards: number;
  /** Lifetime records and totals, for the results screen's NEW RECORD callouts. */
  records: {
    runs: number;
    bestWave: number;
    /** Most shards banked by one run. */
    bestShards: number;
    kills: number;
    elites: number;
  };
  /** Forge levels owned, by node id (§5.1). A missing id is level 0. */
  forge: Record<string, number>;
  /** Draft cards seen at least once, by `cardKey`, for the NEW stamp (§4.5). */
  seenCards: string[];
  /** Enemy types ever seen, for discoveries and the Bestiary (§5.3). */
  seenEnemies: string[];
  /** Lifetime kills by enemy type, for the Bestiary. */
  killsBy: Record<string, number>;
  /** Best wave per region, by region index (§5.2). */
  regions: Record<string, { bestWave: number }>;
  /** Bosses met, by id: kills and the fastest kill in seconds (§5.2's trophy). */
  bosses: Record<string, { kills: number; fastest: number | null }>;
  /** Relics owned, by id, at their rank 1–3 (§5.3). */
  relics: Record<string, number>;
  /** Relics worn into the next run; never more than the relic slots. */
  equipped: string[];
  /** Feats earned ('done') and paid ('claimed'), by id (§5.4). */
  feats: Record<string, 'done' | 'claimed'>;
  /** Shards per minute of the most recent runs, newest last: the offline farm rate (§6.3). */
  farm: number[];
  /** Wall-clock ms the game was last open, for offline earnings (§6.1). */
  lastSeen: number;
  /**
   * The Recipe Book (§5.3): evolutions found, and for the hints, runs that
   * carried each weapon and runs that took it to its evolving level, by id.
   */
  recipes: {
    found: string[];
    carried: Record<string, number>;
    readied: Record<string, number>;
  };
  /** A boss whose first fall still owes the map its ceremony (§7.3). */
  ceremony: string | null;
  /**
   * The Tactician's priority lists (§6.2), card item ids best first: `all`
   * for Tactician I; with Tactician II one per frame id, and one per frame
   * in a region, `frame@region` (U7).
   */
  tactics: Record<string, string[]>;
  /** The Tactician's Never lists (U7), keyed as `tactics`: never suggested while anything else is offered. */
  tacticsNever: Record<string, string[]>;
  /** Starlight (§9): Act 2's currency, spent in the Constellations. Whole only. */
  starlight: number;
  /** Constellation levels owned, by node id (§9). A missing id is level 0. */
  stars: Record<string, number>;
  /** The pacts (§9). */
  pacts: {
    /** The ranks the next run in a region is under, by pact id. */
    ranks: Record<string, number>;
    /** The highest heat each region's boss has fallen at, by region index: the records Starlight pays for. */
    best: Record<string, number>;
  };
  /** The Abyss (§9): the deepest floor whose boss has fallen. */
  abyss: { best: number };
  /** Boss Rush (N8): the most stages cleared in one run, and the fastest full clear in sim seconds. */
  rush: { best: number; time: number | null };
  /** Fusions found (N9), by id, in the order found: the Recipe Book's second page. */
  fusions: string[];
  /** The Foreman's wishlist (N7): Forge node ids, in the order it buys them. At most `WISHLIST_MAX`. */
  wishlist: string[];
  /** Trials won (N5), by trial id: each pays once. */
  trials: Record<string, true>;
  /** The trial the next run is (N5), or null for an ordinary run. Cleared once that run banks. */
  trial: string | null;
  /**
   * Relic-set progress (N6), by region index: duplicates of a set's relics
   * past rank III. It ranks the set's bonus up.
   */
  sets: Record<string, number>;
  /** The region and frame the next run uses (§5.2, §4.4); the Abyss is `ABYSS_INDEX`, Boss Rush `RUSH_INDEX`. */
  region: number;
  frame: string;
  /** One-time teaching moments (§7.1), true once done. */
  tutorial: {
    /** The first draft of the game: authored, and the only one that pauses. */
    firstDraft: boolean;
    /** The first visit to the Forge, which highlights a node to buy. */
    forgeIntro: boolean;
  };
  settings: {
    /** Sim speed multiplier, 1–3 (§12.3). */
    speed: 1 | 2 | 3;
    /** Sound on or off (§10.4): the master switch, over the volumes. */
    sound: boolean;
    /** Autocaster on or off, once owned (§6.2); the HUD toggles it. */
    autoUlt: boolean;
    /** Master, effects and music levels, 0–1 each (§10.4). */
    volume: { master: number; sfx: number; music: number };
    /** Screen shake (§10.3). */
    shake: boolean;
    /** Reduced motion: follow the device's setting, or force it on or off. */
    motion: MotionSetting;
    /** The canvas's weapon and effect colours: standard, or colourblind-safe. */
    palette: 'standard' | 'safe';
    /** The text size, as a multiple of the base type ramp. */
    textScale: number;
  };
}

export const PROFILE_VERSION = 11;

export type MotionSetting = 'system' | 'reduce' | 'full';

/** The text sizes the settings offer. */
export const TEXT_SCALES: readonly number[] = [1, 1.15, 1.3];

/** The settings a new profile starts with (and the v8 rung fills in). */
export function defaultSettings(): Profile['settings'] {
  return {
    speed: 1,
    sound: true,
    autoUlt: true,
    volume: { master: 1, sfx: 1, music: 0.6 },
    shake: true,
    motion: 'system',
    palette: 'standard',
    textScale: 1,
  };
}

export function newProfile(now: number): Profile {
  return {
    version: PROFILE_VERSION,
    createdAt: now,
    shards: 0,
    records: { runs: 0, bestWave: 0, bestShards: 0, kills: 0, elites: 0 },
    forge: {},
    seenCards: [],
    seenEnemies: [],
    killsBy: {},
    regions: {},
    bosses: {},
    relics: {},
    equipped: [],
    feats: {},
    farm: [],
    recipes: { found: [], carried: {}, readied: {} },
    lastSeen: now,
    ceremony: null,
    tactics: {},
    tacticsNever: {},
    starlight: 0,
    stars: {},
    pacts: { ranks: {}, best: {} },
    abyss: { best: 0 },
    rush: { best: 0, time: null },
    fusions: [],
    wishlist: [],
    trials: {},
    trial: null,
    sets: {},
    region: 1,
    frame: 'arcanist',
    tutorial: { firstDraft: false, forgeIntro: false },
    settings: defaultSettings(),
  };
}
