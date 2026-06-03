# Resource System

**File:** `src/systems/ResourceManager.ts`

## Resources

| Field | Default | Description |
|-------|---------|-------------|
| `gold` | 0 | Currency for upgrades |
| `mana` | 0 | Resource for abilities |
| `maxMana` | 100 | Mana cap |
| `manaRegen` | 2 | Base mana per second |
| `ascensionPoints` | 0 | AP (prestige currency) |
| `transcendencePoints` | 0 | TP (higher prestige currency) |
| `lifetimeAP` | 0 | Total AP ever earned |
| `lifetimeGold` | 0 | Total gold ever earned |

## Income

**Gold sources:**
- Enemy kills: `goldValue * (1 + additiveMultiplier) * multiplicativeMultiplier`
- Passive income: `0.1 * wave` per second from `tick()`
- Offline progress (see SaveManager)
- Gold Rush ability buff (multiplicative)

**Mana sources:**
- Passive regen: `manaRegen` per second (capped at `maxMana`)
- Mana Font research (multiplicative boost)
- Meditation upgrade (additive boost)
- Unlocks at wave 10

## Spending

| Method | Cost | Validation |
|--------|------|------------|
| `spendGold(amount)` | Gold | Must have enough |
| `spendMana(amount)` | Mana | Must have enough |
| `canAfford(amount)` | Gold | Returns boolean |

## Events Emitted

- `gold_changed` — current gold value
- `mana_changed` — current mana value

## Passive Gold

- `passiveGoldInterval` = 1 second
- Each tick accumulates `dt`, when >= interval: `addGold(0.1 * wave)`
- Resets to 0 on run reset
