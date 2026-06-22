import { COLORS, Material, VARIATION, FIRE_LIFE, STEAM_LIFE } from '../sim/materials'
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
 * with `image-rendering: pixelated` for crisp pixels. Colours come from the
 * shared palette: powders/solids get stable per-cell grain (VARIATION), fire is
 * coloured by its life (temperature), steam fades as it dissipates.
 */
export class Canvas2DRenderer implements Renderer {
  private ctx: CanvasRenderingContext2D | null = null
  private image: ImageData | null = null
  private buffer: Uint8ClampedArray | null = null

  init(canvas: HTMLCanvasElement, width: number, height: number): void {
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', { alpha: true })
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

    const cells = grid.cells
    const life = grid.life
    const w = grid.width

    for (let i = 0; i < cells.length; i++) {
      const m = cells[i]
      const color = COLORS[m] ?? COLORS[Material.Empty]
      let r = color[0]
      let g = color[1]
      let b = color[2]

      if (m === Material.Fire) {
        // temperature: hot core (high life) -> white, cooling -> deep red
        const t = Math.min(1, life[i] / FIRE_LIFE)
        r = 255
        g = clamp8(70 + t * 170)
        b = clamp8(t * t * 90)
      } else if (m === Material.Steam) {
        const t = Math.min(1, life[i] / STEAM_LIFE)
        const v = clamp8(150 + t * 70)
        r = v
        g = v
        b = clamp8(v + 8)
      } else if (m === Material.Water) {
        const above = i - w
        const below = i + w
        const left = i % w === 0 ? -1 : i - 1
        const right = i % w === w - 1 ? -1 : i + 1
        const isSurface = above < 0 || cells[above] !== Material.Water
        const deep = below < cells.length && cells[below] === Material.Water
        const edge =
          (left >= 0 && cells[left] !== Material.Water) ||
          (right >= 0 && cells[right] !== Material.Water)
        r = clamp8(r + (isSurface ? 48 : deep ? -24 : 8) + (edge ? 12 : 0))
        g = clamp8(g + (isSurface ? 58 : deep ? -16 : 14) + (edge ? 18 : 0))
        b = clamp8(b + (isSurface ? 44 : deep ? 12 : 22) + (edge ? 24 : 0))
      } else {
        const amp = VARIATION[m] ?? 0
        if (amp > 0) {
          // stable per-cell grain from a coordinate hash, in [-1, 1]
          const x = i % w
          const y = (i / w) | 0
          const n = ((hash((x * 73856093) ^ (y * 19349663)) & 0xff) / 255) * 2 - 1
          const d = n * amp * 255
          r = clamp8(r + d)
          g = clamp8(g + d)
          b = clamp8(b + d)
        }
        // wet: solids touching water darken, deepen and cool slightly (damp look)
        const below = i + w
        const above = i - w
        const left = i % w === 0 ? -1 : i - 1
        const right = i % w === w - 1 ? -1 : i + 1
        const submerged = above >= 0 && cells[above] === Material.Water
        const wet =
          submerged ||
          (below < cells.length && cells[below] === Material.Water) ||
          (left >= 0 && cells[left] === Material.Water) ||
          (right >= 0 && cells[right] === Material.Water)
        if (wet) {
          const k = submerged ? 0.62 : 0.74
          r = clamp8(r * k)
          g = clamp8(g * k + 4)
          b = clamp8(b * k + 12)
        }
      }

      const o = i << 2
      buf[o] = r
      buf[o + 1] = g
      buf[o + 2] = b
      // Empty stays transparent so the photo aquarium shows through; water is
      // semi-transparent (glassy); everything else is opaque.
      buf[o + 3] =
        m === Material.Empty ? 0 : m === Material.Water ? 190 : 255
    }

    ctx.putImageData(image, 0, 0)
  }

  dispose(): void {
    this.ctx = null
    this.image = null
    this.buffer = null
  }
}
