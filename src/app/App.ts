import {
  clearRunSnapshot, loadProfile, loadRunSnapshot, saveProfile, saveRunSnapshot, snapshotRun,
} from '../meta/save';
import type { Profile } from '../meta/profile';
import { buildRunConfig } from '../meta/runConfig';
import { automations, maxSpeed, runSpeed } from '../meta/automation';
import { buyNode, refundNode } from '../meta/forge';
import { bankRun } from '../meta/results';
import { applyInput, createRun, step } from '../sim/run';
import { cardKey } from '../sim/systems/draft';
import type { DraftOffer, RunState } from '../sim/state';
import { BALANCE } from '../content/balance';
import { Renderer } from '../render/renderer';
import { resolveQuality } from '../render/quality';
import { DraftPanel } from '../ui/draft';
import { Hud } from '../ui/hud';
import { HubScreen, type HubView } from '../ui/hub/hub';
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
  private sinceSave = 0;
  /** The offer the draft panel is showing, so a new one is noticed. */
  private shownDraft: DraftOffer | null = null;
  /** Cards stamped NEW this run, for the results screen's discoveries. */
  private newCards: string[] = [];
  /** The wave the last run snapshot was taken at. */
  private snapshotWave = 0;
  /** Dev only: a sim speed that overrides the unlocked one. */
  private devSpeed: number | null = null;
  /** Writes go out in order, so a late snapshot never lands after its clear. */
  private writes: Promise<void> = Promise.resolve();

  private readonly renderer: Renderer;
  private readonly loop: Loop;
  private readonly hud: Hud;
  private readonly hub: HubScreen;
  private readonly results: ResultsScreen;
  private readonly modal: Modal;
  private readonly draft: DraftPanel;

  constructor(private readonly els: AppElements) {
    this.renderer = new Renderer(els.canvas, els.stage);
    this.renderer.setQuality(resolveQuality());
    this.hud = new Hud(els.hud, () => this.openPause(), () => this.castUltimate(), () => this.cycleSpeed());
    this.hub = new HubScreen(
      els.screens,
      () => this.startRun(),
      { buy: (id) => this.buy(id), refund: (id) => this.refund(id) },
      () => this.forgeOpened(),
    );
    this.results = new ResultsScreen(els.screens, () => this.go('hub', 'forge'), () => this.startRun());
    this.draft = new DraftPanel(els.overlay, (i) => this.pick(i), () => this.reroll());
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

  /** The live run, for the dev console and stress tests. Never written through. */
  get currentRun(): RunState | null {
    return this.run;
  }

  /** The profile, for the dev console. */
  get currentProfile(): Profile {
    return this.profile;
  }

  async boot(): Promise<void> {
    const loaded = await loadProfile(Date.now());
    this.profile = loaded.profile;
    if (loaded.backedUpLegacy) console.info('[save] legacy save backed up; starting a fresh profile');
    const resume = await loadRunSnapshot(this.profile);
    this.bindLifecycle();
    this.loop.start();
    this.go('hub');
    // A run the app was killed in resumes at its last wave boundary (§12.4).
    if (resume) this.startRun(resume);
  }

  private go(to: Screen, view: HubView = 'home'): void {
    assertTransition(this.screen, to);
    this.screen = to;
    this.hub.hide();
    this.results.hide();
    this.hud.hide();
    this.els.stage.dataset.screen = to;
    if (to === 'hub') this.hub.show(this.profile, view);
    if (to === 'run') this.hud.show();
  }

  /** Start a fresh run, or carry on with `resumed` from its snapshot. */
  private startRun(resumed?: RunState): void {
    // A fresh seed per run; the sim is deterministic *given* it.
    const seed = (Math.random() * 2 ** 32) >>> 0;
    this.run = resumed ?? createRun(buildRunConfig(this.profile), seed);
    this.paused = false;
    this.shownDraft = null;
    this.newCards = [];
    this.snapshotWave = this.run.wave;
    this.draft.hide();
    this.loop.resetClock();
    this.go('run');
    this.hud.setSpeed(maxSpeed(this.profile), runSpeed(this.profile));
    if (resumed) this.openPause(`The run resumes at wave ${resumed.wave}.`);
  }

  private simSpeed(): number {
    const run = this.run;
    if (this.screen !== 'run' || this.paused || !run || run.outcome) return 0;
    const speed = this.devSpeed ?? runSpeed(this.profile);
    if (run.draft) {
      // The game never waits (§4.5), except for the first draft it ever shows.
      if (!this.profile.tutorial.firstDraft) return 0;
      return BALANCE.draft.slowMotion * speed;
    }
    return speed;
  }

  /** The HUD's speed toggle (§6.2): steps through what is unlocked. */
  private cycleSpeed(): void {
    const max = maxSpeed(this.profile);
    const next = (runSpeed(this.profile) % max) + 1;
    this.profile.settings.speed = next as 1 | 2 | 3;
    this.devSpeed = null;
    this.hud.setSpeed(max, next);
  }

  /** Keep the draft panel in step with the run's open offer. */
  private syncDraft(run: RunState, realDt: number): void {
    if (run.draft !== this.shownDraft) {
      this.shownDraft = run.draft;
      if (run.draft) {
        const seen = new Set(this.profile.seenCards);
        this.draft.show({
          level: run.draft.level,
          cards: run.draft.cards,
          suggested: run.draft.suggested,
          timed: this.profile.tutorial.firstDraft,
          seen: (key) => seen.has(key),
          rerolls: run.rerolls,
        });
        for (const c of run.draft.cards) {
          const key = cardKey(c);
          if (!seen.has(key) && c.kind !== 'fallback') this.newCards.push(key);
          seen.add(key);
        }
        this.profile.seenCards = [...seen];
      } else {
        this.draft.hide();
      }
    }
    if (run.draft && !this.paused && this.draft.tick(realDt)) this.pick(run.draft.suggested);
  }

  /** Take a card now, between steps: the first draft is taken with the arena stopped. */
  private pick(index: number): void {
    const run = this.run;
    if (!run?.draft || this.paused || this.screen !== 'run') return;
    applyInput(run, { pick: index });
    if (!this.profile.tutorial.firstDraft) {
      this.profile.tutorial.firstDraft = true;
      this.loop.resetClock();
      void this.save();
    }
  }

  private reroll(): void {
    const run = this.run;
    if (!run?.draft || this.paused || this.screen !== 'run') return;
    applyInput(run, { reroll: true });
  }

  private castUltimate(): void {
    const run = this.run;
    // Not while the arena is stopped (paused, or the first draft waiting for
    // a pick): a Nova there would land on a frozen field.
    if (!run || this.simSpeed() === 0) return;
    applyInput(run, { ult: true });
  }

  private step(): void {
    const run = this.run;
    if (!run || run.outcome) return;
    // Input lands between steps (`applyInput`); a fall plays out before the
    // results screen (§4.6), see `frame`.
    step(run, SIM_DT);
    // A new wave: snapshot on this step boundary (§12.4).
    if (run.wave > this.snapshotWave && !run.outcome) {
      this.snapshotWave = run.wave;
      const snapshot = snapshotRun(run, this.profile);
      this.write(() => saveRunSnapshot(snapshot));
    }
  }

  private frame(alpha: number, realDt: number): void {
    const run = this.screen === 'run' || this.screen === 'results' ? this.run : null;
    if (run) {
      this.renderer.consume(run);
      run.events.length = 0;
    }
    this.renderer.render(run, alpha, realDt);
    if (this.screen === 'run' && run) {
      this.syncDraft(run, realDt);
      this.hud.update(run);
      if (run.outcome?.kind === 'fell' && this.renderer.fallDone) this.endRun(run);
    }
    if (this.screen === 'results') this.results.tick(realDt);
    this.sinceSave += realDt;
    if (this.sinceSave >= AUTOSAVE_SECONDS) void this.save();
  }

  private endRun(run: RunState): void {
    const summary = bankRun(this.profile, run, this.newCards);
    this.write(() => clearRunSnapshot());
    void this.save();
    this.modal.close();
    this.draft.hide();
    this.shownDraft = null;
    this.go('results');
    this.results.show(summary, automations(this.profile).has('auto-restart'));
  }

  private buy(id: string): boolean {
    if (this.screen !== 'hub' || !buyNode(this.profile, id)) return false;
    void this.save();
    return true;
  }

  private refund(id: string): boolean {
    if (this.screen !== 'hub' || !refundNode(this.profile, id)) return false;
    void this.save();
    return true;
  }

  /** The Forge opened. True the very first time, when it teaches (§7.1). */
  private forgeOpened(): boolean {
    if (this.profile.tutorial.forgeIntro) return false;
    this.profile.tutorial.forgeIntro = true;
    void this.save();
    return true;
  }

  private openPause(body = ''): void {
    if (this.screen !== 'run' || this.modal.open) return;
    this.paused = true;
    this.modal.show('Paused', body, [
      { label: 'Retreat', onClick: () => this.retreat() },
      { label: 'Resume', primary: true, onClick: () => { this.paused = false; this.loop.resetClock(); } },
    ]);
  }

  /** A retreat banks at once, exactly like a fall (§4.2), even mid-draft. */
  private retreat(): void {
    const run = this.run;
    this.paused = false;
    if (!run || run.outcome || this.screen !== 'run') return;
    applyInput(run, { retreat: true });
    this.endRun(run);
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

  /** Queue a write behind every earlier one. */
  private write(fn: () => Promise<void>): void {
    this.writes = this.writes.then(fn).catch((err: unknown) => console.error('[save] write failed', err));
  }

  private save(): Promise<void> {
    this.sinceSave = 0;
    const profile = this.profile;
    this.write(() => saveProfile(profile));
    return this.writes;
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
      if (e.key === ' ' && this.screen === 'run') {
        e.preventDefault();
        this.castUltimate();
      }
      // Dev only: any sim speed on 1/2/3, unlocked or not.
      if (import.meta.env.DEV && (e.key === '1' || e.key === '2' || e.key === '3')) {
        this.devSpeed = Number(e.key);
      }
    });
    bindNativeLifecycle({ onBack: () => this.back(), onPause: () => this.save() });
  }
}
