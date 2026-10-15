/**
 * Uniform grid for radius queries over the enemy list: targeting, AoE, auras.
 * Ported from the legacy game (`src/utils/SpatialGrid.ts` at the tag
 * `legacy-final`); its cells since kept in a flat array over the items'
 * bounds rather than a map, in the same order.
 *
 * A uniform grid suits this arena better than a tree: enemies are spread
 * fairly evenly over a fixed-size field, they all move every step (so any
 * structure is rebuilt anyway, and rebuilding this one is two linear passes),
 * and every query is a circle. Cell arrays are reused between rebuilds, so a
 * steady state does no allocation.
 */

export interface GridItem {
  x: number;
  y: number;
  alive: boolean;
}

/**
 * Half-width, in cells, of the addressable area: the grid covers
 * `+/- CELL_BIAS * cellSize` around the origin — far more than the arena, with
 * room for the off-screen ring enemies spawn from.
 */
const CELL_BIAS = 1024;

export class SpatialGrid<T extends GridItem> {
  private readonly cellSize: number;
  /**
   * The cells over the living items' bounds this rebuild, flat: cell (cx, cy)
   * is `cells[(cx - cx0) * rows + (cy - cy0)]`. An index, not a map lookup:
   * the separation pass asks a dozen cells of every body, every step.
   */
  private cells: T[][] = [];
  private cx0 = 0;
  private cy0 = 0;
  private cols = 0;
  private rows = 0;
  /** Cells holding items this rebuild, so clearing does not walk them all. */
  private used: number[] = [];

  constructor(cellSize: number) {
    this.cellSize = Math.max(1, cellSize);
  }

  /** An item's cell coordinate on one axis, held to the addressable area. */
  private cell(v: number): number {
    return Math.min(CELL_BIAS - 1, Math.max(-CELL_BIAS, Math.floor(v / this.cellSize)));
  }

  /** Drop the previous contents and index `items` by position. Skips the dead. */
  rebuild(items: readonly T[]): void {
    this.clear();
    let minCx = Infinity;
    let minCy = Infinity;
    let maxCx = -Infinity;
    let maxCy = -Infinity;
    for (const item of items) {
      if (!item.alive) continue;
      const cx = this.cell(item.x);
      const cy = this.cell(item.y);
      if (cx < minCx) minCx = cx;
      if (cx > maxCx) maxCx = cx;
      if (cy < minCy) minCy = cy;
      if (cy > maxCy) maxCy = cy;
    }
    if (minCx === Infinity) {
      this.cols = 0;
      this.rows = 0;
      return;
    }
    this.cx0 = minCx;
    this.cy0 = minCy;
    this.cols = maxCx - minCx + 1;
    this.rows = maxCy - minCy + 1;
    const n = this.cols * this.rows;
    while (this.cells.length < n) this.cells.push([]);
    for (const item of items) {
      if (!item.alive) continue;
      const k = (this.cell(item.x) - minCx) * this.rows + (this.cell(item.y) - minCy);
      const bucket = this.cells[k];
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
    const near: (readonly T[])[] = [];
    for (const bucket of this.cellsNear(x, y, radius, near)) {
      for (const item of bucket) {
        if (!item.alive) continue;
        const dx = item.x - x;
        const dy = item.y - y;
        if (dx * dx + dy * dy <= r2) out.push(item);
      }
    }
    return out;
  }

  /**
   * The non-empty cells that `query` would scan for this circle, in the same
   * order (by column, then row; a cell's items in the order given), appended
   * to `out`: for a hot caller that runs its own distance test and would only
   * walk `query`'s result again. Cells may hold the dead.
   */
  cellsNear(x: number, y: number, radius: number, out: (readonly T[])[]): (readonly T[])[] {
    // Only the cells inside the bounds can hold anything.
    const minCx = Math.max(this.cx0, this.cell(x - radius));
    const maxCx = Math.min(this.cx0 + this.cols - 1, this.cell(x + radius));
    const minCy = Math.max(this.cy0, this.cell(y - radius));
    const maxCy = Math.min(this.cy0 + this.rows - 1, this.cell(y + radius));
    for (let cx = minCx; cx <= maxCx; cx++) {
      const col = (cx - this.cx0) * this.rows - this.cy0;
      for (let cy = minCy; cy <= maxCy; cy++) {
        const bucket = this.cells[col + cy];
        if (bucket.length > 0) out.push(bucket);
      }
    }
    return out;
  }

  clear(): void {
    for (const k of this.used) this.cells[k].length = 0;
    this.used.length = 0;
  }
}
