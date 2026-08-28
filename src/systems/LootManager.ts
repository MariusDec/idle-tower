import type { LootOrb } from '../types';
import {
  LOOT_TUNING,
  bossOrbShare,
  orbGoldValue,
  type LootOrbKind,
} from '../data/loot';
import { TALENT_TUNING } from '../data/talentTree';
import { nextId } from '../utils/math';
import type { EventBus } from '../game/EventBus';

/**
 * What a kill knows about itself when it asks for a drop.
 *
 * Deliberately plain data rather than an `Enemy`, so the offline-progress path
 * and the tests can ask for a drop without building a live enemy.
 */
export interface OrbDropRequest {
  x: number;
  y: number;
  wave: number;
  elite?: boolean;
  isBoss?: boolean;
  /** Max mana, for sizing a mana orb. Zero means mana is not unlocked yet. */
  maxMana: number;
  rng?: () => number;
}

export interface LootManagerDeps {
  bus?: EventBus;
  /** Where orbs drift to. */
  towerPos: () => { x: number; y: number };
  /**
   * Deliver a collected orb.
   *
   * `amount` is already scaled by the collect rate; `full` says whether the
   * player clicked it (100%) or it drifted home (40%, or 100% with the
   * `orb_magnet` blessing), so the payer can phrase the feedback.
   */
  pay: (kind: LootOrbKind, amount: number, full: boolean, orb: LootOrb) => void;
}

/**
 * Loot orbs — the first thing in the game worth clicking (gameplay plan §4.1).
 *
 * The contract that matters is the idle one: **an uncollected orb is never
 * lost**. It drifts to the tower and pays 40% on its own, which is the
 * automatic fallback the plan's cross-cutting rule 1 demands. Clicking pays
 * the whole thing, so attention is worth 2.5x on the orb channel and nothing
 * anywhere else.
 *
 * Orbs are pooled: dead entries go on a free list and are re-initialised in
 * place, so a wave that drops a hundred orbs allocates nothing after the
 * first few. Nothing here is persisted — see `docs/loot-system.md`.
 */
export class LootManager {
  private readonly bus: EventBus | undefined;
  private readonly towerPos: () => { x: number; y: number };
  private readonly pay: LootManagerDeps['pay'];
  private orbs: LootOrb[] = [];
  private pool: LootOrb[] = [];
  /** Fraction a drift-collected orb pays. Raised to 1 by `orb_magnet`. */
  private autoRate: number = LOOT_TUNING.autoCollectRate;
  /**
   * Ref-counted set of magnet sources. `Gold Rush` (the buff) and the
   * `orb_magnet` blessing both raise the drift rate to 100%; the magnet is
   * "on" while at least one source is held. A `Set` keeps the bookkeeping
   * idempotent so `setMagnetSource('blessing', true)` called twice does not
   * need a matching pair of `false`s to come back down.
   */
  private readonly magnetSources = new Set<string>();
  /** Cached magnet state — the `Set.size > 0` check. */
  private magnet = false;
  /** Orbs collected this run, for the run summary and Part 5's contracts. */
  private collectedThisRun = 0;
  /** Prospector talent: orb value bonus (fraction, e.g. 0.12 = +12%). */
  private valueBonus = 0;

  constructor(deps: LootManagerDeps) {
    this.bus = deps.bus;
    this.towerPos = deps.towerPos;
    this.pay = deps.pay;
  }

  get list(): LootOrb[] {
    return this.orbs;
  }

  get count(): number {
    return this.orbs.length;
  }

  get collected(): number {
    return this.collectedThisRun;
  }

  /** Auto-collect rate currently in force (0.4, or 1 with `orb_magnet`). */
  get autoCollectRate(): number {
    return this.autoRate;
  }

  /**
   * Plan §D.9: a ref-counted magnet, so multiple sources can each call
   * `setMagnetSource` without coordinating a paired `false`. The magnet
   * (100% auto-collect, faster drift) is on while at least one source is
   * held; dropping the last source reverts to the default drift rate.
   *
   * Currently two callers:
   *  - the `orb_magnet` blessing (taken during the draft, wiped on ascension),
   *  - `Gold Rush` (the active ability, plan §D.10 — on for the buff's
   *    duration, off when the buff expires).
   */
  setMagnetSource(source: 'blessing' | 'goldRush', enabled: boolean): void {
    if (enabled) this.magnetSources.add(source);
    else this.magnetSources.delete(source);
    const on = this.magnetSources.size > 0;
    if (on === this.magnet) return;
    this.magnet = on;
    this.autoRate = on ? LOOT_TUNING.magnetCollectRate : LOOT_TUNING.autoCollectRate;
  }

  /** Prospector talent: orb value bonus. */
  setValueBonus(bonus: number): void {
    this.valueBonus = Math.max(0, bonus);
  }

  private get driftSeconds(): number {
    let base = this.magnet
      ? LOOT_TUNING.driftSeconds * LOOT_TUNING.magnetDriftScale
      : LOOT_TUNING.driftSeconds;
    // Prospector talent: faster drift (lower seconds = faster arrival).
    if (this.valueBonus > 0) base /= (1 + this.valueBonus * TALENT_TUNING.prospectorDriftPerPoint);
    return base;
  }

  // ── spawning ────────────────────────────────────────────────────────────

  /**
   * Roll and place the orbs a kill leaves behind.
   *
   * Returns how many were spawned, so callers can decide whether to make
   * noise about it.
   */
  dropForKill(req: OrbDropRequest): number {
    const rng = req.rng ?? Math.random;
    let count: number;
    if (req.isBoss) {
      count = bossOrbShare(req.wave, rng);
    } else if (req.elite) {
      const span = LOOT_TUNING.eliteOrbsMax - LOOT_TUNING.eliteOrbsMin;
      count = LOOT_TUNING.eliteOrbsMin + Math.floor(rng() * (span + 1));
    } else {
      count = rng() < LOOT_TUNING.commonDropChance ? 1 : 0;
    }
    for (let i = 0; i < count; i++) {
      const kind = this.rollKind(req, rng);
      this.spawn(kind, req.x, req.y, this.valueFor(kind, req), rng);
    }
    return count;
  }

  private rollKind(req: OrbDropRequest, rng: () => number): LootOrbKind {
    // Reroll tokens are a boss drop only — they feed the Part 1 draft, and
    // making them fall out of ordinary kills would make the draft's reroll
    // budget a function of wave length rather than of anything the player did.
    if (req.isBoss && rng() < LOOT_TUNING.rerollChance) return 'reroll';
    if (req.maxMana > 0 && rng() < LOOT_TUNING.manaShare) return 'mana';
    return 'gold';
  }

  private valueFor(kind: LootOrbKind, req: OrbDropRequest): number {
    let base: number;
    switch (kind) {
      case 'gold':
        base = orbGoldValue(req.wave);
        break;
      case 'mana':
        base = Math.max(1, req.maxMana * LOOT_TUNING.manaFraction);
        break;
      case 'reroll':
        base = 1;
        break;
      default: {
        const never: never = kind;
        base = never;
        break;
      }
    }
    // Prospector talent: multiply orb value.
    if (this.valueBonus > 0) base = Math.floor(base * (1 + this.valueBonus));
    return base;
  }

  /** Place one orb. Exposed for tests and for anything that grants directly. */
  spawn(kind: LootOrbKind, x: number, y: number, value: number, rng: () => number = Math.random): LootOrb {
    // Cap first: the oldest orb is the one closest to auto-collecting anyway,
    // so evicting it costs the player the least. In practice this never fires
    // — the drop budget is sized so a full boss pack stays well under it.
    while (this.orbs.length >= LOOT_TUNING.maxOrbs) {
      const evicted = this.orbs.shift();
      if (evicted) this.recycle(evicted);
    }
    const angle = rng() * Math.PI * 2;
    const speed = 40 + rng() * 70;
    const orb = this.pool.pop();
    if (orb) {
      orb.id = nextId();
      orb.kind = kind;
      orb.x = x;
      orb.y = y;
      orb.vx = Math.cos(angle) * speed;
      orb.vy = Math.sin(angle) * speed;
      orb.value = value;
      orb.age = 0;
      orb.alive = true;
      this.orbs.push(orb);
      this.bus?.emit('orb_spawned', { kind, x, y, value });
      return orb;
    }
    const fresh: LootOrb = {
      id: nextId(),
      kind,
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      value,
      age: 0,
      alive: true,
    };
    this.orbs.push(fresh);
    this.bus?.emit('orb_spawned', { kind, x, y, value });
    return fresh;
  }

  // ── simulation ──────────────────────────────────────────────────────────

  /**
   * Drift step. Runs inside `Game.simulate`'s fixed substeps, on the *game*
   * clock, so an orb takes 8 game-seconds to come home at every speed setting
   * — an orb that expired in wall-clock time would be uncollectable at 6.5x
   * and trivially collectable while paused.
   */
  tick(dt: number): void {
    if (this.orbs.length === 0) return;
    const { x: tx, y: ty } = this.towerPos();
    const total = this.driftSeconds;
    let dead = 0;

    for (const orb of this.orbs) {
      if (!orb.alive) {
        dead++;
        continue;
      }
      orb.age += dt;
      if (orb.age < LOOT_TUNING.popSeconds) {
        // Outward pop with drag, so a boss pack fans out instead of stacking
        // every orb on one pixel.
        orb.x += orb.vx * dt;
        orb.y += orb.vy * dt;
        const drag = Math.max(0, 1 - dt * 4.5);
        orb.vx *= drag;
        orb.vy *= drag;
        continue;
      }
      const dx = tx - orb.x;
      const dy = ty - orb.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const remaining = total - orb.age;
      if (dist <= LOOT_TUNING.arriveRadius || remaining <= dt) {
        this.collect(orb, false);
        dead++;
        continue;
      }
      // Speed is "cover what is left in the time that is left", which makes
      // arrival exact regardless of how far the pop threw it.
      const step = Math.min(dist, (dist / remaining) * dt);
      orb.x += (dx / dist) * step;
      orb.y += (dy / dist) * step;
    }

    if (dead > 0) this.compact();
  }

  // ── collection ──────────────────────────────────────────────────────────

  /**
   * Click/tap collection. Everything inside the catch radius pays in full.
   *
   * Returns the number of orbs taken, so the caller can decide whether the
   * click was "on an orb" (and therefore should not also start a manual-aim
   * hold or place an ability).
   */
  collectAt(x: number, y: number, radius: number = LOOT_TUNING.clickRadius): number {
    if (this.orbs.length === 0) return 0;
    const r2 = radius * radius;
    let taken = 0;
    for (const orb of this.orbs) {
      if (!orb.alive) continue;
      const dx = orb.x - x;
      const dy = orb.y - y;
      if (dx * dx + dy * dy > r2) continue;
      this.collect(orb, true);
      taken++;
    }
    if (taken > 0) this.compact();
    return taken;
  }

  /** Pay one orb out and mark it dead. `full` = clicked rather than drifted. */
  private collect(orb: LootOrb, full: boolean): void {
    orb.alive = false;
    const rate = full ? 1 : this.autoRate;
    // A reroll token cannot be fractional, and the idle contract is the thing
    // this part is most able to break — so reroll orbs pay whole either way
    // and the 40/100 split applies to the two divisible currencies. See
    // docs/loot-system.md.
    const amount = orb.kind === 'reroll' ? orb.value : orb.value * rate;
    this.collectedThisRun += 1;
    this.pay(orb.kind, amount, full, orb);
    this.bus?.emit('orb_collected', {
      kind: orb.kind,
      amount,
      full,
      rate: orb.kind === 'reroll' ? 1 : rate,
      x: orb.x,
      y: orb.y,
    });
  }

  /** In-place removal of dead orbs; no allocation, order preserved. */
  private compact(): void {
    let write = 0;
    for (let read = 0; read < this.orbs.length; read++) {
      const orb = this.orbs[read];
      if (orb.alive) {
        this.orbs[write++] = orb;
      } else {
        this.recycle(orb);
      }
    }
    this.orbs.length = write;
  }

  private recycle(orb: LootOrb): void {
    orb.alive = false;
    if (this.pool.length < LOOT_TUNING.maxOrbs) this.pool.push(orb);
  }

  /** Drop every live orb without paying. Used by resets and by save loads. */
  clear(): void {
    for (const orb of this.orbs) this.recycle(orb);
    this.orbs.length = 0;
  }

  /** Run reset: ascension, transcendence, and loading a save. */
  reset(): void {
    this.clear();
    this.collectedThisRun = 0;
    this.magnetSources.clear();
    this.magnet = false;
    this.autoRate = LOOT_TUNING.autoCollectRate;
  }
}
