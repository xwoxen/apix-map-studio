// Minimal ZIP reader / writer for the client packs (libzip in EterPack/ZIP.cpp reads them): stored (0) and deflate (8)
// members, no zip64, no encryption - what every APIX pack uses. Rewriting a pack keeps every member's name, order,
// method, time and attributes; only the data of replaced members changes.
// Note: the client skips zero-size members (it treats them as folders), so a real file must never be empty.
const fs = require("fs");
const zlib = require("zlib");

const CRC_TABLE = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

function readZip(file) {
  const buf = fs.readFileSync(file);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error(`${file}: not a ZIP file`);
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`${file}: bad central directory`);
    const method = buf.readUInt16LE(p + 10), time = buf.readUInt16LE(p + 12), date = buf.readUInt16LE(p + 14), crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20), size = buf.readUInt32LE(p + 24), nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const extAttr = buf.readUInt32LE(p + 38), local = buf.readUInt32LE(p + 42), madeBy = buf.readUInt16LE(p + 4), flags = buf.readUInt16LE(p + 8);
    const name = buf.toString("latin1", p + 46, p + 46 + nameLen);
    if (flags & 1) throw new Error(`${file}: ${name} is encrypted`);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + csize);
    const data = method === 0 ? Buffer.from(raw) : method === 8 ? zlib.inflateRawSync(raw) : null;
    if (!data) throw new Error(`${file}: ${name} uses compression ${method}`);
    if (data.length !== size || crc32(data) !== crc) throw new Error(`${file}: ${name} fails its CRC`);
    entries.push({ name, method, time, date, extAttr, madeBy, data });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function writeZip(file, entries) {
  const locals = [], central = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "latin1"), data = e.data, crc = crc32(data);
    const comp = e.method === 8 ? zlib.deflateRawSync(data, { level: 9 }) : data;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(e.method, 8);
    lh.writeUInt16LE(e.time, 10); lh.writeUInt16LE(e.date, 12); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(e.madeBy || 20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0, 8);
    ch.writeUInt16LE(e.method, 10); ch.writeUInt16LE(e.time, 12); ch.writeUInt16LE(e.date, 14); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(e.extAttr || 0, 38); ch.writeUInt32LE(offset, 42);
    locals.push(lh, name, comp); central.push(ch, name);
    offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  fs.writeFileSync(file, Buffer.concat([...locals, cd, end]));
}

module.exports = { readZip, writeZip, crc32 };
