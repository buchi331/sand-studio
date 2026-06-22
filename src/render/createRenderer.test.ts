import { describe, it, expect } from 'vitest'
import { createRenderer } from './createRenderer'
import { Canvas2DRenderer } from './Canvas2DRenderer'

describe('createRenderer', () => {
  it('falls back to Canvas2D when WebGL2 is unavailable', () => {
    // In the node test environment there is no `document`/WebGL,
    // so isWebGL2Available() must be false and we fall back.
    const handle = createRenderer()
    expect(handle.backend).toBe('canvas2d')
    expect(handle.renderer).toBeInstanceOf(Canvas2DRenderer)
  })
})
