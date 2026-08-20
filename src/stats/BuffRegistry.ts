import type { StatKey } from './keys';

/**
 * One timed modifier. Buffs never mutate `TowerState`; they are inputs to the
 * same `resolveStats` pass as upgrades and talents, which is what makes them
 * unable to clobber (or be clobbered by) a stat recompute.
 *
 * `remaining` counts down in *game* seconds rather than holding a wall-clock
 * `expiresAt`, because the simulation runs at up to 6.5x and every other timer
 * in the game (ability cooldowns, wave timers) is on that same scaled clock. A
 * wall-clock deadline would make Berserk last a sixth as long at high speed.
 * `null` means the buff lasts until it is explicitly cleared — that is how the
 * manual-aim boost, which is held rather than timed, is expressed.
 */
export interface BuffEntry {
  id: string;
  stat: StatKey;
  kind: 'add' | 'mult';
  value: number;
  label: string;
  remaining: number | null;
}

/**
 * The single owner of every time-varying modifier.
 *
 * Before this, an ability buff wrote into `TowerState` on one line and the
 * stat recompute overwrote it on the next; the Berserk fire-rate buff was
 * cancelled every frame and Vampiric Aura's regen was permanently subtracted
 * out by any purchase made during it (plan §1.3, §1.8). Routing buffs through
 * one registry that the pipeline reads makes both bugs unrepresentable.
 *
 * `version` increments whenever the effective buff set changes. `Game` watches
 * it and recomputes stats on the next substep, so a buff starting or expiring
 * costs one resolve rather than a resolve per frame.
 */
export class BuffRegistry {
  private buffs = new Map<string, BuffEntry>();
  private versionCounter = 0;

  get version(): number {
    return this.versionCounter;
  }

  get entries(): readonly BuffEntry[] {
    return [...this.buffs.values()];
  }

  has(id: string): boolean {
    return this.buffs.has(id);
  }

  /** Seconds left on a buff, or 0 if it is not active / is untimed. */
  remaining(id: string): number {
    return this.buffs.get(id)?.remaining ?? 0;
  }

  /**
   * Add or replace a buff. Re-applying the same id with the same shape (a
   * held boost re-asserted each frame, say) does not bump `version`, so it
   * costs nothing.
   */
  set(entry: BuffEntry): void {
    const existing = this.buffs.get(entry.id);
    this.buffs.set(entry.id, entry);
    if (
      existing
      && existing.stat === entry.stat
      && existing.kind === entry.kind
      && existing.value === entry.value
    ) {
      return;
    }
    this.versionCounter += 1;
  }

  clear(id: string): void {
    if (this.buffs.delete(id)) this.versionCounter += 1;
  }

  /** Advance every timed buff; expired ones are removed. */
  tick(dt: number): void {
    if (this.buffs.size === 0) return;
    let expired: string[] | null = null;
    for (const buff of this.buffs.values()) {
      if (buff.remaining === null) continue;
      buff.remaining -= dt;
      if (buff.remaining <= 0) (expired ??= []).push(buff.id);
    }
    if (!expired) return;
    for (const id of expired) this.buffs.delete(id);
    this.versionCounter += 1;
  }

  reset(): void {
    if (this.buffs.size === 0) return;
    this.buffs.clear();
    this.versionCounter += 1;
  }
}
