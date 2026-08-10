/* Sequentia — rendering layer. Owns the DOM; knows nothing about rules beyond
 * what it asks SQ.Engine. Everything here is idempotent: call sync() as often
 * as you like.
 */
(function () {
  'use strict';
  var SQ = (window.SQ = window.SQ || {});
  var Cards, Engine, Board;

  var el = {};          // cached element refs
  var tiles = [];       // tile elements by cell index
  var seqLayer = null;
  var drawnSeqs = 0;    // how many sequence flourishes we've drawn
  var handHidden = false;

  function $(id) { return document.getElementById(id); }
  function mk(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function init() {
    Cards = SQ.Cards; Engine = SQ.Engine; Board = SQ.Board;
    ['board', 'stage', 'world', 'hand', 'players', 'log', 'deck-count', 'deck-back',
     'hand-owner', 'hand-hint', 'turn-banner', 'inspector',
     'inspector-card', 'inspector-title', 'inspector-sub', 'screen', 'screen-panel',
     'btn-dead', 'btn-pass', 'btn-peek'].forEach(function (id) {
      el[id] = $(id);
    });
    buildBoard();
    el['deck-back'].innerHTML = Cards.backSvg();
  }

  /* -------------------------------------------------------------- board */

  function buildBoard() {
    var frag = document.createDocumentFragment();
    tiles = [];
    Board.LAYOUT_FLAT.forEach(function (card, i) {
      var t = mk('div', 'tile' + (card === 'FREE' ? ' free' : ''));
      t.dataset.cell = String(i);
      t.setAttribute('role', 'gridcell');
      var face = mk('div', 'tile-face');
      if (card === 'FREE') {
        face.appendChild(mk('div', 'free-mark',
          '<span class="star">&#10022;</span><span class="word">Free</span>'));
        t.setAttribute('aria-label', 'Free corner');
      } else {
        t.dataset.card = card;
        face.innerHTML = Cards.svg(card);
        t.setAttribute('aria-label', Cards.label(card) + ' at ' + Board.coord(i));
      }
      t.appendChild(face);

      /* A full pip-layout card is unreadable at board scale, so every card space
       * also carries a large rank + suit index on a translucent veil. The veil's
       * opacity is driven by the zoom level (see SQ.App): at a fitted zoom you
       * read the board at a glance, and as you zoom in it fades away to reveal
       * the actual card underneath in full detail. */
      if (card !== 'FREE') {
        var p = Cards.parse(card);
        var idx = mk('div', 'tile-index' + (p.color === 'red' ? ' red' : ''));
        idx.appendChild(mk('span', 'ti-rank', p.rankLabel));
        var glyph = mk('span', 'ti-suit', Cards.suitGlyph(p.suit, { size: 40 }));
        idx.appendChild(glyph);
        t.appendChild(idx);
      }
      frag.appendChild(t);
      tiles.push(t);
    });
    el.board.innerHTML = '';
    el.board.appendChild(frag);
    seqLayer = mk('div', 'seq-layer');
    el.board.appendChild(seqLayer);
    drawnSeqs = 0;
  }

  function tileEl(i) { return tiles[i]; }

  /* Reflect the authoritative state onto the board. */
  function syncBoard(state) {
    var placedNow = state.lastMove && state.lastMove.kind !== 'remove' ? state.lastMove.cell : -1;
    for (var i = 0; i < tiles.length; i++) {
      var cell = state.board[i], t = tiles[i];
      var existing = t.querySelector('.chip');

      if (cell.chip === null) {
        if (existing && !existing.classList.contains('leaving')) {
          existing.classList.add('leaving');
          (function (node) { setTimeout(function () { node.remove(); }, 320); })(existing);
        }
        t.classList.remove('taken');
      } else {
        var color = state.players[cell.chip].color;
        if (!existing || existing.dataset.color !== color || existing.classList.contains('leaving')) {
          if (existing) existing.remove();
          var chip = mk('div', 'chip');
          chip.dataset.color = color;
          chip.dataset.owner = String(cell.chip);
          t.appendChild(chip);
        }
        t.classList.add('taken');
      }

      t.classList.toggle('in-seq', cell.seqs.length > 0);
      t.classList.toggle('last-move', i === placedNow);
    }

    // Draw a sweep line for each newly completed sequence.
    while (drawnSeqs < state.sequences.length) {
      drawSeqLine(state.sequences[drawnSeqs]);
      drawnSeqs++;
    }
    if (state.sequences.length === 0 && seqLayer.childNodes.length) {
      seqLayer.innerHTML = ''; drawnSeqs = 0;
    }
  }

  function drawSeqLine(seq) {
    var a = tiles[seq.cells[0]], b = tiles[seq.cells[seq.cells.length - 1]];
    if (!a || !b) return;
    var br = el.board.getBoundingClientRect();
    var ar = a.getBoundingClientRect(), rr = b.getBoundingClientRect();
    // Board may be scaled by the zoom transform; normalise back to layout px.
    var scale = br.width / el.board.offsetWidth || 1;
    var x1 = (ar.left + ar.width / 2 - br.left) / scale;
    var y1 = (ar.top + ar.height / 2 - br.top) / scale;
    var x2 = (rr.left + rr.width / 2 - br.left) / scale;
    var y2 = (rr.top + rr.height / 2 - br.top) / scale;
    var dx = x2 - x1, dy = y2 - y1;
    var len = Math.sqrt(dx * dx + dy * dy);
    var line = mk('div', 'seq-line');
    line.style.left = x1 + 'px';
    line.style.top = (y1 - 3) + 'px';
    line.style.width = len + 'px';
    line.style.transform = 'rotate(' + Math.atan2(dy, dx) + 'rad)';
    seqLayer.appendChild(line);
  }

  /* -------------------------------------------------- target highlighting */

  var targetMode = null;

  function setTargets(cells, mode, blocked) {
    clearTargets();
    targetMode = mode || 'place';
    el.board.classList.add('targeting');
    var cls = targetMode === 'remove' ? 'target-remove' : 'target';
    cells.forEach(function (i) { if (tiles[i]) tiles[i].classList.add(cls); });
    (blocked || []).forEach(function (i) { if (tiles[i]) tiles[i].classList.add('blocked'); });
  }

  function clearTargets() {
    el.board.classList.remove('targeting');
    for (var i = 0; i < tiles.length; i++) {
      tiles[i].classList.remove('target', 'target-remove', 'target-weak', 'blocked', 'snap');
    }
    targetMode = null;
  }

  function setSnap(cellIndex) {
    for (var i = 0; i < tiles.length; i++) tiles[i].classList.remove('snap');
    if (cellIndex != null && tiles[cellIndex]) tiles[cellIndex].classList.add('snap');
  }

  function flashPlacement(cellIndex) {
    var t = tiles[cellIndex];
    if (!t) return;
    t.classList.remove('just-placed');
    void t.offsetWidth;                       // restart the animation
    t.classList.add('just-placed');
    setTimeout(function () { t.classList.remove('just-placed'); }, 600);
  }

  /* --------------------------------------------------------------- hand */

  /* `seat` is whose hand to show, defaulting to whoever is to move. Online it is
   * always the local player's own seat, so you keep looking at your own cards
   * while the opponent thinks. */
  function renderHand(state, seat) {
    var p = seat == null ? state.turn : seat;
    var cards = state.hands[p] || [];
    var player = state.players[p];
    // Online this strip is always the local player's own hand, whoever is to move.
    el['hand-owner'].textContent = (state.remote && p === state.mySeat)
      ? 'Your hand'
      : player.name + "'s hand";
    el.hand.innerHTML = '';
    el.hand.classList.toggle('hidden-hand', handHidden);

    cards.forEach(function (id, n) {
      var c = mk('div', 'hand-card');
      c.dataset.card = id;
      c.dataset.handIndex = String(n);
      c.setAttribute('role', 'listitem');
      c.style.animationDelay = (n * 45) + 'ms';

      if (handHidden) {
        c.innerHTML = Cards.backSvg();
        c.classList.add('facedown');
        el.hand.appendChild(c);
        return;
      }

      c.innerHTML = Cards.svg(id);
      c.setAttribute('aria-label', Cards.label(id));

      var targets = Engine.legalTargets(state, id, p);
      var badge = mk('div', 'badge');
      if (Cards.isTwoEyedJack(id)) {
        badge.classList.add('jack');
        badge.textContent = '✦';                 // wild
        badge.title = 'Two-eyed jack — wild. Play on any open space.';
      } else if (Cards.isOneEyedJack(id)) {
        badge.classList.add('jack');
        badge.textContent = '✕';                 // remove
        badge.title = "One-eyed jack — remove an opponent's chip.";
      } else {
        badge.textContent = String(targets.length);
        badge.title = targets.length + ' open space' + (targets.length === 1 ? '' : 's') + ' for this card';
      }
      if (!targets.length) {
        badge.classList.add('none');
        c.classList.add('unplayable');
        if (Engine.isDead(state, id)) c.classList.add('dead');
      }
      c.appendChild(badge);

      var zb = mk('button', 'zoombtn', '&#9906;');
      zb.title = 'Inspect this card (or press Z while hovering)';
      zb.dataset.zoom = id;
      c.appendChild(zb);

      el.hand.appendChild(c);
    });

    // The hand tools carry their own state: Dead card disables itself when there is
    // nothing to swap, and Pass only exists at all when there is no legal move —
    // and pulses on arrival, so it is noticed without being announced.
    var isBot = state.players[p].kind === 'ai';
    var dead = Engine.deadCardsInHand(state, p);
    el['btn-dead'].disabled = isBot || !(dead.length && !state.deadUsedThisTurn);
    el['btn-dead'].textContent = dead.length ? 'Dead card (' + dead.length + ')' : 'Dead card';
    var stuck = !Engine.hasAnyMove(state, p);
    // A bot resolves its own stuck turn; never ask the watcher to press Pass for it.
    el['btn-pass'].hidden = isBot || !stuck;
    el['btn-pass'].classList.toggle('needed', stuck && !isBot);
    el['btn-peek'].textContent = handHidden ? 'Show hand' : 'Hide hand';

    var hint;
    if (isBot) {
      // A bot's hand is face down for the same reason a human's is, but telling a
      // bot to click "Show hand" is nonsense — say what's actually happening.
      hint = handHidden
        ? state.players[p].name + ' is thinking — its hand stays face down.'
        : state.players[p].name + ' is thinking…';
    }
    else if (handHidden) hint = 'Hand hidden — click “Show hand” when it is your turn.';
    else if (stuck) hint = 'No legal moves. You must pass.';
    else hint = 'Drag a card onto a highlighted space. Hover to preview, ' +
      'click the lens to inspect.';
    el['hand-hint'].textContent = hint;
  }

  function handCardEls() {
    return Array.prototype.slice.call(el.hand.querySelectorAll('.hand-card'));
  }

  function toggleHandHidden(force) {
    handHidden = force == null ? !handHidden : !!force;
    return handHidden;
  }
  function isHandHidden() { return handHidden; }

  /* ------------------------------------------------------------ sidebar */

  /* The scoreboard is scored *per team*, because sequences are. With everybody
   * playing for themselves that collapses to one card per player; with real teams
   * each card gains a roster so you can see who is up inside the team. */
  function renderPlayers(state) {
    el.players.innerHTML = '';
    var live = state.phase === 'play';
    var solo = state.teams.length === state.players.length;
    el.players.classList.toggle('teamed', !solo);
    el.players.classList.toggle('crowded', state.players.length > 4);

    state.teams.forEach(function (team) {
      var members = Engine.teamMembers(state, team);
      if (!members.length) return;
      var upNow = live && members.some(function (p) { return p.index === state.turn; });

      var card = mk('div', 'pcard' + (upNow ? ' active' : ''));
      var top = mk('div', 'pcard-top');
      var disc = mk('div', 'pdisc'); disc.dataset.color = members[0].color;
      top.appendChild(disc);
      top.appendChild(mk('span', 'pname',
        escapeHtml(solo ? members[0].name : Engine.teamLabel(state, team))));
      if (solo && members[0].kind !== 'human') {
        top.appendChild(mk('span', 'ptag', members[0].kind === 'ai' ? 'AI' : 'online'));
      }
      if (upNow) top.appendChild(mk('span', 'pturn', 'to play'));
      card.appendChild(top);

      var meta = mk('div', 'pmeta');
      var pips = mk('div', 'pips');
      for (var s = 0; s < state.seqToWin; s++) {
        pips.appendChild(mk('div', 'pip' + (state.seqCount[team] > s ? ' on' : '')));
      }
      meta.appendChild(pips);
      var txt = state.seqCount[team] + '/' + state.seqToWin +
                ' sequence' + (state.seqToWin === 1 ? '' : 's');
      if (solo) {
        var n = state.hands[members[0].index].length;
        txt += ' · ' + n + (n === 1 ? ' card' : ' cards');
      }
      meta.appendChild(mk('span', 'pmeta-num', txt));
      card.appendChild(meta);

      if (!solo) {
        var roster = mk('div', 'proster');
        members.forEach(function (p) {
          var row = mk('div', 'prow' + (live && p.index === state.turn ? ' now' : ''));
          row.appendChild(mk('span', 'prow-name', escapeHtml(p.name)));
          if (p.kind !== 'human') {
            row.appendChild(mk('span', 'ptag', p.kind === 'ai' ? 'AI' : 'online'));
          }
          row.appendChild(mk('span', 'prow-cards', String(state.hands[p.index].length)));
          roster.appendChild(row);
        });
        card.appendChild(roster);
      }
      el.players.appendChild(card);
    });
  }

  var loggedUpTo = 0;
  function renderLog(state, reset) {
    if (reset) { el.log.innerHTML = ''; loggedUpTo = 0; }
    for (; loggedUpTo < state.log.length; loggedUpTo++) {
      var e = state.log[loggedUpTo];
      var li = mk('li', 'k-' + e.kind, escapeHtml(e.text));
      el.log.appendChild(li);
    }
    el.log.scrollTop = el.log.scrollHeight;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function renderDeck(state) {
    el['deck-count'].textContent = state.deck.length + (state.discard.length ? ' (+' + state.discard.length + ' discard)' : '');
  }

  /* --------------------------------------------------------- transients */

  /* Refusals are shown, never written. Whatever the player just interacted with
   * pulses red and that is the entire message: the wrong tile, the button that
   * cannot do anything right now, the empty field. */
  var REJECT_MS = 620;

  function reject(node) {
    if (!node) return null;
    node.classList.remove('rejected');
    void node.offsetWidth;                 // restart the animation
    node.classList.add('rejected');
    setTimeout(function () { node.classList.remove('rejected'); }, REJECT_MS);
    return node;
  }

  /* Flash a board space; falls back to the board edge when there is no one square
   * to blame (playing out of turn, a lost connection). */
  function rejectCell(cellIndex) {
    var t = cellIndex == null ? null : tiles[cellIndex];
    return reject(t || el.board);
  }

  function rejectBoard() { return reject(el.board); }

  function banner(text, ms) {
    var b = el['turn-banner'];
    b.querySelector('span').textContent = text;
    b.classList.remove('hidden', 'out');
    void b.offsetWidth;
    setTimeout(function () {
      b.classList.add('out');
      setTimeout(function () { b.classList.add('hidden'); }, 360);
    }, ms || 1100);
  }

  /* --------------------------------------------------------- inspector */

  function openInspector(cardId, subtitle) {
    el['inspector-card'].innerHTML = Cards.svg(cardId, { rounded: true });
    el['inspector-title'].textContent = Cards.label(cardId);
    el['inspector-sub'].textContent = subtitle || '';
    el.inspector.classList.remove('hidden');
  }
  function closeInspector() { el.inspector.classList.add('hidden'); }
  function inspectorOpen() { return !el.inspector.classList.contains('hidden'); }

  /* ------------------------------------------------------------ screens */

  function showScreen(html) {
    el['screen-panel'].innerHTML = html;
    el.screen.classList.remove('hidden');
  }
  function hideScreen() { el.screen.classList.add('hidden'); }
  function screenOpen() { return !el.screen.classList.contains('hidden'); }

  function sparks(colorPair) {
    var colors = colorPair || ['#f6e3a6', '#d9b65c', '#4fd39b', '#ffffff'];
    for (var i = 0; i < 90; i++) {
      var s = mk('div', 'spark');
      s.style.left = (Math.random() * 100) + 'vw';
      s.style.top = (-10 - Math.random() * 20) + 'vh';
      s.style.background = colors[i % colors.length];
      s.style.animationDuration = (2.2 + Math.random() * 2.4) + 's';
      s.style.animationDelay = (Math.random() * 1.4) + 's';
      s.style.opacity = String(0.5 + Math.random() * 0.5);
      document.body.appendChild(s);
      (function (n) { setTimeout(function () { n.remove(); }, 6500); })(s);
    }
  }

  SQ.View = {
    init: init,
    el: el,
    tiles: function () { return tiles; },
    tileEl: tileEl,
    buildBoard: buildBoard,
    syncBoard: syncBoard,
    setTargets: setTargets,
    clearTargets: clearTargets,
    setSnap: setSnap,
    flashPlacement: flashPlacement,
    renderHand: renderHand,
    handCardEls: handCardEls,
    toggleHandHidden: toggleHandHidden,
    isHandHidden: isHandHidden,
    renderPlayers: renderPlayers,
    renderLog: renderLog,
    renderDeck: renderDeck,
    reject: reject,
    rejectCell: rejectCell,
    rejectBoard: rejectBoard,
    banner: banner,
    openInspector: openInspector,
    closeInspector: closeInspector,
    inspectorOpen: inspectorOpen,
    showScreen: showScreen,
    hideScreen: hideScreen,
    screenOpen: screenOpen,
    sparks: sparks
  };
})();
