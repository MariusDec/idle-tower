import type { BossId, RelicDef, RelicId } from './types';

/**
 * Relics v1 (§5.3, §11.5): four per region, the boss's first-kill relic and
 * three its elites drop. Qualitative, 15 words or fewer, each leaning on a
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
];

export const RELIC_BY_ID: Readonly<Record<RelicId, RelicDef>> = Object.fromEntries(
  RELICS.map((r) => [r.id, r]),
) as Record<RelicId, RelicDef>;

/** The relics a region's elites drop (§5.3). */
export function eliteRelics(region: number): RelicId[] {
  return RELICS.filter((r) => r.source.kind === 'elite' && r.source.region === region).map((r) => r.id);
}

/** A boss's first-kill relic (§5.3), if it has one. */
export function bossRelic(boss: BossId): RelicId | null {
  return RELICS.find((r) => r.source.kind === 'boss' && r.source.boss === boss)?.id ?? null;
}
