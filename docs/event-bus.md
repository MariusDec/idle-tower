# Event Bus

**File:** `src/game/EventBus.ts`

## Interface

```typescript
class EventBus {
  on<T>(event: string, handler: (payload: T) => void): () => void  // returns unsubscribe fn
  emit<T>(event: string, payload?: T): void
  clear(): void
}
```

Simple typed pub/sub. `on()` returns a dispose function. Errors in handlers are caught and logged.

## Event Catalog

| Event | Payload | Emitter | Consumer(s) |
|-------|---------|---------|-------------|
| `enemy_damaged` | `{ enemy, amount, killed, isCrit }` | EnemyManager | Game (lifesteal, effects) |
| `enemy_killed` | `Enemy` | EnemyManager | Game (stats, effects, gold) |
| `enemies_reached_tower` | `Enemy[]` | EnemyManager | Game (toast, currently disabled) |
| `tower_damaged` | `number` (raw damage) | EnemyManager | Game (armor/defense calc, HP) |
| `wave_started` | `number` (wave) | WaveManager | Game (milestone check) |
| `wave_cleared` | `number` (wave) | WaveManager | — |
| `gold_changed` | `number` (gold) | ResourceManager | — |
| `mana_changed` | `number` (mana) | ResourceManager | — |
| `upgrade_purchased` | `{ id, level }` | UpgradeManager | UIManager |
| `upgrades_changed` | `Record<string, number>` | UpgradeManager | Game (recalc effects) |
| `ability_cast` | `{ id, def }` | AbilityManager | UIManager (toast, flash) |
| `ability_visual` | `{ id, def }` | AbilityManager | Game (particle effects) |
| `ability_ready` | `{ id }` | AbilityManager | — |
| `ability_upgraded` | `{ id, level }` | AbilityManager | UIManager (toast, flash), Game (save) |
| `aoe_hit` | `{ hitCount, totalDamage, perEnemy }` | AbilityManager | — |
| `projectile_fired` | `{ projectile, isCrit }` | ProjectileManager | — |
| `ascension_performed` | `{ apGained, rpGained, totalAP, lifetimeAP, ascensions }` | PrestigeManager | — |
| `transcendence_performed` | `{ tpGained, totalTP, transcendences }` | PrestigeManager | — |
| `ap_spent` | `{ id, level }` | PrestigeManager | — |
| `tp_spent` | `{ id, level }` | PrestigeManager | — |
| `automation_unlocked` | `{ key: AutomationKey }` | PrestigeManager | Game (toast) |
| `automation_toggled` | `{ key, enabled }` | PrestigeManager | — |
| `research_unlocked` | `{ id }` | ResearchTree | Game (recalc, toast) |
| `rp_changed` | `{ rp, delta }` | ResearchTree | — |
| `toast` | `{ kind, text, life? }` | Any | NotificationManager |
| `welcome_back` | `{ result, startWave, endWave }` | Game | UIManager (modal) |
| `run_ended` | `{ record: RunRecord, previous: RunRecord \| null }` | Game (ascend/transcend) | UIManager (RunSummaryModal) |
| `save_failed` | `{ success }` | SaveManager | — |
| `tower_leveled` | `{ level, xp, talentPoints }` | TowerXpManager | — |
| `talent_allocated` | `{ talentId, points, totalSpent }` | TalentManager | — |
| `passive_leveled` | `{ id, level }` | PassiveAbilityManager | — |
| `equipment_dropped` | `{ equipment }` | EquipmentManager | — |
| `equipment_equipped` | `{ slot, equipment }` | EquipmentManager | — |
| `equipment_unequipped` | `{ slot }` | EquipmentManager | — |
| `multishot_fired` | `{ count, totalDamage }` | AbilityManager | — |
