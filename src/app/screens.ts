/**
 * The screen state machine (§12.3): boot → hub ⇄ run → results.
 *
 * Kept as a pure table so the legal moves are testable without a DOM, and so
 * an illegal one (results → run without passing a new seed through the hub's
 * start path, say) is a thrown error in development rather than a UI that
 * quietly ends up in two states at once.
 */
export type Screen = 'boot' | 'hub' | 'run' | 'results';

const TRANSITIONS: Readonly<Record<Screen, readonly Screen[]>> = {
  boot: ['hub'],
  hub: ['run'],
  // A run ends in results; there is no way back to the hub mid-run except
  // Retreat, which is a run end like any other (§4.2).
  run: ['results'],
  // "Run again" goes straight to a new run; "Forge" goes to the hub.
  results: ['hub', 'run'],
};

export function canTransition(from: Screen, to: Screen): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: Screen, to: Screen): void {
  if (!canTransition(from, to)) throw new Error(`illegal screen transition ${from} → ${to}`);
}
