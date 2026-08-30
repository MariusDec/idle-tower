# Prestige: an interesting first ascension

**Goal:** make the Ascension shelf worth reading. Today a first ascension buys +6% fire rate and a 2% wave-skip chance, and everything that *changes what a run does* sits 60–200 AP away — three or four ascensions later. This plan widens tier 1 into a shelf of six to eight cheap, qualitatively different nodes, moves two one-time "wow" purchases into reach of the second ascension, and adds an AP respec so identity choices are safe to make.

**Related components:** `src/data/prestige.ts`, `src/systems/PrestigeManager.ts`, `src/stats/context.ts`, `src/stats/contributors/prestige.ts`, `src/game/Game.ts`, `src/ui/PrestigePanel.ts`, `src/systems/{LootManager,BlessingManager,UpgradeManager,SaveManager}.ts`, `tests/{prestige-ap,stats,content-coverage,save}.test.ts`, `sim/`.

**Status:** planning only. Every cost and effect below is a *starting value*; §8 is the gate that settles them against `npm run sim`.

---

## 1. Measured baseline

Costs and prerequisites read from `src/data/prestige.ts` as of 2026-08-30. `FIRST_ASCENSION_AP = 25`, `apForWave(20) = 20`.

### 1.1 Everything a first ascension can buy

Exhaustive enumeration over the AP tree at a 25 AP budget (the same search `tests/prestige-ap.test.ts` runs), listing only *maximal* allocations — the ones where no further purchase is affordable:

| # | Allocation | What it actually does |
|---|---|---|
| 1 | `auto_upgrader:1` | Unlocks auto-buy. Consumes the entire budget. |
| 2 | `quiver:3, might:1` | +6% fire rate, +2% damage |
| 3 | `quiver:3, wave_skipper:1` | +6% fire rate, +1% skip |
| 4 | `quiver:2, idle_time:1` | +4% fire rate, +8h offline cap |
| 5 | `quiver:1, wave_skipper:1, idle_time:1` | +2% fire rate, +1% skip, +8h |
| 6 | `quiver:1, wave_skipper:2` | +2% fire rate, +2% skip |
| 7 | `wave_skipper:2, fortune:1` | +2% skip, +2% gold |

**Seven allocations. Four distinct nodes reachable out of thirteen.** Excluding the automation unlock, the entire first-ascension payload is between **+2% and +8% composed throughput** — under a single level of the `damage` upgrade, which the run buys back inside two waves.

### 1.2 The AP curve for context

| Wave reached | 20 | 25 | 30 | 35 | 40 | 45 | 50 | 60 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| AP banked | 20 (→25 floor) | 31 | 44 | 62 | 88 | 124 | 174 | 344 |

The wall for a fresh run sits near wave 39 (`plans/upgrades-revamp.md` §1.1), so the realistic ladder is **25 → ~45 → ~85 → ~150**. Tier 3 opens at 60 AP *plus* its prerequisite line (`might` L5 = 43 AP, or `quiver` L5 = 38 AP), i.e. ~98 AP — the **fourth** ascension at the earliest.

### 1.3 Five structural faults

1. **Tier 1 is four scalars, and two of them do not touch the run.** `ap_idle_time` is an offline cap and `ap_research_speed` (tier 2) is a background timer. Neither changes a second of play.
2. **`ap_auto_upgrader` costs exactly the whole first budget.** It is the one transformative tier-1 node and it is priced as an all-or-nothing choice — and the Watch's `overseer` unlock later hands the same thing out free, so the 25 AP price is doubly bad.
3. **Every qualitative node is behind a wall.** Twin Arrows (60), Bodkin (75), Rear Guard (90), Scatter (200), plus a prerequisite line. Nothing between wave 20 and ~ascension four changes *how* the tower fires.
4. **AP has no identity.** TP has three named branches and two exclusive pairs. AP has one exclusive pair at tier 4 and is otherwise a flat list of thirteen rows in the panel.
5. **The shape is codified in a test.** `tests/prestige-ap.test.ts` gate 10 asserts "the first ascension is one utility choice, **not a shopping list**". That was the right call when 25 AP could buy a 7x damage multiplier (revamp §1.5). It is the wrong call now that tier 1 is four scalars — §8.1 replaces it rather than deleting it.

---

## 2. Design rules

Constraints any new perk has to satisfy. These are what stop this plan from becoming twenty more `+2% x` rows.

**R1 — Do not duplicate a Watch unlock.** The Long Watch already owns: a fourth contract slot (`board_expansion`), an extra free reroll (`quartermaster`), a wave-5 start (`veteran_start`), four-card drafts (`wide_draft`), a free Frostwork core (`cold_forge`), risk steps 6 and 7 (`riskbearer`, `deep_watch`), free auto-buy (`overseer`), wider mutators (`storm_caller`), a surviving blessing (`heirloom`), and persistent ability levels (`long_memory`). An AP perk that grants any of those either duplicates a chapter reward or makes it worthless.

**R2 — Nothing that composes with `Math.max`.** `Game.resetRunBaselines` takes `Math.max` across research start-wave, `tp_wave_start`, talent head-start and `veteran_start`. A levelled AP "start at wave N" node would be permanently superseded the moment any of those goes higher — AP spent on something that becomes a no-op. This rules out the obvious "Field Promotion" perk; see §9.

**R3 — Land on an existing `StatKey` or an existing manager hook, or declare the new consumer.** §3's whole shelf resolves through keys that already have consumers wired in `applyResolvedStats`. That is what makes it a data-and-plumbing change rather than a combat change.

**R4 — Price in throughput, never in a shot or a kill.** The house rule from `src/data/pacing.ts` and `src/data/cores.ts`. Nothing below pays per hit.

**R5 — Widen the shelf, do not inflate the income.** `FIRST_ASCENSION_AP` stays 25 and `apForWave` is untouched. The fix is entry costs of 4–12 AP, not more AP.

**R6 — A first ascension should buy three or four *different* things, at least one of which is not a percentage.** This is the replacement for gate 10.

---

## 3. Phase 1 — the new tier-1 shelf (data + thin plumbing)

Every node here resolves through a `StatKey` that already has a consumer, or through a manager method that already exists. No new combat code.

### 3.1 New perks

| id | Name | Cost / scaling | Max | Effect per level | Hook |
|---|---|---|---|---|---|
| `ap_seed_capital` | **Seed Capital** | 5 / 1.30 | 8 | Start each run with `200 * 1.45^(L-1)` gold | `PrestigeManager.getStartGold()` — extend to scan `AP_PERKS` (already reads `effectType: 'start_gold'`) |
| `ap_prospector` | **Prospector** | 4 / 1.30 | 10 | −1.5% upgrade cost | `upgradeCostDiscount` → `UpgradeManager.setCostDiscount` (clamped to −50% in the manager) |
| `ap_veterancy` | **Veterancy** | 5 / 1.28 | 8 | +8% tower XP | `xpGainMultiplier` → `TowerXpManager` + `PassiveAbilityManager` |
| `ap_field_notes` | **Field Notes** | 6 / 1.45 | 6 | +2% RP drop chance | `rpDropChanceBonus` → `EnemyManager.setRPDropChanceBonus` |
| `ap_lodestone` | **Lodestone** | 18 flat | 1 | Loot orbs always home to the tower at full value | `LootManager.setMagnetSource('prestige', true)` — already ref-counted (§3.3) |
| `ap_second_wind` | **Second Wind** | 20 flat | 1 | +1 revive charge per run | `reviveCharges` → `Game.extraReviveCharges` |

Cost ladders (cost / cumulative):

```
seed_capital  5/5   6/11  8/19  10/29 14/43 18/61 24/85 31/116
prospector    4/4   5/9   6/15  8/23  11/34 14/48 19/67 25/92
veterancy     5/5   6/11  8/19  10/29 13/42 17/59 21/80 28/108
field_notes   6/6   8/14  12/26 18/44 26/70 38/108
```

**Why these six.** Each one is a different *verb*, and each is visible within a minute of the next run starting:

- **Seed Capital** is the strongest first-ascension feeling available: the run opens with three or four upgrades already affordable instead of a wave of waiting. It rides the "one run's early income" rule that sizes `tp_head_start` (revamp §9.2), and the ladder is deliberately shallow relative to the AP curve: L1 = 200 gold is ~2.3x the 87 gold a `veteran_start` run opens with and ~9 waves of wave-5 income (22/wave), while L8 = 2 695 costs 116 cumulative AP and is only ~4 waves of the wave-30 income (655/wave) a player at that AP total is earning. **This is the one node in §3.1 whose base is a genuine balance risk** — front-loaded gold compounds through the whole upgrade curve, and §8.3 is the gate that settles it.
- **Prospector** compounds against the only thing the early run does: buy upgrades. −15% at max is a real curve shift and is legible on every button in the panel.
- **Veterancy** and **Field Notes** are the cross-layer nodes: AP that buys progress in the *talent* and *research* layers. They give the player a reason to look at prestige even when their tower is fine.
- **Lodestone** and **Second Wind** are the one-time purchases that make ascension #2 an event. Neither is a multiplier; one removes a chore and raises effective gold, the other turns "run over" into "one more wave".

### 3.2 Retunes to existing nodes

| Node | Change | Why |
|---|---|---|
| `ap_auto_upgrader` | 25 → **12 AP** | Fault 2. At 12 it is a purchase, not the entire budget, and it stays worth buying before `overseer` arrives. |
| `ap_wave_skipper` | scaling 1.60 → **1.42**, effect 1% → **1.5%**/level, max 15 → **12** | The current ladder reaches +15% for 155 AP and +3% for the first 15. New ladder: +18% for 219 AP, +4.5% for the first 26 — still the weakest row on the shelf, but no longer a rounding error. |
| `ap_quiver`, `ap_idle_time`, `ap_might`, `ap_fortune`, `ap_research_speed`, tiers 3–4 | **unchanged** | Deep Quiver is the deliberate "boring but honest" scalar and retuning it is a sim-wide balance change. The interest comes from the new nodes, not from re-pricing the old ones. |

### 3.3 Tier and prerequisite layout

Tier 1 (no prerequisites): `ap_auto_upgrader`, `ap_quiver`, `ap_wave_skipper`, `ap_seed_capital`, `ap_prospector`, `ap_veterancy`, `ap_idle_time`.

Tier 2 (one OR-prerequisite each, in the existing OR style):

- `ap_lodestone` ← `ap_seed_capital` L2 **or** `ap_wave_skipper` L2
- `ap_second_wind` ← `ap_quiver` L3 **or** `ap_auto_upgrader` L1
- `ap_field_notes` ← `ap_veterancy` L2 **or** `ap_auto_upgrader` L1
- `ap_might` ← existing parents **plus** `ap_prospector` L3
- `ap_fortune` ← existing parents **plus** `ap_seed_capital` L3
- `ap_research_speed` ← existing parent **plus** `ap_field_notes` L2

Tiers 3 and 4 are untouched, so the projectile gates hold unchanged (§8).

### 3.4 What the first two ascensions look like afterwards

Same exhaustive enumeration as §1.1, run against the proposed table:

| | Today | Proposed |
|---|---:|---:|
| Distinct maximal allocations at 25 AP | **7** | **118** |
| Distinct nodes reachable at 25 AP | **4** | **11** |
| Non-scalar nodes reachable at 25 AP | 1 (auto-buy) | 1 (auto-buy) + Seed Capital |
| Non-scalar nodes reachable at 45 AP (ascension #2) | 1 | 4 (auto-buy, Seed Capital, Lodestone, Second Wind) |

Representative 25 AP builds, each with a story:

- `auto_upgrader:1, prospector:1, quiver:1` — automation opener
- `seed_capital:3, prospector:2` — economy opener; opens `ap_fortune` next run
- `prospector:3, might:1, quiver:1` — damage opener; opens `ap_might` without auto-buy
- `veterancy:2, field_notes:1, quiver:1` — cross-layer opener, feeding talents and research

Ascension #2 at ~45 AP reaches Lodestone (`seed_capital` L2 = 11, + 18 = 29) or Second Wind (`auto_upgrader` = 12, + 20 = 32). **The one-time nodes land one ascension after the first, not four.**

---

## 4. Phase 1 implementation

Ordered; each step compiles on its own.

1. **`src/data/prestige.ts`** — add `'upgrade_cost' | 'xp_gain' | 'rp_drop' | 'orb_magnet' | 'revive_charge'` to `PrestigePerkEffect`; add the six defs to `AP_PERKS`; apply §3.2's retunes and §3.3's prerequisites. Icons: `shiny-purse` (Seed Capital), `gold-mine` (Prospector), `brain` (Veterancy), `book-pile`/`scroll` (Field Notes), `magnet` (Lodestone), `shining-heart` (Second Wind) — all present in `src/data/icons.ts`.
2. **`src/systems/PrestigeManager.ts`** — extend `getStartGold()` to scan `AP_PERKS` as well as `TP_PERKS`; add `getAPUpgradeDiscount()`, `getAPXpMultiplier()`, `getAPRpDropBonus()`, `getAPReviveCharges()`, `hasOrbMagnet()`. Each follows the existing scan-the-table shape.
3. **`src/stats/context.ts`** — `PrestigeInputs` gains `apUpgradeDiscount`, `apXpGain` (already `1 + x` shaped), `apRpDrop`, `apReviveCharges`; add them to `emptyStatContext()`.
4. **`src/stats/contributors/prestige.ts`** — four lines: `ap.add('upgradeCostDiscount', -p.apUpgradeDiscount)`, `ap.mult('xpGainMultiplier', p.apXpGain)`, `ap.add('rpDropChanceBonus', p.apRpDrop)`, `ap.add('reviveCharges', p.apReviveCharges)`.
5. **`src/game/Game.ts`** — four lines in the `prestige:` block of the stat-context builder. Lodestone is the one that does not fit the accumulator (it is a boolean, not a number): call `this.lootMgr.setMagnetSource('prestige', this.prestigeMgr.hasOrbMagnet())` from `applyResolvedStats`, next to `setValueBonus`. The magnet is ref-counted and early-returns when unchanged, so calling it every recompute is free. *Alternative considered:* a `orbMagnet` 0/1 `StatKey`. Rejected — the accumulator is numeric-by-contract and a boolean-shaped key invites `0.5`.
6. **`src/ui/PrestigePanel.ts`** — six `case` arms in `formatAPBonusText`. Note the existing `default: return ''`: a perk whose effect type has no arm renders a **blank** bonus line rather than failing to compile. §8.4 adds the test that closes that hole.

---

## 5. Phase 2 — the nodes that need a new hook

These are the more interesting perks, and each costs a dependency injection. Ship after phase 1 measures clean; each is independent.

| id | Name | Cost | Effect | Hook needed |
|---|---|---|---|---|
| `ap_opening_gambit` | **Opening Gambit** | 22, one-time, tier 2 | The first blessing draft arrives on wave 1 instead of wave 3 | `BlessingManager` gains a `firstDraftWave: () => number` dep, read by `isDraftWave` in place of the `BLESSING_FIRST_DRAFT_WAVE` constant |
| `ap_field_kit` | **Field Kit** | 8 / 1.5, max 3, tier 2 | Start each run with L banked blessing rerolls | `Game.resetRunBaselines` calls `blessingMgr.addRerollTokens(n)` after `blessingMgr.reset()` |
| `ap_attunement` | **Attunement** | 20 / 1.8, max 3, tier 3 | Abilities unlock 3 waves earlier per level | `AbilityManager` unlock check takes an offset; `MilestoneStrip` and `src/data/milestones.ts` read `unlockWave` statically and would drift — both need the offset too |
| `ap_broker` | **Broker** | 10 / 1.5, max 4, tier 2 | +20% contract rewards per level | `ContractManager` reward scaling dep, alongside the existing `slots` dep |

**Ranking, if only one ships:** `ap_field_kit` (smallest hook, and rerolls are immediately felt), then `ap_opening_gambit` (biggest change to how a run opens — blessings are the run's identity and pulling the first draft to wave 1 makes the ascension reset feel like a new run rather than the same run again), then `ap_broker`, then `ap_attunement` (largest blast radius: three files read `unlockWave` and the milestone strip would lie).

R1 check: Field Kit banks *tokens* (the `rerollTokens` channel), where `quartermaster` grants a *free reroll per draft* (the `freeRerolls` channel). They are separate fields on `BlessingManager` and compose. Opening Gambit moves the first draft's *wave*; `wide_draft` changes the card *count*. No overlap.

---

## 6. Phase 3 — Reforge (AP respec) and panel structure

### 6.1 Reforge

Everything above makes the tier-1 shelf a real decision, which makes a wrong first choice a permanent one. AP perks are permanent and never run-scoped, so a respec has no exploit surface — unlike a TP respec, nothing about AP is timed against a run.

- `PrestigeManager.reforge()`: sum `perkCost(def, l)` for every `l < level` across `apSpent`, credit it back to `resources.ascensionPoints`, clear `apSpent`.
- **`automationFlags` is the trap.** `autoBuy` is set to `true` on purchase and read from the stored flag; `isAutomationUnlocked` recomputes from the tables plus `externalAutomation`. Reforge must re-derive every flag: `flags[k] = isAutomationUnlocked(k) && flags[k]`, so a player who reforges away Auto-Upgrader loses auto-buy unless the Watch's `overseer` already granted it.
- Cores are an AP *spend*, not a perk, and are not refunded. Say so in the confirm dialog.
- Free, with a confirm dialog. A gold/AP tax on a respec is a tax on experimenting, which is the thing this plan is trying to buy.

### 6.2 Panel

Thirteen rows was already a flat list; nineteen is unreadable. Group `renderAPPerksList` by `tier` with a heading per tier (the defs already carry `tier`), matching how `TranscendencePanel` groups by `branch`. Optionally give AP perks a `branch`-like `path` field (`arsenal` / `fortune` / `command`) — cosmetic, but it is what makes the tree read as a tree and gives the first ascension a visible identity. Cheap, and it is the difference between "a list of numbers" and "a choice".

---

## 7. Save migration (v21 → v22)

`SAVE_VERSION` is 21. Add `migrateV21toV22`:

- Clamp `apSpent` through the existing `clampPerkLevels(apSpent, AP_PERK_BY_ID)` — this handles `ap_wave_skipper` 15 → 12 without restating the number.
- New perk ids need nothing: absent means level 0.
- **`ap_auto_upgrader` 25 → 12: no refund.** Precedent is `migrateV20toV21`'s explicit "no refunds anywhere — this is a balance migration, not an accounting one". If §6.1's Reforge ships in the same release, the question is moot: a player who overpaid can reforge and re-buy at the new price.

---

## 8. Gates

Nothing merges until these hold. §8.1–8.2 are the rewritten `tests/prestige-ap.test.ts` gates; §8.3 needs `npm run sim`.

**8.1 — Gate 10, replaced.** The old assertion ("one utility choice, not a shopping list") is the bug. Keep the half that still matters and invert the half that does not:

- *keep:* no allocation reachable at `FIRST_ASCENSION_AP` contains any of `ap_extra_shots`, `ap_back_shots`, `ap_scatter_shots`, `ap_pierce`.
- *new:* at least one reachable allocation holds **three or more distinct perks**.
- *new:* the reachable set touches **at least eight distinct nodes** (proposed table reaches 11).
- *new:* at least one reachable allocation contains a node whose effect is not a percentage multiplier (`ap_auto_upgrader` or `ap_seed_capital`).

**8.2 — Gate 11, unchanged.** 82 AP still buys at most one signature node. Verified by hand against the proposed table: Twin Arrows needs `might` L5 (43 AP, or 55 through the cheaper auto-buy) or `quiver` L5 (38 AP), plus 60 — 98 AP at best, so the gate is not even close to binding.

**8.3 — Throughput.** Composed DPS and gold at a matched wave, first-ascension budget, must land inside the same band the revamp's §14 set. Seed Capital is the one to watch: it is front-loaded gold, which the model credits as a permanent head start. If it measures past the band, cut the base (200) before cutting the ladder — the L1 purchase is the one that has to feel good.

**8.4 — No blank rows.** A test that every `effectType` present in `AP_PERKS` produces a non-empty string from `formatAPBonusText`, closing the `default: return ''` hole in §4.6. Mirrors the existing "consumes every perk effect it sells" test.

**8.5 — Coverage.** `tests/content-coverage.test.ts` already asserts an icon per perk; the six new ids must resolve in `iconMap`.

**8.6 — Stats routing.** `tests/stats.test.ts`: each of the four new `PrestigeInputs` fields moves its `StatKey` and nothing else.

---

## 9. Rejected

- **"Field Promotion" — start each run N waves in.** Violates R2: `Game.resetRunBaselines` takes `Math.max` across research, `tp_wave_start`, talents and `veteran_start`, so AP spent here becomes a permanent no-op the moment any other source goes higher. If a start-wave AP node is ever wanted, the composition rule has to change first.
- **A fourth contract slot, an extra free reroll, a free core, a risk step.** R1 — all four are Watch chapter rewards.
- **Per-hit gold (a "Midas" AP node).** R4, and the revamp already removed exactly this from the TP tree (`tp_midas` → `tp_salvage`, §9.2).
- **Keeping a fraction of upgrade levels across an ascension.** Tempting and very idle-game, but it fights `UpgradeManager.reset()` and the whole "the run resets" contract, and `heirloom` already occupies the "something survives the ascension" slot. Revisit only if the reset contract is ever revisited.
- **Raising `FIRST_ASCENSION_AP`.** R5. More AP against the same four scalars is the same shelf with bigger numbers.
