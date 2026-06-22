import REGL from 'regl'
import { COLORS, VARIATION, Material, FIRE_LIFE, STEAM_LIFE } from '../sim/materials'
import type { GridView, Renderer } from './Renderer'

/** Loose callable type for stored regl draw commands (props bag varies per command). */
type DrawFn = (props?: object) => void

/** Bloom is extracted/blurred at 1/N display resolution (mobile bandwidth + wider glow). */
const BLOOM_DOWNSCALE = 2

/** 9-entry palette as a 9x1 RGBA texture: rgb = colour, a = per-material grain amplitude. */
function paletteData(): Uint8Array {
  const data = new Uint8Array(COLORS.length * 4)
  for (let i = 0; i < COLORS.length; i++) {
    data[i * 4] = COLORS[i][0]
    data[i * 4 + 1] = COLORS[i][1]
    data[i * 4 + 2] = COLORS[i][2]
    data[i * 4 + 3] = Math.round((VARIATION[i] ?? 0) * 255)
  }
  return data
}

const QUAD: number[][] = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1]
]

const VERT = `
  precision highp float;
  attribute vec2 position;
  varying vec2 vUv;
  void main() { vUv = position * 0.5 + 0.5; gl_Position = vec4(position, 0, 1); }
`

/**
 * WebGL2 (regl) renderer with bloom.
 *
 * Pipeline per frame: upload cells+life to a texture -> draw the scene (palette
 * colour + per-cell grain + fire temperature + water highlight) into an FBO ->
 * extract emissive pixels -> separable gaussian blur (H, V) -> composite scene +
 * additive bloom to the screen. The context uses `preserveDrawingBuffer: true`
 * so MediaRecorder/captureStream records real frames.
 */
export class WebGL2Renderer implements Renderer {
  private regl: REGL.Regl | null = null
  private canvas: HTMLCanvasElement | null = null
  private gridTex: REGL.Texture2D | null = null
  private gridBuf: Uint8Array | null = null
  private scene: REGL.Framebuffer2D | null = null
  private bright: REGL.Framebuffer2D | null = null
  private blurA: REGL.Framebuffer2D | null = null
  private blurB: REGL.Framebuffer2D | null = null
  private drawScene: DrawFn | null = null
  private drawBright: DrawFn | null = null
  private drawBlur: DrawFn | null = null
  private drawComposite: DrawFn | null = null
  private dw = 0
  private dh = 0
  private bw = 0
  private bh = 0

  init(canvas: HTMLCanvasElement, width: number, height: number): void {
    const gl = canvas.getContext('webgl2', {
      preserveDrawingBuffer: true, // required so captureStream() records real frames
      alpha: false,
      antialias: false
    })
    if (!gl) throw new Error('WebGL2 unavailable')
    const regl = REGL({
      gl: gl as unknown as WebGLRenderingContext,
      optionalExtensions: [
        'OES_texture_half_float',
        'OES_texture_half_float_linear',
        'EXT_color_buffer_half_float',
        'EXT_color_buffer_float'
      ]
    })
    // HDR bloom: render into half-float buffers so fire can exceed 1.0 and bloom
    // with real punch. Needs the half-float texture, linear filtering of it, AND a
    // colour-renderable half-float ext; otherwise fall back to uint8 (LDR), no crash.
    const hdr =
      regl.hasExtension('OES_texture_half_float') &&
      regl.hasExtension('OES_texture_half_float_linear') &&
      (regl.hasExtension('EXT_color_buffer_half_float') ||
        regl.hasExtension('EXT_color_buffer_float'))
    const fboType: 'half float' | 'uint8' = hdr ? 'half float' : 'uint8'
    const bloomBoost = hdr ? 3.0 : 1.0

    this.regl = regl
    this.canvas = canvas
    this.dw = width
    this.dh = height
    this.bw = Math.max(1, Math.round(width / BLOOM_DOWNSCALE))
    this.bh = Math.max(1, Math.round(height / BLOOM_DOWNSCALE))
    canvas.width = width
    canvas.height = height

    this.gridBuf = new Uint8Array(width * height * 4)
    const gridTex = regl.texture({
      width,
      height,
      format: 'rgba',
      type: 'uint8',
      mag: 'nearest',
      min: 'nearest'
    })
    this.gridTex = gridTex
    const palette = regl.texture({
      width: COLORS.length,
      height: 1,
      format: 'rgba',
      type: 'uint8',
      mag: 'nearest',
      min: 'nearest',
      data: paletteData()
    })

    const makeFbo = (w: number, h: number) =>
      regl.framebuffer({
        color: regl.texture({ width: w, height: h, type: fboType, mag: 'linear', min: 'linear' }),
        depth: false
      })
    const scene = makeFbo(this.dw, this.dh)
    const bright = makeFbo(this.bw, this.bh)
    const blurA = makeFbo(this.bw, this.bh)
    const blurB = makeFbo(this.bw, this.bh)
    this.scene = scene
    this.bright = bright
    this.blurA = blurA
    this.blurB = blurB

    const position = regl.buffer(QUAD)
    const base = {
      attributes: { position },
      count: 4,
      primitive: 'triangle strip' as const,
      depth: { enable: false } // 2D fullscreen passes — no depth test (it would discard the quad)
    }

    this.drawScene = regl({
      ...base,
      framebuffer: scene,
      uniforms: {
        uGrid: gridTex,
        uPalette: palette,
        uGridSize: [width, height],
        uFireLife: FIRE_LIFE,
        uSteamLife: STEAM_LIFE,
        uFireId: Material.Fire,
        uWaterId: Material.Water,
        uSteamId: Material.Steam
      },
      vert: VERT,
      frag: `
        precision highp float;
        varying vec2 vUv;
        uniform sampler2D uGrid, uPalette;
        uniform vec2 uGridSize;
        uniform float uFireLife, uSteamLife, uFireId, uWaterId, uSteamId;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        void main() {
          vec2 uv = vec2(vUv.x, 1.0 - vUv.y);            // row 0 = top
          vec4 cell = texture2D(uGrid, uv);
          float id = floor(cell.r * 255.0 + 0.5);
          float life = cell.g;                            // 0..1
          vec4 pal = texture2D(uPalette, vec2((id + 0.5) / 9.0, 0.5));
          vec3 col = pal.rgb;

          if (abs(id - uFireId) < 0.5) {
            float t = clamp(life * 255.0 / uFireLife, 0.0, 1.0);
            col = vec3(1.0, 0.27 + t * 0.67, t * t * 0.35);
          } else if (abs(id - uSteamId) < 0.5) {
            float t = clamp(life * 255.0 / uSteamLife, 0.0, 1.0);
            col = vec3(0.6 + t * 0.27);
          } else if (abs(id - uWaterId) < 0.5) {
            vec2 above = uv - vec2(0.0, 1.0 / uGridSize.y);
            float aboveId = floor(texture2D(uGrid, above).r * 255.0 + 0.5);
            if (abs(aboveId - uWaterId) > 0.5) col += 0.12;   // surface highlight
            col *= 0.9 + 0.1 * uv.y;                           // subtle depth shade
          } else if (id > 0.5) {
            vec2 c = floor(uv * uGridSize);
            col += (hash(c) * 2.0 - 1.0) * pal.a;              // per-material grain
          }
          gl_FragColor = vec4(col, 1.0);
        }
      `
    }) as unknown as DrawFn

    this.drawBright = regl({
      ...base,
      framebuffer: bright,
      uniforms: {
        uScene: scene,
        uGrid: gridTex,
        uFireId: Material.Fire,
        uSteamId: Material.Steam,
        uBloomBoost: bloomBoost
      },
      vert: VERT,
      frag: `
        precision highp float;
        varying vec2 vUv;
        uniform sampler2D uScene, uGrid;
        uniform float uFireId, uSteamId, uBloomBoost;
        void main(){
          float id = floor(texture2D(uGrid, vec2(vUv.x, 1.0 - vUv.y)).r * 255.0 + 0.5);
          float em = (abs(id - uFireId) < 0.5 || abs(id - uSteamId) < 0.5) ? 1.0 : 0.0;
          // boost emissive into HDR range so the blurred halo blooms with punch
          gl_FragColor = vec4(texture2D(uScene, vUv).rgb * em * uBloomBoost, 1.0);
        }
      `
    }) as unknown as DrawFn

    this.drawBlur = regl({
      ...base,
      framebuffer: regl.prop<{ dst: REGL.Framebuffer2D }, 'dst'>('dst'),
      uniforms: {
        uTex: regl.prop<{ src: REGL.Framebuffer2D }, 'src'>('src'),
        uDir: regl.prop<{ dir: number[] }, 'dir'>('dir'),
        uRes: () => [this.bw, this.bh]
      },
      vert: VERT,
      frag: `
        precision highp float;
        varying vec2 vUv;
        uniform sampler2D uTex;
        uniform vec2 uDir, uRes;
        void main(){
          vec2 px = uDir / uRes;
          vec3 sum = texture2D(uTex, vUv).rgb * 0.204;
          sum += texture2D(uTex, vUv + px * 1.4).rgb * 0.304;
          sum += texture2D(uTex, vUv - px * 1.4).rgb * 0.304;
          sum += texture2D(uTex, vUv + px * 3.3).rgb * 0.094;
          sum += texture2D(uTex, vUv - px * 3.3).rgb * 0.094;
          gl_FragColor = vec4(sum, 1.0);
        }
      `
    }) as unknown as DrawFn

    this.drawComposite = regl({
      ...base,
      framebuffer: null, // render to the screen (blur passes leave an FBO bound)
      viewport: () => ({ x: 0, y: 0, width: this.dw, height: this.dh }),
      uniforms: {
        uScene: scene,
        uBloom: blurB,
        uIntensity: 2.5
      },
      vert: VERT,
      frag: `
        precision highp float;
        varying vec2 vUv;
        uniform sampler2D uScene, uBloom;
        uniform float uIntensity;
        void main(){
          vec3 c = texture2D(uScene, vUv).rgb + texture2D(uBloom, vUv).rgb * uIntensity;
          gl_FragColor = vec4(c, 1.0);
        }
      `
    }) as unknown as DrawFn
  }

  resize(displayWidth: number, displayHeight: number): void {
    // Ignore zero/negative sizes (layout not ready yet) — keep the current size.
    if (displayWidth < 1 || displayHeight < 1) return
    const w = Math.round(displayWidth)
    const h = Math.round(displayHeight)
    if (w === this.dw && h === this.dh) return
    this.dw = w
    this.dh = h
    this.bw = Math.max(1, Math.round(w / BLOOM_DOWNSCALE))
    this.bh = Math.max(1, Math.round(h / BLOOM_DOWNSCALE))
    if (this.canvas) {
      this.canvas.width = w
      this.canvas.height = h
    }
    this.scene?.resize(w, h)
    this.bright?.resize(this.bw, this.bh)
    this.blurA?.resize(this.bw, this.bh)
    this.blurB?.resize(this.bw, this.bh)
  }

  render(grid: GridView): void {
    const regl = this.regl
    const buf = this.gridBuf
    const gridTex = this.gridTex
    if (!regl || !buf || !gridTex) return

    // We drive our own rAF loop, so poll regl to refresh the screen viewport
    // (canvas size) — without this, screen draws use a stale/initial viewport.
    regl.poll()
    const cells = grid.cells
    const life = grid.life
    for (let i = 0; i < cells.length; i++) {
      buf[i * 4] = cells[i]
      buf[i * 4 + 1] = life[i]
      buf[i * 4 + 2] = 0
      buf[i * 4 + 3] = 255
    }
    gridTex({
      width: grid.width,
      height: grid.height,
      format: 'rgba',
      type: 'uint8',
      mag: 'nearest',
      min: 'nearest',
      data: buf
    })

    this.drawScene?.({})
    this.drawBright?.({})
    this.drawBlur?.({ src: this.bright, dst: this.blurA, dir: [1, 0] })
    this.drawBlur?.({ src: this.blurA, dst: this.blurB, dir: [0, 1] })
    this.drawComposite?.({})
  }

  dispose(): void {
    this.regl?.destroy()
    this.regl = null
  }
}
