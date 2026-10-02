import { describe, expect, it } from 'vitest';
import { assertTransition, canTransition, type Screen } from '../src/app/screens';

describe('screen state machine', () => {
  it('allows the loop boot → hub → run → results → run → results → hub', () => {
    const path: Screen[] = ['boot', 'hub', 'run', 'results', 'run', 'results', 'hub'];
    for (let i = 1; i < path.length; i++) expect(() => assertTransition(path[i - 1], path[i])).not.toThrow();
  });

  it('refuses leaving a run except through results', () => {
    expect(canTransition('run', 'hub')).toBe(false);
    expect(canTransition('run', 'boot')).toBe(false);
  });

  it('never returns to boot', () => {
    for (const s of ['hub', 'run', 'results'] as Screen[]) expect(canTransition(s, 'boot')).toBe(false);
  });
});
