import type { DamageType, Enemy, TowerState, TargetingMode } from '../types';
import { distance2 } from '../utils/math';

/**
 * Independent contributors to the tower's fire rate. Each source is owned by
 * exactly one system; the effective multiplier is their product. Using a map
 * rather than a single scalar prevents one writer from silently cancelling
 * another (e.g. the Berserk buff vs. the manual-aim boost).
 */
export type FireRateSource = 'ability' | 'aim' | 'quickShot';

export class Tower {
  private state: TowerState;
  private fireRateSources: Record<FireRateSource, number> = {
    ability: 1,
    aim: 1,
    quickShot: 1,
  };
  private healthRegenBonus = 0;
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
    return this.state.fireRate * this.fireRateMultiplierValue;
  }

  get fireRateMultiplierValue(): number {
    const s = this.fireRateSources;
    return s.ability * s.aim * s.quickShot;
  }

  /**
   * Health regen from temporary buffs, expressed (like `healthRegen`) as a
   * fraction of maxHP per second. Kept separate from `state.healthRegen` so a
   * stat recompute cannot wipe an active buff.
   */
  get effectiveHealthRegen(): number {
    return this.state.healthRegen + this.healthRegenBonus;
  }

  setHealthRegenBonus(bonus: number): void {
    this.healthRegenBonus = Math.max(0, bonus);
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

  setFireRateSource(source: FireRateSource, multiplier: number): void {
    this.fireRateSources[source] = Math.max(0.01, multiplier);
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

  /**
   * @param damageType overrides the tower's default type — used by the
   *                   Enchant Weapons talent, which makes individual shots
   *                   land as magic damage.
   */
  applyResists(enemy: Enemy, rawDamage: number, damageType: DamageType = this.state.damageType): number {
    let dmg = rawDamage;
    if (damageType === 'magic') {
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
      this.fireRateSources.quickShot = 1;
    }
  }

  isQuickShotActive(): boolean {
    return this.quickShotActive;
  }

  activateQuickShot(durationSeconds: number): void {
    this.quickShotActive = true;
    this.quickShotTimer = durationSeconds;
    this.fireRateSources.quickShot = 2.0;
  }

  resetQuickShot(): void {
    this.quickShotActive = false;
    this.quickShotTimer = 0;
    this.fireRateSources.quickShot = 1;
  }
}
