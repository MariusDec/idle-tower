# The Long Watch — chapter campaign

**Files:** `src/data/watch.ts`, `src/systems/WatchManager.ts`,
`src/ui/JournalPanel.ts`, `src/ui/JournalStrip.ts`, `src/ui/ChapterModal.ts`

The gap this closes is the one the contract and achievement docs already name
in passing: a difficulty curve without a campaign. Contracts are texture, the
milestone strip is informational, achievements fire twice an hour. The Long
Watch is the named thing the player is always working towards.

## The model

| | |
|---|---|
| Chapters | **12**, strictly ordered, exactly one active at a time |
| Scope | **Permanent.** Survives both ascension and transcendence. |
| Objectives per chapter | **3**, all required |
| Reward per chapter | **1 content unlock** (never a stat percentage) |
| Progress | **Derived from lifetime counters** — not stored |
| Poll cadence | `WATCH_POLL_SECONDS = 1` (`WatchManager.tick`) |
| Persistence | `PersistentState.watch` (`WatchState`), save **v19** |

The mix of objectives is deliberate. Of the **36** objectives across the twelve
chapters, **28 advance on their own** (lifetime counters a tower earns by
playing) and **8 ask for intent** — flawless waves, swift bosses, waves
cleared at high risk, mutator waves. No chapter is made entirely of the
second sort: every chapter's first goal is a `reach_wave`, which advances for
everyone.

## The chapter table

Depth gates sit at or just past the measured idle walls, so chapter *N*'s
wave gate is a push for a player with the previous chapter's tools, not a
wall. `tests/watch.test.ts` item 9 asserts that `reach_wave` targets ascend
strictly across chapters.

| # | Chapter | Objectives | Reward |
|---:|---|---|---|
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

Sanity checks that were run against the tree before the numbers were written:

- Every `kills_of` type is unlocked far below its chapter's wave gate (tank 5
  ≪ 25, shielded 20 ≪ 60, warden 40 ≪ 110), so no objective can ask for an
  enemy that does not spawn yet. `tests/watch.test.ts` item 8 pins this
  against `ENEMY_DEFS[type].unlockWave` via `goalAvailableFromWave`.
- Chapter 6's `risk_waves` asks for risk **3+**, not 5, because risk 5 before
  `riskbearer` is the ceiling and asking for the ceiling would make the
  chapter a wall. Chapter 10 asks for 5+ *after* the dial has been raised
  twice, so it is no longer the ceiling either.
- Chapter 11's tower level 100 is half the level cap (`TOWER_LEVEL_CAP = 200`).

## Objective kinds

Sixteen kinds, a closed union, with `WATCH_PROGRESS` in `WatchManager` as a
`Record` over `WatchGoalKind`. The `Record` is the load-bearing compile-time
guard: a kind added to the union without a reader fails `tsc`. Each entry
returns the goal's current *absolute* progress against a `WatchMetrics`
snapshot, never a delta.

| Kind | Reads | Idle-safe |
|---|---|---|
| `reach_wave` | `stats.lifetimeHighestWave` | yes |
| `kills` | `stats.enemiesKilled` | yes |
| `kills_of` | `watch.counters.killsByType[type]` | yes |
| `bosses` | `stats.bossesKilled` | yes |
| `gold_earned` | `stats.goldEarned` | yes |
| `ascensions` | `stats.lifetimeAscensions` | yes |
| `transcendences` | `stats.transcendences` | yes |
| `abilities_cast` | `stats.abilitiesCast` | yes |
| `upgrades_bought` | `stats.totalUpgradesPurchased` | yes |
| `tower_level` | `towerXp.level` | yes |
| `blessing_picks` | `watch.counters.blessingPicks` | yes |
| `contracts_done` | `watch.counters.contractsDone` | yes |
| `flawless_waves` | `watch.counters.flawlessWaves` | mostly — a strong tower clears waves untouched while idle |
| `swift_bosses` | `watch.counters.swiftBosses` | mostly — same |
| `risk_waves` | `watch.counters.riskWaves[]` | **no** — the dial is a deliberate setting |
| `mutator_waves` | `watch.counters.mutatorWaves` | **no** — a mutator must be accepted |

### `risk_waves` sums every bucket at or above the asked step

`riskWaves` is a per-step histogram: `index = risk level in force when the
wave was cleared`. `WATCH_PROGRESS.risk_waves` sums every bucket from the
asked step up, so raising the dial past the objective's threshold never
*stops* crediting it. A chapter that asks for "40 waves at risk 3+" is met
by 40 waves at risk 3 *or* 4 *or* 5, and once `riskbearer` raises the dial
to 6 those 40 still count. `tests/watch.test.ts` item 15 pins the read
against `[9, 9, 9, 9, 0, 7, 0, 0]` with `risk: 3` → `16` (9 + 0 + 7), not 9.

### `kills_of` reads a per-type lifetime map

`watch.counters.killsByType` is a `Partial<Record<EnemyType, number>>`,
incremented at exactly one call site (`Game`'s `enemy_killed` handler, next
to where `stats.enemiesKilled` already goes). A `kills_of` objective names
the type: `{ kind: 'kills_of', type: 'warden', count: 300 }`. Missing keys
read as zero, so a chapter can name an enemy that has not yet been
encountered without throwing.

## The unlock catalogue

Twelve unlocks, a closed union `WatchUnlockId`, each with an entry in
`WATCH_UNLOCK_CONSUMERS: Record<WatchUnlockId, string>` naming the exact
site that reads it. That map is what `tests/watch.test.ts` item 6 holds to
a real consumer (no placeholders, no `n/a`), and it is why an unlock
cannot ship as flavour text.

| Id | Name | What it does | Consumer |
|---|---|---|---|
| `board_expansion` | The Board | Contracts run **4 slots** instead of 3 | `ContractManager.refill via the injected slots() dep — Game passes watch.contractSlots()` |
| `quartermaster` | Quartermaster | **+1 free reroll** on every blessing draft | `BlessingManager.openDraft via the injected freeRerolls() dep` |
| `veteran_start` | Veteran Start | Every run **begins at wave 5** | `Game.applySavedStateReset — fourth term of the startWave Math.max` |
| `wide_draft` | Wide Draft | Blessing drafts offer **4 cards** | `BlessingManager.rollOffer via the injected offerSize() dep` |
| `cold_forge` | The Cold Forge | The **Frostwork core**, free (normally 10 AP) | `Game.applyWatchUnlock — CoreManager.unlock("frostwork") on chapter completion and on load` |
| `riskbearer` | Riskbearer | Risk dial goes to **6** | `PacingManager.setRisk / clampRisk via the injected maxRisk() dep` |
| `overseer` | Overseer | **Auto-buy** automation, without the 25 AP perk | `PrestigeManager.isAutomationUnlocked via the injected externalAutomation() dep` |
| `storm_caller` | Storm Caller | Mutator offers **4 choices** and runs **one wave longer** | `Game wave_modifier_offer handler — choice count and MUTATOR_DURATION_WAVES bonus` |
| `heirloom` | Heirloom | Your **best blessing carries into the next run** | `Game.applySavedStateReset — BlessingManager.resetRun({ carryBest: true })` |
| `deep_watch` | Deep Watch | Risk dial goes to **7** | `PacingManager.setRisk / clampRisk via the injected maxRisk() dep` |
| `sanctum` | Sanctum | The **Arcane core**, free (normally 25 AP) | `Game.applyWatchUnlock — CoreManager.unlock("arcane") on chapter completion and on load` |
| `long_memory` | Long Memory | **Ability levels survive an ascension** | `Game.applySavedStateReset — skips abilityMgr.resetLevels()` |

Why these twelve and not stat bonuses: every one of them changes a *rule*.
After `wide_draft` the draft is a different decision; after `riskbearer` the
dial has a step that did not exist; after `long_memory` the ascension means
something different than it did an hour ago. A `+8% damage` reward would be
invisible inside a curve that already multiplies by lifetime AP. Two
overlap things the player can also buy with AP (`veteran_start`,
`overseer`); that is deliberate and harmless — `startWave` is already a
`Math.max` over four sources and `isAutomationUnlocked` is a boolean OR.
Neither double-counts. See [prestige-system.md](prestige-system.md).

## The cascade rule

`WatchManager.check()` completes **at most one chapter per call**, and
`tick` accumulates `dt` until it reaches `WATCH_POLL_SECONDS = 1` then
calls `check()` once and resets. A player who installs this update deep
into a save therefore watches chapters land one per second, each with its
own toast and modal — not twelve at once. The UI queues modals and shows
the next one when the previous is dismissed; the `Modal.anyOpen()` registry
is what makes the queue correct, so a chapter-completion modal cannot
stack over a blessing draft or a run summary. See
[ui-system.md](ui-system.md).

This is not a fairness limiter — it grants everything earned. It is a
legibility limiter. The plan's `npm run sim` baseline is held byte-identical
because the simulator never has a completed chapter; the four unlocks that
touch the curve (`veteran_start`, `riskbearer`, `overseer`, `deep_watch`)
land at depths where the curve has flattened, and a sim run still gates on
the pre-unlock ceiling.

## Why progress is derived, not stored

Objective progress is **never persisted**. Every read calls
`WATCH_PROGRESS[goal.kind](goal, metrics)` against a `WatchMetrics`
snapshot taken at the moment of the read; `progress()` then clamps to the
target, and `fill()` divides by it. There is no field in `WatchState` that
tracks "how far through this goal the player is".

Three reasons:

1. **Offline progress works for free.** Anything the offline walk credits
   into `stats` is picked up on the next poll, with no replay of events
   that were never emitted.
2. **A save load cannot lose progress**, because there is no progress state
   to lose. The only thing the save stores is which chapters are done
   (`completed: string[]`) and the seven lifetime counters that needed a
   home.
3. **Retroactive credit is automatic and intentional.** A player who
   installs this update at wave 140 completes several chapters in a row.
   That is correct: they earned it. The cascade rule paces the modals so
   it reads as a reward burst rather than a stack.

The cost is the seven new lifetime counters — fields no prior system kept
— and the one place a returning player loses credit: the counters that
were never written down start at zero from the update forward. That is
unavoidable, and `migrateV18toV19` calls it out in `SaveManager.ts`.

## The Watch never touches a stat

No `StatKey`, no contributor, no multiplier — every reward is an unlock
with a named consumer, and every consumer is a *rule* (slot count, draft
size, dial ceiling, blessing carry) rather than a number added to a
multiplier. The `sim/model.ts` baseline is byte-identical for that
reason; if a future change ever adds a stat bonus to the Watch, the sim
is the regression check that catches it.

## Persistence

`GameState.watch` (`WatchState`), save **v19**. The block carries
`completed: string[]` (chapter ids in completion order) and `counters:
WatchCounters` (the seven lifetime counters that had no prior home). The
`riskWaves` array is sized to `MAX_RISK_CEILING + 1` (7 indices today,
indexed 0–6) so a future Watch unlock that raises the dial cannot land
out of bounds. `migrateV18toV19` seeds an empty block via
`defaultWatch()`. **Permanent** — neither `applySavedStateReset` nor
`applyFullTranscendenceReset` may touch it; it is meta-progression, like
achievements and unlocked cores. See
[save-system.md](save-system.md#watchstate-v19) for the type definitions,
the migration note and the `normalizeWatch` repair rules.

## UI

Three surfaces, all owned by `src/ui/` and described in detail under
[ui-system.md](ui-system.md):

- **Journal tab** (`JournalPanel.ts`) — the campaign's home, in the
  `progress` group of `NAV_GROUPS` as its first entry, label "Journal".
  Five sections: header (`X / 12 chapters`), the active chapter card,
  the next-up card, the completed list, and the road ahead. View model is
  `Game.watchInfo()` → `UIManager` → `JournalPanel`.
- **Corner chip** (`JournalStrip.ts`) — the bottom-left "Long Watch"
  pill, one row above the milestone strip, sharing the `--z-corner`
  layer. Shows chapter number/name and the mean of the chapter's three
  objective fills. Click opens the Journal tab.
- **Chapter modal** (`ChapterModal.ts`) — the "Chapter N complete" card,
  built on the shared `Modal` shell. Names the chapter, the reward, and
  what comes next (or *"The Watch is kept."* if this was the last one).
  `UIManager` owns the queueing and the `Modal.anyOpen()` registry is
  what defers the next modal until the previous one is dismissed.

### Deliberate mobile hide

The corner chip is `display: none` on the `@media (max-width: 768px)`
block. Phones already carry three corner chips (toast root, contract
tracker, milestone strip), and a fourth would crowd the play area. The
precedent is the milestone strip's hover-flyout retirement (see
[milestones.md](milestones.md)): three stacked chips in a phone's
bottom-left corner eat the play area. The Journal tab is one tap away in
the `progress` group on the bottom nav, and the chapter-complete modal
still fires on mobile — the player learns the chapter is done, they just
have to want to see the next one badly enough to open the sheet.

## Acceptance gates

`tests/watch.test.ts` covers the campaign in two blocks. The **data
block** (items 1–9) holds the table to its own contracts: chapter count,
numbering, unique ids, exactly three goals per chapter, non-empty flavour,
every icon in `ICON_IDS`, every colour a literal hex, every reward granted
exactly once, every unlock consumer a real string of meaningful length,
the `describeGoal` switch exhaustive, every `kills_of` goal's subject
unlocked before its chapter's depth gate, and the `reach_wave` targets
ascending strictly. The **manager block** (items 10–16) drives the real
`WatchManager` against a stub metrics object and a stub bus: fresh state
on chapter 1, two-of-three doesn't complete, all-three completes exactly
one, the cascade rule holds over twelve `check()` calls, `tick` waits
for one second of accumulated `dt`, `progress` clamps to target, `fill`
stays in `[0, 1]`, `risk_waves` sums every bucket at or above the asked
step, and `rebuildUnlocks()` reconstructs the unlock set from the
completed list (silently ignoring unknown ids).

The compile-time guard is `WATCH_PROGRESS: Record<WatchGoalKind, ...>` in
`WatchManager.ts` — a kind added to the union without a reader fails
`tsc`, the same guard `CONTRACT_PROGRESS` gives contracts and
`BLESSING_BEHAVIOR_CONSUMERS` gives blessings. `tests/watch.test.ts`
asserts the same closure on `describeGoal` via `SYNTHETIC: Record<WatchGoalKind,
WatchGoal>`. The sim baseline (`npm run sim`) is held byte-identical
because the simulator never has a completed chapter; the Watch ships on
top of the existing regression check without disturbing it.

## Cross-references

- [AGENTS.md](../AGENTS.md) — doc index, content counts, save version
- [contract-system.md](contract-system.md) — the third contract slot becomes a fourth on chapter 1
- [event-bus.md](event-bus.md) — `watch_chapter_completed` payload, emitter, consumers
- [save-system.md](save-system.md) — v19 migration and `WatchState` shape; the "permanent, survives both resets" rule
- [ui-system.md](ui-system.md) — the Journal tab, the corner chip, the mobile hide, the modal queue
- [prestige-system.md](prestige-system.md) — `veteran_start`, `overseer`, `cold_forge`, `sanctum` as second, non-AP grant paths
- [blessing-system.md](blessing-system.md) — `wide_draft`, `quartermaster`, `heirloom` as injectable overrides

## Known limits

- The seven lifetime counters cannot be back-filled. A player installing
  this update at wave 140 has had flawless waves, swift bosses, mutator
  waves and per-type kill counts forever, and the system has no way to
  know that. The counters start at zero and accrue from the update
  forward; the chapter itself still retroactively completes on the next
  poll, but the counter it reads starts at zero.
- The cascade rule is a legibility limiter, not a fairness one. A player
  who installs the update deep into a save and immediately closes the
  page still gets the chapters — the manager writes `completed` and
  rebuilds `unlocks` synchronously, then the modal fires. They can come
  back to twelve completed chapters and a queue of eleven modals.
- Chapter 13+ is a data edit in `WATCH_CHAPTERS` plus one new
  `WatchUnlockId` with a consumer; the table shape exists so it stays a
  data change. The plan deliberately stops at twelve: twelve reaches
  wave 200 and 50 ascensions, which is deep endgame at the measured
  curve, and a second concurrent chapter would halve the pull of the
  one already on the board.
