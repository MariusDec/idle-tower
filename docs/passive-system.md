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
  `def.xpBase` is `PASSIVE_XP_LEVEL_WAVES * passiveWaveXpRef(def.unlockWave)`
  — `PASSIVE_XP_LEVEL_WAVES = 10` waves of play at the wave the passive
  unlocks at. This is the fix for the old system's headline defect: one
  shared requirement table against a faucet that grew with the live wave
  meant a wave-65 passive gained ten levels in its first wave.
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
