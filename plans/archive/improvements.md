# Improvements — Journal permanence, the RP faucet, automation, tooltips and abilities

**Goal:** six independent defects and gaps reported from play, fixed in one pass:

1. The Long Watch (Journal) loses its chapters and counters — it must be permanent across ascension, transcendence *and* app restart — and the campaign stops at wave 200 with nothing for the transcendence-era player.
2. Research Points arrive far faster than the research tree is priced for, so RP cost stops being a decision and research *time* becomes the only gate. Loot Insights makes this worse rather than better.
3. Auto-Upgrader buys an unbounded number of upgrades per tick. It must buy exactly one per tick at level 1, and gain one extra purchase per level, to a maximum of three.
4. The Automation block lives at the bottom of the Transcendence tab where nobody finds it, and its copy never says which perk unlocks which toggle.
5. The Stats popup's `?` tooltip prints raw engine identifiers (`rpDropChanceBonus`) where the Codex prints friendly names, and it does not share the Codex's detail styling.
6. Ability mana costs grow ~2.4× from level 1 to max while the abilities' power grows ~1.5–2.6×, so levelling an ability makes it *worse* per mana. Ability tooltips also omit most of what each ability actually does.

**Related components:** `src/data/watch.ts`, `src/data/research.ts`, `src/data/enemies.ts`, `src/data/prestige.ts`, `src/data/passiveAbilities.ts`, `src/data/abilities.ts`, `src/data/pacing.ts`, `src/systems/WatchManager.ts`, `src/systems/ResearchTree.ts`, `src/systems/EnemyManager.ts`, `src/systems/AutomationManager.ts`, `src/systems/PrestigeManager.ts`, `src/systems/AbilityManager.ts`, `src/systems/SaveManager.ts`, `src/game/Game.ts`, `src/ui/UIManager.ts`, `src/ui/TranscendencePanel.ts`, `src/ui/AutomationPanel.ts` (new), `src/ui/codexProse.ts` (new), `src/ui/CodexPanel.ts`, `src/ui/StatsPopup.ts`, `src/ui/abilityFormat.ts`, `src/ui/navGroups.ts`, `src/types.ts`, `src/styles/main.css`, `tests/*`, `sim/checks.ts`, `docs/*`, `AGENTS.md`.

**Tech stack:** TypeScript, Vite, Vitest, the in-repo balance simulator (`npm run sim`, `npm run checks`).

**Status:** planning only. Every constant below is given with the arithmetic that produced it, so it can be typed in as written. §12 lists the dials if a number needs a nudge after playtesting.

**How to read this document:** §0 is a blocking prerequisite. §1–§7 are the six changes, one section each, each self-contained. §8 is persistence, §9 tests, §10 docs, §11 the task order and the verification checklist, §12 the tuning levers.

---

## 0. Prerequisite: resolve the working tree's merge conflicts

`git status` reports two files in the `UU` (both-modified, unresolved) state:

```
UU src/styles/main.css
UU src/ui/UIManager.ts
```

`src/ui/UIManager.ts` currently contains literal `<<<<<<< Updated upstream` / `=======` / `>>>>>>> Stashed changes` markers at (at least) lines 1, 21, 49, 281, 746, 1081, 1090. **The project does not compile in this state**, so `npm run typecheck` and `npm test` will fail before any of the work below is started.

Resolve both files *first*, keeping the **`Updated upstream`** side everywhere — it is the newer tree (it has `CodexPanel`, `EnemyWatchLine`, the `journal` tab case, `mobileSheetTab`, and the `updatePanel(tab, state)` refactor that the `Stashed changes` side predates). Then:

```bash
npm run typecheck && npm test
```

Both must pass before starting §1. Do not begin any other task in this plan until they do.

---

## 1. The Long Watch: permanence, and eight more chapters

### 1.1 The bug: `watch` is saved but never restored

`SaveManager.snapshot` writes the block (`src/systems/SaveManager.ts:940`, `snapshotWatch` at `:1033`), `validate`/`normalizeWatch` repair it on load (`:839`), and `PersistentState.watch?: WatchState` declares it (`:159`).

`Game.applyPersistedState` (`src/game/Game.ts:5032`–`5218`) **never reads `persisted.watch`.** Grep proves it: the only writes to `state.watch` anywhere are the counter increments (`Game.ts:1562, 2303, 4693, 4766`) and `defaultWatch()` inside `SaveManager`. `applyWatchUnlocksOnLoad()` (`Game.ts:5198`) then calls `watchMgr.rebuildUnlocks()` against `this.state.watch`, which at that moment is still the *fresh* block built by the default-state factory.

Consequence: every completed chapter and every one of the seven `WatchCounters` is discarded on **every load** — which the player experiences as "the Journal resets when I prestige", because ascension and transcendence both call `saveMgr.save(state)` and the next app start (or Android process restart, or browser reload) reads the save back.

**Fix.** Insert this block into `applyPersistedState`, immediately **before** the `this.applyWatchUnlocksOnLoad();` call at `Game.ts:5198` (it must run before the rebuild, because the rebuild reads `completed`):

```ts
    // v19+: The Long Watch is permanent state (`WatchState` in types.ts is
    // explicit that neither reset may touch it), and it is saved — but it was
    // never restored, so every load silently wiped the campaign. Copied field
    // by field rather than assigned, because `WatchManager` captured
    // `this.state.watch` by reference in its `state:` dep at construction time
    // and replacing the object would leave the manager reading a detached one.
    const savedWatch = persisted.watch;
    if (savedWatch) {
      const w = this.state.watch;
      w.completed.length = 0;
      for (const id of savedWatch.completed ?? []) w.completed.push(id);
      const c = w.counters;
      const sc = savedWatch.counters;
      for (const k of Object.keys(c.killsByType)) {
        delete c.killsByType[k as EnemyType];
      }
      for (const [type, count] of Object.entries(sc.killsByType ?? {})) {
        c.killsByType[type as EnemyType] = count as number;
      }
      c.flawlessWaves = sc.flawlessWaves ?? 0;
      c.swiftBosses = sc.swiftBosses ?? 0;
      c.contractsDone = sc.contractsDone ?? 0;
      c.blessingPicks = sc.blessingPicks ?? 0;
      c.mutatorWaves = sc.mutatorWaves ?? 0;
      c.riskWaves.length = 0;
      for (let i = 0; i <= MAX_RISK_CEILING; i++) {
        c.riskWaves.push(sc.riskWaves?.[i] ?? 0);
      }
    }
```

`MAX_RISK_CEILING` is already imported in `Game.ts` if `clampRisk` is (check the import block near `Game.ts:128`); if not, add it to the `../data/pacing` import. `EnemyType` is already imported.

### 1.2 Audit: everything a chapter reads is already lifetime

The remaining nine `WatchMetrics` fields are read-throughs into `state.stats` and `state.towerXp` (`Game.watchMetrics`, `Game.ts:4801`). Verify — do not change — that none of these is reset by `applySavedStateReset` (`Game.ts:4280`) or `applyFullTranscendenceReset` (`Game.ts:5013`):

| Metric | Source | Reset on ascend? | Reset on transcend? |
|---|---|---|---|
| `highestWave` | `stats.lifetimeHighestWave` | no | no |
| `kills` | `stats.enemiesKilled` | no | no |
| `bosses` | `stats.bossesKilled` | no | no |
| `goldEarned` | `stats.goldEarned` | no | no |
| `ascensions` | `stats.lifetimeAscensions` | no | no (`stats.ascensions` *is* reset — do not switch to it) |
| `transcendences` | `stats.transcendences` | no | no |
| `abilitiesCast` | `stats.abilitiesCast` | no | no |
| `upgradesBought` | `stats.totalUpgradesPurchased` | no | no |
| `towerLevel` | `state.towerXp.level` | no | no |

This table is correct in the shipping code; it exists so the implementer does not "fix" a second thing that is not broken. The **only** defect is §1.1.

### 1.3 Eight new chapters (13–20)

Append these to `WATCH_CHAPTERS` in `src/data/watch.ts`, after `wc_long_watch`. `number` must equal index + 1 (so 13…20), each chapter must have **exactly three** goals, the first goal must be `reach_wave`, and `reach_wave` targets must strictly ascend (chapter 12 is at 200).

```ts
  {
    id: 'wc_quiet_archive', number: 13, name: 'The Quiet Archive',
    flavour: 'Everything you learned is written down. Nothing that wrote it survives.',
    icon: 'book-pile', color: '#9b59ff',
    goals: [
      { kind: 'reach_wave', wave: 220 },
      { kind: 'transcendences', count: 10 },
      { kind: 'upgrades_bought', count: 25_000 },
    ],
    reward: 'archivist',
  },
  {
    id: 'wc_hollow_crown', number: 14, name: 'Hollow Crown',
    flavour: 'They keep sending kings. You keep sending them back.',
    icon: 'crowned-skull', color: '#c0392b',
    goals: [
      { kind: 'reach_wave', wave: 240 },
      { kind: 'bosses', count: 400 },
      { kind: 'swift_bosses', count: 150 },
    ],
    reward: 'crown_of_thorns',
  },
  {
    id: 'wc_long_ledger', number: 15, name: 'The Long Ledger',
    flavour: 'Count it twice. The second count is the one the tower is built on.',
    icon: 'money-stack', color: '#f1c40f',
    goals: [
      { kind: 'reach_wave', wave: 265 },
      { kind: 'gold_earned', amount: 1_000_000_000_000 },
      { kind: 'contracts_done', count: 500 },
    ],
    reward: 'counting_house',
  },
  {
    id: 'wc_ash_and_ember', number: 16, name: 'Ash and Ember',
    flavour: 'The field never cools now. That is one way to measure a war.',
    icon: 'fire-bowl', color: '#ff7a1a',
    goals: [
      { kind: 'reach_wave', wave: 290 },
      { kind: 'kills', count: 25_000_000 },
      { kind: 'mutator_waves', count: 400 },
    ],
    reward: 'emberforge',
  },
  {
    id: 'wc_cycles', number: 17, name: 'Cycles',
    flavour: 'You have given everything away so many times it has started coming back.',
    icon: 'clockwork', color: '#5b8def',
    goals: [
      { kind: 'reach_wave', wave: 320 },
      { kind: 'ascensions', count: 250 },
      { kind: 'transcendences', count: 25 },
    ],
    reward: 'eternal_kit',
  },
  {
    id: 'wc_wider_board', number: 18, name: 'The Wider Board',
    flavour: 'More work than one watch can hold, which is why there are more of you now.',
    icon: 'treasure-map', color: '#3ec46d',
    goals: [
      { kind: 'reach_wave', wave: 350 },
      { kind: 'contracts_done', count: 1_200 },
      { kind: 'blessing_picks', count: 800 },
    ],
    reward: 'master_broker',
  },
  {
    id: 'wc_starfall', number: 19, name: 'Starfall',
    flavour: 'The sky has run out of things to throw. You have not run out of answers.',
    icon: 'star-formation', color: '#c77dff',
    goals: [
      { kind: 'reach_wave', wave: 400 },
      { kind: 'abilities_cast', count: 50_000 },
      { kind: 'tower_level', level: 175 },
    ],
    reward: 'deep_reserves',
  },
  {
    id: 'wc_last_watch', number: 20, name: 'The Last Watch',
    flavour: 'There is no last watch. That is the whole of what you have learned.',
    icon: 'star-swirl', color: '#e8a93b',
    goals: [
      { kind: 'reach_wave', wave: 450 },
      { kind: 'transcendences', count: 50 },
      { kind: 'risk_waves', risk: 6, count: 500 },
    ],
    reward: 'undying_watch',
  },
```

Notes on the targets, so they can be re-derived rather than guessed:

- `tower_level: 175` — `TOWER_LEVEL_CAP` is **200** (`src/data/xpTables.ts:47`). Never ask for more than 200; 175 leaves headroom.
- `risk_waves` at `risk: 6` requires the `riskbearer` unlock (chapter 6) at minimum, which is far behind. The reader in `WatchManager` sums every bucket at or above the asked step, so `crown_of_thorns` (step 8, below) keeps crediting it.
- No new chapter uses `kills_of`: the test asserts every `kills_of` subject unlocks strictly before the chapter's depth gate, and every enemy already unlocks by wave 45, so a `kills_of` goal here would add nothing but risk. The existing five `kills_of` goals are untouched.

### 1.4 Eight new unlocks, and where each one is actually read

`WatchUnlockId` must grow to 20 members; `WATCH_UNLOCKS` and `WATCH_UNLOCK_CONSUMERS` are `Record`s over the union, so both fail to compile until every new member has an entry. Add to the union in `src/data/watch.ts`:

```ts
  | 'archivist'
  | 'crown_of_thorns'
  | 'counting_house'
  | 'emberforge'
  | 'eternal_kit'
  | 'master_broker'
  | 'deep_reserves'
  | 'undying_watch';
```

Add to `WATCH_UNLOCKS`:

```ts
  archivist: {
    id: 'archivist', name: 'Archivist', icon: 'wisdom',
    description: 'Every research project completes 20% faster.',
  },
  crown_of_thorns: {
    id: 'crown_of_thorns', name: 'Crown of Thorns', icon: 'crown',
    description: 'The risk dial gains an eighth step.',
  },
  counting_house: {
    id: 'counting_house', name: 'The Counting House', icon: 'crown-coin',
    description: 'Contracts pay 25% more gold and research points.',
  },
  emberforge: {
    id: 'emberforge', name: 'Emberforge', icon: 'explosion-rays',
    description: 'The Bloodforge core is yours, at no AP cost.',
  },
  eternal_kit: {
    id: 'eternal_kit', name: 'Eternal Kit', icon: 'regeneration',
    description: 'Passive abilities survive a transcendence.',
  },
  master_broker: {
    id: 'master_broker', name: 'Master Broker', icon: 'receive-money',
    description: 'A fifth contract runs alongside the other four.',
  },
  deep_reserves: {
    id: 'deep_reserves', name: 'Deep Reserves', icon: 'energy-tank',
    description: 'Every ability costs 20% less mana.',
  },
  undying_watch: {
    id: 'undying_watch', name: 'The Undying Watch', icon: 'hourglass',
    description: 'Offline progress banks twelve more hours.',
  },
```

Every icon above is in `ICON_IDS` (verified against `src/data/icons.ts`); every colour is a six-digit hex, which the data test requires.

Add to `WATCH_UNLOCK_CONSUMERS` (each string must exceed 20 characters and contain no `todo|nothing|unused|n/a|tbd`):

```ts
  archivist: 'Game.researchSpeedMultiplier() — the 0.8 factor folded into ResearchTree.setSpeedMultiplier',
  crown_of_thorns: 'Game.maxRisk() — returns 8, read by PacingManager.setRisk / clampRisk via the maxRisk() dep',
  counting_house: 'ContractManager rewardScale dep — Game adds +0.25 to getContractRewardMultiplier()',
  emberforge: 'Game.applyWatchUnlock — CoreManager.unlock("bloodforge") on completion and on load',
  eternal_kit: 'Game.applyFullTranscendenceReset — skips passiveMgr.reset() when held',
  master_broker: 'ContractManager.refill via the injected slots() dep — Game passes watch.contractSlots()',
  deep_reserves: 'Game.applyResolvedStats — multiplies abilityCostMultiplier by 0.8 before setAbilityCostMultiplier',
  undying_watch: 'Game getIdleCapSeconds closure — adds 12h to PrestigeManager.getIdleTimeCapSeconds()',
```

Now wire each consumer. Exact edits:

**a. `archivist` — research speed.** `ResearchTree.setSpeedMultiplier` is called from two places (`Game.ts:3371` and `Game.ts:5697`), both with `this.prestigeMgr.getResearchSpeedMultiplier()`. Add one private helper next to `maxRisk()` (`Game.ts:4954`):

```ts
  /**
   * Research time multiplier, including the Archivist Watch unlock.
   * Both `setSpeedMultiplier` call sites route through this so the two can
   * never disagree about whether the unlock is in force.
   */
  private researchSpeedMultiplier(): number {
    const base = this.prestigeMgr.getResearchSpeedMultiplier();
    return base * (this.watchMgr.has('archivist') ? 0.8 : 1);
  }
```

and replace both call sites with `this.researchTree.setSpeedMultiplier(this.researchSpeedMultiplier());`. `ResearchTree.setSpeedMultiplier` already floors at 0.1, so the stacked minimum stays safe.

**b. `crown_of_thorns` — an eighth risk step.** In `src/data/pacing.ts`, raise the ceiling:

```ts
export const MAX_RISK_CEILING = 8;
```

In `Game.maxRisk()` (`Game.ts:4954`), add the new branch **above** `deep_watch`:

```ts
    if (this.watchMgr.has('crown_of_thorns')) return 8;
    if (this.watchMgr.has('deep_watch')) return 7;
```

The `riskWaves` histogram is sized `MAX_RISK_CEILING + 1` in `defaultWatch()` and re-sized in `normalizeWatch()` (`SaveManager.ts:851`), so a save written at ceiling 7 is widened to 9 slots on load with a zero in the new bucket. Nothing else needs to change: `riskHpMult` and friends are formulas, not tables. At risk 8 the trade is ×2.44 enemy HP / ×1.64 speed for ×3.00 gold / ×1.80 AP (`RISK_*_PER_STEP` × 8).

**c. `counting_house` — contract payouts.** `Game.ts:841`:

```ts
      rewardScale: () => this.prestigeMgr.getContractRewardMultiplier()
        + (this.watchMgr.has('counting_house') ? 0.25 : 0),
```

(`ContractManager.rewardScale` floors the dep at 1, and scales gold and RP but never `apBonusPct` — that behaviour is unchanged and correct.)

**d. `emberforge` — the Bloodforge core.** In `Game.applyWatchUnlock` (`Game.ts:4920`), add a case alongside `cold_forge` / `sanctum`:

```ts
      case 'emberforge':
        this.coreMgr.unlock('bloodforge');
        this.state.cores = this.coreMgr.snapshot();
        break;
```

**e. `eternal_kit` — passives survive transcendence.** In `applyFullTranscendenceReset` (`Game.ts:5013`), guard the passive wipe:

```ts
    // The `eternal_kit` Watch unlock keeps the passive track through the one
    // reset that has always taken it. Everything else in this method still
    // fires: the AP tree, the automation flags and the AP balances all clear.
    if (!this.watchMgr.has('eternal_kit')) this.passiveMgr.reset();
```

**f. `master_broker` — a fifth contract slot.** `Game.ts:839` currently reads `slots: () => (this.watchMgr.has('board_expansion') ? CONTRACT_SLOTS + 1 : CONTRACT_SLOTS)`. Replace with:

```ts
      slots: () => CONTRACT_SLOTS
        + (this.watchMgr.has('board_expansion') ? 1 : 0)
        + (this.watchMgr.has('master_broker') ? 1 : 0),
```

`CONTRACT_SLOTS` is 3, so the ladder is 3 → 4 (chapter 1) → 5 (chapter 18).

**g. `deep_reserves` — −20% ability mana.** `Game.ts:4167`:

```ts
    this.abilityMgr.setAbilityCostMultiplier(
      stats.abilityCostMultiplier * (this.watchMgr.has('deep_reserves') ? 0.8 : 1),
    );
```

`AbilityManager.setAbilityCostMultiplier` clamps to `[0.1, 1]`, so the discount can never make an ability free.

**h. `undying_watch` — +12h offline cap.** `Game.ts:939`:

```ts
      getIdleCapSeconds: () => this.prestigeMgr.getIdleTimeCapSeconds()
        + (this.watchMgr.has('undying_watch') ? 12 * 3600 : 0),
```

### 1.5 UI: nothing to change

`JournalPanel`, `JournalStrip` and `ChapterModal` all walk `WATCH_CHAPTERS` and read `WATCH_CHAPTER_COUNT`; none of them hard-codes 12 (the two comments that say "12" at `JournalStrip.ts:110` and `ChapterModal.ts:50` are prose, not logic). Update those two comments to say "the last chapter" instead of naming a number.

---

## 2. The research economy: cut the faucet, keep the tree

### 2.1 Measured baseline

Figures produced by driving the shipping tables (`ENEMY_DEFS`, `ENEMY_SPAWN_WEIGHTS`, `enemyCountForWave`, `spawnIntervalForWave`, `expectedWaveSeconds`, `eliteChanceForWave`, `ResearchTree.getPassiveRPRate`) through the same arithmetic the game uses, averaged over ten-wave blocks (nine normal waves + one boss wave) and a 3 s intermission per wave.

Weighted mean `rpChance` across the spawn pool is **0.037** from wave 20 onward. Bodies per hour asymptote at ~4,800.

| Depth | Bodies/h | Drops/h, no bonuses | Drops/h, +10% (Loot Insights L10) | Drops/h, +28% (Loot L10 + Field Notes L6 + passive L25) | Passive/h base | Passive/h ×6 (Increased Focus L10) |
|---|---:|---:|---:|---:|---:|---:|
| wave 30 | 2,650 | 222 | 487 | 964 | 90 | 540 |
| wave 50 | 3,630 | 488 | 851 | 1,505 | 150 | 900 |
| wave 100 | 4,303 | 1,020 | 1,450 | 2,224 | 300 | 1,800 |
| wave 150 | 4,617 | 1,094 | 1,556 | 2,387 | 450 | 2,700 |
| wave 200 | 4,798 | 1,137 | 1,617 | 2,481 | 600 | 3,600 |

A fully invested player at wave 100 therefore earns **≈ 4,000 RP/h**. The *entire* research tree costs **65,405 RP** and takes **93.8 h** of serial research time (56.3 h with Scholarly Focus L5 at −40%). Sixteen hours of play buys the whole tree's RP, so cost stops mattering entirely and the single research slot's clock is the only pacing left — exactly the report.

Three specific culprits, in order of size:

1. **Elite kills always pay 1 RP** (`EnemyManager.ts:590–593`). At the 20% elite rate the game reaches by wave 100, that alone is 860 RP/h — 5× the base drop channel.
2. **Passive RP is linear in depth**: `0.05 × lifetimeHighestWave / 60` per second = `3 × wave` RP/h, so depth multiplies income without bound; ×6 on top from Increased Focus L10.
3. **Loot Insights maxes at +10% drop chance**, which is 2.7× the entire base rate of 3.7% — a single node more than triples the drop channel.

### 2.2 Passive RP becomes sub-linear in depth

`src/systems/ResearchTree.ts:229`, replace:

```ts
  /**
   * Passive RP, in RP per second.
   *
   * Square-root in depth rather than linear (economy §2.2): the old
   * `0.05 * wave / 60` paid `3 * wave` RP/h, so wave 200 earned 8x what wave
   * 25 did purely for being deeper, and the drop channel already scales with
   * depth through the body count. `0.20 * sqrt(wave) / 60` pays `12 * sqrt(w)`
   * RP/h — 60/h at wave 25, 120/h at wave 100, 240/h at wave 400 — which keeps
   * depth worth something without making it the whole economy.
   */
  getPassiveRPRate(lifetimeHighestWave: number, gainMultiplier: number): number {
    const wave = Math.max(1, lifetimeHighestWave);
    return (0.20 * Math.sqrt(wave) / 60) * (1 + gainMultiplier);
  }
```

| Wave | Old RP/h | New RP/h |
|---:|---:|---:|
| 16 | 48 | 48 (crossover) |
| 25 | 75 | 60 |
| 50 | 150 | 85 |
| 100 | 300 | 120 |
| 150 | 450 | 147 |
| 200 | 600 | 170 |
| 400 | 1,200 | 240 |

**The offline path duplicates this formula and must be changed in lockstep.** `src/systems/SaveManager.ts:1229`:

```ts
    const baseRPRate = 0.20 * Math.sqrt(Math.max(1, lifetimeWave)) / 60;
```

### 2.3 Increased Focus: ×6 → ×3

`src/data/research.ts`, node `rp_gain`:

```ts
    cost: [40, 80, 150, 300, 550, 900, 1300, 2400, 4800, 9600],
    effectPerLevel: 0.12,
    effectDefinitions: { 10: { effectValue: 2.0 } },
```

`researchTime` is unchanged. Level 1–9 now give +12%…+108%; level 10 jumps to +200% (multiplier ×3.0, was ×6.0). Ladder total: 20,120 RP (was 25,150).

**`SaveManager.computeRPGainMultiplier` (`:354`) re-implements this node by hand for the offline path and must be updated to match:**

```ts
    const basePerLevel = 0.12;
    if (lvl >= 10) sum += 2.0;
    else sum += basePerLevel * lvl;
```

### 2.4 Elite RP becomes a roll, not a guarantee

`src/systems/EnemyManager.ts:70`, next to `const ELITE_RP_DROP = 1;`:

```ts
/**
 * Chance that an elite pays its research point (economy §2.4).
 *
 * It used to be a guarantee, which at the 20% elite rate past wave 100 made
 * elites 860 RP/h on their own — five times the whole per-kill drop channel
 * and the single largest RP faucet in the game. A quarter of that keeps the
 * "elites are worth research" pitch intact at a size the tree is priced for.
 */
const ELITE_RP_DROP_CHANCE = 0.25;
```

and at `:589`:

```ts
      if (enemy.elite && Math.random() < ELITE_RP_DROP_CHANCE) {
        this.bus.emit('rp_dropped', { x: enemy.x, y: enemy.y, amount: ELITE_RP_DROP });
        if (this.researchTree) this.researchTree.addRP(ELITE_RP_DROP);
      }
```

The floater is inside the roll, so a silent elite no longer prints a "+1 RP" it did not pay.

### 2.5 Per-enemy drop chance: halved

`src/data/enemies.ts`, the thirteen `rpChance` fields. New values, in file order:

| Line | Type | Old | New |
|---:|---|---:|---:|
| 675 | `normal` | 0.01 | 0.005 |
| 692 | `fast` | 0.02 | 0.01 |
| 709 | `tank` | 0.03 | 0.015 |
| 726 | `flying` | 0.04 | 0.02 |
| 746 | `healer` | 0.05 | 0.025 |
| 763 | `boss` | 0.15 | 0.075 |
| 783 | `splitter` | 0.03 | 0.015 |
| 801 | `shielded` | 0.05 | 0.025 |
| 824 | `siege` | 0.05 | 0.025 |
| 841 | `thief` | 0.06 | 0.03 |
| 858 | `blinker` | 0.06 | 0.03 |
| 875 | `warden` | 0.07 | 0.035 |
| 892 | `burrower` | 0.06 | 0.03 |

Weighted pool mean: 0.037 → **0.0185**.

### 2.6 Loot Insights: +10% → +1%

`src/data/research.ts`, node `rp_drop_chance`:

```ts
    description: 'Increases enemy RP drop chance',
    cost: [60, 120, 240, 400, 640, 960, 1400, 2800, 5600, 12000],
    effectPerLevel: 0.001,
    effectDefinitions: { 10: { effectValue: 0.01 } },
```

`researchTime` is unchanged. Levels 1–9 give +0.1%…+0.9%; level 10 lands on +1.0%. Against the new 1.85% base that is still a **+54% uplift to the drop channel** at max — a real node, no longer a 2.7× multiplier on the whole economy. Ladder total: 24,220 RP (was 30,425).

`ResearchPanel.formatEffectValue` already prints this as `+X.X% drop chance` (`src/ui/ResearchPanel.ts:81`, one decimal), so +0.1% renders correctly with no UI change.

### 2.7 The other two drop-chance sources

**AP perk `ap_field_notes`** (`src/data/prestige.ts:368`):

```ts
    description: '+0.25% research point drop chance per level',
    effectPerLevel: 0.0025,
```

Max level 6 → +1.5% (was +12%). Cost ladder unchanged.

**Passive ability milestones** (`src/data/passiveAbilities.ts:478` and `:482`):

```ts
      { at: 5,  label: '+0.5% research point drop chance', grants: [{ stat: 'rp_drop_chance_pct', value: 0.5 }] },
      ...
      { at: 25, label: '+1% research point drop chance',   grants: [{ stat: 'rp_drop_chance_pct', value: 1 }] },
```

The contributor divides by 100 (`src/stats/contributors/passives.ts:67`), so these are +0.005 and +0.01. Max +1.0% (was +6%).

Total drop-chance bonus at full investment: 1.0% + 1.5% + 1.0% = **+3.5%** (was +28%).

### 2.8 Cost table: the cheap nodes stop being free

The sixteen one-shot / short-ladder nodes total only 5,390 RP today, which is under two hours of income even after §2.2–§2.7. Multiply each by 2.5 and round to a legible number. `researchTime` values are **unchanged everywhere** — research time is not the problem.

| Node id | Old cost | New cost |
|---|---:|---:|
| `piercing_shots` | 50 | 125 |
| `improved_pierce` | 200 | 500 |
| `reinforced_structure` | 40 | 100 |
| `chain_reaction` | 1000 | 2500 |
| `alchemy` | 25 | 60 |
| `transmutation` | 150 | 380 |
| `prosperity` | 100 | 250 |
| `golden_age` | 750 | 1900 |
| `mana_font` | 50 | 125 |
| `arcane_mastery` | 300 | 750 |
| `arcane_recovery` | 150 | 380 |
| `elemental_fury` | 1200 | 3000 |
| `arcane_expansion` | 900 | 2250 |
| `swift_prep` | 75 | 190 |
| `battle_intel` | 400 | 1000 |
| `veteran_scouts` (5 levels) | `[60, 180, 500, 1200, 2500]` | `[120, 360, 1000, 2400, 5000]` |

New totals: one-shots 13,510 (was 5,390) + `veteran_scouts` 8,880 (was 4,440) + `rp_gain` 20,120 + `rp_drop_chance` 24,220 = **66,730 RP** for the whole tree, against 65,405 today. The tree's price is deliberately about the same — the *shape* changed: the cheap nodes are now a decision and the RP-economy nodes cost less because they grant less.

### 2.9 Result

Recomputed with every change above applied:

| Depth | Drops/h (base rate only) | Drops/h (all bonuses maxed) | Passive/h (Focus maxed) | Total/h maxed | Old total/h maxed |
|---|---:|---:|---:|---:|---:|
| wave 50 | 67 + 82 elite = 149 | 194 + 82 = 276 | 255 | ≈ 530 | ≈ 2,400 |
| wave 100 | 80 + 215 elite = 295 | 230 + 215 = 445 | 360 | ≈ 805 | ≈ 4,024 |
| wave 200 | 89 + 240 elite = 329 | 257 + 240 = 497 | 509 | ≈ 1,006 | ≈ 6,081 |

(`drops/h = bodies/h × chance`; `elite/h = bodies/h × eliteChance × 0.25`.)

A ~4–5× cut, landing the whole 66,730 RP tree at **≈ 83 h of end-state income** against **93.8 h of research time** — the two constraints now bind at roughly the same scale, which is the outcome the report asks for. Mid-game (wave 50, partial investment ≈ 290 RP/h) a 2,500-RP node like Chain Reaction is a real 8-hour saving decision instead of pocket change.

Offline income is passive-only and unchanged in structure: at the base 8 h idle cap and wave 100, an absence now banks `120 × 3 × 8 = 2,880` RP at full investment (was 14,400).

---

## 3. Auto-Upgrader: one purchase per tick, three levels

### 3.1 What it does today

`AutomationManager.runAutoBuy` (`src/systems/AutomationManager.ts:167`) loops up to `MAX_AUTO_BUYS_PER_TICK = 40` times per tick, buying until nothing is affordable. That is the "it buys multiple skills every 10s" the report describes. `ap_auto_upgrader` is a single-level unlock (`src/data/prestige.ts:189`), and `tp_efficiency` (`:991`) shortens the interval by 1 s per level to a floor of 3 s.

### 3.2 The perk gains two levels

`src/data/prestige.ts`, node `ap_auto_upgrader`:

```ts
    description: 'Auto-buys 1 upgrade every 10s; each level buys one more per tick',
    costPerLevel: 12,
    costScaling: 2,
    maxLevel: 3,
```

`perkCost(def, level) = floor(costPerLevel × costScaling^level)`, so the ladder is **12 / 24 / 48 AP** (84 total). `perkCost(def, 0) === 12` still holds, which `tests/prestige-ap.test.ts:116` asserts.

Also update the human-readable branch in `describePerk` (`src/data/prestige.ts:629`), which currently returns the fixed string `'Unlocks the Auto-Upgrader automation'`:

```ts
    case 'auto_buy':
      return level > 0
        ? `Auto-buys ${level} upgrade${level === 1 ? '' : 's'} per tick`
        : 'Unlocks Auto-Upgrade (1 upgrade per tick, +1 per level)';
```

Check the exact shape of the surrounding `switch` (it takes `p` and `level`) and match its existing style.

### 3.3 The purchase budget

Add to `PrestigeManager`, next to `getAutoBuySpeedReduction()` (`src/systems/PrestigeManager.ts:644`):

```ts
  /**
   * How many upgrades auto-buy may purchase in one tick.
   *
   * The Auto-Upgrader perk's *level* is the budget: L1 buys one upgrade per
   * interval, L3 buys three. A grant from another source — the Watch's
   * `overseer` unlock — has no level, so it counts as one. Returns 0 when
   * auto-buy is not unlocked at all, which is what stops the manager from
   * running a loop it has no permission for.
   */
  getAutoBuyCount(): number {
    const fromPerk = this.getAPLevel('ap_auto_upgrader');
    if (fromPerk > 0) return fromPerk;
    return this.isAutomationUnlocked('autoBuy') ? 1 : 0;
  }
```

### 3.4 The manager honours it

In `src/systems/AutomationManager.ts`:

- Delete `const MAX_AUTO_BUYS_PER_TICK = 40;`.
- Add `getAutoBuyCount: () => number;` to the `AutomationDeps.prestige` surface — it is typed as `PrestigeManager`, so no interface edit is needed, but the `sim/checks.ts` stubs must gain the method (§9.4).
- Replace the loop bound in `runAutoBuy`:

```ts
  private runAutoBuy(): void {
    const upgrades = this.deps.upgrades;
    const state = this.deps.getState();
    // The perk's level is the per-tick budget (plan §3.3). One purchase per
    // interval at L1 is the contract the panel copy promises; the old
    // unbounded loop spent the entire bank every ten seconds.
    const budget = this.deps.prestige.getAutoBuyCount();
    if (budget <= 0) return;
    const strategy: AutoBuyStrategy = state.prestige.autoBuyStrategy ?? 'balanced';
    const reserve = Math.max(
      Math.max(0, Math.min(0.9, state.prestige.autoBuyReserve ?? 0)),
      this.quartermasterReserve,
    );

    for (let i = 0; i < budget; i++) {
      // ...body unchanged...
    }
  }
```

The body (candidate collection, the three strategy sorts, the reserve check, `upgrades.buy`) is unchanged. Update the method's doc comment: rule 3 currently reads "Buying continues within the tick until no rule allows another purchase" — it now reads "Buying repeats up to the Auto-Upgrader perk's level, once per interval per level."

### 3.5 The resulting cadence

| Auto-Upgrader | Efficiency (`tp_efficiency`) | Interval | Upgrades/min |
|---|---|---:|---:|
| L1 | L0 | 10 s | 6 |
| L3 | L0 | 10 s | 18 |
| L1 | L7 | 3 s | 20 |
| L3 | L7 | 3 s | 60 |

`tp_efficiency` maxes at 7 levels for −7 s, and the manager floors the interval at `MIN_AUTO_BUY_INTERVAL = 3`. The Autonomy talent's fractional reduction (`autoBuyIntervalReduction`) still multiplies on top and is unchanged.

---

## 4. Automation moves to its own tab

### 4.1 The tab

1. `src/types.ts:73` — add `'automation'` to the `PanelTab` union.
2. `src/ui/navGroups.ts` — the `prestige` group becomes:

```ts
    tabs: [
      { id: 'prestige', label: 'Prestige' },
      { id: 'transcendence', label: 'Transcendence' },
      { id: 'automation', label: 'Automation' },
    ],
```

`GROUP_OF` is derived from the table, so nothing else in the nav needs touching.

### 4.2 New panel: `src/ui/AutomationPanel.ts`

Move, verbatim where possible, out of `src/ui/TranscendencePanel.ts`:

- `renderAutomationSection()` (`:544`), `renderAutomationRow()` (`:630`), `renderAutoBuyConfig()` (`:576`), `updateAutomationRow()` (`:229`), `updateAutoBuyConfig()` (`:120`);
- the fields `autoBuyConfig`, `strategyBtns`, `strategyHint`, `reserveInput`, `reserveLabel`, `autoSwitches`, `autoRows`, `autoStatusEls`;
- the module constants `STRATEGY_LABELS` and `STRATEGY_HINTS`;
- the **Auto-Ascend target wave** control (`targetWaveLabel`, the `transcend-target-line` / `transcend-target-row` block at `TranscendencePanel.ts:362–388`) — it configures auto-ascend, not transcendence.

The panel's shape mirrors every other panel: `mount(parent)`, `unmount()`, `update(state)`, a private `renderInto(parent)` that sets `parent.className = 'automation-panel'` and appends a `panel-title` `<h2>` reading `Automation`.

Handler interface:

```ts
export interface AutomationPanelHandlers {
  onToggleAutomation: (key: AutomationKey, enabled: boolean) => void;
  isAutomationUnlocked: (key: AutomationKey) => boolean;
  isAutomationEnabled: (key: AutomationKey) => boolean;
  onTargetWaveChange: (wave: number) => void;
  targetAscendWave: number;
  getAutoBuyStrategy: () => AutoBuyStrategy;
  onAutoBuyStrategyChange: (strategy: AutoBuyStrategy) => void;
  getAutoBuyReserve: () => number;
  onAutoBuyReserveChange: (fraction: number) => void;
  /** Auto-Upgrader level, for the "buys N per tick" readout (plan §3.3). */
  getAutoBuyCount: () => number;
}
```

`update(state)` does exactly what `TranscendencePanel.update` did for these widgets:

```ts
  update(_state: GameState): void {
    if (!this.root) return;
    const autoKeys: AutomationKey[] = ['autoBuy', 'autoAbilities', 'autoAscend', 'autoTranscend'];
    for (const key of autoKeys) this.updateAutomationRow(key);
    this.updateAutoBuyConfig();
  }
```

### 4.3 Copy: every toggle names its source

Replace the `entries` table in `renderAutomationSection` with a four-column one carrying a second "where to buy it" line, and render that line as a `<div class="automation-source">` below the description in `renderAutomationRow`:

```ts
    const entries: Array<[AutomationKey, string, string, string]> = [
      ['autoBuy', 'Auto-Upgrade',
        'Buys upgrades on a timer using the strategy below. One purchase per tick per Auto-Upgrader level.',
        'Unlock: Prestige → Auto-Upgrader (12 AP, tier 1). Levels 2–3 (24 / 48 AP) each add one purchase per tick. Faster ticks: Transcendence → Dominion → Efficiency (−1s per level, floor 3s).'],
      ['autoAbilities', 'Auto-Cast',
        'Casts every ready ability once a second, in priority order, whenever mana and the ability’s own conditions allow.',
        'Unlock: Transcendence → Dominion → Auto-Caster (8 TP). Per-ability opt-outs live on the Abilities tab.'],
      ['autoAscend', 'Auto-Ascend',
        'Ascends the moment your highest wave reaches the target below.',
        'Unlock: Transcendence → Dominion → Auto-Ascender (20 TP, tier 3; needs Auto-Caster and Wave Commander L3).'],
      ['autoTranscend', 'Auto-Transcend',
        'Transcends as soon as this cycle has banked enough AP.',
        'Unlock: Transcendence → Dominion → Auto-Transcender (40 TP, tier 4; needs Auto-Ascender).'],
    ];
```

Every perk name, cost and prerequisite above is read from `src/data/prestige.ts` — `ap_auto_upgrader` (12 AP, tier 1), `tp_auto_cast` (8 TP), `tp_wave_start`, `tp_efficiency` (3 TP base, 7 levels), `tp_auto_ascend` (20 TP), `tp_auto_transcend` (40 TP). Keep them in sync if those tables move.

Also mention the second grant path for auto-buy in the `autoBuy` source line's tail: *"or free from the Journal's Overseer unlock (chapter 7)."*

In `updateAutoBuyConfig`, add a line above the strategy buttons reading `Buys ${count} upgrade${count === 1 ? '' : 's'} every tick.` from `getAutoBuyCount()`.

New CSS in `src/styles/main.css`, beside the existing `.automation-desc` rule:

```css
.automation-source {
  margin-top: 4px;
  color: var(--text-2);
  font-size: var(--text-xs);
  line-height: 1.4;
}
```

### 4.4 Wiring in `UIManager`

1. Import `AutomationPanel`; add `private readonly automationPanel: AutomationPanel;`.
2. Construct it beside `this.transcendencePanel = new TranscendencePanel({...})` (`src/ui/UIManager.ts:603`), moving these nine handler entries out of the Transcendence panel's options and into it: `onToggleAutomation`, `onTargetWaveChange`, `isAutomationUnlocked`, `isAutomationEnabled`, `targetAscendWave`, `getAutoBuyStrategy`, `onAutoBuyStrategyChange`, `getAutoBuyReserve`, `onAutoBuyReserveChange`. Add `getAutoBuyCount: () => this.prestigeApi.getAutoBuyCount()` and expose it on `prestigeApi` (which is fed from `Game.syncUiApis`) as `getAutoBuyCount: () => this.prestigeMgr.getAutoBuyCount()`.
3. `showTab` (`:1891`) — add a branch:

```ts
    } else if (id === 'automation') {
      this.automationPanel.mount(this.contentRoot);
      if (this.lastState) this.automationPanel.update(this.lastState);
```

4. `mountMobileTab` (`:1016`) — `case 'automation': this.automationPanel.mount(body); break;`
5. `updatePanel` (`:1652`) — `case 'automation': this.automationPanel.update(state); break;`
6. The per-tick desktop refresh around `:1409` (`else if (this.activeTab === 'transcendence')`) — add the matching `automation` arm.

### 4.5 What is left on the Transcendence tab

`renderInto` (`:289`) drops the `this.renderAutomationSection()` append, and `renderTranscendCard` drops the target-wave label and row. The `TranscendencePanelHandlers` interface loses the nine moved entries. `update()` loses the `autoKeys` loop and the `updateAutoBuyConfig()` call. The panel keeps: summary, transcend card, TP tree.

---

## 5. Stats popup `?` tooltip: Codex names, Codex styling

### 5.1 The defect

`StatsPopup.renderTooltipContent` (`src/ui/StatsPopup.ts:651`) writes `entry.summary` and `entry.detail` with `setText`. Codex prose is authored against engine identifiers — "`rpDropChanceBonus` is added to the base RP drop chance", "`abilityCostMultiplier` is clamped between 0.1 and 1" — so the tooltip prints camelCase source names. `CodexPanel` already solves this with `friendlyTermName()` + `setProse()` (`src/ui/CodexPanel.ts:38` and `:62`), which swap each identifier for its `STAT_ROW_BY_KEY` label and wrap it in `<span class="codex-term">`. The tooltip also shows no category and no stat list, so it looks unrelated to the Codex entry it is quoting.

### 5.2 Extract the shared helper

Create `src/ui/codexProse.ts` and move `friendlyTermName`, `IDENTIFIER_RE` and `setProse` into it verbatim (including their doc comments), exporting `friendlyTermName` and `setProse`. `CodexPanel.ts` imports them instead of declaring them; its behaviour must not change (it uses `friendlyTermName` in `matchesSearch` and `renderStatList` as well as through `setProse`).

### 5.3 Rework the tooltip

In `StatsPopup.buildTooltip()` (`:585`), append two more children after `detail`, mirroring the Codex detail pane's class names so they inherit its look:

```ts
    const stats = document.createElement('div');
    stats.className = 'stats-codex-tooltip-stats codex-detail-stats';
    tooltip.appendChild(stats);

    const footer = document.createElement('div');
    footer.className = 'stats-codex-tooltip-footer';
    tooltip.appendChild(footer);
```

and add a category chip inside `head`, after `term`:

```ts
    const cat = document.createElement('span');
    cat.className = 'stats-codex-tooltip-cat';
    head.appendChild(cat);
```

`renderTooltipContent(entry)` (`:651`) becomes:

```ts
  private renderTooltipContent(entry: CodexEntry): void {
    const tooltip = this.tooltipEl;
    if (!tooltip) return;

    const iconHost = tooltip.querySelector<HTMLElement>('.stats-codex-tooltip-icon');
    if (iconHost) renderIcon(iconHost, entry.icon, { size: 18, tone: 'inherit' });

    const term = tooltip.querySelector<HTMLElement>('.stats-codex-tooltip-term');
    if (term) setText(term, entry.term);

    // The category chip is what makes the tooltip read as the Codex entry it
    // is quoting rather than as a floating paragraph.
    const cat = tooltip.querySelector<HTMLElement>('.stats-codex-tooltip-cat');
    if (cat) {
      setText(cat, CODEX_CATEGORY_LABELS[entry.category]);
      cat.dataset.category = entry.category;
    }

    // `setProse`, not `setText`: Codex copy is authored against engine keys and
    // the panel swaps each one for its player-facing name. Doing it in one
    // place and not the other is what made this tooltip print
    // "rpDropChanceBonus" where the Codex prints "RP Drop Chance".
    const summary = tooltip.querySelector<HTMLElement>('.stats-codex-tooltip-summary');
    if (summary) setProse(summary, entry.summary);

    const detail = tooltip.querySelector<HTMLElement>('.stats-codex-tooltip-detail');
    if (detail) {
      detail.replaceChildren();
      for (const para of entry.detail.split(/\n\n+/)) {
        const trimmed = para.trim();
        if (!trimmed) continue;
        const p = document.createElement('p');
        setProse(p, trimmed);
        detail.appendChild(p);
      }
    }

    const stats = tooltip.querySelector<HTMLElement>('.stats-codex-tooltip-stats');
    if (stats) {
      stats.replaceChildren();
      if (entry.stats && entry.stats.length > 0) {
        const heading = document.createElement('h5');
        heading.className = 'codex-detail-stats-heading';
        heading.textContent = 'Resolves these stats';
        stats.appendChild(heading);
        const list = document.createElement('ul');
        list.className = 'codex-detail-stats-list';
        for (const stat of entry.stats) {
          const li = document.createElement('li');
          li.className = 'codex-detail-stat';
          const name = document.createElement('span');
          name.className = 'codex-detail-stat-name';
          name.textContent = friendlyTermName(stat);
          name.title = stat;
          li.appendChild(name);
          list.appendChild(li);
        }
        stats.appendChild(list);
      }
    }

    const footer = tooltip.querySelector<HTMLElement>('.stats-codex-tooltip-footer');
    if (footer) {
      footer.replaceChildren();
      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'stats-codex-tooltip-link';
      link.textContent = 'Open in Codex →';
      link.addEventListener('click', () => {
        this.closeTooltip();
        this.onOpenCodex?.(entry.id);
      });
      footer.appendChild(link);
    }
  }
```

New imports in `StatsPopup.ts`: `friendlyTermName`, `setProse` from `./codexProse`; `CODEX_CATEGORY_LABELS` from `../data/codex`.

New optional field + setter on the class, so the popup does not need to know about `UIManager`:

```ts
  /** Set by UIManager so the tooltip can hand the player to the full entry. */
  private onOpenCodex: ((entryId: string) => void) | null = null;

  setOnOpenCodex(handler: (entryId: string) => void): void {
    this.onOpenCodex = handler;
  }
```

Wire it wherever `UIManager` constructs the popup: `this.statsPopup.setOnOpenCodex((id) => this.openCodex(id));` (`UIManager.openCodex` already exists at `:1990`).

Because the tooltip grows, raise its `max-width` and give the new pieces styles in `src/styles/main.css` beside the existing `.stats-codex-tooltip` block (`:8376`):

```css
.stats-codex-tooltip { max-width: 380px; }

.stats-codex-tooltip-cat {
  margin-left: auto;
  padding: 1px 8px;
  border: 1px solid var(--stroke-strong);
  border-radius: 999px;
  color: var(--text-2);
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.stats-codex-tooltip-stats { margin-top: 8px; }
.stats-codex-tooltip-footer { margin-top: 8px; }
.stats-codex-tooltip-link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent);
  font-size: var(--text-xs);
  cursor: pointer;
}
.stats-codex-tooltip-link:hover { text-decoration: underline; }
```

`.codex-term`, `.codex-detail-stats-heading`, `.codex-detail-stats-list` and `.codex-detail-stat-name` already exist in the stylesheet and are reused as-is — that is the point of borrowing the class names.

### 5.4 The copy itself

Codex prose stays authored against engine keys — `setProse` translates it at render time and `tests/codex.test.ts` checks the `stats` arrays against the `StatKey` union. Do **not** rewrite `src/data/codex.ts` strings.

---

## 6. Abilities: flatten the mana curve, steepen three power curves

### 6.1 The measured problem

`manaCost(level) = def.manaCost + def.manaCostPerLevel × (level − 1)` (`AbilityManager.getBaseManaCost`, `:247`; `computeEffectiveStats`, `src/data/abilities.ts`). Level 1 → max:

| Ability | Mana L1 | Mana max (old) | ×    | Effect L1 → max | ×    | Cooldown L1 → max |
|---|---:|---:|---:|---|---:|---|
| Rain of Arrows | 30 | 75 | 2.50 | 6.5× → 16.85× | 2.59 | 12 → 7.5 |
| Frost Nova | 25 | 61 | 2.44 | 50% → 68% slow | 1.36 | 18 → 10.8 |
| Chain Lightning | 34 | 61 | 1.79 | 4.0× → 8.05× | 2.01 | 14 → 10.4 |
| Precision Shot | 35 | 71 | 2.03 | +30% → +48% crit | 1.60 | 22 → 16.6 |
| Berserk | 40 | 94 | 2.35 | 2.0× → 3.35× | 1.68 | 30 → 21.0 |
| Meteor Strike | 60 | 114 | 1.90 | 18× → 37.8× | 2.10 | 25 → 20.5 |
| Gold Rush | 50 | 122 | 2.44 | 2.6× → 5.3× | 2.04 | 40 → 31.0 |
| Execute | 50 | 104 | 2.08 | 12% → 30% | 2.50 | 30 → 22.8 |
| Rocket Barrage | 45 | 87 | 1.93 | 9.9 → 46.8 total | 4.73 | 20 → 15.8 |
| Vampiric Aura | 45 | 90 | 2.00 | +6% → +24% ls | 4.00 | 35 → 26.0 |

Four abilities (Frost Nova, Precision Shot, Berserk, Gold Rush) gain **less** power than mana across their ladder, and mana income does not scale with ability level at all — `maxMana` tops out at 100 + 5×40 = 300 and `manaRegen` at 2 + 0.2×60 = 14/s from upgrades. Levelling those four is a net loss.

### 6.2 Mana cost becomes a percentage of the base

Delete the `manaCostPerLevel` field from `AbilityDef` (`src/data/abilities.ts:58`) and from all ten definitions. Add next to the other exported ability constants:

```ts
/**
 * Mana cost growth per ability level, as a fraction of the level-1 cost.
 *
 * Was a per-def additive (`manaCostPerLevel`), which ran the cost up 1.8x-2.5x
 * across a ladder that only pays 1.4x-2.6x more power — so four of the ten
 * abilities were strictly worse per mana at max level than at level 1, with no
 * matching growth in the mana pool (maxMana caps at 300, regen at 14/s). At 5%
 * of base per level a ten-level ability ends at 1.45x cost, which every
 * ability's power curve clears comfortably.
 */
export const MANA_COST_GROWTH_PER_LEVEL = 0.05;

export function abilityManaCost(def: AbilityDef, level: number): number {
  const lvl = Math.max(1, Math.min(def.maxLevel, level));
  return Math.round(def.manaCost * (1 + MANA_COST_GROWTH_PER_LEVEL * (lvl - 1)));
}
```

Use it in both places that compute a base cost:

- `computeEffectiveStats` — replace `const manaCost = def.manaCost + def.manaCostPerLevel * lvlOffset;` with `const manaCost = abilityManaCost(def, clampedLevel);`
- `AbilityManager.getBaseManaCost` (`:242`) — `return abilityManaCost(def, level);` (import the helper).

Resulting max-level costs:

| Ability | Mana L1 | Old max | New max |
|---|---:|---:|---:|
| Rain of Arrows | 30 | 75 | 44 |
| Frost Nova | 25 | 61 | 36 |
| Chain Lightning | 34 | 61 | 49 |
| Precision Shot | 35 | 71 | 51 |
| Berserk | 40 | 94 | 58 |
| Meteor Strike | 60 | 114 | 87 |
| Gold Rush | 50 | 122 | 73 |
| Execute | 50 | 104 | 73 |
| Rocket Barrage (L15) | 45 | 87 | 77 |
| Vampiric Aura | 45 | 90 | 65 |

### 6.3 Three power curves are raised

Cost is only half the complaint; the four flat abilities also need to *feel* like they levelled.

**Frost Nova** (`src/data/abilities.ts`, `frost_nova`):

```ts
    effectValuePerLevel: -0.025,   // was -0.02  → 50% slow at L1, 72.5% at L10
    durationPerLevel: 0.6,         // was 0.5    → 5s at L1, 10.4s at L10
```

and the brittle channel:

```ts
export const FROST_BRITTLE_PER_LEVEL = 0.05;   // was 0.03 → +25% at L1, +70% at L10
```

**Precision Shot** (`precision_shot`):

```ts
    effectValuePerLevel: 3,        // was 2 → +30% crit chance at L1, +57% at L10
```

and:

```ts
export const CRIT_BUFF_DAMAGE_PER_LEVEL = 0.15;  // was 0.1 → 1.5x at L1, 2.85x at L10
```

**Chain Lightning** (`chain_lightning`):

```ts
    effectValuePerLevel: 0.55,     // was 0.45 → 4.0x at L1, 8.95x at L10
```

**Vampiric Aura** (`vampiric_aura`):

```ts
    durationPerLevel: 0.6,         // was 0.4 → 8s at L1, 13.4s at L10
```

Berserk, Gold Rush, Meteor Strike, Execute, Rain of Arrows and Rocket Barrage keep their effect curves — the mana flattening alone moves each of them from "roughly break-even per mana" to "clearly worth levelling".

Value ratio (power multiple ÷ mana multiple across the full ladder), before → after:

| Ability | Before | After |
|---|---:|---:|
| Rain of Arrows | 1.04 | 1.79 |
| Frost Nova | 0.85 | 1.93 |
| Chain Lightning | 1.12 | 1.54 |
| Precision Shot | 0.79 | 1.31 |
| Berserk | 0.71 | 1.16 |
| Gold Rush | 0.84 | 1.40 |
| Meteor Strike | 1.11 | 1.45 |
| Execute | 1.20 | 1.71 |
| Rocket Barrage | 2.45 | 2.78 |
| Vampiric Aura | 2.00 | 2.77 |

### 6.4 Move the Chain Lightning constants where the tooltip can read them

`CHAIN_BOUNCE_BASE = 6`, `CHAIN_BOUNCE_PER_LEVEL = 1`, `CHAIN_BOUNCE_MAX = 12`, `CHAIN_DECAY = 0.82` are module-private in `src/systems/AbilityManager.ts:96–100`, and §7 needs the bounce count for the tooltip. Move all four to `src/data/abilities.ts` as exports, add:

```ts
/** Bounces a Chain Lightning cast makes at `level`, before talent bonuses. */
export function chainBounces(level: number): number {
  const lvl = Math.max(1, level);
  return Math.min(CHAIN_BOUNCE_MAX, CHAIN_BOUNCE_BASE + Math.floor(lvl / 2) * CHAIN_BOUNCE_PER_LEVEL);
}
```

and import them back into `AbilityManager` (the cast path at `:829` keeps adding `this.chainBounceBonus` and the focus bonus on top, unchanged). Do the same for `ROCKET_SPLASH_RADIUS` / `ROCKET_SPLASH_FRACTION` (`:94–95`) — the tooltip quotes the splash fraction.

---

## 7. Ability tooltips show what the ability actually does

### 7.1 What is wrong today

`renderAbilityTooltip` (`src/ui/abilityFormat.ts`) is shared by `AbilityPanel` (`:453`), `AbilityBar` (`:417`) and `AbilityUpgradePopover` (`:49`). It emits five rows: description, mana cost, one generic effect row, cooldown, duration, plus an optional area row. Three concrete problems:

1. **The "next level" column is computed wrong.** `computeEffectiveStats(def, level + 1)` is the *raw* per-def curve, while `currentStats` came from `AbilityManager.getEffectiveStats`, which has already applied `abilityCostMultiplier`, `cooldownMultiplier` and `areaMultiplier`. A player with −20% ability cost sees "Mana cost 24 → 35" — the arrow points at a number that will never happen.
2. **A `Duration 0s` row is printed for the five instant abilities.**
3. **Everything an ability actually does beyond one number is missing**: Frost Nova's brittle bonus, Meteor's splash, Execute's boss chunk, Precision Shot's crit multiplier, Vampiric's regen, Chain Lightning's bounce count and damage decay, Rocket Barrage's splash, the ability's XP progress, its unlock wave, and its auto-cast condition.

### 7.2 New signature

```ts
export interface AbilityTooltipContext {
  /** Current, fully-multiplied stats (AbilityManager.getEffectiveStats). */
  stats: EffectiveAbilityStats;
  /** Same, one level higher. Null when maxed — no arrow column is drawn. */
  next: EffectiveAbilityStats | null;
  cost: number;
  canAfford: boolean;
  showCost: boolean;
  /** Tower base damage, for the "≈ N damage" line. 0 hides those lines. */
  towerDamage: number;
  /** Ability XP toward the next level, and what it needs. */
  xp: number;
  xpNeeded: number;
}

export function renderAbilityTooltip(def: AbilityDef, ctx: AbilityTooltipContext): string
```

The three call sites each build `next` through the **manager**, not through the raw table, which fixes problem 1:

- Add `getEffectiveStatsAtLevel(id: AbilityId, level: number): EffectiveAbilityStats` to `AbilityManager`, factored out of `getEffectiveStats` — same body, with `level` passed in instead of read from state, and the same three multipliers applied. `getEffectiveStats(id)` becomes `this.getEffectiveStatsAtLevel(id, this.getAbilityLevel(id))`.
- Expose it on the ability API that `UIManager` hands the panels (`getEffectiveStatsAt: (id, level) => …`), and thread it into `AbilityPanelHandlers`, `AbilityBar`'s handlers and `AbilityUpgradePopoverHandlers`.
- Each call site computes `next = isMaxed ? null : handlers.getEffectiveStatsAt(id, stats.level + 1)`.
- `towerDamage` comes from the same state the panels already hold (`state.tower.baseDamage`); `AbilityUpgradePopover` may pass 0 if it has no state handy.
- `xp` / `xpNeeded`: `AbilityPanel` already has `handlers.getXp(id)` and imports `abilityXpForLevel`; add the same two to the bar's handler set (the bar already receives `getEffectiveStats`).

### 7.3 Rows

Render, in order, skipping any row whose value is absent:

| Row | Shown when | Content |
|---|---|---|
| header | always | `${def.name} — Level ${stats.level}` + ` → ${stats.level + 1}` when `next` |
| description | always | `stats.displayText` |
| Mana cost | always | `stats.manaCost` (+ arrow to `next.manaCost`) |
| *effect row* | always | `EFFECT_LABELS[def.effectType]` and `stats.displayEffectValue` |
| Damage | `towerDamage > 0` and effect type is `aoe_damage`, `single_target_damage`, `chain_damage` or `rocket_barrage` | see §7.4 |
| Cooldown | always | `stats.cooldown.toFixed(1)}s` |
| Duration | `stats.duration > 0` | `stats.displayDuration` |
| Area | `stats.area > 0` | `stats.displayArea` |
| *per-ability extras* | see §7.4 | |
| Casts | `stats.cooldown > 0` | `${(60 / stats.cooldown).toFixed(1)}/min · ${Math.round(stats.manaCost * 60 / stats.cooldown)} mana/min` |
| XP | `xpNeeded > 0 && !maxed` | `${Math.floor(xp)} / ${xpNeeded} — upgrade cost falls to 0 at full XP` |
| Unlocks at | `def.unlockWave > 10` | `Wave ${def.unlockWave}` |
| Auto-cast | `def.autoCast` is set | the condition, in words (§7.5) |
| cost | `showCost && next` | `Cost: ${cost}g`, with the existing `can-afford` / `cannot-afford` class |

The arrow column (`<span class="arrow">→</span><span class="up-val">…</span>`) is emitted for Mana cost, the effect row, Cooldown, Duration, Area and every numeric extra — always sourced from `next`, never from a re-derived table.

### 7.4 Per-ability extra rows

Add to `src/ui/abilityFormat.ts`:

```ts
/**
 * The rows that are specific to one ability.
 *
 * Everything an ability does beyond its headline number used to live only in
 * the description sentence or in `AbilityManager`'s cast path, so a player
 * could not see that Frost Nova also makes enemies take more damage or that
 * Execute chunks bosses. Each entry returns `[label, value]` pairs, already
 * formatted, for a given level.
 */
function extraRows(def: AbilityDef, level: number): Array<[string, string]> {
  switch (def.id) {
    case 'frost_nova':
      return [['Brittle', `+${(frostBrittle(level) * 100).toFixed(0)}% damage taken`]];
    case 'precision_shot':
      return [['Crit damage', `${precisionCritMultiplier(level).toFixed(2)}x`]];
    case 'vampiric_aura':
      return [['Regen', `${(vampiricRegen(level) * 100).toFixed(1)}% max HP/s`]];
    case 'execute':
      return [
        ['Boss threshold', `${Math.floor((def.effectValue + def.effectValuePerLevel * (level - 1)) / 2)}% HP`],
        ['Boss damage', `${(executeBossFrac(level) * 100).toFixed(1)}% of max HP`],
      ];
    case 'meteor_strike':
      return [['Splash', `${(METEOR_SPLASH_FRACTION * 100).toFixed(0)}% of the hit`]];
    case 'chain_lightning':
      return [
        ['Bounces', String(chainBounces(level))],
        ['Falloff', `${((1 - CHAIN_DECAY) * 100).toFixed(0)}% per bounce`],
      ];
    case 'rocket_barrage':
      return [['Rocket splash', `${(ROCKET_SPLASH_FRACTION * 100).toFixed(0)}% in ${Math.round(ROCKET_SPLASH_RADIUS / WORLD_SCALE)} px`]];
    case 'berserk':
    case 'gold_rush':
    case 'rain_of_arrows':
      return [];
  }
}
```

Imports needed: `frostBrittle`, `precisionCritMultiplier`, `vampiricRegen`, `executeBossFrac`, `METEOR_SPLASH_FRACTION`, `chainBounces`, `CHAIN_DECAY`, `ROCKET_SPLASH_FRACTION`, `ROCKET_SPLASH_RADIUS`, `WORLD_SCALE` — the last four exist after §6.4. The `switch` is exhaustive over `AbilityId` so a new ability forces a decision here.

The **Damage** row, for the four damage abilities:

```ts
// `effectValue` is a multiple of tower base damage in every damage path
// (`AbilityManager.dealAoEDamage`, `castMeteor`, `castChain`, the rocket
// volley), so the tooltip can quote the real number the cast will deal
// instead of an abstract "6.5x".
const perHit = towerDamage * stats.effectValue;
const total = def.effectType === 'rocket_barrage'
  ? perHit * Math.floor(stats.count ?? 0)
  : perHit;
```

rendered as `${formatInt(perHit)} per hit` and, for Rocket Barrage, `${formatInt(total)} total`. Note in a comment that this figure excludes resists, the placement-focus bonus and the ability damage multiplier, which are cast-time facts.

### 7.5 Auto-cast condition, in words

```ts
function describeAutoCast(c: AutoCastCondition): string {
  const parts: string[] = [];
  if (c.minInDisc) parts.push(`${c.minInDisc}+ enemies in the disc`);
  if (c.minEnemies) parts.push(`${c.minEnemies}+ enemies alive`);
  if (c.bossOnly) parts.push('a boss is alive');
  if (c.bossHpBelow) parts.push(`boss below ${Math.round(c.bossHpBelow * 100)}% HP`);
  if (c.towerHpBelow) parts.push(`tower below ${Math.round(c.towerHpBelow * 100)}% HP`);
  return parts.length ? `Auto-casts when ${parts.join(' and ')}` : 'Auto-casts whenever ready';
}
```

Include the standing rule as a second sentence: *"A manual cast ignores this."* — that is what `AutomationManager.runAutoCast` actually implements.

### 7.6 Layout

The tooltip is already a stack of `.tooltip-row`s. Add one class for the section break before the extras and the meta rows:

```css
.tooltip-row.tooltip-row--meta {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--stroke-soft);
  color: var(--text-2);
  font-size: var(--text-xs);
}
```

Apply it to the Casts / XP / Unlocks at / Auto-cast rows. The Ability Bar's hover tooltip and the mobile popover both grow; check that `.ability-hover-tooltip` (or whatever the bar's container class is) has no fixed height and that `AbilityBar.positionHoverTooltip` still clamps inside the viewport after the growth.

---

## 8. Persistence: save version 24

Bump `SAVE_VERSION` to **24** (`src/systems/SaveManager.ts:55`), add `24` handling to `validate`'s accepted-version list (`:785`), append to the migration ladder (`:821`):

```ts
  if (data.version === 23) { migrateV23toV24(data); data.version = 24; }
```

and add:

```ts
/**
 * v24 (plans/improvements.md): the research rebalance and the Auto-Upgrader's
 * two new levels.
 *
 * Three things need saying about what this does *not* do:
 *
 *  - **RP is not clawed back.** The faucet changes are forward-looking; a
 *    player who banked 40k RP under the old rates keeps it. Refunding would
 *    require knowing which RP came from which source, which was never written
 *    down.
 *  - **Research levels are not refunded** even though `rp_gain` and
 *    `rp_drop_chance` now grant less per level. Same rule the v21 upgrade
 *    rebalance followed: a balance migration re-prices the future, not the past.
 *  - **The `watch` block is not touched.** It was always saved correctly; the
 *    v24 fix is on the *load* side (`Game.applyPersistedState`), so an existing
 *    save's campaign comes back the first time the fixed build reads it.
 *
 * The one repair it does perform is the risk histogram: `MAX_RISK_CEILING`
 * went 7 -> 8 for the Crown of Thorns unlock, so the array gains a slot.
 * `normalizeWatch` already rebuilds it to `MAX_RISK_CEILING + 1` on every
 * load, so this is belt-and-braces for a save that skips normalization.
 */
function migrateV23toV24(data: Record<string, unknown>): void {
  const watch = data.watch as Record<string, unknown> | undefined;
  if (isObject(watch) && isObject(watch.counters)) {
    normalizeWatch(watch);
  }
  const apSpent = (data.prestige as Record<string, unknown> | undefined)?.apSpent;
  if (isObject(apSpent)) clampPerkLevels(apSpent as Record<string, unknown>, AP_PERK_BY_ID);
}
```

(`ap_auto_upgrader` going 1 → 3 levels is a *widening*, so no existing level is out of range; the `clampPerkLevels` call is there because the same helper is the project's standing answer to a perk-table change and costs nothing.)

---

## 9. Tests

### 9.1 `tests/watch.test.ts`

- `expect(WATCH_CHAPTERS).toHaveLength(12)` → `20`; `WATCH_CHAPTER_COUNT` → `20`.
- `expect(UNLOCK_IDS).toHaveLength(12)` → `20`.
- `emptyCounters()` and `metrics()` build `new Array(MAX_RISK_CEILING + 1).fill(0)` from the constant, so the ceiling change needs no edit there.
- Add a case to the manager block: **the campaign survives a reload**. Build a `WatchState` with two ids in `completed` and non-zero counters, round-trip it through `SaveManager.snapshot` → `JSON.parse(JSON.stringify(...))` → the restore block from §1.1 (extracted as a small exported helper if that is easier to test than `Game`), and assert `completed` and every counter come back equal. This is the regression the whole of §1.1 exists to prevent.

### 9.2 `tests/prestige-ap.test.ts`

- `perkCost(AP_PERK_BY_ID.ap_auto_upgrader, 0)` is still `12`; add `expect(perkCost(AP_PERK_BY_ID.ap_auto_upgrader, 1)).toBe(24)` and `(…, 2)).toBe(48)`.
- Add: a manager with `{ ap_auto_upgrader: 3 }` reports `getAutoBuyCount() === 3`; with `{}` and no `overseer` it reports `0`; with `externalAutomation('autoBuy') === true` it reports `1`.
- The `AP_PERKS` length assertion (23) is unaffected — no perk is added or removed.

### 9.3 New `tests/research-economy.test.ts`

- `getPassiveRPRate(100, 0) * 3600` is within 1% of 120; `getPassiveRPRate(400, 0) * 3600` within 1% of 240.
- `getPassiveRPRate(w, 2.0) === 3 * getPassiveRPRate(w, 0)` — the Increased Focus ceiling.
- `SaveManager.computeOfflineProgress` and `ResearchTree.getPassiveRPRate` agree: build a `persisted` stub at a known `lifetimeHighestWave` and `research: { rp_gain: 10 }`, and assert `rpEarned` equals `floor(rate * elapsed)` computed from the tree. This pins the duplicated formula the two files carry.
- Summing `getResearchCost` over every node's every level equals **66,730**.
- The weighted-mean `rpChance` over `spawnPoolForWave(100)` is 0.0185 ± 0.0005.

### 9.4 `sim/checks.ts`

- The three `AutomationManager` stubs (`:328`, `:426`) pass a `prestige` object; each needs `getAutoBuyCount: () => 3` (or `1` where a single purchase is the point).
- The check `'auto-buy keeps buying within one tick'` (`bought.length > 1`) is now wrong by construction. Replace with two checks:
  - `'auto-buy at level 1 buys exactly one per tick'` — a stub with `getAutoBuyCount: () => 1` and a full purse produces `bought.length === 1` after `tick(11)`.
  - `'auto-buy at level 3 buys exactly three per tick'` — same with `() => 3` and `bought.length === 3`.
- Add an RP-faucet check next to the ability checks: at wave 100 with every bonus maxed, modelled RP per hour is under 1,200 (§2.9 says ≈ 805; the ceiling leaves headroom for a tuning nudge).

### 9.5 `tests/abilities.test.ts`

- Add: for every ability, `abilityManaCost(def, def.maxLevel) / def.manaCost` is between 1.4 and 1.75.
- Add: for every ability, the max-level power multiple divided by the max-level mana multiple exceeds 1.1 (the §6.3 table's floor is 1.16). Power multiple is `effectValue` for the scalar abilities and `effectValue × count` for Rocket Barrage; the four buff abilities use `effectValue × duration`.
- Add: `renderAbilityTooltip` output contains no `Duration` row when `def.duration === 0` and `durationPerLevel === 0`, and contains a `→` arrow only when `next` is non-null.
- Any existing assertion referencing `manaCostPerLevel` must be rewritten against `abilityManaCost`.

### 9.6 `tests/save.test.ts`

- The version assertion moves to 24.
- Add a v23 → v24 round trip: a v23 payload with a 8-slot `riskWaves` array comes back with 9 slots, and its `watch.completed` survives.

---

## 10. Docs

| File | Change |
|---|---|
| `docs/watch-system.md` | "twelve ordered chapters … twelve content unlocks" → twenty; add the eight new chapters and their consumers to the unlock table; add a paragraph stating that the block is permanent and is restored in `Game.applyPersistedState` (naming the bug this fixes, so it is not re-introduced). |
| `AGENTS.md` | Same twelve → twenty in the `docs/watch-system.md` row. |
| `docs/research-system.md` | New passive-RP formula, the elite drop roll, the new cost table, and the §2.9 income table. |
| `docs/automation-system.md` | The whole "Auto-Buy … Buys cheapest affordable upgrade" row is stale twice over (strategies landed earlier; the per-tick budget lands now). Rewrite the feature table, document `getAutoBuyCount`, and note the tab move. |
| `docs/ability-system.md` | Line 88's `manaCost(level) = def.manaCost + def.manaCostPerLevel × (level − 1)` becomes the §6.2 formula; update the per-ability table's mana column and the three changed power curves; document the new tooltip rows. |
| `docs/ui-system.md` | Add the Automation tab to the panel list and `AutomationPanel` to the component table; note the Codex-prose helper is shared by `CodexPanel` and `StatsPopup`. |
| `docs/data-formulas.md` | Drop `manaCostPerLevel` from the ability-def field list; add `MANA_COST_GROWTH_PER_LEVEL`. |
| `docs/save-system.md` | Add the v23 → v24 row. |
| `docs/prestige-system.md` | Auto-Upgrader is a three-level perk at 12 / 24 / 48 AP. |

---

## 11. Task order and verification

Each step ends green. Do not batch them.

1. **§0** — resolve the two merge conflicts; `npm run typecheck && npm test` pass.
2. **§1.1** — the watch restore, plus the §9.1 round-trip test. *Verify:* start a game, complete a chapter (or hand-edit a save), ascend, reload the page, confirm the Journal still shows the chapter complete and the counters non-zero.
3. **§1.3 / §1.4** — data + eight consumers + the §9.1 length updates. *Verify:* `npm test`; the Journal's "road ahead" lists chapters 13–20; the risk dial reaches 8 with a hand-granted `crown_of_thorns`.
4. **§3** — Auto-Upgrader levels and the per-tick budget, plus §9.2 and §9.4. *Verify:* with L1 and a huge gold pile, exactly one upgrade level is purchased every 10 s; with L3, three.
5. **§4** — the Automation tab. *Verify:* the tab appears under Prestige on desktop and in the mobile sheet; every toggle still works; the target-wave input still drives auto-ascend; the Transcendence tab no longer shows any of it.
6. **§2** — the research rebalance, plus §9.3. *Verify:* `npm run checks`; play 10 minutes at wave ~60 and confirm RP/hour is roughly a quarter of what the pre-change build gives from the same save.
7. **§6** — ability mana + power curves, plus §9.5's first two cases. *Verify:* `npm run sim` — the per-mana damage table in `sim/checks.ts:363` should rise across the board and no ability should regress.
8. **§7** — the tooltip rewrite, plus §9.5's last case. *Verify:* hover every one of the ten abilities on the Abilities tab, on the ability bar and through the mobile popover; check the `→` column for a build with a mana discount now points at a reachable number.
9. **§5** — the Codex-prose extraction and the tooltip restyle. *Verify:* open Stats → `?` on RP Drop Chance, Ability Cost and Auto-buy Interval; all three read as friendly names, show a category chip and a stat list, and the "Open in Codex" link lands on the matching entry.
10. **§8** — the save version bump and migration, plus §9.6.
11. **§10** — docs.
12. Final: `npm run typecheck && npm test && npm run checks && npm run sim && npm run build`.

---

## 12. Tuning dials

If playtesting says a number is off, these are the single-line levers, in the order they are worth reaching for.

| Symptom | Lever | File |
|---|---|---|
| RP still arrives too fast | `0.20` in `getPassiveRPRate` (and the identical constant in `SaveManager.computeOfflineProgress`) | `ResearchTree.ts`, `SaveManager.ts` |
| RP too slow at depth | swap `Math.sqrt(wave)` for `Math.pow(wave, 0.65)` — 12·w^0.65 pays 250/h at wave 100 and 500/h at wave 300 | `ResearchTree.ts`, `SaveManager.ts` |
| Elites feel unrewarding | `ELITE_RP_DROP_CHANCE` (0.25) | `EnemyManager.ts` |
| Loot Insights feels pointless | `effectPerLevel` / the L10 override on `rp_drop_chance` | `research.ts` |
| The tree is unaffordable | the §2.8 cost column, uniformly | `research.ts` |
| Auto-buy too slow / too fast | `BASE_AUTO_BUY_INTERVAL` (10) and `MIN_AUTO_BUY_INTERVAL` (3) | `AutomationManager.ts` |
| Auto-Upgrader too strong | `maxLevel` on `ap_auto_upgrader` (3) and its `costScaling` (2) | `prestige.ts` |
| Abilities still not worth levelling | `MANA_COST_GROWTH_PER_LEVEL` (0.05) | `abilities.ts` |
| The new chapters are unreachable | the `reach_wave` targets in chapters 13–20 | `watch.ts` |
| Crown of Thorns is a trap | `RISK_HP_PER_STEP` / `RISK_GOLD_PER_STEP` | `pacing.ts` |
