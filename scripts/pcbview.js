/* =====================================================================
 * pcbview.js - render a Wokwi diagram.json as a physical view
 *
 * Why this file exists
 *   A CSS mock ("a grey box plus three bulbs") is a cartoon: it shows no pin
 *   names and no wiring, so it cannot help anyone check the circuit. This
 *   module reads the project's own diagram.json and draws the real parts at
 *   their real top/left, with pins at the coordinates published by Wokwi's
 *   open-source element library (@wokwi/elements, MIT), then routes every
 *   connection between the real pins.
 *
 *   Nothing is hand-drawn per project: change diagram.json and the picture
 *   follows. That is the point - the viewer cannot drift away from the
 *   circuit the sketch actually runs on.
 *
 * Artwork provenance
 *   LED and resistor geometry is derived from @wokwi/elements 1.9.2
 *   (led-element.js / resistor-element.js, MIT licence). The ESP32 board is
 *   drawn here: the open-source package only ships the 30-pin devkit-v1,
 *   while diagrams use the 38-pin board-esp32-devkit-c-v4, so the outline is
 *   reconstructed from the real 2.54 mm header pitch.
 *
 * API
 *   var v = PcbView.render(diagramObjectOrJsonText, opts)
 *     opts.brightness : { partId: 0..1 }   LED brightness (0 = off)
 *     opts.labels     : true               print all pin names as silkscreen
 *     opts.pins       : true               outline the pins that are used
 *     opts.hints      : true               hover hotspot on every pin (tooltip
 *                                          says the name and what it feeds)
 *     opts.i18n       : { unused: '未使用' } word used by the hint for a free pin
 *   returns { svg, viewBox, wires, parts, pins:{used,total},
 *             audit:{wires, crossings, offenders} }
 *
 *   PcbView.setBrightness(root, partId, value)   cheap live update
 *   PcbView.audit(diagram)                        geometry self-check
 *
 * Coordinate space = Wokwi world units, where 9.5 units is the 2.54 mm pin
 * pitch. Everything is plain SVG, so it scales cleanly in any container.
 * ===================================================================== */
var PcbView = (function () {
  'use strict';

  /* ---------------------------------------------------------------- pins */
  /* board-esp32-devkit-c-v4: 38 pins, 19 per side, top to bottom. Taken from
     Wokwi's part docs; GND appears three times so the names carry an index. */
  var LEFT = ['3V3', 'EN', 'VP', 'VN', '34', '35', '32', '33', '25', '26',
              '27', '14', '12', 'GND.1', '13', 'D2', 'D3', 'CMD', '5V'];
  var RIGHT = ['GND.2', '23', '22', 'TX', 'RX', '21', 'GND.3', '19', '18',
               '5', '17', '16', '4', '0', '2', '15', 'D1', 'D0', 'CLK'];

  var BW = 107;                 // board width in world units
  var PITCH = 9.5;              // 2.54 mm - taken from the official pin table
  var PIN_Y0 = 22;
  var BH = PIN_Y0 + (LEFT.length - 1) * PITCH + 22;   // + room for the USB jack
  var LED_W = 40, LED_H = 50, RES_W = 58.8, RES_H = 11.3;
  var SERVO_W = 170.08, SERVO_H = 119.55;             // from servo-element viewBox

  /* Arduino Mega 2560: 102.66mm x 50.80mm, and Wokwi world units are 9.5 per
     2.54mm, so 383.97 x 190. The 85 pin coordinates below are copied verbatim
     from @wokwi/elements arduino-mega-element.js (MIT) - not guessed. */
  var MEGA_W = 384, MEGA_H = 190;
  var MEGA_PINS = {
    'SCL': [90, 9], 'SDA': [100, 9], 'AREF': [109, 9], 'GND.1': [119, 9],
    '13': [129, 9], '12': [138, 9], '11': [148, 9], '10': [157.5, 9],
    '9': [167.5, 9], '8': [177, 9], '7': [190, 9], '6': [200, 9],
    '5': [209.5, 9], '4': [219, 9], '3': [228.5, 9], '2': [238, 9],
    '1': [247.5, 9], '0': [257.5, 9], '14': [270.5, 9], '15': [280, 9],
    '16': [289.5, 9], '17': [299, 9], '18': [308.5, 9], '19': [318.5, 9],
    '20': [328, 9], '21': [337.5, 9], '5V.1': [361, 8], '5V.2': [371, 8],
    '22': [361, 17.5], '23': [371, 17.5], '24': [361, 27.25], '25': [371, 27.25],
    '26': [361, 36.75], '27': [371, 36.75], '28': [361, 46.25], '29': [371, 46.25],
    '30': [361, 56], '31': [371, 56], '32': [361, 65.5], '33': [371, 65.5],
    '34': [361, 75], '35': [371, 75], '36': [361, 84.5], '37': [371, 84.5],
    '38': [361, 94.25], '39': [371, 94.25], '40': [361, 103.75], '41': [371, 103.75],
    '42': [361, 113.5], '43': [371, 113.5], '44': [361, 123], '45': [371, 123],
    '46': [361, 132.75], '47': [371, 132.75], '48': [361, 142.25], '49': [371, 142.25],
    '50': [361, 152], '51': [371, 152], '52': [361, 161.5], '53': [371, 161.5],
    'GND.4': [361, 171.25], 'GND.5': [371, 171.25],
    'IOREF': [136, 184.5], 'RESET': [145.5, 184.5], '3.3V': [155, 184.5],
    '5V': [164.5, 184.5], 'GND.2': [174.25, 184.5], 'GND.3': [183.75, 184.5],
    'VIN': [193.5, 184.5], 'A0': [208.5, 184.5], 'A1': [218, 184.5],
    'A2': [227.5, 184.5], 'A3': [237.25, 184.5], 'A4': [246.75, 184.5],
    'A5': [256.25, 184.5], 'A6': [266, 184.5], 'A7': [275.5, 184.5],
    'A8': [290.25, 184.5], 'A9': [300, 184.5], 'A10': [309.5, 184.5],
    'A11': [319.25, 184.5], 'A12': [328.75, 184.5], 'A13': [338.5, 184.5],
    'A14': [348, 184.5], 'A15': [357.75, 184.5]
  };

  /* A JS object reorders numeric-looking keys ('0', '22', ...) to the front, so
     the silkscreen would come out in a meaningless order. Keep the physical
     order explicitly: left-to-right along the top, then down the right side. */
  var MEGA_ORDER = [
    'SCL', 'SDA', 'AREF', 'GND.1', '13', '12', '11', '10',
    '9', '8', '7', '6', '5', '4', '3', '2',
    '1', '0', '14', '15', '16', '17', '18', '19',
    '20', '21', '5V.1', '5V.2', '22', '23', '24', '25',
    '26', '27', '28', '29', '30', '31', '32', '33',
    '34', '35', '36', '37', '38', '39', '40', '41',
    '42', '43', '44', '45', '46', '47', '48', '49',
    '50', '51', '52', '53', 'GND.4', 'GND.5', 'IOREF', 'RESET',
    '3.3V', '5V', 'GND.2', 'GND.3', 'VIN', 'A0', 'A1', 'A2',
    'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10',
    'A11', 'A12', 'A13', 'A14', 'A15'
  ];

  var ESP32_PINS = (function () {
    var out = {}, i;
    for (i = 0; i < LEFT.length; i++) out[LEFT[i]] = [5.0, PIN_Y0 + i * PITCH];
    for (i = 0; i < RIGHT.length; i++) out[RIGHT[i]] = [101.3, PIN_Y0 + i * PITCH];
    return out;
  })();

  var BOARDS = {
    'board-esp32-devkit-c-v4': { w: BW, h: BH, pins: ESP32_PINS, kind: 'esp32',
                                 order: LEFT.concat(RIGHT) },
    'wokwi-arduino-mega': { w: MEGA_W, h: MEGA_H, pins: MEGA_PINS, kind: 'mega',
                            order: MEGA_ORDER }
  };

  /* Other devkit-c variants share the 38-pin layout, so they fall back. An
     unknown board never renders as an empty shell: the error names what is
     supported, because a wrong pin map is worse than no map. */
  function boardOf(type) {
    if (BOARDS[type]) return BOARDS[type];
    if (String(type).indexOf('board-esp32') === 0) return BOARDS['board-esp32-devkit-c-v4'];
    return null;
  }

  var GAP = 13;                 // how far a wire clears the board before it turns
  var CLEAR = 11;               // clearance kept from the footprint
  var LANE = 7;                 // spacing between parallel wrap lanes

  /* light glow colour per LED colour, same table as @wokwi/elements */
  var GLOW = { red: '#ff8080', green: '#80ff80', blue: '#8080ff',
               yellow: '#ffff80', orange: '#ffcf80', white: '#ffffff',
               purple: '#ff80ff' };

  /* resistor colour code, same values as @wokwi/elements resistor-element */
  var BAND = {
    '-2': '#C3C7C0', '-1': '#F1D863',
    '0': '#000000', '1': '#8F4814', '2': '#FB0000', '3': '#FC9700',
    '4': '#FCF800', '5': '#00B800', '6': '#0000FF', '7': '#A803D6',
    '8': '#808080', '9': '#FCFCFC'
  };

  var WIRE = { green: '#16a34a', black: '#111827', red: '#dc2626',
               blue: '#2563eb', yellow: '#eab308', white: '#9ca3af',
               orange: '#ea580c', purple: '#9333ea' };

  /* ------------------------------------------------------------ helpers */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function num(v) { return Math.round(v * 100) / 100; }
  function isBoard(t) { return !!boardOf(t); }

  function pinsOf(part) {
    var out = {}, i, t = part.type, b = boardOf(t);
    if (b) return b.pins;
    if (t === 'wokwi-led') {
      var flip = part.attrs && part.attrs.flip != null;
      out.A = [flip ? 15 : 25, 42];
      out.C = [flip ? 25 : 15, 42];
    } else if (t === 'wokwi-resistor') {
      out['1'] = [0, 5.65];
      out['2'] = [RES_W, 5.65];
    } else if (t === 'wokwi-servo') {
      /* servo-element: three stubs on the left edge, signal last */
      out.GND = [0, 50];
      out['V+'] = [0, 59.5];
      out.PWM = [0, 69];
    }
    return out;
  }

  function sizeOf(part) {
    var t = part.type, b = boardOf(t);
    if (b) return [b.w, b.h];
    if (t === 'wokwi-led') return [LED_W, LED_H];
    if (t === 'wokwi-resistor') return [RES_W, RES_H];
    if (t === 'wokwi-servo') return [SERVO_W, SERVO_H];
    return [40, 40];
  }

  /* A part is rotated about the centre of its footprint - that is what Wokwi's
     rotate attribute does, and what the SVG <g transform> below reproduces. */
  function rotatePt(part, p) {
    if (!part.rotate) return p;
    var sz = sizeOf(part), a = part.rotate * Math.PI / 180;
    var cx = sz[0] / 2, cy = sz[1] / 2;
    var dx = p[0] - cx, dy = p[1] - cy;
    return [cx + dx * Math.cos(a) - dy * Math.sin(a),
            cy + dx * Math.sin(a) + dy * Math.cos(a)];
  }

  /* Resistor bands: the value is split into two significant digits plus a
     multiplier, exactly like the official component does it. */
  function bands(value) {
    var v = parseFloat(value);
    if (!isFinite(v) || v <= 0) v = 1000;
    var e = Math.floor(Math.log(v) / Math.LN10);
    if (e < -1) e = -1;
    if (e > 9) e = 9;
    var base = Math.round(v / Math.pow(10, e) * 10);
    if (base >= 100) { base = Math.round(base / 10); e += 1; }
    return [BAND[String(Math.floor(base / 10))] || '#000000',
            BAND[String(base % 10)] || '#000000',
            BAND[String(e)] || '#000000'];
  }

  /* The board is drawn, not copied: the open-source package has no v4 part.
     Every dimension below follows the real 2.54 mm header grid. */
  function boardSvg(part, sfx) {
    var b = boardOf(part.type);
    return b && b.kind === 'mega' ? megaSvg(part) : esp32Svg(part, sfx);
  }

  function esp32Svg(part, sfx) {
    var g = ['<g class="pcb-board" transform="translate(' + num(part.left) + ',' + num(part.top) + ')">'];
    g.push('<rect x="0" y="0" width="' + BW + '" height="' + num(BH) + '" rx="7.5" fill="#1a1a1a" stroke="#000" stroke-width=".8"/>');
    [[7, 7], [BW - 7, 7], [7, BH - 7], [BW - 7, BH - 7]].forEach(function (c) {
      g.push('<circle cx="' + c[0] + '" cy="' + num(c[1]) + '" r="3.1" fill="#0d0d0d" stroke="#2f2f2f" stroke-width="1"/>');
    });
    g.push('<rect x="2" y="2" width="' + (BW - 4) + '" height="' + num(BH - 4) + '" rx="6" fill="none" stroke="#272727" stroke-width="1"/>');

    /* PCB meander antenna along the top edge */
    g.push('<path d="M34 14 h6 v-4 h6 v4 h6 v-4 h6 v4 h6 v-4 h6 v4 h6 v-4 h6 v4 h6" fill="none" stroke="#c9a227" stroke-width="2" stroke-linejoin="miter" opacity=".9"/>');

    g.push('<defs><linearGradient id="can' + sfx + '" x1="0" y1="0" x2="1" y2="1">' +
           '<stop offset="0" stop-color="#dde2e8"/><stop offset=".45" stop-color="#98a1ab"/>' +
           '<stop offset="1" stop-color="#c6cdd5"/></linearGradient></defs>');
    /* The shield starts at x=28, not 22: the left silk labels sit in that
       gutter, and a 5-glyph name like GND.1 would otherwise run under it. */
    g.push('<rect x="28" y="96" width="60" height="60" rx="2.5" fill="url(#can' + sfx + ')" stroke="#7b848e" stroke-width=".9"/>');
    g.push('<rect x="31.5" y="100" width="53" height="52" rx="1.5" fill="none" stroke="#8b939c" stroke-width=".55" opacity=".65"/>');
    g.push('<text x="58" y="128" font-family="Helvetica,Arial" font-size="5.2" fill="#5c646d" text-anchor="middle" letter-spacing=".1">ESP32-WROOM-32</text>');

    /* micro-USB at the bottom */
    var uy = BH - 19;
    g.push('<rect x="38" y="' + num(uy) + '" width="31" height="15" rx="1.6" fill="#c8ccd1" stroke="#8d9297" stroke-width=".9"/>');
    g.push('<rect x="43" y="' + num(uy + 3) + '" width="21" height="5.5" rx="1" fill="#3a3f45"/>');

    /* EN / BOOT buttons. They sit left of the right-hand silkscreen gutter
       (labels are anchored at bx1-9 and grow leftwards, so anything past x=83
       would print straight through D1 / D0 / CLK). */
    [[BH - 44, 'EN'], [BH - 30, 'BOOT']].forEach(function (b) {
      g.push('<rect x="70" y="' + num(b[0]) + '" width="10" height="9" rx="1.2" fill="#e6e8ea" stroke="#9aa0a6" stroke-width=".8"/>');
      g.push('<text x="67" y="' + num(b[0] + 6) + '" font-family="Helvetica,Arial" font-size="4.2" fill="#8b9299" text-anchor="end">' + b[1] + '</text>');
    });
    g.push('<text x="52" y="92" font-family="Helvetica,Arial" font-size="4.8" fill="#6b7280" text-anchor="middle">ESP32-DevKitC V4</text>');

    /* plated through-hole pads, one per real header position */
    for (var i = 0; i < LEFT.length; i++) {
      var py = PIN_Y0 + i * PITCH;
      g.push('<rect x="2.4" y="' + num(py - 2.35) + '" width="5.2" height="4.7" rx="1" fill="#d1c479" stroke="#8a7f45" stroke-width=".5"/>');
      g.push('<circle cx="5" cy="' + num(py) + '" r="1.25" fill="#141414"/>');
    }
    for (var j = 0; j < RIGHT.length; j++) {
      var qy = PIN_Y0 + j * PITCH;
      g.push('<rect x="99.4" y="' + num(qy - 2.35) + '" width="5.2" height="4.7" rx="1" fill="#d1c479" stroke="#8a7f45" stroke-width=".5"/>');
      g.push('<circle cx="101.3" cy="' + num(qy) + '" r="1.25" fill="#141414"/>');
    }
    g.push('</g>');
    return g.join('');
  }

  /* Arduino Mega 2560: teal PCB, headers on three edges, USB-B and the barrel
     jack on the left. Pads go on the official pin coordinates, so the pad grid
     and the wire endpoints are the same numbers. */
  function megaSvg(part) {
    var g = ['<g class="pcb-board" transform="translate(' + num(part.left) + ',' + num(part.top) + ')">'];
    g.push('<rect x="0" y="0" width="' + MEGA_W + '" height="' + MEGA_H + '" rx="9" fill="#177c8c" stroke="#0c5560" stroke-width="1"/>');
    g.push('<rect x="3" y="3" width="' + (MEGA_W - 6) + '" height="' + (MEGA_H - 6) + '" rx="7" fill="none" stroke="#2f97a6" stroke-width=".8"/>');
    [[11, 11], [MEGA_W - 11, 11], [11, MEGA_H - 11], [MEGA_W - 11, MEGA_H - 11]].forEach(function (c) {
      g.push('<circle cx="' + c[0] + '" cy="' + c[1] + '" r="3.4" fill="#d9dde0" stroke="#8d9499" stroke-width=".8"/>');
    });

    /* header strips: top row, the double row on the right, the analogue row */
    g.push('<rect x="86" y="4.5" width="292" height="10" rx="1.2" fill="#101010"/>');
    g.push('<rect x="356.5" y="14" width="20" height="163" rx="1.2" fill="#101010"/>');
    g.push('<rect x="132" y="179.5" width="232" height="10" rx="1.2" fill="#101010"/>');

    /* barrel jack + USB-B */
    g.push('<rect x="7" y="10" width="38" height="30" rx="3" fill="#1b1b1b" stroke="#000" stroke-width="1"/>');
    g.push('<rect x="12" y="18" width="16" height="14" rx="2" fill="#3a3a3a"/>');
    g.push('<rect x="8" y="52" width="34" height="26" rx="2" fill="#c9ced3" stroke="#8d9499" stroke-width="1"/>');
    g.push('<rect x="14" y="57" width="22" height="16" rx="1" fill="#8d9499"/>');

    /* the two big chips */
    g.push('<rect x="150" y="52" width="62" height="62" rx="2" fill="#1c1c1c" stroke="#000" stroke-width="1"/>');
    g.push('<circle cx="158" cy="60" r="2.4" fill="#3a3a3a"/>');
    g.push('<rect x="60" y="96" width="34" height="34" rx="2" fill="#1c1c1c" stroke="#000" stroke-width="1"/>');
    g.push('<circle cx="66" cy="102" r="1.8" fill="#3a3a3a"/>');

    /* reset button + LEDs */
    g.push('<rect x="96" y="42" width="18" height="14" rx="1.5" fill="#8e4b2a" stroke="#5c2f19" stroke-width=".8"/>');
    g.push('<circle cx="120" cy="48" r="3" fill="#2e7d32" stroke="#1b4d1f" stroke-width=".5"/>');

    g.push('<text x="188" y="130" font-family="Helvetica,Arial" font-size="12" fill="#cfe9ee" text-anchor="middle" letter-spacing="1">ARDUINO MEGA 2560</text>');
    g.push('<text x="188" y="146" font-family="Helvetica,Arial" font-size="7" fill="#9fd2da" text-anchor="middle">POWER &amp; ANALOG IN</text>');

    /* one pad per official pin coordinate */
    Object.keys(MEGA_PINS).forEach(function (nm) {
      var p = MEGA_PINS[nm];
      g.push('<rect x="' + num(p[0] - 2.6) + '" y="' + num(p[1] - 2.35) + '" width="5.2" height="4.7" rx="1" fill="#d1c479" stroke="#8a7f45" stroke-width=".5"/>');
      g.push('<circle cx="' + num(p[0]) + '" cy="' + num(p[1]) + '" r="1.25" fill="#141414"/>');
    });
    g.push('</g>');
    return g.join('');
  }

  /* Servo artwork is the official one (servo-element.js, MIT): body, mounting
     tabs, three-wire lead and the horn, with the horn angle left parametric so
     a moving servo can be drawn without a second template. */
  var SERVO_ART = [
    '<defs><g id="spin__SFX__">',
    '<rect x="0" y="-1.91" width="3.72" height="3.71"/>',
    '<path d="m2.026 -1.91h13.532l-13.425 0.51865z"/>',
    '<path d="m2.026 1.8h13.532l-13.425-0.50702z"/>',
    '<rect fill="#ccc" x="0.33" y="-1.23" width="3.04" height="2.46" rx=".15"/>',
    '</g></defs>',
    '<g stroke-width="2.7" fill="none">',
    '<path stroke="#b44200" d="m83.32 56.6c0 0-32.99 .96-43.32 0-6.2-.58-10.6-6.2-14.87-6.31"/>',
    '<path stroke="#ff2300" d="m83.326 59.6h-62.971"/>',
    '<path stroke="#f47b00" d="m83.32 62.6c0 0-32.6-.61-43.33-.15-6.87 .29-12.01 6.82-14.77 6.73"/>',
    '</g>',
    '<rect fill="#666" y="45.5" width="25.71" height="28" rx="1.14"/>',
    '<use xlink:href="#spin__SFX__" x="4.7" y="50.06"/>',
    '<use xlink:href="#spin__SFX__" x="4.7" y="59.66"/>',
    '<use xlink:href="#spin__SFX__" x="4.7" y="69.26"/>',
    '<path fill="#4d4d4d" d="m163.92 66.867a7.09 7.09 0 1 1 5.8145-11.136 0.18 0.18 0 0 0 0.33-0.10234v-14.346h-17.664v36.98h17.676v-14.346a0.18 0.18 0 0 0-0.333-0.107 7.08 7.08 0 0 1-5.83 3.06z"/>',
    '<path fill="#4d4d4d" d="m55.068 66.75a7.09 7.09 0 1 0-5.8261-11.136 0.18 0.18 0 0 1-0.33-0.10234v-14.346h17.676v36.98h-17.676v-14.346a0.18 0.18 0 0 1 0.333-0.107 7.08 7.08 0 0 0 5.83 3.06z"/>',
    '<rect fill="#666" x="64.255" y="37.911" width="90.241" height="43.725" rx="5.3331"/>',
    '<path fill="gray" d="m110.07 50.005h-14.42v19.537h14.42a9.7684 9.7684 0 0 0 0-19.537z"/>',
    '<circle fill="#999" cx="91.467" cy="59.773" r="18.606"/>',
    '<path data-horn="1" fill="__HORN__" transform="translate(91.467 59.773) rotate(__ANGLE__) translate(-91.467 -59.773)" d="m101.6 59.589-4.3167-54.166c0-2.8654-2.6026-5.1912-5.8145-5.1912s-5.8145 2.3258-5.8145 5.1912l-4.3167 54.166a8.3264 8.3264 0 0 0-.10234 1.2792c0 5.047 4.5818 9.1381 10.234 9.1381s10.234-4.0911 10.234-9.1381a8.3264 8.3264 0 0 0-.10233-1.2792zm-10.131-48.658a2.791 2.791 0 1 1-2.791 2.791 2.791 2.791 0 0 1 2.791-2.791zm0 8.6055a2.791 2.791 0 1 1-2.791 2.791 2.791 2.791 0 0 1 2.791-2.791zm0 8.3729a2.791 2.791 0 1 1-2.791 2.791 2.791 2.791 0 0 1 2.791-2.791zm0 8.6055a2.791 2.791 0 1 1-2.791 2.791 2.791 2.791 0 0 1 2.791-2.791zm5.9215 29.412a8.3729 8.3729 0 1 1 0-11.843 8.3729 8.3729 0 0 1 0 11.843z"/>',
    '<circle fill="gray" cx="91.467" cy="59.773" r="8.3729"/>',
    '<circle fill="#ccc" cx="91.467" cy="59.773" r="6.2494"/>',
    '<path fill="#666" d="m94.911 62.543-2.3839-2.4165a.42562 .42562 0 0 1 0-.60471l2.4281-2.3863a.64657 .64657 0 0 0 .06512-.8652 .62797 .62797 0 0 0-.93032-.05117l-2.4351 2.4049a.4326 .4326 0 0 1-.60703 0l-2.3863-2.4165a.6489 .6489 0 0 0-.8652-.06512 .63262 .63262 0 0 0-.05117 .93032l2.4049 2.4328a.42795 .42795 0 0 1 0 .60703l-2.4142 2.3863a.65122 .65122 0 0 0-.06745 .8652 .63029 .63029 0 0 0 .93032 .05117l2.4351-2.4049a.42562 .42562 0 0 1 .60471 0l2.3863 2.4398a.63262 .63262 0 0 0 .93032-.04186 .64657 .64657 0 0 0-.04419-.8652z"/>'
  ].join('');

  var HORNS = { Red: '#c0392b', Blue: '#2c6fb5', White: '#e8e8e8', Black: '#222',
                Green: '#2e8b3d', Orange: '#d2691e', Yellow: '#e0b400' };

  function servoSvg(part) {
    var attrs = part.attrs || {};
    var horn = HORNS[attrs.hornColor] || HORNS[attrs.hornColor && String(attrs.hornColor).toLowerCase()] || '#c0392b';
    var sfx = '_' + String(part.id).replace(/[^A-Za-z0-9_-]/g, '');
    var rot = part.rotate ? ' rotate(' + num(part.rotate) + ' ' + num(SERVO_W / 2) + ' ' + num(SERVO_H / 2) + ')' : '';
    return '<g class="pcb-part" data-part="' + esc(part.id) + '" transform="translate(' +
      num(part.left) + ',' + num(part.top) + ')' + rot + '">' +
      SERVO_ART.replace(/__SFX__/g, sfx)
               .replace('__HORN__', horn)
               .replace('__ANGLE__', String(attrs.angle == null ? 0 : attrs.angle)) +
      '</g>';
  }

  /* LED body: official geometry, colour and glow stay parametric so one
     template covers red / yellow / green / blue / white. */
  function ledSvg(part, brightness) {
    var attrs = part.attrs || {};
    var color = String(attrs.color || 'red').toLowerCase();
    var glow = GLOW[color] || color;
    var b = Math.max(0, Math.min(1, brightness == null ? 0 : brightness));
    var lightOn = b > 0.002;
    var opacity = b > 0 ? (0.3 + b * 0.7) : 0;
    var sfx = '_' + String(part.id).replace(/[^A-Za-z0-9_-]/g, '');
    var flip = attrs.flip != null;

    return '<g class="pcb-part" data-part="' + esc(part.id) + '" data-glow="' + esc(part.id) + '" ' +
      'transform="translate(' + num(part.left) + ',' + num(part.top) + ')' + (flip ? ' scale(-1 1) translate(-40 0)' : '') + '">' +
      '<svg width="40" height="50" viewBox="-10 -5 35.456 39.618" xmlns="http://www.w3.org/2000/svg">' +
      '<filter id="l1' + sfx + '" x="-0.8" y="-0.8" height="2.2" width="2.8"><feGaussianBlur stdDeviation="2"/></filter>' +
      '<filter id="l2' + sfx + '" x="-0.8" y="-0.8" height="2.2" width="2.8"><feGaussianBlur stdDeviation="4"/></filter>' +
      '<rect x="2.5099" y="20.382" width="2.1514" height="9.8273" fill="#8c8c8c"/>' +
      '<path d="m12.977 30.269c0-1.1736-0.86844-2.5132-1.8916-3.4024-0.41616-0.3672-1.1995-1.0015-1.1995-1.4249v-5.4706h-2.1614v5.7802c0 1.0584 0.94752 1.8785 1.9462 2.7482 0.44424 0.37584 1.3486 1.2496 1.3486 1.7694" fill="#8c8c8c"/>' +
      '<path d="m14.173 13.001v-5.9126c0-3.9132-3.168-7.0884-7.0855-7.0884-3.9125 0-7.0877 3.1694-7.0877 7.0884v13.649c1.4738 1.651 4.0968 2.7526 7.0877 2.7526 4.6195 0 8.3686-2.6179 8.3686-5.8594v-1.5235c-7.4e-4 -1.1426-0.47444-2.2039-1.283-3.1061z" opacity=".3"/>' +
      '<path d="m14.173 13.001v-5.9126c0-3.9132-3.168-7.0884-7.0855-7.0884-3.9125 0-7.0877 3.1694-7.0877 7.0884v13.649c1.4738 1.651 4.0968 2.7526 7.0877 2.7526 4.6195 0 8.3686-2.6179 8.3686-5.8594v-1.5235c-7.4e-4 -1.1426-0.47444-2.2039-1.283-3.1061z" fill="#e6e6e6" opacity=".5"/>' +
      '<path d="m14.173 13.001v3.1054c0 2.7389-3.1658 4.9651-7.0855 4.9651-3.9125 2e-5 -7.0877-2.219-7.0877-4.9651v4.6296c1.4738 1.6517 4.0968 2.7526 7.0877 2.7526 4.6195 0 8.3686-2.6179 8.3686-5.8586l-4e-5 -1.5235c-7e-4 -1.1419-0.4744-2.2032-1.283-3.1054z" fill="#d1d1d1" opacity=".9"/>' +
      '<g><path d="m14.173 13.001v3.1054c0 2.7389-3.1658 4.9651-7.0855 4.9651-3.9125 2e-5 -7.0877-2.219-7.0877-4.9651v4.6296c1.4738 1.6517 4.0968 2.7526 7.0877 2.7526 4.6195 0 8.3686-2.6179 8.3686-5.8586l-4e-5 -1.5235c-7e-4 -1.1419-0.4744-2.2032-1.283-3.1054z" opacity=".7"/>' +
      '<path d="m14.173 13.001v3.1054c0 2.7389-3.1658 4.9651-7.0855 4.9651-3.9125 2e-5 -7.0877-2.219-7.0877-4.9651v3.1054c1.4738 1.6502 4.0968 2.7526 7.0877 2.7526 4.6195 0 8.3686-2.6179 8.3686-5.8586-7.4e-4 -1.1412-0.47444-2.2025-1.283-3.1047z" opacity=".25"/>' +
      '<ellipse cx="7.0877" cy="16.106" rx="7.087" ry="4.9608" opacity=".25"/></g>' +
      '<polygon points="2.2032 16.107 3.1961 16.107 3.1961 13.095 6.0156 13.095 10.012 8.8049 3.407 8.8049 2.2032 9.648" fill="#666666"/>' +
      '<polygon points="11.215 9.0338 7.4117 13.095 11.06 13.095 11.06 16.107 11.974 16.107 11.974 8.5241 10.778 8.5241" fill="#666666"/>' +
      '<path d="m14.173 13.001v-5.9126c0-3.9132-3.168-7.0884-7.0855-7.0884-3.9125 0-7.0877 3.1694-7.0877 7.0884v13.649c1.4738 1.651 4.0968 2.7526 7.0877 2.7526 4.6195 0 8.3686-2.6179 8.3686-5.8594v-1.5235c-7.4e-4 -1.1426-0.47444-2.2039-1.283-3.1061z" fill="' + color + '" opacity=".65"/>' +
      '<g fill="#ffffff">' +
      '<path d="m10.388 3.7541 1.4364-0.2736c-0.84168-1.1318-2.0822-1.9577-3.5417-2.2385l0.25416 1.0807c0.76388 0.27072 1.4068 0.78048 1.8511 1.4314z" opacity=".5"/>' +
      '<path d="m0.76824 19.926v1.5199c0.64872 0.5292 1.4335 0.97632 2.3076 1.3169v-1.525c-0.8784-0.33624-1.6567-0.78194-2.3076-1.3118z" opacity=".5"/>' +
      '<path d="m11.073 20.21c-0.2556 0.1224-0.52992 0.22968-0.80568 0.32976-0.05832 0.01944-0.11736 0.04032-0.17784 0.05832-0.56376 0.17928-1.1614 0.31896-1.795 0.39456-0.07488 0.0094-0.1512 0.01872-0.22464 0.01944-0.3204 0.03024-0.64368 0.05832-0.97056 0.05832-0.14832 0-0.30744-0.01512-0.4716-0.02376-1.2002-0.05688-2.3306-0.31464-3.2976-0.73944l-2e-5 -8.3895v-4.8254c0-1.471 0.84816-2.7295 2.0736-3.3494l-0.02232-0.05328-1.2478-1.512c-1.6697 1.003-2.79 2.8224-2.79 4.9118v11.905c-0.04968-0.04968-0.30816-0.30888-0.48024-0.52992l-0.30744 0.6876c1.4011 1.4818 3.8088 2.4617 6.5426 2.4617 1.6798 0 3.2371-0.37368 4.5115-1.0022l-0.52704-0.40896-0.01006 0.0072z" opacity=".5"/>' +
      '</g>' +
      '<g class="pcb-light" style="display:' + (lightOn ? '' : 'none') + '">' +
      '<ellipse cx="8" cy="10" rx="10" ry="10" fill="' + glow + '" filter="url(#l2' + sfx + ')" style="opacity:' + opacity.toFixed(3) + '"/>' +
      '<ellipse cx="8" cy="10" rx="2" ry="2" fill="white" filter="url(#l1' + sfx + ')"/>' +
      '<ellipse cx="8" cy="10" rx="3" ry="3" fill="white" filter="url(#l1' + sfx + ')" style="opacity:' + opacity.toFixed(3) + '"/>' +
      '</g>' +
      '</svg></g>';
  }

  /* Resistor body: official outline at the official 3-band + tolerance layout. */
  function resSvg(part) {
    var attrs = part.attrs || {};
    var sfx = '_' + String(part.id).replace(/[^A-Za-z0-9_-]/g, '');
    var b = bands(attrs.value);
    return '<g class="pcb-part" data-part="' + esc(part.id) + '" transform="translate(' + num(part.left) + ',' + num(part.top) + ')">' +
      '<svg width="' + RES_W + '" height="' + RES_H + '" viewBox="0 0 15.645 3" xmlns="http://www.w3.org/2000/svg">' +
      '<defs><linearGradient id="rg' + sfx + '" x2="0" y1="22.332" y2="38.348" gradientTransform="matrix(.14479 0 0 .14479 -23.155 -4.0573)" gradientUnits="userSpaceOnUse" spreadMethod="reflect">' +
      '<stop stop-color="#323232" offset="0"/><stop stop-color="#fff" stop-opacity=".42268" offset="1"/></linearGradient>' +
      '<clipPath id="g' + sfx + '"><path d="m4.6918 0c-1.0586 0-1.9185 0.67468-1.9185 1.5022 0 0.82756 0.85995 1.4978 1.9185 1.4978 0.4241 0 0.81356-0.11167 1.1312-0.29411h4.0949c0.31802 0.18313 0.71075 0.29411 1.1357 0.29411 1.0586 0 1.9185-0.67015 1.9185-1.4978 0-0.8276-0.85995-1.5022-1.9185-1.5022-0.42499 0-0.81773 0.11098-1.1357 0.29411h-4.0949c-0.31765-0.18244-0.7071-0.29411-1.1312-0.29411z"/></clipPath></defs>' +
      '<rect y="1.1759" width="15.558" height=".63826" fill="#aaa"/>' +
      '<g stroke-width=".14479">' +
      '<path d="m4.6918 0c-1.0586 0-1.9185 0.67468-1.9185 1.5022 0 0.82756 0.85995 1.4978 1.9185 1.4978 0.4241 0 0.81356-0.11167 1.1312-0.29411h4.0949c0.31802 0.18313 0.71075 0.29411 1.1357 0.29411 1.0586 0 1.9185-0.67015 1.9185-1.4978 0-0.8276-0.85995-1.5022-1.9185-1.5022-0.42499 0-0.81773 0.11098-1.1357 0.29411h-4.0949c-0.31765-0.18244-0.7071-0.29411-1.1312-0.29411z" fill="#d5b597"/>' +
      '<path d="m4.6918 0c-1.0586 0-1.9185 0.67468-1.9185 1.5022 0 0.82756 0.85995 1.4978 1.9185 1.4978 0.4241 0 0.81356-0.11167 1.1312-0.29411h4.0949c0.31802 0.18313 0.71075 0.29411 1.1357 0.29411 1.0586 0 1.9185-0.67015 1.9185-1.4978 0-0.8276-0.85995-1.5022-1.9185-1.5022-0.42499 0-0.81773 0.11098-1.1357 0.29411h-4.0949c-0.31765-0.18244-0.7071-0.29411-1.1312-0.29411z" fill="url(#rg' + sfx + ')" opacity=".44886"/>' +
      '<rect x="4" y="0" width="1" height="3" fill="' + b[0] + '" clip-path="url(#g' + sfx + ')"/>' +
      '<path d="m6 0.29411v2.4117h0.96v-2.4117z" fill="' + b[1] + '"/>' +
      '<path d="m7.8 0.29411v2.4117h0.96v-2.4117z" fill="' + b[2] + '"/>' +
      '<rect x="10.69" y="0" width="1" height="3" fill="#F1D863" clip-path="url(#g' + sfx + ')"/>' +
      '</g></svg></g>';
  }

  /* ------------------------------------------------------------- routing */
  /* Orthogonal polylines only. A real board is wired around its edge; a
     bezier straight through the PCB looks wrong and hides which pin is
     which. Lane counters keep parallel runs from overlapping. */
  function makeRouter(dia, index, mode) {
    mode = mode || 'avoid';
    var board = null, i;
    for (i = 0; i < dia.parts.length; i++) if (isBoard(dia.parts[i].type)) board = dia.parts[i];
    if (!board) return null;
    var bsize = sizeOf(board);
    var bx0 = board.left, by0 = board.top;
    var bx1 = bx0 + bsize[0], by1 = by0 + bsize[1];
    var lanes = { top: 0, bot: 0 };
    /* Vertical channels: every wire that steps out of the header gets its own
       x offset. Without this, all wires leaving the same side turn at the same
       x and stack into one thick band that no longer reads as separate wires. */
    var vlanes = { L: 0, R: 0 };
    var LANE_V = 5;
    /* How many parallel channels fit before the wires would run into the parts
       sitting beside the board. Everything scales off the real layout instead
       of a magic number, so a dense diagram degrades gracefully. */
    function roomFor(gap) {
      if (!isFinite(gap)) return 6;
      return Math.max(1, Math.min(6, Math.floor((gap - GAP - 3) / LANE_V) + 1));
    }
    var gL = Infinity, gR = Infinity;
    dia.parts.forEach(function (p) {
      if (isBoard(p.type)) return;
      var w = sizeOf(p)[0];
      if (p.left >= bx1) gR = Math.min(gR, p.left - bx1);
      if (p.left + w <= bx0) gL = Math.min(gL, bx0 - (p.left + w));
    });
    var VMAX = { L: roomFor(gL), R: roomFor(gR) };
    function takeDepth(side) {
      var n = vlanes[side] % VMAX[side];
      vlanes[side]++;
      return GAP + n * LANE_V;
    }

    function absPin(ref) {
      var k = String(ref).indexOf(':');
      if (k < 0) return null;
      var pid = ref.slice(0, k), name = ref.slice(k + 1);
      if (pid.charAt(0) === '$') return null;
      var p = index[pid];
      if (!p) return null;
      var pl = pinsOf(p);
      if (!pl[name]) return null;
      if (!p.rotate) return [p.left + pl[name][0], p.top + pl[name][1]];
      var r = rotatePt(p, pl[name]);
      return [p.left + r[0], p.top + r[1]];
    }

    /* Which edge of its footprint a pin sits on. Decided by position, not by a
       per-board table, so it works for any part whose pinsOf() we know. */
    function edgeOf(part, pt) {
      var sz = sizeOf(part), w = sz[0], h = sz[1];
      if (pt[0] <= w * 0.1) return 'L';
      if (pt[0] >= w * 0.9) return 'R';
      if (pt[1] <= h * 0.1) return 'T';
      if (pt[1] >= h * 0.9) return 'B';
      var d = [pt[0], w - pt[0], pt[1], h - pt[1]];
      var m = Math.min(d[0], d[1], d[2], d[3]);
      return m === d[0] ? 'L' : (m === d[1] ? 'R' : (m === d[2] ? 'T' : 'B'));
    }
    function sideOf(ref) {
      var k = String(ref).indexOf(':');
      if (k < 0) return null;
      var pid = ref.slice(0, k), name = ref.slice(k + 1);
      var p = index[pid];
      if (!p || !isBoard(p.type)) return null;
      var pl = pinsOf(p);
      return pl[name] ? edgeOf(p, pl[name]) : null;
    }

    /* Outward unit vector for a pin, snapped to an axis: a rotated part would
       otherwise emit diagonal stubs, and every segment here must be orthogonal. */
    var DIRV = { L: [-1, 0], R: [1, 0], T: [0, -1], B: [0, 1] };
    function exitVec(ref) {
      var k = String(ref).indexOf(':');
      if (k < 0) return null;
      var pid = ref.slice(0, k), name = ref.slice(k + 1);
      var p = index[pid];
      if (!p) return null;
      var pl = pinsOf(p);
      if (!pl[name]) return null;
      var v = DIRV[edgeOf(p, pl[name])].slice();
      if (p.rotate) {
        var a = p.rotate * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
        var vx = v[0] * c - v[1] * s, vy = v[0] * s + v[1] * c;
        v = Math.abs(vx) >= Math.abs(vy) ? [vx > 0 ? 1 : -1, 0] : [0, vy > 0 ? 1 : -1];
      }
      return v;
    }

    function dedupe(pts) {
      var out = [];
      for (var i = 0; i < pts.length; i++) {
        var p = pts[i], q = out[out.length - 1];
        if (q && Math.abs(p[0] - q[0]) < 0.01 && Math.abs(p[1] - q[1]) < 0.01) continue;
        if (out.length >= 2) {
          var r = out[out.length - 2];
          var col = (Math.abs(r[0] - q[0]) < 0.01 && Math.abs(q[0] - p[0]) < 0.01) ||
                    (Math.abs(r[1] - q[1]) < 0.01 && Math.abs(q[1] - p[1]) < 0.01);
          if (col) { out[out.length - 1] = p; continue; }
        }
        out.push(p);
      }
      return out;
    }

    /* Direct routing: step out of each pin along its own edge, then join the two
       stubs orthogonally. Used when the parts surround the board (a ring of 32
       servos cannot be wired with edge-hugging lanes: it would need 30 lanes
       running off the canvas), and as the fallback for boards whose pins face
       up or down, which the lane router does not model. */
    function routeDirect(a, b, pa, pb) {
      var va = exitVec(a) || [1, 0], vb = exitVec(b) || [1, 0];
      var d = 14;
      var a1 = [pa[0] + va[0] * d, pa[1] + va[1] * d];
      var b1 = [pb[0] + vb[0] * d, pb[1] + vb[1] * d];
      var pts;
      if (va[1] === 0 && vb[1] === 0) {
        var mx = (a1[0] + b1[0]) / 2;
        pts = [pa, a1, [mx, a1[1]], [mx, b1[1]], b1, pb];
      } else if (va[0] === 0 && vb[0] === 0) {
        var my = (a1[1] + b1[1]) / 2;
        pts = [pa, a1, [a1[0], my], [b1[0], my], b1, pb];
      } else if (va[1] === 0) {
        pts = [pa, a1, [b1[0], a1[1]], b1, pb];
      } else {
        pts = [pa, a1, [a1[0], b1[1]], b1, pb];
      }
      return dedupe(pts);
    }

    /* Wires that touch no header still have to get from one part to the next
       without being drawn over the board. Instead of special-casing every
       combination of sides, propose a handful of orthogonal shapes, measure
       how much of each would land on the PCB, and keep the best. The two
       plain bends are the old behaviour, so a diagram that already routed
       cleanly cannot get worse. */
    var lc = { top: 0, bot: 0, L: 0, R: 0 };
    function routeFree(pa, pb) {
      var t0 = by0 - CLEAR - lc.top * LANE, b0 = by1 + CLEAR + lc.bot * LANE;
      var l0 = bx0 - GAP - lc.L * LANE_V, r0 = bx1 + GAP + lc.R * LANE_V;
      var cands = [
        { lane: null, pts: [[pa[0], pa[1]], [pb[0], pa[1]], [pb[0], pb[1]]] },
        { lane: null, pts: [[pa[0], pa[1]], [pa[0], pb[1]], [pb[0], pb[1]]] },
        { lane: 'top', pts: [[pa[0], pa[1]], [pa[0], t0], [pb[0], t0], [pb[0], pb[1]]] },
        { lane: 'bot', pts: [[pa[0], pa[1]], [pa[0], b0], [pb[0], b0], [pb[0], pb[1]]] },
        { lane: 'R', pts: [[pa[0], pa[1]], [r0, pa[1]], [r0, pb[1]], [pb[0], pb[1]]] },
        { lane: 'L', pts: [[pa[0], pa[1]], [l0, pa[1]], [l0, pb[1]], [pb[0], pb[1]]] },
        { lane: 'topR', pts: [[pa[0], pa[1]], [pa[0], t0], [r0, t0], [r0, pb[1]], [pb[0], pb[1]]] },
        { lane: 'botR', pts: [[pa[0], pa[1]], [pa[0], b0], [r0, b0], [r0, pb[1]], [pb[0], pb[1]]] },
        { lane: 'topL', pts: [[pa[0], pa[1]], [pa[0], t0], [l0, t0], [l0, pb[1]], [pb[0], pb[1]]] },
        { lane: 'botL', pts: [[pa[0], pa[1]], [pa[0], b0], [l0, b0], [l0, pb[1]], [pb[0], pb[1]]] }
      ];
      var best = null;
      cands.forEach(function (c) {
        var p = dedupe(c.pts), over = 0, len = 0, i;
        for (i = 0; i < p.length - 1; i++) {
          over += segOverlap(p[i], p[i + 1], [bx0, by0], [bx1, by1]);
          len += Math.abs(p[i + 1][0] - p[i][0]) + Math.abs(p[i + 1][1] - p[i][1]);
        }
        /* strictly fewer crossings wins; on a tie, the shorter run (which is
           also the one with fewer elbows, since both are orthogonal) */
        if (!best || over < best.over - 0.01 ||
            (Math.abs(over - best.over) <= 0.01 && len < best.len - 0.01)) {
          best = { pts: p, over: over, len: len, lane: c.lane };
        }
      });
      if (best && best.lane) {
        var keys = { topR: ['top', 'R'], botR: ['bot', 'R'], topL: ['top', 'L'], botL: ['bot', 'L'] };
        (keys[best.lane] || [best.lane]).forEach(function (k) { lc[k]++; });
      }
      return best ? best.pts : [[pa[0], pa[1]], [pb[0], pb[1]]];
    }

    function route(a, b, pa, pb) {
      var x1 = pa[0], y1 = pa[1], x2 = pb[0], y2 = pb[1];
      var sa = sideOf(a), sb = sideOf(b);
      if (mode === 'direct') return routeDirect(a, b, pa, pb);
      /* the lane router only knows left/right headers */
      if ((sa && sa !== 'L' && sa !== 'R') || (sb && sb !== 'L' && sb !== 'R')) {
        return routeDirect(a, b, pa, pb);
      }
      if (!sa && !sb) return routeFree(pa, pb);

      if (sa && sb && sa === sb) {
        if (Math.abs(y1 - y2) < 1) return [[x1, y1], [x2, y2]];
        /* A double-row header puts one column inside the footprint, so the
           turn has to be measured from the board edge, not from the pin. */
        var d3 = takeDepth(sa);
        var ch = sa === 'L' ? Math.min(x1, x2, bx0) - d3 : Math.max(x1, x2, bx1) + d3;
        return [[x1, y1], [ch, y1], [ch, y2], [x2, y2]];
      }

      var pairs = [[sa, pa, pb, b], [sb, pb, pa, a]];
      for (var i = 0; i < 2; i++) {
        var s = pairs[i][0];
        if (!s) continue;
        var p1 = pairs[i][1], p2 = pairs[i][2], other = pairs[i][3];
        var ox = p1[0], oy = p1[1], tx = p2[0], ty = p2[1];
        var depth = takeDepth(s);
        /* Same trap as above: the turn must clear the edge, not the pin, or a
           double-row column drags the run across the PCB. */
        var out = s === 'L' ? Math.min(ox - depth, bx0 - depth) : Math.max(ox + depth, bx1 + depth);
        var sameSide = (s === 'L' && tx < bx0) || (s === 'R' && tx > bx1);
        if (sameSide) return [[ox, oy], [out, oy], [out, ty], [tx, ty]];

        var mid = (by0 + by1) / 2, wy, back;
        if (ty < mid && Math.abs(ty - by0) <= Math.abs(ty - by1)) {
          wy = by0 - CLEAR - lanes.top * LANE; lanes.top++;
        } else {
          wy = by1 + CLEAR + lanes.bot * LANE; lanes.bot++;
        }
        /* Which edge the target sits on decides where the last leg drops in.
           Deciding by "tx < bx0" is wrong: a header pin lives INSIDE the
           footprint, and that mistake draws the wire straight across the PCB. */
        var tside = tx > bx1 ? 'R' : (tx < bx0 ? 'L' : sideOf(other));
        var d2 = takeDepth(tside === 'L' ? 'L' : 'R');
        if (tside === 'L') back = bx0 - d2;
        else back = bx1 + d2;
        return [[ox, oy], [out, oy], [out, wy], [back, wy], [back, ty], [tx, ty]];
      }

      if (Math.abs(y1 - y2) < 1) return [[x1, y1], [x2, y2]];
      var mx2 = (x1 + x2) / 2;
      return [[x1, y1], [mx2, y1], [mx2, y2], [x2, y2]];
    }

    return { route: route, routeDirect: routeDirect, absPin: absPin, edgeOf: edgeOf,
             bx0: bx0, by0: by0, bx1: bx1, by1: by1, lanes: lanes };
  }

  /* --------------------------------------------------------------- audit */
  /* Liang-Barsky overlap of a segment against the board rectangle. A segment
     that ends on a header pin is allowed to sit inside: that stub is the pin
     lead itself. Anything else crossing the PCB is a routing bug. */
  function segOverlap(p, q, r0, r1) {
    var x0 = p[0], y0 = p[1], x1 = q[0], y1 = q[1];
    var dx = x1 - x0, dy = y1 - y0, t0 = 0, t1 = 1;
    var lim = [[-dx, x0 - r0[0]], [dx, r1[0] - x0], [-dy, y0 - r0[1]], [dy, r1[1] - y0]];
    for (var i = 0; i < 4; i++) {
      var pp = lim[i][0], qq = lim[i][1];
      if (Math.abs(pp) < 1e-12) { if (qq < 0) return 0; }
      else {
        var t = qq / pp;
        if (pp < 0) { if (t > t0) t0 = t; } else { if (t < t1) t1 = t; }
      }
    }
    if (t1 - t0 <= 1e-9) return 0;
    return Math.sqrt(Math.pow(dx * (t1 - t0), 2) + Math.pow(dy * (t1 - t0), 2));
  }

  function audit(dia, routed, mode) {
    var r = makeRouter(dia, byId(dia), mode), offenders = [];
    if (!r) return { wires: 0, crossings: 0, offenders: [], excused: 0, mode: mode };
    /* Every pin of every part, not just the header. A part parked on the board
       edge (the 32-servo ring does exactly that at every corner) puts its own
       pin inside the footprint, and the lead out of it has to start there.
       That is a layout fact, not a routing choice, so it is counted
       separately as an excused lead instead of being blamed on the router. */
    var pinPts = [];
    dia.parts.forEach(function (p) {
      var pl = pinsOf(p);
      Object.keys(pl).forEach(function (n) {
        var q = p.rotate ? rotatePt(p, pl[n]) : pl[n];
        pinPts.push([p.left + q[0], p.top + q[1]]);
      });
    });
    var n = 0, excused = 0;
    routed.forEach(function (w) {
      n++;
      for (var i = 0; i < w.pts.length - 1; i++) {
        var pa = w.pts[i], pb = w.pts[i + 1];
        if (segOverlap(pa, pb, [r.bx0, r.by0], [r.bx1, r.by1]) <= 0.01) continue;
        var legal = false;
        [pa, pb].forEach(function (end) {
          pinPts.forEach(function (xy) {
            if (Math.abs(end[0] - xy[0]) < 0.6 && Math.abs(end[1] - xy[1]) < 0.6) legal = true;
          });
        });
        if (legal) { excused++; continue; }
        offenders.push({ wire: w.title, from: pa, to: pb });
      }
    });
    return { wires: n, crossings: offenders.length, offenders: offenders,
             excused: excused, mode: mode || 'avoid' };
  }

  /* -------------------------------------------------------------- render */
  function byId(dia) {
    var m = {};
    (dia.parts || []).forEach(function (p) { m[p.id] = p; });
    return m;
  }

  function nudge(dia) {
    /* A part whose box overlaps the PCB is a layout defect in diagram.json
       (remote-switch shipped its resistor 7 units inside the board). Push it
       out to the free gutter so no wire is forced through the board. */
    var board = null, i;
    for (i = 0; i < dia.parts.length; i++) if (isBoard(dia.parts[i].type)) board = dia.parts[i];
    if (!board) return;
    var bsz = sizeOf(board);
    var bx0 = board.left, by0 = board.top, bx1 = bx0 + bsz[0], by1 = by0 + bsz[1];
    dia.parts.forEach(function (p) {
      if (isBoard(p.type)) return;
      var sz = sizeOf(p);
      if (!(p.left < bx1 && p.left + sz[0] > bx0 && p.top < by1 && p.top + sz[1] > by0)) return;
      p.left = bx1 + 24;
      dia.parts.forEach(function (o) {
        if (o === p || isBoard(o.type)) return;
        var osz = sizeOf(o);
        if (Math.abs(o.top - p.top) < 14 && p.left < o.left + osz[0] && p.left + sz[0] > o.left) {
          p.left = o.left + osz[0] + 20;
        }
      });
    });
  }

  function render(diagram, opts) {
    opts = opts || {};
    var dia = typeof diagram === 'string' ? JSON.parse(diagram) : diagram;
    /* deep-ish copy so nudging never mutates the caller's object */
    dia = JSON.parse(JSON.stringify(dia));
    nudge(dia);

    var index = byId(dia);
    var bright = opts.brightness || {};
    var showLabels = opts.labels !== false;
    var showPins = opts.pins !== false;
    var hints = opts.hints !== false;
    var unusedWord = (opts.i18n && opts.i18n.unused) || 'unused';
    var board = null, i;
    for (i = 0; i < dia.parts.length; i++) if (isBoard(dia.parts[i].type)) board = dia.parts[i];
    if (!board) {
      throw new Error('diagram.json has no supported board. Known: ' +
        Object.keys(BOARDS).join(', ') + '. Add one to BOARDS in pcbview.js ' +
        '(pin coordinates are in @wokwi/elements) instead of guessing.');
    }
    var boardPins = boardOf(board.type).pins;
    var bsz = sizeOf(board);

    var bx0 = board.left, by0 = board.top, bx1 = bx0 + bsz[0], by1 = by0 + bsz[1];
    var routed = [], i2;

    /* route before laying out: the wrap lanes feed into the viewBox */
    var routeMode = opts.route === 'direct' ? 'direct' : 'avoid';
    var router = makeRouter(dia, index, routeMode);
    if (!router) throw new Error('diagram.json has no supported board');
    for (i2 = 0; i2 < (dia.connections || []).length; i2++) {
      var conn = dia.connections[i2];
      var a = conn[0], b = conn[1], col = conn[2] || 'green';
      var pa = router.absPin(a), pb = router.absPin(b);
      if (!pa || !pb) continue;
      routed.push({ title: a + ' \u2192 ' + b, color: col, pts: router.route(a, b, pa, pb) });
    }

    /* 98 wires at full weight merge into one blob; a 32-servo ring is a
       harness, and drawing it thinner is what makes it readable as wires. */
    var sw = routed.length > 40 ? 1.3 : 2.3;
    var wires = routed.map(function (w) {
      var d = 'M' + w.pts.map(function (p) { return num(p[0]) + ' ' + num(p[1]); }).join(' L');
      return '<path class="pcb-wire" d="' + d + '" fill="none" stroke="' + (WIRE[w.color] || w.color) +
        '" stroke-width="' + sw + '" stroke-linecap="round" stroke-linejoin="round"><title>' +
        esc(w.title) + '</title></path>';
    });

    var bodies = dia.parts.map(function (p) {
      if (isBoard(p.type)) return boardSvg(p, '_' + String(p.id).replace(/[^A-Za-z0-9_-]/g, ''));
      if (p.type === 'wokwi-led') return ledSvg(p, bright[p.id]);
      if (p.type === 'wokwi-resistor') return resSvg(p);
      if (p.type === 'wokwi-servo') return servoSvg(p);
      return '';
    });

    /* Which header pins the circuit touches, and what each one feeds. Built
       from the connections alone, so it stays true when diagram.json changes. */
    var used = {}, pinLinks = {};
    (dia.connections || []).forEach(function (c2) {
      var refs = [c2[0], c2[1]];
      refs.forEach(function (ref, ix) {
        if (String(ref).charAt(0) === '$') return;
        var k = String(ref).indexOf(':');
        if (k < 0) return;
        var pid = ref.slice(0, k), nm = ref.slice(k + 1);
        if (!index[pid] || !isBoard(index[pid].type)) return;
        used[pid + ':' + nm] = 1;
        (pinLinks[nm] || (pinLinks[nm] = [])).push(String(refs[1 - ix]));
      });
    });

    /* Pin names as silkscreen - ALL of them, the way a real board is printed.
       Only the used ones are brightened, which is what draws the eye; hiding
       the rest made "what is this empty pin?" unanswerable.

       Left/right rows get horizontal text along the board. Top and bottom rows
       are only 9.5 units apart, so horizontal text would collide: those labels
       are rotated to read along the pin column, bottom-to-top, like silkscreen. */
    var labels = [];
    var pinNames = boardOf(board.type).order || Object.keys(boardPins);
    /* A label is printed upright only where there is room for it. Two pins
       sharing a row (the Mega's double header) or a horizontal header both
       force the text to run along the column instead, or the names print on
       top of each other. */
    var sideways = {};
    var sideCols = { L: [], R: [] };
    pinNames.forEach(function (nm) {
      var p = boardPins[nm], e = router.edgeOf(board, p);
      if (e === 'T' || e === 'B') { sideways[nm] = 1; return; }
      for (var j = 0; j < pinNames.length; j++) {
        var q = boardPins[pinNames[j]];
        if (pinNames[j] !== nm && Math.abs(q[1] - p[1]) < 1 &&
            router.edgeOf(board, q) === e) { sideways[nm] = 1; sideCols[e].push(board.left + p[0]); return; }
      }
    });
    if (showLabels) {
      pinNames.forEach(function (nm) {
        var xy = router.absPin(board.id + ':' + nm);
        if (!xy) return;
        var cls = 'pcb-pinlab' + (used[board.id + ':' + nm] ? ' used' : '');
        var halo = '" paint-order="stroke" stroke="#1a1a1a" stroke-width="1.5" stroke-linejoin="round"';
        var e = router.edgeOf(board, boardPins[nm]);
        var t, ax, ay;
        if (!sideways[nm]) {
          t = '<text x="' + num(e === 'L' ? bx0 + 9.0 : bx1 - 9.0) + '" y="' + num(xy[1] + 1.6) +
            '" class="' + cls + halo + ' text-anchor="' + (e === 'L' ? 'start' : 'end') + '">' + esc(nm) + '</text>';
        } else if (e === 'L' || e === 'R') {
          /* Double column: the text runs up the board beside its own pad. Two
             columns are only 10 units apart and a pad is 3.4 wide, so there is
             no gutter between them. The inner column is named inboard of
             itself; the outer one is named in the margin inside the board edge.
             Offsetting everything outward printed the outer names off the PCB
             (its pads sit on the edge) and the inner names on the far pads. */
          var cols = sideCols[e] || [xy[0]];
          var outer = e === 'R' ? xy[0] >= Math.max.apply(null, cols) - 0.5
                                : xy[0] <= Math.min.apply(null, cols) + 0.5;
          ax = outer ? (e === 'R' ? bx1 - 4.0 : bx0 + 4.0)
                     : xy[0] + (e === 'R' ? -6.2 : 6.2);
          ay = xy[1];
          t = '<text x="' + num(ax) + '" y="' + num(ay) + '" transform="rotate(-90 ' + num(ax) + ' ' + num(ay) +
            ')" class="' + cls + halo + ' text-anchor="middle">' + esc(nm) + '</text>';
        } else {
          /* top row: text hangs down into the board; bottom row: it climbs up */
          ax = xy[0] + 1.6; ay = e === 'T' ? by0 + 16 : by1 - 16;
          t = '<text x="' + num(ax) + '" y="' + num(ay) + '" transform="rotate(-90 ' + num(ax) + ' ' + num(ay) +
            ')" class="' + cls + halo + ' text-anchor="' + (e === 'T' ? 'end' : 'start') + '">' + esc(nm) + '</text>';
        }
        labels.push(t);
      });
    }
    if (showPins) {
      Object.keys(used).forEach(function (k) {
        var xy = router.absPin(k);
        if (xy) labels.push('<circle cx="' + num(xy[0]) + '" cy="' + num(xy[1]) +
          '" r="1.9" fill="none" stroke="#22d3ee" stroke-width=".7" opacity=".9"/>');
      });
    }

    /* Hover hotspot on every pin, used or not. r is under half the 9.5 pitch so
       neighbouring targets never fight. fill must be "transparent" rather than
       "none": an unfilled shape does not receive pointer events at all. */
    var hot = [];
    if (hints) {
      pinNames.forEach(function (nm) {
        var xy = router.absPin(board.id + ':' + nm);
        if (!xy) return;
        var links = pinLinks[nm];
        var tip = nm + ' \u00b7 ' +
          (links ? '\u2192 ' + links.join(', ') : '(' + unusedWord + ')');
        hot.push('<circle class="pcb-pin" cx="' + num(xy[0]) + '" cy="' + num(xy[1]) +
          '" r="4.3" fill="transparent" data-pin="' + esc(nm) + '">' +
          '<title>' + esc(tip) + '</title></circle>');
      });
    }

    /* viewBox: everything drawn, plus room for the wire wrap lanes.
       `frame` is the bounding box of the parts alone, without padding or wire
       lanes; the viewBox has to contain it or the drawing is cropped. */
    var xs = [], ys = [];
    var fx0 = Infinity, fy0 = Infinity, fx1 = -Infinity, fy1 = -Infinity;
    dia.parts.forEach(function (p) {
      var sz = sizeOf(p);
      var x0 = p.left, y0 = p.top, x1 = p.left + sz[0], y1 = p.top + sz[1];
      if (p.rotate) {
        /* A rotated part sticks out of its unrotated footprint: a servo turned
           by 11 degrees is 30 units taller than its box, so left/top + size
           clipped 15 units off the horns at the bottom of the ring. Take the
           rotated bounding box instead - it is exact, not padding. */
        var a = p.rotate * Math.PI / 180;
        var w = Math.abs(sz[0] * Math.cos(a)) + Math.abs(sz[1] * Math.sin(a));
        var h = Math.abs(sz[0] * Math.sin(a)) + Math.abs(sz[1] * Math.cos(a));
        var cx = p.left + sz[0] / 2, cy = p.top + sz[1] / 2;
        x0 = cx - w / 2; x1 = cx + w / 2; y0 = cy - h / 2; y1 = cy + h / 2;
      }
      xs.push(x0, x1); ys.push(y0, y1);
      fx0 = Math.min(fx0, x0); fy0 = Math.min(fy0, y0);
      fx1 = Math.max(fx1, x1); fy1 = Math.max(fy1, y1);
    });
    xs.push(bx0 - 6, bx1 + 6);
    /* Reserve only the wrap lanes that were actually used. Reserving a fixed
       five always left a dead band on the side with no wrap, which showed up
       as a small drawing floating in a tall box. */
    ys.push(by0 - CLEAR - Math.max(0, router.lanes.top - 1) * LANE,
            by1 + CLEAR + Math.max(0, router.lanes.bot - 1) * LANE);
    var PAD = 15;
    var vx = Math.min.apply(null, xs) - PAD, vy = Math.min.apply(null, ys) - PAD;
    var vw = Math.max.apply(null, xs) - Math.min.apply(null, xs) + 2 * PAD;
    var vh = Math.max.apply(null, ys) - Math.min.apply(null, ys) + 2 * PAD;

    var svg = '<svg class="pcb-svg" viewBox="' + [num(vx), num(vy), num(vw), num(vh)].join(' ') +
      '" role="img" aria-label="circuit diagram parsed from diagram.json">' +
      '<rect x="' + num(vx) + '" y="' + num(vy) + '" width="' + num(vw) + '" height="' + num(vh) +
      '" fill="#f4f7fc"/>' +
      bodies.join('') +
      '<g class="pcb-wires">' + wires.join('') + '</g>' +
      '<g class="pcb-labels">' + labels.join('') + '</g>' +
      '<g class="pcb-hints">' + hot.join('') + '</g>' +
      '</svg>';

    return {
      svg: svg,
      viewBox: [vx, vy, vw, vh],
      frame: { x: fx0, y: fy0, w: fx1 - fx0, h: fy1 - fy0 },
      wires: routed.length,
      parts: dia.parts.length,
      pins: { used: Object.keys(used).length, total: pinNames.length },
      audit: audit(dia, routed, routeMode)
    };
  }

  /* The horn pivots about this point in the servo's own coordinate space. */
  function hornTransform(deg) {
    return 'translate(91.467 59.773) rotate(' + (Math.round((deg || 0) * 10) / 10) +
      ') translate(-91.467 -59.773)';
  }

  /* Aim one servo without rebuilding the drawing - 32 horns have to move per
     frame, and re-rendering 157KB of SVG each time is not an option. */
  function setAngle(root, partId, deg) {
    if (!root || !root.querySelector) return false;
    var g = root.querySelector('[data-part="' + String(partId).replace(/"/g, '') + '"]');
    if (!g || !g.querySelector) return false;
    var horn = g.querySelector('path[data-horn]');
    if (!horn) return false;
    horn.setAttribute('transform', hornTransform(deg));
    return true;
  }

  /* Live brightness update without rebuilding the whole drawing. */
  function setBrightness(root, partId, value) {
    if (!root || !root.querySelector) return false;
    var g = root.querySelector('[data-glow="' + String(partId).replace(/"/g, '') + '"]');
    if (!g) return false;
    var light = g.querySelector('.pcb-light');
    if (!light) return false;
    var b = Math.max(0, Math.min(1, value == null ? 0 : value));
    var on = b > 0.002;
    light.style.display = on ? '' : 'none';
    var op = (b > 0 ? 0.3 + b * 0.7 : 0).toFixed(3);
    var ell = light.querySelectorAll('ellipse');
    for (var i = 0; i < ell.length; i++) {
      if (ell[i].getAttribute('filter')) ell[i].style.opacity = op;
    }
    return true;
  }

  return { render: render, audit: function (d) {
    var dia = typeof d === 'string' ? JSON.parse(d) : JSON.parse(JSON.stringify(d));
    nudge(dia);
    var router = makeRouter(dia, byId(dia)), routed = [];
    (dia.connections || []).forEach(function (c) {
      var pa = router.absPin(c[0]), pb = router.absPin(c[1]);
      if (!pa || !pb) return;
      routed.push({ title: c[0] + ' \u2192 ' + c[1], pts: router.route(c[0], c[1], pa, pb) });
    });
    return audit(dia, routed);
  }, setBrightness: setBrightness, setAngle: setAngle, hornTransform: hornTransform,
     VERSION: '1.2.0' };
})();
