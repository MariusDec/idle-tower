import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';

describe('Rng', () => {
  it('is reproducible from a seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 1000; i++) expect(a.nextU32()).toBe(b.nextU32());
  });

  it('differs between seeds', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    const same = Array.from({ length: 100 }, () => a.nextU32() === b.nextU32()).filter(Boolean);
    expect(same.length).toBeLessThan(3);
  });

  it('split streams are independent of draws on the parent', () => {
    const a = new Rng(7);
    const b = new Rng(7);
    for (let i = 0; i < 50; i++) b.next();
    expect(a.split('spawn').nextU32()).toBe(b.split('spawn').nextU32());
    expect(a.split('spawn').nextU32()).not.toBe(a.split('crit').nextU32());
  });

  it('resumes exactly from a copied state', () => {
    const a = new Rng(99);
    for (let i = 0; i < 10; i++) a.next();
    const b = new Rng(a.state);
    for (let i = 0; i < 100; i++) expect(b.nextU32()).toBe(a.nextU32());
  });

  it('stays in range', () => {
    const r = new Rng(3);
    for (let i = 0; i < 10_000; i++) {
      const x = r.next();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      const n = r.int(2, 5);
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(5);
    }
  });

  it('weighted picks follow the weights', () => {
    const r = new Rng(5);
    const counts = [0, 0, 0];
    for (let i = 0; i < 30_000; i++) counts[r.weighted([1, 2, 0])]++;
    expect(counts[2]).toBe(0);
    expect(counts[1] / counts[0]).toBeGreaterThan(1.8);
    expect(counts[1] / counts[0]).toBeLessThan(2.2);
  });
});

describe('Rng.wrap', () => {
  it('advances the state it wraps', () => {
    const owner = new Rng(11);
    const state = owner.state;
    const before = [...state.s];
    Rng.wrap(state).nextU32();
    expect(state.s).not.toEqual(before);
    const copy = new Rng(11);
    copy.nextU32();
    expect(owner.nextU32()).toBe(copy.nextU32());
  });
});
