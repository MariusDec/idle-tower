import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/content/balance';
import { offlineEarnings, offlineTier, paidTier } from '../src/meta/offline';
import { newProfile, type Profile } from '../src/meta/profile';
import { poolPlayText, welcomeCard, type WelcomeFacts } from '../src/ui/welcome';

/**
 * R8 (plans/review-risks.md): idle pay from the first session. §1 pays a
 * small built-in Night Watch 0 before any tier is owned; §2 makes the
 * welcome-back a headline and a line per thing that happened; §3's chip
 * already showed ×5/×2 live, and now says why the first time it dims.
 */

function farming(nodes: string[], rate = 100): Profile {
  const p = newProfile(0);
  for (const id of nodes) p.forge[id] = 1;
  p.farm = [rate];
  return p;
}

const facts = (over: Partial<WelcomeFacts> = {}): WelcomeFacts => ({
  away: 3 * 3600 + 12 * 60, shards: 1200, stored: 0, pool: 0, farm: 100, rates: null,
  capHours: 1, nightWatch: false, bought: '', boughtCount: 0, held: null, fresh: [], ...over,
});

describe('R8 §1: Night Watch 0', () => {
  it('pays 10% for up to 1 h before any Night Watch, and stores nothing', () => {
    const p = farming([]);
    expect(offlineTier(p)).toBeNull();
    expect(paidTier(p)).toBe(BALANCE.offline.base);
    const e = offlineEarnings(p, 8 * 3600)!;
    expect(e.paid).toBe(3600);
    expect(e.shards).toBe(Math.floor(100 * 60 * 0.1));
    expect(e.stored).toBe(0);
  });

  it('is smaller than Night Watch I on every axis, so buying I is always a raise', () => {
    const base = BALANCE.offline.base;
    const one = BALANCE.offline.tiers[0];
    expect(base.efficiency).toBeLessThan(one.efficiency);
    expect(base.capHours).toBeLessThan(one.capHours);
    expect(offlineEarnings(farming(['offline']), 8 * 3600)!.shards)
      .toBeGreaterThan(offlineEarnings(farming([]), 8 * 3600)!.shards);
  });

  it('an owned tier replaces it', () => {
    expect(paidTier(farming(['offline']))).toBe(BALANCE.offline.tiers[0]);
  });
});

describe('R8 §2: the welcome-back card', () => {
  it('leads with the shards, says how long, and drops empty lines', () => {
    const c = welcomeCard(facts());
    expect(c.headline).toBe('+1.20K');
    expect(c.caption).toBe('Gathered in 3 h 12 min away · Night Watch holds 1 h at most');
    expect(c.lines).toEqual([]);
  });

  it('points at Night Watch only while the free tier is all there is', () => {
    expect(welcomeCard(facts()).hint).toMatch(/Night Watch \(in the Forge\)/);
    expect(welcomeCard(facts({ nightWatch: true, capHours: 4 })).hint).toBeNull();
  });

  it('no cap note under the cap', () => {
    expect(welcomeCard(facts({ away: 600 })).caption).toBe('Gathered in 10 min away');
  });

  it('one line each: Stored Light, Foreman, Now affordable, in that order', () => {
    const rates = BALANCE.offline.tiers[2].stored!;
    const c = welcomeCard(facts({
      nightWatch: true, capHours: 8, stored: 6000, pool: 10000, rates,
      bought: 'Bulwark, Quickdraw ×2', boughtCount: 3, held: 5000,
      fresh: ['A', 'B', 'C', 'D', 'E', 'F'],
    }));
    expect(c.lines.map((l) => l.label)).toEqual(['Stored Light', 'Foreman', 'Now affordable']);
    // 10000 / (100 × 4) = 25 min of played waves.
    expect(c.lines[0]).toMatchObject({ value: '+6.00K', note: 'Next ~25 min of play: ×5. Left alone: ×2.', stored: true });
    expect(c.lines[1]).toMatchObject({ value: '3 bought', note: 'Bulwark, Quickdraw ×2 · Next pin needs 5.00K: Stored Light holds it.' });
    expect(c.lines[2]).toMatchObject({ value: '6', note: 'A, B, C, D and 2 more' });
  });

  it('the Foreman line holds even when nothing was bought', () => {
    const c = welcomeCard(facts({ held: 900 }));
    expect(c.lines).toEqual([{ label: 'Foreman', value: 'Waiting', note: 'Next pin needs 900: Stored Light holds it.' }]);
  });

  it('how long a pool lasts, roughly', () => {
    expect(poolPlayText(10000, 100, 5)).toBe('~25 min');
    expect(poolPlayText(100, 100, 5)).toBe('~5 min');
    expect(poolPlayText(60000, 100, 5)).toBe('~2.5 h');
    expect(poolPlayText(10000, 0, 5)).toBeNull();
  });
});
