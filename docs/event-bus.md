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
| `tower_damaged` | `number` (raw damage) | EnemyManager (melee **and** siege shells), Game (thorns) | Game (the single mitigation chain: dodge → research DR → mana-shield evolution → wall → shield → armour → defense → mana-shield talent) |
| `shield_break` / `shield_restored` | `{ x, y }` | EnemyManager | Game (shielded charge feedback) |
| `ward_projected` | `{ x, y, count, amount }` | EnemyManager | Game (warden ring) |
| `ward_absorbed` | `{ x, y, amount }` | EnemyManager | Game (absorb flash) |
| `siege_fired` / `siege_impact` | `{ x, y }` | EnemyManager | Game (audio, impact burst) |
| `enemy_blinked` | `{ x, y, toX, toY }` | EnemyManager | Game (blink ring) |
| `burrower_surfaced` | `{ x, y }` | EnemyManager | Game (surface burst) |
| `gold_stolen` / `gold_recovered` / `gold_escaped` | `{ x, y, amount }` | EnemyManager | Game (toasts) |
| `boss_spawned` | `{ enemy, wave, pattern }` | EnemyManager | Game (starts the encounter clock and flawless flag) |
| `boss_phase` | `{ enemy, phase, pattern, x, y }` | EnemyManager | Game (slow-mo, pulse, pattern toast) |
| `boss_shield_up` / `boss_shield_broken` | `{ enemy, x, y }` | EnemyManager | Game (bulwark rings) |
| `boss_bulwark_held` | `{ enemy, x, y, amount }` | EnemyManager | Game (heal number + warning toast) |
| `boss_summon` | `{ enemy, x, y, count }` | EnemyManager | Game (summon burst) |
| `boss_slam_telegraph` | `{ enemy, x, y, duration }` | EnemyManager | Game (audio hook; the ring and bar read state) |
| `boss_slam` | `{ enemy, x, y, damage, mitigated }` | EnemyManager | Game (shake, flash) — also emits `tower_damaged` |
| `boss_enrage_stack` | `{ enemy, stacks, x, y }` | EnemyManager | Game (one-time enrage warning) |
| `boss_enraged` | `{ enemy }` | EnemyManager | — (pre-existing 50%-HP enrage) |
| `boss_killed` | `{ x, y, goldValue }` | Game | AudioManager |
| `wave_started` | `number` (wave) | WaveManager | Game (milestone check) |
| `wave_cleared` | `number` (wave) | WaveManager | — |
| `gold_changed` | `number` (gold) | ResourceManager | — |
| `mana_changed` | `number` (mana) | ResourceManager | — |
| `upgrade_purchased` | `{ id, level, levelsGained, goldSpent }` | UpgradeManager | UIManager, Game (purchase counter + contracts' `spend_gold`) |
| `upgrades_changed` | `Record<string, number>` | UpgradeManager | Game (recalc effects) |
| `ability_cast` | `{ id, def }` | AbilityManager | UIManager (toast, flash) |
| `ability_visual` | `{ id, def, target? }` | AbilityManager | Game (particle effects) |
| `ability_upgraded` | `{ id, level }` | AbilityManager | UIManager (toast, flash), Game (save) |
| `projectile_fired` | `{ projectile, isCrit }` | ProjectileManager | — |
| `projectile_exploded` | `{ x, y, radius }` | ProjectileManager (splash impacts) | Game (decorative ring + sparks), AudioManager (throttled boom) |
| `ascension_performed` | `{ apGained, rpGained, totalAP, lifetimeAP, ascensions }` | PrestigeManager | — |
| `transcendence_performed` | `{ tpGained, totalTP, transcendences }` | PrestigeManager | — |
| `ap_spent` | `{ id, level }` | PrestigeManager | — |
| `tp_spent` | `{ id, level }` | PrestigeManager | — |
| `automation_unlocked` | `{ key: AutomationKey }` | PrestigeManager | Game (toast) |
| `automation_toggled` | `{ key, enabled }` | PrestigeManager | — |
| `research_unlocked` | `{ id }` | ResearchTree | Game (recalc, toast) |
| `rp_changed` | `{ rp, delta }` | ResearchTree | — |
| `contract_drawn` | `{ uid, id, name, label }` | ContractManager | Game (state snapshot), UIManager (tracker refresh) |
| `contract_completed` | `{ uid, id, name, label, wave, reward }` | ContractManager | Game (pays the reward, applies the AP cap's result) |
| `contract_reward` | `{ uid, rewardText }` | Game | UIManager (tracker flourish) — emitted *after* the payout, which is why the tracker listens here and not on `contract_completed` |
| `toast` | `{ kind, text, life? }` | Any | NotificationManager |
| `welcome_back` | `{ result, startWave, endWave }` | Game | UIManager (modal) |
| `run_ended` | `{ record: RunRecord, previous: RunRecord \| null }` | Game (ascend/transcend) | UIManager (RunSummaryModal) |
| `save_failed` | `{ success }` | SaveManager | — |
| `tower_leveled` | `{ level, xp, talentPoints }` | TowerXpManager | — |
| `tower_mark_changed` | `{ id, step, def }` | Game | Game (toast + forge flourish) |
| `talent_allocated` | `{ talentId, points, totalSpent }` | TalentManager | — |
| `passive_leveled` | `{ id, level }` | PassiveAbilityManager | — |
| `equipment_dropped` | `{ equipment }` | EquipmentManager | — |
| `equipment_equipped` | `{ slot, equipment }` | EquipmentManager | — |
| `equipment_unequipped` | `{ slot }` | EquipmentManager | — |
| `rockets_fired` | `{ count, totalDamage }` | AbilityManager (Rocket Barrage) | AudioManager (launch whoosh) |
