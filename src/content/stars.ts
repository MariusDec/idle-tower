import type { CardItemId, ConstellationId, StarNodeDef } from './types';

/**
 * The Constellations (§9): Act 2's tree, bought with Starlight. Forty-four
 * nodes in five figures, laid out like the Forge (same rings, links and
 * fog) but qualitative first: Act 2's four weapons and two passives, two
 * frames, the fifth weapon slot, a sixth relic slot, the Abyss's four relic
 * sets, the Forge's five masteries and four fusions (N9). The minors are big
 * steps (§2.1: felt).
 *
 * Every figure has a node on the root, so the sky opens five ways at once
 * when the Blight falls.
 */

export const CONSTELLATION_ANGLE: Readonly<Record<ConstellationId, number>> = {
  smith: 0,
  warden: 72,
  lantern: 144,
  crown: 216,
  deep: 288,
};

export const CONSTELLATION_NAME: Readonly<Record<ConstellationId, string>> = {
  smith: 'The Smith',
  warden: 'The Warden',
  lantern: 'The Lantern',
  crown: 'The Crown',
  deep: 'The Deep',
};

export const STARS: readonly StarNodeDef[] = [
  // ── The Smith: weapons ────────────────────────────────────────────────
  {
    id: 'smith-moonblade', name: 'Moonblade', icon: 'armored-boomerang', text: 'Moonblade joins the draft.',
    branch: 'smith', type: 'notable', ring: 1, angle: 0, links: [], maxLevel: 1, cost: 3,
    effects: [{ kind: 'unlockCard', id: 'moonblade' }],
  },
  {
    id: 'smith-damage', name: 'Starforged', icon: 'rune-sword', text: 'Damage +20%.',
    branch: 'smith', type: 'minor', ring: 1, angle: -22, links: ['smith-moonblade'], maxLevel: 3, cost: 2,
    effects: [{ kind: 'stat', mod: { key: 'damage', pct: 0.2 } }],
  },
  {
    id: 'smith-speed', name: 'Comet Hands', icon: 'fast-arrow', text: 'Attack speed +10%.',
    branch: 'smith', type: 'minor', ring: 2, angle: -18, links: ['smith-damage'], maxLevel: 3, cost: 6,
    effects: [{ kind: 'stat', mod: { key: 'attackSpeed', pct: 0.1 } }],
  },
  {
    id: 'smith-runes', name: 'Rune Traps', icon: 'land-mine', text: 'Rune Traps join the draft.',
    branch: 'smith', type: 'notable', ring: 2, angle: 4, links: ['smith-moonblade'], maxLevel: 1, cost: 8,
    effects: [{ kind: 'unlockCard', id: 'rune-traps' }],
  },
  {
    id: 'smith-zeal', name: 'Zeal', icon: 'attack-gauge', text: 'The Zeal passive joins the draft.',
    branch: 'smith', type: 'notable', ring: 2, angle: 22, links: ['smith-runes'], maxLevel: 1, cost: 6,
    effects: [{ kind: 'unlockCard', id: 'zeal' }],
  },
  {
    id: 'smith-mount', name: 'Fifth Mount', icon: 'castle', text: '+1 weapon slot: a fifth weapon on the tower.',
    branch: 'smith', type: 'notable', ring: 3, angle: -14, links: ['smith-speed'], maxLevel: 1, cost: 30,
    effects: [{ kind: 'slot', slot: 'weapon', n: 1 }],
  },
  {
    id: 'smith-tether', name: 'Soul Tether', icon: 'magic-swirl', text: 'Soul Tether joins the draft.',
    branch: 'smith', type: 'notable', ring: 3, angle: 2, links: ['smith-runes'], maxLevel: 1, cost: 16,
    effects: [{ kind: 'unlockCard', id: 'soul-tether' }],
  },
  {
    id: 'smith-rail', name: 'Gilded Rail', icon: 'target-laser', text: 'Gilded Rail joins the draft.',
    branch: 'smith', type: 'notable', ring: 3, angle: 18, links: ['smith-zeal'], maxLevel: 1, cost: 18,
    effects: [{ kind: 'unlockCard', id: 'gilded-rail' }],
  },
  // Fusions (N9): each lights one, for two evolved weapons to become one.
  {
    id: 'smith-blizzard', name: 'Blizzard', icon: 'frozen-orb', text: 'Storm Crown and Absolute Zero may fuse: Blizzard.',
    branch: 'smith', type: 'notable', ring: 4, angle: -20, links: ['smith-mount'], maxLevel: 1, cost: 40,
    effects: [{ kind: 'fusion', id: 'blizzard' }],
  },
  {
    id: 'smith-firestorm', name: 'Firestorm', icon: 'fragmented-meteor', text: 'Meteorfall and Dragonbreath may fuse: Firestorm.',
    branch: 'smith', type: 'notable', ring: 4, angle: -7, links: ['smith-mount'], maxLevel: 1, cost: 40,
    effects: [{ kind: 'fusion', id: 'firestorm' }],
  },
  {
    id: 'smith-dawnstar', name: 'Dawnstar', icon: 'sunbeams', text: 'Judgment and Seeker Swarm may fuse: Dawnstar.',
    branch: 'smith', type: 'notable', ring: 4, angle: 6, links: ['smith-tether'], maxLevel: 1, cost: 40,
    effects: [{ kind: 'fusion', id: 'dawnstar' }],
  },
  {
    id: 'smith-sky-hive', name: 'Sky Hive', icon: 'delivery-drone', text: 'Halo and Hive may fuse: Sky Hive.',
    branch: 'smith', type: 'notable', ring: 4, angle: 19, links: ['smith-rail'], maxLevel: 1, cost: 40,
    effects: [{ kind: 'fusion', id: 'sky-hive' }],
  },

  // ── The Warden: frames and walls ──────────────────────────────────────
  {
    id: 'warden-hp', name: 'Starwall', icon: 'shining-heart', text: 'Max HP +25%.',
    branch: 'warden', type: 'minor', ring: 1, angle: 70, links: [], maxLevel: 3, cost: 2,
    effects: [{ kind: 'stat', mod: { key: 'maxHp', pct: 0.25 } }],
  },
  {
    id: 'warden-lamplighter', name: 'The Lamplighter', icon: 'lantern-flame', text: 'The Lamplighter frame: Moonblade, and Daybreak.',
    branch: 'warden', type: 'notable', ring: 1, angle: 92, links: [], maxLevel: 1, cost: 4,
    effects: [{ kind: 'frame', id: 'lamplighter' }],
  },
  {
    id: 'warden-regen', name: 'Starspring', icon: 'regeneration', text: 'Regenerate +1% of Max HP per second.',
    branch: 'warden', type: 'minor', ring: 2, angle: 58, links: ['warden-hp'], maxLevel: 3, cost: 6,
    effects: [{ kind: 'stat', mod: { key: 'regen', add: 0.01 } }],
  },
  {
    id: 'warden-armor', name: 'Star Plate', icon: 'breastplate', text: 'Armour +10: every hit on the tower is 10 weaker.',
    branch: 'warden', type: 'minor', ring: 2, angle: 74, links: ['warden-hp'], maxLevel: 3, cost: 6,
    effects: [{ kind: 'stat', mod: { key: 'armor', add: 10 } }],
  },
  {
    id: 'warden-conduit', name: 'Conduit', icon: 'energy-tank', text: 'The Conduit passive joins the draft.',
    branch: 'warden', type: 'notable', ring: 2, angle: 92, links: ['warden-lamplighter'], maxLevel: 1, cost: 6,
    effects: [{ kind: 'unlockCard', id: 'conduit' }],
  },
  {
    id: 'warden-undying', name: 'Undimmed', icon: 'fountain', text: 'Once more per run, rise again at 50% HP.',
    branch: 'warden', type: 'notable', ring: 3, angle: 60, links: ['warden-regen'], maxLevel: 1, cost: 14,
    effects: [{ kind: 'behaviour', id: 'second-wind' }],
  },
  {
    id: 'warden-hp-2', name: 'Starkeep', icon: 'castle', text: 'Max HP +25%.',
    branch: 'warden', type: 'minor', ring: 3, angle: 76, links: ['warden-armor'], maxLevel: 3, cost: 12,
    effects: [{ kind: 'stat', mod: { key: 'maxHp', pct: 0.25 } }],
  },
  {
    id: 'warden-gravekeeper', name: 'The Gravekeeper', icon: 'reaper-scythe', text: 'The Gravekeeper frame: Soul Tether, and Eclipse.',
    branch: 'warden', type: 'notable', ring: 3, angle: 92, links: ['warden-conduit'], maxLevel: 1, cost: 20,
    effects: [{ kind: 'frame', id: 'gravekeeper' }],
  },

  // ── The Lantern: relics ───────────────────────────────────────────────
  {
    id: 'lantern-1', name: 'First Lantern', icon: 'lantern-flame', text: 'Three new relics start dropping in the Abyss.',
    branch: 'lantern', type: 'notable', ring: 1, angle: 144, links: [], maxLevel: 1, cost: 4,
    effects: [{ kind: 'relics', set: 1 }],
  },
  {
    id: 'lantern-xp', name: 'Lamplit Study', icon: 'wisdom', text: 'XP +20%.',
    branch: 'lantern', type: 'minor', ring: 1, angle: 124, links: ['lantern-1'], maxLevel: 3, cost: 2,
    effects: [{ kind: 'stat', mod: { key: 'xpGain', pct: 0.2 } }],
  },
  {
    id: 'lantern-slot', name: 'Sixth Setting', icon: 'locked-chest', text: '+1 relic slot.',
    branch: 'lantern', type: 'notable', ring: 2, angle: 132, links: ['lantern-1'], maxLevel: 1, cost: 12,
    effects: [{ kind: 'slot', slot: 'relic', n: 1 }],
  },
  {
    id: 'lantern-2', name: 'Second Lantern', icon: 'fire-bowl', text: 'Three more relics start dropping in the Abyss.',
    branch: 'lantern', type: 'notable', ring: 2, angle: 152, links: ['lantern-1'], maxLevel: 1, cost: 9,
    effects: [{ kind: 'relics', set: 2 }],
  },
  {
    id: 'lantern-greed', name: 'Gilded Light', icon: 'coins-pile', text: 'Shards +25%.',
    branch: 'lantern', type: 'minor', ring: 3, angle: 126, links: ['lantern-slot'], maxLevel: 3, cost: 12,
    effects: [{ kind: 'stat', mod: { key: 'shardGain', pct: 0.25 } }],
  },
  {
    id: 'lantern-3', name: 'Third Lantern', icon: 'sun', text: 'Three more relics start dropping in the Abyss.',
    branch: 'lantern', type: 'notable', ring: 3, angle: 144, links: ['lantern-2'], maxLevel: 1, cost: 16,
    effects: [{ kind: 'relics', set: 3 }],
  },
  {
    id: 'lantern-4', name: 'Fourth Lantern', icon: 'sunbeams', text: 'The last three relics start dropping in the Abyss.',
    branch: 'lantern', type: 'notable', ring: 3, angle: 162, links: ['lantern-3'], maxLevel: 1, cost: 22,
    effects: [{ kind: 'relics', set: 4 }],
  },
  {
    id: 'lantern-luck', name: 'Lantern Bearer', icon: 'open-treasure-chest', text: 'Elites drop relics twice as often.',
    branch: 'lantern', type: 'notable', ring: 2, angle: 168, links: ['lantern-2'], maxLevel: 1, cost: 8,
    effects: [{ kind: 'behaviour', id: 'relic-luck' }],
  },

  // ── The Crown: the Forge's masteries ──────────────────────────────────
  {
    id: 'crown-might', name: 'Might Mastery', icon: 'mighty-force', text: 'The Forge’s Might branch gains its endless mastery.',
    branch: 'crown', type: 'notable', ring: 1, angle: 216, links: [], maxLevel: 1, cost: 5,
    effects: [{ kind: 'mastery', branch: 'might' }],
  },
  {
    id: 'crown-crit-damage', name: 'Crown Jewels', icon: 'gems', text: 'Crit damage +30%.',
    branch: 'crown', type: 'minor', ring: 1, angle: 196, links: ['crown-might'], maxLevel: 3, cost: 2,
    effects: [{ kind: 'stat', mod: { key: 'critDamage', add: 0.3 } }],
  },
  {
    id: 'crown-bulwark', name: 'Bulwark Mastery', icon: 'magic-shield', text: 'The Forge’s Bulwark branch gains its endless mastery.',
    branch: 'crown', type: 'notable', ring: 2, angle: 204, links: ['crown-might'], maxLevel: 1, cost: 10,
    effects: [{ kind: 'mastery', branch: 'bulwark' }],
  },
  {
    id: 'crown-fortune', name: 'Fortune Mastery', icon: 'gold-mine', text: 'The Forge’s Fortune branch gains its endless mastery.',
    branch: 'crown', type: 'notable', ring: 2, angle: 222, links: ['crown-might'], maxLevel: 1, cost: 10,
    effects: [{ kind: 'mastery', branch: 'fortune' }],
  },
  {
    id: 'crown-crit', name: 'Crown Sight', icon: 'eye-target', text: 'Crit chance +4%.',
    branch: 'crown', type: 'minor', ring: 2, angle: 240, links: ['crown-fortune'], maxLevel: 3, cost: 6,
    effects: [{ kind: 'stat', mod: { key: 'critChance', add: 0.04 } }],
  },
  {
    id: 'crown-arsenal', name: 'Arsenal Mastery', icon: 'quiver', text: 'The Forge’s Arsenal branch gains its endless mastery.',
    branch: 'crown', type: 'notable', ring: 3, angle: 204, links: ['crown-bulwark'], maxLevel: 1, cost: 18,
    effects: [{ kind: 'mastery', branch: 'arsenal' }],
  },
  {
    id: 'crown-engineering', name: 'Engineering Mastery', icon: 'clockwork', text: 'The Forge’s Engineering branch gains its endless mastery.',
    branch: 'crown', type: 'notable', ring: 3, angle: 222, links: ['crown-fortune'], maxLevel: 1, cost: 18,
    effects: [{ kind: 'mastery', branch: 'engineering' }],
  },
  {
    id: 'crown-head-start', name: 'Crowned Start', icon: 'graduate-cap', text: 'Start runs two levels higher.',
    branch: 'crown', type: 'notable', ring: 3, angle: 240, links: ['crown-crit'], maxLevel: 1, cost: 14,
    effects: [{ kind: 'behaviour', id: 'head-start' }],
  },

  // ── The Deep: the descent ─────────────────────────────────────────────
  {
    id: 'deep-damage', name: 'Deep Edge', icon: 'piercing-sword', text: 'Damage +20%.',
    branch: 'deep', type: 'minor', ring: 1, angle: 280, links: [], maxLevel: 3, cost: 2,
    effects: [{ kind: 'stat', mod: { key: 'damage', pct: 0.2 } }],
  },
  {
    id: 'deep-star', name: 'Stargazer', icon: 'telescope', text: 'Every Starlight payout is 25% larger.',
    branch: 'deep', type: 'notable', ring: 1, angle: 302, links: [], maxLevel: 1, cost: 4,
    effects: [{ kind: 'starlight', pct: 0.25 }],
  },
  {
    id: 'deep-ult', name: 'Deep Well', icon: 'well', text: 'Ultimate charge +20%.',
    branch: 'deep', type: 'minor', ring: 2, angle: 270, links: ['deep-damage'], maxLevel: 3, cost: 6,
    effects: [{ kind: 'stat', mod: { key: 'ultCharge', pct: 0.2 } }],
  },
  {
    id: 'deep-salvo', name: 'Second Salvo', icon: 'double-shot', text: 'Your starting weapon begins one level higher.',
    branch: 'deep', type: 'notable', ring: 2, angle: 288, links: ['deep-damage'], maxLevel: 1, cost: 10,
    effects: [{ kind: 'behaviour', id: 'opening-salvo' }],
  },
  {
    id: 'deep-reroll', name: 'Second Look', icon: 'rolling-dices', text: 'One more reroll every run.',
    branch: 'deep', type: 'notable', ring: 2, angle: 306, links: ['deep-star'], maxLevel: 1, cost: 8,
    effects: [{ kind: 'behaviour', id: 'reroll' }],
  },
  {
    id: 'deep-range', name: 'Far Light', icon: 'arrow-scope', text: 'Range +10%.',
    branch: 'deep', type: 'minor', ring: 3, angle: 268, links: ['deep-ult'], maxLevel: 3, cost: 12,
    effects: [{ kind: 'stat', mod: { key: 'range', pct: 0.1 } }],
  },
  {
    id: 'deep-area', name: 'Wide Dark', icon: 'explosion-rays', text: 'Area +15%.',
    branch: 'deep', type: 'minor', ring: 3, angle: 286, links: ['deep-salvo'], maxLevel: 3, cost: 12,
    effects: [{ kind: 'stat', mod: { key: 'area', pct: 0.15 } }],
  },
  {
    id: 'deep-star-2', name: 'Astronomer', icon: 'star-formation', text: 'Every Starlight payout is 25% larger.',
    branch: 'deep', type: 'notable', ring: 3, angle: 306, links: ['deep-reroll'], maxLevel: 1, cost: 20,
    effects: [{ kind: 'starlight', pct: 0.25 }],
  },
];

export const STAR_BY_ID: Readonly<Record<string, StarNodeDef>> = Object.fromEntries(
  STARS.map((n) => [n.id, n]),
);

/**
 * The cards a Constellation puts in the draft (§9): Act 2's weapons and
 * passives. Act 1's readings (the Recipe Book's list, the I4 arsenal
 * report) leave them out.
 */
export const STAR_CARDS: ReadonlySet<CardItemId> = new Set(
  STARS.flatMap((n) => n.effects).flatMap((e) => (e.kind === 'unlockCard' ? [e.id] : [])),
);
