import type { DamageType, Enemy, Projectile, ProjectileVisual, TowerState } from '../types';
import { nextId } from '../utils/math';
import { PROJECTILE_HIT_PAD, world } from '../data/arena';
import { BOUNCE, HOMING, PROJECTILE_SPEED, SHARD } from '../data/tower';
import { ENEMY_DEFS, isTargetable } from '../data/enemies';
import { BLESSING_TUNING, type BlessingBehavior } from '../data/blessings';
import { CORE_TUNING, type CoreBehavior } from '../data/cores';
import { OVERKILL_CARRY_BASE } from '../data/pacing';
import { TALENT_TUNING } from '../data/talentTree';
import type { Tower } from './Tower';
import type { EnemyManager } from './EnemyManager';
import { EventBus } from '../game/EventBus';

/**
 * The only thing the projectile loop needs to know about the blessing draft.
 *
 * A narrow interface rather than the manager itself, so the combat path can be
 * driven from a test with a two-line stub and cannot reach anything else.
 */
export interface BlessingQuery {
  has(behavior: BlessingBehavior): boolean;
}

const NO_BLESSINGS: BlessingQuery = { has: () => false };

/**
 * The same narrow shape for the run's core (plan §6.2).
 *
 * `CoreManager` satisfies it, and so does a two-line stub — which is what the
 * behavior tests use, so the impact path can be driven without a `Game`.
 */
export interface CoreQuery {
  has(behavior: CoreBehavior): boolean;
}

const NO_CORE: CoreQuery = { has: () => false };

/** Shared empty exclusion set for `nearestOthers`. Never mutated. */
const NO_EXCLUSIONS: ReadonlySet<number> = new Set<number>();

/** HP fraction below which the Executioner talent's bonus damage applies. */
const TALENT_EXECUTE_THRESHOLD = 0.5;

/**
 * Hard lifetime for any projectile, in simulation seconds (plan §5.5).
 *
 * Bounds culling only retires shots that actually leave the play field; a
 * homing projectile circling a target it can never catch, or one fired into a
 * corner, otherwise stays in the list (and in every projectile-vs-enemy loop)
 * indefinitely. At 720 px/s this is several times longer than crossing the
 * arena takes, so it never truncates a shot that was going to land. Cut from
 * 4 s: with Seeker Shots plus high pierce a shot had time to loop the field and
 * mow down enemies from behind, which is the pierce budget spent on geometry
 * rather than on the line the player aimed.
 */
const MAX_PROJECTILE_AGE = 3;

/** Overwatch (revamp §6.1): the fraction of range beyond which it pays. */
export const OVERWATCH_RANGE_FRACTION = 0.7;

export interface ShotVariant {
  angleOffset?: number;
  posOffsetX?: number;
  posOffsetY?: number;
  /** Fraction of the volley's damage this variant carries. Defaults to 1. */
  damageScale?: number;
}

export interface FireOptions {
  rawDamage: number;
  damageType: DamageType;
  isCrit: boolean;
  targetId: number | null;
  piercing?: boolean;
  /**
   * Extra targets this shot pierces, on top of the tower's own pierce.
   * The charged shot (gameplay plan §4.2) is the only user.
   */
  extraPierce?: number;
  variants?: ShotVariant[];
  aimX?: number;
  aimY?: number;
  isHoming?: boolean;
  turnRate?: number;
  /**
   * Straight-flight seconds every lane of this volley gets before it starts
   * seeking, on top of whatever its own spread angle earns it. Set by the
   * manual-aim and charged-shot paths so a clicked shot visibly goes where the
   * player pointed before it hunts. Ignored unless `isHoming`.
   */
  homingDelay?: number;
  lifetime?: number;
  /** Mortar blessing: blast radius on impact. */
  splashRadius?: number;
  /** Fraction of the landed hit that everything else in the blast takes. */
  splashFraction?: number;
  /** Sprite set to draw with; defaults to the core's ordinary bolt. */
  visual?: ProjectileVisual;
}

export class ProjectileManager {
  private projectiles: Projectile[] = [];
  private readonly bus: EventBus;
  private readonly tower: Tower;
  private readonly enemies: EnemyManager;
  private damageMultipliers: { additive: number; multiplicative: number } = {
    additive: 0,
    multiplicative: 1,
  };
  private pierceExtra = 0;
  private piercingRemaining: Record<number, number> = {};
  private hitEnemies: Record<number, Set<number>> = {};
  /**
   * The enemy each homing shot is currently steering at, by projectile id.
   *
   * A *reference*, not an id, and that is the point: steering needs the
   * target's live position every step, and resolving an id against
   * `enemies.list` every step would be an O(enemies) scan per seeker per tick.
   * With the reference cached, the per-step cost is two field reads and the
   * O(enemies-in-radius) re-scan only runs on `HOMING.retargetInterval` or when
   * the target stops being valid. Cleaned up in exactly the three places
   * `hitEnemies` is.
   */
  private homingTargets: Record<number, Enemy> = {};
  /**
   * Scratch buffer for `seekNearest`'s radius query. Safe to share — unlike
   * every other `queryRadius` caller in this file, the seek does not damage
   * anything, so no handler can re-enter and refill the buffer mid-loop.
   */
  private readonly seekScratch: Enemy[] = [];
  /**
   * Scratch buffer for the bounce target search. Separate from `seekScratch`
   * because the two run in different phases of `tick` and sharing one buffer
   * would make the safety argument depend on call ordering. Safe to reuse
   * across bounces: the search happens *after* every damage handler for this
   * impact has already run, and it damages nothing itself.
   */
  private readonly bounceScratch: Enemy[] = [];
  /**
   * True only while a Splinter shard's own impact is being resolved.
   *
   * `Game`'s `enemy_killed` handler reads it and skips the splinter, which is
   * what bounds the cascade now that shards are real projectiles and their
   * kills land on a later frame than the kill that spawned them.
   */
  private resolvingShard = false;
  private executeThreshold = 0;
  private executeMultiplier = 0;
  /** Executioner talent: bonus damage against enemies below half HP. */
  private talentExecuteBonus = 0;
  private armorPen = 0;
  /** Flat armour ignored, applied after the percentage. Blessing-fed. */
  private armorPenFlat = 0;
  /** The run's blessings, for the behaviors that fire on impact. */
  private blessings: BlessingQuery = NO_BLESSINGS;
  /** The run's core, for the behaviors that fire on impact. */
  private core: CoreQuery = NO_CORE;
  private instantKillChance = 0;
  private critSplashFraction = 0;
  /** Overwatch: extra damage to enemies past `rangeDamageThreshold` of range. */
  private rangeDamageBonus = 0;
  /** Skewer: extra damage to every target after the first on the same shot. */
  private pierceAmp = 0;
  private critIgnoreArmor = false;
  /** Play-field size; projectiles are culled once they leave it by a margin. */
  private boundsWidth = world(1280);
  private boundsHeight = world(720);
  // ── Levelling redesign step 7: talent-driven impact modifiers ──
  /** Focus Fire: bonus damage per consecutive hit on the same target. */
  private focusStackBonus = 0;
  private focusTargetId = -1;
  private focusStacks = 0;
  /** Siegebreaker: bonus damage against boss enemies. */
  private bossDamageBonus = 0;
  /** Frostbite: bonus damage against chilled/slowed enemies. */
  private chilledDamageBonus = 0;

  constructor(bus: EventBus, tower: Tower, enemies: EnemyManager) {
    this.bus = bus;
    this.tower = tower;
    this.enemies = enemies;
  }

  get list(): Projectile[] {
    return this.projectiles;
  }

  /** See `resolvingShard`. Read by `Game`'s Splinter trigger. */
  get shardImpactInProgress(): boolean {
    return this.resolvingShard;
  }

  setDamageMultipliers(additive: number, multiplicative: number): void {
    this.damageMultipliers = { additive, multiplicative };
  }

  setPierceExtra(value: number): void {
    this.pierceExtra = Math.max(0, Math.floor(value));
  }

  setExecuteBonus(threshold: number, multiplier: number): void {
    this.executeThreshold = threshold;
    this.executeMultiplier = multiplier;
  }

  /** Executioner talent: +damage to enemies below `TALENT_EXECUTE_THRESHOLD`. */
  setTalentExecuteBonus(bonus: number): void {
    this.talentExecuteBonus = Math.max(0, bonus);
  }

  setBounds(width: number, height: number): void {
    this.boundsWidth = width;
    this.boundsHeight = height;
  }

  setArmorPen(value: number): void {
    this.armorPen = Math.max(0, Math.min(1, value));
  }

  /** Flat armour ignored on top of the percentage (Sunder blessing). */
  setArmorPenFlat(value: number): void {
    this.armorPenFlat = Math.max(0, value);
  }

  /** Wire the run's blessing draft into the impact path. */
  setBlessings(query: BlessingQuery): void {
    this.blessings = query;
  }

  /** Wire the run's tower core into the impact path. */
  setCore(query: CoreQuery): void {
    this.core = query;
  }

  /**
   * Overwatch and Skewer (revamp §6.1). Both need the impact's geometry — how
   * far the target is, and how many bodies this shot has already been through
   * — so they are per-hit modifiers here rather than stat keys.
   */
  setEvolutionShotBonuses(rangeDamage: number, pierceAmp: number): void {
    this.rangeDamageBonus = Math.max(0, rangeDamage);
    this.pierceAmp = Math.max(0, pierceAmp);
  }

  setEvolutionCombatEffects(instantKill: number, critSplash: number, critIgnoreArmor: boolean): void {
    this.instantKillChance = instantKill;
    this.critSplashFraction = critSplash;
    this.critIgnoreArmor = critIgnoreArmor;
  }

  /** Focus Fire talent: bonus damage per consecutive hit on same target. */
  setFocusStackBonus(bonus: number): void {
    this.focusStackBonus = Math.max(0, bonus);
  }

  /** Siegebreaker talent: bonus damage against boss enemies. */
  setBossDamageBonus(bonus: number): void {
    this.bossDamageBonus = Math.max(0, bonus);
  }

  /** Frostbite talent: bonus damage against chilled/slowed enemies. */
  setChilledDamageBonus(bonus: number): void {
    this.chilledDamageBonus = Math.max(0, bonus);
  }

  private pierceMax(id: number): number {
    const rem = this.piercingRemaining[id];
    return rem !== undefined ? rem : 1 + this.pierceExtra;
  }

  /**
   * One steering step for a homing shot.
   *
   * Three things happen, in this order, and each is one of the three
   * complaints in `plans/homing.md`:
   *
   * 1. **Straight-flight delay.** For `homingDelay` seconds the shot keeps its
   *    launch heading at its launch speed. This is what keeps Scatter Shot and
   *    Rear Guard from collapsing into Twin Arrows the moment Seeker Shots is
   *    drafted, and what makes a clicked shot go where it was pointed.
   * 2. **Its own target**, picked from its own position — never the volley's
   *    lock, never a body it has already pierced.
   * 3. **A ramped turn**, easing from 0 to `turnRate` over `HOMING.ramp`, with
   *    the launch boost bleeding back to cruise on the same clock.
   */
  private steerHoming(p: Projectile, age: number, dt: number): void {
    const delay = p.homingDelay ?? 0;
    if (age < delay) return;

    // The boost only bleeds off *after* the delay — burst out straight, then
    // settle into the hunt.
    const cruise = p.cruiseSpeed ?? PROJECTILE_SPEED;
    let speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
    if (speed > cruise) {
      speed = cruise + (speed - cruise) * Math.exp(-dt / HOMING.speedSettle);
    }

    let angle = Math.atan2(p.vy, p.vx);
    const target = this.homingTarget(p, dt);
    if (target) {
      const desired = Math.atan2(target.y - p.y, target.x - p.x);
      let diff = desired - angle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const ease = HOMING.ramp > 0 ? Math.min(1, (age - delay) / HOMING.ramp) : 1;
      const rate = p.turnRate ?? HOMING.turnRate;
      const maxTurn = rate * ease * dt;
      angle += Math.max(-maxTurn, Math.min(maxTurn, diff));
    }
    p.vx = Math.cos(angle) * speed;
    p.vy = Math.sin(angle) * speed;
  }

  /**
   * The enemy this shot should be steering at, re-acquiring when it must.
   *
   * A target is dropped when it dies, becomes un-targetable, **or has already
   * been pierced by this same shot** — `hitEnemies` bars a second hit, so
   * chasing it would just orbit a body until `MAX_PROJECTILE_AGE`. That last
   * clause is the "gets a new target after it passes through an enemy" half of
   * the ask. Where the ask says "or the same if no other", this keeps flying
   * *straight* instead: re-locking a body it can no longer hit produces a
   * corkscrew that hits nothing, whereas straight flight can still stumble into
   * something new before the lifetime cap.
   */
  private homingTarget(p: Projectile, dt: number): Enemy | null {
    const hitSet = this.hitEnemies[p.id];
    let current: Enemy | null = this.homingTargets[p.id] ?? null;

    // First steering step of a shot that launched with a volley target: resolve
    // the id once, then hold the reference. Clearing the id on a failed resolve
    // is what stops this scan repeating every tick for a target that is gone.
    if (!current && p.homingTargetId !== undefined) {
      current = this.enemies.list.find(e => e.id === p.homingTargetId) ?? null;
      if (current) this.homingTargets[p.id] = current;
      else p.homingTargetId = undefined;
    }
    if (current && (!isTargetable(current) || (hitSet !== undefined && hitSet.has(current.id)))) {
      current = null;
      delete this.homingTargets[p.id];
      p.homingTargetId = undefined;
    }

    const remaining = (p.retargetIn ?? 0) - dt;
    if (current && remaining > 0) {
      p.retargetIn = remaining;
      return current;
    }
    p.retargetIn = HOMING.retargetInterval;

    const found = this.seekNearest(p, hitSet);
    if (!current) {
      if (found) {
        this.homingTargets[p.id] = found;
        p.homingTargetId = found.id;
      }
      return found;
    }
    if (found && found.id !== current.id) {
      const cdx = current.x - p.x;
      const cdy = current.y - p.y;
      const fdx = found.x - p.x;
      const fdy = found.y - p.y;
      const margin = HOMING.switchMargin * HOMING.switchMargin;
      if (fdx * fdx + fdy * fdy < (cdx * cdx + cdy * cdy) * margin) {
        this.homingTargets[p.id] = found;
        p.homingTargetId = found.id;
        return found;
      }
    }
    return current;
  }

  /**
   * The nearest enemy this shot could still hit, preferring the cone ahead.
   *
   * The cone is what stops a Rear Guard or Scatter lane from U-turning into
   * whatever the front lane is already shooting the instant its delay expires:
   * a lane adopts something it is broadly already flying at, and only falls
   * back to "nearest anywhere" when its cone is empty. Bodies this shot has
   * already pierced are never candidates.
   */
  private seekNearest(p: Projectile, hitSet: Set<number> | undefined): Enemy | null {
    const heading = Math.atan2(p.vy, p.vx);
    const found = this.enemies.queryRadius(p.x, p.y, HOMING.seekRadius, this.seekScratch);
    let inCone: Enemy | null = null;
    let inConeD = Infinity;
    let anywhere: Enemy | null = null;
    let anywhereD = Infinity;
    for (const e of found) {
      if (!isTargetable(e)) continue;
      if (hitSet !== undefined && hitSet.has(e.id)) continue;
      const dx = e.x - p.x;
      const dy = e.y - p.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < anywhereD) {
        anywhere = e;
        anywhereD = d2;
      }
      let diff = Math.atan2(dy, dx) - heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) <= HOMING.acquireCone && d2 < inConeD) {
        inCone = e;
        inConeD = d2;
      }
    }
    return inCone ?? anywhere;
  }

  fire(target: Enemy | null, towerState: TowerState, opts: FireOptions): Projectile[] {
    const aimX = opts.aimX ?? (target ? target.x : towerState.x + 1);
    const aimY = opts.aimY ?? (target ? target.y : towerState.y);
    const dx = aimX - towerState.x;
    const dy = aimY - towerState.y;
    const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    const baseVx = (dx / d) * PROJECTILE_SPEED;
    const baseVy = (dy / d) * PROJECTILE_SPEED;
    const baseAngle = Math.atan2(baseVy, baseVx);
    const cosA = Math.cos(baseAngle);
    const sinA = Math.sin(baseAngle);

    const additive = 1 + this.damageMultipliers.additive;
    const scaled = opts.rawDamage * additive * this.damageMultipliers.multiplicative;

    const variants = opts.variants && opts.variants.length > 0 ? opts.variants : [{}];
    const created: Projectile[] = [];

    /**
     * How "spread" a lane is, 0..1, from its angle off the volley heading.
     *
     * Twin Arrows (parallel lanes, `angleOffset` 0) scores 0 and keeps today's
     * instant-seek behaviour — that perk *is* the tight one. Scatter Shot
     * (30-75°) and Rear Guard (180°) score high and get the delay and the
     * launch boost, which is what keeps the three perks distinct once Seeker
     * Shots is drafted. Relentless's ±0.18 rad lanes score ~0.23, i.e. nearly
     * nothing, which is correct — they are a burst, not a spread.
     */
    const spreadOf = (angleOffset: number): number => {
      let a = Math.abs(angleOffset) % (Math.PI * 2);
      if (a > Math.PI) a = Math.PI * 2 - a;
      return Math.min(1, a / HOMING.spreadFullAngle);
    };

    for (const v of variants) {
      const a = baseAngle + (v.angleOffset ?? 0);
      // Spread lanes launch *fast and straight*, then settle. Only homing shots
      // are boosted: without the steering that follows it, a faster scatter
      // lane would be a silent, unpriced buff to a perk this plan is not
      // rebalancing.
      const spread = opts.isHoming ? spreadOf(v.angleOffset ?? 0) : 0;
      const delay = opts.isHoming
        ? (opts.homingDelay ?? 0) + HOMING.spreadDelay * spread
        : 0;
      const launchSpeed = PROJECTILE_SPEED
        * (1 + (HOMING.spreadLaunchBoost - 1) * spread);
      const vx = Math.cos(a) * launchSpeed;
      const vy = Math.sin(a) * launchSpeed;
      const ox = v.posOffsetX ?? 0;
      const oy = v.posOffsetY ?? 0;

      const proj: Projectile = {
        id: nextId(),
        x: towerState.x + ox * cosA - oy * sinA,
        y: towerState.y + ox * sinA + oy * cosA,
        targetId: opts.targetId,
        vx,
        vy,
        damage: scaled * Math.max(0, v.damageScale ?? 1),
        damageType: opts.damageType,
        isCrit: opts.isCrit,
        alive: true,
        // A delayed lane launches *untargeted* on purpose: it acquires from
        // wherever it has got to when the delay expires, which is how two
        // scatter lanes end up on two different enemies.
        homingTargetId: opts.isHoming && delay <= 0 ? opts.targetId ?? undefined : undefined,
        turnRate: opts.isHoming ? (opts.turnRate ?? HOMING.turnRate) : undefined,
        lifetime: opts.isHoming ? (opts.lifetime ?? 3) : undefined,
        homingDelay: opts.isHoming && delay > 0 ? delay : undefined,
        cruiseSpeed: opts.isHoming && launchSpeed > PROJECTILE_SPEED ? PROJECTILE_SPEED : undefined,
        // Zero, not `retargetInterval`: the first steering step re-scans, so a
        // shot fired at a locked target that is *not* the nearest one corrects
        // as soon as it starts steering rather than 0.12 s later.
        retargetIn: opts.isHoming ? 0 : undefined,
        age: 0,
        splashRadius: opts.splashRadius,
        splashFraction: opts.splashFraction,
        visual: opts.visual,
      };

      if (opts.piercing) {
        this.piercingRemaining[proj.id] = 2;
      } else if (opts.extraPierce) {
        this.piercingRemaining[proj.id] = 1 + this.pierceExtra + Math.max(0, Math.floor(opts.extraPierce));
      }
      this.bus.emit('projectile_fired', { projectile: proj, isCrit: opts.isCrit });
      this.projectiles.push(proj);
      created.push(proj);
    }

    return created;
  }

  tick(dt: number): void {
    for (const p of this.projectiles) {
      if (!p.alive) continue;
      // Belt and braces: no path out of the impact block below leaves this set,
      // but a stale `true` would silently disable Splinter for the whole run.
      this.resolvingShard = false;
      // Remember where the projectile was: at 720 px/s a single step can cover
      // far more than an enemy's radius (especially at high game speed), so
      // collision is tested against the whole travel segment, not the end point.
      const prevX = p.x;
      const prevY = p.y;
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      // Every projectile ages, so one that never hits anything and never
      // leaves the play field still retires (plan §5.5).
      const age = (p.age ?? 0) + dt;
      p.age = age;
      if (age >= MAX_PROJECTILE_AGE) {
        p.alive = false;
        continue;
      }

      // ── Homing (plans/homing.md) ──
      // `turnRate` alone is the gate now: `fire` sets it only for homing shots,
      // and a seeker may legitimately have no target yet (a clicked volley, or
      // a spread lane still inside its launch delay).
      if (p.turnRate !== undefined) {
        if (p.lifetime !== undefined && age >= p.lifetime) {
          p.alive = false;
          continue;
        }
        this.steerHoming(p, age, dt);
      }

      const hitSet = this.hitEnemies[p.id];
      const segX = p.x - prevX;
      const segY = p.y - prevY;
      const segLenSq = segX * segX + segY * segY;
      // Nearest enemy *along the travel segment*, so a fast projectile hits the
      // first thing in its path rather than whatever comes first in the array.
      let hit: Enemy | null = null;
      let hitT = Infinity;
      for (const e of this.enemies.list) {
        // `isTargetable`, not `alive`: a burrowed burrower and a splitter child
        // inside its spawn protection are on the field and shots pass straight
        // through them (plan §2.1/§2.2).
        if (!isTargetable(e)) continue;
        if (hitSet && hitSet.has(e.id)) continue;
        // `PROJECTILE_HIT_PAD`, not a literal 6: bodies scaled by
        // `ENTITY_SCALE` while flight and enemy speeds scaled by the larger
        // `WORLD_SCALE`, so without the pad every moving target became harder
        // to hit purely as a side effect of the zoom-out (UI plan §1.1).
        const r = this.enemyRadius(e) + PROJECTILE_HIT_PAD;
        let t = 0;
        if (segLenSq > 0) {
          t = ((e.x - prevX) * segX + (e.y - prevY) * segY) / segLenSq;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
        }
        const cx = prevX + segX * t - e.x;
        const cy = prevY + segY * t - e.y;
        if (cx * cx + cy * cy <= r * r && t < hitT) {
          hit = e;
          hitT = t;
        }
      }
      if (hit) {
        const enemy = hit;
        // Splinter reentrancy (plans/bounce.md §3.3): everything `enemies.damage`
        // reaches from here is a *shard's* doing if this projectile is one.
        this.resolvingShard = p.splitGen !== undefined;
        // Instant kill evolution (non-boss only)
        if (this.instantKillChance > 0 && enemy.type !== 'boss' && Math.random() < this.instantKillChance) {
          const dmg = enemy.hp;
          // `dmg` is the target's whole remaining bar, not a shot's worth, so
          // it is not reflectable — see `EnemyManager.damage`.
          this.enemies.damage(enemy, dmg, false, false);
          this.bus.emit('tower_damage_dealt', { amount: dmg });
        } else if (this.tryExecute(enemy)) {
          // Executioner blessing already finished it; nothing else to apply.
        } else {
          const effectiveArmor = p.isCrit && this.critIgnoreArmor
            ? 0
            : Math.max(0, enemy.armor * (1 - this.armorPen) - this.armorPenFlat);
          const penEnemy = effectiveArmor !== enemy.armor
            ? { ...enemy, armor: effectiveArmor }
            : enemy;
          let final = this.tower.applyResists(penEnemy, p.damage, p.damageType);
          if (this.executeThreshold > 0 && enemy.hp / enemy.maxHp < this.executeThreshold) {
            final = Math.floor(final * (1 + this.executeMultiplier));
          }
          if (this.talentExecuteBonus > 0 && enemy.hp / enemy.maxHp < TALENT_EXECUTE_THRESHOLD) {
            final = Math.floor(final * (1 + this.talentExecuteBonus));
          }
          // Shatter: the payoff card for a frost build. Read from the enemy's
          // own chill state, not a global flag, so it rewards actually having
          // slowed *this* target.
          if (this.blessings.has('shatter') && this.enemies.isSlowed(enemy)) {
            final = Math.floor(final * (1 + BLESSING_TUNING.shatterBonus));
          }
          // Overwatch: the far band of the tower's own range. Read from the
          // live snapshot so levelling `range` moves the band with the ring.
          if (this.rangeDamageBonus > 0) {
            const ts = this.tower.snapshot;
            const ddx = enemy.x - ts.x;
            const ddy = enemy.y - ts.y;
            const far = ts.range * OVERWATCH_RANGE_FRACTION;
            if (ddx * ddx + ddy * ddy > far * far) {
              final = Math.floor(final * (1 + this.rangeDamageBonus));
            }
          }
          // Skewer: every body after the first on this shot. `hitEnemies` is
          // only populated once a projectile has actually pierced something.
          if (this.pierceAmp > 0 && (this.hitEnemies[p.id]?.size ?? 0) > 0) {
            final = Math.floor(final * (1 + this.pierceAmp));
          }
          // Focus Fire: bonus damage per consecutive impact on the same target.
          if (this.focusStackBonus > 0) {
            if (enemy.id === this.focusTargetId) {
              this.focusStacks = Math.min(TALENT_TUNING.focusMaxStacks, this.focusStacks + 1);
            } else {
              this.focusTargetId = enemy.id;
              this.focusStacks = 0;
            }
            final = Math.floor(final * (1 + this.focusStackBonus * this.focusStacks));
          }
          // Siegebreaker: bonus damage against boss enemies.
          if (this.bossDamageBonus > 0 && enemy.type === 'boss') {
            final = Math.floor(final * (1 + this.bossDamageBonus));
          }
          // Frostbite: bonus damage against chilled/slowed enemies.
          if (this.chilledDamageBonus > 0 && this.enemies.isSlowed(enemy)) {
            final = Math.floor(final * (1 + this.chilledDamageBonus));
          }
          const hpBefore = enemy.hp;
          const killed = this.enemies.damage(enemy, final, p.isCrit);
          this.bus.emit('tower_damage_dealt', { amount: final });
          if (!killed) {
            const ts = this.tower.snapshot;
            if (ts.knockbackForce > 0) {
              this.enemies.applyKnockback(enemy, ts.knockbackForce, ts.x, ts.y);
            }
          }
          if (this.blessings.has('frost_shots')) {
            this.enemies.applyChill(
              enemy,
              BLESSING_TUNING.frostChillFactor,
              BLESSING_TUNING.frostChillDuration,
            );
          }
          // Frostwork's chill is harder and longer than the blessing's, and
          // both route through `applyChill`, whose "strongest wins, weaker only
          // refreshes" rule composes them without one diluting the other.
          if (this.core.has('chill_shots')) {
            this.enemies.applyChill(enemy, CORE_TUNING.chillFactor, CORE_TUNING.chillDuration);
          }
          // Crit splash evolution
          if (p.isCrit && this.critSplashFraction > 0) {
            const splashDamage = Math.max(1, Math.floor(final * this.critSplashFraction));
            const splashRadius = world(50);
            for (const e of this.enemies.queryRadius(enemy.x, enemy.y, splashRadius)) {
              if (e.id === enemy.id || !isTargetable(e)) continue;
              this.enemies.damage(e, splashDamage, false);
              this.bus.emit('tower_damage_dealt', { amount: splashDamage });
            }
          }
          // ── blessing behaviors on impact (plan §1.3) ──
          if (p.splashRadius && p.splashRadius > 0) {
            this.applyBlastSplash(p, enemy, final);
            // Damage is already applied here; the ring is presentation only.
            this.bus.emit('projectile_exploded', { x: enemy.x, y: enemy.y, radius: p.splashRadius });
          }
          if (p.isCrit && this.blessings.has('crit_chain')) {
            this.applyCritChain(enemy, final);
          }
          // Plan §7.5: overkill carries by default now; the blessing raises
          // the share rather than switching the mechanism on.
          if (killed) {
            this.applyOverkill(enemy, final - hpBefore);
          }
        }
        // Plan §2.2: a tank body-blocks. However much pierce the shot has, it
        // stops here — which is what gives the tank a job in a formation
        // instead of making it a fat circle that pierce walks through.
        const blocked = enemy.type === 'tank';
        const remaining = blocked ? 1 : this.pierceMax(p.id);
        if (remaining > 1) {
          this.piercingRemaining[p.id] = remaining - 1;
          if (!this.hitEnemies[p.id]) this.hitEnemies[p.id] = new Set();
          this.hitEnemies[p.id].add(enemy.id);
        } else if (this.tryBounce(p, enemy, prevX + segX * hitT, prevY + segY * hitT)) {
          // `plans/bounce.md` §3.1: pierce is spent first, and a bounce is what
          // happens *instead of* the shot dying. `tryBounce` owns all of the
          // bookkeeping — position, heading, damage, budgets, hit set.
        } else {
          p.alive = false;
          delete this.piercingRemaining[p.id];
          delete this.hitEnemies[p.id];
          delete this.homingTargets[p.id];
        }
        this.resolvingShard = false;
      }
    }

    const margin = world(120);
    const maxX = this.boundsWidth + margin;
    const maxY = this.boundsHeight + margin;
    this.projectiles = this.projectiles.filter(p => {
      if (!p.alive || p.x < -margin || p.x > maxX || p.y < -margin || p.y > maxY) {
        delete this.hitEnemies[p.id];
        delete this.piercingRemaining[p.id];
        delete this.homingTargets[p.id];
        return false;
      }
      return true;
    });
  }

  private enemyRadius(enemy: Enemy): number {
    return ENEMY_DEFS[enemy.type].radius;
  }

  // ── blessing behaviors (plan §1.3) ──

  /**
   * Executioner: finish a non-boss enemy already under the threshold.
   *
   * Checked *before* damage is computed, so it reads as "anything this weak
   * dies on contact" rather than as a conditional damage bonus. Bosses are
   * exempt by design — a one-shot on the encounter would delete Part 3.
   */
  private tryExecute(enemy: Enemy): boolean {
    if (!this.blessings.has('executioner')) return false;
    if (enemy.type === 'boss') return false;
    if (enemy.maxHp <= 0) return false;
    if (enemy.hp / enemy.maxHp >= BLESSING_TUNING.executeThreshold) return false;
    const dmg = enemy.hp;
    // Same as the instant-kill evolution: a finisher's `amount` is the target's
    // bar, so a thorns elite does not get to reflect a share of it.
    this.enemies.damage(enemy, dmg, false, false);
    this.bus.emit('tower_damage_dealt', { amount: dmg });
    return true;
  }

  /** The `n` nearest living enemies to a point, excluding `exclude`. */
  private nearestOthers(
    x: number,
    y: number,
    radius: number,
    exclude: ReadonlySet<number>,
    count: number,
  ): Enemy[] {
    const found = this.enemies.queryRadius(x, y, radius);
    const scored: Array<{ e: Enemy; d: number }> = [];
    for (const e of found) {
      if (!isTargetable(e) || exclude.has(e.id)) continue;
      const dx = e.x - x;
      const dy = e.y - y;
      scored.push({ e, d: dx * dx + dy * dy });
    }
    scored.sort((a, b) => a.d - b.d);
    return scored.slice(0, count).map(s => s.e);
  }

  /** Mortar blessing: every 8th shot lands as a blast rather than a point hit. */
  private applyBlastSplash(p: Projectile, hit: Enemy, final: number): void {
    const fraction = p.splashFraction ?? 1;
    const splash = Math.max(1, Math.floor(final * fraction));
    for (const e of this.enemies.queryRadius(hit.x, hit.y, p.splashRadius ?? 0)) {
      if (e.id === hit.id || !isTargetable(e)) continue;
      this.enemies.damage(e, splash, false);
      this.bus.emit('tower_damage_dealt', { amount: splash });
    }
  }

  // ── Ricochet: the shot itself deflects (plans/bounce.md §3) ──

  /**
   * Turn a lethal-to-the-shot impact into a deflection, if it can.
   *
   * Returns `true` when the projectile survives and is now flying at a new
   * body; `false` when the caller should retire it as usual. Every side effect
   * lives here so the impact block stays a two-line branch.
   *
   * `impactX/impactY` is the swept-collision point, not `p.x/p.y`: at
   * `PROJECTILE_SPEED` a step can carry the shot most of a body-width past the
   * thing it hit, and bouncing from the far side of the target looks like a
   * teleport.
   */
  private tryBounce(p: Projectile, from: Enemy, impactX: number, impactY: number): boolean {
    if (!this.blessings.has('ricochet')) return false;
    // A shard is already a secondary projectile; letting it ricochet turns one
    // kill into an unbounded fan (plans/bounce.md §3.3).
    if (p.splitGen !== undefined) return false;

    const powered = this.blessings.has('ricochet_power');
    if (p.bouncesLeft === undefined) {
      p.bouncesLeft = powered
        ? BLESSING_TUNING.ricochetPowerBounces
        : BLESSING_TUNING.ricochetBounces;
    }
    if (p.bouncesLeft <= 0) return false;

    const radius = powered
      ? BLESSING_TUNING.ricochetRange * BLESSING_TUNING.ricochetPowerRangeMult
      : BLESSING_TUNING.ricochetRange;

    let hitSet = this.hitEnemies[p.id];
    if (!hitSet) {
      hitSet = new Set();
      this.hitEnemies[p.id] = hitSet;
    }
    hitSet.add(from.id);

    const next = this.bounceTarget(p, impactX, impactY, hitSet, radius);
    if (!next) {
      // No legal body: the shot dies here. The set is cleaned up by the caller.
      return false;
    }

    // Speed is read *before* `cruiseSpeed` is cleared: a spread lane that is
    // still riding its launch boost settles to the ordinary cruise on bounce
    // rather than keeping the boost for the rest of its life.
    const speed = p.cruiseSpeed ?? PROJECTILE_SPEED;
    const dx = next.x - impactX;
    const dy = next.y - impactY;
    const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));

    const inAngle = Math.atan2(p.vy, p.vx);
    p.x = impactX;
    p.y = impactY;
    p.vx = (dx / d) * speed;
    p.vy = (dy / d) * speed;
    p.damage *= powered
      ? BLESSING_TUNING.ricochetPowerDamage
      : BLESSING_TUNING.ricochetDamage;
    p.bouncesLeft -= 1;
    p.bounces = (p.bounces ?? 0) + 1;
    // A bounce spends whatever pierce is left. Without this a tank-blocked shot
    // (which reaches this branch with its pierce record untouched) would get
    // its pass-throughs back on the far side of the bounce.
    this.piercingRemaining[p.id] = 1;

    // The rest of its life it is a seeker: it was aimed at a moving target from
    // up to 1053 units away, and a straight line would miss most of them
    // (plans/bounce.md §3.2). This reuses `steerHoming` unchanged.
    p.turnRate = BOUNCE.turnRate;
    p.lifetime = BOUNCE.lifetime;
    p.homingDelay = undefined;
    p.cruiseSpeed = undefined;
    p.retargetIn = 0;
    p.homingTargetId = next.id;
    this.homingTargets[p.id] = next;
    // Both lifetime caps in `tick` measure from `age`, so the bounce is what
    // buys the shot its new leash.
    p.age = 0;

    this.bus.emit('projectile_bounced', {
      x: impactX,
      y: impactY,
      inAngle,
      outAngle: Math.atan2(p.vy, p.vx),
      bounces: p.bounces,
      magic: p.damageType === 'magic',
    });
    return true;
  }

  /**
   * The body a bounce should deflect onto.
   *
   * Scored on squared distance with a flat penalty for anything outside the
   * forward cone, so a ricochet carries on across the pack rather than folding
   * back onto whatever is behind the shot — unless there is genuinely nothing
   * ahead, which is when a bounce backwards is the right answer.
   */
  private bounceTarget(
    p: Projectile,
    x: number,
    y: number,
    hitSet: Set<number>,
    radius: number,
  ): Enemy | null {
    const heading = Math.atan2(p.vy, p.vx);
    const minD2 = BOUNCE.minDistance * BOUNCE.minDistance;
    const found = this.enemies.queryRadius(x, y, radius, this.bounceScratch);
    let best: Enemy | null = null;
    let bestScore = Infinity;
    for (const e of found) {
      if (!isTargetable(e)) continue;
      if (hitSet.has(e.id)) continue;
      const dx = e.x - x;
      const dy = e.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < minD2) continue;
      let diff = Math.atan2(dy, dx) - heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const score = Math.abs(diff) <= BOUNCE.cone ? d2 : d2 * BOUNCE.backPenalty;
      if (score < bestScore) {
        best = e;
        bestScore = score;
      }
    }
    return best;
  }

  // ── Splinter: shards thrown by a kill (plans/bounce.md §3.3) ──

  /**
   * Launch Splinter shards from a kill point.
   *
   * Not `fire`: `fire` launches from the tower with the volley's spread model,
   * and a shard launches from a corpse on a fan of its own. It shares `fire`'s
   * *damage* scaling on purpose — that is the half of the pipeline the old
   * instant-damage version skipped, which is why Splinter stopped mattering
   * after a few dozen upgrades (`plans/bounce.md` §2.5).
   *
   * @param rawDamage per-shard damage before the projectile multipliers.
   * @returns the shards created; empty when nothing was in range.
   */
  fireShards(x: number, y: number, rawDamage: number, damageType: DamageType): Projectile[] {
    const targets = this.nearestOthers(
      x,
      y,
      BLESSING_TUNING.splitShardRange,
      NO_EXCLUSIONS,
      BLESSING_TUNING.splitShardCount,
    );
    if (targets.length === 0) return [];

    const additive = 1 + this.damageMultipliers.additive;
    const scaled = Math.max(1, rawDamage * additive * this.damageMultipliers.multiplicative);
    const created: Projectile[] = [];

    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      // Fanned off the true bearing, so the pair visibly scatters out of the
      // body before the steering pulls each one back in.
      const bearing = Math.atan2(t.y - y, t.x - x);
      const a = bearing + SHARD.fan * (i - (targets.length - 1) / 2);
      const proj: Projectile = {
        id: nextId(),
        x,
        y,
        targetId: t.id,
        vx: Math.cos(a) * SHARD.speed,
        vy: Math.sin(a) * SHARD.speed,
        damage: scaled,
        damageType,
        isCrit: false,
        alive: true,
        homingTargetId: t.id,
        turnRate: SHARD.turnRate,
        lifetime: SHARD.lifetime,
        retargetIn: 0,
        age: 0,
        splitGen: 1,
        visual: 'shard',
      };
      // A shard never pierces, whatever the tower's pierce is: it is already
      // the second hit this kill has paid for.
      this.piercingRemaining[proj.id] = 1;
      this.homingTargets[proj.id] = t;
      this.projectiles.push(proj);
      created.push(proj);
    }

    // Deliberately *not* `projectile_fired`: that event is the tower's shot,
    // and routing shards through it would fire the shoot sound twice per kill.
    this.bus.emit('shards_split', { x, y, count: created.length });
    return created;
  }

  /** Chain Crit: a crit forks into a short lightning chain. */
  private applyCritChain(from: Enemy, final: number): void {
    const dmg = Math.max(1, Math.floor(final * BLESSING_TUNING.critChainDamage));
    const struck = new Set<number>([from.id]);
    const path: Array<{ x: number; y: number }> = [{ x: from.x, y: from.y }];
    let originX = from.x;
    let originY = from.y;
    for (let i = 0; i < BLESSING_TUNING.critChainBounces; i++) {
      const [next] = this.nearestOthers(
        originX,
        originY,
        BLESSING_TUNING.critChainRange,
        struck,
        1,
      );
      if (!next) break;
      struck.add(next.id);
      originX = next.x;
      originY = next.y;
      path.push({ x: next.x, y: next.y });
      this.enemies.damage(next, dmg, false);
      this.bus.emit('tower_damage_dealt', { amount: dmg });
    }
    // Reuse the existing chain-lightning visual rather than inventing a second
    // vocabulary for the same idea.
    if (path.length >= 2) this.bus.emit('chain_lightning', { path });
  }

  /**
   * Overkill: excess damage on a killing blow carries to the next target.
   *
   * Baseline **10%** (plan §7.5), raised to 25% by the `overkill_carry`
   * blessing — one mechanism with two rates rather than two mechanisms that
   * would both fire on a blessed kill. Needs no throughput pricing: the carried
   * amount is a fraction of damage the tower already dealt, so it grows with
   * every damage purchase instead of shrinking against every fire-rate one.
   *
   * `nearestOthers` filters on `isTargetable`, which is what keeps a carry from
   * landing on a corpse, a burrowed enemy or a spawn-protected splitter child.
   */
  private applyOverkill(from: Enemy, overkill: number): void {
    if (overkill <= 0) return;
    const share = this.blessings.has('overkill_carry')
      ? BLESSING_TUNING.overkillCarry
      : OVERKILL_CARRY_BASE;
    const carried = Math.floor(overkill * share);
    if (carried <= 0) return;
    const [next] = this.nearestOthers(
      from.x,
      from.y,
      BLESSING_TUNING.overkillRange,
      new Set<number>([from.id]),
      1,
    );
    if (!next) return;
    this.enemies.damage(next, carried, false);
    this.bus.emit('tower_damage_dealt', { amount: carried });
  }

  reset(): void {
    this.projectiles = [];
    this.piercingRemaining = {};
    this.hitEnemies = {};
    this.homingTargets = {};
    this.resolvingShard = false;
    this.focusTargetId = -1;
    this.focusStacks = 0;
  }
}
