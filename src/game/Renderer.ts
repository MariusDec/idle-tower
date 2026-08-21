import type { RenderSnapshot, Enemy, HostileShot, Projectile, Particle, DamageNumber, Shockwave, Mine, AuraType, LootOrb } from '../types';
import { LOOT_ORB_COLORS, LOOT_TUNING, type LootOrbKind } from '../data/loot';
import { TOWER_VISUAL } from '../data/tower';
import { BOSS_ENCOUNTER, ENEMY_BEHAVIOR, ENEMY_DEFS } from '../data/enemies';
import type { EnemyDef, EnemyShape } from '../data/enemies';
import { isBossWave } from '../data/formulas';
import { formatInt } from '../utils/bigNumber';
import { ELITE_AURA_COLORS, AURA_RADIUS } from '../systems/EnemyManager';

/** How much larger an elite renders than a normal enemy of the same type. */
const ELITE_RADIUS_SCALE = 1.25;
/** Slack around a body sprite so its outline stroke is not clipped. */
const SPRITE_PADDING = 6;
/** Body colour of a boss below its enrage threshold. */
const ENRAGED_BOSS_COLOR = '#ff2020';
/**
 * Shapes this renderer knows how to paint (gameplay plan §2.5).
 *
 * Exported so `content-coverage.test.ts` can assert that every `EnemyType`'s
 * declared shape is one of them — `tsc` already rejects a missing case in
 * `paintEnemyBody`, but nothing else stops a type being given a shape string
 * that compiles and draws nothing.
 */
export const RENDERED_ENEMY_SHAPES: readonly EnemyShape[] =
  ['circle', 'diamond', 'winged', 'square', 'hex', 'mound'];

/** Seconds a blinker's after-image lingers at the position it left. */
const AFTER_IMAGE_LIFE = 0.45;

/** Solid crown colours, one per aura (the aura fills are translucent). */
const ELITE_CROWN_COLORS: Record<AuraType, string> = {
  haste: '#3cb4ff',
  thorns: '#ff6420',
  greed: '#ffd700',
  vitality: '#3edc64',
  retribution: '#b432dc',
};

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly width: number;
  private readonly height: number;
  private readonly rangeOverlay: boolean = true;
  private time = 0;
  private bgCanvas: HTMLCanvasElement | null = null;
  /**
   * Pre-rendered sprites (plan §5.1).
   *
   * Enemy bodies, ground shadows and every aura glow used to be built from
   * scratch on the canvas each frame — `createRadialGradient` alone ran once
   * per shadow, once per boss/healer/elite aura and once per magic
   * projectile, so a wave of 240 enemies allocated several hundred gradient
   * objects every frame before drawing anything. All of it is static per
   * (type, variant), so it is painted once into an offscreen canvas and
   * blitted afterwards.
   *
   * Only genuinely per-enemy animation stays live: the wing flap, the
   * boss/splitter pulse and the shield arcs, none of which allocate.
   */
  private readonly enemySprites = new Map<string, HTMLCanvasElement>();
  private readonly shadowSprites = new Map<string, HTMLCanvasElement>();
  private readonly auraSprites = new Map<string, HTMLCanvasElement>();
  private readonly crownSprites = new Map<string, HTMLCanvasElement>();
  private magicProjectileSprite: HTMLCanvasElement | null = null;
  /**
   * Orb bodies, one sprite per kind (gameplay plan §4.1 / §6 performance).
   *
   * An orb is a glow, a body and a glyph — three fills and a gradient each, and
   * a boss pack can put a couple of dozen on screen at once. All of it is
   * static per kind, so it is painted once and blitted with a pulse scale,
   * exactly like the enemy auras.
   */
  private readonly orbSprites = new Map<LootOrbKind, HTMLCanvasElement>();
  /**
   * Tower position from the frame currently being drawn.
   *
   * Cached at the top of `draw` so the boss siphon beam has somewhere to point.
   * Read-only presentation state — the enemy loop must not reach back into the
   * simulation for it.
   */
  private towerX = 0;
  private towerY = 0;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to acquire 2D rendering context');
    this.ctx = ctx;
    this.width = canvas.width;
    this.height = canvas.height;
  }

  draw(snapshot: RenderSnapshot, options?: { screenFlash?: number; towerFlash?: number; wallFlash?: number; shieldFlash?: number; chainPaths?: { points: { x: number; y: number }[]; age: number; life: number }[] }): void {
    this.time += 1 / 60;
    const ctx = this.ctx;
    this.towerX = snapshot.tower.x;
    this.towerY = snapshot.tower.y;
    ctx.drawImage(this.getBackground(), 0, 0);
    this.drawTowerBase(ctx, snapshot);
    this.drawWall(ctx, snapshot);
    if (this.rangeOverlay) this.drawRangeRing(ctx, snapshot);
    this.drawMines(ctx, snapshot.mines);
    this.drawSpawnLanes(ctx, snapshot.spawnLanes);
    this.drawParticles(ctx, snapshot.particles, 'behind');
    this.drawShockwaves(ctx, snapshot.shockwaves);
    this.drawAimLine(ctx, snapshot);
    this.drawEnemies(ctx, snapshot.enemies);
    this.drawProjectiles(ctx, snapshot.projectiles);
    this.drawHostileShots(ctx, snapshot.hostileShots);
    this.drawParticles(ctx, snapshot.particles, 'front');
    this.drawOrbs(ctx, snapshot.orbs);
    this.drawPlacement(ctx, snapshot.placement);
    this.drawChargeRing(ctx, snapshot.charge);
    this.drawChainLightning(ctx, options?.chainPaths);
    this.drawDamageNumbers(ctx, snapshot.damageNumbers);
    this.drawTowerTop(ctx, snapshot);
    this.drawShield(ctx, snapshot);
    this.drawWaveBanner(ctx, snapshot);

    // Screen flash overlay (boss death)
    const flash = options?.screenFlash ?? 0;
    if (flash > 0) {
      ctx.save();
      ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(1, flash / 0.15)})`;
      ctx.fillRect(0, 0, this.width, this.height);
      ctx.restore();
    }

    // Tower damage flash (red pulse on enemy attack)
    const tFlash = options?.towerFlash ?? 0;
    if (tFlash > 0) {
      const t = snapshot.tower;
      const alpha = Math.min(1, tFlash / 0.12) * 0.35;
      const pulse = 1 + (1 - tFlash / 0.12) * 0.5;
      const r = (TOWER_VISUAL.bodyRadius + 12) * pulse;
      const grad = ctx.createRadialGradient(t.x, t.y, 0, t.x, t.y, r);
      grad.addColorStop(0, `rgba(255, 60, 40, ${alpha})`);
      grad.addColorStop(1, 'rgba(255, 60, 40, 0)');
      ctx.save();
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(t.x, t.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Wall damage flash (orange pulse on wall ring)
    const wFlash = options?.wallFlash ?? 0;
    if (wFlash > 0) {
      const t = snapshot.tower;
      const wallR = TOWER_VISUAL.bodyRadius + 40;
      const alpha = Math.min(1, wFlash / 0.12) * 0.4;
      const pulse = 1 + (1 - wFlash / 0.12) * 0.3;
      const r = wallR * pulse;
      ctx.save();
      ctx.strokeStyle = `rgba(255, 160, 40, ${alpha})`;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(t.x, t.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Shield damage flash (bright blue pulse on shield ring)
    const sFlash = options?.shieldFlash ?? 0;
    if (sFlash > 0) {
      const t = snapshot.tower;
      const shieldR = TOWER_VISUAL.bodyRadius + 8;
      const alpha = Math.min(1, sFlash / 0.12) * 0.5;
      const pulse = 1 + (1 - sFlash / 0.12) * 0.3;
      const r = shieldR * pulse;
      ctx.save();
      ctx.strokeStyle = `rgba(100, 200, 255, ${alpha})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(t.x, t.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  private getBackground(): HTMLCanvasElement {
    if (this.bgCanvas && this.bgCanvas.width === this.width && this.bgCanvas.height === this.height) {
      return this.bgCanvas;
    }
    const c = document.createElement('canvas');
    c.width = this.width;
    c.height = this.height;
    const bg = c.getContext('2d')!;
    this.drawBackground(bg);
    this.drawArena(bg);
    this.bgCanvas = c;
    return c;
  }

  private drawBackground(ctx: CanvasRenderingContext2D): void {
    const grad = ctx.createRadialGradient(
      this.width / 2,
      this.height / 2,
      50,
      this.width / 2,
      this.height / 2,
      Math.max(this.width, this.height),
    );
    grad.addColorStop(0, '#1c2028');
    grad.addColorStop(1, '#0c0e12');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  private drawAimLine(_ctx: CanvasRenderingContext2D, _snap: RenderSnapshot): void {
  }

  private drawArena(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    const step = 80;
    for (let x = 0; x < this.width; x += step) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, this.height);
      ctx.stroke();
    }
    for (let y = 0; y < this.height; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(this.width, y + 0.5);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawTowerBase(ctx: CanvasRenderingContext2D, snap: RenderSnapshot): void {
    const t = snap.tower;
    ctx.save();
    ctx.fillStyle = '#3a4250';
    ctx.beginPath();
    ctx.arc(t.x, t.y, TOWER_VISUAL.bodyRadius + 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = TOWER_VISUAL.bodyColor;
    ctx.beginPath();
    ctx.arc(t.x, t.y, TOWER_VISUAL.bodyRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = TOWER_VISUAL.bodyStroke;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = TOWER_VISUAL.accentColor;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const px = t.x + Math.cos(a) * (TOWER_VISUAL.bodyRadius - 6);
      const py = t.y + Math.sin(a) * (TOWER_VISUAL.bodyRadius - 6);
      ctx.beginPath();
      ctx.arc(px, py, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawShield(ctx: CanvasRenderingContext2D, snap: RenderSnapshot): void {
    const t = snap.tower;
    if (t.shieldMaxCharges <= 0) return;
    const ratio = t.shieldCurrentCharges / t.shieldMaxCharges;
    if (ratio <= 0) return;
    const alpha = 0.15 + ratio * 0.25;
    const pulse = 1 + Math.sin(this.time * 2) * 0.03;
    const r = (TOWER_VISUAL.bodyRadius + 8) * pulse;
    ctx.save();
    ctx.strokeStyle = `rgba(100, 180, 255, ${alpha})`;
    ctx.lineWidth = 2 + ratio * 2;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.arc(t.x, t.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // charge dots when more than 1 charge
    if (t.shieldCurrentCharges > 1) {
      ctx.save();
      const dotR = r + 6;
      const count = t.shieldCurrentCharges;
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + this.time * 1.2;
        const dx = t.x + Math.cos(a) * dotR;
        const dy = t.y + Math.sin(a) * dotR;
        const glow = ctx.createRadialGradient(dx, dy, 0, dx, dy, 6);
        glow.addColorStop(0, 'rgba(180, 220, 255, 0.95)');
        glow.addColorStop(1, 'rgba(100, 180, 255, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(dx, dy, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#b4dcff';
        ctx.beginPath();
        ctx.arc(dx, dy, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  private drawWall(ctx: CanvasRenderingContext2D, snap: RenderSnapshot): void {
    const t = snap.tower;
    if (t.wallMaxHp <= 0) return;
    const ratio = Math.max(0, t.wallHp / t.wallMaxHp);
    if (ratio <= 0) return;
    const r = TOWER_VISUAL.bodyRadius + 40;
    const thickness = 4 + ratio * 4;
    const alpha = 0.3 + ratio * 0.4;
    ctx.save();
    ctx.strokeStyle = `rgba(150, 160, 170, ${alpha})`;
    ctx.lineWidth = thickness;
    ctx.beginPath();
    ctx.arc(t.x, t.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = `rgba(100, 110, 120, ${alpha * 0.6})`;
    ctx.lineWidth = thickness - 2;
    ctx.setLineDash([6, 8]);
    ctx.beginPath();
    ctx.arc(t.x, t.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private drawTowerTop(ctx: CanvasRenderingContext2D, snap: RenderSnapshot): void {
    const t = snap.tower;
    ctx.save();
    ctx.fillStyle = TOWER_VISUAL.roofColor;
    ctx.beginPath();
    ctx.moveTo(t.x, t.y - TOWER_VISUAL.bodyRadius - 18);
    ctx.lineTo(t.x - TOWER_VISUAL.bodyRadius + 2, t.y - TOWER_VISUAL.bodyRadius + 2);
    ctx.lineTo(t.x + TOWER_VISUAL.bodyRadius - 2, t.y - TOWER_VISUAL.bodyRadius + 2);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = TOWER_VISUAL.bodyStroke;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.strokeStyle = '#c0c4cc';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(t.x, t.y - TOWER_VISUAL.bodyRadius - 18);
    ctx.lineTo(t.x, t.y - TOWER_VISUAL.bodyRadius - 30);
    ctx.stroke();

    ctx.fillStyle = TOWER_VISUAL.flagColor;
    ctx.beginPath();
    ctx.moveTo(t.x, t.y - TOWER_VISUAL.bodyRadius - 30);
    ctx.lineTo(t.x + 10, t.y - TOWER_VISUAL.bodyRadius - 26);
    ctx.lineTo(t.x, t.y - TOWER_VISUAL.bodyRadius - 22);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private drawRangeRing(ctx: CanvasRenderingContext2D, snap: RenderSnapshot): void {
    const t = snap.tower;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(t.x, t.y, t.range, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Loot orbs (gameplay plan §4.1).
   *
   * Nothing here allocates: the body is a cached sprite blitted at a pulse
   * scale, and the only live work is the bob offset and, once an orb is nearly
   * home, a fading "about to auto-collect" ring so the player can see the
   * clock running on the full-value click.
   */
  private drawOrbs(ctx: CanvasRenderingContext2D, orbs: LootOrb[] | undefined): void {
    if (!orbs || orbs.length === 0) return;
    ctx.save();
    for (const orb of orbs) {
      if (!orb.alive) continue;
      const sprite = this.getOrbSprite(orb.kind);
      const pulse = 1 + Math.sin(this.time * 5 + orb.id) * 0.08;
      const bob = Math.sin(this.time * 3.4 + orb.id * 0.7) * 2;
      const size = sprite.width * pulse;
      ctx.drawImage(sprite, orb.x - size / 2, orb.y + bob - size / 2, size, size);
    }
    ctx.restore();
  }

  private getOrbSprite(kind: LootOrbKind): HTMLCanvasElement {
    const cached = this.orbSprites.get(kind);
    if (cached) return cached;
    const colors = LOOT_ORB_COLORS[kind];
    const r = LOOT_TUNING.orbRadius;
    const glowR = r * 2.4;
    const sprite = this.makeSprite(glowR * 2, (g) => {
      const grad = g.createRadialGradient(0, 0, r * 0.4, 0, 0, glowR);
      grad.addColorStop(0, colors.glow);
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(0, 0, glowR, 0, Math.PI * 2);
      g.fill();

      g.fillStyle = colors.core;
      g.beginPath();
      g.arc(0, 0, r, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(255, 255, 255, 0.75)';
      g.lineWidth = 1.5;
      g.stroke();

      // A highlight, plus a glyph so the three kinds are told apart by shape
      // as well as by colour.
      g.fillStyle = 'rgba(255, 255, 255, 0.55)';
      g.beginPath();
      g.arc(-r * 0.3, -r * 0.35, r * 0.28, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = colors.glyph;
      g.font = `bold ${Math.round(r * 1.2)}px sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(kind === 'gold' ? '$' : kind === 'mana' ? '\u2726' : '\u21bb', 0, r * 0.05);
    });
    this.orbSprites.set(kind, sprite);
    return sprite;
  }

  /**
   * The disc the next click will drop a targeted ability on (plan §4.3).
   *
   * Deliberately loud — a dashed ring plus a crosshair — because placement
   * mode changes what a click means, and an input state the player cannot see
   * is an input state they will fight.
   */
  private drawPlacement(ctx: CanvasRenderingContext2D, placement: RenderSnapshot['placement']): void {
    if (!placement) return;
    const { x, y, radius } = placement;
    ctx.save();
    ctx.strokeStyle = 'rgba(120, 220, 255, 0.85)';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.lineDashOffset = -this.time * 30;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(120, 220, 255, 0.10)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(220, 245, 255, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x - 10, y);
    ctx.lineTo(x + 10, y);
    ctx.moveTo(x, y - 10);
    ctx.lineTo(x, y + 10);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Spawn-edge markers for the coming wave (gameplay plan §7.3).
   *
   * These are the *real* spawn points from the pre-rolled roster, which is
   * what makes them worth drawing: an arrow pointing at an edge no enemy is
   * going to use would teach the player to ignore them. Drawn under the
   * enemies, so the last stragglers of the cleared wave still read on top.
   */
  private drawSpawnLanes(
    ctx: CanvasRenderingContext2D,
    lanes: RenderSnapshot['spawnLanes'],
  ): void {
    if (!lanes || lanes.length === 0) return;
    // A gentle pulse rather than a static mark: the intermission is short and
    // a still shape at the edge of the arena reads as scenery.
    const pulse = 0.55 + 0.35 * Math.sin(this.time * 4);
    ctx.save();
    for (const lane of lanes) {
      // Clamp to the arena edge — spawn points sit 20 px outside it.
      const x = Math.max(10, Math.min(this.width - 10, lane.x));
      const y = Math.max(10, Math.min(this.height - 10, lane.y));
      const dx = this.towerX - x;
      const dy = this.towerY - y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      ctx.strokeStyle = `rgba(255, 150, 110, ${(0.5 * pulse).toFixed(3)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + ux * 26, y + uy * 26);
      ctx.stroke();
      // Arrowhead pointing the way the lane will come in.
      const tipX = x + ux * 32;
      const tipY = y + uy * 32;
      ctx.fillStyle = `rgba(255, 170, 130, ${(0.6 * pulse).toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(x + ux * 20 - uy * 7, y + uy * 20 + ux * 7);
      ctx.lineTo(x + ux * 20 + uy * 7, y + uy * 20 - ux * 7);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * The charged-shot ring at the cursor (plan §4.2).
   *
   * Three states in one ring: filling while the hold builds, a bright pulsing
   * ring once it is armed, and a dim draining ring while it is on cooldown.
   */
  private drawChargeRing(ctx: CanvasRenderingContext2D, charge: RenderSnapshot['charge']): void {
    if (!charge) return;
    const { x, y, progress, cooldown, ready } = charge;
    const r = 26;
    ctx.save();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();

    if (cooldown > 0) {
      ctx.strokeStyle = 'rgba(150, 170, 190, 0.5)';
      ctx.beginPath();
      ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * cooldown);
      ctx.stroke();
      ctx.restore();
      return;
    }

    const pulse = ready ? 1 + Math.sin(this.time * 12) * 0.12 : 1;
    ctx.strokeStyle = ready ? 'rgba(140, 230, 255, 0.95)' : 'rgba(110, 190, 255, 0.7)';
    ctx.lineWidth = ready ? 4 : 3;
    ctx.beginPath();
    ctx.arc(x, y, r * pulse, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
    ctx.stroke();
    if (ready) {
      ctx.fillStyle = 'rgba(140, 230, 255, 0.16)';
      ctx.beginPath();
      ctx.arc(x, y, r * pulse, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawMines(ctx: CanvasRenderingContext2D, mines: Mine[]): void {
    ctx.save();
    for (const m of mines) {
      if (!m.alive) continue;
      const pulse = 0.85 + Math.sin(this.time * 3 + m.id) * 0.15;
      ctx.fillStyle = '#cc4422';
      ctx.beginPath();
      ctx.arc(m.x, m.y, 6 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ff8844';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(m.x, m.y, 6 * pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 60, 20, 0.25)';
      ctx.beginPath();
      ctx.arc(m.x, m.y, 10 * pulse, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * Allocate an offscreen canvas of `size` px square with the origin moved to
   * its centre, so a painter can draw in the same coordinates it would use
   * around an enemy at (0, 0).
   */
  private makeSprite(size: number, paint: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement {
    const px = Math.max(2, Math.ceil(size));
    const c = document.createElement('canvas');
    c.width = px;
    c.height = px;
    const g = c.getContext('2d')!;
    g.translate(px / 2, px / 2);
    paint(g);
    return c;
  }

  /** Radius an enemy of this type renders at, elite scaling included. */
  private enemyDrawRadius(enemy: Enemy): number {
    return ENEMY_DEFS[enemy.type].radius * (enemy.elite ? ELITE_RADIUS_SCALE : 1);
  }

  private getEnemySprite(enemy: Enemy): HTMLCanvasElement {
    const enraged = enemy.type === 'boss' && enemy.enraged === true;
    // A burrower reads completely differently above and below ground, so the
    // two are separate cache entries rather than one sprite plus a live tint.
    const buried = enemy.burrowed === true;
    const key = `${enemy.type}|${enemy.elite ? 1 : 0}|${enraged ? 1 : 0}|${buried ? 1 : 0}`;
    const cached = this.enemySprites.get(key);
    if (cached) return cached;
    const def = ENEMY_DEFS[enemy.type];
    const r = this.enemyDrawRadius(enemy);
    const sprite = this.makeSprite((r + SPRITE_PADDING) * 2, (g) => {
      this.paintEnemyBody(g, enemy.type, def, r, enraged, buried);
    });
    this.enemySprites.set(key, sprite);
    return sprite;
  }

  /**
   * Paint an enemy body centred on the origin: fill, outline and whatever
   * static decoration the type carries. The winged type's flapping wings are
   * deliberately absent — they are animated, so they are drawn live.
   */
  private paintEnemyBody(
    ctx: CanvasRenderingContext2D,
    type: Enemy['type'],
    def: EnemyDef,
    r: number,
    enraged: boolean,
    buried: boolean = false,
  ): void {
    // Boss enrage colour shift: the body turns red below 50% HP. The check is
    // hoisted out of the shape switch on purpose — it used to live only in the
    // `diamond` branch, and since no boss uses that shape, an enraged boss
    // never actually changed colour. Applying it per body colour rather than
    // per shape means it fires whatever shape a boss is given later.
    const bodyColor = type === 'boss' && enraged ? ENRAGED_BOSS_COLOR : def.color;
    switch (def.shape) {
      case 'diamond':
        ctx.fillStyle = bodyColor;
        ctx.beginPath();
        ctx.moveTo(0, -r);
        ctx.lineTo(r, 0);
        ctx.lineTo(0, r);
        ctx.lineTo(-r, 0);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = def.borderColor;
        ctx.lineWidth = 2;
        ctx.stroke();
        // Splitter gets a small inner core dot to make it stand out
        if (type === 'splitter') {
          ctx.fillStyle = 'rgba(255,255,255,0.55)';
          ctx.beginPath();
          ctx.arc(0, 0, 3, 0, Math.PI * 2);
          ctx.fill();
        }
        if (def.glyph) {
          ctx.fillStyle = def.borderColor;
          ctx.font = `bold ${Math.round(r * 0.95)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(def.glyph, 0, 1);
        }
        break;
      case 'winged':
        ctx.fillStyle = bodyColor;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = def.borderColor;
        ctx.lineWidth = 2;
        ctx.stroke();
        break;
      // Siege: a blunt, flat-sided chassis with a barrel — it reads as a
      // machine parked at range rather than something running at you.
      case 'square': {
        ctx.fillStyle = bodyColor;
        ctx.fillRect(-r, -r * 0.85, r * 2, r * 1.7);
        ctx.strokeStyle = def.borderColor;
        ctx.lineWidth = 2.5;
        ctx.strokeRect(-r, -r * 0.85, r * 2, r * 1.7);
        ctx.fillStyle = def.borderColor;
        ctx.fillRect(-r * 0.25, -r * 1.5, r * 0.5, r * 0.8);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(-r * 0.75, -r * 0.25, r * 1.5, r * 0.5);
        break;
      }
      // Warden: a hexagon, the same shape as the ward it projects, so the
      // shield rings on its allies point straight back at the source.
      case 'hex': {
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
          const px = Math.cos(a) * r;
          const py = Math.sin(a) * r;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fillStyle = bodyColor;
        ctx.fill();
        ctx.strokeStyle = def.borderColor;
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
          const px = Math.cos(a) * (r * 0.5);
          const py = Math.sin(a) * (r * 0.5);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
        break;
      }
      // Burrower: a low earth mound while underground, a clawed dome once it
      // is up. Two different silhouettes on purpose — the whole point of the
      // type is that you can tell at a glance whether it can be shot.
      case 'mound': {
        if (buried) {
          ctx.fillStyle = '#4a3a22';
          ctx.beginPath();
          ctx.ellipse(0, r * 0.25, r * 1.15, r * 0.6, 0, Math.PI, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(216, 181, 120, 0.5)';
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.fillStyle = 'rgba(0,0,0,0.35)';
          ctx.beginPath();
          ctx.ellipse(0, r * 0.25, r * 0.5, r * 0.2, 0, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        ctx.fillStyle = bodyColor;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = def.borderColor;
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.strokeStyle = def.borderColor;
        ctx.lineWidth = 2;
        for (const dir of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(dir * r * 0.35, -r * 0.15);
          ctx.lineTo(dir * r * 0.95, -r * 0.75);
          ctx.stroke();
        }
        break;
      }
      case 'circle': {
        ctx.fillStyle = bodyColor;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = def.borderColor;
        ctx.lineWidth = type === 'tank' ? 4 : type === 'boss' ? 3 : 2;
        ctx.stroke();
        if (def.glyph) {
          ctx.fillStyle = '#fff';
          ctx.font = `bold ${r}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(def.glyph, 0, 1);
        }
        if (type === 'tank') {
          ctx.strokeStyle = 'rgba(255,255,255,0.18)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(0, 0, r - 4, 0, Math.PI * 2);
          ctx.stroke();
        }
        break;
      }
      default: {
        // Closed union (cross-cutting rule 3): a new shape has to be drawn
        // before it can be given to an enemy.
        const exhaustive: never = def.shape;
        return exhaustive;
      }
    }
  }

  /**
   * Ground shadow, keyed by radius so the eight enemy types share four or five
   * sprites between them.
   */
  private getShadowSprite(r: number): HTMLCanvasElement {
    const key = r.toFixed(1);
    const cached = this.shadowSprites.get(key);
    if (cached) return cached;
    const sprite = this.makeSprite(r * 2, (g) => {
      const grad = g.createRadialGradient(0, 0, 0, 0, 0, r * 0.9);
      grad.addColorStop(0, 'rgba(0,0,0,0.35)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.ellipse(0, 0, r * 0.85, r * 0.3, 0, 0, Math.PI * 2);
      g.fill();
    });
    this.shadowSprites.set(key, sprite);
    return sprite;
  }

  /**
   * A radial glow, painted once at its unpulsed size and scaled by `drawImage`
   * at draw time.
   *
   * The live version recomputed the gradient every frame so that its inner
   * stop stayed at a fixed radius while the outer one pulsed; scaling the
   * whole sprite instead moves the inner stop by the same few percent, which
   * is not visible against a +/-12% pulse on a soft gradient.
   */
  private getAuraSprite(key: string, radius: number, inner: number, stops: [number, string][]): HTMLCanvasElement {
    const cached = this.auraSprites.get(key);
    if (cached) return cached;
    const sprite = this.makeSprite(radius * 2, (g) => {
      const grad = g.createRadialGradient(0, 0, inner, 0, 0, radius);
      for (const [offset, color] of stops) grad.addColorStop(offset, color);
      g.fillStyle = grad;
      g.beginPath();
      g.arc(0, 0, radius, 0, Math.PI * 2);
      g.fill();
    });
    this.auraSprites.set(key, sprite);
    return sprite;
  }

  /** Blit a cached glow centred on a point, scaled by the caller's pulse. */
  private drawAuraSprite(ctx: CanvasRenderingContext2D, sprite: HTMLCanvasElement, x: number, y: number, scale: number): void {
    const size = sprite.width * scale;
    ctx.drawImage(sprite, x - size / 2, y - size / 2, size, size);
  }

  private drawEnemies(ctx: CanvasRenderingContext2D, enemies: Enemy[]): void {
    // Ward links are drawn first so they read as a lattice *under* the bodies
    // rather than as lines crossing over them.
    this.drawWardLinks(ctx, enemies);
    for (const e of enemies) {
      if (!e.alive) continue;
      this.drawAfterImage(ctx, e);
      this.drawEnemyShadow(ctx, e);
      this.drawEnemy(ctx, e);
    }
  }

  /**
   * Hexagonal lattice joining each warden to the allies it is shielding
   * (plan §2.5).
   *
   * A direct scan per warden, the same call the aura passes make: a wave holds
   * a handful of wardens, so this is O(wardens x n) and allocates nothing.
   */
  private drawWardLinks(ctx: CanvasRenderingContext2D, enemies: Enemy[]): void {
    let anyWarden = false;
    for (const w of enemies) {
      if (w.alive && w.type === 'warden') { anyWarden = true; break; }
    }
    if (!anyWarden) return;
    const pulse = 0.3 + Math.sin(this.time * 3) * 0.12;
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = `rgba(90, 220, 240, ${pulse})`;
    for (const w of enemies) {
      if (!w.alive || w.type !== 'warden') continue;
      for (const ally of enemies) {
        if (!ally.alive || ally.wardenId !== w.id) continue;
        if ((ally.absorbShield ?? 0) <= 0) continue;
        ctx.beginPath();
        ctx.moveTo(w.x, w.y);
        ctx.lineTo(ally.x, ally.y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /** Blinker: a fading ghost at the position it teleported away from. */
  private drawAfterImage(ctx: CanvasRenderingContext2D, enemy: Enemy): void {
    const age = enemy.afterImageAge;
    if (age === undefined || age >= AFTER_IMAGE_LIFE) return;
    if (enemy.afterImageX === undefined || enemy.afterImageY === undefined) return;
    const fade = 1 - age / AFTER_IMAGE_LIFE;
    const sprite = this.getEnemySprite(enemy);
    const half = sprite.width / 2;
    ctx.save();
    ctx.globalAlpha = fade * 0.45;
    ctx.drawImage(sprite, enemy.afterImageX - half, enemy.afterImageY - half);
    ctx.restore();
    // A short streak between the two positions, so the eye can follow the jump.
    ctx.save();
    ctx.globalAlpha = fade * 0.35;
    ctx.strokeStyle = ENEMY_DEFS.blinker.borderColor;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 5]);
    ctx.beginPath();
    ctx.moveTo(enemy.afterImageX, enemy.afterImageY);
    ctx.lineTo(enemy.x, enemy.y);
    ctx.stroke();
    ctx.restore();
  }

  private drawEnemyShadow(ctx: CanvasRenderingContext2D, enemy: Enemy): void {
    if (enemy.type === 'flying') return;
    const r = ENEMY_DEFS[enemy.type].radius;
    const sprite = this.getShadowSprite(r);
    const half = sprite.width / 2;
    ctx.drawImage(sprite, enemy.x - half, enemy.y + r * 0.6 - half);
  }

  private drawEnemy(ctx: CanvasRenderingContext2D, enemy: Enemy): void {
    const r = this.enemyDrawRadius(enemy);
    let bob = 0;
    if (enemy.type === 'flying') {
      bob = Math.sin(this.time * 5 + enemy.id * 0.7) * 3;
    }

    // Elite aura (drawn behind the enemy body)
    if (enemy.elite && enemy.aura) {
      this.drawEliteAura(ctx, enemy, r, enemy.aura);
    }

    if (enemy.type === 'boss') {
      this.drawBossAura(ctx, enemy, r);
    } else if (enemy.type === 'healer') {
      this.drawHealerAura(ctx, enemy, r);
    }

    // Body: one blit of a cached sprite. The pulse is a transform around the
    // enemy's centre rather than a repaint at a different size.
    let pulse = 1;
    if (enemy.type === 'boss') pulse = 1 + Math.sin(this.time * 4) * 0.08;
    else if (enemy.type === 'splitter') pulse = 1 + Math.sin(this.time * 3 + enemy.id) * 0.05;

    const sprite = this.getEnemySprite(enemy);
    const half = sprite.width / 2;
    ctx.save();
    ctx.translate(enemy.x, enemy.y + bob);
    if (pulse !== 1) ctx.scale(pulse, pulse);
    ctx.drawImage(sprite, -half, -half);
    ctx.restore();

    // Wings flap, so they cannot be baked into the body sprite.
    if (ENEMY_DEFS[enemy.type].shape === 'winged') {
      this.drawWings(ctx, enemy, r, bob);
    }

    // Shielded: orbiting shield segments (arcs) when charges > 0
    if (enemy.type === 'shielded' && (enemy.shieldCharges ?? 0) > 0) {
      this.drawShieldArcs(ctx, enemy, r);
    }

    // Elite crown
    if (enemy.elite && enemy.aura) {
      this.drawEliteCrown(ctx, enemy, r, bob);
    }

    // ── behavioural reads (plan §2.5) ──
    if ((enemy.absorbShield ?? 0) > 0) this.drawWardRing(ctx, enemy, r, bob);
    if (enemy.type === 'siege' && enemy.siegeHalted) this.drawSiegeStance(ctx, enemy, r);
    if (enemy.type === 'thief' && (enemy.stolenGold ?? 0) > 0) this.drawThiefLoot(ctx, enemy, r);
    if (enemy.type === 'burrower') this.drawBurrowerState(ctx, enemy, r);
    if (enemy.type === 'boss') this.drawBossState(ctx, enemy, r);

    // Retribution buff indicator (pulsing purple border)
    if (enemy.retributionTimer && enemy.retributionTimer > 0) {
      const p = 0.4 + Math.sin(this.time * 8) * 0.3;
      ctx.save();
      ctx.strokeStyle = `rgba(180, 50, 220, ${p})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(enemy.x, enemy.y + bob, r + 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    this.drawEnemyHpBar(ctx, enemy, r, bob);
  }

  private drawWings(ctx: CanvasRenderingContext2D, enemy: Enemy, r: number, bob: number): void {
    const def = ENEMY_DEFS[enemy.type];
    const wingFlap = Math.sin(this.time * 12 + enemy.id) * 0.4;
    ctx.save();
    ctx.fillStyle = def.borderColor;
    for (const dir of [-1, 1]) {
      ctx.save();
      ctx.translate(enemy.x, enemy.y + bob);
      ctx.rotate(wingFlap * dir);
      ctx.beginPath();
      ctx.moveTo(r * dir, 0);
      ctx.lineTo((r + 9) * dir, -6);
      ctx.lineTo((r + 4) * dir, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  private drawHealerAura(ctx: CanvasRenderingContext2D, enemy: Enemy, r: number): void {
    const pulse = 1 + Math.sin(this.time * 2.5 + enemy.id) * 0.12;
    const sprite = this.getAuraSprite(`healer|${r}`, r * 2.0, r * 0.7, [
      [0, 'rgba(80, 220, 120, 0.22)'],
      [0.6, 'rgba(39, 174, 96, 0.08)'],
      [1, 'rgba(0,0,0,0)'],
    ]);
    this.drawAuraSprite(ctx, sprite, enemy.x, enemy.y, pulse);
  }

  private drawEliteAura(ctx: CanvasRenderingContext2D, enemy: Enemy, r: number, aura: AuraType): void {
    const color = ELITE_AURA_COLORS[aura];
    const pulse = 1 + Math.sin(this.time * 3 + enemy.id) * 0.15;
    const auraR = AURA_RADIUS * 0.6; // visual radius scaled down for display
    const sprite = this.getAuraSprite(`elite|${aura}|${r}`, auraR, r * 0.5, [
      [0, color],
      [0.7, color.replace(/[\d.]+\)$/, '0.08)')],
      [1, 'rgba(0,0,0,0)'],
    ]);
    this.drawAuraSprite(ctx, sprite, enemy.x, enemy.y, pulse);
  }

  private drawEliteCrown(ctx: CanvasRenderingContext2D, enemy: Enemy, r: number, bob: number): void {
    const color = ELITE_CROWN_COLORS[enemy.aura!] ?? '#fff';
    const size = Math.max(10, r * 0.7);
    const key = `${color}|${size.toFixed(1)}`;
    let sprite = this.crownSprites.get(key);
    if (!sprite) {
      // The glow pass is a second fillText under a shadow blur, which is one
      // of the most expensive things a 2D context does; baking it means an
      // elite costs a blit rather than two blurred glyph rasterisations.
      sprite = this.makeSprite(size * 2 + 16, (g) => {
        g.fillStyle = color;
        g.font = `bold ${size}px sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('♛', 0, 0);
        g.shadowColor = color;
        g.shadowBlur = 6;
        g.fillText('♛', 0, 0);
      });
      this.crownSprites.set(key, sprite);
    }
    const half = sprite.width / 2;
    ctx.drawImage(sprite, enemy.x - half, enemy.y - r - 12 + bob - half);
  }

  private drawShieldArcs(ctx: CanvasRenderingContext2D, enemy: Enemy, r: number): void {
    const charges = enemy.shieldCharges ?? 0;
    if (charges <= 0) return;
    const total = 3; // max charges
    const segAngle = (Math.PI * 2) / total;
    const startOffset = -Math.PI / 2;
    const inner = r + 3;
    const outer = r + 9;
    ctx.save();
    ctx.translate(enemy.x, enemy.y);
    ctx.rotate(this.time * 1.4 + enemy.id);
    for (let i = 0; i < charges; i++) {
      const a0 = startOffset + i * segAngle + 0.08;
      const a1 = startOffset + (i + 1) * segAngle - 0.08;
      ctx.beginPath();
      ctx.arc(0, 0, inner, a0, a1);
      ctx.arc(0, 0, outer, a1, a0, true);
      ctx.closePath();
      ctx.fillStyle = 'rgba(93, 173, 226, 0.65)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(180, 220, 255, 0.9)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawBossAura(ctx: CanvasRenderingContext2D, enemy: Enemy, r: number): void {
    // P5: enrage makes the aura pulse faster and brighter
    const enraged = enemy.enraged === true;
    const speed = enraged ? 7 : 3;
    const pulse = 1 + Math.sin(this.time * speed) * (enraged ? 0.22 : 0.12);
    const innerColor = enraged ? 'rgba(255, 80, 80, 0.55)' : 'rgba(255, 60, 60, 0.28)';
    const midColor = enraged ? 'rgba(220, 30, 30, 0.20)' : 'rgba(160, 0, 0, 0.10)';
    const sprite = this.getAuraSprite(`boss|${enraged ? 1 : 0}|${r}`, r * 2.4, r * 0.7, [
      [0, innerColor],
      [0.6, midColor],
      [1, 'rgba(0,0,0,0)'],
    ]);
    this.drawAuraSprite(ctx, sprite, enemy.x, enemy.y, pulse);
  }

  /**
   * Warden ward: a hexagonal shell around whoever is carrying the absorb pool,
   * sized to what is left of it, so the player can watch it come off.
   */
  private drawWardRing(ctx: CanvasRenderingContext2D, enemy: Enemy, r: number, bob: number): void {
    const max = enemy.absorbMax ?? 0;
    if (max <= 0) return;
    const ratio = Math.max(0, Math.min(1, (enemy.absorbShield ?? 0) / max));
    const radius = r + 6;
    ctx.save();
    ctx.translate(enemy.x, enemy.y + bob);
    ctx.strokeStyle = `rgba(90, 220, 240, ${0.35 + ratio * 0.45})`;
    ctx.lineWidth = 1.5 + ratio * 2;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 - Math.PI / 2 + this.time * 0.6;
      const px = Math.cos(a) * radius;
      const py = Math.sin(a) * radius;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Siege: a dashed standoff ring and a reload arc while it is halted.
   *
   * The ring is what tells a short-range build *why* it is losing HP with
   * nothing in range — the answer the type demands is more range, and the
   * player cannot reach for it if they cannot see the problem.
   */
  private drawSiegeStance(ctx: CanvasRenderingContext2D, enemy: Enemy, r: number): void {
    ctx.save();
    ctx.strokeStyle = 'rgba(240, 190, 110, 0.28)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([7, 9]);
    ctx.beginPath();
    ctx.arc(enemy.x, enemy.y, r + 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    // Reload arc: a full sweep means the next shell is about to leave.
    const reload = ENEMY_BEHAVIOR.siegeReload;
    const remaining = Math.max(0, Math.min(reload, enemy.siegeCooldown ?? reload));
    const progress = 1 - remaining / reload;
    if (progress > 0) {
      ctx.strokeStyle = 'rgba(255, 170, 60, 0.85)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(enemy.x, enemy.y, r + 8, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Boss encounter reads (gameplay plan §3.5).
   *
   * The bar carries the numbers; this carries the *where*. A slam telegraph in
   * particular has to be on the field — the answer to it is a cooldown aimed at
   * the boss, and a countdown at the top of the screen does not tell the player
   * which of six bosses to aim it at.
   *
   * Everything here is stroked arcs and lines: no gradients, no allocation.
   */
  private drawBossState(ctx: CanvasRenderingContext2D, enemy: Enemy, r: number): void {
    // Phase flash: a white shell for the moment it cannot be shot.
    const invuln = enemy.bossInvulnerable ?? 0;
    if (invuln > 0) {
      const t = invuln / BOSS_ENCOUNTER.phaseInvulnerability;
      ctx.save();
      ctx.strokeStyle = `rgba(255, 240, 190, ${0.35 + t * 0.5})`;
      ctx.lineWidth = 3 + t * 3;
      ctx.beginPath();
      ctx.arc(enemy.x, enemy.y, r + 10 + (1 - t) * 26, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Bulwark: a ring whose sweep is what is left of the shield.
    const shieldMax = enemy.bossShieldMax ?? 0;
    const shield = enemy.bossShield ?? 0;
    if (shieldMax > 0 && shield > 0) {
      const ratio = Math.max(0, Math.min(1, shield / shieldMax));
      ctx.save();
      ctx.strokeStyle = 'rgba(120, 210, 255, 0.85)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(enemy.x, enemy.y, r + 7, -Math.PI / 2, -Math.PI / 2 + ratio * Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Slam: a ground ring that closes in as the telegraph runs out, so the
    // "how long have I got" read is spatial and does not need a glance away.
    const telegraph = enemy.bossSlamTelegraph ?? 0;
    if (telegraph > 0) {
      const progress = 1 - telegraph / BOSS_ENCOUNTER.slamTelegraph;
      const mitigated = enemy.bossSlamMitigated === true;
      const outer = r + 20 + (1 - progress) * 90;
      ctx.save();
      ctx.strokeStyle = mitigated
        ? `rgba(140, 220, 255, ${0.5 + progress * 0.4})`
        : `rgba(255, 110, 50, ${0.45 + progress * 0.5})`;
      ctx.lineWidth = 3 + progress * 4;
      ctx.beginPath();
      ctx.arc(enemy.x, enemy.y, outer, 0, Math.PI * 2);
      ctx.stroke();
      // A filling inner disc outline, so the last half-second is unmistakable.
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 8]);
      ctx.beginPath();
      ctx.arc(enemy.x, enemy.y, r + 20 + progress * 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // Siphon: a live beam to the tower. Drawn from state rather than from an
    // event, because the drain is continuous and per-substep events would be
    // six particle bursts a frame for one effect.
    if (enemy.bossPattern === 'siphon' && invuln <= 0) {
      const pulse = 0.35 + Math.sin(this.time * 9 + enemy.id) * 0.2;
      ctx.save();
      ctx.strokeStyle = `rgba(150, 110, 255, ${pulse})`;
      ctx.lineWidth = 2.5;
      ctx.setLineDash([10, 8]);
      ctx.lineDashOffset = -this.time * 90;
      ctx.beginPath();
      ctx.moveTo(this.towerX, this.towerY);
      ctx.lineTo(enemy.x, enemy.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  }

  /** Thief: a coin it is visibly carrying, plus an arrow along its escape route. */
  private drawThiefLoot(ctx: CanvasRenderingContext2D, enemy: Enemy, r: number): void {
    const sprite = this.getCoinSprite();
    const half = sprite.width / 2;
    const bounce = Math.sin(this.time * 8 + enemy.id) * 2;
    ctx.drawImage(sprite, enemy.x - half, enemy.y - r - 12 + bounce - half);
    if (!enemy.fleeing) return;
    // Direction of travel, taken from the last frame's displacement rather
    // than stored on the enemy: the flee vector is simulation state and the
    // renderer has no business owning a copy of it.
    const dx = enemy.x - (enemy.afterImageX ?? enemy.x);
    const dy = enemy.y - (enemy.afterImageY ?? enemy.y);
    const angle = dx === 0 && dy === 0
      ? Math.atan2(enemy.y - this.height / 2, enemy.x - this.width / 2)
      : Math.atan2(dy, dx);
    ctx.save();
    ctx.translate(enemy.x, enemy.y);
    ctx.rotate(angle);
    ctx.fillStyle = 'rgba(255, 220, 100, 0.9)';
    ctx.beginPath();
    ctx.moveTo(r + 14, 0);
    ctx.lineTo(r + 4, -6);
    ctx.lineTo(r + 4, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /**
   * Burrower: a dust plume while it is underground and untouchable, and a
   * one-second expanding ring as it breaks the surface.
   */
  private drawBurrowerState(ctx: CanvasRenderingContext2D, enemy: Enemy, r: number): void {
    if (enemy.burrowed === true) {
      const sprite = this.getAuraSprite(`burrow|${r}`, r * 2.2, r * 0.3, [
        [0, 'rgba(160, 130, 80, 0.30)'],
        [0.65, 'rgba(120, 95, 55, 0.12)'],
        [1, 'rgba(0,0,0,0)'],
      ]);
      const pulse = 1 + Math.sin(this.time * 6 + enemy.id) * 0.14;
      this.drawAuraSprite(ctx, sprite, enemy.x, enemy.y + r * 0.3, pulse);
      return;
    }
    const surfacing = enemy.surfacing ?? 0;
    if (surfacing <= 0) return;
    const progress = 1 - surfacing / ENEMY_BEHAVIOR.burrowTelegraph;
    ctx.save();
    ctx.strokeStyle = `rgba(230, 180, 100, ${0.75 * (1 - progress)})`;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(enemy.x, enemy.y, r + 6 + progress * 42, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /** The coin a loaded thief carries. Cached — it is static. */
  private getCoinSprite(): HTMLCanvasElement {
    const cached = this.enemySprites.get('#coin');
    if (cached) return cached;
    const sprite = this.makeSprite(20, (g) => {
      g.fillStyle = '#ffd24a';
      g.beginPath();
      g.arc(0, 0, 7, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#7a5a00';
      g.lineWidth = 1.5;
      g.stroke();
      g.fillStyle = '#7a5a00';
      g.font = 'bold 9px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('$', 0, 1);
    });
    this.enemySprites.set('#coin', sprite);
    return sprite;
  }

  /**
   * Incoming siege shells (plan §2.1).
   *
   * Drawn as a body on a parabolic lift above the straight line it actually
   * travels, plus a ground marker at the impact point: the arc is the
   * telegraph, and the marker is what makes it obvious the tower is about to
   * be hit by something no amount of knockback will stop.
   */
  private drawHostileShots(ctx: CanvasRenderingContext2D, shots: HostileShot[]): void {
    if (shots.length === 0) return;
    ctx.save();
    for (const s of shots) {
      if (!s.alive) continue;
      const progress = s.travel > 0 ? 1 - s.remaining / s.travel : 1;
      const lift = Math.sin(Math.max(0, Math.min(1, progress)) * Math.PI) * 46;
      const dx = s.vx * s.remaining;
      const dy = s.vy * s.remaining;
      const landX = s.x + dx;
      const landY = s.y + dy;

      // Impact marker, tightening as the shell comes down.
      ctx.strokeStyle = `rgba(255, 120, 50, ${0.25 + progress * 0.5})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(landX, landY, 6 + (1 - progress) * 26, 0, Math.PI * 2);
      ctx.stroke();

      // Ground shadow directly under the shell.
      ctx.fillStyle = 'rgba(0,0,0,0.30)';
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, 5, 2.5, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#ff8a3c';
      ctx.beginPath();
      ctx.arc(s.x, s.y - lift, 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#5a2a00';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawEnemyHpBar(ctx: CanvasRenderingContext2D, enemy: Enemy, r: number, bob: number): void {
    if (enemy.hp >= enemy.maxHp) return;
    const barW = Math.max(20, r * 2);
    const barH = enemy.type === 'boss' ? 6 : 4;
    const x = enemy.x - barW / 2;
    const y = enemy.y - r - 10 + bob;
    const ratio = Math.max(0, enemy.hp / enemy.maxHp);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x, y, barW, barH);
    ctx.fillStyle = ratio > 0.5 ? '#3ec46d' : ratio > 0.25 ? '#e8a93b' : '#d04848';
    ctx.fillRect(x, y, barW * ratio, barH);
    if (enemy.type === 'boss') {
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 0.5, y - 0.5, barW + 1, barH + 1);
    }
  }

  private drawProjectiles(ctx: CanvasRenderingContext2D, projectiles: Projectile[]): void {
    for (const p of projectiles) {
      if (!p.alive) continue;
      if (p.damageType === 'magic') {
        if (!this.magicProjectileSprite) {
          this.magicProjectileSprite = this.makeSprite(16, (g) => {
            const grad = g.createRadialGradient(0, 0, 0, 0, 0, 8);
            grad.addColorStop(0, '#e0b3ff');
            grad.addColorStop(1, 'rgba(120, 60, 200, 0)');
            g.fillStyle = grad;
            g.beginPath();
            g.arc(0, 0, 8, 0, Math.PI * 2);
            g.fill();
            g.fillStyle = '#9b59ff';
            g.beginPath();
            g.arc(0, 0, 3, 0, Math.PI * 2);
            g.fill();
          });
        }
        ctx.drawImage(this.magicProjectileSprite, p.x - 8, p.y - 8);
      } else {
        const angle = Math.atan2(p.vy, p.vx);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(angle);
        ctx.fillStyle = '#f7d774';
        ctx.beginPath();
        ctx.moveTo(8, 0);
        ctx.lineTo(-6, 4);
        ctx.lineTo(-6, -4);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#7a5a00';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  private drawParticles(ctx: CanvasRenderingContext2D, particles: Particle[], layer: 'behind' | 'front'): void {
    ctx.save();
    for (const p of particles) {
      const lifeRatio = 1 - p.age / p.life;
      if (lifeRatio <= 0) continue;
      if (layer === 'front' && p.color.startsWith('rgba(255, 255, 255')) continue;
      ctx.globalAlpha = lifeRatio;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawShockwaves(ctx: CanvasRenderingContext2D, shockwaves: Shockwave[]): void {
    ctx.save();
    for (const s of shockwaves) {
      const lifeRatio = 1 - s.age / s.life;
      if (lifeRatio <= 0) continue;
      ctx.globalAlpha = lifeRatio;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.lineWidth;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.currentRadius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawChainLightning(
    ctx: CanvasRenderingContext2D,
    paths: { points: { x: number; y: number }[]; age: number; life: number }[] | undefined,
  ): void {
    if (!paths || paths.length === 0) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const path of paths) {
      const lifeRatio = 1 - path.age / path.life;
      if (lifeRatio <= 0) continue;
      const points = path.points;
      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i];
        const b = points[i + 1];
        // Outer glow stroke
        ctx.globalAlpha = lifeRatio * 0.55;
        ctx.strokeStyle = 'rgba(120, 160, 255, 0.85)';
        ctx.lineWidth = 5;
        ctx.beginPath();
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const segLen = Math.sqrt(dx * dx + dy * dy);
        const jag = 5;
        ctx.moveTo(a.x, a.y);
        const steps = Math.max(2, Math.floor(segLen / 12));
        for (let s = 1; s <= steps; s++) {
          const tt = s / steps;
          const px = a.x + dx * tt;
          const py = a.y + dy * tt;
          const ox = (Math.random() - 0.5) * jag;
          const oy = (Math.random() - 0.5) * jag;
          ctx.lineTo(px + ox, py + oy);
        }
        ctx.stroke();
        // Inner bright stroke
        ctx.globalAlpha = lifeRatio;
        ctx.strokeStyle = 'rgba(235, 245, 255, 1)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private drawDamageNumbers(ctx: CanvasRenderingContext2D, numbers: DamageNumber[]): void {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const d of numbers) {
      const lifeRatio = 1 - d.age / d.life;
      if (lifeRatio <= 0) continue;
      const fadeIn = Math.min(1, d.age / 0.08);
      const alpha = Math.min(lifeRatio * 1.4, 1) * fadeIn;
      ctx.globalAlpha = alpha;
      const size = d.isCrit ? 22 : 15;
      ctx.font = `${d.isCrit ? '700 ' : '600 '}${size}px sans-serif`;
      ctx.lineWidth = d.isCrit ? 3.5 : 2.5;
      ctx.strokeStyle = d.isHeal ? '#0a3a1a' : '#3a0000';
      ctx.fillStyle = d.isHeal ? '#3edc81' : d.isCrit ? '#ffe27a' : '#ffffff';
      const jitterX = (1 - lifeRatio) * (d.isCrit ? 0 : ((d.amount % 7) - 3) * 0.6);
      ctx.strokeText(formatInt(d.amount), d.x + jitterX, d.y);
      ctx.fillText(formatInt(d.amount), d.x + jitterX, d.y);
      if (d.isCrit) {
        ctx.globalAlpha = alpha * 0.7;
        ctx.font = `800 ${size + 4}px sans-serif`;
        ctx.fillStyle = '#ff5050';
        ctx.fillText('!', d.x + jitterX - size * 0.9, d.y - 2);
      }
    }
    ctx.restore();
  }

  private drawWaveBanner(ctx: CanvasRenderingContext2D, snap: RenderSnapshot): void {
    if (snap.wave.intermission) {
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, 0, this.width, 50);
      ctx.fillStyle = '#f0f0f0';
      ctx.font = '600 22px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const secs = Math.max(0, Math.ceil(snap.wave.intermissionTimer));
      const willAdvance = snap.wave.autoProgress || isBossWave(snap.wave.number);
      ctx.fillText(`Wave ${snap.wave.number} cleared — ${willAdvance ? 'next' : 'restarting'} wave in ${secs}s`, this.width / 2, 25);
      ctx.restore();
    } else if (isBossWave(snap.wave.number)) {
      const pulse = 0.5 + Math.sin(this.time * 4) * 0.15;
      ctx.save();
      const grad = ctx.createLinearGradient(0, 0, this.width, 0);
      grad.addColorStop(0, 'rgba(120,0,0,0.0)');
      grad.addColorStop(0.5, `rgba(160, 20, 20, ${0.55 + pulse * 0.2})`);
      grad.addColorStop(1, 'rgba(120,0,0,0.0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, this.width, 60);
      ctx.fillStyle = '#ff8a8a';
      ctx.font = '800 26px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`BOSS WAVE ${snap.wave.number}`, this.width / 2, 30);
      ctx.fillStyle = `rgba(255, 200, 200, ${0.4 + pulse * 0.3})`;
      ctx.font = '600 13px sans-serif';
      ctx.fillText('A powerful enemy approaches', this.width / 2, 50);
      ctx.restore();
    }
  }
}
