import { BALANCE } from '../content/balance';
import { EVOLUTIONS } from '../content/evolutions';
import { PASSIVES } from '../content/passives';
import { abyssRelics } from '../content/relics';
import type { BehaviourId, CardItemId, Effect, StatMod } from '../content/types';
import { bossDown, equippedRelics, inAbyss, relicSlots, selectedFrame, selectedRegion } from './collection';
import { ownedNodes } from './forge';
import { neverList, priorityList } from './automation';
import { runPacts } from './pacts';
import type { Profile } from './profile';
import { STAR_WEB, starGifts } from './stars';
import { scaleMod } from '../sim/pacts';
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
  const frame = selectedFrame(profile);
  const region = selectedRegion(profile);
  const abyss = inAbyss(profile);
  const mods: StatMod[] = [];
  const pool: CardItemId[] = [frame.startingWeapon];
  let weaponSlots: number = BALANCE.slots.weapon;
  let passiveSlots: number = BALANCE.slots.passive;
  const behaviours: Partial<Record<BehaviourId, number>> = {};
  // Every effect applies once per owned level; a frame's quirk is one level.
  // A stat applies as one contribution of `level` times its size: the same
  // to the resolver, and a mastery hundreds of levels deep stays one line.
  const effects: Effect[] = [...frame.effects];
  for (const { node, level } of [...ownedNodes(profile), ...STAR_WEB.ownedNodes(profile)]) {
    for (const e of node.effects) {
      if (e.kind === 'stat') mods.push(scaleMod(e.mod, level));
      else for (let i = 0; i < level; i++) effects.push(e);
    }
  }
  // A relic's effects at rank I, and its per-rank effects once per rank past it (§5.3).
  for (const { relic, rank } of equippedRelics(profile)) {
    effects.push(...relic.effects);
    for (let i = 1; i < rank; i++) effects.push(...relic.perRank);
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
  // Passives that join with a weapon (§4.5) follow it into the pool; a
  // starred one (§9) is in it only if a star's `unlockCard` put it there.
  for (const p of PASSIVES) {
    if (p.starred || pool.includes(p.id)) continue;
    if (!p.joinsWith || pool.includes(p.joinsWith)) pool.push(p.id);
  }
  // Specialist (§11.4): one weapon slot, whatever else the Forge gave.
  if (behaviours.specialist) weaponSlots = 1;
  return Object.freeze({
    frameId: frame.id,
    regionId: region.index,
    mods: Object.freeze(mods),
    weaponSlots,
    passiveSlots,
    pool: Object.freeze(pool),
    firstDraft: profile.tutorial.firstDraft ? null : FIRST_DRAFT,
    behaviours: Object.freeze(behaviours),
    // The Abyss's guardians are never a first kill: their regions' are.
    firstKill: !abyss && !bossDown(profile, region.boss),
    relicDrops: relicSlots(profile) > 0,
    recipes: Object.freeze(EVOLUTIONS.filter((e) => profile.recipes.found.includes(e.id)).map((e) => e.id)),
    priority: tactics(priorityList(profile), pool),
    never: tactics(neverList(profile), pool),
    pacts: Object.freeze(runPacts(profile)),
    abyssRelics: Object.freeze(abyss ? abyssRelics(starGifts(profile).relicSets) : []),
  });
}

/** A Tactician's list as the run sees it: only items in the pool, frozen; null when none are. */
function tactics(list: CardItemId[] | null, pool: readonly CardItemId[]): readonly CardItemId[] | null {
  const ranked = list?.filter((id) => pool.includes(id)) ?? [];
  return ranked.length > 0 ? Object.freeze(ranked) : null;
}
