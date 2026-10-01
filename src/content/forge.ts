import type { BranchId, ForgeNodeDef } from './types';

/**
 * The Forge (§5.1, §11.4): one radial web, five branches. P3 ships rings 1–2
 * of Might, Bulwark, Fortune and Arsenal, and Engineering's first ring.
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
    id: 'executioner', name: 'Executioner', icon: 'executioner-hood', text: 'Enemies under 10% HP die when hit.',
    branch: 'might', type: 'notable', ring: 2, angle: 30, links: ['overkill'], maxLevel: 1, cost: 220,
    effects: [{ kind: 'behaviour', id: 'executioner' }],
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
    id: 'ult-charge', name: 'Capacitor', icon: 'energy-tank', text: 'Ultimate charges 15% faster.',
    branch: 'engineering', type: 'minor', ring: 2, angle: 148, links: ['auto-restart', 'speed-2'], maxLevel: 3, cost: 120,
    effects: [{ kind: 'stat', mod: { key: 'ultCharge', pct: 0.15 } }],
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
    id: 'fortune-xp-2', name: 'Scholar', icon: 'brain', text: 'XP +10%.',
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
    id: 'choice', name: 'Choice', icon: 'nested-hexagons', text: '+1 card in every draft.',
    branch: 'fortune', type: 'notable', ring: 2, angle: 234, links: ['reroll'], maxLevel: 1, cost: 305,
    effects: [{ kind: 'behaviour', id: 'extra-choice' }],
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
    id: 'bulwark-armor-2', name: 'Riveted Plate', icon: 'layered-armor', text: 'Armour +1: every hit on the tower is 1 weaker.',
    branch: 'bulwark', type: 'minor', ring: 2, angle: 318, links: ['bulwark-armor'], maxLevel: 5, cost: 90,
    effects: [{ kind: 'stat', mod: { key: 'armor', add: 1 } }],
  },
];

export const FORGE_BY_ID: Readonly<Record<string, ForgeNodeDef>> = Object.fromEntries(
  FORGE.map((n) => [n.id, n]),
);
