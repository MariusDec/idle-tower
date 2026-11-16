import { ABYSS_INDEX, abyssFloor, bossFloor, floorBoss } from '../content/abyss';
import { BALANCE } from '../content/balance';
import { BOSSES, BOSS_BY_ID } from '../content/bosses';
import { CONTRACT_OMENS, CONTRACT_TRIMS, QUARRY, contractText, midSentence } from '../content/contracts';
import { EVOLUTION_OF } from '../content/evolutions';
import { FRAMES } from '../content/frames';
import { MAX_HEAT } from '../content/pacts';
import { REGIONS, regionByIndex } from '../content/regions';
import { RELICS, RELIC_BY_ID } from '../content/relics';
import { isCursed } from '../content/cursed';
import { RUSH_INDEX, RUSH_STAGES, rushStage } from '../content/rush';
import { BOTTOM, waypoints } from '../content/strata';
import { ENEMY_BY_ID } from '../content/enemies';
import { FUSION_BY_ID } from '../content/fusions';
import { WEAPONS, WEAPON_BY_ID } from '../content/weapons';
import type {
  BossId, ContractMod, ContractSlot, ContractSpec, ContractTarget, FrameId, FusionId, RegionDef, RelicId, TrimId, TrialRule, WeaponId,
} from '../content/types';
import { MAX_TEXT_WORDS } from '../content/lint';
import { formatDuration } from '../core/format';
import { Rng, hashString } from '../core/rng';
import { pactLoad } from '../sim/pacts';
import { openingTypes } from '../sim/run';
import type { RunState } from '../sim/state';
import { isWeaponId } from '../sim/systems/draft';
import { act2Open, bossDown, frameUnlocked, gainRelic, regionUnlocked, relicRank, rushOpen } from './collection';
import { activeNodes } from './forge';
import { farmRate } from './offline';
import { bestHeat, heat } from './pacts';
import type { Profile } from './profile';
import { STAR_WEB, payStarlight } from './stars';

/**
 * The Contract board (plans/late-game/10): three generated goals on the hub,
 * each one run played a certain way, replaced the moment one is done. Pure
 * functions over the profile; the board view, `buildRunConfig` (the rules),
 * `bankRun` (the settling) and the bots all ask here.
 *
 * A contract is one target and up to two modifiers (§3). Its score is the
 * target's base, its stretch against the player's own records, and the
 * modifiers' points; the score's tier sets its pay, read live (§3: a card
 * whose record has since been beaten pays less). The board's RNG is meta-side,
 * keyed on the profile's birth and a counter, so the same profile always
 * draws the same cards and no sim stream moves.
 */

export const SLOTS: readonly ContractSlot[] = ['quick', 'steady', 'hard'];
const C = BALANCE.contracts;
/** A region's boss wave: where a run "held to the boss" has been. */
const BOSS_AT = 20;
/** Waves a `wave` target keeps under the region's best: a card adds a handicap on top. */
const WAVE_ROOM = 2;
/**
 * The waves a `wave` target asks for, and an `untouched` tally's. None is
 * short: a card pays farm minutes, so one met in half a minute and retreated
 * from would out-earn any run, and free rerolls would find it every time.
 */
const WAVES: readonly number[] = [15, 18, 20];
const UNTOUCHED: readonly number[] = [10, 12, 14, 16];
type TargetKind = ContractTarget['kind'];

// ── Opening and places ───────────────────────────────────────────────────

/** True once the board is open (§2): `BALANCE.contracts.opensAfter` has fallen. */
export function boardOpen(profile: Profile): boolean {
  return bossDown(profile, C.opensAfter);
}

/** Where a contract runs: a region's index, the Abyss or Boss Rush. */
export function placeOf(t: ContractTarget): number {
  switch (t.kind) {
    case 'boss':
    case 'wave':
    case 'overtime':
    case 'run':
      return t.region;
    case 'floor':
    case 'guardian':
      return ABYSS_INDEX;
    case 'rush':
      return RUSH_INDEX;
    default: {
      const exhaustive: never = t;
      return exhaustive;
    }
  }
}

/** The floor a guardian holds: the first boss floor it guards, down to the bottom. */
export function guardianFloor(boss: BossId): number {
  for (let f = 1; f <= BOTTOM; f++) if (bossFloor(f) && floorBoss(f) === boss) return f;
  return BOTTOM;
}

/** The floor an Abyss contract asks for: a floor's own, or its guardian's. 0 outside the Abyss. */
function abyssFloorOf(t: ContractTarget): number {
  return t.kind === 'floor' ? t.floor : t.kind === 'guardian' ? guardianFloor(t.boss) : 0;
}

/** The waypoint a contract's Take starts the descent at (§4.5): the deepest open foot at or above its floor. */
export function contractStart(profile: Profile, c: ContractSpec): number {
  const floor = abyssFloorOf(c.target);
  if (floor <= 0) return 1;
  return Math.max(1, ...waypoints(profile.abyss.felled).filter((w) => w <= floor));
}

/** The opening a `weapons` rule must answer (§4.2): the region's, the waypoint's floor, or Boss Rush's first stage. */
function openingOf(profile: Profile, c: ContractSpec): RegionDef {
  const place = placeOf(c.target);
  if (place === ABYSS_INDEX) return abyssFloor(contractStart(profile, c));
  if (place === RUSH_INDEX) return rushStage(1);
  return regionByIndex(place);
}

// ── What the player owns ─────────────────────────────────────────────────

/** Weapons the player owns: every unlocked frame's own, and every one a Forge node or star unlocks. */
export function ownedWeapons(profile: Profile): WeaponId[] {
  const owned = new Set<WeaponId>();
  for (const f of FRAMES) if (frameUnlocked(profile, f)) owned.add(f.startingWeapon);
  for (const o of [...activeNodes(profile), ...STAR_WEB.ownedNodes(profile)]) {
    for (const e of o.node.effects) if (e.kind === 'unlockCard' && isWeaponId(e.id)) owned.add(e.id);
  }
  return WEAPONS.filter((w) => owned.has(w.id)).map((w) => w.id);
}

/** Frames the player can run as. */
function ownedFrames(profile: Profile): FrameId[] {
  return FRAMES.filter((f) => frameUnlocked(profile, f)).map((f) => f.id as FrameId);
}

/** Weapons whose evolution the player has found: an `evolve` can only ask for one of these. */
function evolvable(profile: Profile, owned: readonly WeaponId[]): WeaponId[] {
  return owned.filter((w) => EVOLUTION_OF[w] && profile.recipes.found.includes(EVOLUTION_OF[w].id));
}

/** The furthest region whose boss is down; null before any. */
function latestCleared(profile: Profile): RegionDef | null {
  let out: RegionDef | null = null;
  for (const r of REGIONS) if (bossDown(profile, r.boss)) out = r;
  return out;
}

function bestWave(profile: Profile, region: number): number {
  return profile.regions[region]?.bestWave ?? 0;
}

/** True where a `slay` may be asked: the region's boss falls often enough that a run reaches its wave as a matter of course. */
function quarryOpen(profile: Profile, region: number): boolean {
  return bestWave(profile, region) >= BOSS_AT && (profile.bosses[regionByIndex(region).boss]?.kills ?? 0) >= C.freshKills;
}

/** Abyss guardians felled at least once: the only ones a contract may name (§3, never a first fall). */
function felledGuardians(profile: Profile): BossId[] {
  return BOSSES.filter((b) => b.abyss && bossDown(profile, b.id)).map((b) => b.id);
}

// ── Score and tier (§3) ──────────────────────────────────────────────────

/**
 * Points for asking `d` above one's own record: heat, or a floor (§3's
 * table). `ask` is the heat or floor itself: a stretch is worth no more than
 * half its own height, so heat 1 or floor 2 past a record of nothing (Act 2
 * just opened) is not scored as a wall.
 */
function stretchPoints(d: number, ask: number): number {
  const points = d <= -3 ? 0 : d === -2 ? 0.5 : d === -1 ? 1 : d === 0 ? 1.5 : 2.5;
  return Math.min(points, ask * 0.5);
}

/** Points for a time `ratio` of one's own fastest (§3): 1.4 → 0.5, 1.15 → 1, 1.0 → 2, 0.85 → 3, between them in a line. */
function timePoints(ratio: number): number {
  const pts: readonly [number, number][] = [[1.4, 0.5], [1.15, 1], [1, 2], [0.85, 3]];
  if (ratio >= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [r0, p0] = pts[i - 1];
    const [r1, p1] = pts[i];
    if (ratio >= r1) return p0 + ((r0 - ratio) / (r0 - r1)) * (p1 - p0);
  }
  return pts[pts.length - 1][1];
}

/** The target's base and stretch, against the player's records now. */
export function targetPoints(profile: Profile, t: ContractTarget): number {
  switch (t.kind) {
    case 'boss': {
      const latest = !act2Open(profile) && latestCleared(profile)?.index === t.region;
      // A boss felled only once or twice is not yet a reliable kill: a stretch, as a record is.
      const fresh = (profile.bosses[regionByIndex(t.region).boss]?.kills ?? 0) < C.freshKills;
      return 1 + (latest ? 1 : 0) + (fresh ? 2 : 0);
    }
    case 'wave': {
      // A wave near the region's own best is the edge of what the tower does there.
      const margin = bestWave(profile, t.region) - t.wave;
      return 0.5 + (margin <= 0 ? 1.5 : margin <= 2 ? 1 : margin <= 5 ? 0.5 : 0);
    }
    case 'run':
      return 0.5;
    case 'overtime': {
      // Past the region's own best wave is a record to break, and just under it nearly one:
      // a stretch, as heat's and the floors' are.
      const margin = bestWave(profile, t.region) - (20 + t.k);
      return 1 + t.k / 5 + (margin < 0 ? 3 : margin < 3 ? 1 : 0);
    }
    case 'floor':
      return 1 + stretchPoints(t.floor - profile.abyss.best, t.floor);
    case 'guardian':
      return 2;
    case 'rush':
      if (t.within === null) return 1 + t.stages / 4;
      return 3 + (profile.rush.time ? timePoints(t.within / profile.rush.time) : 2);
    default: {
      const exhaustive: never = t;
      return exhaustive;
    }
  }
}

/** One modifier's points, against the player's records now. */
export function modPoints(profile: Profile, c: Pick<ContractSpec, 'target' | 'mods'>, m: ContractMod): number {
  switch (m.kind) {
    case 'heat': {
      const place = placeOf(c.target);
      return stretchPoints(m.heat - bestHeat(profile, place), m.heat);
    }
    case 'within': {
      const boss = c.target.kind === 'boss' ? regionByIndex(c.target.region).boss : null;
      const fastest = boss ? profile.bosses[boss]?.fastest ?? null : null;
      return fastest ? timePoints(m.seconds / fastest) : 2;
    }
    case 'healthy':
      return m.pct >= 70 ? 2 : 1;
    case 'noUlt':
      return 1;
    case 'untouched':
      return m.wave / 10;
    case 'carry':
      // Every other weapon's damage counts against the half: the build is the handicap.
      return 2;
    case 'evolve':
    case 'fuse':
      return 1.5;
    case 'slay':
      return 1;
    case 'rule': {
      const r = m.rule;
      switch (r.kind) {
        case 'frame':
          return r.frame === profile.frame ? 0 : 1;
        case 'weapons':
          return r.ids.length === 1 ? 2 : r.ids.length === 2 ? 1 : 0.5;
        case 'slots':
          if (r.passive === 0) return 1.5;
          return r.weapon === 1 ? 2 : 1;
        case 'omen':
          return 0.75 * r.rank;
        default: {
          const exhaustive: never = r;
          return exhaustive;
        }
      }
    }
    default: {
      const exhaustive: never = m;
      return exhaustive;
    }
  }
}

/** A contract's score now (§3): target base + stretch + Σ modifier points. */
export function score(profile: Profile, c: Pick<ContractSpec, 'target' | 'mods'>): number {
  const s = targetPoints(profile, c.target) + c.mods.reduce((sum, m) => sum + modPoints(profile, c, m), 0);
  return Math.round(s * 100) / 100;
}

/** The tier a score lands in: T1 ≤ 2.5, T2 ≤ 4, T3 ≤ 5.5, T4 above. */
export function tierOf(s: number): 1 | 2 | 3 | 4 {
  const [a, b, d] = C.tiers;
  return s <= a ? 1 : s <= b ? 2 : s <= d ? 3 : 4;
}

/** The tiers a slot may hold (§3). */
export function slotBand(slot: ContractSlot): readonly [number, number] {
  return C.bands[SLOTS.indexOf(slot)];
}

/** A contract's tier now, kept inside its slot's band: pay follows the band (§4.3). */
export function contractTier(profile: Profile, c: ContractSpec): 1 | 2 | 3 | 4 {
  const [lo, hi] = slotBand(c.slot);
  return Math.max(lo, Math.min(hi, tierOf(score(profile, c)))) as 1 | 2 | 3 | 4;
}

// ── Pay (§4.4) ───────────────────────────────────────────────────────────

/** What a tier pays: farm minutes in shards, and in Act 2 Starlight before the Stargazers. */
export interface ContractPay {
  tier: 1 | 2 | 3 | 4;
  shards: number;
  starlight: number;
}

/** A tier's pay at the farm rate now. Nothing is paid: the board shows it, `settleContract` pays it. */
export function contractPay(profile: Profile, tier: 1 | 2 | 3 | 4): ContractPay {
  return {
    tier,
    shards: Math.floor(farmRate(profile) * C.minutes[tier - 1]),
    starlight: act2Open(profile) ? C.starlight[tier - 1] : 0,
  };
}

// ── Validity (§4.2) ──────────────────────────────────────────────────────

/** True when `m` reads the run's region and its pacts: a region's targets only. */
function regional(t: ContractTarget): boolean {
  return t.kind === 'boss' || t.kind === 'wave' || t.kind === 'overtime' || t.kind === 'run';
}

/** Two modifiers that may sit on one card (§4.2's pairing rules). */
function compatible(profile: Profile, t: ContractTarget, a: ContractMod, b: ContractMod): boolean {
  if (a.kind === b.kind && (a.kind !== 'rule' || (b.kind === 'rule' && a.rule.kind === b.rule.kind))) return false;
  const pair = (x: ContractMod['kind'], y: ContractMod['kind']): boolean => (a.kind === x && b.kind === y) || (a.kind === y && b.kind === x);
  const either = <K extends ContractMod['kind']>(k: K): Extract<ContractMod, { kind: K }> | null =>
    (a.kind === k ? a : b.kind === k ? b : null) as Extract<ContractMod, { kind: K }> | null;
  const rule = <K extends TrialRule['kind']>(k: K): Extract<TrialRule, { kind: K }> | null => {
    for (const m of [a, b]) if (m.kind === 'rule' && m.rule.kind === k) return m.rule as Extract<TrialRule, { kind: K }>;
    return null;
  };
  // Two leads, or two tallies, never read as one sentence.
  if (pair('evolve', 'fuse') || pair('untouched', 'slay')) return false;
  // `within` reads the fastest kill at any heat: with heat, only well under the record (§3).
  const h = either('heat');
  if (h && either('within') && t.kind === 'boss' && h.heat > bestHeat(profile, t.region) - 2) return false;
  const weapons = rule('weapons');
  const slots = rule('slots');
  // The fastest kill was set with the whole build: never asked again under a build's handicap.
  if (either('within') && (weapons || slots || either('carry'))) return false;
  // A weapons rule and a weapon-slot ceiling say the same thing twice.
  if (weapons && slots && slots.weapon !== undefined) return false;
  const carry = either('carry');
  const evolve = either('evolve');
  // One weapon leads a run (it starts mounted): a carry and an evolve name the same one.
  if (carry && evolve && carry.weapon !== evolve.weapon) return false;
  // A weapon the rule excludes can neither carry nor evolve (§4.2).
  if (weapons && carry && !weapons.ids.includes(carry.weapon)) return false;
  if (weapons && evolve && !weapons.ids.includes(evolve.weapon)) return false;
  // One weapon slot: carrying is a given, and only the first weapon mounts.
  if (slots?.weapon === 1 && (carry || evolve)) return false;
  // An evolution needs its passive; a fusion needs two evolved weapons and its own pair.
  if (slots?.passive === 0 && (evolve || either('fuse'))) return false;
  const fuse = either('fuse');
  if (fuse && (weapons || (slots?.weapon ?? 9) < 2)) return false;
  if (fuse && carry && !FUSION_BY_ID[fuse.fusion].weapons.includes(carry.weapon)) return false;
  return true;
}

/** One modifier alone: fits the target, owned, open, inside the records (§4.2). */
function modValid(profile: Profile, c: ContractSpec, m: ContractMod, owned: readonly WeaponId[]): boolean {
  const t = c.target;
  switch (m.kind) {
    case 'heat':
      // Heat holds only in Act 2's regions; never above the record + 1.
      return act2Open(profile) && regional(t) && m.heat >= 1 && m.heat <= Math.min(MAX_HEAT, bestHeat(profile, placeOf(t)) + 1);
    case 'within':
      return t.kind === 'boss' && m.seconds >= C.minWithin && (profile.bosses[regionByIndex(t.region).boss]?.fastest ?? null) !== null;
    case 'healthy':
      return t.kind === 'boss' && (m.pct === 50 || m.pct === 70);
    case 'noUlt':
      return true;
    case 'untouched':
      return t.kind === 'run' && m.wave >= 4 && m.wave <= Math.min(20, bestWave(profile, t.region));
    case 'carry':
      return owned.includes(m.weapon);
    case 'evolve':
      return evolvable(profile, owned).includes(m.weapon);
    case 'fuse':
      return profile.fusions.includes(m.fusion) && FUSION_BY_ID[m.fusion].weapons.every((w) => owned.includes(w));
    case 'slay':
      // The quarry's counts are a run held to the boss wave: only where the tower holds that long as a matter of course.
      return t.kind === 'run' && quarryOpen(profile, t.region)
        && (QUARRY[t.region] ?? []).some((q) => q.enemy === m.enemy && q.n === m.n);
    case 'rule': {
      const r = m.rule;
      switch (r.kind) {
        case 'frame':
          return ownedFrames(profile).includes(r.frame) && r.frame !== profile.frame;
        case 'weapons': {
          if (r.ids.length < 1 || r.ids.length > 3 || !r.ids.every((w) => owned.includes(w))) return false;
          if (new Set(r.ids).size !== r.ids.length) return false;
          // Not every weapon blocked by the opening (§4.2; the cure for Twin Mount's Region 3 wipes).
          const opening = openingTypes(openingOf(profile, c));
          return r.ids.some((id) => !(WEAPON_BY_ID[id].weakAgainst ?? []).some((e) => opening.has(e)));
        }
        case 'slots':
          return (r.passive === 0 && r.weapon === undefined) || (r.passive === undefined && (r.weapon === 1 || r.weapon === 2));
        case 'omen':
          // Act 1's stand-in for heat, in the regions only.
          return !act2Open(profile) && regional(t) && CONTRACT_OMENS.some((o) => o.pact === r.pact && o.rank === r.rank);
        default: {
          const exhaustive: never = r;
          return exhaustive;
        }
      }
    }
    default: {
      const exhaustive: never = m;
      return exhaustive;
    }
  }
}

/** The target alone: open, inside the authored maxima and the player's reach (§3, §4.2). */
function targetValid(profile: Profile, t: ContractTarget): boolean {
  switch (t.kind) {
    case 'boss':
      return regionUnlocked(profile, t.region) && bossDown(profile, regionByIndex(t.region).boss);
    case 'wave':
      return regionUnlocked(profile, t.region) && t.wave >= 5 && t.wave <= 20;
    case 'overtime':
      return regionUnlocked(profile, t.region) && bossDown(profile, regionByIndex(t.region).boss)
        && [5, 10, 15].includes(t.k) && t.k <= Math.max(0, bestWave(profile, t.region) - 20) + 5;
    case 'run':
      return regionUnlocked(profile, t.region);
    case 'floor':
      return act2Open(profile) && t.floor >= 1 && t.floor <= Math.min(BOTTOM, profile.abyss.best + 1);
    case 'guardian':
      return act2Open(profile) && felledGuardians(profile).includes(t.boss) && guardianFloor(t.boss) <= profile.abyss.best + 1;
    case 'rush':
      if (!rushOpen(profile)) return false;
      if (t.within !== null) return t.stages === RUSH_STAGES && profile.rush.time !== null && t.within >= 60;
      return t.stages >= 2 && t.stages <= Math.min(RUSH_STAGES, profile.rush.best + 1);
    default: {
      const exhaustive: never = t;
      return exhaustive;
    }
  }
}

/** Words in a line, as the content lint counts them. */
function words(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

/**
 * Never impossible (§4.2): the target and every modifier valid alone and in
 * pairs, a run's one tally, and the text within R4's fifteen words.
 */
export function valid(profile: Profile, c: ContractSpec): boolean {
  if (!targetValid(profile, c.target) || c.mods.length > 2) return false;
  const owned = ownedWeapons(profile);
  if (!c.mods.every((m) => modValid(profile, c, m, owned))) return false;
  if (c.mods.length === 2 && !compatible(profile, c.target, c.mods[0], c.mods[1])) return false;
  const tallies = c.mods.filter((m) => m.kind === 'untouched' || m.kind === 'slay').length;
  if (c.target.kind === 'run' ? tallies !== 1 : tallies !== 0) return false;
  return words(contractText(c)) <= MAX_TEXT_WORDS;
}

/** Never trivial (§4.2): every card carries a modifier that binds. */
export function trivial(profile: Profile, c: ContractSpec): boolean {
  return c.mods.length === 0 || c.mods.every((m) => modPoints(profile, c, m) <= 0);
}

/**
 * True when a target sits well inside the player's records: a boss felled
 * often enough to count on, a wave or a hold well under the region's best, a
 * floor well above the deepest. The Quick slot draws only these (§3: Quick is
 * the card for a short session, not a wall).
 */
export function comfortable(profile: Profile, t: ContractTarget): boolean {
  switch (t.kind) {
    case 'boss':
      return (profile.bosses[regionByIndex(t.region).boss]?.kills ?? 0) >= C.freshKills;
    case 'wave':
      return bestWave(profile, t.region) - t.wave >= 3;
    case 'overtime':
      return bestWave(profile, t.region) - (20 + t.k) >= 3;
    case 'run':
      return true;
    case 'floor':
      return t.floor <= profile.abyss.best - 2;
    case 'guardian':
      return guardianFloor(t.boss) <= profile.abyss.best - 2;
    case 'rush':
      return t.within === null && t.stages <= profile.rush.best - 1;
    default: {
      const exhaustive: never = t;
      return exhaustive;
    }
  }
}

/** No two cards share a target kind or a place (§4.1). */
function clash(board: readonly ContractSpec[], c: ContractSpec): boolean {
  return board.some((o) => o.id !== c.id && (o.target.kind === c.target.kind || placeOf(o.target) === placeOf(c.target)));
}

// ── Generation (§4.1) ────────────────────────────────────────────────────

/** Target kinds open to this profile now. */
function openKinds(profile: Profile): TargetKind[] {
  const out: TargetKind[] = ['boss', 'wave', 'overtime', 'run'];
  if (act2Open(profile)) {
    out.push('floor');
    if (felledGuardians(profile).some((b) => guardianFloor(b) <= profile.abyss.best + 1)) out.push('guardian');
    if (rushOpen(profile)) out.push('rush');
  }
  return out;
}

/** Regions unlocked, and those whose boss is down. */
function regionsOpen(profile: Profile, felled: boolean): RegionDef[] {
  return REGIONS.filter((r) => regionUnlocked(profile, r.index) && (!felled || bossDown(profile, r.boss)));
}

/** A target of kind `k`, drawn from what is open; null when none is. */
function drawTarget(profile: Profile, rng: Rng, k: TargetKind): ContractTarget | null {
  switch (k) {
    case 'boss': {
      const rs = regionsOpen(profile, true);
      return rs.length ? { kind: 'boss', region: rng.pick(rs).index } : null;
    }
    case 'wave': {
      // Only where the tower has been: never a wave past the region's own best.
      // Nor the record itself: a card rides a handicap, so it asks for a wave the tower passes with room.
      const rs = regionsOpen(profile, false).filter((x) => bestWave(profile, x.index) >= WAVES[0] + WAVE_ROOM);
      if (!rs.length) return null;
      const r = rng.pick(rs);
      const waves = WAVES.filter((w) => w <= bestWave(profile, r.index) - WAVE_ROOM);
      return { kind: 'wave', region: r.index, wave: rng.pick(waves) };
    }
    case 'overtime': {
      const rs = regionsOpen(profile, true);
      if (!rs.length) return null;
      const r = rng.pick(rs);
      const ks = [5, 10, 15].filter((x) => x <= Math.max(0, bestWave(profile, r.index) - 20) + 5);
      return { kind: 'overtime', region: r.index, k: rng.pick(ks) };
    }
    case 'run': {
      const rs = regionsOpen(profile, false).filter((r) => bestWave(profile, r.index) >= UNTOUCHED[0]);
      return rs.length ? { kind: 'run', region: rng.pick(rs).index } : null;
    }
    case 'floor': {
      const best = profile.abyss.best;
      const lo = Math.max(1, best - 3);
      const hi = Math.min(BOTTOM, best + 1);
      return { kind: 'floor', floor: rng.int(lo, hi) };
    }
    case 'guardian': {
      const gs = felledGuardians(profile).filter((b) => guardianFloor(b) <= profile.abyss.best + 1);
      return gs.length ? { kind: 'guardian', boss: rng.pick(gs) } : null;
    }
    case 'rush': {
      const best = profile.rush.best;
      if (profile.rush.time !== null && rng.chance(0.5)) {
        const ratio = rng.pick([1.15, 1, 0.95, 0.9]);
        return { kind: 'rush', stages: RUSH_STAGES, within: Math.max(60, Math.round((profile.rush.time * ratio) / 60) * 60) };
      }
      const hi = Math.min(RUSH_STAGES, best + 1);
      return hi >= 2 ? { kind: 'rush', stages: rng.int(Math.max(2, hi - 3), hi), within: null } : null;
    }
    default: {
      const exhaustive: never = k;
      return exhaustive;
    }
  }
}

/** Every modifier `t` could carry, one draw of each kind (the tallies apart). */
function drawMods(profile: Profile, rng: Rng, t: ContractTarget, owned: readonly WeaponId[]): ContractMod[] {
  const out: ContractMod[] = [];
  if (regional(t)) {
    const region = placeOf(t);
    if (act2Open(profile)) {
      const best = bestHeat(profile, region);
      const lo = Math.max(1, best - 2);
      const hi = Math.min(MAX_HEAT, best + 1);
      if (hi >= lo) out.push({ kind: 'heat', heat: rng.int(lo, hi) });
    } else {
      const o = rng.pick(CONTRACT_OMENS);
      out.push({ kind: 'rule', rule: { kind: 'omen', pact: o.pact, rank: o.rank } });
    }
  }
  if (t.kind === 'boss') {
    const fastest = profile.bosses[regionByIndex(t.region).boss]?.fastest ?? null;
    if (fastest) {
      const seconds = Math.round((fastest * rng.pick([1.4, 1.15, 1, 0.85])) / 5) * 5;
      if (seconds >= C.minWithin) out.push({ kind: 'within', seconds });
    }
    out.push({ kind: 'healthy', pct: rng.pick([50, 70]) });
  }
  out.push({ kind: 'noUlt' });
  if (owned.length) out.push({ kind: 'carry', weapon: rng.pick(owned) });
  const evo = evolvable(profile, owned);
  if (evo.length) out.push({ kind: 'evolve', weapon: rng.pick(evo) });
  const fusions = profile.fusions.filter((f) => FUSION_BY_ID[f as FusionId]) as FusionId[];
  if (fusions.length) out.push({ kind: 'fuse', fusion: rng.pick(fusions) });
  const frames = ownedFrames(profile).filter((f) => f !== profile.frame);
  if (frames.length) out.push({ kind: 'rule', rule: { kind: 'frame', frame: rng.pick(frames) } });
  if (owned.length) {
    const n = Math.min(owned.length, rng.int(1, 3));
    const pool = [...owned];
    const ids: WeaponId[] = [];
    for (let i = 0; i < n; i++) ids.push(pool.splice(rng.int(0, pool.length - 1), 1)[0]);
    out.push({ kind: 'rule', rule: { kind: 'weapons', ids } });
  }
  out.push({ kind: 'rule', rule: rng.pick<TrialRule>([{ kind: 'slots', weapon: 1 }, { kind: 'slots', weapon: 2 }, { kind: 'slots', passive: 0 }]) });
  return out;
}

/** A run target's tally (§3): a clean opening, or a quarry. */
function drawTally(profile: Profile, rng: Rng, t: Extract<ContractTarget, { kind: 'run' }>): ContractMod | null {
  const best = Math.min(20, bestWave(profile, t.region));
  const quarry = quarryOpen(profile, t.region) ? QUARRY[t.region] ?? [] : [];
  const untouched = UNTOUCHED.filter((w) => w <= best);
  if (quarry.length && (untouched.length === 0 || rng.chance(0.5))) {
    const q = rng.pick(quarry);
    return { kind: 'slay', enemy: q.enemy, n: q.n };
  }
  return untouched.length ? { kind: 'untouched', wave: rng.pick(untouched) } : null;
}

/** Shuffle in place with the board's own stream. */
function shuffle<T>(rng: Rng, xs: T[]): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [xs[i], xs[j]] = [xs[j], xs[i]];
  }
  return xs;
}

/** True when `tier` lies in the slot's band. */
function inBand(slot: ContractSlot, tier: number): boolean {
  const [lo, hi] = slotBand(slot);
  return tier >= lo && tier <= hi;
}

/**
 * The fallback (§4.1): "Fell <the last boss cleared>", at the best heat in
 * Act 2, padded by rules until it lands in the slot's band. Should another
 * card hold that kind or place, the next boss back, then a hold to overtime
 * or a wave. In Act 1 only a boss or an overtime reaches the Hard band, so
 * when the other two cards hold both kinds, a last pass shares a kind (never
 * a place).
 */
function fallback(profile: Profile, slot: ContractSlot, id: string, rider: RelicId | null, others: readonly ContractSpec[]): ContractSpec {
  const felled = [...regionsOpen(profile, true)].reverse();
  const targets: ContractTarget[] = [
    ...felled.map((r): ContractTarget => ({ kind: 'boss', region: r.index })),
    ...felled.map((r): ContractTarget => ({ kind: 'overtime', region: r.index, k: 5 })),
    ...[...regionsOpen(profile, false)].reverse().filter((r) => bestWave(profile, r.index) >= WAVES[0] + WAVE_ROOM)
      .map((r): ContractTarget => ({ kind: 'wave', region: r.index, wave: WAVES[0] })),
  ];
  const pads: ContractMod[][] = [
    [],
    [{ kind: 'rule', rule: { kind: 'slots', weapon: 2 } }],
    [{ kind: 'rule', rule: { kind: 'slots', passive: 0 } }],
    [{ kind: 'rule', rule: { kind: 'slots', weapon: 1 } }],
  ];
  let first: ContractSpec | null = null;
  const samePlace = (c: ContractSpec): boolean => others.some((o) => placeOf(o.target) === placeOf(c.target));
  for (const strict of [true, false]) {
    for (const target of targets) {
      // Quick stays inside the records here too.
      if (slot === 'quick' && !comfortable(profile, target)) continue;
      const h = act2Open(profile) ? bestHeat(profile, placeOf(target)) : 0;
      const leads: ContractMod[] = [...(h >= 1 ? [{ kind: 'heat', heat: h } as ContractMod] : []), { kind: 'noUlt' }];
      if (target.kind === 'boss') leads.push({ kind: 'healthy', pct: 70 });
      for (const lead of leads) {
        for (const pad of pads) {
          const c: ContractSpec = { id, slot, target, mods: [lead, ...pad], rider };
          first ??= c;
          if (strict ? clash(others, c) : samePlace(c)) continue;
          if (valid(profile, c) && !trivial(profile, c) && inBand(slot, tierOf(score(profile, c)))) return c;
        }
      }
    }
  }
  return first ?? { id, slot, target: { kind: 'wave', region: 1, wave: 10 }, mods: [{ kind: 'noUlt' }], rider };
}

/** A relic to ride the Hard slot (§4.4): owned, not cursed, below its peak. Null when none is. */
function drawRider(profile: Profile, rng: Rng): RelicId | null {
  const pool = RELICS.filter((r) => !isCursed(r)).filter((r) => {
    const rank = relicRank(profile, r.id);
    return rank >= 1 && rank < BALANCE.relics.maxRank;
  });
  return pool.length ? rng.pick(pool).id : null;
}

/** The board's stream for draw `seq` (§4.1): the profile's birth and a counter, nothing else. */
function boardRng(profile: Profile, label: string, seq: number): Rng {
  return new Rng(hashString(`${label}:${profile.createdAt}:${seq}`));
}

/**
 * Draw a card for `slot`, beside `others`. Takes one `seq`, so the result is
 * deterministic. `rider` is kept (a reroll); `undefined` draws a fresh one
 * for the Hard slot.
 */
export function generate(profile: Profile, slot: ContractSlot, others: readonly ContractSpec[], rider?: RelicId | null): ContractSpec {
  const seq = profile.contracts.seq++;
  const rng = boardRng(profile, 'contract', seq);
  const id = `c${seq}`;
  const ride = slot === 'hard' ? (rider === undefined ? drawRider(profile, rng) : rider) : null;
  const owned = ownedWeapons(profile);
  const kinds = openKinds(profile).filter((k) => !others.some((o) => o.target.kind === k));
  const weights = kinds.map((k) => C.weights[k]);
  for (let attempt = 0; attempt < C.attempts && kinds.length; attempt++) {
    const target = drawTarget(profile, rng, kinds[rng.weighted(weights)]);
    if (!target) continue;
    if (slot === 'quick' && !comfortable(profile, target)) continue;
    const mods: ContractMod[] = [];
    if (target.kind === 'run') {
      const tally = drawTally(profile, rng, target);
      if (!tally) continue;
      mods.push(tally);
    }
    const want = slot === 'quick' ? 1 : slot === 'hard' ? 2 : rng.int(1, 2);
    for (const m of shuffle(rng, drawMods(profile, rng, target, owned))) {
      if (mods.length >= want) break;
      if (mods.every((o) => compatible(profile, target, o, m))) mods.push(m);
    }
    // A lead reads first; the rest keep their draw order.
    mods.sort((a, b) => Number(b.kind === 'evolve' || b.kind === 'fuse') - Number(a.kind === 'evolve' || a.kind === 'fuse'));
    const c: ContractSpec = { id, slot, target, mods, rider: ride };
    if (!inBand(slot, tierOf(score(profile, c)))) continue;
    if (valid(profile, c) && !trivial(profile, c) && !clash(others, c)) return c;
  }
  return fallback(profile, slot, id, ride, others);
}

/** Fill the board's empty slots, once it is open. True when a card was drawn. */
export function ensureBoard(profile: Profile): boolean {
  if (!boardOpen(profile)) return false;
  const board = profile.contracts.board;
  let drawn = false;
  for (const slot of SLOTS) {
    if (board.some((c) => c.slot === slot)) continue;
    board.push(generate(profile, slot, board));
    drawn = true;
  }
  board.sort((a, b) => SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot));
  return drawn;
}

/** The card with this id, if it is on the board. */
export function contractById(profile: Profile, id: string | null): ContractSpec | null {
  return id === null ? null : profile.contracts.board.find((c) => c.id === id) ?? null;
}

/** Replace the card in `c`'s slot with `next`, unpinning the old one. */
function replace(profile: Profile, c: ContractSpec, next: ContractSpec): void {
  const B = profile.contracts;
  B.board = B.board.map((x) => (x.id === c.id ? next : x));
  if (B.pinned === c.id) B.pinned = null;
  if (B.taken === c.id) B.taken = null;
}

/**
 * Reroll a card, free (§4.3): its slot's band and its rider stay; only the
 * target and modifiers change. False for a card not on the board.
 */
export function reroll(profile: Profile, id: string): boolean {
  const c = contractById(profile, id);
  if (!c) return false;
  const others = profile.contracts.board.filter((x) => x.id !== id);
  replace(profile, c, generate(profile, c.slot, others, c.rider));
  return true;
}

/** Pin a card to the Next line, or unpin it (§2: only one at a time). */
export function pin(profile: Profile, id: string): boolean {
  if (!contractById(profile, id)) return false;
  profile.contracts.pinned = profile.contracts.pinned === id ? null : id;
  return true;
}

/** The heat a card needs set before Take (§2); 0 when none. */
export function heatNeeded(c: ContractSpec): number {
  for (const m of c.mods) if (m.kind === 'heat') return m.heat;
  return 0;
}

/** Why Take is disabled, or null when it isn't: today, only heat not yet set. */
export function takeBlocked(profile: Profile, c: ContractSpec): string | null {
  const need = heatNeeded(c);
  return need > heat(profile) ? `Needs heat ${need}; yours is ${heat(profile)}` : null;
}

/**
 * Take a card (§4.5): the next run is its, in its place, and no Trial. In
 * the Abyss the descent starts at the deepest waypoint at or above its
 * floor. False, and nothing changes, when it can't be taken.
 */
export function takeContract(profile: Profile, id: string): boolean {
  const c = contractById(profile, id);
  if (!c || !boardOpen(profile) || takeBlocked(profile, c) !== null || !targetValid(profile, c.target)) return false;
  const B = profile.contracts;
  // Where the player was, to go back to once the card's run is banked. A Retry
  // (a Take straight after a settle) finds it already restored.
  B.back = { region: profile.region, start: profile.abyss.start };
  B.taken = id;
  profile.trial = null;
  profile.region = placeOf(c.target);
  if (profile.region === ABYSS_INDEX) profile.abyss.start = contractStart(profile, c);
  return true;
}

/**
 * A card's run is a detour: once it is banked, the next run goes back to
 * where the player was (the region, and the Abyss's waypoint), so Run again
 * and auto-restart never farm the card's place by accident.
 */
function goBack(profile: Profile, ran: boolean): void {
  const B = profile.contracts;
  const back = B.back ?? null;
  B.back = null;
  if (!ran || !back) return;
  profile.abyss.start = back.start;
  if (regionUnlocked(profile, back.region)) profile.region = back.region;
}

/** The card the next run is taken for, while it is still in its place; null for an ordinary run. */
export function takenContract(profile: Profile): ContractSpec | null {
  const c = contractById(profile, profile.contracts.taken);
  return c && profile.region === placeOf(c.target) && regionUnlocked(profile, profile.region) ? c : null;
}

/**
 * The weapon a card's run starts with, mounted (§4.5): the one it asks to
 * carry or evolve, or a fusion's first half. A card that names a weapon
 * hands it over, so the ask is a plan from wave 1 and never waits on the
 * draft's luck; null leaves the frame's (or a `weapons` rule's first).
 */
export function contractLead(c: ContractSpec | null): WeaponId | null {
  for (const m of c?.mods ?? []) if (m.kind === 'carry') return m.weapon;
  for (const m of c?.mods ?? []) if (m.kind === 'evolve') return m.weapon;
  for (const m of c?.mods ?? []) if (m.kind === 'fuse') return FUSION_BY_ID[m.fusion].weapons[0];
  return null;
}

/** A card's rules, for `buildRunConfig` (§4.5): the Trial rules among its modifiers. */
export function contractRules(c: ContractSpec | null): TrialRule[] {
  return (c?.mods ?? []).flatMap((m) => (m.kind === 'rule' ? [m.rule] : []));
}

// ── Checking and settling (§4.5) ─────────────────────────────────────────

/** Whether a finished run met a card, and if not, the first reason why. */
export interface ContractCheck {
  met: boolean;
  why: string | null;
}

const pct = (x: number): string => `${Math.round(x * 100)}%`;

/**
 * Check a finished run against a card: the exhaustive consumer of targets
 * and modifiers. Rules hold by the run's config, so they always pass here.
 */
export function contractMet(c: ContractSpec, run: RunState): ContractCheck {
  const fail = (why: string): ContractCheck => ({ met: false, why });
  const wave = run.outcome?.wave ?? run.wave;
  if (run.regionId !== placeOf(c.target)) return fail('it ran somewhere else');
  const t = c.target;
  switch (t.kind) {
    case 'boss': {
      const boss = regionByIndex(t.region).boss;
      if (run.boss?.id !== boss || run.boss.killedIn === null) return fail(`${midSentence(BOSS_BY_ID[boss].name)} still stands`);
      break;
    }
    case 'wave':
      if (wave < t.wave) return fail(`wave ${wave} of ${t.wave}`);
      break;
    case 'overtime':
      if (wave < 20 + t.k) return fail(`wave ${wave} of ${20 + t.k}`);
      break;
    case 'run':
      break;
    case 'floor':
      if (run.floors < t.floor) return fail(`floor ${run.floors} of ${t.floor}`);
      break;
    case 'guardian':
      if (!run.felled.includes(t.boss)) return fail(`${midSentence(BOSS_BY_ID[t.boss].name)} still stands`);
      break;
    case 'rush':
      if (run.felled.length < t.stages) return fail(`${run.felled.length} of ${t.stages} stages`);
      if (t.within !== null) {
        const time = run.outcome?.kind === 'cleared' ? run.outcome.time : null;
        if (time === null || time > t.within) return fail(time === null ? 'not cleared' : `the clear took ${formatDuration(time)}`);
      }
      break;
    default: {
      const exhaustive: never = t;
      return exhaustive;
    }
  }
  for (const m of c.mods) {
    switch (m.kind) {
      case 'heat': {
        const h = pactLoad(run.pacts).heat;
        if (h < m.heat) return fail(`heat ${h}, not ${m.heat}`);
        break;
      }
      case 'within':
        if (run.boss?.killedIn == null || run.boss.killedIn > m.seconds) {
          return fail(run.boss?.killedIn == null ? 'the boss stood' : `it fell in ${Math.round(run.boss.killedIn)} s`);
        }
        break;
      case 'healthy':
        if (!run.boss || run.boss.minHp < m.pct / 100) return fail(`the tower fell to ${pct(run.boss?.minHp ?? 0)} HP`);
        break;
      case 'noUlt':
        if (run.ult.casts > 0) return fail('the ultimate was cast');
        break;
      case 'untouched':
        if (wave < m.wave) return fail(`wave ${wave} of ${m.wave}`);
        if (run.firstHurtWave !== null && run.firstHurtWave < m.wave) return fail(`hit in wave ${run.firstHurtWave}`);
        break;
      case 'carry': {
        const total = Object.values(run.damageBy).reduce((s, n) => s + (n ?? 0), 0);
        const mine = run.damageBy[m.weapon] ?? 0;
        if (total <= 0 || mine < total * 0.5) return fail(`${WEAPON_BY_ID[m.weapon].name} dealt ${pct(total > 0 ? mine / total : 0)}`);
        break;
      }
      case 'evolve':
        if (!run.evolved.includes(EVOLUTION_OF[m.weapon]?.id)) return fail(`${WEAPON_BY_ID[m.weapon].name} never evolved`);
        break;
      case 'fuse':
        if (!run.fused.includes(m.fusion)) return fail(`${FUSION_BY_ID[m.fusion].name} was never made`);
        break;
      case 'slay': {
        const n = m.enemy === 'elite' ? run.elitesKilled : run.killsBy[m.enemy] ?? 0;
        if (n < m.n) return fail(`${n} of ${m.n} ${m.enemy === 'elite' ? 'elites' : ENEMY_BY_ID[m.enemy].name}`);
        break;
      }
      case 'rule':
        // Enforced by the run's config: the draft never offered what it forbids.
        break;
      default: {
        const exhaustive: never = m;
        return exhaustive;
      }
    }
  }
  return { met: true, why: null };
}

/** What a settled contract came to, for the results screen. */
export interface ContractSettled {
  id: string;
  text: string;
  met: boolean;
  /** Why it wasn't met; null when it was. */
  why: string | null;
  /** What it paid: shards, Starlight after the Stargazers, the tier. Null when unmet. */
  pay: ContractPay | null;
  /** The rider (§4.4), in words. */
  rider: string | null;
  /** A milestone reached (§4.4), in words. */
  milestone: string | null;
  /** The card that took its place. */
  next: string | null;
}

/** A relic rank paid, in words. */
function relicLine(profile: Profile, id: RelicId): string {
  const rank = gainRelic(profile, id);
  const name = RELIC_BY_ID[id].name;
  return rank === 0 ? `${name} · already at its peak` : `${name} · ${rank === 1 ? 'new relic' : `rank ${'I'.repeat(rank)}`}`;
}

/** The milestone `done` completions reach (§4.4): a trim, then a relic rank every `relicEvery`. */
function milestone(profile: Profile, done: number): string | null {
  const trim = CONTRACT_TRIMS.find((t) => t.at === done);
  if (trim) return `Tower trim: ${trim.name} (cosmetic)`;
  const last = CONTRACT_TRIMS[CONTRACT_TRIMS.length - 1].at;
  if (done <= last || (done - last) % C.milestones.relicEvery !== 0) return null;
  const relic = drawRider(profile, boardRng(profile, 'milestone', done));
  return relic ? `${done} contracts · ${relicLine(profile, relic)}` : null;
}

/**
 * The tier a run's card would pay at, read before the run's own records are
 * banked (§3: pay follows the score at payout; a record this very run broke
 * must not cut its own pay). Null for a run not taken for a card.
 */
export function pendingTier(profile: Profile, run: RunState): 1 | 2 | 3 | 4 | null {
  const c = run.contract ? contractById(profile, run.contract) : null;
  return c ? contractTier(profile, c) : null;
}

/**
 * Settle the card a run was taken for (§4.5): met, it pays, counts, may
 * reach a milestone, and a fresh card takes its slot; either way the next
 * run is ordinary. Null for a run not taken for a card.
 */
export function settleContract(profile: Profile, run: RunState, tier: 1 | 2 | 3 | 4 | null): ContractSettled | null {
  const B = profile.contracts;
  const c = run.contract ? contractById(profile, run.contract) : null;
  B.taken = null;
  goBack(profile, c !== null);
  if (!c) return null;
  const check = contractMet(c, run);
  const text = contractText(c);
  if (!check.met) return { id: c.id, text, met: false, why: check.why, pay: null, rider: null, milestone: null, next: null };
  const pay = contractPay(profile, tier ?? contractTier(profile, c));
  profile.shards += pay.shards;
  pay.starlight = payStarlight(profile, pay.starlight);
  const rider = c.rider ? relicLine(profile, c.rider) : null;
  B.done++;
  const reached = milestone(profile, B.done);
  const next = generate(profile, c.slot, B.board.filter((x) => x.id !== c.id));
  replace(profile, c, next);
  return { id: c.id, text, met: true, why: null, pay, rider, milestone: reached, next: contractText(next) };
}

/** The trims the board's milestones have paid (§4.4), for the tower and the Collection. */
export function contractTrims(profile: Profile): { trim: TrimId; name: string }[] {
  return CONTRACT_TRIMS.filter((t) => profile.contracts.done >= t.at).map((t) => ({ trim: t.trim, name: t.name }));
}
