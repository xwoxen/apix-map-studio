"""Cave ceilings for apix_dungeon_01: an irregular rock/ice dome with hanging stalactites over each arena, written as a
Metin2 Granny 2.4 model through the Fem library writer (_exports/fem_library/tools/fem_writer.exe).

The faces look inward (normals towards the cave, winding like the donor), so the client - which culls back faces -
shows the ceiling only while the camera is inside the dome and hides it from above, like the official roofed dungeon
blocks (metin2_map_n_snow_dungeon_01). No .mdatr: the dome has no collision. Origin = centre of the floor.

Writes the models into the WorldEditor asset root (Map Studio reads it; the client packs stay untouched):
  <editor>/_asset_root/ymir work/zone/apix_dungeon/<name>.gr2
  <editor>/property/apix_dungeon/<name>.prb
usage: python make_dome.py
"""
import math, os, subprocess
import numpy as np

EDITOR = r"C:\Users\micha\Documents\we_remix_v59__20260716-1745"
WRITER = r"C:\Users\micha\Documents\APIX\_exports\fem_library\tools\fem_writer.exe"
DONOR = r"C:\Users\micha\Documents\APIX\apix-client\bin\pack\Zone\ymir work\zone\b\obj\b_general_obj_16.gr2"
WORK = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "work")
# a copy of terrainmaps/n/snow.m/stone03.dds next to the models: the dot in "snow.m" breaks the Map Studio FBX conversion
TEXTURE = ("d:/ymir work/zone/apix_dungeon/apix_cave_stone.dds", 256, 256)
CRC_BASE = 1710000000           # own range, far from the client's CRCs and the Fem library (1700000000+)

DOMES = [  # name, crc, footprint radius m, crown height m, stalactites, seed
    ("apix_cave_ceiling_66", CRC_BASE + 1, 66.0, 28.0, 70, 11),
    ("apix_cave_ceiling_84", CRC_BASE + 2, 84.0, 34.0, 110, 23),
]


def value_noise(seed):
    rng = np.random.default_rng(seed)
    grid = rng.uniform(-1, 1, (66, 66))

    def f(x, y):
        x, y = min(x % 63, 62.999), min(y % 63, 62.999)
        i, j = int(x), int(y)
        fx, fy = x - i, y - j
        u, v = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
        a, b, c, d = grid[i, j], grid[i + 1, j], grid[i, j + 1], grid[i + 1, j + 1]
        return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v
    return lambda x, y: sum(f(x * 2 ** o + o * 7.3, y * 2 ** o + o * 3.1) / 2 ** o for o in range(4))


def build(name, Rd, H, n_stal, seed):
    noise = value_noise(seed)
    rng = np.random.default_rng(seed + 1)
    verts, tris = [], []   # verts: [px py pz nx ny nz u v] in metres for now

    def ceiling(x, y):
        r = math.hypot(x, y) / Rd
        if r >= 1:
            return -6.0
        z = H * (1 - r * r) ** 0.55
        z += 2.2 * noise(x / 14, y / 14) * min(1.0, (1 - r) * 4)          # lumpy rock, calmer at the foot
        return z

    # dome: polar grid, plus a skirt from the rim down into the rock
    NR, NS = 34, 96
    rings = []
    for i in range(NR + 2):
        ring = []
        for k in range(NS):
            a = 2 * math.pi * k / NS
            r = Rd * min(i, NR) / NR
            x, y = r * math.cos(a), r * math.sin(a)
            z = ceiling(x, y) if i <= NR else -6.0
            if i == NR:
                z = max(z, 0.5)
            ring.append(len(verts))
            verts.append([x, y, z, 0, 0, 0, x / 6.0, y / 6.0])
            if i == 0:
                break
        rings.append(ring)
    for i in range(NR + 1):
        a, b = rings[i], rings[i + 1]
        for k in range(NS):
            k2 = (k + 1) % NS
            if i == 0:
                tris.append([a[0], b[k], b[k2]])
            else:
                tris.append([a[k], b[k], b[k2]])
                tris.append([a[k], b[k2], a[k2]])
    dome_tris = len(tris)

    # stalactites: cones hanging from the ceiling, longer near the middle
    for s in range(n_stal):
        r = Rd * 0.82 * math.sqrt(rng.uniform(0.02, 1))
        a = rng.uniform(0, 2 * math.pi)
        cx, cy = r * math.cos(a), r * math.sin(a)
        top = ceiling(cx, cy) + 0.6
        length = rng.uniform(1.5, 4.0) + 4.5 * (1 - r / Rd) * rng.uniform(0, 1)
        rad = rng.uniform(0.35, 0.9) + length * 0.08
        tip = len(verts)
        verts.append([cx + rng.uniform(-0.3, 0.3), cy + rng.uniform(-0.3, 0.3), top - length, 0, 0, 0, 0.5, 0.0])
        base = []
        m = 7
        for k in range(m):
            t = 2 * math.pi * k / m + rng.uniform(-0.2, 0.2)
            rr = rad * rng.uniform(0.8, 1.15)
            base.append(len(verts))
            verts.append([cx + rr * math.cos(t), cy + rr * math.sin(t), top, 0, 0, 0, k / m, length / 4])
        for k in range(m):
            tris.append([tip, base[k], base[(k + 1) % m]])

    V = np.array(verts, dtype=np.float64)
    F = np.array(tris, dtype=np.int64)
    # normals: area-weighted face normals, oriented towards the cave inside (down / towards the axis for the dome,
    # away from the cone axis for the stalactites), then accumulated per vertex
    P = V[:, :3]
    fn = np.cross(P[F[:, 1]] - P[F[:, 0]], P[F[:, 2]] - P[F[:, 0]])
    centre = P[F].mean(1)
    want = np.zeros_like(fn)
    want[:dome_tris] = -np.column_stack([centre[:dome_tris, 0] * 0.15, centre[:dome_tris, 1] * 0.15, np.full(dome_tris, H)])   # down / inward
    if len(F) > dome_tris:
        tipz = centre[dome_tris:]
        want[dome_tris:] = np.column_stack([tipz[:, 0] - P[F[dome_tris:, 0], 0], tipz[:, 1] - P[F[dome_tris:, 0], 1], np.full(len(tipz), -0.2)])
    flip = np.einsum("ij,ij->i", fn, want) < 0
    F[flip] = F[flip][:, ::-1]
    fn[flip] = -fn[flip]
    N = np.zeros_like(P)
    for c in range(3):
        np.add.at(N, F[:, c], fn)
    N /= np.linalg.norm(N, axis=1, keepdims=True) + 1e-9
    V[:, 3:6] = N
    # winding as the donor: cross(b-a, c-a) . normal > 0 (checked per face after smoothing)
    d = np.einsum("ij,ij->i", np.cross(P[F[:, 1]] - P[F[:, 0]], P[F[:, 2]] - P[F[:, 0]]), N[F[:, 0]] + N[F[:, 1]] + N[F[:, 2]])
    F[d < 0] = F[d < 0][:, ::-1]
    # Metin2 space: centimetres, V flipped
    V[:, :3] *= 100.0
    V[:, 7] = 1.0 - V[:, 7]
    return V, F


def main():
    gr2_dir = os.path.join(EDITOR, "_asset_root", "ymir work", "zone", "apix_dungeon")
    prb_dir = os.path.join(EDITOR, "property", "apix_dungeon")
    os.makedirs(gr2_dir, exist_ok=True)
    os.makedirs(prb_dir, exist_ok=True)
    os.makedirs(WORK, exist_ok=True)
    jobs = []
    for name, crc, Rd, H, n_stal, seed in DOMES:
        V, F = build(name, Rd, H, n_stal, seed)
        mesh = os.path.join(WORK, name + ".mesh")
        with open(mesh, "w", encoding="ascii") as f:
            f.write("name %s\nmaterials 1\n0 %d %d %s\n" % (name, TEXTURE[1], TEXTURE[2], TEXTURE[0]))
            f.write("vertices %d\n" % len(V))
            np.savetxt(f, V, fmt="%.4f")
            f.write("groups 1\n0 0 %d\n" % len(F))
            f.write("indices %d\n" % F.size)
            np.savetxt(f, F, fmt="%d")
        jobs.append("%s\t%s" % (mesh, os.path.join(gr2_dir, name + ".gr2")))
        with open(os.path.join(prb_dir, name + ".prb"), "wb") as fh:
            fh.write(b'YPRT\r\n%d\r\nbuildingfile\t\t"d:/ymir work/zone/apix_dungeon/%s.gr2"\r\npropertyname\t\t"%s"\r\npropertytype\t\t"Building"\r\nshadowflag\t\t"0"\r\n'
                     % (crc, name.encode(), name.encode()))
        print(name, "crc", crc, "verts", len(V), "tris", len(F), "size m", [round(float(x), 1) for x in (V[:, :3].max(0) - V[:, :3].min(0)) / 100])
    jobfile = os.path.join(WORK, "jobs.txt")
    with open(jobfile, "w", encoding="ascii") as f:
        f.write("\n".join(jobs) + "\n")
    r = subprocess.run([WRITER, DONOR, jobfile], capture_output=True, text=True, cwd=os.path.dirname(WRITER))
    print(r.stdout[-1500:], r.stderr[-800:])


if __name__ == "__main__":
    main()
