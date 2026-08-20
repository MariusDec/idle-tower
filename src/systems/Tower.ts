import type { DamageType, Enemy, TowerState, TargetingMode } from '../types';
import { distance2 } from '../utils/math';

/**
 * The tower owns no stat of its own.
 *
 * Every field of `TowerState` is written by `Game.applyResolvedStats` from a
 * single `resolveStats` pass, and every temporary modifier — ability buffs,
 * quick shot, the manual-aim boost — is an entry in the `BuffRegistry` that
 * feeds that same pass. The `effective*` getters are kept because call sites
 * read them, but they are now plain reads: there is nothing left to compose at
 * the point of use.
 */
export class Tower {
  private state: TowerState;
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
    return this.state.fireRate;
  }

  /** Fraction of maxHP regenerated per second, buffs included. */
  get effectiveHealthRegen(): number {
    return this.state.healthRegen;
  }

  get effectiveCritChance(): number {
    return this.state.critChance;
  }

  get effectiveCritMultiplier(): number {
    return this.state.critMultiplier;
  }

  get effectiveLifesteal(): number {
    return this.state.lifesteal;
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

}
