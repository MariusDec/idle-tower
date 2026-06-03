import type { RenderSnapshot, Enemy, Projectile, Particle, DamageNumber, Shockwave, Mine } from '../types';
import { TOWER_VISUAL } from '../data/tower';
import { ENEMY_DEFS } from '../data/enemies';
import { isBossWave } from '../data/formulas';
import { formatInt } from '../utils/bigNumber';

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly width: number;
  private readonly height: number;
  private readonly rangeOverlay: boolean = true;
  private time = 0;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to acquire 2D rendering context');
    this.ctx = ctx;
    this.width = canvas.width;
    this.height = canvas.height;
  }

  draw(snapshot: RenderSnapshot): void {
    this.time += 1 / 60;
    const ctx = this.ctx;
    this.drawBackground(ctx);
    this.drawArena(ctx);
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
    this.drawDamageNumbers(ctx, snapshot.damageNumbers);
    this.drawTowerTop(ctx, snapshot);
    this.drawShield(ctx, snapshot);
    this.drawWaveBanner(ctx, snapshot);
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

  private drawAimLine(ctx: CanvasRenderingContext2D, snap: RenderSnapshot): void {
    if (true || !snap.aimLine) return;
    const t = snap.tower;
    const dx = snap.aimLine.x - t.x;
    const dy = snap.aimLine.y - t.y;
    const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    const endX = t.x + (dx / d) * t.range;
    const endY = t.y + (dy / d) * t.range;

    ctx.save();
    ctx.strokeStyle = 'rgba(255, 200, 100, 0.35)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(t.x, t.y);
    ctx.lineTo(endX, endY);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(snap.aimLine.x, snap.aimLine.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 200, 100, 0.5)';
    ctx.fill();
    ctx.restore();
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
    for (const m of mines) {
      if (!m.alive) continue;
      const pulse = 0.85 + Math.sin(this.time * 3 + m.id) * 0.15;
      ctx.save();
      ctx.fillStyle = '#cc4422';
      ctx.beginPath();
      ctx.arc(m.x, m.y, 6 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ff8844';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 60, 20, 0.25)';
      ctx.beginPath();
      ctx.arc(m.x, m.y, 10 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
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
    const r = def.radius;
    let bob = 0;
    if (enemy.type === 'flying') {
      bob = Math.sin(this.time * 5 + enemy.id * 0.7) * 3;
    }

    if (enemy.type === 'boss') {
      this.drawBossAura(ctx, enemy, r);
    }

    ctx.save();
    if (enemy.type === 'boss') {
      const pulse = 1 + Math.sin(this.time * 4) * 0.08;
      ctx.translate(enemy.x, enemy.y);
      ctx.scale(pulse, pulse);
      ctx.translate(-enemy.x, -enemy.y);
    }

    switch (def.shape) {
      case 'diamond':
        ctx.fillStyle = def.color;
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

    if (enemy.type === 'boss') {
      this.drawBossCrown(ctx, enemy, r + bob);
    }

    this.drawEnemyHpBar(ctx, enemy, r, bob);
  }

  private drawBossAura(ctx: CanvasRenderingContext2D, enemy: Enemy, r: number): void {
    const pulse = 1 + Math.sin(this.time * 3) * 0.12;
    const grad = ctx.createRadialGradient(enemy.x, enemy.y, r * 0.7, enemy.x, enemy.y, r * 2.4 * pulse);
    grad.addColorStop(0, 'rgba(255, 60, 60, 0.28)');
    grad.addColorStop(0.6, 'rgba(160, 0, 0, 0.10)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(enemy.x, enemy.y, r * 2.4 * pulse, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawBossCrown(ctx: CanvasRenderingContext2D, enemy: Enemy, topY: number): void {
    return;
    const baseY = topY - 2;
    const peakY = topY - 14;
    ctx.save();
    ctx.fillStyle = '#f1c40f';
    ctx.strokeStyle = '#7a5a00';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(enemy.x - 16, baseY);
    ctx.lineTo(enemy.x - 12, peakY);
    ctx.lineTo(enemy.x - 6, baseY - 4);
    ctx.lineTo(enemy.x, peakY + 2);
    ctx.lineTo(enemy.x + 6, baseY - 4);
    ctx.lineTo(enemy.x + 12, peakY);
    ctx.lineTo(enemy.x + 16, baseY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.fillStyle = '#ff5050';
    ctx.font = '700 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('BOSS', enemy.x, baseY - 18);
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
    for (const p of particles) {
      const lifeRatio = 1 - p.age / p.life;
      if (lifeRatio <= 0) continue;
      if (layer === 'front' && p.color.startsWith('rgba(255, 255, 255')) continue;
      ctx.save();
      ctx.globalAlpha = lifeRatio;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private drawShockwaves(ctx: CanvasRenderingContext2D, shockwaves: Shockwave[]): void {
    for (const s of shockwaves) {
      const lifeRatio = 1 - s.age / s.life;
      if (lifeRatio <= 0) continue;
      ctx.save();
      ctx.globalAlpha = lifeRatio;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.lineWidth;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.currentRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
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
      ctx.strokeStyle = '#3a0000';
      ctx.fillStyle = d.isCrit ? '#ffe27a' : '#ffffff';
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
