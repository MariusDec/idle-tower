import type { PactDef, PactId } from './types';

/**
 * Pacts (§9): eight, each with 3–5 ranks of difficulty the player opts into
 * after the Blight falls. Heat is the sum of the ranks; shards rise with it
 * (`BALANCE.pacts.shardsPerHeat`), and clearing a region at a new heat
 * record pays Starlight, once per region per heat level. The Abyss has its
 * own depth instead: pacts hold only in the regions.
 *
 * A pact's `text` is what one rank does.
 */
export const PACTS: readonly PactDef[] = [
  { id: 'hordes', name: 'Hordes', icon: 'crossed-bones', text: 'Waves bring 30% more enemies.', ranks: 5, effect: { kind: 'count', pct: 0.3 } },
  { id: 'vigour', name: 'Vigour', icon: 'heart-plus', text: 'Enemies have half again as much health.', ranks: 5, effect: { kind: 'hp', mult: 1.5 } },
  { id: 'haste', name: 'Haste', icon: 'fast-arrow', text: 'Enemies move 15% faster.', ranks: 3, effect: { kind: 'speed', pct: 0.15 } },
  { id: 'elites', name: 'Elites', icon: 'crowned-skull', text: 'Every elite wave brings one more elite.', ranks: 3, effect: { kind: 'elites', n: 1 } },
  { id: 'frailty', name: 'Frailty', icon: 'cracked-shield', text: 'The tower has 15% less Max HP.', ranks: 4, effect: { kind: 'stat', mod: { key: 'maxHp', pct: -0.15 } } },
  { id: 'scarcity', name: 'Scarcity', icon: 'two-coins', text: 'One fewer card in every draft.', ranks: 3, effect: { kind: 'choices', n: -1 } },
  { id: 'tyranny', name: 'Tyranny', icon: 'crown', text: 'Bosses rise once more, with 25% more health.', ranks: 3, effect: { kind: 'tyranny', hp: 0.25 } },
  { id: 'surge', name: 'Blight Surge', icon: 'spiky-explosion', text: 'The region’s surge: its rule turns harsher.', ranks: 3, effect: { kind: 'surge' } },
];

export const PACT_BY_ID: Readonly<Record<PactId, PactDef>> = Object.fromEntries(
  PACTS.map((p) => [p.id, p]),
) as Record<PactId, PactDef>;

/** The most heat the pacts can make: every rank of every pact. */
export const MAX_HEAT = PACTS.reduce((s, p) => s + p.ranks, 0);
