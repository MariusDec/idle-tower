/**
 * The bots' Contract board policy (plans/late-game/10 §9). The board is
 * active-only (§4.7): only the active bots ever call this; the idle bot
 * never does, and `tools/idle.ts` asserts it.
 *
 * The bot takes the slots in turn, Quick, Steady, Hard, so its success reads
 * by tier; a card it can't take (heat it can't reach) passes to the next.
 * In Act 2 it sets its pacts to the heat a card asks, or none for a card in
 * a region that asks none (the board pays the same either way). It holds
 * its ultimate when a card asks (`holdsUlt`), and steers its drafts to the
 * weapon a card names (`steerConfig`), as a player would; it never aims for
 * `untouched`, so it understates that ask (§10).
 */
import { SLOTS, contractTier, heatNeeded, placeOf, takeContract } from '../src/meta/contracts';
import { REGIONS } from '../src/content/regions';
import { EVOLUTION_OF } from '../src/content/evolutions';
import { FUSION_BY_ID } from '../src/content/fusions';
import type { CardItemId, ContractSpec } from '../src/content/types';
import { isWeaponId } from '../src/sim/systems/draft';
import type { RunConfig } from '../src/sim/state';
import { act2Open } from '../src/meta/collection';
import type { Profile } from '../src/meta/profile';
import type { RunSummary } from '../src/meta/results';

/** A reading of the board's play: tries and successes by tier, and what it paid. */
export interface ContractTally {
  /** Tries and successes, by tier 1–4. */
  tries: Record<number, number>;
  met: Record<number, number>;
  shards: number;
  starlight: number;
  /** Riders and milestones (§9's "contract-only rewards"). */
  only: number;
}

export function emptyContractTally(): ContractTally {
  return { tries: {}, met: {}, shards: 0, starlight: 0, only: 0 };
}

/**
 * Take a card for the `n`th contract run: slot `n mod 3` first. `setHeat`
 * sets the profile's pacts for a region run (Act 2). Returns the card and
 * its tier, or null when none can be taken.
 */
export function botTake(
  profile: Profile, n: number, setHeat: (profile: Profile, heat: number, region: number) => void,
): { card: ContractSpec; tier: number } | null {
  for (let i = 0; i < SLOTS.length; i++) {
    const slot = SLOTS[(n + i) % SLOTS.length];
    const card = profile.contracts.board.find((c) => c.slot === slot);
    if (!card) continue;
    const place = placeOf(card.target);
    if (act2Open(profile) && REGIONS.some((r) => r.index === place)) setHeat(profile, heatNeeded(card), place);
    const tier = contractTier(profile, card);
    if (takeContract(profile, card.id)) return { card, tier };
  }
  return null;
}

/** True when a card asks for no ultimate: the bot's run passes `holdUlt`. */
export function holdsUlt(card: ContractSpec | null | undefined): boolean {
  return card?.mods.some((m) => m.kind === 'noUlt') ?? false;
}

/**
 * The run config a player would steer a card's run with: the weapon it names
 * (and, for an evolve or a fusion, its partner passives) first on the
 * Tactician's list, so the suggestion the bot follows takes them when
 * offered; a `carry` also holds other weapons back (the Never list), since
 * every other weapon's damage counts against the half. The game's own rules
 * are untouched: this is only what the bot taps.
 */
export function steerConfig(config: RunConfig, card: ContractSpec | null | undefined): RunConfig {
  if (!card) return config;
  const first: CardItemId[] = [];
  let carry = false;
  for (const m of card.mods) {
    if (m.kind === 'carry') {
      first.push(m.weapon);
      carry = true;
    } else if (m.kind === 'evolve') {
      first.push(m.weapon, EVOLUTION_OF[m.weapon].passive);
    } else if (m.kind === 'fuse') {
      for (const w of FUSION_BY_ID[m.fusion].weapons) first.push(w, EVOLUTION_OF[w].passive);
    }
  }
  if (first.length === 0) return config;
  const wanted = [...new Set(first)].filter((id) => config.pool.includes(id));
  const priority = [...wanted, ...(config.priority ?? []).filter((id) => !wanted.includes(id))];
  const never = carry
    ? [...new Set([...(config.never ?? []), ...config.pool.filter((id) => isWeaponId(id) && !wanted.includes(id))])]
    : config.never;
  return { ...config, priority, never };
}

/** Count a banked contract run into the tally. */
export function tallyContract(t: ContractTally, tier: number, summary: RunSummary): void {
  const c = summary.contract;
  t.tries[tier] = (t.tries[tier] ?? 0) + 1;
  if (!c?.met) return;
  t.met[tier] = (t.met[tier] ?? 0) + 1;
  t.shards += c.pay?.shards ?? 0;
  t.starlight += c.pay?.starlight ?? 0;
  t.only += (c.rider ? 1 : 0) + (c.milestone ? 1 : 0);
}

/** "T1 9/11 · T2 5/8 …": success by tier. */
export function successLine(t: ContractTally): string {
  return [1, 2, 3, 4].map((k) => `T${k} ${t.met[k] ?? 0}/${t.tries[k] ?? 0}`).join(' · ');
}
