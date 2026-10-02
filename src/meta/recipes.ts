import { BALANCE } from '../content/balance';
import { BOSSES } from '../content/bosses';
import { EVOLUTIONS, EVOLUTION_OF } from '../content/evolutions';
import { FUSIONS } from '../content/fusions';
import { STAR_CARDS } from '../content/stars';
import type { EvolutionDef, EvolutionId, FusionDef, FusionId } from '../content/types';
import type { RunState } from '../sim/state';
import type { Profile } from './profile';
import { automations } from './automation';
import { STAR_WEB } from './stars';

/**
 * The Recipe Book (§5.3): evolutions show as "??? + ???" until found. Runs
 * carrying a weapon reveal its half of the recipe; runs taking it to its
 * last level add the riddle that points at the other half.
 */

export interface RecipeEntry {
  evolution: EvolutionDef;
  found: boolean;
  /** The weapon half shows. */
  weapon: boolean;
  /** The riddle shows. */
  hint: boolean;
}

const FINALE = BOSSES.find((b) => b.finale)!.id;

export function recipeBook(profile: Profile): RecipeEntry[] {
  const R = profile.recipes;
  const B = BALANCE.recipes;
  // Evolution Insight (§11.4): every weapon half shows.
  const insight = automations(profile).has('insight');
  const act2 = (profile.bosses[FINALE]?.kills ?? 0) > 0;
  // A weapon a Constellation lights (§9) keeps its recipe off the Book until Act 2.
  return EVOLUTIONS.filter((e) => act2 || !STAR_CARDS.has(e.weapon)).map((evolution) => {
    const found = R.found.includes(evolution.id);
    return {
      evolution,
      found,
      weapon: found || insight || (R.carried[evolution.weapon] ?? 0) >= B.weaponRuns,
      hint: !found && (R.readied[evolution.weapon] ?? 0) >= B.riddleRuns,
    };
  });
}

/** True once the Book has anything on it: the Recipes page opens (§7.1). */
export function recipesOpen(profile: Profile): boolean {
  return recipeBook(profile).some((r) => r.found || r.weapon);
}

/** Bank a run into the Book. Returns the evolutions found for the first time. */
export function recordRecipes(profile: Profile, run: RunState): EvolutionId[] {
  const R = profile.recipes;
  for (const w of run.weapons) {
    R.carried[w.id] = (R.carried[w.id] ?? 0) + 1;
    if (w.level >= BALANCE.evolutions.evolveAt) R.readied[w.id] = (R.readied[w.id] ?? 0) + 1;
  }
  const fresh = run.evolved.filter((id) => !R.found.includes(id));
  R.found.push(...fresh);
  return fresh;
}

/** A fusion on the Recipe Book's second page (N9). */
export interface FusionEntry {
  fusion: FusionDef;
  found: boolean;
  /** Its star is lit: the two halves show. */
  lit: boolean;
  /** Both halves' evolutions found, and not yet fused: the riddle shows. */
  hint: boolean;
}

/** The second page (N9): every fusion once Act 2 is open; its halves once its star is lit. */
export function fusionBook(profile: Profile): FusionEntry[] {
  if ((profile.bosses[FINALE]?.kills ?? 0) === 0) return [];
  const lit = new Set<FusionId>();
  for (const { node } of STAR_WEB.ownedNodes(profile)) for (const e of node.effects) if (e.kind === 'fusion') lit.add(e.id);
  return FUSIONS.map((fusion) => {
    const found = profile.fusions.includes(fusion.id);
    const halves = fusion.weapons.every((w) => profile.recipes.found.includes(EVOLUTION_OF[w].id));
    return { fusion, found, lit: found || lit.has(fusion.id), hint: !found && halves };
  });
}

/** Bank a run's fusions (N9). Returns those found for the first time. */
export function recordFusions(profile: Profile, run: RunState): FusionId[] {
  const fresh = run.fused.filter((id) => !profile.fusions.includes(id));
  profile.fusions.push(...fresh);
  return fresh;
}
