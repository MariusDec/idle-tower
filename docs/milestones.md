# Milestone Strip — "What's next" preview

**Files:** `src/data/milestones.ts`, `src/ui/MilestoneStrip.ts`, wired through `src/ui/UIManager.ts` and `src/ui/HUD.ts`.

## Why

Players had no way to see what's coming. Mana unlock at wave 10 was invisible until it landed, ability unlocks at wave 18/22/28/30/40/45/50 felt arbitrary, and Ascension at wave 20 was a sudden prompt. The strip solves all three at once.

## What shows up

A small horizontal pill strip rendered in a fixed-position slot at the top of the screen (see `.milestone-strip-slot` in `src/styles/main.css`). The strip shows the **next 3 milestones** in wave order, e.g.:

- `Wave 10` · `Mana system unlocked` — Abilities become available...
- `Wave 18` · `Frost Nova unlocked` — New ability at wave 18.
- `Wave 20` · `Ascension available` — Reset your run for AP.

When the player has ≥ 100 AP in a transcendence cycle, the strip also surfaces the Transcendence milestone at the end (with the label `100 AP` since it's AP-gated, not wave-gated).

## Data model

`src/data/milestones.ts` exports:

- `MilestoneDef` — `{ id, kind, wave, label, detail, glyph, color, refId? }`
- `MILESTONES: MilestoneDef[]` — full table (mana unlock, ascension unlock, every ability unlock, every enemy intro, transcendence). Sorted by wave ascending.
- `upcomingMilestones(currentWave, apThisCycle, count = 3)` — returns the next N items strictly after the current wave. Appends the transcendence entry when AP gate is met.
- `milestoneAtWave(wave)` — used by the `wave_started` subscriber to detect a fresh milestone trigger.

`kind` is one of `'ability' | 'enemy' | 'mana' | 'ascension' | 'transcendence' | 'research'` — used for CSS color coding and for skipping research milestones (none exist yet; reserved for future use).

The table is **derived** from `ABILITIES` and enemy unlock waves (single source of truth — no duplication of unlock numbers).

## Animation

When a milestone is reached, the strip's `is-pulse` class animates a 1.6s scale + green ring effect (see `@keyframes milestone-pulse` in CSS). Detection: on each `refresh()`, the strip compares the new upcoming-ID set with the previous one. If any previously-shown ID is gone, a milestone was just passed, and the new "next" entry pulses.

The pulse is triggered from the strip's own state diff (NOT from the `wave_started` event) so the visual feedback is robust even if the throttled UI update races with the event.

## Wiring

1. `HUD.renderMilestoneStripSlot()` appends a `div.milestone-strip-slot` to `document.body` and returns it.
2. `UIManager` constructs `MilestoneStrip` against that slot, passing a `getUpcoming()` callback that calls `upcomingMilestones(state.wave.highestWave, state.resources.apThisTranscendence, 3)`.
3. `UIManager.update()` calls `milestoneStrip.refresh()` once per UI frame (~10 Hz).
4. `UIManager.tickDisplayHud(dt, state)` calls `milestoneStrip.update(dt)` every game frame so the pulse timer can decay smoothly.

## Public API

```ts
class MilestoneStrip {
  constructor(root: HTMLElement, handlers: { getUpcoming: () => MilestoneDef[] });
  refresh(): void;          // rebuild DOM from getUpcoming()
  update(dt: number): void; // advance the pulse timer
  flashLastEntry(): void;   // manual trigger (rarely needed)
}
```
