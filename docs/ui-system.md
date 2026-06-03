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

## Frame Update (`UIManager.update`)

Called every frame from `Game.loop`:
1. Updates HUD with fresh state
2. Updates active panel if mounted
3. Computes DPS: `expectedHit * fireRate`, averages over 30 samples, updates HUD every 0.5s

## CSS

`src/styles/main.css` — ~1300 lines, dark theme:
- CSS custom properties for colors/spacing
- Responsive breakpoints at 1100px and 860px
- Panel grid layout, tab styling
- HP/mana bar animations
- Toast notification styling
- Welcome modal overlay
- Scrollable panel content
