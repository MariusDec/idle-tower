import type { StatMod, WebNodeDef } from '../content/types';
import { scaleMod } from '../sim/pacts';
import type { Profile } from './profile';

/**
 * A web's rules (§5.1): adjacency, fog, costs, buying and refunds, over any
 * table of nodes, a profile record of owned levels and a currency. The Forge
 * (shards) and the Constellations (Starlight, §9) are both one of these;
 * the UI and the pacing bot go through them.
 *
 * Adjacency is undirected: a node touches every node it `links` to and every
 * node that links to it. A node with no links touches the root, which is
 * always owned.
 */

/**
 * How a node shows on the web (§5.1):
 *   owned   bought at least once
 *   open    touches an owned node (or the root): its effect and cost show
 *   sealed  would be open, but waits: "Sealed — defeat the Gatekeeper"
 *   fog     touches an open node: a "?" in its branch colour and type
 *   hidden  not drawn
 */
export type NodeState = 'owned' | 'open' | 'sealed' | 'fog' | 'hidden';

/** The "Next:" line (§4.6, §7.4): the cheapest node that can be bought, and how close it is. */
export interface WebGoal<N extends WebNodeDef = WebNodeDef> {
  node: N;
  cost: number;
  /** Currency held over cost, capped at 1. */
  progress: number;
}

export interface WebSpec<N extends WebNodeDef> {
  readonly nodes: readonly N[];
  /** Each further level costs this much more than the last, unless the node says otherwise. */
  readonly growth: number;
  /** The profile's record of owned levels, by node id. */
  owned(profile: Profile): Record<string, number>;
  /** The currency the web is paid in. */
  wallet(profile: Profile): number;
  pay(profile: Profile, amount: number): void;
  /** True while a node waits on something outside the web (a boss, a constellation). */
  sealed(profile: Profile, node: N): boolean;
  /** True for a node bought levels may be returned for, between runs. */
  refundable(node: N): boolean;
  /**
   * Levels past a node's last (N10, ascension): which nodes may go on, and
   * when; each such level costs `cost` times the curve's next, and its stats
   * apply as a multiplier of `share` of one level's percentage, compounding.
   */
  readonly beyond?: {
    can(node: N): boolean;
    open(profile: Profile): boolean;
    readonly cost: number;
    readonly share: number;
  };
}

export class Web<N extends WebNodeDef> {
  private readonly byId: ReadonlyMap<string, N>;
  private readonly adjacent: ReadonlyMap<string, readonly string[]>;

  constructor(private readonly spec: WebSpec<N>) {
    this.byId = new Map(spec.nodes.map((n) => [n.id, n]));
    const m = new Map<string, string[]>(spec.nodes.map((n) => [n.id, []]));
    for (const n of spec.nodes) {
      for (const l of n.links) {
        m.get(n.id)?.push(l);
        m.get(l)?.push(n.id);
      }
    }
    this.adjacent = m;
  }

  get nodes(): readonly N[] {
    return this.spec.nodes;
  }

  node(id: string): N | undefined {
    return this.byId.get(id);
  }

  neighbours(id: string): readonly string[] {
    return this.adjacent.get(id) ?? [];
  }

  levelOf(profile: Profile, id: string): number {
    return this.spec.owned(profile)[id] ?? 0;
  }

  isSealed(profile: Profile, node: N): boolean {
    return this.spec.sealed(profile, node);
  }

  /** The price of the next level of `node`, given `owned` levels already bought; past its last, ascension's. */
  cost(node: N, owned: number): number {
    const past = owned >= node.maxLevel && this.spec.beyond ? this.spec.beyond.cost : 1;
    return Math.round(node.cost * Math.pow(node.growth ?? this.spec.growth, owned) * past);
  }

  /** The levels `node` may be bought to now: its last, or without end once it may ascend (N10). */
  maxOf(profile: Profile, node: N): number {
    const b = this.spec.beyond;
    return b && b.can(node) && b.open(profile) ? Infinity : node.maxLevel;
  }

  /** True for a node that may ascend past its last level once ascension opens (N10). */
  canAscend(node: N): boolean {
    return !!this.spec.beyond?.can(node);
  }

  /**
   * A node's stat effects at `level`, as contributions: each up to its last
   * level as `level` copies, and each ascended level past it (N10) as a
   * multiplier of `share` of one level's percentage, compounding.
   */
  statMods(node: N, level: number): StatMod[] {
    const out: StatMod[] = [];
    const base = Math.min(level, node.maxLevel);
    const past = level - base;
    const share = this.spec.beyond?.share ?? 0;
    for (const e of node.effects) {
      if (e.kind !== 'stat') continue;
      out.push(scaleMod(e.mod, base));
      if (past > 0 && e.mod.pct !== undefined) {
        out.push({ key: e.mod.key, mult: Math.pow(1 + e.mod.pct * share, past), ...(e.mod.bucket ? { bucket: e.mod.bucket } : {}) });
      }
    }
    return out;
  }

  /** Everything spent on a node's `owned` levels: what a refund returns. */
  spentOn(node: N, owned: number): number {
    let sum = 0;
    for (let i = 0; i < owned; i++) sum += this.cost(node, i);
    return sum;
  }

  private touchesOwned(owned: Readonly<Record<string, number>>, node: N): boolean {
    return node.links.length === 0 || this.neighbours(node.id).some((id) => (owned[id] ?? 0) > 0);
  }

  /** Every node's state at once: fog depends on which neighbours are open. */
  states(profile: Profile): Map<string, NodeState> {
    const owned = this.spec.owned(profile);
    const out = new Map<string, NodeState>();
    for (const n of this.spec.nodes) {
      if ((owned[n.id] ?? 0) > 0) out.set(n.id, 'owned');
      else if (this.touchesOwned(owned, n)) out.set(n.id, this.spec.sealed(profile, n) ? 'sealed' : 'open');
    }
    for (const n of this.spec.nodes) {
      if (out.has(n.id)) continue;
      out.set(n.id, this.neighbours(n.id).some((id) => out.get(id) === 'open') ? 'fog' : 'hidden');
    }
    return out;
  }

  /** True when the node's next level may be bought now, the price aside. */
  isBuyable(profile: Profile, id: string): boolean {
    const node = this.byId.get(id);
    if (!node) return false;
    const owned = this.levelOf(profile, id);
    if (owned >= this.maxOf(profile, node) || this.spec.sealed(profile, node)) return false;
    return owned > 0 || this.touchesOwned(this.spec.owned(profile), node);
  }

  canAfford(profile: Profile, id: string): boolean {
    const node = this.byId.get(id);
    return !!node && this.isBuyable(profile, id) && this.spec.wallet(profile) >= this.cost(node, this.levelOf(profile, id));
  }

  /** Buy the next level. False, and nothing changes, if it isn't allowed. */
  buy(profile: Profile, id: string): boolean {
    if (!this.canAfford(profile, id)) return false;
    const node = this.byId.get(id)!;
    const owned = this.levelOf(profile, id);
    this.spec.pay(profile, this.cost(node, owned));
    this.spec.owned(profile)[id] = owned + 1;
    return true;
  }

  /**
   * A refund may not strand an owned node: everything else owned must still
   * reach the root through owned nodes.
   */
  canRefund(profile: Profile, id: string): boolean {
    const node = this.byId.get(id);
    if (!node || !this.spec.refundable(node) || this.levelOf(profile, id) === 0) return false;
    const rest = { ...this.spec.owned(profile) };
    delete rest[id];
    return this.allConnected(rest);
  }

  refund(profile: Profile, id: string): boolean {
    if (!this.canRefund(profile, id)) return false;
    const node = this.byId.get(id)!;
    this.spec.pay(profile, -this.spentOn(node, this.levelOf(profile, id)));
    delete this.spec.owned(profile)[id];
    return true;
  }

  /** True when every owned node reaches the root through owned nodes. */
  private allConnected(owned: Readonly<Record<string, number>>): boolean {
    const have = new Set(Object.keys(owned).filter((id) => owned[id] > 0 && this.byId.has(id)));
    const reached = new Set<string>();
    const queue = [...have].filter((id) => this.byId.get(id)!.links.length === 0);
    for (const id of queue) reached.add(id);
    while (queue.length > 0) {
      const id = queue.pop()!;
      for (const n of this.neighbours(id)) {
        if (have.has(n) && !reached.has(n)) {
          reached.add(n);
          queue.push(n);
        }
      }
    }
    return reached.size === have.size;
  }

  /** The cheapest level that can be bought now, and how close the wallet is to it. */
  nextGoal(profile: Profile): WebGoal<N> | null {
    let best: WebGoal<N> | null = null;
    const held = this.spec.wallet(profile);
    for (const n of this.spec.nodes) {
      if (!this.isBuyable(profile, n.id)) continue;
      const cost = this.cost(n, this.levelOf(profile, n.id));
      if (!best || cost < best.cost) best = { node: n, cost, progress: Math.min(1, held / cost) };
    }
    return best;
  }

  /** Owned nodes with their levels, in table order. */
  ownedNodes(profile: Profile): { node: N; level: number }[] {
    const owned = this.spec.owned(profile);
    return this.spec.nodes.filter((n) => (owned[n.id] ?? 0) > 0).map((n) => ({ node: n, level: owned[n.id] }));
  }
}
