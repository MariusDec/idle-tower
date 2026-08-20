import { Game } from './game/Game';
import { EventBus } from './game/EventBus';
import { UIManager } from './ui/UIManager';
import { ABILITIES } from './data/abilities';
import type { TargetingMode } from './types';

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
  const panelRoot = document.getElementById('panel-root') as HTMLElement | null;
  const overlayRoot = document.getElementById('overlay-root') as HTMLElement | null;
  const abilityBarRoot = document.getElementById('ability-bar-root') as HTMLElement | null;
  const bottomNavRoot = document.getElementById('bottom-nav-root') as HTMLElement | null;
  const mobileSheetRoot = document.getElementById('mobile-sheet-root') as HTMLElement | null;
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
    overlayRoot: overlayRoot ?? undefined,
    panelRoot: panelRoot ?? undefined,
    abilityBarRoot: abilityBarRoot ?? undefined,
    bottomNavRoot: bottomNavRoot ?? undefined,
    mobileSheetRoot: mobileSheetRoot ?? undefined,
  });

  const game = new Game(canvas, { bus, ui, notificationRoot: toastRoot, modalRoot });
  // ×N buys *up to* the next multiple of N rather than adding N levels, so
  // the button always lands the upgrade on a round level.
  const upgradePlan = (id: string, amount: 1 | 10 | 'max') => (
    amount === 'max'
      ? game.upgradeManager.getMaxAffordablePlan(id)
      : game.upgradeManager.getRoundedPlan(id, amount)
  );
  ui.setOnBuyUpgrade((id, amount) => {
    game.upgradeManager.buyBulk(id, upgradePlan(id, amount).levels);
  });
  ui.setUpgradePlanGetter(upgradePlan);
  ui.setOnCastAbility((id) => {
    game.castAbility(id);
  });
  ui.setOnUpgradeAbility((id) => {
    game.upgradeAbility(id);
  });
  ui.setOnAscend(() => {
    game.ascend();
  });
  ui.setOnResolveRunFailure((action) => {
    game.resolveRunFailure(action);
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
    game.towerSystem.setTargetingMode(mode as TargetingMode);
  });
  ui.setOnAutoPickBlessingsChange((enabled) => {
    game.setAutoPickBlessings(enabled);
  });
  ui.setAutoPickBlessingsState(game.isAutoPickBlessings(), game.isAutoPickBlessingsForced());
  ui.setOnInstantCastChange((enabled) => {
    game.setInstantCast(enabled);
  });
  ui.setInstantCastState(game.isInstantCast());
  ui.setAudioAPI({
    volume: game.audioMgr.currentVolume,
    muted: game.audioMgr.isMuted,
    setVolume: (v) => game.audioMgr.setVolume(v),
    toggleMute: () => game.audioMgr.toggleMute(),
  });
  ui.setTargetingAPI({
    currentMode: game.gameState.tower.targetingMode,
    setMode: (m) => game.towerSystem.setTargetingMode(m as TargetingMode),
  });
  ui.setAbilityAPI({
    canCast: (id, wave) => game.abilities.canCast(id, wave),
    reasonBlocked: (id, wave) => game.abilities.reasonBlocked(id, wave),
    canUpgrade: (id, wave) => game.abilities.canUpgrade(id, wave),
    isMaxed: (id) => game.abilities.isMaxed(id),
    getUpgradeCost: (id) => game.abilities.getUpgradeCost(id),
    getEffectiveStats: (id) => game.abilities.getEffectiveStats(id),
    getXp: (id) => game.abilities.getXp(id),
    isAutoCastUnlocked: () => game.prestige.isAutomationUnlocked('autoAbilities'),
    isAutoCastEnabled: (id) => game.gameState.prestige.autoCastEnabled[id] !== false,
    onToggleAutoCast: (id, enabled) => game.setAutoCastEnabled(id, enabled),
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
    perkBlockedReason: (id) => game.prestige.perkBlockedReason(id),
    autoBuyStrategy: game.gameState.prestige.autoBuyStrategy,
    autoBuyReserve: game.gameState.prestige.autoBuyReserve,
    setAutoBuyStrategy: (strategy) => game.setAutoBuyStrategy(strategy),
    setAutoBuyReserve: (fraction) => game.setAutoBuyReserve(fraction),
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
  let activeTouchId: number | null = null;
  const ensureAudio = () => game.initAudio();
  const toCanvasXY = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left) * (canvas.width / rect.width),
      y: (clientY - rect.top) * (canvas.height / rect.height),
    };
  };
  /**
   * A press on the battlefield (gameplay plan §4.1/§4.3).
   *
   * Routing order is load-bearing: a loot orb under the cursor is collected,
   * otherwise a pending ability placement takes the click, and only if neither
   * consumed it does the press become an ordinary manual-aim hold. Doing this
   * in one function rather than in each listener is what keeps mouse and touch
   * genuinely identical — the touch pipeline feeds the same path, so tapping
   * an orb works without a second implementation that can drift.
   */
  const pressAt = (x: number, y: number): void => {
    const consumed = game.handleCanvasPress(x, y);
    // Even a consumed press still updates the aim point. Not doing so made a
    // click on an orb snap the tower's aim back to wherever the cursor last
    // was, which reads as the tower flinching away from the thing you clicked.
    game.setMouseInput(x, y, !consumed);
  };

  canvas.addEventListener('mousemove', (ev) => {
    const { x, y } = toCanvasXY(ev.clientX, ev.clientY);
    game.setMouseInput(x, y, mouseDown);
  });
  canvas.addEventListener('mousedown', (ev) => {
    const { x, y } = toCanvasXY(ev.clientX, ev.clientY);
    mouseDown = true;
    pressAt(x, y);
    mouseDown = game.isMouseHeld();
    ensureAudio();
  });
  canvas.addEventListener('mouseup', () => {
    mouseDown = false;
    game.setMouseInput(0, 0, false);
  });

  // Touch input: forward single-finger touches to the same mouse pipeline.
  canvas.addEventListener('touchstart', (ev) => {
    if (ev.touches.length === 0) return;
    const t = ev.touches[0];
    activeTouchId = t.identifier;
    const { x, y } = toCanvasXY(t.clientX, t.clientY);
    pressAt(x, y);
    ensureAudio();
    ev.preventDefault();
  }, { passive: false });
  canvas.addEventListener('touchmove', (ev) => {
    if (activeTouchId === null) return;
    for (let i = 0; i < ev.touches.length; i++) {
      if (ev.touches[i].identifier === activeTouchId) {
        const t = ev.touches[i];
        const { x, y } = toCanvasXY(t.clientX, t.clientY);
        game.setMouseInput(x, y, true);
        break;
      }
    }
    ev.preventDefault();
  }, { passive: false });
  const releaseTouch = () => {
    activeTouchId = null;
    game.setMouseInput(0, 0, false);
  };
  canvas.addEventListener('touchend', releaseTouch, { passive: true });
  canvas.addEventListener('touchcancel', releaseTouch, { passive: true });

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
    } else if (ev.key === '?' || ev.key === '/') {
      ui.toggleKeybinds();
      ev.preventDefault();
    } else if (ev.key === 'Escape') {
      // Plan §4.3: Escape gets the player out of placement mode first — it is
      // the state that changes what the next click does, so it is the one they
      // most urgently need to be able to abandon.
      if (game.cancelPlacement()) {
        ev.preventDefault();
      } else if (ui.isKeybindsOpen()) {
        ui.closeKeybinds();
        ev.preventDefault();
      }
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
