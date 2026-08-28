import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAIN = readFileSync(resolve(__dirname, '../src/styles/main.css'), 'utf8');

/**
 * One scrollbar treatment, applied through the bare pseudo-elements.
 *
 * The rule this file guards is a Chromium cascade trap rather than a style
 * preference: an element whose computed `scrollbar-width` is anything but
 * `auto` drops *every* `::-webkit-scrollbar` rule that would otherwise match
 * it and falls back to the browser default. So the standards half of the
 * treatment has to stay behind an `@supports` gate that Chromium fails and
 * Firefox passes — writing both unconditionally silently deletes the design.
 *
 * Measured before the gate went in: a scroller styled to a 14px custom bar
 * rendered a 0px overlay one as soon as a `* { scrollbar-width: thin }` rule
 * was live, and went back to 14px the moment that rule was deleted.
 */
describe('scrollbar treatment', () => {
  it('styles the bare pseudo-elements rather than a per-component list', () => {
    for (const pseudo of ['::-webkit-scrollbar', '::-webkit-scrollbar-track',
      '::-webkit-scrollbar-thumb', '::-webkit-scrollbar-thumb:hover']) {
      // Anchored to a line start so `.foo::-webkit-scrollbar` cannot satisfy it.
      expect(MAIN, pseudo).toMatch(new RegExp(`^${pseudo.replace(/[:()]/g, m => '\\' + m)}\\s*\\{`, 'm'));
    }
  });

  it('keeps every standards-property declaration inside the @supports gate', () => {
    const gate = MAIN.indexOf('@supports not selector(::-webkit-scrollbar)');
    expect(gate, 'the @supports gate must exist').toBeGreaterThan(-1);
    // The gate's own block, matched by its braces.
    const open = MAIN.indexOf('{', gate);
    let depth = 0;
    let end = open;
    for (let i = open; i < MAIN.length; i++) {
      if (MAIN[i] === '{') depth++;
      else if (MAIN[i] === '}' && --depth === 0) { end = i; break; }
    }
    const inside = MAIN.slice(open, end);
    expect(inside).toMatch(/scrollbar-width:\s*thin/);

    // Any `scrollbar-width` outside the gate must be an opt-out (`none`),
    // which suppresses the bar in both engines and so cannot strand a
    // component on the browser default.
    const outside = MAIN.slice(0, gate) + MAIN.slice(end);
    for (const m of outside.matchAll(/scrollbar-width:\s*([a-z]+)/g)) {
      expect(m[1], `scrollbar-width: ${m[1]} outside the @supports gate`).toBe('none');
    }
    expect(outside).not.toMatch(/scrollbar-color:/);
  });
});
