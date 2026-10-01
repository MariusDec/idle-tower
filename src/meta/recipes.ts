import { BALANCE } from '../content/balance';
import { EVOLUTIONS } from '../content/evolutions';
import type { EvolutionDef, EvolutionId } from '../content/types';
import type { RunState } from '../sim/state';
import type { Profile } from './profile';
import { automations } from './automation';

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

export function recipeBook(profile: Profile): RecipeEntry[] {
  const R = profile.recipes;
  const B = BALANCE.recipes;
  // Evolution Insight (§11.4): every weapon half shows.
  const insight = automations(profile).has('insight');
  return EVOLUTIONS.map((evolution) => {
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
