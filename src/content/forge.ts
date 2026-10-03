import type { BranchId, ForgeNodeDef } from './types';

/**
 * The Forge (§5.1, §11.4): one radial web, five branches. Rings 1–2 of
 * Might, Bulwark, Fortune and Arsenal and Engineering's first ring came in
 * P3; P4 adds ring 3, sealed until the Gatekeeper falls (a few nodes wait
 * for the Bog Mother), and Offline I. P5 adds the last four weapons, Alchemy
 * (evolutions, §4.4) and the keystones, one per branch but Engineering; the
 * last two sealed by the Bog Mother. P6 fills out Engineering (§6.2):
 * Frontier March, Tactician I–II, Autocaster, Night Watch II–III and speed ×3.
 * P7 adds rings 4–6, sealed by the Prism, Forgeheart and the Hollow King:
 * weapon slots 3–4, Evolution Insight, Night Watch IV and the late minors.
 * P8 adds a mastery at the end of each branch (§9): unlimited levels at
 * ×1.03 each, compounding (S1: the Abyss is exponential, so its sink is
 * too), every level ×1.2 the cost of the last, unsealed by its Crown
 * constellation. Q1 (S1) turned rings 4–6's percentage minors into two
 * levels of a true multiplier each, so every late purchase is a step of
 * ~10% rather than a sliver of a big sum: level 1 at three times the old
 * first level's price, level 2 at three times that.
 *
 * Only Might, Bulwark and Fortune hang from the root, so a fresh Forge shows
 * three nodes (§7.1). Arsenal hangs from Might and Engineering from Fortune:
 * the fog reveals them as the player buys their neighbours.
 *
 * Costs are starting values (§5.1: ring 1 ≈ 10–25, ring 2 ≈ ×4); the pacing
 * report (`npm run pacing`) is what tunes them.
 */

/** Where each branch points on the web, degrees clockwise from straight up. */
export const BRANCH_ANGLE: Readonly<Record<BranchId, number>> = {
  might: 0,
  arsenal: 72,
  engineering: 144,
  fortune: 216,
  bulwark: 288,
};

export const BRANCH_NAME: Readonly<Record<BranchId, string>> = {
  might: 'Might',
  arsenal: 'Arsenal',
  engineering: 'Engineering',
  fortune: 'Fortune',
  bulwark: 'Bulwark',
};

export const FORGE: readonly ForgeNodeDef[] = [
  // ── Might ──────────────────────────────────────────────────────────────
  {
    id: 'might-damage', name: 'Sharpened', icon: 'crossed-swords', text: 'Damage +15%.',
    branch: 'might', type: 'minor', ring: 1, angle: 0, links: [], maxLevel: 5, cost: 8,
    effects: [{ kind: 'stat', mod: { key: 'damage', pct: 0.15 } }],
  },
  {
    id: 'might-speed', name: 'Quick Hands', icon: 'fast-arrow', text: 'Attack speed +8%.',
    branch: 'might', type: 'minor', ring: 1, angle: -24, links: ['might-damage'], maxLevel: 5, cost: 12,
    effects: [{ kind: 'stat', mod: { key: 'attackSpeed', pct: 0.08 } }],
  },
  {
    id: 'opening-salvo', name: 'Opening Salvo', icon: 'double-shot', text: 'Your starting weapon begins at level 2.',
    branch: 'might', type: 'notable', ring: 1, angle: 24, links: ['might-damage'], maxLevel: 1, cost: 25,
    effects: [{ kind: 'behaviour', id: 'opening-salvo' }],
  },
  {
    id: 'might-crit-damage', name: 'Deep Cuts', icon: 'deadly-strike', text: 'Crit damage +25%.',
    branch: 'might', type: 'minor', ring: 2, angle: -30, links: ['might-crit'], maxLevel: 5, cost: 105,
    effects: [{ kind: 'stat', mod: { key: 'critDamage', add: 0.25 } }],
  },
  {
    id: 'might-crit', name: 'Keen Eye', icon: 'crosshair-arrow', text: 'Crit chance +3%.',
    branch: 'might', type: 'minor', ring: 2, angle: -18, links: ['might-speed'], maxLevel: 5, cost: 75,
    effects: [{ kind: 'stat', mod: { key: 'critChance', add: 0.03 } }],
  },
  {
    id: 'might-speed-2', name: 'Flurry', icon: 'supersonic-arrow', text: 'Attack speed +8%.',
    branch: 'might', type: 'minor', ring: 2, angle: -6, links: ['might-speed'], maxLevel: 5, cost: 90,
    effects: [{ kind: 'stat', mod: { key: 'attackSpeed', pct: 0.08 } }],
  },
  {
    id: 'might-damage-2', name: 'Tempered', icon: 'bloody-sword', text: 'Damage +15%.',
    branch: 'might', type: 'minor', ring: 2, angle: 6, links: ['opening-salvo'], maxLevel: 5, cost: 75,
    effects: [{ kind: 'stat', mod: { key: 'damage', pct: 0.15 } }],
  },
  {
    id: 'overkill', name: 'Overkill', icon: 'piercing-sword', text: 'Excess damage from a kill carries to the nearest enemy.',
    branch: 'might', type: 'notable', ring: 2, angle: 18, links: ['opening-salvo'], maxLevel: 1, cost: 140,
    effects: [{ kind: 'behaviour', id: 'overkill' }],
  },
  {
    id: 'might-damage-3', name: 'Honed Edge', icon: 'rune-sword', text: 'Damage +15%.',
    branch: 'might', type: 'minor', ring: 3, angle: 4, links: ['might-damage-2'], maxLevel: 5, cost: 320,
    effects: [{ kind: 'stat', mod: { key: 'damage', pct: 0.15 } }], sealed: 'gatekeeper',
  },
  {
    id: 'might-speed-3', name: 'Battle Rhythm', icon: 'pentarrows-tornado', text: 'Attack speed +8%.',
    branch: 'might', type: 'minor', ring: 3, angle: -8, links: ['might-speed-2'], maxLevel: 5, cost: 360,
    effects: [{ kind: 'stat', mod: { key: 'attackSpeed', pct: 0.08 } }], sealed: 'gatekeeper',
  },
  {
    id: 'might-crit-3', name: 'Dead Eye', icon: 'dead-eye', text: 'Crit chance +3%.',
    branch: 'might', type: 'minor', ring: 3, angle: -20, links: ['might-crit'], maxLevel: 5, cost: 340,
    effects: [{ kind: 'stat', mod: { key: 'critChance', add: 0.03 } }], sealed: 'gatekeeper',
  },
  {
    id: 'executioner', name: 'Executioner', icon: 'executioner-hood', text: 'Enemies under 10% HP die when hit.',
    branch: 'might', type: 'notable', ring: 2, angle: 30, links: ['overkill'], maxLevel: 1, cost: 220,
    effects: [{ kind: 'behaviour', id: 'executioner' }],
  },
  {
    id: 'glass-cannon', name: 'Glass Cannon', icon: 'cannon', text: 'Damage ×1.8, but Max HP and regen are halved.',
    branch: 'might', type: 'keystone', ring: 3, angle: 24, links: ['executioner'], maxLevel: 1, cost: 1500,
    effects: [
      { kind: 'stat', mod: { key: 'damage', mult: 1.8 } },
      { kind: 'stat', mod: { key: 'maxHp', mult: 0.5 } },
      { kind: 'stat', mod: { key: 'regen', mult: 0.5 } },
    ],
    sealed: 'bog-mother',
  },

  {
    id: 'might-damage-4', name: "Bright Steel", icon: 'rune-sword', text: "Damage ×1.1.",
    branch: 'might', type: 'minor', ring: 4, angle: 4, links: ['might-damage-3'], maxLevel: 2, cost: 15600, growth: 3,
    effects: [{ kind: 'stat', mod: { key: 'damage', mult: 1.1 } }],
  },
  {
    id: 'might-speed-4', name: "Whirlwind", icon: 'pentarrows-tornado', text: "Attack speed ×1.08.",
    branch: 'might', type: 'minor', ring: 4, angle: -8, links: ['might-speed-3'], maxLevel: 2, cost: 16800, growth: 3,
    effects: [{ kind: 'stat', mod: { key: 'attackSpeed', mult: 1.08 } }], sealed: 'prism',
  },
  {
    id: 'might-crit-damage-4', name: "Cleave", icon: 'deadly-strike', text: "Crit damage +25%.",
    branch: 'might', type: 'minor', ring: 4, angle: -20, links: ['might-crit-3'], maxLevel: 5, cost: 5200,
    effects: [{ kind: 'stat', mod: { key: 'critDamage', add: 0.25 } }], sealed: 'prism',
  },
  {
    id: 'might-range-4', name: "Far Sight", icon: 'arrow-scope', text: "Range +5%.",
    branch: 'might', type: 'minor', ring: 4, angle: -30, links: ['might-crit-damage-4'], maxLevel: 5, cost: 4800,
    effects: [{ kind: 'stat', mod: { key: 'range', pct: 0.05 } }], sealed: 'prism',
  },
  {
    id: 'ricochet', name: "Ricochet", icon: 'return-arrow', text: "Every shot pierces one more enemy.",
    branch: 'might', type: 'notable', ring: 4, angle: 16, links: ['might-damage-4'], maxLevel: 1, cost: 6000,
    effects: [{ kind: 'stat', mod: { key: 'pierce', add: 1 } }],
  },
  {
    id: 'might-damage-5', name: "Sunforged", icon: 'bloody-sword', text: "Damage ×1.1.",
    branch: 'might', type: 'minor', ring: 5, angle: 4, links: ['might-damage-4'], maxLevel: 2, cost: 120000, growth: 3,
    effects: [{ kind: 'stat', mod: { key: 'damage', mult: 1.1 } }], sealed: 'forgeheart',
  },
  {
    id: 'might-speed-5', name: "Storm of Blows", icon: 'fast-arrow', text: "Attack speed ×1.08.",
    branch: 'might', type: 'minor', ring: 5, angle: -8, links: ['might-speed-4'], maxLevel: 2, cost: 132000, growth: 3,
    effects: [{ kind: 'stat', mod: { key: 'attackSpeed', mult: 1.08 } }], sealed: 'forgeheart',
  },
  {
    id: 'might-crit-5', name: "Killing Eye", icon: 'dead-eye', text: "Crit chance +3%.",
    branch: 'might', type: 'minor', ring: 5, angle: -20, links: ['might-crit-damage-4'], maxLevel: 5, cost: 41600,
    effects: [{ kind: 'stat', mod: { key: 'critChance', add: 0.03 } }], sealed: 'forgeheart',
  },
  {
    id: 'might-range-5', name: "Eagle Sight", icon: 'arrow-scope', text: "Range +5%.",
    branch: 'might', type: 'minor', ring: 5, angle: -30, links: ['might-range-4'], maxLevel: 5, cost: 40000,
    effects: [{ kind: 'stat', mod: { key: 'range', pct: 0.05 } }], sealed: 'forgeheart',
  },
  {
    id: 'overcharge', name: "Overcharge", icon: 'bolt-spell-cast', text: "Damage +40%, but attack speed \u221210%.",
    branch: 'might', type: 'notable', ring: 5, angle: 18, links: ['might-damage-5'], maxLevel: 1, cost: 120000,
    effects: [{ kind: 'stat', mod: { key: 'damage', pct: 0.4 } }, { kind: 'stat', mod: { key: 'attackSpeed', pct: -0.1 } }], sealed: 'forgeheart',
  },
  {
    id: 'might-damage-6', name: "Lightbringer", icon: 'swords-emblem', text: "Damage ×1.1.",
    branch: 'might', type: 'minor', ring: 6, angle: 4, links: ['might-damage-5'], maxLevel: 2, cost: 729000, growth: 3,
    effects: [{ kind: 'stat', mod: { key: 'damage', mult: 1.1 } }], sealed: 'hollow-king',
  },
  {
    id: 'might-speed-6', name: "Tempest Hands", icon: 'supersonic-arrow', text: "Attack speed ×1.08.",
    branch: 'might', type: 'minor', ring: 6, angle: -8, links: ['might-speed-5'], maxLevel: 2, cost: 769500, growth: 3,
    effects: [{ kind: 'stat', mod: { key: 'attackSpeed', mult: 1.08 } }], sealed: 'hollow-king',
  },
  {
    id: 'might-crit-6', name: "Ruin", icon: 'crosshair', text: "Crit damage +25%.",
    branch: 'might', type: 'minor', ring: 6, angle: -20, links: ['might-crit-5'], maxLevel: 5, cost: 243000,
    effects: [{ kind: 'stat', mod: { key: 'critDamage', add: 0.25 } }], sealed: 'hollow-king',
  },
  {
    id: 'annihilator', name: "Annihilator", icon: 'guillotine', text: "Enemies under 10% HP die when hit; with Executioner or the Coin, under 20%.",
    branch: 'might', type: 'notable', ring: 6, angle: 20, links: ['overcharge'], maxLevel: 1, cost: 675000,
    effects: [{ kind: 'behaviour', id: 'executioner' }], sealed: 'hollow-king',
  },
  // ── Arsenal ────────────────────────────────────────────────────────────
  {
    id: 'scattershot', name: 'Scattershot', icon: 'striking-arrows', text: 'Scattershot joins the draft, and +1 weapon slot.',
    branch: 'arsenal', type: 'notable', ring: 1, angle: 58, links: ['might-damage'], maxLevel: 1, cost: 20,
    effects: [{ kind: 'unlockCard', id: 'scattershot' }, { kind: 'slot', slot: 'weapon', n: 1 }],
  },
  {
    id: 'chain-lightning', name: 'Chain Lightning', icon: 'chain-lightning', text: 'Chain Lightning joins the draft.',
    branch: 'arsenal', type: 'notable', ring: 1, angle: 84, links: ['scattershot'], maxLevel: 1, cost: 30,
    effects: [{ kind: 'unlockCard', id: 'chain-lightning' }],
  },
  {
    id: 'passive-slot', name: 'Second Focus', icon: 'upgrade', text: '+1 passive slot.',
    branch: 'arsenal', type: 'notable', ring: 2, angle: 70, links: ['scattershot', 'chain-lightning'], maxLevel: 1, cost: 205,
    effects: [{ kind: 'slot', slot: 'passive', n: 1 }],
  },
  {
    id: 'frost-ring', name: 'Frost Ring', icon: 'frozen-orb', text: 'Frost Ring joins the draft.',
    branch: 'arsenal', type: 'notable', ring: 2, angle: 88, links: ['chain-lightning'], maxLevel: 1, cost: 180,
    effects: [{ kind: 'unlockCard', id: 'frost-ring' }],
  },
  {
    id: 'twin-mount', name: 'Twin Mount', icon: 'double-shot', text: "Start runs with a second, random weapon, never one the region's first enemies shrug off.",
    branch: 'arsenal', type: 'notable', ring: 3, angle: 82, links: ['frost-ring', 'passive-slot'], maxLevel: 1, cost: 380,
    effects: [{ kind: 'behaviour', id: 'twin-mount' }], sealed: 'gatekeeper',
  },
  {
    id: 'passive-slot-2', name: 'Third Focus', icon: 'nested-hexagons', text: '+1 passive slot.',
    branch: 'arsenal', type: 'notable', ring: 3, angle: 62, links: ['passive-slot'], maxLevel: 1, cost: 1400,
    effects: [{ kind: 'slot', slot: 'passive', n: 1 }], sealed: 'bog-mother',
  },
  {
    id: 'mortar', name: 'Mortar', icon: 'mortar', text: 'Mortar joins the draft.',
    branch: 'arsenal', type: 'notable', ring: 2, angle: 100, links: ['frost-ring'], maxLevel: 1, cost: 240,
    effects: [{ kind: 'unlockCard', id: 'mortar' }], sealed: 'gatekeeper',
  },
  {
    id: 'sunlance', name: 'Sunlance', icon: 'sunbeams', text: 'Sunlance joins the draft.',
    branch: 'arsenal', type: 'notable', ring: 3, angle: 94, links: ['mortar'], maxLevel: 1, cost: 560,
    effects: [{ kind: 'unlockCard', id: 'sunlance' }], sealed: 'gatekeeper',
  },
  {
    id: 'glaives', name: 'Glaives', icon: 'spinning-blades', text: 'Glaives join the draft.',
    branch: 'arsenal', type: 'notable', ring: 3, angle: 106, links: ['mortar'], maxLevel: 1, cost: 620,
    effects: [{ kind: 'unlockCard', id: 'glaives' }], sealed: 'gatekeeper',
  },
  {
    id: 'sentinel-drones', name: 'Sentinel Drones', icon: 'delivery-drone', text: 'Sentinel Drones join the draft.',
    branch: 'arsenal', type: 'notable', ring: 3, angle: 116, links: ['glaives'], maxLevel: 1, cost: 1200,
    effects: [{ kind: 'unlockCard', id: 'sentinel-drones' }], sealed: 'bog-mother',
  },
  {
    id: 'alchemy', name: 'Alchemy', icon: 'bubbling-flask', text: 'Weapons at level 5 evolve when you own their partner passive.',
    branch: 'arsenal', type: 'notable', ring: 3, angle: 72, links: ['passive-slot'], maxLevel: 1, cost: 2000,
    effects: [{ kind: 'behaviour', id: 'alchemy' }], sealed: 'bog-mother',
  },
  {
    id: 'specialist', name: 'Specialist', icon: 'bullseye', text: 'One weapon, your first pick, at ×3 damage; it evolves at level 3.',
    branch: 'arsenal', type: 'keystone', ring: 3, angle: 52, links: ['passive-slot'], maxLevel: 1, cost: 1500,
    effects: [{ kind: 'behaviour', id: 'specialist' }, { kind: 'stat', mod: { key: 'damage', mult: 3 } }],
    sealed: 'bog-mother',
  },

  {
    id: 'weapon-slot-3', name: "Third Mount", icon: 'upgrade', text: "+1 weapon slot.",
    branch: 'arsenal', type: 'notable', ring: 4, angle: 88, links: ['twin-mount'], maxLevel: 1, cost: 7500,
    effects: [{ kind: 'slot', slot: 'weapon', n: 1 }], sealed: 'prism',
  },
  {
    id: 'evolution-insight', name: "Evolution Insight", icon: 'book-pile', text: "Every recipe's weapon half shows in the Recipe Book.",
    branch: 'arsenal', type: 'notable', ring: 4, angle: 72, links: ['alchemy'], maxLevel: 1, cost: 3000,
    effects: [{ kind: 'automation', id: 'insight' }],
  },
  {
    id: 'veteran-arms', name: "Seasoned Arms", icon: 'double-shot', text: "Your starting weapon begins one more level up.",
    branch: 'arsenal', type: 'notable', ring: 4, angle: 60, links: ['passive-slot-2'], maxLevel: 1, cost: 6500,
    effects: [{ kind: 'behaviour', id: 'opening-salvo' }], sealed: 'prism',
  },
  {
    id: 'arsenal-area', name: "Wide Arcs", icon: 'bright-explosion', text: "Area +10%.",
    branch: 'arsenal', type: 'minor', ring: 4, angle: 100, links: ['sunlance'], maxLevel: 5, cost: 5200,
    effects: [{ kind: 'stat', mod: { key: 'area', pct: 0.1 } }], sealed: 'prism',
  },
  {
    id: 'arsenal-duration', name: "Lingering", icon: 'extra-time', text: "Slows, burns and stuns last 10% longer.",
    branch: 'arsenal', type: 'minor', ring: 4, angle: 112, links: ['glaives'], maxLevel: 5, cost: 5200,
    effects: [{ kind: 'stat', mod: { key: 'duration', pct: 0.1 } }], sealed: 'prism',
  },
  {
    id: 'drilled', name: "Drilled", icon: 'progression', text: "New weapons join at level 2.",
    branch: 'arsenal', type: 'notable', ring: 5, angle: 90, links: ['weapon-slot-3'], maxLevel: 1, cost: 128000,
    effects: [{ kind: 'behaviour', id: 'drilled' }], sealed: 'forgeheart',
  },
  {
    id: 'arsenal-range', name: "Long Barrels", icon: 'target-laser', text: "Range +5%.",
    branch: 'arsenal', type: 'minor', ring: 5, angle: 78, links: ['weapon-slot-3'], maxLevel: 5, cost: 40000,
    effects: [{ kind: 'stat', mod: { key: 'range', pct: 0.05 } }], sealed: 'forgeheart',
  },
  {
    id: 'arsenal-area-2', name: "Vast Arcs", icon: 'spiky-explosion', text: "Area +10%.",
    branch: 'arsenal', type: 'minor', ring: 5, angle: 102, links: ['arsenal-area'], maxLevel: 5, cost: 44000,
    effects: [{ kind: 'stat', mod: { key: 'area', pct: 0.1 } }], sealed: 'forgeheart',
  },
  {
    id: 'arsenal-duration-2', name: "Enduring", icon: 'hourglass', text: "Slows, burns and stuns last 10% longer.",
    branch: 'arsenal', type: 'minor', ring: 5, angle: 114, links: ['arsenal-duration'], maxLevel: 5, cost: 44000,
    effects: [{ kind: 'stat', mod: { key: 'duration', pct: 0.1 } }], sealed: 'forgeheart',
  },
  {
    id: 'weapon-slot-4', name: "Fourth Mount", icon: 'nested-hexagons', text: "+1 weapon slot.",
    branch: 'arsenal', type: 'notable', ring: 6, angle: 90, links: ['drilled'], maxLevel: 1, cost: 810000,
    effects: [{ kind: 'slot', slot: 'weapon', n: 1 }], sealed: 'hollow-king',
  },
  {
    id: 'arsenal-range-2', name: "Siege Sights", icon: 'target-arrows', text: "Range +5%.",
    branch: 'arsenal', type: 'minor', ring: 6, angle: 78, links: ['arsenal-range'], maxLevel: 5, cost: 270000,
    effects: [{ kind: 'stat', mod: { key: 'range', pct: 0.05 } }], sealed: 'hollow-king',
  },
  {
    id: 'arsenal-area-3', name: "Cataclysm", icon: 'explosion-rays', text: "Area +10%.",
    branch: 'arsenal', type: 'minor', ring: 6, angle: 102, links: ['arsenal-area-2'], maxLevel: 5, cost: 270000,
    effects: [{ kind: 'stat', mod: { key: 'area', pct: 0.1 } }], sealed: 'hollow-king',
  },
  {
    id: 'arsenal-duration-3', name: "Eternity", icon: 'over-infinity', text: "Slows, burns and stuns last 10% longer.",
    branch: 'arsenal', type: 'minor', ring: 6, angle: 114, links: ['arsenal-duration-2'], maxLevel: 5, cost: 270000,
    effects: [{ kind: 'stat', mod: { key: 'duration', pct: 0.1 } }], sealed: 'hollow-king',
  },
  // ── Engineering ────────────────────────────────────────────────────────
  {
    id: 'speed-2', name: 'Overdrive', icon: 'fast-forward-button', text: 'Unlocks game speed ×2.',
    branch: 'engineering', type: 'notable', ring: 1, angle: 160, links: ['fortune-xp'], maxLevel: 1, cost: 30,
    effects: [{ kind: 'automation', id: 'speed-2' }],
  },
  {
    id: 'auto-restart', name: 'Auto-restart', icon: 'clockwork', text: 'The next run starts 5 s after the results.',
    branch: 'engineering', type: 'notable', ring: 1, angle: 136, links: ['speed-2'], maxLevel: 1, cost: 45,
    effects: [{ kind: 'automation', id: 'auto-restart' }],
  },
  {
    id: 'offline', name: 'Night Watch', icon: 'eclipse', text: 'Earn shards while away: 25% of your farm rate, up to 2 h.',
    branch: 'engineering', type: 'notable', ring: 2, angle: 132, links: ['auto-restart'], maxLevel: 1, cost: 150,
    effects: [{ kind: 'automation', id: 'offline' }], sealed: 'gatekeeper',
  },
  {
    id: 'frontier-march', name: 'Frontier March', icon: 'knight-banner', text: 'After a boss first falls, auto-restart marches to the next region.',
    branch: 'engineering', type: 'notable', ring: 2, angle: 164, links: ['speed-2'], maxLevel: 1, cost: 160,
    effects: [{ kind: 'automation', id: 'frontier-march' }],
  },
  {
    id: 'tactician', name: 'Tactician', icon: 'gears', text: 'The suggested card follows a priority list you write.',
    branch: 'engineering', type: 'notable', ring: 2, angle: 118, links: ['offline'], maxLevel: 1, cost: 200,
    effects: [{ kind: 'automation', id: 'tactician' }], sealed: 'gatekeeper',
  },
  {
    id: 'auto-ult', name: 'Autocaster', icon: 'auto-repair', text: 'The ultimate casts itself into a crowd, or at a boss.',
    branch: 'engineering', type: 'notable', ring: 3, angle: 152, links: ['ult-charge'], maxLevel: 1, cost: 420,
    effects: [{ kind: 'automation', id: 'auto-ult' }], sealed: 'gatekeeper',
  },
  {
    id: 'offline-2', name: 'Night Watch II', icon: 'lantern-flame', text: 'Offline earns 40% of your farm rate, up to 4 h.',
    branch: 'engineering', type: 'notable', ring: 3, angle: 140, links: ['offline'], maxLevel: 1, cost: 480,
    effects: [{ kind: 'automation', id: 'offline-2' }], sealed: 'gatekeeper',
  },
  {
    id: 'tactician-2', name: 'Tactician II', icon: 'vintage-robot', text: 'Each frame keeps its own priority list.',
    branch: 'engineering', type: 'notable', ring: 3, angle: 128, links: ['tactician'], maxLevel: 1, cost: 900,
    effects: [{ kind: 'automation', id: 'tactician-2' }], sealed: 'bog-mother',
  },
  {
    id: 'offline-3', name: 'Night Watch III', icon: 'crystal-ball', text: 'Offline earns 60% of your farm rate, up to 8 h.',
    branch: 'engineering', type: 'notable', ring: 3, angle: 176, links: ['speed-3'], maxLevel: 1, cost: 1600,
    effects: [{ kind: 'automation', id: 'offline-3' }], sealed: 'bog-mother',
  },
  {
    id: 'speed-3', name: 'Full Throttle', icon: 'hourglass', text: 'Unlocks game speed ×3.',
    branch: 'engineering', type: 'notable', ring: 3, angle: 164, links: ['frontier-march', 'auto-ult'], maxLevel: 1, cost: 2400,
    effects: [{ kind: 'automation', id: 'speed-3' }], sealed: 'bog-mother',
  },
  {
    id: 'foreman', name: 'Foreman', icon: 'shop', text: 'Pin up to 5 nodes: the Forge buys them as shards arrive.',
    branch: 'engineering', type: 'notable', ring: 4, angle: 126, links: ['tactician-2'], maxLevel: 1, cost: 4000,
    effects: [{ kind: 'automation', id: 'foreman' }], sealed: 'bog-mother',
  },
  {
    id: 'ult-charge', name: 'Capacitor', icon: 'energy-tank', text: 'Ultimate charges 15% faster.',
    branch: 'engineering', type: 'minor', ring: 2, angle: 148, links: ['auto-restart', 'speed-2'], maxLevel: 3, cost: 120,
    effects: [{ kind: 'stat', mod: { key: 'ultCharge', pct: 0.15 } }],
  },

  {
    id: 'ult-charge-2', name: "Capacitor II", icon: 'energy-tank', text: "Ultimate charge ×1.12.",
    branch: 'engineering', type: 'minor', ring: 4, angle: 150, links: ['auto-ult'], maxLevel: 2, cost: 18000, growth: 3,
    effects: [{ kind: 'stat', mod: { key: 'ultCharge', mult: 1.12 } }], sealed: 'prism',
  },
  {
    id: 'charged-start', name: "Primed", icon: 'concentration-orb', text: "Your ultimate starts every run fully charged.",
    branch: 'engineering', type: 'notable', ring: 4, angle: 162, links: ['speed-3'], maxLevel: 1, cost: 6000,
    effects: [{ kind: 'behaviour', id: 'charged-start' }], sealed: 'prism',
  },
  {
    id: 'offline-4', name: "Night Watch IV", icon: 'star-gate', text: "Offline earns 75% of your farm rate, up to 12 h.",
    branch: 'engineering', type: 'notable', ring: 4, angle: 176, links: ['offline-3'], maxLevel: 1, cost: 36000,
    effects: [{ kind: 'automation', id: 'offline-4' }], sealed: 'forgeheart',
  },
  {
    id: 'ult-charge-3', name: "Capacitor III", icon: 'energy-tank', text: "Ultimate charge ×1.12.",
    branch: 'engineering', type: 'minor', ring: 5, angle: 150, links: ['ult-charge-2'], maxLevel: 2, cost: 144000, growth: 3,
    effects: [{ kind: 'stat', mod: { key: 'ultCharge', mult: 1.12 } }], sealed: 'forgeheart',
  },
  {
    id: 'eng-xp', name: "Recorder", icon: 'graduate-cap', text: "XP ×1.07.",
    branch: 'engineering', type: 'minor', ring: 5, angle: 164, links: ['charged-start'], maxLevel: 2, cost: 120000, growth: 3,
    effects: [{ kind: 'stat', mod: { key: 'xpGain', mult: 1.07 } }], sealed: 'forgeheart',
  },
  {
    id: 'refinery', name: "Refinery", icon: 'gold-bar', text: "Shards ×1.07.",
    branch: 'engineering', type: 'minor', ring: 5, angle: 136, links: ['ult-charge-3'], maxLevel: 2, cost: 132000, growth: 3,
    effects: [{ kind: 'stat', mod: { key: 'shardGain', mult: 1.07 } }], sealed: 'forgeheart',
  },
  {
    id: 'ult-charge-4', name: "Capacitor IV", icon: 'energy-tank', text: "Ultimate charge ×1.12.",
    branch: 'engineering', type: 'minor', ring: 6, angle: 150, links: ['ult-charge-3'], maxLevel: 2, cost: 891000, growth: 3,
    effects: [{ kind: 'stat', mod: { key: 'ultCharge', mult: 1.12 } }], sealed: 'hollow-king',
  },
  {
    id: 'eng-xp-2', name: "Archivist", icon: 'wisdom', text: "XP ×1.07.",
    branch: 'engineering', type: 'minor', ring: 6, angle: 164, links: ['eng-xp'], maxLevel: 2, cost: 729000, growth: 3,
    effects: [{ kind: 'stat', mod: { key: 'xpGain', mult: 1.07 } }], sealed: 'hollow-king',
  },
  {
    id: 'refinery-2', name: "Refinery II", icon: 'gold-bar', text: "Shards ×1.07.",
    branch: 'engineering', type: 'minor', ring: 6, angle: 136, links: ['refinery'], maxLevel: 2, cost: 810000, growth: 3,
    effects: [{ kind: 'stat', mod: { key: 'shardGain', mult: 1.07 } }], sealed: 'hollow-king',
  },
  // ── Fortune ────────────────────────────────────────────────────────────
  {
    id: 'fortune-shards', name: 'Prospector', icon: 'gems', text: 'Shards +10%.',
    branch: 'fortune', type: 'minor', ring: 1, angle: 216, links: [], maxLevel: 5, cost: 10,
    effects: [{ kind: 'stat', mod: { key: 'shardGain', pct: 0.1 } }],
  },
  {
    id: 'fortune-xp', name: 'Studious', icon: 'book-pile', text: 'XP +10%.',
    branch: 'fortune', type: 'minor', ring: 1, angle: 192, links: ['fortune-shards'], maxLevel: 5, cost: 12,
    effects: [{ kind: 'stat', mod: { key: 'xpGain', pct: 0.1 } }],
  },
  {
    id: 'head-start', name: 'Head Start', icon: 'progression', text: 'Start runs at level 3.',
    branch: 'fortune', type: 'notable', ring: 2, angle: 186, links: ['fortune-xp'], maxLevel: 1, cost: 100,
    effects: [{ kind: 'behaviour', id: 'head-start' }],
  },
  {
    id: 'fortune-xp-2', name: 'Quick Study', icon: 'brain', text: 'XP +10%.',
    branch: 'fortune', type: 'minor', ring: 2, angle: 198, links: ['fortune-xp'], maxLevel: 5, cost: 75,
    effects: [{ kind: 'stat', mod: { key: 'xpGain', pct: 0.1 } }],
  },
  {
    id: 'fortune-shards-2', name: 'Deep Veins', icon: 'gold-nuggets', text: 'Shards +10%.',
    branch: 'fortune', type: 'minor', ring: 2, angle: 210, links: ['fortune-shards'], maxLevel: 5, cost: 70,
    effects: [{ kind: 'stat', mod: { key: 'shardGain', pct: 0.1 } }],
  },
  {
    id: 'reroll', name: 'Reroll', icon: 'rolling-dices', text: '+1 draft reroll per run.',
    branch: 'fortune', type: 'notable', ring: 2, angle: 222, links: ['fortune-shards'], maxLevel: 3, cost: 65,
    effects: [{ kind: 'behaviour', id: 'reroll' }],
  },
  {
    id: 'fortune-shards-3', name: 'Mother Lode', icon: 'gold-mine', text: 'Shards +10%.',
    branch: 'fortune', type: 'minor', ring: 3, angle: 210, links: ['fortune-shards-2'], maxLevel: 5, cost: 300,
    effects: [{ kind: 'stat', mod: { key: 'shardGain', pct: 0.1 } }], sealed: 'gatekeeper',
  },
  {
    id: 'fortune-xp-3', name: 'Lorekeeper', icon: 'wisdom', text: 'XP +10%.',
    branch: 'fortune', type: 'minor', ring: 3, angle: 196, links: ['fortune-xp-2'], maxLevel: 5, cost: 300,
    effects: [{ kind: 'stat', mod: { key: 'xpGain', pct: 0.1 } }], sealed: 'gatekeeper',
  },
  {
    id: 'bounty', name: 'Bounty', icon: 'wanted-reward', text: 'Elites drop ×3 shards.',
    branch: 'fortune', type: 'notable', ring: 3, angle: 224, links: ['fortune-shards-3', 'reroll'], maxLevel: 1, cost: 520,
    effects: [{ kind: 'behaviour', id: 'bounty' }], sealed: 'gatekeeper',
  },
  {
    id: 'choice', name: 'Choice', icon: 'nested-hexagons', text: '+1 card in every draft.',
    branch: 'fortune', type: 'notable', ring: 2, angle: 234, links: ['reroll'], maxLevel: 1, cost: 305,
    effects: [{ kind: 'behaviour', id: 'extra-choice' }],
  },
  {
    id: 'banish', name: 'Banish', icon: 'punch-blast', text: "+1 Banish per run: strike a new card from this run's draft.",
    branch: 'fortune', type: 'notable', ring: 2, angle: 246, links: ['choice'], maxLevel: 3, cost: 120,
    effects: [{ kind: 'behaviour', id: 'banish' }],
  },
  {
    id: 'hoarder', name: 'Hoarder', icon: 'money-stack', text: 'Shards ×2, but every enemy has ×1.5 health.',
    branch: 'fortune', type: 'keystone', ring: 3, angle: 238, links: ['choice'], maxLevel: 1, cost: 1500,
    effects: [{ kind: 'stat', mod: { key: 'shardGain', mult: 2 } }, { kind: 'behaviour', id: 'hoarder' }],
    sealed: 'bog-mother',
  },

  {
    id: 'fortune-shards-4', name: "Seam", icon: 'gems', text: "Shards ×1.07.",
    branch: 'fortune', type: 'minor', ring: 4, angle: 210, links: ['fortune-shards-3'], maxLevel: 2, cost: 14400, growth: 3,
    effects: [{ kind: 'stat', mod: { key: 'shardGain', mult: 1.07 } }], sealed: 'prism',
  },
  {
    id: 'fortune-xp-4', name: "Sage", icon: 'brain', text: "XP ×1.07.",
    branch: 'fortune', type: 'minor', ring: 4, angle: 196, links: ['fortune-xp-3'], maxLevel: 2, cost: 14400, growth: 3,
    effects: [{ kind: 'stat', mod: { key: 'xpGain', mult: 1.07 } }], sealed: 'prism',
  },
  {
    id: 'reroll-2', name: "Second Thoughts", icon: 'rolling-dices', text: "+1 draft reroll per run.",
    branch: 'fortune', type: 'notable', ring: 4, angle: 222, links: ['bounty'], maxLevel: 3, cost: 2000,
    effects: [{ kind: 'behaviour', id: 'reroll' }],
  },
  {
    id: 'foresight', name: "Foresight", icon: 'all-seeing-eye', text: "+1 card in every draft.",
    branch: 'fortune', type: 'notable', ring: 4, angle: 234, links: ['bounty'], maxLevel: 1, cost: 8000,
    effects: [{ kind: 'behaviour', id: 'extra-choice' }], sealed: 'prism',
  },
  {
    id: 'banish-2', name: 'Clean Slate', icon: 'punch-blast', text: '+1 Banish per run.',
    branch: 'fortune', type: 'notable', ring: 4, angle: 246, links: ['foresight'], maxLevel: 2, cost: 9000,
    effects: [{ kind: 'behaviour', id: 'banish' }], sealed: 'prism',
  },
  {
    id: 'fortune-shards-5', name: "Glittering Deep", icon: 'gold-nuggets', text: "Shards ×1.07.",
    branch: 'fortune', type: 'minor', ring: 5, angle: 210, links: ['fortune-shards-4'], maxLevel: 2, cost: 120000, growth: 3,
    effects: [{ kind: 'stat', mod: { key: 'shardGain', mult: 1.07 } }], sealed: 'forgeheart',
  },
  {
    id: 'fortune-xp-5', name: "Loremaster", icon: 'book-pile', text: "XP ×1.07.",
    branch: 'fortune', type: 'minor', ring: 5, angle: 196, links: ['fortune-xp-4'], maxLevel: 2, cost: 120000, growth: 3,
    effects: [{ kind: 'stat', mod: { key: 'xpGain', mult: 1.07 } }], sealed: 'forgeheart',
  },
  {
    id: 'veteran', name: "Veteran", icon: 'graduate-cap', text: "Start runs two levels higher.",
    branch: 'fortune', type: 'notable', ring: 5, angle: 186, links: ['fortune-xp-5'], maxLevel: 1, cost: 128000,
    effects: [{ kind: 'behaviour', id: 'head-start' }], sealed: 'forgeheart',
  },
  {
    id: 'treasure-hunter', name: "Treasure Hunter", icon: 'treasure-map', text: "Elites drop relics twice as often.",
    branch: 'fortune', type: 'notable', ring: 5, angle: 224, links: ['fortune-shards-5'], maxLevel: 1, cost: 96000,
    effects: [{ kind: 'behaviour', id: 'relic-luck' }], sealed: 'forgeheart',
  },
  {
    id: 'fortune-shards-6', name: "Starfall Vein", icon: 'gold-mine', text: "Shards ×1.07.",
    branch: 'fortune', type: 'minor', ring: 6, angle: 210, links: ['fortune-shards-5'], maxLevel: 2, cost: 729000, growth: 3,
    effects: [{ kind: 'stat', mod: { key: 'shardGain', mult: 1.07 } }], sealed: 'hollow-king',
  },
  {
    id: 'fortune-xp-6', name: "Omniscience", icon: 'wisdom', text: "XP ×1.07.",
    branch: 'fortune', type: 'minor', ring: 6, angle: 196, links: ['fortune-xp-5'], maxLevel: 2, cost: 729000, growth: 3,
    effects: [{ kind: 'stat', mod: { key: 'xpGain', mult: 1.07 } }], sealed: 'hollow-king',
  },
  {
    id: 'jackpot', name: "Jackpot", icon: 'coinflip', text: "+1 card in every draft.",
    branch: 'fortune', type: 'notable', ring: 6, angle: 230, links: ['treasure-hunter'], maxLevel: 1, cost: 1080000,
    effects: [{ kind: 'behaviour', id: 'extra-choice' }], sealed: 'hollow-king',
  },
  // ── Bulwark ────────────────────────────────────────────────────────────
  {
    id: 'bulwark-hp', name: 'Stoneworks', icon: 'health-increase', text: 'Max HP +20%.',
    branch: 'bulwark', type: 'minor', ring: 1, angle: 288, links: [], maxLevel: 5, cost: 8,
    effects: [{ kind: 'stat', mod: { key: 'maxHp', pct: 0.2 } }],
  },
  {
    id: 'bulwark-regen', name: 'Mortar and Lime', icon: 'heart-drop', text: 'Regenerate +0.5% of Max HP per second.',
    branch: 'bulwark', type: 'minor', ring: 1, angle: 264, links: ['bulwark-hp'], maxLevel: 5, cost: 12,
    effects: [{ kind: 'stat', mod: { key: 'regen', add: 0.005 } }],
  },
  {
    id: 'bulwark-armor', name: 'Iron Bands', icon: 'armor-vest', text: 'Armour +1: every hit on the tower is 1 weaker.',
    branch: 'bulwark', type: 'minor', ring: 1, angle: 312, links: ['bulwark-hp'], maxLevel: 5, cost: 15,
    effects: [{ kind: 'stat', mod: { key: 'armor', add: 1 } }],
  },
  {
    id: 'last-stand', name: 'Last Stand', icon: 'enrage', text: '+40% attack speed below 30% HP.',
    branch: 'bulwark', type: 'notable', ring: 2, angle: 258, links: ['thorns'], maxLevel: 1, cost: 120,
    effects: [{ kind: 'behaviour', id: 'last-stand' }],
  },
  {
    id: 'thorns', name: 'Thorns', icon: 'spiked-armor', text: 'Enemies that hit the tower take 50% of it back.',
    branch: 'bulwark', type: 'notable', ring: 2, angle: 270, links: ['bulwark-regen'], maxLevel: 1, cost: 75,
    effects: [{ kind: 'behaviour', id: 'thorns' }],
  },
  {
    id: 'fortress', name: 'Fortress', icon: 'castle', text: 'Attack speed −30%, Max HP ×2, and Thorns bite three times as hard.',
    branch: 'bulwark', type: 'keystone', ring: 3, angle: 266, links: ['thorns'], maxLevel: 1, cost: 1500,
    effects: [
      { kind: 'stat', mod: { key: 'attackSpeed', mult: 0.7 } },
      { kind: 'stat', mod: { key: 'maxHp', mult: 2 } },
      { kind: 'behaviour', id: 'fortress' },
    ],
    sealed: 'bog-mother',
  },
  {
    id: 'bulwark-regen-2', name: 'Living Stone', icon: 'life-tap', text: 'Regenerate +0.5% of Max HP per second.',
    branch: 'bulwark', type: 'minor', ring: 2, angle: 282, links: ['bulwark-regen'], maxLevel: 5, cost: 80,
    effects: [{ kind: 'stat', mod: { key: 'regen', add: 0.005 } }],
  },
  {
    id: 'bulwark-hp-2', name: 'Bastion Walls', icon: 'shining-heart', text: 'Max HP +20%.',
    branch: 'bulwark', type: 'minor', ring: 2, angle: 294, links: ['bulwark-hp'], maxLevel: 5, cost: 70,
    effects: [{ kind: 'stat', mod: { key: 'maxHp', pct: 0.2 } }],
  },
  {
    id: 'second-wind', name: 'Second Wind', icon: 'fountain', text: 'Once per run, rise again at 50% HP.',
    branch: 'bulwark', type: 'notable', ring: 2, angle: 306, links: ['bulwark-armor'], maxLevel: 1, cost: 190,
    effects: [{ kind: 'behaviour', id: 'second-wind' }],
  },
  {
    id: 'bulwark-hp-3', name: 'Keep Walls', icon: 'brick-wall', text: 'Max HP +20%.',
    branch: 'bulwark', type: 'minor', ring: 3, angle: 294, links: ['bulwark-hp-2'], maxLevel: 5, cost: 300,
    effects: [{ kind: 'stat', mod: { key: 'maxHp', pct: 0.2 } }], sealed: 'gatekeeper',
  },
  {
    id: 'bulwark-regen-3', name: 'Wellspring', icon: 'fountain', text: 'Regenerate +0.5% of Max HP per second.',
    branch: 'bulwark', type: 'minor', ring: 3, angle: 280, links: ['bulwark-regen-2'], maxLevel: 5, cost: 320,
    effects: [{ kind: 'stat', mod: { key: 'regen', add: 0.005 } }], sealed: 'gatekeeper',
  },
  {
    id: 'bulwark-armor-3', name: 'Tower Shield', icon: 'roman-shield', text: 'Armour +2: every hit on the tower is 2 weaker.',
    branch: 'bulwark', type: 'minor', ring: 3, angle: 308, links: ['bulwark-armor-2'], maxLevel: 5, cost: 360,
    effects: [{ kind: 'stat', mod: { key: 'armor', add: 2 } }], sealed: 'gatekeeper',
  },
  {
    id: 'bulwark-armor-2', name: 'Riveted Plate', icon: 'layered-armor', text: 'Armour +1: every hit on the tower is 1 weaker.',
    branch: 'bulwark', type: 'minor', ring: 2, angle: 318, links: ['bulwark-armor'], maxLevel: 5, cost: 90,
    effects: [{ kind: 'stat', mod: { key: 'armor', add: 1 } }],
  },
  {
    id: 'bulwark-hp-4', name: "Citadel", icon: 'health-increase', text: "Max HP ×1.1.",
    branch: 'bulwark', type: 'minor', ring: 4, angle: 294, links: ['bulwark-hp-3'], maxLevel: 2, cost: 14400, growth: 3,
    effects: [{ kind: 'stat', mod: { key: 'maxHp', mult: 1.1 } }], sealed: 'prism',
  },
  {
    id: 'bulwark-regen-4', name: "Deep Roots", icon: 'heart-drop', text: "Regenerate +0.5% of Max HP per second.",
    branch: 'bulwark', type: 'minor', ring: 4, angle: 280, links: ['bulwark-regen-3'], maxLevel: 5, cost: 5200,
    effects: [{ kind: 'stat', mod: { key: 'regen', add: 0.005 } }], sealed: 'prism',
  },
  {
    id: 'bulwark-armor-4', name: "Bastion Plate", icon: 'breastplate', text: "Armour +3: every hit on the tower is 3 weaker.",
    branch: 'bulwark', type: 'minor', ring: 4, angle: 308, links: ['bulwark-armor-3'], maxLevel: 5, cost: 5600,
    effects: [{ kind: 'stat', mod: { key: 'armor', add: 3 } }], sealed: 'prism',
  },
  {
    id: 'rampart', name: "Rampart", icon: 'stone-wall', text: "No contact hit takes more than 8% of Max HP.",
    branch: 'bulwark', type: 'notable', ring: 4, angle: 318, links: ['bulwark-armor-4'], maxLevel: 1, cost: 7000,
    effects: [{ kind: 'behaviour', id: 'rampart' }], sealed: 'prism',
  },
  {
    id: 'bulwark-hp-5', name: "Unbreaking", icon: 'shining-heart', text: "Max HP ×1.1.",
    branch: 'bulwark', type: 'minor', ring: 5, angle: 294, links: ['bulwark-hp-4'], maxLevel: 2, cost: 120000, growth: 3,
    effects: [{ kind: 'stat', mod: { key: 'maxHp', mult: 1.1 } }], sealed: 'forgeheart',
  },
  {
    id: 'bulwark-regen-5', name: "Evergreen", icon: 'regeneration', text: "Regenerate +0.5% of Max HP per second.",
    branch: 'bulwark', type: 'minor', ring: 5, angle: 280, links: ['bulwark-regen-4'], maxLevel: 5, cost: 41600,
    effects: [{ kind: 'stat', mod: { key: 'regen', add: 0.005 } }], sealed: 'forgeheart',
  },
  {
    id: 'bulwark-armor-5', name: "Adamant", icon: 'metal-plate', text: "Armour +5: every hit on the tower is 5 weaker.",
    branch: 'bulwark', type: 'minor', ring: 5, angle: 308, links: ['bulwark-armor-4'], maxLevel: 5, cost: 44000,
    effects: [{ kind: 'stat', mod: { key: 'armor', add: 5 } }], sealed: 'forgeheart',
  },
  {
    id: 'undying', name: "Undying", icon: 'fountain', text: "Once more per run, rise again at 50% HP.",
    branch: 'bulwark', type: 'notable', ring: 5, angle: 268, links: ['bulwark-regen-5'], maxLevel: 1, cost: 120000,
    effects: [{ kind: 'behaviour', id: 'second-wind' }], sealed: 'forgeheart',
  },
  {
    id: 'bulwark-hp-6', name: "Eternal Walls", icon: 'castle', text: "Max HP ×1.1.",
    branch: 'bulwark', type: 'minor', ring: 6, angle: 294, links: ['bulwark-hp-5'], maxLevel: 2, cost: 729000, growth: 3,
    effects: [{ kind: 'stat', mod: { key: 'maxHp', mult: 1.1 } }], sealed: 'hollow-king',
  },
  {
    id: 'bulwark-regen-6', name: "Font of Life", icon: 'healing', text: "Regenerate +0.5% of Max HP per second.",
    branch: 'bulwark', type: 'minor', ring: 6, angle: 280, links: ['bulwark-regen-5'], maxLevel: 5, cost: 243000,
    effects: [{ kind: 'stat', mod: { key: 'regen', add: 0.005 } }], sealed: 'hollow-king',
  },
  {
    id: 'bulwark-armor-6', name: "Godplate", icon: 'armor-upgrade', text: "Armour +8: every hit on the tower is 8 weaker.",
    branch: 'bulwark', type: 'minor', ring: 6, angle: 308, links: ['bulwark-armor-5'], maxLevel: 5, cost: 256500,
    effects: [{ kind: 'stat', mod: { key: 'armor', add: 8 } }], sealed: 'hollow-king',
  },
  {
    id: 'oath', name: "Oath of Stone", icon: 'surrounded-shield', text: "Regen is tripled while a boss stands.",
    branch: 'bulwark', type: 'notable', ring: 6, angle: 300, links: ['bulwark-hp-6'], maxLevel: 1, cost: 606000,
    effects: [{ kind: 'behaviour', id: 'oath' }], sealed: 'hollow-king',
  },

  // ── Masteries (§9): the idle-forever sink, one per branch ──────────────
  {
    id: 'might-mastery', name: 'Might Mastery', icon: 'mighty-force', text: 'Damage ×1.03 per level, without end.',
    branch: 'might', type: 'mastery', ring: 7, angle: 4, links: ['might-damage-6'], maxLevel: Infinity, cost: 1_500_000, growth: 1.2,
    effects: [{ kind: 'stat', mod: { key: 'damage', mult: 1.03 } }],
  },
  {
    id: 'arsenal-mastery', name: 'Arsenal Mastery', icon: 'quiver', text: 'Attack speed ×1.03 per level, without end.',
    branch: 'arsenal', type: 'mastery', ring: 7, angle: 90, links: ['weapon-slot-4'], maxLevel: Infinity, cost: 1_500_000, growth: 1.2,
    effects: [{ kind: 'stat', mod: { key: 'attackSpeed', mult: 1.03 } }],
  },
  {
    id: 'engineering-mastery', name: 'Engineering Mastery', icon: 'clockwork', text: 'Ultimate charge ×1.03 per level, without end.',
    branch: 'engineering', type: 'mastery', ring: 7, angle: 150, links: ['ult-charge-4'], maxLevel: Infinity, cost: 1_500_000, growth: 1.2,
    effects: [{ kind: 'stat', mod: { key: 'ultCharge', mult: 1.03 } }],
  },
  {
    id: 'fortune-mastery', name: 'Fortune Mastery', icon: 'gold-mine', text: 'Shards ×1.03 per level, without end.',
    branch: 'fortune', type: 'mastery', ring: 7, angle: 210, links: ['fortune-shards-6'], maxLevel: Infinity, cost: 1_500_000, growth: 1.2,
    effects: [{ kind: 'stat', mod: { key: 'shardGain', mult: 1.03 } }],
  },
  {
    id: 'bulwark-mastery', name: 'Bulwark Mastery', icon: 'magic-shield', text: 'Max HP ×1.03 per level, without end.',
    branch: 'bulwark', type: 'mastery', ring: 7, angle: 294, links: ['bulwark-hp-6'], maxLevel: Infinity, cost: 1_500_000, growth: 1.2,
    effects: [{ kind: 'stat', mod: { key: 'maxHp', mult: 1.03 } }],
  },
];

export const FORGE_BY_ID: Readonly<Record<string, ForgeNodeDef>> = Object.fromEntries(
  FORGE.map((n) => [n.id, n]),
);
