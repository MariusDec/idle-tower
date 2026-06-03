export function enemyHPForWave(baseHP: number, wave: number): number {
  return baseHP * Math.pow(1.12, Math.max(0, wave - 1));
}

export function enemyDamageForWave(baseDamage: number, wave: number): number {
  return baseDamage + Math.floor(Math.max(0, wave - 1) / 5);
}

export function bossHPForWave(baseHP: number, wave: number): number {
  const waveIndex = Math.max(0, wave - 1);
  const tier = Math.floor(waveIndex / 10);
  return baseHP * Math.pow(1.12, waveIndex) * Math.pow(1.5, tier);
}

export function enemySpeedForWave(baseSpeed: number, wave: number): number {
  const mult = 1 + 0.03 * Math.max(0, wave - 1);
  return baseSpeed * Math.min(3, mult);
}

export function goldDropForWave(baseGold: number, wave: number): number {
  return baseGold * Math.pow(1.08, Math.max(0, wave - 1));
}

export function enemyCountForWave(wave: number): number {
  return 5 + Math.floor((wave - 1) * 1.5);
}

export function spawnIntervalForWave(wave: number): number {
  return Math.max(0.3, 2.0 - wave * 0.05);
}

export function isBossWave(wave: number): boolean {
  return wave > 0 && wave % 10 === 0;
}

export function upgradeCost(base: number, growth: number, level: number): number {
  return Math.floor(base * Math.pow(growth, level));
}
