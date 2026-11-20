import type { BossId } from '../content/types';
import type { QualityTier } from './quality';
import type { MotionLevel } from './motion';

/**
 * Boss poses (plans/enemy-animation.md §6). A boss is drawn live, so a
 * "frame" here is a pose: a transform driven by what the boss is doing,
 * blended with springs. Pure and DOM-free; presentation only. Inputs are
 * the wall clock, the boss's state and the events the renderer consumes,
 * never the sim's RNG.
 */

/** One frame's pose. Offsets are world units; scales and shear are factors. */
export interface BossPose {
  dx: number;
  dy: number;
  sx: number;
  sy: number;
  shear: number;
  /** Afterimage alpha (`high` only), and its offset from the body as drawn (`dx`, `dy`): where it stood before the lunge. */
  after: number;
  ax: number;
  ay: number;
  /** Wind-up progress 0..1: what the charging part shows (§7, 8c). */
  tell: number;
  /** Follow-through spring displacement, in radii, already scaled by the boss's `follow` (§7, 8a). */
  lag: number;
  /** Gaze (§7, 8b): where the pupils look, a unit-ish offset in world axes, and how narrowed they are (0..1). */
  gx: number;
  gy: number;
  narrow: number;
  /** Angle toward the tower, radians: what a charging part turns to. */
  aim: number;
  /** Alpha of the body as it rises out of the water (Undertow); 1 otherwise. */
  fade: number;
  /** Alpha of the body as it sinks, drawn over the ripples while the sim already hides it; 0 otherwise. */
  sink: number;
}

/** What the animator reads off the boss each frame. */
export interface BossInput {
  x: number;
  y: number;
  radius: number;
  moving: boolean;
  hitTick: number;
  /** Seconds of wind-up left (0: none). */
  windup: number;
  staggered: boolean;
  enraged: boolean;
}

export type BossGait = 'stomp' | 'lurch' | 'glide' | 'slide' | 'pulse' | 'roll';

/** A boss's character (§6.2). Amplitudes are fractions of its radius. */
export interface BossCharacter {
  gait: BossGait;
  /** Footfalls (or sways) per second. */
  hz: number;
  /** The walk's footfall squash. */
  squash: number;
  /** The walk's vertical travel. */
  bob: number;
  /** How much every squash gives: rigid < 1 < jelly. */
  give: number;
  /** The release's lunge toward the tower. */
  lunge: number;
  /** The release's sideways shudder. */
  shudder: number;
  /** The walk's sway, as shear. */
  sway: number;
  /** How far its outer parts lag the body (8a): 0 for none. */
  follow: number;
}

/** Anything the gaze can follow: a live projectile. */
export interface GazeTarget {
  alive: boolean;
  x: number;
  y: number;
}

export const BOSS_MOTION: Record<BossId, BossCharacter> = {
  gatekeeper: { gait: 'stomp', hz: 1.4, squash: 0.05, bob: 0.03, give: 0.8, lunge: 0.08, shudder: 0.04, sway: 0, follow: 0.5 },
  'bog-mother': { gait: 'lurch', hz: 1.0, squash: 0.06, bob: 0.02, give: 1.5, lunge: 0.08, shudder: 0, sway: 0.02, follow: 1.0 },
  prism: { gait: 'glide', hz: 0.8, squash: 0, bob: 0.02, give: 0.2, lunge: 0.06, shudder: 0, sway: 0, follow: 0 },
  // Its plates are their own bodies and stay put: a short lunge presses into them without parting (§6.4).
  forgeheart: { gait: 'stomp', hz: 1.2, squash: 0.05, bob: 0.025, give: 0.8, lunge: 0.04, shudder: 0.02, sway: 0, follow: 0 },
  'hollow-king': { gait: 'glide', hz: 0.7, squash: 0, bob: 0.025, give: 1, lunge: 0.08, shudder: 0, sway: 0.03, follow: 1.0 },
  blight: { gait: 'pulse', hz: 5 / (Math.PI * 2), squash: 0.04, bob: 0, give: 1.2, lunge: 0.08, shudder: 0, sway: 0, follow: 0.6 },
  deepwarden: { gait: 'slide', hz: 1.0, squash: 0, bob: 0, give: 0.25, lunge: 0.06, shudder: 0.05, sway: 0, follow: 0 },
  hunger: { gait: 'lurch', hz: 1.6, squash: 0.06, bob: 0.03, give: 1.2, lunge: 0.12, shudder: 0, sway: 0.02, follow: 0 },
  undertow: { gait: 'roll', hz: 1.6 / (Math.PI * 2), squash: 0.03, bob: 0.02, give: 1, lunge: 0.08, shudder: 0, sway: 0.04, follow: 0.6 },
};

/** Every tunable in one table (§6.3). */
export const BOSS_POSE = {
  arriveSeconds: 0.6,
  /** The arrival's drop: from this many radii up, landing at `arriveFall` s. */
  arriveDrop: 1.2,
  arriveFall: 0.25,
  arriveSquash: 0.25,
  /** Wind-up at full charge: squash, back-off (radii) and tremble (radii). */
  windupSquash: 0.14,
  windupBack: 0.05,
  windupTremble: 0.015,
  releaseSeconds: 0.35,
  releaseStretch: 0.18,
  afterAlpha: 0.25,
  staggerDroop: 0.06,
  staggerSway: 0.05,
  staggerShear: 0.06,
  phaseSeconds: 0.5,
  phaseShudder: 0.04,
  phasePunch: 0.12,
  hitSquish: 0.04,
  hitRearm: 0.25,
  sinkSeconds: 0.35,
  riseSeconds: 0.4,
  /** `|1 − sx|`, `|1 − sy|` and `|shear|` stay inside these, whatever adds up. */
  maxScale: 0.25,
  maxShear: 0.08,
  /** The follow-through spring (8a): frequency (Hz), damping ratio, and its reach (radii). */
  followHz: 3.5,
  followDamping: 0.25,
  maxLag: 0.2,
  /** The gaze (8b): how far it looks for a projectile (radii), and how fast it turns (1/s). */
  gazeReach: 2.5,
  gazeEase: 6,
  /** Enraged: the walk's cadence, and a tremble (world units). */
  enragedCadence: 1.6,
  enragedTremble: 1,
} as const;

/** What a slam's pre-lunge pose looks like: the afterimage's shape (wind-up at full charge). */
export const AFTER_SX = 1 + 0.72 * BOSS_POSE.windupSquash;
export const AFTER_SY = 1 - BOSS_POSE.windupSquash;

/** The events the animator answers. */
export type BossMotionEvent = 'bossArrive' | 'windup' | 'slam' | 'bossPhase' | 'submerge' | 'emerge';

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const smoothstep = (t: number): number => {
  const u = clamp(t, 0, 1);
  return u * u * (3 - 2 * u);
};
const TAU = Math.PI * 2;

export function identityPose(out: BossPose): BossPose {
  out.dx = 0;
  out.dy = 0;
  out.sx = 1;
  out.sy = 1;
  out.shear = 0;
  out.after = 0;
  out.ax = 0;
  out.ay = 0;
  out.tell = 0;
  out.lag = 0;
  out.gx = 0;
  out.gy = 0;
  out.narrow = 0;
  out.aim = 0;
  out.fade = 1;
  out.sink = 0;
  return out;
}

/**
 * Owns one boss's pose. The renderer feeds it events from `consume` and
 * asks for a pose each frame with the clock it draws on. Never sets the
 * renderer's `dirty`: a paused arena freezes it mid-pose, like the bob.
 */
export class BossAnimator {
  private level: MotionLevel = 'full';
  private tier: QualityTier = 'high';
  private readonly pose = identityPose({} as BossPose);
  private last = -Infinity;
  private phase = 0;
  private weight = 0;
  private stagger = 0;
  private windTotal = 0;
  private arriveAt = -Infinity;
  private releaseAt = -Infinity;
  private phaseAt = -Infinity;
  private sinkAt = -Infinity;
  private riseAt = -Infinity;
  private hitSeen = -1;
  private hitAt = -Infinity;
  /** The follow-through spring: where the outer parts are, and how fast they move (world units). */
  private part = NaN;
  private partV = 0;
  /** The pupils, eased toward their target. */
  private gx = 0;
  private gy = 0;

  setMotion(level: MotionLevel, tier: QualityTier): void {
    this.level = level;
    this.tier = tier;
  }

  get motion(): { level: MotionLevel; tier: QualityTier } {
    return { level: this.level, tier: this.tier };
  }

  /** A new run (or a resumed one): no pose carries over. */
  reset(): void {
    this.last = -Infinity;
    this.phase = 0;
    this.weight = 0;
    this.stagger = 0;
    this.windTotal = 0;
    this.arriveAt = this.releaseAt = this.phaseAt = this.sinkAt = this.riseAt = this.hitAt = -Infinity;
    this.hitSeen = -1;
    this.part = NaN;
    this.partV = 0;
    this.gx = this.gy = 0;
  }

  /** A boss event from `consume`, on the wall clock. `seconds` is a wind-up's total. */
  event(kind: BossMotionEvent, clock: number, seconds = 0): void {
    switch (kind) {
      case 'bossArrive':
        this.arriveAt = clock;
        break;
      case 'windup':
        this.windTotal = seconds;
        break;
      case 'slam':
        this.releaseAt = clock;
        break;
      case 'bossPhase':
        this.phaseAt = clock;
        break;
      case 'submerge':
        this.sinkAt = clock;
        break;
      case 'emerge':
        this.sinkAt = -Infinity;
        this.riseAt = clock;
        break;
      default: {
        const exhaustive: never = kind;
        return exhaustive;
      }
    }
  }

  /**
   * This frame's pose for boss `id`. `targets` are what its gaze may follow
   * (the live projectiles). The returned object is reused: read it before
   * the next call.
   */
  update(id: BossId, b: BossInput, clock: number, targets: readonly GazeTarget[] = []): BossPose {
    const out = identityPose(this.pose);
    const dt = clamp(clock - this.last, 0, 0.1);
    this.last = clock;
    const c = BOSS_MOTION[id];
    const r = b.radius;
    const reduced = this.level === 'reduced';
    const P = BOSS_POSE;
    // Toward the tower (at the origin).
    const d = Math.hypot(b.x, b.y) || 1;
    const nx = -b.x / d;
    const ny = -b.y / d;
    out.aim = Math.atan2(ny, nx);

    // Wind-up progress. A resumed save winds up without the event: its first frame stands in for the total.
    if (b.windup > 0) this.windTotal = Math.max(this.windTotal, b.windup);
    else this.windTotal = 0;
    const q = b.windup > 0 && this.windTotal > 0 ? clamp(1 - b.windup / this.windTotal, 0, 1) : 0;
    out.tell = q;

    // Hit: re-armed at most every `hitRearm`, since bosses get hit all the time.
    if (b.hitTick >= 0 && b.hitTick !== this.hitSeen && clock - this.hitAt >= P.hitRearm) {
      this.hitSeen = b.hitTick;
      this.hitAt = clock;
    }

    // Eased weights: the walk in and out, the stagger in and out.
    const ease = 1 - Math.exp(-8 * dt);
    this.weight += ((b.moving ? 1 : 0) - this.weight) * ease;
    this.stagger += ((b.staggered ? 1 : 0) - this.stagger) * (1 - Math.exp(-10 * dt));
    // Snap the tails, so a boss at rest is exactly the identity.
    if (!b.staggered && this.stagger < 0.01) this.stagger = 0;
    if (!b.moving && this.weight < 0.01) this.weight = 0;

    let squash = 0;

    if (reduced) {
      // Only what carries information: the wind-up's compression (no tremble) and the stagger's droop.
      squash += P.windupSquash * q * c.give;
      squash += P.staggerDroop * this.stagger;
      this.finish(out, squash);
      // Sinking and rising: fade only.
      this.sinkRise(out, clock, false);
      // No follow-through, and the pupils stay centred.
      this.part = NaN;
      this.gx = this.gy = 0;
      return out;
    }

    // Walk (always underneath).
    this.phase += dt * c.hz * Math.PI * (b.enraged ? P.enragedCadence : 1);
    const p = this.phase;
    const w = this.weight;
    switch (c.gait) {
      case 'stomp':
      case 'lurch': {
        const h = Math.abs(Math.sin(p));
        out.dy -= h * c.bob * r * w;
        squash += c.squash * (1 - h) ** 3 * w;
        if (c.gait === 'lurch') {
          out.dx += Math.sin(p) * 0.03 * r * w;
          out.shear += Math.sin(p) * c.sway * w;
        }
        break;
      }
      case 'glide':
        out.dy += Math.sin(p) * c.bob * r * w;
        out.shear += Math.sin(p * 0.5) * c.sway * w;
        break;
      case 'slide':
        // Grinding: a shudder, never a squash.
        out.dx += Math.sin(p * 9) * c.shudder * 0.15 * r * w;
        break;
      case 'pulse':
        // Locked to the heartbeat its profile already beats (`t·5`), walking or not.
        squash += c.squash * Math.sin(clock * 5);
        break;
      case 'roll':
        // Follows its crests' roll (`t·1.6`).
        out.shear += Math.sin(clock * 1.6) * c.sway;
        out.dy += Math.sin(clock * 1.6 + 1) * c.bob * r;
        break;
      default: {
        const exhaustive: never = c.gait;
        return exhaustive;
      }
    }
    if (b.enraged) {
      out.dx += Math.sin(clock * 47) * P.enragedTremble;
      out.dy += Math.sin(clock * 53) * P.enragedTremble;
    }

    // Wind-up: anticipation, backing off from the tower, trembling as it charges.
    if (q > 0) {
      squash += P.windupSquash * q * c.give;
      out.dx -= nx * P.windupBack * r * q;
      out.dy -= ny * P.windupBack * r * q;
      out.dx += Math.sin(clock * 40) * P.windupTremble * r * q;
    }

    // Release: a stretch and a lunge, overshooting into a squash, and a shudder.
    const tr = clock - this.releaseAt;
    if (tr >= 0 && tr < P.releaseSeconds) {
      const env = 1 - smoothstep((tr - 0.25) / 0.1);
      squash += -P.releaseStretch * c.give * Math.exp(-tr / 0.12) * Math.cos((tr * TAU) / 0.3) * env;
      const lunge = c.lunge * r * (tr < 0.06 ? smoothstep(tr / 0.06) : Math.exp(-(tr - 0.06) / 0.08)) * env;
      out.dx += nx * lunge;
      out.dy += ny * lunge;
      out.dx += Math.sin(tr * 60) * c.shudder * r * Math.exp(-tr / 0.1);
      if (this.tier === 'high' && this.level === 'full') {
        out.after = P.afterAlpha * (1 - tr / P.releaseSeconds);
        // Where it stood before the lunge: backed off at full charge.
        out.ax = -nx * (lunge + P.windupBack * r);
        out.ay = -ny * (lunge + P.windupBack * r);
      }
    }

    // Arrival: drops in, lands flattened, settles over two bounces.
    const ta = clock - this.arriveAt;
    if (ta >= 0 && ta < P.arriveSeconds) {
      if (ta < P.arriveFall) {
        const u = ta / P.arriveFall;
        out.dy -= P.arriveDrop * r * (1 - u * u);
        squash -= 0.08 * c.give * u;
      } else {
        const u = ta - P.arriveFall;
        const env = 1 - smoothstep((ta - (P.arriveSeconds - 0.1)) / 0.1);
        squash += P.arriveSquash * c.give * Math.exp(-u / 0.1) * Math.cos((u * TAU) / 0.17) * env;
      }
    }

    // Stagger: a dizzy droop and a sway.
    if (this.stagger > 0.001) {
      squash += P.staggerDroop * this.stagger;
      out.dx += Math.sin(clock * 6) * P.staggerSway * r * this.stagger;
      out.shear += Math.sin(clock * 6) * P.staggerShear * this.stagger;
    }

    // Hit: a small squish.
    const th = clock - this.hitAt;
    if (th >= 0 && th < 0.24) {
      squash += P.hitSquish * c.give * Math.exp(-th / 0.05) * Math.cos((th * TAU) / 0.16);
    }

    // Phase change: a decaying shudder and a scale punch.
    const tp = clock - this.phaseAt;
    let punch = 1;
    if (tp >= 0 && tp < P.phaseSeconds) {
      const k = 1 - smoothstep(tp / P.phaseSeconds);
      out.dx += Math.sin(tp * 70) * P.phaseShudder * r * k;
      punch = 1 + P.phasePunch * k;
    }

    this.finish(out, squash, punch);
    this.sinkRise(out, clock, true);

    if (this.level === 'full') {
      this.followThrough(out, c, r, dt);
      this.gaze(out, b, nx, ny, q, dt, targets);
    } else {
      this.part = NaN;
      this.gx = this.gy = 0;
    }
    return out;
  }

  /**
   * 8a: the outer parts hang on a damped spring off the top of the body.
   * When the top drops (a landing, a release), they lag above it, and the
   * profile lifts its top samples by `lag`: the crown wobbles a beat behind.
   */
  private followThrough(out: BossPose, c: BossCharacter, r: number, dt: number): void {
    const P = BOSS_POSE;
    // The top of the body, anchored at its base: it moves with dy and drops as sy shrinks.
    const top = out.dy + 2 * r * (1 - out.sy);
    if (Number.isNaN(this.part)) {
      this.part = top;
      this.partV = 0;
    }
    const w = TAU * P.followHz;
    // Substeps keep the spring stable on a slow frame.
    const n = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const acc = w * w * (top - this.part) - 2 * P.followDamping * w * this.partV;
      this.partV += acc * h;
      this.part += this.partV * h;
    }
    out.lag = c.follow > 0 ? clamp(((top - this.part) / r) * c.follow, -P.maxLag, P.maxLag) : 0;
  }

  /**
   * 8b: the pupils drift toward the nearest live projectile within reach,
   * or the tower otherwise. During a wind-up they lock onto the tower and narrow.
   */
  private gaze(out: BossPose, b: BossInput, nx: number, ny: number, q: number, dt: number, targets: readonly GazeTarget[]): void {
    let tx = nx;
    let ty = ny;
    if (q === 0) {
      const reach = BOSS_POSE.gazeReach * b.radius;
      let best = reach * reach;
      for (const t of targets) {
        if (!t.alive) continue;
        const dx = t.x - b.x;
        const dy = t.y - b.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < best && d2 > 1e-6) {
          best = d2;
          const k = 1 / Math.sqrt(d2);
          tx = dx * k;
          ty = dy * k;
        }
      }
    }
    const e = 1 - Math.exp(-BOSS_POSE.gazeEase * dt);
    this.gx += (tx - this.gx) * e;
    this.gy += (ty - this.gy) * e;
    out.gx = this.gx;
    out.gy = this.gy;
    out.narrow = q;
  }

  /** Squash to scales (`sy = 1 − q`, `sx = 1 + 0.72q`: the volume about holds), then the clamps. */
  private finish(out: BossPose, squash: number, punch = 1): void {
    const P = BOSS_POSE;
    out.sy = clamp((1 - squash) * punch, 1 - P.maxScale, 1 + P.maxScale);
    out.sx = clamp((1 + 0.72 * squash) * punch, 1 - P.maxScale, 1 + P.maxScale);
    out.shear = clamp(out.shear, -P.maxShear, P.maxShear);
  }

  /** The Undertow going down and coming up. Outside the clamps on purpose: it is fading. */
  private sinkRise(out: BossPose, clock: number, squash: boolean): void {
    const P = BOSS_POSE;
    const ts = clock - this.sinkAt;
    if (ts >= 0 && ts < P.sinkSeconds) {
      const u = ts / P.sinkSeconds;
      out.sink = 1 - u;
      if (squash) out.sy *= 1 - 0.7 * smoothstep(u);
    }
    const tr = clock - this.riseAt;
    if (tr >= 0 && tr < P.riseSeconds) {
      const u = tr / P.riseSeconds;
      out.fade = smoothstep(u / 0.6);
      if (squash) {
        const s = u < 0.6 ? 0.3 + 0.8 * smoothstep(u / 0.6) : 1.1 - 0.1 * smoothstep((u - 0.6) / 0.4);
        out.sy *= s;
      }
    }
  }
}
