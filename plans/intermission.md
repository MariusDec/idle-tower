# Scheduled intermission — implementation plan

Status: **not started**. Everything below is a spec; nothing has been implemented.

---

## 0. What this changes, in one paragraph

Today a wave ends when the field is empty, and then a **constant** intermission runs
(`5s`, shortened to `3s` past wave 20 and `2s` past wave 50, times the
`intermissionMultiplier` stat). The player is never told when the next wave arrives, and the
"Call" button only unlocks once every enemy has spawned.

After this change, at the moment a wave starts the game **computes when that wave's last
enemy is expected to be dealt with** (from the roster it already rolled: each entry's spawn
time plus its walk-in time from its own spawn point), adds a tail, and stores that as the
wave's **schedule**. The intermission is then whatever is left of that schedule when the
field actually clears — so the countdown the player sees is the real number of seconds until
the next wave, not a constant 5. The "Call" button unlocks at `min(15s, last-spawn-time)`
instead of "once the roster is out".

**The next wave still never starts before the current wave is cleared.** The schedule is a
*deadline the intermission is measured against*, not a hard timer that spawns wave *N+1* on
top of wave *N*. This is deliberate — see §9.

---

## 1. Rules being implemented (the acceptance criteria)

1. **R1 — Schedule computed at wave start.** When `startWave(N)` runs, compute
   `waveDeadline` = seconds from now until wave *N+1* is due. It is derived from the actual
   rolled roster (§3).
2. **R2 — Call unlocks at `min(15, lastSpawnAt)`.** Wave 1's last enemy spawns at 8.3s, so
   Call unlocks at 8.3s. Wave 25's last enemy spawns at 32.5s, so Call unlocks at 15s — with
   enemies still queued, which is new and requires the carry-over rule in §5.
3. **R3 — Truthful countdown.** The intermission banner shows the real remaining seconds
   (which now varies per wave, roughly 2–12s), and a live wave shows "Next wave in Ns" once
   the countdown is meaningful.
4. **R4 — Boss waves are different.** A boss wave has **no** schedule (`waveDeadline =
   Infinity`); it stays purely clear-gated and gets a fixed tail after the boss dies.
5. **R5 — Never before the clear.** The next wave still requires
   `enemiesSpawned >= enemiesToSpawn && aliveCount() === 0`, exactly as today. The only path
   that starts a wave with enemies alive is the player pressing Call — unchanged.

---

## 2. New constants

**File: `src/data/pacing.ts`** — add at the end of the `§7.6 Intermission length` section,
*after* the existing `intermissionFactorForWave`.

```ts
/**
 * Seconds of breathing room between the last enemy being dealt with and the
 * next wave arriving (§7.6, scheduled-intermission revision).
 *
 * The wave's schedule is `estimated last arrival + this * intermissionMultiplier`.
 * Eight seconds at wave 1 is ~4.8s past wave 20 and ~3.2s past wave 50, because
 * `intermissionFactorForWave` already carries the wave-depth shortening.
 */
export const WAVE_TAIL_SECONDS = 8;

/**
 * Floor on the intermission when a wave overruns its own schedule.
 *
 * The schedule assumes the tower keeps up. A wave that took longer has already
 * spent its tail, but zero seconds between waves reads as a bug, so it still
 * gets this much.
 */
export const MIN_INTERMISSION_SECONDS = 2;

/**
 * Walk-in time the *balance model* assumes, in seconds.
 *
 * The game computes walk-in per enemy from its own spawn point (`WaveManager`);
 * `sim/model.ts` has no spawn points, so it uses this flat approximation. It is
 * the mid-run mean of the real figure, which runs ~6.9s at wave 1 down to ~1.5s
 * at wave 99 as enemies get faster and tower range grows.
 */
export const NOMINAL_WALK_IN_SECONDS = 4;

/**
 * What one wave cycle costs an idle run beyond its spawn cadence — the sim's
 * stand-in for the scheduled intermission.
 */
export function nominalWaveTailSeconds(wave: number): number {
  return NOMINAL_WALK_IN_SECONDS + WAVE_TAIL_SECONDS * intermissionFactorForWave(wave);
}
```

**Do NOT change** `BASE_INTERMISSION_SECONDS` (`= 5`), `intermissionSecondsForWave`, or
`intermissionFactorForWave`. `BASE_INTERMISSION_SECONDS` survives purely as the divisor that
turns `intermissionSecondsForWave` into the `intermissionMultiplier` ratio
(`5 → 1.0`, `3 → 0.6`, `2 → 0.4`). `tests/pacing.test.ts:578-594` asserts exactly that
relationship and must keep passing untouched.

`EARLY_CALL_DELAY_SECONDS` (15) and `EARLY_CALL_WINDOW_SECONDS` (15) keep their values but
change meaning slightly — update their doc comments per §4.6.

---

## 3. The schedule calculation

### 3.1 Inputs, all already available inside `WaveManager`

| Input | Where it comes from |
|---|---|
| `entries` | `this.spawnQueue` after `startWave` assembles it — each entry has `type`, `x`, `y` |
| `interval` | `this.state.spawnInterval` = `spawnIntervalForWave(wave)` |
| first spawn delay | the literal `0.5` currently assigned to `this.state.spawnTimer` in `startWave` |
| arena centre | `this.width / 2`, `this.height / 2` (the tower is always at the centre) |
| enemy speed | `enemySpeedForWave(ENEMY_DEFS[type].baseSpeed, wave)` × `this.enemies.getWaveMultipliers().speed` |
| contact radius | `TOWER_HIT_RADIUS + ENEMY_DEFS[type].radius + ENEMY_GAP` |
| tower range | new field `this.towerRange`, pushed in by `Game` (§6.1); defaults to `0` |

### 3.2 Formulas

For roster entry at index `i` (0-based, in spawn order):

```
spawnAt(i)   = FIRST_SPAWN_DELAY + i * interval          // FIRST_SPAWN_DELAY = 0.5
dist(i)      = hypot(entry.x - cx, entry.y - cy)
stopAt(i)    = max(TOWER_HIT_RADIUS + ENEMY_DEFS[type].radius + ENEMY_GAP, towerRange)
speed(i)     = max(1, enemySpeedForWave(ENEMY_DEFS[type].baseSpeed, wave) * speedMult)
walkIn(i)    = max(0, dist(i) - stopAt(i)) / speed(i)
arrival(i)   = spawnAt(i) + walkIn(i)

lastArrival  = max over all i of arrival(i)
waveDeadline = lastArrival + WAVE_TAIL_SECONDS * intermissionMultiplier
```

Notes the implementer must not "improve" away:

- **`max` over *all* entries, not the last one.** A slow tank rolled at index 5 with a far
  spawn point can arrive after a fast enemy rolled last.
- **`stopAt` uses `max(contact, towerRange)`** because the tower kills at range: an enemy
  never has to walk closer than `range` to die. This is what stops an over-levelled player
  from waiting through dead air.
- **Ignore** enrage speed, chill, haste auras, burrow/flee multipliers, and splitter
  children. They are mid-encounter effects; this is a spawn-time estimate.
- **`fast` pack members** already have distinct indices in the queue, so their staggered
  spawn times fall out of the formula automatically.
- Boss waves never reach this function (R4).

### 3.3 Worked numbers (16:9 world = 3328 × 1872, spawn ellipse radii 1731 × 973)

`dist` ranges 973 (top/bottom) to 1731 (left/right), mean ≈ 1379. The table uses the
worst-case 1731 for `lastArrival`, which is the pessimistic end of what the real `max` will
produce.

| Wave | enemies | interval | lastSpawnAt | **Call unlocks** | lastArrival | tail | **waveDeadline** |
|---|---|---|---|---|---|---|---|
| 1 | 5 | 1.96 | 8.3 | **8.3** | 17.5 | 8.0 | **25.5** |
| 3 | 7 | 1.88 | 11.8 | **11.8** | 20.4 | 8.0 | **28.4** |
| 5 | 9 | 1.80 | 14.9 | **14.9** | 23.0 | 8.0 | **31.0** |
| 9 | 14 | 1.64 | 21.8 | **15.0** | 29.1 | 8.0 | **37.1** |
| 15 | 21 | 1.40 | 28.5 | **15.0** | 34.7 | 8.0 | **42.7** |
| 21 | 29 | 1.16 | 33.0 | **15.0** | 38.4 | 4.8 | **43.2** |
| 25 | 33 | 1.00 | 32.5 | **15.0** | 37.5 | 4.8 | **42.3** |
| 35 | 45 | 0.60 | 26.9 | **15.0** | 31.0 | 4.8 | **35.8** |
| 39 | 50 | 0.44 | 22.1 | **15.0** | 25.9 | 4.8 | **30.7** |
| 49 | 62 | 0.40 | 24.9 | **15.0** | 28.1 | 4.8 | **32.9** |
| 61 | 77 | 0.40 | 30.9 | **15.0** | 33.6 | 3.2 | **36.8** |
| 99 | 122 | 0.40 | 48.9 | **15.0** | 51.2 | 3.2 | **54.4** |

Tower range assumed 300 (wave 1) rising to 655 (the `ARENA_RANGE_CAP`) by wave 99.

**Sanity check against today:** a wave-25 cycle is ~37s of fighting + 3s intermission = 40s
today, and 42.3s scheduled. A wave-99 cycle is ~51s + 2s = 53s today, 54.4s scheduled.
Overall pacing is preserved to within a couple of seconds; nothing here should move the
balance model materially.

### 3.4 Boss waves (R4)

Boss waves set `waveDeadline = Infinity` and are not scheduled at all. Rationale: a boss's
kill time is dominated by the fight, not the walk-in — `expectedWaveSeconds` budgets a wave-10
boss 56s and a wave-100 boss 308s, so any schedule built from that would leave a player who
kills the boss in 20s staring at a minute of dead air.

Instead, after a boss wave clears the intermission is exactly `WAVE_TAIL_SECONDS *
intermissionMultiplier` (8s at wave 10, 4.8s at waves 20–50, 3.2s past 50), and the countdown
starts at the clear. This is the same shape as today, just longer.

---

## 4. `src/systems/WaveManager.ts`

> ⚠️ **`impact({target: "startWave", direction: "upstream"})` reports risk `HIGH`** — 4 direct
> callers, 9 impacted symbols, 2 execution flows (`Game.simulate`, `main.bootstrap`), 3
> modules (Systems, Game, Ui). Re-run `detect_changes()` before committing.

### 4.1 New imports

```ts
import {
  enemyCountForWave,
  spawnCountForWave,
  isBossWave,
  spawnIntervalForWave,
  enemySpeedForWave,          // NEW
  enrageStacksFor,
  ENRAGE_DAMAGE_PER_STACK,
  ENRAGE_SPEED_PER_STACK,
  ENRAGE_STACK_INTERVAL,
} from '../data/formulas';
import { spawnPointOnEllipse } from '../data/arena';
import { TOWER_HIT_RADIUS } from '../data/tower';                       // NEW
import { ENEMY_BEHAVIOR, ENEMY_DEFS, spawnPoolForWave } from '../data/enemies';
import {
  BASE_INTERMISSION_SECONDS,
  EARLY_CALL_DELAY_SECONDS,
  EARLY_CALL_WINDOW_SECONDS,
  MIN_INTERMISSION_SECONDS,   // NEW
  WAVE_TAIL_SECONDS,          // NEW
  ENEMY_THREAT_CLASS,
} from '../data/pacing';
import { ENEMY_GAP } from './EnemyManager';                             // NEW — see 4.2
import type { EnemyManager } from './EnemyManager';
```

### 4.2 Export `ENEMY_GAP`

**File: `src/systems/EnemyManager.ts`, line 32.** Change:

```ts
const ENEMY_GAP = world(2);
```
to
```ts
/** Gap an enemy keeps off the tower's hit radius. Exported for `WaveManager`'s
 *  walk-in estimate, which has to reproduce `contactRadius` without an `Enemy`. */
export const ENEMY_GAP = world(2);
```

Nothing else in that file changes.

### 4.3 New module constant + replaced fields

Add near `WAVE_PREVIEW_LANE_MERGE`:

```ts
/**
 * Seconds before a wave's first enemy spawns.
 *
 * Was a bare `0.5` written twice in `startWave`; the schedule calculation has to
 * agree with it exactly, so it is a constant now.
 */
const FIRST_SPAWN_DELAY = 0.5;
```

Then replace `state.spawnTimer = 0.5` with `state.spawnTimer = FIRST_SPAWN_DELAY` in
`startWave` (the non-skip branch). Leave `makeInitialState` (`0.5`) and `startAtWave` (`0.4`)
alone — `makeInitialState` may use the constant too, `startAtWave` deliberately differs.

**Delete** the field `private earlyCallWindow = 0;` and every read/write of it.
**Keep** `private earlyCallOpened = false;`.

**Add** these fields:

```ts
/**
 * Tower range in world units, pushed in by `Game` whenever stats resolve.
 *
 * The walk-in estimate needs it because a tower kills at range: an enemy never
 * has to reach the contact radius to die, and pretending it does is what made a
 * strong build wait out dead air it had already earned past.
 */
private towerRange = 0;

/**
 * Seconds until wave N+1 is due, counted down every unpaused tick.
 *
 * `Infinity` means the wave is not scheduled — a boss wave (§3.4) or a wave
 * restored from a save, neither of which has a roster this manager can date.
 * It is deliberately not part of `WaveState`: a deadline that survived a reload
 * would be counting down a wave fought in a previous session.
 */
private waveDeadline = Infinity;

/** Seconds until the early-call window unlocks. See `openEarlyCallWindow`. */
private callUnlockIn = Infinity;

/**
 * Roster entries a mid-wave call left unspawned, carried into the next wave.
 *
 * The call now unlocks while enemies may still be queued (§R2), and dropping
 * them would hand out a wave's clear *and* delete the enemies that were meant
 * to pay for it. They are prepended to the next wave's queue instead.
 */
private carryOver: WavePlanEntry[] = [];
```

### 4.4 New private methods

Add these next to `openEarlyCallWindow`:

```ts
/** The pause between a wave being dealt with and the next one, in seconds. */
private tailSeconds(): number {
  return WAVE_TAIL_SECONDS * this.intermissionMultiplier;
}

/**
 * Seconds after this wave's start at which `entry` is expected to reach the
 * tower — or the tower's range ring, which is the same thing for a build that
 * can kill what it can see.
 *
 * A spawn-time estimate on purpose: enrage, chill, haste auras, burrow and flee
 * speeds all move an enemy that is already on the field, and folding them in
 * would make the wave's schedule drift under the countdown showing it.
 */
private estimateWalkIn(entry: WavePlanEntry, wave: number, speedMult: number): number {
  const def = ENEMY_DEFS[entry.type];
  const dist = Math.hypot(entry.x - this.width / 2, entry.y - this.height / 2);
  const contact = TOWER_HIT_RADIUS + def.radius + ENEMY_GAP;
  const stopAt = Math.max(contact, this.towerRange);
  const speed = Math.max(1, enemySpeedForWave(def.baseSpeed, wave) * speedMult);
  return Math.max(0, dist - stopAt) / speed;
}

/**
 * When wave N+1 is due, in seconds from wave N's start (plan `intermission.md` §3).
 *
 * The roster is already rolled by the time this runs, so this is a real
 * calculation over the enemies that will actually walk in — not an average over
 * a weight table. Returns the *maximum* arrival, because one slow tank rolled
 * into the middle of the roster outlasts everything spawned after it.
 */
private computeWaveDeadline(wave: number, entries: WavePlanEntry[], interval: number): number {
  if (entries.length === 0) return this.tailSeconds();
  const speedMult = this.enemies.getWaveMultipliers().speed;
  let lastArrival = 0;
  for (let i = 0; i < entries.length; i++) {
    const arrival = FIRST_SPAWN_DELAY + i * interval
      + this.estimateWalkIn(entries[i], wave, speedMult);
    if (arrival > lastArrival) lastArrival = arrival;
  }
  return lastArrival + this.tailSeconds();
}

/** The intermission a wave has earned: what is left of its schedule, floored. */
private scheduledIntermission(): number {
  if (!Number.isFinite(this.waveDeadline)) return this.tailSeconds();
  return Math.max(MIN_INTERMISSION_SECONDS, this.waveDeadline);
}
```

### 4.5 New public methods

```ts
/**
 * Tower range in world units, for the walk-in estimate. Pushed by `Game`
 * whenever stats resolve; 0 (the default) simply makes the estimate assume the
 * tower kills at contact.
 */
setTowerRange(range: number): void {
  this.towerRange = Math.max(0, range);
}

/**
 * Seconds until the next wave starts on its own, or `null` when nothing is
 * scheduled — a boss wave, or a wave that has already overrun its schedule and
 * is now waiting on the field being cleared.
 */
secondsToNextWave(): number | null {
  if (this.state.intermission) return Math.max(0, this.state.intermissionTimer);
  if (!Number.isFinite(this.waveDeadline) || this.waveDeadline <= 0) return null;
  return this.waveDeadline;
}
```

### 4.6 Rewritten early-call methods

```ts
/** Start the early-call window. Opens once per wave, and never re-opens. */
private openEarlyCallWindow(): void {
  if (this.earlyCallOpened) return;
  this.earlyCallOpened = true;
  this.callUnlockIn = 0;
}

/**
 * Seconds of window a call would bank — that is, the seconds it *saves*.
 *
 * The window used to be a fixed 15 s countdown that ran on its own clock. It is
 * now read straight off the wave's schedule, so the number on the button is the
 * number of seconds the player is actually skipping. `EARLY_CALL_WINDOW_SECONDS`
 * survives as the ceiling on one call's worth: `MOMENTUM_CAP` was measured
 * against a 15 s maximum (see `pacing.ts`), and a wave-25 schedule would
 * otherwise hand out 27 s in one press and pin momentum at its cap forever.
 */
earlyCallRemaining(): number {
  if (!this.earlyCallOpened) return 0;
  const saved = this.state.intermission
    ? this.state.intermissionTimer
    : (Number.isFinite(this.waveDeadline) ? this.waveDeadline : this.tailSeconds());
  return Math.max(0, Math.min(EARLY_CALL_WINDOW_SECONDS, saved));
}

/** The window's full length, for the readouts that draw it as a bar. */
earlyCallWindowLength(): number {
  return EARLY_CALL_WINDOW_SECONDS;   // unchanged
}
```

`canCallEarly()` is **unchanged**.

`maybeOpenEarlyCallWindow()` is **deleted** — the unlock is now the `callUnlockIn` countdown
in `tick`, plus the explicit `openEarlyCallWindow()` calls already in `concludeWave(true)` and
the skip branch. Remove its call site in `tick`.

Also update the two doc comments in `src/data/pacing.ts`:
- `EARLY_CALL_WINDOW_SECONDS`: note it is now the **ceiling** on one call's bank, not a
  countdown the game runs.
- `EARLY_CALL_DELAY_SECONDS`: note it is now the **ceiling** on the unlock time — the window
  opens at `min(this, the wave's last spawn)`, so a short early wave unlocks sooner and the
  "roster must be fully spawned" gate is gone (carry-over in §5 replaces it).

### 4.7 `startWave` — exact edit order

Current body, annotated with what changes:

```ts
startWave(wave: number): void {
  this.state.number = wave;
  this.thiefSpawnedThisWave = false;
  this.spawnQueue = [];
  this.earlyCallWindow = 0;                     // ← DELETE this line
  this.earlyCallOpened = false;
  this.callUnlockIn = Infinity;                 // ← ADD
  this.waveDeadline = Infinity;                 // ← ADD
  this.enemies.beginWave(wave);

  // ── skip branch ──
  if (!isBossWave(wave)
      && this.carryOver.length === 0            // ← ADD this clause
      && this.waveSkipChance > 0
      && Math.random() < this.waveSkipChance) {
    ...
    this.state.intermissionTimer = this.tailSeconds();   // ← was WAVE_INTERMISSION * this.intermissionMultiplier
    ...
    this.openEarlyCallWindow();
    ...
    return;
  }

  this.state.enemiesToSpawn = this.plannedCountFor(wave);
  const planned = this.plannedWave;
  this.spawnQueue = planned
    && planned.wave === wave
    && planned.entries.length === this.state.enemiesToSpawn
    ? planned.entries.slice()
    : this.buildRoster(wave, this.state.enemiesToSpawn);
  this.plannedWave = null;

  // ── ADD: merge the carry-over (§5) ──
  if (this.carryOver.length > 0) {
    this.spawnQueue = [...this.carryOver, ...this.spawnQueue];
    this.state.enemiesToSpawn += this.carryOver.length;
    this.carryOver = [];
    // Plan §2.4 still caps a wave at one thief; a merge can produce two.
    let seenThief = false;
    for (const e of this.spawnQueue) {
      if (e.type !== 'thief') continue;
      if (seenThief) e.type = 'normal';
      else seenThief = true;
    }
  }

  this.thiefSpawnedThisWave = this.spawnQueue.some(e => e.type === 'thief');
  this.state.spawnInterval = spawnIntervalForWave(wave);
  this.state.spawnTimer = FIRST_SPAWN_DELAY;    // ← was 0.5

  // ── ADD: the schedule (§3), computed after the queue is final ──
  const lastSpawnAt = FIRST_SPAWN_DELAY
    + Math.max(0, this.state.enemiesToSpawn - 1) * this.state.spawnInterval;
  this.callUnlockIn = Math.min(EARLY_CALL_DELAY_SECONDS, lastSpawnAt);
  this.waveDeadline = isBossWave(wave)
    ? Infinity
    : this.computeWaveDeadline(wave, this.spawnQueue, this.state.spawnInterval);

  this.state.spawning = true;
  ...rest unchanged...
}
```

Order matters: the carry-over merge must land **before** `enemiesToSpawn` is read for
`lastSpawnAt` and before `computeWaveDeadline`, and **after** the `planned.entries.length ===
this.state.enemiesToSpawn` check (otherwise a carried queue would make the check fail and
force a needless re-roll).

### 4.8 `tick` — replace the head and the unlock call

```ts
tick(dt: number): void {
  // ← DELETE the whole `if (this.earlyCallWindow > 0 && ...)` block at the top.

  if (this.state.intermission) {
    if (!this.intermissionPaused) {
      this.state.intermissionTimer -= dt;
      if (this.state.intermissionTimer <= 0) {
        const forceAdvance = isBossWave(this.state.number);
        this.startWave(this.state.number + (this.state.autoProgress || forceAdvance ? 1 : 0));
      }
    }
    return;
  }

  this.tickEnrage(dt);

  // ── ADD: the wave's own clocks. Both stop while a modal has paused the
  // spawner or the intermission, so a decision the player is reading does not
  // eat the schedule they were promised. ──
  if (!this.spawnPaused && !this.intermissionPaused) {
    if (this.callUnlockIn > 0) {
      this.callUnlockIn -= dt;
      if (this.callUnlockIn <= 0) this.openEarlyCallWindow();
    }
    if (Number.isFinite(this.waveDeadline)) {
      this.waveDeadline = Math.max(0, this.waveDeadline - dt);
    }
  }

  if (this.state.spawning && !this.spawnPaused) { ...unchanged... }

  // ← DELETE `this.maybeOpenEarlyCallWindow();`

  if (!this.state.spawning && ...aliveCount() === 0) {
    this.concludeWave(true);
  }
}
```

### 4.9 `concludeWave`

```ts
if (openIntermission) {
  this.state.intermission = true;
  this.state.intermissionTimer = this.scheduledIntermission();   // ← was WAVE_INTERMISSION * this.intermissionMultiplier
  this.openEarlyCallWindow();
}
```

`scheduledIntermission()` handles all three cases in one line: a normal wave cleared on time
gets what is left of its schedule; a wave that overran gets `MIN_INTERMISSION_SECONDS`; a boss
wave or a restored wave (`waveDeadline === Infinity`) gets `tailSeconds()`.

### 4.10 `callWaveEarly` — capture the leftovers

```ts
callWaveEarly(): number {
  if (!this.canCallEarly()) return 0;
  const banked = this.earlyCallRemaining();
  if (!this.state.intermission) {
    // The call now unlocks while the roster may still be spawning, so what is
    // left of it comes along rather than being deleted (§5).
    this.carryOver = this.spawnQueue.slice();
    this.spawnQueue = [];
    this.state.spawning = false;
    this.concludeWave(false);
  }
  this.state.intermissionTimer = 0;
  const forceAdvance = isBossWave(this.state.number);
  this.startWave(this.state.number + (this.state.autoProgress || forceAdvance ? 1 : 0));
  return banked;
}
```

### 4.11 `reset`, `startAtWave`, `setState`

All three currently do `this.earlyCallWindow = 0; this.earlyCallOpened = false;`. Replace with:

```ts
this.earlyCallOpened = false;
this.callUnlockIn = Infinity;
this.waveDeadline = Infinity;
this.carryOver = [];
```

For `reset()` and `startAtWave()` this is only a moment's state — both immediately fall into
the running wave with no roster of their own (they do not call `startWave`), so leaving the
deadline at `Infinity` makes them behave exactly as today: clear-gated, then `tailSeconds()`.

For `setState()` (a save load) `Infinity` is the correct and deliberate answer, for the same
reason the old `earlyCallWindow = 0` was: a restored wave has no roster to date a schedule
from. Extend the existing comment on that line to say so.

### 4.12 `WAVE_INTERMISSION`

The exported `WAVE_INTERMISSION` const at line 32 has no remaining reference after §4.7 and
§4.9. It is not imported anywhere else in `src/`, `tests/` or `sim/` (verified). **Delete it**
along with the now-unused `BASE_INTERMISSION_SECONDS` import.

---

## 5. Carry-over: calling a wave with enemies still queued

**Why it is needed.** R2 unlocks Call at `min(15, lastSpawnAt)`. From wave 9 onward
`lastSpawnAt > 15`, so the player can call at 15s with a dozen enemies never spawned. Today
that is impossible by construction (`maybeOpenEarlyCallWindow` requires
`enemiesSpawned >= enemiesToSpawn`), and the reason is spelled out in
`EARLY_CALL_DELAY_SECONDS`' doc comment: a call credits the wave as cleared, so calling with
enemies queued would hand out the clear *and* delete the enemies that pay for it.

**The rule.** Unspawned entries are not deleted; they are prepended to the next wave's spawn
queue and added to its `enemiesToSpawn` (§4.7, §4.10). Consequences, all intended:

- They spawn from their **original spawn points** but at the **new wave's** level, so they are
  slightly stronger and pay slightly more. That is the price and the reward of calling early
  with work outstanding.
- The new wave's `enemiesToSpawn` is larger, which correctly lengthens both its schedule
  (§3) and its enrage fuse (`enrageStacksFor` already takes `enemiesToSpawn`, exactly as it
  does for a Swarm mutator).
- The threat preview promised N enemies and the wave fields N + carry-over. This is
  acceptable: the preview is shown during the intermission, and the carry-over path is the
  player's own deliberate action taken after it.
- A wave with carry-over **cannot be skipped** by `waveSkipChance` (§4.7 adds the guard),
  because a skipped wave spawns nothing and the carried enemies would vanish.

---

## 6. `src/game/Game.ts`

### 6.1 Push the tower range (needed by §3.2)

In the stats-application method, next to the existing wave-manager pushes (currently around
line 4145):

```ts
this.waveMgr.setWaveSkipChance(stats.waveSkipChance);
this.waveMgr.setIntermissionMultiplier(stats.intermissionMultiplier);
this.waveMgr.setTowerRange(stats.range);            // ← ADD
```

`range` is a real key in `src/stats/keys.ts`. Verify the resolved stat object exposes it as
`stats.range` before relying on it; if the key is namespaced differently, use whatever the
same method already uses to feed the tower's range.

### 6.2 Surface the countdown

In `pacingHudSnapshot()` (around line 3241) add one field:

```ts
intermissionRemaining: this.waveMgr.intermissionRemaining(),
intermissionLength: intermissionSecondsForWave(this.waveMgr.currentWave),
secondsToNextWave: this.waveMgr.secondsToNextWave(),      // ← ADD
```

`pacingHudSnapshot` is rebuilt once per frame in `frameUpdate` and pushed via
`ui.setPacingData`, so this value is always current. **Do not** put it on `WaveControlAPI`
instead — that object is only refreshed by `syncUiApis` on events, and the countdown would
freeze.

Leave `intermissionLength` as it is; nothing reads it.

---

## 7. UI

### 7.1 `src/ui/PacingOverlay.ts`

Add to the `PacingHudData` interface, next to `intermissionRemaining`:

```ts
/** Seconds until the next wave starts on its own, or null when it waits on the clear. */
secondsToNextWave: number | null;
```

No rendering change in this file.

### 7.2 `src/ui/HUD.ts` — the "Next wave in Ns" readout (R3)

The intermission banner is drawn by the renderer (§7.3) and already becomes truthful for free.
This adds the *live-wave* half of R3.

**Add a field** next to `private momentumEl!: HTMLElement;` (line 197):

```ts
private nextWaveEl!: HTMLElement;
```

**Create the element** immediately after `momentumEl` is appended (around line 734):

```ts
this.nextWaveEl = document.createElement('div');
this.nextWaveEl.className = 'hud-next-wave u-tabular';
side.appendChild(this.nextWaveEl);
```

**Render it** at the end of `updatePacingControls()` (around line 878), before
`this.updateThreatRow()`:

```ts
// R3: the schedule is computed at wave start, so the player can be told when the
// next wave lands instead of finding out. `null` means it is waiting on the
// field being cleared — a boss, or a wave that has overrun its own schedule.
const next = p.secondsToNextWave;
toggleClass(this.nextWaveEl, 'is-visible', next !== null);
setText(this.nextWaveEl, next !== null ? `Next wave in ${Math.ceil(next)}s` : '');
```

**Update the Call button tooltip** (lines 860-866) — the current text describes the old
mechanic:

```ts
setTitle(this.callWaveBtn, p.canCallEarly
  ? `Space — start the next wave now, ${p.earlyCallRemaining.toFixed(1)}s early.`
    + ` That is +${Math.round(p.callBonus * 100)}% gold, banked into momentum`
    + ` (capped at +${Math.round(p.momentumCap * 100)}%).`
    + ` Anything still alive — or still unspawned — comes with you.`
  : `Opens ${p.earlyCallDelay}s into a wave, or as soon as its last enemy has spawned`
    + ` if that comes first. The more of the wave's timer you skip, the more gold it banks`
    + ` (up to ${p.earlyCallWindow}s worth).`);
```

**Add CSS** in `src/styles/main.css` next to the `.hud-momentum` rule (line 7372):

```css
.hud-next-wave {
  font-size: var(--text-2xs);
  font-weight: 600;
  color: var(--text-2);
  letter-spacing: 0.02em;
  min-height: 12px;
  opacity: 0;
  transition: opacity var(--dur-fast) ease;
}
.hud-next-wave.is-visible { opacity: 1; }
```

`--text-2` is the muted-but-readable step in `src/styles/tokens.css` (`--text-0` primary
through `--text-3` faintest); it deliberately reads quieter than `.hud-momentum`'s
`--amber-300`, which is an earned reward and should keep the eye.

Then hide it on phones, matching the `.hud-momentum` treatment inside the same media block at
line 4394:

```css
.hud-momentum { min-height: 0; }
.hud-next-wave { min-height: 0; }
```

### 7.3 `src/game/Renderer.ts` — the banner

`drawWaveBanner` (line ~5776) already reads `snap.wave.intermissionTimer`, which is now the
true remainder, so the countdown becomes correct with **no code change**. The only edit is the
label, which currently implies a fixed pause:

```ts
ctx.fillText(
  `Wave ${snap.wave.number} cleared — ${willAdvance ? 'next' : 'restarting'} wave in ${secs}s`,
  w / 2, 25,
);
```

Leave this string as is; it is already accurate under the new model. **No change to
`Renderer.ts`.** (Listed here so the implementer does not go looking.)

---

## 8. `sim/` — keep the balance model honest

The model's idle path adds a flat intermission to every wave. Under the new scheme an idle run
also waits out the walk-in, so the model would understate cycle time.

**`sim/model.ts` line ~1561:**

```ts
const intermission = pacing ? intermissionSecondsForWave(wave) : 5;
```
becomes
```ts
const intermission = pacing ? nominalWaveTailSeconds(wave) : 5;
```

and swap the import at line 45 (`intermissionSecondsForWave` → `nominalWaveTailSeconds`),
keeping `intermissionSecondsForWave` imported only if something else in the file still uses it.
Update the comment above the line: the intermission is now a *schedule* built from the roster,
and `nominalWaveTailSeconds` is the model's flat stand-in for it.

**`sim/balance.ts` line ~492:** `${intermissionSecondsForWave(off.wallWave)}s` →
`${nominalWaveTailSeconds(off.wallWave).toFixed(1)}s`, adjusting the import at line 26.

**`sim/balance.ts` line ~668-670:** the printed header says "+1% gold per second left on the
15s call window". Reword to "+1% gold per second of wave timer skipped, up to 15s per call,
momentum capped at …".

After the code changes, run `npm run sim` and confirm the §4.5 active-vs-idle advantage still
lands in the +25–40% band. If it has moved materially, say so rather than retuning constants —
retuning is a separate decision.

---

## 9. Deliberate design decisions (do not "fix" these)

1. **The schedule is a deadline the intermission is measured against, not a spawn timer.**
   The next wave still requires the field to be clear. A hard timer would start wave *N+1* on
   top of a live wave *N* every time the player fell behind, which stacks with enrage into a
   much steeper death spiral than the game has today, and would need `wave_cleared` to fire
   with enemies alive — rippling into contracts, rewards and offline progress. Out of scope.

2. **A wave that overruns its schedule still gets `MIN_INTERMISSION_SECONDS`.** The countdown
   the player saw was a prediction; when it is wrong, it stalls rather than going negative.

3. **Known trade-off — a very over-levelled player waits longer than today.** If the tower
   clears a wave-25 roster at 34s but its schedule says 42.3s, that is ~8s of dead air where
   today it would be 3s. Three things bound it: the estimate already subtracts tower range
   (§3.2), so a strong build's schedule is genuinely shorter; the tail shrinks with depth via
   `intermissionMultiplier`; and Call is unlocked and pays gold for exactly this. **If it
   still measures badly in play, the one-line knob is `scheduledIntermission()` (§4.4) —**
   clamp its upper end with `Math.min(this.tailSeconds() * 2, …)`. Do not add that clamp
   pre-emptively; it makes the countdown untruthful, which is the thing this plan exists to
   fix.

4. **`BASE_INTERMISSION_SECONDS` stays at 5 and keeps its meaning as a ratio base.** See §2.

---

## 10. Tests

### 10.1 Existing tests that must be updated

`tests/pacing.test.ts` uses an 800 × 600 arena (spawn ellipse radii 416 × 312, mean distance
≈ 360) with `towerRange = 0`, so walk-in times there are ~1–2s, far shorter than the game's.
Re-derive expectations; do not copy §3.3's numbers into the tests.

| Test | Line | What breaks | Fix |
|---|---|---|---|
| `opens the call window mid-wave, once the roster is out and the delay is up` | 137 | Title and the `spawning === false` assertion: the window now opens at 15s **with the roster still spawning** at wave 41. | Rename to `opens the call window 15s in, or at the last spawn if that comes first`. Drop `expect(waves.snapshot.spawning).toBe(false)`. Keep the `elapsed >= EARLY_CALL_DELAY_SECONDS`, `earlyCallRemaining() > 0`, `cleared === 41`, `currentWave === 42` assertions. |
| same | 169 | `expect(waves.earlyCallRemaining()).toBe(0)` after the call — still correct (`earlyCallOpened` is false on the new wave). | No change. |
| `opens a full window on a wave cleared faster than the delay` | 173 | `earlyCallRemaining() === earlyCallWindowLength()` and `earlyCallRemaining() > intermissionRemaining()` both fail: at wave 3 the remainder is ~9.7s, under the 15s ceiling, and it now **equals** the intermission by construction. | Replace both with: `earlyCallRemaining()` is `> 0`, `<= earlyCallWindowLength()`, and `toBeCloseTo(waves.intermissionRemaining(), 6)`. Rewrite the comment: the call banks what is left of the wave's schedule, capped at the window ceiling. |
| same | 187-190 | `banked` compared against `earlyCallWindowLength() - DT`. | Compare against the intermission remainder after one tick instead. |
| `is refused while the intermission is paused` | 194 | Nothing structural. | Should pass unchanged; re-run to confirm. |
| §7.6 intermission-length block | 568-610 | Asserts the stats pipeline, which is untouched. | Must pass **unchanged**. If it fails, §2's "do not change `BASE_INTERMISSION_SECONDS`" rule was broken. |

Also check `tests/save.test.ts` for anything asserting `intermissionTimer <= 5`.

### 10.2 New tests to add in `tests/pacing.test.ts`

Add a `describe('scheduled intermission')` block:

1. **`unlocks the call at the last spawn when that is under the delay`** — `startWave(1)`
   (5 enemies, interval 1.96 ⇒ last spawn 8.34s), `resumeSpawning()`, tick without clearing
   enemies. Assert `canCallEarly()` is false at `elapsed ≈ 8.0` and true by `elapsed ≈ 8.5`,
   i.e. strictly before `EARLY_CALL_DELAY_SECONDS`.

2. **`unlocks the call at the delay when the roster is still spawning`** — `startWave(41)`,
   tick to 15s without clearing. Assert `canCallEarly() === true` **and**
   `waves.snapshot.spawning === true` **and** `enemiesSpawned < enemiesToSpawn`.

3. **`carries unspawned enemies into the wave that was called`** — from test 2, record
   `pending = enemiesToSpawn - enemiesSpawned`, then `callWaveEarly()`. Assert the new wave's
   `enemiesToSpawn === spawnCountForWave(42) + pending` (allowing for `enemyCountMult === 1`),
   and that the queue contains at most one `thief`.

4. **`gives a cleared wave what is left of its schedule`** — `startWave(5)`, clear it with
   `clearToIntermission`. Assert `intermissionRemaining()` is `> MIN_INTERMISSION_SECONDS`
   and `< computeWaveDeadline`'s value for that wave, and specifically **not** equal to
   `intermissionSecondsForWave(5)` (5s) — the point of the change.

5. **`floors the intermission when the wave overruns its schedule`** — `startWave(5)`, tick
   past its deadline with enemies alive (do not clear), then clear. Assert
   `intermissionRemaining()` is `MIN_INTERMISSION_SECONDS` (within one `DT`).

6. **`gives a boss wave a fixed tail rather than a schedule`** — `startWave(10)`,
   `resumeSpawning()` (a boss wave always offers a mutator, which pauses spawning), clear it.
   Assert `intermissionRemaining()` ≈ `WAVE_TAIL_SECONDS * 1` and that
   `secondsToNextWave()` returned `null` while the wave was live.

7. **`does not tick the schedule while a modal has paused the wave`** — `startWave(9)`,
   tick 2s, `pauseSpawning()`, tick 5s, `resumeSpawning()`. Assert `secondsToNextWave()`
   dropped by ≈2s total, not ≈7s.

### 10.3 Commands

```bash
npm test -- tests/pacing.test.ts tests/save.test.ts
```

```bash
npm run sim
```

---

## 11. Order of work

1. §2 — constants in `src/data/pacing.ts` (nothing depends on them yet; safe).
2. §4.2 — export `ENEMY_GAP`.
3. §4.1, §4.3, §4.4, §4.5 — new imports, fields and private/public methods in `WaveManager`.
   Compiles cleanly on its own; nothing calls them yet.
4. §4.6, §4.7, §4.8, §4.9, §4.10, §4.11, §4.12 — rewire the existing methods. **After this
   step run `npm test -- tests/pacing.test.ts` and expect the failures listed in §10.1** —
   confirm they are exactly those and no others.
5. §10.1 — update the existing tests.
6. §6 — `Game.ts` wiring.
7. §7 — HUD element, tooltip and CSS. Verify in the browser with the dev server: start a run,
   check the "Next wave in Ns" readout counts down during wave 1, that the banner after the
   clear shows the same number continuing rather than restarting at 5, and that Call lights up
   at ~8s on wave 1.
8. §10.2 — new tests.
9. §8 — sim, then `npm run sim`.
10. `detect_changes()` before committing, per `CLAUDE.md`.
