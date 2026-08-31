# Save System

**File:** `src/systems/SaveManager.ts`

## Overview

Persists game state under key `the-tower-save` — in **IndexedDB** on the web
and in a **private file** on Android. Never `localStorage`; see
[Persistence backends](#persistence-backends).

## Save Format (`PersistentState`)

```typescript
interface PersistentState {
  version: number;       // current = 24
  savedAt: number;       // Date.now()
  tower: TowerState;
  resources: ResourceState;
  upgrades: Record<string, number>;
  research: string[];
  abilities: Record<string, AbilityState>;    // levels only, cooldowns reset
  prestige: PrestigeState;
  wave: WaveState;
  stats: GameStats;
  blessings: BlessingRunState;                // v10+
  bossRun: BossRunState;                      // v11+
  contracts: ContractRunState;                // v12+
  cores: CoreRunState;                        // v13+
  pacing: PacingState;                        // v14+
  watch: WatchState;                          // v19+
  waveTiming: WaveTimingState;                // v23+
}
```

## Migration ladder

| Step | What it adds |
|---|---|
| v2 → v3 | run history + `runStartedAt` |
| v3 → v4 | research levels as a map, RP, research-in-progress target level |
| v4 → v5 | the wave-modifier block |
| v5 → v6 | tower XP, talents, passives, equipment |
| v6 → v7 | `unlocked` on each passive |
| v7 → v8 | equipment slot/def renames |
| v8 → v9 | per-ability auto-cast, auto-buy strategy/reserve, multi-wave mutator fields |
| v9 → v10 | `blessings` — the run's draft (`docs/blessing-system.md`) |
| v10 → v11 | `bossRun` — boss encounter rewards banked this run (`docs/boss-encounters.md`) |
| v11 → v12 | `contracts` — the run's three live contracts (`docs/contract-system.md`) |
| v12 → v13 | `cores` — unlocked tower cores and the run's selection (`docs/core-system.md`) |
| v13 → v14 | `pacing` — the risk dial, early-call momentum and the kill combo (`docs/wave-system.md`) |
| v14 → v15 | the offline cap became **derived** — 8h base + 8h/level of `ap_idle_time` (no field to seed; see below) |
| v15 → v16 | the `multishot` ability was renamed `rocket_barrage` — its state key in `abilities` and its key in `prestige.autoCastEnabled` move with it, values kept |
| v16 → v17 | the levelling redesign: 0-based levels become 1-based, XP restated onto the new polynomial+geometric curve, `talents.allocated` emptied (full refund — all talent ids changed) |
| v17 → v18 | the passive redesign: `passiveAbilities` cleared (new 12-passive structure with per-passive XP curves, milestones, and gold+XP upgrade costs; old prices were negligible vs new ones so no gold refund) |
| v18 → v19 | the Long Watch. Purely additive — `data.watch = defaultWatch()`. |
| v19 → v20 | the ability redesign. No state-shape change — `migrateV19toV20` only clamps each stored ability level into `[1, maxLevel]` as a safety net. The `instantCast` **localStorage** preference (never part of the save) is read once into `autoCastAutoAim` and removed. |
| v20 → v21 | the upgrades revamp's balance migration — `upgradeDiscount` → `prospecting`, `tp_midas` → `tp_salvage`, and every upgrade/perk level clamped to its new ceiling (see below) |
| v21 → v22 | the Tower XP revamp — the polynomial+geometric curve in `xpTables.xpForNextLevel` replaces the hand-written `TOWER_XP_TABLE`, the talent tree's per-node costs are recomputed from the new curve, the tower's `level`/`xp`/`totalXpEarned` are restated onto it, and every previously allocated talent is refunded (see [xp-talent-system.md](xp-talent-system.md)) |
| v22 → v23 | the offline model rewrite — `waveTiming` block seeded to `defaultWaveTiming()`. Old absence-walk fields are gone; offline no longer simulates anything, it prices `waveRepeats × averageKillGoldForWave + xpPerWaveClear` against the measured wave duration, with `UNMEASURED_WAVE_PENALTY` until five samples exist (see [Offline Progress](#offline-progress)) |
| v23 → v24 | research rebalance + Auto-Upgrader's two new levels; the watch risk histogram gains a slot (`MAX_RISK_CEILING` 7→8). The `watch` block is *not* touched here — v24's load-side fix in `Game.applyPersistedState` brings a pre-v24 save's campaign back the first time the fixed build reads it; this migration only widens `riskWaves` and re-clamps `apSpent` (`ap_auto_upgrader` is a widening, so no existing level goes out of range). RP and refund rules are explicitly *not* part of v24. |

Every step is additive: it fills in defaults rather than transforming, and
nothing is ever dropped. `migrateV9toV10` seeds an empty blessing run, so a
pre-v10 save loads as a run that has simply not drafted yet. The *offer* is
deliberately not persisted — see `docs/blessing-system.md`.

`migrateV10toV11` seeds an empty `bossRun`. Only the *earned* half of a boss
encounter is stored — the flawless AP bonus and the two counters. Mid-fight
state (phase, pattern timers, the bulwark shield, the encounter clock) is
deliberately absent, because live enemies have never been part of the save
format: a load starts with an empty roster and `WaveManager` clears the wave
rather than resuming half a boss. See
[boss-encounters.md](boss-encounters.md#persistence).

`migrateV11toV12` seeds an empty contract block. Unlike the blessing *offer*,
the live contract slots are persisted **in full** — progress, resolved target,
instance id and the wave each was drawn at. A contract is not a choice, so
there is nothing a reload would silently take away by re-rolling it; a blessing
offer is, which is why that one is dropped instead. The seeded default is empty
rather than pre-drawn because the draw needs the run's current wave and
`Game.estimateWaveGold`, neither of which the save layer has;
`ContractManager.restore` refills to three the moment the game wires itself up,
so a pre-v12 save loads straight into three live contracts. See
[contract-system.md](contract-system.md#persistence).

`migrateV12toV13` seeds `{ unlocked: ['marksman'], preferred: 'marksman',
selected: 'marksman' }`. That is a restatement rather than a grant: the default
core is the only one a pre-v13 save could have owned, and `marksman`'s shot
behavior is what every pre-v13 tower was already doing. The block carries **two
lifetimes at once** — `unlocked` and `preferred` are permanent (an ascension
must not un-buy a core, and an auto-ascending run must not silently revert to
the default), while `selected` is run-scoped and restored from `preferred` on
reset. `CoreManager.restore` rejects unrecognised ids and refuses to select a
core the player does not own, so a hand-edited save loads as the default rather
than as an unpayable grant. See [core-system.md](core-system.md#persistence).

`migrateV13toV14` seeds `{ risk: 0, committedRisk: 0, momentum: 0,
momentumWaves: 0, comboBest: 0 }`. Another restatement rather than a grant:
gameplay plan §7.8's gate is that **risk 0 reproduces the pre-Part-7 curve
exactly**, so a pre-v14 save was already playing at risk 0 with nothing banked.

Like `cores`, the block carries **two lifetimes**. `risk` is permanent — it is a
preference about how the player wants to play, and an auto-ascending run reaches
the ascension reset several times an hour with nobody watching, so resetting the
dial there would silently un-set it. Everything else is run-scoped.

A **live combo is deliberately not persisted**, only the run's best.
`PacingManager.restore` clears it: a combo decays in two seconds and a load is
never inside that window, so restoring one would be restoring a number that was
already gone. Same rule as live enemies (`bossRun`) and live orbs
(`docs/loot-system.md`). See [wave-system.md](wave-system.md#risk-dial-gameplay-plan-74).

`migrateV15toV16` is the ladder's first **rename** rather than a seed: the
`multishot` ability became `rocket_barrage`, so its key moves in `abilities`
(stored level and XP untouched) and in `prestige.autoCastEnabled` (the player's
per-ability on/off choice untouched). Both containers are guarded for absence
or a shape mismatch before they are touched, so a hand-edited or partially
formed save cannot crash the walk.

`migrateV18toV19` seeds `data.watch = defaultWatch()`. The block is purely
additive — a pre-v19 save has no campaign state, so the first poll credits
every chapter the player's existing lifetime counters already satisfy.
That is the intended behaviour, not a migration shortcut (see
[watch-system.md](watch-system.md#why-progress-is-derived-not-stored)).
The seven counters that did not exist before this version start at zero
and accrue from the update forward; that is the one place a returning
player loses credit, and it is unavoidable: the data was never written
down.

### v20 → v21: the upgrades revamp

`migrateV20toV21` is a **balance** migration, not an accounting one: no refunds
anywhere — gold, AP and TP all stay as they are. The revamp plan wrote this step
as v14 → v15, but the ladder moved on while it was being built and several of
its bullets landed on their own along the way, so only what was still
outstanding is done here.

| What | How |
|---|---|
| `upgradeDiscount` → `prospecting` | `min(20, ceil(old / 2))`, taking the max against any existing `prospecting`, then the old key is deleted |
| Every upgrade level | clamped to `[startLevel ?? 0, maxLevel]` from `UPGRADE_BY_ID` |
| `tp_midas` → `tp_salvage` | level 1 if owned, old key deleted |
| AP and TP perk levels | clamped to the table's `maxLevel` via `clampPerkLevels`; ids the table no longer defines are dropped |
| `ap_warlord` / `ap_tycoon` | now `exclusive` — a save holding both keeps the one with more spent levels; a tie keeps `ap_warlord`, first of the pair in table order |

The retired `upgradeDiscount` id was **already** being ignored on load —
`UpgradeManager.replaceLevels` walks `UPGRADES` rather than the saved map, so
its levels were silently dropped rather than translated. This step is the
translation. `upgradeCostDiscount` survives as a *stat key*, written by talents
and achievements; what went away is the gold upgrade that fed it. See
[upgrade-system.md](upgrade-system.md#economy-5).

The perk clamps cover the plan's hand-written list (Twin/Rear/Scatter to 1,
`ap_wave_skipper` 15, `tp_wave_start` 8, `tp_game_speed` 6, `tp_head_start` 12,
`tp_fire_rate` 20, `tp_crit` 25, `tp_treasure`/`tp_mana` 15) **without
restating any of those numbers** — they are read from `AP_PERK_BY_ID` /
`TP_PERK_BY_ID`, so the migration stays correct if the tables are retuned again.

## WatchState (v19+)

The Long Watch campaign — `GameState.watch`. Two fields:

- `completed: string[]` — chapter ids completed, in completion order. The
  `WatchManager` rebuilds the unlock set from this list on every mutation,
  so the unlock map and the completed list cannot drift.
- `counters: WatchCounters` — the seven lifetime counters no existing
  field covers: `killsByType` (per-enemy-type lifetime kills),
  `flawlessWaves`, `swiftBosses`, `contractsDone`, `blessingPicks`,
  `mutatorWaves`, and `riskWaves` (a per-step histogram indexed by the
  risk level in force when the wave was cleared).

**Permanent.** Neither `applySavedStateReset` nor
`applyFullTranscendenceReset` may touch this block — it is
meta-progression, like achievements and unlocked cores. A reset that wiped
it would delete the only long-horizon goal the game has.

**Objective progress is deliberately not stored.** It is derived from the
counters on every read, so there is nothing here that a save/load can
disagree with. See [watch-system.md](watch-system.md#why-progress-is-derived-not-stored).

`normalizeWatch(w)` repairs malformed saves in place: missing or
non-array `completed` → `[]`; missing or non-object `counters` →
`defaultWatch().counters`; missing or non-object `killsByType` → `{}`;
the five scalar counters missing or non-finite → `0`; `riskWaves`
missing, short, or with non-finite entries → resized to
`MAX_RISK_CEILING + 1` zeros, valid entries copied in. The `riskWaves`
array is sized to `MAX_RISK_CEILING + 1` (9 indices today — Crown of
Thorns (chapter 14) raised the ceiling from 7 to 8, so the indexed range
is 0–8) so a future Watch unlock that raises the dial cannot land out of
bounds.

## Auto-Save

`SaveManager.tick(realDt, state, onSave)` is called once per frame from
`Game.frameUpdate` on **wall-clock** delta, so the save cadence does not
accelerate with game speed.

Two triggers:

- **Debounced (5 s).** Nine game events — purchases, wave starts, research,
  ability upgrades, AP/TP spends, achievements — call
  `SaveManager.requestSave()`, which only marks the state dirty. `tick` flushes
  at most once per `SAVE_DEBOUNCE_SECONDS`. These used to write the full JSON
  save synchronously on every event, which with auto-buy meant several
  `JSON.stringify` calls of the whole state per second.
- **Backstop (30 s).** `AUTO_SAVE_INTERVAL` writes even when nothing requested
  it.

`save(state)` writes immediately and clears the pending flag; use it for
anything that must survive an immediate close. `Game.bindVisibilityEvents`
calls it when the tab goes hidden, which is what flushes a pending debounced
write.

## Validation

`validate()` checks:
- version is 2..24 (anything older than the current version is walked up the migration ladder; anything outside the range is rejected)
- All required fields exist and have correct types (object, array, number checks)

## Offline Progress

Computed on load via `computeOfflineProgress(persisted, now)`. Offline no
longer simulates a wave walk — it picks one wave and repeats it for the whole
absence at a closed-form price.

1. **Elapsed time:** `max(0, (now - savedAt) / 1000)`, capped at the current
   idle cap — 8h base, +8h per level of the `ap_idle_time` AP perk, up to 4
   days (11 levels). The cap is derived from `prestige.apSpent` via a
   `getIdleCapSeconds` callback injected into `SaveManager`; nothing about it
   is persisted, which is why `migrateV14toV15` is a no-op.
2. **Wave farmed:** the wave the run was standing on. If that wave is a boss
   (`isBossWave(w) % 10 === 0`), offline steps back one — a run cannot farm a
   boss without entering it, and entering it is not what "came back" means.
3. **Wave duration:** `offlineWaveSeconds(waveTiming, wave, inProgress)` — the
   `WaveTimingState` block's measured average (rescaled for depth if the
   sample was taken elsewhere), or `expectedWaveSeconds(wave)` until five
   clears have been timed. A wave the player is already part-way through is
   never priced shorter than the seconds already spent on it
   (`inProgressSeconds` floor). See [data/waveTiming.ts](../../src/data/waveTiming.ts).
4. **Cycle time:** `cycleSeconds = waveSeconds + intermissionSecondsForWave(wave)`.
5. **Repeats:** `waveRepeats = elapsed / cycleSeconds`, fractional and capped
   at `MAX_OFFLINE_WAVE_REPEATS = 100_000`.
6. **Yield fraction:** `OFFLINE_YIELD_FRACTION * (1 if measured, UNMEASURED_WAVE_PENALTY = 0.5 otherwise)`.
   The unmeasured discount halves the yield — so a player who has just
   ascended pays roughly half what a player with five samples at the same
   depth pays. The figure is named in the modal so the player can see *why*
   the absence paid what it did.
7. **Per-wave gold:** `averageKillGoldForWave(wave) * count` (closed-form
   average across the wave's enemy types and the wave's risks — no
   per-enemy RNG).
8. **Per-wave XP:** `averageKillXPForWave(wave) * count + xpPerWaveClear(wave)`.
9. **Totals:** `goldEarned = floor(perWaveGold * waveRepeats * yieldFraction)`,
   `xpEarned = floor(perWaveXp * waveRepeats * yieldFraction)`, and
   `passiveXpEarned = floor(passiveWaveXpRef(wave) * waveRepeats * yieldFraction)`.
   The yield fraction is the *only* offline-vs-active dial; everything else is
   the same arithmetic the active game runs.

`OfflineResult` carries `elapsedSeconds`, `capped`, `maxIdleSeconds`,
`wave`, `waveSeconds`, `waveRepeats`, `measured`, `goldEarned`, `rpEarned`,
`researchElapsed`, `xpEarned`, `passiveXpEarned` — see
[src/systems/SaveManager.ts](../../src/systems/SaveManager.ts) (line 164).
The result fields the modal renders are `goldEarned`, `xpEarned`,
`waveRepeats`, `wave`, `capped`, `maxIdleSeconds`, `elapsedSeconds`,
`measured`.

Applied via `applyOfflineProgress(state, result)`:
- Adds gold to `resources.gold`, `resources.lifetimeGold`, `stats.goldEarned`
- Adds XP to `towerXp.xp`/`totalXpEarned` and may level the tower (the
  curve at [data/xpTables.ts](../../src/data/xpTables.ts) — `xpForNextLevel`)
- Records passive XP on each unlocked passive
- Records `result.waveRepeats` as the modal's "you farmed X clears of wave Y"
  line — what used to be "waves cleared", and is now a literal accounting,
  not a number the game had to be persuaded to swallow

## Welcome Back Modal

When offline progress > 0, `welcome_back` event triggers `WelcomeBackModal.show()`:
- Shows duration, gold earned, XP earned, **wave repeats at the wave farmed**
- Capped notice if the absence exceeded the idle cap, naming the cap
  (`capped at 8h`, `capped at 1d 8h`, …)
- Unmeasured-rate notice if the player has fewer than five timed clears
  (`paid at half the usual rate — no clears timed yet`) — see
  `WelcomeBackModal.ts` line 488
- Modal overlay with Continue button

## Manual Operations

| Method | Purpose |
|--------|---------|
| `hydrate()` | **async.** Fill the cache from the backend. Awaited once at boot, before `load()` |
| `save(state)` | Serialize into the cache and schedule a flush. Returns `false` only if *serialization* fails |
| `load()` | Validate and migrate the cached snapshot |
| `clear()` | Drop the save and schedule its removal |
| `hasSave()` | Check existence (against the cache) |
| `flushNow()` | **async.** Resolves once every write issued so far has reached the backend |

## Persistence backends

**Files:** `src/systems/storage/` — `SaveStore.ts`, `IdbStore.ts`,
`FilesystemStore.ts`, `index.ts`. Plan: `plans/capacitor.md` §8.

`localStorage` is the wrong home for a save in a native shell: it is WebView
data, it shares one ~5 MB origin quota, Android may evict it under storage
pressure, and a "clear cache" cleanup can take it. So the bytes moved. **The
format did not** — still `SAVE_VERSION` 24, the same JSON, the same migration
ladder.

`SaveStore` is a three-method string key/value interface. `SaveManager` owns
the format; this layer owns the bytes; neither knows anything about the other.

| Implementation | Where | Notes |
|---|---|---|
| `IdbSaveStore` | any browser | `idb` over IndexedDB, db `the-tower`, store `kv`. Transactional, so no torn write is possible. Opened lazily so constructing it in node is free |
| `FilesystemSaveStore` | under Capacitor | one UTF-8 JSON file in `Directory.Data` (`/data/data/<appId>/files/the-tower-save.json`). No 5 MB ceiling, in the app's backup set, not WebView data |
| `MemorySaveStore` | node, tests, IndexedDB-denied browsers | the session is not persisted — the same thing the old `isStorageAvailable()` false branch meant |

`getSaveStore()` picks one, once. `setSaveStore()` is the test seam.

### A synchronous cache over an asynchronous backend

`localStorage` is synchronous; both replacements are not. Making
`save()`/`load()` return promises would push `await` into all eight call
sites — including the frame loop, where an `await` per autosave is a stutter,
and `visibilitychange`, where nobody can await anything. Impact analysis
scored that change CRITICAL: 15 impacted symbols across 7 execution flows.

So the four IO methods keep their **exact** synchronous signatures and answer
from `cached`, an in-memory copy of the serialized snapshot:

- `hydrate()` fills `cached` once, at boot, before `Game.tryLoadSave()`.
- `save()` updates `cached` synchronously and calls `scheduleFlush()`, which
  chains the write behind the last one on `flushQueue` — newest payload wins,
  two writes can never interleave.
- `load()` before `hydrate()` warns and returns `null`. It cannot return "no
  save", because that would be read as "new player" and hand someone a fresh
  account.
- A backend write that fails is reported by `console.warn` from the flush, not
  by `save()`'s return value — by then the caller has long since returned.

Boot order (`src/main.ts`): `await game.hydrateSave()` → `game.tryLoadSave()`
→ `game.start()`. On Android the `pause` handler (`src/platform/native.ts`)
snapshots synchronously and then `await`s `game.flushSave()` — the last moment
before the OS is free to kill the process, and the one place waiting for the
write is both possible and worth it.

### The Android write dance

`writeFile` truncates before it writes, and `load()` responds to unparseable
JSON by *clearing the save* — so a process death mid-write would turn a
badly-timed kill into a wiped account. `FilesystemSaveStore.set` therefore
writes the full payload to a `.tmp` sibling, deletes the target, then renames
the tmp over it. `get()` falls back to the `.tmp`, so at every instant at
least one complete file is on disk.

### Migrating off `localStorage`

`hydrate()` adopts a pre-move `localStorage` save when the backend has nothing,
and writes it straight into the new store — so the migration runs exactly once
and no player loses progress. The old copy is deliberately **not** deleted:
that is what makes rolling this release back non-destructive. Deleting it is a
one-line change for a later release, once nobody is downgrading.

Note the migration is origin-scoped, like `localStorage` itself: a save made
in a desktop browser cannot migrate into the app, and never could. This is
also why `capacitor.config.ts` pins `androidScheme: 'https'` /
`hostname: 'localhost'` — changing either changes the WebView origin and
orphans every existing save.
