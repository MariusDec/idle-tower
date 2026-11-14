# D. Reasons to come back

**Status:** 2026-11-03. Outline, to be expanded. Ideas 10 (the Contract
board) and 11 (the Daily Omen) from the late-game review ([README](README.md)).
Best built last: both are worth more once plans B and C give them things to
point at.

**In one line:** a goal that never runs out, and one fresh, comparable run
a day.

---

## 1. The Contract board

Three generated goals sit on the hub. A finished contract is replaced by
a new one at once, **not on a timer**, so the hub's Next line
(`meta/goals.ts#hubGoal`) always has something to show.

### Only if it pays

Contracts are in only if their payout is worth an evening. Otherwise
they're chores and should be cut. So the plan starts with the bar:

> **The bar:** in `tools/act2.ts`, an hour spent on contracts earns
> **1.2–1.5×** the Starlight per hour of the bot's best alternative at the
> same state (pushing heat, the Abyss or Boss Rush), and at least one
> contract-only reward per hour that the player can't get any other way.
> If a tuning pass can't reach that, the board is cut and the time goes to
> plan C.

Below 1.2× nobody bothers. Above 1.5× contracts become the only thing worth
doing, and heat and the Abyss die.

### What a contract pays

| Reward | Why it's worth it |
|---|---|
| **Starlight**, scaled by the contract's difficulty score | the bar above; it still has a sink after the sky is lit (Ascension, docs/act2.md) |
| **Stored Light**, a full gauge (plan A) | turns the next session into a boosted one |
| **An anomaly's hint** (plan B): its weapon and a word of its name, so you know what to hunt | only contracts reveal them |
| **A cursed relic reroll** (plan C): roll one owned relic's boon size again | the only way to improve a relic without farming drops |
| **A trim** for the tower, on milestone contracts (every 10th) | cosmetics, the Trials' kind |

### What a contract asks

They're made from templates with slots, and each is checked for being
possible at the player's current unlocks:

- "Fell **{boss}** with **{weapon family}** only, at heat **{h}**"
- "Reach Abyss floor **{n}** with **{frame}**"
- "Clear **{region}**'s wave 20 in under **{t}** at heat **{h}**"
- "Reach Final Form with **{frame}**" (plan B)
- "Take **{n}** Rifts in one run" (plan B)
- "Fell **{stratum boss}** with a cursed relic worn" (plan C)

Each template has a **difficulty score** from its slots (heat, depth, time,
how narrow the restriction is). The payout follows the score, so rerolling
to an easy one doesn't pay more.

### Rules

- **Rerolls are free and unlimited.** The payout already follows difficulty,
  so a reroll is a choice of what to do, not an exploit.
- **Opens with Act 2.** Act 1's pacing is tuned (I1–I6) and its Next line
  works. Revisit it later for Region 4+ paying shards.
- **Generation is seeded** from the profile (a `contracts` counter), so the
  board is stable across reloads and testable.
- **Checking:** each template names the run facts it needs. `bankRun`
  already has the run's summary, so a contract is a predicate on it
  (`meta/contracts.ts`). Some predicates need a field the summary doesn't
  carry yet (weapons used, Rifts taken).
- **R4:** 15 words, with the slots filled in.

### Touches

`content/contracts.ts` (templates, scores), `meta/contracts.ts` (generate,
check, pay), `meta/profile.ts` (`contracts: { board, seq, done }`,
migration), `meta/results.ts` (summary fields), `meta/goals.ts` (Next
line), `ui/hub/contracts.ts`, `tools/act2.ts` (a contract-taking policy
and the bar's reading).

## 2. The Daily Omen

A run seeded by today's date, with random modifiers. Anyone playing on
the same day faces **the same waves**, so friends can compare scores while
the app stays offline. It's one active run a day.

### The run

- **Seed:** `omenSeed(localDate)`, a hash of `YYYY-MM-DD`. The day picks a
  region (or a stratum, plan C), a frame and 2–3 modifiers.
- **Modifiers** come from what exists, so there's little new content: Trial
  rules (`content/trials.ts`: slots, weapons, frame), pacts as omens, a
  higher Rift rate (plan B), stratum rules (plan C).
- **A fixed tower:** the Forge, stars and relics don't apply, and the start
  is fixed (like Boss Rush's level 16 with banked drafts). Scores are then
  comparable between a player with the whole sky lit and one who has just
  reached Act 2.
- **Endless on the day's region**, on the Abyss curve. The score is the wave
  you fall on, with time as the tiebreak.
- **Same waves for everyone:** `createRun` splits the seed into one stream
  per system (docs/sim.md), so the `waves` stream doesn't depend on picks.
  The draft stream does shift with picks. That's fine: the hand you're
  dealt is part of the skill.

### Rules

- **Opens with Act 2.** R6 forbids real-time gates in Act 1. This is a daily
  clock, so it lives only in Act 2.
- **The first attempt of the day counts.** You can retry as practice, but the
  card shows the first score.
- **No streaks, no penalties.** Missing a day costs nothing, and nothing
  stacks up to make you feel behind.
- **Reward:** modest Starlight for the day's first attempt, a little more
  by score band, and a trim for reaching a high band for the first time. It
  should be a reason to open the app, not an obligation.
- **Sharing:** a copyable line: `Omen 2026-11-03 · wave 47 · 6:12 ·
  <code>`. The code encodes the run's input log (inputs by tick), so a
  friend's game can **replay it to check it**, because the sim is
  deterministic. Replay checking can come later. The line alone is enough
  to start.
- **The clock:** local date, no network. Changing the device clock only
  fools the player, and only the first attempt of a date counts.

### Touches

`content/omens.ts` (the modifier pool, weights, what can combine),
`meta/omen.ts` (seed, config, score, reward), `meta/runConfig.ts` (the
fixed tower), `meta/profile.ts` (`omen: { date, first, best }`,
migration), `ui/hub/omen.ts` (the card, the share line),
`platform/` (clipboard), and later a replay checker, reusing the sim's
input-by-tick log.

## 3. Checks

- **Contracts:** the bar, read in `act2.ts` over 4 seeds. Board generation
  is stable for a profile (`tests/`), and no generated contract is
  impossible at its unlocks (a lint over many generated boards).
- **Omen:** the same date gives the same region, modifiers and waves on two
  profiles at different stages (`tests/`). The fixed tower ignores the Forge
  (equal configs). A day's run is ~10–20 minutes for a good player.
- Determinism: replaying an Omen's input log gives the same score.

## Open

- Should contracts span Act 1 at all, paying shards? They might help the
  mid-game reveal gap (46–47 min against the 30-min target).
- Should a contract be pinnable as the hub's Next line?
- Does the Omen get its own small leaderboard of your own past scores?
- Weekly Omen (longer, harder) as well, or is daily enough?
