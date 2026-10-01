import { BALANCE } from '../content/balance';
import { FEATS } from '../content/feats';
import { regionByIndex } from '../content/regions';
import type { FeatDef, FeatGoal } from '../content/types';
import type { RunState } from '../sim/state';
import { bossDown } from './collection';
import type { Profile } from './profile';

/**
 * Feats (§5.4): checked when a run is banked, against that run and the
 * profile it was banked into. A feat is earned once ('done') and pays when
 * claimed in the Feats tab ('claimed'), so the tab can open on a batch of
 * rewards (§5.4). This is `FeatGoal`'s one consumer.
 */
export function featMet(profile: Profile, goal: FeatGoal, run: RunState | null): boolean {
  switch (goal.kind) {
    case 'wave':
      return profile.records.bestWave >= goal.wave;
    case 'boss':
      return bossDown(profile, goal.boss);
    case 'bossFast':
      return run?.boss?.killedIn != null && run.boss.killedIn <= goal.seconds;
    case 'bossHealthy':
      return run?.boss?.killedIn != null && run.boss.minHp >= goal.hp;
    case 'untouched':
      return !!run && run.wave >= goal.wave && (run.firstHurtWave === null || run.firstHurtWave >= goal.wave);
    case 'level':
      return !!run && run.level >= goal.level;
    case 'maxWeapon':
      return !!run && run.weapons.some((w) => w.level >= BALANCE.maxLevel);
    case 'kills':
      return profile.records.kills >= goal.n;
    case 'elites':
      return profile.records.elites >= goal.n;
    case 'bestiary':
      return regionByIndex(goal.region).pool.every((p) => profile.seenEnemies.includes(p.enemy));
    case 'relics':
      return Object.keys(profile.relics).length >= goal.n;
    case 'lone':
      return !!run && run.loneWave >= goal.wave;
    case 'evolve':
      return profile.recipes.found.length > 0;
    default: {
      const exhaustive: never = goal;
      return exhaustive;
    }
  }
}

/**
 * How close a feat is, 0–1, from what the profile remembers: the "closest
 * incomplete feat" of the hub's Next goal (§7.4). Feats that live inside a
 * single run read 0 until they are done.
 */
export function featProgress(profile: Profile, feat: FeatDef): number {
  const g = feat.goal;
  switch (g.kind) {
    case 'wave':
      return Math.min(1, profile.records.bestWave / g.wave);
    case 'kills':
      return Math.min(1, profile.records.kills / g.n);
    case 'elites':
      return Math.min(1, profile.records.elites / g.n);
    case 'relics':
      return Math.min(1, Object.keys(profile.relics).length / g.n);
    case 'bestiary': {
      const pool = regionByIndex(g.region).pool;
      return pool.filter((p) => profile.seenEnemies.includes(p.enemy)).length / pool.length;
    }
    case 'boss':
    case 'bossFast':
    case 'bossHealthy':
    case 'untouched':
    case 'level':
    case 'maxWeapon':
    case 'lone':
    case 'evolve':
      return featMet(profile, g, null) ? 1 : 0;
    default: {
      const exhaustive: never = g;
      return exhaustive;
    }
  }
}

/** Mark every newly met feat done. Returns them, in table order. */
export function checkFeats(profile: Profile, run: RunState | null): FeatDef[] {
  const out: FeatDef[] = [];
  for (const f of FEATS) {
    if (profile.feats[f.id]) continue;
    if (featMet(profile, f.goal, run)) {
      profile.feats[f.id] = 'done';
      out.push(f);
    }
  }
  return out;
}

/** Earned and not yet paid. */
export function claimable(profile: Profile): FeatDef[] {
  return FEATS.filter((f) => profile.feats[f.id] === 'done');
}

/** Pay a feat's shards. Returns what was paid; 0 if it wasn't claimable. */
export function claimFeat(profile: Profile, id: string): number {
  const f = FEATS.find((x) => x.id === id);
  if (!f || profile.feats[id] !== 'done') return 0;
  profile.feats[id] = 'claimed';
  profile.shards += f.reward;
  return f.reward;
}

/** Pay every claimable feat at once. */
export function claimAll(profile: Profile): number {
  let sum = 0;
  for (const f of claimable(profile)) sum += claimFeat(profile, f.id);
  return sum;
}
