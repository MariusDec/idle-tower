/**
 * R7 (`plans/review-risks.md`): text that fits, and a phone that stays
 * portrait (a tablet turns since plans/large-screens.md §10.1). The size sweep itself runs in a browser (360×640, 375×812,
 * 412×915 at 100% and 130%); this pins what it found, so a later edit to the
 * manifest or the stylesheet can't quietly undo it.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const MANIFEST = read('android/app/src/main/AndroidManifest.xml');
const CSS = read('src/styles/main.css').replace(/\/\*[\s\S]*?\*\//g, '');
const TOKENS = read('src/styles/tokens.css');
const ACTIVITY = read('android/app/src/main/java/com/mariusdonci/bluehour/MainActivity.java');

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

  it('locks a phone to portrait and frees a large screen (plans/large-screens.md §10.1)', () => {
    // The manifest leaves orientation to the activity: a fixed lock there would hold tablets too.
    expect(MANIFEST).not.toMatch(/android:screenOrientation=/);
    expect(ACTIVITY).toMatch(/LARGE_SCREEN_DP\s*=\s*600/);
    expect(ACTIVITY).toMatch(/smallestScreenWidthDp\s*<\s*LARGE_SCREEN_DP\s*\?\s*ActivityInfo\.SCREEN_ORIENTATION_PORTRAIT\s*:\s*ActivityInfo\.SCREEN_ORIENTATION_FULL_USER/);
    // Applied at start and again on a fold or unfold, which the activity handles itself.
    expect(ACTIVITY).toMatch(/onCreate[\s\S]*applyOrientation\(/);
    expect(ACTIVITY).toMatch(/onConfigurationChanged[\s\S]*applyOrientation\(newConfig\)/);
    expect(MANIFEST).toMatch(/android:configChanges="[^"]*\borientation\b[^"]*\bscreenSize\b[^"]*\bsmallestScreenSize\b/);
  });

  it('centres a phone-width stage on anything wider', () => {
    expect(TOKENS).toMatch(/--stage-max-width:\s*480px/);
    expect(rule('.stage')).toMatch(/max-width:\s*var\(--stage-max-width\)/);
    expect(rule('#app')).toMatch(/justify-content:\s*center/);
  });

  it('lifts the letterbox only on a large stage (plans/large-screens.md §4.1)', () => {
    expect(rule(":root[data-form='medium']")).toMatch(/--stage-max-width:\s*none/);
    expect(rule(":root[data-form='expanded']")).toMatch(/--stage-max-width:\s*none/);
    expect(CSS).not.toMatch(/:root\[data-form='compact'\][^{]*\{[^}]*--stage-max-width/);
    expect(TOKENS).toMatch(/--content-max:\s*640px/);
  });

  it('puts the Forge web in the arena region only on an expanded stage (plans/large-screens.md §7.2)', () => {
    const web = rule(":root[data-form='expanded'] .hub .forge-web");
    expect(web).toMatch(/right:\s*100%/);
    expect(web).toMatch(/width:\s*var\(--arena-w/);
    // The panel-only parts stay hidden on every other stage.
    expect(CSS).toMatch(/\.forge-empty,\s*\.forge-queue\s*\{\s*display:\s*none;\s*\}/);
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
