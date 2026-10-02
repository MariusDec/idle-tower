/**
 * The bot (§13): input policies over the real sim. The draft scorer lives in
 * `src/sim/suggest.ts`, because the game's suggested card is the same scorer;
 * a policy only decides *when* to act on it.
 *
 *   active  takes the suggested card at once (every banked one in one tap,
 *           U2); casts the ultimate into a crowd
 *   bare    never picks, never casts: a level-1 tower (the P1 gate)
 */
import type { RunInput, RunState } from '../src/sim/state';
import { enemiesInRange } from '../src/sim/systems/ultimate';

export type Policy = 'active' | 'bare';

/** Bodies in range that make an ultimate worth casting… */
const ULT_CROWD = 8;
/** …or the tower is this hurt. */
const ULT_PANIC_HP = 0.5;

export function botInput(run: RunState, policy: Policy): RunInput {
  if (policy === 'bare') return {};
  const input: RunInput = {};
  if (run.draft && run.pendingDrafts > 1) input.takeAll = true;
  else if (run.draft) input.pick = run.draft.suggested;
  if (run.ult.charge >= 1 && (enemiesInRange(run) >= ULT_CROWD || run.tower.hp < run.stats.maxHp * ULT_PANIC_HP)) {
    input.ult = true;
  }
  return input;
}
