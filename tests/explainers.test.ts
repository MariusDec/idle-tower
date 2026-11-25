import { describe, expect, it } from 'vitest';
import { newProfile, type Profile } from '../src/meta/profile';
import { collectionPages, hubUnlocks } from '../src/meta/collection';
import { explainerOpen, explainersFor, markExplained, unreadExplainers } from '../src/meta/explainers';
import { EXPLAINERS, type ExplainerView } from '../src/content/explainers';

function killed(...bosses: string[]): Profile {
  const p = newProfile(0);
  p.records.runs = 1;
  for (const b of bosses) p.bosses[b] = { kills: 1, fastest: 50 };
  // Played on past the Gatekeeper: Feats and Trials wait for runs beyond it (R1 §2).
  if (bosses.includes('gatekeeper')) p.regions['2'] = { bestWave: 10, runs: 2 };
  return p;
}

const ids = (defs: readonly { id: string }[]): string[] => defs.map((d) => d.id);

describe('explainers (§7.1)', () => {
  it('are each a few plain paragraphs, one per id', () => {
    expect(new Set(ids(EXPLAINERS)).size).toBe(EXPLAINERS.length);
    for (const e of EXPLAINERS) {
      expect(e.title, e.id).not.toBe('');
      expect(e.lines.length, e.id).toBeGreaterThan(0);
      for (const line of e.lines) expect(line.split(/\s+/).length, `${e.id}: ${line}`).toBeLessThanOrEqual(40);
    }
  });

  it('cover every hub tab, every Collection page, Tactics and Pacts', () => {
    // A mechanic that unlocks without an explainer fails here: add one to `content/explainers.ts`.
    const views = new Set(EXPLAINERS.map((e) => e.view));
    for (const tab of Object.keys(hubUnlocks(newProfile(0)))) expect(views, tab).toContain(tab);
    for (const view of ['home', 'tactics', 'pacts'] as ExplainerView[]) expect(views, view).toContain(view);
    const pages = new Set(EXPLAINERS.filter((e) => e.view === 'collection').map((e) => e.id));
    for (const page of Object.keys(collectionPages(newProfile(0)))) expect(pages, page).toContain(page);
  });

  it('open with what they tell of', () => {
    const fresh = newProfile(0);
    expect(EXPLAINERS.filter((e) => explainerOpen(fresh, e.id))).toEqual([]);
    expect(ids(explainersFor(killed(), 'forge'))).toEqual(['forge']);
    expect(ids(explainersFor(killed('gatekeeper'), 'map'))).toEqual(['map', 'trials']);
    // The fall alone tells only the Map: Feats and Trials come a run or two later (R1 §2).
    const fell = killed('gatekeeper');
    fell.regions = {};
    expect(ids(explainersFor(fell, 'map'))).toEqual(['map']);
    expect(explainersFor(fell, 'feats')).toEqual([]);
    expect(ids(explainersFor(killed('gatekeeper'), 'feats'))).toEqual(['feats']);
    // The Abyss and Boss Rush wait on Act 2 and the Deepwarden.
    const act2 = killed('gatekeeper', 'bog-mother', 'prism', 'forgeheart', 'hollow-king', 'blight');
    // The Wake opens with Act 2 (plans/late-game/12 §8.4); the Abyss waits for the Thunderhead.
    expect(ids(explainersFor(act2, 'map'))).toEqual(['map', 'trials', 'wake']);
    act2.bosses.thunderhead = { kills: 1, fastest: 50 };
    expect(ids(explainersFor(act2, 'map'))).toEqual(['map', 'trials', 'wake', 'abyss']);
    act2.bosses.deepwarden = { kills: 1, fastest: 50 };
    expect(ids(explainersFor(act2, 'map'))).toEqual(['map', 'trials', 'wake', 'abyss', 'rush']);
  });

  it('tell of the tower’s look once it wears something: a trim is cosmetic', () => {
    const p = killed('gatekeeper');
    expect(explainersFor(p, 'home')).toEqual([]);
    p.trials['bare-stone'] = true;
    const [tower] = explainersFor(p, 'home');
    expect(tower.id).toBe('tower');
    expect(tower.lines.join(' ')).toMatch(/cosmetic/);
  });

  it('are told unasked once, and stay behind the "?"', () => {
    const p = killed('gatekeeper');
    expect(ids(unreadExplainers(p, 'map'))).toEqual(['map', 'trials']);
    markExplained(p, ['map']);
    expect(ids(unreadExplainers(p, 'map'))).toEqual(['trials']);
    markExplained(p, ['trials', 'map']);
    expect(unreadExplainers(p, 'map')).toEqual([]);
    expect(p.tutorial.explained).toEqual(['map', 'trials']);
    expect(ids(explainersFor(p, 'map'))).toEqual(['map', 'trials']);
  });
});
