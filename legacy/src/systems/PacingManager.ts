import {
  COMBO_WINDOW_SECONDS,
  EARLY_CALL_GOLD_PER_SECOND,
  MAX_RISK,
  MOMENTUM_CAP,
  clampRisk,
  comboBonus,
  comboNextThreshold,
  comboTierIndex,
  comboTierLabel,
} from '../data/pacing';
import type { PacingState } from '../types';

/**
 * The run's pacing state (gameplay plan §7): the risk dial, early-call
 * momentum and the kill combo.
 *
 * One manager rather than three, because the three quantities share a
 * lifetime, a persistence block and — crucially — a single stat-resolve
 * trigger. Everything here is either a discrete level (risk, combo tier) or
 * changes only on a wave boundary (momentum), which is what lets `Game`
 * recompute stats on a *signature change* instead of every substep. See
 * `Game.refreshPacingStats`, which is the same shape as
 * `refreshHpThresholdStats`, and for the same reason: Part 6 found three
 * effects that read live state and armed at the next unrelated resolve.
 *
 * No DOM, no event bus, no canvas — so a test drives the real thing.
 */
export class PacingManager {
  /** The dial as the player set it. Takes effect at the next wave. */
  private risk = 0;
  /** The dial the current wave is actually running. */
  private committedRisk = 0;
  /** Accumulated early-call gold bonus, 0..MOMENTUM_CAP. */
  private momentum = 0;
  /** Consecutive waves called early, for the HUD readout. */
  private momentumWaves = 0;
  /**
   * Set by `noteWaveCalledEarly`, consumed by `noteWaveStarted`.
   *
   * Any wave start that was *not* preceded by a call breaks the streak, which
   * covers the full intermission the plan names and also every other way a
   * wave can begin — a rewind, a manual skip, a load, a wave-skip roll.
   */
  private calledEarlyPending = false;
  private comboKills = 0;
  private comboTimer = 0;
  private comboTier = 0;
  /** Best combo this run, for the run summary and the meter's ghost mark. */
  private comboBest = 0;
  // ── Tempo talent: momentum gain multiplier and cap bonus ──
  private momentumGainMult = 0;
  private momentumCapBonus = 0;

  /**
   * The dial's current ceiling. `Game` raises it with Watch unlocks
   * (`riskbearer` → 6, `deep_watch` → 7 — plans/milestones.md §5.5).
   *
   * Default reproduces today's behaviour: `MAX_RISK`. The default is what keeps
   * the simulator byte-identical to `HEAD` (rule §0.5): `sim/model.ts` builds
   * a fresh `PacingManager` with no provider, and never sees a wider dial.
   */
  private maxRisk: () => number = () => MAX_RISK;

  setMaxRiskProvider(fn: () => number): void {
    this.maxRisk = fn;
  }

  // ── risk ────────────────────────────────────────────────────────────────

  setRisk(level: number): number {
    this.risk = clampRisk(level, this.maxRisk());
    return this.risk;
  }

  get riskLevel(): number {
    return this.risk;
  }

  /** The risk the live wave is running — what every multiplier reads. */
  get activeRisk(): number {
    return this.committedRisk;
  }

  /** True while the dial has been moved but the next wave has not begun. */
  get riskPending(): boolean {
    return this.risk !== this.committedRisk;
  }

  // ── momentum ────────────────────────────────────────────────────────────

  /** Tempo talent: momentum gain multiplier and cap bonus. */
  setMomentumBonus(gainMult: number, capBonus: number): void {
    this.momentumGainMult = Math.max(0, gainMult);
    this.momentumCapBonus = Math.max(0, capBonus);
  }

  /**
   * Bank a call-the-wave-early bonus. `seconds` is the intermission actually
   * skipped, so a player who calls with 0.2 s left banks almost nothing.
   */
  noteWaveCalledEarly(seconds: number): number {
    const gained = Math.max(0, seconds) * EARLY_CALL_GOLD_PER_SECOND * (1 + this.momentumGainMult);
    const cap = MOMENTUM_CAP + this.momentumCapBonus;
    this.momentum = Math.min(cap, this.momentum + gained);
    this.momentumWaves += 1;
    this.calledEarlyPending = true;
    return this.momentum;
  }

  /**
   * A wave has begun. Commits the risk dial and settles the momentum streak.
   */
  noteWaveStarted(): void {
    this.committedRisk = this.risk;
    if (this.calledEarlyPending) {
      this.calledEarlyPending = false;
    } else {
      this.clearMomentum();
    }
    this.breakCombo();
  }

  /** The tower lost HP — the streak is over (plan §7.1). */
  noteTowerDamaged(): void {
    this.clearMomentum();
  }

  private clearMomentum(): void {
    this.momentum = 0;
    this.momentumWaves = 0;
  }

  get momentumBonus(): number {
    return this.momentum;
  }

  get momentumStreak(): number {
    return this.momentumWaves;
  }

  // ── combo ───────────────────────────────────────────────────────────────

  /**
   * Age the combo window. **Simulation clock** — see `COMBO_WINDOW_SECONDS`.
   */
  tickCombo(dt: number): void {
    if (this.comboKills === 0) return;
    this.comboTimer -= dt;
    if (this.comboTimer <= 0) this.breakCombo();
  }

  noteKill(): void {
    this.comboKills += 1;
    this.comboTimer = COMBO_WINDOW_SECONDS;
    this.comboTier = comboTierIndex(this.comboKills);
    if (this.comboKills > this.comboBest) this.comboBest = this.comboKills;
  }

  private breakCombo(): void {
    this.comboKills = 0;
    this.comboTimer = 0;
    this.comboTier = 0;
  }

  get combo(): number {
    return this.comboKills;
  }

  get comboTierIndex(): number {
    return this.comboTier;
  }

  get comboBestThisRun(): number {
    return this.comboBest;
  }

  /** How full the drain bar is, 1 right after a kill and 0 at the break. */
  get comboFraction(): number {
    if (this.comboKills === 0) return 0;
    return Math.max(0, Math.min(1, this.comboTimer / COMBO_WINDOW_SECONDS));
  }

  get comboLabel(): string | null {
    return comboTierLabel(this.comboTier);
  }

  get comboNext(): number | null {
    return comboNextThreshold(this.comboKills);
  }

  /** Gold and XP the current tier is paying, both 0 when there is no combo. */
  get comboBonus(): { gold: number; xp: number } {
    return comboBonus(this.comboTier);
  }

  // ── lifetime ────────────────────────────────────────────────────────────

  /**
   * Everything that changes a resolved stat, as one comparable number.
   *
   * Momentum is quantised to 0.1% so a float that differs in its last bit
   * cannot trigger a resolve; it only ever moves in steps of
   * `EARLY_CALL_GOLD_PER_SECOND x seconds` anyway.
   */
  statSignature(): number {
    return this.committedRisk * 1e6
      + this.comboTier * 1e4
      + Math.round(this.momentum * 1000);
  }

  /**
   * Reset for a new run (ascension / transcendence).
   *
   * The *dial* survives, exactly like the auto-buy strategy and the target
   * ascend wave: it is a preference about how the player wants to play, and an
   * auto-ascending game reaches this reset several times an hour with nobody
   * watching. Everything earned inside the run does not survive.
   */
  reset(): void {
    this.committedRisk = this.risk;
    this.clearMomentum();
    this.calledEarlyPending = false;
    this.breakCombo();
    this.comboBest = 0;
    this.momentumGainMult = 0;
    this.momentumCapBonus = 0;
  }

  snapshot(): PacingState {
    return {
      risk: this.risk,
      committedRisk: this.committedRisk,
      momentum: this.momentum,
      momentumWaves: this.momentumWaves,
      comboBest: this.comboBest,
    };
  }

  restore(state: PacingState | undefined | null): void {
    // Route through the same ceiling `setRisk` uses, so a save written at
    // risk 7 does not survive a Watch unlock being lost (plans/milestones.md
    // §5.5: the same ceiling is applied wherever a saved risk level is read).
    const ceiling = this.maxRisk();
    this.risk = clampRisk(state?.risk ?? 0, ceiling);
    this.committedRisk = clampRisk(state?.committedRisk ?? this.risk, ceiling);
    this.momentum = Math.max(0, Math.min(MOMENTUM_CAP, state?.momentum ?? 0));
    this.momentumWaves = Math.max(0, Math.floor(state?.momentumWaves ?? 0));
    this.comboBest = Math.max(0, Math.floor(state?.comboBest ?? 0));
    // A live combo is not persisted: it decays in two seconds and a load is
    // never inside that window. Same rule as live enemies and live orbs.
    this.breakCombo();
    this.calledEarlyPending = false;
  }
}
