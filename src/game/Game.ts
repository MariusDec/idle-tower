import type { AbilityId, GameState, TowerState, AbilityState, ResourceState, PrestigeState, GameStats, Mine } from '../types';
import { computeUpgradeValue, GAME_SPEEDS, DEFAULT_SPEED_INDEX, MAX_SPEED_INDEX } from '../types';
import { TOWER_BASE, TOWER_VISUAL } from '../data/tower';
import { UPGRADES } from '../data/upgrades';
import { ENEMY_DEFS } from '../data/enemies';
import { ABILITIES } from '../data/abilities';
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
import { UIManager } from '../ui/UIManager';
import { isBossWave } from '../data/formulas';
import type { AutomationKey } from '../data/prestige';

const BASE_MANA_REGEN = 2;
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
    targetAscendWave: 50,
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
    startedAt: Date.now(),
  };
  return {
    timestamp: Date.now(),
    tower,
    enemies: [],
    projectiles: [],
    resources,
    upgrades: {},
    research: [],
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
    },
    stats,
  };
}

export interface GameDeps {
  bus: EventBus;
  ui: UIManager;
  notificationRoot: HTMLElement;
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

  private speedIndex = DEFAULT_SPEED_INDEX;
  private maxSpeedIndex = MAX_SPEED_INDEX;

  constructor(canvas: HTMLCanvasElement, deps: GameDeps) {
    this.canvas = canvas;
    this.bus = deps.bus;
    this.ui = deps.ui;
    this.renderer = new Renderer(canvas);
    this.state = makeInitialState();
    this.tower = new Tower(this.state.tower);
    this.resourceMgr = new ResourceManager(this.state.resources, this.state.stats, this.bus);
    this.enemyMgr = new EnemyManager(this.bus, this.resourceMgr);
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
    this.effects = new EffectsManager();
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
    this.researchTree = new ResearchTree(this.bus);
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
    this.saveMgr = new SaveManager(this.bus);

    this.tower.setPosition(this.canvas.width / 2, this.canvas.height / 2);
    this.state.upgrades = this.upgradeMgr.snapshot();
    this.applyUpgradeEffects();
    this.syncUiApis();

    this.bus.on('enemy_damaged', (payload: unknown) => {
      const p = payload as { enemy: { x: number; y: number; type: string; armor: number; magicResist: number }; amount: number; killed: boolean; isCrit?: boolean };
      const def = ENEMY_DEFS[p.enemy.type as keyof typeof ENEMY_DEFS];
      this.effects.emitHitSparks(p.enemy.x, p.enemy.y, def.color, p.killed ? 6 : 3);
      this.effects.emitDamageNumber(p.enemy.x, p.enemy.y, p.amount, !!p.isCrit);
      const ls = this.tower.snapshot.lifesteal;
      if (ls > 0 && p.amount > 0) {
        const ts = this.tower.snapshot;
        ts.hp = Math.min(ts.maxHp, ts.hp + p.amount * ls);
      }
    });
    this.bus.on('enemy_killed', (enemy) => {
      const e = enemy as { x: number; y: number; type: string };
      const def = ENEMY_DEFS[e.type as keyof typeof ENEMY_DEFS];
      this.state.stats.enemiesKilled += 1;
      if (e.type === 'boss') {
        this.state.stats.bossesKilled += 1;
        this.effects.emitBossDeathShockwave(e.x, e.y);
        if (this.state.stats.bossesKilled === 1) {
          this.bus.emit('toast', { kind: 'milestone', text: 'First boss defeated! +200g', life: 5 });
        } else {
          this.bus.emit('toast', { kind: 'milestone', text: 'Boss defeated!', life: 4 });
        }
      }
      this.effects.emitDeathBurst(e.x, e.y, def.color, def.radius);
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
      const raw = Math.max(0, amount as number);
      if (raw <= 0) return;
      const ts = this.tower.snapshot;
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
      const w = wave as number;
      if (WAVE_MILESTONES.has(w) && !this.announcedMilestones.has(w)) {
        this.announcedMilestones.add(w);
        const kind = isBossWave(w) ? 'milestone' : 'info';
        const text = isBossWave(w)
          ? `Wave ${w} — BOSS INCOMING`
          : `Wave ${w} reached`;
        this.bus.emit('toast', { kind, text, life: 4 });
      }
    });
    this.bus.on('upgrades_changed', (levels: Record<string, number>) => {
      this.state.upgrades = { ...(levels as Record<string, number>) };
      this.applyUpgradeEffects();
    });
    this.bus.on('research_unlocked', (payload: unknown) => {
      const p = payload as { id: string };
      this.state.research = Array.from(this.researchTree.unlocked);
      this.applyUpgradeEffects();
      if (!this.researchAnnounced.has(p.id)) {
        this.researchAnnounced.add(p.id);
        this.bus.emit('toast', { kind: 'milestone', text: 'Research unlocked!', life: 3.5 });
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
      const p = payload as { id: AbilityId; def: { effectType: string } };
      const t = this.tower.snapshot;
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
    this.loop();
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

  castAbility(id: AbilityId): boolean {
    return this.abilityMgr.tryCast(id, this.state.wave.highestWave);
  }

  ascend(): number {
    if (!this.prestigeMgr.canAscend(this.state.wave.highestWave)) return 0;
    const { ap, rp } = this.prestigeMgr.performAscension(this.state);
    if (ap <= 0) return 0;
    this.researchTree.addRP(rp);
    this.applySavedStateReset();
    this.saveMgr.save(this.state);
    this.syncUiApis();
    this.bus.emit('toast', {
      kind: 'milestone',
      text: `Ascension! +${ap} AP, +${rp} RP. Your run has been reset.`,
      life: 6,
    });
    return ap;
  }

  transcend(): number {
    const ascensionPoints = this.state.resources.ascensionPoints;
    if (!this.prestigeMgr.canTranscend(ascensionPoints)) return 0;
    const { tp } = this.prestigeMgr.performTranscendence(this.state);
    if (tp <= 0) return 0;
    this.applyFullTranscendenceReset();
    this.saveMgr.save(this.state);
    this.syncUiApis();
    this.bus.emit('toast', {
      kind: 'milestone',
      text: `Transcendence! +${tp} TP. Everything resets. New power awaits.`,
      life: 7,
    });
    return tp;
  }

  spendAP(perkId: string): boolean {
    const ok = this.prestigeMgr.spendPerk(perkId);
    if (ok) {
      this.applyUpgradeEffects();
      this.syncUiApis();
    }
    return ok;
  }

  unlockResearch(id: string): boolean {
    const ok = this.researchTree.unlock(id);
    if (ok) {
      this.state.research = Array.from(this.researchTree.unlocked);
      this.applyUpgradeEffects();
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

  getSpeed(): number {
    return GAME_SPEEDS[this.speedIndex];
  }

  getSpeedIndex(): number {
    return this.speedIndex;
  }

  getMaxSpeedIndex(): number {
    return this.maxSpeedIndex;
  }

  getAvailableSpeeds(): readonly number[] {
    return GAME_SPEEDS.slice(0, this.maxSpeedIndex + 1);
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
    this.maxSpeedIndex = Math.max(0, Math.min(GAME_SPEEDS.length - 1, Math.floor(index)));
    if (this.speedIndex > this.maxSpeedIndex) {
      this.speedIndex = this.maxSpeedIndex;
    }
  }

  private formatSpeedLabel(index: number): string {
    const v = GAME_SPEEDS[index];
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
  }

  get eventBus(): EventBus {
    return this.bus;
  }

  get gameState(): GameState {
    return this.state;
  }

  private syncUiApis(): void {
    this.ui.setPrestigeAPI({
      canAscend: (wave) => this.prestigeMgr.canAscend(wave),
      canTranscend: (ap) => this.prestigeMgr.canTranscend(ap),
      previewAP: (wave) => this.prestigeMgr.previewAP(wave),
      previewTP: (lap) => this.prestigeMgr.previewTP(lap),
      canSpend: (perkId, ap, tp) => this.prestigeMgr.canSpendAP(perkId) && ap >= 1 || this.prestigeMgr.canSpendTP(perkId) && tp >= 1,
      isAutomationUnlocked: (key) => this.prestigeMgr.isAutomationUnlocked(key),
      isAutomationEnabled: (key) => this.prestigeMgr.getAutomationEnabled(key),
      ascendUnlockWave: this.prestigeMgr.ascensionUnlockWave(),
      transcendUnlockAP: this.prestigeMgr.transcendenceUnlockAP(),
      targetAscendWave: this.state.prestige.targetAscendWave,
    });
    this.ui.setResearchAPI({
      rp: this.researchTree.rp,
      unlocked: this.researchTree.unlocked,
      reasonBlocked: (id) => this.researchTree.reasonBlocked(id),
    });
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
        case 'fireRate': t.fireRate += total; break;
        case 'range': t.range += total; break;
        case 'critChance': t.critChance = Math.min(1, t.critChance + total); break;
        case 'critDamage': t.critMultiplier += total; break;
        case 'manaRegen': manaRegenAdd += total; break;
        case 'goldMulti': goldAdditive += total; break;
        case 'health': healthValue += total; break;
        case 'healthRegen': t.healthRegen = total; break;
        case 'defense': t.defense = total; break;
        case 'armor': t.armor = total; break;
        case 'knockbackForce': t.knockbackForce = total; break;
        case 'lifesteal': t.lifesteal = total; break;
        case 'shockwave': {
          const lvl = total;
          t.shockwaveSize = 110 + (lvl - 1) * 5;
          t.shockwaveCooldown = Math.max(3, 30 + (lvl - 1) * -0.5);
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
          t.shieldMaxCharges = Math.max(5, level / 11);
          if (t.shieldMaxCharges > oldMax) {
            t.shieldCurrentCharges += t.shieldMaxCharges - oldMax;
          }
          t.shieldCurrentCharges = Math.min(t.shieldCurrentCharges, t.shieldMaxCharges);
          break;
        }
      }
    }

    t.maxHp = TOWER_BASE.maxHp + healthValue;
    if (oldMaxHp > 0 && t.maxHp > oldMaxHp && oldHp > 0) {
      const heal = (t.maxHp - oldMaxHp) * (oldHp / oldMaxHp);
      t.hp = Math.min(t.maxHp, oldHp + heal);
    } else if (t.hp > t.maxHp) {
      t.hp = t.maxHp;
    }

    const lifetimeBonus = this.prestigeMgr.getLifetimeAPBonus();
    const apDamage = lifetimeBonus.damage;
    const apGold = lifetimeBonus.gold;
    const tpDamage = this.prestigeMgr.getTPDamageMultiplicative();
    const tpResource = this.prestigeMgr.getTPResourceMultiplicative();
    const researchGoldMulti = this.researchTree.getGoldMultiplicative();
    const researchManaMulti = this.researchTree.getManaRegenMultiplicative();
    const researchCostReduction = this.researchTree.getAbilityCostReduction();

    t.baseDamage = t.baseDamage * (1 + apDamage) * tpDamage;
    t.baseDamage = Math.max(1, t.baseDamage);
    this.state.resources.manaRegen = (BASE_MANA_REGEN + manaRegenAdd) * researchManaMulti;
    const totalGoldAdditive = (goldAdditive + apGold) * researchGoldMulti * tpResource;

    this.enemyMgr.setGoldMultipliers(totalGoldAdditive, 1);
    this.abilityMgr.setUpgradeGoldAdditive(goldAdditive);
    this.abilityMgr.setAbilityCostMultiplier(1 - researchCostReduction);
    this.projectileMgr.setDamageMultipliers(0, 1);
    this.projectileMgr.setPierceExtra(this.researchTree.getPierceCount());
    this.enemyMgr.setGoldLuck(this.researchTree.getGoldLuckChance(), 3);

    this.waveMgr.setWaveSkipChance(this.prestigeMgr.getWaveSkipChance());

    this.state.research = Array.from(this.researchTree.unlocked);
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
      variants.push({ angleOffset: Math.PI });
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
    const t = this.tower.snapshot;
    t.cooldown = 0;
    t.hp = TOWER_BASE.hp;
    t.maxHp = TOWER_BASE.maxHp;
    t.shieldCurrentCharges = 0;
    t.shieldRechargeTimer = 0;

    this.state.resources.ascensionPoints = 0;
    this.state.stats.ascensions = 0;

    const startWave = this.researchTree.getStartWave();
    if (startWave > 1) {
      this.waveMgr.startAtWave(startWave);
      this.state.wave.highestWave = startWave;
    } else {
      this.waveMgr.reset();
    }
    this.state.wave = this.waveMgr.snapshot;
    if (startWave > 1) {
      const startGold = Math.max(50, Math.floor(Math.pow(1.08, startWave - 1) * 60));
      this.state.resources.gold += startGold;
    }

    this.applyUpgradeEffects();
    this.state.upgrades = this.upgradeMgr.snapshot();
  }

  private applyFullTranscendenceReset(): void {
    this.researchTree.resetForAscension();
    this.state.research = [];
    this.automation.reset();
    this.applySavedStateReset();
  }

  private applyPersistedState(persisted: PersistentState): void {
    const r = this.state.resources;
    r.gold = persisted.resources.gold;
    r.mana = persisted.resources.mana;
    r.maxMana = persisted.resources.maxMana;
    r.manaRegen = persisted.resources.manaRegen;
    r.ascensionPoints = persisted.resources.ascensionPoints;
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
    s.transcendences = persisted.stats.transcendences;
    s.startedAt = persisted.stats.startedAt;

    this.state.upgrades = { ...persisted.upgrades };
    this.migrateUpgrades(this.state.upgrades);
    this.state.research = [...(persisted.research ?? [])];
    this.researchTree.replaceUnlocked(persisted.research ?? [], persisted.resources.ascensionPoints);

    const p = this.state.prestige;
    p.apSpent = { ...persisted.prestige.apSpent };
    p.tpSpent = { ...(persisted.prestige.tpSpent ?? {}) };
    p.automationFlags = persisted.prestige.automationFlags ?? {
      autoBuy: false,
      autoAbilities: false,
      autoAscend: false,
      autoTranscend: false,
    };
    p.targetAscendWave = persisted.prestige.targetAscendWave ?? 50;

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
    t.targetingMode = persisted.tower.targetingMode;
    t.hp = persisted.tower.hp ?? TOWER_BASE.hp;
    t.maxHp = persisted.tower.maxHp ?? TOWER_BASE.maxHp;

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
    const gameDt = dt * speed;
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

    const ts = this.tower.snapshot;
    if (ts.hp < ts.maxHp && ts.healthRegen > 0) {
      ts.hp = Math.min(ts.maxHp, ts.hp + (ts.maxHp * ts.healthRegen) * dt);
    }

    this.tower.setActiveMode(this.mouseDown);
    if (this.mouseDown) {
      this.tower.setAimTarget(this.mouseX, this.mouseY);
    }

    if (this.tower.tickCooldown(dt)) {
      const target = this.mouseDown ? null : this.tower.acquireTarget(this.enemyMgr.list);

      if (this.mouseDown || target) {
        const shot = this.tower.rollShot();
        const variants = this.buildShotVariants();
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
      }
    }

    if (ts.landMineDamage > 0 && ts.landMineFrequency > 0) {
      ts.landMineTimer -= dt;
      if (ts.landMineTimer <= 0) {
        ts.landMineTimer = ts.landMineFrequency;
        const angle = Math.random() * Math.PI * 2;
        const dist = 30 + Math.random() * Math.max(0, ts.range - 30);
        const mx = ts.x + Math.cos(angle) * dist;
        const my = ts.y + Math.sin(angle) * dist;
        if (this.mines.length >= 10) {
          this.mines.shift();
        }
        this.mines.push({
          id: nextId(),
          x: mx,
          y: my,
          damage: ts.baseDamage * ts.landMineDamage,
          explosionRadius: 50,
          alive: true,
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
    this.notifications.tick(dt);
    this.automation.tick(dt);

    this.checkTranscendenceUnlockToast();
    this.saveMgr.tick(dt, this.state, (s) => this.saveMgr.save(s));
  }

  private checkTranscendenceUnlockToast(): void {
    if (this.transcendenceUnlockedAnnounced) return;
    if (this.prestigeMgr.canTranscend(this.state.resources.ascensionPoints)) {
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
    });
  }
}
