import { BALANCE } from '../content/balance';
import { PASSIVES } from '../content/passives';
import type { BehaviourId, CardItemId, Effect, StatMod } from '../content/types';
import { bossDown, equippedRelics, relicSlots, selectedFrame, selectedRegion } from './collection';
import { ownedNodes } from './forge';
import type { Profile } from './profile';
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
 * and every Forge and relic effect once per run, so the sim never sees the
 * profile. The region's rule is the sim's: it reads the region it runs in.
 */
export function buildRunConfig(profile: Profile): RunConfig {
  const frame = selectedFrame(profile);
  const region = selectedRegion(profile);
  const mods: StatMod[] = [];
  const pool: CardItemId[] = [frame.startingWeapon, ...PASSIVES.map((p) => p.id)];
  let weaponSlots: number = BALANCE.slots.weapon;
  let passiveSlots: number = BALANCE.slots.passive;
  const behaviours: Partial<Record<BehaviourId, number>> = {};
  // Every effect applies once per owned level; a frame's quirk is one level.
  const effects: Effect[] = [...frame.effects];
  for (const { node, level } of ownedNodes(profile)) {
    for (let i = 0; i < level; i++) effects.push(...node.effects);
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
        else passiveSlots += e.n;
        break;
      case 'behaviour':
        behaviours[e.id] = (behaviours[e.id] ?? 0) + 1;
        break;
      case 'automation':
        // The app's, not the run's: `meta/automation.ts` consumes it.
        break;
      default: {
        const exhaustive: never = e;
        return exhaustive;
      }
    }
  }
  return Object.freeze({
    frameId: frame.id,
    regionId: region.index,
    mods: Object.freeze(mods),
    weaponSlots,
    passiveSlots,
    pool: Object.freeze(pool),
    firstDraft: profile.tutorial.firstDraft ? null : FIRST_DRAFT,
    behaviours: Object.freeze(behaviours),
    firstKill: !bossDown(profile, region.boss),
    relicDrops: relicSlots(profile) > 0,
  });
}
