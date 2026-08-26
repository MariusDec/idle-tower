# Ability System

**Files:** `src/systems/AbilityManager.ts`, `src/data/abilities.ts`, `src/ui/AbilityPanel.ts`

## Overview

10 active abilities, each unlocked at a different wave and individually upgradeable with **gold** from the Abilities panel itself (`maxLevel` is 10, except Rocket Barrage at 15). Abilities spend mana and have a cooldown; some have a duration buff that ticks down each frame.

## Unlocks

The mana system itself unlocks at wave 10. Each ability has its own `unlockWave` gate on top of that:

| Ability | Unlock wave | Hotkey |
|---|:---:|:--:|
| Rain of Arrows | 10 | 1 |
| Berserk | 14 | 5 |
| Frost Nova | 18 | 2 |
| Chain Lightning | 22 | 3 |
| Gold Rush | 26 | 7 |
| Precision Shot | 28 | 4 |
| Rocket Barrage | 35 | 0 |
| Meteor Strike | 40 | 6 |
| Execute | 50 | 8 |
| Vampiric Aura | 55 | 9 |

(Six of the ten land inside a first run — the opening ladder 10 / 14 / 18 / 22 /
26 / 28.)

The per-ability gate is layered: a cast attempt before the ability's own `unlockWave` is rejected with `"Unlocks at wave N"`. If mana itself isn't unlocked yet, the message is `"Unlocks at wave 10"`. `AutomationManager.runAutoCast` automatically respects these gates (it calls `canCast`, which checks them).

## Per-Ability Tuning (base values, all at L1)

| Ability | Mana | CD (s) | Duration (s) | Effect | Hotkey |
|---|---:|---:|---:|---|:---:|
| Rain of Arrows | 30 | 15 | instant | 5× tower damage to all | 1 |
| Berserk | 40 | 30 | 8 | Doubles tower fire rate | 5 |
| Frost Nova | 25 | 20 | 5 | Slows all enemies by 50% | 2 |
| Chain Lightning | 40 | 18 | instant | Strikes the nearest enemy for 3× and arcs to nearby targets; damage decays by 0.65 per bounce | 3 |
| Gold Rush | 50 | 60 | 15 | Triples gold drops | 7 |
| Precision Shot | 35 | 22 | 6 | +30% crit chance and ×1.5 crit damage for 6 s | 4 |
| Rocket Barrage | 45 | 20 | instant | Fires 6 homing rockets at nearby enemies; each deals 2× tower damage and splashes half of its hit within a 60 px blast | 0 |
| Meteor Strike | 60 | 25 | instant | 12× damage to highest-HP enemy, 2× splash within 60 px | 6 |
| Execute | 50 | 30 | instant | Kills non-boss enemies below 12% HP; bosses below 6% HP take 5× damage | 8 |
| Vampiric Aura | 45 | 35 | 8 | +6% lifesteal (additive) and +1% maxHP/s regen for 8 s | 9 |

## Upgrades

Each ability is upgradable from level 1 (base) up to `maxLevel` — 10 for every
ability except Rocket Barrage, which goes to 15. Per upgrade level:

| Ability | Upgrade base | Growth | Mana +/lvl | CD −/lvl | Dur +/lvl | Effect Δ/lvl |
|---|---:|:---:|---:|---:|---:|---|
| Rain of Arrows | 400g | 1.75 | +5 | −0.5 s | 0 | +1.0× dmg |
| Berserk | 900g | 1.85 | +6 | −1.0 s | +0.5 s | +0.15× fire rate |
| Frost Nova | 1300g | 1.80 | +4 | −0.8 s | +0.5 s | −0.02 slow factor |
| Chain Lightning | 1400g | 1.80 | +4 | −0.5 s | 0 | +0.3× dmg; +1 bounce per even level (cap 9) |
| Gold Rush | 3400g | 1.80 | +8 | −1.5 s | +1.0 s | +0.25× gold |
| Precision Shot | 3450g | 1.80 | +4 | −0.6 s | +0.4 s | +2% crit chance; crit multiplier +0.1×/lvl (1.5 → 2.4) |
| Rocket Barrage | 12000g | 1.85 | +3 | −0.3 s | 0 | +0.25× per rocket **and** +0.3 rockets/lvl (6 → ~10 at L15) |
| Meteor Strike | 19600g | 1.85 | +6 | −0.5 s | 0 | +1.5× dmg |
| Execute | 20000g | 1.85 | +6 | −0.8 s | 0 | +2% threshold (12% → 30%; boss threshold stays half) |
| Vampiric Aura | 25000g | 1.85 | +5 | −1.0 s | +0.4 s | +2% lifesteal (additive); regen +0.5%/lvl (1% → 5.5%) |

Upgrade base costs loosely follow the shared `400 × 1.135^(unlockWave − 10)`
trend the front-loaded ladder was rebased onto. The top end sits deliberately
below it: once ability levels became ascension-scoped — re-bought with gold
every run instead of carried across ascensions — Execute (`69600 → 20000`) and
Vampiric Aura (`107000 → 25000`) were out of a mid-run budget's reach at their
old bases, while keeping the shared growth factor.

**Cost formula** (mirrors tower upgrades):
```
cost(level) = floor(upgradeBaseCost × upgradeCostGrowth^level)
```
`level` is the **current** level of the ability — i.e. the cost of going from L1 → L2 uses `level=1`, the cost of going from L2 → L3 uses `level=2`, and so on.

**Ability XP discount**: casts bank XP, and banked XP pays part of the next level's cost — `cost = base × (1 − xp / xpForNextLevel)`, floored at 1 g. A heavily-cast ability levels itself cheaply; the listed base is the no-XP price.

**Effective stats at level N** (before prestige/research multipliers):
- `manaCost(level) = def.manaCost + def.manaCostPerLevel × (level − 1)`
- `cooldown(level) = max(1, def.cooldown − def.cooldownReductionPerLevel × (level − 1))`
- `duration(level) = def.duration + def.durationPerLevel × (level − 1)`
- `effectValue(level) = def.effectValue + def.effectValuePerLevel × (level − 1)`

**Example — Rain of Arrows L1 → L10**: damage 5× → 14×, mana 30 → 75, cooldown 15.0 s → 10.5 s. Total gold spent on upgrades ≈ 143 k before the ability-XP discount.

**Frost Nova display inversion**: the internal slow *factor* shrinks (0.50 → 0.32) but the description and tooltip render `(1 − factor) × 100` as the slow **%**, so the player sees 50% → 68%.

**Execute display**: the threshold is stored as a percent value. The description and tooltip render it directly. Level-ups *raise* the threshold (12% → 30% at L10), so the ability gets **easier** to trigger as it levels — more enemies qualify for the instant-kill. The boss threshold is always half the non-boss one; bosses never get instakilled, they just take `5×` damage below it.

## Effect Types

The `AbilityEffectType` union covers all 10 abilities:

| Type | Abilities | Implementation |
|---|---|---|
| `aoe_damage` | Rain of Arrows | Hits every alive enemy once |
| `slow` | Frost Nova | Sets `slowFactor` + `slowTimer` on `EnemyManager` |
| `fire_rate_buff` | Berserk | `BuffRegistry` entry `ability:fireRate`, stat `fireRate`, kind mult at `value × (1 + berserkFireBonus)` |
| `gold_buff` | Gold Rush | `BuffRegistry` entry `ability:gold`, stat `goldMultiplier`, kind mult at `value` |
| `single_target_damage` | Meteor Strike | Highest-HP target, 2× splash within `METEOR_SPLASH_RADIUS` (60 px) |
| `chain_damage` | Chain Lightning | Bounces start at the nearest enemy to the tower, each subsequent bounce picks the nearest unhit enemy within `CHAIN_BOUNCE_RADIUS` (200 px); damage decays by `CHAIN_DECAY` (0.65) per bounce |
| `crit_buff` | Precision Shot | Two `BuffRegistry` entries — `critChance` **additive** at `value / 100` (clamped to `[0, 1]`) and `critMultiplier` multiplicative at `precisionCritMultiplier(level)` (`1.5 + 0.1 × (level − 1)`), both applied in `rollShot`. The multiplier curve is what makes the upgrade pitch "+10% crit damage per level" real rather than tooltip-only |
| `lifesteal_buff` | Vampiric Aura | Two `BuffRegistry` entries — `lifesteal` **additive** at `+6% (+2%/level)` and `healthRegen` additive at `vampiricRegen(level)` = `1% + 0.5% × (level − 1)` of max HP per second. Additive because most builds carry zero base lifesteal and a ×N multiplier had nothing to multiply; the additive bucket still composes with any lifesteal the player does own |
| `execute_damage` | Execute | Boss threshold = `pct/2` (5× damage); non-boss = `pct` (instant-kill by dealing `max(1, hp)`) |
| `rocket_barrage` | Rocket Barrage | Fires `floor(effectCount)` homing rockets at distinct targetable enemies (extras double up at random once the field runs out of firsts). Each lands through the ordinary impact path — resists apply — for `effectValue × towerDamage`, then splashes `splashFraction` (0.5) of its hit within `ROCKET_SPLASH_RADIUS` (60 px). Emits `rockets_fired`; each splash pops a decorative `projectile_exploded` |

## Targeted Casts (gameplay plan §4.3)

Rain of Arrows, Frost Nova and Meteor Strike can be **placed**. `PLACEABLE_ABILITIES` in
`src/data/abilities.ts` gives each one a disc; `AbilityManager.tryCast(id, wave, placement?)`
takes an optional point.

| Path | Placement | Focus bonus |
|---|---|---|
| Hotkey with `instantCast` on (default) | `pickBestSpot(id)` — densest cluster in the disc | no |
| Ability bar click | `pickBestSpot(id)` | no |
| `AutomationManager.runAutoCast` | `pickBestSpot(id)` | no |
| Hotkey with `instantCast` off, then a canvas click | the player's click | **yes** |

The focus bonus is what aiming buys, and it is additive rather than restrictive: Rain of Arrows
still hits the whole field and Frost Nova still slows it, but enemies inside the disc take +60%
damage / a 25%-harder chill for 1.5x as long. Meteor Strike relocates its crater instead, its disc
being exactly `METEOR_SPLASH_RADIUS` so a placed meteor is the same meteor somewhere else.

`pickBestSpot` scores enemy positions with `EnemyManager.queryRadius`; Meteor Strike weights by HP
rather than head count, which reproduces the old `pickHighestHpTarget` behaviour whenever a boss is
on the field. The placer sits **behind** `tryCast`, so every automatic path shares it.

Full details, including the placement-mode cancellation rules, are in
[loot-system.md](loot-system.md).

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
   - `chain_damage`: chain lightning starting from the nearest enemy; bounces = `min(9 + talent bonus, 5 + ⌊level/2⌋ + talent bonus)`, damage = `towerDamage × value × 0.65^index × damageMultiplier`
   - `crit_buff`: two buffs — `critChance` additive at `value/100` (clamped to `[0, 1]`) and `critMultiplier` multiplicative at `precisionCritMultiplier(level)`
   - `lifesteal_buff`: `lifesteal` **additive** at `value`, plus a second buff adding `vampiricRegen(level)` to `healthRegen` (fraction of max HP per second)
   - `execute_damage`: kill non-boss enemies below `value%` HP; deal `5×` to boss below `value/2%` HP
   - `rocket_barrage`: fire `floor(effectCount)` homing rockets (`effectCount + 0.3 × (level − 1)`), each for `towerDamage × effectValue` with a half-damage splash in 60 px
6. Emit `ability_cast` and `ability_visual` events. The visual event may carry an optional `target: {x,y}` — Meteor Strike's actual impact point, or the placement disc's centre.

## Tick Logic

- Decrement cooldowns. No event fires when one reaches 0.
- Decrement active durations; on expiry, `clearEffect` removes exactly the `BuffRegistry` ids `applyEffect` set (fire rate, crit, lifesteal/regen, gold).

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

The ability buffs are plain entries in the `BuffRegistry`, keyed by stable ids so a recast replaces its own buff rather than stacking a second copy:

| Buff id | Stat | Kind | Value |
|---|---|---|---|
| `ability:fireRate` | `fireRate` | mult | Berserk's `value × (1 + berserkFireBonus)` |
| `ability:gold` | `goldMultiplier` | mult | Gold Rush's `value` |
| `ability:critChance` | `critChance` | add | Precision Shot's `value / 100`, clamped to `[0, 1]` so combined crit sources can never exceed 100% |
| `ability:critDamage` | `critMultiplier` | mult | `precisionCritMultiplier(level)` |
| `ability:lifesteal` | `lifesteal` | add | Vampiric Aura's grant — additive because most builds have zero base lifesteal |
| `ability:vampiricRegen` | `healthRegen` | add | `vampiricRegen(level)` of max HP per second |

They resolve into `TowerState` like any other stat source (see [stat-pipeline.md](stat-pipeline.md)); the clamps live in the stat-key table (`critChance` maxes at 1, `lifesteal` floors at 0). `Tower` exposes only getters over the composed snapshot — there is no imperative setter for crit or lifesteal — so `rollShot` and `computeStatsInfo` both read already-composed values: fire rate, DPS, crit % and lifesteal % all move while Precision Shot / Berserk / Vampiric Aura are running.

## Research Synergies

- `arcane_mastery` reduces mana cost by 30% (applied multiplicatively to the level-scaled cost).
- `mana_font` increases mana regen by 50%.
- `Arcane Studies` (multiplicative) and Transcendence perks further boost regen.

## Ascension & Transcendence Behaviour

`Game.applySavedStateReset` — which runs on **every ascension** — calls
`AbilityManager.resetLevels()`: every ability returns to level 1 and its banked
XP is wiped. Ability levels are run-scoped now, re-bought with gold each run,
which is why the top-end upgrade bases were lowered when this landed.
Transcendence routes through the same path (`applyFullTranscendenceReset` calls
`applySavedStateReset`), so there is exactly one reset story and no divergence
between the two resets.

## Save Migration

Saves are at **v16** (`SAVE_VERSION` in `src/systems/SaveManager.ts`). The
v15 → v16 step is the ladder's first rename: `migrateV15toV16` moves the
`multishot` key to `rocket_barrage` in both places it appears — the `abilities`
state map (level and XP carried over untouched) and `prestige.autoCastEnabled`
(the player's per-ability on/off choice carried over). See
[save-system.md](save-system.md).

## Cooldown Floor

`Math.max(1, …)` is applied to the effective cooldown, so even at high levels with full Transcendence CDR the cooldown never goes below 1 s.

## Cost Floor

`Math.max(1, Math.ceil(…))` is applied to the effective mana cost, so abilities always cost at least 1 mana.

## Automation Cast Order

Once per second, `AutomationManager.runAutoCast` walks every ability in this fixed priority, casting each one that is ready, enabled and affordable:

```
execute → meteor_strike → chain_lightning → rain_of_arrows → rocket_barrage
  → precision_shot → berserk → vampiric_aura → frost_nova → gold_rush
```

Burst damage first, then buffs, then economy — Execute leads because its value-per-mana is highest on boss waves. A full priority editor was judged more UI than the decision is worth: the player opts individual abilities out instead (`prestige.autoCastEnabled[id] === false`), which the walk honours alongside the wave gates via `canCast`.

## Edge Cases

- **Upgrade while buff is active**: buff continues at its cast level; future casts use new stats.
- **Save migration**: v16 renames `multishot` → `rocket_barrage`; the stored level/XP and auto-cast toggle carry over.
- **Frost Nova display**: internal factor shrinks, UI shows slow %.
- **Cooldown / cost floor**: minimum 1 s / 1 mana even at L10 with full reductions.
- **Ascension / Transcendence**: both reset every ability to L1 and wipe XP — levels are run-scoped.
- **Automation**: `AutomationManager.runAutoCast` already routes through `canCast` and `tryCast`, so it picks up the new wave gates and effective stats for free.
- **Meteor on empty field**: `pickHighestHpTarget()` returns null; the cast silently does nothing (no mana is still spent? — actually mana IS spent first; see `tryCast`). Plan: this matches the no-target edge case for AoE/chain abilities.
- **Rocket Barrage on empty field**: mana is still spent; the rockets leave as non-homing duds in a radial spread with no splash and age out like any other stray shot.
- **Crit cap**: the `critChance` stat clamps to `[0, 1]` so combined crit sources can't exceed 100%.
- **Chain double-hit guard**: a `Set<enemyId>` is built per cast to ensure each enemy is hit at most once.
- **Vampiric regen compounding**: the regen bonus is a buff entry keyed by id, so re-applying it replaces rather than stacks, and a stat recompute during the buff composes with it instead of subtracting it out.

## Core interaction

`AbilityManager.setSlowDurationMult` is the frostwork core's `nova_extended`
behavior (gameplay plan §6.1): abilities whose `effectType` is `slow` run for
twice as long. It is keyed on the **effect type**, not on an ability id, so a
second slow ability would inherit the behavior rather than needing a second
list — and `getEffectiveDuration` is the one place it applies, which is what
keeps the global slow and the ability's own `activeTimer` in step.

The arcane core's +50% ability damage needs nothing here: it resolves through
`abilityDamageMultiplier` in the stat pipeline like every other source. See
[core-system.md](core-system.md).
