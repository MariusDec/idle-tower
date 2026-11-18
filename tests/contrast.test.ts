import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LAST_LIGHT, REGIONS } from '../src/content/regions';
import { ABYSS_LAST_LIGHT } from '../src/content/abyss';
import { RUSH_LAST_LIGHT } from '../src/content/rush';
import { lastLightFor } from '../src/app/settings';

/**
 * plans/visual-identity.md §10.1. The identity's rule is that every text
 * colour reads at 4.5:1 on every stop of the ground it sits on. The Tower's
 * ground has a fourth stop that changes with the region (its last light), so
 * the rule has to hold for each region's value too: a region added with a
 * horizon too bright for the muted text fails here, not on a player's phone.
 */

const TOKENS = readFileSync(resolve(__dirname, '../src/styles/tokens.css'), 'utf8');
const MAIN = readFileSync(resolve(__dirname, '../src/styles/main.css'), 'utf8');

function token(name: string): string {
  const m = TOKENS.match(new RegExp(`${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`${name} missing from tokens.css`);
  return m[1].trim();
}

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const HEX = /^#[0-9a-f]{6}$/i;

const STOPS: Record<string, string> = {
  '--bg-stop-1': token('--bg-stop-1'),
  '--bg-stop-2': token('--bg-stop-2'),
  '--bg-stop-3': token('--bg-stop-3'),
  '--bg-last-light (default)': token('--bg-last-light'),
  ...Object.fromEntries(Object.entries(LAST_LIGHT).map(([id, c]) => [`last light: ${id}`, c])),
  'last light: the Abyss': ABYSS_LAST_LIGHT,
  'last light: Boss Rush': RUSH_LAST_LIGHT,
};

const TEXT = ['--text-primary', '--text-secondary', '--text-dim', '--text-muted', '--accent-text', '--fx-gold'];

describe('the ground', () => {
  it('names every stop as a plain hex, so this test can read it', () => {
    for (const [name, value] of Object.entries(STOPS)) expect(value, name).toMatch(HEX);
  });

  it('gives every region a last light', () => {
    for (const r of REGIONS) expect(LAST_LIGHT[r.id], r.id).toMatch(HEX);
  });

  it('resolves the hub and the run to the right horizon', () => {
    for (const r of REGIONS) expect(lastLightFor(r.index)).toBe(LAST_LIGHT[r.id]);
    expect(lastLightFor(7)).toBe(ABYSS_LAST_LIGHT);
    expect(lastLightFor(8)).toBe(RUSH_LAST_LIGHT);
    expect(lastLightFor(999)).toBe(token('--bg-last-light'));
  });
});

describe('text on the ground (≥ 4.5:1 on every stop)', () => {
  for (const name of TEXT) {
    it(`${name} reads on every stop`, () => {
      const fg = token(name);
      expect(fg).toMatch(HEX);
      for (const [stop, bg] of Object.entries(STOPS)) {
        expect(contrast(fg, bg), `${name} on ${stop}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
});

describe('the primary button', () => {
  const stops = [...token('--accent-gradient').matchAll(/#[0-9a-f]{6}/gi)].map((m) => m[0]);

  it('is a two-stop gradient', () => {
    expect(stops).toHaveLength(2);
  });

  it('carries a white label at ≥ 4.1:1 on both stops', () => {
    for (const s of stops) expect(contrast('#ffffff', s), `white on ${s}`).toBeGreaterThanOrEqual(4.1);
  });

  it('sets that label bold and at least 16px, which is what makes 4.1:1 enough', () => {
    const body = MAIN.match(/\n\.btn-primary\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(body).toMatch(/font-weight:\s*var\(--fw-bold\)/);
    const size = body.match(/font-size:\s*var\((--fs-[a-z0-9]+)\)/)?.[1];
    expect(size, '.btn-primary font-size').toBeDefined();
    const px = Number(token(size!).match(/(\d+)px/)?.[1]);
    expect(px).toBeGreaterThanOrEqual(16);
  });
});

describe('the type ramp', () => {
  it('has a 12px floor', () => {
    const sizes = [...TOKENS.matchAll(/--fs-[a-z0-9]+:\s*calc\((\d+)px/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(5);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(12);
  });
});
