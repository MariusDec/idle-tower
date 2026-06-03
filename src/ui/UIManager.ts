import type { AbilityId, GameState, PanelTab, StatsInfo } from '../types';
import { HUD } from './HUD';
import { UpgradePanel } from './UpgradePanel';
import { AbilityPanel } from './AbilityPanel';
import { PrestigePanel } from './PrestigePanel';
import { TranscendencePanel } from './TranscendencePanel';
import { ResearchPanel } from './ResearchPanel';
import { SettingsPanel } from './SettingsPanel';
import { WelcomeBackModal, type WelcomeBackData } from './WelcomeBackModal';
import { EventBus } from '../game/EventBus';
import type { AutomationKey } from '../data/prestige';

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
  { id: 'settings', label: 'Settings' },
];

export interface AbilityAPI {
  canCast: (id: AbilityId, wave: number) => boolean;
  reasonBlocked: (id: AbilityId, wave: number) => string | null;
}

export interface ResearchAPI {
  rp: number;
  unlocked: ReadonlySet<string>;
  reasonBlocked: (id: string) => string | null;
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
  ascendUnlockWave: number;
  transcendUnlockAP: number;
  targetAscendWave: number;
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
  private readonly welcomeModal: WelcomeBackModal;
  private readonly bus: EventBus;
  private activeTab: PanelTab = 'upgrades';
  private dpsSamples: number[] = [];
  private dpsTimer = 0;
  private onBuyUpgrade: (id: string) => void = () => {};
  private onCastAbility: (id: AbilityId) => void = () => {};
  private onAscend: () => void = () => {};
  private onTranscend: () => void = () => {};
  private onSpendAP: (perkId: string) => void = () => {};
  private onUnlockResearch: (id: string) => void = () => {};
  private onToggleAutomation: (key: AutomationKey, enabled: boolean) => void = () => {};
  private onTargetWaveChange: (wave: number) => void = () => {};
  private onSpeedChange: (index: number) => void = () => {};
  private onPrevWave: () => void = () => {};
  private onNextWave: () => void = () => {};
  private onToggleAutoProgress: () => void = () => {};
  private onClearSave: () => void = () => {};
  private abilityApi: AbilityAPI = {
    canCast: () => false,
    reasonBlocked: () => 'Loading...',
  };
  private prestigeApi: PrestigeAPI = {
    canAscend: () => false,
    canTranscend: () => false,
    previewAP: () => 0,
    previewTP: () => 0,
    canSpend: () => false,
    isAutomationUnlocked: () => false,
    isAutomationEnabled: () => false,
    ascendUnlockWave: 20,
    transcendUnlockAP: 100,
    targetAscendWave: 20,
  };
  private researchApi: ResearchAPI = {
    rp: 0,
    unlocked: new Set<string>(),
    reasonBlocked: () => 'Loading...',
  };
  private lastState: GameState | null = null;
  private cachedGoldMultiplier = 1;

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
      canCast: (id, wave) => this.abilityApi.canCast(id, wave),
      reasonBlocked: (id, wave) => this.abilityApi.reasonBlocked(id, wave),
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
      previewTP: (ap) => this.prestigeApi.previewTP(ap),
      transcendUnlockAP: this.prestigeApi.transcendUnlockAP,
      targetAscendWave: this.prestigeApi.targetAscendWave,
    });
    this.researchPanel = new ResearchPanel({
      onUnlock: (id) => this.onUnlockResearch(id),
      rp: 0,
      unlocked: new Set<string>(),
      reasonBlocked: (id) => this.researchApi.reasonBlocked(id),
    });
    this.settingsPanel = new SettingsPanel({
      onClearSave: () => this.onClearSave(),
    });
    this.welcomeModal = new WelcomeBackModal(deps.modalRoot);
    this.renderTabs();
    this.activateTabButtons('upgrades');
    this.showTab('upgrades');

    this.bus.on('upgrade_purchased', (_payload: unknown) => {
      // const p = payload as { id: string };
      // this.bus.emit('toast', { kind: 'info', text: `Upgraded: ${p.id}` });
    });
    this.bus.on('ability_cast', (payload: unknown) => {
      const p = payload as { id: AbilityId; def: { name: string } };
      this.abilityPanel.flashCast(p.id);
      this.bus.emit('toast', { kind: 'milestone', text: `${p.def.name} cast!`, life: 2.5 });
    });
    this.bus.on('welcome_back', (payload: unknown) => {
      const data = payload as WelcomeBackData;
      if (data.result.elapsedSeconds > 0) {
        this.welcomeModal.show(data, () => {});
      }
    });
  }

  setOnBuyUpgrade(handler: (id: string) => void): void {
    this.onBuyUpgrade = handler;
  }

  setOnCastAbility(handler: (id: AbilityId) => void): void {
    this.onCastAbility = handler;
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

  update(state: GameState): void {
    this.lastState = state;
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
    } else if (this.activeTab === 'settings') {
      this.settingsPanel.update();
    }
    const dps = this.estimateDPS(state);
    this.dpsSamples.push(dps);
    if (this.dpsSamples.length > 30) this.dpsSamples.shift();
    this.dpsTimer += 1 / 60;
    if (this.dpsTimer >= 0.5) {
      this.dpsTimer = 0;
      const avg = this.dpsSamples.reduce((a, b) => a + b, 0) / Math.max(1, this.dpsSamples.length);
      this.hud.setDPS(avg);
    }
    this.pushFrameStats(state);
  }

  private pushFrameStats(state: GameState): void {
    const t = state.tower;
    const r = state.resources;
    const expectedHit = t.baseDamage * (1 + t.critChance * (t.critMultiplier - 1));
    const dps = expectedHit * t.fireRate;
    this.hud.setStatsInfo({
      damage: t.baseDamage,
      dps,
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
      manaRegen: r.manaRegen,
      maxMana: r.maxMana,
      goldMultiplier: this.cachedGoldMultiplier,
    });
  }

  private estimateDPS(state: GameState): number {
    const t = state.tower;
    const expectedHit = t.baseDamage * (1 + t.critChance * (t.critMultiplier - 1));
    return expectedHit * t.fireRate;
  }

  private renderTabs(): void {
    this.tabsRoot.innerHTML = '';
    for (const t of TABS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tab-btn';
      btn.textContent = t.label;
      btn.dataset.tab = t.id;
      btn.addEventListener('click', () => this.showTab(t.id));
      this.tabsRoot.appendChild(btn);
    }
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
