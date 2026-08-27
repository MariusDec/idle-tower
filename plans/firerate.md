# Shot-cadence rebase: slower cadence, heavier shots

**Status:** plan, not yet implemented.
**Goal:** stop the fire rate running away (today it passes 4 shots/s inside a
day and caps at 5.5). It caps at **3.15** after this, and each shot hits **1.2x**
harder, so the game reads as heavy shots rather than a hose.

---

## 0. What this changes, and what it costs

### The target

| `fireRate` level | shots/s before | shots/s after | damage/shot | DPS vs today |
|---|---|---|---|---|
| 0 (fresh tower) | 1.00 | **0.90** | x1.2 | 1.08x |
| 10 | 2.00 | **1.40** | x1.2 | 0.84x |
| 20 | 3.00 | **1.90** | x1.2 | 0.76x |
| 30 (about a day of play) | 4.00 | **2.40** | x1.2 | 0.72x |
| 45 (max) | 5.50 | **3.15** | x1.2 | 0.69x |

Three numbers do all of it: `TOWER_BASE.fireRate` 1.0 -> 0.9, the `fireRate`
upgrade's `effectPerLevel` 0.1 -> 0.05, and the `damage` upgrade scaled by 1.2.

**This is a deliberate rebalance, not a neutral transform.** Fire rate lands at
57% of today's at the cap; damage only rises 20%, so sustained DPS falls by
about 30% at high rate levels and rises 8% on a fresh tower. That trade was
chosen on purpose — read §0.3 before changing any of it.

### 0.1 Why the base *and* the slope both move

`resolveStats` composes each stat from one additive bucket and one
multiplicative bucket (`src/stats/resolve.ts`). Every contributor in
`src/stats/contributors/` was checked:

- **`fireRate` has exactly one additive source**: the `fireRate` upgrade
  (`contributors/upgrades.ts:20`), seeded by `STAT_BASES.fireRate` =
  `TOWER_BASE.fireRate` = 1.0. Everything else (blessings, cores, equipment,
  passives, prestige, talents, achievements, buffs) is `a.mult(...)`.
- **`baseDamage` has exactly one additive source**: the `damage` upgrade
  (`contributors/upgrades.ts:19`). `STAT_BASES.baseDamage` is **0**.

That asymmetry is the whole reason A.1 exists. Because the damage base is 0,
scaling the `damage` upgrade scales composed `baseDamage` by the same factor
everywhere. Because the fire-rate base is **1.0 and not 0**, halving only
`effectPerLevel` would give `1.0 + 0.05L`, which is *not* half of
`1.0 + 0.1L` — the fresh tower would keep its full cadence and gain the damage
for free. The base has to move too, and where it lands decides the whole curve.

### 0.2 Saves are safe — do not write a migration

`Game.loadFromPersisted` (`src/game/Game.ts:4460-4478`) restores only `x`, `y`,
`damageType`, `targetingMode`, `hp`, `maxHp`, `wallHp`, `wallMaxHp`.
`baseDamage` and `fireRate` are **not** persisted — they are recomputed from
upgrade levels by `Game.applyResolvedStats` (`src/game/Game.ts:3670`, `3672`).
Existing saves keep their levels and pick up the new curve automatically. No
save version bump, no migration code.

### 0.3 What was measured, and the one number that falls off a cliff

Every candidate below was run through `npm run sim` on the real data files.
"Drafted walls" is the §2.2b table — 7 seeds with the blessing draft running,
which the sim's own notes call the high-resolution measure; the idle table
quantises hard to boss decades.

| base / damage | fresh idle wall | idle tiers (100/1K/10K/100K) | drafted 0 AP | drafted 100 AP |
|---|---|---|---|---|
| *today* | 31 | 119 / 149 / 199 / 239 | 109.1 | 154.1 |
| 0.5 / x2 | 31 | 119 / 149 / 199 / 239 | 109.1 | 154.1 |
| **0.9 / x1.2  (shipping)** | **28** | **109 / 147 / 189 / 239** | **65.6** | **146.0** |
| 0.9 / x1.25 | 30 | 109 / 147 / 189 / 239 | 66.0 | 146.6 |
| 0.9 / x1.3 | 30 | 109 / 148 / 189 / 239 | 66.3 | 147.3 |
| 0.9 / x1.4 | 30 | 109 / 149 / 196 / 239 | 107.6 | 149.1 |
| 0.9 / x1.5 | 37 | 119 / 149 / 198 / 239 | 122.6 | 150.6 |
| 0.9 / x2 | 79 | 126 / 156 / 199 / 249 | 140.1 | 154.3 |

Two things to take from this table.

1. **Most of the cost is mild.** At x1.2 the prestige tiers lose roughly one
   boss decade (119 -> 109, 199 -> 189) and the drafted 100 AP / 1 K runs lose
   3-5%. That is the "a bit lower" that was asked for.
2. **The drafted 0-AP run is not mild, and it is a cliff.** 109.1 -> **65.6**,
   a 40% cut, and it does not move with the scalar until x1.4, where it snaps
   back to 107.6. This is a threshold — a drafted first run either does or does
   not clear a particular boss decade — not a gradient. If that first drafted
   run matters, **x1.4 is the value on the other side of the cliff**, and it
   costs only 3% at every other tier.

Changing scalar later is a two-line edit (A.2) plus re-deriving §2's divisor.
Nothing else in this plan depends on it.

### 0.4 Known side effect: Quick Draw gets deferred

Marginal DPS per gold on the `fireRate` line is `baseDamage x delta(rate)`.
Halving the slope while raising damage only 20% leaves that line at ~60% of its
old gold-efficiency relative to `damage`, so the sim's greedy buyer defers it:
rate levels at waves 5/10/20/30 go from `0/2/8/12` to `0/0/6/10`. Quick Draw is
a *later* buy, not a dead one. Its price is deliberately left alone — see §6.

## 1. Part A — the three numbers (required)

### A.1 `src/data/tower.ts:9`

```ts
  fireRate: 1.0,
```
becomes
```ts
  /*
   * The shot-cadence rebase (`plans/firerate.md`).
   *
   * Fire rate used to pass 4 shots/s inside a day of play and cap at 5.5. The
   * cap is now 3.15 (0.9 + 45 x 0.05) and the `damage` upgrade is 1.2x to pay
   * part of it back. It is deliberately only *part*: sustained DPS lands ~30%
   * below today at high rate levels and ~8% above it on a fresh tower.
   *
   * 0.9 and not 0.45. Because `baseDamage` seeds at 0 and `fireRate` seeds at
   * this value, an exact halving of the whole curve would need the base halved
   * too — and that costs the opener two full seconds between shots. 0.9 keeps
   * the opening cadence and pays for it in late-game DPS, which is the trade
   * §0.3 of the plan measured and chose.
   */
  fireRate: 0.9,
```

### A.2 `src/data/upgrades.ts:82-83` — the `damage` upgrade, x1.2

```ts
    effectPerLevel: '0.242 * Math.pow(1.11, {level} - 2)',
    baseEffect: 2.2,
```
becomes
```ts
    effectPerLevel: '0.2904 * Math.pow(1.11, {level} - 2)',
    baseEffect: 2.64,
```

**Both** literals must scale, or the curve stops being geometric from L1. The
closed form is `V(n) = baseEffect x 1.11^(n-1)`, and it only holds when
`coefficient = baseEffect x 0.11`: `2.64 x 0.11 = 0.2904`. If you ever change
the 1.2 scalar, recompute *both* from that identity.

The `+11% per level` rationale comment above these lines still holds verbatim —
the *growth* is untouched, only the scale. Append to it:

```
     * The scale (not the growth) is 1.2x its original with the shot-cadence
     * rebase; see `TOWER_BASE.fireRate` in `src/data/tower.ts`.
```

Leave `baseCost: 8` and `costGrowth: 1.18` **alone**. `damage` is the main
progression axis at every prestige tier, so its price is not an early-game
knob: the sim measured `baseCost` 8 -> 22 dropping the 100 AP wall from 119 to
99, and `costGrowth` 1.18 -> 1.22 dropping it to 69.

### A.3 `src/data/upgrades.ts:114` — the `fireRate` upgrade

```ts
    effectPerLevel: 0.1,
```
becomes
```ts
    effectPerLevel: 0.05,
```

Leave `baseCost: 25`, `costGrowth: 1.30` and `maxLevel: 45` unchanged — see §6
for why the line is not repriced to compensate. In the block comment above,
change "The ceiling (`+0.1`/level to L45)" to "`+0.05`/level to L45", and
"Composed ceiling from the upgrade alone is 7.75 shots/s" to
"**3.88 shots/s**" (the same figure, halved).

---

## 2. Part B — collateral (required)

Scaling `baseDamage` by 1.2 scales every effect that reads
`towerState.baseDamage`. Where the *frequency* of that effect is gated by the
tower's fire rate (splash, pierce, crit, lifesteal, execute, ricochet, Focus
Fire, magic procs) the change flows through correctly and there is nothing to
do. Where it is gated by a **cooldown, a timer, or a kill**, the effect gets
1.2x stronger relative to a tower whose DPS went *down*, so it must be divided
by 1.2.

`grep -n "baseDamage" -r src/` finds every site. These need dividing:

| file:line | what | before | exact /1.2 | **ship** |
|---|---|---|---|---|
| `data/abilities.ts:86` | `rain_of_arrows.effectValue` | 5 | 4.1667 | **4.2** |
| `data/abilities.ts:96` | `rain_of_arrows.effectValuePerLevel` | 1.0 | 0.8333 | **0.85** |
| `data/abilities.ts:130` | `chain_lightning.effectValue` | 3 | 2.5 | **2.5** |
| `data/abilities.ts:140` | `chain_lightning.effectValuePerLevel` | 0.3 | 0.25 | **0.25** |
| `data/abilities.ts:196` | `meteor_strike.effectValue` | 12 | 10 | **10** |
| `data/abilities.ts:206` | `meteor_strike.effectValuePerLevel` | 1.5 | 1.25 | **1.25** |
| `data/abilities.ts:262` | `rocket_barrage.effectValue` | 2 | 1.6667 | **1.65** |
| `data/abilities.ts:272` | `rocket_barrage.effectValuePerLevel` | 0.25 | 0.2083 | **0.21** |
| `systems/AbilityManager.ts:61` | `EXECUTE_BOSS_MULTIPLIER` | 5 | 4.1667 | **4.2** |
| `data/upgrades.ts:245` | `landMines` `scaling.base` | 0.4 | 0.3333 | **0.33** |
| `data/upgrades.ts:245` | `landMines` `scaling.perLevel` | 0.15 | 0.125 | **0.125** |
| `data/blessings.ts:159` | `BLESSING_TUNING.splitShardDamage` | 0.15 | 0.125 | **0.125** |

The four rounded values sit within ~1% of the exact quotient; abilities are not
modelled by the sim at all, so a percent either way is noise. Do not round the
ones that already divide exactly.

Add a one-line comment at `AbilityManager.ts:61`:
```ts
// Divided by the shot-cadence rebase's damage scalar (`plans/firerate.md`):
// this multiplies `baseDamage` directly and Execute's cadence is a cooldown,
// not a fire rate.
const EXECUTE_BOSS_MULTIPLIER = 4.2;
```

Also `src/data/abilities.ts:235` hardcodes the boss multiplier in prose:
```ts
    description: 'Kills non-boss enemies below {dmg}% HP. Bosses below {boss}% HP take 5x damage.',
```
becomes `... take 4.2x damage.'`

### B.1 Do **not** touch these

Their `effectValue` is not a damage multiple:

- `frost_nova` (line 108, `0.5`) — a slow factor.
- `precision_shot` (line 152, `30`) — crit chance in percent.
- `berserk` (line 174, `2`) — a **fire-rate** multiplier, already multiplicative.
- `gold_rush` (line 218, `3`) — a gold multiplier.
- `execute` (line 240, `12`) — an **HP threshold in percent**, not damage.
- `vampiric_aura` (line 286, `0.06`) — a lifesteal fraction.

And these are relative to figures that already moved:
`METEOR_SPLASH_MULTIPLIER` (`AbilityManager.ts:52`), `CHAIN_DECAY` (line 60),
`PLACEMENT_FOCUS_DAMAGE_BONUS`.

### B.2 Checked, no change needed

- **Boss-death shockwave rings** (`src/game/Game.ts:875-880`) — flat literals
  (120 / 80 / 50), never scaled by tower damage.
- **Tower shockwave** (`src/game/Game.ts:4867-4877`) — knockback and slow only.
- **Thorns** (`EnemyManager`) — a fraction of damage *taken*.
- **`landMineFrequency`** (`contributors/upgrades.ts:42`) — seconds between
  mines, unrelated to shot cadence.
- **Offline DPS** (`SaveManager.estimateDPS:158-161`) — literally
  `expectedHit * tower.fireRate`; tracks the change for free.
- **Charged shot** (`MANUAL_AIM.chargeDpsSeconds`) — already denominated in
  *seconds of the tower's own sustained fire*, so it scales itself. This is the
  precedent the rest of the plan follows.
- **Every multiplicative modifier** — Bloodlust, Second Wind, Vengeance,
  Battery, Overwatch, Siegebreaker, Frostbite, execute multiplier, armour pen,
  pierce amp, crit splash, core `damagePct`/`fireRatePct`, wave modifiers,
  equipment, blessings, prestige.

---

## 3. Part C — per-shot procs (required)

`docs/data-formulas.md` ("Why nothing here is priced per shot or per kill")
records the rule: a bonus denominated in *one shot* is divided by every
fire-rate purchase the player makes. Two effects are priced that way, and the
cadence cut takes a slice out of both. The fire-rate ratio runs 0.90 at level 0
down to 0.573 at the cap, so the right compensation across the band players
actually occupy is about **x1.5**, not the reciprocal at either end.

| file:line | what | before | **after** |
|---|---|---|---|
| `data/upgrades.ts:91` | Vorpal Arrows `effectValue` (+ its `description` text) | `0.015` / "1.5%" | **`0.025`** / "2.5%" |
| `data/passiveAbilities.ts:332` | Executioner L10 `value` (+ its `label`) | `0.8` / "+0.8%" | **`1.2`** / "+1.2%" |
| `data/upgrades.ts:275` | `quickShotChance.baseEffect` | `0.01` | **`0.015`** |
| `data/upgrades.ts:274` | `quickShotChance.effectPerLevel` | `0.006` | **`0.009`** |

Adrenaline Rush's uptime is `1 - (1 - p)^(rate x duration)`, so cutting `rate`
cuts the exponent; raising `p` by the same factor restores it to first order.
Update its comment from `// Ceiling 18.4%. Was ...` to
`// Ceiling 27.6% per shot — raised with the shot-cadence rebase so uptime, not the roll, stays put.`

Leave `quickShotTime` and `doubleShotChance` alone: Double Tap adds a projectile
*to a shot*, so it is already a share of shot output.

---

## 4. Verification

Run all four after Part A, and again after Parts B+C:

```bash
npm run typecheck
```
```bash
npm test
```
```bash
npm run sim
```
```bash
npm run checks
```

### 4.1 Expected sim output

These figures were **measured** by applying Part A to the real data files and
running `npm run sim`. Part A alone reproduces them; Parts B and C do not move
the sim (it models neither abilities nor evolutions, and C.2's Adrenaline change
should nudge `shots/s` up by a hair). Anything materially different means the
edit is wrong.

```
Fresh run (idle, no blessings, no prestige)
  wall 28, 37 min, 38 AP banked            (was: wall 31, 42 min, 47 AP)
  dmg/rate levels at waves 5/10/20/wall:   4/0, 11/0, 21/6, 27/10
  s2k normal at waves 5/10/20/wall:        2.3 / 1.9 / 1.9 / 2.3   (was 2.8 / 2.5 / 2.5 / 3.5)
  run income growth 1.168x per wave        (was 1.188x; the §6.3 target is <=1.16x)

§2.2 wall wave by lifetime AP (0 / 100 / 1K / 10K / 100K)
  28 / 109 / 147 / 189 / 239               (was 31 / 119 / 149 / 199 / 239)

§2.2b drafted walls (7 seeds)
  65.6 / 146.0 / 174.7 / 218.7             (was 109.1 / 154.1 / 183.0 / 226.7)

§4.5 idle parity
  shots/s:  1.43 / 4.06 / 4.13 / 4.13 / 4.13   (was 2.35 / 7.21 x4)
  active advantage: +36.6% / +37.1% / +25.5% / +25.5% / +25.5%

§6.4 cores, wall wave
  Marksman   30 / 109 / 148 / 189 / 239   worst delta  +0.0%   ok
  Artillery  30 /  99 / 139 / 189 / 239   worst delta  -9.2%   ok
  Frostwork  30 /  99 / 139 / 189 / 239   worst delta  -9.2%   ok
  Bloodforge 25 /  69 / 139 / 189 / 229   worst delta -36.7%   OUT OF BAND
  Arcane     30 /  99 / 139 / 189 / 239   worst delta  -9.2%   ok
```

Notes on that output:

- **Bloodforge is OUT OF BAND before and after** (-71.0% today, -36.7% here).
  It is a pre-existing issue the sim's own commentary explains — the core buys
  survivability, which the DPS column cannot see. Out of scope; do not chase it.
- **Arcane gets a tailwind** you can ignore. Its proc is mana-limited and the
  drain is `fireRate / 5 x 3` (`sim/model.ts` `procShare`, and the comment at
  `src/data/cores.ts:246-253`), so a slower cadence means the mana limit binds
  later. It still lands with the other cores at -9.2%, comfortably inside the
  ±15% band, so **no core re-tune is needed**.
- `run income growth` improving from 1.188x to 1.168x moves *towards* the §6.3
  target of <=1.16x. That is a small bonus, not a bug.

### 4.2 Existing tests that will fail, and their correct new values

- **`tests/formulas.test.ts:236-262`** — inline snapshot of upgrade curves.
  New values, computed from the shipping literals:
  - `damage` -> `[0, 2.64, 6.753217480380363, 438.9649933280707]`
  - `fireRate` -> `[0, 0.05, 0.5, 2.5]`
  - `critChance` and `goldMulti` are unchanged.

  Update with `npx vitest run -u tests/formulas.test.ts`, then **read the diff**
  and confirm it matches those four numbers exactly. If it does not, A.2's two
  literals are wrong.

- **`tests/abilities.test.ts:58-63`** — "grows per-rocket damage 2x -> 5.5x at
  L15". New: `dmg(1)` is `1.65`; `dmg(15)` is `1.65 + 0.21 * 14 = 4.59`. Rename
  the test to "1.65x -> 4.59x at L15" and fix the `// 2 + 0.25 * 14` comment.

- **`tests/abilities.test.ts:75-89`** — rocket display text. `stripTrailingZero`
  uses `toFixed(2)`, so: L1 reads `'deals 1.65x tower damage'`; L10 is
  `1.65 + 0.21 * 9 = 3.54`, reading `'deals 3.54x tower damage'`. The tooltip
  slots become `'6 @ 1.65x'` and `'10 @ 4.59x'`.

Anything else that fails is a real regression — investigate it, do not update
the expectation. In particular `tests/stats.test.ts`, `tests/cores.test.ts`,
`tests/save.test.ts` and `tests/pacing.test.ts` all read `TOWER_BASE` and
`computeUpgradeValue` rather than hardcoding, and must pass untouched. If
`tests/stats.test.ts` fails, the rebase leaked into a multiplicative
contributor — fix the code, not the test.

### 4.3 Add a curve-shape test

New file `tests/firerate-rebase.test.ts`. This does **not** pin DPS (DPS moves
on purpose); it pins the *shape* of both curves so a later edit to one line
without the other fails loudly.

```ts
import { describe, it, expect } from 'vitest';
import { UPGRADE_BY_ID } from '../src/data/upgrades';
import { computeUpgradeValue } from '../src/types';
import { TOWER_BASE } from '../src/data/tower';

/**
 * The shot-cadence rebase (`plans/firerate.md`): the fire-rate curve was cut to
 * ~57% at the cap and the damage curve raised 1.2x to pay part of it back.
 * `baseDamage` and `fireRate` each have exactly one additive source, so these
 * two curves are the tower's whole upgrade-axis output.
 */
describe('shot-cadence rebase', () => {
  const damageAt = (lv: number) => computeUpgradeValue(UPGRADE_BY_ID['damage'], lv);
  const rateAt = (lv: number) =>
    TOWER_BASE.fireRate + computeUpgradeValue(UPGRADE_BY_ID['fireRate'], lv);

  it('caps the cadence at 3.15 shots/s, down from 5.50', () => {
    expect(UPGRADE_BY_ID['fireRate'].maxLevel).toBe(45);
    expect(rateAt(0)).toBeCloseTo(0.9, 10);
    expect(rateAt(45)).toBeCloseTo(3.15, 10);
  });

  it('keeps the damage curve geometric from L1 at +11% per level', () => {
    // baseEffect x 1.11^(n-1); the closed form only holds while the formula's
    // coefficient stays equal to baseEffect x 0.11.
    expect(damageAt(1)).toBeCloseTo(2.64, 10);
    for (const lv of [2, 10, 30, 50]) {
      expect(damageAt(lv)).toBeCloseTo(2.64 * 1.11 ** (lv - 1), 6);
    }
  });

  /*
   * DPS moves on purpose, so this pins where it lands rather than that it
   * held. `before` is the same two curves at their pre-rebase literals
   * (damage 2.2 / 0.242, rate base 1.0 / slope 0.1) and is recorded here so a
   * future re-tune can see the whole trade at a glance.
   */
  const DPS: Array<[number, number, number, number]> = [
    // damageLevel, rateLevel, before, after
    [1, 0, 2.2, 2.3760000000000003],
    [10, 10, 11.255362467300605, 9.454504472532507],
    [20, 20, 47.93806859320034, 36.432932130832256],
    [30, 30, 181.48847732686554, 130.67170367534317],
    [45, 45, 1193.9783086997327, 820.5887285245436],
  ];

  for (const [dmgLevel, rateLevel, before, after] of DPS) {
    it(`d${dmgLevel}/r${rateLevel} resolves to ${(after / before).toFixed(2)}x its pre-rebase DPS`, () => {
      expect(damageAt(dmgLevel) * rateAt(rateLevel)).toBeCloseTo(after, 6);
    });
  }
});
```

The five ratios are **1.08 / 0.84 / 0.76 / 0.72 / 0.69** — a fresh tower gains
8%, and a maxed rate line loses 31%. That is the trade §0.3 measured.

### 4.4 Manual smoke test

```bash
npm run dev
```

Play to roughly wave 12 and confirm:

- Wave 1 still clears. The opener is *stronger* than today (1.08x DPS), so this
  should be comfortable; if it is not, something in Part A is wrong.
- Damage numbers are visibly larger and shots visibly less frequent.
- The barrel recoil (`TOWER_VISUAL.recoilTime`, 0.17 s) now completes between
  shots at every rate instead of being cut off at the top end, so each shot
  reads as a distinct thump. No code change — just confirm it looks right.
- Cast Rain of Arrows and Meteor Strike: they should feel the same as before
  relative to the tower, not stronger. That is Part B working.

## 5. Part D — documentation

- **`docs/tower-system.md:11`** — the row reads `| `fireRate` | 1.2 | Shots per
  second~~~~ |` and is already stale. Set it to `0.9` and drop the stray `~~~~`.
- **`docs/tower-system.md`**, after the "Fire rate (`effectiveFireRate`)" block
  (~line 156): add a short **Shot cadence** section stating the shape — one
  additive source per stat, cadence cut to ~57% at the cap, damage raised 1.2x,
  DPS deliberately down ~30% at depth and up 8% at the opener, saves unaffected
  — and link to `plans/firerate.md`.
- **`docs/upgrade-system.md:23-24`** — the `damage` and `fireRate` rows still
  quote pre-revamp values (30/1.15 and 50/1.20). Update to what ships:
  `damage | Sharper Arrows | 8 | 1.18 | 2.64 x 1.11^(L-1) | 200 | 1` and
  `fireRate | Quick Draw | 25 | 1.30 | +0.05 fire rate | 45 | 0`.
- **`docs/data-formulas.md`**, in "Why nothing here is priced per shot or per
  kill": add a sentence noting the rebase is why Vorpal Arrows and Adrenaline
  Rush were raised — both *were* priced per shot, and the cadence cut took a
  slice out of each.
- **`docs/ability-system.md`** — the table near line 36 and the worked example
  at line 173 quote ability damage multiples. Update any that Part B moved.

---

## 6. Accepted consequences — do **not** try to compensate these

Listed so a reviewer does not file them as bugs.

1. **DPS is down ~30% at high rate levels.** This is the change, not a side
   effect. §0.3 has the measured cost at every prestige tier.
2. **The drafted 0-AP run walls at 65.6 instead of 109.1.** A cliff, not a
   gradient — see §0.3. Moving the damage scalar to 1.2 -> 1.4 is the single
   edit that clears it, at a cost of 3% everywhere else. Left at 1.2 by
   decision.
3. **Quick Draw is deferred**, not dead — see §0.4. Its price is deliberately
   unchanged: repricing it to restore its old gold-efficiency would restore its
   old purchase rate, which would undo the cadence cut this plan exists to make.
4. **Overkill waste rises a little.** Shots-to-kill falls from 2.5-3.5 to
   1.9-2.3, so more of the killing blow is wasted on trash. Still comfortably
   above 1, and the sim cannot see it anyway — it folds overkill into the
   constant `ENGAGEMENT_EFFICIENCY` (0.85) plus `OVERKILL_BASE_DPS_CREDIT`.
5. **Focus Fire** (`wr_focus_fire`, +4%/point per consecutive hit on one
   target, max 5 stacks) reaches slightly lower average stacks, because targets
   die in fewer hits. Doubling `perPoint` would put the full-stack bonus at
   +120%, far swingier than the talent is meant to be. Left alone.
6. **Knockback and chill apply less often** — both are per-hit, and the per-hit
   force is unchanged. A shot shoves harder but less frequently, which is the
   intended direction.
7. **Achievement `ach_sharpshooter`** ("Fire 50,000 shots",
   `src/data/achievements.ts:92-101`) takes ~1.7x as long. Halving the
   threshold would retro-grant it to existing saves; if you want that, do it as
   its own commit so the grant is visible in the history.
8. **Bloodforge is OUT OF BAND in the sim's §6.4 table** both before (-71.0%)
   and after (-36.7%). Pre-existing.
9. **Arcane gets a small tailwind** — its mana-limited proc binds later at a
   slower cadence. It still measures at -9.2%, inside the ±15% band, so no core
   re-tune.

---

## 7. Follow-up worth considering — **not** part of this change

Raise with the user rather than implementing.

**The Artillery core** (`fireRatePct: -0.40`, `damagePct: +0.65`, tagline
*"Fewer shots. Nothing survives them alone."*) is now a slower version of what
the whole game does. Post-rebase it opens a run at `0.9 x 0.6 = 0.54` shots/s —
one shot every 1.9 seconds. **Frostwork** (`+0.30 / -0.18`) becomes the
"normal cadence" core by default. Both are core-identity questions the rebase
surfaces, not consequences of it.

---

## 8. Commit plan

Three commits, each independently verifiable:

1. `Shot cadence: cap the fire rate at 3.15, raise damage 1.2x (firerate plan Part A)`
   — `src/data/tower.ts`, `src/data/upgrades.ts` (damage + fireRate),
   `tests/formulas.test.ts` snapshot, `tests/firerate-rebase.test.ts`.
   Verified by: `npm run sim` reproducing §4.1.
2. `Scale down every baseDamage consumer the cadence does not gate (Part B)`
   — abilities, `EXECUTE_BOSS_MULTIPLIER`, land mines, split shards, the
   Execute description string, `tests/abilities.test.ts`.
3. `Restore per-second value to the per-shot procs (Part C)`
   — Vorpal Arrows, the Executioner milestone, Adrenaline Rush, plus the
   Part D doc updates.

Before committing, per `CLAUDE.md`, run `detect_changes()` and confirm the
affected symbols are only the ones this plan names.
