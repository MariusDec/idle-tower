import type { AbilityId, GameState, TowerState, AbilityState, ResourceState, PrestigeState, GameStats, Mine, StatsInfo, TargetingMode, RunRecord, WaveModifierSnapshot } from '../types';
import { computeUpgradeValue, GAME_SPEEDS, DEFAULT_SPEED_INDEX, MAX_SPEED_INDEX, MAX_RUN_HISTORY } from '../types';
import { TOWER_BASE, TOWER_HIT_RADIUS, TOWER_VISUAL } from '../data/tower';
import { UPGRADES } from '../data/upgrades';
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
import { isBossWave } from '../data/formulas';
import type { AutomationKey } from '../data/prestige';
import { AudioManager } from '../systems/AudioManager';
import { formatInt } from '../utils/bigNumber';
import { setStyle, toggleClass } from '../utils/dom';
import { pickRandomModifiers, snapshotFromDef } from '../data/waveModifiers';
import { WaveModifierModal } from '../ui/WaveModifierModal';

const BASE_MANA_REGEN = 1;
const WAVE_MILESTONES = new Set([10, 25, 50, 100, 200, 500]);

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
    abilities[def.id] = { level: 1, cooldown: 0, active: false, activeTimer: 0 };
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
    targetAscendWave: 30,
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
      waveModifier: { active: null, choiceForNextWave: null, pendingChoiceForWave: null },
    },
    stats,
    achievements: [],
    runHistory: [],
    runStartedAt: Date.now(),
  };
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
  private readonly waveModModal: WaveModifierModal;

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

  // Evolution state
  private reviveUsed = false;
  private killStreak = 0;
  private manaFullGoldTimer = 0;
  private shotCounter = 0;

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
    this.waveModModal = new WaveModifierModal(deps.modalRoot);
    this.effects = new EffectsManager();
    this.effects.onShockwaveDamage = (s) => {
      // P5 boss death: damage enemies caught in the ring (single hit per ring)
      if (!s.damage) return;
      const inner = s.currentRadius - 30; // damage band just inside the wave front
      const outer = s.currentRadius + 30;
      const innerSq = Math.max(0, inner) * Math.max(0, inner);
      const outerSq = outer * outer;
      for (const en of this.enemyMgr.list) {
        if (!en.alive) continue;
        const dx = en.x - s.x;
        const dy = en.y - s.y;
        const dSq = dx * dx + dy * dy;
        if (dSq >= innerSq && dSq <= outerSq) {
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
      getState: (id) => this.state.abilities[id],
      onCast: () => {
        this.state.stats.abilitiesCast += 1;
      },
    });
    this.prestigeMgr = new PrestigeManager(this.bus, {
      resources: this.state.resources,
      stats: this.state.stats,
      prestige: this.state.prestige,
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

    this.tower.setPosition(this.canvas.width / 2, this.canvas.height / 2);
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
        for (const e of this.enemyMgr.list) {
          if (!e.alive || e.id === p.enemy.id) continue;
          const dx = e.x - p.enemy.x;
          const dy = e.y - p.enemy.y;
          if (dx * dx + dy * dy <= splashRadius * splashRadius) {
            this.enemyMgr.damage(e, splashDamage, false);
          }
        }
      }
    });
    this.bus.on('enemy_killed', (enemy) => {
      const e = enemy as { x: number; y: number; type: string; maxHp?: number; isSplitChild?: boolean; goldValue?: number };
      const def = ENEMY_DEFS[e.type as keyof typeof ENEMY_DEFS];
      this.state.stats.enemiesKilled += 1;
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
        this.bus.emit('boss_killed', { x: e.x, y: e.y, goldValue: e.goldValue ?? def.baseGold });
        // Death slow-mo + screen flash (P3 + P5)
        this.triggerBossDeathSlowMo();
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

      this.effects.emitDeathBurst(e.x, e.y, def.color, def.radius);

      // Evolution: kill_streak_gold
      if (this.upgradeMgr.hasEvolutionEffect('kill_streak_gold')) {
        this.killStreak += 1;
        const perKill = this.upgradeMgr.getEvolutionEffectValue('kill_streak_gold');
        this.enemyMgr.setKillStreakGoldBonus((this.killStreak - 1) * perKill);
      }

      // Research: Chain Reaction — kills deal AoE to nearby enemies
      const chainAoE = this.researchTree.getChainKillAoE();
      if (chainAoE > 0 && e.maxHp) {
        const aoeDamage = Math.max(1, Math.floor(e.maxHp * chainAoE));
        const chainRadius = 70;
        for (const target of this.enemyMgr.list) {
          if (!target.alive) continue;
          const dx = target.x - e.x;
          const dy = target.y - e.y;
          if (dx * dx + dy * dy <= chainRadius * chainRadius) {
            this.enemyMgr.damage(target, aoeDamage, false);
          }
        }
        this.effects.emitShockwaveRing(e.x, e.y, chainRadius);
      }
    });

    this.bus.on('shield_break', (payload: unknown) => {
      const p = payload as { x: number; y: number };
      this.effects.emitEnemyShieldBreak(p.x, p.y);
    });

    this.bus.on('enemy_healed', (payload: unknown) => {
      const p = payload as { healer: { x: number; y: number }; target: { x: number; y: number }; amount: number };
      this.effects.emitHealParticles(p.healer.x, p.healer.y, p.target.x, p.target.y);
      this.effects.emitDamageNumber(p.target.x, p.target.y - 10, p.amount, false);
    });
    this.bus.on('enemies_reached_tower', (reached: unknown) => {
      return;
      const arr = reached as Array<{ type: string }>;
      this.bus.emit('toast', {
        kind: 'warning',
        text: `${arr.length} enemy${arr.length === 1 ? '' : 'ies'} breached the walls!`,
        life: 3,
      });
    });
    this.bus.on('tower_damaged', (amount: unknown) => {
      let raw = Math.max(0, amount as number);
      if (raw <= 0) return;
      // Research: Reinforced Structure reduces incoming damage
      const towerDef = this.researchTree.getTowerDefense();
      if (towerDef > 0) raw = Math.floor(raw * (1 - towerDef));
      if (raw <= 0) return;
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
      const dmg = Math.floor(afterDefense);
      if (dmg <= 0) return;
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
        this.bus.emit('toast', {
          kind: 'warning',
          text: `Tower destroyed! Restarting at wave ${this.waveMgr.currentWave - 1}.`,
          life: 4,
        });
        this.enemyMgr.reset();
        this.projectileMgr.reset();
        this.mines = [];
        ts.shieldCurrentCharges = ts.shieldMaxCharges;
        ts.shieldRechargeTimer = 0;
        ts.hp = TOWER_BASE.hp;
        ts.maxHp = TOWER_BASE.maxHp;
        this.waveMgr.startAtWave(this.waveMgr.currentWave - 1);
        this.state.wave = this.waveMgr.snapshot;
      }
    });
    this.bus.on('wave_started', (wave: unknown) => {
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
      // If a modifier was active for the just-cleared wave, clear it
      // before the next wave starts so future multipliers reset to 1.
      const wms = this.state.wave.waveModifier;
      if (wms.active && wms.pendingChoiceForWave === cleared) {
        wms.active = null;
        wms.pendingChoiceForWave = null;
      }
    });
    this.bus.on('wave_modifier_offer', (nextWave: unknown) => {
      const w = nextWave as number;
      const choices = pickRandomModifiers(3);
      this.state.wave.waveModifier.choiceForNextWave = choices.map(snapshotFromDef);
      this.state.wave.waveModifier.pendingChoiceForWave = w;
      this.waveMgr.pauseSpawning();
      this.waveModModal.show(
        { wave: w, choices: this.state.wave.waveModifier.choiceForNextWave },
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
      this.state.stats.totalUpgradesPurchased += 1;
      this.applyUpgradeEffects();
    });
    this.bus.on('upgrade_evolved', (payload: unknown) => {
      const p = payload as { id: string; level: number; evolution: { name: string; description: string } };
      this.bus.emit('toast', {
        kind: 'milestone',
        text: `Evolution! ${p.evolution.name} — ${p.evolution.description}`,
        life: 5,
      });
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

    const saveOnEvent = () => {
      this.saveMgr.save(this.state);
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

  private bindVisibilityEvents(): void {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.saveMgr.save(this.state);
        this.stop();
      } else {
        const persisted = this.saveMgr.load();
        if (persisted) {
          const result = this.saveMgr.computeOfflineProgress(persisted);
          if (result.elapsedSeconds > 0) {
            const startWave = this.state.wave.number;
            this.saveMgr.applyOfflineProgress(this.state, result);
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
            this.bus.emit('welcome_back', { result, startWave, endWave });
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
      text: `Transcendence! +${tp} TP. Everything resets. New power awaits.`,
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

  setTargetAscendWave(wave: number): void {
    this.state.prestige.targetAscendWave = Math.max(50, Math.floor(wave));
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
    const result = this.saveMgr.computeOfflineProgress(persisted);
    if (result.elapsedSeconds > 0) {
      const startWave = this.state.wave.number;
      this.saveMgr.applyOfflineProgress(this.state, result);
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
      this.bus.emit('welcome_back', {
        result,
        startWave,
        endWave,
      });
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

  private computeStatsInfo(): StatsInfo {
    const t = this.tower.snapshot;
    const r = this.state.resources;
    const lifetimeBonus = this.prestigeMgr.getLifetimeAPBonus();
    const tpResource = this.prestigeMgr.getTPResourceMultiplicative();
    const researchGoldMulti = this.researchTree.getGoldMultiplicative();
    let goldAdditive = 0;
    for (const u of UPGRADES) {
      if (u.id === 'goldMulti') {
        const level = this.upgradeMgr.getLevel(u.id);
        if (level > 0) goldAdditive = computeUpgradeValue(u, level);
        break;
      }
    }
    const totalGoldMulti = 1 + (goldAdditive + lifetimeBonus.gold) * researchGoldMulti * tpResource;
    const effectiveCritChance = this.tower.effectiveCritChance;
    const effectiveCritDamage = this.tower.effectiveCritMultiplier;
    const effectiveLs = this.tower.effectiveLifesteal;
    const expectedHit = t.baseDamage * (1 + effectiveCritChance * (effectiveCritDamage - 1));
    const dps = expectedHit * t.fireRate * this.tower.fireRateMultiplierValue;
    return {
      damage: t.baseDamage,
      dps,
      hp: t.hp,
      maxHp: t.maxHp,
      healthRegen: t.healthRegen,
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
      goldMultiplier: totalGoldMulti,
      rpGainRate: this.researchTree.getPassiveRPRate(
        this.state.stats.lifetimeHighestWave,
        this.researchTree.getRPGainMultiplier(),
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
      ascendUnlockWave: this.prestigeMgr.ascensionUnlockWave(),
      transcendUnlockAP: this.prestigeMgr.transcendenceUnlockAP(),
      targetAscendWave: this.state.prestige.targetAscendWave,
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
        this.researchTree.getRPGainMultiplier(),
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

  private applyUpgradeEffects(): void {
    const t = this.tower.snapshot;
    t.baseDamage = TOWER_BASE.baseDamage;
    t.fireRate = TOWER_BASE.fireRate;
    t.range = TOWER_BASE.range;
    t.critChance = TOWER_BASE.critChance;
    t.critMultiplier = TOWER_BASE.critMultiplier;
    const oldMaxHp = t.maxHp;
    const oldHp = t.hp;
    t.maxHp = TOWER_BASE.maxHp;
    t.healthRegen = 0;
    t.defense = 0;
    t.armor = 0;
    t.knockbackForce = 0;
    t.lifesteal = 0;
    t.thorns = 0;
    t.shockwaveSize = 0;
    t.shockwaveCooldown = 0;
    t.landMineDamage = 0;
    t.landMineFrequency = 0;
    t.shieldMaxCharges = 0;
    t.shieldRechargeTime = 0;
    let manaRegenAdd = 0;
    let goldAdditive = 0;
    let healthValue = 0;

    for (const u of UPGRADES) {
      const level = this.upgradeMgr.getLevel(u.id);
      if (level <= 0) continue;
      const total = computeUpgradeValue(u, level);
      switch (u.id) {
        case 'damage': t.baseDamage += total; break;
        case 'fireRate': {
          t.fireRate += total;
          break;
        }
        case 'range': t.range += total; break;
        case 'critChance': t.critChance = Math.min(1, t.critChance + total); break;
        case 'critDamage': t.critMultiplier += total; break;
        case 'manaRegen': manaRegenAdd += total; break;
        case 'goldMulti': goldAdditive += total; break;
        case 'health': healthValue += total; break;
        case 'healthRegen': t.healthRegen = total; break;
        case 'defense': t.defense = total; break;
        case 'armor': t.armor = total; break;
        case 'lifesteal': t.lifesteal = total; break;
        case 'thorns': t.thorns = total; break;
        case 'shockwave': {
          const lvl = total;
          t.shockwaveSize = 110 + (lvl - 1) * 5;
          t.shockwaveCooldown = total;
          break;
        }
        case 'landMines': {
          t.landMineDamage = total;
          t.landMineFrequency = Math.max(5, 15 - level / 10);
          break;
        }
        case 'defenseShield': {
          const oldMax = t.shieldMaxCharges;
          t.shieldRechargeTime = total;
          t.shieldMaxCharges = Math.min(5, Math.ceil(level / 11));
          if (t.shieldMaxCharges > oldMax) {
            t.shieldCurrentCharges += t.shieldMaxCharges - oldMax;
          }
          t.shieldCurrentCharges = Math.min(t.shieldCurrentCharges, t.shieldMaxCharges);
          break;
        }
      }
    }

    t.maxHp = TOWER_BASE.maxHp + healthValue;
    if (oldMaxHp === 0 && t.maxHp > 0) {
      t.hp = t.maxHp;
    } else if (oldMaxHp > 0 && t.maxHp > oldMaxHp && oldHp > 0) {
      const heal = (t.maxHp - oldMaxHp) * (oldHp / oldMaxHp);
      t.hp = Math.min(t.maxHp, oldHp + heal);
    } else if (t.hp > t.maxHp) {
      t.hp = t.maxHp;
    }

    const wallLevel = this.upgradeMgr.getLevel('wall');
    if (wallLevel > 0) {
      const wallDef = UPGRADES.find(u => u.id === 'wall')!;
      const wallFraction = computeUpgradeValue(wallDef, wallLevel);
      const oldWallMax = t.wallMaxHp;
      const newWallMax = Math.max(1, Math.floor(t.maxHp * wallFraction));
      if (oldWallMax <= 0) {
        t.wallHp = newWallMax;
      } else if (newWallMax > oldWallMax && t.wallHp > 0) {
        t.wallHp = Math.min(newWallMax, t.wallHp + Math.floor((newWallMax - oldWallMax) * (t.wallHp / oldWallMax)));
      } else if (t.wallHp > newWallMax) {
        t.wallHp = newWallMax;
      }
      t.wallMaxHp = newWallMax;
    } else {
      t.wallHp = 0;
      t.wallMaxHp = 0;
    }
    this.enemyMgr.setWallContactExtra(wallLevel > 0 ? 36 : 0);
    this.enemyMgr.setThorns(t.thorns);

    const lifetimeBonus = this.prestigeMgr.getLifetimeAPBonus();
    const apDamage = lifetimeBonus.damage;
    const apGold = lifetimeBonus.gold;
    const tpDamage = this.prestigeMgr.getTPDamageMultiplicative();
    const tpResource = this.prestigeMgr.getTPResourceMultiplicative();
    const tpFireRate = this.prestigeMgr.getTPFireRateMultiplier();
    const tpCritDamage = this.prestigeMgr.getTPCritDamageBonus();
    const tpManaRegen = this.prestigeMgr.getTPManaRegenMultiplier();
    const researchGoldMulti = this.researchTree.getGoldMultiplicative();
    const researchManaMulti = this.researchTree.getManaRegenMultiplicative();
    const researchCostReduction = this.researchTree.getAbilityCostReduction();

    t.baseDamage = t.baseDamage * (1 + apDamage) * tpDamage;
    t.baseDamage = Math.max(1, t.baseDamage);
    t.fireRate = t.fireRate * tpFireRate;
    t.critMultiplier = t.critMultiplier + tpCritDamage;
    this.state.resources.manaRegen = (BASE_MANA_REGEN + manaRegenAdd) * researchManaMulti * tpManaRegen;
    let totalGoldAdditive = (goldAdditive + apGold) * researchGoldMulti * tpResource;

    // Evolution: wave_gold_scaling — +gold% per wave survived (must be before setGoldMultipliers)
    if (this.upgradeMgr.hasEvolutionEffect('wave_gold_scaling')) {
      const perWave = this.upgradeMgr.getEvolutionEffectValue('wave_gold_scaling');
      const waveBonus = perWave * Math.max(0, this.waveMgr.currentWave - 1);
      totalGoldAdditive += waveBonus;
    }

    this.enemyMgr.setGoldMultipliers(totalGoldAdditive, 1);
    this.abilityMgr.setUpgradeGoldAdditive(goldAdditive);
    const totalAbilityCostReduction = Math.min(0.9, researchCostReduction + this.prestigeMgr.getAbilityManaCostReduction());
    this.abilityMgr.setAbilityCostMultiplier(1 - totalAbilityCostReduction);
    this.abilityMgr.setCooldownMultiplier(1 - this.prestigeMgr.getAbilityCDR());
    this.projectileMgr.setDamageMultipliers(0, 1);
    this.projectileMgr.setPierceExtra(this.researchTree.getPierceCount() + this.prestigeMgr.getTPPierceBonus());
    this.enemyMgr.setGoldLuck(this.researchTree.getGoldLuckChance() + this.prestigeMgr.getTreasureChance(), 3);
    if (this.prestigeMgr.hasExecuteDamage()) {
      this.projectileMgr.setExecuteBonus(0.25, this.prestigeMgr.getExecuteDamageMultiplier());
    } else {
      this.projectileMgr.setExecuteBonus(0, 0);
    }

    // Evolution effects
    const armorPen = this.upgradeMgr.getEvolutionEffectValue('armor_pen');
    if (armorPen > 0) this.projectileMgr.setArmorPen(armorPen);
    else this.projectileMgr.setArmorPen(0);

    if (this.upgradeMgr.hasEvolutionEffect('shield_fast_recharge')) {
      const bonus = this.upgradeMgr.getEvolutionEffectValue('shield_fast_recharge');
      t.shieldRechargeTime = Math.max(3, t.shieldRechargeTime * (1 - bonus));
    }

    if (this.upgradeMgr.hasEvolutionEffect('hp_threshold_damage') && t.hp / t.maxHp > 0.8) {
      const bonus = this.upgradeMgr.getEvolutionEffectValue('hp_threshold_damage');
      t.baseDamage *= 1 + bonus;
    }

    this.projectileMgr.setEvolutionCombatEffects(
      this.upgradeMgr.getEvolutionEffectValue('instant_kill'),
      this.upgradeMgr.getEvolutionEffectValue('crit_splash'),
      this.upgradeMgr.hasEvolutionEffect('crit_ignore_armor'),
    );

    // Evolution: berserk_fire_bonus — extra fire rate during Berserk
    this.abilityMgr.setBerserkFireBonus(
      this.upgradeMgr.getEvolutionEffectValue('berserk_fire_bonus'),
    );

    this.waveMgr.setWaveSkipChance(this.prestigeMgr.getWaveSkipChance());

    // Research: Intermission speed
    this.waveMgr.setIntermissionMultiplier(1 - this.researchTree.getIntermissionSpeedReduction());

    // Research: Enemy HP reduction
    this.enemyMgr.setHPReduction(this.researchTree.getEnemyHPReduction());

    // Research: Ability power
    this.abilityMgr.setDamageMultiplier(1 + this.researchTree.getAbilityPowerBonus());

    // Research: RP drop chance bonus
    this.enemyMgr.setRPDropChanceBonus(this.researchTree.getRPDropChanceBonus());

    // Achievement rewards
    const achDmg = this.achievementMgr.getRewardMultiplier('damage_mult') + this.achievementMgr.getRewardMultiplier('all_damage') + this.achievementMgr.getRewardMultiplier('all_stats');
    if (achDmg > 0) t.baseDamage *= 1 + achDmg;
    const achFR = this.achievementMgr.getRewardMultiplier('fire_rate_mult') + this.achievementMgr.getRewardMultiplier('all_stats');
    if (achFR > 0) t.fireRate *= 1 + achFR;
    const achGold = this.achievementMgr.getRewardMultiplier('gold_mult') + this.achievementMgr.getRewardMultiplier('all_stats');
    if (achGold > 0) this.enemyMgr.setGoldMultipliers(totalGoldAdditive * (1 + achGold), 1);
    const achHP = this.achievementMgr.getRewardMultiplier('max_hp_mult');
    if (achHP > 0) {
      t.maxHp *= 1 + achHP;
      if (t.hp > t.maxHp) t.hp = t.maxHp;
    }
    const achCDR = this.achievementMgr.getRewardMultiplier('ability_cdr');
    if (achCDR > 0) {
      this.abilityMgr.setCooldownMultiplier((1 - this.prestigeMgr.getAbilityCDR()) * (1 - achCDR));
    }

    // Wave modifier: re-apply goldAdditive and playerDamageMult on top of
    // everything else computed above. We read the modifier from the wave
    // state; if the wave is not a mod wave this is a no-op (effects = 1, 0).
    const activeMod = this.state.wave.waveModifier.active;
    if (activeMod && this.state.wave.waveModifier.pendingChoiceForWave === this.waveMgr.currentWave) {
      if (activeMod.effects.goldAdditive !== 0) {
        this.enemyMgr.setGoldMultipliers(totalGoldAdditive + activeMod.effects.goldAdditive, 1);
      }
      if (activeMod.effects.playerDamageMult !== 1) {
        t.baseDamage = Math.max(1, t.baseDamage * activeMod.effects.playerDamageMult);
      }
    }

    this.state.research = this.researchTree.getLevelsSnapshot();
  }

  private buildShotVariants(): ShotVariant[] {
    const variants: ShotVariant[] = [{}];
    const extra = this.prestigeMgr.getExtraShots();
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
    this.mines = [];
    this.reviveUsed = false;
    this.killStreak = 0;
    this.manaFullGoldTimer = 0;
    this.shotCounter = 0;
    const t = this.tower.snapshot;
    t.cooldown = 0;
    t.hp = TOWER_BASE.hp;
    t.maxHp = TOWER_BASE.maxHp;
    t.shieldCurrentCharges = 0;
    t.shieldRechargeTimer = 0;

    const startWave = Math.max(this.researchTree.getStartWave(), this.prestigeMgr.getWaveStartBonus());
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

    const headStartGold = this.prestigeMgr.getStartGold();
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
    const active = this.state.wave.waveModifier.active;
    const matchesWave = this.state.wave.waveModifier.pendingChoiceForWave === this.waveMgr.currentWave;
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

  private awardWaveModifierReward(snapshot: WaveModifierSnapshot): void {
    const reward = snapshot.reward;
    if (reward.gold > 0) {
      this.state.resources.gold += reward.gold;
      this.state.resources.lifetimeGold += reward.gold;
      this.state.stats.goldEarned += reward.gold;
    }
    if (reward.ap > 0) {
      this.state.resources.ascensionPoints += reward.ap;
      this.state.resources.apThisTranscendence += reward.ap;
      this.state.resources.lifetimeAP += reward.ap;
    }
    if (reward.tp > 0) {
      this.state.resources.transcendencePoints += reward.tp;
    }
    this.bus.emit('wave_modifier_chosen', {
      id: snapshot.id,
      name: snapshot.name,
      reward,
    });
    this.bus.emit('toast', {
      kind: 'milestone',
      text: `Mutator complete: ${snapshot.name}`,
      life: 4,
    });
  }

  private chooseWaveModifier(snapshot: WaveModifierSnapshot): void {
    this.state.wave.waveModifier.active = snapshot;
    this.state.wave.waveModifier.choiceForNextWave = null;
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
    // Award the modifier's flat reward (AP / gold / TP) on selection per
    // the wave modifier spec: picking is the win condition.
    this.awardWaveModifierReward(snapshot);
  }

  private skipWaveModifier(): void {
    this.state.wave.waveModifier.active = null;
    this.state.wave.waveModifier.choiceForNextWave = null;
    this.state.wave.waveModifier.pendingChoiceForWave = null;
    this.bus.emit('toast', {
      kind: 'info',
      text: 'Skipped mutator this wave.',
      life: 2.5,
    });
  }

  private applyFullTranscendenceReset(): void {
    this.automation.reset();
    this.abilityMgr.resetLevels();
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
    p.targetAscendWave = persisted.prestige.targetAscendWave ?? 30;

    this.state.wave = { ...persisted.wave };
    this.waveMgr.setState(this.state.wave);

    this.state.abilities = {};
    for (const id of Object.keys(persisted.abilities)) {
      const a = persisted.abilities[id];
      this.state.abilities[id] = { level: a.level, cooldown: 0, active: false, activeTimer: 0 };
    }
    for (const def of ABILITIES) {
      if (!this.state.abilities[def.id]) {
        this.state.abilities[def.id] = { level: 1, cooldown: 0, active: false, activeTimer: 0 };
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
    this.update(gameDt);
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

  private update(dt: number): void {
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
    if (ts.hp < ts.maxHp && ts.healthRegen > 0) {
      ts.hp = Math.min(ts.maxHp, ts.hp + (ts.maxHp * ts.healthRegen) * dt);
    }

    // Manual aim: if mouse held, attempt to spend 1 mana per shot for +30% fire rate.
    // If mana is insufficient, fall back to 1.0 fire rate (still aim at cursor).
    let manualAimBoost = false;
    if (this.mouseDown) {
      this.tower.setAimTarget(this.mouseX, this.mouseY);
      manualAimBoost = true;
    }
    this.tower.setFireRateMultiplier(manualAimBoost ? 1.3 : 1);

    if (this.tower.tickCooldown(dt)) {
      const target = this.mouseDown ? null : this.tower.acquireTarget(this.enemyMgr.list);

      if (this.mouseDown || target) {
        const shot = this.tower.rollShot();
        const variants = this.buildShotVariants();

        // Evolution: double_shot — every Nth shot fires double
        if (this.upgradeMgr.hasEvolutionEffect('double_shot')) {
          this.shotCounter += 1;
          const interval = this.upgradeMgr.getEvolutionEffectValue('double_shot');
          if (this.shotCounter % interval === 0) {
            variants.push({ posOffsetX: 0, posOffsetY: 12 });
          }
        }

        this.projectileMgr.fire(target, ts, {
          rawDamage: shot.damage,
          damageType: ts.damageType,
          isCrit: shot.isCrit,
          targetId: target?.id ?? null,
          variants,
          aimX: this.mouseDown ? this.mouseX : undefined,
          aimY: this.mouseDown ? this.mouseY : undefined,
        });
        this.tower.consumeCooldown();
        this.state.stats.shotsFired += 1;
        this.state.stats.damageDealt += shot.damage;
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
      for (const e of this.enemyMgr.list) {
        if (!e.alive) continue;
        const dx = e.x - mine.x;
        const dy = e.y - mine.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= mine.explosionRadius) {
          mine.alive = false;
          for (const target of this.enemyMgr.list) {
            if (!target.alive) continue;
            const tdx = target.x - mine.x;
            const tdy = target.y - mine.y;
            if (Math.sqrt(tdx * tdx + tdy * tdy) <= mine.explosionRadius) {
              this.enemyMgr.damage(target, mine.damage, false);
            }
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
          break;
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

    this.effects.tick(dt);
    this.effects.tickChainLightning(dt);
    this.notifications.tick(dt);
    this.automation.tick(dt);

    // HUD display tweening (every frame, before throttled UI update)
    this.ui.tickDisplayHud(dt, this.state);
    this.waveModModal.tick(dt);

    // Research progress + passive RP gain
    this.researchTree.setSpeedMultiplier(this.prestigeMgr.getResearchSpeedMultiplier());
    this.researchTree.addPassiveRP(
      dt,
      this.state.stats.lifetimeHighestWave,
      this.researchTree.getRPGainMultiplier(),
    );
    if (this.researchTree.tick(dt)) {
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
          this.researchTree.getRPGainMultiplier(),
        ),
      });
    }

    this.checkTranscendenceUnlockToast();
    this.saveMgr.tick(dt, this.state, (s) => this.saveMgr.save(s));
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
