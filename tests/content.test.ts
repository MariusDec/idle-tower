import { describe, expect, it } from 'vitest';
import { CONTENT } from '../src/content';
import { lintContent } from '../src/content/lint';
import type { ContentEntry, WeaponDef } from '../src/content/types';

describe('content lint (§12.6)', () => {
  it('the shipped content is clean', () => {
    expect(lintContent(CONTENT)).toEqual([]);
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
