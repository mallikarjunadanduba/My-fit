// Generates PNG app icons (home-screen / PWA) from the same shapes as public/icon.svg. No dependencies.
import fs from 'node:fs';
import zlib from 'node:zlib';

const NAVY = [0x15, 0x22, 0x38], TEAL = [0x00, 0xaf, 0xb5];
// Dumbbell rectangles on a 64×64 grid: [x, y, w, h]
const RECTS = [[14, 26, 6, 12], [44, 26, 6, 12], [20, 22, 5, 20], [39, 22, 5, 20], [25, 30, 14, 4]];

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

function png(size, padding) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  const inner = size * (1 - 2 * padding), off = size * padding, s = inner / 64;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const gx = (x + 0.5 - off) / s, gy = (y + 0.5 - off) / s;
      const teal = RECTS.some(([rx, ry, rw, rh]) => gx >= rx && gx < rx + rw && gy >= ry && gy < ry + rh);
      raw.set(teal ? TEAL : NAVY, y * (size * 3 + 1) + 1 + x * 3);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

for (const size of [192, 512]) fs.writeFileSync(`public/icon-${size}.png`, png(size, 0.1));
fs.writeFileSync('public/icon-maskable-512.png', png(512, 0.2));
console.log('icons written');
