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

A boss wave spawns `bossCountForWave(wave)` = **`2 + tier`** bosses — three at
wave 10, six at wave 40, twelve at wave 100. Everything below is **per boss**;
the pack is why several of the numbers are divided.

| Concept | Where it lives |
|---|---|
| Phase, pattern, timers | Fields on the `Enemy` (`bossPhase`, `bossPattern`, …) |
| The machine | `EnemyManager.tickBoss`, inside `resolveStance`'s `boss` branch |
| The encounter (all bosses on the wave) | `Game.bossEncounter` — one clock, one flawless flag |

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
| `siphon` | Drains **8 mana/s** and heals **0.5% of max HP per second** of that drain. | Mana economy — spend it rather than pool it. |

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

§3.2's "4 adds" is the figure for a *lone* boss. `bossSummonCountForWave`
divides the batch across the pack, so a wave-100 encounter with twelve bosses
fields one add each rather than forty-eight. A global ceiling
(`summonMaxAlive`, 40 alive) is the second brake.

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

First telegraphs are staggered at random across the pack
(`slamInterval * (0.35 … 0.85)`), because `2 + tier` bosses telegraphing in
lockstep is one unanswerable hit rather than a rhythm.

Damage goes out as `tower_damaged`, so it runs the same mitigation chain as a
melee hit and a siege shell: dodge → research DR → mana shield → wall → shield
charges → armour → defense → mana-shield talent.

### siphon

Priced **per second of drain**, not per point of mana: mana pools grow by orders
of magnitude across a run, and a heal priced per point would be a rounding error
at wave 10 and half the bar at wave 150. Pro-rated by how much mana was actually
available, so an empty pool feeds the boss nothing.

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

Scored per **encounter**, not per boss (`bossEncounterOutcome`), and resolved by
`Game.resolveBossEncounter` when the last boss of the wave dies. Paying a reroll
token per boss would make "flawless" mean "flawless, times six".

| Condition | Reward |
|---|---|
| **Swift kill** — every boss dead inside **30 simulation seconds** of the first one spawning | **+50% boss gold**, and a **guaranteed** equipment drop **one rarity tier above** the roll |
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

- the tier name and, when the pack is more than one, how many are still up,
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

`EnemyManager.leadBoss()`, in order:

1. **A boss mid-slam-telegraph**, soonest to land first. This is the only thing
   in the encounter with a deadline. In-browser verification caught the
   alternative: with an eight-boss pack at wave 60 the countdown belonged to a
   boss the bar was not watching, so the telegraph never surfaced.
2. Otherwise the one **closest to dying** — the next to phase, and in practice
   stable, since a focused target stays lowest until it dies.

The on-canvas rings are drawn for **every** boss (`Renderer.drawBossState`), so
*which* boss is slamming is always answerable on the field; the bar answers
*how long*.

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
- `bossMaxHpForWave(wave)` = `bossHPForWave(...) / bossPhaseHpFactor(wave)`.

The bar shrinks by exactly what the machine holds, so a boss wave costs the same
total damage it did before phases existed — `npm run sim` reproduces the
pre-Part-3 curve to the wave. `tests/boss.test.ts` asserts the identity.

**Gold and XP are deliberately not compensated** (`goldDropForWave`,
`xpPerKill`): the encounter is worth what it always was.

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
