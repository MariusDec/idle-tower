# Milestone Strip — "What's next" preview

**Files:** `src/data/milestones.ts`, `src/ui/MilestoneStrip.ts`, wired through `src/ui/UIManager.ts` and `src/ui/HUD.ts`.

## Why

Players had no way to see what's coming. Mana unlock at wave 10 was invisible until it landed, ability unlocks at wave 18/22/28/30/40/45/50 felt arbitrary, and Ascension at wave 20 was a sudden prompt. The strip solves all three at once.

## What shows up

A single compact chip pinned in the bottom-left corner stack, directly above the contract tracker (`.milestone-strip-slot`, see `src/styles/main.css`). The chip shows the **next** milestone — its wave tag, its label, and a coloured fill that grows from 0% to 100% as the player approaches it.

Examples:

- `Wave 10` · `Mana system unlocked`
- `Wave 18` · `Frost Nova unlocked`
- `Wave 20` · `Ascension available`

When the player has ≥ 100 AP in a transcendence cycle, the chip also surfaces the Transcendence milestone (with the label `100 AP` since it's AP-gated, not wave-gated).

The earlier version of this widget also expanded a hover-flyout of up to three pills covering the play area around the chip. It was removed in plans/stats.md Part B because it duplicated the Progression tab (which lists every milestone, earned or upcoming), swallowed pointer events around the bottom-left corner, and on mobile grew into a column that could fill most of the viewport. Clicking the chip now opens the Progression tab — the canonical home of every milestone.

## Data model

`src/data/milestones.ts` exports:

- `MilestoneDef` — `{ id, kind, wave, label, detail, glyph, color, refId? }`
- `MILESTONES: MilestoneDef[]` — full table (mana unlock, ascension unlock, every ability unlock, every enemy intro, transcendence). Sorted by wave ascending.
- `upcomingMilestones(currentWave, apThisCycle, count = 3)` — returns the next N items strictly after the current wave. Appends the transcendence entry when AP gate is met.
- `milestoneAtWave(wave)` — used by the `wave_started` subscriber to detect a fresh milestone trigger.

`kind` is one of `'ability' | 'enemy' | 'mana' | 'ascension' | 'transcendence' | 'research'` — used for CSS color coding and for skipping research milestones (none exist yet; reserved for future use).

The table is **derived** from `ABILITIES` and enemy unlock waves (single source of truth — no duplication of unlock numbers).

## Animation

When a milestone is reached, the chip pulses for four seconds with the `@keyframes milestone-pulse` flourish (green ring + scale). Detection: on each `refresh()`, the strip compares the new upcoming-ID set with the previous one; if any previously-shown ID is gone, a milestone was just passed, and the chip pulses. The pulse is triggered from the strip's own state diff (NOT from the `wave_started` event) so the visual feedback is robust even if the throttled UI update races with the event. The `wave_started` call site still invokes `flashLastEntry()` directly as a belt-and-braces trigger.

## Wiring

1. `HUD.renderMilestoneStripSlot()` appends a `div.milestone-strip-slot` to `document.body` and returns it.
2. `UIManager` constructs `MilestoneStrip` against that slot, passing:
   - `getProgress()` for the fill bar width,
   - `getUpcoming()` for the next milestone (called with `count = 3` so the set-difference early-out still detects a fresh trigger),
   - `onOpenProgression()` — a callback that opens the Progression tab (or the mobile sheet's `progression` tab on phones).
3. `UIManager.update()` calls `milestoneStrip.refresh()` once per UI frame (~10 Hz).
4. `UIManager.tickDisplayHud(dt, state)` calls `milestoneStrip.update(dt)` every game frame so the pulse timer can decay smoothly.

## Public API

```ts
class MilestoneStrip {
  constructor(
    root: HTMLElement,
    handlers: {
      getProgress: () => { currentWave: number; apThisCycle: number };
      getUpcoming: () => MilestoneDef[];
      onOpenProgression: () => void;
    },
  );
  refresh(): void;          // rebuild chip content from getUpcoming()
  update(dt: number): void; // advance the pulse timer
  flashLastEntry(): void;   // trigger the chip pulse (rarely needed)
}
```
