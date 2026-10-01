# Audio

No audio files: every sound is synthesised with the Web Audio API. Code:
`audio/synth.ts`, `audio/cues.ts`, `audio/music.ts`.

## The synth

`Synth` owns one `AudioContext`, created on the first user gesture (a
pointer or key press anywhere), as browsers require; before that, and with
the sound off, every call is a no-op.

```
tone() / noise() ──► sfx bus ──┐
Music ─────────────► music bus ─┴─► master ──► destination
```

- **master** = 0.5 × the master slider, or 0 with the sound switch off.
  The switch and the slider both act here, so muting never loses the
  player's levels.
- **sfx** and **music** are the two other sliders.
- Every level change glides over ~30 ms, so it never clicks.

`tone()` is an oscillator with an attack, an exponential decay and an
optional pitch glide; `noise()` is a slice of one cached second of white
noise through a filter. `live` (an effect would be heard) and `audible`
(anything would) let callers skip work.

## Cues (§10.4)

`Cues.play(events)` maps the frame's sim events to sounds. Each weapon has
its own shot — quiet and pitch-varied, so a busy build hums rather than
drills. Cues that can fire many times a frame are throttled on the wall
clock (`GAP_MS`: a shot every 55 ms per weapon, hits 45 ms, kills 40 ms…).

| Group | Cues |
|---|---|
| Combat | a shot per weapon, hit, crit, kill, blasts, shatter, ignite, lance, rune burst, shell, elite spawn |
| Tower | tower hit, the fall |
| Progression | level-up, card pick, evolution, ultimate, floor cleared, relic drop |
| Bosses | arrival, enrage, the kill |
| Meta (called by the app) | `purchase` (Forge and stars), `unlock` (a run opened something up), `claim` (a feat paid) |

## Music

`Music` is a slow generative pad on the music bus. Three moods, each a
short chord loop in a minor key with soft detuned triangle voices through a
lowpass:

| Mood | When | Loop |
|---|---|---|
| hub | between runs | i – VI – III – VII, 6 s a chord, dark |
| run | in a run | i – iv – VI – V, 4 s a chord |
| boss | a boss stands | i – ♭II (Phrygian), 3 s a chord, over a pulsing bass |

Each region shifts the key. A wall-clock timer (200 ms) schedules chords
0.6 s ahead on the audio clock; nothing is scheduled while the music could
not be heard (sound off, master or music at zero), so a muted game costs
only the timer. `App#tune` sets the mood each frame.

## Adding a sound

Push a `SimEvent` from the sim (if it is a sim moment), give it a case in
`Cues.play`, and throttle it in `GAP_MS` if it can fire in bursts. The
renderer's exhaustive switch makes sure it also gets a look.
