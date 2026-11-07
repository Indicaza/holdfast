#!/usr/bin/env node
// Builds the resource map's art: the game's own Azeroth, continent and zone
// maps (Classic Era), one WebP per uiMapID, cropped to the 1002 × 668 the
// game draws them at.
//
// The art is Blizzard's. It comes from the game client's files through
// wago.tools, a public mirror of them: the UiMap* tables say which 256px
// tiles make up each map, and each tile is a BLP texture. This script
// decodes the tiles (BLP2: DXT1/3/5, palettised or raw BGRA), stitches them
// and encodes WebP with cwebp (libwebp: `brew install webp`).
//
//   node scripts/fetchMapArt.mjs [--out public/wow-art/maps] [--cache DIR]
//                                [--branch wow_classic_era] [--quality 82]
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

async function buildMap(uiMapId, tiles, layer) {
  const canvasWidth = Math.ceil(layer.width / layer.tileWidth) * layer.tileWidth
  const canvas = Buffer.alloc(canvasWidth * Math.ceil(layer.height / layer.tileHeight) * layer.tileHeight * 4)
  for (const entry of tiles) {
    const { width, height, rgba } = decodeBlp(await tile(entry.fileDataId))
    for (let y = 0; y < height; y += 1) {
      const target = ((entry.row * layer.tileHeight + y) * canvasWidth + entry.col * layer.tileWidth) * 4
      rgba.copy(canvas, target, y * width * 4, (y + 1) * width * 4)
    }
  }
  // Crop to the map's drawn size.
  const cropped = Buffer.alloc(layer.width * layer.height * 4)
  for (let y = 0; y < layer.height; y += 1) {
    canvas.copy(cropped, y * layer.width * 4, y * canvasWidth * 4, y * canvasWidth * 4 + layer.width * 4)
  }
  const file = path.join(OUT, `${uiMapId}.webp`)
  writeWebp(file, layer.width, layer.height, cropped)
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

  const atlas = getAtlas()
  const wanted = [AZEROTH_MAP_ID, ...atlas.continents.map((continent) => continent.mapId), ...atlas.zones.map((zone) => zone.mapId)]
  const [links, arts, tileRows, layers] = await Promise.all([table('UiMapXMapArt'), table('UiMapArt'), table('UiMapArtTile'), table('UiMapArtStyleLayer')])

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
    jobs.push({ uiMapId, tiles, layer })
  }

  // Download every tile first, a few at a time, then stitch.
  const all = [...new Set(jobs.flatMap((job) => job.tiles.map((entry) => entry.fileDataId)))]
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
    const size = await buildMap(job.uiMapId, job.tiles, job.layer)
    bytes += size
    console.log(`${job.uiMapId}.webp  ${(size / 1024).toFixed(0)} KB`)
  }
  console.log(`${jobs.length} maps, ${(bytes / 1024 / 1024).toFixed(1)} MB in ${path.relative(process.cwd(), OUT) || OUT}`)
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
