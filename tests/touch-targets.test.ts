import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAIN = readFileSync(resolve(__dirname, '../src/styles/main.css'), 'utf8');

/**
 * Touch hardening, carried over from the legacy suite (D4: portrait mobile first).
 *
 * Two rules, both easy to lose to a later refactor and both invisible on a
 * desktop where the whole suite otherwise runs:
 *
 *  1. the gesture guards (no pull-to-refresh, no long-press bubble, no
 *     scroll chaining out of a scroller) exist and `touch-action: none`
 *     stays on the canvas alone — on the app root it would kill scrolling;
 *  2. every control clears the 44 px floor.
 */

interface Rule {
  selector: string;
  body: string;
}

/** Flat rule list, at-rule bodies included (media blocks count as ordinary rules). */
function rules(css: string): Rule[] {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Rule[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    const selector = m[1].trim().replace(/\s+/g, ' ');
    if (selector.startsWith('@')) continue;
    out.push({ selector, body: m[2] });
  }
  return out;
}

const RULES = rules(MAIN);

function declares(selectorPart: string, decl: RegExp): boolean {
  return RULES.some(r => r.selector.includes(selectorPart) && decl.test(r.body));
}

describe('gesture guards', () => {
  it('kills pull-to-refresh on the document and the app root', () => {
    const owns = RULES.some(x =>
      x.selector === 'html, body, #app' && /overscroll-behavior:\s*none/.test(x.body));
    expect(owns, 'html, body, #app { overscroll-behavior: none }').toBe(true);
  });

  it('suppresses the iOS callout and the tap highlight on the app root', () => {
    expect(declares('#app', /-webkit-touch-callout:\s*none/)).toBe(true);
    expect(declares('#app', /-webkit-tap-highlight-color:\s*transparent/)).toBe(true);
  });

  it('contains scroll chaining in every scroller', () => {
    for (const sel of ['.modal-card']) {
      expect(declares(sel, /overscroll-behavior:\s*contain/), sel).toBe(true);
    }
  });

  it('keeps `touch-action: none` on the canvas and nowhere else', () => {
    const owners = RULES
      .filter(r => /touch-action:\s*none/.test(r.body))
      .map(r => r.selector);
    expect(owners).toEqual(['#game-canvas']);
  });
});

describe('44 px floor', () => {
  const AUDIT: { sel: string; axes: ('min-width' | 'min-height')[] }[] = [
    { sel: '.btn', axes: ['min-width', 'min-height'] },
    { sel: '.hud-pause', axes: ['min-width', 'min-height'] },
    { sel: '.hud-ult', axes: ['min-width', 'min-height'] },
    { sel: '.draft-card', axes: ['min-width', 'min-height'] },
  ];

  for (const { sel, axes } of AUDIT) {
    for (const axis of axes) {
      it(`${sel} declares a 44px ${axis}`, () => {
        expect(declares(sel, new RegExp(`${axis}:\\s*44px`))).toBe(true);
      });
    }
  }

  it('the modal card caps its width against the side insets', () => {
    const card = RULES.find(r => r.selector === '.modal-card' && /width:/.test(r.body));
    expect(card).toBeTruthy();
    expect(card!.body).toMatch(/var\(--safe-l\)/);
    expect(card!.body).toMatch(/var\(--safe-r\)/);
  });

  it('the HUD clears the top safe-area inset', () => {
    expect(declares('.hud', /padding:\s*max\(var\(--space-\d\),\s*var\(--safe-t\)\)/)).toBe(true);
  });
});
