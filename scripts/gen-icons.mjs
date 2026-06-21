// Generates PWA PNG icons (no external deps — hand-rolled PNG encoder).
// Run with: npm run gen-icons
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', 'public')
mkdirSync(outDir, { recursive: true })

// --- CRC32 ---------------------------------------------------------------
const crcTable = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0)
  return Buffer.concat([len, typeBytes, data, crc])
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type RGBA
  // 10,11,12 = compression / filter / interlace = 0

  // raw scanlines with filter byte 0 per row
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
  }
  const idat = deflateSync(raw, { level: 9 })

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// --- icon artwork --------------------------------------------------------
function drawIcon(size) {
  const rgba = Buffer.alloc(size * size * 4)
  const set = (x, y, r, g, b) => {
    const o = (y * size + x) * 4
    rgba[o] = r
    rgba[o + 1] = g
    rgba[o + 2] = b
    rgba[o + 3] = 255
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size
      const v = y / size
      // background
      let r = 10
      let g = 10
      let b = 18

      // water band along the bottom
      if (v > 0.72) {
        r = 49
        g = 110
        b = 198
      }

      // sand cone, peak centred
      const dist = Math.abs(u - 0.5)
      if (dist <= 0.4) {
        const surface = 0.34 + (dist / 0.4) * (0.78 - 0.34)
        if (v >= surface && v <= 0.8) {
          const shade = 1 - dist * 0.5
          r = Math.round(226 * shade)
          g = Math.round(194 * shade)
          b = Math.round(117 * shade)
        }
      }

      // a glowing ember inside the heap
      const ex = u - 0.5
      const ey = v - 0.62
      if (ex * ex + ey * ey < 0.0032) {
        r = 255
        g = 132
        b = 40
      }

      set(x, y, r, g, b)
    }
  }
  return encodePng(size, size, rgba)
}

const targets = [
  ['pwa-192x192.png', 192],
  ['pwa-512x512.png', 512],
  ['apple-touch-icon.png', 180]
]

for (const [name, size] of targets) {
  writeFileSync(join(outDir, name), drawIcon(size))
  console.log(`wrote ${name} (${size}x${size})`)
}
