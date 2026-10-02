import { describe, expect, it } from 'vitest';
import { BOSSES } from '../src/content/bosses';
import { FORGE } from '../src/content/forge';
import { buyNode } from '../src/meta/forge';
import { newProfile } from '../src/meta/profile';
import { runAct2 } from '../tools/act2';

/**
 * The CI-sized Act 2 check (§9, P8): a profile with Act 1 behind it and its
 * Forge bought out, played by the Act 2 bot for half an hour. The full
 * reading, from a real Act 1, is `npm run pacing -- --act2 --hours 12 --seeds 4`.
 */
describe('pacing: Act 2 (§9, P8 gate)', () => {
  const p = newProfile(0);
  p.tutorial.firstDraft = true;
  p.tutorial.forgeIntro = true;
  for (const b of BOSSES) if (!b.abyss) p.bosses[b.id] = { kills: 1, fastest: 60 };
  p.shards = 1e12;
  for (let k = 0; k < 8; k++) for (const n of FORGE) if (n.type !== 'keystone' && n.type !== 'mastery') while (buyNode(p, n.id)) { /* buy out */ }
  p.shards = 0;
  const r = runAct2(p, 0.5, 1);

  it('climbs the heat, earns Starlight and lights stars', () => {
    expect(Math.max(...Object.values(r.best))).toBeGreaterThan(0);
    expect(r.starlight).toBeGreaterThan(0);
    expect(r.stars).toBeGreaterThan(0);
  });

  it('goes down into the Abyss and clears a floor', () => {
    expect(r.abyssRuns).toBeGreaterThan(0);
    expect(r.floor).toBeGreaterThan(0);
  });
}, 300_000);
