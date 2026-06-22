import type { GridView, Renderer } from './Renderer'

interface Stepper {
  step(): void
}

interface RenderFrameOptions {
  sim: Stepper
  renderer: Renderer
  grid: GridView
  playing: boolean
  nowMs: number
}

export function renderFrame({
  sim,
  renderer,
  grid,
  playing,
  nowMs
}: RenderFrameOptions): void {
  if (playing) sim.step()
  renderer.render(grid, nowMs / 1000)
}
