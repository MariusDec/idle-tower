# Enemy System

**Files:** `src/systems/EnemyManager.ts`, `src/data/enemies.ts`

## Enemy Types

| Type | baseHP | baseSpeed | Armor | MagicResist | baseDmg | baseGold | Shape | Unlock |
|------|--------|-----------|-------|-------------|---------|----------|-------|--------|
| normal | 10 | 60 | 0 | 0 | 1 | 10 | circle | wave 1 |
| fast | 7 | 120 | 0 | 0 | 1 | 8 | diamond | wave 3 |
| tank | 30 | 30 | 5 | 0 | 1 | 20 | circle | wave 5 |
| flying | 12 | 90 | 0 | 0 | 2 | 15 | winged | wave 8 |
| healer | 15 | 50 | 0 | 0 | 2 | 25 | circle+glyph | wave 15 |
| boss | 100 | 40 | 10 | 0.2 | 5 | 200 | circle+aura | wave 10+ |

## Spawning (`spawn`)

Each enemy gets per-wave scaling:
- **HP:** `baseHP * 1.12^(wave-1)` (boss: `baseHP * 1.12^wave * 1.5^(wave/10 tier)`)
- **Speed:** `baseSpeed * min(3, 1 + 0.03*(wave-1))`
- **Gold:** `baseGold * 1.1^(wave-1)`
- **Damage:** `baseDamage + floor((wave-1)/5)`

## Movement (`tick`)

For each alive enemy:
1. Calculates distance to tower `(tx, ty)`
2. If within `TOWER_HIT_RADIUS + enemy.radius + 2` pixels:
   - Pushes enemy to edge of contact radius (prevents overlap)
   - Starts attacking if not already
   - Applies attack damage on cooldown
3. Otherwise: moves toward tower at `speed * slowFactor * dt`

## Combat

**Damage from tower:** `EnemyManager.damage(enemy, amount, isCrit)`
- Reduces HP, emits `enemy_damaged` event
- If HP <= 0: emits `enemy_killed`, adds gold via `ResourceManager`

**Gold computation** (`computeGold`):
- `base = enemy.goldValue`
- `total = base * (1 + additiveMultiplier) * multiplicativeMultiplier`
- Optional gold luck: `% chance * multiplier`

**Attack on tower:** Accumulated per tick, emitted as `tower_damaged` event (handled in `Game` for armor/defense mitigation)

## Crowd Control

| Method | Effect |
|--------|--------|
| `applySlow(factor, duration)` | Movement speed multiplier (uses min factor, extends duration) |
| `applyKnockback(enemy, force, fromX, fromY)` | Push enemy away from a point |
| `applyShockwave(radius, fromX, fromY)` | Push all enemies within radius to the edge |
| `setGoldMultipliers(additive, multiplicative)` | Affect gold drops |
| `setGoldLuck(chance, multiplier)` | Random gold multiplication |
