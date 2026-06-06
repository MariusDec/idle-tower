import { Game } from './game/Game';
import { EventBus } from './game/EventBus';
import { UIManager } from './ui/UIManager';
import { ABILITIES } from './data/abilities';

function bootstrap(): void {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
  if (!canvas) {
    console.error('[main] #game-canvas not found');
    return;
  }

  const hudRoot = document.getElementById('hud-root');
  const tabsRoot = document.getElementById('panel-tabs');
  const contentRoot = document.getElementById('panel-content');
  const toastRoot = document.getElementById('toast-root');
  if (!hudRoot || !tabsRoot || !contentRoot || !toastRoot) {
    console.error('[main] UI roots missing');
    return;
  }

  let modalRoot = document.getElementById('modal-root');
  if (!modalRoot) {
    modalRoot = document.createElement('div');
    modalRoot.id = 'modal-root';
    document.body.appendChild(modalRoot);
  }

  const bus = new EventBus();
  const ui = new UIManager({
    hudRoot,
    tabsRoot,
    contentRoot,
    bus,
    modalRoot,
  });

  const game = new Game(canvas, { bus, ui, notificationRoot: toastRoot });
  ui.setOnBuyUpgrade((id) => {
    game.upgradeManager.buy(id);
  });
  ui.setOnCastAbility((id) => {
    game.castAbility(id);
  });
  ui.setOnUpgradeAbility((id) => {
    game.upgradeAbility(id);
  });
  ui.setOnAscend(() => {
    game.ascend();
  });
  ui.setOnTranscend(() => {
    game.transcend();
  });
  ui.setOnSpendAP((perkId) => {
    game.spendAP(perkId);
  });
  ui.setOnUnlockResearch((id) => {
    game.startResearch(id);
  });
  ui.setOnCancelResearch(() => {
    game.cancelResearch();
  });
  ui.setOnToggleAutomation((key, enabled) => {
    game.setAutomationEnabled(key, enabled);
  });
  ui.setOnTargetWaveChange((wave) => {
    game.setTargetAscendWave(wave);
  });
  ui.setOnSpeedChange((index) => {
    game.setSpeedIndex(index);
  });
  ui.setOnPrevWave(() => {
    game.goToPrevWave();
  });
  ui.setOnNextWave(() => {
    game.goToNextWave();
  });
  ui.setOnToggleAutoProgress(() => {
    game.toggleAutoProgress();
  });
  ui.setOnClearSave(() => {
    game.clearSave();
    ui.setActiveTab('upgrades');
  });
  ui.setOnVolumeChange((v) => {
    game.audioMgr.setVolume(v);
  });
  ui.setOnMuteToggle(() => {
    game.audioMgr.toggleMute();
  });
  ui.setOnTargetingModeChange((mode) => {
    game.towerSystem.setTargetingMode(mode as 'nearest' | 'lowest_hp' | 'first' | 'strongest' | 'boss' | 'flying' | 'last');
  });
  ui.setAudioAPI({
    volume: game.audioMgr.currentVolume,
    muted: game.audioMgr.isMuted,
    setVolume: (v) => game.audioMgr.setVolume(v),
    toggleMute: () => game.audioMgr.toggleMute(),
  });
  ui.setTargetingAPI({
    currentMode: game.gameState.tower.targetingMode,
    setMode: (m) => game.towerSystem.setTargetingMode(m as 'nearest' | 'lowest_hp' | 'first' | 'strongest' | 'boss' | 'flying' | 'last'),
  });
  ui.setAbilityAPI({
    canCast: (id, wave) => game.abilities.canCast(id, wave),
    reasonBlocked: (id, wave) => game.abilities.reasonBlocked(id, wave),
    canUpgrade: (id, wave) => game.abilities.canUpgrade(id, wave),
    isMaxed: (id) => game.abilities.isMaxed(id),
    getUpgradeCost: (id) => game.abilities.getUpgradeCost(id),
    getEffectiveStats: (id) => game.abilities.getEffectiveStats(id),
  });
  ui.setPrestigeAPI({
    canAscend: (wave) => game.prestige.canAscend(wave),
    canTranscend: (lap) => game.prestige.canTranscend(lap),
    previewAP: (wave) => game.prestige.previewAP(wave),
    previewTP: (lap) => game.prestige.previewTP(lap),
    canSpend: (perkId) => game.prestige.canSpendAP(perkId) || game.prestige.canSpendTP(perkId),
    isAutomationUnlocked: (key) => game.prestige.isAutomationUnlocked(key),
    isAutomationEnabled: (key) => game.prestige.getAutomationEnabled(key),
    ascendUnlockWave: game.prestige.ascensionUnlockWave(),
    transcendUnlockAP: game.prestige.transcendenceUnlockAP(),
    targetAscendWave: game.gameState.prestige.targetAscendWave,
    meetsPrerequisites: (id) => game.prestige.meetsPrerequisites(id),
    isExcluded: (id) => game.prestige.isExcluded(id),
  });
  ui.setResearchAPI({
    rp: game.research.rp,
    levels: game.research.getLevelsSnapshot(),
    unlocked: game.research.unlocked,
    reasonBlocked: (id) => game.research.reasonBlocked(id),
    inProgress: null,
    researchSpeedMultiplier: game.prestige.getResearchSpeedMultiplier(),
    rpGainRate: game.research.getPassiveRPRate(
      game.gameState.stats.lifetimeHighestWave,
      game.research.getRPGainMultiplier(),
    ),
  });

  let mouseDown = false;
  const ensureAudio = () => game.initAudio();
  canvas.addEventListener('mousemove', (ev) => {
    const rect = canvas.getBoundingClientRect();
    game.setMouseInput(ev.clientX - rect.left, ev.clientY - rect.top, mouseDown);
  });
  canvas.addEventListener('mousedown', (ev) => {
    mouseDown = true;
    const rect = canvas.getBoundingClientRect();
    game.setMouseInput(ev.clientX - rect.left, ev.clientY - rect.top, true);
    ensureAudio();
  });
  canvas.addEventListener('mouseup', () => {
    mouseDown = false;
    game.setMouseInput(0, 0, false);
  });

  window.addEventListener('keydown', (ev) => {
    ensureAudio();
    if (ev.target instanceof HTMLInputElement || ev.target instanceof HTMLTextAreaElement) return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const def = ABILITIES.find(a => a.hotkey === ev.key);
    if (def) {
      if (game.castAbility(def.id)) ev.preventDefault();
      return;
    }
    if (ev.key === '<' || ev.key === ',') {
      game.goToPrevWave();
      ev.preventDefault();
    } else if (ev.key === '>' || ev.key === '.') {
      if (game.gameState.wave.number >= game.gameState.wave.highestWave) return;

      game.goToNextWave();
      ev.preventDefault();
    } else if (ev.key === 'p' || ev.key === 'P') {
      game.toggleAutoProgress();
      ev.preventDefault();
    } else if (ev.key === '-' || ev.key === '_') {
      game.cycleSpeed(-1);
      ev.preventDefault();
    } else if (ev.key === '=' || ev.key === '+') {
      game.cycleSpeed(1);
      ev.preventDefault();
    }
  });

  game.setFpsOverlay(ui.getFpsElement());
  const canvasWrap = document.querySelector('.canvas-wrap') as HTMLElement | null;
  game.setCanvasWrap(canvasWrap);
  game.tryLoadSave();
  game.start();

  (window as unknown as { __theTower?: unknown }).__theTower = { game, bus, ui };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
  bootstrap();
}
