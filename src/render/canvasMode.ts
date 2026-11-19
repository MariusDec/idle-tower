/**
 * Where the 2D canvases rasterise: on the GPU (the browser's default) or on
 * the CPU. A device preference, not a profile setting, kept beside the
 * quality preference in `localStorage`.
 *
 * It exists to test the Adreno driver crash (plans/android-gpu-crash.md):
 * `willReadFrequently: true` makes Chrome keep a canvas in CPU memory and
 * draw it with Skia's software rasteriser, so the GL driver only composites
 * the finished bitmap instead of executing every gradient, arc and blend.
 *
 * A context's options are fixed when it is created, so the mode is read once
 * per launch (`CANVAS_MODE`); a new choice applies on the next launch.
 */
export type CanvasMode = 'gpu' | 'cpu';

/** Legacy name, never rename (R6). */
export const CANVAS_MODE_KEY = 'the-tower-canvas';

/** The stored preference. Anything unrecognised reads as `'gpu'`. */
export function readStoredCanvasMode(): CanvasMode {
  try {
    if (typeof localStorage === 'undefined') return 'gpu';
    return localStorage.getItem(CANVAS_MODE_KEY) === 'cpu' ? 'cpu' : 'gpu';
  } catch {
    return 'gpu';
  }
}

export function storeCanvasMode(mode: CanvasMode): void {
  try {
    localStorage.setItem(CANVAS_MODE_KEY, mode);
  } catch {
    // Private mode or a full disk: nothing to apply next launch anyway.
  }
}

/** The mode every canvas of this launch was created in. */
export const CANVAS_MODE: CanvasMode = readStoredCanvasMode();

/**
 * Options for a 2D context in this launch's mode. Every canvas drawn into
 * another must share the mode: a GPU canvas drawn onto a CPU one is read
 * back from the GPU on every `drawImage`.
 */
export function context2dOptions(alpha = true): CanvasRenderingContext2DSettings {
  return { alpha, willReadFrequently: CANVAS_MODE === 'cpu' };
}
