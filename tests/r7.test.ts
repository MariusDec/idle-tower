/**
 * R7 (`plans/review-risks.md`): text that fits, and a tablet that stays a
 * portrait phone. The size sweep itself runs in a browser (360×640, 375×812,
 * 412×915 at 100% and 130%); this pins what it found, so a later edit to the
 * manifest or the stylesheet can't quietly undo it.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const MANIFEST = read('android/app/src/main/AndroidManifest.xml');
const CSS = read('src/styles/main.css').replace(/\/\*[\s\S]*?\*\//g, '');
const TOKENS = read('src/styles/tokens.css');

/** Every declaration in the rules whose selector is exactly `sel`, joined. */
function rule(sel: string): string {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const found = [...CSS.matchAll(new RegExp(`(?:^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`, 'g'))].map((m) => m[1]);
  if (found.length === 0) throw new Error(`no rule for ${sel}`);
  return found.join('\n');
}

describe('R7: tablets and foldables', () => {
  it('declares a game, so Android 16 keeps the orientation lock on large screens', () => {
    expect(MANIFEST).toMatch(/<application[^>]*android:appCategory="game"/);
  });

  it('locks the activity to portrait', () => {
    expect(MANIFEST).toMatch(/<activity[^>]*android:screenOrientation="portrait"/);
  });

  it('centres a phone-width stage on anything wider', () => {
    expect(TOKENS).toMatch(/--stage-max-width:\s*480px/);
    expect(rule('.stage')).toMatch(/max-width:\s*var\(--stage-max-width\)/);
    expect(rule('#app')).toMatch(/justify-content:\s*center/);
  });
});

describe('R7: 130% text on a small phone', () => {
  it('lets the hub home scroll rather than slide under the dock', () => {
    expect(rule('.hub-home')).toMatch(/overflow-y:\s*auto/);
    expect(rule('.hub-home')).toMatch(/min-height:\s*0/);
  });

  it('caps a tab label at what its tab fits', () => {
    expect(rule('.hub-tab')).toMatch(/container-type:\s*inline-size/);
    expect(rule('.hub-tab-label')).toMatch(/font-size:\s*min\(var\(--fs-xs\),\s*\d+cqi\)/);
  });

  it('keeps a tall draft on the stage: anchored low, scrolling, its title first', () => {
    const draft = rule('.draft');
    expect(draft).toMatch(/justify-content:\s*safe flex-end/);
    expect(draft).toMatch(/overflow-y:\s*auto/);
  });

  it('sizes draft cards by their content, with today’s heights as the floor', () => {
    expect(rule('.draft-row .draft-card')).toMatch(/height:\s*auto/);
    expect(rule('.draft-row .draft-card')).toMatch(/min-height:\s*232px/);
    expect(rule('.draft-row.is-many .draft-card')).toMatch(/min-height:\s*196px/);
    expect(rule('.draft-row.is-many .draft-card')).not.toMatch(/(^|[^-])height:\s*196px/);
  });

  it('caps a card’s pills at the card’s width, never below their 100% size', () => {
    expect(rule('.draft-card')).toMatch(/container-type:\s*inline-size/);
    expect(rule('.draft-card :is(.draft-card-new, .draft-card-suggested, .draft-card-badge)'))
      .toMatch(/font-size:\s*max\(min\(var\(--fs-xs\),\s*[\d.]+cqi\),\s*min\(var\(--fs-xs\),\s*12px\)\)/);
  });
});
