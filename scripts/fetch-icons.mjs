#!/usr/bin/env node
/**
 * Icon pipeline (UI plan §6).
 *
 * Pulls a *pinned* set of icons from https://github.com/game-icons/icons and
 * bakes them into three committed artefacts:
 *
 *   public/icons/sprite.svg   one <symbol> per icon, referenced by <use href="#gi-…">
 *   src/data/icons.ts         the closed `IconId` union + per-icon credit metadata
 *   ATTRIBUTION.md            the CC BY 3.0 credit the licence actually requires
 *
 * All three are checked in, so a clean checkout — and the Capacitor build —
 * never touches the network. Re-run this script only when MANIFEST changes:
 *
 *   node scripts/fetch-icons.mjs
 *
 * Why a manifest and not a directory scan: `IconId` is generated *from* this
 * list, so a data table that names an icon nobody pinned is a `tsc` error
 * rather than an empty box in a panel. Same discipline as `RENDERED_ENEMY_SHAPES`.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RAW_BASE = 'https://raw.githubusercontent.com/game-icons/icons/master';
const REPO_URL = 'https://github.com/game-icons/icons';

/**
 * Contributors, as named by the upstream `license.txt`.
 *
 * Everything is CC BY 3.0 except the two contributors upstream explicitly
 * marks CC0. Adding an icon by a contributor missing from this table is a
 * hard error — an un-credited icon is a licence violation, not a warning.
 */
const AUTHORS = {
  lorc: { name: 'Lorc', url: 'https://lorcblog.blogspot.com', license: 'CC BY 3.0' },
  delapouite: { name: 'Delapouite', url: 'https://delapouite.com', license: 'CC BY 3.0' },
  skoll: { name: 'Skoll', url: 'https://game-icons.net', license: 'CC BY 3.0' },
  sbed: { name: 'Sbed', url: 'https://opengameart.org/content/95-game-icons', license: 'CC BY 3.0' },
  'carl-olsen': { name: 'Carl Olsen', url: 'https://twitter.com/unstoppableCarl', license: 'CC BY 3.0' },
  faithtoken: { name: 'Faithtoken', url: 'https://fungustoken.deviantart.com', license: 'CC BY 3.0' },
  'lord-berandas': { name: 'Lord Berandas', url: 'https://berandas.deviantart.com', license: 'CC BY 3.0' },
  willdabeast: { name: 'Willdabeast', url: 'https://wjbstories.blogspot.com', license: 'CC BY 3.0' },
  'caro-asercion': { name: 'Caro Asercion', url: 'https://game-icons.net', license: 'CC BY 3.0' },
  darkzaitzev: { name: 'DarkZaitzev', url: 'https://darkzaitzev.deviantart.com', license: 'CC BY 3.0' },
  quoting: { name: 'Quoting', url: 'https://game-icons.net', license: 'CC BY 3.0' },
  'john-colburn': { name: 'John Colburn', url: 'https://ninmunanmu.com', license: 'CC BY 3.0' },
  felbrigg: { name: 'Felbrigg', url: 'https://blackdogofdoom.blogspot.co.uk', license: 'CC BY 3.0' },
  'heavenly-dog': { name: 'HeavenlyDog', url: 'https://www.gnomosygoblins.blogspot.com', license: 'CC BY 3.0' },
  cathelineau: { name: 'Cathelineau', url: 'https://game-icons.net', license: 'CC BY 3.0' },
  'viscious-speed': { name: 'Viscious Speed', url: 'https://viscious-speed.deviantart.com', license: 'CC0' },
  zeromancer: { name: 'Zeromancer', url: 'https://game-icons.net', license: 'CC0' },
};

/**
 * The pinned set. `id` is what the game refers to an icon by and is also the
 * `<symbol>` id (prefixed `gi-`); `author`/`slug` locate the upstream file.
 *
 * `id === slug` on purpose: an icon is named for *what it depicts*, not for
 * the one table that happens to use it, so "the crit-chance icon" is the same
 * `dead-eye` on the upgrade row, the passive tile and the stats readout.
 *
 * Grouped by the surface that motivated the pick; reuse across groups is
 * expected and is why the list is deduplicated at load time.
 */
const MANIFEST = dedupe([
  // ── Active abilities ────────────────────────────────
  ['lorc', 'arrow-cluster'], ['lorc', 'frozen-orb'], ['willdabeast', 'chain-lightning'],
  ['lorc', 'arrow-scope'], ['delapouite', 'enrage'], ['lorc', 'burning-meteor'],
  ['delapouite', 'coins-pile'], ['lorc', 'guillotine'], ['delapouite', 'split-arrows'],
  ['lorc', 'fangs-circle'],

  // ── Passive abilities ───────────────────────────────
  ['skoll', 'bullseye'], ['sbed', 'health-increase'], ['delapouite', 'gold-nuggets'],
  ['lorc', 'wingfoot'], ['lorc', 'fountain'], ['lorc', 'spiked-halo'],
  ['lorc', 'target-shot'], ['lorc', 'life-tap'],

  // ── Upgrades ────────────────────────────────────────
  ['lorc', 'broadhead-arrow'], ['lorc', 'fast-arrow'], ['delapouite', 'bow-arrow'],
  ['lorc', 'dead-eye'], ['lorc', 'barbed-arrow'], ['lorc', 'land-mine'],
  ['lorc', 'striking-arrows'], ['lorc', 'energy-arrow'], ['delapouite', 'extra-time'],
  ['lorc', 'shiny-purse'], ['lorc', 'prayer'], ['lorc', 'crystal-cluster'],
  ['skoll', 'open-treasure-chest'], ['delapouite', 'wisdom'], ['delapouite', 'shop'],
  ['lorc', 'standing-potion'], ['delapouite', 'wanted-reward'], ['caro-asercion', 'coinflip'],
  ['lorc', 'heart-tower'], ['sbed', 'regeneration'], ['lorc', 'bordered-shield'],
  ['lorc', 'breastplate'], ['lorc', 'echo-ripples'], ['sbed', 'spikes'],
  ['lorc', 'heart-drop'], ['lorc', 'energy-shield'], ['delapouite', 'brick-wall'],

  // ── Research nodes ──────────────────────────────────
  ['lorc', 'piercing-sword'], ['lorc', 'imbricated-arrows'], ['delapouite', 'armor-upgrade'],
  ['lorc', 'spiky-explosion'], ['lorc', 'bubbling-flask'], ['willdabeast', 'gold-bar'],
  ['delapouite', 'money-stack'], ['lorc', 'crown-coin'], ['lorc', 'chalice-drops'],
  ['lorc', 'wizard-staff'], ['caro-asercion', 'round-potion'], ['lorc', 'frostfire'],
  ['delapouite', 'fast-forward-button'], ['delapouite', 'walking-scout'], ['delapouite', 'telescope'],
  ['lorc', 'concentration-orb'], ['delapouite', 'all-seeing-eye'],

  // ── Talents ─────────────────────────────────────────
  ['lorc', 'crossed-swords'], ['lorc', 'supersonic-arrow'], ['lorc', 'crosshair-arrow'],
  ['lorc', 'deadly-strike'], ['lorc', 'interleaved-arrows'], ['delapouite', 'executioner-hood'],
  ['lorc', 'missile-swarm'], ['lorc', 'bright-explosion'], ['sbed', 'target-laser'],
  ['delapouite', 'mighty-force'], ['lorc', 'armor-vest'], ['lorc', 'layered-armor'],
  ['darkzaitzev', 'acrobatic'], ['lorc', 'spiked-armor'], ['lorc', 'hammer-nails'],
  ['delapouite', 'temporary-shield'], ['zeromancer', 'heart-plus'], ['lorc', 'locked-fortress'],
  ['lorc', 'stone-block'], ['lorc', 'droplets'], ['lorc', 'knapsack'],
  ['delapouite', 'checkered-flag'], ['delapouite', 'energy-tank'], ['lorc', 'clover'],
  ['lorc', 'vintage-robot'], ['lorc', 'cog'], ['delapouite', 'graduate-cap'],
  ['delapouite', 'bolt-spell-cast'], ['sbed', 'vial'], ['lorc', 'rune-sword'],
  ['lorc', 'lightning-branches'], ['lorc', 'snowflake-1'], ['lorc', 'fragmented-meteor'],
  ['lorc', 'hourglass'], ['lorc', 'magic-shield'], ['delapouite', 'wizard-face'],

  // ── Blessings ───────────────────────────────────────
  ['lorc', 'arrowhead'], ['delapouite', 'drum'], ['delapouite', 'eye-target'],
  ['lorc', 'dripping-blade'], ['lorc', 'lob-arrow'], ['delapouite', 'receive-money'],
  ['lorc', 'shining-heart'], ['delapouite', 'well'], ['lorc', 'zig-arrow'],
  ['delapouite', 'falling-bomb'], ['lorc', 'frozen-arrow'], ['lorc', 'striking-splinter'],
  ['lorc', 'spiral-arrow'], ['lorc', 'extraction-orb'], ['lorc', 'spine-arrow'],
  ['delapouite', 'armor-punch'], ['lorc', 'star-swirl'], ['delapouite', 'roman-shield'],
  ['lorc', 'reaper-scythe'], ['lorc', 'lightning-trio'], ['lorc', 'punch-blast'],
  ['lorc', 'cracked-shield'], ['delapouite', 'gold-mine'], ['lorc', 'glass-heart'],
  ['delapouite', 'crosshair'], ['delapouite', 'rolling-dices'], ['lorc', 'crossed-bones'],
  ['lorc', 'shatter'], ['delapouite', 'armored-boomerang'], ['lorc', 'magnet'],

  // ── Tower cores ─────────────────────────────────────
  ['lorc', 'archery-target'], ['lorc', 'cannon'], ['lorc', 'snowflake-2'],
  ['lorc', 'bloody-sword'], ['lorc', 'crystal-ball'],

  // ── Equipment items ─────────────────────────────────
  ['lorc', 'pocket-bow'], ['willdabeast', 'orb-wand'], ['delapouite', 'stone-wall'],
  ['delapouite', 'metal-plate'], ['lorc', 'arrow-flights'], ['lorc', 'lantern-flame'],
  ['delapouite', 'glowing-artifact'], ['lorc', 'clockwork'], ['delapouite', 'knight-banner'],
  ['lorc', 'floating-crystal'],

  // ── Equipment slots ─────────────────────────────────
  ['carl-olsen', 'crossbow'], ['sbed', 'shield'], ['delapouite', 'quiver'],
  ['lorc', 'fire-bowl'], ['lorc', 'locked-chest'], ['lorc', 'gears'],
  ['delapouite', 'vertical-banner'], ['lorc', 'crystal-shine'],

  // ── Rarity ladder ───────────────────────────────────
  ['lorc', 'flat-star'], ['delapouite', 'round-star'], ['lorc', 'beveled-star'],
  ['lorc', 'barbed-star'], ['delapouite', 'star-formation'],

  // ── Enemy roster (threat preview, milestones) ───────
  ['delapouite', 'orc-head'], ['darkzaitzev', 'running-ninja'], ['delapouite', 'rock-golem'],
  ['delapouite', 'bat'], ['delapouite', 'healing'], ['cathelineau', 'transparent-slime'],
  ['lorc', 'surrounded-shield'], ['heavenly-dog', 'catapult'], ['delapouite', 'robber-mask'],
  ['lorc', 'teleport'], ['delapouite', 'nested-hexagons'], ['caro-asercion', 'mole'],
  ['lorc', 'crowned-skull'],

  // ── Resources and stats ─────────────────────────────
  ['delapouite', 'two-coins'], ['lorc', 'magic-swirl'], ['delapouite', 'progression'],
  ['lorc', 'brain'], ['delapouite', 'upgrade'], ['lorc', 'over-infinity'],
  ['delapouite', 'attack-gauge'], ['lorc', 'swords-emblem'], ['lorc', 'skull-crack'],
  ['delapouite', 'star-medal'],

  // ── Prestige / transcendence perks ──────────────────
  ['lorc', 'double-shot'], ['lorc', 'pentarrows-tornado'], ['lorc', 'return-arrow'],
  ['lorc', 'auto-repair'], ['delapouite', 'book-pile'], ['lorc', 'gems'],
  ['lorc', 'orbital-rays'], ['lorc', 'lightning-arc'], ['lorc', 'target-arrows'],
  ['lorc', 'explosion-rays'], ['delapouite', 'star-gate'], ['lorc', 'treasure-map'],
  ['lorc', 'crown'], ['delapouite', 'sparkles'], ['delapouite', 'level-end-flag'],

  // ── Achievements ────────────────────────────────────
  ['lorc', 'trophy'],

  // ── Wave modifiers ──────────────────────────────────
  ['lorc', 'pentagram-rose'], ['lorc', 'eclipse'],
]);

function dedupe(pairs) {
  const seen = new Map();
  for (const [author, slug] of pairs) {
    const prev = seen.get(slug);
    if (prev && prev !== author) {
      throw new Error(`icon "${slug}" pinned to two authors: ${prev} and ${author}`);
    }
    seen.set(slug, author);
  }
  return [...seen.entries()]
    .map(([slug, author]) => ({ id: slug, author, slug }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** The upstream files are `<svg><path d="M0 0h512v512H0z"/><path fill="#fff" …/></svg>`. */
const BACKGROUND_PATH = /<path\b[^>]*\bd="M0 0h512v512H0z"[^>]*\/>/g;
const WHITE_FILL = /\s+fill="(#fff|#ffffff|white)"/gi;
const VIEWBOX = /viewBox="([^"]+)"/;

function toSymbol(id, svg) {
  const viewBox = VIEWBOX.exec(svg)?.[1] ?? '0 0 512 512';
  const open = svg.indexOf('>');
  const close = svg.lastIndexOf('</svg>');
  if (open < 0 || close < 0) throw new Error(`${id}: not an <svg> document`);
  let inner = svg.slice(open + 1, close);

  const stripped = inner.replace(BACKGROUND_PATH, '');
  if (stripped === inner) {
    // Not fatal — a handful of icons ship without the black backing plate — but
    // worth knowing about, because a *changed* plate would render as a filled box.
    console.warn(`  ! ${id}: no background plate found, leaving artwork untouched`);
  }
  inner = stripped;

  // The artwork is white-on-black upstream. Dropping the explicit fill lets the
  // symbol inherit `currentColor` from the CSS, which is the whole reason these
  // icons can serve every rarity, tone and disabled state from one asset.
  inner = inner.replace(WHITE_FILL, '').replace(/\s+/g, ' ').trim();

  return `<symbol id="gi-${id}" viewBox="${viewBox}">${inner}</symbol>`;
}

async function fetchIcon({ id, author, slug }) {
  const url = `${RAW_BASE}/${author}/${slug}.svg`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${id}: ${res.status} ${res.statusText} for ${url}`);
  return toSymbol(id, await res.text());
}

function attributionMarkdown(entries) {
  const byAuthor = new Map();
  for (const e of entries) {
    if (!byAuthor.has(e.author)) byAuthor.set(e.author, []);
    byAuthor.get(e.author).push(e);
  }
  const sections = [...byAuthor.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([author, list]) => {
      const meta = AUTHORS[author];
      const rows = list
        .map((e) => `| \`${e.id}\` | [${e.slug}](${REPO_URL}/blob/master/${e.author}/${e.slug}.svg) | ${meta.license} |`)
        .join('\n');
      return [
        `### ${meta.name} — ${list.length} icon${list.length === 1 ? '' : 's'}`,
        '',
        `Icons made by [${meta.name}](${meta.url}), licensed **${meta.license}**.`,
        '',
        '| Icon id | Source | Licence |',
        '|---|---|---|',
        rows,
      ].join('\n');
    });

  return `${[
    '# Attribution',
    '',
    '<!-- Generated by scripts/fetch-icons.mjs — do not edit by hand. -->',
    '',
    '## Icons',
    '',
    `The ${entries.length} icons in \`public/icons/sprite.svg\` come from`,
    `[game-icons.net](https://game-icons.net) (source: [${REPO_URL}](${REPO_URL})).`,
    '',
    'Icons marked **CC BY 3.0** are used under the',
    '[Creative Commons Attribution 3.0 Unported](https://creativecommons.org/licenses/by/3.0/)',
    'licence, which requires the credit given below. Icons marked **CC0** are public domain',
    'and are credited here anyway.',
    '',
    'The artwork is unmodified except for two mechanical steps applied by the fetch script:',
    'the black background plate is removed, and the explicit white fill is dropped so the',
    'path inherits `currentColor` from CSS.',
    '',
    ...sections.flatMap((s) => [s, '']),
    '## Fonts',
    '',
    'The display face is [Oswald](https://fonts.google.com/specimen/Oswald) by Vernon Adams,',
    'Kalapi Gajjar and Cyreal, licensed under the',
    '[SIL Open Font License 1.1](https://openfontlicense.org) — see `public/fonts/OFL.txt`.',
  ].join('\n')}\n`;
}

function iconsModule(entries) {
  const ids = entries.map((e) => `  '${e.id}',`).join('\n');
  const meta = entries
    .map((e) => `  '${e.id}': { author: '${AUTHORS[e.author].name}', slug: '${e.slug}', license: '${AUTHORS[e.author].license}' },`)
    .join('\n');

  return `/**
 * GENERATED by \`node scripts/fetch-icons.mjs\` — do not edit by hand.
 *
 * \`IconId\` is a closed union over the pinned manifest, so an icon a data table
 * names but nobody fetched is a \`tsc\` error rather than an empty box in a
 * panel. Add an entry to the manifest in the script and re-run it.
 *
 * The matching artwork lives in \`public/icons/sprite.svg\` as \`#gi-<id>\`;
 * \`src/ui/Icon.ts\` is the only thing that should build those references.
 */

export const ICON_IDS = [
${ids}
] as const;

export type IconId = typeof ICON_IDS[number];

/** Credit metadata, kept next to the ids so \`ATTRIBUTION.md\` can be verified in a test. */
export const ICON_CREDITS: Record<IconId, { author: string; slug: string; license: string }> = {
${meta}
};

/** The \`<symbol>\` id an \`<use>\` must point at. */
export const iconSymbolId = (id: IconId): string => \`gi-\${id}\`;
`;
}

async function main() {
  console.log(`Fetching ${MANIFEST.length} icons from ${REPO_URL} …`);
  for (const e of MANIFEST) {
    if (!AUTHORS[e.author]) throw new Error(`${e.id}: unknown author "${e.author}" — add it to AUTHORS with its licence`);
  }

  const symbols = [];
  for (const entry of MANIFEST) {
    symbols.push(await fetchIcon(entry));
    process.stdout.write('.');
  }
  process.stdout.write('\n');

  const sprite = [
    '<svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">',
    '<!-- Generated by scripts/fetch-icons.mjs from https://github.com/game-icons/icons -->',
    '<!-- Icons by Lorc, Delapouite and contributors, CC BY 3.0 / CC0. See ATTRIBUTION.md. -->',
    ...symbols,
    '</svg>',
  ].join('\n');

  await mkdir(resolve(ROOT, 'public/icons'), { recursive: true });
  await writeFile(resolve(ROOT, 'public/icons/sprite.svg'), `${sprite}\n`);
  await writeFile(resolve(ROOT, 'ATTRIBUTION.md'), attributionMarkdown(MANIFEST));
  await writeFile(resolve(ROOT, 'src/data/icons.ts'), iconsModule(MANIFEST));

  const kb = (sprite.length / 1024).toFixed(1);
  console.log(`public/icons/sprite.svg  ${MANIFEST.length} symbols, ${kb} KB`);
  console.log('ATTRIBUTION.md           regenerated');
  console.log('src/data/icons.ts        regenerated');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
