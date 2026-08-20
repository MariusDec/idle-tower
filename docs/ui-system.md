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

## Canvas overlays

`#overlay-root` sits over the canvas and is `pointer-events: none` by default;
each overlay opts back in. Two live there:

| Overlay | File | Shown when |
|---|---|---|
| Run-stalled banner | `RunStalledBanner.ts` | A wave has overrun and started enraging |
| **Boss bar** | `BossBar.ts` | Any boss is alive |
| **Placement prompt** | `PlacementPrompt.ts` | An ability is armed and waiting for a click |

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

`src/styles/main.css` — ~1300 lines, dark theme:
- CSS custom properties for colors/spacing
- Responsive breakpoints at 1100px and 860px
- Panel grid layout, tab styling
- HP/mana bar animations
- Toast notification styling
- Welcome modal overlay
- Scrollable panel content
