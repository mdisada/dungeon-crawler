/**
 * Pulls a character off the flat green backdrop the generation prompt asks for (see the `base_char`
 * preset). Pure pixel arithmetic on an RGBA buffer - no DOM, no model, no network.
 *
 * Measured 2026-07-31 against @imgly/background-removal on the same generations: 148 ms per
 * 1024x1024 image versus 2.3-3.7 s, a more decided matte (0.2% of pixels left ambiguous versus
 * 3-6%), and no 42 MB weights to download. See docs/DECISIONS.md.
 *
 * Three ideas carry the quality, and each one was needed:
 *
 * 1. The in/out test runs at subpixel resolution on the ~1.4% of pixels whose neighbourhood
 *    disagrees. Deciding once per pixel is what produced a staircase; deciding nine times and
 *    averaging antialiases the boundary without blurring it. Refining only disputed pixels makes
 *    this as good as supersampling the whole image, for a fifth of the work.
 * 2. The matte is choked by biasing the ramp, not by eroding it. Erosion can only move a boundary
 *    a whole pixel at a time, which nicks bowstrings and chews fur.
 * 3. Edge pixels are un-mixed and de-spilled. An edge pixel is genuinely part subject and part
 *    backdrop, so its stored colour still carries green; recovering the true colour is what removes
 *    the fringe. De-spill is limited to a few pixels of the rim so a green cloak keeps its green.
 */

const TOLERANCE = 60 // chroma distance at which a pixel stops being pure backdrop
const FEATHER = 30 // width of the ramp from backdrop to subject
const BIAS = 8 // subpixel choke: shifts the whole ramp outward
const SUPERSAMPLE = 3 // NxN samples on disputed pixels
const DESPILL_RADIUS = 4 // px; de-spill strength falls to zero this far inside the silhouette
const UNMIX_FLOOR = 0.25 // below this alpha the un-mix divides by too little to be trusted

/** Green dominance a backdrop needs before keying it is safe rather than destructive. */
const MIN_BACKDROP_GREENNESS = 40

export interface Bitmap {
  data: Uint8ClampedArray
  width: number
  height: number
}

/** Mean of the four corners: the backdrop is flat by construction, so corners are a fair sample. */
export function sampleBackdrop({ data, width, height }: Bitmap): [number, number, number] {
  const corners = [
    [2, 2],
    [width - 3, 2],
    [2, height - 3],
    [width - 3, height - 3],
  ].map(([x, y]) => (y * width + x) * 4)
  return [0, 1, 2].map((channel) =>
    Math.round(corners.reduce((sum, index) => sum + data[index + channel], 0) / corners.length),
  ) as [number, number, number]
}

/**
 * Whether this image is a green-screen generation at all. A model that ignored the backdrop clause,
 * or an image the player uploaded, must not be keyed - the result would be holes, not a cutout.
 */
export function isKeyableBackdrop([r, g, b]: [number, number, number]): boolean {
  return g - Math.max(r, b) >= MIN_BACKDROP_GREENNESS
}

function chromaKeyer([kr, kg, kb]: [number, number, number]) {
  // Chroma only: luma noise in the screen must not move the boundary.
  const keyCb = -0.169 * kr - 0.331 * kg + 0.5 * kb
  const keyCr = 0.5 * kr - 0.419 * kg - 0.081 * kb
  return (r: number, g: number, b: number): number => {
    const cb = -0.169 * r - 0.331 * g + 0.5 * b
    const cr = 0.5 * r - 0.419 * g - 0.081 * b
    const distance = Math.hypot(cb - keyCb, cr - keyCr) * 1.6
    const t = (distance - TOLERANCE - BIAS) / FEATHER
    return t <= 0 ? 0 : t >= 1 ? 1 : t
  }
}

function bilinear({ data, width, height }: Bitmap, x: number, y: number): [number, number, number] {
  const x0 = Math.max(0, Math.min(width - 1, Math.floor(x)))
  const y0 = Math.max(0, Math.min(height - 1, Math.floor(y)))
  const x1 = Math.min(width - 1, x0 + 1)
  const y1 = Math.min(height - 1, y0 + 1)
  const fx = x - x0
  const fy = y - y0
  const out: [number, number, number] = [0, 0, 0]
  for (let c = 0; c < 3; c++) {
    out[c] =
      data[(y0 * width + x0) * 4 + c] * (1 - fx) * (1 - fy) +
      data[(y0 * width + x1) * 4 + c] * fx * (1 - fy) +
      data[(y1 * width + x0) * 4 + c] * (1 - fx) * fy +
      data[(y1 * width + x1) * 4 + c] * fx * fy
  }
  return out
}

function alphaField(image: Bitmap, key: ReturnType<typeof chromaKeyer>): Float32Array {
  const { data, width, height } = image
  const alpha = new Float32Array(width * height)
  for (let p = 0; p < alpha.length; p++) {
    const i = p * 4
    alpha[p] = key(data[i], data[i + 1], data[i + 2])
  }

  const step = 1 / SUPERSAMPLE
  const offset = step / 2 - 0.5
  const refined = new Float32Array(alpha)
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const p = y * width + x
      const centre = alpha[p]
      let disputed = centre > 0 && centre < 1
      for (let dy = -1; dy <= 1 && !disputed; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (alpha[(y + dy) * width + x + dx] !== centre) {
            disputed = true
            break
          }
        }
      }
      if (!disputed) continue

      let sum = 0
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const [r, g, b] = bilinear(image, x + sx * step + offset, y + sy * step + offset)
          sum += key(r, g, b)
        }
      }
      refined[p] = sum / (SUPERSAMPLE * SUPERSAMPLE)
    }
  }
  return refined
}

/** Pixels of separation from the nearest non-solid pixel, saturating at `cap`. */
function edgeDistance(alpha: Float32Array, width: number, height: number, cap: number): Uint8Array {
  const distance = new Uint8Array(alpha.length).fill(cap)
  for (let p = 0; p < alpha.length; p++) if (alpha[p] < 0.99) distance[p] = 0
  for (let pass = 0; pass < cap; pass++) {
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const p = y * width + x
        if (distance[p] === 0) continue
        const nearest = Math.min(distance[p - 1], distance[p + 1], distance[p - width], distance[p + width])
        if (nearest + 1 < distance[p]) distance[p] = nearest + 1
      }
    }
  }
  return distance
}

/**
 * Replaces the backdrop with transparency, in place. Returns false without touching the pixels if
 * the image is not a green-screen generation, so the caller can fall back to the original.
 */
export function keyOutBackdrop(image: Bitmap): boolean {
  const backdrop = sampleBackdrop(image)
  if (!isKeyableBackdrop(backdrop)) return false

  const { data, width, height } = image
  const alpha = alphaField(image, chromaKeyer(backdrop))
  const distance = edgeDistance(alpha, width, height, DESPILL_RADIUS + 1)

  for (let p = 0; p < width * height; p++) {
    const i = p * 4
    const a = alpha[p]
    let r = data[i]
    let g = data[i + 1]
    let b = data[i + 2]

    if (a > 0.02 && a < 0.995) {
      // Straight-alpha un-composite: C = a*F + (1-a)*K, solved for F. Faded in above the floor,
      // because dividing by a small alpha moves the colour a long way on very little evidence.
      const inverse = 1 - a
      const trust = Math.max(0, Math.min(1, (a - UNMIX_FLOOR) / UNMIX_FLOOR))
      r += ((r - inverse * backdrop[0]) / a - r) * trust
      g += ((g - inverse * backdrop[1]) / a - g) * trust
      b += ((b - inverse * backdrop[2]) / a - b) * trust
    }

    const spill = distance[p] >= DESPILL_RADIUS ? 0 : 1 - distance[p] / DESPILL_RADIUS
    if (spill > 0) {
      // Green above the red/blue average near an edge is screen contamination, not paint.
      const limit = (r + b) / 2
      if (g > limit) g -= (g - limit) * spill
    }

    data[i] = r
    data[i + 1] = g
    data[i + 2] = b
    data[i + 3] = Math.round(a * 255)
  }
  return true
}
