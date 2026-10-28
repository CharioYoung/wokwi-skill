/**
 * enclosure.js - build a printable enclosure for a Wokwi project.
 *
 * Why this exists:
 *   A circuit that runs in the simulator still has no body. The gap between
 *   "the LED blinks" and "I can put it on a shelf" is a box that holds the
 *   parts at the right distance, opens where the connectors are, and prints
 *   without supports. That box is geometry, and geometry can be generated
 *   from the same part list the circuit already has.
 *
 * The one thing this file cannot do:
 *   diagram.json is a SCHEMATIC canvas - its coordinates are layout hints,
 *   not millimetres. Nothing in it says how big a servo is. So the physical
 *   layout lives in a second file, enclosure.json, and the value of this
 *   module is that it CHECKS the two against each other: every part present,
 *   nothing interpenetrating, every port reachable, walls printable. A box
 *   that is 5 mm too small is a failed print, not a cosmetic bug.
 *
 * Public API:
 *   Enclosure.build(enc, dia)   -> model { shells, parts, problems, warns, stats }
 *   Enclosure.check(enc, dia)   -> { problems, warns, stats }
 *   Enclosure.render(enc, dia, opts) -> { svg, stats, problems }
 *   Enclosure.stl(model)        -> Uint8Array (binary STL, millimetres)
 *   Enclosure.init(dia)         -> a draft enclosure.json for that circuit
 *
 * Coordinates: millimetres, x right, y back, z up. The base sits on z = 0 so
 * the model drops straight onto a print bed.
 */
var Enclosure = (function () {
  'use strict';

  var VERSION = '1.0.0';

  /* ------------------------------------------------------------------ *
   * 1. Real dimensions
   *
   * These are measured part sizes, not Wokwi's drawing sizes. They are the
   * one place in this repo where a number can be wrong in a way that wastes
   * filament, so:
   *   - each entry is the part's bounding box [width, depth, height] in mm,
   *     including the tallest thing that sticks out (servo horn excluded,
   *     because the horn is what pokes through the lid);
   *   - a port is a hole that must exist in the shell, given as a rectangle
   *     on one face in local coordinates with the box origin at its min
   *     corner: face '-y' / '+y' -> (x, z), '-x' / '+x' -> (y, z),
   *     '+z' -> (x, y);
   *   - "round" ports are circles inscribed in that rectangle.
   *
   * If a caliper disagrees with a number here, the caliper wins: edit this
   * table. check_enclosure prints every assumed size for exactly that reason.
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

  /* Anything not in the table still has to fit somewhere, so it gets a box
   * and a loud warning rather than a silent 0x0. */
  var UNKNOWN_SIZE = [12, 12, 12];

  /* ------------------------------------------------------------------ *
   * 2. Small vector / 2D helpers
   * ------------------------------------------------------------------ */
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function vlen(a) { return Math.sqrt(dot(a, a)); }
  function vnorm(a) { var l = vlen(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

  function area2(a, b, c) { return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); }

  function polyArea(p) {
    var s = 0;
    for (var i = 0; i < p.length; i++) {
      var j = (i + 1) % p.length;
      s += p[i][0] * p[j][1] - p[j][0] * p[i][1];
    }
    return s / 2;
  }

  function pointInTri(p, a, b, c) {
    var d1 = area2(a, b, p), d2 = area2(b, c, p), d3 = area2(c, a, p);
    var neg = d1 < -1e-9 || d2 < -1e-9 || d3 < -1e-9;
    var pos = d1 > 1e-9 || d2 > 1e-9 || d3 > 1e-9;
    return !(neg && pos);
  }

  function pointInPoly(p, poly) {
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var a = poly[i], b = poly[j];
      if ((a[1] > p[1]) !== (b[1] > p[1]) &&
          p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  }

  function samePt(a, b) {
    return Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7;
  }

  /* Proper crossing only: segments that merely share an endpoint are a
   * junction, not a block, and treating them as one makes every candidate
   * bridge look invisible. */
  function segCross(a, b, c, d) {
    if (samePt(a, c) || samePt(a, d) || samePt(b, c) || samePt(b, d)) return false;
    var d1 = area2(c, d, a), d2 = area2(c, d, b), d3 = area2(a, b, c), d4 = area2(a, b, d);
    return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
  }

  /* ------------------------------------------------------------------ *
   * 2b. Strips: the actual triangulator
   *
   * Every face this module builds is "axis-aligned rectangle minus convex
   * holes", and that shape has a decomposition with no bridge, no slit and no
   * ear to miss:
   *
   *   cut the rectangle into horizontal bands at every hole vertex y.
   *   Inside one band a convex hole crosses as a straight segment, so the
   *   material is a set of trapezoids and each one is two triangles.
   *
   * The bridge-and-earclip path below still exists for faces whose outline is
   * not a rectangle (the circular ring on top of a screw post), but it is the
   * fallback, not the workhorse: weaving four round holes into one outline
   * with slits produced a face that closed edge to edge while covering 1192
   * of its 7680 mm2 twice. Closure alone cannot see that; the area audit in
   * cap() can.
   * ------------------------------------------------------------------ */
  function rectOf(loop) {
    if (loop.length !== 4) return null;
    var x0 = Math.min(loop[0][0], loop[1][0], loop[2][0], loop[3][0]);
    var x1 = Math.max(loop[0][0], loop[1][0], loop[2][0], loop[3][0]);
    var y0 = Math.min(loop[0][1], loop[1][1], loop[2][1], loop[3][1]);
    var y1 = Math.max(loop[0][1], loop[1][1], loop[2][1], loop[3][1]);
    for (var i = 0; i < 4; i++) {
      var onX = Math.abs(loop[i][0] - x0) < 1e-9 || Math.abs(loop[i][0] - x1) < 1e-9;
      var onY = Math.abs(loop[i][1] - y0) < 1e-9 || Math.abs(loop[i][1] - y1) < 1e-9;
      if (!onX || !onY) return null;
    }
    return [x0, y0, x1, y1];
  }

  /* Vertical tolerance for "this vertex sits on the band boundary".
   *
   * Round loops come out of cos/sin, so two congruent holes 57 mm apart can
   * land their topmost vertex 7e-15 mm apart. The band list keeps one of the
   * two values; the other hole is then a hair ABOVE its own band boundary, no
   * edge crosses that line, and the band reports "no hole here" and fills
   * straight across the top of the hole. The result is a 0.3 mm2 sliver of
   * plastic over the opening - and, because the caps on both faces do it
   * identically while the tube still follows the true vertices, a seam that
   * never closes. Snapping the vertex onto the boundary is what makes the
   * strip decomposition stable for round holes. */
  var Y_EPS = 1e-7;

  /* Where a convex loop crosses the horizontal line y: [left, right]. */
  function spanAt(loop, y) {
    var lo = Infinity, hi = -Infinity;
    for (var i = 0; i < loop.length; i++) {
      var a = loop[i], b = loop[(i + 1) % loop.length];
      var ay = Math.abs(a[1] - y) <= Y_EPS ? y : a[1];
      var by = Math.abs(b[1] - y) <= Y_EPS ? y : b[1];
      if ((ay - y) * (by - y) > 0) continue;
      if (ay === by) {                       /* horizontal edge, level with y */
        lo = Math.min(lo, a[0], b[0]);
        hi = Math.max(hi, a[0], b[0]);
        continue;
      }
      var t = (y - ay) / (by - ay);
      if (t < -1e-9 || t > 1 + 1e-9) continue;
      var x = a[0] + (b[0] - a[0]) * t;
      if (x < lo) lo = x;
      if (x > hi) hi = x;
    }
    return lo === Infinity ? null : [lo, hi];
  }

  function stripTri(outer, holes) {
    var r = rectOf(outer);
    if (!r) return null;
    var x0 = r[0], y0 = r[1], x1 = r[2], y1 = r[3];
    var ys = [y0, y1], i, j;
    for (i = 0; i < holes.length; i++) {
      for (j = 0; j < holes[i].length; j++) {
        var v = holes[i][j][1];
        if (v > y0 + 1e-9 && v < y1 - 1e-9) ys.push(v);
      }
    }
    ys.sort(function (a, b) { return a - b; });
    var uniq = [];
    for (i = 0; i < ys.length; i++) {
      if (!uniq.length || ys[i] - uniq[uniq.length - 1] > 1e-9) uniq.push(ys[i]);
    }

    var tris = [];
    function tri2(pa, pb, pc) {
      var a = area2(pa, pb, pc);
      if (Math.abs(a) < 1e-9) return;
      if (a < 0) tris.push([pa, pc, pb]);
      else tris.push([pa, pb, pc]);
    }
    function quad(pa, pb, pc, pd) {
      tri2(pa, pb, pc);
      tri2(pa, pc, pd);
    }

    for (var b = 0; b + 1 < uniq.length; b++) {
      var ya = uniq[b], yb = uniq[b + 1];
      if (yb - ya < 1e-9) continue;
      var ym = (ya + yb) / 2;
      var live = [];
      for (i = 0; i < holes.length; i++) {
        var mid = spanAt(holes[i], ym);
        if (!mid) continue;
        var sa = spanAt(holes[i], ya), sb = spanAt(holes[i], yb);
        if (!sa || !sb) continue;
        live.push({ a: sa, b: sb, m: mid });
      }
      live.sort(function (p, q) { return p.m[0] - q.m[0]; });
      var curA = x0, curB = x0;
      for (i = 0; i < live.length; i++) {
        var la = Math.max(x0, Math.min(x1, live[i].a[0]));
        var lb = Math.max(x0, Math.min(x1, live[i].b[0]));
        if (la > curA + 1e-9 || lb > curB + 1e-9) quad([curA, ya], [la, ya], [lb, yb], [curB, yb]);
        curA = Math.max(curA, Math.min(x1, live[i].a[1]));
        curB = Math.max(curB, Math.min(x1, live[i].b[1]));
      }
      if (x1 > curA + 1e-9 || x1 > curB + 1e-9) quad([curA, ya], [x1, ya], [x1, yb], [curB, yb]);
    }
    return tris;
  }

  /* ------------------------------------------------------------------ *
   * 3. Triangulating a face with holes
   *
   * Every cap in this model is "rectangle minus zero or more cutouts".
   * Ear clipping alone only eats simple polygons, so each hole is first
   * stitched into the outline with a bridge - a zero-area slit from a hole
   * vertex to a visible outer vertex. The result is one simple polygon, and
   * the bridge's two coincident edges are internal, so the cap stays closed.
   *
   * If the stitching or the clipping ever drops a region, the shell will
   * have an unmatched edge and the closure check fails loudly - which is
   * why this is safe to keep simple instead of clever.
   * ------------------------------------------------------------------ */
  /* A bridge is usable when it stays in the material the whole way: it must
   * cross no edge, and it must not cut through any hole. The second half is
   * not a nicety - a hole sitting on the diagonal to the chosen corner makes
   * the bridge run along its own boundary, which produces a zero-width slit
   * that ear clipping emits as a degenerate triangle. That failed on a grid
   * of vent slots before this check existed. */
  function visibleFrom(poly, holes, p, q) {
    var s, t, mid, h, loop, j;
    for (s = 1; s <= 8; s++) {
      t = s / 9;
      mid = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
      if (!pointInPoly(mid, poly)) return false;
      for (h = 0; h < holes.length; h++) {
        if (pointInPoly(mid, holes[h])) return false;
      }
    }
    for (var i = 0; i < poly.length; i++) {
      if (segCross(p, q, poly[i], poly[(i + 1) % poly.length])) return false;
    }
    for (h = 0; h < holes.length; h++) {
      loop = holes[h];
      for (j = 0; j < loop.length; j++) {
        if (segCross(p, q, loop[j], loop[(j + 1) % loop.length])) return false;
      }
    }
    return true;
  }

  var stitchFail = 0;
  var capFail = 0;
  var failNote = [];

  /* A hole loop is not always a rectangle - a round port is a 24-gon, and
   * reading its bounding x off vertices 0 and 2 puts it in the wrong place in
   * the right-to-left order. That is not cosmetic: weaving two holes in the
   * wrong order makes the outline cross itself, and the face then double
   * covers a patch while still closing edge to edge. */
  function maxX(loop) {
    var m = -Infinity;
    for (var i = 0; i < loop.length; i++) if (loop[i][0] > m) m = loop[i][0];
    return m;
  }

  function stitch(outer, holes) {
    var poly = outer.slice();
    /* Bridges always land on the OUTER outline, never on another hole's
     * vertex. Two holes joined by a bridge look fine on paper and produce a
     * polygon whose slit is traversed twice through a third hole's corner;
     * ear clipping then drops a sliver, and the shell quietly stops being
     * closed. A face with nine openings (the duck's front wall) is exactly
     * where that showed up. */
    var onOuter = [];
    for (var oi = 0; oi < outer.length; oi++) onOuter.push(outer[oi]);

    /* Right to left, because a bridge always runs toward +x: handling the
     * rightmost hole first means later bridges travel over ground that is
     * already stitched, which is the ordering the classic algorithm assumes. */
    var order = holes.slice().sort(function (a, b) { return maxX(b) - maxX(a); });

    for (var h = 0; h < order.length; h++) {
      var hole = order[h].slice();
      if (polyArea(hole) > 0) hole.reverse();          // holes run clockwise
      var hi = 0;
      for (var i = 1; i < hole.length; i++) if (hole[i][0] > hole[hi][0] + 1e-9) hi = i;
      var p = hole[hi];
      var best = -1, bestD = Infinity;
      /* Prefer a vertex of the outer outline, fall back to any vertex of the
       * welded polygon. The fallback is what makes a face with a dozen
       * openings work at all; past roughly a dozen the outline turns into a
       * maze and no bridge stays in the material - that is reported, not
       * guessed at. */
      for (var pass = 0; pass < 2 && best < 0; pass++) {
        for (var k = 0; k < poly.length; k++) {
          var q = poly[k];
          if (pass === 0 && onOuter.indexOf(q) < 0) continue;
          var d = (q[0] - p[0]) * (q[0] - p[0]) + (q[1] - p[1]) * (q[1] - p[1]);
          if (d < bestD && visibleFrom(poly, holes, p, q)) { best = k; bestD = d; }
        }
      }
      if (best < 0) { stitchFail++; continue; }        // closure check will catch the fallout too
      var rot = hole.slice(hi).concat(hole.slice(0, hi));
      /* Walk: ... q -> p, around the hole, p -> q, then carry on after q.
       * Writing q twice, or dropping the return edge, leaves a zero-length
       * edge and a degenerate triangle - which ear clipping happily emits and
       * the closure check then reports as three orphans. */
      var out = [];
      for (var a1 = 0; a1 <= best; a1++) out.push(poly[a1]);
      for (var a2 = 0; a2 < rot.length; a2++) out.push(rot[a2]);
      out.push(rot[0]);
      out.push(poly[best]);
      for (var a3 = best + 1; a3 < poly.length; a3++) out.push(poly[a3]);
      poly = out;
    }
    return poly;
  }

  var earFail = 0;

  function earclip(poly) {
    var pts = poly.slice();
    if (polyArea(pts) < 0) pts.reverse();
    var tris = [], guard = 0;
    while (pts.length > 3 && guard++ < 40000) {
      var n = pts.length, done = false;
      for (var k = 0; k < n; k++) {
        var a = pts[(k + n - 1) % n], b = pts[k], c = pts[(k + 1) % n];
        if (area2(a, b, c) <= 1e-9) continue;
        var clean = true;
        for (var m = 0; m < n; m++) {
          var p = pts[m];
          /* Compare by POSITION, not by identity: a bridge re-pushes two
           * vertices, so the same corner appears twice in the list. An ear
           * next to the slit then looks blocked by its own twin, no ear is
           * ever found, and the fallback below starts emitting triangles that
           * cover ground already covered - a face that closes edge to edge
           * while claiming 30% more area than it has. */
          if (p === a || p === b || p === c) continue;
          if (samePt(p, a) || samePt(p, b) || samePt(p, c)) continue;
          if (pointInTri(p, a, b, c)) { clean = false; break; }
        }
        if (!clean) continue;
        tris.push([a, b, c]);
        pts.splice(k, 1);
        done = true;
        break;
      }
      if (done) continue;
      /* No ear found: numerical trouble. Clip the most convex corner rather
       * than spin forever; a slightly thin triangle beats an infinite loop.
       * It is counted, because it is the one path that can produce a
       * self-overlapping face. */
      earFail++;
      var bi = 0, bv = -Infinity;
      for (var j = 0; j < n; j++) {
        var v = area2(pts[(j + n - 1) % n], pts[j], pts[(j + 1) % n]);
        if (v > bv) { bv = v; bi = j; }
      }
      tris.push([pts[(bi + n - 1) % n], pts[bi], pts[(bi + 1) % n]]);
      pts.splice(bi, 1);
    }
    if (pts.length === 3) tris.push(pts.slice());
    return tris;
  }

  /* ------------------------------------------------------------------ *
   * 4. Shells
   *
   * A shell is one closed manifold: a triangle soup whose every directed
   * edge is matched by exactly one opposite edge. Two shells may overlap by
   * a fraction of a millimetre where they must join (a boss into the floor);
   * they are never merged, because merging needs a CSG kernel and this ships
   * as a single file with no dependencies. Slicers union overlapping volumes.
   * ------------------------------------------------------------------ */
  function shell(name, color, kind) {
    return { name: name, color: color, kind: kind || 'solid', tris: [] };
  }

  function tri(sh, a, b, c) {
    var n = cross(sub(b, a), sub(c, a));
    if (vlen(n) < 1e-7) return;                        // degenerate
    sh.tris.push([a, b, c]);
  }

  /* cap(): fill a planar face described in its own 2D coordinates.
   * map([u,v]) -> [x,y,z] puts the face in the world; `flip` reverses the
   * winding when the face points the other way. */
  function cap(sh, map, outer, holes, flip) {
    var tris = holes && holes.length ? stripTri(outer, holes) : earclip(outer);
    if (!tris) tris = earclip(stitch(outer, holes));

    /* Area audit. A face whose triangles cover less - or twice - the area it
     * should is a face that will not print, and the picture cannot show it:
     * the extra triangles are coplanar, so they shade identically. Every
     * triangle here is planar, so the comparison is exact up to rounding. */
    var want = Math.abs(polyArea(outer));
    if (holes) for (var h = 0; h < holes.length; h++) want -= Math.abs(polyArea(holes[h]));
    var got = 0;
    for (var g = 0; g < tris.length; g++) got += Math.abs(area2(tris[g][0], tris[g][1], tris[g][2])) / 2;
    if (want > 1e-6 && Math.abs(got - want) > Math.max(0.5, want * 0.002)) {
      capFail++;
      failNote.push(sh.name + ': 面积 ' + got.toFixed(1) + ' ≠ ' + want.toFixed(1) + ' mm²');
    }

    for (var i = 0; i < tris.length; i++) {
      var t = tris[i];
      var p0 = map(t[0]), p1 = map(t[1]), p2 = map(t[2]);
      if (flip) tri(sh, p0, p2, p1); else tri(sh, p0, p1, p2);
    }
  }

  /* A through-hole is a tube: same loop on two parallel planes. */
  function tube(sh, mapA, mapB, loop, flip) {
    for (var i = 0; i < loop.length; i++) {
      var j = (i + 1) % loop.length;
      var a0 = mapA(loop[i]), a1 = mapA(loop[j]);
      var b0 = mapB(loop[i]), b1 = mapB(loop[j]);
      if (flip) { tri(sh, a0, b1, a1); tri(sh, a0, b0, b1); }
      else { tri(sh, a0, a1, b1); tri(sh, a0, b1, b0); }
    }
  }

  function mkRect(a0, b0, a1, b1) {
    return [[a0, b0], [a1, b0], [a1, b1], [a0, b1]];
  }

  function mkCircle(a0, b0, a1, b1, seg) {
    var cu = (a0 + a1) / 2, cv = (b0 + b1) / 2;
    var r = Math.min(Math.abs(a1 - a0), Math.abs(b1 - b0)) / 2;
    var n = seg || 20, out = [];
    for (var i = 0; i < n; i++) {
      var th = (i / n) * Math.PI * 2;
      out.push([cu + Math.cos(th) * r, cv + Math.sin(th) * r]);
    }
    return out;
  }

  /* hole = { loop, aabb:[a0,b0,a1,b1], face } in wall-local 2D */
  function holeFrom(spec, margin) {
    var m = margin == null ? 0.4 : margin;
    var a0 = Math.min(spec[0], spec[2]) - m, a1 = Math.max(spec[0], spec[2]) + m;
    var b0 = Math.min(spec[1], spec[3]) - m, b1 = Math.max(spec[1], spec[3]) + m;
    var loop = spec.round ? mkCircle(a0, b0, a1, b1) : mkRect(a0, b0, a1, b1);
    return { loop: loop, aabb: [a0, b0, a1, b1] };
  }

  function holesOf(list) {
    return (list || []).map(function (h) { return h.loop; });
  }

  /* ------------------------------------------------------------------ *
   * 5. The cup: one function builds the base and the lid
   *
   * Both are the same solid with the opening on opposite ends, so they share
   * one builder. That matters: a lid whose lip did not match the base's
   * cavity, because the two were written by hand, is the most common way a
   * printed enclosure fails to close.
   * ------------------------------------------------------------------ */
  function cup(o) {
    var W = o.W, D = o.D, H = o.H, t = o.t, f = o.f;
    var openUp = o.open === '+z';
    var sh = shell(o.name, o.color, o.kind);

    var cav0 = openUp ? f : 0;
    var cav1 = openUp ? H : H - f;
    var rectOuter = mkRect(0, 0, W, D);
    var rectCav = mkRect(t, t, W - t, D - t);

    /* the closed end */
    var bottomHoles = holesOf(cav0 === f ? o.holes.bottom : null);
    if (openUp) {
      cap(sh, function (p) { return [p[0], p[1], 0]; }, rectOuter, holesOf(o.holes.bottom), true);
    } else {
      cap(sh, function (p) { return [p[0], p[1], H]; }, rectOuter, holesOf(o.holes.top), false);
    }

    /* the open end: a frame, outer rect minus cavity */
    var rimZ = openUp ? H : 0;
    cap(sh, function (p) { return [p[0], p[1], rimZ]; }, rectOuter, [rectCav], !openUp);

    /* four side walls: outer face, inner face, tubes through the holes */
    var walls = [
      { key: 'front', outer: function (p) { return [p[0], 0, p[1]]; },
        inner: function (p) { return [p[0], t, p[1]]; }, span: [W, H], oflip: false },
      { key: 'back', outer: function (p) { return [p[0], D, p[1]]; },
        inner: function (p) { return [p[0], D - t, p[1]]; }, span: [W, H], oflip: true },
      { key: 'left', outer: function (p) { return [0, p[0], p[1]]; },
        inner: function (p) { return [t, p[0], p[1]]; }, span: [D, H], oflip: true },
      { key: 'right', outer: function (p) { return [W, p[0], p[1]]; },
        inner: function (p) { return [W - t, p[0], p[1]]; }, span: [D, H], oflip: false }
    ];

    for (var wi = 0; wi < walls.length; wi++) {
      var w = walls[wi];
      var rect = mkRect(0, 0, w.span[0], w.span[1]);
      var holes = o.holes[w.key] || [];
      cap(sh, w.outer, rect, holesOf(holes), w.oflip);
      /* The inner face is the cavity wall, so it spans the cavity - not the
         full outer width. Spanning the full width would leave a surface
         buried inside the corner material, and its edges would match nothing
         (which is exactly how the closure check found this). */
      cap(sh, w.inner, mkRect(t, cav0, w.span[0] - t, cav1), holesOf(holes), !w.oflip);
      for (var hi = 0; hi < holes.length; hi++) {
        tube(sh, w.outer, w.inner, holes[hi].loop, w.oflip);
      }
    }

    /* the inner floor / ceiling */
    if (openUp) {
      cap(sh, function (p) { return [p[0], p[1], f]; }, rectCav, holesOf(o.holes.bottom), false);
      for (var bi = 0; bi < (o.holes.bottom || []).length; bi++) {
        tube(sh, function (p) { return [p[0], p[1], 0]; },
             function (p) { return [p[0], p[1], f]; }, o.holes.bottom[bi].loop, true);
      }
    } else {
      cap(sh, function (p) { return [p[0], p[1], H - f]; }, rectCav, holesOf(o.holes.top), true);
      for (var ti = 0; ti < (o.holes.top || []).length; ti++) {
        tube(sh, function (p) { return [p[0], p[1], H]; },
             function (p) { return [p[0], p[1], H - f]; }, o.holes.top[ti].loop, false);
      }
    }
    return sh;
  }

  /* A screw post: a closed tube standing on the floor. Overlaps the floor by
   * 0.3 mm on purpose - two coplanar faces are worse for a slicer than a
   * deliberate overlap.
   *
   * The overlap has to go INTO the floor, not below it. Starting at z = -0.3
   * put a 0.3 mm foot under every post, so the whole part rested on four small
   * discs with the real floor hanging in the air - a print that comes off the
   * bed or warps, and the sort of thing that only shows up on the printer. */
  function boss(b, floor) {
    var sh = shell('boss', b.color || '#94a3b8', 'boss');
    var z0 = (floor == null ? 0 : floor) - 0.3, z1 = b.h;
    var outer = mkCircle(b.at[0] - b.d / 2, b.at[1] - b.d / 2, b.at[0] + b.d / 2, b.at[1] + b.d / 2, 24);
    var inner = mkCircle(b.at[0] - b.hole / 2, b.at[1] - b.hole / 2,
                         b.at[0] + b.hole / 2, b.at[1] + b.hole / 2, 24);
    var at0 = function (p) { return [p[0], p[1], z0]; };
    var at1 = function (p) { return [p[0], p[1], z1]; };
    cap(sh, at1, outer, [inner], false);
    cap(sh, at0, outer, [inner], true);
    tube(sh, at1, at0, outer, true);
    tube(sh, at1, at0, inner, false);
    return sh;
  }

  /* A shelf: a plate growing out of one wall, for a part that has to look
   * out of that wall but cannot stand on the floor.
   *
   * The sonar is the case that forces this. A HC-SR04 sees sideways, so it
   * must sit against the front wall - but its beam has to clear the floor and
   * the board, which puts it 28 mm up in the air. Without a shelf the only
   * way to draw it there is to let it float, and a model that floats is a
   * model that cannot be assembled. The shelf is four numbers (where it
   * starts, how big, what height) and it turns "drawn in the right place" into
   * "held in the right place".
   *
   * Like a boss it is its own closed box, sunk 0.3 mm into the wall it grows
   * from, so no two faces are coplanar. */
  function shelfShell(s, enc) {
    var t = enc.base.wall, W = enc.base.w, D = enc.base.d, H = enc.base.h;
    var thick = s.thick == null ? 2.4 : s.thick;
    var x0 = s.at[0], y0 = s.at[1], x1 = x0 + s.size[0], y1 = y0 + s.size[1];
    var z1 = s.z, z0 = z1 - thick;
    var bites = [];
    if (x0 <= t + 1) { x0 = t - 0.3; bites.push('left'); }
    if (x1 >= W - t - 1) { x1 = W - t + 0.3; bites.push('right'); }
    if (y0 <= t + 1) { y0 = t - 0.3; bites.push('front'); }
    if (y1 >= D - t - 1) { y1 = D - t + 0.3; bites.push('back'); }
    var sh = shell(s.id || 'shelf', s.color || enc.style.accent || enc.style.color, 'shelf');
    var tris = boxTris({ x0: x0, y0: y0, z0: z0, x1: x1, y1: y1, z1: z1 });
    for (var i = 0; i < tris.length; i++) tri(sh, tris[i][0], tris[i][1], tris[i][2]);
    sh.meta = { z1: z1, z0: z0, x0: x0, x1: x1, y0: y0, y1: y1, bites: bites };
    return sh;
  }

  /* ------------------------------------------------------------------ *
   * 6. Layout: diagram.json + enclosure.json -> world-space parts
   * ------------------------------------------------------------------ */
  /* A rotation is either a number (degrees about z) or "x90" / "y-90" /
   * "z180". Only multiples of 90 are allowed: anything else turns a box into
   * an oriented box, and every check in this file is an AABB test. Keeping
   * the rotation axis-aligned is what lets a 5 mm LED point at the front of
   * the duck without the fit maths falling apart. */
  function rotAxis(rot) {
    if (typeof rot === 'number') return ['z', ((rot % 360) + 360) % 360];
    var m = /^([xyz])\s*(-?\d+)$/.exec(String(rot == null ? '0' : rot).trim());
    if (!m) return ['z', 0];
    return [m[1], ((parseInt(m[2], 10) % 360) + 360) % 360];
  }

  function rotMat(rot) {
    var ax = rotAxis(rot), a = ax[1] * Math.PI / 180;
    var c = Math.round(Math.cos(a)), s = Math.round(Math.sin(a));
    if (ax[0] === 'x') return [[1, 0, 0], [0, c, -s], [0, s, c]];
    if (ax[0] === 'y') return [[c, 0, s], [0, 1, 0], [-s, 0, c]];
    return [[c, -s, 0], [s, c, 0], [0, 0, 1]];
  }

  function applyM(m, p) {
    return [m[0][0] * p[0] + m[0][1] * p[1] + m[0][2] * p[2],
            m[1][0] * p[0] + m[1][1] * p[1] + m[1][2] * p[2],
            m[2][0] * p[0] + m[2][1] * p[1] + m[2][2] * p[2]];
  }

  /* extent of the rotated box: exact, because cos/sin are rounded to 0/±1 */
  function rotSize(size, m) {
    var c = [size[0] / 2, size[1] / 2, size[2] / 2], out = [0, 0, 0];
    for (var sx = -1; sx <= 1; sx += 2) {
      for (var sy = -1; sy <= 1; sy += 2) {
        for (var sz = -1; sz <= 1; sz += 2) {
          var q = applyM(m, [sx * c[0], sy * c[1], sz * c[2]]);
          for (var i = 0; i < 3; i++) out[i] = Math.max(out[i], Math.abs(q[i]));
        }
      }
    }
    return [out[0] * 2, out[1] * 2, out[2] * 2];
  }

  /* rotate about the box centre, then re-anchor so the min corner is (0,0,0) */
  function placeLocal(p, size, m) {
    var c = [size[0] / 2, size[1] / 2, size[2] / 2];
    var ext = rotSize(size, m);
    var q = applyM(m, [p[0] - c[0], p[1] - c[1], p[2] - c[2]]);
    return [q[0] + ext[0] / 2, q[1] + ext[1] / 2, q[2] + ext[2] / 2];
  }

  function resolveParts(enc, dia) {
    var byId = {};
    (dia.parts || []).forEach(function (p) { byId[p.id] = p; });

    var out = [];
    (enc.parts || []).forEach(function (place) {
      var src = byId[place.id];
      var dim = src ? DIM[src.type] : null;
      var size = dim ? dim.size.slice() : UNKNOWN_SIZE.slice();
      if (place.size) size = place.size.slice();          // a caliper override
      var m = rotMat(place.rot);
      var ext = rotSize(size, m);
      var at = place.at || [0, 0, 0];
      var box = {
        x0: at[0], y0: at[1], z0: at[2],
        x1: at[0] + ext[0], y1: at[1] + ext[1], z1: at[2] + ext[2]
      };
      var part = {
        id: place.id, type: src ? src.type : '(not in diagram.json)',
        known: !!dim, color: (dim && dim.color) || '#94a3b8',
        box: box, at: at, size: ext, rot: place.rot || 0, ports: []
      };
      if (dim) {
        (dim.ports || []).forEach(function (port) {
          part.ports.push(resolvePort(port, box, size, m, place));
        });
      }
      out.push(part);
    });
    return out;
  }

  /* Reduce a port to "which wall, and where on it":
   *   a/b   the two in-plane axes, in that wall's own 2D frame
   *   plane the coordinate of the face it sits on
   * so the cutout step never has to think in 3D again. */
  function resolvePort(port, box, size, m, place) {
    var corners = faceCorners(port.face, port.rect, size).map(function (p) {
      var q = placeLocal(p, size, m);
      return [q[0] + box.x0, q[1] + box.y0, q[2] + box.z0];
    });
    var n = rotNormal(port.face, m);
    var xs = corners.map(function (p) { return p[0]; });
    var ys = corners.map(function (p) { return p[1]; });
    var zs = corners.map(function (p) { return p[2]; });
    var rng = function (arr) { return [Math.min.apply(null, arr), Math.max.apply(null, arr)]; };
    var xr = rng(xs), yr = rng(ys), zr = rng(zs);
    var a, b, plane;
    if (n === '-y') { a = xr; b = zr; plane = yr[0]; }
    else if (n === '+y') { a = xr; b = zr; plane = yr[1]; }
    else if (n === '-x') { a = yr; b = zr; plane = xr[0]; }
    else if (n === '+x') { a = yr; b = zr; plane = xr[1]; }
    else if (n === '+z') { a = xr; b = yr; plane = zr[1]; }
    else { a = xr; b = yr; plane = zr[0]; }
    return {
      id: port.id, face: n, a: a, b: b, plane: plane, round: !!port.round,
      /* `expose:false` means "this opening is not needed" - a button under a
       * thin wall, a horn inside the box. The layout may still want it. */
      expose: port.expose === false ? false : true
    };
  }

  function faceCorners(face, r, size) {
    var u0 = Math.min(r[0], r[2]), u1 = Math.max(r[0], r[2]);
    var v0 = Math.min(r[1], r[3]), v1 = Math.max(r[1], r[3]);
    function at(u, v) {
      if (face === '-y') return [u, 0, v];
      if (face === '+y') return [u, size[1], v];
      if (face === '-x') return [0, u, v];
      if (face === '+x') return [size[0], u, v];
      if (face === '+z') return [u, v, size[2]];
      return [u, v, 0];
    }
    return [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)];
  }

  function rotNormal(face, m) {
    var v = { '-y': [0, -1, 0], '+y': [0, 1, 0], '-x': [-1, 0, 0], '+x': [1, 0, 0],
              '+z': [0, 0, 1], '-z': [0, 0, -1] }[face];
    if (!v) return face;
    var q = applyM(m, v);
    if (Math.abs(q[0]) > 0.5) return q[0] > 0 ? '+x' : '-x';
    if (Math.abs(q[1]) > 0.5) return q[1] > 0 ? '+y' : '-y';
    return q[2] > 0 ? '+z' : '-z';
  }

  /* ------------------------------------------------------------------ *
   * 7. Defaults and draft layout
   * ------------------------------------------------------------------ */
  function defaults() {
    return {
      printer: { bed: [220, 220], layer: 0.2, minWall: 0.8 },
      base: { w: 90, d: 70, h: 40, wall: 2.4, floor: 2.0, fit: 0.4 },
      lid: { on: true, thick: 2.4, lip: 3.0, lipWall: 2.0, vents: 0 },
      style: { color: '#f4c542', accent: '#f59e0b', label: '' },
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
    function copy(o) { for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) out[k] = o[k]; }
    copy(base);
    if (!given) return out;
    for (var k in given) {
      if (!Object.prototype.hasOwnProperty.call(given, k)) continue;
      var v = given[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) {
        var m = {};
        for (var kk in out[k]) m[kk] = out[k][kk];
        for (var kk2 in v) m[kk2] = v[kk2];
        out[k] = m;
      } else out[k] = v;
    }
    return out;
  }

  /* A draft layout: parts in a row along the back, as far from each other as
   * their sizes allow. It is not a good design - it is a starting point that
   * already passes the fit checks, so the assistant edits numbers instead of
   * inventing them. */
  function init(dia) {
    var enc = defaults();
    var x = enc.base.wall + 2, y = enc.base.wall + 2, rowH = 0;
    var w = enc.base.w;
    enc.parts = (dia.parts || []).map(function (p) {
      var dim = DIM[p.type];
      var size = dim ? dim.size : UNKNOWN_SIZE;
      if (x + size[0] > w - enc.base.wall - 2) { x = enc.base.wall + 2; y += rowH + 3; rowH = 0; }
      var at = [Math.round(x * 10) / 10, Math.round(y * 10) / 10, enc.base.floor + 0.5];
      x += size[0] + 3;
      rowH = Math.max(rowH, size[1]);
      return { id: p.id, at: at, rot: 0 };
    });
    return enc;
  }

  /* ------------------------------------------------------------------ *
   * 8. Cutouts: what the ports demand, plus what the designer asked for
   *
   * The default is "cut where the part needs to see the world". A designer
   * who wants an LED to glow through 1.2 mm of plastic sets expose:false and
   * the hole disappears - and the access check stops complaining, because the
   * requirement moved from geometry to intent.
   * ------------------------------------------------------------------ */
  function mkHole(a0, b0, a1, b1, round, margin) {
    var m = margin == null ? 0.4 : margin;
    var lo0 = Math.min(a0, a1) - m, lo1 = Math.max(a0, a1) + m;
    var hi0 = Math.min(b0, b1) - m, hi1 = Math.max(b0, b1) + m;
    return {
      loop: round ? mkCircle(lo0, hi0, lo1, hi1) : mkRect(lo0, hi0, lo1, hi1),
      aabb: [lo0, hi0, lo1, hi1],
      round: !!round
    };
  }

  var FACE_KEY = { '-y': 'front', '+y': 'back', '-x': 'left', '+x': 'right', '+z': 'top', '-z': 'bottom' };
  var FACE_LIST = ['front', 'back', 'left', 'right', 'top', 'bottom'];

  function autoCutouts(parts, cfg) {
    var W = cfg.base.w, D = cfg.base.d, H = cfg.base.h, t = cfg.base.wall, f = cfg.base.floor;
    var reach = cfg.reach == null ? 8 : cfg.reach;
    var m = cfg.margin == null ? 0.4 : cfg.margin;
    var out = { front: [], back: [], left: [], right: [], top: [], bottom: [] };
    var gaps = [];

    parts.forEach(function (p) {
      p.ports.forEach(function (port) {
        if (!port.expose) return;
        var wall = FACE_KEY[port.face];
        if (!wall) return;
        /* How far the opening is from the wall it has to pierce. A USB socket
           buried 20 mm inside the box is not "close enough": the plug cannot
           reach it, so the hole would be decoration. */
        var gap = {
          '-y': p.box.y0 - t, '+y': (D - t) - p.box.y1,
          '-x': p.box.x0 - t, '+x': (W - t) - p.box.x1,
          '+z': H - p.box.z1, '-z': p.box.z0 - f
        }[port.face];
        /* How much of the part's own face the opening covers. This is what
         * separates "an LED pressed into a 5 mm hole" from "a 28x55 board
         * whose USB socket happens to line up with a hole": both report the
         * same gap, but only the first one holds the part up. */
        var faceArea = 0;
        if (port.face === '-y' || port.face === '+y') faceArea = (p.box.x1 - p.box.x0) * (p.box.z1 - p.box.z0);
        else if (port.face === '-x' || port.face === '+x') faceArea = (p.box.y1 - p.box.y0) * (p.box.z1 - p.box.z0);
        else faceArea = (p.box.x1 - p.box.x0) * (p.box.y1 - p.box.y0);
        var holeArea = Math.abs(port.a[1] - port.a[0]) * Math.abs(port.b[1] - port.b[0]);
        var rec = {
          part: p.id, port: port.id, face: port.face, gap: Math.round(gap * 10) / 10,
          grip: faceArea > 1e-9 ? Math.min(1, Math.round(holeArea / faceArea * 100) / 100) : 0
        };
        gaps.push(rec);
        if (gap > reach) { rec.blocked = true; return; }
        var h = mkHole(port.a[0], port.b[0], port.a[1], port.b[1], port.round, m);
        h.owner = p.id + ':' + port.id;
        out[wall].push(h);
      });
    });
    return { holes: out, gaps: gaps };
  }

  function userCutouts(list, cfg) {
    var out = { front: [], back: [], left: [], right: [], top: [], bottom: [] };
    (list || []).forEach(function (c, i) {
      var face = FACE_KEY[c.face];
      if (!face) return;
      var h = mkHole(c.rect[0], c.rect[1], c.rect[2], c.rect[3], c.round,
                     c.margin == null ? (cfg.margin || 0.4) : c.margin);
      h.owner = c.id || ('cutout#' + (i + 1));
      out[face].push(h);
    });
    return out;
  }

  function mergeHoles(a, b) {
    var out = {};
    FACE_LIST.forEach(function (k) { out[k] = (a[k] || []).concat(b[k] || []); });
    return out;
  }

  /* ------------------------------------------------------------------ *
   * 9. The model
   * ------------------------------------------------------------------ */
  function move(sh, dx, dy, dz) {
    for (var i = 0; i < sh.tris.length; i++) {
      for (var k = 0; k < 3; k++) {
        var p = sh.tris[i][k];
        sh.tris[i][k] = [p[0] + dx, p[1] + dy, p[2] + dz];
      }
    }
  }

  function volume(sh) {
    var v = 0;
    for (var i = 0; i < sh.tris.length; i++) {
      var t = sh.tris[i];
      v += dot(t[0], cross(t[1], t[2])) / 6;
    }
    return v;
  }

  function model(encGiven, dia) {
    var enc = merge(defaults(), encGiven);
    stitchFail = 0;
    capFail = 0;
    failNote = [];
    /* A post exists to reach the lid, so its top defaults to the deck height:
       the common case needs no number, and `h` stays available for a stub. */
    enc.bosses = (enc.bosses || []).map(function (b, i) {
      var o = {};
      for (var k in b) if (Object.prototype.hasOwnProperty.call(b, k)) o[k] = b[k];
      if (o.d == null) o.d = 6.5;
      if (o.hole == null) o.hole = 3.2;
      if (o.h == null) o.h = enc.base.h;
      o.id = o.id || ('boss#' + (i + 1));
      return o;
    });
    var parts = resolveParts(enc, dia || { parts: [] });
    var auto = autoCutouts(parts, enc);
    var holes = mergeHoles(auto.holes, userCutouts(enc.cutouts, enc));

    var W = enc.base.w, D = enc.base.d, H = enc.base.h;
    var t = enc.base.wall, f = enc.base.floor;
    var shells = [];

    shells.push(cup({
      W: W, D: D, H: H, t: t, f: f, open: '+z',
      holes: { bottom: holes.bottom, front: holes.front, back: holes.back,
               left: holes.left, right: holes.right, top: [] },
      name: 'base', color: enc.style.color, kind: 'base'
    }));

    /* Screw posts hold the lid on, so the lid needs a clearance hole in the
     * same place. Punching it here - instead of asking the designer to keep
     * two lists in sync - is what makes "bosses" a feature rather than a
     * decorative cylinder: the bore in the post and the hole in the lid are
     * derived from the same coordinate. */
    (enc.bosses || []).forEach(function (b, i) {
      if (!enc.lid.on) return;
      var r = (b.hole == null ? 3.2 : b.hole) / 2 + 0.2;
      var h = mkHole(b.at[0] - r, b.at[1] - r, b.at[0] + r, b.at[1] + r, true, 0);
      h.owner = 'boss#' + (i + 1);
      holes.top.push(h);
    });

    var lidH = 0;
    if (enc.lid.on) {
      lidH = enc.lid.thick + enc.lid.lip;
      var lid = cup({
        W: W, D: D, H: lidH, t: enc.lid.lipWall, f: enc.lid.thick, open: '-z',
        holes: { top: holes.top, bottom: [], front: [], back: [], left: [], right: [] },
        name: 'lid', color: enc.style.accent || enc.style.color, kind: 'lid'
      });
      move(lid, 0, 0, H);
      shells.push(lid);
    }

    (enc.bosses || []).forEach(function (b, i) {
      var s = boss(b, f);
      s.name = 'boss#' + (i + 1);
      shells.push(s);
    });

    var shelves = [];
    (enc.shelves || []).forEach(function (cfg, i) {
      if (!cfg.size || cfg.size.length < 2) {
        problems.push({ k: 'shelf', msg: '第 ' + (i + 1) + ' 个层板缺少 size:[宽, 深]，没法建' });
        return;
      }
      var sh = shelfShell(cfg, enc);
      sh.name = cfg.id || ('shelf#' + (i + 1));
      shelves.push(sh);
      shells.push(sh);
    });

    /* The strip triangulator cuts a face's border at every hole height, so a
     * wall next to it has a vertex sitting mid-edge. Weld those before
     * measuring anything, otherwise the closure check reports the seam - and
     * a slicer would too. */
    shells.forEach(function (s) {
      for (var pass = 0; pass < 12; pass++) if (!weldTJunctions(s)) break;
    });

    /* A shell built inside-out has the right shape and the wrong normals,
     * which reads as a black model. Flip by signed volume instead of auditing
     * every cap by hand. */
    shells.forEach(function (s) {
      if (volume(s) < 0) s.tris.forEach(function (tr) { var tmp = tr[1]; tr[1] = tr[2]; tr[2] = tmp; });
    });

    var stats = {
      shells: shells.length, tris: 0, volume: 0, closed: true,
      bbox: [W, D, H + lidH], lid: !!enc.lid.on
    };
    shells.forEach(function (s) { stats.tris += s.tris.length; stats.volume += volume(s); });

    var problems = [], warns = [];
    if (stitchFail) {
      problems.push({ k: 'mesh',
        msg: '有 ' + stitchFail + ' 个开口没能接进面板的三角化：同一面上开口太多，桥接线找不到不穿孔的落点。' +
             '把相邻开口合并成一条长槽，或把它们分到不同面上——闭合检查也会同时报错，不要带着它去打印' });
    }
    if (capFail) {
      problems.push({ k: 'mesh',
        msg: '有 ' + capFail + ' 个面三角化后的面积对不上它应有的面积（' + failNote.slice(0, 3).join('；') +
             '）—— 面会重叠或漏空，打印出来是破的' });
    }
    checkParts(enc, dia || { parts: [] }, parts, problems, warns);
    checkBosses(enc, parts, problems, warns);
    checkShelves(enc, shelves, parts, problems, warns);
    /* checkHoles() is what marks each port as `cut`, and "gripped by a hole"
     * is one of the four ways a part stays put - so support has to be decided
     * AFTER the holes are resolved, or every panel-mounted part looks like it
     * is floating. */
    checkHoles(holes, enc, auto.gaps, problems, warns);
    checkSupport(enc, parts, shelves, auto.gaps, problems, warns);
    checkMesh(shells, stats, problems);
    checkPrint(enc, holes, stats, problems, warns);

    return { enc: enc, parts: parts, holes: holes, gaps: auto.gaps,
             shelves: shelves, shells: shells,
             problems: problems, warns: warns, stats: stats };
  }

  /* ------------------------------------------------------------------ *
   * 10. Checks
   *
   * Every one of these corresponds to a way a printed enclosure actually
   * fails: a part with no room, two parts in the same space, a port facing
   * solid plastic, a face that did not triangulate, a wall thinner than one
   * nozzle pass. None of them is cosmetic.
   * ------------------------------------------------------------------ */
  function checkParts(enc, dia, parts, problems, warns) {
    var inDia = {}, inEnc = {};
    (dia.parts || []).forEach(function (p) { inDia[p.id] = p; });
    (enc.parts || []).forEach(function (p) { inEnc[p.id] = p; });

    Object.keys(inDia).forEach(function (id) {
      if (!inEnc[id]) {
        problems.push({ k: 'missing-part',
          msg: id + ' 在 diagram.json 里，enclosure.json 却没给它留位置 —— 外壳装不进它' });
      }
    });
    Object.keys(inEnc).forEach(function (id) {
      if (!inDia[id]) {
        problems.push({ k: 'stray-part',
          msg: 'enclosure.json 里的 ' + id + ' 在 diagram.json 里不存在（改名了？还是多写了一个？）' });
      }
    });
    parts.forEach(function (p) {
      if (!p.known) {
        warns.push(p.type + ' 不在尺寸表里，按 ' + UNKNOWN_SIZE.join('×') + ' mm 估算 —— 请用卡尺确认后再打印');
      }
    });

    var W = enc.base.w, D = enc.base.d, H = enc.base.h;
    var t = enc.base.wall, f = enc.base.floor, fit = enc.base.fit;
    var lidRoom = enc.lid.on ? enc.lid.lip : 0;

    parts.forEach(function (p) {
      var b = p.box, bad = [];
      if (b.x0 < t + fit - 1e-6) bad.push('左 ' + (t + fit - b.x0).toFixed(1));
      if (b.x1 > W - t - fit + 1e-6) bad.push('右 ' + (b.x1 - (W - t - fit)).toFixed(1));
      if (b.y0 < t + fit - 1e-6) bad.push('前 ' + (t + fit - b.y0).toFixed(1));
      if (b.y1 > D - t - fit + 1e-6) bad.push('后 ' + (b.y1 - (D - t - fit)).toFixed(1));
      if (b.z0 < f - 1e-6) bad.push('底 ' + (f - b.z0).toFixed(1));
      if (b.z1 > H + lidRoom - 1e-6) bad.push('顶 ' + (b.z1 - (H + lidRoom)).toFixed(1));
      if (bad.length) {
        problems.push({ k: 'outside',
          msg: p.id + ' 超出内腔 ' + bad.join(' / ') + ' mm（' + p.size.map(function (n) { return n.toFixed(1); }).join('×') + ' mm）' });
      }
    });

    for (var i = 0; i < parts.length; i++) {
      for (var j = i + 1; j < parts.length; j++) {
        var A = parts[i].box, B = parts[j].box;
        var ox = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0);
        var oy = Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0);
        var oz = Math.min(A.z1, B.z1) - Math.max(A.z0, B.z0);
        if (ox > 0.05 && oy > 0.05 && oz > 0.05) {
          problems.push({ k: 'interfere',
            msg: parts[i].id + ' 和 ' + parts[j].id + ' 占用了同一块空间 ' +
                 [ox, oy, oz].map(function (n) { return n.toFixed(1); }).join('×') + ' mm —— 真机装不进去' });
        }
      }
    }
  }

  /* A shelf holds something up, so it has to be held up itself.
   *
   * Three ways a shelf is wrong, none of which the picture shows:
   *   - it does not touch a wall: it hangs in the air with the part on it
   *   - it pokes through the wall: it is not inside the cavity
   *   - it cuts through a part: the board has to be somewhere else
   * A shelf is also printable only because it grows from a vertical wall; a
   * shelf floating in the middle would need supports, which is a different
   * design, so the wall test is a hard failure and not a warning. */
  function checkShelves(enc, shelves, parts, problems) {
    var W = enc.base.w, D = enc.base.d, H = enc.base.h, t = enc.base.wall, f = enc.base.floor;
    shelves.forEach(function (sh) {
      var m = sh.meta;
      if (!m.bites.length) {
        problems.push({ k: 'shelf',
          msg: sh.name + ' 没有贴着任何一面墙（x ' + m.x0.toFixed(1) + '–' + m.x1.toFixed(1) +
               ' / y ' + m.y0.toFixed(1) + '–' + m.y1.toFixed(1) + '）—— 它会悬在半空，打印时也没有落脚点' });
      }
      if (m.x0 < t - 0.4 || m.x1 > W - t + 0.4 || m.y0 < t - 0.4 || m.y1 > D - t + 0.4) {
        problems.push({ k: 'shelf', msg: sh.name + ' 戳出了内腔，会和侧壁叠在一起' });
      }
      if (m.z0 < f - 1e-6 || m.z1 > H - 1e-6) {
        problems.push({ k: 'shelf', msg: sh.name + ' 的高度 ' + m.z0.toFixed(1) + '–' + m.z1.toFixed(1) +
          ' mm 不在内腔高度 ' + f + '–' + H + ' mm 之内' });
      }
      parts.forEach(function (p) {
        var b = p.box;
        var ox = Math.min(b.x1, m.x1) - Math.max(b.x0, m.x0);
        var oy = Math.min(b.y1, m.y1) - Math.max(b.y0, m.y0);
        var oz = Math.min(b.z1, m.z1) - Math.max(b.z0, m.z0);
        if (ox > 0.05 && oy > 0.05 && oz > 0.05) {
          problems.push({ k: 'shelf',
            msg: sh.name + ' 和 ' + p.id + ' 抢同一块空间（' + [ox, oy, oz].map(function (n) { return n.toFixed(1); }).join('×') +
                 ' mm）—— 层板要么挪高，要么让器件换个位置' });
        }
      });
    });
  }

  /* Is every part actually held?
   *
   * "It is inside the box" is not the same as "it stays where it is". A part
   * floating 3 mm above the floor passes every fit test in this file and still
   * cannot be assembled: it drops the moment the box is turned over. Four
   * things can hold a part, and they are the four things a real build uses:
   *
   *   the floor, a shelf, another part's top face, or a hole in a wall it is
   *   pressed into (an LED in a 5 mm hole does not need a bracket).
   *
   * The test is deliberately loose (0.8 mm of slop, 55% footprint overlap) so
   * that it fires on "drawn in mid-air" and not on "sits 0.2 mm off". */
  function checkSupport(enc, parts, shelves, gaps, problems, warns) {
    var f = enc.base.floor, t = enc.base.wall, W = enc.base.w, D = enc.base.d;
    var SLOP = 0.8;

    function footOverlap(a, b) {
      var ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
      var oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
      if (ox <= 0 || oy <= 0) return 0;
      var fa = (a.x1 - a.x0) * (a.y1 - a.y0);
      return fa > 1e-9 ? (ox * oy) / fa : 0;
    }

    var pressed = {};
    (gaps || []).forEach(function (g) {
      if (!g.cut) return;
      if (g.face === '+z' || g.face === '-z') return;     // floor/lid ports are not wall grips
      /* The opening has to be a fit for the part, not merely aligned with it.
         At 35% of the part's face it is a panel hole the part drops into; a
         USB socket in a 28 mm board is 20%, and a board is not held by a hole. */
      if (g.gap <= 2.0 && g.grip >= 0.35) pressed[g.part] = g;
    });

    parts.forEach(function (p) {
      var b = p.box;
      if (b.z0 <= f + SLOP) return;                       // on the floor
      if (pressed[p.id]) return;                          // gripped by a wall hole

      var held = false;
      shelves.forEach(function (sh) {
        if (held) return;
        if (Math.abs(sh.meta.z1 - b.z0) > SLOP) return;
        if (footOverlap(b, sh.meta) >= 0.55) held = true;
      });
      if (!held) {
        parts.forEach(function (q) {
          if (held || q === p) return;
          var ob = q.box;
          if (Math.abs(ob.z1 - b.z0) > SLOP) return;
          if (footOverlap(b, ob) < 0.55) return;
          /* A part standing on another part is only real if the one below is
             itself supported - otherwise it is two things falling together.
             One level of recursion is enough: the floor always terminates it. */
          held = ob.z0 <= f + SLOP || shelves.some(function (sh) {
            return Math.abs(sh.meta.z1 - ob.z0) <= SLOP && footOverlap(ob, sh.meta) >= 0.55;
          });
        });
      }
      if (!held) {
        problems.push({ k: 'floating',
          msg: p.id + ' 悬空：底面在 z=' + b.z0.toFixed(1) + ' mm，下面既没有底板、也没有层板或别的器件托住 —— ' +
               '装进壳里会掉下来。把它放到底板上，或用 shelves 给它加一块层板' });
      }
    });
  }

  /* A screw post is a promise: "the lid bolts down here". Three ways that
   * promise breaks, all of them invisible in a render:
   *   - the circle leaves the box (it is drawn, and it prints in mid-air)
   *   - it stands inside a part's footprint (the board cannot sit on top of it)
   *   - it stops short of the lid (you cannot put a screw into a gap)
   */
  function checkBosses(enc, parts, problems, warns) {
    var list = enc.bosses || [];
    var W = enc.base.w, D = enc.base.d, H = enc.base.h;
    var boxes = list.map(function (b) {
      var r = b.d / 2;
      return { b: b, x0: b.at[0] - r, x1: b.at[0] + r, y0: b.at[1] - r, y1: b.at[1] + r };
    });

    boxes.forEach(function (bb) {
      if (bb.x0 < 0 || bb.y0 < 0 || bb.x1 > W || bb.y1 > D) {
        problems.push({ k: 'boss',
          msg: bb.b.id + ' 圆心 (' + bb.b.at.join(', ') + ') 半径 ' + (bb.b.d / 2).toFixed(1) +
               ' mm 伸出外廓 ' + W + '×' + D + ' mm 之外，这一圈会打印在空气里' });
      }
      if (enc.lid.on && bb.b.h < H - 0.2) {
        problems.push({ k: 'boss',
          msg: bb.b.id + ' 只做到 z=' + bb.b.h + '，而盖子的内侧在 z=' + H +
               ' —— 螺丝够不着，这个柱子在真机上只是挡路' });
      }
      parts.forEach(function (p) {
        var box = p.box;
        var ox = Math.min(bb.x1, box.x1) - Math.max(bb.x0, box.x0);
        var oy = Math.min(bb.y1, box.y1) - Math.max(bb.y0, box.y0);
        var oz = Math.min(bb.b.h, box.z1) - Math.max(0, box.z0);
        if (ox > 0.05 && oy > 0.05 && oz > 0.05) {
          problems.push({ k: 'boss',
            msg: bb.b.id + ' 站在 ' + p.id + ' 的位置里（重叠 ' +
                 [ox, oy, oz].map(function (n) { return n.toFixed(1); }).join('×') +
                 ' mm）—— 器件放不进去；把螺柱挪到空处' });
        }
      });
    });

    for (var i = 0; i < boxes.length; i++) {
      for (var j = i + 1; j < boxes.length; j++) {
        var A = boxes[i], B = boxes[j];
        if (A.x0 < B.x1 - 0.05 && B.x0 < A.x1 - 0.05 && A.y0 < B.y1 - 0.05 && B.y0 < A.y1 - 0.05) {
          problems.push({ k: 'boss', msg: A.b.id + ' 与 ' + B.b.id + ' 两个螺柱叠在一起了' });
        }
      }
    }
    if (list.length === 1) warns.push('只有 1 个螺柱：盖子会以它为轴转，至少 2 个（对角）才压得住');
    if (list.length && !enc.lid.on) warns.push('有螺柱但 lid.on 为 false，没有盖子可拧');
  }

  function wallSpan(face, enc) {
    var W = enc.base.w, D = enc.base.d, H = enc.base.h;
    if (face === 'front' || face === 'back') return [W, H];
    if (face === 'left' || face === 'right') return [D, H];
    return [W, D];
  }

  function checkHoles(holes, enc, gaps, problems, warns) {
    FACE_LIST.forEach(function (face) {
      var list = holes[face] || [];
      var span = wallSpan(face, enc);
      if (face === 'top' && !enc.lid.on && list.length) {
        problems.push({ k: 'cutout-no-lid',
          msg: '有 ' + list.length + ' 个开口在盖子上，但 lid.on 是 false —— 这些孔不会出现在任何实体上' });
      }
      list.forEach(function (h) {
        var a = h.aabb;
        var edge = Math.min(a[0], a[1], span[0] - a[2], span[1] - a[3]);
        if (edge < 1.2) {
          problems.push({ k: 'cutout-edge',
            msg: face + ' 面的开口 [' + a.map(function (n) { return n.toFixed(1); }).join(', ') +
                 '] 离墙边只剩 ' + edge.toFixed(1) + ' mm，会破边；把器件往里挪，或缩小开口' });
        }
        if (h.owner && /:/.test(h.owner)) {
          var port = (gaps || []).filter(function (g) { return h.owner === g.part + ':' + g.port; })[0];
          if (port) port.cut = true;
        }
      });
      for (var i = 0; i < list.length; i++) {
        for (var j = i + 1; j < list.length; j++) {
          var A = list[i].aabb, B = list[j].aabb;
          if (A[0] < B[2] - 0.2 && B[0] < A[2] - 0.2 && A[1] < B[3] - 0.2 && B[1] < A[3] - 0.2) {
            problems.push({ k: 'cutout-clash',
              msg: face + ' 面两个开口重叠：' + list[i].owner + ' 与 ' + list[j].owner + ' —— 挪开器件，或合并成一个开口' });
          }
        }
      }
    });

    /* Coverage: the hole that was punched must actually be bigger than the
     * port it serves, otherwise the part looks out through a slit. */
    (gaps || []).forEach(function (g) {
      if (g.blocked) {
        warns.push(g.part + ':' + g.port + ' 距 ' + g.face + ' 面 ' + g.gap + ' mm，插头够不到 —— 要么挪近，要么显式写 expose:false');
        return;
      }
      if (!g.cut) {
        problems.push({ k: 'blocked',
          msg: g.part + ':' + g.port + ' 朝向 ' + g.face + '，那一面没有覆盖它的开口' });
      }
    });
  }

  function pkey(p) {
    return Math.round(p[0] * 1000) + ',' + Math.round(p[1] * 1000) + ',' + Math.round(p[2] * 1000);
  }

  /* T-junctions: a vertex sitting in the middle of the neighbour's edge.
   *
   * The strip triangulator cuts a face at every hole vertex y, so its
   * boundary is subdivided at those heights while the wall next to it is one
   * long straight edge. The two agree on the line but not on the vertices,
   * and a slicer reads that as a non-manifold seam. Splitting the long edge
   * at the extra vertices is the repair, and it is the same repair a mesh
   * tool does - done here because a printed part is the deliverable.
   *
   * Returns how many triangles were split, so the caller can iterate.
   */
  function onSeg(v, a, b) {
    var ab = sub(b, a), av = sub(v, a);
    var l2 = dot(ab, ab);
    if (l2 < 1e-12) return -1;
    var t = dot(av, ab) / l2;
    if (t < 1e-6 || t > 1 - 1e-6) return -1;
    var d = sub(av, [ab[0] * t, ab[1] * t, ab[2] * t]);
    if (vlen(d) > 1e-6) return -1;
    return t;
  }

  function weldTJunctions(sh) {
    var vmap = {}, i, e;
    for (i = 0; i < sh.tris.length; i++) {
      for (e = 0; e < 3; e++) vmap[pkey(sh.tris[i][e])] = sh.tris[i][e];
    }
    var keys = [], k;
    for (k in vmap) if (Object.prototype.hasOwnProperty.call(vmap, k)) keys.push(k);

    var count = {};
    function ek(a, b) { return pkey(a) + '>' + pkey(b); }
    for (i = 0; i < sh.tris.length; i++) {
      var t = sh.tris[i];
      for (e = 0; e < 3; e++) {
        var kk = ek(t[e], t[(e + 1) % 3]);
        count[kk] = (count[kk] || 0) + 1;
      }
    }

    var cut = {};
    var missing = 0;
    for (k in count) {
      if (!Object.prototype.hasOwnProperty.call(count, k)) continue;
      var half = k.split('>');
      if (count[half[1] + '>' + half[0]]) continue;
      missing++;
      var a = vmap[half[0]], b = vmap[half[1]];
      if (!a || !b) continue;
      var hits = [];
      for (i = 0; i < keys.length; i++) {
        var kk2 = keys[i];
        if (kk2 === half[0] || kk2 === half[1]) continue;
        var v = vmap[kk2];
        var tt = onSeg(v, a, b);
        if (tt > 0) hits.push({ t: tt, p: v });
      }
      if (!hits.length) continue;
      hits.sort(function (x, y) { return x.t - y.t; });
      var pts = [a];
      for (i = 0; i < hits.length; i++) pts.push(hits[i].p);
      pts.push(b);
      cut[k] = pts;
    }
    if (!cut) return 0;

    var out = [];
    var split = 0;
    for (i = 0; i < sh.tris.length; i++) {
      var tri3 = sh.tris[i], found = -1;
      for (e = 0; e < 3; e++) {
        if (cut[ek(tri3[e], tri3[(e + 1) % 3])]) { found = e; break; }
      }
      if (found < 0) { out.push(tri3); continue; }
      var pa = tri3[found], pb = tri3[(found + 1) % 3], po = tri3[(found + 2) % 3];
      var seq = cut[ek(pa, pb)];
      for (var q = 0; q + 1 < seq.length; q++) out.push([po, seq[q], seq[q + 1]]);
      split++;
    }
    sh.tris = out;
    return split || missing;
  }

  /* Closed means every directed edge has exactly one opposite twin. An open
   * shell is the signature of a cap whose triangulation dropped a region -
   * exactly the bug that a picture would never show you. */
  function openEdges(sh) {
    var m = {}, k;
    for (var i = 0; i < sh.tris.length; i++) {
      var t = sh.tris[i];
      for (var e = 0; e < 3; e++) {
        k = pkey(t[e]) + '>' + pkey(t[(e + 1) % 3]);
        m[k] = (m[k] || 0) + 1;
      }
    }
    var open = 0;
    for (k in m) {
      var half = k.split('>');
      if (!m[half[1] + '>' + half[0]]) open += m[k];
    }
    return open;
  }

  function checkMesh(shells, stats, problems) {
    var closed = true;
    shells.forEach(function (s) {
      var open = openEdges(s);
      if (open) {
        closed = false;
        problems.push({ k: 'mesh',
          msg: s.name + ' 不是闭合壳：' + open + ' 条边没有对面（三角化漏了区域，或开口把面挖穿了）' });
      }
      if (s.tris.length < 4) {
        problems.push({ k: 'mesh', msg: s.name + ' 只有 ' + s.tris.length + ' 个三角面，等于空壳' });
      }
      if (volume(s) <= 0) {
        problems.push({ k: 'mesh', msg: s.name + ' 体积为 ' + volume(s).toFixed(1) + ' mm³，绕向错误或墙体自相交' });
      }
    });
    stats.closed = closed;
  }

  function checkPrint(enc, holes, stats, problems, warns) {
    var minWall = enc.printer.minWall || 0.8;
    var layer = enc.printer.layer || 0.2;
    if (enc.base.wall < minWall) problems.push({ k: 'thin', msg: '壁厚 ' + enc.base.wall + ' mm < 最小可打印壁厚 ' + minWall + ' mm' });
    if (enc.base.floor < minWall) problems.push({ k: 'thin', msg: '底板 ' + enc.base.floor + ' mm < 最小可打印壁厚 ' + minWall + ' mm' });
    if (enc.lid.on && enc.lid.thick < minWall) problems.push({ k: 'thin', msg: '盖板 ' + enc.lid.thick + ' mm < 最小可打印壁厚 ' + minWall + ' mm' });

    var bed = enc.printer.bed || [220, 220];
    if (stats.bbox[0] > bed[0] || stats.bbox[1] > bed[1]) {
      problems.push({ k: 'bed',
        msg: '外廓 ' + stats.bbox[0].toFixed(0) + '×' + stats.bbox[1].toFixed(0) +
             ' mm 超出热床 ' + bed[0] + '×' + bed[1] + ' mm' });
    }
    var layers = enc.base.wall / layer;
    if (layers < 4) warns.push('壁厚只有 ' + layers.toFixed(0) + ' 层，强度偏弱（建议 ≥ 4 层）');
  }

  /* ------------------------------------------------------------------ *
   * 11. 3D view
   *
   * Painter's algorithm over an orthographic orbit camera. No z-buffer, no
   * canvas: the output is SVG polygons, so the same picture is testable in
   * the fake DOM, styleable from CSS, and diff-able when the geometry moves.
   * ------------------------------------------------------------------ */
  /* Orthographic orbit camera, return [screenX, screenUp, depth].
   *
   * The pair has to be consistent or the painter's sort inverts:
   *   screenUp = Z*cos(pitch) + Y*sin(pitch)   at pitch 0 up is +z, at 90 the
   *                                            far side is up - a normal orbit
   *   depth    = Y*cos(pitch) - Z*sin(pitch)   "into the screen": at pitch 0
   *                                            further back is deeper, at 90
   *                                            higher is NEARER
   * Negating the screen axis alone (which reads like "SVG y grows down") makes
   * the box a view from below while the depth still describes a view from
   * above. The result still looks like a box, so the bug hides - and then a
   * screw post at z=58 gets drawn on top of a closed lid at z=66. */
  function project(p, yaw, pitch) {
    var cy = Math.cos(yaw), sy = Math.sin(yaw);
    var X = p[0] * cy - p[1] * sy;
    var Y = p[0] * sy + p[1] * cy;
    var Z = p[2];
    var cp = Math.cos(pitch), sp = Math.sin(pitch);
    return [X, Z * cp + Y * sp, Y * cp - Z * sp];
  }

  function shade(hex, k) {
    var h = String(hex || '#cccccc').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    if (isNaN(r)) { r = g = b = 200; }
    var f = function (v) { return Math.max(0, Math.min(255, Math.round(v * k))); };
    return 'rgb(' + f(r) + ',' + f(g) + ',' + f(b) + ')';
  }

  function num(n) { return Math.round(n * 10) / 10; }

  /* A part is a box, so six quads - and the quads go into the same painter
   * list as the shell, which is what makes the shell hide them correctly
   * instead of drawing every part on top of a closed lid. */
  function boxTris(b) {
    var c = [[b.x0, b.y0, b.z0], [b.x1, b.y0, b.z0], [b.x1, b.y1, b.z0], [b.x0, b.y1, b.z0],
             [b.x0, b.y0, b.z1], [b.x1, b.y0, b.z1], [b.x1, b.y1, b.z1], [b.x0, b.y1, b.z1]];
    var q = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
    var out = [];
    q.forEach(function (f) {
      out.push([c[f[0]], c[f[1]], c[f[2]]]);
      out.push([c[f[0]], c[f[2]], c[f[3]]]);
    });
    return out;
  }

  function render(encGiven, dia, opts) {
    var m = model(encGiven, dia);
    var o = opts || {};
    var yaw = (o.yaw == null ? -32 : o.yaw) * Math.PI / 180;
    var pitch = (o.pitch == null ? 20 : o.pitch) * Math.PI / 180;
    var W = o.width || 720, Hh = o.height || 460, PAD = 22;
    var lift = o.explode ? (o.explodeGap || 34) : 0;
    var ghost = !!o.ghost;
    var open = !!o.open;
    /* A cutaway drops the front wall and the lid so the inside is visible.
       That is not a camera trick: it is the only way the parts can be drawn
       at all, because a painter's algorithm cannot interleave a board with
       the floor it stands on. Removing the wall that would have covered them
       removes the ambiguity instead of papering over it. */
    var cut = !!o.cut;
    /* Parts only make sense when the inside is visible; in an exterior view
       they would have to be drawn over the wall that hides them. Declared
       after `cut` - reading `cut` above its assignment silently yields
       undefined, which is a cutaway with nothing in it. */
    var showParts = o.parts == null ? cut : !!o.parts;
    var frontY = m.enc.base.wall + 1e-6;

    /* Backface culling. A painter's algorithm has no depth buffer, so the only
     * thing keeping the inside of a solid from being painted over its outside
     * is that the inside is not drawn at all. Without this, every hole shows
     * the near half of its own bore as a moon-shaped smear of wall colour, and
     * a screw post behind the wall shows up through it - the picture looks
     * broken even though the mesh is exact.
     *
     * `depth` grows away from the camera, so the camera direction is the
     * negative gradient of it - see project(). */
    var vdir = [-Math.sin(yaw) * Math.cos(pitch), -Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch)];
    var cull = o.cull !== false;
    function facing(n) { return !cull || dot(n, vdir) > 0; }

    var items = [], partItems = [], marks = [], minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    m.shells.forEach(function (sh) {
      if ((open || cut) && sh.kind === 'lid') return;
      /* A shelf is interior. In an exterior view it can only be seen through
         a hole, and there it is drawn as a bar across the opening: painter's
         algorithm sorts whole triangles, so a small plate 2 mm behind the
         wall lands on top of the large wall triangles around it. The honest
         exterior picture is the wall and the holes in it - the shelf belongs
         to the cutaway, where the wall is gone. */
      if (!cut && sh.kind === 'shelf') return;
      var dz = (sh.kind === 'lid') ? lift : 0;
      for (var i = 0; i < sh.tris.length; i++) {
        var t = sh.tris[i];
        if (cut && t[0][1] <= frontY && t[1][1] <= frontY && t[2][1] <= frontY) continue;
        var p0 = project([t[0][0], t[0][1], t[0][2] + dz], yaw, pitch);
        var p1 = project([t[1][0], t[1][1], t[1][2] + dz], yaw, pitch);
        var p2 = project([t[2][0], t[2][1], t[2][2] + dz], yaw, pitch);
        var n = vnorm(cross(sub(t[1], t[0]), sub(t[2], t[0])));
        if (!facing(n)) continue;
        /* two-sided light: a matte shell has no visible dark side */
        var lam = Math.abs(dot(n, vnorm([-0.45, -0.72, 0.9])));
        var k = 0.52 + 0.48 * lam;
        if (sh.kind === 'boss') k *= 0.86;
        /* Shade surfaces that face the cavity darker.
         *
         * Without this a hole reads as a patch of wall: the far wall is the
         * same plastic, lit by the same two-sided lamp, so "the opening shows
         * the inside" and "the opening is filled in" are the same pixels. The
         * inside of a real box is in its own shadow, and one dot product is
         * enough to say so. */
        var mid = [(t[0][0] + t[1][0] + t[2][0]) / 3,
                   (t[0][1] + t[1][1] + t[2][1]) / 3,
                   (t[0][2] + t[1][2] + t[2][2]) / 3];
        if (dot(n, sub([m.enc.base.w / 2, m.enc.base.d / 2, m.enc.base.h / 2], mid)) > 0) k *= 0.72;
        items.push({
          d: (p0[2] + p1[2] + p2[2]) / 3,
          pts: [p0, p1, p2],
          fill: shade(sh.color, k),
          alpha: ghost && sh.kind !== 'base' ? 0.25 : 1,
          kind: sh.kind
        });
        for (var q = 0; q < 3; q++) {
          var p = [p0, p1, p2][q];
          if (p[0] < minX) minX = p[0];
          if (p[0] > maxX) maxX = p[0];
          if (p[1] < minY) minY = p[1];
          if (p[1] > maxY) maxY = p[1];
        }
      }
    });

    /* Parts are kept in their own list and appended after the shell, sorted
     * among themselves. A part never intersects another part (checkParts
     * proves it), so this is exact for them - and it is the only order that
     * keeps a board from being painted over by the floor it stands on. */
    if (showParts) {
      m.parts.forEach(function (p) {
        var tris = boxTris(p.box);
        for (var i = 0; i < tris.length; i++) {
          var t = tris[i];
          var q0 = project(t[0], yaw, pitch), q1 = project(t[1], yaw, pitch), q2 = project(t[2], yaw, pitch);
          var nn = vnorm(cross(sub(t[1], t[0]), sub(t[2], t[0])));
          if (!facing(nn)) continue;
          var lam2 = Math.abs(dot(nn, vnorm([-0.45, -0.72, 0.9])));
          partItems.push({
            d: (q0[2] + q1[2] + q2[2]) / 3,
            pts: [q0, q1, q2],
            fill: shade(p.color, 0.55 + 0.45 * lam2),
            alpha: 1, kind: 'part'
          });
          for (var qq = 0; qq < 3; qq++) {
            var pp = [q0, q1, q2][qq];
            if (pp[0] < minX) minX = pp[0];
            if (pp[0] > maxX) maxX = pp[0];
            if (pp[1] < minY) minY = pp[1];
            if (pp[1] > maxY) maxY = pp[1];
          }
        }
        var ctr = project([(p.box.x0 + p.box.x1) / 2, (p.box.y0 + p.box.y1) / 2, p.box.z1], yaw, pitch);
        marks.push({ d: ctr[2], id: p.id, at: ctr });
      });
    }

    var sw = Math.max(maxX - minX, 1e-6), sh2 = Math.max(maxY - minY, 1e-6);
    var k2 = Math.min((W - PAD * 2) / sw, (Hh - PAD * 2) / sh2);
    var ox = W / 2 - ((minX + maxX) / 2) * k2;
    var oy = Hh / 2 + ((minY + maxY) / 2) * k2;

    /* Equal depth means coplanar, and a post top and the deck it meets are
       exactly coplanar by design. Break the tie by what sits outside what:
       base, then posts and parts, then the lid. */
    var RANK = { base: 0, shelf: 1, boss: 1, part: 2, lid: 3 };
    items.sort(function (a, b) {
      if (Math.abs(b.d - a.d) > 1e-6) return b.d - a.d;
      return (RANK[a.kind] || 0) - (RANK[b.kind] || 0);
    });
    partItems.sort(function (a, b) { return b.d - a.d; });
    items = items.concat(partItems);

    var out = [];
    out.push('<svg class="enc-svg" viewBox="0 0 ' + W + ' ' + Hh + '" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="enclosure preview">');
    /* A soft footprint shadow. Without it the box floats, and "which face is
       the floor" is the first thing a reader gets wrong about a CAD picture. */
    if (o.shadow !== false) {
      var fs = [[0, 0], [m.enc.base.w, 0], [m.enc.base.w, m.enc.base.d], [0, m.enc.base.d]].map(
        function (p) { return project([p[0], p[1], 0], yaw, pitch); });
      var sx0 = 1e9, sx1 = -1e9, sy0 = 1e9, sy1 = -1e9;
      fs.forEach(function (p) {
        if (p[0] < sx0) sx0 = p[0];
        if (p[0] > sx1) sx1 = p[0];
        if (p[1] < sy0) sy0 = p[1];
        if (p[1] > sy1) sy1 = p[1];
      });
      out.push('<ellipse cx="' + num(((sx0 + sx1) / 2) * k2 + ox) + '" cy="' + num(oy - ((sy0 + sy1) / 2) * k2) +
               '" rx="' + num((sx1 - sx0) * k2 * 0.56) + '" ry="' + num((sy1 - sy0) * k2 * 0.56) +
               '" fill="#0f172a" fill-opacity="0.10"/>');
    }
    out.push('<g>');
    for (var it = 0; it < items.length; it++) {
      var s = items[it];
      var d = '';
      for (var k3 = 0; k3 < 3; k3++) {
        d += (k3 ? ' ' : '') + num(s.pts[k3][0] * k2 + ox) + ',' + num(oy - s.pts[k3][1] * k2);
      }
      out.push('<polygon points="' + d + '" fill="' + s.fill + '" fill-opacity="' + s.alpha +
               '" stroke="' + s.fill + '" stroke-width="0.5" stroke-linejoin="round"/>');
    }
    out.push('</g>');
    /* ids last, so a label is never buried under a face. Only when the inside
       is actually visible - a name floating on a closed lid is a lie. */
    if (o.labels && showParts) {
      marks.sort(function (a, b) { return b.d - a.d; });
      out.push('<g class="enc-labels" font-family="ui-monospace, monospace" font-size="12" text-anchor="middle">');
      for (var mi = 0; mi < marks.length; mi++) {
        var mk = marks[mi];
        out.push('<text x="' + num(mk.at[0] * k2 + ox) + '" y="' + num(oy - mk.at[1] * k2 - 4) +
                 '" fill="#0f172a" fill-opacity="0.75">' + mk.id + '</text>');
      }
      out.push('</g>');
    }
    out.push('</svg>');

    return {
      svg: out.join(''), stats: m.stats, problems: m.problems, warns: m.warns, model: m,
      /* the same camera the picture used, so a caller can hit-test a pixel or
         put a marker on a part without re-deriving the fit */
      xform: {
        k: k2, ox: ox, oy: oy, yaw: yaw, pitch: pitch,
        toScreen: function (p) {
          var q = project(p, yaw, pitch);
          return [q[0] * k2 + ox, oy - q[1] * k2, q[2]];
        }
      }
    };
  }

  /* ------------------------------------------------------------------ *
   * 12. Binary STL
   * ------------------------------------------------------------------ */
  /* A shell's bounding box, [x0,y0,z0,x1,y1,z1]. */
  function bbox(sh) {
    var b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (var i = 0; i < sh.tris.length; i++) {
      for (var v = 0; v < 3; v++) {
        var p = sh.tris[i][v];
        for (var a = 0; a < 3; a++) {
          if (p[a] < b[a]) b[a] = p[a];
          if (p[a] > b[a + 3]) b[a + 3] = p[a];
        }
      }
    }
    return b;
  }

  /* Binary STL.
   *
   * `lay` is not cosmetic. The base and the lid are modelled assembled - the
   * lid sitting on top of the base - so writing every shell as-is produces one
   * file in which the two bodies occupy the same space: a slicer shows a
   * single overlapping blob and there is nothing to print. Laying them out is
   * the difference between a file and a print:
   *
   *   base + bosses  stay assembled, moved to the bed corner
   *   lid            turned over (180 deg about x) so the flat ceiling is on
   *                  the bed and the lip points up - printed the other way up
   *                  the 96x80 top would be one long bridge over air, and the
   *                  lip would hang from nothing
   *
   * Turning over is a rotation, not a mirror, so triangle winding survives.
   */
  function stl(m, opts) {
    var o = opts || {};
    var lay = o.lay !== false;
    var only = o.which || 'all';
    var gap = o.gap == null ? 8 : o.gap;

    var base = { tris: [] }, lid = { tris: [] };
    m.shells.forEach(function (s) {
      var into = s.kind === 'lid' ? lid : base;
      for (var i = 0; i < s.tris.length; i++) into.tris.push(s.tris[i]);
    });
    if (only === 'base') lid.tris = [];
    if (only === 'lid') base.tris = [];

    var bbB = base.tris.length ? bbox(base) : null;
    var bbL = lid.tris.length ? bbox(lid) : null;
    var db = bbB ? [-bbB[0], -bbB[1], -bbB[2]] : null;
    var dl = bbL ? [0, 0, 0] : null;
    if (bbL && lay) {
      var width = bbB ? (bbB[3] - bbB[0]) + gap : 0;
      dl = [width - bbL[0], bbL[4], bbL[5]];
    } else if (bbL) {
      dl = [0, 0, 0];
    }

    var tris = [];
    function put(t, d, flip) {
      var out = [];
      for (var i = 0; i < 3; i++) {
        var p = t[i];
        out.push(flip ? [p[0] + d[0], -p[1] + d[1], -p[2] + d[2]]
                      : [p[0] + d[0], p[1] + d[1], p[2] + d[2]]);
      }
      tris.push(out);
    }
    if (bbB) for (var i = 0; i < base.tris.length; i++) put(base.tris[i], db, false);
    if (bbL) for (var j = 0; j < lid.tris.length; j++) put(lid.tris[j], dl, lay);

    var buf = new ArrayBuffer(84 + tris.length * 50);
    var dv = new DataView(buf);
    var hdr = 'wokwi-skill enclosure v' + VERSION;
    for (var i = 0; i < hdr.length && i < 80; i++) dv.setUint8(i, hdr.charCodeAt(i) & 0xff);
    dv.setUint32(80, tris.length, true);
    var off = 84;
    for (var t = 0; t < tris.length; t++) {
      var tr = tris[t];
      var n = vnorm(cross(sub(tr[1], tr[0]), sub(tr[2], tr[0])));
      dv.setFloat32(off, n[0], true); dv.setFloat32(off + 4, n[1], true); dv.setFloat32(off + 8, n[2], true);
      off += 12;
      for (var v = 0; v < 3; v++) {
        dv.setFloat32(off, tr[v][0], true);
        dv.setFloat32(off + 4, tr[v][1], true);
        dv.setFloat32(off + 8, tr[v][2], true);
        off += 12;
      }
      dv.setUint16(off, 0, true);
      off += 2;
    }
    return new Uint8Array(buf);
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
    render: render,
    stl: stl,
    resolveParts: resolveParts
  };
})();
