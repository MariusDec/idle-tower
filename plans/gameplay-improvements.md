# The Tower — Gameplay Improvements Plan

**Date:** 2026-08-20
**Scope reviewed:** the playable loop, not the code health. Read `src/game/Game.ts` (simulate /
frameUpdate / event handlers), `Tower`, `EnemyManager`, `WaveManager`, `AbilityManager`, all of
`src/data/`, every `docs/*.md`, `main.ts` input wiring, and drove a live build at
`localhost:5173` through `window.__theTower`. Baseline is green: `tsc --noEmit` clean,
103/103 vitest, `npm run sim` reproduces the documented curve.

The previous plan (`plans/improvements-plan.md`) is fully implemented. It fixed *correctness*
(dead content, last-writer-wins stats), *balance* (the 60-minute opening) and *performance*.
Nothing here re-treads that ground. This plan is about a different question: **is it fun to
play?**

---

## 0. Diagnosis

The game has more content than most projects its size and almost all of it now works. What it
does not have is a **player**. Five findings, in order of how much fun they cost:

### 0.1 The only in-combat verb is "hold the mouse"

Across the whole run the player's real-time inputs are:

| Input | What it does | Why it isn't a decision |
|---|---|---|
| Hold LMB on canvas | Aim at cursor, `×1.3` fire rate (`Game.simulate`, `BUFF_MANUAL_AIM`) | Strictly better than not holding. It is a tax on attention, not a choice. |
| Keys `1`–`9` | Cast ability if off cooldown | Correct play is "cast on cooldown", which `AutomationManager.runAutoCast` later does for you. |
| `<` `>` `P` `-` `+` | Wave/speed controls | Meta controls, not play. |

`main.ts` attaches exactly three canvas listeners (`mousemove`, `mousedown`, `mouseup`) and they
all feed one flag. There is nothing to click, nothing to place, nothing to dodge, nothing to
react to. Every decision in the game happens in a menu, between engagements, and is never
revisited.

### 0.2 Every run is the same run

Progression is purely vertical. Upgrades are 27 strictly-good linear purchases; talents are
allocated once and persist forever; research persists; equipment drifts upward. Two runs at the
same lifetime-AP differ only in how far the same numbers got. There is no run-scoped choice that
changes *what your tower does* — so there is no discovery, no synergy hunting, and no reason for
run #40 to feel different from run #4.

The one exception, wave mutators, is a *difficulty* choice (`hpMult`, `countMult`, `goldAdditive`),
not a *build* choice. It changes the enemies, never the tower.

### 0.3 Enemies are stat blocks, not threats

All eight types run in a straight line at the tower and melee it. `EnemyManager.tick` is: move
toward `(tx, ty)`, stop at contact radius, attack on cooldown. `healer` is the only type with an
actual behavior, and `splitter`/`shielded` are one-line rules. The consequence is that every
defensive stat collapses into the same scalar — "damage dealt over the approach corridor" — so
range, targeting mode, knockback, mines and slow are all the same upgrade wearing different hats.
Nothing the player builds is an *answer* to anything specific.

### 0.4 Bosses are a longer bar

A boss is `baseHP × 20`, armor 6, 15% magic resist, plus an entry slow-mo and a three-ring death
shockwave. The juice is genuinely good; the encounter is nothing. Wave 10, 50 and 150 play
identically. There is no phase, no telegraph, no mechanic to answer, and therefore no memory of
any individual boss.

### 0.5 Nothing asks anything of the player between prestige points

Achievements are lifetime and fire perhaps twice an hour. Milestones are informational. Between
wave 12 and wave 47 there is no goal with a horizon shorter than "ascend eventually", so the
mid-run has no texture at all.

### 0.6 What is already good (do not regress it)

- **Feel**: screen shake, boss slow-mo, damage numbers, shockwave rings, vignette, audio.
- **Readability**: milestone strip, stat breakdown tooltips, run summary, run-stall banner.
- **The idle contract**: offline progress, automation tiers, 6.5× speed that costs ~0% DPS.
- **The stat pipeline**: one composition point, closed unions, contributors that can't clobber.

Every part below must land *without* breaking the idle contract. The rule this plan uses
throughout:

> **Active play may be worth up to +25–40% throughput. It may never be required, and every
> active verb must have an automatic fallback that pays a reduced amount.**

---

## 1. The shape of the fix

Seven parts, ordered by fun-per-hour-of-work. Each is independently shippable and independently
committable.

| Part | What it adds | The gap it closes |
|---|---|---|
| 1 | **Blessings** — in-run roguelite draft, 3-of-N every few waves | 0.2 — every run is the same |
| 2 | **Enemy behaviors** — five behavioral types + verbs for the existing eight | 0.3 — enemies are stat blocks |
| 3 | **Boss encounters** — phases, telegraphs, DPS checks, kill-timer rewards | 0.4 — bosses are a longer bar |
| 4 | **Active verbs** — loot orbs, charged shot, click-placed abilities | 0.1 — nothing to do |
| 5 | **Contracts** — three rolling short-horizon objectives per run | 0.5 — no mid-run goals |
| 6 | **Tower cores** — pick a specialization that changes how you shoot | 0.2 — no build identity |
| 7 | **Pacing** — call-wave-early, combo meter, threat preview, risk dial | 0.1 / 0.5 — dead air |

**Order matters.** Part 1 gives the player something to decide; Parts 2–3 give them something to
decide *about*; Part 4 gives their hands something to do; Parts 5–7 tighten the loop around all of
it. Implement in numeric order — later parts reference earlier ones.

---

## Part 1 — Blessings: an in-run draft

> **Status: implemented (2026-08-20), commit `4a7f255`.** Four corrections found during
> implementation, kept here so later parts don't repeat them:
> 1. The per-card values in §1.3 are 4–6x what §1.6's balance target allows — 13 picks compound
>    hard against the HP curve, and the §1.3 numbers put the wall past wave 89 at 0 lifetime AP.
>    The shipped pool hits the §1.6 target instead; `docs/blessing-system.md` records the delta.
> 2. The pool shipped at **30 cards**, not "~34" — §1.3's tables total 29.
> 3. §1.4's "no new keys needed" was wrong twice: `armorPenFlat` needs its own key because the
>    existing `armorPen` is a fraction, and `bl_brittle` needs an `enemyDamagePct` stat that
>    §1.2's `BLESSING_STATS` list omits.
> 4. The `WaveManager` API is `pauseIntermission()` / `resumeIntermission()`, not
>    `setIntermissionPaused`; `WaveModifierModal` uses `pauseSpawning`, a different hook.

**Goal:** a build-shaping decision every ~90 seconds, wiped on ascension, so two runs at the same
power level play differently.

### 1.1 Cadence

- First draft after clearing **wave 3**, then every **4 waves** (3, 7, 11, 15, …).
- Offer **3** options drawn from the pool without replacement within the offer.
- **1 reroll** per draft, plus any reroll tokens held (Part 5 grants them).
- Hard cap **30 picks per run** — past that the draft stops offering (keeps the sim tractable).
- The draft is offered during intermission and **pauses the intermission timer only**
  (`WaveManager.pauseIntermission()` / `resumeIntermission()` — note `WaveModifierModal` uses the
  *spawning* hook, `pauseSpawning`, which is a different thing). It must not pause the simulation.
- **Idle safety:** a setting `autoPickBlessings` (default off; forced on when the tab has been
  hidden, and when `AutomationManager` has `autoBuy` unlocked) auto-selects after **20 s**, taking
  the highest-weight offer. An unattended game never stalls on a modal.

### 1.2 Data model

New file `src/data/blessings.ts`:

```ts
export type BlessingRarity = 'common' | 'rare' | 'epic';

/** Closed union — every stat a blessing can move must have a consumer. */
export const BLESSING_STATS = [
  'damagePct', 'fireRatePct', 'critChancePct', 'critDamagePct', 'rangePct',
  'goldPct', 'maxHpPct', 'lifestealPct', 'manaRegenPct', 'abilityDamagePct',
  'armorPenFlat', 'pierceFlat', 'enemySpeedPct', 'enemyHpPct',
] as const;
export type BlessingStat = typeof BLESSING_STATS[number];

/** Behaviors are queried by id, like upgrade evolutions. */
export type BlessingBehavior =
  | 'ricochet'          // shots bounce to one extra target for 60% damage
  | 'ricochet_power'    // ricochet bounces deal full damage and can chain twice
  | 'mortar'            // every 8th shot lands as a 90px splash
  | 'crit_chain'        // crits fire a 3-bounce chain for 40% damage
  | 'frost_shots'       // hits chill for 20% slow, 1.5s
  | 'shatter'           // damage +35% vs chilled/slowed enemies
  | 'orb_magnet'        // loot orbs (Part 4) home to the tower at full value
  | 'split_on_kill'     // a kill fires two 40% shards at nearby enemies
  | 'homing'            // projectiles curve toward their target
  | 'overkill_carry'    // 25% of overkill damage carries to the next target
  | 'siphon'            // kills restore 1% max mana
  | 'executioner'       // instantly kill non-boss enemies below 8% HP
  | 'last_stand'        // below 30% tower HP: +60% damage
  | 'greed_engine';     // gold multiplier grows +2% per wave cleared this run

export interface BlessingDef {
  id: string;
  name: string;
  description: string;      // rendered with the resolved value substituted
  rarity: BlessingRarity;
  weight: number;           // draw weight within its rarity
  maxStacks: number;        // 1 for behaviors, 3–5 for scaling
  minWave?: number;
  /** Scaling blessings declare stat deltas; behavior blessings declare `behavior`. */
  effects?: Array<{ stat: BlessingStat; perStack: number }>;
  behavior?: BlessingBehavior;
  /** Only offered when the player already holds this blessing (synergy follow-ups). */
  requires?: string;
  /** Offer weight multiplier when the player runs this core (Part 6). */
  corePreference?: Record<string, number>;
}
```

### 1.3 The pool (~34 entries; exact values are a starting point, tune with `npm run sim`)

**Common (weight 10 each, 3–5 stacks) — the filler that makes the rare picks feel earned**

| id | Effect |
|---|---|
| `bl_sharpen` | +18% damage |
| `bl_tempo` | +12% fire rate |
| `bl_focus` | +4% crit chance |
| `bl_cruelty` | +25% crit damage |
| `bl_reach` | +15% range |
| `bl_avarice` | +20% gold |
| `bl_vigor` | +25% max HP |
| `bl_wellspring` | +30% mana regen |

**Rare (weight 5, 1–2 stacks) — behaviors that change the picture**

| id | Effect |
|---|---|
| `bl_ricochet` | Shots bounce to one extra target for 60% damage (`ricochet`) |
| `bl_mortar` | Every 8th shot lands as a 90 px splash for 200% damage (`mortar`) |
| `bl_frost` | Hits chill: −20% enemy speed for 1.5 s (`frost_shots`) |
| `bl_split` | Kills fire two 40% shards at nearby enemies (`split_on_kill`) |
| `bl_homing` | Projectiles curve toward their target (`homing`) |
| `bl_siphon` | Kills restore 1% max mana (`siphon`) |
| `bl_pierce` | +2 pierce (`pierceFlat`) |
| `bl_sunder` | +8 armour penetration (`armorPenFlat`) |
| `bl_arcane` | +35% ability damage |
| `bl_bulwark` | +6% lifesteal |

**Epic (weight 2, 1 stack) — run-defining, plus every trade-off card**

| id | Effect |
|---|---|
| `bl_executioner` | Instantly kill non-boss enemies below 8% HP (`executioner`) |
| `bl_crit_chain` | Crits fire a 3-bounce chain for 40% damage (`crit_chain`) |
| `bl_overkill` | 25% of overkill damage carries to the next target (`overkill_carry`) |
| `bl_last_stand` | +60% damage below 30% tower HP (`last_stand`) |
| `bl_greed_engine` | +2% gold per wave cleared this run, uncapped (`greed_engine`) |
| `bl_glass` | **+120% damage, −45% max HP** |
| `bl_sniper` | **−35% range, +70% fire rate** |
| `bl_reckless` | **+20% enemy speed, +60% gold** |
| `bl_brittle` | **−25% enemy HP, +30% enemy damage** |
| `bl_shatter` | +35% damage vs slowed/chilled enemies (`shatter`, `requires: bl_frost`) |
| `bl_ricochet_power` | Bounces deal full damage and chain twice (`ricochet_power`, `requires: bl_ricochet`) |

The four **trade-off cards** are the point of the epic tier: they are the first decisions in the
game the player can get *wrong*, which is what makes the right ones feel like anything.

### 1.4 Wiring

- `src/systems/BlessingManager.ts` — owns `Record<string, number>` (id → stacks), the offer roll
  (`rollOffer(wave, held, core)`), reroll budget, `has(behavior)`, `stacks(id)`,
  `getStatTotals(): Partial<Record<BlessingStat, number>>`, `reset()`.
- `src/stats/contributors/blessings.ts` — pure `(ctx, acc) => void` switching **exhaustively**
  over `BlessingStat` with a `never` default, exactly like `contributors/talents.ts`. A blessing
  stat with no consumer must be a compile error.
- `src/stats/context.ts` — add `blessings: { stats: Partial<Record<BlessingStat, number>> }`.
- `src/stats/keys.ts` — no new keys needed for the scaling tier except `enemySpeedPct` /
  `enemyHpPct`, which route to `EnemyManager` setters, not to `TowerState`.
- Behaviors are read the way evolutions are: `Game.simulate` / `ProjectileManager` /
  the `enemy_killed` handler ask `blessingMgr.has('ricochet')`. Keep a rebuilt lookup cache
  (`rebuildBehaviorCache()`) like `UpgradeManager` does — these are read per shot.
- `src/ui/BlessingDraftModal.ts` — model it on `src/ui/WaveModifierModal.ts` (same backdrop, card
  grid, `onChoose` / `onSkip` contract). Show rarity colour, stacks held, and a "your build" strip.
- `src/ui/BlessingsPanel.ts` *or* a section in `ProgressionPanel` — the held-blessing list with
  stacks, so the player can see the build they assembled.
- `Game`: `wave_cleared` handler decides whether a draft is due; `chooseBlessing(id)` /
  `rerollBlessings()` / `skipBlessing()` mirror `chooseWaveModifier` / `skipWaveModifier`,
  **including the `resumeSpawning()` / intermission-unpause obligation** documented in
  `docs/wave-modifier-system.md`.

### 1.5 Persistence

- New `GameState.blessings: { held: Record<string, number>; picksTaken: number; rerolls: number;
  pendingOfferForWave: number | null }`.
- **Bump `SAVE_VERSION` 9 → 10** with `migrateV9toV10` seeding an empty blessing state.
- Blessings are **run-scoped**: cleared in `applySavedStateReset` (ascension) and in
  `applyFullTranscendenceReset`. This is deliberate — they are what makes a *run* distinct.

### 1.6 Balance targets

- A full run (≈25 picks) should land **2.5×–3.5× run power**, mostly through synergy rather than
  flat stats. Verify with `npm run sim`: wall-wave at 0 lifetime AP should move from 39 to
  **48–55**, not past 70.
- No single blessing may exceed +120% of a single stat at max stacks.
- `bl_greed_engine` is uncapped by design; confirm in the sim that a 100-wave run with it does not
  exceed 6× baseline gold.

### 1.7 Files

`src/data/blessings.ts` (new), `src/systems/BlessingManager.ts` (new),
`src/stats/contributors/blessings.ts` (new), `src/ui/BlessingDraftModal.ts` (new),
`src/ui/BlessingsPanel.ts` (new), `src/stats/context.ts`, `src/stats/resolve.ts`, `src/types.ts`,
`src/game/Game.ts`, `src/systems/ProjectileManager.ts`, `src/systems/SaveManager.ts`,
`src/ui/UIManager.ts`, `src/main.ts`, `src/styles/main.css`, `docs/blessing-system.md` (new),
`AGENTS.md` (content table), `tests/`.

### 1.8 Verification

- Unit: offer never duplicates within a draft; never offers a maxed blessing; `requires` gating;
  reroll decrements; cap at 30 picks; `getStatTotals` sums stacks correctly.
- Golden stat test: a literal `StatContext` with two blessings resolves to a pinned damage figure.
- Save round-trip v9 → v10 with blessings held.
- `npm run sim` before/after table in the commit message.
- In-browser: take a draft, confirm the Stats panel breakdown shows the blessing as a named source.

---

## Part 2 — Enemies that demand an answer

> **Status: implemented (2026-08-20).** Corrections found during implementation,
> kept here so later parts don't repeat them:
> 1. §2.4's suggested weights (`siege` 2, `thief` 1, `blinker` 2, `warden` 1,
>    `burrower` 2) *added* eight weight points to a 17-point pool without saying
>    what pays for them, which contradicts §2.6. `normal` 6→5 and `splitter` 2→1
>    pay for them in the shipped table, and the new types' base HP is budgeted so
>    the pool's weighted mean effective HP is unchanged.
> 2. The spawn-weight table was hand-copied in **three** places — `WaveManager`,
>    three functions in `SaveManager` (offline progress) and `sim/model.ts`.
>    §2.7's file list mentions none of them. It is now one exported table,
>    `ENEMY_SPAWN_WEIGHTS`; anything that reads the mix must read that.
> 3. §2.8 says "`Tower.acquireTarget` must skip it". That is one of *eight*
>    target-selection sites: the projectile sweep, three blessing bounce helpers
>    and six pickers in `AbilityManager` are the rest. They all route through one
>    predicate, `isTargetable` — a new picker that does not consult it is how a
>    burrower becomes shootable underground.
> 4. Splitter "spawn protection" (§2.2) has to mean *untargetable*, not merely
>    damage-immune: shots that pass through cost the player nothing, whereas
>    shots absorbed for zero read as a bug. Untargetable is the same mechanism
>    the burrower needs, so both use it.
> 5. §2.1's warden numbers are far stronger than they look — 15% of maxHp × 5
>    allies refreshed every 4 s is several times its own bar over a fight. The
>    shipped pool is *set*, never added to, wardens never shield each other, and
>    the pool collapses the instant the warden dies; `sim/model.ts` credits it at
>    2.2× effective HP on the strength of `priority` being the default.
> 6. §2.7 omits `src/data/xpTables.ts` and `src/systems/SaveManager.ts`, both of
>    which hold `Record<EnemyType, …>` maps that a new type will not compile
>    without.

**Goal:** make at least one defensive choice per enemy type *correct* and the others *wrong*, so
the tower build stops being a single scalar.

### 2.1 Five new behavioral types

Add to `EnemyType`, `ENEMY_DEFS`, and give each a behavior branch in `EnemyManager.tick`.

| Type | Unlock | Behavior | The answer it demands |
|---|---:|---|---|
| `siege` | 25 | Halts at `standoffRange` **260 px** and lobs a shot at the tower every 3 s (`baseDamage × 3`, travels 1.2 s, visible arc) | **Range** and target priority — a short-range build simply loses HP forever. Knockback and slow do nothing. |
| `thief` | 30 | Beelines; on contact steals `min(6% of current gold, 30× wave gold)` and **flees to the nearest edge**. Killed before it escapes → drops the stolen gold ×2. Escapes → gold is gone. | Burst damage and attention. A pure sustain build watches its economy walk off screen. |
| `blinker` | 35 | Every 3 s teleports 140 px toward the tower; **immune to knockback and mines during the blink**, and skips the wall contact band | Raw DPS and AoE. Knockback/mine/wall builds have no answer. |
| `warden` | 40 | Projects a regenerating absorb shield (`15% of its maxHp`) onto up to 5 nearby allies; the shield refreshes every 4 s while the warden lives | Target priority — the new `priority` targeting mode, or manual aim / click-targeted abilities. |
| `burrower` | 45 | Spawns burrowed: **invulnerable and untargetable**, moves at 1.6× speed, surfaces at 120 px from the tower with a 1 s telegraph | Sustained close-range defence: shockwave, thorns, mines placed near the tower. Long-range sniping is bypassed entirely. |

Enemy projectiles: `siege` needs a hostile shot. Do **not** reuse `ProjectileManager` (it is tower-
owned and every loop assumes friendly). Add a small `hostileShots: HostileShot[]` list on
`EnemyManager` with position/velocity/damage/lifetime, ticked in `EnemyManager.tick` and drawn by
`Renderer`; on arrival emit `tower_damaged` so the whole existing mitigation chain (dodge, wall,
shield, armour, mana shield) applies unchanged.

### 2.2 Verbs for the eight existing types

| Type | New behavior |
|---|---|
| `healer` | Below 40% HP it **flees** from the tower instead of advancing, and heals while retreating. Makes it a priority kill instead of a background number. |
| `tank` | **Body-blocks**: a projectile that hits a tank never pierces past it, regardless of pierce count. Gives the tank a role in a formation instead of being a fat circle. |
| `flying` | Ignores land mines and the wall contact band entirely (it is *flying*). |
| `fast` | Arrives in **packs of 3** with a shared spawn point, so it reads as a rush rather than a trickle. |
| `splitter` | Children inherit a 2 s spawn-protection and scatter outward, so a splitter death is a small burst to react to. |
| `shielded` | Shield charges regenerate one every 6 s while it has taken no damage for 3 s — rewards sustained fire over pot-shots. |
| `normal` | Unchanged. It is the baseline and should stay legible. |
| `boss` | See Part 3. |

### 2.3 Targeting

- Add `TargetingMode = 'priority'`: prefers `warden` → `healer` → `thief` → `siege` → nearest.
  Make it the **default** for new games (`src/data/tower.ts`), because with Part 2 landed, "nearest"
  is now actively a bad default.
- `'first'` is a dead alias of `'nearest'` (`Tower.acquireTarget`) — either give it real semantics
  (furthest along its approach) or delete it and migrate saves. Deleting is fine; `Game.ts:2282`
  already migrates `'first' → 'nearest'`.
- Surface the targeting selector out of the Settings panel and into the HUD, as a compact
  dropdown next to the wave controls. It is now a live tactical choice, not a preference.

### 2.4 Spawn weights and pacing

Extend the weighted pool in `WaveManager` (currently normal 6 / fast 3 / tank 2 / flying 2 /
healer 1). Suggested additions once unlocked: `siege` 2, `thief` 1, `blinker` 2, `warden` 1,
`burrower` 2. Cap `thief` at **one per wave** — two thieves is a tax, not a threat.

### 2.5 Rendering & readability

Every new behavior needs a read at a glance (`src/game/Renderer.ts`):
- `siege` — square body, drawn firing arc, a range ring while halted.
- `thief` — carries a visible coin sprite once it has stolen; a directional arrow while fleeing.
- `blinker` — an after-image trail at the previous position.
- `warden` — a hexagonal aura connecting it to shielded allies (draw the links).
- `burrower` — a mound + dust plume while burrowed; a 1 s expanding telegraph ring on surface.

The renderer has a sprite cache (`docs/performance.md`); new shapes go into it rather than being
drawn with per-frame gradients.

### 2.6 Balance

- Total wave HP must not rise: new types replace slots in the weight table, they don't add to
  `enemyCountForWave`.
- Thief steals from *current* gold, so it cannot bankrupt a player who spends. Cap total theft per
  wave at 15% of current gold.
- Run `npm run sim` and confirm the wall-wave shift is within ±3 waves; if the new types are a
  net difficulty spike, reduce their weights before touching HP curves.

### 2.7 Files

`src/data/enemies.ts`, `src/systems/EnemyManager.ts`, `src/systems/WaveManager.ts`,
`src/systems/Tower.ts`, `src/data/tower.ts`, `src/game/Renderer.ts`, `src/game/Game.ts`,
`src/types.ts`, `src/ui/HUD.ts`, `src/data/milestones.ts` (enemy-intro milestones are derived from
unlock waves — new types must appear in the strip), `docs/enemy-system.md`, `AGENTS.md`, `tests/`.

### 2.8 Verification

- Unit per behavior: thief steals then flees then drops ×2 on death; blinker ignores knockback
  mid-blink; warden shield absorbs and refreshes; burrower is untargetable while burrowed
  (`Tower.acquireTarget` must skip it); siege shot routes through `tower_damaged`.
- `tests/content-coverage.test.ts`: every `EnemyType` has a `Renderer` shape and a milestone entry.
- In-browser: jump to wave 45 (`__theTower.game.waveManager.startAtWave(45)`), watch each type.

---

## Part 3 — Boss encounters

> **Status: implemented (2026-08-20).** Corrections found during implementation,
> kept here so later parts don't repeat them:
> 1. **§3 assumes one boss per wave. There are `2 + tier`.**
>    `formulas.ts:bossCountForWave` has always spawned three bosses at wave 10,
>    six at wave 40 and twelve at wave 100, and §3.1–3.5 is written throughout as
>    if there is exactly one. Every number in §3.2 had to be re-read as
>    *per encounter* or *per boss*: `summon`'s "4 adds" is divided across the
>    pack (`bossSummonCountForWave`) with a global 40-alive ceiling, `slam`'s
>    first telegraph is staggered at random so the pack does not fire in
>    lockstep, and the §3.4 rewards are scored once per **encounter** — paying a
>    reroll token per boss would make "flawless" mean "flawless, times six".
> 2. **The compensation §3 omits is the whole balance story.** Bosses were
>    already the wall at every prestige tier (`npm run sim`: a wave-40 boss sits
>    at 0.99 of its enrage budget at 100 lifetime AP), so the phase machine as
>    specified moved the wall a full decade at *every* tier — 59→49, 89→79,
>    129→119, 169→159. Part 2's §2.6 rule ("new content replaces slots, total
>    wave HP must not rise") applies here too and §3 does not say so.
>    `BOSS_PATTERN_HP_WEIGHT` now prices what each pattern holds outside the HP
>    bar and `bossMaxHpForWave` shrinks the bar by exactly that, so a boss wave
>    costs the same total damage it always did and the added difficulty is *fail
>    states* rather than a longer bar — which is what §0.4 was asking for.
> 3. **"Tier 4+ draws all four, one per phase" (§3.2) cannot be literal** —
>    there are three phases and four patterns. Shipped as a deterministic
>    rotation by tier: every tier-4+ boss runs three *distinct* patterns, and
>    across four consecutive tiers every pattern reaches every phase slot.
>    Determinism is also what makes §3.7's phase-count test meaningful.
> 4. **§3.2's bulwark "recycles" is load-bearing and ambiguous.** Read as
>    "re-arms after a break as well as after a timeout", it turns a DPS *check*
>    into a treadmill worth several times the boss's own bar — the sim priced
>    that at ten wall-waves. Shipped as: a broken bulwark stays broken for the
>    phase; only the *timeout* path heals and re-arms.
> 5. **§3.2's siphon needs a heal rate, not a heal ratio.** "Heals for it" priced
>    per point of mana is a rounding error at wave 10 and half the bar at wave
>    150, because mana pools grow by orders of magnitude across a run. Shipped as
>    0.5% of max HP per second of *full* drain, pro-rated by the mana actually
>    available — so an empty pool feeds it nothing, which is the answer the
>    pattern is asking for.
> 6. **§3.2 names Frost Nova as the answer to `slam`, but Frost Nova applies a
>    global slow, not a chill.** Mitigation reads `EnemyManager.isSlowed(boss)`
>    (per-enemy chill map first) plus a sticky flag set by `applyKnockback` /
>    `applyShockwave`. A chill-only read would have left the ability §3.2 names
>    doing nothing.
> 7. **§3.5's bar has to pick a boss, and "the one you are shooting" is the
>    wrong rule.** Lowest-HP-fraction was the first implementation; in-browser at
>    wave 60 with an eight-boss pack the slam countdown belonged to a boss the
>    bar was not watching, so the telegraph — the single most time-critical thing
>    in Part 3 — never surfaced. `leadBoss()` now prefers whichever boss is
>    mid-telegraph, soonest first.
> 8. **§3.6's file list omits `src/data/equipment.ts`** (the swift-kill drop
>    needs `guaranteed` + `rarityBoost` options and a rarity ladder),
>    `src/systems/PrestigeManager.ts` (the flawless AP bonus needs a run-scoped
>    channel that composes with the lifetime achievement bonuses instead of
>    overwriting them), `src/systems/SaveManager.ts` and `sim/model.ts`.
> 9. **§3 does not mention a save bump; it needs one.** `SAVE_VERSION` 10 → 11
>    for `GameState.bossRun` (the flawless AP bonus and the two counters).
>    Mid-fight state is deliberately *not* persisted — live enemies never were,
>    so a load starts with an empty roster and `WaveManager` clears the wave.
> 10. **The pre-existing 50%-HP boss enrage still fires**, inside phase 2. It was
>     left alone rather than folded into the phase machine, but it means a boss
>     has *four* escalations, not three, and only three of them are on the bar.
> 11. Unrelated but found by the §3.7 test work: `tests/enemies.test.ts` had a
>     4%-per-run flake. `WaveManager.startWave` pauses spawning on the
>     mutator-offer roll and only the modal resumes it, so a headless harness
>     silently spawned nothing one run in twenty-five. Fixed with an explicit
>     `resumeSpawning()`.

**Goal:** make wave 10 a thing that happens, and wave 100 a thing you prepare for.

### 3.1 Phases

A boss gains `phase: 1 | 2 | 3`, crossing at **66%** and **33%** max HP. Each crossing:
- brief invulnerable flash + `boss_phase` event + screen pulse,
- a slow-mo beat (reuse `triggerBossEntrySlowMo`),
- switches the active pattern.

### 3.2 Patterns (assigned by boss tier = `floor(wave / 10)`, cycling)

| Pattern | Behavior | Answer |
|---|---|---|
| `bulwark` | Gains a shield worth **20% of max HP**. If not broken within **10 s**, the boss heals that amount back and the shield recycles. | A DPS check. Rewards saved cooldowns — Rain of Arrows, Meteor, Berserk. |
| `summon` | Every 6 s spawns **4 adds** scaled to the wave (mixed types, no bosses). | AoE and clear speed. Rewards Frost Nova, mines, ricochet. |
| `slam` | Telegraphs for **2 s** with a growing ground ring, then deals `boss.damage × 8` to the tower. **Mitigated to 20% if the boss is slowed or knocked back during the telegraph.** | The first real reactive moment in the game. Frost Nova / shockwave / the charged shot from Part 4 all answer it. |
| `siphon` | Drains **8 mana/s** from the player and heals for it. | Mana economy pressure; rewards spending mana rather than pooling it. |

Tier 1 (wave 10) uses `bulwark` only — the introduction should teach one thing. Tier 2 adds
`summon`, tier 3 adds `slam`, tier 4+ draws all four, one per phase.

### 3.3 Enrage timer

A boss that lives longer than **60 s** gains `+15% damage and +10% speed every 10 s`, stacking.
This is distinct from the existing wave-level enrage (`formulas.ts:enrageStacksFor`) and should be
displayed on the boss bar so it reads as a countdown, not a surprise.

### 3.4 Rewards for playing well

- **Swift kill**: boss dead inside 30 s → **+50% boss gold** and a guaranteed equipment drop one
  rarity tier above the roll.
- **Flawless**: boss killed with no tower HP lost during the fight → **+1 reroll token** (Part 1)
  and **+10% AP** on the current run's next ascension preview.
- Both announce with the existing toast + shockwave vocabulary.

### 3.5 The boss bar

New `src/ui/BossBar.ts`, mounted in the overlay root, visible only while a boss is alive:
- name (`Wave N Warden` etc. — derive a tier name table), HP bar with **phase pips** at 66/33%,
- the active pattern's name + a telegraph countdown bar during `slam`,
- the enrage timer,
- the shield overlay during `bulwark` (drawn over the HP bar, distinct colour).

This is the single biggest readability win in the plan — right now the player cannot tell how a
boss fight is going.

### 3.6 Files

`src/systems/EnemyManager.ts` (phase/pattern state machine), `src/data/enemies.ts` (pattern
table + tier names), `src/game/Game.ts` (rewards, events), `src/ui/BossBar.ts` (new),
`src/ui/UIManager.ts`, `src/game/Renderer.ts` (telegraph rings, shield ring, summon burst),
`src/systems/EffectsManager.ts`, `src/types.ts`, `docs/enemy-system.md` +
`docs/boss-encounters.md` (new), `AGENTS.md`, `tests/`.

### 3.7 Verification

- Unit: phase crossings fire exactly once each and are idempotent under substepping; `bulwark`
  heals on timeout and does not heal when broken; `slam` mitigation applies when slowed; enrage
  stacks on the simulation clock, not wall-clock.
- Substepping: the whole state machine runs inside `Game.simulate`, so it must be correct at
  `dt = 1/120` and at 6.5× speed. Add a test that runs a boss fight at both and asserts the same
  phase count.
- In-browser: wave 40 boss, watch all three phases and the bar.

---

## Part 4 — Give the hands something to do

> **Status: implemented (2026-08-20).** Corrections found during
> implementation, kept here so later parts don't repeat them:
> 1. **§4.2's 6x charged shot is roughly six times too strong, and the reason
>    is structural rather than a tuning miss.** A flat multiple of *one shot*
>    on a cycle measured in wall-clock seconds scales inversely with fire rate:
>    the same 6x is +93% of a fresh tower's DPS at 1.78 shots/s and about +8%
>    of a late tower's at 20. It measured **+127%** at 0 lifetime AP against
>    §4.5's +50% cut line. Shipped at **1x per target** with the pierce and
>    splash exactly as specified — four pierced hits plus the blast still
>    deliver around 6x an ordinary shot's total output, which is what §4.2 was
>    reaching for; it just is not 6x on one body.
> 2. **§4.5's +25–40% band was already spent before Part 4 added anything.**
>    With the charged shot switched off entirely, the *pre-existing* manual-aim
>    buff plus orb clicking measures **+33.9% to +38.9%**. `MANUAL_AIM.fireRateMult`
>    (1.3, and older than this plan) fills the band on its own, so any charged
>    shot at all pushes the lowest-fire-rate tier past 40%. §4.2's own opening
>    line — "*replace* the flat hold-for-x1.3 fire rate" — is the resolution the
>    plan intended, but the brief for this part said manual aim keeps its buff,
>    so the band is met at four tiers of five and the +50% gate at all five.
>    **Anyone revisiting this should decide about manual aim first, not about
>    the charged shot.**
> 3. **§4.1's "bosses (always, 3–5)" hits Part 3's finding.** A boss wave holds
>    `2 + tier` bosses, so read per boss a wave-100 pack drops sixty orbs into
>    a forty-orb cap. `bossOrbShare` makes it an *encounter* budget divided
>    across the pack, taking the fractional remainder as a probability. Verified
>    in-browser: a wave-40 pack dropped four orbs, not six-to-thirty.
> 4. **§4.3's "no separate damage bonus" cannot be taken literally for two of
>    the three abilities.** Rain of Arrows and Frost Nova are *global* today.
>    "Targeted placement is worth +30% by hitting a better cluster" presumes
>    they are placed AoEs; making them so would be a flat nerf and a regression
>    for every existing player. The global effect is unchanged and the disc
>    carries a bonus on top instead. Meteor Strike, already a point effect,
>    genuinely relocates — and its disc is deliberately `METEOR_SPLASH_RADIUS`
>    so a placed meteor is today's meteor somewhere else, not a wider one.
> 5. **A perfectly optimal auto-placer would leave nothing for the player to
>    beat.** §4.3 assumes the reward is out-aiming the automatic placement, but
>    a `queryRadius` cluster scan is already optimal. So the reward is the focus
>    bonus, granted only on a hand-placed cast; the auto path gets the
>    placement and not the bonus.
> 6. **A reroll orb cannot pay 40%.** §4.1's collect rates are stated for all
>    kinds; a token is indivisible, and a 40% chance of losing a Part 1 reroll
>    for not watching the screen is the exact pressure the plan's rule 1
>    forbids. Reroll orbs pay whole either way; the split applies to the two
>    divisible currencies.
> 7. **§4.4's file list omits `src/data/tower.ts`, `sim/model.ts` and
>    `sim/balance.ts`.** The last two are not optional: §4.5's idle-parity check
>    is the gate, and the model had no notion of active play or of orbs as a
>    gold faucet. `MANUAL_AIM` lives in `data/tower.ts` and is read by the game
>    *and* the sim, so the multiplier can only be cut in one place.
> 8. **Orb income needed no compensation.** Parts 2 and 3 both had to buy back
>    what they added; the idle wall-wave table is bit-identical here
>    (39/59/89/129/169) because the 40% auto rate on a 2% drop chance is ~3% of
>    an ordinary wave's gold. Boss waves are a different story — orbs are 41%
>    of a wave-10 boss wave's income idle and 103% clicked — which is
>    deliberate but worth knowing. The blessing table moved at exactly one tier
>    (10 K: 147.6 → 146.1) because Lodestone is drawable now and occasionally
>    displaces a stronger card.
> 9. **Unrelated, found while testing:** the hotkey column in
>    `docs/ability-system.md` was wrong for six of the nine abilities — it
>    listed the slot order the abilities were designed in, not the `hotkey`
>    field `main.ts` matches on. Fixed. It cost a browser test run before it
>    was noticed, which is precisely the failure mode `KeybindsOverlay`
>    building its list from `ABILITIES` was meant to prevent.
> 10. **A pooled orb outlives its orb.** Worth knowing before writing a test:
>     an evicted orb is re-initialised in place for the next spawn, so holding
>     the object holds whatever came next. Hold the `id`.

**Goal:** three optional verbs worth +25–40%, each with an automatic fallback.

### 4.1 Loot orbs

- Dropped by **bosses (always, 3–5)**, **elites (always, 1–2)**, and **any enemy at 2%**.
- Kinds: `gold` (worth 12× a wave-normal kill), `mana` (12% max mana), `reroll` (rare, 4% of boss
  drops — feeds Part 1).
- **Click to collect → 100% value.** Uncollected orbs drift toward the tower over **8 s** and
  auto-collect for **40%**. The `orb_magnet` blessing and a late research node raise the auto rate
  to 100%.
- Cap **40 live orbs**; oldest expires first. Pool the objects (`docs/performance.md` conventions).
- New `src/systems/LootManager.ts`, drawn by `Renderer`, clicked via a new `canvas` click handler
  in `main.ts` that checks orbs **before** falling through to manual aim.

### 4.2 Charged shot

Replace the flat "hold for ×1.3 fire rate" with a verb that has a shape:

- Holding LMB still aims and still applies `MANUAL_AIM_FIRE_RATE`.
- Holding **without moving the cursor** for **1.2 s** builds a charge (ring fills around the
  cursor). Releasing fires a **charged shot**: `6× damage`, `+3 pierce`, `90 px` splash.
- Charge has a **4 s cooldown**; the ring shows it.
- If the player never holds, nothing is lost — this is strictly additive.
- The charged shot is the intended answer to a Part 3 `slam` telegraph and to a fleeing `thief`.

### 4.3 Click-placed abilities

- `Rain of Arrows`, `Meteor Strike` and `Frost Nova` gain a **targeted** cast: pressing the hotkey
  enters placement mode (cursor ring + range preview), and the next canvas click places it.
  Pressing the hotkey again or `Escape` cancels.
- `AutomationManager.runAutoCast` and a `Settings` toggle (`instantCast`, default **on** for
  players who prefer the current behavior) both place at the current best spot — the densest
  cluster within range, computed with `EnemyManager.queryRadius`.
- Targeted placement should be worth roughly **+30%** on those three abilities versus auto-placement,
  by hitting a better cluster. That is the whole reward: no separate damage bonus.

### 4.4 Files

`src/systems/LootManager.ts` (new), `src/systems/AbilityManager.ts`, `src/systems/Tower.ts`,
`src/game/Game.ts`, `src/game/Renderer.ts`, `src/main.ts` (click routing), `src/ui/HUD.ts`
(charge ring / placement prompt), `src/ui/SettingsPanel.ts`, `src/ui/KeybindsOverlay.ts`,
`src/types.ts`, `src/systems/SaveManager.ts` (orbs are **not** persisted; live orbs are dropped on
save load — document it), `docs/loot-system.md` (new), `docs/ability-system.md`, `AGENTS.md`,
`tests/`.

### 4.5 Verification

- Unit: orb auto-collect pays 40% and click pays 100%; the 40-orb cap evicts oldest; charge
  timer resets when the cursor moves; placement mode cancels cleanly on `Escape` and on ability
  failure (not enough mana).
- **Idle-parity check** (this is the one that matters): run `sim` twice — fully idle vs. perfect
  active play — and confirm the active advantage lands in the **+25–40%** band. If it is above
  50%, cut the charged-shot multiplier before shipping.
- In-browser: click an orb, hold for a charged shot, place a meteor.

---

## Part 5 — Contracts

> **Status: implemented (2026-08-20).** Corrections found during
> implementation, kept here so later parts don't repeat them:
> 1. **§5.1's `ContractGoal` cannot be tiered as written**, and tiering is
>    the section's own stated requirement. `reach_wave` carries an absolute
>    `wave` in a static table, which is precisely the "reach wave 60 at wave 8"
>    failure the same paragraph forbids; it ships as `ahead` (waves beyond
>    where the contract was drawn) resolved into an absolute target at draw
>    time. `spend_gold`'s flat `amount` has the same problem in the other
>    direction — trivial at wave 80, impossible at wave 8 — and ships as
>    `goldWaves`. `boss_under` also needed a `count`: without one it is a
>    contract that completes on the first boss wave the player happens to be
>    fast on, which is not a goal.
> 2. **§5.1's `reward.gold?: number` has the same flaw as `spend_gold`, and
>    §5.2 already says so.** "~2 waves' income at the current wave" is a
>    *ratio*, not a number, and storing the ratio is the only way one table
>    serves wave 6 and wave 160. Shipped as `goldWaves`, resolved against
>    `Game.estimateWaveGold` at display *and* payout, so a contract carried
>    across ten waves pays what those ten waves are worth.
> 3. **§5.2's "~2 waves' income" is 2-5x more than the curve tolerates.**
>    Three slots turning over every two to three waves means the faucet is
>    `goldWaves ÷ 2.5`, not `goldWaves` once. At the plan's figure contract
>    gold would be 20-30% of a run's income; the orb faucet Part 4 shipped at
>    3-5% and moved nothing. Shipped at **0.4-1.2 waves**, which measures at
>    3-9% and holds idle wall-wave drift at exactly zero (39/59/89/129/169).
> 4. **§5.4 says progress is driven from `upgrade_purchased`, but that event
>    carried no price.** `{ id, level, levelsGained }` cannot feed
>    `spend_gold`. `UpgradeManager` now emits `goldSpent` from both the single
>    and bulk paths.
> 5. **The AP channel §5.2 asks for already existed.** Part 3 added a
>    run-scoped `runApBonus` to `PrestigeManager` for flawless encounters.
>    Adding a second one would have been two scalars racing; making it one
>    shared scalar would have meant a contract restore silently erasing the
>    boss bonus, because both are *set* from their own saved block on load.
>    It is now keyed by source (`RunApSource = 'boss' | 'contract'`) and summed
>    at read, which is the only shape that survives two owners with two
>    ceilings and two persistence blocks.
> 6. **§5.5's "an unconsumed goal kind must not compile" is stronger if the
>    `Record` *is* the implementation.** `ACHIEVEMENT_REWARD_CONSUMERS` is a
>    `Record<union, string>` — a documentation table that can still name a
>    consumer that does nothing (which is why `content-coverage.test.ts` has to
>    check for placeholder strings). `CONTRACT_PROGRESS` is
>    `Record<ContractGoalKind, (contract, event) => number>`: the map that
>    enforces coverage is also the code that does the work, so there is nothing
>    to drift.
> 7. **`flawless_waves` needed no new mechanism.** Part 3's per-encounter
>    flawless flag is set at one site in the `tower_damaged` handler, *after*
>    the whole mitigation chain, so a hit the wall ate does not count. A wave
>    flag set at the same line is the generalisation; two sites would have been
>    two definitions of "flawless".
> 8. **§5.3's "under the milestone strip" needed the strip to move.** The
>    strip's collapsed chip already owned the bottom-left corner and expands
>    *upward* on hover, so the tracker takes the corner and the strip's
>    `bottom` is offset by `--contract-tracker-height`. Measured 89 px in
>    browser against an assumed 84 px — the var ships at 96 px so the strip has
>    clearance rather than resting on the top row.
> 9. **The tracker cannot flourish on `contract_completed`.** That event is
>    emitted by the manager *before* anything has been paid, and `UIManager`
>    subscribes before `Game` does, so the reward text was always a frame
>    behind. `Game` emits `contract_reward` after resolving the payout;
>    the tracker listens there. Found in-browser, not by a test.
> 10. **Contracts widen §4.5's idle-parity gap, and the metric is not
>     monotonic in contract income.** Gold denominated in waves of income
>     multiplies whatever gold advantage active play already has, so the table
>     moves from +33.9…+45.2% to +34.5…+49.5% — inside the +50% gate at every
>     tier, outside the preferred +25-40% band at three of five. Scaling every
>     `goldWaves` down by 0.6x was measured and made the 0-AP tier **worse**
>     (+51.1%), because the metric is composed DPS at one wave and the greedy
>     buyer crosses upgrade breakpoints in steps. Part 4's own conclusion still
>     stands: anything that needs a real cut here starts with
>     `MANUAL_AIM.fireRateMult`, not with the thing that was added last.
> 11. **A contract has no expiry and no reroll**, so a goal the player never
>     engages with holds its slot. Nothing jams today — mutators are offered on
>     every boss wave, abilities auto-cast, orbs drift home on their own — but
>     making any of those optional turns three of the ten goal kinds into dead
>     slots. Recorded in `docs/contract-system.md` under Known limits.
> 12. **§5.4 says "bump to v11". v11 was Part 3's**; contracts are **v12**.
>     Part 6's §6.3 says v12 and Part 7's §7.7 says v13 — both are now one
>     behind.

**Goal:** something to be doing between wave 12 and wave 47.

### 5.1 Model

- **3 contracts live at all times**, drawn from ~20 defs. Completing one immediately draws a
  replacement, so the tracker is never empty.
- Contracts are **run-scoped** and reset on ascend/transcend.
- Tiered by the player's current wave band so a wave-8 player never draws "kill a wave-60 boss".

```ts
export type ContractGoal =
  | { kind: 'kill_type'; type: EnemyType; count: number }
  | { kind: 'kill_count'; count: number }
  | { kind: 'clear_waves'; count: number }
  | { kind: 'flawless_waves'; count: number }      // no tower HP lost
  | { kind: 'boss_under'; seconds: number }
  | { kind: 'collect_orbs'; count: number }        // Part 4
  | { kind: 'cast_abilities'; count: number }
  | { kind: 'reach_wave'; wave: number }
  | { kind: 'survive_mutator'; waves: number }
  | { kind: 'spend_gold'; amount: number };

export interface ContractDef {
  id: string; name: string; goal: ContractGoal;
  minWave: number; weight: number;
  reward: { gold?: number; rerolls?: number; rp?: number; apBonusPct?: number };
}
```

### 5.2 Rewards

Keep them small and frequent rather than large and rare:
- `gold`: ~2 waves' income at the current wave (compute from `Game.estimateWaveGold`).
- `rerolls`: 1 (feeds the Part 1 draft).
- `rp`: 1–3.
- `apBonusPct`: +3% each, summed into `PrestigeManager.previewAP` — **cap the total at +50%** so
  contracts never dominate the prestige curve.

### 5.3 UI

- A compact **tracker** under the milestone strip: three rows, each `name — 12/40` with a progress
  bar. Completing one plays a small flourish and slides the replacement in.
- Full list + history in a **Contracts** section of the Progression tab.

### 5.4 Files

`src/data/contracts.ts` (new), `src/systems/ContractManager.ts` (new),
`src/ui/ContractTracker.ts` (new), `src/ui/ProgressionPanel.ts`, `src/game/Game.ts` (event
subscriptions drive progress — `enemy_killed`, `wave_cleared`, `boss_killed`, `ability_cast`,
`orb_collected`, `upgrade_purchased`), `src/systems/PrestigeManager.ts` (AP bonus),
`src/types.ts`, `src/systems/SaveManager.ts` (**bump to v11**), `docs/contract-system.md` (new),
`AGENTS.md`, `tests/`.

### 5.5 Verification

- Unit: every `ContractGoal` kind has a progress consumer (make it a `Record` over the union, the
  same trick `ACHIEVEMENT_REWARD_CONSUMERS` uses — an unconsumed goal kind must not compile);
  completion draws a replacement; `apBonusPct` caps at +50%; contracts reset on ascension.
- Save round-trip v10 → v11.

---

## Part 6 — Tower cores

> **Status: implemented (2026-08-21).** Corrections found during
> implementation, kept here so Part 7 doesn't repeat them:
> 1. **§6.3 says "bump to v12". v12 was Part 5's**; cores are **v13**. That is
>    the third consecutive part whose save version in the plan was wrong — §7.7
>    says v13 and is now one behind too. The ladder decides, not the plan.
> 2. **Every one of §6.1's five stat blocks needed moving once measured, and
>    four of them are the same mistake.** The follow-up's lesson — a payload
>    priced against *one shot* is not a constant — has a mirror image that cost
>    just as much here: a payload priced against one shot can also be *far too
>    strong*. `artillery`'s "-40% fire rate, +150% damage" is `0.6 x 2.5 = 1.5x`
>    sustained output before the splash is counted at all. Shipped at **+65%**,
>    which is throughput parity, so the splash *is* the core rather than a
>    garnish on a 50% damage buff. `frostwork` needed -18% rather than -15%,
>    because more shots pay the enemy's flat armour more often — the trade is
>    not symmetric even when the multipliers look like it.
> 3. **`marksman` is the one core nobody chooses, so it must not move the
>    curve.** §6.1's "+15% crit chance" measured as **+10 wall waves at 0
>    lifetime AP** (39 → 49). Every player has `marksman` by default; a buff with
>    no choice attached is not a core, it is a difficulty change wearing one, and
>    it is §0.1's "strictly better than not holding" in a different costume.
>    Shipped at **+6%**, the largest value that leaves the idle curve where Parts
>    2-5 left it at every tier. §6.4's "±15% of `marksman`'s wall-wave" only
>    means anything if `marksman` is the pre-existing baseline.
> 4. **§6.4's metric cannot resolve §6.4's requirement.** The wall quantises to
>    boss waves — steps of 10 on a base of ~40, a resolution of 25% — so a ±15%
>    band measured on it can only ever report 0% or ±20%, and cannot be *steered*
>    at all. `npm run sim` therefore prints three tables: the idle wall (the
>    drift check, zero for all five cores at all five tiers), the wall with the
>    draft running averaged over seven seeds (fractional, where ±15% is actually
>    decided — worst deviation -5.7%), and composed DPS vs `marksman` (continuous,
>    what the tuning was steered by).
> 5. **`arcane`'s proc is mana-limited, and that is a design property, not a
>    bug.** The drain is `fireRate / 5 x 3` and mana regen is not, so §6.1's -25%
>    base measured 7-16% *below* `marksman` — worst exactly where the player has
>    bought the most fire rate. Shipped at -18%, with Meditation as the player's
>    answer to the rest. `sim/model.ts` does not assume an uptime: it computes
>    one from the mana regen the greedy buyer actually decided to buy, which is
>    the same buyer that decides every other purchase. Given an unbounded budget
>    it buys exactly level 4 — precisely full uptime.
> 6. **A DPS-only model always says a defensive core is bad.** `bloodforge` sits
>    15-21% below `marksman` on composed DPS and level with it on the wall,
>    because the wall condition *is* "seconds survived once a wave overruns" —
>    which is exactly what more HP buys. `coreSurvivalMult` is **derived from the
>    shipping stat block**, not a per-core constant: a hand-set multiplier would
>    have meant re-tuning `maxHpPct` moved nothing in the table meant to be
>    measuring the re-tune.
> 7. **§6.2's "the selection is run-scoped" needs a third field to be
>    survivable.** Reset-to-`marksman` is the literal reading, and an
>    auto-ascending idle game reaches that reset several times an hour with
>    nobody watching — so a player who unlocked `bloodforge` at 15 AP would be
>    silently put back on the default every run. `CoreManager` carries
>    `unlocked` (permanent), `preferred` (permanent, set by the picker) and
>    `selected` (run-scoped, restored from `preferred`). The choice resets; the
>    *identity* does not.
> 8. **Three effects read `ctx.hpFraction` and nothing recomputed when HP
>    moved.** `hp_threshold_damage` (Part 1's evolution), the `last_stand`
>    blessing (§1.3) and `bloodforge`'s tempo step all armed at the *next*
>    resolve triggered by something else — a purchase, a buff edge, a wave clear.
>    For a comeback mechanic that is the wrong moment by definition, and it was
>    only visible in-browser. `Game.refreshHpThresholdStats` buckets against
>    `HP_STAT_THRESHOLDS` and resolves on a crossing; it fixed all three at once,
>    two of which predate this part.
> 9. **§6.2's `corePreference` was already plumbed and needed typing, not
>    building.** `BlessingDef.corePreference` was `Record<string, number>`; as
>    `Partial<Record<CoreId, number>>` a typo'd core id stops compiling. The
>    weight is one shared constant rather than a literal per card — a per-card
>    literal is how one of them quietly becomes 3x during a re-tune.
> 10. **Cores are an AP spend but must not be an AP perk.** They have no levels,
>    no prerequisites and no exclusivity, and `AP_PERKS` is a table the Prestige
>    panel renders row-by-row with a level counter and an effect value. Threading
>    a one-shot purchase through `perkCost` / `computePerkEffect` would have meant
>    every consumer of that table learning about a perk that has neither.
> 11. **Two other tables moved, both explicably.** §2.2b (wall with blessings) is
>    up 1.4-3.0 waves at every tier because `corePreference` is live now and
>    `marksman` favours four cards it did not before — the mechanic working, not
>    drift. §4.5's idle-parity figures moved because `marksman`'s +6% crit
>    changes which upgrade breakpoints the greedy buyer crosses first; still
>    inside the +50% hard gate at all five tiers, with one tier (10 K) at +19.0%,
>    below the preferred +25-40% band. That is the safe direction, and §5's
>    status note 10 already recorded this metric as stepwise and non-monotonic.
> 12. **Unrelated, found while wiring the sim:** `sim/balance.ts` printed
>    `Charged shot: undefinedx damage` — it still read `MANUAL_AIM.chargeDamageMult`,
>    which the follow-up replaced with `chargeDpsSeconds`. Fixed.
> 13. **§6.3's file list omits** `src/systems/CoreManager.ts` (the three
>    lifetimes have to live somewhere), `src/systems/AbilityManager.ts`
>    (`nova_extended`), `src/ui/UIManager.ts` and `src/main.ts` (the picker
>    chain), `src/data/blessings.ts` (`corePreference` typing), `sim/model.ts`
>    and `sim/balance.ts` — the last two are not optional, since §6.4's table is
>    the gate.

**Goal:** a run identity chosen up front that changes *how* the tower shoots, so blessings have
something to build on top of.

### 6.1 The five cores

| Core | Unlock | Stats | Shot behavior |
|---|---|---|---|
| `marksman` | default | +15% crit chance, +20% range | Baseline single shot |
| `artillery` | 5 AP | −40% fire rate, +150% damage | Every shot splashes 70 px for 50% |
| `frostwork` | 10 AP | +25% fire rate, −20% damage | Hits chill (−25% speed, 2 s); Frost Nova duration ×2 |
| `bloodforge` | 15 AP | +60% max HP, +8% lifesteal, −20% gold | Kills heal 1% max HP; below 50% HP, +40% fire rate |
| `arcane` | 25 AP | +100% mana regen, +50% ability damage, −25% base damage | Every 5th shot costs 3 mana and deals magic damage at 250% |

### 6.2 Rules

- Chosen at run start (the `RunSummaryModal`'s "Begin new run" CTA becomes a core picker once more
  than one is unlocked). Before the first ascension the player is on `marksman` and the picker
  never appears — do not put a choice in front of a new player who has no information.
- Cores are bought with **AP** and persist; the *selection* is run-scoped.
- Implemented as a `StatContext.core` field plus `src/stats/contributors/core.ts` (exhaustive
  switch over a closed `CoreId` union) and behavior flags read the way blessing behaviors are.
- Blessing offers respect `corePreference` (Part 1's `BlessingDef`) — `bl_frost` weights up for
  `frostwork`, `bl_mortar` for `artillery`, `bl_arcane` for `arcane`. Weight multiplier **1.5×**,
  never exclusive; cross-core builds must stay discoverable.

### 6.3 Files

`src/data/cores.ts` (new), `src/stats/contributors/core.ts` (new), `src/stats/context.ts`,
`src/systems/PrestigeManager.ts` (core unlocks as an AP spend), `src/ui/CorePickerModal.ts` (new),
`src/ui/RunSummaryModal.ts`, `src/ui/PrestigePanel.ts`, `src/game/Game.ts`,
`src/systems/ProjectileManager.ts`, `src/types.ts`, `src/systems/SaveManager.ts` (**bump to v12**),
`docs/core-system.md` (new), `AGENTS.md`, `tests/`.

### 6.4 Verification

- Unit: each core's stat block resolves to pinned values; the shot behavior fires (artillery splash
  hits N enemies, arcane's 5th shot spends mana and lands as magic); core selection survives a save
  round-trip; unlocking is gated on AP.
- `npm run sim`: each core should land within **±15%** of `marksman`'s wall-wave. A core that is
  strictly better is not a choice.

---

## Part 7 — Pacing and moment-to-moment

> **Status: implemented (2026-08-21).** Corrections found during
> implementation:
> 1. **§7.7 says "bump to v13". v13 was Part 6's**; pacing is **v14**. That is
>    the *fourth consecutive part* whose save version in the plan was wrong. The
>    number in a plan written before the parts were implemented is a guess about
>    how many bumps will happen first, and it has been wrong every time it has
>    been checked. See the retrospective below — this is the pattern with the
>    highest hit rate in the whole document.
> 2. **§7.1's "+3%/second capped at +40%" is about four times what the curve can
>    pay for**, and the reason is the one Part 4's follow-up recorded: §4.5's
>    active-play budget was already spent before Part 7 opened. Momentum is a
>    flat multiplier on an active run's gold, so at +40% the measured active
>    advantage was **+60…+69% at every tier** against a +50% hard gate. Shipped
>    at **1%/second capped at +6%**, cut proportionally rather than by capping
>    alone — the cap has to sit a few calls above one call's worth or momentum
>    stops being a streak and becomes a button that is either pressed or not.
>    There is also a reward the §4.5 metric cannot see, and it argues for the
>    smaller number: calling a wave early *is* a throughput gain (five seconds
>    off a forty-second cycle is ~12% more waves per hour), and the metric is
>    composed DPS at a matched wave, which credits none of it.
> 3. **§7.2's combo is not an active-play reward, and that is the whole balance
>    problem.** Nothing the player *does* builds it — the tower builds it by
>    killing things — so it is a **baseline income faucet** on every run, idle
>    included. §7.2's only stated compensation (reduce `kill_streak_gold`
>    "proportionally") cannot pay for it: that evolution is a level-25 unlock on
>    one economy upgrade, while the combo pays from wave 1. Integrated over a
>    50-enemy wave the plan's 5/12/25/40 is worth **+8.0% of that wave's entire
>    income**, and it moved the 0-AP idle wall a full boss decade (39 → 49) on
>    six of eight draft seeds. Shipped at roughly half — **3/6/12/20** — which is
>    +4.1% and holds the drift. Avarice still took its cut, derived rather than
>    guessed: `(2.45 - 0.12) / 49 = 0.0476`, rounded down to **+4.7%/kill**.
> 4. **The 0-AP wall is a knife edge, and every previous part's "drift zero" was
>    partly luck.** +5% gold *or* +5% damage moves it from 39 to 49, because 39
>    sits just short of a boss decade. One draft seed of eight already reports 49
>    with Part 7 switched off entirely. `tiersTable(false)` reports seed 0, which
>    is why the tables have always looked clean. Anyone tuning against this
>    number should sweep seeds, not trust the printed one.
> 5. **§7.3's preview is only worth having if it is *true*, and that needed a
>    refactor §7.3 does not mention.** Rolling the composition from the weight
>    table gives an expectation the dice may not honour, and a preview the wave
>    contradicts teaches the player to ignore it. `WaveManager` now rolls the
>    whole roster — types, spawn points, elite rolls, auras — when the
>    intermission opens (`planNextWave`) and `spawnOne` pops from it. Same dice,
>    earlier. Two paths need care: a mutator chosen from the boss-wave offer
>    changes the count *after* the plan was made (the plan is discarded, not
>    stretched), and a save restored mid-spawn has no plan at all (the queue
>    refills lazily, which is exactly the old behaviour).
> 6. **The lane markers needed a cap, found only in browser.** One marker per
>    distinct spawn point produced *nineteen* arrows on a 43-enemy wave, which
>    rings the arena in noise rather than telling the player where to look.
>    Clustered at 150 px and capped at 8.
> 7. **§7.4's risk dial must not be a `RunApSource`.** Part 3 and Part 5 share a
>    banked run-AP pool with a +50% ceiling, both *set* from their own saved
>    block on load. Risk is a live setting with no ceiling of its own that stops
>    applying the moment the dial returns to 0; summing it into that pool would
>    have let the contract cap swallow it and a contract restore overwrite it.
>    It is its own scalar, multiplied in.
> 8. **§7.1's momentum has the `hpFraction` shape Part 6 found**, as the brief
>    predicted, and so do the combo tier and the risk dial. All three are read by
>    a contributor and all three are discrete, so `Game.refreshPacingStats`
>    compares one signature per substep — the same trick as
>    `refreshHpThresholdStats`. Without it a combo tier reached at kill 25 starts
>    paying at the next purchase, which for a mechanic whose entire point is
>    immediacy is the wrong moment by definition. The `wave_started` handler also
>    calls it directly, so a wave's first spawn already carries the risk dial's
>    HP multiplier rather than getting it a substep late.
> 9. **`EnemyManager`'s enemy-multiplier setters were named for blessings.**
>    §7.4's dial resolves into the same `enemyHpMult` / `enemySpeedMult` keys, so
>    `setBlessingHpMult` became `setStatHpMult` (and the other two likewise).
>    A channel named after one of its two callers is a lie the next person goes
>    looking for.
> 10. **§7.8's "risk 0 reproduces the curve" is answerable; "is risk 5 a choice"
>     is not, with the same metric.** The idle wall does not move at *any* risk
>     level — the wall quantises to boss waves, a resolution of 25% on a base of
>     ~40. `npm run sim` therefore prints two risk tables: the integer idle wall
>     (the leak check, where coarseness is a feature) and the draft-averaged wall
>     over seven seeds plus AP-per-run (where the trade is actually visible).
>     Risk 5 costs 1.5% of wall depth for +34% AP per run — and the model has no
>     positions and no tower HP, so the entire cost of +40% enemy speed is
>     invisible to it. In browser at risk 3, a tower that comfortably held wave
>     30 died on it.
> 11. **§7.7's file list omits** `src/data/pacing.ts`, `src/systems/PacingManager.ts`,
>     `src/stats/contributors/pacing.ts`, `src/ui/PacingOverlay.ts`,
>     `src/stats/context.ts`, `src/stats/keys.ts`, `src/stats/resolve.ts`,
>     `src/systems/ProjectileManager.ts` (§7.5 lives there),
>     `src/systems/PrestigeManager.ts` (§7.4's AP), `src/ui/UIManager.ts`,
>     `src/data/upgrades.ts` (§7.2's own compensation), `sim/model.ts` and
>     `sim/balance.ts` — the last two are not optional, since §7.8's table is the
>     gate.
> 12. **Unrelated, found while testing.** `KeybindsOverlay` still advertised
>     manual aim as "30% faster", which the Part 4 follow-up removed. Fixed.
>     And a headless `WaveManager` test needs `resumeSpawning()` after *every*
>     `startWave`, not just on boss waves: an ordinary wave rolls a 4% mutator
>     offer that pauses spawning until a modal that does not exist closes it.
>     Part 3 found this as a 4%-per-run flake in `enemies.test.ts`; it reappeared
>     here as a 3-in-8 flake because Part 7's tests each start several waves.
> 13. **Measured after the change** — every §4.5 tier inside the preferred
>     +25-40% band for the first time since Part 4, including the 10 K tier
>     Part 6 left at +19.0%:
>
>     | Lifetime AP | Wall (idle) | Wall (active) | Active advantage |
>     |---|---:|---:|---:|
>     | 0 | 39 | 49 | +33.3% |
>     | 100 | 59 | 69 | +33.0% |
>     | 1 K | 89 | 89 | +32.2% |
>     | 10 K | 129 | 129 | +38.1% |
>     | 100 K | 169 | 169 | +30.0% |
>
>     Idle wall-wave drift is zero at every tier. §2.2b moved -1.4 waves at the
>     two deepest tiers, explicably: `BEHAVIOR_DPS_CREDIT.overkill_carry` dropped
>     from 0.03 to 0.018 because the baseline now carries the other 0.012, so the
>     draft orders that card slightly differently.

Seven small changes that together remove the dead air.

### 7.1 Call the wave early

- During intermission, `Space` (and a HUD button) starts the next wave immediately.
- Every second skipped grants **+3% gold on that wave**, capped at **+40%**.
- The bonus stacks into a **momentum counter** that persists while consecutive waves are called
  early, and resets when the tower takes damage or a wave runs its full intermission.

This makes attention pay, speeds up the active experience, and leaves the idle experience exactly
as it is.

### 7.2 Combo meter

- Kills within **2 s** of each other build a combo. Tiers at 10 / 25 / 50 / 100 grant
  **+5% / +12% / +25% / +40% gold and XP**.
- Displayed as a HUD meter that drains visibly — this is the readout the game currently lacks
  entirely.
- The existing `kill_streak_gold` evolution stacks on top rather than being replaced (reduce its
  per-kill value proportionally so the combined ceiling is unchanged).

### 7.3 Next-wave threat preview

During intermission, show the composition of the coming wave: `12 enemies · 3 Siege · 1 Elite
(Haste) · BOSS`. Draw spawn-edge markers on the canvas for the lanes that will be used. This turns
the intermission from a countdown into a preparation window — and it is what makes the targeting
selector (Part 2) and pre-cast abilities meaningful.

### 7.4 Risk dial

Generalize the mutator concept: a persistent **Risk** setting (0–5) in the HUD.
- Each step: **+18% enemy HP, +8% enemy speed** → **+25% gold, +10% AP**.
- Changing it takes effect at the next wave.
- Wave mutators continue to work on top; risk is the always-on dial, mutators are the spikes.

This gives a player who has outscaled the content a way to make it interesting again, without
waiting for prestige.

### 7.5 Overkill carry

10% of a killing blow's excess damage carries to the nearest other enemy (the `overkill_carry`
blessing raises it to 25%). Big crits should visibly matter.

### 7.6 Intermission length responds to play

Intermission drops from 5 s to **3 s** once the player is past wave 20 and to **2 s** past wave 50
(`intermissionMultiplier` already exists as a stat — route it through that rather than adding a
new mechanism).

### 7.7 Files

`src/systems/WaveManager.ts`, `src/game/Game.ts`, `src/ui/HUD.ts`, `src/game/Renderer.ts`,
`src/main.ts` (Space binding), `src/ui/KeybindsOverlay.ts`, `src/data/formulas.ts`,
`src/systems/EnemyManager.ts`, `src/types.ts`, `src/systems/SaveManager.ts` (**bump to v13** for
risk + momentum), `docs/wave-system.md`, `docs/ui-system.md`, `AGENTS.md`, `tests/`.

### 7.8 Verification

- Unit: early-call bonus caps at +40%; momentum resets on damage; combo decays on the simulation
  clock; risk multipliers apply to both HP and reward; overkill never carries to a dead enemy.
- `npm run sim`: risk 0 must reproduce the current curve **exactly**. If it doesn't, the dial has
  leaked into the baseline.

---

## 2. Cross-cutting rules for every part

1. **The idle contract is not negotiable.** Every active verb has an automatic fallback that pays
   less. Nothing blocks on a modal forever. Nothing requires clicking to progress.
2. **Use the stat pipeline.** No system writes `TowerState`. New stats go through
   `StatKey` + a contributor; new time-varying effects go through `BuffRegistry`. See
   `docs/stat-pipeline.md`.
3. **Closed unions with exhaustive switches.** Every new content union (`BlessingStat`,
   `BlessingBehavior`, `ContractGoal['kind']`, `CoreId`, boss patterns) gets a `never` default or a
   `Record` over the union, so content nothing consumes is a compile error. This is the mechanism
   that killed the last plan's twenty inert talents; do not break it.
4. **Simulation vs. presentation.** Anything time-integrated or cadence-driven belongs in
   `Game.simulate` (fixed substeps). Particles, UI and polling belong in `frameUpdate`. Getting
   this wrong shows up as behavior that changes at 6.5× speed.
5. **Save migrations are additive.** Bump `SAVE_VERSION`, add a `migrateVNtoVN+1`, add the version
   to the accepted list in `validate()`, and add a round-trip test. Never drop a field.
6. **Performance.** New per-frame loops use `EnemyManager.queryRadius`, the renderer sprite cache
   and the effect pools. Anything drawn per enemy per frame must not allocate.
7. **Docs are part of the change.** Each part adds or updates its `docs/*.md` page and the content
   table in `AGENTS.md`.
8. **Every part ends green:** `npm run typecheck && npm run test && npm run checks`, plus
   `npm run sim` when the part touches balance.

> **Note on the GitNexus instructions in `CLAUDE.md`:** the MCP server and the
> `.claude/skills/gitnexus/` files it references are not present in this checkout (`.claude/`
> contains only `launch.json`), so `impact()` / `detect_changes()` cannot be run. The substitute is
> the type system and the test suite: the closed-union rule in (3) is what makes blast radius
> visible here, and `npm run typecheck && npm run test && npm run checks` is the gate before every
> commit.

---

## 3. Order and expected effect

| # | Part | Effort | What the player notices |
|---:|---|---|---|
| 1 | Blessings | L | "This run is a ricochet run." Runs stop being interchangeable. |
| 2 | Enemy behaviors | L | Wave composition starts mattering; targeting becomes a decision. |
| 3 | Boss encounters | M | Boss waves become events with a readable state. |
| 4 | Active verbs | M | There is something to do with the mouse that pays. |
| 5 | Contracts | S | The mid-run has direction. |
| 6 | Tower cores | M | Runs have an identity before the first blessing lands. |
| 7 | Pacing | S | No dead air; attention is rewarded second-to-second. |

Parts 1–3 are where the fun is. If only three ship, ship those.

---

## Follow-up — manual aim replaced by the charge (2026-08-20)

Part 4 shipped the charged shot *alongside* manual aim's pre-existing flat `x1.3` fire rate,
because the brief it was given said to keep the latter. Its §4.5 measurement then showed why
§4.2 had said **replace**, not add: with the charged shot switched off entirely, manual aim plus
orb clicking already measured **+33.9…+38.9%** — the whole active-play budget, spent on a bonus
that requires nothing of the player but that the button be held down. That is §0.1's diagnosis
exactly: strictly better than not holding, therefore not a choice.

Resolved by the plan's original intent, on the user's call:

1. **`MANUAL_AIM.fireRateMult` is gone**, along with the `BUFF_MANUAL_AIM` registry entry.
   Holding aims and nothing else. Because holding also forfeits auto-acquisition, a player who
   holds and never releases a charge is now *worse* off than one who never touches the mouse —
   which is what makes it a trade.
2. **The charged shot was re-priced in seconds of the tower's own sustained fire**
   (`chargeDpsSeconds`), replacing the flat per-shot multiple. This is the more interesting half
   of the fix. A flat multiple of one shot is worth `1/fireRate` of the tower's output, so a
   single constant measured **+57% at 1.8 shots/s and +10% at 6.1** — the verb decayed into
   irrelevance precisely where the player has the most fire rate to surrender by holding still.
   No value of a flat multiplier lands inside the band at every tier; the sweep at 1x/3x/4x/6x/8x
   confirmed it. Denominating the payload in DPS-seconds holds its worth flat.
3. Tuned to `chargeDpsSeconds: 0.9`.

Measured after the change — every tier inside the +25–40% band for the first time:

| Lifetime AP | Wall (idle) | Wall (active) | Active advantage | shots/s |
|---|---:|---:|---:|---:|
| 0 | 39 | 49 | **+34.7%** | 1.84 |
| 100 | 59 | 59 | **+28.6%** | 2.44 |
| 1 K | 89 | 89 | **+36.0%** | 3.46 |
| 10 K | 129 | 129 | **+28.9%** | 4.72 |
| 100 K | 169 | 169 | **+27.3%** | 6.10 |

Idle wall-waves are unchanged at every tier, as they have been through Parts 2–5.

**The general lesson, for Parts 6–7 and beyond:** a bonus denominated in *one shot* is not a
constant — it is a quantity that shrinks against every fire-rate purchase the player will ever
make. Any future active-play or burst mechanic should be priced against the tower's throughput,
not against one of its shots.

---

## Plan retrospective (2026-08-21, after all seven parts)

Written at the end, for whoever writes or implements the next plan. Every
pattern below cost real time at least twice.

### 1. A save version written in a plan is a guess, and it was wrong four times

§5.4 said v11, §6.3 said v12, §7.7 said v13. The actual numbers were 12, 13, 14.
Part 3 needed a bump the plan never mentioned at all, which is what put every
later number one behind, and each part then found its own number stale and
recorded a note saying so — four consecutive times.

The number in a plan is a prediction of how many bumps will land first, and that
prediction is worthless the moment any part needs an unplanned one.
**Write "bump `SAVE_VERSION`" and stop. The ladder decides.** The same applies
to any plan-stated identifier that is really a running count.

### 2. Price a bonus against throughput, never against one shot or one kill

Part 4 shipped a charged shot at "6x damage" and measured +127% against a +50%
gate; the follow-up found that no flat multiple of one shot lands inside the
band at every tier, because such a bonus is worth `1/fireRate` of the tower's
output and decays against every fire-rate purchase. Part 6 hit the mirror image:
`artillery`'s "-40% fire rate, +150% damage" is `1.5x` sustained output before
the splash is counted, and four of its five stat blocks were mispriced the same
way.

Part 7 was warned and still had to cut two values, but for a *different* reason
each time, which is the useful part:

- **§7.1's momentum** was correctly denominated (gold %, not per shot) and still
  four times too big, because the budget it draws on — §4.5's active-play band —
  was already spent by Part 4. Correct units, no headroom.
- **§7.2's combo** was correctly denominated *and* had headroom, but was
  misclassified: the plan treats it as an attention reward when nothing the
  player does builds it. It is baseline income wearing a skill meter.

So the rule generalises. **Before tuning a number, ask two questions: what is it
denominated in, and whose budget does it spend?** A bonus in the wrong units
cannot be tuned. A bonus in the right units drawing on a spent budget cannot be
afforded. A bonus the player does not earn is not an active-play bonus at all,
whatever the UI says.

### 3. "It composes" is a claim the type system cannot check, and it broke twice

Part 6 found three effects reading `ctx.hpFraction` where **nothing recomputed
when HP moved**: they armed at the next resolve triggered by something else.
Part 7 had the identical shape in three more places (risk, momentum, combo tier)
and only avoided it because Part 6 had written the fix down.

The shape: **a contributor reads live state, and no one told the pipeline the
state changed.** It is invisible to `tsc` (the field is read), invisible to the
tests (the value is eventually right), and only visible in browser at the moment
it matters. Both fixes are the same — bucket or hash the live inputs, compare
once per substep, resolve on a change (`refreshHpThresholdStats`,
`refreshPacingStats`).

**If you add a `StatContext` field that is not a snapshot of a manager's
settled state, you owe it a restate trigger.** Grep for the field name; if the
only hits are the contributor and `buildStatContext`, the bug is there.

### 4. Closed unions carried the whole plan; keep paying for them

Cross-cutting rule 3 is the single highest-value line in this document.
`BlessingStat`, `BlessingBehavior`, `CoreId`, `BossPattern`, `EnemyType`,
`ContractGoalKind`, `ENEMY_THREAT_CLASS` — not one piece of inert content
shipped across seven parts, in a codebase whose *previous* plan existed largely
to delete twenty talents that did nothing.

Part 5 found the sharpening: **make the `Record` the implementation, not a
documentation table.** `ACHIEVEMENT_REWARD_CONSUMERS` maps a union to a *string*
naming its consumer, so it can name one that does nothing, and
`content-coverage.test.ts` has to check for placeholder strings.
`CONTRACT_PROGRESS` maps the union to the function that does the work, so there
is nothing to drift. Prefer the second shape.

### 5. The balance model must be extended by the part that changes balance

Every part that skipped this got caught. Part 2 found the spawn-weight table
hand-copied in three places, so a re-weighting could land in the game and not in
the model measuring it. Part 4's file list omitted `sim/model.ts` and
`sim/balance.ts`, and its gate lived there. Part 5 and Part 6 both had to teach
the model a mechanic before they could tune it.

The discipline that worked: **the model imports the real tables and drives the
real managers.** `BlessingManager`, `ContractManager` and `CoreManager` all run
inside `simulateRun`, so the offer rules, the +50% cap and the pick cadence are
the shipping ones. Where a second copy of a number was unavoidable it was
*derived* from the shipping constant (`coreSurvivalMult` from the core's own
stat block, `OVERKILL_BASE_DPS_CREDIT` from the blessing's credit) rather than
hand-set, so a re-tune moves the table that is meant to be measuring it.

### 6. Know which question your metric can answer

The wall wave quantises to boss waves: steps of 10 on a base of ~40, a
resolution of 25%. Part 6 discovered that §6.4's "±15% of `marksman`" *cannot be
steered* by it, and Part 7 that §7.8's "is risk 5 a choice" cannot either. Both
ended up printing two tables — the coarse integer wall as a **leak check**,
where coarseness is a feature, and a draft-averaged fractional wall over seven
seeds as the **tuning metric**.

Part 5 added the other half: §4.5's idle parity is *stepwise and non-monotonic*,
because the greedy buyer crosses upgrade breakpoints in jumps. Scaling contract
gold down by 0.6x made one tier **worse**. Do not bisect against it expecting
monotonicity, and do not read a ten-point move as a ten-point change.

And Part 7 found the sting in the tail: **the 0-AP wall sits within 5% of a
boss-wave boundary.** +5% of anything moves it a full decade, and one draft seed
of eight already reports the far side of the boundary with Part 7 switched off.
Every part's "drift zero" at that tier was, in part, the default seed's luck.
Sweep seeds.

### 7. Several bugs were only ever visible in a browser

A representative list, because it argues for the last ten minutes of every part:

- the boss bar tracked the wrong boss, so the slam telegraph — the most
  time-critical thing in Part 3 — never surfaced (§3, note 7);
- the contract tracker flourished a frame before the reward existed (§5, note 9);
- the contract tracker's height was 89 px against an assumed 84 (§5, note 8);
- three HP-gated effects armed at the wrong moment (§6, note 8);
- nineteen spawn-lane arrows rang the arena in noise (§7, note 6);
- `docs/ability-system.md` listed the wrong hotkey for six of nine abilities,
  which cost a browser run to notice (§4, note 9).

None of these is expressible as a unit test without first knowing it exists.

### 8. What the plan got right

Worth recording, because the failure modes above are all local corrections to a
structure that held:

- **The ordering was correct.** Part 1 gives the player something to decide,
  2-3 give them something to decide about, 4 gives their hands something to do,
  5-7 tighten the loop. Every part genuinely depended on its predecessors —
  Part 7's threat preview is only meaningful because Part 2's roster asks
  different questions, and Part 4's orbs are only worth clicking because Part 1
  can turn them into rerolls.
- **The diagnosis in §0 was accurate and the fixes landed on it.** §0.1's "the
  only in-combat verb is hold the mouse" was still true after Part 4 shipped —
  the follow-up had to remove manual aim's flat bonus to actually fix it, which
  is what §4.2 had said in the first place.
- **The idle contract survived all seven parts.** 39/59/89/129/169 at every
  tier, unbroken from Part 2 to Part 7.
- **The per-part status blocks were the highest-leverage thing in the file.**
  Parts 5, 6 and 7 each avoided a bug because an earlier part had written down
  what bit it. Keep doing this; a plan that is not amended as it is implemented
  is a plan that lies about the codebase within a week.
