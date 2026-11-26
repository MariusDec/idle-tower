# Bosses

Code: `sim/systems/boss.ts`, the boss painter in
`render/painters/bosses.ts`, the HUD's boss bar. Data:
`content/bosses.ts`, `BALANCE.boss`.

## The fight

Wave 20 of each region is its boss (an Abyss floor's tenth wave is its
guardian, see [act2.md](act2.md)). `arriveBoss` places it at a flank; it
walks to its `standoff` and works from there. Its HP is a multiple of the
region's wave-20 HP (`def.hp`, about 25–35 s of the DPS expected there;
the Prism 50×, Forgeheart 40×, the Blight 70×), times Vigour and
Tyranny's loads under pacts.

A boss has 2–5 **phases**, each turning at an HP threshold (`below`) with
one line of text and one or two readable patterns:

| Pattern | What it does |
|---|---|
| `slam` | a telegraphed wind-up, then a shockwave rolling at the wall |
| `summon` | packs of a type, on a timer |
| `submerge` | sinks and rises elsewhere round its ring |
| `mirror` | facets that throw shots back at the tower |
| `pool` | burning ground |
| `court` | the Hollow King's shades, which carry a share of its HP |
| `peal` | always on: each toll rolls a ring at the wall (the Carillon) |
| `quicken` | the toll's interval shrinks on a timer (the Carillon) |
| `reverse` | the Orbit's spin flips on a timer (the Astrolabe) |
| `floes` | cracks Floes loose, once in a ring or on a timer (the Leviathan) |
| `weakpoint` | always on: a turning arc; hits while it faces the tower land ×3 (the Colossus) |
| `feast` | eats a nearby Titan and heals by its HP (the Colossus) |
| `bolt` | a wind-up, then a strike on the tower (the Thunderhead) |
| `tempest` | always on: the storm runs at double pace and each strike forks (the Thunderhead) |

Patterns fire on timers; a phase opens with its new pattern half-way
charged, so it never starts with a lull. A **Nova** landing during a slam's
wind-up staggers the boss and the slam is lost.

**Forgeheart's plates** (Q1, S2; `BossDef.plates`, `BossPhase.plates`):
two iron plates hang before the heart, between it and the tower. Each is a
body with 12% of the boss's HP and heavy armour, so big hits strip them;
while one stands the heart takes half of every hit (`plateGuard`). Phase 2
wears one plate, phase 3 none: the extra crack away. A phase Tyranny
replays hangs them anew. Plates ride on the boss (`placePlates`), never
walk or get shoved, pay nothing, and fall with it (`plateBreak`).

**The Wake's five** (plans/late-game/12 §7) are the Carillon (Bell
Marches, 90×), the Astrolabe (Orrery, 100×), the Leviathan Under the Ice
(Frozen Sea, 65×), the Sleeping Colossus (Giants' Rest, 78×) and the
Thunderhead (Stormcrown, 100×). Each uses its region's rule against the
tower, through the eight pattern kinds from `peal` down. The always-on ones
(`peal`, `weakpoint`, `tempest`) have `period` 0, like `mirror`. The
Thunderhead's first fall opens the Abyss. Each has a threat budget (D-27,
plans/late-game/12a): the Colossus slams every 6 / 5 / 4 s by phase (damage
5), the Astrolabe slams in phases 2–3, and the Carillon's peal does half
what it did. Tuned in `docs/balancing.md`, "The Wake: second tuning".

**The Astrolabe's rings** use Forgeheart's plates with `plates.orbit` set:
six small plates (6% HP each, guard 0.4) circle the boss at 0.9 rad/s
instead of hanging toward the tower. `placePlates` spaces them evenly.
Phase 3 drops them.

**Enrage.** A boss that outlasts its `enrageAfter` enrages: its slams hit
×1.25 harder every further 10 s, and it walks to the wall. A fight the
tower cannot win ends rather than stalls. `BossDef.enrageAfter` is
optional, `BALANCE.boss.enrageAfter` (90 s) when absent; only the Wake's
bosses set it: Carillon 150 s, Astrolabe 165, Leviathan 105, Colossus 90,
Thunderhead 105. The growth lands past Rampart's cap
([enemies-and-waves.md](enemies-and-waves.md), overtime).

**Tyranny** (a pact) gives each boss an extra phase (`phasesOf`).

## Presentation

The intro letterboxes the arena and names the boss (no letterbox under
reduced motion); each phase change shows its line, shakes the camera and
stops the arena for a 0.12 s hit-stop; the killing blow plays at 20% speed
for 0.9 s with a shatter and a shard fountain. The game never waits for any
of it: the boss walks in underneath its intro.

**Poses.** A boss is drawn live, so it moves through poses rather than
frames (`render/bossMotion.ts`, [render.md](render.md#motion)). Each has a
character (`BOSS_MOTION`): the Gatekeeper and Forgeheart stomp, the Bog
Mother (soft as jelly) and the Hunger lurch, the Prism and the Hollow King
glide, the Deepwarden grinds and shudders rather than squashes, the Blight
pulses on its heartbeat, the Undertow rolls with its crests.

| Pose | When | What it does | Reduced motion |
|---|---|---|---|
| arrive | `bossArrive` | drops in, lands with a squash, settles over two bounces | fades in place |
| walk | moving | footfall squash and bob by character; enraged, a faster cadence and a tremble | still |
| wind-up | a slam charging | crouches (squashes) and backs off from the tower, trembling more as it charges | the crouch only |
| release | `slam` | snaps to a stretch with a lunge at the tower, overshoots and settles; on `high`, an afterimage of the crouch | still |
| stagger | staggered | droops and sways, the stars over it | the droop only |
| phase | `bossPhase` | a shudder and a scale punch, over the shake | still |
| hit | hit | a 4% squish, at most every 0.25 s | — |
| sink, rise | `submerge`, `emerge` (Undertow) | flattens as it sinks, springs up as it rises | fades |

Forgeheart's lunge is the shortest: its plates are their own bodies and
don't follow the pose, so it presses into them without parting.

**Wind-up tells.** The part that charges shows the charge, at every tier
and under reduced motion (it is driven by the wind-up's progress, not an
oscillation, and it is what tells the player a slam is coming):

| Boss | Tell |
|---|---|
| Gatekeeper | the portcullis rises and slams down on release; the eye flares |
| Bog Mother | the eggs bulge |
| Prism | the inner rays stop turning and converge on the tower |
| Forgeheart | the grille's bars spread round a swelling, brightening heart |
| Hollow King | the hollows burn toward blood |
| Blight | the core burns toward blood |
| Deepwarden | the ward glyph brightens and its ring closes |
| Hunger | the mouth gapes before the bite |
| Undertow | the crests pull in |

On `high` and `medium`, the outer parts follow through (crown, thorns,
crests, merlons, and the Bog Mother's whole outline wobble a beat behind a
landing or a release), and the Gatekeeper, Hollow King, Undertow and Hunger
watch: their pupils drift toward the nearest shot, or the tower, and lock
on and narrow during a wind-up.

## After the fall

The boss's shards pay ×5 on the first kill. `bankRun` records kills and the
fastest kill (the Map's trophy), pays the first-kill relic, and on a first
fall sets `profile.ceremony`: the results screen leads to the Map, where
the light spreads to the next region (§7.3). With Frontier March owned the
next run marches on instead, and the ceremony waits for the player's next
visit to the Map. The Blight's first fall plays the Act 1 ending and opens
Act 2.

Overtime follows a boss: the region's template runs on with steeper HP and
richer shards until the tower falls.
