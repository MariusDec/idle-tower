/**
 * The quality table (UI plan §5.F + §9.D).
 *
 * `tsc` covers the `QualityTier` union; this file pins the *numeric*
 * monotonicity the §9.D table promises: a drop from high to medium to low is
 * always a reduction on every axis except `additive` (which only ever turns
 * off, never on) and `bgLayers` (which only ever loses layers).
 *
 * Anything that reads a value from this table is purely presentational —
 * `tests/effects.test.ts` guards the shockwave invariant separately.
 */
import { describe, expect, it } from 'vitest';
import { QUALITY, isQualityTier, type QualityTier } from '../src/data/quality';

const TIERS: QualityTier[] = ['high', 'medium', 'low'];

describe('the quality table (UI plan §5.F + §9.D)', () => {
  it('declares a profile for every tier', () => {
    for (const tier of TIERS) {
      expect(QUALITY[tier], tier).toBeTruthy();
    }
  });

  it('drops particleScale monotonically as the tier falls', () => {
    expect(QUALITY.high.particleScale).toBeGreaterThan(QUALITY.medium.particleScale);
    expect(QUALITY.medium.particleScale).toBeGreaterThan(QUALITY.low.particleScale);
  });

  it('drops maxParticles monotonically as the tier falls', () => {
    expect(QUALITY.high.maxParticles).toBeGreaterThan(QUALITY.medium.maxParticles);
    expect(QUALITY.medium.maxParticles).toBeGreaterThan(QUALITY.low.maxParticles);
  });

  it('drops decals monotonically, all the way to zero at low', () => {
    expect(QUALITY.high.decals).toBeGreaterThan(QUALITY.medium.decals);
    expect(QUALITY.medium.decals).toBeGreaterThan(QUALITY.low.decals);
    expect(QUALITY.low.decals).toBe(0);
  });

  it('drops embers monotonically, all the way to zero at low', () => {
    expect(QUALITY.high.embers).toBeGreaterThan(QUALITY.medium.embers);
    expect(QUALITY.medium.embers).toBeGreaterThan(QUALITY.low.embers);
    expect(QUALITY.low.embers).toBe(0);
  });

  it('drops dprCap monotonically, with high matching the historic arena cap', () => {
    expect(QUALITY.high.dprCap).toBeGreaterThan(QUALITY.medium.dprCap);
    expect(QUALITY.medium.dprCap).toBeGreaterThan(QUALITY.low.dprCap);
    expect(QUALITY.low.dprCap).toBe(1);
  });

  it('never turns the additive pass back on as the tier drops', () => {
    // The §5.A additive pass is the single biggest fill-rate cost in the
    // renderer. Once `low` has dropped it, no other tier may bring it back.
    if (!QUALITY.high.additive) throw new Error('high should be additive');
    if (!QUALITY.medium.additive) throw new Error('medium should be additive');
    expect(QUALITY.low.additive).toBe(false);
  });

  it('never grows bgLayers as the tier drops', () => {
    expect(QUALITY.high.bgLayers).toBeGreaterThanOrEqual(QUALITY.medium.bgLayers);
    expect(QUALITY.medium.bgLayers).toBeGreaterThanOrEqual(QUALITY.low.bgLayers);
    expect(QUALITY.low.bgLayers).toBe(2);
  });

  it('never turns shadows back on as the tier drops', () => {
    if (!QUALITY.high.shadows) throw new Error('high should have shadows');
    if (!QUALITY.medium.shadows) throw new Error('medium should have shadows');
    expect(QUALITY.low.shadows).toBe(false);
  });

  it('isQualityTier is a tight typeguard over the union', () => {
    expect(isQualityTier('high')).toBe(true);
    expect(isQualityTier('medium')).toBe(true);
    expect(isQualityTier('low')).toBe(true);
    expect(isQualityTier('auto')).toBe(false);
    expect(isQualityTier(null)).toBe(false);
    expect(isQualityTier(undefined)).toBe(false);
    expect(isQualityTier(0)).toBe(false);
    expect(isQualityTier({})).toBe(false);
  });
});
