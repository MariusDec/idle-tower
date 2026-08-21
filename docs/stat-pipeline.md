# Stat Pipeline

**Files:** `src/stats/` — `keys.ts`, `context.ts`, `accumulator.ts`, `resolve.ts`,
`BuffRegistry.ts`, `contributors/*.ts`

One immutable input snapshot in, one derived stat block out. This is the only
place in the game where a tower stat is computed, and `Game.applyResolvedStats`
is the only place one is written.

## Why it exists

Before this, eight systems wrote directly into the shared mutable `TowerState`
and into `EnemyManager`'s multipliers, in an order nobody could see, using `=`
where they meant `*=`. The consequences filled Part 1 of the improvements plan:

- every gold multiplier except the raw `goldMulti` upgrade was discarded, 60
  times a second (§1.1), and within one recompute six gold sources overwrote
  each other so only the last applicable one survived (§1.2)
- the Berserk fire-rate buff was cancelled one line after it was applied, every
  frame (§1.3)
- Vampiric Aura's regen was permanently subtracted out by any purchase made
  during the buff (§1.8)
- twenty talents and nine achievement reward types had no consumer at all
  (§1.4, §1.5)

Those were symptoms of one cause. The pipeline removes the cause: contributors
cannot see each other, cannot read a partially-composed stat, and cannot write
anything but their own bucket.

## The shape

```
StatContext  ──►  contributors  ──►  StatAccumulator  ──►  ResolvedStats
(plain data)      (pure fns)         (2 buckets/stat)      (Record<StatKey, number>)
                                            │
                                            └──►  Breakdown (opt-in)
```

**`StatKey`** (`keys.ts`) is a closed union of ~60 stats, with `STAT_BASES`
giving each a seed and `STAT_CLAMPS` a single post-composition clamp. Because
`ResolvedStats` is `Record<StatKey, number>`, a key without a base fails `tsc`.

**`StatContext`** (`context.ts`) is plain data — no manager references. Each
field is one system's own answer about its own contribution. `Game.buildStatContext`
fills it; nothing in it computes. That is what makes `resolveStats` callable from
a test with a literal, which is what `tests/stats.test.ts` does.

**`StatAccumulator`** (`accumulator.ts`) holds two buckets per stat. The only
composition rule in the game is:

```
value = (base + Σ additive) × Π multiplicative,   then clamp once
```

Order of contribution is irrelevant by construction. Contributions are recorded
into a `Breakdown` only when asked (`{ breakdown: true }`), because the resolve
runs on every purchase and buff edge while the attribution is only needed when
the Stats panel renders.

**Contributors** (`contributors/`) are pure `(ctx, acc) => void`: upgrades,
evolutions, prestige, research, achievements, wave modifier, blessings, **core**,
talents, passives, equipment, buffs. Six of them switch exhaustively over a
closed union with a `never` default — talents over `TalentStat`, achievements
over `AchievementRewardType`, evolutions over `EvolutionEffectId`, passives over
`PassiveStat`, blessings over `BlessingStat`, and the core over `CoreId` — so
content that nothing consumes is a compile error rather than a purchase that
changes no number.

`contributors/core.ts` is the odd one of the six: most of its cases are a single
call, because a core's *stat block* is data and lives in `src/data/cores.ts`
where it can be re-tuned in one line. The switch earns its keep on the case that
is not data — `bloodforge`'s tempo step, which is gated on live tower HP. See
[core-system.md](core-system.md).

Three resolved keys are deliberately **not** tower stats: `enemySpeedMult`,
`enemyHpMult` and `enemyDamageMult` are written to `EnemyManager` by
`applyResolvedStats`. They still go through the pipeline so a blessing's enemy
multipliers compose with the wave mutator's instead of one overwriting the
other. See `docs/blessing-system.md`.

## HP-gated stats

Three effects read `StatContext.hpFraction` rather than a fixed input: the
`hp_threshold_damage` evolution (above 80%), the `last_stand` blessing (below
30%) and `bloodforge`'s `desperate_tempo` (below 50%). Until Part 6 nothing
recomputed when HP moved, so all three armed at the *next* resolve triggered by
something else — a purchase, a buff edge, a wave clear. For a comeback mechanic
that is the wrong moment by definition.

`Game.refreshHpThresholdStats` runs once per simulation substep and buckets
`hpFraction` against `HP_STAT_THRESHOLDS`, resolving only on a crossing. A tower
sitting at 29% HP costs zero resolves; an actual crossing costs one.

## Derived and stateful cases

Three things do not fit `(base + adds) × mults`, and each is handled in one
named place rather than by a contributor reaching across:

- **Gold** is `(1 + additive sources × research × transcendence) × flat
  multipliers`. `goldAdditive` resolves first and is folded into
  `goldMultiplier` in `resolveStats`, keeping every source visible in the
  breakdown.
- **Shield recharge** floors at 3 s, and shield charges drop to 0 when there is
  no recharge timer — a charge that can never come back is not a charge.
- **Current HP, shield charges and wall HP** need memory across recomputes, so
  `Game.applyResolvedStats` owns them. HP keeps its fraction of max when max
  rises and clamps when it falls.

## Buffs

`BuffRegistry` owns every time-varying modifier: ability buffs, the quick-shot
proc, and the manual-aim boost. A buff is `{ id, stat, kind, value, label,
remaining }` and is an *input* to the same resolve as everything else, so a buff
and a purchase made during it compose instead of racing.

`remaining` counts down on the **game** clock, not wall-clock: the simulation
runs at up to 6.5×, and a wall-clock deadline would make Berserk last a sixth as
long at high speed.

The registry's `version` increments when the effective buff set changes.
`Game.simulate` calls `refreshBuffedStats()` once per substep, which recomputes
only on a version change — so a buff starting or expiring costs one resolve,
not a resolve per frame.

## Displayed equals applied

`Game.computeGoldBreakdown` re-resolves the *same* `StatContext` the applied
stats came from, with breakdown collection on. There is no second formula, so a
tooltip that disagrees with the applied number is not expressible. The Stats
panel's fire rate now includes buffs for the same reason: it reads the resolved
value, so casting Berserk moves the number.

## Adding a stat

1. Add the key to `StatKey` and give it a base in `STAT_BASES` (and a clamp in
   `STAT_CLAMPS` if it has bounds).
2. Contribute to it from whichever contributor owns the source.
3. Write it out in `Game.applyResolvedStats`.
4. Pin it in `tests/stats.test.ts`.

Adding a talent/achievement/evolution/passive stat to its data union without
step 2 does not compile.
