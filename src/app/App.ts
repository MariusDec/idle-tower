import {
  clearRunSnapshot, loadProfile, loadRunSnapshot, saveProfile, saveRunSnapshot, snapshotRun,
} from '../meta/save';
import { newProfile, type Profile } from '../meta/profile';
import { buildRunConfig } from '../meta/runConfig';
import {
  autoUlt, automations, draftSeconds, marchOn, maxSpeed, runSpeed, tacticsKey,
} from '../meta/automation';
import { buyNode, canAfford, refundNode } from '../meta/forge';
import { bankRun } from '../meta/results';
import { frameUnlocked, regionUnlocked, toggleRelic } from '../meta/collection';
import { claimAll, claimFeat } from '../meta/feats';
import { offlineEarnings, offlineTier } from '../meta/offline';
import { setPactRank } from '../meta/pacts';
import { STAR_WEB } from '../meta/stars';
import { FORGE } from '../content/forge';
import { ENEMY_BY_ID } from '../content/enemies';
import { BOSS_BY_ID } from '../content/bosses';
import type { BossId } from '../content/types';
import { frameById } from '../content/frames';
import { RELIC_BY_ID } from '../content/relics';
import { formatNumber } from '../core/format';
import { applyInput, createRun, step } from '../sim/run';
import { cardKey } from '../sim/systems/draft';
import { autoUltWanted } from '../sim/systems/ultimate';
import type { DraftOffer, RunState } from '../sim/state';
import { BALANCE } from '../content/balance';
import { Renderer } from '../render/renderer';
import { QualityProbe, readStoredQuality, resolveQuality, storeQuality } from '../render/quality';
import { runRegion } from '../sim/systems/waves';
import { SettingsPanel } from '../ui/settings';
import { Music } from '../audio/music';
import { bench, type BenchOptions, type BenchResult } from './bench';
import { applySettings, onOsMotionChange, type Settings } from './settings';
import { DraftPanel } from '../ui/draft';
import { Hud } from '../ui/hud';
import { HubScreen, type HubView } from '../ui/hub/hub';
import { Modal, type ModalButton } from '../ui/modal';
import { ResultsScreen } from '../ui/results';
import { Toasts } from '../ui/toast';
import { bindNativeLifecycle } from '../platform/native';
import { Loop, SIM_DT } from './loop';
import { Synth } from '../audio/synth';
import { Cues } from '../audio/cues';
import { assertTransition, type Screen } from './screens';

/** Autosave cadence (§12.4), on the wall clock. */
const AUTOSAVE_SECONDS = 30;
/**
 * A gap between frames this long, with the page never hidden (a laptop lid,
 * a frozen tab), is an absence too (§6.1): it pays offline, never a catch-up.
 */
const STALL_SECONDS = 60;
/** The killing blow on a boss plays out slowly (§7.3): wall seconds, at this speed. */
const BOSS_KILL_SLOWMO = { seconds: 0.9, speed: 0.2 };
/** A boss's phase change stops the arena for a beat (§10.3). */
const PHASE_HITSTOP = { seconds: 0.12, speed: 0 };

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
  /** A slow-motion or hit-stop beat on the wall clock: seconds left and the speed meanwhile. */
  private slowMo = { left: 0, speed: 1 };
  /** Wall-clock ms of the last frame, to notice a stall (§6.1). */
  private lastFrame = Date.now();

  private readonly renderer: Renderer;
  private readonly loop: Loop;
  private readonly hud: Hud;
  private readonly hub: HubScreen;
  private readonly results: ResultsScreen;
  private readonly modal: Modal;
  private readonly draft: DraftPanel;
  private readonly toasts: Toasts;
  private readonly synth = new Synth();
  private readonly cues = new Cues(this.synth);
  private readonly music = new Music(this.synth);
  private readonly settings: SettingsPanel;
  /** Once a session, on `'auto'`: may demote the quality tier (docs/performance.md). */
  private readonly probe = new QualityProbe();

  constructor(private readonly els: AppElements) {
    this.renderer = new Renderer(els.canvas, els.stage);
    this.renderer.setQuality(resolveQuality());
    this.hud = new Hud(els.hud, {
      pause: () => this.openPause(),
      ult: () => this.castUltimate(),
      speed: () => this.cycleSpeed(),
      autoUlt: () => this.toggleAutoUlt(),
    });
    this.hub = new HubScreen(els.screens, {
      start: () => this.startRun(),
      buy: (id) => this.buy(id),
      refund: (id) => this.refund(id),
      forgeOpened: () => this.forgeOpened(),
      selectRegion: (index) => this.between(() => {
        if (regionUnlocked(this.profile, index)) this.profile.region = index;
      }),
      toggleRelic: (id) => this.between(() => toggleRelic(this.profile, id)) ?? false,
      selectFrame: (id) => this.between(() => {
        if (frameUnlocked(this.profile, frameById(id))) this.profile.frame = id;
      }),
      claim: (id) => this.claimed(this.between(() => claimFeat(this.profile, id)) ?? 0),
      claimAll: () => this.claimed(this.between(() => claimAll(this.profile)) ?? 0),
      setTactics: (list) => this.between(() => {
        const key = tacticsKey(this.profile);
        if (key !== null) this.profile.tactics[key] = [...list];
      }),
      buyStar: (id) => {
        const bought = this.between(() => STAR_WEB.buy(this.profile, id)) ?? false;
        if (bought) this.cues.purchase();
        return bought;
      },
      setPact: (id, rank) => this.between(() => setPactRank(this.profile, id, rank)) ?? false,
      settings: () => this.openSettings(),
    });
    this.results = new ResultsScreen(els.screens, () => this.leaveResults(), () => this.startRun());
    this.toasts = new Toasts(els.overlay);
    this.draft = new DraftPanel(els.overlay, (i) => this.pick(i), () => this.reroll());
    this.modal = new Modal(els.overlay);
    this.settings = new SettingsPanel(els.overlay, {
      change: (edit, save) => this.changeSettings(edit, save),
      quality: () => ({ pref: readStoredQuality(), tier: this.renderer.quality }),
      setQuality: (pref) => {
        storeQuality(pref);
        // An explicit choice ends the probe for good; Auto starts from the device's guess.
        this.probe.abandon();
        this.renderer.setQuality(resolveQuality());
      },
      reset: () => void this.reset(),
      closed: () => this.settingsClosed(),
    });
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

  /** Dev only: the frame-budget harness (§12.5), during a run. */
  bench(opts?: BenchOptions): Promise<BenchResult> {
    if (!this.run || this.screen !== 'run') return Promise.reject(new Error('bench needs a run'));
    return bench(this.run, this.renderer, opts);
  }

  /** The profile, for the dev console. */
  get currentProfile(): Profile {
    return this.profile;
  }

  async boot(): Promise<void> {
    const loaded = await loadProfile(Date.now());
    this.profile = loaded.profile;
    this.applySettings();
    onOsMotionChange(() => this.applySettings());
    this.music.start();
    if (loaded.backedUpLegacy) console.info('[save] legacy save backed up; starting a fresh profile');
    const resume = await loadRunSnapshot(this.profile);
    this.bindLifecycle();
    this.loop.start();
    this.go('hub');
    // A run the app was killed in resumes at its last wave boundary (§12.4).
    if (resume) this.startRun(resume);
    this.welcomeBack(Date.now());
  }

  /** Run a hub action on the profile, then save. Ignored outside the hub. */
  private between<T>(fn: () => T): T | undefined {
    if (this.screen !== 'hub') return undefined;
    const out = fn();
    void this.save();
    return out;
  }

  /**
   * Offline earnings (§6.3): any absence over a minute since the profile was
   * last seen pays the farm rate, cut and capped by the Offline tier, and a
   * welcome-back card says what it bought.
   */
  private welcomeBack(now: number): void {
    const away = (now - this.profile.lastSeen) / 1000;
    this.profile.lastSeen = now;
    const earned = offlineEarnings(this.profile, away);
    if (!earned) return;
    const before = new Set(FORGE.filter((n) => canAfford(this.profile, n.id)).map((n) => n.id));
    this.profile.shards += earned.shards;
    void this.save();
    this.hub.update();
    const fresh = FORGE.filter((n) => canAfford(this.profile, n.id) && !before.has(n.id)).map((n) => n.name);
    const hours = Math.floor(earned.away / 3600);
    const mins = Math.floor((earned.away % 3600) / 60);
    const gone = hours > 0 ? `${hours} h ${mins} min` : `${mins} min`;
    const body = `You were away ${gone}. The tower gathered ${formatNumber(earned.shards)} shards.`
      + (earned.paid < earned.away ? ` (Night Watch holds ${offlineTier(this.profile)?.capHours ?? 0} hours at most.)` : '')
      + (fresh.length > 0 ? ` Now affordable: ${fresh.slice(0, 4).join(', ')}.` : '');
    if (this.screen === 'run') {
      // Mid-run the pause menu (or the Settings over it) stays where it is:
      // the welcome is a toast on top, and only the pause menu resumes (B4).
      this.paused = true;
      if (!this.settings.open && !this.modal.open) this.openPause();
      this.toasts.show('crystal-cluster', 'Welcome back', `Away ${gone} · +${formatNumber(earned.shards)} shards`);
      return;
    }
    const buttons: ModalButton[] = [{ label: 'Close', onClick: () => {} }];
    if (this.screen === 'hub' && fresh.length > 0) {
      buttons.push({ label: 'Forge', primary: true, onClick: () => this.hub.show(this.profile, 'forge') });
    }
    this.modal.show('Welcome back', body, buttons);
  }

  /** Results → hub: the Forge, or after a first boss kill, the Map and its light (§7.3). */
  private leaveResults(): void {
    const boss = this.profile.ceremony;
    this.profile.ceremony = null;
    if (boss !== null) void this.save();
    this.go('hub', boss !== null ? 'map' : 'forge', boss !== null);
    if (boss !== null && BOSS_BY_ID[boss as BossId]?.finale) this.ending();
  }

  /**
   * The Act 1 ending (§7.1): the light has reached the Blight Heart. It
   * waits on the Map while the light spreads, then says what it took.
   */
  private ending(): void {
    const r = this.profile.records;
    const days = Math.max(1, Math.round((Date.now() - this.profile.createdAt) / 86_400_000));
    const body = 'The Blight is broken. Its heart goes dark, and the light runs out to the edge of the world. '
      + `It took ${formatNumber(r.runs)} runs, ${formatNumber(r.kills)} enemies and ${days} day${days === 1 ? '' : 's'}. `
      + 'The tower stands. Act 1 is complete. '
      + 'But the stars have come out, and something stirs below. Act 2 begins: take on Pacts for Starlight, '
      + 'light the Constellations, and descend into the Abyss.';
    window.setTimeout(() => this.modal.show('The light returns', body, [
      { label: 'The stars', onClick: () => this.hub.show(this.profile, 'stars') },
      { label: 'Onward', primary: true, onClick: () => {} },
    ]), 2400);
  }

  private go(to: Screen, view: HubView = 'home', spread = false): void {
    assertTransition(this.screen, to);
    this.screen = to;
    this.hub.hide();
    this.results.hide();
    this.hud.hide();
    this.toasts.clear();
    this.els.stage.dataset.screen = to;
    if (to === 'hub') this.hub.show(this.profile, view, spread);
    if (to === 'run') this.hud.show();
  }

  /** Start a fresh run, or carry on with `resumed` from its snapshot. */
  private startRun(resumed?: RunState): void {
    // A fresh seed per run; the sim is deterministic *given* it.
    const seed = (Math.random() * 2 ** 32) >>> 0;
    this.run = resumed ?? createRun(buildRunConfig(this.profile), seed);
    // Run again past a first kill skips the Map's ceremony rather than
    // owing it to a later run, whose results would hold auto-restart for it.
    // Under Frontier March nothing holds auto-restart, so the ceremony waits
    // for the player's next visit to the Map instead (§6.2).
    if (!automations(this.profile).has('frontier-march')) this.profile.ceremony = null;
    this.paused = false;
    this.shownDraft = null;
    this.newCards = [];
    this.snapshotWave = this.run.wave;
    this.slowMo = { left: 0, speed: 1 };
    this.draft.hide();
    this.loop.resetClock();
    this.go('run');
    this.hud.setSpeed(maxSpeed(this.profile), runSpeed(this.profile));
    this.hud.setAutoUlt(automations(this.profile).has('auto-ult'), this.profile.settings.autoUlt);
    if (resumed) this.openPause(`The run resumes at wave ${resumed.wave}.`);
  }

  private simSpeed(): number {
    const run = this.run;
    if (this.screen !== 'run' || this.paused || !run || run.outcome) return 0;
    const speed = (this.devSpeed ?? runSpeed(this.profile)) * (this.slowMo.left > 0 ? this.slowMo.speed : 1);
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
          seconds: draftSeconds(this.profile),
          seen: (key) => seen.has(key),
          rerolls: run.rerolls,
          swapFor: run.swap ? run.weapons[0]?.id ?? null : null,
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
    // results screen (§4.6), see `frame`. The Autocaster casts on the same
    // rule as the idle bot (§6.2).
    const ult = autoUlt(this.profile) && autoUltWanted(run, BALANCE.automation.autoUltCrowd);
    step(run, SIM_DT, ult ? { ult } : undefined);
    // A new wave: snapshot on this step boundary (§12.4).
    if (run.wave > this.snapshotWave && !run.outcome) {
      this.snapshotWave = run.wave;
      const snapshot = snapshotRun(run, this.profile);
      this.write(() => saveRunSnapshot(snapshot));
    }
  }

  private frame(alpha: number, realDt: number): void {
    const now = Date.now();
    if (now - this.lastFrame > STALL_SECONDS * 1000) this.absent(now);
    this.lastFrame = now;
    const run = this.screen === 'run' || this.screen === 'results' ? this.run : null;
    if (run) {
      if (this.screen === 'run') this.announce(run);
      this.cues.play(run.events);
      this.renderer.consume(run);
      run.events.length = 0;
    }
    this.slowMo.left = Math.max(0, this.slowMo.left - realDt);
    this.tune(run);
    if (this.screen === 'run') this.measure(realDt);
    this.toasts.tick(realDt);
    this.renderer.render(run, alpha, realDt);
    if (this.screen === 'run' && run) {
      this.syncDraft(run, realDt);
      this.hud.update(run);
      if (run.outcome?.kind === 'fell' && this.renderer.fallDone) this.endRun(run);
    }
    // Auto-restart waits while a card (welcome back) is up, so a run never starts under it.
    if (this.screen === 'results' && !this.modal.open) this.results.tick(realDt);
    this.sinceSave += realDt;
    if (this.sinceSave >= AUTOSAVE_SECONDS) void this.save();
  }

  /** The music's mood (§10.4): the hub's drift, a run's walk, a boss fight's churn. */
  private tune(run: RunState | null): void {
    if (!run || this.screen !== 'run') {
      this.music.set('hub', this.profile.region);
      return;
    }
    const boss = run.boss !== null && run.boss.killedIn === null;
    this.music.set(boss ? 'boss' : 'run', runRegion(run).index);
  }

  /** Feed the quality probe a real frame: at 1×, unpaused, with no draft slowing the arena. */
  private measure(realDt: number): void {
    if (this.probe.finished) return;
    // A tier the player chose is theirs: the probe stands down for the session.
    if (readStoredQuality() !== 'auto') {
      this.probe.abandon();
      return;
    }
    const speed = this.simSpeed();
    if (speed === 0) return;
    if (speed > 1) {
      this.probe.abandon();
      return;
    }
    const drop = this.probe.tick(realDt, this.renderer.quality);
    if (drop) {
      console.info(`[quality] frames over budget: ${this.renderer.quality} → ${drop}`);
      this.renderer.setQuality(drop);
    }
  }

  /**
   * What the app makes of this frame's sim events: the Bestiary's card on an
   * enemy's first sight (§4.3), a relic found, and the beats that bend time
   * (the slow killing blow on a boss, a hit-stop on its phase change).
   */
  private announce(run: RunState): void {
    for (const ev of run.events) {
      switch (ev.kind) {
        case 'firstSight':
          if (!this.profile.seenEnemies.includes(ev.enemy)) {
            const def = ENEMY_BY_ID[ev.enemy];
            this.toasts.show(def.icon, `New · ${def.name}`, def.text, 'enemy');
          }
          break;
        case 'relicDrop': {
          const def = RELIC_BY_ID[ev.relic];
          this.toasts.show(def.icon, `Relic · ${def.name}`, def.text, 'relic');
          break;
        }
        case 'bossKill':
          this.slowMo = { left: BOSS_KILL_SLOWMO.seconds, speed: BOSS_KILL_SLOWMO.speed };
          break;
        case 'bossPhase':
          this.slowMo = { left: PHASE_HITSTOP.seconds, speed: PHASE_HITSTOP.speed };
          break;
        default:
          break;
      }
    }
  }

  private endRun(run: RunState): void {
    const summary = bankRun(this.profile, run, this.newCards, runSpeed(this.profile));
    const marched = marchOn(this.profile, summary);
    // The banked profile lands before the snapshot is cleared: killed between
    // the two, the snapshot is stale (its run count is behind) and is dropped
    // on boot, so the run is paid exactly once.
    void this.save();
    this.write(() => clearRunSnapshot());
    this.modal.close();
    this.draft.hide();
    this.shownDraft = null;
    this.go('results');
    // A first boss kill holds the results for its ceremony: no auto-restart
    // past it, unless Frontier March is carrying the next run onward.
    const ceremony = this.profile.ceremony !== null;
    const restart = automations(this.profile).has('auto-restart') && (!ceremony || marched);
    this.results.show(summary, restart, ceremony ? 'Map' : 'Forge');
    if (summary.unlocks.length > 0) this.cues.unlock();
  }

  /** A feat's reward paid: its chime, and the shards passed back to the view. */
  private claimed(shards: number): number {
    if (shards > 0) this.cues.claim();
    return shards;
  }

  private buy(id: string): boolean {
    if (this.screen !== 'hub' || !buyNode(this.profile, id)) return false;
    this.cues.purchase();
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
      { label: 'Settings', onClick: () => this.openSettings() },
      { label: 'Resume', primary: true, onClick: () => { this.paused = false; this.loop.resetClock(); } },
    ]);
  }

  /** The settings (§10.1): from the hub's gear, or from the pause menu mid-run. */
  private openSettings(): void {
    if (this.screen === 'run') this.paused = true;
    this.settings.show(this.profile, this.screen === 'hub');
  }

  /** Back from the settings: a run returns to its pause menu, still paused. */
  private settingsClosed(): void {
    void this.save();
    if (this.screen === 'run') {
      this.paused = false;
      this.openPause();
    }
  }

  private changeSettings(edit: (s: Settings) => void, save = true): void {
    edit(this.profile.settings);
    this.applySettings();
    if (save) void this.save();
  }

  private applySettings(): void {
    applySettings(this.profile.settings, { synth: this.synth, renderer: this.renderer, root: document.documentElement });
  }

  /**
   * Erase the profile (P9's reset), between runs only: a fresh profile and no
   * run snapshot are written, then the page reloads onto them.
   */
  private async reset(): Promise<void> {
    if (this.screen !== 'hub') return;
    this.profile = newProfile(Date.now());
    this.write(() => clearRunSnapshot());
    await this.save();
    window.location.reload();
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
    if (this.settings.open) {
      this.settings.close();
      return true;
    }
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
    profile.lastSeen = Date.now();
    this.write(() => saveProfile(profile));
    return this.writes;
  }

  private bindLifecycle(): void {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        void this.hidden();
      } else {
        this.absent(Date.now());
      }
    });
    // Browsers start audio only from a gesture: the first one anywhere wakes it.
    const wake = (): void => this.synth.start();
    document.addEventListener('pointerdown', wake);
    document.addEventListener('keydown', (e) => {
      wake();
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
    bindNativeLifecycle({
      onBack: () => this.back(),
      onPause: () => this.hidden(),
      onResume: () => this.absent(Date.now()),
    });
  }

  /** Going away (§6.1): the run pauses, and the profile is stamped and saved. */
  private hidden(): Promise<void> {
    // A hidden page's frames are not real frames: a probe mid-measurement gives up.
    if (this.probe.measuring) this.probe.abandon();
    if (this.screen === 'run' && !this.settings.open) this.openPause();
    return this.save();
  }

  /**
   * Back from an absence (§6.1), however it was noticed: the page shown
   * again, the native resume, or a stalled frame. The loop drops the gap
   * rather than fast-forwarding the sim, and anything over a minute since
   * the profile was last stamped pays offline. Safe to call twice: the
   * first call stamps the profile.
   */
  private absent(now: number): void {
    this.loop.resetClock();
    this.lastFrame = now;
    this.welcomeBack(now);
  }

  /** The HUD's Autocaster switch (§6.2). */
  private toggleAutoUlt(): void {
    this.profile.settings.autoUlt = !this.profile.settings.autoUlt;
    this.hud.setAutoUlt(automations(this.profile).has('auto-ult'), this.profile.settings.autoUlt);
    void this.save();
  }
}
