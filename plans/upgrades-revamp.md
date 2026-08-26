# Upgrades & Progression Revamp

**Goal:** make every purchase visibly change what happens on screen, without letting any single line — ordinary or prestige — erase the enemy curve. Today the tower one-shots trash from wave 4 to the wall, the only real difficulty is the boss sawtooth, and one first-ascension AP budget buys a 7x damage multiplier.

**Related components:** `src/data/upgrades.ts`, `src/data/prestige.ts`, `src/data/formulas.ts`, `src/data/cores.ts`, `src/systems/UpgradeManager.ts`, `src/systems/PrestigeManager.ts`, `src/systems/ProjectileManager.ts`, `src/game/Game.ts`, `src/stats/contributors/{upgrades,evolutions,prestige}.ts`, `src/stats/keys.ts`, `src/systems/SaveManager.ts`, `sim/model.ts`, `sim/balance.ts`, `tests/*`, `docs/*`.

**Tech stack:** TypeScript, Vite, Vitest, the in-repo balance simulator (`npm run sim`, `npm run checks`).

**Status:** planning only. Every number below is a *starting value* measured against the shipping sim; §14 is the gate that settles the final constants.

---

## 1. Measured baseline

All figures below come from the shipping data tables driven through `sim/model.ts` (greedy buyer, marksman core, idle, no blessings, risk 0) on 2026-08-22.

### 1.1 Run shape

| Metric | Value |
|---|---|
| Wall wave (fresh, no blessings) | **39** |
| Run length to the wall | **21 min** |
| AP banked at the wall | **82** |
| Purchases made across the whole run | **55** (one every 23 s) |
| Upgrade lines the greedy buyer ever touches | 5 of 27 |
| Final levels at the wall | `damage 27, fireRate 13, critChance 5, critDamage 5, goldMulti 6` |

### 1.2 Where the difficulty actually is

`budget` below is the enrage budget: `enrageThresholdSeconds(wave) + 3 x ENRAGE_STACK_INTERVAL`. "use" is the fraction of it the wave consumes.

| Wave | Boss? | Budget use | Wave gold | Next `damage` level | Waves of income it costs | Marginal damage |
|---:|---|---:|---:|---:|---:|---:|
| 5 | . | 18% | 22 | 22 | 1.0 | +51.5% |
| 10 | **B** | 53% | 85 | 60 | 0.7 | +20.0% |
| 15 | . | 24% | 139 | 133 | 1.2 | +15.2% |
| 20 | **B** | 46% | 227 | 296 | 1.3 | +13.0% |
| 25 | . | 25% | 529 | 656 | 1.1 | +11.9% |
| 30 | **B** | 66% | 655 | 976 | 1.5 | +11.5% |
| 35 | . | 26% | 1 722 | 2 163 | 1.1 | +11.0% |
| 38 | . | 34% | 2 447 | 2 639 | 1.1 | +10.9% |
| 40 | **B** | **fail** | — | — | — | — |

Non-boss waves sit at **18–34%** of their time budget for the entire run. Boss waves sit at 46–66% and then kill the run. **Nine waves in ten are not content.**

### 1.3 Shots to kill

`normal` has `baseHP 6`; a wave's mean enemy is roughly 1.7x that once tanks, wardens and splitters are mixed in.

| Wave | 1 | 5 | 10 | 15 | 20 | 25 | 30 | 35 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Shots to kill a `normal` | 1.4 | 1.1 | **0.4** | **0.3** | **0.4** | **0.5** | **0.5** | **0.6** |
| Shots to kill the average enemy | 1.4 | 1.5 | 0.6 | 0.6 | 0.7 | 0.8 | 0.9 | 1.1 |

From wave 4 to the wall the tower **one-shots everything that is not a boss**, with 100–200% of each shot wasted as overkill. This is the user-visible complaint: a purchase can only ever turn a one-shot into a one-shot.

### 1.4 Why: the first five damage levels

`damage` is `baseEffect 4` plus `Σ 3.2 x 1.1^(i-1)`. Its **marginal** growth per level is not 10% — it starts at 88% and only asymptotes to 10%:

| Level | 1 | 2 | 3 | 4 | 5 | 10 | 20 | 30 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Value | 4.0 | 7.5 | 11.4 | 15.7 | 20.4 | 51.0 | 183 | 494 |
| Next level | +88% | +51% | +37% | +30% | +25% | +20% | +13% | +11% |

Enemy HP grows 1.11x per wave, but the first five levels of one upgrade are worth **5.1x** and are all affordable inside the first eight waves. That is the overshoot the whole run then coasts on. It is exactly "after the first ~5 levels there's no real challenge".

### 1.5 The ascension layer

`perkCost = floor(costPerLevel x costScaling^level)`. `FIRST_ASCENSION_AP = 25`.

| Perk | Cost ladder | Cumulative |
|---|---|---|
| `ap_extra_shots` (Twin Arrows, max 10) | 2, 5, 12, 31, 78, 195… | 2, 7, 19, 50, 128 |
| `ap_scatter_shots` (Scatter Shot, max 5) | 2, 5, 12, 31, 78 | 2, 7, 19, 50, 128 |
| `ap_back_shots` (Rear Volley, max 3) | 3, 7, 18 | 3, 10, 28 |
| `ap_auto_upgrader` | 15 | 15 |
| `ap_might` / `ap_fortune` (+3%/level) | 4, 4, 5, 6, 7, 9… | 4, 8, 13, 19, 26 |

Every variant in `Game.buildShotVariants()` carries the **full** `rawDamage` — `ShotVariant` has no damage scale. Therefore:

- **First ascension, 25 AP:** Twin L3 (19) + Scatter L1 (2) + Rear L1 (3) = 24 AP → **1 → 7 projectiles**, a ~7x damage multiplier bought once, permanently.
- **At the wall, 82 AP:** Twin L4 + Scatter L3 + Rear L2 = 79 AP → **13 projectiles**.

Against that, `ap_might` at 4 AP for +3% damage is noise. The tree is solved on the first purchase and never revisited. Core unlocks (5/10/15/25 AP) are also inside first-ascension pocket change.

### 1.6 The transcendence layer

| Perk | Measured problem |
|---|---|
| `tp_damage` | `costPerLevel 1, costScaling 1.12` → levels 1–6 cost **1 TP each**. A first transcendence (25 TP) buys ~13 levels, roughly +330% damage. |
| `tp_head_start` | `500 x 1.45^(level-1)` summed → L20 grants **1 874 391** starting gold, ~77x an entire first run's income. |
| `tp_wave_start` | +3 waves/level to L10 → start every run at **wave 30**, past the whole early game. |
| `tp_game_speed` | max 10, described as "+0.5x" but `effectPerLevel: 1` → **+10x** game speed, and the copy disagrees with the effect. |
| `tp_aoe` (Annihilation, 12 TP) | `PrestigeManager.hasAoESplash()` and `getAoESplashFraction()` **have no callers anywhere in `src/`**. The perk is inert. |
| `tp_midas` | Pays gold on every projectile hit — a per-shot faucet that scales with fire rate and projectile count, the one shape the economy explicitly forbids elsewhere. |

### 1.7 Uncapped economy compounding

| Source | Shape | Ceiling |
|---|---|---|
| `goldMulti` (Greed) | +4%/level, `maxLevel 999` | none |
| Avarice (evolution) | +4.7% gold per consecutive kill | none |
| Dragon's Hoard (evolution) | +1% gold per wave survived | none (+~40% by wave 40) |
| Wave Mastery chain (`Game.ts:1304`) | `multiplier = 1 + cleared x 0.5` | none (**x21 at wave 40**) |
| `critGold` | +0.5/level to L20 | +10x on crit kills |
| `healthRegen` | `0.5% + 0.1%/level`, cap 50%/s | effectively unbounded |

Measured consequence: **run income grows 1.185x per wave** while `GOLD_GROWTH` is 1.08. That gap is purchased multipliers, and it is why one wave of income buys one damage level at every depth in §1.2 — the economy tracks the cost curve exactly, forever.

### 1.8 One real bug in the stat pipeline

`stats/contributors/upgrades.ts:34` derives the shockwave *radius* from the shockwave *cooldown*:

```ts
a.add('shockwaveSize', world(110 + (total - 1) * 5), u.name);
a.add('shockwaveCooldown', total, u.name);
```

`total` is `30 - 0.5 x level` (min 3), so it **decreases** with level. Levelling Shockwave shrinks its radius from 255 px to 120 px while shortening the cooldown. Fix it in the same pass.

---

## 2. Diagnosis

Five findings, in the order they must be fixed:

1. **Per-shot damage outruns per-enemy HP** (1.133x/wave vs 1.11x/wave), and the first five levels are worth 5x on their own. Result: permanent one-shot kills and invisible purchases.
2. **Total DPS is pinned to the boss curve, not the trash curve.** A boss wave is 3.5x the effective HP of its neighbours inside 0.65x the time budget (`expectedWaveSeconds` scales with enemy *count*, and a boss wave has 3–5 enemies). The tower must be sized for bosses, which makes it 4x oversized for everything else.
3. **AP projectile perks are multiplicative, unscaled and nearly free.** 25 AP buys 7 full-damage projectiles.
4. **Every purchased gold multiplier compounds without a ceiling**, so income growth (1.185x/wave) matches cost growth and the economy never tightens.
5. **Three prestige nodes are broken outright** — `tp_aoe` is inert, `tp_head_start` grants 1.9M gold, `tp_game_speed`'s copy contradicts its effect.

---

## 3. Design rules

These are the acceptance criteria for every number in §5–§12.

1. **The enemy HP curve is the ruler.** `ENEMY_HP_GROWTH = 1.11` and `GOLD_GROWTH = 1.08` do not move in this work. Player scaling is fixed against them.
2. **Per-shot damage tracks *enemy* HP; it never tracks *wave* HP.** Target growth ~1.10x per wave, against 1.11x enemy HP.
3. **Shots-to-kill is a first-class balance metric.** A same-wave `normal` should die in **2–4 shots** at every depth; the wave's average enemy in **3–7**; a tank in ~8; a boss in dozens.
4. **No two DPS axes may compound simultaneously.** If `damage` is geometric per level, `fireRate` must be additive-saturating, and vice versa. Two compounding axes multiply into a runaway (verified: a geometric `damage` + geometric `fireRate` candidate walled at wave 140 instead of 39).
5. **One ordinary purchase moves relevant output by 8–20%, never more than 25% of total DPS.** It may move shots-to-kill by one step; never by two.
6. **Every compounding economy source gets a hard cap**, and run income growth must land at **≤1.16x/wave** (measured 1.185x today).
7. **Prestige buys coverage and identity, not raw multipliers.** Extra projectiles carry a fraction of the payload and are single-level, expensive, gated nodes.
8. **Automation stays safe.** Auto-buy must work under the new caps; no purchase may require manual play or stall an idle run.
9. **Keep the stat-pipeline architecture.** New effects go through existing `StatKey`s where possible. A new key ships with its base, clamp and contributor in the same commit.
10. **Per CLAUDE.md, run `impact({target, direction: "upstream"})` before editing any symbol named below, and `detect_changes({scope: "compare", base_ref: "main"})` before committing.**

---

## 4. The architecture: three axes

The core insight from §1: total DPS must grow ~1.15–1.24x per wave (wave HP = enemy HP x enemy count), while per-shot damage should only grow 1.11x per wave. The gap **cannot** be closed by damage, and it cannot be closed by fire rate alone over a long run. It is closed by *coverage*.

| Axis | Tracks | Growth needed | Owned by |
|---|---|---|---|
| **Per-shot damage** | enemy HP, `1.11^wave` | ~1.10x/wave | `damage` upgrade (geometric per level) |
| **Shots per second** | enemy count in the early/mid game | 1.0/s → ~7.75/s over a deep run | `fireRate` upgrade (additive, hard cap) |
| **Targets per shot** | enemy count, forever | 1 → 3+ effective | pierce, splash, evolutions, AP/TP nodes, blessings |

Enemy count is `5 + floor((wave-1) x 1.2)` — 5 at wave 1, 52 at wave 40, 124 at wave 100. Coverage is the only axis that scales with a *crowd*, which is why it is the correct home for the growth that damage must not absorb.

Two consequences worth stating plainly:

- **Crowds will form.** Once the tower stops one-shotting, kills-per-second drops below spawns-per-second on deep waves and enemies bunch near the tower. That is intended: it is what finally makes the defense category (`wall`, `thorns`, `shockwave`, `armor`, `landMines`) and the targeting modes matter. It is also a difficulty increase the sim cannot see — it has no positions and no tower HP — so §14 gate 9 is an in-browser check, not a sim check.
- **Runs get longer.** Waves currently finish in ~60% of `expectedWaveSeconds`; the target is ~100%. Expect a fresh run to move from 21 min toward 28–35 min for the same wall. §14 gate 3 bounds it.

---

## 5. Gold upgrade table

`B/G` is `baseCost` / `costGrowth`. Cost of the level from `n` to `n+1` is `floor(B x G^n)`.

### 5.1 The two power lines

#### `damage` — Sharper Arrows

| Field | Value |
|---|---|
| `baseCost` / `costGrowth` | **10 / 1.16** |
| `baseEffect` | **2.2** |
| `effectPerLevel` | **`'0.242 * Math.pow(1.11, {level} - 2)'`** |
| `startLevel` | 1 |
| `maxLevel` | **200** |

That formula is exactly `V(n) = 2.2 x 1.11^(n-1)`: **every level is +11% damage**, with no early explosion. `0.242 = 2.2 x 0.11`.

| Level | 1 | 5 | 10 | 20 | 30 | 40 | 50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| Value | 2.20 | 3.34 | 5.63 | 15.98 | 45.37 | 128.8 | 365.8 |
| Cost of next | 11 | 21 | 44 | 194 | 858 | 3 787 | 16 707 |
| Cumulative | 10 | 67 | 210 | 1 145 | 5 290 | 23 590 | 104 336 |

With ~50% of income going to this line, the greedy buyer reaches roughly L7 by wave 10, L17 by wave 20, L27 by wave 30, L34 by wave 39 — about **0.95 levels per wave**, so damage grows `1.11^0.95 = 1.104` per wave against enemy HP at 1.11. Shots-to-kill on a `normal` starts at **2.7** and drifts gently upward through a run, which is the difficulty ramp the current game does not have.

#### `fireRate` — Quick Draw

| Field | Value |
|---|---|
| `baseCost` / `costGrowth` | **40 / 1.18** |
| `effectPerLevel` | **0.15** (additive on the 1.0 base) |
| `maxLevel` | **45** |

Deliberately additive and hard-capped (rule 4). Composed ceiling from the upgrade alone is **7.75 shots/s**.

| Level | 1 | 5 | 10 | 20 | 30 | 45 |
|---|---:|---:|---:|---:|---:|---:|
| Composed rate | 1.15/s | 1.75/s | 2.50/s | 4.00/s | 5.50/s | 7.75/s |
| Marginal | +13.0% | +8.6% | +6.0% | +3.8% | +2.7% | +1.9% |
| Cost of next | 47 | 91 | 209 | 1 095 | 5 734 | 68 667 |
| Cumulative | 40 | 284 | 936 | 5 854 | 31 621 | 381 239 |

The two power lines are priced against the measured economy, not guessed: cumulative `damage` to L34 plus cumulative `fireRate` to L24 is **~21.5 K**, against the **24.2 K** a fresh run actually earns by wave 39 (§1.1). The rest of the table is what the other 27 lines compete for.

At ~50% of income this reaches ~1.5/s by wave 10, 2.5/s by wave 20, 3.6/s by wave 30, 4.6/s by wave 39 — a **1.04x/wave** climb, which is very close to the 1.046x/wave enemy-count growth over the same span. The line's job is exactly that, and the cap is where coverage has to take over.

The old line was `+0.06/level, maxLevel 100` on a 1.0 base: a +600% ceiling nobody reaches (the buyer stopped at L13) whose first level is worth +6%. The new one front-loads a +13% opener and stops at a defensible ceiling.

### 5.2 The coverage line (new)

Two new upgrades. Both use stat keys that already exist or that ship with their contributor in the same commit.

| Upgrade | Tuning | Notes |
|---|---|---|
| **`pierce`** — *Bodkin Points* | B/G **1 200 / 3.2**; `+1 pierce/level`; max **6**; category `tower` | Costs 1 200 / 3 840 / 12 288 / 39 322 / 125 830 / 402 656. Six purchases across a whole progression, each one a visible, run-changing moment. Writes `pierceExtra` (`stats/keys.ts:77`, already clamped `{min: 0, integer: true}`). |
| **`splash`** — *Fragmenting Arrows* | B/G **1 500 / 1.35**; radius `world(40 + 3 x level)`; fraction `0.10 + 0.012/level`, cap **0.40**; max **25** | Needs two new keys, `shotSplashRadius` and `shotSplashFraction`, fed into `FireOptions.splashRadius/splashFraction` — the plumbing already exists for the artillery core (`CoreManager.ts:148`) and the mortar blessing. Compose with the core by taking the max radius and summing fractions to the cap. |

Both are priced as *milestones*: they are the first things a player saves for rather than trickle-buys, and they are the answer to the crowd the new curve creates.

### 5.3 Full upgrade table

| Upgrade | B/G | Value | Max | Change vs today |
|---|---|---|---:|---|
| `damage` | **10 / 1.16** | `2.2 x 1.11^(n-1)` | **200** | Geometric, +11%/level flat. Was 15/1.22 with an 88% first step and no cap. |
| `fireRate` | **40 / 1.18** | `+0.15/level` | **45** | Was 60/1.26, `+0.06/level`, max 100. |
| `range` | **120 / 1.30** | `+3/level` | **50** | Was 100/1.32, max 60. |
| `critChance` | **220 / 1.32** | `+0.5%/level` | **40** | Ceiling 25% including base, not 100%. Was 140/1.42, +1%/level, max 95. |
| `critDamage` | **260 / 1.30** | `+0.08/level` | **50** | Ceiling x6.0. Was 170/1.36, +0.12/level, **max 999**. |
| **`pierce`** *(new)* | **1 200 / 3.2** | `+1/level` | **6** | See §5.2. |
| **`splash`** *(new)* | **1 500 / 1.35** | see §5.2 | **25** | See §5.2. |
| `landMines` | **700 / 1.34** | `0.4 + 0.15/level`; cadence `max(6, 16 - level/6)` | **80** | Was 500/1.32, `0.5 + 0.25/level`, max 999. |
| `doubleShotChance` | **240 / 1.36** | `2% + 1%/level` | **30** | Ceiling 32%. Was 120/1.45, `2% + 2%/level`, max 35 (72%). |
| `quickShotChance` | **320 / 1.38** | `1% + 0.6%/level` | **30** | Ceiling 19%. Was 250/1.55, `1% + 1%/level`, max 50 (51%). |
| `quickShotTime` | **200 / 1.40** | `2s + 0.5s/level` | **10** | Ceiling 6.5 s. Was `3s + 1s/level`, max 9 (12 s). |
| `goldMulti` | **220 / 1.32** | `+2%/level` | **50** | Ceiling +100%. Was 110/1.40, +4%/level, **max 999**. |
| **`prospecting`** *(new, replaces `upgradeDiscount`)* | **240 / 1.34** | `+1.5%/level` double-gold chance | **20** | Ceiling +30%. Routes through the existing `doubleGoldChance` key (`stats/keys.ts:55`, clamped `{min:0,max:1}`). |
| `manaRegen` | **320 / 1.34** | `+0.2/level` | **60** | Was 300/1.55, +0.25/level, max 999. |
| `maxMana` | **260 / 1.30** | `+5/level` | **40** | Unchanged shape, cheaper growth. |
| `waveGold` | **600 / 1.34** | `3 + 2/level` | **60** | Was 380/1.40, max 999. Chain multiplier capped — §6.3. |
| `xpGain` | **400 / 1.34** | `+2%/level` | **40** | Ceiling +80%. Was 350/1.50, +3%/level, max 50. |
| `abilityCostReduction` | **260 / 1.34** | `-1.5%/level` | **20** | Ceiling -30%, leaving room for talents/research/TP. Was `-2%/level`, max 25 (-50%). |
| `goldOnKill` | **400 / 1.32** | `1 + 1/level` | **60** | Was 290/1.40, max 999. |
| `critGold` | **240 / 1.34** | `+0.25/level` | **20** | Ceiling x6 on crit kills. Was +0.5/level (x11). |
| `health` | **25 / 1.15** | `5 x 1.10^(n-1)` — `baseEffect 5`, `effectPerLevel '0.5 * Math.pow(1.10, {level} - 2)'` | **200** | Mirrors `damage`: geometric, +10%/level flat. Was `5 + Σ 4.2 x 1.1^(i-1)` with a +48% first step. |
| `healthRegen` | **200 / 1.32** | `0.4% + 0.05%/level`, cap **6%/s** | **120** | Cap was **50%/s**, which deletes all incoming pressure once max HP is large. |
| `defense` | **150 / 1.30** | `0.5 + 0.3/level` | **150** | Was 120/1.32, `0.5 + 0.35/level`, max 999. |
| `armor` | **180 / 1.26** | `1% + 0.3%/level`, cap **50%** | **160** | Cap was 75%. Was 140/1.23, max 200. |
| `shockwave` | **300 / 1.28** | radius `world(110 + 4 x level)`; cooldown `max(5, 26 - 0.35 x level)` | **60** | **Fixes the §1.8 radius bug.** Radius now derives from `level`, cooldown from the scaling value. |
| `thorns` | **260 / 1.34** | `3% + 0.5%/level`, cap **75%** | **140** | Was 220/1.37, `5% + 1%/level`, uncapped, max 999. |
| `lifesteal` | **300 / 1.34** | `0.3% + 0.06%/level`, cap **10%** | **140** | Was 250/1.40, `0.2% + 0.06%/level`, uncapped, max 999. |
| `defenseShield` | **600 / 1.32** | recharge `max(8, 55 - 0.9 x level)`; charges `min(5, ceil(level/10))` | **50** | Was 500/1.35, `max(7, 60 - level)`, `ceil(level/11)`, max 55. |
| `wall` | **700 / 1.34** | `20% + 2%/level`, cap **90%** of max HP | **35** | Was 650/1.37, `20% + 2%/level`, uncapped, max 40. |

**Count: 29 upgrades** (27 today, minus `upgradeDiscount`, plus `prospecting`, `pierce`, `splash`). Update the `AGENTS.md` "Content at a glance" row and `docs/upgrade-system.md`'s "27 upgrades" heading.

**Why `upgradeDiscount` goes.** A flat cost reducer is an anti-upgrade: it changes nothing on screen, it compounds silently with every other economy line, and it is strictly the least interesting thing a player can buy with the gold they earned. `prospecting` occupies the same slot and pays out as a visible double-gold pop. Long-term cost reduction still exists via talents (`contributors/talents.ts:99`) and achievements (`contributors/achievements.ts:76`), which keep `upgradeCostDiscount` alive as a key.

---

## 6. Evolutions and economy caps

### 6.1 Evolution moves

Evolutions are the *milestone* half of gratification: a named unlock at a level the player can actually reach under the new caps. Every level below is inside the new `maxLevel`.

| Upgrade | Level | Evolution | Effect |
|---|---:|---|---|
| `damage` | 20 | Keen Arrows | +10% armor penetration (unchanged) |
| `damage` | 60 | Vorpal Arrows | **1.5%** instant kill on non-bosses (was 3% at L75) |
| `fireRate` | 12 | Rapid Fire | every 5th shot fires double (was L25) |
| `fireRate` | 30 | Machine Gun | **+30%** fire rate during Berserk (was +50% at L50) |
| `range` | 25 | **Overwatch** *(new)* | +10% damage to enemies beyond 70% of range |
| `critChance` | 20 | Hawk Eye | crits deal 15% AoE splash (was 20% at L25) |
| `critChance` | 35 | True Sight | crits ignore armor (was L75 — unreachable under the new cap of 40) |
| `pierce` | 4 | **Skewer** *(new)* | pierced targets take +15% from the same shot |
| `landMines` | 25 | Cluster Mines | mines split into 2 (unchanged) |
| `goldMulti` | 20 | Avarice | **+2.5%** gold per consecutive kill, **hard cap +75%** |
| `goldMulti` | 40 | Dragon's Hoard | **+0.5%** gold per wave survived, **hard cap +50%** |
| `manaRegen` | 20 | Inner Peace | full mana: **+8%** gold for 5 s (was +10% at L25) |
| `maxMana` | 15 | Mana Shield | full mana: 10% damage reduction (unchanged) |
| `waveGold` | 20 | Golden Tide | wave clear gold **+20%** (was +25% at L25) |
| `xpGain` | 25 | Enlightenment | +1 talent point every **12** waves (was 10) |
| `health` | 25 | Fortified Core | **+12%** damage above 80% HP (was +15%) |
| `health` | 90 | Titan's Heart | revive once per ascension at 25% HP (was L100) |
| `shockwave` | 15 | Tremor | shockwaved enemies slowed 30% for 2 s (unchanged) |
| `defenseShield` | 25 | Prismatic Shield | recharges 25% faster (unchanged) |

Two new `EvolutionEffectId`s: `range_damage` (Overwatch) and `pierce_amp` (Skewer). Both must be added to the union, to `EVOLUTION_EFFECT_IDS`, and to the exhaustive switch in `stats/contributors/evolutions.ts` — the switch is closed on purpose, so an unconsumed effect fails `tsc` rather than shipping as flavour text.

### 6.2 Caps that need code, not data

1. **Avarice** — clamp in the `enemy_killed` handler (`Game.ts:814`): `setKillStreakGoldBonus(Math.min(0.75, (killStreak - 1) * perKill))`.
2. **Dragon's Hoard** — clamp in `contributors/evolutions.ts:39`: `a.add('goldAdditive', Math.min(0.50, value * Math.max(0, ctx.wave - 1)), "Dragon's Hoard")`.
3. **Wave Mastery chain** — `Game.ts:1304` currently reads `let multiplier = 1 + cleared * 0.5` with no ceiling (x21 at wave 40). Replace with `1 + Math.min(cleared, 20) * 0.1` → hard cap **x3**, applied before Golden Tide.
4. **Prospecting** — route through `doubleGoldChance`; add the double-gold roll to the sim's gold model (§13).
5. **Shockwave radius** — `contributors/upgrades.ts:34`: derive `shockwaveSize` from `level`, not from the (decreasing) cooldown value.

### 6.3 Income growth target

The gate is not "raise costs"; it is **bound the multipliers**. With §5.3's caps and §6.2's clamps, measured run income growth should fall from **1.185x/wave to ≤1.16x/wave**. `sim/balance.ts` must report this figure directly (§13), because it is the number that decides whether purchases stay decisions.

`GOLD_GROWTH` stays at 1.08 in this pass. It is the global ruler for loot, contracts, modifiers, offline progress and every sim expectation; it is the **last** lever in §15, not the first.

---

## 7. Projectile payload scaling

Add to `ProjectileManager.ts:51`:

```ts
export interface ShotVariant {
  angleOffset?: number;
  posOffsetX?: number;
  posOffsetY?: number;
  /** Fraction of the volley's damage this variant carries. Defaults to 1. */
  damageScale?: number;
}
```

Apply it per variant in `fire()` where `rawDamage` is currently used unmodified for every variant. Ordinary tower shots, talent Barrage shots and the Rapid Fire evolution shot stay at scale 1.

One shared tuning block in `src/data/prestige.ts`, read by `Game.buildShotVariants()` (`Game.ts:3324`) and by `sim/model.ts`, so the sim measures the number that ships:

```ts
export const PRESTIGE_PROJECTILE_TUNING = {
  extraDamageScale: 0.55,   // Twin Arrows, front lane
  rearDamageScale: 0.55,    // Rear Guard, behind the tower
  scatterDamageScale: 0.35, // Scatter Shot, each of two angled lanes
} as const;
```

Resulting ideal output with the whole suite bought: **1 + 0.55 + 0.55 + 2 x 0.35 = x2.80** before geometry and misses (the rear lane only covers enemies behind the tower; scatter lanes miss on sparse waves), so effective is roughly **x1.7–2.0**. Today the same suite is **x13**.

UI copy must say the payload explicitly — "adds one front projectile at 55% damage", never "+1 projectile" (`src/ui/PrestigePanel.ts`).

---

## 8. Ascension (AP) revamp

### 8.1 Shape

Twelve perks in four tiers. The first ascension buys **one** utility choice; a signature projectile node is a second- or third-run purchase; the full suite deliberately spans many runs.

Prerequisites remain **OR**-based in `PrestigeManager.meetsPrerequisites` (`PrestigeManager.ts:311`) and the panel already renders them as "Requires A or B". Do not introduce AND semantics without updating that copy.

### 8.2 The tree

| Tier | Perk | Cost / scaling | Max | Effect | Prereq |
|---:|---|---|---:|---|---|
| 1 | `ap_auto_upgrader` | **25**, — | 1 | Unlocks Auto-Upgrade | — |
| 1 | `ap_wave_skipper` | **6**, 1.60 | **15** | +1% wave-skip chance/level (ceiling +15%) | — |
| 1 | **`ap_quiver`** *(new)* | **5**, 1.22 | **30** | +2% fire rate/level | — |
| 2 | `ap_might` | **6**, 1.20 | 999 | +2% all damage/level | Auto-Upgrader **or** Quiver L3 |
| 2 | `ap_fortune` | **6**, 1.20 | 999 | +2% all gold/level | Auto-Upgrader **or** Wave Skipper L2 |
| 2 | `ap_research_speed` | **8**, 1.8 | 5 | -8% research time/level | Auto-Upgrader |
| 3 | `ap_extra_shots` (Twin Arrows) | **60**, — | **1** | +1 front projectile at **55%** damage | Might L5 **or** Quiver L5 |
| 3 | **`ap_pierce`** *(new, Bodkin Mastery)* | **75**, 2.2 | **3** | +1 pierce/level | Might L5 |
| 3 | `ap_back_shots` (Rear Guard) | **90**, — | **1** | +1 rear projectile at **55%** damage | Twin Arrows |
| 4 | `ap_scatter_shots` (Scatter Shot) | **200**, — | **1** | +2 angled projectiles at **35%** each | Rear Guard **or** Bodkin Mastery L2 |
| 4 | `ap_warlord` | **40**, 1.32 | 12 | +5% all damage/level; locks out Tycoon | Might L10 |
| 4 | `ap_tycoon` | **40**, 1.32 | 12 | +5% all gold/level; locks out Warlord | Fortune L10 |

Cost ladders (`floor(cost x scaling^level)`):

| Perk | Levels 1–8 | Cumulative |
|---|---|---|
| `ap_might` / `ap_fortune` | 6, 7, 8, 10, 12, 14, 17, 21 | 6, 13, 21, 31, 43, 57, 74, 95 |
| `ap_quiver` | 5, 6, 7, 9, 11, 13, 16, 20 | 5, 11, 18, 27, 38, 51, 67, 87 |
| `ap_wave_skipper` | 6, 9, 15, 24, 39, 62, 100, 161 | 6, 15, 30, 54, 93, 155, 255, 416 |
| `ap_pierce` | 75, 165, 363 | 75, 240, 603 |
| `ap_warlord` / `ap_tycoon` | 40, 52, 69, 91, 121, 160, 211, 279 | 40, 92, 161, 252, 373, 533, 744, 1 023 |

### 8.3 Purchase gates this produces

`apForWave` is unchanged: wave 20 → 20 AP (floored to `FIRST_ASCENSION_AP = 25`), wave 39 → 82, wave 59 → 321, wave 89 → 2 346.

| Moment | AP | What it buys |
|---|---:|---|
| First ascension (wave 20) | 25 | Auto-Upgrader **or** 4 levels of Quiver (27) **or** 3 levels of Wave Skipper (30, one short) — **one** choice. No projectiles. |
| First wall push (wave ~39) | 82 | Auto-Upgrader + 6 levels of Might (25 + 57 = 82) → +12% damage. Or save toward Twin Arrows. |
| Second/third run | 120–200 | **Twin Arrows** (60) plus a tier-2 line, or a core unlock. |
| Deep runs | 320+ | Rear Guard, Bodkin Mastery, then the Warlord/Tycoon fork. |
| Full projectile suite | **350 AP** | Deliberately several runs of saving. |

Compare to today: 25 AP → 7 projectiles.

### 8.4 Core unlock repricing

Core unlocks compete with AP perks for the same currency and are currently pocket change.

| Core | Today | Proposed |
|---|---:|---:|
| Artillery | 5 | **30** |
| Frostwork | 10 | **45** |
| Bloodforge | 15 | **60** |
| Arcane | 25 | **90** |

A core is now a genuine alternative to Twin Arrows. **Do not retune core stat blocks in the same pass** — `sim/balance.ts` already holds them inside ±15% of marksman, and this change is about access timing only.

---

## 9. Transcendence (TP) revamp

`tpForAP` stays `floor(4 x ap^0.4)` — 25 TP for a first transcendence, 63 at 1 000 AP, 247 at 30 000.

### 9.1 Wrath (offense)

| Perk | Cost / scaling | Max | Effect |
|---|---|---:|---|
| `tp_damage` (Cosmic Power) | **3 / 1.25** | 999 | `0.20 / sqrt(level)` per level, `baseEffect 0.20` |
| `tp_fire_rate` | **4 / 1.35** | **20** | +4% fire rate/level (ceiling +80%) |
| `tp_crit` | **4 / 1.35** | **25** | +4% crit damage/level (ceiling +100%) |
| `tp_pierce` | **10 / 1.9** | 6 | +0.5 pierce/level |
| `tp_aoe` (Annihilation) | **30**, 1 level | 1 | 25% AoE splash — **and it must actually be wired up** |
| `tp_execute` | **30**, 1 level | 1 | **+150%** damage below 25% HP (was +200%) |

`tp_damage` ladder: 3, 3, 4, 5, 7, 9, 11, 14, 17, 22 (cumulative 3, 6, 10, 15, 22, 31, 42, 56, 73, 95).
Effect: L1 +20%, L3 +46%, L5 +65%, L10 +100%, L25 +173%. A first transcendence (25 TP) now buys ~5 levels of it, or 3 levels plus a branch node — not 13 levels and +330%.

**`tp_aoe` is currently inert** (§1.6). `Game.ts` must read `PrestigeManager.hasAoESplash()` / `getAoESplashFraction()` and set `FireOptions.splashRadius` / `splashFraction` on the volley, composing with the `splash` upgrade (§5.2) and the artillery core by max-radius / summed-fraction-to-cap. Add a test that a TP-splash shot damages a second enemy inside the radius; a perk with no consumer must not be able to ship again.

### 9.2 Fortune (economy)

| Perk | Cost / scaling | Max | Effect |
|---|---|---:|---|
| `tp_resource` (Astral Harvest) | **3 / 1.25** | 999 | `0.12 / sqrt(level)` per level, `baseEffect 0.12` |
| `tp_treasure` | **4 / 1.38** | **15** | +2% chance of a 3x gold drop/level (ceiling +30%) |
| `tp_mana` | **4 / 1.38** | **15** | +10% mana regen/level |
| `tp_head_start` | **5 / 1.7** | **12** | `400 x 1.30^(level-1)` starting gold |
| **`tp_salvage`** *(replaces `tp_midas`)* | **28**, 1 level | 1 | **+40% loot-orb gold**; exclusive with `tp_arcane` |
| `tp_arcane` | **28**, 1 level | 1 | -30% ability cooldowns, -40% ability mana costs (unchanged) |

`tp_head_start` totals: L1 400, L4 2 475, L8 9 543, **L12 29 731** — sized to roughly one early run's income at the depth where it is affordable, against **1 874 391** today.

`tp_salvage` needs an `orbGoldMultiplier` input on the prestige stat context and a multiplier in `LootManager.valueFor('gold')`. Unlike Midas it scales with wave income rather than with projectiles fired, which is the rule the rest of the economy already follows.

### 9.3 Dominion (utility / automation)

| Perk | Cost / scaling | Max | Change |
|---|---|---:|---|
| `tp_auto_cast` | **8**, 1 level | 1 | reprice only |
| `tp_wave_start` | **3 / 1.55** | **8** | **+2 waves/level** (max start wave 16, was 30) |
| `tp_efficiency` | **3 / 1.5** | 7 | unchanged effect |
| `tp_game_speed` | **6 / 2.2** | **6** | `effectPerLevel: 0.5` so the **effect matches the description**; ceiling +3x, was +10x |
| `tp_auto_ascend` | **20**, 1 level | 1 | reprice only |
| `tp_auto_transcend` | **40**, 1 level | 1 | reprice only |

---

## 10. Companion change: the boss time budget

**This is required for the rest of the plan to land, and it is deliberately the smallest possible change to pacing.**

§1.2 and §2.2 show that the wall is always a boss wave and that non-boss waves run at 18–34% of budget. `expectedWaveSeconds` gives a wave `spawnInterval x (count - 1) + 20`, so a boss wave with 3–5 enemies gets ~23 s of kill budget for 3.5x the effective HP of its neighbours. Every attempt to size the tower against the trash curve dies at wave 10 (verified across nine candidate tunings).

In `src/data/formulas.ts`:

```ts
export const TARGET_WAVE_KILL_SECONDS = 20;
/** Kill budget a *single* boss is expected to need. Boss waves get one each. */
export const TARGET_BOSS_KILL_SECONDS = 28;

export function expectedWaveSeconds(wave: number, enemyCount = spawnCountForWave(wave)): number {
  const kill = isBossWave(wave)
    ? TARGET_BOSS_KILL_SECONDS * enemyCount
    : TARGET_WAVE_KILL_SECONDS;
  return spawnIntervalForWave(wave) * Math.max(0, enemyCount - 1) + kill;
}
```

And soften the first boss wave, which is the single tightest gate in the game:

```ts
export function bossCountForWave(wave: number): number {
  const tier = Math.max(1, Math.floor(wave / 10));
  return 2 + Math.max(0, tier - 1);   // was 2 + tier
}
```

Measured effect on the **shipping** curve at 25 s/boss: boss budget use falls from 53/46/66% (waves 10/20/30) to 42/28/33%, and the wall moves from 39 to 43. That headroom is what §5 spends on making trash waves real. Under the retuned tower the same sweep put non-boss waves at **~43% of budget ≈ 1.0x `expectedWaveSeconds`** — meeting the design intent instead of finishing in 60% of it.

`TARGET_BOSS_KILL_SECONDS` is a first-order gate knob: §14 gates 1, 2 and 4 settle it in the 22–30 band. Everything downstream (`enrageThresholdSeconds`, `PacingManager`, `docs/wave-system.md`, `docs/boss-encounters.md`, the boss durability budget) reads through `expectedWaveSeconds`, so no second copy of the constant may be introduced.

---

## 11. Save migration (v14 → v15)

- Preserve levels for every retained upgrade id, clamped to the new `maxLevel`.
- `upgradeDiscount` → `prospecting` at `min(20, ceil(oldLevel / 2))`, then delete the old key.
- `pierce`, `splash` start at 0.
- Do **not** refund gold for changed costs. This is a balance migration, not an accounting one.
- AP: clamp `ap_extra_shots`, `ap_back_shots`, `ap_scatter_shots` to level 1; clamp `ap_wave_skipper` to 15. If both `ap_warlord` and `ap_tycoon` are present, keep the one with more spent levels and clear the other. No AP refunds in v15.
- TP: `tp_midas` → `tp_salvage` at level 1 if owned; clamp `tp_wave_start` to 8, `tp_game_speed` to 6, `tp_head_start` to 12, `tp_fire_rate` to 20, `tp_crit` to 25, `tp_treasure`/`tp_mana` to 15.
- Add a round-trip test for a v14 save holding maxed Twin/Scatter, an `upgradeDiscount` level, `tp_midas`, and `tp_head_start` L20.

---

## 12. Gratification: what the panel must show

The numbers in §5 only *feel* good if the UI names the change. In `src/ui/UpgradePanel.ts`:

1. Every row shows its concrete next effect (`+11% damage`, `1.75 → 1.90 shots/s`, `+0.5% crit`).
2. Offence rows show **shots-to-kill against the current wave's `normal`**, before → after, when the value changes. That is the metric the whole plan is built on and it should be the metric the player sees.
3. Evolution rows are visibly marked as milestones, with the level and the named unlock.
4. `pierce` and `splash` rows read as milestones, not trickle buys — they are the two lines a player saves for.
5. AP projectile rows state the payload: "adds one front projectile at 55% damage".

---

## 13. Sim instrumentation (do this first)

`sim/model.ts` currently lets the greedy buyer touch **6 of 27** upgrades (`BUYABLE`), has no coverage term in `dps()`, and models no double-gold roll. A purchasable effect the sim cannot see is an effect nobody is balancing.

1. Widen `BUYABLE` to every upgrade that moves DPS or gold, including `pierce`, `splash` and `prospecting`.
2. Add an **effective-targets-per-shot** term to `dps()` fed by `pierceExtra`, splash fraction/radius and the AP/TP coverage nodes, credited conservatively against the wave's enemy density (the model has no positions, so err low).
3. Read `PRESTIGE_PROJECTILE_TUNING` so extra/scatter/rear payloads are measured, not assumed.
4. Add the double-gold roll to the gold model.
5. New reporting table in `sim/balance.ts`, fresh-run only, at waves 5/10/20/30/wall:
   - budget use, split boss vs non-boss;
   - **shots-to-kill for a same-wave `normal` and for the wave's average enemy**;
   - levels of `damage` / `fireRate` / `pierce` / `goldMulti`;
   - waves-of-income per core-line level;
   - **run income growth per wave** (the §6.3 figure);
   - composed DPS and the single-purchase DPS delta.

Gate: `npm run sim` reports the new table with production behavior unchanged before any data file is touched.

---

## 14. Verification gates

```bash
npm run test
npm run typecheck
npm run build
npm run checks
npm run sim
```

| # | Gate | Target |
|---:|---|---|
| 1 | Fresh no-blessing wall | **36–44** (baseline 39) |
| 2 | Fresh blessing wall | **50–60** (baseline 54.7) |
| 3 | Fresh run length to the wall | **22–35 min** (baseline 21) |
| 4 | Non-boss budget use, waves 5–wall | **median 40–60%** (baseline 25%) |
| 5 | Boss budget use | **55–90%**, and the wall is *not* required to be a boss wave (baseline 46–66% and always a boss wall) |
| 6 | Shots-to-kill, same-wave `normal` | **2.0–4.5 at every sampled wave** (baseline 0.3–1.4) |
| 7 | Single-purchase DPS delta | no ordinary level > **+25%** total composed DPS; no level moves shots-to-kill by more than one step |
| 8 | Run income growth | **≤1.16x/wave** (baseline 1.185) |
| 9 | Crowd safety (in-browser, `npm run dev`) | a wave-30 idle run does not lose the tower to accumulated enemies with only §5.3 defense levels bought |
| 10 | AP gate — first ascension | 25 AP **cannot** buy any projectile perk |
| 11 | AP gate — first wall | 82 AP buys **at most one** signature node plus one utility line |
| 12 | Projectile payload | unit test proves Twin/Rear land at 55% and Scatter lanes at 35% of `rawDamage` |
| 13 | Prestige liveness | unit test that `tp_aoe` splashes a second enemy; `hasAoESplash` has a caller |
| 14 | Economy caps | unit tests exercise the Avarice +75%, Dragon's Hoard +50% and Wave Mastery x3 clamps |
| 15 | Shockwave | unit test that radius **increases** with level and cooldown decreases |
| 16 | First transcendence | 25 TP buys ~5 levels of Cosmic Power (+65%), not 13 (+330%) |
| 17 | Idle contract | active play stays within **+25–40%**; no purchase requires manual play |
| 18 | Cores | every core stays inside ±15% of marksman's wall wave (unchanged gate) |
| 19 | Save | v14 → v15 round-trip test passes, including the `upgradeDiscount` → `prospecting` and `tp_midas` → `tp_salvage` maps |
| 20 | Docs | `AGENTS.md` counts, `docs/upgrade-system.md`, `docs/prestige-system.md`, `docs/data-formulas.md`, `docs/core-system.md`, `docs/wave-system.md`, `docs/boss-encounters.md`, `docs/save-system.md` all match the shipped tables |

---

## 15. Task breakdown

Each task ends green on `npm run typecheck && npm run test && npm run sim`. Run `impact` before touching any named symbol and `detect_changes({scope: "compare", base_ref: "main"})` before each commit (CLAUDE.md).

| # | Task | Touches | Gate |
|---:|---|---|---|
| 1 | **Instrumentation.** Widen `BUYABLE`, add the coverage term, the double-gold roll and the §13 report. No behaviour change. | `sim/model.ts`, `sim/balance.ts` | Baseline table reproduces §1 exactly |
| 2 | **Bug fixes, standalone.** Shockwave radius; wire `tp_aoe`; fix `tp_game_speed`'s effect/description. | `stats/contributors/upgrades.ts`, `game/Game.ts`, `data/prestige.ts` | 13, 15 |
| 3 | **Boss time budget.** `TARGET_BOSS_KILL_SECONDS`, `bossCountForWave`, `expectedWaveSeconds`. | `data/formulas.ts` | 5, and 1 stays in band on the *old* upgrade table |
| 4 | **Rebuild `UPGRADES`.** §5.3 table, `upgradeDiscount` → `prospecting`, new `pierce` / `splash` with keys, clamps and contributors. | `data/upgrades.ts`, `stats/keys.ts`, `stats/contributors/upgrades.ts`, `systems/ProjectileManager.ts` | 1, 4, 6, 7 |
| 5 | **Evolutions and economy caps.** §6.1 moves, two new effect ids, §6.2 clamps. | `data/upgrades.ts`, `data/formulas.ts`, `stats/contributors/evolutions.ts`, `game/Game.ts`, `systems/EnemyManager.ts` | 8, 14 |
| 6 | **Projectile payloads.** `ShotVariant.damageScale`, `PRESTIGE_PROJECTILE_TUNING`, `buildShotVariants`, panel copy. | `systems/ProjectileManager.ts`, `game/Game.ts`, `data/prestige.ts`, `ui/PrestigePanel.ts` | 12 |
| 7 | **AP tree.** §8.2 re-tier and reprice, `ap_quiver` and `ap_pierce`, §8.4 core costs. | `data/prestige.ts`, `data/cores.ts`, `systems/PrestigeManager.ts` | 10, 11, 18 |
| 8 | **TP tree.** §9, `tp_midas` → `tp_salvage` with `orbGoldMultiplier` through context/contributor/`LootManager`. | `data/prestige.ts`, `stats/contributors/prestige.ts`, `systems/LootManager.ts` | 16 |
| 9 | **Upgrade panel.** §12, especially the shots-to-kill readout. | `ui/UpgradePanel.ts`, `ui/PrestigePanel.ts` | manual + 9 |
| 10 | **Save v15.** §11 migration and round-trip test. | `systems/SaveManager.ts`, `tests/save.test.ts` | 19 |
| 11 | **Docs.** All files in gate 20, plus the `AGENTS.md` upgrade count 27 → 29 and save version 14 → 15. | `docs/*`, `AGENTS.md` | 20 |

---

## 16. Follow-up levers, in order

If the first pass misses a gate, turn these knobs in this order and re-run the sim. Do not skip ahead.

1. **`TARGET_BOSS_KILL_SECONDS`** (22–30) — moves gates 5 and 1 with almost no side effects.
2. **Upgrade base costs**, then **cost growths** — moves gates 4, 7 and the purchase cadence.
3. **`damage`'s per-level ratio** (1.10–1.12) — the single most sensitive number for gate 6; ±0.01 is a ~1.4x swing in per-shot damage over 35 waves.
4. **`fireRate`'s `effectPerLevel` and `maxLevel`** — moves gate 4 without touching shots-to-kill.
5. **AP/TP perk costs** — gates 10, 11, 16.
6. **Coverage caps** (`pierce` max, splash fraction cap) — the late-game wall depth.
7. **Economy evolution caps** — gate 8.
8. **Only then** `GOLD_GROWTH` (1.08 → 1.07) or `spawnIntervalForWave`.
9. **Never** raise `ENEMY_HP_GROWTH` to compensate for player scaling. That hides the upgrade-curve bug instead of fixing it, and it invalidates every table in §1.
