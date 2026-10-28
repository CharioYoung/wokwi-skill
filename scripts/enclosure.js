/**
 * enclosure.js - build a printable enclosure for a Wokwi project.
 *
 * Why this exists:
 *   A circuit that runs in the simulator still has no body. The gap between
 *   "the LED blinks" and "I can put it on a shelf" is a shell that holds the
 *   parts at the right distance, opens where the connectors are, and prints
 *   without supports. That shell is geometry, and geometry can be generated
 *   from the same part list the circuit already has.
 *
 * The one thing this file cannot do:
 *   diagram.json is a SCHEMATIC canvas - its coordinates are layout hints,
 *   not millimetres. Nothing in it says how big a servo is. So the physical
 *   layout lives in a second file, enclosure.json, and the value of this
 *   module is that it CHECKS the two against each other: every part present,
 *   nothing interpenetrating, every port reachable, walls printable.
 *
 * Representation (v2):
 *   Everything here is a signed distance field, not a triangle soup. That is
 *   what makes rounded corners, fillets and smooth blends expressible in one
 *   line each - a corner radius is a parameter, a fillet is an `smin`, a hole
 *   is a subtraction. Two consumers read the same field:
 *     - paint()  raymarches it into pixels for the preview (perspective,
 *                ambient occlusion, soft shadows, real depth)
 *     - stl()    extracts an isosurface for printing
 *   Both see exactly the same geometry, so the picture cannot promise a shape
 *   the printer will not produce. The old painter's-algorithm renderer could:
 *   it had no depth buffer, and a part drawn "behind" a wall was decided by a
 *   sort key, not by geometry.
 *
 * Public API:
 *   Enclosure.init(dia)                     -> a draft enclosure.json
 *   Enclosure.model(enc, dia)               -> { sdf, parts, holes, problems, warns, stats }
 *   Enclosure.check(enc, dia)               -> { problems, warns, stats }
 *   Enclosure.paint(canvas, enc, dia, opts) -> draws pixels into a <canvas>
 *   Enclosure.render(enc, dia, opts)        -> { svg }  wireframe fallback
 *   Enclosure.stl(enc, dia, opts)           -> { data, stats }  binary STL
 *
 * Coordinates: millimetres, x right, y back, z up. z = 0 is the bed, so the
 * model drops straight onto it; -y is the face of the device.
 */
var Enclosure = (function () {
  'use strict';

  var VERSION = '2.0.0';

  /* ------------------------------------------------------------------ *
   * 1. Real dimensions
   *
   * Measured part sizes, not Wokwi's drawing sizes. Each entry is the part's
   * bounding box [width, depth, height] in mm, plus the ports that must see
   * daylight. `rect` is [a0,b0,a1,b1] on that face, with a along the face's
   * horizontal axis and b along its vertical one.
   *
   * `round: true` means the opening is circular - a transducer, a lens, a
   * button cap. A square hole in front of a round emitter wastes nothing but
   * looks wrong, and "looks wrong" is the only signal a preview can give.
   * ------------------------------------------------------------------ */
  var DIM = {
    'board-esp32-devkit-c-v4': {
      size: [28, 55, 20], color: '#1f2937', kind: 'board',
      ports: [
        { id: 'usb', face: '-y', rect: [8, 1, 18, 12], note: 'USB plug has to reach it from outside' },
        { id: 'en', face: '+z', rect: [3, 41, 9, 47], expose: false },
        { id: 'boot', face: '+z', rect: [3, 47, 9, 53], expose: false }
      ],
      mount: [[3.5, 3.5], [24.5, 3.5], [3.5, 51.5], [24.5, 51.5]]
    },
    'board-esp32-s3-devkitc-1': {
      size: [26, 63, 18], color: '#1f2937', kind: 'board',
      ports: [
        { id: 'usb', face: '-y', rect: [7, 1, 19, 12] },
        { id: 'en', face: '+z', rect: [3, 45, 9, 51], expose: false }
      ]
    },
    'wokwi-arduino-mega': {
      size: [54, 108, 21], color: '#0f766e', kind: 'board',
      ports: [
        { id: 'usb', face: '-y', rect: [8, 1, 20, 14] },
        { id: 'jack', face: '-y', rect: [34, 2, 44, 12], expose: false }
      ]
    },
    'wokwi-servo': {
      size: [32.5, 12.2, 22.5], color: '#2563eb',
      ports: [{ id: 'horn', face: '+z', rect: [12.25, 2.1, 20.25, 10.1], round: true }]
    },
    'wokwi-hc-sr04': {
      size: [45, 20, 15], color: '#0ea5e9',
      ports: [
        { id: 'trig', face: '-y', rect: [3.5, 0, 19.5, 15], round: true },
        { id: 'echo', face: '-y', rect: [25.5, 0, 41.5, 15], round: true }
      ]
    },
    'wokwi-buzzer': {
      size: [12, 12, 9.5], color: '#7c3aed',
      ports: [{ id: 'sound', face: '+z', rect: [1.5, 1.5, 10.5, 10.5], round: true }]
    },
    'wokwi-led': {
      size: [5, 5, 8.6], color: '#ef4444',
      ports: [{ id: 'lens', face: '+z', rect: [0.6, 0.6, 4.4, 4.4], round: true }]
    },
    'wokwi-resistor': { size: [25.4, 2.6, 2.6], color: '#a16207' },
    'wokwi-pushbutton': {
      size: [6, 6, 5], color: '#334155',
      ports: [{ id: 'cap', face: '+z', rect: [1.2, 1.2, 4.8, 4.8], round: true }]
    },
    'wokwi-potentiometer': {
      size: [9.5, 9.5, 7], color: '#334155',
      ports: [{ id: 'shaft', face: '+z', rect: [3.2, 3.2, 6.3, 6.3], round: true }]
    },
    'wokwi-dht22': {
      size: [15.1, 25, 7.7], color: '#0891b2',
      ports: [{ id: 'grille', face: '+z', rect: [2, 6, 13.1, 20] }]
    },
    'wokwi-ssd1306': {
      size: [27, 27, 4], color: '#111827',
      ports: [{ id: 'screen', face: '+z', rect: [2, 2, 25, 25] }]
    }
  };

  // A part we have no measurement for is a box this size plus a warning. A
  // silent 0x0x0 would put two parts in the same place and call it a fit.
  var UNKNOWN_SIZE = [12, 12, 12];

  /* ------------------------------------------------------------------ *
   * 2. Small vector / SDF kit
   *
   * Math.hypot is an order of magnitude slower than sqrt in V8 and this file
   * calls it millions of times per render, so everything goes through hyp().
   * ------------------------------------------------------------------ */
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function vlen(a) { return Math.sqrt(dot(a, a)); }
  function vnorm(a) { var l = vlen(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function mix(a, b, t) { return a + (b - a) * t; }
  function hyp(a, b) { return Math.sqrt(a * a + b * b); }
  function hypot3(a, b, c) { return Math.sqrt(a * a + b * b + c * c); }

  /* Polynomial smooth min/max. k is the blend width in mm: 0 is a hard union,
   * 3-8 reads as a moulded fillet, 12+ melts two forms into one. This is the
   * entire reason a shell can have a soft shoulder without a CAD kernel. */
  function smin(a, b, k) {
    if (!k) return a < b ? a : b;
    var h = Math.max(k - Math.abs(a - b), 0) / k;
    return (a < b ? a : b) - h * h * k * 0.25;
  }
  function smax(a, b, k) {
    if (!k) return a > b ? a : b;
    var h = Math.max(k - Math.abs(a - b), 0) / k;
    return (a > b ? a : b) + h * h * k * 0.25;
  }

  /* Rounded box extruded along z: R is the corner radius in plan, rzT/rzB the
   * fillet at the top and bottom edge. Keeping them separate is what lets a
   * shell sit flat on the bed (rzB small) while still having soft shoulders
   * (rzT large) - 96x80x26 with one radius looks like a soap bar either way.
   *
   * The `At` form takes plain numbers. It exists for one reason: the outer
   * surface is evaluated for every ray step of every pixel, and building
   * three throw-away arrays per call was a fifth of the render time. */
  function sdRBoxAt(px, py, pz, cx, cy, cz, bx, by, bz, R, rzT, rzB) {
    var qx = Math.abs(px - cx) - bx + R;
    var qy = Math.abs(py - cy) - by + R;
    var d2 = Math.min(Math.max(qx, qy), 0) + hyp(Math.max(qx, 0), Math.max(qy, 0)) - R;
    var rz = pz - cz > 0 ? (rzT == null ? R : rzT) : (rzB == null ? (rzT == null ? R : rzT) : rzB);
    var qz = Math.abs(pz - cz) - bz + rz;
    var d2i = d2 + rz;
    return Math.min(Math.max(d2i, qz), 0) + hyp(Math.max(d2i, 0), Math.max(qz, 0)) - rz;
  }
  function sdRBox(p, b, R, rzT, rzB) {
    return sdRBoxAt(p[0], p[1], p[2], 0, 0, 0, b[0], b[1], b[2], R, rzT, rzB);
  }

  function sdBox(p, b, r) {
    r = r || 0;
    var qx = Math.abs(p[0]) - b[0] + r, qy = Math.abs(p[1]) - b[1] + r, qz = Math.abs(p[2]) - b[2] + r;
    return hypot3(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r;
  }

  function sdEllipsoid(p, c, r) {
    var x = (p[0] - c[0]) / r[0], y = (p[1] - c[1]) / r[1], z = (p[2] - c[2]) / r[2];
    var k0 = Math.sqrt(x * x + y * y + z * z);
    if (k0 < 1e-9) return -Math.min(r[0], r[1], r[2]);
    var x1 = x / r[0], y1 = y / r[1], z1 = z / r[2];
    return k0 * (k0 - 1) / Math.sqrt(x1 * x1 + y1 * y1 + z1 * z1);
  }

  function sdCylZ(p, c, r, h) {
    var d = hyp(p[0] - c[0], p[1] - c[1]) - r;
    var w = Math.abs(p[2] - c[2]) - h;
    return Math.min(Math.max(d, w), 0) + hyp(Math.max(d, 0), Math.max(w, 0));
  }

  /* A capped cone, as the intersection of three half-spaces: the side, and
   * the two end caps. Writing it as max() of half-space distances is both
   * shorter than the "rounded cone" formula and, crucially, *conservative* -
   * the intersection is a subset of every one of its half-spaces, so
   * max() can never over-estimate the distance and the raymarcher cannot
   * step through the surface. The blended callers (smin) round off the
   * seam anyway.
   *
   * The naive version - "clamp the radius to the height, then take the
   * usual max/sqrt" - reports 0 everywhere on the plane z = c +/- h,
   * whatever the radius. A cone used as a shape then quietly fills the
   * entire build plate with a zero-thickness sheet, and every part standing
   * on the floor measures 0.5 mm inside it. */
  function sdConeZ(p, c, r1, r2, h) {
    var rad = hyp(p[0] - c[0], p[1] - c[1]);
    var z = p[2] - c[2];
    var dr = r2 - r1, len = hyp(2 * h, dr);
    // signed distance to the slanted side, measured from the rim at z = -h
    var side = (2 * h * (rad - r1) - dr * (z + h)) / len;
    return Math.max(side, Math.abs(z) - h);
  }

  /* ------------------------------------------------------------------ *
   * 3. Config
   * ------------------------------------------------------------------ */
  function defaults() {
    return {
      printer: { bed: [220, 220], layer: 0.2, minWall: 0.8 },
      base: { w: 90, d: 70, h: 40, wall: 2.4, floor: 2.0, fit: 0.4 },
      // form: the shape of the shell, as opposed to what goes in it.
      //   round / roundZ / roundZBottom - corner and fillet radii
      //   head   - the part that lifts off; null means a flat lid
      //   features - additions and subtractions (a beak is a rounded box,
      //             an eye socket is a sphere subtracted)
      form: { round: 12, roundZ: 8, roundZBottom: 3, head: null, features: [] },
      lid: { on: true, thick: 2.4, lip: 3.0, lipWall: 2.0 },
      style: { color: '#f4c542', accent: '#f59e0b', paint: [] },
      margin: 0.4,
      reach: 8,
      parts: [],
      cutouts: [],
      bosses: [],
      shelves: []
    };
  }

  function merge(base, given) {
    var out = {};
    function copy(o) { for (var kk in o) if (Object.prototype.hasOwnProperty.call(o, kk)) out[kk] = o[kk]; }
    copy(base);
    if (!given) return out;
    for (var k in given) {
      if (!Object.prototype.hasOwnProperty.call(given, k)) continue;
      var v = given[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) {
        var m = {}, kk2;
        for (kk2 in out[k]) m[kk2] = out[k][kk2];
        for (kk2 in v) m[kk2] = v[kk2];
        out[k] = m;
      } else out[k] = v;
    }
    return out;
  }

  /* A draft layout: parts in a row, as far from each other as their sizes
   * allow. Not a design - a starting point that already passes the fit checks,
   * so the author edits numbers instead of inventing them. */
  function init(dia) {
    var enc = defaults();
    var x = enc.base.wall + 2, y = enc.base.wall + 2, rowH = 0;
    enc.parts = (dia.parts || []).map(function (p) {
      var dim = DIM[p.type];
      var size = dim ? dim.size : UNKNOWN_SIZE;
      if (x + size[0] > enc.base.w - enc.base.wall - 2) { x = enc.base.wall + 2; y += rowH + 3; rowH = 0; }
      var at = [Math.round(x * 10) / 10, Math.round(y * 10) / 10, enc.base.floor + 0.5];
      x += size[0] + 3;
      rowH = Math.max(rowH, size[1]);
      return { id: p.id, at: at, rot: 0 };
    });
    return enc;
  }

  /* ------------------------------------------------------------------ *
   * 4. Placing parts
   *
   * `at` is the minimum corner of the part's bounding box AFTER rotation, so a
   * layout can be written without thinking about matrices: change `rot` and
   * the box grows the other way, `at` stays the corner.
   * ------------------------------------------------------------------ */
  function rotMat(rot) {
    if (rot == null || rot === 0) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
    if (typeof rot === 'number') {
      var a = rot * Math.PI / 180, c = Math.round(Math.cos(a)), s = Math.round(Math.sin(a));
      return [c, -s, 0, s, c, 0, 0, 0, 1];
    }
    var m = /^([xyz])(-?\d+)$/.exec(String(rot));
    if (!m) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
    var ang = Number(m[2]) * Math.PI / 180;
    var cc = Math.round(Math.cos(ang)), ss = Math.round(Math.sin(ang));
    if (m[1] === 'x') return [1, 0, 0, 0, cc, -ss, 0, ss, cc];
    if (m[1] === 'y') return [cc, 0, ss, 0, 1, 0, -ss, 0, cc];
    return [cc, -ss, 0, ss, cc, 0, 0, 0, 1];
  }

  function rotSize(size, M) {
    // Bounding box of a rotated box: |matrix| times size.
    return [
      Math.abs(M[0]) * size[0] + Math.abs(M[1]) * size[1] + Math.abs(M[2]) * size[2],
      Math.abs(M[3]) * size[0] + Math.abs(M[4]) * size[1] + Math.abs(M[5]) * size[2],
      Math.abs(M[6]) * size[0] + Math.abs(M[7]) * size[1] + Math.abs(M[8]) * size[2]
    ];
  }

  function rotNormal(face, M) {
    var v = face === '-y' ? [0, -1, 0] : face === '+y' ? [0, 1, 0]
      : face === '-x' ? [-1, 0, 0] : face === '+x' ? [1, 0, 0]
        : face === '-z' ? [0, 0, -1] : [0, 0, 1];
    return [
      Math.round(M[0] * v[0] + M[1] * v[1] + M[2] * v[2]),
      Math.round(M[3] * v[0] + M[4] * v[1] + M[5] * v[2]),
      Math.round(M[6] * v[0] + M[7] * v[1] + M[8] * v[2])
    ];
  }

  function resolveParts(enc, dia) {
    var byId = {};
    (dia.parts || []).forEach(function (p) { byId[p.id] = p; });
    return (enc.parts || []).map(function (entry) {
      var dp = byId[entry.id];
      var dim = DIM[(dp && dp.type) || entry.type] || null;
      var size = (entry.size || (dim && dim.size) || UNKNOWN_SIZE).slice();
      var M = rotMat(entry.rot);
      var rs = rotSize(size, M);
      var at = entry.at || [0, 0, 0];
      return {
        id: entry.id,
        type: (dp && dp.type) || entry.type || '?',
        known: !!dim,
        rot: entry.rot || 0,
        M: M,
        size: size,
        rsize: rs,
        color: entry.color || (dim && dim.color) || '#64748b',
        ports: (dim && dim.ports) || [],
        box: { x0: at[0], y0: at[1], z0: at[2], x1: at[0] + rs[0], y1: at[1] + rs[1], z1: at[2] + rs[2] }
      };
    });
  }

  /* ------------------------------------------------------------------ *
   * 5. The shell as a distance field
   *
   * Order is deliberate:
   *   outer - cavity     gives a wall of uniform thickness
   *   + bosses, shelves  adds what holds the parts up
   *   - holes            leaves openings the ports can see through
   *   + features         the shape (beak, wings, eyes) - only after the
   *                      functional surface exists, so a bump can never
   *                      swallow a hole
   *
   * The cavity runs past the top of the base on purpose: the shell is open
   * there, so "outer minus cavity" makes a rim instead of a ceiling.
   * ------------------------------------------------------------------ */
  function buildField(enc, dia) {
    var b = enc.base, t = b.wall, f = b.floor;
    var W = b.w, D = b.d, H = b.h;
    var cx = W / 2, cy = D / 2;
    var fm = enc.form || {};
    var R = clamp(fm.round == null ? 12 : fm.round, 0.5, Math.min(W, D) / 2 - 0.5);
    var rzT = clamp(fm.roundZ == null ? 8 : fm.roundZ, 0.5, H);
    var rzB = clamp(fm.roundZBottom == null ? 3 : fm.roundZBottom, 0.2, H);
    var head = fm.head && fm.head.on !== false ? fm.head : null;
    var zDiv = head ? (head.div != null ? head.div : H) : H;
    /* The cavity is the outer silhouette shrunk by one wall. The two corner
     * arcs have to stay *concentric* for that to mean anything: a round
     * outside and a square inside are two different curves, and the gap
     * between them is somewhere thicker than the wall and somewhere thinner
     * than it - a thin spot is a hole in the print. So the inner radius is
     * the outer radius minus the wall, not a number picked to look tidy.
     * (A smaller radius is still allowed - that is how you thicken a corner
     * on purpose - but never a larger one.) */
    var Rc = Math.min(Math.max(0.6, fm.cavRound == null ? R - t : fm.cavRound), Math.max(0.6, R - t)), rzTc = 1.2;
    var over = fm.overhang == null ? 0.6 : Math.max(0.6, fm.overhang);

    var parts = resolveParts(enc, dia);
    var holes = holesFor(enc, parts, { W: W, D: D, H: H, zDiv: zDiv, wall: t });

    var bx2 = W / 2, by2 = D / 2, bz2 = zDiv / 2;
    var cx2 = W / 2 - t, cy2 = D / 2 - t;
    var cavTop = H + 40, cavCZ = (f + cavTop) / 2, cavBZ = (cavTop - f) / 2;

    var baseOuter = function (p) {
      return sdRBoxAt(p[0], p[1], p[2], cx, cy, zDiv / 2, bx2, by2, bz2, R, rzT, rzB);
    };
    var baseCav = function (p) {
      return sdRBoxAt(p[0], p[1], p[2], cx, cy, cavCZ, cx2, cy2, cavBZ, Rc, rzTc, 0);
    };
    /* The lateral skin: the outer silhouette in plan, with no top face.
     *
     * This is the surface the cavity has to stay inside, and it has to be
     * *lateral* only. The base is open at the parting line on purpose - the
     * cavity runs past the top so that "outer minus cavity" leaves a rim
     * instead of a lid. Clip it with the whole outer form and the top face
     * comes along, and "one wall inside the top face" is a horizontal plane
     * 2.4 mm below the rim: an invisible ceiling. Every tall part then
     * "does not fit" in a shell that has plenty of room, and the only way
     * out is to shrink the part - which is how this used to lose a servo.
     */
    var baseSkin = function (p) {
      var qx = Math.abs(p[0] - cx) - bx2 + R;
      var qy = Math.abs(p[1] - cy) - by2 + R;
      return Math.min(Math.max(qx, qy), 0) + hyp(Math.max(qx, 0), Math.max(qy, 0)) - R;
    };

    /* Every extra - a screw post, a shelf, a hole, a decorative bump - carries
     * a bounding sphere. Once the distance to the cheap part of the field is
     * larger than that sphere plus the answer so far, the extra cannot be the
     * nearest surface and is skipped. Far away from the shell - which is most
     * of every ray - nothing but the two rounded boxes gets evaluated, and the
     * whole picture goes from 14 s to under 2. */
    function couldTouch(q, p, d) {
      var dx = p[0] - q.c[0], dy = p[1] - q.c[1], dz = p[2] - q.c[2];
      var lim = q.rb + d;
      return dx * dx + dy * dy + dz * dz < lim * lim;
    }

    var bossList = (enc.bosses || []).map(function (bs) {
      var z1 = bs.h == null ? zDiv - f : bs.h;
      return {
        c: [bs.at[0], bs.at[1], (f + z1) / 2],
        rb: hyp(bs.d / 2, (z1 - f) / 2) + 1,
        fn: function (p) {
          var outer = sdCylZ(p, [bs.at[0], bs.at[1], (f - 0.3 + z1) / 2], bs.d / 2, (z1 - f + 0.3) / 2);
          // The hole stops 1 mm short of the post top: a through hole in a screw
          // post is a hole the screw falls through.
          var inner = sdCylZ(p, [bs.at[0], bs.at[1], z1 + 0.5], bs.hole / 2, z1 - f + 1);
          return smax(outer, -inner, 0);
        }
      };
    });

    function makeShelves(want) {
      return (enc.shelves || []).filter(function (sh) { return (sh.on === 'head') === want; }).map(function (sh) {
        var x0 = sh.at[0], y0 = sh.at[1], x1 = x0 + sh.size[0], y1 = y0 + sh.size[1];
        var th = sh.thick == null ? 2.4 : sh.thick;
        return {
          c: [(x0 + x1) / 2, (y0 + y1) / 2, sh.z - th / 2],
          rb: hypot3((x1 - x0) / 2, (y1 - y0) / 2, th / 2) + 1,
          fn: function (p) {
            var dx = Math.abs(p[0] - (x0 + x1) / 2) - (x1 - x0) / 2;
            var dy = Math.abs(p[1] - (y0 + y1) / 2) - (y1 - y0) / 2;
            var dz = Math.abs(p[2] - (sh.z - th / 2)) - th / 2;
            return hypot3(Math.max(dx, 0), Math.max(dy, 0), Math.max(dz, 0)) + Math.min(Math.max(dx, dy, dz), 0);
          }
        };
      });
    }
    var shelfList = makeShelves(false);
    var headShelves = makeShelves(true);

    var feats = formFeatures(enc);

    /* A hole is a prism along its face normal, clipped to the wall it crosses.
     * `half` set means the prism is a rounded rectangle - the shape a slot
     * should be, and a shape a circle can never be.
     *
     * The wall clip is not cosmetic. With an unbounded prism a USB opening in
     * the front wall reams straight through the back wall as well: two holes
     * for the price of one, in a place nothing asked for.
     *
     * The clip has to start *outside* the shape, not at the box face. A bill
     * that overhangs by 15 mm, or a leg that reaches below the floor, leaves
     * material in front of the opening's start plane - and a hole that begins
     * inside a solid is a blind hole. `form.overhang` is that distance. */
    function holeSpan(p, h) {
      if (h.face === '-y' || h.face === '+y') return [p[0] - h.at[0], p[2] - h.at[2]];
      if (h.face === '-x' || h.face === '+x') return [p[1] - h.at[1], p[2] - h.at[2]];
      return [p[0] - h.at[0], p[1] - h.at[1]];
    }
    // how deep into the wall we are, measured from the outside surface
    function wallDepth(p, h, inner) {
      var w = h.wall == null ? t : h.wall;
      var n = h.face === '-y' ? p[1] : h.face === '+y' ? D - p[1]
        : h.face === '-x' ? p[0] : h.face === '+x' ? W - p[0]
          : h.face === '-z' ? p[2] : H - p[2];
      // `inner` is the band that is *wall*: not the opening's reach outside
      // the shell, only the material itself. A grille bar lives there and
      // nowhere else - a bar that reaches as far as the opening does hangs
      // in the air in front of the shell as a sliver of nothing.
      if (inner) return Math.max(-n, n - w);
      return Math.max(-n - over, n - w - 0.6);
    }
    function holeDist(p, h) {
      var s = holeSpan(p, h);
      if (!h.half) return hyp(s[0], s[1]) - h.r;
      var du = Math.abs(s[0]) - h.half[0], dv = Math.abs(s[1]) - h.half[1];
      return Math.min(Math.max(du, dv), 0) + hyp(Math.max(du, 0), Math.max(dv, 0)) - h.round;
    }

    function punch(d, p) {
      for (var i = 0; i < holes.length; i++) {
        var h = holes[i];
        /* Skip on the band, not on the field value. Subtracting a hole can
         * only push the field outwards, so a point outside the band - outside
         * the wall the opening pierces - is untouched by it, whatever else is
         * there. Testing "is the field value already large?" instead was
         * wrong in a way that cost a blind hole: a point *inside* a bulge
         * has a negative value, and that is exactly where an opening has to
         * be cut. */
        var slab = wallDepth(p, h);
        if (slab > 0) continue;
        var cut = Math.max(holeDist(p, h), slab);
        d = Math.max(d, -cut);
        /* Grille: thin bars left inside the opening. Sound still gets out and
         * the hole stops reading as a black void in the preview. A bar is a
         * plane in z intersected with the opening and the *wall* - and the
         * wall band is the one that does not reach outside the shell. Use
         * the opening's band instead and the bar runs out in front of the
         * shell as a sliver of nothing, hanging in the air. */
        if (h.bars) {
          var v = holeSpan(p, h)[1];
          var wall = wallDepth(p, h, true);
          for (var bi = 0; bi < h.bars.length; bi++) {
            var bar = Math.abs(v - h.bars[bi]) - (h.barT || 0.8);
            d = Math.min(d, Math.max(Math.max(bar, cut), wall));
          }
        }
      }
      return d;
    }

    function baseSdf(p) {
      // Cut the cavity *after* the outside decoration, not before. A wing is
      // an ellipsoid centred on the wall, so half of it is inside the box -
      // blended in afterwards it fills 4 mm of the cavity back up and lands
      // on top of whatever sits against that wall. Cutting last clips every
      // bulge flush with the inner surface, which is what a real shell is.
      var solid = decorate(baseOuter(p), p, [], feats.baseAdd);
      /* The cavity has to stay inside the shell - but "inside the shell" is
       * the lateral skin, not the whole outer form. Shrinking a *convex*
       * shape pulls it in, but shrinking a *concave* one - the crease where
       * the head melts into the back - pushes it out through the skin, and
       * the shell ends up with a hole where the neck is. Clipping the cavity
       * to the outer form minus one wall is what keeps the wall the same
       * thickness everywhere, including in every valley.
       *
       * The clip is lateral on purpose: see baseSkin(). A clip that can see
       * the top face of the base grows an invisible ceiling under the rim,
       * and a part standing 22 mm tall does not fit under a ceiling that was
       * never asked for. */
      var cav = Math.max(baseCav(p), baseSkin(p) + t);
      var d = Math.max(Math.max(solid, -cav), p[2] - zDiv);
      var i;
      for (i = 0; i < bossList.length; i++) if (couldTouch(bossList[i], p, d)) d = Math.min(d, bossList[i].fn(p));
      for (i = 0; i < shelfList.length; i++) if (couldTouch(shelfList[i], p, d)) d = Math.min(d, shelfList[i].fn(p));
      // Recesses go last: a carved groove has to be able to cut into a boss.
      d = decorate(d, p, feats.baseSub, []);
      return punch(d, p);
    }

    var headSdf = null, headTop = H;
    if (head) {
      var blobs = (head.blobs || []).map(function (bl) {
        // `kind` everywhere else in the file; `shape` was the old name and
        // still reads better in a head definition, so both are accepted.
        var isBox = (bl.shape || bl.kind) === 'box';
        var rb = isBox ? hypot3(bl.size[0], bl.size[1], bl.size[2]) : Math.max(bl.size[0], bl.size[1], bl.size[2]);
        /* A blob that is a box needs two different radii: the one in plan and
         * the one in the vertical section. One radius cannot be both - a
         * shape with a 14 mm plan radius is a lozenge, and a square cavity
         * inside it cuts straight through the skin at the corners. */
        var pr = bl.round == null ? 6 : bl.round;
        var zr = bl.roundZ == null ? pr : bl.roundZ;
        return {
          c: bl.at, rb: rb,
          f: isBox
            ? function (p) { return sdRBoxAt(p[0], p[1], p[2], bl.at[0], bl.at[1], bl.at[2], bl.size[0], bl.size[1], bl.size[2], pr, zr, zr); }
            : function (p) { return sdEllipsoid(p, bl.at, bl.size); },
          blend: bl.blend == null ? 8 : bl.blend
        };
      });
      var flange = function (p) {
        // Same footprint as the base so the seam disappears into one line.
        return sdRBoxAt(p[0], p[1], p[2], cx, cy, zDiv + t / 2, bx2, by2, t / 2, R, 1.2, 1.2);
      };
      /* A blob whose sphere is further than the answer so far cannot lower it
       * by more than its own blend width, so it is skipped. Only the head
       * part is sparse enough for this to matter; it is where the pixels are. */
      var blobSolid = function (p, sofar) {
        if (!blobs.length) return 1e9;
        var lim = sofar == null ? 1e9 : sofar;
        var d = 1e9;
        for (var i = 0; i < blobs.length; i++) {
          var q = blobs[i];
          var dx = p[0] - q.c[0], dy = p[1] - q.c[1], dz = p[2] - q.c[2];
          var reach2 = q.rb + lim + q.blend;
          if (dx * dx + dy * dy + dz * dz > reach2 * reach2) continue;
          d = i === 0 || d > 1e8 ? q.f(p) : smin(d, q.f(p), q.blend);
        }
        return d;
      };
      // A separate box-shaped cavity. Shrinking the outer form by one wall is
      // wrong for a flat part: the ellipsoid's belly is far narrower than its
      // equator, so a 45x20 sonar board physically does not fit inside a shape
      // that "looks" big enough. Real shells solve this the other way round -
      // square hollow, round outside, thicker corners.
      var cavBox = null;
      if (head.cav) {
        var hcor = head.cav;
        cavBox = function (p) {
          return sdRBoxAt(p[0], p[1], p[2], hcor.at[0], hcor.at[1], hcor.at[2], hcor.size[0], hcor.size[1], hcor.size[2], hcor.round == null ? 2 : hcor.round, 2, 0);
        };
      }
      var rimH = head.rim == null ? 3 : head.rim;
      headSdf = function (p) {
        var solid = smin(flange(p), blobSolid(p, null), head.flangeBlend == null ? 9 : head.flangeBlend);
        // Same order as the base: bill and eyes belong to the outside, so the
        // cavity gets the last word and every bulge ends flush with the wall.
        solid = decorate(solid, p, [], feats.headAdd);
        /* The wall has to vanish at the parting line, exactly as the base's
         * does. A hollow shell cut flat at zDiv leaves a 2.4 mm ring of
         * material with an open cross-section - the head mesh then has a
         * boundary and is not printable as one solid. Tapering the inner
         * surface out to the outer over rim mm turns that ring into a knife
         * edge. A box cavity, when given, is only extra interior room: it is
         * unioned in (min) but intersected with the outer (max), so it can
         * widen the hollow without ever eating the wall. */
        var rim = clamp((p[2] - zDiv) / rimH, 0, 1);
        var hollow = solid + t * rim;
        var cav = cavBox ? Math.min(hollow, Math.max(cavBox(p), solid)) : hollow;
        var d = Math.max(Math.max(solid, -cav), zDiv - p[2]);
        for (var si = 0; si < headShelves.length; si++) {
          if (couldTouch(headShelves[si], p, d)) d = Math.min(d, headShelves[si].fn(p));
        }
        d = decorate(d, p, feats.headSub, []);
        return punch(d, p);
      };
      headTop = zDiv + 8;
      (head.blobs || []).forEach(function (bl) {
        headTop = Math.max(headTop, zDiv + (bl.at[2] - zDiv) + bl.size[2]);
      });
    }

    var partsSdf = parts.map(function (pt) {
      var b2 = pt.box;
      return function (p) {
        return sdBox([p[0] - (b2.x0 + b2.x1) / 2, p[1] - (b2.y0 + b2.y1) / 2, p[2] - (b2.z0 + b2.z1) / 2],
          [(b2.x1 - b2.x0) / 2, (b2.y1 - b2.y0) / 2, (b2.z1 - b2.z0) / 2], 0.6);
      };
    });

    var showParts = false;
    function map(p) {
      var d = baseSdf(p);
      if (headSdf) { var dh = headSdf(p); if (dh < d) d = dh; }
      if (showParts) {
        for (var i = 0; i < partsSdf.length; i++) { var dp = partsSdf[i](p); if (dp < d) d = dp; }
      }
      return d;
    }
    function matAt(p) {
      var d = baseSdf(p), id = 0;
      if (headSdf) { var dh = headSdf(p); if (dh < d) d = dh; }
      if (showParts) for (var i = 0; i < partsSdf.length; i++) {
        var dp = partsSdf[i](p); if (dp < d) { d = dp; id = i + 1; }
      }
      return id;
    }

    return {
      map: map, matAt: matAt, baseMap: baseSdf, headMap: headSdf,
      setShowParts: function (v) { showParts = !!v; },
      W: W, D: D, H: H, topZ: headTop, zDiv: zDiv,
      parts: parts, holes: holes,
      hasHead: !!head
    };
  }

  /* Decoration lives in enclosure.json so a shape is data, not code - and so
   * check() can still tell whether the functional surface is intact. `on`
   * picks which shell carries the feature; a bump added to the base when the
   * beak belongs to the head would simply not be there after assembly. */
  function formFeatures(enc) {
    var list = (enc.form && enc.form.features) || [];
    var out = { baseAdd: [], baseSub: [], headAdd: [], headSub: [] };
    list.forEach(function (ft) {
      var fn, rb;
      if (ft.kind === 'ellipsoid') { fn = function (p) { return sdEllipsoid(p, ft.at, ft.size); }; rb = Math.max(ft.size[0], ft.size[1], ft.size[2]); }
      else if (ft.kind === 'box') { fn = function (p) { return sdBox(sub(p, ft.at), ft.size, ft.round == null ? 2 : ft.round); }; rb = hypot3(ft.size[0], ft.size[1], ft.size[2]); }
      else if (ft.kind === 'cone') { fn = function (p) { return sdConeZ(p, ft.at, ft.r1, ft.r2, ft.h); }; rb = hyp(Math.max(ft.r1, ft.r2), ft.h); }
      else if (ft.kind === 'sphere') {
        /* `r` is the documented key, but a `size:[r,r,r]` is an easy slip and
         * an undefined radius does not fail loudly - it makes the whole head
         * field NaN, and a NaN field is silently hidden, so the shell just
         * disappears from the picture and the preview shows only the base.
         * Accept either, and never let a missing radius reach the arithmetic. */
        var sr = ft.r != null ? ft.r : (ft.size ? (Array.isArray(ft.size) ? (ft.size[0] + ft.size[1] + ft.size[2]) / 3 : ft.size) : 0);
        fn = (function (rr) { return function (p) { return hypot3(p[0] - ft.at[0], p[1] - ft.at[1], p[2] - ft.at[2]) - rr; }; })(sr);
        rb = sr;
      }
      else return;
      var item = { fn: fn, blend: ft.blend || 0, c: ft.at, rb: rb };
      var key = (ft.op === 'sub' ? 'sub' : 'add');
      var onHead = ft.on === 'head';
      out[(onHead ? 'head' : 'base') + (key === 'sub' ? 'Sub' : 'Add')].push(item);
    });
    return out;
  }

  /* smin(a, b, k) cannot change `a` by more than k, so a feature whose
   * bounding sphere is further away than d + k is not worth evaluating. The
   * same test covers smax() for the recesses. */
  function decorate(d, p, subs, adds) {
    var i, q, dx, dy, dz, lim;
    for (i = 0; i < subs.length; i++) {
      q = subs[i]; lim = q.rb + d + (q.blend || 0);
      dx = p[0] - q.c[0]; dy = p[1] - q.c[1]; dz = p[2] - q.c[2];
      if (dx * dx + dy * dy + dz * dz > lim * lim) continue;
      d = smax(d, -q.fn(p), q.blend);
    }
    for (i = 0; i < adds.length; i++) {
      q = adds[i]; lim = q.rb + d + (q.blend || 0);
      dx = p[0] - q.c[0]; dy = p[1] - q.c[1]; dz = p[2] - q.c[2];
      if (dx * dx + dy * dy + dz * dz > lim * lim) continue;
      d = smin(d, q.fn(p), q.blend);
    }
    return d;
  }

  /* ------------------------------------------------------------------ *
   * 6. Where the holes go
   *
   * Two sources, in order of authority: explicit `cutouts`, then whatever the
   * ports demand. A port marked expose:false is a requirement that moved from
   * geometry to intent - the LED glows through the plastic on purpose - so it
   * asks for nothing here.
   * ------------------------------------------------------------------ */
  function holesFor(enc, parts, dims) {
    var W = dims.W, D = dims.D, zDiv = dims.zDiv, wall = dims.wall;
    var m = enc.margin == null ? 0.4 : enc.margin;
    var reach = enc.reach == null ? 8 : enc.reach;
    var out = [];

    function push(face, at, r, extra) {
      var h = { face: face, at: at, r: r, wall: wall };
      if (extra) for (var k in extra) if (extra[k] !== null) h[k] = extra[k];
      out.push(h);
    }

    (enc.cutouts || []).forEach(function (c) {
      var R2 = c.rect, pad = c.margin == null ? m : c.margin;
      var a = Math.abs(R2[2] - R2[0]) / 2 + pad, b = Math.abs(R2[3] - R2[1]) / 2 + pad;
      var at;
      if (c.face === '-y') at = [(R2[0] + R2[2]) / 2, 0, (R2[1] + R2[3]) / 2];
      else if (c.face === '+y') at = [(R2[0] + R2[2]) / 2, D, (R2[1] + R2[3]) / 2];
      else if (c.face === '-x') at = [0, (R2[0] + R2[2]) / 2, (R2[1] + R2[3]) / 2];
      else if (c.face === '+x') at = [W, (R2[0] + R2[2]) / 2, (R2[1] + R2[3]) / 2];
      else return;
      /* A slot stays a slot. Turning a 4 x 14 vent into the circle that
       * encloses it was the reason two vents 3 mm apart merged into one
       * hole: r = max(halfWidth, halfHeight) is the *circumscribed* circle. */
      push(c.face, at, hyp(a, b), {
        half: [a, b], round: c.round == null ? 0.8 : c.round,
        bars: c.bars || null, barT: c.barT
      });
    });

    parts.forEach(function (pt) {
      (pt.ports || []).forEach(function (port) {
        if (port.expose === false) return;
        var n = rotNormal(port.face, pt.M);
        var bx = pt.box;
        var face = null, along = null;
        if (n[1] === -1) { face = '-y'; }
        else if (n[1] === 1) { face = '+y'; }
        else if (n[0] === -1) { face = '-x'; }
        else if (n[0] === 1) { face = '+x'; }
        else if (n[2] === -1) { face = '-z'; }
        else return;   // ports facing the lid are the lid's problem, not a wall hole

        /* Where on the wall the opening lands. A port's rect is given in the
         * part's own frame, so it has to be rotated with the part before it
         * can be laid on a wall: a sonar's two transducers are 22 mm apart
         * inside the board, and dropping both at the box centre put them in
         * the same hole. */
        var rec = port.rect || [0, 0, 4, 4];
        /* The rect's two axes are the *face's* axes, not always x and z: on a
         * face looking along z the two spans are x and y. Reading them as
         * x and z put a servo horn 5 mm off its own shaft. */
        var su = (port.face === '-x' || port.face === '+x') ? pt.size[1] : pt.size[0];
        var sv = (port.face === '-z' || port.face === '+z') ? pt.size[1] : pt.size[2];
        var u = (rec[0] + rec[2]) / 2 - su / 2;
        var v = (rec[1] + rec[3]) / 2 - sv / 2;
        var along2 = (rec[2] - rec[0]) / 2, tall2 = (rec[3] - rec[1]) / 2;
        var lx, ly, lz;
        if (port.face === '-y' || port.face === '+y') { lx = u; ly = 0; lz = v; }
        else if (port.face === '-x' || port.face === '+x') { lx = 0; ly = u; lz = v; }
        else { lx = u; ly = v; lz = 0; }
        var M = pt.M;
        var dx = M[0] * lx + M[1] * ly + M[2] * lz;
        var dy = M[3] * lx + M[4] * ly + M[5] * lz;
        var dz = M[6] * lx + M[7] * ly + M[8] * lz;
        var c0 = [(bx.x0 + bx.x1) / 2 + dx, (bx.y0 + bx.y1) / 2 + dy, (bx.z0 + bx.z1) / 2 + dz];

        var at, r, half = null;
        if (face === '-y' || face === '+y') { at = [c0[0], face === '-y' ? 0 : D, c0[2]]; }
        else if (face === '-x' || face === '+x') { at = [face === '-x' ? 0 : W, c0[1], c0[2]]; }
        else { at = [c0[0], c0[1], 0]; }
        if (port.round) {
          r = Math.max(along2, tall2) + m;
        } else {
          // One of the two spans is horizontal on the wall, the other vertical.
          var hx = Math.abs(M[0]) * along2 + Math.abs(M[1]) * tall2;
          var hy = Math.abs(M[3]) * along2 + Math.abs(M[4]) * tall2;
          var hz = Math.abs(M[6]) * along2 + Math.abs(M[7]) * tall2;
          var a2, b2;
          if (face === '-y' || face === '+y') { a2 = hx + m; b2 = hz + m; }
          else if (face === '-x' || face === '+x') { a2 = hy + m; b2 = hz + m; }
          else { a2 = hx + m; b2 = hy + m; }
          half = [Math.max(a2, 0.6), Math.max(b2, 0.6)];
          r = hyp(half[0], half[1]);
        }

        var near = face === '-y' ? bx.y0 : face === '+y' ? D - bx.y1
          : face === '-x' ? bx.x0 : face === '+x' ? W - bx.x1 : bx.z0;
        if (near > reach) return;   // not against this wall, so not its hole
        // Keep the opening on one side of the parting line: a hole split in
        // half by the seam cannot be assembled back into a circle.
        if (face !== '-z' && at[2] - r < zDiv - 1 && at[2] + r > zDiv + 1) return;
        push(face, at, r, half ? { half: half, round: port.round === true ? 0 : 0.6 } : null);
      });
    });

    return out;
  }

  /* ------------------------------------------------------------------ *
   * 7. Checks
   *
   * These run on the field, not on a mesh: a mesh is an approximation of it,
   * and the failures worth catching (a part 0.2 mm inside a wall) are smaller
   * than one triangle.
   * ------------------------------------------------------------------ */
  function model(enc, dia) {
    var f = buildField(enc, dia);
    var problems = [], warns = [];
    var stats = { parts: f.parts.length, shells: f.hasHead ? 2 : 1, holes: f.holes.length, wall: enc.base.wall };

    f.parts.forEach(function (p) {
      if (!p.known) warns.push({ k: 'dim', msg: p.id + ' (' + p.type + ') 没有实测尺寸，按 ' + UNKNOWN_SIZE.join('x') + ' mm 的盒子处理' });
    });

    var shelves = (enc.shelves || []).map(function (s) {
      return {
        id: s.id || 'shelf',
        z1: s.z, x0: s.at[0], y0: s.at[1],
        x1: s.at[0] + s.size[0], y1: s.at[1] + s.size[1]
      };
    });
    /* What a part stands on, if anything. Used twice: once to decide whether
     * the part is supported, and once to excuse its underside from the
     * interference test. A part resting on the floor touches the floor - the
     * distance there is 0 by construction, and reporting that as "only 0.00
     * mm of clearance" trains the reader to ignore the warning. */
    function restingOn(p) {
      var b = p.box, tol = 0.6;
      if (Math.abs(b.z0 - enc.base.floor) <= tol) return enc.base.floor;
      var i;
      for (i = 0; i < shelves.length; i++) {
        var s = shelves[i];
        if (Math.abs(b.z0 - s.z1) <= tol && b.x0 < s.x1 - 1 && b.x1 > s.x0 + 1 && b.y0 < s.y1 - 1 && b.y1 > s.y0 + 1) return s.z1;
      }
      for (i = 0; i < f.parts.length; i++) {
        var q = f.parts[i];
        if (q.id === p.id) continue;
        var qb = q.box;
        if (Math.abs(b.z0 - qb.z1) <= tol && b.x0 < qb.x1 - 1 && b.x1 > qb.x0 + 1 && b.y0 < qb.y1 - 1 && b.y1 > qb.y0 + 1) return qb.z1;
      }
      return null;
    }

    // -- parts vs shell: sample corners, edges' midpoints and centres
    f.parts.forEach(function (p) {
      var b = p.box, worst = 1e9, at = null;
      var rs = restingOn(p);
      var xs = [b.x0, (b.x0 + b.x1) / 2, b.x1], ys = [b.y0, (b.y0 + b.y1) / 2, b.y1], zs = [b.z0, (b.z0 + b.z1) / 2, b.z1];
      for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) for (var k = 0; k < 3; k++) {
        if (k === 0 && rs !== null && Math.abs(b.z0 - rs) < 0.05) continue;  // underside: touching is the point
        var q = [xs[i], ys[j], zs[k]];
        var d = f.map(q);
        if (d < worst) { worst = d; at = q; }
      }
      if (worst < -0.05) {
        problems.push({ k: 'interfere', msg: p.id + ' 和壳体干涉：(' + at.map(function (v) { return Math.round(v * 10) / 10; }).join(', ') + ') 处距表面 ' + worst.toFixed(2) + ' mm' });
      } else if (worst < 0.2) {
        warns.push({ k: 'tight', msg: p.id + ' 只有 ' + worst.toFixed(2) + ' mm 余量' });
      }
    });

    // -- parts vs parts
    for (var a = 0; a < f.parts.length; a++) {
      for (var b2 = a + 1; b2 < f.parts.length; b2++) {
        var A = f.parts[a].box, B = f.parts[b2].box;
        var ox = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0);
        var oy = Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0);
        var oz = Math.min(A.z1, B.z1) - Math.max(A.z0, B.z0);
        if (ox > 0.05 && oy > 0.05 && oz > 0.05) {
          problems.push({ k: 'overlap', msg: f.parts[a].id + ' 和 ' + f.parts[b2].id + ' 相交 ' + Math.min(ox, oy, oz).toFixed(1) + ' mm' });
        }
      }
    }

    /* A part pressed into an opening in a side wall is held by the wall, not the
     * floor - an LED in a 5 mm hole does not need a bracket, and a sensor whose
     * transducers look out of the front panel is held exactly by that panel.
     * This is the fourth of the four ways a real build keeps a part put, and
     * the only one the floor / shelf / wall-box tests miss. A part whose lens
     * or transducer faces a wall and sits within reach of it, with a hole cut
     * in that wall under the part, is gripped. */
    function pressedIntoWall(p) {
      var b = p.box;
      var reach = (enc.reach == null ? 8 : enc.reach);
      for (var pi = 0; pi < (p.ports || []).length; pi++) {
        var port = p.ports[pi];
        if (port.expose === false) continue;
        var n = rotNormal(port.face, p.M);
        var face = n[1] === -1 ? '-y' : n[1] === 1 ? '+y' : n[0] === -1 ? '-x' : n[0] === 1 ? '+x' : null;
        if (!face) continue;
        var near = face === '-y' ? b.y0 : face === '+y' ? (enc.base.d - b.y1)
          : face === '-x' ? b.x0 : (enc.base.w - b.x1);
        if (near > enc.base.wall + 3) continue;   // gap too wide to grip
        var px = (face === '-y' || face === '+y') ? (b.x0 + b.x1) / 2 : (b.y0 + b.y1) / 2;
        var pz = (b.z0 + b.z1) / 2;
        for (var hi = 0; hi < f.holes.length; hi++) {
          var h = f.holes[hi];
          if (h.face !== face) continue;
          var hx = (face === '-y' || face === '+y') ? h.at[0] : h.at[1];
          var hz = h.at[2];
          var r = h.half ? Math.max(h.half[0], h.half[1]) : h.r;
          if (Math.abs(hx - px) <= r + 3 && Math.abs(hz - pz) <= r + 3) return true;
        }
      }
      return false;
    }

    // -- support: everything stands on something
    f.parts.forEach(function (p) {
      var b = p.box;
      var onFloor = Math.abs(b.z0 - enc.base.floor) <= 0.6;
      var onSomething = restingOn(p) !== null;
      var held = b.y0 <= enc.base.wall + 0.6 || b.x0 <= enc.base.wall + 0.6 || pressedIntoWall(p);
      if (!onFloor && !onSomething && !held) {
        problems.push({ k: 'support', msg: p.id + ' 悬空：底部 z=' + b.z0.toFixed(1) + ' 没有落在底板、层板或别的器件上' });
      }
    });

    shelves.forEach(function (s) {
      var bites = s.x0 <= enc.base.wall + 0.6 || s.y0 <= enc.base.wall + 0.6
        || s.x1 >= enc.base.w - enc.base.wall - 0.6 || s.y1 >= enc.base.d - enc.base.wall - 0.6;
      if (!bites) problems.push({ k: 'shelf', msg: s.id + ' 没有搭在墙上，悬在空中' });
    });

    // -- every hole must actually be open: probe just outside the wall
    f.holes.forEach(function (h, i) {
      var opened = 0;
      [[-0.55, 0], [0.55, 0], [0, -0.55], [0, 0.55]].forEach(function (o) {
        var q = [h.at[0] + o[0] * h.r, h.at[1], h.at[2] + o[1] * h.r];
        if (h.face === '-y') q[1] = -0.6;
        else if (h.face === '+y') q[1] = enc.base.d + 0.6;
        else if (h.face === '-x') q[0] = -0.6;
        else if (h.face === '+x') q[0] = enc.base.w + 0.6;
        else q[2] = -0.6;
        if (f.map(q) > 0) opened++;
      });
      if (!opened) problems.push({ k: 'hole', msg: '孔 #' + (i + 1) + '（' + h.face + '，' + h.at.map(function (v) { return Math.round(v); }).join(',') + '）没有打通：外面仍是实体' });
    });

    // -- printability
    var minWall = (enc.printer && enc.printer.minWall) || 0.8;
    if (enc.base.wall < minWall) problems.push({ k: 'wall', msg: '壁厚 ' + enc.base.wall + ' mm 低于打印机最小值 ' + minWall + ' mm' });
    f.holes.forEach(function (h) {
      if (h.r * 2 < 2.4) warns.push({ k: 'small', msg: '孔径 ' + (h.r * 2).toFixed(1) + ' mm 偏小，可能打不出来' });
    });

    // -- the removable head has to be big enough to hold anything
    if (f.hasHead) {
      if (f.zDiv < enc.base.floor + 4) problems.push({ k: 'head', msg: '分模线 z=' + f.zDiv + ' 太贴近底板' });
      if (f.topZ - f.zDiv < 12) problems.push({ k: 'head', msg: '头罩只有 ' + (f.topZ - f.zDiv).toFixed(1) + ' mm 高' });
    }

    return { sdf: f, parts: f.parts, holes: f.holes, problems: problems, warns: warns, stats: stats };
  }

  /* ------------------------------------------------------------------ *
   * 8. Preview
   *
   * One ray per pixel, sphere tracing, then shading with a key light, a sky
   * term, ambient occlusion and a soft shadow. No z-buffer is needed because
   * the field answers "what is closest here" directly - which is exactly what
   * the old renderer could not do, and why a part used to be painted on top
   * of the wall in front of it.
   *
   * Two mistakes worth remembering, both of which wasted a debugging round:
   *   - AO sampled at h = 0.9..11 mm and scaled by 1.05, but h is in mm, so a
   *     flat face "occluded" itself and every surface came out blotchy. The
   *     coefficient has to be calibrated against the unit of h.
   *   - camera right vector was cross(worldUp, fwd) instead of cross(fwd,
   *     worldUp), which flips the image top-to-bottom.
   * ------------------------------------------------------------------ */
  function hex2rgb(h) {
    h = String(h || '#cccccc').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    if (isNaN(r)) { r = g = b = 200; }
    return [r / 255, g / 255, b / 255];
  }

  function paintInto(field, enc, opts, w, h, buf) {
    var o = opts || {};
    var fov = (o.fov == null ? 30 : o.fov) * Math.PI / 180;
    var yaw = (o.yaw == null ? -36 : o.yaw) * Math.PI / 180;
    var pitch = (o.pitch == null ? 18 : o.pitch) * Math.PI / 180;
    var dist = o.dist || (Math.max(field.W, field.D, field.topZ) * 4.2);
    var target = o.target || [field.W / 2, field.D / 2, field.topZ * 0.44];

    var dir = [Math.sin(yaw) * Math.cos(pitch), -Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch)];
    var ro = [target[0] + dir[0] * dist, target[1] + dir[1] * dist, target[2] + dir[2] * dist];
    var fwd = vnorm(sub(target, ro));
    var right = vnorm([fwd[1], -fwd[0], 0]);
    var up = [
      right[1] * fwd[2] - right[2] * fwd[1],
      right[2] * fwd[0] - right[0] * fwd[2],
      right[0] * fwd[1] - right[1] * fwd[0]
    ];
    var tanH = Math.tan(fov / 2);
    var fieldMap = field.map;
    var L = vnorm([-0.42, -0.72, 0.78]);
    var AABB = { lo: [-field.W * 0.7, -field.D * 0.8, -40], hi: [field.W * 1.7, field.D * 1.8, field.topZ + 40] };

    function march(rd) {
      var t0 = 0, t1 = 2600, a;
      for (a = 0; a < 3; a++) {
        if (Math.abs(rd[a]) < 1e-8) { if (ro[a] < AABB.lo[a] || ro[a] > AABB.hi[a]) return -1; continue; }
        var ta = (AABB.lo[a] - ro[a]) / rd[a], tb = (AABB.hi[a] - ro[a]) / rd[a];
        if (ta > tb) { var s = ta; ta = tb; tb = s; }
        if (ta > t0) t0 = ta;
        if (tb < t1) t1 = tb;
        if (t0 > t1) return -1;
      }
      var tt = t0 > 0.4 ? t0 : 0.4, d;
      for (var i = 0; i < 128; i++) {
        d = fieldMap([ro[0] + rd[0] * tt, ro[1] + rd[1] * tt, ro[2] + rd[2] * tt]);
        if (d < 0.00045 * tt + 0.006) return tt;
        tt += d;
        if (tt > t1) break;
      }
      return -1;
    }
    function normalAt(p) {
      var e = 0.35;
      /* Four taps instead of six. The tetrahedral offsets give the same
       * normal to within a fraction of a degree and cost a third less -
       * with the field evaluated six times per pixel, that is real money. */
      var a = fieldMap([p[0] + e, p[1] - e, p[2] - e]);
      var b = fieldMap([p[0] - e, p[1] - e, p[2] + e]);
      var c = fieldMap([p[0] - e, p[1] + e, p[2] - e]);
      var d2 = fieldMap([p[0] + e, p[1] + e, p[2] + e]);
      return vnorm([a - b - c + d2, -a - b + c + d2, -a + b - c + d2]);
    }
    function ao(p, n) {
      var occ = 0, sca = 1;
      for (var i = 0; i < 4; i++) {
        var hh = 1.8 + 3.4 * i;
        var d = fieldMap([p[0] + n[0] * hh, p[1] + n[1] * hh, p[2] + n[2] * hh]);
        occ += (hh - d) * sca;
        sca *= 0.72;
      }
      return clamp(1 - 0.055 * occ, 0.5, 1);
    }
    /* The shadow ray is the most expensive thing in the frame: thirty field
     * evaluations per lit pixel. Two cheap cuts take most of that away - a
     * surface turned away from the light is in shadow without a single
     * sample, and the ray only has to travel as far as the shadow actually
     * reaches. */
    function shadowAt(p, n) {
      if (n[0] * L[0] + n[1] * L[1] + n[2] * L[2] <= 0) return 0;
      var res = 1, tt = 0.9;
      for (var i = 0; i < 18; i++) {
        var d = fieldMap([p[0] + L[0] * tt, p[1] + L[1] * tt, p[2] + L[2] * tt]);
        if (d < 0.03) return 0;
        res = Math.min(res, 11 * d / tt);
        tt += clamp(d, 0.45, 6);
        if (tt > 170) break;
      }
      return clamp(res, 0, 1);
    }

    var shellCol = hex2rgb((enc.style && enc.style.color) || '#f4c542');
    var paint = (enc.style && enc.style.paint) || [];
    var partCols = field.parts.map(function (p) { return hex2rgb(p.color); });
    var gz = o.ground == null ? -0.02 : o.ground;
    var noAO = !!o.noAO, noShadow = !!o.noShadow;

    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var px = (2 * (x + 0.5) / w - 1) * tanH * (w / h);
        var py = (1 - 2 * (y + 0.5) / h) * tanH;
        var rd = vnorm([
          fwd[0] + right[0] * px + up[0] * py,
          fwd[1] + right[1] * px + up[1] * py,
          fwd[2] + right[2] * px + up[2] * py
        ]);
        var bgt = clamp(0.5 + rd[2] * 0.5, 0, 1);
        var col = [mix(0.955, 0.855, bgt), mix(0.962, 0.895, bgt), mix(0.975, 0.945, bgt)];

        var tHit = -1, isGround = false;
        if (rd[2] < -1e-6) {
          var tg = (gz - ro[2]) / rd[2];
          if (tg > 0 && tg < 2600) { tHit = tg; isGround = true; }
        }
        var ts = march(rd);
        if (ts > 0 && (tHit < 0 || ts < tHit)) { tHit = ts; isGround = false; }

        if (tHit > 0) {
          var p = [ro[0] + rd[0] * tHit, ro[1] + rd[1] * tHit, ro[2] + rd[2] * tHit];
          if (isGround) {
            var shg = noShadow ? 1 : shadowAt([p[0], p[1], gz + 0.05], [0, 0, 1]);
            var fade = clamp(1 - hyp(p[0] - field.W / 2, p[1] - field.D / 2) / 250, 0, 1);
            var gg = 0.9 - 0.2 * (1 - shg);
            col = [mix(gg, 0.9, 1 - fade), mix(gg, 0.905, 1 - fade), mix(gg * 1.004, 0.915, 1 - fade)];
          } else {
            var n = normalAt(p);
            var id = field.matAt(p);
            var base = id === 0 ? shellCol : (partCols[(id - 1) % partCols.length] || hex2rgb('#64748b'));
            if (id === 0) {
              for (var pi = 0; pi < paint.length; pi++) {
                var pr = paint[pi], hit = false;
                if (pr.box) {
                  var bb = pr.box;
                  hit = p[0] >= bb[0] && p[1] >= bb[1] && p[2] >= bb[2] && p[0] <= bb[3] && p[1] <= bb[4] && p[2] <= bb[5];
                } else if (pr.cyl) {
                  /* A disc on a wall: [x, z, r, y0, y1]. A round opening needs a
                   * round recess - painting a box around it draws a rectangle
                   * on the face and the hole stops looking like a hole. */
                  var cy = pr.cyl;
                  var ddx = p[0] - cy[0], ddz = p[2] - cy[1];
                  hit = ddx * ddx + ddz * ddz <= cy[2] * cy[2] && p[1] >= cy[3] && p[1] <= cy[4];
                } else if (pr.sphere) {
                  var q2 = pr.sphere;
                  hit = hypot3(p[0] - q2[0], p[1] - q2[1], p[2] - q2[2]) < q2[3];
                }
                if (hit) { base = hex2rgb(pr.color); break; }
              }
            }
            var aoV = noAO ? 1 : ao(p, n);
            var diff = Math.max(dot(n, L), 0);
            var sh = noShadow ? 1 : shadowAt([p[0] + n[0] * 1.7, p[1] + n[1] * 1.7, p[2] + n[2] * 1.7], n);
            var sky = 0.26 + 0.22 * clamp(n[2] * 0.5 + 0.5, 0, 1);
            var fres = Math.pow(1 - Math.max(dot(n, [-rd[0], -rd[1], -rd[2]]), 0), 3.4);
            var spec = Math.pow(Math.max(dot(n, vnorm(sub(L, rd))), 0), 46) * 0.5;
            var k = (sky + 1.5 * diff * sh) * aoV * 1.12;
            col = [base[0] * k + spec + fres * 0.18, base[1] * k + spec + fres * 0.19, base[2] * k + spec + fres * 0.22];
          }
        }
        for (var ci = 0; ci < 3; ci++) {
          var vv = col[ci];
          vv = vv / (1 + vv * 0.12);
          vv = Math.pow(clamp(vv, 0, 1), 1 / 2.2);
          buf[(y * w + x) * 4 + ci] = Math.round(clamp(vv, 0, 1) * 255);
        }
        buf[(y * w + x) * 4 + 3] = 255;
      }
    }
    return buf;
  }

  /* Draws into a real <canvas>. `res` below 1 renders fewer rays and lets the
   * 2D context upscale - four times cheaper for almost the same picture. */
  function paint(canvas, enc, dia, opts) {
    var o = opts || {};
    var m = model(enc, dia);
    m.sdf.setShowParts(!!o.cut);
    var w = Math.max(120, Math.round(o.width || 720));
    var h = Math.max(90, Math.round(o.height || 460));
    var res = clamp(o.res == null ? 1 : o.res, 0.25, 1);
    var rw = Math.max(80, Math.round(w * res)), rh = Math.max(60, Math.round(h * res));
    canvas.width = w; canvas.height = h;
    var ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx || !ctx.createImageData) return { stats: m.stats, problems: m.problems, warns: m.warns };
    var img = ctx.createImageData(rw, rh);
    paintInto(m.sdf, enc, o, rw, rh, img.data);
    if (rw === w && rh === h) {
      ctx.putImageData(img, 0, 0);
    } else {
      var up = ctx.createImageData(w, h);
      // Nearest-neighbour-ish upscale in JS: the canvas API for drawImage is
      // not available on every stub, and this keeps paint() testable.
      var d = img.data, u = up.data;
      for (var y = 0; y < h; y++) {
        var sy = Math.min(rh - 1, Math.floor(y * rh / h));
        for (var x = 0; x < w; x++) {
          var sx = Math.min(rw - 1, Math.floor(x * rw / w));
          var si = (sy * rw + sx) * 4, di = (y * w + x) * 4;
          u[di] = d[si]; u[di + 1] = d[si + 1]; u[di + 2] = d[si + 2]; u[di + 3] = 255;
        }
      }
      ctx.putImageData(up, 0, 0);
    }
    return { stats: m.stats, problems: m.problems, warns: m.warns };
  }

  /* Wireframe fallback: bounding boxes, holes and the parting line. Not
   * pretty, but honest, and it needs no 2D context so a test can assert that
   * the geometry agrees with the layout. */
  /* The numbers the viewer prints under the picture: size, solid volume and
   * triangle count. None of them belong to the *check* - that does not mesh -
   * so they are derived here, once, at a coarse step. A true-to-the-micron
   * volume is not what a page needs; a figure within a percent is. */
  function summaryStats(m) {
    var f = m.sdf, st = {}, k;
    for (k in m.stats) st[k] = m.stats[k];
    st.bbox = [f.W, f.D, f.topZ];
    /* Volume by sampling the field, not by summing the mesh. A coarse mesh
     * whose head shell comes out open integrates to nonsense (it read 37 cm3
     * against a true 64), and "almost right" is worse than obviously coarse on
     * a page that also claims the part is printable. Sixty thousand point
     * tests are exact to a fraction of a percent and cost a blink. */
    try {
      /* Sample a box padded past the nominal outline: the bill overhangs the
       * front wall and the tail the back, and a box that stops at W x D would
       * quietly leave both out of the total. */
      var x0 = -12, x1 = f.W + 8, y0 = -22, y1 = f.D + 16, z0 = -2, z1 = f.topZ + 2;
      var n = 70000, hit = 0, seed = 0x2545F491;
      function rnd() { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; }
      for (var i = 0; i < n; i++) {
        if (f.map([x0 + rnd() * (x1 - x0), y0 + rnd() * (y1 - y0), z0 + rnd() * (z1 - z0)]) < 0) hit++;
      }
      st.volume = (x1 - x0) * (y1 - y0) * (z1 - z0) * hit / n;
    } catch (e) { st.volume = null; }
    try {
      var bb = [-2, -2, -2, f.W + 2, f.D + 2, f.topZ + 2], step = 3.0;
      var b = mesh(f.baseMap, bb, step), tris = b.tris.length;
      if (f.hasHead) tris += mesh(f.headMap, bb, step).tris.length;
      st.tris = tris;
    } catch (e) { st.tris = null; }
    return st;
  }

  function render(enc, dia, opts) {
    var o = opts || {};
    var m = model(enc, dia);
    var f = m.sdf;
    var W = Math.max(240, o.width || 720), H = Math.max(160, o.height || 460);
    var st = summaryStats(m);
    /* A shaded picture, not a wireframe. The same SDF that the printer
     * consumes is raymarched into a raster here and embedded as a data-URL
     * image, so what the page shows is the surface the slicer will see -
     * perspective, occlusion, soft shadows, real depth. There is no painter's
     * algorithm to sort and no triangle to draw "behind" a wall it is in front
     * of. When there is no real canvas (Node, a stub), fall through to the
     * wireframe so the page still renders something honest. */
    try {
      if (typeof document !== 'undefined' && document.createElement) {
        var cv = document.createElement('canvas');
        paint(cv, enc, dia, { width: W, height: H, cut: !!o.cut, res: o.res == null ? 0.6 : o.res });
        var dataUrl = cv.toDataURL && cv.toDataURL('image/png');
        if (dataUrl && dataUrl.length > 64) {
          return {
            svg: '<svg class="enc-svg" viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="enclosure preview">'
              + '<image x="0" y="0" width="' + W + '" height="' + H + '" href="' + dataUrl + '" preserveAspectRatio="xMidYMid meet"/></svg>',
            stats: st, problems: m.problems, warns: m.warns, model: m
          };
        }
      }
    } catch (e) { /* wireframe below */ }
    var yaw = (o.yaw == null ? -36 : o.yaw) * Math.PI / 180;
    var pitch = (o.pitch == null ? 18 : o.pitch) * Math.PI / 180;
    var s = Math.min(W / (f.W * 1.9), H / (f.topZ * 1.8));
    var cx = W / 2, cy = H * 0.74;

    function proj(p) {
      var x = p[0] - f.W / 2, y = p[1] - f.D / 2, z = p[2];
      var X = x * Math.cos(yaw) - y * Math.sin(yaw);
      var Y = x * Math.sin(yaw) + y * Math.cos(yaw);
      var Z = z * Math.cos(pitch) - Y * Math.sin(pitch);
      return [cx + X * s, cy - Z * s];
    }

    var out = ['<svg class="enc-svg" viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="enclosure wireframe">'];
    out.push('<rect width="' + W + '" height="' + H + '" fill="#f6f7f9"/>');
    var bb = [[0, 0, 0], [f.W, 0, 0], [f.W, f.D, 0], [0, f.D, 0], [0, 0, f.topZ], [f.W, 0, f.topZ], [f.W, f.D, f.topZ], [0, f.D, f.topZ]];
    [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]].forEach(function (e) {
      var a = proj(bb[e[0]]), b = proj(bb[e[1]]);
      out.push('<line x1="' + a[0].toFixed(1) + '" y1="' + a[1].toFixed(1) + '" x2="' + b[0].toFixed(1) + '" y2="' + b[1].toFixed(1) + '" stroke="#b8c0cc" stroke-width="1"/>');
    });
    if (f.hasHead) {
      var zc = proj([0, 0, f.zDiv]), zd = proj([f.W, f.D, f.zDiv]);
      out.push('<line x1="' + zc[0].toFixed(1) + '" y1="' + zc[1].toFixed(1) + '" x2="' + zd[0].toFixed(1) + '" y2="' + zd[1].toFixed(1) + '" stroke="#f59e0b" stroke-width="1.2" stroke-dasharray="5 4"/>');
    }
    m.parts.forEach(function (p) {
      var b = p.box;
      var pts = [[b.x0, b.y0, b.z0], [b.x1, b.y0, b.z0], [b.x1, b.y1, b.z0], [b.x0, b.y1, b.z0],
        [b.x0, b.y0, b.z1], [b.x1, b.y0, b.z1], [b.x1, b.y1, b.z1], [b.x0, b.y1, b.z1]].map(proj);
      for (var i = 0; i < 8; i++) for (var j = i + 1; j < 8; j++) {
        out.push('<line x1="' + pts[i][0].toFixed(1) + '" y1="' + pts[i][1].toFixed(1) + '" x2="' + pts[j][0].toFixed(1) + '" y2="' + pts[j][1].toFixed(1) + '" stroke="' + p.color + '" stroke-opacity="0.3" stroke-width="1"/>');
      }
    });
    out.push('</svg>');
    return { svg: out.join(''), stats: st, problems: m.problems, warns: m.warns, model: m };
  }

  /* ------------------------------------------------------------------ *
   * 9. Isosurface -> STL
   *
   * Marching tetrahedra rather than marching cubes: six cases instead of 256,
   * every case is a triangle fan, and the surface is closed by construction as
   * long as vertices are welded on a shared grid - which `vert` does by
   * quantising the key. Hand-writing 256 cases is how a mesh ends up with one
   * cell nobody tested, and the slicer is the one that finds it.
   * ------------------------------------------------------------------ */
  /* The Kuhn (Freudenthal) split of a cube into six tetrahedra: every one of
   * them hangs off the body diagonal 0-7, and every face of the cube is cut
   * by the same diagonal from the neighbouring cell's point of view. That
   * last part is the whole reason this list is what it is.
   *
   * Get it wrong and the six tetrahedra stop tiling the cube - they overlap
   * in one place and leave a gap in another - and the mesh comes out with a
   * hole in every cell. A shell with 300000 open edges looks solid in a
   * preview and falls apart in a slicer.
   *
   * The corner numbering is x + 2y + 4z, so 0 = (0,0,0) and 7 = (1,1,1)
   * are the opposite corners the diagonal has to join. */
  var TETRA = [[0, 1, 3, 7], [0, 1, 5, 7], [0, 2, 3, 7], [0, 2, 6, 7], [0, 4, 5, 7], [0, 4, 6, 7]];

  /* Find the smallest box that fully contains the solid. A mesh is only
   * watertight if the bounding box holds the whole shape: if a leg pokes out
   * the bottom or a tail out the back, the cut edge is an open boundary the
   * slicer cannot close. The caller passes a *hint* (often the enclosure
   * outline, which does not know about overhanging feet), so we scan coarsely
   * and grow the box in any direction the solid reaches, until nothing touches
   * an edge. */
  function solidAABB(fieldFn, hint, step) {
    var bb = hint.slice();
    var cs = Math.max(step * 1.5, 2.0);
    var margin = Math.max(20, step * 4);   // enough to catch an overhang
    for (var iter = 0; iter < 8; iter++) {
      var nx = Math.ceil((bb[3] - bb[0]) / cs) + 1;
      var ny = Math.ceil((bb[4] - bb[1]) / cs) + 1;
      var nz = Math.ceil((bb[5] - bb[2]) / cs) + 1;
      var found = false, touched = false;
      var mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
      var i, j, k;
      for (k = 0; k < nz; k++) {
        var pz = bb[2] + k * cs;
        for (j = 0; j < ny; j++) {
          var py = bb[1] + j * cs;
          for (i = 0; i < nx; i++) {
            var px = bb[0] + i * cs;
            if (fieldFn([px, py, pz]) < 0) {
              found = true;
              if (px < mn[0]) mn[0] = px; if (py < mn[1]) mn[1] = py; if (pz < mn[2]) mn[2] = pz;
              if (px > mx[0]) mx[0] = px; if (py > mx[1]) mx[1] = py; if (pz > mx[2]) mx[2] = pz;
              if (i === 0 || j === 0 || k === 0 || i === nx - 1 || j === ny - 1 || k === nz - 1) touched = true;
            }
          }
        }
      }
      if (!found) return null;
      if (!touched) {
        var pad = step * 1.5 + 0.5;
        return [mn[0] - pad, mn[1] - pad, mn[2] - pad, mx[0] + pad, mx[1] + pad, mx[2] + pad];
      }
      // solid reached the scan edge: grow the box and look again
      if (mn[0] <= bb[0] + cs * 0.5) bb[0] -= margin;
      if (mx[0] >= bb[3] - cs * 0.5) bb[3] += margin;
      if (mn[1] <= bb[1] + cs * 0.5) bb[1] -= margin;
      if (mx[1] >= bb[4] - cs * 0.5) bb[4] += margin;
      if (mn[2] <= bb[2] + cs * 0.5) bb[2] -= margin;
      if (mx[2] >= bb[5] - cs * 0.5) bb[5] += margin;
    }
    var pad = step * 1.5 + 0.5;
    return [bb[0], bb[1], bb[2], bb[3], bb[4], bb[5]];
  }

  function mesh(fieldFn, bbox, step) {
    var aabb = solidAABB(fieldFn, bbox, step);
    if (!aabb) return { pts: [], tris: [] };
    bbox = aabb;
    var nx = Math.ceil((bbox[3] - bbox[0]) / step) + 1;
    var ny = Math.ceil((bbox[4] - bbox[1]) / step) + 1;
    var nz = Math.ceil((bbox[5] - bbox[2]) / step) + 1;
    var grid = new Float32Array(nx * ny * nz);
    var i, j, k;
    /* A grid point that lands exactly on the surface is the one thing the
     * marching cannot survive. On a flat wall the whole layer of points
     * sits on the wall at once; on a curved surface a single point sits on
     * it while the surface fans out of it. Either way the cells around it
     * cannot agree where the surface goes, and every one of them leaks.
     *
     * So the point moves. The field is a distance, so its gradient is the
     * outward normal: stepping a hair along it takes the point off the
     * surface and leaves it on the outside. On a flat wall every point of
     * the layer steps the same way, so the wall stays a wall - the layer
     * just sits a hair outside it. On a curve the point steps clear of the
     * cone and the fan closes up. Either way the surface stops passing
     * exactly through a sample point, and the mesh stops leaking.
     *
     * The step is a nanometre: far enough to break the tie, far too small
     * to move the surface. */
    var EPS = 1e-7;
    var NUDGE = 1e-3;   // 1 um: enough to separate the vertices, far too
                        // little to move the surface anyone can see
    var gx = new Float32Array(nx * ny * nz * 3);
    for (k = 0; k < nz; k++) {
      for (j = 0; j < ny; j++) {
        for (i = 0; i < nx; i++) {
          var px = bbox[0] + i * step, py = bbox[1] + j * step, pz = bbox[2] + k * step;
          var gi = (k * ny + j) * nx + i;
          var val = fieldFn([px, py, pz]);
          if (val > -EPS && val < EPS) {
            var e = step * 0.02;
            var gx1 = fieldFn([px + e, py, pz]) - fieldFn([px - e, py, pz]);
            var gy1 = fieldFn([px, py + e, pz]) - fieldFn([px, py - e, pz]);
            var gz1 = fieldFn([px, py, pz + e]) - fieldFn([px, py, pz - e]);
            var gl = Math.sqrt(gx1 * gx1 + gy1 * gy1 + gz1 * gz1);
            if (gl > 1e-9) {
              // Step out along the normal. The step has to be bigger than
              // the weld resolution (0.1 um), or every crossing point around
              // this one lands on the same vertex, the triangles around it
              // collapse to nothing and the cell leaves a hole.
              var step2 = NUDGE / gl;
              px += gx1 * step2; py += gy1 * step2; pz += gz1 * step2;
              val = fieldFn([px, py, pz]);
            }
            if (val > -EPS && val < EPS) val = EPS;
          }
          gx[gi * 3] = px; gx[gi * 3 + 1] = py; gx[gi * 3 + 2] = pz;
          grid[gi] = val;
        }
      }
    }
    var pts = [], tris = [], index = {};
    var Q = 1e4;   // weld at 0.1 µm: far below any feature, above float noise
    function vert(a, b, va, vb) {
      var t = Math.abs(va - vb) < 1e-12 ? 0.5 : va / (va - vb);
      var x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t, z = a[2] + (b[2] - a[2]) * t;
      var key = Math.round(x * Q) + ',' + Math.round(y * Q) + ',' + Math.round(z * Q);
      if (index[key] != null) return index[key];
      index[key] = pts.length;
      pts.push([x, y, z]);
      return pts.length - 1;
    }
    /* Every triangle is wound so its normal points out of the solid. The six
     * tetrahedra do not all have the same handedness, so the order the
     * vertices arrive in is not enough - a shell with half its normals
     * pointing inwards is a shell a slicer refuses. `ref` is a point on the
     * inside, so the normal has to point away from it. */
    function normalOf(a, b, c) {
      var A = pts[a], B = pts[b], C = pts[c];
      var ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2];
      var vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
      return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    }
    function away(n, cx, cy, cz, ref) {
      return n[0] * (cx - ref[0]) + n[1] * (cy - ref[1]) + n[2] * (cz - ref[2]);
    }
    /* A triangle with no area at all is not a triangle. It appears where
     * two of the crossing points land on the very same vertex, and it
     * carries an edge from a vertex to itself - the only kind of edge a
     * watertight mesh may not have. A triangle that is merely *thin* is
     * kept: it covers real surface, and dropping it would open a hole. */
    function pushTri(a, b, c) {
      var A = pts[a], B = pts[b], C = pts[c];
      var ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2];
      var vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
      var cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      if (cx === 0 && cy === 0 && cz === 0) return;
      tris.push([a, b, c]);
    }
    for (k = 0; k < nz - 1; k++) {
      for (j = 0; j < ny - 1; j++) {
        for (i = 0; i < nx - 1; i++) {
          var v = [], c = [], m2;
          for (m2 = 0; m2 < 8; m2++) {
            var dx = m2 & 1, dy = (m2 >> 1) & 1, dz = (m2 >> 2) & 1;
            var gi2 = ((k + dz) * ny + (j + dy)) * nx + (i + dx);
            v[m2] = grid[gi2];
            // the corner is where the field was sampled, jitter and all
            c[m2] = [gx[gi2 * 3], gx[gi2 * 3 + 1], gx[gi2 * 3 + 2]];
          }
          var neg = 0, pos = 0;
          for (m2 = 0; m2 < 8; m2++) { if (v[m2] < 0) neg++; else pos++; }
          if (!neg || !pos) continue;
          for (var ti = 0; ti < 6; ti++) {
            var T = TETRA[ti], inside = [], outside = [];
            for (var q2 = 0; q2 < 4; q2++) (v[T[q2]] < 0 ? inside : outside).push(T[q2]);
            if (!inside.length || !outside.length) continue;
            if (inside.length === 1 || outside.length === 1) {
              var one = inside.length === 1 ? inside[0] : outside[0];
              var rest = inside.length === 1 ? outside : inside;
              var t0 = vert(c[one], c[rest[0]], v[one], v[rest[0]]);
              var t1 = vert(c[one], c[rest[1]], v[one], v[rest[1]]);
              var t2 = vert(c[one], c[rest[2]], v[one], v[rest[2]]);
              // reference point inside the solid: the lone inside corner, or
              // the middle of the three inside corners
              var ref;
              if (inside.length === 1) ref = c[one];
              else ref = [(c[rest[0]][0] + c[rest[1]][0] + c[rest[2]][0]) / 3,
                (c[rest[0]][1] + c[rest[1]][1] + c[rest[2]][1]) / 3,
                (c[rest[0]][2] + c[rest[1]][2] + c[rest[2]][2]) / 3];
              var A = pts[t0], B = pts[t1], Cc = pts[t2];
              var cx = (A[0] + B[0] + Cc[0]) / 3, cy = (A[1] + B[1] + Cc[1]) / 3, cz = (A[2] + B[2] + Cc[2]) / 3;
              if (away(normalOf(t0, t1, t2), cx, cy, cz, ref) < 0) pushTri(t0, t2, t1);
              else pushTri(t0, t1, t2);
            } else {
              var p0 = inside[0], p1 = inside[1], n0 = outside[0], n1 = outside[1];
              var b0 = vert(c[p0], c[n0], v[p0], v[n0]);
              var b1 = vert(c[p0], c[n1], v[p0], v[n1]);
              var b2 = vert(c[p1], c[n1], v[p1], v[n1]);
              var b3 = vert(c[p1], c[n0], v[p1], v[n0]);
              // The quad is triangulated as a fan, so both halves have to be
              // wound the same way round or the shared diagonal ends up
              // pointing the same way in both and the mesh leaks.
              var mid = [(c[p0][0] + c[p1][0]) / 2, (c[p0][1] + c[p1][1]) / 2, (c[p0][2] + c[p1][2]) / 2];
              var q = [(pts[b0][0] + pts[b1][0] + pts[b2][0] + pts[b3][0]) / 4,
                (pts[b0][1] + pts[b1][1] + pts[b2][1] + pts[b3][1]) / 4,
                (pts[b0][2] + pts[b1][2] + pts[b2][2] + pts[b3][2]) / 4];
              if (away(normalOf(b0, b1, b3), q[0], q[1], q[2], mid) < 0) { pushTri(b0, b3, b2); pushTri(b0, b2, b1); }
              else { pushTri(b0, b1, b2); pushTri(b0, b2, b3); }
            }
          }
        }
      }
    }
    return { pts: pts, tris: tris };
  }

  function volumeOf(m) {
    var v = 0, P = m.pts, T = m.tris;
    for (var i = 0; i < T.length; i++) {
      var a = P[T[i][0]], b = P[T[i][1]], c = P[T[i][2]];
      v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    }
    return Math.abs(v);
  }

  /* Watertight means: every directed edge has exactly one opposite twin. Not
   * "looks solid from here" - one missing triangle is one hole the slicer will
   * fill with a guess. */
  function openEdges(m) {
    var seen = {}, open = 0, k;
    for (var i = 0; i < m.tris.length; i++) {
      var t = m.tris[i];
      for (var e = 0; e < 3; e++) {
        var a = t[e], b = t[(e + 1) % 3];
        var ka = a + '>' + b, kb = b + '>' + a;
        if (seen[kb]) seen[kb]--;
        else seen[ka] = (seen[ka] || 0) + 1;
      }
    }
    for (k in seen) if (seen[k] > 0) open += seen[k];
    return open;
  }

  /* Print layout: base at the origin, head turned over and parked beside it,
   * so one job prints both and neither needs supports under a dome. */
  function stl(enc, dia, opts) {
    var o = opts || {};
    var m = model(enc, dia);
    var f = m.sdf;
    var step = o.step || 1.0;
    var bb = [-2, -2, -2, f.W + 2, f.D + 2, f.topZ + 2];

    var shells = [{ name: 'base', mesh: mesh(f.baseMap, bb, step), flip: false }];
    if (f.hasHead) {
      shells.push({ name: 'head', mesh: mesh(f.headMap, bb, step), flip: true });
    }

    var gap = o.gap == null ? 10 : o.gap;
    var offsetX = 0, total = 0;
    shells.forEach(function (s) {
      var minX = 1e9, maxX = -1e9, minY = 1e9;
      s.mesh.pts.forEach(function (p) {
        if (p[0] < minX) minX = p[0];
        if (p[0] > maxX) maxX = p[0];
        if (p[1] < minY) minY = p[1];
      });
      s.dx = -minX + offsetX;
      s.dy = -minY;
      offsetX += (maxX - minX) + gap;
      total += s.mesh.tris.length;
    });

    var buf = new ArrayBuffer(84 + total * 50);
    var dv = new DataView(buf);
    for (var i = 0; i < 80; i++) dv.setUint8(i, 0);
    dv.setUint32(80, total, true);
    var off = 84;
    shells.forEach(function (s) {
      var P = s.mesh.pts, T = s.mesh.tris;
      for (var ti = 0; ti < T.length; ti++) {
        var tri = [P[T[ti][0]], P[T[ti][1]], P[T[ti][2]]];
        if (s.flip) {
          // Turn the head over so its opening faces the bed, and swap two
          // vertices to keep the winding - a flipped normal confuses slicers
          // far more than a flipped shape does.
          var tz = f.topZ, tmp;
          tri = tri.map(function (p) { return [p[0], p[1], tz - p[2]]; });
          tmp = tri[1]; tri[1] = tri[2]; tri[2] = tmp;
        }
        var a = [tri[0][0] + s.dx, tri[0][1] + s.dy, tri[0][2]];
        var b = [tri[1][0] + s.dx, tri[1][1] + s.dy, tri[1][2]];
        var c = [tri[2][0] + s.dx, tri[2][1] + s.dy, tri[2][2]];
        var ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
        var vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
        var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        var nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        dv.setFloat32(off, nx / nl, true);
        dv.setFloat32(off + 4, ny / nl, true);
        dv.setFloat32(off + 8, nz / nl, true);
        off += 12;
        var vv = [a, b, c];
        for (var q = 0; q < 3; q++) {
          dv.setFloat32(off, vv[q][0], true);
          dv.setFloat32(off + 4, vv[q][1], true);
          dv.setFloat32(off + 8, vv[q][2], true);
          off += 12;
        }
        dv.setUint16(off, 0, true);
        off += 2;
      }
    });
    return { data: new Uint8Array(buf), stats: { tris: total, shells: shells.length, step: step } };
  }

  return {
    VERSION: VERSION,
    DIM: DIM,
    defaults: defaults,
    init: init,
    merge: merge,
    model: model,
    build: model,
    check: function (enc, dia) { var m = model(enc, dia); return { problems: m.problems, warns: m.warns, stats: m.stats }; },
    paint: paint,
    render: render,
    stl: stl,
    resolveParts: resolveParts,
    hex2rgb: hex2rgb,
    mesh: mesh,
    volumeOf: volumeOf,
    openEdges: openEdges
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Enclosure;
