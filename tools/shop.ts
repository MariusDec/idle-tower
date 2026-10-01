import { FORGE } from '../src/content/forge';
import { maxSpeed } from '../src/meta/automation';
import { buyNode, canAfford, levelOf, nodeCost } from '../src/meta/forge';
import type { Profile } from '../src/meta/profile';

/**
 * The active bot's shopping: the cheapest buyable level first, again and
 * again, until nothing is affordable — what the results screen's "Next:"
 * line points at. Speed goes to the fastest unlocked.
 *
 * Keystones are left alone: each is a build with a trade-off (§5.1), chosen
 * on purpose, and bought blindly together (Specialist's one weapon under
 * Glass Cannon's halved HP) they end every run at wave 3.
 */
export function shop(profile: Profile): string[] {
  const bought: string[] = [];
  for (;;) {
    let best: string | null = null;
    let bestCost = Infinity;
    for (const n of FORGE) {
      if (n.type === 'keystone' || !canAfford(profile, n.id)) continue;
      const cost = nodeCost(n, levelOf(profile, n.id));
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
