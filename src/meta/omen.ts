import { hashString, Rng } from '../core/rng';
import { BALANCE } from '../content/balance';
import { PHONE_OVAL } from '../content/arena';
import { BOSSES } from '../content/bosses';
import { ENEMIES } from '../content/enemies';
import { EVOLUTIONS } from '../content/evolutions';
import { FORGE } from '../content/forge';
import { FRAMES, frameById } from '../content/frames';
import { FUSIONS, FUSION_BY_ID } from '../content/fusions';
import { OMEN_MODS, OMEN_MOD_BY_ID, OMEN_SIM, OMEN_TRIMS } from '../content/omens';
import { PACTS } from '../content/pacts';
import { PASSIVES } from '../content/passives';
import { ACT1_REGIONS, REGIONS, regionByIndex } from '../content/regions';
import { RELICS, RELIC_BY_ID } from '../content/relics';
import { STARS } from '../content/stars';
import { WEAPONS, WEAPON_BY_ID } from '../content/weapons';
import type {
  BehaviourId, CardItemId, Effect, FrameId, FusionId, OmenModDef, OmenRule, PactId, StatMod, TrialRule, TrimId, WeaponId,
} from '../content/types';
import { SIM_DT } from '../app/loop';
import { applyInput, createRun, noteResume, omenInput, openingTypes, step } from '../sim/run';
import { BOSS_WAVE } from '../sim/systems/waves';
import type { RunConfig, RunState } from '../sim/state';
import { act2Open } from './collection';
import { newProfile, type OmenDay, type Profile } from './profile';
import { buildRunConfig } from './runConfig';
import { payStarlight } from './stars';

/**
 * The Daily Omen (plans/late-game/11): one run a day, built from the local
 * date alone, so two friends on the same date fight the same place, rules
 * and waves with the same tower, and compare a short code, all offline.
 *
 * Pure functions: the day's roll and its config read no profile; the
 * profile is read only for what has been played and paid.
 */

const DAY_MS = 86_400_000;
/** 2000-01-01 as a day number: the code's day field counts from it. */
export const CODE_EPOCH = Date.UTC(2000, 0, 1) / DAY_MS;

// ── The day ─────────────────────────────────────────────────────────────

/**
 * The device's local calendar date as a whole day number since 1970-01-01
 * (§4.1). Local, never UTC: a day starts at the player's own midnight.
 */
export function omenDay(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Sat 14 Nov", from fixed English tables (never `toLocale*`), so a line reads the same on every device. */
export function omenLabel(n: number): string {
  const d = new Date(n * DAY_MS);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** The day's own stream: its rules and its run's seed split from it (§4.1). */
function dayRng(n: number): Rng {
  return new Rng(hashString(`omen/${n}`));
}

/** The seed the day's run plays: everyone on the date plays this one. */
export function omenSeed(n: number): number {
  return dayRng(n).split('run').nextU32();
}

/** A shuffle of `items` seeded by `label`: Fisher–Yates on its own stream. */
function shuffled<T>(items: readonly T[], label: string): T[] {
  const rng = new Rng(hashString(label));
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * A six-day cycle (§4.1): block ⌊n / 6⌋ seeds a shuffle, so each entry comes
 * once in six days. If a block would open on the one the last closed on,
 * its first two swap, so no entry plays two days running across the seam.
 */
function cycle<T>(items: readonly T[], n: number, label: string): T {
  const size = items.length;
  const block = Math.floor(n / size);
  const order = shuffled(items, `omen/${label}/${block}`);
  const prev = shuffled(items, `omen/${label}/${block - 1}`);
  if (prev[size - 1] === order[0]) [order[0], order[1]] = [order[1], order[0]];
  return order[((n % size) + size) % size];
}

/**
 * The region of day `n`. Before `BALANCE.omen.wakeFrom`, every Act 1 region
 * once in six days, exactly as before the Wake, so old codes still name their
 * region. From it, every region once in eleven days, on its own shuffle
 * (plans/late-game/12 §8.10). The seam may repeat a region for two days.
 */
export function omenRegion(n: number): number {
  if (n < BALANCE.omen.wakeFrom) return cycle(ACT1_REGIONS.map((r) => r.index), n, 'region');
  return cycle(REGIONS.map((r) => r.index), n, 'region-wake');
}

/** The frame of day `n`: every frame once in six days. */
export function omenFrame(n: number): FrameId {
  return cycle(FRAMES.map((f) => f.id as FrameId), n, 'frame');
}

// ── The roll ────────────────────────────────────────────────────────────

/** A day's Omen (§4.1): where, with what, and under which modifiers. */
export interface OmenRoll {
  day: number;
  label: string;
  seed: number;
  region: number;
  frame: FrameId;
  /** The day's weapons, the frame's first. */
  pool: WeaponId[];
  boon: string;
  /** Null when eight draws all clashed and the twist was dropped. */
  twist: string | null;
  /** The pacts as omens, by rank. */
  banes: { id: string; rank: number }[];
  /** banes + twist + boon: within `BALANCE.omen.points`. */
  points: number;
}

const BOONS = OMEN_MODS.filter((m) => m.slot === 'boon');
const TWISTS = OMEN_MODS.filter((m) => m.slot === 'twist');
const BANES = OMEN_MODS.filter((m) => m.slot === 'bane');

function weighted(rng: Rng, mods: readonly OmenModDef[]): OmenModDef {
  return mods[rng.weighted(mods.map((m) => m.weight))];
}

/** True when two modifiers never share a day: either names the other. */
function clashes(a: OmenModDef, b: OmenModDef): boolean {
  return (a.clashes ?? []).includes(b.id) || (b.clashes ?? []).includes(a.id);
}

/** The fusion a boon lights, if any. */
function fusionOf(mod: OmenModDef): FusionId | null {
  for (const r of mod.rules) if (r.kind === 'fusion') return r.id;
  return null;
}

/** A bane's highest rank in an Omen. */
function baneCap(mod: OmenModDef): number {
  return Math.min(mod.maxRank ?? BALANCE.omen.maxRank, BALANCE.omen.maxRank);
}

/**
 * The validity test (§4.1), as `twinSpares` reads the opening: some pool
 * weapon counters a type the region opens with, and not every one is
 * blunted by one.
 */
export function poolAnswers(pool: readonly WeaponId[], region: number): boolean {
  const opening = openingTypes(regionByIndex(region));
  const counters = pool.some((id) => WEAPON_BY_ID[id].counters.some((e) => opening.has(e)));
  const blunted = pool.every((id) => (WEAPON_BY_ID[id].weakAgainst ?? []).some((e) => opening.has(e)));
  return counters && !blunted;
}

/** One draw from the rules stream: boon, twist, pool. */
function drawDay(rng: Rng, frame: FrameId, twisted: boolean): { boon: OmenModDef; twist: OmenModDef | null; pool: WeaponId[] } {
  const boon = weighted(rng, BOONS);
  const twists = TWISTS.filter((t) => !clashes(t, boon));
  const twist = twisted && twists.length > 0 ? weighted(rng, twists) : null;
  const first = frameById(frame).startingWeapon;
  const pool: WeaponId[] = [first];
  // A fusion boon's two weapons are forced in first, replacing drawn ones.
  const fusion = fusionOf(boon);
  if (fusion) for (const id of FUSION_BY_ID[fusion].weapons) if (!pool.includes(id)) pool.push(id);
  const rest = WEAPONS.map((w) => w.id).filter((id) => !pool.includes(id));
  while (pool.length < BALANCE.omen.pool && rest.length > 0) pool.push(rest.splice(rng.int(0, rest.length - 1), 1)[0]);
  return { boon, twist, pool };
}

const ROLLS = new Map<number, OmenRoll>();

/**
 * Day `n`'s Omen (§4.1). Region and frame come from their six-day cycles;
 * the boon, twist, pool and banes from the day's `rules` stream, redrawn
 * from the same stream while invalid (the twist dropped after
 * `BALANCE.omen.redraws`). Memoised: the roll is the same every time.
 */
export function rollOmen(n: number): OmenRoll {
  const hit = ROLLS.get(n);
  if (hit) return hit;
  const root = dayRng(n);
  const rng = root.split('rules');
  const region = omenRegion(n);
  const frame = omenFrame(n);
  let day = drawDay(rng, frame, true);
  for (let i = 1; !poolAnswers(day.pool, region) && i < 64; i++) day = drawDay(rng, frame, i < BALANCE.omen.redraws);
  // Banes until the points reach the day's target, each pact under its cap.
  const [lo, hi] = BALANCE.omen.points;
  const target = rng.int(lo, hi);
  const ranks = new Map<string, number>();
  let points = day.boon.points + (day.twist?.points ?? 0);
  while (points < target) {
    const open = BANES.filter((b) => (ranks.get(b.id) ?? 0) < baneCap(b));
    if (open.length === 0) break;
    const b = weighted(rng, open);
    ranks.set(b.id, (ranks.get(b.id) ?? 0) + 1);
    points += b.points;
  }
  const roll: OmenRoll = {
    day: n,
    label: omenLabel(n),
    seed: root.split('run').nextU32(),
    region,
    frame,
    pool: day.pool,
    boon: day.boon.id,
    twist: day.twist?.id ?? null,
    banes: BANES.filter((b) => ranks.has(b.id)).map((b) => ({ id: b.id, rank: ranks.get(b.id)! })),
    points,
  };
  ROLLS.set(n, roll);
  return roll;
}

/** The day's modifiers in the order the card lists them: boon, twist, banes. */
export function omenMods(roll: OmenRoll): { def: OmenModDef; rank: number }[] {
  return [
    { def: OMEN_MOD_BY_ID[roll.boon], rank: 1 },
    ...(roll.twist ? [{ def: OMEN_MOD_BY_ID[roll.twist], rank: 1 }] : []),
    ...roll.banes.map((b) => ({ def: OMEN_MOD_BY_ID[b.id], rank: b.rank })),
  ];
}

// ── The config ──────────────────────────────────────────────────────────

/**
 * The Omen's tower (§4.3): a fresh profile with the Forge bought out to the
 * region's ring, keystones and masteries aside, past the first-draft lesson.
 * Nothing in it is the player's.
 */
function omenProfile(roll: OmenRoll): Profile {
  const p = newProfile(0);
  p.tutorial.firstDraft = true;
  const ring = BALANCE.omen.ring[roll.region] ?? 0;
  for (const node of FORGE) if (node.type !== 'keystone' && node.type !== 'mastery' && node.ring <= ring) p.forge[node.id] = node.maxLevel;
  for (const id of BALANCE.omen.stars[roll.region] ?? []) {
    const star = STARS.find((s) => s.id === id);
    if (star) p.stars[id] = star.maxLevel;
  }
  // A keystone twist is set for the day, owned or not.
  for (const { def } of omenMods(roll)) for (const r of def.rules) if (r.kind === 'keystone') p.forge[r.id] = 1;
  return p;
}

/** Fold a lent or riding relic's effects (§5): a stat is a mod, a behaviour a level. Nothing else reaches a run. */
function foldEffects(effects: readonly Effect[], mods: StatMod[], behaviours: Partial<Record<BehaviourId, number>>): void {
  for (const e of effects) {
    if (e.kind === 'stat') mods.push(e.mod);
    else if (e.kind === 'behaviour') behaviours[e.id] = (behaviours[e.id] ?? 0) + 1;
  }
}

/**
 * Day `n`'s `RunConfig` (§4.3): profile-free, so a player who just reached
 * Act 2 and one with every star lit get deep-equal configs. Every field the
 * siblings read from a profile is fixed here: rifts at Act 2's rates with
 * an empty journal, no anomaly unless a boon deals one, no secrets, no
 * reliquaries, no relic drops, no first kill, the phone's oval.
 */
export function omenConfig(n: number, practice = false): RunConfig {
  const roll = rollOmen(n);
  const rules: TrialRule[] = [{ kind: 'frame', frame: roll.frame }, { kind: 'weapons', ids: roll.pool }];
  const mods: StatMod[] = [];
  const behaviours: Partial<Record<BehaviourId, number>> = {};
  const fusions: FusionId[] = [];
  let riftRate: number | undefined;
  let anomaly = 0;
  for (const b of roll.banes) {
    const pact = OMEN_MOD_BY_ID[b.id].pact as PactId;
    rules.push({ kind: 'omen', pact, rank: b.rank });
  }
  for (const { def } of omenMods(roll)) {
    for (const r of def.rules) {
      const rule = r as OmenRule;
      switch (rule.kind) {
        case 'frame':
        case 'weapons':
        case 'slots':
        case 'omen':
          rules.push(rule);
          break;
        case 'keystone':
          // Bought on the Omen's profile (`omenProfile`).
          break;
        case 'fusion':
          if (!fusions.includes(rule.id)) fusions.push(rule.id);
          break;
        case 'relic': {
          const relic = RELIC_BY_ID[rule.relic];
          foldEffects(relic.effects, mods, behaviours);
          for (let i = 1; i < rule.rank; i++) foldEffects(relic.perRank, mods, behaviours);
          foldEffects(relic.curse?.effects ?? [], mods, behaviours);
          break;
        }
        case 'level':
          behaviours['extra-level'] = (behaviours['extra-level'] ?? 0) + rule.n;
          break;
        case 'rifts':
          riftRate = rule.rate;
          break;
        case 'anomaly':
          anomaly = rule.chance;
          break;
        default: {
          const exhaustive: never = rule;
          return exhaustive;
        }
      }
    }
  }
  const base = buildRunConfig(omenProfile(roll), rules);
  // Every passive the normal rule admits for the pool, the starred ones too (§4.1).
  const pool: CardItemId[] = [...base.pool];
  for (const p of PASSIVES) {
    if (p.starred && !pool.includes(p.id) && (!p.joinsWith || pool.includes(p.joinsWith))) pool.push(p.id);
  }
  const merged: Partial<Record<BehaviourId, number>> = { ...base.behaviours };
  for (const [id, k] of Object.entries(behaviours) as [BehaviourId, number][]) merged[id] = (merged[id] ?? 0) + k;
  return Object.freeze({
    ...base,
    regionId: roll.region,
    trial: null,
    contract: null,
    mods: Object.freeze([...base.mods, ...mods]),
    pool: Object.freeze(pool),
    firstDraft: null,
    behaviours: Object.freeze(merged),
    firstKill: false,
    relicDrops: false,
    // Every recipe, so the suggestion is at its best for everyone.
    recipes: Object.freeze(EVOLUTIONS.map((e) => e.id)),
    fusions: Object.freeze([...(base.fusions ?? []), ...fusions.filter((f) => !base.fusions?.includes(f))]),
    priority: null,
    never: null,
    abyssRelics: Object.freeze([]),
    rifts: Object.freeze({ first: false, known: Object.freeze([]), act2: true, ...(riftRate !== undefined ? { rate: riftRate } : {}) }),
    reliquaries: null,
    anomaly: anomaly > 0 ? Object.freeze({ chance: anomaly }) : null,
    secrets: null,
    arena: PHONE_OVAL,
    omen: Object.freeze({ day: n, practice }),
  });
}

// ── What the profile holds ──────────────────────────────────────────────

/** The Omen opens with Act 2 (R6): Act 1 has no daily clock. */
export function omenOpen(profile: Profile): boolean {
  return act2Open(profile);
}

/**
 * Note the day the Omen first opened (§4.2): no date before it ever pays,
 * so moving the clock back never earns more than a daily player.
 */
export function openOmen(profile: Profile, now: number): void {
  if (omenOpen(profile) && profile.omen.since === 0) profile.omen.since = omenDay(now);
}

/** The days a scored try may be played on (§4.2): today and yesterday, the grace day. */
export function scoredDays(now: number): number[] {
  const today = omenDay(now);
  return [today, today - 1];
}

/** True when day `n`'s scored try is still free: never banked, and not before the Omen opened. */
export function scoredFree(profile: Profile, n: number): boolean {
  const since = profile.omen.since;
  return omenOpen(profile) && since > 0 && n >= since && !profile.omen.days[n]?.score;
}

/** True when a run of day `n` started now would be the scored one (§4.5): today or yesterday, still free. */
export function scoredNow(profile: Profile, n: number, now: number): boolean {
  return scoredDays(now).includes(n) && scoredFree(profile, n);
}

/** The home button's dot (§2): today's scored try is still free. */
export function omenDot(profile: Profile, now: number): boolean {
  return scoredFree(profile, omenDay(now));
}

/** Mark a run starting for day `n` (§4.5), as `profile.trial` marks a Trial. Practice unless its scored try is free. */
export function beginOmen(profile: Profile, n: number, now: number): { day: number; practice: boolean } {
  const pending = { day: n, practice: !scoredNow(profile, n, now) };
  profile.omen.pending = pending;
  return pending;
}

/**
 * At boot (§4.5): a scored run whose snapshot was lost (an update dropped
 * it) leaves the scored try open again. Rare, and not worth punishing.
 */
export function settlePending(profile: Profile, resumed: RunState | null): void {
  const p = profile.omen.pending;
  if (!p) return;
  if (resumed?.omen && resumed.omen.day === p.day) return;
  profile.omen.pending = null;
}

/** The band a wave reaches (§4.4): 0 before the boss falls; I, II, III for overtime held. */
export function omenBand(wave: number): number {
  if (wave <= BOSS_WAVE) return 0;
  const held = wave - BOSS_WAVE - 1;
  return BALANCE.omen.bands.filter((b) => held >= b).length;
}

/** "●●○": a band as dots. */
export function bandDots(band: number): string {
  const n = BALANCE.omen.bands.length;
  return '●'.repeat(band) + '○'.repeat(Math.max(0, n - band));
}

/** The Starlight a scored try pays (§4.3), before the Stargazers: the base, and the band's. */
export function omenStarlight(band: number): number {
  const S = BALANCE.omen.starlight;
  return band > 0 ? S.base + S.band[band - 1] : S.base;
}

/** The Omen's trims (§5): the Augur's Veil after seven scored Omens, Starfall from the first band III. */
export function omenTrims(profile: Profile): { trim: TrimId; name: string }[] {
  const out: { trim: TrimId; name: string }[] = [];
  const [veil, starfall] = OMEN_TRIMS;
  if (profile.omen.played >= BALANCE.omen.trims.played) out.push({ trim: veil.trim, name: veil.name });
  if (profile.omen.best >= BALANCE.omen.bands.length) out.push({ trim: starfall.trim, name: starfall.name });
  return out;
}

/** What an Omen banked (§4.8), for the results screen. */
export interface OmenBanked {
  day: number;
  label: string;
  region: number;
  wave: number;
  kills: number;
  band: number;
  practice: boolean;
  /** Starlight paid, after the Stargazers; 0 for practice. */
  starlight: number;
  /** The day's score when this was practice: what stands. */
  standing: { wave: number; kills: number } | null;
  /** The practice best, when this was practice. */
  best: { wave: number; kills: number } | null;
  /** Trims earned by this run. */
  trims: string[];
  /** The line Copy result puts on the clipboard. */
  line: string;
}

/** Keep `keep` days of history (§4.3); the floor rises with what is dropped, so a dropped day never pays again. */
function prune(profile: Profile): void {
  const O = profile.omen;
  const days = Object.keys(O.days).map(Number);
  if (days.length === 0) return;
  const floor = Math.max(...days) - BALANCE.omen.keep;
  for (const d of days) if (d <= floor) delete O.days[d];
  if (days.some((d) => d <= floor)) O.since = Math.max(O.since, floor + 1);
}

/**
 * Bank an Omen run (§4.8): only what is harmless. The run count, lifetime
 * kills and the Bestiary's sightings carry over; the day's score, its
 * Starlight and a trim when one is earned. Shards, records, trophies, the
 * farm rate, relics, feats, recipes, fusions, the rift journal and the
 * Foreman are left as they were: the Omen is a sealed room.
 */
export function bankOmen(profile: Profile, run: RunState): OmenBanked {
  const omen = run.omen!;
  const n = omen.day;
  const wave = run.outcome?.wave ?? run.wave;
  const kills = run.kills;
  const band = omenBand(wave);
  const r = profile.records;
  r.runs++;
  r.kills += run.kills;
  for (const [type, k] of Object.entries(run.killsBy)) profile.killsBy[type] = (profile.killsBy[type] ?? 0) + (k ?? 0);
  const known = new Set(profile.seenEnemies);
  profile.seenEnemies.push(...run.seen.filter((id) => !known.has(id)));

  const O = profile.omen;
  O.pending = null;
  const trimsBefore = omenTrims(profile).map((t) => t.trim as string);
  const scored = !omen.practice && scoredFree(profile, n);
  const day: OmenDay = (O.days[n] ??= { score: null, practice: null });
  let starlight = 0;
  if (scored) {
    starlight = payStarlight(profile, omenStarlight(band));
    day.score = { wave, kills, resumes: omen.resumes, starlight };
    O.played++;
    O.best = Math.max(O.best, band);
  } else {
    const p = day.practice;
    if (!p || better({ wave, kills }, p)) day.practice = { wave, kills };
  }
  prune(profile);
  const trims = omenTrims(profile).filter((t) => !trimsBefore.includes(t.trim)).map((t) => t.name);
  return {
    day: n,
    label: omenLabel(n),
    region: run.regionId,
    wave,
    kills,
    band,
    practice: !scored,
    starlight,
    standing: !scored && day.score ? { wave: day.score.wave, kills: day.score.kills } : null,
    best: !scored ? day.practice : null,
    trims,
    line: resultLine(n, wave, kills, omen.resumes, !scored),
  };
}

/** True when `a` beats `b`: the wave, then kills. */
export function better(a: { wave: number; kills: number }, b: { wave: number; kills: number }): boolean {
  return a.wave !== b.wave ? a.wave > b.wave : a.kills > b.kills;
}

/** The player's own last days (§2's strip), oldest first: the wave for each, null for a day not played. */
export function omenHistory(profile: Profile, today: number, days = 7): { day: number; wave: number | null }[] {
  const out: { day: number; wave: number | null }[] = [];
  for (let d = today - days + 1; d <= today; d++) out.push({ day: d, wave: profile.omen.days[d]?.score?.wave ?? null });
  return out;
}

/** The best scored wave per region, from the days kept (Open 9). */
export function omenBests(profile: Profile): Partial<Record<number, number>> {
  const out: Partial<Record<number, number>> = {};
  for (const [d, rec] of Object.entries(profile.omen.days)) {
    if (!rec.score) continue;
    const region = rollOmen(Number(d)).region;
    out[region] = Math.max(out[region] ?? 0, rec.score.wave);
  }
  return out;
}

// ── The share code ──────────────────────────────────────────────────────

/** Crockford base32: no I, L, O or U. */
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_KEY = 'omen/3f9a-11d7-share';
const FORMAT = 1;

let TAG: number | null = null;

/**
 * The rules tag (§4.6): every table the run reads, folded to 16 bits, with
 * `OMEN_SIM` bumped by hand for sim code. Two builds that differ in it may
 * play the same day differently.
 */
export function rulesTag(): number {
  if (TAG !== null) return TAG;
  const tables = [BALANCE, OMEN_MODS, WEAPONS, PASSIVES, ENEMIES, REGIONS, BOSSES, FORGE, FRAMES, EVOLUTIONS, FUSIONS, PACTS, RELICS];
  const h = hashString(`${OMEN_SIM}|${JSON.stringify(tables)}`);
  TAG = (h ^ (h >>> 16)) & 0xffff;
  return TAG;
}

/** A keyed 20-bit check over the payload's bits, as the save's seal is keyed (`meta/save/seal.ts`). */
function check(bits: string): number {
  const h = hashString(`${CODE_KEY}|${bits}`);
  const g = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  return (g ^ (g >>> 12)) & 0xfffff;
}

function field(value: number, width: number): string {
  return Math.max(0, Math.min(2 ** width - 1, Math.floor(value))).toString(2).padStart(width, '0');
}

/** A decoded result code (§4.6). */
export interface OmenResult {
  /** Day number since 1970-01-01. */
  day: number;
  wave: number;
  kills: number;
  /** 7 means 7 or more. */
  resumes: number;
  practice: boolean;
  /** False when the code came from another build: the runs may differ. */
  sameRules: boolean;
}

/** A result as its 18-character code, "7KQ3FX-9QX2MA-0PZ4RT" (90 bits). */
export function encodeResult(r: Omit<OmenResult, 'sameRules'>): string {
  const payload = field(FORMAT, 4) + field(rulesTag(), 16) + field(r.day - CODE_EPOCH, 16) + field(r.wave, 10)
    + field(r.kills, 20) + field(Math.min(7, r.resumes), 3) + field(r.practice ? 1 : 0, 1);
  const bits = payload + field(check(payload), 20);
  let out = '';
  for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return `${out.slice(0, 6)}-${out.slice(6, 12)}-${out.slice(12)}`;
}

/** Read a code back: case and Crockford's look-alikes don't matter. Null when it doesn't check. */
export function decodeResult(code: string): OmenResult | null {
  const clean = code.toUpperCase().replace(/-/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
  if (clean.length !== 18) return null;
  let bits = '';
  for (const ch of clean) {
    const v = B32.indexOf(ch);
    if (v < 0) return null;
    bits += v.toString(2).padStart(5, '0');
  }
  const payload = bits.slice(0, 70);
  if (parseInt(bits.slice(70), 2) !== check(payload)) return null;
  let at = 0;
  const take = (w: number): number => {
    const v = parseInt(payload.slice(at, at + w), 2);
    at += w;
    return v;
  };
  if (take(4) !== FORMAT) return null;
  const tag = take(16);
  return {
    day: take(16) + CODE_EPOCH,
    wave: take(10),
    kills: take(20),
    resumes: take(3),
    practice: take(1) === 1,
    sameRules: tag === rulesTag(),
  };
}

/** Find a code anywhere in a pasted message (§4.6): the line's own numbers are never read. */
export function findResult(text: string): OmenResult | null {
  for (const m of text.matchAll(/([0-9a-z]{6})-?([0-9a-z]{6})-?([0-9a-z]{6})/gi)) {
    const r = decodeResult(m[1] + m[2] + m[3]);
    if (r) return r;
  }
  return null;
}

/** 1204 → "1,204", the same on every device. */
export function digits(n: number): string {
  return String(Math.floor(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** The copied line (§4.6): "Omen Sat 14 Nov · Ember Rift · wave 31 · 1,204 slain · 7KQ3FX-9QX2MA-0PZ4RT". */
export function resultLine(n: number, wave: number, kills: number, resumes: number, practice: boolean): string {
  const code = encodeResult({ day: n, wave, kills, resumes, practice });
  const where = regionByIndex(rollOmen(n).region).name;
  return `Omen ${omenLabel(n)}${practice ? ' (practice)' : ''} · ${where} · wave ${wave} · ${digits(kills)} slain · ${code}`;
}

const WAVE_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

/** One sentence comparing two scores on a day (§2): "You held two waves longer." */
export function compareLine(mine: { wave: number; kills: number }, theirs: { wave: number; kills: number }): string {
  const dw = mine.wave - theirs.wave;
  if (dw !== 0) {
    const n = Math.abs(dw);
    const w = `${WAVE_WORDS[n] ?? n} wave${n === 1 ? '' : 's'}`;
    return dw > 0 ? `You held ${w} longer.` : `They held ${w} longer.`;
  }
  const dk = mine.kills - theirs.kills;
  if (dk === 0) return 'A dead heat: the same wave, the same kills.';
  return dk > 0 ? `The same wave; you slew ${digits(dk)} more.` : `The same wave; they slew ${digits(-dk)} more.`;
}

// ── Replay ──────────────────────────────────────────────────────────────

/**
 * Play day `n` again from an input log (§4.7): every op at the tick it was
 * logged, between steps. A resume op counts, as it did live. The proof
 * phase (§4.7, phase 5) will run this in a worker; tests run it now.
 */
export function replayOmen(n: number, log: readonly number[], practice = false, maxSeconds = 3600): RunState {
  const run = createRun(omenConfig(n, practice), omenSeed(n));
  // The replay keeps its own log: the live one is the input.
  run.omen!.log = [];
  let i = 0;
  const maxTicks = Math.round(maxSeconds / SIM_DT);
  while (!run.outcome && run.tick < maxTicks) {
    while (i < log.length && log[i] <= run.tick) {
      const input = omenInput(log[i + 1]);
      if (input) applyInput(run, input);
      else noteResume(run);
      i += 2;
    }
    if (run.outcome) break;
    step(run, SIM_DT);
  }
  return run;
}
