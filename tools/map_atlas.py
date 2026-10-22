"""Atlas of a map from its per-terrain minimap.dds (top-down render) with a metre grid, to pick regions for import.
usage: python tools/map_atlas.py <map dir> <out.png> [grid_m=32] [scale=1.0]
Blocked cells (attr.atr bit 1) are shaded red when --attr is given."""
import os
import struct
import sys

from PIL import Image, ImageDraw, ImageFont

args = [a for a in sys.argv[1:] if not a.startswith("--")]
mapdir, out = args[0], args[1]
grid = int(args[2]) if len(args) > 2 else 32
scale = float(args[3]) if len(args) > 3 else 1.0
show_attr = "--attr" in sys.argv


def ci(d, name):
    for f in os.listdir(d):
        if f.lower() == name.lower():
            return os.path.join(d, f)
    return None


setting = open(ci(mapdir, "setting.txt"), encoding="latin-1").read()
W, H = [int(v) for v in setting.split("MapSize")[1].split()[:2]]
px = int(256 * scale)
img = Image.new("RGB", (W * px, H * px), (40, 40, 40))
for ty in range(H):
    for tx in range(W):
        sub = ci(mapdir, f"{tx:03d}{ty:03d}")
        if not sub:
            continue
        mm = ci(sub, "minimap.dds")
        try:
            tile = Image.open(mm).convert("RGB").resize((px, px))
        except Exception:
            continue
        if show_attr:
            at = ci(sub, "attr.atr")
            if at:
                data = open(at, "rb").read()[6:]
                mask = Image.frombytes("L", (256, 256), bytes(255 if b & 1 else 0 for b in data)).resize((px, px))
                red = Image.new("RGB", (px, px), (200, 30, 30))
                tile = Image.composite(Image.blend(tile, red, 0.45), tile, mask)
        img.paste(tile, (tx * px, ty * px))
d = ImageDraw.Draw(img)
font = ImageFont.truetype(r"C:\Windows\Fonts\arial.ttf", max(10, int(11 * scale)))
step = grid * scale  # 1 m = scale px (minimap 256 px per 256 m terrain)
m = 0
while m * scale <= W * px:
    x = m * scale
    d.line([(x, 0), (x, H * px)], fill=(255, 255, 255) if m % 256 == 0 else (150, 150, 150), width=1)
    if m % (grid * 2) == 0:
        d.text((x + 2, 2), str(m), font=font, fill=(255, 255, 0))
    m += grid
m = 0
while m * scale <= H * px:
    y = m * scale
    d.line([(0, y), (W * px, y)], fill=(255, 255, 255) if m % 256 == 0 else (150, 150, 150), width=1)
    if m % (grid * 2) == 0:
        d.text((2, y + 2), str(m), font=font, fill=(255, 255, 0))
    m += grid
img.save(out)
print(out, img.size, f"{W}x{H} terrains")
