import { BALANCE } from './balance';
import { ICON_IDS } from './icons';
import type {
  ContentEntry, EnemyDef, ForgeNodeDef, FrameDef, PassiveDef, RegionDef, WeaponDef,
} from './types';

/** Longest a card, node or relic line may be (§12.6). */
export const MAX_TEXT_WORDS = 15;

/** Least damage multiplier a weapon level with no visible change may give (§4.4). */
export const MIN_DAMAGE_STEP = 1.25;

export interface LintIssue {
  table: string;
  id: string;
  problem: string;
}

/**
 * The content lint (§12.6). Pure: takes the tables, returns every problem.
 * Rules are added with the content they guard; each one is a function from
 * the tables to issues, so a failing rule names exactly what to fix.
 */
export type LintRule = (tables: Readonly<Record<string, readonly ContentEntry[]>>) => LintIssue[];

const ICONS = new Set<string>(ICON_IDS);

export const uniqueIds: LintRule = (tables) => {
  const out: LintIssue[] = [];
  for (const [table, entries] of Object.entries(tables)) {
    const seen = new Set<string>();
    for (const e of entries) {
      if (seen.has(e.id)) out.push({ table, id: e.id, problem: 'duplicate id' });
      seen.add(e.id);
    }
  }
  return out;
};

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export const entryBasics: LintRule = (tables) => {
  const out: LintIssue[] = [];
  for (const [table, entries] of Object.entries(tables)) {
    for (const e of entries) {
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(e.id)) out.push({ table, id: e.id, problem: 'id is not kebab-case' });
      if (!e.name.trim()) out.push({ table, id: e.id, problem: 'missing name' });
      if (!ICONS.has(e.icon)) out.push({ table, id: e.id, problem: `unknown icon "${e.icon}"` });
      const words = wordCount(e.text);
      if (words === 0) out.push({ table, id: e.id, problem: 'missing text' });
      if (words > MAX_TEXT_WORDS) out.push({ table, id: e.id, problem: `text is ${words} words (max ${MAX_TEXT_WORDS})` });
    }
  }
  return out;
};

/** Cross-references resolve: region pools and beats name real enemies, frames real weapons. */
export const references: LintRule = (tables) => {
  const out: LintIssue[] = [];
  const enemies = new Set((tables.enemies as readonly EnemyDef[] | undefined ?? []).map((e) => e.id));
  const weapons = new Set((tables.weapons as readonly WeaponDef[] | undefined ?? []).map((w) => w.id));
  for (const r of (tables.regions as readonly RegionDef[] | undefined) ?? []) {
    for (const p of r.pool) {
      if (!enemies.has(p.enemy)) out.push({ table: 'regions', id: r.id, problem: `pool names unknown enemy "${p.enemy}"` });
    }
    for (const [wave, beat] of Object.entries(r.beats)) {
      if (beat.kind === 'introduce' && !enemies.has(beat.enemy)) {
        out.push({ table: 'regions', id: r.id, problem: `wave ${wave} introduces unknown enemy "${beat.enemy}"` });
      }
    }
    const types = new Set(r.pool.map((p) => p.enemy));
    if (types.size !== 3) out.push({ table: 'regions', id: r.id, problem: `has ${types.size} enemy types (want 3)` });
  }
  for (const f of (tables.frames as readonly FrameDef[] | undefined) ?? []) {
    if (!weapons.has(f.startingWeapon)) out.push({ table: 'frames', id: f.id, problem: `unknown starting weapon "${f.startingWeapon}"` });
  }
  return out;
};

/**
 * Every level is a card (§4.4): a weapon has one step per level past the
 * first, each with its own line, and a passive moves at least one stat.
 * Ultimates are on a button, so their text obeys R4 too.
 */
export const levels: LintRule = (tables) => {
  const out: LintIssue[] = [];
  for (const w of (tables.weapons as readonly WeaponDef[] | undefined) ?? []) {
    if (w.steps.length !== BALANCE.maxLevel - 1) {
      out.push({ table: 'weapons', id: w.id, problem: `has ${w.steps.length} level steps (want ${BALANCE.maxLevel - 1})` });
    }
    w.steps.forEach((s, i) => {
      const words = wordCount(s.text);
      if (words === 0 || words > MAX_TEXT_WORDS) {
        out.push({ table: 'weapons', id: w.id, problem: `level ${i + 2} text is ${words} words` });
      }
      if (!s.add && (s.damageMult ?? 1) === 1) {
        out.push({ table: 'weapons', id: w.id, problem: `level ${i + 2} changes nothing` });
      } else if (!s.add && (s.damageMult ?? 1) < MIN_DAMAGE_STEP) {
        // §4.4: a level is a visible step or a damage step big enough to feel.
        out.push({ table: 'weapons', id: w.id, problem: `level ${i + 2} is only ×${s.damageMult} damage (want ≥ ×${MIN_DAMAGE_STEP})` });
      }
    });
  }
  for (const p of (tables.passives as readonly PassiveDef[] | undefined) ?? []) {
    if (p.perLevel.length === 0) out.push({ table: 'passives', id: p.id, problem: 'moves no stat' });
  }
  for (const f of (tables.frames as readonly FrameDef[] | undefined) ?? []) {
    const words = wordCount(f.ultimate.text);
    if (words === 0 || words > MAX_TEXT_WORDS) out.push({ table: 'frames', id: f.id, problem: `ultimate text is ${words} words` });
  }
  return out;
};

/**
 * The Forge web holds together (§12.6): links name real nodes one ring in or
 * on the same ring, every node is reachable from the root, the costs and
 * levels are sane, the unlocks name real cards, and minors stay at most 60%
 * of the web (§5.1).
 */
export const forgeWeb: LintRule = (tables) => {
  const out: LintIssue[] = [];
  const nodes = (tables.forge as readonly ForgeNodeDef[] | undefined) ?? [];
  if (nodes.length === 0) return out;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const cards = new Set([
    ...((tables.weapons as readonly WeaponDef[] | undefined) ?? []).map((w) => w.id as string),
    ...((tables.passives as readonly PassiveDef[] | undefined) ?? []).map((p) => p.id as string),
  ]);
  const issue = (id: string, problem: string): void => { out.push({ table: 'forge', id, problem }); };
  for (const n of nodes) {
    if (n.maxLevel < 1) issue(n.id, 'max level below 1');
    if (n.type !== 'minor' && n.effects.some((e) => e.kind === 'stat') && n.maxLevel > 1) {
      issue(n.id, 'a stat with levels is a minor');
    }
    if (!(n.cost > 0)) issue(n.id, 'cost must be positive');
    if (n.effects.length === 0) issue(n.id, 'has no effect');
    if (n.ring < 1) issue(n.id, 'ring below 1');
    if (n.links.length === 0 && n.ring !== 1) issue(n.id, 'only ring 1 may hang from the root');
    for (const l of n.links) {
      const to = byId.get(l);
      if (!to) issue(n.id, `links to unknown node "${l}"`);
      else if (to.ring > n.ring || to.ring < n.ring - 1) issue(n.id, `links across rings to "${l}"`);
    }
    for (const e of n.effects) {
      if (e.kind === 'unlockCard' && !cards.has(e.id)) issue(n.id, `unlocks unknown card "${e.id}"`);
    }
  }
  // Reachability: walk outward from the root over links in both directions.
  const adj = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  for (const n of nodes) for (const l of n.links) if (adj.has(l)) { adj.get(n.id)!.push(l); adj.get(l)!.push(n.id); }
  const reached = new Set(nodes.filter((n) => n.links.length === 0).map((n) => n.id));
  const queue = [...reached];
  while (queue.length > 0) {
    for (const m of adj.get(queue.pop()!) ?? []) if (!reached.has(m)) { reached.add(m); queue.push(m); }
  }
  for (const n of nodes) if (!reached.has(n.id)) issue(n.id, 'unreachable from the root');
  const minors = nodes.filter((n) => n.type === 'minor').length;
  if (minors > nodes.length * 0.6) issue('*', `${minors} of ${nodes.length} nodes are minors (max 60%)`);
  return out;
};

export const RULES: readonly LintRule[] = [uniqueIds, entryBasics, references, levels, forgeWeb];

export function lintContent(
  tables: Readonly<Record<string, readonly ContentEntry[]>>,
  rules: readonly LintRule[] = RULES,
): LintIssue[] {
  return rules.flatMap((rule) => rule(tables));
}
