/* Sequentia — application wiring. Owns the game state and the turn flow, and
 * connects the engine to the view, zoom, find and drag modules.
 */
(function () {
  'use strict';
  var SQ = (window.SQ = window.SQ || {});
  var View, Engine, Cards, Board;

  var state = null;
  var busy = false;             // input locked during animations / handoff
  var pendingDead = false;      // "click a dead card to swap it" mode
  var settings = {
    playerCount: 2,
    teamCount: 2,               // 2 or 3; equal to playerCount means a free-for-all
    privacy: false,             // show a pass-the-device screen between turns
    names: ['Player 1', 'Player 2'],
    kinds: ['human', 'human'],  // per seat: 'human' | 'ai' | 'remote'
    aiLevel: 'medium'
  };

  function $(id) { return document.getElementById(id); }

  /* ------------------------------------------------------------ bootstrap */

  function boot() {
    View = SQ.View; Engine = SQ.Engine; Cards = SQ.Cards; Board = SQ.Board;

    View.init();

    // A broken layout is a bug in the build, not something the player can act on,
    // so it goes to the console rather than on screen.
    var problems = Board.validate();
    if (problems.length) console.error('Board layout validation failed:', problems);

    // Optional modules are written independently; never let one take the game down.
    safely('Zoom', function () {
      SQ.Zoom.init({
        stage: $('stage'), world: $('world'), content: $('board'),
        onChange: function (v) {
          if (SQ.Drag) SQ.Drag.invalidate();
          syncIndexOpacity(v && v.scale);
        }
      });
    });
    safely('Find', function () {
      SQ.Find.init({ getState: function () { return state; } });
    });
    safely('Drag', function () {
      SQ.Drag.init({
        getState: function () { return state; },
        canInteract: function () {
          return !busy && state && state.phase === 'play' &&
                 !View.isHandHidden() && isMyTurn();
        },
        onDrop: handleDrop,
        onInspect: function (id) { inspectCard(id); },
        onSnap: null,
        // Hovering a card repaints the highlight layer, which supersedes the
        // "my moves" overlay — keep the button's state honest.
        onPreview: function (id) {
          if (id && legalOn) { legalOn = false; $('btn-legal').classList.remove('on'); }
        }
      });
    });

    wireChrome();
    wireKeyboard();
    // Welcome screen first: newGame() starts a bot's turn if one is in the first
    // seat, and nothing should be playing itself behind a modal.
    welcome();
    newGame({});
  }

  function safely(name, fn) {
    try { fn(); } catch (err) {
      console.error('[Sequentia] ' + name + ' module failed to initialise:', err);
    }
  }

  /* The board tiles carry a big rank+suit veil so the board is readable when
   * fitted to the screen. Past FADE_FROM it dissolves, handing the tile over to
   * the full card artwork — which is the whole point of being able to zoom. */
  var FADE_FROM = 1.05, FADE_TO = 1.65;
  function syncIndexOpacity(scale) {
    if (!scale) return;
    var op = scale <= FADE_FROM ? 1
           : scale >= FADE_TO ? 0
           : (FADE_TO - scale) / (FADE_TO - FADE_FROM);
    $('board').style.setProperty('--idx-op', op.toFixed(3));
  }

  /* --------------------------------------------------------------- chrome */

  function wireChrome() {
    $('btn-new').addEventListener('click', newGameScreen);
    $('btn-help').addEventListener('click', rulesScreen);
    $('btn-legal').addEventListener('click', toggleLegalOverlay);
    $('btn-dead').addEventListener('click', onDeadClick);
    $('btn-pass').addEventListener('click', onPassClick);
    $('btn-peek').addEventListener('click', function () {
      View.toggleHandHidden();
      render();
    });

    $('inspector-close').addEventListener('click', View.closeInspector);
    $('inspector-backdrop').addEventListener('click', View.closeInspector);

    // Inspect a board card on click. Deferred slightly so a double-click can be
    // claimed by the zoom module instead.
    var clickTimer = null;
    var board = $('board');
    board.addEventListener('click', function (e) {
      if (SQ.Drag && SQ.Drag.selected()) return;      // placing a card, not inspecting
      var tile = e.target.closest('.tile');
      if (!tile || tile.classList.contains('free')) return;
      var cell = Number(tile.dataset.cell);
      clearTimeout(clickTimer);
      clickTimer = setTimeout(function () { inspectCell(cell); }, 200);
    });
    board.addEventListener('dblclick', function () { clearTimeout(clickTimer); });

    // Clicking a dead card while in swap mode.
    $('hand').addEventListener('click', function (e) {
      if (!pendingDead) return;
      var c = e.target.closest('.hand-card');
      if (!c) return;
      e.stopPropagation();
      trySwapDead(c.dataset.card);
    }, true);

    // Right-click a card in hand to fly the camera to somewhere it can be played.
    // Suppressed across the whole strip, not just on cards, so the native menu
    // never flickers up between the cards.
    $('hand').addEventListener('contextmenu', function (e) {
      e.preventDefault();
      var c = e.target.closest('.hand-card');
      if (c) focusSlotFor(c.dataset.card);
    });

    installScreenHandler();
  }

  function wireKeyboard() {
    document.addEventListener('keydown', function (e) {
      var t = e.target;
      var typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

      if (e.key === 'Escape') {
        if (View.inspectorOpen()) { View.closeInspector(); return; }
        if (View.screenOpen() && state && state.phase === 'play') {
          View.hideScreen(); maybeStartAI(); return;
        }
        if (SQ.Drag && SQ.Drag.selected()) { SQ.Drag.setSelected(null); return; }
        return;
      }
      if (typing) return;

      // Inspect whatever is under the cursor.
      if (e.key === 'z' || e.key === 'Z') { inspectUnderCursor(); return; }
      if (e.key === '?' || (e.key === '/' && e.shiftKey)) { e.preventDefault(); rulesScreen(); return; }
      if (e.key === 'd' || e.key === 'D') { onDeadClick(); return; }
      if (e.key === 'l' || e.key === 'L') { toggleLegalOverlay(); return; }
      if (e.key === 'h' || e.key === 'H') { View.toggleHandHidden(); render(); return; }

      // 1-9 select the nth card in hand.
      if (/^[1-9]$/.test(e.key) && state && state.phase === 'play') {
        var idx = Number(e.key) - 1;
        var cards = state.hands[state.turn];
        if (idx < cards.length && SQ.Drag) {
          SQ.Drag.setSelected(SQ.Drag.selected() === cards[idx] ? null : cards[idx]);
        }
      }
    });

    // Track the pointer so `Z` knows what to inspect.
    document.addEventListener('pointermove', function (e) {
      lastPointer.x = e.clientX; lastPointer.y = e.clientY;
    }, { passive: true });
  }

  var lastPointer = { x: 0, y: 0 };

  function inspectUnderCursor() {
    var node = document.elementFromPoint(lastPointer.x, lastPointer.y);
    if (!node || !node.closest) return;
    var hc = node.closest('.hand-card');
    if (hc && hc.dataset.card) { inspectCard(hc.dataset.card); return; }
    var tile = node.closest('.tile');
    if (tile && !tile.classList.contains('free')) inspectCell(Number(tile.dataset.cell));
  }

  function inspectCard(id) {
    if (!id) return;
    var cells = Board.cellsForCard(id);
    var sub;
    if (Cards.isTwoEyedJack(id)) {
      sub = 'Two-eyed jack — wild. Play it on any open space on the board.';
    } else if (Cards.isOneEyedJack(id)) {
      sub = "One-eyed jack — remove one opponent chip. Chips locked into a completed sequence are safe.";
    } else {
      var open = cells.filter(function (i) { return Engine.isOpen(state.board[i]); });
      sub = 'On the board at ' + cells.map(Board.coord).join(' and ') + ' · ' +
        (open.length ? open.length + ' still open (' + open.map(Board.coord).join(', ') + ')' : 'both spaces taken — this card is dead');
    }
    View.openInspector(id, sub);
  }

  function inspectCell(cell) {
    var c = state.board[cell];
    if (!c || c.free) return;
    var twin = Board.cellsForCard(c.card).filter(function (i) { return i !== cell; })[0];
    var sub = 'Space ' + Board.coord(cell) + ' · ';
    sub += c.chip === null ? 'open' : 'held by ' + state.players[c.chip].name;
    if (c.seqs.length) sub += ' · part of a completed sequence (cannot be removed)';
    if (twin != null) {
      sub += ' · its twin is at ' + Board.coord(twin) +
        (Engine.isOpen(state.board[twin]) ? ' (open)' : ' (taken)');
    }
    View.openInspector(c.card, sub);
  }

  /* --------------------------------------------------- right-click to find */

  /* Right-clicking a card in hand walks the camera to a space that card can be
   * played on. Repeated right-clicks cycle through the alternatives, so a normal
   * card with both spaces open — or a wild jack with dozens — is fully explorable
   * without ever hunting across the board by eye.
   *
   * The camera is pushed to at least FOCUS_SCALE: centring at a fitted-out zoom
   * would move nothing visible, since the whole board is already on screen. */
  var FOCUS_SCALE = 1.8;
  var focusCycle = { card: null, at: -1 };

  function focusSlotFor(cardId) {
    if (!cardId || !state || state.phase !== 'play' || busy) return;
    if (View.isHandHidden()) return;
    var seat = viewerSeat();
    if (state.hands[seat].indexOf(cardId) < 0) return;          // not our card

    // Nowhere to go: the card already shows a 0 badge and greys out, so there is
    // nothing to say about it.
    var cells = Engine.legalTargets(state, cardId, seat);
    if (!cells.length) return;

    // Advance the cycle, restarting whenever a different card is right-clicked.
    if (focusCycle.card !== cardId) { focusCycle.card = cardId; focusCycle.at = 0; }
    else focusCycle.at = (focusCycle.at + 1) % cells.length;
    var cell = cells[focusCycle.at];

    // Arm the card as if it had been clicked: Drag paints every legal space (and
    // the dashed taken ones), and a click on the tile will now play it.
    if (SQ.Drag) SQ.Drag.setSelected(cardId);
    View.setSnap(cell);

    safely('Zoom', function () {
      var z = SQ.Zoom.get();
      SQ.Zoom.focusCell(cell, {
        scale: Math.max(z ? z.scale : 0, FOCUS_SCALE),
        animate: true
      });
    });
    // No commentary: the camera landing on a ringed space, with every other legal
    // space also ringed, already says everything the message used to.
  }

  /* ------------------------------------------------------- legal overlay */

  var legalOn = false;
  function toggleLegalOverlay() {
    if (!state || state.phase !== 'play') return;
    legalOn = !legalOn;
    $('btn-legal').classList.toggle('on', legalOn);
    if (!legalOn) { View.clearTargets(); return; }
    var seat = viewerSeat();
    var seen = {}, cells = [];
    state.hands[seat].forEach(function (id) {
      Engine.legalTargets(state, id, seat).forEach(function (i) {
        if (!seen[i]) { seen[i] = 1; cells.push(i); }
      });
    });
    View.setTargets(cells, 'place', []);   // the rings are the answer
  }

  /* ----------------------------------------------------------- game flow */

  function newGame(opts) {
    cancelAI();                 // a bot mid-think must not play into the new game
    ensureSeats(settings.playerCount);
    state = Engine.createGame({
      seed: opts.seed,
      players: Engine.makeRoster(settings.playerCount, settings.teamCount, {
        names: settings.names,
        kinds: settings.kinds
      })
    });
    legalOn = false;
    $('btn-legal').classList.remove('on');
    pendingDead = false; setPickingDead(false);
    focusCycle.card = null; focusCycle.at = -1;
    busy = false;
    View.toggleHandHidden(false);
    View.buildBoard();
    // buildBoard replaces every tile element, so any module caching tile nodes
    // has to be re-pointed at the new DOM. Find.init is re-entrant for this.
    safely('Find', function () {
      SQ.Find.clear();
      SQ.Find.init({ getState: function () { return state; } });
    });
    View.renderLog(state, true);
    render();
    if (SQ.Zoom && SQ.Zoom.fit) safely('Zoom', function () { SQ.Zoom.fit({ animate: false }); });
    if (SQ.Drag) SQ.Drag.measure();
    netSync();                  // a rematch has to reach the other player too
    maybeStartAI();             // a bot in the first seat has to be told to go
  }

  function render() {
    View.syncBoard(state);
    // Online, always show the local player their own hand rather than whoever
    // happens to be to move.
    View.renderHand(state, online() ? SQ.Net.mySeat() : state.turn);
    View.renderPlayers(state);
    View.renderDeck(state);
    View.renderLog(state);
    if (SQ.Find && SQ.Find.isActive && SQ.Find.isActive()) SQ.Find.apply();
    if (SQ.Drag) SQ.Drag.measure();
  }

  /* Entry point for local input (drag, or click-to-place). A guest owns no state,
   * so it asks the host instead of playing; everyone else commits directly. */
  function handleDrop(cardId, cell) {
    if (busy || !state || state.phase !== 'play') return;
    if (isGuest()) { requestMove({ t: 'play', card: cardId, cell: cell }); return; }
    commitPlay(cardId, cell);
  }

  /* Actually play the card. Host and hotseat only — this is the sole place the
   * engine is mutated by a move, which is what keeps an online game in step. */
  function commitPlay(cardId, cell) {
    if (busy || state.phase !== 'play') return;
    var res = Engine.play(state, cardId, cell);
    if (!res.ok) { View.rejectCell(cell); return res; }

    busy = true;
    pendingDead = false; setPickingDead(false);
    legalOn = false;
    $('btn-legal').classList.remove('on');

    if (res.kind !== 'remove') View.flashPlacement(cell);
    View.syncBoard(state);
    View.renderPlayers(state);
    View.renderLog(state);
    View.renderDeck(state);

    var delay = 620;
    if (res.newSequences.length) {
      View.banner(res.newSequences.length > 1 ? 'DOUBLE SEQUENCE!' : 'SEQUENCE!', 1500);
      delay = 1650;
    }

    netSync();                  // the guest sees the move as soon as it is legal

    if (res.winner != null) {
      setTimeout(function () { winScreen(res.winner); }, res.newSequences.length ? 1500 : 500);
      return res;
    }

    setTimeout(beginTurn, delay);
    return res;
  }

  function beginTurn() {
    busy = false;
    if (state.phase !== 'play') { render(); return; }

    // A bot plays itself — no handoff screen, and its hand stays face down so the
    // humans at the table cannot read it.
    if (isAITurn()) {
      View.toggleHandHidden(true);
      render();
      View.banner(turnLabel(), 700);
      runAITurn();
      return;
    }

    // Online, each player has their own screen, so there is nothing to hide and
    // nobody to pass the device to.
    if (online()) {
      View.toggleHandHidden(false);
      render();
      netSync();
      View.banner(isMyTurn() ? 'Your turn' : state.players[state.turn].name + ' to play', 900);
      return;
    }

    if (settings.privacy) {
      View.toggleHandHidden(true);
      render();
      passScreen();
      return;
    }

    // Without privacy the hand is always visible — but a bot may have just hidden
    // it, so put it back rather than leaving the human staring at card backs.
    View.toggleHandHidden(false);
    render();
    View.banner(turnLabel(), 900);
  }


  /* --------------------------------------------------------------- online */

  var netWait = 0;              // guard timer while a guest waits on the host
  var NET_WAIT_MS = 6000;

  function online() { return !!(SQ.Net && SQ.Net.isOnline()); }
  function isHost() { return online() && SQ.Net.role() === 'host'; }
  function isGuest() { return online() && SQ.Net.role() === 'guest'; }

  /* Whether the person at *this* screen may act right now. In a hotseat game that
   * is whoever is up; online it is only ever our own seat. */
  function isMyTurn() {
    if (!state || state.phase !== 'play') return false;
    if (!online()) return true;
    return state.turn === SQ.Net.mySeat();
  }

  /* Host: push the position after anything that changed it. Cheap and idempotent,
   * so it is safe to call from every mutation site rather than remembering to. */
  function netSync() {
    if (isHost()) SQ.Net.broadcast(state);
  }

  /* Guest: ask the host to do something, and lock input until it answers. */
  function requestMove(msg) {
    if (!isMyTurn() || !SQ.Net.sendIntent(msg)) { View.rejectBoard(); return; }
    busy = true;
    if (netWait) clearTimeout(netWait);
    netWait = setTimeout(function () {
      netWait = 0;
      // The host never answered — unlock and flash, so the move can be retried.
      if (busy) { busy = false; View.rejectBoard(); }
    }, NET_WAIT_MS);
  }

  function clearNetWait() {
    if (netWait) { clearTimeout(netWait); netWait = 0; }
  }

  /* ---- host side: a guest has asked to do something ------------------- */

  function onGuestIntent(e) {
    if (!isHost() || !state) return;
    var seat = e.seat, msg = e.msg || {};

    function refuse(why) {
      SQ.Net.tellGuest({ t: 'refused', why: why });
      netSync();                       // resync so a confused guest re-aligns
    }

    if (state.phase !== 'play') { refuse('The game is over.'); return; }
    if (state.turn !== seat) { refuse("It isn't your turn."); return; }
    if (busy) { refuse('Hold on — the previous move is still resolving.'); return; }

    if (msg.t === 'play') {
      var res = commitPlay(msg.card, msg.cell);
      if (res && !res.ok) refuse(res.why);
      return;
    }
    if (msg.t === 'dead') {
      var d = Engine.discardDead(state, msg.card);
      if (!d.ok) { refuse(d.why); return; }
      View.renderLog(state); View.renderDeck(state); View.renderPlayers(state);
      netSync();
      return;
    }
    if (msg.t === 'pass') {
      var p = Engine.pass(state);
      if (!p.ok) { refuse(p.why); return; }
      View.renderLog(state);
      beginTurn();
      return;
    }
  }

  /* ---- guest side: the host sent us a position ------------------------ */

  var netBoardBuilt = false;

  function onRemoteState(view) {
    clearNetWait();
    clearNetWatchdog();
    var prevTurn = state ? state.turn : null;
    state = SQ.Net.decodeView(view);
    busy = false;
    pendingDead = false; setPickingDead(false);

    if (!netBoardBuilt) {
      netBoardBuilt = true;
      View.buildBoard();
      safely('Find', function () {
        SQ.Find.clear();
        SQ.Find.init({ getState: function () { return state; } });
      });
      View.renderLog(state, true);
      View.toggleHandHidden(false);
      if (SQ.Zoom && SQ.Zoom.fit) safely('Zoom', function () { SQ.Zoom.fit({ animate: false }); });
    }

    if (state.lastMove && state.lastMove.kind !== 'remove') {
      View.flashPlacement(state.lastMove.cell);
    }
    render();

    if (state.phase === 'gameover') {
      setTimeout(function () { winScreen(state.winner); }, 400);
      return;
    }
    if (state.turn !== prevTurn) {
      View.banner(isMyTurn() ? 'Your turn' : state.players[state.turn].name + ' to play', 900);
    }
  }

  /* ---- lobby ---------------------------------------------------------- */

  var pendingHostPc = null;         // host's peer connection awaiting a reply code
  var netWatchdog = 0;
  var NET_CONNECT_MS = 45000;       // how long to wait for a handshake before saying so

  /* Neither side can tell the difference between "still negotiating" and "this is
   * never going to work" — a strict NAT on either end simply goes quiet. So after
   * a generous wait, say so plainly instead of leaving a spinner up forever. */
  function armNetWatchdog(what) {
    if (netWatchdog) clearTimeout(netWatchdog);
    netWatchdog = setTimeout(function () {
      netWatchdog = 0;
      if (online() && SQ.Net.mySeat() != null) return;   // already playing
      View.showScreen(
        '<h1>Could not connect</h1>' +
        '<p class="lede">' + esc(what) + '</p>' +
        '<h2>Usually one of these</h2>' +
        '<ul>' +
        '<li>The code was truncated — it has to be copied whole.</li>' +
        '<li>The reply code was never pasted back in on the other side.</li>' +
        '<li>One of the two networks blocks direct connections. Strict or corporate ' +
        'networks need a relay server, which this build deliberately does not use.</li>' +
        '</ul>' +
        '<div class="screen-actions">' +
        '<button class="btn-big primary" data-act="net-online">Try again</button>' +
        '<button class="btn-big" data-act="net-cancel">Play locally instead</button>' +
        '</div>');
    }, NET_CONNECT_MS);
  }

  function clearNetWatchdog() {
    if (netWatchdog) { clearTimeout(netWatchdog); netWatchdog = 0; }
  }

  function netHandlersHost() {
    return {
      onIntent: onGuestIntent,
      onGuestName: function (g) {
        // Let the guest name their own seat.
        settings.names[g.seat] = g.name;
        if (state && state.players[g.seat]) {
          state.players[g.seat].name = g.name;
          View.renderPlayers(state);
          netSync();
        }
      },
      onPeerOpen: function () {
        clearNetWatchdog();
        View.hideScreen();      // the board appearing *is* the confirmation
        netSync();
        beginTurn();
      },
      onPeerClose: function () { onDisconnected('The other player disconnected.'); },
      onStatus: function () { /* connection chatter is not worth a popup */ }
    };
  }

  function netHandlersGuest() {
    return {
      onState: onRemoteState,
      onStatus: function () { /* connection chatter is not worth a popup */ },
      onRefused: function () {
        // The host turned the move down. The corrected position is already on its
        // way, so all that is needed here is to unlock and flash.
        clearNetWait();
        busy = false;
        View.rejectBoard();
      },
      onClosed: function () { onDisconnected('The host disconnected.'); },
      onRejected: function (why) { onDisconnected(why); }
    };
  }

  function onlineScreen() {
    if (!SQ.Net || !SQ.Net.supported()) {
      View.showScreen(
        '<h1>Online play</h1>' +
        '<p class="lede">This browser has no WebRTC support, so it cannot make a direct ' +
        'connection to another player.</p>' +
        '<div class="screen-actions"><button class="btn-big" data-act="setup">Back</button></div>');
      return;
    }
    View.showScreen(
      '<h1>Play online</h1>' +
      '<p class="lede">Two players, two computers, no server in between. You swap one ' +
      'block of text to introduce the browsers to each other, and after that the game ' +
      'talks peer to peer.</p>' +
      '<div class="screen-actions">' +
      '<button class="btn-big primary" data-act="net-host">Invite someone</button>' +
      '<button class="btn-big" data-act="net-join">I have an invite code</button>' +
      '</div>' +
      '<h2>Same computer</h2>' +
      '<p>To try it out, or to play someone sitting next to you, open Sequentia in two ' +
      'windows and use two tabs instead — no codes needed.</p>' +
      '<div class="screen-actions">' +
      '<button class="btn-big" data-act="net-local-host">Host in this tab</button>' +
      '<button class="btn-big" data-act="net-local-join">Join from this tab</button>' +
      '</div>' +
      '<div class="screen-actions"><button class="btn-big" data-act="setup">Back to local game</button></div>');
  }

  /* Host: generate the invite code, then wait for the reply code. */
  function hostOnlineScreen() {
    View.showScreen(
      '<h1>Invite someone</h1>' +
      '<p class="lede">Building your invite code…</p>' +
      '<p class="setup-note">This takes a second or two while your browser works out how ' +
      'it can be reached.</p>');

    SQ.Net.createOffer({ name: settings.names[0], protocol: SQ.Net.PROTOCOL })
      .then(function (r) {
        pendingHostPc = r.pc;
        View.showScreen(
          '<h1>Invite someone</h1>' +
          '<p class="lede">Send this code to the other player — any chat app will do.</p>' +
          '<textarea class="codebox" id="net-offer" readonly rows="4">' + esc(r.code) + '</textarea>' +
          '<div class="screen-actions">' +
          '<button class="btn-big" data-act="net-copy" data-target="net-offer">Copy code</button>' +
          '</div>' +
          '<h2>Then paste their reply</h2>' +
          '<p>They will send a reply code back. Paste it here to start the game.</p>' +
          '<textarea class="codebox" id="net-answer" rows="4" placeholder="Paste the reply code here"></textarea>' +
          '<div class="screen-actions">' +
          '<button class="btn-big primary" data-act="net-accept">Start the game</button>' +
          '<button class="btn-big" data-act="net-cancel">Cancel</button>' +
          '</div>');

        // Two players, one each; the host takes the first seat. The deal happens
        // in doAccept(), once the reply code has actually been pasted.
        settings.playerCount = 2;
        settings.teamCount = 2;
        settings.kinds = ['human', 'remote'];
        settings.privacy = false;
        SQ.Net.startHost(r.transport, {
          seat: 0, guestSeat: 1,
          name: settings.names[0],
          handlers: netHandlersHost()
        });
      })
      .catch(function (err) {
        View.showScreen(
          '<h1>Could not create an invite</h1>' +
          '<p class="lede">' + esc(err.message || String(err)) + '</p>' +
          '<div class="screen-actions"><button class="btn-big" data-act="net-online">Try again</button>' +
          '<button class="btn-big" data-act="setup">Back</button></div>');
      });
  }

  /* Guest: paste the invite code, get a reply code to send back. */
  function joinOnlineScreen() {
    View.showScreen(
      '<h1>Join a game</h1>' +
      '<p class="lede">Paste the invite code you were sent.</p>' +
      '<textarea class="codebox" id="net-offer-in" rows="4" placeholder="Paste the invite code here"></textarea>' +
      '<h2>Your name</h2>' +
      '<div class="setup-row"><span class="setup-disc" data-color="azure"></span>' +
      '<input class="setup-input" id="net-name" maxlength="18" value="' + esc(settings.names[1] || 'Player 2') + '"></div>' +
      '<div class="screen-actions">' +
      '<button class="btn-big primary" data-act="net-answer">Get my reply code</button>' +
      '<button class="btn-big" data-act="setup">Cancel</button>' +
      '</div>');
  }

  function doJoin() {
    var box = $('net-offer-in');
    var nameEl = $('net-name');
    var guestName = nameEl && nameEl.value.trim() ? nameEl.value.trim() : 'Player 2';
    settings.names[1] = guestName;
    var code = box ? box.value : '';
    if (!code.trim()) { View.reject(box); return; }   // empty field flashes red

    View.showScreen('<h1>Joining…</h1><p class="lede">Working out how to reach them…</p>');

    SQ.Net.answerOffer(code).then(function (r) {
      View.showScreen(
        '<h1>Send this back</h1>' +
        '<p class="lede">Send this reply code to the host. The game starts the moment ' +
        'they paste it in.</p>' +
        '<textarea class="codebox" id="net-reply" readonly rows="4">' + esc(r.code) + '</textarea>' +
        '<div class="screen-actions">' +
        '<button class="btn-big" data-act="net-copy" data-target="net-reply">Copy code</button>' +
        '</div>' +
        '<p class="setup-note">Waiting for the host…</p>');
      armNetWatchdog('The host never picked up your reply code.');
      return r.transport.then(function (transport) {
        beginGuestSession(transport, guestName);
      });
    }).catch(function (err) {
      View.showScreen(
        '<h1>That code did not work</h1>' +
        '<p class="lede">' + esc(err.message || String(err)) + '</p>' +
        '<div class="screen-actions"><button class="btn-big" data-act="net-join">Try again</button>' +
        '<button class="btn-big" data-act="setup">Back</button></div>');
    });
  }

  function doAccept() {
    var box = $('net-answer');
    var code = box ? box.value : '';
    if (!code.trim() || !pendingHostPc) { View.reject(box); return; }
    SQ.Net.acceptAnswer(pendingHostPc, code).then(function () {
      View.showScreen('<h1>Connecting…</h1><p class="lede">Shaking hands with the other player…</p>');
      armNetWatchdog('The two browsers could not reach each other.');
      // Deal now so the position exists the moment the channel opens.
      newGame({});
    }).catch(function () {
      // A bad reply code: flash the field they pasted into and let them retry.
      View.reject($('net-answer'));
    });
  }

  /* Same-browser play over BroadcastChannel — no codes, for testing or for two
   * people at one machine with two windows open. */
  var LOCAL_ROOM = 'tabs';

  /* The two seams every online path goes through, whatever the transport. Exported
   * so the test harness can drive either half over an in-page pipe. */
  function beginHostSession(transport) {
    settings.playerCount = 2;
    settings.teamCount = 2;
    settings.kinds = ['human', 'remote'];
    settings.privacy = false;
    SQ.Net.startHost(transport, {
      seat: 0, guestSeat: 1, name: settings.names[0], handlers: netHandlersHost()
    });
    newGame({});
  }

  function beginGuestSession(transport, name) {
    netBoardBuilt = false;
    SQ.Net.startGuest(transport, {
      name: name || settings.names[1] || 'Player 2',
      handlers: netHandlersGuest()
    });
  }

  function startLocalHost() {
    var t = SQ.Net.createLocalTransport(LOCAL_ROOM, 'host');
    if (!t) { noLocalTransport(); return; }
    beginHostSession(t);
    View.showScreen(
      '<h1>Waiting for the other tab</h1>' +
      '<p class="lede">Open Sequentia in another tab or window, choose <strong>Play online</strong>, ' +
      'then <strong>Join from this tab</strong>.</p>' +
      '<div class="screen-actions"><button class="btn-big" data-act="net-cancel">Cancel</button></div>');
    t.announce();
  }

  /* Two-tab play needs BroadcastChannel. If it is missing the feature simply
   * cannot work, which warrants a screen rather than a flash. */
  function noLocalTransport() {
    View.showScreen(
      '<h1>Not available here</h1>' +
      '<p class="lede">This browser does not support talking between tabs. Use an ' +
      'invite code instead, or play locally.</p>' +
      '<div class="screen-actions">' +
      '<button class="btn-big primary" data-act="net-online">Back</button>' +
      '<button class="btn-big" data-act="net-cancel">Play locally</button>' +
      '</div>');
  }

  function startLocalGuest() {
    var t = SQ.Net.createLocalTransport(LOCAL_ROOM, 'guest');
    if (!t) { noLocalTransport(); return; }
    beginGuestSession(t);
    View.showScreen('<h1>Connecting…</h1><p class="lede">Looking for a hosting tab…</p>');
    t.announce();
  }

  function goOffline() {
    clearNetWatchdog();
    clearNetWait();
    if (SQ.Net) SQ.Net.leave();
    pendingHostPc = null;
    netBoardBuilt = false;
    settings.kinds = ['human', 'human'];
    View.hideScreen();
    newGame({});
  }

  function onDisconnected(why) {
    // The screen below already says it; no need to say it twice.
    if (state) state.phase = 'gameover';
    View.showScreen(
      '<h1>Disconnected</h1>' +
      '<p class="lede">' + esc(why || 'The connection to the other player dropped.') + '</p>' +
      '<div class="screen-actions">' +
      '<button class="btn-big primary" data-act="offline">Back to a local game</button>' +
      '</div>');
  }

  /* ------------------------------------------------------------------- AI */

  var aiTimer = 0;
  var AI_THINK_MIN = 480, AI_THINK_MAX = 950;   // ms — long enough to read, short enough not to drag

  /* Only the host runs bots: it owns the state, so it is the only side that could
   * legitimately move for one. A guest just watches the result arrive. */
  function isAITurn() {
    return !!(state && !state.remote && state.phase === 'play' && SQ.AI &&
              !isGuest() && state.players[state.turn].kind === 'ai');
  }

  /* Start a bot's turn if it is one, but never from behind a modal — the welcome
   * and setup screens must not have a game playing itself underneath them.
   * Called after a new game is dealt and whenever a screen is dismissed. */
  function maybeStartAI() {
    if (isAITurn() && !View.screenOpen() && !aiTimer) {
      View.toggleHandHidden(true);
      render();
      runAITurn();
    }
  }

  function cancelAI() {
    if (aiTimer) { clearTimeout(aiTimer); aiTimer = 0; }
  }

  function runAITurn() {
    if (!isAITurn()) return;
    var seat = state.turn;
    busy = true;                       // no human input while it is thinking

    // Swapping a dead card is free, and the rules allow exactly one per turn, so
    // take it before choosing a move — a fresh card may open up something better.
    var dead = SQ.AI.deadSwap(state, seat);
    if (dead && Engine.discardDead(state, dead).ok) {
      View.renderLog(state); View.renderDeck(state); View.renderPlayers(state);
    }

    var move = SQ.AI.chooseMove(state, seat, settings.aiLevel);
    var think = AI_THINK_MIN + Math.random() * (AI_THINK_MAX - AI_THINK_MIN);

    cancelAI();
    aiTimer = setTimeout(function () {
      aiTimer = 0;
      // A new game (or a win) may have landed while we were thinking.
      if (!state || state.phase !== 'play' || state.turn !== seat) return;
      busy = false;
      if (!move) { onPassClick(); return; }
      // Flash the chosen square first, so a human can follow what happened.
      View.setSnap(move.cell);
      setTimeout(function () { View.setSnap(null); }, 380);
      handleDrop(move.card, move.cell);
    }, think);
  }

  /* ----------------------------------------------------------- dead cards */

  function onDeadClick() {
    if (busy || !state || state.phase !== 'play') return;
    // Online we only hold our own cards, so asking about anyone else's would be
    // asking about a hand of nulls.
    // Nothing to swap, not our turn, or already swapped this turn: the button
    // itself flashes, since the button is what was pressed.
    var dead = isMyTurn() ? Engine.deadCardsInHand(state, state.turn) : [];
    if (!isMyTurn() || !dead.length || state.deadUsedThisTurn) {
      View.reject($('btn-dead'));
      return;
    }
    if (dead.length === 1) { trySwapDead(dead[0]); return; }
    // More than one dead card, so which one is a real choice. Rather than a popup
    // saying "pick one", the hand itself goes into picking mode: the dead cards
    // stay lit and everything else dims out.
    pendingDead = true;
    setPickingDead(true);
  }

  function setPickingDead(on) {
    $('hand').classList.toggle('picking-dead', !!on);
  }

  function trySwapDead(cardId) {
    pendingDead = false;
    setPickingDead(false);
    if (isGuest()) { requestMove({ t: 'dead', card: cardId }); return; }
    var res = Engine.discardDead(state, cardId);
    if (!res.ok) { View.reject($('btn-dead')); return; }
    netSync();
    // The swap is visible in the hand and recorded in the move log; no popup.
    View.renderLog(state);
    View.renderDeck(state);
    View.renderHand(state);
    View.renderPlayers(state);
  }

  function onPassClick() {
    if (busy) return;
    if (isGuest()) { requestMove({ t: 'pass' }); return; }
    var res = Engine.pass(state);
    // Passing while you still have a legal move is refused: flash the button.
    if (!res.ok) { View.reject($('btn-pass')); return; }
    View.renderLog(state);
    beginTurn();
  }

  /* -------------------------------------------------------------- screens */

  function welcome() {
    View.showScreen(
      '<h1>Sequentia</h1>' +
      '<p class="lede">The classic board game of five in a row — rebuilt for two to twelve ' +
      'players at one screen, solo against the computer, or any mix of the two, with all ' +
      'the tedious bits automated.</p>' +
      '<h2>How a turn works</h2>' +
      '<ul>' +
      '<li><strong>Drag a card</strong> from your hand onto a matching space. Every card is on the board twice.</li>' +
      '<li>Five chips in a row — across, down or diagonally — is a <strong>sequence</strong>. The four gold corners are free for both players.</li>' +
      '<li><strong>Two sequences wins the game.</strong></li>' +
      '</ul>' +
      '<h2>The quality-of-life bits</h2>' +
      '<ul>' +
      '<li>Type in the <strong>find bar</strong> (or press <kbd>/</kbd>) — “6s”, “queen of hearts”, “aces”, “hand” — and everything else on the board dims.</li>' +
      '<li><strong>Hover a card</strong> in your hand to ring the spaces it can go.</li>' +
      '<li><strong>Scroll to zoom</strong>, and <strong>hold right-click to drag the board</strong> around at any magnification.</li>' +
      '<li><strong>Right-click a card in your hand</strong> and the camera flies to a space it can go — again to see the next one.</li>' +
      '<li>Dead cards are detected for you; badges show how many open spaces each card has.</li>' +
      '</ul>' +
      '<h2>Who you can play</h2>' +
      '<ul>' +
      '<li><strong>Two to twelve people</strong> at this screen, on their own or in teams.</li>' +
      '<li><strong>The computer</strong>, at three skill levels — any seat can be a bot.</li>' +
      '<li><strong>Someone else online</strong>, directly browser to browser, no account needed.</li>' +
      '</ul>' +
      '<div class="screen-actions">' +
      '<button class="btn-big primary" data-act="close">Play</button>' +
      '<button class="btn-big" data-act="setup">Game setup</button>' +
      '<button class="btn-big" data-act="rules">Full rules</button>' +
      '</div>');
    bindScreen();
  }

  function rulesScreen() {
    View.showScreen(
      '<h1>Rules</h1>' +
      '<h2>The board</h2>' +
      '<p>A 10&times;10 grid. Ninety-six spaces show a playing card — every card except the ' +
      'jacks appears exactly <strong>twice</strong>. The four corners are <strong>free spaces</strong> ' +
      'that count as a chip of <em>every</em> colour, so a sequence through a corner needs only four of your own chips.</p>' +
      '<h2>Your turn</h2>' +
      '<ol><li>Play a card from your hand onto a matching, uncovered space.</li>' +
      '<li>Your chip lands there.</li>' +
      '<li>You draw a replacement card automatically.</li></ol>' +
      '<h2>Jacks</h2>' +
      '<dl class="kv">' +
      '<dt>Two-eyed</dt><dd>&clubs;J and &diams;J are <strong>wild</strong> — place a chip on any open space.</dd>' +
      '<dt>One-eyed</dt><dd>&spades;J and &hearts;J <strong>remove</strong> one opponent chip. That is your whole turn. ' +
      'Chips locked into a completed sequence cannot be removed.</dd></dl>' +
      '<h2>Sequences</h2>' +
      '<ul><li>Five in an unbroken line: horizontal, vertical or either diagonal.</li>' +
      '<li>Your second sequence may reuse <strong>at most one</strong> space from your first.</li>' +
      '<li>Two sequences wins.</li></ul>' +
      '<h2>Dead cards</h2>' +
      '<p>If both board spaces for a card in your hand are covered, the card is dead. Press ' +
      '<kbd>D</kbd> to discard it and draw a replacement — once per turn, and it does not use up your play. ' +
      'Dead cards are greyed out in your hand automatically.</p>' +
      '<h2>Mouse</h2>' +
      '<dl class="kv">' +
      '<dt>Drag a card</dt><dd>from your hand onto a space. The card only commits to a space once you ' +
      'slow down, so flying across the board never snaps it somewhere you did not mean.</dd>' +
      '<dt>Scroll</dt><dd>zoom in and out, anchored on the cursor</dd>' +
      '<dt>Hold right-click</dt><dd><strong>drag the board around</strong> — works anywhere, including over the cards</dd>' +
      '<dt>Right-click a card<br>in your hand</dt><dd><strong>flies the camera to a space it can be played on</strong>, ' +
      'and arms the card so a click on the space plays it. Right-click again to cycle through the other options.</dd>' +
      '<dt>Double-click</dt><dd>zoom to a space, or back out again</dd>' +
      '</dl>' +
      '<h2>Keyboard</h2>' +
      '<dl class="kv">' +
      '<dt><kbd>/</kbd></dt><dd>jump to the find bar</dd>' +
      '<dt><kbd>1</kbd>–<kbd>9</kbd></dt><dd>select the nth card in your hand, then click a space</dd>' +
      '<dt><kbd>Z</kbd></dt><dd>inspect the card under the cursor in full detail</dd>' +
      '<dt><kbd>L</kbd></dt><dd>light up every space you can play right now</dd>' +
      '<dt><kbd>D</kbd></dt><dd>swap a dead card</dd>' +
      '<dt><kbd>H</kbd></dt><dd>hide/show your hand when passing the device</dd>' +
      '<dt><kbd>+</kbd> <kbd>&minus;</kbd> <kbd>0</kbd> <kbd>F</kbd></dt><dd>zoom in, out, reset, fit</dd>' +
      '<dt><kbd>Esc</kbd></dt><dd>close whatever is open</dd></dl>' +
      '<div class="screen-actions">' +
      '<button class="btn-big primary" data-act="close">Back to the game</button>' +
      '<button class="btn-big" data-act="setup">Game setup</button>' +
      '</div>');
    bindScreen();
  }

  /* Pull whatever is currently typed into the setup screen back into `settings`,
   * so re-rendering it (which any option button does) never loses a name. */
  function readSetupInputs() {
    var ins = document.querySelectorAll('#screen-panel .setup-input[data-seat]');
    for (var i = 0; i < ins.length; i++) {
      var seat = Number(ins[i].dataset.seat);
      settings.names[seat] = ins[i].value.trim() || defaultName(seat);
    }
    var pv = $('nprivacy');
    if (pv) settings.privacy = pv.checked;
  }

  function defaultName(seat) { return 'Player ' + (seat + 1); }

  function isSolo() { return !state || state.teams.length === state.players.length; }

  /* The seat whose cards this screen is showing: our own when online, otherwise
   * whoever is to move. */
  function viewerSeat() {
    return online() && SQ.Net.mySeat() != null ? SQ.Net.mySeat() : state.turn;
  }

  /* "Ada to play" in a free-for-all; "Ada — Team 1 to play" when the team matters
   * more than the seat, which it does as soon as there are teammates. */
  function turnLabel() {
    var p = state.players[state.turn];
    return isSolo() ? p.name + ' to play'
                    : p.name + ' — Team ' + (p.team + 1) + ' to play';
  }

  /* Keep names/kinds arrays at least as long as the seat count, without throwing
   * away anything the player already typed for a larger table. */
  function ensureSeats(n) {
    for (var i = 0; i < n; i++) {
      if (!settings.names[i]) settings.names[i] = defaultName(i);
      if (!settings.kinds[i]) settings.kinds[i] = 'human';
    }
  }

  function newGameScreen() {
    var pc = settings.playerCount;
    var teamOpts = Engine.validTeamCounts(pc);
    if (teamOpts.indexOf(settings.teamCount) < 0) settings.teamCount = teamOpts[0];
    var tc = settings.teamCount;
    var perTeam = Engine.teamSizeFor(pc, tc);
    var solo = perTeam === 1;
    ensureSeats(pc);

    var h = '<h1>New game</h1>' +
      '<p class="lede">Two to twelve players around one screen, in teams or as a free-for-all.</p>' +
      '<h2>How many players</h2><div class="pill-row">' +
      Engine.PLAYER_COUNTS.map(function (n) {
        return '<button class="pillbtn' + (n === pc ? ' on' : '') +
               '" data-act="count" data-n="' + n + '">' + n + '</button>';
      }).join('') + '</div>' +

      '<h2>Teams</h2><div class="pill-row">' +
      teamOpts.map(function (t) {
        var per = pc / t;
        return '<button class="pillbtn wide' + (t === tc ? ' on' : '') +
               '" data-act="teams" data-t="' + t + '">' +
               (per === 1 ? 'Every player for themselves' : t + ' teams of ' + per) +
               '</button>';
      }).join('') + '</div>' +

      '<p class="setup-note">' + Engine.handSizeFor(pc) + ' cards each &middot; first to <strong>' +
      Engine.sequencesToWin(tc) + ' sequence' + (Engine.sequencesToWin(tc) === 1 ? '' : 's') +
      '</strong> wins' +
      (solo ? '' : ' &middot; teammates share a colour and sit alternately, so turns rotate between teams') +
      '</p>' +

      '<h2>Names</h2><div class="setup-names' + (pc > 4 ? ' tight' : '') + '">';

    for (var i = 0; i < pc; i++) {
      var color = Engine.TEAM_COLORS[(i % tc) % Engine.TEAM_COLORS.length];
      var isAI = settings.kinds[i] === 'ai';
      h += '<div class="setup-row">' +
        '<span class="setup-disc" data-color="' + color + '"></span>' +
        (solo ? '' : '<span class="setup-team">T' + ((i % tc) + 1) + '</span>') +
        '<input class="setup-input" data-seat="' + i + '" maxlength="18" value="' +
        esc(settings.names[i]) + '">' +
        (SQ.AI
          ? '<button class="seatkind' + (isAI ? ' ai' : '') + '" data-act="kind" data-seat="' + i +
            '" title="Switch between a person and the computer">' +
            (isAI ? 'Computer' : 'Human') + '</button>'
          : '') +
        '</div>';
    }
    h += '</div>';

    var aiSeats = 0;
    for (var k = 0; k < pc; k++) if (settings.kinds[k] === 'ai') aiSeats++;
    if (aiSeats && SQ.AI) {
      h += '<h2>Computer skill</h2><div class="pill-row">' +
        SQ.AI.LEVEL_LIST.map(function (key) {
          var L = SQ.AI.LEVELS[key];
          return '<button class="pillbtn wide' + (settings.aiLevel === key ? ' on' : '') +
                 '" data-act="ailevel" data-level="' + key + '">' + L.name + '</button>';
        }).join('') + '</div>' +
        '<p class="setup-note">' + esc(SQ.AI.LEVELS[settings.aiLevel].blurb) + '</p>';
    }

    h += '<h2>Options</h2>' +
      '<label class="setup-check"><input type="checkbox" id="nprivacy"' +
      (settings.privacy ? ' checked' : '') + '>' +
      '<span>Hide each hand between turns (pass-the-device play)</span></label>' +
      '<div class="screen-actions">' +
      '<button class="btn-big primary" data-act="start">Deal</button>' +
      (SQ.Net && SQ.Net.supported()
        ? '<button class="btn-big" data-act="net-online">Play online…</button>' : '') +
      '<button class="btn-big" data-act="close">Cancel</button>' +
      '</div>';

    View.showScreen(h);
    bindScreen();
  }

  function passScreen() {
    var p = state.players[state.turn];
    View.showScreen(
      '<h1>' + esc(p.name) + '</h1>' +
      '<p class="lede">Pass the device over, then reveal your hand.</p>' +
      '<div class="screen-actions"><button class="btn-big primary" data-act="reveal">Reveal my hand</button></div>');
    bindScreen();
  }

  function rounds() {
    var n = Math.max(1, Math.ceil(state.turnNumber / state.players.length));
    return n + (n === 1 ? ' round' : ' rounds');
  }

  function winScreen(team) {
    var name = team == null ? 'Nobody' : Engine.teamName(state, team);
    var color = team == null ? 'crimson' : state.players.filter(function (p) { return p.team === team; })[0].color;
    View.sparks();
    View.showScreen(
      '<div class="win-banner"><span class="win-disc" data-color="' + color + '"></span>' +
      '<h1 style="margin:0">' + esc(name) + ' wins</h1></div>' +
      '<p class="lede">' + (team == null
        ? 'No legal moves remain — the game is a draw.'
        : esc(name) + ' completed ' + state.seqToWin + ' sequences in ' +
          rounds() + '.') + '</p>' +
      '<dl class="kv">' +
      '<dt>Sequences</dt><dd>' + state.players.map(function (p) {
        return esc(p.name) + ': ' + state.seqCount[p.team];
      }).join(' &middot; ') + '</dd>' +
      '<dt>Cards played</dt><dd>' + state.discard.length + '</dd>' +
      // A guest is looking at a mirror of the host's game and has no seed to show.
      (state.seed == null ? '' : '<dt>Seed</dt><dd>' + state.seed + '</dd>') +
      '</dl>' +
      '<div class="screen-actions">' +
      // Only the host can deal a rematch — a guest dealing one would just start a
      // private game against nobody.
      (isGuest()
        ? '<button class="btn-big" data-act="net-cancel">Leave the game</button>'
        : '<button class="btn-big primary" data-act="start">Rematch</button>') +
      '<button class="btn-big" data-act="close">Look at the board</button>' +
      '</div>');
    bindScreen();
  }

  /* The panel element persists across screens while its innerHTML is swapped, so
   * the click handler is delegated and installed exactly once — binding it per
   * render would stack duplicate listeners and fire actions twice. */
  function bindScreen() { /* screens are handled by the delegated listener below */ }

  function installScreenHandler() {
    $('screen-panel').addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      var act = b.dataset.act;
      if (act === 'close') { View.hideScreen(); maybeStartAI(); }
      else if (act === 'rules') { rulesScreen(); }
      else if (act === 'setup') { newGameScreen(); }
      else if (act === 'reveal') {
        View.hideScreen();
        View.toggleHandHidden(false);
        render();
        View.banner(turnLabel(), 800);
      }
      else if (act === 'count') {
        readSetupInputs();
        settings.playerCount = Number(b.dataset.n);
        // Three or more sharing one screen means hands must be hidden between
        // turns, otherwise everyone reads everyone's cards.
        if (settings.playerCount > 2) settings.privacy = true;
        newGameScreen();
      }
      else if (act === 'teams') {
        readSetupInputs();
        settings.teamCount = Number(b.dataset.t);
        newGameScreen();
      }
      else if (act === 'kind') {
        readSetupInputs();
        var seat = Number(b.dataset.seat);
        var becomingAI = settings.kinds[seat] !== 'ai';
        settings.kinds[seat] = becomingAI ? 'ai' : 'human';
        // Rename between the two defaults so the seat reads honestly, but never
        // overwrite a name the player chose themselves.
        if (becomingAI && settings.names[seat] === defaultName(seat)) {
          settings.names[seat] = 'Computer ' + (seat + 1);
        } else if (!becomingAI && settings.names[seat] === 'Computer ' + (seat + 1)) {
          settings.names[seat] = defaultName(seat);
        }
        newGameScreen();
      }
      else if (act === 'ailevel') {
        readSetupInputs();
        settings.aiLevel = b.dataset.level;
        newGameScreen();
      }
      else if (act === 'net-online') { onlineScreen(); }
      else if (act === 'net-host') { hostOnlineScreen(); }
      else if (act === 'net-join') { joinOnlineScreen(); }
      else if (act === 'net-answer') { doJoin(); }
      else if (act === 'net-accept') { doAccept(); }
      else if (act === 'net-local-host') { startLocalHost(); }
      else if (act === 'net-local-join') { startLocalGuest(); }
      else if (act === 'net-cancel' || act === 'offline') { goOffline(); }
      else if (act === 'net-copy') {
        var src = $(b.dataset.target);
        if (src) {
          // Feedback goes on the button itself. The text is left selected either
          // way, so a failed copy can still be taken manually.
          src.select();
          var ok = false;
          try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
          if (!ok && navigator.clipboard) {
            navigator.clipboard.writeText(src.value)
              .then(function () { flashButton(b, 'Copied'); },
                    function () { flashButton(b, 'Press Ctrl+C'); });
            return;
          }
          flashButton(b, ok ? 'Copied' : 'Press Ctrl+C');
        }
      }
      else if (act === 'start') {
        readSetupInputs();
        View.hideScreen();
        newGame({});
        View.banner(turnLabel(), 900);
      }
    });
  }

  /* Briefly swap a button's label to confirm what it did, instead of firing a
   * popup at the other end of the screen. */
  function flashButton(btn, label) {
    if (btn.dataset.flashing) return;
    var was = btn.textContent;
    btn.dataset.flashing = '1';
    btn.textContent = label;
    btn.classList.add('flashed');
    setTimeout(function () {
      btn.textContent = was;
      btn.classList.remove('flashed');
      delete btn.dataset.flashing;
    }, 1400);
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* -------------------------------------------------------------- exports */

  SQ.App = {
    boot: boot,
    state: function () { return state; },
    render: render,
    newGame: newGame,
    settings: settings,
    // Nudges a computer seat into taking its turn. Called internally after a deal
    // and whenever a screen closes; exported so tests can drive a bot directly.
    resumeAI: maybeStartAI,
    // Online session seams. The lobby uses these with a WebRTC or BroadcastChannel
    // transport; the test harness uses them with an in-page pipe.
    beginHostSession: beginHostSession,
    beginGuestSession: beginGuestSession,
    goOffline: goOffline,
    // handy in the console while developing
    _debug: function () { return { state: state, busy: busy }; }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
