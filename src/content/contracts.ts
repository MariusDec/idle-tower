import { BOSS_BY_ID } from './bosses';
import { ENEMY_BY_ID } from './enemies';
import { FUSION_BY_ID } from './fusions';
import { frameById } from './frames';
import { regionByIndex } from './regions';
import { RUSH_STAGES } from './rush';
import type { ContractMod, ContractSpec, ContractTarget, EnemyId, PactId, TrimId } from './types';
import { WEAPON_BY_ID } from './weapons';

/**
 * The Contract board's authored parts (plans/late-game/10 §5). Contracts are
 * generated, so there is no list of contracts here: only what the generator
 * draws from and how a card reads. `meta/contracts.ts` holds the grammar's
 * scores and checks; the lint proves every template with its longest fills
 * stays within R4's fifteen words.
 */

/**
 * What a `slay` contract may ask for in each region, by region index: two
 * of its types (the Blight Heart's elites, where every wave brings one),
 * each with the count one run asks. Read off the active bot's kills by wave
 * 20 (2026-11-15, two seeds a region), at about three quarters of the tally:
 * a run held to the boss, not a lucky one.
 */
export const QUARRY: Readonly<Record<number, readonly { readonly enemy: EnemyId | 'elite'; readonly n: number }[]>> = {
  1: [{ enemy: 'grunt', n: 160 }, { enemy: 'runner', n: 220 }],
  2: [{ enemy: 'splitter', n: 1000 }, { enemy: 'spitter', n: 75 }],
  3: [{ enemy: 'shieldbearer', n: 190 }, { enemy: 'burrower', n: 70 }],
  4: [{ enemy: 'bomber', n: 250 }, { enemy: 'blinker', n: 100 }],
  5: [{ enemy: 'phantom', n: 270 }, { enemy: 'leech', n: 130 }],
  6: [{ enemy: 'chorus', n: 750 }, { enemy: 'elite', n: 15 }],
  // The Wake (plans/late-game/12a W11): the active bot on the Wake fixture's
  // cleared towers, twenty seeds a region held to the boss (2026-11-26), at
  // 0.8 of the median. The Frozen Sea asks Sledges, not elites (4 a run).
  9: [{ enemy: 'ringer', n: 235 }, { enemy: 'straggler', n: 145 }],
  10: [{ enemy: 'satellite', n: 285 }, { enemy: 'comet', n: 145 }],
  11: [{ enemy: 'skater', n: 415 }, { enemy: 'sledge', n: 12 }],
  12: [{ enemy: 'titan', n: 120 }, { enemy: 'tick', n: 70 }],
  13: [{ enemy: 'groundling', n: 310 }, { enemy: 'conductor', n: 30 }],
};

/** Act 1's stand-in for heat (§3): an omen, a pact at a rank, with the words it reads as. */
export const CONTRACT_OMENS: readonly { readonly pact: PactId; readonly rank: number; readonly text: string }[] = [
  { pact: 'haste', rank: 2, text: 'while enemies move 30% faster' },
  { pact: 'hordes', rank: 2, text: 'while waves bring 60% more enemies' },
  { pact: 'vigour', rank: 2, text: 'while enemies have 50% more health' },
  { pact: 'frailty', rank: 2, text: 'with 30% less Max HP' },
];

/** The board's milestones (§4.4): a trim at each of these completions; past the last, a relic rank every `relicEvery`. */
export const CONTRACT_TRIMS: readonly { readonly at: number; readonly trim: TrimId; readonly name: string }[] = [
  { at: 10, trim: 'seals', name: 'Wax Seals' },
  { at: 30, trim: 'lanterns', name: 'Lanterns' },
];

/** The slots' names, as the board heads its cards. */
export const SLOT_NAMES = { quick: 'Quick', steady: 'Steady', hard: 'Hard' } as const;

/** Small counts in words, as the templates read them ("two weapon slots"). */
export const COUNT_WORDS: readonly string[] = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];

/** A name as it reads mid-sentence: "The Bog Mother" → "the Bog Mother"; "Forgeheart" stays. */
export function midSentence(name: string): string {
  return name.startsWith('The ') ? `the ${name.slice(4)}` : name;
}

/** A region's name as a place: "in the Drowned Mire", "in the Hollow". */
export function placeName(name: string): string {
  return name.startsWith('The ') ? `the ${name.slice(4)}` : `the ${name}`;
}

/** An enemy's name, counted: "Grunts", "Siege Engines", "elites". */
export function plural(name: string): string {
  if (name.endsWith('s')) return name;
  // "Leech" → "Leeches".
  if (/(ch|sh|x)$/.test(name)) return `${name}es`;
  return `${name}s`;
}

/** A list of names as prose: "Mortar", "Frost Ring and Glaives", "A, B and C". */
function andList(names: readonly string[]): string {
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** The target's clause, with a run's tally condition folded in (§3: `run` reads as its tally). */
function targetText(t: ContractTarget, tally: ContractMod | undefined): string {
  switch (t.kind) {
    case 'boss':
      return `Fell ${midSentence(BOSS_BY_ID[regionByIndex(t.region).boss].name)}`;
    case 'wave':
      return `Reach wave ${t.wave} in ${placeName(regionByIndex(t.region).name)}`;
    case 'overtime':
      return `Hold ${placeName(regionByIndex(t.region).name)} to wave ${20 + t.k}`;
    case 'run': {
      const name = regionByIndex(t.region).name;
      if (tally?.kind === 'untouched') return `Reach wave ${tally.wave} unhurt in ${placeName(name)}`;
      if (tally?.kind === 'slay') {
        const what = tally.enemy === 'elite' ? 'elites' : plural(ENEMY_BY_ID[tally.enemy].name);
        return `Slay ${tally.n} ${what} in one ${name.replace(/^The /, '')} run`;
      }
      return `Finish a run in ${placeName(name)}`;
    }
    case 'floor':
      return `Clear Abyss floor ${t.floor}`;
    case 'guardian':
      return `Fell ${midSentence(BOSS_BY_ID[t.boss].name)}`;
    case 'rush': {
      // A full clear is "Clear Boss Rush": the stages' count would cost three words of R4's fifteen.
      if (t.within !== null) return `Clear Boss Rush in under ${Math.round(t.within / 60)} minutes`;
      return t.stages >= RUSH_STAGES ? 'Clear Boss Rush' : `Clear ${t.stages} Boss Rush stages`;
    }
    default: {
      const exhaustive: never = t;
      return exhaustive;
    }
  }
}

/** A modifier's fragment after the target; the prefixes (evolve, fuse) and tallies are folded in elsewhere. */
export function modText(m: ContractMod): string {
  switch (m.kind) {
    case 'heat':
      return `at heat ${m.heat}`;
    case 'within':
      return `within ${m.seconds} s`;
    case 'healthy':
      return `above ${m.pct}% HP`;
    case 'noUlt':
      return 'without casting your ultimate';
    case 'untouched':
      return `taking no damage before wave ${m.wave}`;
    case 'carry':
      return `with ${WEAPON_BY_ID[m.weapon].name} dealing half the damage`;
    case 'evolve':
      return `Evolve ${WEAPON_BY_ID[m.weapon].name}`;
    case 'fuse':
      return `Make ${FUSION_BY_ID[m.fusion].name}`;
    case 'slay':
      return m.enemy === 'elite' ? `slaying ${m.n} elites` : `slaying ${m.n} ${plural(ENEMY_BY_ID[m.enemy].name)}`;
    case 'rule': {
      const r = m.rule;
      switch (r.kind) {
        case 'frame':
          return `as the ${frameById(r.frame).name}`;
        case 'weapons':
          return `with ${andList(r.ids.map((id) => WEAPON_BY_ID[id].name))} only`;
        case 'slots':
          if (r.passive === 0) return 'with no passives';
          return `with ${COUNT_WORDS[r.weapon ?? 0]} weapon slot${r.weapon === 1 ? '' : 's'}`;
        case 'omen':
          return CONTRACT_OMENS.find((o) => o.pact === r.pact && o.rank === r.rank)?.text ?? `under ${r.pact} ${r.rank}`;
        default: {
          const exhaustive: never = r;
          return exhaustive;
        }
      }
    }
    default: {
      const exhaustive: never = m;
      return exhaustive;
    }
  }
}

/**
 * A contract in words (§2): "Fell the Bog Mother at heat 5, with Frost Ring
 * and Glaives only." An evolve or fuse leads ("Make Blizzard, then fell …");
 * a run's tally is its clause; the rest follow, the first after a space, the
 * second after a comma.
 */
export function contractText(c: Pick<ContractSpec, 'target' | 'mods'>): string {
  const full = cardText(c, false);
  // After the comma a weapon list or a carry drops its "with" only when the card
  // would run past R4's 15 words with it (§2: "at heat 5, Frost Ring and Glaives
  // only"). Kept otherwise: "as the Bastion, Mortar, Glaives and Scattershot only"
  // reads as four things.
  return full.split(/\s+/).length <= CARD_WORDS ? full : cardText(c, true);
}

/** R4's cap on a card's words (`MAX_TEXT_WORDS` in lint.ts, which imports this file). */
const CARD_WORDS = 15;

function cardText(c: Pick<ContractSpec, 'target' | 'mods'>, terse: boolean): string {
  const prefix = c.mods.find((m) => m.kind === 'evolve' || m.kind === 'fuse');
  const tally = c.target.kind === 'run' ? c.mods.find((m) => m.kind === 'untouched' || m.kind === 'slay') : undefined;
  let s = targetText(c.target, tally);
  c.mods.filter((m) => m !== prefix && m !== tally).forEach((m, i) => {
    const text = modText(m);
    const bare = terse && i > 0 && (m.kind === 'carry' || (m.kind === 'rule' && m.rule.kind === 'weapons'));
    s += `${i === 0 ? ' ' : ', '}${bare ? text.replace(/^with /, '') : text}`;
  });
  if (prefix) s = `${modText(prefix)}, then ${s[0].toLowerCase()}${s.slice(1)}`;
  return `${s}.`;
}
