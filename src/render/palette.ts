import type { RimColor } from '../content/types';
/**
 * The single source of truth for every colour that both the canvas renderer and
 * the DOM need to agree on.
 *
 * Before this file `#3ec46d` (and a dozen friends) were typed independently into
 * `main.css`, `Renderer.ts` and several `src/ui/` modules, so a palette change
 * had to be applied in three places and inevitably drifted. Now the values live
 * here, `src/styles/tokens.css` mirrors them as `--fx-*` / `--rarity-*` custom
 * properties, and `tests/palette.test.ts` fails the build if the two lists stop
 * agreeing.
 *
 * **Why a test rather than generating the CSS at boot?** Generating the custom
 * properties from JS would make the first paint depend on the bundle: the app
 * would flash unstyled chrome before `main.ts` ran, the Capacitor splash would
 * not be able to read `--bg-stop-2`, and a stylesheet that cannot be understood
 * without running the game is a bad stylesheet. Declaring the values in CSS and
 * asserting the agreement in CI keeps both files readable on their own and still
 * makes drift a build failure. See `docs/render.md`.
 *
 * Art direction ("arcane siege", plan §2.1):
 * - warm amber  → everything the player owns: the tower, gold, physical shots
 * - violet      → the arcane: mana, magic shots, blessings, research
 * - hostile red → enemies and damage, and nothing else
 * - hot scarlet → the tower in peril, and nothing else (see `critical`)
 */

/**
 * Semantic effect colours shared by the canvas and the DOM. Content names
 * them too (a stratum's rim, plans/late-game/08), so the union lives there.
 */
export type FxColorName = RimColor;

/**
 * `--fx-*`. Every entry has a matching custom property in `tokens.css`.
 *
 * `blood` is the only hostile red on the battlefield: enemy bodies, boss chrome
 * and damage numbers. `critical` is deliberately *not* `blood` — the low-HP
 * vignette and the critical HP bar are the most urgent signal in the game, and
 * sharing a colour with "an enemy exists" flattened it. `critical` is hotter and
 * brighter than `blood` and appears nowhere else.
 */
export const FX: Record<FxColorName, string> = {
  /** Player-owned: tower, gold, physical shots, XP. */
  gold: '#f0b23c',
  /** Fire, burn, enrage warmth. Warm but not hostile. */
  ember: '#ff8b46',
  /** The mana pool. Blue-violet, the cool end of the arcane. */
  mana: '#7f6cff',
  /** Magic shots, blessings, research, transcendence. */
  arcane: '#a95cff',
  /** Enemies and damage. Nothing else may use it. */
  blood: '#d9534f',
  /** Slow, chill, shields. */
  frost: '#79d2ff',
  /** Healing, buffs, "you can afford this", contract progress. */
  nature: '#4ec97a',
  /** The tower is in peril. Low HP, the vignette, a wall breach. */
  critical: '#ff4d3d',
};

/** The standard palette, kept aside so `setPaletteMode` can return to it. */
const STANDARD_FX: Readonly<Record<FxColorName, string>> = { ...FX };

/**
 * The colourblind-safe palette (P9), for the canvas only. The standard
 * weapon colours sit close together for a red-green deficiency: violet and
 * blue-violet, amber and ember and the enemy red. Here each family moves
 * apart on the blue–yellow axis and in lightness, after Paul Tol's and
 * Okabe & Ito's schemes: arcane a clear blue, mana a bright cyan, frost
 * near white, ember a deep orange, gold a pale yellow, blood a rose.
 * `critical` keeps its hot scarlet: the vignette reads by lightness anyway.
 */
export const SAFE_FX: Readonly<Record<FxColorName, string>> = {
  gold: '#ffe45c',
  ember: '#d9700f',
  mana: '#4fd8e0',
  arcane: '#5b8cff',
  blood: '#ee5f8a',
  frost: '#d2efff',
  nature: '#3fbf9a',
  critical: '#ff4d3d',
};

export type PaletteMode = 'standard' | 'safe';

/**
 * Swap the canvas's effect colours in place. Painters read `FX` when they
 * draw, so the next frame wears the new palette; nothing that caches a
 * colour may hold an `FX` value (look it up by name instead). What is baked
 * from `FX` (the ground, enemy sprites) must rebake: go through
 * `Renderer.setPalette`, which drops them.
 */
export function setPaletteMode(mode: PaletteMode): void {
  Object.assign(FX, mode === 'safe' ? SAFE_FX : STANDARD_FX);
}

/**
 * Steps on the ink ramp, lightest first. Mirrors `--ink-*` in `tokens.css`.
 */
export type InkStep =
  | '050' | '100' | '200' | '300' | '400' | '500'
  | '600' | '700' | '800' | '900' | '950';

/**
 * `--ink-*`: the navy-indigo the whole game sits on, in the identity's Blue
 * hour family: indigo darks, lavender-grey lights (plans/visual-identity.md
 * §7). Each step keeps the relative luminance of the blue-grey ramp it
 * replaced, so every `FX` colour's contrast on the ground is unchanged.
 *
 * The `--fx-*` group answers "what does this colour *mean*"; this one answers
 * "what is the ground made of". Part 3's battlefield needs both — the layered
 * ground, the tower's masonry and the wall's stone are all steps on this ramp,
 * and before it was exported the renderer had `#1c2028` and `#0c0e12` and
 * `#5b6b7a` typed into it with nothing tying them to the panels behind.
 *
 * It is a **primitive**, not a semantic token: a DOM rule must go through
 * `--glass-*` / `--text-*` instead. The canvas is the exception, because a
 * painted battlefield has no "surface" to speak of — it has rock.
 */
export const INK: Record<InkStep, string> = {
  '050': '#e9ecf7',
  '100': '#b7bbce',
  '200': '#878ba3',
  '300': '#5e637d',
  '400': '#3e435d',
  '500': '#2c304a',
  '600': '#22263e',
  '700': '#191b33',
  '800': '#12152a',
  '900': '#0a0c1d',
  '950': '#070916',
};

/**
 * The page's ground (`--bg-stop-1…3` in `tokens.css`): the first three stops
 * of the identity's Blue hour gradient. The canvas paints the same sky past
 * the light, with the region's last light as the fourth stop.
 */
export const GROUND = {
  stop1: '#2a1e4c',
  stop2: '#1d2148',
  stop3: '#211d3f',
} as const;

/** `--accent`: the identity's violet. On the canvas, the rim of the light. */
export const ACCENT = '#b3a5ff';

/** The five equipment rarities, weakest first. */
export type RarityTier = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

/**
 * `--rarity-*`. One ladder for equipment *and* blessings — blessings only use
 * `common` / `rare` / `epic`, but a rare blessing and a rare sword should not be
 * two different blues.
 */
export const RARITY: Record<RarityTier, string> = {
  common: '#838d9e',
  uncommon: '#4ec97a',
  rare: '#4a9eff',
  epic: '#a95cff',
  legendary: '#f0b23c',
};

/** `FX.gold` → `'--fx-gold'`. */
export function fxVar(name: FxColorName): string {
  return `--fx-${name}`;
}

/** `RARITY.epic` → `'--rarity-epic'`. */
export function rarityVar(tier: RarityTier): string {
  return `--rarity-${tier}`;
}

/** `INK['700']` → `'--ink-700'`. */
export function inkVar(step: InkStep): string {
  return `--ink-${step}`;
}

/**
 * `'#f0b23c', 0.4` → `'rgba(240, 178, 60, 0.4)'`.
 *
 * The canvas has no `color-mix()`, so every translucent fill in `Renderer.ts`
 * goes through here instead of hand-writing a second copy of the colour.
 */
export function withAlpha(hex: string, alpha: number): string {
  const { r, g, b } = toRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * `mix('#e8ecf4', '#f0b23c', 0.45)` → the hex 45% of the way from the first
 * colour to the second.
 *
 * Straight linear interpolation in sRGB, which is what the canvas composites in
 * anyway. It exists so a "halfway to gold" damage number is derived from the
 * two tokens rather than being a third literal nobody would remember to update.
 */
export function mix(a: string, b: string, t: number): string {
  const k = Math.max(0, Math.min(1, t));
  const ca = toRgb(a);
  const cb = toRgb(b);
  const ch = (x: number, y: number) => Math.round(x + (y - x) * k).toString(16).padStart(2, '0');
  return `#${ch(ca.r, cb.r)}${ch(ca.g, cb.g)}${ch(ca.b, cb.b)}`;
}

/** `'#f0b23c'` → `{ r: 240, g: 178, b: 60 }`. Accepts `#rgb` and `#rrggbb`. */
export function toRgb(hex: string): { r: number; g: number; b: number } {
  let body = hex.trim().replace(/^#/, '');
  if (body.length === 3) body = body[0] + body[0] + body[1] + body[1] + body[2] + body[2];
  const value = Number.parseInt(body, 16);
  if (body.length !== 6 || Number.isNaN(value)) {
    throw new Error(`palette: not a hex colour: ${hex}`);
  }
  return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff };
}

/**
 * `mix(hex, INK['050'], amount)` — the common case, spelled once.
 *
 * Effect literals came in families: one base colour plus two or three paler
 * versions of it for the hot core of a spark or the rim of a ring. Those tints
 * are now derived from the token instead of being separate hexes, so retuning
 * `FX.ember` moves its highlights with it.
 */
export function lighten(hex: string, amount: number): string {
  return mix(hex, INK['050'], amount);
}
