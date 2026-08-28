import type { AbilityId, EnemyType, EnemyWatchLine, EnemyWaveStatsEntry, GameState, GoldSourceEntry, PanelTab, StatsInfo, AutoBuyStrategy, TargetingMode } from '../types';

export type { EnemyWatchLine };
import type { StatKey } from '../stats/keys';
import { ENEMY_DEFS, bossGoldForWave, bossMaxHpForWave, spawnPoolForWave } from '../data/enemies';
import {
  enemyHPForWave,
  enemySpeedForWave,
  enemyDamageForWave,
  goldDropForWave,
  isBossWave,
} from '../data/formulas';
import { HUD } from './HUD';
import { Modal } from './Modal';
import { EnemyCodexModal } from './EnemyCodexModal';
import { UpgradePanel, type BuyAmount, type UpgradePlan } from './UpgradePanel';
import { UPGRADES } from '../data/upgrades';
import { AbilityPanel } from './AbilityPanel';
import { PassivePanel, type PassiveAPIDeps } from './PassivePanel';
import { PrestigePanel, type CorePanelState } from './PrestigePanel';
import { DEFAULT_CORE, type CoreId } from '../data/cores';
import { TranscendencePanel } from './TranscendencePanel';
import { ResearchPanel, type ResearchPanelHandlers } from './ResearchPanel';
import { SettingsPanel } from './SettingsPanel';
import { AchievementPanel } from './AchievementPanel';
import { WelcomeBackModal, type WelcomeBackData } from './WelcomeBackModal';
import { RunSummaryModal, type RunSummaryData } from './RunSummaryModal';
import { RunFailedModal, type RunFailedData } from './RunFailedModal';
import { RunStalledBanner, type RunStalledData } from './RunStalledBanner';
import { PlacementPrompt } from './PlacementPrompt';
import { BossBar, type BossBarData } from './BossBar';
import { PacingOverlay, type PacingHudData } from './PacingOverlay';
import { KeybindsOverlay } from './KeybindsOverlay';
import { StatsPanel } from './StatsPanel';
import { StatsPopup } from './StatsPopup';
import { ProgressionPanel, type ProgressionBlessingInfo, type ProgressionContractInfo } from './ProgressionPanel';
import { JournalPanel } from './JournalPanel';
import type { IconId } from '../data/icons';
import { ContractTracker, type ContractRowData } from './ContractTracker';
import { MilestoneStrip } from './MilestoneStrip';
import { JournalStrip } from './JournalStrip';
import { ChapterModal, type ChapterCompletedPayload } from './ChapterModal';
import { AbilityBar } from './AbilityBar';
import { MobileSheet, type MobileSheetTab } from './MobileSheet';
import { BottomNav, type BottomNavItem } from './BottomNav';
import { upcomingMilestones, milestoneAtWave } from '../data/milestones';
import { EventBus } from '../game/EventBus';
import { TalentPanel, type TalentAPIDeps } from './TalentPanel';
import { EquipmentPanel, type EquipmentAPIDeps } from './EquipmentPanel';
import type { AutomationKey } from '../data/prestige';
import type { EffectiveAbilityStats } from '../data/abilities';
import { ABILITIES } from '../data/abilities';
import {
  NAV_GROUPS,
  GROUP_OF,
  groupById,
  firstTabOf,
  isPanelTab,
  type NavGroupId,
} from './navGroups';
import { icon as renderIconEl } from './Icon';
import { hasClass, toggleClass, setStyle } from '../utils/dom';
import { formatNumber } from '../utils/bigNumber';

const PANEL_WIDTH_KEY = 'the-tower-panel-width';
const PANEL_COLLAPSED_KEY = 'the-tower-panel-collapsed';
const NAV_TAB_KEY = 'the-tower-nav-tab';
/** §8.A: the rail costs ~52 px, so the old 280 no longer leaves a usable column. */
const PANEL_MIN = 352;
const CANVAS_MIN = 420;
const MOBILE_BREAKPOINT = 768;

/** §DPS HUD: hold the smoothed reading for this long after a wave resumes, so
 * it eases into the new wave instead of collapsing toward the empty damage
 * window. Re-armed on every intermission frame. */
const DPS_RESUME_EASE = 3;
/** How long after the freeze the 10 s damage window takes to refill; while it
 * is refilling the reading only tracks *up*, because an early window
 * under-reports the true rate. */
const DPS_REFILL_WINDOW = 10;
/** HUD push cadence: fast while the reading is moving so the pill's tween has
 * a fresh target, slow once it settles. */
const DPS_PUSH_FAST_MS = 250;
const DPS_PUSH_SLOW_MS = 3000;

export interface AbilityAPI {
  canCast: (id: AbilityId, wave: number) => boolean;
  reasonBlocked: (id: AbilityId, wave: number) => string | null;
  canUpgrade: (id: AbilityId, wave: number) => boolean;
  isMaxed: (id: AbilityId) => boolean;
  getUpgradeCost: (id: AbilityId) => number;
  getEffectiveStats: (id: AbilityId) => EffectiveAbilityStats;
  getXp: (id: AbilityId) => number;
  /** Plan §3.1: per-ability auto-cast opt-out. */
  isAutoCastUnlocked: () => boolean;
  isAutoCastEnabled: (id: AbilityId) => boolean;
  onToggleAutoCast: (id: AbilityId, enabled: boolean) => void;
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
  perkBlockedReason: (perkId: string) => string | null;
  /** Plan §6.2: cores are an AP spend with their own (non-perk) UI. */
  coreState: CorePanelState;
  ascendUnlockWave: number;
  transcendUnlockAP: number;
  targetAscendWave: number;
  /** Plan §3.6: auto-buy tuning. */
  autoBuyStrategy: AutoBuyStrategy;
  autoBuyReserve: number;
  setAutoBuyStrategy: (strategy: AutoBuyStrategy) => void;
  setAutoBuyReserve: (fraction: number) => void;
}

export interface TargetingAPI {
  currentMode: string;
  setMode: (mode: string) => void;
}

/**
 * The Long Watch view model (plan §6.2). Built by `Game.watchInfo()` once per
 * ~10 Hz UI tick and consumed by `JournalPanel`.
 *
 * The view stays free of `WatchManager` — `UIManager` is a UI module and would
 * otherwise reach into a system manager to read counters. `Game` does that
 * work, hands the panel a plain shape, and the panel renders it.
 */
export interface WatchChapterView {
  id: string;
  number: number;
  name: string;
  flavour: string;
  icon: IconId;
  /** Accent colour. Sourced from `WATCH_CHAPTERS`; arrives as data, not a literal. */
  color: string;
  state: 'done' | 'active' | 'locked';
  goals: ReadonlyArray<{
    label: string;
    /** Already-formatted `1,240 / 1,500`. */
    progress: string;
    fill: number;
    met: boolean;
  }>;
  reward: { id: string; name: string; description: string; icon: IconId };
}

export interface WatchInfo {
  chapters: readonly WatchChapterView[];
  completed: number;
  total: number;
  /** Index into `chapters` of the live one, or -1 when all are done. */
  activeIndex: number;
}

/**
 * Read-only handle into `EnemyManager`, plumbed through `Game.syncUiApis` so
 * the UI never reaches into a system manager directly (cross-cutting rule 3:
 * UI talks to game systems through hand-rolled APIs).
 *
 * Plan D.4: the bestiary needs the live HP / speed / damage multipliers the
 * spawning enemy was actually built with. Enrage is deliberately excluded —
 * it is a mid-encounter timer, not a spawn-time multiplier.
 */
export interface EnemyAPI {
  getWaveMultipliers: () => { hp: number; speed: number; damage: number };
}

/**
 * Read-only handle for the codex mastery track (plan §7). Built by
 * `Game.watchEnemyLines()` — every chapter that has a `kills_of` goal for the
 * given type appears under that type. Types nobody names are simply absent
 * from the record; the lookup `lines[type] ?? []` handles the missing case
 * the same way the codex detail pane needs.
 */
export interface EnemyWatchAPI {
  getWatchLines: () => Readonly<Partial<Record<EnemyType, readonly EnemyWatchLine[]>>>;
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
  /** `contentRoot`'s own class, re-applied after a panel overwrites it. */
  private readonly contentRootBaseClass: string;
  private readonly hud: HUD;
  private readonly upgradePanel: UpgradePanel;
  private readonly abilityPanel: AbilityPanel;
  private readonly passivePanel: PassivePanel;
  private readonly prestigePanel: PrestigePanel;
  private readonly transcendencePanel: TranscendencePanel;
  private readonly researchPanel: ResearchPanel;
  private readonly settingsPanel: SettingsPanel;
  private readonly achievementPanel: AchievementPanel;
  private readonly welcomeModal: WelcomeBackModal;
  private readonly runSummaryModal: RunSummaryModal;
  private readonly runFailedModal: RunFailedModal;
  private readonly runStalledBanner: RunStalledBanner;
  private readonly bossBar: BossBar;
  /** Combo meter + next-wave threat readout (plan §7.2/§7.3). */
  private readonly pacingOverlay: PacingOverlay;
  /** Plan §4.3: the "click to place it" strip. */
  private readonly placementPrompt: PlacementPrompt;
  /**
   * The boss readout for the current frame, pushed by `Game.frameUpdate`
   * (gameplay plan §3.5). Null while no boss is alive.
   */
  private bossBarData: BossBarData | null = null;
  /**
   * Tower Stats dialog (plans/stats.md Part C). Adopts the shared Modal shell
   * so Space-key "call wave early" is gated via `Modal.anyOpen()`.
   */
  private readonly statsPopup = new StatsPopup();
  private pacingData: PacingHudData | null = null;
  private readonly keybindsOverlay: KeybindsOverlay;
  private readonly statsPanel: StatsPanel;
  private readonly progressionPanel: ProgressionPanel;
  /**
   * The Long Watch (plan §6). Mirrors `progressionPanel`'s shape — a UI
   * surface that reads a plain `WatchInfo` snapshot pushed by `Game` instead
   * of reaching into `WatchManager` directly.
   */
  private readonly journalPanel: JournalPanel;
  private readonly milestoneStrip: MilestoneStrip;
  /**
   * The bottom-left Long Watch chip (plan §6.5). Hidden when every chapter
   * is done; on mobile the whole slot is hidden in CSS because three stacked
   * chips eat the play area.
   */
  private readonly journalStrip: JournalStrip;
  /**
   * Chapter-complete modal (plan §6.4). Reuses the shared `Modal` shell, so it
   * participates in `Modal.anyOpen()` and `isModalOpen()` automatically.
   */
  private readonly chapterModal: ChapterModal;
  /**
   * Pending completion modals (plan §6.4). `UIManager` listens on
   * `watch_chapter_completed`; if a modal is already open (a blessing draft,
   * a run summary, a previous chapter) the next one waits here until the
   * shell signals `anyOpen()` is false.
   */
  private readonly chapterModalQueue: ChapterCompletedPayload[] = [];
  private readonly contractTracker: ContractTracker;
  private readonly talentPanel: TalentPanel;
  private readonly equipmentPanel: EquipmentPanel;
  /**
   * The enemy bestiary dialog (plans/stats.md Part D). Owns the `Modal` shell
   * so it participates in `Modal.anyOpen()` — that is what stops the Space
   * key from calling a wave while the popup is up.
   */
  private readonly enemyCodexModal: EnemyCodexModal;
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
  /** §8.A: the rail's selection, always `GROUP_OF[activeTab]`. */
  private activeGroup: NavGroupId = GROUP_OF['upgrades'];
  /** Where each group was left, so re-entering it does not reset to tab one. */
  private readonly lastTabPerGroup = new Map<NavGroupId, PanelTab>(
    NAV_GROUPS.map(g => [g.id, g.tabs[0].id] as const),
  );
  /** The horizontal strip of the active group's tabs, above the content. */
  private readonly subStrip: HTMLElement;
  /** Per-tab badge counts, summed onto the rail button of the owning group. */
  private readonly tabBadges = new Map<PanelTab, number>();
  /**
   * Passives that became buyable this run and have not been viewed yet. The
   * set's size is the badge count on the Abilities tab (and, summed, the
   * Build rail button); opening the Passives panel empties it.
   */
  private readonly pendingPassiveBadges = new Set<string>();
  /** The last badge count pushed to the AbilityPanel sub-tab, for remounts. */
  private passiveBadgeCount = 0;
  /**
   * Count of unseen (not-yet-viewed, unequipped) inventory items, pushed to
   * the Equipment tab badge (and, summed, the Build rail button). Recomputed
   * from `item.seen` flags every UI frame — the inventory is the single
   * source of truth, so drops, equips, views and sells all reconcile here.
   */
  private equipmentBadgeCount = 0;
  private damageLog: { time: number; amount: number }[] = [];
  private realTimeDps = 0;
  private smoothedDps = 0;
  private lastDpsUpdateTime = 0;
  private lastDpsDisplayTime = 0;
  private dpsFreezeTimer = 0;
  private dpsRefillTimer = 0;
  /** The last value pushed to the HUD, so push cadence can track drift. */
  private lastPushedDps = 0;
  private onBuyUpgrade: (id: string, amount: BuyAmount) => void = () => {};
  private onCastAbility: (id: AbilityId) => void = () => {};
  private onUpgradeAbility: (id: AbilityId) => void = () => {};
  private onAscend: () => void = () => {};
  private onResolveRunFailure: (action: 'ascend' | 'retry') => void = () => {};
  private onTranscend: () => void = () => {};
  private onSpendAP: (perkId: string) => void = () => {};
  private onUnlockCore: (id: CoreId) => void = () => {};
  private onUnlockResearch: (id: string) => void = () => {};
  private onCancelResearch: () => void = () => {};
  private onToggleAutomation: (key: AutomationKey, enabled: boolean) => void = () => {};
  private onTargetWaveChange: (wave: number) => void = () => {};
  private onSpeedChange: (index: number) => void = () => {};
  private onRestartWave: () => void = () => {};
  private onToggleAutoProgress: () => void = () => {};
  private onCallWaveEarly: () => void = () => {};
  private onRiskChange: (level: number) => void = () => {};
  private onClearSave: () => void = () => {};
  private onVolumeChange: (v: number) => void = () => {};
  private onMuteToggle: () => void = () => {};
  private onTargetingModeChange: (mode: string) => void = () => {};
  private onAutoPickBlessingsChange: (enabled: boolean) => void = () => {};
  private onInstantCastChange: (enabled: boolean) => void = () => {};
  private onQualityChange: (
    pref: 'auto' | 'high' | 'medium' | 'low',
  ) => void = () => {};
  private talentApi: TalentAPIDeps = {
    allocated: {},
    unspentPoints: () => 0,
    level: () => 1,
    xpProgress: () => 0,
    atLevelCap: () => false,
    canAllocate: () => false,
    blockedReason: () => null,
    allocate: () => false,
    pointsInBranch: () => 0,
    refundBranch: () => false,
    refundAll: () => false,
    branchRespecCost: () => 0,
    fullRespecCost: () => 0,
    gold: () => 0,
  };
  private passiveApi: PassiveAPIDeps = {
    getLevel: () => 0,
    getXp: () => 0,
    getXpForNextLevel: () => 0,
    highestWave: () => 0,
    unlockedCount: () => 0,
    totalLevels: () => 0,
    isUnlocked: () => false,
    isMaxed: () => false,
    canUnlock: () => false,
    getUnlockCost: () => 0,
    onUnlock: () => {},
    getFullUpgradeCost: () => 0,
    getUpgradeCost: () => 0,
    getXpDiscount: () => 0,
    canUpgrade: () => false,
    onUpgrade: () => {},
  };
  private equipmentApi: EquipmentAPIDeps = {
    inventory: [],
    equipped: {},
    equip: () => false,
    unequip: () => false,
    getSellValue: () => 0,
    onItemViewed: () => {},
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
    currentMode: 'priority',
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
    isAutoCastUnlocked: () => false,
    isAutoCastEnabled: () => true,
    onToggleAutoCast: () => {},
  };
  private prestigeApi: PrestigeAPI = {
    coreState: { selected: DEFAULT_CORE, unlocked: [DEFAULT_CORE], pickerAvailable: false },
    canAscend: () => false,
    canTranscend: () => false,
    previewAP: () => 0,
    previewTP: () => 0,
    canSpend: () => false,
    isAutomationUnlocked: () => false,
    isAutomationEnabled: () => false,
    meetsPrerequisites: () => true,
    isExcluded: () => false,
    perkBlockedReason: () => null,
    ascendUnlockWave: 30,
    transcendUnlockAP: 100,
    targetAscendWave: 30,
    autoBuyStrategy: 'balanced',
    autoBuyReserve: 0,
    setAutoBuyStrategy: () => {},
    setAutoBuyReserve: () => {},
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
  /** Read-only handle into `EnemyManager` (plans/stats.md Part D). */
  private enemyApi: EnemyAPI = {
    getWaveMultipliers: () => ({ hp: 1, speed: 1, damage: 1 }),
  };
  /**
   * Read-only handle into `Game.watchEnemyLines()` (plan §7). Empty default so
   * the codex renders no Watch section before `Game` has wired the API in.
   */
  private enemyWatchApi: EnemyWatchAPI = {
    getWatchLines: () => ({}),
  };
  private blessingApi: () => ProgressionBlessingInfo = () => ({
    held: [],
    picksTaken: 0,
    rerolls: 0,
    nextDraftWave: null,
  });
  /** The run's contracts (plan §5.3). Empty until `Game` wires its API in. */
  private contractApi: () => ProgressionContractInfo = () => ({
    live: [],
    history: [],
    completed: 0,
    apBonusPct: 0,
    apCapPct: 0,
  });
  /**
   * The Long Watch view (plan §6.2). Empty until `Game` wires its API in.
   * `JournalPanel` reads it once per UI tick through this closure.
   */
  private watchInfo: () => WatchInfo = () => ({
    chapters: [],
    completed: 0,
    total: 0,
    activeIndex: -1,
  });
  private lastState: GameState | null = null;
  private cachedGoldMultiplier = 1;
  private cachedGoldSources: GoldSourceEntry[] = [];
  private cachedResolved: Readonly<Record<StatKey, number>> | null = null;
  private cachedTargetingMode: TargetingMode = 'priority';
  private uiFrameCounter = 0;
  private lastEnemyStatsSig = '';
  private readonly UI_UPDATE_INTERVAL = 6;

  constructor(deps: {
    hudRoot: HTMLElement;
    tabsRoot: HTMLElement;
    contentRoot: HTMLElement;
    bus: EventBus;
    modalRoot: HTMLElement;
    overlayRoot?: HTMLElement;
    panelRoot?: HTMLElement;
    abilityBarRoot?: HTMLElement;
    bottomNavRoot?: HTMLElement;
    mobileSheetRoot?: HTMLElement;
  }) {
    this.bus = deps.bus;
    this.tabsRoot = deps.tabsRoot;
    this.contentRoot = deps.contentRoot;
    this.contentRootBaseClass = deps.contentRoot.className;
    // §8.A: the sub-strip is a sibling of the content, not part of the rail, so
    // it can sit inside the content column of the panel grid.
    this.subStrip = document.createElement('div');
    this.subStrip.className = 'panel-substrip';
    this.subStrip.setAttribute('role', 'tablist');
    this.contentRoot.parentElement?.insertBefore(this.subStrip, this.contentRoot);
    this.panelRoot = deps.panelRoot ?? (document.getElementById('panel-root') as HTMLElement);
    this.abilityBarRoot = deps.abilityBarRoot ?? (document.getElementById('ability-bar-root') as HTMLElement);
    this.bottomNavRoot = deps.bottomNavRoot ?? (document.getElementById('bottom-nav-root') as HTMLElement);
    this.mobileSheetRoot = deps.mobileSheetRoot ?? (document.getElementById('mobile-sheet-root') as HTMLElement);
    this.panelToggle = this.panelRoot?.querySelector<HTMLButtonElement>('#panel-toggle') ?? null;
    this.panelResizer = this.panelRoot?.querySelector<HTMLElement>('#panel-resizer') ?? null;

    this.hud = new HUD(deps.hudRoot);
    this.hud.setOnSpeedChange((index) => this.onSpeedChange(index));
    this.hud.setOnRestartWave(() => this.onRestartWave());
    this.hud.setOnToggleAutoProgress(() => this.onToggleAutoProgress());
    this.hud.setOnCallWaveEarly(() => this.onCallWaveEarly());
    this.hud.setOnRiskChange((level) => this.onRiskChange(level));
    this.upgradePanel = new UpgradePanel((id, amount) => this.onBuyUpgrade(id, amount));
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
      isAutoCastUnlocked: () => this.abilityApi.isAutoCastUnlocked(),
      isAutoCastEnabled: (id) => this.abilityApi.isAutoCastEnabled(id),
      onToggleAutoCast: (id, enabled) => this.abilityApi.onToggleAutoCast(id, enabled),
    });
    this.passivePanel = new PassivePanel(this.passiveApi);
    this.prestigePanel = new PrestigePanel({
      onAscend: () => this.onAscend(),
      onSpend: (id) => this.onSpendAP(id),
      canAscend: (w) => this.prestigeApi.canAscend(w),
      canSpend: (id, ap, tp) => this.prestigeApi.canSpend(id, ap, tp),
      previewAP: (w) => this.prestigeApi.previewAP(w),
      perkBlockedReason: (id) => this.prestigeApi.perkBlockedReason(id),
      ascendUnlockWave: this.prestigeApi.ascendUnlockWave,
      coreState: () => this.prestigeApi.coreState,
      onUnlockCore: (id) => this.onUnlockCore(id),
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
      getAutoBuyStrategy: () => this.prestigeApi.autoBuyStrategy,
      onAutoBuyStrategyChange: (strategy) => this.prestigeApi.setAutoBuyStrategy(strategy),
      getAutoBuyReserve: () => this.prestigeApi.autoBuyReserve,
      onAutoBuyReserveChange: (fraction) => this.prestigeApi.setAutoBuyReserve(fraction),
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
    this.enemyCodexModal = new EnemyCodexModal({
      onOpenCodex: (id) => this.openCodex(id),
      // Plan §7.3: the codex mastery rows land on the Journal tab, the same
      // place the player reads about the chapter those rows belong to. The
      // mobile path mirrors the JournalStrip chip so a phone tap opens both
      // the desktop panel and the bottom-nav sheet.
      onOpenJournal: () => {
        this.setActiveTab('journal');
        if (this.isMobile) this.handleMobileNav('progress');
      },
    });
    this.hud.setOnOpenEnemies(() => this.enemyCodexModal.toggle());
    this.hud.setOnOpenStats(() => this.statsPopup.toggle());
    this.settingsPanel = new SettingsPanel({
      onClearSave: () => this.onClearSave(),
      onVolumeChange: (v) => this.onVolumeChange(v),
      onMuteToggle: () => this.onMuteToggle(),
      onTargetingModeChange: (m) => {
        this.onTargetingModeChange(m);
        this.hud.syncTargetingMode(m);
      },
      initialVolume: this.audioApi.volume,
      isMuted: this.audioApi.muted,
      currentTargetingMode: this.targetingApi.currentMode,
      autoPickBlessings: false,
      autoPickBlessingsForced: false,
      onAutoPickBlessingsChange: (enabled) => this.onAutoPickBlessingsChange(enabled),
      onInstantCastChange: (enabled) => this.onInstantCastChange(enabled),
      currentQuality: 'auto',
      onQualityChange: (pref) => this.onQualityChange(pref),
    });
    this.achievementPanel = new AchievementPanel({
      getProgress: (def) => {
        if (def.stat === 'researchCount') return Object.keys(this.lastState?.research ?? {}).length;
        return (this.lastState?.stats as any)?.[def.stat] ?? 0;
      },
    });
    this.welcomeModal = new WelcomeBackModal(deps.modalRoot);
    this.runSummaryModal = new RunSummaryModal(deps.modalRoot);
    this.runFailedModal = new RunFailedModal(deps.modalRoot);
    this.runStalledBanner = new RunStalledBanner(
      deps.overlayRoot ?? (document.getElementById('overlay-root') as HTMLElement) ?? deps.modalRoot,
    );
    this.runStalledBanner.setOnAscend(() => this.onAscend());
    this.placementPrompt = new PlacementPrompt(
      deps.overlayRoot ?? (document.getElementById('overlay-root') as HTMLElement) ?? deps.modalRoot,
    );
    this.bossBar = new BossBar(
      deps.overlayRoot ?? (document.getElementById('overlay-root') as HTMLElement) ?? deps.modalRoot,
    );
    this.pacingOverlay = new PacingOverlay(
      deps.overlayRoot ?? (document.getElementById('overlay-root') as HTMLElement) ?? deps.modalRoot,
    );
    this.keybindsOverlay = new KeybindsOverlay(deps.modalRoot);
    this.hud.setOnShowKeybinds(() => this.keybindsOverlay.toggle());
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
    this.progressionPanel = new ProgressionPanel({
      apThisCycle: () => this.lastState?.resources.apThisTranscendence ?? 0,
      blessings: () => this.blessingApi(),
      contracts: () => this.contractApi(),
    });
    this.journalPanel = new JournalPanel({
      // Plan §6.3: the click handler on an objective row will land here in
      // Step 9 when the Codex wiring is in place. Stubbed now so this panel
      // never has to be re-edited for the route to exist.
      watch: () => this.watchInfo(),
      onOpenCodex: (entryId) => this.openCodex(entryId),
    });
    this.contractTracker = new ContractTracker(this.hud.renderContractTrackerSlot(), {
      getRows: (): ContractRowData[] => this.contractApi().live.map(c => ({
        uid: c.uid,
        name: c.name,
        label: c.label,
        progress: c.progress,
        fill: c.fill,
        reward: c.reward,
      })),
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
      onOpenProgression: () => this.setActiveTab('progression'),
    });
    this.journalStrip = new JournalStrip(this.hud.renderJournalStripSlot(), {
      getInfo: () => {
        const info = this.watchInfo();
        const active = info.activeIndex >= 0 ? info.chapters[info.activeIndex] : null;
        // The chip's "2 / 3" reads `WatchManager.activeProgress()`; that count
        // lives inside the manager, but the active chapter is the same thing
        // the journal card already exposes. Walking both keeps the chip off the
        // manager (UI never reaches in) — the manager's `activeProgress()`
        // count is mirrored by walking the chapter's goal `met` flags here.
        if (!active) return { active: null, met: 0, total: 0 };
        let met = 0;
        for (const g of active.goals) if (g.met) met++;
        return { active, met, total: active.goals.length };
      },
      onOpenJournal: () => {
        this.setActiveTab('journal');
        // On mobile the journal tab lives in the progress group, so the click
        // also has to open the bottom-nav sheet — otherwise a phone player
        // tapping the chip would see the desktop panel jump and the sheet
        // stay closed.
        if (this.isMobile) this.handleMobileNav('progress');
      },
    });
    this.chapterModal = new ChapterModal();
    this.renderRail();
    this.showTab(this.restoreNavTab());

    this.bus.on('upgrade_purchased', (payload: unknown) => {
      const p = payload as { id: string; level: number; levelsGained?: number };
      const def = UPGRADES.find(u => u.id === p.id);
      const name = def?.name ?? p.id;
      const gained = p.levelsGained ?? 1;
      const suffix = gained > 1 ? ` (+${gained})` : '';
      this.bus.emit('toast', { kind: 'info', text: `Upgraded: ${name} Lv.${p.level}${suffix}`, life: 2 });
      this.upgradePanel.flashButton(p.id, gained);
    });
    this.bus.on('upgrades_changed', () => {
      if (!this.lastState) return;
      if (this.activeTab === 'abilities') {
        this.abilityPanel.update(this.lastState);
      }
      if (this.activeTab === 'passives') {
        this.passivePanel.update(this.lastState);
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
    this.bus.on('passive_leveled', (payload: unknown) => {
      const p = payload as {
        id: string; name: string; level: number; maxed: boolean;
        milestone: { at: number; label: string } | null;
      };
      this.passivePanel.flashLevelUp(p.id);
      if (p.milestone) {
        this.bus.emit('toast', {
          kind: 'milestone',
          text: `${p.name} Lv.${p.level} — ${p.milestone.label}`,
          life: 4,
        });
      } else if (p.maxed) {
        this.bus.emit('toast', {
          kind: 'milestone',
          text: `${p.name} mastered! Lv.${p.level}`,
          life: 5,
        });
      } else {
        this.bus.emit('toast', { kind: 'info', text: `${p.name} → Lv.${p.level}`, life: 2 });
      }
    });
    this.bus.on('welcome_back', (payload: unknown) => {
      const data = payload as WelcomeBackData;
      if (data.result.elapsedSeconds > 0) {
        this.welcomeModal.show(data, () => {});
      }
    });
    this.bus.on('run_ended', (payload: unknown) => {
      const p = payload as RunSummaryData;
      // Plan §6.2: the debrief's CTA becomes the core picker. The chain runs
      // through the bus rather than a direct call because `Game` owns the
      // picker modal (it owns the blessing draft for the same reason), and a
      // UI manager reaching into the game to open one would be the only such
      // edge in the file.
      this.runSummaryModal.show(p, () => this.bus.emit('run_summary_dismissed', {}));
      // A new run starts with a clean slate for "new passive available"
      // notifications; stale badges must not survive into it.
      if (this.pendingPassiveBadges.size > 0) {
        this.pendingPassiveBadges.clear();
        this.pushPassiveBadge();
      }
      // Same for equipment: the inventory is wiped, so the badge is too.
      // (`pushEquipmentBadge` would catch up on the next frame, but that
      // leaves a stale count visible during the summary.)
      if (this.equipmentBadgeCount !== 0) {
        this.equipmentBadgeCount = 0;
        this.setTabBadge('equipment', 0);
      }
    });
    this.bus.on('talent_refunded', (payload: unknown) => {
      const p = payload as { branch: string | null; points: number; cost: number };
      const scope = p.branch ? `${p.branch} talents` : 'all talents';
      this.bus.emit('toast', {
        kind: 'info',
        text: `Reset ${scope}: ${p.points} point${p.points === 1 ? '' : 's'} refunded for ${formatNumber(p.cost)} gold.`,
        life: 3,
      });
    });
    this.bus.on('run_stalled', (payload: unknown) => {
      this.runStalledBanner.show(payload as RunStalledData);
    });
    this.bus.on('run_failed', (payload: unknown) => {
      // The run is over — the modal takes it from here.
      this.runStalledBanner.reset();
      const p = payload as RunFailedData;
      this.runFailedModal.show(
        p,
        () => this.onResolveRunFailure('ascend'),
        () => this.onResolveRunFailure('retry'),
      );
    });
    this.bus.on('wave_started', (payload: unknown) => {
      // A new wave means the old stall is moot, and the next one may prompt.
      this.runStalledBanner.reset();
      const w = payload as number;
      const triggers = milestoneAtWave(w);
      if (triggers.length > 0) {
        this.milestoneStrip.flashLastEntry();
      }
    });
    // Plan §6.4–§6.5: the manager emits when a chapter completes. `Game` already
    // reacts (unlock, toast, shockwave); the UI layer reacts here for the
    // completion modal and the chip's green-ring pulse. The modal queue waits
    // when another modal is up so the modal does not stack over a blessing
    // draft or a run summary (Modal.anyOpen()).
    this.bus.on('watch_chapter_completed', (payload: unknown) => {
      const p = payload as ChapterCompletedPayload;
      this.enqueueChapterModal(p);
      this.journalStrip.flashLastEntry();
    });
    // Contracts (plan §5.3). The flourish is driven from the event rather than
    // inferred from a row disappearing, because an ascension and a save load
    // also empty the tracker and neither deserves a celebration.
    //
    // It listens on `contract_reward`, not `contract_completed`: the latter is
    // what `ContractManager` emits *before* anything has been paid, and this
    // manager's subscription is registered first, so the reward text would
    // always be a frame behind. `Game` emits `contract_reward` once the payout
    // is resolved, still inside the same completion.
    this.bus.on('contract_reward', (payload: unknown) => {
      const p = payload as { uid: number; rewardText?: string };
      this.contractTracker.flourish(p.uid, p.rewardText ?? '');
    });
    // The replacement is drawn after the payout, so this is what slides the
    // new row in under the one that is still flourishing.
    this.bus.on('contract_drawn', () => {
      this.contractTracker.refresh();
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
    this.mobileSheet = new MobileSheet(this.mobileSheetRoot, {
      // Badge counts live on `this.tabBadges`. The sheet recreates its
      // segmented buttons on every group switch, so we hand it a query
      // callback so it can re-apply the current counts to the freshly-built
      // badge spans instead of leaving them empty until the next live
      // `setBadge` update.
      badgeSource: (id) => this.tabBadges.get(id as PanelTab) ?? 0,
    });
    // \u00A78.A: the same five groups the desktop rail shows. The old ad-hoc four \u2014
    // with a `'more'` bucket that opened Prestige \u2014 was the second, unrelated
    // information architecture this table exists to delete.
    const navItems: BottomNavItem[] = NAV_GROUPS.map(g => ({
      id: g.id,
      label: g.label,
      icon: g.icon,
    }));
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
    // Resizing out of mobile leaves the sheet floating over the now-visible
    // desktop panel; close it so the player is not staring at a half-faded
    // dialog while the panel renders behind it. The mobile state is otherwise
    // intact — the next resize back to mobile lands the user on the same
    // group they last picked.
    if (!mobile) this.mobileSheet.close();
    // Seed the sheet with the group the panel is already on, so the very first
    // open is not an empty segmented strip.
    this.loadSheetGroup(this.activeGroup);
    this.bottomNav.setActive(this.activeGroup);
  }

  /** §8.A: the sheet only ever carries one group's tabs at a time. */
  private loadSheetGroup(g: NavGroupId): void {
    if (!this.mobileSheet) return;
    const tabs: MobileSheetTab[] = groupById(g).tabs.map(t => ({
      id: t.id,
      label: t.label,
      render: (b: HTMLElement) => this.mountMobileTab(t.id, b),
    }));
    this.mobileSheet.setTabs(tabs);
  }

  private mountMobileTab(tab: PanelTab, body: HTMLElement): void {
    // Mount the same panel that the desktop tab uses, but inside the sheet body.
    // The desktop contentRoot remains untouched so desktop still works. We do
    // NOT update this.activeTab — that's the desktop state and would clobber
    // the user's last desktop selection if they resized back.
    // The group's remembered tab *is* shared with desktop — landing on the tab
    // you last used is the point of remembering it, on either surface.
    this.lastTabPerGroup.set(GROUP_OF[tab], tab);
    const bodyBaseClass = body.className;
    // Panels that render no class of their own (achievements, stats) still
    // want a tab-specific hook; ones that do will overwrite this, and the
    // base class is restored either way once the mount is done.
    body.className = `${tab}-panel`;
    body.innerHTML = '';
    switch (tab) {
      case 'upgrades': this.upgradePanel.mount(body); break;
      case 'research': this.researchPanel.mount(body); break;
      case 'abilities': this.abilityPanel.mount(body); break;
      case 'passives': this.passivePanel.mount(body); break;
      case 'talents': this.talentPanel.mount(body); break;
      case 'equipment': this.equipmentPanel.mount(body); break;
      case 'prestige': this.prestigePanel.mount(body); break;
      case 'transcendence': this.transcendencePanel.mount(body); break;
      case 'achievements': this.achievementPanel.mount(body); break;
      case 'progression': this.progressionPanel.mount(body); break;
      case 'journal': this.journalPanel.mount(body); break;
      case 'stats': this.statsPanel.mount(body); break;
      case 'settings': this.settingsPanel.mount(body); break;
    }
    this.restoreContainerClass(body, bodyBaseClass);
    if (this.lastState) {
      switch (tab) {
        case 'upgrades': this.upgradePanel.update(this.lastState); break;
        case 'research': this.researchPanel.update(this.lastState); break;
        case 'abilities': this.abilityPanel.update(this.lastState); break;
        case 'passives': this.passivePanel.update(this.lastState); break;
        case 'talents': this.talentPanel.update(this.lastState); break;
        case 'equipment': this.equipmentPanel.update(this.lastState); break;
        case 'prestige': this.prestigePanel.update(this.lastState); break;
        case 'transcendence': this.transcendencePanel.update(this.lastState); break;
        case 'achievements': this.achievementPanel.update(this.lastState); break;
        case 'progression': this.progressionPanel.update(this.lastState); break;
        case 'journal': this.journalPanel.update(this.lastState); break;
        case 'stats': this.statsPanel.update(); break;
      }
    }
    if (tab === 'equipment') this.setTabBadge('equipment', this.equipmentBadgeCount);
    if (tab === 'passives') this.onPassivesViewed();
  }

  /**
   * A bottom-nav id is now a group id, so there are no special cases left: the
   * sheet is loaded with that group's tabs and opened on its remembered one.
   */
  private handleMobileNav(id: string): void {
    if (!this.mobileSheet) return;
    if (!NAV_GROUPS.some(g => g.id === id)) return;
    const g = id as NavGroupId;
    this.loadSheetGroup(g);
    this.mobileSheet.open(this.lastTabPerGroup.get(g) ?? firstTabOf(g));
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
      const w = Math.max(PANEL_MIN, Math.min(window.innerWidth - CANVAS_MIN, parseInt(raw, 10) || 420));
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

  /**
   * Queue a chapter-complete modal (plan §6.4).
   *
   * If any modal is currently up — a blessing draft, a run summary, an enemy
   * codex, a previous chapter — the payload is queued and shown as soon as the
   * shell signals `anyOpen()` is false. The queue is a flat array: chapters
   * complete in order, and the modal renders them in order.
   */
  private enqueueChapterModal(payload: ChapterCompletedPayload): void {
    if (Modal.anyOpen()) {
      this.chapterModalQueue.push(payload);
      return;
    }
    this.showChapterModal(payload);
  }

  /** Pop the next queued payload, if any, and show it. */
  private drainChapterModalQueue(): void {
    const next = this.chapterModalQueue.shift();
    if (!next) return;
    // `Modal.anyOpen()` is the gate — a fresh `drain` from the previous modal's
    // `onClose` runs while the previous card is still tearing down, so we
    // double-check before building the next one.
    if (Modal.anyOpen()) {
      this.chapterModalQueue.unshift(next);
      return;
    }
    this.showChapterModal(next);
  }

  /** Open the modal, wiring the shell's `onClose` to drain the queue. */
  private showChapterModal(payload: ChapterCompletedPayload): void {
    this.chapterModal.show(payload, () => {
      if (this.chapterModalQueue.length > 0) this.drainChapterModalQueue();
    });
  }

  setOnBuyUpgrade(handler: (id: string, amount: BuyAmount) => void): void {
    this.onBuyUpgrade = handler;
  }

  setUpgradePlanGetter(fn: (id: string, amount: BuyAmount) => UpgradePlan): void {
    this.upgradePanel.setPlanGetter(fn);
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

  setOnResolveRunFailure(handler: (action: 'ascend' | 'retry') => void): void {
    this.onResolveRunFailure = handler;
  }

  setOnTranscend(handler: () => void): void {
    this.onTranscend = handler;
  }

  setOnSpendAP(handler: (perkId: string) => void): void {
    this.onSpendAP = handler;
  }

  /** Plan §6.2: cores are bought with AP; switching happens at run start. */
  setOnUnlockCore(handler: (id: CoreId) => void): void {
    this.onUnlockCore = handler;
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

  setOnRestartWave(handler: () => void): void {
    this.onRestartWave = handler;
  }

  setOnToggleAutoProgress(handler: () => void): void {
    this.onToggleAutoProgress = handler;
  }

  /** Plan §7.1: the HUD's call-the-wave-early button. */
  setOnCallWaveEarly(handler: () => void): void {
    this.onCallWaveEarly = handler;
  }

  /** Plan §7.4: the risk stepper. */
  setOnRiskChange(handler: (level: number) => void): void {
    this.onRiskChange = handler;
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

  setOnAutoPickBlessingsChange(handler: (enabled: boolean) => void): void {
    this.onAutoPickBlessingsChange = handler;
  }

  /** Push the current auto-pick state into the settings panel (plan §1.1). */
  setAutoPickBlessingsState(enabled: boolean, forced: boolean): void {
    this.settingsPanel.setAutoPickBlessings(enabled, forced);
  }

  setOnInstantCastChange(handler: (enabled: boolean) => void): void {
    this.onInstantCastChange = handler;
  }

  /** Push the current instant-cast preference into the settings panel (§4.3). */
  setInstantCastState(enabled: boolean): void {
    this.settingsPanel.setInstantCast(enabled);
  }

  /** Plan §9.D: the four-position Graphics control. */
  setOnQualityChange(handler: (pref: 'auto' | 'high' | 'medium' | 'low') => void): void {
    this.onQualityChange = handler;
  }

  /**
   * Push the live quality state in (plan §9.D).
   *
   * `pref` is the player's saved preference; `currentTier` is the tier the
   * game is actually running — they are equal unless the preference is
   * `'auto'` and the probe has demoted, in which case the hint has to reflect
   * what the player is looking at.
   */
  setQualityState(pref: 'auto' | 'high' | 'medium' | 'low', currentTier: 'high' | 'medium' | 'low'): void {
    this.settingsPanel.setQuality(pref, currentTier);
  }

  /** Show or clear the ability-placement prompt (plan §4.3). */
  setPlacementPrompt(text: string | null): void {
    this.placementPrompt.set(text);
  }

  isMobileView(): boolean {
    return this.isMobile;
  }

  setAudioAPI(api: AudioAPI): void {
    this.audioApi = api;
  }

  setTargetingAPI(api: TargetingAPI): void {
    // Both surfaces share one API object, so changing the mode in Settings and
    // changing it in the HUD are the same action (plan §2.3).
    this.targetingApi = api;
    this.hud.setTargetingAPI(api);
  }

  setSpeedAPI(api: SpeedAPI): void {
    this.hud.setSpeedAPI(api);
  }

  setWaveControlAPI(api: WaveControlAPI): void {
    this.hud.setWaveControlAPI(api);
  }

  setEnemyAPI(api: EnemyAPI): void {
    this.enemyApi = api;
  }

  /**
   * Wire the codex mastery track (plan §7). The codex reads through this on
   * every push so the rendered rows track lifetime progress as it climbs.
   */
  setEnemyWatchAPI(api: EnemyWatchAPI): void {
    this.enemyWatchApi = api;
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
    this.cachedGoldSources = info.goldSources;
    this.cachedResolved = info.resolved;
    this.cachedTargetingMode = info.targetingMode;
    this.statsPopup.setInfo(info);
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
    this.passivePanel.setDeps(api);
    if (this.lastState && this.activeTab === 'passives') {
      this.passivePanel.update(this.lastState);
    }
  }

  /**
   * A passive's unlock wave was just cleared this run (its purchase opened
   * up). Called by `Game` on the wave-advance event; the badge persists until
   * the player opens the Passives panel.
   */
  notifyPassiveAvailable(id: string): void {
    if (this.pendingPassiveBadges.has(id)) return;
    this.pendingPassiveBadges.add(id);
    this.pushPassiveBadge();
  }

  /** Recompute and push the passive badge to all three surfaces. */
  private pushPassiveBadge(): void {
    this.passiveBadgeCount = this.pendingPassiveBadges.size;
    this.setTabBadge('passives', this.passiveBadgeCount);
  }

  /**
   * Recomputed from the live inventory (`item.seen === false` = new), pushed
   * as the Equipment tab badge and, summed, onto the Build rail button.
   */
  private pushEquipmentBadge(): void {
    let n = 0;
    for (const item of this.equipmentApi.inventory) {
      if (item.seen !== true) n++;
    }
    if (n === this.equipmentBadgeCount) return;
    this.equipmentBadgeCount = n;
    this.setTabBadge('equipment', n);
  }

  /** Opening the Passives panel marks every pending passive as seen. */
  private onPassivesViewed(): void {
    if (this.pendingPassiveBadges.size === 0) return;
    this.pendingPassiveBadges.clear();
    this.pushPassiveBadge();
  }

  /**
   * The run's blessings (plan §1.4). Pushed by `Game.syncUiApis`; the default
   * is an empty run so the panel renders before the game has wired itself up.
   */
  setBlessingAPI(api: () => ProgressionBlessingInfo): void {
    this.blessingApi = api;
    this.refreshProgressionDeps();
  }

  /**
   * The run's contracts (plan §5.3). Pushed by `Game.syncUiApis`, same as the
   * blessing API, so the tracker and the Progression section read one source.
   */
  setContractAPI(api: () => ProgressionContractInfo): void {
    this.contractApi = api;
    this.refreshProgressionDeps();
    this.contractTracker.refresh();
  }

  /**
   * The Long Watch view (plan §6.2). Pushed by `Game.syncUiApis`, same shape
   * as the blessing/contract APIs: `Game` builds the data, `JournalPanel`
   * reads it. The empty default means the panel renders its initial state
   * before `Game` has had a chance to wire itself up.
   */
  setWatchAPI(api: () => WatchInfo): void {
    this.watchInfo = api;
  }

  private refreshProgressionDeps(): void {
    this.progressionPanel.setDeps({
      apThisCycle: () => this.lastState?.resources.apThisTranscendence ?? 0,
      blessings: () => this.blessingApi(),
      contracts: () => this.contractApi(),
    });
    if (this.lastState && this.activeTab === 'progression') {
      this.progressionPanel.update(this.lastState);
    }
  }

  setEquipmentAPI(api: EquipmentAPIDeps): void {
    this.equipmentApi = api;
    this.equipmentPanel.setDeps(api);
    if (this.lastState && this.activeTab === 'equipment') {
      this.equipmentPanel.update(this.lastState);
    }
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
    this.journalStrip.update(dt);
    this.contractTracker.update(dt);
  }

  /**
   * Boss readout for this frame (plan §3.5). Pushed every frame rather than
   * polled, because `UIManager` has no view of the enemy list.
   */
  setBossBarData(data: BossBarData | null): void {
    this.bossBarData = data;
  }

  /**
   * Pacing readout for this frame (plan §7). Pushed for the same reason the
   * boss bar is: the combo lives in `PacingManager` and the wave preview in
   * `WaveManager`, neither of which `UIManager` can see.
   */
  setPacingData(data: PacingHudData): void {
    this.pacingData = data;
    this.hud.setPacingData(data);
  }

  update(state: GameState): void {
    this.lastState = state;
    if (this.abilityBar) this.abilityBar.update(state);
    // Deliberately *above* the throttle: a two-second slam telegraph read at
    // 10 fps is a countdown that visibly stutters, which is the one thing the
    // bar exists to avoid. The `dom` helpers make an unchanged frame free.
    this.bossBar.update(this.bossBarData);
    // Above the throttle for the same reason: the combo bar drains over two
    // seconds and a drain read at 10 fps is a stutter, not a clock.
    if (this.pacingData) this.pacingOverlay.update(this.pacingData);

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

    // Intermission freeze: the damage log drains to zero within ten seconds of
    // the last hit, so tracking it through an intermission would show the tower
    // "losing" DPS it still has. Both timers are re-armed every intermission
    // frame and only run down once the next wave is live — the ease period the
    // new wave gets before the reading may move again.
    if (state.wave.intermission) {
      this.dpsFreezeTimer = DPS_RESUME_EASE;
      this.dpsRefillTimer = DPS_REFILL_WINDOW;
    } else if (this.dpsFreezeTimer > 0) {
      this.dpsFreezeTimer = Math.max(0, this.dpsFreezeTimer - dt);
    } else if (this.dpsRefillTimer > 0) {
      this.dpsRefillTimer = Math.max(0, this.dpsRefillTimer - dt);
    }

    if (this.dpsFreezeTimer <= 0) {
      const smoothingTime = 10;
      const alpha = dt > 0 ? 1 - Math.exp(-dt / smoothingTime) : 1;
      // While the damage window refills after a lull, an early reading is a
      // fraction of the true rate. Only track *up* then: chasing the early
      // reading down would dip the pill below the value it held and drag it
      // back up again as the window filled.
      const refilling = this.dpsRefillTimer > 0 && this.realTimeDps < this.smoothedDps;
      if (!refilling) {
        this.smoothedDps = this.smoothedDps * (1 - alpha) + this.realTimeDps * alpha;
      }
    }

    // Adaptive push cadence: while the reading is on the move the HUD needs a
    // fresh target at tween speed; once it settles, a slow refresh is plenty.
    const drift = Math.abs(this.smoothedDps - this.lastPushedDps);
    const cadenceMs = drift > Math.max(0.5, this.lastPushedDps * 0.01)
      ? DPS_PUSH_FAST_MS
      : DPS_PUSH_SLOW_MS;
    if (now - this.lastDpsDisplayTime >= cadenceMs) {
      this.hud.setDPS(this.smoothedDps);
      this.lastPushedDps = this.smoothedDps;
      this.lastDpsDisplayTime = now;
    }

    // Throttled DOM updates (~10fps at 60fps game loop)
    this.uiFrameCounter++;
    if (this.uiFrameCounter % this.UI_UPDATE_INTERVAL !== 0) return;

    this.hud.update(state);
    this.setTabBadge('talents', state.towerXp?.unspentTalentPoints ?? 0);
    this.pushEquipmentBadge();
    if (this.activeTab === 'upgrades') {
      this.upgradePanel.update(state);
    } else if (this.activeTab === 'abilities') {
      this.abilityPanel.update(state);
    } else if (this.activeTab === 'passives') {
      this.passivePanel.update(state);
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
    } else if (this.activeTab === 'progression') {
      this.progressionPanel.update(state);
    } else if (this.activeTab === 'journal') {
      this.journalPanel.update(state);
    } else if (this.activeTab === 'stats') {
      this.statsPanel.update();
    } else if (this.activeTab === 'settings') {
      this.settingsPanel.update();
    }
    this.pushFrameStats(state);
    this.pushEnemyStats(state);
    this.milestoneStrip.refresh();
    this.journalStrip.refresh();
    this.contractTracker.refresh();
  }

  private pushEnemyStats(state: GameState): void {
    const wave = state.wave.number;
    const mults = this.enemyApi.getWaveMultipliers();
    // Key on (wave, multipliers) so a mid-wave HP multiplier change (Glass
    // Cannon, enrage — except enrage is filtered here too) re-renders, while
    // a same-wave re-push from the per-frame UI tick is a no-op.
    const sig = `${wave}|${mults.hp}|${mults.speed}|${mults.damage}`;
    if (sig === this.lastEnemyStatsSig) return;
    this.lastEnemyStatsSig = sig;

    const isBoss = isBossWave(wave);
    // `spawnPoolForWave` is the single source of truth for what *can* spawn
    // this wave; the boss is listed unconditionally because the boss bar and
    // its banner cover the announcement elsewhere. On a boss wave the pool is
    // live in its own right — the escort spawns from it (`bossEscortCountForWave`).
    const pool = spawnPoolForWave(wave);
    const inWaveSet = new Set<EnemyType>(pool.map(e => e.type));
    const types: EnemyType[] = [];
    if (isBoss) types.push('boss');
    for (const e of pool) types.push(e.type);

    // The mastery track is keyed off lifetime counters, so it can change
    // without any wave/multiplier change. Re-fetch every push (cheap — one
    // walk of `WATCH_CHAPTERS`) and stamp the matching type's lines on each
    // entry; types nobody names get an empty array, which is the codex's
    // signal to render no Watch section.
    const watchLines = this.enemyWatchApi.getWatchLines();

    const entries: EnemyWaveStatsEntry[] = types.map(t => {
      const def = ENEMY_DEFS[t];
      const hp = t === 'boss' ? bossMaxHpForWave(wave) : enemyHPForWave(def.baseHP, wave);
      // The boss is paid the whole encounter's purse, so the codex has to quote
      // that and not the per-boss figure the pack used to be paid.
      const gold = t === 'boss' ? bossGoldForWave(wave) : goldDropForWave(def.baseGold, wave);
      return {
        type: t,
        hp,
        speed: enemySpeedForWave(def.baseSpeed, wave),
        armor: def.armor,
        magicResist: def.magicResist,
        damage: enemyDamageForWave(def.baseDamage, wave),
        fireRate: def.fireRate,
        gold,
        wave,
        inWave: t === 'boss' ? isBoss : inWaveSet.has(t),
        multipliers: mults,
        watch: watchLines[t] ?? [],
      };
    });

    this.enemyCodexModal.setInfo(entries);
  }

  private pushFrameStats(state: GameState): void {
    const t = state.tower;
    const r = state.resources;
    this.statsPopup.setInfo({
      damage: t.baseDamage,
      // The same smoothed reading the HUD DPS pill tweens from, so the
      // tooltip row and the pill cannot disagree about the tower's DPS.
      dps: this.smoothedDps,
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
      goldSources: this.cachedGoldSources,
      rpGainRate: this.researchApi.rpGainRate,
      resolved: this.cachedResolved,
      targetingMode: this.cachedTargetingMode,
    });
  }

  /**
   * The five-group rail on the panel's leading edge (§8.A).
   *
   * Built once: the group set is static, so only the `active` class and the
   * badge text ever change after this.
   */
  private renderRail(): void {
    this.tabsRoot.className = 'panel-rail';
    this.tabsRoot.setAttribute('role', 'tablist');
    this.tabsRoot.innerHTML = '';
    for (const g of NAV_GROUPS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'rail-btn';
      btn.dataset.group = g.id;
      btn.title = g.label;
      btn.setAttribute('aria-label', g.label);
      const iconWrap = document.createElement('span');
      iconWrap.className = 'rail-btn-icon';
      iconWrap.appendChild(renderIconEl(g.icon, { size: 22, tone: 'inherit' }));
      const label = document.createElement('span');
      label.className = 'rail-btn-label';
      label.textContent = g.label;
      const badge = document.createElement('span');
      badge.className = 'tab-badge';
      badge.dataset.groupBadge = g.id;
      btn.append(iconWrap, label, badge);
      btn.addEventListener('click', () => {
        if (hasClass(btn, 'tab-locked')) return;
        this.showGroup(g.id);
      });
      this.tabsRoot.appendChild(btn);
    }
  }

  /** The active group's tabs, rendered above the content. */
  private renderSubStrip(g: NavGroupId): void {
    const group = groupById(g);
    this.subStrip.innerHTML = '';
    // A one-tab group has nothing to choose between; the strip would be a row
    // of chrome saying the same thing the rail already says.
    toggleClass(this.subStrip, 'is-hidden', group.tabs.length < 2);
    for (const t of group.tabs) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tab-btn';
      btn.textContent = t.label;
      btn.dataset.tab = t.id;
      const badge = document.createElement('span');
      badge.className = 'tab-badge';
      badge.dataset.tabBadge = t.id;
      btn.appendChild(badge);
      btn.addEventListener('click', () => {
        if (hasClass(btn, 'tab-locked')) return;
        this.showTab(t.id);
      });
      this.subStrip.appendChild(btn);
    }
    this.applyBadges();
  }

  private showGroup(g: NavGroupId): void {
    this.showTab(this.lastTabPerGroup.get(g) ?? firstTabOf(g));
  }

  /**
   * Badge counts, generalised (§8.A). Talents was the only caller, but the
   * mechanism now has to reach two surfaces per tab (the sub-tab and its group
   * rail button, whose count is the sum over the group), and special-casing
   * one id twice is how that stays wrong.
   */
  setTabBadge(tab: PanelTab, count: number): void {
    const next = Math.max(0, Math.floor(count));
    if ((this.tabBadges.get(tab) ?? 0) === next) return;
    this.tabBadges.set(tab, next);
    this.applyBadges();
  }

  private applyBadges(): void {
    for (const g of NAV_GROUPS) {
      let sum = 0;
      for (const t of g.tabs) {
        const n = this.tabBadges.get(t.id) ?? 0;
        sum += n;
        this.writeBadge(this.subStrip.querySelector(`[data-tab-badge="${t.id}"]`), n);
        // Per-tab badge on the mobile segmented strip too, so a Research →
        // Talents notification (the one a phone user is most likely to hit
        // first) is the same mark on both surfaces.
        this.mobileSheet?.setBadge(t.id, n);
      }
      this.writeBadge(this.tabsRoot.querySelector(`[data-group-badge="${g.id}"]`), sum);
      this.bottomNav?.setBadge(g.id, sum);
    }
  }

  private writeBadge(el: Element | null, count: number): void {
    if (!(el instanceof HTMLElement)) return;
    el.textContent = count > 0 ? String(count) : '';
    toggleClass(el, 'is-visible', count > 0);
  }

  private restoreNavTab(): PanelTab {
    try {
      const raw = localStorage.getItem(NAV_TAB_KEY);
      if (isPanelTab(raw)) return raw;
    } catch {}
    return 'upgrades';
  }

  setActiveTab(id: PanelTab): void {
    this.showTab(id);
  }

  private showTab(id: PanelTab): void {
    this.activeTab = id;
    this.activeGroup = GROUP_OF[id];
    this.lastTabPerGroup.set(this.activeGroup, id);
    try { localStorage.setItem(NAV_TAB_KEY, id); } catch {}
    this.renderSubStrip(this.activeGroup);
    this.activateTabButtons(id);
    this.contentRoot.innerHTML = '';
    // Clear any class the previous panel left behind: panels that render no
    // class of their own would otherwise inherit it and pick up its layout.
    this.contentRoot.className = this.contentRootBaseClass;
    if (id === 'upgrades') {
      this.upgradePanel.mount(this.contentRoot);
      if (this.lastState) this.upgradePanel.update(this.lastState);
    } else if (id === 'abilities') {
      this.abilityPanel.mount(this.contentRoot);
      if (this.lastState) this.abilityPanel.update(this.lastState);
    } else if (id === 'passives') {
      this.passivePanel.mount(this.contentRoot);
      if (this.lastState) this.passivePanel.update(this.lastState);
      this.onPassivesViewed();
    } else if (id === 'talents') {
      this.talentPanel.mount(this.contentRoot);
      if (this.lastState) this.talentPanel.update(this.lastState);
    } else if (id === 'equipment') {
      this.equipmentPanel.mount(this.contentRoot);
      if (this.lastState) this.equipmentPanel.update(this.lastState);
      // A remount rebuilds the sub-tab strip, so re-apply the badge.
      this.setTabBadge('equipment', this.equipmentBadgeCount);
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
    } else if (id === 'progression') {
      this.progressionPanel.mount(this.contentRoot);
      if (this.lastState) this.progressionPanel.update(this.lastState);
    } else if (id === 'journal') {
      this.journalPanel.mount(this.contentRoot);
      if (this.lastState) this.journalPanel.update(this.lastState);
    } else if (id === 'stats') {
      this.statsPanel.mount(this.contentRoot);
      this.statsPanel.update();
    } else if (id === 'settings') {
      this.settingsPanel.mount(this.contentRoot);
    }
    this.restoreContainerClass(this.contentRoot, this.contentRootBaseClass);
  }

  /**
   * Re-apply a panel container's own class after a panel has mounted into it.
   *
   * Every panel's `renderInto` does `parent.className = '<name>-panel'`, which
   * wipes the container's class along with it — and the container is the
   * element carrying `overflow-y: auto`. The result was a panel that could not
   * scroll, and (because the stale class survived the next mount) a panel that
   * broke whichever tab was opened after it. Restoring the base class here
   * fixes every panel at once rather than auditing ten `renderInto`s.
   */
  private restoreContainerClass(el: HTMLElement, baseClass: string): void {
    if (!baseClass) return;
    for (const cls of baseClass.split(/\s+/)) {
      if (cls) el.classList.add(cls);
    }
  }

  private activateTabButtons(id: PanelTab): void {
    for (const el of Array.from(this.subStrip.querySelectorAll<HTMLButtonElement>('.tab-btn'))) {
      toggleClass(el, 'active', el.dataset.tab === id);
    }
    const group = GROUP_OF[id];
    for (const el of Array.from(this.tabsRoot.querySelectorAll<HTMLButtonElement>('.rail-btn'))) {
      toggleClass(el, 'active', el.dataset.group === group);
    }
    this.bottomNav?.setActive(group);
  }

  /** Open/close the keyboard-shortcut reference (plan §4.8). */
  toggleKeybinds(): void {
    this.keybindsOverlay.toggle();
  }

  /** Open the Codex on a specific entry (from a stat row or an enemy card). */
  openCodex(entryId?: string): void {
    this.setActiveTab('codex');
    // Codex entry focus is a follow-up — the panels system is mid-refactor
    // (see plans/ui.md §codex wiring). For now, jumping to the codex tab is
    // enough: every enemy bestiary chip links to one of three top-level ids
    // the player can find by scrolling.
    void entryId;
  }

  /** True when the shortcut overlay is up, so Esc can close it first. */
  isKeybindsOpen(): boolean {
    return this.keybindsOverlay.isOpen();
  }

  /**
   * True when any modal has the player's attention.
   *
   * Read by `Game.isModalOpen`, which gates the §7.1 Space binding. This used
   * to be a hand-written list of four modal names, correct only because
   * whoever added a modal remembered to edit it; it now asks the shell's
   * registry, so a new modal answers the gate by existing. A bare
   * `modalRoot.childElementCount` check would have been shorter and wrong:
   * the boss bar, the placement prompt and the contract tracker all live in
   * overlay roots that can fall back to `modalRoot`, and none of them is a
   * modal.
   */
  isModalOpen(): boolean {
    return Modal.anyOpen();
  }

  closeKeybinds(): void {
    this.keybindsOverlay.hide();
  }

  /**
   * Advance the run-failed modal's 20 s auto-retry countdown. Called from
   * `Game.tickWallClockSystems` so the countdown keeps moving while the
   * simulation is paused for the run-over prompt. Wall-clock only: at 6.5x
   * speed a game-time deadline would give the player three real seconds to
   * read the stats and pick, which is not the idle-game guarantee.
   */
  tickRunFailedModal(realDt: number): void {
    this.runFailedModal.tick(realDt);
  }

  notify(kind: 'info' | 'warning' | 'milestone', text: string): void {
    this.bus.emit('toast', { kind, text });
  }
}
