import { afterEach, describe, expect, it } from 'vitest';
import { BALANCE } from '../src/content/balance';
import { ABYSS_INDEX } from '../src/content/abyss';
import { EVOLUTION_OF } from '../src/content/evolutions';
import { FRAMES } from '../src/content/frames';
import { FUSIONS } from '../src/content/fusions';
import { forms as formsRule } from '../src/content/lint';
import type { FrameDef, WeaponId } from '../src/content/types';
import { featMet } from '../src/meta/feats';
import { newProfile, PROFILE_VERSION } from '../src/meta/profile';
import { recordForm } from '../src/meta/results';
import { buildRunConfig } from '../src/meta/runConfig';
import { migrate, MIGRATIONS } from '../src/meta/save/migrate';
import { createRun } from '../src/sim/run';
import type { RunConfig, RunState } from '../src/sim/state';
import { newWeapon } from '../src/sim/systems/arms';
import { applyCard, refreshStats } from '../src/sim/systems/draft';
import { formNeed } from '../src/sim/systems/form';
import { regionAt, regionMods } from '../src/sim/systems/waves';

/**
 * Final Form (plans/late-game/07): evolve two weapons in one run and the
 * tower takes its frame's form until the run ends. A latch, an event, a
 * record in the Collection; cosmetic while `ultCharge` is 0.
 */

/** A run with Alchemy and room for `weapons` weapons and four passives. */
function config(weapons = 3, passives = 4): RunConfig {
  const p = newProfile(0);
  p.tutorial.firstDraft = true;
  const base = buildRunConfig(p);
  return { ...base, weaponSlots: weapons, passiveSlots: passives, behaviours: { ...base.behaviours, alchemy: 1 } };
}

/** A run carrying `ids` at level 5, each partner at 5, ready to evolve. */
function ready(ids: readonly WeaponId[], cfg = config()): RunState {
  const run = createRun(cfg, 1);
  run.weapons = ids.map((id) => newWeapon(id, 5));
  run.passives = ids.map((id) => ({ id: EVOLUTION_OF[id].passive, level: 5 }));
  run.wave = 12;
  return run;
}

const evolve = (run: RunState, id: WeaponId): void => applyCard(run, { kind: 'evolution', id: EVOLUTION_OF[id].id });
const forms = (run: RunState): number => run.events.filter((e) => e.kind === 'finalForm').length;

/** Two weapons a fusion joins, for test 2. */
const FUSED = FUSIONS[0].weapons;

const F = BALANCE.finalForm as { ultCharge: number };
const ULT = F.ultCharge;
afterEach(() => {
  F.ultCharge = ULT;
});

describe('the latch (§3.1)', () => {
  it('two evolution cards send exactly one finalForm and set the wave', () => {
    const run = ready(['arcane-bolt', 'frost-ring']);
    expect(run.form).toEqual({ need: 2, wave: null });
    evolve(run, 'arcane-bolt');
    expect(forms(run)).toBe(0);
    expect(run.form.wave).toBeNull();
    evolve(run, 'frost-ring');
    expect(forms(run)).toBe(1);
    expect(run.form.wave).toBe(12);
    expect(run.events.find((e) => e.kind === 'finalForm')).toEqual({ kind: 'finalForm', frame: run.frameId });
  });

  it('a third evolution, or a fusion, sends none', () => {
    const [a, b] = FUSED;
    const third = (['arcane-bolt', 'frost-ring', 'mortar'] as WeaponId[]).find((w) => w !== a && w !== b)!;
    const run = ready([a, b, third]);
    run.fusions = [FUSIONS[0].id];
    evolve(run, a);
    evolve(run, b);
    expect(forms(run)).toBe(1);
    run.wave = 15;
    evolve(run, third);
    applyCard(run, { kind: 'fusion', id: FUSIONS[0].id });
    expect(run.fused).toEqual([FUSIONS[0].id]);
    expect(forms(run)).toBe(1);
    expect(run.form.wave).toBe(12);
  });

  it('an anomaly counts as one of the two (plan 04 §7)', () => {
    const run = ready(['arcane-bolt', 'frost-ring']);
    run.anomaly = { held: true, delay: 0, offered: 'whiteout', taken: null };
    evolve(run, 'arcane-bolt');
    applyCard(run, { kind: 'anomaly', id: 'whiteout' });
    expect(forms(run)).toBe(1);
  });
});

describe('need (§3.2)', () => {
  it('is 0 with no Alchemy, a one-slot Trial or a no-passive Trial, and 2 for an Artificer', () => {
    expect(formNeed({ weaponSlots: 3, passiveSlots: 4, behaviours: {} })).toBe(0);
    expect(formNeed({ weaponSlots: 1, passiveSlots: 4, behaviours: { alchemy: 1 } })).toBe(0);
    expect(formNeed({ weaponSlots: 3, passiveSlots: 0, behaviours: { alchemy: 1 } })).toBe(0);
    expect(formNeed({ weaponSlots: 5, passiveSlots: 3, behaviours: { alchemy: 1 } })).toBe(2);
    const p = newProfile(0);
    expect(createRun(buildRunConfig(p), 1).form.need).toBe(0);
  });

  it('with need 0 nothing latches', () => {
    const run = ready(['arcane-bolt', 'frost-ring'], config(1, 4));
    run.weapons.push(newWeapon('frost-ring', 5));
    evolve(run, 'arcane-bolt');
    evolve(run, 'frost-ring');
    expect(forms(run)).toBe(0);
    expect(run.form.wave).toBeNull();
  });
});

describe('the effect (§3.3)', () => {
  it('with ultCharge 0, the stats are the same with Final Form as without', () => {
    const formed = ready(['arcane-bolt', 'frost-ring']);
    const plain = ready(['arcane-bolt', 'frost-ring']);
    plain.form.need = 0;
    for (const r of [formed, plain]) {
      evolve(r, 'arcane-bolt');
      evolve(r, 'frost-ring');
    }
    expect(formed.form.wave).not.toBeNull();
    expect(JSON.stringify(formed.stats)).toBe(JSON.stringify(plain.stats));
    expect(formed.mods).toEqual(plain.mods);
  });

  it('with ultCharge above 0, the mod survives an Abyss floor change', () => {
    F.ultCharge = 0.25;
    const run = ready(['arcane-bolt', 'frost-ring']);
    const before = run.stats.ultChargeMult;
    evolve(run, 'arcane-bolt');
    evolve(run, 'frost-ring');
    expect(run.stats.ultChargeMult).toBeCloseTo(before * 1.25);
    // An Abyss floor rebuilds `mods` from `outerMods` (waves.ts#enterFloor).
    run.mods = [...run.outerMods, ...regionMods(regionAt(ABYSS_INDEX, 10))];
    refreshStats(run);
    expect(run.stats.ultChargeMult).toBeGreaterThan(before);
  });
});

describe('banking (§5.1)', () => {
  const formedRun = (wave: number): RunState => {
    const run = ready(['arcane-bolt', 'frost-ring']);
    run.wave = wave;
    evolve(run, 'arcane-bolt');
    evolve(run, 'frost-ring');
    return run;
  };

  it('first per frame, a record only on an earlier region wave, Boss Rush and the Abyss add to the count only', () => {
    const p = newProfile(0);
    const frame = formedRun(18).frameId;
    expect(recordForm(p, formedRun(18), false)).toEqual({ wave: 18, first: true, record: false });
    expect(p.forms[frame]).toEqual({ wave: 18, count: 1 });
    expect(recordForm(p, formedRun(19), false)).toEqual({ wave: 19, first: false, record: false });
    expect(recordForm(p, formedRun(15), false)).toEqual({ wave: 15, first: false, record: true });
    expect(p.forms[frame]).toEqual({ wave: 15, count: 3 });
    // Boss Rush: an earlier wave, but it sets no record.
    expect(recordForm(p, formedRun(3), true)).toEqual({ wave: 3, first: false, record: false });
    expect(p.forms[frame]).toEqual({ wave: 15, count: 4 });
    expect(recordForm(p, ready(['arcane-bolt']), false)).toBeNull();
  });

  it('a frame reached only past the regions keeps no wave', () => {
    const p = newProfile(0);
    recordForm(p, formedRun(30), true);
    expect(p.forms[formedRun(1).frameId]).toEqual({ wave: null, count: 1 });
  });

  it('the feats read the forms', () => {
    const p = newProfile(0);
    expect(featMet(p, { kind: 'finalForm' }, null)).toBe(false);
    p.forms.arcanist = { wave: 20, count: 1 };
    expect(featMet(p, { kind: 'finalForm' }, null)).toBe(true);
    expect(featMet(p, { kind: 'forms', n: 6 }, null)).toBe(false);
    for (const f of FRAMES) p.forms[f.id] = { wave: null, count: 1 };
    expect(featMet(p, { kind: 'forms', n: 6 }, null)).toBe(true);
  });
});

describe('saves (§5.4)', () => {
  it('migrates v20 to v21 with no forms', () => {
    const out = migrate({ version: 20, createdAt: 5, shards: 50 }, MIGRATIONS, 21);
    expect(out.version).toBe(21);
    expect(out.forms).toEqual({});
    expect(PROFILE_VERSION).toBeGreaterThanOrEqual(21);
    expect(newProfile(0).forms).toEqual({});
  });
});

describe('content (§4)', () => {
  it('every frame has a form, and lint rejects a 16-word form text', () => {
    expect(formsRule({ frames: FRAMES })).toEqual([]);
    const long: FrameDef = { ...FRAMES[0], form: { name: 'Astral Spire', text: 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen' } };
    const problems = formsRule({ frames: [long] }).map((i) => i.problem);
    expect(problems.some((x) => x.startsWith('form text is 16 words'))).toBe(true);
    const wordy: FrameDef = { ...FRAMES[0], form: { name: 'A Very Long Name', text: 'Short.' } };
    expect(formsRule({ frames: [wordy] }).some((i) => i.problem.startsWith('form name'))).toBe(true);
  });
});
