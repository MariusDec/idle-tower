import { BOSS_BY_ID } from '../content/bosses';
import { ENEMY_BY_ID } from '../content/enemies';
import { regionByIndex } from '../content/regions';
import type { RunState } from '../sim/state';
import { Camera } from './camera';
import { Effects } from './effects';
import { FX, INK, lighten, mix, withAlpha } from './palette';
import { bakeArena } from './painters/arena';
import { EnemyPainter } from './painters/enemies';
import { paintProjectiles } from './painters/projectiles';
import { paintAegis, paintBoss, paintRings, paintShots } from './painters/bosses';
import { mountOffset, paintRangeRing, paintTower, type Mount } from './painters/tower';
import { QUALITY, type QualityTier } from './quality';

/** Sim ticks the crystal stays flared after a contact hit. */
const HURT_TICKS = 12;
/** Seconds the fall animation runs before the results screen (§4.6). */
export const FALL_SECONDS = 1.2;
/** HP fraction below which the edge vignette starts. */
const VIGNETTE_FROM = 0.35;
/** The hub's backdrop tower: the frame's starting weapon, facing up. */
const IDLE_MOUNTS: readonly Mount[] = [{ id: 'arcane-bolt', level: 1, aim: -Math.PI / 2 }];
/** Seconds the boss intro's letterbox and name hold (§4.3: reuse the legacy intro). */
const INTRO_SECONDS = 2.8;
/** Seconds a banner (a boss phase, REGION CLEARED) holds. */
const BANNER_SECONDS = 2.4;
const DISPLAY_FONT = 'Oswald, "Arial Narrow", sans-serif';

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
  private bakedRegion = 0;
  private banner: Banner | null = null;
  /** Honour the OS setting: the letterbox is the moving part, so it goes. */
  private readonly reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

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
          this.effects.ring(ev.x, ev.y, 20, 90, withAlpha(FX.gold, 0.8), 0.6, 5);
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
          // A brief jolt on each phase change (§10.3), and its one line.
          const def = BOSS_BY_ID[ev.boss];
          this.showBanner(def.name, def.phases[ev.phase].line, 'blood');
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
          this.showBanner(ev.first ? 'Region cleared' : 'Boss defeated', ev.first ? 'The light pushes outward.' : 'Overtime begins.', 'gold');
          break;
        case 'aegis':
          this.effects.pulse(0, 0, run.stats.radius * 1.8, FX.gold);
          break;
        case 'blocked':
          this.effects.hitSparks(ev.x, ev.y, FX.gold, true);
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

    const region = run?.regionId ?? 1;
    if (!this.background || region !== this.bakedRegion) {
      this.background = bakeArena(view.pixelWidth, view.pixelHeight, view.scale, regionByIndex(region).tint);
      this.bakedRegion = region;
    }
    this.camera.applyDevice(ctx);
    ctx.drawImage(this.background, 0, 0);

    this.camera.applyWorld(ctx);
    const additive = QUALITY[this.tier].additive;
    if (run) {
      paintRangeRing(ctx, run.stats.range);
      paintRings(ctx, run.rings);
      this.enemies.draw(ctx, run.enemies, alpha, run.tick, run.time, this.clock);
      const b = run.boss;
      if (b && b.killedIn === null) {
        const body = run.enemies.find((e) => e.id === b.enemy && e.alive);
        if (body) paintBoss(ctx, body, b, alpha, run.tick, run.time, this.clock);
      }
      paintShots(ctx, run.shots, alpha);
      const sinceHurt = run.tick - run.tower.hurtTick;
      const hurt = run.tower.hurtTick >= 0 && sinceHurt < HURT_TICKS ? 1 - sinceHurt / HURT_TICKS : 0;
      const fallen = this.fallT === null ? 0 : Math.min(1, this.fallT / (FALL_SECONDS * 0.6));
      paintTower(ctx, run.stats.radius, run.weapons, this.clock, hurt, fallen);
      if (run.tower.invulnUntil > run.time) paintAegis(ctx, run.stats.radius, run.tower.invulnUntil - run.time, this.clock);
      paintProjectiles(ctx, run.projectiles, alpha, additive);
    } else {
      paintTower(ctx, 46, IDLE_MOUNTS, this.clock, 0, 0);
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
    ctx.font = `700 ${b.letterbox ? 34 : 28}px ${DISPLAY_FONT}`;
    const title = b.title.toUpperCase();
    ctx.strokeText(title, 0, 0);
    ctx.fillStyle = b.tone === 'gold' ? lighten(FX.gold, 0.2) : mix(FX.blood, INK['050'], 0.45);
    ctx.fillText(title, 0, 0);
    if (b.line) {
      ctx.font = `500 15px ${DISPLAY_FONT}`;
      ctx.lineWidth = 4;
      ctx.strokeText(b.line, 0, 30);
      ctx.fillStyle = INK['100'];
      ctx.fillText(b.line, 0, 30);
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
