import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/content/balance';
import { BOSSES } from '../src/content/bosses';
import { regionByIndex } from '../src/content/regions';
import { SECRETS, SECRET_BY_ID } from '../src/content/secrets';
import { CONTENT } from '../src/content';
import { lintContent, secretsRule } from '../src/content/lint';
import type { SecretDef } from '../src/content/types';
import { listedRelics } from '../src/meta/collection';
import { explainerOpen } from '../src/meta/explainers';
import { newProfile, type Profile } from '../src/meta/profile';
import { buildRunConfig } from '../src/meta/runConfig';
import { bossLore, formsSeen, margin, recordSecrets, secretConfig } from '../src/meta/secrets';
import { MIGRATIONS, migrate } from '../src/meta/save/migrate';
import { trims } from '../src/meta/trials';
import { createRun } from '../src/sim/run';
import type { RunState } from '../src/sim/state';
import { newWeapon } from '../src/sim/systems/arms';
import { arriveBoss, phasesOf } from '../src/sim/systems/boss';
import { damageEnemy, kill } from '../src/sim/systems/combat';
import { pickCard, tickDraft } from '../src/sim/systems/draft';
import { notePick, secretsOnBossKill } from '../src/sim/systems/secrets';
import { body } from './helpers/body';

/**
 * Secrets (plans/late-game/05): found by playing, never listed. A tally stirs
 * at a share of its goal and is found at the goal, working at once; a form
 * arrives on its condition; the margin shows only what was heard.
 */

/** Past Forgeheart (the Act 1 secrets' gate), standing in region `region`, past the first draft. */
function surfaced(region = 1): Profile {
  const p = newProfile(0);
  p.tutorial.firstDraft = true;
  for (const b of BOSSES) if (!b.abyss && b.id !== 'hollow-king' && b.id !== 'blight') p.bosses[b.id] = { kills: 1, fastest: 60 };
  p.region = region;
  return p;
}

function runIn(p: Profile, seed = 1): RunState {
  return createRun(buildRunConfig(p), seed);
}

const tally = (s: SecretDef): number => (s.trigger.kind === 'tally' ? s.trigger.n : 0);

describe('surfacing (§3.1)', () => {
  it('a fresh profile, a Trial and Boss Rush hold none: their runs are as before', () => {
    expect(buildRunConfig(newProfile(0)).secrets).toBeNull();
    expect(createRun(buildRunConfig(newProfile(0)), 1).secrets).toBeNull();
    expect(secretConfig(surfaced(), true)).toBeNull();
  });

  it('every secret surfaces after Forgeheart; a found tally leaves the live list, a found form stays', () => {
    const p = surfaced();
    const cfg = secretConfig(p, false)!;
    expect([...cfg.live].sort()).toEqual(SECRETS.map((s) => s.id).sort());
    p.secrets.found = { shatterfall: 3, 'the-lens': 4 };
    const live = secretConfig(p, false)!.live;
    expect(live).not.toContain('shatterfall');
    expect(live).toContain('the-lens');
  });

  it('ignores unknown ids in a save', () => {
    const p = surfaced();
    p.secrets.heard = ['gone-secret', 'shatterfall'];
    p.secrets.found = { 'gone-secret': 1 };
    expect(secretConfig(p, false)!.heard).toEqual(['shatterfall']);
    expect(margin(p).map((r) => r.secret.id)).toEqual(['shatterfall']);
  });
});

describe('tallies, stirs and finds (§3.2–3.4)', () => {
  it('Shatterfall stirs at a quarter of its goal, once, and is found at the goal, working in the same run', () => {
    const run = runIn(surfaced());
    run.weapons.push(newWeapon('frost-ring', 3), newWeapon('mortar', 3));
    const n = tally(SECRET_BY_ID.shatterfall);
    const stirAt = Math.ceil(n * BALANCE.secrets.stirAt);
    for (let i = 1; i <= n; i++) {
      run.events.length = 0;
      kill(run, body(run, { frozenUntil: run.time + 5 }), 'lob');
      const stirred = run.events.some((e) => e.kind === 'secret' && e.stage === 'stir');
      expect(stirred, `kill ${i}`).toBe(i === stirAt);
    }
    expect(run.secrets!.stirred).toBe('shatterfall');
    expect(run.secrets!.fresh).toEqual(['shatterfall']);
    expect(run.behaviours.shatterfall).toBe(1);
    // It works at once: a shell on a frozen body at half its HP shatters it.
    const e = body(run, { frozenUntil: run.time + 5, hp: 60, maxHp: 100 });
    damageEnemy(run, e, 15, false, 'lob');
    expect(e.alive).toBe(false);
  });

  it('a kill that misses a condition counts nothing: not frozen, the wrong weapon, a weapon not carried', () => {
    const run = runIn(surfaced());
    run.weapons.push(newWeapon('frost-ring', 3), newWeapon('mortar', 3));
    kill(run, body(run), 'lob');
    kill(run, body(run, { frozenUntil: run.time + 5 }), 'homing');
    expect(run.secrets!.counts.shatterfall).toBeUndefined();
    const bare = runIn(surfaced());
    kill(bare, body(bare, { frozenUntil: bare.time + 5 }), 'lob');
    expect(bare.secrets!.counts.shatterfall).toBeUndefined();
  });

  it('only one riddle stirs a run, first come first served', () => {
    const run = runIn(surfaced(2));
    run.weapons.push(newWeapon('frost-ring', 3), newWeapon('mortar', 3), newWeapon('sunlance', 3));
    const share = (id: 'shatterfall' | 'beacon-road'): number => Math.ceil(tally(SECRET_BY_ID[id]) * BALANCE.secrets.stirAt);
    for (let i = 0; i < share('beacon-road'); i++) kill(run, body(run), 'beam');
    for (let i = 0; i < share('shatterfall'); i++) kill(run, body(run, { frozenUntil: run.time + 5 }), 'lob');
    expect(run.secrets!.stirred).toBe('beacon-road');
    expect(run.secrets!.heard).not.toContain('shatterfall');
  });

  it('a region secret counts only in its region', () => {
    const run = runIn(surfaced(1));
    run.weapons.push(newWeapon('sunlance', 3));
    kill(run, body(run), 'beam');
    expect(run.secrets!.counts['beacon-road']).toBeUndefined();
  });

  it('a riddle already heard never stirs again', () => {
    const p = surfaced();
    p.secrets.heard = ['shatterfall'];
    const run = runIn(p);
    run.weapons.push(newWeapon('frost-ring', 3), newWeapon('mortar', 3));
    for (let i = 0; i < 20; i++) kill(run, body(run, { frozenUntil: run.time + 5 }), 'lob');
    expect(run.secrets!.stirred).toBeNull();
  });
});

describe('brink and the wayward road', () => {
  it('Kintsugi: found when the boss falls after the tower was below 5%, stirred below 15%', () => {
    const run = runIn(surfaced());
    arriveBoss(run, regionByIndex(1));
    run.boss!.minHp = 0.1;
    secretsOnBossKill(run, 0, 0);
    expect(run.secrets!.stirred).toBe('kintsugi');
    expect(run.secrets!.fresh).not.toContain('kintsugi');
    run.boss!.minHp = 0.03;
    secretsOnBossKill(run, 0, 0);
    expect(run.secrets!.fresh).toContain('kintsugi');
  });

  it('Wayward: only picks of one\'s own; a single suggestion taken spoils it (I9)', () => {
    const run = runIn(surfaced());
    arriveBoss(run, regionByIndex(1));
    for (let i = 0; i < 10; i++) notePick(run, false);
    expect(run.secrets!.stirred).toBe('wayward');
    secretsOnBossKill(run, 0, 0);
    expect(run.secrets!.fresh).toContain('wayward');

    const idle = runIn(surfaced(), 2);
    arriveBoss(idle, regionByIndex(1));
    for (let i = 0; i < 30; i++) notePick(idle, i % 7 !== 0);
    secretsOnBossKill(idle, 0, 0);
    expect(idle.secrets!.fresh).not.toContain('wayward');
  });

  it('pickCard tells the suggestion from an off pick', () => {
    const run = runIn(surfaced());
    run.pendingDrafts = 2;
    tickDraft(run);
    pickCard(run, run.draft!.suggested);
    tickDraft(run);
    const off = run.draft!.cards.findIndex((_, i) => i !== run.draft!.suggested);
    pickCard(run, off);
    expect(run.secrets!.on).toBe(1);
    expect(run.secrets!.off).toBe(1);
  });
});

describe('forms (§3.5)', () => {
  it('The Lens comes only to a run with nothing its mirror turns, and never on a first kill', () => {
    const p = surfaced(3);
    const turned = runIn(p);
    arriveBoss(turned, regionByIndex(3));
    expect(turned.boss!.form ?? null).toBeNull();

    const clean = runIn(p);
    clean.weapons = [newWeapon('sunlance', 3)];
    arriveBoss(clean, regionByIndex(3));
    expect(clean.boss!.form).toBe('the-lens');
    expect(clean.events.some((e) => e.kind === 'secret' && e.stage === 'sighted')).toBe(true);
    // Its phases are the form's: no mirror.
    const phases = phasesOf(clean, BOSSES.find((b) => b.id === 'prism')!);
    expect(phases.some((ph) => ph.patterns.some((x) => x.kind === 'mirror'))).toBe(false);

    const first = createRun({ ...buildRunConfig(p), firstKill: true }, 1);
    first.weapons = [newWeapon('sunlance', 3)];
    arriveBoss(first, regionByIndex(3));
    expect(first.boss!.form ?? null).toBeNull();
  });

  it('felling a form finds it and drops its relic; a repeat fall drops another rank', () => {
    const run = runIn(surfaced(3));
    run.weapons = [newWeapon('sunlance', 3)];
    arriveBoss(run, regionByIndex(3));
    secretsOnBossKill(run, 0, 0);
    expect(run.secrets!.fresh).toEqual(['the-lens']);
    expect(run.relics).toEqual(['lens-shard']);
  });

  it('the Banked Forge needs Absolute Zero', () => {
    const run = runIn(surfaced(4));
    run.weapons = [{ ...newWeapon('frost-ring', 5), evolved: true }];
    arriveBoss(run, regionByIndex(4));
    expect(run.boss!.form).toBe('banked-forge');
  });
});

describe('banking and the margin (§2, §5)', () => {
  it('a heard riddle is banked whatever the outcome; a find pays once and joins the margin in full', () => {
    const p = surfaced();
    const run = runIn(p);
    run.weapons.push(newWeapon('frost-ring', 3), newWeapon('mortar', 3));
    for (let i = 0; i < tally(SECRET_BY_ID.shatterfall); i++) kill(run, body(run, { frozenUntil: run.time + 5 }), 'lob');
    const shards = p.shards;
    const banked = recordSecrets(p, run)!;
    expect(banked.found).toEqual(['shatterfall']);
    expect(p.shards - shards).toBe(SECRET_BY_ID.shatterfall.shards);
    expect(margin(p)).toEqual([{ secret: SECRET_BY_ID.shatterfall, found: true, where: null }]);
    // Found, its effect is every run's.
    expect(buildRunConfig(p).behaviours.shatterfall).toBe(1);
  });

  it('a fresh and a full Act 1 profile have no margin, and no secret relic is listed until owned', () => {
    expect(margin(newProfile(0))).toEqual([]);
    const p = surfaced();
    expect(margin(p)).toEqual([]);
    expect(listedRelics(p).some((r) => r.source.kind === 'secret')).toBe(false);
    expect(explainerOpen(p, 'whispers')).toBe(false);
    p.secrets.heard = ['glassfrost'];
    expect(margin(p)).toHaveLength(1);
    expect(margin(p)[0]).toMatchObject({ found: false, where: regionByIndex(3).name });
    expect(explainerOpen(p, 'whispers')).toBe(true);
    p.relics['lens-shard'] = 1;
    expect(listedRelics(p).some((r) => r.id === 'lens-shard')).toBe(true);
  });

  it('a secret trim joins the trims once found', () => {
    const p = surfaced();
    expect(trims(p)).not.toContain('kintsugi');
    p.secrets.found = { kintsugi: 2 };
    expect(trims(p)).toContain('kintsugi');
  });

  it('a boss gains a lore line after a few falls, and "Also seen as" after the sighting', () => {
    const p = surfaced();
    expect(bossLore(p, 'prism')).toEqual([]);
    p.bosses.prism = { kills: BALANCE.secrets.loreKills, fastest: 60 };
    expect(bossLore(p, 'prism')).toEqual([SECRET_BY_ID['the-lens'].hint]);
    p.secrets.sighted = ['the-lens'];
    expect(bossLore(p, 'prism')).toEqual([]);
    expect(formsSeen(p, 'prism')).toEqual(['The Lens']);
  });
});

describe('content and save', () => {
  it('the lint catches a spoiler: a secret named in another table', () => {
    expect(lintContent(CONTENT)).toEqual([]);
    const feats = [{ id: 'leak', name: 'Leak', icon: 'crown' as const, text: 'Find Shatterfall.' }];
    const problems = secretsRule(['Some whispers point at The Lens.'])({ secrets: SECRETS, feats }).map((i) => i.problem);
    expect(problems).toEqual(['names the secret "Shatterfall"', 'names the secret "The Lens"']);
  });

  it('walks a v19 profile to v20: nothing found, heard, tallied or sighted', () => {
    const out = migrate({ version: 19, createdAt: 5, shards: 50 }, MIGRATIONS, 20);
    expect(out.version).toBe(20);
    expect(out.secrets).toEqual({ found: {}, heard: [], tally: {}, sighted: [] });
  });
});
