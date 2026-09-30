import type { RngState } from '../core/rng';

/**
 * Everything a run is (§12.3). Plain data, so it can be hashed for the
 * determinism test and written as the run snapshot (§12.4).
 *
 * `render/` reads this and never writes it; `sim/` is the only writer.
 */
export interface TowerState {
  hp: number;
  maxHp: number;
}

export interface RunState {
  seed: number;
  regionId: number;
  /** Sim steps taken. `time` is derived from it so it never drifts. */
  tick: number;
  time: number;
  wave: number;
  tower: TowerState;
  rng: RngState;
  /** Set once, when the run ends. */
  outcome: null | { kind: 'fell' | 'retreat'; wave: number; time: number };
}

/** What the player can do to a run between steps. */
export interface RunInput {
  retreat?: boolean;
}
