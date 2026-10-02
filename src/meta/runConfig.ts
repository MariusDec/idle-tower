import { BALANCE } from '../content/balance';
import { EVOLUTIONS } from '../content/evolutions';
import { PASSIVES } from '../content/passives';
import { abyssRelics } from '../content/relics';
import { frameById } from '../content/frames';
import type { BehaviourId, CardItemId, Effect, FrameId, FusionId, PactId, StatMod, TrialDef, WeaponId } from '../content/types';
import { isWeaponId } from '../sim/systems/draft';
import { selectedTrial, trialEffects } from './trials';
import { activeSets, bossDown, equippedRelics, inAbyss, pastRegions, relicSlots, selectedFrame, selectedRegion } from './collection';
import { FORGE_WEB, ownedNodes } from './forge';
import { neverList, priorityList } from './automation';
import { runPacts } from './pacts';
import type { Profile } from './profile';
import { STAR_WEB, starGifts } from './stars';
import type { Card, RunConfig } from '../sim/state';

export type { RunConfig };

/** The first draft of the game (§7.1): one of each kind of card, nothing to misread. */
export const FIRST_DRAFT: readonly Card[] = [
  { kind: 'weapon', id: 'arcane-bolt', level: 2 },
  { kind: 'passive', id: 'power', level: 1 },
  { kind: 'passive', id: 'fortify', level: 1 },
];

/**
 * Profile → frozen `RunConfig` (§12.3). Resolves the chosen frame and region
 * and every Forge, Constellation and relic effect once per run, so the sim
 * never sees the profile. The region's rule is the sim's: it reads the
 * region it runs in; so are the pacts' numbers (`sim/pacts.ts`).
 */
export function buildRunConfig(profile: Profile): RunConfig {
  const abyss = inAbyss(profile);
  // A Trial (N5) sets the frame, the weapons, the slots and the omens; never in the Abyss or Boss Rush.
  const trial = pastRegions(profile) ? null : selectedTrial(profile);
  const rules = trialRules(trial);
  const frame = rules.frame ? frameById(rules.frame) : selectedFrame(profile);
  const region = selectedRegion(profile);
  const mods: StatMod[] = [];
  const first: WeaponId = rules.weapons?.[0] ?? frame.startingWeapon;
  const pool: CardItemId[] = [first];
  let weaponSlots: number = BALANCE.slots.weapon;
  let passiveSlots: number = BALANCE.slots.passive;
  const behaviours: Partial<Record<BehaviourId, number>> = {};
  const fusions: FusionId[] = [];
  // Every effect applies once per owned level; a frame's quirk is one level.
  // A stat applies as one contribution of `level` times its size: the same
  // to the resolver, and a mastery hundreds of levels deep stays one line.
  // An ascended star's levels past its last (N10) are one multiplier more.
  const effects: Effect[] = [...frame.effects];
  const webs = [
    ...ownedNodes(profile).map((o) => ({ ...o, stats: FORGE_WEB.statMods(o.node, o.level) })),
    ...STAR_WEB.ownedNodes(profile).map((o) => ({ ...o, stats: STAR_WEB.statMods(o.node, o.level) })),
  ];
  for (const { node, level, stats } of webs) {
    mods.push(...stats);
    for (const e of node.effects) {
      if (e.kind !== 'stat') for (let i = 0; i < level; i++) effects.push(e);
    }
  }
  // The notables Trials paid (N5) apply to every run, like a Forge node's.
  effects.push(...trialEffects(profile));
  // A relic's effects at rank I, and its per-rank effects once per rank past it (§5.3).
  for (const { relic, rank } of equippedRelics(profile)) {
    effects.push(...relic.effects);
    for (let i = 1; i < rank; i++) effects.push(...relic.perRank);
  }
  // A set worn whole (N6) adds its bonus the same way, at the set's rank.
  for (const { set, rank } of activeSets(profile)) {
    effects.push(...set.effects);
    for (let i = 1; i < rank; i++) effects.push(...set.perRank);
  }
  for (const e of effects) {
    switch (e.kind) {
      case 'stat':
        mods.push(e.mod);
        break;
      case 'unlockCard':
        if (!pool.includes(e.id)) pool.push(e.id);
        break;
      case 'slot':
        if (e.slot === 'weapon') weaponSlots += e.n;
        else if (e.slot === 'passive') passiveSlots += e.n;
        // A relic slot is the profile's: `relicSlots` counts it.
        break;
      case 'behaviour':
        behaviours[e.id] = (behaviours[e.id] ?? 0) + 1;
        break;
      case 'automation':
        // The app's, not the run's: `meta/automation.ts` consumes it.
        break;
      case 'fusion':
        if (!fusions.includes(e.id)) fusions.push(e.id);
        break;
      case 'frame':
      case 'mastery':
      case 'relics':
      case 'starlight':
        // The profile's, between runs: `meta/stars.ts#starGifts` consumes them.
        break;
      default: {
        const exhaustive: never = e;
        return exhaustive;
      }
    }
  }
  // A Trial's weapons (N5) are all the draft may offer, unlocked or not: it is authored.
  if (rules.weapons) {
    const only = rules.weapons;
    for (let i = pool.length - 1; i >= 0; i--) if (isWeaponId(pool[i]) && !only.includes(pool[i] as WeaponId)) pool.splice(i, 1);
    for (const id of only) if (!pool.includes(id)) pool.push(id);
  }
  // Passives that join with a weapon (§4.5) follow it into the pool; a
  // starred one (§9) is in it only if a star's `unlockCard` put it there.
  for (const p of PASSIVES) {
    if (p.starred || pool.includes(p.id)) continue;
    if (!p.joinsWith || pool.includes(p.joinsWith)) pool.push(p.id);
  }
  // Specialist (§11.4): one weapon slot, whatever else the Forge gave.
  if (behaviours.specialist) weaponSlots = 1;
  // A Trial's slots (N5) are a ceiling on what the Forge gave.
  if (rules.weaponSlots !== undefined) weaponSlots = Math.min(weaponSlots, rules.weaponSlots);
  if (rules.passiveSlots !== undefined) passiveSlots = Math.min(passiveSlots, rules.passiveSlots);
  return Object.freeze({
    frameId: frame.id,
    regionId: region.index,
    startingWeapon: first,
    trial: trial?.id ?? null,
    mods: Object.freeze(mods),
    weaponSlots,
    passiveSlots,
    pool: Object.freeze(pool),
    firstDraft: profile.tutorial.firstDraft ? null : FIRST_DRAFT,
    behaviours: Object.freeze(behaviours),
    // The Abyss's guardians and Boss Rush's bosses are never a first kill: their regions' are.
    firstKill: !pastRegions(profile) && !bossDown(profile, region.boss),
    relicDrops: relicSlots(profile) > 0,
    recipes: Object.freeze(EVOLUTIONS.filter((e) => profile.recipes.found.includes(e.id)).map((e) => e.id)),
    fusions: Object.freeze(fusions),
    priority: tactics(priorityList(profile), pool),
    never: tactics(neverList(profile), pool),
    // A Trial's omens stand in for the pacts (N5): it is authored, and pays no heat.
    pacts: Object.freeze(trial ? rules.pacts : runPacts(profile)),
    abyssRelics: Object.freeze(abyss ? abyssRelics(starGifts(profile).relicSets) : []),
  });
}

/** What a Trial's rules (N5) come to, for `buildRunConfig`; empty for an ordinary run. */
interface TrialRules {
  frame?: FrameId;
  weapons?: readonly WeaponId[];
  weaponSlots?: number;
  passiveSlots?: number;
  pacts: Partial<Record<PactId, number>>;
}

/** Fold a Trial's rules into one set of overrides: the rules' one consumer. */
function trialRules(trial: TrialDef | null): TrialRules {
  const out: TrialRules = { pacts: {} };
  for (const r of trial?.rules ?? []) {
    switch (r.kind) {
      case 'frame':
        out.frame = r.frame;
        break;
      case 'weapons':
        out.weapons = r.ids;
        break;
      case 'slots':
        if (r.weapon !== undefined) out.weaponSlots = r.weapon;
        if (r.passive !== undefined) out.passiveSlots = r.passive;
        break;
      case 'omen':
        out.pacts[r.pact] = r.rank;
        break;
      default: {
        const exhaustive: never = r;
        return exhaustive;
      }
    }
  }
  return out;
}

/** A Tactician's list as the run sees it: only items in the pool, frozen; null when none are. */
function tactics(list: CardItemId[] | null, pool: readonly CardItemId[]): readonly CardItemId[] | null {
  const ranked = list?.filter((id) => pool.includes(id)) ?? [];
  return ranked.length > 0 ? Object.freeze(ranked) : null;
}
