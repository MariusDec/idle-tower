import { describe, expect, it } from 'vitest';
import { CONTENT } from '../src/content';
import { lintContent } from '../src/content/lint';
import type { ContentEntry } from '../src/content/types';

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
});
