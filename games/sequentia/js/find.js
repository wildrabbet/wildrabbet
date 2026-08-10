/* Sequentia — SQ.Find
 *
 * "Where is the 6 of spades?"  In the physical game you scan 100 spaces with
 * your eyes.  Here you type `6s` and everything else dims.
 *
 * Owns exactly two visual classes:
 *   #board.filtering   — dims every tile
 *   .tile.hit          — a match (bright + gold ring)
 * plus its own transient .find-flash (see css/find.css).  It never touches
 * targeting / target / target-remove / blocked / snap — those belong to drag.
 *
 * Plain classic browser script. No modules. Attaches to window.SQ.Find.
 * SQ.App must call SQ.Find.init({getState: fn}); nothing auto-runs.
 */
(function () {
  'use strict';
  var SQ = (window.SQ = window.SQ || {});

  /* ================================================================== *
   * Word tables
   * ================================================================== */

  var RANK_WORDS = {
    a: 'A', ace: 'A', aces: 'A', one: 'A', ones: 'A',
    '2': '2', two: '2', twos: '2', deuce: '2', deuces: '2',
    '3': '3', three: '3', threes: '3', trey: '3', treys: '3',
    '4': '4', four: '4', fours: '4',
    '5': '5', five: '5', fives: '5',
    '6': '6', six: '6', sixes: '6',
    '7': '7', seven: '7', sevens: '7',
    '8': '8', eight: '8', eights: '8',
    '9': '9', nine: '9', nines: '9',
    t: 'T', '10': 'T', ten: 'T', tens: 'T',
    j: 'J', jack: 'J', jacks: 'J', knave: 'J',
    q: 'Q', queen: 'Q', queens: 'Q',
    k: 'K', king: 'K', kings: 'K'
  };

  var SUIT_WORDS = {
    s: 'S', spade: 'S', spades: 'S',
    h: 'H', heart: 'H', hearts: 'H',
    d: 'D', diamond: 'D', diamonds: 'D',
    c: 'C', club: 'C', clubs: 'C'
  };

  var COLOR_WORDS = {
    red: 'red', reds: 'red', crimson: 'red',
    black: 'black', blacks: 'black', dark: 'black'
  };

  var GROUP_WORDS = {
    face: ['Q', 'K'], faces: ['Q', 'K'], court: ['Q', 'K'], courts: ['Q', 'K'],
    royal: ['Q', 'K'], royals: ['Q', 'K'], picture: ['Q', 'K'], pictures: ['Q', 'K'],
    number: ['2', '3', '4', '5', '6', '7', '8', '9', 'T'],
    numbers: ['2', '3', '4', '5', '6', '7', '8', '9', 'T'],
    pip: ['2', '3', '4', '5', '6', '7', '8', '9', 'T'],
    pips: ['2', '3', '4', '5', '6', '7', '8', '9', 'T'],
    low: ['2', '3', '4', '5', '6'], lows: ['2', '3', '4', '5', '6'],
    high: ['9', 'T', 'Q', 'K', 'A'], highs: ['9', 'T', 'Q', 'K', 'A']
  };

  var STATE_WORDS = {
    open: 'open', empty: 'open', free: 'open', unoccupied: 'open',
    vacant: 'open', available: 'open', blank: 'open',
    taken: 'taken', occupied: 'taken', filled: 'taken', used: 'taken',
    chip: 'taken', chips: 'taken', chipped: 'taken',
    mine: 'mine', my: 'mine', me: 'mine', ours: 'mine', our: 'mine', us: 'mine',
    theirs: 'theirs', their: 'theirs', them: 'theirs', enemy: 'theirs',
    enemies: 'theirs', opponent: 'theirs', opponents: 'theirs', foe: 'theirs',
    other: 'theirs', others: 'theirs'
  };

  var SET_WORDS = {
    hand: 'hand', myhand: 'hand', holding: 'hand',
    playable: 'playable', playables: 'playable', moves: 'playable',
    move: 'playable', legal: 'playable', plays: 'playable', can: 'playable',
    corner: 'corners', corners: 'corners'
  };

  var GLYPHS = {
    '♠': ' spades ', '♤': ' spades ',
    '♥': ' hearts ', '♡': ' hearts ',
    '♦': ' diamonds ', '♢': ' diamonds ',
    '♣': ' clubs ', '♧': ' clubs '
  };

  var CARD_RE = /^(10|[a2-9tjqk])([shdc])$/;      // 6s, td, 10d, qh, ac
  var CARD_RE_REV = /^([shdc])(10|[a2-9tjqk])$/;  // s6, dt, d10, hq

  var STATE_CHIPS = [
    { key: 'open', label: 'Open' },
    { key: 'taken', label: 'Taken' },
    { key: 'mine', label: 'Mine' },
    { key: 'theirs', label: 'Theirs' },
    { key: 'corners', label: 'Corners' }
  ];

  // Rank chips: no jacks — they are wild and never printed on the board.
  var CHIP_RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'Q', 'K'];

  /* ================================================================== *
   * Module state
   * ================================================================== */

  var getState = null;
  var inited = false;

  var query = '';                 // raw text in the box
  var chipRanks = {};             // rank -> true
  var chipSuits = {};             // suit -> true
  var chipStates = {};            // 'open'|'taken'|'mine'|'theirs'|'corners' -> true

  var lastMatch = [];             // sorted cell indices from the previous paint
  var lastMatchMap = {};          // cell -> true
  var lastFiltering = false;

  var CARD_CELLS = {};            // '6S' -> [i, j]   (precomputed once)
  var CELL_CARD = [];             // i -> '6S' | null
  var CELL_RANK = [];
  var CELL_SUIT = [];
  var CELL_COLOR = [];
  var CORNER_CELLS = [];
  var ALL_CELLS = [];

  var tileCache = [];
  var debounceTimer = null;
  var flashTimers = {};

  var el = {};

  function $(id) { return document.getElementById(id); }

  /* ================================================================== *
   * Index
   * ================================================================== */

  function buildIndex() {
    var flat = SQ.Board.LAYOUT_FLAT;
    CARD_CELLS = {}; CELL_CARD = []; CELL_RANK = []; CELL_SUIT = []; CELL_COLOR = [];
    CORNER_CELLS = []; ALL_CELLS = [];
    for (var i = 0; i < flat.length; i++) {
      ALL_CELLS.push(i);
      var card = flat[i];
      if (card === 'FREE') {
        CELL_CARD.push(null); CELL_RANK.push(null);
        CELL_SUIT.push(null); CELL_COLOR.push(null);
        CORNER_CELLS.push(i);
        continue;
      }
      var info = SQ.Cards.parse(card);
      CELL_CARD.push(card);
      CELL_RANK.push(info.rank);
      CELL_SUIT.push(info.suit);
      CELL_COLOR.push(info.color);
      (CARD_CELLS[card] || (CARD_CELLS[card] = [])).push(i);
    }
  }

  function tiles() {
    if (!tileCache.length || !tileCache[0] || !tileCache[0].parentNode) {
      tileCache = [];
      var board = el.board || (el.board = $('board'));
      if (!board) return tileCache;
      var list = board.querySelectorAll('.tile[data-cell]');
      for (var k = 0; k < list.length; k++) {
        tileCache[Number(list[k].getAttribute('data-cell'))] = list[k];
      }
    }
    return tileCache;
  }

  /* ================================================================== *
   * Query parsing
   * ================================================================== */

  function newSpec() {
    return {
      cards: {},    // explicit card ids     (union)
      ranks: {},    // ranks                 (union)
      suits: {},    // suits                 (union)
      colors: {},   // 'red' | 'black'       (union)
      states: {},   // open/taken/mine/theirs(union)
      sets: {},     // hand/playable/corners (union)
      bad: [],      // unrecognised tokens
      terms: 0,     // recognised term count
      sawJack: false
    };
  }

  function specEmpty(s) {
    return !s.terms;
  }

  function normalise(str) {
    var out = String(str == null ? '' : str).toLowerCase();
    out = out.replace(/[♠♤♥♡♦♢♣♧]/g, function (g) {
      return GLYPHS[g] || ' ';
    });
    // punctuation -> whitespace; keep letters and digits
    out = out.replace(/[^a-z0-9]+/g, ' ');
    return out.replace(/\s+/g, ' ').trim();
  }

  function tokenise(str) {
    var raw = normalise(str);
    if (!raw) return [];
    var parts = raw.split(' ');
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      // "6 of spades" / "q of h" -> one compound token
      if ((p === 'of' || p === 'o') && out.length && i + 1 < parts.length) {
        out[out.length - 1] = { left: out[out.length - 1], right: parts[i + 1], raw: null };
        out[out.length - 1].raw = tokenText(out[out.length - 1].left) + ' of ' + parts[i + 1];
        i++;
        continue;
      }
      out.push(p);
    }
    return out;
  }

  function tokenText(t) { return typeof t === 'string' ? t : t.raw; }

  // Resolve a word to a rank list, or null.
  function asRanks(word) {
    if (RANK_WORDS[word]) return [RANK_WORDS[word]];
    if (GROUP_WORDS[word]) return GROUP_WORDS[word].slice();
    return null;
  }
  // Resolve a word to a suit list, or null (colours expand to two suits).
  function asSuits(word) {
    if (SUIT_WORDS[word]) return [SUIT_WORDS[word]];
    if (COLOR_WORDS[word] === 'red') return ['H', 'D'];
    if (COLOR_WORDS[word] === 'black') return ['S', 'C'];
    return null;
  }

  function addCards(spec, ranks, suits) {
    for (var r = 0; r < ranks.length; r++) {
      if (ranks[r] === 'J') spec.sawJack = true;
      for (var s = 0; s < suits.length; s++) {
        spec.cards[ranks[r] + suits[s]] = true;
      }
    }
    spec.terms++;
  }

  function parseQuery(str) {
    var spec = newSpec();
    var toks = tokenise(str);

    for (var i = 0; i < toks.length; i++) {
      var tok = toks[i];

      /* --- compound "<left> of <right>" ------------------------------ */
      if (typeof tok !== 'string') {
        var lr = asRanks(tok.left), rs = asSuits(tok.right);
        if (lr && rs) { addCards(spec, lr, rs); continue; }
        var ls = asSuits(tok.left), rr = asRanks(tok.right);
        if (ls && rr) { addCards(spec, rr, ls); continue; }
        spec.bad.push(tok.raw);
        continue;
      }

      /* --- shorthand card ids ---------------------------------------- */
      var m = CARD_RE.exec(tok) || null;
      var rank = null, suit = null;
      if (m) { rank = RANK_WORDS[m[1]]; suit = SUIT_WORDS[m[2]]; }
      else {
        m = CARD_RE_REV.exec(tok);
        if (m) { suit = SUIT_WORDS[m[1]]; rank = RANK_WORDS[m[2]]; }
      }
      if (rank && suit) { addCards(spec, [rank], [suit]); continue; }

      /* --- single dimensions ----------------------------------------- */
      if (RANK_WORDS[tok]) {
        if (RANK_WORDS[tok] === 'J') spec.sawJack = true;
        spec.ranks[RANK_WORDS[tok]] = true; spec.terms++; continue;
      }
      if (GROUP_WORDS[tok]) {
        GROUP_WORDS[tok].forEach(function (r) { spec.ranks[r] = true; });
        spec.terms++; continue;
      }
      if (SUIT_WORDS[tok]) { spec.suits[SUIT_WORDS[tok]] = true; spec.terms++; continue; }
      if (COLOR_WORDS[tok]) { spec.colors[COLOR_WORDS[tok]] = true; spec.terms++; continue; }
      if (SET_WORDS[tok]) { spec.sets[SET_WORDS[tok]] = true; spec.terms++; continue; }
      if (STATE_WORDS[tok]) { spec.states[STATE_WORDS[tok]] = true; spec.terms++; continue; }

      spec.bad.push(tok);
    }
    return spec;
  }

  /* ================================================================== *
   * Matching
   * ================================================================== */

  function state() {
    try { return getState ? getState() : null; } catch (e) { return null; }
  }

  function teamOf(st, playerIndex) {
    if (!st || playerIndex == null) return null;
    var p = st.players && st.players[playerIndex];
    return p && p.team != null ? p.team : playerIndex;
  }

  function keys(o) { return Object.keys(o); }

  /* Cells covered by every card in the current player's hand. */
  function handCells(st) {
    var out = {};
    if (!st || !st.hands) return out;
    var h = st.hands[st.turn] || [];
    for (var i = 0; i < h.length; i++) {
      var cells = CARD_CELLS[String(h[i]).toUpperCase()];
      if (!cells) continue;                 // jacks are not printed on the board
      for (var k = 0; k < cells.length; k++) out[cells[k]] = true;
    }
    return out;
  }

  /* Every space the current player could legally play on right now. */
  function playableCells(st) {
    var out = {};
    if (!st || !st.hands || !SQ.Engine) return out;
    var h = st.hands[st.turn] || [];
    for (var i = 0; i < h.length; i++) {
      var t;
      try { t = SQ.Engine.legalTargets(st, h[i]); } catch (e) { t = []; }
      for (var k = 0; k < t.length; k++) out[t[k]] = true;
    }
    return out;
  }

  function setCells(name, st) {
    if (name === 'corners') {
      var c = {};
      for (var i = 0; i < CORNER_CELLS.length; i++) c[CORNER_CELLS[i]] = true;
      return c;
    }
    if (name === 'hand') return handCells(st);
    if (name === 'playable') return playableCells(st);
    return {};
  }

  function statePass(keysArr, i, st) {
    var cell = st && st.board ? st.board[i] : null;
    var free = CELL_CARD[i] === null;
    var chip = cell ? cell.chip : null;
    var myTeam = st ? teamOf(st, st.turn) : null;
    for (var k = 0; k < keysArr.length; k++) {
      var key = keysArr[k];
      if (key === 'open') { if (!free && chip === null) return true; }
      else if (key === 'taken') { if (!free && chip !== null) return true; }
      else if (key === 'mine') { if (chip !== null && teamOf(st, chip) === myTeam) return true; }
      else if (key === 'theirs') { if (chip !== null && teamOf(st, chip) !== myTeam) return true; }
    }
    return false;
  }

  /* Merge text spec + tray chips, then evaluate.  Union within a dimension,
   * intersection across dimensions. */
  function computeMatches() {
    var spec = parseQuery(query);
    var st = state();

    // A single unrecognised token poisons the query: match nothing.
    if (spec.bad.length) return { cells: [], spec: spec, active: true };

    var ranks = {}, suits = {}, states = {}, sets = {};
    var kk;
    for (kk in spec.ranks) ranks[kk] = true;
    for (kk in spec.suits) suits[kk] = true;
    for (kk in spec.states) states[kk] = true;
    for (kk in spec.sets) sets[kk] = true;
    for (kk in chipRanks) ranks[kk] = true;
    for (kk in chipSuits) suits[kk] = true;
    for (kk in chipStates) {
      if (kk === 'corners') sets.corners = true; else states[kk] = true;
    }

    var cardKeys = keys(spec.cards);
    var rankKeys = keys(ranks);
    var suitKeys = keys(suits);
    var colorKeys = keys(spec.colors);
    var stateKeys = keys(states);
    var setKeys = keys(sets);

    var active = !!(cardKeys.length || rankKeys.length || suitKeys.length ||
                    colorKeys.length || stateKeys.length || setKeys.length);
    if (!active) return { cells: [], spec: spec, active: false };

    // Union the requested cell-sets once.
    var setUnion = null;
    if (setKeys.length) {
      setUnion = {};
      for (var s = 0; s < setKeys.length; s++) {
        var cs = setCells(setKeys[s], st);
        for (var c in cs) setUnion[c] = true;
      }
    }

    var out = [];
    for (var i = 0; i < 100; i++) {
      if (cardKeys.length && !spec.cards[CELL_CARD[i]]) continue;
      if (rankKeys.length && !ranks[CELL_RANK[i]]) continue;
      if (suitKeys.length && !suits[CELL_SUIT[i]]) continue;
      if (colorKeys.length && !spec.colors[CELL_COLOR[i]]) continue;
      if (setUnion && !setUnion[i]) continue;
      if (stateKeys.length && !statePass(stateKeys, i, st)) continue;
      out.push(i);
    }
    return { cells: out, spec: spec, active: true, stateFiltered: !!stateKeys.length };
  }

  /* ================================================================== *
   * Paint
   * ================================================================== */

  function paint(cells, filtering) {
    var t = tiles();
    var map = {}, i;
    for (i = 0; i < cells.length; i++) map[cells[i]] = true;

    // Only touch tiles whose class actually changes.
    for (i = 0; i < lastMatch.length; i++) {
      if (!map[lastMatch[i]] && t[lastMatch[i]]) t[lastMatch[i]].classList.remove('hit');
    }
    for (i = 0; i < cells.length; i++) {
      if (!lastMatchMap[cells[i]] && t[cells[i]]) t[cells[i]].classList.add('hit');
    }

    var board = el.board || (el.board = $('board'));
    if (board && filtering !== lastFiltering) {
      board.classList.toggle('filtering', filtering);
      lastFiltering = filtering;
    }
    lastMatch = cells.slice();
    lastMatchMap = map;
  }

  function countText(res) {
    var spec = res.spec;
    if (!res.active) return '';
    if (spec.bad.length) {
      return 'no match for “' + spec.bad.join(' ') + '”';
    }
    var n = res.cells.length;
    if (!n) {
      if (spec.sawJack) return 'jacks are wild — not printed on the board';
      return 'no spaces match';
    }
    var parts = [n + ' space' + (n === 1 ? '' : 's')];
    if (!res.stateFiltered) {
      var st = state();
      var open = 0, cardCells = 0;
      for (var i = 0; i < res.cells.length; i++) {
        var ci = res.cells[i];
        if (CELL_CARD[ci] === null) continue;      // free corner: never "open"
        cardCells++;
        var cell = st && st.board ? st.board[ci] : null;
        if (!cell || cell.chip === null) open++;
      }
      if (cardCells && open !== n) parts.push(open + ' open');
    }
    if (n <= 4) {
      var co = [];
      for (var k = 0; k < res.cells.length; k++) co.push(SQ.Board.coord(res.cells[k]));
      parts.push(co.join(', '));
    }
    return parts.join(' · ');
  }

  function syncChrome(res) {
    if (el['find-count']) el['find-count'].textContent = countText(res);
    if (el['find-clear']) el['find-clear'].hidden = !query;
    if (el['findbar']) {
      el['findbar'].classList.toggle('find-nomatch',
        !!(res.active && !res.cells.length));
    }
    // reflect chip state
    if (el['ft-ranks']) {
      eachChip(el['ft-ranks'], function (b) {
        b.classList.toggle('on', !!chipRanks[b.getAttribute('data-rank')]);
      });
    }
    if (el['ft-suits']) {
      eachChip(el['ft-suits'], function (b) {
        b.classList.toggle('on', !!chipSuits[b.getAttribute('data-suit')]);
      });
    }
    if (el['ft-state']) {
      eachChip(el['ft-state'], function (b) {
        b.classList.toggle('on', !!chipStates[b.getAttribute('data-state')]);
      });
    }
  }

  function eachChip(host, fn) {
    var list = host.querySelectorAll('.ft-chip');
    for (var i = 0; i < list.length; i++) fn(list[i]);
  }

  /* ================================================================== *
   * Public verbs
   * ================================================================== */

  function apply() {
    if (!inited) return [];
    var res = computeMatches();
    paint(res.cells, res.active && res.cells.length > 0);
    syncChrome(res);
    return res.cells;
  }

  function setQuery(str) {
    query = String(str == null ? '' : str);
    if (el['find-input'] && el['find-input'].value !== query) el['find-input'].value = query;
    apply();
  }

  function toggleRank(rank) {
    var r = String(rank).toUpperCase();
    if (r === '10') r = 'T';
    if (chipRanks[r]) delete chipRanks[r]; else chipRanks[r] = true;
    apply();
  }

  function toggleSuit(suit) {
    var s = String(suit).toUpperCase();
    if (chipSuits[s]) delete chipSuits[s]; else chipSuits[s] = true;
    apply();
  }

  function toggleState(key) {
    var k = String(key).toLowerCase();
    if (chipStates[k]) delete chipStates[k]; else chipStates[k] = true;
    apply();
  }

  function clear() {
    query = '';
    chipRanks = {}; chipSuits = {}; chipStates = {};
    if (el['find-input']) el['find-input'].value = '';
    apply();
  }

  function matches() {
    return lastMatch.slice();
  }

  function isActive() {
    if (query.trim()) return true;
    return !!(keys(chipRanks).length || keys(chipSuits).length || keys(chipStates).length);
  }

  function showTray(on) {
    var tray = el['filter-tray'] || (el['filter-tray'] = $('filter-tray'));
    var btn = el['btn-suits'] || (el['btn-suits'] = $('btn-suits'));
    if (!tray) return;
    var want = on == null ? tray.hidden : !!on;
    tray.hidden = !want;
    if (btn) btn.classList.toggle('on', want);
  }

  /* Transient ring, independent of the filter state. */
  function flash(cellIndices, ms) {
    var t = tiles();
    var list = [].concat(cellIndices == null ? [] : cellIndices);
    var dur = ms == null ? 900 : ms;
    list.forEach(function (i) {
      var node = t[i];
      if (!node) return;
      node.classList.add('find-flash');
      if (flashTimers[i]) clearTimeout(flashTimers[i]);
      flashTimers[i] = setTimeout(function () {
        node.classList.remove('find-flash');
        delete flashTimers[i];
      }, dur);
    });
  }

  /* ================================================================== *
   * Tray construction
   * ================================================================== */

  function buildChips() {
    var host = el['ft-ranks'];
    var i, b;
    if (host) {
      host.innerHTML = '';
      for (i = 0; i < CHIP_RANKS.length; i++) {
        var r = CHIP_RANKS[i];
        b = document.createElement('button');
        b.type = 'button';
        b.className = 'ft-chip';
        b.setAttribute('data-rank', r);
        b.textContent = r === 'T' ? '10' : r;
        b.title = 'Show every ' + (r === 'T' ? '10' : r) + ' on the board';
        host.appendChild(b);
      }
    }

    host = el['ft-suits'];
    if (host) {
      host.innerHTML = '';
      for (i = 0; i < SQ.Cards.SUITS.length; i++) {
        var s = SQ.Cards.SUITS[i];
        var red = (s === 'H' || s === 'D');
        b = document.createElement('button');
        b.type = 'button';
        b.className = 'ft-chip' + (red ? ' suit-red' : '');
        b.setAttribute('data-suit', s);
        b.innerHTML = SQ.Cards.suitGlyph(s, { size: 12, fill: 'currentColor' });
        b.title = 'Show every ' + SQ.Cards.parse('A' + s).suitName + ' space';
        host.appendChild(b);
      }
    }

    host = el['ft-state'];
    if (host) {
      host.innerHTML = '';
      for (i = 0; i < STATE_CHIPS.length; i++) {
        b = document.createElement('button');
        b.type = 'button';
        b.className = 'ft-chip';
        b.setAttribute('data-state', STATE_CHIPS[i].key);
        b.textContent = STATE_CHIPS[i].label;
        host.appendChild(b);
      }
    }
  }

  /* ================================================================== *
   * Wiring
   * ================================================================== */

  function isTypingTarget(node) {
    if (!node) return false;
    var tag = (node.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    return !!node.isContentEditable;
  }

  function wire() {
    var input = el['find-input'];

    if (input) {
      input.addEventListener('input', function () {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function () {
          debounceTimer = null;
          query = input.value;
          apply();
        }, 90);
      });

      input.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' || e.keyCode === 27) {
          e.stopPropagation();
          if (input.value) { e.preventDefault(); clear(); }
          else { input.blur(); }
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
          query = input.value;
          apply();
        }
      });
    }

    if (el['find-clear']) {
      el['find-clear'].addEventListener('click', function (e) {
        e.preventDefault();
        clear();
        if (input) input.focus();
      });
    }

    if (el['btn-suits']) {
      el['btn-suits'].addEventListener('click', function (e) {
        e.preventDefault();
        showTray(el['filter-tray'] ? el['filter-tray'].hidden : true);
      });
    }

    if (el['ft-reset']) {
      el['ft-reset'].addEventListener('click', function (e) { e.preventDefault(); clear(); });
    }

    // Delegated chip clicks — survives a tray rebuild.
    function chipHandler(e) {
      var b = e.target && e.target.closest ? e.target.closest('.ft-chip') : null;
      if (!b) return;
      e.preventDefault();
      if (b.hasAttribute('data-rank')) toggleRank(b.getAttribute('data-rank'));
      else if (b.hasAttribute('data-suit')) toggleSuit(b.getAttribute('data-suit'));
      else if (b.hasAttribute('data-state')) toggleState(b.getAttribute('data-state'));
    }
    ['ft-ranks', 'ft-suits', 'ft-state'].forEach(function (id) {
      if (el[id]) el[id].addEventListener('click', chipHandler);
    });

    // "/" anywhere focuses the box.
    document.addEventListener('keydown', function (e) {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      if (!input) return;
      e.preventDefault();
      input.focus();
      input.select();
    });
  }

  /* ================================================================== *
   * init
   * ================================================================== */

  /* index.html is owned by the lead, so this module brings its own stylesheet. */
  function ensureStyles() {
    var href = 'css/find.css';
    var links = document.getElementsByTagName('link');
    for (var i = 0; i < links.length; i++) {
      if ((links[i].getAttribute('href') || '').indexOf('find.css') >= 0) return;
    }
    var l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    (document.head || document.documentElement).appendChild(l);
  }

  function init(opts) {
    opts = opts || {};
    getState = typeof opts.getState === 'function' ? opts.getState : null;

    ensureStyles();

    ['board', 'findbar', 'find-input', 'find-clear', 'find-count',
     'filter-tray', 'btn-suits', 'ft-ranks', 'ft-suits', 'ft-state',
     'ft-reset'].forEach(function (id) { el[id] = $(id); });

    buildIndex();

    if (!inited) {
      buildChips();
      wire();
      inited = true;
    } else {
      buildChips();
    }

    // A fresh board means fresh tile nodes.
    tileCache = [];
    lastMatch = []; lastMatchMap = {}; lastFiltering = false;
    if (el.board) el.board.classList.remove('filtering');

    if (el['find-input']) el['find-input'].value = query;
    apply();
    return SQ.Find;
  }

  SQ.Find = {
    init: init,
    setQuery: setQuery,
    toggleRank: toggleRank,
    toggleSuit: toggleSuit,
    toggleState: toggleState,
    clear: clear,
    apply: apply,
    matches: matches,
    isActive: isActive,
    showTray: showTray,
    flash: flash,
    // introspection, handy for other modules and for debugging
    query: function () { return query; },
    parse: parseQuery
  };
})();
