/**
 * theme.ts — the visual identity as a typed, framework-free object.
 *
 * For apps that style in JS (React Native, inline styles, canvas, charts) or
 * that need the raw values. Web apps should prefer tokens.css and read
 * `var(--…)` so one attribute switch flips the theme.
 *
 * Mirrors tokens.css; tokens.json is generated from this file
 * (`npx tsx "visual identity/tokens/build-json.ts"`).
 */

export type Scheme = 'light' | 'dark';

const light = {
  /** Page ground: a 135° gradient, fixed to the viewport. */
  backgroundStops: ['#E8DEFF', '#C8DCFF', '#D4F5E2'],
  backgroundGradient: 'linear-gradient(135deg, #E8DEFF 0%, #C8DCFF 50%, #D4F5E2 100%)',
  themeColor: '#6B5BD9',

  textPrimary: '#2A1F4A',
  textSecondary: '#5B5380',
  textMuted: '#625A86',
  textDim: '#4A4170',

  accent: '#6B5BD9',
  accentStrong: '#5246B8',
  /** The accent as a text color; `accent` itself is only 3.7–4.4:1 on this ground. */
  accentText: '#5246B8',
  accentTint: 'rgba(107, 91, 217, 0.12)',
  accentTintBorder: 'rgba(107, 91, 217, 0.25)',
  accentGradient: 'linear-gradient(135deg, #6B5BD9 0%, #4A5FD0 100%)',

  glassFill: 'rgba(255, 255, 255, 0.18)',
  glassFillStrong: 'rgba(255, 255, 255, 0.38)',
  glassFillSubtle: 'rgba(255, 255, 255, 0.10)',
  glassFillAccent: 'rgba(101, 91, 217, 0.25)',
  glassFillSheet:
    'linear-gradient(135deg, rgba(232, 222, 255, 0.72) 0%, rgba(200, 220, 255, 0.72) 50%, rgba(212, 245, 226, 0.72) 100%)',
  glassBorder: 'rgba(255, 255, 255, 0.65)',
  glassBorderSubtle: 'rgba(255, 255, 255, 0.30)',
  glassShadow: '0 8px 24px rgba(75, 58, 158, 0.18)',
  blur: 25,

  surface: 'rgba(255, 255, 255, 0.45)',
  panelSubtle: 'rgba(255, 255, 255, 0.45)',
  border: 'rgba(255, 255, 255, 0.7)',
  borderLight: 'rgba(255, 255, 255, 0.35)',
  progressTrack: 'rgba(75, 58, 158, 0.18)',

  success: '#2E7D32',
  successBg: 'rgba(200, 240, 210, 0.55)',
  successBorder: 'rgba(120, 200, 140, 0.7)',
  error: '#C62828',
  errorBg: 'rgba(255, 215, 220, 0.55)',
  errorBorder: 'rgba(230, 150, 160, 0.7)',
  warning: '#EF6C00',
  warningBg: 'rgba(239, 108, 0, 0.14)',
  info: '#1E5A8B',
  infoBg: 'rgba(200, 225, 250, 0.55)',

  tintViolet: 'rgba(232, 220, 255, 0.55)',
  tintBlue: 'rgba(200, 220, 255, 0.55)',
  tintPink: 'rgba(255, 220, 240, 0.55)',
  tintMint: 'rgba(200, 245, 225, 0.55)',

  shadow: {
    sm: '0 1px 2px rgba(107, 91, 217, 0.10)',
    md: '0 2px 6px rgba(107, 91, 217, 0.12)',
    lg: '0 8px 24px rgba(74, 58, 158, 0.18)',
  },

  white: '#FFFFFF',
  black: '#000000',
};

export type Palette = typeof light;

const dark: Palette = {
  backgroundStops: ['#2A1E4C', '#1D2148', '#16294A', '#0F2B3C'],
  backgroundGradient: 'linear-gradient(135deg, #2A1E4C 0%, #1D2148 32%, #16294A 66%, #0F2B3C 100%)',
  themeColor: '#1D2148',

  textPrimary: '#E9E6F7',
  textSecondary: '#B0B8D8',
  textMuted: '#949DBD',
  textDim: '#9EA7C8',

  accent: '#B3A5FF',
  accentStrong: '#8F7FE8',
  accentText: '#B3A5FF',
  accentTint: 'rgba(179, 165, 255, 0.12)',
  accentTintBorder: 'rgba(179, 165, 255, 0.25)',
  accentGradient: 'linear-gradient(135deg, #7A6AE4 0%, #5A71DD 100%)',

  glassFill: 'rgba(173, 190, 255, 0.07)',
  glassFillStrong:
    'linear-gradient(135deg, rgba(198, 208, 255, 0.20) 0%, rgba(150, 170, 255, 0.09) 100%)',
  glassFillSubtle: 'rgba(173, 190, 255, 0.035)',
  glassFillAccent:
    'linear-gradient(135deg, rgba(160, 145, 255, 0.32) 0%, rgba(120, 160, 255, 0.20) 100%)',
  glassFillSheet:
    'linear-gradient(135deg, rgba(42, 30, 76, 0.76) 0%, rgba(29, 33, 72, 0.76) 32%, rgba(22, 41, 74, 0.76) 66%, rgba(15, 43, 60, 0.76) 100%)',
  glassBorder: 'rgba(196, 208, 255, 0.24)',
  glassBorderSubtle: 'rgba(196, 208, 255, 0.11)',
  glassShadow: '0 8px 24px rgba(6, 8, 24, 0.5)',
  blur: 20,

  surface: 'rgba(173, 190, 255, 0.09)',
  panelSubtle: 'rgba(173, 190, 255, 0.075)',
  border: 'rgba(196, 208, 255, 0.24)',
  borderLight: 'rgba(196, 208, 255, 0.12)',
  progressTrack: '#949DBD',

  success: '#6FD9A6',
  successBg: 'rgba(111, 217, 166, 0.16)',
  successBorder: 'rgba(111, 217, 166, 0.38)',
  error: '#FF9A94',
  errorBg: 'rgba(255, 154, 148, 0.16)',
  errorBorder: 'rgba(255, 154, 148, 0.38)',
  warning: '#FFC078',
  warningBg: 'rgba(255, 192, 120, 0.14)',
  info: '#7FC4F5',
  infoBg: 'rgba(127, 196, 245, 0.18)',

  tintViolet: 'rgba(122, 106, 228, 0.28)',
  tintBlue: 'rgba(90, 113, 221, 0.28)',
  tintPink: 'rgba(196, 122, 214, 0.26)',
  tintMint: 'rgba(90, 196, 162, 0.24)',

  shadow: {
    sm: '0 1px 2px rgba(11, 12, 34, 0.30)',
    md: '0 2px 6px rgba(11, 12, 34, 0.35)',
    lg: '0 8px 24px rgba(5, 6, 15, 0.50)',
  },

  white: '#FFFFFF',
  black: '#000000',
};

export const palettes: Record<Scheme, Palette> = { light, dark };

export function getPalette(scheme: Scheme): Palette {
  return palettes[scheme];
}

/** Icon hues for categories. Always use the pair; the dark half is lifted to 6–9:1. */
export const hues = {
  teal: { light: '#00838F', dark: '#6FD0DE' },
  pine: { light: '#00695C', dark: '#6FD3C3' },
  orange: { light: '#E65100', dark: '#FFA366' },
  amber: { light: '#EF6C00', dark: '#FFB570' },
  coral: { light: '#FF7043', dark: '#FFA183' },
  orchid: { light: '#8E24AA', dark: '#D79BE0' },
  violet: { light: '#7B1FA2', dark: '#C79BE8' },
  azure: { light: '#0277BD', dark: '#7FC0EE' },
  rose: { light: '#E53935', dark: '#FF8A80' },
} as const;

export const font = {
  sans: '"Sarabun", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  sansAlt: '"Kanit", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  weight: { regular: 400, semibold: 600, bold: 700 },
  lineHeight: { tight: 1.2, snug: 1.25, body: 1.4 },
  trackingLabel: '1px',
} as const;

export const fontSize = {
  xs: 12,
  sm: 13,
  md: 14,
  lg: 16,
  xl: 18,
  xxl: 20,
  xxxl: 22,
  title: 24,
  hero: 28,
  display: 36,
  giant: 48,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  giant: 48,
} as const;

export const pageGutter = spacing.lg;
export const contentMaxWidth = 720;

export const radius = {
  sm: 8,
  md: 10,
  lg: 12,
  xl: 14,
  xxl: 16,
  pill: 20,
  round: 999,
} as const;

/** Which radius each kind of surface takes. */
export const surfaceRadius = {
  card: radius.lg,
  button: radius.xl,
  chip: radius.round,
  sheet: radius.xxl,
} as const;

export const controlHeight = { lg: 52, md: 48, sm: 40 } as const;
export const hitTarget = 44;

export const motion = {
  duration: { instant: 120, fast: 180, base: 280, slow: 420, deliberate: 700 },
  ease: {
    standard: 'cubic-bezier(0.2, 0, 0, 1)',
    decelerate: 'cubic-bezier(0, 0, 0, 1)',
    accelerate: 'cubic-bezier(0.3, 0, 1, 1)',
  },
  staggerStep: 60,
  staggerCap: 240,
  /**
   * Page change. A push lays the new page over the old one (new: 100% → 0,
   * old: 0 → -25% while dimming to 0.55); a pop lifts the top page off and the
   * page underneath runs the same moves in reverse. Both layers share one
   * duration and curve so they stay locked together.
   */
  page: {
    duration: 280,
    ease: 'cubic-bezier(0, 0, 0, 1)',
    parallax: -0.25,
    underOpacity: 0.55,
    firstFade: 200,
  },
  /** On/off switch: the thumb slides and the track fills together. */
  switch: { duration: 180, ease: 'cubic-bezier(0.2, 0, 0, 1)' },
} as const;
