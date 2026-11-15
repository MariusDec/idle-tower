import { BALANCE } from '../../content/balance';
import type { FrameId } from '../../content/types';
import type { RunState } from '../state';
import { refreshStats } from './draft';
import { runWave } from './waves';

/**
 * Final Form (plans/late-game/07 §3). Evolve `need` weapons in one run and
 * the tower takes its frame's form until the run ends. No die is rolled and
 * nothing is withheld from the idle bot: the check is pure state, run where a
 * weapon becomes evolved or anomalous.
 */

/** What a run needs for Final Form, fixed at `createRun`: 0 when it can't be reached (no Alchemy, too few slots). */
export function formNeed(cfg: { weaponSlots: number; passiveSlots: number; behaviours: { alchemy?: number } }): number {
  const F = BALANCE.finalForm;
  const alchemy = (cfg.behaviours.alchemy ?? 0) > 0;
  return cfg.weaponSlots >= F.minSlots && cfg.passiveSlots >= F.need && alchemy ? F.need : 0;
}

/** Weapons that count toward Final Form: evolved (fused halves are) or anomalous. */
export function formCount(run: RunState): number {
  let n = 0;
  for (const w of run.weapons) if (w.evolved || w.anomaly) n++;
  return n;
}

/**
 * Latch Final Form once the run has evolved `need` weapons: set the wave,
 * send the event, and (only with `ultCharge` above 0) add the ult mod to
 * both `outerMods` and `mods`, so an Abyss floor's rebuild keeps it.
 */
export function checkFinalForm(run: RunState): void {
  const f = run.form;
  if (f.need <= 0 || f.wave !== null) return;
  if (formCount(run) < f.need) return;
  f.wave = runWave(run);
  run.events.push({ kind: 'finalForm', frame: run.frameId as FrameId });
  const bonus = BALANCE.finalForm.ultCharge;
  if (bonus > 0) {
    const mod = { key: 'ultCharge' as const, pct: bonus, bucket: 'run' as const };
    run.outerMods.push(mod);
    run.mods.push(mod);
    refreshStats(run);
  }
}
