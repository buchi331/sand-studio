import { Canvas2DRenderer } from './Canvas2DRenderer'
import { WebGL2Renderer } from './WebGL2Renderer'
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
 * Pick the best available renderer: WebGL2 (with bloom) when supported,
 * otherwise the Canvas2D fallback.
 */
export function createRenderer(): RendererHandle {
  if (isWebGL2Available()) {
    try {
      return { renderer: new WebGL2Renderer(), backend: 'webgl2' }
    } catch {
      // construction failed — fall back to Canvas2D
    }
  }
  return { renderer: new Canvas2DRenderer(), backend: 'canvas2d' }
}
