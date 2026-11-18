# Android GPU crash — less GPU work while stopped, less lost to a crash

**Status:** built (§1a–1c, §2a–2d). The compositor-only glows (§1c, optional) are not done.

## The crash

On 2026-10-17 the app died on a Galaxy S23 (SM-S911B, Adreno GPU,
Android 16, WebView 153.0.8010.39) in map 4. It had been sitting for
about 6 s with the draft open and the arena stopped by the draft's pause
button. The tombstone:

```
14:44:42  F/libc  Fatal signal 11 (SIGSEGV), code 1 (SEGV_MAPERR), fault addr 0x1100300037
          in tid 23231 (Chrome_InProcGpu), pid 23048 (com.mariusdonci.thetower)
  #00–#05  /vendor/lib64/egl/libGLESv2_adreno.so
  #06–#27  libwebviewchromium.so
```

- **Where it crashed:** in Qualcomm's GL driver, on WebView's GPU thread.
  None of the game's code is in the stack, and no JS error came before it.
- **Why the whole app died:** WebView runs its GPU thread inside the app's
  own process (`InProcGpu`), so a driver fault kills the app. Chrome would
  only lose a separate GPU process, which restarts. No `onerror`,
  `try/catch` or Capacitor hook can see this kind of crash.
- **Timing:** the run had started at 14:44:28 (the first `tower-run.json`
  write). The last tap was at 14:44:36. Nothing in the logs points to a
  trigger in the app.
- **The cause is most likely the driver or this WebView build**, so the
  game can't fix it outright. What it can do is give the driver less to
  draw while nothing is happening (§1), and make sure a crash costs almost
  nothing (§2).

Also seen, and left out of this plan: `cc/tiles/tile_manager.cc: tile
memory limits exceeded` fires on every hub load, in both the crashed
session and the relaunch. It's worth looking into separately.

## 1. Stop GPU work while the arena is stopped

**Today:** in a run, `App.frame` calls `Renderer.render` on every frame,
whatever the sim speed. The renderer's clock, particles, camera ease and
banner all advance on wall-clock time, so a stopped arena is still redrawn
at 60–120 Hz. Two CSS glows also repaint on every frame:
`ult-ready` on the HUD and `evolution-glow` on draft cards, both animating
`box-shadow`.

**Goal:** when `simSpeed() === 0` during a run (pause menu, the draft's
pause button, the first draft, settings over a run), let whatever is
still moving finish, then stop drawing the canvas until something
changes. The draft, HUD, toasts, music and autosave keep running every
frame.

### 1a. Let the renderer report when the picture is still

- **`Camera.still`** (`src/render/camera.ts`): true when `shakeTime === 0`,
  `punchTime === 0` and `view.extent === target()`.
- **`Effects.idle`** (`src/render/effects.ts`): true when particles, rings,
  arcs, motes and numbers are all empty.
- **`Renderer`** (`src/render/renderer.ts`):
  - Add a private `dirty` flag. These set it:
    - `setQuality`, `setPalette`, `setTower`, `setTextScale` and `setMotion`;
    - `attach` when the run changes;
    - the camera's `onResize`;
    - a zoom gesture (the gesture path in `camera.ts`, about line 236).
      This one goes through a callback or a camera `version` counter that
      the renderer compares.
  - `render()` clears `dirty` once it has drawn.
  - `get settled()` returns `!dirty && camera.still && effects.idle &&
    banner === null && (fallT === null || fallDone)`.

### 1b. Skip drawing in `App.frame`

In `src/app/App.ts`, `frame()` (around line 528):

```ts
const stopped = this.screen === 'run' && this.simSpeed() === 0;
if (!(stopped && this.renderer.settled)) {
  const t0 = performance.now();
  this.renderer.render(run, alpha, realDt);
  if (this.screen === 'run') this.measure(realDt, performance.now() - t0);
}
```

- `syncDraft`, `hud.update`, `hud.setZoomed`, the outcome checks, toasts
  and autosave stay outside the guard.
- **No time jump on resume:** the renderer's clock only moves on frames it
  draws, so tower and enemy animations carry on from where they froze.
  `loop.resetClock()` already runs on resume.
- `measure()` already resets the quality scaler while stopped, so skipping
  it changes nothing.
- The hub and results screens are unchanged. They have their own
  animations, and `stopped` is false on them.

### 1c. Pause the CSS glows while stopped

- **App.ts:** keep `els.stage.dataset.arena` at `'stopped'` or `'live'`,
  writing it only when the value changes.
- **main.css:**

  ```css
  [data-arena='stopped'] .hud-ult.is-ready,
  [data-arena='stopped'] .draft-card-evolution .draft-card-icon,
  [data-arena='stopped'] .draft-card-fusion .draft-card-icon {
    animation-play-state: paused;
  }
  ```

- **Optional, and cheaper during play too:** move each glow's peak
  `box-shadow` onto a `::after` element and animate its `opacity`
  instead. Opacity runs on the compositor, so it doesn't repaint each
  frame, and it should look the same.

### 1d. Tests and checks

- **`tests/camera.test.ts`:** `still` turns false on `shake()`,
  `zoomPunch()` and a framing change, and true again once each has
  finished.
- **A new renderer test:** `settled` turns false after each setter marks
  it dirty, and true after one `render`. This needs a stub 2D context, or
  a test of the flag logic on its own.
- **Browser check:** with the dev server and a temporary render counter,
  open a draft and press its pause button. Calls should stop within about
  1 s. A pinch while stopped should draw again, and resuming should carry
  on smoothly.
- **Phone check:** with `adb logcat` running, pause on a draft. In
  `chrome://inspect` → Performance, GPU frames should drop to about zero.
- **Process (CLAUDE.md):** run `impact` on `Renderer.render`, `App.frame`,
  `Camera.measure` and `Camera.update` before editing, and
  `detect_changes` before committing.

**Risk:** low, it only changes how things look. The one way to get it
wrong is an input that changes the picture without setting `dirty`; the
screen would stay frozen until play resumes. The pinch and resize checks
cover the known inputs.

## 2. A crash costs (almost) nothing

**Today:**
- `App.step` snapshots the run at every wave start (`saveRunSnapshot`,
  around line 507), and `boot` resumes it (around line 258) with the pause
  card "The run resumes at wave N".
- Save files are written crash-safe (`FilesystemStore.set`: write `.tmp`,
  delete the old file, rename; `get` falls back to `.tmp`).
- The 14:45:46 relaunch read `tower-run.json` with no plugin error, so the
  resume most likely worked.
- Waves spawn over 6–10 s, so a crash today loses up to one wave of
  progress plus the cards picked during it.

**Why a snapshot can be taken at any time:** `RunState` carries its own
RNG state (`src/sim/state.ts`, `rng: RngState`), and input lands only
between steps (`applyInput`). So a snapshot taken between any two steps
resumes exactly, not only at a wave start.

### 2a. Save the run when the app goes to the background

- **`App.hidden()`:** if `screen === 'run'` and the run has no
  `outcome`, queue `saveRunSnapshot(snapshotRun(run, profile))` through
  `write()`, next to the profile save.
- **Why it matters:** the same logcat shows `lmkd` (Android's low-memory
  killer) closing background apps with swap low. A backgrounded game is
  killed the same way, and today that loses everything since the wave
  started.

### 2b. Save the run after card picks

- **Mark the run dirty:** `pick`, `takeAll`, `reroll` and `banish` set
  `runDirty = true`.
- **Write it, rate-limited:** in `frame()`, if `runDirty` is set and at
  least 2 s have passed since the last run snapshot, take one and clear
  the flag. The early game levels up quickly, so the limit stops a burst
  of picks from writing a file for each one.
- **Keep one clock for all snapshots:** the wave-start snapshot and §2a
  also record the time of the last snapshot.

### 2c. Snapshot at run start (minor)

- `startRun` takes a snapshot right away for a fresh run, so the run is
  covered before wave 2 begins.
- This only helps runs that cost something to enter (Trials, Pacts).
  Nothing is banked in wave 1.

### 2d. Tests and checks

- **`tests/save.test.ts`:**
  - Take a snapshot mid-wave, after a pick, and check it round-trips
    through `loadRunSnapshot`.
  - Step the restored run N times next to the original and check both end
    in the same state. This proves the "any step boundary" claim.
- **Phone check:** start a run, pick a card, then
  `adb shell am kill com.mariusdonci.thetower` (or swipe the app away)
  and relaunch. The run should resume with that card still picked.

**Risk:** low.
- The extra writes are small and rate-limited, and they go through the
  write queue that's already used.
- If a snapshot won't load, `loadRunSnapshot` already throws it away and
  logs a warning, so it can't block a boot.
- The sim is untouched, so no pacing run is needed.

## 3. Less for the driver to chew on (built)

- **No gradient per glow per frame.** Fires, molten pools, Whiteout, the
  rift and Aegis stamp a glow baked once (`src/render/glow.ts`,
  `drawGlow`), faded by `globalAlpha`; meteors stamp a baked strip
  (`drawStreak`). The tower's stone, drum and pods, a boss's body, the
  Forgeheart's heat and the low-HP vignette reuse one gradient per key
  (`cachedGradient`). Within 2/255 of the old pixels.
- **Android tiers draw less** (`qualityFor` in `src/render/quality.ts`):
  DPR cap 1.5 on `high` (56% of the pixels of 2×), 1.25 on `medium`, and
  `lighter` blending only on `high`.
- **No frames while away:** `App.hidden` stops the loop outright and
  `App.absent` starts it once the page is visible again, rather than
  trusting the WebView to stop rAF behind the launcher.
- **A GPU reset:** on the canvas's `contextrestored`, every baked glow and
  enemy sprite is dropped and rebakes, so none comes back blank.

## Order

1. **1a + 1b:** the core change, about 60 lines plus tests.
2. **2a:** about 5 lines, the most protection for the least work.
3. **2b + 2d:** about 30 lines.
4. **1c**, then optionally the compositor-only glows.
5. **2c**, if wanted.

## Still open

- **Whether the 14:45:46 relaunch actually resumed the run:** the player
  should confirm it showed "The run resumes at wave N".
- **The hub's `tile memory limits exceeded`:** a separate investigation.
- **A second crash with JS context:** if it happens again, record
  `adb logcat -v time -b main -b crash` during play and look at the 30 s
  before the tombstone.
