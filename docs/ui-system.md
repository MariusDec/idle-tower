# UI System

**Files:** `src/ui/UIManager.ts`, `src/ui/HUD.ts`, `src/ui/UpgradePanel.ts`, `src/ui/AbilityPanel.ts`, `src/ui/PrestigePanel.ts`, `src/ui/TranscendencePanel.ts`, `src/ui/ResearchPanel.ts`, `src/ui/WelcomeBackModal.ts`, `src/styles/main.css`

## Architecture

```
UIManager
  ├── HUD (top bar, never changes tab)
  ├── UpgradePanel (Attack / Defense / Utility sub-tabs)
  ├── AbilityPanel (4 ability cards)
  ├── PrestigePanel (Ascension card + AP perks)
  ├── TranscendencePanel (Transcendence card + TP perks + Automation)
  ├── ResearchPanel (4-category research tree)
  └── WelcomeBackModal (offline progress dialog)
```

## Tab System

5 tabs: Upgrades, Research, Abilities, Prestige, Transcendence.

`UIManager.showTab(id)`:
1. Sets `activeTab`
2. Activates tab button CSS
3. Clears contentRoot
4. Mounts the panel's DOM into contentRoot
5. Calls update() with latest state

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

Top bar displays:
- Gold (formatted with suffixes)
- Kills count
- Wave number + controls (prev/auto/next)
- Tower HP bar (with critical warning at ≤40%)
- Mana bar (locked until wave 10)
- DPS estimate (averaged over 30 frames)
- FPS counter
- Speed controls (-/+)
- **Risk** stepper (0-5, gameplay plan §7.4) next to the speed controls
- **Call** button and a momentum readout in the wave block (§7.1)

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

### The placement prompt (gameplay plan §4.3)

With `instantCast` turned off, a hotkey *arms* Rain of Arrows, Frost Nova or
Meteor Strike instead of casting it, and the next canvas click places it. That
is a modal input state — the next click means something different from usual —
and the one thing an input state must never be is invisible. `PlacementPrompt`
is a strip near the top of the arena naming the ability and how to cancel
(`Esc`, or the hotkey again). It is `pointer-events: none` and deliberately not
a dialog: the simulation keeps running while the player decides, because
stopping the game to ask where the meteor goes would break the idle contract.

`Game` drives it through `UIManager.setPlacementPrompt(text | null)`, and every
path that leaves placement mode — Escape, the hotkey, a wave transition, a
failed cast, an ascension — clears it. See
[loot-system.md](loot-system.md#click-placed-abilities).

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
