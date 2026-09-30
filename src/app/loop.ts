/**
 * The frame loop: a true fixed timestep (§12.3).
 *
 * The legacy loop split each frame's `dt` into equal substeps, so the step
 * length varied with the frame rate — fine for a game, fatal for a
 * deterministic sim. Here every sim step is exactly `SIM_DT`; wall time is
 * banked in an accumulator and paid out in whole steps. Speed multiplies what
 * is banked, so 3× speed is 3× the steps, never a longer step.
 *
 * The renderer is handed `alpha`, how far the wall clock is between the last
 * two sim steps, so motion stays smooth at any refresh rate.
 */

/** One sim step. The sim is written against this constant; do not vary it. */
export const SIM_DT = 1 / 60;

/**
 * Most steps paid out per frame. At 3× speed a 60 Hz frame needs 3; the rest
 * is headroom for hitches. Past it, time is dropped rather than spiralling —
 * the game slows down under load instead of freezing.
 */
const MAX_STEPS_PER_FRAME = 12;

/** A wall-clock frame longer than this (a backgrounded tab) is clamped. */
const MAX_FRAME_SECONDS = 0.1;

export interface LoopHooks {
  /** Advance the sim by exactly `SIM_DT`. */
  step(): void;
  /** Draw, `alpha` ∈ [0, 1) of the way from the previous step to the current. */
  render(alpha: number, realDt: number): void;
  /** Sim steps per wall-clock second, as a multiple of 60. 0 pauses the sim. */
  speed(): number;
}

export class Loop {
  private rafId = 0;
  private last = 0;
  private acc = 0;
  private running = false;

  constructor(private readonly hooks: LoopHooks) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.acc = 0;
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  /** Drop banked time, e.g. when a run starts or resumes from a pause screen. */
  resetClock(): void {
    this.last = performance.now();
    this.acc = 0;
  }

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    const realDt = Math.min(MAX_FRAME_SECONDS, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.acc += realDt * this.hooks.speed();
    let steps = 0;
    while (this.acc >= SIM_DT && steps < MAX_STEPS_PER_FRAME) {
      this.hooks.step();
      this.acc -= SIM_DT;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.acc = Math.min(this.acc, SIM_DT);
    this.hooks.render(this.acc / SIM_DT, realDt);
    this.rafId = requestAnimationFrame(this.frame);
  };
}
