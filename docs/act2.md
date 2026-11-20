# Act 2: pacts, Starlight, the Constellations, the Abyss, Boss Rush

Act 2 opens when the Blight falls (`act2Open`). There is no wiping
prestige (D5): the player chooses their own difficulty instead, the
*Hades* model. Code: `meta/pacts.ts`, `meta/stars.ts`, `sim/pacts.ts`,
`sim/systems/waves.ts` (floors and stages), `ui/hub/pacts.ts`,
`ui/hub/forge.ts` (`StarsView`). Data: `content/pacts.ts`,
`content/stars.ts`, `content/abyss.ts`, `content/rush.ts`,
`content/fusions.ts`, `BALANCE.pacts`, `BALANCE.starlight`,
`BALANCE.abyss`, `BALANCE.rush`, `BALANCE.fusions`, `BALANCE.ascend`.

## Pacts and heat

Eight pacts, each with 3–9 ranks set between runs:

| Pact | One rank | Ranks |
|---|---|---|
| Hordes | +30% enemies | 5 |
| Vigour | enemies ×1.25 HP | 9 |
| Quickening | enemies 15% faster | 3 |
| Elites | +1 elite on every elite wave | 3 |
| Frailty | −15% Max HP | 4 |
| Scarcity | one fewer card a draft | 3 |
| Tyranny | bosses rise once more, +25% HP | 3 |
| Blight Surge | the region's rule turns harsher (`region.surge`) | 3 |

**Heat** is the sum of the ranks (33 at most). Shards rise × (1 + 0.1 ×
heat). Vigour is graded by its weight (S7, D-7): a rank of ×1.5 HP was
several times the load of a Scarcity or Haste rank, and made a wall at heat
6 in the Blight Heart; nine ranks of ×1.25 reach the same top.
`sim/pacts.ts#pactLoad` resolves a run's pacts into one load and is the
only consumer of `PactEffect`. Pacts hold only in the regions, not the
Abyss.

## Starlight

Act 2's currency (the third and last, §8.1). It comes from four places
(S7):

| Source | Pays |
|---|---|
| A region's boss felled at a new heat record | `1 + floor(h / 5)` for each heat level h the record passes, once, the same in every region (D-8: the hard part is the high heat, not the late region) (`heatStarlight`, `recordHeat`) |
| A new deepest Abyss floor | 2 for each floor it passes down to floor 30, 1 past it (`abyssStarlight`, `recordFloor`) |
| A stratum's guardian, first felled in order | its stratum's lump: 20, 25, 30, 35, 60 (`BALANCE.strata.starlight.lump`, `recordStratum`) |
| A Boss Rush record | 4 for each stage first cleared, and a full clear's time on a curve (`rushStarlight`, `recordRush`) |
| Act 2's feats | 5–40 each, on top of their shards, when claimed |

The Deep's Stargazer stars multiply every payout
(`starGifts(profile).starlight`). Every region at the top heat pays 792,
more than the whole sky costs (B7), so *Firmament* can be earned without
the Abyss; in practice the bot lights the last star from the three
together.

## The Constellations

A second web (`meta/web.ts`, like the Forge), forty-four nodes in five
figures, paid in Starlight, and nothing refunds:

| Figure | Holds |
|---|---|
| The Smith | Act 2's four weapons and two passives, the fifth weapon slot, the four fusions (N9, [combat.md](combat.md)) |
| The Warden | the Lamplighter and Gravekeeper frames, the walls |
| The Lantern | the Abyss's four relic sets, a sixth relic slot |
| The Crown | the Forge's five masteries |
| The Deep | the descent, and the Stargazers: more Starlight per payout |

Every figure has a node on the root, so the sky opens five ways at once.
Stat, card, slot and behaviour effects reach runs through
`buildRunConfig`; frames, masteries, relic sets, the relic slot and
Starlight's worth are the profile's, read by `starGifts`.

**Ascension** (N10): once every star is lit, the minors whose stat is a
percentage go on past their last level, at twice the curve's price, each
level a compounding multiplier of half a level's percentage (Starforged's
+20% damage ascends at ×1.10 a level). It is the long tail, and nothing is
wiped (D5) ([forge.md](forge.md)).

## The Abyss

Region index 7: the only endless mode, and the only place big numbers live.

- **Strata** ([plans/late-game/08](../plans/late-game/08-abyss-strata.md),
  `content/strata.ts`): six floors each, with its own rule, natives, two
  Act 1 guests a floor, ground, rim and music. Built: I, **the Gate**
  (floors 1–6; *Gates*: waves come only through the floor's gates; the
  Lurker; the Deepwarden) and II, **the Inversion** (7–12; some walkers
  start at the wall and walk out, and one that escapes drains the
  ultimate; the Tidecaller; the Undertow). The rules fold in
  `sim/strata.ts#ruleLoad`, with a guardian phase's `rule` pattern.
- Each **floor** is ten waves. Floors 1–5 of a stratum end on a **Keeper**:
  a Champion of a native whose wave holds the next floor until it falls,
  or 45 s after its spawns (`BALANCE.strata.keeper`). Floor 6 ends on the
  stratum's guardian at `bossHp` × its last wave's HP.
- **Past the strata** (floor 13 on, until III–V are built) the old cycle
  holds behind a shim: an Act 1 region's template and rule, the old four
  natives, a boss every floor (× 0.35) and the Deepwarden or the Hunger
  every fifth (× 0.25). The Map's shaft says so (R3,
  `content/strata.ts#strataStillDug`): below the last built stratum a
  sealed band reads *The deep goes on. Strata III–V are still being dug.*,
  and once its guardian falls, the Deeper band's line carries the same
  sentence. The text follows `STRATA.length` and goes when the strata
  reach `BOTTOM`.
- **Depth sets the size.** Wave numbers run on across floors (floor 3's
  first wave is wave 21); damage and shards grow per global wave. HP runs
  on each stratum's own curve (`strataCurve`: 1.08, then 1.07 a wave),
  each starting a step on from the last stratum's last wave, so a boundary
  has no cliff; the shim continues on `BALANCE.abyss.hpGrowth`.
- **Waypoints.** A guardian's first fall in order (`profile.abyss.felled`)
  opens the floor below it; on the Map's shaft every open stratum's band
  carries its own Start here (the chosen one reads Starts here), and the run
  begins there at `BALANCE.strata.waypoint.level` with its drafts banked.
- A new floor re-resolves the run's stats with its rule (`enterFloor`).
- No overtime: the descent goes on until the tower falls.
- `core/format.ts#formatNumber` writes big numbers with suffixes up to
  10⁶³ (`Vg`), then in exponent form (`1.23e66`); damage numbers use it
  too. P8's gate asks for clean numbers to about 10³⁰.

## Boss Rush (N8)

Region index 8 on the Map, opened by the Deepwarden's fall. The six Act 1
bosses back to back, then the Deepwarden and the Hunger: every wave is a
boss, its own stage (`rushStage`), with its home region's enemies for its
summons and no rule. Stage n is sized like the guardian of Abyss floor
`BALANCE.rush.floors[n − 1]` (2, 2, 3, 3, 4, 4, 5, 6). The tower starts at
level 16 with its drafts banked, since there are no waves to grow on. The
last boss down ends the run, won (`outcome: 'cleared'`), and the HUD shows
the clock.

The record (`profile.rush`) is the most stages cleared, then a full clear's
time. New records pay Starlight: 4 for each stage first cleared, and a full
clear `20 × log2(1 + 600 / seconds)` in all, so each faster record pays the
difference. Its bosses keep no kills or first falls: they are their
regions'. No pacts, no Trials.

## Act 2 feats

Twenty more feats, pointing at heat, the Abyss, the Constellations and the
masteries; they surface once the Blight has fallen, and pay Starlight as
well as shards (S7.2): by then shards buy only masteries.

## The Daily Omen (plans/late-game/11)

One run a day, built from the local calendar date alone (`meta/omen.ts`).
It opens with Act 2: an **Omen** button beside Pacts on the home view,
with a dot while today's scored try is free, and nothing else nudging.

**The day.** `omenDay(now)` is the device's local date as a day number.
Region and frame each come from a six-day cycle (every one once per six
days, never two days running); the day's stream (`hashString('omen/n')`)
splits into `rules` (the pool, one boon, one twist, the banes) and `run`
(the seed). The pool is the frame's weapon and four others, redrawn until
one counters the region's opening and not all are blunted by it; a fusion
boon forces its two weapons in. Banes are pacts as omens, at most rank II,
drawn until the day's points (banes + twist + boon) reach a target in
`BALANCE.omen.points`. The modifiers are `content/omens.ts`.

**The tower is the day's, not the player's.** `omenConfig(n)` builds a
fresh profile with the Forge bought out to `BALANCE.omen.ring[region]`,
keystones aside unless the twist sets one, and every recipe known; then
fixes each field a sibling reads from a profile: rifts at Act 2's rates
with an empty journal (`rate` on a Rift-touched day), no anomaly unless
Strange Stars deals one, no secrets, reliquaries, relic drops or first
kill, and the phone's oval. A test holds it deep-equal beside a fresh Act 2
profile and a full sky.

**Scored and practice.** The first run started for today or yesterday (the
grace day) is the scored one; after it, practice is unlimited and pays
nothing. A date pays once, ever, and none before `omen.since` (the day the
Omen first opened), so moving the clock can match a daily player but never
beat one. The score is the wave the run ends in, then kills. Bands follow
the overtime trophies: I the boss felled, II five overtime waves, III ten.
A scored try pays `2 + band` Starlight (×the Stargazers), and nothing else:
`bankOmen` keeps the run count, kills and Bestiary sightings, and leaves
shards, records, trophies, the farm rate, relics, feats, recipes, fusions,
the rift journal and the Foreman alone. Seven scored Omens wear the
Augur's Veil; the first band III, Starfall.

**Comparing.** Copy result puts one line on the clipboard: the date, the
region, the wave and kills, and an 18-character Crockford code (format,
a 16-bit rules tag of the tables and `OMEN_SIM`, the day, wave, kills,
resumes, practice, and a keyed 20-bit check). Pasting a friend's message
finds the code anywhere in it, ignores the line's own numbers, compares,
and offers to play their day (scored if it's still free, else practice).
A code from another build says so. No network: the app still has no
INTERNET permission.

**Tuning.** `npm run omen -- --days 28` plays each day with the active bot
and the hands-off policy and reads §9's targets (`--ring`, `--points` to
try other numbers).

