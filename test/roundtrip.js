// Round trip: parse an editor-saved AreaData.txt and write it back; the result must be byte-identical.
const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");
const { parseAreaData, saveObjects } = require("../maplib");

// an official client map (WorldEditor format, whole-degree rotations, some objects tilted)
const source = process.argv[2] || "C:/Users/micha/Documents/APIX/apix-client/bin/pack/OutdoorA1/metin2_map_a1";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mapstudio-"));
fs.mkdirSync(path.join(tmp, "000000"));
const original = fs.readFileSync(path.join(source, "002002", "areadata.txt"), "latin1");
fs.writeFileSync(path.join(tmp, "000000", "AreaData.txt"), original, "latin1");

const objects = parseAreaData(original, "000000");
assert.ok(objects.length > 0, "no objects parsed");
const result = saveObjects(tmp, [1, 1], objects);
const written = fs.readFileSync(path.join(tmp, "000000", "AreaData.txt"), "latin1");
assert.strictEqual(written, original, "AreaData round trip changed the file");
assert.ok(fs.existsSync(path.join(result.backup, "000000", "AreaData.txt")), "backup missing");
console.log(`ok: ${objects.length} objects, identical after round trip`);

// rotation: the vertical turn is the third number (client roll); the first two are tilts and survive the round trip
{
  const { formatAreaData, isLegacyStudioMap, ROTATION_MARKER } = require("../maplib");
  const one = (rot) => `Start Object000
    1.0 -2.0 3.0
    5
    ${rot}
    0.0
End Object
`;
  const [o] = parseAreaData(one("0.000000#0.000000#30.000000"), "k");
  assert.deepStrictEqual([o.yaw, o.pitch, o.roll], [30, 0, 0], "official: third number is the vertical turn");
  const [t] = parseAreaData(one("12.000000#5.000000#270.000000"), "k");
  assert.ok(formatAreaData([t]).includes("12.000000#5.000000#270.000000"), "tilts kept in place");
  const [l] = parseAreaData(one("45.000000#0.000000#0.000000"), "k", true);
  assert.strictEqual(l.yaw, 45, "legacy Studio map: first number was the vertical turn");
  assert.ok(formatAreaData([l]).includes("0.000000#0.000000#45.000000"), "saved in client order");
  assert.ok(formatAreaData([{ x: 0, y: 0, z: 0, crc: 1, yaw: -90.6, pitch: 0, roll: 0, bias: 0 }]).includes("0.000000#0.000000#269.000000"), "whole degrees 0..359");
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "mapstudio-rot-"));
  fs.mkdirSync(path.join(d, "_studio_backup"));
  assert.ok(isLegacyStudioMap(d), "older Studio save is legacy");
  fs.mkdirSync(path.join(d, "002002"));
  fs.writeFileSync(path.join(d, "002002", "areadata.txt"), one("345.000000#0.000000#30.000000"));
  assert.ok(!isLegacyStudioMap(d), "a non-zero third number means client order even with a Studio backup");
  fs.writeFileSync(path.join(d, "002002", "areadata.txt"), one("45.000000#0.000000#0.000000"));
  assert.ok(isLegacyStudioMap(d), "only first numbers: older Studio map");
  fs.writeFileSync(path.join(d, ROTATION_MARKER), "");
  assert.ok(!isLegacyStudioMap(d), "marker ends legacy");
  fs.rmSync(d, { recursive: true, force: true });
  console.log("ok: rotation order (client yaw#pitch#roll, vertical = third), legacy maps converted");
}
fs.rmSync(tmp, { recursive: true, force: true });

// AreaAmbienceData.txt (sound ambience with range) must also survive a round trip byte for byte
const { parseAmbienceData, formatAmbienceData } = require("../maplib");
const ambFile = "C:/Users/micha/Documents/APIX/apix-client/bin/pack/OutdoorA1/metin2_map_a1/003004/areaambiencedata.txt";
if (fs.existsSync(ambFile)) {
  const amb = fs.readFileSync(ambFile, "latin1");
  const parsed = parseAmbienceData(amb, "003004");
  assert.ok(parsed.length > 0 && parsed[0].ambience.range > 0, "no ambience parsed");
  assert.strictEqual(formatAmbienceData(parsed), amb, "AreaAmbienceData round trip changed the file");
  console.log(`ok: ${parsed.length} ambience objects, identical after round trip`);
}
