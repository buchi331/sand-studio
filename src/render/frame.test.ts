import { describe, expect, it, vi } from 'vitest'
import { renderFrame } from './frame'
import type { GridView, Renderer } from './Renderer'

const grid: GridView = {
  width: 1,
  height: 1,
  cells: new Uint8Array([0]),
  life: new Uint8Array([0])
}

describe('renderFrame', () => {
  it('passes elapsed seconds to the renderer even while paused', () => {
    const sim = { step: vi.fn() }
    const renderer = {
      render: vi.fn(),
      init: vi.fn(),
      resize: vi.fn(),
      dispose: vi.fn()
    } satisfies Renderer

    renderFrame({ sim, renderer, grid, playing: false, nowMs: 1250 })

    expect(sim.step).not.toHaveBeenCalled()
    expect(renderer.render).toHaveBeenCalledWith(grid, 1.25)
  })
})
