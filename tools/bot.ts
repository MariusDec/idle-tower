/**
 * The bot (§13): input policies over the real sim. The draft scorer lives in
 * `src/sim/suggest.ts`, because the game's suggested card is the same scorer;
 * a policy only decides *when* to act on it.
 *
 *   active  takes the suggested card at once (every banked one in one tap,
 *           U2); casts the ultimate into a crowd
 *   bare    never picks, never casts: a level-1 tower (the P1 gate)
 *
 * The active bot claims a reliquary on the frame it appears (plans/late-game/03
 * §6), `--claim-rate` of the time (default 0.9: a player looks away now and
 * then); which ones it misses is a hash of the seed and the reliquary, so a
 * run replays the same. `bare` and the idle policy never claim (I9).
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
  const claim = reliquaryInput(run);
  if (claim !== undefined) input.claim = claim;
  if (run.ult.charge >= 1 && (enemiesInRange(run) >= ULT_CROWD || run.tower.hp < run.stats.maxHp * ULT_PANIC_HP)) {
    input.ult = true;
  }
  return input;
}

/** Share of reliquaries the active bot claims (`--claim-rate`). */
export const CLAIM_RATE = claimRate(typeof process === 'undefined' ? [] : process.argv);

function claimRate(argv: readonly string[]): number {
  const i = argv.findIndex((a) => a === '--claim-rate' || a.startsWith('--claim-rate='));
  if (i < 0) return 0.9;
  const raw = argv[i].includes('=') ? argv[i].split('=')[1] : argv[i + 1];
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.9;
}

/**
 * The reliquary the active bot claims this frame, if any: one that just
 * dropped, unless the hash says this one was missed (it then fades).
 */
export function reliquaryInput(run: RunState, rate = CLAIM_RATE): number | undefined {
  for (const r of run.reliquaries) {
    if (run.time - r.at > 0.5) continue;
    const h = Math.imul((run.seed ^ (r.id * 0x9e3779b1)) >>> 0, 0x85ebca6b) >>> 0;
    if ((h % 10000) / 10000 < rate) return r.id;
  }
  return undefined;
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
