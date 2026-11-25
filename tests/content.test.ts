import { describe, expect, it } from 'vitest';
import { CONTENT } from '../src/content';
import { lintContent, regionChain } from '../src/content/lint';
import { REGIONS, WAKE_FINALE } from '../src/content/regions';
import type { BossDef, ContentEntry, EvolutionDef, RegionDef, WeaponDef } from '../src/content/types';

describe('content lint (§12.6)', () => {
  it('the shipped content is clean', () => {
    expect(lintContent(CONTENT)).toEqual([]);
  });

  it("the regions' chain (plans/late-game/12 §8.1): one head, Region 1; no shared `after`; no cycle; a veil on each Wake region", () => {
    const six = REGIONS.filter((r) => r.act === 1);
    const wake = (index: number, after: number | null, veil?: string): RegionDef => ({ ...six[5], id: `wake-${index}`, index, act: 2, after, boss: WAKE_FINALE, ...(veil !== undefined ? { veil } : {}) });
    const lint = (regions: readonly RegionDef[]): string[] => regionChain({ regions }).map((i) => i.problem);
    expect(lint(REGIONS)).toEqual([]);
    expect(lint([...six, wake(9, 6, 'The bells still ring.'), wake(10, 9, 'A sky of wheels.')])).toEqual([]);
    expect(lint([...six, wake(9, 6)])).toContain('veil is 0 words (want 1–15)');
    expect(lint([...six, wake(9, 6, 'Bells.'), wake(10, 6, 'Wheels.')])).toContain('shares its `after` (6) with wake-9');
    expect(lint([...six, wake(9, 42, 'Bells.')])).toContain('opens after Region 42, which does not exist');
    expect(lint([...six, wake(9, 10, 'Bells.'), wake(10, 9, 'Wheels.')])).toContain('its chain does not lead back to Region 1');
    expect(lint([...six, wake(9, null, 'Bells.')]).some((p) => p.startsWith('want exactly one region with no'))).toBe(true);
    expect(lint([{ ...six[0], after: null }, { ...six[1], act: 1, after: 9 }, wake(9, 1, 'Bells.')])).toContain('opens after Region 9, of a later act');
    // The Wake's chain ends on its finale, whose fall opens the Abyss.
    expect(lint([...six, { ...wake(9, 6, 'Bells.'), boss: 'carillon' }])).toContain(`the Wake's chain must end on ${WAKE_FINALE}`);
    expect(lint([...six, wake(9, 6, 'Bells.'), { ...wake(10, 9, 'Wheels.'), boss: 'astrolabe' }])).toContain(`the Wake's chain must end on ${WAKE_FINALE}`);
  });

  it('catches what it claims to catch', () => {
    const bad: ContentEntry[] = [
      { id: 'a', name: 'A', icon: 'crystal-ball', text: 'Fine.' },
      { id: 'a', name: '', icon: 'nope' as never, text: '' },
      { id: 'Bad_Id', name: 'B', icon: 'crystal-ball', text: 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen' },
    ];
    const problems = lintContent({ t: bad }).map((i) => i.problem);
    expect(problems).toContain('duplicate id');
    expect(problems).toContain('missing name');
    expect(problems).toContain('unknown icon "nope"');
    expect(problems).toContain('missing text');
    expect(problems).toContain('id is not kebab-case');
    expect(problems).toContain('text is 16 words (max 15)');
  });

  it('catches dangling references', () => {
    const problems = lintContent({
      ...CONTENT,
      frames: [{ ...CONTENT.frames[0], startingWeapon: 'nope' } as ContentEntry],
      regions: [{ ...CONTENT.regions[0], pool: [{ enemy: 'ghost', from: 1, weight: 1 }] } as ContentEntry],
    }).map((i) => i.problem);
    expect(problems).toContain('unknown starting weapon "nope"');
    expect(problems).toContain('pool names unknown enemy "ghost"');
    expect(problems).toContain('has 1 enemy types (want 3)');
  });
});

describe('boss and loot lint', () => {
  it('catches a boss nobody fights, a phase that climbs and a relic from nowhere', () => {
    const boss = CONTENT.bosses[0] as BossDef;
    const problems = lintContent({
      ...CONTENT,
      bosses: [...CONTENT.bosses, { ...boss, id: 'stray', phases: [boss.phases[0], { ...boss.phases[1], below: 1 }] } as ContentEntry],
      relics: [...CONTENT.relics, { ...CONTENT.relics[0], id: 'lost', source: { kind: 'boss', boss: 'nobody' } } as ContentEntry],
    }).map((i) => i.problem);
    expect(problems).toContain('no region has this boss');
    expect(problems).toContain('phase 2 does not step down');
    expect(problems).toContain('unknown boss "nobody"');
  });
});

describe('level lint', () => {
  it('catches a missing step, a silent step and a stat-less passive', () => {
    const weapon = CONTENT.weapons[0] as WeaponDef;
    const problems = lintContent({
      ...CONTENT,
      weapons: [{ ...weapon, steps: [...weapon.steps.slice(0, 2), { text: 'Nothing.' }] } as ContentEntry],
      passives: [{ ...CONTENT.passives[0], perLevel: [] } as ContentEntry],
    }).map((i) => i.problem);
    expect(problems).toContain('has 3 level steps (want 4)');
    expect(problems).toContain('level 4 changes nothing');
    expect(problems).toContain('moves no stat');
  });

  it('catches a damage-only step too small to feel (§4.4)', () => {
    const weapon = CONTENT.weapons[0] as WeaponDef;
    const steps = [...weapon.steps.slice(0, 3), { text: '+10% damage.', damageMult: 1.1 }];
    const problems = lintContent({ ...CONTENT, weapons: [{ ...weapon, steps } as ContentEntry] }).map((i) => i.problem);
    expect(problems).toContain('level 5 is only ×1.1 damage (want ≥ ×1.25)');
  });
});

describe('evolution lint (§12.6)', () => {
  it('catches a missing partner, a weapon with two evolutions and one with none', () => {
    const evo = CONTENT.evolutions[0] as EvolutionDef;
    const problems = lintContent({
      ...CONTENT,
      evolutions: [
        ...CONTENT.evolutions.filter((e) => (e as EvolutionDef).weapon !== 'mortar'),
        { ...evo, id: 'twin', passive: 'ghost' } as ContentEntry,
      ],
    }).map((i) => i.problem);
    expect(problems).toContain('unknown partner passive "ghost"');
    expect(problems).toContain('has 2 evolutions (want 1)');
    expect(problems).toContain('has 0 evolutions (want 1)');
  });
});
