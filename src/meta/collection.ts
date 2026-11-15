import { ABYSS_INDEX, NATIVES, abyssFloor } from '../content/abyss';
import { BOSSES } from '../content/bosses';
import { ENEMIES } from '../content/enemies';
import { FRAMES, frameById } from '../content/frames';
import { REGIONS, regionByIndex } from '../content/regions';
import { RUSH_INDEX, rushStage } from '../content/rush';
import { RELICS, RELIC_BY_ID, RELIC_SETS, eliteRelics } from '../content/relics';
import { BALANCE } from '../content/balance';
import { RIFTS } from '../content/rifts';
import { isCursed } from '../content/cursed';
import type { BossId, FrameDef, RegionDef, RelicDef, RelicId, RelicSetDef, RiftDef } from '../content/types';
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

/** Boss Rush (N8): open once the Deepwarden, the Abyss's first guardian, has fallen. */
export function rushOpen(profile: Profile): boolean {
  return act2Open(profile) && bossDown(profile, 'deepwarden');
}

/** True when the next run is Boss Rush (N8). */
export function inRush(profile: Profile): boolean {
  return profile.region === RUSH_INDEX && rushOpen(profile);
}

/** True when the next run is past the regions: the Abyss or Boss Rush, where pacts and Trials don't hold. */
export function pastRegions(profile: Profile): boolean {
  return inAbyss(profile) || inRush(profile);
}

/**
 * Region 1 always; each later region once the one before it has been
 * cleared; the Abyss once Act 2 is open; Boss Rush once the Deepwarden falls.
 */
export function regionUnlocked(profile: Profile, index: number): boolean {
  if (index === 1) return true;
  if (index === ABYSS_INDEX) return act2Open(profile);
  if (index === RUSH_INDEX) return rushOpen(profile);
  const prev = REGIONS.find((r) => r.index === index - 1);
  return !!prev && REGIONS.some((r) => r.index === index) && bossDown(profile, prev.boss);
}

/** The furthest unlocked region: where pushing pays best (§5.2). */
export function frontier(profile: Profile): RegionDef {
  let best = REGIONS[0];
  for (const r of REGIONS) if (regionUnlocked(profile, r.index) && r.index > best.index) best = r;
  return best;
}

/** The region the next run goes to: the chosen one, if it is still unlocked; the first floor or stage past the regions. */
export function selectedRegion(profile: Profile): RegionDef {
  if (inAbyss(profile)) return abyssFloor(1);
  if (inRush(profile)) return rushStage(1);
  return regionUnlocked(profile, profile.region) && profile.region !== ABYSS_INDEX && profile.region !== RUSH_INDEX
    ? regionByIndex(profile.region)
    : REGIONS[0];
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

/**
 * The relics worn in the ordinary slots, at their ranks. A cursed one sits
 * here only once Bound (plans/late-game/03 §3.3); `buildRunConfig` applies
 * it only in the Abyss, as it does the cursed slot's.
 */
export function equippedRelics(profile: Profile): { relic: RelicDef; rank: number }[] {
  const slots = relicSlots(profile);
  return profile.equipped
    .filter((id) => RELIC_BY_ID[id as RelicId] && relicRank(profile, id as RelicId) > 0)
    .filter((id) => !isCursed(RELIC_BY_ID[id as RelicId]) || isBound(profile, id as RelicId))
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
  // A cursed relic takes an ordinary slot only once Bound, and within the cap on curses.
  const def = RELIC_BY_ID[id];
  if (isCursed(def)) {
    if (!isBound(profile, id) || profile.cursedWorn.includes(id) || cursesWorn(profile) >= BALANCE.cursed.maxWorn) return false;
  }
  profile.equipped.push(id);
  return true;
}

/**
 * A relic found (§5.3): new at rank I, a duplicate one rank up to III. A new
 * relic is worn at once if a slot is free; a cursed one never is: the curse
 * is a choice (plans/late-game/03 §2). Returns the rank it now has, or 0
 * when it was already maxed.
 */
export function gainRelic(profile: Profile, id: RelicId): number {
  const rank = relicRank(profile, id);
  if (rank >= BALANCE.relics.maxRank) return 0;
  profile.relics[id] = rank + 1;
  if (rank === 0 && !isCursed(RELIC_BY_ID[id]) && profile.equipped.length < relicSlots(profile)) profile.equipped.push(id);
  return rank + 1;
}

// ── Cursed relics (plans/late-game/03 §3.3) ─────────────────────────────

/** Cursed relics owned, at any rank. */
export function ownedCursed(profile: Profile): RelicDef[] {
  return RELICS.filter((r) => isCursed(r) && relicRank(profile, r.id) > 0);
}

/**
 * Cursed slots: the first opens with the first cursed relic owned, no
 * Starlight. Plan 08's bottom (the Hunger's first fall on floor 30) opens
 * the second; until the strata ship there is none.
 */
export function cursedSlots(profile: Profile): number {
  return ownedCursed(profile).length > 0 ? 1 : 0;
}

/** True once a cursed relic has `bindAt` duplicates past III: it may also sit in an ordinary slot. */
export function isBound(profile: Profile, id: RelicId): boolean {
  return (profile.bound[id] ?? 0) >= BALANCE.cursed.bindAt;
}

/** Curses worn now, in any slot: the cursed slot's and Bound ones in ordinary slots. */
export function cursesWorn(profile: Profile): number {
  return wornCursedAnywhere(profile).length;
}

/** Every cursed relic worn, in any slot, with its rank. Shown in any region; applied only in the Abyss. */
export function wornCursedAnywhere(profile: Profile): { relic: RelicDef; rank: number }[] {
  const inSlot = profile.cursedWorn
    .filter((id) => RELIC_BY_ID[id as RelicId] && relicRank(profile, id as RelicId) > 0)
    .slice(0, cursedSlots(profile))
    .map((id) => ({ relic: RELIC_BY_ID[id as RelicId], rank: relicRank(profile, id as RelicId) }));
  const bound = equippedRelics(profile).filter((x) => isCursed(x.relic));
  return [...inSlot, ...bound].slice(0, BALANCE.cursed.maxWorn);
}

/**
 * The cursed relics worn into the next run: the cursed slot's, and Bound
 * ones in ordinary slots. Empty outside the Abyss (§3.2): a region run, Boss
 * Rush and Trials never feel a curse.
 */
export function wornCursed(profile: Profile): { relic: RelicDef; rank: number }[] {
  return inAbyss(profile) ? wornCursedAnywhere(profile) : [];
}

/**
 * Wear or take off a cursed relic in the cursed slot. False, and nothing
 * changes, when it can't be done (not owned, the slot full, `maxWorn` reached).
 */
export function toggleCursed(profile: Profile, id: RelicId): boolean {
  if (relicRank(profile, id) === 0 || !isCursed(RELIC_BY_ID[id])) return false;
  const i = profile.cursedWorn.indexOf(id);
  if (i >= 0) {
    profile.cursedWorn.splice(i, 1);
    return true;
  }
  if (profile.cursedWorn.length >= cursedSlots(profile) || cursesWorn(profile) >= BALANCE.cursed.maxWorn) return false;
  // Worn in one slot at a time: a Bound relic moves here from an ordinary one.
  const j = profile.equipped.indexOf(id);
  if (j >= 0) profile.equipped.splice(j, 1);
  profile.cursedWorn.push(id);
  return true;
}

/**
 * Swap `id` into the full cursed slot in place of `out` (the compare
 * sheet's Swap). False when either is not what it should be.
 */
export function swapCursed(profile: Profile, out: RelicId, id: RelicId): boolean {
  const i = profile.cursedWorn.indexOf(out);
  if (i < 0 || relicRank(profile, id) === 0 || !isCursed(RELIC_BY_ID[id]) || profile.cursedWorn.includes(id)) return false;
  const j = profile.equipped.indexOf(id);
  if (j >= 0) profile.equipped.splice(j, 1);
  profile.cursedWorn[i] = id;
  return true;
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
      case 'cursed':
        return region === ABYSS_INDEX;
      case 'secret':
        // No region card counts it (plans/late-game/05): a count says it exists.
        return false;
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
export function collectionPages(profile: Profile): { bestiary: boolean; relics: boolean; recipes: boolean; frames: boolean; rifts: boolean } {
  return {
    // Rifts (plans/late-game/02): once one has been opened.
    rifts: Object.values(profile.rifts).some((r) => r.seen > 0),
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

/** Relics the Collection's Relics segment lists: the Abyss's (§9) only once Act 2 opens; the cursed have their own. */
export function listedRelics(profile: Profile): RelicDef[] {
  const act2 = act2Open(profile);
  // A secret relic (plans/late-game/05) has no silhouette: it is listed once owned.
  return RELICS.filter((r) => !isCursed(r) && (act2 || r.source.kind !== 'abyss') && (r.source.kind !== 'secret' || relicRank(profile, r.id) > 0));
}

/** The Collection's Cursed segment (plans/late-game/03 §2): every cursed relic, owned or a silhouette. */
export function listedCursed(): RelicDef[] {
  return RELICS.filter(isCursed);
}

/** Frames the Collection lists: the Constellations' (§9) only once Act 2 opens. */
export function listedFrames(profile: Profile): FrameDef[] {
  const act2 = act2Open(profile);
  return FRAMES.filter((f) => act2 || f.unlock.kind !== 'star');
}


/** One rift in the journal (plans/late-game/02 §2): unknown, glimpsed (its name only), or seen. */
export interface RiftJournalRow {
  rift: RiftDef;
  state: 'unknown' | 'glimpsed' | 'seen';
  taken: number;
}

/** A group of the journal: a region's own rifts, or those that open anywhere. */
export interface RiftJournalGroup {
  /** A region's index, or 0 for rifts that may open anywhere. */
  region: number;
  name: string;
  /** Commons and rares, found of all (Open 4: legendaries stay hidden until found). */
  found: number;
  of: number;
  rows: RiftJournalRow[];
  /** Legendaries not yet found, once every other rift of the group is: "something rarer opens here". */
  rarer: boolean;
}

/**
 * The rift journal (plans/late-game/02 §2), grouped by region: each region's
 * own (listed under the first region they can open in), then the rest. Act
 * 2's and the Abyss's join once Act 2 is open. A legendary shows only once
 * met.
 */
export function riftJournal(profile: Profile): RiftJournalGroup[] {
  const act2 = act2Open(profile);
  const home = (r: RiftDef): number => r.where.regions?.[0] ?? r.where.from ?? 0;
  const groups = new Map<number, RiftDef[]>();
  for (const r of RIFTS) {
    if (r.where.placed || ((r.where.act2 || r.where.abyss) && !act2)) continue;
    const k = r.where.abyss ? ABYSS_INDEX : home(r);
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const out: RiftJournalGroup[] = [];
  for (const [region, list] of [...groups].sort((a, b) => a[0] - b[0])) {
    const rows: RiftJournalRow[] = list.map((rift) => {
      const rec = profile.rifts[rift.id];
      const state = !rec ? 'unknown' : rec.seen > 0 ? 'seen' : 'glimpsed';
      return { rift, state, taken: rec ? rec.taken.reduce((a, b) => a + b, 0) : 0 };
    });
    const plain = rows.filter((x) => x.rift.rarity !== 'legendary');
    const found = plain.filter((x) => x.state !== 'unknown').length;
    const hiddenLegend = rows.some((x) => x.rift.rarity === 'legendary' && x.state === 'unknown');
    const name = region === 0 ? 'Anywhere' : region === ABYSS_INDEX ? 'The Abyss' : REGIONS.find((x) => x.index === region)?.name ?? '';
    out.push({
      region,
      name,
      found,
      of: plain.length,
      rows: rows.filter((x) => x.rift.rarity !== 'legendary' || x.state !== 'unknown'),
      rarer: hiddenLegend && found === plain.length,
    });
  }
  return out;
}
