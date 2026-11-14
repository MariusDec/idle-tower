# 02. Rifts

**Status:** 2026-11-14. Plan, not built. Supersedes §1 of
[b-moments.md](b-moments.md) (Rifts), and answers that plan's first Open
question (Rift rates in Act 2 and the Abyss).

**In one line:** a tear opens in the arena mid-wave; tap it before it
closes and it makes an authored offer (a wager, a strange bargain, a rare
card). The Autocaster, the Tactician and the idle bot never open one.

---

## 1. The problem

- **Nothing in a run is only for a watcher.** The draft times out onto the
  suggestion (`App#syncDraft`, `src/app/App.ts:457`), and the Autocaster
  casts on the idle bot's rule (`App.ts:519`). A hands-off run takes the
  same cards as a careful one, so active play earns 1.18–1.39× idle per run
  hour from Region 2 on, and the hands-off bot reaches the Blight with less
  screen time (~3.5 h) than the active one (~5.2 h).
- **Runs got predictable.** Every run is 20 waves of the region's roll, then
  overtime. Nothing in a run is a surprise once its enemies are known.
- **Reveals dry up.** After hour 2 the longest gap between reveals is
  46–47 min (I6 wants ≤ 30). The Collection's pages fill by hour 3 and then
  stop.

Rifts are a verb (R1): a tap, then a choice the scorer can't make for you.
They also give each region its own surprises, Act 1 included.

## 2. What the player sees

### First encounter

The first run after the Gatekeeper falls, wave 4: a gold-edged slit opens
in the light, breathing and slowly narrowing. A toast says "A rift! Tap it
before it closes." This **First Tear** waits 20 s instead of 8 and offers one
thing: a free level-up. Taking it sets `profile.tutorial.firstRift`. If it is
missed, the next run brings it again at wave 4, until one is opened.

After that, rifts are rolled (§3). The player sees the tear's **rarity**
(colour and shape) but not which rift it is, which is the lure.

### How it is taught

- In the run: the First Tear and its toast. No arena stop: a tutorial that
  stopped the arena would let the idle bot take it (I9).
- In the hub: an explainer `rifts` (view `collection`) in
  `content/explainers.ts`, told when the Collection's **Rifts** page first
  opens:
  1. "A rift is a tear that opens mid-wave. Tap it before it closes and it
     makes you an offer."
  2. "Some offers are gifts; most are wagers. Leaving is always free."
  3. "Only a player who is watching can open one. The Autocaster never does."
  4. "Each region has its own rifts. The ones you have met are kept here."
- Results screen: "Rifts · Wager taken · one closed unseen". A rift that
  closed untouched is **glimpsed**: its name goes into the journal with
  "It closed before you reached it". It pays nothing.

### On a phone (375–430 px)

- **Two ways to tap**, the same path as plan 03's reliquaries
  (`ui/claim.ts`, one module for both): a one-finger tap within 44 px of
  the tear (`Camera#screenToWorld`, `src/render/camera.ts:306`), kept apart
  from a pinch (`ui/zoom.ts` tracks pointers); and a 44 px **HUD chip**
  beside the ultimate with a draining ring and the rarity colour, labelled
  "Open the rift". The chip is the accessible path and the safe one on a
  crowded small screen. When a rift and a reliquary are both up, a canvas
  tap takes the nearer one and each keeps its own chip. The tear is
  placed in the upper 240° of the light at 0.45–0.7 × its radius, never
  under the bottom HUD row or the draft panel.
- **The choice panel** is a new, lighter `RiftPanel` (`ui/rift.ts`). It
  reuses the draft's shell CSS (`.draft`, `.draft-actions`, the long-press
  details) but not `DraftPanel`, which is typed on `Card`
  (`src/ui/draft.ts:137`). Layout at 375 px:
  - header: icon, name, rarity chip, and the rift's one whisper line;
  - one or two **choice rows**, full width (343 × ≥64 px), the cost in
    `--fx-blood` and the reward in `--fx-gold`, each with a live figure
    under it ("HP 2,000 → 1,600", "≈ 1,240 shards");
  - a **Leave it** button (44 px), always there, always free.
  A choice that can't apply (no weapon to level, no relic slot) is greyed
  out with its reason. Long-press shows the exact numbers.
- **While choosing, the arena stops** (`simSpeed() === 0`), with no timer.
  The player paid for this moment with a tap. A wager like "lose 20% HP"
  shouldn't be read while bodies hit the wall. Stopping adds no exploit:
  the HUD's Pause and the draft's Pause (`DraftPanel#setHalted`,
  `ui/draft.ts:291`) already stop it. A stopped arena also rests the GPU
  (`App.ts:556`).
- **While a rift waits** to be tapped, an *engaged* player sees the arena
  drop to 1× speed, so an 8 s window is 8 wall seconds even at 3×.
  Engaged is plan 01's (§3.3): `App.lastTouch` within
  `BALANCE.offline.engagedSeconds` (30 s); nothing the app does by itself
  stamps it. A hands-off screen keeps its speed, so idle play loses no
  wall time (Open 2).

### What is active-only

Opening a rift and everything it pays. Seeing a tear, its rarity, and a
glimpsed name are for everyone.

## 3. The mechanic

### When rifts open

One roll at the start of each eligible wave, on the new `rifts` stream.
The chance ramps: `chance + ramp × (eligible waves since the last rift)`.

| Where | Eligible waves | `chance` / `ramp` | Gap | Cap | Pool |
|---|---|---|---|---|---|
| Act 1, Region 1 | 4–19 | 0.12 / 0.06 | 4 waves | 2 a run | general + Region 1's |
| Act 1, Regions 2–6 | 4–19 | 0.12 / 0.06 | 4 | 2 | + rares from R2, legendaries from R3 |
| Overtime (past 20) | all | same | 4 | +1 (3 a run) | same |
| Act 2 regions (heat) | 4 on | 0.15 / 0.06 | 3 | 3 | + Act 2 rifts |
| The Abyss | floor waves 2–9 | 0.25 / 0.10 | — | 1 a floor | + the stratum's (plan 08) |
| A Daily Omen (plan 11) | as its region | × the Omen's `rifts` boon (×2) | — | as its region | general + region; no unseen weight |
| Boss Rush, Trials | none | — | — | — | — |

Never on a boss wave (`isBossWave`, `sim/systems/waves.ts:50`), and never
on a floor's wave 10, even where plan 08 makes the Keeper's wave a
non-boss wave. Never before the Gatekeeper's first fall (R3).

Worked out for Act 1: the first rift opens by wave 8 in about 75% of runs
and by wave 10 in about 95%. A run that reaches wave 20 sees about two,
which is about 100–140 rifts across Act 1's 50–70 runs.

### A tear's life

`run.rift` moves through three phases. `tickRifts` runs right after
`tickWaves` (step 2b; `docs/sim.md`'s step order gains a line):

1. **pending.** At the wave's start, a hit picks the rift (rarity weight,
   then uniform within it, ×`unseenWeight` for ones not in the journal), a
   delay of 3–7 s into the wave, and a position.
2. **shown.** It appears (`riftAppear` event). It closes at
   `closesAt = at + openSeconds` (`riftShut`) if untouched, or at once when
   the boss arrives, the tower falls, or the run is retreated.
3. **choosing.** `applyInput({ tapRift })` moves a shown rift here, but
   only if no draft is open. Then `applyInput({ chooseRift: i })` applies
   choice `i`, or leaves it when `i` is `-1` (`riftTaken` either way). While
   choosing, `tickDraft` opens nothing and `closesAt` doesn't apply.

While a draft is open the rift can't be tapped: its chip dims and says
"after the draft". The arena runs at 15% then (`BALANCE.draft.slowMotion`),
so the rift's sim clock barely moves.

### Effects

A choice is a list of `RiftEffect`s: costs first, then rewards, applied by
one consumer `applyRiftEffect` that ends in `never` (R8). Spans: `{ waves: n }`
(the rest of this wave and n more), `'boss'` (until the region's boss falls)
or `'run'`.

| Kind | Does | Hooks into |
|---|---|---|
| `shards` | `waves` × this wave's wave pay; with `atWave`, paid on reaching that wave | `waveBonus` (`waves.ts:235`), into `shardsFrom.rifts` |
| `hurt` / `heal` | a fraction of Max HP; a cost never drops HP below `hurtFloor` | `run.tower.hp` |
| `stat` | a `StatMod` (a true `mult`, so it feels the same at any Forge state) for a span | `run.mods`, rebuilt by a shared `baseMods(run)` that `waves.ts:116` also uses |
| `horde` | the next n waves bring ×count bodies, rolled on `riftFx` and merged by `at` | `run.current.spawns` at wave start |
| `bounty` | kills (or only elites) pay ×mult for a span; the extra goes to `shardsFrom.rifts` | `combat.ts#kill` (`:1678-1693`) |
| `elites` | the next n spawns, or n a wave for a span, are crowned (Champion optional) | spawn entries' `elite` |
| `draft` | bank n drafts; `hand: 'forged'` offers the evolution of any carried weapon at ≥ level 3, partner or not | `pendingDrafts`, `tickDraft` |
| `levels` | ±1 level on `all`, `others`, `weakest` or `strongest` unevolved weapon | `run.weapons` |
| `charges` | rerolls, banishes, revives | `run.rerolls` … |
| `ult` | set the charge | `run.ult.charge` |
| `stun` | every body on the field stops for s | `Enemy.stunnedUntil` (`state.ts:147`) |
| `boss` | the region's boss arrives with ×hp | `arriveBoss` (`boss.ts:58`) |
| later: `rule`, `echo`, `starlight`, `relic`, `lore`, `cursed` | §4's later rifts | `regionRule` (`waves.ts:81`), bankRun |

The first ship needs the first 13 kinds (12 rows; `hurt` and `heal` share one).

### Proposed `BALANCE.rifts`

```ts
rifts: {
  from: 4,                      // no rift before this wave
  delay: [3, 7],                // s into the wave it appears
  openSeconds: 8,               // sim s it waits for a tap
  firstOpenSeconds: 20,         // the First Tear's
  gap: { act1: 4, act2: 3 },    // waves between two rifts
  chance: { act1: 0.12, act2: 0.15, abyss: 0.25 },
  ramp: { act1: 0.06, act2: 0.06, abyss: 0.10 },
  perRun: { act1: 2, overtime: 1, act2: 3 },
  perFloor: 1,
  rarity: { common: 70, rare: 25, legendary: 5 },
  rareFrom: 2, legendaryFrom: 3, // region index
  unseenWeight: 2,
  radius: [0.45, 0.7],          // × the light's radius
  hurtFloor: 0.1,               // a cost leaves at least this share of Max HP
  forgedFrom: 3,                // a forged evolution's weapon level
  engagedCap: 1,                // app: arena speed while a rift waits, engaged only
}
```

### Edge cases

- **Snapshots.** Every phase lives in `RunState`, so a snapshot at a wave
  start (pending) or after a choice (`runDirty`) resumes exactly. A resume
  into `choosing` reopens the panel behind the resume modal.
- **Taps that can't land**: on a stopped arena (paused, the first draft),
  with no rift shown, or with a draft open. `tapRift` does nothing.
- **Retreat while choosing** closes the rift untaken.
- **Speed cap** is presentation only. The sim never learns the speed.
- **Forged evolution**: needs Alchemy (`run.behaviours.alchemy`, as
  `evolutionCards` does, `draft.ts:59`). It counts as the recipe found, so
  the Recipe Book learns the partner. With no weapon at level 3 the hand is
  a normal one with +1 card.
- **Glimpsed vs seen.** A rift that appeared and closed is glimpsed. One
  that was tapped is seen, even if left.
- **Daily Omen (plan 11).** The day's rifts must be the same for everyone,
  so an Omen run passes `known: []` (no unseen weight) and its `rate`.
  `tapRift` and `chooseRift` are ops in `run.omen.log` (11 §4.7). As with anomalies
  in an Omen (11 §4.8), an Omen's rifts don't enter the journal.

## 4. Content

`content/rifts.ts`. Each rift has a name, a whisper line (`text`, ≤ 8
words), one or two choices of ≤ 15 words each (R4), and where it can
appear. Leave it is implicit. About half are wagers (a cost and a reward).

| ID | Name | Rarity | Where | Choice text | Kinds | Ship |
|---|---|---|---|---|---|---|
| `first-tear` | The First Tear | — | once, after the Gatekeeper | "Reach in: a free level-up." | draft | 1 |
| `wager` | Wager | common | any | "Double the next wave. Its kills pay triple." | horde, bounty | 1 |
| `glimmer-cache` | Glimmering Cache | common | any | A "Five waves' pay in shards." · B "Mend: heal 40% of Max HP." | shards · heal | 1 |
| `stillness` | Stillness | common | any | A "Everything on the field stops for 4 s." · B "The ultimate fills now, then charges no more for two waves." | stun · ult, stat | 1 |
| `old-coin` | Old Coin | common | Region 1 | A "Spend it now: four waves' pay." · B "Keep it: twelve waves' pay if you reach wave 20." | shards · shards@20 | 1 |
| `ashfall` | Ashfall | common | Region 1 | "−20% range for two waves; +10% damage for the rest of the run." | stat, stat | 1 |
| `loaded-dice` | Loaded Dice | common | Region 2 on | "Two rerolls and one Banish, for this run." | charges | 1 |
| `drowned-bell` | Drowned Bell | common | Region 2 | A "Ring it: every body on the field sinks for 3 s." · B "Or lift the mist: +15% range for the run." | stun · stat | 1 |
| `marsh-wisp` | Marsh Wisp | common | Region 2 | "Follow it: the next three waves come thicker and pay double." | horde, bounty | 1 |
| `blood-price` | Blood Price | rare | Region 2 on, Alchemy | "Lose a fifth of your HP. Draft an evolution, ready or not." | hurt, draft(forged) | 1 |
| `hungry-dark` | Hungry Dark | rare | Region 2 on, relic slot | "Feed it: the next elite is a Champion, sure to drop a relic." | elites(champion) | 1 |
| `cracked-mirror` | Cracked Mirror | rare | any | "Your strongest weapon loses a level. Every other weapon gains one." | levels, levels | 1 |
| `shatterglass` | Shatterglass | common | Region 3 | "Area +30% for the run. Max HP −15%." | stat, stat | 1 |
| `split-sky` | Split Sky | legendary | Region 3 on | "Every weapon gains a level. The boss arrives with 50% more HP." | levels, boss | 1 |
| `open-flame` | Open Flame | rare | Region 4 | "Hold your hand in the flame: lose 30% HP, bank two level-ups." | hurt, draft | 1 |
| `cinder-oath` | Cinder Oath | common | Region 4 | "Damage ×1.3 for three waves, but no regen for the rest of the run." | stat, stat | 1 |
| `whispering-shade` | Whispering Shade | rare | Region 5 | A "Bind it: one more Second Wind this run." · B "Let it feed: +50% XP for two waves." | charges · stat | 1 |
| `blight-bloom` | Blight Bloom | rare | Region 6 | "Until the boss, every wave brings two more elites. Elites pay triple." | elites, bounty | 1 |
| `heart-vein` | Heart Vein | legendary | Region 6 | "Drink: Max HP doubles until the boss falls. Regen stops for the run." | stat('boss'), stat | 1 |
| `far-glimpse` | Far Glimpse | rare | Regions 1–2 | "Three waves under a far region's rule. Kills there pay double." | rule, bounty | 2 |
| `hollow-echo` | Hollow Echo | legendary | Region 5 | "Call the Hollow King's echo now, at half strength. Its relic, again." | echo | 2 |
| `star-tear` | Star-Tear | legendary | the Abyss | "A fistful of Starlight. The tear takes half your HP." | starlight, hurt | 2 |
| `deep-current` | Deep Current | rare | the Abyss | "The rest of this floor comes twice as thick; it pays Starlight twice." | horde, starlight | 2 |
| `cursed-gift` | Cursed Gift | legendary | Act 2 | "A cursed relic, yours if this run reaches wave 30." | cursed (plan 03) | 2 |
| `whisper` | Whisper | rare | Region 3 on | "Listen: it tells you one riddle you have not heard." | lore (plan 05) | 2 |

**First ship: 19** (batch 1): every region has at least two of its own or
regional ones, and both Act 1 legendaries are in. Batch 2
(6 more) comes with Act 2, the Abyss and plan 05. **About 40 in the end**: two more per region,
two per Abyss stratum (plan 08), and one or two the Daily Omen can force
(plan 11).

Value guide, for authoring and the lint's sanity table: a common is worth
about 5% of a typical run's shards (or the same in power), a rare about
10%, a legendary about 20% or a run-changing swing. Wagers pay about 1.5×
that when they come off.

## 5. Data and code

### Types (`content/types.ts`, `sim/state.ts`)

```ts
type RiftId = 'first-tear' | 'wager' | /* … */;
type RiftSpan = { waves: number } | 'boss' | 'run';
type RiftEffect =
  | { kind: 'shards'; waves: number; atWave?: number }
  | { kind: 'hurt' | 'heal'; fraction: number }
  | { kind: 'stat'; mod: StatMod; span: RiftSpan }
  | { kind: 'horde'; count: number; waves: number }
  | { kind: 'bounty'; mult: number; span: RiftSpan; on?: 'elites' }
  | { kind: 'elites'; n: number; perWave?: boolean; champion?: boolean; span?: RiftSpan }
  | { kind: 'draft'; n: number; hand?: 'forged' }
  | { kind: 'levels'; target: 'all' | 'others' | 'weakest' | 'strongest'; delta: 1 | -1 }
  | { kind: 'charges'; rerolls?: number; banishes?: number; revives?: number }
  | { kind: 'ult'; charge: number }
  | { kind: 'stun'; seconds: number }
  | { kind: 'boss'; hp: number };
interface RiftChoice { readonly text: string; readonly effects: readonly RiftEffect[] }
interface RiftDef extends ContentEntry {
  readonly id: RiftId;
  readonly rarity: 'common' | 'rare' | 'legendary';   // RarityTier names, palette.ts:137
  readonly where: { regions?: readonly number[]; from?: number; act2?: boolean; abyss?: boolean; needs?: 'alchemy' | 'relics' };
  readonly choices: readonly RiftChoice[];             // 1–2
}
// RunConfig
readonly rifts?: { first: boolean; known: readonly RiftId[]; act2: boolean; rate?: number } | null;
// RunState
rift: { id: RiftId; x: number; y: number; at: number; closesAt: number; phase: 'pending' | 'shown' | 'choosing' } | null;
riftRoll: { next: number; miss: number; count: number; floor: number };
riftHolds: { effect: RiftEffect; untilWave: number | 'boss' | 'run' }[];
riftLog: { id: RiftId; wave: number; choice: number | null; tapped: boolean }[];
shardsFrom: { …; rifts: number };
// RunInput
tapRift?: boolean;
chooseRift?: number;   // −1: leave it
// SimEvent
| { kind: 'riftAppear'; id: RiftId; x: number; y: number }
| { kind: 'riftShut'; id: RiftId; x: number; y: number }
| { kind: 'riftTaken'; id: RiftId; choice: number | null }
```

### Files by layer

| Layer | File | Change |
|---|---|---|
| content | `rifts.ts` (new), `types.ts`, `index.ts` (`CONTENT.rifts`), `balance.ts`, `explainers.ts` (`rifts`), `feats.ts` | the table; *Through the Tear* (open a legendary), *Riftwalker* (take 25) |
| content | `lint.ts` | each choice ≤ 15 words (as weapon steps, `lint.ts:100`); 1–2 choices; `where.regions` real; every Act 1 region has ≥ 2 rifts it can roll; a `levels`/`boss` effect never on a legendary-free region's common |
| sim | `systems/rifts.ts` (new) | `tickRifts`, `tapRift`, `chooseRift`, `applyRiftEffect` (never-switch), `riftLegal`, `baseMods`, `riftShardMult` |
| sim | `run.ts` | two splits, `rifts` and `riftFx`, added to `streams` (`run.ts:147-154`); `applyInput` gains `tapRift`/`chooseRift` (`run.ts:166`); `tickRifts` after `tickWaves` (`run.ts:198`) |
| sim | `systems/draft.ts` | `tickDraft` waits while choosing; the forged hand |
| sim | `systems/waves.ts`, `combat.ts`, `boss.ts` | `baseMods` at `:116`; the bounty share; the boss's HP |
| meta | `runConfig.ts` | `rifts` config: null in Trials and Rush and before the Gatekeeper |
| meta | `results.ts#bankRun` | the journal from `run.riftLog`; `tutorial.firstRift`; the results line; *Rifts* in the shards breakdown; I9's `RunSummary.activeOnly` gets kind `'rift'` (amount: `shardsFrom.rifts`, plus one entry per taken rift) |
| meta | `collection.ts` | `collectionPages` (`:243`) gains `rifts`, open once one rift is seen; `riftJournal(profile)` grouped by region |
| meta | `profile.ts`, `save/migrate.ts` | `rifts: Partial<Record<RiftId, { glimpsed: number; seen: number; taken: number[] }>>`, `tutorial.firstRift` |
| app | `App.ts` | `syncRift`; `simSpeed` returns 0 while choosing and caps at `engagedCap` while shown and engaged |
| ui | `claim.ts` (plan 03's, shared), `rift.ts` (new), `hud.ts`, `hub/collection.ts` | the canvas tap and the HUD chip, the panel, the **Rifts** page (`CollectionPage`, `:56`) |
| render | `painters/rift.ts` (new), `renderer.ts` | the tear; `consume` cases for the three events |
| audio | `cues.ts`, `music.ts` | appear: a rising shimmer panned by x; shut: a soft inhale; taken: a chord whose interval widens with rarity; the pad ducks 6 dB while choosing |
| tools | `bot.ts`, `play.ts`, `inspect.ts`, `pacing.ts`, `idle.ts`, `act2.ts` | §8 |
| docs | `docs/rifts.md` (new), `docs/sim.md`, `AGENTS.md` | the step order's step 2b; the system |

### The painter (`render/painters/rift.ts`)

A vertical jagged slit about 34 world units tall, drawn above the bodies so a
crowd never hides it. Its width breathes and **narrows over its life**: the
tear is its own timer, so it needs no number. The last 2 s flicker. Rarity
shows as colour (`RARITY`, `render/palette.ts:145`) **and** shape: a common
is one slit, a rare has a second hairline crack beside it, and a legendary
has three orbiting sparks, which keeps it colourblind-safe. On appear it
unzips in 0.4 s, on shut it zips closed with a small implosion, and when
taken it bursts into a ring. Under reduced motion the breathing and flicker
stop but the narrowing stays (it carries information). On the low quality
tier, no gradient. Cost: one path and one gradient, well under 0.1 ms.

### Determinism

- Two new streams from `createRun`'s split. `split` doesn't advance the
  root (`core/rng.ts:71`), so existing seeds don't shift. `rifts` draws
  when, which and where; `riftFx` draws what a taken rift rolls (horde
  bodies). So **a seed shows the same rifts whatever you take**, as long as
  the run reaches the same waves.
- A rift that is never tapped touches nothing outside `rift`, `riftRoll`,
  `riftLog` and its two streams. A test pins this (Tests, below).
- Taps and choices are inputs by tick, through `applyInput`, like picks.
  `{ tapRift, chooseRift }` in one input is legal (the bot uses it).
- `SNAPSHOT_VERSION` +1 (13 today, `meta/save/index.ts:97`; 03, 04, 07 and
  08 bump it too, so take the next free one). A stale snapshot is thrown
  away, as today (`:134`).
- `PROFILE_VERSION` +1 (15 → 16 if this lands first; plans 01 and others
  bump it too, so take the next free one). The migration adds `rifts: {}`
  and `tutorial.firstRift: false`.

### Tests

- `tests/rifts.test.ts`: the same seed gives the same rifts by wave; none
  on boss waves, in Trials or Rush, or before the Gatekeeper; the cap, gap
  and ramp; each effect kind; `hurt` respects `hurtFloor`; `tapRift` does
  nothing with a draft open; `riftLegal` greys what can't apply; spans
  expire on the right wave; `baseMods` survives an Abyss floor swap.
- **The untouched-rift test**: one seed with `rifts: null`, the same seed
  with rifts on and never tapped. Wave by wave, `stateHash` minus the rift
  fields and the two streams is equal.
- `tests/save.test.ts`: a snapshot taken while choosing resumes to the same
  hash; migration to the new profile version.
- `tests/content.test.ts`: lint passes. `tests/explainers.test.ts`: the
  Rifts page has its explainer.
- `tests/touch-targets.test.ts`: `.rift-chip` and the panel's rows declare
  the 44 px floor.

## 6. Interactions with the sibling plans

- **[01-stored-light.md](01-stored-light.md):** a rift tap stamps
  `lastTouch`, so it counts as engaged; the same `lastTouch` sets the speed
  cap here. Rift pay is tagged `'rift'` in `RunSummary.activeOnly` (01
  §9.1, I9), and `tapRift`/`chooseRift` join `ACTIVE_INPUTS`.
- **[03-cursed-relics.md](03-cursed-relics.md):** one tap path
  (`ui/claim.ts`: canvas tap within 44 px, or the HUD chip), one input
  pattern, sim-time windows that slow with a draft and stop while hidden.
  *Cursed Gift* offers a cursed relic outside the Abyss; *Hungry Dark* in
  the Abyss can leave a reliquary instead of a relic.
- **[04-anomaly-cards.md](04-anomaly-cards.md):** a forged hand (Blood
  Price) rolls an anomaly for an eligible weapon on 04's `anomaly` stream:
  the guaranteed way to see one. Still one *taken* a run.
- **[05-secrets.md](05-secrets.md):** the batch-2 *Whisper* rift writes one
  unheard riddle. A hint, not a reward, so I9 holds.
- **[07-final-form.md](07-final-form.md):** forged evolutions and *Split
  Sky* reach Final Form sooner, for active players only; read its
  wave-landing check with rifts off. 07's "Crucible" (the next evolution
  needs its passive at 4) is a candidate for the ~40.
- **[08-abyss-strata.md](08-abyss-strata.md):** `perFloor` rates on floor
  waves 2–9; the Keeper's wave 10 never rolls. Each stratum brings two
  native rifts (`where.abyss` plus a stratum id), authored here.
- **[10-contracts.md](10-contracts.md):** condition `rifts` (take n in one
  run) counts `riftLog` entries with a choice. A rift's choice is never
  constrained by a contract.
- **[11-daily-omen.md](11-daily-omen.md):** the boon `rifts: ×2` ("Rift
  night") sets `RunConfig.rifts.rate`; `known: []` keeps the day the same
  for everyone; taps and choices are log ops; no journal entries.

## 7. Build steps

| # | Step | Size | Ships |
|---|---|---|---|
| R1 | Sim core: types, streams, `tickRifts`, inputs, events, six kinds (`shards`, `hurt`, `heal`, `stat`, `stun`, `ult`), six rifts, tests, bot and `play.ts` wall model; `RunConfig.rifts` null in the app | M | headless only: tools can measure |
| R2 | App: the tap (`ui/claim.ts`, built here or by 03, whichever ships first) and HUD chip, painter, panel, stop and speed cap, First Tear and toast, cues, profile migration, journal record in `bankRun`, results line; turn rifts on | M | players meet six rifts |
| R3 | The remaining first-ship kinds (`horde`, `bounty`, `elites`, `draft` forged, `levels`, `charges`, `boss`) and all 19 rifts; lint rules | M | the full Act 1 set |
| R4 | The Collection's Rifts page, explainer, feats; pacing reveals | S | discovery |
| R5 | Act 2 and Abyss rates; batch 2 kinds (`rule`, `echo`, `starlight`, `relic`, `lore`, `cursed`) with plans 03, 05 and 08 | M | Act 2 |
| R6 | Tuning pass on the §8 readings | S | — |

Total: **L** (four M steps, two S). R1 and R2 are the slice that tests
the idea.

## 8. Checks (I1–I9)

| Reading | Command | Target | Invariant |
|---|---|---|---|
| Rifts per run by region | `npm run inspect -- --seeds 50 --region k --rifts` (new flag: per-wave rift column, totals) | 1.5–2.5 per run to wave 20; ≥ 90% of runs past wave 12 see one; 0 on boss waves | — |
| Act 1 pace | `npm run pacing -- --hours 12 --seeds 8`, and the same with `--no-rifts` | Blight still 7–12 h (I1); I3 holds; the reveal timeline logs each new journal entry, and the longest gap after hour 2 drops from 46–47 min toward ≤ 30 | I1, I3, I6 |
| Idle untouched | `npm run pacing -- --idle --hours 12 --seeds 4`, with and without `--no-rifts` | days to the Blight equal to within seed noise (the cap applies only when engaged) | I2 / I8 |
| No leak to idle | `tools/idle.ts` sums `RunSummary.activeOnly` (01 §9.1): no `'rift'` entry, every `riftLog` untapped, `shardsFrom.rifts === 0`; `play.ts` asserts the idle branch never sets an input in `ACTIVE_INPUTS` (`tapRift`, `chooseRift` added) | 0, hard fail | I9 |
| Active vs idle | `tools/idle.ts` farm comparison, `shardsFrom.rifts` reported apart | I5 within 1.15–1.5; rifts add 6–12% to active shards per run hour | I5, I7 |
| Screen time | `tools/idle.ts`, both bots on one clock | rifts move I7 toward ≤ 0.7× (plan 01 does most of it) | I7 |
| Weapon picks | `npm run arsenal` | I4 unchanged; level effects move no weapon's pick share by > 2 points | I4 |
| Scorer | `npm run calibrate` | passes unchanged (no new weapon behaviour) | T2 |
| Act 2 | `tools/act2.ts` with and without `--no-rifts` (R5) | floors per hour up ≤ 15%; idle unchanged | I9 |

The active bot (`tools/bot.ts#riftInput`) opens every rift and takes the
first legal choice, unless it has a `hurt`, `horde` or `elites` cost and
the tower is under 70% HP or the boss is next. Then it leaves. The game
itself never suggests a choice. `play.ts` adds `RIFT_SECONDS = 3` wall
seconds per tapped rift (the arena is stopped), and the 1× cap while a rift
is shown (active only, which counts as engaged).

## 9. Risks

- **I5 overshoot.** Active is already 1.18–1.39×; +6–12% can pass 1.5.
  `shardsFrom.rifts` makes it visible. Cut `shards`/`bounty` values before
  touching the band (Open 3).
- **Taps in a crowd.** The tear sits away from the HUD and a canvas tap
  has 44 px of slack, but a crowd or a pinch can still eat it. The HUD
  chip is the safe path; test both at 375×812 (D4) on the APK.
- **Fatigue.** Two rifts a run over 70 runs could get routine. Rarity, the
  discovery weight and the journal keep it fresh, and leaving is free.
  Watch whether players stop tapping commons (no telemetry, so this is a
  playtest question).
- **Outliers.** *Split Sky* early in Region 3 or *Blight Bloom* on a weak
  build can win or end a run. These are wagers by design, but `inspect
  --rifts` should show a taken legendary's death rate within 10 points of
  the region's.
- **Snapshot drift.** A rift field left out of `RunState` would make a
  resume diverge. The choosing-snapshot test covers it.
- **The name.** Region 4 is the *Ember Rift*. A "rift in the Ember Rift" reads
  oddly (Open 5).

## 10. Open decisions

1. **Stop the arena while choosing, or slow it to 15% like the draft?**
   Default: **stop**, with no timer. Wagers need reading, and Pause already
   exists, so stopping adds no exploit.
2. **Speed cap while a rift waits.** Engaged only (default), always (costs
   a screen-on idler ~3% wall time at 3×), or never (a 2.7 s window at 3×).
3. **Rift income and I5.** Default: read I5 with rifts on, report
   `shardsFrom.rifts` apart, and lower rift values before moving the band.
4. **Journal totals.** Default: show "2 of 4" per region for commons and
   rares, and hide legendaries until found ("something rarer opens here"
   once the rest are found).
5. **Name.** Default: keep "Rift". In the Ember Rift region the tears are
   fire-edged. Alternatives: "Tear" or "Breach".
6. **Rifts in Trials.** Default: none; a later Trial may opt in.
7. **Rarity visible before the tap.** Default: yes, as colour and shape.
   That is the lure for a watching player.
8. **Blood Price before Alchemy.** Default: no (`needs: 'alchemy'`), so
   evolutions keep their own reveal (R3).
