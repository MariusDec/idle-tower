# Automation System

**File:** `src/systems/AutomationManager.ts`

## Overview

4 automation features unlocked via prestige perks. Each runs on a timer checked in `tick(dt)`.

## Features

| Feature | Unlock | Interval | Behavior |
|---------|--------|----------|----------|
| Auto-Buy | ap_auto_upgrader or tp_auto_buy | 10s | Buys cheapest affordable upgrade |
| Auto-Cast | tp_auto_cast | 5s | Casts first available ability in priority order: Rain of Arrows → Berserk → Frost Nova → Gold Rush |
| Auto-Ascend | tp_auto_ascend | 1s | Ascends if highestWave >= targetAscendWave |
| Auto-Transcend | tp_auto_transcend | 5s | Transcends if AP >= 100 |

## Tick Logic

For each enabled feature:
- Accumulate timer with `dt`
- When timer >= interval, execute action and reset timer
- If feature is disabled, timer stays at 0

## Auto-Buy Priority

Fetches all non-maxed, affordable upgrades, sorts by cost ascending, buys cheapest.

## Dependencies

- `UpgradeManager` — to check costs and buy
- `AbilityManager` — to check mana/cooldown and cast
- `PrestigeManager` — to check canAscend/canTranscend and automation flags
- `GameState` — to check highestWave, resources

Timers reset to 0 on transcendence (`reset()`).
