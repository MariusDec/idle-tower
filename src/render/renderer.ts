import { BOSS_BY_ID } from '../content/bosses';
import { EVOLUTION_BY_ID } from '../content/evolutions';
import { FUSION_BY_ID } from '../content/fusions';
import { ENEMY_BY_ID } from '../content/enemies';
import { regionByIndex } from '../content/regions';
import { RUSH_STAGES } from '../content/rush';
import { formatDuration } from '../core/format';
import type { RunState } from '../sim/state';
import { Camera } from './camera';
import { Effects } from './effects';
import { FX, INK, lighten, mix, setPaletteMode, withAlpha, type PaletteMode } from './palette';
import { bakeArena } from './painters/arena';
import { EnemyPainter } from './painters/enemies';
import { paintProjectiles } from './painters/projectiles';
import { paintArsenal, paintFires, paintRunes, paintStatus } from './painters/arsenal';
import { paintAegis, paintBoss, paintCourt, paintFacets, paintPlates, paintPools, paintRings, paintShots } from './painters/bosses';
import { mirrorFacets, phasesOf } from '../sim/systems/boss';
import { runRegion } from '../sim/systems/waves';
import { WEAPON_BY_ID } from '../content/weapons';
import { PLAIN_LOOK, mountOffset, paintRangeRing, paintTower, type Mount, type TowerLook } from './painters/tower';
import type { WeaponId } from '../content/types';
import { QUALITY, type QualityTier } from './quality';

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
  private background: HTMLCanvasElement | null = null;
  private tier: QualityTier = 'high';
  private clock = 0;
  private lastRun: RunState | null = null;
  /** Wall-clock seconds since the tower fell; null while it stands. */
  private fallT: number | null = null;
  /** The region the background was baked for. */
  private bakedRegion = '';
  private banner: Banner | null = null;
  /** Reduced motion (the OS's or the player's): the letterbox is the moving part, so it goes. */
  private reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  /** The settings' text size, for the banners and damage numbers. */
  private textScale = 1;
  /** The palette the canvas wears, and its baked sprites were drawn in. */
  private palette: PaletteMode = 'standard';
  /** What the tower wears (N2), and the hub's mount: the profile's, set by the app. */
  private look: TowerLook = PLAIN_LOOK;
  private idle: readonly Mount[] = [{ id: 'arcane-bolt', level: 1, aim: IDLE_AIM }];

  constructor(canvas: HTMLCanvasElement, host: HTMLElement) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.camera = new Camera(canvas);
    this.camera.onResize = () => { this.background = null; };
    this.camera.setHost(host);
  }

  setQuality(tier: QualityTier): void {
    this.tier = tier;
    this.camera.setDprCap(QUALITY[tier].dprCap);
    this.effects.setQuality(tier);
  }

  /** The player's motion settings (reduced motion, screen shake). */
  setMotion(reduced: boolean, shake: boolean): void {
    this.reducedMotion = reduced;
    this.camera.setMotion(reduced, shake);
  }

  /**
   * The settings' colours (standard or colourblind-safe). The baked ground
   * and enemy sprites hold the old colours, so they rebake on the next frame.
   */
  setPalette(mode: PaletteMode): void {
    if (mode === this.palette) return;
    this.palette = mode;
    setPaletteMode(mode);
    this.background = null;
    this.enemies.clear();
  }

  /** The settings' text size, applied to text painted on the canvas. */
  setTextScale(scale: number): void {
    this.textScale = scale;
    this.effects.setTextScale(scale);
  }

  /**
   * The tower's look from the profile (N2): its tier, trophies and trims,
   * and the frame whose starting weapon the hub's tower mounts, at the tier's level.
   */
  setTower(look: TowerLook, weapon: WeaponId): void {
    this.look = look;
    this.idle = [{ id: weapon, level: Math.min(5, look.tier), aim: IDLE_AIM }];
  }

  get quality(): QualityTier {
    return this.tier;
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
    this.effects.clear();
    this.fallT = null;
    this.banner = null;
  }

  private showBanner(title: string, line: string, tone: Banner['tone'], letterbox = false): void {
    this.banner = { title, line, t: 0, life: letterbox ? INTRO_SECONDS : BANNER_SECONDS, letterbox, tone };
  }

  /** Turn `run`'s pending sim events into effects. The caller clears the list. */
  consume(run: RunState): void {
    this.attach(run);
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
            const slot = run.weapons.findIndex((w) => w.id === ev.card.id);
            const R = run.stats.radius;
            const o = mountOffset(Math.max(0, slot), R);
            this.effects.pulse(o.x, o.y, R * 0.5, FX.gold);
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
          this.effects.ring(0, 0, run.stats.radius, ev.radius, withAlpha(FX.frost, 0.7), 0.4, 10);
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
          this.showBanner(def.name, def.phases[0].line, 'blood', !this.reducedMotion);
          this.camera.shake(8);
          break;
        }
        case 'bossPhase': {
          // A brief jolt on each phase change (§10.3), and its one line (Tyranny's too, §9).
          const def = BOSS_BY_ID[ev.boss];
          this.showBanner(def.name, phasesOf(run, def)[ev.phase]?.line ?? '', 'blood');
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
          this.showBanner('Evolved', EVOLUTION_BY_ID[ev.evolution].name, 'gold');
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
    this.camera.update(realDt);
    this.effects.tick(realDt);
    const view = this.camera.transform;
    this.enemies.setScale(view.scale);

    // An Abyss floor wears its template's ground, gone dark (§9).
    const region = run ? runRegion(run) : regionByIndex(1);
    if (!this.background || region.id !== this.bakedRegion) {
      const tint = region.abyss ? mix(region.tint ?? INK['800'], ABYSS_DARK, 0.55) : region.tint;
      this.background = bakeArena(view.pixelWidth, view.pixelHeight, view.scale, tint);
      this.bakedRegion = region.id;
    }
    this.camera.applyDevice(ctx);
    ctx.drawImage(this.background, 0, 0);

    this.camera.applyWorld(ctx);
    const additive = QUALITY[this.tier].additive;
    if (run) {
      paintRangeRing(ctx, run.stats.range);
      paintRings(ctx, run.rings);
      paintFires(ctx, run.fires, run.time, this.clock);
      paintRunes(ctx, run.runes, run.time, this.clock);
      paintPools(ctx, run.pools, run.time, this.clock);
      const lord = BOSS_BY_ID[region.boss];
      this.enemies.draw(ctx, run.enemies, alpha, run.tick, run.time, this.clock, { color: lord.color, border: lord.borderColor });
      paintStatus(ctx, run.enemies, alpha, run.time, this.clock);
      const b = run.boss;
      if (b && b.killedIn === null) {
        const body = run.enemies.find((e) => e.id === b.enemy && e.alive);
        paintCourt(ctx, run, alpha, this.clock);
        paintPlates(ctx, run, alpha);
        if (body) {
          paintBoss(ctx, body, b, alpha, run.tick, run.time, this.clock);
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
      paintTower(ctx, run.stats.radius, mounts, this.clock, hurt, fallen, this.look);
      if (run.tower.invulnUntil > run.time) paintAegis(ctx, run.stats.radius, run.tower.invulnUntil - run.time, this.clock);
      paintProjectiles(ctx, run.projectiles, alpha, additive);
    } else {
      paintTower(ctx, 46, this.idle, this.clock, 0, 0, this.look);
    }
    this.effects.drawWorld(ctx);

    this.camera.applyScreen(ctx);
    this.effects.drawScreen(ctx, (x, y) => this.camera.worldToScreen(x, y));
    if (run) this.drawVignette(ctx, run);
    this.drawBanner(ctx, realDt);
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
      ctx.fillStyle = withAlpha(INK['950'], 0.92);
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

  /** The tower in peril: a scarlet edge that deepens as HP falls. */
  private drawVignette(ctx: CanvasRenderingContext2D, run: RunState): void {
    const frac = Math.max(0, run.tower.hp) / run.stats.maxHp;
    if (frac >= VIGNETTE_FROM) return;
    const strength = (1 - frac / VIGNETTE_FROM) * 0.5;
    const w = this.camera.transform.cssWidth;
    const h = this.camera.transform.cssHeight;
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.7);
    g.addColorStop(0, withAlpha(FX.critical, 0));
    g.addColorStop(1, withAlpha(FX.critical, strength));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
}
