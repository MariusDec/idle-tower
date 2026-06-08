import type { ResourceState, GameStats } from '../types';
import { EventBus } from '../game/EventBus';

export class ResourceManager {
  private resources: ResourceState;
  private stats: GameStats;
  private readonly bus: EventBus;
  private passiveGoldTimer = 0;
  private passiveGoldInterval = 1;

  constructor(initial: ResourceState, stats: GameStats, bus: EventBus) {
    this.resources = initial;
    this.stats = stats;
    this.bus = bus;
  }

  get gold(): number {
    return this.resources.gold;
  }
  get mana(): number {
    return this.resources.mana;
  }
  get lifetimeGold(): number {
    return this.resources.lifetimeGold;
  }
  get state(): ResourceState {
    return this.resources;
  }

  addGold(amount: number): void {
    if (amount <= 0) return;
    this.resources.gold += amount;
    this.resources.lifetimeGold += amount;
    this.stats.goldEarned += amount;
    this.bus.emit('gold_changed', this.resources.gold);
  }

  spendGold(amount: number): boolean {
    if (this.resources.gold < amount) return false;
    this.resources.gold -= amount;
    this.bus.emit('gold_changed', this.resources.gold);
    return true;
  }

  canAfford(amount: number): boolean {
    return this.resources.gold >= amount;
  }

  spendMana(amount: number): boolean {
    if (this.resources.mana < amount) return false;
    this.resources.mana -= amount;
    this.bus.emit('mana_changed', this.resources.mana);
    return true;
  }

  addMana(amount: number): void {
    if (amount <= 0) return;
    this.resources.mana = Math.min(this.resources.maxMana, this.resources.mana + amount);
    this.bus.emit('mana_changed', this.resources.mana);
  }

  tick(dt: number, wave: number): void {
    const regen = this.resources.manaRegen;
    if (regen > 0 && this.resources.mana < this.resources.maxMana) {
      this.resources.mana = Math.min(
        this.resources.maxMana,
        this.resources.mana + regen * dt,
      );
      this.bus.emit('mana_changed', this.resources.mana);
    }

    this.passiveGoldTimer += dt;
    if (this.passiveGoldTimer >= this.passiveGoldInterval) {
      this.passiveGoldTimer -= this.passiveGoldInterval;
      const passive = 0.05 * wave;
      if (passive > 0) this.addGold(passive);
    }
  }

  reset(): void {
    this.resources.gold = 0;
    this.resources.mana = 0;
    this.passiveGoldTimer = 0;
  }
}
