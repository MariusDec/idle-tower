# Forge weapons: one at a time, each with its own spotlight

Status: **steps 1–7 implemented (2026-11-26), step 6 as D-rev.** Where
the build left this plan, measured (`docs/balancing.md`, "One weapon at a
time"):
- **D4 softened:** the suggestion is *not* forced onto the fresh weapon.
  Forcing it made auto-pick take Sunlance over Twin Mount's Mortar in
  Region 3, and the Prism fell ~20 min later. Instead the scorer adds
  `DEBUT_VALUE` (0.25) to its score, so auto-pick leans toward trying it.
- **The debut card is added on top of the hand** (up to `maxChoices`), not
  in place of a card. In place of one, I5 read 1.13 at the Bog Mother.
- **D2:** `maxRuns` is 5, not 8. At 8, Frost Ring (which the bot never
  takes) held Mortar back 20 min and opened a 12-min reveal gap.
- **Added:** a "Ready to forge: X" results line when a weapon node opens,
  and a sentence in the Forge's explainer.
- **Step 5's node-text rewording was skipped:** the card now shows the
  weapon's own line.
- **Every test passes** (59 files, 1237 tests), the CI's every-profile
  first-hour I6 included, once the scorer leans toward the fresh weapon.

**Step 6 built as D-rev (2026-11-26).** Its original version (Sunlance,
Drones and Glaives all moved) was tried on a copy of the tree and
**rejected**: it empties Region 2, and Sunlance lands after the Prism.
D-rev (Drones to the Prism, Glaives to Forgeheart, Sunlance stays) passes
every gate on the real tree, 8/8 profiles in both shopping modes
(`docs/balancing.md`, "Weapons past the Prism"). Two differences from the
copy: the two nodes moved to their rings' places in the `FORGE` array, which
changes the bot's tie-breaks after Forgeheart (bot Blight median 268:52 on
the tree, 263:03 on the copy; 256:38 before step 6). And the full suite
passes: 59 files, 1238 tests, including a new seal test.

Written 2026-11-26 from the owner's
note: *"The weapons get unlocked too quickly one after the other and there's
no time to actually see how they function (you could even buy 2-3 weapons at
the same time)."*

Every claim below was checked against the code on `main` at `6fe6d2d`.
Design calls made while writing this are marked **(proposed)**. The owner
can overturn any of them; the steps say what changes if they do.

---

## 1. What is wrong today (evidence)

### 1.1 The weapon nodes

Seven Act 1 weapons are Forge notables in the Arsenal branch
(`src/content/forge.ts`). Arcane Bolt is the Arcanist's starting weapon
(`src/content/frames.ts:10`). Act 2's four weapons are lit in the
Constellations (`src/content/stars.ts`), so they are out of scope here.

| Node (line) | Ring | Links | Cost | Sealed by |
|---|---|---|---|---|
| `scattershot` (`forge.ts:194`) | 1 | `might-damage` | 20 | — (also gives +1 weapon slot) |
| `chain-lightning` (`:199`) | 1 | `scattershot` | 30 | — |
| `frost-ring` (`:209`) | 2 | `chain-lightning` | 180 | — |
| `mortar` (`:225`) | 2 | `frost-ring` | 240 | gatekeeper |
| `sunlance` (`:230`) | 3 | `mortar` | 560 | gatekeeper |
| `glaives` (`:235`) | 3 | `mortar` | 620 | gatekeeper |
| `sentinel-drones` (`:240`) | 3 | `glaives` | 1200 | bog-mother |

### 1.2 Shard income versus those prices

`npm run pacing -- --hours 6 --seed 1` (the active bot, cheapest-first
shopping, `tools/shop.ts`) gives these incomes and boss falls:

| Stretch | Shards per run | Wall time per run |
|---|---|---|
| Region 1 before the Gatekeeper (runs 1–14) | 55–224 | ~2–3 min |
| The Gatekeeper's run (run 15) | 962 | |
| Region 2 | 660–1010 | ~2.2 min |
| The Bog Mother's run | 4671 | |
| Region 3 | 3300–5800 | |
| The Prism's run | 17804 | |
| Region 4 | 4000–23000 | |

Boss first falls (seed 1): Gatekeeper 35:05, Bog Mother 65:40, Prism 74:51,
Forgeheart 135:04, Hollow King 196:52, Blight 270:33.

The weapon prices are nearly flat, but income grows about 5× at each boss.
So every weapon costs less than one run of the pay at the point where it
opens.

### 1.3 When the weapons arrive

**The bot** (cheapest-first, seed 1, from the reveal CSV):

| Weapon | Bought at |
|---|---|
| Scattershot | 9:45 |
| Chain Lightning | 16:04 |
| Frost Ring | 39:39 |
| Mortar | 48:55 |
| Sunlance **and** Glaives | **67:57 (same shop visit)** |
| Sentinel Drones | 75:03 |

**A player who buys weapons first** (estimated from the seed-1 incomes
above; the bot can't play this way yet, see step 1):

| Weapon | Affordable at | Why |
|---|---|---|
| Scattershot **and** Chain Lightning | after run 1–2 (~3 min) | 8 + 20 + 30 = 58 shards, and run 1 pays 55 |
| Frost Ring | after run 4 (~10 min) | 180 shards |
| Mortar **and** Sunlance | the Gatekeeper's results screen (~35 min) | 240 + 560 = 800 of the run's 962 |
| Glaives | one run later | 620 |
| Sentinel Drones | the Bog Mother's results screen (~66 min) | 1200 of the run's 4671 |

That matches the owner's report: weapons arrive in three bursts (around
3 min, 35 min and 66 min). After the Bog Mother no new weapon arrives for the
remaining ~3.5 h of Act 1.

### 1.4 Why "joins the draft" doesn't mean "you get to try it"

- Base weapon slots are **1** (`src/content/balance.ts:39`). Scattershot adds
  the second. The third comes with Third Mount (Prism, 7500) and the fourth
  with Fourth Mount (Hollow King). From ~10 min to ~110 min the tower has
  **one free weapon slot**.
- `candidateCards` (`src/sim/systems/draft.ts:134-151`) offers a new weapon
  only while a slot is free (`weaponFree`, line 139). So in a run, the first
  new weapon taken closes the door on every other one.
- Each weapon added to the pool lowers the chance that any given new weapon
  turns up before that slot fills. Buying three at once makes each of them
  *less* likely to be seen.
- The Forge detail card says only "Chain Lightning joins the draft."
  (`forge.ts:200`; rendered at `src/ui/hub/forge.ts:471-473`). Nothing says
  what the weapon does or what it is good against. `WeaponDef.text` and
  `counters` exist (`src/content/weapons.ts`) but the Forge never shows them.

### 1.5 Placement against the regions (the "how well placed" part)

Each weapon's `counters` and `weakAgainst` (`src/content/weapons.ts`)
against the region pools (`src/content/regions.ts`):

| Region | Main enemies | Weapons that counter them | Weapons blunted there |
|---|---|---|---|
| R1 Ashen Fields | grunt, runner, brute | Scattershot, Chain, Frost, Glaives, Mortar, Sunlance (brute) | — |
| R2 Drowned Mire | splitter, spitter, mender | Mortar, Chain (splitter); Drones (spitter, mender); Sunlance (mender) | — |
| R3 Glass Wastes | shieldbearer, burrower, shardling | **Mortar, Drones** (shieldbearer); Frost, Glaives (burrower) | Arcane Bolt and Scattershot (shields); Glaives (shardling) |
| R4 Ember Rift | bomber, blinker, siege-engine | Scattershot (bomber, blinker); Frost (blinker); **Drones** (siege-engine) | **Glaives** (bomber) |
| R5 The Hollow | phantom, leech, summoner | Drones (phantom, summoner); Glaives, Frost (leech); Mortar, Sunlance (summoner) | — |

What this shows:
- **Mortar must stay owned before Region 3.** Its shields wiped two-weapon
  towers (`docs/balancing.md` §"I3 can't be met with numbers alone"; Twin
  Mount's `twinSpares` now draws a counter, `src/sim/run.ts:88-94`).
- **Sentinel Drones** fit Region 4 (siege engines) and Region 5 best.
- **Glaives** are blunted by Region 4's bombers and shine against Region 5's
  leeches.
- **Sunlance** counters menders, brutes and boss-type HP sponges. It suits
  the Bog Mother → Prism stretch.

### 1.6 What is fine and stays

- Scattershot as the first weapon, cheap and early, together with the second
  slot. It is the tutorial moment.
- The Arsenal branch hanging from Might (`forge.ts:196`, links
  `might-damage`).
- Second Focus, Twin Mount, Alchemy, Specialist, Third and Fourth Mount,
  where they are.

---

## 2. The plan in one paragraph

Three changes, in order of value:

- **A. One weapon at a time.** After a weapon is forged, the other weapon
  nodes stay locked until it has been *carried* in 3 runs.
- **B. Debut offer.** A freshly forged weapon is always offered in the first
  draft that has a free weapon slot, and the suggestion picks it, so the
  player (and auto-pick) actually tries it.
- **C. Show the weapon on its Forge card.** Its one-line description, what it
  is strong against, and why it is locked.

These three fix the complaint without moving any price.

- **D (optional, a pacing change). Spread the later weapons across Act 1.**
  As measured in step 6, the version to build is **D-rev**:
  - Sentinel Drones become the Prism's prize.
  - Glaives become Forgeheart's.
  - Sunlance stays where it is (the original D moved it to the Bog Mother;
    measured and rejected, see step 6).

  D-rev keeps weapon novelty going past the ~90-minute mark that steps 1–5
  leave. It needs the full pacing and arsenal gates.

Step 1 (a "weapons-first" bot) comes before all of them, so the complaint
can be measured, and so is each fix.

---

## 3. Steps

Before editing any symbol, run GitNexus `impact` on it (CLAUDE.md). Results
taken while writing this plan:

| Symbol | Risk | Note |
|---|---|---|
| `rollOffer` (`src/sim/systems/draft.ts:163`) | CRITICAL | 3 direct callers: `forgedOffer`, `tickDraft`, `rerollDraft`; 4 flows (App `step`, `claim`, `syncDraft`; tools `simulate`) |
| `suggest` (`src/sim/suggest.ts:501`) | CRITICAL | same flows as `rollOffer` |
| `buildRunConfig` (`src/meta/runConfig.ts:47`) | CRITICAL | 8 direct, 12 flows: every run start, pacing, idle, act2 |
| `createRun` (`src/sim/run.ts`) | CRITICAL | 11 direct, 12 flows |
| `isSealed` (`src/meta/forge.ts:35`) | LOW, *but misleading* | It is passed by reference into `FORGE_WEB` (`forge.ts:46`), so the graph sees no callers. In fact every Forge state, buy, `nextGoal`, Foreman purchase and bot purchase goes through it. Treat it as HIGH. |

These are CRITICAL because every run goes through them. The changes below
only *add* behaviour, and that behaviour is off whenever no weapon is fresh.
Report this to the owner before starting, as CLAUDE.md requires.

### Step 1: a weapons-first shopper and a weapon-spacing reading (tools only)

**Why first:** the bot shops cheapest-first, so it never reproduces the
complaint. Without this step no fix can be measured.

1. `tools/shop.ts`: add
   `export const WEAPONS_FIRST = process.argv.includes('--weapons-first');`
   (the same pattern as `FAST_STEPS` in `tools/play.ts:105`; pacing workers
   inherit `argv`, see `tools/parallel.ts:34`).
   In `shop()` (`tools/shop.ts:15`), when `WEAPONS_FIRST`, loop first over
   the Forge nodes that unlock a weapon (see `weaponOf` in step 2). Buy each
   one that `canAfford`, cheapest first. Then fall through to the existing
   cheapest-first loop. Weapon nodes may sit behind a non-weapon link
   (Scattershot needs `might-damage`), so also buy the cheapest *unowned*
   link on the path. Simplest version: repeat until no purchase happens.
   1. Buy any affordable weapon node.
   2. Otherwise, if a weapon node is `fog` or `hidden` only because a
      neighbour is unowned, buy that neighbour's first level if affordable.
   3. Otherwise run the old loop once.
2. `tools/pacing.ts`: after the run loop, collect the reveals whose `what`
   is `notable: <name>` where `<name>` is a weapon node's `name` (they are
   pushed at `tools/pacing.ts:462`). Print a block:
   ```
   weapons (W1):
      9:45  Scattershot
     16:04  Chain Lightning   (+6:19)
     ...
   ```
   Then a verdict line **W1**: *every gap between consecutive weapon
   purchases ≥ 5:00 wall, and no two weapons in one shop visit* (two reveals
   at the same `at`). With `--seeds N`, report pass counts like I6 does
   (`tools/pacing.ts:1002`). Gate W1 at ≥ 6 of 8 profiles, both with and
   without `--weapons-first`. **(proposed numbers: 5 min, 6/8)**
3. Record the baseline (before steps 2–6) and paste it into the "Readings"
   section at the bottom:
   ```bash
   npm run pacing -- --hours 2 --seeds 8
   ```
   ```bash
   npm run pacing -- --hours 2 --seeds 8 --weapons-first
   ```
   Expected today: W1 FAILS in both (Sunlance and Glaives together for the
   bot, three bursts for weapons-first).

**Tests:** none (tools). `npm run typecheck` covers `tsconfig.tools.json`.
**Done when:** both commands print the W1 block and verdict, and the baseline
is written down.

### Step 2: "fresh" weapons, the shared definition (meta only)

New state: the run count at which each weapon node was bought. It is needed
for the escape hatch in the definition, and for choosing the newest weapon
when there are several.

1. `src/meta/profile.ts`:
   - Add to `Profile` (next to `forge`, line 29):
     ```ts
     /** Forge weapon nodes: `records.runs` when each was bought (plans/forge-weapon-pacing.md). Missing: bought before this existed, never fresh. */
     forgedAt: Record<string, number>;
     ```
   - Bump `version: 27` (line 12) to `28`, and give `newProfile` `forgedAt: {}`.
2. `src/meta/save/migrate.ts`: add a rung after line 127:
   ```ts
   27: (raw) => ({ ...raw, version: 28, forgedAt: {} }),
   ```
   An empty map means no existing save's weapon is fresh: nobody gets locked
   out by the update.
3. `src/content/balance.ts`: add next to `forge` (line 74):
   ```ts
   /**
    * A weapon fresh from the Forge (plans/forge-weapon-pacing.md): its first
    * draft offers it, and the other weapon nodes wait, until it has been
    * carried in `runs` runs or `maxRuns` runs have passed since it was forged.
    */
   debut: { runs: 3, maxRuns: 8 },
   ```
   **(proposed: 3 carried runs ≈ 6–9 min in Region 1; `maxRuns` 8 is the
   escape for a player who keeps refusing it)**
4. `src/meta/forge.ts`: add these helpers (forge.ts already imports
   `Profile`. Import `WeaponId` from `../content/types` and `isWeaponId` from
   `../sim/systems/draft`, as `runConfig.ts:7` does):
   ```ts
   /** The weapon a Forge node unlocks, or null. */
   export function weaponOf(node: ForgeNodeDef): WeaponId | null;
   //   first effect with kind 'unlockCard' whose id passes isWeaponId, else null

   /** Forge weapons still fresh: forged, carried < debut.runs, forged < debut.maxRuns runs ago, on no Never list. Newest first. */
   export function freshWeapons(profile: Profile): WeaponId[];
   ```
   `freshWeapons` rules:
   - Walk the `FORGE` nodes with `weaponOf(n) !== null` and
     `levelOf(profile, n.id) > 0` and `profile.forgedAt[n.id] !== undefined`.
   - Keep `w` when `(profile.recipes.carried[w] ?? 0) < BALANCE.debut.runs`,
     **and** `profile.records.runs - profile.forgedAt[n.id] < BALANCE.debut.maxRuns`,
     **and** no list in `profile.tacticsNever` (any key) includes `w`.
   - Sort by `forgedAt` descending, ties by `FORGE` order.

   `profile.recipes.carried` already counts every run that carried each
   weapon (`src/meta/recipes.ts:55-58`, called from `bankRun`,
   `src/meta/results.ts:443`). **Reuse it; don't add a second counter.**
5. `buyNode` (`src/meta/forge.ts:105`): after a successful
   `FORGE_WEB.buy`, if `weaponOf(node)` is set, write
   `profile.forgedAt[id] = profile.records.runs`. Every purchase goes through
   `buyNode`: the hub (`src/app/App.ts:1254`), the Foreman
   (`src/meta/automation.ts:208`) and the bot (`tools/shop.ts:28`).
6. `refundNode` (`src/meta/forge.ts:113`): on a successful refund,
   `delete profile.forgedAt[id]`.

**Tests** (`tests/forge.test.ts`, new `describe('Forge: fresh weapons')`):
- A fresh profile has no fresh weapons.
- Buying `scattershot` makes it fresh. Setting `recipes.carried.scattershot = 3`
  makes it stale.
- `records.runs += 8` after the buy makes it stale (`maxRuns`).
- A Never list holding it makes it stale.
- With two fresh weapons, the later-bought one comes first.
- `tests/save.test.ts`: migration 27→28 adds `forgedAt: {}`. Update any
  assertion on the latest version number.

**Done when:** typecheck and `npm test` pass. No gameplay change yet.

### Step 3 (A): one weapon at a time

1. `isSealed` (`src/meta/forge.ts:35-38`): add, before the existing
   `return`:
   ```ts
   // One weapon at a time (plans/forge-weapon-pacing.md): an unbought weapon
   // node waits while another is still fresh from the Forge.
   if (weaponOf(node) && levelOf(profile, node.id) === 0 && freshWeapons(profile).length > 0) return true;
   ```
   Because `FORGE_WEB` takes `sealed: isSealed` (`forge.ts:46`), this covers
   `states`, `isBuyable`, `canAfford`, `buy`, `nextGoal`, the Foreman and the
   bot, all at once.
2. **The seal line.** `WebViewSource.sealLine` takes only the node
   (`src/ui/hub/forge.ts:70`, used at `:455`, Forge implementation at
   `:736-738`, Stars at `:757`). Change the signature to
   `sealLine(node: N, profile: Profile): string`, update both
   implementations, and pass `p` at `:455`. In the Forge's, before the boss
   branch:
   ```ts
   const fresh = weaponOf(n) ? freshWeapons(profile)[0] : undefined;
   if (fresh && (!n.sealed || bossDown(profile, n.sealed)))
     return `Forging — carry ${WEAPON_BY_ID[fresh].name} in ${left} more run${left === 1 ? '' : 's'}.`;
   ```
   where `left = BALANCE.debut.runs - (profile.recipes.carried[fresh] ?? 0)`.
   A boss seal that hasn't fallen yet keeps its own line.
3. **The "N Forge nodes unsealed" reveal** (`src/meta/results.ts:249`)
   counts boss seals. Check that it reads `n.sealed === boss`, not
   `isSealed`, so the count isn't changed by a cooling weapon. If it uses
   `isSealed`, keep the count on the boss field only.

**Tests** (`tests/forge.test.ts`):
- After buying `scattershot`, `chain-lightning` is `sealed` in `nodeStates`
  and `buyNode(p, 'chain-lightning')` returns false with enough shards.
- After `recipes.carried.scattershot = 3`, it is `open` and buyable.
- A non-weapon node next to it (`passive-slot`) is unaffected.
- `nextGoal` skips the cooling node.

**Done when:** tests pass, and in the hub the locked Chain Lightning card
reads "Forging — carry Scattershot in 3 more runs."

### Step 4 (B): the debut offer and its suggestion

1. `RunConfig` (`src/sim/state.ts:22`): add
   ```ts
   /** A weapon fresh from the Forge: the first draft with a free slot offers it (plans/forge-weapon-pacing.md). Absent: none. */
   readonly debut?: WeaponId | null;
   ```
2. `buildRunConfig` (`src/meta/runConfig.ts:47`): after the pool is final
   (after line 144, where the joined passives are added), compute
   ```ts
   const authored = !!trial || !!contract || extra.length > 0 || abyss || isRush(region…);
   const debut = authored ? null : freshWeapons(profile).find((w) => w !== first && pool.includes(w)) ?? null;
   ```
   Then put `debut` in the returned object. Use whatever Boss Rush check
   `buildRunConfig` already uses for "never in the Abyss or Boss Rush"
   (comment at line 48), and copy that condition exactly. **(proposed: no
   debut in Trials, contracts, the Daily Omen, the Abyss or Boss Rush: those
   runs are authored)**
3. `RunState` (`src/sim/state.ts`, next to `twinOffer` at line 893): add
   `debutOffer: WeaponId | null;`. In `createRun` (`src/sim/run.ts`, the
   returned object near `twinOffer` at line 125), set
   `debutOffer: config.weaponSlots >= 2 && config.debut ? config.debut : null`.
   A resumed run saved before this has no field. Read it as
   `run.debutOffer ?? null` wherever it is read.
4. `rollOffer` (`src/sim/systems/draft.ts:174-176`): treat the debut like
   Twin Mount's weapon:
   ```ts
   const debut = (c: Card): boolean => c.kind === 'weapon' && c.id === (run.debutOffer ?? null) && c.level === 1;
   const forced = [...candidates.filter(isForced), ...candidates.filter(twin), ...candidates.filter((c) => debut(c) && !twin(c))].slice(0, n);
   const hand = candidates.filter((c) => !isForced(c) && !twin(c) && !debut(c));
   ```
   `candidateCards` already drops it once the weapon slots are full
   (line 145), so the forcing stops by itself.
5. `pickCard` (`draft.ts:347-359`): unlike Twin Mount, **don't** clear
   `debutOffer` after one draft. It stays forced in every draft until taken
   or until the slots fill. Clear it when a weapon card with that id is
   applied. **(proposed: Twin Mount gives up after one draft; a debut keeps
   asking, because its whole point is to be tried)**
6. `suggest` (`src/sim/suggest.ts:501`): when there is **no** Tactician list
   (`priority` is null) and a card in `cards` is the debut weapon at level 1
   and not ruled out, return its index before the scorer runs. A Tactician
   list still wins, since the player wrote it. **(proposed: this is what
   makes auto-pick and idle players try the new weapon; without it the
   cooling gate could stall them until `maxRuns`)**
7. Badge (optional, small): add `| { readonly kind: 'debut' }` to `CardBadge`
   (`suggest.ts:343-348`) and push it in `cardBadges` (`:353-363`) when
   `card.id === run.debutOffer && card.level === 1`. In `badgeText`
   (`src/ui/draft.ts:52-71`) add
   `case 'debut': return { short: 'Fresh', long: 'Fresh from the Forge: carried in three runs, it opens the next weapon.' };`.
   The `never` exhaustive switch there makes this required once the union
   grows.

**Tests:**
- `tests/draft.test.ts`: with `debutOffer: 'chain-lightning'` and a free
  slot, every `rollOffer` over 20 seeds includes it. With slots full, never.
  With a Twin Mount offer of the same id, it appears once.
- `tests/behaviours.test.ts` (Twin Mount block, lines ~138-170): these build
  profiles with weapons owned and `carried` empty. They have **no
  `forgedAt`**, so nothing is fresh and they stay as they are. If any test
  sets `forgedAt`, give it `recipes.carried[id] = BALANCE.debut.runs`.
- `suggest`: with no priority and the debut on offer, returns its index.
  With a priority list naming another card, returns that.
- `buildRunConfig`: a debut in a normal run, none with a Trial selected.

**Expect** some seed-sensitive tests to shift if a fixture now has a fresh
weapon (the forced card changes the RNG draw order). Fix the fixture (mark
the weapon carried), not the assertion, unless the test is about drafts.

**Done when:** `npm test` passes. In a real run after buying Chain Lightning,
the first draft shows it with a "Fresh" badge, and auto-pick takes it.

### Step 5 (C): the Forge card shows the weapon

UI only, no sim. Per the owner's rule, cosmetic changes don't need the pacing
run (memory: skip sim for cosmetic). Typecheck and targeted tests are enough.

In the open-node detail (`src/ui/hub/forge.ts:465-473`) and the sealed-node
detail (`:443-457`), when `weaponOf(n)` is set (Forge view only: put it
behind a new optional `WebViewSource.extra?(node, profile): HTMLElement[]`
so the Stars view is untouched):
- A line with the weapon's `WEAPON_BY_ID[id].text` (e.g. "Lightning that
  arcs across 3 enemies.").
- "Strong against:" followed by the `ENEMY_BY_ID[e].name` of each `counters`
  entry **the player has met** (`profile.seenEnemies`). Leave out unseen
  ones, so nothing is spoiled. Skip the line if none are seen.
- Same for "Blunted by:" from `weakAgainst`.

Also reword the seven nodes' `text` in `src/content/forge.ts` from "X joins
the draft." to "X joins the draft, and your next drafts offer it." Keep
Scattershot's "+1 weapon slot" clause. **(proposed wording)**

**Done when:** in the browser preview, tapping Mortar in the Forge shows its
line and the enemies it counters that you have met.

### Step 6 (D, optional): spread the later weapons across Act 1

This is a pacing change. Steps 1–5 already answer the owner's complaint
(W1 8/8 in both shopping modes). Step 6 is about what remains: **after
~90 min (bot) or ~78 min (weapons-first), no new Act 1 weapon arrives for the
2.7–3.2 h left before the Blight.** Build it only if the owner wants weapon
novelty past the Prism (D6).

**Checked and measured 2026-11-26** on scratch copies of the working tree
(steps 1–5 in, uncommitted, on `6fe6d2d`). Four layouts were run, each 8
profiles × 6 h in both shopping modes, plus 8 more weapons-first seeds to
2.5 h: the original D, Glaives alone at 100000, Glaives alone at 36000, and
**D-rev**. The original D is rejected (6.2), and D-rev is the version to build
(6.3–6.8). All readings are in 6.7 and in §5.

#### 6.1 Where steps 1–5 left the weapons

6 h, 8 profiles, ranges over the seeds (`npm run pacing -- --hours 6 --seed N`,
N = 1–8):

| Weapon | Bot (cheapest-first) | `--weapons-first` |
|---|---|---|
| Scattershot | 7:18–9:45 | 2:01–4:04 |
| Chain Lightning | 15:26–17:59 | 9:13–11:37 |
| Frost Ring | 35:10–38:44 | 20:43–24:50 |
| Mortar | 45:24–52:00 | 33:55–46:46 |
| Sunlance | 67:02–71:19 | 41:05–53:33 |
| Glaives | 77:47–84:20 | 47:19–64:07 |
| Sentinel Drones | 87:06–92:14 | 70:32–92:08 |
| *Blight falls* | *242:17–295:25* | *244:13–295:58* |

The last weapon's median is 90:24 (bot) and 77:49 (weapons-first). The
Blight comes a median 2:44 h and 3:14 h after it. One more thing seen today:
when Mortar has been carried enough, Sunlance **and** Glaives open at once
("Ready to forge: Sunlance" and "Ready to forge: Glaives" on one results
screen, seed 4 at 53:17). D-rev takes Glaives out of ring 3, so that double
line goes away.

#### 6.2 What the check found in the original step 6

The original proposal: Sunlance → Bog Mother (2500), Drones → ring 4 / Prism
(12000), Glaives → ring 5 / Forgeheart (100000). Measured on a copy:

- **It empties Region 2.** With Sunlance and Glaives gone, nothing is left to
  forge between Mortar (~49 min) and the Bog Mother. Seed 1 (bot) read
  **I6 11:23 from 49:37**: Mortar's card, then nothing until a relic at 61:01.
- **Sunlance lands after the Prism for the bot.** The bot needs only ~8 min
  from the Bog Mother to the Prism (69:38 → 78:01, median), and buys cheaper
  nodes first. Sunlance came at 78:19–87:36 against Prism falls at
  73:44–82:45. So "the Bog Mother's prize" is in practice a Region 4 weapon.
- **The prices don't land the weapons at their bosses.** For the bot, Drones
  at 12000 came 121:23–135:14 (around Forgeheart, not the Prism), and Glaives
  at 100000 came 205:18–231:00 (after the Hollow King). Forgeheart's run pays
  ~74000 (seed 1) and Region 5 runs 12000–48000, so 100000 is three or four
  runs, not "the boss's prize".
- **The first evolution moved below §7.1's window**: median 87:07 (bot), aim
  90–120.
- **Layout: angle 120 is too tight.** It leaves 7 units between Drones' edge
  and Foreman's edge (`foreman`, Engineering ring 4, angle 126). The tightest
  pair on the web today is 11 (for example `frost-ring`/`mortar`). Angle 119
  gives 19 to Foreman and 25 to `arsenal-duration`. Angle 118 gives 13 and 31.
- **Ring-5 notables cost 36000–128000** (`offline-4` is 36000), not
  96000–128000.
- **I4 cannot see this change.** `tools/arsenal.ts:115` puts *every* Act 1
  weapon in the pool, whatever the Forge owns. So `npm run arsenal` reads
  nearly the same for every layout (worst Sunlance 31–37%, PASS). Keep the
  gate, but it doesn't measure the risk the original plan named. The pacing
  runs do (6.7).
- **Content the original plan missed moves with the weapons.** None of it
  breaks, but say so in the docs:
  - Passives join the pool only with their weapon (`runConfig.ts:144`,
    `joinsWith`). Velocity (with Drones) then waits for the Prism, and Reach
    (with Glaives) for Forgeheart.
  - The evolutions that use these weapons: Halo (Glaives + Reach) and Hive
    (Drones + Insight), in `src/content/evolutions.ts`.
  - The fusion Sky Hive (Glaives + Drones, `src/content/fusions.ts`).
  - The anomaly Gyre (Glaives, `src/content/anomalies.ts`).

  The first evolution was Seeker Swarm (Arcane Bolt) on every seed checked,
  so these moves don't push it out.
- **Still true as the plan said** (checked):
  - `towerTier` (`src/meta/forge.ts:210-218`) needs every non-keystone node
    of a ring owned, so a ring-3 node sealed by Forgeheart would hold back
    tiers 4+. Moving the weapons outward is still right.
  - The lint (`src/content/lint.ts:147-198`) allows links only to the same
    ring or one ring in.
  - Trials mount their weapons "unlocked or not" (`runConfig.ts:134`). The
    trials naming Sunlance or Glaives are in Regions 4 and 6
    (`shell-and-beam`, `pure-light`), and Regions 2–3's trials don't use them.
  - The Artificer frame (Drones) comes from the Tinkerer feat, which needs
    four level-5 weapons.
  - The Beacon Road secret is a Sunlance tally in Region 2
    (`secrets.ts:32`). D-rev leaves Sunlance where it is.
- **The lighter "Glaives only" version (D6's alternative) has a bad Prism
  tail for weapons-first players.** Over 16 weapons-first seeds the Prism
  fell at 74:33–152:07, and 5 of the 16 took over 110 min (138:59, 127:59,
  111:54, 152:07, 116:47; seed 9 sat at Region 3's wave 18–19 for ~50 min).
  Today's tree reads 80:02–110:22 over the same seeds. The cause is likely
  the weapon mix in Region 3 (Sunlance and Drones without Glaives), but the
  check only measured it, it didn't prove the cause. Rejected.

#### 6.3 The proposal: D-rev

| Weapon | Arrives (measured) | Why there |
|---|---|---|
| Scattershot … Mortar | unchanged | unchanged |
| Sunlance | unchanged: Region 2, bot 67–71 min, weapons-first 41–54 min | fills Region 2. Menders, brutes, the Bog Mother |
| Sentinel Drones | **the Prism's prize**: weapons-first within a minute of the Prism's fall, bot 101–117 min | Region 4's siege engines, Region 5's phantoms and summoners |
| Glaives | **Forgeheart's prize**: weapons-first within a minute of Forgeheart's fall, bot 158–174 min | Region 5's leeches. Region 4's bombers blunt it, so it skips Region 4 |

**Node edits** (`src/content/forge.ts`). Every other field stays as it is.
Line numbers are from the current working tree:

| Node (line) | Field | Now | D-rev |
|---|---|---|---|
| `glaives` (`:236-239`) | `ring` | 3 | **5** |
| | `angle` | 106 | **124** |
| | `links` | `['mortar']` | **`['sentinel-drones']`** |
| | `sealed` | `'gatekeeper'` | **`'forgeheart'`** |
| | `cost` | 620 | **36000 (proposed)**: about half Forgeheart's run, and the cheapest ring-5 notable price |
| `sentinel-drones` (`:241-244`) | `ring` | 3 | **4** |
| | `angle` | 116 | **119** (not 120, see 6.2) |
| | `links` | `['glaives']` | **`['arsenal-duration']`** |
| | `sealed` | `'bog-mother'` | **`'prism'`** |
| | `cost` | 1200 | **6000 (proposed)**: the bottom of the Prism-sealed ring-4 notables (6000–9000), about a third of the Prism's run |
| `arsenal-duration` (`:278-282`) | `links` | `['glaives']` | **`['sunlance']`** (Glaives leaves ring 3, and 112° sits next to Sunlance's 94°) |

`sunlance`, `mortar`, `arsenal-area` and `arsenal-duration-2` are unchanged.
The new chain is mortar (2) → sunlance (3) → arsenal-duration (4) →
sentinel-drones (4) → glaives (5). Every hop goes to the same ring or one
ring out.

Also update the file's header comment (`forge.ts:3-15`). After "P5 adds the
last four weapons …", add: "Sentinel Drones wait for the Prism (ring 4) and
Glaives for Forgeheart (ring 5), so a weapon still arrives after the Prism
(plans/forge-weapon-pacing.md step 6)."

**What else changes, by itself:**
- The "N Forge nodes unsealed" results line (`src/meta/results.ts:249`)
  counts each boss's seals. It reads one fewer for the Gatekeeper and the
  Bog Mother, and one more for the Prism and Forgeheart. No test asserts
  these counts (the full suite passed on the D-rev copy).
- `freshWeapons` / the debut (steps 2–4) need nothing new. A boss-sealed
  weapon keeps its own seal line until its boss falls (`sealLine`, step 3).
- The frontier profiles (`tools/fixtures/frontiers.json`) are taken at each
  boss's first fall, so they change. Regenerate them (6.6).

#### 6.4 Layout check

`ringRadius = 40 + 160·ring` (`src/ui/hub/forge.ts:23`), and a node's
radius is `RADIUS` at `:25` (notable 32, minor 26). Position is `angle` in
degrees clockwise from up (`position`, `:102`). These are the gaps between
node edges in D-rev:

| Node | Nearest | Edge gap |
|---|---|---|
| `sentinel-drones` r4@119 | `foreman` (r4@126) / `arsenal-duration` (r4@112) | ~19 / ~25 |
| `glaives` r5@124 | `arsenal-duration-2` (r5@114) / `foreman` | 88 / 98 |

No link line passes within 6 units of another node. Look at it in the hub
anyway. If the Drones–Foreman pair looks cramped, 118° gives 13 to Foreman
and 31 to `arsenal-duration`.

#### 6.5 Tests

- `tests/content.test.ts` runs the lint, and it passes with D-rev.
- On a copy with D-rev, `npx vitest run` passed every file, `tests/pacing.test.ts`
  (CI's first hour) included. The exceptions were `r6`, `r7` and `r9`, which
  read `android/` files that weren't in the copy. Expect the real tree to
  pass as is.
- `grep -n "glaives\|sentinel-drones" tests/*.ts` finds only sim-level uses
  (`only(run, …)`, `newWeapon(…)`, the Artificer's starting weapon) and
  Trial checks, none that buy through the Forge.
- Add one test to `tests/forge.test.ts` (`describe('Forge: fresh weapons')`):
  with the Bog Mother down and Mortar and Sunlance carried
  (`recipes.carried[id] = BALANCE.debut.runs`), `sentinel-drones` is
  `sealed` until `bossKills.prism` is set, then `open`. This pins the seal
  that D-rev moved.

#### 6.6 Build order

1. Make the node edits (6.3) and the header comment.
2. `npm run typecheck`, `npx vitest run tests/content.test.ts tests/forge.test.ts`.
3. `npm run pacing -- --frontiers`. It rewrites `tools/fixtures/frontiers.json`.
   Commit the new fixture with the change. The checked-in one predates
   steps 1–5, so regenerating also brings those in.
4. Take the gate readings (6.8), then `npm test`.
5. Check the web in the browser preview (6.4), then docs (step 7).

#### 6.7 Measured readings

Bot = cheapest-first, wf = `--weapons-first`. Medians over 8 profiles × 6 h
unless noted. I6 here is the first 2 h only.

| Reading | Steps 1–5 (today) | Original D | Glaives only, 36000 | **D-rev** |
|---|---|---|---|---|
| W1, bot / wf | 8/8 / 8/8 | 8/8 / 8/8 | 8/8 / 8/8 | **8/8 / 8/8** (least gap 6:55 / 6:42) |
| I6 first 2 h, bot | 7/8 (seed 4 10:05) | 7/8 (seed 1 11:23) | 8/8 | **8/8** (worst 7:33) |
| I6 first 2 h, wf | 7/8 (seed 3 13:25) | 8/8 | 8/8 | **8/8** (worst 8:30) |
| I3, bot / wf | 8/8 / 8/8 | 8/8 / 8/8 | 8/8 / 8/8 | **8/8 / 8/8** |
| Last weapon, bot / wf | 90:24 / 77:49 | 219:04 / 165:08 | 163:47 / 157:18 | **168:14 / 151:41** |
| Blight minus last weapon, bot / wf | 163:47 / 193:44 | 38:58 / 110:45 | 88:12 / 115:29 | **95:05 / 119:40** |
| Prism, bot | 78:01 | 78:01 | 78:01 | **78:01** (seeds 9–16: 74:15–94:44) |
| Prism, wf (seeds 1–8; 9–16) | 95:48; 83:34–109:46 | 85:21; 75:48–92:49 | 94:28; **87:08–152:07** | **88:16; 82:34–95:28** |
| Forgeheart / Hollow King / Blight, bot | 142:06 / 194:00 / 251:42 | 136:16 / 186:28 / 258:57 | 140:19 / 194:23 / 259:23 | **143:15 / 193:34 / 258:55** |
| Blight, wf | 277:42 | 278:12 | 276:07 | **268:14** |
| First evolution, bot / wf | 95:23 / 102:54 | **87:07** / 97:26 | 92:12 / 113:09 | **93:28 / 104:19** |
| I4 (`npm run arsenal`, fresh frontiers) | PASS, Sunlance 37% R3 | PASS, Sunlance 31% R5 | PASS, Sunlance 37% R3 | **PASS, Sunlance 37% R3** |

Not caused by step 6, and the same in every layout: weapons-first seeds 2
and 7 fail I1a (the Gatekeeper at 46:32 and 45:41), because that bot spends
on weapons first. R1 fails everywhere, as before this plan.

#### 6.8 Done when (gates, on the real tree)

- `npm run pacing -- --hours 6 --seeds 8`: W1 PASS, I6 (first 2 h) ≥ 7/8,
  I3 8/8, I1a and I1b PASS. The Blight's median stays within 10 min of 6.7's
  D-rev column.
- `npm run pacing -- --hours 6 --seeds 8 --weapons-first`: W1 PASS, and no
  Prism fall later than 110:00.
- For the per-seed weapon list, `npm run pacing -- --hours 6 --seed N`
  (the multi-seed report prints only the least gap). Expect Drones within
  ~2 min of the Prism and Glaives within ~2 min of Forgeheart in
  weapons-first runs.
- `npm run arsenal`: I4 PASS (after the frontier regeneration).
- R1 and P3 no worse than 6.7's first column.

**If the owner wants the bot's Drones nearer the Prism** (it buys them 23–29
min after the Prism falls, because ring 4 has cheaper nodes), lower Drones to
4000 and re-read the bot's I6 and W1. Not measured.

### Step 7: docs

Done with steps 1–5 (checked 2026-11-26): the "One weapon at a time"
paragraph in `docs/forge.md` (`:109`), the debut card in `docs/draft.md`
(`:29`), and W1 in `docs/balancing.md` ("One weapon at a time", `:878`).

Done with step 6 (2026-11-26):
- `docs/save.md`: `PROFILE_VERSION` is now 28 (it said 25, stale before this
  plan), and the ladder table has rungs 25→26, 26→27 and 27→28 (`forgedAt`).
- `docs/forge.md`: a sentence at the end of the "One weapon at a time"
  paragraph: Drones are the Prism's prize (ring 4), Glaives Forgeheart's
  (ring 5), and Velocity, Reach, Hive, Halo, Sky Hive and Gyre come with
  them. There was no weapon table in "Shape", so nothing else changed there.
- `docs/balancing.md`: a "Weapons past the Prism" section with the real
  tree's readings and the rejected layouts (the original D, Glaives alone).
- `src/content/forge.ts`: the header comment says where Drones and Glaives
  wait.

---

## 4. Decisions for the owner

| # | Decision | Proposed | Alternatives |
|---|---|---|---|
| D1 | What "seen it" means | carried in **3 runs** | 2 runs (faster); "reached level 3 in a run" (stronger, but a weak early weapon may never get there) |
| D2 | Escape hatch | **8 runs** after forging, or a Never list | none (a player who refuses the weapon is stuck); a "Skip" button on the locked card |
| D3 | Debut is forced in every draft until taken | **yes** | first draft only, like Twin Mount |
| D4 | Suggestion picks the debut when there is no Tactician list | **yes** | leave the scorer alone (idle players may wait out `maxRuns`) |
| D5 | Debut and cooling also in Act 2's Constellations (Moonblade etc.) | **no**, Forge only | the same rule on `STAR_WEB` |
| D6 | Step 6 at all | **yes, as D-rev** (Drones → Prism, Glaives → Forgeheart, Sunlance stays). Measured: every gate 8/8, last weapon ~2.6 h later | skip it (steps 1–5 already fix the complaint; no new Act 1 weapon after ~90 min). The original D and Glaives-only were measured and rejected (step 6.2) |
| D7 | Step 6 prices | **Drones 6000, Glaives 36000** (measured) | Drones 4000, if the bot should get them nearer the Prism (not measured) |

---

## 5. Readings

Baseline and "after A+B" for W1, 2 h, are from `docs/balancing.md`
("One weapon at a time"). The rest of "after A+B" and the D-rev column are from
2026-11-26: 6 h, 8 profiles, run one seed at a time; the D-rev column was
first measured on a scratch copy (step 6.7), then read again on the real
tree after the build; that reading is the column below.

| Reading | Baseline | After A+B | After D-rev (real tree) |
|---|---|---|---|
| W1, bot (8 seeds) | 0/8 (least gap 0:00–3:41) | 8/8 (least gap 6:55–9:16) | 8/8 (least gap 6:55–9:20) |
| W1, weapons-first (8 seeds) | 0/8 (every profile 0:00) | 8/8 (least gap 5:37–7:17) | 8/8 (least gap 6:42–8:13) |
| Weapon times, seed 1, bot | 9:45, 16:04, 39:39, 48:55, 67:57 ×2, 75:03 | 9:45, 17:59, 35:48, 49:01, 69:53, 80:50, 89:22 | 9:45, 17:59, 35:48, 49:01, 69:53, 100:43, 163:15 |
| Last weapon, median, bot / weapons-first | — | 90:24 / 77:49 | 168:14 / 151:41 |
| I3 (8 seeds) | PASS (seed 1) | 8/8 | 8/8 |
| I6, first 2 h, bot / weapons-first | 8/8 / 5/8 | 7/8 / 7/8 | 8/8 / 8/8 |
| I1a / I1b (8 seeds, bot) | PASS / PASS (seed 1) | 8/8 / 8/8 | 8/8 / 8/8 |
| Blight, median, bot (the tool's median) | — | 256:38 | 268:52 |
| R1 / P3 | FAIL / FAIL (seed 1, before this plan) | FAIL / P3 median 28:22 | FAIL everywhere / unchanged (wave 20 comes before any change) |
| I4 (`npm run arsenal`, fresh frontiers) | — | PASS, worst Sunlance 37% (R3) | PASS, worst Sunlance 37% (R3). It can't see Forge placement (step 6.2) |
