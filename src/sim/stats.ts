import { BALANCE } from '../content/balance';
import { PASSIVE_BY_ID } from '../content/passives';
import type { PassiveId, StatKey, StatMod } from '../content/types';
import type { PassiveState, TowerStats } from './state';
import { scaleMod } from './pacts';

/**
 * The stat resolver (§12.3): a handful of keys, each resolved as
 * `(base + Σadd) × (1 + Σpct_meta) × (1 + Σpct_run) × Πmult` (S1: the
 * run's passives sum apart from everything brought into it). The run
 * resolves once at start and again whenever a passive changes; the
 * breakdown is for long-press details.
 */

const BASE: Readonly<Record<StatKey, number>> = {
  damage: 1,
  attackSpeed: 1,
  critChance: BALANCE.tower.critChance,
  critDamage: BALANCE.tower.critMult,
  range: BALANCE.tower.range,
  maxHp: BALANCE.tower.maxHp,
  regen: BALANCE.tower.regen,
  armor: BALANCE.tower.armor,
  xpGain: 1,
  shardGain: 1,
  ultCharge: 1,
  area: 1,
  duration: 1,
  projectileSpeed: 1,
  pierce: 0,
};

export interface StatBreakdown {
  base: number;
  add: number;
  /** The `meta` bucket: the Forge, stars, relics, frames, rules, pacts. */
  pct: number;
  /** The `run` bucket: this run's passives. */
  runPct: number;
  mult: number;
  value: number;
}

export function resolveStat(key: StatKey, mods: readonly StatMod[]): StatBreakdown {
  const base = BASE[key];
  let add = 0;
  let pct = 0;
  let runPct = 0;
  let mult = 1;
  for (const m of mods) {
    if (m.key !== key) continue;
    add += m.add ?? 0;
    if (m.bucket === 'run') runPct += m.pct ?? 0;
    else pct += m.pct ?? 0;
    mult *= m.mult ?? 1;
  }
  return { base, add, pct, runPct, mult, value: (base + add) * (1 + pct) * (1 + runPct) * mult };
}

export function resolveStats(mods: readonly StatMod[]): TowerStats {
  const v = (key: StatKey): number => resolveStat(key, mods).value;
  const maxHp = v('maxHp');
  return {
    maxHp,
    regen: maxHp * v('regen'),
    armor: v('armor'),
    radius: BALANCE.tower.radius,
    range: v('range'),
    critChance: Math.min(1, v('critChance')),
    critMult: v('critDamage'),
    damageMult: v('damage'),
    fireRateMult: v('attackSpeed'),
    xpMult: v('xpGain'),
    shardMult: v('shardGain'),
    ultChargeMult: v('ultCharge'),
    areaMult: v('area'),
    durationMult: v('duration'),
    projectileSpeedMult: v('projectileSpeed'),
    pierce: Math.round(v('pierce')),
  };
}

/** The tower's stats with nothing applied. */
export function baseTowerStats(): TowerStats {
  return resolveStats([]);
}

/**
 * A passive's contribution at `level`: its per-level mods, `level` times
 * over; its `atLevels` mods for each level reached; and its `perWave` mods
 * once per wave held, `level` times over. All in the `run` bucket (S1).
 */
export function passiveMods(id: PassiveId, level: number, waves = 0): StatMod[] {
  const def = PASSIVE_BY_ID[id];
  const out: StatMod[] = def.perLevel.map((m) => ({
    key: m.key,
    add: (m.add ?? 0) * level,
    pct: (m.pct ?? 0) * level,
    mult: Math.pow(m.mult ?? 1, level),
    bucket: 'run',
  }));
  for (const at of def.atLevels ?? []) {
    if (level >= at.level) out.push(...at.mods.map((m): StatMod => ({ ...m, bucket: 'run' })));
  }
  for (const m of def.perWave ?? []) out.push({ ...scaleMod(m, level * waves), bucket: 'run' });
  return out;
}

export function allMods(base: readonly StatMod[], passives: readonly PassiveState[]): StatMod[] {
  return [...base, ...passives.flatMap((p) => passiveMods(p.id, p.level, p.waves ?? 0))];
}
