# 07. Final Form

**Status:** 2026-11-15. F0–F4 built, and the seventh-slot mount fix
(docs/final-form.md has the readings); F5 not built (`ultCharge` stays 0).
Plan written 2026-11-14. Supersedes §3 of
[b-moments.md](b-moments.md) (and answers its last Open question).

**In one line:** evolve two weapons in one run and the tower takes its
frame's Final Form until the run ends: a new crown, a ceremony, a music
layer and a record in the Collection. It's something to draft toward
inside a run, not another percentage.

---

## 1. The problem

- **Nothing in a run changes the tower's shape.** The tower's look is the
  profile's (`TowerLook`: tier, trophies, trims; `render/painters/tower.ts:21-25`,
  set by `Renderer#setTower`, `render/renderer.ts:144`). During a run the
  only changes are new mounts and a gold halo per evolved weapon
  (`tower.ts:333-340`). After the first evolution (median wave 14–20,
  probe below) the run has no visual arc left.
- **The draft has no goal past one recipe.** The scorer steers only toward
  *known* recipes (`sim/suggest.ts:294`, `RECIPE_VALUE = 0.6` at `:94`), one
  step at a time. Nothing rewards planning a second evolution.
- **The outline's trigger can't be reached.** b-moments §3 says "no empty
  weapon slot, and no weapon that isn't evolved or fused". An evolution
  needs the weapon at 5 and its own partner passive at 5
  (`content/balance.ts:124-125`, `sim/systems/draft.ts:59-69`). Every
  partner is a different passive (`content/evolutions.ts`), so a tower
  with W weapon slots and P passive slots can evolve at most min(W, P).
  A full 4/4 Act 1 build costs 38–43 picks (4 weapons to 5, 4 partners
  to 5, 4 evolution cards). A run gets about 20–26.
- **Late Act 1 is thin on reveals.** After hour 2 the longest gap between
  reveals is 46–47 min (README). A first Final Form is a natural reveal for
  Regions 4–6.

### Measured today (scratch probe, not in the repo; 6 seeds a row, so a look, not a gate)

The probe runs `tools/inspect.ts#simulate`'s loop with the active bot and
`veteran(preset)`, with the 8 Act 1 recipes marked found. `veteran`
starts with none found (`tools/inspect.ts:69-70`), so plain `inspect`
undercounts evolutions. Each step it counts evolved weapons.

| Forge, region | W/P slots | 1 evolved | 2 evolved | 3+ evolved | level at w15 / w20 | end wave (median) |
|---|---|---|---|---|---|---|
| ring3, R2 | 2/4 | 6/6 | 0/6 | 0/6 | — | 26 |
| ring4, R3 | 3/4 | 4/6 (w20) | 0/6 | 0/6 | 14 / 17 | 25 |
| ring5, R4 | 3/4 | 5/6 (w19) | 2/6 (w25) | 0/6 | — | 24 |
| ring6, R5 | 4/4 | 6/6 (w14) | 1/6 (w20) | 0/6 | 18–19 / 22–23 | 22 |
| ring6, R5, no recipes | 4/4 | 2/6 | 0/6 | 0/6 | — | 23 |
| ring6, R5, Artificer | 5/3 | 5/6 | 2/6 | 0/6 | — | 22 |
| all, R6 | 4/4 | 2/6 (w14) | 0/6 | 0/6 | — | 16 |
| all, Abyss (3 runs, ≤ 1240 s, 4 floors) | 4/4 | 2/3 | 1/3 (level 27) | 0/3 | — | — |

The outline's "every slot" rule held in **0 of 42** runs, and no probe
run (about 90, some repeated) reached three evolutions. Levels stop growing at about 27, even in a
4-floor Abyss run, because each level costs ×1.1 more XP
(`BALANCE.xp.growth`). Two evolutions is the only reachable bar.

## 2. What the player sees

**First encounter.** In Region 4 or 5, mid-run, a player who has found a
few recipes takes their second evolution card. The usual "Evolved"
spotlight closes in, then the arena slows, a ring in the frame's colour
rolls out to the rim, and the crown grows on the tower. A letterboxed
banner reads *Final Form · Astral Spire*. The music gains a high voice and
keeps it until the run ends, and the range ring takes the frame's colour.

**How it is taught (R3).**

- Before it's reachable: a new explainer `forms` (view `collection`, on
  the Recipes page) opens once `profile.recipes.found.length >= 1`. That's
  one evolution done, so Alchemy is owned and Scattershot's second slot is
  too. Its text:
  - "Evolve two weapons in one run and the tower takes its Final Form
    until the run ends."
  - "Each frame has its own form. The Collection keeps the earliest wave
    you reached it."
- In a run: once that explainer is open, the HUD build strip
  (`ui/build.ts`) ends in a small crown icon with two pips. Each evolved
  weapon lights one. After Final Form the crown turns gold.
- The first time per frame there's also a toast: crown icon, "Final Form ·
  Astral Spire", and the form's line. Repeat forms with that frame get
  the banner without the letterbox, and no toast.

**Phone (375–430 px).** Nothing new takes space in the arena apart from
the crown on the tower. The banner and toast reuse the existing slots. The
build-strip crown is one 24 px chip at the end of the strip, which already
wraps.

**Active-only?** No. The trigger never looks at input, so the idle bot,
the Autocaster and a timed-out draft can all reach it. In practice it
rewards a player who drafts toward two recipes, since the suggestion
doesn't chase it (§4.4). The idle way to chase it is a Tactician list that
puts two recipes' halves first. I9 is untouched because nothing is
withheld from the idle bot.

## 3. The mechanic

### 3.1 The trigger

```
need(run) = W >= minSlots && P >= BALANCE.finalForm.need && alchemy ? BALANCE.finalForm.need : 0
formed    = need > 0 && count(weapons where evolved || anomaly) >= need   // fused halves are evolved, so they count
```

- **Fixed when the run starts.** `weaponSlots`, `passiveSlots` and
  `behaviours.alchemy` are all fixed by `createRun` (`sim/run.ts:92-93`),
  so `need` is stored once on `RunState`.
- **Latched.** One helper, `checkFinalForm(run)`, runs wherever a weapon
  becomes evolved or anomalous: `applyCard`'s `evolution` branch
  (`draft.ts:281-289`, straight after the `evolve` event), plan 02's forged
  evolution and plan 04's anomaly pick. It fires once, and nothing undoes it: a later new weapon in a free slot, or a
  Harbinger's silence, doesn't take it away.
- **Fusions count** through their halves. A fusion needs both halves
  already evolved (`draft.ts:75-83`), so it can't be the trigger itself.
  It just follows Final Form, and the crown stays on the shared mount.

### 3.2 Slots by stage, and what changes `need`

| Stage | W / P (Forge and gear) | `need` | Picks to Final Form* | Drafts by w15 / w20 |
|---|---|---|---|---|
| Before Alchemy (`forge.ts:245`, sealed by bog-mother) | 1–2 / 2–3 | 0 | — | — |
| R2–R3: Alchemy, Scattershot (`forge.ts:194`) | 2 / 3–4 | 2 | 19–21 | ~13 / ~16 (out of reach) |
| R4–R5: Third Mount (`forge.ts:257`, sealed by prism) | 3 / 4 | 2 | 18–21 | ~17 / ~21 |
| R6: Fourth Mount (`forge.ts:302`) | 4 / 4 | 2 | 18 | as R5 (not measured: runs end near w16) |
| Act 2: Fifth Mount (`stars.ts:59`), Heart of Light (`relics.ts:136`) | 5–6 / 4 | 2 | 18 | same |
| Artificer (`frames.ts:63-71`: +1 W, −1 P) | +1 / −1 | 2 | 18–21 | same |
| Trial "one weapon slot" / "no passives" (`trials.ts:15, 21`) | 1 / – or – / 0 | 0 | — | — |

\* Two weapons to level 5 (Opening Salvo and Drilled shorten this), two
partners to 5, and two evolution cards. The outline's every-slot rule would
need 38–43 picks.

- **Specialist** (`forge.ts:250`) doesn't change `need`. Its signature
  weapon is still one of the two, and the second must come from a −25% weapon.
- **Twin Mount** (`forge.ts:215`) doesn't change `need`. Because the first
  draft offers the second weapon, it's the best opening for the chase.
- **Boss Rush** starts at level 16 (`BALANCE.rush.level`, `balance.ts:423`),
  so Final Form will be common there. That's fine, but it sets no record
  (§5.1, the `results.ts` row).
- **Abyss waypoints** (plan 08 §4.4) start a run at level 22–36 with its
  drafts banked, as Boss Rush does. "~27" here is not a cap. It's where a
  natural run's levels stop. The rule counts evolved weapons, so a waypoint
  run at level 26+ has the 18–21 picks in its opening burst and may form
  at once, if those picks go to two recipes. Allowed, no record (Open 6).
  08 checks its placeholders with `inspect --form`.
- `BALANCE.finalForm.minSlots: 2`. A one-slot Trial would otherwise make
  the first evolution a Final Form.

### 3.3 Cosmetic, or a small effect?

**Recommended: cosmetic in v1, with the effect kept as a knob at 0.**

| Option | What | Balance risk |
|---|---|---|
| a. Cosmetic (**v1**) | crown, ceremony, music, ring colour, record | none: the sim's numbers are unchanged, every invariant reads as before |
| b. Ultimate charges faster | `BALANCE.finalForm.ultCharge: 0.25`, a `run`-bucket `ultCharge` mod | small: late-run power on runs that already have two evolution spikes (×1.2–1.4 each). Humans get it more often than the bots, so it pushes I5 toward 1.5 and I7 the right way. It is a pure percentage (R1) unless the HUD's ult ring visibly turns gold |
| c. Outline's light +10% | grows `L` | **rejected**: `stats.light` is `lightRadius(range)` (`content/arena.ts:62`), so it would need a new stat. Enemies would also spawn further out (more walk time), and the camera's framing would shift mid-run |

If (b) is turned on, the mod goes into both `run.outerMods` and
`run.mods`. An Abyss floor rebuilds `run.mods` from `outerMods`
(`sim/systems/waves.ts:116`), so a mod pushed only into `mods` would be
lost. Then `refreshStats` runs.

### 3.4 What the suggestion does

v1 leaves the scorer alone: `suggest.ts` is unchanged, I4 and `calibrate`
don't move, and the bots' reach rate is a report. If the idle reach rate in
Region 5 comes in under 10% (§8), the lever is a "second recipe" bonus:
`RECIPE_VALUE × BALANCE.finalForm.chase` (1.5) on partner-passive steps
once one evolution is done. It would be gated on `RunConfig.formChase` (the
`forms` explainer read) and re-measured with `arsenal`. See Open 3.

### 3.5 Edge cases

- **`takeAll`** (U2 "Take suggested ×N"): the `evolve` and `finalForm`
  events can come in the same batch, maybe with another draft opening.
  The renderer queues the form beat 0.35 s after the evolve spotlight
  (§5.2). The app's slow-motion multiplies with the draft's 15%. That's
  fine, because it's wall-clock seconds.
- **Run resumed from a snapshot:** `run.form.wave` is in the snapshot. The
  crown draws with no ceremony, and the music layer comes back on attach.
- **An anomaly card** (plan 04) replaces a weapon's evolution: it never
  evolves or fuses. It counts as one of the two, as 04 §7 and its Open 8
  agree. Otherwise taking one would block Final Form.
- **A hidden fusion** (plan 05) needs both halves evolved, like a Smith
  fusion, so it already counts.
- **Seven weapon slots** (Artificer + Fifth Mount + Heart of Light) put
  slot 6 on slot 1's pod: `mountOffset` wraps `POD_ANGLES` modulo 5
  (`content/mounts.ts:11, 37-41`). It's an existing bug, not this plan's,
  but a crown over overlapping pods would make it obvious. Fix it first
  (§10).

## 4. Content

`FrameDef` gains `form: { name; text }` (≤ 3 words and ≤ 15 words, R4,
linted). There are six, all shipping in v1, because one per frame is the
whole idea. Colours are `FX` names. `blood` is for enemies only, so nothing
here uses it.

| Frame | Form | Text | Accent | Crown (drawn at 0.3–0.45 R inside, 2.0–2.3 R outside) | Moves (frozen under reduced motion) |
|---|---|---|---|---|---|
| Arcanist | Astral Spire | A violet spire rises from the crystal; stars wheel around it. | `arcane` | the crystal's diamond stretched ×1.6; 5 star points on a 2.1 R orbit | stars orbit at 0.3 rad/s; spire breathes |
| Bastion | Rampart Crown | A second wall of frost-lit stone rings the plinth. | `frost` | an octagon of 8 merlons at 2.0 R in `INK['400']`, frost rim line | rim light pulses 0.5 Hz |
| Stormcaller | Storm Tines | Three lightning rods crown the drum, arcing between them. | `mana` | 3 tines at 120°, 0.45 R tall; one 3-point arc between two tines | arc jumps pair every 0.4 s (wall clock) |
| Artificer | Engine Ring | A geared ring turns round the tower, catching the light. | `gold` | a 24-tooth ring at 2.1 R, `INK['600']` with gold teeth tips | turns 0.15 rad/s |
| Lamplighter | Sunrise | A halo of rays turns slowly; the dark at the rim draws back. | `ember` | 12 short wedges at 2.0–2.3 R; arena's outer dark −15% alpha (render only) | rays turn 0.1 rad/s |
| Gravekeeper | Eclipse Crown | A dark disc rings the crystal, edged with a cold corona. | `nature` | `INK['950']` ring at 0.45 R behind the crystal, 1 px corona; 6 motes at 2.1 R | motes drift inward and respawn |

All six also share these:

- **Range ring:** `paintRangeRing` (`tower.ts:624`) takes a colour. In
  Final Form it's the accent at 0.45 alpha, solid rather than dashed.
- **Evolved halos:** they switch from `gold` to the accent
  (`tower.ts:335`).
- **Layering:** the outer elements sit beyond the tier-7 crown of light
  (1.62 R, `tower.ts:194-201`) and the trophy lights (1.8 R, `:202-216`),
  so they never hide either.

## 5. Data and code

### 5.1 Per layer

| Layer | File | Change |
|---|---|---|
| content | `types.ts` | `FrameDef.form: { name: string; text: string }`; `FeatGoal` += `{ kind: 'finalForm' }`, `{ kind: 'forms'; n: number }` |
| content | `frames.ts` | the six `form` entries (§4) |
| content | `balance.ts` | `finalForm: { need: 2, minSlots: 2, ultCharge: 0, chase: 1 }` |
| content | `explainers.ts` | `forms` (view `collection`) |
| content | `feats.ts` | `final-form` "Reach any frame's Final Form." (reward 10 000); `every-form` "Reach all six frames' Final Forms." (after `blight`, 1 500 000 + 15 Starlight) |
| content | `lint.ts` | `form.name` ≤ 3 words, `form.text` ≤ 15 words, every frame has one |
| sim | `state.ts` | `RunState.form: { need: number; wave: number \| null }`; `SimEvent` += `{ kind: 'finalForm'; frame: FrameId }` |
| sim | `run.ts` | `form.need` from slots and `alchemy` at `createRun` |
| sim | `systems/form.ts` (new) | `formNeed(config)`, `checkFinalForm(run)`: latch, event, optional mod |
| sim | `systems/draft.ts` | call `checkFinalForm` after the `evolve` push (`:287`) |
| meta | `profile.ts` | `forms: Partial<Record<FrameId, { wave: number; count: number }>>` |
| meta | `save/migrate.ts` | v15 → v16: `forms: {}` (`PROFILE_VERSION` at `profile.ts:136`) |
| meta | `save/index.ts` | `SNAPSHOT_VERSION` 13 → 14 (`:97`) |
| meta | `results.ts` | `RunSummary.finalForm: { wave; first; record } \| null`; `bankRun` writes `profile.forms` (region runs only set `wave`; the Abyss and Boss Rush only add to `count`) |
| meta | `feats.ts` | `featMet` / progress consumers for the two goals (exhaustive switches in `featMet` and `featProgress`, `meta/feats.ts:41, 114`) |
| meta | `explainers.ts` | `forms` opens on `recipes.found.length >= 1` |
| ui | `build.ts`, `hud.ts` | crown chip with pips, once `forms` has been told |
| ui | `results.ts` | a chip in the finds row (`:291-296`): "Final Form · wave 17", NEW on first, RECORD on an earlier wave |
| ui | `hub/collection.ts` | Frames page (`:338-374`): a line per frame, "Final Form: Astral Spire · earliest wave 15 · ×4", or "Final Form: ?" |
| render | `painters/tower.ts` | `paintForm(ctx, R, frame, grow, time, still)`, exhaustive over `FrameId`; `paintRangeRing` colour; halo accent |
| render | `renderer.ts` | `case 'finalForm'`: the form timer, banner (letterbox on first only, which `profile.forms` tells the app), effects; draws the crown from `run.form.wave !== null` |
| render | `effects.ts` | `formBurst(radius, light, accent)`: 2 rings + `count(60)` sparks |
| app | `App.ts` | `announce`: `slowMo = FORM_SLOWMO` (0.9 s at 0.25, beside `BOSS_KILL_SLOWMO`, `App.ts:68-69`); first-form toast; `music.setFormed`; dev `tower.form()` for bench |
| audio | `cues.ts` | `finalForm`: a 0.8 s low triangle swell plus the 6-note rise 392–1568 Hz (≤ 8 tones) |
| audio | `music.ts` | `setFormed(on)`: one extra triangle voice at `notes[2] + 12` per chord until the run ends |
| tools | `inspect.ts` | `--recipes act1\|all` (mark recipes found) and `--form` (per run: the wave formed; over seeds: reach rate, median wave, evolved-at-end histogram) |
| tools | `pacing.ts`, `idle.ts`, `act2.ts` | report the first Final Form in the reveal timeline, and the reach rate per region |

### 5.2 Ceremony, motion and quality

| Beat (wall clock) | Full | Reduced motion | Low tier |
|---|---|---|---|
| 0 s | evolve spotlight as today; its "Evolved" banner skipped when `finalForm` is in the batch | same, no zoom punch | same |
| 0–0.9 s | slow-motion ×0.25 | kept (it's time, not movement, as with the boss kill) | kept |
| 0.35 s | `formBurst`, zoom punch, crown grows over 0.8 s (ease-out) | no burst, no punch; crown fades in over 0.4 s | burst sparks ×0.25 (quality's `count`), no additive pass |
| 0.35 s | banner "Final Form" / form name; letterboxed on first per frame | no letterbox (`renderer.ts:81-82` already drops it) | same |
| 0.35 s | cue, then the music layer from the next chord | same | same |
| rest of run | crown animates (§4) | crown still: one fixed pose | crown animates; no glow arcs |

Reduced motion comes from `Renderer#setMotion` (`renderer.ts:115`), which
already feeds the camera. The painter gets `still = reducedMotion`.

### 5.3 Performance budget (Android)

- **Steady state:** at most 40 path operations a frame, no `createRadialGradient`
  or `createLinearGradient` per frame (flat fills and alpha strokes only),
  no `shadowBlur` or `filter`, no per-frame allocation (angles precomputed
  per frame id). Budget: **+0.1 ms on `Renderer.render` p95** against the
  2026-10-01 desktop baseline (0.9–1.1 ms, `docs/performance.md`).
- **Ceremony:** 2 rings, and 60 / 30 / 15 sparks by tier. That's within the
  600 / 360 / 200 particle caps (`render/quality.ts:21-25`) and `MAX_RINGS`.
  Nothing new is baked, so a palette swap or tier change has nothing to rebake.
- **Audio:** ≤ 8 one-shot tones, plus one oscillator per 3–6 s chord.

### 5.4 Determinism, saves and tests

- **Determinism:** no new random roll and no new stream. The check is pure
  state in `applyCard`, which runs inside `applyInput`. With
  `ultCharge: 0`, every seed's numbers are identical to today's, and the
  only difference is the new `form` field.
- **Saves:** Profile v16 (`forms`) and snapshot 14. Plan 01 and others
  also bump `PROFILE_VERSION`; whichever lands first takes 16, and the
  others re-number.

Tests (`tests/form.test.ts`):

1. A run given two evolution cards emits exactly one `finalForm` and sets
   `form.wave`.
2. A third evolution, or a fusion, emits none.
3. `need` is 0 with no Alchemy, a one-slot Trial or a no-passive Trial,
   and 2 for an Artificer config.
4. With `ultCharge: 0`, the stats hash with and without Final Form is equal.
5. With `ultCharge > 0`, the mod survives an Abyss floor change.
6. `bankRun`: first per frame, record only on an earlier region wave,
   Boss Rush adds `count` only.
7. Migration v15 → v16.
8. Lint rejects a 16-word form text.

`tests/palette.test.ts` must stay green, since the crowns use no literal
colours.

## 6. Interactions with the sibling plans

- **01 Stored Light:** its extra draft card helps the chase. Final Form
  doesn't count as "engaged".
- **02 Rifts:** forged evolutions (at weapon level 3) and *Split Sky*
  reach Final Form sooner, for active players only. They call
  `checkFinalForm`. §8's reach readings run with Rifts off, as 02 asks.
- **03 Cursed relics:** curses hold through the transformation. 03's T5
  runs Rootheart with Final Form, and the crown is cosmetic, so T5's
  numbers don't move unless F5 ships.
- **04 Anomaly cards:** an anomalised weapon counts as evolved here
  (04 §7, its Open 8).
- **05 Secrets:** a hidden fusion needs both halves evolved, so it counts.
  A frame's unseen form ("Final Form: ?") is a light secret.
- **08 Abyss strata:** 08 is authoritative on the Abyss. Waypoint runs
  start at level 22–36 with drafts banked (§3.2). Final Form there is
  allowed, sets no record, and 08 keeps its waypoint levels honest with
  `inspect --form`.
- **10 Contracts:** row 26, "Reach Final Form as the Artificer in the Ember
  Rift", is condition `finalForm`. It reads `RunSummary.finalForm` with the
  summary's `frameId` and `regionId`.
- **11 Daily Omen:** it works as usual in an Omen. 11's spare bit can add
  "✦ Final Form" to the share line.

## 7. Build steps

| Step | What | Size | Ships alone? |
|---|---|---|---|
| F0 | `inspect --recipes --form` flags. Baseline at 50 seeds: ring3/R2, ring4/R3, ring5/R4, ring6/R5, all/R6, Artificer | S | yes (tool only) |
| F1 | sim: `run.form`, `systems/form.ts`, the event, snapshot 14, tests 1–5. Renderer and cue: a plain banner and the arpeggio | S | yes |
| F2 | the six crowns, ring colour, halo accent, `formBurst`, slow-motion, music layer, reduced motion, tiers; `tower.form()` and a bench | M | yes |
| F3 | Profile v16, results chip, Collection line, `forms` explainer, HUD crown chip, two feats | S | yes |
| F4 | hub: `TowerLook.form` draws the selected frame's crown, still and at 60% alpha, once that frame has formed | S | yes |
| F5 | optional: `ultCharge` on, after §8's readings with it on | S | yes |

Total: **M** (F2 is most of it).

## 8. Checks

| Check | Reading | Target | Touches |
|---|---|---|---|
| reach, early | `npm run inspect -- --seeds 50 --forge ring3 --region 2 --recipes act1 --form` | ≤ 5% of runs | "rare early" |
| reach, mid | `… --forge ring5 --region 4 …` | 15–35%, median wave ≤ 20 | the chase lands before or at the boss |
| reach, late | `… --forge ring6 --region 5 …` | 20–40%, median wave 15–19 | b-moments' "common by Region 5" |
| reach, no recipes | `… --forge ring6 --region 5 --form` | reported only | how much finding recipes matters |
| idle reach | `npm run pacing -- --idle --hours 12 --seeds 4` with the form report | ≥ 10% of Region 5 runs | "everyone can get it"; I9 not touched |
| reveal | `npm run pacing -- --hours 12 --seeds 8` reveal timeline | first Final Form inside the 46–47 min gap after hour 2 | I6 (read, not gated) |
| no drift | `npm run pacing -- --hours 12 --seeds 8 --fast` before and after F1–F4 | identical medians (cosmetic) | I1a, I1b, I3 |
| no drift | `npm run arsenal`, `npm run calibrate` | unchanged | I4, T2 |
| Act 2 | `npm run pacing -- --act2 --hours 12 --seeds 4` | Abyss and Boss Rush reach rate, reported | — |
| frame budget | `await tower.form(); await tower.bench({ enemies: 300, seconds: 6, tier: 'low' })` against the same without | `drawP95` +≤ 0.1 ms desktop; phone p95 frame ≤ 17 ms on `medium`, 4-weapon evolved, 3× | docs/performance.md |
| F5 only | `idle.ts` farm comparison and the I7 reading with `ultCharge: 0.25` | I5 still 1.15–1.5; I1b and I2/I8 in band | I5, I7, I8 |
| tests | `npm test`, `npm run typecheck` | green | — |

Today's probe (§1) puts Region 4 at 2/6 (wave 25) and Region 5 at 1/6
(wave 20). That's under the band and late, which is expected while the
suggestion doesn't chase. Every reach reading runs with Rifts off (02).
F0's 50-seed reading decides whether §3.4's lever
is needed.

## 9. Risks

- **Too rare to matter.** Under the suggestion it's 0–33% today, mostly at
  wave 20 or later. If F0 confirms that, idle players will rarely see it.
  Mitigation: the Tactician route, Rifts (02), and §3.4's lever as a last resort.
- **The name over-promises.** "Final Form" with 2 of 4 mounts evolved isn't
  "every weapon". Mitigation: the rule text says "two weapons", and the pips
  count to 2. The crown is the tower's, not the mounts'.
- **Ceremony collisions.** Evolve, a new draft, a boss intro or an elite
  toast can all land in one second. Mitigation: the queued 0.35 s beat, and
  the banner replacing (not stacking on) the evolve banner. Check on a
  `takeAll` with a ready evolution.
- **Clutter at 375 px.** At the default zoom the crown sits near the
  trophy ring. Mitigation: the radial layout in §4. Screenshot each frame
  at 375×812, fully out and fully in, with tier 7 and 18 trophies.
- **Phone cost.** It's untested on a phone (the P1 phone gate is still open,
  `docs/performance.md`). Mitigation: the budget in §5.3, and nothing baked.
- **Version collisions** with sibling plans on `PROFILE_VERSION` and
  `SNAPSHOT_VERSION`.
- **The seventh-slot pod overlap** (§3.5) shows up next to the crown. Fix
  `mountOffset` first.
- **If F5 ships:** humans reach Final Form more often than the bots, so the
  ult bonus is mostly an active edge. That's good for I7, but it pushes I5's
  1.5 ceiling.

## 10. Open decisions

1. **The trigger.** Two evolutions in a run (**recommended**: the only bar
   the draft supply reaches), the outline's every slot (unreachable: 0/42),
   or every slot plus more draft supply (a balance change well beyond this plan).
2. **Effect.** **Cosmetic in v1**, with `BALANCE.finalForm.ultCharge` at 0.
   Turn on 0.25 in F5 only if §8's readings hold and the HUD's ult ring
   shows it.
3. **Should the suggestion chase it?** **No in v1**. Revisit §3.4's 1.5×
   second-recipe bonus only if the idle reach rate in Region 5 is under 10%.
4. **Hub tower.** **The selected frame's crown, still and dimmed, once
   formed** (F4). The alternatives are nothing, or all six crowns at once
   (too busy).
5. **Anomalies (plan 04).** Settled with 04: **they count as evolved.**
6. **Boss Rush, the Abyss and its waypoints.** **Allowed, counted, no
   earliest-wave record.** A Rush run starts at level 16 and a waypoint at
   22–36, and Abyss waves run across floors.
7. **Should the record be the earliest wave or just "reached"?**
   **Earliest wave**, so a reached form still has something to beat.
8. **Fix the seven-slot mount wrap first?** **Yes**, as its own small fix
   before F2.
