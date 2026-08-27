import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAIN = readFileSync(resolve(__dirname, '../src/styles/main.css'), 'utf8');

/**
 * UI plan §9.C — touch hardening.
 *
 * Two rules, both easy to lose to a later refactor and both invisible on a
 * desktop where the whole suite otherwise runs:
 *
 *  1. the gesture guards (no pull-to-refresh, no long-press bubble, no
 *     scroll chaining out of a scroller) exist and `touch-action: none`
 *     stays on the canvas alone — on the app root it would kill panel
 *     scrolling;
 *  2. every control the plan's audit names clears the 44 px floor, either
 *     visually or through a transparent `::before` hit expander.
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

describe('§9.C gesture guards', () => {
  it('kills pull-to-refresh on the document and the app root', () => {
    const owns = RULES.some(x =>
      x.selector === 'html, body, #app' && /overscroll-behavior:\s*none/.test(x.body));
    expect(owns, 'html, body, #app { overscroll-behavior: none }').toBe(true);
  });

  it('suppresses the iOS callout and the tap highlight on the app root', () => {
    expect(declares('#app', /-webkit-touch-callout:\s*none/)).toBe(true);
    expect(declares('#app', /-webkit-tap-highlight-color:\s*transparent/)).toBe(true);
  });

  it('contains scroll chaining in every scroller that can reach the page', () => {
    for (const sel of ['.panel-content', '.mobile-sheet-body', '.modal-card']) {
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

describe('§9.C 44 px audit', () => {
  /**
   * Each entry is a selector fragment plus the axis (or axes) the plan's audit
   * cares about. A control that is naturally wide only needs the height floor.
   */
  const AUDIT: { sel: string; axes: ('min-width' | 'min-height')[] }[] = [
    { sel: '.rail-btn', axes: ['min-height'] },
    { sel: '.tab-btn', axes: ['min-height'] },
    { sel: '.eq-sort-btn', axes: ['min-height'] },
    { sel: '.btn-buy', axes: ['min-height'] },
    { sel: '.btn-research', axes: ['min-height'] },
    { sel: '.mobile-sheet-segmented-btn', axes: ['min-height'] },
    { sel: '.mobile-sheet-close', axes: ['min-width', 'min-height'] },
    { sel: '.talent-node', axes: ['min-width', 'min-height'] },
  ];

  for (const { sel, axes } of AUDIT) {
    for (const axis of axes) {
      it(`${sel} declares a 44px ${axis}`, () => {
        expect(declares(sel, new RegExp(`${axis}:\\s*44px`))).toBe(true);
      });
    }
  }

  it('expands the inventory Equip/Sell hit area rather than shrinking the card', () => {
    const r = RULES.find(x => x.selector === '.eq-inv-card-actions .btn::before');
    expect(r, 'hit expander').toBeTruthy();
    expect(r!.body).toMatch(/width:\s*max\(100%,\s*44px\)/);
    expect(r!.body).toMatch(/height:\s*max\(100%,\s*44px\)/);
    // A hit expander that paints is a regression; it must stay transparent.
    expect(r!.body).not.toMatch(/background:/);
  });
});

/**
 * UI plan §9.F — the Part 9 acceptance pass at 375x812 with a 47px top and a
 * 34px bottom inset. Each case below is a defect the acceptance run found by
 * measuring the live DOM; the assertions are the CSS shapes that fixed them,
 * so a later refactor cannot quietly put the notch back over the wave header.
 */
describe('§9.F acceptance regressions', () => {
  it('no `.hud` rule resets the top safe-area inset it shares with `.hud-root`', () => {
    // The header element carries both classes, so a `padding` shorthand in a
    // `.hud` rule outranks `.hud-root { padding-top: max(..., var(--safe-t)) }`
    // on source order. Every `.hud` rule that sets padding must restate it.
    const hudRules = RULES.filter(r => r.selector === '.hud' && /padding\s*:/.test(r.body));
    expect(hudRules.length).toBeGreaterThan(0);
    for (const r of hudRules) {
      expect(r.body, 'a .hud padding shorthand must restate the top inset')
        .toMatch(/padding-top:\s*max\([^)]*var\(--safe-t\)\)/);
    }
  });

  it('the bottom nav adds the gesture bar to its height instead of carving it out', () => {
    // A flat `height: var(--bottom-nav-height)` plus `padding-bottom:
    // var(--safe-b)` left the five buttons 25px tall at a 34px inset.
    const nav = RULES.find(r => r.selector === '#bottom-nav-root' && /height:/.test(r.body));
    expect(nav).toBeTruthy();
    expect(nav!.body).toMatch(/height:\s*calc\(var\(--bottom-nav-height\)\s*\+\s*var\(--safe-b\)\)/);
    expect(nav!.body).toMatch(/padding-bottom:\s*var\(--safe-b\)/);
  });

  it('the sheet body keeps its bottom inset against the active panel class', () => {
    // The sheet reuses one body element and the panel adds its own class to
    // it, so the rule has to outrank a panel `padding` shorthand.
    const body = RULES.find(r => /\.mobile-sheet-body$/.test(r.selector) && /padding:/.test(r.body));
    expect(body, 'sheet body padding rule').toBeTruthy();
    expect(body!.selector).toBe('.mobile-sheet > .mobile-sheet-body');
    expect(body!.body).toMatch(/padding:[^;]*var\(--safe-b\)/);
  });

  it('the milestone strip subtracts both insets from the free column', () => {
    const strip = RULES.find(r => r.selector === '.milestone-strip' && /max-height:/.test(r.body));
    expect(strip).toBeTruthy();
    expect(strip!.body).toMatch(/var\(--safe-t\)/);
    expect(strip!.body).toMatch(/var\(--safe-b\)/);
  });

  it('the modal card caps its width against the side insets', () => {
    const card = RULES.find(r => r.selector === '.modal-card' && /width:/.test(r.body));
    expect(card).toBeTruthy();
    expect(card!.body).toMatch(/var\(--safe-l\)/);
    expect(card!.body).toMatch(/var\(--safe-r\)/);
  });

  /** Controls the live 44px sweep caught, and the axis each one was short on. */
  const FLOORS: { sel: string; decl: RegExp }[] = [
    { sel: '.eq-sort-btn', decl: /min-width:\s*44px/ },
    { sel: '.btn-ascend', decl: /min-height:\s*44px/ },
    { sel: '.btn-transcend', decl: /min-height:\s*44px/ },
    { sel: '.transcend-target-input', decl: /min-height:\s*44px/ },
    { sel: '.btn-mute', decl: /min-height:\s*44px/ },
    { sel: '.settings-select', decl: /min-height:\s*44px/ },
    { sel: '.settings-volume-slider', decl: /height:\s*44px/ },
  ];
  for (const { sel, decl } of FLOORS) {
    it(`${sel} clears the 44px floor`, () => {
      expect(declares(sel, decl)).toBe(true);
    });
  }

  /** The two dense rows that buy the floor with a transparent expander. */
  for (const sel of ['.upgrade-amount-btn::before', '.btn-respec::before']) {
    it(`${sel} expands the hit area without painting`, () => {
      const r = RULES.find(x => x.selector === sel);
      expect(r, sel).toBeTruthy();
      expect(r!.body).toMatch(/width:\s*max\(100%,\s*44px\)/);
      expect(r!.body).toMatch(/height:\s*max\(100%,\s*44px\)/);
      expect(r!.body).not.toMatch(/background:/);
    });
  }
});
