# The Tower, after the rebuild — improvements

**Status:** proposal, 2026-10-01. Nothing here is built yet.

**Where this comes from:** a read of all of `src/`, `tools/` and `docs/` on
the `rebuild` branch (`a6c9c27`); a fresh profile played at 375×812 on the
dev server (first run, the Forge, Region 2, the hub's views, settings); and
the real sim, headless:

- `npm run pacing -- --hours 12 --seeds 4` (Act 1)
- `npm run arsenal` (I4)
- `npm run pacing -- --act2 --hours 12 --seeds 2` (P8's gate, never
  recorded before; see S7)
- `npm test` (367 pass) and `npm run typecheck` (clean)
- five scratch sweeps over the real sim that are not in the repo:
  - armour against each weapon's hit, per region
  - full runs per region with the next ring bought out
  - each keystone against no keystone
  - the ultimate's and a mastery's worth by region
  - the Starlight supply against the Constellations' cost

**How to read this:** §1 is the short version and the order of work. §2 is
bugs and data errors. §3 is balance. §4 is UX and quality of life. §5 is new
mechanics and content. §6 is code and tooling. §7 is the phased work order
and §8 the decisions that are the owner's to make.

Each item has an ID, what is wrong, the evidence (a `file:line` or a measured
number), the proposal, and how to check it. `plans/rebuild.md`'s rules R1–R8
and invariants I1–I6 still hold; every proposal says which ones it touches.

---

## 0. What already works (keep it)

These are the reasons to change things carefully:

- **The sim is the balance tool.** The sim is deterministic, and the pacing,
  arsenal and inspect tools play the real game. Every number in this plan
  came from that sim, and every proposal can be checked the same way.
- **The first ten minutes land.** The first kill comes inside 3 s, the first
  draft at about 15 s and the first death at about 2 min. The Forge opens
  on three nodes and the fog pulls you outward.
- **The draft never blocks.** The 15% slow motion and the timer work. The
  idle loop (auto-restart, the Tactician, the Autocaster, offline) is
  complete.
- **Content is data, and it is disciplined.** Effects are tagged unions with
  `never`-switches, lint covers the content, and there are no literal
  colours in `render/` or `ui/`.

---

## 1. Summary

### 1.1 The twelve changes that matter most

| ID | Change | Why | Size |
|---|---|---|---|
| B1 | Fill the weapons' `counters` for Regions 3–6 | From Region 3 on, the suggestion, the idle player and every bot ignore what the region needs | S |
| B2 | Give Hoarder a real cost | Shards ×1.9 with no measurable loss: it is free ×2 progression, and the pacing never sees it | S |
| B3 | Let the HUD work during a draft | Pause, speed, Autocaster and the ultimate can't be tapped while a draft is open | S |
| S1 | Split in-run and Forge stat buckets; masteries compound | Power L5 is +75% at the start and +12.7% at the end of Act 1; a mastery level is +0.45% | M |
| S2 | Replace the armour cliff | Forgeheart's phase 1 floors every Act 1 weapon at 15%; Region 1 Brutes floor almost everything by wave 15 | M |
| S3 | Scale the ultimates with the region | Nova kills 3 bodies in Region 1 and 5% of one in Regions 5–6 | S |
| S7 | Fix the Starlight economy and the Act 2 gate | P8's gate fails (heat 10 at the frontier: never, on the median). The Constellations cost 736, but every heat record plus the Abyss to floor 100 pays about 684 | M |
| U2 | One-tap opening drafts | At the cap, a run starts at level 10 and opens 9 drafts in a row before the action: about 54–90 s of every idle run | S |
| U3 | Show the build | Nothing on screen says which weapons and passives the tower holds, or at what level | S |
| U14 | Targeting doctrine per weapon | Sunlance locks onto whatever is nearest, so in a boss fight its heat goes on adds; nothing aims for its weapon's job | M |
| N1 | Build Banish (planned, never built) | It fixes clutter cards, *Tinkerer*, and lets the Tactician say "never" | S |
| N4 | Overtime Champions and trophies | Overtime dies after 3–7 waves and only pays shards; the last 7 h of Act 1 are thin on reveals | M |

### 1.2 Order of work

Q0 is bugs and data. Q1 is the core balance, retuned with the pacing tool.
Q2 is UX. Q3 is new mechanics. Q4 is Act 2's economy and its long tail. §7
has the gates.

---

## 2. Bugs and data errors

### B1. Act 1 weapons counter nothing past Region 2 (high)

- **What:** every Act 1 weapon's `counters` list names only Region 1–2
  enemies (`content/weapons.ts:23, 38, 53, 68, 83, 98, 113, 128`). None of
  them lists a Region 3–6 type: Shieldbearer, Burrower, Shardling, Bomber,
  Blinker, Siege Engine, Phantom, Leech, Summoner, Harbinger or Chorus.
  `suggest.ts:151` `counterShare` therefore returns 0 for every Act 1 weapon
  from Region 3 on. The suggested card, the timed-out pick, the Tactician's
  unlisted items, the pacing bot and `npm run arsenal` all draft blind to the
  region there.
- **Evidence:** the arsenal report puts Chain Lightning at 4% of Region 6's
  picks, though Chorus is the type §11.2 names it for. Drones sit at 4–13%,
  though §11.2 names them against Siege Engines and Phantoms.
- **Proposal:**
  1. Fill the lists from §11.2's "strong against" column and the enemy
     texts:

     | Weapon | Add to `counters` |
     |---|---|
     | Chain Lightning | chorus, imp |
     | Frost Ring | blinker, burrower, leech |
     | Mortar | shieldbearer, chorus, summoner |
     | Glaives | burrower, leech, imp |
     | Sentinel Drones | siege-engine, shieldbearer, phantom, harbinger, summoner |
     | Sunlance | harbinger, summoner (targets that stand still) |
     | Arcane Bolt | phantom, shardling (kills at range) |
     | Scattershot | blinker, imp, bomber (knockback keeps it off the wall) |

  2. Add a `weakAgainst` list as well: frontal projectiles against
     Shieldbearer, projectiles against the Prism's mirror, Glaives against
     Shardling and Bomber, which die at the wall. The scorer subtracts it.
  3. Add a lint rule, T3a, so this can't drift again.
- **Check:** `npm run arsenal` should show the pick shares moving per region.
  The I4 cap (40%) still holds. Re-read I1 and I2, because a better scorer
  makes the bots faster.

### B2. Hoarder costs nothing (high)

- **What:** Hoarder (`content/forge.ts:466`) gives shards ×2 for one fewer
  card per draft.
- **Evidence:** a keystone sweep: the active bot, the region's next ring
  bought out, 4 seeds each.

  | Region | Keystone | Median wave | Median shards | Boss kill (s) |
  |---|---|---|---|---|
  | 3 | none | 26 | 16,577 | 45, 22, 40, 35 |
  | 3 | Hoarder | 25 | 31,785 | 90, 16, 38, 36 |
  | 5 | none | 24 | 302,303 | 106, 111, 98, 117 |
  | 5 | Hoarder | 24 | 572,589 | 115, 114, 103, 105 |

  That is shards ×1.9 with no loss in waves or boss time. An idle player on
  auto-pick loses nothing at all.
- **Why it matters beyond balance:**
  - The pacing bot never buys keystones (`tools/shop.ts`), so I1 and I2
    describe a player who never takes the best node in the Forge.
  - A player who finds Hoarder at the Bog Mother (around 70 min) progresses
    about twice as fast as every number in `plans/rebuild.md`.
- **Proposal:** pick one of these (decision D-2):
  - (a) Shards ×1.6, two fewer cards, and no rerolls.
  - (b) Shards ×2, and the suggestion is fixed. The player can't pick, and
    the Tactician can't steer: "the hoard decides". That keeps it an idle
    keystone with a real draft cost.
  - (c) Shards ×2, and enemies ×1.5 HP: a personal heat.

  Whichever it is, buy keystones in the sweep tool (T4) and in one pacing
  variant.
- **Check:** the sweep should show Hoarder trading at least 15% of its
  shards back as lost waves or boss time.

### B3. The draft overlay swallows the HUD (high)

- **What:** `.draft` is `position: absolute; inset: 0; pointer-events: auto`
  (`styles/main.css:849`). While a draft is open, the pause button, the
  speed toggle, the Autocaster switch and the ultimate can't be tapped.
  Verified: `document.elementFromPoint` on the pause button returns `.draft`.
- **Why it matters:** drafts open every 15–40 s and stay open for 6–10 s, so
  the HUD is dead for a large share of a run. On Android only the back
  button pauses.
- **Proposal:** make `.draft` `pointer-events: none`, and give its title,
  card row and reroll button `pointer-events: auto`. Keep the HUD's top row
  and the ultimate above the scrim. On a phone, lift the card row just above
  the bottom HUD row, so the ultimate stays tappable during a draft (§4.4:
  it is "the only active button").
- **Check:** with a draft open, `elementFromPoint` on the pause button and
  on the ultimate returns them. Add a `touch-targets` test for this.

### B4. "Welcome back → Resume" un-pauses under the Settings sheet (medium)

- **What:** in a run, `welcomeBack` (`app/App.ts:230–233`) replaces whatever
  modal is up, which is the pause menu. Its Resume sets `paused = false`
  even while Settings is open. Verified: sim time advances with the
  Settings sheet still covering the arena, so the tower can fall unseen.
- **Proposal:** if Settings or the pause menu was open, Resume returns to
  the pause menu. The welcome-back card becomes a toast on top of it.
- **Check:** a `screens` test: hide, then show with Settings open → still
  paused.

### B5. Feats announced before the Feats tab exists (medium)

- **What:** the results screen lists every feat earned
  (`ui/results.ts:180`). The first run shows "Feat: First Light", "Feat:
  Unbroken" and "Feat: Fields Naturalist", but the tab only opens with the
  Gatekeeper, about 30 minutes later.
- **Why it matters:** it breaks R3 and spoils §5.4's "the tab opens on a
  batch of rewards".
- **Proposal:** show no feat chips until `hubUnlocks(profile).feats`. The
  chips stay in the summary for the burst.

### B6. NEW RECORD for waves is global (medium)

- **What:** `meta/results.ts:272` compares a run's wave with
  `records.bestWave`, across every region. The hub's "Best wave"
  (`ui/hub/hub.ts:257`) is global too.
- **Why it matters:** once Region 1's overtime reaches wave 25–27, no run in
  Regions 2–6 can show a wave record until it beats that number. The
  callout disappears exactly when each new region needs it. The per-region
  bests (`profile.regions`) already exist.
- **Proposal:**
  - Records per region, plus overtime as its own line ("Overtime +6, new
    best") and the deepest floor in the Abyss.
  - The hub shows the selected region's best.
  - The `wave` feats keep reading the global best.

### B7. The last Constellations, and *Firmament*, can't be reached (high, Act 2)

- **What:** lighting all 40 stars costs **736** Starlight
  (`STAR_WEB.spentOn` over `content/stars.ts`). The supply is:
  - every heat record in every region (heat 29 × the per-heat table
    `[1,1,2,2,3,4]`): **377**, or about 565 with both Stargazers, which
    themselves cost 24;
  - the Abyss, at `12 × log2(1 + floor)` (`content/abyss.ts:105`): **79** at
    floor 100 and **119** at floor 1,000.

  Lighting everything needs a best floor of around 700, and floor HP grows
  ×1.08 a wave. *Firmament* (`content/feats.ts:82`, 10M shards) can't be
  earned, and the last stars can't be lit.
- **Proposal:** see S7. Together it is one change to the Starlight economy.

### B8. *Tinkerer* surfaces long before it can be earned (low)

- **What:** the feat surfaces after Forgeheart (`content/feats.ts:53`) and
  needs four level-5 weapons with no passives (`meta/feats.ts:79`). Without
  the Artificer, which is its own reward, the fourth weapon slot is Fourth
  Mount (ring 6, sealed by the Hollow King, 810k shards) or the Blight's
  Heart of Light.
- **Also:** a draft can't be skipped, so a hand of three passive cards
  forces a passive and fails the run.
- **Proposal:**
  - Surface it after the Hollow King, or make it "three level-5 weapons, no
    passives" so it fits Region 4–5.
  - N1 (Banish) gives the player a way out of a passive-only hand.

### B9. Small rules that disagree with their text (low)

- **Drilled and Twin Mount:** Drilled says "new weapons join at level 2"
  (`content/forge.ts:273`). Twin Mount's weapon still joins at level 1
  (`sim/run.ts:41` against `sim/systems/draft.ts:170`). Whetstone has the
  same gap.
- **Annihilator stacks past its text:** it says "with Executioner, under
  20%" (`content/forge.ts:180`). The rule sums `executioner` counts
  (`sim/systems/combat.ts:1216`), so Executioner's Coin makes it 30%. Either
  cap it at the highest owned tier, or say so on the relic.
- **Windfall is flat:** the fallback card pays a flat 10 shards
  (`content/balance.ts:43`) in every region, where Region 6 kills pay 100×
  Region 1's. Pay `region.waveShards × wave`, through the shard multiplier.
- **Max-rank duplicates are wasted:** a duplicate relic at rank III shows
  "already at its peak" and is gone (`meta/collection.ts:124`). Convert it to
  shards (an elite's bounty ×5), or to set progress (N6).

### B10. A Harbinger can silence a Specialist's only weapon (low)

- **What:** `silence` (`sim/systems/enemies.ts:262`) picks any weapon that
  still fires, every 5 s, for 4 s. With Specialist's single slot, the tower
  is silent 80% of the time while a Harbinger lives. The Blight's last phase
  calls Harbingers.
- **Proposal:** never silence the last weapon still firing. With one weapon,
  silence halves its fire rate instead.

---

## 3. Balance

### S1. The stat model makes late purchases invisible (high)

- **What:** every stat resolves as `(base + Σadd) × (1 + Σpct) × Πmult`
  (`sim/stats.ts:38–50`). The Forge's minors, the passives drafted in a run,
  the Constellations' minors and the masteries all add into the same `pct`
  bucket, so each new `+15%` is divided by everything already owned.
- **Evidence** (the full Forge without keystones or masteries, measured
  through `resolveStats`):
  - Forge damage totals **×5.9**.
  - **Power L5** adds +75% on a fresh tower and **+12.7%** at the full
    Forge. One Power card late in Act 1 is about +2.5%.
  - A ring-5 damage minor level (40k shards) is **+3.75%**, a ring-6 one
    **+3.2%**. The rebuild's own rule is "every purchase has to be visible on
    the battlefield or be at least a 10% step" (§0).
  - A mastery level is **+0.45%** damage, for 1.5M ×1.3ⁿ shards. It is the
    Act 2 sink, and it can't be felt.
  - The test profile already on the dev server (every Forge node and star)
    shows the same thing: damage ×7.1 in all.
- **Why it matters most for the draft:** the draft is the core loop (D2).
  The later the region, the less a passive card does, so late drafts become
  "take the weapon level" by default.
- **Proposal:**
  1. **Buckets.** Give `StatMod` a `bucket: 'meta' | 'run'`. The resolver
     becomes `(base + Σadd) × (1 + Σpct_meta) × (1 + Σpct_run) × Πmult`.
     Passives write `run`; the Forge, stars, relics and frames write `meta`.
     Power L5 is then ×1.75 at every stage, and a Power card feels the same
     in Region 6 as in Region 1.
  2. **Late rings get fewer, bigger nodes.** In rings 4–6, replace
     `5 levels × +15%` minors with `2 levels × mult 1.12`, or fold them into
     notables, with costs re-spread. Each purchase is then at least the 10%
     step.
  3. **Masteries compound.** Use `mult: 1.03` a level, which `scaleMod`
     already turns into `1.03ⁿ`, and lower the cost growth to about ×1.2.
     The Abyss is exponential (HP ×1.08 a wave), so an exponential sink is
     the only kind that keeps pace.
- **Cost:** in-run power rises late, so Regions 4–6's `hpBase`, the bosses'
  multiples and the overtime growth need retuning with `npm run pacing` and
  `npm run inspect -- --forge ringN --region N`. This is the largest
  retune in the plan, which is why it goes in Q1, before any content.
- **Check:** I1, I2, I3, I5 and I6, the boss times, and a new assertion in
  `tests/`: "a Power level is worth at least +10% damage with the full Forge
  owned".

### S2. Armour is a cliff, not a curve (high)

- **What:** armour is a flat reduction with a 15% floor
  (`sim/systems/damage.ts:7`). Enemy armour is `waveHp × def.armor`, so it
  grows ×1.17 a wave, while a weapon's hit grows only with its levels. Every
  hit soon falls to the floor, and the rule "big hits beat many small ones"
  turns into "everything does 15%".
- **Evidence** (the same `armed` and `mitigate` numbers the sim uses):

  | Target | Armour | Share of an L5 hit that lands |
  |---|---|---|
  | Forgeheart, phase 1 (`content/bosses.ts:152`), ring-5 Forge, Power 5 | 229 | **15% for all 8 Act 1 weapons** (only crits get through) |
  | Brute, Region 1 wave 10, ring-2 Forge, L3 weapons | 14 | 25–79% |
  | Brute, wave 15 | 32 | Mortar 54%, Arcane Bolt 31%, the other 6 at 15% |
  | Brute, wave 19 | 59 | 15% for all 8 |

  Sunlance's `counters` names Brute, but its ticks are among the smallest
  hits in the game. The scorer's `weaponDps` (`sim/suggest.ts:67`) ignores
  armour completely, so it can't see any of this.
- **Proposal:**
  1. Use a smooth formula: `landed = hit × hit / (hit + armour)`. A big hit
     still wins (a hit 3× the armour lands 75%), a small one never drops to
     zero, and there is no cliff. Keep `minFraction` as a backstop.
  2. **Forgeheart's plates become things to break.** Each plate is a
     targetable body with a share of the boss's HP. While a plate stands,
     the heart takes half damage. That gives "Big hits, or burn it out" a
     visible verb: mortars and beams strip plates.
  3. Make `weaponDps` armour-aware: evaluate at the region's wave-weighted
     armour with the same formula.
- **Check:**
  - an `inspect` column for the share landed;
  - Forgeheart's first-kill time and kill spread in the pacing report;
  - the arsenal report: Mortar and Sunlance should rise in Region 4.

### S3. Ultimates don't scale with the region (medium)

- **What:** Nova and Tempest hit for the starting weapon's base damage ×
  their multiple × `damageMult` (`sim/systems/ultimate.ts:21, 112`). Enemy
  HP grows ×3–5 a region, but the ultimate doesn't.
- **Evidence:** Nova (Arcane Bolt L5, the region's next ring bought,
  Power 5) against a wave-15 body:

  | Region | 1 | 2 | 3 | 4 | 5 | 6 |
  |---|---|---|---|---|---|---|
  | Share of a body | 338% | 139% | 52% | 21% | 5% | 5% |

  By Region 5 the "only active button" (§4.4) is a knockback. Eclipse
  already scales, because it takes a share of current HP.
- **Proposal:** Nova deals `max(today's hit, X% of Max HP)` to non-bosses,
  with X around 40%, and today's hit to bosses. Tempest's strike and Daybreak
  scale the same way. Aegis and Overclock already scale. Keep the ×1.2 charge
  growth.
- **Check:** the pacing report's ultimate casts per run stay level; boss
  times barely move, because bosses are excluded.

### S4. Keystones are unmeasured, and one of them is free (medium)

- **What:** besides B2's Hoarder:
  - **Specialist** never killed the Prism in Region 3 (0 of 4). Its one
    slot is the frame's starting weapon, and the Prism reflects
    projectiles. In Region 5 it beats the baseline (70 s against 106 s).
  - **Glass Cannon** is worse in Region 5 (3 of 4 runs die at wave 20).
  - **Fortress** is roughly even.
- **Proposal:**
  - Specialist chooses its weapon at the first draft (the first new-weapon
    card it takes locks the slot), rather than being the frame's starting
    weapon.
  - Glass Cannon keeps half its regen instead of none.
  - Report every keystone in the tools (T4), so no keystone is a trap or a
    must-buy.

### S5. Weapon and passive spread: measure before tuning (medium)

- **What the arsenal report shows** (new-weapon picks across Regions 1–6):
  - Scattershot: 0–13%
  - Sentinel Drones: 4–13%
  - Mortar: 16–31%
  - Glaives: 13–25%
- **Two passives the scorer never takes:**
  - **Greed** (`content/passives.ts:66`): the bot picked it 0 times in 24
    runs (`GREED_VALUE`, `sim/suggest.ts:47`). Yet it is in the pool from
    Mortar on, cluttering hands.
  - **Velocity** only speeds projectiles in Act 1.
- **Caution:** these are the scorer's preferences, not measured power. The
  scorer's `weaponDps` is a hand estimate (`CONE_HIT_RATE`,
  `PULSE_BODIES_PER_100`…), so a low pick rate may be the estimate's bias
  rather than a weak weapon.
- **Proposal:**
  1. First measure it: T1 (damage by weapon) and T2 (calibrate the estimate
     against measured DPS).
  2. Then tune:
     - Scattershot gets point-blank damage (pellets hit harder inside a third
       of range), so it has a niche.
     - Drones target standoff enemies first (U14), so they fill theirs.
     - Greed becomes a farming card: shards, plus a +1% shard bonus a wave
       while held. Value it by expected run length. Or keep it out of Act 1
       until Gilded Rail.
     - Velocity gets +1 pierce at L3 and L5, so it does something on screen
       (R1).
- **Check:** I4, plus a new I4b: no weapon's measured DPS share at L5 is
  under half the median.

### S6. The back half of Act 1 is long and thin (medium)

- **Evidence** (pacing, 4 profiles):

  | Stretch | Median |
  |---|---|
  | Prism → Forgeheart | ~50 min |
  | Forgeheart → Hollow King | ~2.7 h |
  | Hollow King → Blight | ~4.7 h |

  The last two regions are about 70% of Act 1. Region 6 brings 2 new enemy
  types, 3 relics, and mostly +% minors in rings 5–6. `plans/rebuild.md`
  already lists "§7.2's 1–3 runs per boss doesn't hold late" as open.
- **Overtime ends fast.** With the region's next ring bought out, runs die
  at overtime +3 to +7 (waves 23–27) after 4.8–6.8 min. That is short of
  §7.2's "8–20 min for overtime farming runs", because overtime HP grows ×1.25
  a wave against shards ×1.12.
- **Early variance.** The first wave 20 came at 24:12–38:53 (median 31:44 on
  this 4-seed sample), so the P3 gate (15–30 min) fails on some samples.
- **Proposal:**
  - New things to find in Regions 5–6: N3 (region affixes), N4 (Champions
    and trophies), N5 (Trials), N6 (relic sets). Swap a third of the ring 5–6
    minors for qualitative notables (S1.2).
  - Soften overtime's HP growth (try ×1.2) and tune with `npm run inspect`
    until a farming run lasts about 8 min.
  - Smooth the early variance: the first 5 drafts of a run always include at
    least one weapon level.
- **Check:** extend I6 to 2–10 h at one reveal per 30 min (§7.2's second
  clause, which the tool doesn't check today). Overtime run length goes in
  the pacing table.

### S7. Act 2's economy runs out, and its gate fails (high, Act 2)

- **P8's gate, read for the first time**
  (`npm run pacing -- --act2 --hours 12 --seeds 2`, 12 h after the Blight):

  | | Seed 1 | Seed 2 |
  |---|---|---|
  | Heat 10 at the frontier | 10:57 | never (heat 6 at 10:49) |
  | Frontier heat 5 → 6 | 87 → 185 min | 130 → 649 min |
  | Best heat, Regions 4 / 5 / 6 | 27 / 23 / 10 | 28 / 23 / 6 |
  | Best Abyss floor (Abyss runs) | 4 (52) | 5 (44) |
  | Stars lit of 40 · Starlight earned | 26 · 247 | 25 · 235 |
  | Mastery levels | 43 | 41 |

  The verdict is **FAIL**: the median time to heat 10 at the frontier is
  "never", against a target of 3–12 h. What it shows:
  - **The frontier pays least, not most.** Regions 4 and 5 reached heat
    23–28, close to the maximum of 29, while the Blight Heart reached 6–10.
    Most Starlight came from records in easier regions, which turns §9's
    "the frontier pays most" upside down.
  - **There is a wall at heat 6 in the Blight Heart.** Under the bot's
    ladder, the sixth pact is Vigour, and one rank of it is ×1.5 HP at once.
    Seed 2 took 130 minutes to reach heat 5, then nearly nine more hours to
    reach heat 6.
  - **The Abyss stalls at the first Abyss boss.** After 44–52 Abyss runs the
    bot's best floor is 4–5, where the Deepwarden waits. The log curve paid
    about 30 Starlight there.
- **Other evidence:**
  - B7: Starlight is finite and short of the Constellations' cost.
  - The masteries can't be felt (S1). The bot bought 41–43 levels over
    12 h, about 8 per mastery. That adds +24% to each stat's pool, which is
    roughly +4% to the stat itself.
  - Act 2's twenty feats pay 50k–10M **shards**, but by then shards buy only
    masteries.
- **Proposal:**
  1. **The Abyss pays per floor, not on a log:** 2 Starlight per new floor,
     plus 10 every fifth floor (each Abyss boss). With star costs as they
     are, the last star lands between floor 30 (every region at heat 29)
     and floor 75 (about heat 15 on average).
  2. **Act 2 feats pay Starlight** (5–40) on top of their shards.
  3. **Starlight per heat level weights the heat, not the region:**
     `1 + floor(h / 5)` a level. Heat 29 then pays the same in every region,
     and the hard part is the high heat rather than the late region. Or
     scale earlier regions' pacts by the frontier, so a heat record there
     stays a challenge.
  4. **Grade the pacts by their weight.** Vigour's ×1.5 HP a rank is several
     times the load of a Scarcity or Haste rank. Make it ×1.25 a rank with
     more ranks, or let one Vigour rank count as 2 heat. Either removes the
     heat-6 wall.
  5. **Make the Abyss's first boss passable:** compounding masteries (S1.3),
     and the Abyss's floor-5 guardian at `bossHp` 0.25 rather than 0.35
     until the bot reaches floor 10 in about 12 h.
  6. Masteries compound (S1.3), so shards keep meaning something.
- **Check:** P8's gate passes on 4 seeds (heat 10 at the frontier in
  3–12 h), and is recorded in `docs/balancing.md`. New readings:
  - Starlight per Act 2 hour, split by region, with the frontier's share
    the largest;
  - the hour the last star is lit (want 20–40 h of Act 2);
  - the best Abyss floor at 12 h (want 10 or more);
  - mastery levels per hour.

### S8. Extra cards are worth little to auto-pick (low)

- **What:** Hoarder's −1 card costs the bot nothing (B2), yet Jackpot
  (+1 card) is the most expensive notable in Fortune at 1.08M. For an
  auto-picking player, extra cards do almost nothing.
- **Proposal:** make a bigger hand matter. N1's Banish works better with
  more cards. The Tactician gains "prefer a recipe step" (U7). Jackpot
  becomes "+1 card, and evolution cards no longer take a slot". Then
  re-measure.

---

## 4. UX and quality of life

### U1. Pause, speed and the ultimate during drafts

This is B3's fix: the HUD stays live during a draft.

### U2. One-tap opening drafts (high)

- **What:** the start level is
  `1 + 2 × (Head Start + Veteran + Crowned Start) + Seal ranks`
  (`sim/run.ts:36`), up to level 10. Each level banks a draft that waits 6 s
  (with the Tactician) or 10 s.
- **Observed:** with Head Start and the Seal, a run opens on three drafts
  back to back. At the cap it is 9 drafts, about 54–90 s of wall time at
  every run start. That is about 15% of a 6-minute idle run, spent before
  the first wave matters.
- **Proposal:**
  1. When `pendingDrafts > 1` at the start of a run, show an **Opening**
     screen: the same cards, one per banked level, with "Take all suggested"
     as the primary button.
  2. With the Tactician owned, opening drafts resolve at once unless the
     player taps the Opening screen to review it.
  3. Mid-run, two or more banked drafts show "Take suggested ×N".
- **Check:** I5 moves (idle gains), so re-read it. Add an idle-bot reading:
  seconds from run start to the first draft-free second.

### U3. Show the build (high)

- **What:** the HUD shows HP, wave, level, XP, shards and the ultimate
  (`ui/hud.ts`). Which weapons and passives the tower holds, at what level,
  and which weapon a Harbinger has silenced, is visible only on the tower
  sprite and the draft cards. Building toward an evolution relies on memory.
- **Proposal:**
  - A thin strip above the XP bar: one icon per weapon with level pips, a
    glow when evolved, a slashed ring while silenced, and one icon per
    passive.
  - The pause menu shows the full build, plus the tower's stats. The
    resolver already returns a breakdown per stat (`StatBreakdown`,
    `sim/stats.ts:30`).
  - It fits 375×812 at 28 px icons.

### U4. Badges on draft cards (medium)

Cards say nothing about how they fit the build. Add small badges, computed
by the scorer's terms that already exist:

- **Recipe:** "Completes Seeker Swarm" when the passive finishes a known
  recipe, or "Step to Storm Crown".
- **Counter:** "Strong here", from B1's `counters`.
- **Slot:** "Fills slot 3/4".

Keep each to a word or an icon (R4), with the details on long-press.

### U5. A results screen that teaches (medium)

Add three things, two of them behind a tap so the screen stays one screen
(§4.6):

- **Damage by weapon:** a bar per weapon. This needs T1.
- **What wore you down:** damage taken by source: contact, shots, slams,
  pools, blasts.
- **The build:** icons with levels.

This is how a player learns why a run failed. Today the screen has no
answer.

### U6. Records per region, on the hub and the Map

This is B6's fix.

### U7. Tactician: "never", and lists per region (medium)

- **What:** the Tactician is one ranked list across every card
  (`ui/hub/tactics.ts`), with one list per frame from Tactician II. It can't
  say "never take Greed", and it can't say "Frost Ring in the Mire, Mortar
  in the Wastes".
- **Proposal:**
  - Add a **Never** bucket below Not listed. Never items are banished
    automatically when N1 is owned, or ranked last without it.
  - Tactician II: one list per frame and region, falling back to the frame's
    list, then the shared one.
  - Optional toggle: "Recipes first", which ranks a known recipe's next step
    above the list.

### U8. Forge: framing, totals, and a wishlist (medium)

- **Framing:** on 375×812 the web opens with nodes clipped at both edges
  (seen on the first Forge visit). Add fit-to-visible on open, and a
  recentre button.
- **Totals:** the node card shows the step ("Damage +15%"), but not the
  total. Add "Might total: +60% → +75%". This matters even more after S1.
- **Wishlist:** see N7. Pin nodes, and the Forge buys them as shards
  arrive.

### U9. Hub shortcuts and relic presets (low)

- The hub's loadout line ("Arcanist · Ashen Fields", `ui/hub/hub.ts`) isn't
  tappable. Tapping it should open a quick picker for frame and region.
- Relic loadouts: save the worn set per region, and wear it on selecting the
  region. Changing relics now means Collection → Relics → tap each one.

### U10. A Map that helps you choose (low)

Each region card gets:

- the recent shards per minute there (the farm rate, by region);
- the best overtime;
- the relics still missing, with "elite waves 5, 9, 13…".

"Where should I farm?" is then answered on the card. Today it takes
remembering.

### U11. Camera framing on a phone (experiment)

- **What:** at 375×812, bodies draw about 12–16 px wide, and much of the
  screen is the long walk in from the spawn ring.
- **Try:** frame the range circle with about 20% margin, spawns just off
  screen, and zoom out for boss intros and the Abyss. Offer it as a setting
  if the playtest is split.
- **Check:** the P1 gate's "pleasant to watch", and `tower.bench()` at each
  tier.

### U12. Save export, import and backups (high for Android)

- **What:** the profile is one key, overwritten every 30 s. A failed parse
  is copied to `tower-profile-corrupt`, but a bad write or a bug that saves
  good-looking garbage isn't caught.
- **Why it matters on Android:** moving from the debug APK to a signed
  release needs an uninstall (different signatures), and that wipes the
  app's data. The README warns that updates need the same key, but there is
  no way to carry a profile across.
- **Proposal:**
  - **Export:** copy JSON to the clipboard, or share a file through
    Capacitor Filesystem.
  - **Import:** paste or pick a file, then run the migration ladder and
    `isProfile`.
  - **Rolling backups:** the last 3 profiles, kept at each run's end.

  All of it goes on the Settings page, between runs only, like reset.

### U13. A smarter Autocaster (medium)

- **What:** it casts at 8 bodies in range, or as soon as a boss stands
  (`sim/systems/ultimate.ts:130`). So:
  - Nova goes off on the boss's arrival and wastes the wind-up stagger
    (§4.3).
  - Aegis goes off before the first slam.
  - Eclipse doesn't wait for the biggest pool of HP.
- **Proposal:** a rule per ultimate, in `content/frames.ts` data:

  | Ultimate | Autocaster rule |
  |---|---|
  | Nova | During a slam wind-up, or 8 bodies in range |
  | Aegis | A ring within 0.6 s of the wall, or HP under 40% with 3+ in contact |
  | Eclipse | The HP in range is at least 6 bodies' worth, or a boss |
  | Tempest, Overclock, Daybreak | A boss, or a crowd |

  The idle bot uses the same rule (I5).

### U14. A targeting doctrine per weapon (medium)

- **What:** every weapon fires at the nearest body, except Mortar (the
  densest crowd). So:
  - **Sunlance** (`sim/systems/combat.ts:715–720`) takes the nearest body
    whenever it needs a target, and its heat resets each time. In a boss
    fight it spends its heat on adds at the wall and rarely locks onto the
    boss. Against a Phantom it loses its target at every fade.
  - **Gilded Rail** aims at the nearest body, not the line through the most.
  - **Drones** chase whatever is closest to them, rather than the ranged
    bodies they exist for.
- **Proposal:** a `targeting` field on each weapon:

  | Weapon | Targets |
  |---|---|
  | Sunlance | The highest HP in range, sticky (boss and elites first) |
  | Gilded Rail | The line through the most bodies |
  | Drones | Ranged and standoff verbs first: Spitter, Siege Engine, Harbinger, Summoner, Wardstone |
  | Bolts, Scattershot, Chain | Nearest (unchanged) |

  The scorer's counters follow the doctrine. It is data, consumed through a
  `never`-switch (R8). A per-weapon player override could come later in
  Tactics (R1: a new decision).
- **Check:** the arsenal report and boss times. The determinism test needs
  new hashes.

---

## 5. New mechanics and content

Every item names its verb (R1), where it appears in the reveal table (R3),
and its currency (R2: no new ones).

### N1. Banish (planned in §4.5 and §11.4, never built) (high)

- **Verb:** remove an item from this run's pool. Its card is replaced from
  the same stream.
- **Where:** a Fortune notable beside Reroll (ring 2, 1–3 charges), and a
  second level in ring 4.
- **UI:** an ✕ on each card, shown only while charges remain.
- **The Tactician's Never list** (U7) spends charges automatically.
- **Fixes:** Greed and Velocity clutter (S5), *Tinkerer* (B8), and makes
  extra cards worth more (S8).
- **Sim:** a `banished` list in `RunState`, an `applyInput({ banish })`, a
  determinism test, and `SNAPSHOT_VERSION`.

### N2. Tower tiers, and a hub tower that is yours (planned, never built) (medium)

- **What:** §5.1 ("completing a ring raises the tower sprite's tier") and
  §7.1 ("Tower sprite tier 2" at 15–20 min) were never built. `paintTower`
  takes no tier. The hub's backdrop tower is always Arcane Bolt L1
  (`render/renderer.ts:27, 431`), whatever the frame.
- **Proposal:**
  - Each completed Forge ring adds a visible stage: a stone course, a
    banner, a crown of light.
  - The hub draws the selected frame with its starting weapon at the
    tier's level.
  - It is the cheapest "Felt" reward there is, and it fills reveal gaps
    (I6).

### N3. Each region gets its own elite aura (medium)

- **What:** Regions 2–6 draw from the same five auras
  (`content/regions.ts:67, 96, 125, 154, 186`).
- **Proposal:** give each region one signature aura that replaces one
  generic aura there. Each reuses an existing verb:

  | Region | Aura | What it does |
  |---|---|---|
  | Drowned Mire | **Fog-caller** | While it lives, the Mist thickens: 10% less range again |
  | Glass Wastes | **Mirrored** | Deflects projectiles from every side, like a Shieldbearer all round |
  | Ember Rift | **Molten** | Leaves a pool at the wall where it dies |
  | The Hollow | **Wraith** | Phases like a Phantom |
  | Blight Heart | **Hungering** | Heals on nearby kills, like a Maw |

  Each pairs with a relic in N6.
- **Verb:** a new readable threat per region. It also feeds S6.

### N4. Overtime Champions and trophies (high)

- **What:** overtime pays only shards, ×1.12 a wave, and ends after 3–7
  waves (S6).
- **Proposal:**
  - Every 5th overtime wave brings a **Champion**: an elite in the region's
    boss colours. It has a guaranteed relic roll, and at rank III the roll
    turns into shards (B9).
  - Reaching overtime +5, +10 and +15 in a region earns a **trophy**: a
    mark on the Map card, a light on the hub tower, and one-time shards.
- **Verb:** a session goal past the boss (§7.4 order: after "a boss not yet
  killed"), and a reason to choose a farming build over a pushing one.
- **Where:** revealed by the region's first overtime wave 5, which falls in
  the dead stretch S6 measures.

### N5. Trials (medium–large)

- **What:** three authored challenge runs per region, opened by its boss.
  Each takes a fixed constraint, using effects that already exist:
  - one weapon pattern only;
  - no passives;
  - a given frame;
  - pact effects (Hordes, Haste) as Act 1 "omens".

  Each pays once: a relic rank, a hub-tower trim (N2), or a qualitative
  Forge notable that can only be earned there, such as "Chain Lightning
  also arcs to burrowed enemies".
- **Verb:** builds under constraints, and something new and authored in
  the 7-hour back half (S6).
- **Code:** reuse `FeatGoal`'s checks and `PactEffect`'s loads. A trial is a
  `RunConfig` override plus a goal.

### N6. Relic sets in Act 1, and something to do with duplicates (medium)

- **Set bonus:** wearing all three of a region's elite relics gives a bonus
  that leans on its verb. For example, the Mire set: "Splitter fragments die
  to any area hit". The Rift set: "Bombers slain at range drop a cinder that
  burns their pack".
- **Duplicates:** past rank III, a duplicate adds set progress or shards
  (B9).
- **Verb:** a loadout decision (which set to wear for which region),
  supported by U9's presets.

### N7. The Foreman: a Forge wishlist (medium)

- **What:** an Engineering notable, ring 3, sealed by the Gatekeeper. Pin up
  to 5 nodes. Between runs, and when offline shards land, the Forge buys the
  pinned nodes in order whenever they are affordable. The welcome-back card
  says what it bought.
- **Why:** the idle bot shops at every check-in. A real idle player's shards
  pile up unspent across auto-restarted runs. The Foreman makes the idle
  path as good as the bot's.
- **Check:** I2 (5–10 days) and I5.

### N8. Boss Rush (Act 2) (medium)

- **What:** the six Act 1 bosses back to back, sized like Abyss guardians,
  then the two Abyss bosses. The record is the time. New records pay
  Starlight on a curve.
- **Verb:** a skill test that reuses every boss pattern, and a second
  endless-ish mode that is shorter than the Abyss.
- **Where:** a Map card once the Deepwarden falls.

### N9. Weapon fusions (Act 2, large)

- **What:** two evolved weapons plus a Constellation star make a **fusion**
  card. It replaces both and frees a slot. For example, Storm Crown +
  Absolute Zero → *Blizzard*, frozen bodies chain the lightning.
- **Where:** a second page of the Recipe Book, with its own hints.
- **Why:** Act 2's discovery hook (pillar 3). Today the Act 2 content is
  mostly bigger numbers.
- **Size:** large: art and code per fusion. Start with 4.

### N10. A long tail that stays felt (Act 2)

First fix S7. Then measure the Act 2 tail with the bot. Two options:

- **Ascended minors:** Constellation minors past their max at ×2 cost, as
  `mult` steps.
- **"Rekindle":** D5's revisit trigger. Reset the Forge's minors for a
  permanent `mult` on shards and damage, keeping notables and keystones.

Prefer the first. It keeps D5's "no wipe".

---

## 6. Code and tooling

### T1. Damage attribution in the sim (needed for U5, S5 and T2)

- Add `source: WeaponId | 'ult' | 'thorns' | 'burn' | 'rule'` to the `hit`
  event (`sim/state.ts`).
- Add a `damageBy: Partial<Record<…, number>>` tally to `RunState`. Bump
  `SNAPSHOT_VERSION`.
- `kill` already knows its `DamageSource`, so threading the weapon id
  through `damageEnemy` is mechanical.
- New column: `npm run inspect -- --by-weapon`.

### T2. A scorer that knows armour, verbs, and its own accuracy

- `weaponDps` (`sim/suggest.ts:67`) is hand-tuned and blind to armour (S2),
  shields, mirrors and burrowing. Give it S2's armour formula and B1's
  counter and weakness lists.
- Calibrate it: a tool or test runs each weapon at L1, L3 and L5, evolved
  and not, against a fixed crowd in a sealed arena. It compares measured
  DPS (T1) with `weaponDps` and fails when the two drift more than 25% apart.
  Today the scorer and the sim can disagree with nothing noticing.

### T3. Lint additions (`content/lint.ts`)

- **a. Counters:** every enemy in a region's pool appears in the `counters`
  of at least one weapon the player can own by then. That would have caught
  B1.
- **b. Icon reuse:** a report of icons shared by unrelated entries. For
  example, `fangs-circle` is the Leech, the Maw, the Hunger and Maw Tooth;
  `lantern-flame` is Tallow Candle, Ember Ward, Night Watch II, the
  Lamplighter and First Lantern; `crystal-cluster` is the Shardling, Windfall
  and the shard counter. Also, Forgeheart uses `frostfire`.
- **c. Name collisions:**
  - "Overclock" is both the speed ×3 node and the Artificer's ultimate.
  - "Bulwark" is a branch, a passive, a mastery and *Bulwark Runes*.
  - "Haste" is a passive, an aura and a pact.
  - "Veteran" and "Veteran Arms" are two different nodes.
- **d. Stacking:** an effect whose `behaviour` is shared with a relic (for
  example `executioner`, `second-wind`, `drilled`) must say in its text how
  it stacks. See B9.

### T4. Tools

- **Keystone and relic sweeps:** `npm run arsenal -- --keystones` and
  `--relics`. These are the scratch sweeps from this review, made permanent.
- **More of the bot:** let it use rerolls, Banish (N1) and relic swaps.
- **Gates read 8 seeds:** the P3 reading swings 26:46 → 31:44 between 8 and
  4 seeds.
- **Record P8's gate** in `docs/balancing.md`: it fails today (S7).
- **The Act 2 bot runs 25 min** for 2 seeds. Make it shorter, for example
  by starting from saved post-Blight profiles rather than replaying Act 1,
  so the gate can run on 4–8 seeds.
- **I6 past two hours:** extend I6 to 2–10 h at one reveal per 30 min (S6).

### T5. Performance and allocation

- `automations(profile)` rebuilds a `Set` from every owned node:
  - every sim step, through `autoUlt` (`app/App.ts:385`), up to 180× a
    second at 3×;
  - every frame, through `runSpeed`.

  Memoise it on a profile revision counter.
- Targeting scans every body:
  - `nearestEnemy`, `firstAlong` and `nearestUnstruck` once per projectile
    per step;
  - `densest` is O(n²) per shell (`sim/systems/combat.ts:369`).

  Reuse the per-step `SpatialGrid` that separation already builds
  (`sim/systems/enemies.ts:15`). Check the result with `tests/perf.test.ts`
  and P1's still-open mid-range Android frame check.

### T6. Structure

- `sim/systems/combat.ts` is 1.4k lines with twelve patterns interleaved.
  Split it into one module per pattern behind a `PatternDef` registry, each
  module holding:
  - `fire`;
  - `tick`;
  - the scorer's `estimate`, beside the firing code, so the two can't drift
    (T2);
  - its targeting doctrine (U14).
- Boss patterns get the same treatment (`sim/systems/boss.ts`).
- Rename the colliding names (T3c) with GitNexus's `rename`, as `CLAUDE.md`
  requires.

### T7. Docs

Every Q phase updates `docs/` (one file per system) and `AGENTS.md`, and
records its tool readings in `docs/balancing.md`, as P0–P9 did.

---

## 7. Phases

Each phase ends playable, and none starts before the last one passes its
gate.

### Q0. Bugs and data (S)

- **Work:** B1, B3, B4, B5, B6, B9, B10, and T3a–d.
- **Gate:**
  - `npm test`, plus new tests for B3, B4 and B6.
  - `npm run arsenal` passes I4 with the new counters, and the Region 3–6
    shares move.
  - I1 is re-read, because a better scorer speeds the bots.

### Q1. Core balance (L)

- **Work:** S1 (buckets, late rings, compounding masteries), S2 (armour and
  Forgeheart's plates), S3 (ultimates), B2 and S4 (keystones, with T4's
  sweeps), T1 and T2 (attribution and calibration), then S5's tuning on
  measured numbers.
- **Gate:**
  - I1–I6 all pass on 8 seeds.
  - A Power level is worth at least +10% damage with the full Forge.
  - No keystone's sweep shows a gain without a cost, or a loss without a
    gain.
  - T2's calibration test passes.
  - Forgeheart's first kill median is within ±20% of today's.

### Q2. UX (M)

- **Work:** U2 (opening), U3 (build strip), U4 (badges), U5 (results), U7
  (Tactician), U8 (Forge), U12 (save export and backups), U13 (Autocaster),
  U14 (targeting).
- **Gate:**
  - Every screen is checked at 375×812 (D4).
  - I5 is re-read after U2 and U13.
  - Playtest #3 (still open from P7): five questions, over several days.

### Q3. New mechanics (L)

- **Work:** N1 (Banish), N2 (tower tiers), N4 (Champions and trophies), N7
  (Foreman), then N3 (affixes) and N6 (relic sets), then N5 (Trials).
- **Gate:**
  - I6 holds over 2–10 h, extended as in S6.
  - The Hollow King → Blight stretch keeps its time but holds a reveal every
    30 min.
  - The arsenal and keystone sweeps are re-read.

### Q4. Act 2's economy and tail (L)

- **Work:** S7 (Starlight per floor, feats paying Starlight, heat-weighted
  records, graded pacts, a passable first Abyss boss), B7, then N8 (Boss
  Rush), N10, and N9 (fusions) last.
- **Gate:**
  - P8's gate passes on 4 seeds: heat 10 at the frontier within 3–12 h.
  - The bot's best Abyss floor at 12 h is 10 or more.
  - The last star is lit in 20–40 h of Act 2 by the bot.
  - Mastery levels per hour stay level.
  - *Firmament* is reachable.

**Q0 and Q1 alone** fix every measured problem in the shipped game. Q2 is
what a player notices first. Q3 and Q4 are where new fun comes from.

---

## 8. Decisions for the owner

- **D-1, S1 (stat buckets):** a full retune of Regions 4–6 is the price.
  Accept it, or keep the single bucket and only enlarge the late-ring
  steps?
- **D-2, B2 (Hoarder):** option (a) ×1.6 with −2 cards and no rerolls, (b)
  the suggestion is fixed, or (c) a personal heat?
- **D-3, S2 (armour):** the smooth `hit²/(hit+armour)` formula everywhere,
  or keep the flat rule and give only Forgeheart breakable plates?
- **D-4, U11 (camera):** try the closer framing in the playtest, or leave
  it?
- **D-5, N5 vs N8 vs N9:** which of Trials, Boss Rush and fusions to build
  first, if only one.
- **D-6, S7 (Starlight):** per-floor Starlight in the Abyss, or cheaper
  stars?
- **D-7, S7 (pacts):** soften Vigour's rank to ×1.25, or count each Vigour
  rank as 2 heat?
