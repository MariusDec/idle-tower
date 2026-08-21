import type { AbilityId, AbilityState, Enemy } from '../types';
import { world } from '../data/arena';
import {
  ABILITIES,
  ABILITY_BY_ID,
  METEOR_SPLASH_RADIUS,
  PLACEMENT_FOCUS_CHILL,
  PLACEMENT_FOCUS_CHILL_DURATION,
  PLACEMENT_FOCUS_DAMAGE_BONUS,
  computeEffectiveStats,
  isPlaceable,
  placementRadius,
  type AbilityDef,
  type AbilityEffectType,
  type EffectiveAbilityStats,
} from '../data/abilities';
import { isTargetable } from '../data/enemies';
import { abilityUpgradeCost } from '../data/formulas';
import { abilityXpForLevel } from '../data/xpTables';
import { EventBus } from '../game/EventBus';
import type { ResourceManager } from './ResourceManager';
import type { EnemyManager } from './EnemyManager';
import type { Tower } from './Tower';
import type { ProjectileManager } from './ProjectileManager';
import type { BuffRegistry } from '../stats/BuffRegistry';

interface AbilityManagerDeps {
  resources: ResourceManager;
  enemies: EnemyManager;
  tower: Tower;
  bus: EventBus;
  projectileManager: ProjectileManager;
  buffs: BuffRegistry;
  getState: (id: AbilityId) => AbilityState;
  onCast: (id: AbilityId) => void;
}

/**
 * Buff ids this manager owns. Each ability effect maps to a stable id so a
 * recast replaces its own buff rather than stacking a second copy.
 */
const BUFF_FIRE_RATE = 'ability:fireRate';
const BUFF_GOLD = 'ability:gold';
const BUFF_CRIT_CHANCE = 'ability:critChance';
const BUFF_CRIT_DAMAGE = 'ability:critDamage';
const BUFF_LIFESTEAL = 'ability:lifesteal';
const BUFF_VAMPIRIC_REGEN = 'ability:vampiricRegen';

/** Crit multiplier granted alongside the crit-chance buff. */
const CRIT_BUFF_DAMAGE_MULTIPLIER = 1.5;
/** Vampiric Aura's flat regen, as a fraction of maxHP per second. */
const VAMPIRIC_REGEN = 0.01;

const MANA_UNLOCK_WAVE = 10;
const METEOR_SPLASH_MULTIPLIER = 2;
const CHAIN_BOUNCE_BASE = 5;
const CHAIN_BOUNCE_PER_LEVEL = 1;
const CHAIN_BOUNCE_MAX = 9;
const CHAIN_BOUNCE_RADIUS = world(200);
const CHAIN_DECAY = 0.65;
const EXECUTE_BOSS_MULTIPLIER = 5;

export class AbilityManager {
  private readonly resources: ResourceManager;
  private readonly enemies: EnemyManager;
  private readonly tower: Tower;
  private readonly bus: EventBus;
  private readonly projectileMgr: ProjectileManager;
  private readonly buffs: BuffRegistry;
  private readonly getState: (id: AbilityId) => AbilityState;
  private readonly onCast: (id: AbilityId) => void;
  private abilityCostMultiplier = 1;
  private cooldownMultiplier = 1;
  private damageMultiplier = 1;
  private berserkFireBonus = 0;
  // ── Talent-driven modifiers (set by Game.applyTalentEffects) ──
  /** Chain Bounce: extra Chain Lightning bounces. */
  private chainBounceBonus = 0;
  /** Frostbite: strengthens the slow (0.1 = 10% more speed removed). */
  private slowStrengthBonus = 0;
  /** Meteor Shower: extra Meteor Strike damage. */
  private meteorDamageBonus = 0;
  /** Extended Buffs: extra duration on timed abilities. */
  private buffDurationBonus = 0;
  /** Frostwork core: slow abilities run this many times as long (plan §6.1). */
  private slowDurationMult = 1;
  /**
   * Reused by the auto-placer's cluster scan (plan §4.3 / cross-cutting rule 6).
   *
   * Safe to share because the scan only *reads* — nothing in `pickBestSpot`
   * damages an enemy, so nothing can re-enter `queryRadius` underneath it.
   */
  private readonly placementScratch: Enemy[] = [];

  constructor(deps: AbilityManagerDeps) {
    this.resources = deps.resources;
    this.enemies = deps.enemies;
    this.tower = deps.tower;
    this.bus = deps.bus;
    this.projectileMgr = deps.projectileManager;
    this.buffs = deps.buffs;
    this.getState = deps.getState;
    this.onCast = deps.onCast;
  }

  isManaUnlocked(wave: number): boolean {
    return wave >= MANA_UNLOCK_WAVE;
  }

  setAbilityCostMultiplier(value: number): void {
    this.abilityCostMultiplier = Math.max(0.1, Math.min(1, value));
  }

  setCooldownMultiplier(value: number): void {
    this.cooldownMultiplier = Math.max(0.1, Math.min(1, value));
  }

  setDamageMultiplier(value: number): void {
    this.damageMultiplier = Math.max(1, value);
  }

  setBerserkFireBonus(bonus: number): void {
    this.berserkFireBonus = bonus;
  }

  setChainBounceBonus(bonus: number): void {
    this.chainBounceBonus = Math.max(0, Math.floor(bonus));
  }

  setSlowStrengthBonus(bonus: number): void {
    this.slowStrengthBonus = Math.max(0, bonus);
  }

  setMeteorDamageBonus(bonus: number): void {
    this.meteorDamageBonus = Math.max(0, bonus);
  }

  setBuffDurationBonus(bonus: number): void {
    this.buffDurationBonus = Math.max(0, bonus);
  }

  getAbilityLevel(id: AbilityId): number {
    const state = this.getState(id);
    if (!state) return 0;
    return Math.max(0, state.level);
  }

  isMaxed(id: AbilityId): boolean {
    const def = ABILITY_BY_ID[id];
    if (!def) return false;
    return this.getAbilityLevel(id) >= def.maxLevel;
  }

  getUnlockWave(id: AbilityId): number {
    const def = ABILITY_BY_ID[id];
    return def ? def.unlockWave : MANA_UNLOCK_WAVE;
  }

  isAbilityUnlocked(id: AbilityId, wave: number): boolean {
    if (!this.isManaUnlocked(wave)) return false;
    return wave >= this.getUnlockWave(id);
  }

  /** Raw, un-discounted mana cost of the ability at the given level. */
  getBaseManaCost(id: AbilityId, level: number): number {
    const def = ABILITY_BY_ID[id];
    if (!def) return 0;
    const lvl = Math.max(1, Math.min(def.maxLevel, level));
    return def.manaCost + def.manaCostPerLevel * (lvl - 1);
  }

  /** Raw, un-discounted cooldown of the ability at the given level. */
  getBaseCooldown(id: AbilityId, level: number): number {
    const def = ABILITY_BY_ID[id];
    if (!def) return 0;
    const lvl = Math.max(1, Math.min(def.maxLevel, level));
    return Math.max(1, def.cooldown - def.cooldownReductionPerLevel * (lvl - 1));
  }

  getEffectiveManaCost(id: AbilityId): number {
    const def = ABILITY_BY_ID[id];
    if (!def) return 0;
    return Math.max(1, Math.ceil(this.getBaseManaCost(id, this.getAbilityLevel(id)) * this.abilityCostMultiplier));
  }

  getEffectiveCooldown(id: AbilityId): number {
    const def = ABILITY_BY_ID[id];
    if (!def) return 0;
    return Math.max(1, this.getBaseCooldown(id, this.getAbilityLevel(id)) * this.cooldownMultiplier);
  }

  getEffectiveEffectValue(id: AbilityId): number {
    const def = ABILITY_BY_ID[id];
    if (!def) return 0;
    const level = this.getAbilityLevel(id);
    return def.effectValue + def.effectValuePerLevel * (level - 1);
  }

  /**
   * Frostwork's `nova_extended` (plan §6.1): slow abilities last this many
   * times as long. Keyed off the ability's *effect type*, not its id, so a
   * second slow ability would inherit the behavior rather than needing a
   * second list.
   */
  setSlowDurationMult(mult: number): void {
    this.slowDurationMult = Math.max(1, mult);
  }

  getEffectiveDuration(id: AbilityId): number {
    const def = ABILITY_BY_ID[id];
    if (!def) return 0;
    const level = this.getAbilityLevel(id);
    const base = def.duration + def.durationPerLevel * (level - 1);
    const coreMult = def.effectType === 'slow' ? this.slowDurationMult : 1;
    return base * (1 + this.buffDurationBonus) * coreMult;
  }

  getEffectiveStats(id: AbilityId): EffectiveAbilityStats {
    const def = ABILITY_BY_ID[id];
    const level = this.getAbilityLevel(id);
    const stats = computeEffectiveStats(def, level);
    // Apply multipliers + costs on top of the static compute.
    stats.manaCost = Math.max(1, Math.ceil(stats.manaCost * this.abilityCostMultiplier));
    stats.cooldown = Math.max(1, stats.cooldown * this.cooldownMultiplier);
    stats.upgradeCost = this.getUpgradeCost(id);
    stats.isMaxed = def ? level >= def.maxLevel : true;
    return stats;
  }

  getUpgradeCost(id: AbilityId): number {
    const def = ABILITY_BY_ID[id];
    if (!def) return 0;
    const level = this.getAbilityLevel(id);
    if (level >= def.maxLevel) return 0;
    const baseCost = abilityUpgradeCost(def.upgradeBaseCost, def.upgradeCostGrowth, level);
    if (baseCost <= 0) return 0;
    const state = this.getState(id);
    const needed = abilityXpForLevel(level + 1);
    if (needed <= 0) return baseCost;
    const discount = Math.min(1, state.xp / needed);
    return Math.max(1, Math.floor(baseCost * (1 - discount)));
  }

  canUpgrade(id: AbilityId, wave: number): boolean {
    if (!this.isAbilityUnlocked(id, wave)) return false;
    if (this.isMaxed(id)) return false;
    const cost = this.getUpgradeCost(id);
    if (cost <= 0) return false;
    if (!this.resources.canAfford(cost)) return false;
    return true;
  }

  upgradeAbility(id: AbilityId): boolean {
    if (this.isMaxed(id)) return false;
    const def = ABILITY_BY_ID[id];
    if (!def) return false;
    const cost = this.getUpgradeCost(id);
    if (cost <= 0) return false;
    if (!this.resources.spendGold(cost)) return false;
    const state = this.getState(id);
    state.level = Math.min(def.maxLevel, state.level + 1);
    state.xp = 0;
    this.bus.emit('ability_upgraded', { id, level: state.level });
    return true;
  }

  effectiveManaCost(def: { manaCost: number }): number {
    return Math.max(1, Math.ceil(def.manaCost * this.abilityCostMultiplier));
  }

  canCast(id: AbilityId, wave: number): boolean {
    if (!this.isAbilityUnlocked(id, wave)) return false;
    const state = this.getState(id);
    if (!state || state.level <= 0) return false;
    if (state.cooldown > 0) return false;
    if (this.resources.mana < this.getEffectiveManaCost(id)) return false;
    return true;
  }

  reasonBlocked(id: AbilityId, wave: number): string | null {
    if (!this.isManaUnlocked(wave)) {
      return `Unlocks at wave ${MANA_UNLOCK_WAVE}`;
    }
    const unlockWave = this.getUnlockWave(id);
    if (unlockWave > MANA_UNLOCK_WAVE && wave < unlockWave) {
      return `Unlocks at wave ${unlockWave}`;
    }
    const state = this.getState(id);
    if (!state || state.level <= 0) return 'Locked';
    if (state.cooldown > 0) {
      return `${state.cooldown.toFixed(1)}s`;
    }
    if (this.resources.mana < this.getEffectiveManaCost(id)) {
      return 'Not enough mana';
    }
    return null;
  }

  /**
   * Cast an ability, optionally at a point the player picked (plan §4.3).
   *
   * `placement` is `null`/omitted for every automatic path — the hotkey with
   * `instantCast` on, the ability bar, and `AutomationManager.runAutoCast`. In
   * that case the manager places the ability itself, at the densest cluster
   * within the ability's disc, so the automatic fallback aims at the same
   * shape the player would. A `placement` that came from a click additionally
   * earns the focus bonus, which is the whole reward for aiming.
   */
  tryCast(id: AbilityId, wave: number, placement?: { x: number; y: number } | null): boolean {
    if (!this.canCast(id, wave)) return false;
    const def = ABILITY_BY_ID[id];
    if (!def) return false;
    this.resources.spendMana(this.getEffectiveManaCost(id));
    const state = this.getState(id);
    state.cooldown = this.getEffectiveCooldown(id);
    const duration = this.getEffectiveDuration(id);
    if (duration > 0) {
      state.active = true;
      state.activeTimer = duration;
    } else {
      state.active = false;
      state.activeTimer = 0;
    }
    const placed = placement ?? null;
    const point = placed ?? (isPlaceable(id) ? this.pickBestSpot(id) : null);
    const visualTarget = this.applyEffect(
      def.effectType,
      this.getEffectiveEffectValue(id),
      duration,
      { id, point, focused: placed !== null },
    );
    this.bus.emit('ability_cast', { id, def });
    this.bus.emit('ability_visual', { id, def, target: visualTarget });
    this.addCastXp(def, state);
    this.onCast(id);
    return true;
  }

  castByHotkey(key: string, wave: number): boolean {
    const def = ABILITIES.find(a => a.hotkey === key);
    if (!def) return false;
    return this.tryCast(def.id, wave);
  }

  /**
   * The point an automatic cast of `id` would land on: the centre of the
   * densest cluster inside the ability's disc (plan §4.3).
   *
   * Candidates are enemy positions rather than a grid sweep — the best disc
   * always has an enemy at or near its centre, and this way the scan is
   * O(enemies) grid queries instead of O(arena area).
   *
   * Meteor Strike scores by **HP** rather than head count. That is what keeps
   * it the boss nuke it has always been: a boss's bar dwarfs a crowd's, so the
   * auto-placer picks the boss exactly as `pickHighestHpTarget` used to, and
   * only prefers a pile when the pile is genuinely worth more.
   */
  pickBestSpot(id: AbilityId): { x: number; y: number } | null {
    const radius = placementRadius(id);
    if (radius <= 0) return null;
    const byHp = id === 'meteor_strike';
    let best: Enemy | null = null;
    let bestScore = -1;
    for (const e of this.enemies.list) {
      if (!isTargetable(e)) continue;
      let score = 0;
      for (const other of this.enemies.queryRadius(e.x, e.y, radius, this.placementScratch)) {
        if (!isTargetable(other)) continue;
        score += byHp ? other.hp : 1;
      }
      if (score > bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best ? { x: best.x, y: best.y } : null;
  }

  tick(dt: number): void {
    for (const def of ABILITIES) {
      const state = this.getState(def.id);
      if (state.cooldown > 0) {
        const prev = state.cooldown;
        state.cooldown = Math.max(0, state.cooldown - dt);
        if (state.cooldown === 0 && prev > 0) {
          this.bus.emit('ability_ready', { id: def.id });
        }
      }
      if (state.active) {
        state.activeTimer = Math.max(0, state.activeTimer - dt);
        if (state.activeTimer <= 0) {
          state.active = false;
          this.clearEffect(def.effectType);
        }
      }
    }
  }

  private applyEffect(
    type: AbilityEffectType,
    value: number,
    duration: number,
    cast: { id: AbilityId; point: { x: number; y: number } | null; focused: boolean },
  ): { x: number; y: number } | null {
    switch (type) {
      case 'aoe_damage':
        this.dealAoEDamage(value, cast);
        return cast.point;
      case 'slow': {
        this.enemies.applySlow(Math.max(0.05, value * (1 - this.slowStrengthBonus)), duration);
        // Plan §4.3: the global slow is unchanged, so nothing regresses for a
        // player who never aims. A *placed* nova additionally chills the disc
        // harder and for longer — that difference is the reward for aiming.
        if (cast.focused && cast.point) {
          const factor = Math.max(0.05, value * (1 - this.slowStrengthBonus) - PLACEMENT_FOCUS_CHILL);
          const chillDuration = duration * PLACEMENT_FOCUS_CHILL_DURATION;
          const radius = placementRadius(cast.id);
          for (const e of this.enemies.queryRadius(cast.point.x, cast.point.y, radius, this.placementScratch)) {
            if (!isTargetable(e)) continue;
            this.enemies.applyChill(e, factor, chillDuration);
          }
        }
        return cast.point;
      }
      case 'fire_rate_buff':
        this.buffs.set({
          id: BUFF_FIRE_RATE,
          stat: 'fireRate',
          kind: 'mult',
          value: value * (1 + this.berserkFireBonus),
          label: 'Berserk',
          remaining: null,
        });
        return null;
      case 'gold_buff':
        this.buffs.set({
          id: BUFF_GOLD,
          stat: 'goldMultiplier',
          kind: 'mult',
          value,
          label: 'Gold Rush',
          remaining: null,
        });
        return null;
      case 'single_target_damage':
        return this.dealMeteorStrike(value, cast);
      case 'chain_damage':
        this.dealChainLightning(value);
        return null;
      case 'crit_buff': {
        // value = bonus crit chance in percentage points
        this.buffs.set({
          id: BUFF_CRIT_CHANCE,
          stat: 'critChance',
          kind: 'add',
          value: Math.max(0, Math.min(1, value / 100)),
          label: 'Precision',
          remaining: null,
        });
        this.buffs.set({
          id: BUFF_CRIT_DAMAGE,
          stat: 'critMultiplier',
          kind: 'mult',
          value: CRIT_BUFF_DAMAGE_MULTIPLIER,
          label: 'Precision',
          remaining: null,
        });
        return null;
      }
      case 'lifesteal_buff': {
        this.buffs.set({
          id: BUFF_LIFESTEAL,
          stat: 'lifesteal',
          kind: 'mult',
          value: Math.max(1, value),
          label: 'Vampiric Aura',
          remaining: null,
        });
        this.buffs.set({
          id: BUFF_VAMPIRIC_REGEN,
          stat: 'healthRegen',
          kind: 'add',
          value: VAMPIRIC_REGEN,
          label: 'Vampiric Aura',
          remaining: null,
        });
        return null;
      }
      case 'execute_damage':
        this.applyExecute(value);
        return null;
      case 'multishot':
        this.applyMultishot(value);
        return null;
    }
  }

  private clearEffect(type: AbilityEffectType): void {
    switch (type) {
      case 'fire_rate_buff':
        this.buffs.clear(BUFF_FIRE_RATE);
        break;
      case 'gold_buff':
        this.buffs.clear(BUFF_GOLD);
        break;
      case 'crit_buff':
        this.buffs.clear(BUFF_CRIT_CHANCE);
        this.buffs.clear(BUFF_CRIT_DAMAGE);
        break;
      case 'lifesteal_buff':
        this.buffs.clear(BUFF_LIFESTEAL);
        this.buffs.clear(BUFF_VAMPIRIC_REGEN);
        break;
      case 'slow':
      case 'aoe_damage':
      case 'single_target_damage':
      case 'chain_damage':
      case 'execute_damage':
        break;
    }
  }

  private dealAoEDamage(
    multiplier: number,
    cast?: { id: AbilityId; point: { x: number; y: number } | null; focused: boolean },
  ): void {
    const towerState = this.tower.snapshot;
    const raw = towerState.baseDamage * multiplier * this.damageMultiplier;
    // Plan §4.3: a placed Rain of Arrows still falls on the whole field. What
    // the disc buys is extra weight where the player pointed, so aiming is a
    // bonus rather than a restriction and the idle path loses nothing.
    const focus = cast?.focused && cast.point ? cast.point : null;
    const focusR2 = focus ? placementRadius(cast!.id) ** 2 : 0;
    let hitCount = 0;
    for (const enemy of this.enemies.list) {
      // Plan §2.1: even a field-wide ability cannot reach what is underground.
      if (!isTargetable(enemy)) continue;
      let amount = raw;
      if (focus) {
        const dx = enemy.x - focus.x;
        const dy = enemy.y - focus.y;
        if (dx * dx + dy * dy <= focusR2) amount = raw * (1 + PLACEMENT_FOCUS_DAMAGE_BONUS);
      }
      const final = this.tower.applyResists(enemy, amount);
      this.enemies.damage(enemy, final, false);
      hitCount += 1;
    }
    if (hitCount > 0) {
      this.bus.emit('aoe_hit', { hitCount, totalDamage: raw, perEnemy: raw });
    }
  }

  /** Nearest targetable enemy to a point, within `radius`. */
  private nearestWithin(x: number, y: number, radius: number): Enemy | null {
    let best: Enemy | null = null;
    let bestD2 = radius * radius;
    for (const e of this.enemies.queryRadius(x, y, radius, this.placementScratch)) {
      if (!isTargetable(e)) continue;
      const dx = e.x - x;
      const dy = e.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= bestD2) {
        bestD2 = d2;
        best = e;
      }
    }
    return best;
  }

  private pickHighestHpTarget(): Enemy | null {
    let best: Enemy | null = null;
    let bestHp = -Infinity;
    for (const e of this.enemies.list) {
      if (!isTargetable(e)) continue;
      if (e.maxHp > bestHp) {
        bestHp = e.maxHp;
        best = e;
      }
    }
    return best;
  }

  private dealMeteorStrike(
    multiplier: number,
    cast?: { id: AbilityId; point: { x: number; y: number } | null; focused: boolean },
  ): { x: number; y: number } | null {
    // The epicentre is the placed point when there is one. The heavy hit goes
    // to the nearest enemy *inside the crater* — a click on empty ground is a
    // whiff, the same way an ability cast on an empty field already is.
    const target = cast?.point
      ? this.nearestWithin(cast.point.x, cast.point.y, METEOR_SPLASH_RADIUS)
      : this.pickHighestHpTarget();
    if (!target) return cast?.point ?? null;
    const towerState = this.tower.snapshot;
    const heavyRaw = towerState.baseDamage * multiplier * this.damageMultiplier * (1 + this.meteorDamageBonus);
    const heavyFinal = this.tower.applyResists(target, heavyRaw);
    this.enemies.damage(target, heavyFinal, false);

    const splashRaw = heavyRaw * METEOR_SPLASH_MULTIPLIER;
    const r2 = METEOR_SPLASH_RADIUS * METEOR_SPLASH_RADIUS;
    // The crater sits on the placed point, not on whatever the heavy hit
    // happened to land on, so what the player circled is what burns.
    const cx = cast?.point ? cast.point.x : target.x;
    const cy = cast?.point ? cast.point.y : target.y;
    let splashCount = 0;
    for (const e of this.enemies.list) {
      if (!isTargetable(e) || e.id === target.id) continue;
      const dx = e.x - cx;
      const dy = e.y - cy;
      if (dx * dx + dy * dy > r2) continue;
      const final = this.tower.applyResists(e, splashRaw);
      this.enemies.damage(e, final, false);
      splashCount += 1;
    }
    this.bus.emit('aoe_hit', {
      hitCount: 1 + splashCount,
      totalDamage: heavyFinal + splashRaw * splashCount,
      perEnemy: heavyFinal,
    });
    return { x: cx, y: cy };
  }

  private dealChainLightning(baseMultiplier: number): void {
    const list = this.enemies.list;
    if (list.length === 0) return;
    const towerState = this.tower.snapshot;
    const level = this.getAbilityLevel('chain_lightning');
    const bounces = Math.min(
      CHAIN_BOUNCE_MAX + this.chainBounceBonus,
      CHAIN_BOUNCE_BASE + Math.floor(level / 2) * CHAIN_BOUNCE_PER_LEVEL + this.chainBounceBonus,
    );
    const r2 = CHAIN_BOUNCE_RADIUS * CHAIN_BOUNCE_RADIUS;
    const hit = new Set<number>();

    let current: Enemy | null = null;
    let bestD2 = Infinity;
    const tx = towerState.x;
    const ty = towerState.y;
    for (const e of list) {
      if (!isTargetable(e)) continue;
      const dx = e.x - tx;
      const dy = e.y - ty;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        current = e;
      }
    }
    if (!current) return;

    const path: { x: number; y: number }[] = [{ x: tx, y: ty }, { x: current.x, y: current.y }];
    let totalDamage = 0;
    let perEnemy = 0;
    for (let i = 0; i < bounces && current; i++) {
      hit.add(current.id);
      const dmg = towerState.baseDamage * baseMultiplier * Math.pow(CHAIN_DECAY, i) * this.damageMultiplier;
      const final = this.tower.applyResists(current, dmg);
      this.enemies.damage(current, final, false);
      totalDamage += final;
      perEnemy = final;

      let next: Enemy | null = null;
      let bestND2 = Infinity;
      for (const e of list) {
        if (!isTargetable(e)) continue;
        if (hit.has(e.id)) continue;
        const dx = e.x - current!.x;
        const dy = e.y - current!.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        if (d2 < bestND2) {
          bestND2 = d2;
          next = e;
        }
      }
      if (next) {
        path.push({ x: next.x, y: next.y });
      }
      current = next;
    }
    if (totalDamage > 0) {
      this.bus.emit('chain_lightning', { path, totalDamage, perEnemy });
    }
  }

  private applyExecute(thresholdPct: number): void {
    const towerState = this.tower.snapshot;
    const bossThreshold = thresholdPct / 2;
    let kills = 0;
    let totalDamage = 0;
    for (const e of this.enemies.list) {
      if (!isTargetable(e)) continue;
      const ratio = e.hp / e.maxHp;
      if (e.type === 'boss') {
        if (ratio > bossThreshold) continue;
        const dmg = towerState.baseDamage * EXECUTE_BOSS_MULTIPLIER * this.damageMultiplier;
        const final = this.tower.applyResists(e, dmg);
        this.enemies.damage(e, final, false);
        totalDamage += final;
      } else {
        if (ratio > thresholdPct / 100) continue;
        // Instant-kill: deal damage equal to current HP (minimum 1)
        const final = Math.max(1, e.hp);
        this.enemies.damage(e, final, false);
        totalDamage += final;
        kills += 1;
      }
    }
    if (kills > 0 || totalDamage > 0) {
      this.bus.emit('execute_hit', { kills, totalDamage });
    }
  }

  private applyMultishot(value: number): void {
    const count = Math.floor(value);
    const towerState = this.tower.snapshot;
    const alive = this.enemies.list.filter(e => isTargetable(e));
    let totalDamage = 0;
    const fired: Array<{ id: number }> = [];

    if (alive.length === 0) {
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const rawDamage = towerState.baseDamage * 2 * this.damageMultiplier;
        totalDamage += rawDamage;
        this.projectileMgr.fire(null, towerState, {
          rawDamage,
          damageType: towerState.damageType,
          isCrit: false,
          targetId: null,
          isHoming: false,
          aimX: towerState.x + Math.cos(angle) * 100,
          aimY: towerState.y + Math.sin(angle) * 100,
        });
      }
    } else {
      const shuffled = [...alive].sort(() => Math.random() - 0.5);
      for (let i = 0; i < count; i++) {
        const target = i < shuffled.length ? shuffled[i] : alive[Math.floor(Math.random() * alive.length)];
        const rawDamage = towerState.baseDamage * 2 * this.damageMultiplier;
        totalDamage += rawDamage;
        this.projectileMgr.fire(target, towerState, {
          rawDamage,
          damageType: towerState.damageType,
          isCrit: false,
          targetId: target.id,
          isHoming: true,
          turnRate: Math.PI * 3,
          lifetime: 3,
        });
        fired.push({ id: target.id });
      }
    }

    if (fired.length > 0 || count > 0) {
      this.bus.emit('multishot_fired', { count: Math.max(fired.length, count), totalDamage });
    }
  }

  reset(): void {
    for (const def of ABILITIES) {
      const state = this.getState(def.id);
      state.cooldown = 0;
      state.active = false;
      state.activeTimer = 0;
    }
    this.abilityCostMultiplier = 1;
    this.cooldownMultiplier = 1;
    this.buffs.clear(BUFF_FIRE_RATE);
    this.buffs.clear(BUFF_GOLD);
    this.buffs.clear(BUFF_CRIT_CHANCE);
    this.buffs.clear(BUFF_CRIT_DAMAGE);
    this.buffs.clear(BUFF_LIFESTEAL);
    this.buffs.clear(BUFF_VAMPIRIC_REGEN);
  }

  /** Reset every ability to level 1 (used by Transcendence). */
  resetLevels(): void {
    for (const def of ABILITIES) {
      const state = this.getState(def.id);
      state.level = 1;
      state.cooldown = 0;
      state.active = false;
      state.activeTimer = 0;
      state.xp = 0;
    }
  }

  getXp(id: AbilityId): number {
    const state = this.getState(id);
    return state?.xp ?? 0;
  }

  private addCastXp(def: AbilityDef, state: AbilityState): void {
    if (state.level >= def.maxLevel) return;
    state.xp += def.xpPerCast;
    this.checkLevelUp(def, state);
  }

  private checkLevelUp(def: AbilityDef, state: AbilityState): void {
    while (state.level < def.maxLevel) {
      const needed = abilityXpForLevel(state.level + 1);
      if (state.xp < needed) break;
      state.xp -= needed;
      state.level += 1;
      this.bus.emit('ability_leveled', { id: def.id, level: state.level });
    }
  }
}

export type { AbilityDef };
