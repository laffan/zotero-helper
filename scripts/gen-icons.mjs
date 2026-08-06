#!/usr/bin/env node
// Generates the app icon set (PNG / ICO / ICNS) with zero dependencies.
// Design: dark-red rounded square, white "Z", white badge with a red
// download arrow. Re-run with `node scripts/gen-icons.mjs`.
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "..", "src-tauri", "icons");
fs.mkdirSync(outDir, { recursive: true });

// ---------------------------------------------------------------- geometry
const Z_POLY = [
  [0.26, 0.24], [0.74, 0.24], [0.74, 0.345], [0.445, 0.615],
  [0.74, 0.615], [0.74, 0.72], [0.26, 0.72], [0.26, 0.595],
  [0.555, 0.345], [0.26, 0.345],
];
const ARROW_TRI = [[0.685, 0.795], [0.835, 0.795], [0.76, 0.885]];

function inPoly(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}
const inRoundedRect = (x, y, x0, y0, x1, y1, r) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.max(x0 + r, Math.min(x, x1 - r));
  const cy = Math.max(y0 + r, Math.min(y, y1 - r));
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r || (x >= x0 + r && x <= x1 - r) || (y >= y0 + r && y <= y1 - r);
};
const inCircle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
const inRect = (x, y, x0, y0, x1, y1) => x >= x0 && x <= x1 && y >= y0 && y <= y1;

// Returns [r,g,b,a] for a unit-square point, or null for transparent.
function shade(x, y) {
  if (!inRoundedRect(x, y, 0.03, 0.03, 0.97, 0.97, 0.22)) return null;
  // background gradient
  const t = y;
  let c = [
    Math.round(0xb4 + (0x77 - 0xb4) * t),
    Math.round(0x30 + (0x16 - 0x30) * t),
    Math.round(0x26 + (0x10 - 0x26) * t),
    255,
  ];
  if (inPoly(x, y, Z_POLY)) c = [255, 255, 255, 255];
  if (inCircle(x, y, 0.76, 0.79, 0.155)) {
    c = [255, 250, 244, 255];
    const arrow =
      inRect(x, y, 0.737, 0.685, 0.783, 0.80) || inPoly(x, y, ARROW_TRI);
    if (arrow) c = [0xa8, 0x2c, 0x22, 255];
  }
  return c;
}

function render(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const SS = 3; // 3x3 subsamples for antialiasing
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) / size;
          const y = (py + (sy + 0.5) / SS) / size;
          const c = shade(x, y);
          if (c) {
            r += c[0]; g += c[1]; b += c[2]; a += c[3];
          }
        }
      }
      const n = SS * SS;
      const i = (py * size + px) * 4;
      const alpha = a / n;
      // premultiplied average → straight alpha
      rgba[i] = alpha ? Math.round(r / n) : 0;
      rgba[i + 1] = alpha ? Math.round(g / n) : 0;
      rgba[i + 2] = alpha ? Math.round(b / n) : 0;
      rgba[i + 3] = Math.round(alpha);
    }
  }
  return rgba;
}

// ---------------------------------------------------------------- PNG
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}
function encodePNG(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- ICO / ICNS
function encodeICO(pngsBySize) {
  const entries = Object.entries(pngsBySize).map(([s, png]) => ({ s: +s, png }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  let offset = 6 + entries.length * 16;
  const dirs = [];
  const blobs = [];
  for (const { s, png } of entries) {
    const d = Buffer.alloc(16);
    d[0] = s >= 256 ? 0 : s;
    d[1] = s >= 256 ? 0 : s;
    d.writeUInt16LE(1, 4); // planes
    d.writeUInt16LE(32, 6); // bpp
    d.writeUInt32LE(png.length, 8);
    d.writeUInt32LE(offset, 12);
    offset += png.length;
    dirs.push(d);
    blobs.push(png);
  }
  return Buffer.concat([header, ...dirs, ...blobs]);
}
function encodeICNS(pngsByType) {
  const chunks = [];
  for (const [type, png] of Object.entries(pngsByType)) {
    const head = Buffer.alloc(8);
    head.write(type, 0, "ascii");
    head.writeUInt32BE(png.length + 8, 4);
    chunks.push(head, png);
  }
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(8);
  head.write("icns", 0, "ascii");
  head.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([head, body]);
}

// ---------------------------------------------------------------- output
const png = {};
for (const s of [16, 32, 48, 128, 256, 512, 1024]) {
  png[s] = encodePNG(s, render(s));
}
const write = (name, buf) => {
  fs.writeFileSync(path.join(outDir, name), buf);
  console.log(`wrote ${name} (${(buf.length / 1024).toFixed(1)} KB)`);
};
write("32x32.png", png[32]);
write("128x128.png", png[128]);
write("128x128@2x.png", png[256]);
write("icon.png", png[512]);
write("icon.ico", encodeICO({ 16: png[16], 32: png[32], 48: png[48], 256: png[256] }));
write(
  "icon.icns",
  encodeICNS({ ic07: png[128], ic08: png[256], ic09: png[512], ic10: png[1024] }),
);
console.log("done");
