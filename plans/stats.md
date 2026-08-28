# Stats, Codex & HUD readouts — four fixes

**Status:** plan, not yet implemented.

**Scope:** four independent parts. They can land in any order, but Part A ships
the data table (`src/data/codex.ts`) that Parts C and D both link into, so
**do Part A first** if you are doing more than one.

| Part | Complaint | Deliverable |
|---|---|---|
| **A** | Dozens of effects (execution damage, kill frenzy, focus stack, overwatch damage, armour penetration, crit follow-up, splash radius, splash fraction, …) are named in talents/passives/blessings and explained nowhere. | A **Codex** page: one closed table of player-facing explanations, a new `codex` panel tab, and a coverage test that makes an unexplained `StatKey` a build failure. |
| **B** | The milestone strip's hover flyout covers the play area and swallows pointer events around the bottom-left corner. | Delete the flyout. The collapsed pill survives as a **link into the Progression tab**, which already lists every milestone. |
| **C** | The tower Stats readout is a flat 17-row dump with a duplicate hover tooltip. | Delete the tooltip. Rebuild the popup on the shared `Modal` shell with **sub-tabs**, grouped/ordered rows driven by a declarative table, and every row linking to its Codex entry. |
| **D** | The enemy readout shows the same seven stats for every type and grows to a wall of columns. | Delete the tooltip. Rebuild the popup as a **roster + detail sub-page** view: pick an enemy from an icon strip, see its icon, description, effects and only the stats that mean something for that type. |

**Nothing here touches the save format, the simulation, or any balance number.**
`SaveManager`'s version stays at 16. If you find yourself editing
`src/systems/`, `src/game/Game.ts` beyond the two additive changes named in
C.4 and D.6, or any `src/data/` tuning constant, stop — you have gone out of
scope.

---

## 0. What exists today

Read all of these before writing anything.

| Where | What it does now |
|---|---|
| `src/ui/HUD.ts:152-161` | Fields: `statsBtn`, `statsTooltip`, `statsPopup`, `statsPopupBody`, `statsInfo`, `enemyStatsBtn`, `enemyStatsTooltip`, `enemyStatsPopup`, `enemyStatsPopupBody`, `enemyStatsInfo`. |
| `src/ui/HUD.ts:289-297` | `setStatsInfo` — re-renders the tooltip *and* the popup body whenever either is visible. |
| `src/ui/HUD.ts:299-326` | `renderStatsContent` — one `setInnerHTML` of 17 hard-coded `.stat-row`s, no grouping, no order beyond source order. |
| `src/ui/HUD.ts:328-351` | `renderGoldBreakdown` — the *only* good part of the current popup: per-source attribution for the gold multiplier. **Keep this behaviour**; it moves into the new "Sources" sub-tab. |
| `src/ui/HUD.ts:353-363` | `openStatsPopup` / `closeStatsPopup`. |
| `src/ui/HUD.ts:365-408` | `setEnemyStatsInfo`, `renderEnemyStatsContent` (a grid of identical 7-row columns), `openEnemyStatsPopup` / `closeEnemyStatsPopup`. |
| `src/ui/HUD.ts:624-730` | `render()` builds `statsWrap`, both buttons, both tooltips, and appends both bespoke popup overlays to `document.body`. |
| `src/ui/HUD.ts:1207-1226` | The mobile "More" popover's `moreStatsBtn` / `moreEnemyStatsBtn`, which call the same open/close methods. |
| `src/types.ts:708-728` | `StatsInfo` — 17 fields plus `goldSources`. |
| `src/types.ts:730-739` | `EnemyWaveStatsEntry` — `{ type, hp, speed, armor, magicResist, damage, fireRate, gold }`. |
| `src/ui/UIManager.ts:1327-1362` | `pushEnemyStats` — rebuilds on wave change; **re-derives the unlock-wave list by hand** (`if (wave >= 12) types.push('splitter')` …), duplicating `ENEMY_DEFS[t].unlockWave`. |
| `src/ui/UIManager.ts:1364-1390` | `pushFrameStats` — fills `StatsInfo` from `state.tower` + cached gold data. |
| `src/game/Game.ts:3197-3231` | `computeStatsInfo` — the authoritative producer. `this.lastResolved` (a full `ResolvedStats`) is already in hand at this point. |
| `src/ui/MilestoneStrip.ts` (334 lines) | Collapsed pill + a hover/click-pinned flyout of up to 3 entries, a `document`-level click listener, and a pulse timer. |
| `src/styles/main.css:728-880` | `.hud-stats-wrap`, `.hud-stats-btn`, `.hud-stats-tooltip`, `.hud-stats-popup*`, `.enemy-stats-*`. |
| `src/styles/main.css:1459-1480` | `.stat-breakdown` / `.stat-subrow` (used by the gold breakdown). |
| `src/styles/main.css:3483-3707` | The whole milestone strip block. |
| `src/styles/main.css:4443-4500` | Mobile overrides for the strip, plus `.hud-stats-wrap { display: none }` on mobile. |
| `src/styles/main.css:4555-4562` | Desktop corner-stack overrides for the strip. |
| `src/styles/main.css:7151-7152` | `.milestone-entry-glyph > .icon`, `.milestone-collapsed-glyph > .icon`. |
| `src/ui/Modal.ts` | The one modal shell (focus trap, Escape, backdrop, `Modal.anyOpen()` which `UIManager.isModalOpen()` reads). Parts C and D adopt it. |
| `src/ui/navGroups.ts` | The single nav table. Adding a tab is one entry here plus one in `PanelTab`. |
| `src/data/enemies.ts` | `ENEMY_LABELS`, `ENEMY_DEFS`, `ENEMY_BEHAVIOR`, `BOSS_ENCOUNTER`, `BOSS_PATTERN_NAMES`, `BOSS_PATTERN_HINTS`, `bossPatternsForWave`, `spawnPoolForWave`, `armorDamageMultiplier`, `ARMOR_SOFTENING`. |
| `src/data/milestones.ts:60-99` | `ENEMY_INTRO_MILESTONES` — already has player-facing one-liners for 11 of the 13 enemy types. Part D **reuses this copy** rather than writing a second version. |
| `src/stats/keys.ts` | `StatKey` (the closed union Part A must cover), `STAT_BASES`, `STAT_CLAMPS`. |

### Repo conventions this plan is held to

1. **Closed `Record` over a union + a coverage test.** Every content table in
   `src/data/` is a `Record<SomeUnion, T>` so a new member cannot ship without
   copy, and `tests/content-coverage.test.ts` rejects placeholder text. Both
   new tables (`CODEX`, `ENEMY_CODEX`) follow this.
2. **No literal colours in components** — use the `--fx-*` / `--rgb-*` /
   `--text-*` tokens in `src/styles/tokens.css`.
3. **No literal `z-index` above 5** — quote a `--z-*` rung.
   `tests/z-index.test.ts` enforces it.
4. **Numbers in copy come from the constant, not from a typist.** Every figure
   in a Codex entry is interpolated from the tuning constant that produces it
   (`TALENT_TUNING`, `BLESSING_TUNING`, `BOSS_ENCOUNTER`, `ENEMY_BEHAVIOR`,
   `ARMOR_SOFTENING`, `SPLASH_FRACTION_CAP`, `OVERWATCH_RANGE_FRACTION`, …).
   A hard-coded "5 stacks" in a string is a bug waiting for the next balance pass.
5. **Do not add icons to the sprite.** `public/icons/sprite.svg` is fetched by a
   network script and `tests/content-coverage.test.ts` asserts the sprite
   matches `ICON_IDS` exactly *and* that nothing is pinned unused. Every icon
   this plan needs must be an existing `IconId`. The two currently-unused ids
   (`life-tap`, `target-shot`, listed in `ALLOWED_UNUSED`) may be adopted — if
   you adopt one, remove it from `ALLOWED_UNUSED` in that test.
6. **DOM over `innerHTML` for anything with a loop.** Use `document.createElement`
   plus the `src/utils/dom.ts` helpers (`setText`, `setStyle`, `toggleClass`,
   `setDisplay`) — those helpers exist because they skip the write when the
   value is unchanged, which is what keeps the ~10 Hz UI tick off the layout path.
   `setInnerHTML` is acceptable only for a fixed, loop-free block.

### Commands to run after every part

```bash
npm run typecheck && npm run test
```

---

# Part A — The Codex

**Goal:** every mechanic the game can put a number on has one place that says
what it does, in the player's language, with the real figure interpolated from
the constant that drives it. A new `StatKey` must not compile until someone has
either written its entry or explicitly declared it self-evident.

## A.1 New file — `src/data/codex.ts`

### Types

```ts
import type { IconId } from './icons';
import type { StatKey } from '../stats/keys';

/** The tabs the Codex page splits into, in reading order. */
export type CodexCategory =
  | 'offense'    // how a shot becomes damage
  | 'defense'    // how the tower survives
  | 'economy'    // gold, XP, orbs, interest
  | 'magic'      // mana, abilities, procs
  | 'run'        // waves, risk, momentum, prestige currencies
  | 'enemies';   // enemy-side mechanics and modifiers

export const CODEX_CATEGORIES: readonly CodexCategory[] =
  ['offense', 'defense', 'economy', 'magic', 'run', 'enemies'];

export const CODEX_CATEGORY_LABELS: Record<CodexCategory, string> = {
  offense: 'Offense',
  defense: 'Defense',
  economy: 'Economy',
  magic: 'Magic',
  run: 'The Run',
  enemies: 'Enemies',
};

export const CODEX_CATEGORY_ICONS: Record<CodexCategory, IconId> = {
  offense: 'crossed-swords',
  defense: 'bordered-shield',
  economy: 'two-coins',
  magic: 'magic-swirl',
  run: 'swords-emblem',
  enemies: 'orc-head',
};

export interface CodexEntry {
  /** Stable kebab-case id. Deep-linked from stat rows, so do not rename casually. */
  id: string;
  /** The name the player sees on a talent / passive / blessing card. */
  term: string;
  category: CodexCategory;
  icon: IconId;
  /** One line, no period-free fragments: this is the collapsed row. */
  summary: string;
  /**
   * Two to four sentences. Says *when it fires*, *what it multiplies*, and
   * *what it does not stack with* where that is non-obvious. Every number is
   * interpolated from a tuning constant — never typed.
   */
  detail: string;
  /** Stats this entry explains. Drives `CODEX_BY_STAT` and the coverage test. */
  stats?: readonly StatKey[];
  /** Other entry ids worth reading next. Rendered as chips. */
  seeAlso?: readonly string[];
  /** Search aliases the term itself does not contain (e.g. 'bloodlust' for Kill Frenzy). */
  aliases?: readonly string[];
}
```

### The table

```ts
export const CODEX_ENTRIES: readonly CodexEntry[] = [ /* … */ ];

/** Built once at module load. Throws on a duplicate id. */
export const CODEX_BY_ID: Readonly<Record<string, CodexEntry>> = /* … */;

/** Reverse index: which entry explains this stat. */
export const CODEX_BY_STAT: Readonly<Partial<Record<StatKey, string>>> = /* … */;

export function codexForCategory(c: CodexCategory): CodexEntry[] { /* filter, stable order */ }

/**
 * Keys that need no entry because the label *is* the explanation.
 * Deliberately short and explicit: the coverage test proves the union is
 * (indexed ∪ self-evident) with no overlap and no remainder, so a new key
 * fails the build until it is classified.
 */
export const CODEX_SELF_EVIDENT: readonly StatKey[] = [
  'baseDamage', 'range', 'maxHp', 'maxMana', 'manaRegen', 'healthRegen',
  'goldAdditive',
];
```

`CODEX_BY_ID` and `CODEX_BY_STAT` are built in an IIFE that **throws** on a
duplicate id or a stat claimed by two entries — the same shape `GROUP_OF` in
`src/ui/navGroups.ts` uses.

## A.2 The entries to write

Every row below is one `CodexEntry`. The **Source of truth** column names the
constant the `detail` string must interpolate. Import it; do not retype its value.

`n` in the table below means "state the current number from that constant".

### Category `offense`

| id | term | icon | stats | Source of truth / what the detail must say |
|---|---|---|---|---|
| `fire-rate` | Fire Rate | `fast-arrow` | `fireRate` | Shots per second. Note it is a *cadence*: quick-shot and double-shot add shots without changing it. |
| `crit` | Critical Hits | `dead-eye` | `critChance`, `critMultiplier` | Chance rolls per shot; multiplier applies to the whole hit. Mention `critGold`, `critSplash`, `critIgnoreArmor` are separate riders. |
| `armor-pen` | Armour Penetration | `armor-punch` | `armorPen`, `armorPenFlat` | `ARMOR_SOFTENING` (= 20) and `armorDamageMultiplier` in `src/data/enemies.ts`. Armour is **not** a flat subtraction: a hit keeps `K / (K + armour)` of its damage. `armorPenFlat` subtracts from the armour *value* first, then `armorPen` removes that fraction of what is left. Worked example: a Tank at armour 3 keeps 20/23 = 87% of a hit; 8 flat pen takes it to 100%. |
| `execution` | Execution Damage | `guillotine` | `executeThreshold`, `executeMultiplier`, `talentExecuteBonus` | `PRESTIGE_EXECUTE_THRESHOLD` (`src/stats/contributors/prestige.ts`), `TALENT_EXECUTE_THRESHOLD` (`src/systems/ProjectileManager.ts:39`), `STAT_CLAMPS.executeThreshold.max`. **Two separate mechanics with the same name and they stack.** (1) The prestige/passive one: below `executeThreshold` of max HP a hit is multiplied by `1 + executeMultiplier`. (2) The talent one (`execution_damage_pct`): below a *fixed* 50% of max HP a hit is multiplied by `1 + talentExecuteBonus`. Say the threshold is capped at 50%. |
| `focus` | Focus | `concentration-orb` | `focusStackBonus` | `TALENT_TUNING.focusMaxStacks` and `ProjectileManager.tick`. Consecutive hits **on the same enemy** stack `focusStackBonus` each, to `n` stacks; hitting a different enemy resets to zero. Say plainly that it rewards single-target focus fire and does nothing for a piercing/splash build that spreads its hits. |
| `kill-frenzy` | Kill Frenzy | `enrage` | `killFrenzyPerStack` | `TALENT_TUNING.bloodlustMaxStacks`, `TALENT_TUNING.bloodlustSeconds`, `Game.ts:981-991`. Each kill adds a stack (max `n`) of a `baseDamage` **multiplier**; the whole buff expires `n` s after the last kill. Alias `bloodlust` — that is the internal buff id and the talent name. |
| `overwatch` | Overwatch Damage | `arrow-scope` | `overwatchDamage` | `OVERWATCH_RANGE_FRACTION` (`src/systems/ProjectileManager.ts:53`) and the `range_damage` evolution in `src/data/upgrades.ts:155`. Extra damage only on impacts **beyond `n`% of the tower's range**. It adds to the Overwatch evolution rather than replacing it. Say it is dead weight on a short-range build. |
| `boss-damage` | Boss Damage | `crowned-skull` | `bossDamageBonus` | Multiplies damage against `type === 'boss'` only. Mention it does not apply to a boss's summoned adds. |
| `crit-follow-up` | Crit Follow-Up | `double-shot` | `critFollowUpChance` | `TALENT_TUNING.critFollowUpDamage` and `Game.ts:4757-4760`. A critical hit has this chance to fire a second, free hit for `n`% of the shot's damage. The follow-up cannot itself crit-chain. |
| `splash` | Splash | `spiky-explosion` | `shotSplashRadius`, `shotSplashFraction` | `SPLASH_FRACTION_CAP` (`src/data/prestige.ts:765`) and the `composeShotSplash` comment in `src/stats/keys.ts`. **Two numbers with different composition rules**: radius takes the **largest** of every source (artillery core, Mortar blessing, Annihilation, talents); fraction **sums** and is capped at `n`%. Splash damage is that fraction of the hit, dealt to everything else inside the radius. |
| `pierce` | Piercing | `piercing-sword` | `pierceExtra` | Extra bodies one shot passes through. Note a Tank body-blocks — a shot never pierces past one (`ENEMY_BEHAVIOR_CONSUMERS.tank`). |
| `extra-shots` | Extra Shots | `arrow-cluster` | `doubleShotChance`, `extraProjectileChance` | Both roll per volley and both add a projectile without changing `fireRate`. |
| `quick-shot` | Quick Shot | `supersonic-arrow` | `quickShotChance`, `quickShotTime` | Chance for the next shot to arrive `n` s early. |
| `instant-kill` | Instant Kill | `reaper-scythe` | `instantKillChance` | Per-hit chance to kill outright. Say what it does **not** work on (bosses / anything not targetable). |
| `crit-riders` | Crit Riders | `barbed-star` | `critSplash`, `critIgnoreArmor` | Effects that fire only on a critical hit: splash on crit, and armour ignored on crit. |
| `magic-proc` | Magic Procs | `bolt-spell-cast` | `magicProcChance` | Chance a shot deals magic damage, which is reduced by enemy **magic resist** instead of armour. |
| `chilled-damage` | Chilled Damage | `frozen-arrow` | `chilledDamageBonus` | Bonus against a slowed/chilled enemy (`EnemyManager.isSlowed`). Names the slow sources: Frost Nova, the frost core, slow blessings. |
| `low-hp-damage` | Desperation | `heart-drop` | `lowHpDamageBonus` | `TALENT_TUNING.lowHpThreshold`. Bonus damage while the **tower** is below `n`% HP. |
| `shockwave` | Shockwave | `punch-blast` | `shockwaveSize`, `shockwaveCooldown` | Periodic ring around the tower. |
| `land-mines` | Land Mines | `land-mine` | `landMineDamage`, `landMineFrequency` | Note fliers and blinkers ignore ground effects (`ignoresGroundEffects`). |
| `charged-shot` | Charged Shot | `energy-arrow` | — | Not a stat: hold still on the battlefield for ~1.2 s and release for a heavy shot with pierce and splash. Cross-reference the keybinds overlay. |

### Category `defense`

| id | term | icon | stats | Source of truth / what the detail must say |
|---|---|---|---|---|
| `defense-armor` | Defense & Armour | `layered-armor` | `defense`, `armor` | Two different reductions: `defense` is flat, `armor` is a **fraction** capped by `STAT_CLAMPS.armor.max`. State the cap. |
| `dodge` | Dodge | `acrobatic` | `dodgeChance` | Capped at `STAT_CLAMPS.dodgeChance.max`. |
| `thorns` | Thorns | `spiked-armor` | `thorns` | Reflects a fraction of damage taken back to the attacker. |
| `lifesteal` | Lifesteal | `life-tap` | `lifesteal` | Heals the tower for a fraction of damage dealt. *(Adopting `life-tap` means deleting it from `ALLOWED_UNUSED` in `tests/content-coverage.test.ts`.)* |
| `mana-shield` | Mana Shield | `magic-shield` | `manaShieldFraction` | Capped by `STAT_CLAMPS.manaShieldFraction.max`. Spends mana to absorb a fraction of incoming damage. |
| `shield-charges` | Shield Charges | `energy-shield` | `shieldMaxCharges`, `shieldRechargeTime`, `shieldRechargeReduction` | `MIN_SHIELD_RECHARGE` in `src/stats/resolve.ts` and `STAT_CLAMPS.shieldRechargeReduction.max`. Each charge eats one hit; recharge cannot go below `n` s however much reduction is stacked. |
| `wall` | The Wall | `brick-wall` | `wallFraction`, `wallRegen`, `wallContactExtra` | An HP buffer in front of the tower. Fliers and blinkers walk through the contact band (`ignoresWallBand`). |
| `knockback` | Knockback | `mighty-force` | `knockbackForce` | Ground effects only — fliers and a blinking blinker ignore it. |
| `revive` | Revive Charges | `shining-heart` | `reviveCharges` | Additive on top of the `revive` evolution's single charge; integer. |
| `second-wind` | Second Wind | `regeneration` | `secondWindPower` | `TALENT_TUNING.secondWindThreshold`, `secondWindDamageRatio`, `secondWindSeconds`. Fires once per run when the tower drops below `n`%. |

### Category `economy`

| id | term | icon | stats | Source of truth / what the detail must say |
|---|---|---|---|---|
| `gold-multiplier` | Gold Multiplier | `two-coins` | `goldMultiplier` | `resolveStats` in `src/stats/resolve.ts`. **The composition rule**: every additive source is summed into `1 + Σ`, and only then do the flat multipliers apply. Point at the Stats popup's Sources tab for the live attribution. |
| `gold-on-kill` | Gold Riders | `coins-pile` | `goldOnKill`, `critGold`, `waveGold` | Flat gold per kill, extra on a crit kill, and a lump on wave clear. |
| `gold-luck` | Gold Luck | `clover` | `goldLuckChance`, `doubleGoldChance` | Per-drop rolls; `doubleGoldChance` is capped at 100%. |
| `orbs` | Loot Orbs | `extraction-orb` | `orbValueBonus` | Click one for full value; left alone it drifts home for 40%. Cross-reference `docs/loot-system.md`'s idle-parity note. |
| `momentum` | Momentum & Combo | `fast-forward-button` | `momentumGainBonus` | `src/data/pacing.ts` combo tiers. Calling a wave early banks momentum for every second skipped. |
| `windfall` | Windfall | `open-treasure-chest` | `windfallMultiplier` | `TALENT_TUNING.windfallInterval`, `windfallEquipmentThreshold`. |
| `interest` | Interest | `gold-mine` | `interestRate` | `TALENT_TUNING.interestCapBase` and `STAT_CLAMPS.interestRate.max`. Paid on banked gold, capped. |
| `upgrade-discount` | Upgrade Discount | `receive-money` | `upgradeCostDiscount` | Applies to the upgrade cost formula, not to ability upgrades. |
| `equipment-find` | Equipment Find | `knapsack` | `equipmentFindChance` | Raises the drop chance, not the rarity. |
| `xp-gain` | XP Gain | `progression` | `xpGainMultiplier` | Tower XP only — not ability XP, not passive XP. |
| `auto-buy` | Automation Speed | `clockwork` | `autoBuyIntervalReduction` | Shortens the auto-buy tick in `AutomationManager`. |

### Category `magic`

| id | term | icon | stats | Source of truth |
|---|---|---|---|---|
| `ability-cost` | Ability Cost & Cooldown | `hourglass` | `abilityCostMultiplier`, `abilityCooldownMultiplier` | Both are **multipliers below 1** and both are floored at `STAT_CLAMPS…min` (0.1). |
| `ability-damage` | Ability Damage | `explosion-rays` | `abilityDamageMultiplier`, `meteorDamageBonus`, `chainBounceBonus`, `slowStrengthBonus`, `berserkFireBonus` | Which abilities each rider touches, by name. |
| `buff-duration` | Buff Duration | `extra-time` | `buffDurationBonus` | Extends every ability buff registered through `BuffRegistry`. |
| `ability-echo` | Echo | `echo-ripples` | `abilityEchoChance` | Chance to re-cast an ability for free; capped by `STAT_CLAMPS.abilityEchoChance.max`. |
| `mana-on-kill` | Soul Harvest | `chalice-drops` | `manaOnKillFraction` | `Game.ts:993-996` — a fraction of **max** mana per kill; capped. |

### Category `run`

| id | term | icon | stats | Source of truth |
|---|---|---|---|---|
| `wave-skip` | Wave Skip | `checkered-flag` | `waveSkipChance`, `intermissionMultiplier`, `headStartWaves` | Per-wave skip roll, a shorter intermission, and the waves a fresh run starts ahead by. |
| `risk-dial` | Risk & Threat | `rolling-dices` | — | `src/data/pacing.ts` risk levels 0-5 and `ENEMY_THREAT_CLASS`. What raising risk buys and costs. |
| `elites` | Elites & Auras | `spiked-halo` | — | `eliteChanceForWave`, `ELITE_HP_MULT`, `ELITE_GOLD_MULT`, `ELITE_RP_DROP` and the five aura names in `src/systems/EnemyManager.ts`. One line per aura: haste, vitality, thorns, greed, retribution. |
| `boss-phases` | Boss Phases | `crown` | — | `BOSS_ENCOUNTER.phaseThresholds`, `BOSS_PATTERN_NAMES`, `BOSS_PATTERN_HINTS`, `BOSS_ENCOUNTER.enrageDelay`/`enrageInterval`, `swiftKillSeconds`, `flawlessApBonus`. |
| `research` | Research Points | `brain` | `rpDropChanceBonus` | Where RP comes from and that elites always drop one. |
| `prestige` | Ascension & Transcendence | `star-gate` | — | `ASCENSION_UNLOCK_WAVE`, `TRANSCENDENCE_UNLOCK_AP`. What each reset keeps and wipes. |
| `blessings` | Blessings | `glowing-artifact` | — | `BLESSING_MAX_PICKS`, the draft cadence, that they are run-scoped. |
| `contracts` | Contracts | `treasure-map` | — | Three rolling run-scoped objectives; the AP bonus and its cap. |
| `cores` | Tower Cores | `nested-hexagons` | — | Five cores, run-scoped selection, AP-unlocked. |

### Category `enemies`

| id | term | icon | stats | Source of truth |
|---|---|---|---|---|
| `enemy-armor` | Enemy Armour & Magic Resist | `metal-plate` | — | `armorDamageMultiplier` again, from the enemy side, plus what magic resist reduces. Links to `armor-pen` and `magic-proc`. |
| `enemy-modifiers` | Enemy Modifiers | `eclipse` | `enemyHpMult`, `enemySpeedMult`, `enemyDamageMult`, `enemyHpReduction` | Blessing/mutator multipliers on the enemy side; they **compose** with the wave mutator rather than replacing it (`src/stats/keys.ts` comment). Note the floors in `STAT_CLAMPS`. |
| `wave-modifiers` | Wave Modifiers | `vertical-banner` | — | 9 mutators, offered on boss waves, 3-wave duration with escalating rewards. |
| `targetability` | Untargetable Enemies | `all-seeing-eye` | — | `isTargetable` — a burrowed burrower, a splitter child inside spawn protection, and a boss mid-phase-flash are on the field and cannot be shot. |

> **Check before you finish A.2:** every `StatKey` in `src/stats/keys.ts` now
> appears in exactly one entry's `stats` array or in `CODEX_SELF_EVIDENT`. The
> test in A.5 will tell you which ones you missed — run it early and often.

## A.3 New file — `src/ui/CodexPanel.ts`

A panel, not a modal: it reuses the existing rail / mobile-sheet machinery for
free and is a place a player can sit and read.

```ts
export class CodexPanel {
  mount(parent: HTMLElement): void;
  unmount(): void;
  update(): void;               // no-op; the content is static
  /** Deep link from a stat row or a "see also" chip. */
  focusEntry(id: string): void; // select the entry's category, scroll to it, flash it
}
```

Structure it builds into `parent`:

```
h3.panel-header                      "Codex"
input.codex-search                   placeholder "Search effects…"
div.codex-tabs        role=tablist   one button.codex-tab per CodexCategory (icon + label)
div.codex-list                       the entries of the active category
  article.codex-entry[data-entry-id]
    header.codex-entry-head          span.codex-entry-icon (renderIcon) + h4.codex-entry-term
    p.codex-entry-summary
    p.codex-entry-detail
    div.codex-entry-stats            one span.codex-stat-chip per `stats` entry, labelled
                                     from the Part C display table (C.2), not from the raw key
    div.codex-entry-links            one button.codex-link per `seeAlso` id → focusEntry(id)
```

Rules:
- Build with `document.createElement`; no `innerHTML` in the loop (convention 6).
- The search box filters **across all categories** and, while non-empty, shows a
  flat result list with the category tab strip in a `is-searching` state. Match
  on `term`, `summary`, `aliases`, case-insensitively. Empty result → a
  `.codex-empty` line.
- The active category persists to `localStorage` under `codex.category`, in a
  `try/catch` like `PANEL_COLLAPSED_KEY` in `UIManager`.
- `focusEntry(id)` clears the search, switches to that entry's category,
  `scrollIntoView({ block: 'nearest' })`, and adds `is-flash` for one
  `--dur-ambient`, removed on `animationend`.
- Keyboard: the tab strip is `role="tablist"` with `role="tab"` buttons and
  `aria-selected`; Left/Right move between tabs. Match `MobileSheet`'s existing
  tab strip markup if it is close enough to reuse the CSS.

## A.4 Wiring

1. **`src/types.ts:71`** — add `'codex'` to the `PanelTab` union.
2. **`src/ui/navGroups.ts`** — add `{ id: 'codex', label: 'Codex' }` to the
   `progress` group's `tabs`, **after** `progression` and before `achievements`.
   (Keeping it in an existing group avoids a sixth bottom-nav item, which does
   not fit a 375 px phone.)
3. **`src/ui/UIManager.ts`**
   - import and construct `private readonly codexPanel = new CodexPanel()`
     alongside `statsPanel` (~line 180 for the field, ~line 560 for the ctor);
   - add `case 'codex': this.codexPanel.mount(body); break;` to the mount switch
     in `mountMobileTab` (`UIManager.ts:812-825`) **and** to the desktop tab
     switch — find it by searching for the sibling `case 'stats':` occurrences
     and add a `codex` case next to every one of them (mount, update, and the
     desktop `showTab` switch if it is separate);
   - `case 'codex':` in the update switch is a no-op call to
     `this.codexPanel.update()`;
   - add a public method used by Parts C and D:
     ```ts
     /** Open the Codex on a specific entry (from a stat row or an enemy card). */
     openCodex(entryId?: string): void {
       this.showTab('codex');                 // desktop; on mobile open the sheet on 'codex'
       if (entryId) this.codexPanel.focusEntry(entryId);
     }
     ```
     On mobile (`this.isMobile`) route through `loadSheetGroup('progress')` +
     `this.mobileSheet.open('codex')` exactly as `handleMobileNav` does.
4. **`src/ui/KeybindsOverlay.ts`** — add to the `Interface` group:
   `{ keys: ['Progress → Codex'], action: 'Look up any effect by name' }`.
   (No new hotkey: the keydown handler in `main.ts` stays untouched.)

## A.5 New test — `tests/codex.test.ts`

```ts
describe('codex', () => {
  it('has unique ids');                                  // Set(ids).size === ids.length
  it('classifies every StatKey exactly once');           // STAT_KEYS ⊆ (indexed ∪ selfEvident),
                                                         // and the two sets are disjoint
  it('claims no stat twice');                            // two entries cannot list the same key
  it('only lists real StatKeys');                        // every entry.stats member ∈ STAT_KEYS
  it('only points seeAlso at entries that exist');
  it('gives every entry a real category and a real icon');  // ICON_IDS
  it('writes a real summary and detail, not a placeholder'); // summary ≥ 20 chars,
                                                             // detail ≥ 80 chars,
                                                             // no 'TODO' / 'TBD'
  it('fills every category');                            // codexForCategory(c).length > 0 ∀ c
  it('interpolates its numbers');                        // see below
});
```

The last one is the important guard. Assert that the entries which *must* quote
a tuning number actually contain the current value, by reading the constant:

```ts
expect(CODEX_BY_ID['focus'].detail).toContain(String(TALENT_TUNING.focusMaxStacks));
expect(CODEX_BY_ID['kill-frenzy'].detail).toContain(String(TALENT_TUNING.bloodlustMaxStacks));
expect(CODEX_BY_ID['overwatch'].detail).toContain(String(OVERWATCH_RANGE_FRACTION * 100));
expect(CODEX_BY_ID['splash'].detail).toContain(String(SPLASH_FRACTION_CAP * 100));
expect(CODEX_BY_ID['armor-pen'].detail).toContain(String(ARMOR_SOFTENING));
expect(CODEX_BY_ID['crit-follow-up'].detail).toContain(String(TALENT_TUNING.critFollowUpDamage * 100));
```

If a balance pass moves the constant, the test fails and the copy gets fixed —
which is the entire point of convention 4.

## A.6 Test edits this part forces

- `tests/content-coverage.test.ts:755-768` — add `codex: true` to `ALL_TABS`.
- `tests/content-coverage.test.ts:665-684` — add
  `...CODEX_ENTRIES.map(e => [\`codex:${e.id}\`, e.icon] as [string, IconId])` and
  `...CODEX_CATEGORIES.map(c => [\`codexcat:${c}\`, CODEX_CATEGORY_ICONS[c]] as [string, IconId])`
  to `referenced`.
- If you adopted `life-tap` (or `target-shot`), drop it from `ALLOWED_UNUSED`
  at `tests/content-coverage.test.ts:717`.

## A.7 CSS — append a new block to `src/styles/main.css`

Add at the end of the file, under a banner comment
`/* ── Codex (plans/stats.md Part A) ── */`. Selectors:
`.codex-search`, `.codex-tabs`, `.codex-tab`, `.codex-tab.is-active`,
`.codex-list`, `.codex-entry`, `.codex-entry.is-flash`, `.codex-entry-head`,
`.codex-entry-icon`, `.codex-entry-term`, `.codex-entry-summary`,
`.codex-entry-detail`, `.codex-stat-chip`, `.codex-link`, `.codex-empty`,
plus `.codex-entry-icon > .icon { --icon-size: 22px; }` next to the other
`> .icon` rules around line 7151.

Constraints: tokens only for colour/space/radius; no `z-index` (nothing here
overlays anything); `.codex-tab` and `.codex-link` get `min-height: 44px`
inside the `@media (max-width: 768px)` block; `.codex-list` gets
`overscroll-behavior: contain` (the `§9.C` scroll-chaining rule in
`tests/touch-targets.test.ts`).

---

# Part B — Retire the milestone flyout

**Decision:** keep the collapsed pill, delete the flyout.

Why not delete the whole thing: the pill itself is a 26 px chip pinned in the
bottom-left corner stack above the contract tracker, and it is the only always-on
answer to "what am I pushing toward". It is not what is disruptive. What is
disruptive is the **`.milestone-strip` flyout**: on hover (a 0 px-delay hover, on
an element sitting over the play area) it expands three `pointer-events: auto`
pills up to 240 px wide, and on mobile it becomes a column that can grow to most
of the viewport height. It also duplicates the Progression tab, which already
lists **every** unlock, earned ones included (`src/ui/ProgressionPanel.ts`).

So: the pill becomes a **button that opens the Progression tab**, and the flyout,
its hover timers, its document-level click listener and its pulse animation all go.

> If the user later says "just remove it": delete `MilestoneStrip.ts`,
> `HUD.renderMilestoneStripSlot()` and its call site, every `milestone-*`
> selector, and the `milestoneStrip` field/`update`/`refresh` calls in
> `UIManager` — steps B.2-B.5 below are then simple deletions rather than edits.
> Do **not** delete `src/data/milestones.ts`: `ProgressionPanel` reads it.

## B.1 Rewrite `src/ui/MilestoneStrip.ts`

Keep the file name and the exported class name (imports, docs and the
`renderMilestoneStripSlot` contract all stay put). The class shrinks to roughly
this:

```ts
export interface MilestoneStripHandlers {
  getProgress: () => { currentWave: number; apThisCycle: number };
  getUpcoming: () => MilestoneDef[];
  /** Opens the Progression tab. Wired by UIManager. */
  onOpenProgression: () => void;
}

export class MilestoneStrip {
  constructor(root: HTMLElement, handlers: MilestoneStripHandlers);
  /** Rebuilds the pill when the next milestone changes. Cheap; early-outs on no change. */
  refresh(): void;
  /** Per-frame: advances nothing but the fill width. Keep the signature — UIManager calls it. */
  update(dt: number): void;
  /** Kept as a no-op-safe one-shot pulse on the pill itself. */
  flashLastEntry(): void;
}
```

Delete from the class: `entries`, `EntryEls`, `hoverContainer`, `isHovered`,
`hoverTimer`, `isClickPinned`, `MAX_VISIBLE_ENTRIES`, `renderEntry`, every
`mouseenter`/`mouseleave` listener, and the `document.addEventListener('click', …)`.

Keep: `collapsedBtn`, `collapsedFill`, `collapsedWaveTag`, `collapsedGlyph`,
`collapsedLabel`, `updateCollapsed`, `computeFill`, `kindLabel`, and the
`announcedSet` early-out in `refresh()` (it is what keeps the ~10 Hz tick off
the DOM).

Changes to what survives:
- `refresh()` reads only `getUpcoming()[0]`.
- `refreshProgress()` sets only `collapsedFill`'s width.
- The click handler becomes `this.handlers.onOpenProgression()` — no toggling.
- Give the button a real affordance: `cursor: pointer` (it is currently
  `cursor: default`), `title` = `` `${label} — ${detail}. Open Progression.` ``,
  `aria-label` = `` `Next milestone: ${label}. Open Progression.` ``.
- `flashLastEntry()` pulses the **pill** (`is-pulse` on `collapsedBtn`) instead
  of an entry; keep the 4 s timer decay in `update(dt)` so the existing
  `wave_started` call site (`UIManager.ts:698-706`) keeps working unchanged.

## B.2 `src/ui/UIManager.ts:571-582`

Add the third handler to the `MilestoneStrip` construction:

```ts
onOpenProgression: () => {
  if (this.isMobile && this.mobileSheet) {
    this.loadSheetGroup('progress');
    this.mobileSheet.open('progression');
  } else {
    this.showTab('progression');
  }
},
```

Nothing else in `UIManager` changes: `milestoneStrip.update(dt)` (line 1205),
`.refresh()` (line 1323) and `.flashLastEntry()` (line 704) all keep their
meaning.

## B.3 CSS deletions in `src/styles/main.css`

Delete these rules outright:

| Lines (current file) | Selectors |
|---|---|
| 3596-3610 | `.milestone-strip`, `.milestone-strip.is-open` |
| 3611-3619 | `.milestone-empty` |
| 3620-3659 | `.milestone-entry`, `.milestone-entry-fill`, `.milestone-entry > *:not(…)`, `.milestone-entry.is-next`, `.milestone-entry.is-pulse` |
| 3660-3707 | `.milestone-entry-glyph`, `-body`, `-row`, `-wave`, `-label`, `-detail` |
| 4475-4501 | the whole mobile `.milestone-strip { position: absolute; … }` block **and** `.milestone-entry { width: 100% }` |
| 7151 | `.milestone-entry-glyph > .icon` |

Keep `@keyframes milestone-pulse` (3655-3659) — the pill reuses it.

Edits to what remains:
- `3524-3529` — the hover rule is now just
  `.milestone-collapsed-btn:hover { opacity: 1; border-color: var(--stroke-strong); }`.
  Drop both `:has(…)` selectors; there is no flyout to key off.
- `3505-3523` — `cursor: default` → `cursor: pointer`.
- `3496-3502` (`.milestone-strip-root`) — it is now a single-child wrapper.
  Either drop it and let the slot hold the button directly, or leave it and
  delete `gap`/`align-items`. Prefer **dropping it**: fewer fixed-position
  elements over the canvas is the whole point of this part. If you drop it,
  also delete its entries at 4449-4453 and 4557-4561, and remove the
  `this.root.classList.add('milestone-strip-root')` line in the constructor.
- Add `.milestone-collapsed-btn.is-pulse { animation: milestone-pulse var(--dur-ambient) ease-out 1; border-color: var(--good); }`.

## B.4 Test edits this part forces

- **`tests/touch-targets.test.ts:145-150`** — delete the whole
  `it('the milestone strip subtracts both insets from the free column', …)`
  case. It asserts a `max-height` on `.milestone-strip`, which no longer exists.
  Replace it with a case that pins the pill's mobile tap target, which is the
  rule that actually still matters:
  ```ts
  it('the milestone chip keeps its 44px mobile tap target', () => {
    expect(declares('.milestone-collapsed-btn', /min-height:\s*44px/)).toBe(true);
  });
  ```
- Nothing in `tests/content-coverage.test.ts` changes: its milestone tests
  (`:581`, `:599`) exercise `src/data/milestones.ts`, which is untouched.

## B.5 Docs

Rewrite `docs/milestones.md`. The "What shows up" and "Animation" sections
describe the flyout and are now wrong. New shape: **one chip, showing the next
milestone with a progress fill; clicking it opens the Progression tab, which is
the full list.** Update the "Public API" block to the three-method class in B.1.
Keep the "Data model" section as-is — it is still accurate.

---

# Part C — Rebuild the tower Stats popup

**Goal:** one dialog, no hover tooltip, sub-tabbed, grouped, ordered, and able
to show the ~90 stats the pipeline actually resolves instead of the 17 that
happen to be on `TowerState`. Every row links to its Codex entry.

## C.0 What goes away

- `HUD.statsTooltip` (field `:153`, construction `:648-651`, the two
  `mouseenter`/`mouseleave` listeners at `:629-637`, the re-render branch in
  `setStatsInfo` `:291-293`).
- `.hud-stats-tooltip` and `.hud-stats-tooltip .stat-row*` in
  `src/styles/main.css:755-781` (and `:853-855`, `:870-873`, which are the
  enemy variants — those die in Part D).
- `HUD.renderStatsContent`, `HUD.renderGoldBreakdown`, `HUD.openStatsPopup`,
  `HUD.closeStatsPopup`, `HUD.statsPopup`, `HUD.statsPopupBody`, and the popup
  construction at `:682-705`. Their behaviour moves to `StatsPopup`.
- `.hud-stats-popup*` in `src/styles/main.css:782-836` — replaced by the shared
  `.modal-*` shell plus a small `[data-modal="tower-stats"]` block.

The **`statsBtn`** (and `moreStatsBtn` in the mobile More popover) stay. They
now call `this.onOpenStats()`, a callback the host sets.

## C.1 Extend `StatsInfo` with the resolved block

`src/types.ts:708-728` — add two fields. Keep every existing field: the HUD
pills and `pushFrameStats` read them per tick and must not have to resolve.

```ts
export interface StatsInfo {
  /* …every existing field, unchanged… */

  /**
   * The full resolved stat block currently applied to the tower.
   *
   * The 17 fields above are the per-tick live readings the HUD tweens from;
   * this is the *composition result*, pushed only when something recomposes.
   * Both come from the same `Game` pass, so a row and a pill cannot disagree.
   * Null before the first resolve.
   */
  resolved: Readonly<Record<StatKey, number>> | null;
  /** `TowerState.targetingMode`, for the Utility group's one non-numeric row. */
  targetingMode: TargetingMode;
}
```

Import `StatKey` from `../stats/keys` and `TargetingMode` (already exported from
`src/types.ts`).

### C.1.1 `src/game/Game.ts:3197-3231` (`computeStatsInfo`)

Add to the returned object:

```ts
resolved: this.lastResolved,
targetingMode: t.targetingMode,
```

`this.lastResolved` is already a field (`Game.ts:517`) holding exactly this.
**Do not call `resolveStats` again** — that is what `computeGoldBreakdown`
already does for the breakdown, and doubling it on every purchase is a
regression.

### C.1.2 `src/ui/UIManager.ts`

Cache the new fields the way `cachedGoldMultiplier` / `cachedGoldSources`
already are:

- add fields `private cachedResolved: Readonly<Record<StatKey, number>> | null = null;`
  and `private cachedTargetingMode: TargetingMode = 'priority';`
- in `setStatsInfo` (`:1089-1092`) assign both from `info` before forwarding;
- in `pushFrameStats` (`:1364-1390`) pass `resolved: this.cachedResolved` and
  `targetingMode: t.targetingMode`.

## C.2 New file — `src/data/statDisplay.ts`

The declarative table that decides *what is shown, in what order, under which
heading, formatted how*. Putting it in `src/data/` (not in the UI) is what lets
the Codex chips in A.3 label a `StatKey` without importing a panel.

```ts
import type { StatKey } from '../stats/keys';
import type { IconId } from './icons';

/** How a resolved number is turned into a string. */
export type StatFormat =
  | 'flat'      // 12.4
  | 'int'       // 12
  | 'pct'       // 12.4%   (value is a 0-1 fraction)
  | 'pctAdd'    // +12%    (a bonus fraction; sign is always shown)
  | 'mult'      // x1.24
  | 'perSec'    // 12.4/s
  | 'seconds'   // 12.4s
  | 'world';    // 300  (world units — range, radius)

export interface StatRowDef {
  key: StatKey;
  label: string;
  format: StatFormat;
  /**
   * Hide the row when the resolved value equals this. Omit to always show.
   * Use the key's `STAT_BASES` value for anything the player only ever adds to,
   * so an untouched build shows a short list and a stacked one shows a long one.
   */
  hideAt?: number;
  /** Codex entry id, for the row's "?" affordance. */
  codexId?: string;
}

export type StatGroupId = 'offense' | 'defense' | 'kit' | 'economy' | 'magic' | 'meta';

export interface StatGroupDef {
  id: StatGroupId;
  label: string;
  icon: IconId;
  rows: readonly StatRowDef[];
}

export const STAT_GROUPS: readonly StatGroupDef[] = [ /* … */ ];

/** Flat lookup for the Codex's stat chips and the row "?" links. */
export const STAT_ROW_BY_KEY: Readonly<Partial<Record<StatKey, StatRowDef>>> = /* … */;

export function formatStatValue(value: number, format: StatFormat): string { /* … */ }
```

`formatStatValue` uses `formatWithOptionalDecimal` / `formatNumber` /
`formatInt` from `src/utils/bigNumber.ts` — do not write new number formatting.

### The groups, in order

| Group | icon | Rows, in this order |
|---|---|---|
| **offense** "Offense" | `crossed-swords` | `baseDamage` (flat), *derived* DPS row (see C.3.1), `fireRate` (perSec), `critChance` (pct), `critMultiplier` (mult), `range` (world), `armorPen` (pct, hideAt 0), `armorPenFlat` (flat, 0), `executeThreshold` (pct, 0), `executeMultiplier` (pctAdd, 0), `talentExecuteBonus` (pctAdd, 0), `focusStackBonus` (pctAdd, 0), `killFrenzyPerStack` (pctAdd, 0), `overwatchDamage` (pctAdd, 0), `bossDamageBonus` (pctAdd, 0), `critFollowUpChance` (pct, 0), `chilledDamageBonus` (pctAdd, 0), `lowHpDamageBonus` (pctAdd, 0), `instantKillChance` (pct, 0), `critSplash` (pctAdd, 0), `critIgnoreArmor` (pct, 0) |
| **defense** "Defense" | `bordered-shield` | live `hp` / `maxHp` (see C.3.1), `healthRegen` (perSec), `defense` (flat), `armor` (pct), `dodgeChance` (pct, 0), `thorns` (pct, 0), `lifesteal` (pct, 0), `manaShieldFraction` (pct, 0), `shieldMaxCharges` (int, 0), `shieldRechargeTime` (seconds, 0), `shieldRechargeReduction` (pct, 0), `wallFraction` (pct, 0), `wallRegen` (perSec, 0), `wallContactExtra` (world, 0), `knockbackForce` (flat, 0), `reviveCharges` (int, 0), `secondWindPower` (pctAdd, 0) |
| **kit** "Shot & Kit" | `arrow-cluster` | `doubleShotChance` (pct, 0), `extraProjectileChance` (pct, 0), `quickShotChance` (pct, 0), `quickShotTime` (seconds, 0), `pierceExtra` (int, 0), `shotSplashRadius` (world, 0), `shotSplashFraction` (pct, 0), `magicProcChance` (pct, 0), `shockwaveSize` (world, 0), `shockwaveCooldown` (seconds, 0), `landMineDamage` (flat, 0), `landMineFrequency` (perSec, 0) |
| **economy** "Economy" | `two-coins` | `goldMultiplier` (mult), `goldOnKill` (flat, 0), `critGold` (pctAdd, 0), `waveGold` (flat, 0), `goldLuckChance` (pct, 0), `doubleGoldChance` (pct, 0), `orbValueBonus` (pctAdd, 0), `momentumGainBonus` (pctAdd, 0), `windfallMultiplier` (mult, 0), `interestRate` (pct, 0), `upgradeCostDiscount` (pct, 0), `equipmentFindChance` (pct, 0), `xpGainMultiplier` (mult, 1), plus the **RP gain** derived row |
| **magic** "Magic" | `magic-swirl` | `maxMana` (int), `manaRegen` (perSec), `abilityCostMultiplier` (mult, 1), `abilityCooldownMultiplier` (mult, 1), `abilityDamageMultiplier` (mult, 1), `buffDurationBonus` (pctAdd, 0), `abilityEchoChance` (pct, 0), `manaOnKillFraction` (pct, 0), `berserkFireBonus` (pctAdd, 0), `chainBounceBonus` (int, 0), `slowStrengthBonus` (pctAdd, 0), `meteorDamageBonus` (pctAdd, 0) |
| **meta** "Run" | `swords-emblem` | targeting mode (derived, non-numeric), `waveSkipChance` (pct, 0), `intermissionMultiplier` (mult, 1), `headStartWaves` (int, 0), `enemyHpReduction` (pct, 0), `enemyHpMult` (mult, 1), `enemySpeedMult` (mult, 1), `enemyDamageMult` (mult, 1), `rpDropChanceBonus` (pct, 0), `autoBuyIntervalReduction` (pct, 0) |

Every row's `codexId` is the entry that claims its key in `CODEX_BY_STAT`
(A.1) — set it by looking the key up rather than by hand, i.e. build
`STAT_GROUPS` first with keys only, then have `STAT_ROW_BY_KEY` fill `codexId`
from `CODEX_BY_STAT` in the same IIFE. That way the two tables cannot drift.

`goldAdditive` is deliberately absent from every group: it is an internal
intermediate folded into `goldMultiplier` by `resolveStats`, and showing it
would double-count in the player's head.

## C.3 New file — `src/ui/StatsPopup.ts`

```ts
export interface StatsPopupHandlers {
  /** Deep link into the Codex; UIManager.openCodex. */
  onOpenCodex: (entryId: string) => void;
}

export class StatsPopup {
  constructor(handlers: StatsPopupHandlers);
  isOpen(): boolean;
  open(): void;
  close(): void;
  toggle(): void;
  /** Push fresh numbers; re-renders only while open. */
  setInfo(info: StatsInfo): void;
  destroy(): void;
}
```

Built on `Modal` (`src/ui/Modal.ts`) with
`{ id: 'tower-stats', title: 'Tower Stats', width: 560 }`. Adopting the shell
gets Escape, the focus trap, the backdrop and — the reason it matters —
`Modal.anyOpen()`, which is what `UIManager.isModalOpen()` reads to gate the
Space "call wave early" binding. The current bespoke overlay does not
participate, so Space currently calls a wave while the stats dialog is up.

Body layout:

```
div.stats-modal
  div.stats-modal-tabs   role=tablist   one button.stats-modal-tab per STAT_GROUPS entry
                                        + a final "Sources" tab
  label.stats-modal-filter              checkbox "Show every stat"  (default OFF)
  div.stats-modal-body
    section.stat-group                  (the active group only)
      div.stat-row[data-key]
        span.stat-row-label             label + a "?" button.stat-row-help when codexId is set
        span.stat-row-value             formatStatValue(...)
```

Behaviour:
- **Filter.** Off (default): a row whose resolved value equals its `hideAt` is
  skipped. On: every row in the group renders, dimmed (`.is-default`) when at
  its default. Persist the checkbox to `localStorage` under `stats.showAll`.
- A group whose visible rows are all hidden renders one `.stats-modal-empty`
  line ("Nothing here yet — these unlock through talents, passives and
  blessings."), never an empty box.
- The "?" button calls `handlers.onOpenCodex(codexId)` and then `close()`.
- Active tab persists to `localStorage` under `stats.group`.
- `setInfo` stores the info and, if `isOpen()`, re-renders the **active group
  only**. Because `Game` pushes on recompose and `UIManager` at ~10 Hz, keep
  the render cheap: reuse the row elements when the group has not changed and
  only `setText` the value spans (`src/utils/dom.ts` already skips no-op writes).

### C.3.1 The three derived rows

They are not `StatKey`s, so render them explicitly at the top of their group
from `StatsInfo`'s live fields rather than from `resolved`:

- **DPS** (offense, second row): `formatWithOptionalDecimal(info.dps, 1, { keepTrailingZeros: true })`.
  Keep the existing comment's contract — this is `UIManager.smoothedDps`, the
  same reading the HUD pill tweens, so the two cannot disagree.
- **Health** (defense, first row): `${Math.floor(info.hp)} / ${Math.floor(info.maxHp)}`,
  and a **Health Regen** row of `info.maxHp * info.healthRegen` per second
  (the current popup already does this — `healthRegen` is a *fraction of max
  HP* per second, so printing the raw stat would be a lie).
- **RP Gain** (economy, last row): `formatNumber(info.rpGainRate, 3)}/s`.
- **Targeting mode** (meta, first row): the label from `TARGETING_MODES` in
  `src/data/tower.ts` for `info.targetingMode`.

### C.3.2 The Sources tab

This is `renderGoldBreakdown` (`HUD.ts:328-351`), moved verbatim and given a
home instead of being wedged under a row. Keep the existing markup classes
(`.stat-breakdown`, `.stat-subrow`, `.stat-subtotal`) so
`src/styles/main.css:1459-1480` keeps working. Above it, put the composed
result as a headline row: `Gold Multiplier — x{n}`. Under it, a short static
paragraph: additive sources are summed first, then the flat multipliers apply.

If `info.goldSources` is empty, show `.stats-modal-empty` rather than a bare
heading.

## C.4 Wiring

- **`src/ui/HUD.ts`**
  - delete the fields and methods listed in C.0;
  - add `private onOpenStats: () => void = () => {};` and
    `setOnOpenStats(cb: () => void): void`;
  - `statsBtn`'s click (`:638-645`) and `moreStatsBtn`'s click (`:1211-1215`)
    both become `this.onOpenStats()` (the More popover's handler must still
    close the popover first, as it does today);
  - `setStatsInfo` keeps the field assignment and forwards to a host callback:
    add `private onStatsInfo: (info: StatsInfo) => void = () => {};` +
    `setOnStatsInfo(...)`, called at the end of `setStatsInfo`. (Alternative, if
    simpler: `UIManager` owns `StatsPopup` and calls
    `statsPopup.setInfo(info)` directly in its own `setStatsInfo` /
    `pushFrameStats`, and `HUD.setStatsInfo` shrinks to storing the field for
    nothing — in that case delete `HUD.statsInfo` too. **Prefer this**: it keeps
    HUD out of the dialog business entirely.)
- **`src/ui/UIManager.ts`**
  - construct `private readonly statsPopup = new StatsPopup({ onOpenCodex: id => this.openCodex(id) });`
  - `this.hud.setOnOpenStats(() => this.statsPopup.toggle());`
  - in `setStatsInfo` and `pushFrameStats`, call `this.statsPopup.setInfo(info)`.
- **`src/ui/Modal.ts`** — no changes.

## C.5 CSS

Delete `src/styles/main.css:755-781` (`.hud-stats-tooltip*`) and `:782-836`
(`.hud-stats-popup*`). Keep `.hud-stats-wrap`, `.hud-stats-btn` and its
`:hover` / `.is-active` rules (`:728-754`, `:874-876`) — the buttons live on.
Keep `.stat-breakdown` / `.stat-subrow` (`:1459-1480`).

Add a `/* ── Tower Stats dialog (plans/stats.md Part C) ── */` block:
`.stats-modal`, `.stats-modal-tabs`, `.stats-modal-tab`, `.stats-modal-tab.is-active`,
`.stats-modal-filter`, `.stats-modal-body`, `.stat-group`, `.stat-row`,
`.stat-row.is-default`, `.stat-row-label`, `.stat-row-help`, `.stat-row-value`,
`.stats-modal-empty`.

Constraints:
- No `z-index` at all — `.modal` already owns `--z-modal`.
- `.stats-modal-body` gets `overflow-y: auto` and
  `overscroll-behavior: contain`, and a `max-height` expressed against
  `100dvh` minus the safe insets (copy the shape used by `.modal-card`).
- Inside `@media (max-width: 768px)`: `.stats-modal-tab` and `.stat-row-help`
  get `min-height: 44px` / `min-width: 44px`.
- `.stat-row-value` keeps the `u-tabular` numeric class the HUD already uses so
  the column does not jitter.
- Row grid: `display: grid; grid-template-columns: 1fr auto; gap: var(--space-3);`
  — not the current `justify-content: space-between` flex, which lets a long
  label push the value off the right edge on a phone.

## C.6 Tests

Extend `tests/stats.test.ts` (it already imports the pipeline) or add
`tests/stat-display.test.ts`:

```ts
it('only names real StatKeys');                       // every row.key ∈ STAT_KEYS
it('lists no key twice across groups');
it('gives every row a label and a format');
it('points every codexId at a real Codex entry');     // ⊆ CODEX_BY_ID
it('covers every StatKey that the Codex indexes');    // optional but recommended:
                                                      // a key worth explaining is a key
                                                      // worth displaying — allow an
                                                      // explicit exemption list and keep
                                                      // it short
it('formats each format kind without throwing');      // formatStatValue over a sample set
```

---

# Part D — Rebuild the enemy popup as a bestiary

**Goal:** the tooltip goes; the popup becomes a **roster + detail** view. Pick an
enemy from an icon strip, get its icon, name, threat class, description, the
effects it actually has, and only the stats that mean something for that type,
with the values the wave will really spawn it at.

## D.0 What goes away

- `HUD.enemyStatsTooltip` (field `:158`, construction `:675-678`, listeners
  `:655-665`, the branch in `setEnemyStatsInfo` `:367-369`).
- `HUD.renderEnemyStatsContent`, `openEnemyStatsPopup`, `closeEnemyStatsPopup`,
  `enemyStatsPopup`, `enemyStatsPopupBody`, `enemyStatsInfo`, and the popup
  construction at `:707-728`.
- `.enemy-stats-grid`, `.enemy-stats-grid-wide`, `.enemy-stats-col`,
  `.enemy-stats-popup-inner:has(…)`, `.hud-stats-tooltip:has(…)`,
  `.enemy-stats-type-header` and its two overrides — `src/styles/main.css:837-873`.
- The hand-rolled unlock-wave ladder in `UIManager.pushEnemyStats`
  (`:1331-1345`). It duplicates `ENEMY_DEFS[t].unlockWave` and has already
  drifted: it never lists `boss` on a non-boss wave even though the boss is the
  one enemy a player most wants to read up on before wave 10.

`enemyStatsBtn` and `moreEnemyStatsBtn` stay; they call `onOpenEnemies()`.

## D.1 New data — `ENEMY_CODEX` in `src/data/enemies.ts`

Append after `ENEMY_BEHAVIOR_CONSUMERS` (which is the *developer*-facing twin —
do not confuse them, and do not merge them; one names a call site, the other is
player copy).

```ts
/** One player-facing effect line on an enemy's bestiary page. */
export interface EnemyEffectLine {
  /** Short name, title case: "Shell Barrage", "Ward". */
  name: string;
  /** What it does, with its numbers interpolated from ENEMY_BEHAVIOR / BOSS_ENCOUNTER. */
  text: string;
}

export interface EnemyCodexEntry {
  /** One line, the same register as ENEMY_INTRO_MILESTONES' `detail`. */
  tagline: string;
  /** Two to three sentences: how it behaves and why it is a problem. */
  description: string;
  /** What the player should do about it. The verb this enemy demands an answer to. */
  answer: string;
  /** Zero or more mechanics. `normal` legitimately has none. */
  effects: readonly EnemyEffectLine[];
}

/**
 * The bestiary (plans/stats.md Part D).
 *
 * A `Record` over the whole `EnemyType` union, exactly like
 * `ENEMY_BEHAVIOR_CONSUMERS`: a new enemy type does not compile until someone
 * has written what the *player* sees, and `content-coverage.test.ts` rejects a
 * placeholder. Every number in an `effects` line is interpolated from
 * `ENEMY_BEHAVIOR` / `BOSS_ENCOUNTER` / `ENEMY_DEFS`, never typed.
 */
export const ENEMY_CODEX: Record<EnemyType, EnemyCodexEntry> = { /* … */ };
```

### Copy source per type — move the strings, do not copy them

`src/data/milestones.ts:60-99` (`ENEMY_INTRO_MILESTONES`) already holds a
player-facing one-liner for eleven of the thirteen types, and the player has
already read it in the milestone chip. A second, differently-worded version is
a bug waiting to happen.

`milestones.ts` imports `enemies.ts` (not the other way round), so the fix is a
**move, not a copy**:

1. `ENEMY_CODEX[type].tagline` becomes the home of those eleven strings — copy
   each `detail` across **verbatim**, then write fresh taglines for `normal` and
   `boss`, which are in `MILESTONE_EXEMPT_ENEMIES` and have none today.
2. In `src/data/milestones.ts`, drop the `detail` field from the
   `ENEMY_INTRO_MILESTONES` literal (keep `type`, `name`, `color`) and change
   `enemyMilestones()` (`:86-97`) to read
   `detail: ENEMY_CODEX[e.type].tagline`.
   `ENEMY_CODEX` comes from the `../data/enemies` import that file already has —
   **do not** import `milestones.ts` from `enemies.ts`, which would be circular.

After the move there is exactly one copy of each line and the "reuses the
milestone copy" test in D.8 becomes a tautology you can keep as a cheap guard
that the wiring survives.

`effects` per type, and the constant each line must interpolate:

| Type | Effect lines |
|---|---|
| `normal` | *(none)* — say so in the description; the empty array is correct, not an oversight. |
| `fast` | **Pack** — `ENEMY_BEHAVIOR.fastPackSize` arrive from one spawn point, scattered over `fastPackSpread`. |
| `tank` | **Body Block** — a shot never pierces past it (`ENEMY_BEHAVIOR_CONSUMERS.tank`). **Armour** — `ENEMY_DEFS.tank.armor` through `armorDamageMultiplier`, quote the resulting % kept. |
| `flying` | **Airborne** — ignores land mines, knockback and the wall contact band (`ignoresGroundEffects`, `ignoresWallBand`). |
| `splitter` | **Split** — `splitChildren` children at `splitHpFraction` HP and `splitSpeedMultiplier` speed. **Spawn Protection** — untargetable and immune for `ENEMY_BEHAVIOR.splitterSpawnProtection` s, scattering for `splitterScatterTime` s at `splitterScatterSpeedMult`. |
| `healer` | **Field Heal** — `healFraction` of max HP to allies within `healRange` every `healCooldown` s. **Flee** — below `healerFleeThreshold` it runs for the edge at `healerFleeSpeedMult`, self-healing `healerSelfHealPerSecond`/s, and never flees twice. |
| `shielded` | **Charges** — `shieldCharges` charges, each eats one hit. **Rebuild** — after `shieldCalmBeforeRegen` s undamaged, one charge back every `shieldRegenInterval` s. **Magic Resist** — `magicResist`. |
| `siege` | **Standoff** — halts at `ENEMY_BEHAVIOR.siegeStandoff` world units, just inside `ARENA_RANGE_CAP`. **Shell** — every `siegeReload` s, `siegeShellTravel` s in the air, `siegeShellDamageMult`x its melee damage. |
| `thief` | **Theft** — `thiefStealFraction` of current gold on contact, capped at `thiefStealWaveGoldMult`x a normal wave drop, and `thiefWaveTheftCap` of your gold per wave. **Flight** — runs for the edge at `thiefFleeSpeedMult`. **Recovery** — killing a loaded thief pays `thiefRecoveryMult`x back. |
| `blinker` | **Blink** — `blinkDistance` units every `blinkInterval` s, with `blinkImmunity` s of knockback and mine immunity, and it ignores the wall band. **Magic Resist** — `magicResist`. |
| `warden` | **Ward** — an absorb shield worth `wardShieldFraction` of its own max HP on up to `wardMaxTargets` allies within `wardRange`, refreshed every `wardRefresh` s. Note it is the top of `PRIORITY_TARGET_ORDER`. |
| `burrower` | **Burrow** — untargetable and invulnerable underground, moving at `burrowSpeedMult`, surfacing at `burrowSurfaceDistance` after a `burrowTelegraph` s telegraph it cannot act during. |
| `boss` | **Phases** — at `BOSS_ENCOUNTER.phaseThresholds` with `phaseInvulnerability` s of untargetable flash. One line per pattern, name from `BOSS_PATTERN_NAMES` and answer from `BOSS_PATTERN_HINTS` (do **not** rewrite those four strings; the boss bar already shows them). **Enrage** — after `enrageDelay` s, a stack every `enrageInterval` s worth `enrageDamagePerStack` / `enrageSpeedPerStack`. **Rewards** — under `swiftKillSeconds` s pays `swiftKillGoldBonus` extra gold and `swiftKillRarityBoost` rarity tiers; flawless banks `flawlessApBonus` and `flawlessRerollTokens`. |

## D.2 Extend `EnemyWaveStatsEntry` — `src/types.ts:730-739`

```ts
export interface EnemyWaveStatsEntry {
  type: EnemyType;
  hp: number;
  speed: number;
  armor: number;
  magicResist: number;
  damage: number;
  fireRate: number;
  gold: number;
  /** Wave these figures were computed for — the dialog's subtitle. */
  wave: number;
  /** True when this type can actually appear on `wave` (vs. previewed early). */
  inWave: boolean;
  /** Live enemy-side multipliers already folded into `hp` / `speed` / `damage`. */
  multipliers: { hp: number; speed: number; damage: number };
}
```

## D.3 `src/systems/EnemyManager.ts` — one additive getter

The current entries are the *table* values, not what the wave spawns:
`spawn()` (`:375-390`) folds `hpReduction`, `hpMult`, `statHpMult` into HP and
`speedMult` into speed, and `damageToTowerMult * enrageDamageMult *
statDamageMult` into damage at contact time. The popup must show the real
numbers. Add, next to the other setters:

```ts
/**
 * The enemy-side multipliers currently in force, for the bestiary readout
 * (plans/stats.md Part D). Composed exactly as `spawn` and the contact path
 * compose them, so the dialog cannot quote a number the field disagrees with.
 * Enrage is excluded: it is per-wave-elapsed, not a property of the type.
 */
getWaveMultipliers(): { hp: number; speed: number; damage: number } {
  return {
    hp: (1 - this.hpReduction) * this.hpMult * this.statHpMult,
    speed: this.speedMult * this.statSpeedMult,
    damage: this.damageToTowerMult * this.statDamageMult,
  };
}
```

**Read-only. Do not change any composition.** If `impact({target: "spawn"})`
reports anything above LOW for this addition, stop and re-read — a pure getter
should have no upstream at all.

Expose it to `UIManager` through whichever API object already carries enemy
data to the UI; if none does, add it to the same `syncUiApis` push that already
crosses that boundary in `src/game/Game.ts`. Do not reach into `EnemyManager`
from `UIManager` directly.

## D.4 `src/ui/UIManager.ts:1327-1362` — rewrite `pushEnemyStats`

```ts
private pushEnemyStats(state: GameState): void {
  const wave = state.wave.number;
  const mults = this.enemyApi.getWaveMultipliers();      // see D.3
  const sig = `${wave}|${mults.hp}|${mults.speed}|${mults.damage}`;
  if (sig === this.lastEnemyStatsSig) return;            // replaces lastEnemyStatsWave
  this.lastEnemyStatsSig = sig;

  // The spawn pool is the source of truth for "what can show up", so the
  // hand-written unlock ladder this replaced cannot drift from WaveManager.
  const pool = spawnPoolForWave(wave).map(p => p.type);
  const types: EnemyType[] = isBossWave(wave) ? ['boss', ...pool] : [...pool, 'boss'];
  // 'boss' is always listed: on a boss wave it leads, otherwise it trails as a
  // preview (`inWave: false`), because "what is the wave-10 fight" is the
  // question a player asks at wave 6, not at wave 10.

  const entries: EnemyWaveStatsEntry[] = types.map(t => { /* …as today, times mults… */ });
  this.hud.setEnemyStatsInfo(entries);   // or this.enemyCodexModal.setInfo(entries) — see D.6
}
```

Per entry: `hp` = `(t === 'boss' ? bossMaxHpForWave(wave) : enemyHPForWave(def.baseHP, wave)) * mults.hp`,
`speed` = `enemySpeedForWave(def.baseSpeed, wave) * mults.speed`,
`damage` = `enemyDamageForWave(def.baseDamage, wave) * mults.damage`,
`gold` = `goldDropForWave(def.baseGold, wave)`, `armor`/`magicResist`/`fireRate`
straight from the def, `inWave` = `t !== 'boss' || isBossWave(wave)`.

Import `spawnPoolForWave` from `../data/enemies`; drop the now-unused hard-coded
list.

## D.5 New file — `src/ui/EnemyCodexModal.ts`

```ts
export interface EnemyCodexHandlers {
  onOpenCodex: (entryId: string) => void;   // 'enemy-armor', 'elites', 'boss-phases', …
}

export class EnemyCodexModal {
  constructor(handlers: EnemyCodexHandlers);
  isOpen(): boolean;
  open(): void;
  close(): void;
  toggle(): void;
  setInfo(entries: EnemyWaveStatsEntry[]): void;
  destroy(): void;
}
```

`Modal` with `{ id: 'enemy-codex', title: 'Enemies', width: 620 }` and
`sub = 'Wave ' + wave` via `Modal.setSub` so the numbers are never orphaned
from the wave that produced them.

Body layout — **this is the sub-page structure the brief asks for**:

```
div.enemy-codex
  div.enemy-codex-roster    role=tablist
    button.enemy-roster-btn[data-type]  role=tab
      span.enemy-roster-icon    renderIcon(ENEMY_DEFS[t].icon), tinted ENEMY_DEFS[t].color
      span.enemy-roster-name    ENEMY_LABELS[t]
      span.enemy-roster-flag    "Wave N" when !inWave  (the preview marker)
  div.enemy-codex-page      role=tabpanel   — exactly one enemy
    header.enemy-page-head
      span.enemy-page-icon    the same icon at 40px, tinted
      div
        h4.enemy-page-name    ENEMY_LABELS[t]
        span.enemy-page-class threat-class badge from ENEMY_THREAT_CLASS
    p.enemy-page-tagline
    p.enemy-page-desc
    p.enemy-page-answer       prefixed "Answer:" — the verb the type demands
    div.enemy-page-stats      only the rows that mean something (D.5.1)
    div.enemy-page-effects    one .enemy-effect per ENEMY_CODEX[t].effects entry
      span.enemy-effect-name / p.enemy-effect-text
    div.enemy-page-links      chips → handlers.onOpenCodex('enemy-armor' | 'elites' | 'boss-phases')
```

Rules:
- The roster is the sub-page nav. Selection persists **within a session only**
  (a field, not `localStorage`): the roster changes with the wave, and a
  remembered type that has not unlocked yet would open on an empty page.
  Default selection: the first entry with `inWave === true`.
- If the selected type is no longer in `entries` after a `setInfo`, fall back to
  the default rather than rendering nothing.
- Roster buttons for `inWave === false` render `.is-preview` (dimmed) and their
  stats page adds a `.enemy-page-preview` note: "Not in this wave — these are
  the numbers it will spawn with."
- `setInfo` while closed only stores. While open it re-renders the roster
  (cheap; ≤13 buttons) and the active page.
- Keyboard: Up/Down move the roster selection, matching the `role="tablist"`
  contract.

### D.5.1 Which stats a page shows

Common rows, in this order, each **hidden when it is zero**:

`HP` (formatNumber) · `Damage` (formatNumber) · `Attack Rate` (`x.xx/s`) ·
`Speed` (`x` world units/s, `toFixed(0)`) · `Armour` (value **plus** the derived
`armorDamageMultiplier(armor)` as "keeps n% of a physical hit") ·
`Magic Resist` (pct) · `Gold` (formatNumber).

Hiding zeros is the fix for "same stats for all enemies": eight of thirteen
types have `magicResist: 0` and six have `armor: 0`, so today more than half
of every column is a row of zeroes.

Then per-type extra rows, read straight off `ENEMY_DEFS[t]` (all optional, so
render only what is present):

| Field | Row |
|---|---|
| `shieldCharges` | Shield Charges |
| `healRange` / `healFraction` / `healCooldown` | Heal Range / Heal / Heal Cooldown |
| `splitChildren` / `splitHpFraction` / `splitSpeedMultiplier` | Children / Child HP / Child Speed |
| `rpChance` | RP Drop Chance |

And for `boss` only, a **Patterns** block: `bossPatternsForWave(wave)` phase 1→3,
each `BOSS_PATTERN_NAMES[p]` with `BOSS_PATTERN_HINTS[p]`.

Whenever `entry.multipliers` is not `{1,1,1}`, append a
`.enemy-page-multipliers` line naming the ones that bite ("HP x1.35 from wave
modifiers and blessings") so a player is not left thinking the table lies.

## D.6 Wiring

- **`src/ui/HUD.ts`** — delete everything in D.0; add
  `setOnOpenEnemies(cb)` and call it from `enemyStatsBtn` (`:666-671`) and
  `moreEnemyStatsBtn` (`:1221-1225`). Drop `HUD.setEnemyStatsInfo` entirely and
  have `UIManager` own the modal (same call as C.4's preferred option).
- **`src/ui/UIManager.ts`** — construct
  `private readonly enemyCodexModal = new EnemyCodexModal({ onOpenCodex: id => this.openCodex(id) });`,
  wire `this.hud.setOnOpenEnemies(() => this.enemyCodexModal.toggle());`, and
  call `this.enemyCodexModal.setInfo(entries)` at the end of `pushEnemyStats`.

## D.7 CSS

Delete `src/styles/main.css:837-873`. Add an
`/* ── Enemy bestiary (plans/stats.md Part D) ── */` block:
`.enemy-codex`, `.enemy-codex-roster`, `.enemy-roster-btn`,
`.enemy-roster-btn.is-active`, `.enemy-roster-btn.is-preview`,
`.enemy-roster-icon`, `.enemy-roster-name`, `.enemy-roster-flag`,
`.enemy-codex-page`, `.enemy-page-head`, `.enemy-page-icon`, `.enemy-page-name`,
`.enemy-page-class`, `.enemy-page-tagline`, `.enemy-page-desc`,
`.enemy-page-answer`, `.enemy-page-preview`, `.enemy-page-stats`,
`.enemy-page-effects`, `.enemy-effect`, `.enemy-effect-name`,
`.enemy-effect-text`, `.enemy-page-multipliers`, `.enemy-page-links`,
plus `.enemy-roster-icon > .icon { --icon-size: 20px; }` and
`.enemy-page-icon > .icon { --icon-size: 40px; }` beside the other `> .icon`
rules near line 7151.

Constraints:
- Desktop: `.enemy-codex { display: grid; grid-template-columns: 168px 1fr; }`.
  Under `@media (max-width: 768px)` it collapses to one column with the roster
  becoming a horizontal, `overflow-x: auto` strip and `.enemy-roster-btn`
  taking `min-height: 44px`.
- `.enemy-codex-page` gets `overflow-y: auto` + `overscroll-behavior: contain`;
  the modal card, not the page, owns the height cap.
- The icon tint uses the def's `color` via an inline
  `setStyle(el, 'color', ENEMY_DEFS[t].color)` — this is the one place a
  per-type literal colour is legitimate, because it is *data*, and the same
  route `MilestoneStrip.updateCollapsed` already uses.
- **This is the fix for "the popup can grow very large":** the page shows one
  enemy, so the dialog's height is bounded by the longest single entry rather
  than by 13 stacked columns.

## D.8 Tests

Add to `tests/content-coverage.test.ts`, inside the existing
`describe('enemy roster', …)`:

```ts
it('writes a bestiary page for every type', () => {
  for (const t of Object.keys(ENEMY_DEFS) as EnemyType[]) {
    const e = ENEMY_CODEX[t];
    expect(e, `${t} has no codex entry`).toBeTruthy();
    expect(e.tagline.length, `${t} tagline`).toBeGreaterThan(20);
    expect(e.description.length, `${t} description`).toBeGreaterThan(60);
    expect(e.answer.length, `${t} answer`).toBeGreaterThan(15);
  }
});

it('reuses the milestone copy for the taglines it already wrote', () => {
  // The eleven announced types must not have two different one-liners.
  for (const m of MILESTONES.filter(m => m.kind === 'enemy')) {
    const type = m.refId as EnemyType;
    expect(ENEMY_CODEX[type].tagline).toBe(m.detail);
  }
});

it('gives every type with a mechanic at least one effect line', () => {
  for (const t of Object.keys(ENEMY_DEFS) as EnemyType[]) {
    if (t === 'normal') continue;               // the baseline legitimately has none
    expect(ENEMY_CODEX[t].effects.length, `${t} effects`).toBeGreaterThan(0);
    for (const fx of ENEMY_CODEX[t].effects) {
      expect(fx.name.trim()).not.toBe('');
      expect(fx.text.length, `${t}/${fx.name}`).toBeGreaterThan(20);
    }
  }
});

it('quotes the real tuning numbers', () => {
  expect(ENEMY_CODEX.siege.effects.map(e => e.text).join(' '))
    .toContain(String(ENEMY_BEHAVIOR.siegeReload));
  expect(ENEMY_CODEX.warden.effects.map(e => e.text).join(' '))
    .toContain(String(ENEMY_BEHAVIOR.wardMaxTargets));
  expect(ENEMY_CODEX.boss.effects.map(e => e.text).join(' '))
    .toContain(String(BOSS_ENCOUNTER.enrageDelay));
});
```

The second test relies on `MilestoneDef.refId` holding the enemy type for
`kind: 'enemy'` entries — confirmed at `src/data/milestones.ts:95`
(`refId: e.type`). After the D.1 move it passes by construction; keep it as the
guard that nobody re-introduces a second copy of the copy.

---

# E. Cross-cutting work

## E.1 Suggested order

1. **Part A** — the data table and the panel. Parts C and D both link into
   `CODEX_BY_ID`, so shipping it first means their "?" affordances are real
   rather than stubbed.
2. **Part B** — smallest and fully independent. Good place to warm up.
3. **Part C** — establishes `Modal` adoption and the `StatsInfo.resolved` push.
4. **Part D** — reuses C's modal patterns and CSS conventions.

Each part is independently shippable and independently revertable. Do not batch
them into one commit.

## E.2 Docs to update (`AGENTS.md` requires the docs index to stay honest)

| File | Change |
|---|---|
| `docs/milestones.md` | Rewrite per B.5. |
| `docs/ui-system.md` | New section for the Codex panel; rewrite whatever describes the two HUD stat popups and their tooltips; note that both dialogs now use the shared `Modal` shell and therefore participate in `Modal.anyOpen()`. |
| `docs/enemy-system.md` | Add the bestiary: `ENEMY_CODEX` as the player-facing twin of `ENEMY_BEHAVIOR_CONSUMERS`, and the fact that the enemy taglines now live in `enemies.ts` and are read *by* `milestones.ts`. |
| `docs/stat-pipeline.md` | Note `StatsInfo.resolved` — the whole resolved block is now pushed to the UI, and `src/data/statDisplay.ts` is the table that decides how it is presented. |
| **`docs/codex.md`** (new) | What the Codex is, where the copy lives, the `CODEX_SELF_EVIDENT` escape hatch and why it must stay short, and the "numbers come from constants" rule with the test that enforces it. |
| `AGENTS.md` | Add `docs/codex.md` to the Docs Index table. Add rows to "Content at a glance": `Codex entries` → `src/data/codex.ts`, `Bestiary entries` → `13` → `src/data/enemies.ts`. Update the icon counts if you adopted `life-tap`. |

## E.3 GitNexus protocol (`CLAUDE.md`)

Before editing each of these, run
`impact({ target: "<symbol>", direction: "upstream" })` and report the blast
radius. Expected results, so you can tell a surprise from a normal one:

| Symbol | Expected |
|---|---|
| `HUD.setStatsInfo` / `HUD.setEnemyStatsInfo` | Callers in `UIManager` only. LOW/MEDIUM. |
| `UIManager.pushEnemyStats` | Single caller (`UIManager.update`). LOW. |
| `Game.computeStatsInfo` | Called by `syncUiApis`. LOW — the change is purely additive. |
| `MilestoneStrip` methods | Three call sites in `UIManager`. LOW. |
| `EnemyManager.spawn` | **Do not edit it.** The new getter must not appear in its blast radius. |

Run `detect_changes({ scope: "compare", base_ref: "main" })` before each commit
and confirm the affected symbols are only the ones the part names. If a
simulation symbol shows up, something went out of scope.

## E.4 Verification

```bash
npm run typecheck && npm run test
```

Then run the app and check by hand — these are the things the suite cannot see:

- **A**: Progress → Codex opens; each of the six tabs has entries; search finds
  "bloodlust" (an alias, not a term) and "splash"; a "see also" chip jumps and
  flashes.
- **B**: nothing expands on hover near the bottom-left corner any more; the
  chip's fill still grows across a wave; clicking it lands on Progression; a
  milestone wave still pulses the chip.
- **C**: the Stats button opens a focus-trapped dialog; Escape closes it;
  **Space does not call a wave while it is open** (this is the `Modal.anyOpen()`
  fix); the sub-tabs switch; "Show every stat" reveals the dimmed defaults; a
  row's "?" lands on the right Codex entry; the Sources tab reproduces the old
  gold breakdown exactly.
- **D**: the Enemies button opens the bestiary on the first in-wave type; the
  roster shows only what the wave can spawn plus the boss; a zero-armour enemy
  has no Armour row; the boss page lists this wave's three patterns; the dialog
  does not grow past the viewport on a 375x812 phone.
- Resize to 375x812 with the mobile preview and confirm both dialogs and the
  Codex panel scroll internally rather than moving the page.

## E.5 Acceptance criteria

1. `grep -rn "hud-stats-tooltip" src/` returns nothing.
2. `grep -rn "milestone-entry\|milestone-strip\b" src/` returns nothing outside
   `.milestone-strip-slot` (or nothing at all if you dropped the root wrapper).
3. Every `StatKey` in `src/stats/keys.ts` is either explained by a Codex entry
   or listed in `CODEX_SELF_EVIDENT`, proved by `tests/codex.test.ts`.
4. `ENEMY_CODEX` is a `Record<EnemyType, …>` and every entry passes the
   non-placeholder length checks.
5. No new literal `z-index` and no new literal colour outside the one
   data-driven enemy tint named in D.7.
6. `SaveManager` version is still 16 and no migration was added.
7. `npm run typecheck` and `npm run test` both pass.
