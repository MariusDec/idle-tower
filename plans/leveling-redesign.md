# Levelling Redesign — Tower XP, Talent Points and the Talent Tree

**Goal:** turn tower levelling from a background trickle that finishes in a few days into the game's long-term progression spine, and replace the 37-node "+6% damage" talent list with a 60-node, grid-laid-out tree whose nodes are worth *planning around*.

**Related components:** `src/data/xpTables.ts`, `src/data/talentTree.ts`, `src/data/upgrades.ts`, `src/data/pacing.ts`, `src/systems/TowerXpManager.ts`, `src/systems/TalentManager.ts`, `src/systems/SaveManager.ts`, `src/systems/ProjectileManager.ts`, `src/systems/AbilityManager.ts`, `src/systems/AutomationManager.ts`, `src/systems/LootManager.ts`, `src/systems/PacingManager.ts`, `src/systems/EnemyManager.ts`, `src/game/Game.ts`, `src/stats/{keys,context,resolve}.ts`, `src/stats/contributors/{talents,evolutions}.ts`, `src/ui/TalentPanel.ts`, `src/ui/HUD.ts`, `src/styles/main.css`, `src/types.ts`, `sim/checks.ts`, `tests/*`, `docs/*`.

**Tech stack:** TypeScript, Vite, Vitest, the in-repo balance simulator (`npm run sim`, `npm run checks`).

**Status:** planning only. Every constant below is a *starting value* with the arithmetic shown, so it can be typed in as-is; §17 is the gate that settles the final numbers.

**How to read this document:** §1–2 are the diagnosis. §3–5 are the XP system. §6–10 are the talent tree (data, stats, behaviours, plumbing). §11 is the UI. §12–13 are persistence and companion changes. §14–18 are tests, docs, task order, verification and the tuning levers.

---

## 1. Measured baseline

Numbers below come from driving the shipping data tables (`src/data/xpTables.ts`, `src/data/formulas.ts`, `src/data/enemies.ts`) through the same arithmetic the game uses. Reproduce with the script in §17.1.

### 1.1 The XP curve barely moves with depth

`xpPerKill(type, wave)` is `BASE_XP_PER_KILL[type] * log2(waveScaledHP)`. Because `enemyHPForWave` is `baseHP * 1.11^(wave-1)`, the `log2` collapses the entire HP curve into a **straight line in `wave`**:

```
log2(6 * 1.11^(w-1)) = 2.585 + 0.1506 * (w - 1)
```

| Wave | 1 | 10 | 40 | 100 | 200 |
|---|---:|---:|---:|---:|---:|
| `normal` enemy HP | 6 | 15.4 | 393 | 232 K | 6.9 G |
| XP for killing it | 2 | 3 | 8 | 17 | 32 |

A wave-200 `normal` has **1.1 billion times** the HP of a wave-1 `normal` and pays **16x** the XP. Pushing deeper is not what levels you; *time* is.

### 1.2 The whole tree fits inside one long run

`talentPointsAtLevel(level) = level + floor(level / 5)`, and the tree's total capacity is exactly **131 points**:

| Branch | Nodes | Total `maxPoints` |
|---|---:|---:|
| offense | 10 | 38 |
| defense | 9 | 31 |
| utility | 9 | 31 |
| magic | 9 | 31 |
| **total** | **37** | **131** |

131 points needs level **110** (`110 + 22 = 132`). Walking a single run from wave 1 to wave 200 earns 561 K XP, and `TOWER_XP_TABLE[109] = 557 K`. **One deep run fills the tree.** The player's verdict — "131 levels, easy to get there in a few days" — is exactly right.

### 1.3 The talents themselves

Of 37 nodes, **31 are a single flat percentage** on a stat the player already buys with gold, research, prestige, equipment and blessings. The six that are not (`extra_shield`, `head_start`, `mana_reservoir`, `chain_bounce`, `mana_shield`, `barrage`) are still flat numbers, just in non-percent units.

Concretely: `precision` at 5/5 is +15% crit chance — but the same run buys `critChance` levels with gold, a `Precision` passive, `tpCritDamage`, and up to three crit blessings. The talent is a rounding error inside its own stat.

### 1.4 Three live bugs in the current system

1. **`costPerPoint` is dead data.** `TalentManager.allocate()` calls `spendTalentPoint()` exactly once regardless of `def.costPerPoint`, so the 2- and 3-point tiers cost one point like everything else. `tests/content-coverage.test.ts` asserts the field is non-zero, which is why nobody noticed.
2. **The `Enlightenment` evolution breaks the points/level invariant.** `Game.ts:1419` grants a bare talent point every 12 waves, but `sim/checks.ts:227` asserts `unspentTalentPoints === talentPointsAtLevel(level)`. The check only passes because the sim never buys `xpGain` to level 25.
3. **Prerequisites demand a *maxed* parent** (`TalentManager.canAllocate`), so reaching tier 3 of a branch costs 10 points in two tier-1 nodes you may not want. Combined with the vertical-stack layout, the tree reads as a shopping list with arbitrary padding.

### 1.5 The panel

`TalentPanel.ts` renders each branch as a flat, `margin-left`-indented column of full-width rows sorted by `(tier, BFS-depth)`. The SVG link layer draws real edges, but because every node is on its own row and indentation is the only horizontal signal, a node with two parents produces two nearly-vertical lines through five unrelated rows. There is no way to see "these three are alternatives" or "this is the end of the branch".

---

## 2. Diagnosis

| Symptom | Cause |
|---|---|
| Levelling ends in days | Requirement curve is `120 * L^1.8` (polynomial) against XP that grows ~`wave^2` per wave — the gain outruns the cost. |
| Depth is not rewarded | `log2(hp)` flattens a 1.11^w curve into a line. |
| Talents feel weightless | 31/37 nodes are flat percentages on already-crowded stats. |
| No planning | Every node is affordable in order; the only choice is three exclusive pairs at the very bottom, reached after the run is decided. |
| Tree is unreadable | Layout is a 1-D list; the graph structure exists in the data and nowhere on screen. |

**The four design rules this plan follows:**

1. **XP is a depth currency.** A wave-200 kill must be worth meaningfully more than a wave-20 kill, and the requirement curve must be geometric so the cap is a horizon, not a milestone.
2. **A talent must do something the player can name.** Either a new verb (a stacking buff, a free recast, a boss-damage axis) or a number large enough to change a build decision.
3. **Position on the grid is the design.** Row = depth gate, column = sub-theme, edges = real prerequisites, and the bottom row is three mutually exclusive identities.
4. **Overflow has a home.** Once the designed tree is full, points flow into endless nodes so a level is never worthless.

---

## 3. The level cap and the point budget

| Constant | Value | Where |
|---|---|---|
| `TOWER_LEVEL_CAP` | **200** | `src/data/xpTables.ts` |
| Talent points at cap | **200** (1 per level, level 1 included) | `talentPointsAtLevel` |
| Designed-tree capacity, *declared* | **168** (42 per branch) | `src/data/talentTree.ts` |
| Designed-tree capacity, *reachable* | **160** (40 per branch — only one of three keystones per branch is takeable) | — |
| Reachable / cap | **80%** ( ≥ the 75% requirement) | — |
| Endless nodes | 4 (one per branch), `maxPoints: 999` each | — |
| Points left for endless nodes at cap | **40** | 200 − 160 |

**Levels become 1-based.** Today `towerXp.level` starts at 0 and the HUD prints `Lv.${level + 1}`, which makes "level cap 200" ambiguous. After this change:

- a fresh save is `level: 1`, `xp: 0`, `unspentTalentPoints: 1`;
- `TOWER_XP_TABLE[1] === 0`;
- `talentPointsAtLevel(level) = clamp(level, 0, TOWER_LEVEL_CAP)`;
- the HUD prints `Lv.${level}`;
- `Renderer` detail tiers (`TOWER_VISUAL.detailTiers = [0, 10, 25, 50]`) are unchanged — a one-level shift is invisible.

Granting a point at level 1 is deliberate: a brand-new player opens the panel with something to spend.

---

## 4. XP gain

Replace the whole of `xpPerKill` / `xpPerWaveClear` / `enemyXpWeight`. **`enemyXpWeight` is deleted**; `PassiveAbilityManager` currently uses it — see §13.4.

### 4.1 Constants (`src/data/xpTables.ts`)

```ts
/**
 * Per-kill XP weight by type. Tracks how much of the player's *attention* a
 * type costs, not its HP bar — the wave scale below carries depth.
 */
export const KILL_XP_WEIGHT: Record<EnemyType, number> = {
  normal: 1,
  fast: 1,
  splitter: 0.8,
  flying: 1.1,
  tank: 1.8,
  healer: 1.6,
  shielded: 1.6,
  siege: 1.8,
  blinker: 1.5,
  burrower: 1.6,
  thief: 2.4,
  warden: 2.4,
  boss: 12,
};

/** Per-kill XP is linear in wave: a wave-200 kill is 41x a wave-1 kill. */
export const KILL_XP_WAVE_SLOPE = 0.20;

/** Wave-clear XP is superlinear: clearing deep waves is the real faucet. */
export const WAVE_CLEAR_XP_BASE = 1.5;
export const WAVE_CLEAR_XP_EXPONENT = 1.5;

/**
 * Extra multiple of the clear payout for a wave deeper than any ever cleared.
 * Total for a record wave is therefore (1 + this) x the normal clear XP.
 */
export const PIONEER_CLEAR_MULTIPLIER = 2.0;
```

### 4.2 Functions

```ts
/** Per-kill wave scale. Linear, so the enemy roster's weights stay legible. */
export function killXpWaveScale(wave: number): number {
  return 1 + KILL_XP_WAVE_SLOPE * Math.max(1, wave);
}

export function xpPerKill(type: EnemyType, wave: number): number {
  return Math.max(1, Math.round(KILL_XP_WEIGHT[type] * killXpWaveScale(wave)));
}

export function xpPerWaveClear(wave: number): number {
  return Math.max(1, Math.round(
    WAVE_CLEAR_XP_BASE * Math.pow(Math.max(1, wave), WAVE_CLEAR_XP_EXPONENT),
  ));
}

/** Clearing deeper than you ever have pays the clear XP again, doubled. */
export function pioneerBonusXp(wave: number, lifetimeHighestWave: number): number {
  if (wave <= lifetimeHighestWave) return 0;
  return Math.round(xpPerWaveClear(wave) * PIONEER_CLEAR_MULTIPLIER);
}
```

### 4.3 What that pays

| Wave | `normal` kill | `boss` kill | Wave clear | Whole wave (mixed) | Wave seconds |
|---:|---:|---:|---:|---:|---:|
| 1 | 1 | 14 | 2 | 8 | 28 |
| 5 | 2 | 24 | 17 | 38 | 34 |
| 10 (B) | 3 | 36 | 47 | 119 | 78 |
| 20 (B) | 5 | 60 | 134 | 314 | 115 |
| 40 (B) | 9 | 108 | 379 | 919 | 160 |
| 50 (B) | 11 | 132 | 530 | 1 322 | 193 |
| 100 (B) | 21 | 252 | 1 500 | 4 272 | 357 |
| 200 (B) | 41 | 492 | 4 243 | 14 575 | 685 |
| 500 (B) | 101 | 1 212 | 16 771 | 78 583 | 1 669 |

"Whole wave (mixed)" assumes an average type weight of 1.15 across `spawnCountForWave(wave)` enemies, plus the clear. "Wave seconds" is `expectedWaveSeconds`.

Kills and clears each carry roughly half a wave's XP at every depth (kill total grows as `w^2`, clear as `w^1.5`; at wave 40 the split is 59/41, at wave 200 it is 71/29). That is intentional: kills keep the combo XP bonus meaningful, clears keep depth ahead of farming.

### 4.4 XP rate against depth

Full run from wave 1 to `W`, with `expectedWaveSeconds` as the clock:

| Deepest wave `W` | Run XP | Run hours | XP / hour |
|---:|---:|---:|---:|
| 60 | 4.2 × 10⁴ | 0.9 | 4.5 × 10⁴ |
| 100 | 1.7 × 10⁵ | 1.9 | 8.8 × 10⁴ |
| 200 | 1.1 × 10⁶ | 5.7 | 2.0 × 10⁵ |
| 400 | 7.9 × 10⁶ | 19.7 | 4.0 × 10⁵ |
| 800 | 5.8 × 10⁷ | 72.9 | 8.0 × 10⁵ |
| 1500 | 3.6 × 10⁸ | 247 | 1.5 × 10⁶ |

XP per hour is close to **linear in the player's current depth**, which is the property the requirement curve in §5 is fitted against.

---

## 5. XP required per level

### 5.1 Constants

```ts
/** Hard ceiling. Levels past this earn nothing; the HUD bar reads MAX. */
export const TOWER_LEVEL_CAP = 200;

/**
 * The requirement curve: `XP_CURVE_BASE * (L-1)^XP_CURVE_POLY * XP_CURVE_GEO^(L-2)`
 * XP to go from level L-1 to level L.
 *
 * Polynomial early (so the first twenty levels land inside the first hour) and
 * geometric late (so the cap is a horizon rather than a milestone). The old
 * curve was polynomial all the way, which is why XP gain — itself ~w^2 per
 * wave — outran it and the tree filled in one run.
 */
export const XP_CURVE_BASE = 25;
export const XP_CURVE_POLY = 1.6;
export const XP_CURVE_GEO = 1.028;
```

### 5.2 Table construction

```ts
/** Cumulative XP required to *be* each level. Index 0 unused, index 1 is 0. */
export const TOWER_XP_TABLE: number[] = (() => {
  const table: number[] = [0, 0];
  for (let lv = 2; lv <= TOWER_LEVEL_CAP; lv++) {
    const needed = Math.floor(
      XP_CURVE_BASE * Math.pow(lv - 1, XP_CURVE_POLY) * Math.pow(XP_CURVE_GEO, lv - 2),
    );
    table.push(table[lv - 1] + needed);
  }
  return table;
})();
```

`TOWER_XP_TABLE.length === TOWER_LEVEL_CAP + 1`. It is strictly ascending from index 1, so the existing binary search still applies with the bounds moved:

```ts
export function xpToLevel(xp: number): number {
  if (xp < TOWER_XP_TABLE[2]) return 1;
  let lo = 1;
  let hi = TOWER_LEVEL_CAP;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (xp >= TOWER_XP_TABLE[mid]) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** XP needed to go from `level` to `level + 1`; Infinity at the cap. */
export function xpForNextLevel(level: number): number {
  if (level < 1) return TOWER_XP_TABLE[2];
  if (level >= TOWER_LEVEL_CAP) return Infinity;
  return TOWER_XP_TABLE[level + 1] - TOWER_XP_TABLE[level];
}

export function talentPointsAtLevel(level: number): number {
  return Math.max(0, Math.min(TOWER_LEVEL_CAP, Math.floor(level)));
}
```

**Delete** `TOWER_XP_CURVE_EXPONENT` and `TALENT_BONUS_LEVEL_INTERVAL`.

### 5.3 The resulting curve

| Level | XP for this level | Cumulative XP |
|---:|---:|---:|
| 2 | 25 | 25 |
| 5 | 249 | 504 |
| 10 | 1 048 | 3 929 |
| 20 | 4 569 | 31 346 |
| 30 | 11 846 | 113 193 |
| 40 | 25 083 | 298 358 |
| 50 | 47 634 | 663 765 |
| 60 | 84 509 | 1 328 480 |
| 80 | 234 210 | 4 373 690 |
| 100 | 583 823 | 12 256 151 |
| 120 | 1 361 453 | 31 097 463 |
| 140 | 3 032 588 | 73 804 097 |
| 160 | 6 532 621 | 167 000 837 |
| 180 | 13 717 635 | 364 672 204 |
| 190 | 19 723 521 | 533 149 990 |
| **200** | **28 231 999** | **774 752 780** |

### 5.4 Projected pacing

Modelled with §4.4's rate curve, a depth model of `W(t) = 40 * (1 + t/2)^0.8` (t in play-hours) and a flat ×1.5 for `Wisdom` + combo XP bonuses:

| Level | Hours to reach | Days @ 3 h/day | Player depth then |
|---:|---:|---:|---:|
| 10 | < 1 | — | ~45 |
| 25 | 1 | 0.3 | ~55 |
| 50 | 6 | 2 | ~140 |
| 75 | 16 | 5 | ~250 |
| 100 | 34 | 11 | ~420 |
| 125 | 66 | 22 | ~640 |
| 150 | 122 | 41 | ~1 090 |
| 175 | 214 | 71 | ~1 700 |
| **200** | **367** | **122** | ~2 600 |

A first run (wave 1 → the 0-AP wall at 39, ~33 min) yields **13 467 XP → level 15**, i.e. 15 talent points and access to row 3 of one branch. That is the intended opening.

### 5.5 `TowerXpManager` changes

```ts
export class TowerXpManager {
  get level(): number { return this.state.level; }
  get atCap(): boolean { return this.state.level >= TOWER_LEVEL_CAP; }

  addKillXp(type: EnemyType, wave: number): void {
    this.addXp(xpPerKill(type, wave));
  }

  /** `lifetimeHighestWave` is read *before* the wave manager updates it. */
  addWaveClearXp(wave: number, lifetimeHighestWave: number): void {
    this.addXp(xpPerWaveClear(wave) + pioneerBonusXp(wave, lifetimeHighestWave));
  }

  private addXp(amount: number): void {
    if (amount <= 0) return;
    // Total XP earned keeps counting past the cap — achievements and the Stats
    // panel read it — but the level and the point grant stop.
    const gained = Math.floor(amount * this.xpGainMultiplier);
    if (gained <= 0) return;
    this.state.totalXpEarned += gained;
    if (this.state.level >= TOWER_LEVEL_CAP) return;
    this.state.xp = Math.min(this.state.xp + gained, TOWER_XP_TABLE[TOWER_LEVEL_CAP]);
    const newLevel = xpToLevel(this.state.xp);
    while (this.state.level < newLevel) {
      const previous = this.state.level;
      this.state.level += 1;
      this.state.unspentTalentPoints +=
        talentPointsAtLevel(this.state.level) - talentPointsAtLevel(previous);
      this.bus.emit('tower_leveled', {
        level: this.state.level,
        xp: this.state.xp,
        talentPoints: this.state.unspentTalentPoints,
      });
    }
  }

  getProgressToNextLevel(): number {
    if (this.state.level >= TOWER_LEVEL_CAP) return 1;
    const needed = xpForNextLevel(this.state.level);
    if (!Number.isFinite(needed) || needed <= 0) return 1;
    const into = this.state.xp - TOWER_XP_TABLE[this.state.level];
    return Math.min(1, Math.max(0, into) / needed);
  }
}
```

`grantTalentPoint()` stays (it is used by refunds) but **loses its `Enlightenment` caller** — see §13.1.

### 5.6 `Game.ts` call sites

- `Game.ts:1422` becomes `this.towerXpMgr.addWaveClearXp(cleared, lifetimeBefore)`, where `lifetimeBefore` is captured at the top of the `wave_cleared` handler, before `state.stats.lifetimeHighestWave` is written.
- `Game.ts:312` and `Game.ts:4227` fresh-state literals become `{ xp: 0, level: 1, unspentTalentPoints: 1, totalXpEarned: 0 }`.
- `Game.ts:2916` (ascension reset) already `Object.assign`s the fresh block; tower XP must **not** reset — verify the fresh literal it copies from is the *persistent* one. If `fresh.towerXp` is the new-game literal, replace that line with a no-op and add a comment: tower XP and talents survive both prestige layers.

### 5.7 HUD

- `HUD.ts:588` → `setText(this.xpLevelEl, \`Lv.${tx.level}\`)`.
- `HUD.ts:487` → `tx && tx.level >= TOWER_LEVEL_CAP ? 1 : this.displayXpProgress`.
- Add a `MAX` state: when `tx.level >= TOWER_LEVEL_CAP`, the percentage element reads `MAX` and the time-to-level hint is hidden.
- `HUD.ts:455` `xpForNextLevel(tx.level)` returns `Infinity` at cap — guard the division (`Number.isFinite`).

---

## 6. Talent tree — structure

### 6.1 Shape

Every branch is the **same 5-column × 6-row lattice**, which is what makes the panel readable at a glance:

```
col:      1       2       3       4       5
row 1:            A               B                 roots        5 pts each
row 2:    C       D               E       F         specialists  3 pts each
row 3:    G               H               I         payoffs      3 pts each
row 4:            J               K                 amplifiers   4 pts each
row 5:    X               Y               Z         keystones    1 pt, exclusive
── overflow divider ──
row 6:                    ∞                         endless      999 pts
```

Edges (identical in all four branches):

```
A → C, A → D
B → E, B → F
C → G, D → G, D → H, E → H, E → I, F → I
G → J, H → J, H → K, I → K
J → X, J → Y, K → Y, K → Z
∞  has no edges; it is gated on branch points only.
```

Per branch: 10 + 12 + 9 + 8 = **39 regular points**, plus exactly one of three keystones = **40 reachable**.

### 6.2 Gating

Two independent gates, both shown on the node:

1. **Prerequisite** — at least **one** rank in *any* named parent (was: all parents maxed). This is what the lines mean.
2. **Branch investment** — `requiresBranchPoints` points already spent **in the same branch**.

| Row | `requiresBranchPoints` |
|---:|---:|
| 1 | 0 |
| 2 | 4 |
| 3 | 12 |
| 4 | 22 |
| 5 (keystone) | 32 |
| 6 (endless) | 10 |

Consequences worth stating: rows 1–4 hold 39 points, so a keystone is affordable only once a branch is ~82% filled. All four keystones cost 4 × 33 = **132 points**, i.e. level 132 at the earliest — a genuine late-game goal.

### 6.3 Exclusivity

Keystones in the same branch share `exclusiveGroup: '<branch>_keystone'`. `canAllocate` refuses a node whose group already has a rank elsewhere. Refunding the branch releases the group.

---

## 7. `TalentDef` — the new data shape

Replace the interface in `src/data/talentTree.ts`:

```ts
export interface TalentEffectType {
  stat: TalentStat;
  /** Value per rank. Fractions for percentages, absolutes for counts. */
  perPoint: number;
}

export interface TalentDef {
  id: TalentId;
  name: string;
  /** Copy shown on the node's detail card. `{v}` = the per-rank value. */
  description: string;
  branch: TalentBranch;
  /** Grid row, 1..6. Row 6 is the endless node. */
  row: number;
  /** Grid column, 1..5. */
  col: number;
  maxPoints: number;
  /** Points that must already be spent in this branch. */
  requiresBranchPoints: number;
  prerequisites: TalentId[];
  /** Zero or more stat effects. A behaviour-only node may declare none. */
  effects: TalentEffectType[];
  /** Non-stat mechanic, keyed in `TALENT_BEHAVIOR_CONSUMERS`. */
  behavior?: TalentBehavior;
  /** Same-branch mutual exclusion. */
  exclusiveGroup?: string;
  /** True for the 999-rank overflow node; rendered below the divider. */
  endless?: true;
  icon: IconId;
  color: string;
}
```

**Removed fields:** `tier` (superseded by `row`), `costPerPoint` (was dead — see §1.4), `secondary` (folded into `effects[]`), `exclusive` (superseded by `exclusiveGroup`).

Keep the derived exports, adding one:

```ts
export const TALENT_BY_ID: Record<string, TalentDef> = ...
export const TALENTS_BY_BRANCH: Record<TalentBranch, TalentDef[]> = ...
/** Rows 1-5 of a branch, in (row, col) order — what the grid renders. */
export const TALENT_GRID: Record<TalentBranch, TalentDef[]> = ...
/** The one endless node per branch. */
export const TALENT_ENDLESS: Record<TalentBranch, TalentDef> = ...
```

### 7.1 Branch display

Branch **ids stay** (`offense` / `defense` / `utility` / `magic`) so `TalentBranch`, saves and tests do not churn. Only the labels and colours change, in `TalentPanel.BRANCH_DISPLAY`:

| id | Label | Colour |
|---|---|---|
| `offense` | **Wrath** | `FX.blood` `#d9534f` |
| `defense` | **Bulwark** | `FX.nature` `#4ec97a` |
| `utility` | **Fortune** | `FX.gold` `#f0b23c` |
| `magic` | **Arcana** | `FX.arcane` `#a95cff` |

---

## 8. Talent tree — the 60 nodes

Notation: `R/C` is grid row/column, `Max` is `maxPoints`, `Gate` is `requiresBranchPoints`, `Pre` is `prerequisites`. All percentage values are per rank unless the row says "1 rank".

### 8.1 Wrath (`offense`, `FX.blood`)

| id | Name | R/C | Max | Gate | Pre | Effects (per rank) | Icon |
|---|---|---|---:|---:|---|---|---|
| `wr_edge` | Honed Edge | 1/2 | 5 | 0 | — | `base_damage_pct` +0.06 | `crossed-swords` |
| `wr_cadence` | Cadence | 1/4 | 5 | 0 | — | `fire_rate_pct` +0.04 | `supersonic-arrow` |
| `wr_precision` | Precision | 2/1 | 3 | 4 | `wr_edge` | `crit_chance_pct` +0.03 | `crosshair-arrow` |
| `wr_cruelty` | Cruelty | 2/2 | 3 | 4 | `wr_edge` | `crit_damage_pct` +0.15 | `deadly-strike` |
| `wr_focus_fire` | Focus Fire | 2/4 | 3 | 4 | `wr_cadence` | `focus_stack_pct` +0.04 | `eye-target` |
| `wr_volley` | Volley | 2/5 | 3 | 4 | `wr_cadence` | `extra_projectile_chance` +0.04 | `missile-swarm` |
| `wr_executioner` | Executioner | 3/1 | 3 | 12 | `wr_precision`, `wr_cruelty` | `execution_damage_pct` +0.12 | `executioner-hood` |
| `wr_bloodlust` | Bloodlust | 3/3 | 3 | 12 | `wr_cruelty`, `wr_focus_fire` | `kill_frenzy_pct` +0.015 | `enrage` |
| `wr_overwatch` | Overwatch | 3/5 | 3 | 12 | `wr_focus_fire`, `wr_volley` | `range_pct` +0.10, `overwatch_damage_pct` +0.08 | `telescope` |
| `wr_siegebreaker` | Siegebreaker | 4/2 | 4 | 22 | `wr_executioner`, `wr_bloodlust` | `armor_penetration_pct` +0.08, `boss_damage_pct` +0.12 | `armor-punch` |
| `wr_killing_spree` | Killing Spree | 4/4 | 4 | 22 | `wr_bloodlust`, `wr_overwatch` | `crit_followup_chance` +0.10 | `striking-arrows` |
| `wr_key_annihilation` | **Annihilation** | 5/1 | 1 | 32 | `wr_siegebreaker` | `base_damage_pct` +0.70, `fire_rate_pct` −0.25, `shot_splash_radius` +`world(55)`, `shot_splash_fraction` +0.45 | `bright-explosion` |
| `wr_key_deadeye` | **Deadeye** | 5/3 | 1 | 32 | `wr_siegebreaker`, `wr_killing_spree` | `crit_chance_pct` +0.15, `crit_damage_pct` +1.50, `base_damage_pct` −0.20 | `dead-eye` |
| `wr_key_relentless` | **Relentless** | 5/5 | 1 | 32 | `wr_killing_spree` | behaviour `relentless` | `pentarrows-tornado` |
| `wr_endless_fury` | Fury | 6/3 | 999 | 10 | — | `all_damage_pct` +0.005 | `over-infinity` |

Descriptions (the `{v}` token is substituted with the per-rank value by the panel):

- Honed Edge — "Tower damage +{v}."
- Cadence — "Fire rate +{v}."
- Precision — "Critical chance +{v}."
- Cruelty — "Critical damage +{v}."
- **Focus Fire** — "Every consecutive hit on the same enemy adds +{v} damage, stacking to 5. Resets when you switch target." *(rewards lock-on targeting modes)*
- Volley — "+{v} chance to fire an extra projectile."
- Executioner — "+{v} damage to enemies below 50% HP."
- **Bloodlust** — "Each kill grants +{v} damage for 4 s, stacking to 8."
- **Overwatch** — "Range +{v}; targets beyond 70% of your range take +{v2} damage."
- **Siegebreaker** — "Armour penetration +{v}; damage to bosses +{v2}."
- **Killing Spree** — "Critical hits have a {v} chance to immediately fire a free shot for 60% damage."
- **Annihilation** — "Shots hit for +70% but fire 25% slower, and every shot carries a 55 u blast dealing 45%."
- **Deadeye** — "Critical chance +15%, critical damage +150%, but base damage −20%."
- **Relentless** — "Every 5th shot fires a 3-arrow fan, each at 65% damage."
- Fury — "All damage +{v} per rank. No limit."

### 8.2 Bulwark (`defense`, `FX.nature`)

| id | Name | R/C | Max | Gate | Pre | Effects (per rank) | Icon |
|---|---|---|---:|---:|---|---|---|
| `bw_toughness` | Toughness | 1/2 | 5 | 0 | — | `max_hp_pct` +0.06 | `armor-vest` |
| `bw_plating` | Plating | 1/4 | 5 | 0 | — | `defense_pct` +0.05 | `layered-armor` |
| `bw_evasion` | Evasion | 2/1 | 3 | 4 | `bw_toughness` | `dodge_chance` +0.03 | `acrobatic` |
| `bw_thornmail` | Thornmail | 2/2 | 3 | 4 | `bw_toughness` | `thorns_pct` +0.12 | `spiked-armor` |
| `bw_ramparts` | Ramparts | 2/4 | 3 | 4 | `bw_plating` | `wall_regen_pct` +0.15, `wall_contact_pct` +0.12 | `brick-wall` |
| `bw_regrowth` | Regrowth | 2/5 | 3 | 4 | `bw_plating` | `health_regen_pct` +0.08 | `regeneration` |
| `bw_aegis` | Aegis | 3/1 | 3 | 12 | `bw_evasion`, `bw_thornmail` | `shield_charges` +1, `shield_recharge_pct` +0.12 | `energy-shield` |
| `bw_second_wind` | Second Wind | 3/3 | 3 | 12 | `bw_thornmail`, `bw_ramparts` | `second_wind_pct` +0.06 | `shining-heart` |
| `bw_bastion` | Bastion | 3/5 | 3 | 12 | `bw_ramparts`, `bw_regrowth` | `knockback_pct` +0.25 | `stone-wall` |
| `bw_ironhide` | Ironhide | 4/2 | 4 | 22 | `bw_aegis`, `bw_second_wind` | `armor_pct` +0.10, `max_hp_pct` +0.06 | `metal-plate` |
| `bw_vengeance` | Vengeance | 4/4 | 4 | 22 | `bw_second_wind`, `bw_bastion` | `thorns_pct` +0.15, `low_hp_damage_pct` +0.10 | `spiked-halo` |
| `bw_key_fortress` | **Fortress** | 5/1 | 1 | 32 | `bw_ironhide` | `max_hp_pct` +0.45, `defense_pct` +0.30, `range_pct` −0.15 | `locked-fortress` |
| `bw_key_retaliation` | **Retaliation** | 5/3 | 1 | 32 | `bw_ironhide`, `bw_vengeance` | `thorns_pct` +2.00, behaviour `retaliation` | `armored-boomerang` |
| `bw_key_juggernaut` | **Juggernaut** | 5/5 | 1 | 32 | `bw_vengeance` | behaviour `juggernaut` | `rock-golem` |
| `bw_endless_resolve` | Resolve | 6/3 | 999 | 10 | — | `max_hp_pct` +0.006, `defense_pct` +0.003 | `over-infinity` |

Descriptions:

- **Ramparts** — "Wall regeneration +{v}; the wall soaks {v2} more of the damage enemies deal on contact."
- Aegis — "+{v} shield charge; shield recharges {v2} faster."
- **Second Wind** — "Falling below 35% HP heals {v} of max HP and grants +{v×2.5} damage for 6 s. Once per wave."
- **Bastion** — "Knockback +{v}; enemies you knock back also take your thorns damage."
- **Vengeance** — "Thorns +{v}; while below 50% HP, damage +{v2}."
- **Fortress** — "Max HP +45%, defence +30%, range −15%."
- **Retaliation** — "Thorns ×3, and thorns now also reflect onto enemies that attack from range."
- **Juggernaut** — "While the wall stands you take 30% less damage. When the wall breaks you are immune for 4 s. Once per wave."

### 8.3 Fortune (`utility`, `FX.gold`)

| id | Name | R/C | Max | Gate | Pre | Effects (per rank) | Icon |
|---|---|---|---:|---:|---|---|---|
| `ft_greed` | Greed | 1/2 | 5 | 0 | — | `gold_mult_pct` +0.08 | `shiny-purse` |
| `ft_insight` | Insight | 1/4 | 5 | 0 | — | `xp_gain_pct` +0.06 | `wisdom` |
| `ft_scavenge` | Scavenge | 2/1 | 3 | 4 | `ft_greed` | `double_gold_chance` +0.05 | `knapsack` |
| `ft_head_start` | Head Start | 2/2 | 3 | 4 | `ft_greed` | `head_start_waves` +2 | `checkered-flag` |
| `ft_lucky_finds` | Lucky Finds | 2/4 | 3 | 4 | `ft_insight` | `equipment_find_chance` +0.06 | `clover` |
| `ft_thrift` | Thrift | 2/5 | 3 | 4 | `ft_insight` | `upgrade_cost_reduction` +0.03 | `cog` |
| `ft_prospector` | Prospector | 3/1 | 3 | 12 | `ft_scavenge`, `ft_head_start` | `orb_value_pct` +0.12 | `magnet` |
| `ft_tempo` | Tempo | 3/3 | 3 | 12 | `ft_head_start`, `ft_lucky_finds` | `momentum_gain_pct` +0.40 | `fast-forward-button` |
| `ft_autonomy` | Autonomy | 3/5 | 3 | 12 | `ft_lucky_finds`, `ft_thrift` | `auto_buy_speed_pct` +0.07 | `vintage-robot` |
| `ft_windfall` | Windfall | 4/2 | 4 | 22 | `ft_prospector`, `ft_tempo` | `windfall_mult` +2.0 | `open-treasure-chest` |
| `ft_interest` | Interest | 4/4 | 4 | 22 | `ft_tempo`, `ft_autonomy` | `interest_pct` +0.005 | `gold-mine` |
| `ft_key_midas` | **Midas Touch** | 5/1 | 1 | 32 | `ft_windfall` | `gold_mult_pct` +0.60, `enemy_hp_pct` +0.12 | `crown-coin` |
| `ft_key_archivist` | **Archivist** | 5/3 | 1 | 32 | `ft_windfall`, `ft_interest` | `xp_gain_pct` +0.60, behaviour `archivist` | `book-pile` |
| `ft_key_quartermaster` | **Quartermaster** | 5/5 | 1 | 32 | `ft_interest` | `upgrade_cost_reduction` +0.15, behaviour `quartermaster` | `gears` |
| `ft_endless_avarice` | Avarice | 6/3 | 999 | 10 | — | `gold_mult_pct` +0.004, `xp_gain_pct` +0.0025 | `over-infinity` |

Descriptions:

- Insight — "Tower XP gain +{v}."
- **Prospector** — "Loot orbs are worth +{v} and drift {v×1.67} faster toward you."
- **Tempo** — "Calling a wave early earns +{v} more momentum, and the momentum cap rises by {v/20}." *(rank 3 → +120% gain, cap 6% → 12%)*
- **Windfall** — "Every 10th wave cleared pays a chest worth {v}× that wave's clear gold. At rank 4 it also drops a guaranteed piece of equipment."
- **Interest** — "At the start of each wave, gain gold equal to {v} of your banked gold (capped)."
- **Midas Touch** — "Gold ×1.6, but enemies have +12% HP."
- **Archivist** — "Tower XP gain +60%, and respeccing talents is free."
- **Quartermaster** — "Upgrade costs −15%; auto-buy also purchases ability upgrades and never spends past 40% of your gold."

### 8.4 Arcana (`magic`, `FX.arcane`)

| id | Name | R/C | Max | Gate | Pre | Effects (per rank) | Icon |
|---|---|---|---:|---:|---|---|---|
| `ar_power` | Arcane Power | 1/2 | 5 | 0 | — | `ability_damage_pct` +0.07 | `bolt-spell-cast` |
| `ar_thrift` | Mana Thrift | 1/4 | 5 | 0 | — | `mana_cost_reduction` +0.04 | `vial` |
| `ar_flow` | Mana Flow | 2/1 | 3 | 4 | `ar_power` | `mana_regen_pct` +0.07 | `droplets` |
| `ar_reservoir` | Reservoir | 2/2 | 3 | 4 | `ar_power` | `max_mana_flat` +20 | `energy-tank` |
| `ar_enchanted` | Enchanted Shots | 2/4 | 3 | 4 | `ar_thrift` | `magic_proc_chance` +0.06 | `rune-sword` |
| `ar_attunement` | Attunement | 2/5 | 3 | 4 | `ar_thrift` | `ability_cooldown_pct` +0.07 | `hourglass` |
| `ar_frostbite` | Frostbite | 3/1 | 3 | 12 | `ar_flow`, `ar_reservoir` | `slow_effect_pct` +0.08, `chilled_damage_pct` +0.07 | `snowflake-1` |
| `ar_conduit` | Conduit | 3/3 | 3 | 12 | `ar_reservoir`, `ar_enchanted` | `chain_bounce_count` +1, `meteor_damage_pct` +0.08 | `lightning-branches` |
| `ar_ward` | Mana Ward | 3/5 | 3 | 12 | `ar_enchanted`, `ar_attunement` | `mana_shield_pct` +6 | `magic-shield` |
| `ar_echo` | Spell Echo | 4/2 | 4 | 22 | `ar_frostbite`, `ar_conduit` | `ability_echo_chance` +0.08 | `echo-ripples` |
| `ar_harvest` | Soul Harvest | 4/4 | 4 | 22 | `ar_conduit`, `ar_ward` | `mana_on_kill_pct` +0.003, `buff_duration_pct` +0.08 | `chalice-drops` |
| `ar_key_archmage` | **Archmage** | 5/1 | 1 | 32 | `ar_echo` | `ability_damage_pct` +0.60, behaviour `archmage` | `wizard-face` |
| `ar_key_overcharge` | **Overcharge** | 5/3 | 1 | 32 | `ar_echo`, `ar_harvest` | `ability_damage_pct` +1.30, `mana_cost_reduction` −0.60 | `lightning-trio` |
| `ar_key_battery` | **Battery** | 5/5 | 1 | 32 | `ar_harvest` | `max_mana_pct` +0.50, behaviour `battery` | `energy-tank` |
| `ar_endless_ascendance` | Ascendance | 6/3 | 999 | 10 | — | `ability_damage_pct` +0.005, `mana_regen_pct` +0.003 | `over-infinity` |

Descriptions:

- Attunement — "Ability cooldowns −{v}."
- **Frostbite** — "Slows are {v} stronger; chilled or slowed enemies take +{v2} damage."
- Conduit — "+{v} chain-lightning bounce; chain and meteor damage +{v2}."
- **Spell Echo** — "Each ability cast has a {v} chance to fire again immediately, for free."
- **Soul Harvest** — "Kills restore {v} of max mana; buffs last {v2} longer."
- **Archmage** — "Ability damage +60%; every cast grants +20% fire rate for 5 s."
- **Overcharge** — "Ability damage +130%, but abilities cost 60% more mana."
- **Battery** — "Max mana +50%; while mana is above 80%, tower damage +30%."

### 8.5 Budget check

| Branch | Rows 1–4 | Keystone | Reachable | Declared |
|---|---:|---:|---:|---:|
| Wrath | 5+5+3+3+3+3+3+3+3+4+4 = 39 | 1 | 40 | 42 |
| Bulwark | 39 | 1 | 40 | 42 |
| Fortune | 39 | 1 | 40 | 42 |
| Arcana | 39 | 1 | 40 | 42 |
| **Total** | **156** | **4** | **160** | **168** |

160 / 200 = **80%**. Assert this in `tests/content-coverage.test.ts` (§14.2).

---

## 9. Stats: the `TalentStat` union and its consumers

### 9.1 The union (`src/data/talentTree.ts`)

```ts
export const TALENT_STATS = [
  // ── Wrath ──
  'base_damage_pct',
  'all_damage_pct',
  'fire_rate_pct',
  'crit_chance_pct',
  'crit_damage_pct',
  'range_pct',
  'armor_penetration_pct',
  'execution_damage_pct',
  'extra_projectile_chance',
  'focus_stack_pct',          // NEW
  'kill_frenzy_pct',          // NEW
  'overwatch_damage_pct',     // NEW
  'boss_damage_pct',          // NEW
  'crit_followup_chance',     // NEW
  'shot_splash_radius',       // NEW mapping
  'shot_splash_fraction',     // NEW mapping
  // ── Bulwark ──
  'max_hp_pct',
  'defense_pct',
  'armor_pct',
  'thorns_pct',
  'dodge_chance',
  'wall_regen_pct',
  'wall_contact_pct',         // NEW mapping
  'shield_charges',
  'shield_recharge_pct',      // NEW
  'health_regen_pct',
  'knockback_pct',            // NEW mapping
  'second_wind_pct',          // NEW
  'low_hp_damage_pct',        // NEW
  // ── Fortune ──
  'gold_mult_pct',
  'xp_gain_pct',              // NEW mapping
  'double_gold_chance',
  'head_start_waves',
  'equipment_find_chance',
  'upgrade_cost_reduction',
  'orb_value_pct',            // NEW
  'momentum_gain_pct',        // NEW
  'auto_buy_speed_pct',
  'windfall_mult',            // NEW
  'interest_pct',             // NEW
  'enemy_hp_pct',             // NEW mapping
  // ── Arcana ──
  'ability_damage_pct',       // replaces magic_damage_pct / all_magic_pct
  'mana_cost_reduction',
  'ability_cooldown_pct',     // NEW mapping
  'mana_regen_pct',
  'max_mana_flat',
  'max_mana_pct',             // NEW mapping
  'magic_proc_chance',
  'slow_effect_pct',
  'chilled_damage_pct',       // NEW
  'chain_bounce_count',
  'meteor_damage_pct',
  'mana_shield_pct',
  'ability_echo_chance',      // NEW
  'mana_on_kill_pct',         // NEW
  'buff_duration_pct',
] as const;
```

**Deleted:** `all_effects_pct` (Mastery), `magic_damage_pct`, `all_magic_pct`. Delete the Mastery special-case block at the bottom of `TalentManager.getAllEffectValues()` with them.

### 9.2 New `StatKey`s (`src/stats/keys.ts`)

Add to the union, to `STAT_BASES` (all `0` unless noted) and to `STAT_CLAMPS`:

| Key | Base | Clamp | Written to |
|---|---:|---|---|
| `focusStackBonus` | 0 | `{min:0}` | `ProjectileManager.setFocusStackBonus` |
| `killFrenzyPerStack` | 0 | `{min:0}` | `Game` (buff on kill) |
| `overwatchDamage` | 0 | `{min:0}` | `ProjectileManager.setEvolutionShotBonuses` (merged) |
| `bossDamageBonus` | 0 | `{min:0}` | `ProjectileManager.setBossDamageBonus` |
| `critFollowUpChance` | 0 | `{min:0,max:1}` | `Game` (fire loop) |
| `shieldRechargeReduction` | 0 | `{min:0,max:0.8}` | `resolveStats` → `shieldRechargeTime` |
| `secondWindPower` | 0 | `{min:0}` | `Game` (tower_damaged) |
| `lowHpDamageBonus` | 0 | — | consumed inside `contributeTalents` (see below) |
| `orbValueBonus` | 0 | `{min:0}` | `LootManager.setValueBonus` |
| `momentumGainBonus` | 0 | `{min:0}` | `PacingManager.setMomentumBonus` |
| `windfallMultiplier` | 0 | `{min:0}` | `Game` (wave_cleared) |
| `interestRate` | 0 | `{min:0,max:0.5}` | `Game` (wave_started) |
| `chilledDamageBonus` | 0 | `{min:0}` | `ProjectileManager.setChilledDamageBonus` |
| `abilityEchoChance` | 0 | `{min:0,max:0.75}` | `AbilityManager.setEchoChance` |
| `manaOnKillFraction` | 0 | `{min:0,max:0.5}` | `Game` (enemy_killed) |

`lowHpDamageBonus` is a **context-conditional** stat, like the existing `last_stand` blessing: it never leaves the accumulator. `contributeTalents` reads `ctx.hpFraction` and only writes the multiplier when the condition holds — so it never needs a `StatKey` of its own. Same for the `battery` behaviour (`ctx.manaFraction`).

Add to `StatContext` (`src/stats/context.ts`):

```ts
/** Mana / max mana at the moment of the recompute. Read by the Battery keystone. */
manaFraction: number;
/** Talent behaviours currently held. */
talentBehaviors: TalentBehavior[];
```

`Game.buildStatContext()` fills both:

```ts
manaFraction: this.state.resources.maxMana > 0
  ? this.state.resources.mana / this.state.resources.maxMana
  : 1,
talentBehaviors: this.talentMgr.behaviors(),
```

A mana-fraction *threshold crossing* must trigger a recompute, exactly like `refreshHpThresholdStats` does for HP. Add `refreshManaThresholdStats()` alongside it, keyed on `mana / maxMana > TALENT_TUNING.batteryManaThreshold`, and call it from the same place in the substep. Guard it behind `this.talentMgr.hasBehavior('battery')` so a player without the keystone pays nothing.

### 9.3 `contributeTalents` — the full switch

`src/stats/contributors/talents.ts`. Keep the exhaustive `switch` and the `never` default.

```ts
export function contributeTalents(ctx: StatContext, acc: StatAccumulator): void {
  const a = acc.source('talent', 'Talents');
  for (const stat of TALENT_STATS) {
    const value = ctx.talents[stat] ?? 0;
    if (value === 0) continue;
    switch (stat) {
      // ── Wrath ──
      case 'base_damage_pct':
      case 'all_damage_pct':      a.mult('baseDamage', 1 + value); break;
      case 'fire_rate_pct':       a.mult('fireRate', 1 + value); break;
      case 'crit_chance_pct':     a.add('critChance', value); break;
      case 'crit_damage_pct':     a.add('critMultiplier', value); break;
      case 'range_pct':           a.mult('range', 1 + value); break;
      case 'armor_penetration_pct': a.add('armorPen', value); break;
      case 'execution_damage_pct':  a.add('talentExecuteBonus', value); break;
      case 'extra_projectile_chance': a.add('extraProjectileChance', value); break;
      case 'focus_stack_pct':     a.add('focusStackBonus', value); break;
      case 'kill_frenzy_pct':     a.add('killFrenzyPerStack', value); break;
      case 'overwatch_damage_pct': a.add('overwatchDamage', value); break;
      case 'boss_damage_pct':     a.add('bossDamageBonus', value); break;
      case 'crit_followup_chance': a.add('critFollowUpChance', value); break;
      case 'shot_splash_radius':  a.add('shotSplashRadius', value); break;
      case 'shot_splash_fraction': a.add('shotSplashFraction', value); break;

      // ── Bulwark ──
      case 'max_hp_pct':          a.mult('maxHp', 1 + value); break;
      case 'defense_pct':         a.mult('defense', 1 + value); break;
      case 'armor_pct':           a.mult('armor', 1 + value); break;
      case 'thorns_pct':          a.mult('thorns', 1 + value); break;
      case 'dodge_chance':        a.add('dodgeChance', value); break;
      case 'wall_regen_pct':      a.add('wallRegen', value); break;
      case 'wall_contact_pct':    a.add('wallContactExtra', value); break;
      case 'shield_charges':      a.add('shieldMaxCharges', Math.floor(value)); break;
      case 'shield_recharge_pct': a.add('shieldRechargeReduction', value); break;
      case 'health_regen_pct':    a.mult('healthRegen', 1 + value); break;
      case 'knockback_pct':       a.mult('knockbackForce', 1 + value); break;
      case 'second_wind_pct':     a.add('secondWindPower', value); break;
      case 'low_hp_damage_pct':
        // Conditional, like the `last_stand` blessing: only paid while hurt.
        if (ctx.hpFraction < TALENT_TUNING.lowHpThreshold) {
          a.mult('baseDamage', 1 + value, 'Vengeance');
        }
        break;

      // ── Fortune ──
      case 'gold_mult_pct':       a.mult('goldMultiplier', 1 + value); break;
      case 'xp_gain_pct':         a.mult('xpGainMultiplier', 1 + value); break;
      case 'double_gold_chance':  a.add('doubleGoldChance', value); break;
      case 'head_start_waves':    a.add('headStartWaves', Math.floor(value)); break;
      case 'equipment_find_chance': a.add('equipmentFindChance', value); break;
      case 'upgrade_cost_reduction': a.add('upgradeCostDiscount', -value); break;
      case 'orb_value_pct':       a.add('orbValueBonus', value); break;
      case 'momentum_gain_pct':   a.add('momentumGainBonus', value); break;
      case 'auto_buy_speed_pct':  a.add('autoBuyIntervalReduction', value); break;
      case 'windfall_mult':       a.add('windfallMultiplier', value); break;
      case 'interest_pct':        a.add('interestRate', value); break;
      case 'enemy_hp_pct':        a.mult('enemyHpMult', 1 + value); break;

      // ── Arcana ──
      case 'ability_damage_pct':  a.mult('abilityDamageMultiplier', 1 + value); break;
      case 'mana_cost_reduction': a.mult('abilityCostMultiplier', 1 - value); break;
      case 'ability_cooldown_pct': a.mult('abilityCooldownMultiplier', 1 - value); break;
      case 'mana_regen_pct':      a.mult('manaRegen', 1 + value); break;
      case 'max_mana_flat':       a.add('maxMana', value); break;
      case 'max_mana_pct':        a.mult('maxMana', 1 + value); break;
      case 'magic_proc_chance':   a.add('magicProcChance', value); break;
      case 'slow_effect_pct':     a.add('slowStrengthBonus', value); break;
      case 'chilled_damage_pct':  a.add('chilledDamageBonus', value); break;
      case 'chain_bounce_count':  a.add('chainBounceBonus', value); break;
      case 'meteor_damage_pct':   a.add('meteorDamageBonus', value); break;
      case 'mana_shield_pct':     a.add('manaShieldFraction', value / 100); break;
      case 'ability_echo_chance': a.add('abilityEchoChance', value); break;
      case 'mana_on_kill_pct':    a.add('manaOnKillFraction', value); break;
      case 'buff_duration_pct':   a.add('buffDurationBonus', value); break;

      default: { const exhaustive: never = stat; void exhaustive; }
    }
  }

  // ── Keystone behaviours that resolve as stats ──
  if (ctx.talentBehaviors.includes('battery')
      && ctx.manaFraction >= TALENT_TUNING.batteryManaThreshold) {
    a.mult('baseDamage', 1 + TALENT_TUNING.batteryDamageBonus, 'Battery');
  }
}
```

`shieldRechargeReduction` is applied in `resolveStats`, next to the existing `shield_fast_recharge` floor:

```ts
const rechargeCut = 1 - acc.resolve('shieldRechargeReduction');
out.shieldRechargeTime = Math.max(3, out.shieldRechargeTime * rechargeCut);
```

---

## 10. Behaviours and their consumers

### 10.1 The union (`src/data/talentTree.ts`)

```ts
export type TalentBehavior =
  | 'relentless'
  | 'retaliation'
  | 'juggernaut'
  | 'archivist'
  | 'quartermaster'
  | 'archmage'
  | 'battery';

/**
 * Where each behaviour is actually read. A `Record` over the union rather than
 * a comment, so adding one without deciding where it is consumed does not
 * compile — the same guard `BLESSING_BEHAVIOR_CONSUMERS` provides.
 */
export const TALENT_BEHAVIOR_CONSUMERS: Record<TalentBehavior, string> = {
  relentless:    'Game.simulate (shot cadence) → ProjectileManager.fire({ variants })',
  retaliation:   'Game hostile-shot resolution → EnemyManager.damage (thorns)',
  juggernaut:    'Game.damageTower (wall check) + wall-break handler',
  archivist:     'TalentManager.respecCost → 0',
  quartermaster: 'AutomationManager.runAutoBuy (ability upgrades + gold reserve)',
  archmage:      'Game ability_cast handler → BuffRegistry (fireRate)',
  battery:       'stats/contributors/talents (reads ctx.manaFraction)',
};
```

### 10.2 `TALENT_TUNING`

```ts
export const TALENT_TUNING = {
  /** Focus Fire: consecutive hits on one enemy that still add damage. */
  focusMaxStacks: 5,
  /** Bloodlust: stack ceiling and how long one kill's stack lasts (sim seconds). */
  bloodlustMaxStacks: 8,
  bloodlustSeconds: 4,
  /** Overwatch: fraction of range past which the bonus applies. */
  overwatchRangeFraction: 0.7,   // === OVERWATCH_RANGE_FRACTION
  /** Killing Spree: damage of the free follow-up shot. */
  critFollowUpDamage: 0.6,
  /** Second Wind: HP fraction that arms it, damage multiple of the heal, duration. */
  secondWindThreshold: 0.35,
  secondWindDamageRatio: 2.5,
  secondWindSeconds: 6,
  /** Vengeance: HP fraction below which its damage bonus applies. */
  lowHpThreshold: 0.5,
  /** Windfall: waves between chests. */
  windfallInterval: 10,
  /** Windfall: `windfallMultiplier` at or above this also drops equipment. */
  windfallEquipmentThreshold: 8,
  /** Interest: the payout base is min(gold, this * GOLD_GROWTH^(wave-1)). */
  interestCapBase: 2000,
  /** Relentless: cadence, fan size and per-arrow damage. */
  relentlessShotInterval: 5,
  relentlessShots: 3,
  relentlessDamage: 0.65,
  /** Juggernaut: DR while the wall stands, and the post-break immunity. */
  juggernautDamageReduction: 0.30,
  juggernautImmunitySeconds: 4,
  /** Archmage: the on-cast fire-rate buff. */
  archmageFireRateBonus: 0.20,
  archmageBuffSeconds: 5,
  /** Battery: mana fraction that arms it, and what it pays. */
  batteryManaThreshold: 0.8,
  batteryDamageBonus: 0.30,
  /** Quartermaster: the share of gold auto-buy will not spend past. */
  quartermasterGoldReserve: 0.4,
  /** Prospector: drift-speed multiplier per point of `orbValueBonus`. */
  prospectorDriftPerPoint: 1.67,
} as const;
```

### 10.3 Implementation notes, one mechanic at a time

**Focus Fire** (`ProjectileManager`). Add `private focusStackBonus = 0`, `private focusTargetId = -1`, `private focusStacks = 0`, and `setFocusStackBonus(v: number)`. In the impact path, before damage is computed:

```ts
if (this.focusStackBonus > 0) {
  if (enemy.id === this.focusTargetId) {
    this.focusStacks = Math.min(TALENT_TUNING.focusMaxStacks, this.focusStacks + 1);
  } else {
    this.focusTargetId = enemy.id;
    this.focusStacks = 0;
  }
  final *= 1 + this.focusStackBonus * this.focusStacks;
}
```

`reset()` clears both fields. Stacks are counted per *impact*, not per shot, so a pierce chain does not inflate them past the cap.

**Bloodlust** (`Game`, `enemy_killed` handler). Uses `BuffRegistry`, which already owns timed modifiers:

```ts
if (this.killFrenzyPerStack > 0) {
  this.bloodlustStacks = Math.min(TALENT_TUNING.bloodlustMaxStacks, this.bloodlustStacks + 1);
  this.buffs.set({
    id: 'talent_bloodlust',
    stat: 'baseDamage',
    kind: 'mult',
    value: 1 + this.killFrenzyPerStack * this.bloodlustStacks,
    label: 'Bloodlust',
    remaining: TALENT_TUNING.bloodlustSeconds,
  });
}
```

`BuffRegistry.set` bumps `version` only when the shape changes, so re-asserting the same stack count costs nothing. Decay: when the buff expires (`version` change with the id gone), reset `this.bloodlustStacks = 0` — check it in the same place `Game` already watches `buffs.version`.

**Overwatch.** `ProjectileManager` already has `rangeDamageBonus`, fed by `setEvolutionShotBonuses(rangeDamage, pierceAmp)`. Change `Game.applyResolvedStats` to pass `evolutionRangeDamage + stats.overwatchDamage`. Nothing else moves.

**Siegebreaker / boss damage.** `ProjectileManager.setBossDamageBonus(v)`; in the impact path, `if (this.bossDamageBonus > 0 && enemy.type === 'boss') final *= 1 + this.bossDamageBonus;`.

**Killing Spree.** In `Game.simulate`'s fire block, after a crit shot is dispatched:

```ts
if (isCrit && this.critFollowUpChance > 0 && Math.random() < this.critFollowUpChance) {
  this.projectileMgr.fire(target, towerState, {
    ...baseFireOptions,
    rawDamage: rawDamage * TALENT_TUNING.critFollowUpDamage,
    isCrit: false,
  });
}
```

The follow-up is explicitly **not** a crit, so it cannot recurse.

**Second Wind** (`Game`). Add `private secondWindArmed = true`, reset on `wave_started`. In the tower-damage path, after HP is written:

```ts
const frac = t.maxHp > 0 ? t.hp / t.maxHp : 1;
if (this.secondWindArmed && this.secondWindPower > 0
    && frac < TALENT_TUNING.secondWindThreshold) {
  this.secondWindArmed = false;
  t.hp = Math.min(t.maxHp, t.hp + t.maxHp * this.secondWindPower);
  this.buffs.set({
    id: 'talent_second_wind',
    stat: 'baseDamage',
    kind: 'mult',
    value: 1 + this.secondWindPower * TALENT_TUNING.secondWindDamageRatio,
    label: 'Second Wind',
    remaining: TALENT_TUNING.secondWindSeconds,
  });
  this.effects.emitShockwaveRing(t.x, t.y, 120, withAlpha(FX.nature, 0.6), 3);
  this.bus.emit('toast', { text: 'Second Wind!', tone: 'good' });
}
```

**Bastion.** `EnemyManager.applyKnockback` already exists. Add a `thornsOnKnockback` flag (`setThornsOnKnockback(enabled)`), set when `knockbackForce`'s talent contribution is non-zero, and apply `this.damage(enemy, this.thorns, false)` at the end of `applyKnockback`. Guard against a zero-thorns build so it stays a no-op.

**Prospector.** `LootManager.setValueBonus(v)`: multiply `valueFor()`'s result by `1 + v`, and multiply the orb drift speed by `1 + v * TALENT_TUNING.prospectorDriftPerPoint`. Do **not** touch the auto-collect rate — that is `orb_magnet`'s job and the two must stay separable.

**Tempo.** `PacingManager.setMomentumBonus(gainMult: number, capBonus: number)`. Early-call gold becomes `EARLY_CALL_GOLD_PER_SECOND * (1 + gainMult)` and the cap becomes `MOMENTUM_CAP + capBonus`, where `capBonus = gainMult / 20` (rank 3 → +1.2 gain, cap 0.06 → 0.12). Clamp `capBonus` to ≤ `MOMENTUM_CAP * 2`.

**Windfall** (`Game`, `wave_cleared`):

```ts
if (this.windfallMultiplier > 0 && cleared % TALENT_TUNING.windfallInterval === 0) {
  const chest = Math.floor(waveClearGold * this.windfallMultiplier);
  this.grantGold(chest, 'Windfall');
  if (this.windfallMultiplier >= TALENT_TUNING.windfallEquipmentThreshold) {
    this.equipmentMgr.rollDrop(cleared, /* guaranteed */ true);
  }
  this.effects.emitTreasureBurst(this.tower.snapshot.x, this.tower.snapshot.y);
}
```

`waveClearGold` is the payout the handler already computes for the wave; reuse the local, do not recompute.

**Interest** (`Game`, `wave_started`):

```ts
if (this.interestRate > 0) {
  const cap = TALENT_TUNING.interestCapBase * Math.pow(GOLD_GROWTH, Math.max(0, wave - 1));
  const payout = Math.floor(Math.min(this.state.resources.gold, cap) * this.interestRate);
  if (payout > 0) this.grantGold(payout, 'Interest');
}
```

The cap rides the game's own economy ruler (`GOLD_GROWTH = 1.08`), so this cannot become an unbounded compounding faucet — which is exactly the failure mode `plans/upgrades-revamp.md` §6.2 exists to prevent.

**Relentless.** `Game.simulate` already counts shots for the Mortar blessing and the arcane core's `mana_shot`. Add the same counter shape:

```ts
if (this.talentMgr.hasBehavior('relentless')) {
  this.relentlessCounter += 1;
  if (this.relentlessCounter >= TALENT_TUNING.relentlessShotInterval) {
    this.relentlessCounter = 0;
    fireOptions.variants = [
      { angleOffset: -0.18, damageScale: TALENT_TUNING.relentlessDamage },
      { angleOffset: 0,     damageScale: TALENT_TUNING.relentlessDamage },
      { angleOffset: 0.18,  damageScale: TALENT_TUNING.relentlessDamage },
    ];
  }
}
```

Note this **replaces** the shot's variants for that one shot rather than appending, so it composes predictably with the AP multi-shot perks (which build `variants` earlier in the same block — append to those instead if they are present; `variants.push(...)` when `fireOptions.variants` is already non-empty).

**Retaliation.** Where `Game` resolves a hostile shot hitting the tower (`EnemyManager.hostileShotList` consumption), if the behaviour is held and `thorns > 0`, damage the shot's owner for `thorns`. The owner id is already on `HostileShot`.

**Juggernaut.** Two touch points in `Game`'s tower-damage path:
1. `if (this.talentMgr.hasBehavior('juggernaut') && t.wallHp > 0) amount *= 1 - TALENT_TUNING.juggernautDamageReduction;`
2. when `wallHp` transitions to 0 and `juggernautArmed` (reset on `wave_started`), set `juggernautArmed = false` and start an immunity timer; while it runs, tower damage is zeroed. Reuse the shield-break VFX.

**Archivist.** `TalentManager.respecCost()` returns 0 when `hasBehavior('archivist')`. Document in the panel copy that refunding the branch that holds Archivist is still free (the check runs before the refund).

**Quartermaster.** `AutomationManager.runAutoBuy`: when the behaviour is on, (a) stop purchasing once gold would fall below `quartermasterGoldReserve * goldAtStartOfPass`, and (b) after tower upgrades, offer the cheapest affordable ability upgrade to `deps.upgradeAbility(id)`. `AutomationDeps` gains `hasTalentBehavior(b: TalentBehavior): boolean` and `upgradeAbility(id: AbilityId): boolean`.

**Archmage.** `Game`'s `ability_cast` handler:

```ts
if (this.talentMgr.hasBehavior('archmage')) {
  this.buffs.set({
    id: 'talent_archmage',
    stat: 'fireRate',
    kind: 'mult',
    value: 1 + TALENT_TUNING.archmageFireRateBonus,
    label: 'Archmage',
    remaining: TALENT_TUNING.archmageBuffSeconds,
  });
}
```

**Spell Echo.** `AbilityManager.setEchoChance(v)`. At the end of a successful cast, `if (this.echoChance > 0 && Math.random() < this.echoChance) this.executeEffect(def, level, /* free */ true)` — re-running the *effect* only, never the mana spend or the cooldown start, and never recursively (pass a flag so an echoed cast cannot echo).

**Soul Harvest.** `Game`'s `enemy_killed` handler, next to the existing `siphon` blessing: `this.resourceMgr.addMana(this.state.resources.maxMana * this.manaOnKillFraction);`

**Frostbite / chilled damage.** `ProjectileManager.setChilledDamageBonus(v)`; in the impact path reuse the existing `shatter` check: `if (this.chilledDamageBonus > 0 && this.enemies.isSlowed(enemy)) final *= 1 + this.chilledDamageBonus;`

### 10.4 `TalentManager` API changes

```ts
export class TalentManager {
  /** ≥1 rank in any prerequisite, branch gate met, exclusivity respected. */
  canAllocate(id: TalentId): boolean;
  allocate(id: TalentId): boolean;
  pointsInBranch(branch: TalentBranch): number;
  totalAllocatedPoints(): number;
  /** Every behaviour held, for the stat context. */
  behaviors(): TalentBehavior[];
  hasBehavior(b: TalentBehavior): boolean;
  branchRespecCost(branch: TalentBranch): number;
  fullRespecCost(): number;
  refundBranch(branch: TalentBranch): boolean;
  refundAll(): boolean;
  getAllEffectValues(): Map<TalentStat, number>;
  getAllocationSnapshot(): Record<TalentId, number>;
  /** Why a node is not buyable, for the detail card. null when it is. */
  blockedReason(id: TalentId): 'maxed' | 'no_points' | 'prereq' | 'gate' | 'exclusive' | null;
}
```

`canAllocate`, in order:

```ts
const def = TALENT_BY_ID[id];
if (!def) return false;
if ((this.state.allocated[id] ?? 0) >= def.maxPoints) return false;
if (this.towerXpUnspentPoints() <= 0) return false;
for (const p of def.prerequisites) {
  if ((this.state.allocated[p] ?? 0) < 1) return false;   // ≥1 rank, not maxed
}
if (this.pointsInBranch(def.branch) < def.requiresBranchPoints) return false;
if (def.exclusiveGroup) {
  for (const t of TALENTS_BY_BRANCH[def.branch]) {
    if (t.id !== def.id && t.exclusiveGroup === def.exclusiveGroup
        && (this.state.allocated[t.id] ?? 0) > 0) return false;
  }
}
return true;
```

`behaviors()` caches a `Set<TalentBehavior>` rebuilt on every `allocate`/`refund`, so the stat context does not walk the allocation map every recompute.

**One caveat to guard:** because the branch gate depends on points spent, refunding a *single* node is not supported (it could orphan a keystone). Only whole-branch and whole-tree refunds exist, exactly as today.

### 10.5 Respec pricing

```ts
export const TALENT_RESPEC_BASE = 250;
export const TALENT_RESPEC_EXPONENT = 1.35;

export function talentRespecCost(points: number): number {
  const p = Math.max(0, Math.floor(points));
  if (p <= 0) return 0;
  return Math.floor(TALENT_RESPEC_BASE * Math.pow(p, TALENT_RESPEC_EXPONENT));
}
```

| Points refunded | 5 | 20 | 40 | 80 | 160 |
|---|---:|---:|---:|---:|---:|
| Gold | 2 137 | 13 552 | 34 552 | 88 095 | 224 588 |

Flat 500/point was linear against an economy that grows exponentially; the exponent keeps a full respec meaningful at every depth without ever being unaffordable to a player who can reach the points in question. `Archivist` zeroes it.

---

## 11. The talent panel

### 11.1 What is wrong today and what replaces it

| Today | After |
|---|---|
| Vertical stack of full-width rows, indented by BFS depth | 5 × 6 fixed grid, one tile per node |
| Edges drawn between rows far apart, mostly vertical | Elbow (orthogonal) edges between adjacent grid rows |
| Description + Buy button on every row | Tile shows icon + `n/max`; one shared detail card |
| No gate feedback | Gate chip per row in the left gutter, and a reason string on the card |
| Alternatives look like siblings | Keystone row is visually separated and marked "choose one" |

### 11.2 DOM

```
.talent-panel
├─ h2.panel-title              "Talents"
├─ .talent-header
│   ├─ .talent-level           "Lv. 47"
│   ├─ .talent-xp              mini bar + "38% to Lv. 48"
│   └─ .talent-points          "12 unspent"      (pulses when > 0)
├─ .talent-tabs                4 × .tab-btn, each with a "31/40" sub-label
├─ .talent-stage[data-branch]  × 4 (only .active displayed)
│   ├─ .talent-branch-bar      progress bar + "next gate: 32 pts (keystones)"
│   ├─ .talent-grid
│   │   ├─ svg.talent-link-layer
│   │   ├─ .talent-gate[data-row="2".."5"]      gutter chips
│   │   └─ button.talent-node × 14
│   ├─ .talent-overflow-divider  "Overflow — no limit"
│   └─ .talent-overflow          button.talent-node.is-endless
└─ .talent-detail               sticky card (see 11.5)
└─ .talent-respec-row           branch reset + full reset
```

### 11.3 CSS (`src/styles/main.css`, replacing the current `/* Talent panel */` block)

```css
.talent-grid {
  position: relative;
  display: grid;
  /* Column 1 is the gate gutter; node columns are 2..6. */
  grid-template-columns: 30px repeat(5, minmax(46px, 1fr));
  grid-auto-rows: 74px;
  gap: 14px 8px;
  padding: 6px 4px 10px;
  align-items: center;
  justify-items: center;
}

.talent-link-layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  pointer-events: none;
  z-index: 0;
}

.talent-node {
  grid-row: var(--row);
  grid-column: calc(var(--col) + 1);
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 62px;
  aspect-ratio: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 4px;
  border-radius: var(--radius-md);
  border: 2px solid var(--stroke-subtle);
  background: var(--surface-2);
  color: var(--talent-color);
  cursor: pointer;
  transition: transform var(--dur-fast), border-color var(--dur-fast), box-shadow var(--dur-fast);
}
.talent-node:hover:not(:disabled) { transform: translateY(-2px); }
.talent-node:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.talent-node-icon { width: 26px; height: 26px; }
.talent-node-rank {
  font-size: var(--text-2xs);
  font-variant-numeric: tabular-nums;
  color: var(--text-1);
  line-height: 1;
}
.talent-node-state {          /* corner glyph: ★ ✓ ○ 🔒 */
  position: absolute;
  top: 2px;
  right: 3px;
  font-size: var(--text-2xs);
  line-height: 1;
  pointer-events: none;
}

/* ── five states, never carried by hue alone ── */
.talent-node[data-state="maxed"] {
  border-color: var(--fx-gold);
  background: color-mix(in srgb, var(--fx-gold) 16%, var(--surface-2));
  box-shadow: 0 0 10px color-mix(in srgb, var(--fx-gold) 35%, transparent);
}
.talent-node[data-state="spent"] {
  border-color: color-mix(in srgb, var(--branch-color) 70%, transparent);
  background: color-mix(in srgb, var(--branch-color) 10%, var(--surface-2));
}
.talent-node[data-state="available"] {
  border-color: var(--branch-color);
  animation: talent-node-pulse var(--dur-ambient) ease-in-out infinite;
}
.talent-node[data-state="gated"]  { opacity: 0.5; border-style: dashed; }
.talent-node[data-state="locked"] { opacity: 0.35; }
.talent-node[data-state="gated"] .talent-node-icon,
.talent-node[data-state="locked"] .talent-node-icon { filter: grayscale(1) brightness(0.7); }
.talent-node.is-selected { box-shadow: 0 0 0 2px var(--accent); }

@keyframes talent-node-pulse {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--branch-color) 45%, transparent); }
  50%      { box-shadow: 0 0 0 5px transparent; }
}
@media (prefers-reduced-motion: reduce) {
  .talent-node[data-state="available"] { animation: none; }
  .talent-link.is-open { animation: none; }
}

/* Keystone row reads as a choice, not a continuation. */
.talent-node.is-keystone {
  max-width: 68px;
  border-radius: var(--radius-lg);
  border-width: 3px;
}
.talent-grid .talent-keystone-label {
  grid-row: 5;
  grid-column: 1 / -1;
  align-self: start;
  justify-self: center;
  margin-top: -10px;
  font-size: var(--text-2xs);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-2);
  pointer-events: none;
}

/* Gate chips in the gutter. */
.talent-gate {
  grid-column: 1;
  grid-row: var(--row);
  font-size: var(--text-2xs);
  font-variant-numeric: tabular-nums;
  color: var(--text-2);
  text-align: center;
  line-height: 1.1;
}
.talent-gate.is-met { color: var(--fx-nature); }

/* Links. */
.talent-link {
  fill: none;
  stroke: color-mix(in srgb, var(--ink-300) 45%, transparent);
  stroke-width: 2;
  stroke-dasharray: 3 5;
  stroke-linecap: round;
}
.talent-link.is-spent { stroke: var(--fx-gold); stroke-width: 3; stroke-dasharray: none; }
.talent-link.is-open  {
  stroke: var(--branch-color);
  stroke-width: 3;
  stroke-dasharray: 7 5;
  animation: talent-link-flow var(--dur-ambient) linear infinite;
}
@keyframes talent-link-flow { from { stroke-dashoffset: 24; } to { stroke-dashoffset: 0; } }

/* Overflow strip. */
.talent-overflow-divider {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 6px 4px 2px;
  font-size: var(--text-2xs);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-2);
}
.talent-overflow-divider::before,
.talent-overflow-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--stroke-subtle);
}
.talent-overflow { display: flex; justify-content: center; padding-bottom: 6px; }
.talent-node.is-endless { max-width: 76px; border-radius: 50%; }

/* Detail card. */
.talent-detail {
  position: sticky;
  bottom: 0;
  display: grid;
  grid-template-columns: 40px 1fr;
  gap: 4px 10px;
  padding: 10px;
  background: var(--surface-1);
  border: 1px solid var(--stroke-strong);
  border-radius: var(--radius-lg);
  box-shadow: 0 -6px 16px rgba(0, 0, 0, 0.28);
}
.talent-detail-name  { font-weight: 700; color: var(--text-0); }
.talent-detail-meta  { font-size: var(--text-2xs); color: var(--text-2); }
.talent-detail-desc  { grid-column: 1 / -1; font-size: var(--text-sm); color: var(--text-1); }
.talent-detail-delta {
  grid-column: 1 / -1;
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
  color: var(--fx-nature);
}
.talent-detail-block { grid-column: 1 / -1; font-size: var(--text-xs); color: var(--bad); }
.talent-detail-action { grid-column: 1 / -1; }
```

### 11.4 Link geometry

Same read-all-then-write-all discipline as today, but elbows instead of beziers, and a link's shape depends on whether the two nodes share a column:

```ts
private pathFor(a: DOMRect, b: DOMRect, host: DOMRect): string {
  const x0 = a.left - host.left + a.width / 2;
  const y0 = a.bottom - host.top;
  const x1 = b.left - host.left + b.width / 2;
  const y1 = b.top - host.top;
  if (Math.abs(x1 - x0) < 1) return `M ${x0} ${y0} L ${x1} ${y1}`;
  const midY = y0 + (y1 - y0) / 2;
  const dir = Math.sign(x1 - x0);
  const r = Math.min(8, Math.abs(x1 - x0) / 2, Math.abs(midY - y0), Math.abs(y1 - midY));
  return `M ${x0} ${y0}`
    + ` L ${x0} ${midY - r}`
    + ` Q ${x0} ${midY} ${x0 + dir * r} ${midY}`
    + ` L ${x1 - dir * r} ${midY}`
    + ` Q ${x1} ${midY} ${x1} ${midY + r}`
    + ` L ${x1} ${y1}`;
}
```

Recompute on mount, on `ResizeObserver` of the visible `.talent-grid`, and on tab switch — never per frame. Keep the existing "measure every rect, then write every `d`" split.

Link state:

| Condition | Class |
|---|---|
| parent ≥ 1 rank **and** child ≥ 1 rank | `is-spent` |
| parent ≥ 1 rank **and** child is `available` | `is-open` |
| otherwise | (base, locked) |

### 11.5 Node state and the detail card

```ts
type NodeState = 'maxed' | 'spent' | 'available' | 'gated' | 'locked';

private stateOf(id: TalentId): NodeState {
  const def = TALENT_BY_ID[id];
  const n = this.deps.allocated[id] ?? 0;
  if (n >= def.maxPoints) return 'maxed';
  if (this.deps.canAllocate(id)) return 'available';
  if (n > 0) return 'spent';
  const reason = this.deps.blockedReason(id);
  return reason === 'gate' ? 'gated' : 'locked';
}
```

Glyphs, so state never depends on hue: `maxed` ★, `spent` ✓, `available` ○, `gated` the gate number (e.g. `22`), `locked` 🔒. Each node also carries an `sr-only` span with the same words.

The detail card shows, for the selected (or hovered) node:

1. icon, name, and `Row 4 · Fortune · needs 22 pts in branch`;
2. rank `2 / 4`;
3. the description with `{v}` substituted for the **per-rank** value;
4. a delta line: `Now +24% → Next +36%` per effect (formatted through the same helpers `AbilityPanel` uses — see `src/ui/abilityFormat.ts`);
5. when blocked, one red line from `blockedReason`:
   - `prereq` → `Requires 1 point in Tempo or Autonomy.`
   - `gate` → `Requires 22 points in Fortune (you have 17).`
   - `exclusive` → `You have already chosen Midas Touch.`
   - `no_points` → `No unspent talent points.`
6. a `Learn (1 point)` button, disabled unless `canAllocate`.

### 11.6 Interaction

- **Click a node:** if it is not the selected node, select it (card updates). If it *is* selected and `canAllocate`, allocate one rank. This gives one-click repeat-buy without a mis-tap ever spending a point.
- **Hover** (`@media (pointer: fine)`) previews into the card without changing the selection; leaving restores the selection.
- **Keyboard:** every node is a `<button>` with `tabindex="0"` in row-major DOM order. `ArrowUp/Down/Left/Right` move focus to the nearest node by `(row, col)` Manhattan distance in that direction; `Enter`/`Space` behaves like a click. `Escape` clears the selection.
- **Mobile:** the detail card is sticky at the bottom of the scrollable stage; the grid keeps `overflow: auto; touch-action: pan-x pan-y; overscroll-behavior: contain` as it does today. No bespoke pinch layer — the same reasoning as `docs/xp-talent-system.md` records.

### 11.7 `TalentAPIDeps`

```ts
export interface TalentAPIDeps {
  allocated: Record<string, number>;
  unspentPoints: () => number;
  level: () => number;
  xpProgress: () => number;          // 0..1, for the header's mini bar
  atLevelCap: () => boolean;
  canAllocate: (id: string) => boolean;
  blockedReason: (id: string) => 'maxed' | 'no_points' | 'prereq' | 'gate' | 'exclusive' | null;
  allocate: (id: string) => boolean;
  pointsInBranch: (branch: TalentBranch) => number;
  refundBranch: (branch: TalentBranch) => boolean;
  refundAll: () => boolean;
  branchRespecCost: (branch: TalentBranch) => number;
  fullRespecCost: () => number;
  gold: () => number;
}
```

Wire the four new members in `Game.ts` where `unspentPoints` is already provided (`Game.ts:3135`).

---

## 12. Save migration (v16 → v17)

`SAVE_VERSION = 17`. Add `17` to `validate`'s accepted list and `if (data.version === 16) { migrateV16toV17(data); data.version = 17; }` to the ladder.

```ts
/**
 * v17: the levelling redesign.
 *
 * Three things change at once and all three have to be reconciled here:
 *
 *  - `level` becomes 1-based (a fresh save is level 1, not level 0);
 *  - the XP requirement curve is a different, far steeper function, so the
 *    stored `xp` no longer denotes the same level it did;
 *  - every talent id is new, so nothing can carry over.
 *
 * The level is treated as the thing worth preserving — it is what the player
 * spent months on — so the XP is *restated* onto the new curve rather than
 * re-interpreted. Progress within the level is dropped (it is at most one
 * level's worth), and every point is refunded so the player re-spends into the
 * new tree with a clean slate.
 */
function migrateV16toV17(data: Record<string, unknown>): void {
  const tx = data.towerXp as Record<string, unknown> | undefined;
  const oldLevel = isObject(tx) && typeof tx.level === 'number' ? Math.floor(tx.level) : 0;
  // 0-based -> 1-based, then clamp to the new cap.
  const level = Math.max(1, Math.min(TOWER_LEVEL_CAP, oldLevel + 1));
  const xp = TOWER_XP_TABLE[level];
  const oldTotal = isObject(tx) && typeof tx.totalXpEarned === 'number' ? tx.totalXpEarned : 0;
  data.towerXp = {
    level,
    xp,
    // Lifetime XP is a stat, not a currency. Scale it by the same factor the
    // curve moved so achievements and the Stats panel stay proportionate.
    totalXpEarned: Math.max(xp, Math.floor(oldTotal * (xp / Math.max(1, oldTotal || 1)))),
    unspentTalentPoints: talentPointsAtLevel(level),
  };
  // Every talent id changed; a full refund is the only honest migration.
  data.talents = { allocated: {} };
}
```

Simplify the `totalXpEarned` line to `Math.max(oldTotal, xp)` if the scaling reads as noise — the field is display-only.

Also update:
- `migrateV5toV6`'s seed literal (`{ xp: 0, level: 0, ... }`) → `{ xp: 0, level: 1, unspentTalentPoints: 1, totalXpEarned: 0 }`, so a v5 save walking the whole ladder lands on a valid v17 shape before `migrateV16toV17` restates it.
- `SaveManager.applyOfflineProgress` (`SaveManager.ts:891`): it duplicates the level-up loop. Replace the inline block with a call into the same helper `TowerXpManager` uses, or at minimum add the cap clamp and the 1-based `xpToLevel`. Do **not** leave two copies of the level-up arithmetic.
- `SaveManager.estimateOfflineProgress` uses `averageKillXPForWave`, which calls `xpPerKill` — it picks up the new curve for free, but re-check the constant `OFFLINE_XP_EFFICIENCY` against §17.3's gate.

---

## 13. Companion changes

### 13.1 `Enlightenment` stops granting talent points

`src/data/upgrades.ts`, the `xpGain` (Wisdom) line:

```ts
{ level: 25, name: 'Enlightenment', description: 'XP gain +25%', effectId: 'enlightenment', effectValue: 0.25 },
```

- Delete the `enlightenment` block in `Game.ts:1412-1420`.
- Move `case 'enlightenment':` out of the "consumed as behaviour" group in `stats/contributors/evolutions.ts` and into `a.mult('xpGainMultiplier', 1 + value, 'Enlightenment');`.

**Why:** the points/level invariant (`unspentTalentPoints === talentPointsAtLevel(level)` minus what is allocated) is what makes the whole budget in §3 checkable, and `sim/checks.ts` already asserts it. A second, uncounted source of points makes the level cap meaningless.

### 13.2 The Wisdom upgrade's ceiling

With `xp_gain_pct` now available from talents (Insight 5 × 6% = +30%, Archivist +60%, Avarice endless) and Enlightenment at +25%, re-check `xpGain`'s `effectPerLevel: 0.02, maxLevel: 40` (+80%). Leave it, but note in §17 that the composed XP multiplier at a maxed build is `1.80 × 1.25 × 1.30 × 1.60 ≈ ×4.7` before combo. §5.4's projection assumes ×1.5; the gate in §17.3 measures the real one and adjusts `XP_CURVE_GEO` if the cap lands under 250 hours.

### 13.3 `xpGainMultiplier` now has four sources

`upgrades` (Wisdom), `evolutions` (Enlightenment), `pacing` (combo) and `talents` (Insight / Archivist / Avarice). They all land in the same multiplicative bucket, which is the correct composition; nothing else needs to change.

### 13.4 `enemyXpWeight` is deleted

`PassiveAbilityManager` imports it. Replace the passive XP track with the same shape as the tower track:

```ts
// src/data/xpTables.ts
export function passiveXpPerKill(def: PassiveAbilityDef, wave: number): number {
  return Math.max(1, Math.round(def.xpPerKill * killXpWaveScale(wave) * 0.25));
}
```

The 0.25 keeps the passive track's pace where it is today (it was `xpPerKill * 0.07` against a `log2` weight; against the new linear weight, 0.25 lands within 10% at waves 20–200). Verify with the gate in §17.4. `passiveXpForLevel` is unchanged.

### 13.5 `Game` fields to add

Cached from `applyResolvedStats`, next to the existing `talentDodgeChance` / `talentWallRegen` block:

```ts
private killFrenzyPerStack = 0;
private bloodlustStacks = 0;
private critFollowUpChance = 0;
private secondWindPower = 0;
private secondWindArmed = true;
private juggernautArmed = true;
private juggernautImmunity = 0;
private windfallMultiplier = 0;
private interestRate = 0;
private manaOnKillFraction = 0;
private relentlessCounter = 0;
```

and in `applyResolvedStats`:

```ts
this.killFrenzyPerStack = stats.killFrenzyPerStack;
this.critFollowUpChance = stats.critFollowUpChance;
this.secondWindPower = stats.secondWindPower;
this.windfallMultiplier = stats.windfallMultiplier;
this.interestRate = stats.interestRate;
this.manaOnKillFraction = stats.manaOnKillFraction;
this.projectileMgr.setFocusStackBonus(stats.focusStackBonus);
this.projectileMgr.setBossDamageBonus(stats.bossDamageBonus);
this.projectileMgr.setChilledDamageBonus(stats.chilledDamageBonus);
this.projectileMgr.setEvolutionShotBonuses(
  evolutionRangeDamage + stats.overwatchDamage, pierceAmp,
);
this.abilityMgr.setEchoChance(stats.abilityEchoChance);
this.lootMgr.setValueBonus(stats.orbValueBonus);
this.pacingMgr.setMomentumBonus(stats.momentumGainBonus, Math.min(MOMENTUM_CAP * 2, stats.momentumGainBonus / 20));
this.enemyMgr.setThornsOnKnockback(stats.knockbackForce > TOWER_BASE.knockbackForce);
```

`secondWindArmed` and `juggernautArmed` reset in the `wave_started` handler.

---

## 14. Tests

### 14.1 `tests/formulas.test.ts`

Replace the `talentPointsAtLevel` block:

```ts
it('grants exactly one talent point per level, capped', () => {
  expect([1, 2, 10, 100, 200, 250].map(talentPointsAtLevel)).toEqual([1, 2, 10, 100, 200, 200]);
  expect(talentPointsAtLevel(0)).toBe(0);
});

it('builds a strictly ascending XP table up to the cap', () => {
  expect(TOWER_XP_TABLE.length).toBe(TOWER_LEVEL_CAP + 1);
  expect(TOWER_XP_TABLE[1]).toBe(0);
  for (let l = 2; l <= TOWER_LEVEL_CAP; l++) {
    expect(TOWER_XP_TABLE[l]).toBeGreaterThan(TOWER_XP_TABLE[l - 1]);
  }
});

it('round-trips xpToLevel against the table', () => {
  for (const l of [1, 2, 5, 40, 100, 199, 200]) {
    expect(xpToLevel(TOWER_XP_TABLE[l])).toBe(l);
    if (l > 1) expect(xpToLevel(TOWER_XP_TABLE[l] - 1)).toBe(l - 1);
  }
  expect(xpToLevel(TOWER_XP_TABLE[TOWER_LEVEL_CAP] * 10)).toBe(TOWER_LEVEL_CAP);
});

it('pays more XP for deeper kills and deeper clears', () => {
  expect(xpPerKill('normal', 200)).toBeGreaterThan(xpPerKill('normal', 20) * 5);
  expect(xpPerWaveClear(100)).toBeGreaterThan(xpPerWaveClear(50) * 2);
});

it('pays a pioneer bonus only past the lifetime best', () => {
  expect(pioneerBonusXp(40, 40)).toBe(0);
  expect(pioneerBonusXp(41, 40)).toBe(Math.round(xpPerWaveClear(41) * PIONEER_CLEAR_MULTIPLIER));
});
```

### 14.2 `tests/content-coverage.test.ts` — the talents block

Keep the four existing assertions (closed stat union, no unused stat, non-zero per-point, unique ids, prerequisites exist) with `effectsOf(t)` rewritten to `t.effects`. Drop the `costPerPoint` assertion (the field is gone). Add:

```ts
it('names a consumer for every talent behaviour', () => {
  for (const b of Object.keys(TALENT_BEHAVIOR_CONSUMERS) as TalentBehavior[]) {
    expect(TALENT_BEHAVIOR_CONSUMERS[b].length).toBeGreaterThan(8);
    expect(TALENT_BEHAVIOR_CONSUMERS[b].toLowerCase()).not.toMatch(/todo|nothing|unused|n\/a|tbd/);
  }
});

it('only declares behaviours that have a consumer', () => {
  const known = new Set(Object.keys(TALENT_BEHAVIOR_CONSUMERS));
  const orphans = TALENTS.filter(t => t.behavior && !known.has(t.behavior));
  expect(orphans.map(t => t.id)).toEqual([]);
});

it('gives every branch the same 5x6 lattice', () => {
  for (const branch of ['offense', 'defense', 'utility', 'magic'] as TalentBranch[]) {
    const nodes = TALENTS_BY_BRANCH[branch];
    expect(nodes.length).toBe(15);
    const seen = new Set(nodes.map(n => `${n.row}:${n.col}`));
    expect(seen.size).toBe(15);
    for (const n of nodes) {
      expect(n.row).toBeGreaterThanOrEqual(1);
      expect(n.row).toBeLessThanOrEqual(6);
      expect(n.col).toBeGreaterThanOrEqual(1);
      expect(n.col).toBeLessThanOrEqual(5);
    }
  }
});

it('only names prerequisites in the row above, in the same branch', () => {
  for (const t of TALENTS) {
    for (const p of t.prerequisites) {
      const parent = TALENT_BY_ID[p];
      expect(parent.branch).toBe(t.branch);
      expect(parent.row).toBe(t.row - 1);
    }
  }
});

it('keeps row gates monotonic', () => {
  const byRow = new Map<number, number>();
  for (const t of TALENTS) {
    if (t.endless) continue;
    const prev = byRow.get(t.row);
    if (prev === undefined) byRow.set(t.row, t.requiresBranchPoints);
    else expect(t.requiresBranchPoints).toBe(prev);
  }
  const rows = [...byRow.keys()].sort((a, b) => a - b);
  for (let i = 1; i < rows.length; i++) {
    expect(byRow.get(rows[i])!).toBeGreaterThan(byRow.get(rows[i - 1])!);
  }
});

it('keeps the designed tree at or above 75% of the level cap', () => {
  let reachable = 0;
  for (const branch of ['offense', 'defense', 'utility', 'magic'] as TalentBranch[]) {
    const nodes = TALENTS_BY_BRANCH[branch].filter(n => !n.endless);
    const keystones = nodes.filter(n => n.exclusiveGroup);
    expect(keystones.length).toBe(3);
    reachable += nodes.filter(n => !n.exclusiveGroup).reduce((s, n) => s + n.maxPoints, 0) + 1;
  }
  expect(reachable).toBe(160);
  expect(reachable / TOWER_LEVEL_CAP).toBeGreaterThanOrEqual(0.75);
});

it('gives every branch exactly one endless node', () => {
  for (const branch of ['offense', 'defense', 'utility', 'magic'] as TalentBranch[]) {
    const endless = TALENTS_BY_BRANCH[branch].filter(n => n.endless);
    expect(endless.length).toBe(1);
    expect(endless[0].maxPoints).toBe(999);
  }
});

it('reaches every row-5 keystone from a root', () => {
  // BFS from the row-1 roots along prerequisites; every node must be visited.
  for (const branch of ['offense', 'defense', 'utility', 'magic'] as TalentBranch[]) {
    const nodes = TALENTS_BY_BRANCH[branch].filter(n => !n.endless);
    const reached = new Set(nodes.filter(n => n.prerequisites.length === 0).map(n => n.id));
    let grew = true;
    while (grew) {
      grew = false;
      for (const n of nodes) {
        if (reached.has(n.id)) continue;
        if (n.prerequisites.some(p => reached.has(p))) { reached.add(n.id); grew = true; }
      }
    }
    expect(reached.size).toBe(nodes.length);
  }
});
```

Also update the icon-coverage list at `tests/content-coverage.test.ts:540` — it already maps `TALENTS`, so it needs no edit beyond the new ids resolving.

### 14.3 New `tests/talents.test.ts`

Drive `TalentManager` with a stub for the four deps.

- allocating with 0 unspent points fails and changes nothing;
- a row-2 node is refused until 4 points sit in the branch, and accepted at 4 (`blockedReason` returns `'gate'` then `null`);
- a prerequisite at 1 rank is enough (regression against the old "maxed parent" rule);
- taking one keystone blocks the other two (`blockedReason` → `'exclusive'`), and `refundBranch` releases them;
- `behaviors()` reflects allocation and refund;
- `getAllEffectValues()` sums multi-effect nodes and no longer applies any global multiplier (Mastery is gone);
- `talentRespecCost` matches the §10.5 table; `hasBehavior('archivist')` makes it 0;
- an unaffordable respec is refused and changes nothing (port the existing `sim/checks.ts` §4.7 cases).

### 14.4 `tests/stats.test.ts`

- `talents: { xp_gain_pct: 0.3 }` multiplies `xpGainMultiplier`;
- `talents: { low_hp_damage_pct: 0.4 }` with `hpFraction: 0.9` changes nothing, and with `hpFraction: 0.3` multiplies `baseDamage` by 1.4;
- `talentBehaviors: ['battery']` with `manaFraction: 0.9` multiplies `baseDamage` by 1.3, and with `manaFraction: 0.5` does not;
- `shield_recharge_pct` shortens `shieldRechargeTime` but never below 3 s;
- `mana_shield_pct: 18` resolves `manaShieldFraction` to 0.18.

### 14.5 `tests/save.test.ts`

- a v16 fixture at `towerXp: { level: 3, xp: 900, ... }` and `talents: { allocated: { power_core: 2 } }` migrates to `level: 4`, `xp: TOWER_XP_TABLE[4]`, `unspentTalentPoints: 4`, `talents.allocated` empty;
- a v16 fixture at `level: 500` clamps to `TOWER_LEVEL_CAP`;
- round-trip save → load at v17 is stable.

### 14.6 `sim/checks.ts`

- §2.4 section: replace the "bonus point every 5th level" checks with "one point per level, capped at 200", and add "the XP table is ascending and `xpToLevel` round-trips".
- §4.7 section: keep, but drive it through the new `TalentDef` shape (`TALENTS_BY_BRANCH[branch][0]` is now `wr_edge`/`bw_toughness`/etc., all with `requiresBranchPoints: 0`, so the existing two-allocate flow still works).
- Add a §2.4b section: "the designed tree is at least 75% of the level cap" and "every branch has exactly one endless node".

---

## 15. Docs

| File | Change |
|---|---|
| `docs/xp-talent-system.md` | Rewrite. New curve constants and the §5.3 table, 1-based levels, the level cap, the point budget from §3, the lattice from §6, the gate rules, behaviours + `TALENT_BEHAVIOR_CONSUMERS`, the panel's grid/elbow/detail-card design from §11, and the new respec pricing. |
| `docs/data-formulas.md` | Replace the XP section with §4.1–4.2 and §5.1–5.2, including the §4.3 and §5.3 tables. |
| `docs/stat-pipeline.md` | Add the 15 new `StatKey`s from §9.2, the two new `StatContext` fields, and the note that `lowHpDamageBonus` / `battery` are context-conditional and never leave the accumulator. |
| `docs/ui-system.md` | Replace the talent-panel paragraph with §11: grid, gutter gate chips, elbow links, five node states, the detail card, and the click-to-select-then-click-to-buy rule. |
| `docs/save-system.md` | Add the v17 row and the reasoning from §12. |
| `docs/upgrade-system.md` | Note that `Enlightenment` is now an XP multiplier, not a talent-point faucet. |
| `docs/loot-system.md`, `docs/passive-system.md`, `docs/ability-system.md`, `docs/automation-system.md` | One line each for `setValueBonus`, `passiveXpPerKill`, `setEchoChance`, and the Quartermaster hooks. |

---

## 16. Task order

Each step should leave `npx tsc --noEmit` and `npm test` green.

1. **XP core.** Rewrite `src/data/xpTables.ts` (§4, §5.1–5.2). Update `TowerXpManager` (§5.5). Update `tests/formulas.test.ts` (§14.1) and the `sim/checks.ts` §2.4 section. *Talents are untouched; the tree still compiles against the old data.*
2. **1-based levels.** Fresh-state literals in `Game.ts` (312, 4227) and `SaveManager.migrateV5toV6`; HUD (§5.7); the `wave_cleared` pioneer argument (§5.6).
3. **Save v17.** §12, plus `tests/save.test.ts` (§14.5). *After this the game is playable end-to-end on the new curve with the old tree, which is a good place to stop and sanity-check.*
4. **Stat plumbing.** New `StatKey`s and clamps (§9.2), the two `StatContext` fields, `resolveStats`' `shieldRechargeReduction` line, and the manager setters listed in §13.5 (as no-op stubs at first). `tests/stats.test.ts` (§14.4).
5. **Talent data.** Rewrite `src/data/talentTree.ts`: `TalentDef`, `TalentStat`, `TalentBehavior`, `TALENT_BEHAVIOR_CONSUMERS`, `TALENT_TUNING`, the 60 nodes (§8), `talentRespecCost` (§10.5), and the derived exports. Rewrite `contributeTalents` (§9.3). Update `tests/content-coverage.test.ts` (§14.2). *`tsc` will now point at every remaining call site.*
6. **`TalentManager`.** §10.4 plus `tests/talents.test.ts` (§14.3) and `sim/checks.ts` §4.7.
7. **Behaviours and mechanics.** §10.3, one at a time, cheapest first: Overwatch merge → boss damage → chilled damage → Focus Fire → Killing Spree → Bloodlust → Second Wind → Bastion → Prospector → Tempo → Windfall → Interest → Soul Harvest → Spell Echo → the six keystone behaviours.
8. **Companion changes.** §13.1 (Enlightenment), §13.4 (`passiveXpPerKill`).
9. **Panel.** Rewrite `TalentPanel.ts` and the CSS block (§11). Extend `TalentAPIDeps` and its wiring in `Game.ts` / `UIManager.ts`.
10. **Docs.** §15.
11. **Verification.** §17.

---

## 17. Verification gates

Nothing ships until all six pass. Write the throwaway scripts into `sim/` (or a scratch file) so the numbers are reproducible.

### 17.1 The curve tables reproduce

A script that prints §4.3, §4.4 and §5.3 straight out of `src/data/xpTables.ts` must match the tables in this document to within rounding. If it does not, the constants were mistyped.

### 17.2 First-run pacing

Walking waves 1→39 with `expectedWaveSeconds` as the clock and no XP multipliers yields **13 000–15 000 XP → level 14–16**. Below 12 must raise `XP_CURVE_BASE`; above 18 must lower it.

### 17.3 Cap pacing

With the *real* composed `xpGainMultiplier` (Wisdom 40 + Enlightenment + a maxed Fortune branch + average combo — §13.2 estimates ×4.7 at a maxed build, versus the ×1.5 §5.4 assumed) and the depth model `W(t) = 40 * (1 + t/2)^0.8`, level 200 must land between **250 and 500 play-hours**. Tune `XP_CURVE_GEO` first (1.026 → ~300 h, 1.028 → ~367 h, 1.030 → ~440 h at ×1.5); only touch `XP_CURVE_POLY` if the *early* levels also drift.

### 17.4 The passive track does not move

`passiveXpPerKill` at waves 20 / 50 / 100 / 200 must be within **±15%** of what the shipping `xpPerKill(type, wave) * 0.07 * def.xpPerKill` pays today. Adjust the 0.25 coefficient in §13.4, not the tower curve.

### 17.5 No talent is inert

`npm test` covers the declaration side. Add a manual pass for the behaviour side: for each of the 15 mechanic nodes and 12 keystones, allocate it in isolation in a dev build and confirm the effect is observable — a number moves in the Stats panel, or the on-screen behaviour changes. This is the check that the "twenty inert talents" history exists to force.

### 17.6 Balance does not regress

`npm run sim` before and after. The 0-AP wall wave must not move by more than **one boss decade** in either direction across the seed set. Talents are permanent progression, so the sim's talent-free baseline should be unchanged; if it moves, something leaked into a default.

Additionally, spot-check the three Wrath keystones against each other at a fixed build. Sustained output should land within **±15%** of one another:

- Annihilation: `1.70 × 0.75 = 1.275` sustained, plus splash;
- Deadeye: at a 35% crit build, `0.80 × (0.65 + 0.35 × 3.5) / (0.65 + 0.35 × 2.0) ≈ 1.28`;
- Relentless: `1 + (3 × 0.65 − 1) / 5 = 1.19`, plus the fan's incidental coverage.

If Relentless measures low, raise `relentlessDamage` to 0.75 rather than adding a fourth arrow — the fan's spread is already its coverage advantage.

---

## 18. Follow-up levers, in order

Do **not** do these in this pass; they are what to reach for if §17 does not converge.

1. `XP_CURVE_GEO` — the single knob that moves the whole late curve. ±0.002 is worth roughly ∓20% of the time-to-cap.
2. `KILL_XP_WAVE_SLOPE` vs `WAVE_CLEAR_XP_BASE` — shifts the kills/clears split without changing the total.
3. Row gates (4 / 12 / 22 / 32) — raise the keystone gate to 34 if all four keystones land too early.
4. Endless per-rank values — halve them if the last 40 levels measure stronger than the designed tree's last row.
5. Raising `TOWER_LEVEL_CAP` — safe by construction: the endless nodes absorb every point past 160, so the cap is one constant plus the `TOWER_XP_TABLE` bound.

---

## 19. Post-implementation fixes — the talent panel

Five defects found once §11 shipped. All five live in `src/ui/TalentPanel.ts` (816 lines) and the `/* Talent panel */` block of `src/styles/main.css`; nothing in the data tables, the manager or the stat pipeline moves.

Do them in the order below: 19.3 and 19.4 overlap heavily (both are "stop rebuilding things every frame"), and 19.3's rewrite of the detail card is a prerequisite for 19.5 behaving sanely.

### 19.1 Branch reset buttons should follow the active tab

**Symptom.** All four of "Reset Wrath", "Reset Bulwark", "Reset Fortune", "Reset Arcana" are on screen at once, plus "Reset all talents" — five buttons, four of which act on a branch the player is not looking at.

**Cause.** `renderInto` appends all four `.btn-respec` into one `.talent-respec-row`, and nothing ever hides them.

**Fix.** The row shows exactly two buttons: the active branch's reset, and the global reset.

In `showTab`, after the existing tab/stage toggles:

```ts
for (const [branch, btn] of this.respecBtns) {
  toggleClass(btn, 'is-hidden', branch !== id);
}
```

In `update`, skip the branches that are not visible — they cost a `branchRespecCost()` call, a `formatNumber()` and three string builds each:

```ts
for (const branch of BRANCH_DISPLAY) {
  const btn = this.respecBtns.get(branch.id);
  if (!btn || branch.id !== this.activeTab) continue;
  ...
}
```

CSS, next to `.btn-respec:disabled`:

```css
.btn-respec.is-hidden { display: none; }
```

`.talent-respec-all` already has `width: 100%`, so with one branch button beside it the row reads as "reset this branch" on the first line and "reset everything" on the second. No layout change needed.

### 19.2 Tab counts must exclude the overflow node

**Symptom.** The sub-label under each tab reads `0/1041`.

**Cause.** `update()` sums `TALENTS_BY_BRANCH[branch.id]`, which is all 15 nodes including the endless one:

```
39 (rows 1-4)  +  3 (three declared keystones)  +  999 (endless)  =  1041
```

Two things are wrong with that number, not one. The 999 is the overflow sink and has no ceiling to be a denominator of; and the 3 counts all three keystones when only **one** is ever takeable.

**Fix.** The denominator is the branch's *reachable* designed capacity — 39 regular points plus one keystone = **40** — and the endless node is reported separately.

Compute the denominators once at module load, not per frame:

```ts
/**
 * Reachable points per branch: every non-keystone rank in rows 1-4, plus the
 * single keystone the player may take. The endless node is deliberately absent
 * — it has no ceiling, so it cannot be the denominator of a progress readout.
 */
const BRANCH_CAPACITY: Record<TalentBranch, number> = (() => {
  const out = {} as Record<TalentBranch, number>;
  for (const branch of BRANCH_DISPLAY) {
    const nodes = TALENT_GRID[branch.id];
    out[branch.id] = nodes
      .filter(n => !n.exclusiveGroup)
      .reduce((s, n) => s + n.maxPoints, 0) + 1;
  }
  return out;
})();
```

and in the tab-label pass:

```ts
for (const branch of BRANCH_DISPLAY) {
  const sub = this.tabSubLabels.get(branch.id);
  if (!sub) continue;
  let invested = 0;
  for (const t of TALENT_GRID[branch.id]) invested += this.deps.allocated[t.id] ?? 0;
  const overflow = this.deps.allocated[TALENT_ENDLESS[branch.id].id] ?? 0;
  setText(sub, invested + '/' + BRANCH_CAPACITY[branch.id] + (overflow > 0 ? ' +' + overflow : ''));
}
```

Reads `0/40` on a fresh save, `40/40` on a filled branch, and `40/40 +17` once overflow is being fed. Assert `BRANCH_CAPACITY` sums to 160 in `tests/content-coverage.test.ts` — §14.2 already asserts the same number from the data side, so a drift between the two is a test failure rather than a wrong label.

### 19.3 The Learn button flickers on hover

**Symptom.** Hovering the "Learn (1 point)" button makes it flicker continuously, and a click can miss.

**Cause.** `renderDetailContent()` starts with `this.detailCard.innerHTML = ''` and rebuilds every child — including the Learn button — from scratch. `update()` calls `updateDetailCard()` unconditionally on **every tick**, so the button under the cursor is destroyed and recreated once per frame. The browser drops `:hover` on the destroyed node and re-applies it to the new one, which is the flicker; a `mousedown`/`mouseup` pair that straddles a rebuild lands on two different elements and never becomes a click.

**Fix.** Build the card's skeleton **once**, in `renderInto`, and never touch `innerHTML` in the update path again. This is the same rule the rest of the app follows — `AbilityPanel` and `ResearchPanel` hold per-row element refs and mutate them through the cached setters in `src/utils/dom.ts`.

Skeleton, built once and stored as fields:

```
.talent-detail
├─ .talent-detail-header
│   ├─ .talent-detail-icon      ← re-rendered only when the shown id changes
│   ├─ .talent-detail-info
│   │   ├─ strong.talent-detail-name
│   │   └─ span.talent-detail-meta
│   └─ span.talent-detail-rank
├─ p.talent-detail-desc
├─ .talent-detail-delta         ← DETAIL_DELTA_SLOTS pooled spans
├─ p.talent-detail-reason
└─ button.btn-learn             ← created once, listener reads this.detailCardId
```

New fields:

```ts
/** Longest `effects` array in the tree; the delta row pools this many spans. */
const DETAIL_DELTA_SLOTS = 4;

private detailIconEl!: HTMLElement;
private detailNameEl!: HTMLElement;
private detailMetaEl!: HTMLElement;
private detailRankEl!: HTMLElement;
private detailDescEl!: HTMLElement;
private detailDeltaWrap!: HTMLElement;
private detailDeltaSlots: HTMLElement[] = [];
private detailReasonEl!: HTMLElement;
private detailLearnBtn!: HTMLButtonElement;
/** Which talent the card currently shows. Drives the icon swap and Learn. */
private detailCardId: TalentId | null = null;
```

The Learn button's listener is bound once and must **not** close over an id — the card shows different talents over its lifetime:

```ts
this.detailLearnBtn.addEventListener('click', () => {
  const id = this.detailCardId;
  if (!id || !this.deps.canAllocate(id)) return;
  this.deps.allocate(id);
  this.selectedNode = id;
  this.markAllBranchesDirty();
});
```

`renderDetailContent` becomes a pure mutation pass:

```ts
private renderDetailContent(id: TalentId, isPreview: boolean): void {
  const def = TALENT_BY_ID[id];
  if (!def) return;

  toggleClass(this.detailCard, 'is-empty', false);
  toggleClass(this.detailCard, 'is-preview', isPreview);

  // The icon is the only child that needs real DOM work, so it is the only one
  // guarded on the id rather than on its own value.
  if (this.detailCardId !== id) {
    this.detailCardId = id;
    setStyle(this.detailIconEl, '--talent-color', def.color);
    renderIcon(this.detailIconEl, def.icon);
  }

  const current = this.deps.allocated[id] ?? 0;
  const branchLabel = BRANCH_LABEL[def.branch];

  setText(this.detailNameEl, def.name);
  setText(this.detailMetaEl,
    'Row ' + def.row + ' · ' + branchLabel
    + (def.requiresBranchPoints > 0 ? ' · needs ' + def.requiresBranchPoints + ' pts in branch' : ''));
  setText(this.detailRankEl, current + ' / ' + def.maxPoints);
  setText(this.detailDescEl, def.description);

  const showDelta = def.effects.length > 0 && current < def.maxPoints;
  setDisplay(this.detailDeltaWrap, showDelta ? '' : 'none');
  for (let i = 0; i < DETAIL_DELTA_SLOTS; i++) {
    const slot = this.detailDeltaSlots[i];
    const eff = showDelta ? def.effects[i] : undefined;
    if (!eff) { setDisplay(slot, 'none'); continue; }
    setDisplay(slot, '');
    setText(slot,
      'Now ' + formatEffectValue(eff.stat, eff.perPoint * current)
      + ' → Next ' + formatEffectValue(eff.stat, eff.perPoint * (current + 1)));
  }

  const reason = this.deps.blockedReason(id);
  const showReason = reason !== null && reason !== 'maxed';
  setDisplay(this.detailReasonEl, showReason ? '' : 'none');
  if (showReason) setText(this.detailReasonEl, this.formatBlockedReason(reason!, def));

  const state = this.stateFor(id);
  setDisplay(this.detailLearnBtn, state === 'maxed' ? 'none' : '');
  setDisabled(this.detailLearnBtn, !this.deps.canAllocate(id));
}
```

and the empty branch of `updateDetailCard` stops clearing `innerHTML`:

```ts
} else {
  this.detailCardId = null;
  toggleClass(this.detailCard, 'is-empty', true);
  toggleClass(this.detailCard, 'is-preview', false);
}
```

`.talent-detail.is-empty` already hides its children through `justify-content: center` plus the `::after` placeholder; add one rule so the stale skeleton does not show through:

```css
.talent-detail.is-empty > * { display: none; }
```

`BRANCH_LABEL` replaces the `BRANCH_DISPLAY.find(...)` linear scan that ran on every card render:

```ts
const BRANCH_LABEL: Record<TalentBranch, string> =
  Object.fromEntries(BRANCH_DISPLAY.map(b => [b.id, b.label])) as Record<TalentBranch, string>;
```

**Verify:** hover the Learn button for ten seconds — no flicker, and DevTools' "Elements" pane shows no node replacement. Click it repeatedly; every click allocates.

### 19.4 Caching pass on the update loop

`update()` runs once per frame while the tab is open and currently does far more work than any other panel. Every item below is a real per-frame cost in the shipped code.

| # | Current cost per frame | Fix |
|---|---|---|
| a | 60 × `btn.querySelector('.talent-node-rank')` | cache the ref at render time |
| b | 60 × raw `btn.dataset.state = state` (nothing reads it — CSS keys on `.is-*`) | delete the write |
| c | 60 × `stateOf()`, then 60+ more inside the links loop, each walking `pointsInBranch` (O(15)) and the prereq list | compute once into a `Map`, share it |
| d | all four branches' nodes, links and progress bars updated, three of them invisible | only the active branch; mark the rest dirty |
| e | `this.xpBarFill.style.width`, `fill.style.width`, `glyph.title` written raw | route through `setStyle` / `setTitle` |
| f | 5 × respec label built with `formatNumber` and 3 string concatenations | gate on a `cost \| affordable` signature (19.1 already cuts this to 2) |
| g | full detail-card rebuild | fixed by 19.3 |

**(a) Rank refs.** Add `private nodeRanks = new Map<TalentId, HTMLElement>();`, populate it in `renderNode` next to `nodeGlyphs`/`nodeSrLabels`, clear it in `mount`.

**(b) `data-state`.** Delete `btn.dataset.state = state` from `update()` and `btn.dataset.state = 'locked'` from `renderNode`. The five `toggleClass` calls stay — `toggleClass` is cached and writes nothing when the class is already correct.

**(c) Shared state map.** One computation per pass, consumed by the node loop, the link loop and the detail card:

```ts
/** Node state per talent, recomputed once per refresh and shared. */
private stateCache = new Map<TalentId, NodeState>();

private stateFor(id: TalentId): NodeState {
  const cached = this.stateCache.get(id);
  if (cached !== undefined) return cached;
  const state = this.stateOf(id);
  this.stateCache.set(id, state);
  return state;
}
```

`this.stateCache.clear()` at the top of every refresh; `stateOf` keeps its current body and becomes private-to-`stateFor`. Replace every other `this.stateOf(...)` call site with `this.stateFor(...)`.

**(d) Active branch only, with a change signature.** Everything the node/link/gate/bar pass depends on is a function of the allocation map and the unspent pool — nothing else. So:

```ts
private dirtyBranches = new Set<TalentBranch>();
private lastStructureSignature = '';

private markAllBranchesDirty(): void {
  for (const b of BRANCH_DISPLAY) this.dirtyBranches.add(b.id);
}

private structureSignature(): string {
  let allocated = 0;
  for (const v of Object.values(this.deps.allocated)) allocated += v;
  return this.deps.unspentPoints() + '|' + allocated;
}
```

In `update()`, replacing the node loop, the links loop and the branch-bar loop:

```ts
const sig = this.structureSignature();
if (sig !== this.lastStructureSignature) {
  this.lastStructureSignature = sig;
  this.stateCache.clear();
  this.markAllBranchesDirty();
}
if (this.dirtyBranches.has(this.activeTab)) {
  this.dirtyBranches.delete(this.activeTab);
  this.refreshBranch(this.activeTab);
}
```

`refreshBranch(branch)` holds the three loops, scoped to one branch: `TALENT_GRID[branch]` plus `TALENT_ENDLESS[branch]` for the nodes, `this.branchLinks.get(branch)!.edges` for the links, and that branch's progress bar. `showTab` calls it for the branch it is about to reveal, before `layoutLinks`:

```ts
private showTab(id: TalentBranch): void {
  this.activeTab = id;
  if (!this.root) return;
  ...existing tab / stage / respec-visibility toggles...
  if (this.dirtyBranches.has(id)) {
    this.dirtyBranches.delete(id);
    this.refreshBranch(id);
  }
  if (this.resizeObserver) { ... }
  this.layoutLinks(id);
}
```

`mount()` calls `markAllBranchesDirty()` and resets `lastStructureSignature = ''` so the first `update()` always paints.

Selection is **not** part of the signature — `onNodeClick` and `handleKeydown` already toggle `is-selected` directly on the two buttons involved, which is correct and must stay. Neither is hover: `updateDetailCard()` is called from the hover handlers and, after 19.3, is cheap enough to also run unconditionally at the end of `update()`.

The tab sub-labels (19.2) and the header stay outside the signature: they are four cached `setText` calls and are what tell a player on the Wrath tab that Arcana has points waiting.

**(e) Raw style/attribute writes.** Import `setDisabled`, `setTitle`, `setDisplay` alongside the existing helpers, then:

- `this.xpBarFill.style.width = ...` → `setStyle(this.xpBarFill, 'width', pct + '%')`
- `fill.style.width = ...` → `setStyle(fill, 'width', pct + '%')`
- `glyph.title = STATE_LABEL[state]` → `setTitle(glyph, STATE_LABEL[state])`
- `btn.disabled = ...` → `setDisabled(btn, ...)` (both respec buttons and the Learn button)
- `btn.title = ...` → `setTitle(btn, ...)`

`btn.style.setProperty('--row'/'--col')` and `gate.style.setProperty('--row')` in `renderNode` / `renderStage` are **render-time only** and stay as they are.

`path.setAttribute('class', cls)` in the links loop is already guarded by a read-back comparison; leave it — `setAttribute` from `utils/dom` is typed for `HTMLElement` and an `SVGPathElement` is not one.

**(f) Respec label signature.** Drop the live gold figure out of the tooltip so the string depends only on cost and affordability:

```ts
private respecSignature = '';
...
const cost = this.deps.branchRespecCost(this.activeTab);
const allCost = this.deps.fullRespecCost();
const gold = this.deps.gold();
const sig = cost + '|' + (gold >= cost ? 1 : 0) + '|' + allCost + '|' + (gold >= allCost ? 1 : 0);
if (sig !== this.respecSignature) {
  this.respecSignature = sig;
  ...build both labels and titles...
}
```

Titles become `'Costs ' + formatNumber(cost) + ' gold — not enough.'` rather than embedding the live balance.

**Expected result.** A steady-state frame with nothing changing does: 4 cached `setText` for the header, 4 for the tab labels, one signature string build, one `updateDetailCard` mutation pass. Zero `querySelector`, zero `innerHTML`, zero `canAllocate` calls, zero layout reads.

### 19.5 Hover must win over selection in the detail card

**Symptom.** Hovering a talent shows it in the description box only until the first click; after that the card is pinned to the selected node and hovering does nothing.

**Cause.** `updateDetailCard()` checks `selectedNode` first:

```ts
if (this.selectedNode) { this.renderDetailContent(this.selectedNode, false); }
else if (this.hoveredNode) { this.renderDetailContent(this.hoveredNode, true); }
```

**Fix.** Invert the priority. Hover is a transient enquiry and should always answer; the selection is what the card falls back to when the pointer is elsewhere.

```ts
private updateDetailCard(): void {
  const id = this.hoveredNode ?? this.selectedNode;
  if (id) this.renderDetailContent(id, id !== this.selectedNode);
  else { /* empty state, per 19.3 */ }
}
```

`isPreview` is now "this is not the pinned node", so the dashed border and the `Preview` badge appear when hovering *any other* node and disappear when hovering the selected one. That is the right signal: the badge means "you are looking at something you have not chosen".

Two details that fall out of this and must be handled:

1. **Touch.** `mouseenter`/`mouseleave` do not fire reliably on touch, and a tap fires a synthetic `mouseenter` that never gets its matching `mouseleave` — leaving the card stuck in preview on the node last tapped. Bind the hover handlers only where hover exists:

   ```ts
   const canHover = typeof window.matchMedia === 'function'
     && window.matchMedia('(hover: hover)').matches;
   if (canHover) {
     btn.addEventListener('mouseenter', () => this.onNodeHover(talent.id));
     btn.addEventListener('mouseleave', () => this.onNodeLeave());
   }
   ```

   This also matches the existing `@media (pointer: fine)` block at the bottom of the talent CSS, which is already the panel's stated position on hover affordances.

2. **Keyboard.** `handleKeydown`'s arrow navigation sets `selectedNode` and focuses the target, but a stale `hoveredNode` from a pointer that has not moved would now mask it. Clear it: `this.hoveredNode = null;` at the top of `handleKeydown`, before the `Escape` branch.

Also clear `hoveredNode` in `showTab` — switching tabs hides the node the pointer was over, and no `mouseleave` is guaranteed for an element that becomes `display: none`.

### 19.6 Verification

1. **19.1** — open each tab; exactly two reset buttons are visible, and the branch one names the tab you are on.
2. **19.2** — fresh save reads `0/40` on every tab. Fill a branch's rows 1–4 and take one keystone: `40/40`. Put 3 points into that branch's overflow node: `40/40 +3`. No tab ever shows 1041 or 42.
3. **19.3** — hover Learn for ten seconds: no flicker, and the Elements pane shows the same DOM node throughout. Ten consecutive clicks allocate ten points.
4. **19.4** — with the talents tab open and the game running, a performance profile over 5 s shows no `querySelector` and no `innerHTML` setter under `TalentPanel.update`, and scripting time in the panel drops to the same order as `ResearchPanel`. Switching tabs still paints the newly-shown branch correctly on the first frame (this is what `dirtyBranches` exists to guarantee — check it by allocating on Wrath, switching to Arcana and back).
5. **19.5** — click a node to pin it, then hover three others in turn: the card follows the pointer and shows the `Preview` badge, and returns to the pinned node on `mouseleave`. Hovering the pinned node itself shows no badge. Arrow-key navigation moves the card even while the pointer sits over an unrelated node.
6. No test in `tests/` reads `TalentPanel` (it is DOM-only), so `npm test` is unchanged except for the `BRANCH_CAPACITY` assertion added in 19.2. `npx tsc --noEmit` must stay clean — the new imports from `utils/dom` are the only surface change.
