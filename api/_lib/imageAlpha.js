import zlib from 'node:zlib'

/*
 * Whether a logo has a see-through background, so emails can leave it on the brand colour
 * instead of putting it on a white tile. Reads the PNG itself (no image library): a logo
 * counts as transparent when pixels around its edge are see-through. JPEGs never are.
 */

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
// Bytes per pixel for 8-bit images, by PNG colour type: grey, RGB, palette, grey+alpha, RGBA.
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

const paeth = (left, up, upLeft) => {
  const estimate = left + up - upLeft
  const [a, b, c] = [Math.abs(estimate - left), Math.abs(estimate - up), Math.abs(estimate - upLeft)]
  return a <= b && a <= c ? left : b <= c ? up : upLeft
}

/** The PNG's header, palette transparency and decoded rows, or null if it isn't one we read. */
const readPng = (bytes) => {
  if (!Buffer.isBuffer(bytes) || bytes.length < 33 || !bytes.subarray(0, 8).equals(SIGNATURE)) return null
  let header = null
  let transparency = null
  const data = []
  for (let offset = 8; offset + 8 <= bytes.length; ) {
    const length = bytes.readUInt32BE(offset)
    const type = bytes.toString('latin1', offset + 4, offset + 8)
    const chunk = bytes.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') header = { width: chunk.readUInt32BE(0), height: chunk.readUInt32BE(4), depth: chunk[8], colourType: chunk[9], interlace: chunk[12] }
    else if (type === 'tRNS') transparency = chunk
    else if (type === 'IDAT') data.push(chunk)
    else if (type === 'IEND') break
    offset += 12 + length
  }
  if (!header) return null
  return { ...header, transparency, data: Buffer.concat(data) }
}

/** The alpha of every pixel in the edge rows and columns of an 8-bit RGBA or grey+alpha PNG. */
const edgeAlphas = ({ width, height, colourType, data }) => {
  const channels = CHANNELS[colourType]
  const stride = width * channels
  const raw = zlib.inflateSync(data)
  const rows = []
  let previous = Buffer.alloc(stride)
  for (let y = 0; y < height; y += 1) {
    const start = y * (stride + 1)
    const filter = raw[start]
    const line = Buffer.from(raw.subarray(start + 1, start + 1 + stride))
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? line[x - channels] : 0
      const up = previous[x]
      const upLeft = x >= channels ? previous[x - channels] : 0
      const add = filter === 1 ? left : filter === 2 ? up : filter === 3 ? (left + up) >> 1 : filter === 4 ? paeth(left, up, upLeft) : 0
      line[x] = (line[x] + add) & 255
    }
    rows.push(line)
    previous = line
  }
  const alphaAt = (x, y) => rows[y][x * channels + channels - 1]
  const alphas = []
  for (let x = 0; x < width; x += 1) alphas.push(alphaAt(x, 0), alphaAt(x, height - 1))
  for (let y = 0; y < height; y += 1) alphas.push(alphaAt(0, y), alphaAt(width - 1, y))
  return alphas
}

/**
 * True when the image's background shows through: more than a few edge pixels of a PNG with
 * an alpha channel are see-through, or a palette or grey/RGB PNG declares a transparent
 * colour. Anything unreadable is treated as opaque, which keeps the white tile.
 */
export const hasTransparentBackground = (bytes, contentType = 'image/png') => {
  if (contentType !== 'image/png') return false
  try {
    const png = readPng(bytes)
    if (!png || png.interlace) return Boolean(png?.transparency)
    if (png.colourType === 3 || png.colourType === 0 || png.colourType === 2) return Boolean(png.transparency)
    if (png.depth !== 8) return false
    const alphas = edgeAlphas(png)
    const seeThrough = alphas.filter((alpha) => alpha < 250).length
    return seeThrough / alphas.length > 0.05
  } catch {
    return false
  }
}
