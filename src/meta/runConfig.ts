import { BALANCE } from '../content/balance';
import { FRAMES } from '../content/frames';
import { PASSIVES } from '../content/passives';
import type { CardItemId, Effect, StatMod } from '../content/types';
import type { Profile } from './profile';
import type { Card, RunConfig } from '../sim/state';

export type { RunConfig };

/**
 * What the Forge will grant by the time the draft has something to choose
 * between: weapon slot 2 and the two ring-1 weapons (§7.1, runs 2–4). There
 * is no Forge until P3, so every run gets them; P3 replaces this list with
 * the player's owned nodes.
 */
const FORGE_STANDIN: readonly Effect[] = [
  { kind: 'slot', slot: 'weapon', n: 1 },
  { kind: 'unlockCard', id: 'scattershot' },
  { kind: 'unlockCard', id: 'chain-lightning' },
];

/** The first draft of the game (§7.1): one of each kind of card, nothing to misread. */
export const FIRST_DRAFT: readonly Card[] = [
  { kind: 'weapon', id: 'arcane-bolt', level: 2 },
  { kind: 'passive', id: 'power', level: 1 },
  { kind: 'passive', id: 'fortify', level: 1 },
];

/**
 * Profile → frozen `RunConfig` (§12.3). Resolves every frame, Forge and relic
 * effect once per run, so the sim never sees the profile.
 */
export function buildRunConfig(profile: Profile): RunConfig {
  const frame = FRAMES[0];
  const mods: StatMod[] = [];
  const pool: CardItemId[] = [frame.startingWeapon, ...PASSIVES.map((p) => p.id)];
  let weaponSlots: number = BALANCE.slots.weapon;
  let passiveSlots: number = BALANCE.slots.passive;
  for (const e of [...frame.effects, ...FORGE_STANDIN]) {
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
      default: {
        const exhaustive: never = e;
        return exhaustive;
      }
    }
  }
  return Object.freeze({
    frameId: frame.id,
    regionId: 1,
    mods: Object.freeze(mods),
    weaponSlots,
    passiveSlots,
    pool: Object.freeze(pool),
    firstDraft: profile.tutorial.firstDraft ? null : FIRST_DRAFT,
  });
}
