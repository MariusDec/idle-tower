import { FX, INK, lighten, withAlpha } from './palette';
import { QUALITY, type QualityTier } from './quality';

/**
 * Presentation effects: particles, rings and damage numbers. Ported and
 * trimmed from the legacy `EffectsManager`, which carried two dozen emitters
 * for systems the rebuild dropped.
 *
 * Everything here runs on the wall clock and may use `Math.random` — none of
 * it reaches the sim. Pools are fixed-size arrays with swap-remove, so a
 * steady state allocates nothing; overflow drops the oldest entry.
 */

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  color: string;
}

interface Ring {
  x: number;
  y: number;
  age: number;
  life: number;
  from: number;
  to: number;
  color: string;
  width: number;
}

interface DamageNumber {
  x: number;
  y: number;
  /** Screen-space rise, CSS px, so text size never depends on zoom. */
  rise: number;
  age: number;
  life: number;
  text: string;
}

/** Fraction of velocity kept per second. */
const DRAG_PER_SEC = 0.08;
const MAX_RINGS = 48;
const MAX_NUMBERS = 40;
const NUMBER_LIFE = 0.9;
const NUMBER_RISE_CSS = 38;

export class Effects {
  private particles: Particle[] = [];
  private rings: Ring[] = [];
  private numbers: DamageNumber[] = [];
  private scale = 1;
  private maxParticles = QUALITY.high.maxParticles;
  private additive = true;

  setQuality(tier: QualityTier): void {
    const q = QUALITY[tier];
    this.scale = q.particleScale;
    this.maxParticles = q.maxParticles;
    this.additive = q.additive;
    if (this.particles.length > this.maxParticles) this.particles.length = this.maxParticles;
  }

  clear(): void {
    this.particles.length = 0;
    this.rings.length = 0;
    this.numbers.length = 0;
  }

  private count(n: number): number {
    return Math.max(1, Math.round(n * this.scale));
  }

  private pushParticle(p: Particle): void {
    if (this.particles.length >= this.maxParticles) this.particles.shift();
    this.particles.push(p);
  }

  private pushRing(r: Ring): void {
    if (this.rings.length >= MAX_RINGS) this.rings.shift();
    this.rings.push(r);
  }

  /** A few sparks where a shot landed. */
  hitSparks(x: number, y: number, color: string, crit: boolean): void {
    const n = this.count(crit ? 7 : 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = 60 + Math.random() * (crit ? 160 : 90);
      this.pushParticle({
        x, y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        age: 0,
        life: 0.18 + Math.random() * 0.16,
        size: 2 + Math.random() * 2,
        color,
      });
    }
  }

  /** A body coming apart: shards in its own colour and a pale puff ring. */
  deathBurst(x: number, y: number, color: string, radius: number): void {
    const n = this.count(Math.max(6, Math.round(radius * 0.6)));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = 70 + Math.random() * 160;
      this.pushParticle({
        x, y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        age: 0,
        life: 0.35 + Math.random() * 0.35,
        size: 2.5 + Math.random() * 3.5,
        color,
      });
    }
    this.pushRing({
      x, y, age: 0, life: 0.3,
      from: radius * 0.6, to: radius * 2.2,
      color: withAlpha(INK['050'], 0.45), width: 3,
    });
  }

  /** The tower taking a hit: a scarlet ripple at the wall. */
  wallHit(x: number, y: number): void {
    this.pushRing({ x, y, age: 0, life: 0.25, from: 4, to: 22, color: withAlpha(FX.critical, 0.7), width: 3 });
  }

  /** The tower falling: a slow white ring and a burst of stone. */
  towerFall(radius: number): void {
    this.pushRing({ x: 0, y: 0, age: 0, life: 1.1, from: radius, to: radius * 9, color: withAlpha(INK['050'], 0.6), width: 6 });
    const n = this.count(40);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = 80 + Math.random() * 260;
      this.pushParticle({
        x: Math.cos(a) * radius * 0.6,
        y: Math.sin(a) * radius * 0.6,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        age: 0,
        life: 0.6 + Math.random() * 0.6,
        size: 3 + Math.random() * 5,
        color: Math.random() < 0.5 ? INK['300'] : FX.gold,
      });
    }
  }

  /** Crits only (P1 scope): a number that rises and fades. */
  critNumber(x: number, y: number, amount: number): void {
    if (this.numbers.length >= MAX_NUMBERS) this.numbers.shift();
    this.numbers.push({ x, y, rise: 0, age: 0, life: NUMBER_LIFE, text: String(Math.round(amount)) });
  }

  tick(dt: number): void {
    const drag = Math.pow(DRAG_PER_SEC, dt);
    const ps = this.particles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.age += dt;
      if (p.age >= p.life) {
        ps[i] = ps[ps.length - 1];
        ps.pop();
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= drag;
      p.vy *= drag;
    }
    const rs = this.rings;
    for (let i = rs.length - 1; i >= 0; i--) {
      rs[i].age += dt;
      if (rs[i].age >= rs[i].life) rs.splice(i, 1);
    }
    const ns = this.numbers;
    for (let i = ns.length - 1; i >= 0; i--) {
      const d = ns[i];
      d.age += dt;
      d.rise = NUMBER_RISE_CSS * (1 - Math.pow(1 - Math.min(1, d.age / d.life), 3));
      if (d.age >= d.life) ns.splice(i, 1);
    }
  }

  /** World space. */
  drawWorld(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    for (const r of this.rings) {
      const t = r.age / r.life;
      const ease = 1 - (1 - t) * (1 - t);
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = r.width * (1 - t * 0.6);
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.from + (r.to - r.from) * ease, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (this.additive) ctx.globalCompositeOperation = 'lighter';
    for (const p of this.particles) {
      const t = p.age / p.life;
      ctx.globalAlpha = 1 - t * t;
      ctx.fillStyle = p.color;
      const s = p.size * (1 - t * 0.5);
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
    }
    ctx.restore();
  }

  /**
   * Screen space. `project` maps a world point to CSS px. Numbers are typed
   * in CSS px so a crit reads the same on a phone and a monitor.
   */
  drawScreen(ctx: CanvasRenderingContext2D, project: (x: number, y: number) => { x: number; y: number }): void {
    if (this.numbers.length === 0) return;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 17px Oswald, "Arial Narrow", sans-serif';
    ctx.lineWidth = 3;
    ctx.strokeStyle = withAlpha(INK['950'], 0.85);
    for (const d of this.numbers) {
      const t = d.age / d.life;
      const p = project(d.x, d.y);
      // A short pop on arrival, so a crit reads as an event.
      const pop = t < 0.15 ? 1 + (0.15 - t) * 2.4 : 1;
      ctx.globalAlpha = t > 0.6 ? 1 - (t - 0.6) / 0.4 : 1;
      ctx.save();
      ctx.translate(p.x, p.y - 14 - d.rise);
      ctx.scale(pop, pop);
      ctx.strokeText(d.text, 0, 0);
      ctx.fillStyle = lighten(FX.gold, 0.25);
      ctx.fillText(d.text, 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }
}
