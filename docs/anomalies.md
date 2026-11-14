# Anomalies

Plan: [plans/late-game/04-anomaly-cards.md](../plans/late-game/04-anomaly-cards.md).
About one run in nine, a card turns up that breaks a weapon's rule for the
rest of the run. It is never suggested and never taken for the player: a
timeout, Take-all, the Tactician and every bot pass it by (I9).

**Built:** phases P1–P4: the framework and Act 1's four (Whiteout, Gyre,
Lighthouse, Creeping Barrage), the Book's Anomalies section, the results
line, the explainer, two feats, the tools' I9 assert and offer counts.
P5 (Murmuration, Serpent Current, Cascade, Dive Swarm) and P6 (the Act 2
four) are not built; `ANOMALY_OF` is partial until then.

## Where it lives

| Layer | File | What |
|---|---|---|
| content | `content/anomalies.ts` | `ANOMALIES`, `ANOMALY_BY_ID`, `ANOMALY_OF` (partial) |
| content | `content/types.ts` | `AnomalyId`, `AnomalyDef { weapon, rule, steps? }`, feat goal `anomalies` |
| content | `content/balance.ts` | `BALANCE.anomalies`: the gate's rates, the wait, the timer floor, each one's numbers |
| content | `content/lint.ts` | `anomalies`: a real weapon, one a weapon, a rule line, step lines within R4. Names are `uniqueNames`'s |
| sim | `sim/run.ts` | The `anomaly` stream (a split: older seeds play as before) and the roll at `createRun` |
| sim | `sim/systems/draft.ts` | `anomalyEligible`, the offer at the end of the hand in `tickDraft` (after the suggestion), rerolls keep it, Take-all stops at a later hand with one, `applyCard`'s case; `evolutionCards` and Blood Price skip an anomalised weapon |
| sim | `sim/systems/combat.ts` | `tickAnomaly` (an exhaustive switch): `tickWhiteout`, `tickGyre`, `tickLighthouse`, `walkBarrage`; hits credited to the weapon's pattern (T1) |
| sim | `sim/systems/arms.ts` | `anomalySpike` in `armed`: the damage spike, as an evolution's |
| sim | `sim/suggest.ts` | `ruledOut` for every anomaly; `damageDps` branches, fitted by calibrate; `scoreCard('anomaly')`; the `fork` badge |
| meta | `meta/runConfig.ts` | `anomaliesOpen` (the first recipe), `anomalyChance`, `anomalyConfig` (null in Trials and Boss Rush) |
| meta | `meta/results.ts` | `recordAnomaly`: found, glimpsed, `dry`, `taken`; `RunSummary.anomaly`; `activeOnly` kind `'anomaly'` |
| meta | `meta/recipes.ts` | `anomalyBook`: only what was met, found first; never a total |
| ui | `ui/draft.ts` | The anomaly's own row above the hand, the first-time line, the long-press details, re-worded level lines |
| ui | `ui/hub/collection.ts`, `ui/results.ts`, `ui/build.ts` | The Book's section, "An anomaly came and went", the chip |
| render | `render/painters/arsenal.ts`, `render/renderer.ts` | The storm, the blades round their quarry, the wedge; the split signature; the take's flash |
| audio | `audio/cues.ts` | `anomalyOffer` (a detuned bell), `anomaly` (a reversed swell) |

## The rules

- **The gate:** the profile's first recipe. Until the first offer, every run
  holds one (it comes once a weapon reaches level 3). Then 5% a run, +1% per
  run that could have dealt one and didn't, capped at 25%, ×2 in the Abyss.
  Never in a Trial or Boss Rush.
- **Eligible:** a carried weapon at level 3+, not evolved, not half of a
  fusion, with an anomaly authored. The offer may wait 0–2 eligible drafts.
- **Once a run.** Picked or not, it's gone. A Blood Price forged hand deals
  one whenever none has been taken (plan 02 §7).
- **Never suggested.** It joins the hand after the hand is rolled and
  scored, at its end, so the `draft` stream and the suggestion are as they
  would be without it: a run that lets it go plays as one that had none.
- **The draft timer** is at least 10 s on a hand with one (the Tactician's
  6 s too).
- **Taken:** the weapon keeps its slot and levels to 5, but never evolves,
  so never fuses.

## The four, measured (`npm run calibrate`, the T2 crowd)

| Anomaly | L3 ÷ plain L3 (want 1.2–1.4) | L5 ÷ evolved L5 (want 0.9–1.15) |
|---|---|---|
| Whiteout | 1.25 | 1.03 |
| Gyre | 1.20 | 0.99 |
| Lighthouse | 1.20 | 0.90 |
| Creeping Barrage | 1.35 | 1.12 |

Changes from the plan's first numbers, found by measuring:

- **Gyre** circles 6 u past its quarry's edge (the plan's 30 put the blades
  out of reach of the body they circle), and widens by 0.3 of a level's
  wider orbit.
- **Lighthouse** cools over empty ground as fast as it heats (with only "a
  whole empty turn" it ran at full heat in any half-turn crowd), its spike is
  1.45, and level 4's sweep is 15% faster, not 30%.
- **Creeping Barrage**: each shell is a line, so level 4's second shell is a
  second line ("+1 walking line per salvo"), each blast 1.1 × the shell.
- **Icon:** Creeping Barrage wears `drum` (drumfire), already in the
  manifest, rather than a new fetch.
