import { BALANCE } from '../content/balance';
import { PASSIVE_BY_ID } from '../content/passives';
import type { PassiveId, StatKey, StatMod } from '../content/types';
import type { PassiveState, TowerStats } from './state';

/**
 * The stat resolver (§12.3): a handful of keys, each resolved as
 * `(base + Σadd) × (1 + Σpct) × Πmult`. The run resolves once at start and
 * again whenever a passive changes; the breakdown is for long-press details.
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
};

export interface StatBreakdown {
  base: number;
  add: number;
  pct: number;
  mult: number;
  value: number;
}

export function resolveStat(key: StatKey, mods: readonly StatMod[]): StatBreakdown {
  const base = BASE[key];
  let add = 0;
  let pct = 0;
  let mult = 1;
  for (const m of mods) {
    if (m.key !== key) continue;
    add += m.add ?? 0;
    pct += m.pct ?? 0;
    mult *= m.mult ?? 1;
  }
  return { base, add, pct, mult, value: (base + add) * (1 + pct) * mult };
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
  };
}

/** The tower's stats with nothing applied. */
export function baseTowerStats(): TowerStats {
  return resolveStats([]);
}

/** A passive's contribution at `level`: its per-level mods, `level` times over. */
export function passiveMods(id: PassiveId, level: number): StatMod[] {
  return PASSIVE_BY_ID[id].perLevel.map((m) => ({
    key: m.key,
    add: (m.add ?? 0) * level,
    pct: (m.pct ?? 0) * level,
    mult: Math.pow(m.mult ?? 1, level),
  }));
}

export function allMods(base: readonly StatMod[], passives: readonly PassiveState[]): StatMod[] {
  return [...base, ...passives.flatMap((p) => passiveMods(p.id, p.level))];
}
