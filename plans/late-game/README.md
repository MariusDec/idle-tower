# Late game: screen time and the endgame

**Status:** 2026-11-25. Ten plans, one per idea. Built in whole or in
their first phases: 01, 02, 03, 04, 05, 07, 08, 10 and 11 (each plan's own
Status line says how far). 12 is built through step 6 but not tuned yet
(step 7, §14). Written 2026-11-14. The
2026-11-03 outlines A–D are kept for their history; each plan below says
which part of them it supersedes. They come from a review of the economy and a late-game
Abyss session, which found two problems with one cause: **after the
mid-game, nothing is left that only playing can get you.**

- Hands-off idle reaches the Blight with *less* screen time (~3.5 h) than
  the active bot (~5.2 h).
- Night Watch IV pays 3 h of farm time per night, which is 9× a 20-minute
  session.
- I5 caps the active bonus at 1.5×, so the balance targets lock this in.
- The Abyss adds nothing new past floor 10, opens on the Ashen Fields'
  template, and has no bottom.

## The plans

| Plan | Idea | Size | Supersedes |
|---|---|---|---|
| [01. Stored Light](01-stored-light.md) | Most offline pay becomes a charge that played waves burn fast; defines I7–I9 | M | A |
| [02. Rifts](02-rifts.md) | A tear opens mid-wave; tap it for an authored offer the Autocaster never takes | L | B §1 |
| [03. Cursed relics](03-cursed-relics.md) | Abyss relics with one boon and one curse, claimed by a tap | L | C §6 |
| [04. Anomaly cards](04-anomaly-cards.md) | A rare extra draft card that breaks one weapon's rule for the run | L | B §2 |
| [05. Secrets](05-secrets.md) | Combinations, boss forms and cosmetics found only by playing, never counted | L | new |
| [07. Final Form](07-final-form.md) | Two evolutions in a run and the tower takes its frame's Final Form | M | B §3 |
| [08. Abyss strata](08-abyss-strata.md) | Five authored strata, the Hunger at floor 30 as Act 2's ending, the Below after | L | C (not §6) |
| [10. Contracts](10-contracts.md) | Three generated goals on the hub, replaced the moment one is done | L | D §1 |
| [11. Daily Omen](11-daily-omen.md) | One date-seeded run a day, compared with friends by a short code, offline | M | D §2 |
| [12. The Wake](12-the-wake.md) | Five regions between the Blight and the Abyss (Toll, Orbit, Glide, Giants, Storm), with Trials and relics; the Thunderhead opens the Abyss. Built, tuned (first pass; pace and Omen readings open) | XL | new |

The outlines, for history: [A](a-stored-light.md), [B](b-moments.md),
[C](c-abyss-strata.md), [D](d-come-back.md).

## Order

1. **01 first.** It's the smallest, and it tests the main complaint
   directly. It also defines I7–I9, which every other plan is checked
   against: each adds value only an active player collects.
2. **08's first stratum** next, to test whether authored depth brings the
   curiosity back before committing to all of them. 03 follows the strata.
3. **02, 04, 07** after that, or alongside 08: they don't depend on the
   Abyss. 05 can start any time; its first secrets need nothing new.
4. **10 and 11 last.** Contracts are worth more once there are anomalies,
   strata and cursed relics to point at, and the Daily Omen reuses Trials
   plus whatever modifiers the others have added.

## Shared decisions (settle once, before 01 ships)

1. **The I5 ceiling.** How far can screen-on beat screen-off? The proposal
   is a band of 2–3× per *hour of screen time*, while idle play still
   finishes Act 1 inside I2's 5–10 days. See 01 §9.1.
2. **A real ending.** 08 makes floor 30 (the Hunger) the end of Act 2, with endless
   mode as the epilogue. That decides how the story text and Act 1's "something
   stirs below" are written.
3. **The art and music budget.** Strata are worth most with new enemies,
   palettes and music. Audio is all synthesised (`audio/music.ts`), so a new
   track is code, not assets. Rifts, contracts and the Omen need almost no
   art.
4. **The currency budget (R2).** None of these plans adds a currency.
   Stored Light is a charge on the profile, not something you spend in a shop.
   Contracts and the Omen pay in Shards, Starlight or one-off unlocks.

## Rules that apply to every plan

- `plans/rebuild.md` R1–R8 hold. The ones most at risk are **R2** (no fourth
  currency), **R4** (15 words on a card, relic or contract), **R6** (no
  real-time gates in Act 1: the Daily Omen is Act 2 only), and **R7** (no
  authored goal in an endless curve: strata end at a bottom).
- The sim stays deterministic (docs/sim.md): every new random roll gets its
  own stream from `createRun`'s split, so existing seeds don't shift.
- The Autocaster and the idle bot never take an active-only reward. That is
  the point of every plan, and `tools/idle.ts` must check it (I9).
- Every plan ends with a measurement in the existing tools (`pacing.ts`,
  `idle.ts`, `act2.ts`), not a feeling.
- **Save versions.** Plans name a `PROFILE_VERSION` / `SNAPSHOT_VERSION`
  bump with the numbers of 2026-11-14 (15 and 13). Each takes the next free
  rung when it is built, whatever its text says.

## Shared names

One owner each; the other plans use these rather than their own:

| Name | Owner | What it is |
|---|---|---|
| I7, I8, I9 | 01 §9.1 | screen time, idle still finishes Act 1, no active-only reward reaches the idle bot |
| `lastTouch`, `ACTIVE_INPUTS` | 01 | what counts as engaged play |
| `RunSummary.activeOnly` | 01 | tags an active-only reward (`'rift'`, `'reliquary'`, `'contract'`, …) for I9; 04's anomaly picks belong here too |
| `ui/claim.ts` and the HUD claim chip | 03 | tapping something in the arena (reliquaries, rifts) |
| `stratumOf`, `StratumId` | 08 | which stratum a floor is in |
| `trialRules(list)` | 11 | authored rules on a run (Trials, the Omen, contracts) |
