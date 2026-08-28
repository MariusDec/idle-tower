# Active Abilities — Redesign

**Goal:** make the ten active abilities worth *pressing*. Three things are broken today and this
plan fixes all three:

1. **Targeting is inverted.** `instantCast` (default **on**) makes manual casts auto-aim, and
   turning it off is the only way to aim by hand. The player's own press should always aim; the
   *automation* is the thing that should pick a spot for you.
2. **The reticle is a lie.** It does not follow the pointer (it is drawn at the last *pressed*
   position, not the hovered one), it never changes size, and — worst — Rain of Arrows and Frost
   Nova ignore it entirely and hit the whole field, so the disc communicates a shape the ability
   does not have.
3. **The balance is incoherent.** Meteor Strike's splash deals **twice** what its "single target"
   hit deals. Execute's boss branch is worth ~0.05% of a boss bar. Frost Nova's slow does almost
   nothing in a game where enemies park at the tower's contact radius. Chain Lightning is the worst
   damage-per-mana in the roster while costing the second most.

**Status:** implementation plan. Every constant below is a literal to type in as-is. Every formula is
written out. Nothing here needs a design decision from the implementer.

**Files touched**

| File | What changes |
|---|---|
| `src/types.ts` | `AbilityState` unchanged; no `AbilityId` change |
| `src/data/abilities.ts` | area fields on `AbilityDef`, retuned table, new constants, `placementRadius(id, level)` |
| `src/data/research.ts` | new `arcane_expansion` node (`ability_area` effect type) |
| `src/systems/ResearchTree.ts` | `getAbilityAreaBonus()` |
| `src/data/talentTree.ts` | `ability_area_pct` stat added to `ar_frostbite` |
| `src/stats/keys.ts` | `abilityAreaMultiplier` key, base, clamp |
| `src/stats/contributors/talents.ts` | `ability_area_pct` case |
| `src/stats/contributors/research.ts` | area multiplier from research |
| `src/stats/contributors/core.ts` | arcane core area bonus |
| `src/systems/AbilityManager.ts` | area plumbing, disc-scoped effects, Meteor/Execute/Chain/Nova rewrites, auto-cast conditions |
| `src/systems/ActiveInput.ts` | `AbilityPlacement` gains a live cursor + `armWithoutCancel` |
| `src/systems/AutomationManager.ts` | new priority order, condition gate |
| `src/systems/LootManager.ts` | `setMagnetSource` ref-counted magnet |
| `src/systems/EffectsManager.ts` | `emitRainOfArrows` / `emitFrostNovaRing` take a radius |
| `src/game/Game.ts` | pointer tracking, cast routing, placement snapshot, effect wiring, stat wiring |
| `src/game/Renderer.ts` | reticle redraw (radius, validity, ability colour) |
| `src/main.ts` | pointer listeners: hover tracking, touch drag-to-aim, Escape ordering |
| `src/ui/SettingsPanel.ts` | `instantCast` → `autoCastAutoAim`, new copy |
| `src/ui/AbilityBar.ts` | targeted tiles show an aim glyph; click arms rather than casts |
| `src/ui/abilityFormat.ts` | tooltip gains an `Area` row |
| `src/systems/SaveManager.ts` | `SAVE_VERSION` 19 → 20 + `migrateV19toV20` |
| `tests/abilities.test.ts` | retuned goldens + new behaviour tests |
| `tests/content-coverage.test.ts` | `RESEARCH_NODES.length` 17 → 18 |
| `sim/checks.ts` | §3.1 extended |
| `sim/model.ts` | `targetedCastDps` re-estimated |
| `docs/ability-system.md`, `docs/loot-system.md`, `docs/ui-system.md`, `docs/research-system.md`, `docs/xp-talent-system.md` | rewritten sections |

---

## 1. Measured diagnosis

All numbers below were read out of the shipping tables (`src/data/abilities.ts`,
`src/systems/AbilityManager.ts`, `src/data/tower.ts`, `src/data/arena.ts`).

### 1.1 The reticle does not follow the pointer

`Game.setMouseInput` (`src/game/Game.ts:2735`) stores the cursor **only while the button is down**:

```ts
if (isDown) { this.mouseX = x; this.mouseY = y; }
```

`placementSnapshot()` (`Game.ts:2871`) reads `this.mouseX/mouseY`. So while an ability is armed and
the player is *hovering* to choose a spot, the disc sits wherever the pointer last was during a
press — usually the previous click. `mouseup` then calls `setMouseInput(0, 0, false)`, snapping the
stored point to the world origin. The disc is therefore stale or parked in a corner for the entire
time it is meant to be useful.

### 1.2 The disc does not describe the effect

- `dealAoEDamage` (`AbilityManager.ts:571`) loops `this.enemies.list` — **every** enemy — and only
  uses the disc to add `PLACEMENT_FOCUS_DAMAGE_BONUS` (+60%) inside it.
- `applyEffect` case `'slow'` calls `enemies.applySlow(...)` which sets a **global**
  `slowFactor`/`slowTimer` on `EnemyManager`; the disc only adds a deeper `applyChill`.
- The visual makes it worse: `Game.ts:1790` calls `emitRainOfArrows(t.x, t.y)` and
  `emitFrostNovaRing(t.x, t.y)` — **tower** coordinates — ignoring the `target` the event carries.
  So the player aims at a pile on the left and the arrows fall on the tower.

Net: aiming buys a +60% modifier the player cannot see, on an ability that visibly ignores the aim.

### 1.3 `instantCast` is backwards

`Game.castAbility` (`Game.ts:2431`):

```ts
if (!this.instantCast && isPlaceable(id)) return this.beginPlacement(id);
return this.abilityMgr.tryCast(id, this.state.wave.highestWave);
```

The setting defaults **on**, so the default experience of a manual press is an auto-aimed cast, and
the auto-aim path (`pickBestSpot`) is *shared with* `AutomationManager.runAutoCast`. There is no way
to have "automation auto-aims, my own presses aim by hand", which is the only combination that makes
sense: automation cannot hold a mouse, and a player who pressed a key is asking to choose.

### 1.4 Meteor Strike's splash exceeds its primary hit

`AbilityManager.dealMeteorStrike`:

```ts
const heavyRaw  = baseDamage * multiplier * ... ;   // 10x at L1
const splashRaw = heavyRaw * METEOR_SPLASH_MULTIPLIER;   // METEOR_SPLASH_MULTIPLIER = 2
```

Every enemy in the crater *except the target* takes **20×** `baseDamage`; the "highest-HP enemy" the
description promises to smash takes **10×**. An ability whose `effectType` is literally
`single_target_damage` is its own worst single-target option. Against a five-enemy crowd it deals
`10 + 4 × 20 = 90×`; against a lone boss, `10×`.

### 1.5 Execute's boss branch is noise

```ts
const dmg = baseDamage * EXECUTE_BOSS_MULTIPLIER * damageMultiplier;  // 4.2x
```

`4.2 × baseDamage` against a boss whose bar is `bossMaxHpForWave(wave)` — thousands of times the
tower's per-shot damage at the waves Execute unlocks (50+). The boss branch only triggers below
`effectValue / 2` % of max HP (6% at L1), i.e. exactly when the boss is about to die anyway, and
then contributes a rounding error. `AutomationManager`'s comment claims Execute leads the priority
list "because its value-per-mana is highest on boss waves"; it is in fact the lowest.

### 1.6 Frost Nova barely does anything

`src/data/arena.ts` documents the movement model: *"enemies in this game do not pass through the
tower's range… `EnemyManager.tick` walks them to their contact radius and parks them there until
they die."* A slow therefore only affects **walk-in time**, never time-in-range. Once the pile has
formed — which is most of a wave — a 50% slow changes nothing measurable. Its only real damage
contribution is via `chilledDamageBonus`, which is (a) zero unless the player took the `ar_frostbite`
talent and (b) applied **only to projectile hits** (`ProjectileManager.ts:412`), never to ability
damage.

### 1.7 Damage per mana is unbalanced by an order of magnitude

At L1, in units of `baseDamage` delivered per mana spent (crowd of 15 for field abilities):

| Ability | Total `baseDamage` | Mana | Per mana |
|---|---:|---:|---:|
| Rain of Arrows | `4.2 × 15` = 63 | 30 | **2.10** |
| Rocket Barrage | `6 × 1.65 × 1.5` (splash) = 14.9 | 45 | 0.33 |
| Meteor Strike | `10 + 4 × 20` = 90 | 60 | 1.50 |
| Chain Lightning | `2.5 × Σ0.65^i` (5) = 6.3 | 40 | **0.16** |
| Execute (boss) | 4.2 | 50 | **0.08** |

Chain Lightning costs 33% more mana than Rain of Arrows and delivers 10% of the damage.

### 1.8 The mana budget cannot pay for the roster

Base regen is **1 MP/s** (`STAT_BASES.manaRegen`), `Meditation` adds `+0.2/level` to 60 levels
(`+12`), so a fully-invested run sits near **13 MP/s**. Summed L1 mana cost of all ten abilities is
**420**, and the mean cooldown is 25.5 s → a full auto-cast rotation demands **~16.5 MP/s**. Mana,
not cooldown, is the binding constraint for most of a run, which means the **auto-cast priority order
is the real balance lever** — and today it spends the budget top-down on the two worst
damage-per-mana abilities in the table (Execute, then Meteor Strike).

### 1.9 There is no area progression

`PLACEABLE_ABILITIES` is a flat `Partial<Record<AbilityId, { radius: number }>>`. A level-10 Rain of
Arrows has exactly the disc a level-1 one has. Nothing in upgrades, talents, research, cores or
prestige moves an ability's area.

---

## 2. Design summary

Five decisions drive everything below.

1. **A press aims; automation auto-aims.** `instantCast` is deleted as a manual-cast switch. A manual
   cast of a *targeted* ability always arms placement. `AutomationManager` always calls
   `pickBestSpot`. The setting is repurposed to `autoCastAutoAim`, which only governs whether the
   automation aims at clusters or at the tower.
2. **The disc is the effect.** Targeted abilities apply **inside the disc only**. Damage is raised to
   pay for the lost coverage, and the disc **grows with level**, so an upgrade is visible on the
   battlefield. Frost Nova keeps a weak *global* slow as a panic-button floor; everything else it
   does happens in the disc.
3. **The reticle tracks the pointer, is drawn at the real radius, and shows the ability's colour**,
   with an invalid-target state (no enemy inside) so a whiff is visible before the click.
4. **Roles are separated.** Rain of Arrows is the crowd nuke. Meteor Strike is the single-target
   nuke (splash becomes a *fraction*, primary damage nearly doubles). Execute is the boss finisher
   (% of boss max HP, not a tower-damage multiple). Chain Lightning is the mid-crowd, low-cooldown
   filler. Frost Nova is control **plus** a brittle debuff that finally gives the cold build a
   damage channel.
5. **Auto-cast gets conditions.** Each ability declares when automation is allowed to spend on it
   (minimum enemies on the field, boss present, HP thresholds), so a mana budget that cannot pay for
   the whole roster is spent on casts that matter.

---

## Part A — Targeting: manual casts always aim

### A.1 `Game.castAbility`

Replace the body of `castAbility` (`src/game/Game.ts:2431`):

```ts
/**
 * Cast an ability from the hotkey or the ability bar.
 *
 * A manual press *always* aims: a targeted ability arms placement and the next
 * canvas press drops it. Auto-aim is what automation does, not what a player
 * who reached for the keyboard asked for. Pressing the same hotkey again
 * cancels, which is why re-arming the pending ability is a toggle.
 */
castAbility(id: AbilityId): boolean {
  if (isTargeted(id)) return this.beginPlacement(id);
  return this.abilityMgr.tryCast(id, this.state.wave.highestWave);
}
```

`isTargeted` is the renamed `isPlaceable` (see §C.2). Delete the `this.instantCast` read here.

### A.2 The `instantCast` field becomes `autoCastAutoAim`

In `src/game/Game.ts`:

- Rename the private field `instantCast` → `autoCastAutoAim`, default **`true`**.
- `INSTANT_CAST_KEY = 'the-tower-instant-cast'` (`Game.ts:152`) is kept as
  `LEGACY_INSTANT_CAST_KEY` and joined by `const AUTO_AIM_KEY = 'the-tower-autocast-aim';`. The
  helpers `readInstantCastPreference` / `writeInstantCastPreference` become
  `readAutoAimPreference` / `writeAutoAimPreference`, and the reader carries the old key's value over
  once before deleting it (see §H.2), so an existing player's preference is not silently flipped.
- Replace `setInstantCast(enabled)` with:

```ts
/** Player preference: should auto-cast aim at clusters, or just cast? */
setAutoCastAutoAim(enabled: boolean): void {
  this.autoCastAutoAim = enabled;
  writeAutoAimPreference(enabled);
  this.ui.setAutoCastAutoAimState(enabled);
}

get autoCastAutoAimEnabled(): boolean {
  return this.autoCastAutoAim;
}
```

Note the removed `if (enabled) this.cancelPlacement()` — the setting no longer has anything to do
with placement mode.

- `AutomationManager` needs to read it: add `getAutoAim: () => boolean` to `AutomationManagerDeps`
  and pass `() => this.autoCastAutoAim` when constructing it in `Game`.

### A.3 `AutomationManager.runAutoCast`

```ts
private runAutoCast(wave: number): void {
  const enabled = this.deps.getState().prestige.autoCastEnabled ?? {};
  const autoAim = this.deps.getAutoAim();
  for (const id of AUTO_CAST_PRIORITY) {
    if (enabled[id] === false) continue;
    const def = ABILITY_BY_ID[id];
    if (!def) continue;
    if (!this.deps.abilities.canCast(id, wave)) continue;
    if (!this.deps.abilities.autoCastConditionMet(id)) continue;   // §F.2
    // `null` placement = "pick the best spot yourself"; `undefined` for a
    // non-targeted ability is the same thing and costs nothing.
    this.deps.abilities.tryCast(id, wave, autoAim ? null : { skipAim: true });
  }
}
```

For the `skipAim` case, keep it simple: pass a third argument shape
`{ x: number; y: number } | null | 'no-aim'`. When `'no-aim'`, `tryCast` centres the disc on the
tower instead of calling `pickBestSpot`. Type it as:

```ts
export type CastPlacement = { x: number; y: number } | 'auto' | 'tower';
```

and let `tryCast(id, wave, placement: CastPlacement = 'auto')` resolve it:

| Value | Meaning | Focus bonus |
|---|---|---|
| `{x, y}` | the player clicked here | **yes** |
| `'auto'` | `pickBestSpot(id)`, falling back to the tower | no |
| `'tower'` | centred on the tower | no |

Update every existing caller: `castByHotkey` and `Game.castAbility`'s non-targeted branch pass
nothing (default `'auto'`), `castPlacedAbility` passes `{x, y}`, `runAutoCast` passes `'auto'` or
`'tower'`.

### A.4 The ability bar arms too

`src/ui/AbilityBar.ts` calls `handlers.onCast(id)`, which is wired to `Game.castAbility` — so it
picks up §A.1 for free. Two UI additions:

- Add a small crosshair glyph (icon id `arrow-scope`, or a CSS `::after` `⌖`) in the corner of every
  tile whose ability is targeted, so the player knows the tap will arm rather than fire.
- While `Game.isPlacing()` and `pendingPlacement === def.id`, add class `is-arming` to the tile
  (pulsing outline in `def.color`). Push this through the existing `AbilityBar.update(state)` path by
  adding `pendingPlacement: AbilityId | null` to the snapshot the bar already receives, or by adding
  a handler `getPendingPlacement: () => AbilityId | null` to `AbilityBarHandlers`. Prefer the handler
  — it avoids a save-shape change.

### A.5 Settings copy

`src/ui/SettingsPanel.ts`: rename `instantCast` → `autoCastAutoAim` on the api object, the input ref
and the change handler. Replace the description paragraph with:

> Targeted abilities — Rain of Arrows, Frost Nova, Chain Lightning, Meteor Strike and Rocket Barrage
> — arm when you press their hotkey, and the next click on the battlefield drops them there. Escape
> or the hotkey again cancels. Auto-cast aims for you: leave **Auto-cast aims at crowds** on and
> automation drops each ability on the densest cluster it can find; turn it off and automation casts
> from the tower instead.

Checkbox label: **"Auto-cast aims at crowds"**.

---

## Part B — The reticle follows the pointer

### B.1 Track hover, not just press (`Game`)

Replace `setMouseInput`:

```ts
setMouseInput(x: number, y: number, isDown: boolean): void {
  if (this.charge.setPointer(x, y, isDown)) this.chargeFirePending = true;
  // The cursor is tracked whether or not the button is down: the placement
  // reticle has to follow a *hover*, and every consumer that wants "where the
  // player is aiming a shot" is already gated on `mouseDown` below.
  this.mouseX = x;
  this.mouseY = y;
  if (isDown && !this.mouseDown) this.tower.clearTargetLock();
  this.mouseDown = isDown;
}
```

This is safe: every other reader of `mouseX/mouseY` is already gated (`Game.ts:5043`, `5166`, `5182`,
`5196`, `5446` all test `this.mouseDown`; `chargeSnapshot` tests `charge.isDown`).

### B.2 Releasing must not teleport the cursor (`main.ts`)

`mouseup` and `releaseTouch` currently call `game.setMouseInput(0, 0, false)`, which snaps the stored
point to the world origin. Add a dedicated release entry point in `Game`:

```ts
/** Pointer released. Keeps the last position — only the button state changes. */
releasePointer(): void {
  this.charge.setPointer(this.mouseX, this.mouseY, false);
  this.mouseDown = false;
}
```

…and note `setPointer`'s return value is the "armed charge fired" flag, so preserve it:

```ts
releasePointer(): void {
  if (this.charge.setPointer(this.mouseX, this.mouseY, false)) this.chargeFirePending = true;
  this.mouseDown = false;
}
```

In `src/main.ts`, replace both `game.setMouseInput(0, 0, false)` calls with `game.releasePointer()`.

Add a `mouseleave` listener that only drops the button state, so a cursor leaving the canvas does not
leave a reticle stranded mid-field:

```ts
canvas.addEventListener('mouseleave', () => {
  mouseDown = false;
  game.releasePointer();
  game.setPointerOnCanvas(false);
});
canvas.addEventListener('mouseenter', () => game.setPointerOnCanvas(true));
```

`Game.setPointerOnCanvas(on: boolean)` sets a private `pointerOnCanvas` flag (init `false`);
`placementSnapshot()` returns `null` when it is false **and** the last input was a mouse, so the disc
disappears rather than sticking at the edge. On touch, treat every `touchstart`/`touchmove` as
`setPointerOnCanvas(true)` and `touchend` as leaving it `true` until the next arm (the finger has
gone, but the placement already resolved).

### B.3 Touch: drag to aim, release to place

Today `pressAt` runs on `touchstart`, so a tap places instantly at the first contact point and the
finger can never adjust. Change the touch pipeline so that **while an ability is armed**, placement
resolves on release:

In `src/main.ts`:

```ts
canvas.addEventListener('touchstart', (ev) => {
  if (ev.touches.length === 0) return;
  const t = ev.touches[0];
  activeTouchId = t.identifier;
  const { x, y } = toWorldXY(t.clientX, t.clientY);
  game.setPointerOnCanvas(true);
  if (game.isPlacing()) {
    // Aiming: the disc follows the finger and lands when it lifts.
    game.setMouseInput(x, y, true);
  } else {
    pressAt(x, y);
  }
  ensureAudio();
  ev.preventDefault();
}, { passive: false });
```

`touchmove` is unchanged (it already calls `setMouseInput(x, y, true)`).

```ts
const releaseTouch = () => {
  activeTouchId = null;
  if (game.isPlacing()) game.commitPlacementAtPointer();
  game.releasePointer();
};
```

Add to `Game`:

```ts
/** Drop the armed ability wherever the pointer currently is (touch release). */
commitPlacementAtPointer(): boolean {
  if (!this.placement.isPlacing) return false;
  return this.castPlacedAbility(this.mouseX, this.mouseY);
}
```

Mouse stays click-to-place: `handleCanvasPress` already routes a press to `castPlacedAbility` before
manual aim, and that is the right idiom for a mouse.

### B.4 Escape and cancellation are unchanged

`AbilityPlacement`'s invariant ("placement mode never outlives its reason") stays exactly as written.
Confirm all five cancellers still fire after the refactor: same hotkey, `Escape` (ahead of the
keybinds overlay), `wave_started`, ascension/transcendence, and any click.

Add one more: **casting a different ability cancels the pending one.** In `beginPlacement`, when
`this.placement.pending !== null && this.placement.pending !== id`, cancel the old one first (clear
the prompt), then arm the new one. `AbilityPlacement.toggle` already returns `'begin'` for that case;
just make sure the prompt text is rewritten.

---

## Part C — Areas that scale

### C.1 New `AbilityDef` fields

Add to `AbilityDef` in `src/data/abilities.ts`:

```ts
  /**
   * Effect disc, in world units, at level 1. Present iff the ability is
   * targeted. `world()`-scaled at definition time like every other radius.
   */
  areaRadius?: number;
  /** Extra radius (world units) per level above 1. */
  areaRadiusPerLevel?: number;
  /** Auto-cast gate — see §F.2. */
  autoCast?: AutoCastCondition;
```

```ts
/**
 * When automation is allowed to spend mana on an ability.
 *
 * The mana budget cannot pay for the whole roster (plan §1.8), so automation
 * has to choose. A condition is a *floor*, never a preference: an ability with
 * no condition is always allowed.
 */
export interface AutoCastCondition {
  /** Minimum targetable enemies alive anywhere on the field. */
  minEnemies?: number;
  /** Minimum targetable enemies inside the ability's own disc at its best spot. */
  minInDisc?: number;
  /** Only cast while a boss is alive. */
  bossOnly?: boolean;
  /** Only cast while the lead boss's HP fraction is at or below this. */
  bossHpBelow?: number;
  /** Only cast while the tower's HP fraction is at or below this. */
  towerHpBelow?: number;
}
```

### C.2 `PLACEABLE_ABILITIES` → derived, level-aware helpers

Delete the `PLACEABLE_ABILITIES` constant. Replace the three helpers:

```ts
/** True when the ability is cast at a point rather than on the tower. */
export function isTargeted(id: AbilityId): boolean {
  return (ABILITY_BY_ID[id]?.areaRadius ?? 0) > 0;
}

/** Legacy alias — remove once every call site is migrated. */
export const isPlaceable = isTargeted;

/**
 * The ability's disc at `level`, before the `abilityAreaMultiplier` stat.
 *
 * Linear growth, deliberately: the disc is the one ability stat the player
 * *sees*, and a geometric curve on a radius is a quartic curve on the area it
 * covers, which turns a level-10 Rain of Arrows into a screen-wipe.
 */
export function placementRadius(id: AbilityId, level: number = 1): number {
  const def = ABILITY_BY_ID[id];
  if (!def || !def.areaRadius) return 0;
  const lvl = Math.max(1, Math.min(def.maxLevel, level));
  return def.areaRadius + (def.areaRadiusPerLevel ?? 0) * (lvl - 1);
}
```

Every existing call to `placementRadius(id)` must be audited: `Game.placementSnapshot`,
`AbilityManager.pickBestSpot`, `AbilityManager.applyEffect` (`slow` case), `dealAoEDamage`. All of
them must move to `AbilityManager.getEffectiveRadius(id)` (§C.4) so the stat multiplier is never
skipped.

`METEOR_SPLASH_RADIUS` is deleted — Meteor's crater is now its disc (§D.4). Anything importing it
(`AbilityManager`, tests) moves to `getEffectiveRadius('meteor_strike')`.

### C.3 The `abilityAreaMultiplier` stat

`src/stats/keys.ts`:

- Add `| 'abilityAreaMultiplier'` to the `StatKey` union, next to `abilityDamageMultiplier`
  (line ~81).
- Add `abilityAreaMultiplier: 1,` to `STAT_BASES` (next to line ~215).
- Add `abilityAreaMultiplier: { min: 0.5, max: 3 },` to the clamps table (next to line ~312).

`src/stats/contributors/research.ts` — after the existing `manaRegen` line:

```ts
a.mult('abilityAreaMultiplier', 1 + r.abilityAreaBonus);
```

`src/stats/context.ts` — add `abilityAreaBonus: number` to the research slice, and in
`Game.buildStatContext` (`Game.ts:3714` neighbourhood) add
`abilityAreaBonus: this.researchTree.getAbilityAreaBonus(),`.

`src/stats/contributors/talents.ts` — add to the switch:

```ts
case 'ability_area_pct': a.mult('abilityAreaMultiplier', 1 + value); break;
```

`src/stats/contributors/core.ts` — the arcane core already grants ability damage; give it area too:

```ts
if (s.abilityAreaPct !== undefined) a.mult('abilityAreaMultiplier', 1 + s.abilityAreaPct);
```

and add `abilityAreaPct: 0.25` to the arcane core's stat block in `src/data/cores.ts` (find the core
that carries `abilityDamagePct`; add the new field to the same object and to its TS type).

`src/data/statDisplay.ts` — add a row so it is visible in the Stats panel:

```ts
{ key: 'abilityAreaMultiplier', label: 'Ability Area', format: 'mult', hideAt: 1 },
```

(put it directly after the existing `abilityDamageMultiplier` row; match the `format` string that row
uses).

`src/game/Game.applyResolvedStats` — add:

```ts
this.abilityMgr.setAreaMultiplier(stats.abilityAreaMultiplier);
```

### C.4 `AbilityManager` area plumbing

```ts
private areaMultiplier = 1;

setAreaMultiplier(value: number): void {
  this.areaMultiplier = Math.max(0.5, Math.min(3, value));
}

/** The ability's disc right now: level growth × the area stat. */
getEffectiveRadius(id: AbilityId): number {
  return placementRadius(id, this.getAbilityLevel(id)) * this.areaMultiplier;
}
```

Replace **every** `placementRadius(...)` call inside `AbilityManager` with `this.getEffectiveRadius(id)`.

`Game.placementSnapshot()` must call `this.abilityMgr.getEffectiveRadius(id)` — the drawn ring and
the damaged disc must be the same number or the reticle lies again.

### C.5 Talent: area on `ar_frostbite`

`src/data/talentTree.ts`:

- Add `'ability_area_pct'` to the `TALENT_STATS` union (line ~24, next to `chilled_damage_pct`).
- Add `ability_area_pct: 'ability area',` to the label record (line ~1070 neighbourhood).
- Add the effect to `ar_frostbite` (line ~832) so its existing points now also widen discs:

```ts
    effects: [
      { stat: 'slow_strength_pct',  perPoint: /* keep existing */ },
      { stat: 'chilled_damage_pct', perPoint: 0.07 },
      { stat: 'ability_area_pct',   perPoint: 0.05 },
    ],
```

Update the node's `description` to `'+7% damage vs chilled, +5% ability area per point'` (keep any
existing clause about slow strength).

### C.6 Research: `arcane_expansion`

`src/data/research.ts`:

- Add `| 'ability_area'` to `ResearchEffectType`.
- Add the node after `elemental_fury`:

```ts
  {
    id: 'arcane_expansion',
    name: 'Arcane Expansion',
    description: 'Ability areas are 35% larger',
    cost: 900,
    researchTime: 14400,
    category: 'arcane',
    effectType: 'ability_area',
    effectPerLevel: 0.35,
    maxLevel: 1,
    prerequisites: ['arcane_mastery'],
    icon: 'radial-balance',
    color: '#8e7bff',
  },
```

Pick an `icon` that exists in `src/data/icons.ts` — `content-coverage.test.ts:719` asserts every
research node's icon resolves. If `radial-balance` is not in the map, use `'frozen-orb'`.

`src/systems/ResearchTree.ts` — next to `getAbilityPowerBonus`:

```ts
getAbilityAreaBonus(): number {
  return this.sumEffect('ability_area');
}
```

`tests/content-coverage.test.ts:748` — `expect(RESEARCH_NODES.length).toBe(17)` becomes `18`.

---

## Part D — The rebalanced ability table

Replace the ten entries in `ABILITIES` with the values below. Fields not listed are unchanged.

### D.1 Full table (base = level 1)

| Ability | mana | cd | dur | effect | Δ/lvl | area (world units) | area Δ/lvl | unlock | maxLvl | base cost | growth |
|---|---:|---:|---:|---|---|---:|---:|---:|---:|---:|---:|
| Rain of Arrows | 30 | 12 | 0 | **6.5×** | **+1.15** | `world(170)` | `world(16)` | 10 | 10 | 400 | 1.75 |
| Berserk | 40 | 30 | 8 | 2.0× | +0.15 | — | — | 14 | 10 | 900 | 1.85 |
| Frost Nova | 25 | 18 | 5 | 0.50 | −0.02 | `world(190)` | `world(14)` | 18 | 10 | 1300 | 1.80 |
| Chain Lightning | **34** | **14** | 0 | **4.0×** | **+0.45** | `world(120)` | `world(8)` | 22 | 10 | 1400 | 1.80 |
| Gold Rush | 50 | **40** | **12** | **2.6×** | **+0.30** | — | — | 26 | 10 | 3400 | 1.80 |
| Precision Shot | 35 | 22 | 6 | 30 | +2 | — | — | 28 | 10 | 3450 | 1.80 |
| Rocket Barrage | 45 | 20 | 0 | 1.65× | +0.21 | `world(220)` | `world(10)` | 35 | 15 | 12000 | 1.85 |
| Meteor Strike | 60 | 25 | 0 | **18×** | **+2.2** | `world(70)` | `world(9)` | 40 | 10 | 19600 | 1.85 |
| Execute | 50 | 30 | 0 | 12 | +2 | — | — | 50 | 10 | 20000 | 1.85 |
| Vampiric Aura | 45 | 35 | 8 | 0.06 | +0.02 | — | — | 55 | 10 | 25000 | 1.85 |

Everything else on each row (`manaCostPerLevel`, `cooldownReductionPerLevel`, `durationPerLevel`,
`xpPerCast`, `icon`, `color`, `hotkey`, `effectCount`, `effectCountPerLevel`) keeps its current
value, **except**:

- Chain Lightning `manaCostPerLevel` 4 → **3**, `cooldownReductionPerLevel` 0.5 → **0.4**.
- Gold Rush `cooldownReductionPerLevel` 1.5 → **1.0**, `durationPerLevel` 1.0 → **0.6**.

### D.2 `autoCast` conditions (added to the table rows)

```ts
rain_of_arrows:  { minInDisc: 3 },
berserk:         { minEnemies: 4 },
frost_nova:      { minInDisc: 4 },
chain_lightning: { minEnemies: 2 },
gold_rush:       { minEnemies: 6 },
precision_shot:  { minEnemies: 3 },
rocket_barrage:  { minEnemies: 3 },
meteor_strike:   { minInDisc: 1 },
execute:         { minEnemies: 1 },
vampiric_aura:   { towerHpBelow: 0.75 },
```

### D.3 Rain of Arrows — the crowd nuke, inside the disc

New `description`: `'Rains arrows on a {area} area for {dmg}x tower damage.'`

- `{area}` is a new token: `Math.round(placementRadius(def.id, level) / WORLD_SCALE)` formatted as
  `"<n> px"` — quote it in **pre-scale** units, the same units `range` and the enemy codex use, so
  the number is comparable to the range ring the player already reads.
- `dealAoEDamage` becomes disc-scoped:

```ts
private dealAoEDamage(multiplier: number, cast: CastContext): void {
  const ts = this.tower.snapshot;
  const raw = ts.baseDamage * multiplier * this.damageMultiplier;
  const cx = cast.point?.x ?? ts.x;
  const cy = cast.point?.y ?? ts.y;
  const r = this.getEffectiveRadius(cast.id);
  const focusBonus = cast.focused ? 1 + PLACEMENT_FOCUS_DAMAGE_BONUS : 1;
  for (const e of this.enemies.queryRadius(cx, cy, r, this.placementScratch)) {
    if (!isTargetable(e)) continue;
    const final = this.tower.applyResists(e, raw * focusBonus);
    this.enemies.damage(e, final, false);
  }
}
```

Note the focus bonus now applies to the **whole disc** rather than to a sub-disc, because the disc
*is* the effect. `PLACEMENT_FOCUS_DAMAGE_BONUS` drops **0.6 → 0.25**: a player-aimed disc is already
better placed than an auto-aimed one, and +60% on top of a strictly-better placement is too much.

**Coverage math to sanity-check the retune.** L1 disc = `world(170)` = 442 world units. The melee
pile parks inside `TOWER_HIT_RADIUS + enemy radius + ENEMY_GAP` of the tower — well under 200 world
units — so a tower-centred or pile-centred disc catches the entire melee crowd. What it loses is
walk-in stragglers and siege enemies (which halt at `ARENA_RANGE_CAP - 15` = 640). Damage rises
`4.2 → 6.5` (+55%) at L1 and `11.85 → 16.85` (+42%) at L10 to pay for that, and the disc widens to
`world(314)` = 816 world units at L10, which reaches the siege standoff ring from a well-chosen spot.

### D.4 Meteor Strike — the single-target nuke

- Delete `METEOR_SPLASH_RADIUS` and `METEOR_SPLASH_MULTIPLIER`.
- Add `export const METEOR_SPLASH_FRACTION = 0.55;` — splash is now a **fraction** of the heavy hit,
  which is what every other splash in the game is (`ROCKET_SPLASH_FRACTION`, `chargeSplashFraction`).
- The crater is the ability's disc: `this.getEffectiveRadius('meteor_strike')`.
- The heavy hit goes to the **highest-HP targetable enemy inside the crater** (not the nearest), which
  is what "smashes the highest-HP enemy" has always claimed.

```ts
private dealMeteorStrike(multiplier: number, cast: CastContext): { x: number; y: number } | null {
  const ts = this.tower.snapshot;
  const r = this.getEffectiveRadius(cast.id);
  const cx = cast.point?.x ?? ts.x;
  const cy = cast.point?.y ?? ts.y;

  let target: Enemy | null = null;
  let bestHp = -Infinity;
  const inCrater: Enemy[] = [];
  for (const e of this.enemies.queryRadius(cx, cy, r, this.placementScratch)) {
    if (!isTargetable(e)) continue;
    inCrater.push(e);
    if (e.hp > bestHp) { bestHp = e.hp; target = e; }
  }
  if (!target) return { x: cx, y: cy };   // a whiff: the crater still draws

  const heavyRaw = ts.baseDamage * multiplier * this.damageMultiplier
    * (1 + this.meteorDamageBonus) * (cast.focused ? 1 + PLACEMENT_FOCUS_DAMAGE_BONUS : 1);
  this.enemies.damage(target, this.tower.applyResists(target, heavyRaw), false);

  const splashRaw = heavyRaw * METEOR_SPLASH_FRACTION;
  for (const e of inCrater) {
    if (e.id === target.id) continue;
    this.enemies.damage(e, this.tower.applyResists(e, splashRaw), false);
  }
  return { x: cx, y: cy };
}
```

**Note `inCrater` is a fresh array, not `placementScratch`.** `enemies.damage` can splice the enemy
list and re-enter `queryRadius`, so iterating the shared scratch buffer while dealing damage is a
use-after-free. This is the one place in this plan where the shared buffer must not be reused.

Power check at L1 vs a five-enemy crowd: old `10 + 4 × 20 = 90×`; new `18 + 4 × 9.9 = 57.6×`. Vs a
lone boss: old `10×`, new `18×`. That is the intended role swap — Rain of Arrows took over the crowd
job and gained ~55% damage to do it with.

`pickHighestHpTarget()` becomes dead code once this lands. Delete it.

### D.5 Execute — a real boss finisher

Replace `EXECUTE_BOSS_MULTIPLIER` with:

```ts
/**
 * What Execute takes off a boss, as a fraction of the boss's **max** HP.
 *
 * A multiple of `baseDamage` (what this used to be) is a rounding error against
 * a wave-50 boss bar — see plan §1.5. A fraction of max HP is what makes the
 * threshold mean something: below the gate, roughly four fifths of what is left
 * comes off, at every level, and what levelling buys is a *wider* gate.
 */
const EXECUTE_BOSS_MAXHP_FRACTION = 0.05;
const EXECUTE_BOSS_MAXHP_PER_LEVEL = 0.008;
```

```ts
private applyExecute(thresholdPct: number): void {
  const level = this.getAbilityLevel('execute');
  const bossFrac = EXECUTE_BOSS_MAXHP_FRACTION
    + EXECUTE_BOSS_MAXHP_PER_LEVEL * (Math.max(1, level) - 1);
  const bossGate = thresholdPct / 200;      // percent → fraction, halved
  const gate = thresholdPct / 100;
  for (const e of [...this.enemies.list]) {
    if (!isTargetable(e)) continue;
    const ratio = e.hp / e.maxHp;
    if (e.type === 'boss') {
      if (ratio > bossGate) continue;
      // Deliberately *not* through `applyResists`: an execute that a resist can
      // shrug is not an execute. It is capped at the bar that is left so it
      // cannot roll over into overkill accounting.
      const amount = Math.min(e.hp, e.maxHp * bossFrac * this.damageMultiplier);
      this.enemies.damage(e, amount, false);
    } else {
      if (ratio > gate) continue;
      this.enemies.damage(e, Math.max(1, e.hp), false);
    }
  }
}
```

Note the `[...this.enemies.list]` copy — `damage` can splice the live list mid-iteration and the old
code was already at risk here.

New `description`: `'Kills non-boss enemies below {dmg}% HP. Bosses below {boss}% HP lose {bossdmg}% of their max HP.'`
`{boss}` keeps its meaning (`floor(effectValue / 2)`); `{bossdmg}` is a new token rendering
`stripTrailingZero(bossFrac * 100, 1)`.

At L1: gate 6%, damage 5% of max HP = **83% of the remaining bar**. At L10: gate 15%, damage 12.2% of
max HP = **81% of the remaining bar**. Consistent by design — what levelling buys is the earlier gate.

### D.6 Frost Nova — control that finally scales into damage

Three layers, in the order they are applied:

1. **Global floor.** `enemies.applySlow(GLOBAL_NOVA_SLOW, duration)` where
   `export const GLOBAL_NOVA_SLOW = 0.85;` — a flat 15% field-wide slow, level-independent. This is
   the panic button that must not regress for an idle player.
2. **The disc.** Every targetable enemy inside gets `applyChill(e, factor, chillDuration)` with
   `factor = max(0.05, effectValue × (1 - slowStrengthBonus) - (focused ? PLACEMENT_FOCUS_CHILL : 0))`
   and `chillDuration = duration × (focused ? PLACEMENT_FOCUS_CHILL_DURATION : 1)`.
3. **Brittle.** A `BuffRegistry` entry so the cold build has a damage channel that does not depend on
   a talent:

```ts
const BUFF_FROST_BRITTLE = 'ability:frostBrittle';
export const FROST_BRITTLE_BASE = 0.25;
export const FROST_BRITTLE_PER_LEVEL = 0.03;

export function frostBrittle(level: number): number {
  return FROST_BRITTLE_BASE + FROST_BRITTLE_PER_LEVEL * (Math.max(1, level) - 1);
}
```

```ts
this.buffs.set({
  id: BUFF_FROST_BRITTLE,
  stat: 'chilledDamageBonus',
  kind: 'add',
  value: frostBrittle(this.getAbilityLevel(cast.id)),
  label: 'Frost Nova',
  remaining: null,
});
```

`clearEffect` currently no-ops for `'slow'`; make it `this.buffs.clear(BUFF_FROST_BRITTLE)`. Add the
same clear to `AbilityManager.reset()`.

This works with no other plumbing: `chilledDamageBonus` resolves through `resolveStats` →
`Game.applyResolvedStats` → `projectileMgr.setChilledDamageBonus`, and `Game` already recomputes on
`buffs.version` changes (`Game.ts:3592`). `ProjectileManager` applies it to any enemy for which
`enemies.isSlowed(enemy)` is true — which, thanks to layer 1, is **every** enemy for the nova's
duration. So Frost Nova is now "+25% tower damage to everything for 5 s, and the crowd you aimed at
stops moving."

New `description`:
`'Chills a {area} area by {slow}% for {dur}s. All enemies take +{brittle}% damage while it lasts.'`
`{brittle}` renders `stripTrailingZero(frostBrittle(level) * 100)`.

`EFFECT_LABELS.slow` stays `'Slow'`.

### D.7 Chain Lightning — cheap, frequent, mid-crowd

- `CHAIN_DECAY` **0.65 → 0.82**.
- `CHAIN_BOUNCE_BASE` **5 → 6**, `CHAIN_BOUNCE_MAX` **9 → 12**.
- `CHAIN_BOUNCE_RADIUS` stays `world(200)`.
- The chain **seeds at the enemy nearest the placed point** rather than nearest the tower. When there
  is no point (non-targeted path, which cannot happen after §C.2 since the ability is now targeted),
  fall back to nearest-the-tower.
- A focused (player-aimed) cast gets **+2 bounces**.

```ts
private dealChainLightning(baseMultiplier: number, cast: CastContext): void {
  const ts = this.tower.snapshot;
  const level = this.getAbilityLevel('chain_lightning');
  const bounces = Math.min(
    CHAIN_BOUNCE_MAX + this.chainBounceBonus,
    CHAIN_BOUNCE_BASE + Math.floor(level / 2) * CHAIN_BOUNCE_PER_LEVEL
      + this.chainBounceBonus + (cast.focused ? 2 : 0),
  );
  const seedX = cast.point?.x ?? ts.x;
  const seedY = cast.point?.y ?? ts.y;
  let current = this.nearestWithin(seedX, seedY, this.getEffectiveRadius(cast.id));
  // …rest unchanged: the `path` starts at the tower for the visual, the walk
  // and the `hit` Set are as they are today.
}
```

L1 total against a dense crowd: `4.0 × (1 + 0.82 + 0.672 + 0.551 + 0.452 + 0.371)` = **15.5×** for 34
mana (0.46/mana, up from 0.16), on a 14 s cooldown.

### D.8 Rocket Barrage — targeted volley

Make it targeted (`areaRadius`, table §D.1). The rockets pick their targets **inside the disc**
instead of anywhere on the field:

```ts
const alive = this.enemies
  .queryRadius(cx, cy, this.getEffectiveRadius('rocket_barrage'), this.placementScratch)
  .filter(e => isTargetable(e));
```

Copy that filtered result into a new array before firing (same re-entrancy reason as §D.4 —
`projectileMgr.fire` does not damage, but the shuffle mutates and the buffer is shared).

Focused casts add `PLACEMENT_FOCUS_DAMAGE_BONUS` to `rawDamage`. The dud/empty-field behaviour is
unchanged.

### D.9 Gold Rush — shorter, more frequent, and it magnetises

- Cooldown 60 → 40, duration 15 → 12, effect 3.0 → 2.6 (uptime 25% → 30%, effective gold multiplier
  `1 + 0.3 × 1.6` = **1.48×**, was `1 + 0.25 × 2` = 1.50× — deliberately flat, the value is the
  shorter wait).
- While active, all loot orbs drift home at **full value**.

`src/systems/LootManager.ts` — replace `setMagnet(enabled: boolean)` with a ref-counted version so
the blessing and the ability cannot clobber each other:

```ts
private readonly magnetSources = new Set<string>();

/** Ref-counted magnet: any live source turns it on. */
setMagnetSource(source: 'blessing' | 'goldRush', enabled: boolean): void {
  if (enabled) this.magnetSources.add(source);
  else this.magnetSources.delete(source);
  const on = this.magnetSources.size > 0;
  if (on === this.magnet) return;
  this.magnet = on;
  this.autoRate = on ? LOOT_TUNING.magnetCollectRate : LOOT_TUNING.autoCollectRate;
}
```

Clear `magnetSources` in `LootManager.reset()`. Update the existing blessing call site to
`setMagnetSource('blessing', enabled)`.

In `AbilityManager`, the `gold_buff` case additionally calls a new dep
`deps.setGoldRushMagnet(true)`, and `clearEffect('gold_buff')` calls it with `false`. Wire the dep in
`Game` to `(on) => this.lootMgr.setMagnetSource('goldRush', on)`. Also call it with `false` in
`AbilityManager.reset()`.

### D.10 Untouched

Berserk, Precision Shot and Vampiric Aura keep every number they have. They are self-buffs with no
targeting story and their curves already read correctly.

### D.11 `formatEffectForDisplay` additions

`aoe_damage`, `single_target_damage`, `chain_damage` keep `"<n>x"`. `slow` keeps `"<n>%"`. Add
nothing new — the extra numbers live in `displayText` and in the new tooltip Area row (§G.4).

---

## Part E — The placed effect must look placed

### E.1 Effects take a centre and a radius

`src/systems/EffectsManager.ts`:

```ts
emitRainOfArrows(cx: number, cy: number, radius: number): void {
  const n = this.n(40);
  for (let i = 0; i < n; i++) {
    const angle = Math.random() * Math.PI * 2;
    // sqrt for a uniform disc rather than a centre-heavy one.
    const dist = radius * Math.sqrt(Math.random());
    ...
  }
}

emitFrostNovaRing(cx: number, cy: number, radius: number): void {
  // Particle speed is derived so the ring reaches `radius` within its life,
  // instead of the hard-coded 380-440 it uses today.
  const life = 0.55;
  const speed = radius / life;
  ...
}
```

Both currently hard-code `40 + Math.random() * 420` / `380 + Math.random() * 60`. Replace those with
the radius-derived values so the visual and the damage disc agree at every level.

### E.2 `Game`'s `ability_visual` handler uses the target

```ts
this.bus.on('ability_visual', (payload: unknown) => {
  const p = payload as {
    id: AbilityId;
    def: { effectType: string };
    target?: { x: number; y: number } | null;
    radius?: number;
  };
  const t = this.tower.snapshot;
  const tx = p.target?.x ?? t.x;
  const ty = p.target?.y ?? t.y;
  const r = p.radius ?? 0;
  switch (p.def.effectType) {
    case 'aoe_damage':   this.effects.emitRainOfArrows(tx, ty, r); break;
    case 'slow':         this.effects.emitFrostNovaRing(tx, ty, r); break;
    case 'single_target_damage':
      this.effects.emitMeteor(tx, ty, t.x, t.y);
      this.effects.emitShockwaveRing(tx, ty, r, withAlpha(FX.ember, 0.8), 5);
      this.triggerCanvasShake();
      break;
    case 'rocket_barrage':
      this.effects.emitHitSparks(t.x, t.y, FX.ember, 8);
      break;
    // fire_rate_buff / gold_buff / crit_buff / lifesteal_buff / execute_damage
    // / chain_damage: unchanged, they are not placed.
  }
});
```

`AbilityManager.tryCast` must add `radius` to the emitted payload:

```ts
this.bus.emit('ability_visual', {
  id, def, target: visualTarget,
  radius: isTargeted(id) ? this.getEffectiveRadius(id) : 0,
});
```

### E.3 The reticle redraw

`Renderer.drawPlacement` gains three things. Extend the snapshot type to
`{ x, y, radius, label, color, valid }`:

```ts
private drawPlacement(ctx: CanvasRenderingContext2D, p: RenderSnapshot['placement']): void {
  if (!p) return;
  const tint = p.valid ? p.color : FX.blood;   // the palette's hostile red
  ctx.save();
  // Filled disc first, so the ring reads as an edge rather than a floating circle.
  ctx.fillStyle = withAlpha(tint, 0.10);
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
  ctx.fill();
  // Rotating dashed rim.
  ctx.strokeStyle = withAlpha(tint, 0.9);
  ctx.lineWidth = entity(2);
  ctx.setLineDash([entity(10), entity(7)]);
  ctx.lineDashOffset = -this.time * 40;
  ctx.stroke();
  ctx.setLineDash([]);
  // Inner pulse ring — makes the size change legible when the radius grows.
  const pulse = 0.55 + 0.45 * Math.sin(this.time * 4);
  ctx.strokeStyle = withAlpha(lighten(tint, 0.5), 0.55);
  ctx.lineWidth = entity(1);
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.radius * pulse, 0, Math.PI * 2);
  ctx.stroke();
  // Crosshair, scaled with `entity()` like every other drawn size.
  ctx.strokeStyle = withAlpha(lighten(tint, 0.55), 0.95);
  ctx.lineWidth = entity(1.5);
  ctx.beginPath();
  ctx.moveTo(p.x - entity(10), p.y); ctx.lineTo(p.x + entity(10), p.y);
  ctx.moveTo(p.x, p.y - entity(10)); ctx.lineTo(p.x, p.y + entity(10));
  ctx.stroke();
  ctx.restore();
}
```

Note the existing code draws the crosshair at raw `±10` world units, which at `ENTITY_SCALE` is a
6-pixel cross on a 400-unit ring — invisible. `entity(10)` fixes that.

`Game.placementSnapshot()`:

```ts
private placementSnapshot(): { x: number; y: number; radius: number; label: string; color: string; valid: boolean } | null {
  const id = this.placement.pending;
  if (!id) return null;
  if (!this.pointerOnCanvas && !this.mouseDown) return null;
  const def = ABILITY_BY_ID[id];
  const radius = this.abilityMgr.getEffectiveRadius(id);
  return {
    x: this.mouseX,
    y: this.mouseY,
    radius,
    label: def?.name ?? '',
    color: def?.color ?? '#ffffff',
    // "Valid" means the cast will actually hit something. A whiff is the
    // player's business to see *before* the click, not after the mana is gone.
    valid: this.enemyMgr.queryRadius(this.mouseX, this.mouseY, radius).some(isTargetable),
  };
}
```

Use a dedicated scratch array for that `queryRadius` (do **not** reuse `AbilityManager`'s), or accept
the default allocation — this runs once per frame at most, only while placing.

### E.4 Count badge on the reticle

Draw the number of targetable enemies inside the disc just above the rim, so the player can compare
two candidate spots. Add `count: number` to the snapshot (the `queryRadius` in §E.3 already has it)
and render it in `drawPlacement` with the renderer's existing world-space text helper, at
`(p.x, p.y - p.radius - entity(10))`.

---

## Part F — Automation

### F.1 New priority order

`AUTO_CAST_PRIORITY` in `src/systems/AutomationManager.ts` — reorder by damage-per-mana with the
buffs ahead of the economy:

```
meteor_strike → execute → rain_of_arrows → chain_lightning → rocket_barrage
  → berserk → precision_shot → frost_nova → vampiric_aura → gold_rush
```

Rationale to put in the doc comment: Meteor and Execute lead **only because their conditions gate
them** (`minInDisc: 1` and a boss/low-HP field respectively) — an unconditional expensive cast at the
top of the list is what starved the roster before. Rain of Arrows, the best damage-per-mana in the
table, sits third and casts on nearly every tick that has a crowd.

### F.2 `AbilityManager.autoCastConditionMet`

```ts
/**
 * Whether automation should spend mana on `id` right now (plan §F.2).
 *
 * The mana budget cannot pay for the whole roster, so automation has to
 * choose, and "is it off cooldown" is not a choice. A condition is a floor,
 * never a preference: an ability with no `autoCast` block is always allowed.
 */
autoCastConditionMet(id: AbilityId): boolean {
  const c = ABILITY_BY_ID[id]?.autoCast;
  if (!c) return true;

  if (c.minEnemies !== undefined) {
    let n = 0;
    for (const e of this.enemies.list) if (isTargetable(e)) n++;
    if (n < c.minEnemies) return false;
  }
  if (c.minInDisc !== undefined) {
    const spot = this.pickBestSpot(id);
    if (!spot) return false;
    let n = 0;
    for (const e of this.enemies.queryRadius(spot.x, spot.y, this.getEffectiveRadius(id), this.placementScratch)) {
      if (isTargetable(e)) n++;
    }
    if (n < c.minInDisc) return false;
  }
  if (c.bossOnly || c.bossHpBelow !== undefined) {
    const boss = this.enemies.list.find(e => e.type === 'boss' && isTargetable(e));
    if (!boss) return false;
    if (c.bossHpBelow !== undefined && boss.hp / boss.maxHp > c.bossHpBelow) return false;
  }
  if (c.towerHpBelow !== undefined) {
    const ts = this.tower.snapshot;
    if (ts.maxHp <= 0 || ts.hp / ts.maxHp > c.towerHpBelow) return false;
  }
  return true;
}
```

`runAutoCast` runs once per second (`AUTO_CAST_INTERVAL`), so the extra `pickBestSpot` scan for the
two `minInDisc` abilities is at most twice per second. That is acceptable; do **not** add caching.

### F.3 Manual casts are never gated

`autoCastConditionMet` is consulted **only** in `runAutoCast`. `canCast` and `tryCast` must not call
it — a player who presses the key gets the cast, full stop.

---

## Part G — UI

### G.1 The placement prompt

`Game.beginPlacement` prompt text becomes:

```
Click to place {name} — Esc to cancel
```

Drop the hotkey from the string (it is on the tile and in the keybinds overlay, and the string is
already long on mobile). On a touch device, use `Drag to aim {name}, lift to cast — tap the tile to
cancel`. Detect touch with whatever the codebase already uses for its mobile layout; if there is no
such helper, use `matchMedia('(pointer: coarse)').matches` computed once at construction.

### G.2 A whiff is refused, not eaten

In `castPlacedAbility`, before `tryCast`, check for at least one targetable enemy in the disc. If
there is none, do **not** spend the cast: cancel placement and toast
`{kind: 'info', text: 'No target there', life: 1.5}`. Aiming is now the default path, so an
easy-to-make mistake must not cost a 60-mana meteor.

Non-targeted abilities and the automation path keep today's behaviour (mana is spent on an empty
field) — nothing regresses for the idle player.

### G.3 Ability bar

Per §A.4: crosshair glyph on targeted tiles, `is-arming` class on the armed one. Add the CSS in
`src/styles/main.css` next to the existing `.ability-*` rules:

The tile element is `button.ability-btn` inside `div.ability-bar-slot` (`AbilityBar.ts:238`/`243`),
and the glyph is a new child appended next to `.ability-hotkey`:

```css
.ability-btn.is-arming { outline: 2px solid currentColor; animation: ability-arm-pulse 0.9s ease-in-out infinite; }
@keyframes ability-arm-pulse { 0%, 100% { outline-offset: 0; } 50% { outline-offset: 3px; } }
.ability-btn .ability-aim-glyph { position: absolute; top: 2px; right: 3px; font-size: 10px; opacity: 0.7; }
```

### G.4 Tooltip: an Area row

`src/ui/abilityFormat.ts` — after the Duration row, add a row rendered only when
`currentStats.area > 0`:

```
Area   <cur> → <next>
```

`EffectiveAbilityStats` gains `area: number` and `displayArea: string` (`"<n> px"`, in pre-scale
units — `Math.round(area / WORLD_SCALE)`). `computeEffectiveStats` fills them from
`placementRadius(def.id, level)`; `AbilityManager.getEffectiveStats` overwrites `area` with
`getEffectiveRadius(id)` and recomputes `displayArea`, exactly as it already does for `manaCost` and
`cooldown`.

### G.5 Keybinds overlay

Wherever the keybinds/help overlay lists controls, add a line: *"Ability hotkey → arm a targeted
ability; click the battlefield to place it. Esc cancels."* Find it by grepping for the existing
Space/`R` entries.

---

## Part H — Save & preference migration

### H.1 `SAVE_VERSION` 19 → 20

`src/systems/SaveManager.ts`:

- `const SAVE_VERSION = 20;`
- Add `19` to the accepted-versions chain on line ~649.
- Add `migrateV19toV20`. There is **no ability-state shape change** — levels, XP, cooldowns and
  `autoCastEnabled` all keep their meaning. The migration exists for one reason: ability levels are
  run-scoped and this retune changes what a level is worth, so the migration must **clamp any level
  above the new `maxLevel`** (no maxLevel dropped, so this is a no-op safety net) and leave everything
  else untouched. Write it as an explicit pass-through with that clamp so the version chain is
  unbroken:

```ts
function migrateV19toV20(data: SaveShape): void {
  for (const def of ABILITIES) {
    const s = data.abilities?.[def.id];
    if (!s) continue;
    s.level = Math.max(1, Math.min(def.maxLevel, s.level));
  }
}
```

### H.2 The `instantCast` localStorage preference

In the new `readAutoAimPreference`:

```ts
function readAutoAimPreference(): boolean {
  try {
    const next = localStorage.getItem(AUTO_AIM_KEY);
    if (next !== null) return next !== '0';
    // One-time carry-over: the old `instantCast` flag meant "auto-aim my own
    // presses". Its *value* still reads correctly as "auto-aim", so it seeds
    // the new preference and is then removed.
    const legacy = localStorage.getItem(LEGACY_INSTANT_CAST_KEY);
    if (legacy !== null) {
      localStorage.removeItem(LEGACY_INSTANT_CAST_KEY);
      const on = legacy !== '0';
      localStorage.setItem(AUTO_AIM_KEY, on ? '1' : '0');
      return on;
    }
  } catch { /* private mode */ }
  return true;
}
```

`LEGACY_INSTANT_CAST_KEY` is `'the-tower-instant-cast'`; `AUTO_AIM_KEY` is `'the-tower-autocast-aim'`.

---

## Part I — Tests and sim checks

### I.1 `tests/abilities.test.ts`

Keep the existing structure (stat-surface goldens, then behaviour through the real managers). Update
and add:

**Retuned goldens** — every existing expectation touching Rain of Arrows, Chain Lightning, Meteor
Strike, Frost Nova, Execute or Gold Rush must be recomputed from the §D.1 table. Rocket Barrage's
count/damage goldens are unchanged.

**New cases:**

1. `placementRadius` grows linearly and clamps at `maxLevel`:
   `placementRadius('rain_of_arrows', 1) === world(170)`,
   `placementRadius('rain_of_arrows', 10) === world(170) + world(16) * 9`,
   `placementRadius('rain_of_arrows', 99) === placementRadius('rain_of_arrows', 10)`.
2. `getEffectiveRadius` multiplies by the area stat and clamps to `[0.5, 3]`.
3. **Rain of Arrows is disc-scoped**: spawn one enemy inside the disc and one 2000 world units away,
   cast with an explicit point, assert only the near one lost HP.
4. **The focus bonus applies to the whole disc, once**: a `{x,y}` cast deals
   `1 + PLACEMENT_FOCUS_DAMAGE_BONUS` times what an `'auto'` cast on the same spot deals.
5. **Meteor splash is a fraction**: with two enemies in the crater and the higher-HP one as target,
   the second one's damage is `METEOR_SPLASH_FRACTION` × the first one's. Regression-guards §1.4.
6. **Meteor picks the highest-HP enemy in the crater**, not the nearest.
7. **Meteor does not crash when the crater kills mid-iteration** — put five 1-HP enemies in the
   crater and assert all five die and no exception escapes (guards the scratch-buffer hazard).
8. **Execute takes a fraction of boss max HP**: a boss at 5% of a 1e6 bar loses
   `min(hp, 1e6 * 0.05)`; at L10 the gate is 15% and the fraction 12.2%.
9. **Execute ignores resists**: a boss with a heavy resist loses the same amount.
10. **Frost Nova sets the brittle buff and clears it on expiry**: cast, assert
    `buffs` has `ability:frostBrittle` at `frostBrittle(level)`, tick past the duration, assert it is
    gone.
11. **Frost Nova still slows globally**: an enemy far outside the disc reports `isSlowed === true`.
12. **Chain Lightning seeds at the placed point**, not the tower: two clusters, cast on the far one,
    assert the near one is untouched.
13. **`autoCastConditionMet`**: `rain_of_arrows` is false with 2 enemies in the best disc and true
    with 3; `vampiric_aura` is false at full tower HP and true at 50%.
14. **A manual cast is never condition-gated**: `tryCast('rain_of_arrows', wave, {x,y})` succeeds on a
    field with one enemy.
15. **Gold Rush toggles the magnet**: cast, assert the injected `setGoldRushMagnet` saw `true`; tick
    past the duration, assert `false`.

### I.2 New `tests/ability-targeting.test.ts`

Covers Parts A and B without a canvas, driving `AbilityPlacement` and a `Game` double where needed:

1. A manual cast of a targeted ability **arms** rather than casting: `castAbility('rain_of_arrows')`
   leaves mana unchanged and `pendingPlacement === 'rain_of_arrows'`.
2. A manual cast of a non-targeted ability (`berserk`) casts immediately.
3. Arming a second ability while one is pending replaces it (and the prompt text changes).
4. `setMouseInput(x, y, false)` moves the placement snapshot — the hover-tracking regression from
   §1.1. Assert `placementSnapshot().x === x` after a **move with the button up**.
5. `releasePointer()` leaves the stored position alone.
6. The snapshot's `radius` equals `abilityMgr.getEffectiveRadius(id)` for the same id and level.
7. `valid` is false with no enemy in the disc and true with one.
8. A click on an empty disc refuses the cast: mana unchanged, placement cleared, one toast.
9. Escape, `wave_started`, and the same hotkey each cancel.

### I.3 `sim/checks.ts` §3.1

Add checks:

```ts
// Damage-per-mana must not span more than 6x across the damage abilities.
// Plan §1.7 measured a 26x spread; that is what made half the roster dead.
```

- Compute L1 damage-per-mana for `rain_of_arrows`, `chain_lightning`, `meteor_strike`,
  `rocket_barrage` against a modelled crowd of 15, and assert `max / min <= 6`.
- Assert every targeted ability's L1 disc is at least `world(60)` and its `maxLevel` disc is at most
  `ARENA.minHalfExtent` (936) — a disc bigger than the short half-extent is a screen-wipe with a
  reticle drawn on it.
- Assert `METEOR_SPLASH_FRACTION < 1` (regression-guards §1.4 permanently).
- Assert every ability with an `autoCast` condition still has at least one field set.
- Keep the existing front-loading and cost-growth checks unchanged.

### I.4 `sim/model.ts`

`BEHAVIOR_DPS_CREDIT.targetedCastDps` **0.02 → 0.06**, with the comment updated: five of ten
abilities are now targeted rather than three, the focus bonus is `PLACEMENT_FOCUS_DAMAGE_BONUS`
(0.25) across the whole disc rather than 0.6 across a sub-disc, and a placed disc that misses now
costs real coverage — so the gap between perfect placement and the auto-placer is genuinely wider
than the old estimate.

---

## Part J — Documentation

Rewrite in `docs/ability-system.md`:

- The per-ability tuning table (§D.1 numbers).
- The upgrade table (per-level deltas, plus the new **Area/lvl** column).
- The **Targeted Casts** section: replace the four-row `instantCast` table with the new routing —
  *manual press → always arms; automation → `pickBestSpot` when auto-aim is on, tower-centred when
  off*; the focus bonus is 0.25 across the whole disc; the disc is `placementRadius(id, level) ×
  abilityAreaMultiplier`.
- The **Effect Types** table: `aoe_damage` is disc-scoped; `slow` is global-floor + disc-chill +
  brittle buff; `single_target_damage` splash is a fraction; `execute_damage` boss branch is % max HP;
  `chain_damage` seeds at the placed point.
- New section **Ability area**, listing every source of `abilityAreaMultiplier` (level growth,
  `ar_frostbite` talent, `arcane_expansion` research, arcane core).
- New section **Auto-cast conditions**, with the §D.2 table and the §F.1 priority order.
- The buff-hook table gains `ability:frostBrittle` → `chilledDamageBonus` (add).
- The save-migration note: v19 → v20.

`docs/loot-system.md` — the "Click-placed abilities" / `instantCast` section is replaced by the new
routing, plus the Gold Rush magnet source.

`docs/ui-system.md` — the placement-prompt section: new copy, the touch drag-to-aim idiom, the
reticle's validity state and count badge.

`docs/research-system.md` — `arcane_expansion` row.

`docs/xp-talent-system.md` — `ar_frostbite` now also grants `ability_area_pct`.

`docs/stat-pipeline.md` — `abilityAreaMultiplier` in the stat-key table with its clamp.

---

## Part K — Ordered task list

Each step is independently compilable and testable. Do them in order.

1. **Stat key.** `abilityAreaMultiplier` in `keys.ts` (union, base, clamp) + `statDisplay.ts` row.
   Contributors: talents, research, core. `Game.applyResolvedStats` → `setAreaMultiplier`. Run
   `npx vitest run tests/stats.test.ts`.
2. **Data shape.** `AbilityDef.areaRadius` / `areaRadiusPerLevel` / `autoCast`, the
   `AutoCastCondition` interface, `isTargeted`, level-aware `placementRadius`. Delete
   `PLACEABLE_ABILITIES` and `METEOR_SPLASH_RADIUS`; fix the resulting compile errors by routing
   through `AbilityManager.getEffectiveRadius`.
3. **Table retune.** Type in §D.1 and §D.2. `npx vitest run tests/abilities.test.ts` will fail on the
   goldens — that is expected; update them in step 10.
4. **Effect rewrites.** `dealAoEDamage`, `dealMeteorStrike`, `applyExecute`, `dealChainLightning`, the
   `slow` case (+ brittle buff and its clear), `applyRocketBarrage`. Introduce the `CastContext` type
   and the `CastPlacement` union.
5. **Automation.** `autoCastConditionMet`, new `AUTO_CAST_PRIORITY`, `getAutoAim` dep,
   `'auto' | 'tower'` routing.
6. **Loot magnet.** `setMagnetSource`, the Gold Rush dep, `reset()` clears.
7. **Targeting routing.** `Game.castAbility`, `autoCastAutoAim` rename + preference migration,
   `SettingsPanel` rename and copy.
8. **Pointer.** `setMouseInput` always tracks, `releasePointer`, `setPointerOnCanvas`,
   `commitPlacementAtPointer`, the `main.ts` listener changes (mouseleave/mouseenter, touch
   drag-to-aim).
9. **Visuals.** `placementSnapshot` (radius/color/valid/count), `drawPlacement`, the radius-aware
   effect emitters, the `ability_visual` payload and handler, ability-bar glyph + `is-arming` CSS,
   the tooltip Area row, the prompt copy, the empty-disc refusal.
10. **Research node** `arcane_expansion` + `getAbilityAreaBonus` + `RESEARCH_NODES.length` 18.
    **Talent** `ability_area_pct` on `ar_frostbite`.
11. **Save version** 19 → 20 + `migrateV19toV20` + the accepted-versions chain.
12. **Tests.** Update `tests/abilities.test.ts` goldens, add the fifteen new cases, add
    `tests/ability-targeting.test.ts`, bump `tests/content-coverage.test.ts`.
13. **Sim.** `sim/checks.ts` §3.1 additions, `sim/model.ts` `targetedCastDps`. Run the sim entry
    point (`npm run sim` or whatever `package.json` names it) and confirm every check passes.
14. **Docs.** All six files in Part J.
15. **Full suite.** `npx vitest run` — everything green — then `npx tsc --noEmit`.

---

## Part L — Risks and the answers to them

| Risk | Answer |
|---|---|
| **Disc-scoping Rain of Arrows and Frost Nova is a nerf for idle players.** | Damage rises 55% at L1 / 42% at L10, and the auto-placer already picks the densest cluster. The melee pile parks well inside the L1 disc, so the coverage actually lost is walk-in stragglers. `sim/checks.ts` §3.1's damage-per-mana check pins the result. |
| **Meteor's crowd damage drops 36%.** | Intended: Rain of Arrows is now the crowd nuke and gained the damage to be one, while Meteor's single-target output rose 80%. The roles were previously both filled by Meteor and neither by Rain of Arrows. |
| **Always-arming makes fast play slower.** | It is the behaviour the user asked for, and the cost is one click on abilities that already sit behind 12–35 s cooldowns. Auto-cast (which most players leave on) is unaffected. |
| **`enemies.damage` re-entrancy through the shared `placementScratch`.** | §D.4 and §D.8 copy the query result into a fresh array before any damage is dealt. Test I.1.7 guards it. |
| **The brittle buff double-counts with `ar_frostbite`.** | It does, additively, on the `chilledDamageBonus` stat — which is the correct composition and already clamped `{min: 0}`. A cold build stacking 25% (nova) + 7%/point (talent) is the payoff the talent branch was missing. |
| **`chilledDamageBonus` only applies to projectile hits.** | Left as-is deliberately: making it apply to ability damage too would let Frost Nova amplify its own follow-up nuke, which is a multiplicative loop. The buff is a *tower* damage amplifier; that is the whole point of casting the nova before the volley lands. |
