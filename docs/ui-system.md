# UI System

**Files:** `src/ui/UIManager.ts`, `src/ui/HUD.ts`, `src/ui/UpgradePanel.ts`, `src/ui/AbilityPanel.ts`, `src/ui/PrestigePanel.ts`, `src/ui/TranscendencePanel.ts`, `src/ui/AutomationPanel.ts`, `src/ui/ResearchPanel.ts`, `src/ui/CodexPanel.ts`, `src/ui/StatsPopup.ts`, `src/ui/codexProse.ts`, `src/ui/WelcomeBackModal.ts`, `src/styles/main.css`

## Architecture

```
  UIManager
  ├── HUD (top bar, never changes tab)
  ├── UpgradePanel (Attack / Defense / Utility sub-tabs)
  ├── AbilityPanel (10 ability cards)
  ├── TalentPanel (4-branch talent tree)
  ├── PrestigePanel (Ascension card + AP perks)
  ├── TranscendencePanel (Transcendence card + TP perks only — automation moved out)
  ├── AutomationPanel (auto-buy strategy, reserve, target wave, toggles, "buys N/tick")
  ├── ResearchPanel (5-category research tree: combat / economy / arcane / scouting / research)
  ├── CodexPanel (in-game glossary of mechanics)
  ├── StatsPopup (post-run debrief / lifetime numbers)
  └── WelcomeBackModal (offline progress dialog)
```

## Nav groups and the two-level nav (UI plan §8.A)

`src/ui/navGroups.ts` is the **one** navigation table. Before it the app carried
two information architectures for one set of panels: an 11-entry flat tab strip
on desktop and an unrelated 4-entry bottom nav with a `'more'` bucket on mobile.
Both now read `NAV_GROUPS`, so a tab can only ever live in one place and adding
one is a single edit.

| Group | Icon | Tabs |
|---|---|---|
| `build` | `hammer-nails` | Upgrades, Abilities, Passives, Equipment |
| `research` | `bubbling-flask` | Research, Talents |
| `prestige` | `star-gate` | Prestige, Transcendence, Automation |
| `progress` | `progression` | Journal, Progression, Codex, Achievements, Stats |
| `system` | `cog` | Settings |

The module also exports `GROUP_OF` (a reverse index built once at module load),
`groupById`, `firstTabOf` and the `isPanelTab` narrowing helper used on values
coming back out of `localStorage`. `tests/content-coverage.test.ts` asserts every
`PanelTab` appears in exactly one group, every group has at least one tab and a
valid `IconId`, and every `BottomNav` item id is a `NavGroupId`.

**Desktop: rail + sub-strip.** `renderRail()` builds a five-button `.panel-rail`
on the panel's leading edge, once — the group set is static, so only the active
class and the badge text change afterwards. `renderSubStrip(group)` renders the
active group's tabs above the content as `.tab-btn`s, and hides itself entirely
for a one-tab group, where the strip would be a row of chrome repeating what the
rail already says.

**Mobile: bottom nav + sheet.** `BottomNav` is built from the same
`NAV_GROUPS.map(...)`; selecting a group opens `MobileSheet` on that group's
tabs, rendered as a segmented control in the sheet header.

**Selection state.** `UIManager` keeps `activeGroup` (always `GROUP_OF[activeTab]`)
and a `lastTabPerGroup` map, so returning to a group reopens the tab you left it
on rather than snapping back to the first. `showGroup(g)` is therefore just
`showTab(lastTabPerGroup.get(g) ?? firstTabOf(g))`. `showTab(id)`:

1. sets `activeTab` and derives `activeGroup` from `GROUP_OF`;
2. records the tab as the group's last selection;
3. persists it to `localStorage` (restored on boot through `restoreNavTab()`,
   guarded by `isPanelTab`);
4. re-renders the sub-strip for the group;
5. clears `contentRoot`, mounts the panel's DOM, and calls `update()` with the
   latest state.

## The card primitive

`.card` in `main.css` is the shared row used by every list panel: a three-column
grid of `icon | text | action` over `--surface-2` with a `--radius-lg` border.
State is carried by data attributes rather than by classes, and — deliberately —
has to read without colour, because affordability is what a player scans a whole
panel for:

| Attribute | Effect |
|---|---|
| `data-afford='yes'` | default |
| `data-afford='no'` | the action dims to 0.55 **and** disables; the cost gets a dotted underline instead of turning red |
| `data-afford='maxed'` | border takes `--good`, the cost disappears, the action collapses to a check |
| `data-evolution='near'` | an `--accent-2` corner ribbon on the card itself |

## The modal shell (UI plan §8.F)

`src/ui/Modal.ts` is the one shell. It replaced three independent ones
(`welcome-modal*`, `blessing-modal*`, `wave-mod-modal*`) plus `KeybindsOverlay`,
each re-implementing backdrop, visibility transition and dismissal, and none of
them trapping focus. Adopters now own their **content** only: they render into
`modal.body`, keeping their existing content classes so their layouts survive
the move.

- **Structure.** `.modal[data-modal=id] > .modal-backdrop + .modal-card`, the
  card carrying `role="dialog"`, `aria-modal="true"`, `tabindex="-1"` and
  `aria-labelledby` pointing at its own `.modal-title`. Width comes in as
  `--modal-width`.
- **Mount point.** `#modal-root` by default, falling back to `document.body`.
  Not in the plan's sketch, but every adopter is handed a `modalRoot` by
  `main.ts` and mounting elsewhere would put the card outside the overlay
  stacking context.
- **Focus.** `open()` remembers `document.activeElement`, focuses the first
  focusable node (or the card), and `close()` returns focus where it came from
  if that node is still connected.
- **The Tab trap.** `focusableNodes()` queries a `FOCUSABLE` selector whose
  `:not([disabled])` filters matter — a disabled reroll button is still in the
  DOM and would otherwise swallow a tab stop — and filters on
  `offsetParent !== null`. Tab from the last node wraps to the first,
  Shift+Tab from the first wraps to the last.
- **Escape and stacking.** A static `openStack` holds every open modal,
  innermost last; only the top one reacts to a key, so a picker opened over a
  debrief does not close both on one Escape. `dismissible: false` opts out of
  both Escape and the backdrop tap.
- **`Modal.anyOpen()`** is what lets `UIManager.isModalOpen()` stop being a
  hand-maintained list of names: a new modal answers the Space-binding gate by
  existing.

## Modal countdowns and the wall-clock tick

Cross-cutting rule 1 (UI plan §1): **nothing blocks on a modal forever**.
Three modals have a countdown that resolves the modal on its own when the
player walks away:

| Modal | Timeout | Resolves to |
|---|---:|---|
| `BlessingDraftModal` | `BLESSING_DRAFT_TIMEOUT_SECONDS` | Auto-pick the recommended blessing |
| `CorePickerModal` | `CORE_PICKER_TIMEOUT_SECONDS` | Keep the current core |
| `RunFailedModal` | `RUN_FAILED_TIMEOUT_SECONDS` (20 s) | Retry the wave |

All three share the same shape:

- A `tick(realDt)` method on the modal class, called every frame from
  `Game.update` (or, for `RunFailedModal`, from `Game.tickWallClockSystems`).
- A countdown strip rendered with the matching `*-countdown-track` /
  `*-countdown-fill` / `*-countdown-text` CSS classes.
- Wall-clock driven, not simulation-clock driven — at 4.5x speed a 20 s
  game-time deadline would fire in three real seconds, which is not enough
  time to read the cards and decide.
- `hide()` drops `callbacks` before invoking them, so a manual click that
  re-enters `show` lands on a fresh instance rather than this one's leftovers.

### The wall-clock tick itself

`Game.loop` runs `update(gameDt, dt)` only while `!runFailed`, but
`tickWallClockSystems(dt)` runs unconditionally:

```ts
const gameDt = dt * speed * slowMo;
if (!this.runFailed) this.update(gameDt, dt);
this.tickWallClockSystems(dt);  // ← always
```

`tickWallClockSystems` currently holds two things that must keep moving
while the run-over prompt is up:

- `ui.tickRunFailedModal(realDt)` — so the 20 s countdown reaches zero on
  the player's clock even when the wave is dead.
- Research progress + passive RP gain — the research tree is wall-clock
  already (`realDt`), and a player who walks away from the prompt must come
  back to in-progress research, not a frozen one.

Save cadence, achievement checks and audio are still inside `update` —
they make sense only while the player is engaged with the run.

## The quality control (UI plan §9.D)

`SettingsPanel` renders a segmented `Auto / High / Medium / Low` control
(`aria-label="Graphics quality"`), plus a hint line. `Game` pushes the live value
back in through `SettingsPanel.setQuality(pref, currentTier)`, so the panel can
never disagree with `Game.qualityPreference` — which matters because under
`'auto'` the 2-second probe may have demoted the tier out from under the
displayed preference, and the hint is what makes that visible. Picking an
explicit tier disables the probe permanently for that device. The tier table and
the probe's rules are in [performance.md](performance.md); the per-tier profile
is `src/data/quality.ts`.

## Portrait phones (UI plan §9.B)

A 9:16 phone already gets a correct field of view from the camera's aspect
clamp; what was broken was the chrome around it. Two `@media (orientation:
portrait) and (max-width: 768px)` blocks in `main.css` fix it:

- **The sheet goes full height**, at `calc(100dvh - var(--safe-t))` — `dvh` and
  not `vh`, because `vh` on iOS includes the retracting browser chrome and the
  ability dock would clip behind the gesture bar. Its header pads to the left
  and right safe areas, and its segmented buttons lift to the §9.C 44 px floor.
- **The HUD moves to two rows.** The ≤768px branch laid `.hud` out as a flex
  column, giving each resource bar a row of its own: 267 px of HUD at 375×812,
  a third of the phone, against a `--hud-height-mobile` token still claiming
  90 px. A three-column grid seats them side by side without touching the
  markup — the wave/chips group spans row one, hp / mana / xp share row two.
  The written bar labels are visually hidden but stay in the accessibility
  tree, because unlike a chip a bar carries no `aria-label` of its own. This
  block must stay *after* the ≤768px block: same specificity, so source order
  decides.

## Talent Panel (`TalentPanel.ts`)

CSS Grid layout: `grid-template-columns: 30px repeat(5, minmax(46px, 1fr))` —
a 30px gutter column for gate chips, then 5 columns for the 3 node columns
plus spacing.

**Gate chips** sit in the gutter at each gated row (rows 2-5), showing the
branch point requirement (4, 12, 22, 32).

**Elbow (orthogonal) SVG links** connect prerequisite nodes. An SVG layer
(`talent-link-layer`, `pointer-events: none`) draws rounded elbow paths between
parent and child nodes. Geometry is measured with `getBoundingClientRect()`
relative to the grid and recomputed on mount, `ResizeObserver`, and tab switch.

**Five node states**, distinguished by glyph and CSS class:

| State | Glyph | CSS class | Meaning |
|---|---|---|---|
| maxed | ★ | `is-maxed` | All points invested |
| spent | ✓ | `is-spent` | Some points, can allocate more |
| available | ○ | `is-available` | Can allocate now |
| gated | (number) | `is-gated` | Branch-point gate not met |
| locked | 🔒 | `is-locked` | Prerequisites not met |

**Sticky detail card** at the bottom of the panel. Shows selected node's icon,
name, rank (`current / max`), description, effect deltas (Now → Next), blocked
reason, and a Learn button.

**Interaction**: click a node to select it (detail card updates), click again to
allocate. Hover previews the detail card. Keyboard: arrow keys navigate the
grid, Enter/Space allocates, Escape deselects.

**Keystone row** (row 5) is marked "Choose one" — the three keystones per
branch are mutually exclusive (`exclusiveGroup`).

**Overflow divider** separates the main grid from the endless node, labeled
"Overflow — no limit". The endless node has `maxPoints: 999`.

## Automation Panel (`AutomationPanel.ts`)

Owns the third tab of the `prestige` nav group (label "Automation"). It
was carved out of `TranscendencePanel` in plan §4 so the four automation
toggles, the auto-buy strategy chips, the gold-reserve slider and the
target-ascend-wave input all sit on a panel whose only job is *how the
game runs itself*. The Transcendence panel now carries the TP perk tree
and nothing else.

Layout, top to bottom:

- **Auto-Buy block.** One toggle (`autoBuy`), a three-way strategy
  segmented control (`cheapest` / `balanced` / `damage`), a 0–50% reserve
  slider (held-back gold, a fraction the auto-buyer must leave behind),
  and a live "Buys N upgrades per tick" line. **N** is read from
  `AutomationPanelHandlers.getAutoBuyCount()` — which routes to
  `PrestigeManager.getAutoBuyCount()` — every UI tick, so it reflects
  the Auto-Upgrader perk level (1/2/3) the instant the player buys a
  level. When auto-buy is not unlocked at all, the line collapses and
  the strategy / reserve controls are dimmed.
- **Auto-Cast block.** One toggle (`autoAbilities`). The per-ability
  opt-out lives on each ability card in the Abilities panel, so the
  Automation panel does not list them.
- **Auto-Ascend block.** One toggle (`autoAscend`) plus a target-wave
  stepper. The stepper reads and writes `targetAscendWave` on `Game`.
- **Auto-Transcend block.** One toggle (`autoTranscend`). No per-target
  setting — `AutomationManager.runAutoTranscend` fires the moment
  `ap >= 100`.

All four toggles key on `AutomationPanelHandlers.isAutomationUnlocked(key)`,
so an upgrade the player hasn't paid for shows the toggle but reads as
locked; the `UI Callback Wiring` setters below carry the writes back
into `Game`.

The strategy labels and the per-strategy hint copy are constants in
`src/ui/AutomationPanel.ts` (`STRATEGY_LABELS` / `STRATEGY_HINTS`), not
rendered from the data layer — the strategy is a *preference*, not a
thing a player unlocks.

## Codex prose helper (`src/ui/codexProse.ts`)

`CodexPanel` and `StatsPopup` share a small prose helper:

- **`friendlyTermName(raw)`** — maps an internal identifier
  (`focusStackBonus`) to the player-facing label from
  `STAT_ROW_BY_KEY[raw].label` (`"Focus Bonus"`). Anything the stat row
  table does not know falls back to a de-camel-cased form, with the
  common acronyms (`HP` / `XP` / `RP` / `DPS` / `AOE`) upper-cased so they
  match the rest of the game.
- **`setProse(host, text)`** — writes `text` into `host`, swapping every
  embedded camelCase identifier for a `<span class="codex-term">` whose
  text is `friendlyTermName(id)` and whose `title` is the raw id (so a
  hover reveals the source-of-truth key). The regex is deliberately
  narrow — needs a lowercase start *and* an interior capital — so
  ordinary English words never match.

`CodexPanel` (the in-game glossary in the `progress` group) renders its
descriptions through `setProse`; `StatsPopup` (the lifetime-numbers
modal) renders its humanised metric names the same way. The
`codex-term` styling lives in `main.css`.

## UI Callback Wiring

Callbacks are set from `main.ts` via setter methods on `UIManager`:
- `setOnBuyUpgrade` → `upgradeManager.buy(id)`
- `setOnCastAbility` → `game.castAbility(id)`
- `setOnAscend` → `game.ascend()`
- `setOnTranscend` → `game.transcend()`
- `setOnSpendAP` → `game.spendAP(perkId)`
- `setOnUnlockResearch` → `game.unlockResearch(id)`
- `setOnToggleAutomation` → `game.setAutomationEnabled(key, enabled)`
- `setOnTargetWaveChange` → `game.setTargetAscendWave(wave)`
- Speed/wave controls → corresponding Game methods

## API Interfaces

UI reads state through cached API interfaces (set via setters, refreshed in `syncUiApis`):
- `AbilityAPI`: canCast, reasonBlocked
- `PrestigeAPI`: canAscend, canTranscend, previewAP, previewTP, canSpend, automation checks
- `ResearchAPI`: rp, unlocked, reasonBlocked
- `SpeedAPI`: speeds, currentIndex, maxIndex
- `WaveControlAPI`: autoProgress, currentWave, isIntermission

## HUD Components

UI plan §7. Three vocabularies — chips, bars and the wave header — plus the
speed stepper and the two stat popups.

| Element | Reads | Notes |
|---|---|---|
| Gold / Kills / DPS chips | `resources.gold`, `stats.enemiesKilled`, smoothed DPS | icon + caption + display-face value |
| Tower HP bar | `tower.hp / maxHp` | critical at ≤40% |
| Mana bar | `resources.mana / maxMana` | locked until wave 10 |
| Tower XP bar | `towerXp` | level badge in the head |
| Wave header | `wave.number`, `PacingHudData` | focal number, boss state, threat marks, controls, risk dial |
| Speed stepper | `SpeedAPI` | right-hand group |
| FPS | written by `Game` into `getFpsEl()` | a diagnostic, styled as a lesser citizen |

### The DPS readout

The DPS chip and the Stats tooltip's DPS row read the **same smoothed
value**: a 10 s EMA of real damage dealt, composed per frame in
`UIManager.update`. The tooltip renders that value directly; the chip tweens
toward it per frame (τ = 0.2 s) and writes its text every frame rather than on
the throttled `update()`, so the number eases instead of stepping at 10 fps.
The `setText` cache keeps a settled value at zero DOM writes.

The EMA freezes through an intermission — the 10 s damage window drains to
zero after the last hit, and tracking that would show the tower "losing" DPS
it still has. After the wave resumes there is a 3 s ease hold, then a 10 s
refill window during which the reading only tracks **up**: an early window
under-reports the true rate, so chasing it down would dip the pill below the
value it held and drag it back up as the window filled. The HUD target is
pushed at a fast cadence (250 ms) while the reading is moving and a slow one
(3 s) once it settles, so the tween always has a fresh target.

Under 10 the readout always carries one decimal (`5.0`, not `5`) via
`formatWithOptionalDecimal`'s `keepTrailingZeros` option, so a whole-number
rate is visibly a rate and not a count.

### Resource chips (`.hud-pill`)

`HUD.addPill` builds icon + caption + value; `HUD.setPillValue` writes it. Two
pieces of motion, and they say different things:

- **the tick** fires whenever the resource goes up;
- **the flare** fires only when the gain is worth ≥12% of what was already there
  — proportional, because "a lot of gold" means something different at wave 3
  and at wave 300.

DPS gets neither: it is a rate, and a rate drifting up every frame would flicker
continuously without marking anything the player did. Its motion is the
per-frame tween described above instead — the number eases between readings
rather than jumping.

Gain detection reads the **authoritative** state number, not the tweened display
one. The tween lags by a few frames, so detecting on it re-fires the tick for
every frame the number spends easing towards its target.

Both animations exist twice under two class names that alternate. That is what
restarts them on a repeat gain; the usual `offsetWidth` read forces a
synchronous layout on every gold pickup. The same trick is used by the bar
pulse, the ability ready-flash and the boss phase flash — if you see an `-a` /
`-b` class pair in this part, that is why.

On a phone a chip drops its written caption and keeps its mark. The name stays
as an `aria-label`.

### Bars (`.hud-bar-block`)

One `HUD.makeBar` and one rule set for HP, mana and XP. Beyond the fill:

| Part | What it answers |
|---|---|
| Gradient lit along the top edge | makes the bar a surface, not a coloured rectangle |
| **Ghost** | "how much did that hit take", as a length |
| Segment ticks at each 25% | at HUD size, 61% and 74% are the same bar without them |
| **Threshold pulse** | the frame the reading changed meaning |

The ghost's hold is re-armed by every further drop, so a tower under sustained
fire keeps it pinned and only pays it out once the hitting stops — the read
wanted is the damage from *this* exchange. XP suppresses it: XP wraps to zero on
a level-up, and a trail across the whole bar would read as a loss.

Fills and ghosts run on the per-frame `tickDisplay`, not the throttled `update`.
The fill is already smoothed by the number tween, so a CSS width transition on
top of it double-smoothed and visibly lagged a hit; and a ghost stepping at
10 fps is a stutter, not a trail. The caching `dom` helpers keep a still bar at
zero writes. Each bar seeds itself on its first real reading — without that,
mana on a fresh save opens the run with a full-width ghost draining away.

HP's critical state is **`--fx-critical`**, never `--bad`: Part 2 split those so
this surface could out-shout a Clear Save button rather than match it. It also
carries hazard stripes, because colour alone puts the whole signal on one axis.

### The wave header (`.hud-wave-block`)

The wave number is the focal element — `--font-display` at `--text-7xl`, tabular
— with step chevrons flanking it and everything that *qualifies* the wave
arranged around it on one grid: state, threat, controls, risk dial, momentum.

`focal`, `side` and `controls` are direct children of that grid, which is what
lets the phone layout drop the controls to a full-width row underneath instead
of squeezing five controls into the 200px left beside the number.

Boss-wave state reads off `isBossWave` — the same predicate `WaveManager` spawns
from, so the header and the spawner cannot disagree about what wave 40 is.

The **threat marks** are the coming wave's named types as icon+count chips, from
the enemy table's own icons. Trash is counted and never named, exactly as the
arena overlay does it. The row rebuilds only when the composition signature
changes, so an intermission does not re-create a dozen `<svg>`s ten times a
second. The arena's `PacingOverlay` keeps the readable sentence next to the
spawn arrows it describes; the header is the glance in the persistent chrome,
and on a phone it stands down rather than saying the same thing twice.

The **risk dial** lives here rather than beside the speed stepper: risk is a
statement about the next wave, so the number it prices should be on screen with
it.

## Canvas overlays

`#overlay-root` sits over the canvas and is `pointer-events: none` by default;
each overlay opts back in. Two live there:

| Overlay | File | Shown when |
|---|---|---|
| Run-stalled banner | `RunStalledBanner.ts` | A wave has overrun and started enraging |
| **Boss bar** | `BossBar.ts` | Any boss is alive |
| **Placement prompt** | `PlacementPrompt.ts` | An ability is armed and waiting for a click |
| **Pacing overlay** | `PacingOverlay.ts` | A combo is live, or an intermission is running |

The boss bar (gameplay plan §3.5) is the readout for the whole boss encounter:
tier name, HP with phase pips at 66/33%, the bulwark shield overlay, the active
pattern and its answer, the slam telegraph countdown, and the enrage or
swift-kill clock. `Game.frameUpdate` resolves it from the lead boss and pushes
it via `UIManager.setBossBarData`; passing `null` hides it. See
[boss-encounters.md](boss-encounters.md#the-boss-bar).

### The placement prompt and the reticle

A press on a **targeted** ability (Rain of Arrows, Frost Nova, Chain Lightning, Rocket Barrage,
Meteor Strike) *arms* it rather than casting it, and the next canvas press places it. That is a
modal input state — the next press means something different from usual — and the one thing an
input state must never be is invisible.

`PlacementPrompt` is a strip near the top of the arena. The copy is pointer-dependent, because the
idiom is:

- fine pointer — `Click to place {Ability} — Esc to cancel`
- coarse pointer — `Drag to aim {Ability}, lift to cast — tap the tile to cancel`

The hotkey is deliberately *not* in the string: it is already on the tile and in the keybinds
overlay, and the line was long on a phone. The strip is `pointer-events: none` and deliberately not
a dialog — the simulation keeps running while the player decides, because stopping the game to ask
where the meteor goes would break the idle contract.

**Touch is drag-to-aim.** While an ability is armed, `touchstart` does not press — it only tracks,
so the disc follows the finger and the cast resolves on `touchend` via `commitPlacementAtPointer`.
A finger that never lifts over a valid spot never casts.

**The reticle follows the pointer**, not the last press: `Game.setMouseInput` tracks hover
unconditionally, and `mouseleave` / `mouseenter` raise and drop a `pointerOnCanvas` flag so the disc
hides rather than sticking at a stale point. `Renderer.drawPlacement` draws a filled disc, a
rotating dashed rim, an inner pulse ring (which makes a radius change legible) and a crosshair, all
sized through `entity()` so they scale with the camera.

Two states ride on it:

- **Validity.** With at least one targetable enemy inside, the reticle takes the ability's own
  colour. An empty disc flips to `FX.blood` — the whiff the empty-disc refusal will reject is
  visible *before* the click, not after.
- **A count badge** above the rim showing how many enemies the disc currently covers, so two
  candidate spots can be compared without counting heads.

The **ability bar** mirrors the state: an armed tile carries `is-arming`, and targeted abilities
carry a crosshair glyph so the player knows which presses will arm before pressing one.

`Game` drives the prompt through `UIManager.setPlacementPrompt(text | null)`, and every path that
leaves placement mode — Escape, the hotkey, a wave transition, an ascension, a successful cast —
clears it. A *refused* cast keeps the prompt up and toasts instead. See
[loot-system.md](loot-system.md#targeted-abilities).

## Corner overlays: the milestone strip and the contract tracker

Two fixed elements share the bottom-left corner, both appended next to the HUD
root rather than inside it (`HUD.renderMilestoneStripSlot` /
`HUD.renderContractTrackerSlot`) — the HUD bar's layout has nothing to say
about a corner overlay.

The **contract tracker** (gameplay plan §5.3) owns the corner: three rows of
`name · 12 / 40` over a progress fill, with the reward on the right. The
**milestone strip** sits directly above it, its `bottom` offset by
`--contract-tracker-height` (96px — the tracker is always exactly three rows,
so a constant beats measuring). The mobile branch applies the same offset on
top of the ability bar and bottom nav, and drops the reward column so three
rows still fit a phone.

Tracker rows key on the contract's **instance id**, so a completed row can
flourish in place while its replacement slides in underneath — including when
the replacement is the same contract drawn again. The flourish is driven by the
`contract_reward` event rather than by a row disappearing: an ascension and a
save load also empty the tracker, and neither deserves a celebration. See
[contract-system.md](contract-system.md#ui).

### The Journal tab and the Long Watch corner chip

A third corner overlay, owned by `src/ui/JournalStrip.ts` (plan §6.5), sits
one row above the milestone strip and shares the corner layer (`--z-corner`)
with it. Reading top-down, the bottom-left stack now reads:

```
contract tracker    (--corner-stack-base)
milestone strip     (--contract-tracker-height above the base)
Long Watch chip     (--contract-tracker-height + --milestone-strip-height)
```

The chip itself shows the active chapter's number, name, and a progress
bar that is the mean of the chapter's three objective fills. A click
opens the Journal tab on desktop, or the `progress` sheet on mobile
(which lands on the Journal tab as the first entry of that group). The
pulse flourish is the same `@keyframes milestone-pulse` the milestone
strip uses, so there is one animation to tune. Like the milestone strip
the chip hides itself entirely when every chapter is done — the
celebration is the modal, and a perpetual "12 / 12" pill in the corner
would just be dead pixels.

**Deliberate mobile hide.** The chip is `display: none` on the
`@media (max-width: 768px)` block, for the same reason the milestone
strip's hover-flyout was retired: three stacked chips in a phone's
bottom-left corner eats the play area, and the precedent (see
[milestones.md](milestones.md)) is to drop the chip rather than resize
the play area to fit. The Journal tab is still reachable one tap away
in the `progress` group on the bottom nav, and the chapter-complete
modal still fires on mobile so the player learns the chapter is done —
they just have to want to see the next one badly enough to open the
sheet. See [watch-system.md](watch-system.md#ui).

The **Journal tab** (`src/ui/JournalPanel.ts`) is the campaign's home
and lives in the `progress` group of `NAV_GROUPS` as its first entry,
label "Journal" — so the tab is one tap away on mobile. Five surfaces,
top to bottom: a header with `X / 21 chapters`; the **active** chapter
card (accent border, three objective rows with progress bars, reward
strip); the **next up** card (half prominence, names the upcoming
chapter and its reward); the **completed** list (newest first, one row
per chapter with its unlock name); and **the road ahead** (the
remaining chapters as one-line rows). The view model is
`Game.watchInfo()` → `UIManager` → `JournalPanel`; the panel rebuilds
the DOM only when the *signature* changes (active chapter, completion
state, goal-met flags) and updates progress numbers in place every UI
tick. See [watch-system.md](watch-system.md).

## Things drawn on the canvas rather than in the DOM

Two Part 4 readouts live in `Renderer` rather than in an overlay, because both
track the cursor and a DOM element chasing the pointer would lag the canvas by
a frame:

- **The charge ring** (§4.2) — a ring at the cursor with three states: filling
  while the hold builds, bright and pulsing once the shot is armed, and dim and
  draining while it is on cooldown. `Game.chargeSnapshot()` resolves it from
  `ChargeTracker`; it is absent entirely when the button is not held.
- **The placement disc** (§4.3) — a dashed, rotating ring at the cursor at the
  ability's radius, with a crosshair, showing exactly what the next click will
  cover.

## The battlefield: ground, tower, range ring, portals

UI plan §3. Owned by `src/game/Renderer.ts` and `src/data/tower.ts`
(`TOWER_VISUAL`); every colour comes from `src/data/palette.ts`.

### The discipline first

Everything below obeys one rule, the one `getEnemySprite` already established:
**if it is static per variant, it is baked into an offscreen canvas once and
blitted afterwards.** A `createRadialGradient` or a `shadowBlur` inside a
per-frame loop is a bug, not a style choice. `Renderer.part(key, size, paint)`
is the single memoised sprite factory the whole part goes through; a full run
lives inside about a dozen sprites.

Measured in-browser at a 1520×860 backing store with 261 enemies and ~250
particles on screen: `Renderer.draw` p50 **1.7 ms**, p95 7.7 ms; the whole loop
(simulate + draw + UI) p50 3.2 ms, p95 8 ms. Baking the ground costs ~5 ms and
happens on a resize or a core change, never in a steady frame.

### The ground, in three baked layers

Composited into one offscreen canvas keyed by `(backing-store size, world
scale, core id)`, blitted 1:1 in device space. It replaces a two-stop radial
gradient plus an 80 px grid at 4% white.

1. **Far field** — a tinted vignette so the arena has a centre and a periphery,
   a weak wash of the run's core colour around the tower, and a seeded field of
   stars and embers at a fixed density per unit area.
2. **Terrain** — a 128 px seeded noise tile filled as a `createPattern` at two
   different context scales (a per-pixel pass over the whole backing store would
   be three and a half million writes on every resize), a handful of large soft
   blotches so the floor has geography, and short cracks radiating out of the
   tower's footing.
3. **Lattice** — concentric arcs and radial spokes **centred on the tower**, so
   the floor's geometry points at the tower from anywhere in the arena. It fades
   out at `ARENA_RANGE_CAP × 1.18` — the furthest any build's range can ever
   reach — rather than at the current `range`, because a lattice keyed on
   `range` would re-bake on every upgrade purchase for a boundary the range ring
   already draws.

Seeding is `mulberry32` over `(size, core)`, so the same viewport always bakes
the same world; `Math.random` would redraw the floor on every resize.

### The range ring

The most important non-entity element on screen, and it was a 1 px dashed
circle at 6% white. Four parts, tinted by the run's core:

| Part | How it is drawn |
|---|---|
| Falloff annulus | One cached sprite of a normalised disc, scaled to the radius. "In range" is a readable *region*, not a line. |
| Crisp rim | A plain stroked arc, so it stays ~2 px at any range. A scaled sprite would thicken as range grew. |
| Sweep | Seven trailing arc strokes rotating at 0.5 rad/s. No allocation. Static under `prefers-reduced-motion`. |
| Change bloom | On a new resolved `range`, the radius eases over **400 ms** (`easeOutCubic`) and a ghost ring blooms outward for 750 ms. |

The ease is the point: buying `Longbow` used to move a nearly invisible line by
three pixels between two frames.

### The tower

`TOWER_VISUAL` carries the geometry and the palette; `Renderer` composites it.
One key light (`TOWER_VISUAL.lightAngle`, up and slightly left) drives every rim
light, band highlight and cast shadow, which is most of what separates "drawn"
from "assembled from primitives".

Split across two passes, along the line where the tower stops being part of the
floor and starts being an object standing on it:

- `drawTowerBase` — cast shadow and stone plinth, **before** the enemies, so a
  mob at contact range walks over them.
- `drawTowerTop` — masonry drum, battlements, tier detail, crystal glow, turret,
  crystal, **after** the enemies, so the player's tower is never occluded by the
  things attacking it. (Previously only the roof was on top and the body was
  under, so enemies overlapped the tower.)

**Detail tiers** come from the tower-XP level via `TOWER_VISUAL.detailTiers`
(`0 / 10 / 25 / 50`), passed through `RenderSnapshot.towerLevel`:

| Tier | Level | Adds |
|---|---:|---|
| 0 | 0 | one masonry course, 8 merlons |
| 1 | 10 | a second course, 12 merlons |
| 2 | 25 | amber banners, turret side vanes, a third barrel band |
| 3 | 50 | a slowly rotating arcane ring in the core's colour |

**The core crystal** is the only place a run's core is visible during play. It
is tinted by `CORE_BY_ID[coreId].color` (via `RenderSnapshot.coreId`) and
charges over the shot cadence — `1 - cooldown × fireRate` — so a tower with fire
rate visibly beats faster than one without.

**The turret** rotates to whatever the tower is shooting, kicks back on firing
and flashes at the muzzle. The heading is read off the projectiles themselves:
every projectile in the game leaves the tower, ids come from a monotonic counter
and the list is append-ordered (both managers prune with `filter`, which
preserves order), so "is there an id above the last one I saw, starting at the
tower" is an exact read of "did we fire, and where at" — without the simulation
carrying a presentation field or the renderer keeping a second copy of the
targeting rules. While the pointer is held the barrel tracks the cursor instead.

**Wall and shield** keep their behavioural reads and gain a shape:

- The wall is a ring of `TOWER_VISUAL.wallSegments` (16) stone blocks that go
  `full → cracked → rubble → gone` in order as `wallHp` drops. Three cached block
  sprites, up to sixteen rotate-and-blits. Previously two stroked circles whose
  width and alpha tracked the ratio, which made a breach a non-event.
- The shield is a six-facet hex barrier; an absorb lights the facets unevenly
  (a deterministic per-facet offset) rather than pulsing the whole ring. Charges
  are countable orbiting pips. This pass previously allocated a fresh
  `createRadialGradient` **per pip per frame**.

### Spawn portals

`RenderSnapshot.spawnLanes` (the real pre-rolled spawn points) opens a rift at
each lane during the intermission — one cached sprite, scaled on its short axis
as it widens, with a rotating ember swirl over it. The **threat arrow is kept
exactly**: it is the only thing that says which way the wave is coming from.

Arrivals are caught renderer-side: an enemy id above the watermark, appearing at
a normalised ellipse radius ≥ `0.88`, gets a 0.4 s rift flare and an expanding
ground dust ring at the point it appeared. The ellipse test is what keeps
splitter children and mid-field summons — which did not walk out of a portal —
from being given one. The list is pooled and capped at 64.

This is what makes on-screen spawning at `ARENA.spawnRingScale` = 1.04 read as
intentional rather than as things popping into existence.

### Reduced motion

Everything that *loops* — the crystal's breath, the range sweep, the tier-3
arcane ring, the rift swirl, the shield's drift — holds still under
`prefers-reduced-motion`. Event-driven motion (the recoil, the range bloom, a
rift opening, an arrival) stays: it is feedback for something that just
happened, and removing it removes information rather than motion.

## Frame Update (`UIManager.update`)

Called every frame from `Game.loop`:
1. Updates the ability bar and the **boss bar** — both *above* the throttle
   below, because both animate continuously and a 2 s slam countdown read at
   10 fps visibly stutters
2. Updates HUD with fresh state
3. Updates active panel if mounted
4. Computes DPS: `expectedHit * fireRate`, averages over 30 samples, updates HUD every 0.5s

`tickDisplayHud` additionally runs the milestone strip's and the contract
tracker's presentation clocks on wall-clock `dt` — the latter is what drains a
completed row's flourish.

Everything after step 1 is throttled to every 6th frame. The caching helpers in
`utils/dom.ts` (`setText` / `setStyle` / `toggleClass`) make an unchanged frame
cost nothing, which is what lets the un-throttled overlays run every frame.

## CSS

Two files, and the order matters:

- **`src/styles/tokens.css`** — the design token layer, imported first from
  `main.css`. Every colour, radius, duration, font size and elevation the app is
  allowed to use, plus the self-hosted display face. **A literal colour, radius,
  duration or font size in a component block is a bug** — see
  [art-direction.md](art-direction.md), which documents the palette, what each
  colour family is allowed to mean, and how `src/data/palette.ts` keeps the
  canvas and the DOM from drifting.
- **`src/styles/main.css`** — the components themselves, ~5400 lines, dark theme:
  - Responsive breakpoints at 1100px, 860px and 768px (the mobile branch)
  - Panel grid layout, tab styling
  - HP/mana/XP bar animations
  - Toast notification styling
  - Modal overlays
  - Scrollable panel content

Spacing is the one group not yet swept onto tokens; Parts 7-8 of the UI plan move
it as they rebuild each surface.

The last section of `main.css` is `Icons`, added by Part 6: the `.icon` base
rule (which is what makes `fill: currentColor` work), the semantic tone classes,
the `.icon-frame` variants and the `data-rarity` frames, and the per-host
`--icon-size` overrides for every surface that used to hold a text glyph.

## Icons

Every icon in the DOM is an `<svg class="icon"><use href="#gi-…">` pointing at a
`<symbol>` in `public/icons/sprite.svg`, built by `src/ui/Icon.ts`:

```ts
renderIcon(host, def.icon);                                   // panels, on update
iconFrame(u.icon, { variant: 'upgrade' });                    // framed
iconFrame(e.icon, { variant: 'item', rarity: eq.rarity });    // rarity-framed
iconMarkup(def.icon, { className: 'eq-compare-icon' });       // string templates
```

The sprite must be in the document before the first `<use>` exists — Chromium
does not resolve external `<use>` references — so `main.ts` awaits
`loadIconSprite()` before mounting the UI. Rarity is a CSS frame over shared
artwork, never a second asset. Full details, including how to add an icon and
the attribution the CC BY licence requires, in
[icon-system.md](icon-system.md).

## The pacing overlay (gameplay plan §7.2 / §7.3)

`PacingOverlay.ts` owns the bottom-centre of the arena — the opposite corner
from the boss bar — and holds two readouts that are never both interesting at
once: a combo dies two seconds after the last kill, and the preview only exists
during an intermission.

**Combo meter (§7.2).** Kill count, tier name, the bonus it is paying, the next
threshold, and a bar that **drains**. The drain is the point: a number that only
counts up is a score, whereas a bar visibly emptying is a clock the player can
beat. It carries no CSS transition, because a 0.18 s ease would make the last
fifth of a two-second window unreadable. Tier drives the colour, so the meter
reads at a glance without being read.

**Threat preview (§7.3).** `31 enemies · 4 Siege · 3 Shielded · 1 Elite
(Retribution)`, plus a `Space: call it now for +3% gold` hint when the wave is
callable. Threat types are *named* and trash is only counted — see
`ENEMY_THREAT_CLASS`. Naming the threat rather than the headcount is what makes
the intermission a preparation window: "4 Siege" tells the player to change
targeting mode or save a cooldown; "31 enemies" tells them nothing they could
act on. The canvas draws matching **spawn-edge arrows** for the lanes the wave
will actually use (`Renderer.drawSpawnLanes`), clustered and capped at 8 —
nineteen arrows measured in-browser rings the arena in noise.

Both are pushed once per frame from `Game.frameUpdate` via
`UIManager.setPacingData`, for the same reason the boss bar is pushed rather
than polled: the combo lives in `PacingManager` and the preview in
`WaveManager`, neither of which `UIManager` can see. One snapshot feeds the HUD
controls, the overlay and the canvas lane markers, so the three cannot disagree.

Both update **above** the UI throttle, like the boss bar: a two-second drain
read at 10 fps is a stutter, not a clock. The caching `dom` helpers make an
unchanged frame free.

## `UIManager.isModalOpen()`

Reports whether any modal this manager owns (welcome-back, run summary, run
failed, keybinds) has the player's attention. `Game.isModalOpen` combines it
with the three it owns itself (wave modifier, blessing draft, core picker) plus
the run-failed flag, and that composite gates the §7.1 `Space` binding.

A bare `modalRoot.childElementCount` check would have been shorter and wrong:
the boss bar, the placement prompt, the pacing overlay and the contract tracker
all live in overlay roots that fall back to `modalRoot`, and none of them is a
modal.

## Capacitor

The Android project is **committed** at `android/` and configured by
`capacitor.config.ts` at the repo root (`plans/capacitor.md`). App id
`com.mariusdonci.thetower`, app name **The Tower**, `webDir: dist`.

### Building

| Script | What it does |
|--------|--------------|
| `npm run cap:sync` | `npm run build` then `npx cap sync android` — always go through this |
| `npm run android:apk` | debug APK → `android/app/build/outputs/apk/debug/app-debug.apk` |
| `npm run android:release` | release APK (signed when `android/keystore.properties` exists) |
| `npm run android:bundle` | AAB for the Play Store |
| `npm run android:dev` | sync and run on a device/emulator |
| `npm run android:open` | open the project in Android Studio |

Never run `gradlew` directly: it ships whatever `dist/` happened to be in
`android/app/src/main/assets/public/` last, which during development is
reliably the wrong bundle. The copied bundle and all build output are
gitignored; the hand-edited native sources are not.

### Fully offline, by construction

`android/app/src/main/AndroidManifest.xml` deliberately carries **no
`INTERNET` permission**, and `usesCleartextTraffic="false"`. Capacitor serves
the app through `WebViewAssetLoader`, which intercepts `https://localhost/…`
inside the WebView before it reaches the network stack, so the app still
loads — and no future dependency can quietly phone home. That guarantee rests
on the same three properties as before:

- `index.html` carries `<meta name="theme-color" content="#0a0d14">`.
- `vite.config.ts` sets `base: './'`, so `dist/` is path-agnostic and the
  icon sprite resolves relatively (`src/ui/Icon.ts:28`).
- No runtime network: fonts and the icon sprite are committed under
  `public/`, and `tests/palette.test.ts` scans for any `http(s)` URL.

`tests/capacitor.test.ts` guards the manifest, the app name, the pinned
`https`/`localhost` scheme (changing it would change the WebView origin and
orphan every save), and the absence of `server.url`.

### Edge-to-edge

`MainActivity.java` calls `WindowCompat.setDecorFitsSystemWindows(window,
false)`. The WebView only reports non-zero `env(safe-area-inset-*)` once the
decor view stops fitting system windows, and the HUD, ability bar and bottom
nav are all positioned off `--safe-t/r/b/l` in `src/styles/tokens.css`.
`values/styles.xml` backs this with transparent status and navigation bars and
a `postSplashScreenTheme`, and gives `AppTheme.NoActionBar` a real window
background (the template's `@null` is what produces a white flash between the
splash and the first canvas paint). Orientation is unlocked; the activity's
`configChanges` already survive a rotation.

### `#0a0d14` lives in four places

`--surface-0` in `src/styles/tokens.css`, the `theme-color` meta in
`index.html`, `backgroundColor` in `capacitor.config.ts`, and
`android/app/src/main/res/values/colors.xml` (plus
`values/ic_launcher_background.xml`). **Change them together** — they are the
one ground the app sits on, from launcher icon to canvas.

### Icon and splash

Source art is in `assets/` (SVG *and* the rasterised PNGs, so a checkout can
regenerate without a rasteriser). Regenerate the native resources with:

```bash
npx @capacitor/assets generate --android \
  --iconBackgroundColor '#0a0d14' --iconBackgroundColorDark '#0a0d14' \
  --splashBackgroundColor '#0a0d14' --splashBackgroundColorDark '#0a0d14'
```

The generator may rewrite `values/styles.xml`; if it does, restore the version
described above.
