import { Game } from './game/Game';
import { EventBus } from './game/EventBus';
import { UIManager } from './ui/UIManager';
import { loadIconSprite } from './ui/Icon';
import { Modal } from './ui/Modal';
import { ABILITIES } from './data/abilities';
import { isQualityTier, type QualityTier } from './data/quality';
import { FX } from './data/palette';
import type { EnemyType, TargetingMode } from './types';
import { initNativeShell, hideNativeSplash, bindNativeLifecycle } from './platform/native';

/** What `__theTower.bench()` accepts (UI plan §10.B). */
interface BenchOptions {
  /** Live enemies held on the field for the duration. */
  enemies?: number;
  /** Sampling window, in seconds of wall clock. */
  seconds?: number;
  /** Tier to measure. Restored when the run ends; the stored preference is never touched. */
  tier?: QualityTier;
}

/** What it reports back. Milliseconds, per frame. */
interface BenchResult {
  tier: QualityTier;
  frames: number;
  p50: number;
  p95: number;
  worst: number;
  particles: number;
  enemies: number;
}

// Small n, one shot, no allocation pressure that matters: a plain sort is fine.
function percentile(samples: number[], p: number): number {
  const s = [...samples].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

/**
 * The frame-budget harness (UI plan §10.B).
 *
 * Holds `enemies` live enemies on the field through the real `EnemyManager`
 * — so the spatial grid, the sprite cache and the whole render path are
 * exercised the way a busy wave exercises them — saturates the particle pool
 * by calling `emitDeathBurst` on a timer, and samples the frame delta from a
 * rAF that rides alongside `Game`'s own loop.
 *
 * The first 30 samples are discarded for the same reason the §9.D probe
 * discards them: JIT warm-up and the first background bake are not the frame
 * cost anyone lives with.
 *
 * Everything it touches is put back: the enemies it spawned are spliced out of
 * the list by id, and the tier is restored with `setQuality` (not
 * `setQualityPreference`, which would persist a measurement as a choice).
 */
function bench(game: Game, opts: BenchOptions = {}): Promise<BenchResult> {
  const targetEnemies = Math.max(0, Math.floor(opts.enemies ?? 250));
  const seconds = Math.max(0.1, opts.seconds ?? 10);
  const previousTier = game.qualityTier;
  if (opts.tier !== undefined && isQualityTier(opts.tier)) game.setQuality(opts.tier);

  const mgr = game.enemies;
  const effects = game.effectsManager;
  const { width, height } = game.worldExtents;
  // A spread of types, so the sprite cache is asked for more than one bake.
  const types: EnemyType[] = ['normal', 'fast', 'tank', 'flying', 'shielded', 'siege'];
  const wave = Math.max(1, game.gameState.wave.number);
  const spawned = new Set<number>();
  let cursor = 0;

  const topUp = (): void => {
    // Count only the harness's own enemies, so a bench run during a live wave
    // does not spawn on top of a full field.
    let live = 0;
    for (const e of mgr.list) if (spawned.has(e.id) && e.alive) live++;
    while (live < targetEnemies) {
      const angle = Math.random() * Math.PI * 2;
      const r = 0.18 + Math.random() * 0.3;
      const x = width / 2 + Math.cos(angle) * width * r;
      const y = height / 2 + Math.sin(angle) * height * r;
      const e = mgr.spawn(types[cursor++ % types.length], wave, x, y);
      spawned.add(e.id);
      live++;
    }
    mgr.markGridStale();
  };

  return new Promise<BenchResult>((resolve) => {
    const samples: number[] = [];
    let last = performance.now();
    let seen = 0;
    let frame = 0;
    let elapsed = 0;

    const step = (): void => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      frame++;
      topUp();
      // Saturate the pool: 48 particles every third frame is ~960/s against a
      // ~1 s particle life, which overruns every tier's cap (600/360/200) even
      // after `particleScale` has taken its cut. The pool stays full, which is
      // the state worth measuring.
      if (frame % 3 === 0) {
        const angle = Math.random() * Math.PI * 2;
        effects.emitDeathBurst(
          width / 2 + Math.cos(angle) * width * 0.25,
          height / 2 + Math.sin(angle) * height * 0.25,
          FX.ember,
          18,
          48,
        );
      }
      if (++seen > 30) {
        samples.push(dt);
        elapsed += dt / 1000;
      }
      if (elapsed < seconds) {
        requestAnimationFrame(step);
        return;
      }

      const result: BenchResult = {
        tier: game.qualityTier,
        frames: samples.length,
        p50: percentile(samples, 0.5),
        p95: percentile(samples, 0.95),
        worst: Math.max(...samples),
        particles: effects.particleList.length,
        enemies: mgr.list.filter((e) => spawned.has(e.id) && e.alive).length,
      };

      // Put the field back: drop only what this run put on it.
      const list = mgr.list;
      for (let i = list.length - 1; i >= 0; i--) {
        if (spawned.has(list[i].id)) list.splice(i, 1);
      }
      mgr.markGridStale();
      game.setQuality(previousTier);
      resolve(result);
    };

    requestAnimationFrame(step);
  });
}

/**
 * The "get me out of here" ladder, shared by `Escape` and the Android hardware
 * back button. Returns true when something was actually dismissed — the back
 * button uses that to decide between consuming the press and backgrounding
 * the app (src/platform/native.ts).
 *
 * Order matters: placement mode is first because it is the state that changes
 * what the next tap does, and so the one the player most urgently needs out of
 * (UI plan §4.3).
 */
function dismissTopmost(game: Game, ui: UIManager): boolean {
  if (game.cancelPlacement()) return true;
  // Modals before the sheet: a picker opened *from* a sheet sits on top of it,
  // so closing the sheet first would strand the dialog over an empty backdrop.
  // `Modal.closeTop` also owns the keybinds overlay, which is a modal.
  if (Modal.closeTop()) return true;
  if (ui.closeMobileSheet()) return true;
  if (ui.isKeybindsOpen()) {
    ui.closeKeybinds();
    return true;
  }
  return false;
}

async function bootstrap(): Promise<void> {
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
  ui.setUpgradeShotPreviewGetter((id, levels) => game.previewUpgradeShot(id, levels));
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
  ui.setOnUnlockCore((id) => {
    game.unlockCore(id);
  });
  ui.setOnReforge(() => {
    game.reforgeAP();
  }, () => game.reforgeValue());
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
  ui.setOnRestartWave(() => {
    game.restartWave();
  });
  ui.setOnToggleAutoProgress(() => {
    game.toggleAutoProgress();
  });
  ui.setOnCallWaveEarly(() => {
    game.callWaveEarly();
  });
  ui.setOnRiskChange((level) => {
    game.setRisk(level);
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
  ui.setOnAutoCastAutoAimChange((enabled) => {
    game.setAutoCastAutoAim(enabled);
  });
  ui.setAutoCastAutoAimState(game.autoCastAutoAimEnabled);
  // Plan §9.D: the Graphics control. `setQualityPreference` writes the
  // preference and persists; `setQualityState` mirrors the live state back
  // into the panel so a tier demoted by the 2-second probe is visible.
  ui.setOnQualityChange((pref) => {
    game.setQualityPreference(pref);
    ui.setQualityState(pref, game.qualityTier);
  });
  ui.setQualityState(game.qualityPreference, game.qualityTier);
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
    // Plan §G.3: read pending placement from the live `Game` accessor so the
    // bar's `is-arming` class tracks arming without polling Game directly.
    getPendingPlacement: () => game.pendingPlacement,
  });
  ui.setPrestigeAPI({
    canAscend: (wave) => game.prestige.canAscend(wave),
    canTranscend: (lap) => game.prestige.canTranscend(lap),
    previewAP: (wave) => game.prestige.previewAP(wave),
    previewTP: (lap) => game.prestige.previewTP(lap),
    canSpend: (perkId) => game.prestige.canSpendAP(perkId) || game.prestige.canSpendTP(perkId),
    coreState: game.corePanelState(),
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
  /**
   * Pointer → world.
   *
   * This used to be `clientX x (canvas.width / rect.width)`, which worked only
   * because the backing store *was* the world. With a camera the two are
   * different spaces and different units: the rect gives CSS pixels relative
   * to the element, and only the camera knows the zoom and the offset that
   * turn those into world coordinates. Deliberately routed through
   * `game.screenToWorld` rather than reaching for the camera directly, so
   * `Game` stays the only thing holding both halves.
   */
  const toWorldXY = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
    return game.screenToWorld(clientX - rect.left, clientY - rect.top);
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
    // UI plan §5.D: a boss intro takes the press *before* the orb/placement/
    // charge routing, and consumes it — a tap meant to skip the cinematic must
    // not also drop a meteor. It retracts over 0.35 s rather than cutting.
    if (game.skipBossIntro()) return;
    const consumed = game.handleCanvasPress(x, y);
    // Even a consumed press still updates the aim point. Not doing so made a
    // click on an orb snap the tower's aim back to wherever the cursor last
    // was, which reads as the tower flinching away from the thing you clicked.
    game.setMouseInput(x, y, !consumed);
  };

  canvas.addEventListener('mousemove', (ev) => {
    const { x, y } = toWorldXY(ev.clientX, ev.clientY);
    game.setMouseInput(x, y, mouseDown);
  });
  canvas.addEventListener('mousedown', (ev) => {
    const { x, y } = toWorldXY(ev.clientX, ev.clientY);
    mouseDown = true;
    game.setPointerOnCanvas(true);
    pressAt(x, y);
    mouseDown = game.isMouseHeld();
    ensureAudio();
  });
  canvas.addEventListener('mouseup', () => {
    mouseDown = false;
    game.releasePointer();
  });
  // Plan §B.2: a cursor leaving the canvas drops the button state and the
  // "pointer is on the canvas" flag, so the reticle does not stick at the
  // last hover point and `placementSnapshot` can hide the disc. Re-entering
  // re-raises the flag so the next move listener can paint a fresh one.
  canvas.addEventListener('mouseleave', () => {
    mouseDown = false;
    game.releasePointer();
    game.setPointerOnCanvas(false);
  });
  canvas.addEventListener('mouseenter', () => game.setPointerOnCanvas(true));

  // Touch input: forward single-finger touches to the same mouse pipeline.
  // Plan §B.3: while an ability is armed, the touch path is "drag to aim,
  // release to place" — `touchstart` does not press, it only tracks; the
  // cast resolves on `touchend` via `commitPlacementAtPointer`.
  canvas.addEventListener('touchstart', (ev) => {
    if (ev.touches.length === 0) return;
    const t = ev.touches[0];
    activeTouchId = t.identifier;
    const { x, y } = toWorldXY(t.clientX, t.clientY);
    game.setPointerOnCanvas(true);
    if (game.isPlacing()) {
      // Aiming: the disc follows the finger and lands when it lifts.
      game.setMouseInput(x, y, true);
    } else {
      pressAt(x, y);
    }
    ensureAudio();
    ev.preventDefault();
  }, { passive: false });
  canvas.addEventListener('touchmove', (ev) => {
    if (activeTouchId === null) return;
    for (let i = 0; i < ev.touches.length; i++) {
      if (ev.touches[i].identifier === activeTouchId) {
        const t = ev.touches[i];
        const { x, y } = toWorldXY(t.clientX, t.clientY);
        game.setPointerOnCanvas(true);
        game.setMouseInput(x, y, true);
        break;
      }
    }
    ev.preventDefault();
  }, { passive: false });
  const releaseTouch = () => {
    activeTouchId = null;
    if (game.isPlacing()) game.commitPlacementAtPointer();
    game.releasePointer();
  };
  canvas.addEventListener('touchend', releaseTouch, { passive: true });
  canvas.addEventListener('touchcancel', releaseTouch, { passive: true });

  window.addEventListener('keydown', (ev) => {
    ensureAudio();
    if (
      ev.target instanceof HTMLInputElement
      || ev.target instanceof HTMLTextAreaElement
      || ev.target instanceof HTMLSelectElement
      || (ev.target instanceof HTMLElement && ev.target.isContentEditable)
    ) return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    // §5.D: same rule as the canvas press — any key skips the boss intro and
    // does nothing else that frame.
    if (game.skipBossIntro()) {
      ev.preventDefault();
      return;
    }
    const def = ABILITIES.find(a => a.hotkey === ev.key);
    if (def) {
      if (game.castAbility(def.id)) ev.preventDefault();
      return;
    }
    // Plan §7.1: Space calls the wave. Guarded twice over — `keydown` already
    // returns above for a focused input, and `Game.canCallWaveEarly` refuses
    // while any modal is up, because a wave called out from under a blessing
    // draft or a core picker is a decision taken away rather than made.
    if (ev.key === ' ' || ev.key === 'Spacebar') {
      // Always swallow the key: Space on a focused button re-triggers it, and
      // the browser's default is to scroll the page.
      ev.preventDefault();
      game.callWaveEarly();
      return;
    }
    if (ev.key === 'r' || ev.key === 'R') {
      game.restartWave();
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
      //
      // `Modal`'s own document-level handler runs before this window one and
      // marks the event handled, so a modal dismissed by Escape must not have
      // its press spent a second time on the surface underneath it.
      if (ev.defaultPrevented) return;
      if (dismissTopmost(game, ui)) ev.preventDefault();
    }
  });

  const canvasWrap = document.querySelector('.canvas-wrap') as HTMLElement | null;
  game.setCanvasWrap(canvasWrap);
  await game.hydrateSave();
  game.tryLoadSave();
  game.start();

  (window as unknown as { __theTower?: unknown }).__theTower = {
    game,
    bus,
    ui,
    // UI plan §10.B: one global, not two.
    bench: (opts?: BenchOptions) => bench(game, opts),
  };

  bindNativeLifecycle({
    onBack: () => dismissTopmost(game, ui),
    // Snapshot synchronously, then wait for the bytes to land — this is the last
    // moment before Android is free to kill the process (plan §8.1).
    onPause: async () => { game.manualSave(); await game.flushSave(); },
  });
  // The first frame is scheduled by `game.start()`; one rAF later it has painted,
  // and only then is it safe to take the splash away.
  requestAnimationFrame(() => { void hideNativeSplash(); });
}

/**
 * The icon sprite is injected before the UI mounts (UI plan §6).
 *
 * `<use href="external.svg#id">` does not resolve cross-document in Chromium,
 * so the symbols have to be in this document before the first `<use>` is
 * created. `loadIconSprite` resolves rather than rejects on failure, so a
 * missing sprite costs icons and not the run.
 */
function start(): void {
  void initNativeShell();
  // launchAutoHide is false, so if `bootstrap` throws, nothing else would ever
  // hide the splash. Five seconds is far longer than a cold start on a slow
  // device and far shorter than a player's patience.
  setTimeout(() => { void hideNativeSplash(); }, 5000);
  void loadIconSprite().then(bootstrap);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
