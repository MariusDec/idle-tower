import { BALANCE } from './balance';
import { ICON_IDS } from './icons';
import type {
  AuraDef, BossDef, ContentEntry, EnemyDef, EvolutionDef, FeatDef, ForgeNodeDef, FrameDef, PassiveDef, RegionDef, RelicDef, WeaponDef,
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

/**
 * Bosses, relics, feats and seals hold together (§12.6): every region has a
 * boss that exists and three enemies; a boss's phases start at full HP and
 * step down, each with a line of 15 words or fewer, and summon real enemies;
 * every relic, seal, feat and frame names a real boss or region; elites wear
 * real auras; and each region gives four relics.
 */
export const bossesAndLoot: LintRule = (tables) => {
  const out: LintIssue[] = [];
  const bosses = (tables.bosses as readonly BossDef[] | undefined) ?? [];
  const regions = (tables.regions as readonly RegionDef[] | undefined) ?? [];
  const relics = (tables.relics as readonly RelicDef[] | undefined) ?? [];
  const bossIds = new Set<string>(bosses.map((b) => b.id));
  const regionIdx = new Set(regions.map((r) => r.index));
  const enemies = new Set((tables.enemies as readonly EnemyDef[] | undefined ?? []).map((e) => e.id as string));
  const auras = new Set((tables.auras as readonly AuraDef[] | undefined ?? []).map((a) => a.id as string));
  for (const r of regions) {
    if (!bossIds.has(r.boss)) out.push({ table: 'regions', id: r.id, problem: `unknown boss "${r.boss}"` });
    for (const a of r.elites.auras) if (!auras.has(a)) out.push({ table: 'regions', id: r.id, problem: `unknown aura "${a}"` });
    if (r.rule && wordCount(r.rule.text) > MAX_TEXT_WORDS) out.push({ table: 'regions', id: r.id, problem: 'rule text too long' });
    const n = relics.filter((x) => (x.source.kind === 'elite' ? x.source.region === r.index : x.source.boss === r.boss)).length;
    if (relics.length > 0 && n !== 4) out.push({ table: 'regions', id: r.id, problem: `gives ${n} relics (want 4)` });
  }
  for (const b of bosses) {
    if (b.phases.length === 0 || b.phases[0].below !== 1) out.push({ table: 'bosses', id: b.id, problem: 'first phase must start at full HP' });
    b.phases.forEach((ph, i) => {
      if (i > 0 && ph.below >= b.phases[i - 1].below) out.push({ table: 'bosses', id: b.id, problem: `phase ${i + 1} does not step down` });
      const words = wordCount(ph.line);
      if (words === 0 || words > MAX_TEXT_WORDS) out.push({ table: 'bosses', id: b.id, problem: `phase ${i + 1} line is ${words} words` });
      for (const p of ph.patterns) {
        if (p.kind === 'summon' && !enemies.has(p.enemy)) out.push({ table: 'bosses', id: b.id, problem: `summons unknown enemy "${p.enemy}"` });
      }
    });
    if (!regions.some((r) => r.boss === b.id)) out.push({ table: 'bosses', id: b.id, problem: 'no region has this boss' });
  }
  for (const x of relics) {
    if (x.source.kind === 'boss' && !bossIds.has(x.source.boss)) out.push({ table: 'relics', id: x.id, problem: `unknown boss "${x.source.boss}"` });
    if (x.source.kind === 'elite' && !regionIdx.has(x.source.region)) out.push({ table: 'relics', id: x.id, problem: `unknown region ${x.source.region}` });
  }
  for (const n of (tables.forge as readonly ForgeNodeDef[] | undefined) ?? []) {
    if (n.sealed && !bossIds.has(n.sealed)) out.push({ table: 'forge', id: n.id, problem: `sealed by unknown boss "${n.sealed}"` });
  }
  for (const f of (tables.feats as readonly FeatDef[] | undefined) ?? []) {
    const g = f.goal;
    if (g.kind === 'boss' && !bossIds.has(g.boss)) out.push({ table: 'feats', id: f.id, problem: `unknown boss "${g.boss}"` });
    if (g.kind === 'bestiary' && !regionIdx.has(g.region)) out.push({ table: 'feats', id: f.id, problem: `unknown region ${g.region}` });
    if (!(f.reward > 0)) out.push({ table: 'feats', id: f.id, problem: 'reward must be positive' });
  }
  for (const f of (tables.frames as readonly FrameDef[] | undefined) ?? []) {
    if (f.unlock.kind === 'boss' && !bossIds.has(f.unlock.boss)) out.push({ table: 'frames', id: f.id, problem: `unlocked by unknown boss "${f.unlock.boss}"` });
  }
  return out;
};

/**
 * Evolutions hold together (§12.6): each names a real weapon and a real
 * partner passive, every weapon has exactly one, no passive partners two,
 * and the riddle obeys R4. A passive that joins with a weapon names a real one.
 */
export const evolutions: LintRule = (tables) => {
  const out: LintIssue[] = [];
  const evos = (tables.evolutions as readonly EvolutionDef[] | undefined) ?? [];
  if (evos.length === 0) return out;
  const weapons = (tables.weapons as readonly WeaponDef[] | undefined) ?? [];
  const passives = (tables.passives as readonly PassiveDef[] | undefined) ?? [];
  const passiveIds = new Set<string>(passives.map((p) => p.id));
  const weaponIds = new Set<string>(weapons.map((w) => w.id));
  const partners = new Set<string>();
  for (const e of evos) {
    if (!weaponIds.has(e.weapon)) out.push({ table: 'evolutions', id: e.id, problem: `unknown weapon "${e.weapon}"` });
    if (!passiveIds.has(e.passive)) out.push({ table: 'evolutions', id: e.id, problem: `unknown partner passive "${e.passive}"` });
    if (partners.has(e.passive)) out.push({ table: 'evolutions', id: e.id, problem: `passive "${e.passive}" already partners another` });
    partners.add(e.passive);
    const words = wordCount(e.hint);
    if (words === 0 || words > MAX_TEXT_WORDS) out.push({ table: 'evolutions', id: e.id, problem: `hint is ${words} words` });
  }
  for (const w of weapons) {
    const n = evos.filter((e) => e.weapon === w.id).length;
    if (n !== 1) out.push({ table: 'weapons', id: w.id, problem: `has ${n} evolutions (want 1)` });
  }
  for (const p of passives) {
    if (p.joinsWith && !weaponIds.has(p.joinsWith)) out.push({ table: 'passives', id: p.id, problem: `joins with unknown weapon "${p.joinsWith}"` });
  }
  return out;
};

export const RULES: readonly LintRule[] = [uniqueIds, entryBasics, references, levels, forgeWeb, bossesAndLoot, evolutions];

export function lintContent(
  tables: Readonly<Record<string, readonly ContentEntry[]>>,
  rules: readonly LintRule[] = RULES,
): LintIssue[] {
  return rules.flatMap((rule) => rule(tables));
}
