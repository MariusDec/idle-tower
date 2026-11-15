# Final Form

Plan: [plans/late-game/07-final-form.md](../plans/late-game/07-final-form.md).
Evolve two weapons in one run (an anomaly counts) and the tower takes its
frame's Final Form until the run ends: a crown, a ceremony, a music layer
and a record in the Collection. Cosmetic: the sim's numbers are unchanged
while `BALANCE.finalForm.ultCharge` is 0.

**Built:** F0–F4, and the seventh-slot mount fix. F5 (`ultCharge` on) is a
knob at 0; §3.4's suggestion "chase" (`BALANCE.finalForm.chase`) is a knob
at 1 and is not read by the scorer.

## Where it lives

| Layer | File | What |
|---|---|---|
| content | `content/frames.ts`, `types.ts` | `FrameDef.form { name, text }`; feat goals `finalForm`, `forms` |
| content | `content/balance.ts` | `BALANCE.finalForm { need: 2, minSlots: 2, ultCharge: 0, chase: 1 }` |
| content | `content/lint.ts` | `forms`: every frame has one, name ≤ 3 words, text ≤ 15 |
| content | `content/feats.ts` | Final Form (any frame), Six Crowns (all six, after the Blight) |
| content | `content/mounts.ts` | `POD_ANGLES` has a sixth pod (under the drum): slot 6 no longer sits on slot 1 |
| sim | `sim/systems/form.ts` | `formNeed(config)`, `formCount(run)`, `checkFinalForm(run)` |
| sim | `sim/run.ts`, `state.ts` | `RunState.form { need, wave }`, fixed at `createRun`; `SimEvent` `finalForm` |
| sim | `sim/systems/draft.ts` | `applyCard` calls `checkFinalForm` after `evolve` and `anomaly` (forged hands and anomaly picks pass through here too) |
| meta | `meta/profile.ts`, `save/migrate.ts` | Profile v21 `forms: { [frame]: { wave, count } }`; snapshot 18 |
| meta | `meta/results.ts` | `recordForm`: count always; earliest wave in a region only (Abyss and Boss Rush add to the count); `RunSummary.finalForm` |
| meta | `meta/explainers.ts` | `forms` (Collection) opens once a recipe is found |
| ui | `ui/build.ts`, `hud.ts` | the crown chip with two pips, once `forms` has been told |
| ui | `ui/results.ts` | "Final Form · wave N" chip, NEW on a frame's first, RECORD on an earlier wave |
| ui | `ui/hub/collection.ts` | Frames page: "Final Form: Astral Spire · earliest wave 15 · ×4", or "Final Form: ?" |
| render | `render/painters/form.ts` | the six crowns, `FORM_ACCENT`; flat fills and strokes, angles precomputed |
| render | `render/painters/tower.ts` | `paintTower(…, form)`, halos in the accent; `paintRangeRing` solid in the accent |
| render | `render/renderer.ts` | the beat 0.35 s after the evolve spotlight: `formBurst`, zoom punch, banner (letterboxed on a frame's first), the crown's 0.8 s grow (0.4 s fade under reduced motion); Sunrise lifts the dark 15%; the hub's crown (`TowerLook.form`), still at 60% |
| app | `app/App.ts` | 0.9 s slow-motion at ×0.25, the first-per-frame toast, `music.setFormed`, dev `tower.form()` |
| audio | `audio/cues.ts`, `music.ts` | the swell and the six-note rise at `FORM_BEAT`; a triangle voice at the chord's third + 12 until the run ends |
| tools | `tools/inspect.ts` | `--recipes act1\|all`, `--frame <id>`, `--form` |

## Readings (2026-11-15, `inspect --seeds 50 --form`, active bot, Rifts off)

| Forge, region | Recipes | Reached | Median wave | Evolved at the end (0 / 1 / 2) | Plan's target |
|---|---|---|---|---|---|
| ring3, R2 | act1 | 0% | — | 7 / 43 / 0 | ≤ 5% |
| ring4, R3 | act1 | 0% | — | 25 / 25 / 0 | — |
| ring5, R4 | act1 | 22% | 25 | 10 / 29 / 11 | 15–35%, median ≤ 20 |
| ring6, R5 | act1 | 24% | 20 | 6 / 32 / 12 | 20–40%, median 15–19 |
| ring6, R5 | none | 0% | — | 23 / 27 / 0 | reported |
| ring6, R5, Artificer | act1 | 26% | 20 | 16 / 21 / 13 | — |
| all, R6 | act1 | 0% | — | 36 / 14 / 0 | — |

Rates sit in band for Regions 4–5; the waves are late (R4's median is 25,
past the boss; R5's is 20, one over). That is expected while the suggestion
doesn't chase (§3.4). The idle reach reading (`pacing --idle`) and the
reveal timeline were not run.
