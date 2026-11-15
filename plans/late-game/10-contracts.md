# 10. The Contract board

**Status:** 2026-11-15. Steps 1–6 built (the grammar, the board, Act 1 from
Forgeheart and Act 2, milestones, the bots' policy); readings in
[docs/contracts.md](../../docs/contracts.md). Step 4's gate (the bar) is read
but not tuned. Deviations: the plan's slot bands are kept as pay clamps; a
full Boss Rush clear reads "Clear Boss Rush" and `untouched` reads "Reach
wave w unhurt", for R4; an overtime past the region's record gets +1 stretch.
Plan written 2026-11-14. Supersedes §1 of
[d-come-back.md](d-come-back.md) (the Contract board), and answers two of its
Open questions (Act 1, pinning). Idea 10 of the late-game review
([README](README.md)).

**In one line:** three generated goals on the hub, each one run played a
certain way, replaced the moment one is done, so there is always something
worth a session that only playing can earn.

---

## 1. The problem

- **The Next line runs dry.** `meta/goals.ts#hubGoal` (`goals.ts:26–56`)
  walks a finite list: a ready Forge node, the frontier's boss, a ready star,
  the closest feat, a relic not found. Feats are a fixed sixty
  (`content/feats.ts`), Trials a fixed eighteen (`content/trials.ts`), and
  records pay once (`meta/pacts.ts:80` `recordHeat`, `:89` `recordFloor`).
  Once those are spent, Act 2's line is the bare fallback "Clear the X at
  heat n+1" (`goals.ts:52–53`), with no progress bar and nothing new for
  doing it.
- **Act 1's late stretch has no reveals.** Hollow King → Blight has 0/8
  profiles inside a 30-minute reveal gap, with gaps of 44–115 min
  (`docs/balancing.md:376`). The 2026-11-02 reading puts the longest gap
  after hour 2 at 46–47 min (I6 wants ≤ 30).
- **Nothing rewards how you play.** Feats and Trials ask for one thing
  once. After that, a Region 3 run with one weapon pays the same as any other
  Region 3 run. The root cause in the README is that nothing is left that
  only playing can get you.

The board fixes this with a loop that never runs out. Each contract is
built from what `bankRun` already knows about a finished run.

## 2. What the player sees

**First encounter.** Forgeheart falls (Region 4, ~148 min for the active
bot, `docs/balancing.md:370`). The results screen lists **Contracts** under
what opened up (`results.ts#unlockList`). A **Contracts** button joins
Tactics and Pacts on the home view (`hub.ts:128–131`), and its explainer
opens the first time it is tapped.

**Explainer** (`content/explainers.ts`, id `contracts`, a new view
`contracts`):

> Three contracts wait here. Each asks for one run played a certain way,
> and pays when you manage it.
>
> Take one to start its run at once. Fail, and it stays. Finish it, and a
> new one takes its place.
>
> Rerolling is free. It changes what you do, not what you earn: harder asks
> pay more.

**The board on a phone** (375 px; a view like Pacts, no tab, since the dock
already holds six). It shows three stacked cards of ~120 px each, so it
fits 812 px tall at 100% text and scrolls at 130%:

```
 Contracts                                  12 done   ?
┌───────────────────────────────────────────────────────┐
│ ◆ QUICK  ●○○○                           ✦ 4 · 1.2M   │
│ Take no damage before wave 12 in the Drowned Mire.     │
│ [ Take ]                                     [↻] [⚑]  │
├───────────────────────────────────────────────────────┤
│ ◆ STEADY ●●○○                           ✦ 8 · 2.0M   │
│ Fell the Bog Mother at heat 5, Frost Ring and          │
│ Glaives only.                    Your heat: 5 ✓        │
│ [ Take ]                                     [↻] [⚑]  │
├───────────────────────────────────────────────────────┤
│ ◆ HARD   ●●●●                          ✦ 20 · 4.4M   │
│ Clear Abyss floor 11 as the Bastion, Rune Traps only.  │
│ + Mother's Tear rank III                               │
│ [ Take ]                                     [↻] [⚑]  │
└───────────────────────────────────────────────────────┘
```

- **Take** (primary, 44 px) starts that run at once, as a Trial's Begin does
  (`App.ts:162`). If the contract needs heat the player hasn't set, Take is
  disabled and the heat line turns into a **Pacts** link.
- **↻** rerolls that card for free. **⚑** pins it to the Next line (only one
  card can be pinned).
- In the run, a toast at the start says `Contract · <text>`, as a Trial's
  does (`App.ts:398–399`). The pause menu shows the contract's line under
  the build.
- **Results:** a met contract shows `Contract done · ✦ 8 · 2.0M`, the card
  that replaced it, and the milestone if one was reached. An unmet one shows
  `Contract not met: <why>` and a **Retry** button. The auto-restart
  countdown never retries a contract.
- **Next line:** see §4.6.

**Active-only.** The whole board. The only way into a contract run is a tap
on the hub or on Retry. The idle bot never opens the board, auto-restart
and Frontier March never start a contract, and offline time never completes
one. Inside a contract run the Autocaster and auto-draft work as usual: the
tap that starts the run is what makes it active (§4.7).

## 3. The grammar

A contract is **one target + up to two modifiers**. Two is the most that
keeps the text within 15 words (R4), and the lint proves it (§6). Every
target and condition is checked against the finished `RunState` inside
`bankRun`, the same way `featMet` checks feats (`meta/feats.ts:41`). Every
rule is an existing `TrialRule` (`content/types.ts:957`), so the run's
config enforces it and the draft never offers what the contract forbids.

### Targets (where, and how far)

| Target | Asks | Checked on the run | Open | Base |
|---|---|---|---|---|
| `boss` | fell a region's boss | `run.boss.id === b && killedIn !== null` | region's boss down | 1 (+1 if the latest region cleared, Act 1) |
| `wave` | reach wave w ≤ 20 in R | `run.wave >= w` | R unlocked | 0.5 |
| `overtime` | hold R to wave 20 + k, k ∈ {5, 10, 15} | `run.wave >= 20 + k` | k ≤ R's best overtime + 5 | 1 + k/5 |
| `run` | any run in R, for a tally condition | — | R unlocked | 0.5 |
| `floor` | clear Abyss floor n | `run.floors >= n` | Act 2, n ≤ best + 1 | 1 + stretch |
| `guardian` | fell an Abyss guardian again | `run.felled.includes(b)` | felled once before | 2 |
| `rush` | clear n Boss Rush stages, or all of them under t | `run.felled.length`, `outcome` | Boss Rush open | 1 + n/4, or 3 + time stretch |

The overtime cap of +15 is where the trophies stop, and floors never go past
the bottom: floor 30 with [08-abyss-strata.md](08-abyss-strata.md). The
Abyss has no bottom today, so until 08 lands floor contracts stop at 20,
*Bottomless*'s floor.
That keeps every contract an authored goal outside the endless curves (R7).
A `guardian` is today the Deepwarden or the Hunger. With 08 it is any of the
five: the Deepwarden (6), the Undertow (12), the Iris (18), the Unlit (24)
and the Hunger, the Act 2 finale (30). A contract never asks for a first
fall, of a guardian or a region's boss. That fall is the game's own goal and
ceremony, and it pays its own lump.

### Modifiers

| Modifier | Kind | Text | Checked on / applied by | Points |
|---|---|---|---|---|
| `heat` | condition | at heat h | `pactLoad(run.pacts).heat >= h` (player's own pacts) | h − best(R): −3 → 0, −2 → 0.5, −1 → 1, 0 → 1.5, +1 → 2.5 |
| `within` | condition | within t s | `boss.killedIn <= t` | t ÷ fastest: 1.4 → 0.5, 1.15 → 1, 1.0 → 2, 0.85 → 3 |
| `healthy` | condition | above p% HP | `boss.minHp >= p` | 50% → 1, 70% → 2 |
| `noUlt` | condition | without casting your ultimate | `run.ult.casts === 0` | 1 |
| `untouched` | condition | no damage before wave w | `run.firstHurtWave` | w/10 |
| `carry` | condition | W dealing half the damage | `damageBy[W] ≥ 0.5 × Σ damageBy` | 1.5 |
| `evolve` / `fuse` | condition | evolve W / make F, then … | `run.evolved` / `run.fused` | 1.5 |
| `slay` | condition | slay n E / n elites | `run.killsBy[E]` / `run.elitesKilled` | 1 |
| `frame` | rule | as the F | `TrialRule frame` | 1 (0 for the frame most used) |
| `weapons` | rule | W only / W and V only | `TrialRule weapons` | one 2, two 1, three 0.5 |
| `slots` | rule | one weapon slot / no passives | `TrialRule slots` | one slot 2, two 1, no passives 1.5 |
| `omen` | rule (Act 1) | while enemies move 30% faster | `TrialRule omen` | 0.5 × rank |

Heat applies only in Act 2 and only in the regions, where pacts hold
(`docs/act2.md`). `within` reads `profile.bosses[b].fastest`, which is kept
for any heat, so it pairs with `heat` only at h ≤ best(R) − 2. `carry`
counts `damageBy[W]` alone. Burn and the ultimate have their own keys
(`sim/state.ts:459`), so W's burn doesn't count toward W. Omens are Act 1's stand-in: they pay no heat record,
as with Trials (`results.ts:257–258`).

### Score, tier and slot

`score = target base + stretch + Σ modifier points`. The tiers are
**T1** ≤ 2.5, **T2** ≤ 4, **T3** ≤ 5.5, **T4** > 5.5. The board has three
fixed slots: **Quick** (T1–T2), **Steady** (T2–T3) and **Hard** (T3–T4). The
generator keeps redrawing until the score lands in the slot's band.
Stretch is always measured against the player's own records:
`bestHeat(R)`, `profile.bosses[b].fastest`, region best wave,
`abyss.best` and `rush`. The ask therefore grows with the player, and it is
capped by authored maxima: heat 33, overtime +15, the bottom floor.

**The score is read live.** Pay follows `tierOf(score(profile, c))` at the
moment of display and payout, never the score at generation. A contract
that has gone stale (the player has since broken the record it stretched)
pays less. The board itself never changes unasked.

## 4. The mechanic

### 4.1 Generation

```
generate(profile, slot):
  seq = profile.contracts.seq++
  rng = new Rng(hashString(`contract:${profile.createdAt}:${seq}`))
  repeat BALANCE.contracts.attempts (24) times:
    target = weighted(rng, open targets)        // BALANCE.contracts.weights
    where  = a region, the Abyss or Boss Rush the target allows
    mods   = 0–2 modifiers, drawn until score ∈ slot band
    c = { id: `c${seq}`, slot, target, where, mods }
    if valid(c) && !trivial(c) && !clash(board, c): return c
  return fallback(profile, slot)   // "Fell <last boss cleared>" at best heat, padded by rules
```

- **Determinism:** the seed comes from `profile.createdAt` (`profile.ts:14`)
  and the counter, through `core/rng.ts` (`hashString` `:23`, `Rng` `:46`).
  The board is **stored** on the profile as concrete specs, so a reload
  shows the same three cards and nothing is generated on load. This is meta
  RNG, outside `createRun`, so no sim stream moves.
- **Variety (`clash`):** no two cards share a target kind or a place.
- **Pick weights** (proposal): boss 3, floor 2, overtime 1.5, guardian 1,
  wave 1, run 1, rush 1. Modifiers are weighted evenly among those valid for
  the target.

### 4.2 Never impossible, never trivial

`valid(c)` rejects:
- a weapon, frame or fusion the player doesn't own (unlike Trials, whose
  weapons are authored, `runConfig.ts:107`);
- a `weapons` rule whose every weapon is `weakAgainst` a type the region's
  first four waves bring. This reuses `sim/run.ts#twinSpares` (`run.ts:39`),
  the check that cured Twin Mount's Region 3 wipes;
- a heat above `bestHeat(R) + 1`, a floor above `abyss.best + 1`, or a time
  below `BALANCE.contracts.minWithin` (20 s);
- `slay` of a type outside R's pool, or a count above the region's
  authored quarry (`content/contracts.ts#QUARRY`);
- `carry` or `evolve` for a weapon a `weapons` rule excludes.

`trivial(c)` rejects anything the player's own records already show done
with no modifier that binds (for example "Fell the Gatekeeper" alone, or
`within` at ≥ 1.4× the fastest kill). Every Quick card still carries one
modifier.

### 4.3 Rerolls

Rerolls are **free and unlimited**. A reroll keeps the slot's tier band and
its rider (§4.4) and changes only the target and modifiers. That makes
rerolling a choice of what to do, not a way to fish for pay: pay follows the
band, and the rider is fixed to the slot until that card is done. Each
reroll takes one `seq`, so the result is deterministic and testable.

### 4.4 Pay (no new currency, R2)

| | Act 1 (from Forgeheart) | Act 2 |
|---|---|---|
| Base | shards: `farmRate × minutes[tier]` | the same shards, plus Starlight `starlight[tier]` through `payStarlight` (Stargazers apply, `stars.ts:115`) |
| Rider (Hard slot only) | a named relic rank (owned, below its peak) | the same, or a sibling's (§7) |
| Milestones | 10 done: trim *Wax Seals*. 30 done: trim *Lanterns* | then every 10: a rank on a named relic |

Proposed `BALANCE.contracts`:

```ts
contracts: {
  opensAfter: 'forgeheart',        // the boss whose fall opens the board
  attempts: 24,
  bands: [[1, 2], [2, 3], [3, 4]], // Quick, Steady, Hard
  tiers: [2.5, 4, 5.5],            // score ceilings of T1–T3
  minutes: [6, 10, 15, 22],        // farm minutes paid, by tier
  starlight: [4, 8, 13, 20],       // Act 2, by tier, before the Stargazers
  minWithin: 20,
  milestones: { trims: [10, 30], relicEvery: 10 },
  weights: { boss: 3, floor: 2, overtime: 1.5, guardian: 1, wave: 1, run: 1, rush: 1 },
}
```

- `farmRate` (`offline.ts:19`) is read at payout. **Contract runs don't feed
  `recordFarm`** (`results.ts:205`). They often happen behind the frontier,
  and counting them would cut the next night's offline pay.
- **The bar** (from the outline): in `tools/act2.ts`, an hour of contracts
  earns **1.2–1.5×** the Starlight per hour of the bot's best alternative
  at the same state (heat, the Abyss or Boss Rush), plus **≥ 1
  contract-only reward per hour** (a rider or milestone). If no tuning of
  `minutes` and `starlight` reaches the bar, the board is cut and the time
  goes to plan 08.
- **Act 1's ceiling:** contract hours earn ≤ 1.5× frontier farm per hour,
  and I1b holds (§9).

Rough sizing: a contract run of ~15 min at the bot's expected success rate
(T1 85%, T2 65%, T3 45%, T4 30%) pays 3.4–6 Starlight an attempt on the
table above, so ~20–24 an hour before the run's own records. The baseline
is ~20 an hour before S7 (247 in 12 h,
`plans/post-rebuild-improvements.md:454`). The sky costs 896
(`tests/act2.test.ts:218–224`), so S7's 20–40 h to the last star means
22–45 an hour. The bar is within reach.
`act2.ts` decides the real numbers.

### 4.5 Taking, settling and retrying

- `takeContract(profile, slot)` sets `profile.contracts.taken = id` and
  `profile.region` to the contract's place, and clears `profile.trial`.
  `chooseTrial` likewise clears `taken`, since a run is one or the other.
- `buildRunConfig` folds the contract's rules the same way it folds a
  Trial's (`runConfig.ts:156`). It uses the refactor that
  [11-daily-omen.md](11-daily-omen.md) also needs:
  `trialRules(rules: readonly TrialRule[])` takes a list, and whichever plan
  lands first does it. Unlike Trials, contract rules also apply in the
  Abyss and Boss Rush, where today `pastRegions` turns Trials off
  (`runConfig.ts:35`). Omens never apply there. In the Abyss they stack with
  the stratum's rule (08 §4.6). A floor or guardian contract's Take also sets
  08's waypoint (`profile.abyss.start`) to the deepest open foot at or above
  the floor it names, so the run takes ~15 minutes, not ninety waves.
- The config stamps `contract: id` on the run, as `trial` is stamped
  (`sim/run.ts:83`), so a resumed snapshot settles the right card.
- `bankRun` calls `settleContract(profile, run)` after the Trial block
  (`results.ts:260–265`). Met: pay, `done++`, a milestone if one is due,
  and a fresh card in that slot. Either way `taken = null`, so the next run
  is ordinary (the Trial pattern, `results.ts:264`).
- A contract counts **only on the run it was taken for**. Ordinary runs
  never complete one, even when they happen to meet it.
- Failing costs nothing. The card stays and keeps its rider.

### 4.6 The Next line

`hubGoal` gains two steps and an action, so the card can open the board:

1. a ready Forge node (unchanged);
2. **the pinned contract** (new). It sits above the frontier's boss
   because pinning is the player's own choice;
3. the frontier's boss; in Act 2, a ready star (unchanged);
4. the closest feat (unchanged);
5. **the Quick card** (new), once the board is open;
6. a relic to find; the heat fallback; Forge progress (kept for before the
   board opens).

`HubGoal` gets `open?: HubView`. A contract line reads
`Contract: <text>` with progress `null`, and tapping it opens the board.
With the board open, steps 5 onward can't run dry, which is the outline's
promise.

### 4.7 I9 and hands-off play

The board's rewards are active-only by construction. A contract needs a hand
on Take or Retry, and `taken` clears at every bank, so auto-restart can't
chain contracts. Plan 01's "engaged" sampling is **not** required inside the
run (Open 2). A player who taps Take and then watches has still chosen and
started the run. The pay is tagged in 01's `RunSummary.activeOnly` with kind
`'contract'` (01 §9.1), so the hands-off bot's sum stays empty, and
`tools/idle.ts` also asserts `profile.contracts.done === 0`.

## 5. Content: examples

Pay is shown as farm minutes (Act 1) or Starlight (Act 2) for the tier.
Records are assumed where a number depends on them. The word count includes
the filled slots.

| # | When | Contract text (words) | Score → tier | Pays |
|---|---|---|---|---|
| 1 | Act 1 late | Take no damage before wave 12 in the Drowned Mire. (10) | 0.5 + 1.2 = 1.7 → T1 | 6 min |
| 2 | Act 1 late | Slay 250 Burrowers in one Glass Wastes run. (8) | 0.5 + 1 = 1.5 → T1 | 6 min |
| 3 | Act 1 late | Fell the Gatekeeper with Mortar only. (6) | 1 + 2 = 3 → T2 | 10 min |
| 4 | Act 1 late | Fell Forgeheart without casting your ultimate. (6) | 1 + 1 + 1 = 3 → T2 | 10 min |
| 5 | Act 1 late | Hold the Glass Wastes to wave 30 as the Bastion. (10) | 3 + 1 = 4 → T2 | 10 min |
| 6 | Act 1 late | Fell the Bog Mother within 40 s, no passives. (9) | 1 + 1 + 1.5 = 3.5 → T2 | 10 min |
| 7 | Act 1 late | Fell the Prism as the Stormcaller, Chain Lightning dealing half the damage. (12) | 1 + 1 + 1.5 = 3.5 → T2 | 10 min |
| 8 | Act 1 late | Evolve Sunlance, then fell Forgeheart with two weapon slots. (9) | 2 + 1.5 + 1 = 4.5 → T3 | 15 min |
| 9 | Act 1 late | Fell the Prism within 30 s while enemies move 30% faster. (11) | 1 + 3 + 1 = 5 → T3 | 15 min |
| 10 | Act 1 late | Fell Forgeheart above 70% HP with one weapon slot. (9) | 2 + 2 + 2 = 6 → T4 | 22 min + relic rank |
| 11 | Act 2 | Slay 40 elites in one Blight Heart run at heat 8. (11) | 0.5 + 1 + 0.5 = 2 → T1 | ✦ 4 |
| 12 | Act 2 | Clear Abyss floor 9 as the Lamplighter. (7) | 2 + 1 = 3 → T2 | ✦ 8 |
| 13 | Act 2 | Fell the Bog Mother at heat 5, Frost Ring and Glaives only. (12) | 1 + 1.5 + 1 = 3.5 → T2 | ✦ 8 |
| 14 | Act 2 | Fell the Deepwarden with no passives. (6) | 2 + 1.5 = 3.5 → T2 | ✦ 8 |
| 15 | Act 2 | Make Blizzard, then fell the Prism at heat 15. (9) | 1 + 1.5 + 1.5 = 4 → T2 | ✦ 8 |
| 16 | Act 2 | Fell the Hollow King at heat 10 within 50 s. (10) | 1 + 0.5 + 2 = 3.5 → T2 | ✦ 8 |
| 17 | Act 2 | Clear all eight Boss Rush stages in under 9 minutes. (10) | 3 + 2.5 = 5.5 → T3 | ✦ 13 |
| 18 | Act 2 | Fell the Blight at heat 10 with one weapon slot. (10) | 1 + 2.5 + 2 = 5.5 → T3 | ✦ 13 |
| 19 | Act 2 | Fell the Hunger above 70% HP, Moonblade dealing half the damage. (11) | 2 + 2 + 1.5 = 5.5 → T3 | ✦ 13 |
| 20 | Act 2 | Clear Abyss floor 11 as the Bastion, Rune Traps only. (9) | 3.5 + 1 + 2 = 6.5 → T4 | ✦ 20 + relic rank |
| 21 | Act 2 | Fell Forgeheart within 40 s with one weapon slot. (9) | 1 + 3 + 2 = 6 → T4 | ✦ 20 + relic rank |

Assumed records: #11 Blight Heart heat 10; #12 best floor 10; #13 Mire
heat 5; #15 Prism heat 15; #16 Hollow heat 12, fastest kill 50 s; #17 best
full clear 9:40; #18 Blight heat 9; #20 best floor 10; #21 fastest
Forgeheart kill 47 s. #14 and #19 need that guardian felled before; with 08
the Hunger is the floor-30 finale, so #19 opens only after the ending and
starts from the floor-25 waypoint.

Once the siblings land (§7), their rows join the grammar:

| # | Needs | Contract text (words) | Modifier · checked on |
|---|---|---|---|
| 22 | [02-rifts.md](02-rifts.md) | Take three Rifts, then fell the Prism at heat 8. (10) | `rifts` · `run.riftLog` entries with `choice !== null` |
| 23 | [04-anomaly-cards.md](04-anomaly-cards.md) | Take any anomaly, then fell the Bog Mother. (8) | `anomaly` · `run.anomaly.taken !== null` |
| 24 | [08-abyss-strata.md](08-abyss-strata.md) | Fell the Inversion's guardian as the Gravekeeper. (7) | `guardian` target, the Undertow · `run.felled` |
| 25 | [03-cursed-relics.md](03-cursed-relics.md) | Clear floor 14 wearing a cursed relic, no passives. (9) | `cursed` · the run's worn curses (config) |
| 26 | [03-cursed-relics.md](03-cursed-relics.md) | Claim three reliquaries in one descent. (6) | `reliquaries` · 03's claimed count on the run |
| 27 | [07-final-form.md](07-final-form.md) | Reach Final Form as the Artificer in the Ember Rift. (10) | `finalForm` · `run.form.wave !== null` |

**What ships first:** the seven targets and the twelve modifiers above, a
`QUARRY` table of two types per region, and the two milestone trims.
Contracts are generated, so there is no list of authored contracts to write.
The authored parts are the grammar, the text templates (one per target and
one fragment per modifier) and the fallback.

## 6. Data and code

| Layer | File | Change |
|---|---|---|
| content | `content/types.ts` | `ContractTarget`, `ContractMod` (closed unions; `TrialRule` reused inside `ContractMod`), `ContractRider`; `TrimId` += `'seals' \| 'lanterns'` |
| content | `content/contracts.ts` (new) | targets' weights and templates, modifier fragments, `QUARRY`, milestone trims |
| content | `content/balance.ts` | `BALANCE.contracts` (§4.4) |
| content | `content/explainers.ts` | `contracts` explainer; `ExplainerView` += `'contracts'` (`explainers.ts:11`) |
| content | `content/lint.ts` | every template × the longest fills ≤ `MAX_TEXT_WORDS` (`lint.ts:9`); `QUARRY` types in their region's pool; bands cover T1–T4 |
| meta | `meta/contracts.ts` (new) | `boardOpen`, `ensureBoard`, `generate`, `score`, `tierOf`, `valid`, `trivial`, `reroll`, `pin`, `takeContract`, `contractMet` (the exhaustive consumer of targets and modifiers), `settleContract`, `contractPay`, `contractText` |
| meta | `meta/profile.ts` | `contracts: { seq, board, pinned, taken, done }`; `PROFILE_VERSION` +1 |
| meta | `meta/save/migrate.ts` | step to the new version: an empty board, `seq: 0`, `done: 0` |
| meta | `meta/runConfig.ts` | `trialRules(list)` (shared with 11); the contract's rules, in the Abyss and Rush too; `contract` on the config |
| meta | `meta/results.ts` | `settleContract` after the Trial; `RunSummary.contract`; `activeOnly` += `'contract'`; skip `recordFarm` for contract runs; `unlockList` += "Contracts" |
| meta | `meta/goals.ts` | the pinned and Quick steps; `HubGoal.open` |
| meta | `meta/trials.ts` | `chooseTrial` clears `contracts.taken` |
| sim | `sim/state.ts`, `sim/run.ts` | `contract: string \| null` on `RunState`, stamped from config (`run.ts:83`); `SNAPSHOT_VERSION` +1, the next free (13 today, `save/index.ts:97`) |
| ui | `ui/hub/contracts.ts` (new) | the board view (§2) |
| ui | `ui/hub/hub.ts` | `HubView` += `'contracts'` (`hub.ts:25`); the button; the goal card is tappable |
| ui | `ui/results.ts` | the contract line, Retry |
| ui | `app/App.ts` | `contract(slot)` and `retry()` actions; the run-start toast |
| render | `render/painters/tower.ts` | two trims |
| tools | `pacing.ts`, `act2.ts`, `idle.ts` | §9 |

The sim is unchanged apart from carrying the id. Rules reach it through
`RunConfig` exactly as Trials' do, and no new random roll enters `sim/`.
The board's own RNG is meta-side and keyed on the profile.

**Tests** (`tests/contracts.test.ts`, new):
- same profile and `seq` give the same board; a save round-trip gives the
  same board; a reroll keeps the tier band and rider and moves `seq` by one;
- 10,000 boards over four fixture profiles (Forgeheart down, the Blight
  down, heat 10, floor 12): every card is `valid`, none `trivial`, every
  text ≤ 15 words, each slot inside its band;
- each owned weapon appears in 4–20% of `weapons` rules (no favourite,
  in I4's spirit);
- `contractMet` for each target and modifier against hand-built
  `RunState`s;
- a met contract on a run not taken for it doesn't pay; `taken` clears on
  every bank; a failed contract keeps its card and rider;
- `tests/save.test.ts`: the migration step; a snapshot of the old version
  is dropped, as any stale snapshot is today.

## 7. Interactions with sibling plans

- [01-stored-light.md](01-stored-light.md): contract pay is banked outside
  the run's shards, so the burn doesn't multiply it. Contract runs burn the
  gauge like any run. The pay joins `RunSummary.activeOnly` as `'contract'`.
  No Stored Light rider: a gauge top-up would make the board pay like a night
  away.
- [02-rifts.md](02-rifts.md): `rifts` counts `run.riftLog` entries taken.
  Its journal goals ("Find every Mire rift") span runs, so they stay 02's.
  A Rift's own choice is never constrained.
- [03-cursed-relics.md](03-cursed-relics.md): `cursed` and `reliquaries`
  (floor targets only, since curses are Abyss-only). Rider: one binding
  point on a named cursed relic, as a duplicate gives (03 §3.3).
- [04-anomaly-cards.md](04-anomaly-cards.md): `anomaly` opens once one is
  found. It is chance-gated, so it scores 2.5 and sits in the Hard slot. A
  `weapons` rule keeps the anomaly's weapon offered. Rider, if 04 agrees: one
  unfound anomaly joins the Book's Glimpsed list.
- [05-secrets.md](05-secrets.md): a contract never names an unfound secret.
  It may point at a found one ("Fell the Lens again"). Rider: one unheard
  whisper, as 02's *Whisper* Rift writes.
- [07-final-form.md](07-final-form.md): `finalForm` (`run.form.wave`), with
  a frame or "by wave w".
- [08-abyss-strata.md](08-abyss-strata.md): floor targets stop at 30 (20
  before 08), never the Below (R7). `guardian` names the five stratum
  guardians once felled, never a first fall. Take sets the waypoint (§4.5).
  Rules stack with the stratum's, and `valid` checks a `weapons` rule
  against the stratum's natives as it does a region's opening.
- [11-daily-omen.md](11-daily-omen.md): no contract points at the Omen
  (11 §7), and an Omen run never settles one. The two plans share the
  `trialRules` list refactor.

Each sibling row needs only an `open(profile)` predicate and a field
`contractMet` can read, so siblings join the grammar without touching the
generator.

## 8. Build steps

| Step | What | Size |
|---|---|---|
| 1 | `meta/contracts.ts` + `content/contracts.ts` + `BALANCE.contracts` + types + lint + the profile field and migration. Act 2 targets only (`boss`, `floor`, `guardian`, `rush`) with heat, rule and boss modifiers. Tests. No UI. | M |
| 2 | Run plumbing: `contract` on config and state, rules in the Abyss and Rush, `settleContract`, the results line and Retry, snapshot bump | M |
| 3 | The board view, the button, the explainer, the Next line, pinning. **Ships Act 2's board.** | M |
| 4 | `act2.ts` contract policy and the bar; `idle.ts` I9 assert. Tune `starlight` and `minutes`. **Gate: the bar holds, or cut.** | S |
| 5 | Act 1 from Forgeheart: `wave`, `overtime`, `run`, `untouched`, `slay`, `omen`; shard pay; the pacing bot's policy; I1b and I6 readings | M |
| 6 | Milestones: the two trims (painter) and relic ranks | S |
| 7+ | One sibling row at a time as plans 02–08 land | S each |

The whole plan is **L**. Steps 1–4 are the test of the idea.

## 9. Checks

- `npm test`: `tests/contracts.test.ts` and the save migration (§6).
- **The bar (step 4):** `npm run pacing -- --act2 --hours 12 --seeds 4`
  with the contract policy at 0%, 33% and 50% of runs. It reads Starlight per
  hour against the 0% line (want 1.2–1.5×), contract-only rewards per hour
  (want ≥ 1), success by tier (want ~85 / 65 / 45 / 30%), and the hour the
  last star is lit (S7 wants 20–40 h; contracts mustn't pull it under 20).
- **Act 1 (step 5):** `npm run pacing -- --hours 12 --seeds 8` with the
  active bot taking a contract every 4th run after Forgeheart (like
  `TRIAL_EVERY`, `pacing.ts:76`). **I1b** stays 7–12 h (the Blight is at
  ~482 min now, `balancing.md:373`; contracts must not push it under 420).
  **I6**'s 2–10 h clause: completions and milestones are reveals in the
  timeline, and the Hollow King → Blight gaps should shrink from 44–115 min.
- **I7:** `tools/idle.ts`, screen time to the Blight, active (with
  contracts) ÷ idle. The board should move it toward ≤ 0.7×.
- **I2 / I8:** `npm run pacing -- --idle --hours 12 --seeds 4` gives
  identical numbers before and after (the idle bot never touches the board).
- **I9:** the hands-off bot's summed `RunSummary.activeOnly` has no
  `'contract'` entry (01 §9.1), and `tools/idle.ts` asserts
  `contracts.done === 0` and no contract rider or trim on its profile.
- **I4:** `npm run arsenal` is unchanged (ordinary runs). The weapon-spread
  test in §6 covers the board.
- `npm run calibrate`: no change expected (no sim change).
- The board, the results line and the Next card at 375×812 and 430 px,
  at 100% and 130% text; `tests/touch-targets.test.ts` lists the new
  buttons.

## 10. Risks

- **Chores.** A board can feel like a to-do list. Mitigations: no timer, no
  streaks, failing costs nothing, free rerolls, and the bar's cut rule.
- **The bot's success isn't the player's.** The bot doesn't aim for `noUlt`
  or `untouched`, so it understates the easy asks and overstates nothing.
  Tune the bar on the bot, then sanity-check by hand on two profiles.
- **Act 1 pacing.** Shard pay from Forgeheart speeds the active bot. If I1b
  drops under 7 h, lower `minutes`, or set `opensAfter: 'blight'` (Open 1).
- **Generated text reads oddly.** Templates are few and the lint enumerates
  every fill. Review a dump of 200 boards before step 3 ships.
- **Stale cards.** The live score lowers their pay. The player rerolls for
  free; the board never rerolls itself.
- **Overlap with Trials and Feats.** Three goal systems on one hub. Trials
  stay authored and finite (and pay notables), Feats stay one-offs, and
  contracts are the endless, generated layer that pays farm time.
- **Profile version collisions.** Plans 01, 03, 04, 05, 07, 08 and 11 also
  bump `PROFILE_VERSION`. Take the next free rung at build time.

## 11. Open decisions

1. **Act 1 or Act 2 only?** *Default: open at Forgeheart's fall,* behind
   `BALANCE.contracts.opensAfter`, because the late Act 1 reveal gap is
   where the board helps most. Fall back to `'blight'` if I1b fails.
2. **Must a contract run be "engaged" (plan 01)?** *Default: no.* The tap
   on Take is the active part, and `taken` clears every bank.
3. **Reroll limits.** *Default: free and unlimited,* with the tier band and
   rider fixed to the slot. The alternative is one free reroll per slot per
   completion.
4. **Does a pinned contract outrank the frontier's boss on the Next line?**
   *Default: yes,* since the player chose it. Unpinned contracts sit below
   feats.
5. **Do contract runs feed the farm rate?** *Default: no,* so they don't cut
   offline pay.
6. **Milestones.** *Default:* two trims (10 and 30 done), then a named relic
   rank every 10. More trims only if the painter budget allows.
7. **Contracts in the Below or past +15 overtime?** *Default: never* (R7).
