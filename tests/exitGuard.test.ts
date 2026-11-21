import { describe, expect, it } from 'vitest';
import { exitGuard } from '../src/app/exitGuard';

describe('exitGuard', () => {
  const clock = (): { now: () => number; at: (t: number) => void } => {
    let t = 0;
    return { now: () => t, at: (v) => { t = v; } };
  };

  it('warns on the first press and leaves on a second inside the window', () => {
    const c = clock();
    const g = exitGuard(2000, c.now);
    expect(g.press()).toBe(false);
    c.at(1500);
    expect(g.press()).toBe(true);
  });

  it('warns again once the window has run out', () => {
    const c = clock();
    const g = exitGuard(2000, c.now);
    g.press();
    c.at(2500);
    expect(g.press()).toBe(false);
    c.at(3000);
    expect(g.press()).toBe(true);
  });

  it('forgets a pending press on reset', () => {
    const c = clock();
    const g = exitGuard(2000, c.now);
    g.press();
    g.reset();
    c.at(100);
    expect(g.press()).toBe(false);
  });

  it('starts over after leaving', () => {
    const c = clock();
    const g = exitGuard(2000, c.now);
    g.press();
    expect(g.press()).toBe(true);
    expect(g.press()).toBe(false);
  });
});
