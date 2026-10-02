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

**Enrage.** A boss that outlasts `BALANCE.boss.enrageAfter` (90 s) enrages:
its slams hit ×1.25 harder every further 10 s, and it walks to the wall.
A fight the tower cannot win ends rather than stalls.

**Tyranny** (a pact) gives each boss an extra phase (`phasesOf`).

## Presentation

The intro letterboxes the arena and names the boss (no letterbox under
reduced motion); each phase change shows its line, shakes the camera and
stops the arena for a 0.12 s hit-stop; the killing blow plays at 20% speed
for 0.9 s with a shatter and a shard fountain. The game never waits for any
of it: the boss walks in underneath its intro.

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
