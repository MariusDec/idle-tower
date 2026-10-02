# Feats

Code: `meta/feats.ts`, `ui/hub/feats.ts`. Data: `content/feats.ts`.

Feats are one finite list (§5.4): forty in Act 1, twenty more in Act 2.
Each points at something worth finding — a build, a region's answer, a
boss beaten a particular way — and each pays shards once.

## Life of a feat

1. **Hidden or visible.** `featVisible` shows a feat once its context
   exists. Four Act 1 feats are **secret**: "???" and a riddle until
   earned, and they surface (and count) only once Forgeheart has fallen,
   because their rewards are priced for Region 4. Act 2's surface once the
   Blight has fallen.
2. **Done.** `checkFeats` runs inside `bankRun` after every run and marks
   any feat whose condition the profile or the finished run meets
   (`featMet`); `featProgress` drives the progress bar of the ones still
   open.
3. **Claimed.** The player claims in the Feats tab (`claimFeat`, or
   `claimAll`); the shards land then, with a chime. The tab opens after
   the first boss, with the feats already earned waiting.

`profile.feats[id]` is `'done'` or `'claimed'`; a missing id is not yet
earned.

*Tinkerer* ("Four hands, no heart.") also earns the Artificer frame.

## Rules for new feats

- 15 words of text at most, effect first (R4); the content lint checks it.
- Point at something the player can *do*, not a number to grind.
- Price the reward for the region where it is likely to land, or gate it
  behind the boss that makes it fair (as the secret feats are).
