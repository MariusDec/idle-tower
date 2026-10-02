import { ABYSS_INDEX } from './abyss';
import { BALANCE } from './balance';
import { ICON_IDS } from './icons';
import type {
  AuraDef, BossDef, ContentEntry, EnemyDef, EvolutionDef, FeatDef, FrameDef, PactDef, PassiveDef, RegionDef, RelicDef, WeaponDef, WebNodeDef,
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
 * A web holds together (§12.6): links name real nodes one ring in or on the
 * same ring, every node is reachable from the root, the costs and levels are
 * sane, the unlocks name real cards, minors stay at most 60% of the web
 * (§5.1), and a mastery (§9) is endless and hangs from its own branch.
 */
function webRule(table: 'forge' | 'stars'): LintRule {
  return (tables) => lintWeb(tables, table);
}

function lintWeb(tables: Readonly<Record<string, readonly ContentEntry[]>>, table: string): LintIssue[] {
  const out: LintIssue[] = [];
  const nodes = (tables[table] as readonly WebNodeDef[] | undefined) ?? [];
  if (nodes.length === 0) return out;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const cards = new Set([
    ...((tables.weapons as readonly WeaponDef[] | undefined) ?? []).map((w) => w.id as string),
    ...((tables.passives as readonly PassiveDef[] | undefined) ?? []).map((p) => p.id as string),
  ]);
  const issue = (id: string, problem: string): void => { out.push({ table, id, problem }); };
  for (const n of nodes) {
    if (n.maxLevel < 1) issue(n.id, 'max level below 1');
    if (n.type === 'mastery') {
      if (n.maxLevel !== Infinity) issue(n.id, 'a mastery has no last level');
      if (n.links.some((l) => byId.get(l)?.branch !== n.branch)) issue(n.id, 'a mastery hangs from its own branch');
    } else if (n.maxLevel === Infinity) {
      issue(n.id, 'only a mastery is endless');
    }
    if (n.type !== 'minor' && n.type !== 'mastery' && n.effects.some((e) => e.kind === 'stat') && n.maxLevel > 1) {
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
}

export const forgeWeb: LintRule = webRule('forge');
export const starWeb: LintRule = webRule('stars');

/**
 * Pacts hold together (§9): 3–5 ranks each, and every region says what the
 * Blight Surge does there, in a line that obeys R4.
 */
export const pacts: LintRule = (tables) => {
  const out: LintIssue[] = [];
  for (const p of (tables.pacts as readonly PactDef[] | undefined) ?? []) {
    if (p.ranks < 3 || p.ranks > 5) out.push({ table: 'pacts', id: p.id, problem: `has ${p.ranks} ranks (want 3–5)` });
  }
  for (const r of (tables.regions as readonly RegionDef[] | undefined) ?? []) {
    const words = wordCount(r.surge.text);
    if (words === 0 || words > MAX_TEXT_WORDS) out.push({ table: 'regions', id: r.id, problem: `surge text is ${words} words` });
    if (r.surge.effect.kind === 'rule' && !r.rule) out.push({ table: 'regions', id: r.id, problem: 'surges a rule it does not have' });
  }
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
  // The Abyss (§9) counts as a region where a feat or relic names one.
  const regionIdx = new Set([...regions.map((r) => r.index), ABYSS_INDEX]);
  const enemies = new Set((tables.enemies as readonly EnemyDef[] | undefined ?? []).map((e) => e.id as string));
  const auras = new Set((tables.auras as readonly AuraDef[] | undefined ?? []).map((a) => a.id as string));
  for (const r of regions) {
    if (!bossIds.has(r.boss)) out.push({ table: 'regions', id: r.id, problem: `unknown boss "${r.boss}"` });
    for (const a of r.elites.auras) if (!auras.has(a)) out.push({ table: 'regions', id: r.id, problem: `unknown aura "${a}"` });
    if (r.rule && wordCount(r.rule.text) > MAX_TEXT_WORDS) out.push({ table: 'regions', id: r.id, problem: 'rule text too long' });
    const n = relics.filter((x) => (x.source.kind === 'elite' ? x.source.region === r.index : x.source.kind === 'boss' && x.source.boss === r.boss)).length;
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
    // An Abyss boss (§9) holds the Abyss's fifth floors, not a region.
    if (!b.abyss && !regions.some((r) => r.boss === b.id)) out.push({ table: 'bosses', id: b.id, problem: 'no region has this boss' });
  }
  for (const x of relics) {
    if (x.source.kind === 'boss' && !bossIds.has(x.source.boss)) out.push({ table: 'relics', id: x.id, problem: `unknown boss "${x.source.boss}"` });
    if (x.source.kind === 'elite' && !regionIdx.has(x.source.region)) out.push({ table: 'relics', id: x.id, problem: `unknown region ${x.source.region}` });
  }
  for (const n of (tables.forge as readonly WebNodeDef[] | undefined) ?? []) {
    if (n.sealed && !bossIds.has(n.sealed)) out.push({ table: 'forge', id: n.id, problem: `sealed by unknown boss "${n.sealed}"` });
  }
  // Abyss relics come in sets of three (§9), and each set is lit by a star.
  const sets = new Map<number, number>();
  for (const x of relics) if (x.source.kind === 'abyss') sets.set(x.source.set, (sets.get(x.source.set) ?? 0) + 1);
  const lit = new Set(((tables.stars as readonly WebNodeDef[] | undefined) ?? []).flatMap((n) => n.effects).flatMap((e) => (e.kind === 'relics' ? [e.set] : [])));
  for (const [set, n] of sets) {
    if (n !== 3) out.push({ table: 'relics', id: `set-${set}`, problem: `Abyss set ${set} has ${n} relics (want 3)` });
    if (tables.stars && !lit.has(set)) out.push({ table: 'relics', id: `set-${set}`, problem: `no star lights Abyss set ${set}` });
  }
  for (const f of (tables.feats as readonly FeatDef[] | undefined) ?? []) {
    const g = f.goal;
    if (g.kind === 'boss' && !bossIds.has(g.boss)) out.push({ table: 'feats', id: f.id, problem: `unknown boss "${g.boss}"` });
    if (g.kind === 'bestiary' && !regionIdx.has(g.region)) out.push({ table: 'feats', id: f.id, problem: `unknown region ${g.region}` });
    if (!(f.reward > 0)) out.push({ table: 'feats', id: f.id, problem: 'reward must be positive' });
  }
  const starFrames = new Set(((tables.stars as readonly WebNodeDef[] | undefined) ?? []).flatMap((n) => n.effects).flatMap((e) => (e.kind === 'frame' ? [e.id as string] : [])));
  for (const f of (tables.frames as readonly FrameDef[] | undefined) ?? []) {
    if (f.unlock.kind === 'boss' && !bossIds.has(f.unlock.boss)) out.push({ table: 'frames', id: f.id, problem: `unlocked by unknown boss "${f.unlock.boss}"` });
    if (f.unlock.kind === 'star' && tables.stars && !starFrames.has(f.id)) out.push({ table: 'frames', id: f.id, problem: 'no star lights this frame' });
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
  // A starred passive (§9) joins only through a star: one must light it.
  const starCards = new Set(((tables.stars as readonly WebNodeDef[] | undefined) ?? []).flatMap((n) => n.effects).flatMap((e) => (e.kind === 'unlockCard' ? [e.id as string] : [])));
  for (const p of passives) {
    if (p.joinsWith && !weaponIds.has(p.joinsWith)) out.push({ table: 'passives', id: p.id, problem: `joins with unknown weapon "${p.joinsWith}"` });
    if (p.starred && tables.stars && !starCards.has(p.id)) out.push({ table: 'passives', id: p.id, problem: 'no star lights this passive' });
  }
  return out;
};

/** Weapons a star lights are Act 2's (§9); the rest are the Forge's, Act 1's. */
function act1Weapons(tables: Readonly<Record<string, readonly ContentEntry[]>>): WeaponDef[] {
  const starCards = new Set(((tables.stars as readonly WebNodeDef[] | undefined) ?? []).flatMap((n) => n.effects).flatMap((e) => (e.kind === 'unlockCard' ? [e.id as string] : [])));
  return ((tables.weapons as readonly WeaponDef[] | undefined) ?? []).filter((w) => !starCards.has(w.id));
}

/**
 * Every region's enemies are answered (T3a): each type in a pool is in the
 * `counters` of at least one Act 1 weapon, so the scorer can draft for it;
 * `counters` and `weakAgainst` name real enemies and never the same one.
 */
export const counters: LintRule = (tables) => {
  const out: LintIssue[] = [];
  const weapons = (tables.weapons as readonly WeaponDef[] | undefined) ?? [];
  if (weapons.length === 0) return out;
  const enemies = new Set((tables.enemies as readonly EnemyDef[] | undefined ?? []).map((e) => e.id as string));
  for (const w of weapons) {
    for (const id of [...w.counters, ...(w.weakAgainst ?? [])]) {
      if (enemies.size > 0 && !enemies.has(id)) out.push({ table: 'weapons', id: w.id, problem: `counters names unknown enemy "${id}"` });
    }
    for (const id of w.weakAgainst ?? []) {
      if (w.counters.includes(id)) out.push({ table: 'weapons', id: w.id, problem: `both counters and is weak against "${id}"` });
    }
  }
  const answered = new Set(act1Weapons(tables).flatMap((w) => w.counters as readonly string[]));
  for (const r of (tables.regions as readonly RegionDef[] | undefined) ?? []) {
    for (const p of r.pool) {
      if (!answered.has(p.enemy)) out.push({ table: 'regions', id: r.id, problem: `no Act 1 weapon counters "${p.enemy}"` });
    }
  }
  return out;
};

/**
 * One name, one thing (T3c): no two entries share a name, except a web node
 * named for the card it unlocks and a star that opens a Forge mastery of
 * the same name. A frame's ultimate counts as an entry.
 */
export const uniqueNames: LintRule = (tables) => {
  const out: LintIssue[] = [];
  const byName = new Map<string, { table: string; e: ContentEntry }[]>();
  const add = (table: string, e: ContentEntry, name = e.name): void => {
    const list = byName.get(name) ?? [];
    list.push({ table, e });
    byName.set(name, list);
  };
  for (const [table, entries] of Object.entries(tables)) {
    for (const e of entries) {
      add(table, e);
      if (table === 'frames') add(table, e, (e as FrameDef).ultimate.name);
    }
  }
  const echoes = (x: { table: string; e: ContentEntry }, all: readonly { table: string; e: ContentEntry }[]): boolean => {
    if (x.table !== 'forge' && x.table !== 'stars') return false;
    const effects = (x.e as WebNodeDef).effects;
    return effects.some((f) => (f.kind === 'unlockCard' && all.some((o) => o.e.id === f.id && o.table !== x.table))
      || (f.kind === 'mastery' && all.some((o) => o.table === 'forge' && (o.e as WebNodeDef).type === 'mastery')));
  };
  for (const [name, list] of byName) {
    const own = list.filter((x) => !echoes(x, list));
    if (own.length > 1) out.push({ table: own[1].table, id: own[1].e.id, problem: `name "${name}" is also ${own[0].table}:${own[0].e.id}` });
  }
  return out;
};

/**
 * A relic that grants a behaviour the Forge or the stars also grant says how
 * the two stack (T3d), in words: "stacks", or "once more".
 */
export const stacking: LintRule = (tables) => {
  const out: LintIssue[] = [];
  const web = [...((tables.forge as readonly WebNodeDef[] | undefined) ?? []), ...((tables.stars as readonly WebNodeDef[] | undefined) ?? [])];
  const shared = new Set(web.flatMap((n) => n.effects).flatMap((e) => (e.kind === 'behaviour' ? [e.id as string] : [])));
  for (const x of (tables.relics as readonly RelicDef[] | undefined) ?? []) {
    const ids = x.effects.flatMap((e) => (e.kind === 'behaviour' ? [e.id as string] : []));
    if (ids.some((id) => shared.has(id)) && !/stack|once more/i.test(x.text)) {
      out.push({ table: 'relics', id: x.id, problem: 'shares a Forge behaviour but does not say how it stacks' });
    }
  }
  return out;
};

export const RULES: readonly LintRule[] = [
  uniqueIds, entryBasics, references, levels, forgeWeb, starWeb, pacts, bossesAndLoot, evolutions, counters, uniqueNames, stacking,
];

/**
 * Icons shared by unrelated entries (T3b): a report, not a rule, since some
 * sharing is deliberate. A web node and the card it unlocks, a mastery and
 * its star, or a feat and the boss it names are related; the rest are listed
 * by `npm run content-report` for an artist to look over.
 */
export function sharedIcons(tables: Readonly<Record<string, readonly ContentEntry[]>>): { icon: string; entries: string[] }[] {
  const byIcon = new Map<string, string[]>();
  for (const [table, entries] of Object.entries(tables)) {
    for (const e of entries) {
      const list = byIcon.get(e.icon) ?? [];
      list.push(`${table}:${e.id}`);
      byIcon.set(e.icon, list);
    }
  }
  const unlocks = new Map<string, string>();
  for (const t of ['forge', 'stars']) {
    for (const n of (tables[t] as readonly WebNodeDef[] | undefined) ?? []) {
      for (const f of n.effects) if (f.kind === 'unlockCard') unlocks.set(`${t}:${n.id}`, f.id);
    }
  }
  const out: { icon: string; entries: string[] }[] = [];
  for (const [icon, list] of byIcon) {
    // Drop a node that only repeats the icon of the card it unlocks.
    const own = list.filter((k) => !list.some((o) => unlocks.get(k) !== undefined && o.endsWith(`:${unlocks.get(k)}`) && o !== k));
    if (own.length > 1) out.push({ icon, entries: own });
  }
  return out.sort((a, b) => b.entries.length - a.entries.length);
}

export function lintContent(
  tables: Readonly<Record<string, readonly ContentEntry[]>>,
  rules: readonly LintRule[] = RULES,
): LintIssue[] {
  return rules.flatMap((rule) => rule(tables));
}
