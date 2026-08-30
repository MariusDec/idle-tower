import type { AbilityId, AbilityState, Enemy } from '../types';
import { WORLD_SCALE, world } from '../data/arena';
import {
  ABILITIES,
  ABILITY_BY_ID,
  BUFF_FROST_BRITTLE,
  GLOBAL_NOVA_SLOW,
  METEOR_SPLASH_FRACTION,
  PLACEMENT_FOCUS_CHILL,
  PLACEMENT_FOCUS_CHILL_DURATION,
  PLACEMENT_FOCUS_DAMAGE_BONUS,
  computeEffectiveStats,
  executeBossFrac,
  frostBrittle,
  isTargeted,
  placementRadius,
  precisionCritMultiplier,
  vampiricRegen,
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
  /**
   * Plan §D.9 / §D.10: Gold Rush raises the loot magnet while the buff
   * is live. Optional because the early-init path and the test harness
   * build an `AbilityManager` without a `LootManager` to talk to.
   */
  setGoldRushMagnet?: (on: boolean) => void;
}

/**
 * How a cast picked the point its effect lands on.
 *
 * - `{ x, y }` — the player placed the click. Earns the focus bonus on disc
 *   abilities because a hand-placed disc is better placed than an auto-aimed one.
 * - `'auto'` — the manager placed it itself, at the densest cluster the disc can
 *   cover; on an empty field, fell back to the tower.
 * - `'tower'` — a non-targeted ability that fires from the tower.
 */
export type CastPlacement = { x: number; y: number } | 'auto' | 'tower';

/**
 * Everything the effect paths need to know about a cast: which ability, the
 * resolved centre, and whether the centre came from a hand-placed click.
 */
interface CastContext {
  id: AbilityId;
  point: { x: number; y: number } | null;
  focused: boolean;
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

const MANA_UNLOCK_WAVE = 10;
/** Rocket Barrage: blast radius and splash share of each rocket's landed hit. */
const ROCKET_SPLASH_RADIUS = world(60);
const ROCKET_SPLASH_FRACTION = 0.5;
const CHAIN_BOUNCE_BASE = 6;
const CHAIN_BOUNCE_PER_LEVEL = 1;
const CHAIN_BOUNCE_MAX = 12;
const CHAIN_BOUNCE_RADIUS = world(200);
const CHAIN_DECAY = 0.82;

export class AbilityManager {
  private readonly resources: ResourceManager;
  private readonly enemies: EnemyManager;
  private readonly tower: Tower;
  private readonly bus: EventBus;
  private readonly projectileMgr: ProjectileManager;
  private readonly buffs: BuffRegistry;
  private readonly getState: (id: AbilityId) => AbilityState;
  private readonly onCast: (id: AbilityId) => void;
  /**
   * Plan §D.9 / §D.10: Gold Rush raises the loot magnet while the buff
   * is live. `undefined` in the test harness and during early init, so
   * every call is optional-chained.
   */
  private readonly setGoldRushMagnet?: (on: boolean) => void;
  private abilityCostMultiplier = 1;
  private cooldownMultiplier = 1;
  private damageMultiplier = 1;
  private areaMultiplier = 1;
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
  /** Spell Echo talent: chance to re-execute an ability's effect for free. */
  private echoChance = 0;
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
    this.setGoldRushMagnet = deps.setGoldRushMagnet;
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

  /**
   * Set the radius multiplier every placed disc gets (plan §C.1).
   *
   * Clamped to `[0.5, 3]` so a stacked build cannot halve a disc to nothing or
   * blow it past the arena. Set from `Game.applyResolvedStats` alongside the
   * other ability multipliers, so a research unlock or talent point shows up
   * on the next disc and disappears the moment the player respecs.
   */
  setAreaMultiplier(value: number): void {
    this.areaMultiplier = Math.max(0.5, Math.min(3, value));
  }

  /**
   * The disc radius the live game should use: the per-def radius at the
   * ability's current level, scaled by the area stat.
   *
   * Phase 1 stub: not yet wired into `pickBestSpot` or any of the effect paths.
   * Phase 2 routes the existing single-arg `placementRadius(id)` calls through
   * this helper so the disc the player sees and the disc the auto-placer
   * scores with are the same shape the *effects* land in.
   */
  getEffectiveRadius(id: AbilityId): number {
    return placementRadius(id, this.getAbilityLevel(id)) * this.areaMultiplier;
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

  /** Effective volley size for an ability with `effectCount` (Rocket Barrage). */
  private getEffectiveCount(id: AbilityId): number {
    const def = ABILITY_BY_ID[id];
    if (!def || def.effectCount === undefined) return 0;
    const level = Math.max(1, this.getAbilityLevel(id));
    return def.effectCount + (def.effectCountPerLevel ?? 0) * (level - 1);
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

  /** Spell Echo talent: chance to re-execute an ability's effect for free. */
  setEchoChance(chance: number): void {
    this.echoChance = Math.max(0, Math.min(1, chance));
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
    // Plan §G.4: the tooltip quotes the live, area-multiplied disc so the row
    // matches what the player sees under the cursor and what the effect lands
    // in. Non-targeted abilities keep the 0 / '' pair set by `computeEffectiveStats`.
    if (isTargeted(id)) {
      stats.area = this.getEffectiveRadius(id);
      stats.displayArea = `${Math.round(stats.area / WORLD_SCALE)} px`;
    }
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

  /**
   * Whether automation should spend mana on `id` right now (plan §F.2).
   *
   * The mana budget cannot pay for the whole roster, so automation has to
   * choose, and "is it off cooldown" is not a choice. A condition is a
   * floor, never a preference: an ability with no `autoCast` block is
   * always allowed, so adding a condition to the table is a tightening,
   * not a new piece of state to keep in sync.
   *
   * Consulted **only** by `AutomationManager.runAutoCast`. `canCast` and
   * `tryCast` deliberately do not call it — a player who presses the
   * hotkey gets the cast, full stop (plan §F.3).
   *
   * `pickBestSpot` runs for the two `minInDisc` abilities (Rain of Arrows,
   * Frost Nova, Meteor Strike); `runAutoCast` runs once per second, so the
   * extra scan is at most three times per second. That is acceptable; do
   * not add caching.
   */
  autoCastConditionMet(id: AbilityId): boolean {
    const c = ABILITY_BY_ID[id]?.autoCast;
    if (!c) return true;

    if (c.minEnemies !== undefined) {
      let n = 0;
      for (const e of this.enemies.list) if (isTargetable(e)) n++;
      if (n < c.minEnemies) return false;
    }
    if (c.minInDisc !== undefined) {
      const spot = this.pickBestSpot(id);
      if (!spot) return false;
      let n = 0;
      for (const e of this.enemies.queryRadius(
        spot.x,
        spot.y,
        this.getEffectiveRadius(id),
        this.placementScratch,
      )) {
        if (isTargetable(e)) n++;
      }
      if (n < c.minInDisc) return false;
    }
    if (c.bossOnly || c.bossHpBelow !== undefined) {
      const boss = this.enemies.list.find(e => e.type === 'boss' && isTargetable(e));
      if (!boss) return false;
      if (c.bossHpBelow !== undefined && boss.hp / boss.maxHp > c.bossHpBelow) return false;
    }
    if (c.towerHpBelow !== undefined) {
      const ts = this.tower.snapshot;
      if (ts.maxHp <= 0 || ts.hp / ts.maxHp > c.towerHpBelow) return false;
    }
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
   * Cast an ability (plan §4.3 / §A.1 / §D.3).
   *
   * `placement` is `'auto'` for every automatic path — `AutomationManager`
   * with the player's `autoCastAutoAim` preference on, the non-targeted
   * branch of `Game.castAbility`, and the ability bar. In that case the
   * manager places the ability itself, at the densest cluster within the
   * ability's disc; an empty field falls back to the tower so a self-buff
   * still resolves. `'tower'` pins the effect to the tower's position. A
   * `{x, y}` placement is a hand-placed click and earns the focus bonus,
   * which is the whole reward for aiming.
   */
  tryCast(id: AbilityId, wave: number, placement: CastPlacement = 'auto'): boolean {
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
    const ts = this.tower.snapshot;
    let point: { x: number; y: number } | null = null;
    let focused = false;
    if (placement === 'tower') {
      point = { x: ts.x, y: ts.y };
    } else if (placement === 'auto') {
      const spot = isTargeted(id) ? this.pickBestSpot(id) : null;
      point = spot ?? { x: ts.x, y: ts.y };
    } else {
      point = { x: placement.x, y: placement.y };
      focused = true;
    }
    const visualTarget = this.applyEffect(
      def.effectType,
      this.getEffectiveEffectValue(id),
      duration,
      { id, point, focused },
    );
    this.bus.emit('ability_cast', { id, def });
    // Plan §E.2: payload carries the ability's effective disc radius so the
    // placement-aware emitters in EffectsManager size their visuals to match.
    // Non-targeted abilities pass 0 — they paint at the tower's position and
    // never consult `radius`.
    this.bus.emit('ability_visual', {
      id,
      def,
      target: visualTarget,
      radius: isTargeted(id) ? this.getEffectiveRadius(id) : 0,
    });
    this.addCastXp(def, state);
    this.onCast(id);
    // Spell Echo: chance to re-execute the effect for free (no mana, no cooldown).
    // Never recurses — an echoed cast cannot echo again.
    if (this.echoChance > 0 && Math.random() < this.echoChance) {
      this.applyEffect(
        def.effectType,
        this.getEffectiveEffectValue(id),
        duration,
        { id, point, focused },
      );
    }
    return true;
  }

  castByHotkey(key: string, wave: number): boolean {
    const def = ABILITIES.find(a => a.hotkey === key);
    if (!def) return false;
    return this.tryCast(def.id, wave);
  }

  /**
   * The point an automatic cast of `id` would land on: the centre of the
   * densest cluster inside the ability's disc (plan §4.3 / §F.2).
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
    const radius = this.getEffectiveRadius(id);
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
        state.cooldown = Math.max(0, state.cooldown - dt);
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
    cast: CastContext,
  ): { x: number; y: number } | null {
    switch (type) {
      case 'aoe_damage':
        this.dealAoEDamage(value, cast);
        return cast.point;
      case 'slow': {
        // Layer 1 (plan §D.6): a global slow keeps the panic-button floor for
        // an idle player. Level-independent on purpose — the level curve
        // moves the *disc* number, not the global number, so an idle player's
        // safety net never regresses.
        this.enemies.applySlow(GLOBAL_NOVA_SLOW, duration);
        // Layer 2: every targetable enemy inside the placed disc gets a
        // harder chill than the global slow. The focused cast deepens the
        // factor and lengthens the duration — that is the reward for aiming.
        if (cast.point) {
          const baseFactor = value * (1 - this.slowStrengthBonus);
          const factor = Math.max(
            0.05,
            baseFactor - (cast.focused ? PLACEMENT_FOCUS_CHILL : 0),
          );
          const chillDuration = duration * (cast.focused ? PLACEMENT_FOCUS_CHILL_DURATION : 1);
          const radius = this.getEffectiveRadius(cast.id);
          for (const e of this.enemies.queryRadius(cast.point.x, cast.point.y, radius, this.placementScratch)) {
            if (!isTargetable(e)) continue;
            this.enemies.applyChill(e, factor, chillDuration);
          }
        }
        // Layer 3: brittle damage bonus while the slow is live. Because the
        // global slow (layer 1) marks every enemy as slowed, this also makes
        // the `chilledDamageBonus` channel apply to every enemy on the field
        // for the nova's duration — not just the ones in the disc.
        this.buffs.set({
          id: BUFF_FROST_BRITTLE,
          stat: 'chilledDamageBonus',
          kind: 'add',
          value: frostBrittle(this.getAbilityLevel(cast.id)),
          label: 'Frost Nova',
          remaining: null,
        });
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
        // The buff doubles gold; the magnet (plan §D.10) makes the orbs
        // arrive faster and pay 100% while they are coming. Held only for
        // the buff's duration, so the matching `clearEffect` is what
        // turns it off.
        this.setGoldRushMagnet?.(true);
        return null;
      case 'single_target_damage':
        return this.dealMeteorStrike(value, cast);
      case 'chain_damage':
        this.dealChainLightning(value, cast);
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
        // Level-scaled so the upgrade's "+10% crit damage per level" is real
        // rather than only living in the tooltip.
        this.buffs.set({
          id: BUFF_CRIT_DAMAGE,
          stat: 'critMultiplier',
          kind: 'mult',
          value: precisionCritMultiplier(this.getAbilityLevel(cast.id)),
          label: 'Precision',
          remaining: null,
        });
        return null;
      }
      case 'lifesteal_buff': {
        // Additive, not multiplicative (phase 4): most builds carry zero base
        // lifesteal, so a x3 multiplier had nothing to multiply. The aura must
        // sustain on its own, and the additive bucket composes with any
        // upgrades/blessings the player does own.
        this.buffs.set({
          id: BUFF_LIFESTEAL,
          stat: 'lifesteal',
          kind: 'add',
          value: Math.max(0, value),
          label: 'Vampiric Aura',
          remaining: null,
        });
        this.buffs.set({
          id: BUFF_VAMPIRIC_REGEN,
          stat: 'healthRegen',
          kind: 'add',
          value: vampiricRegen(this.getAbilityLevel(cast.id)),
          label: 'Vampiric Aura',
          remaining: null,
        });
        return null;
      }
      case 'execute_damage':
        this.applyExecute(cast);
        return null;
      case 'rocket_barrage':
        this.applyRocketBarrage(value, cast);
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
        this.setGoldRushMagnet?.(false);
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
        // The brittle damage channel rides the nova. When the slow expires,
        // so does the brittle — otherwise the buff would keep applying damage
        // to every enemy that is no longer chilled.
        this.buffs.clear(BUFF_FROST_BRITTLE);
        break;
      case 'aoe_damage':
      case 'single_target_damage':
      case 'chain_damage':
      case 'execute_damage':
        break;
    }
  }

  private dealAoEDamage(
    multiplier: number,
    cast: CastContext,
  ): void {
    // Plan §D.3: the disc *is* the effect for Rain of Arrows. The idle path
    // still works because the centre the auto-placer picks is on the densest
    // cluster, and a focused click lands the disc somewhere even better. The
    // focus bonus applies to the *whole* disc, because the whole disc is what
    // the player paid mana for.
    const towerState = this.tower.snapshot;
    const raw = towerState.baseDamage * multiplier * this.damageMultiplier;
    const cx = cast.point?.x ?? towerState.x;
    const cy = cast.point?.y ?? towerState.y;
    const r = this.getEffectiveRadius(cast.id);
    const focusBonus = cast.focused ? 1 + PLACEMENT_FOCUS_DAMAGE_BONUS : 1;
    for (const e of this.enemies.queryRadius(cx, cy, r, this.placementScratch)) {
      if (!isTargetable(e)) continue;
      const final = this.tower.applyResists(e, raw * focusBonus);
      this.enemies.damage(e, final, false);
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

  private dealMeteorStrike(
    multiplier: number,
    cast: CastContext,
  ): { x: number; y: number } | null {
    // Plan §D.4: the crater is the ability's disc, and the heavy hit goes to
    // the **highest-HP** targetable enemy inside it — the "smashes the
    // highest-HP enemy" the description has always promised. A click on empty
    // ground is still a whiff, but the crater still draws.
    const ts = this.tower.snapshot;
    const r = this.getEffectiveRadius(cast.id);
    const cx = cast.point?.x ?? ts.x;
    const cy = cast.point?.y ?? ts.y;

    // Copy the query into a fresh array before any `damage` call. `damage`
    // emits events whose handlers re-enter `queryRadius`, which would
    // otherwise clear and refill `placementScratch` under the loop that is
    // still walking it.
    const inCrater: Enemy[] = [];
    let target: Enemy | null = null;
    let bestHp = -Infinity;
    for (const e of this.enemies.queryRadius(cx, cy, r, this.placementScratch)) {
      if (!isTargetable(e)) continue;
      inCrater.push(e);
      if (e.hp > bestHp) {
        bestHp = e.hp;
        target = e;
      }
    }
    if (!target) return { x: cx, y: cy };

    const heavyRaw = ts.baseDamage * multiplier * this.damageMultiplier
      * (1 + this.meteorDamageBonus)
      * (cast.focused ? 1 + PLACEMENT_FOCUS_DAMAGE_BONUS : 1);
    this.enemies.damage(target, this.tower.applyResists(target, heavyRaw), false);

    const splashRaw = heavyRaw * METEOR_SPLASH_FRACTION;
    for (const e of inCrater) {
      if (e.id === target.id) continue;
      this.enemies.damage(e, this.tower.applyResists(e, splashRaw), false);
    }
    return { x: cx, y: cy };
  }

  private dealChainLightning(baseMultiplier: number, cast: CastContext): void {
    const list = this.enemies.list;
    if (list.length === 0) return;
    const towerState = this.tower.snapshot;
    const level = this.getAbilityLevel('chain_lightning');
    // A focused cast reaches further: +2 bounces is the visible reward for
    // aiming on an ability that is otherwise a flat "seed at the densest
    // spot" auto-fire.
    const bounces = Math.min(
      CHAIN_BOUNCE_MAX + this.chainBounceBonus,
      CHAIN_BOUNCE_BASE + Math.floor(level / 2) * CHAIN_BOUNCE_PER_LEVEL
        + this.chainBounceBonus + (cast.focused ? 2 : 0),
    );
    const r2 = CHAIN_BOUNCE_RADIUS * CHAIN_BOUNCE_RADIUS;
    const hit = new Set<number>();

    // Seed at the placed point, not the tower — Chain Lightning is now
    // targeted, so the chain starts where the player pointed. Without a
    // placed point, fall back to the tower.
    const seedX = cast.point?.x ?? towerState.x;
    const seedY = cast.point?.y ?? towerState.y;
    let current = this.nearestWithin(seedX, seedY, this.getEffectiveRadius(cast.id));
    if (!current) return;

    const path: { x: number; y: number }[] = [
      { x: towerState.x, y: towerState.y },
      { x: current.x, y: current.y },
    ];
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

  private applyExecute(cast: CastContext): void {
    // Plan §D.5: bosses take a fraction of their **max** HP, not a multiple
    // of baseDamage. A multiple is a rounding error against a wave-50 boss
    // bar; a fraction of max HP is what makes the threshold mean something.
    // The boss path deliberately bypasses `applyResists` — an execute a
    // resist can shrug is not an execute — and is capped at the bar that is
    // left so it cannot roll over into overkill accounting.
    const level = this.getAbilityLevel(cast.id);
    const bossFrac = executeBossFrac(level);
    const effectValue = this.getEffectiveEffectValue(cast.id);
    const bossGate = effectValue / 200;   // percent → fraction, halved
    const gate = effectValue / 100;
    for (const e of [...this.enemies.list]) {
      if (!isTargetable(e)) continue;
      const ratio = e.hp / e.maxHp;
      if (e.type === 'boss') {
        if (ratio > bossGate) continue;
        // Deliberately bypasses `applyResists`: Execute is a designed-in
        // bypass, and boss damage scales with Execute level rather than
        // magic resist.
        const amount = Math.min(e.hp, e.maxHp * bossFrac * this.damageMultiplier);
        // Priced off the target's max HP, so not reflectable — see
        // `EnemyManager.damage`.
        this.enemies.damage(e, amount, false, false);
      } else {
        if (ratio > gate) continue;
        // Instant-kill: deal damage equal to current HP (minimum 1)
        this.enemies.damage(e, Math.max(1, e.hp), false, false);
      }
    }
  }

  /**
   * Rocket Barrage: N homing rockets at distinct targetable enemies, extras
   * re-targeting a random alive enemy once the field runs out of firsts. Each
   * rocket lands through the ordinary impact path (so resists apply) and pops
   * a splash around its hit.
   *
   * Plan §D.8: now targeted. Rockets pick their targets **inside the disc**
   * rather than anywhere on the field. A focused click adds the damage focus
   * bonus on top.
   *
   * On an empty field the cast is still spent: the rockets leave as duds in a
   * radial spread with no target and no splash, and age out like any other
   * stray shot.
   */
  private applyRocketBarrage(value: number, cast: CastContext): void {
    const count = Math.floor(this.getEffectiveCount('rocket_barrage'));
    const towerState = this.tower.snapshot;
    const rawDamage = towerState.baseDamage * value * this.damageMultiplier
      * (cast.focused ? 1 + PLACEMENT_FOCUS_DAMAGE_BONUS : 1);
    let totalDamage = 0;
    const fired: Array<{ id: number }> = [];

    // Find the targets inside the disc. Copy the filtered result into a fresh
    // array before firing — the projectile manager shuffles its own state
    // inside `fire`, and `placementScratch` is shared with other radius
    // queries.
    const cx = cast.point?.x ?? towerState.x;
    const cy = cast.point?.y ?? towerState.y;
    const inDisc: Enemy[] = [];
    for (const e of this.enemies.queryRadius(cx, cy, this.getEffectiveRadius(cast.id), this.placementScratch)) {
      if (!isTargetable(e)) continue;
      inDisc.push(e);
    }

    if (inDisc.length === 0) {
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        totalDamage += rawDamage;
        this.projectileMgr.fire(null, towerState, {
          rawDamage,
          damageType: towerState.damageType,
          isCrit: false,
          targetId: null,
          isHoming: false,
          aimX: towerState.x + Math.cos(angle) * 100,
          aimY: towerState.y + Math.sin(angle) * 100,
          visual: 'rocket',
        });
      }
    } else {
      // Distinct-first distribution: every rocket gets its own enemy while
      // there are enough, then doubles up at random.
      const shuffled = [...inDisc].sort(() => Math.random() - 0.5);
      for (let i = 0; i < count; i++) {
        const target = i < shuffled.length ? shuffled[i] : inDisc[Math.floor(Math.random() * inDisc.length)];
        totalDamage += rawDamage;
        this.projectileMgr.fire(target, towerState, {
          rawDamage,
          damageType: towerState.damageType,
          isCrit: false,
          targetId: target.id,
          isHoming: true,
          turnRate: Math.PI * 3,
          lifetime: 3,
          splashRadius: ROCKET_SPLASH_RADIUS,
          splashFraction: ROCKET_SPLASH_FRACTION,
          visual: 'rocket',
        });
        fired.push({ id: target.id });
      }
    }

    if (fired.length > 0 || count > 0) {
      this.bus.emit('rockets_fired', { count: Math.max(fired.length, count), totalDamage });
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
    this.buffs.clear(BUFF_FROST_BRITTLE);
    // Drop the Gold Rush magnet source if it was held — `LootManager.reset`
    // is the same call from the other side, so the ref count returns to 0.
    this.setGoldRushMagnet?.(false);
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
    }
  }
}

export type { AbilityDef };
