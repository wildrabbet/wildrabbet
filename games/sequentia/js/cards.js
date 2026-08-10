/*!
 * Sequentia — SQ.Cards
 * Procedural, resolution-independent SVG playing cards.
 *
 * Plain classic browser script. No modules, no dependencies, no build step.
 * Attaches to window.SQ.Cards.
 *
 * All rendering is pure string concatenation (no DOM APIs) except el()/backEl(),
 * which parse the string once.
 *
 * Every <defs> id is namespaced with an internal incrementing counter, so the
 * same card may be rendered any number of times on one page without ever
 * producing duplicate DOM ids.
 */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Geometry
   * ------------------------------------------------------------------ */

  var W = 240;              // viewBox width  (2.5in)
  var H = 336;              // viewBox height (3.5in)
  var CX = 120, CY = 168;   // centre
  var CORNER = 14;          // corner radius

  var FONT = "Georgia,'Times New Roman',Times,serif";

  // Corner index block
  var IX = 27;              // centre-x of the index column
  var IX_RANK_Y = 50;       // rank baseline
  var IX_GLYPH_Y = 68;      // suit glyph centre-y
  var IX_GLYPH_S = 21;      // suit glyph size

  // Pip field
  var COL_L = 76, COL_R = 164, COL_C = 120;
  var ROW_T = 88, ROW_M = 168, ROW_B = 248;
  var ROW_4A = 88, ROW_4B = 141, ROW_4C = 195, ROW_4D = 248;
  var PIP = 40;             // standard pip size
  var ACE = 118;            // ace glyph size

  // Court panel
  var P_X = 44, P_Y = 56, P_W = 152, P_H = 224;   // 44..196 x 56..280

  /* ------------------------------------------------------------------ *
   * Identity tables
   * ------------------------------------------------------------------ */

  var RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K'];
  var SUITS = ['S', 'H', 'D', 'C'];

  var SUIT_NAME  = { S: 'spades',   H: 'hearts',   D: 'diamonds', C: 'clubs'  };
  var SUIT_TITLE = { S: 'Spades',   H: 'Hearts',   D: 'Diamonds', C: 'Clubs'  };
  var RANK_TITLE = { A: 'Ace', T: '10', J: 'Jack', Q: 'Queen', K: 'King' };

  /* Suit palettes.  Hearts and diamonds are two related crimsons; spades and
     clubs are two related charcoals — never pure black, never fire-engine red. */
  var PAL = {
    S: { color: 'black', hi: '#31373f', main: '#15171c', lo: '#040507',
         wash: 0.16, hatch: 0.09, washColor: '#6b5c3d' },
    C: { color: 'black', hi: '#414b58', main: '#252b34', lo: '#0c0f14',
         wash: 0.17, hatch: 0.1,  washColor: '#5d5a44' },
    H: { color: 'red',   hi: '#d5262f', main: '#b3111f', lo: '#780812',
         wash: 0.15, hatch: 0.08, washColor: '#b3111f' },
    D: { color: 'red',   hi: '#e6474f', main: '#cf2233', lo: '#8d0f1c',
         wash: 0.16, hatch: 0.085, washColor: '#cf2233' }
  };

  /* ------------------------------------------------------------------ *
   * Suit glyphs — hand-authored paths in a normalised 100 x 100 box.
   * Reused everywhere via a translate/rotate/scale transform.
   * ------------------------------------------------------------------ */

  var GLYPH = {
    S: '<path d="M50 4C44 14 30 25 20 35C12 43 9 49 9 57C9 71 19 81 31 81' +
       'C39 81 45 77 48 72C47 82 41 90 30 96L70 96C59 90 53 82 52 72' +
       'C55 77 61 81 69 81C81 81 91 71 91 57C91 49 88 43 80 35C70 25 56 14 50 4Z"/>',

    H: '<path d="M50 93C30 78 6 58 6 36C6 20 18 8 32 8C41 8 47 13 50 20' +
       'C53 13 59 8 68 8C82 8 94 20 94 36C94 58 70 78 50 93Z"/>',

    D: '<path d="M50 3L94 50L50 97L6 50Z"/>',

    C: '<circle cx="50" cy="28" r="24"/>' +
       '<circle cx="27" cy="56" r="23"/>' +
       '<circle cx="73" cy="56" r="23"/>' +
       '<path d="M43 46C50 66 46 82 29 96L71 96C54 82 50 66 57 46Z"/>'
  };

  /* ------------------------------------------------------------------ *
   * Helpers
   * ------------------------------------------------------------------ */

  var seq = 0;
  function ns() { seq += 1; return 'sqc' + seq; }

  function num(v) { return String(Math.round(v * 100) / 100); }

  /* Place a suit glyph: centred at (cx,cy), `size` tall/wide, optionally
     rotated 180 degrees (as pips in the lower half of a card must be). */
  function glyph(suit, cx, cy, size, flip) {
    var k = size / 100;
    return '<g transform="translate(' + num(cx) + ' ' + num(cy) + ')' +
      (flip ? ' rotate(180)' : '') +
      ' scale(' + num(k) + ') translate(-50 -50)">' + GLYPH[suit] + '</g>';
  }

  /* ------------------------------------------------------------------ *
   * Pip layouts — the canonical traditional arrangements.
   * ------------------------------------------------------------------ */

  function cols4() {
    return [
      [COL_L, ROW_4A], [COL_R, ROW_4A],
      [COL_L, ROW_4B], [COL_R, ROW_4B],
      [COL_L, ROW_4C], [COL_R, ROW_4C],
      [COL_L, ROW_4D], [COL_R, ROW_4D]
    ];
  }
  function cols3() {
    return [
      [COL_L, ROW_T], [COL_R, ROW_T],
      [COL_L, ROW_M], [COL_R, ROW_M],
      [COL_L, ROW_B], [COL_R, ROW_B]
    ];
  }

  var LAYOUT = {
    '2': [[COL_C, ROW_T], [COL_C, ROW_B]],
    '3': [[COL_C, ROW_T], [COL_C, ROW_M], [COL_C, ROW_B]],
    '4': [[COL_L, ROW_T], [COL_R, ROW_T], [COL_L, ROW_B], [COL_R, ROW_B]],
    '5': [[COL_L, ROW_T], [COL_R, ROW_T], [COL_C, ROW_M], [COL_L, ROW_B], [COL_R, ROW_B]],
    '6': cols3(),
    // 7 = two columns of three + one centred high
    '7': cols3().concat([[COL_C, 128]]),
    // 8 = two columns of three + one centred high, one centred low
    '8': cols3().concat([[COL_C, 128], [COL_C, 208]]),
    // 9 = two columns of four + one dead centre
    '9': cols4().concat([[COL_C, ROW_M]]),
    // 10 = two columns of four + two centred, offset into the outer gaps
    'T': cols4().concat([[COL_C, 114], [COL_C, 222]])
  };

  /* ------------------------------------------------------------------ *
   * Shared card chrome
   * ------------------------------------------------------------------ */

  function faceDefs(n, p, texture) {
    var s = '<defs>' +
      // paper: warm off-white with a soft vignette toward the edges
      '<radialGradient id="' + n + 'f" cx="0.5" cy="0.4" r="0.88">' +
        '<stop offset="0" stop-color="#fffefb"/>' +
        '<stop offset="0.6" stop-color="#fdfbf5"/>' +
        '<stop offset="1" stop-color="#f1ebde"/>' +
      '</radialGradient>' +
      // ink: every suit shape is filled with this, giving pips subtle depth
      '<linearGradient id="' + n + 's" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0" stop-color="' + p.hi + '"/>' +
        '<stop offset="0.52" stop-color="' + p.main + '"/>' +
        '<stop offset="1" stop-color="' + p.lo + '"/>' +
      '</linearGradient>';

    if (texture) {
      s += '<filter id="' + n + 't" x="0" y="0" width="100%" height="100%">' +
             '<feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="1" seed="7"/>' +
             '<feColorMatrix type="saturate" values="0"/>' +
           '</filter>';
    }
    return s + '</defs>';
  }

  function frame(rounded, showBorder, texture, n) {
    var r = rounded ? CORNER : 0;
    var s = '<rect x="0" y="0" width="240" height="336" rx="' + r + '" ry="' + r +
            '" fill="url(#' + n + 'f)"/>';

    if (texture) {
      s += '<rect x="0" y="0" width="240" height="336" rx="' + r + '" ry="' + r +
           '" filter="url(#' + n + 't)" opacity="0.055" style="mix-blend-mode:multiply"/>';
    }

    // twin inner frame lines
    s += '<rect x="6.5" y="6.5" width="227" height="323" rx="' + Math.max(0, r - 5) +
         '" fill="none" stroke="#ddd5c1" stroke-width="1"/>' +
         '<rect x="10.5" y="10.5" width="219" height="315" rx="' + Math.max(0, r - 8) +
         '" fill="none" stroke="#ece5d5" stroke-width="0.8"/>';

    // outer edge
    s += '<rect x="0.5" y="0.5" width="239" height="335" rx="' + Math.max(0, r - 0.5) +
         '" fill="none" stroke="' + (showBorder ? '#b9b09a' : '#d8d0bb') +
         '" stroke-width="1"/>';
    return s;
  }

  /* Corner indices: top-left, plus the same block rotated 180 into
     the bottom-right, exactly as on a real card. */
  function indices(n, rank, suit, p) {
    var lbl = rank === 'T' ? '10' : rank;
    var size = rank === 'T' ? 29 : 37;
    var block =
      '<text x="' + IX + '" y="' + IX_RANK_Y + '" font-family="' + FONT + '"' +
        ' font-size="' + size + '" font-weight="700" text-anchor="middle"' +
        ' fill="' + p.main + '" letter-spacing="' + (rank === 'T' ? '-1.2' : '0') + '">' +
        lbl + '</text>' +
      '<g fill="url(#' + n + 's)">' + glyph(suit, IX, IX_GLYPH_Y, IX_GLYPH_S, false) + '</g>';
    return block + '<g transform="rotate(180 ' + CX + ' ' + CY + ')">' + block + '</g>';
  }

  /* ------------------------------------------------------------------ *
   * Ace
   * ------------------------------------------------------------------ */

  function aceBody(n, suit, p) {
    var s = '', i;

    // faint tinted medallion behind the glyph
    s += '<circle cx="120" cy="168" r="88" fill="url(#' + n + 'a)"/>';

    // engraved laurel of ticks just outside the ring
    var ticks = '';
    for (i = 0; i < 48; i++) {
      ticks += '<path d="M120 77V72" transform="rotate(' + (i * 7.5) + ' 120 168)"/>';
    }
    s += '<g stroke="' + p.main + '" stroke-width="0.9" opacity="0.16">' + ticks + '</g>';

    // twin ring
    s += '<circle cx="120" cy="168" r="87" fill="none" stroke="' + p.main +
         '" stroke-width="1.2" opacity="0.2"/>' +
         '<circle cx="120" cy="168" r="82.5" fill="none" stroke="' + p.main +
         '" stroke-width="0.6" opacity="0.13"/>';

    // four cardinal lozenges seated on the ring
    var pts = [[120, 81], [207, 168], [120, 255], [33, 168]];
    for (i = 0; i < pts.length; i++) {
      var x = pts[i][0], y = pts[i][1];
      s += '<path d="M' + x + ' ' + (y - 5.5) + 'L' + (x + 5.5) + ' ' + y +
           'L' + x + ' ' + (y + 5.5) + 'L' + (x - 5.5) + ' ' + y + 'Z" fill="' + p.main +
           '" opacity="0.3"/>';
    }

    // the glyph itself
    s += '<g fill="url(#' + n + 's)">' + glyph(suit, CX, CY, ACE, false) + '</g>';
    return s;
  }

  function aceDefs(n, p) {
    return '<defs><radialGradient id="' + n + 'a" cx="0.5" cy="0.5" r="0.5">' +
      '<stop offset="0" stop-color="' + p.main + '" stop-opacity="0.055"/>' +
      '<stop offset="0.7" stop-color="' + p.main + '" stop-opacity="0.03"/>' +
      '<stop offset="1" stop-color="' + p.main + '" stop-opacity="0"/>' +
      '</radialGradient></defs>';
  }

  /* ------------------------------------------------------------------ *
   * Court cards — J / Q / K
   *
   * Stylised heraldic panel rather than a figure drawing: an ornate framed
   * cartouche, a crowned monogram, mirrored top/bottom halves (rotated 180,
   * as real court cards are) and the suit glyph set into a central rosette
   * straddling the divide.
   * ------------------------------------------------------------------ */

  /* Every crown shares the same band (x 76..164, y 92..102) so J, Q and K read
     as one designed set while their silhouettes stay unmistakable. */
  function loz(x, y, w, h, fill, op) {
    return '<path d="M' + x + ' ' + (y - h) + 'L' + (x + w) + ' ' + y + 'L' + x + ' ' +
      (y + h) + 'L' + (x - w) + ' ' + y + 'Z" fill="' + fill + '" opacity="' + op + '"/>';
  }

  function crownBand(ink, pearl) {
    return '<rect x="82" y="92.5" width="76" height="9.5" rx="1.5" fill="' + ink + '"/>' +
      '<path d="M84.5 97.2H155.5" stroke="' + pearl + '" stroke-width="0.7" opacity="0.22"/>' +
      loz(99, 97.2, 3.1, 3.1, pearl, '0.85') +
      loz(120, 97.2, 3.6, 3.6, pearl, '0.9') +
      loz(141, 97.2, 3.1, 3.1, pearl, '0.85');
  }

  function crown(rank, n, p) {
    var s = '';
    var ink = 'url(#' + n + 's)';
    var pearl = '#fffdf7';

    if (rank === 'K') {
      // Five-pointed crown, tallest at centre — spiky and regal.
      s += '<path d="M82 94L82 75L92.5 86L101 69L110.5 82L120 64L129.5 82L138 69' +
           'L147.5 86L158 75L158 94Z" fill="' + ink + '"/>';
      s += crownBand(ink, pearl);

    } else if (rank === 'Q') {
      // Arched coronet under bright pearls — round and softer.
      s += '<path d="M82 94L82 85A12.5 12.5 0 0 1 107 85A13 16 0 0 1 133 85' +
           'A12.5 12.5 0 0 1 158 85L158 94Z" fill="' + ink + '"/>';
      s += '<g fill="' + pearl + '" stroke="' + p.main + '" stroke-width="1.1">' +
           '<circle cx="94.5" cy="73" r="3.4"/>' +
           '<circle cx="120" cy="67" r="4"/>' +
           '<circle cx="145.5" cy="73" r="3.4"/></g>';
      s += crownBand(ink, pearl);

    } else {
      // Jack: a knave's helm — narrow dome with a crest ridge, over the shared band.
      s += '<path d="M93 94L93 84A27 22 0 0 1 147 84L147 94Z" fill="' + ink + '"/>';
      s += '<path d="M120 63V70" stroke="' + pearl + '" stroke-width="1.1" opacity="0.35"/>';
      // visor slot — the eyes live in here (see jackEyes)
      s += '<rect x="101" y="73.5" width="38" height="13.5" rx="5.5" fill="' + pearl + '"/>' +
           '<rect x="101" y="73.5" width="38" height="13.5" rx="5.5" fill="none" stroke="' +
           p.lo + '" stroke-width="0.8" opacity="0.55"/>';
      s += crownBand(ink, pearl);
    }
    return s;
  }

  function jackEyes(id, n, p) {
    var one = (id.charAt(1) === 'S' || id.charAt(1) === 'H');
    var xs = one ? [120] : [109.5, 130.5];
    var y = 80, s = '';
    for (var i = 0; i < xs.length; i++) {
      var x = xs[i];
      s += '<path d="M' + (x - 7.5) + ' ' + y + 'Q' + x + ' ' + (y - 5) + ' ' + (x + 7.5) +
           ' ' + y + 'Q' + x + ' ' + (y + 5) + ' ' + (x - 7.5) + ' ' + y + 'Z"' +
           ' fill="none" stroke="' + p.main + '" stroke-width="1.1"/>' +
           '<circle cx="' + x + '" cy="' + y + '" r="2.3" fill="' + p.main + '"/>';
    }
    return s;
  }

  /* Art-deco bracket in the top-left corner of the panel; mirrored and
     rotated into the other three. */
  function cornerOrnament(p) {
    var c = p.main;
    return '<g fill="none" stroke="' + c + '" stroke-linecap="square">' +
      '<path d="M54 82V64H72" stroke-width="1.6" opacity="0.6"/>' +
      '<path d="M60 88V70H78" stroke-width="0.7" opacity="0.4"/>' +
      '</g>' +
      '<path d="M57 63.4L60.6 67L57 70.6L53.4 67Z" fill="' + c + '" opacity="0.5"/>';
  }

  function courtHalf(id, rank, suit, n, p) {
    var s = '';
    s += crown(rank, n, p);
    if (rank === 'J') s += jackEyes(id, n, p);

    // octagonal cartouche holding the monogram
    s += '<path d="M96 102H144L154 112V134L144 144H96L86 134V112Z" fill="#fffdfa"/>' +
         '<path d="M96 102H144L154 112V134L144 144H96L86 134V112Z" fill="url(#' + n + 'm)"/>' +
         '<path d="M96 102H144L154 112V134L144 144H96L86 134V112Z" fill="none" stroke="' +
         p.main + '" stroke-width="1.2"/>' +
         '<path d="M98 105.5H142L150.5 114V132L142 140.5H98L89.5 132V114Z" fill="none" stroke="' +
         p.main + '" stroke-width="0.6" opacity="0.4"/>';

    // monogram
    s += '<text x="120" y="135" font-family="' + FONT + '" font-size="34"' +
         ' font-weight="700" text-anchor="middle" fill="url(#' + n + 's)">' + rank + '</text>';

    // small flanking suit marks
    s += '<g fill="' + p.main + '" opacity="0.5">' +
         glyph(suit, 67, 123, 14, false) +
         glyph(suit, 173, 123, 14, false) +
         '</g>';

    // ornaments in the two upper panel corners
    s += cornerOrnament(p) +
         '<g transform="translate(240 0) scale(-1 1)">' + cornerOrnament(p) + '</g>';
    return s;
  }

  function courtBody(id, rank, suit, n, p) {
    var s = '';
    // panel
    s += '<rect x="' + P_X + '" y="' + P_Y + '" width="' + P_W + '" height="' + P_H +
         '" rx="10" fill="#fffdf8"/>' +
         '<rect x="' + P_X + '" y="' + P_Y + '" width="' + P_W + '" height="' + P_H +
         '" rx="10" fill="url(#' + n + 'h)"/>' +
         '<rect x="' + P_X + '" y="' + P_Y + '" width="' + P_W + '" height="' + P_H +
         '" rx="10" fill="url(#' + n + 'p)"/>' +
         '<rect x="' + P_X + '" y="' + P_Y + '" width="' + P_W + '" height="' + P_H +
         '" rx="10" fill="none" stroke="' + p.main + '" stroke-width="1.5"/>' +
         '<rect x="' + (P_X + 4.5) + '" y="' + (P_Y + 4.5) + '" width="' + (P_W - 9) +
         '" height="' + (P_H - 9) + '" rx="6.5" fill="none" stroke="' + p.main +
         '" stroke-width="0.7" opacity="0.4"/>';

    // mirrored halves
    var half = courtHalf(id, rank, suit, n, p);
    s += half + '<g transform="rotate(180 ' + CX + ' ' + CY + ')">' + half + '</g>';

    // divider + central rosette carrying the suit
    s += '<g stroke="' + p.main + '" stroke-width="1" opacity="0.4">' +
         '<path d="M52 168H100M140 168H188"/></g>' +
         '<g fill="' + p.main + '" opacity="0.5">' +
         '<circle cx="58" cy="168" r="1.7"/><circle cx="182" cy="168" r="1.7"/></g>' +
         '<circle cx="120" cy="168" r="16.5" fill="#fffdfa" stroke="' + p.main +
         '" stroke-width="1.3"/>' +
         '<circle cx="120" cy="168" r="13.2" fill="none" stroke="' + p.main +
         '" stroke-width="0.6" opacity="0.4"/>' +
         '<g fill="url(#' + n + 's)">' + glyph(suit, CX, CY, 20, false) + '</g>';
    return s;
  }

  function courtDefs(n, p) {
    var w = p.washColor;
    return '<defs>' +
      '<radialGradient id="' + n + 'p" cx="0.5" cy="0.5" r="0.68">' +
        '<stop offset="0" stop-color="' + w + '" stop-opacity="0"/>' +
        '<stop offset="0.55" stop-color="' + w + '" stop-opacity="' +
          (Math.round(p.wash * 22) / 100) + '"/>' +
        '<stop offset="1" stop-color="' + w + '" stop-opacity="' + p.wash + '"/>' +
      '</radialGradient>' +
      '<radialGradient id="' + n + 'm" cx="0.5" cy="0.42" r="0.7">' +
        '<stop offset="0" stop-color="' + w + '" stop-opacity="0"/>' +
        '<stop offset="1" stop-color="' + w + '" stop-opacity="' +
          (Math.round(p.wash * 60) / 100) + '"/>' +
      '</radialGradient>' +
      '<pattern id="' + n + 'h" width="8" height="8" patternUnits="userSpaceOnUse"' +
        ' patternTransform="rotate(45)">' +
        '<line x1="0" y1="0" x2="0" y2="8" stroke="' + w +
        '" stroke-width="0.6" opacity="' + p.hatch + '"/>' +
      '</pattern>' +
      '</defs>';
  }

  /* ------------------------------------------------------------------ *
   * Public: svg()
   * ------------------------------------------------------------------ */

  function svg(id, opts) {
    opts = opts || {};
    var rounded = opts.rounded !== false;
    var showBorder = opts.showBorder !== false;
    var texture = opts.texture === true;   // opt-in: feTurbulence is not free

    var info = parse(id);
    var rank = info.rank, suit = info.suit;
    var p = PAL[suit];
    var n = ns();

    var out = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 336"' +
      ' preserveAspectRatio="xMidYMid meet" role="img" aria-label="' + label(id) + '">';

    out += faceDefs(n, p, texture);
    if (rank === 'A') out += aceDefs(n, p);
    if (rank === 'J' || rank === 'Q' || rank === 'K') out += courtDefs(n, p);

    out += frame(rounded, showBorder, texture, n);

    if (rank === 'A') {
      out += aceBody(n, suit, p);
    } else if (rank === 'J' || rank === 'Q' || rank === 'K') {
      out += courtBody(id, rank, suit, n, p);
    } else {
      var pts = LAYOUT[rank], body = '';
      for (var i = 0; i < pts.length; i++) {
        body += glyph(suit, pts[i][0], pts[i][1], PIP, pts[i][1] > CY);
      }
      out += '<g fill="url(#' + n + 's)">' + body + '</g>';
    }

    out += indices(n, rank, suit, p);
    out += '</svg>';
    return out;
  }

  /* ------------------------------------------------------------------ *
   * Public: backSvg()
   * ------------------------------------------------------------------ */

  function backSvg(opts) {
    opts = opts || {};
    var rounded = opts.rounded !== false;
    var showBorder = opts.showBorder !== false;
    var r = rounded ? CORNER : 0;
    var n = ns();
    var GOLD = '#d8b45a';

    var s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 336"' +
      ' preserveAspectRatio="xMidYMid meet" role="img" aria-label="Card back">';

    s += '<defs>' +
      '<linearGradient id="' + n + 'b" x1="0" y1="0" x2="0.6" y2="1">' +
        '<stop offset="0" stop-color="#1b2c52"/>' +
        '<stop offset="0.5" stop-color="#122043"/>' +
        '<stop offset="1" stop-color="#0a1330"/>' +
      '</linearGradient>' +
      '<radialGradient id="' + n + 'v" cx="0.5" cy="0.45" r="0.75">' +
        '<stop offset="0" stop-color="#2a4076" stop-opacity="0.55"/>' +
        '<stop offset="1" stop-color="#060b1c" stop-opacity="0.5"/>' +
      '</radialGradient>' +
      // interlocking diamond lattice
      '<pattern id="' + n + 'l" width="16" height="16" patternUnits="userSpaceOnUse">' +
        '<path d="M8 0L16 8L8 16L0 8Z" fill="none" stroke="' + GOLD +
        '" stroke-width="0.55" opacity="0.3"/>' +
        '<path d="M0 0L16 16M16 0L0 16" stroke="' + GOLD +
        '" stroke-width="0.3" opacity="0.14"/>' +
        '<circle cx="8" cy="8" r="1.1" fill="' + GOLD + '" opacity="0.22"/>' +
      '</pattern>' +
      '<clipPath id="' + n + 'c">' +
        '<rect x="12" y="12" width="216" height="312" rx="' + Math.max(0, r - 7) + '"/>' +
      '</clipPath>' +
      '</defs>';

    s += '<rect x="0" y="0" width="240" height="336" rx="' + r + '" fill="url(#' + n + 'b)"/>';
    s += '<g clip-path="url(#' + n + 'c)">' +
         '<rect x="12" y="12" width="216" height="312" fill="url(#' + n + 'l)"/>' +
         '<rect x="12" y="12" width="216" height="312" fill="url(#' + n + 'v)"/>';

    // guilloche rosette: rotated ellipses about the centre
    var g = '';
    for (var a = 0; a < 180; a += 15) {
      g += '<ellipse cx="120" cy="168" rx="86" ry="34" transform="rotate(' + a +
           ' 120 168)"/>';
    }
    s += '<g fill="none" stroke="' + GOLD + '" stroke-width="0.45" opacity="0.3">' + g + '</g>';
    s += '<g fill="none" stroke="' + GOLD + '" stroke-width="0.4" opacity="0.22">' +
         '<circle cx="120" cy="168" r="92"/><circle cx="120" cy="168" r="70"/>' +
         '</g>';
    s += '</g>';

    // gold frame
    s += '<rect x="9.5" y="9.5" width="221" height="317" rx="' + Math.max(0, r - 5) +
         '" fill="none" stroke="' + GOLD + '" stroke-width="1.4" opacity="0.8"/>' +
         '<rect x="14.5" y="14.5" width="211" height="307" rx="' + Math.max(0, r - 9) +
         '" fill="none" stroke="' + GOLD + '" stroke-width="0.6" opacity="0.45"/>';

    // central emblem
    s += '<circle cx="120" cy="168" r="42" fill="#0c1533" opacity="0.94"/>' +
         '<circle cx="120" cy="168" r="42" fill="none" stroke="' + GOLD +
         '" stroke-width="1.4" opacity="0.85"/>' +
         '<circle cx="120" cy="168" r="35" fill="none" stroke="' + GOLD +
         '" stroke-width="0.6" opacity="0.5"/>';
    // laurel ticks around the emblem
    var t = '';
    for (var k = 0; k < 24; k++) {
      t += '<path d="M120 130.5V126" transform="rotate(' + (k * 15) + ' 120 168)"/>';
    }
    s += '<g stroke="' + GOLD + '" stroke-width="0.9" opacity="0.4">' + t + '</g>';
    s += '<text x="120" y="186" font-family="' + FONT + '" font-size="46"' +
         ' font-weight="700" text-anchor="middle" fill="' + GOLD + '">S</text>';

    s += '<rect x="0.5" y="0.5" width="239" height="335" rx="' + Math.max(0, r - 0.5) +
         '" fill="none" stroke="' + (showBorder ? '#000000' : '#0a1330') +
         '" stroke-width="1" opacity="0.5"/>';
    s += '</svg>';
    return s;
  }

  /* ------------------------------------------------------------------ *
   * Public: identity helpers
   * ------------------------------------------------------------------ */

  function id(rank, suit) { return String(rank).toUpperCase() + String(suit).toUpperCase(); }

  function parse(cardId) {
    var s = String(cardId).toUpperCase();
    var rank = s.charAt(0), suit = s.charAt(1);
    if (RANKS.indexOf(rank) < 0 || SUITS.indexOf(suit) < 0) {
      throw new Error('SQ.Cards: bad card id "' + cardId + '"');
    }
    return {
      rank: rank,
      suit: suit,
      color: PAL[suit].color,
      rankLabel: rank === 'T' ? '10' : rank,
      suitName: SUIT_NAME[suit]
    };
  }

  function label(cardId) {
    var i = parse(cardId);
    return (RANK_TITLE[i.rank] || i.rank) + ' of ' + SUIT_TITLE[i.suit];
  }

  function isJack(cardId) { return parse(cardId).rank === 'J'; }
  function isOneEyedJack(cardId) {
    var i = parse(cardId);
    return i.rank === 'J' && (i.suit === 'S' || i.suit === 'H');
  }
  function isTwoEyedJack(cardId) {
    var i = parse(cardId);
    return i.rank === 'J' && (i.suit === 'D' || i.suit === 'C');
  }

  function fullDeck() {
    var out = [];
    for (var s = 0; s < SUITS.length; s++) {
      for (var r = 0; r < RANKS.length; r++) out.push(RANKS[r] + SUITS[s]);
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * Public: DOM + UI helpers
   * ------------------------------------------------------------------ */

  function parseOne(str) {
    var host = document.createElement('div');
    host.innerHTML = str;
    return host.firstElementChild;
  }
  function el(cardId, opts) { return parseOne(svg(cardId, opts)); }
  function backEl(opts) { return parseOne(backSvg(opts)); }

  function suitGlyph(suit, opts) {
    opts = opts || {};
    var size = opts.size || 16;
    var su = String(suit).toUpperCase();
    if (SUITS.indexOf(su) < 0) throw new Error('SQ.Cards: bad suit "' + suit + '"');
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size +
      '" viewBox="0 0 100 100" aria-label="' + SUIT_TITLE[su] + '"' +
      ' style="display:inline-block;vertical-align:-0.14em">' +
      '<g fill="' + (opts.fill || PAL[su].main) + '">' + GLYPH[su] + '</g></svg>';
  }

  /* ------------------------------------------------------------------ */

  global.SQ = global.SQ || {};
  global.SQ.Cards = {
    RANKS: RANKS,
    SUITS: SUITS,
    PALETTE: PAL,
    id: id,
    parse: parse,
    label: label,
    isJack: isJack,
    isOneEyedJack: isOneEyedJack,
    isTwoEyedJack: isTwoEyedJack,
    fullDeck: fullDeck,
    svg: svg,
    backSvg: backSvg,
    el: el,
    backEl: backEl,
    suitGlyph: suitGlyph
  };

})(typeof window !== 'undefined' ? window : this);
