import { FORGE } from '../src/content/forge';
import { maxSpeed } from '../src/meta/automation';
import { buyNode, canAfford, levelOf, neighbours, nodeCost, nodeStates, weaponOf } from '../src/meta/forge';
import type { Profile } from '../src/meta/profile';

/**
 * `--weapons-first` (plans/forge-weapon-pacing.md, W1): the bot shops like a
 * player who wants every weapon at once, the way the owner found the Forge
 * could be played. Pacing workers inherit the flag (`tools/parallel.ts`).
 */
export const WEAPONS_FIRST = process.argv.includes('--weapons-first');

/**
 * The active bot's shopping: the cheapest buyable level first, again and
 * again, until nothing is affordable — what the results screen's "Next:"
 * line points at. Speed goes to the fastest unlocked.
 *
 * Keystones are left alone: each is a build with a trade-off (§5.1), chosen
 * on purpose, and bought blindly together (Specialist's one weapon under
 * Glass Cannon's halved HP) they end every run at wave 3.
 *
 * With `--weapons-first`, every affordable weapon node goes first, and so
 * does the step that reveals one (Scattershot waits behind Sharpened).
 */
export function shop(profile: Profile): string[] {
  const bought: string[] = [];
  if (WEAPONS_FIRST) {
    for (;;) {
      const next = weaponStep(profile);
      if (!next || !buyNode(profile, next)) break;
      bought.push(next);
    }
  }
  for (;;) {
    let best: string | null = null;
    let bestCost = Infinity;
    for (const n of FORGE) {
      if (n.type === 'keystone' || !canAfford(profile, n.id)) continue;
      const cost = nodeCost(n, levelOf(profile, n.id), profile);
      if (cost < bestCost) {
        bestCost = cost;
        best = n.id;
      }
    }
    if (!best || !buyNode(profile, best)) break;
    bought.push(best);
  }
  profile.settings.speed = maxSpeed(profile);
  return bought;
}

/** The weapons-first bot's next buy: an affordable weapon node, else an affordable unowned neighbour that would open one. */
function weaponStep(profile: Profile): string | null {
  const weapons = FORGE.filter((n) => weaponOf(n) !== null && levelOf(profile, n.id) === 0);
  const ready = weapons.filter((n) => canAfford(profile, n.id)).sort((a, b) => a.cost - b.cost);
  if (ready.length > 0) return ready[0].id;
  const states = nodeStates(profile);
  for (const w of weapons) {
    if (states.get(w.id) !== 'fog' && states.get(w.id) !== 'hidden') continue;
    const step = neighbours(w.id).find((id) => levelOf(profile, id) === 0 && canAfford(profile, id) && weaponOf(FORGE.find((n) => n.id === id)!) === null);
    if (step) return step;
  }
  return null;
}
