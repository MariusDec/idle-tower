# Wave Modifiers (Mutators)

An opt-in risk/reward choice offered on boss waves. `src/data/waveModifiers.ts`,
driven by `Game`'s `wave_modifier_offer` handler and `WaveModifierModal`.

## The nine modifiers

`glass_cannon`, `heavy_hitters`, `swarm`, `golden`, `glass_tower`, `fortress`,
`cursed_ground`, `ironclad`, `famine`.

Each `WaveModifierDef` carries `effects`
(`hpMult`, `countMult`, `speedMult`, `damageToTowerMult`, `playerDamageMult`,
`goldAdditive`) and a `reward` (`gold` multiplier, flat `ap`, flat `tp`).

## Offer cadence

Every boss wave offers a mutator, plus a 4% roll on normal waves — unless one
is already running, so a streak is never interrupted by its own picker.
`pickRandomModifiers(3)` builds the choice set. `WaveManager.startWave` pauses
spawning and emits `wave_modifier_offer`; the modal's `onChoose`/`onSkip`
callbacks call `resumeSpawning()`.

> Anything that resolves an offer outside the modal must call
> `WaveManager.resumeSpawning()` itself — `chooseWaveModifier` and
> `skipWaveModifier` do not.

## Duration and escalating reward

A mutator runs `MUTATOR_DURATION_WAVES` (3) waves and pays out after **each**
of them. `waveModifierRewardMultiplier(wavesCleared)` escalates the payout
x1 / x1.5 / x2, so surviving the third wave under Fortress is worth twice the
first. `waveModifierTotalRewardMultiplier()` is the sum, used for the projected
total the picker shows per choice.

The gold reward measures gold actually earned during that wave
(`goldSnapshot` is re-baselined after each payout), so it composes with the
full gold multiplier stack rather than replacing it.

## State

`state.wave.waveModifier` holds `active`, `wavesRemaining`, `wavesCleared`,
`goldSnapshot`, `pendingChoiceForWave` and `choiceForNextWave`. It is persisted,
and `Game.applyActiveWaveModifier` re-applies the effects on load.
