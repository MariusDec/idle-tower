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

## Selling

An item's `level` is the wave it dropped on (`generateEquipment(defId, rarity,
wave)`). Nothing in the stat pipeline reads it — rarity alone carries an item's
power — but `equipmentSellValue` does:

```
floor(SELL_BASE_VALUE x GOLD_GROWTH^(level - 1) x SELL_RARITY_MULT[rarity])
```

That is the same curve enemy gold follows, so a sale holds a fixed *relative*
worth at any depth: roughly 7% of a wave's income for a common and most of a
wave for a legendary. The previous formula was `10 x rarityMult` with no level
term at all, which sold a legendary pulled off wave 80 for 500g in an economy
paying tens of thousands per wave. Rarity now multiplies by at most 16x rather
than 50x, because the level term carries the growth instead.

Items from pre-`level` saves all read `level: 1`; `equipmentSellValue` floors
the level at the def's `minWave` so an old deep-wave piece is not valued at
wave-1 rates.

## Reforging

`rollRarity`'s depth ramp saturates at wave 100, so from there on every drop is
rolled from the same distribution however deep the run gets — gear is a solved
axis (plans/progress.md §7.5). Reforging is the sink that unsticks it, and it
gives gold a second late home now that upgrade ceilings rise with the player.

`EquipmentManager.reforge(ids, gold)` takes exactly `REFORGE_INPUTS` (**3**)
inventory items **of the same rarity** and returns one of the **next rarity
up**, rolled at the **deepest input's level**. It is deliberately
slot-agnostic: the point is to give a pile of redundant same-tier drops
somewhere to go, and a slot match would make the sink depend on which slots
happened to drop. The result's slot is rolled fresh, so a reforge is a trade,
not an upgrade of one particular item.

- **Cost:** `equipmentSellValue` of the most valuable input x
  `REFORGE_COST_MULT` (**3**), so the sink scales with wave income exactly the
  way the sell curve does.
- **Legendaries** have no tier left to climb, so they climb in *level*:
  `deepest + REFORGE_LEGENDARY_LEVEL_GAIN` (**+25**), which is what keeps both
  the stat roll and the sell value moving after the rarity ladder runs out.
- **All-or-nothing.** `previewReforge` is the same guard the action runs, so
  an illegal set or short gold consumes nothing — a partial reforge would
  destroy items for no result. Equipped items live in `equipped`, not
  `inventory`, so a reforge can never strip the tower mid-run.

The panel marks items with a per-card **Reforge** toggle — a separate selection
from the tap-to-equip one, so an accidental equip-tap is never part of a set
that destroys three items — and one button under the grid that carries the real
cost and result, disabled until the set is legal and affordable.

## Persistence

Inventory and equipped items survive **both** ascension and transcendence.
Earlier versions wiped the inventory every ascension, which made most runs
generate 2–4 items and then delete them.
