// Генерирует простые PWA-иконки (PNG) без внешних зависимостей.
// Глиф: скруглённый бирюзовый квадрат с коралловой точкой на тёмном фоне.
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const BG = [14, 19, 32]; // #0e1320
const TEAL = [0, 184, 169]; // #00b8a9
const CORAL = [255, 107, 107]; // #ff6b6b

function rounded(x, y, x0, y0, w, h, r) {
  if (x < x0 || y < y0 || x >= x0 + w || y >= y0 + h) return false;
  const dx = Math.min(x - x0, x0 + w - 1 - x);
  const dy = Math.min(y - y0, y0 + h - 1 - y);
  if (dx < r && dy < r) return (r - dx) ** 2 + (r - dy) ** 2 <= r * r;
  return true;
}

function makePng(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const pad = Math.round(size * 0.18);
  const w = size - pad * 2;
  const r = Math.round(size * 0.12);
  const dotR = Math.round(size * 0.09);
  const dotX = pad + w - dotR - Math.round(size * 0.04);
  const dotY = pad + dotR + Math.round(size * 0.04);

  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter byte
    for (let x = 0; x < size; x++) {
      let c = BG;
      if (rounded(x, y, pad, pad, w, w, r)) c = TEAL;
      if ((x - dotX) ** 2 + (y - dotY) ** 2 <= dotR * dotR) c = CORAL;
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = c[0];
      raw[o + 1] = c[1];
      raw[o + 2] = c[2];
      raw[o + 3] = 255;
    }
  }

  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return png;
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
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

for (const size of [192, 512]) {
  writeFileSync(new URL(`../public/icon-${size}.png`, import.meta.url), makePng(size));
  console.log(`wrote public/icon-${size}.png`);
}
