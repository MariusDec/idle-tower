import type { Profile } from '../meta/profile';
import type { Synth } from '../audio/synth';
import type { Renderer } from '../render/renderer';
import type { QualityTier } from '../render/quality';
import { LAST_LIGHT, REGIONS } from '../content/regions';
import { ABYSS_INDEX, ABYSS_LAST_LIGHT } from '../content/abyss';
import { RUSH_INDEX, RUSH_LAST_LIGHT } from '../content/rush';

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
  t.renderer.camera.setFraming(s.framing);
  t.root.dataset.motion = reduced ? 'reduce' : 'full';
  t.root.style.setProperty('--text-scale', String(s.textScale));
}

/** Call `fn` when the device's reduced-motion setting changes (it matters under 'system'). */
export function onOsMotionChange(fn: () => void): void {
  if (typeof matchMedia !== 'function') return;
  matchMedia(OS_REDUCED).addEventListener?.('change', fn);
}

/** The ember dusk: the horizon when nothing more particular applies. */
const DEFAULT_LAST_LIGHT = LAST_LIGHT['ashen-fields'];

/** A region's last light by index, the Abyss's and Boss Rush's included. */
export function lastLightFor(regionIndex: number): string {
  if (regionIndex === ABYSS_INDEX) return ABYSS_LAST_LIGHT;
  if (regionIndex === RUSH_INDEX) return RUSH_LAST_LIGHT;
  const r = REGIONS.find((x) => x.index === regionIndex);
  return (r && LAST_LIGHT[r.id]) ?? DEFAULT_LAST_LIGHT;
}

let groundShown: string | null = null;

/**
 * The ground's horizon (plans/visual-identity.md §2.2): `--bg-last-light` on the
 * root, from the region the hub has selected or the run is played in. The
 * stylesheet registers it as a colour, so a change moves over `--dur-slow`.
 * Called every frame; writes only on a change.
 */
export function applyGround(root: HTMLElement, regionIndex: number): void {
  const color = lastLightFor(regionIndex);
  if (color === groundShown) return;
  groundShown = color;
  root.style.setProperty('--bg-last-light', color);
}

/**
 * The quality tier, as `data-quality` on the root (plans/visual-identity.md
 * §2.4): glass blurs only on `high`, and never over the running arena.
 */
export function applyQuality(root: HTMLElement, tier: QualityTier): void {
  if (root.dataset.quality !== tier) root.dataset.quality = tier;
}
