/**
 * Uniform grid for radius queries over the enemy list: targeting, AoE, auras.
 * Ported unchanged from the legacy game (`src/utils/SpatialGrid.ts` at the tag `legacy-final`).
 *
 * A uniform grid suits this arena better than a tree: enemies are spread
 * fairly evenly over a fixed-size field, they all move every step (so any
 * structure is rebuilt anyway, and rebuilding this one is one linear pass),
 * and every query is a circle. Cell arrays are reused between rebuilds, so a
 * steady state does no allocation.
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
