/**
 * The bot (§13): input policies over the real sim. The draft scorer lives in
 * `src/sim/suggest.ts`, because the game's suggested card is the same scorer;
 * a policy only decides *when* to act on it.
 *
 *   active  takes the suggested card at once (every banked one in one tap,
 *           U2); casts the ultimate into a crowd
 *   bare    never picks, never casts: a level-1 tower (the P1 gate)
 */
import { RIFT_BY_ID } from '../src/content/rifts';
import type { RunInput, RunState } from '../src/sim/state';
import { riftLegal } from '../src/sim/systems/rifts';
import { BOSS_WAVE } from '../src/sim/systems/waves';
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
  Object.assign(input, riftInput(run));
  if (run.ult.charge >= 1 && (enemiesInRange(run) >= ULT_CROWD || run.tower.hp < run.stats.maxHp * ULT_PANIC_HP)) {
    input.ult = true;
  }
  return input;
}

/** A risky cost is left alone below this HP share, or with the boss next (plans/late-game/02 §8). */
const RIFT_SAFE_HP = 0.7;

/**
 * The active bot's rifts (plans/late-game/02 §8): it opens every rift it
 * sees and takes the first legal choice, unless that choice costs HP or
 * brings more bodies while the tower is under 70% or the boss is next; then
 * it leaves. Tap and choice go in one input. The game never suggests a choice.
 */
export function riftInput(run: RunState): RunInput {
  const r = run.rift;
  if (!r || run.draft || (r.phase !== 'shown' && r.phase !== 'choosing')) return {};
  const def = RIFT_BY_ID[r.id];
  const tap = r.phase === 'shown' ? { tapRift: true } : {};
  const risky = run.tower.hp < run.stats.maxHp * RIFT_SAFE_HP || run.wave === BOSS_WAVE - 1;
  // riftLegal reads the open rift; a shown one is the same rift.
  for (let i = 0; i < def.choices.length; i++) {
    if (riftLegal(run, i) !== null) continue;
    const costly = def.choices[i].effects.some((f) => f.kind === 'hurt' || f.kind === 'horde' || (f.kind === 'elites' && !f.champion));
    if (costly && risky) continue;
    return { ...tap, chooseRift: i };
  }
  return { ...tap, chooseRift: -1 };
}
