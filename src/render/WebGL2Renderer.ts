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
      // alpha:true so empty cells are transparent and the photo aquarium behind
      // the canvas shows through (the contents look like they're inside the tank).
      alpha: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true,
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
        uEmptyId: Material.Empty,
        uWallId: Material.Wall,
        uSandId: Material.Sand,
        uPlantId: Material.Plant,
        uStoneId: Material.Stone,
        uSteamId: Material.Steam,
        uTime: regl.prop<{ uTime: number }, 'uTime'>('uTime')
      },
      vert: VERT,
      frag: `
        precision highp float;
        varying vec2 vUv;
        uniform sampler2D uGrid, uPalette;
        uniform vec2 uGridSize;
        uniform float uFireLife, uSteamLife, uFireId, uWaterId, uEmptyId, uWallId, uSandId, uPlantId, uStoneId, uSteamId;
        uniform float uTime;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float cellId(vec2 uv) {
          return floor(texture2D(uGrid, uv).r * 255.0 + 0.5);
        }
        float isWater(float id) { return 1.0 - step(0.5, abs(id - uWaterId)); }
        float isEmpty(float id) { return 1.0 - step(0.5, abs(id - uEmptyId)); }
        float isFoamSolid(float id) {
          float solid = 0.0;
          solid = max(solid, 1.0 - step(0.5, abs(id - uWallId)));
          solid = max(solid, 1.0 - step(0.5, abs(id - uSandId)));
          solid = max(solid, 1.0 - step(0.5, abs(id - uPlantId)));
          solid = max(solid, 1.0 - step(0.5, abs(id - uStoneId)));
          return solid;
        }
        void main() {
          vec2 uv = vec2(vUv.x, 1.0 - vUv.y);            // row 0 = top
          vec4 cell = texture2D(uGrid, uv);
          float id = floor(cell.r * 255.0 + 0.5);
          float life = cell.g;                            // 0..1
          vec4 pal = texture2D(uPalette, vec2((id + 0.5) / 9.0, 0.5));
          vec3 col = pal.rgb;
          if (abs(id - uEmptyId) < 0.5) {
            // Empty is transparent in the final composite; this dark base only
            // shows where water film spills onto empty cells (reads as deep water).
            col = vec3(0.02, 0.05, 0.09);
          }
          if (abs(id - uWaterId) < 0.5) {
            float belowIdForWater = cellId(uv + vec2(0.0, 1.0 / uGridSize.y));
            vec3 belowColForWater = texture2D(uPalette, vec2((belowIdForWater + 0.5) / 9.0, 0.5)).rgb;
            float solidBelowWater = isFoamSolid(belowIdForWater);
            col = mix(vec3(0.04, 0.045, 0.075), belowColForWater * 0.72, solidBelowWater);
          }
          vec2 texel = 1.0 / uGridSize;
          vec2 c = floor(uv * uGridSize);
          vec2 inCell = fract(uv * uGridSize);
          float currentWater = isWater(id);
          float emptyCell = isEmpty(id);
          float leftWater = isWater(cellId(uv - vec2(texel.x, 0.0)));
          float rightWater = isWater(cellId(uv + vec2(texel.x, 0.0)));
          float aboveId = cellId(uv - vec2(0.0, texel.y));
          float belowId = cellId(uv + vec2(0.0, texel.y));
          float aboveWater = isWater(aboveId);
          float below1 = isWater(belowId);
          float metaField = currentWater * 1.2;
          metaField += leftWater * smoothstep(1.02, 0.34, length(inCell - vec2(-0.48, 0.5)));
          metaField += rightWater * smoothstep(1.02, 0.34, length(inCell - vec2(1.48, 0.5)));
          metaField += aboveWater * smoothstep(1.12, 0.34, length(inCell - vec2(0.5, -0.52)));
          metaField += below1 * smoothstep(1.12, 0.34, length(inCell - vec2(0.5, 1.52)));
          metaField += isWater(cellId(uv + vec2(texel.x, texel.y))) * smoothstep(1.26, 0.44, length(inCell - vec2(1.35, 1.35))) * 0.65;
          metaField += isWater(cellId(uv + vec2(-texel.x, texel.y))) * smoothstep(1.26, 0.44, length(inCell - vec2(-0.35, 1.35))) * 0.65;
          metaField += isWater(cellId(uv + vec2(texel.x, -texel.y))) * smoothstep(1.26, 0.44, length(inCell - vec2(1.35, -0.35))) * 0.65;
          metaField += isWater(cellId(uv + vec2(-texel.x, -texel.y))) * smoothstep(1.26, 0.44, length(inCell - vec2(-0.35, -0.35))) * 0.65;
          float waterCoverage = currentWater + emptyCell * smoothstep(0.38, 0.72, metaField);

          if (abs(id - uFireId) < 0.5) {
            float t = clamp(life * 255.0 / uFireLife, 0.0, 1.0);
            col = vec3(1.0, 0.27 + t * 0.67, t * t * 0.35);
          } else if (abs(id - uSteamId) < 0.5) {
            float t = clamp(life * 255.0 / uSteamLife, 0.0, 1.0);
            col = vec3(0.6 + t * 0.27);
          } else if (false && waterCoverage > 0.001) {
            float below2 = isWater(cellId(uv + vec2(0.0, texel.y * 2.0)));
            float below3 = isWater(cellId(uv + vec2(0.0, texel.y * 3.0)));
            float below5 = isWater(cellId(uv + vec2(0.0, texel.y * 5.0)));
            float depth = clamp(0.12 + (below1 + below2 + below3 + below5) * 0.2 + (leftWater + rightWater) * 0.06, 0.0, 1.0);
            float surface = max(1.0 - aboveWater, emptyCell * waterCoverage);
            float stream = aboveWater * below1 * (1.0 - min(leftWater + rightWater, 1.0));
            float worldX = uv.x * uGridSize.x;
            float worldY = uv.y * uGridSize.y;
            float smoothNoise = sin(worldX * 0.37 + uTime * 1.7) * 0.5 + sin(worldX * 0.91 - uTime * 2.4) * 0.3 + sin((worldX + worldY) * 0.16 + uTime * 0.8) * 0.2;
            float surfaceDistance = min(
              abs(inCell.y - 0.18),
              min(abs(inCell.y - 0.18 + smoothNoise * 0.035), abs(inCell.y - 0.18 - smoothNoise * 0.025))
            );

            vec3 shallow = vec3(0.34, 0.78, 0.98);
            vec3 deep = vec3(0.02, 0.12, 0.34);
            vec3 waterCol = mix(shallow, deep, depth);
            waterCol *= 0.955 + smoothNoise * 0.018;
            vec3 belowPal = texture2D(uPalette, vec2((belowId + 0.5) / 9.0, 0.5)).rgb;
            float solidUnder = isFoamSolid(belowId);
            float shallowFloor = solidUnder * (1.0 - depth) * 0.72;
            waterCol = mix(waterCol, belowPal * 0.82 + shallow * 0.18, shallowFloor);

            float leftGap = 1.0 - leftWater;
            float rightGap = 1.0 - rightWater;
            float topGap = surface;
            float bottomGap = 1.0 - below1;
            float roundTL = leftGap * topGap * (1.0 - smoothstep(0.22, 0.58, length(inCell - vec2(0.0, 0.0))));
            float roundTR = rightGap * topGap * (1.0 - smoothstep(0.22, 0.58, length(inCell - vec2(1.0, 0.0))));
            float roundBL = leftGap * bottomGap * (1.0 - smoothstep(0.2, 0.54, length(inCell - vec2(0.0, 1.0))));
            float roundBR = rightGap * bottomGap * (1.0 - smoothstep(0.2, 0.54, length(inCell - vec2(1.0, 1.0))));
            float coverage = clamp(1.0 - (roundTL + roundTR + roundBL * 0.7 + roundBR * 0.7), 0.0, 1.0);
            coverage = max(coverage * currentWater, emptyCell * waterCoverage);
            float surfaceWave = surface * (0.075 + smoothNoise * 0.036);
            float surfaceMask = smoothstep(surfaceWave - 0.06, surfaceWave + 0.18, inCell.y);
            coverage *= mix(1.0, surfaceMask, surface);
            vec3 bg = col;
            col = mix(bg, waterCol, coverage);

            float sideEdge = max((1.0 - leftWater) * smoothstep(0.28, 0.02, inCell.x), (1.0 - rightWater) * smoothstep(0.72, 0.98, inCell.x));
            float topBand = surface * exp(-pow(surfaceDistance * 5.0, 2.0)) * 0.72;
            float topSheen = surface * exp(-pow((inCell.y - 0.34 - surfaceWave * 0.35) * 3.2, 2.0)) * 0.28;
            float topBevel = surface * smoothstep(0.64, 0.02, inCell.y) * 0.46;
            float bottomShade = below1 * smoothstep(0.58, 1.0, inCell.y) * 0.14;
            float shoreGlow = solidUnder * smoothstep(0.46, 1.0, inCell.y) * (1.0 - depth);
            col += vec3(0.06, 0.18, 0.24) * sideEdge * coverage;
            col += vec3(0.14, 0.27, 0.33) * topBevel * coverage;
            col += vec3(0.14, 0.28, 0.31) * topBand * coverage;
            col += vec3(0.05, 0.13, 0.18) * topSheen * coverage;
            col += vec3(0.16, 0.22, 0.17) * shoreGlow * coverage;
            col -= vec3(0.02, 0.06, 0.10) * bottomShade * coverage;

            vec2 normalSlope = vec2(leftWater - rightWater, surface * 0.75 - below1 * 0.2);
            vec3 n = normalize(vec3(normalSlope, 1.15));
            vec3 lightDir = normalize(vec3(-0.38, -0.62, 0.68));
            float specBase = max(dot(n, lightDir), 0.0);
            float wave = sin(worldX * 0.42 + uTime * 3.1) + sin(worldX * 0.19 + worldY * 0.08 - uTime * 2.0);
            float rippleMask = surface * smoothstep(0.72, 0.99, wave * 0.5 + 0.5);
            float spec = pow(specBase, 40.0) * 0.34 * (surface + sideEdge * 0.45) + rippleMask * 0.045;
            col += vec3(0.55, 0.72, 0.78) * spec * coverage;

            float strand = stream * (0.5 + 0.5 * sin(inCell.y * 18.0 + uTime * 7.0 + c.x * 0.4));
            float center = 1.0 - smoothstep(0.12, 0.46, abs(inCell.x - 0.5));
            col += vec3(0.18, 0.34, 0.38) * strand * center * coverage;
            col -= vec3(0.02, 0.05, 0.08) * stream * (1.0 - center) * 0.55 * coverage;

            float causticA = sin((c.x + c.y * 0.62) * 0.58 + uTime * 2.1);
            float causticB = sin((c.x * -0.38 + c.y) * 0.73 - uTime * 1.7);
            float solidBelow = isFoamSolid(cellId(uv + vec2(0.0, texel.y))) + isFoamSolid(cellId(uv + vec2(texel.x, texel.y))) + isFoamSolid(cellId(uv + vec2(-texel.x, texel.y)));
            float caustic = smoothstep(1.12, 1.86, causticA + causticB) * (1.0 - surface) * clamp(solidBelow, 0.0, 1.0) * (1.0 - depth * 0.38);
            col += vec3(0.12, 0.19, 0.15) * caustic * coverage;

            float edgeSolid = 0.0;
            edgeSolid = max(edgeSolid, isFoamSolid(cellId(uv + vec2(texel.x, 0.0))));
            edgeSolid = max(edgeSolid, isFoamSolid(cellId(uv - vec2(texel.x, 0.0))));
            edgeSolid = max(edgeSolid, isFoamSolid(cellId(uv + vec2(0.0, texel.y))));
            edgeSolid = max(edgeSolid, isFoamSolid(cellId(uv - vec2(0.0, texel.y))));
            float foamNoise = smoothstep(0.54, 0.94, 0.5 + 0.5 * sin(worldX * 1.7 + worldY * 0.6 + uTime * 4.0));
            float foam = edgeSolid * (solidUnder * 0.86 + sideEdge * 0.08) * foamNoise * 0.18 * coverage;
            col = mix(col, vec3(0.86, 0.94, 0.98), foam);
          } else if (id > 0.5 && abs(id - uWaterId) > 0.5) {
            // faux volume: lit from above — exposed (surface) cells brighter,
            // buried cells slightly darker, so piles read as 3D mounds.
            float aboveSame = 1.0 - step(0.5, abs(cellId(uv - vec2(0.0, texel.y)) - id));
            float belowSame = 1.0 - step(0.5, abs(cellId(uv + vec2(0.0, texel.y)) - id));
            col *= 1.0 + (1.0 - aboveSame) * 0.20 - belowSame * 0.05;
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
        uGrid: gridTex,
        uPalette: palette,
        uGridSize: [width, height],
        uWaterId: Material.Water,
        uSandId: Material.Sand,
        uStoneId: Material.Stone,
        uWallId: Material.Wall,
        uPlantId: Material.Plant,
        uEmptyId: Material.Empty,
        uFireId: Material.Fire,
        uSteamId: Material.Steam,
        uTime: regl.prop<{ uTime: number }, 'uTime'>('uTime'),
        uIntensity: 2.5
      },
      vert: VERT,
      frag: `
        precision highp float;
        varying vec2 vUv;
        uniform sampler2D uScene, uBloom, uGrid, uPalette;
        uniform vec2 uGridSize;
        uniform float uWaterId, uSandId, uStoneId, uWallId, uPlantId, uTime, uIntensity;
        uniform float uEmptyId, uFireId, uSteamId;
        float cellId(vec2 uv) {
          return floor(texture2D(uGrid, uv).r * 255.0 + 0.5);
        }
        float isWater(float id) { return 1.0 - step(0.5, abs(id - uWaterId)); }
        float isSolid(float id) {
          float solid = 0.0;
          solid = max(solid, 1.0 - step(0.5, abs(id - uSandId)));
          solid = max(solid, 1.0 - step(0.5, abs(id - uStoneId)));
          solid = max(solid, 1.0 - step(0.5, abs(id - uWallId)));
          solid = max(solid, 1.0 - step(0.5, abs(id - uPlantId)));
          return solid;
        }
        float waterBlob(vec2 guv) {
          vec2 cell = floor(guv * uGridSize);
          vec2 f = fract(guv * uGridSize);
          vec2 t = 1.0 / uGridSize;
          float field = isWater(cellId(guv)) * 1.12;
          field += isWater(cellId(guv + vec2(t.x, 0.0))) * smoothstep(1.08, 0.28, length(f - vec2(1.42, 0.5)));
          field += isWater(cellId(guv - vec2(t.x, 0.0))) * smoothstep(1.08, 0.28, length(f - vec2(-0.42, 0.5)));
          field += isWater(cellId(guv + vec2(0.0, t.y))) * smoothstep(1.12, 0.28, length(f - vec2(0.5, 1.45)));
          field += isWater(cellId(guv - vec2(0.0, t.y))) * smoothstep(1.12, 0.28, length(f - vec2(0.5, -0.45)));
          field += isWater(cellId(guv + vec2(t.x, t.y))) * smoothstep(1.32, 0.48, length(f - vec2(1.34, 1.34))) * 0.55;
          field += isWater(cellId(guv + vec2(-t.x, t.y))) * smoothstep(1.32, 0.48, length(f - vec2(-0.34, 1.34))) * 0.55;
          field += isWater(cellId(guv + vec2(t.x, -t.y))) * smoothstep(1.32, 0.48, length(f - vec2(1.34, -0.34))) * 0.55;
          field += isWater(cellId(guv + vec2(-t.x, -t.y))) * smoothstep(1.32, 0.48, length(f - vec2(-0.34, -0.34))) * 0.55;
          return field;
        }
        void main(){
          vec3 base = texture2D(uScene, vUv).rgb;
          vec3 c = base + texture2D(uBloom, vUv).rgb * uIntensity;

          vec2 guv = vec2(vUv.x, 1.0 - vUv.y);
          vec2 t = 1.0 / uGridSize;
          float id = cellId(guv);
          float above = isWater(cellId(guv - vec2(0.0, t.y)));
          float below = isWater(cellId(guv + vec2(0.0, t.y)));
          float below2 = isWater(cellId(guv + vec2(0.0, t.y * 2.0)));
          float side = max(isWater(cellId(guv - vec2(t.x, 0.0))), isWater(cellId(guv + vec2(t.x, 0.0))));
          float field = waterBlob(guv);
          float mask = smoothstep(0.44, 0.78, field);
          float surface = mask * (1.0 - above);
          float depth = clamp(0.08 + below * 0.18 + below2 * 0.13 + side * 0.08, 0.0, 1.0);

          vec2 p = guv * uGridSize;
          float wave = sin(p.x * 0.22 + uTime * 1.4) * 0.5 + sin(p.x * 0.61 - uTime * 2.1) * 0.28 + sin((p.x + p.y) * 0.11 + uTime * 0.9) * 0.22;
          float surfaceLine = surface * exp(-pow((fract(p.y) - 0.22 - wave * 0.025) * 4.4, 2.0));
          float shimmer = surface * smoothstep(0.8, 1.0, 0.5 + 0.5 * sin(p.x * 0.37 + uTime * 2.8 + wave));

          vec3 shallow = vec3(0.42, 0.78, 0.88);
          vec3 deep = vec3(0.04, 0.18, 0.34);
          vec3 water = mix(shallow, deep, depth);
          float floorId = cellId(guv + vec2(0.0, t.y));
          vec3 floorCol = texture2D(uPalette, vec2((floorId + 0.5) / 9.0, 0.5)).rgb;
          float shallowFloor = isSolid(floorId) * (1.0 - depth) * 0.8;
          water = mix(water, floorCol * 0.86 + shallow * 0.14, shallowFloor);
          water += vec3(0.07, 0.13, 0.14) * surfaceLine;
          water += vec3(0.12, 0.18, 0.18) * shimmer * 0.12;

          // Blend the water film colour over the scene colour.
          float waterMix = clamp(mask * (0.55 + depth * 0.3), 0.0, 0.92);
          waterMix = max(waterMix, surfaceLine * 0.4);
          c = mix(c, water, waterMix);

          // Faux depth: ambient occlusion toward the tank glass (canvas edges)
          // and floor, so the contents read as sitting inside a 3D tank.
          float aoX = min(smoothstep(0.0, 0.09, vUv.x), smoothstep(0.0, 0.09, 1.0 - vUv.x));
          float aoFloor = smoothstep(0.0, 0.10, vUv.y);
          c *= mix(0.80, 1.0, aoX) * mix(0.86, 1.0, aoFloor);

          // Per-pixel opacity: empty cells stay transparent so the photo tank
          // shows through; materials/water/glow become visible "inside" it.
          float emptyHere = 1.0 - step(0.5, abs(id - uEmptyId));
          float fireHere = 1.0 - step(0.5, abs(id - uFireId));
          float steamHere = 1.0 - step(0.5, abs(id - uSteamId));
          float solidHere = isSolid(id);
          float waterHere = isWater(id);

          float outA = 0.0;
          outA = max(outA, solidHere);
          outA = max(outA, fireHere);
          outA = max(outA, steamHere * 0.82);
          // water cells + metaball spill onto neighbouring empty cells
          float waterA = max(waterHere * (0.5 + depth * 0.28), mask * (0.32 + depth * 0.3));
          outA = max(outA, waterA);
          // keep the bloom glow visible over the transparent background
          float bloomA = clamp(dot(texture2D(uBloom, vUv).rgb * uIntensity, vec3(0.34)), 0.0, 1.0);
          outA = max(outA, bloomA);

          outA = clamp(outA, 0.0, 1.0);
          gl_FragColor = vec4(c * outA, outA); // premultiplied alpha
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

  render(grid: GridView, elapsedSeconds = 0): void {
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

    this.drawScene?.({ uTime: elapsedSeconds })
    this.drawBright?.({})
    this.drawBlur?.({ src: this.bright, dst: this.blurA, dir: [1, 0] })
    this.drawBlur?.({ src: this.blurA, dst: this.blurB, dir: [0, 1] })
    this.drawComposite?.({ uTime: elapsedSeconds })
  }

  dispose(): void {
    this.regl?.destroy()
    this.regl = null
  }
}
