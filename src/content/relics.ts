import type { BossId, RelicDef, RelicId } from './types';

/**
 * Relics (§5.3, §11.5): twenty-four, four per region: the boss's first-kill relic and
 * three its elites drop; and Act 2's twelve (§9), in four sets of three that
 * the Lantern's stars light, dropped by the Abyss's elites. Qualitative, 15 words or fewer, each leaning on a
 * weapon family or the region's verb. Duplicates rank a relic up to III;
 * `perRank` is what each rank past I adds. Rank numbers: `BALANCE.relics`.
 */
export const RELICS: readonly RelicDef[] = [
  {
    id: 'gatekeepers-seal', name: "Gatekeeper's Seal", icon: 'crown-coin',
    text: 'Start every run with one extra level-up.',
    source: { kind: 'boss', boss: 'gatekeeper' },
    effects: [{ kind: 'behaviour', id: 'extra-level' }], perRank: [{ kind: 'behaviour', id: 'extra-level' }],
  },
  {
    id: 'tallow-candle', name: 'Tallow Candle', icon: 'lantern-flame',
    text: 'Waves 1–5 arrive 50% faster.',
    source: { kind: 'elite', region: 1 },
    effects: [{ kind: 'behaviour', id: 'quick-start' }], perRank: [{ kind: 'behaviour', id: 'quick-start' }],
  },
  {
    id: 'cracked-lens', name: 'Cracked Lens', icon: 'shatter',
    text: 'Crits deal +100% damage; crit chance −5%.',
    source: { kind: 'elite', region: 1 },
    effects: [
      { kind: 'stat', mod: { key: 'critDamage', add: 1 } },
      { kind: 'stat', mod: { key: 'critChance', add: -0.05 } },
    ],
    perRank: [{ kind: 'stat', mod: { key: 'critDamage', add: 0.5 } }],
  },
  {
    id: 'hunters-tally', name: "Hunter's Tally", icon: 'wanted-reward',
    text: '+5% damage for every 100 kills this run.',
    source: { kind: 'elite', region: 1 },
    effects: [{ kind: 'behaviour', id: 'tally' }], perRank: [{ kind: 'behaviour', id: 'tally' }],
  },
  {
    id: 'mothers-tear', name: "Mother's Tear", icon: 'chalice-drops',
    text: 'Regen is doubled while no enemy is within half range.',
    source: { kind: 'boss', boss: 'bog-mother' },
    effects: [{ kind: 'behaviour', id: 'still-regen' }], perRank: [{ kind: 'behaviour', id: 'still-regen' }],
  },
  {
    id: 'bog-lantern', name: 'Bog Lantern', icon: 'fire-bowl',
    text: 'Enemies slain by lightning, frost or Nova drop double XP.',
    source: { kind: 'elite', region: 2 },
    effects: [{ kind: 'behaviour', id: 'storm-xp' }], perRank: [{ kind: 'behaviour', id: 'storm-xp' }],
  },
  {
    id: 'mire-lily', name: 'Mire Lily', icon: 'clover',
    text: 'Splitter fragments are born at half health.',
    source: { kind: 'elite', region: 2 },
    effects: [{ kind: 'behaviour', id: 'frail-splits' }], perRank: [{ kind: 'behaviour', id: 'frail-splits' }],
  },
  {
    id: 'stillwater-charm', name: 'Stillwater Charm', icon: 'echo-ripples',
    text: 'Enemies standing still take +25% damage.',
    source: { kind: 'elite', region: 2 },
    effects: [{ kind: 'behaviour', id: 'still-target' }], perRank: [{ kind: 'behaviour', id: 'still-target' }],
  },
  {
    id: 'prism-heart', name: 'Prism Heart', icon: 'floating-crystal',
    text: 'A fifth of your shots refract into a second target.',
    source: { kind: 'boss', boss: 'prism' },
    effects: [{ kind: 'behaviour', id: 'refract' }], perRank: [{ kind: 'behaviour', id: 'refract' }],
  },
  {
    id: 'frost-brand', name: 'Frost Brand', icon: 'frozen-arrow',
    text: 'Slowed enemies take +25% damage.',
    source: { kind: 'elite', region: 3 },
    effects: [{ kind: 'behaviour', id: 'frost-brand' }], perRank: [{ kind: 'behaviour', id: 'frost-brand' }],
  },
  {
    id: 'mirror-shard', name: 'Mirror Shard', icon: 'crystal-shine',
    text: 'Your first hit on every enemy is a critical hit.',
    source: { kind: 'elite', region: 3 },
    effects: [{ kind: 'behaviour', id: 'first-crit' }], perRank: [{ kind: 'stat', mod: { key: 'critDamage', add: 0.25 } }],
  },
  {
    id: 'hourglass-sand', name: 'Hourglass Sand', icon: 'hourglass',
    text: 'Enemies within a third of your range take +30% damage.',
    source: { kind: 'elite', region: 3 },
    effects: [{ kind: 'behaviour', id: 'close-quarters' }], perRank: [{ kind: 'behaviour', id: 'close-quarters' }],
  },
  {
    id: 'forgeheart-core', name: 'Forgeheart Core', icon: 'frostfire',
    text: 'Every 10 s, your weapons hit three times as hard for a second.',
    source: { kind: 'boss', boss: 'forgeheart' },
    effects: [{ kind: 'behaviour', id: 'surge' }], perRank: [{ kind: 'behaviour', id: 'surge' }],
  },
  {
    id: 'ember-ward', name: 'Ember Ward', icon: 'lantern-flame',
    text: 'Burning enemies take +30% damage.',
    source: { kind: 'elite', region: 4 },
    effects: [{ kind: 'behaviour', id: 'kindling' }], perRank: [{ kind: 'behaviour', id: 'kindling' }],
  },
  {
    id: 'blast-shield', name: 'Blast Shield', icon: 'cracked-shield',
    text: 'Blasts and shards that reach the wall land at half strength.',
    source: { kind: 'elite', region: 4 },
    effects: [{ kind: 'behaviour', id: 'blast-shield' }], perRank: [{ kind: 'behaviour', id: 'blast-shield' }],
  },
  {
    id: 'spyglass', name: 'Spyglass', icon: 'telescope',
    text: 'The tower sees 15% farther.',
    source: { kind: 'elite', region: 4 },
    effects: [{ kind: 'stat', mod: { key: 'range', pct: 0.15 } }], perRank: [{ kind: 'stat', mod: { key: 'range', pct: 0.05 } }],
  },
  {
    id: 'hollow-crown', name: 'Hollow Crown', icon: 'crown',
    text: 'Each ultimate also restores 25% of Max HP.',
    source: { kind: 'boss', boss: 'hollow-king' },
    effects: [{ kind: 'behaviour', id: 'ult-heal' }], perRank: [{ kind: 'behaviour', id: 'ult-heal' }],
  },
  {
    id: 'soul-jar', name: 'Soul Jar', icon: 'vial',
    text: 'Every 50 kills restore 5% of Max HP.',
    source: { kind: 'elite', region: 5 },
    effects: [{ kind: 'behaviour', id: 'soul-jar' }], perRank: [{ kind: 'behaviour', id: 'soul-jar' }],
  },
  {
    id: 'warding-salt', name: 'Warding Salt', icon: 'stone-block',
    text: 'Enemies that strike the wall are slowed 30%.',
    source: { kind: 'elite', region: 5 },
    effects: [{ kind: 'behaviour', id: 'salt' }], perRank: [{ kind: 'behaviour', id: 'salt' }],
  },
  {
    id: 'last-light', name: 'Last Light', icon: 'extraction-orb',
    text: 'Below half HP, your ultimate charges twice as fast.',
    source: { kind: 'elite', region: 5 },
    effects: [{ kind: 'behaviour', id: 'last-light' }], perRank: [{ kind: 'behaviour', id: 'last-light' }],
  },
  {
    id: 'heart-of-light', name: 'Heart of Light', icon: 'shining-heart',
    text: '+1 weapon slot.',
    source: { kind: 'boss', boss: 'blight' },
    effects: [{ kind: 'slot', slot: 'weapon', n: 1 }], perRank: [{ kind: 'stat', mod: { key: 'damage', pct: 0.1 } }],
  },
  {
    id: 'blight-thorn', name: 'Blight Thorn', icon: 'spikes',
    text: 'Elites take +50% damage.',
    source: { kind: 'elite', region: 6 },
    effects: [{ kind: 'behaviour', id: 'elite-bane' }], perRank: [{ kind: 'behaviour', id: 'elite-bane' }],
  },
  {
    id: 'pale-lantern', name: 'Pale Lantern', icon: 'concentration-orb',
    text: 'Bosses take +20% damage.',
    source: { kind: 'elite', region: 6 },
    effects: [{ kind: 'behaviour', id: 'boss-bane' }], perRank: [{ kind: 'behaviour', id: 'boss-bane' }],
  },
  {
    id: 'starseed', name: 'Starseed', icon: 'star-swirl',
    text: 'Each level-up restores 10% of Max HP.',
    source: { kind: 'elite', region: 6 },
    effects: [{ kind: 'behaviour', id: 'level-heal' }], perRank: [{ kind: 'behaviour', id: 'level-heal' }],
  },
  // ── Act 2 (§9): the Abyss's, set by set ───────────────────────────────
  {
    id: 'moonstone', name: 'Moonstone', icon: 'round-star',
    text: 'Moonblade crescents come back twice as fast.',
    source: { kind: 'abyss', set: 1 },
    effects: [{ kind: 'behaviour', id: 'swift-return' }], perRank: [{ kind: 'behaviour', id: 'swift-return' }],
  },
  {
    id: 'rune-chalk', name: 'Rune Chalk', icon: 'pentagram-rose',
    text: 'A rune that bursts leaves a fainter rune where it stood.',
    source: { kind: 'abyss', set: 1 },
    effects: [{ kind: 'behaviour', id: 'echo-rune' }], perRank: [{ kind: 'behaviour', id: 'echo-rune' }],
  },
  {
    id: 'husk-splinter', name: 'Husk Splinter', icon: 'striking-splinter',
    text: 'Husk shells swallow two fewer hits.',
    source: { kind: 'abyss', set: 1 },
    effects: [{ kind: 'behaviour', id: 'brittle-shell' }], perRank: [{ kind: 'behaviour', id: 'brittle-shell' }],
  },
  {
    id: 'tether-knot', name: 'Tether Knot', icon: 'magic-swirl',
    text: 'Soul Tether holds one more enemy.',
    source: { kind: 'abyss', set: 2 },
    effects: [{ kind: 'behaviour', id: 'extra-tether' }], perRank: [{ kind: 'behaviour', id: 'extra-tether' }],
  },
  {
    id: 'gilt-edge', name: 'Gilt Edge', icon: 'gold-nuggets',
    text: 'A slug’s kill bursts, striking everything near it.',
    source: { kind: 'abyss', set: 2 },
    effects: [{ kind: 'behaviour', id: 'rail-burst' }], perRank: [{ kind: 'behaviour', id: 'rail-burst' }],
  },
  {
    id: 'anchor-stone', name: 'Anchor Stone', icon: 'stone-block',
    text: 'Slowed enemies cannot charge or blink.',
    source: { kind: 'abyss', set: 2 },
    effects: [{ kind: 'behaviour', id: 'anchor' }], perRank: [{ kind: 'stat', mod: { key: 'duration', pct: 0.1 } }],
  },
  {
    id: 'ward-breaker', name: 'Ward Breaker', icon: 'armor-punch',
    text: 'Wards and shield auras protect enemies half as well.',
    source: { kind: 'abyss', set: 3 },
    effects: [{ kind: 'behaviour', id: 'wardbreak' }], perRank: [{ kind: 'behaviour', id: 'wardbreak' }],
  },
  {
    id: 'maw-tooth', name: 'Maw Tooth', icon: 'fangs-circle',
    text: 'Maws cannot feed on the fallen.',
    source: { kind: 'abyss', set: 3 },
    effects: [{ kind: 'behaviour', id: 'starve' }], perRank: [{ kind: 'stat', mod: { key: 'damage', pct: 0.05 } }],
  },
  {
    id: 'abyssal-pearl', name: 'Abyssal Pearl', icon: 'extraction-orb',
    text: 'Each floor of the Abyss cleared restores 25% of Max HP.',
    source: { kind: 'abyss', set: 3 },
    effects: [{ kind: 'behaviour', id: 'floor-heal' }], perRank: [{ kind: 'behaviour', id: 'floor-heal' }],
  },
  {
    id: 'executioners-coin', name: "Executioner's Coin", icon: 'coinflip',
    text: 'Enemies under 10% health die when hit; stacks with Executioner.',
    source: { kind: 'abyss', set: 4 },
    effects: [{ kind: 'behaviour', id: 'executioner' }], perRank: [{ kind: 'stat', mod: { key: 'critChance', add: 0.03 } }],
  },
  {
    id: 'phoenix-feather', name: 'Phoenix Feather', icon: 'arrow-flights',
    text: 'Once more per run, rise again at half health.',
    source: { kind: 'abyss', set: 4 },
    effects: [{ kind: 'behaviour', id: 'second-wind' }], perRank: [{ kind: 'stat', mod: { key: 'maxHp', pct: 0.1 } }],
  },
  {
    id: 'whetstone', name: 'Whetstone', icon: 'hammer-nails',
    text: 'New weapons join one more level up; stacks with Drilled.',
    source: { kind: 'abyss', set: 4 },
    effects: [{ kind: 'behaviour', id: 'drilled' }], perRank: [{ kind: 'behaviour', id: 'reroll' }],
  },
];

export const RELIC_BY_ID: Readonly<Record<RelicId, RelicDef>> = Object.fromEntries(
  RELICS.map((r) => [r.id, r]),
) as Record<RelicId, RelicDef>;

/** The relics a region's elites drop (§5.3). */
export function eliteRelics(region: number): RelicId[] {
  return RELICS.filter((r) => r.source.kind === 'elite' && r.source.region === region).map((r) => r.id);
}

/** The relics the Abyss's elites drop once these sets are lit (§9). */
export function abyssRelics(sets: readonly number[]): RelicId[] {
  return RELICS.filter((r) => r.source.kind === 'abyss' && sets.includes(r.source.set)).map((r) => r.id);
}

/** A boss's first-kill relic (§5.3), if it has one. */
export function bossRelic(boss: BossId): RelicId | null {
  return RELICS.find((r) => r.source.kind === 'boss' && r.source.boss === boss)?.id ?? null;
}
