# Ability System

**Files:** `src/systems/AbilityManager.ts`, `src/data/abilities.ts`

## Overview

4 active abilities unlocked at wave 10 (mana system unlocks). Cost mana, have cooldowns, some have durations.

## Abilities

| ID | Name | Mana | Cooldown | Duration | Effect | Hotkey |
|----|------|------|----------|----------|--------|--------|
| rain_of_arrows | Rain of Arrows | 30 | 15s | instant | Deal 5x tower damage to all enemies | 1 |
| frost_nova | Frost Nova | 25 | 20s | 5s | Slow all enemies by 50% | 2 |
| berserk | Berserk | 40 | 30s | 8s | Double fire rate | 3 |
| gold_rush | Gold Rush | 50 | 60s | 15s | Triple gold drops | 4 |

## Mana System

- Mana unlocks at wave 10
- Mana regenerates passively via `ResourceManager.tick()`
- Mana cost can be reduced via Arcane Mastery research (up to 90%)

## Casting Logic (`tryCast`)

1. Check `canCast`: mana unlocked, ability exists, level > 0, cooldown ready, enough mana
2. Spend mana
3. Set cooldown
4. If has duration, set active + activeTimer
5. Apply effect:
   - `aoe_damage`: deal `towerDamage * multiplier` to each alive enemy
   - `slow`: apply slow factor to all enemies (via EnemyManager)
   - `fire_rate_buff`: multiply tower fire rate
   - `gold_buff`: multiply gold drops
6. Emit `ability_cast` and `ability_visual` events

## Tick Logic

- Decrement cooldowns, emit `ability_ready` when reaching 0
- Decrement active durations, clear effects when expired
- Apply ongoing buffs each tick (fire rate multiplier, gold multiplier)

## Research Synergies

- `arcane_mastery` reduces mana cost by 30%
- `mana_font` increases mana regen by 50%
