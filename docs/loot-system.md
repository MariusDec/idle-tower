# Loot Orbs & the Active Verbs

**Files:** `src/systems/LootManager.ts`, `src/data/loot.ts`, `src/systems/ActiveInput.ts`,
`src/data/tower.ts` (`MANUAL_AIM`), `src/game/Game.ts`, `src/main.ts`, `src/game/Renderer.ts`,
`src/ui/PlacementPrompt.ts`

## Overview

Gameplay plan Part 4 adds three optional things to do with the mouse. Each one has an
**automatic fallback that pays less**, which is the rule the whole plan is written around:

| Verb | What the player does | What happens if they do nothing |
|---|---|---|
| **Loot orbs** | Click an orb → 100% of its value | It drifts to the tower over 8 s and pays **40%** |
| **Charged shot** | Hold the cursor still 1.2 s, release | Nothing. The verb is strictly additive |
| **Placed abilities** | Hotkey arms, next click places | The ability places itself on the densest cluster |

Nothing in Part 4 blocks, and nothing has to be clicked for a run to progress.

## Loot orbs

### Drops

| Source | Orbs | Notes |
|---|---|---|
| Boss | `bossOrbShare(wave)` | **3–5 per *encounter*** |
| Elite | 1–2 | Always |
| Anything else | 2% chance of 1 | |

The budget is per *encounter*, and for one release it had to be divided: Part 3 gave a boss wave
a pack of `2 + tier` bosses, and read per boss a wave-100 pack would have dropped sixty orbs into
a forty-orb cap. A boss wave fields one boss again, so `bossOrbShare` pays the whole 3–5 budget on
that one kill and the division is gone. The escort drops on the ordinary 2% rule, like any other
trash.

### Kinds

| Kind | Value | Consumer |
|---|---|---|
| `gold` | `12 ×` a wave-normal kill, times the composed gold multiplier at collection | `ResourceManager.addGold` |
| `mana` | 12% of max mana | `ResourceManager.addMana` |
| `reroll` | 1 token | `BlessingManager.grantRerollToken` (Part 1's draft) |

`LootOrbKind` is a closed union with a `Record` of consumers (`LOOT_ORB_CONSUMERS`) and a `never`
default in `LootManager.payout`, so a kind nothing spends is a compile error.

Reroll orbs only roll from bosses (4% of boss drops). Mana orbs only roll once mana is unlocked
at wave 10 — before that a mana orb would be a currency the player does not have.

### Collection

- **Click / tap** anything within `clickRadius` (34 canvas units) → **100%**, and *every* orb in
  the radius, not just the nearest. Generous on purpose: the same handler serves a fingertip on a
  canvas scaled down to phone width.
- **Drift**: after a 0.35 s outward pop, an orb homes to the tower at "cover what is left in the
  time that is left", arriving exactly at 8 s, and auto-collects for **40%**.
- The **`orb_magnet` blessing** (`bl_magnet`, "Lodestone") raises the auto rate to **100%** and
  halves the drift time.

**Reroll orbs pay in full either way.** A token cannot be 40% of a token, and the idle contract is
the thing Part 4 is most able to break — a 40% chance of losing a Part 1 reroll for not watching
the screen is exactly the pressure the plan forbids. The 40/100 split applies to the two divisible
currencies.

### Cap and pooling

40 live orbs; a spawn past the cap evicts the **oldest**, which is the one closest to
auto-collecting anyway. An evicted orb **expires without paying** — that is what "expires" means —
but the drop budget is sized so it never fires in normal play (a wave-100 boss encounter is about
four orbs).

Orbs are pooled: dead entries go on a free list and are re-initialised in place, and removal is an
in-place compaction rather than a `splice`. A wave that drops a hundred orbs allocates nothing
after the first few. The renderer blits one cached sprite per kind (see
[performance.md](performance.md)); only the bob and pulse are live, and neither allocates.

**A consequence worth knowing when writing tests:** an orb object outlives its orb. Hold the `id`,
never the object.

### Not persisted

Orbs are **never saved**. `Game.tryLoadSave` calls `LootManager.clear()`, and `SaveManager` carries
a comment saying why. Live enemies and projectiles were never persisted either — a load starts with
an empty field and `WaveManager` restarts the wave — so an orb would have nothing to drift toward.
Persisting them would also let a player bank a boss encounter's drops across a reload and click them all
at full value later, which is the one way the 40/100 split could be gamed.

Orbs are also run-scoped: `applySavedStateReset` (ascension and transcendence) drops them.

## Charged shot

Holding the mouse still for `MANUAL_AIM.chargeSeconds` (1.2 s) arms a shot; releasing fires it.

| Property | Value |
|---|---|
| Damage | `1 ×` an ordinary shot, **per target** |
| Pierce | `+3` (so up to four bodies) |
| Splash | 90 px at 60% |
| Cooldown | 4 s |
| Move tolerance | 18 canvas units |

It is **strictly additive**: it does not consume the tower's cooldown, spend mana, or interrupt
the ordinary volley. A player who never holds loses nothing.

### Why 1× and not the plan's 6×

The §4.5 idle-parity check is the gate, and at 6× the measured active advantage was **+127%** at 0
lifetime AP — two and a half times the +50% line the plan itself names as the point to cut. The cut
has to be steep because the charged shot is a flat multiple of *one shot* on a cycle measured in
wall-clock seconds, so its worth scales inversely with fire rate: the same 6× is +93% of a fresh
tower's DPS at 1.8 shots/s and about +8% of a late tower's at 20 shots/s. That is not a number that
can be balanced at both ends.

What survives is the plan's *shape*, not its number. With `+3` pierce and the 90 px splash intact,
a charged shot into a lane still delivers four full hits plus the blast — around 6× an ordinary
shot's total output, which is what §4.2 was reaching for. It just is not 6× on one body.

### Why the timers are wall-clock

`ChargeTracker` runs on `realDt` in `frameUpdate`, following the precedent Part 1 set for the draft
timers. The timer measures **a person holding still**. A 1.2 s hold that shrinks to 0.18 s at 6.5×
speed is not the verb the plan describes, and a 4 s cooldown that shrinks to 0.6 s would make the
charged shot six times stronger the moment the Accelerator perk is bought — the opposite of what an
idle game should reward.

Everything the charge *does* still happens inside `Game.simulate`: the release sets
`chargeFirePending`, and the next fixed substep fires the projectile, so it travels and collides
like any other shot at any game speed. **Orb drift is the other way round** — it is time-integrated
movement, so it runs on the simulation clock and takes 8 game-seconds at every speed.

## Targeted abilities

Five abilities carry an `areaRadius` in `src/data/abilities.ts` and are therefore **targeted**:

| Ability | Disc at L1 | At max level | What the disc does |
|---|---:|---:|---|
| Rain of Arrows | 170 px | 314 px | The disc **is** the hit — nothing outside it is touched |
| Frost Nova | 190 px | 316 px | A hard chill inside; a 15% global floor outside |
| Chain Lightning | 120 px | 192 px | The chain seeds here rather than at the tower |
| Rocket Barrage | 220 px | 360 px | Rockets pick targets inside it |
| Meteor Strike | 70 px | 151 px | The crater is here, and the heavy hit goes to the highest-HP enemy in it |

The disc is `placementRadius(id, level) × abilityAreaMultiplier`, read through
`AbilityManager.getEffectiveRadius(id)`. It grows with the ability's level, the `arcane_expansion`
research, the `ar_frostbite` talent and the arcane core — so the reticle the player sees is a real
readout of a stat they have been investing in, not a fixed decoration.

### The disc is the effect, and aiming is a bonus on top

These used to be global effects with a bonus disc drawn over them, which meant the reticle
described a shape the ability did not have. Now the disc is the ability's actual footprint, and
what aiming buys is choosing *where* it lands plus a focus bonus: `PLACEMENT_FOCUS_DAMAGE_BONUS`
(+25%) across the whole disc, a deeper and 1.5x-longer chill for Frost Nova, +2 bounces for Chain
Lightning. Frost Nova keeps a level-independent 15% **global** slow so an idle player's panic
button never regresses.

A placement on empty ground is **refused**: `Game` declines the press, no mana is spent, and the
arming state stays up. The reticle warns first — it flips to red with a `0` count badge before the
click.

### Routing: your press aims, automation places

- **A manual press always arms.** `Game.castAbility` routes any targeted ability to
  `beginPlacement(id)` — hotkey and ability-bar click alike — and the next canvas press casts with
  the pointer's position and the focus bonus.
- **Automation places for you.** `AutomationManager.runAutoCast` casts with `'auto'` when the
  **auto-aim** setting is on (the default) and `'tower'` when it is off.

`AbilityManager.tryCast(id, wave, 'auto')` calls `pickBestSpot(id)`, which scores every enemy
position by how much is inside the disc around it and takes the best. Candidates are enemy
positions rather than a grid sweep, because the best disc always has an enemy near its centre; the
scan uses `EnemyManager.queryRadius` with a shared scratch buffer, copied into a fresh array before
any damage is dealt so a kill cannot re-enter the iteration.

Meteor Strike scores by **HP** rather than head count, which is what keeps it the boss nuke it has
always been: a boss's bar dwarfs a crowd's, so the auto-placer picks the boss exactly as
`pickHighestHpTarget` used to, and only prefers a pile when the pile is worth more.

Putting the placer *behind* the cast rather than in front of it means every automatic path shares
one implementation with nothing to drift.

### The auto-aim setting

Settings → Abilities, **default on**, stored in `localStorage` (no save-version bump). It governs
**automation only** — it cannot make your own press skip aiming, because a press that aims is the
whole point. The legacy `instantCast` key (which meant the opposite: "auto-aim my presses") is read
once on load, carried into `autoCastAutoAim`, and removed.

Placement mode **never outlives its reason** — this is the invariant `AbilityPlacement` exists to
guarantee:

- pressing the same hotkey again cancels;
- `Escape` cancels (ahead of the keybinds overlay, since it is the state that changes what a click
  does);
- a `wave_started` event cancels;
- an ascension or transcendence cancels;
- a **successful** cast leaves the mode; a refused one (empty disc, or mana drained between the
  arming and the click) keeps it up, with a toast rather than a stuck prompt.

### Gold Rush and the loot magnet

Gold Rush holds `LootManager.setMagnetSource('goldRush', true)` for its duration and drops it in
`clearEffect`. The magnet is reference-counted through a `Set` of source names, so Gold Rush
overlapping the `orb_magnet` blessing is safe in either order — the magnet is on while at least one
source is held. Boosted gold drops that age out uncollected are not boosted gold.

## Input routing

`main.ts` funnels both mouse and touch presses through one `pressAt(x, y)`, which calls
`Game.handleCanvasPress`. The order is load-bearing:

0. **Boss intro** playing (UI plan §5.D) → skip it (jump to the 0.35 s retract) and consume the
   press. This sits ahead of everything else and lives in `pressAt` rather than in
   `handleCanvasPress`, because a tap meant to dismiss a cinematic must not also drop a meteor or
   start an aim hold.
1. **Loot orb** under the cursor → collect, consume the press.
2. **Pending placement** → place the ability, consume the press.
3. Otherwise → the press becomes an ordinary manual-aim hold.

Keyboard follows the same rule: the `keydown` handler calls `Game.skipBossIntro()` after its
focused-input and modifier guards and before ability hotkeys, so any key skips the intro and does
nothing else that frame.

A consumed press still updates the aim point, so clicking an orb does not snap the tower's aim back
to wherever the cursor previously was. Because both pipelines share the function, tapping an orb
and charging on touch work without a second implementation.

## Balance

`npm run sim` prints two Part 4 tables.

**Idle parity (§4.5)** — fully idle versus perfect active play, measured as composed DPS at the
wave the *idle* run walls on (so it includes the upgrades the extra orb gold bought):

| Lifetime AP | Wall (idle) | Wall (active) | Active advantage | shots/s |
|---|---:|---:|---:|---:|
| 0 | 39 | 49 | **+45.2%** | 1.78 |
| 100 | 59 | 59 | **+35.4%** | 2.44 |
| 1 K | 89 | 89 | **+34.7%** | 3.40 |
| 10 K | 129 | 129 | **+34.8%** | 4.72 |
| 100 K | 169 | 169 | **+33.9%** | 6.04 |

Those were the numbers **while manual aim still carried its flat x1.3 fire rate**. Part 4's
measurement showed that bonus filling the whole band on its own (+33.9…+38.9% with the charged shot
switched off entirely), which is what §4.2 meant by *replacing* it rather than stacking on top. It
has since been removed — see [tower-system.md](tower-system.md) — and the charged shot re-tuned to
carry the budget by itself:

| Lifetime AP | Wall (idle) | Wall (active) | Active advantage | shots/s |
|---|---:|---:|---:|---:|
| 0 | 39 | 49 | **+34.7%** | 1.84 |
| 100 | 59 | 59 | **+28.6%** | 2.44 |
| 1 K | 89 | 89 | **+36.0%** | 3.46 |
| 10 K | 129 | 129 | **+28.9%** | 4.72 |
| 100 K | 169 | 169 | **+27.3%** | 6.10 |

Parts 5-7 have each re-measured this table, because every one of them added a gold channel and the
metric multiplies whatever gold advantage active play already has. It is also **stepwise and
non-monotonic** — composed DPS at one wave, with a greedy buyer that crosses upgrade breakpoints in
discrete jumps — so a small change can move a tier by ten points in either direction. As of Part 7
(which added the momentum bonus for calling waves early, an active-only channel, and the combo,
which is not):

| Lifetime AP | Wall (idle) | Wall (active) | Active advantage | shots/s |
|---|---:|---:|---:|---:|
| 0 | 39 | 49 | **+33.3%** | 1.78 |
| 100 | 59 | 69 | **+33.0%** | 2.44 |
| 1 K | 89 | 89 | **+32.2%** | 3.46 |
| 10 K | 129 | 129 | **+38.1%** | 4.78 |
| 100 K | 169 | 169 | **+30.0%** | 6.10 |

All five tiers land inside the +25–40% band. §7.1's momentum cap was sized against this table
specifically — see `EARLY_CALL_GOLD_PER_SECOND` in `src/data/pacing.ts`.

The Part 4 retune also changed the charge's *shape*: its
payload is denominated in seconds of the tower's own sustained fire (`chargeDpsSeconds`), not in
multiples of one shot. A flat multiple is worth `1/fireRate` of the tower's output, so the same
constant measured +57% at 1.8 shots/s and +10% at 6.1 — the verb decayed into irrelevance exactly
where the player has the most fire rate to surrender by holding still. Pricing it in DPS-seconds
holds its worth flat across every prestige tier.

**The orb faucet (§4.1)** — orb gold as a share of a wave's income:

| Wave | idle (40%) | clicked (100%) |
|---|---:|---:|
| 9 | 5.0% | 12.4% |
| 10 (boss) | 41.2% | 103.1% |
| 39 | 3.0% | 7.4% |
| 40 (boss) | 21.5% | 53.7% |
| 99 | 3.0% | 7.4% |
| 100 (boss) | 10.8% | 26.9% |

Ordinary waves gain a few percent; boss waves gain a lot, because the encounter budget does not
shrink with the small enemy count of a boss wave. That is deliberate — a boss wave is the moment
the game most wants the player's attention — and it is why boss waves are the ones where clicking
is worth showing up for.

**Wall-wave drift is zero.** The idle table (39 / 59 / 89 / 129 / 169) is unchanged from Part 3, so
the curve the game is balanced around has not moved; what Part 4 added is a ceiling for players who
engage, not a higher floor. The blessing table moved at exactly one tier (10 K: 147.6 → 146.1)
because Lodestone is now drawable and occasionally displaces a stronger card.

`sim/model.ts` learned about all of it: `orbGoldForWave`, an `active` run mode, and an `ACTIVE_PLAY`
table. `MANUAL_AIM` is read by the sim *and* by the game, so the multiplier can only be cut in one
place.

## Events

| Event | Payload | Emitted by |
|---|---|---|
| `orb_spawned` | `{ kind, x, y, value }` | `LootManager.spawn` |
| `orb_collected` | `{ kind, amount, full, rate, x, y }` | `LootManager.collect` |
| `charged_shot` | `{ x, y, damage }` | `Game.fireChargedShot` |

`orb_collected` is what Part 5's `collect_orbs` contract goal will subscribe to.

## Edge cases

- **`LootManager.setValueBonus(v)`** sets the Prospector talent's orb value
  bonus; called from `Game.applyResolvedStats` with `stats.orbValueBonus`.
- **A boss encounter's drops landing at once** stay inside the cap by construction; the test asserts it at
  waves 10 through 200.
- **An orb spawned on top of the tower** arrives immediately (`arriveRadius`, 26 px) and pays the
  auto rate.
- **Charging while placing** is suppressed: the ring does not fill under a click that means
  something different.
- **Releasing twice** fires once — `ChargeTracker.setPointer` only reports the release that armed
  the shot.
- **Jitter inside the tolerance** does not reset the timer; a larger move re-anchors, so a player
  can settle somewhere new and charge again without lifting the button.
- **`orb_magnet` mid-flight**: the drift time is read live, so taking Lodestone speeds up orbs that
  are already in the air.
