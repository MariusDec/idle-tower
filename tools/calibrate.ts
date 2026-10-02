/**
 * Calibration (T2): the draft scorer's damage estimate (`damageDps`)
 * against the sim's own tally (`RunState.damageBy`, T1). Each weapon at
 * levels 1, 3 and 5, and evolved, fires on a fixed crowd in a sealed arena:
 * no waves and no walking; a body that falls is replaced where it stood
 * a moment later, so
 * every run sees the same field. Each body takes `BODY_HITS` of the weapon's
 * full hits (a beam's at full heat; unevolved, so an evolution meets the
 * same crowd), so a kill costs every weapon alike and
 * overkill, kill-fed evolutions and a beam's heat count as they do in a run.
 * The estimate may drift at most `MAX_DRIFT` from what lands.
 *
 *   npm run calibrate        the table: measured, estimated, ratio
 *
 * The crowd stands as a frontier field does, sampled from the bot's runs
 * (Regions 1–5, waves 10–19, the Forge a ring behind): eight bodies in
 * range, in loose pairs over a half turn, half of them near the edge of
 * range, a quarter halfway in and a quarter at the wall.
 */
import { SIM_DT } from '../src/app/loop';
import { WEAPONS } from '../src/content/weapons';
import { regionByIndex } from '../src/content/regions';
import type { WeaponId } from '../src/content/types';
import { createRun } from '../src/sim/run';
import { buildRunConfig } from '../src/meta/runConfig';
import { newProfile } from '../src/meta/profile';
import type { Enemy, RunState } from '../src/sim/state';
import { armed, newWeapon } from '../src/sim/systems/arms';
import { ENEMY_BY_ID } from '../src/content/enemies';
import { sweepProjectiles, tickBurns, tickProjectiles, tickRunes, tickWeapons } from '../src/sim/systems/combat';
import { spawnEnemy } from '../src/sim/systems/waves';
import { damageDps } from '../src/sim/suggest';

/** T2's bound: the estimate within this share of the measured damage, either way. */
export const MAX_DRIFT = 0.25;
/** The crowd's pairs: angle (radians) and distance as a share of the way from the wall to the edge of range. */
const PAIRS: readonly { a: number; at: number }[] = [
  { a: -1.4, at: 0.85 }, { a: -0.45, at: 0.5 }, { a: 0.45, at: 0 }, { a: 1.4, at: 0.85 },
];
/** How far apart a pair stands. */
const PAIR_GAP = 35;
/** A body's HP, in the weapon's full hits; and how long its spot stands empty once it falls. */
const BODY_HITS = 10;
const REFILL = 0.3;
/** How long each weapon fires on it, after a warm-up that is not counted. */
const WARMUP = 3;
const SECONDS = 20;
/** Levels each weapon is measured at; the last is measured evolved too. */
const LEVELS = [1, 3, 5] as const;

export interface CalibrationRow {
  weapon: WeaponId;
  level: number;
  evolved: boolean;
  measured: number;
  estimate: number;
  /** estimate ÷ measured. */
  ratio: number;
}

interface Arena {
  run: RunState;
  /** Where each body of the crowd stands, and the body standing there now. */
  spots: { x: number; y: number; body: Enemy; fell: number | null }[];
  hp: number;
}

/** A fresh tower, its stats as a new profile's, with this one weapon and the fixed crowd. */
function arena(id: WeaponId, level: number, evolved: boolean): Arena {
  const p = newProfile(0);
  p.tutorial.firstDraft = true;
  const run = createRun({ ...buildRunConfig(p), pool: [id] }, 1);
  run.weapons = [{ ...newWeapon(id, level), evolved }];
  // The same crowd for a weapon evolved or not: an evolution's step shows as faster kills.
  const w = armed(run.stats, newWeapon(id, level));
  const hp = BODY_HITS * w.damage * run.stats.damageMult * Math.max(1, w.rampCap);
  const R = run.stats.radius;
  const range = run.stats.range;
  const spots: Arena['spots'] = [];
  for (const { a, at } of PAIRS) {
    for (const side of [-1, 1]) {
      const d = R + BODY_RADIUS + (range - R - BODY_RADIUS) * at;
      const x = Math.cos(a) * d - Math.sin(a) * side * (PAIR_GAP / 2);
      const y = Math.sin(a) * d + Math.cos(a) * side * (PAIR_GAP / 2);
      spots.push({ x, y, body: stand(run, x, y, hp), fell: null });
    }
  }
  return { run, spots, hp };
}

const BODY_RADIUS = ENEMY_BY_ID.grunt.radius;

/** One body of the crowd: still, unarmoured, unshoved. */
function stand(run: RunState, x: number, y: number, hp: number): Enemy {
  const e = spawnEnemy(run, regionByIndex(1), 'grunt', 1, x, y, { single: true });
  Object.assign(e, { px: x, py: y, hp, maxHp: hp, armor: 0, speed: 0, mass: 1e12 });
  return e;
}

/** What one weapon lands per second on the crowd, after the warm-up. */
export function measure(id: WeaponId, level: number, evolved: boolean): number {
  const { run, spots, hp } = arena(id, level, evolved);
  let counted = 0;
  const total = (): number => Object.values(run.damageBy).reduce((a, b) => a + (b ?? 0), 0);
  const n = Math.round((WARMUP + SECONDS) / SIM_DT);
  for (let i = 0; i < n; i++) {
    if (i === Math.round(WARMUP / SIM_DT)) counted = total();
    run.tick++;
    run.time = run.tick * SIM_DT;
    tickWeapons(run, SIM_DT);
    tickProjectiles(run, SIM_DT);
    tickRunes(run);
    tickBurns(run, SIM_DT);
    sweepProjectiles(run);
    run.events.length = 0;
    // The fallen are replaced where they stood, a moment later, as a wave refills.
    run.enemies = run.enemies.filter((e) => e.alive);
    for (const s of spots) {
      if (s.body.alive) continue;
      s.fell ??= run.time;
      if (run.time - s.fell < REFILL) continue;
      s.body = stand(run, s.x, s.y, hp);
      s.fell = null;
    }
  }
  return (total() - counted) / SECONDS;
}

export function calibrate(weapons: readonly WeaponId[] = WEAPONS.map((w) => w.id)): CalibrationRow[] {
  const out: CalibrationRow[] = [];
  for (const weapon of weapons) {
    const cases: [number, boolean][] = [...LEVELS.map((l): [number, boolean] => [l, false]), [LEVELS[LEVELS.length - 1], true]];
    for (const [level, evolved] of cases) {
      const { run } = arena(weapon, level, evolved);
      const measured = measure(weapon, level, evolved);
      const estimate = damageDps({ id: weapon, level, evolved }, run.stats);
      out.push({ weapon, level, evolved, measured, estimate, ratio: estimate / Math.max(1e-9, measured) });
    }
  }
  return out;
}

/** Rows whose estimate drifts past T2's bound. */
export function drifted(rows: readonly CalibrationRow[]): CalibrationRow[] {
  return rows.filter((r) => Math.abs(r.ratio - 1) > MAX_DRIFT);
}

function main(): void {
  const rows = calibrate();
  console.log('weapon            lvl  evo   measured  estimate   ratio');
  for (const r of rows) {
    const flag = Math.abs(r.ratio - 1) > MAX_DRIFT ? '  ✗' : '';
    console.log(`${r.weapon.padEnd(17)} ${String(r.level).padStart(3)}  ${r.evolved ? 'yes' : '   '}  ${r.measured.toFixed(1).padStart(9)} ${r.estimate.toFixed(1).padStart(9)}  ${r.ratio.toFixed(2).padStart(6)}${flag}`);
  }
  const bad = drifted(rows);
  console.log(`T2 ${bad.length === 0 ? 'PASS' : 'FAIL'}: ${bad.length} of ${rows.length} estimates drift more than ${MAX_DRIFT * 100}%`);
}

if (process.argv[1]?.includes('calibrate')) main();
