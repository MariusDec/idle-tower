import type { BossPattern, Enemy, EnemyType, AuraType, HostileShot, Projectile } from '../types';
import { FX, withAlpha } from '../data/palette';
import { distance2, nextId } from '../utils/math';
import {
  BOSS_ENCOUNTER,
  ENEMY_BEHAVIOR,
  ENEMY_DEFS,
  bossEnrageStacksFor,
  bossMaxHpForWave,
  bossPatternForPhase,
  bossPhaseForHpFraction,
  bossSummonCountForWave,
  bossTierForWave,
  ignoresWallBand,
  spawnPoolForWave,
} from '../data/enemies';
import {
  bossCountForWave,
  enemyDamageForWave,
  enemyHPForWave,
  enemySpeedForWave,
  goldDropForWave,
} from '../data/formulas';
import { world } from '../data/arena';
import { TOWER_HIT_RADIUS } from '../data/tower';
import { SpatialGrid } from '../utils/SpatialGrid';
import { EventBus } from '../game/EventBus';
import type { ResourceManager } from './ResourceManager';
import type { ResearchTree } from './ResearchTree';

const ENEMY_GAP = world(2);

/** How far past the arena edge a fleeing thief must get to count as escaped. */
const ESCAPE_MARGIN = world(30);

/**
 * Ceiling on siege shells in the air at once.
 *
 * A wave full of siege enemies stalled behind a slow means shells accumulate
 * faster than they land; the oldest is dropped rather than letting the list —
 * and the draw loop over it — grow without bound.
 */
const MAX_HOSTILE_SHOTS = 64;

/**
 * What an enemy wants to do this substep (gameplay plan §2.1).
 *
 * `phase`-style behaviours (the blink) report `hold`, because they have already
 * moved themselves and the shared travel code must not move them again.
 */
type EnemyStance = 'advance' | 'hold' | 'retreat' | 'escaped';

// Elite enemy constants
//
// Plan §3.4: the ramp used to top out at 8% at wave 200, which made five
// hand-written auras into noise a player would rarely see and never plan
// around. It now reaches its cap of 20% at wave 100 — frequent enough to be a
// recognisable part of a wave's texture, still rare enough to feel like an
// event. Elites also pay for themselves now (see ELITE_GOLD_MULT and the
// guaranteed RP drop in `damage`).
const ELITE_UNLOCK_WAVE = 21;
const ELITE_SPAWN_CHANCE_BASE = 0.02;
const ELITE_SPAWN_CHANCE_MAX_WAVE = 100;
const ELITE_SPAWN_CHANCE_MAX = 0.20;
const ELITE_HP_MULT = 2.5;
/** Gold multiplier every elite carries, on top of any aura bonus. */
const ELITE_GOLD_MULT = 2.5;
/** RP guaranteed by an elite kill (plan §3.4: elites are a visible RP faucet). */
const ELITE_RP_DROP = 1;
const AURA_RADIUS = world(180);
const HASTE_SPEED_BONUS = 0.5;
const THORNS_REFLECT_FRACTION = 0.1;
const GREED_GOLD_MULT = 3;
const VITALITY_REGEN_FRACTION = 0.01; // 1% maxHP per second
const RETRIBUTION_BUFF_DURATION = 5;
const RETRIBUTION_BUFF_DAMAGE_MULT = 1.5;
const RETRIBUTION_BUFF_SPEED_MULT = 1.5;

/**
 * Cell size of the enemy spatial grid (plan §5.4).
 *
 * Sized between the small radii (mine and splash, ~50 px) and the large ones
 * (auras at 180 px, healer at 150 px). Measured at 128: a 180 px aura query
 * visits 4x4 cells instead of the 5x5 a 96 px grid needs, while a 50 px splash
 * query still only touches 2x2 — the per-cell lookup is a real share of the
 * cost at this enemy count, so visiting fewer, fuller cells wins.
 */
const GRID_CELL_SIZE = world(128);

/** Compute elite spawn chance for a given wave. */
export function eliteChanceForWave(wave: number): number {
  if (wave < ELITE_UNLOCK_WAVE) return 0;
  return Math.min(
    ELITE_SPAWN_CHANCE_MAX,
    ELITE_SPAWN_CHANCE_BASE +
      ((wave - ELITE_UNLOCK_WAVE) * (ELITE_SPAWN_CHANCE_MAX - ELITE_SPAWN_CHANCE_BASE)) /
        (ELITE_SPAWN_CHANCE_MAX_WAVE - ELITE_UNLOCK_WAVE),
  );
}

const ELITE_AURA_COLORS: Record<AuraType, string> = {
  haste: withAlpha(FX.frost, 0.3),
  thorns: withAlpha(FX.ember, 0.3),
  greed: withAlpha(FX.gold, 0.35),
  vitality: withAlpha(FX.nature, 0.3),
  retribution: withAlpha(FX.arcane, 0.3),
};

export { ELITE_AURA_COLORS, AURA_RADIUS, RETRIBUTION_BUFF_DURATION };

export class EnemyManager {
  private enemies: Enemy[] = [];
  private readonly bus: EventBus;
  private readonly resources: ResourceManager;
  private readonly researchTree: ResearchTree | null;
  /**
   * Fully composed gold multiplier: every source, including the Gold Rush
   * buff, arrives already folded together by `resolveStats`. This manager has
   * exactly one writer and does no composition of its own.
   */
  private goldMultiplier = 1;
  private slowFactor = 1;
  private slowTimer = 0;
  private goldLuckChance = 0;
  private goldLuckMultiplier = 1;
  private doubleGoldChance = 0;
  private thorns = 0;
  private wallContactExtra = 0;
  private hpReduction = 0;
  private vulnerableEnemies: Map<number, number> = new Map();
  private killStreakGoldBonus = 0;
  private manaFullGoldBonus = 0;
  private rpDropChanceBonus = 0;
  private goldOnKillBonus = 0;
  private critGoldBonus = 0;
  /** Multiplier applied to enemy movement speed on spawn (default 1). */
  private speedMult = 1;
  /** Multiplier applied to enemy damage dealt to the tower (default 1). */
  private damageToTowerMult = 1;
  /**
   * Enrage multipliers (plan §2.3.3). A separate channel from the wave-modifier
   * multipliers above so the two compose instead of overwriting each other, and
   * applied live rather than at spawn so already-spawned enemies enrage too.
   */
  private enrageDamageMult = 1;
  private enrageSpeedMult = 1;
  /** Multiplier applied to enemy max HP on spawn (default 1). */
  private hpMult = 1;
  /**
   * Blessing-owned enemy multipliers (plan §1.4).
   *
   * Separate channels from the wave-modifier ones above so the two *compose*
   * rather than overwrite — a Reckless Greed run under Glass Cannon should get
   * both. Speed and damage apply live (so a mid-wave pick is felt immediately);
   * HP applies at spawn, like every other HP multiplier.
   *
   * Named for the *pipeline*, not for blessings: plan §7.4's risk dial resolves
   * into the same two keys, so a channel called "blessing" would have been a
   * lie the next time someone went looking for where risk lands.
   */
  private statSpeedMult = 1;
  private statHpMult = 1;
  private statDamageMult = 1;
  /**
   * Per-enemy chill from the Frostbite blessing: enemy id → { factor, remaining }.
   *
   * Distinct from the global `slowFactor`, which every ability writes: a chill
   * has to be attributable to a single enemy so `Shatter` can ask whether *this*
   * target is slowed.
   */
  private chilled = new Map<number, { factor: number; remaining: number }>();
  /** Retribution buffs: enemy ID → remaining duration. */
  private retributionBuffs: Map<number, number> = new Map();
  /**
   * Position index for radius queries (plan §5.4). Rebuilt lazily: `gridStale`
   * is set whenever the roster or any position changes, and `ensureGrid`
   * re-indexes at most once before the next batch of queries.
   */
  private readonly grid = new SpatialGrid<Enemy>(GRID_CELL_SIZE);
  private gridStale = true;
  /**
   * Shells fired *at* the tower by siege enemies (plan §2.1).
   *
   * Owned here rather than in `ProjectileManager` because every loop in that
   * class assumes friendly ownership — pierce, crit, armour penetration, the
   * blessing behaviours. On arrival a shell emits `tower_damaged` and the whole
   * existing mitigation chain applies to it unchanged.
   */
  private hostileShots: HostileShot[] = [];
  /** Wave currently spawning; drives the thief's per-wave theft ceiling. */
  private currentWave = 1;
  /** Gold stolen so far during `currentWave`, against the 15% cap. */
  private theftThisWave = 0;
  /** Play-field size, so a fleeing thief knows where the edge is. */
  private boundsWidth = world(1280);
  private boundsHeight = world(720);
  /** Tower position from the last tick, so a fleeing healer knows what to run from. */
  private lastTowerX = 0;
  private lastTowerY = 0;

  constructor(bus: EventBus, resources: ResourceManager, researchTree?: ResearchTree) {
    this.bus = bus;
    this.resources = resources;
    this.researchTree = researchTree ?? null;
  }

  get list(): Enemy[] {
    return this.enemies;
  }

  /** Incoming siege shells, for the renderer. */
  get hostileShotList(): HostileShot[] {
    return this.hostileShots;
  }

  /** Play-field size. A fleeing thief escapes by crossing it. */
  /**
   * Force a broadphase rebuild.
   *
   * Anything that moves enemies from outside `tick` — today only the camera's
   * proportional rescale on a resize — has to say so, or the next radius query
   * answers from a stale index (see `docs/performance.md`).
   */
  markGridStale(): void {
    this.gridStale = true;
  }

  setBounds(width: number, height: number): void {
    this.boundsWidth = width;
    this.boundsHeight = height;
  }

  /**
   * A new wave is starting: reset the per-wave theft budget (plan §2.6).
   *
   * Called by `WaveManager.startWave`, so the cap follows the wave the player
   * is actually on rather than whatever the last thief happened to spawn in.
   */
  beginWave(wave: number): void {
    this.currentWave = Math.max(1, Math.floor(wave));
    this.theftThisWave = 0;
  }

  /** Composed permanent gold multiplier (1 = no bonus). */
  setGoldMultiplier(multiplier: number): void {
    this.goldMultiplier = Math.max(0, multiplier);
  }

  /** Scavenge talent: chance for a kill to pay double. */
  setDoubleGoldChance(chance: number): void {
    this.doubleGoldChance = Math.max(0, Math.min(1, chance));
  }

  setGoldLuck(chance: number, multiplier: number): void {
    this.goldLuckChance = Math.max(0, Math.min(1, chance));
    this.goldLuckMultiplier = Math.max(1, multiplier);
  }

  setThorns(thorns: number): void {
    this.thorns = thorns;
  }

  setWallContactExtra(extra: number): void {
    this.wallContactExtra = extra;
  }

  setHPReduction(reduction: number): void {
    this.hpReduction = Math.max(0, Math.min(0.5, reduction));
  }

  setKillStreakGoldBonus(bonus: number): void {
    this.killStreakGoldBonus = bonus;
  }

  setRPDropChanceBonus(bonus: number): void {
    this.rpDropChanceBonus = Math.max(0, bonus);
  }

  setGoldOnKillBonus(bonus: number): void {
    this.goldOnKillBonus = bonus;
  }

  setCritGoldBonus(bonus: number): void {
    this.critGoldBonus = bonus;
  }

  setManaFullGoldBonus(bonus: number): void {
    this.manaFullGoldBonus = bonus;
  }

  /**
   * Multiplier applied to enemy movement speed on spawn. Set to 1 to reset.
   * Boss enrage multiplies speed on top of this value.
   */
  setSpeedMult(mult: number): void {
    this.speedMult = Math.max(0.1, mult);
  }

  /**
   * Multiplier applied to damage enemies deal to the tower each frame.
   * Set to 1 to reset.
   */
  setDamageToTowerMult(mult: number): void {
    this.damageToTowerMult = Math.max(0, mult);
  }

  /**
   * Enrage multipliers for the wave in progress, owned solely by WaveManager.
   * Unlike `setSpeedMult` these apply to enemies already on the field.
   */
  setEnrage(damageMult: number, speedMult: number): void {
    this.enrageDamageMult = Math.max(1, damageMult);
    this.enrageSpeedMult = Math.max(1, speedMult);
  }

  /**
   * Multiplier applied to enemy HP on spawn (after wave scaling, before
   * research hpReduction). Set to 1 to reset.
   */
  setHPMult(mult: number): void {
    this.hpMult = Math.max(0.1, mult);
  }

  /** Resolved `enemySpeedMult` (blessings + risk); applies to live enemies. */
  setStatSpeedMult(mult: number): void {
    this.statSpeedMult = Math.max(0.1, mult);
  }

  /** Resolved `enemyHpMult` (blessings + risk); applied at spawn. */
  setStatHpMult(mult: number): void {
    this.statHpMult = Math.max(0.1, mult);
  }

  /** Resolved `enemyDamageMult` (blessings); damage enemies deal to the tower. */
  setStatDamageMult(mult: number): void {
    this.statDamageMult = Math.max(0, mult);
  }

  /**
   * Chill one enemy: `factor` multiplies its speed for `duration` seconds.
   * The strongest active chill wins; a weaker re-application only refreshes
   * the timer, so spamming shots cannot dilute a hard slow.
   */
  applyChill(enemy: Enemy, factor: number, duration: number): void {
    if (!enemy.alive) return;
    const existing = this.chilled.get(enemy.id);
    if (existing && existing.factor < factor) {
      existing.remaining = Math.max(existing.remaining, duration);
      return;
    }
    this.chilled.set(enemy.id, { factor, remaining: duration });
  }

  /** True while the enemy is chilled or a global slow is running. */
  isSlowed(enemy: Enemy): boolean {
    if (this.slowTimer > 0 && this.slowFactor < 1) return true;
    return this.chilled.has(enemy.id);
  }

  applySlow(factor: number, duration: number): void {
    if (factor < this.slowFactor || this.slowTimer <= 0) {
      this.slowFactor = factor;
      this.slowTimer = duration;
    } else {
      this.slowTimer = Math.max(this.slowTimer, duration);
    }
  }

  spawn(type: EnemyType, wave: number, spawnX: number, spawnY: number, overrides: Partial<Enemy> = {}): Enemy {
    const def = ENEMY_DEFS[type];
    let hp: number;
    // The boss *bar*: shrunk by whatever its phase machine holds outside it,
    // so the encounter costs the same total damage it always did (§3.7).
    if (type === 'boss') hp = bossMaxHpForWave(wave);
    else hp = enemyHPForWave(def.baseHP, wave);
    if (this.hpReduction > 0) hp = Math.max(1, Math.floor(hp * (1 - this.hpReduction)));
    if (this.hpMult !== 1) hp = Math.max(1, Math.floor(hp * this.hpMult));
    if (this.statHpMult !== 1) hp = Math.max(1, Math.floor(hp * this.statHpMult));
    const isElite = overrides.elite === true;
    if (isElite) hp = Math.max(1, Math.floor(hp * ELITE_HP_MULT));
    const speed = enemySpeedForWave(def.baseSpeed, wave) * this.speedMult;
    const gold = goldDropForWave(def.baseGold, wave);
    const damage = enemyDamageForWave(def.baseDamage, wave);
    const fireRate = Math.max(0.2, def.fireRate);
    const enemy: Enemy = {
      id: nextId(),
      type,
      x: spawnX,
      y: spawnY,
      hp,
      maxHp: hp,
      speed,
      armor: def.armor,
      magicResist: def.magicResist,
      goldValue: gold,
      damage,
      fireRate,
      attackCooldown: 1 / fireRate,
      attacking: false,
      alive: true,
      spawnWave: wave,
      undamagedFor: 0,
      ...(type === 'shielded'
        ? { shieldCharges: def.shieldCharges ?? 3, shieldRegenTimer: ENEMY_BEHAVIOR.shieldRegenInterval }
        : {}),
      ...(type === 'healer' ? { healCooldown: def.healCooldown ?? 2.5 } : {}),
      // A boss arrives already in phase 1 with its pattern armed, so the state
      // machine has no "not started yet" case to special-case (plan §3.1).
      ...(type === 'boss'
        ? {
          enraged: false,
          enrageTriggered: false,
          bossPhase: 1,
          bossPattern: bossPatternForPhase(bossTierForWave(wave), 1),
          bossElapsed: 0,
          bossEnrageStacks: 0,
          bossInvulnerable: 0,
          bossPackSize: Math.max(1, bossCountForWave(wave)),
        }
        : {}),
      // Behavioural types carry their cadence from the moment they spawn, so a
      // siege that walks into range mid-reload does not get a free instant shot
      // and a blinker cannot blink on its first substep.
      ...(type === 'siege' ? { siegeCooldown: ENEMY_BEHAVIOR.siegeReload, siegeHalted: false } : {}),
      ...(type === 'thief' ? { stolenGold: 0, fleeing: false } : {}),
      ...(type === 'blinker' ? { blinkTimer: ENEMY_BEHAVIOR.blinkInterval, blinkImmunity: 0 } : {}),
      ...(type === 'warden' ? { wardTimer: 0 } : {}),
      ...(type === 'burrower' ? { burrowed: true, surfacing: 0 } : {}),
      ...overrides,
    };
    this.enemies.push(enemy);
    this.gridStale = true;
    if (enemy.type === 'boss' && enemy.bossPattern !== undefined) {
      this.armBossPattern(enemy, enemy.bossPattern);
      // `Game` starts the encounter clock and the flawless flag off this, not
      // off `wave_started`: a boss wave's first boss arrives half a second in.
      this.bus.emit('boss_spawned', { enemy, wave, pattern: enemy.bossPattern });
    }
    return enemy;
  }

  /**
   * Spawn an elite version of an enemy with the given aura.
   */
  spawnElite(type: EnemyType, wave: number, spawnX: number, spawnY: number, aura: AuraType): Enemy {
    return this.spawn(type, wave, spawnX, spawnY, {
      elite: true,
      aura,
    });
  }

  /**
   * Apply damage to an enemy. For shielded enemies, consumes a charge instead
   * of HP. Returns true if enemy was killed by this hit.
   */
  damage(enemy: Enemy, amount: number, isCrit: boolean = false): boolean {
    if (!enemy.alive) return false;
    // Burrowed and freshly-split enemies are simply not there to be hit
    // (plan §2.1/§2.2). Returning silently — no shield break, no damage number
    // — is deliberate: every caller that reaches here does so because some
    // *other* code path failed to consult `isTargetable`, and a visible block
    // effect would read as "your shot was absorbed" rather than "it missed".
    if (enemy.burrowed === true) return false;
    if ((enemy.spawnProtection ?? 0) > 0) return false;
    // The phase-transition flash (plan §3.1). `isTargetable` already keeps every
    // picker off it; this is the backstop for anything already in flight.
    if ((enemy.bossInvulnerable ?? 0) > 0) return false;
    enemy.undamagedFor = 0;
    // Shielded: each charge absorbs a hit regardless of damage amount
    if (enemy.type === 'shielded' && (enemy.shieldCharges ?? 0) > 0) {
      enemy.shieldCharges = (enemy.shieldCharges ?? 0) - 1;
      enemy.shieldRegenTimer = ENEMY_BEHAVIOR.shieldRegenInterval;
      this.bus.emit('shield_break', { x: enemy.x, y: enemy.y });
      this.bus.emit('enemy_damaged', { enemy, amount: 0, killed: false, isCrit, blocked: true });
      return false;
    }
    // Bulwark: the boss's own absorb pool, spent before HP and before the ward.
    // Distinct from `absorbShield` on purpose — that one is *granted* by a
    // warden and dies with it, and the boss bar draws this one as its own
    // overlay (plan §3.2/§3.5).
    if ((enemy.bossShield ?? 0) > 0) {
      const soaked = Math.min(enemy.bossShield ?? 0, amount);
      enemy.bossShield = (enemy.bossShield ?? 0) - soaked;
      amount -= soaked;
      if ((enemy.bossShield ?? 0) <= 0) {
        // Broken. The clock stops for the rest of the phase — a broken bulwark
        // stays broken. Re-arming it would make the pattern a treadmill worth
        // several times the boss's own bar rather than the single DPS check
        // §3.2 describes; the sim puts that difference at ten wall-waves.
        enemy.bossShield = 0;
        enemy.bossShieldTimer = 0;
        this.bus.emit('boss_shield_broken', { enemy, x: enemy.x, y: enemy.y });
      }
      if (amount <= 0) {
        this.bus.emit('enemy_damaged', { enemy, amount: soaked, killed: false, isCrit, blocked: true });
        return false;
      }
    }
    // Warden ward: an absorb pool in front of HP. It soaks the hit rather than
    // negating it, so sustained fire still gets through — this is a tax on
    // ignoring the warden, not an immunity.
    if ((enemy.absorbShield ?? 0) > 0) {
      const absorbed = Math.min(enemy.absorbShield ?? 0, amount);
      enemy.absorbShield = (enemy.absorbShield ?? 0) - absorbed;
      amount -= absorbed;
      this.bus.emit('ward_absorbed', { x: enemy.x, y: enemy.y, amount: absorbed });
      if (amount <= 0) {
        this.bus.emit('enemy_damaged', { enemy, amount: 0, killed: false, isCrit, blocked: true });
        return false;
      }
    }
    enemy.hp -= amount;
    // Thorns aura: reflect fraction of damage back to tower (only if not blocked by shield)
    if (enemy.alive && enemy.aura === 'thorns' && enemy.elite) {
      this.computeThornsReflection(amount);
    }
    // Boss enrage: trigger once when HP drops below 50% of maxHP
    if (enemy.type === 'boss' && !enemy.enrageTriggered && enemy.hp / enemy.maxHp <= 0.5) {
      enemy.enrageTriggered = true;
      enemy.enraged = true;
      enemy.fireRate *= 1.5;
      enemy.speed *= 1.3;
      enemy.attackCooldown = Math.max(0, 1 / enemy.fireRate);
      this.bus.emit('boss_enraged', { enemy });
    }
    if (enemy.hp <= 0) {
      enemy.hp = 0;
      enemy.alive = false;
      // Retribution aura: on death, buff nearby enemies
      if (enemy.aura === 'retribution' && enemy.elite) {
        this.triggerRetribution(enemy);
      }
      // A loaded thief pays double for the interception — the whole reason to
      // drop everything and chase one (plan §2.1).
      if (enemy.type === 'thief' && (enemy.stolenGold ?? 0) > 0) {
        const recovered = Math.floor((enemy.stolenGold ?? 0) * ENEMY_BEHAVIOR.thiefRecoveryMult);
        enemy.stolenGold = 0;
        this.resources.addGold(recovered);
        this.bus.emit('gold_recovered', { x: enemy.x, y: enemy.y, amount: recovered });
      }
      if (enemy.type === 'warden') this.clearWardsFrom(enemy.id);
      this.bus.emit('enemy_damaged', { enemy, amount, killed: true, isCrit });
      this.bus.emit('enemy_killed', enemy);
      this.resources.addGold(this.computeGold(enemy, isCrit));
      const def = ENEMY_DEFS[enemy.type];
      // Plan §3.4: an elite always pays out research, so the player has a
      // concrete reason to want the aura on screen instead of merely surviving it.
      if (enemy.elite) {
        this.bus.emit('rp_dropped', { x: enemy.x, y: enemy.y, amount: ELITE_RP_DROP });
        if (this.researchTree) this.researchTree.addRP(ELITE_RP_DROP);
      }
      const chance = (def.rpChance ?? 0) + this.rpDropChanceBonus;
      if (chance > 0 && Math.random() < Math.min(1, chance)) {
        this.bus.emit('rp_dropped', { x: enemy.x, y: enemy.y, amount: 1 });
        if (this.researchTree) this.researchTree.addRP(1);
      }
      return true;
    }
    this.bus.emit('enemy_damaged', { enemy, amount, killed: false, isCrit });
    return false;
  }

  private computeGold(enemy: Enemy, isCrit: boolean = false): number {
    const base = enemy.goldValue;
    let amount = base * this.goldMultiplier;
    if (this.killStreakGoldBonus > 0) amount *= 1 + this.killStreakGoldBonus;
    if (this.manaFullGoldBonus > 0) amount *= 1 + this.manaFullGoldBonus;
    if (enemy.elite) amount *= ELITE_GOLD_MULT;
    if (enemy.aura === 'greed' && enemy.elite) amount *= GREED_GOLD_MULT;
    if (this.goldLuckChance > 0 && Math.random() < this.goldLuckChance) {
      amount *= this.goldLuckMultiplier;
    }
    if (this.doubleGoldChance > 0 && Math.random() < this.doubleGoldChance) {
      amount *= 2;
    }
    amount += this.goldOnKillBonus;
    if (isCrit && this.critGoldBonus > 0) {
      amount *= 1 + this.critGoldBonus;
    }
    return Math.max(1, Math.floor(amount));
  }

  projectileHit(proj: Projectile, enemy: Enemy, finalDamage: number): boolean {
    if (!proj.alive || !enemy.alive) return false;
    proj.alive = false;
    this.damage(enemy, finalDamage);
    return true;
  }

  applyKnockback(enemy: Enemy, force: number, fromX: number, fromY: number): void {
    if (force <= 0) return;
    // A blinker mid-teleport is not where the knockback is pushing (plan §2.1).
    if ((enemy.blinkImmunity ?? 0) > 0) return;
    const dx = enemy.x - fromX;
    const dy = enemy.y - fromY;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < 0.001) return;
    enemy.x += (dx / d) * force;
    enemy.y += (dy / d) * force;
    this.noteBossControlled(enemy);
  }

  /**
   * A boss that was shoved or slowed mid-telegraph lands a blunted slam
   * (plan §3.2).
   *
   * The flag is sticky for the duration of the telegraph: the answer is a
   * reaction inside a two-second window, so it has to count even if the control
   * has worn off by the time the slam actually lands.
   */
  private noteBossControlled(enemy: Enemy): void {
    if ((enemy.bossSlamTelegraph ?? 0) > 0) enemy.bossSlamMitigated = true;
  }

  applyShockwave(radius: number, fromX: number, fromY: number): void {
    if (radius <= 0) return;
    const r2 = radius * radius;
    // Fires once per shockwave cooldown, so a single O(n) pass is cheaper than
    // indexing for it.
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const dx = e.x - fromX;
      const dy = e.y - fromY;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const d = Math.sqrt(d2);
      if (d < 0.001) continue;
      e.x = fromX + (dx / d) * radius;
      e.y = fromY + (dy / d) * radius;
      this.noteBossControlled(e);
    }
    // Everything the ring touched has been shoved outwards.
    this.gridStale = true;
  }

  /**
   * One simulation substep for the whole field.
   *
   * Structure (gameplay plan §2.1/§2.2): shared timers first, then per enemy a
   * *stance* — the type's behaviour branch decides whether it advances, holds,
   * runs, or has already moved itself — and only then the shared
   * contact/melee/travel code. Keeping the decision and the movement separate is
   * what stops thirteen types turning back into thirteen copies of "walk at the
   * tower".
   *
   * Everything here is integrated on the simulation clock, so every cadence
   * (siege reload, blink interval, warden refresh, burrow surface, shield
   * regeneration) is correct at `dt = 1/120` and at 6.5x game speed alike.
   */
  tick(dt: number, towerX: number, towerY: number): void {
    this.lastTowerX = towerX;
    this.lastTowerY = towerY;
    if (this.slowTimer > 0) {
      this.slowTimer -= dt;
      if (this.slowTimer <= 0) this.slowFactor = 1;
    }

    // Frostbite chills age on the simulation clock, so a 1.5 s chill is 1.5 s
    // of game time at any speed setting.
    for (const [id, entry] of this.chilled) {
      entry.remaining -= dt;
      if (entry.remaining <= 0) this.chilled.delete(id);
    }

    // Tick knockback vulnerability timers
    for (const [id, remaining] of this.vulnerableEnemies) {
      const next = remaining - dt;
      if (next <= 0) this.vulnerableEnemies.delete(id);
      else this.vulnerableEnemies.set(id, next);
    }

    // Siege shells travel and land inside the same substep grid as everything
    // else, so a 1.2 s flight is 1.2 s of game time at any speed.
    this.tickHostileShots(dt);

    const newlyReached: Enemy[] = [];
    let totalDamage = 0;
    // Pre-compute haste aura multipliers (per-frame reset)
    const hasteMultipliers = this.computeHasteMultipliers();

    // Tick retribution buff timers
    this.tickRetributionBuffs(dt);

    let escaped = false;

    for (const e of this.enemies) {
      if (!e.alive) continue;

      // ── shared per-enemy timers ──
      e.undamagedFor = (e.undamagedFor ?? 0) + dt;
      if ((e.blinkImmunity ?? 0) > 0) e.blinkImmunity = Math.max(0, (e.blinkImmunity ?? 0) - dt);
      if (e.afterImageAge !== undefined) e.afterImageAge += dt;
      if ((e.spawnProtection ?? 0) > 0) e.spawnProtection = Math.max(0, (e.spawnProtection ?? 0) - dt);
      if ((e.scatterTimer ?? 0) > 0) e.scatterTimer = Math.max(0, (e.scatterTimer ?? 0) - dt);

      const dx = towerX - e.x;
      const dy = towerY - e.y;
      const d = Math.sqrt(dx * dx + dy * dy);

      let speedMult = (hasteMultipliers.get(e.id) ?? 1) * this.enrageSpeedMult * this.statSpeedMult;
      if (this.retributionBuffs.has(e.id)) speedMult *= RETRIBUTION_BUFF_SPEED_MULT;
      // Boss enrage (plan §3.3) is a live multiplier rather than a mutation of
      // `e.speed`, so it composes with the wave-level enrage instead of
      // compounding into it — and so it can be read straight off the boss bar.
      if ((e.bossEnrageStacks ?? 0) > 0) speedMult *= this.bossEnrageSpeedMult(e);
      const chill = this.chilled.get(e.id);
      if (e.burrowed === true) speedMult *= ENEMY_BEHAVIOR.burrowSpeedMult;
      const moveSpeed = e.speed * this.slowFactor * (chill ? chill.factor : 1) * speedMult;
      // Presentation only (UI plan §4.2): the renderer has the snapshot and no
      // route to the chill map, and "am I slowed" is already answered here.
      e.slowed = chill !== undefined || (this.slowTimer > 0 && this.slowFactor < 1);

      const stance = this.resolveStance(e, dt, d, dx, dy, towerX, towerY);
      if (stance === 'escaped') {
        escaped = true;
        continue;
      }

      // A splitter child spends its first moments running *away* from where its
      // parent died, so the same AoE that killed the parent does not delete the
      // children in the same instant (plan §2.2).
      if ((e.scatterTimer ?? 0) > 0) {
        e.attacking = false;
        const scatter = moveSpeed * ENEMY_BEHAVIOR.splitterScatterSpeedMult * dt;
        e.x += (e.scatterVx ?? 0) * scatter;
        e.y += (e.scatterVy ?? 0) * scatter;
      } else if (stance === 'retreat') {
        e.attacking = false;
        const flee = this.fleeDirection(e);
        const fleeMult = e.type === 'thief'
          ? ENEMY_BEHAVIOR.thiefFleeSpeedMult
          : ENEMY_BEHAVIOR.healerFleeSpeedMult;
        e.x += flee.x * moveSpeed * fleeMult * dt;
        e.y += flee.y * moveSpeed * fleeMult * dt;
      } else if (stance === 'hold') {
        e.attacking = false;
      } else {
        const contact = this.contactRadius(e);
        if (d <= contact) {
          if (d > 0) {
            const ratio = contact / d;
            e.x = towerX - dx * ratio;
            e.y = towerY - dy * ratio;
          }

          // A thief never gets to melee: it grabs what it came for and runs.
          if (e.type === 'thief' && (e.stolenGold ?? 0) <= 0) {
            this.stealFrom(e);
            continue;
          }

          if (!e.attacking) {
            e.attacking = true;
            e.attackCooldown = 1 / e.fireRate;
            newlyReached.push(e);
          }

          e.attackCooldown -= dt;
          if (e.attackCooldown <= 0) {
            this.bus.emit('enemy_attack', { x: e.x, y: e.y, type: e.type });
            let dmgMult = this.damageToTowerMult * this.enrageDamageMult * this.statDamageMult;
            if (this.retributionBuffs.has(e.id)) dmgMult *= RETRIBUTION_BUFF_DAMAGE_MULT;
            if ((e.bossEnrageStacks ?? 0) > 0) dmgMult *= this.bossEnrageDamageMult(e);
            totalDamage += e.damage * dmgMult;
            if (this.thorns > 0) {
              const thornDmg = Math.floor(e.damage * this.thorns);
              if (thornDmg > 0) this.damage(e, thornDmg, false);
            }
            e.attackCooldown += 1 / e.fireRate;
          }
        } else {
          e.attacking = false;
          const inv = moveSpeed * dt / d;
          e.x += dx * inv;
          e.y += dy * inv;
        }
      }

      // Healer AI: every healCooldown seconds, find lowest-HP non-healer ally
      // within healRange and restore healFraction of its maxHP. A wounded
      // healer keeps healing *while* it runs (plan §2.2) — that is what makes
      // it worth chasing rather than ignoring.
      if (e.type === 'healer' && (e.healCooldown ?? 0) > 0) {
        e.healCooldown = (e.healCooldown ?? 0) - dt;
        if (e.healCooldown <= 0) {
          const def = ENEMY_DEFS.healer;
          const range = def.healRange ?? 150;
          const fraction = def.healFraction ?? 0.15;
          const cooldownReset = def.healCooldown ?? 2.5;
          // Find lowest-HP non-healer alive ally in range
          let target: Enemy | null = null;
          let lowestRatio = 1;
          // Direct scan: healers are few, so this is O(healers x n).
          for (const other of this.enemies) {
            if (!other.alive) continue;
            if (other.id === e.id) continue;
            if (other.type === 'healer') continue;
            if (other.hp >= other.maxHp) continue;
            const ddx = other.x - e.x;
            const ddy = other.y - e.y;
            if (ddx * ddx + ddy * ddy > range * range) continue;
            const r = other.hp / other.maxHp;
            if (r < lowestRatio) {
              lowestRatio = r;
              target = other;
            }
          }
          if (target) {
            const heal = Math.max(1, Math.floor(target.maxHp * fraction));
            target.hp = Math.min(target.maxHp, target.hp + heal);
            this.bus.emit('enemy_healed', { healer: e, target, amount: heal });
            e.healCooldown = cooldownReset;
          } else {
            // Don't fully reset: small partial decay so healer still has cadence
            e.healCooldown = 0.5;
          }
        }
      }
    }

    if (newlyReached.length > 0) {
      this.bus.emit('enemies_reached_tower', newlyReached);
    }
    if (totalDamage > 0) {
      this.bus.emit('tower_damaged', totalDamage);
    }
    if (escaped) {
      // A thief that got away is not a kill, so nothing above filtered it out.
      this.enemies = this.enemies.filter(e => e.alive);
    }

    // Process vitality aura (heal nearby enemies). Deliberately reuses the
    // index built at the top of the tick rather than forcing a second rebuild:
    // one step of movement is ~2 px at a normal enemy's speed, against a 180 px
    // aura radius, and a rebuild costs more than that error is worth.
    this.processVitalityAura(dt);

    // Sync retribution timers to enemy objects for renderer
    for (const e of this.enemies) {
      e.retributionTimer = this.retributionBuffs.get(e.id) ?? 0;
    }

    this.enemies = this.enemies.filter(e => {
      // Chills are keyed by enemy id, so a dead enemy's entry has to go with
      // it — ids are monotonic, so a stale key would never be reused, but the
      // map would still grow for the lifetime of the run.
      if (!e.alive && this.chilled.size > 0) this.chilled.delete(e.id);
      return e.alive;
    });
    // Everything has moved and the dead are gone: the position index that
    // `Game`'s mine, splash and chain-kill queries use is now stale. Rebuilt
    // lazily by the next `queryRadius`, so a frame with none of those pays
    // nothing (plan §5.4).
    this.gridStale = true;
  }

  /**
   * What this enemy wants to do this substep, and the type's own behaviour.
   *
   * An exhaustive switch with a `never` default (cross-cutting rule 3): a new
   * `EnemyType` cannot reach the field without someone deciding what it does.
   * Side effects live here — reloading, blinking, warding, surfacing — because
   * they are the behaviour; the caller only owns the movement that follows.
   */
  private resolveStance(
    e: Enemy,
    dt: number,
    d: number,
    dx: number,
    dy: number,
    towerX: number,
    towerY: number,
  ): EnemyStance {
    switch (e.type) {
      case 'normal':
      case 'fast':
      case 'tank':
      case 'flying':
      case 'splitter':
        return 'advance';

      // Three phases, one pattern each, and a clock that punishes a stalemate.
      // The whole machine lives in `tickBoss` (plan §3).
      case 'boss':
        return this.tickBoss(e, dt);

      case 'shielded':
        this.tickShieldRegen(e, dt);
        return 'advance';

      // Below 40% it turns and runs, still healing as it goes: the one enemy
      // whose *reward* for surviving is undoing your work now punishes you for
      // treating it as a background number (plan §2.2).
      case 'healer': {
        const wounded = e.maxHp > 0 && e.hp / e.maxHp < ENEMY_BEHAVIOR.healerFleeThreshold;
        e.fleeing = wounded;
        return wounded ? 'retreat' : 'advance';
      }

      // Halts outside a short build's range and shells the tower on a fixed
      // reload. Knockback and slow do nothing useful against it; range and
      // target priority are the answer (plan §2.1).
      case 'siege': {
        const reload = ENEMY_BEHAVIOR.siegeReload;
        if (d > ENEMY_BEHAVIOR.siegeStandoff) {
          e.siegeHalted = false;
          // Clamped at zero rather than left to go negative during a long
          // approach, so arriving in range fires one shell, never a stockpile.
          e.siegeCooldown = Math.max(0, (e.siegeCooldown ?? reload) - dt);
          return 'advance';
        }
        e.siegeHalted = true;
        e.siegeCooldown = (e.siegeCooldown ?? reload) - dt;
        while (e.siegeCooldown <= 0) {
          this.fireSiegeShell(e, towerX, towerY);
          e.siegeCooldown += reload;
        }
        return 'hold';
      }

      // Beelines, lifts a cut of the treasury on contact, then runs for the
      // nearest edge. Killing it is the only way to get the gold back — and it
      // pays double for the trouble (plan §2.1).
      case 'thief': {
        if ((e.stolenGold ?? 0) <= 0) return 'advance';
        if (this.hasLeftTheField(e)) {
          this.escapeWithLoot(e);
          return 'escaped';
        }
        return 'retreat';
      }

      // Teleports past whatever you built to keep things at arm's length.
      // Knockback, mines and the wall band all read the position it is no
      // longer at (plan §2.1).
      case 'blinker': {
        e.blinkTimer = (e.blinkTimer ?? ENEMY_BEHAVIOR.blinkInterval) - dt;
        if (e.blinkTimer > 0) return 'advance';
        e.blinkTimer += ENEMY_BEHAVIOR.blinkInterval;
        e.blinkImmunity = ENEMY_BEHAVIOR.blinkImmunity;
        const contact = this.contactRadius(e);
        const step = d > 0 ? Math.min(ENEMY_BEHAVIOR.blinkDistance, Math.max(0, d - contact)) : 0;
        if (step > 0) {
          e.afterImageX = e.x;
          e.afterImageY = e.y;
          e.afterImageAge = 0;
          e.x += (dx / d) * step;
          e.y += (dy / d) * step;
          // It moved, so the index every radius query reads is stale now — not
          // only at the end of the tick, because a mine detonation triggered by
          // this substep would otherwise test the position it left.
          this.gridStale = true;
          this.bus.emit('enemy_blinked', { x: e.afterImageX, y: e.afterImageY, toX: e.x, toY: e.y });
        }
        return 'hold';
      }

      // Hands out a regenerating absorb pool to the enemies around it. Nothing
      // about your damage answers this; only shooting the warden first does
      // (plan §2.1).
      case 'warden': {
        e.wardTimer = (e.wardTimer ?? 0) - dt;
        if (e.wardTimer <= 0) {
          e.wardTimer += ENEMY_BEHAVIOR.wardRefresh;
          this.projectWard(e);
        }
        return 'advance';
      }

      // Crosses the whole approach corridor underground, where range cannot
      // reach it, and comes up inside your close defences (plan §2.1).
      case 'burrower': {
        if (e.burrowed === true) {
          if (d > ENEMY_BEHAVIOR.burrowSurfaceDistance) return 'advance';
          e.burrowed = false;
          e.surfacing = ENEMY_BEHAVIOR.burrowTelegraph;
          this.bus.emit('burrower_surfaced', { x: e.x, y: e.y });
          return 'hold';
        }
        if ((e.surfacing ?? 0) > 0) {
          e.surfacing = Math.max(0, (e.surfacing ?? 0) - dt);
          return 'hold';
        }
        return 'advance';
      }

      default: {
        const exhaustive: never = e.type;
        return exhaustive;
      }
    }
  }

  // ── Boss encounters (gameplay plan §3) ───────────────────────────────────
  //
  // Everything below is integrated on the simulation clock inside
  // `Game.simulate`'s fixed substeps. That is not an implementation detail: a
  // 2 s slam telegraph the player cannot read at 6.5x speed is not a telegraph,
  // and a phase that fires twice because one frame crossed a threshold in two
  // substeps is a boss that flashes invulnerable for no reason.

  /** Damage multiplier from this boss's own enrage stacks. */
  private bossEnrageDamageMult(e: Enemy): number {
    return 1 + (e.bossEnrageStacks ?? 0) * BOSS_ENCOUNTER.enrageDamagePerStack;
  }

  /** Speed multiplier from this boss's own enrage stacks. */
  private bossEnrageSpeedMult(e: Enemy): number {
    return 1 + (e.bossEnrageStacks ?? 0) * BOSS_ENCOUNTER.enrageSpeedPerStack;
  }

  /**
   * One substep of a boss: clock, phase crossings, then the active pattern.
   *
   * The crossing loop is the part that has to be right. `bossPhase` only ever
   * *increases* and the target phase is recomputed from HP every substep, so:
   * crossing 66% in one substep and sitting just above it in the next (a
   * bulwark heal, a vitality aura) cannot re-fire the transition, and a hit big
   * enough to skip a whole phase still runs both crossings in order rather than
   * silently swallowing one.
   */
  private tickBoss(e: Enemy, dt: number): EnemyStance {
    e.bossElapsed = (e.bossElapsed ?? 0) + dt;
    const stacks = bossEnrageStacksFor(e.bossElapsed);
    if (stacks !== (e.bossEnrageStacks ?? 0)) {
      e.bossEnrageStacks = stacks;
      this.bus.emit('boss_enrage_stack', { enemy: e, stacks, x: e.x, y: e.y });
    }

    const target = bossPhaseForHpFraction(e.maxHp > 0 ? e.hp / e.maxHp : 1);
    while ((e.bossPhase ?? 1) < target) {
      e.bossPhase = (e.bossPhase ?? 1) + 1;
      this.enterBossPhase(e);
    }

    // The flash: untargetable via `isTargetable`, and doing nothing itself.
    if ((e.bossInvulnerable ?? 0) > 0) {
      e.bossInvulnerable = Math.max(0, (e.bossInvulnerable ?? 0) - dt);
      return 'hold';
    }

    return this.tickBossPattern(e, dt);
  }

  /** Switch pattern, flash invulnerable, and tell everyone about it. */
  private enterBossPhase(e: Enemy): void {
    const phase = e.bossPhase ?? 1;
    const pattern = bossPatternForPhase(bossTierForWave(e.spawnWave ?? this.currentWave), phase);
    e.bossPattern = pattern;
    e.bossInvulnerable = BOSS_ENCOUNTER.phaseInvulnerability;
    this.armBossPattern(e, pattern);
    this.bus.emit('boss_phase', { enemy: e, phase, pattern, x: e.x, y: e.y });
  }

  /**
   * Clear the last phase's timers and start the new pattern's.
   *
   * An exhaustive switch with a `never` default (cross-cutting rule 3): a
   * pattern added to `BossPattern` and never armed here is a compile error.
   */
  private armBossPattern(e: Enemy, pattern: BossPattern): void {
    e.bossShield = 0;
    e.bossShieldMax = 0;
    e.bossShieldTimer = 0;
    e.bossSummonTimer = 0;
    e.bossSlamTimer = 0;
    e.bossSlamTelegraph = 0;
    e.bossSlamMitigated = false;
    switch (pattern) {
      case 'bulwark':
        this.armBulwark(e);
        return;
      case 'summon':
        // The first batch lands on the beat, not on entry — a phase change is
        // already a lot to read without four adds appearing inside it.
        e.bossSummonTimer = BOSS_ENCOUNTER.summonInterval;
        return;
      case 'slam':
        // Staggered across the pack: `bossCountForWave` bosses telegraphing in
        // lockstep is one enormous unanswerable hit rather than a rhythm.
        e.bossSlamTimer = BOSS_ENCOUNTER.slamInterval * (0.35 + Math.random() * 0.5);
        return;
      case 'siphon':
        // Nothing to arm — it drains continuously for the whole phase.
        return;
      default: {
        const exhaustive: never = pattern;
        return exhaustive;
      }
    }
  }

  /** Put a fresh bulwark shield up and start its 10 s window. */
  private armBulwark(e: Enemy): void {
    const amount = Math.max(1, Math.floor(e.maxHp * BOSS_ENCOUNTER.bulwarkShieldFraction));
    e.bossShield = amount;
    e.bossShieldMax = amount;
    e.bossShieldTimer = BOSS_ENCOUNTER.bulwarkWindow;
    this.bus.emit('boss_shield_up', { enemy: e, x: e.x, y: e.y, amount });
  }

  /**
   * Run the active pattern for one substep and say what the boss does with its
   * feet. Exhaustive over `BossPattern` with a `never` default.
   */
  private tickBossPattern(e: Enemy, dt: number): EnemyStance {
    const pattern = e.bossPattern;
    if (pattern === undefined) return 'advance';
    switch (pattern) {
      // A DPS check on a ten-second clock. Break it and it is gone for the
      // phase; miss the window and the boss converts the whole shield into HP
      // and puts a fresh one up — so failing the check costs the attempt twice.
      case 'bulwark': {
        // A zero timer means the shield was already broken this phase. There is
        // nothing left to count down to.
        if ((e.bossShieldTimer ?? 0) <= 0) return 'advance';
        e.bossShieldTimer = (e.bossShieldTimer ?? 0) - dt;
        if ((e.bossShieldTimer ?? 0) > 0) return 'advance';
        const healed = Math.min(e.maxHp - e.hp, e.bossShieldMax ?? 0);
        if (healed > 0) e.hp += healed;
        this.bus.emit('boss_bulwark_held', {
          enemy: e,
          x: e.x,
          y: e.y,
          amount: Math.floor(healed),
        });
        this.armBulwark(e);
        return 'advance';
      }

      // Adds on a fixed beat. `while` rather than `if` so a long substep under
      // the frame-hitch clamp still owes exactly the right number of batches.
      case 'summon': {
        e.bossSummonTimer = (e.bossSummonTimer ?? 0) - dt;
        while ((e.bossSummonTimer ?? 0) <= 0) {
          e.bossSummonTimer = (e.bossSummonTimer ?? 0) + BOSS_ENCOUNTER.summonInterval;
          this.summonAdds(e);
        }
        return 'advance';
      }

      // The first thing in the game the player has to *react* to inside a
      // window. Slowing or shoving the boss during the telegraph cuts the hit
      // to a fifth; ignoring it costs eight times a boss melee.
      case 'slam': {
        if ((e.bossSlamTelegraph ?? 0) > 0) {
          if (this.isSlowed(e)) e.bossSlamMitigated = true;
          const next = (e.bossSlamTelegraph ?? 0) - dt;
          e.bossSlamTelegraph = Math.max(0, next);
          if (next > 0) return 'hold';
          this.landSlam(e);
          e.bossSlamTimer = Math.max(0, BOSS_ENCOUNTER.slamInterval - BOSS_ENCOUNTER.slamTelegraph);
          return 'hold';
        }
        e.bossSlamTimer = (e.bossSlamTimer ?? 0) - dt;
        if ((e.bossSlamTimer ?? 0) > 0) return 'advance';
        e.bossSlamTimer = 0;
        e.bossSlamTelegraph = BOSS_ENCOUNTER.slamTelegraph;
        e.bossSlamMitigated = this.isSlowed(e);
        this.bus.emit('boss_slam_telegraph', {
          enemy: e,
          x: e.x,
          y: e.y,
          duration: BOSS_ENCOUNTER.slamTelegraph,
        });
        return 'hold';
      }

      // Economy pressure: it takes mana the player was hoarding and turns it
      // into boss HP, so the answer is to have already spent it. Deliberately
      // silent per substep — the drain is drawn from state, not from six events
      // a frame.
      case 'siphon': {
        const drained = Math.min(BOSS_ENCOUNTER.siphonManaPerSecond * dt, this.resources.mana);
        if (drained > 0) {
          this.resources.spendMana(drained);
          // Seconds' worth of *full* drain this substep actually got, so an
          // empty mana pool feeds the boss nothing at all.
          const fed = drained / BOSS_ENCOUNTER.siphonManaPerSecond;
          e.hp = Math.min(e.maxHp, e.hp + fed * e.maxHp * BOSS_ENCOUNTER.siphonHealFractionPerSecond);
        }
        return 'advance';
      }

      default: {
        const exhaustive: never = pattern;
        return exhaustive;
      }
    }
  }

  /** Deliver a slam through the one mitigation chain every other hit uses. */
  private landSlam(e: Enemy): void {
    const mult = this.damageToTowerMult
      * this.enrageDamageMult
      * this.statDamageMult
      * this.bossEnrageDamageMult(e);
    const mitigated = e.bossSlamMitigated === true;
    let damage = e.damage * BOSS_ENCOUNTER.slamDamageMult * mult;
    if (mitigated) damage *= BOSS_ENCOUNTER.slamMitigatedFraction;
    e.bossSlamMitigated = false;
    this.bus.emit('boss_slam', { enemy: e, x: e.x, y: e.y, damage, mitigated });
    // Same entry point as a melee hit and a siege shell: dodge, research DR,
    // mana shield, wall, shield charges, armour, defense — in that order, once.
    this.bus.emit('tower_damaged', damage);
  }

  /**
   * Spawn one boss's share of a summon batch around it.
   *
   * The adds are drawn from the wave's own spawn pool at the wave's own HP
   * curve, so a summon phase is *more of this wave*, not a second difficulty
   * dial. They are extra to `enemiesToSpawn`, so the wave cannot end until they
   * are dead — which is the point of the pattern.
   */
  private summonAdds(boss: Enemy): void {
    if (this.aliveCount() >= BOSS_ENCOUNTER.summonMaxAlive) return;
    const wave = boss.spawnWave ?? this.currentWave;
    const pool = spawnPoolForWave(wave).filter(p => p.type !== 'boss');
    if (pool.length === 0) return;
    let total = 0;
    for (const p of pool) total += p.weight;
    if (total <= 0) return;

    const count = bossSummonCountForWave(wave);
    const bossRadius = ENEMY_DEFS.boss.radius;
    let spawned = 0;
    for (let i = 0; i < count; i++) {
      if (this.aliveCount() >= BOSS_ENCOUNTER.summonMaxAlive) break;
      let r = Math.random() * total;
      let type = pool[0].type;
      for (const p of pool) {
        r -= p.weight;
        if (r <= 0) {
          type = p.type;
          break;
        }
      }
      const angle = Math.random() * Math.PI * 2;
      const dist = bossRadius + world(24) + Math.random() * world(26);
      this.spawn(type, wave, boss.x + Math.cos(angle) * dist, boss.y + Math.sin(angle) * dist);
      spawned += 1;
    }
    if (spawned > 0) {
      this.bus.emit('boss_summon', { enemy: boss, x: boss.x, y: boss.y, count: spawned });
    }
  }

  /** Bosses still standing. `Game` resolves the encounter when this hits zero. */
  bossAliveCount(): number {
    let c = 0;
    for (const e of this.enemies) if (e.alive && e.type === 'boss') c += 1;
    return c;
  }

  /**
   * The boss the bar should track.
   *
   * A boss wave spawns `2 + tier` of them, so the bar has to pick one, and the
   * rule is "whichever one is asking the player for something right now":
   *
   * 1. A boss mid-slam-telegraph, soonest to land first. This is the only thing
   *    in the encounter with a deadline, and it was the whole point of §3.5 —
   *    an eight-boss pack where the countdown belongs to a boss the bar is not
   *    watching is a telegraph the player never sees.
   * 2. Otherwise the one closest to dying: the next to phase, and in practice
   *    the most stable choice, since a focused target stays lowest until it
   *    dies.
   */
  leadBoss(): Enemy | null {
    let slamming: Enemy | null = null;
    let slamRemaining = Infinity;
    let lowest: Enemy | null = null;
    let lowestRatio = Infinity;
    for (const e of this.enemies) {
      if (!e.alive || e.type !== 'boss') continue;
      const telegraph = e.bossSlamTelegraph ?? 0;
      if (telegraph > 0 && telegraph < slamRemaining) {
        slamRemaining = telegraph;
        slamming = e;
      }
      const ratio = e.maxHp > 0 ? e.hp / e.maxHp : 1;
      if (ratio < lowestRatio || (ratio === lowestRatio && lowest !== null && e.id < lowest.id)) {
        lowestRatio = ratio;
        lowest = e;
      }
    }
    return slamming ?? lowest;
  }

  /** Contact radius, wall band included unless the type walks through it. */
  private contactRadius(e: Enemy): number {
    const extra = ignoresWallBand(e) ? 0 : this.wallContactExtra;
    return TOWER_HIT_RADIUS + ENEMY_DEFS[e.type].radius + ENEMY_GAP + extra;
  }

  /** Unit vector a fleeing enemy runs along: thieves make for the nearest edge. */
  private fleeDirection(e: Enemy): { x: number; y: number } {
    if (e.type !== 'thief') {
      // A wounded healer simply backs away from what is hurting it.
      const dx = e.x - this.lastTowerX;
      const dy = e.y - this.lastTowerY;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < 0.001) return { x: 1, y: 0 };
      return { x: dx / d, y: dy / d };
    }
    const left = e.x;
    const right = this.boundsWidth - e.x;
    const top = e.y;
    const bottom = this.boundsHeight - e.y;
    const min = Math.min(left, right, top, bottom);
    if (min === left) return { x: -1, y: 0 };
    if (min === right) return { x: 1, y: 0 };
    if (min === top) return { x: 0, y: -1 };
    return { x: 0, y: 1 };
  }

  /** True once a fleeing enemy has cleared the play field entirely. */
  private hasLeftTheField(e: Enemy): boolean {
    return e.x < -ESCAPE_MARGIN
      || e.x > this.boundsWidth + ESCAPE_MARGIN
      || e.y < -ESCAPE_MARGIN
      || e.y > this.boundsHeight + ESCAPE_MARGIN;
  }

  /**
   * A thief on contact: take the smaller of 6% of *current* gold and 30x a
   * normal kill at this wave, bounded by what is left of the wave's 15% ceiling
   * (plan §2.6).
   *
   * Stealing from current gold rather than lifetime or income is the safety
   * valve: a player who spends what they earn has nothing worth taking, so the
   * thief can annoy but never bankrupt.
   */
  private stealFrom(thief: Enemy): void {
    const current = this.resources.gold;
    if (current <= 0) {
      // Nothing to take — it leaves anyway, which reads better than a thief
      // standing at the wall forever.
      thief.stolenGold = 0;
      thief.fleeing = true;
      thief.attacking = false;
      this.bus.emit('toast', {
        kind: 'info',
        text: 'A thief found the vault empty and fled.',
        life: 3,
      });
      thief.alive = false;
      return;
    }
    const waveGold = goldDropForWave(ENEMY_DEFS.normal.baseGold, thief.spawnWave ?? this.currentWave);
    const budget = Math.max(0, current * ENEMY_BEHAVIOR.thiefWaveTheftCap - this.theftThisWave);
    const amount = Math.floor(Math.min(
      current * ENEMY_BEHAVIOR.thiefStealFraction,
      waveGold * ENEMY_BEHAVIOR.thiefStealWaveGoldMult,
      budget,
    ));
    if (amount <= 0) {
      thief.alive = false;
      return;
    }
    this.resources.spendGold(amount);
    this.theftThisWave += amount;
    thief.stolenGold = amount;
    thief.fleeing = true;
    thief.attacking = false;
    this.bus.emit('gold_stolen', { x: thief.x, y: thief.y, amount });
  }

  /** The thief made it off the map: the gold is gone for good. */
  private escapeWithLoot(thief: Enemy): void {
    const amount = thief.stolenGold ?? 0;
    thief.alive = false;
    thief.stolenGold = 0;
    this.gridStale = true;
    this.bus.emit('gold_escaped', { x: thief.x, y: thief.y, amount });
  }

  /** Shielded: rebuild one charge every 6 s, but only after 3 s of quiet. */
  private tickShieldRegen(e: Enemy, dt: number): void {
    const max = ENEMY_DEFS.shielded.shieldCharges ?? 3;
    if ((e.shieldCharges ?? 0) >= max) return;
    if ((e.undamagedFor ?? 0) < ENEMY_BEHAVIOR.shieldCalmBeforeRegen) {
      e.shieldRegenTimer = ENEMY_BEHAVIOR.shieldRegenInterval;
      return;
    }
    e.shieldRegenTimer = (e.shieldRegenTimer ?? ENEMY_BEHAVIOR.shieldRegenInterval) - dt;
    if (e.shieldRegenTimer > 0) return;
    e.shieldRegenTimer = ENEMY_BEHAVIOR.shieldRegenInterval;
    e.shieldCharges = Math.min(max, (e.shieldCharges ?? 0) + 1);
    this.bus.emit('shield_restored', { x: e.x, y: e.y });
  }

  /**
   * Warden: refresh an absorb pool on up to five nearby allies.
   *
   * The pool is *set*, never added to, so standing next to two wardens is no
   * better than standing next to one — the answer stays "kill the warden", not
   * "out-damage the stack".
   *
   * A direct scan for the same reason the aura passes are: the outer loop is
   * over wardens, of which a wave holds a handful.
   */
  private projectWard(warden: Enemy): void {
    const amount = Math.max(1, Math.floor(warden.maxHp * ENEMY_BEHAVIOR.wardShieldFraction));
    const r2 = ENEMY_BEHAVIOR.wardRange * ENEMY_BEHAVIOR.wardRange;
    let granted = 0;
    for (const other of this.enemies) {
      if (granted >= ENEMY_BEHAVIOR.wardMaxTargets) break;
      if (!other.alive || other.id === warden.id) continue;
      // Wardens do not shield each other: a pair would otherwise be far more
      // than twice the problem of one.
      if (other.type === 'warden') continue;
      if (other.burrowed === true) continue;
      const dx = other.x - warden.x;
      const dy = other.y - warden.y;
      if (dx * dx + dy * dy > r2) continue;
      other.absorbShield = amount;
      other.absorbMax = amount;
      other.wardenId = warden.id;
      granted += 1;
    }
    if (granted > 0) {
      this.bus.emit('ward_projected', { x: warden.x, y: warden.y, count: granted, amount });
    }
  }

  /** The warden is dead: every pool it was maintaining collapses with it. */
  private clearWardsFrom(wardenId: number): void {
    for (const other of this.enemies) {
      if (other.wardenId !== wardenId) continue;
      other.wardenId = undefined;
      other.absorbShield = 0;
      other.absorbMax = 0;
    }
  }

  /** Launch one siege shell on a fixed 1.2 s fuse. */
  private fireSiegeShell(e: Enemy, towerX: number, towerY: number): void {
    const travel = ENEMY_BEHAVIOR.siegeShellTravel;
    // The enemy damage channels are applied at launch, so a shell in the air
    // carries the multipliers that were live when it was fired — which is what
    // the arc telegraph is promising the player.
    const mult = this.damageToTowerMult * this.enrageDamageMult * this.statDamageMult;
    const damage = e.damage * ENEMY_BEHAVIOR.siegeShellDamageMult * mult;
    if (this.hostileShots.length >= MAX_HOSTILE_SHOTS) this.hostileShots.shift();
    this.hostileShots.push({
      id: nextId(),
      x: e.x,
      y: e.y,
      originX: e.x,
      originY: e.y,
      vx: (towerX - e.x) / travel,
      vy: (towerY - e.y) / travel,
      damage,
      remaining: travel,
      travel,
      alive: true,
    });
    this.bus.emit('siege_fired', { x: e.x, y: e.y });
  }

  /**
   * Advance every shell and deliver the ones that land.
   *
   * Landing emits `tower_damaged`, deliberately: that is the single entry point
   * for the whole mitigation chain — dodge, research DR, the mana-shield
   * evolution, the wall, shield charges, armour, defense and the mana-shield
   * talent — so a siege shell is mitigated by exactly what a melee hit is,
   * with no second copy of any of it (plan §2.1).
   */
  private tickHostileShots(dt: number): void {
    if (this.hostileShots.length === 0) return;
    let landed = 0;
    let anyLanded = false;
    for (const s of this.hostileShots) {
      if (!s.alive) continue;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.remaining -= dt;
      if (s.remaining > 0) continue;
      s.alive = false;
      anyLanded = true;
      landed += s.damage;
      this.bus.emit('siege_impact', { x: s.x, y: s.y });
    }
    if (landed > 0) this.bus.emit('tower_damaged', landed);
    if (anyLanded) this.hostileShots = this.hostileShots.filter(s => s.alive);
  }


  findById(id: number): Enemy | null {
    for (const e of this.enemies) {
      if (e.id === id) return e;
    }
    return null;
  }

  reset(): void {
    this.enemies = [];
    this.hostileShots = [];
    this.theftThisWave = 0;
    this.grid.clear();
    this.gridStale = true;
    this.slowFactor = 1;
    this.slowTimer = 0;
    this.goldLuckChance = 0;
    this.goldLuckMultiplier = 1;
    this.goldMultiplier = 1;
    this.doubleGoldChance = 0;
    this.vulnerableEnemies.clear();
    this.killStreakGoldBonus = 0;
    this.manaFullGoldBonus = 0;
    this.rpDropChanceBonus = 0;
    this.goldOnKillBonus = 0;
    this.critGoldBonus = 0;
    this.speedMult = 1;
    this.damageToTowerMult = 1;
    this.enrageDamageMult = 1;
    this.enrageSpeedMult = 1;
    this.hpMult = 1;
    this.retributionBuffs.clear();
    this.chilled.clear();
    // The blessing channels are *not* reset here: `reset()` runs on every wave
    // rewind and enemy wipe, while blessings survive until the run ends.
    // `Game.applyResolvedStats` is their only writer, and it rewrites them on
    // the next recompute regardless.
  }

  /**
   * Spawn a splitter child at given location (used for split-on-death).
   */
  /**
   * Spawn a splitter child (plan §2.2).
   *
   * `scatterAngle` sends it outwards for a beat under spawn protection, so the
   * AoE that killed the parent cannot delete both children in the same instant.
   * A split is meant to be a small burst the player has to answer, not two more
   * bars appearing inside an explosion that is already over.
   */
  spawnSplitterChild(parent: Enemy, wave: number, x: number, y: number, scatterAngle?: number): Enemy {
    const def = ENEMY_DEFS.splitter;
    const childHp = Math.max(1, Math.floor(parent.maxHp * (def.splitHpFraction ?? 0.5)));
    const childSpeed = parent.speed * (def.splitSpeedMultiplier ?? 1.4);
    const childGold = Math.max(1, Math.floor(parent.goldValue * 0.5));
    const childDamage = Math.max(1, Math.floor(parent.damage * 0.7));
    const angle = scatterAngle ?? Math.random() * Math.PI * 2;
    return this.spawn('splitter', wave, x, y, {
      hp: childHp,
      maxHp: childHp,
      speed: childSpeed,
      goldValue: childGold,
      damage: childDamage,
      isSplitChild: true,
      elite: false,
      aura: null,
      spawnProtection: ENEMY_BEHAVIOR.splitterSpawnProtection,
      scatterTimer: ENEMY_BEHAVIOR.splitterScatterTime,
      scatterVx: Math.cos(angle),
      scatterVy: Math.sin(angle),
    });
  }

  /** Re-index positions if anything has moved or the roster has changed. */
  private ensureGrid(): void {
    if (!this.gridStale) return;
    this.grid.rebuild(this.enemies);
    this.gridStale = false;
  }

  /**
   * Living enemies within `radius` of a point (plan §5.4).
   *
   * Returns a fresh array by default. Pass `out` to reuse a buffer, but only
   * where re-entrancy is impossible: most callers damage what they find, and
   * `damage` emits `enemy_killed` / `enemy_damaged`, whose handlers query
   * again — a shared buffer would be cleared and refilled underneath the loop
   * that is still walking it, silently skipping enemies.
   */
  queryRadius(x: number, y: number, radius: number, out?: Enemy[]): Enemy[] {
    this.ensureGrid();
    const target = out ?? [];
    target.length = 0;
    return this.grid.query(x, y, radius, target);
  }

  aliveCount(): number {
    let c = 0;
    for (const e of this.enemies) if (e.alive) c++;
    return c;
  }

  furthestDistanceTo(towerX: number, towerY: number): number {
    let best = -1;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d2 = distance2(e.x, e.y, towerX, towerY);
      if (d2 > best) best = d2;
    }
    return best;
  }

  /**
   * Compute haste aura multipliers for all enemies.
   * Enemies near a haste elite get +50% speed.
   */
  private computeHasteMultipliers(): Map<number, number> {
    const result = new Map<number, number>();
    const r2 = AURA_RADIUS * AURA_RADIUS;
    // Deliberately a direct scan, not a `queryRadius` call. The outer loop is
    // over *aura elites* (a handful), not over every enemy, so this is
    // O(elites x n) rather than the O(n^2) the plan assumed — and measured
    // against the spatial grid at 64-420 enemies, the grid is 1.6-4x slower
    // here, because one O(n) index rebuild costs more than the few thousand
    // cheap distance tests it saves. See docs/performance.md.
    for (const e of this.enemies) {
      if (!e.alive || e.aura !== 'haste' || !e.elite) continue;
      for (const other of this.enemies) {
        if (!other.alive || other.id === e.id) continue;
        const dx = other.x - e.x;
        const dy = other.y - e.y;
        if (dx * dx + dy * dy <= r2) {
          const existing = result.get(other.id) ?? 1;
          result.set(other.id, existing * (1 + HASTE_SPEED_BONUS));
        }
      }
    }
    return result;
  }

  /**
   * Process vitality aura: elite heals nearby enemies for 1% maxHP/s.
   */
  private processVitalityAura(dt: number): void {
    const r2 = AURA_RADIUS * AURA_RADIUS;
    // Direct scan for the same reason as `computeHasteMultipliers`.
    for (const e of this.enemies) {
      if (!e.alive || e.aura !== 'vitality' || !e.elite) continue;
      for (const other of this.enemies) {
        if (!other.alive || other.id === e.id) continue;
        if (other.hp >= other.maxHp) continue;
        const dx = other.x - e.x;
        const dy = other.y - e.y;
        if (dx * dx + dy * dy > r2) continue;
        const heal = Math.max(1, Math.floor(other.maxHp * VITALITY_REGEN_FRACTION * dt));
        other.hp = Math.min(other.maxHp, other.hp + heal);
      }
    }
  }

  /**
   * Emit a thorns_reflected event when a projectile hits a thorns-aura elite.
   */
  private computeThornsReflection(damage: number): void {
    const reflected = Math.floor(damage * THORNS_REFLECT_FRACTION);
    if (reflected > 0) {
      this.bus.emit('thorns_reflected', reflected);
    }
  }

  /**
   * On death of a retribution-aura elite, buff nearby enemies.
   */
  private triggerRetribution(dead: Enemy): void {
    const r2 = AURA_RADIUS * AURA_RADIUS;
    // One pass per retribution-elite death: rare, and O(n) either way.
    for (const e of this.enemies) {
      if (!e.alive || e.id === dead.id) continue;
      const dx = e.x - dead.x;
      const dy = e.y - dead.y;
      if (dx * dx + dy * dy > r2) continue;
      this.retributionBuffs.set(e.id, RETRIBUTION_BUFF_DURATION);
    }
  }

  /**
   * Tick retribution buff timers.
   */
  private tickRetributionBuffs(dt: number): void {
    for (const [id, remaining] of this.retributionBuffs) {
      const next = remaining - dt;
      if (next <= 0) this.retributionBuffs.delete(id);
      else this.retributionBuffs.set(id, next);
    }
  }
}
