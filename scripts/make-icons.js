// Генерує PNG-іконки Деберца (без зовнішніх залежностей): node scripts/make-icons.js
// Малює той самий знак, що й вкладка «Рахунок»: три золоті риски, діагональ і кільце.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const OUT = path.join(__dirname, "..");
const SIZES = [
  { name: "apple-touch-icon.png", size: 180 },
  { name: "icon-192.png", size: 192 },
  { name: "icon-512.png", size: 512 },
  { name: "icon-32.png", size: 32 }
];

const BG_TOP = [0x14, 0x3a, 0x2c];
const BG_BOTTOM = [0x07, 0x1a, 0x14];
const GOLD_TOP = [0xff, 0xe7, 0xa3];
const GOLD_BOTTOM = [0xd9, 0xa4, 0x41];

// Відрізки і кільце в координатах 100x100 (як у вихідному знаку).
const LINES = [
  { a: [28, 72], b: [28, 30], w: 7 },
  { a: [42, 72], b: [42, 30], w: 7 },
  { a: [56, 72], b: [56, 30], w: 7 },
  { a: [20, 28], b: [64, 74], w: 7 }
];
const RING = { cx: 78, cy: 50, r: 13, w: 6 };

function distSeg(px, py, a, b) {
  const vx = b[0] - a[0], vy = b[1] - a[1];
  const wx = px - a[0], wy = py - a[1];
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / (vx * vx + vy * vy)));
  const dx = px - (a[0] + t * vx), dy = py - (a[1] + t * vy);
  return Math.sqrt(dx * dx + dy * dy);
}
function inGlyph(x, y) {
  for (const l of LINES) if (distSeg(x, y, l.a, l.b) <= l.w / 2) return true;
  const d = Math.hypot(x - RING.cx, y - RING.cy);
  return Math.abs(d - RING.r) <= RING.w / 2;
}
const lerp = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

function render(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const SS = 4; // суперсемплінг для згладжування
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // фільтр «None»
    for (let x = 0; x < size; x++) {
      const t = y / (size - 1);
      const bg = lerp(BG_TOP, BG_BOTTOM, t);
      const gold = lerp(GOLD_TOP, GOLD_BOTTOM, t);
      let hit = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const px = ((x + (sx + 0.5) / SS) / size) * 100;
        const py = ((y + (sy + 0.5) / SS) / size) * 100;
        if (inGlyph(px, py)) hit++;
      }
      const a = hit / (SS * SS);
      const c = bg.map((v, i) => Math.round(v * (1 - a) + gold[i] * a));
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2]; raw[o + 3] = 255;
    }
  }
  return raw;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(render(size), { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

for (const { name, size } of SIZES) {
  fs.writeFileSync(path.join(OUT, name), png(size));
  console.log("wrote", name, size + "px");
}
