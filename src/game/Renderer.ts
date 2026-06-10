import type { RenderSnapshot, Enemy, Projectile, Particle, DamageNumber, Shockwave, Mine, AuraType } from '../types';
import { TOWER_VISUAL } from '../data/tower';
import { ENEMY_DEFS } from '../data/enemies';
import { isBossWave } from '../data/formulas';
import { formatInt } from '../utils/bigNumber';
import { ELITE_AURA_COLORS, AURA_RADIUS } from '../systems/EnemyManager';

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly width: number;
  private readonly height: number;
  private readonly rangeOverlay: boolean = true;
  private time = 0;
  private bgCanvas: HTMLCanvasElement | null = null;

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
    ctx.drawImage(this.getBackground(), 0, 0);
    this.drawTowerBase(ctx, snapshot);
    this.drawWall(ctx, snapshot);
    if (this.rangeOverlay) this.drawRangeRing(ctx, snapshot);
    this.drawMines(ctx, snapshot.mines);
    this.drawParticles(ctx, snapshot.particles, 'behind');
    this.drawShockwaves(ctx, snapshot.shockwaves);
    this.drawAimLine(ctx, snapshot);
    this.drawEnemies(ctx, snapshot.enemies);
    this.drawProjectiles(ctx, snapshot.projectiles);
    this.drawParticles(ctx, snapshot.particles, 'front');
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

  private drawEnemies(ctx: CanvasRenderingContext2D, enemies: Enemy[]): void {
    for (const e of enemies) {
      if (!e.alive) continue;
      this.drawEnemyShadow(ctx, e);
      this.drawEnemy(ctx, e);
    }
  }

  private drawEnemyShadow(ctx: CanvasRenderingContext2D, enemy: Enemy): void {
    if (enemy.type === 'flying') return;
    const def = ENEMY_DEFS[enemy.type];
    const r = def.radius;
    const grad = ctx.createRadialGradient(enemy.x, enemy.y + r * 0.6, 0, enemy.x, enemy.y + r * 0.6, r * 0.9);
    grad.addColorStop(0, 'rgba(0,0,0,0.35)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(enemy.x, enemy.y + r * 0.6, r * 0.85, r * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawEnemy(ctx: CanvasRenderingContext2D, enemy: Enemy): void {
    const def = ENEMY_DEFS[enemy.type];
    const baseR = def.radius;
    const eliteScale = enemy.elite ? 1.25 : 1;
    const r = baseR * eliteScale;
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

    ctx.save();
    if (enemy.type === 'boss') {
      const pulse = 1 + Math.sin(this.time * 4) * 0.08;
      ctx.translate(enemy.x, enemy.y);
      ctx.scale(pulse, pulse);
      ctx.translate(-enemy.x, -enemy.y);
    }
    if (enemy.type === 'splitter') {
      const pulse = 1 + Math.sin(this.time * 3 + enemy.id) * 0.05;
      ctx.translate(enemy.x, enemy.y);
      ctx.scale(pulse, pulse);
      ctx.translate(-enemy.x, -enemy.y);
    }

    switch (def.shape) {
      case 'diamond':
        // P5: Boss enrage color shift — turn the body red when below 50% HP
        if (enemy.type === 'boss' && (enemy as { enraged?: boolean }).enraged) {
          ctx.fillStyle = '#ff2020';
        } else {
          ctx.fillStyle = def.color;
        }
        ctx.beginPath();
        ctx.moveTo(enemy.x, enemy.y - r + bob);
        ctx.lineTo(enemy.x + r, enemy.y + bob);
        ctx.lineTo(enemy.x, enemy.y + r + bob);
        ctx.lineTo(enemy.x - r, enemy.y + bob);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = def.borderColor;
        ctx.lineWidth = 2;
        ctx.stroke();
        // Splitter gets a small inner core dot to make it stand out
        if (enemy.type === 'splitter') {
          ctx.fillStyle = 'rgba(255,255,255,0.55)';
          ctx.beginPath();
          ctx.arc(enemy.x, enemy.y + bob, 3, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      case 'winged': {
        const wingFlap = Math.sin(this.time * 12 + enemy.id) * 0.4;
        ctx.fillStyle = def.color;
        ctx.beginPath();
        ctx.arc(enemy.x, enemy.y + bob, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = def.borderColor;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = def.borderColor;
        ctx.save();
        ctx.translate(enemy.x, enemy.y + bob);
        ctx.rotate(-wingFlap);
        ctx.beginPath();
        ctx.moveTo(-r, 0);
        ctx.lineTo(-r - 9, -6);
        ctx.lineTo(-r - 4, 0);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        ctx.save();
        ctx.translate(enemy.x, enemy.y + bob);
        ctx.rotate(wingFlap);
        ctx.beginPath();
        ctx.moveTo(r, 0);
        ctx.lineTo(r + 9, -6);
        ctx.lineTo(r + 4, 0);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        break;
      }
      case 'circle':
      default: {
        ctx.fillStyle = def.color;
        ctx.beginPath();
        ctx.arc(enemy.x, enemy.y + bob, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = def.borderColor;
        ctx.lineWidth = enemy.type === 'tank' ? 4 : enemy.type === 'boss' ? 3 : 2;
        ctx.stroke();
        if (def.glyph) {
          ctx.fillStyle = '#fff';
          ctx.font = `bold ${r}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(def.glyph, enemy.x, enemy.y + bob + 1);
        }
        if (enemy.type === 'tank') {
          ctx.strokeStyle = 'rgba(255,255,255,0.18)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(enemy.x, enemy.y + bob, r - 4, 0, Math.PI * 2);
          ctx.stroke();
        }
        break;
      }
    }
    ctx.restore();

    // Shielded: orbiting shield segments (arcs) when charges > 0
    if (enemy.type === 'shielded' && (enemy.shieldCharges ?? 0) > 0) {
      this.drawShieldArcs(ctx, enemy, r);
    }

    // Elite crown
    if (enemy.elite && enemy.aura) {
      this.drawEliteCrown(ctx, enemy, r, bob);
    }

    // Retribution buff indicator (pulsing purple border)
    if (enemy.retributionTimer && enemy.retributionTimer > 0) {
      const pulse = 0.4 + Math.sin(this.time * 8) * 0.3;
      ctx.save();
      ctx.strokeStyle = `rgba(180, 50, 220, ${pulse})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(enemy.x, enemy.y + bob, r + 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    this.drawEnemyHpBar(ctx, enemy, r, bob);
  }

  private drawHealerAura(ctx: CanvasRenderingContext2D, enemy: Enemy, r: number): void {
    const pulse = 1 + Math.sin(this.time * 2.5 + enemy.id) * 0.12;
    const grad = ctx.createRadialGradient(enemy.x, enemy.y, r * 0.7, enemy.x, enemy.y, r * 2.0 * pulse);
    grad.addColorStop(0, 'rgba(80, 220, 120, 0.22)');
    grad.addColorStop(0.6, 'rgba(39, 174, 96, 0.08)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(enemy.x, enemy.y, r * 2.0 * pulse, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawEliteAura(ctx: CanvasRenderingContext2D, enemy: Enemy, r: number, aura: AuraType): void {
    const color = ELITE_AURA_COLORS[aura];
    const pulse = 1 + Math.sin(this.time * 3 + enemy.id) * 0.15;
    const auraR = AURA_RADIUS * 0.6 * pulse; // visual radius scaled down for display
    const grad = ctx.createRadialGradient(enemy.x, enemy.y, r * 0.5, enemy.x, enemy.y, auraR);
    grad.addColorStop(0, color);
    grad.addColorStop(0.7, color.replace(/[\d.]+\)$/, '0.08)'));
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(enemy.x, enemy.y, auraR, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawEliteCrown(ctx: CanvasRenderingContext2D, enemy: Enemy, r: number, bob: number): void {
    const auraColors: Record<AuraType, string> = {
      haste: '#3cb4ff',
      thorns: '#ff6420',
      greed: '#ffd700',
      vitality: '#3edc64',
      retribution: '#b432dc',
    };
    const color = auraColors[enemy.aura!] ?? '#fff';
    const crownY = enemy.y - r - 12 + bob;
    ctx.save();
    ctx.fillStyle = color;
    ctx.font = `bold ${Math.max(10, r * 0.7)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('♛', enemy.x, crownY);
    // Glow
    ctx.shadowColor = color;
    ctx.shadowBlur = 6;
    ctx.fillText('♛', enemy.x, crownY);
    ctx.restore();
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
    const enraged = (enemy as { enraged?: boolean }).enraged;
    const speed = enraged ? 7 : 3;
    const pulse = 1 + Math.sin(this.time * speed) * (enraged ? 0.22 : 0.12);
    const innerColor = enraged ? 'rgba(255, 80, 80, 0.55)' : 'rgba(255, 60, 60, 0.28)';
    const midColor = enraged ? 'rgba(220, 30, 30, 0.20)' : 'rgba(160, 0, 0, 0.10)';
    const grad = ctx.createRadialGradient(enemy.x, enemy.y, r * 0.7, enemy.x, enemy.y, r * 2.4 * pulse);
    grad.addColorStop(0, innerColor);
    grad.addColorStop(0.6, midColor);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(enemy.x, enemy.y, r * 2.4 * pulse, 0, Math.PI * 2);
    ctx.fill();
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
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 8);
        grad.addColorStop(0, '#e0b3ff');
        grad.addColorStop(1, 'rgba(120, 60, 200, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#9b59ff';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fill();
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
      ctx.fillText(`Wave ${snap.wave.number} cleared — ${snap.wave.autoProgress ? 'next' : 'restarting'} wave in ${secs}s`, this.width / 2, 25);
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
