/**
 * build-json.ts — writes tokens.json from theme.ts, so the two never drift.
 *
 *   npx tsx "visual identity/tokens/build-json.ts"
 *
 * Output follows the W3C Design Tokens draft shape ({ $value, $type }), which
 * Style Dictionary, Tokens Studio (Figma) and most token tools import.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  contentMaxWidth,
  controlHeight,
  font,
  fontSize,
  hitTarget,
  hues,
  motion,
  pageGutter,
  palettes,
  radius,
  spacing,
  surfaceRadius,
} from './theme';

type Tree = { [key: string]: Tree | { $value: unknown; $type: string } };

function typeOf(key: string, value: unknown): string {
  if (typeof value === 'number') return key === 'blur' ? 'dimension' : 'number';
  if (typeof value !== 'string') return 'other';
  if (value.startsWith('linear-gradient')) return 'gradient';
  if (/^(#|rgba?\()/.test(value)) return 'color';
  if (/px .*rgba/.test(value)) return 'shadow';
  return 'other';
}

function leafs(obj: Record<string, unknown>, forceType?: string): Tree {
  const out: Tree = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = leafs(value as Record<string, unknown>, forceType);
    } else {
      out[key] = {
        $value: forceType === 'dimension' && typeof value === 'number' ? `${value}px` : value,
        $type: forceType ?? (Array.isArray(value) ? 'color' : typeOf(key, value)),
      };
    }
  }
  return out;
}

const tokens = {
  $description:
    'Visual identity extracted from Learn Thai. Light = "sunrise", dark = "blue hour". See GUIDELINES.md.',
  color: {
    light: leafs(palettes.light as unknown as Record<string, unknown>),
    dark: leafs(palettes.dark as unknown as Record<string, unknown>),
    hue: leafs(hues as unknown as Record<string, unknown>, 'color'),
  },
  font: {
    family: {
      sans: { $value: font.sans, $type: 'fontFamily' },
      sansAlt: { $value: font.sansAlt, $type: 'fontFamily' },
    },
    weight: leafs(font.weight, 'fontWeight'),
    lineHeight: leafs(font.lineHeight, 'number'),
    size: leafs(fontSize, 'dimension'),
  },
  spacing: leafs({ ...spacing, pageGutter, contentMaxWidth }, 'dimension'),
  radius: leafs({ ...radius, surface: surfaceRadius }, 'dimension'),
  size: leafs({ control: controlHeight, hitTarget }, 'dimension'),
  motion: {
    duration: Object.fromEntries(
      Object.entries(motion.duration).map(([k, v]) => [k, { $value: `${v}ms`, $type: 'duration' }]),
    ),
    ease: leafs(motion.ease, 'cubicBezier'),
    page: {
      duration: { $value: `${motion.page.duration}ms`, $type: 'duration' },
      ease: { $value: motion.page.ease, $type: 'cubicBezier' },
      parallax: { $value: motion.page.parallax, $type: 'number' },
      underOpacity: { $value: motion.page.underOpacity, $type: 'number' },
      firstFade: { $value: `${motion.page.firstFade}ms`, $type: 'duration' },
    },
    switch: {
      duration: { $value: `${motion.switch.duration}ms`, $type: 'duration' },
      ease: { $value: motion.switch.ease, $type: 'cubicBezier' },
    },
  },
};

const here = dirname(fileURLToPath(import.meta.url));
writeFileSync(join(here, 'tokens.json'), `${JSON.stringify(tokens, null, 2)}\n`);
console.log('wrote tokens.json');
