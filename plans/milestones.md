# The Long Watch — a chapter campaign

**Date:** 2026-08-28
**Branch:** `main`
**Status:** implementation brief. Written to be executed by someone who has read none of the
other plans in `plans/`. Every part restates what it owns, gives the exact code, and names its
own acceptance check.

**Owns (new):** `src/data/watch.ts`, `src/systems/WatchManager.ts`, `src/ui/JournalPanel.ts`,
`src/ui/JournalStrip.ts`, `src/ui/ChapterModal.ts`, `tests/watch.test.ts`,
`docs/watch-system.md`.

**Owns (edited):** `src/types.ts`, `src/systems/SaveManager.ts`, `src/game/Game.ts`,
`src/systems/ContractManager.ts`, `src/systems/BlessingManager.ts`,
`src/systems/PacingManager.ts`, `src/systems/PrestigeManager.ts`, `src/data/pacing.ts`,
`src/ui/UIManager.ts`, `src/ui/HUD.ts`, `src/ui/navGroups.ts`, `src/ui/EnemyCodexModal.ts`,
`src/styles/main.css`, `src/styles/tokens.css`, `tests/content-coverage.test.ts`,
`tests/save.test.ts`, `AGENTS.md`, `docs/event-bus.md`, `docs/save-system.md`,
`docs/ui-system.md`, `docs/milestones.md`.

---

## 0. The problem

### 0.1 What the game asks of the player today

Play waves → buy upgrades → reach the ascension wave → ascend → play the same waves faster.
That loop is complete and it works, but the only thing it ever asks for is **more of the same
number**. Nothing in the game ever says *"do this specific thing and something new happens."*

Four systems look like they should fill that gap and none of them does:

| System | Horizon | Why it does not pull |
|---|---|---|
| **Contracts** (`src/data/contracts.ts`) | 2–3 waves | Pays 0.4–1.2 waves of income — a rounding error against an upgrade curve of `base × growth^level`. Its own doc measures contract gold at **3–9% of a run's income** and idle wall drift at **zero**. By design it is texture, not a goal. |
| **Achievements** (18 defs) | lifetime | Fires perhaps twice an hour, pays `+5% damage`, and is a list you *read after the fact*. Nothing is ever "next". |
| **Milestone strip** | next unlock | Purely informational. It tells you Frost Nova arrives at wave 18; it never asks you for anything. |
| **Prestige** | the run | The only real goal, and it is the same goal forever. |

So the honest description of the current design is: **the game has a difficulty curve but no
campaign.** A player who asks "what am I working towards?" gets the answer "a bigger number,
eventually."

### 0.2 What this plan adds, in one paragraph

**The Long Watch** is a permanent, ordered chain of twelve **chapters**. Exactly one chapter is
active at a time. Each chapter names three objectives and one **reward that is content, not a
percentage** — a fourth contract slot, a wider blessing draft, a free tower core, a higher risk
dial, auto-buy without the perk, ability levels that survive an ascension. Objectives read
*lifetime* counters, so an idle run advances them; two or three per chapter reward deliberate
play (flawless waves, swift bosses, waves cleared at high risk). Completing a chapter pops a
modal, grants the unlock, and reveals the next chapter with its reward already visible. At every
moment of the game there is one named thing to chase and one named thing you will get for it.

### 0.3 Why chapters, and not the other two shapes

Two adjacent designs were considered and are **folded into this one rather than built beside it**:

- **First-clear depth rewards** ("reach wave N for the first time → permanent reward"). This is
  chapter objective #1 of every chapter: each chapter opens with a `reach_wave` objective, and
  each chapter's reward is exactly the permanent thing a depth first-clear would have paid. The
  chapter chain *is* the depth ladder, with two extra objectives attached so depth alone is not
  the whole ask.
- **Bestiary mastery** (per-enemy lifetime kill tracks). This is the `kills_of` objective kind,
  and §7 surfaces its progress inside the enemy codex. A separate mastery system would have been
  a second set of counters, a second reward economy and a second panel for the same feeling.

One manager, one save block, one panel. That is deliberate: three parallel goal systems compete
for the same attention and each one gets a third of it.

### 0.4 Ground truth verified in the tree on 2026-08-28

Read this table before writing anything. Every line was checked against the working tree.

| Fact | Where |
|---|---|
| Save version is **18** (`AGENTS.md` still says 16 — it is stale) | `src/systems/SaveManager.ts:32` |
| Migration ladder is a chain of `if (data.version === N)` calls, plus a `validate()` version whitelist, plus a block of "ensure fallback fields exist" defaults | `SaveManager.ts:565`, `:581-596`, `:598-611` |
| `AchievementManager` is the polled-goal template: `tick(dt)` accumulates to 1 s, then `checkAll()` reads a stats snapshot through injected callbacks | `src/systems/AchievementManager.ts` |
| `ContractManager` is the event-driven template, and its `CONTRACT_PROGRESS` `Record` over the goal union is the repo's "a kind without a consumer does not compile" pattern | `src/systems/ContractManager.ts:56-100` |
| `CONTRACT_SLOTS = 3`, read only by `ContractManager.refill()` and tests | `src/data/contracts.ts:105` |
| `BLESSING_OFFER_SIZE = 3` (read only in `rollOffer`), `BLESSING_FREE_REROLLS = 1` (read only in `openDraft`) | `src/data/blessings.ts:129,132`; `src/systems/BlessingManager.ts:164,184` |
| `MAX_RISK = 5` and `clampRisk()` are the only bound on the risk dial | `src/data/pacing.ts:164,181` |
| `PrestigeManager.isAutomationUnlocked(key)` is the single choke point for every automation gate | `src/systems/PrestigeManager.ts:284` |
| The run's start wave is already a `Math.max` over three sources — research, an AP perk, a talent | `src/game/Game.ts` `applySavedStateReset`, the `const startWave = Math.max(` block |
| `AbilityManager.resetLevels()` is called once, from `applySavedStateReset` | `src/systems/AbilityManager.ts:804`; `src/game/Game.ts:3870` |
| `CoreManager.unlock(id)` is idempotent and permanent — neither reset path touches `unlocked` | `src/systems/CoreManager.ts:177` |
| `enemy_killed` handler already increments `stats.enemiesKilled` and calls `contractMgr.note` — the one place a per-type counter belongs | `src/game/Game.ts:852-856` |
| `wave_cleared` handler already has `this.waveFlawless` and the mutator flag in hand at the `contractMgr.note` call | `src/game/Game.ts:1580-1587` |
| `resolveBossEncounter()` computes `swift` and notes the contract; it is where a swift-boss counter belongs | `src/game/Game.ts:2091-2101` |
| The contract payout block (`contract_completed` handler) is where a lifetime contract counter belongs | `src/game/Game.ts:1360-1395` |
| Panels are mounted from two parallel `switch (tab)` blocks in `UIManager.setActiveTab` | `src/ui/UIManager.ts:851-882` |
| Tabs live in exactly one table; adding one is an entry in `NAV_GROUPS` plus a member of `PanelTab` | `src/ui/navGroups.ts`; `src/types.ts:73` |
| The bottom-left corner stack is `contract-tracker-slot` at the base with `milestone-strip-slot` offset by `--contract-tracker-height` (defined in `tokens.css:404`), repeated in three media blocks | `src/styles/main.css:3394-3398, 4232-4245, 4320-4322` |
| A literal colour anywhere in `src/ui/*.ts`, `Game.ts`, `Renderer.ts` or `EffectsManager.ts` is a **failing test**; `src/data/*` content tables are explicitly exempt | `tests/palette.test.ts:173-200` |
| Icons must come from the committed `ICON_IDS` union (190 ids). Adding one needs a network re-fetch — **use existing ids only** | `src/data/icons.ts:12` |
| Enemy unlock waves: normal 1, fast 3, tank 5, flying 8, boss 10, splitter 12, healer 15, shielded 20, siege 25, thief 30, blinker 35, warden 40, burrower 45 | `src/data/enemies.ts` |
| Measured idle wall waves by lifetime AP: 0 → 39, 100 → 59, 1 K → 89, 10 K → 129, 100 K → 169 | `docs/contract-system.md` §Balance |

### 0.5 Rules for every part below

1. **Green baseline or it does not land:** `npm run typecheck`, `npm test`, `npm run checks`.
2. **`npm run sim` must be byte-identical to `HEAD`.** Every unlock this plan adds is gated on a
   save block that starts empty, and `sim/model.ts` builds a fresh state — so the simulator can
   never see an unlock. Any diff at all in the sim output means a default changed by accident
   (most likely `CONTRACT_SLOTS`, `BLESSING_OFFER_SIZE` or `MAX_RISK` was edited instead of being
   made overridable). That is a bug in the change, not a rebalance.
3. **The Watch never touches a stat.** No `StatKey`, no contributor, no multiplier. Its rewards
   are unlocks with named consumers. If you find yourself editing `src/stats/`, stop.
4. **Closed unions with `Record` consumer maps.** Objective kinds and unlock ids are closed
   unions; the progress map and the consumer map are `Record`s over them, so a member added
   without an implementation does not compile. This is the repo's core convention — see
   `ACHIEVEMENT_REWARD_CONSUMERS` and `CONTRACT_PROGRESS`.
5. **Colours: tokens, not literals**, in everything under `src/ui/`. Chapter accent colours live
   in `src/data/watch.ts`, which is exempt (like `milestoneKindColor`).
6. **Icons: existing `IconId`s only.**
7. **Per `CLAUDE.md`:** run `impact({target, direction: "upstream"})` before editing any symbol
   named below and report the blast radius; run `detect_changes()` before each commit.

### 0.6 Out of scope

- No new currency, no shop, no spendable Watch points. The reward *is* the unlock.
- No time-gated content (dailies, weeklies). This game is played offline for days at a stretch.
- No branching or optional chapters. One chain, one order, one active chapter.
- No rebalance of contracts, achievements or the AP curve. They are left exactly as they are.

---

## 1. The design

### 1.1 A chapter

```
┌─────────────────────────────────────────────────────────┐
│  CHAPTER 3   The Ascendant Step                         │
│  "The tower falls so the tower may stand taller."       │
│                                                         │
│  ▸ Reach wave 35                        35 / 35   ✓     │
│  ▸ Ascend 3 times                        2 / 3          │
│  ▸ Complete 25 contracts                19 / 25         │
│                                                         │
│  REWARD  ⚑ Veteran Start                                │
│          Every run begins at wave 5.                    │
└─────────────────────────────────────────────────────────┘
```

- **Exactly one chapter is active.** Chapters are strictly ordered; chapter N+1 is not evaluated
  until chapter N is complete.
- **Three objectives**, all of which must complete. Order within a chapter is presentation only.
- **One reward**, always a content unlock, always visible *before* the chapter is done — that is
  the entire pull mechanism. A hidden reward is not a goal.
- **Locked chapters are visible too**, name and reward included. The player should be able to
  read the whole road ahead on the Journal tab. Only the objectives of far-future chapters are
  worth hiding, and this plan does not even do that — see §6.3.

### 1.2 Objectives poll lifetime counters; they do not subscribe to events

`ContractManager` is event-driven because a contract is run-scoped and its progress must be exact
to the frame. The Watch is the opposite: its counters are lifetime, monotonic, and read a few
times a second at most. So it follows `AchievementManager` instead — one `tick(dt)` that
accumulates to a second and then evaluates the active chapter against a **`WatchMetrics`
snapshot**.

Three consequences worth being explicit about, because they are the reason for the choice:

1. **Offline progress works for free.** Anything the offline walk credits into `stats` is picked
   up on the next poll, with no replay of events that were never emitted.
2. **A save load cannot lose progress**, because there is no progress state to lose — objective
   progress is *derived* from counters every time it is read. The only thing the save stores is
   which chapters are done, plus the counters themselves.
3. **Retroactive credit is automatic and intentional.** A player who installs this update at wave
   140 completes several chapters in a row. That is correct: they earned it. §1.6 paces the
   cascade so it reads as a reward burst rather than a stack of modals.

### 1.3 The objective kinds

Sixteen kinds, a closed union, with `WATCH_PROGRESS` as a `Record` over it:

| Kind | Reads | Idle-safe |
|---|---|---|
| `reach_wave` | `stats.lifetimeHighestWave` | yes |
| `kills` | `stats.enemiesKilled` | yes |
| `kills_of` | `watch.counters.killsByType[type]` **(new)** | yes |
| `bosses` | `stats.bossesKilled` | yes |
| `gold_earned` | `stats.goldEarned` | yes |
| `ascensions` | `stats.lifetimeAscensions` | yes |
| `transcendences` | `stats.transcendences` | yes |
| `abilities_cast` | `stats.abilitiesCast` | yes |
| `upgrades_bought` | `stats.totalUpgradesPurchased` | yes |
| `tower_level` | `towerXp.level` | yes |
| `blessing_picks` | `watch.counters.blessingPicks` **(new)** | yes |
| `contracts_done` | `watch.counters.contractsDone` **(new)** | yes |
| `flawless_waves` | `watch.counters.flawlessWaves` **(new)** | mostly — a strong tower clears waves untouched while idle |
| `swift_bosses` | `watch.counters.swiftBosses` **(new)** | mostly — same |
| `risk_waves` | `watch.counters.riskWaves[]` **(new)** | **no** — the dial is a deliberate setting |
| `mutator_waves` | `watch.counters.mutatorWaves` **(new)** | **no** — a mutator must be accepted |

Seven new lifetime counters, each incremented at exactly one named call site (§4.2). Nine kinds
read counters that already exist.

The mix is the answer to "mixed, mostly idle-safe": of the 36 objectives in §1.5, **28 advance on
their own** and 8 ask for intent — and no chapter is made entirely of the second sort.

### 1.4 The unlock catalogue

Twelve unlocks, a closed union `WatchUnlockId`, each with an entry in
`WATCH_UNLOCK_CONSUMERS: Record<WatchUnlockId, string>` naming the exact site that reads it. That
map is what `tests/watch.test.ts` holds to a real consumer, and it is why an unlock cannot ship
as flavour text.

| Id | Name | What it does | Consumer |
|---|---|---|---|
| `board_expansion` | The Board | Contracts run **4 slots** instead of 3 | `ContractManager.refill` via injected `slots()` |
| `quartermaster` | Quartermaster | **+1 free reroll** on every blessing draft | `BlessingManager.openDraft` via injected `freeRerolls()` |
| `veteran_start` | Veteran Start | Every run **begins at wave 5** | `Game.applySavedStateReset`'s `startWave` max |
| `wide_draft` | Wide Draft | Blessing drafts offer **4 cards** | `BlessingManager.rollOffer` via injected `offerSize()` |
| `cold_forge` | The Cold Forge | The **Frostwork core**, free (normally 10 AP) | `Game` on chapter completion → `CoreManager.unlock('frostwork')` |
| `riskbearer` | Riskbearer | Risk dial goes to **6** | `clampRisk` / `PacingManager` via injected `maxRisk()` |
| `overseer` | Overseer | **Auto-buy** automation, without the 25 AP perk | `PrestigeManager.isAutomationUnlocked` via injected `externalAutomation()` |
| `storm_caller` | Storm Caller | Mutator offers **4 choices** and runs **one wave longer** | `Game`'s `wave_modifier_offer` handler |
| `heirloom` | Heirloom | Your **best blessing carries into the next run** | `Game.applySavedStateReset` → `BlessingManager.resetRun({carryBest})` |
| `deep_watch` | Deep Watch | Risk dial goes to **7** | same as `riskbearer` |
| `sanctum` | Sanctum | The **Arcane core**, free (normally 25 AP) | `Game` on chapter completion → `CoreManager.unlock('arcane')` |
| `long_memory` | Long Memory | **Ability levels survive an ascension** | `Game.applySavedStateReset` skips `abilityMgr.resetLevels()` |

Why these twelve and not stat bonuses: every one of them changes a *rule*. After `wide_draft` the
draft is a different decision; after `riskbearer` the dial has a step that did not exist; after
`long_memory` the ascension means something different than it did an hour ago. A `+8% damage`
reward would be invisible inside a curve that already multiplies by lifetime AP.

Two of them (`veteran_start`, `overseer`) overlap things the player can also buy with AP. That is
deliberate and harmless: `startWave` is already a `Math.max` over three sources, and
`isAutomationUnlocked` is a boolean OR. Neither double-counts.

### 1.5 The chapter table

Depth gates are read off the measured idle walls in §0.4 — chapter *N*'s wave gate sits at or
just past where a player with the previous chapter's tools is already operating, so the gate is a
push, not a wall.

| # | Chapter | Objectives | Reward |
|---|---|---|---|
| 1 | **The First Watch** | Reach wave 15 · Kill 1 500 enemies · Clear 5 waves without losing HP | `board_expansion` |
| 2 | **Blood and Iron** | Reach wave 25 · Kill 400 tanks · Kill 10 bosses | `quartermaster` |
| 3 | **The Ascendant Step** | Reach wave 35 · Ascend 3 times · Complete 25 contracts | `veteran_start` |
| 4 | **Arsenal** | Reach wave 45 · Cast 1 000 abilities · Take 40 blessings | `wide_draft` |
| 5 | **The Cold Forge** | Reach wave 60 · Kill 600 shielded enemies · Clear 10 boss encounters in under 30 s | `cold_forge` |
| 6 | **Riskbearer** | Reach wave 75 · Clear 40 waves at risk 3+ · Earn 50 M lifetime gold | `riskbearer` |
| 7 | **Overseer** | Reach wave 90 · Ascend 10 times · Buy 2 500 upgrades | `overseer` |
| 8 | **Storm Caller** | Reach wave 110 · Clear 60 waves under a mutator · Kill 300 wardens | `storm_caller` |
| 9 | **Reliquary** | Reach wave 130 · Take 200 blessings · Complete 150 contracts | `heirloom` |
| 10 | **Deep Watch** | Reach wave 150 · Clear 100 waves at risk 5+ · Kill 2 000 000 enemies | `deep_watch` |
| 11 | **Sanctum** | Reach wave 175 · Transcend 5 times · Reach tower level 100 | `sanctum` |
| 12 | **The Long Watch** | Reach wave 200 · Ascend 50 times · Kill 1 500 bosses | `long_memory` |

Sanity checks that were run against the tree before these numbers were written:

- Every `kills_of` type is unlocked far below its chapter's wave gate (tank 5 ≪ 25, shielded
  20 ≪ 60, warden 40 ≪ 110), so no objective can ask for an enemy that does not spawn yet.
  `tests/watch.test.ts` pins this against `ENEMY_DEFS[type].unlockWave`.
- Chapter 6's `risk_waves` asks for risk **3+**, not 5, because risk 5 before `riskbearer` is the
  ceiling and asking for the ceiling makes a chapter a wall. Chapter 10 asks for 5+ *after* the
  dial has been raised twice, so it is no longer the ceiling either.
- Chapter 11's tower level 100 is half the level cap (`TOWER_LEVEL_CAP = 200`).

### 1.6 The cascade rule

`WatchManager.check()` completes **at most one chapter per call**, and `tick` calls it at most
once a second. A player installing this at wave 140 therefore watches chapters land one per
second, each with its own toast and modal, rather than receiving twelve at once. The UI queues
modals (§6.4) and shows the next one when the previous is dismissed.

This is not a fairness limiter — it grants everything earned. It is a legibility limiter.

### 1.7 What this does to balance

Nothing, until a chapter completes — and then, deliberately, quite a lot. The four unlocks that
touch the curve are `veteran_start` (chapter 3), `riskbearer` (6), `overseer` (7) and
`deep_watch` (10). Each is a step change the player *chose to earn*, arriving at a depth where
the curve has flattened.

The acceptance rule in §0.5 rule 2 (`npm run sim` byte-identical) holds because the simulator
never has a completed chapter. **Do not add Watch unlocks to `sim/model.ts`.** If a later change
wants to measure a post-chapter-10 run, that is a separate piece of work with its own before/after
table; this plan ships the mechanism and leaves the sim's baseline untouched, which is the only
way to keep the sim useful as a regression check for everything else.

---

## 2. Part A — the data layer

**New file: `src/data/watch.ts`.** Nothing outside this file knows what a chapter is made of.

### 2.1 Types

```ts
import type { EnemyType } from '../types';
import type { IconId } from './icons';
import { CONTRACT_ENEMY_LABELS } from './contracts';
import { ENEMY_DEFS } from './enemies';

/**
 * The Long Watch — the game's campaign spine (`plans/milestones.md`).
 *
 * Twelve ordered chapters, one active at a time, each asking for three things
 * and paying one **content unlock**. The table below is the whole feature:
 * `WatchManager` only knows how to read counters and compare them to targets.
 *
 * Two closed unions do the load-bearing work, and both have a `Record` over
 * them elsewhere so a member cannot ship without an implementation:
 *   - `WatchGoal['kind']` → `WATCH_PROGRESS` in `WatchManager`
 *   - `WatchUnlockId`     → `WATCH_UNLOCK_CONSUMERS`, below
 */

/** What a chapter objective asks for. Every target is a *lifetime* figure. */
export type WatchGoal =
  | { kind: 'reach_wave'; wave: number }
  | { kind: 'kills'; count: number }
  | { kind: 'kills_of'; type: EnemyType; count: number }
  | { kind: 'bosses'; count: number }
  | { kind: 'gold_earned'; amount: number }
  | { kind: 'ascensions'; count: number }
  | { kind: 'transcendences'; count: number }
  | { kind: 'abilities_cast'; count: number }
  | { kind: 'upgrades_bought'; count: number }
  | { kind: 'tower_level'; level: number }
  | { kind: 'blessing_picks'; count: number }
  | { kind: 'contracts_done'; count: number }
  | { kind: 'flawless_waves'; count: number }
  /** Boss *encounters* cleared inside the swift threshold. */
  | { kind: 'swift_bosses'; count: number }
  /** Waves cleared with the risk dial at `risk` or above. */
  | { kind: 'risk_waves'; risk: number; count: number }
  | { kind: 'mutator_waves'; count: number };

export type WatchGoalKind = WatchGoal['kind'];

/** The twelve rewards. Ordered as the chapters grant them. */
export type WatchUnlockId =
  | 'board_expansion'
  | 'quartermaster'
  | 'veteran_start'
  | 'wide_draft'
  | 'cold_forge'
  | 'riskbearer'
  | 'overseer'
  | 'storm_caller'
  | 'heirloom'
  | 'deep_watch'
  | 'sanctum'
  | 'long_memory';

export interface WatchUnlockDef {
  id: WatchUnlockId;
  name: string;
  /** One player-facing sentence. Shown on the chapter card and the modal. */
  description: string;
  icon: IconId;
}

export interface WatchChapterDef {
  id: string;
  /** 1-based, and equal to the index in `WATCH_CHAPTERS` plus one. Pinned by test. */
  number: number;
  name: string;
  /** One line of fiction. Never mechanical — the objectives carry the mechanics. */
  flavour: string;
  icon: IconId;
  /** Accent colour. A `src/data/*` table may hold literal hex (palette test is scoped out). */
  color: string;
  /** Exactly three. Pinned by test. */
  goals: readonly WatchGoal[];
  reward: WatchUnlockId;
}
```

### 2.2 The unlock table and its consumer map

```ts
export const WATCH_UNLOCKS: Record<WatchUnlockId, WatchUnlockDef> = {
  board_expansion: {
    id: 'board_expansion', name: 'The Board', icon: 'wanted-reward',
    description: 'A fourth contract runs alongside the other three.',
  },
  quartermaster: {
    id: 'quartermaster', name: 'Quartermaster', icon: 'knapsack',
    description: 'Every blessing draft comes with one extra free reroll.',
  },
  veteran_start: {
    id: 'veteran_start', name: 'Veteran Start', icon: 'walking-scout',
    description: 'Every run begins at wave 5, with the gold to match.',
  },
  wide_draft: {
    id: 'wide_draft', name: 'Wide Draft', icon: 'split-arrows',
    description: 'Blessing drafts offer four cards instead of three.',
  },
  cold_forge: {
    id: 'cold_forge', name: 'The Cold Forge', icon: 'frozen-orb',
    description: 'The Frostwork core is yours, at no AP cost.',
  },
  riskbearer: {
    id: 'riskbearer', name: 'Riskbearer', icon: 'rolling-dices',
    description: 'The risk dial gains a sixth step.',
  },
  overseer: {
    id: 'overseer', name: 'Overseer', icon: 'vintage-robot',
    description: 'Auto-buy is unlocked without spending a single AP.',
  },
  storm_caller: {
    id: 'storm_caller', name: 'Storm Caller', icon: 'lightning-branches',
    description: 'Mutators offer four choices and run one wave longer.',
  },
  heirloom: {
    id: 'heirloom', name: 'Heirloom', icon: 'glowing-artifact',
    description: 'Your best blessing survives the ascension that ends the run.',
  },
  deep_watch: {
    id: 'deep_watch', name: 'Deep Watch', icon: 'all-seeing-eye',
    description: 'The risk dial gains a seventh step.',
  },
  sanctum: {
    id: 'sanctum', name: 'Sanctum', icon: 'wizard-staff',
    description: 'The Arcane core is yours, at no AP cost.',
  },
  long_memory: {
    id: 'long_memory', name: 'Long Memory', icon: 'over-infinity',
    description: 'Ability levels survive an ascension.',
  },
};

/**
 * Where each unlock is actually read.
 *
 * Same guard as `ACHIEVEMENT_REWARD_CONSUMERS`: a `Record` over the union, held
 * by `tests/watch.test.ts` to a non-placeholder string of real length. An
 * unlock that grants nothing is the exact failure this project has hit before
 * (nine achievement reward types once shipped with no consumer at all).
 */
export const WATCH_UNLOCK_CONSUMERS: Record<WatchUnlockId, string> = {
  board_expansion: 'ContractManager.refill via the injected slots() dep — Game passes watch.contractSlots()',
  quartermaster: 'BlessingManager.openDraft via the injected freeRerolls() dep',
  veteran_start: 'Game.applySavedStateReset — fourth term of the startWave Math.max',
  wide_draft: 'BlessingManager.rollOffer via the injected offerSize() dep',
  cold_forge: 'Game.applyWatchUnlock — CoreManager.unlock("frostwork") on chapter completion and on load',
  riskbearer: 'PacingManager.setRisk / clampRisk via the injected maxRisk() dep',
  overseer: 'PrestigeManager.isAutomationUnlocked via the injected externalAutomation() dep',
  storm_caller: 'Game wave_modifier_offer handler — choice count and MUTATOR_DURATION_WAVES bonus',
  heirloom: 'Game.applySavedStateReset — BlessingManager.resetRun({ carryBest: true })',
  deep_watch: 'PacingManager.setRisk / clampRisk via the injected maxRisk() dep',
  sanctum: 'Game.applyWatchUnlock — CoreManager.unlock("arcane") on chapter completion and on load',
  long_memory: 'Game.applySavedStateReset — skips abilityMgr.resetLevels()',
};
```

### 2.3 The chapter table

```ts
export const WATCH_CHAPTERS: readonly WatchChapterDef[] = [
  {
    id: 'wc_first_watch', number: 1, name: 'The First Watch',
    flavour: 'Someone has to stand the first night.',
    icon: 'lantern-flame', color: '#e8a93b',
    goals: [
      { kind: 'reach_wave', wave: 15 },
      { kind: 'kills', count: 1_500 },
      { kind: 'flawless_waves', count: 5 },
    ],
    reward: 'board_expansion',
  },
  {
    id: 'wc_blood_and_iron', number: 2, name: 'Blood and Iron',
    flavour: 'The heavy ones come slowly. That is the only mercy in them.',
    icon: 'bloody-sword', color: '#d04848',
    goals: [
      { kind: 'reach_wave', wave: 25 },
      { kind: 'kills_of', type: 'tank', count: 400 },
      { kind: 'bosses', count: 10 },
    ],
    reward: 'quartermaster',
  },
  {
    id: 'wc_ascendant_step', number: 3, name: 'The Ascendant Step',
    flavour: 'The tower falls so the tower may stand taller.',
    icon: 'upgrade', color: '#e8a93b',
    goals: [
      { kind: 'reach_wave', wave: 35 },
      { kind: 'ascensions', count: 3 },
      { kind: 'contracts_done', count: 25 },
    ],
    reward: 'veteran_start',
  },
  {
    id: 'wc_arsenal', number: 4, name: 'Arsenal',
    flavour: 'Every spell you have ever cast was rehearsal for the next one.',
    icon: 'magic-swirl', color: '#5b8def',
    goals: [
      { kind: 'reach_wave', wave: 45 },
      { kind: 'abilities_cast', count: 1_000 },
      { kind: 'blessing_picks', count: 40 },
    ],
    reward: 'wide_draft',
  },
  {
    id: 'wc_cold_forge', number: 5, name: 'The Cold Forge',
    flavour: 'Break the shield, and the thing behind it is only an enemy.',
    icon: 'snowflake-1', color: '#5dade2',
    goals: [
      { kind: 'reach_wave', wave: 60 },
      { kind: 'kills_of', type: 'shielded', count: 600 },
      { kind: 'swift_bosses', count: 10 },
    ],
    reward: 'cold_forge',
  },
  {
    id: 'wc_riskbearer', number: 6, name: 'Riskbearer',
    flavour: 'Turn the dial. The gold is on the other side of the fear.',
    icon: 'rolling-dices', color: '#c0392b',
    goals: [
      { kind: 'reach_wave', wave: 75 },
      { kind: 'risk_waves', risk: 3, count: 40 },
      { kind: 'gold_earned', amount: 50_000_000 },
    ],
    reward: 'riskbearer',
  },
  {
    id: 'wc_overseer', number: 7, name: 'Overseer',
    flavour: 'You have bought this upgrade two thousand times. Let it buy itself.',
    icon: 'gears', color: '#95a5a6',
    goals: [
      { kind: 'reach_wave', wave: 90 },
      { kind: 'ascensions', count: 10 },
      { kind: 'upgrades_bought', count: 2_500 },
    ],
    reward: 'overseer',
  },
  {
    id: 'wc_storm_caller', number: 8, name: 'Storm Caller',
    flavour: 'Weather that answers to a name is weather you can bargain with.',
    icon: 'lightning-trio', color: '#7f5af0',
    goals: [
      { kind: 'reach_wave', wave: 110 },
      { kind: 'mutator_waves', count: 60 },
      { kind: 'kills_of', type: 'warden', count: 300 },
    ],
    reward: 'storm_caller',
  },
  {
    id: 'wc_reliquary', number: 9, name: 'Reliquary',
    flavour: 'Nothing is meant to survive the reset. Something will anyway.',
    icon: 'locked-chest', color: '#9b59ff',
    goals: [
      { kind: 'reach_wave', wave: 130 },
      { kind: 'blessing_picks', count: 200 },
      { kind: 'contracts_done', count: 150 },
    ],
    reward: 'heirloom',
  },
  {
    id: 'wc_deep_watch', number: 10, name: 'Deep Watch',
    flavour: 'Past a certain depth the waves stop counting and start weighing.',
    icon: 'eclipse', color: '#2c5b8f',
    goals: [
      { kind: 'reach_wave', wave: 150 },
      { kind: 'risk_waves', risk: 5, count: 100 },
      { kind: 'kills', count: 2_000_000 },
    ],
    reward: 'deep_watch',
  },
  {
    id: 'wc_sanctum', number: 11, name: 'Sanctum',
    flavour: 'The crystal has been listening the whole time.',
    icon: 'floating-crystal', color: '#c77dff',
    goals: [
      { kind: 'reach_wave', wave: 175 },
      { kind: 'transcendences', count: 5 },
      { kind: 'tower_level', level: 100 },
    ],
    reward: 'sanctum',
  },
  {
    id: 'wc_long_watch', number: 12, name: 'The Long Watch',
    flavour: 'You are not holding a wall. You are keeping a promise.',
    icon: 'star-gate', color: '#e8a93b',
    goals: [
      { kind: 'reach_wave', wave: 200 },
      { kind: 'ascensions', count: 50 },
      { kind: 'bosses', count: 1_500 },
    ],
    reward: 'long_memory',
  },
];

export const WATCH_CHAPTER_BY_ID: Record<string, WatchChapterDef> =
  Object.fromEntries(WATCH_CHAPTERS.map(c => [c.id, c]));

/** Total chapters. The Journal's "3 / 12" readout reads this. */
export const WATCH_CHAPTER_COUNT = WATCH_CHAPTERS.length;
```

### 2.4 Display helpers

`describeGoal` mirrors `describeContract` in `src/data/contracts.ts`, and reuses that file's
`CONTRACT_ENEMY_LABELS` rather than writing a second plural table.

```ts
/** The objective line shown on the chapter card. */
export function describeGoal(goal: WatchGoal): string {
  switch (goal.kind) {
    case 'reach_wave': return `Reach wave ${goal.wave}`;
    case 'kills': return `Kill ${fmt(goal.count)} enemies`;
    case 'kills_of': return `Kill ${fmt(goal.count)} ${CONTRACT_ENEMY_LABELS[goal.type]}`;
    case 'bosses': return `Kill ${fmt(goal.count)} bosses`;
    case 'gold_earned': return `Earn ${fmt(goal.amount)} lifetime gold`;
    case 'ascensions': return `Ascend ${fmt(goal.count)} times`;
    case 'transcendences': return `Transcend ${fmt(goal.count)} times`;
    case 'abilities_cast': return `Cast ${fmt(goal.count)} abilities`;
    case 'upgrades_bought': return `Buy ${fmt(goal.count)} upgrades`;
    case 'tower_level': return `Reach tower level ${goal.level}`;
    case 'blessing_picks': return `Take ${fmt(goal.count)} blessings`;
    case 'contracts_done': return `Complete ${fmt(goal.count)} contracts`;
    case 'flawless_waves': return `Clear ${fmt(goal.count)} waves without losing HP`;
    case 'swift_bosses': return `Clear ${fmt(goal.count)} boss encounters swiftly`;
    case 'risk_waves': return `Clear ${fmt(goal.count)} waves at risk ${goal.risk}+`;
    case 'mutator_waves': return `Clear ${fmt(goal.count)} waves under a mutator`;
  }
}

/** The absolute figure a goal is measured against. */
export function goalTarget(goal: WatchGoal): number {
  switch (goal.kind) {
    case 'reach_wave': return goal.wave;
    case 'tower_level': return goal.level;
    case 'gold_earned': return goal.amount;
    case 'kills': case 'kills_of': case 'bosses': case 'ascensions':
    case 'transcendences': case 'abilities_cast': case 'upgrades_bought':
    case 'blessing_picks': case 'contracts_done': case 'flawless_waves':
    case 'swift_bosses': case 'risk_waves': case 'mutator_waves':
      return goal.count;
  }
}

/**
 * The earliest wave a goal's subject exists at all.
 *
 * The same correctness floor `goalAvailableFromWave` gives contracts, for the
 * same reason: an objective asking for wardens is dead until wave 40. Only the
 * enemy-typed kind can be wrong, so the rest return 1.
 */
export function goalAvailableFromWave(goal: WatchGoal): number {
  return goal.kind === 'kills_of' ? ENEMY_DEFS[goal.type].unlockWave : 1;
}

function fmt(n: number): string {
  return n.toLocaleString();
}
```

> `fmt` uses `toLocaleString` to match `describeContract`. Do **not** reach for
> `src/utils/bigNumber.ts` here — objective targets are exact figures the player is counting
> towards, and `2.0M / 2.0M` reading complete while the counter is at 1 999 500 is a bug report.

### 2.5 Acceptance for Part A

- `npm run typecheck` green.
- `node -e "import('./src/data/watch.ts')"` is not a thing in this repo — instead, Part A is
  accepted by the Part-8 tests. Land Part A and Part 8's `tests/watch.test.ts` data block
  together if you prefer; the data tests need nothing else.

---

## 3. Part B — state, counters and the save

### 3.1 `src/types.ts`

Add next to the other run-state blocks (after `PacingState`, around line 796):

```ts
/**
 * The Long Watch (plans/milestones.md).
 *
 * **Permanent.** Neither `applySavedStateReset` nor `applyFullTranscendenceReset`
 * may touch this block — it is meta-progression, like achievements and unlocked
 * cores. A reset that wiped it would delete the only long-horizon goal the game
 * has.
 *
 * Objective *progress* is deliberately not stored. It is derived from the
 * counters on every read, so there is nothing here that a save/load can
 * disagree with.
 */
export interface WatchState {
  /** Chapter ids completed, in completion order. */
  completed: string[];
  counters: WatchCounters;
}

/**
 * The seven lifetime counters no existing field covers.
 *
 * Everything else an objective reads already lives in `GameStats` or
 * `TowerXpState`; these are the ones that had no home. Each is incremented at
 * exactly one call site — see the table in §4.2.
 */
export interface WatchCounters {
  /** Lifetime kills per enemy type. */
  killsByType: Partial<Record<EnemyType, number>>;
  /** Waves cleared with the tower's HP untouched. */
  flawlessWaves: number;
  /** Boss encounters resolved inside the swift threshold. */
  swiftBosses: number;
  /** Contracts completed, lifetime (the contract block's own count is run-scoped). */
  contractsDone: number;
  /** Blessings taken, lifetime. */
  blessingPicks: number;
  /** Waves cleared while a mutator was active. */
  mutatorWaves: number;
  /**
   * Waves cleared, bucketed by the risk level in force when they were cleared.
   * Index is the risk step; length is `MAX_RISK_CEILING + 1` so raising the
   * dial later cannot land out of bounds.
   */
  riskWaves: number[];
}
```

Then add to `GameState` (after `pacing`):

```ts
  /** v19+: the Long Watch campaign (permanent — survives both resets). */
  watch: WatchState;
```

And add `'journal'` to the `PanelTab` union at `src/types.ts:73`:

```ts
export type PanelTab = 'upgrades' | 'research' | 'abilities' | 'passives' | 'prestige'
  | 'transcendence' | 'achievements' | 'journal' | 'progression' | 'codex' | 'stats'
  | 'settings' | 'talents' | 'equipment';
```

### 3.2 The risk ceiling constant

`src/data/pacing.ts` — `MAX_RISK` stays **5** (it is the default ceiling and the sim reads it).
Add the absolute ceiling and make `clampRisk` take an override:

```ts
/** Highest risk step without any Watch unlock. The dial is `0..MAX_RISK` inclusive. */
export const MAX_RISK = 5;

/**
 * The absolute ceiling the dial can ever reach, including Watch unlocks
 * (`riskbearer` → 6, `deep_watch` → 7). Array sizes and save-restore clamps
 * read this rather than `MAX_RISK`, so a later unlock cannot write out of
 * bounds into `WatchCounters.riskWaves`.
 */
export const MAX_RISK_CEILING = 7;

export function clampRisk(level: number, max: number = MAX_RISK): number {
  if (!Number.isFinite(level)) return 0;
  return Math.max(0, Math.min(Math.min(max, MAX_RISK_CEILING), Math.floor(level)));
}
```

Every existing caller of `clampRisk(x)` keeps working unchanged — the default argument is the
old constant. `riskHpMult` and friends stay exactly as they are.

### 3.3 `src/systems/SaveManager.ts`

1. `SAVE_VERSION` **18 → 19**.
2. Add a default factory next to `defaultContracts()` (~line 375):

```ts
function defaultWatch(): WatchState {
  return {
    completed: [],
    counters: {
      killsByType: {},
      flawlessWaves: 0,
      swiftBosses: 0,
      contractsDone: 0,
      blessingPicks: 0,
      mutatorWaves: 0,
      riskWaves: new Array(MAX_RISK_CEILING + 1).fill(0),
    },
  };
}
```

3. Add the migration next to `migrateV17toV18`:

```ts
/**
 * v19: the Long Watch.
 *
 * Purely additive. A pre-v19 save has no campaign state, so the block is
 * seeded empty and the first poll credits every chapter the player's existing
 * lifetime counters already satisfy — which is the intended behaviour, not a
 * migration shortcut (see plan §1.2). The counters that did not exist before
 * this version start at zero, so `flawless_waves`, `swift_bosses`,
 * `risk_waves`, `mutator_waves`, `contracts_done`, `blessing_picks` and every
 * per-type kill count begin accruing from the update forward. That is the one
 * place a returning player loses credit, and it is unavoidable: the data was
 * never written down.
 */
function migrateV18toV19(data: Record<string, unknown>): void {
  data.watch = defaultWatch();
}
```

4. Extend the `validate()` version whitelist with `data.version !== 18`.
5. Extend the ladder: `if (data.version === 18) { migrateV18toV19(data); data.version = 19; }`
6. Add to the "ensure fallback fields exist" block (~line 611):

```ts
  if (!isObject(d.watch)) d.watch = defaultWatch();
  else normalizeWatch(d.watch as Record<string, unknown>);
```

with a small normaliser next to it, because a hand-edited or partially-written save must not be
able to crash the poll:

```ts
/** Repair a `watch` block in place: missing counters, short risk array, bad numbers. */
function normalizeWatch(w: Record<string, unknown>): void {
  if (!Array.isArray(w.completed)) w.completed = [];
  if (!isObject(w.counters)) w.counters = defaultWatch().counters;
  const c = w.counters as Record<string, unknown>;
  if (!isObject(c.killsByType)) c.killsByType = {};
  for (const key of ['flawlessWaves', 'swiftBosses', 'contractsDone',
                     'blessingPicks', 'mutatorWaves'] as const) {
    if (typeof c[key] !== 'number' || !Number.isFinite(c[key])) c[key] = 0;
  }
  const risk = Array.isArray(c.riskWaves) ? (c.riskWaves as number[]) : [];
  const fixed = new Array(MAX_RISK_CEILING + 1).fill(0);
  for (let i = 0; i < fixed.length; i++) {
    const v = risk[i];
    fixed[i] = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  }
  c.riskWaves = fixed;
}
```

7. The snapshot path (the function that copies fields for persistence, ~line 650 where
   `version: SAVE_VERSION` is written) must copy `watch`. Copy it **deeply enough** that the
   live counters object is not shared with the written blob:

```ts
      watch: {
        completed: [...state.watch.completed],
        counters: {
          ...state.watch.counters,
          killsByType: { ...state.watch.counters.killsByType },
          riskWaves: [...state.watch.counters.riskWaves],
        },
      },
```

### 3.4 `makeInitialState()` in `src/game/Game.ts`

Add `watch: defaultWatchState()` to the returned object, where `defaultWatchState` is exported
from `SaveManager` (rename `defaultWatch` to an exported `defaultWatchState` if the other
defaults there are private — follow whatever the neighbouring `defaultContracts` does; if it is
private, duplicate the three-line literal in `Game.ts` the same way the file already handles the
other blocks).

### 3.5 Acceptance for Part B

- `npm run typecheck` green.
- `npm test` green — `tests/save.test.ts` will need the addition in §8.3.
- Load a v18 save from before the change: no console error, `state.watch` present, counters zero.

---

## 4. Part C — `WatchManager`

**New file: `src/systems/WatchManager.ts`.**

### 4.1 The class

```ts
import {
  WATCH_CHAPTERS,
  WATCH_CHAPTER_BY_ID,
  WATCH_UNLOCKS,
  goalTarget,
  type WatchChapterDef,
  type WatchGoal,
  type WatchGoalKind,
  type WatchUnlockId,
} from '../data/watch';
import type { EnemyType, WatchState } from '../types';

/** The `EventBus` slice this needs — structural, so a test can pass a stub. */
export interface WatchEmitter {
  emit: (event: string, payload?: unknown) => void;
}

/**
 * Everything an objective can be measured against, gathered once per poll.
 *
 * A flat snapshot rather than a bag of callbacks: sixteen goal kinds times one
 * poll a second is cheap either way, but a single object is what makes
 * `WATCH_PROGRESS` a pure `Record` of pure functions — which is what makes it
 * testable without a `Game`.
 */
export interface WatchMetrics {
  highestWave: number;
  kills: number;
  killsByType: Readonly<Partial<Record<EnemyType, number>>>;
  bosses: number;
  goldEarned: number;
  ascensions: number;
  transcendences: number;
  abilitiesCast: number;
  upgradesBought: number;
  towerLevel: number;
  blessingPicks: number;
  contractsDone: number;
  flawlessWaves: number;
  swiftBosses: number;
  /** Index = risk level in force when the wave was cleared. */
  riskWaves: readonly number[];
  mutatorWaves: number;
}

/**
 * How each objective kind reads the snapshot.
 *
 * **This `Record` is the point of the file.** It is a `Record` over
 * `WatchGoalKind`, so a kind added to the union without a reader does not
 * compile — the same guard `CONTRACT_PROGRESS` gives contracts. Each entry
 * returns the goal's current *absolute* progress, never a delta.
 */
const WATCH_PROGRESS: Record<WatchGoalKind, (g: WatchGoal, m: WatchMetrics) => number> = {
  reach_wave: (_g, m) => m.highestWave,
  kills: (_g, m) => m.kills,
  kills_of: (g, m) => (g.kind === 'kills_of' ? m.killsByType[g.type] ?? 0 : 0),
  bosses: (_g, m) => m.bosses,
  gold_earned: (_g, m) => m.goldEarned,
  ascensions: (_g, m) => m.ascensions,
  transcendences: (_g, m) => m.transcendences,
  abilities_cast: (_g, m) => m.abilitiesCast,
  upgrades_bought: (_g, m) => m.upgradesBought,
  tower_level: (_g, m) => m.towerLevel,
  blessing_picks: (_g, m) => m.blessingPicks,
  contracts_done: (_g, m) => m.contractsDone,
  flawless_waves: (_g, m) => m.flawlessWaves,
  swift_bosses: (_g, m) => m.swiftBosses,
  // Everything at or above the asked step counts, so raising the dial past the
  // objective's threshold never stops crediting it.
  risk_waves: (g, m) => {
    if (g.kind !== 'risk_waves') return 0;
    let total = 0;
    for (let i = g.risk; i < m.riskWaves.length; i++) total += m.riskWaves[i] ?? 0;
    return total;
  },
  mutator_waves: (_g, m) => m.mutatorWaves,
};

export interface WatchManagerDeps {
  bus?: WatchEmitter;
  state: () => WatchState;
  metrics: () => WatchMetrics;
}

/** How often the poll runs, in simulation seconds. */
const WATCH_POLL_SECONDS = 1;

/**
 * The Long Watch (plans/milestones.md).
 *
 * Two invariants this class exists to hold:
 *   1. **One chapter at a time, in order.** Chapter N+1 is not evaluated until
 *      N is complete, so the Journal always has exactly one live card.
 *   2. **At most one completion per `check()`.** A player who installs the
 *      update deep into a save has earned several chapters at once; they land
 *      one per second so each gets its own toast and modal (plan §1.6).
 */
export class WatchManager {
  private readonly deps: WatchManagerDeps;
  private timer = 0;
  /** Rebuilt from `state().completed` on every mutation. */
  private unlocks = new Set<WatchUnlockId>();

  constructor(deps: WatchManagerDeps) {
    this.deps = deps;
    this.rebuildUnlocks();
  }

  // ── queries ──

  /** The live chapter, or null once all twelve are done. */
  get activeChapter(): WatchChapterDef | null {
    const done = new Set(this.deps.state().completed);
    for (const c of WATCH_CHAPTERS) if (!done.has(c.id)) return c;
    return null;
  }

  get completedCount(): number {
    return this.deps.state().completed.length;
  }

  isChapterComplete(id: string): boolean {
    return this.deps.state().completed.includes(id);
  }

  /** Whether an unlock has been earned. The one query every consumer calls. */
  has(id: WatchUnlockId): boolean {
    return this.unlocks.has(id);
  }

  /** Absolute progress on one goal, clamped to its target. */
  progress(goal: WatchGoal, metrics = this.deps.metrics()): number {
    return Math.min(goalTarget(goal), Math.max(0, WATCH_PROGRESS[goal.kind](goal, metrics)));
  }

  /** 0..1 fill for the objective bar. */
  fill(goal: WatchGoal, metrics = this.deps.metrics()): number {
    const target = Math.max(1, goalTarget(goal));
    return Math.min(1, Math.max(0, this.progress(goal, metrics) / target));
  }

  isGoalMet(goal: WatchGoal, metrics = this.deps.metrics()): boolean {
    return WATCH_PROGRESS[goal.kind](goal, metrics) >= goalTarget(goal);
  }

  /** Objectives met on the live chapter, for the corner chip's `2 / 3`. */
  activeProgress(): { met: number; total: number } {
    const chapter = this.activeChapter;
    if (!chapter) return { met: 0, total: 0 };
    const metrics = this.deps.metrics();
    let met = 0;
    for (const g of chapter.goals) if (this.isGoalMet(g, metrics)) met++;
    return { met, total: chapter.goals.length };
  }

  // ── the poll ──

  tick(dt: number): void {
    this.timer += dt;
    if (this.timer < WATCH_POLL_SECONDS) return;
    this.timer = 0;
    this.check();
  }

  /**
   * Complete the active chapter if every objective is met. At most one per
   * call — the cascade rule (plan §1.6).
   *
   * Returns the chapter that completed, or null. `Game` reacts to the returned
   * value *and* to the emitted event: the event drives the UI, the return value
   * drives the unlocks that have to be applied synchronously.
   */
  check(): WatchChapterDef | null {
    const chapter = this.activeChapter;
    if (!chapter) return null;
    const metrics = this.deps.metrics();
    for (const g of chapter.goals) if (!this.isGoalMet(g, metrics)) return null;

    this.deps.state().completed.push(chapter.id);
    this.rebuildUnlocks();
    const unlock = WATCH_UNLOCKS[chapter.reward];
    this.deps.bus?.emit('watch_chapter_completed', {
      id: chapter.id,
      number: chapter.number,
      name: chapter.name,
      unlockId: unlock.id,
      unlockName: unlock.name,
      unlockDescription: unlock.description,
      icon: chapter.icon,
      color: chapter.color,
      next: this.activeChapter?.name ?? null,
    });
    return chapter;
  }

  // ── lifecycle ──

  /**
   * Rebuild the unlock set from the completed list.
   *
   * The set is **derived, never stored** — one chapter grants exactly one
   * unlock, so a second stored list could only ever disagree with the first.
   * Call after any mutation of `completed`, including a save restore.
   */
  rebuildUnlocks(): void {
    this.unlocks.clear();
    for (const id of this.deps.state().completed) {
      const def = WATCH_CHAPTER_BY_ID[id];
      if (def) this.unlocks.add(def.reward);
    }
  }

  /** Every unlock earned so far, for `Game.applyWatchUnlock` on load. */
  earnedUnlocks(): WatchUnlockId[] {
    return [...this.unlocks];
  }
}
```

### 4.2 Where the seven new counters are incremented

Each one is a single line at a single site, and each site already handles the same fact for
another system — which is why none of them needs a new event.

| Counter | Site | Line to add |
|---|---|---|
| `killsByType[type]` | `Game`'s `enemy_killed` handler, next to `this.contractMgr.note({ kind: 'enemy_killed', … })` | `this.noteWatchKill(e.type as EnemyType);` |
| `flawlessWaves` | `Game`'s `wave_cleared` handler, next to `this.contractMgr.note({ kind: 'wave_cleared', … })` | inside `noteWatchWave(cleared)` below |
| `mutatorWaves` | same | same |
| `riskWaves[risk]` | same | same |
| `swiftBosses` | `Game.resolveBossEncounter`, inside the existing `if (swift) {` branch | `this.state.watch.counters.swiftBosses += 1;` |
| `contractsDone` | `Game`'s `contract_completed` handler, in the payout block | `this.state.watch.counters.contractsDone += 1;` |
| `blessingPicks` | `Game`'s blessing-choice path (where `blessingMgr.choose(id)` returns true) | `this.state.watch.counters.blessingPicks += 1;` |

Two small private helpers on `Game` keep the call sites to one line each:

```ts
  /** One lifetime per-type kill. Called from the `enemy_killed` handler. */
  private noteWatchKill(type: EnemyType): void {
    const byType = this.state.watch.counters.killsByType;
    byType[type] = (byType[type] ?? 0) + 1;
  }

  /**
   * The three wave-scoped Watch counters, from the one `wave_cleared` handler.
   *
   * Deliberately reads the same two facts the contract note reads — the
   * flawless flag and the mutator flag — at the same point in the handler, so
   * a wave can never be flawless for a contract and not for a chapter.
   */
  private noteWatchWave(): void {
    const c = this.state.watch.counters;
    if (this.waveFlawless) c.flawlessWaves += 1;
    if (this.state.wave.waveModifier.active !== null) c.mutatorWaves += 1;
    // Every wave is bucketed, risk 0 included, so `riskWaves` is a complete
    // histogram. `risk_waves` objectives simply never ask for index 0.
    const risk = clampRisk(this.pacingMgr.activeRisk, this.maxRisk());
    c.riskWaves[risk] = (c.riskWaves[risk] ?? 0) + 1;
  }
```

`activeRisk` is the risk the *live wave* is running (`PacingManager.activeRisk`, not
`riskLevel` — the dial can be moved mid-wave and the committed value is what the wave was
actually fought at).

### 4.3 Building `WatchMetrics`

One method on `Game`, called by the manager's dep:

```ts
  private watchMetrics(): WatchMetrics {
    const s = this.state.stats;
    const c = this.state.watch.counters;
    return {
      highestWave: s.lifetimeHighestWave,
      kills: s.enemiesKilled,
      killsByType: c.killsByType,
      bosses: s.bossesKilled,
      goldEarned: s.goldEarned,
      ascensions: s.lifetimeAscensions,
      transcendences: s.transcendences,
      abilitiesCast: s.abilitiesCast,
      upgradesBought: s.totalUpgradesPurchased,
      towerLevel: this.state.towerXp.level,
      blessingPicks: c.blessingPicks,
      contractsDone: c.contractsDone,
      flawlessWaves: c.flawlessWaves,
      swiftBosses: c.swiftBosses,
      riskWaves: c.riskWaves,
      mutatorWaves: c.mutatorWaves,
    };
  }
```

No allocation concern: this runs once a second, not per frame.

### 4.4 Acceptance for Part C

- `npm run typecheck` green.
- A unit test (Part 8) drives the manager with a stub metrics object and asserts: one completion
  per `check()`, unlocks derived correctly, `activeChapter` advancing.

---

## 5. Part D — wiring the twelve unlocks

Every unlock below follows the same shape: **the owning system gains an injected callback with a
default that reproduces today's behaviour**, and `Game` passes one that asks the Watch. Nothing
reads `WatchManager` directly except `Game`.

That shape is not decoration. It is what keeps `sim/model.ts` byte-identical (§0.5 rule 2): the
simulator constructs these managers without the new dep, gets the default, and behaves exactly as
it does at `HEAD`.

### 5.0 Construction and tick

In the `Game` constructor, after `this.contractMgr = new ContractManager({…})`:

```ts
    this.watchMgr = new WatchManager({
      bus: this.bus,
      state: () => this.state.watch,
      metrics: () => this.watchMetrics(),
    });
```

In the same per-second block that already calls `this.achievementMgr.tick(dt)`
(`Game.ts:5005`), add exactly one line:

```ts
    this.watchMgr.tick(dt);
```

Do **not** react to `tick`'s side effects at the call site. Completion is handled through the bus
subscription below, so the poll has exactly one consumer path and the modal, the toast and the
unlock can never disagree about whether a chapter landed. Add near the other `bus.on`
registrations:

```ts
    this.bus.on('watch_chapter_completed', (payload) => {
      const p = payload as { name: string; unlockId: WatchUnlockId; unlockName: string;
                            unlockDescription: string };
      this.applyWatchUnlock(p.unlockId);
      this.syncUiApis();
      this.requestSave();
      this.bus.emit('toast', {
        kind: 'milestone',
        text: `Chapter complete: ${p.name} — ${p.unlockName} unlocked`,
        life: 8,
      });
      const ts = this.tower.snapshot;
      this.effects.emitShockwaveRing(ts.x, ts.y, 320, withAlpha(FX.gold, 0.75), 6);
    });
```

> `requestSave` / `syncUiApis`: use whatever the neighbouring handlers in this file call. If
> there is no `requestSave`, call `this.saveMgr.save(this.state)` — a chapter completion is rare
> enough that an immediate write is correct.

### 5.1 `applyWatchUnlock` — the two unlocks that need an action

Ten unlocks are *queried* by their consumer and need nothing on completion. Two grant a core, and
a grant has to be performed. It must also be **replayed on load**, because a save written before
the core-unlock line existed (or one where `CoreManager` state was reset by a bug) would
otherwise silently lose the core.

```ts
  /**
   * Perform the side effect of an unlock, if it has one.
   *
   * Idempotent by construction: `CoreManager.unlock` is a `Set.add`. Called
   * once on the completion event and once per earned unlock on save load, so
   * the granted cores can never drift from the completed chapters.
   */
  private applyWatchUnlock(id: WatchUnlockId): void {
    switch (id) {
      case 'cold_forge':
        this.coreMgr.unlock('frostwork');
        this.state.cores = this.coreMgr.snapshot();
        break;
      case 'sanctum':
        this.coreMgr.unlock('arcane');
        this.state.cores = this.coreMgr.snapshot();
        break;
      default:
        // Every other unlock is read by its consumer through `watchMgr.has()`;
        // there is nothing to perform. Listed exhaustively rather than
        // defaulted so a new unlock forces a decision here.
        break;
    }
  }

  /** Replay every earned unlock's side effect. Called at the end of save load. */
  private applyWatchUnlocksOnLoad(): void {
    this.watchMgr.rebuildUnlocks();
    for (const id of this.watchMgr.earnedUnlocks()) this.applyWatchUnlock(id);
  }
```

Call `applyWatchUnlocksOnLoad()` from the save-load path, immediately after `this.state` has been
replaced with the loaded state and the other managers have been restored (the same place
`coreMgr.restore(...)` is called).

### 5.2 `board_expansion` — a fourth contract slot

`src/systems/ContractManager.ts`:

```ts
export interface ContractManagerDeps {
  bus?: ContractEmitter;
  currentWave: () => number;
  waveGold: (wave: number) => number;
  rng?: () => number;
  /** How many slots to hold. Defaults to `CONTRACT_SLOTS` (plans/milestones.md §5.2). */
  slots?: () => number;
}
```

In the class:

```ts
  /** Slots the tracker holds right now. Never below `CONTRACT_SLOTS`. */
  get slotCount(): number {
    return Math.max(CONTRACT_SLOTS, Math.floor(this.deps.slots?.() ?? CONTRACT_SLOTS));
  }
```

Then in `refill()` replace the two uses of `CONTRACT_SLOTS`:

```ts
    let guard = this.slotCount * 4;
    while (this.active.length < this.slotCount && guard-- > 0) {
```

`Game` passes `slots: () => (this.watchMgr.has('board_expansion') ? CONTRACT_SLOTS + 1 : CONTRACT_SLOTS)`.

Because `refill()` is already called on completion, on reset and on restore, the fourth slot
appears the moment the chapter completes without any extra plumbing — but add a
`this.contractMgr.refill()` to the `watch_chapter_completed` handler anyway so it fills
immediately rather than on the next completion.

**Watch out:** `ContractTracker` renders one row per live contract and the corner-stack CSS
reserves `--contract-tracker-height: 96px`. Four rows overflow. Raise the token to `120px` and
verify the milestone strip still clears it (§6.5).

### 5.3 `quartermaster` and `wide_draft` — the blessing draft

`src/systems/BlessingManager.ts`. The manager is constructed as `new BlessingManager(this.bus)`;
add an optional second parameter rather than changing the signature's first:

```ts
export interface BlessingDraftOverrides {
  /** Cards per offer. Defaults to `BLESSING_OFFER_SIZE`. */
  offerSize?: () => number;
  /** Free rerolls seeded per draft. Defaults to `BLESSING_FREE_REROLLS`. */
  freeRerolls?: () => number;
}

constructor(bus?: EventBus, overrides: BlessingDraftOverrides = {}) { … }
```

In `rollOffer` (line ~164):

```ts
    const size = Math.max(1, Math.floor(this.overrides.offerSize?.() ?? BLESSING_OFFER_SIZE));
    while (out.length < size && pool.length > 0) {
```

In `openDraft` (line ~184):

```ts
    this.freeRerolls = Math.max(0, Math.floor(this.overrides.freeRerolls?.() ?? BLESSING_FREE_REROLLS));
```

`Game` passes:

```ts
    this.blessingMgr = new BlessingManager(this.bus, {
      offerSize: () => (this.watchMgr.has('wide_draft') ? BLESSING_OFFER_SIZE + 1 : BLESSING_OFFER_SIZE),
      freeRerolls: () => BLESSING_FREE_REROLLS + (this.watchMgr.has('quartermaster') ? 1 : 0),
    });
```

**Ordering hazard:** `blessingMgr` is constructed *before* `watchMgr` in the current constructor
order. That is fine — the arrow functions are not called until a draft opens — but do not be
tempted to read `this.watchMgr.has(...)` eagerly at construction time.

**UI:** `BlessingDraftModal` lays out the offer; confirm four cards fit. If it uses a fixed
three-column grid, change it to `repeat(auto-fit, minmax(…))` or to a count-driven class. Check
before assuming; a fourth card rendering off-screen is the whole reward wasted.

### 5.4 `veteran_start` — every run begins at wave 5

`Game.applySavedStateReset`, the existing `const startWave = Math.max(` block. Add a fourth term:

```ts
    const startWave = Math.max(
      this.researchTree.getStartWave(),
      this.prestigeMgr.getWaveStartBonus(),
      this.talentHeadStartWaves > 0 ? this.talentHeadStartWaves + 1 : 0,
      this.watchMgr.has('veteran_start') ? 5 : 0,
    );
```

Nothing else changes — the starting-gold branch below already keys off `startWave > 1`.

### 5.5 `riskbearer` / `deep_watch` — the risk dial

`src/systems/PacingManager.ts` gains one injected dep, defaulting to `MAX_RISK`:

```ts
  /** The dial's current ceiling. `Game` raises it with Watch unlocks. */
  private maxRisk: () => number = () => MAX_RISK;

  setMaxRiskProvider(fn: () => number): void {
    this.maxRisk = fn;
  }

  setRisk(level: number): number {
    this.risk = clampRisk(level, this.maxRisk());
    return this.risk;
  }
```

If `PacingManager` takes a deps object already, add `maxRisk?: () => number` to it instead — check
the constructor and follow the file's own style. Also apply the same ceiling wherever the manager
restores a saved risk level, so a save written at risk 7 does not survive an unlock being lost.

`Game` gains:

```ts
  /** The risk dial's ceiling, including Watch unlocks. Read by the UI too. */
  maxRisk(): number {
    if (this.watchMgr.has('deep_watch')) return 7;
    if (this.watchMgr.has('riskbearer')) return 6;
    return MAX_RISK;
  }
```

and calls `this.pacingMgr.setMaxRiskProvider(() => this.maxRisk())` right after constructing it.

**UI:** find the risk dial control (grep `setRisk` / `MAX_RISK` under `src/ui/`) and make its step
count read `game.maxRisk()` rather than the constant. A dial that still stops at 5 makes the
whole chapter reward invisible — this is the single most likely place to ship a dead unlock.

### 5.6 `overseer` — auto-buy without the perk

`src/systems/PrestigeManager.ts:284`:

```ts
  isAutomationUnlocked(key: AutomationKey): boolean {
    // Watch unlocks are a second, independent grant path (plans/milestones.md
    // §5.6). Checked first because it is a set lookup and the perk scan is not.
    if (this.ctx.externalAutomation?.(key)) return true;
    for (const p of AP_PERKS) { … }   // unchanged
    for (const p of TP_PERKS) { … }   // unchanged
    return false;
  }
```

Add `externalAutomation?: (key: AutomationKey) => boolean;` to the manager's context interface,
and pass from `Game`:

```ts
      externalAutomation: (key) => key === 'autoBuy' && this.watchMgr.has('overseer'),
```

**Also:** an unlocked automation is not an *enabled* one. On the `watch_chapter_completed`
handler, when the unlock is `overseer`, call
`this.prestigeMgr.setAutomationEnabled('autoBuy', true)` so the reward does something the moment
it lands. The player can turn it off in Settings like any other automation.

### 5.7 `storm_caller` — mutators

In `Game`'s `wave_modifier_offer` handler:

```ts
      const choices = pickRandomModifiers(this.watchMgr.has('storm_caller') ? 4 : 3);
```

and wherever `MUTATOR_DURATION_WAVES` seeds the run (`Game.ts:1604` and `:4032`), use a helper:

```ts
  /** Waves a mutator runs for, including the Storm Caller unlock. */
  private mutatorDuration(): number {
    return MUTATOR_DURATION_WAVES + (this.watchMgr.has('storm_caller') ? 1 : 0);
  }
```

Replace **every** read of `MUTATOR_DURATION_WAVES` inside `Game.ts` with `this.mutatorDuration()`
— including the loop at `:4015`. Leave the constant itself alone.

`WaveModifierModal` must render four choices; same check as §5.3.

### 5.8 `heirloom` — one blessing survives the run

`BlessingManager` gains an option on its run reset:

```ts
  /**
   * Wipe the run's blessings.
   *
   * `carryBest` (the Heirloom unlock, plans/milestones.md §5.8) keeps a single
   * stack of the highest-rarity blessing held, breaking ties by the most
   * recently taken. One stack, never the whole card's stacks — the reward is
   * "something survives", not "your build survives".
   */
  resetRun(opts: { carryBest?: boolean } = {}): void {
    const keep = opts.carryBest ? this.bestHeldId() : null;
    // …existing reset body…
    if (keep) {
      this.held[keep] = 1;
      this.picksTaken = 1;
      this.rebuildCaches();
    }
  }

  /** Highest-rarity held blessing, ties broken by pick order. */
  private bestHeldId(): string | null {
    const rank: Record<BlessingRarity, number> = { common: 0, rare: 1, epic: 2 };
    let best: string | null = null;
    let bestRank = -1;
    for (const id of Object.keys(this.held)) {
      const def = BLESSING_BY_ID[id];
      if (!def || (this.held[id] ?? 0) <= 0) continue;
      if (rank[def.rarity] > bestRank) { bestRank = rank[def.rarity]; best = id; }
    }
    return best;
  }
```

> Check the actual `BlessingRarity` union before writing `rank` — if there are four rarities,
> the map must cover all of them (it is a `Record`, so `tsc` will tell you).
> Also check what the existing run-reset method on `BlessingManager` is called and keep that name;
> `resetRun` above is the shape, not necessarily the identifier.

`Game.applySavedStateReset` calls it with the flag, and reports it:

```ts
    const heirloom = this.watchMgr.has('heirloom');
    this.blessingMgr.resetRun({ carryBest: heirloom });
    this.state.blessings = this.blessingMgr.snapshot();
```

If a card was carried, emit a toast naming it — an invisible carry-over is indistinguishable from
a bug.

### 5.9 `long_memory` — ability levels survive

`Game.applySavedStateReset`, at the existing `this.abilityMgr.resetLevels()` call
(`Game.ts:3870`):

```ts
    this.abilityMgr.reset();
    // Long Memory (plans/milestones.md §5.9): levels are the run's investment in
    // the ability bar, and the chapter-12 unlock is that the investment stops
    // being thrown away. Cooldowns and active timers still reset — that is
    // `reset()` above, which is not gated.
    if (!this.watchMgr.has('long_memory')) this.abilityMgr.resetLevels();
```

**Check `applyFullTranscendenceReset`.** A transcendence is meant to wipe more than an ascension.
Decision for this plan: **`long_memory` applies to ascension only**; transcendence still wipes
ability levels. Gate the call site above, not the transcendence path.

### 5.10 The consumer checklist

Before opening a PR, confirm each row is true by grep:

| Unlock | Grep to prove it is wired |
|---|---|
| `board_expansion` | `slotCount` in `ContractManager`, `slots:` in `Game` |
| `quartermaster` | `freeRerolls?.()` in `BlessingManager` |
| `veteran_start` | `'veteran_start'` inside the `startWave` max |
| `wide_draft` | `offerSize?.()` in `rollOffer` |
| `cold_forge` | `unlock('frostwork')` in `applyWatchUnlock` |
| `riskbearer` | `maxRisk()` in `Game`, used by `PacingManager` **and** the dial UI |
| `overseer` | `externalAutomation` in `PrestigeManager.isAutomationUnlocked` |
| `storm_caller` | `mutatorDuration()` replacing every `MUTATOR_DURATION_WAVES` read in `Game.ts` |
| `heirloom` | `carryBest` in `applySavedStateReset` |
| `deep_watch` | same as `riskbearer`, returning 7 |
| `sanctum` | `unlock('arcane')` in `applyWatchUnlock` |
| `long_memory` | the `if (!…has('long_memory'))` guard on `resetLevels()` |

### 5.11 Acceptance for Part D

- `npm run typecheck`, `npm test`, `npm run checks` green.
- **`npm run sim` byte-identical to `HEAD`.** If it is not, a default was changed — the most
  likely culprits are `CONTRACT_SLOTS`, `BLESSING_OFFER_SIZE`, `BLESSING_FREE_REROLLS`,
  `MAX_RISK` or `MUTATOR_DURATION_WAVES` having been edited rather than made overridable.
- In-browser: with a fresh save, everything behaves exactly as before.

---

## 6. Part E — the UI

Three surfaces: a panel (the home of the campaign), a corner chip (the always-visible pull), and
a completion modal (the payoff).

### 6.1 New tab

`src/ui/navGroups.ts`, the `progress` group — **first entry**, before Progression:

```ts
    tabs: [
      { id: 'journal', label: 'Journal' },
      { id: 'progression', label: 'Progression' },
      { id: 'codex', label: 'Codex' },
      { id: 'achievements', label: 'Achievements' },
      { id: 'stats', label: 'Stats' },
    ],
```

`PanelTab` already gained `'journal'` in §3.1. `UIManager.setActiveTab` gains one line in each of
its two switches:

```ts
      case 'journal': this.journalPanel.mount(body); break;
      …
      case 'journal': this.journalPanel.update(this.lastState); break;
```

Construct it beside `progressionPanel` (`UIManager.ts:594`):

```ts
    this.journalPanel = new JournalPanel({
      watch: () => this.watchInfo(),
      onOpenCodex: (entryId) => this.openCodex(entryId),
    });
```

Badge the tab while a chapter is completable but unviewed? **No.** The chapter completes on its
own within a second; there is nothing for the player to claim, so a badge would be noise. Skip
`setTabBadge` entirely for this tab.

### 6.2 The view model

`UIManager` must not import `WatchManager`. Follow the `ProgressionContractInfo` pattern
(`src/ui/ProgressionPanel.ts:24`) — `Game` pushes a plain data object through `syncUiApis`:

```ts
/** What the Journal needs to draw. Built by `Game`, consumed by `JournalPanel`. */
export interface WatchChapterView {
  id: string;
  number: number;
  name: string;
  flavour: string;
  icon: IconId;
  color: string;
  state: 'done' | 'active' | 'locked';
  goals: ReadonlyArray<{
    label: string;
    /** Already-formatted `1,240 / 1,500`. */
    progress: string;
    fill: number;
    met: boolean;
  }>;
  reward: { id: string; name: string; description: string; icon: IconId };
}

export interface WatchInfo {
  chapters: readonly WatchChapterView[];
  completed: number;
  total: number;
  /** Index into `chapters` of the live one, or -1 when all are done. */
  activeIndex: number;
}
```

`Game.watchInfo()` builds it by walking `WATCH_CHAPTERS` once, calling `watchMgr.progress` and
`watchMgr.fill` per goal with a single shared metrics snapshot. It is called from the ~10 Hz UI
update, so take the snapshot **once** at the top of the method, not per goal.

For locked chapters, still fill in `goals` — the numbers are real (the counters are lifetime) and
seeing "you are already 60% of the way into chapter 7" is exactly the pull this plan exists to
create. Only the *fill bar* colour differs (§6.3).

### 6.3 `src/ui/JournalPanel.ts`

Layout, top to bottom:

1. **Header** — `The Long Watch` + `3 / 12 chapters`.
2. **Active chapter card** — large. Number, name, flavour in italic, the three objective rows
   (label left, `1,240 / 1,500` right, a fill bar under each, a check glyph when met), then a
   reward strip with the unlock icon, name and description.
3. **Next up** — the following chapter rendered at half prominence with its reward visible.
4. **Completed** — a compact list, newest first: chapter number, name, unlock name, unlock icon.
5. **The road ahead** — the remaining chapters as one-line rows: number, name, `→ reward name`.

Rules:

- Every colour from `src/styles/tokens.css` custom properties or `palette.ts`. The per-chapter
  accent comes in through `WatchChapterView.color` (data, not a literal in the panel) and is
  applied with `setStyle(el, 'borderColor', view.color)` — the palette test scans `src/ui/*.ts`
  for literals, and a value that arrived as data is not a literal.
- Rebuild DOM only when the **signature** changes, exactly as `ProgressionPanel` does with
  `contractSignature`: build a string of `activeIndex + completed + met-flags` and early-out when
  it matches. Bars and numbers update in place every frame.
- `mount(parent)` / `unmount()` / `update(state)` — same contract as the other panels.
- Touch targets: any clickable row needs the 44 px floor (`tests/touch-targets.test.ts`). The
  simplest answer is to make nothing in this panel clickable except the objective rows that link
  into the Codex, and give those `min-height: 44px`.
- The panel scrolls; use the existing panel scroller classes so `tests/scrollbars.test.ts` stays
  happy — do **not** add a `scrollbar-width` declaration outside the `@supports` gate.

### 6.4 `src/ui/ChapterModal.ts`

Built on the shared `Modal` shell (`src/ui/Modal.ts`), like `EnemyCodexModal`:

- Title: `Chapter 3 complete`.
- Body: chapter name, flavour, then a large reward block — unlock icon, name, description.
- Footer: the next chapter's name and its reward, as a "what's next" line. If there is none:
  *"The Watch is kept."*
- One CTA: `Continue`.

**Queueing.** `UIManager` subscribes to `watch_chapter_completed`, pushes the payload onto an
array, and shows the next one when the current closes. `Modal.anyOpen()` already exists — do not
open over a blessing draft or a run summary; wait for those to close, then drain the queue.

### 6.5 `src/ui/JournalStrip.ts` — the corner chip

A single chip in the bottom-left stack, **above** the milestone strip:

```
⚑  Ch. 3 · The Ascendant Step        2 / 3
   ████████████░░░░░░░░
```

- Click opens the Journal tab (on mobile, the `progress` sheet on the `journal` tab), the same
  way `MilestoneStrip` opens Progression.
- Rebuild only when the chapter or the met-count changes; the fill bar is the mean of the three
  objective fills.
- Pulse for four seconds on `watch_chapter_completed`, reusing the `@keyframes milestone-pulse`
  flourish rather than writing a second one.
- Hidden entirely when every chapter is done.

CSS, in `src/styles/main.css`, modelled on `.milestone-strip-slot` (line 3394):

```css
.journal-strip-slot {
  position: fixed;
  left: 12px;
  bottom: calc(12px + var(--contract-tracker-height) + var(--milestone-strip-height));
  z-index: /* same layer as .milestone-strip-slot — copy it, do not invent one */;
}
```

This means adding `--milestone-strip-height` to `src/styles/tokens.css` next to
`--contract-tracker-height` (line 404), and it means the offset appears in **four** places, not
one — the base rule plus the three media blocks at `main.css:4232`, `:4245` and `:4322`. Update
all four or the chip will overlap the strip on mobile.

Also in `tokens.css`: raise `--contract-tracker-height` from `96px` to `120px` for the fourth
contract slot (§5.2).

**Mobile.** Three stacked chips in a phone's bottom-left corner is a column that eats the play
area — the exact complaint that killed the milestone flyout (see `docs/milestones.md`). So:
`.journal-strip-slot { display: none; }` inside the existing mobile media block. The Journal stays
one tap away in the Progress group, and the chapter-complete modal still fires. Say this in
`docs/ui-system.md` so it does not read as an oversight.

`HUD` gains `renderJournalStripSlot()`, a five-line copy of `renderMilestoneStripSlot`
(`HUD.ts:592`), and `UIManager` constructs `JournalStrip` against it in the same place it
constructs `MilestoneStrip`, refreshing it from the same ~10 Hz `update()`.

### 6.6 Acceptance for Part E

- `npm test` green, including `touch-targets`, `scrollbars`, `z-index` and `palette`.
- In the browser (`npm run dev`): the Journal tab renders; the chip shows the live chapter; a
  chapter completing pops exactly one modal; four contract rows do not collide with the chip; the
  bottom-left stack is clean at 375×812, 768×1024 and 1280×800.

---

## 7. Part F — bestiary mastery in the Codex

The `kills_of` objectives are the mastery track, and the natural place to read them is where the
player already reads about that enemy.

In `src/ui/EnemyCodexModal.ts` (and the enemy section of `CodexPanel` if it has one), add **one
line** to an enemy's detail pane when any chapter — completed, active or locked — has a
`kills_of` objective for that type:

```
The Long Watch · Blood and Iron    412 / 400  ✓
The Long Watch · Storm Caller       94 / 300
```

Sourced from a new field on the view model rather than by importing `WatchManager`:

```ts
/** Watch objectives that name this enemy type, for the codex detail pane. */
export interface EnemyWatchLine {
  chapterName: string;
  progress: string;
  fill: number;
  met: boolean;
}
```

`Game` fills a `Record<EnemyType, EnemyWatchLine[]>` inside `watchInfo()` (it is walking every
goal already) and `UIManager` passes it through the same call that pushes enemy stats
(`UIManager.pushEnemyStats`).

Three types are named by chapters today — `tank`, `shielded`, `warden`. Every other type shows
nothing, which is correct: an empty section is better than a section that says "no objectives".

**Acceptance:** open the codex on Tank with a partial count and see the line; open it on Fast and
see no Watch section at all.

---

## 8. Part G — tests

### 8.1 New file: `tests/watch.test.ts`

Model it on `tests/contracts.test.ts` — drive the **real** `WatchManager` against a stub metrics
object, never a re-implementation of the rules.

```ts
function metrics(over: Partial<WatchMetrics> = {}): WatchMetrics { … }  // zeros + overrides

function harness(state?: Partial<WatchState>) {
  const s: WatchState = { completed: [], counters: emptyCounters(), ...state };
  let m = metrics();
  const events: any[] = [];
  const mgr = new WatchManager({
    bus: { emit: (e, p) => events.push({ e, p }) },
    state: () => s,
    metrics: () => m,
  });
  return { s, mgr, events, set: (next: Partial<WatchMetrics>) => { m = metrics(next); } };
}
```

**The data block** (needs nothing but `src/data/watch.ts`):

1. Twelve chapters, `number` equal to index + 1, ids unique.
2. Every chapter has **exactly three** goals.
3. Every chapter has a non-empty `flavour` of at least 20 characters and no placeholder text
   (`/todo|tbd|lorem/i`).
4. Every `icon` is in `ICON_IDS`; every `color` matches `/^#[0-9a-f]{6}$/i`.
5. Each of the twelve `WatchUnlockId`s is the reward of **exactly one** chapter — no unlock
   granted twice, none unreachable.
6. `WATCH_UNLOCK_CONSUMERS` names a real consumer for every unlock: truthy, length > 20, and not
   matching `/todo|nothing|unused|n\/a|tbd/i`. (Copy the assertion from the boss-pattern block in
   `tests/content-coverage.test.ts`.)
7. `describeGoal` returns a non-empty string for every goal in the table, and for one synthetic
   goal of every kind in the union — so a kind added without a description fails here.
8. **Availability floor:** for every `kills_of` goal, `ENEMY_DEFS[type].unlockWave` is less than
   the chapter's `reach_wave` target. This is the `goalAvailableFromWave` guard contracts have,
   and it is what stops a chapter asking for burrowers at wave 25.
9. Depth gates ascend strictly across chapters.

**The manager block:**

10. A fresh manager's `activeChapter` is chapter 1 and `has()` is false for all twelve unlocks.
11. Meeting two of three objectives completes nothing; meeting the third completes exactly one
    chapter, emits one `watch_chapter_completed`, and flips `has('board_expansion')`.
12. **The cascade rule:** with metrics satisfying every chapter at once, one `check()` completes
    exactly one chapter; twelve calls complete all twelve; a thirteenth returns `null` and emits
    nothing.
13. `tick(dt)` completes nothing before one second of accumulated `dt` and completes at most one
    chapter after it.
14. `progress()` clamps to the target; `fill()` stays inside `0..1` including for absurd metrics.
15. `risk_waves` sums every bucket **at or above** the asked step: `riskWaves = [9,9,9,9,0,7,0,0]`
    with `{risk: 3, count: 10}` reads 16, not 9.
16. `rebuildUnlocks()` after a restore with a completed list produces exactly those chapters'
    rewards, and an unknown id in `completed` is ignored rather than throwing.

### 8.2 `tests/content-coverage.test.ts`

Add a `describe('the long watch')` block with items 5, 6 and 8 above (the coverage-shaped ones),
since that file is where "content that grants nothing" is caught project-wide. Also extend the
existing nav coverage: `'journal'` must appear in exactly one `NAV_GROUPS` entry and be a member
of `PanelTab`.

### 8.3 `tests/save.test.ts`

- A v18 blob loads, ends at version 19, and has a well-formed `watch` block with a
  `riskWaves` array of length `MAX_RISK_CEILING + 1`.
- A v19 blob with a **malformed** `watch` (missing `counters`, a 3-element `riskWaves`, a string
  where a number belongs) is repaired by `normalizeWatch` rather than rejected.
- A round trip preserves `completed` and every counter.
- The snapshot does not alias: mutating `state.watch.counters.killsByType` after a save does not
  change what was written.

### 8.4 What must stay green untouched

`npm run sim` byte-identical (§0.5 rule 2), plus the whole existing suite. `tests/pacing.test.ts`
exercises `clampRisk` — the default-argument change in §3.2 keeps it passing; if it does not, the
signature was changed rather than defaulted.

---

## 9. Part H — docs

| File | Change |
|---|---|
| `docs/watch-system.md` **(new)** | The full write-up: the twelve chapters, the objective-kind → metric table, the unlock → consumer table, the cascade rule, the poll cadence, persistence, and why progress is derived rather than stored. Follow the shape of `docs/contract-system.md`. |
| `AGENTS.md` | Add the row to the docs index; add `Watch chapters \| 12 \| src/data/watch.ts` and `Watch unlocks \| 12 \| src/data/watch.ts` to "Content at a glance"; **fix the save version row to 19** (it currently says 16 and is two versions stale). |
| `docs/event-bus.md` | Add `watch_chapter_completed` — payload, emitter (`WatchManager`), consumers (`Game` for the unlock + toast, `UIManager` for the modal and the chip pulse). |
| `docs/save-system.md` | v19 in the migration ladder; describe `WatchState` and the "permanent, survives both resets" rule. |
| `docs/ui-system.md` | The Journal tab, the corner chip and its stacking order, and the deliberate mobile hide (§6.5). |
| `docs/milestones.md` | A pointer at the top: the strip previews *unlocks by wave*; the Watch is the *campaign*. They are different things and both live in the Progress group. |
| `docs/prestige-system.md` | Note that `veteran_start`, `overseer`, `cold_forge` and `sanctum` are second, non-AP grant paths for things the AP tree also sells. |
| `docs/contract-system.md` | Note the fourth slot and where the slot count now comes from. |
| `docs/blessing-system.md` | Note the injectable offer size / free rerolls and the Heirloom carry-over. |

---

## 10. Order of work

Each step lands green on its own. Do not start the next until `npm run typecheck`, `npm test`,
`npm run checks` pass and `npm run sim` is byte-identical.

| Step | Part | Deliverable |
|---:|---|---|
| 1 | A | `src/data/watch.ts` — types, unlocks, consumers, twelve chapters, helpers |
| 2 | G (partial) | The data block of `tests/watch.test.ts` (items 1–9). **Do this second, not last** — it is what proves the table before anything depends on it |
| 3 | B | `types.ts`, `pacing.ts` ceiling, save v19 + migration + normaliser + snapshot |
| 4 | C | `WatchManager`, the seven counters and their call sites, `watchMetrics()` |
| 5 | G | The manager block of `tests/watch.test.ts` (items 10–16) and the save tests |
| 6 | D | The twelve consumers, one at a time, checking §5.10's grep after each |
| 7 | E | `JournalPanel`, the tab, the view model |
| 8 | E | `JournalStrip`, `ChapterModal`, the CSS stack, the token changes |
| 9 | F | The codex mastery line |
| 10 | H | Docs |

**A shippable subset**, if the whole thing is too much for one pass: steps 1–7 give a complete,
working campaign with a real panel. The chip, the modal and the codex line are polish on top of a
system that already functions — but do not skip step 6, because a chapter that completes and
grants nothing is worse than no chapter at all.

### 10.1 Manual verification script

With `npm run dev` and a save you are willing to edit (`localStorage['the-tower-save']`):

1. Fresh save → Journal shows chapter 1 active, chapters 2–12 locked with rewards visible.
2. Set `stats.lifetimeHighestWave = 15`, `stats.enemiesKilled = 1500`,
   `watch.counters.flawlessWaves = 5`, reload → within a second: toast, modal, chapter 1 done,
   a **fourth contract row** appears.
3. Complete chapter 4 the same way → the next blessing draft offers **four** cards and two free
   rerolls (`quartermaster` + `wide_draft`).
4. Complete chapter 6 → the risk dial has a **sixth step** in the UI, and setting it sticks.
5. Complete chapter 12 → ascend, and the ability bar keeps its levels.
6. Complete every chapter at once → twelve modals, one after another, one per second, no
   overlap with a blessing draft.

---

## 11. Deliberately not built (and what it would take)

Recorded so the next person does not have to re-derive why these are absent.

- **A standalone bestiary-mastery system** (per-type kill tiers with their own permanent bonuses).
  Folded into `kills_of` (§1.3, §7). Building it standalone means thirteen tracks × N tiers of
  reward, which is a second reward economy — and its rewards would have to be *stat bonuses*,
  which §0.5 rule 3 rules out for this plan. If it is ever wanted, it belongs on the Codex tab
  with the Watch line as its neighbour, not as a third goal panel.
- **Standalone first-clear depth rewards.** Folded into every chapter's first objective (§0.3).
  A separate ladder would compete with the chapter chain for the same "push deeper" motivation
  and split the reward budget between them.
- **Contract rework.** Explicitly out of scope. Contracts are texture with a measured 3–9% income
  share and zero wall drift, and they are *good at that*. The Watch takes over the job contracts
  were never sized for. The one thing this plan changes about them is a fourth slot.
- **A second concurrent chapter, or branching chapters.** The pull comes from there being exactly
  one answer to "what am I working towards". Two live chapters halve it.
- **Chapter 13+.** Twelve chapters reach wave 200 and 50 ascensions, which is deep endgame at the
  measured curve. Extending the chain is a data edit in `WATCH_CHAPTERS` plus one new
  `WatchUnlockId` with a consumer — the table shape exists so that stays a data change.
