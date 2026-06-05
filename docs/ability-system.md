# Ability System

**Files:** `src/systems/AbilityManager.ts`, `src/data/abilities.ts`, `src/ui/AbilityPanel.ts`

## Overview

9 active abilities, each unlocked at a different wave and individually upgradeable up to **level 10**. Abilities spend mana and have a cooldown; some have a duration buff that ticks down each frame. Upgrades are bought with **gold** from the Abilities panel itself. Slots 1–4 are the original general-purpose abilities; slots 5–9 are a curated boss-killing kit (single-target nuke, crit spike, multi-target chain, sustain aura, execute).

## Unlocks

The mana system itself unlocks at wave 10. Each ability has its own `unlockWave` gate on top of that:

| Ability | Unlock wave | Slot |
|---|:---:|:--:|
| Rain of Arrows | 10 | 1 |
| Frost Nova | 18 | 2 |
| Berserk | 30 | 3 |
| Gold Rush | 45 | 4 |
| Meteor Strike | 40 | 5 |
| Precision Shot | 28 | 6 |
| Chain Lightning | 22 | 7 |
| Vampiric Aura | 55 | 8 |
| Execute | 50 | 9 |

The per-ability gate is layered: a cast attempt before the ability's own `unlockWave` is rejected with `"Unlocks at wave N"`. If mana itself isn't unlocked yet, the message is `"Unlocks at wave 10"`. `AutomationManager.runAutoCast` automatically respects these gates (it calls `canCast`, which checks them).

## Per-Ability Tuning (base values, all at L1)

| Ability | Mana | CD (s) | Duration (s) | Effect | Hotkey |
|---|---:|---:|---:|---|:---:|
| Rain of Arrows | 30 | 15 | instant | 5× tower damage to all | 1 |
| Frost Nova | 25 | 20 | 5 | Slows all enemies by 50% | 2 |
| Berserk | 40 | 30 | 8 | Doubles tower fire rate | 3 |
| Gold Rush | 50 | 60 | 15 | Triples gold drops | 4 |
| Meteor Strike | 60 | 25 | instant | 12× damage to highest-HP enemy, 2× splash within 60 px | 5 |
| Precision Shot | 35 | 22 | 6 | +30% crit chance, +50% crit dmg for 6 s | 6 |
| Chain Lightning | 40 | 18 | instant | 5 bounces (3×, 2×, 2×, 1×, 1×) at 0.65 decay, +1 bounce/level (max 9) | 7 |
| Vampiric Aura | 45 | 35 | 8 | 3× lifesteal and +1% maxHP/s regen for 8 s | 8 |
| Execute | 50 | 30 | instant | Instantly kills non-boss enemies below 12% HP; 5× damage to boss below 25% HP | 9 |

## Upgrades (1 → 10)

Each ability is upgradable from level 1 (base) up to `maxLevel` (10). Per upgrade level:

| Ability | Upgrade base | Growth | Mana +/lvl | CD −/lvl | Dur +/lvl | Effect Δ/lvl |
|---|---:|:---:|---:|---:|---:|---|
| Rain of Arrows | 200g | 1.60 | +5 | −0.5 s | 0 | +1.0× dmg |
| Frost Nova | 300g | 1.55 | +4 | −0.8 s | +0.5 s | −0.02 slow factor |
| Berserk | 500g | 1.50 | +6 | −1.0 s | +0.5 s | +0.15× fire rate |
| Gold Rush | 800g | 1.45 | +8 | −1.5 s | +1.0 s | +0.25× gold |
| Meteor Strike | 600g | 1.55 | +6 | −0.5 s | 0 | +1.5× dmg |
| Precision Shot | 450g | 1.50 | +4 | −0.6 s | +0.4 s | +2% crit, +10% crit dmg |
| Chain Lightning | 400g | 1.50 | +4 | −0.5 s | 0 | +1 bounce (max 9), +0.3× dmg |
| Vampiric Aura | 700g | 1.50 | +5 | −1.0 s | +0.4 s | +0.5× lifesteal mult |
| Execute | 600g | 1.50 | +6 | −0.8 s | 0 | +2% threshold (12% → 30%) |

**Cost formula** (mirrors tower upgrades):
```
cost(level) = floor(upgradeBaseCost × upgradeCostGrowth^level)
```
`level` is the **current** level of the ability — i.e. the cost of going from L1 → L2 uses `level=1`, the cost of going from L2 → L3 uses `level=2`, and so on.

**Effective stats at level N** (before prestige/research multipliers):
- `manaCost(level) = def.manaCost + def.manaCostPerLevel × (level − 1)`
- `cooldown(level) = max(1, def.cooldown − def.cooldownReductionPerLevel × (level − 1))`
- `duration(level) = def.duration + def.durationPerLevel × (level − 1)`
- `effectValue(level) = def.effectValue + def.effectValuePerLevel × (level − 1)`

**Example — Rain of Arrows L1 → L10**: damage 5× → 14×, mana 30 → 75, cooldown 15.0 s → 10.5 s. Total gold spent on upgrades ≈ 36 k.

**Frost Nova display inversion**: the internal slow *factor* shrinks (0.50 → 0.32) but the description and tooltip render `(1 − factor) × 100` as the slow **%**, so the player sees 50% → 68%.

**Execute display**: the threshold is stored as a percent value. The description and tooltip render it directly. Level-ups *raise* the threshold (12% → 30% at L10), so the ability gets **easier** to trigger as it levels — more enemies qualify for the instant-kill.

## Effect Types

The `AbilityEffectType` union covers all 9 abilities:

| Type | Abilities | Implementation |
|---|---|---|
| `aoe_damage` | Rain of Arrows | Hits every alive enemy once |
| `slow` | Frost Nova | Sets `slowFactor` + `slowTimer` on `EnemyManager` |
| `fire_rate_buff` | Berserk | `tower.setFireRateMultiplier(value × (1 + berserkFireBonus))` |
| `gold_buff` | Gold Rush | `enemies.setGoldMultipliers(value, 1)` |
| `single_target_damage` | Meteor Strike | Highest-HP target, 2× splash within `METEOR_SPLASH_RADIUS` (60 px) |
| `chain_damage` | Chain Lightning | Bounces start at the nearest enemy to the tower, each subsequent bounce picks the nearest unhit enemy within `CHAIN_BOUNCE_RADIUS` (200 px); damage decays by `CHAIN_DECAY` (0.65) per bounce |
| `crit_buff` | Precision Shot | `tower.setCritBonus(value/100, 1.5)` — chance and multiplier applied in `rollShot` |
| `lifesteal_buff` | Vampiric Aura | `tower.setLifestealMultiplier(value)` + adds `+0.01` to `healthRegen` (per second, as a fraction of max HP) |
| `execute_damage` | Execute | Boss threshold = `pct/2` (5× damage); non-boss = `pct` (instant-kill by dealing `max(1, hp)`) |

## Mana System

- Mana unlocks at wave 10 (`MANA_UNLOCK_WAVE` constant in `AbilityManager`).
- `BASE_MANA_REGEN` is **1 MP/s** (reduced from 2 to make abilities feel more impactful given the higher per-level mana cost).
- Mana regen is then multiplied by `researchManaMulti` (from `Arcane Studies`) and `tpManaRegen` (from Transcendence perks), plus the `manaRegen` tower upgrade (additive).
- Mana cost is reduced by **Arcane Mastery** research and the **Arcane Affinity** prestige perk, applied multiplicatively to the level-scaled mana cost.

## Casting Logic (`tryCast`)

1. `canCast`: wave ≥ ability's `unlockWave` (and ≥ 10 for mana), level > 0, cooldown ready, enough mana for the **effective** mana cost.
2. Spend the effective mana cost.
3. Set the cooldown to the **effective** cooldown (`cooldown × cooldownMultiplier`), with a 1 s floor.
4. If the ability has a duration, set `active` + `activeTimer` to the effective duration. Otherwise clear them.
5. Apply the **effective** effect value (level-scaled):
   - `aoe_damage`: deal `towerDamage × effectValue × damageMultiplier` to each alive enemy
   - `slow`: `enemies.applySlow(effectValue, duration)` — the factor multiplies enemy speed
   - `fire_rate_buff`: multiply tower fire rate by `effectValue × (1 + berserkFireBonus)`
   - `gold_buff`: multiply gold drops by `effectValue`
   - `single_target_damage`: hit highest-HP enemy for `value×` heavy, 2× splash within 60 px
   - `chain_damage`: chain lightning starting from the nearest enemy; bounces = `5 + (level-1)`, damage = `towerDamage × value × 0.65^index × damageMultiplier`
   - `crit_buff`: `tower.setCritBonus(value/100, 1.5)`
   - `lifesteal_buff`: `tower.setLifestealMultiplier(value)` + `+0.01` to `healthRegen` for the duration
   - `execute_damage`: kill non-boss enemies below `value%` HP; deal `5×` to boss below `value/2%` HP
6. Emit `ability_cast` and `ability_visual` events. The visual event may carry an optional `target: {x,y}` (used by Meteor Strike to emit the impact at the actual target location).

## Tick Logic

- Decrement cooldowns, emit `ability_ready` when reaching 0
- Decrement active durations, clear effects when expired
- Apply ongoing buffs each tick (fire rate multiplier, crit bonus, lifesteal multiplier, gold multiplier, vampiric regen)

## Upgrading from the Abilities Panel

Each card has an **Upgrade** button (hidden until the ability unlocks) and a small **Lv X** badge next to the ability name. The button is disabled (red border) when gold is insufficient.

**Tooltip on hover** shows:
- Header: `{name} — Level {cur} → {cur + 1}`
- Rows: effect value, mana cost, cooldown, duration — current (dim) → next (green)
- Footer: `Cost: {gold}g` (red when not affordable)

**Dynamic description**: the card description updates to reflect the level-scaled effect, e.g. `"Strikes all enemies for 7x tower damage"` at L2, `"Slows all enemies by 58% for 7.0s"` for Frost Nova L5.

**Cooldown overlay ratio**: the visual fill uses the **effective** cooldown as the denominator, so the bar drains in real time even with prestige CDR / per-level CD reduction.

## Active Buffs (level-scaled)

The buff snapshot stored in `state.abilities[id].active` does not change when you upgrade mid-buff — the buff continues to use the level it was cast at. **Future casts** use the new stats (because `tryCast` reads `getEffective*` at cast time). This matches the "no special handling" edge case in the implementation plan.

## Tower Buff Hooks

Two new external multipliers live on `Tower` (mirroring the existing `setFireRateMultiplier` pattern):

- `setCritBonus(extraChance, extraMultiplier)` — sets an additive crit chance and a crit-multiplier scaler. `effectiveCritChance` clamps to **1.0** so Precision Shot + a high-crit-chance build can never exceed 100%.
- `setLifestealMultiplier(m)` — multiplies the upgrade-derived `lifesteal` value. `effectiveLifesteal` is what the enemy-damaged handler uses to compute HP gain.

The `fireRateMultiplierValue`, `effectiveCritChance`, `effectiveCritMultiplier`, and `effectiveLifesteal` getters are used in both `rollShot` and `computeStatsInfo` so the HUD reflects active buffs accurately (DPS, crit %, lifesteal % all update while Precision Shot / Berserk / Vampiric Aura are running).

## Research Synergies

- `arcane_mastery` reduces mana cost by 30% (applied multiplicatively to the level-scaled cost).
- `mana_font` increases mana regen by 50%.
- `Arcane Studies` (multiplicative) and Transcendence perks further boost regen.

## Transcendence Behaviour

`AbilityManager.resetLevels()` is called by `applyFullTranscendenceReset` — every ability returns to level 1 and its base stats. **Ascension does not reset ability levels** — they carry over to the next run.

## Save Migration

No `SAVE_VERSION` bump is required. Existing `level: 1` values in saves stay valid. New abilities (5–9) simply start at `level: 1` and are wave-gated — players who load an old save won't see them unlocked until they reach each `unlockWave`, even though the ability state object is present. A previously-unlocked ability whose `unlockWave` is now higher (e.g. Gold Rush at wave 45) will simply show as locked-by-wave when the player hasn't reached that wave yet, even though `level = 1` is stored.

## Cooldown Floor

`Math.max(1, …)` is applied to the effective cooldown, so even at high levels with full Transcendence CDR the cooldown never goes below 1 s.

## Cost Floor

`Math.max(1, Math.ceil(…))` is applied to the effective mana cost, so abilities always cost at least 1 mana.

## Automation Cast Order

`AutomationManager.runAutoCast` casts the first available ability in this fixed priority:

```
execute → meteor_strike → chain_lightning → precision_shot
  → vampiric_aura → rain_of_arrows → berserk → frost_nova → gold_rush
```

Boss-killing abilities (slots 5–9) are tried first because their value-per-mana is highest on boss waves. The order is fine-tuned so the strongest single-target nuke (Execute) goes first when it has been recently upgraded to a high threshold.

## Edge Cases

- **Upgrade while buff is active**: buff continues at its cast level; future casts use new stats.
- **Save migration**: no version bump needed.
- **Frost Nova display**: internal factor shrinks, UI shows slow %.
- **Cooldown / cost floor**: minimum 1 s / 1 mana even at L10 with full reductions.
- **Transcendence**: full reset to L1; Ascension leaves levels intact.
- **Automation**: `AutomationManager.runAutoCast` already routes through `canCast` and `tryCast`, so it picks up the new wave gates and effective stats for free.
- **Meteor on empty field**: `pickHighestHpTarget()` returns null; the cast silently does nothing (no mana is still spent? — actually mana IS spent first; see `tryCast`). Plan: this matches the no-target edge case for AoE/chain abilities.
- **Crit cap**: `setCritBonus` clamps to `[0, 1]` so combined crit sources can't exceed 100%.
- **Chain double-hit guard**: a `Set<enemyId>` is built per cast to ensure each enemy is hit at most once.
- **Vampiric regen compounding**: `applyOngoingBuffs` subtracts the *last applied* bonus before adding the new one to avoid double-stacking if the value changes during the buff.
