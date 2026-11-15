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
| Beacon Road | region (Mire) | 150 Sunlance kills in the Drowned Mire | Sunlance range ×1.25 there; 6,000 |
| Glassfrost | region (Wastes) | 40 frozen Shardlings slain in the Glass Wastes | a frozen Shardling's shards hit its kin; 8,000 |
| Bellows | region (Rift) | 200 Scattershot kills of burning bodies in the Ember Rift | pellets spread a burning body's fire; 10,000 |
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

**First readings** (`npm run inspect -- --seeds 10 --forge all --region R
--secrets`, every recipe known): Beacon Road found in 4/10 Mire runs, far
above the 2–8% target, so its `n` needs raising; Bellows stirred in 1/10 Rift
runs; Shatterfall, Glassfrost, both forms, Kintsugi and Wayward 0/10 (the bot
always carries Arcane Bolt, so the Lens never comes to it; Wayward is
active-only by design). Small samples on a maxed Forge: not a tuning.
