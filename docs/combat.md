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

`counters` on each weapon names the enemies it answers (§4.3); the scorer
reads it to favour a weapon that suits the region.

## Damage and armour

A hit rolls its crit on the `crit` stream (`critChance`, `critMult`),
then `damage.ts#mitigate` takes armour off: armour is a flat reduction
with a floor, so a hit always lands at least `BALANCE.damage.minFraction`
(15%) of itself. The same rule holds for enemies and the tower. On top of
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

## Frames and the ultimate

A frame is the tower's chassis: a starting weapon, a quirk (a behaviour)
and an ultimate. Act 1 has Arcanist (Nova), Bastion (Aegis), Stormcaller
(Tempest) and Artificer (Overclock); Act 2 adds Lamplighter (Daybreak) and
Gravekeeper (Eclipse).

The ultimate charges from kill XP (`BALANCE.ultimate.charge`, about 30–45
s of killing) and fires on the player's tap; each cast makes the next
charge 1.2× longer. A Nova landing during a boss slam's wind-up staggers
it. An Eclipse takes a share of what each body has left, so it strikes a
shared pool of HP once: a Chorus through one of its bodies, the Hollow
King's or the Hunger's court through the king alone. The Autocaster
([idle.md](idle.md)) casts on the same rule as the bot.
