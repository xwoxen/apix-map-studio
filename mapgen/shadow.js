// Client terrain shadow maps (GameLib CTerrain::LoadShadowMap): shadowmap.raw is 256×256 R5G5B5 words
// (0x7FFF lit, about 0x4210 in shadow) and shadowmap.dds a 256×256 DXT1 texture of the same gray levels.
// Levels are 5-bit grays per 1 m texel, 31 = lit.

const LIT = 31, SHADOW = 16;

function litLevels() { return new Uint8Array(256 * 256).fill(LIT); }

// 0..1 light amount (1 = full sun) -> 5-bit level between the shipped shadow gray and white
function levelsFromLight(light) {
  const out = new Uint8Array(256 * 256);
  for (let i = 0; i < out.length; i++) out[i] = Math.round(SHADOW + (LIT - SHADOW) * Math.max(0, Math.min(1, light[i])));
  return out;
}

function shadowRaw(levels) {
  const b = Buffer.alloc(256 * 256 * 2);
  for (let i = 0; i < levels.length; i++) { const l = levels[i]; b.writeUInt16LE((l << 10) | (l << 5) | l, i * 2); }
  return b;
}

function shadowDds(levels) {
  const h = Buffer.alloc(128);
  h.write("DDS ", 0, "latin1");
  // header fields as in the shipped Sands shadow maps
  h.writeUInt32LE(124, 4); h.writeUInt32LE(0x80000, 8); h.writeUInt32LE(256, 12); h.writeUInt32LE(256, 16);
  h.writeUInt32LE(32768, 20); h.writeUInt32LE(1, 28);
  h.writeUInt32LE(32, 76); h.writeUInt32LE(4, 80); h.write("DXT1", 84, "latin1");
  h.writeUInt32LE(0x1000, 108);
  const body = Buffer.alloc(32768);
  const gray565 = (l) => (l << 11) | (Math.round(l * 63 / 31) << 5) | l;   // 5-bit level, so 31 is pure white
  let o = 0;
  for (let by = 0; by < 64; by++) for (let bx = 0; bx < 64; bx++) {
    const px = [];
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) px.push(levels[(by * 4 + y) * 256 + bx * 4 + x]);
    const hi = Math.max(...px), lo = Math.min(...px);
    body.writeUInt16LE(gray565(hi), o); body.writeUInt16LE(gray565(lo), o + 2);
    let bits = 0;
    if (hi !== lo) {
      // 4-colour mode (color0 > color1): 0 = hi, 1 = lo, 2 = 2/3 hi, 3 = 1/3 hi
      const pal = [hi, lo, (2 * hi + lo) / 3, (hi + 2 * lo) / 3];
      px.forEach((g, i) => {
        let best = 0;
        for (let k = 1; k < 4; k++) if (Math.abs(pal[k] - g) < Math.abs(pal[best] - g)) best = k;
        bits |= best << (i * 2);
      });
    }
    body.writeUInt32LE(bits >>> 0, o + 4);
    o += 8;
  }
  return Buffer.concat([h, body]);
}

module.exports = { LIT, SHADOW, litLevels, levelsFromLight, shadowRaw, shadowDds };
