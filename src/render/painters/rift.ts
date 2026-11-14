import { RIFT_BY_ID } from '../../content/rifts';
import type { RiftState } from '../../sim/state';
import { INK, RARITY, lighten, withAlpha } from '../palette';

/**
 * A rift (plans/late-game/02 §5): a vertical jagged slit about 34 world
 * units tall, drawn above the bodies so a crowd never hides it. It is its
 * own timer: its width breathes and narrows over its life, and the last two
 * seconds flicker. Rarity is colour *and* shape (colourblind-safe): a common
 * is one slit, a rare has a hairline crack beside it, a legendary three
 * orbiting sparks. Under reduced motion the breathing and flicker stop, but
 * the narrowing stays: it carries information. Reads the run; writes nothing.
 */

const HEIGHT = 34;
/** …but never shorter on screen than the 44 px touch floor, in CSS pixels. */
const MIN_SCREEN = 44;
/** Seconds the slit takes to unzip as it appears. */
const UNZIP = 0.4;
/** The slit's jagged profile: x offsets (× width) down its height, top to bottom. */
const JAG = [0, 0.6, -0.4, 0.9, -0.7, 0.5, -0.2, 0];

export interface RiftLook {
  reducedMotion: boolean;
  /** The low quality tier: no gradient. */
  plain: boolean;
  /** World units per CSS pixel at the current zoom. */
  px: number;
}

export function paintRift(ctx: CanvasRenderingContext2D, rift: RiftState | null, time: number, clock: number, look: RiftLook): void {
  if (!rift || rift.phase === 'pending') return;
  const size = Math.max(HEIGHT, MIN_SCREEN * look.px);
  const k = size / HEIGHT;
  const def = RIFT_BY_ID[rift.id];
  const color = RARITY[def.rarity];
  const life = Math.max(0.001, rift.closesAt - rift.at);
  const age = Math.max(0, time - rift.at);
  // Choosing: held open, steady, while the arena waits.
  const left = rift.phase === 'choosing' ? 1 : Math.max(0, 1 - age / life);
  const unzip = Math.min(1, age / UNZIP);
  const breathe = look.reducedMotion ? 1 : 1 + 0.12 * Math.sin(clock * 4);
  const width = (3 + 7 * left) * breathe;
  const remaining = rift.closesAt - time;
  const flicker = rift.phase === 'shown' && remaining < 2 && !look.reducedMotion ? 0.55 + 0.45 * Math.abs(Math.sin(clock * 18)) : 1;
  const h = HEIGHT * unzip;
  const { x, y } = rift;

  ctx.save();
  // Drawn at its own size, scaled up when the view is far out.
  ctx.translate(x, y);
  ctx.scale(k, k);
  ctx.translate(-x, -y);
  ctx.globalAlpha = flicker;
  // The glow behind it.
  if (look.plain) {
    ctx.fillStyle = withAlpha(color, 0.18);
  } else {
    const g = ctx.createRadialGradient(x, y, 2, x, y, HEIGHT * 0.9);
    g.addColorStop(0, withAlpha(color, 0.45));
    g.addColorStop(1, withAlpha(color, 0));
    ctx.fillStyle = g;
  }
  ctx.beginPath();
  ctx.arc(x, y, HEIGHT * 0.9, 0, Math.PI * 2);
  ctx.fill();

  slit(ctx, x, y, h, width, INK['950'], lighten(color, 0.25));
  // A rare's second hairline crack beside it.
  if (def.rarity !== 'common') {
    ctx.strokeStyle = withAlpha(color, 0.8);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + width + 5, y - h * 0.35);
    ctx.lineTo(x + width + 3, y - h * 0.05);
    ctx.lineTo(x + width + 6, y + h * 0.3);
    ctx.stroke();
  }
  // A legendary's three orbiting sparks.
  if (def.rarity === 'legendary') {
    ctx.fillStyle = lighten(color, 0.4);
    const spin = look.reducedMotion ? 0 : clock * 2.2;
    for (let i = 0; i < 3; i++) {
      const a = spin + (i * Math.PI * 2) / 3;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * HEIGHT * 0.7, y + Math.sin(a) * HEIGHT * 0.55, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** The slit itself: a dark jagged lens with a bright rim. */
function slit(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, w: number, fill: string, rim: string): void {
  const n = JAG.length - 1;
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const bulge = Math.sin(t * Math.PI) * w;
    ctx.lineTo(x + bulge + JAG[i] * 2, y - h / 2 + t * h);
  }
  for (let i = n; i >= 0; i--) {
    const t = i / n;
    const bulge = Math.sin(t * Math.PI) * w;
    ctx.lineTo(x - bulge + JAG[i] * 2, y - h / 2 + t * h);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = rim;
  ctx.lineWidth = 1.6;
  ctx.stroke();
}
