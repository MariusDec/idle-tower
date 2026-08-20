import type { AbilityId, GameState, TowerState, AbilityState, ResourceState, PrestigeState, GameStats, Mine, StatsInfo, TargetingMode, RunRecord, WaveModifierSnapshot, EnemyType, EquipmentSlot, EquipmentStatType, Equipment, AutoBuyStrategy, GoldSourceEntry } from '../types';
import { GAME_SPEEDS, DEFAULT_SPEED_INDEX, MAX_SPEED_INDEX, MAX_RUN_HISTORY } from '../types';

/**
 * Fixed simulation substep, and the ceiling on substeps per frame (plan §5.2).
 *
 * One step is a 60 Hz frame, so at 1x speed nothing changes: `dt` is already
 * about 1/60 and the loop runs once. The cap bounds the worst case — a frame
 * hitch at maximum game speed — at six times the per-frame simulation cost
 * rather than an unbounded spiral; when it bites, steps grow instead of time
 * being dropped, so the game never runs slow-motion under load.
 */
const FIXED_STEP = 1 / 60;
const MAX_SUBSTEPS = 6;
import { TOWER_BASE, TOWER_HIT_RADIUS, TOWER_VISUAL } from '../data/tower';
import { ENEMY_DEFS } from '../data/enemies';
import { ABILITIES } from '../data/abilities';
import { RESEARCH_BY_ID } from '../data/research';
import { nextId } from '../utils/math';
import { EventBus } from './EventBus';
import { Renderer } from './Renderer';
import { Tower } from '../systems/Tower';
import { EnemyManager } from '../systems/EnemyManager';
import { ProjectileManager, type ShotVariant } from '../systems/ProjectileManager';
import { WaveManager } from '../systems/WaveManager';
import { ResourceManager } from '../systems/ResourceManager';
import { UpgradeManager } from '../systems/UpgradeManager';
import { EffectsManager } from '../systems/EffectsManager';
import { NotificationManager } from '../systems/NotificationManager';
import { AbilityManager } from '../systems/AbilityManager';
import { PrestigeManager } from '../systems/PrestigeManager';
import { ResearchTree } from '../systems/ResearchTree';
import { AutomationManager } from '../systems/AutomationManager';
import { SaveManager, type PersistentState, type OfflineResult } from '../systems/SaveManager';
import { AchievementManager } from '../systems/AchievementManager';
import { UIManager } from '../ui/UIManager';
import { isBossWave, goldDropForWave, spawnCountForWave } from '../data/formulas';
import type { AutomationKey } from '../data/prestige';
import { DEFAULT_AUTO_ASCEND_WAVE } from '../data/prestige';
import { AudioManager } from '../systems/AudioManager';
import { TowerXpManager } from '../systems/TowerXpManager';
import { TalentManager } from '../systems/TalentManager';
import { PassiveAbilityManager } from '../systems/PassiveAbilityManager';
import { EquipmentManager } from '../systems/EquipmentManager';
import { formatInt } from '../utils/bigNumber';
import { setStyle, toggleClass } from '../utils/dom';
import {
  pickRandomModifiers,
  snapshotFromDef,
  MUTATOR_DURATION_WAVES,
  waveModifierRewardMultiplier,
} from '../data/waveModifiers';
import { TALENT_STATS, type TalentStat } from '../data/talentTree';
import { PASSIVE_STATS, type PassiveStat } from '../data/passiveAbilities';
import { ACHIEVEMENT_REWARD_CONSUMERS, type AchievementRewardType } from '../data/achievements';
import { EVOLUTION_EFFECT_IDS, type EvolutionEffectId } from '../data/upgrades';
import { EQUIPMENT_STAT_TYPES } from '../data/equipment';
import {
  BuffRegistry,
  goldSourceEntries,
  resolveStats,
  type ResolvedStats,
  type StatContext,
} from '../stats';
import { WaveModifierModal } from '../ui/WaveModifierModal';
import { BlessingDraftModal } from '../ui/BlessingDraftModal';
import { BlessingManager } from '../systems/BlessingManager';
import {
  BLESSING_BY_ID,
  BLESSING_FIRST_DRAFT_WAVE,
  BLESSING_MAX_PICKS,
  BLESSING_TUNING,
  describeBlessing,
  type BlessingBehavior,
  type BlessingDef,
} from '../data/blessings';

/** Multiplier a gold-luck proc pays out at. */
const GOLD_LUCK_MULTIPLIER = 3;
/** Fire-rate multiplier while the player holds the mouse to aim manually. */
const MANUAL_AIM_FIRE_RATE = 1.3;
/** Fire-rate multiplier granted by a quick-shot proc. */
const QUICK_SHOT_FIRE_RATE = 2;
const BUFF_MANUAL_AIM = 'tower:manualAim';
const BUFF_QUICK_SHOT = 'tower:quickShot';
/**
 * Minimum away-time before the Welcome Back report is shown. Offline progress
 * is still applied below this, it just doesn't warrant a modal — otherwise
 * every brief tab switch pops one.
 */
const MIN_OFFLINE_REPORT_SECONDS = 60;
const WAVE_MILESTONES = new Set([10, 25, 50, 100, 200, 500]);
/**
 * Blessing draft timeouts, in **wall-clock** seconds (plan §1.1).
 *
 * With auto-pick on, the draft resolves itself after 20 s so an idle session
 * never parks on a modal. With auto-pick off the player has asked to decide,
 * so the deadline is long — but it still exists, because "nothing blocks on a
 * modal forever" is a rule, not a preference, and a player who walks away
 * mid-draft is the exact case it is there for.
 */
const BLESSING_AUTO_PICK_SECONDS = 20;
const BLESSING_SAFETY_TIMEOUT_SECONDS = 120;
/** localStorage key for the `autoPickBlessings` preference. */
const AUTO_PICK_BLESSINGS_KEY = 'the-tower-auto-pick-blessings';

function makeInitialState(): GameState {
  const tower: TowerState = {
    ...TOWER_BASE,
    cooldown: 0,
  };
  const resources: ResourceState = {
    gold: 0,
    mana: 0,
    maxMana: 100,
    manaRegen: 2,
    ascensionPoints: 0,
    apThisTranscendence: 0,
    transcendencePoints: 0,
    lifetimeAP: 0,
    lifetimeGold: 0,
  };
  const abilities: Record<string, AbilityState> = {};
  for (const def of ABILITIES) {
    abilities[def.id] = { level: 1, cooldown: 0, active: false, activeTimer: 0, xp: 0 };
  }
  const prestige: PrestigeState = {
    apSpent: {},
    tpSpent: {},
    automationFlags: {
      autoBuy: false,
      autoAbilities: false,
      autoAscend: false,
      autoTranscend: false,
    },
    targetAscendWave: DEFAULT_AUTO_ASCEND_WAVE,
    autoCastEnabled: {},
    autoBuyStrategy: 'balanced',
    autoBuyReserve: 0,
  };
  const stats: GameStats = {
    enemiesKilled: 0,
    bossesKilled: 0,
    goldEarned: 0,
    damageDealt: 0,
    shotsFired: 0,
    lifetimeHighestWave: 1,
    abilitiesCast: 0,
    ascensions: 0,
    lifetimeAscensions: 0,
    transcendences: 0,
    totalUpgradesPurchased: 0,
    startedAt: Date.now(),
    runStartedAt: Date.now(),
  };
  return {
    timestamp: Date.now(),
    tower,
    enemies: [],
    projectiles: [],
    resources,
    upgrades: {},
    research: {},
    researchInProgress: null,
    abilities,
    prestige,
    wave: {
      number: 1,
      highestWave: 1,
      spawning: true,
      enemiesSpawned: 0,
      enemiesToSpawn: 0,
      spawnInterval: 1.5,
      spawnTimer: 0.5,
      intermission: false,
      intermissionTimer: 0,
      autoProgress: true,
      waveModifier: { active: null, choiceForNextWave: null, pendingChoiceForWave: null, goldSnapshot: null, wavesRemaining: 0, wavesCleared: 0 },
      elapsed: 0,
      enrageStacks: 0,
    },
    stats,
    achievements: [],
    runHistory: [],
    runStartedAt: Date.now(),
    towerXp: { xp: 0, level: 0, unspentTalentPoints: 0, totalXpEarned: 0 },
    talents: { allocated: {} },
    passiveAbilities: {},
    equipment: [],
    equipped: {},
    blessings: {
      held: {},
      picksTaken: 0,
      rerolls: 0,
      pendingOfferForWave: null,
      wavesClearedThisRun: 0,
    },
  };
}

function readAutoPickPreference(): boolean {
  try {
    return localStorage.getItem(AUTO_PICK_BLESSINGS_KEY) === '1';
  } catch {
    return false;
  }
}

function writeAutoPickPreference(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(AUTO_PICK_BLESSINGS_KEY, '1');
    else localStorage.removeItem(AUTO_PICK_BLESSINGS_KEY);
  } catch {
    // ignore
  }
}

export interface GameDeps {
  bus: EventBus;
  ui: UIManager;
  notificationRoot: HTMLElement;
  modalRoot: HTMLElement;
}

export class Game {
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: Renderer;
  private readonly bus: EventBus;
  private readonly ui: UIManager;

  private readonly state: GameState;
  private readonly tower: Tower;
  private readonly enemyMgr: EnemyManager;
  private readonly projectileMgr: ProjectileManager;
  private readonly waveMgr: WaveManager;
  private readonly resourceMgr: ResourceManager;
  private readonly upgradeMgr: UpgradeManager;
  private readonly effects: EffectsManager;
  private readonly notifications: NotificationManager;
  private readonly abilityMgr: AbilityManager;
  private readonly prestigeMgr: PrestigeManager;
  private readonly researchTree: ResearchTree;
  private readonly automation: AutomationManager;
  private readonly saveMgr: SaveManager;
  private readonly achievementMgr: AchievementManager;
  private readonly audio: AudioManager;
  private readonly towerXpMgr: TowerXpManager;
  private readonly talentMgr: TalentManager;
  private readonly passiveMgr: PassiveAbilityManager;
  private readonly equipmentMgr: EquipmentManager;
  private readonly waveModModal: WaveModifierModal;
  private readonly blessingMgr: BlessingManager;
  private readonly blessingModal: BlessingDraftModal;
  /**
   * Player preference for auto-picking blessings. Forced on when automation is
   * running (see `blessingAutoPickForced`), because a player who has unlocked
   * auto-buy is by definition not watching the screen.
   */
  private autoPickBlessings = false;
  /**
   * Every time-varying modifier in the game. Read by `buildStatContext`, so a
   * buff composes with upgrades instead of racing them (plan §6).
   */
  private readonly buffs = new BuffRegistry();
  /**
   * The context behind the stats currently in effect. `computeStatsInfo`
   * re-resolves *this* object to build its breakdown, which is what makes
   * "displayed" and "applied" the same computation rather than two that agree
   * by inspection.
   */
  private lastStatContext: StatContext | null = null;
  /** The stat block currently written into the tower and its managers. */
  private lastResolved: ResolvedStats | null = null;
  /** `BuffRegistry.version` as of the last recompute. */
  private appliedBuffVersion = -1;

  private lastTime = 0;
  private running = false;
  private saveLoaded = false;
  private rafId: number | null = null;

  private fpsAccumulator = 0;
  private fpsFrames = 0;
  private currentFps = 0;
  private fpsOverlay: HTMLElement | null = null;
  private mines: Mine[] = [];
  private announcedMilestones = new Set<number>();
  private researchAnnounced = new Set<string>();
  private transcendenceUnlockedAnnounced = false;

  private mouseX = 0;
  private mouseY = 0;
  private mouseDown = false;

  // Per-run baselines (snapshotted when a run starts; used to compute deltas
  // and to record RunRecord summaries on ascend/transcend).
  private runBaselineGold = 0;
  private runBaselineKills = 0;
  private runBaselineAbilities = 0;
  private runBaselineHighestWave = 1;
  /** Lifetime best run gold (for "new record" detection). */
  private bestGoldRun = 0;
  /** Lifetime best run wave (for "new record" detection). */
  private bestWaveRun = 1;

  private speedIndex = DEFAULT_SPEED_INDEX;
  private maxSpeedIndex = MAX_SPEED_INDEX;

  // P3: Boss entry / death FX
  private slowMoRemaining = 0;
  private slowMoTotal = 0;
  private screenFlash = 0;
  private towerFlash = 0;
  private wallFlash = 0;
  private shieldFlash = 0;
  private canvasWrap: HTMLElement | null = null;

  // Talent values consumed by event handlers rather than by the stat recompute.
  private talentDodgeChance = 0;
  private talentManaShieldFraction = 0;
  private talentExtraProjectileChance = 0;
  private talentMagicProcChance = 0;
  /** Wall HP restored per second, as a fraction of wallMaxHp. */
  private talentWallRegen = 0;
  private talentHeadStartWaves = 0;

  // Evolution state
  private reviveUsed = false;
  /**
   * True while the run-over modal is up (plan §2.3.3). The simulation is
   * frozen so the dead tower is not killed again every frame and the field
   * stays on screen as a backdrop for the decision.
   */
  private runFailed = false;
  /** Wave the stall prompt has already fired for, so it fires once per wave. */
  private stalledWave = -1;
  private killStreak = 0;
  private manaFullGoldTimer = 0;
  private shotCounter = 0;
  /** Separate cadence from `shotCounter`, so the mortar and double-shot evolutions don't share a clock. */
  private mortarShotCounter = 0;
  /**
   * Reentrancy guard for `split_on_kill`: the shards damage enemies, which can
   * kill them, which re-enters this handler synchronously. Without the guard a
   * dense wave turns one kill into an unbounded cascade.
   */
  private splitOnKillActive = false;
  private waveGoldBonus = 0;

  constructor(canvas: HTMLCanvasElement, deps: GameDeps) {
    this.canvas = canvas;
    this.bus = deps.bus;
    this.ui = deps.ui;
    this.renderer = new Renderer(canvas);
    this.state = makeInitialState();
    this.tower = new Tower(this.state.tower);
    this.resourceMgr = new ResourceManager(this.state.resources, this.state.stats, this.bus);
    this.researchTree = new ResearchTree(this.bus);
    this.enemyMgr = new EnemyManager(this.bus, this.resourceMgr, this.researchTree);
    this.projectileMgr = new ProjectileManager(this.bus, this.tower, this.enemyMgr);
    this.waveMgr = new WaveManager(
      this.bus,
      this.enemyMgr,
      this.canvas.width,
      this.canvas.height,
      (wave) => {
        if (wave > this.state.wave.highestWave) {
          this.state.wave.highestWave = wave;
        }
        if (wave > this.state.stats.lifetimeHighestWave) {
          this.state.stats.lifetimeHighestWave = wave;
        }
      },
      (wave) => {
        this.applyUpgradeEffects();

        if (wave > this.state.wave.highestWave) {
          this.state.wave.highestWave = wave;
        }
        if (wave > this.state.stats.lifetimeHighestWave) {
          this.state.stats.lifetimeHighestWave = wave;
        }
      },
    );
    this.upgradeMgr = new UpgradeManager(this.bus, this.resourceMgr);
    this.blessingMgr = new BlessingManager(this.bus);
    // The impact path asks `has(behavior)` several times per hit, so it reads
    // the manager's rebuilt cache rather than scanning the pool.
    this.projectileMgr.setBlessings(this.blessingMgr);
    this.waveModModal = new WaveModifierModal(deps.modalRoot);
    this.blessingModal = new BlessingDraftModal(deps.modalRoot);
    this.autoPickBlessings = readAutoPickPreference();
    this.effects = new EffectsManager();
    this.effects.onShockwaveDamage = (s) => {
      // P5 boss death: damage enemies caught in the ring (single hit per ring)
      if (!s.damage) return;
      const inner = s.currentRadius - 30; // damage band just inside the wave front
      const outer = s.currentRadius + 30;
      const innerSq = Math.max(0, inner) * Math.max(0, inner);
      // The grid narrows this to the outer disc; the inner cut-off still has
      // to be applied by hand, since a ring is not a circle query.
      for (const en of this.enemyMgr.queryRadius(s.x, s.y, outer)) {
        const dx = en.x - s.x;
        const dy = en.y - s.y;
        if (dx * dx + dy * dy >= innerSq) {
          this.enemyMgr.damage(en, s.damage, false);
        }
      }
    };
    this.notifications = new NotificationManager(deps.notificationRoot, this.bus);
    this.abilityMgr = new AbilityManager({
      resources: this.resourceMgr,
      enemies: this.enemyMgr,
      tower: this.tower,
      bus: this.bus,
      projectileManager: this.projectileMgr,
      buffs: this.buffs,
      getState: (id) => this.state.abilities[id],
      onCast: () => {
        this.state.stats.abilitiesCast += 1;
      },
    });
    this.prestigeMgr = new PrestigeManager(this.bus, {
      resources: this.state.resources,
      stats: this.state.stats,
      prestige: this.state.prestige,
      achievementMultiplier: (type) => this.achievementMgr.getRewardMultiplier(type),
    });
    this.automation = new AutomationManager({
      upgrades: this.upgradeMgr,
      abilities: this.abilityMgr,
      prestige: this.prestigeMgr,
      research: this.researchTree,
      getState: () => this.state,
      onAscend: () => this.ascend(),
      onTranscend: () => this.transcend(),
      bus: this.bus,
    });
    this.saveMgr = new SaveManager(this.bus, { getRP: () => this.researchTree.rp });
    this.achievementMgr = new AchievementManager(this.bus, {
      getStats: () => this.state.stats,
      getAchievements: () => this.state.achievements,
      researchCount: () => Object.keys(this.state.research).length,
    });
    this.audio = new AudioManager(this.bus);
    this.towerXpMgr = new TowerXpManager(this.state.towerXp, this.bus);
    this.talentMgr = new TalentManager(this.state.talents, this.bus, {
      towerXpUnspentPoints: () => this.state.towerXp.unspentTalentPoints,
      spendTalentPoint: () => this.towerXpMgr.spendTalentPoint(),
      grantTalentPoint: () => this.towerXpMgr.grantTalentPoint(),
      spendGold: (amount) => this.resourceMgr.spendGold(amount),
    });
    this.passiveMgr = new PassiveAbilityManager(this.state.passiveAbilities, this.bus);
    this.passiveMgr.ensureInitialized();
    this.equipmentMgr = new EquipmentManager(this.state.equipment, this.state.equipped, this.bus);

    this.tower.setPosition(this.canvas.width / 2, this.canvas.height / 2);
    this.projectileMgr.setBounds(this.canvas.width, this.canvas.height);
    this.state.upgrades = this.upgradeMgr.snapshot();
    this.applyUpgradeEffects();
    this.syncUiApis();
    this.resetRunBaselines();

    this.bus.on('enemy_damaged', (payload: unknown) => {
      const p = payload as { enemy: { id: number; x: number; y: number; type: string; armor: number; magicResist: number; hp: number; maxHp: number; goldValue: number; alive: boolean }; amount: number; killed: boolean; isCrit?: boolean };
      const def = ENEMY_DEFS[p.enemy.type as keyof typeof ENEMY_DEFS];
      this.effects.emitHitSparks(p.enemy.x, p.enemy.y, def.color, p.killed ? 6 : 3);
      this.effects.emitDamageNumber(p.enemy.x, p.enemy.y, p.amount, !!p.isCrit);
      const ls = this.tower.effectiveLifesteal;
      if (ls > 0 && p.amount > 0) {
        const ts = this.tower.snapshot;
        const healAmt = p.amount * ls;
        ts.hp = Math.min(ts.maxHp, ts.hp + healAmt);
        this.effects.emitHealNumber(ts.x, ts.y - TOWER_VISUAL.bodyRadius - 24, healAmt);
      }
      if (!p.killed && this.prestigeMgr.hasGoldOnHit()) {
        const fraction = this.prestigeMgr.getGoldOnHitFraction();
        const goldOnHit = Math.max(1, Math.floor(p.enemy.goldValue * fraction));
        this.resourceMgr.addGold(goldOnHit);
      }
      // Research: Arcane Recovery — crits restore mana
      if (p.isCrit) {
        const critMana = this.researchTree.getCritManaRestore();
        if (critMana > 0) {
          this.resourceMgr.addMana(critMana);
        }
      }
      if (!p.killed && this.prestigeMgr.hasAoESplash()) {
        const splashFraction = this.prestigeMgr.getAoESplashFraction();
        const splashDamage = Math.max(1, Math.floor(p.amount * splashFraction));
        const splashRadius = 60;
        for (const e of this.enemyMgr.queryRadius(p.enemy.x, p.enemy.y, splashRadius)) {
          if (e.id === p.enemy.id) continue;
          this.enemyMgr.damage(e, splashDamage, false);
        }
      }
    });
    this.bus.on('enemy_killed', (enemy) => {
      const e = enemy as { x: number; y: number; type: string; maxHp?: number; isSplitChild?: boolean; goldValue?: number; elite?: boolean };
      const def = ENEMY_DEFS[e.type as keyof typeof ENEMY_DEFS];
      this.state.stats.enemiesKilled += 1;
      // Plan §3.4: an elite kill is worth showing up for — the gold multiplier
      // and RP are handled in EnemyManager; the gear roll and the toast are
      // here because they need the equipment manager and the notification bus.
      if (e.elite) {
        const eliteDrop = this.equipmentMgr.rollDrop(this.waveMgr.currentWave, 'elite');
        if (eliteDrop) {
          this.bus.emit('toast', {
            kind: 'milestone',
            text: `Elite dropped ${eliteDrop.rarity} gear!`,
            life: 4,
          });
        }
        this.effects.emitShockwaveRing(e.x, e.y, 120, 'rgba(255, 215, 0, 0.7)', 5, 0, 0, 'magic');
      }
      if (e.type === 'boss') {
        this.state.stats.bossesKilled += 1;
        // P5: Multi-stage death shockwave — 3 cascading rings that each damage enemies once.
        // Stage 1 (immediate): tight inner ring — strongest damage
        this.effects.emitShockwaveRing(e.x, e.y, 150, 'rgba(255, 64, 64, 0.9)', 8, 0, 120, 'magic');
        // Stage 2: mid ring
        this.effects.emitShockwaveRing(e.x, e.y, 300, 'rgba(255, 100, 64, 0.85)', 7, 0.2, 80, 'magic');
        // Stage 3: wide outer ring
        this.effects.emitShockwaveRing(e.x, e.y, 500, 'rgba(255, 160, 64, 0.8)', 6, 0.4, 50, 'magic');
        // P5: Bonus x2 gold (normal gold already awarded in damage(); add 1x more)
        this.resources.addGold((e.goldValue ?? def.baseGold) * 1);
        // Achievement reward: bonus gold from boss kills.
        const achBossGold = this.achievementMgr.getRewardMultiplier('boss_gold_mult');
        if (achBossGold > 0) {
          const bonus = Math.floor((e.goldValue ?? def.baseGold) * achBossGold);
          if (bonus > 0) this.resources.addGold(bonus);
        }
        // Evolution: Headhunter — boss kills +50% gold
        if (this.upgradeMgr.hasEvolutionEffect('headhunter')) {
          const headhunterBonus = Math.floor((e.goldValue ?? def.baseGold) * this.upgradeMgr.getEvolutionEffectValue('headhunter'));
          if (headhunterBonus > 0) {
            this.resources.addGold(headhunterBonus);
          }
        }
        this.bus.emit('boss_killed', { x: e.x, y: e.y, goldValue: e.goldValue ?? def.baseGold });
        // Death slow-mo + screen flash (P3 + P5)
        this.triggerBossDeathSlowMo();
        // Equipment drop
        const eqDrop = this.equipmentMgr.rollDrop(this.waveMgr.currentWave, 'boss');
        if (eqDrop) {
          this.bus.emit('toast', { kind: 'milestone', text: `Equipment dropped: ${eqDrop.rarity}!`, life: 4 });
        }
        if (this.state.stats.bossesKilled === 1) {
          this.bus.emit('toast', { kind: 'milestone', text: 'First boss defeated! +200g', life: 5 });
        } else {
          this.bus.emit('toast', { kind: 'milestone', text: `Boss defeated! +${formatInt((e.goldValue ?? def.baseGold) * 2)}g`, life: 6 });
        }
      }

      // Splitter: on death spawn 2 child splitters (unless this is a child itself)
      if (e.type === 'splitter' && !e.isSplitChild) {
        const wave = this.waveMgr.currentWave;
        // Find the dead splitter in the list to get full enemy props
        const parent = this.enemyMgr.list.find(en => !en.alive && en.x === e.x && en.y === e.y && en.type === 'splitter');
        if (parent) {
          this.enemyMgr.spawnSplitterChild(parent, wave, e.x - 6, e.y);
          this.enemyMgr.spawnSplitterChild(parent, wave, e.x + 6, e.y);
        }
        this.effects.emitSplitBurst(e.x, e.y);
      }

      // Tower XP & passive ability XP
      this.towerXpMgr.addKillXp(e.type as EnemyType, this.waveMgr.currentWave);
      this.passiveMgr.addKillXp(e.type as EnemyType, this.waveMgr.currentWave);

      this.effects.emitDeathBurst(e.x, e.y, def.color, def.radius);

      // Evolution: kill_streak_gold
      if (this.upgradeMgr.hasEvolutionEffect('kill_streak_gold')) {
        this.killStreak += 1;
        const perKill = this.upgradeMgr.getEvolutionEffectValue('kill_streak_gold');
        this.enemyMgr.setKillStreakGoldBonus((this.killStreak - 1) * perKill);
      }

      // ── blessing behaviors on kill (plan §1.3) ──
      if (this.blessingMgr.has('siphon')) {
        this.resourceMgr.addMana(
          this.state.resources.maxMana * BLESSING_TUNING.siphonManaFraction,
        );
      }
      if (this.blessingMgr.has('split_on_kill')) this.fireSplitShards(e.x, e.y);

      // Research: Chain Reaction — kills deal AoE to nearby enemies
      const chainAoE = this.researchTree.getChainKillAoE();
      if (chainAoE > 0 && e.maxHp) {
        const aoeDamage = Math.max(1, Math.floor(e.maxHp * chainAoE));
        const chainRadius = 70;
        for (const target of this.enemyMgr.queryRadius(e.x, e.y, chainRadius)) {
          this.enemyMgr.damage(target, aoeDamage, false);
        }
        this.effects.emitShockwaveRing(e.x, e.y, chainRadius);
      }
    });

    this.bus.on('shield_break', (payload: unknown) => {
      const p = payload as { x: number; y: number };
      this.effects.emitEnemyShieldBreak(p.x, p.y);
    });

    this.bus.on('thorns_reflected', (amount: unknown) => {
      const dmg = amount as number;
      if (dmg > 0) {
        this.bus.emit('tower_damaged', dmg);
      }
    });

    this.bus.on('enemy_healed', (payload: unknown) => {
      const p = payload as { healer: { x: number; y: number }; target: { x: number; y: number }; amount: number };
      this.effects.emitHealParticles(p.healer.x, p.healer.y, p.target.x, p.target.y);
      this.effects.emitDamageNumber(p.target.x, p.target.y - 10, p.amount, false);
    });
    this.bus.on('tower_damaged', (amount: unknown) => {
      let raw = Math.max(0, amount as number);
      if (raw <= 0) return;
      // Talent: Evasion — fully avoid the hit.
      if (this.talentDodgeChance > 0 && Math.random() < this.talentDodgeChance) {
        this.effects.emitDamageNumber(
          this.tower.snapshot.x,
          this.tower.snapshot.y - TOWER_VISUAL.bodyRadius - 24,
          0,
          false,
        );
        return;
      }
      // Research: Reinforced Structure reduces incoming damage
      const towerDef = this.researchTree.getTowerDefense();
      if (towerDef > 0) raw = Math.floor(raw * (1 - towerDef));
      if (raw <= 0) return;
      // Evolution: Mana Shield — 10% DR when mana is full
      if (this.upgradeMgr.hasEvolutionEffect('mana_shield') && this.state.resources.mana >= this.state.resources.maxMana) {
        raw = Math.floor(raw * (1 - this.upgradeMgr.getEvolutionEffectValue('mana_shield')));
        if (raw <= 0) return;
      }
      const ts = this.tower.snapshot;
      if (ts.wallHp > 0) {
        raw = Math.floor(raw * 0.8);
        const absorbed = Math.min(ts.wallHp, raw);
        ts.wallHp -= absorbed;
        raw -= absorbed;
        this.effects.emitDamageNumber(
          ts.x,
          ts.y - TOWER_VISUAL.bodyRadius - 40,
          absorbed,
          false,
        );

        if (ts.wallHp <= 0) {
          this.enemyMgr.setWallContactExtra(0);
        }

        if (raw <= 0) return;
      }
      if (ts.shieldCurrentCharges > 0) {
        ts.shieldCurrentCharges--;
        this.effects.emitShieldAbsorb(ts.x, ts.y);
        return;
      }
      const afterArmor = raw * (1 - ts.armor);
      const afterDefense = Math.max(0, afterArmor - ts.defense);
      let dmg = Math.floor(afterDefense);
      if (dmg <= 0) return;
      // Talent: Mana Shield — spend mana to absorb part of the hit.
      if (this.talentManaShieldFraction > 0 && this.state.resources.mana > 0) {
        const absorbed = Math.floor(
          Math.min(this.state.resources.mana, dmg * this.talentManaShieldFraction),
        );
        if (absorbed > 0) {
          this.resourceMgr.spendMana(absorbed);
          dmg -= absorbed;
          if (dmg <= 0) return;
        }
      }
      ts.hp = Math.max(0, ts.hp - dmg);
      this.effects.emitDamageNumber(
        ts.x,
        ts.y - TOWER_VISUAL.bodyRadius - 24,
        dmg,
        false,
      );
      if (ts.hp <= 0) {
        // Evolution: revive — once per ascension
        if (!this.reviveUsed && this.upgradeMgr.hasEvolutionEffect('revive')) {
          const reviveFraction = this.upgradeMgr.getEvolutionEffectValue('revive');
          ts.hp = Math.floor(ts.maxHp * reviveFraction);
          this.reviveUsed = true;
          this.bus.emit('toast', {
            kind: 'milestone',
            text: `Titan's Heart! Revived at ${Math.round(reviveFraction * 100)}% HP.`,
            life: 4,
          });
          return;
        }
        // Plan §2.3.3: once ascension is available a death is the *end of the
        // run*, not a one-wave rewind. Offer the ascension there and then so
        // the player has a decision to make instead of a wall to re-grind.
        if (this.prestigeMgr.canAscend(this.state.wave.highestWave)) {
          this.runFailed = true;
          this.bus.emit('run_failed', {
            wave: this.waveMgr.currentWave,
            highestWave: this.state.wave.highestWave,
            apPreview: this.prestigeMgr.previewAP(this.state.wave.highestWave),
            enrageStacks: this.state.wave.enrageStacks,
            goldEarned: Math.max(0, this.state.stats.goldEarned - this.runBaselineGold),
          });
          return;
        }
        this.bus.emit('toast', {
          kind: 'warning',
          text: `Tower destroyed! Restarting at wave ${this.waveMgr.currentWave - 1}.`,
          life: 4,
        });
        this.restartCurrentWave();
      }
    });
    // Plan §4.3: enrage already ends a stalled run eventually, but the player
    // deserves to be told the moment the wall is reached rather than watching
    // an unwinnable wave grind out. Only prompt once per wave, and only when
    // ascending is actually an option.
    this.bus.on('wave_enraged', (payload: unknown) => {
      const p = payload as { wave: number; stacks: number };
      if (p.stacks < 1) return;
      if (this.stalledWave === p.wave) return;
      if (!this.prestigeMgr.canAscend(this.state.wave.highestWave)) return;
      this.stalledWave = p.wave;
      this.bus.emit('run_stalled', {
        wave: p.wave,
        apPreview: this.prestigeMgr.previewAP(this.state.wave.highestWave),
      });
    });
    this.bus.on('wave_started', (wave: unknown) => {
      this.stalledWave = -1;
      const ts = this.tower.snapshot;
      if (ts.wallMaxHp > 0) {
        ts.wallHp = ts.wallMaxHp;
      }
      // Reset kill streak each wave
      this.killStreak = 0;
      this.enemyMgr.setKillStreakGoldBonus(0);

      const w = wave as number;
      // Boss entry effects on boss waves
      if (isBossWave(w)) {
        this.triggerBossEntrySlowMo();
        this.effects.emitBossEntryPulse(ts.x, ts.y);
      }
      if (WAVE_MILESTONES.has(w) && !this.announcedMilestones.has(w)) {
        this.announcedMilestones.add(w);
        const kind = isBossWave(w) ? 'milestone' : 'info';
        const text = isBossWave(w)
          ? `Wave ${w} — BOSS INCOMING`
          : `Wave ${w} reached`;
        this.bus.emit('toast', { kind, text, life: 4 });
      }

      // Apply (or clear) the wave modifier for this wave.
      this.applyActiveWaveModifier();
    });
    this.bus.on('wave_cleared', (wave: unknown) => {
      const cleared = wave as number;
      const wms = this.state.wave.waveModifier;
      // Plan §3.3: a mutator now spans MUTATOR_DURATION_WAVES waves and pays
      // out after each of them, with the reward escalating each time — so
      // surviving the third wave under Fortress is worth twice the first.
      if (wms.active && wms.wavesRemaining > 0 && wms.pendingChoiceForWave !== null
        && cleared >= wms.pendingChoiceForWave) {
        const escalation = waveModifierRewardMultiplier(wms.wavesCleared);
        const goldMult = wms.active.reward.gold;
        if (goldMult > 0 && wms.goldSnapshot != null) {
          const waveGold = this.state.stats.goldEarned - wms.goldSnapshot;
          if (waveGold > 0) {
            const bonus = Math.floor(waveGold * goldMult * escalation);
            if (bonus > 0) {
              this.state.resources.gold += bonus;
              this.state.resources.lifetimeGold += bonus;
              this.state.stats.goldEarned += bonus;
              this.bus.emit('gold_changed', this.state.resources.gold);
            }
          }
        }
        const apReward = Math.floor(wms.active.reward.ap * escalation);
        if (apReward > 0) {
          this.state.resources.ascensionPoints += apReward;
          this.state.resources.apThisTranscendence += apReward;
          this.state.resources.lifetimeAP += apReward;
        }
        const tpReward = Math.floor(wms.active.reward.tp * escalation);
        if (tpReward > 0) {
          this.state.resources.transcendencePoints += tpReward;
        }

        wms.wavesCleared += 1;
        wms.wavesRemaining -= 1;
        if (wms.wavesRemaining <= 0) {
          const name = wms.active.name;
          wms.active = null;
          wms.pendingChoiceForWave = null;
          wms.goldSnapshot = null;
          wms.wavesCleared = 0;
          this.bus.emit('toast', {
            kind: 'milestone',
            text: `${name} survived — mutator ended.`,
            life: 3.5,
          });
        } else {
          // Fresh baseline so the next wave's gold reward measures that wave.
          wms.goldSnapshot = this.state.stats.goldEarned;
          this.bus.emit('toast', {
            kind: 'info',
            text: `${wms.active.name}: ${wms.wavesRemaining} wave${wms.wavesRemaining === 1 ? '' : 's'} left · next reward ×${waveModifierRewardMultiplier(wms.wavesCleared).toFixed(1)}`,
            life: 3,
          });
        }
        this.applyUpgradeEffects();
      }
      // Wave Mastery: flat gold on wave clear
      if (this.waveGoldBonus > 0) {
        let multiplier = 1 + cleared * 0.5;
        if (this.upgradeMgr.hasEvolutionEffect('golden_tide')) {
          multiplier *= 1 + this.upgradeMgr.getEvolutionEffectValue('golden_tide');
        }
        const bonus = Math.floor(this.waveGoldBonus * multiplier);
        if (bonus > 0) {
          this.state.resources.gold += bonus;
          this.state.resources.lifetimeGold += bonus;
          this.state.stats.goldEarned += bonus;
          this.bus.emit('gold_changed', this.state.resources.gold);
        }
      }
      // Enlightenment evolution: +1 talent point every 10 waves
      if (this.upgradeMgr.hasEvolutionEffect('enlightenment') && cleared % 10 === 0) {
        this.towerXpMgr.grantTalentPoint();
      }
      // Tower XP & passive ability XP from wave clear
      this.towerXpMgr.addWaveClearXp(cleared);
      this.passiveMgr.addWaveClearXp(cleared);

      // Blessings (plan §1.1). The Greed Engine's value is a function of waves
      // cleared, so its stat total moves every wave and the block is restated.
      const hadGreed = this.blessingMgr.has('greed_engine');
      this.blessingMgr.noteWaveCleared();
      this.state.blessings = this.blessingMgr.snapshot();
      if (hadGreed) this.applyUpgradeEffects();
      this.maybeOfferBlessingDraft(cleared);
    });
    this.bus.on('wave_modifier_offer', (nextWave: unknown) => {
      const w = nextWave as number;
      const choices = pickRandomModifiers(3);
      this.state.wave.waveModifier.choiceForNextWave = choices.map(snapshotFromDef);
      this.state.wave.waveModifier.pendingChoiceForWave = w;
      this.waveMgr.pauseSpawning();
      const projected: Record<string, { gold: number; ap: number; tp: number }> = {};
      for (const snapshot of this.state.wave.waveModifier.choiceForNextWave) {
        projected[snapshot.id] = this.projectWaveModifierReward(snapshot, w);
      }
      this.waveModModal.show(
        {
          wave: w,
          waves: MUTATOR_DURATION_WAVES,
          choices: this.state.wave.waveModifier.choiceForNextWave,
          projected,
        },
        {
          onChoose: (snapshot: WaveModifierSnapshot) => {
            this.waveMgr.resumeSpawning();
            this.chooseWaveModifier(snapshot);
          },
          onSkip: () => {
            this.waveMgr.resumeSpawning();
            this.skipWaveModifier();
          },
        },
      );
    });
    this.bus.on('upgrades_changed', (levels: Record<string, number>) => {
      this.state.upgrades = { ...(levels as Record<string, number>) };
      this.applyUpgradeEffects();
    });
    // The purchase counter belongs on the purchase event, not on
    // `upgrades_changed` — the latter also fires on reset/load, and a bulk buy
    // is worth every level it bought rather than one.
    this.bus.on('upgrade_purchased', (payload: unknown) => {
      const p = payload as { levelsGained?: number };
      this.state.stats.totalUpgradesPurchased += Math.max(1, p.levelsGained ?? 1);
    });
    this.bus.on('upgrade_evolved', (payload: unknown) => {
      const p = payload as { id: string; level: number; evolution: { name: string; description: string } };
      this.bus.emit('toast', {
        kind: 'milestone',
        text: `Evolution! ${p.evolution.name} — ${p.evolution.description}`,
        life: 5,
      });
    });
    this.bus.on('equipment_equipped', () => {
      this.applyUpgradeEffects();
    });
    this.bus.on('equipment_unequipped', () => {
      this.applyUpgradeEffects();
    });
    this.bus.on('talent_allocated', () => {
      this.applyUpgradeEffects();
    });
    this.bus.on('talent_refunded', () => {
      this.applyUpgradeEffects();
    });
    this.bus.on('research_unlocked', (payload: unknown) => {
      const p = payload as { id: string; level: number };
      this.state.research = this.researchTree.getLevelsSnapshot();
      this.applyUpgradeEffects();
      const key = `${p.id}:${p.level}`;
      if (!this.researchAnnounced.has(key)) {
        this.researchAnnounced.add(key);
        const name = RESEARCH_BY_ID[p.id]?.name ?? 'Research';
        this.bus.emit('toast', {
          kind: 'milestone',
          text: `${name}${p.level > 1 ? ` Lv.${p.level}` : ''} complete!`,
          life: 3.5,
        });
      }
    });
    this.bus.on('automation_unlocked', (payload: unknown) => {
      const p = payload as { key: AutomationKey };
      const names: Record<AutomationKey, string> = {
        autoBuy: 'Auto-Upgrade',
        autoAbilities: 'Auto-Cast',
        autoAscend: 'Auto-Ascend',
        autoTranscend: 'Auto-Transcend',
      };
      this.bus.emit('toast', {
        kind: 'milestone',
        text: `${names[p.key]} unlocked — toggle it in Prestige → Automation.`,
        life: 5,
      });
    });
    this.bus.on('ability_visual', (payload: unknown) => {
      const p = payload as { id: AbilityId; def: { effectType: string }; target?: { x: number; y: number } | null };
      const t = this.tower.snapshot;
      const tx = p.target?.x ?? t.x;
      const ty = p.target?.y ?? t.y;
      switch (p.def.effectType) {
        case 'aoe_damage':
          this.effects.emitRainOfArrows(t.x, t.y);
          break;
        case 'slow':
          this.effects.emitFrostNovaRing(t.x, t.y);
          break;
        case 'fire_rate_buff':
          this.effects.emitBerserkPulse(t.x, t.y);
          break;
        case 'gold_buff':
          this.effects.emitGoldRushSparkle(t.x, t.y);
          break;
        case 'single_target_damage':
          this.effects.emitMeteor(tx, ty, t.x, t.y);
          this.triggerCanvasShake();
          break;
        case 'chain_damage':
          this.effects.emitHitSparks(tx, ty, '#9aa7ff', 6);
          break;
        case 'crit_buff':
          this.effects.emitPrecisionGlow(t.x, t.y);
          break;
        case 'lifesteal_buff':
          this.effects.emitVampiricAura(t.x, t.y);
          break;
        case 'execute_damage':
          this.effects.emitExecuteSlash(tx, ty);
          break;
      }
    });
    this.bus.on('chain_lightning', (payload: unknown) => {
      const p = payload as { path: { x: number; y: number }[] };
      if (p.path && p.path.length >= 2) {
        this.effects.emitChainLightning(p.path);
      }
    });

    this.bus.on('enemy_attack', (payload: unknown) => {
      const p = payload as { x: number; y: number; type: string };
      const def = ENEMY_DEFS[p.type as keyof typeof ENEMY_DEFS];
      const ts = this.tower.snapshot;
      this.effects.emitAttackSlash(p.x, p.y, ts.x, ts.y, def.color);
      if (ts.shieldCurrentCharges > 0) {
        this.shieldFlash = 0.12;
      } else if (ts.wallHp > 0) {
        this.wallFlash = 0.12;
      } else {
        this.towerFlash = 0.12;
      }
    });

    // Plan §5.7: these are frequent (a purchase, a wave start, an ability
    // upgrade) and the state they change is not worth a synchronous
    // `JSON.stringify` of the whole save each time. Mark it dirty and let
    // `SaveManager.tick` coalesce; the tab-hidden handler flushes immediately.
    const saveOnEvent = () => {
      this.saveMgr.requestSave();
    };
    this.bus.on('upgrade_purchased', saveOnEvent);
    this.bus.on('ap_spent', saveOnEvent);
    this.bus.on('tp_spent', saveOnEvent);
    this.bus.on('achievement_unlocked', saveOnEvent);
    this.bus.on('research_started', saveOnEvent);
    this.bus.on('research_unlocked', saveOnEvent);
    this.bus.on('research_cancelled', saveOnEvent);
    this.bus.on('wave_started', saveOnEvent);
    this.bus.on('ability_upgraded', saveOnEvent);
    this.bindVisibilityEvents();
  }

  /**
   * Move the run to the wave the offline walk ended on (plan §4.4).
   *
   * `WaveManager.startAtWave` replaces its wave state wholesale, so the
   * snapshot has to be re-bound afterwards — the same handshake the
   * head-start path uses.
   */
  private applyOfflineWave(endWave: number): void {
    if (endWave <= this.state.wave.number) return;
    this.waveMgr.startAtWave(endWave);
    this.state.wave = this.waveMgr.snapshot;
  }

  private bindVisibilityEvents(): void {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        // The frame loop stops while hidden, so a draft left open here would
        // freeze the intermission until the player came back — and the offline
        // walk would then resume from a wave that never started. Resolve it
        // now: a hidden tab is by definition an unattended one (plan §1.1).
        if (this.blessingModal.isVisible()) this.autoPickBlessing();
        this.saveMgr.save(this.state);
        this.stop();
      } else {
        const persisted = this.saveMgr.load();
        if (persisted) {
          const result = this.saveMgr.computeOfflineProgress(persisted, this.computeGoldMultiplier());
          if (result.elapsedSeconds > 0) {
            const startWave = this.state.wave.number;
            this.saveMgr.applyOfflineProgress(this.state, result);
            this.applyOfflineWave(result.endWave);
            if (result.rpEarned > 0) this.researchTree.addRP(result.rpEarned);
            if (this.researchTree.advanceResearch(result.researchElapsed)) {
              this.state.research = this.researchTree.getLevelsSnapshot();
            }
            this.state.researchInProgress = this.researchTree.inProgress
              ? { id: this.researchTree.inProgress.id, elapsed: this.researchTree.inProgress.elapsed, targetLevel: this.researchTree.inProgress.targetLevel }
              : null;
            this.applyUpgradeEffects();
            this.state.upgrades = this.upgradeMgr.snapshot();
            const endWave = this.state.wave.number;
            if (result.elapsedSeconds >= MIN_OFFLINE_REPORT_SECONDS) {
              this.bus.emit('welcome_back', { result, startWave, endWave });
            }
            this.saveMgr.save(this.state);
          }
        }
        this.start();
      }
    });
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    if (!this.saveLoaded) {
      this.waveMgr.reset();
    }
    // AudioContext: try to start (will resume on user gesture if blocked)
    this.audio.ensureContext();
    this.audio.resume();
    this.loop();
  }

  /**
   * Called by main.ts on first user interaction to satisfy Chrome autoplay policy.
   */
  initAudio(): void {
    this.audio.ensureContext();
    this.audio.resume();
  }

  stop(): void {
    this.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  setFpsOverlay(el: HTMLElement | null): void {
    this.fpsOverlay = el;
  }

  setCanvasWrap(el: HTMLElement | null): void {
    this.canvasWrap = el;
  }

  private triggerCanvasShake(): void {
    if (!this.canvasWrap) return;
    // Animation restart pattern: unconditionally remove → force reflow → add.
    // toggleClass would short-circuit via the cache and skip the CSS
    // animation — keep raw classList ops here.
    this.canvasWrap.classList.remove('is-shaking');
    void this.canvasWrap.offsetWidth; // restart anim
    this.canvasWrap.classList.add('is-shaking');
    setTimeout(() => {
      if (this.canvasWrap) this.canvasWrap.classList.remove('is-shaking');
    }, 420);
  }

  private triggerBossEntrySlowMo(): void {
    this.slowMoRemaining = 0.8;
    this.slowMoTotal = 0.8;
    this.triggerCanvasShake();
  }

  private triggerBossDeathSlowMo(): void {
    this.slowMoRemaining = 0.3;
    this.slowMoTotal = 0.3;
    this.screenFlash = 0.15;
  }

  /**
   * Update low-HP vignette intensity on the canvas wrap element.
   * Called from update() each frame. Writes are cached so DOM is only mutated
   * when the value actually changes (e.g. when crossing the 30% HP threshold
   * or as intensity changes by a noticeable amount).
   */
  private updateVignette(): void {
    if (!this.canvasWrap) return;
    const t = this.tower.snapshot;
    const ratio = t.maxHp > 0 ? t.hp / t.maxHp : 0;
    if (ratio > 0 && ratio <= 0.3) {
      const intensity = (0.3 - ratio) / 0.3; // 0 at 30%, 1 at 0%
      toggleClass(this.canvasWrap, 'is-critical', true);
      setStyle(this.canvasWrap, '--vignette-alpha', (0.35 + intensity * 0.5).toFixed(3));
    } else {
      toggleClass(this.canvasWrap, 'is-critical', false);
    }
  }

  get upgradeManager(): UpgradeManager {
    return this.upgradeMgr;
  }

  get resources(): ResourceManager {
    return this.resourceMgr;
  }

  get waves(): WaveManager {
    return this.waveMgr;
  }

  get enemies(): EnemyManager {
    return this.enemyMgr;
  }

  get projectiles(): ProjectileManager {
    return this.projectileMgr;
  }

  get towerSystem(): Tower {
    return this.tower;
  }

  get abilities(): AbilityManager {
    return this.abilityMgr;
  }

  get prestige(): PrestigeManager {
    return this.prestigeMgr;
  }

  get research(): ResearchTree {
    return this.researchTree;
  }

  get audioMgr(): AudioManager {
    return this.audio;
  }

  castAbility(id: AbilityId): boolean {
    return this.abilityMgr.tryCast(id, this.state.wave.highestWave);
  }

  upgradeAbility(id: AbilityId): boolean {
    const def = ABILITIES.find(a => a.id === id);
    if (!def) return false;
    if (this.state.wave.highestWave < def.unlockWave) return false;
    return this.abilityMgr.upgradeAbility(id);
  }

  canUpgradeAbility(id: AbilityId): boolean {
    return this.abilityMgr.canUpgrade(id, this.state.wave.highestWave);
  }

  unlockPassive(id: string): boolean {
    if (!this.passiveMgr.canUnlock(id, this.state.wave.highestWave)) return false;
    const cost = this.passiveMgr.getUnlockCost(id);
    if (cost <= 0 || this.state.resources.gold < cost) return false;
    this.state.resources.gold -= cost;
    this.passiveMgr.unlock(id);
    this.applyUpgradeEffects();
    this.bus.emit('gold_changed', this.state.resources.gold);
    return true;
  }

  upgradePassive(id: string): boolean {
    const cost = this.passiveMgr.getUpgradeCost(id);
    if (cost <= 0 || this.state.resources.gold < cost) return false;
    this.state.resources.gold -= cost;
    const spent = this.passiveMgr.upgrade(id);
    if (spent <= 0) {
      this.state.resources.gold += cost;
      return false;
    }
    this.applyUpgradeEffects();
    this.bus.emit('gold_changed', this.state.resources.gold);
    return true;
  }

  /**
   * Rewind to the previous wave with a fresh tower. Used both by the
   * pre-ascension death path and by the run-over modal's "retry" option.
   */
  restartCurrentWave(): void {
    const ts = this.tower.snapshot;
    this.enemyMgr.reset();
    this.projectileMgr.reset();
    this.mines = [];
    ts.shieldCurrentCharges = ts.shieldMaxCharges;
    ts.shieldRechargeTimer = 0;
    ts.hp = TOWER_BASE.hp;
    ts.maxHp = TOWER_BASE.maxHp;
    this.waveMgr.startAtWave(Math.max(1, this.waveMgr.currentWave - 1));
    this.state.wave = this.waveMgr.snapshot;
    this.applyUpgradeEffects();
  }

  /**
   * Resolve the run-over prompt: bank the run as an ascension, or rewind a
   * wave and keep pushing. Either way the simulation resumes.
   */
  resolveRunFailure(action: 'ascend' | 'retry'): void {
    if (!this.runFailed) return;
    this.runFailed = false;
    if (action === 'ascend') {
      this.ascend();
      return;
    }
    this.restartCurrentWave();
  }

  ascend(): number {
    if (!this.prestigeMgr.canAscend(this.state.wave.highestWave)) return 0;
    const { ap } = this.prestigeMgr.performAscension(this.state);
    if (ap <= 0) return 0;
    const record = this.finalizeRun('ascension', ap, 0);
    this.applySavedStateReset();
    this.resetRunBaselines();
    this.saveMgr.save(this.state);
    this.syncUiApis();
    this.bus.emit('toast', {
      kind: 'milestone',
      text: `Ascension! +${ap} AP. Your run has been reset.`,
      life: 6,
    });
    this.bus.emit('run_ended', { record, previous: this.getPreviousRun() });
    return ap;
  }

  transcend(): number {
    const ascensionPoints = this.state.resources.apThisTranscendence;
    if (!this.prestigeMgr.canTranscend(ascensionPoints)) return 0;
    const { tp } = this.prestigeMgr.performTranscendence(this.state);
    if (tp <= 0) return 0;
    const record = this.finalizeRun('transcendence', tp, 0);
    this.applyFullTranscendenceReset();
    this.resetRunBaselines();
    this.saveMgr.save(this.state);
    this.syncUiApis();
    this.bus.emit('toast', {
      kind: 'milestone',
      text: `Transcendence! +${tp} TP. Gear, passives and talents carry over.`,
      life: 7,
    });
    this.bus.emit('run_ended', { record, previous: this.getPreviousRun() });
    return tp;
  }

  /**
   * Returns the run immediately preceding the most recent one (for delta display).
   * Since `finalizeRun` always pushes a new record at the end, the previous one
   * is at `length - 2`.
   */
  private getPreviousRun(): RunRecord | null {
    const h = this.state.runHistory;
    if (h.length < 2) return null;
    return h[h.length - 2] ?? null;
  }

  spendAP(perkId: string): boolean {
    const ok = this.prestigeMgr.spendPerk(perkId);
    if (ok) {
      this.applyUpgradeEffects();
      this.syncUiApis();
    }
    return ok;
  }

  startResearch(id: string): boolean {
    const ok = this.researchTree.startResearch(id);
    if (ok) {
      this.state.researchInProgress = this.researchTree.inProgress ? { ...this.researchTree.inProgress } : null;
      this.syncUiApis();
    }
    return ok;
  }

  cancelResearch(): boolean {
    const ok = this.researchTree.cancelResearch();
    if (ok) {
      this.state.researchInProgress = null;
      this.syncUiApis();
    }
    return ok;
  }

  setAutomationEnabled(key: AutomationKey, enabled: boolean): boolean {
    const ok = this.prestigeMgr.setAutomationEnabled(key, enabled);
    if (ok) this.syncUiApis();
    return ok;
  }

  /**
   * Plan §3.1: opt an ability out of auto-cast. Stored as an explicit `false`
   * so an unseen key keeps meaning "auto-cast this".
   */
  setAutoCastEnabled(id: AbilityId, enabled: boolean): void {
    if (enabled) {
      delete this.state.prestige.autoCastEnabled[id];
    } else {
      this.state.prestige.autoCastEnabled[id] = false;
    }
    this.syncUiApis();
  }

  /** Plan §3.6: which upgrades auto-buy reaches for first. */
  setAutoBuyStrategy(strategy: AutoBuyStrategy): void {
    this.state.prestige.autoBuyStrategy = strategy;
    // The panel reads its values from the pushed API snapshot, so a setter that
    // does not re-push leaves the control showing the old choice.
    this.syncUiApis();
  }

  /** Plan §3.6: fraction of gold auto-buy will not spend (0-0.9). */
  setAutoBuyReserve(fraction: number): void {
    this.state.prestige.autoBuyReserve = Math.max(0, Math.min(0.9, fraction));
    this.syncUiApis();
  }

  setTargetAscendWave(wave: number): void {
    this.state.prestige.targetAscendWave = Math.max(
      this.prestigeMgr.ascensionUnlockWave(),
      Math.floor(wave),
    );
    this.syncUiApis();
    this.bus.emit('toast', {
      kind: 'info',
      text: `Auto-Ascend target set to wave ${this.state.prestige.targetAscendWave}`,
      life: 2.5,
    });
  }

  private computeSpeedForIndex(index: number): number {
    if (index < GAME_SPEEDS.length) return GAME_SPEEDS[index];
    const last = GAME_SPEEDS.length - 1;
    return GAME_SPEEDS[last] + (index - last) * 0.5;
  }

  getSpeed(): number {
    return this.computeSpeedForIndex(this.speedIndex);
  }

  getSpeedIndex(): number {
    return this.speedIndex;
  }

  getMaxSpeedIndex(): number {
    return this.maxSpeedIndex;
  }

  getAvailableSpeeds(): readonly number[] {
    const result: number[] = [];
    for (let i = 0; i <= this.maxSpeedIndex; i++) {
      result.push(this.computeSpeedForIndex(i));
    }
    return result;
  }

  setSpeedIndex(index: number): boolean {
    const clamped = Math.max(0, Math.min(this.maxSpeedIndex, Math.floor(index)));
    if (clamped === this.speedIndex) return false;
    this.speedIndex = clamped;
    this.syncUiApis();
    this.bus.emit('toast', {
      kind: 'info',
      text: `Game speed: ${this.formatSpeedLabel(this.speedIndex)}`,
      life: 1.5,
    });
    return true;
  }

  cycleSpeed(direction: 1 | -1): boolean {
    const next = this.speedIndex + direction;
    if (next < 0 || next > this.maxSpeedIndex) return false;
    return this.setSpeedIndex(next);
  }

  setMaxSpeedIndex(index: number): void {
    this.maxSpeedIndex = Math.max(0, Math.floor(index));
    if (this.speedIndex > this.maxSpeedIndex) {
      this.speedIndex = this.maxSpeedIndex;
    }
  }

  private formatSpeedLabel(index: number): string {
    const v = this.computeSpeedForIndex(index);
    return Number.isInteger(v) ? `${v}x` : `${v}x`;
  }

  goToPrevWave(): boolean {
    const ok = this.waveMgr.goToPrevWave();
    if (ok) {
      this.mines = [];
      this.bus.emit('toast', { kind: 'info', text: `Restarted wave ${this.waveMgr.currentWave}`, life: 1.5 });
    }
    return ok;
  }

  goToNextWave(): boolean {
    this.mines = [];
    this.waveMgr.goToNextWave();
    this.bus.emit('toast', { kind: 'info', text: `Skipped to wave ${this.waveMgr.currentWave}`, life: 1.5 });
    return true;
  }

  setMouseInput(x: number, y: number, isDown: boolean): void {
    this.mouseX = x;
    this.mouseY = y;
    this.mouseDown = isDown;
  }

  isAutoProgress(): boolean {
    return this.waveMgr.getAutoProgress();
  }

  setAutoProgress(enabled: boolean): void {
    this.waveMgr.setAutoProgress(enabled);
    this.syncUiApis();
    this.bus.emit('toast', {
      kind: 'info',
      text: enabled ? 'Auto-Progress: ON' : 'Auto-Progress: OFF (repeats the same wave)',
      life: 2,
    });
  }

  toggleAutoProgress(): boolean {
    const next = !this.isAutoProgress();
    this.setAutoProgress(next);
    return next;
  }

  canGoPrevWave(): boolean {
    return this.waveMgr.canGoPrev();
  }

  reasonResearchBlocked(id: string): string | null {
    return this.researchTree.reasonBlocked(id);
  }

  hasSave(): boolean {
    return this.saveMgr.hasSave();
  }

  tryLoadSave(): OfflineResult | null {
    const persisted = this.saveMgr.load();
    if (!persisted) return null;
    this.saveLoaded = true;
    this.applyPersistedState(persisted);
    const result = this.saveMgr.computeOfflineProgress(persisted, this.computeGoldMultiplier());
    if (result.elapsedSeconds > 0) {
      const startWave = this.state.wave.number;
      this.saveMgr.applyOfflineProgress(this.state, result);
      this.applyOfflineWave(result.endWave);
      if (result.rpEarned > 0) this.researchTree.addRP(result.rpEarned);
      this.researchTree.setSpeedMultiplier(this.prestigeMgr.getResearchSpeedMultiplier());
      if (this.researchTree.advanceResearch(result.researchElapsed)) {
        this.state.research = this.researchTree.getLevelsSnapshot();
      }
      this.state.researchInProgress = this.researchTree.inProgress
        ? { id: this.researchTree.inProgress.id, elapsed: this.researchTree.inProgress.elapsed, targetLevel: this.researchTree.inProgress.targetLevel }
        : null;
      this.applyUpgradeEffects();
      this.state.upgrades = this.upgradeMgr.snapshot();
      const endWave = this.state.wave.number;
      if (result.elapsedSeconds >= MIN_OFFLINE_REPORT_SECONDS) {
        this.bus.emit('welcome_back', {
          result,
          startWave,
          endWave,
        });
      }
      this.saveMgr.save(this.state);
    } else {
      this.applyUpgradeEffects();
      this.state.upgrades = this.upgradeMgr.snapshot();
    }
    this.syncUiApis();
    return result;
  }

  manualSave(): boolean {
    return this.saveMgr.save(this.state);
  }

  clearSave(): void {
    this.saveMgr.clear();

    const fresh = makeInitialState();

    Object.assign(this.state.tower, fresh.tower);
    Object.assign(this.state.resources, fresh.resources);
    Object.assign(this.state.prestige, fresh.prestige);
    Object.assign(this.state.stats, fresh.stats);
    this.state.achievements.length = 0;
    for (const id of Object.keys(this.state.abilities)) {
      Object.assign(this.state.abilities[id], fresh.abilities[id]);
    }

    this.waveMgr.reset();
    this.state.wave = this.waveMgr.snapshot;
    this.saveLoaded = false;

    this.upgradeMgr.reset();
    this.resourceMgr.reset();
    this.enemyMgr.reset();
    this.projectileMgr.reset();
    this.abilityMgr.reset();
    this.effects.reset();
    this.automation.reset();
    this.researchTree.replaceLevels({}, 0, null);
    this.notifications.reset();
    this.mines = [];
    this.announcedMilestones.clear();
    this.researchAnnounced.clear();
    this.achievementMgr.reset();

    // v6+: Reset RPG state to fresh defaults
    Object.assign(this.state.towerXp, fresh.towerXp);
    this.state.talents.allocated = {};
    const pa = this.state.passiveAbilities;
    for (const k of Object.keys(pa)) delete pa[k];
    this.passiveMgr.ensureInitialized();
    this.state.equipment.length = 0;
    const eqMap = this.state.equipped;
    for (const k of Object.keys(eqMap)) delete (eqMap as Record<string, Equipment>)[k];
    this.blessingModal.hide();
    this.blessingMgr.reset();
    this.state.blessings = this.blessingMgr.snapshot();

    this.tower.setPosition(this.canvas.width / 2, this.canvas.height / 2);
    this.applyUpgradeEffects();
    this.state.upgrades = this.upgradeMgr.snapshot();
    this.state.research = {};
    this.state.researchInProgress = null;
    this.state.runHistory = [];
    this.bestGoldRun = 0;
    this.bestWaveRun = 1;
    this.resetRunBaselines();
    this.syncUiApis();

    this.saveMgr.save(this.state);
  }

  get eventBus(): EventBus {
    return this.bus;
  }

  get gameState(): GameState {
    return this.state;
  }

  private resetRunBaselines(): void {
    this.runBaselineGold = this.state.stats.goldEarned;
    this.runBaselineKills = this.state.stats.enemiesKilled;
    this.runBaselineAbilities = this.state.stats.abilitiesCast;
    this.runBaselineHighestWave = this.state.wave.highestWave;
    this.state.runStartedAt = Date.now();
    this.state.stats.runStartedAt = this.state.runStartedAt;
  }

  /**
   * Build a RunRecord from current state + deltas since the last reset,
   * push it into the run history ring buffer, and reset run-scoped state
   * (baselines + runStartedAt + lifetime record-tracking flags).
   */
  private finalizeRun(kind: 'ascension' | 'transcendence', currencyGained: number, rpGained: number): RunRecord {
    const now = Date.now();
    const stats = this.state.stats;
    const goldEarned = Math.max(0, stats.goldEarned - this.runBaselineGold);
    const enemiesKilled = Math.max(0, stats.enemiesKilled - this.runBaselineKills);
    const abilitiesCast = Math.max(0, stats.abilitiesCast - this.runBaselineAbilities);
    const highestWave = Math.max(this.state.wave.highestWave, this.runBaselineHighestWave);
    const newRecordGold = goldEarned > this.bestGoldRun;
    const newRecordWave = highestWave > this.bestWaveRun;
    if (newRecordGold) this.bestGoldRun = goldEarned;
    if (newRecordWave) this.bestWaveRun = highestWave;
    const record: RunRecord = {
      endedAt: now,
      kind,
      highestWave,
      durationSeconds: Math.max(0, Math.floor((now - this.state.runStartedAt) / 1000)),
      goldEarned,
      enemiesKilled,
      abilitiesCast,
      currencyGained,
      rpGained,
      newRecordGold,
      newRecordWave,
    };
    const hist = this.state.runHistory ?? [];
    hist.push(record);
    while (hist.length > MAX_RUN_HISTORY) hist.shift();
    this.state.runHistory = hist;
    return record;
  }

  /**
   * The one place gold multipliers are composed. Every source contributes
   * exactly once: additive sources are summed and scaled by the research/TP
   * multipliers (matching the historical `1 + additive` shape), then the
   * remaining sources multiply on top. Both `applyUpgradeEffects` (what is
   * applied) and `computeStatsInfo` (what is displayed) call this, so the two
   * can never disagree.
   */
  /**
   * Passive RP gain multiplier: research nodes plus the achievement reward.
   * Kept in one place so every read (HUD, research panel, the actual gain)
   * agrees.
   */
  private rpGainMultiplier(): number {
    return this.researchTree.getRPGainMultiplier()
      + this.achievementMgr.getRewardMultiplier('rp_gain_mult');
  }

  /**
   * The composed gold multiplier currently in effect — the exact number
   * `EnemyManager` is multiplying drops by, not a second computation of it.
   */
  private computeGoldMultiplier(): number {
    return this.lastResolved?.goldMultiplier ?? 1;
  }

  /**
   * The same multiplier plus its per-source attribution (plan §4.2).
   *
   * Built by re-resolving the *same context* the applied stats came from, with
   * breakdown collection turned on. There is no second formula to drift, so a
   * tooltip that disagrees with the applied number is not expressible.
   */
  private computeGoldBreakdown(): { multiplier: number; sources: GoldSourceEntry[] } {
    const ctx = this.lastStatContext;
    if (!ctx) return { multiplier: 1, sources: [] };
    const { stats, breakdown } = resolveStats(ctx, { breakdown: true });
    return { multiplier: stats.goldMultiplier, sources: goldSourceEntries(breakdown) };
  }

  private computeStatsInfo(): StatsInfo {
    const t = this.tower.snapshot;
    const r = this.state.resources;
    const gold = this.computeGoldBreakdown();
    const effectiveCritChance = this.tower.effectiveCritChance;
    const effectiveCritDamage = this.tower.effectiveCritMultiplier;
    const effectiveLs = this.tower.effectiveLifesteal;
    const expectedHit = t.baseDamage * (1 + effectiveCritChance * (effectiveCritDamage - 1));
    const dps = expectedHit * t.fireRate;
    return {
      damage: t.baseDamage,
      dps,
      hp: t.hp,
      maxHp: t.maxHp,
      healthRegen: this.tower.effectiveHealthRegen,
      critChance: effectiveCritChance,
      critDamage: effectiveCritDamage,
      range: t.range,
      fireRate: t.fireRate,
      defense: t.defense,
      armor: t.armor,
      lifesteal: effectiveLs,
      thorns: t.thorns,
      manaRegen: r.manaRegen,
      maxMana: r.maxMana,
      goldMultiplier: gold.multiplier,
      goldSources: gold.sources,
      rpGainRate: this.researchTree.getPassiveRPRate(
        this.state.stats.lifetimeHighestWave,
        this.rpGainMultiplier(),
      ),
    };
  }

  private syncUiApis(): void {
    this.ui.setStatsInfo(this.computeStatsInfo());
    this.ui.setPrestigeAPI({
      canAscend: (wave) => this.prestigeMgr.canAscend(wave),
      canTranscend: (ap) => this.prestigeMgr.canTranscend(ap),
      previewAP: (wave) => this.prestigeMgr.previewAP(wave),
      previewTP: (lap) => this.prestigeMgr.previewTP(lap),
      canSpend: (perkId, ap, tp) => this.prestigeMgr.canSpendAP(perkId) && ap >= 1 || this.prestigeMgr.canSpendTP(perkId) && tp >= 1,
      isAutomationUnlocked: (key) => this.prestigeMgr.isAutomationUnlocked(key),
      isAutomationEnabled: (key) => this.prestigeMgr.getAutomationEnabled(key),
      meetsPrerequisites: (perkId) => this.prestigeMgr.meetsPrerequisites(perkId),
      isExcluded: (perkId) => this.prestigeMgr.isExcluded(perkId),
      perkBlockedReason: (perkId) => this.prestigeMgr.perkBlockedReason(perkId),
      ascendUnlockWave: this.prestigeMgr.ascensionUnlockWave(),
      transcendUnlockAP: this.prestigeMgr.transcendenceUnlockAP(),
      targetAscendWave: this.state.prestige.targetAscendWave,
      autoBuyStrategy: this.state.prestige.autoBuyStrategy,
      autoBuyReserve: this.state.prestige.autoBuyReserve,
      setAutoBuyStrategy: (strategy) => this.setAutoBuyStrategy(strategy),
      setAutoBuyReserve: (fraction) => this.setAutoBuyReserve(fraction),
    });
    this.ui.setResearchAPI({
      rp: this.researchTree.rp,
      levels: this.researchTree.getLevelsSnapshot(),
      unlocked: this.researchTree.unlocked,
      reasonBlocked: (id) => this.researchTree.reasonBlocked(id),
      inProgress: this.researchTree.inProgress,
      researchSpeedMultiplier: this.prestigeMgr.getResearchSpeedMultiplier(),
      rpGainRate: this.researchTree.getPassiveRPRate(
        this.state.stats.lifetimeHighestWave,
        this.rpGainMultiplier(),
      ),
    });
    this.maxSpeedIndex = MAX_SPEED_INDEX + this.prestigeMgr.getGameSpeedBonus();
    this.ui.setSpeedAPI({
      speeds: this.getAvailableSpeeds(),
      currentIndex: this.getSpeedIndex(),
      maxIndex: this.getMaxSpeedIndex(),
    });
    this.ui.setWaveControlAPI({
      autoProgress: this.waveMgr.getAutoProgress(),
      currentWave: this.waveMgr.currentWave,
      isIntermission: this.state.wave.intermission,
    });
    this.ui.setAbilityAPI({
      canCast: (id, wave) => this.abilityMgr.canCast(id, wave),
      reasonBlocked: (id, wave) => this.abilityMgr.reasonBlocked(id, wave),
      canUpgrade: (id, wave) => this.abilityMgr.canUpgrade(id, wave),
      isMaxed: (id) => this.abilityMgr.isMaxed(id),
      getUpgradeCost: (id) => this.abilityMgr.getUpgradeCost(id),
      getEffectiveStats: (id) => this.abilityMgr.getEffectiveStats(id),
      getXp: (id) => this.abilityMgr.getXp(id),
      isAutoCastUnlocked: () => this.prestigeMgr.isAutomationUnlocked('autoAbilities'),
      isAutoCastEnabled: (id) => this.state.prestige.autoCastEnabled[id] !== false,
      onToggleAutoCast: (id, enabled) => this.setAutoCastEnabled(id, enabled),
    });
    this.ui.setTalentAPI({
      allocated: this.state.talents.allocated,
      unspentPoints: () => this.state.towerXp.unspentTalentPoints,
      canAllocate: (id) => this.talentMgr.canAllocate(id),
      allocate: (id) => this.talentMgr.allocate(id),
      refundBranch: (branch) => this.talentMgr.refundBranch(branch),
      refundAll: () => this.talentMgr.refundAll(),
      branchRespecCost: (branch) => this.talentMgr.branchRespecCost(branch),
      fullRespecCost: () => this.talentMgr.fullRespecCost(),
      gold: () => this.state.resources.gold,
    });
    this.ui.setPassiveAPI({
      getLevel: (id) => this.passiveMgr.getLevel(id),
      getXp: (id) => this.passiveMgr.getXp(id),
      highestWave: this.state.wave.highestWave,
      isUnlocked: (id) => this.passiveMgr.isUnlocked(id),
      isMaxed: (id) => this.passiveMgr.isMaxed(id),
      canUnlock: (id) => this.passiveMgr.canUnlock(id, this.state.wave.highestWave),
      getUnlockCost: (id) => this.passiveMgr.getUnlockCost(id),
      onUnlock: (id) => this.unlockPassive(id),
      getUpgradeCost: (id) => this.passiveMgr.getUpgradeCost(id),
      canUpgrade: (id) => this.passiveMgr.canUpgrade(id, this.state.resources.gold),
      onUpgrade: (id) => this.upgradePassive(id),
    });
    this.ui.setAutoPickBlessingsState(
      this.blessingAutoPickActive(),
      this.blessingAutoPickForced(),
    );
    this.ui.setBlessingAPI(() => ({
      held: this.blessingMgr.heldList(),
      picksTaken: this.blessingMgr.picks,
      rerolls: this.blessingMgr.rerollsAvailable,
      nextDraftWave: this.nextBlessingDraftWave(),
    }));
    this.ui.setEquipmentAPI({
      inventory: this.state.equipment,
      equipped: this.state.equipped,
      equip: (slot: EquipmentSlot, id: string) => this.equipmentMgr.equip(slot, id),
      unequip: (slot: EquipmentSlot) => this.equipmentMgr.unequip(slot),
      getSellValue: (id: string) => this.equipmentMgr.getSellValue(id),
      onSell: (id: string) => {
        const gold = this.equipmentMgr.sell(id);
        if (gold > 0) {
          this.state.resources.gold += gold;
          this.state.resources.lifetimeGold += gold;
          this.state.stats.goldEarned += gold;
          this.bus.emit('gold_changed', this.state.resources.gold);
        }
      },
    });
  }

  private migrateUpgrades(levels: Record<string, number>): void {
    const oldSize = levels['shockwaveSize'] ?? 0;
    const oldCooldown = levels['shockwaveCooldown'] ?? 0;
    if (oldSize > 0 || oldCooldown > 0) {
      const merged = Math.max(oldSize, oldCooldown);
      levels['shockwave'] = Math.min(50, merged);
    }
    delete levels['shockwaveSize'];
    delete levels['shockwaveCooldown'];
  }

  /**
   * Recompute every stat from scratch and write the result.
   *
   * This is the only path in the game that may change a tower stat. It
   * snapshots each system's contribution into an immutable `StatContext`, runs
   * the single composition pass in `resolveStats`, and writes the result out.
   * Because no system touches `TowerState` itself, the order they contribute
   * in cannot change the answer — which is what the old 300-line version got
   * wrong six different ways (plan §1.1, §1.2, §6).
   */
  private applyUpgradeEffects(): void {
    const ctx = this.buildStatContext();
    const { stats } = resolveStats(ctx);
    this.lastStatContext = ctx;
    this.lastResolved = stats;
    this.appliedBuffVersion = this.buffs.version;
    this.applyResolvedStats(stats);
    this.state.research = this.researchTree.getLevelsSnapshot();
  }

  /**
   * Recompute only if a buff has started or expired since the last pass. Called
   * once per simulation substep, so a buff edge costs one resolve rather than a
   * resolve every frame.
   */
  private refreshBuffedStats(): void {
    if (this.buffs.version === this.appliedBuffVersion) return;
    this.applyUpgradeEffects();
  }

  /**
   * Snapshot every contributor into the pipeline's input.
   *
   * Nothing here computes: each field is one system's own answer about its own
   * contribution. Composition happens exactly once, in `resolveStats`.
   */
  private buildStatContext(): StatContext {
    const t = this.tower.snapshot;

    const evolutions: Partial<Record<EvolutionEffectId, number>> = {};
    for (const id of EVOLUTION_EFFECT_IDS) {
      // Presence-only evolutions (Crits Ignore Armor) carry no magnitude, so
      // they contribute as 1 rather than dropping out as 0.
      const value = this.upgradeMgr.getEvolutionEffectValue(id)
        || (this.upgradeMgr.hasEvolutionEffect(id) ? 1 : 0);
      if (value !== 0) evolutions[id] = value;
    }

    const achievements: Partial<Record<AchievementRewardType, number>> = {};
    for (const type of Object.keys(ACHIEVEMENT_REWARD_CONSUMERS) as AchievementRewardType[]) {
      const value = this.achievementMgr.getRewardMultiplier(type);
      if (value !== 0) achievements[type] = value;
    }

    const talentValues = this.talentMgr.getAllEffectValues();
    const talents: Partial<Record<TalentStat, number>> = {};
    for (const stat of TALENT_STATS) {
      const value = talentValues.get(stat) ?? 0;
      if (value !== 0) talents[stat] = value;
    }

    const passives: Partial<Record<PassiveStat, number>> = {};
    for (const stat of PASSIVE_STATS) {
      const value = this.passiveMgr.getEffectValue(stat);
      if (value !== 0) passives[stat] = value;
    }

    const equipped = this.equipmentMgr.getEquippedBonuses();
    const equipment: Partial<Record<EquipmentStatType, number>> = {};
    for (const stat of EQUIPMENT_STAT_TYPES) {
      const value = equipped[stat] ?? 0;
      if (value !== 0) equipment[stat] = value;
    }

    const lifetime = this.prestigeMgr.getLifetimeAPBonus();
    return {
      wave: this.waveMgr.currentWave,
      hpFraction: t.maxHp > 0 ? t.hp / t.maxHp : 1,
      upgrades: this.upgradeMgr.snapshot(),
      evolutions,
      prestige: {
        lifetimeDamage: lifetime.damage,
        lifetimeGold: lifetime.gold,
        apDamage: this.prestigeMgr.getAPDamageBonus(),
        apGold: this.prestigeMgr.getAPGoldBonus(),
        tpDamage: this.prestigeMgr.getTPDamageMultiplicative(),
        tpFireRate: this.prestigeMgr.getTPFireRateMultiplier(),
        tpManaRegen: this.prestigeMgr.getTPManaRegenMultiplier(),
        tpResource: this.prestigeMgr.getTPResourceMultiplicative(),
        tpCritDamage: this.prestigeMgr.getTPCritDamageBonus(),
        tpPierce: this.prestigeMgr.getTPPierceBonus(),
        abilityManaCostReduction: this.prestigeMgr.getAbilityManaCostReduction(),
        abilityCdr: this.prestigeMgr.getAbilityCDR(),
        treasureChance: this.prestigeMgr.getTreasureChance(),
        waveSkipChance: this.prestigeMgr.getWaveSkipChance(),
        hasExecuteDamage: this.prestigeMgr.hasExecuteDamage(),
        executeDamageMultiplier: this.prestigeMgr.getExecuteDamageMultiplier(),
      },
      research: {
        goldMultiplicative: this.researchTree.getGoldMultiplicative(),
        manaRegenMultiplicative: this.researchTree.getManaRegenMultiplicative(),
        abilityCostReduction: this.researchTree.getAbilityCostReduction(),
        abilityPowerBonus: this.researchTree.getAbilityPowerBonus(),
        pierceCount: this.researchTree.getPierceCount(),
        goldLuckChance: this.researchTree.getGoldLuckChance(),
        intermissionSpeedReduction: this.researchTree.getIntermissionSpeedReduction(),
        enemyHpReduction: this.researchTree.getEnemyHPReduction(),
        rpDropChanceBonus: this.researchTree.getRPDropChanceBonus(),
      },
      achievements,
      talents,
      passives,
      equipment,
      blessings: {
        // Already summed across stacks by the manager's rebuilt cache, so the
        // context stays plain data and the contributor stays a switch.
        stats: this.blessingMgr.getStatTotals(),
        behaviors: this.blessingBehaviors(),
      },
      waveModifier: this.activeWaveModifierInputs(),
      buffs: this.buffs.entries,
    };
  }

  /** The next wave whose clear earns a draft, or null once the cap is hit. */
  private nextBlessingDraftWave(): number | null {
    if (this.blessingMgr.isCapped) return null;
    const current = this.waveMgr.currentWave;
    let wave = Math.max(BLESSING_FIRST_DRAFT_WAVE, current);
    while (!this.blessingMgr.isDraftDue(wave)) wave += 1;
    return wave;
  }

  /** Behaviors held, for the two that resolve as stats rather than hooks. */
  private blessingBehaviors(): BlessingBehavior[] {
    const out: BlessingBehavior[] = [];
    if (this.blessingMgr.has('last_stand')) out.push('last_stand');
    return out;
  }

  /**
   * The wave mutator's tower-side effects, or null when none is running on the
   * current wave. Its enemy-side effects are applied separately, in
   * `applyActiveWaveModifier`.
   */
  private activeWaveModifierInputs(): { goldAdditive: number; playerDamageMult: number } | null {
    const wms = this.state.wave.waveModifier;
    const active = wms.active;
    if (!active || wms.wavesRemaining <= 0 || wms.pendingChoiceForWave === null) return null;
    if (this.waveMgr.currentWave < wms.pendingChoiceForWave) return null;
    return {
      goldAdditive: active.effects.goldAdditive,
      playerDamageMult: active.effects.playerDamageMult,
    };
  }

  /**
   * Write one resolved stat block out to the tower and every manager that
   * caches a derived number.
   *
   * The three places that need memory across recomputes — current HP, shield
   * charges and wall HP — are handled here rather than in the resolver, since
   * they depend on live run state the context deliberately does not carry.
   */
  private applyResolvedStats(stats: ResolvedStats): void {
    const t = this.tower.snapshot;
    const oldMaxHp = t.maxHp;
    const oldHp = t.hp;

    t.baseDamage = stats.baseDamage;
    t.fireRate = stats.fireRate;
    t.range = stats.range;
    t.critChance = stats.critChance;
    t.critMultiplier = stats.critMultiplier;
    t.healthRegen = stats.healthRegen;
    t.defense = stats.defense;
    t.armor = stats.armor;
    t.knockbackForce = stats.knockbackForce;
    t.lifesteal = stats.lifesteal;
    t.thorns = stats.thorns;
    t.shockwaveSize = stats.shockwaveSize;
    t.shockwaveCooldown = stats.shockwaveCooldown;
    t.landMineDamage = stats.landMineDamage;
    t.landMineFrequency = stats.landMineFrequency;
    t.shieldRechargeTime = stats.shieldRechargeTime;
    t.doubleShotChance = stats.doubleShotChance;
    t.quickShotChance = stats.quickShotChance;
    t.quickShotTime = stats.quickShotTime;

    // HP keeps its fraction of max when max rises, so buying Fortify heals
    // proportionally rather than leaving a debt; a drop just clamps.
    t.maxHp = stats.maxHp;
    if (oldMaxHp <= 0) {
      t.hp = t.maxHp;
    } else if (t.maxHp > oldMaxHp && oldHp > 0) {
      t.hp = Math.min(t.maxHp, oldHp * (t.maxHp / oldMaxHp));
    } else if (t.hp > t.maxHp) {
      t.hp = t.maxHp;
    }

    const oldCharges = t.shieldMaxCharges;
    t.shieldMaxCharges = stats.shieldMaxCharges;
    if (t.shieldMaxCharges > oldCharges) {
      t.shieldCurrentCharges += t.shieldMaxCharges - oldCharges;
    }
    t.shieldCurrentCharges = Math.max(0, Math.min(t.shieldCurrentCharges, t.shieldMaxCharges));

    const oldWallMax = t.wallMaxHp;
    const newWallMax = stats.wallFraction > 0
      ? Math.max(1, Math.floor(t.maxHp * stats.wallFraction))
      : 0;
    if (newWallMax <= 0) {
      t.wallHp = 0;
    } else if (oldWallMax <= 0) {
      t.wallHp = newWallMax;
    } else if (newWallMax > oldWallMax && t.wallHp > 0) {
      t.wallHp = Math.min(
        newWallMax,
        t.wallHp + Math.floor((newWallMax - oldWallMax) * (t.wallHp / oldWallMax)),
      );
    } else if (t.wallHp > newWallMax) {
      t.wallHp = newWallMax;
    }
    t.wallMaxHp = newWallMax;

    this.state.resources.manaRegen = stats.manaRegen;
    this.state.resources.maxMana = stats.maxMana;

    this.enemyMgr.setGoldMultiplier(stats.goldMultiplier);
    this.enemyMgr.setThorns(stats.thorns);
    this.enemyMgr.setGoldLuck(stats.goldLuckChance, GOLD_LUCK_MULTIPLIER);
    this.enemyMgr.setGoldOnKillBonus(stats.goldOnKill);
    this.enemyMgr.setCritGoldBonus(stats.critGold);
    this.enemyMgr.setDoubleGoldChance(stats.doubleGoldChance);
    this.enemyMgr.setHPReduction(stats.enemyHpReduction);
    this.enemyMgr.setRPDropChanceBonus(stats.rpDropChanceBonus);
    this.enemyMgr.setWallContactExtra(stats.wallContactExtra);
    // Blessing trade-off cards move the *enemies*, not the tower — but they
    // still resolve through the pipeline, so they compose with the wave
    // mutator's own multipliers instead of one silently winning (plan §1.4).
    this.enemyMgr.setBlessingSpeedMult(stats.enemySpeedMult);
    this.enemyMgr.setBlessingHpMult(stats.enemyHpMult);
    this.enemyMgr.setBlessingDamageMult(stats.enemyDamageMult);

    this.abilityMgr.setAbilityCostMultiplier(stats.abilityCostMultiplier);
    this.abilityMgr.setCooldownMultiplier(stats.abilityCooldownMultiplier);
    this.abilityMgr.setDamageMultiplier(stats.abilityDamageMultiplier);
    this.abilityMgr.setBerserkFireBonus(stats.berserkFireBonus);
    this.abilityMgr.setChainBounceBonus(stats.chainBounceBonus);
    this.abilityMgr.setSlowStrengthBonus(stats.slowStrengthBonus);
    this.abilityMgr.setMeteorDamageBonus(stats.meteorDamageBonus);
    this.abilityMgr.setBuffDurationBonus(stats.buffDurationBonus);

    this.projectileMgr.setDamageMultipliers(0, 1);
    this.projectileMgr.setArmorPen(stats.armorPen);
    this.projectileMgr.setArmorPenFlat(stats.armorPenFlat);
    this.projectileMgr.setPierceExtra(stats.pierceExtra);
    this.projectileMgr.setExecuteBonus(stats.executeThreshold, stats.executeMultiplier);
    this.projectileMgr.setTalentExecuteBonus(stats.talentExecuteBonus);
    this.projectileMgr.setEvolutionCombatEffects(
      stats.instantKillChance,
      stats.critSplash,
      stats.critIgnoreArmor > 0,
    );

    this.towerXpMgr.setXpGainMultiplier(stats.xpGainMultiplier);
    this.upgradeMgr.setCostDiscount(stats.upgradeCostDiscount);
    this.equipmentMgr.setFindChanceBonus(stats.equipmentFindChance);
    this.automation.setAutoBuyIntervalReduction(stats.autoBuyIntervalReduction);
    this.waveMgr.setWaveSkipChance(stats.waveSkipChance);
    this.waveMgr.setIntermissionMultiplier(stats.intermissionMultiplier);

    this.waveGoldBonus = stats.waveGold;
    this.talentDodgeChance = stats.dodgeChance;
    this.talentManaShieldFraction = stats.manaShieldFraction;
    this.talentExtraProjectileChance = stats.extraProjectileChance;
    this.talentMagicProcChance = stats.magicProcChance;
    this.talentWallRegen = stats.wallRegen;
    this.talentHeadStartWaves = stats.headStartWaves;
  }

  private buildShotVariants(): ShotVariant[] {
    const variants: ShotVariant[] = [{}];
    const extra = this.prestigeMgr.getExtraShots()
      + Math.floor(this.achievementMgr.getRewardMultiplier('extra_projectile'));
    for (let i = 0; i < extra; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const lane = Math.floor(i / 2) + 1;
      variants.push({ posOffsetX: 0, posOffsetY: side * 10 * lane });
    }
    const scatter = this.prestigeMgr.getScatterShots();
    for (let lvl = 0; lvl < scatter; lvl++) {
      const angle = Math.min((30 + 15 * lvl) * Math.PI / 180, 75 * Math.PI / 180);
      variants.push({ angleOffset: -angle });
      variants.push({ angleOffset: angle });
    }
    const back = this.prestigeMgr.getBackShots();
    for (let i = 0; i < back; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const lane = Math.floor(i / 2) + (i != 1 ? 1 : 0);
      variants.push({ angleOffset: Math.PI, posOffsetY: side * 10 * lane });
    }
    return variants;
  }

  private applySavedStateReset(): void {
    this.upgradeMgr.reset();
    this.resourceMgr.reset();
    this.enemyMgr.reset();
    this.projectileMgr.reset();
    this.abilityMgr.reset();
    this.effects.reset();
    // Plan §2.6: passives and equipment are *character* progression, like
    // talents and tower XP — they persist through an ascension and are only
    // wiped by a transcendence. Wiping the inventory every run made the whole
    // loot system per-run, and since gear only drops from bosses at a 15% base
    // chance most runs generated two to four items and then deleted them.
    this.mines = [];
    this.reviveUsed = false;
    this.runFailed = false;
    this.killStreak = 0;
    this.manaFullGoldTimer = 0;
    this.shotCounter = 0;
    this.mortarShotCounter = 0;
    // Blessings are run-scoped by design (plan §1.5): being wiped is what makes
    // one run distinct from the next rather than a continuation of it. This
    // path is shared by ascension and transcendence.
    this.blessingModal.hide();
    this.waveMgr.resumeIntermission();
    this.blessingMgr.reset();
    this.state.blessings = this.blessingMgr.snapshot();
    this.buffs.reset();
    const t = this.tower.snapshot;
    t.cooldown = 0;
    t.hp = TOWER_BASE.hp;
    t.maxHp = TOWER_BASE.maxHp;
    t.shieldCurrentCharges = 0;
    t.shieldRechargeTimer = 0;

    const startWave = Math.max(
      this.researchTree.getStartWave(),
      this.prestigeMgr.getWaveStartBonus(),
      this.talentHeadStartWaves > 0 ? this.talentHeadStartWaves + 1 : 0,
    );
    if (startWave > 1) {
      this.waveMgr.startAtWave(startWave);
      this.state.wave.highestWave = startWave;
    } else {
      this.waveMgr.reset();
    }
    this.state.wave = this.waveMgr.snapshot;
    if (startWave > 1) {
      const startGold = Math.max(50, Math.floor(Math.pow(1.1, startWave - 1) * 60));
      this.state.resources.gold += startGold;
    }

    const headStartGold = this.prestigeMgr.getStartGold()
      + this.achievementMgr.getRewardMultiplier('start_gold');
    if (headStartGold > 0) {
      this.state.resources.gold += headStartGold;
    }

    this.applyUpgradeEffects();
    this.state.upgrades = this.upgradeMgr.snapshot();
  }

  /**
   * Apply the active wave modifier to enemy + tower systems for the current
   * wave. If no modifier is active, reset all multipliers to 1.
   */
  private applyActiveWaveModifier(): void {
    const wms = this.state.wave.waveModifier;
    const active = wms.active;
    // Plan §3.3: the modifier applies to a *range* of waves now, not one.
    const matchesWave = wms.wavesRemaining > 0
      && wms.pendingChoiceForWave !== null
      && this.waveMgr.currentWave >= wms.pendingChoiceForWave;
    if (!active || !matchesWave) {
      this.state.wave.waveModifier.active = null;
      this.waveMgr.setEnemyCountMult(1);
      this.enemyMgr.setSpeedMult(1);
      this.enemyMgr.setDamageToTowerMult(1);
      this.enemyMgr.setHPMult(1);
      this.applyUpgradeEffects();
      return;
    }
    const e = active.effects;
    this.waveMgr.setEnemyCountMult(e.countMult);
    this.enemyMgr.setSpeedMult(e.speedMult);
    this.enemyMgr.setDamageToTowerMult(e.damageToTowerMult);
    this.enemyMgr.setHPMult(e.hpMult);
    // playerDamageMult + goldAdditive go through the upgrade-effects pipeline
    // so they compose with prestige / research multipliers.
    this.applyUpgradeEffects();
    this.bus.emit('wave_modifier_active', active);
  }

  /**
   * Plan §3.3: rough gold a wave is worth right now, used to turn a mutator's
   * "×4 gold" into a number the player can compare against. Deliberately a
   * heuristic — normal-enemy drop x spawn count x the composed gold multiplier —
   * because the exact figure depends on which enemy types roll.
   */
  private estimateWaveGold(wave: number): number {
    const perEnemy = goldDropForWave(ENEMY_DEFS.normal.baseGold, wave);
    const count = spawnCountForWave(wave);
    return Math.max(0, perEnemy * count * this.computeGoldMultiplier());
  }

  /** Total reward a mutator is projected to pay across its full run. */
  private projectWaveModifierReward(
    snapshot: WaveModifierSnapshot,
    startWave: number,
  ): { gold: number; ap: number; tp: number } {
    let gold = 0;
    let ap = 0;
    let tp = 0;
    for (let i = 0; i < MUTATOR_DURATION_WAVES; i++) {
      const escalation = waveModifierRewardMultiplier(i);
      const wave = startWave + i;
      if (snapshot.reward.gold > 0) {
        // The mutator's own gold bonus applies to the wave it is measuring.
        const waveGold = this.estimateWaveGold(wave) * (1 + Math.max(-0.9, snapshot.effects.goldAdditive));
        gold += Math.floor(waveGold * snapshot.reward.gold * escalation);
      }
      ap += Math.floor(snapshot.reward.ap * escalation);
      tp += Math.floor(snapshot.reward.tp * escalation);
    }
    return { gold, ap, tp };
  }

  private chooseWaveModifier(snapshot: WaveModifierSnapshot): void {
    this.state.wave.waveModifier.active = snapshot;
    this.state.wave.waveModifier.choiceForNextWave = null;
    this.state.wave.waveModifier.wavesRemaining = MUTATOR_DURATION_WAVES;
    this.state.wave.waveModifier.wavesCleared = 0;
    // Snapshot gold earned so far — the modifier's gold multiplier bonus
    // is computed from gold earned during the wave and awarded on wave_cleared.
    this.state.wave.waveModifier.goldSnapshot = this.state.stats.goldEarned;
    // Apply non-stateful multipliers now so that the upcoming startWave()
    // uses the correct enemy count and the active enemies spawned during
    // this intermission window would (if any) carry the new speeds.
    const e = snapshot.effects;
    this.waveMgr.setEnemyCountMult(e.countMult);
    this.enemyMgr.setSpeedMult(e.speedMult);
    this.enemyMgr.setDamageToTowerMult(e.damageToTowerMult);
    this.enemyMgr.setHPMult(e.hpMult);
    // Recompute tower stats so the new wave starts with the modifier's
    // playerDamageMult / goldAdditive baked in.
    this.applyUpgradeEffects();
    this.bus.emit('wave_modifier_chosen', {
      id: snapshot.id,
      name: snapshot.name,
      reward: snapshot.reward,
    });
    this.bus.emit('toast', {
      kind: 'milestone',
      text: `${snapshot.name} active for ${MUTATOR_DURATION_WAVES} waves`,
      life: 4,
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // Blessings (plan §1)
  // ────────────────────────────────────────────────────────────────────────

  get blessings(): BlessingManager {
    return this.blessingMgr;
  }

  /**
   * Auto-pick is forced whenever the player has demonstrably stopped watching:
   * once auto-buy is unlocked the run is an idle run, and a modal that waits
   * for a click would silently cap progress at the next draft.
   */
  private blessingAutoPickForced(): boolean {
    return this.prestigeMgr.isAutomationUnlocked('autoBuy');
  }

  private blessingAutoPickActive(): boolean {
    return this.autoPickBlessings || this.blessingAutoPickForced();
  }

  /** Player preference; the forced cases override it upward, never downward. */
  setAutoPickBlessings(enabled: boolean): void {
    this.autoPickBlessings = enabled;
    writeAutoPickPreference(enabled);
    this.syncUiApis();
  }

  isAutoPickBlessings(): boolean {
    return this.blessingAutoPickActive();
  }

  isAutoPickBlessingsForced(): boolean {
    return this.blessingAutoPickForced();
  }

  /**
   * Decide whether clearing `cleared` earns a draft, and open one if so.
   *
   * The draft pauses **only** the intermission timer — spawning, projectiles,
   * enemies and abilities all keep running underneath it. Every exit path
   * (`chooseBlessing`, `skipBlessing`, the auto-pick) goes through
   * `closeBlessingDraft`, which owns the un-pause, so the obligation
   * `docs/wave-modifier-system.md` spells out cannot be forgotten at one of
   * four call sites.
   */
  private maybeOfferBlessingDraft(cleared: number): void {
    if (this.blessingModal.isVisible()) return;
    if (!this.blessingMgr.isDraftDue(cleared)) return;
    const offer = this.blessingMgr.openDraft(cleared);
    if (offer.length === 0) {
      // Everything eligible is maxed — close it out silently rather than
      // pausing the run for an empty picker.
      this.blessingMgr.skip();
      return;
    }
    this.waveMgr.pauseIntermission();
    this.state.blessings = this.blessingMgr.snapshot();
    this.showBlessingDraft(cleared);
  }

  private showBlessingDraft(wave: number): void {
    const auto = this.blessingAutoPickActive();
    this.blessingModal.show(
      {
        wave,
        offers: this.blessingMgr.offer,
        held: this.blessingMgr.heldList(),
        picksTaken: this.blessingMgr.picks,
        maxPicks: BLESSING_MAX_PICKS,
        rerolls: this.blessingMgr.rerollsAvailable,
        autoPick: auto,
        autoPickForced: this.blessingAutoPickForced(),
        timeoutSeconds: auto ? BLESSING_AUTO_PICK_SECONDS : BLESSING_SAFETY_TIMEOUT_SECONDS,
      },
      {
        onChoose: (id) => this.chooseBlessing(id),
        onSkip: () => this.skipBlessing(),
        onReroll: () => this.rerollBlessings(),
        onAutoPick: () => this.autoPickBlessing(),
        onToggleAutoPick: (enabled) => this.setAutoPickBlessings(enabled),
      },
    );
  }

  /** Take a blessing and resume the intermission clock. */
  chooseBlessing(id: string): boolean {
    const def: BlessingDef | undefined = BLESSING_BY_ID[id];
    const ok = this.blessingMgr.choose(id);
    this.closeBlessingDraft();
    if (!ok || !def) return false;
    const stacks = this.blessingMgr.stacks(id);
    // A blessing is an input to the same recompute as everything else, so the
    // pick is felt on the very next shot rather than at the next purchase.
    this.applyUpgradeEffects();
    this.syncUiApis();
    this.saveMgr.requestSave();
    this.bus.emit('toast', {
      kind: 'milestone',
      text: `Blessing: ${def.name}${stacks > 1 ? ` ×${stacks}` : ''} — ${describeBlessing(def, stacks)}`,
      life: 4,
    });
    return true;
  }

  /** Spend a reroll and redraw. Leaves the draft open. */
  rerollBlessings(): boolean {
    const wave = this.blessingMgr.offerWave;
    if (wave === null) return false;
    const rolled = this.blessingMgr.reroll();
    if (!rolled) return false;
    this.state.blessings = this.blessingMgr.snapshot();
    this.showBlessingDraft(wave);
    return true;
  }

  /** Decline the offer. No pick is spent; the run continues. */
  skipBlessing(): void {
    this.blessingMgr.skip();
    this.closeBlessingDraft();
    this.bus.emit('toast', { kind: 'info', text: 'Blessing declined.', life: 2.5 });
  }

  /**
   * Resolve an unattended draft by taking the highest-weight offer.
   *
   * Highest weight means the *commonest* card, which is deliberate: those are
   * the plain stat gains with no trade-off attached, and an unattended run
   * should not be handed Glass Cannon.
   */
  private autoPickBlessing(): void {
    const offers = this.blessingMgr.offer;
    if (offers.length === 0) {
      this.skipBlessing();
      return;
    }
    let best = offers[0];
    for (const def of offers) {
      if (def.weight > best.weight) best = def;
    }
    this.chooseBlessing(best.id);
  }

  /**
   * The single un-pause point. Every way out of the draft goes through here,
   * which is what keeps the intermission from staying frozen after a modal is
   * dismissed by a path nobody thought about.
   */
  private closeBlessingDraft(): void {
    this.blessingModal.hide();
    this.waveMgr.resumeIntermission();
    this.state.blessings = this.blessingMgr.snapshot();
  }

  /**
   * Splinter: a kill throws two shards at the nearest survivors.
   *
   * Applied as direct damage rather than as projectiles so the reentrancy
   * guard can be airtight — `EnemyManager.damage` emits `enemy_killed`
   * synchronously, and shards that spawn shards would cascade without bound in
   * a dense wave.
   */
  private fireSplitShards(x: number, y: number): void {
    if (this.splitOnKillActive) return;
    const ts = this.tower.snapshot;
    const damage = Math.max(1, Math.floor(ts.baseDamage * BLESSING_TUNING.splitShardDamage));
    const candidates = this.enemyMgr
      .queryRadius(x, y, BLESSING_TUNING.splitShardRange)
      .filter(e => e.alive)
      .slice(0, BLESSING_TUNING.splitShardCount);
    if (candidates.length === 0) return;
    this.splitOnKillActive = true;
    try {
      for (const target of candidates) {
        this.effects.emitHitSparks(target.x, target.y, '#9be7ff', 4);
        this.enemyMgr.damage(target, damage, false);
        this.bus.emit('tower_damage_dealt', { amount: damage });
      }
    } finally {
      this.splitOnKillActive = false;
    }
  }

  private skipWaveModifier(): void {
    this.state.wave.waveModifier.active = null;
    this.state.wave.waveModifier.choiceForNextWave = null;
    this.state.wave.waveModifier.pendingChoiceForWave = null;
    this.state.wave.waveModifier.wavesRemaining = 0;
    this.state.wave.waveModifier.wavesCleared = 0;
    this.bus.emit('toast', {
      kind: 'info',
      text: 'Skipped mutator this wave.',
      life: 2.5,
    });
  }

  private applyFullTranscendenceReset(): void {
    this.automation.reset();
    this.abilityMgr.resetLevels();
    // Passives and equipment are *character* progression, not run progression:
    // they survive a transcendence alongside talents, tower XP, research and
    // achievements. Only the gold-priced layers (upgrades, ability levels) and
    // the ascension layer itself are wiped. Gear in particular is a slow,
    // low-drop-rate collection — deleting it at the one moment a player is
    // asked to give everything else up made transcending read as a punishment.
    this.applySavedStateReset();
    this.state.prestige.apSpent = {};
    this.state.prestige.automationFlags = {
      autoBuy: false,
      autoAbilities: false,
      autoAscend: false,
      autoTranscend: false,
    };
    this.state.resources.ascensionPoints = 0;
    this.state.resources.apThisTranscendence = 0;
    this.state.stats.ascensions = 0;
  }

  private applyPersistedState(persisted: PersistentState): void {
    const r = this.state.resources;
    r.gold = persisted.resources.gold;
    r.mana = persisted.resources.mana;
    r.maxMana = persisted.resources.maxMana;
    r.manaRegen = persisted.resources.manaRegen;
    r.ascensionPoints = persisted.resources.ascensionPoints;
    r.apThisTranscendence = persisted.resources.apThisTranscendence;
    r.transcendencePoints = persisted.resources.transcendencePoints ?? 0;
    r.lifetimeAP = persisted.resources.lifetimeAP ?? 0;
    r.lifetimeGold = persisted.resources.lifetimeGold;

    const s = this.state.stats;
    s.enemiesKilled = persisted.stats.enemiesKilled;
    s.bossesKilled = persisted.stats.bossesKilled;
    s.goldEarned = persisted.stats.goldEarned;
    s.damageDealt = persisted.stats.damageDealt;
    s.shotsFired = persisted.stats.shotsFired;
    s.lifetimeHighestWave = persisted.stats.lifetimeHighestWave;
    s.abilitiesCast = persisted.stats.abilitiesCast;
    s.ascensions = persisted.stats.ascensions;
    s.lifetimeAscensions = persisted.stats.lifetimeAscensions ?? 0;
    s.transcendences = persisted.stats.transcendences;
    s.totalUpgradesPurchased = persisted.stats.totalUpgradesPurchased ?? 0;
    s.startedAt = persisted.stats.startedAt;
    s.runStartedAt = persisted.stats.runStartedAt ?? persisted.runStartedAt ?? persisted.stats.startedAt;

    this.state.achievements = [...((persisted as any).achievements ?? [])];
    this.state.runHistory = Array.isArray(persisted.runHistory) ? [...persisted.runHistory] : [];
    this.state.runStartedAt = persisted.runStartedAt ?? s.runStartedAt;
    // Seed lifetime "best run" tracking from the saved history (best so far).
    this.bestGoldRun = 0;
    this.bestWaveRun = 1;
    for (const r of this.state.runHistory) {
      if (r.goldEarned > this.bestGoldRun) this.bestGoldRun = r.goldEarned;
      if (r.highestWave > this.bestWaveRun) this.bestWaveRun = r.highestWave;
    }

    this.state.upgrades = { ...persisted.upgrades };
    this.migrateUpgrades(this.state.upgrades);
    this.state.research = { ...(persisted.research ?? {}) };
    this.researchTree.replaceLevels(
      this.state.research,
      persisted.rp ?? 0,
      persisted.researchInProgress ?? null,
    );
    this.state.researchInProgress = persisted.researchInProgress ?? null;

    const p = this.state.prestige;
    p.apSpent = { ...persisted.prestige.apSpent };
    p.tpSpent = { ...(persisted.prestige.tpSpent ?? {}) };
    p.automationFlags = persisted.prestige.automationFlags ?? {
      autoBuy: false,
      autoAbilities: false,
      autoAscend: false,
      autoTranscend: false,
    };
    p.targetAscendWave = persisted.prestige.targetAscendWave ?? DEFAULT_AUTO_ASCEND_WAVE;
    p.autoCastEnabled = { ...(persisted.prestige.autoCastEnabled ?? {}) };
    p.autoBuyStrategy = persisted.prestige.autoBuyStrategy ?? 'balanced';
    p.autoBuyReserve = persisted.prestige.autoBuyReserve ?? 0;

    this.state.wave = { ...persisted.wave };
    this.waveMgr.setState(this.state.wave);

    this.state.abilities = {};
    for (const id of Object.keys(persisted.abilities)) {
      const a = persisted.abilities[id];
      this.state.abilities[id] = { level: a.level, cooldown: 0, active: false, activeTimer: 0, xp: a.xp ?? 0 };
    }
    for (const def of ABILITIES) {
      if (!this.state.abilities[def.id]) {
        this.state.abilities[def.id] = { level: 1, cooldown: 0, active: false, activeTimer: 0, xp: 0 };
      }
    }

    const t = this.tower.snapshot;
    t.x = persisted.tower.x;
    t.y = persisted.tower.y;
    t.cooldown = 0;
    t.damageType = persisted.tower.damageType;
    // Migration: old saves stored 'first' (which behaved identically to 'nearest').
    // Map it to 'nearest' so users keep their previous targeting.
    const persistedMode = persisted.tower.targetingMode as string;
    const validModes: TargetingMode[] = ['nearest', 'lowest_hp', 'first', 'strongest', 'boss', 'flying', 'last'];
    const migrated: TargetingMode = (validModes as string[]).includes(persistedMode)
      ? (persistedMode as TargetingMode)
      : 'nearest';
    t.targetingMode = migrated === 'first' ? 'nearest' : migrated;
    t.hp = persisted.tower.hp ?? TOWER_BASE.hp;
    t.maxHp = persisted.tower.maxHp ?? TOWER_BASE.maxHp;
    t.wallHp = persisted.tower.wallHp ?? 0;
    t.wallMaxHp = persisted.tower.wallMaxHp ?? 0;

    this.upgradeMgr.replaceLevels(this.state.upgrades);
    this.abilityMgr.reset();

    // v6+: Restore RPG state
    Object.assign(this.state.towerXp, persisted.towerXp ?? { xp: 0, level: 0, unspentTalentPoints: 0, totalXpEarned: 0 });
    this.state.talents.allocated = { ...(persisted.talents?.allocated ?? {}) };

    // Clear and repopulate passiveAbilities (manager holds reference)
    const pa = this.state.passiveAbilities;
    for (const k of Object.keys(pa)) delete pa[k];
    if (persisted.passiveAbilities) {
      for (const [id, v] of Object.entries(persisted.passiveAbilities)) {
        pa[id] = { level: v.level, xp: v.xp, unlocked: v.unlocked ?? false };
      }
    }
    this.passiveMgr.ensureInitialized();

    // Clear and repopulate equipment (manager holds reference)
    this.state.equipment.length = 0;
    if (persisted.equipment) {
      for (const eq of persisted.equipment) {
        this.state.equipment.push({ ...eq, stats: [...eq.stats] });
      }
    }

    // v10+: the run's blessings. `restore` drops any draft that was open when
    // the save was written — the offer itself is not persisted, and rolling a
    // fresh one on load would hand back a different choice than the player was
    // looking at.
    this.blessingMgr.restore(persisted.blessings ?? null);
    this.state.blessings = this.blessingMgr.snapshot();

    // Clear and repopulate equipped (manager holds reference)
    const eqMap = this.state.equipped;
    for (const k of Object.keys(eqMap)) delete (eqMap as Record<string, Equipment>)[k];
    if (persisted.equipped) {
      for (const [slot, eq] of Object.entries(persisted.equipped)) {
        if (eq && typeof eq !== 'string') {
          (eqMap as Record<string, Equipment>)[slot] = eq;
        }
      }
    }
  }

  private loop = (): void => {
    if (!this.running) return;
    const now = performance.now();
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (dt > 0.05) dt = 0.05;

    const speed = this.getSpeed();
    // Apply slow-mo factor on top of user speed (does not replace it)
    let slowMo = 1;
    if (this.slowMoRemaining > 0) {
      this.slowMoRemaining = Math.max(0, this.slowMoRemaining - dt);
      const t = this.slowMoTotal > 0 ? 1 - this.slowMoRemaining / this.slowMoTotal : 1;
      // Ramp from 0.3 (entry) or 0.2 (death) up to 1.0
      const startFactor = this.slowMoTotal <= 0.35 ? 0.2 : 0.3;
      slowMo = startFactor + t * (1 - startFactor);
    }
    if (this.screenFlash > 0) {
      this.screenFlash = Math.max(0, this.screenFlash - dt);
    }
    if (this.towerFlash > 0) {
      this.towerFlash = Math.max(0, this.towerFlash - dt);
    }
    if (this.wallFlash > 0) {
      this.wallFlash = Math.max(0, this.wallFlash - dt);
    }
    if (this.shieldFlash > 0) {
      this.shieldFlash = Math.max(0, this.shieldFlash - dt);
    }
    const gameDt = dt * speed * slowMo;
    if (!this.runFailed) this.update(gameDt, dt);
    this.draw();
    this.state.wave = this.waveMgr.snapshot;
    this.ui.update(this.state);

    this.fpsAccumulator += dt;
    this.fpsFrames += 1;
    if (this.fpsAccumulator >= 0.5) {
      this.currentFps = Math.round(this.fpsFrames / this.fpsAccumulator);
      this.fpsAccumulator = 0;
      this.fpsFrames = 0;
      if (this.fpsOverlay) {
        this.fpsOverlay.textContent = `FPS: ${this.currentFps}`;
      }
    }

    this.rafId = requestAnimationFrame(this.loop);
  };

  /**
   * @param dt      simulation delta (scaled by game speed and slow-mo)
   * @param realDt  wall-clock delta, for systems that must not speed up with
   *                the game (real-time research timers, auto-save cadence)
   */
  private update(dt: number, realDt: number): void {
    // Plan §5.2: the simulation runs in fixed substeps. `dt` here can reach
    // 0.05 s (the frame-hitch clamp) times 6.5 (max Accelerator speed) =
    // 0.325 s, and a single step that long makes enemy movement, attack
    // cadence and projectile travel wrong in ways the player reads as the
    // game cheating. Substepping makes high speed cost what it should — more
    // simulation — instead of quietly producing a different, coarser game.
    const steps = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(dt / FIXED_STEP)));
    const step = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.simulate(step);
    }
    this.frameUpdate(dt, realDt);
  }

  /**
   * One fixed simulation substep: waves, combat, movement, projectiles, mines.
   *
   * Everything here is time-integrated or cadence-driven, so it has to see the
   * small step. Presentation and bookkeeping live in `frameUpdate`, which runs
   * once per frame with the full delta.
   */
  private simulate(dt: number): void {
    // Buffs age on the simulation clock, and a buff that started or expired
    // means the whole stat block is restated — once, here, rather than by each
    // system poking at `TowerState`.
    this.buffs.tick(dt);
    this.refreshBuffedStats();

    this.waveMgr.tick(dt);
    this.resourceMgr.tick(dt, this.waveMgr.currentWave);
    this.abilityMgr.tick(dt);

    // Evolution: mana_full_gold — gold bonus while mana is full
    if (this.upgradeMgr.hasEvolutionEffect('mana_full_gold')) {
      if (this.resourceMgr.mana >= this.resourceMgr.state.maxMana) {
        this.manaFullGoldTimer = 5;
      }
      if (this.manaFullGoldTimer > 0) {
        this.manaFullGoldTimer -= dt;
        const bonus = this.upgradeMgr.getEvolutionEffectValue('mana_full_gold');
        this.enemyMgr.setManaFullGoldBonus(bonus);
      } else {
        this.enemyMgr.setManaFullGoldBonus(0);
      }
    }

    const ts = this.tower.snapshot;
    const regenRate = this.tower.effectiveHealthRegen;
    if (ts.hp < ts.maxHp && regenRate > 0) {
      ts.hp = Math.min(ts.maxHp, ts.hp + (ts.maxHp * regenRate) * dt);
    }

    // Talent: Wall Regen — rebuild the outer wall over time.
    if (this.talentWallRegen > 0 && ts.wallMaxHp > 0 && ts.wallHp < ts.wallMaxHp) {
      ts.wallHp = Math.min(ts.wallMaxHp, ts.wallHp + ts.wallMaxHp * this.talentWallRegen * dt);
      if (ts.wallHp > 0) this.enemyMgr.setWallContactExtra(36);
    }

    // Manual aim: holding the mouse aims at the cursor and adds fire rate.
    // Both this and the quick-shot proc below are buff entries, so they
    // compose with Berserk instead of overwriting it (plan §1.3).
    if (this.mouseDown) {
      this.tower.setAimTarget(this.mouseX, this.mouseY);
      this.buffs.set({
        id: BUFF_MANUAL_AIM,
        stat: 'fireRate',
        kind: 'mult',
        value: MANUAL_AIM_FIRE_RATE,
        label: 'Manual aim',
        remaining: null,
      });
    } else {
      this.buffs.clear(BUFF_MANUAL_AIM);
    }
    this.refreshBuffedStats();

    if (this.tower.tickCooldown(dt)) {
      const target = this.mouseDown ? null : this.tower.acquireTarget(this.enemyMgr.list);

      if (this.mouseDown || target) {
        const shot = this.tower.rollShot();
        const variants = this.buildShotVariants();

        // Talent: Barrage — chance for one extra projectile in this volley.
        if (this.talentExtraProjectileChance > 0 && Math.random() < this.talentExtraProjectileChance) {
          variants.push({ posOffsetX: 0, posOffsetY: -12 });
        }

        // Talent: Enchant Weapons — chance for the volley to land as magic
        // damage, which is resisted by magicResist instead of flat armor.
        const shotDamageType = this.talentMagicProcChance > 0 && Math.random() < this.talentMagicProcChance
          ? 'magic'
          : ts.damageType;

        // Evolution: double_shot — every Nth shot fires double
        if (this.upgradeMgr.hasEvolutionEffect('double_shot')) {
          this.shotCounter += 1;
          const interval = this.upgradeMgr.getEvolutionEffectValue('double_shot');
          if (this.shotCounter % interval === 0) {
            variants.push({ posOffsetX: 0, posOffsetY: 12 });
          }
        }

        // Quick shot chance — activate temporary 2x fire rate
        if (ts.quickShotTime > 0 && Math.random() < ts.quickShotChance) {
          this.buffs.set({
            id: BUFF_QUICK_SHOT,
            stat: 'fireRate',
            kind: 'mult',
            value: QUICK_SHOT_FIRE_RATE,
            label: 'Quick shot',
            remaining: ts.quickShotTime,
          });
        }

        // Blessing: Mortar Round — every 8th shot leaves as a shell. The
        // cadence is counted here, in the fixed substep, so it does not drift
        // with frame rate or game speed.
        let mortarShot = false;
        if (this.blessingMgr.has('mortar')) {
          this.mortarShotCounter += 1;
          mortarShot = this.mortarShotCounter % BLESSING_TUNING.mortarInterval === 0;
        }
        // Blessing: Seeker Shots — only meaningful with an auto-acquired
        // target; a manually aimed shot is already going where the player
        // pointed it.
        const homing = target !== null && this.blessingMgr.has('homing');
        const shotDamage = mortarShot
          ? shot.damage * BLESSING_TUNING.mortarDamageMult
          : shot.damage;
        const blessingShot = {
          isHoming: homing,
          splashRadius: mortarShot ? BLESSING_TUNING.mortarRadius : undefined,
          splashFraction: mortarShot ? BLESSING_TUNING.mortarSplashFraction : undefined,
        };

        this.projectileMgr.fire(target, ts, {
          rawDamage: shotDamage,
          damageType: shotDamageType,
          isCrit: shot.isCrit,
          targetId: target?.id ?? null,
          variants,
          aimX: this.mouseDown ? this.mouseX : undefined,
          aimY: this.mouseDown ? this.mouseY : undefined,
          ...blessingShot,
        });
        this.tower.consumeCooldown();
        this.state.stats.shotsFired += 1;
        this.state.stats.damageDealt += shotDamage;

        // Double shot chance — fire all projectiles a second time
        if (Math.random() < ts.doubleShotChance) {
          this.projectileMgr.fire(target, ts, {
            rawDamage: shotDamage,
            damageType: shotDamageType,
            isCrit: shot.isCrit,
            targetId: target?.id ?? null,
            variants,
            aimX: this.mouseDown ? this.mouseX : undefined,
            aimY: this.mouseDown ? this.mouseY : undefined,
            ...blessingShot,
          });
          this.state.stats.shotsFired += 1;
          this.state.stats.damageDealt += shotDamage;
        }
      }
    }

    this.projectileMgr.tick(dt);
    this.enemyMgr.tick(dt, ts.x, ts.y);

    if (ts.shockwaveSize > 0 && ts.shockwaveCooldown > 0) {
      ts.shockwaveTimer -= dt;
      if (ts.shockwaveTimer <= 0) {
        ts.shockwaveTimer = ts.shockwaveCooldown;
        this.enemyMgr.applyShockwave(ts.shockwaveSize, ts.x, ts.y);
        this.effects.emitShockwaveRing(ts.x, ts.y, ts.shockwaveSize);
        // Evolution: shockwave_slow — slow enemies hit by shockwave
        if (this.upgradeMgr.hasEvolutionEffect('shockwave_slow')) {
          const slowAmount = this.upgradeMgr.getEvolutionEffectValue('shockwave_slow');
          this.enemyMgr.applySlow(1 - slowAmount, 2);
        }
      }
    }

    if (ts.landMineDamage > 0 && ts.landMineFrequency > 0) {
      ts.landMineTimer -= dt;
      if (ts.landMineTimer <= 0) {
        ts.landMineTimer = ts.landMineFrequency;
        const angle = Math.random() * Math.PI * 2;
        const dist = TOWER_HIT_RADIUS + 45 + Math.random() * Math.max(0, ts.range - TOWER_HIT_RADIUS - 45);
        const mx = ts.x + Math.cos(angle) * dist;
        const my = ts.y + Math.sin(angle) * dist;
        if (this.mines.length >= 15) {
          this.mines.shift();
        }
        this.mines.push({
          id: nextId(),
          x: mx,
          y: my,
          damage: ts.baseDamage * ts.landMineDamage,
          explosionRadius: 50,
          alive: true,
          isSplit: false,
        });
      }
    }

    for (let i = this.mines.length - 1; i >= 0; i--) {
      const mine = this.mines[i];
      if (!mine.alive) continue;
      // Trigger set and damage set are the same disc, so one radius query
      // answers both — this used to be a nested scan of the whole enemy list
      // per mine, per frame (plan §5.4).
      const caught = this.enemyMgr.queryRadius(mine.x, mine.y, mine.explosionRadius);
      if (caught.length === 0) continue;
      mine.alive = false;
      for (const target of caught) {
        this.enemyMgr.damage(target, mine.damage, false);
      }
      this.effects.emitMineExplosion(mine.x, mine.y);
      // Evolution: mine_split — spawn child mines on detonation
      if (!mine.isSplit && this.upgradeMgr.hasEvolutionEffect('mine_split')) {
        const count = this.upgradeMgr.getEvolutionEffectValue('mine_split');
        for (let c = 0; c < count; c++) {
          const childAngle = Math.random() * Math.PI * 2;
          const childDist = 25 + Math.random() * 25;
          this.mines.push({
            id: nextId(),
            x: mine.x + Math.cos(childAngle) * childDist,
            y: mine.y + Math.sin(childAngle) * childDist,
            damage: mine.damage * 0.5,
            explosionRadius: 30,
            alive: true,
            isSplit: true,
          });
        }
      }
    }
    this.mines = this.mines.filter(m => m.alive);

    if (ts.shieldMaxCharges > 0 && ts.shieldCurrentCharges < ts.shieldMaxCharges) {
      ts.shieldRechargeTimer -= dt;
      if (ts.shieldRechargeTimer <= 0) {
        ts.shieldRechargeTimer = ts.shieldRechargeTime;
        ts.shieldCurrentCharges = Math.min(ts.shieldMaxCharges, ts.shieldCurrentCharges + 1);
      }
    }
  }

  /**
   * Once-per-frame work: visuals, UI, automation, real-time systems.
   *
   * None of these need substepping — particles and toasts are presentation,
   * automation and achievements are polled rather than integrated, and
   * research and auto-save deliberately run on wall-clock time.
   *
   * @param dt      full simulation delta for this frame (all substeps summed)
   * @param realDt  wall-clock delta
   */
  private frameUpdate(dt: number, realDt: number): void {
    this.effects.tick(dt);
    this.effects.tickChainLightning(dt);
    this.notifications.tick(dt);
    this.automation.tick(dt);

    // HUD display tweening (every frame, before throttled UI update)
    this.ui.tickDisplayHud(dt, this.state);
    this.waveModModal.tick(dt);
    // Wall-clock, not simulation time: at 6.5x a 20 s game-time deadline is
    // three real seconds, which is not long enough to read three cards.
    this.blessingModal.tick(realDt);

    // Research progress + passive RP gain. Both are real-time systems — they
    // must not accelerate when the player raises the game speed.
    this.researchTree.setSpeedMultiplier(this.prestigeMgr.getResearchSpeedMultiplier());
    this.researchTree.addPassiveRP(
      realDt,
      this.state.stats.lifetimeHighestWave,
      this.rpGainMultiplier(),
    );
    if (this.researchTree.tick(realDt)) {
      this.state.research = this.researchTree.getLevelsSnapshot();
      this.state.researchInProgress = null;
      this.applyUpgradeEffects();
      this.syncUiApis();
    } else {
      this.state.researchInProgress = this.researchTree.inProgress
        ? { ...this.researchTree.inProgress }
        : null;
      this.ui.setResearchAPI({
        rp: this.researchTree.rp,
        levels: this.researchTree.getLevelsSnapshot(),
        unlocked: this.researchTree.unlocked,
        reasonBlocked: (id) => this.researchTree.reasonBlocked(id),
        inProgress: this.researchTree.inProgress,
        researchSpeedMultiplier: this.prestigeMgr.getResearchSpeedMultiplier(),
        rpGainRate: this.researchTree.getPassiveRPRate(
          this.state.stats.lifetimeHighestWave,
          this.rpGainMultiplier(),
        ),
      });
    }

    this.checkTranscendenceUnlockToast();
    this.saveMgr.tick(realDt, this.state, (s) => this.saveMgr.save(s));
    this.achievementMgr.tick(dt);
    this.audio.tick(dt);
    this.updateVignette();
  }

  private checkTranscendenceUnlockToast(): void {
    if (this.transcendenceUnlockedAnnounced) return;
    if (this.prestigeMgr.canTranscend(this.state.resources.apThisTranscendence)) {
      this.transcendenceUnlockedAnnounced = true;
      this.bus.emit('toast', {
        kind: 'milestone',
        text: 'Transcendence available! Open the Prestige tab.',
        life: 6,
      });
    }
  }

  private draw(): void {
    this.renderer.draw({
      tower: this.tower.snapshot,
      enemies: this.enemyMgr.list,
      projectiles: this.projectileMgr.list,
      wave: this.waveMgr.snapshot,
      resources: this.state.resources,
      abilities: this.state.abilities,
      particles: this.effects.particleList,
      damageNumbers: this.effects.damageList,
      shockwaves: this.effects.shockwaveList,
      mines: this.mines,
      aimLine: this.mouseDown ? { x: this.mouseX, y: this.mouseY } : null,
    }, {
      screenFlash: this.screenFlash,
      towerFlash: this.towerFlash,
      wallFlash: this.wallFlash,
      shieldFlash: this.shieldFlash,
      chainPaths: this.effects.activeChainPaths,
    });
  }
}
