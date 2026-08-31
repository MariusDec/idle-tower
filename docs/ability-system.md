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

| Ability | Mana (L1 → max) | CD (s) | Duration (s) | Area (px) | Effect | Hotkey |
|---|:---:|---:|---:|---:|---|:---:|
| Rain of Arrows | 30 → 52 | 12 | instant | 170 | 6.5x tower damage to everything inside the disc | 1 |
| Berserk | 40 → 69 | 30 | 8 | — | Doubles tower fire rate | 5 |
| Frost Nova | 25 → 43 | 18 | 5 | 190 | Global 15% slow, a 72.5% chill inside the disc, and +25% damage to chilled enemies | 2 |
| Chain Lightning | 34 → 58 | 14 | instant | 120 | Seeds at the placed point for 4.0x and arcs to nearby targets; damage decays by 0.82 per bounce | 3 |
| Gold Rush | 50 → 86 | 40 | 12 | — | 2.6x gold drops **and** the loot magnet for the duration | 7 |
| Precision Shot | 35 → 60 | 22 | 6 | — | +30% crit chance and ×1.5 crit damage for 6 s (×2.85 at L10) | 4 |
| Rocket Barrage | 45 → 95 (L15) | 20 | instant | 220 | Fires 6 homing rockets at enemies inside the disc; each deals 1.65x tower damage and splashes half its hit within a 60 px blast | 0 |
| Meteor Strike | 60 → 103 | 25 | instant | 70 | 18x damage to the highest-HP enemy **inside the crater**, 0.55x splash to the rest of it | 6 |
| Execute | 50 → 86 | 30 | instant | — | Kills non-boss enemies below 12% HP; bosses below 6% HP lose 5% of their **max** HP | 8 |
| Vampiric Aura | 45 → 77 | 35 | 8 | — | +6% lifesteal (additive) and +1% maxHP/s regen for 8 s (1% → 5.5% at L10) | 9 |

Areas are quoted in **pre-scale px** — the same units `range` and the enemy codex use, so the
number is directly comparable to the range ring the player already reads. Five of the ten
abilities are targeted; see [Targeted casts](#targeted-casts).

## Upgrades

Each ability is upgradable from level 1 (base) up to `maxLevel` — 10 for every
ability except Rocket Barrage, which goes to 15. Per upgrade level:

| Ability | Upgrade base | Growth | Mana +/lvl | CD -/lvl | Dur +/lvl | Area +/lvl | Effect delta/lvl |
|---|---:|:---:|---:|---:|---:|---:|---|
| Rain of Arrows | 400g | 1.75 | +5 | -0.5 s | 0 | +16 px | +1.15x dmg |
| Berserk | 900g | 1.85 | +6 | -1.0 s | +0.5 s | — | +0.15x fire rate |
| Frost Nova | 1300g | 1.80 | +4 | -0.8 s | +0.6 s | +14 px | -0.025 chill factor, +5% brittle |
| Chain Lightning | 1400g | 1.80 | +3 | -0.4 s | 0 | +8 px | +0.55x dmg; +1 bounce per even level (cap 12) |
| Gold Rush | 3400g | 1.80 | +8 | -1.0 s | +0.6 s | — | +0.30x gold |
| Precision Shot | 3450g | 1.80 | +4 | -0.6 s | +0.4 s | — | +3% crit chance; crit multiplier +0.15x/lvl (1.5 -> 2.85) |
| Rocket Barrage | 12000g | 1.85 | +3 | -0.3 s | 0 | +10 px | +0.21x per rocket **and** +0.3 rockets/lvl (6 -> ~10 at L15) |
| Meteor Strike | 19600g | 1.85 | +6 | -0.5 s | 0 | +9 px | +2.2x dmg |
| Execute | 20000g | 1.85 | +6 | -0.8 s | 0 | — | +2% threshold (12% -> 30%); boss max-HP bite +0.8%/lvl (5% -> 12.2%) |
| Vampiric Aura | 25000g | 1.85 | +5 | -1.0 s | +0.6 s | — | +2% lifesteal (additive); regen +0.5%/lvl (1% -> 5.5%) |

At max level the discs read: Rain of Arrows 314 px, Frost Nova 316 px, Chain Lightning 192 px,
Rocket Barrage 360 px (L15), Meteor Strike 151 px. Every one of them stays inside the arena's
short half-extent, which `npm run checks` asserts.

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
- `manaCost(level) = abilityManaCost(def, level) = round(def.manaCost × (1 + MANA_COST_GROWTH_PER_LEVEL × (level − 1)))`
  — `MANA_COST_GROWTH_PER_LEVEL = 0.08` (a single fraction-of-base shared by every ability, no longer a per-def additive — see `src/data/abilities.ts`)
- `cooldown(level) = max(1, def.cooldown − def.cooldownReductionPerLevel × (level − 1))`
- `duration(level) = def.duration + def.durationPerLevel × (level − 1)`
- `effectValue(level) = def.effectValue + def.effectValuePerLevel × (level − 1)`

`computeEffectiveStats`, `AbilityManager.getBaseManaCost` and the §7
tooltip all route through `abilityManaCost`; there is no longer a
`manaCostPerLevel` per-def field. `Rain of Arrows` ends at L10 on
`round(30 × 1.72) = 52` mana, not 75 — a 1.8x-2.5x growth curve the old
formula produced was strictly worse per mana at max level than at L1 for
four of the ten abilities (see `MANA_COST_GROWTH_PER_LEVEL` for the
worked rationale).

**Example — Rain of Arrows L1 → L10**: damage 6.5× → 16.85×, mana 30 → 52, cooldown 12.0 s → 8.0 s. Total gold spent on upgrades ≈ 143 k before the ability-XP discount.

**Frost Nova display inversion**: the internal chill *factor* shrinks (0.50 → 0.275) but the description and tooltip render `(1 − factor) × 100` as the slow **%**, so the player sees 50% → 72.5%. The global floor outside the disc is a separate, level-independent 15%.

**Execute display**: the threshold is stored as a percent value. The description and tooltip render it directly. Level-ups *raise* the threshold (12% → 30% at L10), so the ability gets **easier** to trigger as it levels — more enemies qualify for the instant-kill. The boss threshold is always half the non-boss one; bosses never get instakilled, they lose `executeBossFrac(level)` of their max HP below it (5% at L1, 12.2% at L10).

## Effect Types

The `AbilityEffectType` union covers all 10 abilities:

| Type | Abilities | Implementation |
|---|---|---|
| `aoe_damage` | Rain of Arrows | **Disc-scoped**: hits every targetable enemy inside `getEffectiveRadius(id)` of the cast point once. A focused cast adds `PLACEMENT_FOCUS_DAMAGE_BONUS` (+25%) across the whole disc |
| `slow` | Frost Nova | Three layers: a **global floor** (`GLOBAL_NOVA_SLOW` = 0.85, level-independent, so an idle player's panic button never regresses), a **disc chill** (`applyChill` at the level-scaled factor, deepened by `PLACEMENT_FOCUS_CHILL` and lengthened by `PLACEMENT_FOCUS_CHILL_DURATION` on a focused cast), and the **brittle buff** `ability:frostBrittle` adding `frostBrittle(level)` (25% +5%/lvl → +70% at L10) to `chilledDamageBonus` for the duration |
| `fire_rate_buff` | Berserk | `BuffRegistry` entry `ability:fireRate`, stat `fireRate`, kind mult at `value × (1 + berserkFireBonus)` |
| `gold_buff` | Gold Rush | `BuffRegistry` entry `ability:gold`, stat `goldMultiplier`, kind mult at `value`, **plus** `LootManager.setMagnetSource('goldRush', true)` for the duration — the orbs a boosted drop rate produces are worth nothing if they age out uncollected. `clearEffect` drops the source |
| `single_target_damage` | Meteor Strike | The crater **is** the ability's disc: the heavy hit goes to the highest-HP targetable enemy inside it, and everything else in the disc takes `METEOR_SPLASH_FRACTION` (**0.55**) of that hit. The splash is a fraction, never a multiple — `npm run checks` guards it |
| `chain_damage` | Chain Lightning | The chain **seeds at the placed point** (tower-centred when there is none); a focused cast reaches +2 extra bounces. Each subsequent bounce picks the nearest unhit enemy within `CHAIN_BOUNCE_RADIUS` (200 px); damage decays by `CHAIN_DECAY` (0.82) per bounce. `chainBounces(level)` is the base hop count (6 → 12 at L13) |
| `crit_buff` | Precision Shot | Two `BuffRegistry` entries — `critChance` **additive** at `value / 100` (clamped to `[0, 1]`) and `critMultiplier` multiplicative at `precisionCritMultiplier(level)` (`1.5 + 0.15 × (level − 1) → 2.85× at L10`), both applied in `rollShot`. The multiplier curve is what makes the upgrade pitch "+10% crit damage per level" real rather than tooltip-only |
| `lifesteal_buff` | Vampiric Aura | Two `BuffRegistry` entries — `lifesteal` **additive** at `+6% (+2%/level)` and `healthRegen` additive at `vampiricRegen(level)` = `1% + 0.5% × (level − 1)` of max HP per second. Additive because most builds carry zero base lifesteal and a ×N multiplier had nothing to multiply; the additive bucket still composes with any lifesteal the player does own |
| `execute_damage` | Execute | Boss threshold = `pct/2`; below it the boss loses `executeBossFrac(level)` of its **max HP** (5% +0.8%/lvl), capped at the bar that is left and deliberately bypassing `applyResists` — an execute a resist can shrug is not an execute. Non-boss = `pct` (instant-kill by dealing `max(1, hp)`). Untargeted: it sweeps the field |
| `rocket_barrage` | Rocket Barrage | Fires `floor(effectCount)` homing rockets at distinct targetable enemies **inside the disc** (extras double up at random once the field runs out of firsts). Each lands through the ordinary impact path — resists apply — for `effectValue × towerDamage`, then splashes `splashFraction` (0.5) of its hit within `ROCKET_SPLASH_RADIUS` (60 px). Emits `rockets_fired`; each splash pops a decorative `projectile_exploded` |

## Targeted casts

Five abilities are **targeted**: Rain of Arrows, Frost Nova, Chain Lightning, Rocket Barrage and
Meteor Strike. A def is targeted iff it carries an `areaRadius`; `isTargeted(id)` is the single
predicate and `placementRadius(id, level)` the single radius formula:

```
placementRadius(id, level) = areaRadius + areaRadiusPerLevel × (level − 1)
effective radius           = placementRadius(id, level) × abilityAreaMultiplier
```

`AbilityManager.getEffectiveRadius(id)` is the only caller anything else should use — it folds in
the level and the stat. `AbilityManager.tryCast(id, wave, placement)` takes a `CastPlacement`,
which is one of exactly three things:

| `placement` | Meaning | Focus bonus |
|---|---|---|
| `{x, y}` | The player pointed here | **yes** |
| `'auto'` | `pickBestSpot(id)` — the densest cluster the disc can cover | no |
| `'tower'` | Centred on the tower | no |

**Routing.** A manual press *always* arms placement: `Game.castAbility` sends any targeted ability
to `beginPlacement(id)`, hotkey and ability-bar click alike, and the resulting canvas press casts
with a `{x, y}`. Automation is the thing that picks a spot for you:
`AutomationManager.runAutoCast` passes `'auto'` when the player's **auto-aim** setting is on
(the default) and `'tower'` when it is off. Untargeted abilities cast immediately from any path.

**What aiming buys.** The disc *is* the effect now — a placed Rain of Arrows hits its disc rather
than the field — so the reward for aiming is a bonus on top of choosing the spot:
`PLACEMENT_FOCUS_DAMAGE_BONUS` (0.25) across the whole disc for damage abilities, a deeper and
1.5x-longer chill for Frost Nova, +2 bounces for Chain Lightning.

`pickBestSpot` scores enemy positions with `EnemyManager.queryRadius`; Meteor Strike weights by HP
rather than head count, which reproduces the old `pickHighestHpTarget` behaviour whenever a boss is
on the field. The placer sits **behind** `tryCast`, so every automatic path shares it.

A placement that lands on empty ground is **refused, not eaten**: no mana is spent and the arming
state stays up. Cancellation rules and the pointer/touch idiom are in
[loot-system.md](loot-system.md) and [ui-system.md](ui-system.md).

## Ability area

`abilityAreaMultiplier` is a plain stat key, base `1`, clamped to `[0.5, 3]` so a stacked build can
neither halve a disc to nothing nor blow it past the arena. `Game.applyResolvedStats` pushes it
into `AbilityManager.setAreaMultiplier`. Its sources:

| Source | Effect |
|---|---|
| Ability level | `areaRadiusPerLevel` per level above 1 (this is radius, not the multiplier) |
| `arcane_expansion` research | +35% ability area (900 RP, 4 h, needs `arcane_mastery`) |
| `ar_frostbite` talent | +5% ability area per point (3 points max) |
| Arcane core | +25% ability area, alongside its +50% ability damage |

See [stat-pipeline.md](stat-pipeline.md) for how the contributors compose.

## Auto-cast conditions

"Is it off cooldown" is not a decision. The mana budget cannot pay for the whole roster, so an
ability may carry an `AutoCastCondition` — a **floor** automation must clear before it spends mana.
A manual cast never consults it.

| Ability | Condition |
|---|---|
| Rain of Arrows | `minInDisc: 3` |
| Berserk | `minEnemies: 4` |
| Frost Nova | `minInDisc: 4` |
| Chain Lightning | `minEnemies: 2` |
| Gold Rush | `minEnemies: 6` |
| Precision Shot | `minEnemies: 3` |
| Rocket Barrage | `minEnemies: 3` |
| Meteor Strike | `minInDisc: 1` |
| Execute | `minEnemies: 1` |
| Vampiric Aura | `towerHpBelow: 0.75` |

The fields are `minEnemies`, `minInDisc` (counted at `pickBestSpot`), `bossOnly`, `bossHpBelow` and
`towerHpBelow`; `AbilityManager.autoCastConditionMet(id)` evaluates them, and an ability with no
condition is always eligible.

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
5. Resolve the `CastPlacement` into a `CastContext` — `{id, point, focused}`. `'tower'` yields the
   tower's position, `'auto'` the `pickBestSpot(id)` result (falling back to the tower), a `{x, y}`
   the player's own point with `focused = true`.
6. Apply the **effective** effect value (level-scaled) through that context:
   - `aoe_damage`: deal `towerDamage × effectValue × damageMultiplier × (focused ? 1.25 : 1)` to every targetable enemy within `getEffectiveRadius(id)` of the cast point
   - `slow`: global `applySlow(GLOBAL_NOVA_SLOW, duration)`, then `applyChill` inside the disc at the level-scaled factor (deeper and 1.5x longer when focused), plus the `ability:frostBrittle` buff
   - `fire_rate_buff`: multiply tower fire rate by `effectValue × (1 + berserkFireBonus)`
   - `gold_buff`: multiply gold drops by `effectValue`
   - `single_target_damage`: hit the highest-HP enemy **inside the crater** for `value×`, then `METEOR_SPLASH_FRACTION` (0.55) of that to the rest of the crater
   - `chain_damage`: chain lightning seeded at the cast point (+2 bounces when focused); bounces = `min(12 + talent bonus, chainBounces(level) + talent bonus)`, damage = `towerDamage × value × 0.82^index × damageMultiplier` |
   - `crit_buff`: two buffs — `critChance` additive at `value/100` (clamped to `[0, 1]`) and `critMultiplier` multiplicative at `precisionCritMultiplier(level)`
   - `lifesteal_buff`: `lifesteal` **additive** at `value`, plus a second buff adding `vampiricRegen(level)` to `healthRegen` (fraction of max HP per second)
   - `execute_damage`: kill non-boss enemies below `value%` HP; take `executeBossFrac(level)` of **max HP** off a boss below `value/2%` HP
   - `rocket_barrage`: fire `floor(effectCount)` homing rockets (`effectCount + 0.3 × (level − 1)`) at targets inside the disc, each for `towerDamage × effectValue` with a half-damage splash in 60 px
7. Emit `ability_cast` and `ability_visual` events. The visual event carries the cast point and the effective radius, so the effect that draws is exactly the disc the reticle promised.

## Tick Logic

- Decrement cooldowns. No event fires when one reaches 0.
- Decrement active durations; on expiry, `clearEffect` removes exactly what `applyEffect` set — the `BuffRegistry` ids (fire rate, crit, lifesteal/regen, gold, frost brittle) and the Gold Rush magnet source.

## Upgrading from the Abilities Panel

Each card has an **Upgrade** button (hidden until the ability unlocks) and a small **Lv X** badge next to the ability name. The button is disabled (red border) when gold is insufficient.

**Tooltip on hover** shows — `src/ui/abilityFormat.ts:renderAbilityTooltip` is the
one writer; both the panel hover and the upgrade popover call it with a
different `AbilityTooltipContext`:

- **Header** — `{name} — Level {cur} → {cur + 1}` (or just `{name} — Level
  {N}` when maxed)
- **Description** — the ability's dynamic `displayText` (level-scaled) or
  the static `def.description` as a fallback
- **Mana cost** — current → next (the next cost uses
  `abilityManaCost(def, level + 1)`, the §6.2 helper)
- **Effect row** — labelled by effect type (`Damage`, `Slow`, `Fire rate`,
  `Gold`, `Crit chance`, `Threshold`, `Lifesteal`, `Rockets`) from
  `EFFECT_LABELS`; sourced from `displayEffectValue` so the formatter
  doesn't reformat strings it didn't build
- **Damage row** — only for damage-dealing effects (`aoe_damage`,
  `single_target_damage`, `chain_damage`, `rocket_barrage`), and only when
  the snapshot has a non-zero `towerDamage` to ground it in. Computes
  `towerDamage × effectValue × rocketCount` and shows the same number
  the projectile system would deal — the player gets a number they can
  reason about, not "exact in the wrong sense"
- **Cooldown** — current → next
- **Duration** — hidden for instant-cast abilities (a "0.0s → 0.0s" row
  lies about whether the ability has a window at all)
- **Area** — only for targeted abilities (the disc is pre-scaled to
  display pixels by the manager)
- **Per-ability extras** — `extraRows(def, level)` in
  `src/ui/abilityFormat.ts`; each ability contributes its own key/values:
  Frost Nova's brittle %, Meteor Strike's splash %, Precision Shot's crit
  multiplier, Chain Lightning's hops + decay, Vampiric Aura's regen
  %/maxHP/s, Execute's boss bonus, Rocket Barrage's splash radius +
  damage. Static values (splash) render without an arrow.
- **Cost** — gold for the next upgrade; `can-afford` / `cannot-afford`
  class drives the colour; suppressed on the popover and when maxed
- **Auto-cast** — every ability's `AutoCastCondition` (`minInDisc`,
  `minEnemies`, `bossOnly`, `bossHpBelow`, `towerHpBelow`) translated to
  a single sentence in `describeAutoCast`
- **XP to next** — current XP / XP needed for the next level; suppressed
  on the popover and when maxed
- **Unlocks** — only when `def.unlockWave > 10` (wave 10 is when mana
  itself unlocks, so anything `≤ 10` is already gated by mana)

CSS classes (`.tooltip-header`, `.tooltip-desc`, `.tooltip-row`,
`.tooltip-row--meta`, `.tooltip-cost`) live in `main.css`; the format
file only emits the markup.

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
| `ability:frostBrittle` | `chilledDamageBonus` | add | Frost Nova's `frostBrittle(level)` (0.25 +0.03/lvl), cleared when the nova expires |

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

Saves are at **v20** (`SAVE_VERSION` in `src/systems/SaveManager.ts`).

- **v15 → v16** is the ladder's first rename: `migrateV15toV16` moves the `multishot` key to
  `rocket_barrage` in both places it appears — the `abilities` state map (level and XP carried over
  untouched) and `prestige.autoCastEnabled` (the player's per-ability on/off choice carried over).
- **v19 → v20** is the ability redesign. There is no state-shape change — levels, XP, cooldowns and
  `autoCastEnabled` all keep their meaning — so `migrateV19toV20` only clamps any stored level into
  `[1, maxLevel]` as a safety net; levels are run-scoped and the redesign changes what a level is
  worth, not how it is stored. The `instantCast` **localStorage preference** (a separate key, not
  part of the save) is read once and carried into `autoCastAutoAim`, then removed.

See [save-system.md](save-system.md).

## Cooldown Floor

`Math.max(1, …)` is applied to the effective cooldown, so even at high levels with full Transcendence CDR the cooldown never goes below 1 s.

## Cost Floor

`Math.max(1, Math.ceil(…))` is applied to the effective mana cost, so abilities always cost at least 1 mana.

## Automation Cast Order

Once per second, `AutomationManager.runAutoCast` walks every ability in this fixed priority, casting each one that is ready, enabled and affordable:

```
meteor_strike → execute → rain_of_arrows → chain_lightning → rocket_barrage
  → berserk → precision_shot → frost_nova → vampiric_aura → gold_rush
```

Meteor and Execute lead **only because their conditions gate them** (`minInDisc: 1` and a populated
field respectively) — an unconditional expensive cast at the top of the list is what starved the
rest of the roster. Rain of Arrows, the best damage-per-mana in the table, sits third and casts on
nearly every tick that has a crowd; the economy buff sits last.

Each candidate must clear four gates in order: the player's opt-out
(`prestige.autoCastEnabled[id] === false`), `canCast` (wave, level, cooldown, mana),
`autoCastConditionMet(id)`, and then it casts with `'auto'` or `'tower'` depending on the auto-aim
setting. A full priority editor was judged more UI than the decision is worth.

## Edge Cases

- **Upgrade while buff is active**: buff continues at its cast level; future casts use new stats.
- **Save migration**: v16 renames `multishot` → `rocket_barrage`; v20 clamps stored levels and migrates the `instantCast` preference to `autoCastAutoAim`.
- **Frost Nova display**: internal factor shrinks, UI shows slow %.
- **Brittle stacking**: `ability:frostBrittle` adds to `chilledDamageBonus` *additively* with the `ar_frostbite` talent — that is the intended composition, and `chilledDamageBonus` only amplifies projectile hits, so the nova cannot amplify its own follow-up nuke.
- **Ability area clamp**: `abilityAreaMultiplier` is clamped to `[0.5, 3]`; a fully stacked area build tops out there.
- **Cooldown / cost floor**: minimum 1 s / 1 mana even at L10 with full reductions.
- **Ascension / Transcendence**: both reset every ability to L1 and wipe XP — levels are run-scoped.
- **Automation**: `AutomationManager.runAutoCast` already routes through `canCast` and `tryCast`, so it picks up the new wave gates and effective stats for free.
- **A placement on empty ground**: refused before any mana is spent — `Game` keeps the arming state up rather than eating the cast. An *automatic* cast on an empty field is prevented earlier by the ability's `autoCast` condition.
- **Rocket Barrage with an empty disc**: the manual path refuses the placement; a `'tower'`-routed cast with nothing in range still spends mana and the rockets leave as non-homing duds that age out like any other stray shot.
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

`AbilityManager.setEchoChance(v)` sets the Spell Echo talent's echo chance;
called from `Game.applyResolvedStats` with `stats.abilityEchoChance`.
