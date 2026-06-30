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
import { RunSummaryModal, type RunSummaryData } from './RunSummaryModal';
import { StatsPanel } from './StatsPanel';
import { MilestoneStrip } from './MilestoneStrip';
import { AbilityBar } from './AbilityBar';
import { MobileSheet, type MobileSheetTab } from './MobileSheet';
import { BottomNav, type BottomNavItem } from './BottomNav';
import { upcomingMilestones, milestoneAtWave } from '../data/milestones';
import { EventBus } from '../game/EventBus';
import { TalentPanel, type TalentAPIDeps } from './TalentPanel';
import type { PassiveAPIDeps } from './PassivePanel';
import { EquipmentPanel, type EquipmentAPIDeps } from './EquipmentPanel';
import type { AutomationKey } from '../data/prestige';
import type { EffectiveAbilityStats } from '../data/abilities';
import { ABILITIES } from '../data/abilities';
import { hasClass, toggleClass, setStyle } from '../utils/dom';

interface TabDef {
  id: PanelTab;
  label: string;
}

const TABS: TabDef[] = [
  { id: 'upgrades', label: 'Upgrades' },
  { id: 'research', label: 'Research' },
  { id: 'abilities', label: 'Abilities' },
  { id: 'talents', label: 'Talents' },
  { id: 'equipment', label: 'Equipment' },
  { id: 'prestige', label: 'Prestige' },
  { id: 'transcendence', label: 'Transcendence' },
  { id: 'achievements', label: 'Achievements' },
  { id: 'stats', label: 'Stats' },
  { id: 'settings', label: 'Settings' },
];

const PANEL_WIDTH_KEY = 'the-tower-panel-width';
const PANEL_COLLAPSED_KEY = 'the-tower-panel-collapsed';
const PANEL_MIN = 280;
const CANVAS_MIN = 420;
const MOBILE_BREAKPOINT = 768;

export interface AbilityAPI {
  canCast: (id: AbilityId, wave: number) => boolean;
  reasonBlocked: (id: AbilityId, wave: number) => string | null;
  canUpgrade: (id: AbilityId, wave: number) => boolean;
  isMaxed: (id: AbilityId) => boolean;
  getUpgradeCost: (id: AbilityId) => number;
  getEffectiveStats: (id: AbilityId) => EffectiveAbilityStats;
  getXp: (id: AbilityId) => number;
}

export interface ResearchAPI {
  rp: number;
  levels: Record<string, number>;
  unlocked: ReadonlySet<string>;
  reasonBlocked: (id: string) => string | null;
  inProgress: { id: string; elapsed: number; total: number; targetLevel: number } | null;
  researchSpeedMultiplier: number;
  rpGainRate: number;
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
  private readonly runSummaryModal: RunSummaryModal;
  private readonly statsPanel: StatsPanel;
  private readonly milestoneStrip: MilestoneStrip;
  private readonly talentPanel: TalentPanel;
  private readonly equipmentPanel: EquipmentPanel;
  private abilityBar: AbilityBar | null = null;
  private mobileSheet: MobileSheet | null = null;
  private bottomNav: BottomNav | null = null;
  private readonly panelRoot: HTMLElement;
  private readonly abilityBarRoot: HTMLElement;
  private readonly bottomNavRoot: HTMLElement;
  private readonly mobileSheetRoot: HTMLElement;
  private readonly panelToggle: HTMLButtonElement | null;
  private readonly panelResizer: HTMLElement | null;
  private readonly bus: EventBus;
  private isMobile = false;
  private mobileMatchMedia: MediaQueryList | null = null;
  private mobileBoundChange: ((ev: MediaQueryListEvent) => void) | null = null;
  private resizeState: { startX: number; startWidth: number } | null = null;
  private boundResizeMove: ((ev: PointerEvent) => void) | null = null;
  private boundResizeUp: ((ev: PointerEvent) => void) | null = null;
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
  private talentApi: TalentAPIDeps = {
    allocated: {},
    unspentPoints: () => 0,
    canAllocate: () => false,
    allocate: () => false,
    refundBranch: () => {},
  };
  private passiveApi: PassiveAPIDeps = {
    getLevel: () => 0,
    getXp: () => 0,
    highestWave: 0,
    isUnlocked: () => false,
    isMaxed: () => false,
    canUnlock: () => false,
    getUnlockCost: () => 0,
    onUnlock: () => {},
    getUpgradeCost: () => 0,
    canUpgrade: () => false,
    onUpgrade: () => {},
  };
  private equipmentApi: EquipmentAPIDeps = {
    inventory: [],
    equipped: {},
    equip: () => false,
    unequip: () => false,
    getSellValue: () => 0,
    onSell: () => {},
  };
  private audioApi: AudioAPI = (() => {
    let volume = 0.6;
    let muted = false;
    try {
      const raw = localStorage.getItem('the-tower-audio');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed.volume === 'number') volume = Math.max(0, Math.min(1, parsed.volume));
        if (parsed.muted) muted = true;
      }
    } catch {}
    return { volume, muted, setVolume: () => {}, toggleMute: () => {} };
  })();
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
    getXp: () => 0,
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
    ascendUnlockWave: 30,
    transcendUnlockAP: 100,
    targetAscendWave: 30,
  };
  private researchApi: ResearchAPI = {
    rp: 0,
    levels: {},
    unlocked: new Set<string>(),
    reasonBlocked: () => 'Loading...',
    inProgress: null,
    researchSpeedMultiplier: 1,
    rpGainRate: 0,
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
    panelRoot?: HTMLElement;
    abilityBarRoot?: HTMLElement;
    bottomNavRoot?: HTMLElement;
    mobileSheetRoot?: HTMLElement;
  }) {
    this.bus = deps.bus;
    this.tabsRoot = deps.tabsRoot;
    this.contentRoot = deps.contentRoot;
    this.panelRoot = deps.panelRoot ?? (document.getElementById('panel-root') as HTMLElement);
    this.abilityBarRoot = deps.abilityBarRoot ?? (document.getElementById('ability-bar-root') as HTMLElement);
    this.bottomNavRoot = deps.bottomNavRoot ?? (document.getElementById('bottom-nav-root') as HTMLElement);
    this.mobileSheetRoot = deps.mobileSheetRoot ?? (document.getElementById('mobile-sheet-root') as HTMLElement);
    this.panelToggle = this.panelRoot?.querySelector<HTMLButtonElement>('#panel-toggle') ?? null;
    this.panelResizer = this.panelRoot?.querySelector<HTMLElement>('#panel-resizer') ?? null;

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
      getXp: (id) => this.abilityApi.getXp(id),
    }, this.passiveApi);
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
      levels: {},
      unlocked: new Set<string>(),
      reasonBlocked: (id) => this.researchApi.reasonBlocked(id),
      inProgress: null,
      researchSpeedMultiplier: 1,
    };
    Object.defineProperty(researchHandlers, 'inProgress', { get: () => this.researchApi.inProgress, enumerable: true });
    Object.defineProperty(researchHandlers, 'researchSpeedMultiplier', { get: () => this.researchApi.researchSpeedMultiplier, enumerable: true });
    Object.defineProperty(researchHandlers, 'rp', { get: () => this.researchApi.rp, enumerable: true });
    Object.defineProperty(researchHandlers, 'levels', { get: () => this.researchApi.levels, enumerable: true });
    Object.defineProperty(researchHandlers, 'unlocked', { get: () => this.researchApi.unlocked, enumerable: true });
    Object.defineProperty(researchHandlers, 'rpGainRate', { get: () => this.researchApi.rpGainRate, enumerable: true });
    this.researchPanel = new ResearchPanel(researchHandlers);
    this.talentPanel = new TalentPanel(this.talentApi);
    this.equipmentPanel = new EquipmentPanel(this.equipmentApi);
    this.settingsPanel = new SettingsPanel({
      onClearSave: () => this.onClearSave(),
      onVolumeChange: (v) => this.onVolumeChange(v),
      onMuteToggle: () => this.onMuteToggle(),
      onTargetingModeChange: (m) => this.onTargetingModeChange(m),
      initialVolume: this.audioApi.volume,
      isMuted: this.audioApi.muted,
      currentTargetingMode: this.targetingApi.currentMode,
    });
    this.achievementPanel = new AchievementPanel({
      getProgress: (def) => {
        if (def.stat === 'researchCount') return Object.keys(this.lastState?.research ?? {}).length;
        return (this.lastState?.stats as any)?.[def.stat] ?? 0;
      },
    });
    this.welcomeModal = new WelcomeBackModal(deps.modalRoot);
    this.runSummaryModal = new RunSummaryModal(deps.modalRoot);
    this.statsPanel = new StatsPanel({
      getHistory: () => this.lastState?.runHistory ?? [],
      getCurrentRun: () => {
        const s = this.lastState;
        if (!s) return null;
        return {
          startedAt: s.runStartedAt,
          highestWave: s.wave.highestWave,
          goldEarned: s.stats.goldEarned,
          enemiesKilled: s.stats.enemiesKilled,
          abilitiesCast: s.stats.abilitiesCast,
          lifetimeAP: s.resources.lifetimeAP,
          lifetimeGold: s.resources.lifetimeGold,
          lifetimeHighestWave: s.stats.lifetimeHighestWave,
          lifetimeAscensions: s.stats.lifetimeAscensions,
          transcendences: s.stats.transcendences,
        };
      },
    });
    this.milestoneStrip = new MilestoneStrip(this.hud.renderMilestoneStripSlot(), {
      getProgress: () => {
        const s = this.lastState;
        if (!s) return { currentWave: 1, apThisCycle: 0 };
        return { currentWave: s.wave.highestWave, apThisCycle: s.resources.apThisTranscendence };
      },
      getUpcoming: () => {
        const s = this.lastState;
        if (!s) return [];
        return upcomingMilestones(s.wave.highestWave, s.resources.apThisTranscendence, 3);
      },
    });
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
    this.bus.on('upgrades_changed', () => {
      if (!this.lastState) return;
      if (this.activeTab === 'abilities') {
        this.abilityPanel.update(this.lastState);
      }
      this.abilityBar?.update(this.lastState);
      if (this.activeTab === 'upgrades') {
        this.upgradePanel.update(this.lastState);
      }
    });
    this.bus.on('ability_cast', (payload: unknown) => {
      const p = payload as { id: AbilityId; def: { name: string } };
      this.abilityPanel.flashCast(p.id);
      this.abilityBar?.flashCast(p.id);
      this.bus.emit('toast', { kind: 'milestone', text: `${p.def.name} cast!`, life: 2.5 });
    });
    this.bus.on('ability_upgraded', (payload: unknown) => {
      const p = payload as { id: AbilityId; level: number };
      const def = ABILITIES.find(a => a.id === p.id);
      const name = def?.name ?? p.id;
      this.abilityPanel.flashUpgrade(p.id);
      this.abilityBar?.flashUpgrade(p.id);
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
    this.bus.on('run_ended', (payload: unknown) => {
      const p = payload as RunSummaryData;
      this.runSummaryModal.show(p, () => {});
    });
    this.bus.on('wave_started', (payload: unknown) => {
      const w = payload as number;
      const triggers = milestoneAtWave(w);
      if (triggers.length > 0) {
        this.milestoneStrip.flashLastEntry();
      }
    });
    this.bus.on('tower_damage_dealt', (payload: unknown) => {
      const p = payload as { amount: number };
      this.damageLog.push({ time: performance.now(), amount: p.amount });
    });

    // ── UI Overhaul v2: ability bar, panel collapse, mobile routing ──
    this.restorePanelWidth();
    this.restorePanelCollapsed();
    this.bindPanelToggle();
    this.bindPanelResizer();
    this.installAbilityBar();
    this.installMobileChrome();
  }

  private installAbilityBar(): void {
    if (!this.abilityBarRoot) return;
    this.abilityBar = new AbilityBar(this.abilityBarRoot, {
      canCast: (id, wave) => this.abilityApi.canCast(id, wave),
      reasonBlocked: (id, wave) => this.abilityApi.reasonBlocked(id, wave),
      onCast: (id) => this.onCastAbility(id),
      onUpgrade: (id) => this.onUpgradeAbility(id),
      canUpgrade: (id, wave) => this.abilityApi.canUpgrade(id, wave),
      isMaxed: (id) => this.abilityApi.isMaxed(id),
      getUpgradeCost: (id) => this.abilityApi.getUpgradeCost(id),
      getEffectiveStats: (id) => this.abilityApi.getEffectiveStats(id),
    });
  }

  private installMobileChrome(): void {
    if (!this.bottomNavRoot || !this.mobileSheetRoot) return;
    this.mobileSheet = new MobileSheet(this.mobileSheetRoot);
    const navItems: BottomNavItem[] = [
      { id: 'upgrades', label: 'Upgrades', icon: '\u25B2' },
      { id: 'research', label: 'Research', icon: '\u2697' },
      { id: 'progress', label: 'Progress', icon: '\u2605' },
      { id: 'more', label: 'More', icon: '\u2026' },
    ];
    this.bottomNav = new BottomNav(this.bottomNavRoot, navItems);
    this.bottomNav.setOnSelect((id) => this.handleMobileNav(id));
    this.mobileBoundChange = (ev) => this.applyMobileMode(ev.matches);
    this.mobileMatchMedia = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    this.mobileMatchMedia.addEventListener('change', this.mobileBoundChange);
    this.applyMobileMode(this.mobileMatchMedia.matches);
  }

  private applyMobileMode(mobile: boolean): void {
    this.isMobile = mobile;
    if (!this.bottomNav || !this.mobileSheet) return;
    // Always populate tabs so they're ready when needed.
    const tabs: MobileSheetTab[] = [
      { id: 'upgrades', label: 'Upgrades', render: (b) => this.mountMobileTab('upgrades', b) },
      { id: 'research', label: 'Research', render: (b) => this.mountMobileTab('research', b) },
      { id: 'abilities', label: 'Abilities', render: (b) => this.mountMobileTab('abilities', b) },
      { id: 'talents', label: 'Talents', render: (b) => this.mountMobileTab('talents', b) },
      { id: 'equipment', label: 'Equipment', render: (b) => this.mountMobileTab('equipment', b) },
      { id: 'prestige', label: 'Prestige', render: (b) => this.mountMobileTab('prestige', b) },
      { id: 'transcendence', label: 'Transcendence', render: (b) => this.mountMobileTab('transcendence', b) },
      { id: 'achievements', label: 'Achievements', render: (b) => this.mountMobileTab('achievements', b) },
      { id: 'stats', label: 'Stats', render: (b) => this.mountMobileTab('stats', b) },
      { id: 'settings', label: 'Settings', render: (b) => this.mountMobileTab('settings', b) },
    ];
    this.mobileSheet.setTabs(tabs);
  }

  private mountMobileTab(tab: PanelTab, body: HTMLElement): void {
    // Mount the same panel that the desktop tab uses, but inside the sheet body.
    // The desktop contentRoot remains untouched so desktop still works. We do
    // NOT update this.activeTab — that's the desktop state and would clobber
    // the user's last desktop selection if they resized back.
    body.className = `${tab}-panel`;
    body.innerHTML = '';
    switch (tab) {
      case 'upgrades': this.upgradePanel.mount(body); break;
      case 'research': this.researchPanel.mount(body); break;
      case 'abilities': this.abilityPanel.mount(body); break;
      case 'talents': this.talentPanel.mount(body); break;
      case 'equipment': this.equipmentPanel.mount(body); break;
      case 'prestige': this.prestigePanel.mount(body); break;
      case 'transcendence': this.transcendencePanel.mount(body); break;
      case 'achievements': this.achievementPanel.mount(body); break;
      case 'stats': this.statsPanel.mount(body); break;
      case 'settings': this.settingsPanel.mount(body); break;
    }
    if (this.lastState) {
      switch (tab) {
        case 'upgrades': this.upgradePanel.update(this.lastState); break;
        case 'research': this.researchPanel.update(this.lastState); break;
        case 'abilities': this.abilityPanel.update(this.lastState); break;
        case 'talents': this.talentPanel.update(this.lastState); break;
        case 'equipment': this.equipmentPanel.update(this.lastState); break;
        case 'prestige': this.prestigePanel.update(this.lastState); break;
        case 'transcendence': this.transcendencePanel.update(this.lastState); break;
        case 'achievements': this.achievementPanel.update(this.lastState); break;
        case 'stats': this.statsPanel.update(); break;
      }
    }
  }

  private handleMobileNav(id: string): void {
    if (!this.mobileSheet) return;
    if (id === 'more') {
      this.mobileSheet.open('prestige');
    } else if (id === 'progress') {
      this.mobileSheet.open('stats');
    } else {
      this.mobileSheet.open(id);
    }
  }

  private bindPanelToggle(): void {
    if (!this.panelToggle || !this.panelRoot) return;
    this.panelToggle.addEventListener('click', () => {
      const collapsed = !hasClass(this.panelRoot, 'collapsed');
      toggleClass(this.panelRoot, 'collapsed', collapsed);
      try { localStorage.setItem(PANEL_COLLAPSED_KEY, collapsed ? '1' : '0'); } catch {}
    });
  }

  private bindPanelResizer(): void {
    if (!this.panelResizer || !this.panelRoot) return;
    this.panelResizer.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      const rect = this.panelRoot.getBoundingClientRect();
      this.resizeState = { startX: ev.clientX, startWidth: rect.width };
      document.body.classList.add('is-resizing');
      this.boundResizeMove = (e: PointerEvent) => this.onResizeMove(e);
      this.boundResizeUp = () => this.onResizeUp();
      window.addEventListener('pointermove', this.boundResizeMove);
      window.addEventListener('pointerup', this.boundResizeUp, { once: true });
    });
  }

  private onResizeMove(ev: PointerEvent): void {
    if (!this.resizeState) return;
    const dx = this.resizeState.startX - ev.clientX;
    const next = Math.max(PANEL_MIN, Math.min(window.innerWidth - CANVAS_MIN, this.resizeState.startWidth + dx));
    setStyle(this.panelRoot, 'width', `${next}px`);
  }

  private onResizeUp(): void {
    this.resizeState = null;
    document.body.classList.remove('is-resizing');
    if (this.boundResizeMove) window.removeEventListener('pointermove', this.boundResizeMove);
    if (this.boundResizeUp) window.removeEventListener('pointerup', this.boundResizeUp);
    try {
      const width = this.panelRoot.getBoundingClientRect().width;
      localStorage.setItem(PANEL_WIDTH_KEY, String(Math.round(width)));
    } catch {}
  }

  private restorePanelWidth(): void {
    try {
      const raw = localStorage.getItem(PANEL_WIDTH_KEY);
      if (!raw) return;
      const w = Math.max(PANEL_MIN, Math.min(window.innerWidth - CANVAS_MIN, parseInt(raw, 10) || 400));
      setStyle(this.panelRoot, 'width', `${w}px`);
    } catch {}
  }

  private restorePanelCollapsed(): void {
    try {
      const raw = localStorage.getItem(PANEL_COLLAPSED_KEY);
      if (raw === '1' && this.panelRoot) {
        toggleClass(this.panelRoot, 'collapsed', true);
      }
    } catch {}
  }

  setOnBuyUpgrade(handler: (id: string) => void): void {
    this.onBuyUpgrade = handler;
  }

  setUpgradeCostGetter(fn: (id: string) => number): void {
    this.upgradePanel.setCostGetter(fn);
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

  isMobileView(): boolean {
    return this.isMobile;
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

  setTalentAPI(api: TalentAPIDeps): void {
    this.talentApi = api;
    this.talentPanel.setDeps(api);
    if (this.lastState && this.activeTab === 'talents') {
      this.talentPanel.update(this.lastState);
    }
  }

  setPassiveAPI(api: PassiveAPIDeps): void {
    this.passiveApi = api;
    this.abilityPanel.setPassiveDeps(api);
    if (this.lastState && this.activeTab === 'abilities') {
      this.abilityPanel.update(this.lastState);
    }
  }

  setEquipmentAPI(api: EquipmentAPIDeps): void {
    this.equipmentApi = api;
    this.equipmentPanel.setDeps(api);
    if (this.lastState && this.activeTab === 'equipment') {
      this.equipmentPanel.update(this.lastState);
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
    this.milestoneStrip.update(dt);
  }

  update(state: GameState): void {
    this.lastState = state;
    if (this.abilityBar) this.abilityBar.update(state);

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

    this.hud.update(state);
    // Update talent points badge
    const badge = this.tabsRoot.querySelector<HTMLElement>('[data-tab-badge="talents"]');
    if (badge) {
      const pts = state.towerXp?.unspentTalentPoints ?? 0;
      if (pts > 0) {
        badge.textContent = String(pts);
        toggleClass(badge, 'is-visible', true);
      } else {
        toggleClass(badge, 'is-visible', false);
      }
    }
    if (this.activeTab === 'upgrades') {
      this.upgradePanel.update(state);
    } else if (this.activeTab === 'abilities') {
      this.abilityPanel.update(state);
    } else if (this.activeTab === 'talents') {
      this.talentPanel.update(state);
    } else if (this.activeTab === 'equipment') {
      this.equipmentPanel.update(state);
    } else if (this.activeTab === 'prestige') {
      this.prestigePanel.update(state);
    } else if (this.activeTab === 'transcendence') {
      this.transcendencePanel.update(state);
    } else if (this.activeTab === 'research') {
      this.researchPanel.update(state);
    } else if (this.activeTab === 'achievements') {
      this.achievementPanel.update(state);
    } else if (this.activeTab === 'stats') {
      this.statsPanel.update();
    } else if (this.activeTab === 'settings') {
      this.settingsPanel.update();
    }
    this.pushFrameStats(state);
    this.pushEnemyStats(state);
    this.milestoneStrip.refresh();
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
      rpGainRate: this.researchApi.rpGainRate,
    });
  }

  private renderTabs(): void {
    this.tabsRoot.innerHTML = '';
    for (const t of TABS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tab-btn';
      btn.textContent = t.label;
      btn.dataset.tab = t.id;
      if (t.id === 'talents') {
        const badge = document.createElement('span');
        badge.className = 'tab-badge';
        badge.dataset.tabBadge = 'talents';
        btn.appendChild(badge);
      }
      btn.addEventListener('click', () => {
        if (hasClass(btn, 'tab-locked')) return;
        this.showTab(t.id);
      });
      this.tabsRoot.appendChild(btn);
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
    } else if (id === 'talents') {
      this.talentPanel.mount(this.contentRoot);
      if (this.lastState) this.talentPanel.update(this.lastState);
    } else if (id === 'equipment') {
      this.equipmentPanel.mount(this.contentRoot);
      if (this.lastState) this.equipmentPanel.update(this.lastState);
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
    } else if (id === 'stats') {
      this.statsPanel.mount(this.contentRoot);
      this.statsPanel.update();
    } else if (id === 'settings') {
      this.settingsPanel.mount(this.contentRoot);
    }
  }

  private activateTabButtons(id: PanelTab): void {
    for (const el of Array.from(this.tabsRoot.querySelectorAll<HTMLButtonElement>('.tab-btn'))) {
      toggleClass(el, 'active', el.dataset.tab === id);
    }
  }

  notify(kind: 'info' | 'warning' | 'milestone', text: string): void {
    this.bus.emit('toast', { kind, text });
  }
}
