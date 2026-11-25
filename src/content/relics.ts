import { CURSED_RELICS } from './cursed';
import type { BossId, RelicDef, RelicId, RelicSetDef } from './types';

/**
 * Relics (§5.3, §11.5): four per region, Act 1's six and the Wake's
 * (plans/late-game/12 §8.9): the boss's first-kill relic and
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
  // ── The Wake (plans/late-game/12 §8.9): the Bell Marches ──────────────
  {
    id: 'carillons-clapper', name: "Carillon's Clapper", icon: 'alarm-clock',
    text: 'Every 8 s, a toll stuns every enemy in range for half a second.',
    source: { kind: 'boss', boss: 'carillon' },
    effects: [{ kind: 'behaviour', id: 'clapper' }], perRank: [{ kind: 'behaviour', id: 'clapper' }],
  },
  {
    id: 'tuning-fork', name: 'Tuning Fork', icon: 'vibrating-ball',
    text: 'Stunned and frozen enemies take +30% damage.',
    source: { kind: 'elite', region: 9 },
    effects: [{ kind: 'behaviour', id: 'tuning-fork' }], perRank: [{ kind: 'behaviour', id: 'tuning-fork' }],
  },
  {
    id: 'muffled-bell', name: 'Muffled Bell', icon: 'sound-off',
    text: 'Slows, stuns and burns last 20% longer.',
    source: { kind: 'elite', region: 9 },
    effects: [{ kind: 'stat', mod: { key: 'duration', pct: 0.2 } }], perRank: [{ kind: 'stat', mod: { key: 'duration', pct: 0.1 } }],
  },
  {
    id: 'metronome', name: 'Metronome', icon: 'metronome',
    text: '+2% damage for every 10 s the tower goes unhurt, up to 20%.',
    source: { kind: 'elite', region: 9 },
    effects: [{ kind: 'behaviour', id: 'metronome' }], perRank: [{ kind: 'behaviour', id: 'metronome' }],
  },
  // ── The Orrery ──
  {
    id: 'astrolabe-ring', name: 'Astrolabe Ring', icon: 'orbital',
    text: 'Glaives and drones circle 30% faster.',
    source: { kind: 'boss', boss: 'astrolabe' },
    effects: [{ kind: 'behaviour', id: 'astrolabe' }], perRank: [{ kind: 'behaviour', id: 'astrolabe' }],
  },
  {
    id: 'star-chart', name: 'Star Chart', icon: 'night-sky',
    text: 'Homing bolts that lose their mark seek a new one twice as far.',
    source: { kind: 'elite', region: 10 },
    effects: [{ kind: 'behaviour', id: 'star-chart' }], perRank: [{ kind: 'behaviour', id: 'star-chart' }],
  },
  {
    id: 'tidal-lock', name: 'Tidal Lock', icon: 'vortex',
    text: 'Enemies within half your range move 15% slower.',
    source: { kind: 'elite', region: 10 },
    effects: [{ kind: 'behaviour', id: 'tidal-lock' }], perRank: [{ kind: 'behaviour', id: 'tidal-lock' }],
  },
  {
    id: 'comet-tail', name: 'Comet Tail', icon: 'meteor-impact',
    text: 'Enemies slain by Glaives leave burning ground for 2 s.',
    source: { kind: 'elite', region: 10 },
    effects: [{ kind: 'behaviour', id: 'comet-tail' }], perRank: [{ kind: 'behaviour', id: 'comet-tail' }],
  },
  // ── The Frozen Sea ──
  {
    id: 'leviathan-scale', name: 'Leviathan Scale', icon: 'fish-scales',
    text: 'Knockback pushes 50% farther; heavy enemies are pushed as if light.',
    source: { kind: 'boss', boss: 'leviathan' },
    effects: [{ kind: 'behaviour', id: 'leviathan' }], perRank: [{ kind: 'behaviour', id: 'leviathan' }],
  },
  {
    id: 'skate-blade', name: 'Skate Blade', icon: 'ice-spear',
    text: 'Enemies you knock back take +25% damage for 2 s.',
    source: { kind: 'elite', region: 11 },
    effects: [{ kind: 'behaviour', id: 'skate-blade' }], perRank: [{ kind: 'behaviour', id: 'skate-blade' }],
  },
  {
    id: 'floe-shard', name: 'Floe Shard', icon: 'frozen-orb',
    text: 'Enemies slain while slowed chill those near them by 30%.',
    source: { kind: 'elite', region: 11 },
    effects: [{ kind: 'behaviour', id: 'floe-shard' }], perRank: [{ kind: 'behaviour', id: 'floe-shard' }],
  },
  {
    id: 'anchor-chain', name: 'Anchor Chain', icon: 'crossed-chains',
    text: '+20% Max HP.',
    source: { kind: 'elite', region: 11 },
    effects: [{ kind: 'stat', mod: { key: 'maxHp', pct: 0.2 } }], perRank: [{ kind: 'stat', mod: { key: 'maxHp', pct: 0.1 } }],
  },
  // ── Giants' Rest ──
  {
    id: 'colossus-heart', name: 'Colossus Heart', icon: 'heart-organ',
    text: '+30% damage against enemies above half their health.',
    source: { kind: 'boss', boss: 'colossus' },
    effects: [{ kind: 'behaviour', id: 'colossus' }], perRank: [{ kind: 'behaviour', id: 'colossus' }],
  },
  {
    id: 'tick-bite', name: 'Tick Bite', icon: 'bone-gnawer',
    text: 'A crit marks its enemy: marked enemies take +15% damage.',
    source: { kind: 'elite', region: 12 },
    effects: [{ kind: 'behaviour', id: 'tick-bite' }], perRank: [{ kind: 'behaviour', id: 'tick-bite' }],
  },
  {
    id: 'herd-bell', name: 'Herd Bell', icon: 'cow',
    text: 'Large enemies pay 30% more shards.',
    source: { kind: 'elite', region: 12 },
    effects: [{ kind: 'behaviour', id: 'herd-bell' }], perRank: [{ kind: 'behaviour', id: 'herd-bell' }],
  },
  {
    id: 'giants-toe', name: "Giant's Toe", icon: 'foot-plaster',
    text: 'Sunlance keeps half its heat-up when it turns to a new target.',
    source: { kind: 'elite', region: 12 },
    effects: [{ kind: 'behaviour', id: 'giants-toe' }], perRank: [{ kind: 'behaviour', id: 'giants-toe' }],
  },
  // ── Stormcrown ──
  {
    id: 'thunderhead-core', name: 'Thunderhead Core', icon: 'lightning-dome',
    text: 'Every 10 s, lightning strikes the toughest non-boss enemy for 5% of its health.',
    source: { kind: 'boss', boss: 'thunderhead' },
    effects: [{ kind: 'behaviour', id: 'thunder-core' }], perRank: [{ kind: 'behaviour', id: 'thunder-core' }],
  },
  {
    id: 'lightning-rod', name: 'Lightning Rod', icon: 'lightning-helix',
    text: 'Chain Lightning leaps to one more enemy.',
    source: { kind: 'elite', region: 13 },
    effects: [{ kind: 'behaviour', id: 'extra-leap' }], perRank: [{ kind: 'behaviour', id: 'extra-leap' }],
  },
  {
    id: 'grounding-wire', name: 'Grounding Wire', icon: 'plug',
    text: 'The tower takes 30% less from lightning and hostile shots.',
    source: { kind: 'elite', region: 13 },
    effects: [{ kind: 'behaviour', id: 'grounding' }], perRank: [{ kind: 'behaviour', id: 'grounding' }],
  },
  {
    id: 'static-charge', name: 'Static Charge', icon: 'static',
    text: 'Every 20 crits charge the ultimate by 1%.',
    source: { kind: 'elite', region: 13 },
    effects: [{ kind: 'behaviour', id: 'static' }], perRank: [{ kind: 'behaviour', id: 'static' }],
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
  // Cursed relics (plans/late-game/03): their own file, spread in so lookups and banking just work.
  ...CURSED_RELICS,
  // Secrets (plans/late-game/05): a boss's other form drops it. No silhouette until owned.
  {
    id: 'lens-shard', name: 'Lens Shard', icon: 'crystal-shine',
    text: 'Beams and chains hit bosses 15% harder.',
    source: { kind: 'secret' },
    effects: [{ kind: 'behaviour', id: 'lens-shard' }], perRank: [{ kind: 'behaviour', id: 'lens-shard' }],
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

/**
 * Relic sets (N6): wear all three of a region's elite relics for its bonus.
 * Each leans on its region's verb; each rank past I adds 5% damage.
 */
export const RELIC_SETS: readonly RelicSetDef[] = [
  {
    id: 'fields-set', name: 'Field Kit', icon: 'level-end-flag', region: 1,
    text: 'Critical hits knock enemies back.',
    effects: [{ kind: 'behaviour', id: 'set-fields' }], perRank: [{ kind: 'stat', mod: { key: 'damage', pct: 0.05 } }],
  },
  {
    id: 'mire-set', name: 'Mire Lore', icon: 'droplets', region: 2,
    text: 'Splitter fragments die to any blast, pulse or burn.',
    effects: [{ kind: 'behaviour', id: 'set-mire' }], perRank: [{ kind: 'stat', mod: { key: 'damage', pct: 0.05 } }],
  },
  {
    id: 'wastes-set', name: 'Glasswright', icon: 'crystal-shine', region: 3,
    text: 'Burrowers surface twice as far out.',
    effects: [{ kind: 'behaviour', id: 'set-wastes' }], perRank: [{ kind: 'stat', mod: { key: 'damage', pct: 0.05 } }],
  },
  {
    id: 'rift-set', name: 'Rift Warden', icon: 'fire-bowl', region: 4,
    text: 'Bombers slain short of the wall leave fire that burns their pack.',
    effects: [{ kind: 'behaviour', id: 'set-rift' }], perRank: [{ kind: 'stat', mod: { key: 'damage', pct: 0.05 } }],
  },
  {
    id: 'hollow-set', name: 'Gravewatch', icon: 'eclipse', region: 5,
    text: 'Risen shades pay full shards and XP.',
    effects: [{ kind: 'behaviour', id: 'set-hollow' }], perRank: [{ kind: 'stat', mod: { key: 'damage', pct: 0.05 } }],
  },
  {
    id: 'blight-set', name: 'Blightbane', icon: 'glass-heart', region: 6,
    text: 'Each elite slain restores 5% of Max HP.',
    effects: [{ kind: 'behaviour', id: 'set-blight' }], perRank: [{ kind: 'stat', mod: { key: 'damage', pct: 0.05 } }],
  },
];

/** The set a relic belongs to (N6): its region's, for an elite relic; null for a boss's or the Abyss's. */
export function setOf(id: RelicId): RelicSetDef | null {
  const s = RELIC_BY_ID[id].source;
  return s.kind === 'elite' ? RELIC_SETS.find((x) => x.region === s.region) ?? null : null;
}
