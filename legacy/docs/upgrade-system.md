# Upgrade System

**Files:** `src/systems/UpgradeManager.ts`, `src/data/upgrades.ts`

## Upgrade Manager (`UpgradeManager`)

- Tracks upgrade levels in a `Record<string, number>`
- Provides: buy, cost check, max check, snapshot, reset, replace
- Emits `upgrade_purchased` and `upgrades_changed` events on purchase

## Cost Formula

```
cost = floor(baseCost * growth^level)
```

## 29 Upgrades

Four categories: **tower** (11), **economy** (5), **utility** (4), **defense**
(9). Every line has a real `maxLevel` — the revamp's design rule 6 is that
nothing compounds forever, so the `999` ceilings are gone.

### The cap extension (`src/data/upgradeCaps.ts`)

A line's `maxLevel` is its *table* ceiling; what binds at runtime is
`effectiveMaxLevel(def)` = `maxLevel + round(maxLevel × capExtension)`.

`damage`'s 200 levels are worth exactly 200 waves of enemy HP growth
(`1.11^(L-2)` per level against `ENEMY_HP_GROWTH = 1.11`), so they were also the
ceiling on what *gold* could ever buy: measured with `npm run sim`, a run handed
an unlimited gold multiplier still walled at **wave 219**, and past that depth
every gold system in the game — Fortune, Tycoon, Golden Age, the combo meter,
the risk dial's payout, contract gold, loot orbs, gear sales — was inert
(plans/progress.md §1.2). Doubling the literal moves the wall once; a *bought*
extension keeps gold live at every depth: 219 → **419** with `damage` alone at
2 000 levels, and the bracket keeps opening as the extension grows.

Three sources sum into one `upgradeCapExtension` stat, capped at
`MAX_CAP_EXTENSION` (6.0):

| Source | Amount |
|---|---|
| `ap_deep_stores` (AP perk, 4 levels) | +25% per level → +1.0 |
| `tp_foundry` (TP perk, 8 levels) | +50% per level → +4.0 |
| `deep_stores` (Watch chapter 21 unlock) | +0.5 (`WATCH_CAP_EXTENSION`) |

**A fraction, not a flat number,** because every line's cap is sized against its
own curve — `damage` 200 against 1.11, `critDamage` 50 against a much flatter
payout, `pierce` 6 against `3.2^L` costs. A flat "+50 levels" is nothing to
`damage` and breaks `pierce`.

**Only the scalar lines** (`CAP_EXTENDABLE_UPGRADES`: damage, critDamage,
health, defense, armor, thorns, lifesteal, goldMulti, waveGold, goldOnKill,
manaRegen, xpGain). `fireRate` is capped on purpose — two compounding DPS axes
multiply into a runaway — and `pierce` / `splash` / `doubleShotChance` /
`quickShotChance` are coverage axes whose ceilings are set by the arena's
geometry rather than by the economy. A new upgrade is excluded by default, which
is the safe direction for a mechanism whose failure mode is a runaway.

`UpgradeManager`, `UpgradePanel` and `sim/model.ts` all read the same accessor,
so the panel can never offer a level the manager refuses.

### Tower (11)
| ID | Name | baseCost | growth | effect/level | maxLevel | Ceiling |
|----|------|---------:|-------:|-------------|---------:|---------|
| damage | Sharper Arrows | 8 | 1.18 | `2.64 x 1.11^(L-1)` total (startLevel 1) | 200 | — |
| fireRate | Quick Draw | 25 | 1.30 | +0.05 shots/s | 45 | +2.25 shots/s |
| range | Longbow | 120 | 1.30 | +3 range | 50 | +150 |
| critChance | Eagle Eye | 220 | 1.32 | +0.5% crit | 40 | 25% with the 5% base |
| critDamage | Heavy Quiver | 260 | 1.30 | +0.08 crit mult | 50 | x6.0 on the 2.0 base |
| pierce | Bodkin Points | 1200 | **3.2** | +1 `pierceExtra` | 6 | +6 |
| splash | Fragmenting Arrows | 1500 | 1.35 | base 0.112, +0.012/level, cap 0.40 | 25 | 40% splash fraction |
| landMines | Land Mines | 700 | 1.34 | base 0.33, +0.125/level | 80 | — |
| doubleShotChance | Double Tap | 240 | 1.36 | base 2%, +1%/level | 30 | 31% |
| quickShotChance | Adrenaline Rush | 320 | 1.38 | base 1.5%, +0.9%/level | 30 | 27.6% per shot |
| quickShotTime | Adrenaline Surge | 200 | 1.40 | base 2 s, +0.5 s/level | 10 | 6.5 s |

**`damage` is geometric, `fireRate` is additive and hard-capped.** Two
compounding DPS axes multiply into a runaway; `damage` is `2.64 x 1.11^(L-1)`,
i.e. a flat +11% per level against `ENEMY_HP_GROWTH = 1.11`, and `fireRate`
buys a fixed +0.05 to a composed ceiling of 3.88 shots/s.

**`pierce` and `splash` are the coverage axis (revamp §5.2).** `pierce` is
priced as a *milestone* rather than a trickle buy — 1 200 / 3 840 / 12 288 /
39 322 / 125 830 / 402 656, six purchases across a whole progression. `splash`
spends its `scaling` block on the damage *fraction*; the disc **radius** comes
from `splashRadiusForLevel(level)` = `world(40 + 3 x level)`, which lives in
`src/data/upgrades.ts` next to `SPLASH_TUNING` so the stat contributor and
`sim/model.ts` read the same numbers. Splash composes with the artillery core,
the Mortar blessing and Annihilation through `composeShotSplash` — **max
radius, summed fraction** to `SPLASH_FRACTION_CAP` (0.40).

### Economy (5)
| ID | Name | baseCost | growth | effect/level | maxLevel | Ceiling |
|----|------|---------:|-------:|-------------|---------:|---------|
| goldMulti | Greed | 220 | 1.32 | +2% gold | 50 | +100% |
| prospecting | Prospecting | 240 | 1.34 | +1.5% `doubleGoldChance` | 20 | 30% |
| waveGold | Wave Mastery | 600 | 1.34 | base 3, +2/level flat gold on clear | 60 | — |
| goldOnKill | Bounty Hunter | 400 | 1.32 | base 1, +1/level flat gold per kill | 60 | — |
| critGold | Fortune | 240 | 1.34 | +0.25 crit-kill gold mult | 20 | x6 |

**`prospecting` replaced `upgradeDiscount`** (revamp §5.3). A flat cost reducer
is an anti-upgrade: nothing happens on screen and it compounds silently with
every other economy line. Prospecting occupies the same slot and pays out as a
visible double-gold pop, routed through the existing `doubleGoldChance` key
(clamped `[0, 1]`). The `upgradeCostDiscount` **stat key still exists** — talents
and achievements write it — but no gold upgrade does. Old saves are translated
by the v20 → v21 migration (see [save-system.md](save-system.md)).

### Utility (4)
| ID | Name | baseCost | growth | effect/level | maxLevel | Ceiling |
|----|------|---------:|-------:|-------------|---------:|---------|
| manaRegen | Meditation | 320 | 1.34 | +0.2 mana/s | 60 | +12/s |
| maxMana | Arcane Reserves | 260 | 1.30 | +5 max mana | 40 | +200 |
| xpGain | Wisdom | 400 | 1.34 | +2% XP | 40 | +80% |
| abilityCostReduction | Mana Efficiency | 260 | 1.34 | −1.5% ability mana cost | 20 | −30% |

### Defense (9)
| ID | Name | baseCost | growth | effect/level (scaling) | maxLevel | startLevel |
|----|------|---------:|-------:|----------------------|---------:|-----------:|
| health | Health | 25 | 1.15 | `5 x 1.10^(L-1)` total | 200 | 1 |
| healthRegen | Health Regen | 200 | 1.32 | base 0.004, +0.0005/level, cap **0.06** | 120 | 0 |
| defense | Defense | 150 | 1.30 | base 0.5, +0.3/level | 150 | 0 |
| armor | Armor | 180 | 1.26 | base 0.01, +0.003/level, cap **0.50** | 160 | 0 |
| shockwave | Shockwave | 300 | 1.28 | cooldown base 26 s, −0.35 s/level, floor 5 s | 60 | 0 |
| thorns | Thorns | 260 | 1.34 | base 0.03, +0.005/level, cap 0.75 | 140 | 0 |
| lifesteal | Lifesteal | 300 | 1.34 | base 0.003, +0.0006/level, cap 0.10 | 140 | 0 |
| defenseShield | Defense Shield | 600 | 1.32 | recharge base 55 s, −0.9 s/level, floor 8 s | 50 | 0 |
| wall | Wall | 700 | 1.34 | base 0.2, +0.02/level, cap 0.90 | 35 | 0 |

`shockwave`'s `scaling` block is the **cooldown**; its radius derives from the
level in `contributors/upgrades.ts`, which is what stopped the line from paying
for its own downgrade.

## Evolutions

Seventeen milestones across twelve upgrade lines. `EvolutionEffectId` is a
closed union switched exhaustively in `contributors/evolutions.ts`, so an
evolution nothing consumes fails `tsc` rather than shipping as flavour text.

| Upgrade | Level | Name | `effectId` | Effect |
|---|---:|---|---|---|
| damage | 20 | Keen Arrows | `armor_pen` | +10% armor penetration |
| damage | 60 | Vorpal Arrows | `instant_kill` | 2.5% instant kill on non-bosses |
| fireRate | 12 | Rapid Fire | `double_shot` | Every 5th shot fires double |
| fireRate | 30 | Machine Gun | `berserk_fire_bonus` | +30% fire rate during Berserk |
| range | 25 | Overwatch | `range_damage` | +10% damage beyond 70% of range |
| critChance | 20 | Hawk Eye | `crit_splash` | Crits deal 15% AoE splash |
| critChance | 35 | True Sight | `crit_ignore_armor` | Crits ignore armor |
| pierce | 4 | Skewer | `pierce_amp` | Pierced targets take +15% from the same shot |
| landMines | 25 | Cluster Mines | `mine_split` | Mines split into 2 smaller mines |
| goldMulti | 20 | Avarice | `kill_streak_gold` | +2.5% gold per consecutive kill, **capped +75%** |
| goldMulti | 40 | Dragon's Hoard | `wave_gold_scaling` | +0.5% gold per wave survived, **capped +50%** |
| manaRegen | 20 | Inner Peace | `mana_full_gold` | Full mana: +8% gold for 5 s |
| maxMana | 15 | Mana Shield | `mana_shield` | Full mana: 10% damage reduction |
| waveGold | 20 | Golden Tide | `golden_tide` | Wave-clear gold +20% |
| xpGain | 25 | Enlightenment | `enlightenment` | XP multiplier (see below) |
| health | 25 | Fortified Core | `hp_threshold_damage` | +12% damage above 80% HP |
| health | 90 | Titan's Heart | `revive` | Revive once per ascension at 25% HP |

`Overwatch` is consumed in `ProjectileManager` against the tower's own
*composed* range, so levelling `range` widens the band the bonus applies in
rather than diluting it.

### Economy caps (revamp §6.2)

Three ceilings need code rather than a data-table field. They live in
`src/data/formulas.ts` so the clamp and the number a doc quotes are the same
constant:

| Constant | Value | What it bounds |
|---|---:|---|
| `AVARICE_STREAK_GOLD_CAP` | `0.75` | Avarice's kill-streak bonus, via `avariceStreakGoldBonus(streak, perKill)` in the `enemy_killed` handler |
| `DRAGON_HOARD_GOLD_CAP` | `0.50` | Dragon's Hoard, clamped in `contributors/evolutions.ts` |
| `WAVE_MASTERY_CHAIN_PER_WAVE` / `_MAX_WAVES` | `0.1` / `20` | Wave Mastery's clear chain — `waveMasteryChainMultiplier(cleared)` = `1 + min(cleared, 20) x 0.1`, i.e. **x3** at most |

Uncapped, a wave-40 streak was worth +245%, the hoard another +40%, and the
Wave Mastery chain was `1 + cleared x 0.5` — x21 by wave 40, on a line whose
own level is already an economy purchase. Golden Tide multiplies **on top of**
the chain multiplier, not into it.

## Upgrade Effects Application (`stats/contributors/upgrades.ts`)

Called whenever upgrades change or research/prestige updates:
1. Reset all tower stats to `TOWER_BASE`
2. For each upgrade with level > 0, compute value and add to appropriate stat
3. Apply prestige bonuses (AP lifetime damage, TP damage, TP resource)
4. Apply research bonuses (gold multi, mana multi, ability cost reduction)
5. Apply research pierce to projectiles
6. Apply wave skip chance to wave manager

The `damage` and `health` upgrades both have `startLevel: 1`, so they ship at L1 out of the box and contribute to the tower's stats from frame 0. The first purchase moves them to L2 and pays the L1→L2 cost. The first-time `maxHp` gain (going from 0 to >0) sets `hp = maxHp` so the tower spawns with full health.

Ten upgrade lines also drive a **tower mark** — see [tower-system.md#upgrade-marks](tower-system.md#upgrade-marks). Marks change no stat.

## Upgrade Panel

3 sub-tabs in UI: Attack, Defense, Utility (economy grouped in Utility).
Each shows: name, current level (or total/next for damage/health), cost, description. Click to buy.

For `damage` and `health`, the level text is replaced with the current total effect and the next level's increase (e.g. `15 +13`). The bonus and per-level delta rows are hidden for these two.

## Bulk Buying (plan §4.1)

| Method | Buys |
|---|---|
| `buy(id)` | one level |
| `getRoundedPlan(id, step)` | up to the next multiple of `step` — from level 18, x10 buys 2 |
| `getMaxAffordablePlan(id, gold?)` | the largest plan the balance covers |
| `buyBulk(id, count)` | executes a plan as **one transaction** |

`buyBulk` pays once and emits `upgrade_purchased` once with `levelsGained`, so
a x100 buy is one toast, one save request and one stat recompute rather than a
hundred. Evolutions crossed by the jump each still announce themselves.

Costs are summed level-by-level rather than closed-form, because `costGrowth`
may be a per-level formula string with no single geometric ratio.

## Lookup Caches (plan §5.8)

- `UPGRADE_BY_ID` resolves a def without scanning `UPGRADES`.
- `hasEvolutionEffect` / `getEvolutionEffectValue` read a cache rebuilt by
  `rebuildEvolutionCache()` on every level mutation, rather than walking every
  upgrade's every evolution. `Game.simulate` calls `hasEvolutionEffect` several
  times per substep.

> Any new writer of `UpgradeManager.levels` must call `rebuildEvolutionCache()`.

## Enlightenment Evolution

The Wisdom upgrade's L25 evolution (`enlightenment`) resolves as an XP
multiplier: `contributors/evolutions.ts` applies
`a.mult('xpGainMultiplier', 1 + value)`. The old "every N waves, grant a talent
point" hook is removed.

> **Known mismatch.** The evolution's `effectValue` is `12` — the *interval in
> waves* the retired talent-point hook read — and its panel description still
> reads "+1 talent point every 12 waves", while the surviving consumer spends
> that 12 as `1 + value`. Whichever way it is resolved is a data change, not a
> docs one; this note records the state as shipped.
