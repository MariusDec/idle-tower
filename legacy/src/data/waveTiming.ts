import type { WaveTimingState } from '../types';
import { expectedWaveSeconds, isBossWave } from './formulas';

/**
 * How long the player's tower actually takes to clear a wave, and which wave
 * that was — the arithmetic behind `WaveTimingState` (declared in
 * `src/types.ts`).
 *
 * Everything here is in **simulation seconds**, not wall-clock seconds:
 * `WaveState.elapsed` accrues on the simulation delta (`Game.update`'s `dt`,
 * already multiplied by the game-speed setting), so a wave that takes 60
 * simulation seconds takes 60 s at 1x and 40 s of wall clock at 1.5x. Offline
 * progress divides a *wall-clock* absence by these numbers, which is exactly
 * what "offline always runs at 1x" means: raising the speed dial makes waves
 * pass faster while you are watching and changes nothing while you are away.
 *
 * The block records *which* wave was last completed as well as how long it
 * took, because those two are one fact: an absence repeats the last completed
 * wave, priced at the time that wave actually took. Sample and target being
 * the same wave is what removes any need to rescale a measurement from one
 * depth to another.
 */

/** Clears that feed the running mean. Short enough to track a tower that just got stronger. */
export const WAVE_TIMING_EMA_WINDOW = 5;

/** Floor and ceiling on any single measurement, so a glitched frame cannot poison the average. */
export const MIN_WAVE_SECONDS = 5;
export const MAX_WAVE_SECONDS = 3600;

/**
 * Payout multiplier when the run has never completed a wave, so the duration
 * below is `expectedWaveSeconds` rather than a measurement. A tower that has
 * not cleared anything must not be paid as if it had.
 */
export const UNMEASURED_WAVE_PENALTY = 0.5;

export function defaultWaveTiming(): WaveTimingState {
  return { lastWaveSeconds: 0, avgWaveSeconds: 0, sampleWave: 0, samples: 0 };
}

function clampSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return MIN_WAVE_SECONDS;
  return Math.min(MAX_WAVE_SECONDS, Math.max(MIN_WAVE_SECONDS, seconds));
}

/**
 * Fold one completed wave into the running mean.
 *
 * The first `WAVE_TIMING_EMA_WINDOW` samples produce a plain running mean
 * (`n` grows 1, 2, 3 …); after that the divisor sticks at the window size and
 * it becomes an exponential moving average with weight `1 / window`. The mean
 * is over the last handful of clears, which are all within a few waves of each
 * other, so it smooths a lucky or unlucky wave without smearing across depths.
 *
 * `sampleWave` is overwritten every time: it is *the last completed wave*, and
 * that is the wave an absence repeats.
 */
export function recordWaveTime(t: WaveTimingState, wave: number, seconds: number): void {
  if (!Number.isFinite(seconds) || seconds <= 0) return;
  const d = clampSeconds(seconds);
  const n = Math.min(t.samples + 1, WAVE_TIMING_EMA_WINDOW);
  t.avgWaveSeconds = t.samples <= 0 ? d : t.avgWaveSeconds + (d - t.avgWaveSeconds) / n;
  t.lastWaveSeconds = d;
  t.sampleWave = Math.max(1, Math.floor(wave));
  t.samples = Math.min(t.samples + 1, 1_000_000);
}

/**
 * Which wave an absence repeats, and how long one clear of it takes.
 *
 * **The last completed wave**, at the duration it was completed in. Not the
 * wave in progress: that wave has never been finished, so nothing is known
 * about how long it takes or whether the tower can finish it at all, and
 * paying it would be paying for a claim the run has not made. The last
 * completed wave is the deepest thing the tower has actually proved it can do.
 *
 * `WaveManager` never records a boss wave, a mutator wave or an early call, so
 * `sampleWave` is always an ordinary wave the tower cleared under its own
 * power — which is also why nothing here needs a boss step-back.
 *
 * The fallback runs only before the first clear of a run. There `currentWave`
 * is all there is: price it from `expectedWaveSeconds`, step back off a boss,
 * floor it with however far into the wave the player already was
 * (`inProgressSeconds` is `WaveState.elapsed` at save time — a wave that has
 * been running 90 s cannot be a 52 s wave), and pay it at
 * `UNMEASURED_WAVE_PENALTY`.
 */
export function offlineWaveTarget(
  t: WaveTimingState | undefined,
  currentWave: number,
  inProgressSeconds = 0,
): { wave: number; seconds: number; measured: boolean } {
  if (t && t.samples > 0 && t.avgWaveSeconds > 0 && t.sampleWave > 0) {
    return {
      wave: Math.max(1, Math.floor(t.sampleWave)),
      seconds: clampSeconds(t.avgWaveSeconds),
      measured: true,
    };
  }
  const w = Math.max(1, Math.floor(currentWave));
  const wave = isBossWave(w) ? Math.max(1, w - 1) : w;
  const estimate = Math.max(expectedWaveSeconds(wave), Math.max(0, inProgressSeconds));
  return { wave, seconds: clampSeconds(estimate), measured: false };
}
