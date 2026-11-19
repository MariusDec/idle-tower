# Rifts

Plan: [plans/late-game/02-rifts.md](../plans/late-game/02-rifts.md). A tear
opens mid-wave; a watching player taps it before it closes and it makes an
authored offer. The Autocaster, the Tactician and the idle bot never open
one (I9).

## Where it lives

| Layer | File | What |
|---|---|---|
| content | `content/rifts.ts` | The 24 rifts (batch 1, and the regions' five held beats): rarity, where, a whisper (≤ 8 words), one or two choices (≤ 15 words) |
| content | `content/types.ts` | `RiftDef`, `RiftEffect` (the closed union), `RiftSpan` |
| content | `content/balance.ts` | `BALANCE.rifts`: rates, gap, caps, rarity weights, the window, the hurt floor |
| content | `content/lint.ts` | `rifts`: word counts, 1–2 choices, real regions, ≥ 2 rifts per region, no level or boss swing on a common, a held rift names one region and each region holds at most one |
| sim | `sim/systems/rifts.ts` | `tickRifts` (step 2b), `tapRift`, `chooseRift`, `riftLegal`, `applyRiftEffect` (the union's one consumer), `riftShardMult` |
| sim | `sim/stats.ts#runMods` | A taken rift's running `stat` effects on top of `run.mods`; `refreshStats`, the scorer and the build list read it |
| sim | `sim/systems/draft.ts` | `tickDraft` waits while a rift is chosen; `forgedOffer` (Blood Price) |
| meta | `meta/runConfig.ts#riftConfig` | Null before the Gatekeeper's first fall, in a Trial and in Boss Rush; `heldBeat` names the region's held rift owed (R2) |
| meta | `meta/results.ts#recordRifts` | The journal (`profile.rifts`), the First Tear's lesson, `activeOnly` kind `'rift'` |
| meta | `meta/collection.ts#riftJournal` | The Collection's Rifts page, grouped by region |
| app | `App#syncRift`, `simSpeed` | The chip and panel; the arena stops while choosing and runs at 1× while a rift waits for an engaged player |
| ui | `ui/claim.ts`, `ui/rift.ts`, `ui/hud.ts` | The canvas tap (44 px, never a pinch), the HUD chip, the offer panel |
| render | `render/painters/rift.ts` | The tear: its width is its timer; rarity is colour and shape |

## The roll

One roll at each eligible wave's start on the `rifts` stream:
`chance + ramp × (eligible waves since the last rift)`, times the config's
`rate`. Act 1: waves 4–19 and overtime, at least 4 waves apart, 2 a run (3
with overtime). Act 2 (a region run under heat): 0.15, 3 apart, 3 a run;
a heat-0 run past the Blight rolls at Act 1's rates. The Abyss: floor waves 2–9,
one a floor. Never on a boss wave. A profile that has never opened a rift
gets only the First Tear, at wave 4, with a 20 s window, until it opens one.

**Held beats (R2 §2–3).** Regions 2–6 each hold one rare back
(`where.held`): Sunken Shrine (Region 2, its 11th run), Glass Oracle (3,
3rd), Ashen Anvil (4, 12th), Hollow Choir (5, 8th), The Last Lantern (6,
9th). From that run on, `riftConfig.beat` names it and it is the run's
first rift, at the First Tear's wave with its 20 s window, until it has
been met once (glimpsed counts). Until then it is never drawn, and a config
that doesn't list it in `known` (the Daily Omen's, `inspect`'s) never
draws it. A plateau is more runs in one region, so the beat lands in the
middle of the region, where its waves have nothing new left to show. The
run numbers come from the 8-seed pacing reading (`plans/review-risks.md`
R2); the First Tear still comes first.

What a taken rift rolls (a horde's bodies, a crown's aura) draws on
`riftFx`. Both streams are `split`s, which leave the root as it is, so a
seed shows the same rifts whatever is taken, and a rift never tapped
changes nothing outside `rift`, `riftRoll`, `riftLog` and its streams
(`tests/rifts.test.ts` pins this).

## Spans

`{ waves: n }` covers the rest of the wave it was taken in and n more;
`'boss'` lasts until a boss falls; `'run'` to the end. `stat` effects are
true multipliers, kept in `run.riftHolds` and folded in by `runMods`, so
an Abyss floor's rule swap (which rebuilds `run.mods`) keeps them.

## Tools

- `npm run inspect -- --seeds 50 --region k --rifts`: rifts a run, the share
  of runs past wave 12 that saw one, boss-wave rifts (want 0), and taken
  legendaries' falls.
- `npm run pacing -- … --no-rifts`: any pacing report without rifts, for
  the comparisons in the plan's §8. The reveal timeline logs each rift's
  first meeting.
- The active bot (`tools/bot.ts#riftInput`) opens every rift and takes the
  first legal choice, leaving costly ones below 70% HP or before the boss.
  `play.ts` charges 3 wall seconds per tapped rift and runs the arena at
  1× while one waits. The idle bot never opens one: `tools/idle.ts` fails
  hard if it does.
