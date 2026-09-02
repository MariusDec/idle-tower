# Prestige System

**Files:** `src/systems/PrestigeManager.ts`, `src/data/prestige.ts`

## Overview

Two prestige layers: Ascension (wave 20+) and Transcendence (100+ AP).

## Ascension

**Unlock:** Wave 20 (`ASCENSION_UNLOCK_WAVE`)

**AP Formula:** `apForWave(w)` = `15 + floor(5 * AP_DEPTH_GROWTH^d * sqrt(d + 1))`
where `d = w - 20`, `AP_DEPTH_GROWTH` is **1.03**, and the result is `0` below
the unlock wave. The old `20 + 1.13^(w-30) * sqrt(w-30)` was tuned for a wall
around wave 37; with the flatter HP curve the wall sits far deeper and
`1.13^depth` turned a first run into thousands of AP.

The exponent is the single dial for *how long the game is*, and 1.06 set it to
four runs (plans/progress.md §1.1). Measured with `npm run sim`'s ladder report,
a run at the wall banked 85–250× the player's entire lifetime AP: runs 2, 3 and
4 advanced the wall +98, +111 and +59 waves, and then the ladder hit a fixed
point and advanced +0 forever. That fixed point is arithmetic, not bad luck — a
run at wall `W` banks `1.06^W`, lifetime AP converts to damage at `A^0.7`, so
damage grows at `1.0415^W` against enemy HP at `1.11^W`, and each run returns
only 0.39 of the depth it launched from.

At 1.03 the ladder keeps advancing and is still moving at run 16. Two things
this deliberately does *not* do: it does not touch `lifetimeAPDamageBonus`'s 0.7
exponent (raising it fixes the ladder by making runs 55 hours long), and it does
not re-price a single perk — what keeps AP live at depth is `ap_deep_stores`,
`ap_forward_camp` and the endless nodes, not a cheaper tree.

### Deployment (progress.md §6)

`ap_forward_camp` ("Forward Camp", tier 3, 150 × 2.4^L, 3 levels) lets an
ascension start from a **checkpoint of a previous run**: 50% / 70% / 85% of the
deepest stored one, resolved down to a stored 50-wave boundary. The Deploy
button sits next to Ascend and is hidden until the perk is bought.

A checkpoint is a **snapshot, not a grant** — gold in hand, upgrade levels,
ability levels, blessings held and picks taken, all values the player actually
held at that wave — so a deploy can never hand back more than the run that wrote
it earned. `Game.recordDeploymentCheckpoint` writes one every 50 waves and keeps
only the best (by gold in hand) at each wave, deepest twelve. `deploy()` runs a
full `ascend()` first and only then overwrites the *opening* of the new run.

What a deploy does **not** pay: contract progress, Watch kill counters, and
tower/passive XP for every wave it skipped. That is the trade, and it is what
stops a deploy from being strictly better than a full run. Checkpoints survive
ascension and are cleared by transcendence — a checkpoint from before a
transcendence describes a tower the new cycle cannot reproduce.

`FIRST_ASCENSION_AP` (**25**) is a floor on the player's very first ascension,
so the first prestige is worth taking rather than something to postpone.

**Performs:**
1. Calculates AP from current highest wave
2. Calculates RP (Research Points) = AP gained
3. Adds AP to `ascensionPoints`, adds to `lifetimeAP`
4. Calls `applySavedStateReset()` — resets upgrades/resources/enemies/projectiles, keeps research/perks/AP
5. Research `startWave` bonus: if unlocked, starts at that wave (5 or 15) with starting gold

### The run-scoped AP channel

`previewAP(wave)` is not just `apForWave`. It composes three things:

```
floor( apForWave(wave)
       x (1 + achievement ap_gain_mult + achievement prestige_gain_mult)
       x (1 + runApBonus) )
```

The first multiplier is **lifetime** (unlocked achievements); the second is
**this run's**, and it is keyed by source:

```ts
export type RunApSource = 'boss' | 'contract';
private runApBonusBySource: Record<RunApSource, number> = { boss: 0, contract: 0 };
```

| Source | Granted by | Ceiling | Persisted in |
|---|---|---|---|
| `boss` | A flawless boss encounter, +10% each ([boss-encounters.md](boss-encounters.md)) | none | `GameState.bossRun.apBonusPct` |
| `contract` | A completed contract that grants one, +3% each ([contract-system.md](contract-system.md)) | **+50%** for the run | `GameState.contracts.apBonusPct` |

Two reasons it is keyed rather than one scalar. First, the two sources have
different ceilings and different persistence blocks, so a contract restore
calling `setRunApBonus` on a shared number would silently erase the boss bonus.
Second, the lifetime and run channels **compose** — `(1 + ach) x (1 + run)` —
rather than one standing in for the other, which is the bug the split was
introduced to avoid in the first place.

Both are cleared by `performAscension`: the ascension that pays a run bonus out
is also the one that ends the run that earned it. `applySavedStateReset` clears
both again for the transcendence path.

### AP Perks

Twenty-five perks in four tiers (revamp §8, widened by prestige-abs §3.1 —
the table below lists the original thirteen; `AP_PERKS` in
`src/data/prestige.ts` is the source of truth for the full set). The old tree
let one first
ascension buy seven full-damage projectiles — a ~7x multiplier bought once and
never revisited. The three projectile nodes are now **single-level signature
purchases**, each carrying only a *fraction* of the volley, so the first
ascension buys exactly one utility line and coverage is something a player
saves several runs for.

| Tier | ID | Name | Cost | Scaling | Max | Effect | Requires |
|---:|----|------|-----:|--------:|----:|--------|----------|
| 1 | ap_auto_upgrader | Auto-Upgrader | 12 | 2.0 | 3 | Auto-buy automation; the perk level is the per-tick budget | — |
| 1 | ap_wave_skipper | Wave Skipper | 6 | 1.60 | 15 | +1% wave skip/level | — |
| 1 | ap_quiver | Deep Quiver | 5 | 1.22 | 30 | +2% fire rate/level | — |
| 1 | ap_idle_time | Extended Watch | 14 | 1.6 | 11 | +8 h offline cap/level | — |
| 2 | ap_might | Ascendant Might | 6 | 1.20 | 999 | +2% all damage/level | Auto-Upgrader **or** Deep Quiver 3 |
| 2 | ap_fortune | Ascendant Fortune | 6 | 1.20 | 999 | +2% all gold/level | Auto-Upgrader **or** Wave Skipper 2 |
| 2 | ap_research_speed | Scholarly Focus | 8 | 1.8 | 5 | −8% research time/level | Auto-Upgrader |
| 3 | ap_extra_shots | Twin Arrows | 60 | — | 1 | +1 front projectile at 55% damage | Might 5 **or** Quiver 5 |
| 3 | ap_pierce | Bodkin Mastery | 75 | 2.2 | 3 | +1 pierce/level | Might 5 |
| 3 | ap_back_shots | Rear Guard | 90 | — | 1 | +1 rear projectile at 55% damage | Twin Arrows |
| 4 | ap_scatter_shots | Scatter Shot | 200 | — | 1 | +2 angled projectiles at 35% damage each | Rear Guard **or** Bodkin Mastery 2 |
| 4 | ap_warlord | Warlord | 40 | 1.32 | 12 | +5% all damage/level — locks out Tycoon | Might 10 |
| 4 | ap_tycoon | Tycoon | 40 | 1.32 | 12 | +5% all gold/level — locks out Warlord | Fortune 10 |
| 3 | ap_forward_camp | Forward Camp | 150 | 2.4 | 3 | Deploy at 50/70/85% of your best run (progress.md §6) | Veterancy 2 |
| 4 | ap_deep_stores | Deep Stores | 300 | 2.0 | 4 | +25%/level to every scalar upgrade's level cap (progress.md §3) | Might 5 |

`perkCost(def, level)` = `floor(costPerLevel * costScaling^level)`; a perk with
`costScaling: 1` is a flat one-off price. Prerequisites are **OR**-based in
`PrestigeManager.meetsPrerequisites` — a node listing two parents opens on
either one, and the panel renders them as "Requires A or B". `ap_warlord` /
`ap_tycoon` are mutually `exclusive`.

### Projectile payload scaling (revamp §7)

The AP projectile perks add **coverage**, not a damage multiplier. Every extra
lane carries a fraction of the volley's payload through `ShotVariant.damageScale`
(see [projectile-system.md](projectile-system.md)), so the whole suite is worth
~x2.8 before geometry rather than the ~x13 it used to be. One shared block —
`PRESTIGE_PROJECTILE_TUNING` — is read by both `Game.buildShotVariants()` and
`sim/model.ts`, so the simulator measures the number that actually fires:

| Field | Value | Lane |
|---|---:|---|
| `extraDamageScale` | 0.55 | Twin Arrows, front |
| `rearDamageScale` | 0.55 | Rear Guard, behind the tower |
| `scatterDamageScale` | 0.35 | Scatter Shot, each of two angled lanes |

### Idle-time cap

The offline-progress cap is **derived, never stored**: `BASE_IDLE_TIME_SECONDS`
(8h) plus 8h per level of `ap_idle_time`, up to `IDLE_TIME_MAX_LEVEL` (11) — a
4-day ceiling. `PrestigeManager.getIdleTimeCapSeconds()` is the single query;
`SaveManager` receives it as a constructor callback (`getIdleCapSeconds`) and
applies it in `computeOfflineProgress`, so a perk purchase moves the ceiling on
the next offline walk with no save-field change. The perk row in
`PrestigePanel` shows the current cap next to its level (`Idle cap: 1d 8h`),
and the welcome-back modal names the cap in its "capped at …" line.

**Lifetime AP Bonus:** `lifetimeAPDamageBonus(ap)` = `0.02 * ap^0.7`, and the
gold bonus is the same curve. It used to be a flat linear `0.02 * lifetimeAP` —
linear in a currency that itself grows exponentially with wave depth, so it
eventually dwarfed every perk, talent and piece of gear without the player
making a decision. Sub-linear, it is still why a veteran opens faster than a
new player, but deliberate progression carries the late curve.

### Tower cores as an AP spend

Cores ([core-system.md](core-system.md)) are bought with AP but are **not** AP
perks: no levels, no prerequisites, no exclusivity, and their own UI.
`PrestigeManager.canUnlockCore(id, alreadyUnlocked)` and
`spendOnCore(id, alreadyUnlocked)` own the debit; ownership itself is
`CoreManager`'s, which is why it is passed in rather than reached for.

| Core | Cost |
|---|---:|
| Marksman | default (free) |
| Artillery | 30 AP |
| Frostwork | 45 AP |
| Bloodforge | 60 AP |
| Arcane | 90 AP |

The unlock is **permanent** — `performAscension` and `applySavedStateReset`
never touch it. What resets with the run is the *selection*, and it resets to
the player's remembered preference rather than to the default, so an
auto-ascending run keeps the identity its player chose.

## Transcendence

**Unlock:** 100 AP (`TRANSCENDENCE_UNLOCK_AP`)

**TP Formula:** `tpForAP(ap)` = `floor(4 * ap^0.4)`, and `0` below the unlock.
`log2(ap+1)^2` gave 44 TP at 100 AP and only 276 at 100 000 — a thousand times
the ascension work for six times the reward, which made every transcendence
after the second worse than the one before it. The power law starts lower (**25
TP** for a first transcendence) and keeps paying: 1 000x the AP is now ~16x
the TP.

**Performs:**
1. Calculates TP from current AP
2. Adds TP to `transcendencePoints`
3. Calls `applyFullTranscendenceReset()` — same as ascension reset + clears research + automation

### TP Perks

Nineteen perks across three branches — **Wrath** (offensive), **Fortune**
(economic) and **Dominion** (utility/automation). Same `perkCost`,
prerequisite and `exclusive` machinery as the AP tree.

#### Wrath

| Tier | ID | Name | Cost | Scaling | Max | Effect | Requires |
|---:|----|------|-----:|--------:|----:|--------|----------|
| 1 | tp_damage | Cosmic Power | 3 | 1.25 | 999 | +`0.20 / sqrt(L)` all damage per level — tapers, never caps | — |
| 2 | tp_fire_rate | Rapid Assault | 4 | 1.35 | 20 | +4% fire rate/level | Cosmic Power 3 |
| 2 | tp_crit | Lethal Precision | 4 | 1.35 | 25 | +4% crit damage/level | Cosmic Power 3 |
| 3 | tp_pierce | Piercing Fury | 10 | 1.9 | 6 | +1 pierce per 2 levels | Rapid Assault 3 **or** Lethal Precision 3 |
| 4 | tp_aoe | Annihilation | 30 | — | 1 | 25% AoE splash on impact — locks out Executioner | Piercing Fury 2 |
| 4 | tp_execute | Executioner | 30 | — | 1 | +150% damage below 25% HP — locks out Annihilation | Piercing Fury 2 |

Cosmic Power's ladder is 3, 3, 4, 5, 7, 9, 11, 14, 17, 22…: a first
transcendence (25 TP) buys ~5 levels for +65%, not 13 levels for +330%, so the
branch nodes stay live purchases instead of being strictly dominated by one row.
Annihilation's radius is `TP_AOE_SPLASH_RADIUS` = `world(60)` — sized *under*
the artillery core's `world(70)`, because the perk is a universal top-up, not a
core — and its fraction sums into `SPLASH_FRACTION_CAP` (0.40) through
`composeShotSplash`.

#### Fortune

| Tier | ID | Name | Cost | Scaling | Max | Effect | Requires |
|---:|----|------|-----:|--------:|----:|--------|----------|
| 1 | tp_resource | Astral Harvest | 3 | 1.25 | 999 | +`0.12 / sqrt(L)` all resource gain per level — tapers | — |
| 2 | tp_treasure | Treasure Hunter | 4 | 1.38 | 15 | +2% chance of a 3x gold drop/level | Astral Harvest 3 |
| 2 | tp_mana | Mana Well | 4 | 1.38 | 15 | +10% mana regen/level | Astral Harvest 3 |
| 3 | tp_head_start | Head Start | 5 | 1.7 | 12 | Start each ascension with `400 x 1.30^(L-1)` gold | Treasure Hunter 2 **or** Mana Well 2 |
| 3 | tp_foundry | Foundry | 12 | 1.55 | 8 | +50%/level to every scalar upgrade's level cap (progress.md §3) | Head Start 3 |
| 4 | tp_salvage | Salvage | 28 | — | 1 | +40% gold from loot orbs — locks out Arcane Abundance | Head Start 5 |
| 4 | tp_arcane | Arcane Abundance | 28 | — | 1 | −30% ability cooldowns, −40% ability mana costs — locks out Salvage | Head Start 5 |

**`tp_salvage` replaced Midas Touch** (revamp §9.2), which paid gold on every
projectile *hit* — a faucet that scaled with fire rate and projectile count,
the one shape the economy forbids everywhere else. Salvage writes the
`orbGoldMultiplier` stat instead, so it scales with wave income like the rest
of the economy; see [loot-system.md](loot-system.md). Head Start totals 400 at
L1 and 29 731 at the L12 cap — roughly one early run's income at the depth
where the last level is affordable, against the old table's 1 874 391.

#### Dominion

| Tier | ID | Name | Cost | Scaling | Max | Effect | Requires |
|---:|----|------|-----:|--------:|----:|--------|----------|
| 2 | tp_auto_cast | Auto-Caster | 8 | — | 1 | Auto-cast automation | — |
| 2 | tp_wave_start | Wave Commander | 3 | 1.55 | 8 | Start each ascension at wave `2 x level` | — |
| 2 | tp_efficiency | Efficiency | 3 | 1.5 | 7 | Auto-buy interval −1 s/level (min 3 s) | — |
| 2 | tp_game_speed | Accelerator | 6 | 2.2 | 6 | +0.5x max game speed/level | — |
| 3 | tp_auto_ascend | Auto-Ascender | 20 | — | 1 | Auto-ascend automation | Auto-Caster **or** Wave Commander 3 |
| 4 | tp_auto_transcend | Auto-Transcender | 40 | — | 1 | Auto-transcend automation | Auto-Ascender |

Accelerator's copy is the contract: it used to grant +1x a level, so a maxed
Accelerator ran the game at 11x while the panel claimed 6x. The number follows
the description now.

## Automation Unlocks

When an AP perk with `effectType: 'auto_buy'` or TP perk with `effectType: 'automation'` is purchased, the corresponding automation flag is set and `automation_unlocked` event is emitted.

Automation flags are stored in `PrestigeState.automationFlags`:
- `autoBuy` — auto-purchase cheapest upgrade
- `autoAbilities` — auto-cast abilities
- `autoAscend` — auto-ascend at target wave
- `autoTranscend` — auto-transcend when possible

### Auto-Upgrader's per-tick budget

The Auto-Upgrader perk is the only AP perk with a `maxLevel > 1`; the
ladder is **12 / 24 / 48 AP (84 total)**, three levels deep. The level is
read by `PrestigeManager.getAutoBuyCount()` (plumbed into
`AutomationDeps.prestige`) and that number is the per-tick purchase
budget: L1 buys exactly one upgrade per interval, L3 buys three. When the
perk is unspent, auto-buy is **not** unlocked at all, so the function
returns `0` and `AutomationManager.runAutoBuy` short-circuits without
running a loop it has no permission for. The one exception is a save
that has unlocked auto-buy some other way — the long-Watch `overseer`
unlock (chapter 7) grants it free — in which case `getAutoBuyCount`
returns `1` so the loop runs at the floor a single manual perk purchase
would have granted.

The `Automation` tab (now its own entry in the `prestige` group of
`NAV_GROUPS` — see [ui-system.md](ui-system.md)) reads `getAutoBuyCount`
to render the "Buys N upgrades per tick" line. The panel controls
(strategy, reserve, auto-ascend target, on/off toggles) live entirely
on that tab; the Transcendence panel no longer carries any of them.

## Second, non-AP grant paths via the Watch

Four of the things the AP tree sells are also granted by Long Watch
chapters (`docs/watch-system.md`): `veteran_start` (chapter 3), `cold_forge`
(chapter 5), `overseer` (chapter 7) and `sanctum` (chapter 11). These are
intentional overlaps — a player who earns the chapter should not have to
buy the same perk again — and they **never double-count**:

- `startWave` is already a `Math.max` over four sources (research, an AP
  perk, a talent, and `watch.veteranStart`), so any of them can lift the
  floor and none can lift it twice.
- `isAutomationUnlocked(key)` is a boolean OR across the AP perk, the TP
  perk and `watch.overseer`, so any of them unlocks it once.

`cold_forge` and `sanctum` are the two AP cores the chapters give for
free (`frostwork` normally 45 AP, `arcane` normally 90 AP). The chapter
completes call `CoreManager.unlock(id)` directly; the AP-tree path
remains the way to spend AP for either core. See
[watch-system.md](watch-system.md#the-unlock-catalogue).
