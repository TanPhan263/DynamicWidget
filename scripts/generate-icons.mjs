// Generates the app icon source (1024px) and the tray icons as PNG files
// without third-party dependencies. Run `npm run icons` to regenerate the
// platform icon set from the source image via `tauri icon`.
import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const iconsDir = resolve(root, "src-tauri/icons");
mkdirSync(iconsDir, { recursive: true });

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Rounded rectangle test in unit coordinates.
function inRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const qx = Math.max(x0 + r - x, 0, x - (x1 - r));
  const qy = Math.max(y0 + r - y, 0, y - (y1 - r));
  return qx * qx + qy * qy <= r * r;
}

// The island: a pill centered horizontally.
function inPill(x, y, x0, y0, x1, y1) {
  return inRoundRect(x, y, x0, y0, x1, y1, (y1 - y0) / 2);
}

function render(size, paint, samples = 4) {
  const rgba = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const x = (px + (sx + 0.5) / samples) / size;
          const y = (py + (sy + 0.5) / samples) / size;
          const c = paint(x, y);
          if (c) { r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3]; }
        }
      }
      const n = samples * samples;
      const i = (py * size + px) * 4;
      if (a > 0) {
        rgba[i] = Math.round(r / a);
        rgba[i + 1] = Math.round(g / a);
        rgba[i + 2] = Math.round(b / a);
      }
      rgba[i + 3] = Math.round((a / n) * 255);
    }
  }
  return rgba;
}

// App icon: slate rounded square, a black island with a live-activity dot,
// and two widget cards below it.
function appIcon(x, y) {
  if (!inRoundRect(x, y, 0.04, 0.04, 0.96, 0.96, 0.2)) return null;
  if (inPill(x, y, 0.2, 0.26, 0.8, 0.44)) {
    if ((x - 0.3) ** 2 + (y - 0.35) ** 2 <= 0.042 ** 2) return [45, 212, 191, 1];
    if (inPill(x, y, 0.47, 0.335, 0.7, 0.365)) return [235, 238, 243, 1];
    return [0, 0, 0, 1];
  }
  if (inRoundRect(x, y, 0.2, 0.52, 0.48, 0.76, 0.06)) return [52, 62, 84, 1];
  if (inRoundRect(x, y, 0.52, 0.52, 0.8, 0.76, 0.06)) return [52, 62, 84, 1];
  return [27, 33, 48, 1];
}

// Tray icons are macOS template images: black + alpha only.
function tray(x, y) {
  if (!inPill(x, y, 0.06, 0.3, 0.94, 0.7)) return null;
  // Live-activity dot cut out of the filled pill.
  if ((x - 0.26) ** 2 + (y - 0.5) ** 2 <= 0.09 ** 2) return null;
  return [0, 0, 0, 1];
}

// Do Not Disturb: outline only.
function trayDnd(x, y) {
  if (!inPill(x, y, 0.06, 0.3, 0.94, 0.7)) return null;
  if (inPill(x, y, 0.14, 0.38, 0.86, 0.62)) return null;
  return [0, 0, 0, 1];
}

writeFileSync(resolve(iconsDir, "source.png"), encodePng(1024, render(1024, appIcon, 2)));
writeFileSync(resolve(iconsDir, "tray.png"), encodePng(44, render(44, tray, 8)));
writeFileSync(resolve(iconsDir, "tray-dnd.png"), encodePng(44, render(44, trayDnd, 8)));
console.log("Icons written to", iconsDir);
