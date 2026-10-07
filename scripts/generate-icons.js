import fs from 'fs';
import zlib from 'zlib';

function distToSegment(px, py, x1, y1, x2, y2) {
  const l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
  if (l2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
}

function insideRoundedRect(px, py, rx1, ry1, rx2, ry2, radius) {
  if (px < rx1 || px > rx2 || py < ry1 || py > ry2) return false;
  const innerX1 = rx1 + radius;
  const innerX2 = rx2 - radius;
  const innerY1 = ry1 + radius;
  const innerY2 = ry2 - radius;
  if (px >= innerX1 && px <= innerX2) return true;
  if (py >= innerY1 && py <= innerY2) return true;
  const cornerX = px < innerX1 ? innerX1 : innerX2;
  const cornerY = py < innerY1 ? innerY1 : innerY2;
  return Math.hypot(px - cornerX, py - cornerY) <= radius;
}

function distToArc(px, py, cx, cy, radius, minAngle, maxAngle) {
  const angle = Math.atan2(py - cy, px - cx);
  const normalized = (angle + 2 * Math.PI) % (2 * Math.PI);
  const minNorm = (minAngle + 2 * Math.PI) % (2 * Math.PI);
  const maxNorm = (maxAngle + 2 * Math.PI) % (2 * Math.PI);

  let within = false;
  if (minNorm <= maxNorm) {
    within = normalized >= minNorm && normalized <= maxNorm;
  } else {
    within = normalized >= minNorm || normalized <= maxNorm;
  }

  if (within) {
    return Math.abs(Math.hypot(px - cx, py - cy) - radius);
  }

  const p1x = cx + radius * Math.cos(minAngle);
  const p1y = cy + radius * Math.sin(minAngle);
  const p2x = cx + radius * Math.cos(maxAngle);
  const p2y = cy + radius * Math.sin(maxAngle);
  return Math.min(Math.hypot(px - p1x, py - p1y), Math.hypot(px - p2x, py - p2y));
}

// Pre-compute polyline for amber shield outline
const shieldPoints = [];
const steps = 32;
// Top-right curve: (0.50, 0.410) to (0.633, 0.469)
for (let i = 0; i <= 8; i++) {
  const t = i / 8;
  const x = 0.50 + 0.133 * t;
  const y = 0.410 + 0.059 * Math.sin(t * Math.PI * 0.5);
  shieldPoints.push([x, y]);
}
// Vertical right: (0.633, 0.469) to (0.633, 0.578)
shieldPoints.push([0.633, 0.578]);
// Bottom-right curve: (0.633, 0.578) to (0.50, 0.766)
for (let i = 1; i <= 10; i++) {
  const t = i / 10;
  const x = 0.633 - 0.133 * Math.sin(t * Math.PI * 0.5);
  const y = 0.578 + 0.188 * (t ** 1.3);
  shieldPoints.push([x, y]);
}
// Bottom-left curve: (0.50, 0.766) to (0.367, 0.578)
for (let i = 1; i <= 10; i++) {
  const t = i / 10;
  const x = 0.50 - 0.133 * (1 - Math.cos(t * Math.PI * 0.5));
  const y = 0.766 - 0.188 * (1 - ((1 - t) ** 1.3));
  shieldPoints.push([x, y]);
}
// Vertical left: (0.367, 0.578) to (0.367, 0.469)
shieldPoints.push([0.367, 0.469]);
// Top-left curve: (0.367, 0.469) to (0.50, 0.410)
for (let i = 1; i <= 8; i++) {
  const t = i / 8;
  const x = 0.367 + 0.133 * t;
  const y = 0.469 - 0.059 * Math.sin(t * Math.PI * 0.5);
  shieldPoints.push([x, y]);
}

function createPNG(width, height, isMaskable = false) {
  const rowSize = width * 4 + 1; // 1 filter byte + RGBA
  const rawData = Buffer.alloc(rowSize * height);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    rawData[rowOffset] = 0;
    const ny = y / height;

    for (let x = 0; x < width; x++) {
      const nx = x / width;
      const pxOffset = rowOffset + 1 + x * 4;

      // Dark navy background #0D1522
      let pr = 13;
      let pg = 21;
      let pb = 34;
      let pa = 255;

      if (!isMaskable) {
        if (!insideRoundedRect(nx, ny, 0, 0, 1, 1, 0.22)) {
          pa = 0;
          pr = 0;
          pg = 0;
          pb = 0;
        }
      }

      if (pa > 0) {
        // --- 1. Clipboard Board Outline (White) ---
        let minD = 999;
        minD = Math.min(minD, distToSegment(nx, ny, 0.367, 0.258, 0.312, 0.258));
        minD = Math.min(minD, distToSegment(nx, ny, 0.633, 0.258, 0.688, 0.258));
        minD = Math.min(minD, distToSegment(nx, ny, 0.226, 0.344, 0.226, 0.789));
        minD = Math.min(minD, distToSegment(nx, ny, 0.774, 0.344, 0.774, 0.789));
        minD = Math.min(minD, distToSegment(nx, ny, 0.312, 0.875, 0.688, 0.875));
        minD = Math.min(minD, distToArc(nx, ny, 0.312, 0.344, 0.086, Math.PI, 1.5 * Math.PI));
        minD = Math.min(minD, distToArc(nx, ny, 0.688, 0.344, 0.086, 1.5 * Math.PI, 2 * Math.PI));
        minD = Math.min(minD, distToArc(nx, ny, 0.688, 0.789, 0.086, 0, 0.5 * Math.PI));
        minD = Math.min(minD, distToArc(nx, ny, 0.312, 0.789, 0.086, 0.5 * Math.PI, Math.PI));

        if (minD <= 0.024) {
          pr = 255;
          pg = 255;
          pb = 255; // White board outline
        }

        // --- 2. Top Dome Knob ---
        const dDome = distToArc(nx, ny, 0.50, 0.20, 0.05, Math.PI, 2 * Math.PI);
        if (dDome <= 0.022 && ny <= 0.20) {
          pr = 255;
          pg = 255;
          pb = 255;
        }

        // --- 3. Top Clip Clamp Body ---
        const clipOuter = insideRoundedRect(nx, ny, 0.373, 0.191, 0.627, 0.316, 0.039);
        const clipInner = insideRoundedRect(nx, ny, 0.416, 0.234, 0.584, 0.273, 0.015);

        if (clipOuter) {
          if (clipInner) {
            pr = 13;
            pg = 21;
            pb = 34;
          } else {
            pr = 255;
            pg = 255;
            pb = 255;
          }
        }

        // --- 4. Amber/Gold Shield Outline (#F59E0B) ---
        let minShieldD = 999;
        for (let i = 0; i < shieldPoints.length - 1; i++) {
          const d = distToSegment(
            nx,
            ny,
            shieldPoints[i][0],
            shieldPoints[i][1],
            shieldPoints[i + 1][0],
            shieldPoints[i + 1][1]
          );
          if (d < minShieldD) minShieldD = d;
        }

        if (minShieldD <= 0.0195) {
          pr = 245;
          pg = 158;
          pb = 11; // Amber #F59E0B
        }

        // --- 5. Amber/Gold Checkmark Inside Shield (#F59E0B) ---
        const dCheck1 = distToSegment(nx, ny, 0.445, 0.586, 0.484, 0.625);
        const dCheck2 = distToSegment(nx, ny, 0.484, 0.625, 0.559, 0.535);

        if (dCheck1 <= 0.0195 || dCheck2 <= 0.0195) {
          pr = 245;
          pg = 158;
          pb = 11; // Amber #F59E0B
        }
      }

      rawData[pxOffset] = pr;
      rawData[pxOffset + 1] = pg;
      rawData[pxOffset + 2] = pb;
      rawData[pxOffset + 3] = pa;
    }
  }

  const deflated = zlib.deflateSync(rawData);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  function makeChunk(type, data) {
    const typeBuf = Buffer.from(type, 'ascii');
    const len = data.length;
    const buf = Buffer.alloc(8 + len + 4);
    buf.writeUInt32BE(len, 0);
    typeBuf.copy(buf, 4);
    data.copy(buf, 8);

    const crc = crc32(Buffer.concat([typeBuf, data]));
    buf.writeUInt32BE(crc, 8 + len);
    return buf;
  }

  const crcTable = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      if (c & 1) c = 0xedb88320 ^ (c >>> 1);
      else c = c >>> 1;
    }
    crcTable[n] = c;
  }

  function crc32(buf) {
    let crc = -1;
    for (let i = 0; i < buf.length; i++) {
      crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ -1) >>> 0;
  }

  const ihdrChunk = makeChunk('IHDR', ihdr);
  const idatChunk = makeChunk('IDAT', deflated);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

const icon192 = createPNG(192, 192, false);
fs.writeFileSync('public/icon-192.png', icon192);
fs.writeFileSync('public/apple-touch-icon.png', icon192);

const maskable192 = createPNG(192, 192, true);
fs.writeFileSync('public/icon-maskable-192.png', maskable192);

const icon512 = createPNG(512, 512, false);
fs.writeFileSync('public/icon-512.png', icon512);

const maskable512 = createPNG(512, 512, true);
fs.writeFileSync('public/icon-maskable-512.png', maskable512);

console.log('Clipboard with Amber Shield icons generated successfully!');
