import { Rng } from '../../core/rng';
import { BALANCE } from '../../content/balance';
import type { BossId, RelicId } from '../../content/types';
import type { Enemy, RunState } from '../state';

/**
 * Reliquaries (plans/late-game/03 §3.4): a cursed relic's chest, left where
 * an elite or guardian fell in the Abyss. It waits `claimSeconds` of sim
 * time (so a draft slows it and a hidden app stops it) for a tap, through
 * `RunInput.claim`, so a claim is in the replay; untouched, it fades. The
 * Autocaster and the idle bot never claim (I9).
 *
 * Every roll is on the `curse` stream: a run with no reliquary config draws
 * nothing, and older seeds play as before.
 */

/** Place a reliquary for `relic` at (x, y). */
function drop(run: RunState, relic: RelicId, x: number, y: number): void {
  const cfg = run.reliquaryCfg;
  if (!cfg) return;
  const C = BALANCE.cursed;
  // The profile's first is a lesson: a longer window, once.
  const first = cfg.first && run.reliquaryCount === 0;
  const id = ++run.reliquaryCount;
  run.reliquaries.push({ id, relic, x, y, at: run.time, until: run.time + (first ? C.firstClaimSeconds : C.claimSeconds) });
  run.events.push({ kind: 'reliquary', id, relic, x, y, first });
}

/**
 * An elite fell (§3.1): one roll, after the ordinary relic's and on its own
 * stream, so one elite may leave both. Treasure Hunter's luck holds here too.
 * A Keeper (plan 08) rolls at its own, higher chance.
 */
export function eliteReliquary(run: RunState, e: Enemy, keeper = false): void {
  const pool = run.reliquaryCfg?.elite ?? [];
  if (pool.length === 0) return;
  const C = BALANCE.cursed;
  const luck = run.behaviours['relic-luck'] ? BALANCE.behaviours.relicLuck : 1;
  const rng = Rng.wrap(run.streams.curse);
  if (rng.chance((keeper ? C.keeperDrop : C.eliteDrop) * luck)) drop(run, rng.pick(pool), e.x, e.y);
}

/** A guardian fell (§3.1): its relic, surely the first time, then at `bossDrop`. */
export function guardianReliquary(run: RunState, boss: BossId, x: number, y: number): void {
  const cfg = run.reliquaryCfg;
  const relic = cfg?.boss[boss];
  if (!cfg || !relic) return;
  // Sure only once a run: a second fall of the same guardian rolls.
  const sure = cfg.sure.includes(boss) && !run.reliquaries.some((r) => r.relic === relic) && !run.relics.includes(relic);
  if (sure || Rng.wrap(run.streams.curse).chance(BALANCE.cursed.bossDrop)) drop(run, relic, x, y);
}

/** A tap claims reliquary `id`: it joins the run's relics and banks with them. False when it is gone. */
export function claimReliquary(run: RunState, id: number): boolean {
  const i = run.reliquaries.findIndex((r) => r.id === id);
  if (i < 0) return false;
  const [r] = run.reliquaries.splice(i, 1);
  run.relics.push(r.relic);
  run.reliquariesClaimed++;
  run.events.push({ kind: 'reliquaryClaim', id: r.id, relic: r.relic, x: r.x, y: r.y });
  return true;
}

/** Step: reliquaries whose window ran out sink. */
export function tickReliquaries(run: RunState): void {
  const list = run.reliquaries;
  if (list.length === 0) return;
  let w = 0;
  for (const r of list) {
    if (run.time < r.until) list[w++] = r;
    else fade(run, r);
  }
  list.length = w;
}

/** The run ended (a retreat, a fall): every reliquary still waiting fades. */
export function fadeReliquaries(run: RunState): void {
  for (const r of run.reliquaries) fade(run, r);
  run.reliquaries.length = 0;
}

function fade(run: RunState, r: RunState['reliquaries'][number]): void {
  run.reliquariesFaded++;
  run.events.push({ kind: 'reliquaryFade', id: r.id, relic: r.relic, x: r.x, y: r.y });
}
