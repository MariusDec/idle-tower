import { PROFILE_VERSION } from '../profile';

/**
 * The migration ladder (§12.4). Each rung takes a raw object at version `n`
 * and returns it at `n + 1`. Every rung has a fixture in `tests/save.test.ts`.
 */
export type RawProfile = { version: number } & Record<string, unknown>;
export type Migration = (raw: RawProfile) => RawProfile;

export const MIGRATIONS: Readonly<Record<number, Migration>> = {
  // v2 (P2): the draft's NEW stamps and the first-draft lesson.
  1: (raw) => ({ ...raw, version: 2, seenCards: [], tutorial: { firstDraft: false } }),
  // v3 (P3): the Forge, run totals and the enemies seen.
  2: (raw) => ({
    ...raw,
    version: 3,
    records: { bestShards: 0, kills: 0, ...(raw.records as object) },
    forge: {},
    seenEnemies: [],
    tutorial: { forgeIntro: false, ...(raw.tutorial as object) },
  }),
  // v4 (P4): bosses, regions, relics, feats, frames and the offline farm rate.
  3: (raw) => ({
    ...raw,
    version: 4,
    records: { elites: 0, ...(raw.records as object) },
    killsBy: {},
    regions: {},
    bosses: {},
    relics: {},
    equipped: [],
    feats: {},
    farm: [],
    lastSeen: raw.createdAt,
    ceremony: null,
    region: 1,
    frame: 'arcanist',
  }),
  // v5 (P5): the Recipe Book and the sound toggle.
  4: (raw) => ({
    ...raw,
    version: 5,
    recipes: { found: [], carried: {}, readied: {} },
    settings: { sound: true, ...(raw.settings as object) },
  }),
  // v6 (P6): the Tactician's lists and the Autocaster toggle.
  5: (raw) => ({
    ...raw,
    version: 6,
    tactics: {},
    settings: { autoUlt: true, ...(raw.settings as object) },
  }),
  // v7 (P8): Act 2: Starlight, the Constellations, the pacts and the Abyss.
  6: (raw) => ({
    ...raw,
    version: 7,
    starlight: 0,
    stars: {},
    pacts: { ranks: {}, best: {} },
    abyss: { best: 0 },
  }),
  // v8 (P9): the settings: volumes, screen shake, motion, palette, text size.
  7: (raw) => ({
    ...raw,
    version: 8,
    settings: {
      volume: { master: 1, sfx: 1, music: 0.6 },
      shake: true,
      motion: 'system',
      palette: 'standard',
      textScale: 1,
      ...(raw.settings as object),
    },
  }),
};

export class MigrationError extends Error {}

/**
 * Walk `raw` up the ladder to `target`. Throws on a version from the future or
 * a missing rung — the caller decides what a broken save means, never this.
 */
export function migrate(
  raw: RawProfile,
  ladder: Readonly<Record<number, Migration>> = MIGRATIONS,
  target: number = PROFILE_VERSION,
): RawProfile {
  if (!Number.isInteger(raw.version) || raw.version < 1) {
    throw new MigrationError(`not a profile version: ${String(raw.version)}`);
  }
  if (raw.version > target) {
    throw new MigrationError(`profile v${raw.version} is newer than this build (v${target})`);
  }
  let cur = raw;
  while (cur.version < target) {
    const step = ladder[cur.version];
    if (!step) throw new MigrationError(`no migration from v${cur.version}`);
    const next = step(cur);
    if (next.version !== cur.version + 1) {
      throw new MigrationError(`migration from v${cur.version} produced v${next.version}`);
    }
    cur = next;
  }
  return cur;
}
