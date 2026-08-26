# Passive Abilities

8 always-on bonuses, unlocked with gold behind a wave gate and levelled by a
mix of gold and kill XP. `PassiveAbilityManager`, `src/data/passiveAbilities.ts`.

| id | Effect stat |
|---|---|
| `passive_markmanship` | crit chance |
| `passive_fortitude` | max HP |
| `passive_scavenger` | gold multiplier |
| `passive_haste` | fire rate |
| `passive_mana_spring` | mana regen |
| `passive_thorns_aura` | thorns |
| `passive_precision` | crit damage |
| `passive_life_steal` | lifesteal |

## Unlock and upgrade

- `canUnlock(id, wave)` gates on `highestWave`; `getUnlockCost(id)` is gold.
- **Unlocking grants `basePercent` immediately.** `getEffectValue` used to
  return 0 while `level === 0`, so the purchase did nothing at all until the
  first upgrade.
- `getUpgradeCost(id)` is gold, discounted by accumulated XP;
  `passiveUpgradeCost(def, level)` is the undiscounted curve.

## XP track

`addKillXp` / `addWaveClearXp` feed `passiveXpForLevel(level)`
(`75 * level^1.9`), scaled by `PASSIVE_XP_MULTIPLIER`. `passiveXpPerKill(def,
wave)` replaces the old `enemyXpWeight` — it uses the same `killXpWaveScale` as
tower kill XP with a 0.25 factor that keeps the passive track's pace where it
is today. Before the re-tune, reaching a passive's max level needed roughly six
million kills and the XP bar was decoration.

## Persistence

Passive levels survive **both** ascension and transcendence — they are
character progression, like talents. This was settled in Part 3; earlier
versions wiped them on ascension.
