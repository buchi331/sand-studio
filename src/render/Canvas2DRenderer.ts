import { COLORS, Material } from '../sim/materials'
import type { GridView, Renderer } from './Renderer'

function hash(n: number): number {
  let h = n | 0
  h = (h ^ 61) ^ (h >>> 16)
  h = h + (h << 3)
  h = h ^ (h >>> 4)
  h = Math.imul(h, 0x27d4eb2d)
  h = h ^ (h >>> 15)
  return h >>> 0
}

function clamp8(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v
}

/**
 * CPU renderer: builds an `ImageData` at grid resolution and blits it with
 * `putImageData`. The canvas backing store is the grid size; CSS scales it up
 * with `image-rendering: pixelated` for crisp pixels. Fire and steam get a
 * cheap per-frame flicker so the world feels alive even when paused logic-wise.
 */
export class Canvas2DRenderer implements Renderer {
  private ctx: CanvasRenderingContext2D | null = null
  private image: ImageData | null = null
  private buffer: Uint8ClampedArray | null = null
  private frame = 0

  init(canvas: HTMLCanvasElement, width: number, height: number): void {
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) throw new Error('2D canvas context is unavailable')
    ctx.imageSmoothingEnabled = false
    this.ctx = ctx
    this.image = ctx.createImageData(width, height)
    this.buffer = this.image.data
  }

  // Canvas2D renders at grid resolution and is CSS-scaled, so display size is irrelevant.
  resize(): void {}

  render(grid: GridView): void {
    const ctx = this.ctx
    const image = this.image
    const buf = this.buffer
    if (!ctx || !image || !buf) return

    this.frame = (this.frame + 1) & 0xffff
    const f = this.frame
    const cells = grid.cells

    for (let i = 0; i < cells.length; i++) {
      const m = cells[i]
      const color = COLORS[m] ?? COLORS[Material.Empty]
      let r = color[0]
      let g = color[1]
      let b = color[2]

      if (m === Material.Fire) {
        const flick = (hash(i * 7 + f * 13) % 70) - 25
        r = clamp8(r + flick)
        g = clamp8(g + (flick >> 1))
      } else if (m === Material.Steam) {
        const flick = (hash(i * 5 + f) % 36) - 18
        r = clamp8(r + flick)
        g = clamp8(g + flick)
        b = clamp8(b + flick)
      }

      const o = i << 2
      buf[o] = r
      buf[o + 1] = g
      buf[o + 2] = b
      buf[o + 3] = 255
    }

    ctx.putImageData(image, 0, 0)
  }

  dispose(): void {
    this.ctx = null
    this.image = null
    this.buffer = null
  }
}
