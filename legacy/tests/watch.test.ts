/**
 * The Long Watch — chapter campaign data (plan §8.1, items 1–9).
 *
 * The data block. Twelve chapters, twelve rewards, twenty-four relationships
 * that must all hold; this is what the manager block (Step 5) will run on top
 * of. Nothing here knows about `WatchManager` — the data is the contract.
 *
 * Modeled on `tests/contracts.test.ts` (imports at the top, vitest at the
 * bottom) and on the boss-pattern consumer guard in
 * `tests/content-coverage.test.ts` for the placeholder check.
 */

import { describe, expect, it } from 'vitest';
import {
  WATCH_CHAPTERS,
  WATCH_CHAPTER_BY_ID,
  WATCH_CHAPTER_COUNT,
  WATCH_UNLOCK_CONSUMERS,
  WATCH_UNLOCKS,
  describeGoal,
  goalAvailableFromWave,
  type WatchChapterDef,
  type WatchGoal,
  type WatchGoalKind,
  type WatchUnlockId,
} from '../src/data/watch';
import { ICON_IDS } from '../src/data/icons';
import { ENEMY_DEFS } from '../src/data/enemies';
import { WatchManager, type WatchMetrics } from '../src/systems/WatchManager';
import { MAX_RISK_CEILING } from '../src/data/pacing';
import { applyPersistedWatch } from '../src/systems/watchRestore';
import { SaveManager } from '../src/systems/SaveManager';
import type { GameState, WatchState } from '../src/types';

/** Every reward key, derived from the closed Record. */
const UNLOCK_IDS = Object.keys(WATCH_UNLOCKS) as WatchUnlockId[];

/**
 * Each chapter's depth gate is its `reach_wave` goal target. They are always
 * present and always the first goal — a chapter without one is broken in
 * several other ways first.
 */
const reachWaveOf = (ch: WatchChapterDef): number => {
  const g = ch.goals.find(g => g.kind === 'reach_wave');
  if (!g) throw new Error(`${ch.id} has no reach_wave goal`);
  return g.wave;
};

/**
 * One representative of every `WatchGoalKind`. Typed as `Record<WatchGoalKind,
 * WatchGoal>` so a kind added to the union without a key here fails
 * compilation. The values themselves are arbitrary — only the `describeGoal`
 * switch in `src/data/watch.ts` and this test care about the kind.
 */
const SYNTHETIC: Record<WatchGoalKind, WatchGoal> = {
  reach_wave: { kind: 'reach_wave', wave: 1 },
  kills: { kind: 'kills', count: 1 },
  kills_of: { kind: 'kills_of', type: 'normal', count: 1 },
  bosses: { kind: 'bosses', count: 1 },
  gold_earned: { kind: 'gold_earned', amount: 1 },
  ascensions: { kind: 'ascensions', count: 1 },
  transcendences: { kind: 'transcendences', count: 1 },
  abilities_cast: { kind: 'abilities_cast', count: 1 },
  upgrades_bought: { kind: 'upgrades_bought', count: 1 },
  tower_level: { kind: 'tower_level', level: 1 },
  blessing_picks: { kind: 'blessing_picks', count: 1 },
  contracts_done: { kind: 'contracts_done', count: 1 },
  flawless_waves: { kind: 'flawless_waves', count: 1 },
  swift_bosses: { kind: 'swift_bosses', count: 1 },
  risk_waves: { kind: 'risk_waves', risk: 1, count: 1 },
  mutator_waves: { kind: 'mutator_waves', count: 1 },
};

describe('the long watch: data', () => {
  // 1. Twenty-one chapters, number equal to index + 1, ids unique.
  it('has twenty-one chapters numbered by index with unique ids', () => {
    expect(WATCH_CHAPTERS).toHaveLength(21);
    expect(WATCH_CHAPTER_COUNT).toBe(21);
    WATCH_CHAPTERS.forEach((ch, i) => {
      expect(ch.number, `${ch.id} number`).toBe(i + 1);
    });
    const ids = WATCH_CHAPTERS.map(c => c.id);
    expect(new Set(ids).size, 'duplicate chapter id').toBe(ids.length);
    for (const id of ids) {
      expect(WATCH_CHAPTER_BY_ID[id], `${id} missing from chapter-by-id map`).toBeDefined();
    }
  });

  // 2. Every chapter has exactly three goals.
  it('every chapter has exactly three goals', () => {
    for (const ch of WATCH_CHAPTERS) {
      expect(ch.goals, `${ch.id} goal count`).toHaveLength(3);
    }
  });

  // 3. Non-empty flavour of at least 20 characters and no placeholder text.
  it('every chapter flavour is real prose, not a placeholder', () => {
    for (const ch of WATCH_CHAPTERS) {
      expect(ch.flavour, `${ch.id} flavour`).toBeTruthy();
      expect(ch.flavour.length, `${ch.id} flavour length`).toBeGreaterThanOrEqual(20);
      expect(ch.flavour.toLowerCase(), `${ch.id} flavour placeholder`)
        .not.toMatch(/todo|tbd|lorem/i);
    }
  });

  // 4. Every icon is in ICON_IDS; every color matches the hex regex.
  it('every icon is fetched and every color is a literal hex', () => {
    const ids = new Set<string>(ICON_IDS);
    expect(ids.size, 'ICON_IDS is empty').toBeGreaterThan(0);
    for (const ch of WATCH_CHAPTERS) {
      expect(ids.has(ch.icon), `${ch.id} icon ${ch.icon}`).toBe(true);
      expect(ch.color, `${ch.id} color`).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  // 5. Each WatchUnlockId is the reward of exactly one chapter.
  it('grants each of the twenty-one unlocks exactly once', () => {
    expect(UNLOCK_IDS).toHaveLength(21);
    const counts = new Map<WatchUnlockId, number>();
    for (const ch of WATCH_CHAPTERS) {
      counts.set(ch.reward, (counts.get(ch.reward) ?? 0) + 1);
    }
    for (const id of UNLOCK_IDS) {
      expect(counts.get(id), `${id} grant count`).toBe(1);
    }
    // And no chapter hands out a reward that isn't on the list.
    for (const ch of WATCH_CHAPTERS) {
      expect(UNLOCK_IDS, `${ch.id} reward ${ch.reward} not in WATCH_UNLOCKS`).toContain(ch.reward);
    }
  });

  // 6. WATCH_UNLOCK_CONSUMERS names a real consumer for every unlock.
  //    Mirrors the boss-pattern assertion in tests/content-coverage.test.ts.
  it('every unlock names a real consumer', () => {
    for (const id of UNLOCK_IDS) {
      const consumer = WATCH_UNLOCK_CONSUMERS[id];
      expect(consumer, `${id} has no consumer`).toBeTruthy();
      expect(consumer.length, `${id} consumer is too vague`).toBeGreaterThan(20);
      expect(consumer.toLowerCase(), `${id} consumer is a placeholder`)
        .not.toMatch(/todo|nothing|unused|n\/a|tbd/i);
    }
  });

  // 7a. describeGoal returns a non-empty string for every goal in the table.
  it('describeGoal covers every chapter goal', () => {
    for (const ch of WATCH_CHAPTERS) {
      for (const goal of ch.goals) {
        const text = describeGoal(goal);
        expect(text, `${ch.id} goal ${goal.kind}`).toBeTruthy();
        expect(text.length, `${ch.id} goal ${goal.kind}`).toBeGreaterThan(0);
      }
    }
  });

  // 7b. ...and for one synthetic goal of every kind in the union.
  //     SYNTHETIC is exhaustive; a kind added without a describeGoal case
  //     fails the compile of src/data/watch.ts first, and a kind added without
  //     a key here fails the compile of this Record.
  it('describeGoal covers every WatchGoalKind', () => {
    const kinds = Object.keys(SYNTHETIC) as WatchGoalKind[];
    expect(kinds.length).toBeGreaterThan(0);
    for (const kind of kinds) {
      const text = describeGoal(SYNTHETIC[kind]);
      expect(text, `${kind} description`).toBeTruthy();
      expect(text.length, `${kind} description`).toBeGreaterThan(0);
    }
  });

  // 8. Availability floor: every kills_of goal's subject unlocks strictly
  //    before the chapter's depth gate, via goalAvailableFromWave.
  it('every kills_of goal is available before the chapter asks for it', () => {
    const killsOf = WATCH_CHAPTERS.flatMap(ch =>
      ch.goals
        .filter((g): g is Extract<WatchGoal, { kind: 'kills_of' }> => g.kind === 'kills_of')
        .map(g => ({ chapter: ch, goal: g })),
    );
    expect(killsOf.length, 'expected at least one kills_of goal across the campaign').toBeGreaterThan(0);
    for (const { chapter, goal } of killsOf) {
      const floor = goalAvailableFromWave(goal);
      const target = reachWaveOf(chapter);
      expect(floor, `${chapter.id} asks for ${goal.type} at wave ${target} but it unlocks at ${floor}`)
        .toBeLessThan(target);
      // Belt-and-braces: goalAvailableFromWave must mirror ENEMY_DEFS here.
      expect(floor).toBe(ENEMY_DEFS[goal.type].unlockWave);
    }
  });

  // 9. Depth gates ascend strictly across chapters.
  it('reach_wave targets ascend strictly across chapters', () => {
    for (let i = 1; i < WATCH_CHAPTERS.length; i++) {
      const prev = reachWaveOf(WATCH_CHAPTERS[i - 1]);
      const curr = reachWaveOf(WATCH_CHAPTERS[i]);
      expect(curr, `chapter ${i + 1} (${WATCH_CHAPTERS[i].id}) target ${curr} not above chapter ${i} target ${prev}`)
        .toBeGreaterThan(prev);
    }
  });
});

/**
 * The manager block (plan §8.1, items 10–16).
 *
 * Drives the real `WatchManager` against a stub metrics object and a stub
 * bus, exactly the pattern `tests/contracts.test.ts` uses for the contract
 * manager. The harness inlines `defaultWatch().counters` because that factory
 * is private to `SaveManager`; the literal is kept in lockstep with it.
 */

function emptyCounters(): WatchState['counters'] {
  return {
    killsByType: {},
    flawlessWaves: 0,
    swiftBosses: 0,
    contractsDone: 0,
    blessingPicks: 0,
    mutatorWaves: 0,
    riskWaves: new Array(MAX_RISK_CEILING + 1).fill(0),
  };
}

function metrics(over: Partial<WatchMetrics> = {}): WatchMetrics {
  return {
    highestWave: 0,
    kills: 0,
    killsByType: {},
    bosses: 0,
    goldEarned: 0,
    ascensions: 0,
    transcendences: 0,
    abilitiesCast: 0,
    upgradesBought: 0,
    towerLevel: 0,
    blessingPicks: 0,
    contractsDone: 0,
    flawlessWaves: 0,
    swiftBosses: 0,
    riskWaves: new Array(MAX_RISK_CEILING + 1).fill(0),
    mutatorWaves: 0,
    ...over,
  };
}

/** Every field set high enough to clear any chapter's targets. */
function allGoalsMet(): WatchMetrics {
  return metrics({
    highestWave: 9999,
    kills: 1e12,
    killsByType: {
      normal: 1e12, fast: 1e12, tank: 1e12, flying: 1e12, healer: 1e12,
      boss: 1e12, splitter: 1e12, shielded: 1e12, siege: 1e12, thief: 1e12,
      blinker: 1e12, warden: 1e12, burrower: 1e12,
    },
    bosses: 1e12,
    goldEarned: 1e15,
    ascensions: 1e12,
    transcendences: 1e12,
    abilitiesCast: 1e12,
    upgradesBought: 1e12,
    towerLevel: 1e12,
    blessingPicks: 1e12,
    contractsDone: 1e12,
    flawlessWaves: 1e12,
    swiftBosses: 1e12,
    riskWaves: [0, 0, 0, 1e12, 1e12, 1e12, 1e12, 1e12],
    mutatorWaves: 1e12,
  });
}

function harness(state?: Partial<WatchState>) {
  const s: WatchState = { completed: [], counters: emptyCounters(), ...state };
  let m = metrics();
  const events: Array<{ e: string; p: any }> = [];
  const mgr = new WatchManager({
    bus: { emit: (e, p) => events.push({ e, p }) },
    state: () => s,
    metrics: () => m,
  });
  return {
    s,
    mgr,
    events,
    set: (next: Partial<WatchMetrics>) => { m = metrics(next); },
  };
}

describe('the long watch: manager', () => {
  // 10. Fresh state: active chapter is 1, no unlocks earned yet.
  it('starts on chapter 1 with no unlocks earned', () => {
    const h = harness();
    expect(h.mgr.activeChapter?.id).toBe('wc_first_watch');
    expect(h.mgr.activeChapter?.number).toBe(1);
    expect(h.mgr.completedCount).toBe(0);
    for (const id of UNLOCK_IDS) {
      expect(h.mgr.has(id), `${id} should not be earned yet`).toBe(false);
    }
  });

  // 11. Two of three objectives: no completion. The third: one chapter, one event, one unlock.
  it('completes nothing until every goal is met, then completes exactly one', () => {
    const h = harness();
    // Chapter 1 asks for reach_wave 15, kills 1500, flawless_waves 5.
    // Two of three met: reach_wave and kills, but not flawless.
    h.set({ highestWave: 15, kills: 1500, flawlessWaves: 4 });
    expect(h.mgr.check()).toBeNull();
    expect(h.events).toHaveLength(0);
    expect(h.mgr.has('board_expansion')).toBe(false);

    // Third goal now met.
    h.set({ highestWave: 15, kills: 1500, flawlessWaves: 5 });
    const completed = h.mgr.check();
    expect(completed).not.toBeNull();
    expect(completed?.id).toBe('wc_first_watch');
    expect(h.events).toHaveLength(1);
    expect(h.events[0].e).toBe('watch_chapter_completed');
    // Payload shape: id, number, name, unlockId, unlockName, description, icon, color, next.
    const p = h.events[0].p;
    expect(p.id).toBe('wc_first_watch');
    expect(p.number).toBe(1);
    expect(p.name).toBe('The First Watch');
    expect(p.unlockId).toBe('board_expansion');
    expect(p.unlockName).toBeTruthy();
    expect(p.unlockDescription).toBeTruthy();
    expect(p.icon).toBe('lantern-flame');
    expect(p.color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(p.next).toBe('Blood and Iron');
    expect(h.mgr.has('board_expansion')).toBe(true);
  });

  // 12. Cascade rule: one check() per chapter; twenty-first clears the table; twenty-second is a no-op.
  it('completes at most one chapter per check, twenty-one checks for all twenty-one', () => {
    const h = harness();
    h.set(allGoalsMet());
    for (let i = 0; i < 21; i++) {
      const chapter = h.mgr.check();
      expect(chapter, `check ${i + 1} should return a chapter`).not.toBeNull();
      expect(chapter?.number, `check ${i + 1} number`).toBe(i + 1);
    }
    expect(h.events).toHaveLength(21);
    expect(h.mgr.activeChapter).toBeNull();
    // Twenty-second call returns null and emits nothing new.
    const before = h.events.length;
    expect(h.mgr.check()).toBeNull();
    expect(h.events.length).toBe(before);
  });

  // 13. tick(dt) cadence: nothing before 1s, at most one chapter per call after.
  it('tick waits for one second of accumulated dt, then completes at most one', () => {
    const h = harness();
    // Metrics satisfy every chapter, so the "at most one per call" rule is
    // the only thing stopping tick from running through the whole table.
    h.set(allGoalsMet());

    // Half a second: no poll, no completion.
    h.mgr.tick(0.5);
    expect(h.events).toHaveLength(0);

    // Another 0.6s (cumulative 1.1s >= 1s): one poll, one completion.
    h.mgr.tick(0.6);
    expect(h.events).toHaveLength(1);
    expect(h.events[0].p.id).toBe('wc_first_watch');

    // Five seconds more: the cascade rule still binds — only one more
    // chapter can land per call, even with every goal already met.
    h.mgr.tick(5.0);
    expect(h.events).toHaveLength(2);
    expect(h.events[1].p.id).toBe('wc_blood_and_iron');
  });

  // 14. progress() clamps to target; fill() stays in [0, 1] for absurd metrics.
  it('clamps progress to the target and fill to [0, 1] for absurd metrics', () => {
    const h = harness();
    // Chapter 1's `kills` goal: count 1500.
    const killsGoal = WATCH_CHAPTERS[0].goals.find(g => g.kind === 'kills')!;

    h.set({ kills: 1e12 });
    expect(h.mgr.progress(killsGoal)).toBe(1500);
    expect(h.mgr.fill(killsGoal)).toBe(1);

    h.set({ kills: 0 });
    expect(h.mgr.progress(killsGoal)).toBe(0);
    expect(h.mgr.fill(killsGoal)).toBe(0);
  });

  // 15. risk_waves sums every bucket at or above the asked step — not just
  //     the asked step. [9,9,9,9,0,7,0,0] with risk: 3 reads 9+0+7+0+0 = 16,
  //     not 9. The plan's example used `count: 10`; the test uses `count: 20`
  //     so progress()'s clamp-to-target does not mask the raw sum.
  it('risk_waves sums every bucket at or above the asked step', () => {
    const h = harness();
    const goal: WatchGoal = { kind: 'risk_waves', risk: 3, count: 20 };
    h.set({ riskWaves: [9, 9, 9, 9, 0, 7, 0, 0] });
    expect(h.mgr.progress(goal)).toBe(16);
  });

  // 16. rebuildUnlocks() reconstructs the unlock set from the completed list,
  //     and silently ignores ids that don't name a chapter.
  it('rebuildUnlocks() grants exactly the listed chapters rewards, ignoring unknown ids', () => {
    const h = harness({
      completed: ['wc_first_watch', 'wc_blood_and_iron', 'wc_does_not_exist'],
    });
    h.mgr.rebuildUnlocks();
    expect(h.mgr.has('board_expansion')).toBe(true);
    expect(h.mgr.has('quartermaster')).toBe(true);
    // No later chapter is granted.
    expect(h.mgr.has('veteran_start')).toBe(false);
    expect(h.mgr.has('wide_draft')).toBe(false);
    expect(h.mgr.has('long_memory')).toBe(false);

    // earnedUnlocks() returns the same two, in insertion order.
    expect(h.mgr.earnedUnlocks()).toEqual(['board_expansion', 'quartermaster']);

    // Unknown id was dropped on the floor rather than thrown.
    expect(() => h.mgr.rebuildUnlocks()).not.toThrow();
  });
});

/**
 * Persistence (plan §1.1, test §9.1).
 *
 * The Long Watch is permanent — neither ascend nor transcend touches it, and
 * it is saved — but until §1.1 the saved block was never restored, so every
 * load silently wiped the campaign. The fix is `applyPersistedWatch` (see
 * `src/systems/watchRestore.ts`), called from `Game.applyPersistedState`
 * immediately before `applyWatchUnlocksOnLoad()`. This block round-trips a
 * non-trivial `WatchState` through the real save pipeline — `SaveManager.snapshot`
 * → JSON.parse(JSON.stringify(...)) → the restore helper — and asserts the
 * campaign comes back equal, which is the regression the whole of §1.1 exists
 * to prevent.
 */
describe('the long watch: persistence', () => {
  it('round-trips a populated WatchState through SaveManager and the restore helper', () => {
    const original: WatchState = {
      completed: ['wc_first_watch', 'wc_blood_and_iron'],
      counters: {
        killsByType: { normal: 1234, boss: 17, thief: 9 },
        flawlessWaves: 42,
        swiftBosses: 7,
        contractsDone: 88,
        blessingPicks: 55,
        mutatorWaves: 12,
        // One bucket above the current ceiling to prove the restore clamps
        // rather than carrying an extra slot forward.
        riskWaves: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      },
    };

    const save = new SaveManager({ on: () => {} });
    // Minimal stub GameState — every field `SaveManager.snapshot` reads must
    // exist with the shape it expects. Mirrors the round-trip stub used by
    // `tests/cores.test.ts` (see "survives a full save round trip"). Only
    // `watch` carries meaningful content.
    const stubState = {
      tower: {}, resources: {}, upgrades: {}, research: {}, abilities: {},
      prestige: { apSpent: {}, tpSpent: {}, automationFlags: {}, autoCastEnabled: {} },
      wave: {}, stats: {}, achievements: [], runHistory: [], runStartedAt: 0,
      towerXp: {}, talents: { allocated: {} }, passiveAbilities: {},
      equipment: [], equipped: {},
      watch: original,
    } as unknown as GameState;
    const persisted = save.snapshot(stubState);
    const roundTripped = JSON.parse(JSON.stringify(persisted)) as { watch: WatchState };

    const live: WatchState = {
      completed: [],
      counters: {
        killsByType: { tank: 999 },        // pre-existing entry that the restore must clear.
        flawlessWaves: 0,
        swiftBosses: 0,
        contractsDone: 0,
        blessingPicks: 0,
        mutatorWaves: 0,
        riskWaves: new Array(MAX_RISK_CEILING + 1).fill(0),
      },
    };

    applyPersistedWatch(live, roundTripped.watch);

    // Completed list — exact order, exact content.
    expect(live.completed).toEqual(original.completed);

    // killsByType — restored types equal original; the pre-existing `tank`
    // entry on the live object must be gone after the clear-then-repopulate.
    expect(live.counters.killsByType).toEqual(original.counters.killsByType);

    // All five numeric scalars.
    expect(live.counters.flawlessWaves).toBe(original.counters.flawlessWaves);
    expect(live.counters.swiftBosses).toBe(original.counters.swiftBosses);
    expect(live.counters.contractsDone).toBe(original.counters.contractsDone);
    expect(live.counters.blessingPicks).toBe(original.counters.blessingPicks);
    expect(live.counters.mutatorWaves).toBe(original.counters.mutatorWaves);

    // riskWaves — exactly MAX_RISK_CEILING + 1 slots, populated from the
    // saved array's prefix; bucket 8 (saved value 9) is dropped because the
    // live ceiling is MAX_RISK_CEILING.
    expect(live.counters.riskWaves).toHaveLength(MAX_RISK_CEILING + 1);
    expect(live.counters.riskWaves).toEqual(
      original.counters.riskWaves.slice(0, MAX_RISK_CEILING + 1),
    );
  });

  it('is a no-op when persisted.watch is absent', () => {
    const live: WatchState = {
      completed: ['wc_first_watch'],
      counters: {
        killsByType: { normal: 5 },
        flawlessWaves: 3,
        swiftBosses: 1,
        contractsDone: 2,
        blessingPicks: 4,
        mutatorWaves: 0,
        riskWaves: new Array(MAX_RISK_CEILING + 1).fill(0),
      },
    };

    const before = JSON.parse(JSON.stringify(live));
    applyPersistedWatch(live, undefined);
    expect(live).toEqual(before);
  });
});

describe('gates land where the ladder is (progress.md §7.6)', () => {
  /**
   * The ladder's measured tower level by depth, from `plans/progress.md` §1.7.
   * A chapter whose level gate sits above the level its own depth gate implies
   * is a chapter that cannot be finished when it is offered — which is what
   * chapter 19 was, by a factor of fifty.
   */
  const LEVEL_AT_DEPTH: ReadonlyArray<[wave: number, level: number]> = [
    // The [175, 40] anchor is progress-steps §7.1a's own pairing — chapter 11
    // asks for level 40 at wave 175, and the run-indexed anchors either side of
    // it (run 1 at wave 40, run 3 at wave 249) are too coarse to price a gate
    // that falls between them.
    [40, 10], [175, 40], [249, 39], [339, 61], [357, 74], [500, 86], [560, 90],
  ];

  function levelAtDepth(wave: number): number {
    let best = LEVEL_AT_DEPTH[0][1];
    for (const [w, lv] of LEVEL_AT_DEPTH) if (wave >= w) best = lv;
    return best;
  }

  it('never asks for a tower level the chapter\'s own depth cannot reach', () => {
    for (const ch of WATCH_CHAPTERS) {
      const depth = ch.goals.find(o => o.kind === 'reach_wave');
      const level = ch.goals.find(o => o.kind === 'tower_level');
      if (!depth || !level || depth.kind !== 'reach_wave' || level.kind !== 'tower_level') continue;
      expect(level.level, `${ch.id} (wave ${depth.wave})`)
        .toBeLessThanOrEqual(levelAtDepth(depth.wave));
    }
  });

  it('keeps every depth gate ascending', () => {
    let previous = 0;
    for (const ch of WATCH_CHAPTERS) {
      const depth = ch.goals.find(o => o.kind === 'reach_wave');
      if (!depth || depth.kind !== 'reach_wave') continue;
      expect(depth.wave, ch.id).toBeGreaterThan(previous);
      previous = depth.wave;
    }
  });
});
