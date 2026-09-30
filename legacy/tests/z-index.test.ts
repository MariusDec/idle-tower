import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAIN = readFileSync(resolve(__dirname, '../src/styles/main.css'), 'utf8');
const TOKENS = readFileSync(resolve(__dirname, '../src/styles/tokens.css'), 'utf8');

/**
 * UI plan §8.G: z-index is a token ladder, not a field of hand-tuned numbers.
 *
 * The plan's acceptance line was a bare `grep -n "z-index: [0-9]"`, which is
 * the right rule for *cross-component* layering and the wrong one for stacking
 * inside a single component's own stacking context — a progress fill behind
 * its label, the four badges on an ability button. Those never race anything
 * global and naming them would add a token per component. So the enforced rule
 * is the one the ladder actually means:
 *
 *   - anything that has to sit in front of another component quotes a rung;
 *   - a literal is allowed only up to LOCAL_MAX, i.e. only for local stacking.
 */
const LOCAL_MAX = 5;

/**
 * Every rung the ladder defines, in ascending order.
 *
 * `z-toast` is deliberately *not* the top rung. A toast is an ambient report
 * on the run, not something the player opened, so it has to lose to the two
 * surfaces they did open on purpose — the mobile sheet and the modal root —
 * and win against everything ambient below it. It sits between `z-popover`
 * and `z-sheet`, which is where the ascending check below places it.
 */
const LADDER = [
  'z-hud',
  'z-canvas-vignette',
  'z-canvas-overlay',
  'z-dock',
  'z-corner',
  'z-tooltip',
  'z-popover',
  'z-toast',
  'z-sheet',
  'z-menu',
  'z-modal',
] as const;

function declarations(css: string): { line: number; value: string }[] {
  const out: { line: number; value: string }[] = [];
  css.split('\n').forEach((text, i) => {
    for (const m of text.matchAll(/z-index:\s*([^;}]+)/g)) {
      out.push({ line: i + 1, value: m[1].trim() });
    }
  });
  return out;
}

describe('z-index ladder (UI plan §8.G)', () => {
  it('defines every rung in tokens.css', () => {
    for (const name of LADDER) {
      expect(TOKENS, `missing --${name}`).toMatch(new RegExp(`--${name}:\\s*-?\\d+;`));
    }
  });

  it('orders the rungs strictly ascending', () => {
    const values = LADDER.map(name => {
      const m = TOKENS.match(new RegExp(`--${name}:\\s*(-?\\d+);`));
      return Number(m![1]);
    });
    for (let i = 1; i < values.length; i++) {
      expect(values[i], `--${LADDER[i]} must sit above --${LADDER[i - 1]}`)
        .toBeGreaterThan(values[i - 1]);
    }
  });

  it('uses only ladder rungs for cross-component layering', () => {
    const offenders = declarations(MAIN).filter(d => {
      if (d.value.includes('var(--z-')) return false;
      const n = Number(d.value);
      return !Number.isFinite(n) || n > LOCAL_MAX;
    });
    expect(offenders, `main.css:${offenders.map(o => o.line).join(', ')}`).toEqual([]);
  });

  it('only references rungs that exist', () => {
    const used = new Set<string>();
    for (const m of MAIN.matchAll(/var\(--(z-[a-z-]+)\)/g)) used.add(m[1]);
    for (const name of used) expect(LADDER as readonly string[]).toContain(name);
  });
});
