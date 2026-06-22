/**
 * Minimal read-only view of the grid the renderer needs. Keeping this narrow
 * means the renderer never mutates simulation state.
 */
export interface GridView {
  readonly width: number
  readonly height: number
  readonly cells: Uint8Array
  readonly life: Uint8Array
}

/**
 * Pluggable renderer abstraction.
 *
 * v0.1 ships a `Canvas2DRenderer`; the roadmap swaps in a WebGL2 (regl) glow
 * renderer behind this same interface, so nothing else in the app changes.
 */
export interface Renderer {
  /** Bind to a canvas and size internal buffers to the grid resolution. */
  init(canvas: HTMLCanvasElement, width: number, height: number): void
  /** Notify the renderer the display size (CSS px * dpr) changed. */
  resize(displayWidth: number, displayHeight: number, dpr: number): void
  /** Draw the current grid state to the bound canvas. */
  render(grid: GridView, elapsedSeconds?: number): void
  /** Release GPU/CPU resources. */
  dispose(): void
}
