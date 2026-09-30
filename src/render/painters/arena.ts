import { ARENA } from '../../content/arena';
import { FX, INK, withAlpha } from '../palette';

/**
 * The ground: the Blight outside, the circle of light inside (§3). Baked once
 * per backing-store size into an offscreen canvas and blitted each frame.
 */
export function bakeArena(width: number, height: number, scale: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const g = c.getContext('2d')!;
  g.fillStyle = INK['950'];
  g.fillRect(0, 0, width, height);

  g.setTransform(scale, 0, 0, scale, width / 2, height / 2);
  const rx = ARENA.halfWidth;
  const ry = ARENA.halfHeight;

  // The lit field: a warm core fading to ink at the rim.
  g.save();
  g.scale(1, ry / rx);
  const light = g.createRadialGradient(0, 0, rx * 0.05, 0, 0, rx);
  light.addColorStop(0, INK['600']);
  light.addColorStop(0.55, INK['700']);
  light.addColorStop(1, INK['800']);
  g.fillStyle = light;
  g.beginPath();
  g.arc(0, 0, rx, 0, Math.PI * 2);
  g.fill();
  g.restore();

  // The rim of the light, where the Blight begins.
  g.lineWidth = Math.max(2, 2 / scale);
  g.strokeStyle = withAlpha(FX.arcane, 0.28);
  g.beginPath();
  g.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = Math.max(10, 10 / scale);
  g.strokeStyle = withAlpha(FX.arcane, 0.06);
  g.stroke();

  // Faint concentric guides so distance reads at a glance.
  g.lineWidth = Math.max(1, 1 / scale);
  g.strokeStyle = withAlpha(INK['300'], 0.12);
  for (const f of [0.33, 0.66]) {
    g.beginPath();
    g.ellipse(0, 0, rx * f, ry * f, 0, 0, Math.PI * 2);
    g.stroke();
  }
  return c;
}
