# Review risks: what a player would complain about

**Status:** 2026-11-18. Second draft. Nothing here is built. It's written
from the repo (plans, `docs/balancing.md`'s readings, git history) and
from readings taken for this draft (below), not from players: no build
has had outside players yet, and playtest #3 (Q2's gate) is still open.

**In one line:** guess the reviews before they're written. List the
complaints a store reviewer is most likely to make, say which ones the
repo already answers, and order the rest by how many stars each could
cost.

**Readings taken for this draft (2026-11-18, `d0cc774`):**

- `npm test`: 3 failed, 841 passed (below, R4).
- `npm run pacing -- --hours 4 --seed 2 --fast --csv`: the reveal
  timeline used in R1 and R2. One seed with `--fast`, so it shows shape,
  not a gate verdict. P3 29:19, Gatekeeper 29:57, I6 (first 2 h) 8:18,
  I6 from 2 h 10:28, no Blight in 4 h.
- A probe of `tools/arsenal.ts`'s fixture tower (4 seeds per region,
  R4).

---

## 0. Already answered (don't re-plan)

From `plans/post-rebuild-improvements.md`, the late-game plans and the
code:

- **Save loss.** U12: sealed profile, backups, snapshot, export
  (`62b4fd1`). A crash mid-run resumes it (`plans/android-gpu-crash.md`
  §2).
- **"Late upgrades do nothing."** S1: split stat buckets, compounding
  masteries (Q1).
- **"Armour walls."** S2: smooth armour curve, Forgeheart's plates.
- **"Can't see my build."** U3, U5 (build strip, *How it went*).
- **"Idle play is the same as active play."** Stored Light, Rifts,
  Anomalies (I7–I9 pass).
- **"Act 2 runs dry."** S7 / Q4 (Starlight per floor, feats pay).
- **"What do I do next?"** The results screen *and* the hub's home view
  both show the Next goal (`docs/ui.md` §Screens). Moved here from R1.
- **Text size, colourblind, reduced motion, 44 px touch targets.**
  Settings has text size 100/115/130%, a colourblind palette and motion
  controls; `tests/touch-targets.test.ts` audits tap targets
  (`docs/ui.md` §Accessibility). R7 is now only about checking them on
  real sizes.
- **Monetization.** None, and no network (the manifest has no
  `INTERNET` permission). Keep it that way, and say so on the store
  page (R6).

Each still needs one check by a person who isn't the author (§4).

---

## 1. The likely complaints

Each item lists the complaint as a reviewer would write it, what the
repo shows, a proposal and how to check it. Severity is how many stars
it could cost: **high** means it shows up in 1–2★ reviews, **low** means
it gets mentioned in a 4★ review. Effort is a rough size: **S** under a
day, **M** a few days, **L** a week or more.

### R1. "Too much, too fast. I don't know what anything does" (high)

**What the repo shows.**

- **Twenty systems in the first two hours.** First appearances on seed
  2's timeline (wall clock): the draft 0:15, the Forge 2:02, the
  Collection 5:05, the Recipe Book 8:17; then, at the Gatekeeper's fall
  (30:15), **five at once**: the Map, Feats, Trials, relic slots and
  17 Forge nodes unsealed. Rifts follow at 30:54, Night Watch (offline)
  at 32:31, Champions 34:41, relic sets and Twin Mount 45:05, the
  Autocaster 62:03, frames (Bastion) 74:54, Alchemy and the first
  evolution 84–87 min, Evolution Insight 91:42, the Foreman 95:53,
  Stored Light 116:56. That is about one new system every 6 minutes, and
  seven of them land within 2.5 minutes of the first boss.
- **Long shopping lists.** The bot buys 5–19 Forge nodes per results
  screen in the first hour (run 12: 19 nodes; run 28: 18). A person
  faces the same number of choices on a web that's growing as they
  read it.
- **Explainers are hub-only.** 23 explainers (`content/explainers.ts`)
  open per hub view, one card per view with all its unread ones. The
  Gatekeeper's fall opens the Map's (Map, Trials) and Feats' at once.
  Systems met inside a run (Rifts, Champions, elite auras, anomalies,
  the ultimate) get a toast or a one-off flag there (`tutorial.firstRift`,
  `firstReliquary`); Rifts and anomalies are explained only later, when
  the player next opens the Collection, and Champions and auras not at
  all.
- **The draft is timed.** 10 s of wall time (6 s with the Tactician)
  with the arena at 15% speed, then the suggestion is taken
  (`docs/draft.md` §Timing). There's a stop button on the panel and the
  first draft isn't timed, but there's no setting to turn the timer off.
  Badges, pips and long-press details in 10 s is a lot for a new player.

**Proposal.**

1. **Split reveals into two kinds and measure both** (S). In
   `tools/pacing.ts`, tag each reveal as *content* (an enemy, a card, a
   relic, a rift kind, a Champion, a wave) or *system* (a tab, an
   explainer, a mechanic notable, an `unlock:` that adds a screen or a
   rule). Log explainer opens too (`explainerOpen` on the profile after
   each run). Report systems per 15 min over the first 3 h.
   - Target: **at most one new system per 10 min, never two within
     2 min**, except the first boss, which may open two.
   - This settles the tension with R2: R2 asks for *more* reveals, R1 for
     *fewer systems*. Content reveals fill R2's gaps; systems get spread
     out.
2. **Stagger the Gatekeeper's unlocks** (M). Today
   `hubUnlocks`/`trialsOpen`/relic slots all key off the same
   `bossDown(firstBoss)`. Proposed order:
   - At the fall: the Map (needed to move on) and the unsealed nodes.
   - First Region 2 run ended: Feats (it then opens with claims ready,
     which is a reward, not a lesson).
   - First relic dropped: the relic slot (today the slot shows before
     there's anything to put in it).
   - Region 2's wave 10 or the second Region 2 run: Trials.
   - Re-read I6 after: this moves reveals into the 30–45 min stretch,
     which is fine as long as no gap passes 10 min.
3. **Cap the Forge's first-hour shopping list** (M). Options, cheapest
   first: (a) the results screen's Forge button says "3 nodes ready" and
   the web opens on the cheapest three; (b) a *Recommended* pin (the
   Foreman's queue, shown before the Foreman is owned, as a hint only).
   Pick one after the playtest, not before.
4. **One line for in-run systems** (S). The first Rift, Champion,
   anomaly and elite aura each pause the run with a one-sentence card,
   the same way the first draft is untimed. Reuse the explainer card
   (`ui/explainer.ts`); add `view: 'run'` to `ExplainerView`.
5. **A draft-timer setting** (S). Settings › Gameplay: draft timer
   On / Long (20 s) / Off. Off still auto-picks under the Tactician once
   it's owned. The idle bots aren't affected (they read
   `BALANCE.draft.seconds` through the run config, not settings).

**Check.**

- Systems-per-15-min reading on 8 seeds meets the target.
- Playtest (§4): after 30 min, can the player explain the Forge and the
  draft in one sentence each? After the Gatekeeper, can they say what a
  Trial is?

**Depends on:** R2's reveal schedule (both edit the same timeline).

**Status (2026-11-19): §1, §2, §4, §5 built; §3 left for after the playtest, as written.**

- §1: `npm run pacing` tags each reveal content or system (`Reveal.system`),
  logs explainer opens (`PacingReport.explainers`, not I6's reveals), and
  prints systems per 15 min and an R1 verdict; the CSV gains `kind` and
  `system` columns.
- §2: Feats open after the first run past Region 1, Trials after the
  second (`AFTER_GATEKEEPER`, `runsPastFirst`); save v26 adds
  `regions[i].runs`. **The relic slot was not moved:** the Gatekeeper's
  first kill gives its own relic (`bankRun` → `bossRelic`), so the slot
  never opens empty. The premise above was wrong.
- §4: first rift, Champion and elite aura get a one-sentence card that
  holds the arena, only for a player who touched in the last 30 s. The
  first anomaly already has the draft's own line, so it gets no card.
- §5: Settings › Gameplay › Draft timer On / Long (20 s) / Off. Off
  picks on the Long clock once the Tactician is owned.

Reading (8 seeds, 3 h, `--fast`): R1 0/8, 19–22 pairs closer than 10 min
per seed, 8–12 within 2 min; median systems per 15 min `5 3 11 1 2 1 3 1 0
1 1 0`. The 30–45 min quarter still holds ~11: the stagger spreads the
unlocks over ~4 min, but the bot buys Night Watch, Frontier March and the
Tactician in the same stretch, and the first rift, aura and Champion land
there too. Meeting the target needs the Gatekeeper's sealed notables
spread out (part of §3's question) and is a larger change than §2. I6
stays 5/8 (median 8:53), P3 27:59, P4 31:00.

### R2. "Got stuck / got bored in the middle" (high)

**What the repo shows.**

- **I6 (first 2 h) is a coin toss.** 1–7 of 8 depending on the reading
  (`docs/balancing.md`); the CI profile reads 10:49 against 10:00 (R4).
  Seed 2 with `--fast` passes at 8:18. The first two hours run at about
  one reveal per 8–10 min, so a seed that passes and one that fails
  differ by seconds.
- **Where the gaps are:** Region 2's Forge stretch at ~46–56 min (Choice
  → Autocaster); a Trial run behind the frontier (one 20-min Trial with
  nothing revealed until its results); Region 3's ring-3 stretch at
  95–115 min since tempering made Region 3 ~34 min long.
- **Past 2 h, I6 fails 0/8** with 66–117 min gaps in Regions 4–6
  (Tempering readings). Seed 2's 4 h timeline reads a 10:28 worst gap
  from 2 h, but that's one seed with `--fast` and the Contract board on;
  the 8-seed reading hasn't been re-taken since the board.
- **Plateaus feel like walls.** Seed 2's timeline: after the Gatekeeper,
  eight Region 2 runs end at waves 13–16 before one reaches 18; Region 4
  opens with runs ending at waves 9–11. The bot buys through it, but
  a person sees "died at wave 14" eight times.
- `docs/balancing.md`'s conclusion stands: "a fix needs a mechanic", not
  numbers.

**Proposal.**

1. **In-run reveals for Trials** (S). Reveal a trophy as it's earned and
   a later Champion as it's met, inside the run, not on the results
   screen. This closes the Trial-run gap (seeds 2 and 7 in Q1's reading).
2. **One authored mid-region beat in Region 3** (M): a new enemy, a
   Champion or a rift kind introduced at its midpoint, so its ~34 min
   has something new at ~17 min.
3. **One authored reveal between each pair of late bosses** (M–L):
   Regions 4–6, one per region to start. Candidates already in the
   content pipeline: the remaining anomalies (4 of 12 built), a cursed
   relic (1 built), a region's secret (secrets are Act 1's eight).
4. **Show progress on a plateau** (S). On a run that ends short of the
   region's best, the results screen leads with what *did* improve
   (wave reached vs the last 5 runs' median, the next node's %). I3
   already guarantees "≥ 50% toward a node"; this makes it visible.
5. **Add I6-late as a gate** (S): from 2 h to the Blight, no gap over
   30 min, read on 8 seeds with the Contract board on. Today it's
   reported, not gated.

**Check.**

- I6 (first 2 h) ≥ 6/8 on 8 seeds without `--fast`.
- I6-late ≤ 30 min on ≥ 6/8.
- Playtest: ask "was there a point you nearly stopped? when?" and line
  the answers up with the timeline.

**Status (2026-11-19): §1–§5 built.** Read first on 8 seeds × 6 h, no
`--fast`, with R1's changes in. That reading moved two premises:

- **Region 3 is short now.** Bog Mother → Prism is 8–18 min. The long
  regions are 2 and 4 (~45 min each), and the first two hours' gaps were
  their plateaus. Region 2's runs end at waves 13–16 for ~20 min (seeds 2
  and 4: 12:37 and 10:12 at ~47–59 min). Region 4 runs ~30 times at waves
  9–15. I6-late (from 2 h to the Blight) already passed 8/8, worst 24:02:
  the 66–117 min gaps above predate the Contract board.
- **Wave-gated content can't fill a plateau**, because the player stops
  reaching new waves. Runs in a region (R1's `regions[i].runs`) keep
  counting, so §2–3 key off those.

What was built:

- §1: the run tells a Trial won at its boss's fall (`trialPrize`, the
  same line `winTrial` pays) and an overtime trophy as its wave starts
  (`trophyAt`, the same pay `bankRun` gives), each as a gold toast. The
  pacing bot logs both at that moment, not at the results. Champions were
  already told in the run, each as it comes; nothing changed there.
- §2–3: **a held rift per region**, Regions 2–6 (`where.held`, five new
  rares): Sunken Shrine (Region 2, 11th run), Glass Oracle (3, 3rd),
  Ashen Anvil (4, 12th), Hollow Choir (5, 8th), The Last Lantern (6,
  9th). From that run on it is the run's first rift, at the First Tear's
  wave, until met once; until then it is never drawn. Built from
  existing effect kinds, so no sim code. Region 2 is the beat §2 asked of
  Region 3, because Region 2's middle is where the gap was; Region 3 keeps
  one too. Each run number sits at the centre of the dry stretch the
  reading found: 8 and 10 first put the Shrine and the Anvil *before*
  their gaps (5/8).
- §4: a run short of the region's best leads with a gold line: the wave
  against the median of the last 3–5 ordinary runs there
  (`regions[i].recent`, optional, so no save rung), and the Forge's next
  node before → after. Trials and contracts keep no place in the line.
- §5: I6's later clause reads from 2 h to the Blight's first fall, and
  both clauses print PASS/FAIL on ≥ 6/8 in `npm run pacing -- --seeds 8`.
  It stays a phase-gate reading, not CI: 6 h × 8 seeds is ~12 min.
- CI's I6 gates every profile again (R4 had moved it to the median until
  R2).
- `tools/idle.ts#farmRate` takes an owed beat as met, as it leaves a first
  kill's bonus out: every frozen copy would meet it, and the active bot
  alone takes it. That moved I5 at `region-2` from 1.34 to 1.18 on seed 3.

Reading (8 seeds × 6 h, no `--fast`):

| | before | after |
|---|---|---|
| I6, first 2 h | 6/8 (worst 12:37, 10:12) | **8/8** (worst 6:07–8:20) |
| I6, 2 h → Blight | 8/8 (worst 7:32–24:02, to 6 h) | **8/8** (worst 7:02–13:24) |
| Blight's first fall | 4:05–4:51 | 4:01–4:25 |

I5 (4 seeds, 3 h, 6 farm runs): region-2 1.22–1.47, bog-mother
1.15–1.30, prism 1.19–1.26, forgeheart 1.21–1.42, all in band. With the
Shrine at run 8 and the Anvil at 10, seed 1's prism read 1.11. That was
the bot's path, not the farm: no beat is owed there. The single-seed CI
check is that close to the edge. Not re-read: the idle report (I2, I7–I9,
`--idle --hours 12 --seeds 4`). The hands-off bot never opens a rift, but
a placed one moves its rift stream. `tests/pacing.test.ts`'s I2 on seed 1
passes.

### R3. "Finished it in an afternoon" or "it's a grind" (medium–high)

**What the repo shows.**

- **Act 1 is ~4–5 h, not 7–12 h.** I1b reads 252–262 min (late-game
  review, 8 seeds). Tempering turned the late wall into a bypass; the
  gate has failed since.
- **Act 2's content is thin:** strata 2 of 5, anomalies 4 of 12, the
  cursed chase has one relic, secrets only in Act 1.
- **Past stratum II there's no ending, just repetition.** From floor 13
  the Abyss falls back to "the old cycle" (`docs/act2.md`: a boss every
  floor and the Deepwarden or the Hunger). Nothing tells the player that
  the strata stop. A reviewer will call this "nothing new after X".
  When the bot reaches floor 13 hasn't been measured (the 12 h Act 2
  reading's median best floor is 9).
- **Idle length is fine:** I2/I8 pass at 6.0 d median.

**Decision needed (owner):** is Act 1 meant to be ~4 h of active play?

- **If yes:** move I1b to 3.5–6 h, and say "about 5 hours to the first
  ending, then an endless second act" on the store page. Short and
  honest beats long and padded in reviews.
- **If no:** lengthen Regions 4–6 with reveals (R2 §3), not HP. Each
  authored reveal per region adds ~20–30 min of reason to keep going.

**Proposal.**

1. **Measure when floor 13 arrives** (S): `npm run pacing -- --act2
   --hours 24 --seeds 4 --reuse`, report the first arrival at floor 13.
   That's when the content runs out.
2. **A visible ending at the last built stratum** (S–M). On the Map's
   shaft, below stratum II: a sealed band, *"The deep goes on. Strata
   III–V are still being dug."* Floors past 12 keep working, so nobody
   loses an endless mode. Remove the band as strata are built.
3. **Or wait for strata III–V** (L). Only if the floor-13 reading says
   most players get there within the first two weeks.

**Check.** I1b against the chosen gate; the floor-13 reading; the
store page's length claim matches the readings.

### R4. "Buggy" (medium)

**What the repo shows.** `npm test` on 2026-11-18: **3 failed, 841
passed**. The first draft had one number wrong (P3's gate is 30 min,
not 35).

| Test | Reads | Gate | Cause |
|---|---|---|---|
| `tests/pacing.test.ts` P3 | 31:25 (median of seeds 1–3) | ≤ 30:00 | Since the camera and fog merge; the 8-seed P3 passes at 27:51. Three seeds are too few for a median at the gate's edge |
| `tests/pacing.test.ts` I6 | 10:49 worst gap (one of seeds 1–3) | ≤ 10:00 | The first two hours run at one reveal per 8–10 min (R2); every seed must pass, so one slow seed fails CI |
| `tests/arsenal.test.ts` "evolutions happen at the frontier" | 0 evolutions in 72 runs | > 0 | The fixture is stale (below) |

**The arsenal fixture.** `tools/arsenal.ts#frontierConfig` builds a
tower with every node up to the region's ring at half its levels, no
tempering, no twin mount. A probe of that tower (4 seeds per region,
600 s runs): Region 1 reaches waves 19–23, but Region 4 dies at waves
10–12 in ~2.5 min, Region 5 at wave 10, Region 6 at waves 5–6 in
~1 min. Weapons reach level 5, but passives stop at 1–4, so no
evolution's partner is ever ready. Q1 raised Regions 4–6's HP and
tempering now carries the real player; the fixture got neither.

This matters beyond the one test: **I4 (no dominant weapon) is read on
the same fixture**, so in Regions 4–6 it measures picks in runs that
last 1–3 minutes. I4's "PASS" there says little.

**Proposal.**

1. **Rebuild the arsenal fixture from real profiles** (M). Use the
   pacing bot's saved profile at each region's first arrival (the
   `--act2 --reuse` mechanism already saves profiles; add one per
   region arrival), then play 600 s from there. Re-read I4 and the
   keystone sweep on it.
2. **P3 in CI** (S): read 5 seeds instead of 3, or move the CI gate to
   the 8-seed reading's band (P3 ≤ 30 min on the median of 5). If CI
   time is the constraint, run 5 seeds with `--fast` and keep the full
   8-seed read for phase gates.
3. **I6 in CI** (S): gate the median of the three seeds' worst gaps,
   not every seed, until R2 lands; then put the every-seed rule back.
   Write the reason in the test.
4. Rule from then on: **a red test blocks a commit** unless the commit
   message names it.

**Check.** `npm test` green; the re-read I4 and keystone sweep in
`docs/balancing.md`.

### R5. "Drains my battery / gets hot / crashed" (medium, Android)

**What the repo shows.**

- **The crash plan is built** (`plans/android-gpu-crash.md` §1–3): no
  frames while the arena is stopped or the app is hidden, baked glows,
  lower DPR caps on Android, run saves on background and after picks.
  Its open items: the hub's `tile memory limits exceeded` on every hub
  load, and whether the relaunch resumed the run.
- **The phone check was never done.** `docs/performance.md`: all
  numbers are desktop; "the phone check (P1's gate, now with four-weapon
  evolved builds) is still open".
- **No frame cap.** The loop draws every frame at the display's rate;
  on a 120 Hz phone that's twice the GPU work of 60 Hz for an idle
  game that doesn't need it.
- **Long sessions are the design.** The hands-off bot spends 223–269
  min of screen time to the Blight (I7); the engaged one 123–131 min.

**Proposal.**

1. **The phone check** (M), on two devices (one mid-range, one ~4 years
   old). 60 min at ×3 in Region 5 with an evolved four-weapon build:
   `tower.bench()` p50/p95 every 10 min, battery % and temperature
   (`adb shell dumpsys battery`, `dumpsys thermalservice`) every
   5 min. Then 60 min on the hub idle.
2. **A frame-rate setting** (S): Display › Frame rate: 30 / 60 / Device.
   Default 60. Skip frames in `App.frame` when the last draw was under
   the target interval; the sim runs on its fixed step regardless.
3. **Look at the hub's tile memory warning** (S–M): the hub is the
   screen people leave the phone on between runs.
4. **Keep the screen on only in a run** (S, decide): today nothing
   keeps the screen awake, so a hands-off run can be cut by the screen
   timeout. Either is a complaint ("screen turns off" vs "drains
   battery"); decide and say so in Settings.

**Check.** No crash in 60 min; under 10% battery per hour at 60 fps on
the mid-range phone; no thermal throttling reported.

**Status (2026-11-19): §2 and §4 built, §3 looked at, §1 still needs the
phones.** Save v27.

- §2: Settings › Display › Frame rate 30 / 60 / Device, default 60.
  `Loop.setFrameCap` skips early vsyncs and stamps drawn frames on the
  ideal grid (`capGate`), so 90 and 144 Hz under 60 still draw 60; the sim
  pays the skipped frames' steps on the next one, so no reading moves. The
  quality scaler's budget follows the cap (`frameBudget`), or a 30 fps cap
  would read as a slow device and drop a tier every two seconds. Read in
  the browser: 30 / 60 / 60 draws a second at each setting on a 60 Hz
  display; a run at 30 kept its sim rate and stayed on `high`.
- §4, decided: **on during a run, off elsewhere**, as a setting (Display ›
  Screen on, default On). The lock is held only while the arena moves; the
  hub, the results, a pause and a held choice keep the device's timeout.
  On by default because a hands-off run is designed play and a sleeping
  screen pauses it; the frame cap is the battery answer. Web Wake Lock in
  a browser, and in the app a local Capacitor plugin
  (`ScreenAwakePlugin.java`, `FLAG_KEEP_SCREEN_ON`), since a WebView need
  not grant the web lock (the desktop app's browser pane refuses it). The
  Java compiles; not yet run on a phone.
- §3: not reproduced; the warning needs the WebView's own GPU budget.
  What the hub composites, and the logcat steps to pin it to a view, are
  in `docs/performance.md` (§ The hub's `tile memory limits exceeded`).
  No speculative change made.
- §1: still open. It now also measures 30 vs 60 vs Device, and runs the
  tile-memory steps above.

### R6. "It's a copy of The Tower" / can't find it (medium, store)

**What the repo shows.**

- `appName: 'The Tower'` (`capacitor.config.ts`), and the same name in
  `android/.../strings.xml` (`app_name`, `title_activity_main`),
  `index.html`'s `<title>`, the hub's `<h1>` (`ui/hub/hub.ts:161`) and
  the specimen page. The name and genre match an existing, popular
  commercial tower-defence idle game. A store search for "The Tower"
  will put this game under it, and reviewers will compare.
- **Names that must not change** in a rename: the `appId`
  (`com.mariusdonci.thetower`, the Play identity), `server.androidScheme`
  and `hostname` (the WebView's origin, which keys storage), and the
  storage keys: `the-tower-save`, `the-tower-save-legacy-backup`,
  `the-tower-quality`, `the-tower-canvas`, IndexedDB `the-tower`. Change
  any of these and every save is orphaned.

**Proposal.**

1. **Pick the name** (owner). Criteria: distinctive in a Play search,
   says "light / tower / idle defence", no other game with that name.
   The game's own words are a good source: *Last Light*, *Lamplighter*,
   *Blue Hour*, *Night Watch*, *the Blight* (search each before
   choosing).
2. **Rename the display strings only** (S): `capacitor.config.ts`
   `appName`, `strings.xml`, `index.html`, the hub and specimen
   headings, README and AGENTS. Add a comment by each storage key:
   "legacy name, never rename".
3. **Store page** (S): screenshots of what's different (the draft,
   an evolution, Final Form, the Abyss strata); first line "No ads, no
   purchases, plays offline"; R3's length claim.

**Check.** A store search for the new name shows this game first; an
upgrade install over the old build keeps its save.

**Status (2026-11-19): §1–§3 built; the Play search and the upgrade
install wait for a device and the first upload.**

- §1: **Blue Hour**, the owner's pick. It's already the palette's name
  (`--theme-color`, "Blue hour's indigo"). A web search found no game
  under it; *Last Light* and *Lamplighter* each have small itch.io or
  indie namesakes, and *Night Watch* is already a Forge notable.
- §2: the display name in `capacitor.config.ts`, `strings.xml`,
  `index.html`, the hub and specimen headings, README, AGENTS,
  `docs/README.md` and `tokens.css`'s header. Each storage key has a
  "legacy name, never rename" comment, and `tests/r6.test.ts` pins them,
  plus the `appId`, scheme and hostname. Left on the old name on purpose:
  the npm package name, the Java package and the release keystore's alias
  (all are identities, not display strings), and the plans' history.
- §3: `docs/store-listing.md`: short and full description (first line
  "No ads. No purchases. Plays offline."), six screenshots with captions,
  category and Data safety answers. Its length line is a placeholder until
  R3's decision, and its backup sentence depends on R9 §1.

### R7. "Text too small / can't tap that / broken on my tablet" (medium)

**What the repo shows.**

- Text size, touch targets and colourblind support exist (§0). Every
  screen is checked at 375×812 (D4), but not at 360×640, and 130% text
  is only known to fit Settings.
- **Tablets and foldables are unhandled.** The manifest locks no
  orientation and declares no app category. Since the app targets SDK
  36, Android 16 ignores orientation and aspect-ratio locks on displays
  ≥ 600 dp for ordinary apps; games are exempt if they declare
  `android:appCategory="game"` (verify against Android's current docs
  before relying on it). So on a tablet or an unfolded foldable the
  game will run in whatever shape the screen is, today, with a layout
  built for a portrait phone.

**Proposal.**

1. **Declare the category and lock portrait** (S):
   `android:appCategory="game"` on `<application>` and
   `android:screenOrientation="portrait"` on the activity. Check on a
   tablet emulator that it stays portrait, letterboxed.
2. **A size sweep** (S): every screen at 360×640, 375×812 and 412×915,
   each at 100% and 130% text, and at the system font scaled to 1.3
   (Android's WebView may scale text on its own; check that `--text-scale`
   and the system scale don't stack into overflow). The browser pane can
   do the first two; the system font needs a device or emulator.
3. **A letterboxed tablet layout** (S): at ≥ 600 dp, centre the game at
   phone width with the brand gradient either side, rather than
   stretching the HUD.

**Check.** No clipped text and no target under 44 px at any size; a
tablet and a foldable show the game portrait and centred.

### R8. "Idle progress is weak / the offline report confused me" (medium)

**What the repo shows.**

- **No offline pay at all until Night Watch I**, a Forge notable sealed
  behind the Gatekeeper (~30 min in; seed 2 bought it at 32:31). A
  player who closes the app in their first half hour, as most first
  sessions end, comes back to nothing. For an idle game that's the
  genre's first promise broken.
- **Then 15% for 2 h**, 4 h from Night Watch II (~62 min in), until
  Night Watch III's Stored Light (~117 min in). A night's sleep in the
  first evening pays 2 h at 15%. Players of the genre expect more, even
  if the big number is fake.
- **The welcome-back card is one paragraph of up to five clauses**
  (`App.ts#welcomeBack`): time away, shards, the stored amount with
  both rates ("×5 while you play, ×2 left alone"), the cap note, what
  the Foreman bought, the Foreman's held pin, what became affordable.
- **"While you play" means a touch every 30 s** (`engagedSeconds`). A
  player who sets the phone down gets ×2, not ×5, and nothing tells
  them why. This is by design (I7–I9) but reads as "I have to keep
  tapping".

**Proposal.**

1. **A small offline pay from the first run** (S): Night Watch 0, 10%
   for 1 h, built in. It must not move I2/I8 or I5: the idle bot's
   first check-ins come before it owns Night Watch I, so this pays it
   too (not yet measured how much). Re-read all three. The first
   welcome-back then says "Night Watch (in the Forge) makes this
   bigger".
2. **Restructure the welcome-back card** (S): a headline number, then
   one line each: *Gathered* · *Stored Light* (with "Next 15 min of
   play: ×5") · *Foreman* · *Now affordable*. Drop any line that's zero.
3. **Show the engaged rate live** (S): while Stored Light burns, the
   HUD's shard counter shows ×5 or ×2, and dims to ×2 after 30 s
   without a touch. The player learns the rule by seeing it.

**Check.** Playtest: does a returning player understand where the night
went, and what "×5 while you play" asks of them? Idle readings (I2, I5,
I7–I9) unchanged.

### R9. "Lost everything when I changed phones" (medium) — new

**What the repo shows.** There's no account and no network, so the
only ways across devices are Settings › Save (copy, file) and Android's
own backup. The manifest has `android:allowBackup="true"` and no
backup rules, so Auto Backup should include the WebView's storage
(IndexedDB and `localStorage` live in the app's data folder) and the
Capacitor run snapshot. Nobody has tested it, and the WebView's own
data layout isn't something the game controls.

**Proposal.**

1. **Test a real restore** (S): play, `adb shell bmgr backupnow
   com.mariusdonci.thetower`, uninstall, reinstall, confirm the save
   comes back. Also test a fresh device with the same Google account.
2. **If it doesn't restore**: add `dataExtractionRules` /
   `fullBackupContent` that include the WebView's storage, or write the
   sealed profile to a file in `filesDir` (via `@capacitor/filesystem`)
   on each save so Auto Backup has one small file to carry.
3. **Say it in the game** (S): Settings › Save, one line: "Moves to a
   new phone with Android backup, or copy your save here."

**Check.** The restore test passes on two Android versions.

### R10. "Music gets repetitive" (low) — new

**What the repo shows.** `audio/music.ts` is a generative pad: three
moods, each a short chord loop, the key shifting by region. Over a 4 h
session that's a lot of the same loop. There's a music slider, so
it's a 4★ complaint at worst.

**Proposal.** Per-stratum and per-boss variations already exist in
part (strata have their own music, `docs/act2.md`); add one variation
per region for Act 1 when the audio gets a pass. Not before R1–R8.

**Check.** Playtest: "did you turn the music off? when?"

---

## 2. Tensions between items

- **R1 vs R2.** R2 wants a reveal every ≤ 10 min, R1 wants fewer new
  systems. Resolved by the split in R1 §1: content fills gaps, systems
  are spread.
- **R3 vs R2.** Lengthening Act 1 without new content makes R2's gaps
  longer. Lengthen only with reveals.
- **R8 vs the idle gates.** More offline pay early can pull I2/I8 under
  5 days. The proposal is sized so it shouldn't; re-read anyway.
- **R5 vs the hands-off player.** A frame cap and screen timeout save
  battery but cut hands-off runs. Decide R5 §4 before the store.

## 3. Order

1. **R4** (S–M): a green suite and a fixture that measures real towers,
   before anything else is tuned. Also fixes I4's reading.
2. **R6** (S + the owner's name): must happen before any store upload.
3. **R7 §1, R9 §1** (S each): manifest lines and a restore test; cheap
   and they affect the first upload.
4. **R2 and R1 §1–2** together: the reveal split, the staggered
   Gatekeeper unlocks, the in-run Trial reveals. They share the pacing
   reading.
5. **R3**: the owner's decision, the floor-13 reading, then the ending
   band.
6. **R8 §1–2, R1 §4–5**: small UI and offline changes, best done before
   playtest #3 so it can test them.
7. **R5, R7 §2–3**: one pass on real devices.
8. **R10**: with the next audio pass.

## 4. The check that matters most: real players

Everything above is a guess from the bot and the code. Before the
store:

- **Playtest #3** (still open): 5–10 people, over several days, the
  five questions from the rebuild plan, plus:
  - R1: after 30 min, explain the Forge and the draft in one sentence
    each; after the Gatekeeper, what's a Trial?
  - R2: was there a point you nearly stopped? When?
  - R8: what happened while you were away? What does "×5 while you
    play" mean?
  - R10: did you turn the music off?
  - Note each person's phone (R5, R7).
- **Then a Play Console closed testing track** for 2–3 weeks. Read the
  feedback as reviews: sort it into this plan's R-items, and add new
  ones. The closed track also tests R9 (installs from the store, real
  backups) and R6 (the search).

## 5. Open questions for the owner

- The intended length of Act 1 (R3): ~4–5 h and say so, or 7–12 h with
  more content?
- Ship Act 2 with a visible ending at stratum II, or wait for III–V?
  (R3, after the floor-13 reading.)
- The new name (R6).
- Keep the screen on during runs, or not (R5 §4)?
- Which phones to test on (R5, R7): one mid-range and one ~4 years old
  is the minimum.
- Whether a small offline pay from the first run fits the idle design
  (R8 §1), or whether the first 30 minutes are meant to be active only.
