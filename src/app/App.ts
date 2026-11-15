import { ANOMALY_BY_ID } from '../content/anomalies';
import {
  clearRunSnapshot, loadProfile, loadResume, saveProfile, saveRunSnapshot, snapshotRun, type SnapshotBurn,
} from '../meta/save';
import { newProfile, type Profile } from '../meta/profile';
import { exportProfile, listBackups, pushBackup, readBackup } from '../meta/save/transfer';
import { copyText, pickTextFile, saveTextFile } from '../platform/files';
import { buildRunConfig } from '../meta/runConfig';
import {
  autoUlt, automations, draftSeconds, foremanBuy, marchOn, maxSpeed, runSpeed, tacticsScopes, togglePin,
} from '../meta/automation';
import { buyNode, canAfford, isBuyable, levelOf, nodeCost, refundNode, toggleKeystone, towerTier } from '../meta/forge';
import { bankRun, buildOf } from '../meta/results';
import { buildList, foremanLine, statsList } from '../ui/build';
import { cursedSlots, frameUnlocked, frontier, regionUnlocked, selectedFrame, swapCursed, toggleCursed, toggleRelic, trophyCount } from '../meta/collection';
import { cursedCard } from '../ui/cursed';
import { curseLine } from '../content/cursed';
import { claimAll, claimFeat } from '../meta/feats';
import { offlineEarnings, offlineTier, storedRates } from '../meta/offline';
import { emptyTally, storedWant, tallyWave, waveEngaged, type BurnTally } from '../meta/storedLight';
import { setPactRank } from '../meta/pacts';
import { chooseTrial, toggleTrim, wornTrims } from '../meta/trials';
import { explainersFor, markExplained, unreadExplainers } from '../meta/explainers';
import { STAR_WEB } from '../meta/stars';
import { FORGE, FORGE_BY_ID } from '../content/forge';
import { ENEMY_BY_ID } from '../content/enemies';
import { BOSS_BY_ID } from '../content/bosses';
import type { BossId, RelicId } from '../content/types';
import { frameById } from '../content/frames';
import { RELIC_BY_ID } from '../content/relics';
import { TRIAL_BY_ID } from '../content/trials';
import { formatNumber } from '../core/format';
import { applyInput, createRun, step } from '../sim/run';
import { banishable, cardKey, holdsAnomaly } from '../sim/systems/draft';
import { autoUltWanted } from '../sim/systems/ultimate';
import { cardBadges } from '../sim/suggest';
import type { DraftOffer, RunState } from '../sim/state';
import { BALANCE } from '../content/balance';
import { Renderer } from '../render/renderer';
import { QualityScaler, readStoredQuality, resolveQuality, storeQuality } from '../render/quality';
import { runRegion } from '../sim/systems/waves';
import { SettingsPanel } from '../ui/settings';
import { Music } from '../audio/music';
import { bench, type BenchOptions, type BenchResult } from './bench';
import { applySettings, onOsMotionChange, type Settings } from './settings';
import { DraftPanel } from '../ui/draft';
import { bindBuildPeek } from '../ui/peek';
import { Hud } from '../ui/hud';
import { HubScreen, type HubView } from '../ui/hub/hub';
import { Modal, type ModalButton } from '../ui/modal';
import { explainerBody } from '../ui/explainer';
import { ResultsScreen } from '../ui/results';
import { Toasts } from '../ui/toast';
import { bindNativeLifecycle } from '../platform/native';
import { Loop, SIM_DT } from './loop';
import { Synth } from '../audio/synth';
import { Cues } from '../audio/cues';
import { assertTransition, type Screen } from './screens';
import { bindZoom } from '../ui/zoom';
import { bindClaim, type ClaimTarget } from '../ui/claim';
import { RiftPanel } from '../ui/rift';
import { RIFT_BY_ID } from '../content/rifts';

/** Autosave cadence (§12.4), on the wall clock. */
const AUTOSAVE_SECONDS = 30;
/** The least wall-clock time between two run snapshots taken for card picks. */
const PICK_SNAPSHOT_MS = 2000;
/** One press of the zoom buttons: this much closer, or further. */
const ZOOM_STEP = 1.4;
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
  /** Drafts banked when this run started (U2's Opening); 0 for a resumed run. */
  private opening = 0;
  /** True once the player touched the Opening: it no longer takes itself. */
  /** The wave the last run snapshot was taken at. */
  private snapshotWave = 0;
  /** Wall-clock ms of the last run snapshot, whatever took it. */
  private snapshotAt = 0;
  /** A card was taken since the last snapshot: the next one is owed. */
  private runDirty = false;
  /** What `data-arena` on the stage says now: the CSS glows pause while stopped. */
  private arena: 'stopped' | 'live' = 'live';
  /** Dev only: a sim speed that overrides the unlocked one. */
  private devSpeed: number | null = null;
  /** Writes go out in order, so a late snapshot never lands after its clear. */
  private writes: Promise<void> = Promise.resolve();
  /** A slow-motion or hit-stop beat on the wall clock: seconds left and the speed meanwhile. */
  private slowMo = { left: 0, speed: 1 };
  /** Wall-clock ms of the last frame, to notice a stall (§6.1). */
  private lastFrame = Date.now();
  /**
   * Stored Light (plans/late-game/01 §3.3): wall-clock ms of the player's last
   * touch or key on the run screen. Nothing the app does by itself (the draft
   * timer, the Opening, the Autocaster, auto-restart) stamps it.
   */
  private lastTouch = 0;
  /** The run's base shards so far, by waves played and left alone. */
  private burn: BurnTally = emptyTally();
  /** `run.shards` and the wall-clock ms when the current wave began. */
  private waveShards = 0;
  private waveWall = 0;
  /** The pool as the run began (plus anything a mid-run absence stored): the gauge's full width. */
  private poolAtStart = 0;
  /** The pool ran dry this run: its toast has been told. */
  private poolDry = false;

  private readonly renderer: Renderer;
  private readonly loop: Loop;
  private readonly hud: Hud;
  private readonly hub: HubScreen;
  private readonly results: ResultsScreen;
  private readonly modal: Modal;
  private readonly draft: DraftPanel;
  private readonly riftPanel: RiftPanel;
  private readonly toasts: Toasts;
  private readonly synth = new Synth();
  private readonly cues = new Cues(this.synth);
  private readonly music = new Music(this.synth);
  private readonly settings: SettingsPanel;
  /** On `'auto'`: moves the quality tier with the frame rate (docs/performance.md). */
  private readonly scaler = new QualityScaler();
  /** A dev `bench()` is running: it owns the quality tier. */
  private benching = false;

  constructor(private readonly els: AppElements) {
    this.renderer = new Renderer(els.canvas, els.stage);
    this.renderer.setQuality(resolveQuality());
    this.hud = new Hud(els.hud, {
      pause: () => this.openPause(),
      ult: () => this.castUltimate(),
      speed: () => this.cycleSpeed(),
      autoUlt: () => this.toggleAutoUlt(),
      zoomIn: () => this.renderer.camera.zoomBy(ZOOM_STEP),
      zoomOut: () => this.renderer.camera.zoomBy(1 / ZOOM_STEP),
      zoomFit: () => this.renderer.camera.fitView(),
      rift: () => this.tapRift(),
      reliquary: () => this.claimReliquary(this.run?.reliquaries[0]?.id),
    });
    // Manual zoom (camera-and-fog §5): during a run only; the framing is a
    // setting, saved with the next autosave rather than on every wheel tick.
    bindZoom(els.canvas, {
      zoomBy: (factor) => this.renderer.camera.zoomBy(factor, true),
      settle: () => this.renderer.camera.settle(),
      active: () => this.screen === 'run',
    });
    // Rifts (plans/late-game/02 §2) and reliquaries (plans/late-game/03 §3.4): a
    // one-finger tap near one claims it, the nearer of two; the HUD chips are the other path.
    bindClaim<'rift' | 'reliquary'>(els.canvas, {
      active: () => this.screen === 'run' && this.simSpeed() > 0,
      targets: () => {
        const run = this.run;
        if (!run) return [];
        const out: ClaimTarget<'rift' | 'reliquary'>[] = run.reliquaries.map((r) => ({ kind: 'reliquary', id: r.id, x: r.x, y: r.y }));
        if (run.rift?.phase === 'shown') out.push({ kind: 'rift', x: run.rift.x, y: run.rift.y });
        return out;
      },
      toScreen: (x, y) => this.renderer.camera.worldToScreen(x, y),
      claim: (t) => (t.kind === 'rift' ? this.tapRift() : this.claimReliquary(t.id)),
    });
    this.renderer.camera.onFraming = (framing) => this.changeSettings((s) => { s.framing = framing; }, false);
    this.hub = new HubScreen(els.screens, {
      start: () => this.startRun(),
      buy: (id) => this.buy(id),
      refund: (id) => this.refund(id),
      pin: (id) => this.between(() => togglePin(this.profile, id)) ?? false,
      toggleKeystone: (id) => this.between(() => toggleKeystone(this.profile, id)) ?? false,
      forgeOpened: () => this.forgeOpened(),
      selectRegion: (index) => this.between(() => {
        if (regionUnlocked(this.profile, index)) this.profile.region = index;
      }),
      trial: (id) => {
        if (this.between(() => chooseTrial(this.profile, id))) this.startRun();
      },
      toggleRelic: (id) => this.between(() => toggleRelic(this.profile, id)) ?? false,
      toggleCursed: (id) => this.between(() => toggleCursed(this.profile, id)) ?? false,
      compareCursed: (out, id, done) => this.compareCursed(out, id, done),
      selectFrame: (id) => this.between(() => {
        if (frameUnlocked(this.profile, frameById(id))) this.profile.frame = id;
        this.dressTower();
      }),
      toggleTrim: (trim) => this.between(() => {
        toggleTrim(this.profile, trim);
        this.dressTower();
      }),
      claim: (id) => this.claimed(this.between(() => claimFeat(this.profile, id)) ?? 0),
      claimAll: () => this.claimed(this.between(() => claimAll(this.profile)) ?? 0),
      setTactics: (key, lists) => this.between(() => {
        if (!tacticsScopes(this.profile).includes(key)) return;
        if (lists) {
          this.profile.tactics[key] = [...lists.order];
          this.profile.tacticsNever[key] = [...lists.never];
        } else {
          delete this.profile.tactics[key];
          delete this.profile.tacticsNever[key];
        }
      }),
      buyStar: (id) => {
        const bought = this.between(() => STAR_WEB.buy(this.profile, id)) ?? false;
        if (bought) this.cues.purchase();
        return bought;
      },
      setPact: (id, rank) => this.between(() => setPactRank(this.profile, id, rank)) ?? false,
      settings: () => this.openSettings(),
      explain: (view, asked, wait) => this.explain(view, asked, wait),
    });
    this.results = new ResultsScreen(els.screens, () => this.leaveResults(), () => this.startRun(), (id, done) => this.wearFromResults(id, done));
    this.toasts = new Toasts(els.overlay);
    this.draft = new DraftPanel(
      els.overlay, (i) => this.pick(i), () => this.reroll(), () => this.takeAll(), (i) => this.banish(i),
      () => {},
    );
    this.riftPanel = new RiftPanel(els.overlay, (i) => this.chooseRift(i));
    this.modal = new Modal(els.overlay);
    // Hold a build chip for its card: the HUD strip, the pause menu, the results.
    for (const host of [els.hud, els.overlay, els.screens]) bindBuildPeek(host, els.overlay);
    this.settings = new SettingsPanel(els.overlay, {
      change: (edit, save) => this.changeSettings(edit, save),
      quality: () => ({ pref: readStoredQuality(), tier: this.renderer.quality }),
      setQuality: (pref) => {
        storeQuality(pref);
        // An explicit choice idles the scaler; Auto starts from the device's guess and measures afresh.
        this.scaler.reset();
        this.renderer.setQuality(resolveQuality());
      },
      reset: () => void this.replace(newProfile(Date.now())),
      copySave: () => copyText(exportProfile(this.profile)),
      saveFile: () => saveTextFile(`tower-save-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.txt`, exportProfile(this.profile)),
      pickFile: () => pickTextFile(),
      backups: () => listBackups(),
      readBackup: (slot) => readBackup(slot),
      replace: (profile) => void this.replace(profile),
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
    // The bench picks its own tier: the scaler must not move it mid-measurement.
    this.benching = true;
    return bench(this.run, this.renderer, opts).finally(() => {
      this.benching = false;
      this.scaler.reset();
    });
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
    if (loaded.fresh === 'corrupt') {
      console.warn(loaded.restoredFrom !== null
        ? `[save] restored the backup from ${new Date(loaded.restoredFrom).toISOString()}`
        : '[save] no backup would read; starting a fresh profile');
    }
    const resume = await loadResume(this.profile);
    this.bindLifecycle();
    this.loop.start();
    this.go('hub');
    // A run the app was killed in resumes at its last wave boundary (§12.4).
    if (resume) this.startRun(resume.run, resume.burn);
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
    // Stored Light (plans/late-game/01): kept back for runs to burn. The Foreman buys from the instant part only.
    this.profile.storedLight += earned.stored;
    if (earned.stored > 0) {
      this.poolAtStart += earned.stored;
      this.poolDry = false;
      this.cues.storedSwell();
    }
    // The Foreman (N7) spends what landed on the wishlist, between runs only.
    const bought = this.screen === 'run' ? [] : foremanBuy(this.profile);
    if (bought.length > 0) this.dressTower();
    void this.save();
    this.hub.update();
    const fresh = FORGE.filter((n) => canAfford(this.profile, n.id) && !before.has(n.id)).map((n) => n.name);
    const hours = Math.floor(earned.away / 3600);
    const mins = Math.floor((earned.away % 3600) / 60);
    const gone = hours > 0 ? `${hours} h ${mins} min` : `${mins} min`;
    const rates = storedRates(this.profile);
    const stored = earned.stored > 0 && rates
      ? `, and stored ${formatNumber(earned.stored)} as Stored Light. Play to spend it: ×${rates.engaged} while you play, ×${rates.handsOff} left alone.`
      : '.';
    const holds = this.foremanHeld();
    // The cap note names the longest part that applies: from Night Watch III, the store's.
    const tier = offlineTier(this.profile);
    const capHours = tier?.stored?.capHours ?? tier?.capHours ?? 0;
    const body = `You were away ${gone}. The tower gathered ${formatNumber(earned.shards)} shards${stored}`
      + (earned.away > capHours * 3600 ? ` (Night Watch holds ${capHours} hours at most.)` : '')
      + (bought.length > 0 ? ` The Foreman bought ${foremanLine(bought)}.` : '')
      + (holds !== null ? ` The Foreman's next pin needs ${formatNumber(holds)}: Stored Light holds it.` : '')
      + (fresh.length > 0 ? ` Now affordable: ${fresh.slice(0, 4).join(', ')}.` : '');
    if (this.screen === 'run') {
      // Mid-run the pause menu (or the Settings over it) stays where it is:
      // the welcome is a toast on top, and only the pause menu resumes (B4).
      this.paused = true;
      if (!this.settings.open && !this.modal.open) this.openPause();
      const more = earned.stored > 0 ? ` · +${formatNumber(earned.stored)} stored` : '';
      this.toasts.show('crystal-cluster', 'Welcome back', `Away ${gone} · +${formatNumber(earned.shards)} shards${more}`);
      return;
    }
    const buttons: ModalButton[] = [{ label: 'Close', onClick: () => {} }];
    const play = this.screen === 'hub' && earned.stored > 0;
    if (this.screen === 'hub' && fresh.length > 0) {
      buttons.push({ label: 'Forge', primary: !play, onClick: () => this.hub.show(this.profile, 'forge') });
    }
    // A night stored: the way to spend it is a run at the frontier.
    if (play) buttons.push({ label: 'Play', primary: true, onClick: () => this.playFrontier() });
    this.modal.show('Welcome back', body, buttons);
  }

  /**
   * The Foreman's next pin's price, when the shards fall short of it but
   * Stored Light covers the gap (plans/late-game/01 §3.4); else null.
   */
  private foremanHeld(): number | null {
    const p = this.profile;
    if (p.storedLight <= 0 || !automations(p).has('foreman')) return null;
    const id = p.wishlist.find((x) => FORGE_BY_ID[x] && isBuyable(p, x));
    if (id === undefined) return null;
    const cost = nodeCost(FORGE_BY_ID[id], levelOf(p, id));
    const short = cost - p.shards;
    return short > 0 && p.storedLight >= short ? cost : null;
  }

  /** The welcome-back's Play: a run at the frontier, to spend what the night stored. */
  private playFrontier(): void {
    if (this.screen !== 'hub') return;
    this.profile.region = frontier(this.profile).index;
    this.startRun();
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
    this.dressTower();
    this.hub.hide();
    this.results.hide();
    this.hud.hide();
    this.toasts.clear();
    this.els.stage.dataset.screen = to;
    if (to === 'hub') this.hub.show(this.profile, view, spread);
    if (to === 'run') this.hud.show();
  }

  /**
   * What the tower wears (N2): its tier from the Forge's rings, a light per
   * trophy (N4), the Trials' trims the player wears (N5), and on the hub the selected frame's
   * weapon. Set whenever the profile may have changed under it.
   */
  private dressTower(): void {
    const p = this.profile;
    this.renderer.setTower({ tier: towerTier(p), trophies: trophyCount(p), trims: wornTrims(p) }, selectedFrame(p).startingWeapon);
  }

  /** Start a fresh run, or carry on with `resumed` from its snapshot. */
  private startRun(resumed?: RunState, burn?: SnapshotBurn | null): void {
    // A fresh seed per run; the sim is deterministic *given* it.
    const seed = (Math.random() * 2 ** 32) >>> 0;
    this.run = resumed ?? createRun({ ...buildRunConfig(this.profile), arena: this.renderer.stageOval() }, seed);
    // Run again past a first kill skips the Map's ceremony rather than
    // owing it to a later run, whose results would hold auto-restart for it.
    // Under Frontier March nothing holds auto-restart, so the ceremony waits
    // for the player's next visit to the Map instead (§6.2).
    if (!automations(this.profile).has('frontier-march')) this.profile.ceremony = null;
    this.paused = false;
    this.shownDraft = null;
    this.newCards = [];
    this.opening = resumed ? 0 : this.run.pendingDrafts;
    this.snapshotWave = this.run.wave;
    this.runDirty = false;
    this.slowMo = { left: 0, speed: 1 };
    // Stored Light's tally (plans/late-game/01 §3.3): carried over from the snapshot, if it kept one.
    this.burn = burn ? { engaged: burn.engaged, handsOff: burn.handsOff } : emptyTally();
    this.waveShards = burn ? burn.waveShards : this.run.shards;
    this.waveWall = Date.now();
    this.poolAtStart = this.profile.storedLight;
    this.poolDry = false;
    this.draft.hide();
    this.riftPanel.hide();
    this.loop.resetClock();
    this.go('run');
    this.hud.setSpeed(maxSpeed(this.profile), runSpeed(this.profile));
    this.hud.setAutoUlt(automations(this.profile).has('auto-ult'), this.profile.settings.autoUlt);
    if (resumed) this.openPause(`The run resumes at wave ${resumed.wave}.`);
    // A fresh run is covered at once, before wave 2: a Trial or a Pact cost something to enter.
    else this.snapshot(this.run);
    const trial = this.run.trial ? TRIAL_BY_ID[this.run.trial] : null;
    if (trial) this.toasts.show(trial.icon, `Trial · ${trial.name}`, trial.text);
  }

  private simSpeed(): number {
    const run = this.run;
    if (this.screen !== 'run' || this.paused || !run || run.outcome) return 0;
    // A rift being chosen stops the arena, with no timer (plans/late-game/02 §2).
    if (run.rift?.phase === 'choosing') return 0;
    let speed = (this.devSpeed ?? runSpeed(this.profile)) * (this.slowMo.left > 0 ? this.slowMo.speed : 1);
    // While a rift waits, a watching player gets its window in wall seconds; a hands-off screen keeps its speed.
    if (run.rift?.phase === 'shown' && this.engaged()) speed = Math.min(speed, BALANCE.rifts.engagedCap);
    if (run.draft) {
      // The game never waits (§4.5), except for the first draft it ever shows.
      if (!this.profile.tutorial.firstDraft || this.draft.stopped) return 0;
      return BALANCE.draft.slowMotion * speed;
    }
    return speed;
  }

  /**
   * The results' Wear (plans/late-game/03 §2): into the cursed slot, or the
   * compare sheet if it is full. Saved at once, as a hub change is.
   */
  private wearFromResults(id: RelicId, done: (worn: boolean) => void): void {
    if (this.screen !== 'results') return;
    const out = this.profile.cursedWorn[0] as RelicId | undefined;
    if (this.profile.cursedWorn.length >= cursedSlots(this.profile) && out) {
      this.compareCursed(out, id, () => done(this.profile.cursedWorn.includes(id)), () => this.screen === 'results');
      return;
    }
    const worn = toggleCursed(this.profile, id);
    if (worn) void this.save();
    done(worn);
  }

  /**
   * The compare sheet (plans/late-game/03 §2): the cursed slot is full, so
   * the worn relic sits above the new one, each with its rank and deepest
   * floor; one Swap.
   */
  private compareCursed(out: RelicId, id: RelicId, done: () => void, allowed = (): boolean => this.screen === 'hub'): void {
    const body = document.createElement('div');
    body.className = 'cursed-compare';
    const label = (text: string): HTMLElement => {
      const h = document.createElement('p');
      h.className = 'cursed-compare-label';
      h.textContent = text;
      return h;
    };
    body.append(
      label('Worn'), cursedCard(this.profile, RELIC_BY_ID[out], { worn: true }),
      label('New'), cursedCard(this.profile, RELIC_BY_ID[id], { worn: false }),
    );
    this.modal.show('Swap the curse?', body, [
      { label: 'Keep', onClick: () => {} },
      {
        label: 'Swap', primary: true, onClick: () => {
          if (!allowed() || !swapCursed(this.profile, out, id)) return;
          void this.save();
          done();
        },
      },
    ]);
  }

  /**
   * Claim reliquary `id` (plans/late-game/03 §3.4): the canvas tap or the HUD
   * chip. It is input, so it is in the replay. Both are trusted pointer
   * events, so the capture listener has already stamped `lastTouch` (engaged).
   * The Autocaster never calls this.
   */
  private claimReliquary(id: number | undefined): void {
    const run = this.run;
    if (id === undefined || !run || this.screen !== 'run' || run.outcome) return;
    applyInput(run, { claim: id });
    this.runDirty = true;
  }

  /** Keep the reliquary chip in step with the run: the soonest to fade drains it. */
  private syncReliquaries(run: RunState): void {
    const r = run.reliquaries[0];
    this.hud.setReliquary(r ? {
      left: Math.max(0, Math.min(1, (r.until - run.time) / Math.max(0.001, r.until - r.at))),
      count: run.reliquaries.length,
    } : null);
  }

  /** A touch this recent counts as a watching player (plans/late-game/01 §3.3). */
  private engaged(): boolean {
    return Date.now() - this.lastTouch <= BALANCE.offline.engagedSeconds * 1000;
  }

  /** Open the rift on the field: the canvas tap or the HUD chip. Never on a stopped arena, nor over a draft. */
  private tapRift(): void {
    const run = this.run;
    if (!run || this.screen !== 'run' || run.rift?.phase !== 'shown' || run.draft || this.simSpeed() === 0) return;
    applyInput(run, { tapRift: true });
    this.runDirty = true;
  }

  /** Take choice `index` of the open rift, or leave it (−1). */
  private chooseRift(index: number): void {
    const run = this.run;
    if (!run || this.screen !== 'run' || this.paused || run.rift?.phase !== 'choosing') return;
    applyInput(run, { chooseRift: index });
    this.runDirty = true;
    this.loop.resetClock();
  }

  /** Keep the rift's chip and panel in step with the run (plans/late-game/02 §2). */
  private syncRift(run: RunState): void {
    const r = run.rift;
    const shown = r?.phase === 'shown';
    this.hud.setRift(shown ? {
      rarity: RIFT_BY_ID[r.id].rarity,
      left: Math.max(0, Math.min(1, (r.closesAt - run.time) / Math.max(0.001, r.closesAt - r.at))),
      blocked: run.draft !== null,
    } : null);
    const choosing = r?.phase === 'choosing';
    if (choosing) this.riftPanel.show(run);
    else if (this.riftPanel.open) this.riftPanel.hide();
    this.music.duck(choosing);
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
        const opening = this.opening > 1 && run.draftsOpened <= this.opening;
        this.draft.show({
          level: run.draft.level,
          cards: run.draft.cards,
          suggested: run.draft.suggested,
          timed: this.profile.tutorial.firstDraft,
          // A hand with an anomaly gets the full time, the Tactician's too (plans/late-game/04 §3).
          seconds: holdsAnomaly(run.draft.cards) ? Math.max(draftSeconds(this.profile), BALANCE.anomalies.seconds) : draftSeconds(this.profile),
          seen: (key) => seen.has(key),
          rerolls: run.rerolls,
          banishes: run.banishes,
          banishable: run.draft.cards.map((c) => banishable(run, c)),
          banked: run.pendingDrafts,
          opening: opening ? { at: run.draftsOpened, of: this.opening } : null,
          autoTake: null,
          badges: run.draft.cards.map((c) => cardBadges(run, c)),
          anomalies: Object.fromEntries(run.weapons.filter((w) => w.anomaly).map((w) => [w.id, w.anomaly])),
          anomalyFirst: this.profile.anomalies.found.length + this.profile.anomalies.glimpsed.length === 0,
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
    if (!run.draft || this.paused) return;
    const tick = this.draft.tick(realDt);
    if (tick === 'timeout') this.pick(run.draft.suggested);
    else if (tick === 'take-all') this.takeAll();
  }

  /** Take a card now, between steps: the first draft is taken with the arena stopped. */
  private pick(index: number): void {
    const run = this.run;
    if (!run?.draft || this.paused || this.screen !== 'run') return;
    applyInput(run, { pick: index });
    this.runDirty = true;
    if (!this.profile.tutorial.firstDraft) {
      this.profile.tutorial.firstDraft = true;
      this.loop.resetClock();
      void this.save();
    }
  }

  /** Take every banked draft's suggestion at once (U2). The cards it took are seen: they are on the tower. */
  private takeAll(): void {
    const run = this.run;
    if (!run?.draft || this.paused || this.screen !== 'run') return;
    const from = run.events.length;
    applyInput(run, { takeAll: true });
    this.runDirty = true;
    const seen = new Set(this.profile.seenCards);
    for (const ev of run.events.slice(from)) {
      if (ev.kind !== 'picked' || ev.card.kind === 'fallback' || seen.has(cardKey(ev.card))) continue;
      seen.add(cardKey(ev.card));
      this.newCards.push(cardKey(ev.card));
    }
    this.profile.seenCards = [...seen];
  }

  private reroll(): void {
    const run = this.run;
    if (!run?.draft || this.paused || this.screen !== 'run') return;
    applyInput(run, { reroll: true });
    this.runDirty = true;
  }

  /** Strike card `index` from the draft for this run (N1). */
  private banish(index: number): void {
    const run = this.run;
    if (!run?.draft || this.paused || this.screen !== 'run') return;
    applyInput(run, { banish: index });
    this.runDirty = true;
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
    const ult = autoUlt(this.profile) && autoUltWanted(run);
    step(run, SIM_DT, ult ? { ult } : undefined);
    // A new wave: tally the one just ended, and snapshot on this step boundary (§12.4).
    if (run.wave > this.snapshotWave && !run.outcome) {
      this.snapshotWave = run.wave;
      this.tallyWave(run);
      this.snapshot(run);
    }
  }

  /**
   * Serialise the run now and queue its write. Any step boundary will do,
   * not only a wave start: the run carries its own RNG and input lands
   * between steps, so a snapshot resumes exactly.
   */
  private snapshot(run: RunState): void {
    this.snapshotAt = Date.now();
    this.runDirty = false;
    const snapshot = snapshotRun(run, this.profile, { ...this.burn, waveShards: this.waveShards });
    this.write(() => saveRunSnapshot(snapshot));
  }

  /**
   * Stored Light (plans/late-game/01 §3.3): the wave since `waveWall` goes to
   * the played bucket if a touch landed in it or in the window before now.
   */
  private tallyWave(run: RunState): void {
    const now = Date.now();
    tallyWave(this.burn, run.shards - this.waveShards, waveEngaged(this.lastTouch, this.waveWall, now));
    this.waveShards = run.shards;
    this.waveWall = now;
  }

  /** The HUD's Stored Light chip and gauge: what the pool has left once this run's bonus is reserved. */
  private showStored(run: RunState): void {
    const rates = storedRates(this.profile);
    if (!rates || this.poolAtStart <= 0) {
      this.hud.setStored(0, 0, 0, false);
      return;
    }
    const now = Date.now();
    const played = waveEngaged(this.lastTouch, this.waveWall, now);
    const tally = { ...this.burn };
    tallyWave(tally, run.shards - this.waveShards, played);
    const left = Math.max(0, this.profile.storedLight - storedWant(this.profile, tally));
    this.hud.setStored(left / this.poolAtStart, played ? rates.engaged : rates.handsOff, left, played);
    if (left <= 0 && !this.poolDry) {
      this.poolDry = true;
      this.toasts.show('crystal-cluster', 'Stored Light spent', 'The rest of the run earns its own shards.');
      this.cues.storedDry();
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
    this.toasts.tick(realDt);
    // A stopped arena draws until what still moves has finished, then rests
    // the GPU until something changes (plans/android-gpu-crash.md §1).
    const stopped = this.screen === 'run' && this.simSpeed() === 0;
    this.setArena(stopped ? 'stopped' : 'live');
    if (!(stopped && this.renderer.settled)) {
      const t0 = performance.now();
      this.renderer.render(run, alpha, realDt);
      if (this.screen === 'run') this.measure(realDt, performance.now() - t0);
    }
    if (this.screen === 'run' && run) {
      // Cards taken since the last snapshot: one more, at most every couple of seconds.
      if (this.runDirty && !run.outcome && now - this.snapshotAt >= PICK_SNAPSHOT_MS) this.snapshot(run);
      this.syncDraft(run, realDt);
      this.syncRift(run);
      this.syncReliquaries(run);
      this.hud.update(run);
      this.showStored(run);
      this.hud.setZoomed(this.renderer.camera.zoomedIn, this.renderer.camera.atClose);
      if (run.outcome?.kind === 'fell' && this.renderer.fallDone) this.endRun(run);
      // Boss Rush won (N8): the sim held the last kill's beat; the results follow.
      if (run.outcome?.kind === 'cleared') this.endRun(run);
    }
    // Auto-restart waits while a card (welcome back) is up, so a run never starts under it.
    if (this.screen === 'results' && !this.modal.open) this.results.tick(realDt);
    this.sinceSave += realDt;
    if (this.sinceSave >= AUTOSAVE_SECONDS) void this.save();
  }

  /** Mark the stage stopped or live, touching the DOM only on a change. */
  private setArena(arena: 'stopped' | 'live'): void {
    if (arena === this.arena) return;
    this.arena = arena;
    this.els.stage.dataset.arena = arena;
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

  /** Feed the quality scaler a real frame: its wall time and the ms spent drawing it. */
  private measure(realDt: number, drawMs: number): void {
    // A tier the player chose is theirs: the scaler stands by.
    if (this.benching || readStoredQuality() !== 'auto') return;
    // A paused arena draws next to nothing: its frames say nothing about a busy one.
    if (this.simSpeed() === 0) {
      this.scaler.reset();
      return;
    }
    const from = this.renderer.quality;
    const to = this.scaler.tick(realDt, drawMs, from);
    if (to) {
      console.info(`[quality] ${from} → ${to}`);
      this.renderer.setQuality(to);
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
        case 'eliteSpawn':
          if (ev.champion) this.toasts.show('vertical-banner', 'A Champion comes', 'Slay it for a relic.', 'relic');
          break;
        case 'reliquary':
          // Taught by the toast (plans/late-game/03 §2), as the Champion's is; the first says where to look.
          this.toasts.show('locked-chest', 'A reliquary', ev.first ? 'Tap the chest, or the chip by your ultimate, before it fades.' : 'Tap it before it fades.', 'relic');
          break;
        case 'secret':
          // A stir (plans/late-game/05 §2): a quiet toast, nothing else changes. A find is the renderer's gold banner.
          if (ev.stage === 'stir') this.toasts.show('all-seeing-eye', 'Something stirred', 'A line is written in the Recipe Book.', 'gold');
          break;
        case 'anomaly': {
          // Taken (plans/late-game/04 §2): the toast names it; the renderer flashes the mount.
          const def = ANOMALY_BY_ID[ev.anomaly];
          this.toasts.show(def.icon, `Anomaly · ${def.name}`, def.rule, 'relic');
          break;
        }
        case 'reliquaryClaim': {
          const def = RELIC_BY_ID[ev.relic];
          this.toasts.show(def.icon, `Cursed · ${def.name}`, `${def.text} ${curseLine(def)}`, 'relic');
          break;
        }
        case 'riftAppear':
          // The First Tear teaches itself (plans/late-game/02 §2): a toast, never an arena stop.
          if (ev.id === 'first-tear') this.toasts.show(RIFT_BY_ID[ev.id].icon, 'A rift!', 'Tap it before it closes.', 'relic');
          break;
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
    // The last part-wave goes to its bucket like the others (plans/late-game/01 §3.3).
    this.tallyWave(run);
    const summary = bankRun(this.profile, run, this.newCards, runSpeed(this.profile), this.burn);
    this.burn = emptyTally();
    this.poolAtStart = 0;
    const marched = marchOn(this.profile, summary);
    // The banked profile lands before the snapshot is cleared: killed between
    // the two, the snapshot is stale (its run count is behind) and is dropped
    // on boot, so the run is paid exactly once.
    void this.save();
    this.runDirty = false;
    this.write(() => clearRunSnapshot());
    // A rolling backup at every run's end (U12): the last few profiles, should a write go wrong.
    const kept = this.profile;
    this.write(() => pushBackup(kept));
    this.modal.close();
    this.draft.hide();
    this.riftPanel.hide();
    this.hud.setRift(null);
    this.hud.setReliquary(null);
    this.music.duck(false);
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
    this.dressTower();
    void this.save();
    return true;
  }

  private refund(id: string): boolean {
    if (this.screen !== 'hub' || !refundNode(this.profile, id)) return false;
    this.dressTower();
    void this.save();
    return true;
  }

  /**
   * A hub view's explainers (§7.1): the unread ones when it opens, all of
   * them when its "?" is pressed. They count as read once dismissed, so a
   * card that pushes one aside (welcome back, the ending) leaves it for the
   * next visit; none is told over another card, or after the view has gone.
   */
  private explain(view: HubView, asked: boolean, wait: number): void {
    if (wait > 0) {
      window.setTimeout(() => this.explain(view, asked, 0), wait);
      return;
    }
    if (this.screen !== 'hub' || this.hub.current !== view || this.modal.open) return;
    const defs = asked ? explainersFor(this.profile, view) : unreadExplainers(this.profile, view);
    if (defs.length === 0) return;
    this.modal.show(defs[0].title, explainerBody(defs), [{
      label: 'Got it',
      primary: true,
      onClick: () => {
        markExplained(this.profile, defs.map((d) => d.id));
        void this.save();
      },
    }]);
  }

  /** The Forge opened. True the very first time, when it teaches (§7.1). */
  private forgeOpened(): boolean {
    if (this.profile.tutorial.forgeIntro) return false;
    this.profile.tutorial.forgeIntro = true;
    void this.save();
    return true;
  }

  private openPause(note = ''): void {
    if (this.screen !== 'run' || this.modal.open) return;
    this.paused = true;
    // The full build and the tower's stats (U3): what the HUD strip only hints at.
    const body = document.createElement('div');
    body.className = 'pause-body';
    if (note) {
      const p = document.createElement('p');
      p.className = 'modal-body';
      p.textContent = note;
      body.append(p);
    }
    if (this.run) body.append(buildList(buildOf(this.run)), statsList(this.run));
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
   * Replace the profile, between runs only: P9's reset (a fresh one), or
   * U12's import and restore. It and no run snapshot are written, then the
   * page reloads onto them.
   */
  private async replace(profile: Profile): Promise<void> {
    if (this.screen !== 'hub') return;
    this.profile = profile;
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
    // Stored Light's "played" (plans/late-game/01 §3.3): any touch or key on the
    // run screen, caught before any handler, so no input needs listing.
    const touched = (e: Event): void => {
      if (this.screen === 'run' && e.isTrusted) this.lastTouch = Date.now();
    };
    document.addEventListener('pointerdown', touched, true);
    document.addEventListener('keydown', touched, true);
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
    // A hidden page's frames are not real frames: the scaler's window is dropped.
    this.scaler.reset();
    if (this.screen === 'run' && !this.settings.open) this.openPause();
    // Android may kill a backgrounded app outright: the run is kept as it stands.
    if (this.screen === 'run' && this.run && !this.run.outcome) this.snapshot(this.run);
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
