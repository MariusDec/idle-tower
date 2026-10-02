# Progress — the long horizon

**Goal:** the game currently ends. Not "gets slow" — *ends*. Measured with the
shipping tables through `sim/model.ts`, the prestige ladder reaches wave ~350
in four ascensions and then advances **0–10 waves per run forever**, while a
single run at that depth costs **9 hours of simulation time** (≈3 h of wall
clock at the 3× speed ceiling) of which **~88% is a spawn queue the tower is
never at risk in**. The Long Watch's last chapters (wave 400, wave 450, tower
level 175) are unreachable at any amount of play. This plan is the diagnosis,
the four structural changes that give the game a horizon, and the content that
makes that horizon worth walking.

**Related components:** `src/data/formulas.ts`, `src/data/prestige.ts`,
`src/data/upgrades.ts`, `src/data/xpTables.ts`, `src/data/watch.ts`,
`src/data/blessings.ts`, `src/data/enemies.ts`, `src/data/pacing.ts`,
`src/data/equipment.ts`, `src/data/research.ts`, `src/systems/WaveManager.ts`,
`src/systems/EnemyManager.ts`, `src/systems/PrestigeManager.ts`,
`src/systems/SaveManager.ts`, `src/game/Game.ts`, `src/types.ts`, `sim/*`,
`tests/*`, `docs/*`.

**Status:** **implemented** — phases 0-11 of the work order in
[progress-steps.md](progress-steps.md) have landed: the Accelerator fix and the
stale docs (§1), the ladder report in `sim/ladder.ts` (§2), the bought upgrade
ceiling (§3), `AP_DEPTH_GROWTH` 1.06 → 1.03 (§4), the spawn window and the body
cap (§5), deployment checkpoints (§6), the re-anchored Long Watch (§7), the
depth-scaled blessing pick cap and its greater tier (§8), the repeatable
`field_studies` research node (§9), and the depth bands and champions (§10).
Appendix A has since landed too: the three new enemy types (§7.1 — harbinger,
leech, chorus), Ordeal bosses (§7.3, the data half; the `tether` and `eclipse`
patterns still need combat code) and gear reforging (§7.5). §7.5's endless AP
node was considered and deliberately rejected (see progress-steps §9).

Against the §2 targets, T1 (ladder advance), T3 (run length at the speed
ceiling) and T4 (share of run minutes at risk) now pass. **T2 does not**: the
ladder advances ~+10 waves a run and plateaus around wave 360 rather than
reaching wave 450, so the Long Watch's deepest chapters are still out of reach.
That is the one open item from this plan.

Every number below was produced by running the shipping data through
`sim/model.ts` on the pre-implementation tree (`npm run sim` plus the six probes
in §9); each is labelled with the probe that produced it so it can be
re-derived after a change.

**How to read this:** §1 is the measured diagnosis — read it before arguing
with any constant. §2 is the design targets the changes are steered against.
§3–§6 are the four structural changes, in leverage order. §7 is content for
the horizon they open. §8 is the corrections the diagnosis turned up along the
way. §9–§12 are the new measurement, tests, docs, task order and tuning levers.

---

## 1. Measured baseline

### 1.1 The prestige ladder terminates after four runs

Probe A (§9.1) drives `simulateRun` run-by-run: each row's damage and gold
multipliers come from `lifetimeAPDamageBonus(lifetime AP)`, and the AP it banks
is `apForWave(wall)` — the same two functions the game uses.

| run | lifetime AP entering | wall | Δ wall | run length | AP banked |
|----:|---------------------:|-----:|-------:|-----------:|----------:|
| 1 | 0 | 40 | +40 | 0.9 h | 88 |
| 2 | 88 | 138 | +98 | 2.6 h | 52.8 K |
| 3 | 52.9 K | 249 | +111 | 5.2 h | 47.3 M |
| 4 | 47.4 M | 308 | +59 | 6.9 h | 1.65 B |
| 5 | 1.70 B | 329 | +21 | 7.5 h | 5.81 B |
| 6 | 7.51 B | 339 | +10 | 7.9 h | 10.6 B |
| 7 | 18.1 B | 347 | +8 | 8.6 h | 17.1 B |
| 8 | 35.1 B | 349 | +2 | 8.3 h | 19.2 B |
| 9 | 54.4 B | 349 | **+0** | 8.2 h | 19.2 B |
| 10 | 73.6 B | 357 | +8 | 9.2 h | 31.0 B |
| … 16 | 279 B | 359 | +0 | 8.6 h | — |

Runs 9 through 16 multiply lifetime AP by **50×** and buy **+10 waves**.
That is the whole late game as it ships.

The shape is not an accident of the tables; it is a fixed point. A run at wall
`W` banks `apForWave(W) ∝ 1.06^W`. Lifetime AP converts to damage at
`0.02 · A^0.7`, so damage `∝ 1.06^(0.7W) = 1.0415^W`, while enemy HP grows at
`1.11^W`. One run therefore returns `0.0407 / 0.1044 ≈ 0.39` of the depth it
was launched from, plus whatever the in-run economy can carry on its own —
call that `c`:

```
W' = 0.39 · W + c        →        W* = c / 0.61
```

§1.2 measures `c = 219`. `219 / 0.61 = 359`. The observed asymptote is **359**.

### 1.2 Gold stops mattering at wave 219, and the cause is one constant

Probe B (§9.2) hands the run an unlimited gold multiplier and no damage bonus:

| gold multiplier | wall |
|---:|---:|
| ×1 | 28 |
| ×10³ | 197 |
| ×10⁶ | 219 |
| ×10⁹ | **219** |
| ×10¹² | **219** |

Past ×10⁶ gold buys **nothing**. Every purchasable line is capped
(`src/data/upgrades.ts`), and the binding one is `damage.maxLevel = 200`:
each level is worth exactly +11% against `ENEMY_HP_GROWTH = 1.11`, so 200
levels *is* 200 waves of HP growth and there is no 201st. Raising that one
number in the probe:

| caps | wall at unlimited gold |
|---|---:|
| stock | 219 |
| `damage.maxLevel` 200 → 2000 | 419 |
| every line raised to 5,000 | 539 |

This is the single highest-leverage number in the game. It also means every
gold system in the game — Ascendant Fortune, Tycoon, Astral Harvest, Golden
Age, Prosperity, Alchemy, Transmutation, Treasure Hunter, Salvage, the combo
meter, the risk dial's +25%/step, contract gold, loot orbs, Golden Tide, thief
recovery, gear sales — **has a hard expiry at wave 219** and is inert for the
rest of the game.

With the caps raised, both channels come back to life (probe B):

| channel | waves bought per ×10 |
|---|---:|
| gold, stock caps | 0 (past ×10⁶) |
| gold, every cap at 5,000 | ~28 |
| damage, stock caps | ~20 |
| damage, every cap at 5,000 | ~40 |

### 1.3 A run is a spawn queue, not a fight

Probe C (§9.3), at the run-4 power level (wall 359, 9.1 h):

| wave | bodies | spawn floor | measured clear | spawn-bound? |
|---:|---:|---:|---:|:--|
| 51 | 65 | 26 s | 28 s | yes |
| 101 | 125 | 50 s | 52 s | yes |
| 151 | 185 | 74 s | 76 s | yes |
| 201 | 245 | 98 s | 100 s | yes |
| 251 | 305 | 122 s | 124 s | yes |
| 301 | 365 | 146 s | 148 s | yes |
| 351 | 425 | 170 s | 172 s | yes |
| 357 | 432 | 172 s | 324 s | **no** |

From wave 51 to wave 351 the clear time *is* the spawn floor, to within the
intermission. The tower's DPS is irrelevant for 300 consecutive waves; the wave
takes exactly as long as the portal needs to emit its roster. Only the last
**five to eight waves** of a nine-hour run are a fight — the deepest ten waves
are **12% of the run's minutes**, and everything before them is a queue.

The floor is `spawnIntervalForWave(w) · (count − 1)` with
`count = 5 + 1.2(w − 1)` and the interval floored at 0.4 s, so it grows
**linearly in depth** and total run time grows **quadratically**:

| wall | run length (sim seconds) | at the 3× speed ceiling |
|---:|---:|---:|
| 138 | 2.6 h | 52 min |
| 249 | 5.2 h | 1 h 44 |
| 359 | 9.1 h | 3 h 02 |
| 549 (if reachable) | ~20 h | 6 h 40 |

And it is *foreground* time: `computeOfflineProgress` repeats the last measured
wave at `OFFLINE_YIELD_FRACTION = 0.25` and deliberately never advances the
wave number, so depth can only be gained while the app is on screen and
`requestAnimationFrame` is running.

### 1.4 The speed ceiling is 3×, and the perk that raises it is half-broken

`GAME_SPEEDS = [0.5, 1.0, 1.5]`, `MAX_SPEED_INDEX = 2`, and
`Game.computeSpeedForIndex` adds 0.5× per index past the array
(`src/game/Game.ts:2873`). `Game.syncUiApis` then does

```ts
this.maxSpeedIndex = MAX_SPEED_INDEX + this.prestigeMgr.getGameSpeedBonus();
```

where `getGameSpeedBonus()` returns `computePerkEffect` = **0.5 × level**, not
a level count. So a maxed Accelerator (6 levels, 560 TP) sets
`maxSpeedIndex = 2 + 3 = 5` → **3.0× top speed**, against a perk that promises
+0.5× per level (i.e. 4.5×) and a `docs/game-loop.md` that says 6.5×. Worse,
odd levels leave `maxSpeedIndex` fractional (2.5, 3.5, 4.5):
`getAvailableSpeeds()` iterates integers, so levels 1, 3 and 5 add **no
selectable speed at all**, while `setSpeedIndex` will happily clamp to 2.5 and
run the game at 1.75×. This is the same class of defect the perk's own comment
records having fixed once already.

### 1.5 Nothing new happens after wave 100

| content | last new thing | source |
|---|---:|---|
| Enemy types | wave 45 (`burrower`) | `ENEMY_DEFS[*].unlockWave` |
| Active abilities | wave 55 | `ABILITIES[*].unlockWave` |
| Passive abilities | wave 88 | `PASSIVE_ABILITIES[*].unlockWave` |
| Elite spawn rate | wave 100 (caps at 20%) | `ELITE_SPAWN_CHANCE_MAX_WAVE` |
| Gear rarity ramp | wave 100 (`t` clamps to 1) | `rollRarity` |
| Blessing drafts | ~wave 119 (30-pick cap) | `BLESSING_MAX_PICKS`, interval 4 |
| Boss patterns | 4, all seen by wave 40 | `BOSS_PATTERN_NAMES` |
| Elite auras | 5 | `EnemyManager` |
| Wave mutators | 9, evergreen | `WAVE_MODIFIERS` |

From wave 120 to the wall — **two thirds of every run, and 90% of its
minutes** — the game presents one composition of one roster with no new
mechanic, no new decision, and (per §1.3) no risk. The blessing cap is the
sharpest: the run's only roguelite layer, the one thing that makes run #40
different from run #4, switches off at wave 119 and the remaining 240 waves
are played on a frozen build.

### 1.6 Every currency except TP is spent out within three runs

Probe D (§9.4) sums each tree at full purchase:

| tree | total cost | earned per run at the wall (run 3+) | verdict |
|---|---:|---:|---|
| AP perks (all bounded nodes) | **24,144 AP** | 47 M | bought out in run 3 |
| Tower cores (all four) | 225 AP | — | bought out in run 3 |
| Research (all 18 nodes, all ladders) | **66,730 RP** (RP = AP gained) | 47 M | bought out in run 3 |
| TP perks (all bounded nodes) | 33,568 TP | 4.7 K (`4·AP^0.4`) | healthy — many transcendences |

After run 3 the only AP destinations are `ap_might` / `ap_fortune`, and those
are dominated by the automatic term they share a bracket with. From
`src/stats/contributors/prestige.ts`:

```ts
ap.mult('baseDamage', 1 + p.lifetimeDamage + p.apDamage);
```

At 10⁵ lifetime AP that is `1 + 63.2 + 0.88` — **the entire chosen AP tree is
1.4% of its own bracket**, and by run 5 (1.7 B lifetime AP) it is 10⁻⁵ of it.
The player's late-game power is a number they cannot influence; every AP
decision is decoration.

Research has the mirror problem: the whole tree is priced at 66.7 K RP against
a faucet that pays tens of millions, so **RP cost stops being a decision in run
3** and total research *time* (~94 h of real time, less Scholarly Focus and
Archivist) is the only gate — a gate that is gone in under a week.

### 1.7 Tower XP and the Watch disagree with the economy

Tower XP grows sub-linearly in depth by design (`killXpWaveScale` is
`1 + 0.12√(w−1)`, count is linear, wave-clear is linear), while the level curve
is geometric (`XP_CURVE_GEO = 1.028`). Projecting the §1.1 ladder's waves
through `TOWER_XP_TABLE` (probe E, §9.5):

| after run | wall | cumulative tower XP | tower level | talent points |
|---:|---:|---:|---:|---:|
| 1 | 40 | 4.8 K | 10 | 10 |
| 3 | 249 | 284 K | 39 | 39 |
| 6 | 339 | 1.45 M | 61 | 61 |
| 10 | 357 | 3.28 M | 74 | 74 |
| 16 | 359 | 6.17 M | 86 | 86 |

Against that, `src/data/watch.ts` gates chapter 11 on **tower level 100**
(12.3 M cumulative XP — run ~30, against a chapter whose depth gate, wave 175,
falls in run 3), chapter 19 on **tower level 175** (300.8 M cumulative XP —
fifty times what the ladder produces in sixteen runs, and it only plateaus from
there), chapter 12 on **50 ascensions**, chapter 17 on
**250 ascensions**, chapter 20 on **50 transcendences and 500 risk-6 waves** —
while the *depth* gates those chapters carry (wave 200, 320, 400, 450) are
cleared by run 3 or never. The campaign that is supposed to pace the long
horizon has its two halves pointing in opposite directions: depth is trivial
and counters are the wall, and two of its twenty chapters cannot be completed
at all.

### 1.8 Two live balance regressions the shipping sim already reports

`npm run sim` on this tree prints `OUT OF BAND` twice against the ±15% band
`docs/core-system.md` claims is held:

| core | idle wall @0 AP | drafting wall @0 AP | worst Δ |
|---|---:|---:|---:|
| Bloodforge | 28 (vs marksman 33) | 58.6 (vs 79.1) | **−27.5% / −26.0%** |
| Frostwork | 34 | 91.7 | **+15.9%** |

The docs' core table (39/59/89/129/169) is also from an older tree; the live
numbers are 33/109/144/189/239. Several docs quote pre-drift figures — see §11.

---

## 2. Design targets

The constants in §3–§6 are steered against these, and §9's new report prints
each one so a change can be checked rather than argued about.

| # | Target | Today |
|---|---|---|
| T1 | A run at the wall advances the wall by **+8…+20 waves**, at every depth, without an asymptote inside the designed content | +98, +111, +59, then +0 |
| T2 | Wave **450** (Watch chapter 20) is reached around run **20–30**, and the ladder still moves after it | unreachable |
| T3 | A run costs **≤ 45 min of wall clock** at the player's speed ceiling, at every depth | 3 h at wall 359, growing quadratically |
| T4 | **≥ 50%** of a run's minutes are spent on waves the tower can actually lose (clear time > spawn floor) | ~12% |
| T5 | Gold, AP, RP and TP each have a live sink and a live decision at every depth | only TP |
| T6 | Something the player has not seen before arrives at least every **25 waves**, at every depth | nothing past wave 120 |
| T7 | Every Watch chapter is completable, and its depth gate and its counter gate land within ~2 runs of each other | 2 chapters impossible |

---

## 3. Change 1 — uncap the in-run economy (the ceiling)

**Defect:** §1.2. `damage.maxLevel = 200` fixes `c = 219`, which fixes the
terminal wall at 359, and retires every gold system in the game at that depth.

**The change, in one sentence:** tower upgrade caps stop being constants and
become **a thing the prestige layers buy**, so gold keeps a destination and the
asymptote moves with the player rather than with the table.

### 3.1 The data change

`UpgradeDef.maxLevel` stays as the *base* cap. `UpgradeManager` gains a cap
extension read from one new source:

```ts
maxLevelFor(def) = def.maxLevel + Math.round(def.maxLevel * capExtensionFraction)
```

`capExtensionFraction` is a new stat-pipeline key (`upgradeCapExtension`,
additive, base 0) so it composes the way every other modifier does and shows up
in the breakdown. Its sources:

| source | value | notes |
|---|---:|---|
| new TP perk **Foundry** (`tp_foundry`, Fortune branch, tier 3) | +0.5 per level, 8 levels, cost 12 × 1.55^L | +400% cap at max — `damage` 200 → 1000 |
| new AP perk **Deep Stores** (`ap_deep_stores`, tier 4) | +0.25 per level, 4 levels, cost 300 × 2.0^L | the AP tree's first sink that is not decoration |
| Watch chapter 13 unlock (replaces one of the flat unlocks) | +0.5 | one-off |

At Foundry 8 + Deep Stores 4 + the chapter, `capExtensionFraction = 5.5` →
`damage.maxLevel` 200 → 1300, `health` 200 → 1300, `goldMulti` 50 → 325 (the
§3.3 list only; `fireRate` and the other coverage lines are excluded).

Probe B's raised-caps rows bracket what that is worth: `damage` alone at 2,000
levels moves the gold ceiling 219 → **419**, and every line at 5,000 moves it
to **539** — so a 5.5 fraction on the scalar lines lands between them, with
gold worth **~28 waves per ×10** the whole way up instead of zero past ×10⁶.

### 3.2 Why a fraction rather than a flat number

Every line's cap is already sized to its own curve (`damage` 200 against
`1.11`, `fireRate` 45 against a hard additive ceiling, `pierce` 6 against
`3.2^L` costs). A flat "+50 levels" would be nothing to `damage` and would
break `pierce`. A fraction preserves the relative shape the tables were tuned
with, which is the property §1.2's measurement depends on.

### 3.3 Risks

- **`fireRate` was deliberately capped** (`src/data/upgrades.ts`: "two
  compounding DPS axes multiply into a runaway"). A 5.5 fraction would take it 45 → 292, which is
  exactly that runaway. **Exclude `fireRate`, `pierce`, `doubleShotChance`,
  `quickShotChance` and `splash` from the extension** — they are coverage and
  cadence axes with geometry-bound ceilings. Extend the *scalar* lines only:
  `damage`, `critDamage`, `health`, `defense`, `armor`, `thorns`,
  `lifesteal`, `goldMulti`, `waveGold`, `goldOnKill`, `manaRegen`, `xpGain`
  (`range` is excluded too — it is bounded by the arena, not by the table).
  Probe B must be re-run with exactly that restriction before any ceiling
  figure from §3.1 is quoted as measured rather than bracketed.
- Cost growth must carry the extension: `damage` at 8 × 1.18^L is 1.9e15 gold
  at level 200 and 3e93 at level 1300. That is fine — `bigNumber.ts` formats to
  Vigintillion — but the *income* has to reach it, which is what §4 is for.

---

## 4. Change 2 — make the ladder linear (the shape)

**Defect:** §1.1. `apForWave`'s `1.06^depth` makes the second and third
ascensions worth a thousandfold, which spends the entire designed content in
four runs and then leaves the ladder at a fixed point.

**The change:** flatten the AP curve so that a run at the wall multiplies
lifetime AP by a *bounded* factor, and let §3's raised ceiling carry the depth
the lost exponent used to.

### 4.1 The constant

```
apForWave(w) = 15 + floor(5 · 1.03^d · sqrt(d + 1))      // d = w − 20
                            ^^^^ was 1.06
```

Probe F (§9.6) runs the full ladder with `1.03` and §3's caps ×5:

| run | wall | Δ wall | run length | lifetime AP |
|----:|-----:|-------:|-----------:|------------:|
| 1 | 40 | +40 | 0.9 h | 5.6e1 |
| 2 | 160 | +120 | 3.5 h | 3.8e3 |
| 3 | 250 | +90 | 5.4 h | 7.2e4 |
| 4 | 329 | +79 | 8.5 h | 8.9e5 |
| 5 | 379 | +50 | 10.1 h | 4.7e6 |
| 6 | 419 | +40 | 12.2 h | 1.8e7 |
| 7 | **449** | +30 | 14.0 h | 5.1e7 |
| 8 | 469 | +20 | 15.0 h | 1.1e8 |
| 10 | 499 | +10 | 16.9 h | 3.8e8 |
| 13 | 529 | +10 | 19.0 h | 1.3e9 |
| 16 | 549 | +10 | 20.5 h | 3.0e9 |

T1 is met from run 4 onward and T2 lands at run 7–8 (a little early; §12 lever
1 tightens it). The ladder is still decelerating, but it decelerates into
`+10 waves per run` rather than into zero, and §7's content is what fills those
runs.

**Do not also raise `lifetimeAPDamageBonus`'s 0.7 exponent.** Probe F's variant
C (exponent 0.9) reaches wave 929 by run 16 with 55-hour runs — it fixes the
ladder by breaking T3 twice as hard, and it re-creates the "one automatic
number is the whole game" problem §1.6 describes.

### 4.2 What else moves with it

- `RP = AP gained` (`PrestigeManager.performAscension`) falls by the same
  factor, which is the §1.6 research fix for free: at 1.03 the tree's 66.7 K RP
  is a run-5 milestone rather than a run-3 formality. Re-check
  `tests/research-economy.test.ts`.
- `tpForAP(ap) = floor(4 · ap^0.4)` now yields **less** TP per transcendence
  (AP is smaller). At the run-16 figure (3.0e9 AP) that is 4 × 10^3.8 = 25 K TP
  against a 33.6 K tree — still the healthiest currency, and now the one that
  buys §3's Foundry. Leave the formula alone; re-check `tests/prestige-tp.test.ts`
  for the pinned literals.
- `FIRST_ASCENSION_AP = 25` is unaffected (it is a floor).
- Perk and core costs stay as they are. They are priced against runs 1–3, which
  §4.1 barely moves (run 3 still banks 72 K AP against a 24 K tree). The AP
  tree being bought out around run 4 rather than run 3 is acceptable; §3's
  Deep Stores and §7.5's endless nodes are what keep AP live after that.

---

## 5. Change 3 — bound the wave, unbound the depth (the clock)

**Defect:** §1.3. Wave duration grows linearly and run duration quadratically,
for a wave that is not a fight.

### 5.1 A wave spawns its roster in a bounded window

Replace the fixed-interval spawn cadence with a fixed *window*:

```ts
// src/data/formulas.ts
export const SPAWN_WINDOW_SECONDS = 24;
export const MIN_SPAWN_INTERVAL = 0.08;

export function spawnIntervalForWave(wave: number, count = spawnCountForWave(wave)): number {
  const natural = Math.max(0.4, 2.0 - wave * 0.04);          // unchanged early
  if (count <= 1) return natural;
  return Math.max(MIN_SPAWN_INTERVAL, Math.min(natural, SPAWN_WINDOW_SECONDS / (count - 1)));
}
```

The window starts binding at **wave 12** and its early effect is small — it
trims a wave's spawn phase from 26–31 s to 24 s between waves 12 and 50, which
is inside the noise of the wave the player is already fighting. What it removes
is the tail:

| wave | bodies | spawn phase today | with the window |
|---:|---:|---:|---:|
| 20 | 27 | 31 s | 24 s |
| 50 | 63 | 25 s | 24 s |
| 100 | 123 | 49 s | 24 s |
| 200 | 243 | 97 s | 24 s |
| 359 | 434 | 173 s | 24 s |

With §5.3's roster cap in place the interval never reaches
`MIN_SPAWN_INTERVAL` (`24 / 119 = 0.20 s` at the cap), so the floor is a
guard, not a shape. Run length becomes **linear** in depth:

| wall | run length today | with the window |
|---:|---:|---:|
| 249 | 5.2 h | ~1.8 h |
| 359 | 9.1 h | ~2.6 h |
| 549 | ~20 h | ~4.0 h |

### 5.2 The enrage budget has to move with it

`expectedWaveSeconds` is `spawn(w) + TARGET_WAVE_KILL_SECONDS`, so it contains
the same spawn term. Shrinking the window shrinks the enrage fuse with it:
today's fuse at wave 359 is `2 × (172 + 20) + 24 = 408 s` against a killing
blow that needs 324 s — with a 24 s window and the current flat term it is
`2 × (24 + 20) + 24 = 112 s`, and the wall moves ~11 waves shallower.

The fix is the flat term, and it changes the *shape* of the fuse rather than
restoring the old numbers:

```ts
export const TARGET_WAVE_KILL_SECONDS = 90;   // was 20
```

`24 + 90 = 114 s` is a fuse that is **flat in depth** instead of growing with
body count — the honest shape, since a wave should take about the same time at
every depth once the roster is capped. It is deliberately *not* identical to
today's fuse at every wave: it is longer below ~wave 130 (wave 100: 252 s
against 162 s) and shorter above it (wave 359: 252 s against 408 s), so it
forgives the early game slightly and tightens the deep game slightly.

That is a real change to the difficulty curve, so **90 is a starting value, not
a derived one**. Re-run the §2.2 wall table after wiring it: the target is that
every tier reproduces within one boss decade. If the deep tiers come in short,
raise the flat term (168 s reproduces today's wave-359 fuse exactly); if the
shallow tiers come in long, lower it. `sim/checks.ts` §2.3.3 must be re-derived
against whichever pair ships.

### 5.3 Bodies are capped; depth rides HP

24 s of spawning at the 0.08 s floor is 300 bodies, and the renderer, the
spatial grid and the projectile pool all have to draw them. Cap the roster and
give the removed bodies' HP to the survivors, so total wave HP — the number
every balance table is written against — does not move:

```ts
export const MAX_WAVE_BODIES = 120;

export function enemyCountForWave(wave: number): number {
  return Math.min(MAX_WAVE_BODIES, 5 + Math.floor((wave - 1) * 1.2));
}

/** HP each body carries when the roster is capped: the bodies that were cut. */
export function crowdCompression(wave: number): number {
  const natural = 5 + Math.floor((wave - 1) * 1.2);
  return natural / Math.min(MAX_WAVE_BODIES, natural);
}
```

`crowdCompression` multiplies into `enemyHPForWave` at the spawn site
(`EnemyManager.spawn`) and into `waveProfile` in the sim, and **nowhere else** —
gold, XP and RP are per-kill and must stay per-kill, or capping the roster
quietly cuts the economy by the same factor. Wave 450 fields 120 enemies at
4.5× HP instead of 544 at 1×; `tests/enemies.test.ts` gets the invariant
`totalHp(w)` is unchanged for every `w`.

The cap binds from wave 97. Above it, depth stops arriving as *more things* and
starts arriving as *tougher things*, which is also what §7.1's roster wants.

### 5.4 The speed ceiling

Fix §1.4 — the perk is supposed to be worth 6 × 0.5 = +3.0× on top of 1.5×:

```ts
// Game.syncUiApis
this.maxSpeedIndex = MAX_SPEED_INDEX + Math.round(this.prestigeMgr.getGameSpeedBonus() / 0.5);
```

which makes a maxed Accelerator **4.5×** and every level worth exactly one
selectable step. `getAvailableSpeeds` then enumerates them correctly and no
fractional index can be reached. Update `docs/game-loop.md`'s "6.5x" (it is
wrong in both directions today) and add a `tests/systems.test.ts` case pinning
level→speed for all seven levels.

Combined with §5.1–§5.3: a wall-549 run is ~4.0 h of simulation, ~53 min at
4.5×. That meets T3 only with §6.

---

## 6. Change 4 — stop replaying the game (the frontier)

**Defect:** §1.3/T4. Even with §5, a run to wave 549 spends its first 470 waves
re-clearing content the tower cannot lose. That is where the minutes go and it
is the least interesting part of the game.

**The change: Deployment.** A run may start from a checkpoint of a previous
run, restored exactly — never better.

### 6.1 The checkpoint

At every **50th wave cleared**, `Game` writes a `DeploymentCheckpoint` into
`GameState`:

```ts
interface DeploymentCheckpoint {
  wave: number;                       // the checkpoint wave
  gold: number;                       // gold in hand at that moment
  upgradeLevels: Record<string, number>;
  blessingIds: string[];              // picks held, in pick order
  blessingPicks: number;              // picks spent, so the cap still binds
  abilityLevels: Record<AbilityId, number>;
  towerHpFraction: number;
  recordedAt: number;
}
```

They are kept as a map keyed by checkpoint wave — the *best* snapshot ever
written at each wave, across runs — so a deploy can land at any of them rather
than only at the deepest. A 550-wave run writes eleven; cap the map at the
**deepest 12** entries so the save cannot grow without bound. It survives
ascension, is cleared by transcendence and by `clearSave`.

It is a **snapshot, not a grant** — it can only ever hand back a state the
player actually reached at that exact wave, so it cannot be farmed and it needs
no new economy arithmetic. Persist it under the same save-version bump as §6.4.

### 6.2 Deploying

The Ascension card gains a second button, `Deploy at wave N`, unlocked by a new
tier-3 AP perk (`ap_forward_camp`, 150 AP, 3 levels: deploy at up to 50% / 70%
/ 85% of the deepest checkpoint, resolved to the deepest stored checkpoint at
or below that wave). Deploying:

1. runs the normal ascension reset,
2. restores `upgradeLevels`, `gold`, `abilityLevels` and the blessing list from
   **that checkpoint's own snapshot** — nothing is scaled, interpolated or
   extrapolated; the state handed back is the state that wave was cleared with,
3. calls `WaveManager.startAtWave(deployWave)` (the plumbing already exists for
   the research/perk start-wave path),
4. sets `state.wave.highestWave` to the deploy wave for AP purposes **only if
   it was already at least that** — which it is, by construction.

Everything the deploy skips is genuinely skipped: contract progress, Watch kill
counters, tower XP and passive XP for those waves are **not** paid. That is the
trade, it is stated in the button's tooltip, and it is what keeps a deploy from
being strictly better than a full run for a player farming a Watch counter.

### 6.3 What it buys

At `ap_forward_camp` 3 (85% of 549 → the wave-450 checkpoint) with §5's linear
run length, a wall-549 run is **99 waves ≈ 43 min of simulation ≈ 10 minutes at
4.5×**, and the tower is inside its own frontier band for most of them. T3 and
T4 are both met, and they stay met at every depth because the deploy point
scales with the checkpoint. The 50-wave checkpoint spacing is what bounds the
error: a deploy lands at most 49 waves shallower than the perk allows.

### 6.4 The offline half

The same principle applied to absence: `computeOfflineProgress` currently
repeats the last measured wave and never advances. Let it **advance up to the
checkpoint wave and no further**, at the existing 0.25 yield fraction, paying
the per-wave gold/XP for each wave it walks. It cannot set a record (the ceiling
is a wave the player has already cleared), so the §1.3 "offline must not outrun
the player" invariant that `plans/economy.md` established is preserved exactly,
while an overnight absence hands back a run that is already at the frontier.

---

## 7. Content for the horizon

§3–§6 open waves 120–550+ and make them cheap to reach. §1.5 says there is
nothing there. This is the fill, ordered by cost.

### 7.1 Deep roster: the roster keeps arriving

Three unlock waves past the current end of the table, sized like the existing
entries (`ENEMY_DEFS`, `ENEMY_SPAWN_WEIGHTS`, `ENEMY_CODEX`,
`ENEMY_THREAT_CLASS`, `KILL_XP_WEIGHT`, a milestone entry, an icon):

| wave | type | the verb it demands |
|---:|---|---|
| 120 | **Harbinger** — periodically grants every ally on the field a 3 s untargetable phase | burst windows; punishes pure sustained DPS |
| 180 | **Leech** — drains tower mana on contact and converts it to its own shield | mana economy becomes a defensive resource |
| 240 | **Chorus** — three bodies that share one HP pool and split damage taken between them | coverage (pierce/splash) over single-target |

Each is a *question with an answer already in the game* — the rule
`docs/enemy-system.md` states — so none of them needs a new system.

### 7.2 Champions: elites keep escalating

`eliteChanceForWave` caps at wave 100. Extend the ramp with a second tier:

```
wave 100+   elite chance holds at 20%
wave 150+   an elite may instead roll Champion (5% → 15% by wave 400)
```

A Champion is an elite with **two** auras instead of one, 6× HP (against the
elite's 2.5×), 6× gold, a guaranteed gear roll at +1 rarity tier, and a visible
crown. Three new auras land here rather than at wave 21, so the aura table
keeps growing with depth: `siphon` (drains the tower's mana in range),
`bulwark` (grants nearby allies the boss's shield-break mechanic), `echo` (on
death, re-spawns one nearby ally that has already died this wave).

### 7.3 Ordeals: bosses keep changing

`BOSS_TIER_GROWTH` and `bossEncounterWeight` currently make a deep boss
*bigger* and nothing else — at wave 450 the weight is 46, so the encounter is
46× the HP, 46× the gold, and a 1,288 s enrage window, on the same four
patterns the wave-40 boss used. Cap the weight at **12** (reached at wave 120)
and put the rest of the growth into the encounter:

- every 100 waves, a boss gains **one extra phase threshold** (66/33 → 75/50/25
  → …) and one extra pattern slot, drawn from the four existing patterns plus
  two new ones (`tether`: the boss links to the nearest elite and both take
  reduced damage until the link is broken; `eclipse`: the arena's outer ring
  becomes damaging for 8 s and the tower's range is halved);
- waves 200, 300, 400 … are **Ordeals** — a named boss with a fixed pattern
  sequence, its own bar colour, a guaranteed legendary, and an entry in the
  codex. These are the "something new every 100 waves" anchor and the natural
  home for the Watch's deep chapters.

### 7.4 The draft keeps drafting

`BLESSING_MAX_PICKS = 30` retires the run's only run-scoped decision at wave
119. Two changes:

- the cap becomes `30 + floor((wave − 120) / 20)` evaluated at each draft, so a
  wave-550 run takes ~51 picks rather than 30;
- past pick 30 the draft rolls from a new **greater** rarity tier — 8 cards,
  each roughly 3× a rare's magnitude, several of which change a behaviour
  rather than a number (a second charged shot; kills seed a mine; overkill
  carries to *two* targets; the tower fires while the intermission runs). The
  existing `BlessingDef.weight` / `requires` / `corePreference` machinery
  carries it; nothing new is needed but data.

### 7.5 Endless sinks with a real slope

§1.6: after run 3 there is nothing to spend AP or RP on that matters. Three
additions, all data:

- **AP** — `ap_might` / `ap_fortune` keep their +2%/level but gain a companion
  pair at tier 5 (`ap_ascendant`, `ap_sovereign`) priced at `1.35^L` with
  **+1 wave of headroom per level** (i.e. `×1.11` damage per level, the same
  ruler the difficulty uses). A geometric sink against a geometric ruler is the
  only shape that stays a decision at every AP scale; `ap_might`'s additive
  +2% cannot.
- **RP** — a repeatable research node, **Field Studies** (`cost` and
  `researchTime` both ×1.6 per level, unbounded), granting +2% all damage and
  +2% all gold per level. RP stops being dead the moment the tree is finished
  and research *time* becomes the pacing mechanism it was designed to be.
- **Gear** — a **Reforge** sink: three duplicate items of the same rarity
  combine into one of the next rarity, and legendaries combine into a
  `legendary +N` whose stat rolls scale with N. This gives the equipment axis a
  horizon past the wave-100 rarity ramp and gives gold a second late sink
  (reforging costs gold sized on `goldDropForWave`, like `equipmentSellValue`).

### 7.6 Re-anchor the Long Watch

With §4's ladder, wave 450 lands at run ~7–8 and wave 550 at run ~16. Re-price
the chapters so both halves of each gate land together (T7):

- **Tower level gates:** chapter 11's *level 100* arrives ~27 runs after its
  own depth gate and chapter 19's *level 175* never arrives (§1.7). Lower them
  to **level 40** and **level 85** — what the ladder actually produces at those
  chapters' depths. Raising the XP faucet instead would undo the flattening
  `plans/economy.md` did on purpose; do one or the other, never both.
- **Count gates:** chapter 17's *250 ascensions* and chapter 20's *50
  transcendences* are 10–30× what the ladder produces by the time their depth
  gates fall. Re-price to ~40 ascensions / ~12 transcendences.
- **Depth gates:** stretch the tail — chapters 16–20 move to waves
  320 / 380 / 440 / 500 / 560, so the campaign ends where §4's ladder is still
  moving, with the §7.3 Ordeals as its landmarks.

---

## 8. Corrections the diagnosis turned up

These are independent of everything above and can land first.

1. **Accelerator delivers half its stated effect and wastes odd levels** —
   §1.4/§5.4. 560 TP for a perk that reads +3.0× and gives +1.5×.
2. **`docs/core-system.md`'s balance table is from an older tree** and the live
   sim reports two cores out of the ±15% band it claims (§1.8). Either re-tune
   `bloodforge`/`frostwork` or re-state the band with the measurement that
   actually holds.
3. **`docs/game-loop.md` says 6.5× max speed**; the code can reach 3.0×.
4. **`docs/prestige-system.md` lists 13 AP perks**; `AP_PERKS` has 23.
   `AGENTS.md`'s content table says the same 13/18.
5. **`docs/blessing-system.md`'s wall table** (39/59/89/129/169) is two
   rebalances stale; live is 28/109/145/189/239.

---

## 9. The measurement this repo is missing

Every table in `sim/balance.ts` measures **one run at a fixed AP tier**. Nothing
measures the *ladder* — which is why a game that ends at run 9 could ship with
all checks green. Add `sim/ladder.ts`, wired into `npm run sim`, printing the
§1.1 table plus the T1–T4 columns. It is ~40 lines; the probe that produced
§1.1 is reproduced here as the starting point.

### 9.1 Probe A — the ladder (§1.1, §4.1)

```ts
import { simulateRun } from './model.ts';
import { lifetimeAPDamageBonus, lifetimeAPGoldBonus } from '../src/data/formulas.ts';
import { ASCENSION_UNLOCK_WAVE, apForWave, tpForAP } from '../src/data/prestige.ts';

let life = 0, prev = 0;
for (let run = 1; run <= 16; run++) {
  const r = simulateRun({
    damageMult: 1 + lifetimeAPDamageBonus(life),
    goldMult: 1 + lifetimeAPGoldBonus(life),
    unlockWave: ASCENSION_UNLOCK_WAVE,
    sampleWaves: [], blessings: true, maxWave: 3000, seed: 0x5eed,
  });
  life += apForWave(r.wallWave);
  console.log(run, r.wallWave, r.wallWave - prev, (r.durationSec / 3600).toFixed(1) + 'h', life);
  prev = r.wallWave;
}
```

### 9.2 Probe B — the ceiling (§1.2)

`simulateRun({ damageMult: 1, goldMult: 10 ** e })` for `e` in 3, 6, 9, 12,
then the same with `UPGRADES[*].maxLevel` multiplied, to separate "out of gold"
from "out of levels".

### 9.3 Probe C — spawn-bound share (§1.3)

`simulateRun({ sampleWaves: everyWave })`, then compare each sample's
`clearSec` against `waveProfile(w).spawnDuration`. Report the fraction of run
*minutes* spent on waves where the two are equal — that is T4's metric.

### 9.4 Probe D — tree totals (§1.6)

Sum `perkCost(def, i)` over `i < maxLevel` for every bounded perk in `AP_PERKS`
and `TP_PERKS`, and `getResearchCost` over every node and level. Compare
against `apForWave(wall)` at each ladder row.

### 9.5 Probe E — tower level projection (§1.7)

Walk the ladder's waves through `xpPerKill` / `xpPerWaveClear` /
`enemyCountForWave` and index `TOWER_XP_TABLE`.

### 9.6 Probe F — candidate retunes (§4.1)

Probe A with `apForWave`'s growth and `UPGRADES[*].maxLevel` as parameters.
The three candidates measured were `caps×5` alone (runaway: wave 1159 by run 6,
85-hour runs), `caps×5 + 1.03` (shipped recommendation), and
`caps×5 + 1.03 + lifetime exponent 0.9` (wave 929 by run 16, 55-hour runs).

---

## 10. Tests

| file | what to add |
|---|---|
| `tests/formulas.test.ts` | `spawnIntervalForWave` never exceeds the natural curve and never puts a roster outside `SPAWN_WINDOW_SECONDS`; `enemyCountForWave` caps at `MAX_WAVE_BODIES`; `crowdCompression(w) × cappedCount(w) === naturalCount(w)` for every `w` to 1000; `expectedWaveSeconds` is within ±10% of 114 s from wave 100 to 1000 |
| `tests/enemies.test.ts` | total wave HP is unchanged at every wave by the roster cap (the §5.3 invariant); gold/XP/RP per kill are **not** multiplied by `crowdCompression` |
| `tests/prestige-ap.test.ts` | `apForWave` monotone, `apForWave(20) === 20`, the 1.03 literals; `ap_deep_stores` / `ap_forward_camp` prerequisites and costs |
| `tests/prestige-tp.test.ts` | `tp_foundry` ladder; `upgradeCapExtension` composes additively across AP + TP + Watch |
| `tests/systems.test.ts` | Accelerator level → selectable speed, all 7 levels; `getAvailableSpeeds().length === level + 3`; no fractional `speedIndex` is reachable |
| `tests/save.test.ts` | `DeploymentCheckpoint` round-trips; a deploy restores exactly the snapshot and never more; offline advances to the checkpoint wave and stops; save version bump + migration |
| `tests/watch.test.ts` | every chapter's depth gate and counter gate are both reachable on the §4.1 ladder (a table-driven assertion, so a future re-tune fails loudly) |
| `tests/blessings.test.ts` | the depth-scaled pick cap; greater-tier cards never appear before pick 30 |
| `sim/checks.ts` | new section: "the ladder advances" — Δ wall ≥ 8 at runs 5, 10, 15; "gold is never dead" — a ×10 gold multiplier moves the wall at wall 200, 350 and 500 |

## 11. Docs

`docs/wave-system.md` (spawn window, roster cap), `docs/enemy-system.md`
(crowd compression, the three new types, Champions), `docs/boss-encounters.md`
(weight cap, extra phases, Ordeals), `docs/prestige-system.md` (the new perks,
the 23-perk table that is already wrong, the AP curve), `docs/upgrade-system.md`
(cap extension), `docs/research-system.md` (Field Studies), `docs/watch-system.md`
(re-anchored gates), `docs/blessing-system.md` (pick cap, greater tier, and the
stale wall table), `docs/equipment-system.md` (reforge), `docs/save-system.md`
(checkpoint, version bump), `docs/game-loop.md` (the real speed ceiling),
`docs/core-system.md` (the out-of-band measurement), `docs/testing.md` and
`AGENTS.md` (the new `sim/ladder.ts` report and the content counts).

## 12. Task order

1. §8 corrections (§5.4 speed fix, the doc drift). Small, independent, and the
   speed fix is a prerequisite for T3 being measurable.
2. §9 `sim/ladder.ts` — **before** any balance change, so every step below is
   diffed against a baseline rather than argued about.
3. §3 cap extension (data + one stat key + `UpgradeManager`), with the §3.3
   exclusion list. Re-run probe B.
4. §4 the AP curve. Re-run the ladder; T1/T2 must land in the §4.1 band.
5. §5 spawn window + kill budget + roster cap, all three together — §5.2 says
   they are one change, not three. The §2.2 wall table must reproduce within a
   boss decade.
6. §6 Deployment (checkpoint, perk, offline ceiling). Save version bump.
7. §7.6 Watch re-anchoring, once §4's ladder is final.
8. §7.1–§7.5 content, in that order. Each is independent data work.

## 13. Tuning levers

1. **`apForWave` growth (§4.1).** 1.03 puts wave 450 at run 7 (measured, probe
   F). 1.025 and 1.035 are the obvious neighbours — roughly run 11 and run 5 by
   interpolation, both **unmeasured**; re-run probe F before quoting either.
   This is the single dial for "how long is the game".
2. **`capExtensionFraction` totals (§3.1).** Probe B brackets the whole range
   at 219 → 419 → 539; the per-fraction slope is **not** measured, because
   §3.3's exclusion list changes it. Measure it once the list is final. Raise
   the totals if the ladder flattens early.
3. **`SPAWN_WINDOW_SECONDS` / `TARGET_WAVE_KILL_SECONDS` (§5.1–§5.2).** They
   move together; their *sum* is the wave's fuse and must stay near 114 s or the
   wall moves.
4. **`MAX_WAVE_BODIES` (§5.3).** Purely a performance/feel dial once
   `crowdCompression` holds total HP constant. 120 is the renderer's comfort;
   80 is safe on the low quality tier.
5. **`ap_forward_camp` percentages (§6.2).** 85% is T4-tight; 70% is gentler and
   leaves more of the run in the "watch it work" register some players want.
6. **Champion / Ordeal cadence (§7.2–§7.3).** Every 100 waves is the T6 floor;
   every 50 if the deep game still reads as empty after §7.1.
