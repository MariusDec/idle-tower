import { ABYSS_INDEX, NATIVES } from '../content/abyss';
import { BALANCE } from '../content/balance';
import { FEATS } from '../content/feats';
import { REGIONS, regionByIndex } from '../content/regions';
import type { FeatDef, FeatGoal } from '../content/types';
import type { RunState } from '../sim/state';
import { FORGE } from '../content/forge';
import { FRAMES } from '../content/frames';
import type { BranchId, ForgeNodeDef } from '../content/types';
import { bossDown, frameUnlocked } from './collection';
import { FORGE_WEB, levelOf } from './forge';
import type { Profile } from './profile';
import { starsLit } from './stars';

/** A region's enemy types, or the Abyss's own four (§9). */
function poolOf(region: number): string[] {
  return region === ABYSS_INDEX ? NATIVES.map((n) => n.enemy) : regionByIndex(region).pool.map((p) => p.enemy);
}

/** The heat each region's boss has fallen at, at worst: what "every region" feats read. */
function coolestRegion(profile: Profile): number {
  return Math.min(...REGIONS.map((r) => profile.pacts.best[r.index] ?? 0));
}

/** The highest heat any region's boss has fallen at. */
function hottestRegion(profile: Profile): number {
  return Math.max(0, ...REGIONS.map((r) => profile.pacts.best[r.index] ?? 0));
}

/** Mastery levels owned in all (§9). */
function masteryLevels(profile: Profile): number {
  return FORGE_WEB.ownedNodes(profile).filter((o) => o.node.type === 'mastery').reduce((s, o) => s + o.level, 0);
}

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
      return poolOf(goal.region).every((id) => profile.seenEnemies.includes(id));
    case 'relics':
      return Object.keys(profile.relics).length >= goal.n;
    case 'lone':
      return !!run && run.loneWave >= goal.wave;
    case 'evolve':
      return profile.recipes.found.length > 0;
    case 'recipes':
      return profile.recipes.found.length >= goal.n;
    case 'frames':
      return FRAMES.filter((f) => frameUnlocked(profile, f)).length >= goal.n;
    case 'runShards':
      return profile.records.bestShards >= goal.n;
    case 'branch':
      return branchNotables(goal.branch).every((n) => levelOf(profile, n.id) > 0);
    case 'bossNoUlt':
      return run?.boss?.killedIn != null && run.ult.casts === 0;
    case 'bareArsenal':
      return run?.boss?.killedIn != null && run.passives.length === 0
        && run.weapons.length >= goal.weapons && run.weapons.every((w) => w.level >= BALANCE.maxLevel);
    case 'heat':
      return hottestRegion(profile) >= goal.heat;
    case 'heatAll':
      return coolestRegion(profile) >= goal.heat;
    case 'abyss':
      return profile.abyss.best >= goal.floor;
    case 'stars':
      return starsLit(profile) >= goal.n;
    case 'mastery':
      return masteryLevels(profile) >= goal.levels;
    default: {
      const exhaustive: never = goal;
      return exhaustive;
    }
  }
}

/** A branch's notables: what "own every notable" asks for. */
function branchNotables(branch: BranchId): ForgeNodeDef[] {
  return FORGE.filter((n) => n.branch === branch && n.type === 'notable');
}

/** True once a feat shows in the list: a secret one surfaces after its boss (§5.4). */
export function featVisible(profile: Profile, feat: FeatDef): boolean {
  return !feat.after || bossDown(profile, feat.after) || !!profile.feats[feat.id];
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
      const pool = poolOf(g.region);
      return pool.filter((id) => profile.seenEnemies.includes(id)).length / pool.length;
    }
    case 'heat':
      return Math.min(1, hottestRegion(profile) / g.heat);
    case 'heatAll':
      return Math.min(1, coolestRegion(profile) / g.heat);
    case 'abyss':
      return Math.min(1, profile.abyss.best / g.floor);
    case 'stars':
      return Math.min(1, starsLit(profile) / g.n);
    case 'mastery':
      return Math.min(1, masteryLevels(profile) / g.levels);
    case 'recipes':
      return Math.min(1, profile.recipes.found.length / g.n);
    case 'frames':
      return Math.min(1, FRAMES.filter((f) => frameUnlocked(profile, f)).length / g.n);
    case 'runShards':
      return Math.min(1, profile.records.bestShards / g.n);
    case 'branch': {
      const all = branchNotables(g.branch);
      return all.filter((n) => levelOf(profile, n.id) > 0).length / Math.max(1, all.length);
    }
    case 'bossNoUlt':
    case 'bareArsenal':
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

/**
 * Mark every newly met feat done. Returns them, in table order. A secret
 * feat counts only once it has surfaced: an ultimate held back at the
 * Gatekeeper is no secret yet, and its reward is priced for Region 4.
 */
export function checkFeats(profile: Profile, run: RunState | null): FeatDef[] {
  const out: FeatDef[] = [];
  for (const f of FEATS) {
    if (profile.feats[f.id] || !featVisible(profile, f)) continue;
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
