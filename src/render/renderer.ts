import { ENEMY_BY_ID } from '../content/enemies';
import type { RunState, SimEvent } from '../sim/state';
import { Camera } from './camera';
import { Effects } from './effects';
import { FX, withAlpha } from './palette';
import { bakeArena } from './painters/arena';
import { EnemyPainter } from './painters/enemies';
import { paintProjectiles } from './painters/projectiles';
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

  /** Turn this step's sim events into effects. The caller clears the list. */
  consume(events: readonly SimEvent[]): void {
    for (const ev of events) {
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
          this.effects.levelUp(this.lastRun?.stats.radius ?? 46);
          break;
        case 'nova':
          this.effects.nova(this.lastRun?.stats.radius ?? 46, ev.radius);
          this.camera.shake(10);
          this.camera.zoomPunch();
          break;
        case 'picked': {
          // A new weapon: a flash where its mount just appeared.
          const run = this.lastRun;
          if (ev.card.kind === 'weapon' && ev.card.level === 1 && run) {
            const slot = run.weapons.findIndex((w) => w.id === ev.card.id);
            const R = run.stats.radius;
            const o = mountOffset(Math.max(0, slot), R);
            this.effects.pulse(o.x, o.y, R * 0.5, FX.gold);
          }
          break;
        }
        case 'towerHit': {
          const d = Math.hypot(ev.x, ev.y) || 1;
          const wall = this.lastRun?.stats.radius ?? 46;
          this.effects.wallHit((ev.x / d) * wall, (ev.y / d) * wall);
          this.camera.shake(3);
          break;
        }
        case 'fell':
          this.fallT = 0;
          this.effects.towerFall(this.lastRun?.stats.radius ?? 46);
          this.camera.shake(24);
          this.camera.zoomPunch();
          break;
        case 'fire':
        case 'waveStart':
        case 'firstSight':
        case 'draftOpen':
        case 'ultReady':
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
    if (run !== this.lastRun) {
      this.lastRun = run;
      this.effects.clear();
      this.fallT = null;
    }
    const ctx = this.ctx;
    this.clock += realDt;
    if (this.fallT !== null) this.fallT += realDt;
    this.camera.update(realDt);
    this.effects.tick(realDt);
    const view = this.camera.transform;
    this.enemies.setScale(view.scale);

    if (!this.background) this.background = bakeArena(view.pixelWidth, view.pixelHeight, view.scale);
    this.camera.applyDevice(ctx);
    ctx.drawImage(this.background, 0, 0);

    this.camera.applyWorld(ctx);
    const additive = QUALITY[this.tier].additive;
    if (run) {
      paintRangeRing(ctx, run.stats.range);
      this.enemies.draw(ctx, run.enemies, alpha, run.tick, this.clock);
      const sinceHurt = run.tick - run.tower.hurtTick;
      const hurt = run.tower.hurtTick >= 0 && sinceHurt < HURT_TICKS ? 1 - sinceHurt / HURT_TICKS : 0;
      const fallen = this.fallT === null ? 0 : Math.min(1, this.fallT / (FALL_SECONDS * 0.6));
      paintTower(ctx, run.stats.radius, run.weapons, this.clock, hurt, fallen);
      paintProjectiles(ctx, run.projectiles, alpha, additive);
    } else {
      paintTower(ctx, 46, IDLE_MOUNTS, this.clock, 0, 0);
    }
    this.effects.drawWorld(ctx);

    this.camera.applyScreen(ctx);
    this.effects.drawScreen(ctx, (x, y) => this.camera.worldToScreen(x, y));
    if (run) this.drawVignette(ctx, run);
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
