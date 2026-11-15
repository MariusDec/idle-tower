# 05. Real secrets

**Status:** 2026-11-15. Phases 1–5 built (Act 1's eight; see
[docs/secrets.md](../../docs/secrets.md)); phases 6–7 not built. Idea 5 of
the late-game review ([README](README.md)). `lighthouse` shipped as
`beacon-road` (Lighthouse is an anomaly's name).

**In one line:** combinations, boss forms and cosmetics that no star, shop
or list reveals: you stumble on them by playing, a "something stirred"
moment writes a riddle in the Recipe Book's margin, and the Book never says
how many there are.

---

## 1. The problem

The review's root cause is that past the mid-game, nothing is left that only
playing can get you. Discovery is the clearest case: everything you can
discover today is either **listed up front** (a `???` row that says it
exists and how many there are) or **bought**.

### Audit: what is discoverable today, and how

| Thing | How many show | How it is revealed | Found by |
|---|---|---|---|
| Evolutions (12) | every one, as a `???` row (`ui/hub/collection.ts:282`) | weapon half after 3 runs carrying it, riddle after 2 runs at level 5 (`balance.ts:195-197`, `meta/recipes.ts:41-42`); Insight shows every weapon half (`recipes.ts:33`); Act 2's four stay off until the Blight (`recipes.ts:36`) | play, but the riddles all but name the passive ("The bolts want a keener eye", `content/evolutions.ts:15`) |
| Fusions (4) | four `??? + ???` rows once Act 2 opens (`recipes.ts:75-84`) | buying the Smith star (40 Starlight, `content/stars.ts:73-92`) names both halves; the riddle shows once both evolutions are found (`recipes.ts:82`) | **purchase**: `run.fusions` comes only from lit stars (`runConfig.ts:45,137`), and `fusionCards` reads only that (`draft.ts:75-82`) |
| Secret feats (4) | four `???` rows after Forgeheart (`content/feats.ts:54-69`, `meta/feats.ts:105-107`), counted `done/shown` (`ui/hub/feats.ts:57`) | the riddle, up front | play; the Artificer's lock line says "Earned by a secret feat." (`collection.ts:28-29`) |
| Bestiary | every enemy and boss as `???` (`meta/collection.ts:256-266`) | first sight, with a toast | play, but the list is the checklist |
| Relics | a silhouette naming where each drops (`collection.ts:186-198`) | the drop | play, with the source printed |
| Trims (6) | none until won (`collection.ts:378-381`) | each Trial card on the Map names its reward | a Trial: listed |

Nothing is found without a slot that already announced it. The scorer even
says "Unknown recipes are found by chance" (`sim/suggest.ts:25-26`), but the
Book still shows the empty row. This plan adds a layer with **no slot**. It
is aimed at the hours where I6 sags: after hour 2 the longest gap between
reveals is 46–47 min (target ≤ 30).

## 2. What the player sees

**First encounter.** A Glass Wastes run after Forgeheart, carrying Frost
Ring and Mortar, as plenty of builds do. Around the fifteenth shell to land
on a frozen body, a quiet toast slides in: *Something stirred. A line is
written in the Recipe Book.* Nothing else changes. In the hub, the Recipes
page has a new section under the fusions, **Margin**, with one row: an eye
(`all-seeing-eye`, already in `content/icons.ts`), "A whisper", and *"Ice
breaks best when the sky falls on it."* No name, no `???`, no count, no
empty rows. Some runs later the player builds for it. At the sixtieth
frozen kill by a shell, a gold banner reads **Found: Shatterfall**, with a soft cue.
From then on, shells shatter frozen bodies. The results screen gets a
chip, and the Margin row gains a name, an icon, the effect and where it
works.

**Teaching.** No explainer before the first stir (R3). The first stir
opens `whispers` (`content/explainers.ts`, view `collection`): "Some things
in the tower are in no book until you find them. When one stirs, a line is
written in the Recipe Book's margin." / "The margin never says how many
there are. A whisper points at a pair, a place, or a way of fighting."
`meta/explainers.ts#explainerOpen` opens it once anything is heard or found.

### Hints: findable, not spoiled

| Channel | When | Used by |
|---|---|---|
| **Stir** (in run) | a trigger's tally first reaches `stirAt` (25%) of its goal; one stir per run | tallies |
| **Sighting** (in run) | a boss arrives in another form; its banner shows the form's name | boss forms |
| **Lore** (hub) | after `loreKills` (3) kills of a boss, its Bestiary entry gains one line | boss forms, before they are seen |
| **Book** (hub) | both halves of a hidden fusion found: its riddle joins both found entries (as `recipes.ts:82` does for Smith fusions) | hidden fusions |
| **Riders** (siblings) | a Rift's `lore` effect (02) or a contract's riddle rider (10) writes one unheard, surfaced riddle | any; never a condition or a name |

An unsolved whisper shows its riddle and, for a region secret, the region
it stirred in. That's the only partial reveal.

### Keeping them hidden in the UI

- No `x/y`, no `???` rows, no greyed slots, and no feat that counts
  secrets ("Find 5 secrets" says at least 5 exist).
- A found hidden fusion is added below the four Smith rows; before that it
  isn't listed. The fusion note (`collection.ts:310`) becomes "Two evolved
  weapons may become one card: a Smith star lights some."
- Secret relics stay out of the silhouettes until owned (`listedRelics`,
  `meta/collection.ts:269-272`). Secret trims join the trim list, which
  already shows only what is owned. A boss's Bestiary entry gets "Also seen
  as: The Lens" only after the sighting.
- A lint rule (§5) fails if a secret's name appears in any other table.

**Phone (375–430 px).** All of it reuses `.entry` rows on the Recipes page;
the stir is the existing `ui/toast.ts` card (3.2 s, takes no input); the
find is `renderer.ts#showBanner` in `gold`, which already respects reduced
motion. No new layout.

**Active-only?** Almost every secret is **everyone's**: the idle bot and
the Autocaster can stumble on them, only more slowly. A player who reads
the margin builds for it, so active play finds them sooner. One secret,
*The Wayward Banner*, is active-only by construction (no suggested card
taken), and it pays a cosmetic trim only, so I9 holds.

## 3. The mechanic

1. **Surfacing.** Each secret has `after: BossId`, the gate the secret
   feats use. Before that boss falls its trigger isn't checked, so runs on
   fresh profiles are byte-identical to today's.
2. **Tally.** Most triggers count kills or hits by a weapon (each weapon
   has its own `DamageSource`, `combat.ts:126`, and `kill` takes it,
   `:1678`), or while the ultimate lasts, on a marked body, optionally in
   one region, optionally needing items carried or evolved or a frame.
   Every mark is a field the sim already keeps: `frozenUntil`, `burnUntil`,
   `gildedUntil`, `elite`, `shade`, `inContact` on `Enemy`
   (`sim/state.ts:120-191`), and a Soul Tether's `tethers` (`:380`). A `lifetime` tally adds up
   across runs: banked on the profile, handed back through `RunConfig`.
3. **Stir.** The first time a live, unheard secret's tally reaches
   `stirAt × n`, the sim emits `secret {stage: 'stir'}`; the riddle is
   banked as heard whatever the run's outcome. One stir per run, first
   come first served, so riddles drip in.
4. **Find.** At `n`, `secret {stage: 'found'}`, and the reward works **at
   once, in that run**: a behaviour turns on (`run.behaviours[id] = 1`), or
   a hidden fusion is pushed into `run.fusions` so the next draft offers it.
5. **Forms.** At `arriveBoss` (`sim/systems/boss.ts:58`), if the boss has a
   live form whose condition the run meets, and it's not the region's first
   kill (`RunConfig.firstKill`), the boss arrives in that form; its phases
   reach the fight through `phasesOf` (`boss.ts:32`), which the mirror code
   already reads. Arriving is the sighting; felling it is the find. No RNG:
   a player who learns the condition can call the form at will.
6. **Pay.** Once, at bank: the reward plus one-off Shards (Act 1) or
   Starlight (Act 2), outside the run's shards, so Stored Light (01)
   doesn't multiply it. A form felled again drops another rank of its
   relic, up to III, then melts like any duplicate.
7. **Where tallies don't run:** Trials, Boss Rush and Daily Omen runs
   (authored or shared; 11 agrees). Region secrets check `run.regionId`, so
   Abyss floors don't count for them; resonances and hidden fusions do.
   Plan 08 takes the Act 1 bosses out of the Abyss and makes the Hunger its
   floor-30 finale, so forms stay in the regions, and the Hunger gets none.

```ts
// BALANCE.secrets (proposal). Tally goals `n` live in the content table.
secrets: {
  stirAt: 0.25, stirsPerRun: 1, loreKills: 3,
  wayward: { drafts: 10 }, kintsugi: { hp: 0.05, stir: 0.15 },
  forms: { lens: { hp: 1.8 }, banked: { hp: 1.5, plates: 2 }, kneeling: { hp: 2.5 } },
  shatterfall: { share: 0.5 }, lighthouse: { range: 0.25 }, glassfrost: { share: 1 },
  bellows: { burn: 0.15, radius: 40 }, ferryman: { heal: 0.01 }, crownfall: { seconds: 5 },
  moonward: { crescents: 6 }, gildedThread: { heal: 0.02 },
},
```

**Edge cases.** A find in a lost run still counts; a form counts only if
felled. Snapshots carry `run.secrets`, so a resume can't stir twice.
Several finds in one run are fine; only stirs are capped. Unknown ids in a
save are ignored, as recipes are. The sim can't tell a tap from the
Autocaster (it lives in `App`, `app/App.ts:519`, and sends the same
`input.ult`, `sim/run.ts:176`), so no secret depends on *how* the ultimate
was cast. The one active-only trigger uses off-suggestion picks, which the
sim does see (`DraftOffer.suggested`, `sim/state.ts:406`; `pickCard`,
`draft.ts:244`).

## 4. Content: fourteen secrets

Hints and effect texts are ≤ 15 words (R4); icons are existing `IconId`s.
Act 1's eight surface after Forgeheart (priced for Regions 4–5, like the
secret feats); Act 2's six after the Blight.

| # | id | Kind | Trigger (one run unless *lifetime*) | Reward | Hint |
|---|---|---|---|---|---|
| 1 | `shatterfall` | resonance | Mortar shells kill 60 frozen bodies, Frost Ring carried | "A shell landing on a frozen body shatters it." + 8,000 shards | "Ice breaks best when the sky falls on it." |
| 2 | `lighthouse` | region (Mist) | in the Drowned Mire, Sunlance kills 150 | "In the Mire, Sunlance reaches 25% farther." + 6,000 | "A steady beam could burn a road through the mist." |
| 3 | `glassfrost` | region (Brittle) | in the Glass Wastes, 40 Shardlings slain while frozen | "In the Glass Wastes, a frozen Shardling bursts at its kin, not the wall." + 8,000 | "Frozen glass breaks the other way." |
| 4 | `bellows` | region (Cinders) | in the Ember Rift, Scattershot kills 200 burning bodies | "In the Ember Rift, pellets spread a burning body's fire to its neighbours." + 10,000 | "Shot fired through embers comes out burning." |
| 5 | `the-lens` | form (Prism) | reach the Prism carrying no weapon that fires through `launch` (`combat.ts:493`), the shots its mirror turns back (`turnedAway`, :1357) | relic *Lens Shard*: "Beams and chains hit bosses 15% harder." + 10,000 | lore: "It shows its true face only to light it cannot turn." |
| 6 | `banked-forge` | form (Forgeheart) | reach Forgeheart carrying Absolute Zero | trim *Rime* (frost on the plinth) + 12,000 | lore: "Bring winter to the forge, and it banks its fire." |
| 7 | `kintsugi` | trim | fell a boss after the tower fell below 5% HP (`run.boss.minHp`, `state.ts:344`) | trim *Kintsugi* (gold seams in the stone) | stir at 15%: "Broken stone mends best with gold." |
| 8 | `wayward` | trim, **active-only** | fell a boss with no suggested card taken in ≥ 10 drafts | trim *Wayward Banner* | stir after a run with ≥ 5 off picks: "The tower remembers every road you chose yourself." |
| 9 | `ferryman` | region (Echoes) | *lifetime*: 300 bodies die tethered in the Hollow | "In the Hollow, a tethered body never rises; it mends the tower instead." + 12 Starlight | "A thread can carry the dead across." |
| 10 | `crownfall` | region (Blight) | in the Blight Heart, one slug pierces 3 elites | "In the Blight Heart, a slug strips an elite's aura for 5 s." + 12 Starlight | "Line the crowned up; one slug unmakes them all." |
| 11 | `moonward` | hidden fusion | Crescent Storm and Bulwark Runes evolved; crescents kill 80 bodies in contact with the wall | fusion *Moonward*: "A rune's burst throws a ring of crescents." + 15 Starlight | "The crescents want to guard the runes at the wall." |
| 12 | `gilded-thread` | hidden fusion | Lifebloom and Midas Lance evolved; 100 gilded bodies die tethered | fusion *Gilded Thread*: "Threads leap to gilded bodies first; a gilded death mends the tower." + 15 Starlight | "Golden threads carry more than life." |
| 13 | `lantern-wake` | frame × region | Lamplighter in the Hollow; 50 shades slain while Daybreak lasts (it deals no damage itself, `ultimate.ts:96-103`) | "In the Hollow, bodies slain in Daybreak's light never rise." + 10 Starlight | "Daylight lets the dead stay down." |
| 14 | `kneeling-king` | form (Hollow King) | reach the King as the Gravekeeper, Lifebloom carried | relic *Old Crown*: "Tethers bind elites first and drain them 50% faster." + 15 Starlight | lore: "He kneels to one who keeps the graves and mends them." |

**Forms are data, with no new pattern code:** `{ name, line, hp, tint,
phases }`, the phases an authored copy using existing `BossPattern` kinds
(`slam`, `summon`, `submerge`, `mirror`, `pool`, `court`;
`content/types.ts:459-476`). *The Lens:* no `mirror`, ×1.8 HP, `summon`
Shardlings every 8 s, white. *The Banked Forge:* no `pool`, two more plates,
×1.5 HP, frost. *The Kneeling King:* no `court` (one body), ×2.5 HP,
`summon` Phantoms, pale.

**Why the hidden fusions use only Act 2 weapons.** The fusion lint forbids
a weapon in two fusions (`content/lint.ts:376-396`), and `fusionCards`
relies on it (`!w.fusion`, `draft.ts:79`). The four Smith fusions already
use all eight Act 1 weapons. The four Act 2 weapons have none, so they make
exactly two hidden fusions without bending the rule, and the Act 2 weapons
gain something past their evolutions.

**Ship first: six**, one of each cheap kind: `shatterfall`, `lighthouse`,
`glassfrost`, `the-lens`, `kintsugi`, `wayward`. The other eight follow
once the find rates (§8) look right.

**Prices.** Act 1's eight pay 54,000 shards in all: about two secret feats'
worth (6,000–20,000 each), where *Crown Broken* alone pays 35,000. Act 2's
six pay 79 Starlight, about two Smith stars, against 2 a floor and 5–40 per
Act 2 feat. The rest is sideways (an interaction or a look), not a
multiplier (R1). The two fusions get the Smith fusions' ×1.25
(`BALANCE.fusions.damage`) and no more.

## 5. Data and code

**Types (`content/types.ts`).**

```ts
export type BodyMark = 'frozen' | 'burning' | 'gilded' | 'tethered' | 'elite' | 'shade' | 'inContact';
export type SecretTrigger =
  | { kind: 'tally'; event: 'kill' | 'hit'; by?: WeaponId; whileUlt?: true; on?: BodyMark; enemy?: EnemyId; region?: number;
      needs?: { carried?: WeaponId[]; evolved?: EvolutionId[]; frame?: FrameId }; n: number; lifetime?: boolean }
  | { kind: 'pierce'; by: WeaponId; on: BodyMark; n: number; region?: number }   // Crownfall
  | { kind: 'form'; boss: BossId; when: FormCondition }
  | { kind: 'brink'; hp: number }                                 // Kintsugi: `run.boss.minHp` at the kill
  | { kind: 'wayward'; drafts: number };                          // `draftsOpened` (state.ts:593) vs `offPicks`
export type FormCondition = { kind: 'unturned' } | { kind: 'evolved'; id: EvolutionId }
  | { kind: 'frame'; frame: FrameId; evolved?: EvolutionId };
export type SecretReward = { kind: 'effects'; effects: readonly Effect[] }      // as a Trial notable's
  | { kind: 'fusion'; id: FusionId } | { kind: 'relic'; relic: RelicId } | { kind: 'trim'; trim: TrimId; name: string };
export interface SecretDef extends ContentEntry {   // name, icon, text (the effect)
  readonly id: SecretId; readonly hint: string; readonly after: BossId; readonly trigger: SecretTrigger;
  readonly reward: SecretReward; readonly shards?: number; readonly starlight?: number; readonly form?: BossFormDef;
}
```

Also `FusionDef.secret?: true`; `RelicSource` gains `{ kind: 'secret' }`
(with a case in `relicWhere`'s switch, `collection.ts:40-54`); `TrimId`
(`types.ts:951`) gains `'rime' | 'kintsugi' | 'wayward'`; `BehaviourId`
gains one id per `effects` secret, as Deep Arc's trial notable does
(`content/trials.ts:73-74`); `ExplainerId` gains `'whispers'`.

| Layer | Files and changes |
|---|---|
| content | `secrets.ts` (new: `SECRETS`, `SECRET_BY_ID`); `fusions.ts` (+2, `secret: true`); `relics.ts` (+2, source `secret`); `balance.ts` (`BALANCE.secrets`); `explainers.ts` (`whispers`); `lint.ts` (below) |
| sim | `systems/secrets.ts` (new: `tallySecrets`, `formFor`, `findSecret`, one exhaustive switch over `SecretTrigger`); `combat.ts` (tally from `kill` and the hit path; `secretTaken`/`secretHit` beside `fusionTaken`/`fusionHit`, :310/:322); `boss.ts` (`arriveBoss` :58 picks the form, `bossArrive` :143 carries it); `arms.ts` (Lighthouse's range); `draft.ts` (`pickCard` counts `run.offPicks`); `state.ts` (`RunConfig.secrets: { live, found, tally }`, `RunState.secrets: { counts, found, stirred }`, `offPicks`, event `{ kind: 'secret'; id; stage: 'stir' \| 'found' \| 'sighted' }`) |
| meta | `secrets.ts` (new: `secretsLive`, `secretEffects` like `trialEffects` `trials.ts:79`, `secretFusions`, `recordSecrets`, `margin`); `runConfig.ts` (effects beside `trialEffects` :61-62, fusions :45); `results.ts` (`bankRun` :271 calls `recordSecrets`; `RunSummary.newSecrets`); `recipes.ts` (`fusionBook` lists a secret fusion only once found); `collection.ts` (`listedRelics`, Bestiary `forms`); `trials.ts` (`trims` :55 also returns secret trims); `explainers.ts` |
| ui / app | `hub/collection.ts` (Margin, "Also seen as", lore line, fusion note); `results.ts` (chip "Written in the margin"); `App.ts` (stir → toast) |
| render / audio | `renderer.ts` (found and form banners, form tint); `painters/tower.ts#paintTrim` (:120, three trims); `audio/cues.ts` (one soft whisper cue; the evolve chime for a find) |
| tools | `bot.ts` (`seek` policy); `idle.ts`, `act2.ts`, `pacing.ts`, `inspect.ts` (§8) |

**Save.** `Profile.secrets: { found: Record<string, number> /* run number,
the Margin's order */; heard: string[]; tally: Record<string, number>;
sighted: string[] }`. One rung in `meta/save/migrate.ts`, `N: (raw) => ({
...raw, version: N + 1, secrets: { found: {}, heard: [], tally: {},
sighted: [] } })`, with `PROFILE_VERSION` bumped (`profile.ts:136`, now 15;
N is whatever is free at merge, since siblings add rungs too).
`SNAPSHOT_VERSION` (`meta/save/index.ts:97`, now 13) is bumped for
`RunState.secrets`. Secret relics live in `profile.relics`, and secret
trims are derived, so neither needs a field.

**Determinism.** No secret rolls a die: triggers and forms are pure
functions of run state, so no stream is added. A later secret that wants
chance takes `root.split('secrets')` in `createRun` (`sim/run.ts:147-153`;
`split` is keyed by label, `core/rng.ts:71`). Runs before a secret's `after`
boss don't change. `tests/sim.test.ts` builds its runs from `newProfile(0)`
(:17), with nothing surfaced, so its seeds hold.

**Lint (`secrets`).** Hint and text ≤ 15 words; unique ids and names; every
`by`, `on`, `region`, `boss`, `frame`, `evolved` is real; each behaviour
has a consumer (R8); a `fusion` reward names a `secret: true` fusion, each
such fusion has exactly one secret and no star (the `fusions` rule becomes
"a star **or** a secret, never both"); **no spoilers**: no secret's name in
any feat, explainer, star, trial or region text.

**Tests.** `tests/secrets.test.ts` (new): each trigger kind fires from a
scripted state; one stir per run; a find turns its behaviour on in the same
run; a hidden fusion is offered at the next draft; a form appears only on
its condition and never on a first kill; Trials and Boss Rush never tally.
`tests/collection.test.ts`: the Recipes page of a fresh and of a full Act 1
profile holds no secret name and no Margin; one whisper heard makes exactly
one row. `tests/save.test.ts`: the rung; unknown ids ignored.
`tests/idle.test.ts`: the idle bot never earns `wayward` (I9).
`tests/explainers.test.ts`: `whispers` exists and opens.

## 6. Interactions with the sibling plans

- **01 Stored Light:** secret pay is outside the run's shards, so it isn't multiplied. 01's "found by touch is active-only" is *Wayward* here.
- **02 Rifts:** a later `lore` effect (Whispering Shade's third voice) writes one unheard riddle, kept in 02's journal too; a hint, not a reward, so I9 holds.
- **03 Cursed relics:** 03's hidden relic ("fell the finale wearing three curses") fits as a later secret: a `brink`-like trigger on the Hunger's kill, a secret relic with no silhouette.
- **04 Anomaly cards:** the same no-count rule. 04 suggests a secret might reveal the anomaly total; this plan declines (a count is the one thing never shown). A riddle may point at one unfound anomaly. An anomalised weapon still counts for a `by` tally.
- **07 Final Form:** a hidden fusion counts as fused for the every-slot test. 07's "hidden seventh form" fits as a later secret (two fusions in one run).
- **08 Abyss strata:** forms and secrets in the strata are later work in this table (keyed by 08's `StratumId`); none ship here, as 08 says. No form for the Hunger, 08's finale.
- **10 Contracts:** the riddle rider writes an unheard, surfaced riddle and never a condition; a contract may point at a found secret ("Fell the Lens again").
- **11 Daily Omen:** secrets don't tally in an Omen run (11 agrees, rule 7).

## 7. Build steps

| Phase | What | Size |
|---|---|---|
| 1 | Types, empty `content/secrets.ts`, save rung and snapshot bump, `meta/secrets.ts`, the Margin, `whispers`, lint, collection tests | S |
| 2 | Tallies, stirs and finds; `shatterfall`, `lighthouse`, `glassfrost`; toast, banner, cue; `seek` bot; `inspect --secrets` | M |
| 3 | Forms: `arriveBoss`, form data, tint, lore line, "Also seen as"; `the-lens` and the `secret` relic source | M |
| 4 | `kintsugi`, `wayward` (`offPicks`), `paintTrim`, the I9 test. **First ship: six secrets** | S |
| 5 | `bellows`, `banked-forge` | S |
| 6 | Act 2: `ferryman` (lifetime), `crownfall` (`pierce`), `lantern-wake`, `kneeling-king`, the two hidden fusions (combat code each) | L |
| 7 | Tune each `n` against §8; record readings in `docs/balancing.md` | S |

Overall **L**; shippable after phase 4.

## 8. Checks

Targets, not readings: no long tool run was made for this plan (the brief
forbids it).

| Check | Tool | Target | Invariant |
|---|---|---|---|
| Plain-bot find rate | `npm run inspect -- --secrets --seeds 200` on a late-Act 1 preset: each live secret's tally vs `n` per run | each bot-reachable secret found in 2–8% of eligible runs, stirred in ≥ 25% | "slowly" |
| Attentive player | same with the `seek` policy (once a riddle is heard, it prefers that secret's items and region) | found within ≤ 10 eligible runs of the stir; ≥ 3× the plain rate | "active finds faster" |
| Idle bot | `tools/idle.ts`: secrets found per bot by the Blight | idle ≥ 2 of Act 1's seven reachable; `wayward` = 0 | I9 |
| Act 2 | `tools/act2.ts`: secrets found by the end | plain bot ≥ half of the reachable ones | — |
| Pacing | `npm run pacing -- --idle --hours 12 --seeds 4` | Act 1 still 5–10 days, shift ≤ 0.1 d | I2, I8 |
| Reveals | `tools/pacing.ts` counts a find as a reveal (`secret:<id>`) | longest gap after hour 2 under 46 min; ≤ 40 from secrets alone (≤ 30 needs the siblings) | I6 |
| Weapon share | `npm run arsenal` | no weapon past 40%; the scorer doesn't value secrets, so picks shouldn't move | I4 |
| Active ÷ idle | `tools/idle.ts` farm comparison | unchanged within noise | I5 |
| Forms vs farming | `tools/idle.ts`, `tools/act2.ts`: repeat boss fights lost to a form | ≤ 5% | I2 |
| Calibration | `npm run calibrate` | unchanged: the scorer ignores secret behaviours at first | T2 |

## 9. Risks

- **Never found.** If `n` is too high, most players never find one. Tune
  against the find rates; the 25% stir means most players at least hear one.
- **Too obvious.** A riddle that names the card is a checklist. Each riddle
  names a feeling, a place or a status, never an item.
- **Forms hurt idle farming.** Extra HP can lose a boss a farming run used
  to win. Conditions are ones the bot rarely meets by chance; measure (§8).
- **Spoilers in the UI.** One stray count undoes it; the lint and the
  collection test guard it.
- **Datamining.** The table ships in the client. Fine for an offline game.
- **Save churn.** One rung and one snapshot bump, numbered at merge.

## 10. Open decisions

1. **Region secrets: their region only, or everywhere?** *Default: their
   region only*, which keeps the place readable and the power small.
2. **Hidden fusions over Act 1 weapons?** Needs a weapon in two fusions
   (lint and `fusionCards` change). *Default: no; two, on Act 2 weapons.*
3. **The secret feats' `???` rows** leak a count. Move them to the margin?
   *Default: leave them;* feats are a finite list by design (§5.4).
4. **Forms in the Abyss?** *Default: not at first;* plan 08 decides.
5. **Secret frames?** A frame needs an ultimate and a quirk. *Default:
   trims only.*
6. **Stirs per run:** *Default: one.*
7. **Make the Smith fusions findable too** (the star gives the riddle, not
   the halves)? *Default: no;* spent Starlight stays spent, and they teach
   the hidden ones.
8. **Secret relics count toward the relic feats?** *Default: yes;* the feats
   count what you own, not a total.
