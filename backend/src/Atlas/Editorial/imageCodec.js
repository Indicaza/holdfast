// Just enough image handling for the media library, with no new dependency
// (sharp is not one of Holdfast's): sniff the type, read the dimensions of
// PNG, JPEG and WebP; decode and encode 8-bit PNG (node:zlib) to make
// thumbnails and web variants; write uncompressed 32-bit TGA, the texture
// format the WoW client loads from an add-on folder.
//
// JPEG and WebP are stored and served as uploaded: decoding them needs a real
// codec. Their "variants" are the original, scaled by the browser.

import { deflateSync, inflateSync } from "node:zlib";

export const IMAGE_TYPES = Object.freeze({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" });

export function sniffImageType(buffer) {
  if (buffer.length >= 8 && buffer.readUInt32BE(0) === 0x89504e47 && buffer.readUInt32BE(4) === 0x0d0a1a0a) return "image/png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

function jpegSize(buffer) {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) return null;
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    // SOF0–SOF15, except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
    }
    offset += 2 + length;
  }
  return null;
}

function webpSize(buffer) {
  const chunk = buffer.toString("ascii", 12, 16);
  if (chunk === "VP8 " && buffer.length >= 30) return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
  if (chunk === "VP8L" && buffer.length >= 25) {
    const bits = buffer.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X" && buffer.length >= 30) return { width: buffer.readUIntLE(24, 3) + 1, height: buffer.readUIntLE(27, 3) + 1 };
  return null;
}

// { mime, width, height } or null when the bytes are not a supported image.
export function imageInfo(buffer) {
  const mime = sniffImageType(buffer);
  if (!mime) return null;
  const size = mime === "image/png" ? (buffer.length >= 24 ? { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) } : null)
    : mime === "image/jpeg" ? jpegSize(buffer) : webpSize(buffer);
  return size && size.width > 0 && size.height > 0 ? { mime, ...size } : null;
}

// ------------------------------------------------------------------ PNG

function chunks(buffer) {
  const list = [];
  let offset = 8;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    list.push({ type: buffer.toString("ascii", offset + 4, offset + 8), data: buffer.subarray(offset + 8, offset + 8 + length) });
    offset += 12 + length;
  }
  return list;
}

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

// RGBA pixels of an 8-bit, non-interlaced PNG; null for anything else
// (16-bit, low bit depths, interlaced), which then keeps no variants.
export function decodePng(buffer) {
  const list = chunks(buffer);
  const header = list.find((chunk) => chunk.type === "IHDR")?.data;
  if (!header) return null;
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const depth = header[8];
  const colorType = header[9];
  if (depth !== 8 || header[12] !== 0 || !CHANNELS[colorType] || width * height > 4096 * 4096) return null;
  const palette = list.find((chunk) => chunk.type === "PLTE")?.data;
  const transparency = list.find((chunk) => chunk.type === "tRNS")?.data;
  const raw = inflateSync(Buffer.concat(list.filter((chunk) => chunk.type === "IDAT").map((chunk) => chunk.data)));
  const channels = CHANNELS[colorType];
  const stride = width * channels;
  const pixels = Buffer.alloc(width * height * 4);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? line[x - channels] : 0;
      const up = previous[x];
      const upLeft = x >= channels ? previous[x - channels] : 0;
      let add = 0;
      if (filter === 1) add = left;
      else if (filter === 2) add = up;
      else if (filter === 3) add = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        add = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      line[x] = (line[x] + add) & 0xff;
    }
    for (let x = 0; x < width; x += 1) {
      const out = (y * width + x) * 4;
      const at = x * channels;
      if (colorType === 6) line.copy(pixels, out, at, at + 4);
      else if (colorType === 2) {
        pixels[out] = line[at]; pixels[out + 1] = line[at + 1]; pixels[out + 2] = line[at + 2]; pixels[out + 3] = 255;
      } else if (colorType === 0 || colorType === 4) {
        pixels[out] = pixels[out + 1] = pixels[out + 2] = line[at];
        pixels[out + 3] = colorType === 4 ? line[at + 1] : 255;
      } else {
        const index = line[at];
        if (!palette || index * 3 + 2 >= palette.length) return null;
        pixels[out] = palette[index * 3]; pixels[out + 1] = palette[index * 3 + 1]; pixels[out + 2] = palette[index * 3 + 2];
        pixels[out + 3] = transparency && index < transparency.length ? transparency[index] : 255;
      }
    }
    previous = line;
  }
  return { width, height, pixels };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

export function encodePng({ width, height, pixels }) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

// Box-filtered resize (area average when shrinking, nearest when growing).
export function resize(image, width, height) {
  const out = Buffer.alloc(width * height * 4);
  const sx = image.width / width;
  const sy = image.height / height;
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      const sum = [0, 0, 0, 0];
      let count = 0;
      for (let yy = y0; yy < Math.min(y1, image.height); yy += 1) {
        for (let xx = x0; xx < Math.min(x1, image.width); xx += 1) {
          const at = (yy * image.width + xx) * 4;
          for (let c = 0; c < 4; c += 1) sum[c] += image.pixels[at + c];
          count += 1;
        }
      }
      for (let c = 0; c < 4; c += 1) out[(y * width + x) * 4 + c] = Math.round(sum[c] / Math.max(1, count));
    }
  }
  return { width, height, pixels: out };
}

// Crops to `aspect` (width / height) around a focal point (0–1 fractions).
export function cropToAspect(image, aspect, focusX = 0.5, focusY = 0.5) {
  let width = image.width;
  let height = Math.round(width / aspect);
  if (height > image.height) {
    height = image.height;
    width = Math.round(height * aspect);
  }
  const left = Math.min(image.width - width, Math.max(0, Math.round(focusX * image.width - width / 2)));
  const top = Math.min(image.height - height, Math.max(0, Math.round(focusY * image.height - height / 2)));
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) image.pixels.copy(pixels, y * width * 4, ((top + y) * image.width + left) * 4, ((top + y) * image.width + left + width) * 4);
  return { width, height, pixels };
}

export function fitWithin(image, max) {
  const scale = Math.min(1, max / Math.max(image.width, image.height));
  return scale === 1 ? image : resize(image, Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)));
}

// Uncompressed 32-bit TGA (BGRA, origin bottom left, 8 alpha bits).
export function encodeTga({ width, height, pixels }) {
  const header = Buffer.alloc(18);
  header[2] = 2;
  header.writeUInt16LE(width, 12);
  header.writeUInt16LE(height, 14);
  header[16] = 32;
  header[17] = 8;
  const body = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const from = ((height - 1 - y) * width + x) * 4;
      const to = (y * width + x) * 4;
      body[to] = pixels[from + 2];
      body[to + 1] = pixels[from + 1];
      body[to + 2] = pixels[from];
      body[to + 3] = pixels[from + 3];
    }
  }
  return Buffer.concat([header, body]);
}
