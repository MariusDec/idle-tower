# The app: boot, screens, loop, lifecycle

`src/app/` is the only layer that holds both the sim and the presentation.
`main.ts` boots, `App.ts` owns everything at runtime, `loop.ts` is the
clock and `screens.ts` the state machine.

## Boot

`main.ts` loads the icon sprite, builds `App` over the five elements of
`index.html` (canvas, stage, HUD root, screen root, overlay root) and calls
`boot()`:

1. `loadProfile` (see [save.md](save.md)) — a fresh profile on first run,
   a migrated one otherwise.
2. The settings are applied (`app/settings.ts`, see [ui.md](ui.md)), the
   music timer starts.
3. A run snapshot from a killed app resumes at its wave boundary, paused.
4. Offline earnings pay out with a welcome-back card (see [idle.md](idle.md)).

In dev builds `globalThis.tower` is the `App`, and `1`/`2`/`3` force a sim
speed.

## Screens

`screens.ts` is a pure transition table, asserted on every `go()`:

```
boot → hub ⇄ run → results → hub | run
```

There is no way from a run back to the hub except through results: a
retreat is a run end like a fall (§4.2). "Run again" on the results screen
goes straight to a new run with a new seed.

## The loop

`loop.ts` is a true fixed timestep. Every sim step is exactly
`SIM_DT = 1/60` s; wall time is banked and paid out in whole steps, and
speed multiplies what is banked, so 3× is three steps a frame, never a
longer step. At most 12 steps are paid per frame (past that, time is
dropped and the game slows rather than spiralling); a frame longer than
0.1 s is clamped. The renderer gets `alpha`, how far the wall clock is
between the last two steps, and interpolates positions with it.

`App.simSpeed()` decides the speed each frame:

| State | Speed |
|---|---|
| hub, results, paused, or the run over | 0 |
| the very first draft of a profile | 0 (the one draft that waits, §4.5) |
| any other draft open | `BALANCE.draft.slowMotion` × speed (15%) |
| a boss's killing blow | 20% for 0.9 s of wall time |
| a boss phase change | 0 for 0.12 s (hit-stop) |
| otherwise | the unlocked speed (1–3×), or the dev override |

## Saving

Writes go through one promise queue (`App.write`), so a late snapshot can
never land after its clear. The profile is saved on every hub action, on
run end, on settings changes, every 30 s and whenever the page hides. A
run snapshot is written at each new wave. On run end the banked profile is
written *before* the snapshot is cleared: killed between the two, the stale
snapshot's run count is behind the profile's and boot drops it, so a run is
never paid twice.

## Absences

Any absence settles through `App#absent`: the page shown again
(`visibilitychange`), the native resume (Capacitor), or a stalled frame
(more than 60 s between frames with the page never hidden: a laptop lid, a
frozen tab). The loop drops the gap rather than fast-forwarding the sim,
and anything over a minute since the profile was last stamped pays offline
(§6.1). Going away (`hidden`) pauses a run, drops the quality scaler's window and
saves.

## Input

| Input | Where |
|---|---|
| Card pick, reroll | the draft panel → `applyInput` between steps |
| Ultimate | the HUD button, or Space |
| Pause | the HUD button, Escape, the Android back button |
| Speed, Autocaster | HUD toggles, saved to the profile |
| Back | closes settings, then a modal, then pauses a run |
