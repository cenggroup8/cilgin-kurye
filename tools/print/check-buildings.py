# Checks the 25 building STL files before printing (M6-5, #56).
#
# For every M6-led-board/hardware/print/building_b_r_c.stl:
#   - closed solid: every edge has exactly one neighbour face, volume > 0
#   - prints without supports: no face hangs over more than 45° except on the bed (z = 0)
#   - base fits the square between the strips: 105 × 105 mm (road pitch - strip - 2 × 0.5 mm)
#   - height: the highest point is height_m of the block in city_plan.json × 1.12
#   - distance to the LED strips and to the store LEDs (sizes from strip_layout.json, #75)
#   - fits the printer: the size of the largest part
#
# And depo.stl (the team depot): closed, no overhang over 45°, and in each corner it fits
# around the two store LEDs and stays clear of the road strips.
#
# Run:  python3 tools/print/check-buildings.py      (plain Python 3, no packages)

import json, math, os, struct, sys

sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
plan = json.load(open(os.path.join(ROOT, "contracts", "city_plan.json")))
# Smallest free gap (mm) between a part's base and a strip edge / a store LED. With the 12 mm strip
# the plate fills the square between the strips with 0.5 mm free on each side; the depot stands
# 2.5 mm from the strip. Nothing touches the strip.
MIN_STRIP, MIN_DEPOT_STRIP, MIN_LED, MIN_DEPOT_LED = 0.45, 2.0, 3.0, 0.5
CLEAR = 0.5  # as gen-city.py

# Strip and store LED sizes come from the strip layout (#75), so a new strip needs no edit here.
LAYOUT = os.path.join(ROOT, "M6-led-board", "hardware", "strip_layout.json")
if not os.path.exists(LAYOUT):
    sys.exit("strip_layout.json yok: önce #75 (M6-5 şerit yerleşimi) birleşmeli")
lay = json.load(open(LAYOUT))
brd = lay["board"]
M, P, W, L = brd["margin_mm"], brd["road_pitch_mm"], brd["strip_width_mm"], brd["piece_mm"]
K, OFF, HW = 1.12, (P - L) / 2, W / 2  # heights: 1 m = 1.12 mm
SQ, P0, SIZE = P - W - 2 * CLEAR, W / 2 + CLEAR, brd["size_mm"]  # plate size, plate corner from the node

strips, leds = [], []
for r in range(6):
    for c in range(5):
        x0 = M + P * c + OFF
        strips += [(x0, M + P * r - HW, x0 + L, M + P * r + HW), (M + P * r - HW, x0, M + P * r + HW, x0 + L)]
for ch in lay["chains"]:
    for pc in ch["pieces"]:
        if pc["kind"] != "store":
            continue
        for led in pc["leds"]:  # one LED: led pitch along the strip (east-west) x strip width
            cx, cz = led["mm"]
            leds.append((cx - brd["led_pitch_mm"] / 2, cz - HW, cx + brd["led_pitch_mm"] / 2, cz + HW))


def gap(points, rects):
    best = 1e9
    for a, c, b, d in rects:
        for x, z in points:
            if a < x < b and c < z < d:
                return -1.0
            best = min(best, math.hypot(max(a - x, 0, x - b), max(c - z, 0, z - d)))
    return best


def read_stl(path):
    """Triangles, open edge count, volume (mm³) and the number of faces that hang over more than 45°."""
    data = open(path, "rb").read()
    n = struct.unpack("<I", data[80:84])[0]
    edges, vol, down, pts = {}, 0.0, 0, []
    for i in range(n):
        t = struct.unpack("<12f", data[84 + i * 50: 132 + i * 50])
        a, bb, c = t[3:6], t[6:9], t[9:12]
        pts += [a, bb, c]
        vol += (a[0] * (bb[1] * c[2] - bb[2] * c[1]) - a[1] * (bb[0] * c[2] - bb[2] * c[0]) + a[2] * (bb[0] * c[1] - bb[1] * c[0])) / 6
        u = [bb[k] - a[k] for k in range(3)]
        w = [c[k] - a[k] for k in range(3)]
        nrm = (u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0])
        ln = math.hypot(*nrm) or 1
        if nrm[2] / ln < -0.7072 and max(a[2], bb[2], c[2]) > 1e-3:
            down += 1
        for p, q in ((a, bb), (bb, c), (c, a)):
            key = (tuple(round(x, 3) for x in p), tuple(round(x, 3) for x in q))
            edges[key] = edges.get(key, 0) + 1
    open_edges = sum(1 for (p, q), v in edges.items() if v != 1 or edges.get((q, p), 0) != 1)
    return pts, open_edges, vol, down


def bed_outline(pts, place):
    """Points every 0.5 mm along the edges that lie on the bed, moved by place(x, y) -> board (x, z)."""
    out = set()
    for i in range(0, len(pts), 3):
        tri = pts[i:i + 3]
        for p, q in ((tri[0], tri[1]), (tri[1], tri[2]), (tri[2], tri[0])):
            if abs(p[2]) > 1e-3 or abs(q[2]) > 1e-3:
                continue
            steps = max(1, int(math.hypot(q[0] - p[0], q[1] - p[1]) / 0.5))
            for s in range(steps + 1):
                f = s / steps
                out.add(place(p[0] + f * (q[0] - p[0]), p[1] + f * (q[1] - p[1])))
    return out


ok_all, biggest = True, [0.0, 0.0, 0.0]
print("Bina  blok    taban(mm)    boy   cm3   şerit  LED   açık kenar  sarkma  durum")
for b in plan["buildings"]:
    path = os.path.join(ROOT, "M6-led-board", "hardware", "print", f"building_{b['block']}.stl")
    pts, open_edges, vol, down = read_stl(path)
    X, Y, Z = ([p[k] for p in pts] for k in range(3))
    size = (max(X) - min(X), max(Y) - min(Y), max(Z) - min(Z))
    biggest = [max(biggest[k], size[k]) for k in range(3)]
    r, c = (int(v) for v in b["block"].split("_")[1:])
    ox, oz = M + P * c + P0, M + P * r + P0 + SQ
    flat = bed_outline(pts, lambda x, y: (round(ox + x, 2), round(oz - y, 2)))
    ds, dl = gap(flat, strips), gap(flat, leds)
    plan_mm = b["height_m"] * K
    ok = (open_edges == 0 and vol > 0 and down == 0 and abs(size[0] - SQ) < 0.05 and abs(size[1] - SQ) < 0.05
          and abs(size[2] - plan_mm) <= 0.06
          and min(Z) > -1e-3 and ds >= MIN_STRIP and dl >= MIN_LED)
    ok_all &= ok
    led = "  -  " if dl > 50 else f"{dl:4.1f} "
    print(f"B{b['id']:<3} {b['block']}  {size[0]:4.1f}x{size[1]:4.1f}  {size[2]:5.1f} {vol / 1000:5.1f}   {ds:4.1f}  {led}   {open_edges:4d}      {down:3d}    {'TAMAM' if ok else 'SORUN'}")
# the depot, placed in each corner as gen-city.py places it
DEPOT_X, DEPOT_Z = (8.5, 53.3), (8.5, 54.5)
pts, open_edges, vol, down = read_stl(os.path.join(ROOT, "M6-led-board", "hardware", "print", "depo.stl"))
X, Y, Z = ([p[k] for p in pts] for k in range(3))
size = (max(X) - min(X), max(Y) - min(Y), max(Z) - min(Z))
worst_led, worst_strip, inside = 1e9, 1e9, True
for nx, nz, sx, sz in [(M, M, 1, 1), (SIZE - M, M, -1, 1), (M, SIZE - M, 1, -1), (SIZE - M, SIZE - M, -1, -1)]:
    x0 = nx + DEPOT_X[0] if sx > 0 else nx - DEPOT_X[1]
    zmax = nz + DEPOT_Z[1] if sz > 0 else nz - DEPOT_Z[0]
    ring = bed_outline(pts, lambda x, y: (round(x0 + x, 2), round(zmax - y, 2)))
    worst_strip = min(worst_strip, gap(ring, strips))
    corner_leds = [r for r in leds if x0 <= (r[0] + r[2]) / 2 <= x0 + size[0] and zmax - size[1] <= (r[1] + r[3]) / 2 <= zmax]
    inside &= len(corner_leds) == 2
    worst_led = min(worst_led, gap(ring, corner_leds))
ok = open_edges == 0 and vol > 0 and down == 0 and inside and worst_led >= MIN_DEPOT_LED and worst_strip >= MIN_DEPOT_STRIP
ok_all &= ok
print(f"Depo  {size[0]:4.1f}x{size[1]:4.1f}x{size[2]:4.1f} mm  {vol / 1000:4.1f} cm3  şerit {worst_strip:3.1f}  LED payı {worst_led:3.1f}  "
      f"LED içeride {'evet' if inside else 'HAYIR'}  açık kenar {open_edges}  sarkma {down}  {'TAMAM' if ok else 'SORUN'}")
print(f"En büyük parça: {biggest[0]:.1f} x {biggest[1]:.1f} x {biggest[2]:.1f} mm")
print("HEPSİ TAMAM" if ok_all else "SORUN VAR")
sys.exit(0 if ok_all else 1)
