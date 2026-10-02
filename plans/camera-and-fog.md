# The light, the fog and the camera

**Status:** 2026-10-02. Built, with one change from this note: the light
is an oval fitted to the stage (taken when a run starts, kept in the run)
rather than a circle, so its rim runs near the screen's edges as the old
arena did; `L` is its short half-axis. See docs/render.md. It came out of
a discussion about adding pinch and button zoom. That discussion showed zoom
is the smaller problem: the real one is that tower range outgrows the arena.

**How to read this:** §1 is the problem. §2 is the rule everything else
follows. §3 covers the light and spawns (game logic), §4 the fog (drawing),
§5 the camera and manual zoom. §6 lists what each part touches. §7 is how to
check it. §8 is what's still open.

`plans/rebuild.md`'s rules R1–R8 and invariants I1–I6 still hold. §3
touches pacing, so I1, I2 and I5 must be re-measured.

---

## 1. The problem

The arena is a fixed portrait ellipse with half-axes of 500 × 960
(`src/content/arena.ts`). Enemies spawn at 1.05× that, and the camera fits
the ellipse ×1.08 to the screen (`makeViewTransform`, `src/render/camera.ts`).
The oval *looks* like it follows the window, but it doesn't: `ARENA` is a
constant, tuned to a phone's portrait shape, which is why it reads as a
thin pill on desktop.

Range doesn't respect that ellipse:

- Base range is 380 (`src/content/balance.ts:14`).
- Several sources add range, and they multiply (`resolveStat`,
  `src/sim/stats.ts`): the Reach passive at +10% per level, three Forge
  "Range +5%" nodes at 5 levels each, a relic (+15%, +5% per rank) and a
  star (+10%). Late-game range goes well past 1000.

So in late game:

1. **The tower attacks enemies the player can't see.** Sideways, anything
   above about 525 range reaches enemies as they spawn, and those spawns sit
   at the screen's edge or off it. The range ring is drawn past the oval and
   the screen.
2. **Range past about 1000 does nothing,** beyond drawing bigger rings and
   longer shots off-screen.
3. **The default zoom has almost no margin** around a large range ring. Any
   zoom-out limit taken from today's view would be wrong from the start.

Zoom can't fix this. The world needs a rule that ties what the tower can hit
to what the player can see.

## 2. The rule

> **What the tower can hit ⊆ what's lit ⊆ what's on screen.**

Each layer has one owner:

| Layer | Lives in | Job |
|---|---|---|
| Range | game logic (existing) | How far weapons reach. Unchanged. |
| Light radius `L` | game logic (**new**) | A **circle**, the edge of the fog. Enemies spawn just inside the fog and walk out of it. |
| Camera | drawing only | Frames the scene. Reads `L` and never decides what's in play. |

`L` is part of the game logic, not a camera value, so the game stays
deterministic. A manual zoom-in (§5) shows less than the whole light circle,
by choice and purely for viewing. Off-screen enemies are still lit, still in
play and still fair.

## 3. The light and spawns (game logic)

- **`L = max(L_base, range + margin)`.** The range ring is always inside the
  light.
- **The arena becomes a circle.** `spawnPoint` takes its radius from `L`, a
  little into the fog band, instead of the fixed ellipse. Its callers are
  the waves (`src/sim/systems/waves.ts:426`) and the boss's emerge and
  summon logic (`src/sim/systems/boss.ts:63`, `:298`).
- **The spawn margin is small and constant** (spawn at about `range +
  margin`). Enemies come into range soon after leaving the fog. Late game
  already works like this today, so balance moves the least. The other
  option, spawn distance growing with range, makes range a strong defensive
  stat and needs a full rebalance. **Decision: small margin.**
- **`L_base` needs tuning.** In early game the oval gives a 960-unit walk
  vertically. A circle that fits a phone's width gives about 500 in every
  direction, so early game gets shorter approaches unless `L_base` goes up
  to around 650–700. A bigger `L_base` makes everything smaller on a phone:
  about 0.27 px per unit instead of about 0.34, and the enemy body sizes in
  `src/content/enemies.ts` were tuned for 0.34. Settle this with a pacing
  run (§7).
- **The fog elite aura** already shrinks range (`src/sim/systems/draft.ts:345`).
  It should shrink the light too: the fog closing in is the aura's look.
- As `L` grows during a run, the light pushing the fog back can be a small
  feedback moment ("the light grows"), with the camera easing out to match.

## 4. The fog (drawing)

- **Retire `bakeArena`** (`src/render/painters/arena.ts`). It builds an image
  at the canvas's pixel size and scale, so it is tied to the window and
  rebuilt on every resize.
- **Draw the ground and the fog in world units,** centred on the tower and
  sized by `L`. Build the image once at a fixed resolution, draw it scaled,
  and rebuild it only when `L` steps up. Window shape and zoom stop
  mattering. Soft gradients survive being scaled up 2× (§5), so the image
  doesn't need to be built at the close-up resolution.
- **Keep the purple.** It works better as the fog colour itself than as a
  thin rim line: a radial band from `L` to `L + band`, optionally with slow
  noise drift. The region's ground tint (`rebuild.md` §10.5) still colours the lit ground.
- **Draw order: ground → enemies, projectiles, effects → fog → tower UI.**
  The fog sits *on top of* enemies, so they fade in as they walk out of it.
  This replaces a visibility check with draw order: no culling code, no
  pop-in, and the game logic never knows what's drawn.
- **Thin lines are drawn live** (the distance guide rings, the range ring)
  so they stay sharp at any zoom.
- **On a portrait phone,** the circle leaves fog above and below, which is
  where the HUD sits. That suits the layout.

## 5. The camera and manual zoom

### 5.1 Framing

The camera holds one value: **how much world shows from the tower to the
short edge of the screen**, in world units. It's measured on the screen's
short axis: width on a portrait phone, height on a landscape desktop.

- **Fully zoomed in: about 270 units**, roughly 2× today's normal view,
  which shows about 540.
- **Fully zoomed out: `L` + the fog band**, the auto-fit view. There's no
  zooming out past the fog, because past it there's nothing.

The limits are world distances, not multipliers on the fit. That keeps
"close-up" meaning the same distance all run. If `L` reaches around 1100,
the zoom range simply widens to about 4×.

The world transform becomes: fit scale × user zoom × zoom punch. The punch
(`zoomPunch`) stays a multiplier on top, as it is now in `applyWorld`.

### 5.2 How auto-fit and manual zoom combine

- **At full zoom-out, the camera follows `L`:** when the light grows, the
  view eases out with it. This is the default and needs no input.
- **Once zoomed in, the camera keeps the player's framing** while `L`
  changes underneath. It only clamps if `L` drops below it, for example
  under the fog aura.
- **A small snap:** "nearly fully out" counts as "fully out" and resumes
  following.
- **Always centred on the tower, no panning.** At 270 the tower plus a fair
  band around it stays in view. This removes panning, pan limits and
  recentring entirely, and pinch midpoints are ignored.
- **With reduced motion on,** zoom changes are instant instead of eased.

### 5.3 Purpose and what zoom-in hides

Manual zoom is **for looking at enemies up close, not for a gameplay
advantage.** Zoomed in, enemies at the edge of the light are off-screen but
still in play. That's acceptable because the default view shows everything.

- No general off-screen markers.
- **One exception:** a small edge indicator pointing at the **boss** while
  it's off-screen, so a close-up never hides the most important thing on the
  field.

### 5.4 Input

| | Phone | Desktop |
|---|---|---|
| Gesture | Pinch (two-pointer tracking on the stage) | Wheel; trackpad pinch (`wheel` + `ctrlKey`, `preventDefault` so the page doesn't zoom) |
| Buttons | A "fit" chip, shown only while zoomed in | A compact `+ / −` pair in a corner of the stage, plus fit |
| Notes | The stage already has `touch-action: none`. The Capacitor WebView needs `user-scalable=no`. A second finger landing cancels a pending long-press (`src/ui/longPress.ts`). | |

The framing is saved in settings (`src/app/settings.ts`) as a world
distance. A new run starts with a small `L`, so the saved framing is clamped
to fit.

### 5.5 What stays the same size on screen

- **Range ring:** `paintRangeRing` (`src/render/painters/tower.ts:641`)
  uses `lineWidth = 2` and a `[14, 12]` dash in world units. Divide both by
  the current scale.
- **Shake:** it's in world units, so it looks stronger when zoomed in.
  Divide it by the user zoom.
- **Screen-space effects** (floating numbers and the like, drawn under
  `applyScreen`) must be placed with `worldToScreen` to follow the zoom.
  Check each effect.

## 6. What this touches

**Game logic (deterministic, affects balance)**
- `src/content/arena.ts`: the ellipse becomes `L_base`, a fog band and a
  spawn margin. `spawnPoint` takes a radius.
- A new derived value `L` in the run state, computed from `range`, and the
  fog aura applied to it.
- `src/sim/systems/waves.ts`, `src/sim/systems/boss.ts`: spawn through the
  new `spawnPoint`.
- Golden-number tests and pacing readings will shift.

**Drawing**
- `src/render/camera.ts`: fit to `L` instead of `VIEW_HALF_*`, add the user
  framing, its limits and the follow/snap behaviour. `VIEW_HALF_*` goes away.
- `src/render/painters/arena.ts`: the world-space light and fog layer
  replaces `bakeArena`.
- `src/render/renderer.ts`: the new draw order (fog over enemies). The
  background image is rebuilt when `L` changes, not on resize.
- **Sprite sharpness:** enemy sprites (`enemies.setScale`), boss and tower
  sprites, and anything else cached at a fixed scale, are cached for up to
  2× today's pixels per world unit. Step the cache (for example 1×, 1.5×,
  2×) instead of rebuilding during a pinch. Without this, close-ups are
  blurry, which defeats the feature.
- The range ring, shake and screen-space effects (§5.5).
- The boss edge indicator (§5.3).

**UI**
- Pinch and wheel handling on the stage. The desktop `+ / −` buttons, the
  mobile fit chip, and a settings field for the saved framing.

## 7. How to check it

- **The rule (§2), headless:** across a pacing run, no enemy is ever hit
  while outside `L`, and `range + margin ≤ L` on every tick.
- **Pacing:** re-run `npm run pacing -- --hours 12 --seeds 4` and the
  `--act2` reading. I1, I2 and I5 must still hold. Use this to settle
  `L_base` (§3).
- **Visual, at 375×812 and on a landscape desktop:** the fog is a circle
  regardless of window shape, enemies fade in out of it, and the range ring
  stays inside the light and stays thin and evenly dashed at 1× and full
  zoom-in.
- **Zoom:** pinch and wheel stay between 270 and fit. At full zoom-out the
  view follows a growing `L`; zoomed in, the framing holds. Close-up
  sprites are sharp. The boss indicator shows when the boss is off-screen.
- **Performance:** frame time on the low quality tier with the fog overlay
  drawn every frame.

## 8. Still open

- **`L_base`:** 500 (today's short axis) vs about 650–700 (keeps the
  early-game vertical walk). Decide by pacing run plus a look at enemy
  readability on a phone.
- **The fog band width and spawn margin:** how deep into the fog enemies
  appear, so they visibly fade in before they come into range.
- **The fog's look:** a static gradient vs drifting noise; cost on the low
  tier.
- **The zoom-in limit:** 270 is the starting value; adjust after seeing
  close-ups on a phone.
