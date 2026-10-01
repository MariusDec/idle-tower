/**
 * The profile: all meta state (§12.4). Owned by `meta/`; `sim/` never sees it,
 * only the frozen `RunConfig` that `buildRunConfig` derives from it.
 *
 * It starts small: fields arrive with the phase that uses them, and
 * each arrival that changes the shape is a new version on the ladder in
 * `save/migrate.ts`.
 */
export interface Profile {
  version: 7;
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
   * for Tactician I, and with Tactician II one per frame id.
   */
  tactics: Record<string, string[]>;
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
  /** The region and frame the next run uses (§5.2, §4.4); the Abyss is `ABYSS_INDEX`. */
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
    /** Sound on or off (§10.4); the pause menu toggles it. */
    sound: boolean;
    /** Autocaster on or off, once owned (§6.2); the HUD toggles it. */
    autoUlt: boolean;
  };
}

export const PROFILE_VERSION = 7;

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
    starlight: 0,
    stars: {},
    pacts: { ranks: {}, best: {} },
    abyss: { best: 0 },
    region: 1,
    frame: 'arcanist',
    tutorial: { firstDraft: false, forgeIntro: false },
    settings: { speed: 1, sound: true, autoUlt: true },
  };
}
