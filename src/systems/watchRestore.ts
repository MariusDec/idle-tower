/**
 * Restore a persisted `WatchState` into the live one, field by field.
 *
 * v19+: The Long Watch is permanent state (`WatchState` in types.ts is
 * explicit that neither reset may touch it), and it is saved — but it was
 * never restored, so every load silently wiped the campaign. Copied field
 * by field rather than assigned, because `WatchManager` captured
 * `state.watch` by reference in its `state:` dep at construction time and
 * replacing the object would leave the manager reading a detached one.
 *
 * Lives in its own file so `tests/watch.test.ts` can call it without
 * standing up a `Game`. The behaviour matches the inline block in
 * `Game.applyPersistedState` that called this before §1.1 of
 * `plans/improvements.md`; relocation only.
 */
import type { EnemyType, WatchState } from '../types';
import { MAX_RISK_CEILING } from '../data/pacing';

export function applyPersistedWatch(target: WatchState, saved: WatchState | undefined): void {
  if (!saved) return;
  target.completed.length = 0;
  for (const id of saved.completed ?? []) target.completed.push(id);
  const c = target.counters;
  const sc = saved.counters;
  for (const k of Object.keys(c.killsByType)) {
    delete c.killsByType[k as EnemyType];
  }
  for (const [type, count] of Object.entries(sc.killsByType ?? {})) {
    c.killsByType[type as EnemyType] = count as number;
  }
  c.flawlessWaves = sc.flawlessWaves ?? 0;
  c.swiftBosses = sc.swiftBosses ?? 0;
  c.contractsDone = sc.contractsDone ?? 0;
  c.blessingPicks = sc.blessingPicks ?? 0;
  c.mutatorWaves = sc.mutatorWaves ?? 0;
  c.riskWaves.length = 0;
  for (let i = 0; i <= MAX_RISK_CEILING; i++) {
    c.riskWaves.push(sc.riskWaves?.[i] ?? 0);
  }
}