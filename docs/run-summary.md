# Run Summary / Debrief

**Files:** `src/ui/RunSummaryModal.ts`, `src/ui/StatsPanel.ts`, `src/game/Game.ts`, `src/systems/SaveManager.ts`, `src/types.ts`, `src/data/milestones.ts` (sort of — N/A here).

## Why

Ascending silently wiped the run: highest wave, time spent, total gold/kills/casts — all thrown away. No closure, no comparison, no reason to push for "one more run" beyond gut feel. This was the single biggest gap in "progression feels rewarding".

## What changed

- **Run summary modal** appears automatically whenever the player Ascends or Transcends.
- The modal shows: **highest wave**, **run duration**, **gold earned**, **enemies killed**, **ability casts**, **AP/TP gained**, and a **% delta vs the previous run** (e.g. `+12% gold, +8 waves`).
- A new **Stats tab** (between Achievements and Settings) lists the last 20 runs as a scrollable history with the same per-run metrics, plus "new record" badges.
- Save format bumped to v3 (with v2→v3 migration so old saves still load).

## Data model

### `RunRecord` (`src/types.ts`)

```ts
interface RunRecord {
  endedAt: number;
  kind: 'ascension' | 'transcendence';
  highestWave: number;
  durationSeconds: number;
  goldEarned: number;       // gold earned DURING this run only
  enemiesKilled: number;    // kills during this run
  abilitiesCast: number;    // casts during this run
  currencyGained: number;   // AP for ascension, TP for transcendence
  rpGained: number;         // RP gained (ascension only)
  newRecordGold: boolean;   // beat the previous best gold?
  newRecordWave: boolean;   // beat the previous best wave?
}

const MAX_RUN_HISTORY = 20; // ring buffer cap
```

### `GameState` additions

- `runHistory: RunRecord[]` — ordered oldest-first, capped at 20.
- `runStartedAt: number` — wall-clock time the current ascension cycle started. Reset on ascend/transcend. Used to compute `durationSeconds` of the next `RunRecord`.
- `stats.runStartedAt: number` — mirror, persisted separately so a save load knows when the active run began (used for the live "Time" field in the Stats tab while the run is in progress).

## Per-run baseline tracking

`Game` keeps four private baseline fields (snapshot at start of each run):

- `runBaselineGold` ← `state.stats.goldEarned`
- `runBaselineKills` ← `state.stats.enemiesKilled`
- `runBaselineAbilities` ← `state.stats.abilitiesCast`
- `runBaselineHighestWave` ← `state.wave.highestWave`

Plus two lifetime-best trackers for "new record" badges:

- `bestGoldRun: number`
- `bestWaveRun: number`

These are seeded from `state.runHistory` on save load so the player keeps credit for records they set before upgrading the save format.

`resetRunBaselines()` is called on:
- constructor end (initial state)
- end of `ascend()` / `transcend()` (after `finalizeRun` and the state reset)
- `clearSave()`

## Recording a run

`Game.finalizeRun(kind, currencyGained, rpGained)` does all the work in one place:

1. Compute deltas: `goldEarned = state.stats.goldEarned - runBaselineGold`, etc.
2. Determine `highestWave = max(state.wave.highestWave, runBaselineHighestWave)`.
3. Compare against `bestGoldRun` / `bestWaveRun` to set `newRecordGold` / `newRecordWave` flags; update the bests.
4. Build the `RunRecord` and push to `state.runHistory`, shifting the buffer if it exceeds `MAX_RUN_HISTORY`.
5. Return the record so the caller can emit it on the event bus.

## Event flow

```text
Player clicks "Ascend"  →  ui.setOnAscend handler  →  game.ascend()
  → prestigeMgr.performAscension (awards AP, RP)
  → game.finalizeRun('ascension', ap, rp)            // builds & stores record
  → applySavedStateReset                              // resets wave/HP/upgrades
  → resetRunBaselines                                 // snapshot new run start
  → saveMgr.save(state)                               // persists runHistory
  → bus.emit('run_ended', { record, previous })      // UIManager shows modal
  → bus.emit('toast', ...)
```

`previous` is `state.runHistory[length - 2]` (the record before the one we just pushed).

## Modal (`src/ui/RunSummaryModal.ts`)

Reuses the `.welcome-modal` class structure for visual consistency. Reuses the same backdrop, card, stats grid, and CTA button styling.

```ts
class RunSummaryModal {
  constructor(root: HTMLElement);
  show(data: RunSummaryData, onDismiss: () => void): void;
  hide(): void;
}
```

`RunSummaryData = { record: RunRecord, previous: RunRecord | null }`.

The CTA label changes per kind: `Begin new run` (ascension) vs `Begin new cycle` (transcendence).

## Stats tab (`src/ui/StatsPanel.ts`)

A new tab in the right-hand panel. Top section is "Current Run" (live values, including elapsed time which is computed from `Date.now() - state.runStartedAt`). Bottom section is "Run History" — a vertical list of `RunRecord` cards, newest first, with a kind-colored left border (gold for ascension, purple for transcendence). Records that beat the prior best get a `🏆` badge in the row.

## Save migration (`src/systems/SaveManager.ts`)

`SAVE_VERSION` bumped from 2 → 3. `validate()` accepts v2 saves and runs `migrateToV3()` in-place:

- `data.runHistory = []` (no runs to recover from v2)
- `data.runStartedAt = data.stats.startedAt ?? Date.now()`
- `data.stats.runStartedAt = data.runStartedAt`
- Then `data.version = 3` so future loads see a clean v3 record.

The snapshot path now copies `runHistory` (clipped to `MAX_RUN_HISTORY`) and `runStartedAt`.

## Public API additions on `Game`

No new methods — the existing `ascend()` and `transcend()` gained two extra lines each (`finalizeRun` + `resetRunBaselines`) and emit the new `run_ended` event. The modal opens automatically via UIManager's `bus.on('run_ended', ...)` subscription.
