# Boss Encounters

**Files:** `src/data/enemies.ts` (tuning, pattern tables, tier names),
`src/systems/EnemyManager.ts` (the state machine), `src/game/Game.ts`
(encounter clock and rewards), `src/ui/BossBar.ts` (the readout),
`src/game/Renderer.ts` (on-field telegraphs)

Before gameplay plan §3, a boss was `bossHPForWave` and nothing else: wave 10,
wave 50 and wave 150 played identically, so no individual boss was memorable.
A boss now runs a three-phase state machine, and each phase asks the player for
something different.

> **The rule this part is built on:** a boss wave costs the same *total damage*
> it always did. What changed is that some of that durability now sits behind a
> mechanic with a fail state. See [The durability budget](#the-durability-budget).

## Anatomy of an encounter

A boss wave spawns **one** boss, plus an escort of `bossEscortCountForWave(wave)`
ordinary enemies drawn from the wave's own pool.

For one release it spawned `2 + tier` of them — three at wave 10, twelve at wave
100 — and everything below was divided across that pack. That was the wrong
shape for the machine this page describes: the phases, the pips, the ten-second
bulwark window and the two-second slam telegraph are all written for *a* boss,
and eleven copies of them running out of phase with each other is not eleven
times the encounter, it is noise the player cannot read or answer. The pack
survives as `bossEncounterWeight(wave)` = **`2 + (tier - 1)`**, a multiplier the
lone boss carries.

| Concept | Where it lives |
|---|---|
| Phase, pattern, timers | Fields on the `Enemy` (`bossPhase`, `bossPattern`, …) |
| The machine | `EnemyManager.tickBoss`, inside `resolveStance`'s `boss` branch |
| What the wave is worth | `bossEncounterWeight` — the bar, the purse, the XP, the summon batch and the siphon rate all scale with it |
| The encounter (boss, adds and escort) | `Game.bossEncounter` — one clock, one flawless flag |

### The escort

`bossEscortCountForWave(wave)` = one trash per boss the pack used to field,
rolled from `spawnPoolForWave` exactly like a normal wave's enemies, and placed
*after* the boss in the roster so the boss leads.

It exists because the pack was not only durability, it was **bodies**: things to
cleave, chip damage arriving from several directions, a reason to cast an AoE on
a boss wave at all. Its HP and its gold both come **out of** the boss
(`bossMaxHpForWave`, `bossGoldForWave`), so it redistributes the encounter
rather than adding to it — the same §2.6 rule the phase machine was held to.

It is deliberately small. Every body on the wave buys spawn time in
`expectedWaveSeconds`, so a fat escort quietly buys the encounter a longer
enrage fuse: at three trash per boss, `npm run sim` put boss-wave budget use at
**52%** against the ~82% a boss wave has always run at, and the wall stopped
landing on boss waves at all.

## Phases

A boss crosses into phase 2 at **66%** and phase 3 at **33%** of max HP. Each
crossing:

- switches the active pattern,
- flashes **untargetable** for 0.7 s (`bossInvulnerable`, read through
  `isTargetable` — *not* a second invulnerability mechanism),
- emits `boss_phase`, which `Game` turns into a slow-mo beat, a screen pulse and
  a toast naming the pattern and its answer.

`bossPhase` only ever **increases**, and the target phase is recomputed from HP
every substep. That is what makes crossings idempotent: a bulwark heal or a
vitality aura can push a boss back above 66% and it will not re-fire the
transition, and a hit big enough to skip a whole phase still runs both crossings
in order.

> The pre-existing **50% HP enrage** (`+50%` fire rate, `+30%` speed, a brighter
> aura) is unchanged and still fires. It sits inside phase 2.

## Patterns

Four patterns, a closed union (`BossPattern` in `src/types.ts`) with a `Record`
consumer table (`BOSS_PATTERN_CONSUMERS`) and an exhaustive switch with a `never`
default in `EnemyManager.tickBossPattern`.

| Pattern | What it does | The answer it demands |
|---|---|---|
| `bulwark` | Puts up a shield worth **20% of max HP**. Break it within **10 s** or the boss converts the whole shield into HP and puts a fresh one up. | A DPS check. Saved cooldowns — Rain of Arrows, Meteor, Berserk. |
| `summon` | Every **6 s**, adds drawn from the wave's own spawn pool at the wave's own HP curve. The wave cannot end until they are dead. | AoE and clear speed — Frost Nova, mines, ricochet. |
| `slam` | **2 s** of growing ground ring, then `damage × 8` to the tower. Cut to **20%** if the boss is slowed or knocked back during the telegraph. | The first genuinely *reactive* moment in the game. |
| `siphon` | Drains **8 mana/s × the encounter weight** and heals **0.5% of max HP per second** of full drain. | Mana economy — spend it rather than pool it. |

### bulwark

A **broken bulwark stays broken for the phase.** This is the single most
load-bearing tuning decision in Part 3: an earlier version re-armed the shield
on a cooldown after each break, which turned a DPS *check* into a treadmill
worth several times the boss's own bar — `npm run sim` priced that at ten
wall-waves at every prestige tier.

The shield is `bossShield`, spent in `EnemyManager.damage` **before** HP and
before the warden ward. It is deliberately not `absorbShield`: that pool is
granted by a warden and collapses when the warden dies.

### summon

§3.2's "4 adds" is the figure for a *lone* boss, which is what there is again:
`bossSummonCountForWave` is `max(4, bossEncounterWeight)`, so one boss summons
what the pack used to summon between them — four at the shallow tiers, eleven at
wave 100. A global ceiling (`summonMaxAlive`, 40 alive) is the second brake.

Adds are extra to `enemiesToSpawn`; `WaveManager` waits for `aliveCount() === 0`,
so leaving them alive keeps the wave — and the enrage clock — running.

### slam

The telegraph is the mechanic. During it the boss **holds** (it does not
advance, and does not melee), a ring closes in on the canvas, and the boss bar
counts down.

Mitigation reads `EnemyManager.isSlowed(boss)` — the per-enemy chill map first,
so the question is whether *this* boss was controlled — plus a flag set by
`applyKnockback` and `applyShockwave`. The flag is **sticky** for the duration
of the telegraph: the answer is a reaction inside a two-second window, so it
counts even if the chill has worn off by the time the slam lands.

The first telegraph of a phase lands at a random point in the interval
(`slamInterval * (0.35 … 0.85)`), so it is not a beat the player can set a
metronome to. It was staggering across the pack back when lockstep telegraphs
from `2 + tier` bosses were one unanswerable hit rather than a rhythm.

Slam damage is **not** scaled by `bossEncounterWeight`. Everything the boss
holds *against the tower's damage* is; this is the one thing that costs tower
**HP**, and a wave-100 slam worth eleven of them is a one-shot dressed up as a
mechanic. The escort carries the chip damage the pack used to deal instead.

Damage goes out as `tower_damaged`, so it runs the same mitigation chain as a
melee hit and a siege shell: dodge → research DR → mana shield → wall → shield
charges → armour → defense → mana-shield talent.

### siphon

Priced **per second of drain**, not per point of mana: mana pools grow by orders
of magnitude across a run, and a heal priced per point would be a rounding error
at wave 10 and half the bar at wave 150. Pro-rated by how much mana was actually
available, so an empty pool feeds the boss nothing.

The drain rate is `siphonManaPerSecond * bossEncounterWeight` — the pack's
pressure, from one boss. The heal is a fraction of a bar that is `weight` times
bigger, so leaving the rate at the per-boss figure would let a deep-wave boss
heal the pack's worth of HP out of a fraction of the pack's mana.

It emits no events — the drain is continuous, and six particle bursts a frame
for one effect is not a readout. `Renderer.drawBossState` draws a live beam from
the tower to the boss straight off `bossPattern`.

## Pattern assignment

`bossPatternForPhase(tier, phase)`, where `tier = floor(wave / 10)`:

| Tier | Wave | Phase 1 | Phase 2 | Phase 3 |
|---:|---:|---|---|---|
| 1 | 10 | bulwark | bulwark | bulwark |
| 2 | 20 | bulwark | summon | bulwark |
| 3 | 30 | bulwark | summon | slam |
| 4 | 40 | bulwark | summon | slam |
| 5 | 50 | summon | slam | siphon |
| 6 | 60 | slam | siphon | bulwark |
| 7 | 70 | siphon | bulwark | summon |
| 8 | 80 | bulwark | summon | slam |

Tier 1 teaches one thing. Tier 2 adds `summon`, tier 3 adds `slam`. From tier 4
the whole roster is in play, **rotated by tier** so consecutive encounters are
not the same fight — every tier-4+ boss runs three *distinct* patterns, and
across four consecutive tiers every pattern appears in every phase slot.

> §3.2 says tier 4+ "draws all four, one per phase", which cannot be literal:
> there are three phases and four patterns. The rotation is the honest reading,
> and being deterministic is what makes the phase-count test meaningful.

Bosses are also **named** by tier (`bossNameForWave`) — "Wave 40 Devourer" is a
thing a player can talk about; "the wave-40 boss" is not. The table deliberately
contains no *Warden*: that is already an enemy type.

## Enrage timer

Distinct from the wave-level enrage in `formulas.ts` — that one punishes a
stalled *wave*; this one punishes a stalled *boss*.

Past **60 s alive**, a boss gains **+15% damage and +10% speed every 10 s**,
stacking (`bossEnrageStacksFor`). Applied as live multipliers at the point of
use rather than by mutating `e.speed` / `e.damage`, so it composes with the
wave-level enrage instead of compounding into it — and so the boss bar can read
the stack count straight off `bossEnrageStacks`.

Integrated on the **simulation** clock, so 60 s is 60 s of game time at 1x and
at 6.5x alike.

## Rewards

Scored per **encounter** (`bossEncounterOutcome`), and resolved by
`Game.resolveBossEncounter` when the wave's boss dies.

The encounter also pays what the pack paid, because the pack's whole budget is
on the one boss: gold is `bossGoldForWave` (the purse, less the escort's share),
XP is `xpPerKill('boss', wave)` weighted by `bossEncounterWeight`, orbs are the
undivided 3–5 (`bossOrbShare`), and the equipment roll runs
`bossEncounterWeight` times on the kill — under **one** toast, because
`2 + tier` separate "Equipment dropped" toasts is a wave the player cannot read.

| Condition | Reward |
|---|---|
| **Swift kill** — the boss dead inside **30 simulation seconds** of it spawning | **+50% boss gold**, and a **guaranteed** equipment drop **one rarity tier above** the roll |
| **Flawless** — the tower lost no HP during the fight | **+1 blessing reroll token**, and **+10% AP** on this run's ascension preview, cumulative |

Both announce with the existing toast + shockwave vocabulary.

"Lost no HP" means exactly that: a hit the wall or a shield charge absorbed
costs the player nothing, so the flag is cleared at the point `ts.hp` actually
drops. The swift-kill window runs on the simulation clock, so 6.5x speed makes
it easier in wall-clock terms and no easier in game terms.

The flawless AP bonus is the **first consumer** of `BlessingManager.grantRerollToken`,
which Part 1 built and nothing spent, and of `PrestigeManager.addRunApBonus` —
a run-scoped channel separate from the lifetime achievement bonuses, so the two
compose rather than one overwriting the other.

## The boss bar

`src/ui/BossBar.ts`, mounted in the overlay root, visible only while a boss is
alive. It shows:

- the tier name and, if more than one boss is somehow on the field, how many are still up,
- HP with **phase pips** drawn at 66% and 33%, and the bulwark shield as an
  overlay starting at the HP front so "how much is left" is one continuous read,
- the active pattern, its one-line answer, and the bulwark heal countdown,
- the **slam telegraph** countdown, which turns blue and reads `SLAM BLUNTED`
  the moment mitigation lands,
- the enrage timer — or, before enrage starts, the swift-kill window, because a
  reward the player cannot see is a reward they cannot chase.

`Game.bossBarSnapshot` resolves it once per frame in `frameUpdate` and pushes it
through `UIManager.setBossBarData`. The bar updates **above** `UIManager`'s
6-frame throttle: a two-second countdown read at 10 fps visibly stutters, which
is the one thing the bar exists to avoid. The caching `dom` helpers make an
unchanged frame free.

### Which boss does it track?

A wave has one, so `EnemyManager.leadBoss()` is in practice a lookup. The
selection rule is kept because nothing *guarantees* one — a mutator, a manual
spawn or a future multi-boss tier would all put a second on the field, and a bar
that silently tracked the first entry in the array is how a slam telegraph goes
unseen (in-browser verification caught exactly that with an eight-boss pack at
wave 60):

1. **A boss mid-slam-telegraph**, soonest to land first — the only thing in the
   encounter with a deadline.
2. Otherwise the one **closest to dying** — the next to phase.

The on-canvas rings are drawn for **every** boss (`Renderer.drawBossState`), so
what is slamming is always answerable on the field; the bar answers *how long*.

## The durability budget

Bosses were already the wall at every prestige tier — `npm run sim` puts a
wave-40 boss at **0.99 of its enrage budget** at 100 lifetime AP. An
uncompensated phase machine moved the wall a full decade at every tier.

So Part 3 is held to Part 2's §2.6 rule: **new content replaces what is there
rather than adding to it.**

- `BOSS_PATTERN_HP_WEIGHT` prices what each pattern holds *outside* the HP bar,
  as a fraction of max HP: `bulwark` 0.20, `summon` 0.10, `siphon` 0.04,
  `slam` 0 (it costs tower HP, not tower damage).
- `bossPhaseHpFactor(wave)` sums that over the three patterns the wave's tier
  draws — 1.60 at tier 1 (three bulwark phases), 1.14–1.30 from tier 4.
- `bossEncounterHpForWave(wave)` = `bossHPForWave(...) * bossEncounterWeight(wave)`
  — the whole wave, which is what the pack used to be between them.
- `bossMaxHpForWave(wave)` = `(bossEncounterHpForWave - escort) / bossPhaseHpFactor`,
  where `escort` is `bossEscortHpForWave` clamped by `BOSS_BAR_MIN_SHARE` (0.8),
  so the escort can never eat more than a fifth of the encounter's bar. In
  practice it lands at 4–14% and the clamp never binds.

The bar shrinks by exactly what the machine and the escort hold, so a boss wave
costs the same total damage it did before phases existed — `npm run sim`
reproduces the pre-Part-3 curve to the wave, and reproduced it again across the
pack-to-single change (wave-100 wave HP moved 74.5M → 75.1M, entirely the
escort's behavioural effective-HP factors). `tests/boss.test.ts` asserts both
identities: the HP one and the purse.

**Gold and XP are still priced at the pre-Part-3 encounter** — `bossGoldForWave`
and `xpPerKill` carry `bossEncounterWeight`, and gold additionally pays the
escort out of the same purse (`BOSS_PURSE_MIN_SHARE` is the guard, at 0.25). The
encounter is worth what it always was; the phases are not paid for twice.

What Part 3 actually adds is *fail states* — a bulwark that heals back, adds
that must be cleared, a slam that costs tower HP — none of which a model with no
tower HP and no player attention can see. That is what the browser pass and the
unit tests are for.

## Persistence

Boss state is split deliberately:

| State | Persisted? |
|---|---|
| `GameState.bossRun` — flawless AP bonus, swift/flawless counters | **Yes**, `SAVE_VERSION` 11 |
| Phase, pattern, timers, the bulwark shield, the encounter clock | **No** |

Live enemies have never been part of the save format, so a load lands with an
empty roster and `WaveManager` resolves the wave rather than resuming half a
boss. `Game.applyPersistedState` clears `bossEncounter` explicitly so a load
mid-fight cannot leave a clock ticking against a boss that is not there, and
`wave_started` drops any encounter whose wave no longer matches — which covers a
wave rewind and the manual wave controls.

What must survive a reload is the reward the player already won, and that is
what `bossRun` is.

## Events

| Event | Payload | Consumer |
|---|---|---|
| `boss_spawned` | `{ enemy, wave, pattern }` | Starts the encounter clock and the flawless flag |
| `boss_phase` | `{ enemy, phase, pattern, x, y }` | Slow-mo, screen pulse, entry ring, pattern toast |
| `boss_shield_up` / `boss_shield_broken` | `{ enemy, x, y }` | Bulwark rings |
| `boss_bulwark_held` | `{ enemy, x, y, amount }` | Heal number + "the boss healed the shield back" |
| `boss_summon` | `{ enemy, x, y, count }` | Summon burst |
| `boss_slam_telegraph` | `{ enemy, x, y, duration }` | (the ring and the bar read state directly) |
| `boss_slam` | `{ enemy, x, y, damage, mitigated }` | Shake, flash, impact ring — and `tower_damaged` |
| `boss_enrage_stack` | `{ enemy, stacks, x, y }` | The one-time "the boss is enraging" warning |
| `boss_enraged` | `{ enemy }` | Pre-existing 50%-HP enrage (unchanged) |
| `boss_killed` | `{ x, y, goldValue }` | Pre-existing death shockwave and gold (unchanged) |

## Testing

`tests/boss.test.ts` drives the real `EnemyManager` at a fixed `dt`. The
substep-invariance tests run at **both** `1/120` and `(6.5/60)/6` — the coarsest
step `Game.update` ever produces, at maximum game speed with the substep clamp
biting — and assert the same phase count, the same bulwark schedule and the same
enrage stacks.

`tests/content-coverage.test.ts` guards the closed union: every `BossPattern`
has a real consumer entry, a name, an answer, a durability price, and a tier
that actually draws it.
