import { BALANCE } from '../content/balance';
import { FORGE, FORGE_BY_ID } from '../content/forge';
import type { ForgeNodeDef } from '../content/types';
import { bossDown } from './collection';
import type { Profile } from './profile';

/**
 * The Forge's rules (§5.1): adjacency, fog, costs, buying and refunds. Pure
 * functions over the profile; the UI and the pacing bot both go through here.
 *
 * Adjacency is undirected: a node touches every node it `links` to and every
 * node that links to it. A node with no links touches the root, which is
 * always owned.
 */

/**
 * How a node shows on the web (§5.1):
 *   owned   bought at least once
 *   open    touches an owned node (or the root): its effect and cost show
 *   sealed  would be open, but waits for a boss: "Sealed — defeat the Gatekeeper"
 *   fog     touches an open node: a "?" in its branch colour and type
 *   hidden  not drawn
 */
export type NodeState = 'owned' | 'open' | 'sealed' | 'fog' | 'hidden';

/** True while a node waits for its boss's first fall (§5.1). */
export function isSealed(profile: Profile, node: ForgeNodeDef): boolean {
  return !!node.sealed && !bossDown(profile, node.sealed);
}

/** Every node's neighbours, both directions. */
const NEIGHBOURS: ReadonlyMap<string, readonly string[]> = (() => {
  const m = new Map<string, string[]>(FORGE.map((n) => [n.id, []]));
  for (const n of FORGE) {
    for (const l of n.links) {
      m.get(n.id)?.push(l);
      m.get(l)?.push(n.id);
    }
  }
  return m;
})();

export function neighbours(id: string): readonly string[] {
  return NEIGHBOURS.get(id) ?? [];
}

export function levelOf(profile: Profile, id: string): number {
  return profile.forge[id] ?? 0;
}

/** Shards for the next level of `node`, given `owned` levels already bought. */
export function nodeCost(node: ForgeNodeDef, owned: number): number {
  return Math.round(node.cost * Math.pow(BALANCE.forge.levelGrowth, owned));
}

/** Everything spent on a node's `owned` levels: what a refund returns. */
export function spentOn(node: ForgeNodeDef, owned: number): number {
  let sum = 0;
  for (let i = 0; i < owned; i++) sum += nodeCost(node, i);
  return sum;
}

function touchesOwned(forge: Readonly<Record<string, number>>, node: ForgeNodeDef): boolean {
  return node.links.length === 0 || neighbours(node.id).some((id) => (forge[id] ?? 0) > 0);
}

/** Every node's state at once: fog depends on which neighbours are open. */
export function nodeStates(profile: Profile): Map<string, NodeState> {
  const out = new Map<string, NodeState>();
  for (const n of FORGE) {
    if (levelOf(profile, n.id) > 0) out.set(n.id, 'owned');
    else if (touchesOwned(profile.forge, n)) out.set(n.id, isSealed(profile, n) ? 'sealed' : 'open');
  }
  for (const n of FORGE) {
    if (out.has(n.id)) continue;
    out.set(n.id, neighbours(n.id).some((id) => out.get(id) === 'open') ? 'fog' : 'hidden');
  }
  return out;
}

/** True when the node's next level may be bought now, shards aside. */
export function isBuyable(profile: Profile, id: string): boolean {
  const node = FORGE_BY_ID[id];
  if (!node) return false;
  const owned = levelOf(profile, id);
  if (owned >= node.maxLevel || isSealed(profile, node)) return false;
  return owned > 0 || touchesOwned(profile.forge, node);
}

export function canAfford(profile: Profile, id: string): boolean {
  const node = FORGE_BY_ID[id];
  return !!node && isBuyable(profile, id) && profile.shards >= nodeCost(node, levelOf(profile, id));
}

/** Buy the next level. False, and nothing changes, if it isn't allowed. */
export function buyNode(profile: Profile, id: string): boolean {
  if (!canAfford(profile, id)) return false;
  const node = FORGE_BY_ID[id];
  const owned = levelOf(profile, id);
  profile.shards -= nodeCost(node, owned);
  profile.forge[id] = owned + 1;
  return true;
}

/**
 * Notables and keystones refund for free between runs (§5.1); minors never
 * do, so the web keeps its shape. A refund may not strand an owned node:
 * everything else owned must still reach the root through owned nodes.
 */
export function canRefund(profile: Profile, id: string): boolean {
  const node = FORGE_BY_ID[id];
  if (!node || node.type === 'minor' || levelOf(profile, id) === 0) return false;
  const rest = { ...profile.forge };
  delete rest[id];
  return allConnected(rest);
}

export function refundNode(profile: Profile, id: string): boolean {
  if (!canRefund(profile, id)) return false;
  profile.shards += spentOn(FORGE_BY_ID[id], levelOf(profile, id));
  delete profile.forge[id];
  return true;
}

/** True when every owned node reaches the root through owned nodes. */
function allConnected(forge: Readonly<Record<string, number>>): boolean {
  const owned = new Set(Object.keys(forge).filter((id) => forge[id] > 0 && FORGE_BY_ID[id]));
  const reached = new Set<string>();
  const queue = [...owned].filter((id) => FORGE_BY_ID[id].links.length === 0);
  for (const id of queue) reached.add(id);
  while (queue.length > 0) {
    const id = queue.pop()!;
    for (const n of neighbours(id)) {
      if (owned.has(n) && !reached.has(n)) {
        reached.add(n);
        queue.push(n);
      }
    }
  }
  return reached.size === owned.size;
}

/** The "Next:" line (§4.6, §7.4): the cheapest node that can be bought, and how close it is. */
export interface ForgeGoal {
  node: ForgeNodeDef;
  cost: number;
  /** Shards held over cost, capped at 1. */
  progress: number;
}

export function nextGoal(profile: Profile): ForgeGoal | null {
  let best: ForgeGoal | null = null;
  for (const n of FORGE) {
    if (!isBuyable(profile, n.id)) continue;
    const cost = nodeCost(n, levelOf(profile, n.id));
    if (!best || cost < best.cost) best = { node: n, cost, progress: Math.min(1, profile.shards / cost) };
  }
  return best;
}

/** Owned nodes with their levels, in table order: what `buildRunConfig` resolves. */
export function ownedNodes(profile: Profile): { node: ForgeNodeDef; level: number }[] {
  return FORGE.filter((n) => levelOf(profile, n.id) > 0).map((n) => ({ node: n, level: levelOf(profile, n.id) }));
}
