import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  FX, INK, RARITY, fxVar, inkVar, lighten, mix, rarityVar, toRgb, withAlpha,
} from '../src/data/palette';

/**
 * `src/data/palette.ts` and `src/styles/tokens.css` both declare the effect and
 * rarity colours: the canvas cannot read a CSS custom property cheaply, and the
 * stylesheet must not need the bundle to have run before it can paint. That is a
 * deliberate duplication (see the note at the top of `palette.ts`) and this file
 * is the thing that makes it safe — drift is a failing test, not a bug report
 * from someone noticing that two greens look slightly different.
 */

const TOKENS = readFileSync(resolve(__dirname, '../src/styles/tokens.css'), 'utf8');

/** Every `--name: value;` declaration in tokens.css, last one wins. */
function declarations(): Map<string, string> {
  const out = new Map<string, string>();
  for (const [, name, value] of TOKENS.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    out.set(name, value.trim());
  }
  return out;
}

/** Every `--fx-*` / `--rarity-*` name declared in tokens.css. */
function declaredNames(prefix: string): string[] {
  return [...declarations().keys()].filter(n => n.startsWith(prefix));
}

describe('palette ↔ tokens.css', () => {
  const decls = declarations();

  it('declares every --fx-* colour with the value palette.ts exports', () => {
    for (const [name, hex] of Object.entries(FX)) {
      const token = fxVar(name as keyof typeof FX);
      expect(decls.get(token), `${token} missing from tokens.css`).toBeDefined();
      expect(decls.get(token)!.toLowerCase(), `${token} disagrees with palette.ts`).toBe(
        hex.toLowerCase(),
      );
    }
  });

  it('declares every --rarity-* colour with the value palette.ts exports', () => {
    for (const [tier, hex] of Object.entries(RARITY)) {
      const token = rarityVar(tier as keyof typeof RARITY);
      expect(decls.get(token), `${token} missing from tokens.css`).toBeDefined();
      expect(decls.get(token)!.toLowerCase(), `${token} disagrees with palette.ts`).toBe(
        hex.toLowerCase(),
      );
    }
  });

  it('declares every --ink-* step with the value palette.ts exports', () => {
    // The canvas paints rock, not surfaces, so Part 3's ground and masonry read
    // the primitive ramp directly. Same duplication, same guard.
    for (const [step, hex] of Object.entries(INK)) {
      const token = inkVar(step as keyof typeof INK);
      expect(decls.get(token), `${token} missing from tokens.css`).toBeDefined();
      expect(decls.get(token)!.toLowerCase(), `${token} disagrees with palette.ts`).toBe(
        hex.toLowerCase(),
      );
    }
  });

  it('has no --ink-* token that palette.ts does not know about', () => {
    const inkNames = Object.keys(INK).map(s => inkVar(s as keyof typeof INK));
    expect(declaredNames('--ink-').sort()).toEqual(inkNames.sort());
  });

  it('has no --fx-* or --rarity-* token that palette.ts does not know about', () => {
    const fxNames = Object.keys(FX).map(n => fxVar(n as keyof typeof FX));
    const rarityNames = Object.keys(RARITY).map(t => rarityVar(t as keyof typeof RARITY));
    expect(declaredNames('--fx-').sort()).toEqual(fxNames.sort());
    expect(declaredNames('--rarity-').sort()).toEqual(rarityNames.sort());
  });

  it('keeps the --rgb-* triplets in step with their --fx-* colour', () => {
    for (const [name, hex] of Object.entries(FX)) {
      const triplet = decls.get(`--rgb-${name}`);
      if (!triplet) continue; // not every fx colour needs a triplet
      const { r, g, b } = toRgb(hex);
      expect(triplet.replace(/\s+/g, ''), `--rgb-${name} disagrees with --fx-${name}`).toBe(
        `${r},${g},${b}`,
      );
    }
  });

  it('reserves red for the battlefield: --bad is not the enemy red', () => {
    // Art direction §2.1: hostile red belongs to enemies and damage. A generic
    // "you cannot afford this" or "this button deletes your save" must not
    // borrow it, or the two most urgent signals in the game read the same.
    const bad = decls.get('--bad');
    expect(bad).toBeDefined();
    expect(bad).not.toBe(FX.blood);
    expect(bad).not.toBe(FX.critical);
    expect(FX.critical).not.toBe(FX.blood);
  });
});

describe('palette helpers', () => {
  it('expands #rgb and #rrggbb alike', () => {
    expect(toRgb('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(toRgb('#f0b23c')).toEqual({ r: 240, g: 178, b: 60 });
    expect(toRgb('000000')).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('rejects anything that is not a hex colour', () => {
    expect(() => toRgb('rebeccapurple')).toThrow();
    expect(() => toRgb('#12345')).toThrow();
  });

  it('builds a canvas-ready rgba() string', () => {
    expect(withAlpha(FX.blood, 0.5)).toBe('rgba(217, 83, 79, 0.5)');
  });

  it('interpolates linearly and clamps t to [0, 1]', () => {
    expect(mix('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mix('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mix('#000000', '#ffffff', -3)).toBe('#000000');
    expect(mix('#000000', '#ffffff', 3)).toBe('#ffffff');
  });

  it('lightens toward the top of the ink ramp', () => {
    expect(lighten(FX.ember, 0)).toBe(FX.ember.toLowerCase());
    expect(lighten(FX.ember, 1)).toBe(INK['050'].toLowerCase());
    expect(lighten(FX.ember, 0.5)).toBe(mix(FX.ember, INK['050'], 0.5));
  });
});
