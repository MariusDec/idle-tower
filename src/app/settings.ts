import type { Profile } from '../meta/profile';
import type { Synth } from '../audio/synth';
import type { Renderer } from '../render/renderer';

/**
 * The settings (§10.1, P9) reach the game from here, and only from here:
 * the synth's levels, the renderer's motion, text size and palette, and the
 * two things the stylesheet reads off the root element (`data-motion` and
 * `--text-scale`). The quality tier is a device's, not a profile's, so it
 * lives in `render/quality.ts`'s stored preference instead.
 */
export type Settings = Profile['settings'];

const OS_REDUCED = '(prefers-reduced-motion: reduce)';

/** The device asks for reduced motion. */
export function osReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia(OS_REDUCED).matches;
}

/** Reduced motion as the player's setting resolves it. */
export function motionReduced(s: Settings): boolean {
  return s.motion === 'reduce' || (s.motion === 'system' && osReducedMotion());
}

export interface SettingsTargets {
  synth: Synth;
  renderer: Renderer;
  root: HTMLElement;
}

/** Apply every setting at once; cheap enough to call on each change. */
export function applySettings(s: Settings, t: SettingsTargets): void {
  t.synth.setEnabled(s.sound);
  t.synth.setVolumes(s.volume);
  const reduced = motionReduced(s);
  t.renderer.setMotion(reduced, s.shake);
  t.renderer.setTextScale(s.textScale);
  t.renderer.setPalette(s.palette);
  t.root.dataset.motion = reduced ? 'reduce' : 'full';
  t.root.style.setProperty('--text-scale', String(s.textScale));
}

/** Call `fn` when the device's reduced-motion setting changes (it matters under 'system'). */
export function onOsMotionChange(fn: () => void): void {
  if (typeof matchMedia !== 'function') return;
  matchMedia(OS_REDUCED).addEventListener?.('change', fn);
}
