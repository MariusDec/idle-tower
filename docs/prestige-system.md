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
| ap_extra_shots | Twin Arrows | 2 AP | 10 | +1 front projectile/level |
| ap_scatter_shots | Scatter Shot | 3 AP | 5 | +1 angled projectile/level |
| ap_back_shots | Rear Volley | 5 AP | 3 | +1 rear projectile/level |
| ap_auto_upgrader | Auto-Upgrader | 15 AP | 1 | Auto-buy cheapest upgrade every 10s |
| ap_wave_skipper | Wave Skipper | 3 AP | 25 | +3% wave skip chance/level |

**Lifetime AP Bonus:** Each lifetime AP gives +2% damage and +2% gold (additive).

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
