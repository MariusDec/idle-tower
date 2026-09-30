/**
 * The icon layer (UI plan §6.3).
 *
 * Every icon in the game is one `<symbol>` in `public/icons/sprite.svg`,
 * referenced by an `<svg><use href="#gi-…">`. Three properties fall out of that
 * and they are the whole reason for the choice:
 *
 * - **One asset per icon, not per state.** The artwork is single-path and
 *   monochrome and the fetch script strips the upstream white fill, so the path
 *   paints in `currentColor`. A rarity tint, a disabled state and a core accent
 *   are CSS on the wrapper, never a second file.
 * - **One HTTP request for ~200 icons**, and it is a static file, so the
 *   Capacitor build ships it in `dist/` with no runtime network.
 * - **The id is closed.** `IconId` is generated from the pinned manifest, so a
 *   misspelled icon fails `tsc` rather than rendering as an empty box.
 *
 * Rarity frames are CSS (gradient border + inner glow + corner notch), which is
 * why `iconFrame` takes a rarity rather than a different `IconId` per tier.
 */

import { iconSymbolId, type IconId } from '../data/icons';
import type { Rarity } from '../types';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

/** Relative so a non-root `base` (Capacitor ships `./`) keeps resolving. */
export const ICON_SPRITE_PATH = 'icons/sprite.svg';

/** The id of the hidden `<div>` the sprite is injected into. */
const SPRITE_HOST_ID = 'icon-sprite-host';

/**
 * Semantic tints, mapped to the `--fx-*` tokens in `tokens.css`.
 *
 * Deliberately *not* a free-form colour: §0.8 rule 4 says a literal colour in a
 * component is a bug, and an icon is the single most tempting place to type one.
 */
export type IconTone =
  | 'default' | 'muted' | 'inherit'
  | 'gold' | 'ember' | 'mana' | 'arcane' | 'blood' | 'frost' | 'nature' | 'critical';

/** The framed presets from the plan: an ability tile, a talent node, an upgrade row, an item. */
export type IconFrameVariant = 'ability' | 'talent' | 'upgrade' | 'item' | 'plain';

export interface IconOptions {
  /** Rendered box in px. Defaults to 24 — the size the artwork was chosen to read at. */
  size?: number;
  tone?: IconTone;
  className?: string;
  /** Adds a `<title>`; without it the icon is `aria-hidden` because it is decorative. */
  title?: string;
}

export interface IconFrameOptions extends IconOptions {
  variant?: IconFrameVariant;
  rarity?: Rarity;
  /** Renders the frame in its unaffordable / locked state. */
  disabled?: boolean;
}

function toneClass(tone: IconTone | undefined): string {
  return !tone || tone === 'default' ? '' : ` icon--${tone}`;
}

/** The `<svg><use>` pair, as a DOM node. */
export function icon(id: IconId, opts: IconOptions = {}): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', `icon${toneClass(opts.tone)}${opts.className ? ` ${opts.className}` : ''}`);
  svg.setAttribute('viewBox', '0 0 512 512');
  if (opts.size) svg.style.setProperty('--icon-size', `${opts.size}px`);
  if (opts.title) {
    const title = document.createElementNS(SVG_NS, 'title');
    title.textContent = opts.title;
    svg.setAttribute('role', 'img');
    svg.appendChild(title);
  } else {
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
  }
  svg.appendChild(makeUse(id));
  return svg;
}

/** The same thing as a string, for the handful of panels that build HTML. */
export function iconMarkup(id: IconId, opts: IconOptions = {}): string {
  const style = opts.size ? ` style="--icon-size:${opts.size}px"` : '';
  const cls = `icon${toneClass(opts.tone)}${opts.className ? ` ${opts.className}` : ''}`;
  const label = opts.title ? ' role="img"' : ' aria-hidden="true" focusable="false"';
  const title = opts.title ? `<title>${escapeText(opts.title)}</title>` : '';
  return `<svg class="${cls}" viewBox="0 0 512 512"${style}${label}>`
    + `${title}<use href="#${iconSymbolId(id)}"></use></svg>`;
}

/**
 * A framed icon: the wrapper carries the frame, the inner `<svg>` the artwork.
 *
 * Splitting them matters because the frame needs a background, a border and a
 * `::after` notch, none of which an `<svg>` element can carry, and because the
 * rarity tint has to reach both the border and the glow.
 */
export function iconFrame(id: IconId, opts: IconFrameOptions = {}): HTMLElement {
  const wrap = document.createElement('span');
  const variant = opts.variant ?? 'plain';
  wrap.className = `icon-frame icon-frame--${variant}${opts.className ? ` ${opts.className}` : ''}`;
  if (opts.rarity) wrap.dataset.rarity = opts.rarity;
  if (opts.disabled) wrap.classList.add('is-disabled');
  wrap.appendChild(icon(id, { size: opts.size, tone: opts.tone, title: opts.title }));
  return wrap;
}

/** Repoint an existing icon at a different symbol, so panels can update in place. */
export function setIcon(svg: SVGSVGElement | null | undefined, id: IconId): void {
  if (!svg) return;
  const use = svg.querySelector('use');
  if (!use) {
    svg.appendChild(makeUse(id));
    return;
  }
  const href = `#${iconSymbolId(id)}`;
  if (use.getAttribute('href') === href) return;
  use.setAttribute('href', href);
  use.setAttributeNS(XLINK_NS, 'xlink:href', href);
}

/**
 * Put `id` inside `host`, reusing the `<svg>` already there.
 *
 * The panels re-render on every state tick, so the update path must not churn
 * DOM: an unchanged icon is a no-op, a changed one is a single attribute write.
 */
export function renderIcon(
  host: HTMLElement | null | undefined,
  id: IconId,
  opts: IconOptions = {},
): void {
  if (!host) return;
  const existing = host.querySelector('svg.icon') as SVGSVGElement | null;
  if (existing) {
    setIcon(existing, id);
    return;
  }
  host.textContent = '';
  host.appendChild(icon(id, opts));
}

function makeUse(id: IconId): SVGUseElement {
  const use = document.createElementNS(SVG_NS, 'use');
  const href = `#${iconSymbolId(id)}`;
  use.setAttribute('href', href);
  // Safari < 16 still wants the namespaced form; harmless everywhere else.
  use.setAttributeNS(XLINK_NS, 'xlink:href', href);
  return use;
}

function escapeText(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}

let spritePromise: Promise<void> | null = null;

/**
 * Inject the sprite into the document.
 *
 * `<use href="external.svg#id">` is *not* supported in Chromium, so the sprite
 * has to live in the same document. Boot awaits this before mounting the UI:
 * a `<use>` that resolves nothing paints nothing, and the alternative — relying
 * on the browser re-resolving the reference when the symbol shows up later —
 * is a rendering detail we would rather not bet the whole icon layer on.
 *
 * Idempotent, and it resolves (rather than rejects) on failure: a missing
 * sprite must cost icons, not the game.
 */
export function loadIconSprite(url = ICON_SPRITE_PATH): Promise<void> {
  if (spritePromise) return spritePromise;
  if (typeof document === 'undefined') return Promise.resolve();
  if (document.getElementById(SPRITE_HOST_ID)) return Promise.resolve();

  spritePromise = fetch(new URL(url, document.baseURI).href)
    .then((res) => {
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return res.text();
    })
    .then((markup) => {
      const host = document.createElement('div');
      host.id = SPRITE_HOST_ID;
      host.setAttribute('aria-hidden', 'true');
      // The sprite carries `style="display:none"` on its own <svg>; the host is
      // hidden too so an old cached sprite without it still cannot take layout.
      host.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
      host.innerHTML = markup;
      document.body.insertBefore(host, document.body.firstChild);
    })
    .catch((err) => {
      console.error('[icons] sprite failed to load; icons will be blank', err);
    });
  return spritePromise;
}
