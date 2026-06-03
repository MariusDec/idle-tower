# Projectile System

**File:** `src/systems/ProjectileManager.ts`

## Projectile State

```typescript
interface Projectile {
  id: number;
  x, y: number;          // position
  targetId: number|null; // which enemy it's aimed at
  vx, vy: number;        // velocity (pixels/sec)
  damage: number;        // damage on hit (after multipliers)
  damageType: 'physical'|'magic';
  isCrit: boolean;
  alive: boolean;
}
```

## Firing (`fire`)

Called from `Game.update` when tower cooldown is ready.

1. Calculate direction from tower to target (or aim point)
2. Normalize, scale by `PROJECTILE_SPEED = 720`
3. Apply damage multipliers (additive + multiplicative)
4. For each shot variant (main + extra/scatter/back shots):
   - Rotate velocity by angle offset
   - Offset launch position
   - Create projectile, emit `projectile_fired`

**Shot variants** (from AP perks in `Game.buildShotVariants`):
- Extra shots: parallel offset left/right
- Scatter shots: angled spread (30° + 15° per level)
- Back shots: 180° reverse

## Movement & Collision (`tick`)

1. Move: `pos += velocity * dt`
2. Check collision with each enemy: `distance < enemyRadius + 6`
3. On hit:
   - Apply resistances via `Tower.applyResists`
   - Call `enemyMgr.damage(enemy, final, isCrit)`
   - If not killed: apply knockback if tower has it
   - If piercing: decrement pierce count, keep projectile alive
   - Otherwise: mark projectile dead
4. Cleanup: remove off-screen or dead projectiles

## Piercing

- Research nodes `piercing_shots` and `improved_pierce` add pierce count
- Each projectile tracks `piercingRemaining[id]` (number of extra enemies it can hit)
- Default pierce max = `1 + pierceExtra`
- Piercing projectiles stay alive after hitting an enemy

## Damage Multipliers

- `setDamageMultipliers(additive, multiplicative)` — additive bonus + multiplicative factor
- Applied: `finalDamage = rawDamage * (1 + additive) * multiplicative`

## Public API

| Method | Purpose |
|--------|---------|
| `fire(target, towerState, opts)` | Create projectile(s) |
| `tick(dt)` | Movement + collision |
| `reset()` | Clear all projectiles |
| `setDamageMultipliers(a, m)` | Update damage bonuses |
| `setPierceExtra(n)` | Set additional pierce count |
