import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/content/balance';
import { FORGE_BY_ID } from '../src/content/forge';
import { newProfile, type Profile } from '../src/meta/profile';
import { farmRate, offlineEarnings, storedRates } from '../src/meta/offline';
import { bankRun } from '../src/meta/results';
import { buildRunConfig } from '../src/meta/runConfig';
import { burnBonus, emptyTally, tallyWave, waveEngaged } from '../src/meta/storedLight';
import { explainerOpen } from '../src/meta/explainers';
import { createRun } from '../src/sim/run';
import { tallyOf } from '../tools/idle';

/** Stored Light (plans/late-game/01). */

const NIGHT = ['offline', 'offline-2', 'offline-3', 'offline-4'];

/** A profile owning Night Watch up to `tier` (1–4), with a farm rate of `rate` shards a minute. */
function watching(tier: number, rate = 100): Profile {
  const p = newProfile(0);
  p.tutorial.firstDraft = true;
  for (const id of NIGHT.slice(0, tier)) p.forge[id] = 1;
  p.farm = [rate, rate, rate];
  return p;
}

const T3 = BALANCE.offline.tiers[2].stored!;
const T4 = BALANCE.offline.tiers[3].stored!;

describe('the split (§3.1)', () => {
  it('tiers I–II store nothing; III and IV store on their own efficiency and cap', () => {
    const night = 12 * 3600;
    expect(offlineEarnings(watching(2), night)!.stored).toBe(0);
    const three = offlineEarnings(watching(3), night)!;
    expect(three.stored).toBe(Math.floor(100 * T3.capHours * 60 * T3.efficiency));
    const four = offlineEarnings(watching(4), night)!;
    expect(four.stored).toBe(Math.floor(100 * T4.capHours * 60 * T4.efficiency));
  });

  it('buying III or IV never shrinks the instant part below tier II\'s', () => {
    const night = 12 * 3600;
    const two = offlineEarnings(watching(2), night)!.shards;
    expect(offlineEarnings(watching(3), night)!.shards).toBe(two);
    expect(offlineEarnings(watching(4), night)!.shards).toBe(two);
  });

  it('a short absence stores for its own length, under the cap', () => {
    const e = offlineEarnings(watching(4), 3600)!;
    expect(e.stored).toBe(Math.floor(100 * 60 * T4.efficiency));
  });
});

describe('engaged (§3.3)', () => {
  const S = BALANCE.offline.engagedSeconds * 1000;
  it('a touch during the wave, or in the window before its end, counts', () => {
    const start = 100_000;
    const end = start + 60_000;
    expect(waveEngaged(start + 5_000, start, end)).toBe(true);
    expect(waveEngaged(end - S, start, end)).toBe(true);
    expect(waveEngaged(start - 1, start, end)).toBe(false);
    // A short wave: a touch just before it began still counts, within the window.
    expect(waveEngaged(start - 1_000, start, start + 10_000)).toBe(true);
    expect(waveEngaged(start + 10_000 - S - 1, start, start + 10_000)).toBe(false);
    expect(waveEngaged(0, start, end)).toBe(false);
  });

  it('a tally over waves with mixed touches splits the shards', () => {
    const t = emptyTally();
    tallyWave(t, 50, true);
    tallyWave(t, 30, false);
    tallyWave(t, 20, true);
    tallyWave(t, 0, false);
    expect(t).toEqual({ engaged: 70, handsOff: 30 });
  });

  it('nothing the app does by itself stamps the last touch', () => {
    const src = readFileSync(resolve(__dirname, '../src/app/App.ts'), 'utf8');
    // One write, in the capture listener on trusted pointer and key events.
    const writes = [...src.matchAll(/this\.lastTouch\s*=(?!=)/g)];
    expect(writes).toHaveLength(1);
    const listener = src.slice(src.indexOf('const touched'), src.indexOf("addEventListener('keydown', touched, true)"));
    expect(listener).toContain('e.isTrusted');
    expect(listener).toContain('this.lastTouch = Date.now()');
  });
});

describe('the burn (§3.2)', () => {
  it('pays each bucket at its own rate, and never more than the pool', () => {
    const p = watching(3);
    p.storedLight = 10_000;
    const b = burnBonus(p, { engaged: 100, handsOff: 100 })!;
    expect(b.bonus).toBe(100 * (T3.engaged - 1) + 100 * (T3.handsOff - 1));
    expect(b.engagedBonus).toBe(100 * (T3.engaged - 1));
    expect(b.left).toBe(10_000 - b.bonus);
    p.storedLight = 150;
    const c = burnBonus(p, { engaged: 1000, handsOff: 1000 })!;
    expect(c.bonus).toBe(150);
    expect(c.left).toBe(0);
  });

  it('nothing to burn: no pool, or no store owned and none left', () => {
    expect(burnBonus(watching(4), { engaged: 100, handsOff: 0 })).toBeNull();
    expect(burnBonus(watching(2), { engaged: 100, handsOff: 0 })).toBeNull();
  });

  it('a refunded Night Watch III still burns at III\'s rates', () => {
    const p = watching(2);
    p.storedLight = 1000;
    expect(storedRates(p)).toEqual(T3);
    expect(burnBonus(p, { engaged: 10, handsOff: 0 })!.bonus).toBe(10 * (T3.engaged - 1));
  });

  it('the pool never fades across two absences', () => {
    const p = watching(4);
    const a = offlineEarnings(p, 12 * 3600)!;
    p.storedLight += a.stored;
    const b = offlineEarnings(p, 12 * 3600)!;
    p.storedLight += b.stored;
    expect(p.storedLight).toBe(a.stored + b.stored);
  });
});

describe('banking a run (§3.4)', () => {
  const ranRun = (p: Profile) => {
    const run = createRun(buildRunConfig(p), 5);
    run.shards = 400;
    run.time = 600;
    return run;
  };

  it('adds the bonus to shards, takes it off the pool, and reports it', () => {
    const p = watching(4);
    p.storedLight = 50_000;
    const before = p.shards;
    const s = bankRun(p, ranRun(p), [], 1, tallyOf('active', 400));
    expect(s.shards).toBe(400);
    expect(s.stored).toEqual({ bonus: 400 * (T4.engaged - 1), engagedBonus: 400 * (T4.engaged - 1), left: 50_000 - 400 * (T4.engaged - 1), rate: T4.engaged });
    expect(p.shards - before).toBe(400 + s.stored!.bonus);
    expect(p.storedLight).toBe(s.stored!.left);
    expect(p.records.storedBurned).toBe(s.stored!.bonus);
    expect(s.activeOnly).toEqual([{ kind: 'stored-played', amount: s.stored!.engagedBonus }]);
  });

  it('records and the farm rate read base shards only: a boosted run is no richer next night', () => {
    const boosted = watching(4);
    boosted.storedLight = 50_000;
    const plain = watching(4);
    bankRun(boosted, ranRun(boosted), [], 1, tallyOf('active', 400));
    bankRun(plain, ranRun(plain), [], 1, tallyOf('active', 400));
    expect(farmRate(boosted)).toBe(farmRate(plain));
    expect(boosted.records.bestShards).toBe(plain.records.bestShards);
  });

  it('a hands-off run earns nothing active-only (I9)', () => {
    const p = watching(4);
    p.storedLight = 50_000;
    const s = bankRun(p, ranRun(p), [], 1, tallyOf('idle', 400));
    expect(s.stored!.engagedBonus).toBe(0);
    expect(s.activeOnly).toEqual([]);
  });

  it('without a tally the pool is left alone', () => {
    const p = watching(4);
    p.storedLight = 50_000;
    const s = bankRun(p, ranRun(p));
    expect(s.stored).toBeNull();
    expect(p.storedLight).toBe(50_000);
  });

  it('the explainer opens once there is a pool, or once one was burned', () => {
    const p = watching(4);
    expect(explainerOpen(p, 'stored')).toBe(false);
    p.storedLight = 1;
    expect(explainerOpen(p, 'stored')).toBe(true);
  });
});

describe('content (§4)', () => {
  it('stored tiers: played beats left alone, caps hold the instant cap, both rise with tier', () => {
    const stored = BALANCE.offline.tiers.flatMap((t) => (t.stored ? [{ t, s: t.stored }] : []));
    expect(stored.length).toBeGreaterThan(0);
    for (const { t, s } of stored) {
      expect(s.engaged).toBeGreaterThan(s.handsOff);
      expect(s.handsOff).toBeGreaterThanOrEqual(1);
      expect(s.capHours).toBeGreaterThanOrEqual(t.capHours);
    }
    for (let i = 1; i < stored.length; i++) {
      expect(stored[i].s.engaged).toBeGreaterThan(stored[i - 1].s.engaged);
      expect(stored[i].s.capHours).toBeGreaterThan(stored[i - 1].s.capHours);
    }
  });

  it('the Night Watch texts quote BALANCE', () => {
    const tiers = BALANCE.offline.tiers;
    for (const [i, id] of NIGHT.entries()) {
      const text = FORGE_BY_ID[id].text;
      const t = tiers[i];
      if (!t.stored) {
        expect(text).toContain(`${Math.round(t.efficiency * 100)}%`);
        expect(text).toContain(`${t.capHours} h`);
      } else {
        expect(text).toContain(`${t.stored.capHours} h`);
        expect(text).toContain(`×${t.stored.engaged}`);
      }
    }
  });
});
