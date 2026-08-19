# The Tower — Improvements Plan

**Date:** 2026-08-19
**Scope reviewed:** full `src/` tree (24.7k LOC), all data tables, save/offline path, and a numeric
model of the wave/gold/upgrade curves. `npx tsc --noEmit` passes cleanly — every issue below is a
*runtime/design* problem, not a compile error.

---

## 0. Executive summary

The game has an unusually large amount of *content* for its size: 28 upgrades with evolutions, 10
active abilities, 37 talents, 8 passives, 8 equipment slots, 2 prestige layers, 14 research nodes,
9 wave mutators, elites with 5 auras, achievements. The problem is not a lack of systems — it is
that a large fraction of that content **is not wired to anything**, and the parts that are wired
fight each other because every system writes directly into one shared mutable `TowerState`.

Three findings dominate everything else:

1. **The stat pipeline is last-writer-wins.** `Game.applyUpgradeEffects()` calls
   `enemyMgr.setGoldMultipliers(...)` six separate times, each *overwriting* the previous one, and
   then `AbilityManager.applyOngoingBuffs()` overwrites it again **every frame** with the raw
   upgrade-only value. Net effect: gold bonuses from prestige, research, achievements, talents,
   passives, equipment and wave mutators do nothing. The same pattern silently disables the Berserk
   fire-rate buff.
2. **~20 of 37 talents, 9 of 19 achievement rewards, and the entire equipment level system are
   inert.** They render, cost points/gold, and change no number.
3. **The in-run economy diverges from the in-run difficulty by design accident.** Enemy HP scales
   `1.17^wave`, gold `1.05^wave`, and gold→damage conversion is roughly `damage ∝ gold^0.33`. A
   fresh run needs ~41 minutes to reach the ascension unlock at wave 30 and stalls at ~wave 37;
   a 100× increase in lifetime AP buys only ~15 more waves.

Fixing (1) and (2) is mostly mechanical and will make the game feel dramatically more responsive
without adding any content. (3) needs a deliberate re-tune, described in Part 2 with numbers.

**Recommended order:** Phase 1 (correctness) → Phase 2 (stat pipeline refactor) → Phase 3 (balance
re-tune with a sim harness) → Phase 4 (system depth) → Phase 5 (UX/QoL) → Phase 6 (perf/tech debt).

---

## Part 1 — P0: bugs that silently delete content

> **Status: implemented (2026-08-19).** All of 1.1–1.9 are fixed in the working
> tree; `tsc --noEmit` and `vite build` are clean and each fix was verified in a
> running browser (see the verification notes at the end of this part). The
> architectural follow-up in Part 6 is still outstanding — the fixes below
> establish single-writer ownership per stat, but not yet the full pipeline.

These are ordered by how much player-visible power they destroy.

### 1.1 All gold multipliers except the base upgrade are discarded

`AbilityManager.applyOngoingBuffs()` runs on every `tick` and ends with:

```ts
// src/systems/AbilityManager.ts:356
this.enemies.setGoldMultipliers(this.upgradeGoldAdditive, this.goldBuffMultiplier);
```

`upgradeGoldAdditive` is only the raw `goldMulti` upgrade value
(`src/game/Game.ts:1585`). `EnemyManager.setGoldMultipliers` *replaces* the stored pair, so 60×/second
this wipes the composed value built in `applyUpgradeEffects` at `Game.ts:1584`, which included:

- lifetime-AP gold bonus (`getLifetimeAPBonus().gold`, `+2% per lifetime AP` — the single biggest
  economy multiplier in the game)
- research `gold_multi` (Alchemy +25%, Prosperity +50%)
- TP `tp_resource` (Astral Harvest, +25%/level, unbounded)
- achievement `gold_mult` / `all_stats`
- talent `gold_mult_pct` (Greed)
- passive `gold_mult_pct` (Scavenger)
- equipment `gold_mult_pct`
- the `wave_gold_scaling` ("Dragon's Hoard") evolution
- wave mutator `goldAdditive`

**Player experience:** buying Greed/Scavenger/Alchemy/Astral Harvest, or clearing a "Golden" mutator
wave, changes income by exactly 0. The Stats panel *reports* the correct multiplier
(`computeStatsInfo`, `Game.ts:1308`), so the number shown and the number applied disagree.

**Fix:** delete the `setGoldMultipliers` call from `applyOngoingBuffs`; have `AbilityManager`
expose `getGoldBuffMultiplier()` and let the single composition point in the stat pipeline (Part 6)
own the write. Short-term patch: pass the composed additive into `setUpgradeGoldAdditive` instead of
the raw one.

### 1.2 Within `applyUpgradeEffects`, gold sources overwrite each other

Even ignoring 1.1, these lines each *replace* rather than compose:

| Line | Source |
|---|---|
| `Game.ts:1584` | base (upgrades + AP + research + TP) |
| `Game.ts:1649` | achievements — discards nothing yet, but is the new base |
| `Game.ts:1666` | wave mutator — discards achievements |
| `Game.ts:1705` | talent Greed — discards mutator + achievements |
| `Game.ts:1732` | passive Scavenger — discards talents |
| `Game.ts:1761` | equipment — discards passives |

Only the **last applicable** source survives. Same class of bug as 1.1, same fix.

### 1.3 Berserk (fire-rate buff) is cancelled one line later, every frame

```ts
// Game.update()
this.abilityMgr.tick(dt);                                   // :2106  → sets fireRateMultiplier = buff
...
this.tower.setFireRateMultiplier(manualAimBoost ? 1.3 : 1); // :2136  → overwrites it
if (this.tower.isQuickShotActive()) this.tower.setFireRateMultiplier(2.0); // :2139
```

`fireRateMultiplier` is a single scalar with three owners (ability buff, manual-aim boost, Adrenaline
Rush quick-shot). Every frame the ability's value is thrown away before any shot is fired, so the
**Berserk ability does nothing**, and manual aim + Adrenaline Rush do not stack — they clobber.

**Fix:** replace the scalar with a small multiplier registry, e.g.
`tower.setFireRateSource('ability' | 'aim' | 'quickshot', value)` and multiply the sources; or
compute one composed value in the pipeline each frame. Also note `Tower.activateQuickShot()`
(`Tower.ts:189`) writes `fireRateMultiplier = 2.0` directly and `resetQuickShot()` never restores
it — same root cause.

### 1.4 Twenty of thirty-seven talents do nothing

`TalentManager.getEffectValue(stat)` is only consulted for 17 stat keys in `applyUpgradeEffects`
(`Game.ts:1683-1717`). The following talents can be bought with talent points and have **no
consumer anywhere in `src/`**:

| Branch | Talent | Declared stat |
|---|---|---|
| Offense | Piercing Volley, Executioner, Barrage | `armor_penetration_pct`, `execution_damage_pct`, `extra_projectile_chance` |
| Defense | Evasion, Wall Regen, Extra Shield, Invigorate | `dodge_chance`, `wall_regen_pct`, `shield_charges`, `health_regen_pct` |
| Utility | Scavenge, Head Start, Mana Reservoir, Lucky Finds, Autonomy, Efficiency, Mastery | `double_gold_chance`, `head_start_waves`, `max_mana_flat`, `equipment_find_chance`, `auto_buy_speed_pct`, `upgrade_cost_reduction`, `all_effects_pct` |
| Magic | Enchant Weapons, Chain Bounce, Frostbite, Meteor Shower, Extended Buffs, Mana Shield | `magic_proc_chance`, `chain_bounce_count`, `slow_effect_pct`, `meteor_damage_pct`, `buff_duration_pct`, `mana_shield_pct` |

Worse, several are **prerequisites for working talents** (Barrage gates all three tier-5 capstones;
Piercing Volley gates Barrage), so the standard offense path forces the player to sink 5 points into
dead nodes to reach a live one.

Two live talents also under-deliver vs. their tooltip: `snipers_mark` promises "+10% range **and**
+10% crit chance" but only applies range; `annihilate` promises "-5% fire rate" as a downside that is
never applied.

**Fix:** each dead stat needs a consumer. Most are one-liners in the pipeline
(`max_mana_flat`, `health_regen_pct`, `upgrade_cost_reduction`, `shield_charges`, `auto_buy_speed_pct`);
a few need real logic (`dodge_chance` in the `tower_damaged` handler, `extra_projectile_chance` in
`buildShotVariants`, `armor_penetration_pct`/`execution_damage_pct` in `ProjectileManager`,
`buff_duration_pct`/`chain_bounce_count`/`slow_effect_pct`/`meteor_damage_pct` in `AbilityManager`).
Add a **compile-time exhaustiveness guard**: make the talent `stat` field a union type and switch on
it in a single `applyTalent(stat, value)` function so a new talent without a consumer fails `tsc`.

### 1.5 Nine of nineteen achievement rewards do nothing

`AchievementManager.getRewardMultiplier` is queried for 7 keys. Unconsumed reward types that exist in
`src/data/achievements.ts`: `boss_gold_mult`, `start_gold`, `extra_projectile`, `ap_gain_mult` (×2),
`rp_gain_mult` (×2), `tp_gain_mult`, `prestige_gain_mult`, `upgrade_cost_reduction`.
Conversely `all_stats` is *queried three times* (`Game.ts:1642-1648`) but **no achievement grants it**.

**Fix:** same exhaustiveness-switch treatment. `ap_gain_mult` / `tp_gain_mult` / `prestige_gain_mult`
in particular are meaningful long-term rewards and belong in `PrestigeManager.previewAP/previewTP`.

### 1.6 Projectiles tunnel through enemies

`ProjectileManager.tick` moves the projectile then does a **point-in-circle** test
(`ProjectileManager.ts:170-178`). Projectile speed is 720 px/s; hit radius is `enemyRadius + 6`
(≈18 px for a normal enemy). Per-step travel:

| Game speed | dt per 60 fps frame | Travel/step | Hit window |
|---|---|---|---|
| 1.0× | 0.0167 s | 12 px | 18 px — marginal |
| 1.5× (base max) | 0.025 s | 18 px | 18 px — **at the limit** |
| 6.5× (max Accelerator) | 0.108 s | 78 px | 18 px — **misses ~4 of 5 enemies** |
| any speed, frame hitch | 0.05 s clamp × speed | up to 234 px | — |

So the Accelerator TP perk (`tp_game_speed`, up to +5×) actively *reduces* DPS, and low-framerate
devices lose damage. `enemyRadius()` also has no case for `splitter` (real radius 16) or `shielded`
(14), so both are 12 — another few percent of misses.

**Fix:** swept segment-vs-circle collision (closest point on the movement segment to the enemy
centre), plus fixed-timestep substepping for the whole simulation (see 5.2). Add the two missing
radii — better, read `ENEMY_DEFS[type].radius` instead of duplicating the table.

### 1.7 Passive `mana_regen_pct` resets max mana to 100

```ts
// Game.ts:1726-1729
if (pManaRegen > 0) {
  this.state.resources.manaRegen *= 1 + pManaRegen / 100;
  this.state.resources.maxMana = 100;   // ← wipes the maxMana upgrade (line 1574)
}
```

Unlocking the Mana Spring passive **deletes up to +200 max mana** bought via Arcane Reserves, and
also disables the "Mana Shield" evolution which triggers at full mana.

### 1.8 Vampiric Aura's regen bonus is silently lost

`applyOngoingBuffs` add/subtracts `vampiricRegenBonus` into `tower.healthRegen`
(`AbilityManager.ts:365-373`) while `applyUpgradeEffects` resets `healthRegen` from scratch
(`Game.ts:1443`). Any purchase, equip, talent, or research completion during the buff leaves the
bonus permanently subtracted out for the rest of the buff. Symptom of the same "systems mutate shared
state additively" pattern.

### 1.9 Smaller confirmed defects

| Where | Issue |
|---|---|
| `Game.ts:444-446` | `enemies_reached_tower` handler starts with a bare `return;` — the "enemies breached the walls" toast is dead code. Delete it or restore it. |
| `EnemyManager.ts:300` | `isVulnerable()` is `return this.vulnerableEnemies.has(id) ? 0 : 0;` — always 0. Either implement the knockback-vulnerability mechanic or remove it and its `ProjectileManager` call site. |
| `EnemyManager.ts:449` | `reset()` sets `goldLuckMultiplier = 0` (elsewhere clamped to `>= 1`), so gold-luck procs would zero out gold until the next `applyUpgradeEffects`. |
| `equipment.ts:16-22` | `RARITY_MULTIPLIERS` are all `1` with the intended values commented out; rarity therefore only changes which stat *array* is used. Either restore the multipliers or delete the constant. |
| `equipment.ts:322` | `rollDrop` filters the pool by `bossOnly` but **not** by `minWave`, so a wave-10 boss can drop a `minWave: 50` item; `rollEquipmentDef`'s `minWave` filter is never used. |
| `Game.ts:1503` | `defenseShield` grants `ceil(level/11)` charges capped at 5, but `maxLevel` is 55 — level 55 gives exactly 5, so the last 10 levels only shave recharge time. Intentional? Not communicated. |
| `Tower.applyResists` | Physical damage subtracts flat `enemy.armor` and floors at 1. Against high-armor enemies at low damage this makes damage effectively constant — armor should be a ratio or scale with wave. |
| `SaveManager.applyOfflineProgress` | `xpEarned` is `Math.floor(...) * 0.5`, producing fractional XP stored in an integer-semantics field. |
| `Game.bindVisibilityEvents` | Any tab-switch of ≥1 second pops the Welcome Back modal. Needs a minimum-elapsed threshold (≥60 s) before showing it. |
| `research tick` | `ResearchTree.tick(dt)` receives the *speed-scaled* game dt, so running at 6.5× makes real-time-gated research (up to 4 h) complete 6.5× faster. Research and auto-save should tick on unscaled wall-clock dt. |

### 1.10 Verification of the Part 1 fixes

Checked against a running build (`localhost:5173`, values read from
`window.__theTower`):

| Fix | Evidence |
|---|---|
| 1.1 / 1.2 gold | 100 lifetime AP → gold multiplier 1 → 3, and it **stays** 3 across frames (previously reset to 1 every frame). Stats panel reports the same 3. Greed talent (5 pts) then took it to 4.2. |
| 1.3 fire rate | Berserk cast → multiplier 2 persists across frames. Sources compose: ability 3 × aim 1.3 × quick shot 2 = 7.8 (previously the last writer won). |
| 1.4 talents | Every previously-inert stat now reaches a live consumer — verified per stat: armor pen 0.15, execute bonus 0.24, extra projectile 0.09, magic proc 0.15, chain bounce +3, slow +0.15, meteor +0.24, buff duration (Berserk 8 s → 9.92 s), mana shield 0.15, wall regen 0.30, upgrade discount −0.09, health regen ×1.15, double-gold 0.12, max mana 100 → 130, equip find 0.15, auto-buy −15%, head start 6 waves. |
| 1.6 collision | Projectile starting 25 px short of an enemy and overshooting it by 47 / 209 / 335 px now hits in all cases; every one of those was a miss under the point test. |
| 1.7 max mana | Mana Spring no longer resets maxMana; Arcane Reserves + Mana Reservoir compose (130). |
| thorns propagation | Found while reviewing the diff: `setThorns` ran before talents/passives/equipment modified it. Now written once at the end of the recompute, alongside gold. |

---

## Part 2 — Progression, XP and the economy curve

> **Status: implemented (2026-08-19).** 2.3-2.6 are done in the working tree;
> `tsc --noEmit`, `vite build` and `npm run checks` are clean. The balance
> simulator called for in 7.1 now lives in `sim/` (`npm run sim`) and produced
> the before/after table below. Two deviations from the letter of the plan,
> both forced by measurement:
>
> - **Boss curve.** 2.3.1 asks for bosses at 3-5x a same-wave trash mob. At
>   the shipped boss counts (`2 + tier`, so 5-12 per wave against 39-123 trash)
>   that makes a boss wave *easier* than its neighbours. Bosses are instead
>   anchored to `ENEMY_HP_GROWTH` with a `1.07^tier` bump, which holds a boss
>   wave at a 1.7-2.1x HP spike over the wave before it at every depth (was
>   3.9x rising to 42x). Boss-to-trash ratio is 20x -> 37x across waves 10-100,
>   down from 22x -> 724x.
> - **`apForWave` recalibrated.** Not requested by Part 2, but flattening the HP
>   curve moved the wall from wave 31 to wave 39-169, and `20 + 1.13^(w-30)`
>   turned a first run into ~2 800 AP — enough to skip the ascension layer
>   entirely. Now `15 + 5 * 1.06^depth * sqrt(depth+1)`.
>
> Measured before/after (`npm run sim`), fresh save through 100 000 lifetime AP:
>
> | | before | after |
> |---|---|---|
> | Time to first ascension | 60 min (wave 30) | 10 min (wave 20) |
> | First run length | 69 min | 23 min |
> | gold-per-HP decay | `1.114^wave` | `1.028^wave` |
> | Run length at 100 K AP | 118 min | 133 min |
> | Wall wave, 0 -> 100 K AP | 31 -> 120 | 39 -> 169 |
>
> Still outstanding from this part: nothing, but note 2.6's persistence model is
> now *ascension*-consistent, not transcendence-consistent — talents and tower
> XP survive a transcendence while passives and equipment do not. Worth settling
> when Part 3.2 reworks prestige.

### 2.1 The measured curve

Model: greedy optimal buying of damage/fire-rate/crit/gold upgrades, wave cleared when DPS ×
time ≥ total wave HP, wave abandoned when it would take >10 min. (Script worth keeping — see 7.1.)

| Wave | Avg enemy HP | Wave HP total | Wave gold total | gold per HP |
|---:|---:|---:|---:|---:|
| 1 | 6 | 30 | 5 | 0.167 |
| 10 | 333 | 998 | 47 | 0.047 |
| 30 | 5.9 K | 29 K | 206 | 0.007 |
| 50 | 103 K | 720 K | 765 | 0.001 |
| 100 | 133 M | 1.6 B | 15 K | 1e-5 |

Gold-per-HP decays by `1.114^wave` — a factor of 10 every ~21 waves. Because upgrade cost grows
`1.33^L` while damage grows `1.1^L`, **damage ∝ gold^0.33**: every doubling of DPS costs ~8× more
gold, while income per wave grows only 5%/wave.

Simulated outcomes:

| Lifetime AP (damage bonus) | Wall wave | Run length |
|---|---:|---:|
| 0 (first run) | 37 | 41 min just to reach wave 30 |
| 100 (+200%) | 45 | 88 min |
| 1 000 (+2 000%) | 59 | 93 min |
| 10 000 (+20 000%) | 76 | 96 min |
| 100 000 (+200 000%) | 94 | 110 min |

### 2.2 What this means

- **The opening is far too slow.** First ascension unlock (wave 30) is ~40 minutes of waves that
  take 1–4 minutes each with almost no purchasing decisions. Idle games generally want the first
  prestige inside 15–25 minutes.
- **A 100× power increase buys 15 waves.** That is arithmetically fine (exponential difficulty), but
  it means AP income must grow at least as fast as the wall moves. `apForWave` is
  `20 + 1.13^(w-30)·√(w-30)`, which does compound correctly — but the *run length* stays ~90–110
  minutes at every tier, so the wall-clock cost per prestige never improves. Mid-game becomes dozens
  of 90-minute runs for one perk level.
- **Runs end by stalling, not by dying.** Past the wall the tower simply cannot kill fast enough,
  yet enemies trickle in slowly enough not to kill it. There is no "run over" moment, no death
  spiral, and no automatic prompt to ascend.

### 2.3 Recommended re-tune

1. **Flatten HP growth, steepen gold growth.** Target a gold-per-HP decay of ≤`1.03^wave` instead of
   `1.114^wave`. Concretely: `enemyHP 1.17 → 1.11`, `goldDrop 1.05 → 1.08`. Recheck the boss curve
   (`1.12^w · 1.35^tier`) so bosses stay ~3–5× a normal enemy of the same wave, not 100×.
2. **Reduce the cost/effect gap.** `damage` cost growth `1.33 → 1.22` (with `effectPerLevel` growth
   staying `1.1`) makes damage ∝ gold^0.5 instead of gold^0.33 — one doubling per 4× gold. Do the
   same for `health` (1.38) and `fireRate` (1.4).
3. **Make wave time roughly constant.** Add an explicit target: a wave should take 8–20 s at the
   player's "comfortable" wave and only exceed 60 s at the wall. Add a soft fail: if a wave takes
   >2× the expected time, enemies gain a stacking damage/speed buff so the run *ends* (and offers
   "Ascend now") instead of stalling.
4. **Compress the first prestige.** Lower `ASCENSION_UNLOCK_WAVE` 30 → 20, and give the first
   ascension a scripted bonus (e.g. guaranteed 25 AP) so the first prestige lands at ~15 minutes.
5. **Give AP a real sink.** All six AP perks max out at ≤10 levels with `2.5^level` growth (the most
   expensive tops out around 7 600 AP) while `apForWave` reaches tens of thousands by wave 100. After
   ~3 ascensions AP is pure transcendence fuel. Add unbounded, log-scaled AP perks (e.g.
   "+2% damage per level, cost `1.15^level`") or make `lifetimeAP` bonus explicit and diminishing
   (currently a flat `+2% per lifetime AP`, `PrestigeManager.getLifetimeAPBonus`, which is linear and
   will dominate everything by wave 100).

### 2.4 Tower XP / talent points

`TOWER_XP_TABLE` is `120·lv^2.35` cumulative; `xpPerKill` is `baseXp·(1 + 0.02·wave)`. At wave 50 a
normal kill is 2 XP, and level 20 costs 120·20^2.35 ≈ 147 K cumulative XP. Combined with ~60 kills
per wave, tower level effectively freezes in the teens — so the talent tree (37 nodes, up to ~90
points needed) can never be filled, and the player only ever sees the tier-1/2 nodes. Recommend:

- Scale `xpPerKill` with the enemy's *wave-scaled HP*, not a flat `1 + 0.02·wave`, so XP keeps pace
  with the exponential curve (e.g. `log2(enemyMaxHp)` based).
- Reduce the level curve exponent (2.35 → ~1.8) or grant talent points every level *and* every 5th
  level as a bonus.
- Show "XP to next level" and expected time-to-level in the HUD/Talents tab.

### 2.5 Passive abilities

- `PASSIVE_XP_MULTIPLIER = 0.07` with `passiveXpForLevel = 75·level^2.2`: reaching level 50
  (Marksmanship's max) needs ≈ 6 million kills. The XP track is decorative — passives are, in
  practice, a pure gold sink where XP only discounts the gold cost
  (`PassiveAbilityManager.getUpgradeCost`).
- Unlocking a passive costs gold but `getEffectValue` returns 0 while `level === 0`
  (`PassiveAbilityManager.getEffectValue:70`), so the purchase has *no effect at all* until the first
  gold upgrade. Grant `basePercent` at unlock.
- Decide what passives *are*: either an XP-driven idle track (then raise XP gain ~20×) or a gold
  track (then delete the XP bar). The current hybrid communicates neither.

### 2.6 Persistence model is inconsistent

| Reset on Ascension | Persists through Ascension |
|---|---|
| Upgrades, gold, passives (`Game.ts:1806`), **equipment inventory + equipped** (`:1807`) | Ability levels, tower XP/level, talents, research, achievements |

Wiping the equipment inventory every ascension makes the entire loot system per-run — and since gear
only drops from bosses at 15% base chance, most runs generate 2–4 items that are then deleted.
Recommend: equipment and passive *levels* persist across ascension (they are "character" progression,
like talents); only run-scoped stats reset. If equipment is meant to be per-run, say so in the UI and
make drops far more frequent so a run actually builds a set.

---

## Part 3 — System-by-system design gaps

> **Status: implemented (2026-08-19).** All six sub-parts are done in the working
> tree; `tsc --noEmit`, `vite build`, `npm run checks` and `npm run sim` are
> clean, and the whole part was verified in a running browser (mutator streak,
> elite gear drops, auto-cast opt-out, auto-buy strategy, AP prerequisites,
> transcendence persistence). `sim/checks.ts` gained sections §3.1–§3.5 driving
> the real managers. Notes on how the plan was interpreted:
>
> - **3.1.** Berserk 30→14 and Gold Rush 45→26 are the two front-loaded
>   abilities; upgrade cost growth is ~1.8 across the table (was 2.55–3.15) and
>   base costs were rebased onto the `400 * 1.135^(unlockWave-10)` trend. Ability
>   XP already levelled abilities as well as discounting them, so it was kept as
>   the "gold accelerates XP" path rather than replaced. Auto-cast gained a
>   per-ability opt-out and now fires every ready ability each second instead of
>   one every five.
> - **3.2.** AP is a three-tier tree with prerequisites and one exclusive pair
>   (Warlord / Tycoon), enforced in `canSpendAP`. The unbounded TP nodes taper as
>   `1/sqrt(level)` so the capped branch perks stay relevant, and those branch
>   perks got wider caps with softer cost growth. `tpForAP` is now `4*ap^0.4`:
>   a first transcendence is 25 TP (was 44) but 1 000x the AP is 16x the TP
>   (was 6x).
> - **3.3.** A mutator runs 3 waves, paying out after each at x1 / x1.5 / x2, and
>   every boss wave now offers one (was a 50% roll) unless a mutator is already
>   running. The picker shows a projected total per choice.
> - **3.4.** Elite chance reaches its 20% cap at wave 100 (was 8% at wave 200);
>   elites carry a 2.5x gold multiplier, always drop 1 RP, and roll on a new
>   `elite` equipment source (4% + 0.1%/wave, capped 15%).
> - **3.5.** The `start_wave` effect type now has a node (Veteran Scouts, 5
>   levels, +3 starting waves each). The tree view already showed speed-adjusted
>   research times and a live remaining-time readout on the active node, so no
>   change was needed there.
> - **3.6.** Auto-buy takes a strategy (cheapest / balanced / damage-first), a
>   gold reserve slider, and buys repeatedly within a tick instead of once.
>
> Also settled here, at the user's request and as flagged at the end of Part 2:
> **passives and equipment now persist through transcendence**, alongside
> talents, tower XP, research and achievements. Only gold, upgrades, ability
> levels and the ascension layer reset.

### 3.1 Abilities
- 10 abilities, all gated on `highestWave`, but slots 5–9 unlock at waves 30–55 — i.e. past the
  first-run wall for a new player. Front-load two of them.
- `AutomationManager.runAutoCast` casts **one** ability every 5 s from a hardcoded priority list and
  offers no per-ability toggle. Players will want "auto-cast these, save mana for those".
- Ability upgrade costs (`upgradeCostGrowth` 2.55–3.0, base 400–1400) compete directly with tower
  upgrades in the same gold pool but scale far faster; at level 10 Rain of Arrows costs
  `400·3^9` ≈ 7.9 M. Either move ability upgrades to a separate currency (ability XP already exists!)
  or cut the growth to ~1.8.
- Ability XP (`xpPerCast`, `abilityXpForLevel = 50·level^1.5`) only discounts gold cost. Same
  identity problem as passives — make XP *the* level-up path and gold the accelerator, or drop it.

### 3.2 Prestige
- AP perks: 6 nodes, all trivially maxed (see 2.3.5). No tree, no exclusivity, no depth.
- TP perks: genuinely good design — 3 branches, tiers, prerequisites, exclusive pairs. The two
  unbounded ones (`tp_damage` +50%/level, `tp_resource` +25%/level, both `maxLevel: 999`, cost
  `1.12^level`) will eventually be the only thing that matters; the capped branch perks (max 10–20)
  become rounding errors. Consider making the capstones scale or making the unbounded ones
  logarithmic.
- `tpForAP = floor(log2(ap+1)^2)`: at 100 AP → 44 TP, at 100 K AP → 275 TP. The log makes late
  transcendence nearly worthless — 1000× the AP for 6× the TP. Verify this is intended; a
  `ap^0.4`-style curve is more common.

### 3.3 Wave mutators
Good idea, undersold: offered on 50% of boss waves and 4% of normal waves, one wave only, and the
gold reward path is broken by 1.1/1.2. Suggestions: let a mutator persist for N waves with escalating
rewards; show the risk/reward as a projected number ("+1 400 g expected"); guarantee an offer every
10th wave so it becomes a rhythm the player anticipates.

### 3.4 Elites
`eliteChanceForWave` peaks at 8% at wave 200, and elites are +150% HP with one of 5 auras. Five auras
is good variety but at 8% max they are noise. Recommend scaling to ~20% by wave 100 and giving elites
a visible reward (guaranteed gold/RP/equipment roll) so the player *wants* to see them.

### 3.5 Research
Solid: DAG, levels, RP economy, in-progress timer, offline advancement. Two issues: research times up
to 14 400 s (4 h) with no way to see "time remaining" against the speed multiplier in the tree view
(only in the active card), and the `start_wave` effect type exists with no node using it.

### 3.6 Automation
`runAutoBuy` buys **the single cheapest affordable upgrade** every 10 s (min 3 s). That is the worst
possible heuristic: it floods cheap utility upgrades and never saves for damage. Replace with:
- a per-upgrade priority/weight the player configures (or a simple "damage first / balanced / defense
  first" preset), and
- a "spend down to X% of gold" rule so the player can bank for a big purchase, and
- buy *repeatedly* within a tick until the rule stops, not one purchase per interval.

---

## Part 4 — Game feel & UX

> **Status: implemented (2026-08-19).** All eight items are done in the working
> tree; `tsc --noEmit`, `vite build`, `npm run checks` and `npm run sim` are
> clean, and every item was verified in a running browser (bulk-buy previews,
> gold breakdown, stall banner, offline walk, progression tab, respec, keybinds
> overlay). `sim/checks.ts` gained sections §4.1, §4.4/4.5, §4.6 and §4.7.
> Notes on how the plan was interpreted:
>
> - **4.1.** ×N buys *up to the next multiple of N* rather than adding N
>   levels (from level 18, ×10 buys 2). Shift/ctrl held anywhere promotes the
>   amount without changing the selector. A bulk buy is one transaction — one
>   toast, one save, one stat recompute — with `levelsGained` on the event so
>   `totalUpgradesPurchased` counts levels, not clicks.
> - **4.2.** `computeGoldMultiplier` became `computeGoldBreakdown`, which
>   returns the number and its attribution in one pass. Additive and
>   multiplicative sources stay distinct in the display (`+140%` … `subtotal
>   ×3.73` … `×1.10`) because attributing a factor to an additive source
>   overstates it — two `+100%` sources are `×3`, not `×4`. The rendered parts
>   reconstruct the applied multiplier exactly.
> - **4.3.** A non-blocking banner rather than a modal: enrage does not
>   guarantee the wave is lost, and interrupting a player who might still win
>   it would punish them for trying. Fires once per wave, only when ascending
>   is possible, and is dismissible.
> - **4.4/4.5.** `wavesCleared` used to be `elapsed / AVG_WAVE_DURATION` — a
>   clock reading with no connection to whether the tower could kill anything.
>   Waves, gold and XP now all come from one wave-by-wave walk at the tower's
>   estimated DPS, carrying the composed gold multiplier. The walk stops at
>   *this run's* deepest wave and farms there: the lifetime best would let a
>   post-ascension tower skip content it has never faced, and nothing here
>   models the tower dying.
> - **4.6.** A Progression tab built from the same definitions the milestone
>   strip uses, plus the passive gates the strip omits. The strip's tuning is
>   untouched.
> - **4.7.** Both halves of the respec were missing: the advertised 500g was
>   never charged, and refunded points were *deleted* rather than returned to
>   the unspent pool. Cost is now 500g per point, shown live per branch and for
>   the new full reset, and disabled when unaffordable.
> - **4.8.** Overlay on `?` and a HUD button. Ability rows come from
>   `ABILITIES`, so a new ability documents itself.
>
> Also fixed here, found while verifying 4.6: every panel's `renderInto` does
> `parent.className = '<name>-panel'`, which wiped the container's own
> `panel-content` class — the element carrying `overflow-y: auto`. Panels could
> not scroll, and the stale class broke whichever tab was opened next.
> `showTab`/`mountMobileTab` now reset and restore the container class around
> the mount, fixing every panel at once.

1. **No bulk buy.** Upgrades go to level 999 and are purchased one click at a time. Add ×1 / ×10 /
   ×Max (shift/ctrl modifiers) with a cost preview — this is the single highest-value QoL change.
2. **Stats panel disagrees with reality.** `computeStatsInfo` recomputes gold multiplier
   independently of the pipeline (`Game.ts:1300-1308`); after the Part 1 fixes, derive both from one
   function so displayed = applied. Add a per-source breakdown tooltip ("×12.4 = 2.1 upgrades ×
   1.8 research × 3.3 prestige").
3. **No run-ending signal.** Add an explicit "you have stalled — Ascend for N AP" prompt when the
   current wave's projected clear time exceeds a threshold.
4. **Welcome Back on every tab switch** (see 1.9). Also the offline report shows `startWave` ==
   `endWave` because `applyOfflineProgress` never advances the wave despite computing `wavesCleared`.
5. **Offline income ignores every gold multiplier** (`estimateGoldPerDamage` uses raw
   `goldDropForWave`), so offline is strictly worse than active by the full multiplier stack — the
   opposite of what an idle game wants. Feed the real composed multiplier into the estimate.
6. **Unlock legibility.** Abilities/passives gate on `highestWave` while the milestone strip shows
   what's next — good — but there is no single "what unlocks when" screen. Consider promoting
   `MilestoneStrip` data into a full progression tab.
7. **Talent tree respec** exists per-branch (`refundBranch`) but there is no full respec and no cost
   shown; with 20 dead talents (1.4) players will feel robbed until that's fixed.
8. **Keyboard hotkeys 1–9** conflict with nothing but are undocumented outside the ability bar; add a
   help/keybinds overlay.

---

## Part 5 — Performance & technical robustness

> **Status: implemented (2026-08-19).** All ten items are done in the working
> tree; `tsc --noEmit`, `vite build`, `npm run checks`, `npm run sim` and the
> new `npm run test` are clean, and the renderer and timing work were verified
> against the pre-change build in a running browser. Notes on how the plan was
> interpreted, and the measurements behind each claim:
>
> - **5.1.** Enemy bodies, ground shadows, boss/healer/elite auras, elite
>   crowns and the magic-bolt glow are pre-rendered per variant and blitted.
>   Only genuinely per-instance animation stays live — wing flap, boss/splitter
>   pulse, shield arcs, retribution ring. At 253 enemies with 12 elites this
>   took `createRadialGradient` calls per frame from **266 to 0** and
>   `drawEnemies` from **2.24 ms to 1.26 ms**. Pulsing auras scale the cached
>   sprite instead of rebuilding the gradient, which moves the gradient's inner
>   stop by the same few percent as the pulse; measured at 0.03% of a channel.
>   Verified by rendering all 14 enemy/elite variants in isolation against the
>   old renderer: **13 of 14 are pixel-equivalent**.
> - **5.1 (behaviour change).** The boss enrage tint lived in the `diamond`
>   branch of the shape switch, and no boss uses that shape — so an enraged
>   boss never actually turned red. Hoisted out of the switch at the user's
>   direction, so the tint now fires. This is the one intended visual
>   difference from the refactor.
> - **5.2.** `Game.update` splits into `simulate(step)` (fixed 1/60 s
>   substeps, max 6 per frame) and `frameUpdate(dt, realDt)` (visuals, UI,
>   automation, real-time systems). When the substep cap bites, step size grows
>   rather than time being dropped, so the game never runs slow-motion under
>   load. DPS at 6.5x speed versus 1x went from **−23.1% to +0.6%**; under a
>   sustained 20 fps hitch at 6.5x, from **−46.3% to −15.3%**. The residual is
>   the substep cap, and is the deliberate trade against a 20x per-frame
>   simulation cost.
> - **5.3.** Particles capped at 600, damage numbers at 80, oldest-first
>   eviction. Damage numbers within 16 px of a live one younger than 0.22 s
>   merge into it — 25 hits on one spot become one label reading the total —
>   matched on kind so crits and heals keep their own colour.
> - **5.4 — the plan's premise is wrong, and the item is scoped down.** A
>   uniform grid exists (`src/utils/SpatialGrid.ts`) but backs only *some*
>   radius queries. The plan calls these loops "O(n²) ... all-pairs over the
>   enemy list"; measured, most are not. Their outer loop is over a handful of
>   aura elites, healers or mines, so they are O(k·n) with a small k, and a
>   flat array walk with an inlined distance test beats a hashed grid that must
>   first rebuild an O(n) index. Measured in a single page load, grid vs. the
>   direct scan it would replace:
>
>   | Path | 64 enemies | 250 | 420 |
>   |---|---|---|---|
>   | haste + vitality auras | **0.25x** | **0.40x** | **0.62x** |
>   | mine detonation (15 mines) | — | 1.05x | 1.16x |
>   | per-kill AoE (40 kills) | — | 1.36x | 1.29x |
>
>   So the grid backs mines, AoE splash, chain kills, the shockwave damage band
>   and crit splash; the auras, healer search, retribution and shockwave
>   displacement keep their direct scans, each with a comment saying why. The
>   wins are real but small in absolute terms — roughly 0.01–0.02 ms of a ~3 ms
>   frame. **A full revert of 5.4 is defensible** and would cost about that
>   much; it is kept because the mine path genuinely was a nested scan per mine
>   per frame, which is the one case that grows badly.
>
>   Two implementation notes: the rebuild is **lazy** (a frame with no mines or
>   splash pays nothing), and `queryRadius` **returns a fresh array by default**
>   — see the bug below.
> - **5.5.** Bounds culling was already in place from Part 1; added a 4 s
>   `MAX_PROJECTILE_AGE` applied to every projectile, not just homing ones,
>   which is what retires a shot that is pinned or circling an uncatchable
>   target.
> - **5.7.** Event-driven saves became `requestSave()`, flushed by
>   `SaveManager.tick` at most once per 5 s, with the 30 s timer as backstop.
>   Twenty purchase events in one second now produce **one** write instead of
>   twenty. The tab-hidden handler still writes synchronously, so a pending
>   write cannot be lost.
> - **5.9.** Vitest as a dev dependency only, keeping the zero-runtime-
>   dependency rule. 72 tests across 5 files. Each optimisation is checked
>   against the implementation it replaced — the grid against a brute-force
>   scan, the evolution cache against a fresh linear scan, `xpToLevel` against
>   the linear one at every table boundary — since the risk in this part is a
>   subtly different answer, not a slow one.
> - **5.10.** Refreshed every stale count and added the seven missing system
>   pages (XP/talents, passives, equipment, wave modifiers, achievements,
>   audio), plus `docs/performance.md` and `docs/testing.md`.
>
> One bug was introduced and fixed inside this part, worth recording because
> the class of it is easy to repeat: `queryRadius` originally handed out a
> single shared scratch buffer, and four of the five call sites damage what
> they find. `damage` emits `enemy_killed` / `enemy_damaged`, whose handlers
> query again — so the inner query cleared and refilled the array the outer
> loop was still walking, silently dropping enemies from mine blasts, splash
> and chain kills. Proven in the browser (a 10-enemy result set became 3
> mid-iteration), fixed by returning fresh arrays, and pinned by a regression
> test in `tests/systems.test.ts`.
>
> Two further findings surfaced while writing the tests, neither fixed here:
>
> - `all_stats` is read in three places in `Game` but granted by no
>   achievement, so those reads are permanently zero — the mirror of the nine
>   unread rewards §1.5 fixed. Granting it is a balance decision, so it is
>   pinned in `tests/content-coverage.test.ts` under `KNOWN_UNGRANTED` with a
>   test that fails once someone grants it.
> - `Game.chooseWaveModifier` / `skipWaveModifier` do not call
>   `WaveManager.resumeSpawning()` — only the modal's callbacks do. Any other
>   caller silently leaves the wave paused forever.
>
> The plan's golden `StatContext` test (§7.2) still waits on Part 6: until
> eight systems stop writing into `TowerState` directly there is no single
> function to assert against, so `tests/formulas.test.ts` pins the per-upgrade
> curves those systems multiply on top of instead.

1. **Per-enemy radial gradients each frame.** `Renderer` calls `createRadialGradient` per enemy body
   (`Renderer.ts:327`), plus more for elites/auras/particles. `enemyCountForWave(200)` = 243 enemies
   → ~250+ gradient allocations per frame. Pre-render each enemy type/rarity to an offscreen canvas
   once and `drawImage` it.
2. **Fixed timestep.** `dt` is clamped to 0.05 s then *multiplied* by speed (up to 6.5×), producing
   0.325 s physics steps. Run the simulation in fixed 1/60 s substeps (cap the substeps per frame)
   — this fixes 1.6 tunneling, healer/attack cadence jitter, and makes high speed honest.
3. **Unbounded particle/damage-number pools.** `EffectsManager` has no cap; every hit emits 3–6
   sparks and a damage number. Cap the arrays (drop oldest) and batch damage numbers per enemy.
4. **O(n²) loops.** `computeHasteMultipliers`, `processVitalityAura`, mine detonation, splash, and
   chain-kill AoE are all all-pairs over the enemy list. At 200+ enemies with multiple elites this is
   the second-biggest cost after rendering. Add a simple uniform grid / spatial hash used by all
   radius queries.
5. **Projectile lifetime.** Cleanup bound is `x > 9999` (`ProjectileManager.ts:236`) — a missed shot
   lives ~14 s. Use canvas bounds + a max age.
6. **`xpToLevel` linear scan.** Called on every XP gain over a 2 000-entry table; use binary search
   or track the level incrementally.
7. **Save on every wave start + every purchase.** `Game.ts:686-694` writes the full JSON save on 9
   different events; with auto-buy at 3 s intervals that's a `JSON.stringify` of the whole state
   several times per second. Debounce to ~1 write/5 s plus the existing 30 s timer.
8. **`UPGRADES.find(...)` in hot paths** (`UpgradeManager.getCost/isMaxed/buy`, `hasEvolutionEffect`
   loops over all upgrades × evolutions per call, and it's called several times per frame in
   `update`). Build `UPGRADE_BY_ID` and cache the evolution lookups on level change.
9. **No tests at all.** Zero test files, no test runner in `package.json`. See 7.
10. **Docs are stale.** `AGENTS.md`/`docs/` describe "17 upgrades, 4 abilities, 6 enemy types, save
    v2, 8 research nodes"; the code has 28 / 10 / 8 / v8 / 14, plus five whole systems (XP, talents,
    passives, equipment, wave modifiers, achievements, audio) that have no doc page.

---

## Part 6 — The architectural fix: one stat pipeline

Most of Part 1 is one root cause: **eight systems write directly into the shared mutable
`TowerState` / `EnemyManager` multipliers, in an order nobody can see, with `=` instead of `*=`.**

Proposed shape:

```ts
// One immutable input snapshot → one derived stat block.
interface StatContext {
  upgrades, evolutions, prestigeAP, prestigeTP, research,
  achievements, talents, passives, equipment, waveModifier, activeBuffs
}

interface StatAccumulator {
  add(stat: StatKey, value: number, source: SourceId): void;   // additive bucket
  mult(stat: StatKey, factor: number, source: SourceId): void; // multiplicative bucket
}

function resolveStats(ctx: StatContext): { stats: ResolvedStats; breakdown: Breakdown }
```

Rules:
- Every contributor is a pure function `(ctx, acc) => void`. No system touches `TowerState` directly.
- `resolveStats` runs when the context changes (purchase/equip/research/talent) **and** once per
  frame for time-varying buffs — it is cheap because it is pure arithmetic over ~50 keys.
- `Breakdown` (source → contribution per stat) powers the Stats-panel tooltips *and* makes
  "displayed ≠ applied" bugs impossible.
- Buffs become entries in a `BuffRegistry` with `{ stat, factor, expiresAt, source }` rather than
  direct mutation — this kills 1.3 and 1.8 permanently.
- `StatKey` is a closed union; a `switch` with `never` exhaustiveness makes 1.4/1.5 compile errors.

This is a ~2–3 day refactor of `Game.applyUpgradeEffects` (300 lines today) into ~8 small
contributor modules, and it is the prerequisite for trusting any balance work.

---

## Part 7 — Verification

### 7.1 Keep a balance simulator
**Done.** `sim/model.ts` + `sim/balance.ts`, run with `npm run sim`. Imports the real `src/data`
formulas and runs the greedy-buyer model from Part 2, printing wall-wave, run duration, and gold/HP
ratios per prestige tier. Every balance change gets a before/after table. This is how you avoid
re-tuning blind.

`sim/checks.ts` (`npm run checks`) is a lightweight companion: ~38 assertions driving the real
manager classes (WaveManager enrage, PrestigeManager AP, TowerXpManager talent grants,
PassiveAbilityManager effects) rather than copies of their logic. It is not a substitute for the
Vitest suite in 7.2, but it covers the Part 2 behaviour with zero new dependencies.

### 7.2 Add a test runner
**Done.** Vitest as a dev dependency only, run with `npm run test`; 72 tests in
`tests/`. See [docs/testing.md](../docs/testing.md). The originally-specified
suite:
- **Golden stat tests:** given a fixed `StatContext`, assert the resolved damage/gold/fire-rate. These
  would have caught every bug in Part 1.
- **Save round-trip + migration:** v2→v8 ladder on fixture saves; assert no field loss.
- **Formula snapshots:** `enemyHPForWave`, `apForWave`, `upgradeCost` at waves 1/10/50/100.
- **Talent/achievement coverage:** assert every declared `stat`/`rewardType` has a consumer.

### 7.3 Manual smoke checklist
Ascend → verify equipment/passives/abilities behave per the documented persistence model; cast
Berserk and confirm the fire-rate number in Stats moves; buy Greed and confirm gold/kill changes;
run at max speed and confirm DPS matches 1× DPS within ~5%.

---

## Part 8 — Prioritized roadmap

| Phase | Work | Effort | Payoff |
|---|---|---|---|
| ~~**1. Stop the bleeding**~~ ✅ | 1.1, 1.2, 1.3, 1.7, 1.8, 1.9 quick wins | done | Gold multipliers, Berserk, max mana and Vampiric now work. |
| **2. Pipeline refactor** | Part 6, with exhaustive `StatKey` union | 2–3 days | Makes 1.4/1.5 mechanical and prevents recurrence. |
| ~~**3. Wire dead content**~~ ✅ | 1.4 (20 talents), 1.5 (9 rewards), equipment rarity + minWave | done | Talent tree and achievements are now real. Pulled forward because the exhaustive `TalentStat` switch made it mechanical without waiting for Part 6. |
| ~~**4. Simulation correctness**~~ ✅ | 1.6 swept collision, research/save on unscaled dt, fixed-timestep substepping (5.2) | done | High game speeds no longer cost DPS: 6.5x is within 1% of 1x, measured. |
| ~~**5. Balance re-tune**~~ ✅ | Part 2 (HP/gold/cost curves, first-prestige compression, AP sinks, XP curves) driven by 7.1 | done | Opening is 10 min instead of 60; runs end on a wave-enrage fail state instead of stalling; talents, passives and gear are reachable. Simulator kept in `sim/`. |
| ~~**6. Depth & UX**~~ ✅ | Part 4 (bulk buy, stat breakdown tooltips, run-stall prompt, offline rework, progression tab, respec, keybinds) plus the auto-buy priorities and mutator/elite rework already done in Part 3 | done | Upgrades buy in bulk, the gold number explains itself, a stalled run says so, offline actually progresses the run, and the talent respec no longer eats points. |
| ~~**7. Perf & hygiene**~~ ✅ | Part 5 in full (sprite cache, fixed timestep, pools, spatial grid, projectile lifetime, save debounce, lookup caches), tests (7.2), doc refresh (5.10) | done | Zero gradient allocations per frame and ~44% off enemy drawing; 6.5x game speed now costs ~0% DPS instead of 23%; saves write once per 5 s instead of per event; 73 tests and a doc page per system. 5.4 was scoped down on measurement — see the note in Part 5. |

**Suggested first PR:** Phase 1 items 1.1 + 1.3 alone (delete two lines from
`AbilityManager.applyOngoingBuffs`, introduce a fire-rate source map). Small, isolated, and it
restores the largest chunk of missing power in the game.
