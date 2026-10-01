import { FX, INK, lighten, withAlpha } from './palette';
import { QUALITY, type QualityTier } from './quality';

/**
 * Presentation effects: particles, rings and damage numbers. Ported and
 * trimmed from the legacy `EffectsManager`, which carried two dozen emitters
 * for systems the rebuild dropped.
 *
 * Everything here runs on the wall clock and may use `Math.random` — none of
 * it reaches the sim. Each kind lives in a capped array. Expired particles are
 * swap-removed (so the array is not in age order); once particles hit their
 * cap, a new one overwrites a slot round-robin, O(1) however busy the fight.
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

/** A lightning path, pre-jittered once so it flickers without crawling. */
interface Arc {
  points: number[];
  age: number;
  life: number;
  tint: string;
}

/** An XP mote drifting from a kill into the tower. */
interface Mote {
  x: number;
  y: number;
  age: number;
  life: number;
  /** Sideways bow of its path, world units. */
  bow: number;
}

/** Fraction of velocity kept per second. */
const DRAG_PER_SEC = 0.08;
const MAX_RINGS = 48;
const MAX_NUMBERS = 40;
const MAX_ARCS = 24;
const ARC_LIFE = 0.18;
/** Kinks per leap of a lightning arc, and how far each may stray. */
const ARC_KINKS = 5;
const ARC_JITTER = 14;
const MAX_MOTES = 90;
const MOTE_LIFE = 0.55;
const NUMBER_LIFE = 0.9;
const NUMBER_RISE_CSS = 38;

export class Effects {
  private particles: Particle[] = [];
  /** Next slot a particle overwrites once the cap is reached. */
  private overflow = 0;
  private rings: Ring[] = [];
  private numbers: DamageNumber[] = [];
  private arcs: Arc[] = [];
  private motes: Mote[] = [];
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
    this.arcs.length = 0;
    this.motes.length = 0;
  }

  private count(n: number): number {
    return Math.max(1, Math.round(n * this.scale));
  }

  private pushParticle(p: Particle): void {
    const ps = this.particles;
    if (ps.length < this.maxParticles) {
      ps.push(p);
      return;
    }
    this.overflow = (this.overflow + 1) % ps.length;
    ps[this.overflow] = p;
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

  /** A chain strike: a jagged path through `points` (flat x, y pairs), frost-white unless tinted. */
  lightning(points: readonly number[], tint: string = FX.frost): void {
    if (points.length < 4) return;
    const out: number[] = [points[0], points[1]];
    for (let i = 2; i < points.length; i += 2) {
      const ax = points[i - 2];
      const ay = points[i - 1];
      const bx = points[i];
      const by = points[i + 1];
      const len = Math.hypot(bx - ax, by - ay) || 1;
      const nx = -(by - ay) / len;
      const ny = (bx - ax) / len;
      for (let k = 1; k < ARC_KINKS; k++) {
        const t = k / ARC_KINKS;
        const j = (Math.random() * 2 - 1) * ARC_JITTER;
        out.push(ax + (bx - ax) * t + nx * j, ay + (by - ay) * t + ny * j);
      }
      out.push(bx, by);
    }
    if (this.arcs.length >= MAX_ARCS) this.arcs.shift();
    this.arcs.push({ points: out, age: 0, life: ARC_LIFE, tint });
  }

  /** Evolution (§10.3): a slow spotlight on the tower while the weapon transforms. */
  evolve(radius: number): void {
    this.pushRing({ x: 0, y: 0, age: 0, life: 1, from: radius * 4, to: radius * 0.8, color: withAlpha(FX.gold, 0.9), width: 10 });
    this.pushRing({ x: 0, y: 0, age: 0, life: 1.1, from: radius, to: radius * 7, color: withAlpha(INK['050'], 0.6), width: 5 });
    this.spray(0, 0, FX.gold, 50, 360, 5, 80);
  }

  /** XP leaving a kill for the tower (§4.5: collected automatically, never picked up). */
  xpMote(x: number, y: number): void {
    if (this.motes.length >= MAX_MOTES * this.scale) return;
    this.motes.push({ x, y, age: 0, life: MOTE_LIFE + Math.random() * 0.15, bow: (Math.random() * 2 - 1) * 60 });
  }

  /** A level-up: a gold flash rolling out from the tower (§10.3). */
  levelUp(radius: number): void {
    this.pushRing({ x: 0, y: 0, age: 0, life: 0.5, from: radius, to: radius * 5, color: withAlpha(FX.gold, 0.8), width: 8 });
    this.pushRing({ x: 0, y: 0, age: 0, life: 0.35, from: radius * 0.6, to: radius * 2.4, color: withAlpha(INK['050'], 0.7), width: 4 });
  }

  /** Nova: a violet shockwave out to `range`, and a spray of light. */
  nova(towerRadius: number, range: number): void {
    this.pushRing({ x: 0, y: 0, age: 0, life: 0.45, from: towerRadius, to: range, color: withAlpha(FX.arcane, 0.9), width: 22 });
    this.pushRing({ x: 0, y: 0, age: 0, life: 0.6, from: towerRadius, to: range * 1.1, color: withAlpha(INK['050'], 0.55), width: 6 });
    const n = this.count(36);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.2;
      const speed = 400 + Math.random() * 380;
      this.pushParticle({
        x: Math.cos(a) * towerRadius,
        y: Math.sin(a) * towerRadius,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        age: 0,
        life: 0.4 + Math.random() * 0.3,
        size: 3 + Math.random() * 4,
        color: Math.random() < 0.7 ? FX.arcane : INK['050'],
      });
    }
  }

  /** A ring rolling out from a point: the general-purpose shockwave. */
  ring(x: number, y: number, from: number, to: number, color: string, life = 0.5, width = 4): void {
    this.pushRing({ x, y, age: 0, life, from, to, color, width });
  }

  /** A spray of `n` sparks from a point, `up` biasing them upward (a fountain). */
  spray(x: number, y: number, color: string, n: number, speed: number, size = 4, up = 0): void {
    const k = this.count(n);
    for (let i = 0; i < k; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random() * 0.6);
      this.pushParticle({
        x, y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - up * (0.5 + Math.random()),
        age: 0,
        life: 0.4 + Math.random() * 0.6,
        size: size * (0.6 + Math.random() * 0.8),
        color,
      });
    }
  }

  /** A soft ring at a point, e.g. a new mount appearing on the tower. */
  pulse(x: number, y: number, radius: number, color: string): void {
    this.pushRing({ x, y, age: 0, life: 0.5, from: radius * 0.5, to: radius * 2.2, color: withAlpha(color, 0.85), width: 4 });
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
    const as = this.arcs;
    for (let i = as.length - 1; i >= 0; i--) {
      as[i].age += dt;
      if (as[i].age >= as[i].life) as.splice(i, 1);
    }
    const ms = this.motes;
    for (let i = ms.length - 1; i >= 0; i--) {
      ms[i].age += dt;
      if (ms[i].age >= ms[i].life) {
        ms[i] = ms[ms.length - 1];
        ms.pop();
      }
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
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const a of this.arcs) {
      const t = a.age / a.life;
      // Flicker: lightning reads as a strobe, not a fade.
      ctx.globalAlpha = (1 - t) * (0.7 + 0.3 * Math.random());
      for (const [color, width] of [[withAlpha(a.tint, 0.6), 9], [lighten(a.tint, 0.7), 3]] as const) {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(a.points[0], a.points[1]);
        for (let i = 2; i < a.points.length; i += 2) ctx.lineTo(a.points[i], a.points[i + 1]);
        ctx.stroke();
      }
    }
    ctx.fillStyle = lighten(FX.gold, 0.3);
    for (const m of this.motes) {
      // Ease in: it lifts off slowly, then is pulled home.
      const t = m.age / m.life;
      const k = t * t;
      const len = Math.hypot(m.x, m.y) || 1;
      const bow = Math.sin(t * Math.PI) * m.bow;
      const x = m.x * (1 - k) + (-m.y / len) * bow;
      const y = m.y * (1 - k) + (m.x / len) * bow;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(x, y, 4 * (1 - t * 0.4), 0, Math.PI * 2);
      ctx.fill();
    }
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
