# The Forge and `buildRunConfig`

The Forge is the one meta tree (§5.1): a radial web of 124 nodes in five
branches, paid in shards. Code: `meta/web.ts` (the rules of any web),
`meta/forge.ts` (the Forge as one), `meta/runConfig.ts`,
`ui/hub/forge.ts` (pan, zoom, fog, the purchase ripple). Data:
`content/forge.ts`, `BALANCE.forge`.

## Shape

| Branch | Leans toward | Hangs from |
|---|---|---|
| Might | damage, crits, execute | the root |
| Bulwark | Max HP, regen, armour, Second Wind | the root |
| Fortune | shards, XP, relics, rerolls, card choices | the root |
| Arsenal | weapons, slots, Alchemy, evolution insight | Might |
| Engineering | automation: speed, auto-restart, the Tactician, offline | Fortune |

A fresh Forge shows three nodes (§7.1). Node types:

- **minor** (66): a stat step, several levels, costs ×1.7 a level
  (`BALANCE.forge.levelGrowth`);
- **notable** (49): one qualitative unlock (a weapon card, a slot, a
  behaviour, an automation);
- **keystone** (4): a build-defining trade, ring 3;
- **mastery** (5, Act 2): unlimited levels at +3% each, ×1.3 a level,
  the idle-forever sink (§9).

Rings 1–2 are open from the start; ring 3 is sealed until the Gatekeeper
falls (a few nodes until the Bog Mother), rings 4–6 by the Prism,
Forgeheart and the Hollow King. A few ring-4 nodes are unsealed so a player
stuck in Region 3 still has something to buy. Ring 5 costs ×2 and ring 6
×3 what ×4 a ring would give, so the Forge lasts to the finale.

## Rules (`meta/web.ts`)

Adjacency is undirected: a node touches every node it `links` to and every
node linking to it; a node with no links touches the always-owned root.

| State | Meaning |
|---|---|
| owned | bought at least once |
| open | touches an owned node: its effect and cost show |
| sealed | would be open, but waits on a boss (or, for a mastery, its Crown star) |
| fog | touches an open node: a "?" in its branch colour and type |
| hidden | not drawn |

Cost of the next level is `cost × growth^owned`. **Refunds:** notables and
keystones refund in full, between runs; minors and masteries never do, so
the web keeps its shape. `nextGoal` is the cheapest buyable node and how
close the player is to it: the results screen's and hub's "Next" line.

**Invariant (I3):** every Act 1 results screen shows an affordable node or
at least 50% progress toward one.

## `buildRunConfig`

`meta/runConfig.ts#buildRunConfig(profile)` turns everything owned — Forge
nodes, the frame, relics worn, Constellations, pacts — into one frozen
`RunConfig`, once per run. Each node's effects apply once per owned level,
through an exhaustive switch:

| Effect | Becomes |
|---|---|
| `stat` | a `StatMod` in `config.mods` |
| `unlockCard` | an id in the draft `pool` |
| `slot` | `weaponSlots` / `passiveSlots` |
| `behaviour` | a count in `config.behaviours`, read by the system that owns it |
| `automation` | nothing: it is the app's (`meta/automation.ts`) |
| `frame`, `mastery`, `relics`, `starlight` | nothing: the profile's (Constellations) |

The one automation that reaches the sim is the Tactician's list, as
`config.priority`.
