# Achievements

18 milestone unlocks that grant permanent multipliers. `AchievementManager`,
`src/data/achievements.ts`.

Categories: `combat`, `wave`, `economy`, `prestige`, `mastery`.

Each `AchievementDef` names a `stat` and a `threshold`; `tick(dt)` polls the
stats snapshot supplied by `AchievementContext` and emits
`achievement_unlocked` when one crosses.

## Rewards must have a consumer

`AchievementRewardType` is a closed union, and
`ACHIEVEMENT_REWARD_CONSUMERS` is a `Record` over it naming where each type is
actually read:

| Reward | Consumer |
|---|---|
| `damage_mult`, `all_damage`, `all_stats` | `Game.applyUpgradeEffects` → `tower.baseDamage` |
| `fire_rate_mult` | `Game.applyUpgradeEffects` → `tower.fireRate` |
| `gold_mult` | `Game.computeGoldBreakdown` |
| `boss_gold_mult` | `Game`'s `enemy_killed` handler, boss branch |
| `start_gold` | `Game.applySavedStateReset` |
| `extra_projectile` | `Game.buildShotVariants` |
| `ap_gain_mult`, `prestige_gain_mult` | `PrestigeManager.previewAP` |
| `tp_gain_mult`, `prestige_gain_mult` | `PrestigeManager.previewTP` |
| `rp_gain_mult` | `Game.rpGainMultiplier` |
| `ability_cdr` | `Game.applyUpgradeEffects` → `AbilityManager` |
| `max_hp_mult` | `Game.applyUpgradeEffects` → `tower.maxHp` |
| `upgrade_cost_reduction` | `Game.applyUpgradeEffects` → `UpgradeManager.setCostDiscount` |

Because the map is a `Record` over the union, a new reward type cannot be added
without deciding which system reads it. Nine reward types previously shipped
with no consumer at all.

`getRewardMultiplier(type)` sums `reward.value` across every unlocked
achievement of that type. It returns an additive total — callers apply it as
`1 + total`.

## Known gap

`all_stats` has consumers but no achievement grants it, so those reads are
permanently zero. Pinned in `tests/content-coverage.test.ts` under
`KNOWN_UNGRANTED`.

## Persistence

Unlocked achievements survive both prestige layers.
