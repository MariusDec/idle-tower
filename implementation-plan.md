# The Tower — Idle Tower-Defense Game (Implementation Plan)

## Overview

A browser-based idle tower-defense game. A central tower auto-fires arrows and
magic at swarming enemies. Enemies scale exponentially per wave. Players buy
upgrades, unlock a research tree, and cast active abilities. A two-layer
prestige system (Ascension → Transcendence) resets progress for permanent
multipliers and automation unlocks. Save data persists in `localStorage`; full
offline progress is computed on return.

The MVP is a "full vertical slice": every system in the design must work
end-to-end. Polish (animations, sound, balance pass) comes after.

---

## 1. Tech Stack

- **Language:** TypeScript (strict mode)
- **Build tool:** Vite (vanilla-ts template)
- **Rendering split:**
  - `<canvas>` for the game world (tower, enemies, projectiles, particles)
  - HTML/CSS overlay for all UI panels (HUD, upgrades, research, abilities, prestige)
- **Runtime deps:** none (zero npm dependencies in production)
- **Dev deps:** `typescript`, `vite`

Rationale: React's reconciliation fights the game loop; Phaser is overkill for
≤100 entities; vanilla TS gives full control with minimum cognitive load.

---

## 2. File / Folder Structure

```
the-tower/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── public/
│   └── favicon.svg
└── src/
    ├── main.ts                    # Entry point: bootstrap Game, mount UI
    ├── types.ts                   # All shared interfaces, enums, type aliases
    ├── game/
    │   ├── Game.ts                # Orchestrator: owns state, runs rAF loop
    │   ├── Renderer.ts            # All canvas draw calls
    │   ├── Camera.ts              # Coord transforms (fixed MVP, isolated for future)
    │   └── EventBus.ts            # Tiny pub/sub (~50 lines)
    ├── systems/
    │   ├── Tower.ts               # Targeting, fire logic, stat application
    │   ├── EnemyManager.ts        # Spawn, update, death handling
    │   ├── ProjectileManager.ts   # Projectile movement, hit detection
    │   ├── WaveManager.ts         # Wave progression, scaling formulas
    │   ├── ResourceManager.ts     # Gold, mana, AP, TP
    │   ├── UpgradeManager.ts      # Buy/sell upgrades, applies stat effects
    │   ├── ResearchTree.ts        # DAG with prerequisites, RP spending
    │   ├── AbilityManager.ts      # Active abilities, cooldowns, mana costs
    │   ├── PrestigeManager.ts     # Ascension + Transcendence logic
    │   ├── SaveManager.ts         # localStorage save/load, offline calc
    │   └── NotificationManager.ts # Toasts, milestone popups
    ├── ui/
    │   ├── UIManager.ts           # Mounts panels, syncs to GameState each frame
    │   ├── HUD.ts                 # Top bar: gold, mana, wave, DPS
    │   ├── UpgradePanel.ts        # Buyable upgrades list
    │   ├── ResearchPanel.ts       # Research tree view
    │   ├── AbilityPanel.ts        # Active ability buttons + cooldowns
    │   ├── PrestigePanel.ts       # Ascend/Transcend buttons, perk shop
    │   └── format.ts              # Re-export of bigNumber for UI
    ├── data/
    │   ├── tower.ts               # Tower base stats
    │   ├── enemies.ts             # Enemy type definitions
    │   ├── upgrades.ts            # Upgrade definitions
    │   ├── research.ts            # Research node definitions
    │   ├── abilities.ts           # Ability definitions
    │   ├── prestige.ts            # Prestige perk configs
    │   └── formulas.ts            # All scaling formulas (single source of truth)
    ├── utils/
    │   ├── bigNumber.ts           # Standard-suffix number formatting
    │   └── math.ts                # clamp, lerp, randomBetween, distance
    └── styles/
        └── main.css               # Dark theme, panel layout, responsive
```

---

## 3. Core Architecture

### 3.1 Game Loop (`src/game/Game.ts`)

```
requestAnimationFrame loop:
  1. deltaTime = min(now - lastTime, 50ms)   // cap to prevent death spiral
  2. WaveManager.tick(dt)        // spawn, wave transitions
  3. Tower.tick(dt)              // acquire target, fire if cooldown ≤ 0
  4. ProjectileManager.tick(dt)  // move, hit detection
  5. EnemyManager.tick(dt)       // move toward tower
  6. AbilityManager.tick(dt)     // update cooldowns, apply effects
  7. NotificationManager.tick(dt)// expire toasts
  8. Renderer.draw(state)
  9. UIManager.update(state)     // sync HTML to current values
 10. requestAnimationFrame(loop)
```

### 3.2 Communication

- **Combat (tower, enemies, projectiles):** direct method calls, synchronous.
  Clearer than events for hot-path code.
- **Side effects (kill → gold, kill → particles, kill → toast):** `EventBus`.
- **UI → system (buy, cast, ascend):** direct call from button handler to
  manager.

### 3.3 State Shape (`src/types.ts`)

```ts
interface GameState {
  timestamp: number;
  tower: TowerState;
  enemies: Enemy[];
  projectiles: Projectile[];
  resources: ResourceState;
  upgrades: Record<string, number>;     // upgradeId → level
  research: string[];                    // unlocked research node IDs
  abilities: Record<string, AbilityState>;
  prestige: PrestigeState;
  wave: WaveState;
  stats: GameStats;                      // lifetime counters
}

interface TowerState {
  x: number; y: number;
  baseDamage: number;
  fireRate: number;        // shots/sec
  range: number;           // px
  critChance: number;      // 0–1
  critMultiplier: number;
  damageType: 'physical' | 'magic';
  cooldown: number;
  targetingMode: 'nearest' | 'lowest_hp' | 'first';
}

interface Enemy {
  id: string;
  type: EnemyType;
  x: number; y: number;
  hp: number; maxHp: number;
  speed: number;           // px/sec
  armor: number; magicResist: number;
  goldValue: number;
  alive: boolean;
}

interface ResourceState {
  gold: number;
  mana: number; maxMana: number; manaRegen: number;
  ascensionPoints: number;       // current
  transcendencePoints: number;   // current
  lifetimeAP: number;            // for Transcendence formula
}

interface PrestigeState {
  apSpent: Record<string, number>;   // perkId → level
  tpSpent: Record<string, number>;
  automationFlags: { autoBuy: boolean; autoAbilities: boolean; autoAscend: boolean; autoTranscend: boolean };
  targetAscendWave: number;          // for auto-Ascend
}
```

---

## 4. Game Systems (Detailed Specs)

### 4.1 Tower (`src/systems/Tower.ts`)

- Acquire target every tick (filter enemies in range → apply targeting mode).
- If cooldown ≤ 0 and target exists → spawn projectile, reset cooldown to `1 / fireRate`.
- **Damage formula** (all multipliers stack additively within a layer,
  multiplicatively across layers):
  ```
  finalDamage = baseDamage
    × (1 + upgradeBonus + AP_damageBonus)
    × (1 + TP_damageBonus)
    × (crit ? critMultiplier : 1)
    × (activeAbilityBuff || 1)
    × (1 - magicResist)         // if magic
    - armor                      // if physical, min 1
  ```

### 4.2 Enemy Manager (`src/systems/EnemyManager.ts`)

- Spawn from random point on canvas edge.
- Move toward tower center at `speed` px/sec.
- On death: emit `enemy_killed`, drop gold.
- Reach tower center → damage tower (MVP: tower HP = ∞; counted as stat only).

**Enemy types** (`src/data/enemies.ts`):

| Type     | HP | Speed | Armor | M.Resist | Gold | Unlock wave |
|----------|----|-------|-------|----------|------|-------------|
| normal   | 10 | 60    | 0     | 0        | 10   | 1           |
| fast     | 7  | 120   | 0     | 0        | 8    | 3           |
| tank     | 30 | 30    | 5     | 0        | 20   | 5           |
| flying   | 12 | 90    | 0     | 0        | 15   | 8           |
| healer   | 15 | 50    | 0     | 0        | 25   | 15          |
| boss     | 100| 40    | 10    | 0.2      | 200  | 10, every 10|

### 4.3 Wave Manager (`src/systems/WaveManager.ts`)

- `enemyCount = 5 + floor((wave - 1) * 1.5)`; boss every 10th wave.
- Spawn interval: `max(0.3, 2.0 - wave * 0.05)` sec.
- Intermission: 5 sec between waves.
- Enemy type weights shift with wave (more variety as wave rises).

### 4.4 Resource Manager (`src/systems/ResourceManager.ts`)

- Gold: from kills + passive `0.1 * wave` per second.
- Mana: max 100, regen `2 + upgrades.manaRegen` per second.
- AP / TP: persistent counters, set by PrestigeManager.

### 4.5 Upgrade Manager (`src/systems/UpgradeManager.ts`)

```ts
interface UpgradeDef {
  id: string; name: string; description: string;
  baseCost: number; costGrowth: number;        // multiplier per level
  effectPerLevel: number; effectType: 'add' | 'mult';
  maxLevel: number; category: 'tower' | 'economy' | 'utility';
}
```

**Example upgrades:**

| ID          | Name             | Base | Growth | Effect/level         |
|-------------|------------------|------|--------|----------------------|
| damage      | Sharper Arrows   | 50   | 1.15   | +2 base damage       |
| fireRate    | Quick Draw       | 75   | 1.20   | +0.1 shots/sec       |
| range       | Longbow          | 40   | 1.12   | +10 px range         |
| critChance  | Eagle Eye        | 200  | 1.50   | +2% crit chance      |
| goldMulti   | Greed            | 100  | 1.25   | +5% gold from kills  |
| manaRegen   | Meditation       | 150  | 1.30   | +0.5 mana/sec        |

Cost: `floor(baseCost * costGrowth^level)`.

### 4.6 Research Tree (`src/systems/ResearchTree.ts`)

- DAG with prerequisites; roots are free.
- Spent Research Points (RP) earned on Ascension: `1 RP per 1 AP earned`.
- Persists across Ascensions; reset on Transcendence.

**Example nodes:**

```
Piercing Shots (5 RP)        — arrows hit 2 enemies
Alchemy (3 RP)               — +25% gold from all sources
  └─ Transmutation (10 RP)   — enemies 5% chance for 3× gold
Mana Font (5 RP)             — +50% mana regen
  └─ Arcane Mastery (15 RP)  — abilities cost -30% mana
Veteran Scouts (3 RP)        — start Ascension at wave 5
  └─ Elite Scouts (10 RP)    — start Ascension at wave 15
Auto-Upgrader (20 RP)        — auto-buys cheapest available upgrade every 10s
```

### 4.7 Ability Manager (`src/systems/AbilityManager.ts`)

| Ability         | Mana | Cooldown | Effect                                  |
|-----------------|------|----------|-----------------------------------------|
| Rain of Arrows  | 30   | 15s      | Deal 5× towerDamage to all on screen    |
| Frost Nova      | 25   | 20s      | Slow all enemies by 50% for 5s          |
| Berserk         | 40   | 30s      | Double fire rate for 8s                 |
| Gold Rush       | 50   | 60s      | Triple gold drops for 15s               |

### 4.8 Prestige Manager (`src/systems/PrestigeManager.ts`)

**Layer 1 — Ascension:**
- Unlock: reach wave 30.
- On Ascend: reset gold, mana, upgrades, wave → 1. Keep research, RP, stats.
- Earn AP: `floor(sqrt(highestWave * 5))`. Wave 50 → 15 AP; wave 100 → 22 AP; wave 500 → 50 AP.
- AP perks (additive bonuses):
  - +5% damage per AP
  - +3% gold per AP
  - +2% mana regen per AP

**Layer 2 — Transcendence:**
- Unlock: AP ≥ 100.
- On Transcend: reset everything (gold, upgrades, wave, AP, research, RP).
  Keep TP, stats.
- Earn TP: `floor(log10(AP + 1) * 3)`. 100 AP → 6 TP; 1000 AP → 9 TP; 10000 AP → 12 TP.
- TP perks (multiplicative bonuses):
  - +50% all damage per TP
  - +25% all resource gain per TP
- TP automation unlocks:
  - 5 TP: auto-buy upgrades
  - 10 TP: auto-cast abilities
  - 20 TP: auto-Ascend at target wave
  - 50 TP: auto-Transcend

### 4.9 Save / Load + Offline Progress (`src/systems/SaveManager.ts`)

- Auto-save every 30 sec to `localStorage['the-tower-save']`.
- On load: parse JSON, validate schema, calculate offline progress.
- **Offline formula (heuristic, not full simulation):**
  ```
  elapsed = min(now - savedAt, 604800)   // cap 7 days
  effectiveDPS = towerDPS * elapsed * 0.7   // 70% efficiency offline
  goldEarned = effectiveDPS * avgGoldPerDamage
  wavesCleared = floor(elapsed / avgWaveDuration)
  ```
- Show "Welcome back! You earned X gold and cleared Y waves offline" modal.
- No prestige events during offline (player must do those manually).

---

## 5. Number Scaling & Economy (`src/data/formulas.ts`)

### 5.1 Scaling Formulas

| Quantity        | Formula                              | Example @ wave 50 |
|-----------------|--------------------------------------|-------------------|
| Enemy HP        | `baseHP × 1.12^(wave-1)`             | 1,442             |
| Tank HP         | `30 × 1.12^(wave-1)`                 | 4,326             |
| Boss HP         | `100 × 1.12^(w-1) × 1.5^floor(w/10)` | ~70,000           |
| Enemy speed     | `base × min(3, 1 + 0.03(w-1))`       | 2.47× base        |
| Gold drop       | `baseGold × 1.1^(wave-1)`            | ~434              |
| Upgrade cost    | `base × growth^level`                | —                 |
| AP per Ascend   | `floor(sqrt(highestWave × 5))`       | 15                |
| TP per Transcend| `floor(log10(AP + 1) × 3)`           | 6                 |

### 5.2 Number Display (`src/utils/bigNumber.ts`)

**Use standard number names, NOT letter suffixes.** This is a hard rule from
the project's best-practices doc — letter systems (AA, BB) obscure progress.

```ts
const SUFFIXES = [
  '', 'Thousand', 'Million', 'Billion', 'Trillion',
  'Quadrillion', 'Quintillion', 'Sextillion', 'Septillion', 'Octillion',
  'Nonillion', 'Decillion', 'Undecillion', 'Duodecillion', 'Tredecillion',
  'Quattuordecillion', 'Quindecillion', 'Sexdecillion', 'Septendecillion',
  'Octodecillion', 'Novemdecillion', 'Vigintillion',
];

function formatNumber(n: number): string {
  if (n < 1000) return Math.floor(n).toLocaleString();
  const exp = Math.floor(Math.log10(n));
  const tier = Math.floor(exp / 3);
  const scaled = n / Math.pow(1000, tier);
  if (tier < SUFFIXES.length) return scaled.toFixed(2) + ' ' + SUFFIXES[tier];
  return n.toExponential(2);  // scientific beyond Vigintillion
}
```

Examples: `1.50 Thousand`, `2.34 Million`, `7.81 Trillion`, `4.20 Quadrillion`.

### 5.3 Multiplier Stacking (final damage)

```
finalDamage = baseDamage
  × (1 + upgradeBonus + AP_damageBonus)        // additive within layer
  × (1 + TP_damageBonus)                       // multiplicative across layers
  × (crit ? critMultiplier : 1)
  × (activeAbilityBuff || 1)
  × (1 - magicResist)   if magic
  − armor               if physical, min 1
```

---

## 6. Game Loop — First 5 Minutes of Play

| Time     | Event                                                              |
|----------|--------------------------------------------------------------------|
| 0:00     | Page loads, canvas + UI appear, Wave 1 auto-starts                 |
| 0:00–0:30| 5 normal enemies spawn from edges, tower auto-fires arrows        |
| 0:30     | Wave 1 cleared, player has ~50 gold                                |
| 0:30–1:00| Player buys "Sharper Arrows", notices enemies dying faster        |
| 1:00–2:00| Waves 2–8, mix of normals + fasts (wave 3) + tanks (wave 5)        |
| 2:00     | Wave 10 — first boss spawns (large, dark red, 15+ hits)            |
| 2:00–3:00| Boss drops 200+ gold; player buys several upgrades                  |
| 3:00     | Mana bar unlocks (wave 10) — "Rain of Arrows" available             |
| 3:00–5:00| Waves 11–20, flying enemies appear (wave 8), healer (wave 15)     |
| 5:00+    | Player ~wave 25, building toward wave 50 for first Ascension      |
| 10–15 min| Wave 50 reached → "Ascension available" button activates          |

**Milestone toasts:** wave 10, 25, 50, 100; first boss kill; first ability
cast; first prestige; offline return with rewards.

---

## 7. Implementation Phases (Build Order)

Each phase ends with a testable, playable artifact.

### Phase 1 — Skeleton
- `npm create vite@latest the-tower -- --template vanilla-ts`
- `index.html` with canvas + UI container divs
- `Game.ts` rAF loop with FPS logging
- `Renderer.ts` draws tower as colored circle
- `types.ts` stubs
- **Test:** Tower visible, FPS counter stable

### Phase 2 — Core Combat
- Tower targeting + fire
- EnemyManager spawn/move/die
- ProjectileManager movement + hit detection
- WaveManager (normals only, wave 1+)
- ResourceManager gold tracking
- EventBus for kill events
- **Test:** Enemies swarm, tower auto-kills them, gold counter increments

### Phase 3 — UI Panels
- UIManager, HUD, UpgradePanel (buttons non-functional)
- styles/main.css dark theme
- **Test:** UI updates live, panels don't overlap canvas

### Phase 4 — Upgrades & Economy
- UpgradeManager buy logic
- data/upgrades.ts
- data/formulas.ts (cost scaling)
- utils/bigNumber.ts (standard-suffix formatting)
- Wire upgrade buttons
- **Test:** Buy upgrades, stats change, costs scale exponentially

### Phase 5 — Enemy Variety & Visual Polish
- All enemy types in data/enemies.ts
- Boss wave logic (every 10)
- Procedural Canvas shapes (see §8)
- HP bars, damage numbers, death particles
- **Test:** Waves 1–30 visually distinct, boss is unmistakable

### Phase 6 — Abilities & Mana
- AbilityManager with cooldowns + mana
- data/abilities.ts
- AbilityPanel UI with cooldown overlay
- Mana bar in HUD
- **Test:** Cast abilities, mana + cooldown work, effects apply

### Phase 7 — Prestige Layer 1 (Ascension) + Save/Load
- PrestigeManager: AP calculation, reset, perk application
- data/prestige.ts: AP perks
- SaveManager: localStorage + offline calc
- PrestigePanel UI
- **Test:** Reach wave 50, Ascend, verify reset + bonuses; reload page, verify save persists + offline progress shows

### Phase 8 — Prestige Layer 2 (Transcendence) + Research + Final Polish
- Transcendence logic + TP perks
- ResearchTree + ResearchPanel
- Automation features (auto-buy, auto-cast, auto-ascend)
- Notification polish
- Balance pass: ensure 2-hour playthrough reaches Transcendence
- **Test:** Fresh → Ascend → Transcend → automation kicks in

---

## 8. Asset Pipeline — Procedural Canvas Shapes

**Zero dependencies, zero licensing, infinite variety.** All visuals are drawn
in `Renderer.ts` using Canvas 2D primitives.

| Entity            | Shape                                                  |
|-------------------|--------------------------------------------------------|
| Tower             | Concentric gray/brown circles + triangle roof + flag   |
| Normal enemy      | Red circle, 12px radius, white border                  |
| Fast enemy        | Yellow diamond (rotated square), 10px                  |
| Tank enemy        | Dark blue circle, 18px, thick gray border              |
| Flying enemy      | White circle with two small wing triangles             |
| Healer            | Green circle, 14px, with cross icon                    |
| Boss              | Dark red circle, 30px, pulsing border (sin on radius)  |
| Projectile (phys) | Small yellow triangle pointing at target               |
| Projectile (magic)| Small purple circle with radial-gradient glow          |
| HP bar            | Green→red rect above enemy, width ∝ hp%                |
| Damage number     | White text + red stroke, floats up and fades           |

Renderer examples live in `src/game/Renderer.ts` — see drawEnemy/drawProjectile
helpers.

---

## 9. Critical Files to Create

| Path                                      | Purpose                                  |
|-------------------------------------------|------------------------------------------|
| `src/main.ts`                             | Bootstrap, mount Game                    |
| `src/game/Game.ts`                        | Loop, state, orchestration               |
| `src/game/Renderer.ts`                    | All canvas drawing                       |
| `src/game/EventBus.ts`                    | Pub/sub for side effects                 |
| `src/types.ts`                            | All interfaces (single source of truth)  |
| `src/systems/Tower.ts`                    | Targeting, fire, damage calc             |
| `src/systems/EnemyManager.ts`             | Enemy lifecycle                          |
| `src/systems/WaveManager.ts`              | Wave composition + scaling               |
| `src/systems/UpgradeManager.ts`           | Buy/sell, cost scaling                   |
| `src/systems/ResearchTree.ts`             | DAG, prerequisites, RP spending          |
| `src/systems/AbilityManager.ts`           | Cooldowns, mana, effects                 |
| `src/systems/PrestigeManager.ts`          | Ascension + Transcendence                |
| `src/systems/SaveManager.ts`              | localStorage + offline calc              |
| `src/data/formulas.ts`                    | All scaling formulas                     |
| `src/utils/bigNumber.ts`                  | Standard-suffix number formatting        |
| `src/ui/UIManager.ts`                     | Mounts and syncs all HTML panels         |
| `src/ui/HUD.ts`                           | Top bar                                  |
| `src/ui/UpgradePanel.ts`                  | Buyable upgrades                         |
| `src/ui/ResearchPanel.ts`                 | Research tree view                       |
| `src/ui/AbilityPanel.ts`                  | Active ability buttons                   |
| `src/ui/PrestigePanel.ts`                 | Ascend/Transcend UI                      |
| `styles/main.css`                         | Dark theme + panel layout                |
| `index.html`                              | Canvas + UI containers                   |

---

## 10. Verification Plan

### 10.1 Smoke Tests (run after each phase)

| # | Action                                  | Expected                                          |
|---|-----------------------------------------|---------------------------------------------------|
| 1 | Load page                               | Canvas visible, tower at center, FPS stable       |
| 2 | Wait 3 sec                              | Wave 1 enemies spawn from edges, move inward      |
| 3 | Observe tower                           | Fires arrows at nearest enemy                     |
| 4 | Watch enemy die                         | Gold counter increments                           |
| 5 | Open Upgrade panel                      | Upgrades listed with cost                         |
| 6 | Buy "Sharper Arrows"                    | Gold decreases, kills-per-hit increases           |
| 7 | Reach wave 10                           | Boss spawns (larger, distinct color, 200+ gold)   |
| 8 | Buy upgrade to level 5                  | Cost grows exponentially                          |
| 9 | Cast "Rain of Arrows"                   | Mana depletes, all enemies take damage, cooldown  |
| 10| Reach wave 50                           | "Ascension available" button activates            |
| 11| Click Ascend                            | Reset, AP gained, permanent bonuses apply         |
| 12| Close tab, wait 30s, reopen             | Save loads, offline progress modal appears        |
| 13| Earn 100+ lifetime AP                   | "Transcendence available" button activates        |
| 14| Click Transcend                         | Everything resets, TP gained, automation unlocks |
| 15| Reach 5 TP                              | Auto-buy upgrades fires every 10s                 |

### 10.2 Edge Cases

| Scenario                       | Expected behavior                                        |
|--------------------------------|----------------------------------------------------------|
| High refresh rate (>144fps)    | rAF caps to display rate; dt capped at 50ms             |
| Low FPS (<30fps)               | Game logic speed unchanged (driven by dt), may look choppy |
| localStorage full              | Save fails silently, game continues, console warning     |
| Corrupt save JSON              | Caught by try/catch, reset to fresh game, toast shown    |
| Background tab for hours       | rAF pauses, on return: offline progress calculated       |
| Buy upgrade can't afford       | Button disabled when `gold < cost`                      |
| All enemies dead               | 5s intermission countdown, "Next wave in Xs" shown       |

### 10.3 Balance Targets

| Milestone                     | Target time       |
|-------------------------------|-------------------|
| First upgrade purchase        | ~30 sec           |
| First boss (wave 10)          | ~2 min            |
| First Ascension (wave 50)     | ~10–15 min        |
| Subsequent Ascensions         | ~5–8 min each     |
| First Transcendence           | ~2 hr total play  |
| Active vs idle efficiency     | Active ~2× idle   |

### 10.4 Visual Verification

- All 6 enemy types visually distinct (color, shape, size).
- HP bars visible above each enemy.
- Projectile flight is visible (not instant).
- Damage numbers appear at hit location and float up.
- Boss is unmistakable (≥2× size, pulse animation).
- UI panels don't overlap game view at 1366×768 minimum.

---

## 11. Best-Practices Alignment (Self-Check)

| User rule                                      | How this plan satisfies it                                                                  |
|------------------------------------------------|---------------------------------------------------------------------------------------------|
| Passive from the Start                         | Wave 1 auto-starts, tower auto-fires                                                        |
| Significant Offline Progress                   | 8-hour cap, heuristic calc, "Welcome back" modal                                            |
| Unfolding Mechanics                            | Research tree, two prestige layers, TP-unlocked automation                                  |
| Standard Number Names (NOT AA/BB)              | `bigNumber.ts` uses Million/Billion/Trillion/.../Vigintillion, then scientific              |
| Exponential growth                             | `1.12^wave` HP, `1.1^wave` gold                                                             |
| Frequent milestones                            | Wave 10/25/50/100 toasts, first boss, first prestige                                        |
| Reset for Permanent Buffs                      | AP, TP both give permanent multipliers                                                      |
| Meaningful Resets                              | Keep research + RP across Ascend; keep stats + TP across Transcend                          |
| Automate the Old Grind                         | TP-gated auto-buy, auto-abilities, auto-Ascend, auto-Transcend                              |
| Layered mechanics                              | 2 prestige layers (Ascend → Transcend)                                                      |
| Flexible Playstyles                            | Works idle (auto everything) or active (manual abilities)                                   |
| Clear Goals & Visuals                          | Milestone toasts, damage numbers, HP bars, level-up effects                                 |
| Clear number formatting                        | Standard names, 2-decimal display                                                           |
| Obvious bottlenecks                            | Cost/gold ratio visible in upgrade buttons; big-number display makes income vs cost legible |
| Satisfying feedback                            | Bright procedural colors, particles, damage numbers, toasts, milestone popups               |
