// Round trip: parse an editor-saved AreaData.txt and write it back; the result must be byte-identical.
const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");
const { parseAreaData, saveObjects } = require("../maplib");

const source = process.argv[2] || "C:/Users/micha/Documents/we_remix_v59__20260716-1745/apix_demo_ostrov";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mapstudio-"));
fs.mkdirSync(path.join(tmp, "000000"));
const original = fs.readFileSync(path.join(source, "000000", "AreaData.txt"), "latin1");
fs.writeFileSync(path.join(tmp, "000000", "AreaData.txt"), original, "latin1");

const objects = parseAreaData(original, "000000");
assert.ok(objects.length > 0, "no objects parsed");
const result = saveObjects(tmp, [1, 1], objects);
const written = fs.readFileSync(path.join(tmp, "000000", "AreaData.txt"), "latin1");
assert.strictEqual(written, original, "AreaData round trip changed the file");
assert.ok(fs.existsSync(path.join(result.backup, "000000", "AreaData.txt")), "backup missing");
console.log(`ok: ${objects.length} objects, identical after round trip`);
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
