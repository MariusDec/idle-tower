# Economy Rebalance — Offline Progress, Equipment Drops and XP Faucets

**Goal:** stop the run from outrunning the player. Today a 24h absence with two prestiges lands a player at wave 70 / tower level 60 without meaningful play. Three faucets are responsible, and this plan closes all three: the offline walk (which pays thousands of waves per absence), the equipment drop rate (3–4 pieces per wave past wave 60), and the tower/passive XP curves (which grow linearly-to-superlinearly in wave depth while the level curve grows geometrically).

**Related components:** `src/systems/SaveManager.ts`, `src/systems/WaveManager.ts`, `src/systems/EquipmentManager.ts`, `src/systems/TowerXpManager.ts`, `src/systems/PassiveAbilityManager.ts`, `src/game/Game.ts`, `src/ui/WelcomeBackModal.ts`, `src/data/xpTables.ts`, `src/data/passiveAbilities.ts`, `src/data/equipment.ts`, `src/data/waveTiming.ts` (new), `src/data/pacing.ts`, `src/data/formulas.ts`, `src/types.ts`, `tests/*`, `sim/checks.ts`, `docs/*`, `AGENTS.md`.

**Tech stack:** TypeScript, Vite, Vitest, the in-repo balance simulator (`npm run sim`, `npm run checks`).

**Status:** planning only. Every constant below is given with the arithmetic that produced it, so it can be typed in as written. §9 lists the dials if the result needs a nudge after playtesting.

**How to read this document:** §1 is the measured diagnosis. §2 is the offline rework (requirements 1–4). §3 is the equipment rework (requirement 5). §4 is the XP rework (requirement 6). §5 is persistence. §6 is tests, §7 docs, §8 task order and verification, §9 the tuning levers.

---

## 1. Measured baseline

All figures below were produced by driving the shipping data tables (`src/data/formulas.ts`, `src/data/enemies.ts`, `src/data/xpTables.ts`, `src/systems/EnemyManager.ts`) through the same arithmetic the game uses. They are the "before" column that §8.3 checks the change against.

### 1.1 The offline walk is the dominant faucet

`SaveManager.computeOfflineProgress` walks wave by wave. Each wave's duration is

```
waveSeconds = max(waveHp / effectiveDPS, AVG_WAVE_DURATION * 0.25)   // AVG_WAVE_DURATION = 18
```

so the floor is **4.5 s per wave**. A tower with headroom sits on that floor, and the walk also *climbs* to `highestWave` and then farms there. An 8 h absence therefore runs `28800 / 4.5 = 6400` waves, clamped by `MAX_OFFLINE_WAVES = 5000`.

| Away 8 h at wave 65 | old model |
|---|---:|
| Waves paid | 5000 |
| Gold | 1.29e8 |
| Tower XP (× `OFFLINE_XP_EFFICIENCY` 0.5) | 5.94e6 |
| Passive XP (× `OFFLINE_PASSIVE_XP_RATE` 0.20) | 1.30e6 |

For scale: the *entire* tower-XP cost of going from level 47 to level 60 is **799,349 XP**. One 8 h absence at wave 65 pays 5.94 M — seven times that journey. This single number explains the reported "level 47 → 60 between wave 65 and 70".

Live play at wave 65 pays 2,374 XP per wave over a ~52 s wave: an hour of active play is ~69 waves ≈ 164 K XP. Offline out-earns active play by **36×**.

### 1.2 Equipment drops scale with wave twice over

`rollDrop` ramps the chance with depth (`+ wave * 0.001` for elites, `+ wave * 0.005` for bosses), *and* the number of eligible kills grows with depth: `enemyCountForWave(w) = 5 + floor((w-1) * 1.2)` is 81 bodies at wave 65, and `eliteChanceForWave(65) = 12%`, so ~9.7 elites walk in per wave. A boss kill rolls `bossEncounterWeight(wave)` times — 8 rolls at wave 70, 20 at wave 200.

Expected pieces per 10-wave block (9 normal waves + 1 boss), with a modest `+0.10` find-chance bonus from talents/passives:

| Waves | Pieces (old) |
|---|---:|
| 21–30 | 3.0 |
| 41–50 | 8.9 |
| 61–70 | **18.2** |
| 91–100 | 38.5 |
| 191–200 | 81.5 |

18 pieces across ten waves is the reported "3–4 pieces in a single wave" on the boss-adjacent waves.

### 1.3 XP grows with depth faster than the level curve rewards

- `killXpWaveScale(w) = 1 + 0.20 * w` — **linear**, so a wave-200 kill is 41× a wave-1 kill.
- `xpPerWaveClear(w) = 1.5 * w^1.5` — **superlinear**.
- Enemy count is itself linear in `w`.

So per-wave XP grows ≈ quadratically, while the level requirement grows geometrically at only 1.028 per level:

| Wave | Enemies | Kill XP/wave | Clear XP | Total/wave |
|---:|---:|---:|---:|---:|
| 10 | 15 | 50 | 47 | 97 |
| 20 | 27 | 162 | 134 | 296 |
| 40 | 51 | 639 | 379 | 1,018 |
| 65 | 81 | 1,588 | 786 | **2,374** |
| 100 | 123 | 3,653 | 1,500 | 5,153 |
| 200 | 243 | 14,062 | 4,243 | 18,305 |

Level requirements for reference: 47→48 = 42,167; 60→61 = 89,243; 100→101 = 609,899.

---

## 2. Offline progress rework (requirements 1–4)

### 2.1 The new model in one paragraph

Offline no longer simulates a climb. It repeats **the last wave the player actually completed**, at the duration that wave was actually completed in (in *simulation* seconds, so game speed cancels out), and divides the absence by that duration plus the wave's intermission. The resulting **repeat count is a real number**: 1.5 repeats pays 1.5 waves of income. Every payout is then multiplied by a single **offline fraction of 0.25**.

The last *completed* wave rather than the wave in progress is the whole basis of the estimate. A wave that has never been finished has no measured duration and no proof the tower can finish it at all; the last completed wave is the deepest thing the run has demonstrated, and its clear time is a fact rather than a model. It also makes the two halves of the estimate — which wave, and how long — the same measurement, so they can never disagree.

This replaces four constants (`OFFLINE_EFFICIENCY` 0.5, `AVG_WAVE_DURATION` 18, `OFFLINE_XP_EFFICIENCY` 0.5, `OFFLINE_PASSIVE_XP_RATE` 0.20) and the `estimateDPS` heuristic with one measured quantity and one dial.

### 2.2 New file: `src/data/waveTiming.ts`

Pure functions and constants, so both `SaveManager` (which computes offline) and `Game` (which records samples) read the same arithmetic, and so tests can exercise it without a live game.

The **interface** goes in `src/types.ts` alongside `WaveState` and `PacingState` (§5.1); the constants and functions go here. `waveTiming.ts` imports the type from `../types`, which is the direction every other `src/data/*` module already uses.

The block records **which wave** was last completed as well as how long it took, because those two are one fact: offline repeats the last *completed* wave, priced at the time that wave actually took. There is no rescaling from one depth to another — the sample and the target are the same wave.

```ts
import type { WaveTimingState } from '../types';
import { expectedWaveSeconds, isBossWave } from './formulas';

/**
 * How long the player's tower actually takes to clear a wave — the arithmetic
 * behind `WaveTimingState` (declared in `src/types.ts`).
 *
 * Everything here is in **simulation seconds**, not wall-clock seconds:
 * `WaveState.elapsed` accrues on the simulation delta (`Game.update`'s `dt`,
 * already multiplied by the game-speed setting), so a wave that takes 60
 * simulation seconds takes 60 s at 1x and 40 s of wall clock at 1.5x. Offline
 * progress divides a *wall-clock* absence by these numbers, which is exactly
 * what "offline always runs at 1x" means: raising the speed dial makes waves
 * pass faster while you are watching and changes nothing while you are away.
 */

/** Clears that feed the running mean. Short enough to track a tower that just got stronger. */
export const WAVE_TIMING_EMA_WINDOW = 5;

/** Floor and ceiling on any single measurement, so a glitched frame cannot poison the average. */
export const MIN_WAVE_SECONDS = 5;
export const MAX_WAVE_SECONDS = 3600;

/**
 * Payout multiplier when the run has never completed a wave, so the duration
 * is `expectedWaveSeconds` rather than a measurement. A tower that has not
 * cleared anything must not be paid as if it had.
 */
export const UNMEASURED_WAVE_PENALTY = 0.5;

export function defaultWaveTiming(): WaveTimingState {
  return { lastWaveSeconds: 0, avgWaveSeconds: 0, sampleWave: 0, samples: 0 };
}

function clampSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return MIN_WAVE_SECONDS;
  return Math.min(MAX_WAVE_SECONDS, Math.max(MIN_WAVE_SECONDS, seconds));
}

/**
 * Fold one completed wave into the running mean.
 *
 * The first `WAVE_TIMING_EMA_WINDOW` samples produce a plain running mean
 * (`n` grows 1, 2, 3 …); after that the divisor sticks at the window size and
 * it becomes an exponential moving average with weight `1 / window`. The mean
 * is over the last handful of clears, which are all within a few waves of each
 * other, so it smooths a lucky or unlucky wave without smearing across depths.
 *
 * `sampleWave` is overwritten every time: it is *the last completed wave*, and
 * that is the wave an absence repeats.
 */
export function recordWaveTime(t: WaveTimingState, wave: number, seconds: number): void {
  if (!Number.isFinite(seconds) || seconds <= 0) return;
  const d = clampSeconds(seconds);
  const n = Math.min(t.samples + 1, WAVE_TIMING_EMA_WINDOW);
  t.avgWaveSeconds = t.samples <= 0 ? d : t.avgWaveSeconds + (d - t.avgWaveSeconds) / n;
  t.lastWaveSeconds = d;
  t.sampleWave = Math.max(1, Math.floor(wave));
  t.samples = Math.min(t.samples + 1, 1_000_000);
}

/**
 * Which wave an absence repeats, and how long one clear of it takes.
 *
 * **The last completed wave**, at the duration it was completed in. Not the
 * wave in progress: that wave has never been finished, so nothing is known
 * about how long it takes or whether the tower can finish it at all, and
 * paying it would be paying for a claim the run has not made. The last
 * completed wave is the deepest thing the tower has actually proved it can do.
 *
 * `WaveManager` never records a boss wave, a mutator wave or an early call
 * (§2.3), so `sampleWave` is always an ordinary wave the tower cleared under
 * its own power — which is also why nothing here needs a boss step-back.
 *
 * The fallback runs only before the first clear of a run. There `currentWave`
 * is all there is: price it from `expectedWaveSeconds`, step back off a boss,
 * floor it with however far into the wave the player already was
 * (`inProgressSeconds` = `WaveState.elapsed` at save time — a wave that has
 * been running 90 s cannot be a 52 s wave), and pay it at
 * `UNMEASURED_WAVE_PENALTY`.
 */
export function offlineWaveTarget(
  t: WaveTimingState | undefined,
  currentWave: number,
  inProgressSeconds = 0,
): { wave: number; seconds: number; measured: boolean } {
  if (t && t.samples > 0 && t.avgWaveSeconds > 0 && t.sampleWave > 0) {
    return {
      wave: Math.max(1, Math.floor(t.sampleWave)),
      seconds: clampSeconds(t.avgWaveSeconds),
      measured: true,
    };
  }
  const w = Math.max(1, Math.floor(currentWave));
  const wave = isBossWave(w) ? Math.max(1, w - 1) : w;
  const estimate = Math.max(expectedWaveSeconds(wave), Math.max(0, inProgressSeconds));
  return { wave, seconds: clampSeconds(estimate), measured: false };
}
```

### 2.3 Measuring a wave: `src/systems/WaveManager.ts`

Two edits.

**(a) The wave clock must not run while the game is paused for a modal.** `tickEnrage` is what advances `state.elapsed`, and it currently runs while `spawnPaused` (a mutator offer is on screen) or `intermissionPaused` is set. A wave that sat behind a modal for 30 s would be measured as 30 s longer than it was — and would also enrage for it, which is a bug in its own right. In `tick`, replace

```ts
    this.tickEnrage(dt);
```

with

```ts
    // The wave clock is the measurement offline progress is paced by
    // (plans/economy.md §2.3) as well as the enrage fuse. Neither should run
    // while the simulation is held open for a mutator offer or a draft.
    if (!this.spawnPaused && !this.intermissionPaused) this.tickEnrage(dt);
```

**(b) Emit the measurement.** In `concludeWave`, capture `elapsed` *before* it is zeroed and emit it when the wave is a fair sample.

These exclusions are load-bearing in a way they would not be if the sample only supplied a duration: the last recorded clear is also **the wave an absence repeats** (§2.2), so excluding boss waves is what keeps offline from farming boss gold, boss gear and boss XP, and excluding mutator waves is what keeps a Swarm wave's tripled roster out of the offline payout. A player parked on wave 70 whose last ordinary clear was 69 farms 69.

```ts
  private concludeWave(openIntermission: boolean): void {
    const clearedWave = this.state.number;
    const clearedSeconds = this.state.elapsed;
    this.onWaveCleared(clearedWave);
    this.bus.emit('wave_cleared', clearedWave);
    // plans/economy.md §2.3: the offline model is paced by how long a wave
    // *actually* takes this tower. Only a wave that ran to its natural end is
    // a fair sample, so three cases are excluded:
    //   - `openIntermission === false` — an early call, which credits the wave
    //     with stragglers still alive and would under-report the duration;
    //   - a boss wave, which is a 4x-longer encounter offline never farms;
    //   - a wave under a mutator, whose enemy count is not this depth's.
    // The wave-skip path never reaches `concludeWave`, so it is excluded too.
    if (
      openIntermission
      && !isBossWave(clearedWave)
      && this.state.waveModifier.active === null
      && clearedSeconds > 0
    ) {
      this.bus.emit('wave_timed', { wave: clearedWave, seconds: clearedSeconds });
    }
    this.state.elapsed = 0;
    // … rest unchanged
```

`isBossWave` is already imported in this file.

### 2.4 Recording the measurement: `src/game/Game.ts`

Add the subscription next to the other `bus.on` wiring (the block around `bindSaveEvents` / the `wave_cleared` handler):

```ts
    this.bus.on('wave_timed', (payload: unknown) => {
      const p = payload as { wave: number; seconds: number };
      recordWaveTime(this.state.waveTiming, p.wave, p.seconds);
      this.saveMgr.requestSave();
    });
```

with `import { recordWaveTime, defaultWaveTiming } from '../data/waveTiming';`.

In the initial-state factory (`Game.ts` ~line 313, the object that starts `timestamp: Date.now(),`), add after `pacing: { … }`:

```ts
    waveTiming: defaultWaveTiming(),
```

In `applyPersistedState`, next to `this.state.wave = { ...persisted.wave };`:

```ts
    this.state.waveTiming = { ...(persisted.waveTiming ?? defaultWaveTiming()) };
```

In `applySavedStateReset` (shared by ascension **and** transcendence), next to `this.pacingMgr.reset();`:

```ts
    // Wave timing is run-scoped: the new run's tower is not the old run's, and
    // a sample taken at wave 65 must not price an offline absence at wave 1.
    this.state.waveTiming = defaultWaveTiming();
```

### 2.5 `computeOfflineProgress` — the rewrite

**Constants and dead code.** In `src/systems/SaveManager.ts`, delete `OFFLINE_EFFICIENCY`, `AVG_WAVE_DURATION`, `OFFLINE_XP_EFFICIENCY`, `OFFLINE_PASSIVE_XP_RATE`, the `estimateDPS` function and `averageKillHPForWave` — the DPS walk was the only consumer of the last two. Drop the `enemyHPForWave`, `bossMaxHpForWave` and `bossPhaseHpFactor` imports if nothing else in the file still uses them. Then add:

```ts
/**
 * The offline fraction (plans/economy.md §2).
 *
 * One dial, applied to every offline payout: gold, tower XP and passive XP.
 * It replaces four separate discounts (a 0.5 DPS efficiency, a 0.5 XP factor
 * and a 0.20 passive-XP rate, all stacked on a wave count paced by an 18 s
 * average) with a claim the player can read off the Welcome Back card: an
 * absence pays a quarter of what playing that same wave for that long would.
 */
const OFFLINE_YIELD_FRACTION = 0.25;

/**
 * Numeric guard on the repeat count, not a balance lever. Four days (the
 * maximum idle cap) at the `MIN_WAVE_SECONDS` floor is 69k repeats; this stops
 * a corrupt timing block from producing an unbounded number.
 */
const MAX_OFFLINE_WAVE_REPEATS = 100_000;
```

Delete `MAX_OFFLINE_WAVES` as well — the walk it guarded is gone, and the payout is now closed-form arithmetic rather than a loop.

**Also export two existing helpers** so the tests in §6.3 can assert the exact payout instead of an approximation — add `export` to `function averageKillGoldForWave` and `function averageKillXPForWave`. They stay in this file; nothing else moves.

**Imports to add:**

```ts
import { xpPerWaveClear } from '../data/xpTables';
import { intermissionSecondsForWave } from '../data/pacing';
import {
  defaultWaveTiming,
  offlineWaveTarget,
  UNMEASURED_WAVE_PENALTY,
} from '../data/waveTiming';
// `WaveTimingState` joins the existing `import type { … } from '../types'` block
// at the top of the file.
```

**`OfflineResult` becomes:**

```ts
export interface OfflineResult {
  elapsedSeconds: number;
  capped: boolean;
  /** The cap in effect for this absence, so the report can name it (plan §10.1). */
  maxIdleSeconds: number;
  /** The wave the absence farmed: the last one completed. Offline never advances (§2.6). */
  wave: number;
  /** Simulation seconds one clear of `wave` was priced at. */
  waveSeconds: number;
  /** How many times that wave was completed. Fractional: 1.5 pays 1.5 waves. */
  waveRepeats: number;
  /** False when `waveSeconds` is an estimate rather than a measurement. */
  measured: boolean;
  goldEarned: number;
  rpEarned: number;
  researchElapsed: number;
  xpEarned: number;
  /** Passive-ability XP, already scaled by `OFFLINE_YIELD_FRACTION`. */
  passiveXpEarned: number;
}
```

`effectiveDPS`, `wavesCleared` and `endWave` are removed. Their only consumers are the Welcome Back modal (§2.7) and `Game.applyOfflineWave` (§2.6), both of which this plan deletes.

**The method:**

```ts
  /**
   * What an absence earned (plans/economy.md §2).
   *
   * Offline repeats **one** wave — the last one the run actually completed —
   * for as long as the absence lasted. It does not advance: catching a run up
   * is one thing, setting its record depth while nobody is watching is
   * another, and the old walk that climbed to `highestWave` and farmed there
   * is what let a night's sleep out-earn a week of play.
   *
   * The wave in progress at save time is deliberately *not* the wave that is
   * farmed. It has never been finished, so neither its duration nor the
   * tower's ability to finish it is known; the last completed wave is the
   * deepest claim the run can actually support.
   *
   * The wave's duration is a *measurement* (`WaveTimingState`), taken in
   * simulation seconds, so the game-speed setting cannot buy offline income:
   * at 1.5x a wave passes in less wall clock but the same simulation time, and
   * this arithmetic divides wall-clock absence by simulation duration.
   *
   * `goldMultiplier` is the live composed multiplier (`Game.computeGoldMultiplier`).
   */
  computeOfflineProgress(
    persisted: PersistentState,
    goldMultiplier = 1,
    now: number = Date.now(),
  ): OfflineResult {
    const rawElapsed = Math.max(0, (now - persisted.savedAt) / 1000);
    const capSeconds = Math.max(0, this.getIdleCapSeconds());
    const capped = rawElapsed > capSeconds;
    const elapsed = Math.min(rawElapsed, capSeconds);

    // The last completed wave and the time it took, as one measurement. The
    // boss step-back lives inside `offlineWaveTarget`'s fallback branch —
    // a recorded sample is never a boss wave to begin with (§2.3).
    const timing: WaveTimingState = persisted.waveTiming ?? defaultWaveTiming();
    const inProgress = Math.max(0, persisted.wave.elapsed ?? 0);
    const { wave, seconds: waveSeconds, measured } =
      offlineWaveTarget(timing, persisted.wave.number, inProgress);
    const cycleSeconds = waveSeconds + intermissionSecondsForWave(wave);

    const lifetimeWave = persisted.stats.lifetimeHighestWave ?? 1;
    const rpGainMultiplier = computeRPGainMultiplier(persisted.research ?? {});
    const baseRPRate = 0.05 * lifetimeWave / 60;
    const rpEarned = Math.max(0, Math.floor(baseRPRate * (1 + rpGainMultiplier) * elapsed));

    if (elapsed <= 0 || cycleSeconds <= 0) {
      return {
        elapsedSeconds: elapsed,
        capped,
        maxIdleSeconds: capSeconds,
        wave,
        waveSeconds,
        waveRepeats: 0,
        measured,
        goldEarned: 0,
        rpEarned: elapsed > 0 ? rpEarned : 0,
        researchElapsed: Math.max(0, elapsed),
        xpEarned: 0,
        passiveXpEarned: 0,
      };
    }

    // The fraction is deliberate: an absence of 1.5 wave-cycles pays 1.5 waves
    // of income, not 1. Truncating would make short absences pay nothing at
    // depth, where a single wave is minutes long.
    const waveRepeats = Math.min(MAX_OFFLINE_WAVE_REPEATS, elapsed / cycleSeconds);

    const count = Math.max(1, Math.floor(spawnCountForWave(wave)));
    const perWaveGold = averageKillGoldForWave(wave) * count * Math.max(0, goldMultiplier);
    // The clear payout is part of what a wave pays, so a *completed* wave has
    // to include it. The old walk paid kills only.
    const perWaveXp = averageKillXPForWave(wave) * count + xpPerWaveClear(wave);
    const perWavePassiveXp =
      passiveXpPerKill('normal', wave) * count + passiveXpPerWaveClear(wave);

    // No pioneer bonus: a repeated wave is never a record.
    const yieldFraction = OFFLINE_YIELD_FRACTION * (measured ? 1 : UNMEASURED_WAVE_PENALTY);
    const scale = waveRepeats * yieldFraction;

    return {
      elapsedSeconds: elapsed,
      capped,
      maxIdleSeconds: capSeconds,
      wave,
      waveSeconds,
      waveRepeats,
      measured,
      goldEarned: Math.max(0, Math.floor(perWaveGold * scale)),
      rpEarned,
      researchElapsed: elapsed,
      xpEarned: Math.max(0, Math.floor(perWaveXp * scale)),
      passiveXpEarned: Math.max(0, perWavePassiveXp * scale),
    };
  }
```

`applyOfflineProgress` is unchanged except that its long comment about the walk's ceiling should be replaced with a one-liner pointing at §2.5. RP and research time are **not** touched by the offline fraction — they are wall-clock systems that already run at their own rate, and requirement 3 is about the wave-income faucet.

### 2.6 Removing the offline wave advance (requirement 2)

In `src/game/Game.ts`:

1. **Delete `applyOfflineWave` entirely** (the private method around line 1994).
2. In `bindVisibilityEvents` (~line 2016) delete the `const startWave = …` line, the `this.applyOfflineWave(result.endWave);` line, the `const endWave = this.state.wave.number;` line, and change the emit to `this.bus.emit('welcome_back', { result });`.
3. In `tryLoadSave` (~line 3379) make the same three deletions and change the emit to `this.bus.emit('welcome_back', { result });`.

The player comes back standing on exactly the wave they left, mid-wave state and all. Note the asymmetry this creates and keep it: the run *resumes* on the wave in progress, while the absence *paid* for the last completed wave (§2.2). The card names the wave it paid for, so the two numbers being one apart is legible rather than confusing.

### 2.7 Welcome Back card: `src/ui/WelcomeBackModal.ts`

```ts
export interface WelcomeBackData {
  result: OfflineResult;
}
```

Replace the "Waves cleared" stat block with a wave-repeat block, and rewrite the efficiency note:

```ts
    const waveStat = document.createElement('div');
    waveStat.className = 'welcome-stat';
    const waveLabel = document.createElement('div');
    waveLabel.className = 'welcome-stat-label';
    waveLabel.textContent = 'Wave repeats';
    const waveValue = document.createElement('div');
    waveValue.className = 'welcome-stat-value';
    // One decimal, because a fractional repeat is the point: at depth a wave is
    // minutes long and a short absence is legitimately "1.4 waves".
    waveValue.textContent = `${data.result.waveRepeats.toFixed(1)}x`;
    waveStat.appendChild(waveLabel);
    waveStat.appendChild(waveValue);
    const waveSub = document.createElement('div');
    waveSub.className = 'welcome-stat-sub';
    // Name the wave *and* its clear time: together they are the whole claim the
    // card is making, and they are the two numbers a player will want to check.
    waveSub.textContent =
      `wave ${data.result.wave} · ${formatDuration(data.result.waveSeconds)} per clear`;
    waveStat.appendChild(waveSub);
    stats.appendChild(waveStat);
```

and

```ts
    const efficiency = document.createElement('p');
    efficiency.className = 'welcome-modal-note';
    efficiency.textContent = data.result.measured
      ? `Your tower replayed wave ${data.result.wave} — the last one you cleared — at 1x speed `
        + 'and 25% efficiency, with your full gold multiplier applied.'
      : `Your tower replayed wave ${data.result.wave} at 1x speed. You had not finished a wave `
        + 'yet, so the pace was estimated and paid at half the usual 25%.';
    card.appendChild(efficiency);
```

The `wave X → Y` sub-row and the `startWave`/`endWave` fields go away with it. `formatDuration` already exists in this file. Nothing in `src/styles/main.css` needs to change — `.welcome-stat-sub` is already styled.

`src/ui/UIManager.ts`'s `welcome_back` handler needs no change (it reads `data.result.elapsedSeconds`).

### 2.8 Requirement 1 restated as an invariant

> **Offline always runs at 1x.**

The mechanism is that `WaveState.elapsed` — and therefore `WaveTimingState.avgWaveSeconds` — is measured on the **simulation** clock, while `computeOfflineProgress` divides a **wall-clock** absence by it. A player at 1.5x clears a 60 s wave in 40 s of wall clock; the recorded sample is still 60, and an 8 h absence still pays `28800 / 62` repeats rather than `28800 / 42`.

Two rules follow, both worth a comment in the code and a test in §6:

- **Nothing in the offline path may read `Game.getSpeed()`, `speedIndex`, or `GAME_SPEEDS`.** `SaveManager` does not import from `Game`, so this is enforced by construction; keep it that way.
- **Nothing may feed wall-clock `realDt` into `WaveManager.tick`.** `Game.update` passes the simulation `dt`; `tickWallClockSystems` must not be given the wave manager.

### 2.9 Expected outcome

8 h absence, `goldMultiplier = 1`, measured wave duration equal to `expectedWaveSeconds`. "At wave" is the **last completed** wave — the one the absence repeats; a player showing wave 66 in the HUD is typically farming 65:

| At wave | Cycle | Waves paid (old → new) | Gold | Tower XP | Passive XP |
|---:|---:|---|---:|---:|---:|
| 21 | 55 s | 5000 → 130 | ÷39 | ÷27 | ÷26 |
| 41 | 44 s | 5000 → 164 | ÷30 | ÷40 | ÷32 |
| 65 | 54 s | 5000 → 133 | ÷38 | ÷70 | ÷54 |
| 99 | 70 s | 5000 → 102 | ÷49 | ÷131 | ÷93 |

"Waves paid" is `repeats × 0.25`: at wave 65 an 8 h absence is 533 repeats of a 54 s cycle, paid as 133 waves of income, against the 533 waves the same 8 h of active play would produce. That ratio *is* the offline fraction, and it is the one sentence the Welcome Back card has to be able to make truthfully.

Absolute figures for that wave-65 absence: **3.4 M gold, 57 K tower XP, 24 K passive XP**. Level 42→43 costs 30,680, so an overnight absence is worth roughly **1.8 tower levels**, down from the ~70 levels the old 5.94 M paid.

The divisor grows with depth on purpose: the old model's error was worst where the player is deepest, because that is where the 4.5 s floor was furthest from a real wave.

---

## 3. Equipment drops (requirement 5)

### 3.1 Diagnosis

Three multipliers stack: the per-kill chance ramps with wave, the number of eligible kills grows with wave, and a boss kill rolls `bossEncounterWeight(wave)` times. Depth therefore raises the drop *rate* three ways while also raising the *rarity* through `rollRarity(wave)` — gear should get better with depth, not more frequent.

### 3.2 The rule

> **At most one gear roll per source per wave, at a chance that does not grow with depth.** Depth still improves what drops, through `rollRarity`.

Guaranteed drops (the swift-kill boss reward, the Windfall milestone chest) bypass the budget — they are earned, not farmed.

### 3.3 `src/data/equipment.ts`

Replace the body of `rollDrop` with:

```ts
/**
 * Base drop chance for an *elite* kill (plans/economy.md §3).
 *
 * Flat in wave. It used to be `min(0.15, 0.04 + wave * 0.001 + bonus)`, which
 * ramped with depth on top of an elite population that itself grows with depth
 * — ~9.7 elites walk into a wave-65 wave, so the two ramps multiplied into
 * more than a piece of gear per wave before the boss even spawned.
 */
export const ELITE_DROP_CHANCE = 0.12;
export const ELITE_DROP_CHANCE_CAP = 0.25;

/** Base drop chance for a *boss* kill. Also flat; also capped. */
export const BOSS_DROP_CHANCE = 0.30;
export const BOSS_DROP_CHANCE_CAP = 0.60;

/** A milestone chest is the guaranteed source; it is not a chance roll. */
export const MILESTONE_DROP_CHANCE = 1.0;

export function rollDrop(
  wave: number,
  source: 'boss' | 'elite' | 'milestone',
  bonusChance = 0,
  options: DropOptions = {},
): Equipment | null {
  const boost = Math.max(0, options.rarityBoost ?? 0);
  const guaranteed = options.guaranteed === true;
  const bonus = Math.max(0, bonusChance);

  const chance = source === 'elite'
    ? Math.min(ELITE_DROP_CHANCE_CAP, ELITE_DROP_CHANCE + bonus)
    : source === 'boss'
      ? Math.min(BOSS_DROP_CHANCE_CAP, BOSS_DROP_CHANCE + bonus)
      : MILESTONE_DROP_CHANCE;

  if (!guaranteed && Math.random() > chance) return null;

  const rarity = upgradeRarity(rollRarity(wave), boost);
  // Only items whose minWave has been reached can drop; boss-only items are
  // additionally restricted to boss kills.
  let dropPool = EQUIPMENT_DEFS.filter(d => d.minWave <= wave);
  if (source !== 'boss') dropPool = dropPool.filter(d => !d.bossOnly);
  if (dropPool.length === 0) return null;
  const def = dropPool[Math.floor(Math.random() * dropPool.length)];
  return generateEquipment(def.id, rarity);
}
```

Note that the elite branch no longer has its own pool filter — the shared filter below it already excludes `bossOnly` for non-boss sources, and the duplicated code was the only reason elites and bosses could drift apart.

### 3.4 `src/systems/EquipmentManager.ts` — the per-wave budget

```ts
/**
 * Gear rolls one wave may spend, per source (plans/economy.md §3.2).
 *
 * One each. The *first* elite kill of a wave rolls for gear and the rest do
 * not; the boss gets its own roll. A miss spends the budget too — that is what
 * makes the expected value `1 x chance` rather than `elites x chance`, and it
 * is why the drop rate no longer grows with a wave's body count.
 */
const ROLLS_PER_WAVE: Record<'boss' | 'elite' | 'milestone', number> = {
  elite: 1,
  boss: 1,
  milestone: Number.POSITIVE_INFINITY,
};
```

Add to the class:

```ts
  /** Rolls already spent on the current wave, keyed by source. */
  private rollsThisWave: Record<string, number> = {};

  /** Called on `wave_started`: a new wave gets a fresh budget. */
  beginWave(): void {
    this.rollsThisWave = {};
  }
```

and gate `rollDrop`:

```ts
  rollDrop(
    wave: number,
    source: 'boss' | 'elite' | 'milestone',
    options: DropOptions = {},
  ): Equipment | null {
    // A guaranteed drop is a reward the player earned (a swift boss kill, a
    // Windfall chest), not a farm; it neither consumes nor respects the budget.
    if (options.guaranteed !== true) {
      const spent = this.rollsThisWave[source] ?? 0;
      if (spent >= ROLLS_PER_WAVE[source]) return null;
      this.rollsThisWave[source] = spent + 1;
    }
    const eq = dataRollDrop(wave, source, this.findChanceBonus, options);
    if (eq) {
      this.inventory.push(eq);
      this.bus.emit('equipment_dropped', { equipment: eq });
    }
    return eq;
  }
```

Also clear the budget in `reset()`: `this.rollsThisWave = {};`.

### 3.5 `src/game/Game.ts`

**(a)** Reset the budget when a wave starts. In the `wave_started` subscription (or immediately after `this.waveMgr.startWave` is reached through the bus — the existing `this.bus.on('wave_started', …)` handler is the right place):

```ts
      this.equipmentMgr.beginWave();
```

**(b)** The boss kill rolls **once**, not `bossEncounterWeight(wave)` times. In the `enemy_killed` handler's `e.type === 'boss'` branch, replace the loop

```ts
        const eqDrops: Equipment[] = [];
        for (let i = 0; i < bossEncounterWeight(this.waveMgr.currentWave); i++) {
          const eqDrop = this.equipmentMgr.rollDrop(this.waveMgr.currentWave, 'boss');
          if (eqDrop) eqDrops.push(eqDrop);
        }
```

with

```ts
        // One roll, not one per boss the encounter is "worth" (economy §3.5).
        // The weight exists so a lone boss carries the pack's HP, gold and XP;
        // multiplying the *gear* budget by it made a wave-70 boss worth eight
        // rolls at a 50% chance apiece.
        const eqDrops: Equipment[] = [];
        const eqDrop = this.equipmentMgr.rollDrop(this.waveMgr.currentWave, 'boss');
        if (eqDrop) eqDrops.push(eqDrop);
```

Keep the multi-drop toast branch — the swift-kill reward can still land a second piece in the same wave.

Remove the now-unused `bossEncounterWeight` import **only if** nothing else in `Game.ts` uses it (it is also used by the boss HP/gold paths — check before deleting).

### 3.6 Expected outcome

Expected pieces per 10-wave block (9 normal + 1 boss), `+0.10` find-chance bonus, excluding the swift-kill and Windfall guarantees:

| Waves | Old | New | Cut |
|---|---:|---:|---:|
| 21–30 | 3.0 | 2.6 | 1.2× |
| 41–50 | 8.9 | 2.6 | 3.4× |
| 61–70 | 18.2 | 2.6 | **7.0×** |
| 91–100 | 38.5 | 2.6 | 14.8× |
| 191–200 | 81.5 | 2.6 | 31.3× |

The new rate is flat by construction: `10 × min(0.25, 0.12 + bonus) + min(0.60, 0.30 + bonus)`. With no bonus it is 1.5 pieces per ten waves; fully invested it is 3.05. Early game is essentially untouched, which is the point — the runaway was entirely a depth effect.

---

## 4. XP faucets (requirement 6)

### 4.1 The shape change

Per-wave XP must stop growing faster than the level curve. The level curve grows at `1.028^L`; per-wave XP currently grows quadratically in `w`. The fix has two parts:

- **Kill XP scale becomes sub-linear** — `sqrt` instead of linear. The number of enemies in a wave is already linear in `w`, so a flat-ish per-kill payout keeps the *wave's* kill XP linear rather than quadratic.
- **Wave-clear XP becomes linear** instead of `w^1.5`.

### 4.2 `src/data/xpTables.ts`

```ts
/**
 * Per-kill XP grows with the **square root** of wave depth.
 *
 * It used to be `1 + 0.20 * wave` — linear — which, multiplied by an enemy
 * count that is itself linear in wave, made a wave's kill XP quadratic. The
 * level curve grows at 1.028 per level, so past ~wave 50 one wave was worth a
 * larger share of a level than the wave before it, and levelling accelerated
 * with depth instead of slowing. At 0.12 * sqrt(w - 1) a wave-65 kill is
 * ~2x a wave-1 kill instead of 14x, and a wave-200 kill ~2.7x instead of 41x.
 */
export const KILL_XP_WAVE_SLOPE = 0.12;

/** Wave-clear XP is now **linear** in depth; see `KILL_XP_WAVE_SLOPE`. */
export const WAVE_CLEAR_XP_BASE = 3;
export const WAVE_CLEAR_XP_EXPONENT = 1.0;
```

and

```ts
/** Per-kill wave scale. Sub-linear, so depth raises the roster's value gently. */
export function killXpWaveScale(wave: number): number {
  return 1 + KILL_XP_WAVE_SLOPE * Math.sqrt(Math.max(0, wave - 1));
}
```

`xpPerKill`, `xpPerWaveClear`, `pioneerBonusXp`, `passiveXpPerKill`, `passiveXpPerWaveClear` and `passiveWaveXpRef` all read these and need **no edit** — they inherit the new shape. `PIONEER_CLEAR_MULTIPLIER` stays at 2.0: a pioneer bonus pays once per wave ever and cannot be farmed, so it is the one XP source that should stay generous.

**Do not touch `XP_CURVE_BASE`, `XP_CURVE_POLY`, `XP_CURVE_GEO` or `TOWER_LEVEL_CAP`.** `TOWER_XP_TABLE` is derived from them and a saved `towerXp.xp` is re-levelled against it on load — changing the curve would silently move every existing player's level.

### 4.3 Expected outcome — tower XP

| Wave | Old total/wave | New total/wave | Cut |
|---:|---:|---:|---:|
| 1 | 7 | 8 | 0.9× |
| 5 | 39 | 26 | 1.5× |
| 10 | 97 | 48 | 2.0× |
| 20 | 296 | 116 | 2.6× |
| 40 | 1,018 | 249 | 4.1× |
| 65 | 2,374 | **427** | **5.6×** |
| 100 | 5,153 | 674 | 7.6× |
| 150 | 10,768 | 1,055 | 10.2× |
| 200 | 18,305 | 1,530 | 12.0× |

Per-kill for an ordinary enemy: wave 10 `3 → 1`, wave 40 `9 → 2`, wave 65 `14 → 2`, wave 200 `41 → 3`. A boss at wave 70: `1440 → 192`.

Waves-per-level along a plausible depth/level pairing, with no XP multipliers:

| Wave | Level | New XP/wave | Level cost | Waves per level |
|---:|---:|---:|---:|---:|
| 20 | 15 | 116 | 2,802 | 24 |
| 40 | 28 | 249 | 10,894 | 44 |
| 65 | 42 | 427 | 30,680 | **72** |
| 100 | 60 | 674 | 89,243 | 132 |

At wave 65 that is ~72 waves ≈ 65 minutes of active play per level before XP multipliers (a mid-run `xpGainMultiplier` of 2–2.5 brings it to ~30 waves), plus ~1.8 levels per overnight absence from §2.9. The curve now *decelerates* with depth, which is exactly requirement 6's "reduce xp gain increase considerably as wave progresses".

Early game is deliberately unchanged: at wave 1–5 the new numbers are within ±35% of the old, so onboarding pace is preserved.

### 4.4 Passive XP re-anchoring

Passive XP reads the same `killXpWaveScale`, so the *faucet* shrinks with the tower faucet. But so does `passiveWaveXpRef(w)` — the reference the requirement curve is priced against — so without a second edit the passive pace in *waves of play* would be unchanged. Requirement 6 asks for less passive XP too, so make the slowdown explicit and deliberate:

```ts
/** Waves of play at the unlock wave that level 1 of a passive is priced at. */
export const PASSIVE_XP_LEVEL_WAVES = 10;
```

(was 6 — a 1.67× slowdown), and re-derive every `xpBase` literal in `src/data/passiveAbilities.ts` as `round2sig(10 * passiveWaveXpRef(unlockWave))` with the **new** `killXpWaveScale`:

| Passive | `unlockWave` | new `passiveWaveXpRef` | old `xpBase` | **new `xpBase`** | error vs exact |
|---|---:|---:|---:|---:|---:|
| `passive_marksmanship` | 5 | 26.0 | 250 | **260** | −0.2% |
| `passive_fortitude` | 10 | 36.7 | 490 | **370** | +0.8% |
| `passive_scavenger` | 14 | 45.8 | 730 | **460** | +0.3% |
| `passive_haste` | 18 | 55.3 | 1000 | **550** | −0.6% |
| `passive_mana_spring` | 24 | 69.3 | 1500 | **690** | −0.5% |
| `passive_retribution` | 30 | 84.0 | 2100 | **840** | +0.1% |
| `passive_executioner` | 40 | 110.2 | 3400 | **1100** | −0.2% |
| `passive_treasury` | 48 | 133.1 | 4600 | **1300** | −2.3% |
| `passive_aegis_ward` | 58 | 162.0 | 6400 | **1600** | −1.2% |
| `passive_arcane_focus` | 65 | 182.3 | 7800 | **1800** | −1.3% |
| `passive_siege_doctrine` | 75 | 213.4 | 10000 | **2100** | −1.6% |
| `passive_prospector` | 88 | 256.4 | 14000 | **2600** | +1.4% |

Every error is inside the 15% band `tests/content-coverage.test.ts` asserts, and the column is strictly increasing by unlock wave, which the same file also asserts. Update the doc comment on `xpBase` in `src/data/passiveAbilities.ts` from "`round2sig(6 * passiveWaveXpRef(unlockWave))`" to "`round2sig(10 * passiveWaveXpRef(unlockWave))`".

Net effect on passives: level 1 now costs 10 waves at the unlock depth instead of 6 (×1.67 slower in live play), and an 8 h absence at wave 65 pays 23 K passive XP instead of 1.30 M (÷57).

---

## 5. Persistence

### 5.1 `src/types.ts`

Declare the interface here, next to `WaveState`, so `src/data/waveTiming.ts` and
`src/systems/SaveManager.ts` both import it from the same place and no import
cycle is possible (`data/` already imports `types`, never the reverse):

```ts
/**
 * Measured wave-clear times, in **simulation** seconds (plans/economy.md §2).
 *
 * Run-scoped: reset on ascension and transcendence, since the new run's tower
 * is not the old one's. The functions that read and write it live in
 * `src/data/waveTiming.ts`.
 */
export interface WaveTimingState {
  /** The most recently measured clear, in simulation seconds. 0 = never measured. */
  lastWaveSeconds: number;
  /** Running mean of the last `WAVE_TIMING_EMA_WINDOW` clears. 0 = never measured. */
  avgWaveSeconds: number;
  /** The wave `avgWaveSeconds` was last updated on, so a stale sample can be rescaled. */
  sampleWave: number;
  /** How many clears have fed the average. Caps the EMA warm-up. */
  samples: number;
}
```

Add to `GameState`:

```ts
  /** v23+: measured wave-clear times, used to pace offline progress. Run-scoped. */
  waveTiming: WaveTimingState;
```

### 5.2 `src/systems/SaveManager.ts`

```ts
const SAVE_VERSION = 23;
```

Add to `PersistentState`:

```ts
  /** v23+: measured wave-clear times (economy §2). Run-scoped; reset on ascend. */
  waveTiming?: WaveTimingState;
```

Add to `snapshot()`, after `pacing: this.snapshotPacing(state.pacing),`:

```ts
      waveTiming: { ...(state.waveTiming ?? defaultWaveTiming()) },
```

Add the migration:

```ts
/**
 * v23 (plans/economy.md §2): offline progress is now paced by a measured wave
 * duration instead of an 18 s average and a DPS walk. Nothing in an older save
 * carries that measurement, so the block starts empty and the first absence
 * after the update is priced from `expectedWaveSeconds` at half rate
 * (`UNMEASURED_WAVE_PENALTY`) until five waves have been cleared.
 */
function migrateV22toV23(data: Record<string, unknown>): void {
  data.waveTiming = defaultWaveTiming();
}
```

Wire it into `validate()`:

- accepted-version guard: add `&& data.version !== 22` to the long `if` chain.
- ladder: add `if (data.version === 22) { migrateV22toV23(data); data.version = 23; }`.
- fallback block: add `if (!isObject(d.waveTiming)) d.waveTiming = defaultWaveTiming();` and normalise the four numeric fields:

```ts
  const wt = d.waveTiming as Record<string, unknown>;
  for (const key of ['lastWaveSeconds', 'avgWaveSeconds', 'sampleWave', 'samples'] as const) {
    if (typeof wt[key] !== 'number' || !Number.isFinite(wt[key])) wt[key] = 0;
  }
```

---

## 6. Tests

### 6.1 Update existing assertions

| File | Line (approx) | Change |
|---|---|---|
| `tests/formulas.test.ts` | 219–222 | `xpPerKill('normal', 200)` is no longer `> 5x` wave 20, and `xpPerWaveClear(100)` is no longer `> 2x` wave 50. Rewrite as: deeper still pays *more* (`xpPerKill('normal', 200) > xpPerKill('normal', 20)`; `xpPerWaveClear(100) > xpPerWaveClear(50)`) and add the new invariant — depth pays **less than proportionally**: `xpPerKill('normal', 200) < xpPerKill('normal', 20) * 5` and `xpPerWaveClear(200) === xpPerWaveClear(100) * 2` (exactly linear). |
| `tests/save.test.ts` | 17 sites | `expect(loaded.version).toBe(22)` → `toBe(23)`. |
| `tests/cores.test.ts` | 587 | `toBe(22)` → `toBe(23)`. |
| `tests/save.test.ts` | 836–884 (`describe('offline passive XP')`) | Rewritten wholesale — see §6.3. |
| `tests/boss.test.ts` | 619–623 | "leaves the ordinary boss drop as a chance roll" still passes (0.30 chance ⇒ misses), but it calls `rollDrop(5, 'boss', 0)` 200 times; keep as is. |
| `sim/checks.ts` | 214 | `xpPerKill('normal', 50) > xpPerKill('normal', 10) * 1.5` → `2 > 1 * 1.5` still holds. Leave, but add the deceleration check from §6.2. |

### 6.2 New tests — XP shape (`tests/formulas.test.ts`)

```ts
it('decelerates XP gain with depth instead of accelerating it', () => {
  // Per-wave XP must grow slower than the level curve does, or a deeper wave
  // is worth a larger share of a level than a shallower one — the bug this
  // rebalance closes (plans/economy.md §4).
  const waveXp = (w: number) =>
    enemyCountForWave(w) * xpPerKill('normal', w) + xpPerWaveClear(w);
  const share = (w: number, l: number) => waveXp(w) / xpForNextLevel(l);
  expect(share(100, 60)).toBeLessThan(share(40, 28));
  expect(share(200, 100)).toBeLessThan(share(100, 60));
});

it('keeps a deep kill within a small multiple of a shallow one', () => {
  expect(xpPerKill('normal', 200)).toBeLessThanOrEqual(xpPerKill('normal', 1) * 4);
});
```

### 6.3 New tests — offline (`tests/save.test.ts`)

Two prerequisites:

- `makeState()` in this file must gain `waveTiming: defaultWaveTiming(),`.
- `averageKillGoldForWave` and `averageKillXPForWave` in `SaveManager.ts` must be
  **exported** (they are module-private today). The tests below assert the exact
  payout rather than an approximation, which is what makes the 0.25 dial itself
  testable.

Replace the `offline passive XP` describe block with:

```ts
// W is the **last completed** wave throughout — the wave an absence repeats.
// The payout tests save the state standing on `W + 1`, so that a test which
// passes proves the payout came from the completed wave and not from the one
// in progress. 33 is a non-boss wave, which is what `WaveManager` records.
const W = 33;
const CYCLE_INTERMISSION = intermissionSecondsForWave(W); // 3 s at wave 33

describe('offline progress', () => {
  function offlineState(wave: number, timing?: Partial<WaveTimingState>): GameState {
    const s = makeState();
    s.wave = { ...s.wave, number: wave, highestWave: wave, elapsed: 0 };
    s.stats = { ...s.stats, lifetimeHighestWave: wave };
    s.passiveAbilities = { passive_marksmanship: { level: 0, xp: 0, unlocked: true } };
    s.waveTiming = { ...defaultWaveTiming(), ...timing };
    return s;
  }

  async function offlineAt(
    wave: number, hours: number, timing?: Partial<WaveTimingState>,
  ): Promise<OfflineResult> {
    const mgr = new SaveManager(stubBus, { getRP: () => 0 });
    await mgr.hydrate();
    mgr.save(offlineState(wave, timing));
    const persisted = mgr.load()!;
    persisted.savedAt -= hours * 3600 * 1000;
    return mgr.computeOfflineProgress(persisted, 1);
  }

  /**
   * A fully warmed-up timing block: `wave` is the last wave completed and
   * `seconds` is what it took. `W` is used as the last completed wave in the
   * payout tests below, so the wave standing in the HUD is irrelevant to them
   * — which is the property being asserted.
   */
  const timed = (seconds: number, wave: number) => ({
    lastWaveSeconds: seconds, avgWaveSeconds: seconds, sampleWave: wave, samples: 5,
  });

  it('repeats the last completed wave, not the one in progress', async () => {
    // Standing on wave 40 having last cleared 39: the absence farms 39.
    const r = await offlineAt(40, 12, timed(60, 39));
    expect(r.wave).toBe(39);
    expect(r.waveSeconds).toBeCloseTo(60, 5);
  });

  it('never advances past the wave it repeats', async () => {
    const short = await offlineAt(W, 1, timed(60, W - 1));
    const long = await offlineAt(W, 96, timed(60, W - 1));
    expect(short.wave).toBe(W - 1);
    expect(long.wave).toBe(W - 1);
  });

  it('falls back to the current wave, stepped off a boss, before the first clear', async () => {
    // No sample at all: wave 30 is a boss, so the estimate prices wave 29.
    const r = await offlineAt(30, 4);
    expect(r.wave).toBe(29);
    expect(r.measured).toBe(false);
  });

  it('never repeats a boss wave, because one is never recorded', async () => {
    // `WaveManager` excludes boss clears from the sample (§2.3), so a boss
    // number can only reach `sampleWave` through a corrupt save. Guard anyway.
    const r = await offlineAt(41, 8, timed(60, 39));
    expect(isBossWave(r.wave)).toBe(false);
  });

  it('pays the fraction of a wave an absence did not finish', async () => {
    // 90 s away against a 60 s wave + 3 s intermission => 90 / 63 = 1.43 repeats.
    const r = await offlineAt(W + 1, 90 / 3600, timed(60, W));
    expect(r.waveRepeats).toBeCloseTo(90 / (60 + CYCLE_INTERMISSION), 3);
    expect(r.waveRepeats).toBeGreaterThan(1);
    expect(r.waveRepeats).toBeLessThan(2);
  });

  it('scales linearly with the absence', async () => {
    const short = await offlineAt(W + 1, 4, timed(60, W));
    const long = await offlineAt(W + 1, 8, timed(60, W));
    expect(long.goldEarned / short.goldEarned).toBeCloseTo(2, 1);
    expect(long.xpEarned / short.xpEarned).toBeCloseTo(2, 1);
  });

  it('is inversely proportional to the measured wave duration', async () => {
    const fast = await offlineAt(W + 1, 8, timed(30, W));
    const slow = await offlineAt(W + 1, 8, timed(60, W));
    expect(fast.waveRepeats / slow.waveRepeats)
      .toBeCloseTo((60 + CYCLE_INTERMISSION) / (30 + CYCLE_INTERMISSION), 1);
  });

  it('pays exactly a quarter of one wave of income per repeat', async () => {
    const r = await offlineAt(W + 1, 8, timed(60, W));
    const count = Math.max(1, Math.floor(spawnCountForWave(W)));
    const perWaveXp = averageKillXPForWave(W) * count + xpPerWaveClear(W);
    const perWaveGold = averageKillGoldForWave(W) * count;
    expect(r.xpEarned).toBe(Math.floor(perWaveXp * r.waveRepeats * 0.25));
    expect(r.goldEarned).toBe(Math.floor(perWaveGold * r.waveRepeats * 0.25));
  });

  it('halves the payout when no wave has ever been timed', async () => {
    const measured = await offlineAt(W, 8, timed(expectedWaveSeconds(W), W));
    const guessed = await offlineAt(W, 8);
    expect(guessed.measured).toBe(false);
    expect(measured.measured).toBe(true);
    expect(guessed.waveSeconds).toBeCloseTo(measured.waveSeconds, 3);
    expect(guessed.goldEarned / measured.goldEarned).toBeCloseTo(0.5, 2);
  });

  it('floors the fallback estimate with the part of the wave already fought', async () => {
    // Only reachable before the run's first clear, which is the one time the
    // in-progress wave is all the evidence there is.
    const mgr = new SaveManager(stubBus, { getRP: () => 0 });
    await mgr.hydrate();
    const s = offlineState(W);                // no timing samples
    s.wave = { ...s.wave, elapsed: 300 };     // five minutes in, never finished
    mgr.save(s);
    const persisted = mgr.load()!;
    persisted.savedAt -= 8 * 3600 * 1000;
    const r = mgr.computeOfflineProgress(persisted, 1);
    expect(r.measured).toBe(false);
    expect(r.waveSeconds).toBeGreaterThanOrEqual(300);
  });

  it('ignores the in-progress wave once a wave has been completed', async () => {
    const mgr = new SaveManager(stubBus, { getRP: () => 0 });
    await mgr.hydrate();
    const s = offlineState(W, timed(60, W - 1));
    s.wave = { ...s.wave, elapsed: 900 };     // stuck fifteen minutes into wave W
    mgr.save(s);
    const persisted = mgr.load()!;
    persisted.savedAt -= 8 * 3600 * 1000;
    const r = mgr.computeOfflineProgress(persisted, 1);
    expect(r.wave).toBe(W - 1);
    expect(r.waveSeconds).toBeCloseTo(60, 5);  // the measurement, not the stall
  });

  it('leaves an absence shorter than one wave paying a partial wave, not zero', async () => {
    const r = await offlineAt(W + 1, 20 / 3600, timed(120, W));
    expect(r.waveRepeats).toBeGreaterThan(0);
    expect(r.waveRepeats).toBeLessThan(1);
    expect(r.goldEarned).toBeGreaterThan(0);
  });
});
```

### 6.4 New tests — wave timing (`tests/formulas.test.ts` or a new `tests/wave-timing.test.ts`)

```ts
it('averages the last five clears and tracks a tower getting stronger', () => {
  const t = defaultWaveTiming();
  for (const s of [100, 100, 100, 100, 100]) recordWaveTime(t, 33, s);
  expect(t.avgWaveSeconds).toBeCloseTo(100, 5);
  for (let i = 0; i < 20; i++) recordWaveTime(t, 33, 20);
  expect(t.avgWaveSeconds).toBeLessThan(25);
});

it('clamps a nonsense measurement instead of poisoning the average', () => {
  const t = defaultWaveTiming();
  recordWaveTime(t, 33, 0.001);
  expect(t.avgWaveSeconds).toBe(MIN_WAVE_SECONDS);
  recordWaveTime(t, 33, Number.POSITIVE_INFINITY);
  expect(t.avgWaveSeconds).toBeLessThanOrEqual(MAX_WAVE_SECONDS);
});

it('returns the last completed wave and its own clear time, whatever wave is live', () => {
  const t = defaultWaveTiming();
  recordWaveTime(t, 33, 60);
  // The live wave is irrelevant once something has been completed.
  for (const live of [34, 40, 91, 1]) {
    const target = offlineWaveTarget(t, live);
    expect(target.wave).toBe(33);
    expect(target.seconds).toBeCloseTo(60, 5);
    expect(target.measured).toBe(true);
  }
});

it('falls back to the live wave, off a boss, only until the first clear', () => {
  const t = defaultWaveTiming();
  const before = offlineWaveTarget(t, 30);          // boss wave, no samples
  expect(before.wave).toBe(29);
  expect(before.measured).toBe(false);
  expect(before.seconds).toBeCloseTo(expectedWaveSeconds(29), 5);

  recordWaveTime(t, 29, 45);
  const after = offlineWaveTarget(t, 30);
  expect(after.wave).toBe(29);
  expect(after.seconds).toBeCloseTo(45, 5);
  expect(after.measured).toBe(true);
});

it('floors the fallback with the in-progress wave, but never a measurement', () => {
  const t = defaultWaveTiming();
  expect(offlineWaveTarget(t, 33, 300).seconds).toBeGreaterThanOrEqual(300);
  recordWaveTime(t, 33, 45);
  expect(offlineWaveTarget(t, 33, 300).seconds).toBeCloseTo(45, 5);
});
```

### 6.5 New tests — equipment budget (`tests/loot.test.ts` or `tests/boss.test.ts`)

```ts
it('spends at most one elite roll and one boss roll per wave', () => {
  const mgr = new EquipmentManager([], {}, new EventBus());
  mgr.beginWave();
  const elite = Array.from({ length: 50 }, () => mgr.rollDrop(65, 'elite'));
  expect(elite.filter(Boolean).length).toBeLessThanOrEqual(1);
  const boss = Array.from({ length: 50 }, () => mgr.rollDrop(65, 'boss'));
  expect(boss.filter(Boolean).length).toBeLessThanOrEqual(1);
  // A new wave gets a fresh budget, so two waves can yield at most two elite
  // pieces however many elites die in them.
  mgr.beginWave();
  const nextWave = Array.from({ length: 50 }, () => mgr.rollDrop(65, 'elite'));
  expect(nextWave.filter(Boolean).length).toBeLessThanOrEqual(1);
  expect(mgr.inventoryList.length).toBeLessThanOrEqual(4); // 2 elite + 2 boss ceilings
});

it('lets a guaranteed drop through a spent budget', () => {
  const mgr = new EquipmentManager([], {}, new EventBus());
  mgr.beginWave();
  for (let i = 0; i < 10; i++) mgr.rollDrop(65, 'boss');
  expect(mgr.rollDrop(65, 'boss', { guaranteed: true })).not.toBeNull();
});

it('does not raise the drop chance with depth', () => {
  // The rate is flat in wave; only rarity moves with depth.
  const rate = (wave: number) => {
    let hits = 0;
    for (let i = 0; i < 4000; i++) if (rollDrop(wave, 'elite', 0) !== null) hits += 1;
    return hits / 4000;
  };
  expect(Math.abs(rate(20) - rate(150))).toBeLessThan(0.04);
});
```

### 6.6 New test — offline is speed-independent

```ts
it('prices offline in simulation seconds, so game speed cannot buy income', async () => {
  // A 1.5x player clears a 60 s (simulation) wave in 40 s of wall clock. The
  // recorded sample is the simulation figure, so the same absence pays the same
  // whatever the speed dial says (plans/economy.md §2.8).
  const r = await offlineAt(W, 8, timed(60, W));
  const cycle = 60 + intermissionSecondsForWave(W);
  expect(r.waveRepeats).toBeCloseTo((8 * 3600) / cycle, 1);
});
```

---

## 7. Documentation

| File | Change |
|---|---|
| `docs/save-system.md` | Rewrite the whole "Offline Progress" section against §2 (it currently documents a 70%-efficiency DPS walk and an 18 s average wave, both already stale). Add the v22 → v23 row to the migration table. Update "version is 2..21" to "2..23". |
| `docs/save-system.md` | "Welcome Back Modal" bullet list: duration, gold, **wave repeats at the last completed wave, with its clear time**, tower XP, capped notice. Drop "waves cleared" and "effective DPS". |
| `docs/wave-system.md` | New short section: the wave clock, what it measures (simulation seconds), which clears count as a fair sample (natural clear, non-boss, no mutator), and that the last such clear is both the wave offline repeats and the duration it is priced at. Note that the clock now pauses with the modal pauses. |
| `docs/equipment-system.md` | Rewrite "Drops": flat per-source chances (`ELITE_DROP_CHANCE` 0.12/cap 0.25, `BOSS_DROP_CHANCE` 0.30/cap 0.60), one roll per source per wave, guaranteed sources bypass the budget, depth moves rarity not rate. |
| `docs/xp-talent-system.md` | "Kill XP": `killXpWaveScale(wave) = 1 + 0.12 * sqrt(wave - 1)` and why it is sub-linear. "Wave-clear XP": `3 * wave`, linear. Delete the "superlinear: clearing deep waves is the real faucet" claim. |
| `docs/passive-system.md` | `PASSIVE_XP_LEVEL_WAVES` is 10; level 1 costs ten waves of play at the unlock depth. |
| `docs/loot-system.md` | Update the idle-parity paragraph if it quotes the old offline efficiency. |
| `AGENTS.md` | "Save version | 21" → 23 in the content table (it is already stale by two). |

---

## 8. Task order and verification

### 8.1 Order

1. `src/data/waveTiming.ts` (new file, no dependents yet).
2. `src/types.ts` — `waveTiming` on `GameState`.
3. `src/systems/WaveManager.ts` — pause-aware clock + `wave_timed`.
4. `src/game/Game.ts` — subscribe, initialise, restore, reset.
5. `src/systems/SaveManager.ts` — v23, `PersistentState`, `snapshot`, migration, `OfflineResult`, `computeOfflineProgress`.
6. `src/game/Game.ts` — delete `applyOfflineWave`, fix both `welcome_back` emits.
7. `src/ui/WelcomeBackModal.ts`.
8. `src/data/equipment.ts` + `src/systems/EquipmentManager.ts` + the two `Game.ts` call-site edits.
9. `src/data/xpTables.ts`.
10. `src/data/passiveAbilities.ts` — the twelve `xpBase` literals.
11. Tests (§6), then docs (§7).

Steps 1–7 are independent of 8, and 8 is independent of 9–10, so they can be reviewed as three separate commits: **offline**, **equipment**, **XP**.

### 8.2 Gates

```bash
npm run typecheck && npm run lint && npm run test && npm run checks && npm run sim
```

`npm run sim` will report shifted curves; that is expected. Read its before/after tables and confirm the direction matches §2.9, §3.6 and §4.3 rather than assuming the numbers are wrong.

### 8.3 Manual verification

1. Start a run, reach wave ~25, clear five waves. Confirm `gameState.waveTiming.samples === 5`, `sampleWave` equals the last wave you actually finished, and `avgWaveSeconds` is within a few seconds of the stopwatch.
2. Set the game speed to 1.5x, clear five more waves, and confirm `avgWaveSeconds` did **not** drop by a third. This is requirement 1.
3. Hide the tab for 10 minutes, return, and check the Welcome Back card: the wave named must be the **last one you completed** (one behind the HUD if a wave was in progress), the repeat count must be ≈ `600 / (avgWaveSeconds + intermission)`, and the run must resume on the wave it was on, unchanged (requirement 2).
4. Clear a wave, then let the *next* wave run for a long time without finishing it and close the app. On reload the card must still name the completed wave and its clear time — the stalled wave must not appear in the estimate at all.
5. Edit the save's `savedAt` back 8 hours and reload. Gold, tower XP and passive XP should all be ~25% of what the same period of active play at that wave would produce (requirement 3).
6. On a **fresh run** (ascend, so `waveTiming` resets), close the app mid-wave with `wave.elapsed` around 60 s on a wave that normally takes 40 s; confirm `result.waveSeconds >= 60`, `result.measured === false`, and the payout is halved (requirement 4's estimate clause).
7. Play waves 60–70 and count gear drops. Expect ~2–3 pieces across the ten waves, up to ~5 with a swift boss kill and a Windfall chest (requirement 5).
8. Note the tower level at wave 60 and again at wave 70. Expect well under one level gained across those ten waves before multipliers (requirement 6).

---

## 9. Tuning levers

Change one at a time; each has a single home.

| Lever | File | Now | Effect |
|---|---|---|---|
| `OFFLINE_YIELD_FRACTION` | `SaveManager.ts` | 0.25 | Every offline payout, linearly. Raise if overnight absences feel dead. |
| `UNMEASURED_WAVE_PENALTY` | `waveTiming.ts` | 0.5 | Only the first absence of a new run, before five waves are timed. |
| `WAVE_TIMING_EMA_WINDOW` | `waveTiming.ts` | 5 | How fast the average follows a tower that just got stronger. Set it to 1 to price offline off `lastWaveSeconds` — the single most recent clear — instead of a smoothed mean. |
| `ELITE_DROP_CHANCE` / `BOSS_DROP_CHANCE` | `equipment.ts` | 0.12 / 0.30 | Gear rate, flat across all depths. |
| `ROLLS_PER_WAVE` | `EquipmentManager.ts` | 1 / 1 | The hard ceiling. Raising elite to 2 doubles the non-boss rate. |
| `KILL_XP_WAVE_SLOPE` | `xpTables.ts` | 0.12 | How much depth is worth per kill. `sqrt` shape; halving it flattens further. |
| `WAVE_CLEAR_XP_BASE` | `xpTables.ts` | 3 | The per-wave floor, linear in depth. The main dial for early-game pace. |
| `PASSIVE_XP_LEVEL_WAVES` | `xpTables.ts` | 10 | Passive pace **only**. Changing it means re-deriving the twelve `xpBase` literals in §4.4. |

Two things deliberately **not** dials: `XP_CURVE_*` (moving them re-levels every existing save) and `PIONEER_CLEAR_MULTIPLIER` (a once-per-wave-ever reward that cannot be farmed).
