import type { Enemy, TowerState, TargetingMode } from '../types';
import { distance2 } from '../utils/math';

export class Tower {
  private state: TowerState;
  private fireRateMultiplier = 1;
  private critBonusChance = 0;
  private critBonusMultiplier = 1;
  private lifestealMultiplier = 1;
  private quickShotActive = false;
  private quickShotTimer = 0;
  private aimX = 0;
  private aimY = 0;

  constructor(state: TowerState) {
    this.state = state;
  }

  get snapshot(): TowerState {
    return this.state;
  }

  get aimTarget(): { x: number; y: number } {
    return { x: this.aimX, y: this.aimY };
  }

  setAimTarget(x: number, y: number): void {
    this.aimX = x;
    this.aimY = y;
  }

  get effectiveFireRate(): number {
    return this.state.fireRate * this.fireRateMultiplier;
  }

  get fireRateMultiplierValue(): number {
    return this.fireRateMultiplier;
  }

  get effectiveCritChance(): number {
    return Math.min(1, this.state.critChance + this.critBonusChance);
  }

  get effectiveCritMultiplier(): number {
    return this.state.critMultiplier * this.critBonusMultiplier;
  }

  get effectiveLifesteal(): number {
    return this.state.lifesteal * this.lifestealMultiplier;
  }

  setPosition(x: number, y: number): void {
    this.state.x = x;
    this.state.y = y;
  }

  setTargetingMode(mode: TargetingMode): void {
    this.state.targetingMode = mode;
  }

  applyStatMods(mods: Partial<TowerState>): void {
    Object.assign(this.state, mods);
  }

  setFireRateMultiplier(multiplier: number): void {
    this.fireRateMultiplier = Math.max(0.01, multiplier);
  }

  setCritBonus(extraChance: number, extraMultiplier: number): void {
    this.critBonusChance = Math.max(0, Math.min(1, extraChance));
    this.critBonusMultiplier = Math.max(1, extraMultiplier);
  }

  setLifestealMultiplier(multiplier: number): void {
    this.lifestealMultiplier = Math.max(1, multiplier);
  }

  acquireTarget(enemies: Enemy[]): Enemy | null {
    const rangeSq = this.state.range * this.state.range;
    const candidates: Enemy[] = [];
    for (const e of enemies) {
      if (!e.alive) continue;
      if (distance2(this.state.x, this.state.y, e.x, e.y) <= rangeSq) {
        candidates.push(e);
      }
    }
    if (candidates.length === 0) return null;

    const findNearest = (list: Enemy[]): Enemy | null => {
      let best: Enemy | null = null;
      let bestD = Infinity;
      for (const e of list) {
        const d = distance2(this.state.x, this.state.y, e.x, e.y);
        if (d < bestD) {
          bestD = d;
          best = e;
        }
      }
      return best;
    };

    switch (this.state.targetingMode) {
      case 'nearest':
      case 'first':
        return findNearest(candidates);
      case 'lowest_hp': {
        let best: Enemy | null = null;
        let bestHp = Infinity;
        for (const e of candidates) {
          if (e.hp < bestHp) {
            bestHp = e.hp;
            best = e;
          }
        }
        return best;
      }
      case 'strongest': {
        let best: Enemy | null = null;
        let bestHp = -Infinity;
        for (const e of candidates) {
          if (e.maxHp > bestHp) {
            bestHp = e.maxHp;
            best = e;
          }
        }
        return best;
      }
      case 'boss': {
        // Prioritize bosses, then nearest
        const bosses = candidates.filter(e => e.type === 'boss');
        if (bosses.length > 0) return findNearest(bosses);
        return findNearest(candidates);
      }
      case 'flying': {
        // Prioritize flying, then nearest
        const flying = candidates.filter(e => e.type === 'flying');
        if (flying.length > 0) return findNearest(flying);
        return findNearest(candidates);
      }
      case 'last': {
        let best: Enemy | null = null;
        let bestD = -Infinity;
        for (const e of candidates) {
          const d = distance2(this.state.x, this.state.y, e.x, e.y);
          if (d > bestD) {
            bestD = d;
            best = e;
          }
        }
        return best;
      }
    }
  }

  rollShot(): { damage: number; isCrit: boolean } {
    const isCrit = Math.random() < this.effectiveCritChance;
    const damage = isCrit
      ? this.state.baseDamage * this.effectiveCritMultiplier
      : this.state.baseDamage;
    return { damage, isCrit };
  }

  applyResists(enemy: Enemy, rawDamage: number): number {
    let dmg = rawDamage;
    if (this.state.damageType === 'magic') {
      dmg *= 1 - enemy.magicResist;
    } else {
      dmg -= enemy.armor;
    }
    return Math.max(1, dmg);
  }

  consumeCooldown(): void {
    this.state.cooldown = 1 / this.effectiveFireRate;
  }

  tickCooldown(dt: number): boolean {
    if (this.state.cooldown > 0) this.state.cooldown -= dt;
    return this.state.cooldown <= 0;
  }

  tickQuickShot(dt: number): void {
    if (!this.quickShotActive) return;
    this.quickShotTimer -= dt;
    if (this.quickShotTimer <= 0) {
      this.quickShotTimer = 0;
      this.quickShotActive = false;
    }
  }

  isQuickShotActive(): boolean {
    return this.quickShotActive;
  }

  activateQuickShot(durationSeconds: number): void {
    this.quickShotActive = true;
    this.quickShotTimer = durationSeconds;
    this.fireRateMultiplier = 2.0;
  }

  resetQuickShot(): void {
    this.quickShotActive = false;
    this.quickShotTimer = 0;
  }
}
