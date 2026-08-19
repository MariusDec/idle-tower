# Audio

`AudioManager` synthesises every sound with the Web Audio API — there are no
audio assets in the project.

## Lifecycle

`ensureContext()` creates the `AudioContext` lazily; browsers refuse to start
one before a user gesture, so `resume()` is wired to the first interaction.
`setVolume(v)`, `toggleMute()`, `isMuted` and `currentVolume` back the settings
panel. `dispose()` tears the context down.

`tick(_dt)` exists for interface symmetry and does no work — the manager is
purely event-driven.

## Event subscriptions

| Event | Sound |
|---|---|
| `projectile_fired` | shot |
| `enemy_damaged` | hit |
| `enemy_killed` | death |
| `boss_killed` | boss death sting |
| `boss_enraged` | enrage cue |
| `wave_started` | wave chime |
| `ability_cast` | per-ability cue |
| `upgrade_purchased` | purchase blip |
| `ascension_performed` | ascension sting |
| `transcendence_performed` | transcendence sting |

Adding a sound means subscribing in the constructor — `AudioManager` is a pure
consumer of the bus and is never called directly from the simulation, so it
cannot affect game state.
