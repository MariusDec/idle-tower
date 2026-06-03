import type { Enemy, TowerState, TargetingMode } from '../types';
import { distance2 } from '../utils/math';

export class Tower {
  private state: TowerState;
  private fireRateMultiplier = 1;
  private activeMode = false;
  private aimX = 0;
  private aimY = 0;

  constructor(state: TowerState) {
    this.state = state;
  }

  get snapshot(): TowerState {
    return this.state;
  }

  get isActiveMode(): boolean {
    return this.activeMode;
  }

  get aimTarget(): { x: number; y: number } {
    return { x: this.aimX, y: this.aimY };
  }

  setActiveMode(enabled: boolean): void {
    this.activeMode = enabled;
  }

  setAimTarget(x: number, y: number): void {
    this.aimX = x;
    this.aimY = y;
  }

  get effectiveFireRate(): number {
    const base = this.activeMode ? this.state.activeFireRate : this.state.fireRate;
    return base * this.fireRateMultiplier;
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

    switch (this.state.targetingMode) {
      case 'nearest': {
        let best: Enemy | null = null;
        let bestD = Infinity;
        for (const e of candidates) {
          const d = distance2(this.state.x, this.state.y, e.x, e.y);
          if (d < bestD) {
            bestD = d;
            best = e;
          }
        }
        return best;
      }
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
      case 'first': {
        let best: Enemy | null = null;
        let bestDistToTower = Infinity;
        for (const e of candidates) {
          const d = distance2(e.x, e.y, this.state.x, this.state.y);
          if (d < bestDistToTower) {
            bestDistToTower = d;
            best = e;
          }
        }
        return best;
      }
    }
  }

  rollShot(): { damage: number; isCrit: boolean } {
    const isCrit = Math.random() < this.state.critChance;
    const damage = isCrit
      ? this.state.baseDamage * this.state.critMultiplier
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
}
