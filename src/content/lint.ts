import { ABYSS_INDEX } from './abyss';
import { BALANCE } from './balance';
import { ICON_IDS, isUiGlyph } from './icons';
import { EXPLAINERS } from './explainers';
import { CONTRACT_OMENS, QUARRY, contractText } from './contracts';
import { OMEN_MODS } from './omens';
import { BOSSES } from './bosses';
import { EVOLUTIONS } from './evolutions';
import { FRAMES } from './frames';
import { FUSIONS } from './fusions';
import { REGIONS } from './regions';
import { RUSH_STAGES } from './rush';
import { WEAPONS } from './weapons';
import { STRATA, STRATUM_FLOORS, type StratumDef } from './strata';
import type {
  ContractMod, ContractTarget, OmenModDef, AnomalyDef, AuraDef, BossDef, BossPhase, SecretDef, SecretNeeds, ContentEntry, EnemyDef, EvolutionDef, FeatDef, FrameDef, FusionDef, PactDef, PassiveDef, RegionDef, RelicDef, RiftDef, TrialDef, WeaponDef, WebNodeDef,
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
      // Content is illustrated with game-icons; Ionicons are UI chrome (plans/visual-identity.md §8.1).
      if (isUiGlyph(e.icon)) out.push({ table, id: e.id, problem: `"${e.icon}" is a UI glyph, not content artwork` });
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
  const patterns = new Map<string, string>();
  for (const w of (tables.weapons as readonly WeaponDef[] | undefined) ?? []) {
    // T1: a hit is credited to the weapon its pattern names.
    const twin = patterns.get(w.pattern);
    if (twin) out.push({ table: 'weapons', id: w.id, problem: `shares pattern "${w.pattern}" with ${twin}` });
    patterns.set(w.pattern, w.id);
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
 * Pacts hold together (§9): 3–9 ranks each (a heavy pact is graded finer,
 * D-7), and every region says what the Blight Surge does there, in a line
 * that obeys R4.
 */
export const pacts: LintRule = (tables) => {
  const out: LintIssue[] = [];
  for (const p of (tables.pacts as readonly PactDef[] | undefined) ?? []) {
    if (p.ranks < 3 || p.ranks > 9) out.push({ table: 'pacts', id: p.id, problem: `has ${p.ranks} ranks (want 3–9)` });
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
    // An Abyss boss (§9) guards a stratum, not a region.
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
      // A Trial's notable or trim is named like a node: it must not echo one (N5).
      if (table === 'trials') {
        const r = (e as TrialDef).reward;
        if (r.kind !== 'relic') add(table, e, r.name);
      }
    }
  }
  const echoes = (x: { table: string; e: ContentEntry }, all: readonly { table: string; e: ContentEntry }[]): boolean => {
    if (x.table !== 'forge' && x.table !== 'stars') return false;
    const effects = (x.e as WebNodeDef).effects;
    return effects.some((f) => ((f.kind === 'unlockCard' || f.kind === 'fusion') && all.some((o) => o.e.id === f.id && o.table !== x.table))
      || (f.kind === 'mastery' && all.some((o) => o.table === 'forge' && (o.e as WebNodeDef).type === 'mastery')));
  };
  for (const [name, list] of byName) {
    const own = list.filter((x) => !echoes(x, list));
    if (own.length > 1) out.push({ table: own[1].table, id: own[1].e.id, problem: `name "${name}" is also ${own[0].table}:${own[0].e.id}` });
  }
  return out;
};

/**
 * Fusions hold together (N9): two different real weapons, no weapon in two
 * fusions, a hint that obeys R4, and a star that lights each one.
 */
export const fusions: LintRule = (tables) => {
  const out: LintIssue[] = [];
  const list = (tables.fusions as readonly FusionDef[] | undefined) ?? [];
  const weaponIds = new Set<string>(((tables.weapons as readonly WeaponDef[] | undefined) ?? []).map((w) => w.id));
  const lit = new Set(((tables.stars as readonly WebNodeDef[] | undefined) ?? []).flatMap((n) => n.effects).flatMap((e) => (e.kind === 'fusion' ? [e.id as string] : [])));
  const used = new Set<string>();
  for (const f of list) {
    const issue = (problem: string): void => { out.push({ table: 'fusions', id: f.id, problem }); };
    const [a, b] = f.weapons;
    if (a === b) issue('fuses a weapon with itself');
    for (const w of f.weapons) {
      if (!weaponIds.has(w)) issue(`unknown weapon "${w}"`);
      if (used.has(w)) issue(`weapon "${w}" is already in another fusion`);
      used.add(w);
    }
    const words = wordCount(f.hint);
    if (words === 0 || words > MAX_TEXT_WORDS) issue(`hint is ${words} words`);
    if (tables.stars && !lit.has(f.id)) issue('no star lights this fusion');
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

/** Longest a rift's whisper may be (plans/late-game/02 §4). */
export const MAX_WHISPER_WORDS = 8;

/**
 * Rifts (plans/late-game/02 §4): a whisper of ≤ 8 words, one or two choices
 * of ≤ 15 words each, real regions, every Act 1 region with at least two
 * rifts of its own (its regional ones, or ones that start there or before
 * it), and no level or boss swing on a common, which may open where no
 * legendary can.
 */
export const rifts: LintRule = (tables) => {
  const out: LintIssue[] = [];
  const list = (tables.rifts as readonly RiftDef[] | undefined) ?? [];
  const regions = ((tables.regions as readonly RegionDef[] | undefined) ?? []).map((r) => r.index);
  for (const r of list) {
    const words = wordCount(r.text);
    if (words > MAX_WHISPER_WORDS) out.push({ table: 'rifts', id: r.id, problem: `whisper is ${words} words (max ${MAX_WHISPER_WORDS})` });
    if (r.choices.length < 1 || r.choices.length > 2) out.push({ table: 'rifts', id: r.id, problem: `has ${r.choices.length} choices (want 1–2)` });
    r.choices.forEach((c, i) => {
      const n = wordCount(c.text);
      if (n === 0 || n > MAX_TEXT_WORDS) out.push({ table: 'rifts', id: r.id, problem: `choice ${i + 1} is ${n} words` });
      if (c.effects.length === 0) out.push({ table: 'rifts', id: r.id, problem: `choice ${i + 1} does nothing` });
      if (r.rarity === 'common' && c.effects.some((e) => e.kind === 'levels' || e.kind === 'boss')) {
        out.push({ table: 'rifts', id: r.id, problem: `choice ${i + 1}: a level or boss swing on a common` });
      }
    });
    for (const idx of r.where.regions ?? []) {
      if (!regions.includes(idx)) out.push({ table: 'rifts', id: r.id, problem: `names unknown region ${idx}` });
    }
    // A held beat (R2 §2–3) belongs to one region, from a run number on.
    if (r.where.held !== undefined) {
      if (r.where.regions?.length !== 1) out.push({ table: 'rifts', id: r.id, problem: 'is held but names no single region' });
      if (!Number.isInteger(r.where.held) || r.where.held < 1) out.push({ table: 'rifts', id: r.id, problem: `held from run ${r.where.held}` });
    }
  }
  for (const idx of regions) {
    const held = list.filter((r) => r.where.held !== undefined && r.where.regions?.includes(idx));
    if (held.length > 1) out.push({ table: 'regions', id: String(idx), problem: `holds ${held.length} rifts back (want at most one beat)` });
  }
  for (const idx of regions) {
    const own = list.filter((r) => !r.where.placed && !r.where.abyss && !r.where.act2
      && (r.where.regions?.includes(idx) || (r.where.from !== undefined && r.where.from <= idx)));
    if (own.length < 2) out.push({ table: 'regions', id: String(idx), problem: `has ${own.length} rifts of its own (want ≥ 2)` });
  }
  return out;
};

/**
 * Cursed relics (plans/late-game/03 §6): a cursed source has a curse and
 * nothing else does; boon and curse share R4's fifteen words; no damage boon
 * is a `pct` (it would vanish in the meta bucket, §3.5); `leans` names a
 * weapon. A stratum that has any holds three elite relics and one guardian's
 * (the Gate one, the Below four), so a half-shipped stratum fails.
 */
export const cursedRelics: LintRule = (tables) => {
  const out: LintIssue[] = [];
  const relics = (tables.relics as readonly RelicDef[] | undefined) ?? [];
  const weapons = new Set(((tables.weapons as readonly WeaponDef[] | undefined) ?? []).map((w) => w.id as string));
  const byStratum = new Map<string, { elite: number; boss: number }>();
  for (const x of relics) {
    const cursed = x.source.kind === 'cursed';
    if (cursed !== (x.curse !== undefined)) {
      out.push({ table: 'relics', id: x.id, problem: cursed ? 'cursed source but no curse' : 'a curse on a relic that is not cursed' });
    }
    if (x.source.kind !== 'cursed' || !x.curse) continue;
    const words = wordCount(x.text) + wordCount(x.curse.text);
    if (words > MAX_TEXT_WORDS) out.push({ table: 'relics', id: x.id, problem: `boon and curse are ${words} words (max ${MAX_TEXT_WORDS})` });
    if (!/^Curse:/.test(x.curse.text)) out.push({ table: 'relics', id: x.id, problem: 'curse text must start "Curse:"' });
    for (const e of [...x.effects, ...x.perRank, ...x.curse.effects]) {
      if (e.kind === 'stat' && e.mod.key === 'damage' && e.mod.pct !== undefined) {
        out.push({ table: 'relics', id: x.id, problem: 'a damage boon must be a mult, not a pct' });
      }
    }
    if (x.leans !== undefined && weapons.size > 0 && !weapons.has(x.leans)) {
      out.push({ table: 'relics', id: x.id, problem: `leans on unknown weapon "${x.leans}"` });
    }
    const n = byStratum.get(x.source.stratum) ?? { elite: 0, boss: 0 };
    if (x.source.boss) n.boss++;
    else n.elite++;
    byStratum.set(x.source.stratum, n);
  }
  for (const [stratum, n] of byStratum) {
    const want = stratum === 'gate' ? { elite: 0, boss: 1 } : stratum === 'below' ? { elite: 4, boss: 0 } : { elite: 3, boss: 1 };
    if (n.elite !== want.elite || n.boss !== want.boss) {
      out.push({ table: 'relics', id: stratum, problem: `stratum has ${n.elite} elite and ${n.boss} guardian cursed relics (want ${want.elite} and ${want.boss})` });
    }
  }
  return out;
};

/**
 * Anomalies (plans/late-game/04 §6): each names a real weapon, at most one a
 * weapon, with a rule line and step re-wordings inside R4. Names are
 * `uniqueNames`'s, across evolutions, fusions, frames and ultimates.
 */
export const anomalies: LintRule = (tables) => {
  const out: LintIssue[] = [];
  const list = (tables.anomalies as readonly AnomalyDef[] | undefined) ?? [];
  const weapons = new Set(((tables.weapons as readonly WeaponDef[] | undefined) ?? []).map((w) => w.id as string));
  const seen = new Set<string>();
  for (const a of list) {
    if (weapons.size > 0 && !weapons.has(a.weapon)) out.push({ table: 'anomalies', id: a.id, problem: `unknown weapon "${a.weapon}"` });
    if (seen.has(a.weapon)) out.push({ table: 'anomalies', id: a.id, problem: `a second anomaly for ${a.weapon}` });
    seen.add(a.weapon);
    if (!a.rule.trim()) out.push({ table: 'anomalies', id: a.id, problem: 'missing rule line' });
    if ((a.steps?.length ?? 0) > BALANCE.maxLevel - 1) out.push({ table: 'anomalies', id: a.id, problem: 'more step lines than levels' });
    for (const s of a.steps ?? []) {
      if (s !== null && wordCount(s) > MAX_TEXT_WORDS) out.push({ table: 'anomalies', id: a.id, problem: `step "${s}" is over ${MAX_TEXT_WORDS} words` });
    }
  }
  return out;
};

/**
 * Secrets (plans/late-game/05 §5): hint and text inside R4; every weapon,
 * enemy, region, boss, frame and evolution named is real; a form's phases
 * step down from full HP; a relic reward is a `secret` relic, which no other
 * source drops. No spoilers: no secret's name in any feat, star, trial or
 * region text, nor in an explainer (`EXPLAINERS`, passed in by the caller).
 */
export function secretsRule(explainerText: readonly string[] = []): LintRule {
  return (tables) => {
    const out: LintIssue[] = [];
    const list = (tables.secrets as readonly SecretDef[] | undefined) ?? [];
    const ids = (t: string): Set<string> => new Set(((tables[t] as readonly ContentEntry[] | undefined) ?? []).map((e) => e.id));
    const weapons = ids('weapons');
    const enemies = ids('enemies');
    const bosses = ids('bosses');
    const frames = ids('frames');
    const evolutions = ids('evolutions');
    const regions = new Set(((tables.regions as readonly RegionDef[] | undefined) ?? []).map((r) => r.index));
    const relics = (tables.relics as readonly RelicDef[] | undefined) ?? [];
    const known = (set: Set<string | number>, v: string | number | undefined, what: string, id: string): void => {
      if (v !== undefined && set.size > 0 && !set.has(v)) out.push({ table: 'secrets', id, problem: `unknown ${what} "${v}"` });
    };
    const phases = (id: string, ph: readonly BossPhase[]): void => {
      if (ph.length === 0 || ph[0].below !== 1) out.push({ table: 'secrets', id, problem: 'form: first phase must start at full HP' });
      ph.forEach((p, i) => {
        if (i > 0 && p.below >= ph[i - 1].below) out.push({ table: 'secrets', id, problem: `form: phase ${i + 1} does not step down` });
      });
    };
    for (const s of list) {
      const issue = (problem: string): void => { out.push({ table: 'secrets', id: s.id, problem }); };
      const hw = wordCount(s.hint);
      if (hw === 0 || hw > MAX_TEXT_WORDS) issue(`hint is ${hw} words`);
      known(bosses, s.after, 'boss', s.id);
      const needs = (n: SecretNeeds | undefined): void => {
        for (const w of n?.carried ?? []) known(weapons, w, 'weapon', s.id);
        for (const e of n?.evolved ?? []) known(evolutions, e, 'evolution', s.id);
        known(frames, n?.frame, 'frame', s.id);
      };
      const t = s.trigger;
      switch (t.kind) {
        case 'tally':
          known(weapons, t.by, 'weapon', s.id);
          known(enemies, t.enemy, 'enemy', s.id);
          known(regions, t.region, 'region', s.id);
          needs(t.needs);
          if (t.n <= 0) issue('a tally goal must be positive');
          break;
        case 'form':
          known(bosses, t.boss, 'boss', s.id);
          if (t.when.kind === 'needs') needs(t.when.needs);
          if (!s.form) issue('a form secret needs its form');
          else phases(s.id, s.form.phases);
          break;
        case 'brink':
          if (!(t.hp > 0 && t.hp < t.stir && t.stir < 1)) issue('brink: 0 < hp < stir < 1');
          break;
        case 'wayward':
          if (!(t.stir > 0 && t.stir < t.drafts)) issue('wayward: 0 < stir < drafts');
          break;
        default: {
          const exhaustive: never = t;
          return exhaustive;
        }
      }
      if (s.form && t.kind !== 'form') issue('only a form secret has a form');
      if (s.reward.kind === 'relic') {
        const r = relics.find((x) => x.id === (s.reward as { relic: string }).relic);
        if (relics.length > 0 && !r) issue('unknown relic');
        else if (r && r.source.kind !== 'secret') issue(`relic ${r.id} is not a secret relic`);
      }
    }
    // A secret relic is some secret's reward, and only one's.
    for (const r of relics) {
      if (r.source.kind !== 'secret') continue;
      const n = list.filter((s) => s.reward.kind === 'relic' && s.reward.relic === r.id).length;
      if (list.length > 0 && n !== 1) out.push({ table: 'relics', id: r.id, problem: `a secret relic paid by ${n} secrets` });
    }
    // No spoilers: a count, a name or a hint elsewhere says a secret exists.
    const texts: { table: string; id: string; text: string }[] = explainerText.map((text, i) => ({ table: 'explainers', id: String(i), text }));
    for (const table of ['feats', 'stars', 'trials', 'regions']) {
      for (const e of (tables[table] as readonly ContentEntry[] | undefined) ?? []) texts.push({ table, id: e.id, text: `${e.name} ${e.text}` });
    }
    for (const s of list) {
      for (const x of texts) {
        if (x.text.includes(s.name)) out.push({ table: x.table, id: x.id, problem: `names the secret "${s.name}"` });
      }
    }
    return out;
  };
}

/** Final Form names may run to three words (plans/late-game/07 §4, R4). */
const MAX_FORM_NAME_WORDS = 3;

/** Final Forms (plans/late-game/07 §4): every frame has one, its name ≤ 3 words and its line inside R4. */
export const forms: LintRule = (tables) => {
  const out: LintIssue[] = [];
  for (const f of (tables.frames as readonly FrameDef[] | undefined) ?? []) {
    const form = f.form as FrameDef['form'] | undefined;
    if (!form || !form.name.trim() || !form.text.trim()) {
      out.push({ table: 'frames', id: f.id, problem: 'missing Final Form' });
      continue;
    }
    if (wordCount(form.name) > MAX_FORM_NAME_WORDS) out.push({ table: 'frames', id: f.id, problem: `form name is over ${MAX_FORM_NAME_WORDS} words` });
    const words = wordCount(form.text);
    if (words > MAX_TEXT_WORDS) out.push({ table: 'frames', id: f.id, problem: `form text is ${words} words (max ${MAX_TEXT_WORDS})` });
  }
  return out;
};

/**
 * The strata (plans/late-game/08 §6): each has six floors, its guests are
 * Act 1 types and its natives the Abyss's own, floors 1–5 end on a native
 * Keeper and the sixth on its guardian (an Abyss boss), the rule's line
 * fits R4, a Gates floor has gates, and a guardian's `rule` pattern wears a
 * rule of its own stratum or one above.
 */
export function strataRule(strata: readonly StratumDef[] = STRATA): LintRule {
  return (tables) => {
    const out: LintIssue[] = [];
    const bosses = new Map(((tables.bosses as readonly BossDef[] | undefined) ?? []).map((b) => [b.id as string, b]));
    const enemies = new Set(((tables.enemies as readonly EnemyDef[] | undefined) ?? []).map((e) => e.id as string));
    const auras = new Set(((tables.auras as readonly AuraDef[] | undefined) ?? []).map((a) => a.id as string));
    const act1 = new Set(((tables.regions as readonly RegionDef[] | undefined) ?? []).flatMap((r) => r.pool.map((p) => p.enemy as string)));
    const above = new Set<string>();
    for (const st of strata) {
      const id = st.id;
      const say = (problem: string): void => {
        out.push({ table: 'strata', id, problem });
      };
      if (st.floors.length !== STRATUM_FLOORS) say(`has ${st.floors.length} floors (want ${STRATUM_FLOORS})`);
      const words = wordCount(st.rule.text);
      if (words === 0 || words > MAX_TEXT_WORDS) say(`rule line is ${words} words`);
      for (const n of st.natives) {
        if (!enemies.has(n)) say(`unknown native "${n}"`);
        if (act1.has(n)) say(`native "${n}" walks in an Act 1 region`);
      }
      for (const a of [...st.auras, st.keeperAura]) if (!auras.has(a)) say(`unknown aura "${a}"`);
      const boss = bosses.get(st.boss);
      if (!boss) say(`unknown guardian "${st.boss}"`);
      else if (!boss.abyss) say(`guardian "${st.boss}" is not an Abyss boss`);
      for (const r of st.floors.flatMap((f) => f.rules)) above.add(r.kind);
      for (const ph of boss?.phases ?? []) {
        for (const p of ph.patterns) if (p.kind === 'rule' && !above.has(p.rule.kind)) say(`guardian wears "${p.rule.kind}", a rule from no stratum at or above it`);
      }
      st.floors.forEach((f, i) => {
        const at = `floor ${i + 1}`;
        for (const g of f.guests) if (!act1.has(g)) say(`${at}: guest "${g}" is no Act 1 type`);
        for (const n of f.natives) if (!st.natives.includes(n)) say(`${at}: "${n}" is not its stratum's native`);
        const last = i === STRATUM_FLOORS - 1;
        if (last && f.keeper !== null) say(`${at}: the guardian's floor has a Keeper`);
        if (!last && (f.keeper === null || !st.natives.includes(f.keeper))) say(`${at}: its Keeper must be a native`);
        if (f.rules.some((r) => r.kind === 'gates') && (!f.gates || f.gates.length === 0)) say(`${at}: the Gates with no gates`);
        for (const b of Object.values(f.beats)) if (b.kind === 'introduce' && !f.natives.includes(b.enemy)) say(`${at}: introduces "${b.enemy}", not on the floor`);
      });
    }
    return out;
  };
}

/**
 * The Contract board (plans/late-game/10 §6): every target template with
 * each modifier at its longest fill stays within R4's fifteen words (two
 * modifiers are the generator's to prove, card by card: `meta/contracts.ts#valid`);
 * every quarry is a type its region brings; and the slots' bands cover T1–T4.
 */
export const contractsRule: LintRule = () => {
  const out: LintIssue[] = [];
  const longest = <T>(xs: readonly T[], name: (x: T) => string): T => xs.reduce((a, b) => (name(b).length > name(a).length ? b : a));
  const weapon = longest(WEAPONS, (w) => w.name).id;
  const evolving = longest(EVOLUTIONS.map((e) => WEAPONS.find((w) => w.id === e.weapon)!), (w) => w.name).id;
  const pair = [...WEAPONS].sort((a, b) => b.name.length - a.name.length).slice(0, 2).map((w) => w.id);
  const targets: ContractTarget[] = [
    ...REGIONS.flatMap((r): ContractTarget[] => [
      { kind: 'boss', region: r.index }, { kind: 'wave', region: r.index, wave: 20 }, { kind: 'overtime', region: r.index, k: 15 },
    ]),
    { kind: 'floor', floor: 30 },
    ...BOSSES.filter((b) => b.abyss).map((b): ContractTarget => ({ kind: 'guardian', boss: b.id })),
    { kind: 'rush', stages: RUSH_STAGES, within: 59 * 60 },
    { kind: 'rush', stages: RUSH_STAGES - 1, within: null },
  ];
  const mods: ContractMod[] = [
    { kind: 'heat', heat: 33 }, { kind: 'within', seconds: 999 }, { kind: 'healthy', pct: 70 }, { kind: 'noUlt' },
    { kind: 'carry', weapon }, { kind: 'evolve', weapon: evolving },
    { kind: 'fuse', fusion: longest(FUSIONS, (f) => f.name).id },
    ...FRAMES.map((f): ContractMod => ({ kind: 'rule', rule: { kind: 'frame', frame: f.id as never } })),
    { kind: 'rule', rule: { kind: 'weapons', ids: pair } },
    { kind: 'rule', rule: { kind: 'slots', weapon: 2 } }, { kind: 'rule', rule: { kind: 'slots', passive: 0 } },
    ...CONTRACT_OMENS.map((o): ContractMod => ({ kind: 'rule', rule: { kind: 'omen', pact: o.pact, rank: o.rank } })),
  ];
  const say = (id: string, text: string): void => {
    const n = wordCount(text);
    if (n > MAX_TEXT_WORDS) out.push({ table: 'contracts', id, problem: `"${text}" is ${n} words (max ${MAX_TEXT_WORDS})` });
  };
  for (const t of targets) for (const m of mods) say(`${t.kind}+${m.kind}`, contractText({ target: t, mods: [m] }));
  for (const r of REGIONS) {
    // A run reads as its tally (§3), with a modifier after it.
    const tallies: ContractMod[] = [{ kind: 'untouched', wave: 14 }, ...(QUARRY[r.index] ?? []).map((q): ContractMod => ({ kind: 'slay', enemy: q.enemy, n: q.n }))];
    for (const tally of tallies) for (const m of mods) say(`run+${tally.kind}+${m.kind}`, contractText({ target: { kind: 'run', region: r.index }, mods: [tally, m] }));
    const pool = new Set<string>([...r.pool.map((p) => p.enemy), ...Object.values(r.beats).flatMap((b) => (b.kind === 'introduce' ? [b.enemy] : []))]);
    for (const q of QUARRY[r.index] ?? []) {
      if (q.enemy !== 'elite' && !pool.has(q.enemy)) out.push({ table: 'contracts', id: `quarry-${r.index}`, problem: `${q.enemy} is not in ${r.name}'s pool` });
    }
  }
  const tiers = new Set(BALANCE.contracts.bands.flatMap(([lo, hi]) => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)));
  for (const t of [1, 2, 3, 4]) if (!tiers.has(t)) out.push({ table: 'contracts', id: 'bands', problem: `no slot holds tier ${t}` });
  return out;
};

/**
 * The Daily Omen's modifiers (plans/late-game/11 §6): not a `CONTENT` table
 * (a mod is named for the keystone, relic or pact it sets), so this rule
 * holds them to the others' basics, R4 included, and checks every id a
 * rule names exists, points are whole and signed by slot, and each slot has
 * something to draw.
 */
export const omensRule = (mods: readonly OmenModDef[] = OMEN_MODS): LintRule => (tables) => {
  const out: LintIssue[] = [];
  const say = (id: string, problem: string): void => {
    out.push({ table: 'omens', id, problem });
  };
  const forge = (tables.forge as readonly WebNodeDef[] | undefined) ?? [];
  const has = (table: string, id: string): boolean => (tables[table] ?? []).some((e) => e.id === id);
  const ids = new Set<string>();
  for (const m of mods) {
    if (ids.has(m.id)) say(m.id, 'duplicate id');
    ids.add(m.id);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(m.id)) say(m.id, 'id is not kebab-case');
    if (!ICONS.has(m.icon)) say(m.id, `unknown icon "${m.icon}"`);
    const words = wordCount(m.text);
    if (words === 0 || words > MAX_TEXT_WORDS) say(m.id, `text is ${words} words (max ${MAX_TEXT_WORDS})`);
    if (!Number.isInteger(m.points)) say(m.id, `points ${m.points} are not whole`);
    if (m.slot === 'boon' && m.points >= 0) say(m.id, 'a boon makes the day easier: its points are negative');
    if (m.slot !== 'boon' && m.points < 0) say(m.id, `a ${m.slot}'s points are never negative`);
    if (!(m.weight > 0)) say(m.id, 'weight must be positive');
    if (m.slot === 'bane') {
      if (!m.pact || !has('pacts', m.pact)) say(m.id, `bane names unknown pact "${m.pact}"`);
      if (m.rules.length > 0) say(m.id, 'a bane is its pact alone');
    }
    for (const r of m.rules) {
      if (r.kind === 'keystone' && !forge.some((n) => n.id === r.id && n.type === 'keystone')) say(m.id, `unknown keystone "${r.id}"`);
      if (r.kind === 'fusion' && !has('fusions', r.id)) say(m.id, `unknown fusion "${r.id}"`);
      if (r.kind === 'relic' && !has('relics', r.relic)) say(m.id, `unknown relic "${r.relic}"`);
      if (r.kind === 'omen' && !has('pacts', r.pact)) say(m.id, `unknown pact "${r.pact}"`);
    }
  }
  for (const m of mods) for (const c of m.clashes ?? []) if (!ids.has(c)) say(m.id, `clashes with unknown mod "${c}"`);
  for (const slot of ['boon', 'twist', 'bane'] as const) if (!mods.some((m) => m.slot === slot)) say(slot, `no ${slot} to draw`);
  return out;
};

export const RULES: readonly LintRule[] = [
  uniqueIds, entryBasics, references, levels, forgeWeb, starWeb, pacts, bossesAndLoot, evolutions, fusions, counters, uniqueNames, stacking, rifts,
  cursedRelics, anomalies, forms, secretsRule(EXPLAINERS.flatMap((x) => [x.title, ...x.lines])), strataRule(), contractsRule, omensRule(),
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
