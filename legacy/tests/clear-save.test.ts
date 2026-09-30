/**
 * `Game.clearSave` must reset every slice of `GameState`.
 *
 * A wipe that forgets a field leaves the old value in place, and the symptom
 * is invisible: the player sees wave 1 and no gold, while the Watch campaign,
 * the contract board or the risk dial quietly carry over from the save they
 * just deleted. `Game` cannot be constructed headlessly (canvas, DOM, audio),
 * so this guards the invariant at the source level instead: every key
 * `makeInitialState` returns has to be mentioned inside `clearSave`.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const GAME = readFileSync(resolve(__dirname, '../src/game/Game.ts'), 'utf8');

/** Body of a top-level `function name(` / method `name(` block, brace-matched. */
function blockAfter(marker: string): string {
  const start = GAME.indexOf(marker);
  expect(start, `missing ${marker}`).toBeGreaterThan(-1);
  let depth = 0;
  let i = GAME.indexOf('{', start);
  const from = i;
  for (; i < GAME.length; i++) {
    if (GAME[i] === '{') depth++;
    else if (GAME[i] === '}' && --depth === 0) return GAME.slice(from, i + 1);
  }
  throw new Error(`unterminated block for ${marker}`);
}

const INITIAL = blockAfter('function makeInitialState(): GameState {');
const CLEAR = blockAfter('  clearSave(): void {');

/**
 * Keys of the object literal `makeInitialState` returns — top level only, so
 * the brace depth is tracked and nested literals are skipped.
 */
function returnedKeys(): string[] {
  const ret = INITIAL.slice(INITIAL.lastIndexOf('return {'));
  const keys: string[] = [];
  let depth = 0;
  for (const line of ret.split('\n')) {
    const trimmed = line.trim();
    if (depth === 1) {
      const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(trimmed);
      if (m) keys.push(m[1]);
    }
    for (const ch of line) {
      if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') depth--;
    }
  }
  return keys;
}

describe('clearSave covers the whole state', () => {
  const keys = returnedKeys();

  it('parses the initial-state shape', () => {
    // Sanity: if the parse breaks, the coverage assertion below passes vacuously.
    expect(keys.length).toBeGreaterThan(20);
    expect(keys).toContain('watch');
    expect(keys).toContain('contracts');
    expect(keys).toContain('pacing');
  });

  // `enemies` / `projectiles` are vestigial fields on `GameState` — nothing
  // reads or persists them; the live lists belong to their managers, which
  // `clearSave` resets. `timestamp` is stamped by the save write itself, and
  // `runStartedAt` is owned by `resetRunBaselines`, asserted separately below.
  const INDIRECT = new Set(['timestamp', 'enemies', 'projectiles', 'runStartedAt']);

  it.each(keys.filter(k => !INDIRECT.has(k)))('resets %s', (key) => {
    expect(CLEAR).toContain(key);
  });

  it('restarts the run clock', () => {
    expect(CLEAR).toContain('this.resetRunBaselines()');
  });

  it('revokes the Watch unlocks it just wiped', () => {
    // The unlock set is derived from `watch.completed`, so replacing the
    // campaign block is only half of it.
    expect(CLEAR).toContain('watchMgr.rebuildUnlocks()');
    expect(CLEAR.indexOf('this.state.watch = fresh.watch'))
      .toBeLessThan(CLEAR.indexOf('coreMgr.resetAll()'));
  });
});
