#!/usr/bin/env node
// Builds the resource map's art from the game's own maps (Classic Era), one
// WebP per uiMapID at the 1002 × 668 the game draws them at:
//
// - Azeroth (947): the world map, whole. The map's base layer.
// - Every zone: fully explored (each discovered-area overlay painted over
//   the base art, as the game shows it once a player has been everywhere),
//   then cut out to the zone's own land with a feathered edge. Laid over the
//   world map in their own rectangles, the zones join into one seamless,
//   detailed map, with no frames, fog or neighbouring zones' labels.
//
// The art is Blizzard's. It comes from the game client's files through
// wago.tools, a public mirror of them: the UiMap* tables say which 256px
// tiles make up each map, WorldMapOverlay* which tiles each explored area
// adds, and each tile is a BLP texture. This script decodes the tiles (BLP2:
// DXT1/3/5, palettised or raw BGRA), stitches them and encodes WebP with
// cwebp (libwebp: `brew install webp`).
//
//   node scripts/fetchMapArt.mjs [--out public/wow-art/maps] [--cache DIR]
//                                [--branch wow_classic_era] [--quality 82]
//                                [--only 1429,1436]
//
// Tiles are cached by FileDataID, so a rerun downloads nothing it has.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { AZEROTH_MAP_ID, getAtlas } from '../src/Player/Map/atlas.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => {
  if (value.startsWith('--')) pairs.push([value.slice(2), all[index + 1]])
  return pairs
}, []))
const OUT = path.resolve(here, '..', args.out || 'public/wow-art/maps')
const CACHE = path.resolve(args.cache || path.join(tmpdir(), 'guildweaver-map-tiles'))
const BRANCH = args.branch || 'wow_classic_era'
const QUALITY = String(Number(args.quality) || 82)
const USER_AGENT = 'guildweaver-map-art/1.0 (+https://github.com/Indicaza/holdfast)'
const CONCURRENCY = 4

// ------------------------------------------------------------------ Data

async function fetchWithRetry(url, attempts = 4) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return Buffer.from(await response.arrayBuffer())
    } catch (error) {
      if (attempt >= attempts) throw new Error(`${url}: ${error.message}`)
      await new Promise((resolve) => setTimeout(resolve, 600 * attempt))
    }
  }
}

function parseCsv(text) {
  const [header, ...rows] = text.trim().split(/\r?\n/)
  const keys = header.split(',')
  // The tables used here hold numbers only, so a plain split is enough.
  return rows.map((row) => Object.fromEntries(row.split(',').map((value, index) => [keys[index], value])))
}

async function table(name) {
  const body = await fetchWithRetry(`https://wago.tools/db2/${name}/csv?branch=${BRANCH}`)
  return parseCsv(body.toString('utf8'))
}

async function tile(fileDataId) {
  const file = path.join(CACHE, `${fileDataId}.blp`)
  if (existsSync(file) && statSync(file).size > 0) return readFileSync(file)
  const body = await fetchWithRetry(`https://wago.tools/api/casc/${fileDataId}?download`)
  writeFileSync(file, body)
  return body
}

// ------------------------------------------------------------------ BLP

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
  const blockSize = kind === 'dxt1' ? 8 : 16
  let at = offset
  for (let by = 0; by < height; by += 4) {
    for (let bx = 0; bx < width; bx += 4) {
      let alpha = null
      if (kind === 'dxt3') {
        alpha = Array.from({ length: 16 }, (_, pixel) => ((data[at + (pixel >> 1)] >> ((pixel & 1) * 4)) & 15) * 17)
      } else if (kind === 'dxt5') {
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
      const colors = colorBlock(data, at + (kind === 'dxt1' ? 0 : 8), kind !== 'dxt1')
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

function decodeBlp(data) {
  if (data.toString('latin1', 0, 4) !== 'BLP2') throw new Error('not a BLP2 texture')
  const compression = data[8]
  const alphaDepth = data[9]
  const alphaType = data[10]
  const width = data.readUInt32LE(12)
  const height = data.readUInt32LE(16)
  const offset = data.readUInt32LE(20)
  if (compression === 2) {
    const kind = alphaType === 7 ? 'dxt5' : alphaType === 1 ? 'dxt3' : 'dxt1'
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

// ------------------------------------------------------------------ Masks

// Squared Euclidean distance from every pixel to the nearest `inside` pixel
// (Felzenszwalb & Huttenlocher): two passes of a 1D lower envelope.
function distanceField(inside, width, height) {
  const INF = 1e20
  const field = new Float64Array(width * height)
  for (let i = 0; i < field.length; i += 1) field[i] = inside[i] ? 0 : INF
  const size = Math.max(width, height)
  const f = new Float64Array(size)
  const d = new Float64Array(size)
  const v = new Int32Array(size)
  const z = new Float64Array(size + 1)
  const pass = (n, read, write) => {
    for (let q = 0; q < n; q += 1) f[q] = read(q)
    let k = 0
    v[0] = 0
    z[0] = -INF
    z[1] = INF
    for (let q = 1; q < n; q += 1) {
      let s
      for (;;) {
        s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
        if (s > z[k] || k === 0) break
        k -= 1
      }
      if (s <= z[k]) { v[k] = q; z[k + 1] = INF; continue }
      k += 1
      v[k] = q
      z[k] = s
      z[k + 1] = INF
    }
    k = 0
    for (let q = 0; q < n; q += 1) {
      while (z[k + 1] < q) k += 1
      d[q] = (q - v[k]) ** 2 + f[v[k]]
    }
    for (let q = 0; q < n; q += 1) write(q, d[q])
  }
  for (let x = 0; x < width; x += 1) pass(height, (y) => field[y * width + x], (y, value) => { field[y * width + x] = value })
  for (let y = 0; y < height; y += 1) pass(width, (x) => field[y * width + x], (x, value) => { field[y * width + x] = value })
  return field
}

// Pixels not reachable from the image's edge through `outside` pixels.
function fillHoles(inside, width, height) {
  const reached = new Uint8Array(width * height)
  const stack = []
  const push = (x, y) => {
    const index = y * width + x
    if (inside[index] || reached[index]) return
    reached[index] = 1
    stack.push(index)
  }
  for (let x = 0; x < width; x += 1) { push(x, 0); push(x, height - 1) }
  for (let y = 0; y < height; y += 1) { push(0, y); push(width - 1, y) }
  while (stack.length) {
    const index = stack.pop()
    const x = index % width
    const y = (index - x) / width
    if (x > 0) push(x - 1, y)
    if (x < width - 1) push(x + 1, y)
    if (y > 0) push(x, y - 1)
    if (y < height - 1) push(x, y + 1)
  }
  return Uint8Array.from(reached, (value) => (value ? 0 : 1))
}

// A zone's own land: where the game draws its explored areas. Gaps between
// them close, holes fill, and the edge feathers so a zone melts into its
// neighbours and the world map beneath. Returns alpha 0–255 per pixel.
export function landMask(coverage, width, height, { close = 22, grow = 10, feather = 14, frame = 6 } = {}) {
  const solid = Uint8Array.from(coverage, (alpha) => (alpha > 110 ? 1 : 0))
  const near = distanceField(solid, width, height)
  const dilated = Uint8Array.from(near, (value) => (value <= close * close ? 1 : 0))
  const outside = distanceField(Uint8Array.from(dilated, (value) => 1 - value), width, height)
  const closed = fillHoles(Uint8Array.from(outside, (value) => (value > close * close ? 1 : 0)), width, height)
  // Keep whatever the overlays drew, even thin parts the closing shaved off.
  for (let i = 0; i < closed.length; i += 1) if (solid[i]) closed[i] = 1
  const distance = distanceField(closed, width, height)
  const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t))
  const alpha = new Uint8Array(width * height)
  for (let i = 0; i < alpha.length; i += 1) {
    const x = i % width
    const y = (i - x) / width
    // The map's torn-parchment frame runs along its edges: fade it out.
    const edge = Math.min(x, y, width - 1 - x, height - 1 - y)
    const fade = (1 - smooth((Math.sqrt(distance[i]) - grow) / feather)) * smooth((edge - frame) / feather)
    alpha[i] = Math.round(fade * 255)
  }
  return alpha
}

// ------------------------------------------------------------------ Build

function writeWebp(file, width, height, rgba) {
  const pam = path.join(CACHE, `stitch-${process.pid}.pam`)
  const header = `P7\nWIDTH ${width}\nHEIGHT ${height}\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n`
  writeFileSync(pam, Buffer.concat([Buffer.from(header, 'latin1'), rgba]))
  try {
    execFileSync('cwebp', ['-quiet', '-q', QUALITY, '-m', '6', '-alpha_q', '90', '-sharp_yuv', pam, '-o', file])
  } finally {
    rmSync(pam, { force: true })
  }
}

// The map's base art, stitched from its tiles and cropped to its drawn size.
async function stitch(tiles, layer) {
  const canvasWidth = Math.ceil(layer.width / layer.tileWidth) * layer.tileWidth
  const canvas = Buffer.alloc(canvasWidth * Math.ceil(layer.height / layer.tileHeight) * layer.tileHeight * 4)
  for (const entry of tiles) {
    const { width, height, rgba } = decodeBlp(await tile(entry.fileDataId))
    for (let y = 0; y < height; y += 1) {
      const target = ((entry.row * layer.tileHeight + y) * canvasWidth + entry.col * layer.tileWidth) * 4
      rgba.copy(canvas, target, y * width * 4, (y + 1) * width * 4)
    }
  }
  const cropped = Buffer.alloc(layer.width * layer.height * 4)
  for (let y = 0; y < layer.height; y += 1) {
    canvas.copy(cropped, y * layer.width * 4, y * canvasWidth * 4, y * canvasWidth * 4 + layer.width * 4)
  }
  return cropped
}

// Reads an RGBA image between pixels, clamped at its edges.
function bilinear(pixels, width, height) {
  return (x, y, out) => {
    const cx = Math.min(width - 1, Math.max(0, x))
    const cy = Math.min(height - 1, Math.max(0, y))
    const x0 = Math.floor(cx)
    const y0 = Math.floor(cy)
    const x1 = Math.min(width - 1, x0 + 1)
    const y1 = Math.min(height - 1, y0 + 1)
    const fx = cx - x0
    const fy = cy - y0
    for (let channel = 0; channel < 4; channel += 1) {
      const top = pixels[(y0 * width + x0) * 4 + channel] * (1 - fx) + pixels[(y0 * width + x1) * 4 + channel] * fx
      const bottom = pixels[(y1 * width + x0) * 4 + channel] * (1 - fx) + pixels[(y1 * width + x1) * 4 + channel] * fx
      out[channel] = top * (1 - fy) + bottom * fy
    }
    return out
  }
}

// Paints a zone's explored areas over its base art, the way the game does
// once a player has discovered them: each overlay is a texture cut into
// 256px tiles, the last row and column holding only what is left over.
// Returns how much of each pixel the overlays cover.
async function paintOverlays(rgba, layer, overlays) {
  const coverage = new Uint8Array(layer.width * layer.height)
  const TILE = 256
  // The game sizes each tile's texture to the next power of two that holds
  // it and maps the file onto that, so a file stored larger (some are) is
  // scaled down to fit.
  const fileSpan = (pixels) => {
    let span = 16
    while (span < pixels) span *= 2
    return span
  }
  for (const overlay of overlays) {
    for (const entry of overlay.tiles) {
      const { width, height, rgba: pixels } = decodeBlp(await tile(entry.fileDataId))
      const drawWidth = Math.min(TILE, overlay.width - entry.col * TILE)
      const drawHeight = Math.min(TILE, overlay.height - entry.row * TILE)
      const scaleX = width / fileSpan(drawWidth)
      const scaleY = height / fileSpan(drawHeight)
      const sample = bilinear(pixels, width, height)
      const left = overlay.x + entry.col * TILE
      const top = overlay.y + entry.row * TILE
      const texel = [0, 0, 0, 0]
      for (let y = 0; y < drawHeight; y += 1) {
        const ty = top + y
        if (ty < 0 || ty >= layer.height) continue
        for (let x = 0; x < drawWidth; x += 1) {
          const tx = left + x
          if (tx < 0 || tx >= layer.width) continue
          sample((x + 0.5) * scaleX - 0.5, (y + 0.5) * scaleY - 0.5, texel)
          const alpha = Math.round(texel[3])
          if (!alpha) continue
          const target = (ty * layer.width + tx) * 4
          const a = alpha / 255
          for (let channel = 0; channel < 3; channel += 1) {
            rgba[target + channel] = Math.round(texel[channel] * a + rgba[target + channel] * (1 - a))
          }
          const index = ty * layer.width + tx
          coverage[index] = Math.max(coverage[index], alpha)
        }
      }
    }
  }
  return coverage
}

// The world map's torn-parchment frame and corner pieces fade out, so the
// map melts into the page behind it instead of ending in a ragged edge.
export function frameFade(width, height, { inset = 22, feather = 36, corner = 64 } = {}) {
  const alpha = new Uint8Array(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const cx = Math.min(x, width - 1 - x)
      const cy = Math.min(y, height - 1 - y)
      // Distance inside a rectangle with rounded corners.
      const edge = cx < corner && cy < corner ? corner - Math.hypot(corner - cx, corner - cy) : Math.min(cx, cy)
      const t = Math.min(1, Math.max(0, (edge - inset) / feather))
      alpha[y * width + x] = Math.round(t * t * (3 - 2 * t) * 255)
    }
  }
  return alpha
}

async function buildMap(job) {
  const rgba = await stitch(job.tiles, job.layer)
  if (job.uiMapId === AZEROTH_MAP_ID) {
    const alpha = frameFade(job.layer.width, job.layer.height)
    for (let i = 0; i < alpha.length; i += 1) rgba[i * 4 + 3] = Math.min(rgba[i * 4 + 3], alpha[i])
  }
  if (job.zone) {
    // A zone shows its own land only, fully explored, so zones sit side by
    // side on the world map with no frames, labels or fog from their maps.
    const coverage = await paintOverlays(rgba, job.layer, job.overlays)
    const alpha = landMask(coverage, job.layer.width, job.layer.height)
    for (let i = 0; i < alpha.length; i += 1) rgba[i * 4 + 3] = alpha[i]
  }
  const file = path.join(OUT, `${job.uiMapId}.webp`)
  writeWebp(file, job.layer.width, job.layer.height, rgba)
  return statSync(file).size
}

async function main() {
  try {
    execFileSync('cwebp', ['-version'], { stdio: 'ignore' })
  } catch {
    throw new Error('cwebp is not installed. Install libwebp (macOS: brew install webp; Debian: apt install webp).')
  }
  mkdirSync(OUT, { recursive: true })
  mkdirSync(CACHE, { recursive: true })

  // The world map, and every zone the atlas draws. Cities are left to the
  // zones around them, which draw them too.
  const atlas = getAtlas()
  const zones = atlas.zones.filter((zone) => !zone.city).map((zone) => zone.mapId)
  const only = args.only ? new Set(String(args.only).split(',').map(Number)) : null
  const wanted = [AZEROTH_MAP_ID, ...zones].filter((uiMapId) => !only || only.has(uiMapId))
  const [links, arts, tileRows, layers, overlayRows, overlayTiles] = await Promise.all([
    table('UiMapXMapArt'), table('UiMapArt'), table('UiMapArtTile'), table('UiMapArtStyleLayer'),
    table('WorldMapOverlay'), table('WorldMapOverlayTile'),
  ])

  const jobs = []
  for (const uiMapId of wanted) {
    const link = links.find((row) => Number(row.UiMapID) === uiMapId && Number(row.PhaseID) === 0) || links.find((row) => Number(row.UiMapID) === uiMapId)
    if (!link) {
      console.warn(`No art for map ${uiMapId}`)
      continue
    }
    const art = arts.find((row) => row.ID === link.UiMapArtID)
    const style = layers.find((row) => row.UiMapArtStyleID === art?.UiMapArtStyleID && Number(row.LayerIndex) === 0)
    const tiles = tileRows
      .filter((row) => row.UiMapArtID === link.UiMapArtID && Number(row.LayerIndex) === 0)
      .map((row) => ({ row: Number(row.RowIndex), col: Number(row.ColIndex), fileDataId: Number(row.FileDataID) }))
    if (!style || !tiles.length) {
      console.warn(`Map ${uiMapId} has no tiles`)
      continue
    }
    const layer = {
      width: Number(style.LayerWidth),
      height: Number(style.LayerHeight),
      tileWidth: Number(style.TileWidth),
      tileHeight: Number(style.TileHeight),
    }
    const zone = uiMapId !== AZEROTH_MAP_ID
    const overlays = zone
      ? overlayRows.filter((row) => row.UiMapArtID === link.UiMapArtID).map((row) => ({
        x: Number(row.OffsetX),
        y: Number(row.OffsetY),
        width: Number(row.TextureWidth),
        height: Number(row.TextureHeight),
        tiles: overlayTiles
          .filter((entry) => entry.WorldMapOverlayID === row.ID && Number(entry.LayerIndex) === 0)
          .map((entry) => ({ row: Number(entry.RowIndex), col: Number(entry.ColIndex), fileDataId: Number(entry.FileDataID) })),
      }))
      : []
    if (zone && !overlays.length) console.warn(`Map ${uiMapId} has no explored areas; it is drawn whole`)
    jobs.push({ uiMapId, tiles, layer, zone: zone && overlays.length > 0, overlays })
  }

  // Download every tile first, a few at a time, then stitch.
  const all = [...new Set(jobs.flatMap((job) => [
    ...job.tiles.map((entry) => entry.fileDataId),
    ...job.overlays.flatMap((overlay) => overlay.tiles.map((entry) => entry.fileDataId)),
  ]))]
  let done = 0
  const queue = [...all]
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const id = queue.shift()
      await tile(id)
      done += 1
      if (done % 50 === 0 || done === all.length) console.log(`tiles ${done}/${all.length}`)
    }
  }))

  let bytes = 0
  for (const job of jobs) {
    const size = await buildMap(job)
    bytes += size
    console.log(`${job.uiMapId}.webp  ${(size / 1024).toFixed(0)} KB${job.zone ? `  ${job.overlays.length} explored areas` : ''}`)
  }
  console.log(`${jobs.length} maps, ${(bytes / 1024 / 1024).toFixed(1)} MB in ${path.relative(process.cwd(), OUT) || OUT}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
