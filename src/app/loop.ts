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

/**
 * A capped frame is drawn this many ms early rather than skipped: rAF's
 * timestamps jitter around the vsync, and a 60 Hz frame read at 16.5 ms must
 * not be dropped by a 60 fps cap (R5 §2).
 */
const CAP_SLACK_MS = 2;

/**
 * The frame cap's verdict for one vsync: `null` to skip it, or the time to
 * stamp as the last drawn frame. The stamp is the ideal grid point, one
 * interval on from the last, not `now`: a frame let through a little early
 * must not pull the grid forward (144 Hz under 60 would creep to 62), and one
 * drawn late must not push it back (90 Hz under 60 would halve to 45).
 */
export function capGate(now: number, lastDraw: number, interval: number): number | null {
  const elapsed = now - lastDraw;
  if (elapsed < interval - CAP_SLACK_MS) return null;
  // A long gap (a hitch, a resume) starts the rhythm afresh.
  if (elapsed > interval * 2) return now;
  return lastDraw + interval;
}

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
  /** ms between drawn frames under the player's cap; 0 draws every vsync (R5 §2). */
  private interval = 0;
  private lastDraw = 0;

  constructor(private readonly hooks: LoopHooks) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.lastDraw = 0;
    this.acc = 0;
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  /**
   * Draw at most `fps` frames a second, or every vsync on null. The sim is
   * untouched: a skipped vsync banks no time, so the next drawn frame pays
   * out the steps of both, each still exactly `SIM_DT`.
   */
  setFrameCap(fps: number | null): void {
    this.interval = fps ? 1000 / fps : 0;
  }

  /** The cap in force, as the ms between frames (0: none). */
  get frameInterval(): number {
    return this.interval;
  }

  /** Drop banked time, e.g. when a run starts or resumes from a pause screen. */
  resetClock(): void {
    this.last = performance.now();
    this.acc = 0;
  }

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    if (this.interval > 0) {
      const drawn = capGate(now, this.lastDraw, this.interval);
      if (drawn === null) {
        this.rafId = requestAnimationFrame(this.frame);
        return;
      }
      this.lastDraw = drawn;
    }
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
