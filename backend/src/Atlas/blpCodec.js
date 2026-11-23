// Decodes BLP2 textures (DXT1/3/5, palettised or raw BGRA) to RGBA. Shared by
// the resource map art script and the dungeon map pipeline.

function rgb565(value) {
  const r = (value >> 11) & 31
  const g = (value >> 5) & 63
  const b = value & 31
  return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)]
}

// One 4×4 colour block. `opaque` blocks (DXT3/5) always use four colours.
function colorBlock(data, offset, opaque) {
  const c0 = data.readUInt16LE(offset)
  const c1 = data.readUInt16LE(offset + 2)
  const a = rgb565(c0)
  const b = rgb565(c1)
  const palette = [[...a, 255], [...b, 255]]
  if (c0 > c1 || opaque) {
    palette.push([0, 1, 2].map((i) => Math.round((2 * a[i] + b[i]) / 3)).concat(255))
    palette.push([0, 1, 2].map((i) => Math.round((a[i] + 2 * b[i]) / 3)).concat(255))
  } else {
    palette.push([0, 1, 2].map((i) => Math.round((a[i] + b[i]) / 2)).concat(255))
    palette.push([0, 0, 0, 0])
  }
  const indices = data.readUInt32LE(offset + 4)
  return Array.from({ length: 16 }, (_, pixel) => palette[(indices >> (pixel * 2)) & 3])
}

function decodeDxt(data, offset, width, height, kind) {
  const out = Buffer.alloc(width * height * 4)
  const blockSize = kind === "dxt1" ? 8 : 16
  let at = offset
  for (let by = 0; by < height; by += 4) {
    for (let bx = 0; bx < width; bx += 4) {
      let alpha = null
      if (kind === "dxt3") {
        alpha = Array.from({ length: 16 }, (_, pixel) => ((data[at + (pixel >> 1)] >> ((pixel & 1) * 4)) & 15) * 17)
      } else if (kind === "dxt5") {
        const a0 = data[at]
        const a1 = data[at + 1]
        const levels = [a0, a1]
        if (a0 > a1) for (let i = 1; i < 7; i += 1) levels.push(Math.round(((7 - i) * a0 + i * a1) / 7))
        else {
          for (let i = 1; i < 5; i += 1) levels.push(Math.round(((5 - i) * a0 + i * a1) / 5))
          levels.push(0, 255)
        }
        let bits = 0n
        for (let i = 0; i < 6; i += 1) bits |= BigInt(data[at + 2 + i]) << BigInt(8 * i)
        alpha = Array.from({ length: 16 }, (_, pixel) => levels[Number((bits >> BigInt(pixel * 3)) & 7n)])
      }
      const colors = colorBlock(data, at + (kind === "dxt1" ? 0 : 8), kind !== "dxt1")
      for (let pixel = 0; pixel < 16; pixel += 1) {
        const x = bx + (pixel & 3)
        const y = by + (pixel >> 2)
        if (x >= width || y >= height) continue
        const target = (y * width + x) * 4
        const [r, g, b, a] = colors[pixel]
        out[target] = r
        out[target + 1] = g
        out[target + 2] = b
        out[target + 3] = alpha ? alpha[pixel] : a
      }
      at += blockSize
    }
  }
  return out
}

export function decodeBlp(data) {
  if (data.toString("latin1", 0, 4) !== "BLP2") throw new Error("not a BLP2 texture")
  const compression = data[8]
  const alphaDepth = data[9]
  const alphaType = data[10]
  const width = data.readUInt32LE(12)
  const height = data.readUInt32LE(16)
  const offset = data.readUInt32LE(20)
  if (compression === 2) {
    const kind = alphaType === 7 ? "dxt5" : alphaType === 1 ? "dxt3" : "dxt1"
    return { width, height, rgba: decodeDxt(data, offset, width, height, kind) }
  }
  const out = Buffer.alloc(width * height * 4)
  if (compression === 3) {
    for (let i = 0; i < width * height; i += 1) {
      out[i * 4] = data[offset + i * 4 + 2]
      out[i * 4 + 1] = data[offset + i * 4 + 1]
      out[i * 4 + 2] = data[offset + i * 4]
      out[i * 4 + 3] = data[offset + i * 4 + 3]
    }
    return { width, height, rgba: out }
  }
  if (compression === 1) {
    const count = width * height
    for (let i = 0; i < count; i += 1) {
      const entry = 148 + data[offset + i] * 4
      out[i * 4] = data[entry + 2]
      out[i * 4 + 1] = data[entry + 1]
      out[i * 4 + 2] = data[entry]
      let alpha = 255
      if (alphaDepth === 8) alpha = data[offset + count + i]
      else if (alphaDepth === 4) alpha = ((data[offset + count + (i >> 1)] >> ((i & 1) * 4)) & 15) * 17
      else if (alphaDepth === 1) alpha = (data[offset + count + (i >> 3)] >> (i & 7)) & 1 ? 255 : 0
      out[i * 4 + 3] = alpha
    }
    return { width, height, rgba: out }
  }
  throw new Error(`unsupported BLP compression ${compression}`)
}
