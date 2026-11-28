# Buildings of the LED board (M6-5, #56): detached houses, apartments and towers.
#
# Reads contracts/city_plan.json (block footprints) and writes one STL per block to
# M6-led-board/hardware/print/building_b_r_c.stl, and depo.stl, the team depot that
# stands over the store LEDs in each corner (print it 4 times, white PETG). With --board DIR it also writes the
# whole board (base, LED strips, stores, buildings) as .glb, .usdz, .blend and two
# preview images into DIR.
#
# Board sizes come from strip_layout.json (#75): 65 x 65 cm base, 12 mm strip, 118 mm road
# pitch. Each block is one print: a 1.2 mm plate that fills the square between the strips
# (105 x 105 mm, 0.5 mm free on each side) with the buildings on it, joined into one closed
# solid. The buildings are laid out on the 89.6 mm design block and then widened to the
# plate; heights stay at 1 m = 1.12 mm, as height_m in city_plan.json.
# Roofs slope upwards and nothing hangs over empty space, so a block prints standing on
# its plate with no supports. The store corner of the four corner blocks stays free.
#
# Run (Blender 4.2 or newer):
#   blender -b --factory-startup -P tools/print/gen-city.py
#   blender -b --factory-startup -P tools/print/gen-city.py -- 12 0
#   blender -b --factory-startup -P tools/print/gen-city.py -- --board ../tahta_3d
#   ... -- --center taper        style of the centre tower B12: steps, taper, twist, sail
# Check (plain Python 3): python3 tools/print/check-buildings.py

import bpy, bmesh, json, math, os, random, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "M6-led-board", "hardware", "print")
plan = json.load(open(os.path.join(ROOT, "contracts", "city_plan.json")))

lay = json.load(open(os.path.join(ROOT, "M6-led-board", "hardware", "strip_layout.json")))["board"]
BOARD, MARGIN, PITCH, STRIP = lay["size_mm"], lay["margin_mm"], lay["road_pitch_mm"], lay["strip_width_mm"]
CLEAR = 0.5  # free gap between a plate and the strip on each side
SQ = PITCH - STRIP - 2 * CLEAR  # plate size on the board: 105 mm
K = 1.12  # mm per metre for heights (and the 89.6 mm design block of an 80 m footprint)
DESIGN = 80 * K  # 89.6
F = SQ / DESIGN  # the design block is widened by this to the plate
PLATE = 1.2  # sidewalk plate
FLOOR = 3.0 * K  # one storey, 3.36 mm
SINK = 0.4  # parts reach this far into what they stand on, so the union is clean
EDGE = 2.4  # free sidewalk between the plate edge and a building
# Team depot over the store LEDs, mm from the corner node toward the block (#75: store LEDs
# 18.5 and 25.4 mm across, 22 mm along, each 6.9 x 12 mm). 2.5 mm clear of the strips.
DEPOT_X = (8.5, 53.3)  # across the ridge
DEPOT_Z = (8.5, 54.5)  # along the ridge
DEPOT_WALL, DEPOT_EAVE = 1.2, 6.4
PLATE0 = STRIP / 2 + CLEAR  # plate corner from the node: 6.5 mm
STORE_CUT = (DEPOT_Z[1] - PLATE0 + 0.8) / F  # free store corner (design mm): depot + 0.8 mm gap

# What stands on each block (id = 5 row + column, row 0 in the north).
# Centre: the tallest tower. Inner ring: apartments; on the diagonal (B8, B16) four
# apartments in the corners around an empty square.
# Middle of each outer side: apartments. Everything else: detached houses.
KIND = {
    0: "houses", 1: "houses", 2: "apt2", 3: "houses", 4: "houses",
    5: "houses", 6: "apt4", 7: "apt2", 8: "apt4open", 9: "houses",
    10: "apt4", 11: "apt2", 12: "tower", 13: "apt4", 14: "apt2",
    15: "houses", 16: "apt4open", 17: "apt4", 18: "apt2", 19: "houses",
    20: "houses", 21: "houses", 22: "apt4", 23: "houses", 24: "houses",
}
TOWER = {  # top height (mm), tower footprint (mm), offset of the tower from the centre
    12: (60.0, (38.4, 38.4), (0.0, 0.0)),
}


# ---- solids, in Blender coordinates (x east, y north, z up, mm) ---------------
def solid(name, verts, faces, coll):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    return ob


def prism(name, poly, z0, z1, coll):
    """Polygon (counter-clockwise seen from above) extruded from z0 to z1."""
    n = len(poly)
    v = [(x, y, z0) for x, y in poly] + [(x, y, z1) for x, y in poly]
    f = [list(range(n - 1, -1, -1)), list(range(n, 2 * n))]
    f += [[i, (i + 1) % n, n + (i + 1) % n, n + i] for i in range(n)]
    return solid(name, v, f, coll)


def house(name, cx, cy, a, b, zb, zw, roof, rise, along_y, coll):
    """Walls a × b half sizes around (cx, cy) from zb to zw, roof on top.
    roof: 'flat', 'gable' (ridge along the long side a) or 'hip'. The ridge runs
    along x, or along y when along_y (turned 90°, so the solid keeps its orientation)."""
    m = (lambda u, v: (cx - v, cy + u)) if along_y else (lambda u, v: (cx + u, cy + v))
    q = [(-a, -b), (a, -b), (a, b), (-a, b)]
    V = [(*m(u, v), zb) for u, v in q] + [(*m(u, v), zw) for u, v in q]
    F = [[3, 2, 1, 0]]
    if roof == "flat":
        F += [[0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7], [4, 5, 6, 7]]
    elif roof == "gable":
        V += [(*m(-a, 0), zw + rise), (*m(a, 0), zw + rise)]  # 8, 9
        F += [[0, 1, 5, 4], [2, 3, 7, 6], [3, 0, 4, 8, 7], [1, 2, 6, 9, 5], [4, 5, 9, 8], [6, 7, 8, 9]]
    else:  # hip
        r = a - b
        V += [(*m(-r, 0), zw + rise), (*m(r, 0), zw + rise)]
        F += [[0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7],
              [4, 5, 9, 8], [6, 7, 8, 9], [5, 6, 9], [7, 4, 8]]
    return solid(name, V, F, coll)


def tree(name, x, y, coll, r=2.4, h=6.4, n=8):
    ring = [(x + r * math.cos(2 * math.pi * i / n), y + r * math.sin(2 * math.pi * i / n), PLATE - SINK) for i in range(n)]
    V = ring + [(x, y, PLATE - SINK + h)]
    F = [list(range(n - 1, -1, -1))] + [[i, (i + 1) % n, n] for i in range(n)]
    return solid(name, V, F, coll)


def loft(name, rings, coll, apex=None):
    """Closed solid through horizontal rings [(z, [(x, y), ...]), ...], bottom to top.
    Every ring has the same number of points, counter-clockwise seen from above.
    The top is a flat cap, or a point when apex = (x, y, z)."""
    n = len(rings[0][1])
    V = [(x, y, z) for z, pts in rings for x, y in pts]
    F = [list(range(n - 1, -1, -1))]
    for r in range(len(rings) - 1):
        o, p = r * n, (r + 1) * n
        for i in range(n):
            j = (i + 1) % n
            F += [[o + i, o + j, p + j], [o + i, p + j, p + i]]
    top = (len(rings) - 1) * n
    if apex:
        V.append(apex)
        F += [[top + i, top + (i + 1) % n, len(V) - 1] for i in range(n)]
    else:
        F.append(list(range(top, top + n)))
    return solid(name, V, F, coll)


def octagon(cx, cy, w, d, cham, turn=0.0):
    """Rectangle w × d with chamfered corners (cham mm), turned by `turn` radians."""
    a, b = w / 2, d / 2
    pts = [(-a + cham, -b), (a - cham, -b), (a, -b + cham), (a, b - cham), (a - cham, b), (-a + cham, b), (-a, b - cham), (-a, -b + cham)]
    c, s_ = math.cos(turn), math.sin(turn)
    return [(cx + x * c - y * s_, cy + x * s_ + y * c) for x, y in pts]


# ---- one block ----------------------------------------------------------------
def build_block(b, coll):
    xs = [p[0] for p in b["footprint"]]
    S = (max(xs) - min(xs)) * K  # 89.6, widened to SQ at the end
    corner = len(b["footprint"]) > 4
    rng = random.Random(1000 + b["id"])

    # canonical frame: x east, z south (mm); the store corner, if any, is north-west
    if corner:
        x0, z0 = min(xs), min(p[1] for p in b["footprint"])
        cut_nw = not any(abs(x - x0) < 1e-6 and abs(z - z0) < 1e-6 for x, z in b["footprint"])
        cut_ne = not any(abs(x - max(xs)) < 1e-6 and abs(z - z0) < 1e-6 for x, z in b["footprint"])
        cut_se = not any(abs(x - max(xs)) < 1e-6 and abs(z - max(p[1] for p in b["footprint"])) < 1e-6 for x, z in b["footprint"])
        rot = 0 if cut_nw else 1 if cut_ne else 2 if cut_se else 3
    else:
        rot = (b["id"] * 3) % 4

    def to_xy(x, z):
        for _ in range(rot):
            x, z = S - z, x
        return x, S - z  # Blender y = north

    def rect_xy(x0, z0, x1, z1):
        (ax, ay), (bx, by) = to_xy(x0, z0), to_xy(x1, z1)
        return min(ax, bx), min(ay, by), max(ax, bx), max(ay, by)

    def put_house(nm, x0, z0, x1, z1, zb, zw, roof, rise, ridge_x):
        X0, Y0, X1, Y1 = rect_xy(x0, z0, x1, z1)
        along_y = ridge_x == (rot % 2 == 1)  # canonical x turns into Blender y on odd turns
        a, bb = ((Y1 - Y0) / 2, (X1 - X0) / 2) if along_y else ((X1 - X0) / 2, (Y1 - Y0) / 2)
        if roof == "hip" and a - bb < 1.6:
            roof = "gable"
        house(nm, (X0 + X1) / 2, (Y0 + Y1) / 2, a, bb, zb, zw, roof, rise, along_y, coll)

    def put_tree(nm, x, z, **kw):
        tree(nm, *to_xy(x, z), coll, **kw)

    # plate
    if corner:
        c = STORE_CUT
        canon = [(c, 0), (S, 0), (S, S), (0, S), (0, c), (c, c)]
    else:
        canon = [(0, 0), (S, 0), (S, S), (0, S)]
    poly = [to_xy(x, z) for x, z in canon]
    area = sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly)))
    if area < 0:
        poly.reverse()
    plate = prism(f"B{b['id']}", poly, 0, PLATE, coll)

    kind = KIND[b["id"]]
    zb = PLATE - SINK

    def in_store(x0, z0, x1, z1, gap):
        """True when the rectangle reaches into the free store corner of a corner block."""
        return corner and min(x0, x1) < STORE_CUT + gap and min(z0, z1) < STORE_CUT + gap

    if kind == "houses":
        L = S / 3
        for j in range(3):
            for i in range(3):
                if (i, j) == (1, 1) or (corner and (i, j) == (0, 0)):
                    continue
                sides = [s for s, ok in (("N", j == 0), ("S", j == 2), ("W", i == 0), ("E", i == 2)) if ok]
                side = rng.choice(sides)
                w = rng.choice([15.2, 16.8, 18.4])  # along the street
                d = rng.choice([12.8, 14.4])  # depth
                f = EDGE + rng.choice([0.0, 0.8, 1.6])  # front garden
                floors = rng.choice([1, 2, 2])
                zw = PLATE + 0.8 + floors * FLOOR
                roof = rng.choice(["gable", "gable", "hip"])
                rise = d / 2 * math.tan(math.radians(38))
                lo_x, hi_x = max(i * L + 0.8, EDGE), min((i + 1) * L - 0.8, S - EDGE)
                lo_z, hi_z = max(j * L + 0.8, EDGE), min((j + 1) * L - 0.8, S - EDGE)
                if side in ("N", "S"):
                    c0 = (lo_x + hi_x) / 2 + rng.uniform(-2, 2)
                    hx0 = min(max(c0 - w / 2, lo_x), hi_x - w)
                    hz0 = f if side == "N" else S - f - d
                    tz = hz0 + d + 6 if side == "N" else hz0 - 6
                    tx = (lo_x + hi_x) / 2 + rng.uniform(-6, 6)
                    if not in_store(hx0, hz0, hx0 + w, hz0 + d, EDGE):
                        put_house(f"h{i}{j}", hx0, hz0, hx0 + w, hz0 + d, zb, zw, roof, rise, True)
                    if rng.random() < 0.7 and not in_store(tx - 2.4, tz - 2.4, tx + 2.4, tz + 2.4, 1.6):
                        put_tree(f"t{i}{j}", tx, tz)
                else:
                    c0 = (lo_z + hi_z) / 2 + rng.uniform(-2, 2)
                    hz0 = min(max(c0 - w / 2, lo_z), hi_z - w)
                    hx0 = f if side == "W" else S - f - d
                    tx = hx0 + d + 6 if side == "W" else hx0 - 6
                    tz = (lo_z + hi_z) / 2 + rng.uniform(-6, 6)
                    if not in_store(hx0, hz0, hx0 + d, hz0 + w, EDGE):
                        put_house(f"h{i}{j}", hx0, hz0, hx0 + d, hz0 + w, zb, zw, roof, rise, False)
                    if rng.random() < 0.7 and not in_store(tx - 2.4, tz - 2.4, tx + 2.4, tz + 2.4, 1.6):
                        put_tree(f"t{i}{j}", tx, tz)
        for k in range(rng.choice([3, 4])):  # the shared garden in the middle
            gx, gz = L + 6 + rng.uniform(0, L - 12), L + 6 + rng.uniform(0, L - 12)
            if not in_store(gx - 2.4, gz - 2.4, gx + 2.4, gz + 2.4, 1.6):
                put_tree(f"g{k}", gx, gz)

    elif kind in ("apt4", "apt4open"):
        open_square = kind == "apt4open"  # smaller apartments, nothing in the middle
        flat = -1 if open_square else rng.randrange(4)
        for k, (cx, cz) in enumerate([(0, 0), (1, 0), (0, 1), (1, 1)]):
            if open_square:
                w, d = rng.choice([27.2, 28.8]), rng.choice([26.4, 28.0])
            else:
                w, d = rng.choice([32.0, 33.6, 35.2]), rng.choice([27.2, 28.8, 30.4])
            x0 = EDGE if cx == 0 else S - EDGE - w
            z0 = EDGE if cz == 0 else S - EDGE - d
            zw = PLATE + 0.8 + rng.choice([4, 5, 6]) * FLOOR
            if k == flat:
                put_house(f"a{k}", x0, z0, x0 + w, z0 + d, zb, zw, "flat", 0, True)
                put_house(f"a{k}s", x0 + w / 2 - 3.2, z0 + d / 2 - 3.2, x0 + w / 2 + 3.2, z0 + d / 2 + 3.2, zw - SINK, zw + 2.4, "flat", 0, True)
            else:
                put_house(f"a{k}", x0, z0, x0 + w, z0 + d, zb, zw, "hip", d / 2 * math.tan(math.radians(25)), True)
        for k, (x, z) in enumerate([] if open_square else [(40.0, 44.8), (49.6, 40.0), (46.4, 50.4)]):
            put_tree(f"g{k}", x, z)

    elif kind == "apt2":
        for k, south in enumerate([False, True]):
            fl = rng.sample([4, 5, 6], 2)
            for part, (x0, x1, d, dz) in enumerate([(EDGE, 46.4, 24.0, 0.0), (44.0, S - EDGE, 22.4, 0.8)]):
                z0 = EDGE + dz if not south else S - EDGE - dz - d
                zw = PLATE + 0.8 + fl[part] * FLOOR
                put_house(f"s{k}{part}", x0, z0, x1, z0 + d, zb, zw, "hip", d / 2 * math.tan(math.radians(25)), True)
        for k, x in enumerate([16.0, 34.4, 55.2, 73.6]):
            put_tree(f"g{k}", x, S / 2 + (1.6 if k % 2 else -1.6))

    elif kind == "tower":
        H, (tw, td), (ox, oz) = TOWER[b["id"]]
        style = CENTER if b["id"] == 12 else "steps"
        P0 = 9.6 if style == "steps" else 17.6  # the new styles stand on a smaller, one-storey base
        podium = PLATE + 0.8 + (2 if style == "steps" else 1) * FLOOR
        put_house("podium", P0, P0, S - P0, S - P0, zb, podium, "flat", 0, True)
        cx, cz = S / 2 + ox, S / 2 + oz
        if style != "steps":
            X, Y = to_xy(cx, cz)
            z0 = podium - SINK
            if style == "taper":  # octagon narrowing from 28 to 16 mm, pointed top
                top = H - 9.6
                loft("tower", [(z0, octagon(X, Y, 28.0, 28.0, 8.0)), (top, octagon(X, Y, 16.0, 16.0, 4.6))], coll, apex=(X, Y, H))
            elif style == "twist":  # chamfered square, 60° turn over the height, narrowing a little
                levels = int((H - 1.6 - z0) / FLOOR) + 1
                rings = []
                for k in range(levels + 1):
                    f = k / levels
                    z = z0 + f * (H - 1.6 - z0)
                    w = 26.4 - 5.6 * f
                    rings.append((z, octagon(X, Y, w, w, 4.0, math.radians(60) * f)))
                loft("tower", rings, coll)
                w = 20.8
                loft("crown", [(H - 1.6 - SINK, octagon(X, Y, w - 6.4, w - 6.4, 2.4, math.radians(60))),
                               (H, octagon(X, Y, w - 6.4, w - 6.4, 2.4, math.radians(60)))], coll)
            elif style == "sail":  # slim slab with a steep sloping roof, and a lower partner
                a, bb = 14.4, 7.2  # half sizes of the slab: along the slope, across
                low, high = H - 22.4, H
                pts = [(X - a, Y - bb), (X + a, Y - bb), (X + a, Y + bb), (X - a, Y + bb)]
                V = [(x, y, z0) for x, y in pts] + [(X - a, Y - bb, low), (X + a, Y - bb, high), (X + a, Y + bb, high), (X - a, Y + bb, low)]
                solid("tower", V, [[3, 2, 1, 0], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7], [4, 5, 6, 7]], coll)
                Xp, Yp = X - a - 3.2, Y + bb + 1.6
                V = [(Xp - 6.4, Yp - 11.2, z0), (Xp + 6.4, Yp - 11.2, z0), (Xp + 6.4, Yp + 8.0, z0), (Xp - 6.4, Yp + 8.0, z0),
                     (Xp - 6.4, Yp - 11.2, H * 0.40), (Xp + 6.4, Yp - 11.2, H * 0.52), (Xp + 6.4, Yp + 8.0, H * 0.52), (Xp - 6.4, Yp + 8.0, H * 0.40)]
                solid("partner", V, [[3, 2, 1, 0], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7], [4, 5, 6, 7]], coll)
            for k, (x, z) in enumerate([(5.2, 5.2), (S - 5.2, 5.2), (5.2, S - 5.2), (S - 5.2, S - 5.2)]):
                put_tree(f"p{k}", x, z, r=2.0, h=5.6)
            tiers = []
        else:
            tiers = [(0.0, 0.62), (4.0, 0.84), (8.0, None)]
        base = podium - SINK
        for k, (inset, top) in enumerate(tiers):
            zt = H * top if top else H - 2.4
            put_house(f"t{k}", cx - tw / 2 + inset, cz - td / 2 + inset, cx + tw / 2 - inset, cz + td / 2 - inset, base, zt, "flat", 0, True)
            base = zt - SINK
        if tiers:
            put_house("cap", cx - 2.8, cz - 2.8, cx + 2.8, cz + 2.8, base, H, "flat", 0, True)
            for k, (x, z) in enumerate([(5.2, 5.2), (S - 5.2, 5.2), (5.2, S - 5.2), (S - 5.2, S - 5.2)]):
                put_tree(f"p{k}", x, z, r=2.0, h=5.6)

    # join everything into the plate
    parts = [o for o in coll.objects if o is not plate]
    pc = bpy.data.collections.new(f"parts{b['id']}")
    bpy.context.scene.collection.children.link(pc)
    for o in parts:
        coll.objects.unlink(o)
        pc.objects.link(o)
    mod = plate.modifiers.new("join", "BOOLEAN")
    mod.operation, mod.operand_type, mod.collection, mod.solver = "UNION", "COLLECTION", pc, "EXACT"
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(plate.evaluated_get(dg))
    plate.modifiers.clear()
    plate.data = me
    for o in parts:
        bpy.data.objects.remove(o)
    bpy.data.collections.remove(pc)
    bm = bmesh.new()
    bm.from_mesh(me)
    for v in bm.verts:  # design block -> plate between the strips
        v.co.x *= F
        v.co.y *= F
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(0.5), verts=bm.verts, edges=bm.edges)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    top = max(v.co.z for v in me.vertices)
    print(f"building_{b['block']}.stl  B{b['id']:<2} {kind:<6} top {top:5.1f} mm  {len(me.polygons)} triangles")
    return plate


# ---- team depot (store) -------------------------------------------------------
# A warehouse over the two store LEDs of a corner (sizes and place: DEPOT_X, DEPOT_Z above).
# Hollow with an open bottom, so printed in white or clear PETG it glows in the team colour.
# The roof is 45°, so its underside prints without supports. The same part goes into all
# four corners.


def build_depot(coll):
    w, d = DEPOT_X[1] - DEPOT_X[0], DEPOT_Z[1] - DEPOT_Z[0]
    a, b, t = d / 2, w / 2, DEPOT_WALL
    outer = house("Depo", b, a, a, b, 0, DEPOT_EAVE, "gable", b, True, coll)
    inner = house("Depo ic", b, a, a - t, b - t, -1, DEPOT_EAVE - t * (math.sqrt(2) - 1), "gable", b - t, True, coll)
    mod = outer.modifiers.new("hollow", "BOOLEAN")
    mod.operation, mod.object, mod.solver = "DIFFERENCE", inner, "EXACT"
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(outer.evaluated_get(dg))
    outer.modifiers.clear()
    outer.data = me
    bpy.data.objects.remove(inner)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    print(f"depo.stl  {w:.1f} x {d:.1f} x {max(v.co.z for v in me.vertices):.1f} mm, wall {t} mm, open bottom")
    return outer


# ---- main ---------------------------------------------------------------------
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
board_dir = None
CENTER = "twist"  # style of the centre tower B12: twist (chosen), taper, sail or steps
if "--center" in argv:
    k = argv.index("--center")
    CENTER = argv[k + 1]
    del argv[k:k + 2]
if "--board" in argv:
    k = argv.index("--board")
    board_dir = os.path.abspath(argv[k + 1])
    del argv[k:k + 2]
ids = [int(a) for a in argv] or [b["id"] for b in plan["buildings"]]

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
os.makedirs(OUT, exist_ok=True)
blocks = {}
for i in (ids if not board_dir else [b["id"] for b in plan["buildings"]]):
    b = plan["buildings"][i]
    coll = bpy.data.collections.new(f"block{i}")
    sc.collection.children.link(coll)
    ob = build_block(b, coll)
    blocks[i] = ob
    if i in ids:
        bpy.ops.object.select_all(action="DESELECT")
        ob.select_set(True)
        bpy.context.view_layer.objects.active = ob
        bpy.ops.wm.stl_export(filepath=os.path.join(OUT, f"building_{b['block']}.stl"), export_selected_objects=True, ascii_format=False)

dcoll = bpy.data.collections.new("depot")
sc.collection.children.link(dcoll)
depot = build_depot(dcoll)
bpy.ops.object.select_all(action="DESELECT")
depot.select_set(True)
bpy.context.view_layer.objects.active = depot
bpy.ops.wm.stl_export(filepath=os.path.join(OUT, "depo.stl"), export_selected_objects=True, ascii_format=False)

if board_dir:
    os.makedirs(board_dir, exist_ok=True)

    def mat(name, col, emit=0, rough=0.7):
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        p = m.node_tree.nodes["Principled BSDF"]
        p.inputs["Base Color"].default_value = col
        p.inputs["Roughness"].default_value = rough
        if emit:
            p.inputs["Emission Color"].default_value = col
            p.inputs["Emission Strength"].default_value = emit
        return m

    def cube(name, cx, cy, cz, sx, sy, sz, m, c):
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1)
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        o = bpy.data.objects.new(name, me)
        o.location, o.scale = (cx, cy, cz), (sx, sy, sz)
        me.materials.append(m)
        c.objects.link(o)

    pla = mat("PLA bina", (0.80, 0.82, 0.85, 1))
    ply = mat("Kontrplak (mat koyu gri)", (0.035, 0.038, 0.045, 1), rough=0.9)
    strip = mat("LED serit", (0.01, 0.01, 0.012, 1))
    led = mat("LED", (1, 0.93, 0.8, 1), 5)
    cB, cS, cM, cK = (bpy.data.collections.new(n) for n in ("Tahta", "LED seritler", "Magazalar", "Binalar"))
    for c in (cB, cS, cM, cK):
        sc.collection.children.link(c)
    cube(f"Kontrplak {BOARD}x{BOARD}x9", BOARD / 2, BOARD / 2, -4.5, BOARD, BOARD, 9, ply, cB)
    full = json.load(open(os.path.join(ROOT, "M6-led-board", "hardware", "strip_layout.json")))
    lp, PL = lay["led_pitch_mm"], lay["piece_mm"]
    off = (PITCH - PL) / 2
    for r in range(6):
        for c in range(5):
            x0 = MARGIN + PITCH * c + off
            cube(f"h_{r}_{c}", x0 + PL / 2, BOARD - (MARGIN + PITCH * r), 0.75, PL, STRIP, 1.5, strip, cS)
            cube(f"v_{c}_{r}", MARGIN + PITCH * r, BOARD - (x0 + PL / 2), 0.75, STRIP, PL, 1.5, strip, cS)
    for ch in full["chains"]:
        for pc in ch["pieces"]:
            if pc["kind"] == "segment":
                for k, l in enumerate(pc["leds"]):
                    cube(f"{pc['name']} LED{k}", l["mm"][0], BOARD - l["mm"][1], 2, 5, 5, 1, led, cS)
    colors = {"blue": (0.18, 0.43, 0.93, 1), "green": (0.12, 0.64, 0.39, 1), "purple": (0.55, 0.36, 0.96, 1), "yellow": (0.95, 0.76, 0.19, 1)}
    stores = [pc for ch in full["chains"] for pc in ch["pieces"] if pc["kind"] == "store"]
    for pc in stores:
        col = colors.get(pc["color"], (1, 1, 1, 1))
        m = mat("Magaza " + pc["color"], col, 8)
        for j, l in enumerate(pc["leds"]):
            cube(f"Magaza {pc['color']} LED{j}", l["mm"][0], BOARD - l["mm"][1], 1, lp, STRIP, 2, m, cM)
        nx = MARGIN if "W" in pc["corner"] else BOARD - MARGIN
        nz = MARGIN if "N" in pc["corner"] else BOARD - MARGIN
        sx, sz = (1 if nx < BOARD / 2 else -1), (1 if nz < BOARD / 2 else -1)
        # the depot over them, white PETG lit by the LEDs inside
        glow = mat("Depo " + pc["color"], tuple(0.35 + 0.65 * v for v in col[:3]) + (1,), 1.2)
        dob = bpy.data.objects.new(f"Depo {pc['color']}", depot.data.copy())
        dob.data.materials.clear()
        dob.data.materials.append(glow)
        x0 = nx + DEPOT_X[0] if sx > 0 else nx - DEPOT_X[1]
        zmax = nz + DEPOT_Z[1] if sz > 0 else nz - DEPOT_Z[0]
        dob.location = (x0, BOARD - zmax, 0)
        cM.objects.link(dob)
    for i, ob in blocks.items():
        b = plan["buildings"][i]
        xs = [p[0] for p in b["footprint"]]
        zs = [p[1] for p in b["footprint"]]
        for c in ob.users_collection:
            c.objects.unlink(ob)
        cK.objects.link(ob)
        ob.name = f"B{i} {b['block']} {KIND[i]}"
        r, c = (int(v) for v in b["block"].split("_")[1:])
        ob.location = (MARGIN + PITCH * c + PLATE0, BOARD - (MARGIN + PITCH * r + PLATE0 + SQ), 0)
        ob.data.materials.append(pla)
    for c in list(bpy.data.collections):
        if c.name.startswith("block") or c.name == "depot":
            bpy.data.collections.remove(c)

    sun = bpy.data.objects.new("Gunes", bpy.data.lights.new("Gunes", "SUN"))
    sun.data.energy, sun.data.angle = 2.4, math.radians(3)
    sun.rotation_euler = (math.radians(50), 0, math.radians(-35))
    sc.collection.objects.link(sun)
    w = bpy.data.worlds.new("w")
    sc.world = w
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0.6, 0.63, 0.68, 1)
    w.node_tree.nodes["Background"].inputs[1].default_value = 0.25
    sc.unit_settings.system, sc.unit_settings.scale_length, sc.unit_settings.length_unit = "METRIC", 0.001, "MILLIMETERS"
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(board_dir, "cilgin_kurye_tahta.blend"))

    # previews
    import mathutils
    sc.render.engine, sc.cycles.samples, sc.view_settings.view_transform = "CYCLES", 64, "AgX"
    cam = bpy.data.objects.new("Kamera", bpy.data.cameras.new("Kamera"))
    sc.collection.objects.link(cam)
    sc.camera, cam.data.clip_end = cam, 1e5
    g = BOARD / 600
    for name, loc, ortho, res in [("onizleme_aci", (820 * g, -320 * g, 560 * g), None, (1800, 1200)), ("onizleme_ust", (BOARD / 2, BOARD / 2 - 0.01, 1500), 640 * g, (1400, 1400))]:
        cam.location = loc
        cam.rotation_euler = (mathutils.Vector((BOARD / 2, BOARD / 2, 0)) - cam.location).to_track_quat("-Z", "Y").to_euler()
        cam.data.type = "ORTHO" if ortho else "PERSP"
        if ortho:
            cam.data.ortho_scale = ortho
        else:
            cam.data.lens = 42
        sc.render.resolution_x, sc.render.resolution_y = res
        sc.render.filepath = os.path.join(board_dir, name + ".png")
        bpy.ops.render.render(write_still=True)

    # .glb and .usdz in metres
    root = bpy.data.objects.new("Cilgin Kurye tahta", None)
    sc.collection.objects.link(root)
    root.scale = (0.001, 0.001, 0.001)
    for o in list(sc.objects):
        if o is not root and o.parent is None and o.type != "CAMERA":
            o.parent = root
    bpy.data.objects.remove(cam)
    bpy.context.view_layer.update()
    bpy.ops.export_scene.gltf(filepath=os.path.join(board_dir, "cilgin_kurye_tahta.glb"), export_format="GLB", export_yup=True, export_apply=True)
    bpy.ops.wm.usd_export(filepath=os.path.join(board_dir, "cilgin_kurye_tahta.usdz"))
    print("board files written to", board_dir)
