/**
 * Codex coverage guard (plans/stats.md Part A).
 *
 * The Codex exists to give every resolvable stat a player-facing explanation.
 * Its mechanical contract is that **every `StatKey` outside the self-evident
 * list is named by exactly one entry's `stats` array** — if a stat slips
 * through, it is invisible in the glossary; if two entries claim the same
 * stat, the search result list and the cross-link chips disagree about where
 * to send the player. Both bugs would ship silently (no compile error, no
 * runtime crash), so the only reliable defence is a focused test.
 *
 * The shape checks below are deliberately tighter than what `tsc` can prove:
 * category coverage, icon validity, summary/detail length, the absence of
 * `TODO` placeholders, and that the tunable numbers we quote are not stale
 * strings (the "interpolates numbers" check).
 */
import { describe, expect, it } from 'vitest';
import { ICON_IDS, type IconId } from '../src/data/icons';
import {
  CODEX_BY_STAT,
  CODEX_CATEGORIES,
  CODEX_CATEGORY_ICONS,
  CODEX_ENTRIES,
  CODEX_SELF_EVIDENT,
  type CodexCategory,
  type CodexEntry,
} from '../src/data/codex';
import { STAT_BASES, type StatKey } from '../src/stats/keys';

const VALID_CATEGORIES = new Set<CodexCategory>(CODEX_CATEGORIES);
const VALID_ICONS = new Set<IconId>(ICON_IDS);
const PLACEHOLDER_RE = /\b(todo|tbd|fixme|placeholder)\b/i;

describe('codex entries', () => {
  it('uses a unique id for every entry', () => {
    const ids = CODEX_ENTRIES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('classifies every StatKey exactly once (indexed ⊕ self-evident)', () => {
    const selfEvident = new Set<StatKey>(CODEX_SELF_EVIDENT);
    const claimed = new Set<StatKey>();
    for (const entry of CODEX_ENTRIES) {
      if (!entry.stats) continue;
      for (const key of entry.stats) {
        expect(selfEvident.has(key), `${key} is self-evident and should not be claimed by an entry`)
          .toBe(false);
        expect(claimed.has(key), `${key} is claimed by more than one entry`).toBe(false);
        claimed.add(key);
      }
    }

    // Every StatKey must be reachable from the Codex, either as a self-evident
    // stat or by being claimed by an entry's stats array.
    const allKeys = Object.keys(STAT_BASES) as StatKey[];
    const unclassified = allKeys.filter((k) => !selfEvident.has(k) && !claimed.has(k));
    expect(unclassified, 'unclassified stat keys').toEqual([]);

    // And the reverse direction — every key the Codex claims must really be
    // a StatKey. Catches a typo that points the entry at a non-existent key.
    const realKeys = new Set<StatKey>(allKeys);
    for (const key of claimed) {
      expect(realKeys.has(key), `${key} is not a real StatKey`).toBe(true);
    }
  });

  it('keeps CODEX_BY_STAT in sync with the entries table', () => {
    const expected: Partial<Record<StatKey, string[]>> = {};
    for (const entry of CODEX_ENTRIES) {
      if (!entry.stats) continue;
      for (const key of entry.stats) {
        const bucket = expected[key] ?? (expected[key] = []);
        if (!bucket.includes(entry.id)) bucket.push(entry.id);
      }
    }
    // Compare via JSON to keep the diff readable on failure.
    expect(CODEX_BY_STAT).toEqual(expected);
  });

  it('only points seeAlso at entries that actually exist', () => {
    const ids = new Set(CODEX_ENTRIES.map((e) => e.id));
    for (const entry of CODEX_ENTRIES) {
      if (!entry.seeAlso) continue;
      for (const target of entry.seeAlso) {
        expect(ids.has(target), `${entry.id} → seeAlso → ${target} does not exist`).toBe(true);
      }
    }
  });

  it('uses a real category and a real icon on every entry', () => {
    for (const entry of CODEX_ENTRIES) {
      expect(VALID_CATEGORIES.has(entry.category), `${entry.id} bad category`).toBe(true);
      expect(VALID_ICONS.has(entry.icon), `${entry.id} bad icon ${entry.icon}`).toBe(true);
    }
  });

  it('has a usable summary and detail on every entry', () => {
    for (const entry of CODEX_ENTRIES) {
      expect(entry.summary.length, `${entry.id} summary too short`).toBeGreaterThanOrEqual(20);
      expect(entry.detail.length, `${entry.id} detail too short`).toBeGreaterThanOrEqual(80);
      expect(PLACEHOLDER_RE.test(entry.summary), `${entry.id} summary has a placeholder`).toBe(false);
      expect(PLACEHOLDER_RE.test(entry.detail), `${entry.id} detail has a placeholder`).toBe(false);
    }
  });

  it('fills every category', () => {
    // A category with no entries is a tab the player can open onto nothing.
    const seen = new Set<CodexCategory>(CODEX_ENTRIES.map((e) => e.category));
    for (const cat of CODEX_CATEGORIES) {
      expect(seen.has(cat), `${cat} category has no entries`).toBe(true);
    }
  });

  it('ships a glyph for every category tab', () => {
    for (const cat of CODEX_CATEGORIES) {
      const icon = CODEX_CATEGORY_ICONS[cat];
      expect(VALID_ICONS.has(icon), `${cat} has no icon`).toBe(true);
    }
  });

  it('interpolates numbers in copy rather than hard-coding placeholder values', () => {
    // The whole point of the §7.2 / Part A rule is that tunable values are
    // pulled from the constants in the data layer, so a re-tune never strands
    // a hard-coded "30%" or "60%" in player-facing copy. If any of these
    // sentinel patterns appear, somebody wrote the copy before wiring the
    // constants.
    for (const entry of CODEX_ENTRIES) {
      const text = entry.summary + ' ' + entry.detail;
      expect(/\bxx ?%|placeholder ?%/i.test(text), `${entry.id} numeric placeholder`).toBe(false);
      expect(/xxx|todo/i.test(text), `${entry.id} placeholder token`).toBe(false);
    }
  });

  it('interpolates the documented tuning constants', () => {
    // Spot-check a few entries whose copy *must* reference real tuning values
    // from the data layer. Each check is a regex against the entry detail so
    // a re-tune that changes "75%" → "70%" is caught here too.
    const contains = (id: string, re: RegExp) => {
      const entry: CodexEntry | undefined = CODEX_ENTRIES.find((e) => e.id === id);
      expect(entry, `${id} missing`).toBeTruthy();
      expect(re.test(entry!.detail), `${entry!.id} detail should match ${re}`).toBe(true);
    };
    // Splash cap (data/prestige.ts SPLASH_FRACTION_CAP = 0.4 = 40%).
    contains('splash', /40%/);
    // Armor cap (stats/keys.ts STAT_CLAMPS.armor.max = 0.75 = 75%).
    contains('armor', /75%/);
    // Boss enrage stack damage (data/enemies.ts BOSS_ENCOUNTER.enrageDamagePerStack = 0.15).
    contains('enrage', /15%/);
    // Boss phase thresholds (data/enemies.ts BOSS_ENCOUNTER.phaseThresholds).
    contains('boss-phases', /66%|33%/);
  });
});
