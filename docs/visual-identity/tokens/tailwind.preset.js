/**
 * tailwind.preset.js — the identity for Tailwind CSS (v3 config preset; for v4
 * see the note at the bottom).
 *
 * Every color points at a CSS variable from tokens.css, so `data-theme` (or
 * the OS preference) flips the whole app without `dark:` variants:
 *
 *   // tailwind.config.js
 *   module.exports = { presets: [require('./visual identity/tokens/tailwind.preset.js')] };
 *   // and import tokens.css (+ components.css for .glass/.btn) once, globally.
 *
 *   <div class="glass rounded-card p-lg text-ink">…</div>
 *   <button class="bg-accent-gradient text-white rounded-button min-h-control-md font-bold">…</button>
 */
const v = (name) => `var(--${name})`;

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: v('text-primary'),
          secondary: v('text-secondary'),
          muted: v('text-muted'),
          dim: v('text-dim'),
        },
        accent: {
          DEFAULT: v('accent'),
          strong: v('accent-strong'),
          text: v('accent-text'),
          tint: v('accent-tint'),
          'tint-border': v('accent-tint-border'),
        },
        surface: v('surface'),
        inset: v('panel-subtle'),
        line: {
          DEFAULT: v('border'),
          light: v('border-light'),
          glass: v('glass-border'),
          'glass-subtle': v('glass-border-subtle'),
        },
        glass: { DEFAULT: v('glass-fill'), subtle: v('glass-fill-subtle') },
        success: { DEFAULT: v('success'), bg: v('success-bg'), border: v('success-border') },
        error: { DEFAULT: v('error'), bg: v('error-bg'), border: v('error-border') },
        warning: { DEFAULT: v('warning'), bg: v('warning-bg') },
        info: { DEFAULT: v('info'), bg: v('info-bg') },
        tint: {
          violet: v('tint-violet'),
          blue: v('tint-blue'),
          pink: v('tint-pink'),
          mint: v('tint-mint'),
        },
        hue: {
          teal: v('hue-teal'),
          pine: v('hue-pine'),
          orange: v('hue-orange'),
          amber: v('hue-amber'),
          coral: v('hue-coral'),
          orchid: v('hue-orchid'),
          violet: v('hue-violet'),
          azure: v('hue-azure'),
          rose: v('hue-rose'),
        },
      },
      backgroundImage: {
        page: v('bg-gradient'),
        'accent-gradient': v('accent-gradient'),
        'glass-strong': v('glass-fill-strong'),
        'glass-sheet': v('glass-fill-sheet'),
      },
      fontFamily: {
        sans: ['Sarabun', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        alt: ['Kanit', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      fontSize: {
        xs: ['12px', '1.4'],
        sm: ['13px', '1.4'],
        md: ['14px', '1.4'],
        lg: ['16px', '1.4'],
        xl: ['18px', '1.25'],
        '2xl': ['20px', '1.25'],
        '3xl': ['22px', '1.2'],
        title: ['24px', '1.2'],
        hero: ['28px', '1.2'],
        display: ['36px', '1.2'],
        giant: ['48px', '1.1'],
      },
      letterSpacing: { label: '1px', badge: '0.06em' },
      spacing: {
        xs: '4px',
        sm: '8px',
        md: '12px',
        lg: '16px',
        xl: '20px',
        '2xl': '24px',
        '3xl': '32px',
        giant: '48px',
        gutter: '16px',
        'control-sm': '40px',
        'control-md': '48px',
        'control-lg': '52px',
      },
      minHeight: { 'control-sm': '40px', 'control-md': '48px', 'control-lg': '52px', hit: '44px' },
      maxWidth: { content: '720px' },
      borderRadius: {
        sm: '8px',
        md: '10px',
        lg: '12px',
        xl: '14px',
        '2xl': '16px',
        pill: '20px',
        round: '999px',
        card: '12px',
        button: '14px',
        chip: '999px',
        sheet: '16px',
      },
      boxShadow: { glass: v('glass-shadow') },
      backdropBlur: { glass: v('blur') },
      transitionDuration: {
        instant: '120ms',
        fast: '180ms',
        base: '280ms',
        slow: '420ms',
        deliberate: '700ms',
      },
      transitionTimingFunction: {
        standard: 'cubic-bezier(0.2, 0, 0, 1)',
        decelerate: 'cubic-bezier(0, 0, 0, 1)',
        accelerate: 'cubic-bezier(0.3, 0, 1, 1)',
      },
    },
  },
};

/*
 * Tailwind v4 (CSS-first config): skip this file. Import tokens.css, then map
 * the variables in an @theme block, e.g.
 *
 *   @import "tailwindcss";
 *   @import "./visual identity/tokens/tokens.css";
 *   @theme inline {
 *     --color-ink: var(--text-primary);
 *     --color-ink-secondary: var(--text-secondary);
 *     --color-accent: var(--accent);
 *     --color-accent-text: var(--accent-text);
 *     --radius-card: 12px;
 *     --radius-button: 14px;
 *     --font-sans: "Sarabun", system-ui, sans-serif;
 *   }
 */
