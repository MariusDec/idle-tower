import { BOSS_BY_ID } from '../content/bosses';
import { ANOMALY_BY_ID } from '../content/anomalies';
import { EVOLUTION_BY_ID } from '../content/evolutions';
import { FUSION_BY_ID } from '../content/fusions';
import { ENEMY_BY_ID } from '../content/enemies';
import { LAST_LIGHT, regionByIndex } from '../content/regions';
import { RUSH_STAGES } from '../content/rush';
import { formatDuration } from '../core/format';
import type { RunState } from '../sim/state';
import { Camera, stageOval } from './camera';
import { Effects } from './effects';
import { FX, GROUND, INK, RARITY, lighten, mix, setPaletteMode, withAlpha, type PaletteMode } from './palette';
import { paintDark, paintGates, paintGround, paintRim, paintSky, type WorldBox } from './painters/arena';
import { STRATUM_BY_ID, stratumTitle, type StratumDef } from '../content/strata';
import { ruleLoad } from '../sim/strata';
import { BALANCE } from '../content/balance';
import type { StratumId } from '../content/types';
import { EnemyPainter, type GuestLook } from './painters/enemies';
import { paintProjectiles } from './painters/projectiles';
import { paintArsenal, paintFires, paintRunes, paintStatus } from './painters/arsenal';
import { paintAegis, paintBoss, paintCourt, paintFacets, paintPlates, paintPools, paintRings, paintShots } from './painters/bosses';
import { mirrorFacets, phasesOf } from '../sim/systems/boss';
import { SECRET_BY_ID } from '../content/secrets';
import { runRegion } from '../sim/systems/waves';
import { mountOf } from '../sim/systems/arms';
import { WEAPON_BY_ID } from '../content/weapons';
import { PLAIN_LOOK, paintRangeRing, paintTower, type Mount, type TowerLook } from './painters/tower';
import type { FrameId, WeaponId } from '../content/types';
import { frameById } from '../content/frames';
import { formAccent, type FormPaint } from './painters/form';
import { QUALITY, type QualityTier } from './quality';
import { paintRift } from './painters/rift';
import { CURSE_COLOR, paintReliquaries } from './painters/reliquary';
import { RIFT_BY_ID } from '../content/rifts';
import { ARENA, type Oval } from '../content/arena';
import { context2dOptions } from './canvasMode';
import { cachedGradient, clearGlows } from './glow';

/** Sim ticks the crystal stays flared after a contact hit. */
const HURT_TICKS = 12;
/** Seconds the fall animation runs before the results screen (§4.6). */
export const FALL_SECONDS = 1.2;
/** HP fraction below which the edge vignette starts. */
const VIGNETTE_FROM = 0.35;
/** The hub's backdrop tower (N2): the selected frame's starting weapon, facing up, at its tier's level. */
const IDLE_AIM = -Math.PI / 2;
/** Seconds the boss intro's letterbox and name hold (§4.3: reuse the legacy intro). */
const INTRO_SECONDS = 2.8;
/** Seconds a banner (a boss phase, REGION CLEARED) holds. */
const BANNER_SECONDS = 2.4;
const DISPLAY_FONT = 'Oswald, "Arial Narrow", sans-serif';
/** What the Abyss's ground darkens toward (§9). */
const ABYSS_DARK = INK['950'];
/** How far the sky past the light dims toward the ink (plans/visual-identity.md §7.3); the Abyss's, further. */
const SKY_DIM = 0.4;
const ABYSS_SKY_DIM = 0.7;
/** The boss's edge marker (camera-and-fog §5.3): inset from the stage's edge, and its size, CSS px. */
const MARKER_INSET = 26;
const MARKER_SIZE = 11;
/** Wall-clock seconds the gates take to slide round the rim between waves (plans/late-game/08 §3.1). */
const GATE_SLIDE = 0.6;
/** Final Form's beat (plans/late-game/07 §5.2): wall-clock seconds after the evolve spotlight. */
const FORM_BEAT = 0.35;
/** Seconds the crown grows in; under reduced motion, it fades in. */
const FORM_GROW = 0.8;
const FORM_FADE = 0.4;
/** Sunrise draws the dark back (render only). */
const SUNRISE_DARK = 0.85;

/**
 * The scale enemy sprites are baked at: the view's, rounded up to a step of
 * √2. A pinch or the light easing out never rebakes every frame; a sprite is
 * at most √2 finer than it is drawn, so a close-up stays sharp.
 */
function spriteScale(scale: number): number {
  if (!(scale > 0) || !Number.isFinite(scale)) return 1;
  return 2 ** (Math.ceil(Math.log2(scale) * 2) / 2);
}

/** A line of display text over the arena, in screen space. */
interface Banner {
  title: string;
  line: string;
  t: number;
  life: number;
  /** The intro letterboxes; a banner does not. */
  letterbox: boolean;
  tone: 'blood' | 'gold';
}

/**
 * The renderer (§12.3). Reads a `RunState`, never writes it. Everything it
 * owns is presentation: baked backgrounds, sprite caches, effects.
 */
export class Renderer {
  readonly camera: Camera;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly effects = new Effects();
  private readonly enemies = new EnemyPainter();
  private tier: QualityTier = 'high';
  private clock = 0;
  private lastRun: RunState | null = null;
  /** Wall-clock seconds since the tower fell; null while it stands. */
  private fallT: number | null = null;
  private banner: Banner | null = null;
  /** The gates as drawn, sliding toward the sim's (plans/late-game/08): from, to, and how far along. */
  private gates: { from: number[]; to: number[]; t: number } | null = null;
  /** Each stratum's guests' look, built once. */
  private readonly guests = new Map<StratumId, GuestLook>();
  /** Reduced motion (the OS's or the player's): the letterbox is the moving part, so it goes. */
  private reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  /** The settings' text size, for the banners and damage numbers. */
  private textScale = 1;
  /** The palette the canvas wears, and its baked sprites were drawn in. */
  private palette: PaletteMode = 'standard';
  /** The sky's last stop: the region's last light, as the page's ground wears it (set by the app). */
  private horizon: string = LAST_LIGHT['ashen-fields'];
  /** What the tower wears (N2), and the hub's mount: the profile's, set by the app. */
  private look: TowerLook = PLAIN_LOOK;
  private idle: readonly Mount[] = [{ id: 'arcane-bolt', level: 1, aim: IDLE_AIM }];
  /** A setting or the run changed since the last frame drawn: the picture is stale. */
  private dirty = true;
  /** The camera's `version` the last frame was drawn at. */
  private drawnView = -1;
  /** Final Form's beat, waiting on the wall clock (§5.2), and the clock time its crown began to grow (−∞: grown). */
  private formBeat: { at: number; frame: FrameId } | null = null;
  private formAt: number | null = null;
  /** Frames whose Final Form the profile has seen: the first per frame letterboxes (set by the app). */
  private formsSeen: ReadonlySet<string> = new Set();

  constructor(canvas: HTMLCanvasElement, host: HTMLElement) {
    this.ctx = canvas.getContext('2d', context2dOptions(false))!;
    this.camera = new Camera(canvas);
    this.camera.setHost(host);
    // A GPU reset (often on a return from the background) can blank every
    // baked canvas. Chrome restores the main canvas itself; the bakes are
    // dropped so they repaint, and the next frame draws in full.
    canvas.addEventListener('contextlost', () => console.warn('[canvas] context lost'));
    canvas.addEventListener('contextrestored', () => {
      console.info('[canvas] context restored');
      clearGlows();
      this.enemies.clear();
      this.dirty = true;
    });
  }

  setQuality(tier: QualityTier): void {
    this.tier = tier;
    this.dirty = true;
    this.camera.setDprCap(QUALITY[tier].dprCap);
    this.effects.setQuality(tier);
  }

  /** The light's shape for the stage as it is now: what a new run takes (`RunConfig.arena`). */
  stageOval(): Oval {
    const t = this.camera.transform;
    return stageOval(t.cssWidth, t.cssHeight);
  }

  /** The player's motion settings (reduced motion, screen shake). */
  setMotion(reduced: boolean, shake: boolean): void {
    this.reducedMotion = reduced;
    this.dirty = true;
    this.camera.setMotion(reduced, shake);
  }

  /**
   * The settings' colours (standard or colourblind-safe). The baked enemy
   * sprites hold the old colours, so they rebake on the next frame.
   */
  setPalette(mode: PaletteMode): void {
    if (mode === this.palette) return;
    this.palette = mode;
    this.dirty = true;
    setPaletteMode(mode);
    this.enemies.clear();
    clearGlows();
  }

  /**
   * The sky's horizon (plans/visual-identity.md §7.3): the region's last
   * light, the same colour the page's ground ends on, so the hub's glass and
   * the run share one sky.
   */
  setHorizon(color: string): void {
    if (color === this.horizon) return;
    this.horizon = color;
    this.dirty = true;
  }

  /** The settings' text size, applied to text painted on the canvas. */
  setTextScale(scale: number): void {
    this.textScale = scale;
    this.dirty = true;
    this.effects.setTextScale(scale);
  }

  /**
   * The tower's look from the profile (N2): its tier, trophies and trims,
   * and the frame whose starting weapon the hub's tower mounts, at the tier's level.
   */
  setTower(look: TowerLook, weapon: WeaponId): void {
    this.look = look;
    this.dirty = true;
    this.idle = [{ id: weapon, level: Math.min(5, look.tier), aim: IDLE_AIM }];
  }

  /** The frames whose Final Form the profile has (plans/late-game/07): a repeat's banner has no letterbox. */
  setFormsSeen(frames: Iterable<string>): void {
    this.formsSeen = new Set(frames);
  }

  get quality(): QualityTier {
    return this.tier;
  }

  /**
   * True when another frame would draw the same picture: nothing set since
   * the last one, the camera at rest, no effects or banner left, no fall
   * playing. The app stops drawing a stopped arena once this holds.
   */
  get settled(): boolean {
    return !this.dirty && this.camera.version === this.drawnView && this.camera.still
      && this.effects.idle && this.banner === null && (this.fallT === null || this.fallDone)
      && this.formBeat === null && !this.formGrowing;
  }

  /** True while a crown is still growing in. */
  private get formGrowing(): boolean {
    return this.formAt !== null && this.clock - this.formAt < FORM_GROW;
  }

  /** True once the fall animation has played out. */
  get fallDone(): boolean {
    return this.fallT !== null && this.fallT >= FALL_SECONDS;
  }

  /**
   * Switch to `run` if it is not the one on screen: drop the old run's
   * effects and fall state. Both `consume` and `render` call it, so the first
   * frame of a new run never reads the previous run's tower.
   */
  private attach(run: RunState | null): void {
    if (run === this.lastRun) return;
    this.lastRun = run;
    this.dirty = true;
    this.effects.clear();
    this.fallT = null;
    this.banner = null;
    this.gates = null;
    // A run resumed in its Final Form (a snapshot) wears the crown at once, with no ceremony.
    this.formBeat = null;
    this.formAt = run && run.form.wave !== null ? -Infinity : null;
  }

  /** A stratum's guests' look (plans/late-game/08 §2), or null outside the strata. */
  private guestLook(s: StratumDef | null): GuestLook | null {
    if (!s) return null;
    let g = this.guests.get(s.id);
    if (!g) {
      g = { key: s.id, tint: s.tint, mix: BALANCE.strata.guestMix, natives: new Set(s.natives) };
      this.guests.set(s.id, g);
    }
    return g;
  }

  /**
   * The gates to draw now: the sim's, reached by sliding each arch the short
   * way round over `GATE_SLIDE` s when they turn (at once under reduced motion,
   * or when their number changes).
   */
  private slideGates(run: RunState, realDt: number): number[] {
    const target = [...(ruleLoad(run).gates ?? [])];
    const g = this.gates;
    if (!g || g.to.length !== target.length || this.reducedMotion) {
      this.gates = { from: target, to: target, t: 1 };
      return target;
    }
    if (target.some((a, i) => Math.abs(a - g.to[i]) > 1e-6)) {
      g.from = this.drawnGates(g);
      g.to = target;
      g.t = 0;
    }
    g.t = Math.min(1, g.t + realDt / GATE_SLIDE);
    return this.drawnGates(g);
  }

  private drawnGates(g: { from: number[]; to: number[]; t: number }): number[] {
    const k = g.t * g.t * (3 - 2 * g.t);
    return g.to.map((b, i) => {
      const a = g.from[i] ?? b;
      const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
      return a + d * k;
    });
  }

  private showBanner(title: string, line: string, tone: Banner['tone'], letterbox = false): void {
    this.banner = { title, line, t: 0, life: letterbox ? INTRO_SECONDS : BANNER_SECONDS, letterbox, tone };
  }

  /** Turn `run`'s pending sim events into effects. The caller clears the list. */
  consume(run: RunState): void {
    this.attach(run);
    // Final Form's banner replaces the evolve's, never stacks on it (§5.2).
    const forming = run.events.some((e) => e.kind === 'finalForm');
    for (const ev of run.events) {
      switch (ev.kind) {
        case 'hit':
          this.effects.hitSparks(ev.x, ev.y, ev.crit ? FX.gold : FX.arcane, ev.crit);
          if (ev.crit) this.effects.critNumber(ev.x, ev.y, ev.amount);
          break;
        case 'kill':
          this.effects.deathBurst(ev.x, ev.y, ENEMY_BY_ID[ev.enemy].color, ev.radius);
          this.effects.xpMote(ev.x, ev.y);
          break;
        case 'chain':
          this.effects.lightning(ev.points);
          break;
        case 'levelUp':
          this.effects.levelUp(run.stats.radius);
          break;
        case 'nova':
          this.effects.nova(run.stats.radius, ev.radius);
          this.camera.shake(10);
          this.camera.zoomPunch();
          break;
        case 'picked': {
          // A new weapon: a flash where its mount just appeared.
          if (ev.card.kind === 'weapon' && ev.card.level === 1) {
            const w = run.weapons.find((x) => x.id === ev.card.id);
            const o = w ? mountOf(run, w) : { x: 0, y: 0 };
            this.effects.pulse(o.x, o.y, run.stats.radius * 0.5, FX.gold);
          }
          break;
        }
        case 'towerHit': {
          const d = Math.hypot(ev.x, ev.y) || 1;
          const wall = run.stats.radius;
          this.effects.wallHit((ev.x / d) * wall, (ev.y / d) * wall);
          this.camera.shake(3);
          break;
        }
        case 'revive':
          // Second Wind: the light flares back out of the crystal.
          this.effects.pulse(0, 0, run.stats.radius * 2.5, FX.gold);
          this.effects.levelUp(run.stats.radius);
          this.camera.zoomPunch();
          break;
        case 'fell':
          this.fallT = 0;
          this.effects.towerFall(run.stats.radius);
          this.camera.shake(24);
          this.camera.zoomPunch();
          break;
        case 'pulse':
          // Whiteout's storm pulses where it stands, with the anomaly's split (plans/late-game/04 §4).
          if (ev.x !== undefined && ev.y !== undefined) {
            this.effects.ring(ev.x, ev.y, 12, ev.radius, withAlpha(FX.frost, 0.7), 0.4, 8);
            if (QUALITY[this.tier].additive) this.effects.ring(ev.x + 1.5, ev.y, 12, ev.radius, withAlpha(FX.ember, 0.25), 0.4, 3);
          } else {
            this.effects.ring(0, 0, run.stats.radius, ev.radius, withAlpha(FX.frost, 0.7), 0.4, 10);
          }
          break;
        case 'mend':
          this.effects.ring(ev.x, ev.y, 10, ev.radius, withAlpha(FX.nature, 0.55), 0.5, 4);
          break;
        case 'split':
          this.effects.spray(ev.x, ev.y, FX.arcane, 10, 180, 3);
          break;
        case 'eliteSpawn':
          this.effects.ring(ev.x, ev.y, 20, ev.champion ? 160 : 90, withAlpha(FX.gold, 0.8), ev.champion ? 0.9 : 0.6, ev.champion ? 8 : 5);
          if (ev.champion) this.camera.shake(6);
          break;
        case 'eliteKill':
          this.effects.spray(ev.x, ev.y, FX.gold, 24, 260, 4, 120);
          this.camera.shake(5);
          break;
        case 'fury':
          this.effects.ring(ev.x, ev.y, 10, ev.radius, withAlpha(FX.blood, 0.7), 0.5, 6);
          break;
        case 'relicDrop':
          this.effects.ring(ev.x, ev.y, 10, 120, withAlpha(FX.arcane, 0.9), 0.8, 6);
          this.effects.spray(ev.x, ev.y, FX.arcane, 30, 220, 5, 160);
          break;
        case 'bossArrive': {
          const def = BOSS_BY_ID[ev.boss];
          // In its other form (plans/late-game/05) the banner names the form: the sighting.
          const form = run.boss?.form ? SECRET_BY_ID[run.boss.form].form : undefined;
          this.showBanner(form?.name ?? def.name, form?.line ?? def.phases[0].line, 'blood', !this.reducedMotion);
          this.camera.shake(8);
          break;
        }
        case 'secret':
          // A find (plans/late-game/05): a gold banner, the evolve chime's cousin. A stir is the app's toast; a sighting, the arrival's banner.
          if (ev.stage === 'found') this.showBanner(`Found: ${SECRET_BY_ID[ev.id].name}`, SECRET_BY_ID[ev.id].text, 'gold');
          break;
        case 'bossPhase': {
          // A brief jolt on each phase change (§10.3), and its one line (Tyranny's too, §9).
          const def = BOSS_BY_ID[ev.boss];
          const name = run.boss?.form ? SECRET_BY_ID[run.boss.form].form?.name ?? def.name : def.name;
          this.showBanner(name, phasesOf(run, def)[ev.phase]?.line ?? '', 'blood');
          this.camera.shake(10);
          this.camera.zoomPunch();
          break;
        }
        case 'windup':
          this.effects.ring(ev.x, ev.y, 120, 60, withAlpha(FX.blood, 0.6), ev.seconds, 5);
          break;
        case 'slam':
          this.effects.spray(ev.x, ev.y, INK['300'], 22, 200, 5);
          this.camera.shake(9);
          break;
        case 'stagger':
          this.effects.ring(ev.x, ev.y, 40, 140, withAlpha(FX.gold, 0.9), 0.5, 7);
          this.showBanner('Staggered', 'The Nova broke its swing.', 'gold');
          break;
        case 'submerge':
        case 'emerge':
          this.effects.ring(ev.x, ev.y, 20, 140, withAlpha(FX.frost, 0.5), 0.6, 5);
          break;
        case 'enrage':
          this.showBanner('Enraged', 'It has had enough. It comes for the wall.', 'blood');
          this.camera.shake(12);
          break;
        case 'hordeEnrage':
          this.showBanner('The horde rages', 'The field is full. Every hit grows until the wall falls.', 'blood');
          this.camera.shake(8);
          break;
        case 'bossKill':
          // The killing blow (§7.3): a shatter, a shard fountain, the banner.
          this.effects.spray(ev.x, ev.y, FX.blood, 60, 420, 7);
          this.effects.spray(ev.x, ev.y, FX.gold, 70, 380, 5, 260);
          this.effects.ring(ev.x, ev.y, 30, 700, withAlpha(INK['050'], 0.8), 1.1, 10);
          this.camera.shake(26);
          this.camera.zoomPunch();
          if (runRegion(run).rush) {
            // Boss Rush (N8): the next one comes; the last one's banner is `cleared`'s.
            const stage = runRegion(run).rush!.stage;
            if (stage < RUSH_STAGES) this.showBanner(`Stage ${stage} of ${RUSH_STAGES}`, 'The next one comes.', 'gold');
          } else if (!runRegion(run).abyss) {
            this.showBanner(ev.first ? 'Region cleared' : 'Boss defeated', ev.first ? 'The light pushes outward.' : 'Overtime begins.', 'gold');
          }
          break;
        case 'cleared':
          this.showBanner('Boss Rush cleared', `Every boss down in ${formatDuration(run.outcome?.time ?? run.time)}.`, 'gold');
          break;
        case 'floor':
          // The Abyss (§9): a floor cleared; the next one is deeper still.
          this.showBanner(`Floor ${ev.floor} cleared`, 'The dark goes deeper.', 'gold');
          break;
        case 'eclipse':
          this.effects.ring(0, 0, ev.radius, run.stats.radius, withAlpha(INK['950'], 0.9), 0.6, 30);
          this.effects.ring(0, 0, run.stats.radius, ev.radius, withAlpha(FX.arcane, 0.7), 0.5, 8);
          this.camera.shake(8);
          this.camera.zoomPunch();
          break;
        case 'rail':
          this.effects.streak(ev.x1, ev.y1, ev.x2, ev.y2, ev.gilded ? lighten(FX.gold, 0.3) : FX.gold);
          this.camera.shake(2);
          break;
        case 'rune':
          if (ev.burst) {
            this.effects.ring(ev.x, ev.y, ev.radius * 0.2, ev.radius, withAlpha(FX.arcane, 0.85), 0.35, 7);
            this.effects.spray(ev.x, ev.y, FX.arcane, 12, 220, 4);
          }
          break;
        case 'shell':
          this.effects.hitSparks(ev.x, ev.y, INK['200'], false);
          break;
        case 'plateBreak':
          this.effects.spray(ev.x, ev.y, INK['300'], 18, 260, 5);
          this.effects.ring(ev.x, ev.y, ev.radius * 0.4, ev.radius * 2, withAlpha(FX.ember, 0.8), 0.4, 6);
          this.camera.shake(4);
          break;
        case 'charge':
          this.effects.ring(ev.x, ev.y, 8, 50, withAlpha(FX.blood, 0.7), 0.35, 4);
          break;
        case 'feed':
          this.effects.ring(ev.x, ev.y, 50, 8, withAlpha(FX.blood, 0.6), 0.4, 5);
          break;
        case 'aegis':
          this.effects.pulse(0, 0, run.stats.radius * 1.8, FX.gold);
          break;
        case 'blocked':
          this.effects.hitSparks(ev.x, ev.y, FX.gold, true);
          break;
        case 'lance':
          // Judgment's forks: gold, where the chain's are frost.
          for (let i = 0; i < ev.points.length; i += 4) this.effects.lightning(ev.points.slice(i, i + 4), FX.gold);
          break;
        case 'blast':
          switch (ev.style) {
            case 'shell':
              this.effects.ring(ev.x, ev.y, ev.radius * 0.3, ev.radius, withAlpha(FX.ember, 0.85), 0.35, 8);
              this.effects.spray(ev.x, ev.y, FX.ember, 14, 240, 4);
              this.camera.shake(1.5);
              break;
            case 'bomblet':
              this.effects.ring(ev.x, ev.y, ev.radius * 0.3, ev.radius, withAlpha(FX.gold, 0.75), 0.25, 4);
              break;
            case 'meteor':
              this.effects.ring(ev.x, ev.y, ev.radius * 0.2, ev.radius * 1.2, withAlpha(lighten(FX.gold, 0.4), 0.95), 0.5, 14);
              this.effects.spray(ev.x, ev.y, FX.ember, 40, 360, 6, 80);
              this.camera.shake(6);
              break;
            case 'shatter':
              this.effects.ring(ev.x, ev.y, 8, ev.radius, withAlpha(lighten(FX.frost, 0.4), 0.9), 0.35, 6);
              this.effects.spray(ev.x, ev.y, lighten(FX.frost, 0.5), 16, 300, 4);
              break;
            default: {
              const exhaustive: never = ev.style;
              return exhaustive;
            }
          }
          break;
        case 'evolve':
          // The spotlight (§10.3): the light gathers on the tower as the weapon turns.
          this.effects.evolve(run.stats.radius);
          this.camera.zoomPunch();
          if (!forming) this.showBanner('Evolved', EVOLUTION_BY_ID[ev.evolution].name, 'gold');
          break;
        case 'finalForm':
          // The beat lands a moment after the spotlight (§5.2); `render` plays it on the wall clock.
          this.formBeat = { at: this.clock + FORM_BEAT, frame: ev.frame };
          this.dirty = true;
          break;
        case 'anomaly': {
          // Taken (plans/late-game/04 §2): the mount flashes in the split rim, a ring and a spray roll out.
          const w = run.weapons.find((x) => x.id === ev.weapon);
          const o = w ? mountOf(run, w) : { x: 0, y: 0 };
          this.effects.ring(o.x, o.y, 6, run.stats.radius * 2.2, withAlpha(FX.mana, 0.8), 0.7, 5);
          this.effects.ring(o.x + 1.5, o.y, 6, run.stats.radius * 2.2, withAlpha(FX.ember, 0.6), 0.7, 3);
          this.effects.spray(o.x, o.y, FX.mana, 18, 220, 4);
          this.effects.spray(o.x, o.y, FX.ember, 12, 180, 3);
          this.camera.zoomPunch();
          this.showBanner('Anomaly', ANOMALY_BY_ID[ev.anomaly].name, 'gold');
          break;
        }
        case 'anomalyOffer':
          break;
        case 'fuse':
          // A fusion (N9): the evolution's spotlight, twice over.
          this.effects.evolve(run.stats.radius);
          this.effects.pulse(0, 0, run.stats.radius * 3, FX.gold);
          this.camera.zoomPunch();
          this.showBanner('Fused', FUSION_BY_ID[ev.fusion].name, 'gold');
          break;
        case 'ignite':
          this.effects.spray(ev.x, ev.y, FX.ember, 5, 120, 3, 60);
          break;
        case 'deflect':
          this.effects.hitSparks(ev.x, ev.y, INK['050'], true);
          break;
        case 'surface':
          this.effects.spray(ev.x, ev.y, INK['300'], 12, 160, 4);
          break;
        case 'blink':
          this.effects.ring(ev.x, ev.y, 6, 40, withAlpha(FX.arcane, 0.7), 0.3, 3);
          this.effects.ring(ev.tx, ev.ty, 40, 6, withAlpha(FX.arcane, 0.8), 0.3, 3);
          break;
        case 'silence': {
          // The gaze: a red line from the Harbinger to the tower.
          this.effects.lightning([ev.x, ev.y, 0, 0], FX.blood);
          this.showBanner('Silenced', `${WEAPON_BY_ID[ev.weapon].name} is silenced.`, 'blood');
          break;
        }
        case 'explode':
          this.effects.ring(ev.x, ev.y, ev.radius * 0.2, ev.radius, withAlpha(FX.blood, 0.8), 0.4, 8);
          this.effects.spray(ev.x, ev.y, FX.ember, 18, 260, 4);
          break;
        case 'pool':
          this.effects.spray(ev.x, ev.y, FX.ember, 20, 180, 5);
          break;
        case 'crown':
          this.effects.ring(ev.x, ev.y, 10, 90, withAlpha(FX.gold, 0.9), 0.5, 5);
          break;
        case 'rise':
          this.effects.ring(ev.x, ev.y, 30, 6, withAlpha(FX.arcane, 0.6), 0.5, 4);
          break;
        case 'drain':
          this.effects.spray(ev.x, ev.y, FX.mana, 8, 140, 3);
          break;
        case 'ultStart':
          this.effects.pulse(0, 0, run.stats.radius * 2, FX.arcane);
          this.camera.zoomPunch();
          break;
        case 'riftAppear':
          // It unzips on its own (the painter); a small ring marks where.
          this.effects.ring(ev.x, ev.y, 6, 40, withAlpha(RARITY[RIFT_BY_ID[ev.id].rarity], 0.7), 0.4, 3);
          break;
        case 'riftShut':
          // It zips closed with a small implosion.
          this.effects.ring(ev.x, ev.y, 40, 4, withAlpha(RARITY[RIFT_BY_ID[ev.id].rarity], 0.6), 0.35, 3);
          break;
        case 'riftTaken': {
          // Taken, it bursts into a ring; left, it simply closes.
          const color = RARITY[RIFT_BY_ID[ev.id].rarity];
          if (ev.choice !== null) {
            this.effects.ring(ev.x, ev.y, 8, 120, withAlpha(color, 0.9), 0.6, 5);
            this.effects.spray(ev.x, ev.y, color, 18, 200, 3);
          } else {
            this.effects.ring(ev.x, ev.y, 40, 4, withAlpha(color, 0.6), 0.35, 3);
          }
          break;
        }
        case 'reliquary':
          // A dark chest lands where the body fell (plans/late-game/03): a ring marks it.
          this.effects.ring(ev.x, ev.y, 6, 46, withAlpha(CURSE_COLOR, 0.8), 0.5, 3);
          break;
        case 'reliquaryClaim':
          this.effects.ring(ev.x, ev.y, 8, 110, withAlpha(CURSE_COLOR, 0.9), 0.6, 5);
          this.effects.spray(ev.x, ev.y, CURSE_COLOR, 16, 180, 3);
          break;
        case 'stratumEnter': {
          // A stratum's banner (plans/late-game/08 §3): its name, and its rule.
          const s = STRATUM_BY_ID[ev.stratum];
          if (s) this.showBanner(stratumTitle(s), s.rule.text, 'gold', !this.reducedMotion);
          break;
        }
        case 'escape':
          // Gone into the dark: a streak at the rim, and the ultimate's drain.
          this.effects.spray(ev.x, ev.y, FX.mana, 10, 160, 3);
          this.effects.ring(ev.x, ev.y, 30, 4, withAlpha(FX.mana, 0.7), 0.4, 4);
          break;
        case 'tide':
          this.effects.ring(ev.x, ev.y, 20, ev.radius, withAlpha(FX.ember, 0.55), 0.6, 4);
          break;
        case 'reliquaryFade':
          // It sinks: a small implosion.
          this.effects.ring(ev.x, ev.y, 40, 4, withAlpha(CURSE_COLOR, 0.5), 0.45, 3);
          break;
        case 'fire':
        case 'waveStart':
        case 'firstSight':
        case 'draftOpen':
        case 'ultReady':
        case 'shot':
          break;
        default: {
          const exhaustive: never = ev;
          return exhaustive;
        }
      }
    }
  }

  /**
   * Draw one frame. `run` is null on screens with no live run (the hub), where
   * the arena and a quiet tower still show as a backdrop.
   */
  render(run: RunState | null, alpha: number, realDt: number): void {
    this.attach(run);
    const ctx = this.ctx;
    this.clock += realDt;
    if (this.fallT !== null) this.fallT += realDt;
    // The light is the sim's (camera-and-fog §2); the camera only frames it.
    // The hub has no run: the base light, fully out.
    // A run's light keeps the shape of the stage it started on; the hub's follows the stage.
    const light = run ? run.stats.light : ARENA.lightBase;
    const oval = run ? run.arena : this.stageOval();
    this.camera.setLight(light, oval, run !== null);
    this.camera.update(realDt);
    this.effects.tick(realDt);
    if (run && this.formBeat && this.clock >= this.formBeat.at) this.playForm(run, this.formBeat.frame);
    const view = this.camera.transform;
    this.enemies.setScale(spriteScale(view.scale));
    /** World units per CSS pixel: thin lines are drawn live at this width. */
    const px = view.dpr / view.scale;
    const box: WorldBox = { halfWidth: this.camera.viewHalfWidth, halfHeight: this.camera.viewHalfHeight };

    // A stratum wears its own ground (plans/late-game/08); past the strata, a template's, gone dark (§9).
    const region = run ? runRegion(run) : regionByIndex(1);
    this.camera.applyDevice(ctx);
    paintSky(ctx, view.pixelWidth, view.pixelHeight, this.horizon, run && region.abyss ? ABYSS_SKY_DIM : SKY_DIM);

    const stratum = region.abyss?.stratum ? STRATUM_BY_ID[region.abyss.stratum] ?? null : null;
    const tint = stratum ? region.tint : region.abyss ? mix(region.tint ?? INK['800'], ABYSS_DARK, 0.55) : region.tint;
    this.camera.applyWorld(ctx);
    paintGround(ctx, light, oval, tint, px, this.palette);
    const additive = QUALITY[this.tier].additive;
    const form = this.formPaint(run);
    if (run) {
      paintRangeRing(ctx, run.stats.range, px, form ? formAccent(form.frame) : null);
      paintRings(ctx, run.rings);
      paintFires(ctx, run.fires, run.time, this.clock);
      paintRunes(ctx, run.runes, run.time, this.clock);
      paintPools(ctx, run.pools, run.time, this.clock);
      const lord = BOSS_BY_ID[region.boss];
      this.enemies.draw(ctx, run.enemies, alpha, run.tick, run.time, this.clock, light, oval, { color: lord.color, border: lord.borderColor }, this.guestLook(stratum));
      paintStatus(ctx, run.enemies, alpha, run.time, this.clock);
      const b = run.boss;
      if (b && b.killedIn === null) {
        const body = run.enemies.find((e) => e.id === b.enemy && e.alive);
        paintCourt(ctx, run, alpha, this.clock);
        paintPlates(ctx, run, alpha);
        if (body) {
          paintBoss(ctx, body, b, alpha, run.tick, run.time, this.clock, light, oval);
          paintFacets(ctx, body.px + (body.x - body.px) * alpha, body.py + (body.y - body.py) * alpha, body.radius, mirrorFacets(run));
        }
      }
      paintShots(ctx, run.shots, alpha);
      paintArsenal(ctx, run, alpha, this.clock, additive);
      const sinceHurt = run.tick - run.tower.hurtTick;
      const hurt = run.tower.hurtTick >= 0 && sinceHurt < HURT_TICKS ? 1 - sinceHurt / HURT_TICKS : 0;
      const fallen = this.fallT === null ? 0 : Math.min(1, this.fallT / (FALL_SECONDS * 0.6));
      // A fusion's second half (N9) rides on its partner's mount: no pod of its own.
      const mounts = run.fused.length > 0 ? run.weapons.filter((w) => !w.joined) : run.weapons;
      paintTower(ctx, run.stats.radius, mounts, this.clock, hurt, fallen, this.look, form);
      if (run.tower.invulnUntil > run.time) paintAegis(ctx, run.stats.radius, run.tower.invulnUntil - run.time, this.clock);
      paintProjectiles(ctx, run.projectiles, alpha, additive);
      paintRift(ctx, run.rift, run.time, this.clock, { reducedMotion: this.reducedMotion, plain: !additive, px });
    } else {
      paintTower(ctx, 46, this.idle, this.clock, 0, 0, this.look, form);
    }
    this.effects.drawWorld(ctx);
    // The dark over everything out there: bodies fade in as they walk out of it.
    paintDark(ctx, light, oval, box, this.palette, form && run && form.frame === 'lamplighter' ? SUNRISE_DARK : 1);
    paintRim(ctx, light, oval, px, stratum ? FX[stratum.rim] : FX.arcane);
    if (run && stratum) paintGates(ctx, light, oval, px, this.slideGates(run, realDt), FX[stratum.rim], this.clock);
    // Reliquaries (plans/late-game/03): above the dark, so no floor's fog hides one.
    if (run && run.reliquaries.length > 0) {
      paintReliquaries(ctx, run.reliquaries, run.time, this.clock, { reducedMotion: this.reducedMotion, px });
    }

    this.camera.applyScreen(ctx);
    this.effects.drawScreen(ctx, (x, y) => this.camera.worldToScreen(x, y));
    if (run) {
      this.drawBossMarker(ctx, run, alpha);
      this.drawVignette(ctx, run);
    }
    this.drawBanner(ctx, realDt);
    this.dirty = false;
    this.drawnView = this.camera.version;
  }

  /**
   * The crown to draw now, if any: a run's once formed (growing in after its
   * beat), or the hub's selected frame, still and dimmed, once it has formed (F4).
   */
  private formPaint(run: RunState | null): FormPaint | null {
    if (!run) {
      const frame = this.look.form;
      return frame ? { frame, grow: 1, still: true, alpha: 0.6 } : null;
    }
    if (this.formAt === null || run.form.wave === null) return null;
    const since = this.clock - this.formAt;
    const grow = this.reducedMotion ? since / FORM_FADE : since / FORM_GROW;
    return { frame: run.frameId as FrameId, grow: Math.min(1, grow), still: this.reducedMotion, alpha: 1 };
  }

  /** Final Form's beat (§5.2): the burst, the punch, the crown begins to grow, the banner. */
  private playForm(run: RunState, frame: FrameId): void {
    this.formBeat = null;
    this.formAt = this.clock;
    const def = frameById(frame);
    if (!this.reducedMotion) {
      this.effects.formBurst(run.stats.radius, run.stats.light, formAccent(frame));
      this.camera.zoomPunch();
    }
    // Letterboxed the first time per frame; `showBanner`'s caller drops it under reduced motion.
    const first = !this.formsSeen.has(frame);
    this.showBanner('Final Form', def.form.name, 'gold', first && !this.reducedMotion);
  }

  /**
   * The boss intro (ported from the legacy `drawBossIntro`) and the banners
   * for phases and the region's clearing, in screen space. The game never
   * waits for it (§6.1): the boss walks in underneath.
   */
  private drawBanner(ctx: CanvasRenderingContext2D, realDt: number): void {
    const b = this.banner;
    if (!b) return;
    b.t += realDt;
    if (b.t >= b.life) {
      this.banner = null;
      return;
    }
    const w = this.camera.transform.cssWidth;
    const h = this.camera.transform.cssHeight;
    // In fast, hold, out slow.
    const p = Math.min(1, b.t / 0.35, (b.life - b.t) / 0.6);
    ctx.save();
    if (b.letterbox) {
      const barH = h * 0.1 * p;
      ctx.fillStyle = withAlpha(GROUND.stop2, 0.92);
      ctx.fillRect(0, 0, w, barH);
      ctx.fillRect(0, h - barH, w, barH);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = p;
    ctx.translate(w / 2, h * 0.36);
    const settle = 1.06 - 0.06 * p;
    ctx.scale(settle, settle);
    ctx.lineWidth = 5;
    ctx.strokeStyle = withAlpha(INK['950'], 0.85);
    ctx.font = `700 ${Math.round((b.letterbox ? 34 : 28) * this.textScale)}px ${DISPLAY_FONT}`;
    const title = b.title.toUpperCase();
    ctx.strokeText(title, 0, 0);
    ctx.fillStyle = b.tone === 'gold' ? lighten(FX.gold, 0.2) : mix(FX.blood, INK['050'], 0.45);
    ctx.fillText(title, 0, 0);
    if (b.line) {
      ctx.font = `500 ${Math.round(15 * this.textScale)}px ${DISPLAY_FONT}`;
      ctx.lineWidth = 4;
      const below = 30 * this.textScale;
      ctx.strokeText(b.line, 0, below);
      ctx.fillStyle = INK['100'];
      ctx.fillText(b.line, 0, below);
    }
    ctx.restore();
  }

  /**
   * A close-up may leave the boss off-screen (camera-and-fog §5.3): a small
   * marker on the stage's edge points at it, in its colour. The one
   * off-screen marker the game draws.
   */
  private drawBossMarker(ctx: CanvasRenderingContext2D, run: RunState, alpha: number): void {
    const b = run.boss;
    if (!b || b.killedIn !== null) return;
    const body = run.enemies.find((e) => e.id === b.enemy && e.alive);
    if (!body) return;
    const t = this.camera.transform;
    const x = body.px + (body.x - body.px) * alpha;
    const y = body.py + (body.y - body.py) * alpha;
    const at = this.camera.worldToScreen(x, y);
    const r = (body.radius * t.scale) / t.dpr;
    const w = t.cssWidth;
    const h = t.cssHeight;
    if (at.x + r >= 0 && at.x - r <= w && at.y + r >= 0 && at.y - r <= h) return;
    // Where the line from the centre to the boss leaves the inset box.
    const cx = w / 2;
    const cy = h / 2;
    const dx = at.x - cx;
    const dy = at.y - cy;
    const k = Math.min((cx - MARKER_INSET) / Math.max(1e-6, Math.abs(dx)), (cy - MARKER_INSET) / Math.max(1e-6, Math.abs(dy)));
    const mx = cx + dx * k;
    const my = cy + dy * k;
    const a = Math.atan2(dy, dx);
    const def = BOSS_BY_ID[b.id];
    const s = MARKER_SIZE;
    ctx.save();
    ctx.translate(mx, my);
    ctx.rotate(a);
    ctx.globalAlpha = 0.75 + 0.25 * Math.sin(this.clock * 4);
    ctx.beginPath();
    ctx.moveTo(s * 1.3, 0);
    ctx.lineTo(-s * 0.7, -s);
    ctx.lineTo(-s * 0.3, 0);
    ctx.lineTo(-s * 0.7, s);
    ctx.closePath();
    ctx.fillStyle = def.color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = withAlpha(INK['950'], 0.85);
    ctx.stroke();
    ctx.restore();
  }

  /** The tower in peril: a scarlet edge that deepens as HP falls. */
  private drawVignette(ctx: CanvasRenderingContext2D, run: RunState): void {
    const frac = Math.max(0, run.tower.hp) / run.stats.maxHp;
    if (frac >= VIGNETTE_FROM) return;
    const strength = (1 - frac / VIGNETTE_FROM) * 0.5;
    const w = this.camera.transform.cssWidth;
    const h = this.camera.transform.cssHeight;
    // One gradient per screen size, faded by alpha: not a new one each frame.
    ctx.fillStyle = cachedGradient(`vignette|${w}|${h}|${FX.critical}`, () => {
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.7);
      g.addColorStop(0, withAlpha(FX.critical, 0));
      g.addColorStop(1, FX.critical);
      return g;
    });
    const was = ctx.globalAlpha;
    ctx.globalAlpha = was * strength;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = was;
  }
}
