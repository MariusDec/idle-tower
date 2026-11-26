import { BALANCE } from '../content/balance';
import { FORGE } from '../content/forge';
import type { BossId, ForgeNodeDef, StatKey, WeaponId } from '../content/types';
import { WEAPON_BY_ID } from '../content/weapons';
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
 * An owned keystone can also be switched off (and on) without a refund.
 *
 * Tempering: once the Gatekeeper falls, the combat minors whose stat is a
 * percentage go on past their last level (`BALANCE.forge.temper`), each
 * level a compounding multiplier at twice the curve's price. It is Act 1's
 * sink past the ring: the time a player puts into farming keeps buying an
 * easier run. Shard and XP gain stop at their last level, or the pay would
 * compound with the power that earns it.
 */
export type { NodeState };

/** A mastery with a last level (plans/mastery-capstones.md): ranks that change rules, not an endless sink. */
export function isCapstone(node: ForgeNodeDef): boolean {
  return node.type === 'mastery' && node.maxLevel !== Infinity;
}

/** The weapon a Forge node unlocks, or null (plans/forge-weapon-pacing.md). */
export function weaponOf(node: ForgeNodeDef): WeaponId | null {
  for (const e of node.effects) if (e.kind === 'unlockCard' && e.id in WEAPON_BY_ID) return e.id as WeaponId;
  return null;
}

/**
 * Forge weapons still fresh (plans/forge-weapon-pacing.md), newest first:
 * forged, carried in fewer than `BALANCE.debut.runs` runs, forged fewer than
 * `maxRuns` runs ago, and on no Never list. `recipes.carried` is the Recipe
 * Book's own count of runs that carried each weapon.
 */
export function freshWeapons(profile: Profile): WeaponId[] {
  const D = BALANCE.debut;
  const never = Object.values(profile.tacticsNever);
  const fresh: { id: WeaponId; at: number }[] = [];
  for (const n of FORGE) {
    const id = weaponOf(n);
    const at = profile.forgedAt[n.id];
    if (!id || at === undefined || levelOf(profile, n.id) === 0) continue;
    if ((profile.recipes.carried[id] ?? 0) >= D.runs) continue;
    if (profile.records.runs - at >= D.maxRuns) continue;
    if (never.some((list) => list.includes(id))) continue;
    fresh.push({ id, at });
  }
  // Stable: ties keep the table's order.
  return fresh.sort((a, b) => b.at - a.at).map((f) => f.id);
}

/** True while a node waits for its boss's first fall (§5.1), or a mastery for its star (§9). */
export function isSealed(profile: Profile, node: ForgeNodeDef): boolean {
  if (node.type === 'mastery' && !starGifts(profile).masteries.includes(node.branch)) return true;
  if (node.sealed && !bossDown(profile, node.sealed)) return true;
  // One weapon at a time (plans/forge-weapon-pacing.md): an unbought weapon
  // node waits while another is still fresh from the Forge.
  return weaponOf(node) !== null && levelOf(profile, node.id) === 0 && freshWeapons(profile).length > 0;
}

/** The weapon an unbought weapon node waits on (plans/forge-weapon-pacing.md), once its boss is down; null when none. */
export function forgingWait(profile: Profile, node: ForgeNodeDef): { weapon: WeaponId; runs: number } | null {
  if (!weaponOf(node) || levelOf(profile, node.id) > 0) return null;
  if (node.sealed && !bossDown(profile, node.sealed)) return null;
  const weapon = freshWeapons(profile)[0];
  if (!weapon) return null;
  return { weapon, runs: Math.max(1, BALANCE.debut.runs - (profile.recipes.carried[weapon] ?? 0)) };
}

export const FORGE_WEB = new Web<ForgeNodeDef>({
  nodes: FORGE,
  growth: BALANCE.forge.levelGrowth,
  owned: (p) => p.forge,
  wallet: (p) => p.shards,
  pay: (p, n) => { p.shards -= n; },
  sealed: isSealed,
  refundable: (n) => n.type === 'notable' || n.type === 'keystone',
  beyond: {
    can: (n) => temperable(n),
    open: (p) => bossDown(p, TEMPER_BOSS),
    cost: BALANCE.forge.temper.cost,
    share: BALANCE.forge.temper.share,
    // Act 2: once the Blight falls, tempering is the endless combat sink the
    // masteries were (plans/mastery-capstones.md), on their gentler curve.
    eased: { easy: (p) => bossDown(p, EASE_BOSS), growth: BALANCE.forge.temper.easedGrowth },
  },
});

/** The boss whose first fall opens tempering. */
export const TEMPER_BOSS: BossId = 'gatekeeper';
/** The boss whose first fall puts tempering on its gentler curve (Act 2). */
export const EASE_BOSS: BossId = 'blight';

/** Stats that never temper: the economy, which would feed back into itself. */
const UNTEMPERED: ReadonlySet<StatKey> = new Set<StatKey>(['shardGain', 'xpGain']);

/** A minor whose every effect is a percentage combat stat: it may be tempered past its last level. */
export function temperable(node: ForgeNodeDef): boolean {
  return node.type === 'minor' && node.effects.length > 0
    && node.effects.every((e) => e.kind === 'stat' && e.mod.pct !== undefined && !UNTEMPERED.has(e.mod.key));
}

export function neighbours(id: string): readonly string[] {
  return FORGE_WEB.neighbours(id);
}

export function levelOf(profile: Profile, id: string): number {
  return FORGE_WEB.levelOf(profile, id);
}

/** Shards for the next level of `node`, given `owned` levels already bought, at `profile`'s prices. */
export function nodeCost(node: ForgeNodeDef, owned: number, profile?: Profile): number {
  return FORGE_WEB.cost(node, owned, profile);
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
  const first = levelOf(profile, id) === 0;
  if (!FORGE_WEB.buy(profile, id)) return false;
  // A weapon fresh from the Forge (plans/forge-weapon-pacing.md): stamped with the run count it was bought at.
  const node = FORGE_WEB.node(id);
  if (first && node && weaponOf(node)) profile.forgedAt[id] = profile.records.runs;
  return true;
}

/** A refund may not strand an owned node (§5.1). */
export function canRefund(profile: Profile, id: string): boolean {
  return FORGE_WEB.canRefund(profile, id);
}

export function refundNode(profile: Profile, id: string): boolean {
  if (!FORGE_WEB.refund(profile, id)) return false;
  // Bought again, a keystone starts on.
  profile.keystonesOff = profile.keystonesOff.filter((k) => k !== id);
  delete profile.forgedAt[id];
  return true;
}

/** A keystone is a trade (§11.4): once owned, it can be switched off between runs, and on again, for free. */
export function canSwitch(profile: Profile, id: string): boolean {
  return FORGE_WEB.node(id)?.type === 'keystone' && levelOf(profile, id) > 0;
}

/** True when an owned keystone is switched off: it stays owned, but no run feels it. */
export function isSwitchedOff(profile: Profile, id: string): boolean {
  return profile.keystonesOff.includes(id);
}

/** Switch an owned keystone off, or back on. False when it isn't an owned keystone. */
export function toggleKeystone(profile: Profile, id: string): boolean {
  if (!canSwitch(profile, id)) return false;
  const i = profile.keystonesOff.indexOf(id);
  if (i >= 0) profile.keystonesOff.splice(i, 1);
  else profile.keystonesOff.push(id);
  return true;
}

/** The "Next:" line (§4.6, §7.4): the cheapest node that can be bought, and how close it is. */
export type ForgeGoal = WebGoal<ForgeNodeDef>;

export function nextGoal(profile: Profile): ForgeGoal | null {
  return FORGE_WEB.nextGoal(profile);
}

/** Owned nodes with their levels, in table order. */
export function ownedNodes(profile: Profile): { node: ForgeNodeDef; level: number }[] {
  return FORGE_WEB.ownedNodes(profile);
}

/** Owned nodes less the keystones switched off: what `buildRunConfig` resolves. */
export function activeNodes(profile: Profile): { node: ForgeNodeDef; level: number }[] {
  return ownedNodes(profile).filter((o) => !isSwitchedOff(profile, o.node.id));
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
