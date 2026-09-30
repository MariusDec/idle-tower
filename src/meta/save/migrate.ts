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
