# Secrets

Plan: [plans/late-game/05-secrets.md](../plans/late-game/05-secrets.md).
Combinations, boss forms and cosmetics that no star, shop or list reveals.
After Forgeheart falls, the sim tallies them as you play; at a quarter of a
tally's goal it stirs ("Something stirred", once a run) and writes a riddle
in the Recipe Book's **Margin**; at the goal it is found and works at once.
The margin never says how many there are.

**Built:** phases 1–5, Act 1's eight:

| Secret | Kind | Trigger | Reward |
|---|---|---|---|
| Shatterfall | resonance | 60 Mortar kills of frozen bodies, Frost Ring and Mortar carried | shells finish frozen bodies at ≤ 50% HP; 8,000 shards |
| Beacon Road | region (Mire) | 580 Sunlance kills in the Drowned Mire | Sunlance range ×1.25 there; 6,000 |
| Glassfrost | region (Wastes) | 40 frozen Shardlings slain in the Glass Wastes | a frozen Shardling's shards hit its kin; 8,000 |
| Bellows | region (Rift) | 55 Scattershot kills of burning bodies in the Ember Rift | pellets spread a burning body's fire; 10,000 |
| The Lens | Prism form | reach the Prism with no weapon its mirror turns | relic Lens Shard (ranks on repeat falls); 10,000 |
| The Banked Forge | Forgeheart form | reach Forgeheart with Absolute Zero | trim Rime; 12,000 |
| Kintsugi | trim | fell a boss after the tower fell below 5% | trim Kintsugi |
| The Wayward Banner | trim, active-only | fell a boss with ≥ 10 picks, none the suggestion | trim Wayward Banner |

"Beacon Road" is the plan's `lighthouse`, renamed: Lighthouse is an anomaly.

**Where:** `content/secrets.ts` (table), `sim/systems/secrets.ts` (tally,
stir, find, forms), hooks in `combat.ts#kill`/`hitBody`/`strike`/`lastWord`,
`boss.ts#arriveBoss`/`phasesOf`/`onBossKilled`, `draft.ts#pickCard`;
`meta/secrets.ts` (config, effects, banking, margin, Bestiary lines). Profile
v20 (`secrets`), `SNAPSHOT_VERSION` 17. The `secrets` lint fails on a secret's
name in any feat, star, trial, region or explainer text.

**Not built:** phase 6 (Act 2's six, including the two hidden fusions and the
`pierce` trigger), phase 7 (tuning each `n`), the `seek` bot policy and the
pacing tool counting finds as reveals.

**Readings** (`npm run inspect -- --seeds 60 --forge all --region R --secrets
--max 1500`, every recipe known; add `--uncapped` for each tally's raw spread):

| Secret | Raw spread per run (maxed Forge) | Goal | Stirred | Found | ring4 Forge |
|---|---|---|---|---|---|
| Beacon Road (Mire) | 21/60 runs carry Sunlance; p50 490, p90 597, max 673 | 580 (was 150: found 37.5%) | 35% | 6.7% | stirred 13%, found 0% |
| Bellows (Rift) | 60/60 runs; p50 21, p90 43, max 67 | 55 (was 200: never found) | 78% | 5.0% | stirred 63%, found 0% |

Both are inside the plan's targets (found 2–8%, stirred ≥ 25%) on the maxed
Forge. A ring4 Forge dies around wave 15 in the Rift, before its boss, so it
is weaker than anyone past Forgeheart: there they stir but are not found yet.
Shatterfall and Glassfrost need frozen bodies (Absolute Zero), which the bot
rarely evolves: 0–2% stir, unmeasured. Both forms, Kintsugi and Wayward stay at
0 for the bot (it always carries Arcane Bolt; Wayward is active-only by
design). The `seek` policy and the idle/pacing checks of §8 remain to run.
