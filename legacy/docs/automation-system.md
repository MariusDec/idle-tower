# Automation System

**File:** `src/systems/AutomationManager.ts`

## Overview

4 automation features unlocked via prestige perks or long-Watch
content unlocks. Each runs on a timer checked in `tick(dt)`; auto-buy
also has a **per-tick budget** (the Auto-Upgrader perk level) and a
**strategy** (which upgrade to favour). The whole feature set now lives
under a dedicated **Automation tab** in the `prestige` group of
`NAV_GROUPS` — the controls that used to live on the Transcendence
panel (`AutomationPanel`) moved out of it. See [ui-system.md](ui-system.md).

## Features

| Feature | Unlock | Interval | Behavior |
|---------|--------|----------|----------|
| Auto-Buy | `ap_auto_upgrader` perk (12 / 24 / 48 AP across 3 levels) **or** Watch `overseer` chapter-7 unlock **or** Transcendence | 10 s | Buys up to **N** affordable upgrades per tick — see [Auto-Buy strategy](#auto-buy-strategy) |
| Auto-Cast | `tp_auto_cast` | 5 s | Casts first available ability in priority order; see [Ability-system: Automation Cast Order](ability-system.md#automation-cast-order) |
| Auto-Ascend | `tp_auto_ascend` | 1 s | Ascends if `highestWave >= targetAscendWave` |
| Auto-Transcend | `tp_auto_transcend` | 5 s | Transcends if AP ≥ 100 |

## Auto-Buy strategy

Auto-buy has three strategies (`AutoBuyStrategy`):

| Strategy | Hint |
|---|---|
| `cheapest` | Always buys the cheapest affordable upgrade. Fastest level count, weakest tower. |
| `balanced` | Levels every upgrade evenly, cheapest first among the least-levelled. |
| `damage` | Buys tower upgrades first, then economy, defense and utility. |

`AutomationManager.runAutoBuy` fetches all non-maxed, affordable upgrades,
applies the strategy sort, then buys the first **N** of them where **N
comes from `PrestigeManager.getAutoBuyCount()`** — the Auto‑Upgrader
perk's level. L1 buys one upgrade per interval, L3 buys three. The
control surface (`AutomationPanel`) shows the current N on the
"Buys N upgrades per tick" line and re-reads it on every UI tick.

`Strategy` and `reserve` (the fraction of gold held back) are part of the
`AutomationPanel` panel's local UI state; `Game` owns them and the panel
plumbs changes back through `onAutoBuyStrategyChange(strategy)` and
`onAutoBuyReserveChange(fraction)`.

## Per-tick budget — `PrestigeManager.getAutoBuyCount()`

The perk's level is the budget. `getAutoBuyCount()` returns:

```
getAutoBuyCount() =
  getAPLevel('ap_auto_upgrader') > 0
    → return that level                  (1 / 2 / 3)
  : isAutomationUnlocked('autoBuy')
    → return 1                            (Watch `overseer` grant)
  : return 0
```

Returns `0` when auto-buy is not unlocked at all, which is what stops
`AutomationManager.runAutoBuy` from running a budget it has no
permission for. The Watch's `overseer` unlock has no level, so it
counts as one — a single manual perk purchase would have granted
the same.

The `AutomationPanel` reads `getAutoBuyCount` from its handler
`AutomationPanelHandlers.getAutoBuyCount` to render the live "Buys N
upgrades per tick" line; the `automation` group has the controls but
the budget reads from `prestige` via the dep injection in
`AutomationDeps`.

## Tick Logic

For each enabled feature:
- Accumulate timer with `dt`
- When timer ≥ interval, execute action and reset timer
- If feature is disabled, timer stays at 0

For auto-buy specifically the loop runs **N** times — once per unit of
the budget — and each iteration fetches the affordable list again so a
strategy-driven sort doesn't accidentally spend the budget on rows that
became unaffordable mid-loop.

## Dependencies

- `UpgradeManager` — to check costs and buy
- `AbilityManager` — to check mana/cooldown and cast, `upgradeAbility(id)` for Quartermaster
- `PrestigeManager` — to check canAscend/canTranscend and automation flags;
  `getAutoBuyCount()` to read the per-tick budget; `isAutomationUnlocked(key)`
  to gate features
- `GameState` — to check `highestWave`, resources, target ascend wave
- `TalentManager` — `hasTalentBehavior(b)` for Quartermaster hooks

Timers reset to 0 on transcendence (`reset()`).

## Automation tab (was: Transcendence panel)

Plan §4 moved all automation controls out of `TranscendencePanel` into a
new `AutomationPanel` mounted as the third tab of the `prestige` nav
group (`NAV_GROUPS[2]`):

```ts
{
  id: 'prestige', label: 'Prestige', icon: 'star-gate',
  tabs: [
    { id: 'prestige', label: 'Prestige' },
    { id: 'transcendence', label: 'Transcendence' },
    { id: 'automation', label: 'Automation' },
  ],
},
```

`TranscendencePanel` now carries the TP perk tree and *nothing else*;
the strategy chips, reserve slider, target-ascend wave input and the
four on/off toggles (auto-buy, auto-cast, auto-ascend, auto-transcend)
all sit on the Automation tab. The `UIManager.automationPanel` field
mounts `AutomationPanel` and `setOnToggleAutomation` /
`setOnTargetWaveChange` / `setOnAutoBuyStrategyChange` /
`setOnAutoBuyReserveChange` setters wire the handlers into `Game`.
The `AutomationPanelHandlers` interface in `src/ui/AutomationPanel.ts`
is the contract `UIManager` fulfils.