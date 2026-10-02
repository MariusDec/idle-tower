import { ABYSS_INDEX, NATIVES, abyssFloor } from '../content/abyss';
import { BOSSES } from '../content/bosses';
import { ENEMIES } from '../content/enemies';
import { FRAMES, frameById } from '../content/frames';
import { REGIONS, regionByIndex } from '../content/regions';
import { RELICS, RELIC_BY_ID, RELIC_SETS, eliteRelics } from '../content/relics';
import { BALANCE } from '../content/balance';
import type { BossId, FrameDef, RegionDef, RelicDef, RelicId, RelicSetDef } from '../content/types';
import type { Profile } from './profile';
import { recipesOpen } from './recipes';
import { starGifts } from './stars';
import { BOSS_WAVE } from '../sim/systems/waves';

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

/** The boss whose fall ends Act 1 (§7.1). */
const FINALE = BOSSES.find((b) => b.finale)!.id;

/** Act 2 (§9): open once the Blight has fallen. Pacts, Starlight, the Constellations and the Abyss. */
export function act2Open(profile: Profile): boolean {
  return bossDown(profile, FINALE);
}

/** True when the next run goes down into the Abyss (§9). */
export function inAbyss(profile: Profile): boolean {
  return profile.region === ABYSS_INDEX && act2Open(profile);
}

/**
 * Region 1 always; each later region once the one before it has been
 * cleared; the Abyss once Act 2 is open.
 */
export function regionUnlocked(profile: Profile, index: number): boolean {
  if (index === 1) return true;
  if (index === ABYSS_INDEX) return act2Open(profile);
  const prev = REGIONS.find((r) => r.index === index - 1);
  return !!prev && REGIONS.some((r) => r.index === index) && bossDown(profile, prev.boss);
}

/** The furthest unlocked region: where pushing pays best (§5.2). */
export function frontier(profile: Profile): RegionDef {
  let best = REGIONS[0];
  for (const r of REGIONS) if (regionUnlocked(profile, r.index) && r.index > best.index) best = r;
  return best;
}

/** The region the next run goes to: the chosen one, if it is still unlocked; the Abyss's first floor for the Abyss. */
export function selectedRegion(profile: Profile): RegionDef {
  if (inAbyss(profile)) return abyssFloor(1);
  return regionUnlocked(profile, profile.region) && profile.region !== ABYSS_INDEX ? regionByIndex(profile.region) : REGIONS[0];
}

export function frameUnlocked(profile: Profile, frame: FrameDef): boolean {
  const u = frame.unlock;
  switch (u.kind) {
    case 'start':
      return true;
    case 'boss':
      return bossDown(profile, u.boss);
    case 'feat':
      return !!profile.feats[u.feat];
    case 'star':
      return starGifts(profile).frames.includes(frame.id);
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

/** Relic slots (§5.3): one per boss whose first kill opens one, and the Lantern's (§9). */
export function relicSlots(profile: Profile): number {
  return BOSSES.filter((b) => b.relicSlot && bossDown(profile, b.id)).length + starGifts(profile).relicSlots;
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

/**
 * Overtime trophies (N4): the thresholds past its boss a region's best wave
 * has reached, as overtime waves (+5, +10, +15).
 */
export function trophiesAt(bestWave: number): number[] {
  return BALANCE.trophies.overtime.filter((k) => bestWave >= BOSS_WAVE + k);
}

/** A region's trophies, by its best wave. */
export function regionTrophies(profile: Profile, index: number): number[] {
  return trophiesAt(profile.regions[index]?.bestWave ?? 0);
}

/** Every trophy the profile holds: one light each on the hub tower. */
export function trophyCount(profile: Profile): number {
  return REGIONS.reduce((n, r) => n + regionTrophies(profile, r.index).length, 0);
}

/** A set's rank (N6): I, and one more per `BALANCE.sets.perRank` duplicates past rank III. */
export function setRank(profile: Profile, region: number): number {
  const S = BALANCE.sets;
  return Math.min(S.maxRank, 1 + Math.floor((profile.sets[region] ?? 0) / S.perRank));
}

/** True when every relic of the set is owned: it can be worn whole. */
export function setOwned(profile: Profile, set: RelicSetDef): boolean {
  return eliteRelics(set.region).every((id) => relicRank(profile, id) > 0);
}

/** The sets worn whole into the next run (N6), at their ranks: what `buildRunConfig` applies. */
export function activeSets(profile: Profile): { set: RelicSetDef; rank: number }[] {
  const worn = new Set<string>(equippedRelics(profile).map((x) => x.relic.id));
  return RELIC_SETS
    .filter((set) => eliteRelics(set.region).every((id) => worn.has(id)))
    .map((set) => ({ set, rank: setRank(profile, set.region) }));
}

/** Relics a region can give, and how many of them this profile has (§5.2's card). */
export function regionRelics(region: number): RelicDef[] {
  return RELICS.filter((r) => {
    const s = r.source;
    switch (s.kind) {
      case 'elite':
        return s.region === region;
      case 'boss':
        return regionOfBossIndex(s.boss) === region;
      case 'abyss':
        return region === ABYSS_INDEX;
      default: {
        const exhaustive: never = s;
        return exhaustive;
      }
    }
  });
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
  /** The Constellations (§9), once the Blight has fallen. */
  stars: boolean;
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
    stars: act2Open(profile),
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

/**
 * Bestiary rows: every enemy and boss, revealed on first sight. The Abyss's
 * own (§9) join the list once Act 2 opens, so Act 1's list is Act 1's.
 */
export function bestiary(profile: Profile): { id: string; seen: boolean; kills: number; boss: boolean }[] {
  const seen = new Set(profile.seenEnemies);
  const act2 = act2Open(profile);
  const native = new Set<string>(NATIVES.map((n) => n.enemy));
  return [
    ...ENEMIES.filter((e) => act2 || !native.has(e.id))
      .map((e) => ({ id: e.id as string, seen: seen.has(e.id), kills: profile.killsBy[e.id] ?? 0, boss: false })),
    ...BOSSES.filter((b) => act2 || !b.abyss)
      .map((b) => ({ id: b.id as string, seen: b.id in profile.bosses, kills: bossKills(profile, b.id), boss: true })),
  ];
}

/** Relics the Collection lists: the Abyss's (§9) only once Act 2 opens. */
export function listedRelics(profile: Profile): RelicDef[] {
  const act2 = act2Open(profile);
  return RELICS.filter((r) => act2 || r.source.kind !== 'abyss');
}

/** Frames the Collection lists: the Constellations' (§9) only once Act 2 opens. */
export function listedFrames(profile: Profile): FrameDef[] {
  const act2 = act2Open(profile);
  return FRAMES.filter((f) => act2 || f.unlock.kind !== 'star');
}

