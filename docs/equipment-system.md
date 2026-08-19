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

`rollDrop(wave, source)` where `source` is `'boss' | 'elite' | 'milestone'`.
Each source has its own base chance and per-wave ramp; `setFindChanceBonus`
carries the Lucky Finds talent. The pool is filtered by both `bossOnly` **and**
`minWave`, so a shallow boss cannot drop deep-wave gear.

## Equipping

`equip(slot, id)` / `unequip(slot)` move items between `inventoryList` and
`equippedMap`. `getEquippedBonuses()` returns the summed
`Partial<Record<EquipmentStatType, number>>` that `Game.applyUpgradeEffects`
folds into the stat recompute. `sell(id)` returns `getSellValue(id)` in gold.

## Persistence

Inventory and equipped items survive **both** ascension and transcendence.
Earlier versions wiped the inventory every ascension, which made most runs
generate 2–4 items and then delete them.
