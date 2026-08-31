import type { WaveTimingState } from '../types';
import { expectedWaveSeconds, isBossWave } from './formulas';

/**
 * How long the player's tower actually takes to clear a wave — the arithmetic
 * behind `WaveTimingState` (declared in `src/types.ts`).
 *
 * Everything here is in **simulation seconds**, not wall-clock seconds:
 * `WaveState.elapsed` accrues on the simulation delta (`Game.update`'s `dt`,
 * already multiplied by the game-speed setting), so a wave that takes 60
 * simulation seconds takes 60 s at 1x and 40 s of wall clock at 1.5x. Offline
 * progress divides a *wall-clock* absence by these numbers, which is exactly
 * what "offline always runs at 1x" means: raising the speed dial makes waves
 * pass faster while you are watching and changes nothing while you are away.
 */
/** Clears that feed the running mean. Short enough to track a tower that just got stronger. */
export const WAVE_TIMING_EMA_WINDOW = 5;

/** Floor and ceiling on any single measurement, so a glitched frame cannot poison the average. */
export const MIN_WAVE_SECONDS = 5;
export const MAX_WAVE_SECONDS = 3600;

/** How far a sample taken at another depth may be rescaled before it is distrusted. */
export const WAVE_TIMING_RESCALE_MIN = 0.25;
export const WAVE_TIMING_RESCALE_MAX = 4;

/**
 * Payout multiplier when the run has never actually finished a wave, so the
 * duration below is `expectedWaveSeconds` rather than a measurement. A tower
 * that has not cleared anything must not be paid as if it had.
 */
export const UNMEASURED_WAVE_PENALTY = 0.5;

export function defaultWaveTiming(): WaveTimingState {
  return { lastWaveSeconds: 0, avgWaveSeconds: 0, sampleWave: 0, samples: 0 };
}

function clampSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return MIN_WAVE_SECONDS;
  return Math.min(MAX_WAVE_SECONDS, Math.max(MIN_WAVE_SECONDS, seconds));
}

/** Non-boss reference depth: boss waves have their own, much longer, budget. */
function referenceWave(wave: number): number {
  const w = Math.max(1, Math.floor(wave));
  return isBossWave(w) ? Math.max(1, w - 1) : w;
}

/**
 * Fold one completed wave into the running mean.
 *
 * The first `WAVE_TIMING_EMA_WINDOW` samples produce a plain running mean
 * (`n` grows 1, 2, 3 …); after that the divisor sticks at the window size and
 * it becomes an exponential moving average with weight `1 / window`.
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
 * How long one clear of `wave` should be assumed to take while the player is away.
 *
 * `inProgressSeconds` is `WaveState.elapsed` at save time — the part of the
 * current wave the player had already fought when the app closed. It is used as
 * a *floor*: a wave that has already been running for 90 s cannot be a 52 s
 * wave, whatever the estimate says. It is not paid out; the kills it already
 * produced were banked live.
 *
 * `measured` is false when nothing has ever been clocked, which is what
 * `UNMEASURED_WAVE_PENALTY` answers.
 */
export function offlineWaveSeconds(
  t: WaveTimingState | undefined,
  wave: number,
  inProgressSeconds = 0,
): { seconds: number; measured: boolean } {
  const target = referenceWave(wave);
  const floor = Math.max(0, inProgressSeconds);
  if (!t || t.samples <= 0 || !(t.avgWaveSeconds > 0)) {
    const estimate = Math.max(expectedWaveSeconds(target), floor);
    return { seconds: clampSeconds(estimate), measured: false };
  }
  const from = referenceWave(t.sampleWave || target);
  const fromExpected = expectedWaveSeconds(from);
  const ratio = fromExpected > 0
    ? Math.min(WAVE_TIMING_RESCALE_MAX,
        Math.max(WAVE_TIMING_RESCALE_MIN, expectedWaveSeconds(target) / fromExpected))
    : 1;
  return { seconds: clampSeconds(Math.max(t.avgWaveSeconds * ratio, floor)), measured: true };
}
