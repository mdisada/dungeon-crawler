// Draws the canonical battle-map grid: 32x32 cells at 1024x1024, so one cell is 32px and one cell
// is 5 feet (CombatState.obstacles uses the same 32x32 coordinate space - see the battle_maps
// migration). Committed as a static asset rather than generated at runtime because it is a
// constant, and because it is handed to an image model as a reference: the same pixels every time
// is the whole point.
//
//   node scripts/make-grid-template.mjs
//
// Outputs frontend/public/templates/grid-32.png (transparent ground) and grid-32-white.png (opaque
// white ground; a reference image with an alpha channel is not honoured everywhere).
//
// No image dependency on purpose - the repo has none at the root, and a grid is a few thousand
// bytes of zlib. The PNG here is written by hand: signature, IHDR, IDAT, IEND.
import { deflateSync } from 'node:zlib'
import fs from 'node:fs'
import path from 'node:path'

const SIZE = 1024
const CELLS = 32
const CELL = SIZE / CELLS // 32px
const MAJOR_EVERY = 8 // heavier line every 8 cells, the way a battle mat is printed

const OUT_DIR = path.join(import.meta.dirname, '..', 'frontend', 'public', 'templates')

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  // Each scanline is prefixed with its filter byte; 0 (none) keeps this readable and still
  // compresses to nothing, because a grid is mostly repeated rows.
  const raw = Buffer.alloc(height * (width * 4 + 1))
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// The reference's own line weight carries into the generated map: a black lattice produces a map
// with black lines ruled over the art, which reads as graph paper rather than as a battle mat.
// `faint` is the one handed to the model for that reason; the dark ones stay for anything a person
// looks at directly.
const WEIGHTS = {
  dark: { minor: [70, 70, 78], major: [20, 20, 24] },
  faint: { minor: [176, 176, 182], major: [148, 148, 156] },
}

function draw({ opaque, weight }) {
  const { minor, major } = WEIGHTS[weight]
  const rgba = Buffer.alloc(SIZE * SIZE * 4)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4
      const onMinor = x % CELL === 0 || y % CELL === 0 || x === SIZE - 1 || y === SIZE - 1
      // Major lines are 2px, so blocks of eight can be counted without measuring.
      const onMajor =
        x % (CELL * MAJOR_EVERY) === 0 ||
        y % (CELL * MAJOR_EVERY) === 0 ||
        (x + 1) % (CELL * MAJOR_EVERY) === 0 ||
        (y + 1) % (CELL * MAJOR_EVERY) === 0

      const line = onMajor ? major : onMinor ? minor : null
      if (line) {
        rgba[i] = line[0]
        rgba[i + 1] = line[1]
        rgba[i + 2] = line[2]
        rgba[i + 3] = 255
      } else {
        const ground = opaque ? 255 : 0
        rgba[i] = ground
        rgba[i + 1] = ground
        rgba[i + 2] = ground
        rgba[i + 3] = opaque ? 255 : 0
      }
    }
  }
  return encodePng(SIZE, SIZE, rgba)
}

fs.mkdirSync(OUT_DIR, { recursive: true })
fs.writeFileSync(path.join(OUT_DIR, 'grid-32.png'), draw({ opaque: false, weight: 'dark' }))
fs.writeFileSync(path.join(OUT_DIR, 'grid-32-white.png'), draw({ opaque: true, weight: 'dark' }))
fs.writeFileSync(path.join(OUT_DIR, 'grid-32-faint.png'), draw({ opaque: true, weight: 'faint' }))
console.log(
  `wrote grid-32.png, grid-32-white.png and grid-32-faint.png ` +
    `(${SIZE}x${SIZE}, ${CELLS}x${CELLS} cells of ${CELL}px) to ${OUT_DIR}`,
)
