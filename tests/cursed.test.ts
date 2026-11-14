import { describe, expect, it } from 'vitest';
import { ABYSS_INDEX } from '../src/content/abyss';
import { BALANCE } from '../src/content/balance';
import { BOSSES } from '../src/content/bosses';
import { CURSED_RELICS, curseLine, cursedTable } from '../src/content/cursed';
import { CONTENT } from '../src/content';
import { cursedRelics, lintContent } from '../src/content/lint';
import type { ContentEntry, RelicDef } from '../src/content/types';
import {
  cursedSlots, cursesWorn, equippedRelics, gainRelic, isBound, relicSlots, swapCursed, toggleCursed, toggleRelic, wornCursed,
} from '../src/meta/collection';
import { newProfile, type Profile } from '../src/meta/profile';
import { bankRun } from '../src/meta/results';
import { buildRunConfig } from '../src/meta/runConfig';
import { SIM_DT } from '../src/app/loop';
import { applyInput, createRun, step } from '../src/sim/run';
import type { RunState } from '../src/sim/state';
import { eliteReliquary, guardianReliquary } from '../src/sim/systems/reliquaries';
import { botInput, reliquaryInput } from '../tools/bot';
import { ACTIVE_INPUTS } from '../tools/play';
import { body } from './helpers/body';

/** Every Act 1 boss down: Act 2 is open. */
function act2Profile(): Profile {
  const p = newProfile(0);
  p.tutorial.firstDraft = true;
  for (const b of BOSSES) if (!b.abyss) p.bosses[b.id] = { kills: 1, fastest: 60 };
  return p;
}

function abyssProfile(): Profile {
  const p = act2Profile();
  p.region = ABYSS_INDEX;
  return p;
}

function abyssRun(p = abyssProfile(), seed = 1): RunState {
  return createRun(buildRunConfig(p), seed);
}

/** Step the sim `seconds` with no input. */
function wait(run: RunState, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / SIM_DT) && !run.outcome; i++) step(run, SIM_DT);
}

describe('content (plans/late-game/03 §4)', () => {
  it('ships Glass Crown first, from the Deepwarden, and passes the lint', () => {
    expect(CURSED_RELICS.map((r) => r.id)).toEqual(['glass-crown']);
    expect(cursedTable('gate')).toEqual({ elite: [], boss: { deepwarden: 'glass-crown' } });
    expect(cursedRelics(CONTENT as unknown as Record<string, readonly ContentEntry[]>)).toEqual([]);
    expect(lintContent(CONTENT as unknown as Record<string, readonly ContentEntry[]>)).toEqual([]);
  });

  it('draws "Curse:" as the ☾ glyph', () => {
    expect(curseLine(CURSED_RELICS[0])).toBe('☾ the tower never rises again.');
  });

  it('the lint names a long pair, a pct damage boon, a missing curse and a half-shipped stratum', () => {
    const base = CURSED_RELICS[0];
    const bad: RelicDef[] = [
      { ...base, id: 'glass-crown', text: 'one two three four five six seven eight nine ten eleven' },
      { ...base, id: 'pct-crown' as RelicDef['id'], source: { kind: 'cursed', stratum: 'inversion', boss: null }, effects: [{ kind: 'stat', mod: { key: 'damage', pct: 0.5 } }] },
      { ...base, id: 'no-curse' as RelicDef['id'], curse: undefined },
    ];
    const problems = cursedRelics({ relics: bad as unknown as ContentEntry[] }).map((x) => `${x.id}: ${x.problem}`);
    expect(problems.some((x) => x.startsWith('glass-crown: boon and curse are'))).toBe(true);
    expect(problems).toContain('pct-crown: a damage boon must be a mult, not a pct');
    expect(problems).toContain('no-curse: cursed source but no curse');
    expect(problems.some((x) => x.startsWith('inversion: stratum has 1 elite'))).toBe(true);
  });
});

describe('the cursed slot, ranks and binding (§3.3)', () => {
  it('a cursed relic is never worn by itself, and opens its own slot', () => {
    const p = act2Profile();
    expect(cursedSlots(p)).toBe(0);
    expect(gainRelic(p, 'glass-crown')).toBe(1);
    expect(p.equipped).toEqual([]);
    expect(p.cursedWorn).toEqual([]);
    expect(cursedSlots(p)).toBe(1);
    expect(toggleCursed(p, 'glass-crown')).toBe(true);
    expect(p.cursedWorn).toEqual(['glass-crown']);
    expect(toggleCursed(p, 'glass-crown')).toBe(true);
    expect(p.cursedWorn).toEqual([]);
  });

  it('takes an ordinary slot only once Bound, and never two at once', () => {
    const p = act2Profile();
    p.bosses.gatekeeper = { kills: 1, fastest: 60 };
    expect(relicSlots(p)).toBeGreaterThan(0);
    gainRelic(p, 'glass-crown');
    expect(toggleRelic(p, 'glass-crown')).toBe(false);
    p.bound['glass-crown'] = BALANCE.cursed.bindAt;
    expect(isBound(p, 'glass-crown')).toBe(true);
    expect(toggleRelic(p, 'glass-crown')).toBe(true);
    expect(equippedRelics(p).map((x) => x.relic.id)).toContain('glass-crown');
    expect(cursesWorn(p)).toBe(1);
    // Into the cursed slot, it leaves the ordinary one.
    expect(toggleCursed(p, 'glass-crown')).toBe(true);
    expect(p.equipped).not.toContain('glass-crown');
    expect(cursesWorn(p)).toBe(1);
  });

  it('wears only an owned cursed relic, one per cursed slot', () => {
    // maxWorn (3) can't be reached with one cursed relic shipped; it is tested once a stratum's four land.
    const p = act2Profile();
    expect(toggleCursed(p, 'glass-crown')).toBe(false);
    gainRelic(p, 'tallow-candle');
    expect(toggleCursed(p, 'tallow-candle')).toBe(false);
    gainRelic(p, 'glass-crown');
    expect(toggleCursed(p, 'glass-crown')).toBe(true);
    expect(p.cursedWorn).toHaveLength(cursedSlots(p));
  });

  it('swap needs a worn relic out and an owned cursed one in', () => {
    const p = act2Profile();
    gainRelic(p, 'glass-crown');
    expect(swapCursed(p, 'glass-crown', 'glass-crown')).toBe(false);
    expect(swapCursed(p, 'glass-crown', 'tallow-candle')).toBe(false);
  });

  it('duplicates rank the boon to III, then bind, then melt', () => {
    const p = abyssProfile();
    const bank = (): ReturnType<typeof bankRun> => {
      const run = abyssRun(p);
      run.relics.push('glass-crown');
      run.outcome = { kind: 'retreat', wave: 1, time: 1 };
      return bankRun(p, run);
    };
    expect(bank().relics[0].rank).toBe(1);
    expect(bank().relics[0].rank).toBe(2);
    expect(bank().relics[0].rank).toBe(3);
    for (let i = 1; i <= BALANCE.cursed.bindAt; i++) {
      const x = bank().relics[0];
      expect(x.rank).toBe(0);
      expect(x.bound).toBe(i);
    }
    expect(isBound(p, 'glass-crown')).toBe(true);
    const melted = bank().relics[0];
    expect(melted.bound).toBeUndefined();
    expect(melted.shards).toBeGreaterThan(0);
  });
});

describe('curses hold only in the Abyss (§3.2)', () => {
  it('Glass Crown multiplies damage and stops the rise, in the Abyss alone', () => {
    const p = abyssProfile();
    p.bosses.gatekeeper = { kills: 1, fastest: 60 };
    gainRelic(p, 'glass-crown');
    const bare = abyssRun(p);
    toggleCursed(p, 'glass-crown');
    const worn = abyssRun(p);
    expect(worn.stats.damageMult / bare.stats.damageMult).toBeCloseTo(BALANCE.cursed.glassCrown.mult);
    expect(worn.behaviours.unrisen).toBe(1);
    // Rank II adds perRank.
    gainRelic(p, 'glass-crown');
    expect(abyssRun(p).stats.damageMult / bare.stats.damageMult).toBeCloseTo(BALANCE.cursed.glassCrown.mult * BALANCE.cursed.glassCrown.perRank);
    // A region run never feels it.
    p.region = 1;
    expect(wornCursed(p)).toEqual([]);
    const region = createRun(buildRunConfig(p), 1);
    expect(region.behaviours.unrisen).toBeUndefined();
    expect(buildRunConfig(p).reliquaries).toBeNull();
  });

  it('the tower never rises again under Glass Crown', () => {
    const run = abyssRun();
    run.revives = 1;
    run.behaviours.unrisen = 1;
    run.tower.hp = 0;
    step(run, SIM_DT);
    expect(run.outcome?.kind).toBe('fell');
    const free = abyssRun();
    free.revives = 1;
    free.tower.hp = 0;
    step(free, SIM_DT);
    expect(free.outcome).toBeNull();
  });
});

describe('reliquaries (§3.4)', () => {
  it('the Deepwarden surely leaves Glass Crown while it is unowned, then at bossDrop', () => {
    const cfg = buildRunConfig(abyssProfile()).reliquaries!;
    expect(cfg.sure).toEqual(['deepwarden']);
    expect(cfg.first).toBe(true);
    const run = abyssRun();
    guardianReliquary(run, 'deepwarden', 10, 20);
    expect(run.reliquaries).toHaveLength(1);
    expect(run.reliquaries[0]).toMatchObject({ relic: 'glass-crown', x: 10, y: 20, until: BALANCE.cursed.firstClaimSeconds });
    // The Hunger has none until plan 08's Root.
    guardianReliquary(run, 'hunger', 0, 0);
    expect(run.reliquaries).toHaveLength(1);

    const p = abyssProfile();
    gainRelic(p, 'glass-crown');
    p.tutorial.firstReliquary = true;
    expect(buildRunConfig(p).reliquaries!.sure).toEqual([]);
    let drops = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const r = abyssRun(p, seed);
      guardianReliquary(r, 'deepwarden', 0, 0);
      drops += r.reliquaries.length;
      if (r.reliquaries.length) expect(r.reliquaries[0].until).toBe(BALANCE.cursed.claimSeconds);
    }
    expect(drops / 400).toBeGreaterThan(BALANCE.cursed.bossDrop - 0.08);
    expect(drops / 400).toBeLessThan(BALANCE.cursed.bossDrop + 0.08);
  });

  it('a claim inside the window banks it; a fade counts, and banks nothing', () => {
    const p = abyssProfile();
    const run = abyssRun(p);
    guardianReliquary(run, 'deepwarden', 0, 0);
    wait(run, 5);
    applyInput(run, { claim: run.reliquaries[0].id });
    expect(run.reliquaries).toEqual([]);
    expect(run.relics).toEqual(['glass-crown']);
    run.outcome = { kind: 'retreat', wave: run.wave, time: run.time };
    const s = bankRun(p, run);
    expect(s.relics).toEqual([{ id: 'glass-crown', rank: 1 }]);
    expect(s.reliquaries).toEqual({ claimed: 1, faded: 0 });
    expect(s.activeOnly.filter((a) => a.kind === 'reliquary')).toHaveLength(1);
    expect(p.tutorial.firstReliquary).toBe(true);
    expect(p.cursedWorn).toEqual([]);

    const q = abyssProfile();
    const late = abyssRun(q);
    guardianReliquary(late, 'deepwarden', 0, 0);
    const id = late.reliquaries[0].id;
    wait(late, BALANCE.cursed.firstClaimSeconds + 1);
    expect(late.reliquaries).toEqual([]);
    applyInput(late, { claim: id });
    expect(late.relics).toEqual([]);
    expect(late.reliquariesFaded).toBe(1);
    late.outcome = { kind: 'retreat', wave: late.wave, time: late.time };
    const t = bankRun(q, late);
    expect(t.reliquaries).toEqual({ claimed: 0, faded: 1 });
    expect(t.relics).toEqual([]);
  });

  it('a retreat fades every reliquary still waiting', () => {
    const run = abyssRun();
    guardianReliquary(run, 'deepwarden', 0, 0);
    applyInput(run, { retreat: true });
    expect(run.reliquaries).toEqual([]);
    expect(run.reliquariesFaded).toBe(1);
  });

  it('elites leave nothing cursed in the Gate', () => {
    const run = abyssRun();
    for (let i = 0; i < 200; i++) eliteReliquary(run, body(run, { elite: true }));
    expect(run.reliquaries).toEqual([]);
  });

  it('elites roll on the curse stream, luck and all, when a stratum has relics', () => {
    const run = abyssRun();
    run.reliquaryCfg = { ...run.reliquaryCfg!, elite: ['glass-crown'] };
    const loot = run.streams.loot;
    let n = 0;
    for (let i = 0; i < 2000; i++) {
      eliteReliquary(run, body(run, { elite: true }));
      n = run.reliquaries.length;
    }
    expect(run.streams.loot).toEqual(loot);
    expect(n / 2000).toBeGreaterThan(BALANCE.cursed.eliteDrop * 0.5);
    expect(n / 2000).toBeLessThan(BALANCE.cursed.eliteDrop * 1.6);
  });
});

describe('determinism and I9', () => {
  it('a run with no reliquary config plays exactly as one without the field', () => {
    const p = act2Profile();
    const config = buildRunConfig(p);
    const { reliquaries: _r, ...without } = config;
    const a = createRun(config, 9);
    const b = createRun(without, 9);
    wait(a, 30);
    wait(b, 30);
    expect(JSON.stringify({ ...a, events: [] })).toBe(JSON.stringify({ ...b, events: [] }));
  });

  it('the active bot claims what just dropped; bare never does; claim is an active input', () => {
    const run = abyssRun();
    guardianReliquary(run, 'deepwarden', 0, 0);
    expect(reliquaryInput(run, 1)).toBe(run.reliquaries[0].id);
    expect(reliquaryInput(run, 0)).toBeUndefined();
    expect(botInput(run, 'bare').claim).toBeUndefined();
    expect(ACTIVE_INPUTS).toContain('claim');
  });

  it('every curse runs three floors with no throw or NaN', () => {
    const p = abyssProfile();
    for (const r of CURSED_RELICS) {
      gainRelic(p, r.id);
      toggleCursed(p, r.id);
    }
    const run = abyssRun(p, 3);
    for (let i = 0; i < Math.round(240 / (SIM_DT * 3)) && !run.outcome; i++) {
      step(run, SIM_DT * 3, botInput(run, 'active'), 3);
      run.events.length = 0;
    }
    expect(Number.isFinite(run.tower.hp)).toBe(true);
    expect(Number.isFinite(run.shards)).toBe(true);
  });
});
