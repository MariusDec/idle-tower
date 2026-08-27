# Passive Abilities — Full Redesign

**Goal:** turn the eight-item passive list into a twelve-item, milestone-tracked permanent progression layer that (a) actually moves the tower's numbers, (b) costs real gold, (c) takes real XP that scales with the wave the passive unlocks at, and (d) survives an Ascension but is wiped by a Transcendence.

**Status:** implementation plan. Every constant below is a literal to type in as-is. Every formula is written out. Nothing here needs a design decision from the implementer.

**Files touched**

| File | What changes |
|---|---|
| `src/data/passiveAbilities.ts` | rewritten — new stat union, new def shape, new 12-entry table, cost/XP helpers |
| `src/data/xpTables.ts` | passive XP curve replaced; `passiveXpForLevel` re-signed; `passiveXpPerKill` replaced |
| `src/data/milestones.ts` | passive milestone `detail` copy uses the formatter |
| `src/types.ts` | `PassiveAbilityId` union rewritten; `PanelTab` gains `'passives'` |
| `src/stats/keys.ts` | adds `reviveCharges`; adds clamps for `executeThreshold` and `armor` |
| `src/stats/context.ts` | `passives` typing unchanged (widened union follows automatically) |
| `src/stats/contributors/passives.ts` | rewritten — full exhaustive switch over the new stat union |
| `src/systems/PassiveAbilityManager.ts` | rewritten |
| `src/systems/SaveManager.ts` | `SAVE_VERSION` 17 → 18, `migrateV17toV18`, offline XP grant, snapshot unchanged |
| `src/game/Game.ts` | XP call sites, revive charges, transcendence reset, stat context, passive API, tab wiring |
| `src/ui/PassivePanel.ts` | rewritten as the real panel (it is currently dead code) |
| `src/ui/AbilityPanel.ts` | all passive code deleted (sub-tabs go away) |
| `src/ui/UIManager.ts` | `passives` becomes a top-level tab; badge routing moves |
| `src/ui/navGroups.ts` | `passives` added to the Build group |
| `src/ui/TranscendencePanel.ts` | copy fix (passives no longer carry over) |
| `src/styles/main.css` | passive panel CSS replaced and extended |
| `tests/content-coverage.test.ts` | count 8 → 12 + new invariants |
| `tests/stats.test.ts` | passive stat names updated |
| `sim/checks.ts` | §2.5 rewritten |
| `docs/passive-system.md` | rewritten |

---

## 1. Measured diagnosis

Reproduced by driving the shipping tables through the game's own arithmetic.

### 1.1 XP outruns the curve, worse the later the unlock

`passiveXpForLevel(level) = 75 * level^1.9` — **identical for every passive** — while `passiveXpPerKill(def, wave) = def.xpPerKill * (1 + 0.20 * wave) * 0.25` scales with the *current* wave.

| Passive | unlock wave | XP/kill at unlock | kills in that wave | XP for Lv1 | waves to Lv1 |
|---|---:|---:|---:|---:|---:|
| Marksmanship | 10 | 0.75 → 1 (floor) | 16 | 75 | ~4 |
| Life Steal | 65 | 3.5 | 82 | 75 | **0.3** |

`passive_life_steal` unlocks at wave 65 and reaches level 8–10 inside its first wave. That is the reported bug, exactly.

### 1.2 Gold is not a cost

`passiveUpgradeCost = base * growth^level`, base 200–500, growth 1.5–1.9. A wave-65 wave pays ~15 000 gold at the depth those passives unlock. Level 0→1 of Life Steal costs 500 — 3% of one wave. And the cost is then discounted by banked XP, which §1.1 shows arrives instantly, so the *effective* price is usually near zero.

### 1.3 The effects are small and two of them are wrong

- `passive_thorns_aura` writes `a.add('thorns', value)` where `value` is a **percent** (3 at Lv0), but `thorns` is consumed as a **fraction** of the attacker's damage (`EnemyManager.tick`: `Math.floor(e.damage * this.thorns)`). Level 0 reflects **300%**, not 3%.
- `passive_life_steal` has the same defect: `lifesteal` is consumed as a fraction (`Game.ts:814` — `p.amount * ls`), so Lv0 heals for **100%** of every hit landed.
- The other six are one flat percentage each on a stat that upgrades, research, prestige, talents, equipment and blessings all already move.

### 1.4 The panel is a sub-tab of a sub-tab

`PassivePanel.ts` exports a class **nothing constructs** — only its `PassiveAPIDeps` interface is imported. The live rendering is a duplicated copy inside `AbilityPanel.ts`, reached through a sub-tab. Twelve passives with milestone tracks do not fit there.

### 1.5 Two live bugs in the wiring

1. `Game.ts:3272` passes `highestWave: this.state.wave.highestWave` — a **number captured once** at wire-up, never a getter. The panel's wave gate is frozen at whatever it was when the game booted.
2. `bus.emit('passive_leveled', …)` has **no listener anywhere**. Levelling a passive produces no feedback at all.

### 1.6 Persistence is the opposite of what is wanted

`applySavedStateReset` deliberately does *not* wipe passives (ascension keeps them — correct) and `applyFullTranscendenceReset` does not wipe them either (transcendence keeps them — **wrong**, per this plan's goal).

---

## 2. The design

**Five rules.**

1. **One passive = one identity, not one stat.** Each has a scaling headline effect *plus* five milestone ranks at levels 5/10/15/20/25 that graft on a second, qualitatively different stat.
2. **XP requirement is pinned to the unlock wave's own XP faucet.** Level 1 of *every* passive costs exactly `PASSIVE_XP_LEVEL_WAVES` waves of play *at its unlock wave*. A wave-88 passive is not faster than a wave-5 one; it is the same, measured in waves.
3. **Gold cost is pinned to the unlock wave's own gold faucet.** Level 0→1 costs `PASSIVE_GOLD_LEVEL_WAVES` waves of income at the unlock wave, and doubles every level.
4. **The two tracks blend, they do not compete.** XP fills the bar; a full bar levels for free; gold buys the *remainder* of the bar at a pro-rata price. This is the existing model — it is good — and only the numbers change.
5. **Passives are character progression inside one transcendence cycle.** They survive Ascension; a Transcendence wipes them.

**Shape:** 12 passives × 25 levels, 4 families of 3–4.

---

## 3. `src/data/xpTables.ts` — the passive XP curve

### 3.1 Delete

Delete `passiveXpPerKill` (the `def.xpPerKill * killXpWaveScale(wave) * 0.25` version) and the deprecated `passiveXpForLevel(level: number)` at the bottom of the file. Leave `abilityXpForLevel` alone.

### 3.2 Add

Add at the top of the file:

```ts
import { enemyCountForWave } from './formulas';
```

(`formulas.ts` imports nothing, so there is no cycle.)

Add this block, replacing the deleted functions:

```ts
// ── Passive-ability XP (passives redesign §3) ───────────────────────────────
//
// The requirement curve is anchored to the *unlock wave's own faucet*, which is
// the whole fix: before this, every passive shared one flat requirement table
// while the faucet grew with the live wave, so a passive that unlocked at wave
// 65 finished ten levels inside its first wave. `passiveWaveXpRef` is the XP one
// ordinary wave at depth `w` pays out, and `def.xpBase` is six of those — so
// level 1 of every passive costs six waves of play at the depth it unlocks.

/** Per-kill scale factor. Kept at 1 so the numbers in the tables read directly. */
export const PASSIVE_KILL_XP_FACTOR = 1;

/** A wave clear is worth this many kills' worth of passive XP. */
export const PASSIVE_WAVE_CLEAR_XP_MULTIPLIER = 12;

/** Passive XP a single kill of `type` at depth `wave` pays. */
export function passiveXpPerKill(type: EnemyType, wave: number): number {
  return KILL_XP_WEIGHT[type] * killXpWaveScale(wave) * PASSIVE_KILL_XP_FACTOR;
}

/** Passive XP clearing wave `wave` pays, on top of the kills in it. */
export function passiveXpPerWaveClear(wave: number): number {
  return killXpWaveScale(wave) * PASSIVE_KILL_XP_FACTOR * PASSIVE_WAVE_CLEAR_XP_MULTIPLIER;
}

/**
 * Passive XP one ordinary (non-boss) wave at depth `w` is expected to pay.
 *
 * Reference quantity only — nothing awards it. It exists so `xpBase` in the
 * passive table can be quoted in *waves of play* rather than as a magic number,
 * and so a test can assert the two have not drifted apart.
 */
export function passiveWaveXpRef(wave: number): number {
  return (enemyCountForWave(wave) + PASSIVE_WAVE_CLEAR_XP_MULTIPLIER)
    * killXpWaveScale(wave)
    * PASSIVE_KILL_XP_FACTOR;
}

/** Waves of play at the unlock wave that level 1 of a passive is priced at. */
export const PASSIVE_XP_LEVEL_WAVES = 6;

/** Requirement curve exponents. Polynomial for shape, geometric for the tail. */
export const PASSIVE_XP_POLY = 1.5;
export const PASSIVE_XP_GEO = 1.10;

/**
 * XP to go from `level - 1` to `level`, for a passive with the given `xpBase`.
 *
 *   xpBase * level^1.5 * 1.10^(level-1)
 *
 * `xpBase` is `round2sig(PASSIVE_XP_LEVEL_WAVES * passiveWaveXpRef(unlockWave))`
 * and is a literal in the passive table.
 */
export function passiveXpForLevel(def: { xpBase: number }, level: number): number {
  if (level <= 0) return 0;
  return Math.round(
    def.xpBase * Math.pow(level, PASSIVE_XP_POLY) * Math.pow(PASSIVE_XP_GEO, level - 1),
  );
}
```

`KILL_XP_WEIGHT`, `killXpWaveScale` and `EnemyType` are already in the file.

### 3.3 Resulting requirement table (reference — do not type this in)

XP to go from L−1 to L:

| L | Marksmanship (xpBase 250) | Executioner (3 400) | Siege Doctrine (10 000) |
|---:|---:|---:|---:|
| 1 | 250 | 3 400 | 10 000 |
| 2 | 778 | 10 583 | 31 113 |
| 3 | 1 571 | 21 366 | 62 842 |
| 5 | 4 090 | 55 621 | 163 592 |
| 10 | 18 649 | 253 622 | 745 950 |
| 15 | 55 154 | 750 099 | 2 206 174 |
| 20 | 136 776 | 1 860 155 | 5 471 044 |
| 25 | 307 799 | 4 186 067 | 12 311 963 |

Cumulative XP to *reach* a level:

| L | Marksmanship | Fortitude | Scavenger | Haste | Mana Spring | Retribution | Executioner | Treasury | Aegis Ward | Arcane Focus | Siege | Prospector |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 250 | 490 | 730 | 1.0 K | 1.5 K | 2.1 K | 3.4 K | 4.6 K | 6.4 K | 7.8 K | 10.0 K | 14.0 K |
| 5 | 9.4 K | 18.3 K | 27.3 K | 37.4 K | 56.1 K | 78.6 K | 127.2 K | 172.1 K | 239.5 K | 291.8 K | 374.2 K | 523.8 K |
| 10 | 67.6 K | 132.5 K | 197.4 K | 270.4 K | 405.6 K | 567.9 K | 919.5 K | 1.24 M | 1.73 M | 2.11 M | 2.70 M | 3.79 M |
| 15 | 258.1 K | 505.8 K | 753.5 K | 1.03 M | 1.55 M | 2.17 M | 3.51 M | 4.75 M | 6.61 M | 8.05 M | 10.32 M | 14.45 M |
| 20 | 753.8 K | 1.48 M | 2.20 M | 3.02 M | 4.52 M | 6.33 M | 10.25 M | 13.87 M | 19.30 M | 23.52 M | 30.15 M | 42.21 M |
| 25 | 1.90 M | 3.73 M | 5.55 M | 7.61 M | 11.41 M | 15.98 M | 25.87 M | 35.00 M | 48.69 M | 59.34 M | 76.08 M | 106.51 M |

Passive XP earned in one full run, for scale: **5.1 K** to wave 31, **104 K** to wave 100, **324 K** to wave 150, **734 K** to wave 200, **1.24 M** to wave 240.

---

## 4. `src/data/passiveAbilities.ts` — full rewrite

Replace the entire file with the following. It is written out in full because every literal matters.

### 4.1 Header, stat union and def shape

```ts
import type { PassiveAbilityId } from '../types';
import type { IconId } from './icons';
import { passiveXpForLevel } from './xpTables';

/**
 * Stats a passive may grant.
 *
 * Closed on purpose: `stats/contributors/passives.ts` switches over it with a
 * `never` default, so a stat nothing consumes is a compile error rather than a
 * milestone rank that silently does nothing. Values are **percent** unless the
 * name ends in `_flat`, in which case they are the consumer's own raw unit.
 */
export type PassiveStat =
  // ── offense ──
  | 'damage_pct'
  | 'fire_rate_pct'
  | 'crit_chance_pct'
  | 'crit_damage_pct'
  | 'armor_pen_pct'
  | 'armor_pen_flat'
  | 'pierce_flat'
  | 'double_shot_chance_pct'
  | 'extra_projectile_chance_pct'
  | 'execute_threshold_pct'
  | 'execute_damage_multiplier_pct'
  | 'instant_kill_chance_pct'
  | 'boss_damage_pct'
  | 'overwatch_damage_pct'
  | 'splash_radius_flat'
  | 'splash_fraction_pct'
  // ── defense ──
  | 'max_hp_pct'
  | 'armor_flat_pct'
  | 'lifesteal_pct'
  | 'thorns_pct'
  | 'dodge_chance_pct'
  | 'knockback_pct'
  | 'wall_fraction_pct'
  | 'shield_charges_flat'
  | 'shield_recharge_pct'
  | 'mana_shield_pct'
  | 'second_wind_pct'
  | 'revive_charges_flat'
  // ── economy ──
  | 'gold_mult_pct'
  | 'double_gold_chance_pct'
  | 'orb_value_pct'
  | 'equipment_find_chance_pct'
  | 'upgrade_cost_reduction_pct'
  | 'interest_pct'
  | 'windfall_mult_flat'
  | 'auto_buy_speed_pct'
  | 'xp_gain_pct'
  | 'rp_drop_chance_pct'
  | 'momentum_gain_pct'
  // ── arcana ──
  | 'mana_regen_pct'
  | 'max_mana_flat'
  | 'max_mana_pct'
  | 'mana_on_kill_pct'
  | 'ability_damage_pct'
  | 'ability_cooldown_pct'
  | 'ability_cost_pct'
  | 'magic_proc_chance_pct'
  | 'buff_duration_pct'
  | 'ability_echo_chance_pct';

export const PASSIVE_STATS: readonly PassiveStat[] = [
  'damage_pct', 'fire_rate_pct', 'crit_chance_pct', 'crit_damage_pct',
  'armor_pen_pct', 'armor_pen_flat', 'pierce_flat', 'double_shot_chance_pct',
  'extra_projectile_chance_pct', 'execute_threshold_pct',
  'execute_damage_multiplier_pct', 'instant_kill_chance_pct', 'boss_damage_pct',
  'overwatch_damage_pct', 'splash_radius_flat', 'splash_fraction_pct',
  'max_hp_pct', 'armor_flat_pct', 'lifesteal_pct', 'thorns_pct',
  'dodge_chance_pct', 'knockback_pct', 'wall_fraction_pct',
  'shield_charges_flat', 'shield_recharge_pct', 'mana_shield_pct',
  'second_wind_pct', 'revive_charges_flat',
  'gold_mult_pct', 'double_gold_chance_pct', 'orb_value_pct',
  'equipment_find_chance_pct', 'upgrade_cost_reduction_pct', 'interest_pct',
  'windfall_mult_flat', 'auto_buy_speed_pct', 'xp_gain_pct',
  'rp_drop_chance_pct', 'momentum_gain_pct',
  'mana_regen_pct', 'max_mana_flat', 'max_mana_pct', 'mana_on_kill_pct',
  'ability_damage_pct', 'ability_cooldown_pct', 'ability_cost_pct',
  'magic_proc_chance_pct', 'buff_duration_pct', 'ability_echo_chance_pct',
] as const;

/** The four thematic groups the panel renders as sections. */
export type PassiveFamily = 'warfare' | 'aegis' | 'avarice' | 'attunement';

export const PASSIVE_FAMILIES: readonly { id: PassiveFamily; label: string; color: string }[] = [
  { id: 'warfare',    label: 'Warfare',    color: '#ff8b46' },
  { id: 'aegis',      label: 'Aegis',      color: '#4ec97a' },
  { id: 'avarice',    label: 'Avarice',    color: '#f0b23c' },
  { id: 'attunement', label: 'Attunement', color: '#a95cff' },
];

/** One scaling line: `base + perLevel * level`, in the stat's own unit. */
export interface PassiveEffect {
  stat: PassiveStat;
  base: number;
  perLevel: number;
}

/**
 * A milestone rank. Granted in full the moment `level >= at`, and never scales
 * again — that is what makes hitting one an event rather than a rounding.
 */
export interface PassiveMilestone {
  at: number;
  /** Panel copy, e.g. "+6% crit chance". */
  label: string;
  grants: readonly { stat: PassiveStat; value: number }[];
}

/** Every passive has ranks at exactly these levels. */
export const PASSIVE_MILESTONE_LEVELS: readonly number[] = [5, 10, 15, 20, 25];

/** Every passive caps here. */
export const PASSIVE_MAX_LEVEL = 25;

export interface PassiveAbilityDef {
  id: PassiveAbilityId;
  name: string;
  family: PassiveFamily;
  /** One-line identity, shown under the name. Never contains a number. */
  tagline: string;
  /** Scaling lines. `describePassiveEffects` renders these. */
  effects: readonly PassiveEffect[];
  milestones: readonly PassiveMilestone[];
  /** Minimum *lifetime* highest wave before the unlock button appears. */
  unlockWave: number;
  /** Gold to unlock. `round2sig(6 * waveGoldRef(unlockWave))`. */
  unlockGoldCost: number;
  /** Gold for level 0→1. `round2sig(4 * waveGoldRef(unlockWave))`. */
  upgradeBaseCost: number;
  /** XP for level 1. `round2sig(6 * passiveWaveXpRef(unlockWave))`. */
  xpBase: number;
  icon: IconId;
  color: string;
}
```

`maxLevel` is **not** a per-def field any more — every passive uses `PASSIVE_MAX_LEVEL`.

### 4.2 The cost curve

```ts
/**
 * Gold cost doubles every level.
 *
 * 2.0 rather than the old 1.5–1.9 because the *economy* itself grows ~1.11x per
 * wave: any growth below ~1.11^7 makes a level cheaper, in waves-of-income, the
 * deeper the player is. At 2.0 a level costs roughly one extra wave of depth
 * than the one before it, forever.
 */
export const PASSIVE_COST_GROWTH = 2.0;

/** Gold to go from `level` to `level + 1`. */
export function passiveUpgradeCost(def: PassiveAbilityDef, level: number): number {
  if (level < 0) return def.upgradeBaseCost;
  return Math.floor(def.upgradeBaseCost * Math.pow(PASSIVE_COST_GROWTH, level));
}
```

The literals in the table were produced from `waveGoldRef(w) = 20 * 1.11^w`, which is a fit to the balance simulator's measured §2.1 wave-gold column (58 g at wave 10, 2.6 K at 50, 579 K at 99). **Do not add `waveGoldRef` to the codebase** — the fitted numbers are baked into `unlockGoldCost` / `upgradeBaseCost` so the table stays readable and hand-tunable.

### 4.3 Effect and milestone helpers

```ts
/** Total value of `stat` this passive contributes at `level`, 0 if it grants none. */
export function passiveStatValue(
  def: PassiveAbilityDef,
  stat: PassiveStat,
  level: number,
): number {
  let total = 0;
  for (const e of def.effects) {
    if (e.stat === stat) total += e.base + e.perLevel * level;
  }
  for (const m of def.milestones) {
    if (level < m.at) continue;
    for (const g of m.grants) {
      if (g.stat === stat) total += g.value;
    }
  }
  return total;
}

/** The next milestone above `level`, or null when all five are taken. */
export function nextPassiveMilestone(
  def: PassiveAbilityDef,
  level: number,
): PassiveMilestone | null {
  for (const m of def.milestones) if (level < m.at) return m;
  return null;
}

/** Display unit for a stat: how one raw value is written in the panel. */
export function formatPassiveStat(stat: PassiveStat, value: number): string {
  const n = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
  switch (stat) {
    case 'armor_pen_flat':      return `+${n(value)} flat armour ignored`;
    case 'pierce_flat':         return `+${n(value)} pierce`;
    case 'splash_radius_flat':  return `+${n(value)} splash radius`;
    case 'shield_charges_flat': return `+${n(value)} shield charge`;
    case 'revive_charges_flat': return `+${n(value)} revive per run`;
    case 'windfall_mult_flat':  return `+${n(value)}x windfall chest`;
    case 'max_mana_flat':       return `+${n(value)} max mana`;
    default:                    return `+${n(value)}% ${PASSIVE_STAT_LABELS[stat]}`;
  }
}

/** Short noun for each stat, used by `formatPassiveStat`. */
export const PASSIVE_STAT_LABELS: Record<PassiveStat, string> = {
  damage_pct: 'tower damage',
  fire_rate_pct: 'fire rate',
  crit_chance_pct: 'crit chance',
  crit_damage_pct: 'crit damage',
  armor_pen_pct: 'armour penetration',
  armor_pen_flat: 'flat armour ignored',
  pierce_flat: 'pierce',
  double_shot_chance_pct: 'double-shot chance',
  extra_projectile_chance_pct: 'extra-projectile chance',
  execute_threshold_pct: 'execute threshold',
  execute_damage_multiplier_pct: 'execute damage',
  instant_kill_chance_pct: 'instant-kill chance',
  boss_damage_pct: 'boss damage',
  overwatch_damage_pct: 'damage at long range',
  splash_radius_flat: 'splash radius',
  splash_fraction_pct: 'splash damage',
  max_hp_pct: 'max HP',
  armor_flat_pct: 'damage reduction',
  lifesteal_pct: 'life steal',
  thorns_pct: 'damage reflected',
  dodge_chance_pct: 'dodge chance',
  knockback_pct: 'knockback',
  wall_fraction_pct: 'wall HP (of max HP)',
  shield_charges_flat: 'shield charges',
  shield_recharge_pct: 'faster shield recharge',
  mana_shield_pct: 'damage absorbed by mana',
  second_wind_pct: 'Second Wind power',
  revive_charges_flat: 'revives per run',
  gold_mult_pct: 'gold earned',
  double_gold_chance_pct: 'double-gold chance',
  orb_value_pct: 'loot orb value',
  equipment_find_chance_pct: 'equipment find chance',
  upgrade_cost_reduction_pct: 'cheaper tower upgrades',
  interest_pct: 'interest on banked gold',
  windfall_mult_flat: 'windfall chest',
  auto_buy_speed_pct: 'auto-buy speed',
  xp_gain_pct: 'XP gain',
  rp_drop_chance_pct: 'research point drop chance',
  momentum_gain_pct: 'momentum gain',
  mana_regen_pct: 'mana regen',
  max_mana_flat: 'max mana',
  max_mana_pct: 'max mana',
  mana_on_kill_pct: 'max mana per kill',
  ability_damage_pct: 'ability damage',
  ability_cooldown_pct: 'shorter ability cooldowns',
  ability_cost_pct: 'cheaper abilities',
  magic_proc_chance_pct: 'magic proc chance',
  buff_duration_pct: 'buff duration',
  ability_echo_chance_pct: 'ability echo chance',
};

/** Live effect lines for a passive at `level`, one string per active stat. */
export function describePassiveEffects(def: PassiveAbilityDef, level: number): string[] {
  const seen: PassiveStat[] = [];
  for (const e of def.effects) if (!seen.includes(e.stat)) seen.push(e.stat);
  for (const m of def.milestones) {
    if (level < m.at) continue;
    for (const g of m.grants) if (!seen.includes(g.stat)) seen.push(g.stat);
  }
  return seen
    .map(s => ({ s, v: passiveStatValue(def, s, level) }))
    .filter(x => x.v !== 0)
    .map(x => formatPassiveStat(x.s, x.v));
}
```

Re-export for callers that only need the level-1 XP number:

```ts
export function passiveXpToNextLevel(def: PassiveAbilityDef, level: number): number {
  if (level >= PASSIVE_MAX_LEVEL) return 0;
  return passiveXpForLevel(def, level + 1);
}
```

### 4.4 The table

```ts
export const PASSIVE_ABILITIES: PassiveAbilityDef[] = [
  // ─────────────────────────── Warfare ───────────────────────────
  {
    id: 'passive_marksmanship',
    name: 'Marksmanship',
    family: 'warfare',
    tagline: 'Every shot hits harder.',
    icon: 'bullseye',
    color: '#ff8b46',
    unlockWave: 5,
    unlockGoldCost: 200,
    upgradeBaseCost: 130,
    xpBase: 250,
    effects: [{ stat: 'damage_pct', base: 8, perLevel: 4 }],
    milestones: [
      { at: 5,  label: '+8% armour penetration', grants: [{ stat: 'armor_pen_pct', value: 8 }] },
      { at: 10, label: '+6% crit chance',        grants: [{ stat: 'crit_chance_pct', value: 6 }] },
      { at: 15, label: '+1 pierce',              grants: [{ stat: 'pierce_flat', value: 1 }] },
      { at: 20, label: '+60% crit damage',       grants: [{ stat: 'crit_damage_pct', value: 60 }] },
      { at: 25, label: '+40% tower damage',      grants: [{ stat: 'damage_pct', value: 40 }] },
    ],
  },
  {
    id: 'passive_haste',
    name: 'Haste',
    family: 'warfare',
    tagline: 'More shots in the air.',
    icon: 'wingfoot',
    color: '#ffc879',
    unlockWave: 18,
    unlockGoldCost: 790,
    upgradeBaseCost: 520,
    xpBase: 1000,
    effects: [{ stat: 'fire_rate_pct', base: 6, perLevel: 3 }],
    milestones: [
      { at: 5,  label: '+8% double-shot chance',      grants: [{ stat: 'double_shot_chance_pct', value: 8 }] },
      { at: 10, label: '+10% extra-projectile chance', grants: [{ stat: 'extra_projectile_chance_pct', value: 10 }] },
      { at: 15, label: '+15% fire rate',               grants: [{ stat: 'fire_rate_pct', value: 15 }] },
      { at: 20, label: '+12% double-shot chance',      grants: [{ stat: 'double_shot_chance_pct', value: 12 }] },
      { at: 25, label: '+25% fire rate',               grants: [{ stat: 'fire_rate_pct', value: 25 }] },
    ],
  },
  {
    id: 'passive_executioner',
    name: 'Executioner',
    family: 'warfare',
    tagline: 'Finish what the volley started.',
    icon: 'guillotine',
    color: '#d9534f',
    unlockWave: 40,
    unlockGoldCost: 7800,
    upgradeBaseCost: 5200,
    xpBase: 3400,
    effects: [
      { stat: 'execute_threshold_pct', base: 3, perLevel: 0.4 },
      { stat: 'execute_damage_multiplier_pct', base: 40, perLevel: 4 },
    ],
    milestones: [
      { at: 5,  label: '+10% boss damage',        grants: [{ stat: 'boss_damage_pct', value: 10 }] },
      { at: 10, label: '+0.8% instant-kill chance', grants: [{ stat: 'instant_kill_chance_pct', value: 0.8 }] },
      { at: 15, label: '+50% execute damage',     grants: [{ stat: 'execute_damage_multiplier_pct', value: 50 }] },
      { at: 20, label: '+10% armour penetration', grants: [{ stat: 'armor_pen_pct', value: 10 }] },
      { at: 25, label: '+5% execute threshold',   grants: [{ stat: 'execute_threshold_pct', value: 5 }] },
    ],
  },
  {
    id: 'passive_siege_doctrine',
    name: 'Siege Doctrine',
    family: 'warfare',
    tagline: 'Built for the things that do not die.',
    icon: 'catapult',
    color: '#ffa96f',
    unlockWave: 75,
    unlockGoldCost: 300000,
    upgradeBaseCost: 200000,
    xpBase: 10000,
    effects: [{ stat: 'boss_damage_pct', base: 10, perLevel: 4 }],
    milestones: [
      { at: 5,  label: '+6 flat armour ignored', grants: [{ stat: 'armor_pen_flat', value: 6 }] },
      { at: 10, label: 'Shots splash',           grants: [
        { stat: 'splash_radius_flat', value: 60 },
        { stat: 'splash_fraction_pct', value: 15 },
      ] },
      { at: 15, label: '+20% boss damage',        grants: [{ stat: 'boss_damage_pct', value: 20 }] },
      { at: 20, label: '+12% armour penetration', grants: [{ stat: 'armor_pen_pct', value: 12 }] },
      { at: 25, label: '+25% damage at long range', grants: [{ stat: 'overwatch_damage_pct', value: 25 }] },
    ],
  },

  // ──────────────────────────── Aegis ────────────────────────────
  {
    id: 'passive_fortitude',
    name: 'Fortitude',
    family: 'aegis',
    tagline: 'The tower simply refuses to fall.',
    icon: 'health-increase',
    color: '#4ec97a',
    unlockWave: 10,
    unlockGoldCost: 340,
    upgradeBaseCost: 230,
    xpBase: 490,
    effects: [{ stat: 'max_hp_pct', base: 10, perLevel: 5 }],
    milestones: [
      { at: 5,  label: '+1.5% life steal',      grants: [{ stat: 'lifesteal_pct', value: 1.5 }] },
      { at: 10, label: '+6% damage reduction',  grants: [{ stat: 'armor_flat_pct', value: 6 }] },
      { at: 15, label: '+25% max HP',           grants: [{ stat: 'max_hp_pct', value: 25 }] },
      { at: 20, label: '+1 revive per run',     grants: [{ stat: 'revive_charges_flat', value: 1 }] },
      { at: 25, label: '+25% Second Wind power', grants: [{ stat: 'second_wind_pct', value: 25 }] },
    ],
  },
  {
    id: 'passive_retribution',
    name: 'Retribution',
    family: 'aegis',
    tagline: 'Touching the tower costs them.',
    icon: 'spiked-halo',
    color: '#79d2ff',
    unlockWave: 30,
    unlockGoldCost: 2700,
    upgradeBaseCost: 1800,
    xpBase: 2100,
    effects: [{ stat: 'thorns_pct', base: 8, perLevel: 2 }],
    milestones: [
      { at: 5,  label: '+5% dodge chance',      grants: [{ stat: 'dodge_chance_pct', value: 5 }] },
      { at: 10, label: '+50% knockback',        grants: [{ stat: 'knockback_pct', value: 50 }] },
      { at: 15, label: '+15% damage reflected', grants: [{ stat: 'thorns_pct', value: 15 }] },
      { at: 20, label: '+15% wall HP',          grants: [{ stat: 'wall_fraction_pct', value: 15 }] },
      { at: 25, label: '+10% dodge chance',     grants: [{ stat: 'dodge_chance_pct', value: 10 }] },
    ],
  },
  {
    id: 'passive_aegis_ward',
    name: 'Aegis Ward',
    family: 'aegis',
    tagline: 'Mana takes the hit the tower cannot.',
    icon: 'magic-shield',
    color: '#4a9eff',
    unlockWave: 58,
    unlockGoldCost: 51000,
    upgradeBaseCost: 34000,
    xpBase: 6400,
    effects: [{ stat: 'mana_shield_pct', base: 4, perLevel: 1.2 }],
    milestones: [
      { at: 5,  label: '+1 shield charge',           grants: [{ stat: 'shield_charges_flat', value: 1 }] },
      { at: 10, label: '+20% faster shield recharge', grants: [{ stat: 'shield_recharge_pct', value: 20 }] },
      { at: 15, label: '+25% max mana',              grants: [{ stat: 'max_mana_pct', value: 25 }] },
      { at: 20, label: '+1 shield charge',           grants: [{ stat: 'shield_charges_flat', value: 1 }] },
      { at: 25, label: '+12% damage absorbed by mana', grants: [{ stat: 'mana_shield_pct', value: 12 }] },
    ],
  },

  // ─────────────────────────── Avarice ───────────────────────────
  {
    id: 'passive_scavenger',
    name: 'Scavenger',
    family: 'avarice',
    tagline: 'Nothing dies without paying.',
    icon: 'gold-nuggets',
    color: '#f0b23c',
    unlockWave: 14,
    unlockGoldCost: 520,
    upgradeBaseCost: 340,
    xpBase: 730,
    effects: [{ stat: 'gold_mult_pct', base: 10, perLevel: 5 }],
    milestones: [
      { at: 5,  label: '+6% double-gold chance',      grants: [{ stat: 'double_gold_chance_pct', value: 6 }] },
      { at: 10, label: '+25% loot orb value',         grants: [{ stat: 'orb_value_pct', value: 25 }] },
      { at: 15, label: '+25% gold earned',            grants: [{ stat: 'gold_mult_pct', value: 25 }] },
      { at: 20, label: '+5% equipment find chance',   grants: [{ stat: 'equipment_find_chance_pct', value: 5 }] },
      { at: 25, label: '+12% double-gold chance',     grants: [{ stat: 'double_gold_chance_pct', value: 12 }] },
    ],
  },
  {
    id: 'passive_treasury',
    name: 'Treasury',
    family: 'avarice',
    tagline: 'Gold you keep is gold you earned twice.',
    icon: 'money-stack',
    color: '#ffdf9a',
    unlockWave: 48,
    unlockGoldCost: 18000,
    upgradeBaseCost: 12000,
    xpBase: 4600,
    effects: [{ stat: 'upgrade_cost_reduction_pct', base: 1, perLevel: 0.4 }],
    milestones: [
      { at: 5,  label: '+1% interest on banked gold', grants: [{ stat: 'interest_pct', value: 1 }] },
      { at: 10, label: '+2x windfall chest',          grants: [{ stat: 'windfall_mult_flat', value: 2 }] },
      { at: 15, label: '+4% cheaper tower upgrades',  grants: [{ stat: 'upgrade_cost_reduction_pct', value: 4 }] },
      { at: 20, label: '+25% auto-buy speed',         grants: [{ stat: 'auto_buy_speed_pct', value: 25 }] },
      { at: 25, label: '+2% interest on banked gold', grants: [{ stat: 'interest_pct', value: 2 }] },
    ],
  },
  {
    id: 'passive_prospector',
    name: 'Prospector',
    family: 'avarice',
    tagline: 'You learn more from every wave than anyone else.',
    icon: 'treasure-map',
    color: '#c08cff',
    unlockWave: 88,
    unlockGoldCost: 1200000,
    upgradeBaseCost: 780000,
    xpBase: 14000,
    effects: [{ stat: 'xp_gain_pct', base: 8, perLevel: 4 }],
    milestones: [
      { at: 5,  label: '+3% research point drop chance', grants: [{ stat: 'rp_drop_chance_pct', value: 3 }] },
      { at: 10, label: '+6% equipment find chance',      grants: [{ stat: 'equipment_find_chance_pct', value: 6 }] },
      { at: 15, label: '+30% loot orb value',            grants: [{ stat: 'orb_value_pct', value: 30 }] },
      { at: 20, label: '+50% momentum gain',             grants: [{ stat: 'momentum_gain_pct', value: 50 }] },
      { at: 25, label: '+6% research point drop chance', grants: [{ stat: 'rp_drop_chance_pct', value: 6 }] },
    ],
  },

  // ────────────────────────── Attunement ─────────────────────────
  {
    id: 'passive_mana_spring',
    name: 'Mana Spring',
    family: 'attunement',
    tagline: 'The well never runs dry.',
    icon: 'fountain',
    color: '#7f6cff',
    unlockWave: 24,
    unlockGoldCost: 1500,
    upgradeBaseCost: 980,
    xpBase: 1500,
    effects: [{ stat: 'mana_regen_pct', base: 10, perLevel: 6 }],
    milestones: [
      { at: 5,  label: '+40 max mana',            grants: [{ stat: 'max_mana_flat', value: 40 }] },
      { at: 10, label: '+0.4% max mana per kill', grants: [{ stat: 'mana_on_kill_pct', value: 0.4 }] },
      { at: 15, label: '+10% cheaper abilities',  grants: [{ stat: 'ability_cost_pct', value: 10 }] },
      { at: 20, label: '+30% max mana',           grants: [{ stat: 'max_mana_pct', value: 30 }] },
      { at: 25, label: '+0.8% max mana per kill', grants: [{ stat: 'mana_on_kill_pct', value: 0.8 }] },
    ],
  },
  {
    id: 'passive_arcane_focus',
    name: 'Arcane Focus',
    family: 'attunement',
    tagline: 'Spells land like siege engines.',
    icon: 'wizard-staff',
    color: '#a95cff',
    unlockWave: 65,
    unlockGoldCost: 110000,
    upgradeBaseCost: 71000,
    xpBase: 7800,
    effects: [{ stat: 'ability_damage_pct', base: 10, perLevel: 4 }],
    milestones: [
      { at: 5,  label: '+8% shorter ability cooldowns', grants: [{ stat: 'ability_cooldown_pct', value: 8 }] },
      { at: 10, label: '+5% magic proc chance',         grants: [{ stat: 'magic_proc_chance_pct', value: 5 }] },
      { at: 15, label: '+25% buff duration',            grants: [{ stat: 'buff_duration_pct', value: 25 }] },
      { at: 20, label: '+8% ability echo chance',       grants: [{ stat: 'ability_echo_chance_pct', value: 8 }] },
      { at: 25, label: '+30% ability damage',           grants: [{ stat: 'ability_damage_pct', value: 30 }] },
    ],
  },
];

export const PASSIVE_BY_ID: Record<string, PassiveAbilityDef> = PASSIVE_ABILITIES.reduce(
  (acc, a) => { acc[a.id] = a; return acc; },
  {} as Record<string, PassiveAbilityDef>,
);
```

### 4.5 Gold cost reference (do not type this in)

Cumulative gold to *reach* a level, at `PASSIVE_COST_GROWTH = 2.0`:

| L | Marksmanship | Fortitude | Scavenger | Haste | Mana Spring | Retribution | Executioner | Treasury | Aegis Ward | Arcane Focus | Siege | Prospector |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 130 | 230 | 340 | 520 | 980 | 1.8 K | 5.2 K | 12 K | 34 K | 71 K | 200 K | 780 K |
| 5 | 4.0 K | 7.1 K | 10.5 K | 16.1 K | 30.4 K | 55.8 K | 161 K | 372 K | 1.05 M | 2.20 M | 6.20 M | 24.2 M |
| 10 | 133 K | 235 K | 348 K | 532 K | 1.00 M | 1.84 M | 5.32 M | 12.3 M | 34.8 M | 72.6 M | 205 M | 798 M |
| 15 | 4.26 M | 7.54 M | 11.1 M | 17.0 M | 32.1 M | 59.0 M | 170 M | 393 M | 1.11 G | 2.33 G | 6.55 G | 25.6 G |
| 20 | 136 M | 241 M | 357 M | 545 M | 1.03 G | 1.89 G | 5.45 G | 12.6 G | 35.7 G | 74.5 G | 210 G | 818 G |
| 25 | 4.36 G | 7.72 G | 11.4 G | 17.5 G | 32.9 G | 60.4 G | 174 G | 403 G | 1.14 T | 2.38 T | 6.71 T | 26.2 T |

Gold earned in one full run, for scale: **4.9 K** to wave 31, **106 K** to wave 60, **6.87 M** to wave 100, **1.27 G** to wave 150, **234 G** to wave 200, **15.2 T** to wave 240.

Read together with §3.3: the two tracks stay within an order of magnitude of each other across the whole range, which is what makes the XP discount meaningful rather than decorative.

---

## 5. `src/types.ts`

Replace the id union:

```ts
export type PassiveAbilityId =
  | 'passive_marksmanship' | 'passive_haste' | 'passive_executioner'
  | 'passive_siege_doctrine'
  | 'passive_fortitude' | 'passive_retribution' | 'passive_aegis_ward'
  | 'passive_scavenger' | 'passive_treasury' | 'passive_prospector'
  | 'passive_mana_spring' | 'passive_arcane_focus';
```

`PassiveAbilityState` is unchanged (`{ level, xp, unlocked }`).

Update the `PanelTab` union (line 71) to include `'passives'`:

```ts
export type PanelTab = 'upgrades' | 'research' | 'abilities' | 'passives' | 'prestige'
  | 'transcendence' | 'achievements' | 'progression' | 'stats' | 'settings'
  | 'talents' | 'equipment';
```

Update the `GameState.passiveAbilities` doc comment (line 761) to:
`/** v6+: Passive ability XP and levels. Survives Ascension; wiped by Transcendence. */`

---

## 6. `src/stats/keys.ts`

### 6.1 New key

Add to the `StatKey` union, in the `tower: defense` group after `wallRegen`:

```ts
  /**
   * Extra times the tower may come back from 0 HP in one run (passives §7).
   *
   * Additive on top of the `revive` evolution's single charge. Integer, because
   * half a revive is not a thing `Game.applyTowerDamage` can spend.
   */
  | 'reviveCharges'
```

Add to `STAT_BASES` in the same group: `reviveCharges: 0,`

Add to `STAT_CLAMPS`: `reviveCharges: { min: 0, integer: true },`

### 6.2 Two clamps that are now load-bearing

`executeThreshold` gains a ceiling — the transcendence perk already adds a flat 0.25 and Executioner adds up to 0.18 on top:

```ts
  executeThreshold: { min: 0, max: 0.5 },
```

`armor` gains a ceiling — it is consumed as `raw * (1 - ts.armor)`, so an uncapped stack is literal invulnerability:

```ts
  armor: { min: 0, max: 0.75 },
```

(Replace the existing `armor: { min: 0 },` line.)

---

## 7. `src/stats/contributors/passives.ts` — full rewrite

Replace the whole file:

```ts
import { PASSIVE_STATS } from '../../data/passiveAbilities';
import type { StatAccumulator } from '../accumulator';
import type { StatContext } from '../context';

/**
 * Passive abilities.
 *
 * Values arrive as **percent** (a `damage_pct` of 40 means +40%), except the
 * `_flat` stats, which arrive in the consumer's own raw unit. Two conversions
 * that were wrong before this rewrite are worth naming: `thorns` and
 * `lifesteal` are consumed as *fractions* (`e.damage * thorns`,
 * `hitAmount * lifesteal`), so the old `a.add('thorns', value)` reflected 300%
 * of every hit at level 0. Both now divide by 100 like everything else.
 *
 * The `never` default is the guard: a stat added to `PASSIVE_STATS` without a
 * case here does not compile.
 */
export function contributePassives(ctx: StatContext, acc: StatAccumulator): void {
  const a = acc.source('passive', 'Passives');
  for (const stat of PASSIVE_STATS) {
    const value = ctx.passives[stat] ?? 0;
    if (value === 0) continue;
    switch (stat) {
      // ── offense ──
      case 'damage_pct':                  a.mult('baseDamage', 1 + value / 100); break;
      case 'fire_rate_pct':               a.mult('fireRate', 1 + value / 100); break;
      case 'crit_chance_pct':             a.add('critChance', value / 100); break;
      case 'crit_damage_pct':             a.add('critMultiplier', value / 100); break;
      case 'armor_pen_pct':               a.add('armorPen', value / 100); break;
      case 'armor_pen_flat':              a.add('armorPenFlat', value); break;
      case 'pierce_flat':                 a.add('pierceExtra', Math.floor(value)); break;
      case 'double_shot_chance_pct':      a.add('doubleShotChance', value / 100); break;
      case 'extra_projectile_chance_pct': a.add('extraProjectileChance', value / 100); break;
      case 'execute_threshold_pct':       a.add('executeThreshold', value / 100); break;
      case 'execute_damage_multiplier_pct': a.add('executeMultiplier', value / 100); break;
      case 'instant_kill_chance_pct':     a.add('instantKillChance', value / 100); break;
      case 'boss_damage_pct':             a.add('bossDamageBonus', value / 100); break;
      case 'overwatch_damage_pct':        a.add('overwatchDamage', value / 100); break;
      case 'splash_radius_flat':          a.add('shotSplashRadius', value); break;
      case 'splash_fraction_pct':         a.add('shotSplashFraction', value / 100); break;

      // ── defense ──
      case 'max_hp_pct':                  a.mult('maxHp', 1 + value / 100); break;
      case 'armor_flat_pct':              a.add('armor', value / 100); break;
      case 'lifesteal_pct':               a.add('lifesteal', value / 100); break;
      case 'thorns_pct':                  a.add('thorns', value / 100); break;
      case 'dodge_chance_pct':            a.add('dodgeChance', value / 100); break;
      case 'knockback_pct':               a.mult('knockbackForce', 1 + value / 100); break;
      case 'wall_fraction_pct':           a.add('wallFraction', value / 100); break;
      case 'shield_charges_flat':         a.add('shieldMaxCharges', Math.floor(value)); break;
      case 'shield_recharge_pct':         a.add('shieldRechargeReduction', value / 100); break;
      case 'mana_shield_pct':             a.add('manaShieldFraction', value / 100); break;
      case 'second_wind_pct':             a.add('secondWindPower', value / 100); break;
      case 'revive_charges_flat':         a.add('reviveCharges', Math.floor(value)); break;

      // ── economy ──
      case 'gold_mult_pct':               a.mult('goldMultiplier', 1 + value / 100); break;
      case 'double_gold_chance_pct':      a.add('doubleGoldChance', value / 100); break;
      case 'orb_value_pct':               a.add('orbValueBonus', value / 100); break;
      case 'equipment_find_chance_pct':   a.add('equipmentFindChance', value / 100); break;
      // Negative: `UpgradeManager.getCost` multiplies by `1 + costDiscount`.
      case 'upgrade_cost_reduction_pct':  a.add('upgradeCostDiscount', -value / 100); break;
      case 'interest_pct':                a.add('interestRate', value / 100); break;
      case 'windfall_mult_flat':          a.add('windfallMultiplier', value); break;
      case 'auto_buy_speed_pct':          a.add('autoBuyIntervalReduction', value / 100); break;
      case 'xp_gain_pct':                 a.mult('xpGainMultiplier', 1 + value / 100); break;
      case 'rp_drop_chance_pct':          a.add('rpDropChanceBonus', value / 100); break;
      case 'momentum_gain_pct':           a.add('momentumGainBonus', value / 100); break;

      // ── arcana ──
      case 'mana_regen_pct':              a.mult('manaRegen', 1 + value / 100); break;
      case 'max_mana_flat':               a.add('maxMana', value); break;
      case 'max_mana_pct':                a.mult('maxMana', 1 + value / 100); break;
      case 'mana_on_kill_pct':            a.add('manaOnKillFraction', value / 100); break;
      case 'ability_damage_pct':          a.mult('abilityDamageMultiplier', 1 + value / 100); break;
      case 'ability_cooldown_pct':        a.mult('abilityCooldownMultiplier', 1 - value / 100); break;
      case 'ability_cost_pct':            a.mult('abilityCostMultiplier', 1 - value / 100); break;
      case 'magic_proc_chance_pct':       a.add('magicProcChance', value / 100); break;
      case 'buff_duration_pct':           a.add('buffDurationBonus', value / 100); break;
      case 'ability_echo_chance_pct':     a.add('abilityEchoChance', value / 100); break;

      default: {
        const exhaustive: never = stat;
        void exhaustive;
      }
    }
  }
}
```

`src/stats/context.ts` needs **no edit** — `passives: Readonly<Partial<Record<PassiveStat, number>>>` widens automatically.

---

## 8. `src/systems/PassiveAbilityManager.ts` — full rewrite

```ts
import type { EnemyType, PassiveAbilityState } from '../types';
import {
  PASSIVE_ABILITIES,
  PASSIVE_BY_ID,
  PASSIVE_MAX_LEVEL,
  PASSIVE_STATS,
  passiveStatValue,
  passiveUpgradeCost,
  type PassiveAbilityDef,
  type PassiveStat,
} from '../data/passiveAbilities';
import { passiveXpForLevel, passiveXpPerKill, passiveXpPerWaveClear } from '../data/xpTables';
import { EventBus } from '../game/EventBus';

/**
 * The passive-ability track.
 *
 * Two currencies, one bar. XP fills it and a full bar levels for free; gold
 * buys whatever fraction of the bar is still empty, at a pro-rata price. Both
 * curves are anchored to the passive's own `unlockWave` (see `xpTables.ts` §3
 * and `passiveAbilities.ts` §4.2), which is the fix for the old system's
 * headline defect: one shared XP table against a faucet that grew with the live
 * wave meant a late passive gained ten levels inside its first wave.
 */
export class PassiveAbilityManager {
  private state: Record<string, PassiveAbilityState>;
  private readonly bus: EventBus;
  /** Fed from `applyResolvedStats`, so Prospector and the combo tier count. */
  private xpGainMultiplier = 1;
  /** Recomputed on any level/unlock change; read once per stat recompute. */
  private statCache: Partial<Record<PassiveStat, number>> | null = null;

  constructor(state: Record<string, PassiveAbilityState>, bus: EventBus) {
    this.state = state;
    this.bus = bus;
  }

  ensureInitialized(): void {
    for (const def of PASSIVE_ABILITIES) {
      const s = this.state[def.id];
      if (!s) {
        this.state[def.id] = { level: 0, xp: 0, unlocked: false };
      } else {
        if (s.unlocked === undefined) s.unlocked = false;
        s.level = Math.max(0, Math.min(PASSIVE_MAX_LEVEL, Math.floor(s.level ?? 0)));
        s.xp = Math.max(0, s.xp ?? 0);
      }
    }
    // Ids that no longer exist (an old save, a renamed passive) are dropped so
    // they cannot sit in the save forever contributing nothing.
    for (const id of Object.keys(this.state)) {
      if (!PASSIVE_BY_ID[id]) delete this.state[id];
    }
    this.statCache = null;
  }

  setXpGainMultiplier(mult: number): void {
    this.xpGainMultiplier = Math.max(0, mult);
  }

  addKillXp(type: EnemyType, wave: number): void {
    const amount = passiveXpPerKill(type, wave) * this.xpGainMultiplier;
    this.grantAll(amount);
  }

  addWaveClearXp(wave: number): void {
    const amount = passiveXpPerWaveClear(wave) * this.xpGainMultiplier;
    this.grantAll(amount);
  }

  /** Offline catch-up: raw XP already scaled by the caller. */
  addRawXp(amount: number): void {
    this.grantAll(amount);
  }

  private grantAll(amount: number): void {
    if (!(amount > 0)) return;
    for (const def of PASSIVE_ABILITIES) {
      const s = this.state[def.id];
      if (!s || !s.unlocked || s.level >= PASSIVE_MAX_LEVEL) continue;
      s.xp += amount;
      this.checkLevelUp(def, s);
    }
  }

  private checkLevelUp(def: PassiveAbilityDef, state: PassiveAbilityState): void {
    while (state.level < PASSIVE_MAX_LEVEL) {
      const needed = passiveXpForLevel(def, state.level + 1);
      if (needed <= 0 || state.xp < needed) break;
      state.xp -= needed;
      state.level += 1;
      this.onLeveled(def, state.level, 'xp');
    }
    if (state.level >= PASSIVE_MAX_LEVEL) state.xp = 0;
  }

  private onLeveled(def: PassiveAbilityDef, level: number, via: 'xp' | 'gold'): void {
    this.statCache = null;
    const milestone = def.milestones.find(m => m.at === level) ?? null;
    this.bus.emit('passive_leveled', {
      id: def.id,
      name: def.name,
      level,
      via,
      maxed: level >= PASSIVE_MAX_LEVEL,
      milestone: milestone ? { at: milestone.at, label: milestone.label } : null,
    });
  }

  /** Summed contribution of every unlocked passive to every stat. */
  getStatTotals(): Readonly<Partial<Record<PassiveStat, number>>> {
    if (this.statCache) return this.statCache;
    const out: Partial<Record<PassiveStat, number>> = {};
    for (const def of PASSIVE_ABILITIES) {
      const s = this.state[def.id];
      // Unlocking costs gold, so it must *do* something immediately: every
      // effect's `base` is the level-0 value and applies the moment it unlocks.
      if (!s || !s.unlocked) continue;
      for (const stat of PASSIVE_STATS) {
        const v = passiveStatValue(def, stat, s.level);
        if (v !== 0) out[stat] = (out[stat] ?? 0) + v;
      }
    }
    this.statCache = out;
    return out;
  }

  getLevel(id: string): number { return this.state[id]?.level ?? 0; }
  getXp(id: string): number { return this.state[id]?.xp ?? 0; }
  isUnlocked(id: string): boolean { return this.state[id]?.unlocked ?? false; }

  isMaxed(id: string): boolean {
    const s = this.state[id];
    return s ? s.level >= PASSIVE_MAX_LEVEL : false;
  }

  /** XP needed for the next level, or 0 at max. */
  getXpForNextLevel(id: string): number {
    const def = PASSIVE_BY_ID[id];
    const s = this.state[id];
    if (!def || !s || s.level >= PASSIVE_MAX_LEVEL) return 0;
    return passiveXpForLevel(def, s.level + 1);
  }

  /** Count of unlocked passives, for the panel header. */
  get unlockedCount(): number {
    let n = 0;
    for (const def of PASSIVE_ABILITIES) if (this.state[def.id]?.unlocked) n += 1;
    return n;
  }

  /** Sum of every passive's level, for the panel header. */
  get totalLevels(): number {
    let n = 0;
    for (const def of PASSIVE_ABILITIES) n += this.state[def.id]?.level ?? 0;
    return n;
  }

  canUnlock(id: string, lifetimeHighestWave: number): boolean {
    const s = this.state[id];
    const def = PASSIVE_BY_ID[id];
    if (!s || !def || s.unlocked) return false;
    return lifetimeHighestWave >= def.unlockWave;
  }

  getUnlockCost(id: string): number {
    return PASSIVE_BY_ID[id]?.unlockGoldCost ?? 0;
  }

  unlock(id: string): void {
    const s = this.state[id];
    if (!s || s.unlocked) return;
    s.unlocked = true;
    this.statCache = null;
  }

  /** Undiscounted price of the next level. */
  getFullUpgradeCost(id: string): number {
    const def = PASSIVE_BY_ID[id];
    const s = this.state[id];
    if (!def || !s || !s.unlocked || s.level >= PASSIVE_MAX_LEVEL) return 0;
    return passiveUpgradeCost(def, s.level);
  }

  /** Fraction of the next level already paid for by banked XP, 0..1. */
  getXpDiscount(id: string): number {
    const needed = this.getXpForNextLevel(id);
    if (needed <= 0) return 0;
    return Math.min(1, (this.state[id]?.xp ?? 0) / needed);
  }

  /** Price actually charged: the full price times the empty part of the bar. */
  getUpgradeCost(id: string): number {
    const full = this.getFullUpgradeCost(id);
    if (full <= 0) return 0;
    return Math.max(1, Math.floor(full * (1 - this.getXpDiscount(id))));
  }

  canUpgrade(id: string, gold: number): boolean {
    const cost = this.getUpgradeCost(id);
    return cost > 0 && gold >= cost;
  }

  /** Buys the next level. Returns the gold spent, or 0 if it could not. */
  upgrade(id: string): number {
    const def = PASSIVE_BY_ID[id];
    const s = this.state[id];
    if (!def || !s || !s.unlocked || s.level >= PASSIVE_MAX_LEVEL) return 0;
    const cost = this.getUpgradeCost(id);
    if (cost <= 0) return 0;
    s.level += 1;
    // Banked XP was spent as the discount, so it does not roll over.
    s.xp = 0;
    this.onLeveled(def, s.level, 'gold');
    return cost;
  }

  /** Transcendence only. Ascension leaves passives alone. */
  reset(): void {
    for (const key of Object.keys(this.state)) delete this.state[key];
    this.ensureInitialized();
  }
}
```

---

## 9. `src/game/Game.ts` — every edit

### 9.1 Imports

Replace

```ts
import { PASSIVE_STATS, PASSIVE_ABILITIES, type PassiveStat } from '../data/passiveAbilities';
```

with

```ts
import { PASSIVE_ABILITIES } from '../data/passiveAbilities';
```

(`buildStatContext` now copies the manager's cached totals wholesale; it no longer iterates `PASSIVE_STATS`.)

### 9.2 XP call sites

Line ~917, inside the `enemy_killed` handler:

```ts
      this.passiveMgr.addKillXp(e.type as EnemyType, this.waveMgr.currentWave);
```

Line ~1543, on wave clear:

```ts
      this.passiveMgr.addWaveClearXp(cleared);
```

(unchanged call, but the manager's signature is the same for this one).

### 9.3 Unlock gate becomes lifetime

Passives now survive Ascension, so gating the *unlock button* on the current run's `wave.highestWave` would hide a purchase the player has already earned. Three sites change from `this.state.wave.highestWave` to `this.state.stats.lifetimeHighestWave`:

- `unlockPassive` (line ~2300): `if (!this.passiveMgr.canUnlock(id, this.state.stats.lifetimeHighestWave)) return false;`
- the passive API's `canUnlock` (line ~3275)
- the passive API's `highestWave` (line ~3272) — **and it becomes a getter**, see §9.7.

`checkPassiveUnlocks(wave)` is unchanged: it fires on a wave advance, which is exactly when a lifetime record is set.

### 9.4 Revive charges

Rename the field (line ~600):

```ts
  /** Revives already spent this run (evolution charge + `reviveCharges`). */
  private revivesUsed = 0;
  /** Extra revives from passives, written by `applyResolvedStats`. */
  private extraReviveCharges = 0;
```

Replace the revive block at line ~1275:

```ts
        // Evolution: revive — one charge; passives add more (passives §7).
        const hasEvolutionRevive = this.upgradeMgr.hasEvolutionEffect('revive');
        const reviveCharges = (hasEvolutionRevive ? 1 : 0) + this.extraReviveCharges;
        if (this.revivesUsed < reviveCharges) {
          // Fortitude's revive restores half; the evolution's own fraction wins
          // when it is the charge being spent and is larger.
          const reviveFraction = hasEvolutionRevive
            ? Math.max(PASSIVE_REVIVE_FRACTION, this.upgradeMgr.getEvolutionEffectValue('revive'))
            : PASSIVE_REVIVE_FRACTION;
          ts.hp = Math.floor(ts.maxHp * reviveFraction);
          this.revivesUsed += 1;
          this.bus.emit('toast', {
            kind: 'milestone',
            text: `Revived at ${Math.round(reviveFraction * 100)}% HP. ${reviveCharges - this.revivesUsed} left.`,
            life: 4,
          });
          return;
        }
```

Add the constant near the other tuning constants at the top of `Game.ts`:

```ts
/** HP a passive-granted revive restores, as a fraction of max (passives §7). */
const PASSIVE_REVIVE_FRACTION = 0.5;
```

In `applySavedStateReset` (line ~3770) replace `this.reviveUsed = false;` with `this.revivesUsed = 0;`.

In `applyResolvedStats`, next to the other cached talent stats (after `this.manaOnKillFraction = …`):

```ts
    this.extraReviveCharges = stats.reviveCharges;
```

### 9.5 Passive XP gets the XP multiplier

In `applyResolvedStats`, immediately after `this.towerXpMgr.setXpGainMultiplier(stats.xpGainMultiplier);`:

```ts
    // Prospector and the combo tier accelerate the passive track too — the same
    // multiplier, so the two XP bars cannot drift apart.
    this.passiveMgr.setXpGainMultiplier(stats.xpGainMultiplier);
```

### 9.6 Stat context

Replace the passive block in `buildStatContext` (line ~3446):

```ts
    const passives = this.passiveMgr.getStatTotals();
```

(The `passives,` entry in the returned object is unchanged.)

### 9.7 The passive API

Replace the `setPassiveAPI` call (line ~3269):

```ts
    this.ui.setPassiveAPI({
      getLevel: (id) => this.passiveMgr.getLevel(id),
      getXp: (id) => this.passiveMgr.getXp(id),
      getXpForNextLevel: (id) => this.passiveMgr.getXpForNextLevel(id),
      // A getter, not a snapshot: the old code captured the number once at
      // wire-up, so the panel's wave gate never moved after boot.
      highestWave: () => this.state.stats.lifetimeHighestWave,
      unlockedCount: () => this.passiveMgr.unlockedCount,
      totalLevels: () => this.passiveMgr.totalLevels,
      isUnlocked: (id) => this.passiveMgr.isUnlocked(id),
      isMaxed: (id) => this.passiveMgr.isMaxed(id),
      canUnlock: (id) => this.passiveMgr.canUnlock(id, this.state.stats.lifetimeHighestWave),
      getUnlockCost: (id) => this.passiveMgr.getUnlockCost(id),
      onUnlock: (id) => this.unlockPassive(id),
      getFullUpgradeCost: (id) => this.passiveMgr.getFullUpgradeCost(id),
      getUpgradeCost: (id) => this.passiveMgr.getUpgradeCost(id),
      getXpDiscount: (id) => this.passiveMgr.getXpDiscount(id),
      canUpgrade: (id) => this.passiveMgr.canUpgrade(id, this.state.resources.gold),
      onUpgrade: (id) => this.upgradePassive(id),
    });
```

### 9.8 Transcendence wipes passives

In `applyFullTranscendenceReset()` (line ~4260), replace the "Passives and equipment are *character* progression" comment block with:

```ts
    // Passives are progression *inside* one transcendence cycle: they survive
    // every Ascension (that is what makes an ascension cheap to take) and are
    // wiped here, alongside the AP layer they were bought with. Equipment is
    // not — gear is a slow, low-drop-rate collection, and deleting it at the one
    // moment the player is asked to give everything else up made transcending
    // read as a punishment.
    this.applySavedStateReset();
    this.passiveMgr.reset();
```

Also update the transcendence toast at line ~2418:

```ts
      text: `Transcendence! +${tp} TP. Gear and talents carry over; passives reset.`,
```

### 9.9 Passive level-up feedback

`passive_leveled` currently has no listener. Add one in `UIManager`'s bus wiring (§12.4).

---

## 10. `src/systems/SaveManager.ts`

### 10.1 Version

`const SAVE_VERSION = 18;`

Extend the accepted-version check on line ~543 with `&& data.version !== 17` and add to the migration chain:

```ts
  if (data.version === 17) { migrateV17toV18(data); data.version = 18; }
```

### 10.2 The migration

```ts
/**
 * v18: the passive redesign.
 *
 * Every passive id, effect, cost curve and XP curve is new, and the level cap
 * dropped from 50/30 to 25. Nothing about an old entry survives translation —
 * a level 34 `passive_markmanship` (note the typo in the old id) means nothing
 * on the new table. Rather than silently keep meaningless levels, the whole
 * track is refunded: entries are cleared and `PassiveAbilityManager`
 * re-initialises them.
 *
 * The gold is not refunded, because there is no honest figure to refund — the
 * old prices were a rounding error next to the new ones (§1.2).
 */
function migrateV17toV18(data: Record<string, unknown>): void {
  data.passiveAbilities = {};
}
```

### 10.3 Offline passive XP

Replace the "Grant passive ability XP for each estimated wave cleared" block in `applyOfflineProgress` (line ~944) with:

```ts
    // Grant passive ability XP for each estimated wave cleared. Offline pays a
    // quarter rate — the same discount idle progress takes everywhere else —
    // and goes through the manager so the level-up rule stays in one place.
    if (result.wavesCleared > 0) {
      let wave = Math.max(1, state.wave.number);
      if (isBossWave(wave)) --wave;
      let xp = 0;
      for (let w = wave; w < wave + result.wavesCleared; w++) {
        const enemies = Math.max(1, Math.floor(spawnCountForWave(w)));
        xp += passiveXpPerKill('normal', w) * enemies + passiveXpPerWaveClear(w);
      }
      passives.addRawXp(xp * OFFLINE_PASSIVE_XP_RATE);
    }
```

Add near the other module constants:

```ts
/** Offline passive XP is paid at a quarter of the live rate. */
const OFFLINE_PASSIVE_XP_RATE = 0.25;
```

`applyOfflineProgress` does not currently have a `PassiveAbilityManager`. Give it one: change the signature to

```ts
  applyOfflineProgress(
    state: GameState,
    result: OfflineResult,
    passives: PassiveAbilityManager,
  ): void {
```

and update the single call site in `Game.ts` (search `applyOfflineProgress(`) to pass `this.passiveMgr`.

Imports in `SaveManager.ts`: drop `passiveXpForLevel` and `PASSIVE_ABILITIES`; add

```ts
import { passiveXpPerKill, passiveXpPerWaveClear } from '../data/xpTables';
import type { PassiveAbilityManager } from './PassiveAbilityManager';
```

`snapshotPassives` is unchanged.

---

## 11. `src/data/milestones.ts`

`passiveMilestones()` currently prints a raw gold number. Make it use the shared formatter so a 1.2 M unlock does not read as `1200000`:

```ts
import { formatInt } from '../utils/bigNumber';
…
    detail: `${p.tagline} Unlockable for ${formatInt(p.unlockGoldCost)} gold.`,
```

Everything else in the file is unchanged — `p.icon`, `p.color`, `p.unlockWave` and `p.name` all still exist.

---

## 12. UI

### 12.1 `src/ui/navGroups.ts`

Add a Passives tab to the Build group, after Abilities:

```ts
    tabs: [
      { id: 'upgrades', label: 'Upgrades' },
      { id: 'abilities', label: 'Abilities' },
      { id: 'passives', label: 'Passives' },
      { id: 'equipment', label: 'Equipment' },
    ],
```

### 12.2 `src/ui/AbilityPanel.ts` — remove all passive code

Delete, in order:

1. The imports `PASSIVE_ABILITIES, passiveEffectValue`, `passiveXpForLevel`, `PassiveAPIDeps`.
2. The `onPassivesViewed` field from `AbilityPanelHandlers`.
3. `type SubTab` and the fields `subTab`, `activeContentRoot`, `passiveContentRoot`, `subTabActiveBtn`, `subTabPassiveBtn`, `subTabPassiveBadge`, `passiveBadgeCount`, `passiveDeps`.
4. All seven `passive*` element maps and their `.clear()` calls in `mount`.
5. The `passiveDeps` constructor parameter and `setPassiveDeps`, `setPassiveBadge`, `switchSubTab`, `updatePassive`, `renderPassiveInto`, `renderPassiveRow`.
6. In `update(state)`: call `this.updateActive(state)` unconditionally.
7. In `renderInto(parent)`: delete the sub-tab bar construction and the `passiveContentRoot`; mount the active-ability content straight into `parent`.

The constructor becomes `constructor(handlers: AbilityPanelHandlers) { this.handlers = handlers; }`.

### 12.3 `src/ui/PassivePanel.ts` — full rewrite

This file currently exports a dead class. Replace the whole file.

```ts
import type { GameState } from '../types';
import {
  PASSIVE_ABILITIES,
  PASSIVE_FAMILIES,
  PASSIVE_MAX_LEVEL,
  PASSIVE_MILESTONE_LEVELS,
  describePassiveEffects,
  nextPassiveMilestone,
  type PassiveAbilityDef,
} from '../data/passiveAbilities';
import { formatInt } from '../utils/bigNumber';
import { setText, toggleClass, setStyle, setDisplay, setDisabled, setAriaLabel } from '../utils/dom';
import { renderIcon } from './Icon';

export interface PassiveAPIDeps {
  getLevel: (id: string) => number;
  getXp: (id: string) => number;
  getXpForNextLevel: (id: string) => number;
  /** Lifetime highest wave. A getter — the old snapshot never updated. */
  highestWave: () => number;
  unlockedCount: () => number;
  totalLevels: () => number;
  isUnlocked: (id: string) => boolean;
  isMaxed: (id: string) => boolean;
  canUnlock: (id: string) => boolean;
  getUnlockCost: (id: string) => number;
  onUnlock: (id: string) => void;
  getFullUpgradeCost: (id: string) => number;
  getUpgradeCost: (id: string) => number;
  getXpDiscount: (id: string) => number;
  canUpgrade: (id: string) => boolean;
  onUpgrade: (id: string) => void;
}
```

**Class shape.** One `Map` per updated element, keyed by passive id, exactly as `AbilityPanel` does today:

`cardEls`, `levelEls`, `effectEls`, `xpFillEls`, `xpTextEls`, `xpRowEls`, `milestoneRowEls`, `pipEls` (`Map<string, HTMLElement[]>`), `nextEls`, `actionBtnEls`, `discountEls`. Plus two header elements `headerCountEl`, `headerLevelsEl`.

**`mount(parent)`** clears every map, sets `parent.className = 'passive-panel'`, and renders:

```
<h2 class="panel-title">Passive Abilities</h2>
<p class="panel-note">…</p>          ← copy in §12.3.4
<div class="passive-summary">
  <div class="passive-summary-stat"><b id=count>0 / 12</b><span>Unlocked</span></div>
  <div class="passive-summary-stat"><b id=levels>0 / 300</b><span>Total levels</span></div>
</div>
<div class="passive-family" style="--family-color: …">   ← one per PASSIVE_FAMILIES
  <div class="passive-family-head"><span class="passive-family-dot"></span>Warfare</div>
  <div class="passive-grid">  … cards …  </div>
</div>
```

Filter each family's cards with `PASSIVE_ABILITIES.filter(p => p.family === family.id)`, in table order.

**`renderCard(def)`** builds:

```
<div class="passive-card" style="--passive-color: <def.color>">
  <div class="passive-card-head">
    <div class="passive-icon"><span class="passive-icon-inner">…</span></div>
    <div class="passive-title">
      <div class="passive-name-row">
        <span class="passive-name">Marksmanship</span>
        <span class="passive-level">Lv.0</span>
      </div>
      <div class="passive-tagline">Every shot hits harder.</div>
    </div>
  </div>
  <ul class="passive-effects"></ul>              ← rebuilt on change
  <div class="passive-track">
    <div class="passive-xp-bar"><div class="passive-xp-fill"></div></div>
    <div class="passive-xp-text"></div>
  </div>
  <div class="passive-milestones">               ← 5 pips
    <span class="passive-pip" data-at="5" title="+8% armour penetration"></span>
    … ×5 …
  </div>
  <div class="passive-next"></div>
  <div class="passive-action">
    <button class="passive-action-btn"></button>
    <span class="passive-discount"></span>
  </div>
</div>
```

Each pip gets `title` = the milestone's `label` and `setAriaLabel(pip, \`Level ${m.at}: ${m.label}\`)`.

The action button's click handler:

```ts
    actionBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.deps.isUnlocked(def.id)) this.deps.onUpgrade(def.id);
      else if (this.deps.canUnlock(def.id)) this.deps.onUnlock(def.id);
    });
```

**`update(state)`** — four states per card, in this order:

```ts
  update(state: GameState): void {
    if (!this.root) return;
    const wave = this.deps.highestWave();
    const gold = state.resources.gold;
    setText(this.headerCountEl, `${this.deps.unlockedCount()} / ${PASSIVE_ABILITIES.length}`);
    setText(this.headerLevelsEl,
      `${this.deps.totalLevels()} / ${PASSIVE_ABILITIES.length * PASSIVE_MAX_LEVEL}`);

    for (const def of PASSIVE_ABILITIES) {
      // …fetch every element from the maps, `continue` if any is missing…
      const gated = wave < def.unlockWave;
      const unlocked = this.deps.isUnlocked(def.id);
      const level = unlocked ? this.deps.getLevel(def.id) : 0;
      const maxed = level >= PASSIVE_MAX_LEVEL;

      toggleClass(card, 'is-gated', gated);
      toggleClass(card, 'is-locked', !unlocked && !gated);
      toggleClass(card, 'is-owned', unlocked);
      toggleClass(card, 'is-maxed', maxed);

      setText(levelEl, unlocked ? (maxed ? `Lv.${level} MAX` : `Lv.${level}`) : '—');

      // Effect lines. Rebuilt only when the level changed, so an idle panel
      // does no DOM work: `lastEffectLevel` is a Map<string, number> seeded at -1.
      if (this.lastEffectLevel.get(def.id) !== level || this.lastUnlocked.get(def.id) !== unlocked) {
        this.lastEffectLevel.set(def.id, level);
        this.lastUnlocked.set(def.id, unlocked);
        effectsEl.innerHTML = '';
        const lines = unlocked ? describePassiveEffects(def, level) : describePassiveEffects(def, 0);
        for (const line of lines) {
          const li = document.createElement('li');
          li.textContent = line;
          effectsEl.appendChild(li);
        }
        toggleClass(effectsEl, 'is-preview', !unlocked);
      }

      // Milestone pips.
      for (let i = 0; i < PASSIVE_MILESTONE_LEVELS.length; i++) {
        toggleClass(pips[i], 'is-earned', unlocked && level >= PASSIVE_MILESTONE_LEVELS[i]);
      }

      // XP track.
      if (!unlocked || maxed) {
        setDisplay(trackEl, 'none');
        setText(nextEl, maxed ? 'Fully mastered.' : `Unlocks at wave ${def.unlockWave}`);
      } else {
        setDisplay(trackEl, 'flex');
        const xp = this.deps.getXp(def.id);
        const needed = this.deps.getXpForNextLevel(def.id);
        const pct = needed > 0 ? Math.min(100, (xp / needed) * 100) : 0;
        setStyle(xpFill, 'width', `${pct.toFixed(1)}%`);
        setText(xpText, `${formatInt(xp)} / ${formatInt(needed)} XP`);
        const next = nextPassiveMilestone(def, level);
        setText(nextEl, next ? `Lv.${next.at}: ${next.label}` : 'All ranks earned.');
      }

      // Action row.
      if (gated) {
        setDisplay(actionRow, 'none');
      } else if (!unlocked) {
        setDisplay(actionRow, 'flex');
        const cost = this.deps.getUnlockCost(def.id);
        const afford = gold >= cost;
        setText(btn, `Unlock · ${formatInt(cost)}g`);
        setDisabled(btn, !afford);
        toggleClass(btn, 'can-afford', afford);
        toggleClass(btn, 'cannot-afford', !afford);
        setText(discountEl, '');
      } else if (maxed) {
        setDisplay(actionRow, 'none');
      } else {
        setDisplay(actionRow, 'flex');
        const cost = this.deps.getUpgradeCost(def.id);
        const full = this.deps.getFullUpgradeCost(def.id);
        const afford = gold >= cost;
        setText(btn, `Upgrade · ${formatInt(cost)}g`);
        setDisabled(btn, !afford);
        toggleClass(btn, 'can-afford', afford);
        toggleClass(btn, 'cannot-afford', !afford);
        const saved = full > 0 ? Math.round((1 - cost / full) * 100) : 0;
        setText(discountEl, saved > 0 ? `−${saved}% from banked XP` : '');
      }
    }
  }
```

**`flashLevelUp(id: string)`** — public, called by `UIManager` from the `passive_leveled` listener:

```ts
  flashLevelUp(id: string): void {
    const card = this.cardEls.get(id);
    if (!card) return;
    card.classList.remove('is-levelup');
    void card.offsetWidth;          // restart the animation
    card.classList.add('is-levelup');
    setTimeout(() => card.classList.remove('is-levelup'), 620);
  }
```

**§12.3.4 Panel note copy**

> Passives are permanent. XP from kills and wave clears fills the bar and levels them for free; gold buys whatever the bar has not filled yet, at a matching discount. Every fifth level grants a milestone rank. Passives survive Ascension and are reset by Transcendence.

### 12.4 `src/ui/UIManager.ts`

1. **Field + construction.** Add `private readonly passivePanel: PassivePanel;` and construct it next to `abilityPanel`: `this.passivePanel = new PassivePanel(this.passiveApi);`. `AbilityPanel`'s constructor loses its second argument.

2. **`passiveApi` default.** Replace the placeholder object (line ~276) with one matching the new `PassiveAPIDeps`: every getter returns 0 / false / 0, `highestWave: () => 0`, the two callbacks are no-ops.

3. **`setPassiveAPI`.** Replace the body with:

```ts
  setPassiveAPI(api: PassiveAPIDeps): void {
    this.passiveApi = api;
    this.passivePanel.setDeps(api);
    if (this.lastState && this.activeTab === 'passives') {
      this.passivePanel.update(this.lastState);
    }
  }
```

Add `setDeps(deps: PassiveAPIDeps): void { this.deps = deps; }` to `PassivePanel`.

4. **Badges.** `pushPassiveBadge()` now targets the new tab:

```ts
  private pushPassiveBadge(): void {
    this.passiveBadgeCount = this.pendingPassiveBadges.size;
    this.setTabBadge('passives', this.passiveBadgeCount);
  }
```

Delete every `this.abilityPanel.setPassiveBadge(...)` call (lines ~810, ~1490, ~1041, ~1081 and inside `showTab`/`mountMobileTab`). `onPassivesViewed` moves: it is now called from `showTab`/`mountMobileTab` when `id === 'passives'`.

5. **`showTab`.** Add a branch, mirroring `abilities`:

```ts
    } else if (id === 'passives') {
      this.passivePanel.mount(this.contentRoot);
      if (this.lastState) this.passivePanel.update(this.lastState);
      this.onPassivesViewed();
```

6. **`mountMobileTab`.** Add `case 'passives': this.passivePanel.mount(body); break;` to the mount switch and `case 'passives': this.passivePanel.update(this.lastState); break;` to the update switch, plus `if (tab === 'passives') this.onPassivesViewed();` next to the existing badge re-application lines.

7. **Per-frame update.** Add to the `activeTab` chain in the throttled update (line ~1266):

```ts
    } else if (this.activeTab === 'passives') {
      this.passivePanel.update(state);
```

8. **Level-up feedback.** Add a bus listener next to `ability_upgraded`:

```ts
    this.bus.on('passive_leveled', (payload: unknown) => {
      const p = payload as {
        id: string; name: string; level: number; maxed: boolean;
        milestone: { at: number; label: string } | null;
      };
      this.passivePanel.flashLevelUp(p.id);
      if (p.milestone) {
        this.bus.emit('toast', {
          kind: 'milestone',
          text: `${p.name} Lv.${p.level} — ${p.milestone.label}`,
          life: 4,
        });
      } else if (p.maxed) {
        this.bus.emit('toast', {
          kind: 'milestone',
          text: `${p.name} mastered! Lv.${p.level}`,
          life: 5,
        });
      } else {
        this.bus.emit('toast', { kind: 'info', text: `${p.name} → Lv.${p.level}`, life: 2 });
      }
    });
```

9. **`upgrades_changed`** (line ~591) currently refreshes the ability panel when gold moves. Add the passive panel:

```ts
      if (this.activeTab === 'passives') this.passivePanel.update(this.lastState);
```

### 12.5 `src/ui/TranscendencePanel.ts`

Line ~340, replace the trailing sentence:

```ts
    headHint.textContent = `Unlocks at ${TRANSCENDENCE_UNLOCK_AP} AP. Resets gold, upgrades, ability levels, passives and the whole ascension layer for permanent TP multipliers and automation. Talents, tower XP, research, achievements and equipment carry over.`;
```

---

## 13. `src/styles/main.css`

Replace the entire `/* Passive panel */` block (currently lines ~5161–5282) with the following. Also delete the now-orphaned `.ability-sub-tab-btn` / `.ability-passive-content` rules (search for `ability-passive-content` and `ability-sub-tab`), since `AbilityPanel` no longer has sub-tabs.

```css
/* Passive panel */
.passive-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-3);
  overflow-y: auto;
  overflow-x: hidden;
}

.passive-summary {
  display: flex;
  gap: var(--space-2);
}
.passive-summary-stat {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--space-2) var(--space-3);
  background: var(--surface-2);
  border: 1px solid var(--stroke-subtle);
  border-radius: var(--radius-lg);
}
.passive-summary-stat b {
  font-family: var(--font-display);
  font-size: var(--text-3xl);
  line-height: var(--leading-tight);
  color: var(--text-0);
}
.passive-summary-stat span {
  font-size: var(--text-2xs);
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
  color: var(--text-3);
}

.passive-family {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.passive-family-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-2xs);
  font-weight: var(--weight-semibold);
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
  color: var(--text-2);
}
.passive-family-dot {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-circle);
  background: var(--family-color);
  box-shadow: 0 0 8px var(--family-color);
}

.passive-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(268px, 1fr));
  gap: var(--space-2);
}

.passive-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  background: var(--surface-2);
  border: 1px solid var(--stroke-subtle);
  border-left: 3px solid var(--passive-color);
  border-radius: var(--radius-lg);
  box-shadow: var(--elev-1);
  transition: border-color var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out);
}
.passive-card.is-gated {
  opacity: 0.45;
  border-left-color: var(--stroke-subtle);
}
.passive-card.is-gated .passive-icon { filter: grayscale(1); }
.passive-card.is-locked {
  border-left-color: color-mix(in srgb, var(--passive-color) 55%, transparent);
}
.passive-card.is-maxed {
  border-color: color-mix(in srgb, var(--passive-color) 60%, var(--stroke-subtle));
  box-shadow: var(--elev-1), 0 0 0 1px color-mix(in srgb, var(--passive-color) 25%, transparent);
}

.passive-card-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.passive-icon {
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--passive-color) 18%, transparent);
}
.passive-icon-inner { line-height: 1; }
.passive-icon-inner > .icon { --icon-size: 26px; color: var(--passive-color); }

.passive-title { flex: 1 1 0; min-width: 0; }
.passive-name-row {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
}
.passive-name {
  flex: 1;
  min-width: 0;
  font-weight: var(--weight-semibold);
  color: var(--text-0);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.passive-level {
  font-family: var(--font-display);
  font-size: var(--text-xs);
  color: var(--text-1);
  padding: 1px 6px;
  background: var(--surface-3);
  border-radius: var(--radius-sm);
  white-space: nowrap;
}
.passive-card.is-maxed .passive-level {
  color: var(--text-on-fill);
  background: color-mix(in srgb, var(--passive-color) 55%, transparent);
}
.passive-tagline {
  font-size: var(--text-2xs);
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.passive-effects {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.passive-effects li {
  font-size: var(--text-sm);
  color: var(--text-1);
  padding-left: 10px;
  position: relative;
}
.passive-effects li::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0.55em;
  width: 4px;
  height: 4px;
  border-radius: var(--radius-circle);
  background: var(--passive-color);
}
/* Not yet owned: the same lines, shown as what the purchase would give. */
.passive-effects.is-preview li { color: var(--text-3); }

.passive-track {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.passive-xp-bar {
  flex: 1;
  height: 6px;
  background: var(--surface-sunken);
  border-radius: var(--radius-full);
  overflow: hidden;
}
.passive-xp-fill {
  height: 100%;
  width: 0;
  border-radius: var(--radius-full);
  background: linear-gradient(90deg, var(--fx-mana), var(--fx-arcane));
  transition: width var(--dur-fast) linear;
}
.passive-xp-text {
  font-size: var(--text-2xs);
  font-family: var(--font-display);
  color: var(--text-3);
  white-space: nowrap;
}

.passive-milestones {
  display: flex;
  align-items: center;
  gap: 6px;
}
.passive-pip {
  flex: 1;
  height: 4px;
  border-radius: var(--radius-full);
  background: var(--surface-sunken);
  border: 1px solid var(--stroke-subtle);
  cursor: help;
  transition: background var(--dur-base) var(--ease-out);
}
.passive-pip.is-earned {
  background: var(--passive-color);
  border-color: var(--passive-color);
  box-shadow: 0 0 6px color-mix(in srgb, var(--passive-color) 60%, transparent);
}

.passive-next {
  font-size: var(--text-2xs);
  color: var(--text-2);
  min-height: 1.2em;
}

.passive-action {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-top: auto;
}
.passive-action-btn {
  padding: 6px 12px;
  border: 1px solid var(--stroke-subtle);
  border-radius: var(--radius-lg);
  background: var(--surface-3);
  color: var(--text-0);
  cursor: pointer;
  font-size: var(--text-sm);
  white-space: nowrap;
}
.passive-action-btn:disabled { opacity: 0.5; cursor: default; }
.passive-action-btn.can-afford { border-color: var(--accent); color: var(--accent); }
.passive-action-btn.cannot-afford { border-color: var(--stroke-subtle); color: var(--text-3); }
.passive-discount {
  font-size: var(--text-2xs);
  color: var(--good);
  white-space: nowrap;
}

@media (pointer: fine) {
  .passive-action-btn:hover:not(:disabled) {
    background: var(--surface-4);
    border-color: var(--stroke-strong);
  }
  .passive-card:hover {
    border-color: color-mix(in srgb, var(--passive-color) 45%, var(--stroke-subtle));
    box-shadow: var(--elev-2);
  }
}

/* Level-up flourish. Triggered by PassivePanel.flashLevelUp. */
.passive-card.is-levelup { animation: passive-levelup var(--dur-slow) var(--ease-spring); }
@keyframes passive-levelup {
  0%   { box-shadow: var(--elev-1), 0 0 0 0 color-mix(in srgb, var(--passive-color) 70%, transparent); }
  35%  { box-shadow: var(--elev-2), 0 0 0 6px color-mix(in srgb, var(--passive-color) 35%, transparent); }
  100% { box-shadow: var(--elev-1), 0 0 0 0 rgba(0, 0, 0, 0); }
}

@media (prefers-reduced-motion: reduce) {
  .passive-card.is-levelup { animation: none; }
  .passive-xp-fill { transition: none; }
}

/* One column once the panel is narrower than two cards plus the gap. */
@media (max-width: 620px) {
  .passive-grid { grid-template-columns: 1fr; }
}
```

Also delete the stale line near 6849: `.passive-icon-inner > .icon { --icon-size: 28px; }` (superseded above).

---

## 14. Tests

### 14.1 `tests/content-coverage.test.ts`

- `expect(PASSIVE_ABILITIES.length).toBe(12);`
- The icon reference list needs no change (`p.icon` still exists).
- Add a new `describe('passives')` block:

```ts
import {
  PASSIVE_ABILITIES, PASSIVE_MAX_LEVEL, PASSIVE_MILESTONE_LEVELS,
  PASSIVE_STATS, passiveStatValue, passiveUpgradeCost,
} from '../src/data/passiveAbilities';
import { passiveWaveXpRef, passiveXpForLevel, PASSIVE_XP_LEVEL_WAVES } from '../src/data/xpTables';

describe('passives', () => {
  it('gives every passive exactly the five milestone levels', () => {
    for (const p of PASSIVE_ABILITIES) {
      expect(p.milestones.map(m => m.at), p.id).toEqual([...PASSIVE_MILESTONE_LEVELS]);
    }
  });

  it('only names stats the contributor knows', () => {
    const known = new Set(PASSIVE_STATS);
    for (const p of PASSIVE_ABILITIES) {
      for (const e of p.effects) expect(known.has(e.stat), `${p.id}:${e.stat}`).toBe(true);
      for (const m of p.milestones) {
        for (const g of m.grants) expect(known.has(g.stat), `${p.id}:${g.stat}`).toBe(true);
      }
    }
  });

  it('has a non-empty tagline and at least one scaling effect', () => {
    for (const p of PASSIVE_ABILITIES) {
      expect(p.tagline.length, p.id).toBeGreaterThan(0);
      expect(p.effects.length, p.id).toBeGreaterThan(0);
      expect(p.effects.some(e => e.perLevel > 0), p.id).toBe(true);
    }
  });

  it('unlocks in ascending order of cost within a family-free sort', () => {
    const byWave = [...PASSIVE_ABILITIES].sort((a, b) => a.unlockWave - b.unlockWave);
    for (let i = 1; i < byWave.length; i++) {
      expect(byWave[i].unlockGoldCost, byWave[i].id)
        .toBeGreaterThan(byWave[i - 1].unlockGoldCost);
      expect(byWave[i].upgradeBaseCost, byWave[i].id)
        .toBeGreaterThan(byWave[i - 1].upgradeBaseCost);
      expect(byWave[i].xpBase, byWave[i].id).toBeGreaterThan(byWave[i - 1].xpBase);
    }
  });

  it('prices level 1 at six waves of XP at the unlock wave, within 15%', () => {
    for (const p of PASSIVE_ABILITIES) {
      const expected = PASSIVE_XP_LEVEL_WAVES * passiveWaveXpRef(p.unlockWave);
      const actual = passiveXpForLevel(p, 1);
      expect(Math.abs(actual / expected - 1), p.id).toBeLessThan(0.15);
    }
  });

  it('makes every level strictly more expensive than the last', () => {
    for (const p of PASSIVE_ABILITIES) {
      for (let l = 1; l < PASSIVE_MAX_LEVEL; l++) {
        expect(passiveUpgradeCost(p, l), `${p.id}@${l}`)
          .toBeGreaterThan(passiveUpgradeCost(p, l - 1));
        expect(passiveXpForLevel(p, l + 1), `${p.id}@${l}`)
          .toBeGreaterThan(passiveXpForLevel(p, l));
      }
    }
  });

  it('never lets a milestone lower a stat', () => {
    for (const p of PASSIVE_ABILITIES) {
      for (const m of p.milestones) {
        for (const g of m.grants) expect(g.value, `${p.id}:${g.stat}`).toBeGreaterThan(0);
      }
    }
  });

  it('grants a milestone exactly at its level and not before', () => {
    for (const p of PASSIVE_ABILITIES) {
      for (const m of p.milestones) {
        for (const g of m.grants) {
          const before = passiveStatValue(p, g.stat, m.at - 1);
          const after = passiveStatValue(p, g.stat, m.at);
          // `perLevel` may also move the stat, so assert the *jump* is at least
          // the grant, not that the value equals it.
          expect(after - before, `${p.id}:${g.stat}@${m.at}`).toBeGreaterThanOrEqual(g.value);
        }
      }
    }
  });
});
```

### 14.2 `tests/stats.test.ts`

Rename the passive stat keys used in the four existing cases and fix the expected numbers, which move because the units are now correct:

- `passives: { damage_pct: 25 }` — unchanged key, unchanged maths (`1 + 25/100`).
- `passives: { gold_mult_pct: 30 }` — unchanged.
- `passives: { mana_regen_pct: 50 }` / `{ mana_regen_pct: 20 }` — unchanged.

No expected value changes; the three stats used by the existing tests already divided by 100. Add two new cases proving the two bug fixes:

```ts
  it('applies thorns as a fraction of the attacker damage, not a raw percent', () => {
    const { stats } = resolveStats({ ...emptyStatContext(), passives: { thorns_pct: 58 } });
    expect(stats.thorns).toBeCloseTo(0.58, 6);
  });

  it('applies lifesteal as a fraction of damage dealt', () => {
    const { stats } = resolveStats({ ...emptyStatContext(), passives: { lifesteal_pct: 1.5 } });
    expect(stats.lifesteal).toBeCloseTo(0.015, 6);
  });
```

### 14.3 `tests/save.test.ts`

`passiveAbilities: { marksmanship: { level: 2, xp: 30, unlocked: true } }` is a v-old fixture id. Change it to `passive_marksmanship` and add a migration case asserting a v17 save comes out with `passiveAbilities` empty.

### 14.4 `sim/checks.ts` — replace the §2.5 block

```ts
// ── §2.5 passives ─────────────────────────────────────────────────────────
section('§2.5 passive abilities');
{
  const bus = new EventBus();
  const state: Record<string, PassiveAbilityState> = {};
  const mgr = new PassiveAbilityManager(state, bus);
  mgr.ensureInitialized();
  const first = PASSIVE_ABILITIES[0];      // Marksmanship, unlock wave 5
  const last = PASSIVE_ABILITIES[PASSIVE_ABILITIES.length - 1];

  check('a locked passive contributes nothing',
    Object.keys(mgr.getStatTotals()).length === 0);

  mgr.unlock(first.id);
  check('unlocking grants the level-0 effect immediately',
    (mgr.getStatTotals().damage_pct ?? 0) === first.effects[0].base,
    `got ${mgr.getStatTotals().damage_pct}`);

  const before = mgr.getUpgradeCost(first.id);
  for (let i = 0; i < 20; i++) mgr.addKillXp('normal', first.unlockWave);
  check('passives earn XP from kills', mgr.getXp(first.id) > 0);
  check('banked XP discounts the gold cost', mgr.getUpgradeCost(first.id) < before);

  // The headline fix: measured in *waves at its own unlock wave*, a late
  // passive must level no faster than an early one. Before the redesign the
  // wave-65 passive gained ten levels inside a single wave.
  const wavesToLevel = (def: typeof first) => {
    const s: Record<string, PassiveAbilityState> = {};
    const m = new PassiveAbilityManager(s, bus);
    m.ensureInitialized();
    m.unlock(def.id);
    let waves = 0;
    while (m.getLevel(def.id) < 5 && waves < 10_000) {
      const n = Math.max(1, Math.floor(enemyCountForWave(def.unlockWave)));
      for (let k = 0; k < n; k++) m.addKillXp('normal', def.unlockWave);
      m.addWaveClearXp(def.unlockWave);
      waves += 1;
    }
    return waves;
  };
  const early = wavesToLevel(first);
  const late = wavesToLevel(last);
  check('the last passive is not faster than the first, per wave of play',
    Math.abs(early - late) <= 3, `early=${early} late=${late}`);
  check('reaching level 5 from XP alone takes real play',
    early >= 25, `waves=${early}`);

  // Gold has to be a cost, not a rounding error.
  const runGoldAtUnlock = 20 * Math.pow(1.11, last.unlockWave) * 6;
  check('unlocking the deepest passive costs several waves of income',
    last.unlockGoldCost > runGoldAtUnlock * 0.7, `${last.unlockGoldCost}`);
}
```

Add `enemyCountForWave` to the `sim/checks.ts` imports from `../src/data/formulas.ts`.

---

## 15. `docs/passive-system.md` — replace with

```markdown
# Passive Abilities

12 permanent bonuses in 4 families, unlocked with gold behind a *lifetime*
wave gate and levelled by a blend of XP and gold. `PassiveAbilityManager`,
`src/data/passiveAbilities.ts`, `src/ui/PassivePanel.ts`.

| Family | Passives |
|---|---|
| Warfare | Marksmanship (5), Haste (18), Executioner (40), Siege Doctrine (75) |
| Aegis | Fortitude (10), Retribution (30), Aegis Ward (58) |
| Avarice | Scavenger (14), Treasury (48), Prospector (88) |
| Attunement | Mana Spring (24), Arcane Focus (65) |

(number = unlock wave)

## Shape

Every passive caps at `PASSIVE_MAX_LEVEL` (25) and has milestone ranks at
levels 5, 10, 15, 20 and 25. A rank grants a fixed second stat once and never
scales again — that is what makes it an event rather than a rounding.

`def.effects` are the scaling lines (`base + perLevel * level`);
`def.milestones[].grants` are the ranks. `passiveStatValue(def, stat, level)`
sums both. `describePassiveEffects` turns the result into the panel's lines.

## The two tracks

- **XP.** `passiveXpForLevel(def, level) = def.xpBase * level^1.5 * 1.10^(level-1)`.
  `def.xpBase` is `6 * passiveWaveXpRef(def.unlockWave)` — six waves of play at
  the wave the passive unlocks at. This is the fix for the old system's headline
  defect: one shared requirement table against a faucet that grew with the live
  wave meant a wave-65 passive gained ten levels in its first wave.
- **Gold.** `passiveUpgradeCost(def, level) = def.upgradeBaseCost * 2^level`.
  `upgradeBaseCost` is four waves of income at the unlock wave, fitted from the
  balance simulator's §2.1 gold column. Growth is 2.0 because the economy itself
  grows ~1.11x per wave — anything below ~1.11^7 gets cheaper, in waves of
  income, the deeper the player goes.

They blend: banked XP discounts the gold price pro rata
(`cost = full * (1 - xp / needed)`), a full bar levels for free, and buying with
gold spends the banked XP as the discount.

Passive XP is multiplied by the same `xpGainMultiplier` the tower's XP uses, so
Prospector and the pacing combo accelerate both.

## Unlock and persistence

- `canUnlock(id, lifetimeHighestWave)`. **Lifetime**, not the run's wave: the
  levels survive an Ascension, so the gate has to as well.
- Unlocking grants every effect's `base` immediately — a purchase that does
  nothing until the first upgrade is not a purchase.
- **Passives survive Ascension and are wiped by Transcendence**
  (`Game.applyFullTranscendenceReset`). They are progression *inside* one
  transcendence cycle, alongside the AP layer they were bought with. Equipment,
  talents, tower XP, research and achievements all still carry over.
```

Also fix `docs/save-system.md` (bump the version table to 18 with the passive-reset row) and any `docs/stat-pipeline.md` mention of the passive stat list.

---

## 16. Task order

1. `src/data/xpTables.ts` — §3.
2. `src/types.ts` — §5.
3. `src/data/passiveAbilities.ts` — §4. `npx tsc --noEmit` will now light up every call site; that list is the checklist for steps 4–10.
4. `src/stats/keys.ts` — §6.
5. `src/stats/contributors/passives.ts` — §7.
6. `src/systems/PassiveAbilityManager.ts` — §8.
7. `src/game/Game.ts` — §9 (all nine sub-steps).
8. `src/systems/SaveManager.ts` — §10.
9. `src/data/milestones.ts` — §11.
10. `src/ui/navGroups.ts`, `src/ui/PassivePanel.ts`, `src/ui/AbilityPanel.ts`, `src/ui/UIManager.ts`, `src/ui/TranscendencePanel.ts` — §12.
11. `src/styles/main.css` — §13.
12. Tests and `sim/checks.ts` — §14.
13. Docs — §15.

After each of 3, 7, 10: `npm run typecheck`.

---

## 17. Verification

```bash
npm run typecheck && npm test && npm run checks && npm run sim
```

### 17.1 Reproduce the balance tables

Save as `sim/tmp-passives.mjs` and run with `node`. It reproduces §3.3 and §4.5 exactly; if it does not, a constant was mistyped.

```js
const ANCHOR = 20, WAVE_GOLD_GROWTH = 1.11;
const waveGoldRef = w => ANCHOR * Math.pow(WAVE_GOLD_GROWTH, w);
const enemyCount = w => 5 + Math.floor((w - 1) * 1.2);
const killScale = w => 1 + 0.20 * Math.max(1, w);
const CLEAR = 12;
const waveXpRef = w => (enemyCount(w) + CLEAR) * killScale(w);
const round2 = n => { const e = Math.max(0, Math.floor(Math.log10(n)) - 1); const p = 10 ** e; return Math.round(n / p) * p; };

const P = [
  ['Marksmanship', 5], ['Fortitude', 10], ['Scavenger', 14], ['Haste', 18],
  ['Mana Spring', 24], ['Retribution', 30], ['Executioner', 40], ['Treasury', 48],
  ['Aegis Ward', 58], ['Arcane Focus', 65], ['Siege Doctrine', 75], ['Prospector', 88],
];
const fmt = n => n >= 1e12 ? (n/1e12).toFixed(2)+'T' : n >= 1e9 ? (n/1e9).toFixed(2)+'G'
  : n >= 1e6 ? (n/1e6).toFixed(2)+'M' : n >= 1e3 ? (n/1e3).toFixed(1)+'K' : String(Math.round(n));

console.log('| passive | uw | unlockGoldCost | upgradeBaseCost | xpBase |');
for (const [n, uw] of P) {
  console.log(`| ${n} | ${uw} | ${round2(6*waveGoldRef(uw))} | ${round2(4*waveGoldRef(uw))} | ${round2(6*waveXpRef(uw))} |`);
}

const GROWTH = 2.0, POLY = 1.5, GEO = 1.10;
const cost = (b, L) => Math.floor(b * GROWTH ** L);
const req  = (x, L) => Math.round(x * L ** POLY * GEO ** (L - 1));
const goldRun = D => { let s = 0; for (let w = 1; w <= D; w++) s += waveGoldRef(w); return s; };
const xpRun   = D => { let s = 0; for (let w = 1; w <= D; w++) s += waveXpRef(w); return s; };

console.log('\n| depth | gold/run | passive XP/run |');
for (const D of [31, 60, 100, 120, 150, 200, 240]) console.log(`| ${D} | ${fmt(goldRun(D))} | ${fmt(xpRun(D))} |`);

for (const [label, f, pick] of [['gold', cost, uw => round2(4*waveGoldRef(uw))],
                                ['xp',   req,  uw => round2(6*waveXpRef(uw))]]) {
  console.log(`\ncumulative ${label} to reach level L`);
  console.log('| L | ' + P.map(p => p[0]).join(' | ') + ' |');
  const cum = P.map(() => 0);
  for (let L = 1; L <= 25; L++) {
    P.forEach(([, uw], i) => { cum[i] += f(pick(uw), label === 'gold' ? L - 1 : L); });
    if ([1,5,10,15,20,25].includes(L)) console.log(`| ${L} | ` + cum.map(fmt).join(' | ') + ' |');
  }
}
```

Delete the file once the numbers check out.

### 17.2 Acceptance criteria

| # | Check | How |
|---|---|---|
| 1 | 12 passives, 25 levels, 5 ranks each | `npm test` (§14.1) |
| 2 | Level 1 of every passive is 6 waves of XP at its unlock wave | `npm test` (§14.1) |
| 3 | The deepest passive levels no faster, per wave, than the shallowest | `npm run checks` (§14.4) |
| 4 | Level 5 from XP alone takes ≥ 25 waves at the unlock depth | `npm run checks` |
| 5 | Thorns at Lv0 reflects 8%, not 800% | `npm test` (§14.2) |
| 6 | Lifesteal rank 5 heals 1.5%, not 150% | `npm test` (§14.2) |
| 7 | A v17 save loads and comes back with zero passives | `npm test` (§14.3) |
| 8 | Ascending keeps passive levels | in-game: note levels, ascend, reopen the panel |
| 9 | Transcending zeroes them | in-game: transcend, reopen the panel — every card is locked |
| 10 | The wave gate updates live | in-game: clear the wave a passive unlocks at; the card must become buyable without a reload (this was §1.5 bug 1) |
| 11 | Levelling toasts | in-game: buy a level — an info toast; buy level 5 — a milestone toast naming the rank |
| 12 | Panel is a top-level tab under Build, on desktop and in the mobile sheet | in-game |
| 13 | Cards reflow to one column under 620px | resize the browser |
| 14 | No dead CSS | `grep -n "ability-sub-tab\|ability-passive-content" src/styles/main.css` returns nothing |
| 15 | Idle wall wave has not moved | `npm run sim` — the §2.2 table must match the pre-change run (passives are not modelled by the sim, so any drift means something else was touched) |

---

## 18. Tuning levers

Ordered by how bluntly each moves the system. Change one at a time and re-run §17.1.

1. **`PASSIVE_COST_GROWTH`** (`passiveAbilities.ts`, currently `2.0`). The single strongest knob. Lower it and gold maxes passives sooner at depth; raise it and the last five levels become XP-only. Below `1.11^7 ≈ 2.08` a level gets *cheaper* in waves-of-income as the player descends, which is the failure mode of the old 1.5–1.9 curve — do not go under 1.9.
2. **`PASSIVE_XP_LEVEL_WAVES`** (`xpTables.ts`, currently `6`). Scales every `xpBase` literal proportionally. If it changes, regenerate every `xpBase` in the table with §17.1 or test 2 fails.
3. **`PASSIVE_XP_GEO`** (currently `1.10`). Controls how hard the XP tail bites. `1.08` makes level 25 reachable in roughly a third of the play; `1.13` roughly triples it.
4. **`PASSIVE_WAVE_CLEAR_XP_MULTIPLIER`** (currently `12`). Shifts the balance between grinding a wave and clearing waves fast. It appears in both the faucet and `passiveWaveXpRef`, so changing it does **not** change how long a level takes — only how much of the XP comes from clears. Regenerate `xpBase` anyway, since `passiveWaveXpRef` moves.
5. **`OFFLINE_PASSIVE_XP_RATE`** (`SaveManager.ts`, currently `0.25`).
6. **Per-passive `unlockWave`.** Moving one requires regenerating its three literals (`unlockGoldCost`, `upgradeBaseCost`, `xpBase`) with §17.1, or tests 2 and the ascending-cost test fail.
7. **`PASSIVE_MAX_LEVEL`** (currently `25`). Requires re-siting the milestone `at` values; `PASSIVE_MILESTONE_LEVELS` must stay `[cap/5, 2*cap/5, …, cap]` for the pip row and test 1.
8. **`PASSIVE_REVIVE_FRACTION`** (`Game.ts`, currently `0.5`).
