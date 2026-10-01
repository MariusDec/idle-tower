import { BOSSES } from '../content/bosses';
import { ENEMIES } from '../content/enemies';
import { FRAMES, frameById } from '../content/frames';
import { REGIONS, regionByIndex } from '../content/regions';
import { RELICS, RELIC_BY_ID } from '../content/relics';
import { BALANCE } from '../content/balance';
import type { BossId, FrameDef, RegionDef, RelicDef, RelicId } from '../content/types';
import type { Profile } from './profile';
import { recipesOpen } from './recipes';

/**
 * What the profile has unlocked between runs (§5.2–§5.3, §7.1): regions,
 * frames, relic slots and the hub's tabs. Pure functions over the profile;
 * the UI, `buildRunConfig` and the pacing bot all ask here.
 */

export function bossKills(profile: Profile, id: BossId): number {
  return profile.bosses[id]?.kills ?? 0;
}

export function bossDown(profile: Profile, id: BossId): boolean {
  return bossKills(profile, id) > 0;
}

/** Region 1 always; each later region once the one before it has been cleared. */
export function regionUnlocked(profile: Profile, index: number): boolean {
  if (index === 1) return true;
  const prev = REGIONS.find((r) => r.index === index - 1);
  return !!prev && REGIONS.some((r) => r.index === index) && bossDown(profile, prev.boss);
}

/** The furthest unlocked region: where pushing pays best (§5.2). */
export function frontier(profile: Profile): RegionDef {
  let best = REGIONS[0];
  for (const r of REGIONS) if (regionUnlocked(profile, r.index) && r.index > best.index) best = r;
  return best;
}

/** The region the next run goes to: the chosen one, if it is still unlocked. */
export function selectedRegion(profile: Profile): RegionDef {
  return regionUnlocked(profile, profile.region) ? regionByIndex(profile.region) : REGIONS[0];
}

export function frameUnlocked(profile: Profile, frame: FrameDef): boolean {
  const u = frame.unlock;
  switch (u.kind) {
    case 'start':
      return true;
    case 'boss':
      return bossDown(profile, u.boss);
    default: {
      const exhaustive: never = u;
      return exhaustive;
    }
  }
}

/** The frame the next run uses: the chosen one, if it is unlocked. */
export function selectedFrame(profile: Profile): FrameDef {
  const f = frameById(profile.frame);
  return frameUnlocked(profile, f) ? f : FRAMES[0];
}

/** Relic slots (§5.3): one per boss whose first kill opens one. */
export function relicSlots(profile: Profile): number {
  return BOSSES.filter((b) => b.relicSlot && bossDown(profile, b.id)).length;
}

export function relicRank(profile: Profile, id: RelicId): number {
  return profile.relics[id] ?? 0;
}

/** The relics worn into the next run, at their ranks: what `buildRunConfig` applies. */
export function equippedRelics(profile: Profile): { relic: RelicDef; rank: number }[] {
  const slots = relicSlots(profile);
  return profile.equipped
    .filter((id) => RELIC_BY_ID[id as RelicId] && relicRank(profile, id as RelicId) > 0)
    .slice(0, slots)
    .map((id) => ({ relic: RELIC_BY_ID[id as RelicId], rank: relicRank(profile, id as RelicId) }));
}

/** Wear or take off a relic. False, and nothing changes, when it can't be done. */
export function toggleRelic(profile: Profile, id: RelicId): boolean {
  if (relicRank(profile, id) === 0) return false;
  const i = profile.equipped.indexOf(id);
  if (i >= 0) {
    profile.equipped.splice(i, 1);
    return true;
  }
  if (profile.equipped.length >= relicSlots(profile)) return false;
  profile.equipped.push(id);
  return true;
}

/**
 * A relic found (§5.3): new at rank I, a duplicate one rank up to III. A new
 * relic is worn at once if a slot is free. Returns the rank it now has, or 0
 * when it was already maxed.
 */
export function gainRelic(profile: Profile, id: RelicId): number {
  const rank = relicRank(profile, id);
  if (rank >= BALANCE.relics.maxRank) return 0;
  profile.relics[id] = rank + 1;
  if (rank === 0 && profile.equipped.length < relicSlots(profile)) profile.equipped.push(id);
  return rank + 1;
}

/** Relics a region can give, and how many of them this profile has (§5.2's card). */
export function regionRelics(region: number): RelicDef[] {
  return RELICS.filter((r) => (r.source.kind === 'elite' ? r.source.region === region : regionOfBossIndex(r.source.boss) === region));
}

function regionOfBossIndex(boss: BossId): number {
  return REGIONS.find((r) => r.boss === boss)?.index ?? 0;
}

/** A region's enemy types, in the order they arrive. */
export function regionEnemies(region: RegionDef): string[] {
  return region.pool.map((p) => p.enemy);
}

/** The hub's tabs (§10.1), revealed as they unlock, in this order (R3). */
export interface HubUnlocks {
  forge: boolean;
  map: boolean;
  collection: boolean;
  feats: boolean;
}

/** Enemy types seen before the Bestiary opens (§7.1: "after 3+ enemy types seen"). */
export const BESTIARY_AT = 3;

export function hubUnlocks(profile: Profile): HubUnlocks {
  const firstBoss = BOSSES[0].id;
  return {
    forge: profile.records.runs > 0,
    map: bossDown(profile, firstBoss),
    collection: profile.seenEnemies.length >= BESTIARY_AT,
    feats: bossDown(profile, firstBoss),
  };
}

/** The Collection's pages (§5.3), each once it has something on it. */
export function collectionPages(profile: Profile): { bestiary: boolean; relics: boolean; recipes: boolean; frames: boolean } {
  return {
    bestiary: profile.seenEnemies.length >= BESTIARY_AT,
    relics: Object.keys(profile.relics).length > 0,
    recipes: recipesOpen(profile),
    frames: FRAMES.some((f) => f.unlock.kind !== 'start' && frameUnlocked(profile, f)),
  };
}

/** Bestiary rows: every enemy and boss, revealed on first sight. */
export function bestiary(profile: Profile): { id: string; seen: boolean; kills: number; boss: boolean }[] {
  const seen = new Set(profile.seenEnemies);
  return [
    ...ENEMIES.map((e) => ({ id: e.id as string, seen: seen.has(e.id), kills: profile.killsBy[e.id] ?? 0, boss: false })),
    ...BOSSES.map((b) => ({ id: b.id as string, seen: b.id in profile.bosses, kills: bossKills(profile, b.id), boss: true })),
  ];
}

