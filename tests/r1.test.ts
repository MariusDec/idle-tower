import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/content/balance';
import { EXPLAINERS } from '../src/content/explainers';
import { newProfile, PROFILE_VERSION, type Profile } from '../src/meta/profile';
import { AFTER_GATEKEEPER, hubUnlocks, runsPastFirst } from '../src/meta/collection';
import { trialsOpen } from '../src/meta/trials';
import { explainerOpen, markExplained } from '../src/meta/explainers';
import { draftSeconds, LONG_DRAFT_SECONDS, playerDraftSeconds, SHORT_DRAFT_SECONDS } from '../src/meta/automation';
import { hubGoal } from '../src/meta/goals';
import { bankRun } from '../src/meta/results';
import { buildRunConfig } from '../src/meta/runConfig';
import { createRun } from '../src/sim/run';
import { MIGRATIONS, migrate } from '../src/meta/save/migrate';
import { systemPace } from '../tools/pacing';

/** Past the Gatekeeper, with `runs` ended in Region 2. */
function pastGate(runs: number): Profile {
  const p = newProfile(0);
  p.records.runs = 10;
  p.bosses.gatekeeper = { kills: 1, fastest: 50 };
  if (runs > 0) p.regions['2'] = { bestWave: 12, runs };
  return p;
}

describe('R1 §2: the Gatekeeper’s unlocks, staggered', () => {
  it('its fall opens the Map; Feats wait for one run past it, Trials for two', () => {
    const fell = pastGate(0);
    expect(hubUnlocks(fell).map).toBe(true);
    expect(hubUnlocks(fell).feats).toBe(false);
    expect(trialsOpen(fell, 1)).toBe(false);
    const one = pastGate(AFTER_GATEKEEPER.feats);
    expect(hubUnlocks(one).feats).toBe(true);
    expect(trialsOpen(one, 1)).toBe(AFTER_GATEKEEPER.trials <= 1);
    const two = pastGate(AFTER_GATEKEEPER.trials);
    expect(trialsOpen(two, 1)).toBe(true);
    // Region 2's own Trials still wait on its boss.
    expect(trialsOpen(two, 2)).toBe(false);
  });

  it('counts runs past Region 1 only', () => {
    const p = pastGate(0);
    p.regions['1'] = { bestWave: 20, runs: 9 };
    expect(runsPastFirst(p)).toBe(0);
    p.regions['3'] = { bestWave: 4, runs: 1 };
    p.regions['2'] = { bestWave: 12 };
    expect(runsPastFirst(p)).toBe(1);
  });

  it('a banked run counts toward its region', () => {
    const p = pastGate(0);
    p.region = 2;
    bankRun(p, createRun(buildRunConfig(p), 1));
    expect(p.regions['2'].runs).toBe(1);
    expect(hubUnlocks(p).feats).toBe(true);
  });

  it('the Next goal names no feat before the Feats tab opens', () => {
    const p = pastGate(0);
    // The frontier boss down too, so the goal reaches past it.
    p.bosses['bog-mother'] = { kills: 1, fastest: 50 };
    p.bosses.prism = { kills: 1, fastest: 50 };
    p.bosses.forgeheart = { kills: 1, fastest: 50 };
    p.bosses['hollow-king'] = { kills: 1, fastest: 50 };
    p.bosses.blight = { kills: 1, fastest: 50 };
    expect(hubGoal(p)?.text ?? '').not.toMatch(/^Feat:/);
  });
});

describe('R1 §4: mid-run explainers', () => {
  const run = EXPLAINERS.filter((e) => e.view === 'run');

  it('are one sentence each, for the first rift, Champion and elite aura', () => {
    expect(run.map((e) => e.id).sort()).toEqual(['aura', 'champion', 'tear']);
    for (const e of run) {
      expect(e.lines).toHaveLength(1);
      expect(e.lines[0].match(/[.!?](\s|$)/g)?.length, e.id).toBe(1);
    }
  });

  it('open only once told, so the hub’s "?" never lists one unmet', () => {
    const p = newProfile(0);
    for (const e of run) expect(explainerOpen(p, e.id)).toBe(false);
    markExplained(p, ['tear']);
    expect(explainerOpen(p, 'tear')).toBe(true);
    expect(explainerOpen(p, 'champion')).toBe(false);
  });
});

describe('R1 §5: the draft timer', () => {
  it('On is the usual clock, Long twice it, Off none until the Tactician', () => {
    const p = newProfile(0);
    expect(p.settings.draftTimer).toBe('on');
    expect(playerDraftSeconds(p)).toBe(draftSeconds(p));
    p.settings.draftTimer = 'short';
    expect(playerDraftSeconds(p)).toBe(SHORT_DRAFT_SECONDS);
    expect(SHORT_DRAFT_SECONDS).toBe(5);
    p.settings.draftTimer = 'long';
    expect(playerDraftSeconds(p)).toBe(LONG_DRAFT_SECONDS);
    expect(LONG_DRAFT_SECONDS).toBe(BALANCE.draft.seconds * 2);
    p.settings.draftTimer = 'off';
    expect(playerDraftSeconds(p)).toBeNull();
    p.forge.tactician = 1;
    expect(playerDraftSeconds(p)).toBe(LONG_DRAFT_SECONDS);
  });

  it('never reaches the bots: draftSeconds ignores it', () => {
    const p = newProfile(0);
    const on = draftSeconds(p);
    p.settings.draftTimer = 'off';
    expect(draftSeconds(p)).toBe(on);
  });
});

describe('the save', () => {
  it('v25 → v26: the draft timer on, and old regions counted as played twice', () => {
    expect(PROFILE_VERSION).toBeGreaterThanOrEqual(26);
    const out = migrate({
      version: 25, createdAt: 5, shards: 50, settings: { speed: 2 }, regions: { 1: { bestWave: 20 }, 2: { bestWave: 9 } },
    }, MIGRATIONS, 26);
    expect(out.version).toBe(26);
    expect(out.settings).toEqual({ speed: 2, draftTimer: 'on' });
    expect(out.regions).toEqual({ 1: { bestWave: 20, runs: 2 }, 2: { bestWave: 9, runs: 2 } });
  });
});

describe('R1 §1: the systems reading', () => {
  const at = (t: number, system?: string) => ({ at: t, what: system ?? 'x', ...(system ? { system } : {}) });

  it('counts each system once, and the Gatekeeper’s fall may open two', () => {
    const pace = systemPace({
      reveals: [at(60, 'draft'), at(900, 'forge'), at(1800, 'map'), at(1800, 'relics'), at(1900, 'feats'), at(1950)],
      explainers: [at(1800, 'map'), at(2700, 'trials')],
      gateFall: 1800,
    });
    // 0–15 min: draft; 15–30: forge (at 15:00 exactly); 30–45: map, relics, feats; 45–60: trials.
    expect(pace.perQuarter.slice(0, 4)).toEqual([1, 1, 3, 1]);
    // forge→map 15 min, map+relics at the fall (free), relics→feats 100 s: one close, and crowded.
    expect(pace.close).toBe(1);
    expect(pace.crowded).toBe(1);
    expect(pace.pass).toBe(false);
  });
});
