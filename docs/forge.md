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
  (`BALANCE.forge.levelGrowth`). In rings 4–6 (Q1, S1) the damage, attack
  speed, Max HP, shard, XP and ultimate-charge minors are two levels of a
  true multiplier (×1.07–×1.12), level 1 at three times the old first
  level's price and level 2 ×3 again, so every late buy is a felt step;
  range, area and duration stay percentages (they show on the field);
- **notable** (49): one qualitative unlock (a weapon card, a slot, a
  behaviour, an automation);
- **keystone** (4): a build-defining trade, ring 3: Glass Cannon (damage
  ×1.8, Max HP and regen halved), Specialist (the starting weapon
  ×2.5 damage, all other damage ×0.75; no slot is lost), Hoarder (shards ×2, every enemy ×1.5
  HP: a personal heat, B2), Fortress. `npm run arsenal -- --keystones`
  sweeps each against none (T4);
- Q3 adds **Banish** (Fortune ring 2, 3 levels) and **Clean Slate**
  (ring 4, 2 levels, the Prism) for N1's charges, and the **Foreman**
  (Engineering ring 4, off Tactician II, the Bog Mother) for N7's
  wishlist ([idle.md](idle.md));
- **mastery** (5, Act 2): unlimited levels at ×1.03 each, compounding,
  ×1.2 the cost a level: the idle-forever sink (§9; S1: the Abyss is
  exponential, so its sink is too).

Rings 1–2 are open from the start; ring 3 is sealed until the Gatekeeper
falls (a few nodes until the Bog Mother), rings 4–6 by the Prism,
Forgeheart and the Hollow King. A few ring-4 nodes are unsealed so a player
stuck in Region 3 still has something to buy. Ring 5 costs ×2 and ring 6
×3 what ×4 a ring would give, so the Forge lasts to the finale.

**The tower's tier** (N2, `towerTier`): 1, plus one for every ring
completed in turn from the first, keystones and masteries aside. Each tier
adds a stage to the tower's sprite ([render.md](render.md)), in the hub and
in every run.

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

Cost of the next level is `cost × growth^owned`. A web may let nodes go
past their last level (`WebSpec.beyond`): the Constellations do, once
every star is lit (N10, **ascension**). A minor whose stat is a percentage
goes on at `BALANCE.ascend.cost` (×2) the curve's price, and each level
past its last multiplies the stat by `1 + share × pct` (share 0.5),
compounding (`Web#statMods`, which `buildRunConfig` and the totals line
read). **Refunds:** notables and
keystones refund in full, between runs; minors and masteries never do, so
the web keeps its shape. **Switching keystones off:** an owned keystone can be
switched off between runs, and on again, for free (`toggleKeystone`;
`profile.keystonesOff`). It stays owned, so adjacency, the tower's tier
and refunds are unchanged, but `activeNodes` leaves it out, so
`buildRunConfig` applies none of its effects and the Forge's totals line
doesn't count it. A refund clears the switch. In the web an off keystone is
hollow, dashed, struck through and tagged OFF; its card has an On/Off
control and previews the totals with it switched the other way. `nextGoal` is the cheapest buyable node and how
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

Twin Mount is read at `createRun`: a second weapon from the pool's spares,
on the run's `loadout` stream. The draw skips any spare weak against
(`weakAgainst`, B1) an enemy type the region's first
`behaviours.twinMountOpening` waves can bring (its pool, and types a beat
introduces), and of the rest takes one that counters such a type if any
does (`run.ts#twinSpares`, Q1). Every spare blocked: the plain draw. So
Region 3's shields never meet Arcane Bolt and Scattershot together.
