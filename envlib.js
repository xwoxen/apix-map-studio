// Metin2 environment scripts (.msenv): parse the parts the editor shows (sun, ambient, fog, sky).
const num = (s) => s.trim().split(/\s+/).map(Number);

function group(text, name) {
  const start = text.search(new RegExp(`Group\\s+${name}\\s*\\{`, "i"));
  if (start < 0) return "";
  let depth = 0;
  for (let i = text.indexOf("{", start); i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  return text.slice(start);
}
const field = (block, key) => { const m = block.match(new RegExp(`^\\s*${key}\\s+([^\\r\\n]+)`, "mi")); return m ? m[1].trim() : null; };

function parseEnvironment(text) {
  const light = group(text, "DirectionalLight"), bg = group(light, "Background");
  const fog = group(text, "Fog"), sky = group(text, "SkyBox");
  const color = (s, fallback) => (s ? num(s).slice(0, 3) : fallback);
  const gradient = [];
  const list = sky.match(/List\s+Gradient\s*\{([^}]*)\}/i);
  if (list) {
    const values = num(list[1]).filter((v) => !Number.isNaN(v));
    for (let i = 0; i + 3 < values.length; i += 4) {
      const c = values.slice(i, i + 3);
      if (c.some((v) => v > 0)) gradient.push(c);
    }
  }
  const faces = {};
  for (const f of ["Front", "Back", "Left", "Right", "Top", "Bottom"]) {
    const v = field(sky, `${f}FaceFileName`);
    if (v) faces[f.toLowerCase()] = v.replace(/^"|"$/g, "");
  }
  return {
    sunDirection: num(field(light, "Direction") || "-0.4 0.8 -0.4"),
    diffuse: color(field(bg, "Diffuse"), [1, 0.96, 0.88]),
    ambient: color(field(bg, "Ambient"), [0.45, 0.47, 0.5]),
    fog: {
      enabled: (field(fog, "Enable") || "0").startsWith("1"),
      near: Number(field(fog, "NearDistance") || 5000),
      far: Number(field(fog, "FarDistance") || 25000),
      color: color(field(fog, "Color"), [0.6, 0.7, 0.8])
    },
    sky: { textured: (field(sky, "bTextureRenderMode") || "0").startsWith("1"), faces, gradient }
  };
}

module.exports = { parseEnvironment };
