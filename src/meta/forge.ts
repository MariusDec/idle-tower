import { BALANCE } from '../content/balance';
import { FORGE } from '../content/forge';
import type { ForgeNodeDef } from '../content/types';
import { bossDown } from './collection';
import type { Profile } from './profile';
import { starGifts } from './stars';
import { Web, type NodeState, type WebGoal } from './web';

/**
 * The Forge's rules (§5.1): adjacency, fog, costs, buying and refunds, as a
 * `Web` over the Forge table, paid in shards. Pure functions over the
 * profile; the UI and the pacing bot both go through here.
 *
 * A node is sealed until its boss falls, and a mastery (§9) until its
 * constellation in the Crown is lit. Notables and keystones refund for free
 * between runs; minors and masteries never do, so the web keeps its shape.
 */
export type { NodeState };

/** True while a node waits for its boss's first fall (§5.1), or a mastery for its star (§9). */
export function isSealed(profile: Profile, node: ForgeNodeDef): boolean {
  if (node.type === 'mastery' && !starGifts(profile).masteries.includes(node.branch)) return true;
  return !!node.sealed && !bossDown(profile, node.sealed);
}

export const FORGE_WEB = new Web<ForgeNodeDef>({
  nodes: FORGE,
  growth: BALANCE.forge.levelGrowth,
  owned: (p) => p.forge,
  wallet: (p) => p.shards,
  pay: (p, n) => { p.shards -= n; },
  sealed: isSealed,
  refundable: (n) => n.type === 'notable' || n.type === 'keystone',
});

export function neighbours(id: string): readonly string[] {
  return FORGE_WEB.neighbours(id);
}

export function levelOf(profile: Profile, id: string): number {
  return FORGE_WEB.levelOf(profile, id);
}

/** Shards for the next level of `node`, given `owned` levels already bought. */
export function nodeCost(node: ForgeNodeDef, owned: number): number {
  return FORGE_WEB.cost(node, owned);
}

/** Everything spent on a node's `owned` levels: what a refund returns. */
export function spentOn(node: ForgeNodeDef, owned: number): number {
  return FORGE_WEB.spentOn(node, owned);
}

/** Every node's state at once: fog depends on which neighbours are open. */
export function nodeStates(profile: Profile): Map<string, NodeState> {
  return FORGE_WEB.states(profile);
}

/** True when the node's next level may be bought now, shards aside. */
export function isBuyable(profile: Profile, id: string): boolean {
  return FORGE_WEB.isBuyable(profile, id);
}

export function canAfford(profile: Profile, id: string): boolean {
  return FORGE_WEB.canAfford(profile, id);
}

/** Buy the next level. False, and nothing changes, if it isn't allowed. */
export function buyNode(profile: Profile, id: string): boolean {
  return FORGE_WEB.buy(profile, id);
}

/** A refund may not strand an owned node (§5.1). */
export function canRefund(profile: Profile, id: string): boolean {
  return FORGE_WEB.canRefund(profile, id);
}

export function refundNode(profile: Profile, id: string): boolean {
  return FORGE_WEB.refund(profile, id);
}

/** The "Next:" line (§4.6, §7.4): the cheapest node that can be bought, and how close it is. */
export type ForgeGoal = WebGoal<ForgeNodeDef>;

export function nextGoal(profile: Profile): ForgeGoal | null {
  return FORGE_WEB.nextGoal(profile);
}

/** Owned nodes with their levels, in table order: what `buildRunConfig` resolves. */
export function ownedNodes(profile: Profile): { node: ForgeNodeDef; level: number }[] {
  return FORGE_WEB.ownedNodes(profile);
}

/**
 * The tower's tier (N2, §5.1): 1, plus one for every Forge ring completed in
 * turn from the first. A ring is complete when every node on it is owned;
 * keystones (build trades) and masteries (endless) don't count.
 */
export function towerTier(profile: Profile): number {
  let tier = 1;
  for (let ring = 1; ring <= 6; ring++) {
    const nodes = FORGE.filter((n) => n.ring === ring && n.type !== 'keystone' && n.type !== 'mastery');
    if (nodes.length === 0 || nodes.some((n) => levelOf(profile, n.id) === 0)) break;
    tier++;
  }
  return tier;
}
