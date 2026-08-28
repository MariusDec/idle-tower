# Prestige System

**Files:** `src/systems/PrestigeManager.ts`, `src/data/prestige.ts`

## Overview

Two prestige layers: Ascension (wave 5~~~~0+) and Transcendence (100+ AP).

## Ascension

**Unlock:** Wave 30

**AP Formula:** `floor(sqrt(waveNumber * 5))`

**Performs:**
1. Calculates AP from current highest wave
2. Calculates RP (Research Points) = AP gained
3. Adds AP to `ascensionPoints`, adds to `lifetimeAP`
4. Calls `applySavedStateReset()` — resets upgrades/resources/enemies/projectiles, keeps research/perks/AP
5. Research `startWave` bonus: if unlocked, starts at that wave (5 or 15) with starting gold

### The run-scoped AP channel

`previewAP(wave)` is not just `apForWave`. It composes three things:

```
floor( apForWave(wave)
       x (1 + achievement ap_gain_mult + achievement prestige_gain_mult)
       x (1 + runApBonus) )
```

The first multiplier is **lifetime** (unlocked achievements); the second is
**this run's**, and it is keyed by source:

```ts
export type RunApSource = 'boss' | 'contract';
private runApBonusBySource: Record<RunApSource, number> = { boss: 0, contract: 0 };
```

| Source | Granted by | Ceiling | Persisted in |
|---|---|---|---|
| `boss` | A flawless boss encounter, +10% each ([boss-encounters.md](boss-encounters.md)) | none | `GameState.bossRun.apBonusPct` |
| `contract` | A completed contract that grants one, +3% each ([contract-system.md](contract-system.md)) | **+50%** for the run | `GameState.contracts.apBonusPct` |

Two reasons it is keyed rather than one scalar. First, the two sources have
different ceilings and different persistence blocks, so a contract restore
calling `setRunApBonus` on a shared number would silently erase the boss bonus.
Second, the lifetime and run channels **compose** — `(1 + ach) x (1 + run)` —
rather than one standing in for the other, which is the bug the split was
introduced to avoid in the first place.

Both are cleared by `performAscension`: the ascension that pays a run bonus out
is also the one that ends the run that earned it. `applySavedStateReset` clears
both again for the transcendence path.

### AP Perks

| ID | Name | Cost | Max | Effect |
|----|------|------|-----|--------|
| ap_auto_upgrader | Auto-Upgrader | 25 AP | 1 | Auto-buy automation |
| ap_wave_skipper | Wave Skipper | 6 AP | 15 | +1% wave skip chance/level |
| ap_quiver | Deep Quiver | 5 AP | 30 | +2% fire rate/level |
| ap_might | Ascendant Might | 6 AP | 999 | +2% all damage/level |
| ap_fortune | Ascendant Fortune | 6 AP | 999 | +2% all gold/level |
| ap_research_speed | Scholarly Focus | 8 AP | 5 | -8% research time/level |
| ap_idle_time | Extended Watch | 4 AP | 11 | +8h offline cap/level |
| ap_extra_shots | Twin Arrows | 60 AP | 1 | +1 front projectile at 55% damage |
| ap_pierce | Bodkin Mastery | 75 AP | 3 | +1 pierce/level |
| ap_back_shots | Rear Guard | 90 AP | 1 | +1 rear projectile at 55% damage |
| ap_scatter_shots | Scatter Shot | 200 AP | 1 | +2 angled projectiles at 35% damage |
| ap_warlord | Warlord | 40 AP | 12 | +5% all damage/level (locks out Tycoon) |
| ap_tycoon | Tycoon | 40 AP | 12 | +5% all gold/level (locks out Warlord) |

### Idle-time cap

The offline-progress cap is **derived, never stored**: `BASE_IDLE_TIME_SECONDS`
(8h) plus 8h per level of `ap_idle_time`, up to `IDLE_TIME_MAX_LEVEL` (11) — a
4-day ceiling. `PrestigeManager.getIdleTimeCapSeconds()` is the single query;
`SaveManager` receives it as a constructor callback (`getIdleCapSeconds`) and
applies it in `computeOfflineProgress`, so a perk purchase moves the ceiling on
the next offline walk with no save-field change. The perk row in
`PrestigePanel` shows the current cap next to its level (`Idle cap: 1d 8h`),
and the welcome-back modal names the cap in its "capped at …" line.

**Lifetime AP Bonus:** Each lifetime AP gives +2% damage and +2% gold (additive).

### Tower cores as an AP spend

Cores ([core-system.md](core-system.md)) are bought with AP but are **not** AP
perks: no levels, no prerequisites, no exclusivity, and their own UI.
`PrestigeManager.canUnlockCore(id, alreadyUnlocked)` and
`spendOnCore(id, alreadyUnlocked)` own the debit; ownership itself is
`CoreManager`'s, which is why it is passed in rather than reached for.

| Core | Cost |
|---|---:|
| Marksman | default (free) |
| Artillery | 5 AP |
| Frostwork | 10 AP |
| Bloodforge | 15 AP |
| Arcane | 25 AP |

The unlock is **permanent** — `performAscension` and `applySavedStateReset`
never touch it. What resets with the run is the *selection*, and it resets to
the player's remembered preference rather than to the default, so an
auto-ascending run keeps the identity its player chose.

## Transcendence

**Unlock:** 100 AP

**TP Formula:** `floor(log10(ap + 1) * 3)`

**Performs:**
1. Calculates TP from current AP
2. Adds TP to `transcendencePoints`
3. Calls `applyFullTranscendenceReset()` — same as ascension reset + clears research + automation

### TP Perks

| ID | Name | Cost | Max | Effect |
|----|------|------|-----|--------|
| tp_damage | Cosmic Power | 1 TP | 999 | +50% damage/level (multiplicative with AP) |
| tp_resource | Astral Harvest | 1 TP | 999 | +25% resource gain/level (multiplicative) |
| tp_auto_buy | Auto-Purchaser | 5 TP | 1 | Auto-buy automation |
| tp_auto_cast | Auto-Caster | 10 TP | 1 | Auto-cast automation |
| tp_auto_ascend | Auto-Ascender | 20 TP | 1 | Auto-ascend automation |
| tp_auto_transcend | Auto-Transcender | 50 TP | 1 | Auto-transcend automation |

## Automation Unlocks

When an AP perk with `effectType: 'auto_buy'` or TP perk with `effectType: 'automation'` is purchased, the corresponding automation flag is set and `automation_unlocked` event is emitted.

Automation flags are stored in `PrestigeState.automationFlags`:
- `autoBuy` — auto-purchase cheapest upgrade
- `autoAbilities` — auto-cast abilities
- `autoAscend` — auto-ascend at target wave
- `autoTranscend` — auto-transcend when possible

## Second, non-AP grant paths via the Watch

Four of the things the AP tree sells are also granted by Long Watch
chapters (`docs/watch-system.md`): `veteran_start` (chapter 3), `cold_forge`
(chapter 5), `overseer` (chapter 7) and `sanctum` (chapter 11). These are
intentional overlaps — a player who earns the chapter should not have to
buy the same perk again — and they **never double-count**:

- `startWave` is already a `Math.max` over four sources (research, an AP
  perk, a talent, and `watch.veteranStart`), so any of them can lift the
  floor and none can lift it twice.
- `isAutomationUnlocked(key)` is a boolean OR across the AP perk, the TP
  perk and `watch.overseer`, so any of them unlocks it once.

`cold_forge` and `sanctum` are the two AP cores the chapters give for
free (`frostwork` normally 10 AP, `arcane` normally 25 AP). The chapter
completes call `CoreManager.unlock(id)` directly; the AP-tree path
remains the way to spend AP for either core. See
[watch-system.md](watch-system.md#the-unlock-catalogue).
