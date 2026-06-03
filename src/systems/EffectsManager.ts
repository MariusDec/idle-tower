import type { DamageNumber, Particle, Shockwave } from '../types';

const PARTICLE_GRAVITY = 320;
const PARTICLE_DRAG_PER_SEC = 0.55;
const DMG_FLOAT_SPEED = 48;
const DMG_BASE_LIFE = 0.85;
const DMG_CRIT_LIFE = 1.25;
const SHOCKWAVE_SPEED = 700;
const SHOCKWAVE_MIN_LIFE = 0.8;
const SHOCKWAVE_MAX_LIFE = 1.0;

export class EffectsManager {
  private particles: Particle[] = [];
  private damageNumbers: DamageNumber[] = [];
  private shockwaves: Shockwave[] = [];

  get particleList(): Particle[] {
    return this.particles;
  }

  get damageList(): DamageNumber[] {
    return this.damageNumbers;
  }

  get shockwaveList(): Shockwave[] {
    return this.shockwaves;
  }

  emitHitSparks(x: number, y: number, color: string, count: number = 4): void {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 50 + Math.random() * 90;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 30,
        age: 0,
        life: 0.22 + Math.random() * 0.18,
        size: 1.5 + Math.random() * 1.5,
        color,
      });
    }
  }

  emitDeathBurst(x: number, y: number, color: string, radius: number, count?: number): void {
    const n = count ?? Math.max(8, Math.round(radius * 0.7));
    for (let i = 0; i < n; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 80 + Math.random() * 180;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 60,
        age: 0,
        life: 0.55 + Math.random() * 0.45,
        size: 2 + Math.random() * 3,
        color,
      });
    }
    for (let i = 0; i < Math.max(3, Math.floor(n / 3)); i++) {
      this.particles.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 40,
        vy: -20 - Math.random() * 40,
        age: 0,
        life: 0.9 + Math.random() * 0.4,
        size: radius * 0.45,
        color: 'rgba(255, 255, 255, 0.18)',
      });
    }
  }

  emitBossDeathShockwave(x: number, y: number): void {
    for (let i = 0; i < 36; i++) {
      const angle = (i / 36) * Math.PI * 2 + Math.random() * 0.08;
      const speed = 220 + Math.random() * 80;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        age: 0,
        life: 0.9 + Math.random() * 0.3,
        size: 3 + Math.random() * 2,
        color: i % 2 === 0 ? '#ff5050' : '#ffd28a',
      });
    }
  }

  emitRainOfArrows(cx: number, cy: number): void {
    for (let i = 0; i < 40; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 40 + Math.random() * 420;
      const x = cx + Math.cos(angle) * dist;
      const y = cy + Math.sin(angle) * dist;
      this.particles.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 20,
        vy: 280 + Math.random() * 80,
        age: 0,
        life: 0.55 + Math.random() * 0.35,
        size: 1.5 + Math.random() * 1.5,
        color: '#f7d774',
      });
    }
  }

  emitFrostNovaRing(cx: number, cy: number): void {
    for (let i = 0; i < 48; i++) {
      const angle = (i / 48) * Math.PI * 2;
      const speed = 380 + Math.random() * 60;
      this.particles.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        age: 0,
        life: 0.55 + Math.random() * 0.2,
        size: 2 + Math.random() * 2,
        color: i % 2 === 0 ? '#a3d2ff' : '#e0f0ff',
      });
    }
  }

  emitShockwaveRing(cx: number, cy: number, radius: number): void {
    if (radius <= 0) return;
    const life = Math.min(SHOCKWAVE_MAX_LIFE, Math.max(SHOCKWAVE_MIN_LIFE, radius / SHOCKWAVE_SPEED));
    this.shockwaves.push({
      x: cx,
      y: cy,
      currentRadius: 0,
      maxRadius: radius,
      age: 0,
      life,
      color: 'rgba(24, 125, 122, 0.7)',
      lineWidth: 6,
    });
  }

  emitBerserkPulse(cx: number, cy: number): void {
    for (let i = 0; i < 16; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 24 + Math.random() * 12;
      this.particles.push({
        x: cx + Math.cos(angle) * dist,
        y: cy + Math.sin(angle) * dist,
        vx: Math.cos(angle) * 30,
        vy: Math.sin(angle) * 30,
        age: 0,
        life: 0.35 + Math.random() * 0.2,
        size: 2 + Math.random() * 1.5,
        color: '#ff6a4a',
      });
    }
  }

  emitGoldRushSparkle(cx: number, cy: number): void {
    for (let i = 0; i < 12; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 16 + Math.random() * 28;
      this.particles.push({
        x: cx + Math.cos(angle) * dist,
        y: cy + Math.sin(angle) * dist,
        vx: (Math.random() - 0.5) * 24,
        vy: -30 - Math.random() * 40,
        age: 0,
        life: 0.5 + Math.random() * 0.3,
        size: 1.5 + Math.random() * 1.5,
        color: '#ffd24a',
      });
    }
  }

  emitMineExplosion(x: number, y: number): void {
    for (let i = 0; i < 20; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 60 + Math.random() * 120;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 40,
        age: 0,
        life: 0.4 + Math.random() * 0.3,
        size: 2 + Math.random() * 3,
        color: i % 2 === 0 ? '#ff6633' : '#ffcc00',
      });
    }
    for (let i = 0; i < 5; i++) {
      this.particles.push({
        x: x + (Math.random() - 0.5) * 20,
        y: y + (Math.random() - 0.5) * 20,
        vx: (Math.random() - 0.5) * 30,
        vy: -40 - Math.random() * 30,
        age: 0,
        life: 0.6 + Math.random() * 0.3,
        size: 4 + Math.random() * 3,
        color: 'rgba(255, 255, 255, 0.3)',
      });
    }
  }

  emitShieldAbsorb(x: number, y: number): void {
    for (let i = 0; i < 8; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 24 + Math.random() * 12;
      this.particles.push({
        x: x + Math.cos(angle) * dist,
        y: y + Math.sin(angle) * dist,
        vx: Math.cos(angle) * 40,
        vy: Math.sin(angle) * 40,
        age: 0,
        life: 0.25 + Math.random() * 0.15,
        size: 2 + Math.random() * 2,
        color: '#64b4ff',
      });
    }
  }

  emitDamageNumber(x: number, y: number, amount: number, isCrit: boolean): void {
    this.damageNumbers.push({
      x: x + (Math.random() - 0.5) * 10,
      y: y - 4,
      amount: Math.max(1, Math.round(amount)),
      isCrit,
      age: 0,
      life: isCrit ? DMG_CRIT_LIFE : DMG_BASE_LIFE,
      vy: DMG_FLOAT_SPEED,
    });
  }

  tick(dt: number): void {
    for (const p of this.particles) {
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += PARTICLE_GRAVITY * dt;
      const dragFactor = Math.pow(PARTICLE_DRAG_PER_SEC, dt);
      p.vx *= dragFactor;
    }
    if (this.particles.length > 0) {
      this.particles = this.particles.filter(p => p.age < p.life);
    }

    for (const d of this.damageNumbers) {
      d.age += dt;
      d.y -= d.vy * dt;
      d.vy *= Math.pow(0.35, dt);
    }
    if (this.damageNumbers.length > 0) {
      this.damageNumbers = this.damageNumbers.filter(d => d.age < d.life);
    }

    for (const s of this.shockwaves) {
      s.age += dt;
      s.currentRadius = (s.age / s.life) * s.maxRadius;
    }
    if (this.shockwaves.length > 0) {
      this.shockwaves = this.shockwaves.filter(s => s.age < s.life);
    }
  }

  reset(): void {
    this.particles = [];
    this.damageNumbers = [];
    this.shockwaves = [];
  }
}
