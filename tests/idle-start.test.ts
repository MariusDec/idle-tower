import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { newProfile } from '../src/meta/profile';
import { idleStartFile, loadIdleStart, runIdle, saveIdleStart } from '../tools/idle';

/** plans/late-game/12a W9: the idle bot from a given profile, and its saved starts. */
describe('runIdle from a start (W9)', () => {
  it('starts from a copy of the given profile, and from a fresh one otherwise', () => {
    const start = newProfile(0);
    start.storedLight = 777;
    // No check-in at all: the report reads the profile it began with.
    expect(runIdle(0, 1, [], 'hands-off', start).poolAtEnd).toBe(777);
    expect(runIdle(0, 1, []).poolAtEnd).toBe(0);
  });

  it('leaves the given profile as it was', () => {
    const start = newProfile(0);
    const before = structuredClone(start);
    const report = runIdle(0.5, 1, [], 'hands-off', start);
    expect(report.checkins).toBe(1);
    expect(report.runs).toBeGreaterThan(0);
    expect(start).toEqual(before);
  });
});

describe('idle starts on disk (W9)', () => {
  let dir = '';
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('a saved start loads back the same; a missing one is null', () => {
    dir = mkdtempSync(join(tmpdir(), 'idle-starts-'));
    const file = idleStartFile(3, `${dir}/nested`);
    expect(file).toBe(`${dir}/nested/seed-3.json`);
    expect(loadIdleStart(file)).toBeNull();
    const profile = newProfile(0);
    profile.shards = 1234;
    profile.bosses.gatekeeper = { kills: 1, fastest: 60 };
    saveIdleStart(file, { at: 86400 * 6, profile });
    const back = loadIdleStart(file)!;
    expect(back.at).toBe(86400 * 6);
    expect(back.profile).toEqual(profile);
  });

  it('an older save is walked up the ladder', () => {
    dir = mkdtempSync(join(tmpdir(), 'idle-starts-'));
    const file = idleStartFile(1, dir);
    const profile = newProfile(0);
    saveIdleStart(file, { at: 1, profile });
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { at: number; profile: { version: number } };
    raw.profile.version = profile.version - 1;
    writeFileSync(file, JSON.stringify(raw));
    expect(loadIdleStart(file)!.profile.version).toBe(profile.version);
  });
});
