/**
 * Uniform grid for radius queries over the enemy list (plan §5.4).
 *
 * Haste and vitality auras, mine detonation, splash, chain-kill AoE and the
 * healer's target search were each all-pairs scans over every living enemy,
 * every frame. At the 200+ enemies a deep wave spawns — with several elites
 * running auras — that is the second-largest cost in the frame after
 * rendering, and it grows quadratically exactly where the game is already
 * under the most load.
 *
 * A uniform grid suits this simulation better than a tree: enemies are spread
 * fairly evenly over a fixed-size arena, they all move every frame (so any
 * structure has to be rebuilt anyway, and rebuilding this one is a single
 * linear pass), and every query is a circle.
 *
 * Cell arrays are reused between rebuilds rather than reallocated, so a steady
 * state does no allocation at all.
 */

export interface GridItem {
  x: number;
  y: number;
  alive: boolean;
}

/**
 * Half-width, in cells, of the addressable area. Cell coordinates are biased
 * by this before being packed into a single integer key, so the grid covers
 * `+/- CELL_BIAS * cellSize` around the origin — far more than the arena, with
 * room for the off-screen ring enemies spawn from.
 */
const CELL_BIAS = 1024;
const CELL_SPAN = CELL_BIAS * 2;

export class SpatialGrid<T extends GridItem> {
  private readonly cellSize: number;
  private readonly cells = new Map<number, T[]>();
  /** Cells holding items this rebuild, so clearing does not walk the whole map. */
  private used: number[] = [];

  constructor(cellSize: number) {
    this.cellSize = Math.max(1, cellSize);
  }

  private key(cx: number, cy: number): number {
    const bx = Math.min(CELL_SPAN - 1, Math.max(0, cx + CELL_BIAS));
    const by = Math.min(CELL_SPAN - 1, Math.max(0, cy + CELL_BIAS));
    return bx * CELL_SPAN + by;
  }

  /** Drop the previous contents and index `items` by position. Skips the dead. */
  rebuild(items: readonly T[]): void {
    for (const k of this.used) {
      const bucket = this.cells.get(k);
      if (bucket) bucket.length = 0;
    }
    this.used.length = 0;
    for (const item of items) {
      if (!item.alive) continue;
      const k = this.key(
        Math.floor(item.x / this.cellSize),
        Math.floor(item.y / this.cellSize),
      );
      let bucket = this.cells.get(k);
      if (bucket === undefined) {
        bucket = [];
        this.cells.set(k, bucket);
      }
      if (bucket.length === 0) this.used.push(k);
      bucket.push(item);
    }
  }

  /**
   * Living items within `radius` of the point, appended to `out`.
   *
   * The caller owns `out` so a per-frame query can reuse one array. The
   * distance test is exact — the grid only narrows which items are tested.
   */
  query(x: number, y: number, radius: number, out: T[]): T[] {
    const r2 = radius * radius;
    const minCx = Math.floor((x - radius) / this.cellSize);
    const maxCx = Math.floor((x + radius) / this.cellSize);
    const minCy = Math.floor((y - radius) / this.cellSize);
    const maxCy = Math.floor((y + radius) / this.cellSize);
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const bucket = this.cells.get(this.key(cx, cy));
        if (bucket === undefined || bucket.length === 0) continue;
        for (const item of bucket) {
          if (!item.alive) continue;
          const dx = item.x - x;
          const dy = item.y - y;
          if (dx * dx + dy * dy <= r2) out.push(item);
        }
      }
    }
    return out;
  }

  clear(): void {
    for (const k of this.used) {
      const bucket = this.cells.get(k);
      if (bucket) bucket.length = 0;
    }
    this.used.length = 0;
  }
}
