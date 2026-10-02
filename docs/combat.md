# Combat: weapons, damage, evolutions, the ultimate

Code: `sim/systems/combat.ts` (firing, projectiles, hits, kills),
`sim/systems/arms.ts` (a weapon's armed numbers), `sim/systems/damage.ts`
(armour), `sim/systems/ultimate.ts`, `sim/systems/tower.ts` (the tower
taking damage). Data: `content/weapons.ts`, `content/evolutions.ts`,
`content/frames.ts`, `BALANCE.caps`, `BALANCE.evolutions`.

## Weapons

Twelve weapons (Act 1's eight, Act 2's four from the Constellations), each
its own firing pattern. A weapon has five levels; each level step is a
visible change or at least +25% damage, and its `text` is the card line.

| Weapon | Pattern | Evolution (partner passive) |
|---|---|---|
| Arcane Bolt | `homing` | Seeker Swarm (Precision) |
| Scattershot | `cone` | Dragonbreath (Power) |
| Chain Lightning | `chain` | Storm Crown (Haste) |
| Frost Ring | `pulse` | Absolute Zero (Bulwark) |
| Mortar | `lob` | Meteorfall (Area) |
| Sunlance | `beam` | Judgment (Focus) |
| Glaives | `orbit` | Halo (Reach) |
| Sentinel Drones | `drone` | Hive (Insight) |
| Moonblade | `boomerang` | Crescent Storm (Velocity) |
| Rune Traps | `mine` | Bulwark Runes (Fortify) |
| Soul Tether | `tether` | Lifebloom (Mending) |
| Gilded Rail | `rail` | Midas Lance (Greed) |

`arms.ts#armed` turns a weapon's level into the numbers it fires with: its
level's base, its evolution's spike, and the tower's damage, attack speed,
area, duration, projectile speed and pierce stats. The sim fires these
numbers and the draft scorer estimates from them, so the two never
disagree about a weapon.

`counters` on each weapon names the enemies it answers (§4.3), and
`weakAgainst` the ones that blunt it (frontal shots into a Shieldbearer,
blades into Shardlings and Bombers); the scorer reads both to favour a
weapon that suits the region, and counts only a quarter of a weapon's
damage on a type it is weak against. Scattershot's pellets hit ×1.5 inside
a third of range (`pointBlank`, S5). The lint (`counters`) holds every region's
pool answered by at least one Act 1 weapon.

**Targeting doctrine** (U14): each weapon's `targeting` says whom it aims
at, read by `combat.ts#aim` through an exhaustive switch:

| Doctrine | Weapons | Aims at |
|---|---|---|
| `nearest` | most | the closest body |
| `densest` | Mortar | the body with the most others inside its blast |
| `toughest` | Sunlance | a plate, then a boss, then an elite, else the most HP in range; it holds its target until it falls or leaves range, but switches up to a tougher kind |
| `line` | Gilded Rail | the line from the tower through the most bodies; a second slug takes the line through the most it hasn't crossed |
| `standoff` | Sentinel Drones | bodies whose verb holds off at range (Spitter, Siege Engine, Summoner, Harbinger, Wardstone) on its leash first, else the nearest to the drone |

The scorer's rail constants are fitted to the line doctrine (`npm run
calibrate`).

A Harbinger never silences the tower's last firing weapon; against a lone
weapon (Specialist) its gaze halves that weapon's fire instead
(`WeaponState.dampedUntil`). Executioner sources stop at two (Executioner
or Executioner's Coin, plus Annihilator: 20%, `executeMax`).

## Damage and armour

A hit rolls its crit on the `crit` stream (`critChance`, `critMult`),
then `damage.ts#mitigate` takes armour off. Armour is a curve, not a cliff
(Q1, S2): a hit lands `hit / (hit + armour)` of itself, so a hit three
times the armour lands 75%, one equal to it half, and a small one never
quite nothing; `BALANCE.damage.minFraction` (5%) is only a backstop. The
same rule holds for enemies and the tower.

Every hit is credited (T1, `combat.ts#damageBy`): to the weapon whose
pattern dealt it (each weapon has its own pattern; the lint holds it), the
ultimate, Thorns, a burn, or a rule's extra (Overkill, a leap, a shatter).
`RunState.damageBy` sums what landed, short of overkill, and the `hit`
event carries `by`. `npm run inspect -- --by-weapon` prints the shares. On top of
that sit the region's rule (Brittle's area bonus), statuses (gilded,
frozen, slowed, burning) and behaviours from the Forge and relics
(Overkill's leap, Executioner below 10% HP, Thorns, Rampart's cap).

`tower.ts#hurtTower` is the single way the tower takes damage: contact
hits, Spitter shots, Shardling shards, Bomber blasts and boss shockwaves.

## Kills

`kill` is where a body's death pays out: XP (scaled by XP gain), shards,
ultimate charge, the Bestiary's kill count, a Splitter's fragments, an
elite's last word and possible relic drop, the region rule's on-kill
effect (Cinders, Echoes), Maws feeding nearby, and Gravekeeper's siphon.

## Caps (§12.5)

Weapons whose count scales have hard caps in `BALANCE.caps`: bolts 6,
blades 8, drones 8, crescents 6, runes 8, tethers 6, slugs 4. Anything
past a cap converts into damage, so a late build keeps its frame rate and
its strength.

## Evolutions

A weapon at `BALANCE.evolutions.evolveAt` (level 5) with its partner
passive owned is offered its evolution as a draft card, once Alchemy is
owned in the Forge (P5). Evolving keeps the weapon's slot, adds a damage
spike (`BALANCE.evolutions[id].damage`) and a new pattern feature (seekers,
burning ground, orbiting storms, a freeze and shatter, meteors…). Each
evolution found goes into the Recipe Book ([collection.md](collection.md)).
The Specialist keystone lets its one weapon evolve at level 3.

**Invariant:** an evolution card is offered if and only if its recipe is
satisfied (`tests/draft.test.ts`).

## Fusions (N9, Act 2)

Two evolved weapons, once a Smith star lights their fusion
(`content/fusions.ts`), are offered as one card. Taken, both are half of
the fusion (`WeaponState.fusion`): the second rides on the first's mount
(`joined`), which frees a slot, both hit `BALANCE.fusions.damage` (×1.25)
harder, and the pair works together in one way of its own, in
`combat.ts#fusionTaken` and `#fusionHit`:

| Fusion | Halves | Together |
|---|---|---|
| Blizzard | Storm Crown + Absolute Zero | lightning freezes what it strikes, and strikes frozen bodies ×2 |
| Firestorm | Meteorfall + Dragonbreath | shells and meteors set alight; burning bodies take ×1.5 from them |
| Dawnstar | Judgment + Seeker Swarm | bolts hit the beam's body ×1.75 |
| Sky Hive | Halo + Hive | a blade's kill calls a Hive drone |

Fusions found go on the Recipe Book's second page.

## Frames and the ultimate

A frame is the tower's chassis: a starting weapon, a quirk (a behaviour)
and an ultimate. Act 1 has Arcanist (Nova), Bastion (Aegis), Stormcaller
(Tempest) and Artificer (Overclock); Act 2 adds Lamplighter (Daybreak) and
Gravekeeper (Eclipse).

The ultimate charges from kill XP (`BALANCE.ultimate.charge`, about 30–45
s of killing) and fires on the player's tap; each cast makes the next
charge 1.2× longer. Nova and Tempest keep pace with the region (S3):
each hit is the starting weapon's multiple or a share of the body's Max HP
(`floor`: Nova 40%, Tempest 15%), whichever is more; a boss, a shade or a
plate takes only the hit. A Nova landing during a boss slam's wind-up
staggers it. An Eclipse takes a share of what each body has left, so it strikes a
shared pool of HP once: a Chorus through one of its bodies, the Hollow
King's or the Hunger's court through the king alone. The Autocaster
([idle.md](idle.md)) casts each ultimate on its own rule (U13), and the
idle bot on the same one.
