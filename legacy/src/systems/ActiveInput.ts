import type { AbilityId } from '../types';
import { MANUAL_AIM } from '../data/tower';

/**
 * The charged-shot hold (gameplay plan §4.2).
 *
 * Lives outside `Game` for two reasons. It is the one piece of Part 4 whose
 * rules are subtle — "held still" is a different input from "held", and both
 * are different from "clicked" — and it is the one piece that runs on the
 * **wall clock** rather than the simulation clock, so it is worth being able
 * to state that in isolation and test it without a canvas.
 *
 * Wall-clock is the deliberate choice, following the precedent Part 1 set for
 * the draft timers: this timer measures a person holding still. A 1.2 s hold
 * that shrinks to 0.18 s at 6.5x speed is not the verb the plan describes, and
 * a 4 s cooldown that shrinks to 0.6 s would make the charged shot six times
 * stronger the moment the Accelerator perk is bought — the opposite of what an
 * idle game should reward. Everything the charge *does* still happens inside
 * `Game.simulate`, on the fixed substep, like any other shot.
 */
export class ChargeTracker {
  private held = 0;
  private cooldown = 0;
  private anchorX = 0;
  private anchorY = 0;
  private down = false;

  /** Charge fill, 0..1. Reaches 1 when the shot is armed. */
  get progress(): number {
    return Math.min(1, this.held / MANUAL_AIM.chargeSeconds);
  }

  get ready(): boolean {
    return this.cooldown <= 0 && this.held >= MANUAL_AIM.chargeSeconds;
  }

  /** Cooldown fill, 0..1. Zero when the charge is available. */
  get cooldownFraction(): number {
    return Math.min(1, Math.max(0, this.cooldown / MANUAL_AIM.chargeCooldown));
  }

  get onCooldown(): boolean {
    return this.cooldown > 0;
  }

  get isDown(): boolean {
    return this.down;
  }

  /**
   * Feed a pointer sample. Returns true when *this* sample was a release that
   * fired an armed charge, which is the caller's cue to queue the shot.
   *
   * Moving further than `chargeMoveTolerance` from the anchor re-anchors and
   * restarts the timer rather than cancelling the hold, so a player can settle
   * somewhere new and start charging again without lifting the button.
   */
  setPointer(x: number, y: number, down: boolean): boolean {
    const wasDown = this.down;
    let fired = false;
    if (down && !wasDown) {
      this.held = 0;
      this.anchorX = x;
      this.anchorY = y;
    } else if (down && wasDown) {
      const dx = x - this.anchorX;
      const dy = y - this.anchorY;
      const tol = MANUAL_AIM.chargeMoveTolerance;
      if (dx * dx + dy * dy > tol * tol) {
        this.held = 0;
        this.anchorX = x;
        this.anchorY = y;
      }
    } else if (!down && wasDown) {
      fired = this.ready;
      this.held = 0;
    }
    this.down = down;
    return fired;
  }

  /**
   * @param realDt        wall-clock seconds since the last frame
   * @param canCharge     false while something else owns the pointer (an
   *                      ability waiting to be placed), so the ring does not
   *                      fill under a click that means something different
   */
  tick(realDt: number, canCharge: boolean): void {
    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - realDt);
    if (this.down && canCharge && this.cooldown <= 0) {
      this.held = Math.min(MANUAL_AIM.chargeSeconds, this.held + realDt);
    }
  }

  /** Called once the shot has actually been fired inside the simulation. */
  consume(): void {
    this.cooldown = MANUAL_AIM.chargeCooldown;
    this.held = 0;
  }

  reset(): void {
    this.held = 0;
    this.cooldown = 0;
    this.down = false;
  }
}

/** What `AbilityPlacement.toggle` did with the request. */
export type PlacementToggle = 'begin' | 'cancel' | 'rejected';

/**
 * The "armed, waiting for a click" state for targeted abilities (plan §4.3).
 *
 * The invariant worth stating on its own: **placement mode never outlives its
 * reason.** Pressing the hotkey again cancels, `Escape` cancels, a wave
 * transition cancels, and a click always leaves the mode whether or not the
 * cast that follows succeeds. A prompt the player cannot clear, over an
 * ability that can no longer be cast, is the failure this class exists to make
 * impossible.
 */
export class AbilityPlacement {
  private armed: AbilityId | null = null;

  get pending(): AbilityId | null {
    return this.armed;
  }

  get isPlacing(): boolean {
    return this.armed !== null;
  }

  /**
   * Arm `id`, or cancel it if it is already armed.
   *
   * `canCast` is passed in rather than queried, so the rule "you are never
   * offered a placement for a cast that was never going to happen" is visible
   * here rather than buried in the caller.
   */
  toggle(id: AbilityId, canCast: boolean): PlacementToggle {
    if (this.armed === id) {
      this.armed = null;
      return 'cancel';
    }
    if (!canCast) {
      this.armed = null;
      return 'rejected';
    }
    this.armed = id;
    return 'begin';
  }

  /** Leave placement mode. Returns true only if there was something to leave. */
  cancel(): boolean {
    if (this.armed === null) return false;
    this.armed = null;
    return true;
  }

  /**
   * Resolve a click. Leaves placement mode **first**, so a cast that throws or
   * fails cannot strand the player in it, then reports what the cast did.
   */
  place(cast: (id: AbilityId) => boolean): boolean {
    const id = this.armed;
    this.armed = null;
    if (id === null) return false;
    return cast(id);
  }
}
