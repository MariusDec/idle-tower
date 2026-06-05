import type { AbilityId, EnemyType, EnemyWaveStatsEntry, GameState, PanelTab, StatsInfo } from '../types';
import { ENEMY_DEFS } from '../data/enemies';
import {
  enemyHPForWave,
  bossHPForWave,
  enemySpeedForWave,
  enemyDamageForWave,
  goldDropForWave,
  isBossWave,
} from '../data/formulas';
import { HUD } from './HUD';
import { UpgradePanel } from './UpgradePanel';
import { UPGRADES } from '../data/upgrades';
import { AbilityPanel } from './AbilityPanel';
import { PrestigePanel } from './PrestigePanel';
import { TranscendencePanel } from './TranscendencePanel';
import { ResearchPanel, type ResearchPanelHandlers } from './ResearchPanel';
import { SettingsPanel } from './SettingsPanel';
import { AchievementPanel } from './AchievementPanel';
import { WelcomeBackModal, type WelcomeBackData } from './WelcomeBackModal';
import { EventBus } from '../game/EventBus';
import type { AutomationKey } from '../data/prestige';
import type { EffectiveAbilityStats } from '../data/abilities';
import { ABILITIES } from '../data/abilities';

interface TabDef {
  id: PanelTab;
  label: string;
}

const TABS: TabDef[] = [
  { id: 'upgrades', label: 'Upgrades' },
  { id: 'research', label: 'Research' },
  { id: 'abilities', label: 'Abilities' },
  { id: 'prestige', label: 'Prestige' },
  { id: 'transcendence', label: 'Transcendence' },
  { id: 'achievements', label: 'Achievements' },
  { id: 'settings', label: 'Settings' },
];

export interface AbilityAPI {
  canCast: (id: AbilityId, wave: number) => boolean;
  reasonBlocked: (id: AbilityId, wave: number) => string | null;
  canUpgrade: (id: AbilityId, wave: number) => boolean;
  isMaxed: (id: AbilityId) => boolean;
  getUpgradeCost: (id: AbilityId) => number;
  getEffectiveStats: (id: AbilityId) => EffectiveAbilityStats;
}

export interface ResearchAPI {
  rp: number;
  unlocked: ReadonlySet<string>;
  reasonBlocked: (id: string) => string | null;
  inProgress: { id: string; elapsed: number; total: number } | null;
  researchSpeedMultiplier: number;
}

export interface SpeedAPI {
  speeds: readonly number[];
  currentIndex: number;
  maxIndex: number;
}

export interface WaveControlAPI {
  autoProgress: boolean;
  currentWave: number;
  isIntermission: boolean;
}

export interface PrestigeAPI {
  canAscend: (wave: number) => boolean;
  canTranscend: (ap: number) => boolean;
  previewAP: (wave: number) => number;
  previewTP: (ap: number) => number;
  canSpend: (perkId: string, ap: number, tp: number) => boolean;
  isAutomationUnlocked: (key: AutomationKey) => boolean;
  isAutomationEnabled: (key: AutomationKey) => boolean;
  meetsPrerequisites: (perkId: string) => boolean;
  isExcluded: (perkId: string) => boolean;
  ascendUnlockWave: number;
  transcendUnlockAP: number;
  targetAscendWave: number;
}

export interface TargetingAPI {
  currentMode: string;
  setMode: (mode: string) => void;
}

export interface AudioAPI {
  volume: number;
  muted: boolean;
  setVolume: (v: number) => void;
  toggleMute: () => void;
}

export class UIManager {
  private readonly tabsRoot: HTMLElement;
  private readonly contentRoot: HTMLElement;
  private readonly hud: HUD;
  private readonly upgradePanel: UpgradePanel;
  private readonly abilityPanel: AbilityPanel;
  private readonly prestigePanel: PrestigePanel;
  private readonly transcendencePanel: TranscendencePanel;
  private readonly researchPanel: ResearchPanel;
  private readonly settingsPanel: SettingsPanel;
  private readonly achievementPanel: AchievementPanel;
  private readonly welcomeModal: WelcomeBackModal;
  private readonly bus: EventBus;
  private activeTab: PanelTab = 'upgrades';
  private damageLog: { time: number; amount: number }[] = [];
  private realTimeDps = 0;
  private smoothedDps = 0;
  private lastDpsUpdateTime = 0;
  private lastDpsDisplayTime = 0;
  private dpsFreezeTimer = 0;
  private onBuyUpgrade: (id: string) => void = () => {};
  private onCastAbility: (id: AbilityId) => void = () => {};
  private onUpgradeAbility: (id: AbilityId) => void = () => {};
  private onAscend: () => void = () => {};
  private onTranscend: () => void = () => {};
  private onSpendAP: (perkId: string) => void = () => {};
  private onUnlockResearch: (id: string) => void = () => {};
  private onCancelResearch: () => void = () => {};
  private onToggleAutomation: (key: AutomationKey, enabled: boolean) => void = () => {};
  private onTargetWaveChange: (wave: number) => void = () => {};
  private onSpeedChange: (index: number) => void = () => {};
  private onPrevWave: () => void = () => {};
  private onNextWave: () => void = () => {};
  private onToggleAutoProgress: () => void = () => {};
  private onClearSave: () => void = () => {};
  private onVolumeChange: (v: number) => void = () => {};
  private onMuteToggle: () => void = () => {};
  private onTargetingModeChange: (mode: string) => void = () => {};
  private audioApi: AudioAPI = {
    volume: 0.6,
    muted: false,
    setVolume: () => {},
    toggleMute: () => {},
  };
  private targetingApi: TargetingAPI = {
    currentMode: 'nearest',
    setMode: () => {},
  };
  private abilityApi: AbilityAPI = {
    canCast: () => false,
    reasonBlocked: () => 'Loading...',
    canUpgrade: () => false,
    isMaxed: () => false,
    getUpgradeCost: () => 0,
    getEffectiveStats: (_id) => ({
      level: 0,
      manaCost: 0,
      cooldown: 0,
      duration: 0,
      effectValue: 0,
      displayEffectValue: '',
      displayDuration: '',
      displayText: '',
      upgradeCost: 0,
      isMaxed: false,
      isUnlocked: false,
    }),
  };
  private prestigeApi: PrestigeAPI = {
    canAscend: () => false,
    canTranscend: () => false,
    previewAP: () => 0,
    previewTP: () => 0,
    canSpend: () => false,
    isAutomationUnlocked: () => false,
    isAutomationEnabled: () => false,
    meetsPrerequisites: () => true,
    isExcluded: () => false,
    ascendUnlockWave: 20,
    transcendUnlockAP: 100,
    targetAscendWave: 20,
  };
  private researchApi: ResearchAPI = {
    rp: 0,
    unlocked: new Set<string>(),
    reasonBlocked: () => 'Loading...',
    inProgress: null,
    researchSpeedMultiplier: 1,
  };
  private lastState: GameState | null = null;
  private cachedGoldMultiplier = 1;
  private uiFrameCounter = 0;
  private lastEnemyStatsWave = -1;
  private readonly UI_UPDATE_INTERVAL = 6;

  constructor(deps: {
    hudRoot: HTMLElement;
    tabsRoot: HTMLElement;
    contentRoot: HTMLElement;
    bus: EventBus;
    modalRoot: HTMLElement;
  }) {
    this.bus = deps.bus;
    this.tabsRoot = deps.tabsRoot;
    this.contentRoot = deps.contentRoot;
    this.hud = new HUD(deps.hudRoot);
    this.hud.setOnSpeedChange((index) => this.onSpeedChange(index));
    this.hud.setOnPrevWave(() => this.onPrevWave());
    this.hud.setOnNextWave(() => this.onNextWave());
    this.hud.setOnToggleAutoProgress(() => this.onToggleAutoProgress());
    this.upgradePanel = new UpgradePanel((id) => this.onBuyUpgrade(id));
    this.abilityPanel = new AbilityPanel({
      onCast: (id) => this.onCastAbility(id),
      onUpgrade: (id) => this.onUpgradeAbility(id),
      canCast: (id, wave) => this.abilityApi.canCast(id, wave),
      reasonBlocked: (id, wave) => this.abilityApi.reasonBlocked(id, wave),
      canUpgrade: (id, wave) => this.abilityApi.canUpgrade(id, wave),
      isMaxed: (id) => this.abilityApi.isMaxed(id),
      getUpgradeCost: (id) => this.abilityApi.getUpgradeCost(id),
      getEffectiveStats: (id) => this.abilityApi.getEffectiveStats(id),
    });
    this.prestigePanel = new PrestigePanel({
      onAscend: () => this.onAscend(),
      onSpend: (id) => this.onSpendAP(id),
      canAscend: (w) => this.prestigeApi.canAscend(w),
      canSpend: (id, ap, tp) => this.prestigeApi.canSpend(id, ap, tp),
      previewAP: (w) => this.prestigeApi.previewAP(w),
      ascendUnlockWave: this.prestigeApi.ascendUnlockWave,
    });
    this.transcendencePanel = new TranscendencePanel({
      onTranscend: () => this.onTranscend(),
      onSpend: (id) => this.onSpendAP(id),
      onToggleAutomation: (key, enabled) => this.onToggleAutomation(key, enabled),
      onTargetWaveChange: (w) => this.onTargetWaveChange(w),
      canTranscend: (ap) => this.prestigeApi.canTranscend(ap),
      canSpend: (id, ap, tp) => this.prestigeApi.canSpend(id, ap, tp),
      isAutomationUnlocked: (key) => this.prestigeApi.isAutomationUnlocked(key),
      isAutomationEnabled: (key) => this.prestigeApi.isAutomationEnabled(key),
      meetsPrerequisites: (id) => this.prestigeApi.meetsPrerequisites(id),
      isExcluded: (id) => this.prestigeApi.isExcluded(id),
      previewTP: (ap) => this.prestigeApi.previewTP(ap),
      transcendUnlockAP: this.prestigeApi.transcendUnlockAP,
      targetAscendWave: this.prestigeApi.targetAscendWave,
    });
    const researchHandlers: ResearchPanelHandlers = {
      onStartResearch: (id) => this.onUnlockResearch(id),
      onCancelResearch: () => this.onCancelResearch(),
      rp: 0,
      unlocked: new Set<string>(),
      reasonBlocked: (id) => this.researchApi.reasonBlocked(id),
      inProgress: null,
      researchSpeedMultiplier: 1,
    };
    // Make dynamic fields live-reference the current API
    Object.defineProperty(researchHandlers, 'inProgress', { get: () => this.researchApi.inProgress, enumerable: true });
    Object.defineProperty(researchHandlers, 'researchSpeedMultiplier', { get: () => this.researchApi.researchSpeedMultiplier, enumerable: true });
    Object.defineProperty(researchHandlers, 'rp', { get: () => this.researchApi.rp, enumerable: true });
    Object.defineProperty(researchHandlers, 'unlocked', { get: () => this.researchApi.unlocked, enumerable: true });
    this.researchPanel = new ResearchPanel(researchHandlers);
    this.settingsPanel = new SettingsPanel({
      onClearSave: () => this.onClearSave(),
      onVolumeChange: (v) => this.onVolumeChange(v),
      onMuteToggle: () => this.onMuteToggle(),
      onTargetingModeChange: (m) => this.onTargetingModeChange(m),
      initialVolume: this.audioApi.volume,
      initialMuted: this.audioApi.muted,
      currentTargetingMode: this.targetingApi.currentMode,
    });
    this.achievementPanel = new AchievementPanel({
      getProgress: (def) => {
        if (def.stat === 'researchCount') return this.lastState?.research.length ?? 0;
        return (this.lastState?.stats as any)?.[def.stat] ?? 0;
      },
    });
    this.welcomeModal = new WelcomeBackModal(deps.modalRoot);
    this.renderTabs();
    this.activateTabButtons('upgrades');
    this.showTab('upgrades');

    this.bus.on('upgrade_purchased', (payload: unknown) => {
      const p = payload as { id: string; level: number };
      const def = UPGRADES.find(u => u.id === p.id);
      const name = def?.name ?? p.id;
      this.bus.emit('toast', { kind: 'info', text: `Upgraded: ${name} Lv.${p.level}`, life: 2 });
      this.upgradePanel.flashButton(p.id);
    });
    this.bus.on('ability_cast', (payload: unknown) => {
      const p = payload as { id: AbilityId; def: { name: string } };
      this.abilityPanel.flashCast(p.id);
      this.bus.emit('toast', { kind: 'milestone', text: `${p.def.name} cast!`, life: 2.5 });
    });
    this.bus.on('ability_upgraded', (payload: unknown) => {
      const p = payload as { id: AbilityId; level: number };
      const def = ABILITIES.find(a => a.id === p.id);
      const name = def?.name ?? p.id;
      this.abilityPanel.flashUpgrade(p.id);
      this.bus.emit('toast', {
        kind: 'info',
        text: `${name} → Lv.${p.level}${p.level >= (def?.maxLevel ?? 0) ? ' (MAX)' : ''}`,
        life: 2,
      });
    });
    this.bus.on('welcome_back', (payload: unknown) => {
      const data = payload as WelcomeBackData;
      if (data.result.elapsedSeconds > 0) {
        this.welcomeModal.show(data, () => {});
      }
    });
    this.bus.on('tower_damage_dealt', (payload: unknown) => {
      const p = payload as { amount: number };
      this.damageLog.push({ time: performance.now(), amount: p.amount });
    });
  }

  setOnBuyUpgrade(handler: (id: string) => void): void {
    this.onBuyUpgrade = handler;
  }

  setOnCastAbility(handler: (id: AbilityId) => void): void {
    this.onCastAbility = handler;
  }

  setOnUpgradeAbility(handler: (id: AbilityId) => void): void {
    this.onUpgradeAbility = handler;
  }

  setOnAscend(handler: () => void): void {
    this.onAscend = handler;
  }

  setOnTranscend(handler: () => void): void {
    this.onTranscend = handler;
  }

  setOnSpendAP(handler: (perkId: string) => void): void {
    this.onSpendAP = handler;
  }

  setOnUnlockResearch(handler: (id: string) => void): void {
    this.onUnlockResearch = handler;
  }

  setOnCancelResearch(handler: () => void): void {
    this.onCancelResearch = handler;
  }

  setOnToggleAutomation(handler: (key: AutomationKey, enabled: boolean) => void): void {
    this.onToggleAutomation = handler;
  }

  setOnTargetWaveChange(handler: (wave: number) => void): void {
    this.onTargetWaveChange = handler;
  }

  setOnSpeedChange(handler: (index: number) => void): void {
    this.onSpeedChange = handler;
  }

  setOnPrevWave(handler: () => void): void {
    this.onPrevWave = handler;
  }

  setOnNextWave(handler: () => void): void {
    this.onNextWave = handler;
  }

  setOnToggleAutoProgress(handler: () => void): void {
    this.onToggleAutoProgress = handler;
  }

  setOnClearSave(handler: () => void): void {
    this.onClearSave = handler;
  }

  setOnVolumeChange(handler: (v: number) => void): void {
    this.onVolumeChange = handler;
  }

  setOnMuteToggle(handler: () => void): void {
    this.onMuteToggle = handler;
  }

  setOnTargetingModeChange(handler: (mode: string) => void): void {
    this.onTargetingModeChange = handler;
  }

  setAudioAPI(api: AudioAPI): void {
    this.audioApi = api;
  }

  setTargetingAPI(api: TargetingAPI): void {
    this.targetingApi = api;
  }

  setSpeedAPI(api: SpeedAPI): void {
    this.hud.setSpeedAPI(api);
  }

  setWaveControlAPI(api: WaveControlAPI): void {
    this.hud.setWaveControlAPI(api);
  }

  setAbilityAPI(api: AbilityAPI): void {
    this.abilityApi = api;
    if (this.lastState && this.activeTab === 'abilities') {
      this.abilityPanel.update(this.lastState);
    }
  }

  setPrestigeAPI(api: PrestigeAPI): void {
    this.prestigeApi = api;
    if (this.lastState) {
      if (this.activeTab === 'prestige') {
        this.prestigePanel.update(this.lastState);
      } else if (this.activeTab === 'transcendence') {
        this.transcendencePanel.update(this.lastState);
      }
    }
  }

  setStatsInfo(info: StatsInfo): void {
    this.cachedGoldMultiplier = info.goldMultiplier;
    this.hud.setStatsInfo(info);
  }

  setResearchAPI(api: ResearchAPI): void {
    this.researchApi = api;
    if (this.lastState && this.activeTab === 'research') {
      this.researchPanel.update(this.lastState);
    }
  }

  getFpsElement(): HTMLElement {
    return this.hud.getFpsEl();
  }

  setDPS(dps: number): void {
    this.hud.setDPS(dps);
  }

  /**
   * Per-frame HUD number tweening. Called from Game.update() before the
   * throttled ui.update() writes the values to the DOM.
   */
  tickDisplayHud(dt: number, state: GameState): void {
    this.hud.tickDisplay(dt, state);
  }

  update(state: GameState): void {
    this.lastState = state;

    // Per-frame DPS tracking (lightweight JS, runs every frame)
    const now = performance.now();
    const windowMs = 10_000;
    const cutoff = now - windowMs;
    while (this.damageLog.length > 0 && this.damageLog[0].time < cutoff) {
      this.damageLog.shift();
    }
    let totalDmg = 0;
    for (const entry of this.damageLog) totalDmg += entry.amount;
    this.realTimeDps = totalDmg / (windowMs / 1000);

    const dt = this.lastDpsUpdateTime ? (now - this.lastDpsUpdateTime) / 1000 : 0.016;
    this.lastDpsUpdateTime = now;

    if (state.wave.intermission) {
      this.dpsFreezeTimer = 2;
    } else if (this.dpsFreezeTimer > 0) {
      this.dpsFreezeTimer = Math.max(0, this.dpsFreezeTimer - dt);
    }

    if (this.dpsFreezeTimer <= 0) {
      const smoothingTime = 10;
      const alpha = dt > 0 ? 1 - Math.exp(-dt / smoothingTime) : 1;
      this.smoothedDps = this.smoothedDps * (1 - alpha) + this.realTimeDps * alpha;
    }

    if (now - this.lastDpsDisplayTime >= 3000) {
      this.hud.setDPS(this.smoothedDps);
      this.lastDpsDisplayTime = now;
    }

    // Throttled DOM updates (~10fps at 60fps game loop)
    this.uiFrameCounter++;
    if (this.uiFrameCounter % this.UI_UPDATE_INTERVAL !== 0) return;

    this.updateTabLocks(state);
    this.hud.update(state);
    if (this.activeTab === 'upgrades') {
      this.upgradePanel.update(state);
    } else if (this.activeTab === 'abilities') {
      this.abilityPanel.update(state);
    } else if (this.activeTab === 'prestige') {
      this.prestigePanel.update(state);
    } else if (this.activeTab === 'transcendence') {
      this.transcendencePanel.update(state);
    } else if (this.activeTab === 'research') {
      this.researchPanel.update(state);
    } else if (this.activeTab === 'achievements') {
      this.achievementPanel.update(state);
    } else if (this.activeTab === 'settings') {
      this.settingsPanel.update();
    }
    this.pushFrameStats(state);
    this.pushEnemyStats(state);
  }

  private pushEnemyStats(state: GameState): void {
    const wave = state.wave.number;
    if (wave === this.lastEnemyStatsWave) return;
    this.lastEnemyStatsWave = wave;
    const types: EnemyType[] = [];
    if (isBossWave(wave)) {
      types.push('boss');
    } else {
      types.push('normal');
      if (wave >= 3) types.push('fast');
      if (wave >= 5) types.push('tank');
      if (wave >= 8) types.push('flying');
      if (wave >= 12) types.push('splitter');
      if (wave >= 15) types.push('healer');
      if (wave >= 20) types.push('shielded');
    }
    const entries: EnemyWaveStatsEntry[] = types.map(t => {
      const def = ENEMY_DEFS[t];
      const hp = t === 'boss' ? bossHPForWave(def.baseHP, wave) : enemyHPForWave(def.baseHP, wave);
      return {
        type: t,
        hp,
        speed: enemySpeedForWave(def.baseSpeed, wave),
        armor: def.armor,
        magicResist: def.magicResist,
        damage: enemyDamageForWave(def.baseDamage, wave),
        fireRate: def.fireRate,
        gold: goldDropForWave(def.baseGold, wave),
      };
    });
    this.hud.setEnemyStatsInfo(entries);
  }

  private pushFrameStats(state: GameState): void {
    const t = state.tower;
    const r = state.resources;
    this.hud.setStatsInfo({
      damage: t.baseDamage,
      dps: this.realTimeDps,
      hp: t.hp,
      maxHp: t.maxHp,
      healthRegen: t.healthRegen,
      critChance: t.critChance,
      critDamage: t.critMultiplier,
      range: t.range,
      fireRate: t.fireRate,
      defense: t.defense,
      armor: t.armor,
      lifesteal: t.lifesteal,
      thorns: t.thorns,
      manaRegen: r.manaRegen,
      maxMana: r.maxMana,
      goldMultiplier: this.cachedGoldMultiplier,
    });
  }

  private renderTabs(): void {
    this.tabsRoot.innerHTML = '';
    for (const t of TABS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tab-btn';
      if (t.id === 'research') btn.classList.add('tab-locked');
      btn.textContent = t.label;
      btn.dataset.tab = t.id;
      btn.addEventListener('click', () => {
        if (btn.classList.contains('tab-locked')) return;
        this.showTab(t.id);
      });
      this.tabsRoot.appendChild(btn);
    }
  }

  private updateTabLocks(state: GameState): void {
    const researchUnlocked = (state.stats.lifetimeAscensions ?? state.stats.ascensions) >= 1;
    for (const el of Array.from(this.tabsRoot.querySelectorAll<HTMLButtonElement>('.tab-btn'))) {
      if (el.dataset.tab === 'research') {
        el.classList.toggle('tab-locked', !researchUnlocked);
        if (!researchUnlocked) {
          el.title = 'Unlocks after first Ascension';
        } else {
          el.title = '';
        }
      }
    }
  }

  setActiveTab(id: PanelTab): void {
    this.showTab(id);
  }

  private showTab(id: PanelTab): void {
    this.activeTab = id;
    this.activateTabButtons(id);
    this.contentRoot.innerHTML = '';
    if (id === 'upgrades') {
      this.upgradePanel.mount(this.contentRoot);
      if (this.lastState) this.upgradePanel.update(this.lastState);
    } else if (id === 'abilities') {
      this.abilityPanel.mount(this.contentRoot);
      if (this.lastState) this.abilityPanel.update(this.lastState);
    } else if (id === 'prestige') {
      this.prestigePanel.mount(this.contentRoot);
      if (this.lastState) this.prestigePanel.update(this.lastState);
    } else if (id === 'transcendence') {
      this.transcendencePanel.mount(this.contentRoot);
      if (this.lastState) this.transcendencePanel.update(this.lastState);
    } else if (id === 'research') {
      this.researchPanel.mount(this.contentRoot);
      if (this.lastState) this.researchPanel.update(this.lastState);
    } else if (id === 'achievements') {
      this.achievementPanel.mount(this.contentRoot);
      if (this.lastState) this.achievementPanel.update(this.lastState);
    } else if (id === 'settings') {
      this.settingsPanel.mount(this.contentRoot);
    }
  }

  private activateTabButtons(id: PanelTab): void {
    for (const el of Array.from(this.tabsRoot.querySelectorAll<HTMLButtonElement>('.tab-btn'))) {
      el.classList.toggle('active', el.dataset.tab === id);
    }
  }

  notify(kind: 'info' | 'warning' | 'milestone', text: string): void {
    this.bus.emit('toast', { kind, text });
  }
}
