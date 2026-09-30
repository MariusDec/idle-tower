/**
 * The bot (§13): input policies over the real sim. The draft scorer lives in
 * `src/sim/suggest.ts`, because the game's suggested card is the same scorer;
 * a policy only decides *when* to act on it.
 *
 *   active  takes the suggested card at once; casts the ultimate into a crowd
 *   bare    never picks, never casts: a level-1 tower (the P1 gate)
 */
import type { RunInput, RunState } from '../src/sim/state';

export type Policy = 'active' | 'bare';

/** Bodies in range that make an ultimate worth casting… */
const ULT_CROWD = 8;
/** …or the tower is this hurt. */
const ULT_PANIC_HP = 0.5;

export function botInput(run: RunState, policy: Policy): RunInput {
  if (policy === 'bare') return {};
  const input: RunInput = {};
  if (run.draft) input.pick = run.draft.suggested;
  if (run.ult.charge >= 1) {
    const r2 = run.stats.range * run.stats.range;
    let crowd = 0;
    for (const e of run.enemies) if (e.alive && e.x * e.x + e.y * e.y <= r2) crowd++;
    if (crowd >= ULT_CROWD || run.tower.hp < run.stats.maxHp * ULT_PANIC_HP) input.ult = true;
  }
  return input;
}
