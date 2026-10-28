# 09 · The printed body: turning a working circuit into a part you can hold

[中文](09-enclosure.zh.md) | **English**

## Why this exists

A simulation proves the circuit works. It says nothing about where the board sits, whether the USB plug can reach the socket with the lid on, or whether the sonar that has to look forward is standing on anything. Those are the questions that decide whether a project stays a browser tab or becomes an object on a shelf.

`diagram.json` cannot answer them. Its coordinates are **layout hints in a schematic space**, not millimetres: move a part 40 units in Wokwi and nothing physically moves. So the enclosure needs a second file with real numbers, and the value of this module is not that it draws a box — it is that it **checks the box against the parts**:

| Check | The failure it prevents |
|---|---|
| every part in `diagram.json` has a place | you print a body for a board that does not fit |
| no two parts share space | the assembly cannot go together |
| every port can see out | the USB cable has nowhere to go, the LED lights the inside of a wall |
| every part is held by something | it drops the moment the box is turned over |
| every shell is closed | the slicer refuses the file, or prints a leaky mess |
| wall thickness ≥ nozzle | it prints as a shell that crumbles |

All of them are reported by `node scripts/check_enclosure.js`, which exits non-zero. A picture cannot report any of them.

---

## 1. `enclosure.json`

Millimetres, right-handed: **x** to the right, **y** to the back, **z** up. The origin is the outside front-left-bottom corner of the base.

```json
{
  "base":    { "w": 96, "d": 80, "h": 58, "wall": 2.4, "floor": 2.0, "fit": 0.4 },
  "lid":     { "on": true, "thick": 2.4, "lip": 3.0, "lipWall": 2.0 },
  "style":   { "color": "#f4c542", "accent": "#f59e0b" },
  "printer": { "bed": [220, 220], "layer": 0.2, "minWall": 0.8 },
  "margin": 0.4,
  "reach": 8,

  "parts":   [ { "id": "esp", "at": [20, 2.8, 2], "rot": 0 } ],
  "shelves": [ { "id": "beak", "at": [14, 2.4], "size": [56, 32], "z": 28, "thick": 2.4 } ],
  "bosses":  [ { "at": [6, 40], "d": 6.5, "hole": 3.2 } ],
  "cutouts": [ { "id": "vents", "face": "-y", "rect": [72, 40, 76, 52] } ]
}
```

### 1.1 `parts[]` — where each part physically sits

| Key | Meaning |
|---|---|
| `id` | **must match** a `parts[].id` in `diagram.json`; a mismatch is a hard failure, both ways |
| `at` | `[x, y, z]` of the part's **minimum corner** (not its centre) |
| `rot` | `0`/`90`/`180`/`270` (about z) or `"x90"`, `"y-90"`, `"x180"` … Only multiples of 90: every fit test is an axis-aligned box test, and an arbitrary angle would make all of them wrong |

Dimensions come from a table keyed by Wokwi part type (`board-esp32-devkit-c-v4` 28×55×20, `wokwi-hc-sr04` 45×20×15, `wokwi-servo` 32.5×12.2×22.5, `wokwi-led` 5×5×8.6, `wokwi-buzzer` 12×12×9.5, …). An unknown type is not silently given 0×0: it becomes a 12 mm cube **and a warning**, because a wrong box is worse than an obvious placeholder.

Rotation is applied before placement, and the rotated box is exact (`rotSize()` rounds cos/sin, so a 90° turn can never leave a 1e-16 in the arithmetic).

### 1.2 `shelves[]` — how a part that must look out of a wall gets held up

A sonar has to face the front wall, and it has to clear the floor and the board. That puts it 28 mm up in the air. Without a shelf the only way to draw it there is to let it float — and a floating part is a part that cannot be assembled.

```json
{ "id": "beak", "at": [14, 2.4], "size": [56, 32], "z": 28, "thick": 2.4 }
```

`at` is the minimum corner in plan, `size` is `[width, depth]`, `z` is the **top** surface height; the plate hangs `thick` below it. A shelf is snapped 0.3 mm into whichever wall it touches (sinking into the wall beats two coplanar faces), and it must touch at least one wall — a shelf floating in the middle of the cavity is a print that needs supports, which is a different design, so it is a hard failure rather than a warning.

### 1.3 `bosses[]` — screw posts, and the lid holes they imply

```json
{ "at": [6, 40], "d": 6.5, "hole": 3.2, "h": 58 }
```

`h` defaults to the interior height, because a post exists to reach the lid. The clearance hole in the lid is **derived** from the same coordinate — you never keep two lists in sync by hand. The post sinks 0.3 mm **into** the floor, not below it: starting at `z = -0.3` once left every part standing on four little feet with the real floor in the air.

### 1.4 `cutouts[]` — openings the parts did not ask for

Vents, cable exits, a window. `face` is `-y`/`+y`/`-x`/`+x`/`-z`, `rect` is `[u0, v0, u1, v1]` on that face, `round: true` makes it a circle, `margin` widens it.

Port-driven openings are automatic: every port in the dimension table declares a face and a rectangle, and the builder cuts a hole wherever one can be reached (`reach`, default 8 mm). A port buried 20 mm inside the box is reported as **blocked** rather than quietly given a decorative hole.

---

## 2. The workflow

```bash
node -e "console.log(JSON.stringify(Enclosure.init(diagram),null,2))"   # a draft layout that already fits
node scripts/check_enclosure.js examples/duck-robot --parts              # see every part's real box
node scripts/check_enclosure.js                                          # all examples, exit 1 on any problem
node scripts/sync_embed.js examples/duck-robot                           # enclosure.json -> the page block
node scripts/sync_enclosure.js                                           # enclosure.js -> every page
```

`check_enclosure.js --parts` prints the resolved box for each part — the fastest way to find out that "it looked right on screen" was 6 mm off:

```
esp      board-esp32-devkit-c-v4   28.0×55.0×20.0  at [20.0, 2.8, 2.0]  box [20.0,2.8,2.0]..[48.0,57.8,22.0]
hc       wokwi-hc-sr04             45.0×20.0×15.0  at [20.0, 2.8, 28.0] box [20.0,2.8,28.0]..[65.0,22.8,43.0]
```

### 2.1 Reading the report

| `k` | Meaning | Fix |
|---|---|---|
| `missing-part` | in `diagram.json`, absent from `enclosure.json` | give it a place |
| `stray-part` | in `enclosure.json`, absent from `diagram.json` | a rename went one way only |
| `outside` | a box crosses the cavity wall, floor or lid | move it in |
| `interfere` | two boxes share space | move one; the report gives the overlap size |
| `floating` | nothing under the part | put it on the floor, on a shelf, on another part, or press it into a wall hole |
| `blocked` | a port cannot reach a wall | turn the part or move it against that wall |
| `cutout-edge` | an opening is under 1.2 mm from a wall edge | it breaks the edge |
| `cutout-clash` | two openings overlap | merge them into one slot |
| `shelf` | a shelf is off a wall, outside the cavity, or through a part | fix the numbers |
| `mesh` | a shell is open, or a face triangulated to the wrong area | usually too many openings on one face — merge them |
| `thin` / `bed` | wall under `minWall`, or the part exceeds the bed | thicken, or scale |

`floating` is the one that surprises people, and it is the one worth having: a part 3 mm above the floor passes every "does it fit" test and still falls out.

### 2.2 Where it appears in the viewer

The page gets a card driven by the same `enclosure.json`:

- **外观** — exterior; shelves are hidden because an interior plate can only be seen through a hole, where the painter's algorithm draws it as a bar across the opening.
- **剖视 · 器件怎么放** — front wall and lid removed, parts drawn, ids labelled.
- **爆炸** — the lid lifted off.
- **↓ 下载 .stl** — binary STL, base and lid **laid out side by side**, lid turned over (180° about x) so the flat ceiling is on the bed and the lip points up. Printing it the other way up means a 96×80 bridge over air.

Problems and warnings appear on the card in red/amber, in the same words as the CLI. A page that says "all placed, no interference" above a red error box would be lying to itself, so the metadata line switches to "有待修的问题" as soon as `problems` is non-empty.

---

## 3. How the geometry is built (only if you need to change it)

- **Two closed shells plus small parts.** `base`, `lid`, `boss`, `shelf` are each a closed manifold. They are never CSG-merged — that needs a kernel — and they overlap by 0.3 mm where they join, which every slicer unions.
- **Faces are "axis-aligned rectangle minus convex holes".** That shape has an exact decomposition: cut the rectangle into horizontal bands at every hole vertex `y`; inside a band a convex hole is a straight segment, so the material is trapezoids. No bridge, no slit, no ear to miss. The bridge-and-earclip path still exists for faces whose outline is not a rectangle (the ring on top of a screw post), as a fallback.
- **Two audits per face.** Area (the triangles must sum to the rectangle minus the holes, within 0.2%) and closure (every directed edge has exactly one opposite twin). Four round holes woven together with slits once produced a face that closed edge-to-edge while covering 1192 of its 7680 mm² twice — closure alone cannot see that, the area audit can.
- **T-junctions are welded.** The strip triangulator subdivides a face's border at every hole height, so the wall next to it has a vertex mid-edge; a slicer reads that as a non-manifold seam. `weldTJunctions()` splits the long edge, and it runs to a fixed point.
- **Signed volume** decides winding. A shell built inside-out has the right shape and black normals.

## 4. The renderer's own rules

- Orthographic orbit camera, painter's algorithm, one `<polygon>` per triangle — so the output is testable in a fake DOM and diffable in git.
- **Backface culling on.** Without it every hole shows the near half of its own bore as a moon-shaped smear, and a screw post behind the wall shows through it.
- **Interior faces are shaded darker** (0.72). The far wall is the same plastic lit by the same lamp, so without this "the opening shows the inside" and "the opening is filled in" are the same pixels.
- Depth is `Y·cos(pitch) − Z·sin(pitch)`: larger means farther. Getting the z sign wrong draws a screw post at z=58 over a lid at z=66 — a post floating above a closed box, and the picture still looks almost right.

## 5. Limits, stated plainly

- **Boxes only.** Parts are axis-aligned boxes and the body is a rectangular cup. A round body, a snap-fit, a living hinge, a curved duck head: not here. What you get is a body that provably fits the parts.
- **No CSG.** Shells overlap rather than merge; the STL is a set of closed bodies a slicer unions. It is not a single manifold and `checkMesh` says so per shell.
- **One face, so many openings.** Past roughly 10–12 holes on one face the strip decomposition still works, but the fallback path can fail; the report says so instead of shipping a broken face.
- **`enclosure.json` is optional.** A breadboard project or a ring of 32 servos on a bare frame has no body; leave the block empty and the card hides itself. Never leave another project's box in the page — `sync_embed.js` blanks the block when there is no file.
