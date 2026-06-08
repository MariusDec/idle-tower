export function enemyHPForWave(baseHP: number, wave: number): number {
  return baseHP * Math.pow(1.17, Math.max(0, wave - 1));
}

export function enemyDamageForWave(baseDamage: number, wave: number): number {
  return baseDamage * Math.pow(1.1, Math.max(0, wave));
}

export function bossHPForWave(baseHP: number, wave: number): number {
  const waveIndex = Math.max(0, wave - 1);
  const tier = Math.floor(waveIndex / 10);
  return baseHP * Math.pow(1.12, waveIndex) * Math.pow(1.35, tier);
}

export function enemySpeedForWave(baseSpeed: number, wave: number): number {
  const mult = 1 + 0.03 * Math.max(0, wave - 1);
  return baseSpeed * Math.min(3, mult);
}

export function goldDropForWave(baseGold: number, wave: number): number {
  return baseGold * Math.pow(1.08, Math.max(0, wave - 1));
}

export function enemyCountForWave(wave: number): number {
  return 5 + Math.floor((wave - 1) * 1.2);
}

export function bossCountForWave(wave: number): number {
  const tier = Math.max(1, Math.floor(wave / 10));
  return 2 + tier;
}

export function spawnCountForWave(wave: number): number {
  if (isBossWave(wave)) return bossCountForWave(wave);
  return enemyCountForWave(wave);
}

export function spawnIntervalForWave(wave: number): number {
  return Math.max(0.4, 2.0 - wave * 0.04);
}

export function isBossWave(wave: number): boolean {
  return wave > 0 && wave % 10 === 0;
}

export function evalFormula(formula: string, level: number): number {
  const expr = formula.replace(/\{level\}/g, String(level));
  return Function('"use strict"; return (' + expr + ')')();
}

export function upgradeCost(base: number, growth: number | string, level: number): number {
  const g = typeof growth === 'string' ? evalFormula(growth, level) : growth;
  return Math.floor(base * Math.pow(g, level));
}

/**
 * Cost of upgrading an ability from its current level to the next.
 * Mirrors the tower-upgrade cost shape but takes a plain numeric growth.
 *   cost(level) = floor(baseCost * growth^level)
 */
export function abilityUpgradeCost(baseCost: number, growth: number, level: number): number {
  if (level <= 0) return Math.floor(baseCost);
  return Math.floor(baseCost * Math.pow(growth, level));
}
