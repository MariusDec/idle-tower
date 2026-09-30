import { loadProfile, saveProfile } from '../meta/save';
import type { Profile } from '../meta/profile';
import { buildRunConfig } from '../meta/runConfig';
import { createRun, step } from '../sim/run';
import type { RunInput, RunState } from '../sim/state';
import { Renderer } from '../render/renderer';
import { resolveQuality } from '../render/quality';
import { Hud } from '../ui/hud';
import { HubScreen } from '../ui/hub/hub';
import { Modal } from '../ui/modal';
import { ResultsScreen } from '../ui/results';
import { bindNativeLifecycle } from '../platform/native';
import { Loop, SIM_DT } from './loop';
import { assertTransition, type Screen } from './screens';

/** Autosave cadence (§12.4), on the wall clock. */
const AUTOSAVE_SECONDS = 30;

export interface AppElements {
  canvas: HTMLCanvasElement;
  stage: HTMLElement;
  hud: HTMLElement;
  screens: HTMLElement;
  overlay: HTMLElement;
}

/**
 * The app: owns the profile, the current run, the loop and the screens, and
 * is the only thing that holds both the sim and the renderer.
 */
export class App {
  private screen: Screen = 'boot';
  private profile!: Profile;
  private run: RunState | null = null;
  private paused = false;
  private pending: RunInput = {};
  private sinceSave = 0;

  private readonly renderer: Renderer;
  private readonly loop: Loop;
  private readonly hud: Hud;
  private readonly hub: HubScreen;
  private readonly results: ResultsScreen;
  private readonly modal: Modal;

  constructor(private readonly els: AppElements) {
    this.renderer = new Renderer(els.canvas, els.stage);
    this.renderer.setQuality(resolveQuality());
    this.hud = new Hud(els.hud, () => this.openPause());
    this.hub = new HubScreen(els.screens, () => this.startRun());
    this.results = new ResultsScreen(els.screens, () => this.go('hub'), () => this.startRun());
    this.modal = new Modal(els.overlay);
    this.loop = new Loop({
      step: () => this.step(),
      render: (alpha, realDt) => this.frame(alpha, realDt),
      speed: () => this.simSpeed(),
    });
  }

  get currentScreen(): Screen {
    return this.screen;
  }

  async boot(): Promise<void> {
    const loaded = await loadProfile(Date.now());
    this.profile = loaded.profile;
    if (loaded.backedUpLegacy) console.info('[save] legacy save backed up; starting a fresh profile');
    this.bindLifecycle();
    this.loop.start();
    this.go('hub');
  }

  private go(to: Screen): void {
    assertTransition(this.screen, to);
    this.screen = to;
    this.hub.hide();
    this.results.hide();
    this.hud.hide();
    this.els.stage.dataset.screen = to;
    if (to === 'hub') this.hub.show(this.profile);
    if (to === 'run') this.hud.show();
  }

  private startRun(): void {
    // A fresh seed per run; the sim is deterministic *given* it.
    const seed = (Math.random() * 2 ** 32) >>> 0;
    this.run = createRun(buildRunConfig(this.profile), seed);
    this.paused = false;
    this.pending = {};
    this.loop.resetClock();
    this.go('run');
  }

  private simSpeed(): number {
    if (this.screen !== 'run' || this.paused || !this.run || this.run.outcome) return 0;
    return this.profile.settings.speed;
  }

  private step(): void {
    const run = this.run;
    if (!run || run.outcome) return;
    step(run, SIM_DT, this.pending);
    this.pending = {};
    if (run.outcome) this.endRun(run);
  }

  private frame(alpha: number, realDt: number): void {
    this.renderer.render(this.screen === 'run' || this.screen === 'results' ? this.run : null, alpha, realDt);
    if (this.screen === 'run' && this.run) this.hud.update(this.run);
    this.sinceSave += realDt;
    if (this.sinceSave >= AUTOSAVE_SECONDS) void this.save();
  }

  private endRun(run: RunState): void {
    const wave = run.outcome?.wave ?? run.wave;
    const newRecord = wave > this.profile.records.bestWave;
    this.profile.records.runs++;
    if (newRecord) this.profile.records.bestWave = wave;
    void this.save();
    this.modal.close();
    this.go('results');
    this.results.show(run, newRecord);
  }

  private openPause(): void {
    if (this.screen !== 'run' || this.modal.open) return;
    this.paused = true;
    this.modal.show('Paused', '', [
      { label: 'Retreat', onClick: () => { this.paused = false; this.pending.retreat = true; } },
      { label: 'Resume', primary: true, onClick: () => { this.paused = false; this.loop.resetClock(); } },
    ]);
  }

  /** Close whatever is open. True when something was closed (the back button). */
  private back(): boolean {
    if (this.modal.open) {
      this.modal.close();
      this.paused = false;
      return true;
    }
    if (this.screen === 'run') {
      this.openPause();
      return true;
    }
    return false;
  }

  private async save(): Promise<void> {
    this.sinceSave = 0;
    try {
      await saveProfile(this.profile);
    } catch (err) {
      console.error('[save] write failed', err);
    }
  }

  private bindLifecycle(): void {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        if (this.screen === 'run') this.openPause();
        void this.save();
      } else {
        this.loop.resetClock();
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.back();
    });
    bindNativeLifecycle({ onBack: () => this.back(), onPause: () => this.save() });
  }
}
