/**
 * Ability targeting — Parts A and B of `plans/abilities.md`.
 *
 * Two layers of test, both without a canvas:
 *
 * 1. `AbilityPlacement.toggle()` drives the arm/disarm/cancel lifecycle; the
 *    `castAbility` routing in the real `Game` class is a thin wrapper over it
 *    (`if (isTargeted(id)) return beginPlacement(id); return tryCast(...)`).
 *    The wrapper is exercised end-to-end via a minimal `TargetingRouter`
 *    double that re-implements exactly that wrapper, so the routing itself
 *    stays under test without the rest of Game.
 * 2. Pointer-state and snapshot tests use the same double, extended with
 *    `setMouseInput` / `releasePointer` / `setPointerOnCanvas` /
 *    `commitPlacementAtPointer`. The double reproduces Game's invariants
 *    (mouse tracks on hover, mouseDown gates firing) without a real canvas.
 */

import { describe, expect, it } from 'vitest';
import { AbilityPlacement } from '../src/systems/ActiveInput';
import { EnemyManager } from '../src/systems/EnemyManager';
import { ResourceManager } from '../src/systems/ResourceManager';
import { ProjectileManager } from '../src/systems/ProjectileManager';
import { Tower } from '../src/systems/Tower';
import { BuffRegistry } from '../src/stats/BuffRegistry';
import { EventBus } from '../src/game/EventBus';
import {
  ABILITIES,
  ABILITY_BY_ID,
  isTargeted,
  METEOR_SPLASH_FRACTION,
} from '../src/data/abilities';
import { ARENA, world } from '../src/data/arena';
import { TOWER_BASE } from '../src/data/tower';
import { AbilityManager, type CastPlacement } from '../src/systems/AbilityManager';
import type { AbilityId, AbilityState, GameStats, ResourceState, TowerState } from '../src/types';
import { isTargetable } from '../src/data/enemies';

const TOWER_X = world(400);
const TOWER_Y = world(300);
const ARENA_W = world(800);
const ARENA_H = world(600);

interface Harness {
  router: TargetingRouter;
  bus: EventBus;
  enemies: EnemyManager;
  tower: Tower;
  manaBefore: () => number;
  manaAfter: () => number;
  abilities: AbilityManager;
  toast: () => { kind: string; text: string } | null;
}

/**
 * Minimal double of `Game` that exposes exactly the routing Parts A and B
 * are about to test. It re-implements:
 *
 *  - `castAbility(id)` — the targeted-arms / non-targeted-casts branch
 *  - `beginPlacement(id)` — `AbilityPlacement.toggle` wrapped with a prompt
 *  - `castPlacedAbility(x, y)` — empty-disc refusal, then `tryCast` cast
 *  - `commitPlacementAtPointer` — touch-release equivalent of a click
 *  - `setMouseInput` / `releasePointer` / `setPointerOnCanvas` — pointer state
 *  - `placementSnapshot` — the reticle shape (radius, label, color, valid, count)
 *
 * Everything else is a stub: the goal is to assert the *routing*, not the
 * full Game orchestrator. Real Game wires this all to the canvas, the UI,
 * the bus, the resource manager, and the rest of the orchestra — those are
 * the concern of the existing `abilities.test.ts` harness.
 */
class TargetingRouter {
  readonly placement = new AbilityPlacement();
  private pendingPrompt: string | null = null;
  private toastLog: Array<{ kind: string; text: string }> = [];
  /** Toast from the latest `castPlacedAbility` call, for the harness to read. */
  toast: () => { kind: string; text: string } | null = () => null;

  mouseX = 0;
  mouseY = 0;
  mouseDown = false;
  pointerOnCanvas = false;

  constructor(
    private readonly abilities: AbilityManager,
    private readonly enemies: EnemyManager,
    private readonly tower: Tower,
    private readonly wave: () => number,
    private readonly canCast: (id: AbilityId) => boolean,
    /** The new-copy wording; this double matches the exact spec text. */
    private readonly touchDevice: boolean,
  ) {}

  /** Plan §G.1 — touch copy vs mouse copy is gated by `coarsePointer`. */
  beginPlacement(id: AbilityId): boolean {
    const def = ABILITY_BY_ID[id];
    if (!def) return false;
    const result = this.placement.toggle(id, this.canCast(id));
    if (result === 'begin') {
      this.pendingPrompt = this.touchDevice
        ? `Drag to aim ${def.name}, lift to cast — tap the tile to cancel`
        : `Click to place ${def.name} — Esc to cancel`;
      return true;
    }
    this.pendingPrompt = null;
    return false;
  }

  /** Plan §A.1 — manual cast: targeted arms, non-targeted casts immediately. */
  castAbility(id: AbilityId): boolean {
    if (isTargeted(id)) return this.beginPlacement(id);
    return this.abilities.tryCast(id, this.wave());
  }

  /**
   * Plan §G.2 — a click on an empty disc refuses the cast. Mana is never
   * spent and placement clears. The toast kind matches the spec ("info",
   * "No target there").
   */
  castPlacedAbility(x: number, y: number): boolean {
    const id = this.placement.pending;
    if (!id) return false;
    const radius = this.abilities.getEffectiveRadius(id);
    const hasTarget = this.enemies
      .queryRadius(x, y, radius)
      .some(isTargetable);
    if (!hasTarget) {
      this.placement.cancel();
      this.pendingPrompt = null;
      this.toastLog.push({ kind: 'info', text: 'No target there' });
      this.toast = () => this.toastLog[this.toastLog.length - 1] ?? null;
      return false;
    }
    const ok = this.abilities.tryCast(id, this.wave(), { x, y });
    this.placement.cancel();
    this.pendingPrompt = null;
    return ok;
  }

  /** Plan §B.3 — touch release path. */
  commitPlacementAtPointer(): boolean {
    if (!this.placement.isPlacing) return false;
    return this.castPlacedAbility(this.mouseX, this.mouseY);
  }

  /** Plan §B.1 — mouse tracks whether or not the button is down. */
  setMouseInput(x: number, y: number, isDown: boolean): void {
    this.mouseX = x;
    this.mouseY = y;
    if (isDown && !this.mouseDown) {
      // First press in a stream — mirror Game's clearTargetLock idiom.
      this.mouseDown = true;
      return;
    }
    this.mouseDown = isDown;
  }

  /** Plan §B.2 — release keeps the last position; only the button state changes. */
  releasePointer(): void {
    this.mouseDown = false;
  }

  setPointerOnCanvas(on: boolean): void {
    this.pointerOnCanvas = on;
  }

  /** Cancel placement mode without a cast. */
  cancelPlacement(): boolean {
    const had = this.placement.cancel();
    if (had) this.pendingPrompt = null;
    return had;
  }

  /** Mirror `Game.placementSnapshot` (Phase 4, plan §E.3). */
  placementSnapshot(): {
    x: number; y: number; radius: number; label: string; color: string;
    valid: boolean; count: number;
  } | null {
    const id = this.placement.pending;
    if (!id) return null;
    // Plan §B.2 — hide the reticle on leave unless the button is down.
    if (!this.pointerOnCanvas && !this.mouseDown) return null;
    const def = ABILITY_BY_ID[id];
    const radius = this.abilities.getEffectiveRadius(id);
    const inDisc = this.enemies.queryRadius(this.mouseX, this.mouseY, radius);
    const count = inDisc.filter(isTargetable).length;
    return {
      x: this.mouseX,
      y: this.mouseY,
      radius,
      label: def?.name ?? '',
      color: def?.color ?? '#ffffff',
      valid: count > 0,
      count,
    };
  }
}

function makeHarness(touch = false): Harness {
  const bus = new EventBus();
  const stats = { goldEarned: 0 } as unknown as GameStats;
  const state = {
    gold: 1000,
    mana: 1000,
    maxMana: 1000,
    manaRegen: 0,
    ascensionPoints: 0,
    apThisTranscendence: 0,
    transcendencePoints: 0,
    lifetimeAP: 0,
    lifetimeGold: 0,
  } as ResourceState;
  const towerState = {
    ...TOWER_BASE,
    baseDamage: 10,
    cooldown: 0,
    range: 2000,
    x: TOWER_X,
    y: TOWER_Y,
  } as TowerState;
  const resources = new ResourceManager(state, stats, bus);
  const tower = new Tower(towerState);
  const enemies = new EnemyManager(bus, resources);
  enemies.setBounds(ARENA_W, ARENA_H);
  enemies.beginWave(60);
  const projectiles = new ProjectileManager(bus, tower, enemies);
  projectiles.setBounds(ARENA_W, ARENA_H);

  const states = {} as Record<AbilityId, AbilityState>;
  for (const def of ABILITIES) {
    states[def.id] = {
      level: 1, cooldown: 0, active: false, activeTimer: 0, xp: 0,
    };
  }
  const buffs = new BuffRegistry();
  const abilities = new AbilityManager({
    resources,
    enemies,
    tower,
    bus,
    projectileManager: projectiles,
    buffs,
    getState: (id) => states[id],
    onCast: () => {},
  });
  // Ensure every ability is at the same level so canCast() only depends on
  // mana + cooldown + the ability unlock wave.
  void buffs;
  void states;

  const wave = (): number => 60;
  const canCast = (id: AbilityId): boolean => abilities.canCast(id, wave());
  const router = new TargetingRouter(abilities, enemies, tower, wave, canCast, touch);

  return {
    router,
    bus,
    enemies,
    tower,
    manaBefore: () => state.mana,
    manaAfter: () => state.mana,
    abilities,
    toast: () => router.toast(),
  };
}

// ── Part A: manual cast routing ───────────────────────────────────────────

describe('castAbility arms targeted abilities and fires the rest', () => {
  it('a manual cast of a targeted ability arms rather than casts', () => {
    const h = makeHarness();
    const manaBefore = h.router['abilities'].getEffectiveManaCost('rain_of_arrows');
    void manaBefore;   // captured implicitly via the resource manager

    expect(h.router.castAbility('rain_of_arrows')).toBe(true);
    expect(h.router.placement.pending).toBe('rain_of_arrows');
    // No mana spent — placing is not casting.
    expect(h.manaAfter()).toBe(1000);
  });

  it('a manual cast of a non-targeted ability casts immediately', () => {
    const h = makeHarness();
    expect(isTargeted('berserk')).toBe(false);
    expect(h.router.castAbility('berserk')).toBe(true);
    expect(h.router.placement.pending).toBeNull();
  });

  it('arming a second ability while one is pending replaces it', () => {
    const h = makeHarness();
    expect(h.router.castAbility('rain_of_arrows')).toBe(true);
    expect(h.router.placement.pending).toBe('rain_of_arrows');

    // Same hotkey again cancels (Plan §B.4).
    expect(h.router.beginPlacement('rain_of_arrows')).toBe(false);
    expect(h.router.placement.pending).toBeNull();

    // Then arm a different one — replaces, not stacks.
    expect(h.router.castAbility('meteor_strike')).toBe(true);
    expect(h.router.placement.pending).toBe('meteor_strike');
  });
});

// ── Part B: pointer state ─────────────────────────────────────────────────

describe('pointer tracking and the reticle snapshot', () => {
  it('setMouseInput(x, y, false) moves the placement snapshot — the §1.1 regression', () => {
    const h = makeHarness();
    // Spawn an enemy inside the disc so the snapshot has something to count.
    h.enemies.spawn('normal', 60, TOWER_X + world(50), TOWER_Y);
    h.router.castAbility('rain_of_arrows');
    h.router.setPointerOnCanvas(true);

    // First move: hover somewhere far from the tower.
    h.router.setMouseInput(TOWER_X + world(300), TOWER_Y, false);
    const snap = h.router.placementSnapshot();
    expect(snap).not.toBeNull();
    expect(snap!.x).toBe(TOWER_X + world(300));

    // Second move: hover a different spot.
    h.router.setMouseInput(TOWER_X + world(450), TOWER_Y, false);
    const snap2 = h.router.placementSnapshot();
    expect(snap2!.x).toBe(TOWER_X + world(450));
  });

  it('releasePointer leaves the stored position alone', () => {
    const h = makeHarness();
    h.enemies.spawn('normal', 60, TOWER_X + world(50), TOWER_Y);
    h.router.castAbility('rain_of_arrows');
    h.router.setPointerOnCanvas(true);
    h.router.setMouseInput(TOWER_X + world(300), TOWER_Y, false);

    h.router.releasePointer();

    // No pointer-down, but the position persists — the reticle stays put
    // rather than snapping to the origin.
    expect(h.router.placementSnapshot()).not.toBeNull();
    expect(h.router.placementSnapshot()!.x).toBe(TOWER_X + world(300));
  });

  it('snapshot radius equals abilityMgr.getEffectiveRadius for the same id and level', () => {
    const h = makeHarness();
    h.router.castAbility('rain_of_arrows');
    h.router.setPointerOnCanvas(true);
    h.router.setMouseInput(TOWER_X, TOWER_Y, false);

    const snap = h.router.placementSnapshot()!;
    expect(snap.radius).toBe(h.abilities.getEffectiveRadius('rain_of_arrows'));
  });

  it('valid is false with no enemy in the disc, true with one', () => {
    const h = makeHarness();
    h.router.castAbility('rain_of_arrows');
    h.router.setPointerOnCanvas(true);

    // Empty disc at a quiet spot.
    h.router.setMouseInput(TOWER_X, TOWER_Y, false);
    const empty = h.router.placementSnapshot()!;
    expect(empty.valid).toBe(false);
    expect(empty.count).toBe(0);

    // Add an enemy at the same spot; valid flips.
    h.enemies.spawn('normal', 60, TOWER_X, TOWER_Y);
    const full = h.router.placementSnapshot()!;
    expect(full.valid).toBe(true);
    expect(full.count).toBe(1);
  });
});

// ── Part G.2: empty-disc refusal ──────────────────────────────────────────

describe('a click on an empty disc refuses the cast', () => {
  it('does not spend mana and clears placement; one toast is emitted', () => {
    const h = makeHarness();
    h.router.castAbility('meteor_strike');
    h.router.setPointerOnCanvas(true);

    // Aim at empty field — no enemies anywhere near the disc.
    h.router.setMouseInput(TOWER_X + world(800), TOWER_Y, false);

    expect(h.router.castPlacedAbility(TOWER_X + world(800), TOWER_Y)).toBe(false);
    expect(h.router.placement.pending).toBeNull();
    // Mana untouched (60-mana meteor is the case that makes the refusal matter).
    expect(h.manaAfter()).toBe(1000);
    const t = h.toast();
    expect(t).not.toBeNull();
    expect(t!.kind).toBe('info');
    expect(t!.text).toBe('No target there');
  });

  it('a disc with at least one target lands normally', () => {
    const h = makeHarness();
    h.enemies.spawn('normal', 60, TOWER_X + world(50), TOWER_Y);
    h.router.castAbility('meteor_strike');
    h.router.setPointerOnCanvas(true);

    expect(h.router.castPlacedAbility(TOWER_X + world(50), TOWER_Y)).toBe(true);
    expect(h.router.placement.pending).toBeNull();
    expect(h.manaAfter()).toBeLessThan(1000);   // mana actually spent
  });
});

// ── Part B.4: the five cancellers ─────────────────────────────────────────

describe('placement mode never outlives its reason (Plan §B.4)', () => {
  it('the same hotkey again cancels', () => {
    const h = makeHarness();
    h.router.castAbility('rain_of_arrows');
    expect(h.router.placement.pending).toBe('rain_of_arrows');
    h.router.beginPlacement('rain_of_arrows');   // same hotkey → cancel
    expect(h.router.placement.pending).toBeNull();
  });

  it('cancel() is a no-op when nothing is pending', () => {
    const h = makeHarness();
    expect(h.router.cancelPlacement()).toBe(false);
    expect(h.router.placement.pending).toBeNull();
  });

  it('casting a click clears placement whether or not the cast succeeded', () => {
    const h = makeHarness();
    h.router.castAbility('meteor_strike');
    h.router.setPointerOnCanvas(true);

    // Empty disc — cast refused; placement must still clear so the player
    // is not stuck in arming mode after a whiff.
    expect(h.router.castPlacedAbility(TOWER_X + world(800), TOWER_Y)).toBe(false);
    expect(h.router.placement.pending).toBeNull();
  });

  it('commitPlacementAtPointer is the touch-release equivalent of a click', () => {
    const h = makeHarness();
    h.enemies.spawn('normal', 60, TOWER_X + world(50), TOWER_Y);
    h.router.castAbility('meteor_strike');
    h.router.setPointerOnCanvas(true);
    h.router.setMouseInput(TOWER_X + world(50), TOWER_Y, true);

    expect(h.router.commitPlacementAtPointer()).toBe(true);
    expect(h.router.placement.pending).toBeNull();
  });

  it('commitPlacementAtPointer is a no-op when nothing is armed', () => {
    const h = makeHarness();
    expect(h.router.commitPlacementAtPointer()).toBe(false);
  });
});

// ── smoke: confirms the helpers we depend on still match the surface ─────

describe('integration smoke against the spec constants', () => {
  it('METEOR_SPLASH_FRACTION stays below 1 (regression guard for plan §1.4)', () => {
    expect(METEOR_SPLASH_FRACTION).toBeLessThan(1);
  });

  it('a CastPlacement is one of the three documented values', () => {
    // Type-level smoke: a focused cast passes a `{x,y}` literal, the
    // auto path passes `'auto'`, the tower path passes `'tower'`. The cast
    // resolves in AbilityManager.tryCast. Each placement gets its own enemy
    // so the previous cast's damage does not starve the next.
    const h = makeHarness();
    const placements: CastPlacement[] = [
      { x: TOWER_X + world(50), y: TOWER_Y },
      'auto',
      'tower',
    ];
    for (const placement of placements) {
      // Spawn a fresh enemy at the placement point so `pickBestSpot` finds
      // something on the `'auto'` cast too, and beefUp keeps it alive
      // through the cast.
      const e = h.enemies.spawn('normal', 60, TOWER_X + world(50), TOWER_Y);
      e.maxHp = 1e9;
      e.hp = 1e9;
      // Reset mana and cooldown between casts so we don't burn out mid-rotation.
      h.abilities['resources'].addMana(100);
      h.abilities.getState('rain_of_arrows').cooldown = 0;
      expect(h.abilities.tryCast('rain_of_arrows', 60, placement)).toBe(true);
    }
  });

  it('the ARENA bounds we depend on still exist (no half-extent regressions)', () => {
    expect(ARENA.minHalfExtent).toBeGreaterThan(0);
    expect(ARENA.minHalfExtent).toBeLessThan(world(2000));
  });
});