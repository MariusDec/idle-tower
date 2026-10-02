# Architecture

TypeScript, Vite, an HTML5 canvas for the arena and vanilla DOM for
everything else; Capacitor wraps the web build for Android. No framework.

## Layers

```
src/
  core/      rng · math · events · spatialGrid · format        (imports nothing)
  content/   data tables · balance.ts · arena.ts · lint.ts      (core)
  sim/       RunState · createRun · step · systems/ · stats      (core, content)
  meta/      profile · forge · collection · feats · offline ·
             automation · pacts · stars · results · runConfig ·
             save/                                               (core, content, sim types)
  render/    renderer · painters/ · effects · camera ·
             palette · quality                                   (core, content, sim types)
  audio/     synth · cues · music                                (sim types)
  ui/        hud · draft · results · hub/ · settings · modal     (anything but sim internals)
  app/       main · App · loop · screens · settings · bench      (anything)
  platform/  native.ts (Capacitor hooks)
tools/       headless bots and reports over the real sim
tests/       Vitest, node environment
```

The import rules are what keep the sim honest:

- **`sim/` imports only `core/` and `content/`.** No DOM, no `Date.now`, no
  `Math.random`. The same `(RunConfig, seed, inputs by tick)` always
  produces the same run, which is what lets `tools/` *be* the game rather
  than a model of it.
- **`render/` and `audio/` read a `RunState` and never write it.** They
  learn what happened from `RunState.events`.
- **`meta/` owns the profile.** `sim/` never sees it, only the frozen
  `RunConfig` that `buildRunConfig` derives from it.
- **`app/` is the only place that holds both the sim and the presentation.**

## One frame

```
Loop (rAF) ── step() × n ──► sim/step(run, SIM_DT, input)      (fixed 1/60 s)
           └─ render(alpha, realDt)
                 App.announce(events)   toasts, slow-mo, hit-stop
                 Cues.play(events)      sound
                 Renderer.consume(events), render(run, alpha)
                 events.length = 0
                 Hud.update(run), DraftPanel, results timer, autosave
```

Input (a card pick, the ultimate, a reroll, a retreat) lands through
`applyInput` on a step boundary, so a run stays a pure function of its
inputs by tick.

## Between runs

```
Profile ──buildRunConfig──► RunConfig (frozen) ──createRun──► RunState
   ▲                                                          │
   └──────────── bankRun(profile, run) ◄───── outcome ────────┘
```

`meta/results.ts#bankRun` is the single place a run's rewards reach the
profile; the app and every bot call it. See [forge.md](forge.md) and
[save.md](save.md).

## Rules that apply everywhere

- **Nothing tunable lives in `sim/` code.** Numbers go in
  `content/balance.ts` or per-item data.
- **Effects are data**: a tagged union (`stat`, `unlockCard`, `slot`,
  `behaviour`, …) with exhaustive consumers ending in `never`.
- **Colours come from `render/palette.ts`** or a `--token` in
  `styles/tokens.css`; `tests/palette.test.ts` fails on a literal.
- **Every screen is checked at 375×812 first** (D4).
