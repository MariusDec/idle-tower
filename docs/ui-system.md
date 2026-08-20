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

The boss bar (gameplay plan §3.5) is the readout for the whole boss encounter:
tier name, HP with phase pips at 66/33%, the bulwark shield overlay, the active
pattern and its answer, the slam telegraph countdown, and the enrage or
swift-kill clock. `Game.frameUpdate` resolves it from the lead boss and pushes
it via `UIManager.setBossBarData`; passing `null` hides it. See
[boss-encounters.md](boss-encounters.md#the-boss-bar).

## Frame Update (`UIManager.update`)

Called every frame from `Game.loop`:
1. Updates the ability bar and the **boss bar** — both *above* the throttle
   below, because both animate continuously and a 2 s slam countdown read at
   10 fps visibly stutters
2. Updates HUD with fresh state
3. Updates active panel if mounted
4. Computes DPS: `expectedHit * fireRate`, averages over 30 samples, updates HUD every 0.5s

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
