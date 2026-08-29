# Wave System

**File:** `src/systems/WaveManager.ts`

## Wave Flow

```
tick() called each simulation substep:
  if intermission:
    countdown → 0 → startWave(current + (autoProgress ? 1 : 0))
  else:
    spawnTimer -= dt
    while spawning && spawnTimer <= 0: spawnOne()   ← pops the pre-rolled roster
    if all enemies spawned AND alive count == 0:
      emit wave_cleared → intermission
      planNextWave()                                 ← rolls the next roster
```

## Wave Properties

| Field | Formula | Description |
|-------|---------|-------------|
| Enemy count | `5 + floor((wave-1) * 1.2)` | How many enemies to spawn (`enemyCountForWave`) |
| Spawn count | `spawnCountForWave` | Boss waves spawn `1 + bossEscortCountForWave` instead |
| Spawn interval | `max(0.4, 2.0 - wave * 0.04)` | Time between spawns |
| Expected duration | `expectedWaveSeconds` | Spawn cadence + a kill window — see [Enrage](#enrage) |
| Intermission | 5 s / 3 s / 2 s | Pause between waves — see [Intermission length](#intermission-length) |
| Auto-progress | default ON | Advance waves automatically |

## Enemy Selection

Non-boss waves draw from a weighted pool. The weights live in
**`ENEMY_SPAWN_WEIGHTS`** (`src/data/enemies.ts`), and `spawnPoolForWave(wave)`
filters them by each type's `unlockWave`.

That table is the single source of truth: `WaveManager.pickEnemyType`, the
offline-progress wave averages in `SaveManager`, and the balance model in
`sim/model.ts` all read it. It used to be written out three times, which is
exactly how a balance change lands in the game but not in the model that is
supposed to be measuring it.

| Type | Weight | Unlock |
|---|---:|---:|
| normal | 5 | 1 |
| fast | 3 | 3 |
| tank | 2 | 5 |
| flying | 2 | 8 |
| splitter | 1 | 12 |
| healer | 1 | 15 |
| shielded | 1 | 20 |
| siege | 2 | 25 |
| thief | 1 | 30 |
| blinker | 2 | 35 |
| warden | 1 | 40 |
| burrower | 2 | 45 |
| boss | 0 | — the boss is placed by `buildRoster`, never rolled |

A boss wave spawns **one** boss plus an escort of `bossEscortCountForWave(wave)`
= `2 + (tier - 1)` ordinary enemies rolled from the pool above — see
[boss-encounters.md](boss-encounters.md). The boss is the roster's first entry,
so it leads and the escort walks in behind it. A boss in a `summon` phase adds
enemies *on top of* `enemiesToSpawn`, so the wave cannot end until those are
cleared too.

Gameplay plan §2.6 requires that the five behavioural types **replace** slots
rather than adding them, so total wave HP does not rise: `normal` dropped 6→5
and `splitter` 2→1 to pay for the eight new weight points, and the new types'
base HP is budgeted so the pool's weighted mean effective HP is unchanged.
`npm run sim` reproduces the pre-change wall wave exactly at every prestige tier.

### Thief cap

At most **one thief per wave**. `WaveManager` drops it from the pool once one
has spawned, and `EnemyManager` separately enforces the 15%-of-current-gold
theft ceiling for the wave (reset by `beginWave`, which `startWave`,
`startAtWave` and `reset` all call).

### Fast packs

A `fast` roll spawns **three** enemies from one shared spawn point, scattered
over ±26 px, so it reads as a rush rather than a trickle. The pack counts
against `enemiesToSpawn` **in full** — it takes slots, it does not add them —
and the pack is truncated if fewer than three slots remain. The elite roll
happens per pack member, so packing does not change the elite rate.

## Spawn Position

Random edge of canvas: top (`y=-20`), right (`x=width+20`), bottom (`y=height+20`), left (`x=-20`).

## The pre-rolled roster (gameplay plan §7.3)

A wave's entire roster — type, spawn point, elite roll and aura for every
enemy — is rolled **before the wave starts**, not one enemy at a time as the
spawn timer fires:

- `planNextWave()` runs the moment an intermission opens, for the wave the
  countdown is heading to.
- `startWave` adopts that plan if it is still valid, and rolls a fresh one if it
  is not. The only thing that invalidates it is a **mutator chosen from the
  boss-wave offer**, which changes `enemiesToSpawn` after the plan was made; a
  plan of the wrong size is thrown away rather than stretched.
- `spawnOne` pops one entry. If the queue runs dry — the only path that does
  that is a save restored mid-spawn, which has no plan — it rolls the remainder
  on the spot, so that path behaves exactly as it did before.

The dice are unchanged: same weighted pool, same thief cap, same `fast` pack
expansion, same per-member elite roll. They simply happen earlier.

**Why:** it is what makes the §7.3 threat preview *truthful*. "3 Siege · 1 Elite
(Haste)" is what the wave will actually contain, not an expectation derived from
the weight table that the dice may then not honour — and a preview the wave
sometimes contradicts teaches the player to ignore it. It also gives the canvas
real spawn-edge markers instead of decorative ones.

`previewNextWave()` returns the composition (or `null` outside an
intermission): the headcount, whether it is a boss wave, the **threat** types by
count, elites by aura, and up to 8 clustered spawn lanes. Which types get named
is `ENEMY_THREAT_CLASS` in `src/data/pacing.ts` — a `Record` over `EnemyType`,
so a new enemy cannot ship as one the preview quietly folds into "31 enemies".

## Call the wave early (gameplay plan §7.1)

`Space`, or the HUD's **Call** button, starts the next wave immediately.

| | |
|---|---|
| Bonus | **+1% gold per second of intermission skipped** |
| Momentum cap | **+6%** |
| Resets on | the tower losing HP, or any wave that was not called early |
| Refused when | not in an intermission, the intermission is paused, or any modal is open |

The bonus accumulates into a **momentum counter** that persists across
consecutively-called waves. One call is worth +5% at wave 20 or shallower, +3%
to wave 50 and +2% past it, so the cap takes two to three consecutive calls at
every depth.

Momentum resolves through the stat pipeline as a `goldMultiplier` multiplier
(`stats/contributors/pacing.ts`), so it composes with every other gold source
and shows up in the Stats panel breakdown as a named source.

> §7.1 specifies +3%/second capped at +40%. Both measured about **four times**
> what the curve can pay for — the idle-parity gate is composed DPS at a matched
> wave, and at +40% active play measured +60-69% against a +50% ceiling. See the
> note on `EARLY_CALL_GOLD_PER_SECOND` for the full measurement, including the
> reward the metric cannot see: calling a wave early *is* a throughput gain.

**Ordering matters.** `Game.callWaveEarly` banks the momentum **before** calling
`WaveManager.callWaveEarly`, because `startWave` resolves the new wave's stats
and the bonus is meant to apply to the wave the player just bought.

**Refusal while a modal is open** is two guards, not one. `WaveManager.canCallEarly`
refuses while the intermission is paused, which is the state every modal that
pauses it puts the game in; `Game.isModalOpen` asks all seven modal owners
directly, covering the ones that do not pause (the core picker, the run summary,
the run-failed dialog, the keybind overlay). A wave called out from under a
blessing draft is a decision taken away rather than made.

## Intermission length

Intermission is `WAVE_INTERMISSION` (5 s) times `intermissionMultiplier`, and
that stat now carries two contributions:

| Source | Effect |
|---|---|
| Efficient Deployment research | −N% |
| Wave depth (plan §7.6) | ×1.0 to wave 20, **×0.6** past it, **×0.4** past wave 50 |

Which is 5 s / 3 s / 2 s. Routed through the existing stat rather than a new
mechanism (§7.6's own instruction), so the two *compose* instead of one silently
winning. `intermissionSecondsForWave` / `intermissionFactorForWave` live in
`src/data/pacing.ts`.

## Risk dial (gameplay plan §7.4)

A persistent **0-5** setting in the HUD. Each step:

| | per step | at risk 5 |
|---|---|---|
| Enemy HP | +18% | ×1.90 |
| Enemy speed | +8% | ×1.40 |
| Gold | +25% | ×2.25 |
| Ascension points | +10% | ×1.50 |

Additive per step, matching the only other stacking difficulty channel in the
game (`ENRAGE_DAMAGE_PER_STACK`).

- **Takes effect at the next wave.** `PacingManager` carries the dial (`risk`)
  and what the live wave is running (`committedRisk`); the contributor reads the
  committed value, which is the one place that promise could quietly break.
- **Composes with wave mutators.** HP and speed resolve into `enemyHpMult` /
  `enemySpeedMult` and are written to `EnemyManager`'s *stat* channel, which is
  separate from the mutator's own — so a Swarm wave at risk 4 gets both.
- **The dial survives an ascension**; momentum and the combo do not. It is a
  preference about how the player wants to play, and an auto-ascending run
  reaches that reset several times an hour with nobody watching — the same trap
  Part 6 found in the core selection.
- The AP bonus is its own channel on `PrestigeManager` (`setRiskApBonus`), not a
  `RunApSource`: the banked run bonuses share a +50% cap that risk is not part
  of, and they are *set* from their own saved blocks on load.

## Enrage

The wave-level fail state, in `src/data/formulas.ts`. Without one the tower
simply stops killing fast enough while enemies trickle in too slowly to finish
the wave — the run neither ends nor progresses.

```
expectedWaveSeconds(wave)  = spawnIntervalForWave(wave) * (count - 1) + kill
  kill = TARGET_WAVE_KILL_SECONDS (20)
       | TARGET_BOSS_KILL_SECONDS (28) * bossEncounterWeight(wave)   on a boss wave
enrageThresholdSeconds(wave) = expectedWaveSeconds(wave) * ENRAGE_THRESHOLD_MULTIPLIER (2)
enrageStacksFor(wave, t)     = 1 + floor((t - threshold) / ENRAGE_STACK_INTERVAL (8))
```

Each stack is **+40% damage to the tower** (`ENRAGE_DAMAGE_PER_STACK`) and
**+15% movement speed** (`ENRAGE_SPEED_PER_STACK`), additive — the same
stacking shape as the risk dial below.

`enemyCount` is an optional argument and **must** be passed when a mutator has
changed the wave's size: a Swarm wave spawns 3x the enemies and legitimately
takes 3x as long to spawn them, and must not be punished for that.

A boss wave's kill window is sized off `bossEncounterWeight` rather than its
body count, so the escort does not buy the encounter a longer fuse — see
[boss-encounters.md](boss-encounters.md#the-durability-budget). The boss's *own*
enrage timer is a separate, tighter clock.

## Wave Skip

If `waveSkipChance > 0` and roll succeeds:
- Zero enemies, zero spawn time
- Immediate intermission (wave cleared instantly)
- Emits `wave_cleared` + toast

## Public API

| Method | Effect |
|--------|--------|
| `startWave(wave)` | Initialize a new wave |
| `goToPrevWave()` | Decrement wave, reset enemies |
| `goToNextWave()` | Increment wave, clear enemies |
| `reset()` | Back to wave 1 |
| `startAtWave(wave)` | Jump to specific wave |
| `setAutoProgress(bool)` | Toggle auto-advance |
| `getAutoProgress()` | Current auto-progress state |
| `setWaveSkipChance(float)` | Set skip probability |
| `setIntermissionMultiplier(mult)` | Scale the intermission (research + wave depth) |
| `canCallEarly()` / `intermissionRemaining()` | Whether §7.1 would fire, and for how much |
| `callWaveEarly()` | Start the next wave now; returns the seconds skipped |
| `previewNextWave()` | §7.3 composition of the coming wave, or `null` |

Every entry point that changes the current wave (`startWave`, `startAtWave`,
`reset`) calls `EnemyManager.beginWave(wave)`, which resets the per-wave theft
budget. Adding a fourth entry point without that call silently gives thieves an
unbounded budget.

## Wave Controls (UI)

HUD buttons: `<<` (prev wave), `Auto` toggle, `>>` (next wave), targeting mode,
**Call** (call the wave early), and a **Risk** stepper next to the speed
controls.
Keyboard: `Space` = call the wave early, `<` / `,` = prev, `>` / `.` = next,
`P` = toggle auto-progress.
