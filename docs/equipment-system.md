# Equipment

Randomly-rolled gear in 8 slots, dropped by bosses, elites and milestones.
`EquipmentManager`, `src/data/equipment.ts`.

## Slots and rarity

Slots: `turret`, `bulwark`, `arsenal`, `brazier`, `vault`, `machinery`,
`banner`, `core`.

Rarities and their roll weights (`RARITY_WEIGHTS`): common 50, uncommon 30,
rare 15, epic 4, legendary 1. `rollRarity(wave)` biases the roll upward with
depth. Rarity selects which stat array an item rolls from.

`EquipmentStatType` covers damage, fire rate, crit chance/damage, range, max
HP, defense, armor, gold multiplier, mana regen, lifesteal, thorns, knockback
and all-damage — all as `_pct`.

## Drops

`EquipmentManager.rollDrop(wave, source, options?)` where `source` is
`'boss' | 'elite' | 'milestone'` and `options` is `{ guaranteed?: boolean;
rarityBoost?: number }`. The call has **two layers**:

- **The chance is flat in wave.** Elite drops roll at 12% with a 25% cap;
  boss drops roll at 30% with a 60% cap. A wave at 150 drops at the same rate
  as a wave at 20 — `chanceForSource` does not ramp with depth. What depth
  *does* move is **rarity** (`rollRarity(wave)` biases the roll upward), so
  deeper waves yield the *same number of pieces*, but pieces that are more
  likely to be rare or epic.
- **One roll per source, per wave.** `EquipmentManager.beginWave()` resets
  `rollsThisWave`; the manager spends at most one elite roll and one boss
  roll no matter how many elites die. A wave's expected gear is therefore
  `1 × chance` for elites and `1 × chance` for the boss, independent of
  spawn count. Milestones have no budget cap.

A drop listed `{ guaranteed: true }` bypasses the budget — the swift-kill
reward and a Windfall chest are *earned*, not farmed, so they must be
honourable even on a wave that already burned its roll.

The pool is filtered by both `bossOnly` **and** `minWave`, so a shallow boss
cannot drop deep-wave gear. `setFindChanceBonus` carries the Lucky Finds
talent.

## Equipping

`equip(slot, id)` / `unequip(slot)` move items between `inventoryList` and
`equippedMap`. `getEquippedBonuses()` returns the summed
`Partial<Record<EquipmentStatType, number>>` that the stat pipeline
folds into the stat recompute. `sell(id)` returns `getSellValue(id)` in gold.

## Persistence

Inventory and equipped items survive **both** ascension and transcendence.
Earlier versions wiped the inventory every ascension, which made most runs
generate 2–4 items and then delete them.
