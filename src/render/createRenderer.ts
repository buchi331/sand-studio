import { Canvas2DRenderer } from './Canvas2DRenderer'
import type { Renderer } from './Renderer'

export type RendererBackend = 'webgl2' | 'canvas2d'

export interface RendererHandle {
  renderer: Renderer
  backend: RendererBackend
}

/** Probe WebGL2 support on a throwaway canvas (never binds the real one). */
export function isWebGL2Available(): boolean {
  try {
    if (typeof document === 'undefined') return false
    const probe = document.createElement('canvas')
    return !!probe.getContext('webgl2')
  } catch {
    return false
  }
}

/**
 * Pick the best available renderer. WebGL2 is wired in Phase ③; until then this
 * always returns the Canvas2D renderer.
 */
export function createRenderer(): RendererHandle {
  return { renderer: new Canvas2DRenderer(), backend: 'canvas2d' }
}
