/* Sequentia — online play.
 *
 * No server, no build step. Two browsers talk directly over a WebRTC data
 * channel, and the connection is set up by exchanging one block of text each —
 * the host makes an invite code, the guest answers with a reply code. That
 * exchange is the only thing you need another app for (paste it into a chat);
 * after it, traffic is peer to peer.
 *
 * Architecture
 * ------------
 * The **host is authoritative**. It owns the one true SQ.Engine state, and it is
 * the only side that ever mutates it. A guest sends *intents* ("I want to play
 * 5H on E5") and waits; the host validates through the ordinary rules engine and
 * broadcasts the resulting position. A guest therefore cannot cheat by patching
 * its own copy, and the two sides cannot drift out of sync, because there is only
 * one copy that counts.
 *
 * Hidden hands
 * ------------
 * Broadcasting the raw state would hand every player everyone else's cards, so
 * each peer gets a *redacted view*: its own hand in full, everybody else's as a
 * count. See encodeView/decodeView. This is the security boundary — the host must
 * never send a hand that is not the recipient's.
 *
 * Transports
 * ----------
 * A transport is just `{ send(text), onMessage, onOpen, onClose, close() }`, so
 * the protocol can run over anything:
 *   webrtc  — two machines over the internet (manual code exchange)
 *   local   — two tabs in one browser, via BroadcastChannel
 *   pipe    — two endpoints in one page, used by the test suite
 *
 * Depends on: SQ.Engine, SQ.Board, SQ.Cards.
 */
(function () {
  'use strict';
  var SQ = (window.SQ = window.SQ || {});

  var PROTOCOL = 1;

  /* Public STUN only. It is what lets two home connections find each other
   * through their routers; it sees an IP address and nothing else. There is no
   * TURN relay, so a small number of strict/symmetric NATs will fail to connect —
   * that case is reported rather than left hanging. Swap this list to use your own. */
  var ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ];

  var ICE_TIMEOUT = 6000;      // ms to wait for candidate gathering before shipping the code

  /* ------------------------------------------------------------ code coding */

  function bytesToB64url(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function b64urlToBytes(str) {
    var s = String(str).trim().replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var raw = atob(s);
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function hasCompression() {
    return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
  }

  /* Session descriptions are about a kilobyte of text, which is a lot to paste, so
   * they are deflated first. The "SQ1"/"SQ0" prefix records whether the payload
   * was compressed, so a browser without CompressionStream still interoperates. */
  function packCode(obj) {
    var json = JSON.stringify(obj);
    var bytes = new TextEncoder().encode(json);
    if (!hasCompression()) return Promise.resolve('SQ0' + bytesToB64url(bytes));
    return new Response(
      new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))
    ).arrayBuffer().then(function (buf) {
      return 'SQ1' + bytesToB64url(new Uint8Array(buf));
    });
  }

  function unpackCode(code) {
    var s = String(code || '').trim().replace(/\s+/g, '');
    var tag = s.slice(0, 3);
    var body = s.slice(3);
    if (tag !== 'SQ1' && tag !== 'SQ0') {
      return Promise.reject(new Error('That does not look like a Sequentia code.'));
    }
    var bytes;
    try { bytes = b64urlToBytes(body); }
    catch (e) { return Promise.reject(new Error('That code is damaged — copy the whole thing.')); }

    if (tag === 'SQ0') {
      try { return Promise.resolve(JSON.parse(new TextDecoder().decode(bytes))); }
      catch (e) { return Promise.reject(new Error('That code is damaged.')); }
    }
    if (!hasCompression()) {
      return Promise.reject(new Error('This browser cannot read compressed codes.'));
    }
    return new Response(
      new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
    ).arrayBuffer().then(function (buf) {
      return JSON.parse(new TextDecoder().decode(new Uint8Array(buf)));
    }).catch(function () {
      throw new Error('That code is damaged — copy the whole thing.');
    });
  }

  /* --------------------------------------------------------- view redaction */

  /* The host's state, reduced to what `seat` is allowed to know. Board *layout* is
   * static and already on every client, so only the chips travel. */
  function encodeView(state, seat) {
    return {
      p: PROTOCOL,
      seat: seat,
      players: state.players.map(function (p) {
        return { index: p.index, name: p.name, color: p.color, team: p.team, kind: p.kind };
      }),
      teams: state.teams.slice(),
      seqToWin: state.seqToWin,
      seqCount: JSON.parse(JSON.stringify(state.seqCount)),
      handSize: state.handSize,
      chips: state.board.map(function (c) { return c.chip; }),
      cellSeqs: state.board.map(function (c) { return c.seqs.slice(); }),
      // The one privacy-critical line: real cards for the recipient, a count for
      // everybody else.
      hands: state.hands.map(function (h, i) { return i === seat ? h.slice() : h.length; }),
      turn: state.turn,
      phase: state.phase,
      winner: state.winner,
      turnNumber: state.turnNumber,
      deadUsedThisTurn: state.deadUsedThisTurn,
      deck: state.deck.length,
      discard: state.discard.length,
      sequences: state.sequences.map(function (s) {
        return { id: s.id, team: s.team, by: s.by, cells: s.cells.slice(), dir: s.dir };
      }),
      lastMove: state.lastMove,
      log: state.log.map(function (e) { return { kind: e.kind, text: e.text, turn: e.turn }; })
    };
  }

  /* Rebuild something the view, find and drag modules can read as if it were a
   * real engine state. Other players' hands become arrays of nulls: the length is
   * all the scoreboard needs, and a null will fail loudly if anything ever tries
   * to render a card it should not have. */
  function decodeView(view) {
    var layout = SQ.Board.LAYOUT_FLAT;
    var board = layout.map(function (card, i) {
      return {
        i: i, r: Math.floor(i / 10), c: i % 10,
        card: card, free: card === 'FREE',
        chip: view.chips[i],
        seqs: view.cellSeqs[i] || []
      };
    });
    return {
      remote: true,                       // marks this as a mirror, not a live engine
      mySeat: view.seat,
      players: view.players,
      teams: view.teams,
      seqToWin: view.seqToWin,
      seqCount: view.seqCount,
      handSize: view.handSize,
      board: board,
      hands: view.hands.map(function (h) {
        return typeof h === 'number' ? new Array(h).fill(null) : h;
      }),
      turn: view.turn,
      phase: view.phase,
      winner: view.winner,
      turnNumber: view.turnNumber,
      deadUsedThisTurn: view.deadUsedThisTurn,
      deck: new Array(view.deck).fill(null),
      discard: new Array(view.discard).fill(null),
      sequences: view.sequences,
      lastMove: view.lastMove,
      log: view.log
    };
  }

  /* --------------------------------------------------------------- session */

  var session = null;      // { role, transport, seat, name, handlers, peers }

  function isOnline() { return !!session; }
  function role() { return session ? session.role : null; }
  function mySeat() { return session ? session.seat : null; }

  function emit(name, arg) {
    if (!session || !session.handlers[name]) return;
    try { session.handlers[name](arg); }
    catch (err) { console.error('[Sequentia net] handler ' + name + ' threw:', err); }
  }

  function sendRaw(transport, obj) {
    try { transport.send(JSON.stringify(obj)); }
    catch (err) { console.error('[Sequentia net] send failed:', err); }
  }

  /* ---- host ---------------------------------------------------------- */

  /* handlers: { onIntent(seat, msg), onPeerOpen(seat), onPeerClose(seat),
   *             onStatus(text), onGuestName(seat, name) } */
  function startHost(transport, opts) {
    opts = opts || {};
    session = {
      role: 'host',
      transport: transport,
      seat: opts.seat == null ? 0 : opts.seat,
      guestSeat: opts.guestSeat == null ? 1 : opts.guestSeat,
      name: opts.name || 'Host',
      handlers: opts.handlers || {},
      open: false
    };

    transport.onOpen = function () {
      session.open = true;
      emit('onStatus', 'Connected.');
      emit('onPeerOpen', session.guestSeat);
    };
    transport.onClose = function () {
      if (!session) return;
      session.open = false;
      emit('onPeerClose', session.guestSeat);
    };
    transport.onMessage = function (text) {
      var msg;
      try { msg = JSON.parse(text); } catch (e) { return; }
      if (!msg || typeof msg.t !== 'string') return;
      if (msg.t === 'hello') {
        emit('onGuestName', { seat: session.guestSeat, name: String(msg.name || 'Guest').slice(0, 18) });
        return;
      }
      // Everything else is a move request. The host decides.
      emit('onIntent', { seat: session.guestSeat, msg: msg });
    };
    return session;
  }

  /* Push the current position to the guest, redacted for them. */
  function broadcast(state) {
    if (!session || session.role !== 'host' || !session.open) return;
    sendRaw(session.transport, { t: 'state', view: encodeView(state, session.guestSeat) });
  }

  function tellGuest(msg) {
    if (!session || session.role !== 'host' || !session.open) return;
    sendRaw(session.transport, msg);
  }

  /* ---- guest --------------------------------------------------------- */

  /* handlers: { onState(view), onStatus(text), onClosed(), onRejected(why) } */
  function startGuest(transport, opts) {
    opts = opts || {};
    session = {
      role: 'guest',
      transport: transport,
      seat: null,                       // learned from the first state message
      name: opts.name || 'Guest',
      handlers: opts.handlers || {},
      open: false
    };

    transport.onOpen = function () {
      session.open = true;
      emit('onStatus', 'Connected.');
      sendRaw(transport, { t: 'hello', name: session.name, p: PROTOCOL });
    };
    transport.onClose = function () {
      if (!session) return;
      session.open = false;
      emit('onClosed');
    };
    transport.onMessage = function (text) {
      var msg;
      try { msg = JSON.parse(text); } catch (e) { return; }
      if (!msg || typeof msg.t !== 'string') return;
      if (msg.t === 'state') {
        if (msg.view && msg.view.p !== PROTOCOL) {
          emit('onRejected', 'The other player is running a different version of Sequentia.');
          return;
        }
        session.seat = msg.view.seat;
        emit('onState', msg.view);
        return;
      }
      if (msg.t === 'refused') { emit('onRefused', msg.why || 'That move was refused.'); return; }
      if (msg.t === 'bye') { emit('onRejected', msg.why || 'The host ended the game.'); return; }
    };
    return session;
  }

  /* A guest asks; it never assumes. */
  function sendIntent(msg) {
    if (!session || session.role !== 'guest' || !session.open) return false;
    sendRaw(session.transport, msg);
    return true;
  }

  function leave() {
    if (!session) return;
    try { session.transport.close(); } catch (e) { /* already gone */ }
    session = null;
  }

  /* ------------------------------------------------------- transport: pipe */

  /* Two endpoints wired straight to each other in one page. Exists so the whole
   * protocol — host authority, redaction, refusals — can be tested without any
   * network or second tab. */
  function createPipe() {
    function endpoint(name) {
      return {
        name: name, other: null,
        onMessage: null, onOpen: null, onClose: null,
        send: function (text) {
          var o = this.other;
          if (!o || o.closed) return;
          // Asynchronous, like a real link, so ordering bugs surface here too.
          setTimeout(function () { if (o.onMessage) o.onMessage(text); }, 0);
        },
        close: function () {
          if (this.closed) return;
          this.closed = true;
          var o = this.other;
          if (o && !o.closed && o.onClose) setTimeout(function () { o.onClose(); }, 0);
        }
      };
    }
    var a = endpoint('a'), b = endpoint('b');
    a.other = b; b.other = a;
    return {
      a: a, b: b,
      open: function () {
        setTimeout(function () {
          if (a.onOpen) a.onOpen();
          if (b.onOpen) b.onOpen();
        }, 0);
      }
    };
  }

  /* ------------------------------------------------ transport: same browser */

  /* Two tabs of the same browser. Handy for playing with someone sitting next to
   * you on one machine, and for trying online play without a second device. */
  function createLocalTransport(room, side) {
    if (typeof BroadcastChannel !== 'function') return null;
    var ch = new BroadcastChannel('sequentia-' + room);
    var t = {
      onMessage: null, onOpen: null, onClose: null,
      send: function (text) { ch.postMessage({ from: side, text: text }); },
      close: function () {
        try { ch.postMessage({ from: side, bye: true }); } catch (e) { /* closing anyway */ }
        try { ch.close(); } catch (e) { /* already closed */ }
      }
    };
    ch.onmessage = function (e) {
      var d = e.data;
      if (!d || d.from === side) return;         // ignore our own echo
      if (d.hello) {
        // A peer announced itself; reply so both sides open at once.
        if (side === 'host') ch.postMessage({ from: side, ack: true });
        if (t.onOpen) t.onOpen();
        return;
      }
      if (d.ack) { if (t.onOpen) t.onOpen(); return; }
      if (d.bye) { if (t.onClose) t.onClose(); return; }
      if (d.text != null && t.onMessage) t.onMessage(d.text);
    };
    t.announce = function () { ch.postMessage({ from: side, hello: true }); };
    return t;
  }

  /* ----------------------------------------------------- transport: WebRTC */

  function wrapChannel(pc, dc) {
    var t = {
      onMessage: null, onOpen: null, onClose: null,
      pc: pc, dc: dc,
      send: function (text) { if (dc.readyState === 'open') dc.send(text); },
      close: function () {
        try { dc.close(); } catch (e) { /* already closed */ }
        try { pc.close(); } catch (e) { /* already closed */ }
      }
    };
    dc.onopen = function () { if (t.onOpen) t.onOpen(); };
    dc.onclose = function () { if (t.onClose) t.onClose(); };
    dc.onmessage = function (e) { if (t.onMessage) t.onMessage(e.data); };
    pc.oniceconnectionstatechange = function () {
      if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
        if (t.onClose) t.onClose();
      }
    };
    return t;
  }

  /* Wait for ICE gathering to finish so the code we hand over contains every
   * candidate — there is no signalling channel to trickle later ones down. */
  function gathered(pc) {
    return new Promise(function (resolve) {
      if (pc.iceGatheringState === 'complete') return resolve();
      var done = false;
      function finish() { if (!done) { done = true; resolve(); } }
      pc.addEventListener('icegatheringstatechange', function () {
        if (pc.iceGatheringState === 'complete') finish();
      });
      // Some networks never report completion; ship what we have.
      setTimeout(finish, ICE_TIMEOUT);
    });
  }

  function newPeer() {
    return new RTCPeerConnection({ iceServers: ICE_SERVERS });
  }

  /* Host side: build the invite code. Resolves { code, transport }. */
  function createOffer(meta) {
    if (typeof RTCPeerConnection !== 'function') {
      return Promise.reject(new Error('This browser has no WebRTC support.'));
    }
    var pc = newPeer();
    var dc = pc.createDataChannel('sequentia', { ordered: true });
    var transport = wrapChannel(pc, dc);
    return pc.createOffer()
      .then(function (o) { return pc.setLocalDescription(o); })
      .then(function () { return gathered(pc); })
      .then(function () {
        return packCode({ k: 'offer', sdp: pc.localDescription.sdp, meta: meta || {} });
      })
      .then(function (code) { return { code: code, transport: transport, pc: pc }; });
  }

  /* Guest side: consume the invite code, produce the reply code. */
  function answerOffer(code) {
    if (typeof RTCPeerConnection !== 'function') {
      return Promise.reject(new Error('This browser has no WebRTC support.'));
    }
    var pc = newPeer();
    var transport = null;
    var ready = new Promise(function (resolve) {
      pc.ondatachannel = function (e) { resolve(wrapChannel(pc, e.channel)); };
    });
    return unpackCode(code).then(function (payload) {
      if (payload.k !== 'offer') throw new Error('That is a reply code, not an invite code.');
      return pc.setRemoteDescription({ type: 'offer', sdp: payload.sdp })
        .then(function () { return pc.createAnswer(); })
        .then(function (a) { return pc.setLocalDescription(a); })
        .then(function () { return gathered(pc); })
        .then(function () { return packCode({ k: 'answer', sdp: pc.localDescription.sdp }); })
        .then(function (reply) {
          return { code: reply, meta: payload.meta || {}, transport: ready, pc: pc };
        });
    });
  }

  /* Host side: finish the handshake with the guest's reply code. */
  function acceptAnswer(pc, code) {
    return unpackCode(code).then(function (payload) {
      if (payload.k !== 'answer') throw new Error('That is an invite code, not a reply code.');
      return pc.setRemoteDescription({ type: 'answer', sdp: payload.sdp });
    });
  }

  SQ.Net = {
    PROTOCOL: PROTOCOL,
    ICE_SERVERS: ICE_SERVERS,
    supported: function () { return typeof RTCPeerConnection === 'function'; },

    // session
    startHost: startHost,
    startGuest: startGuest,
    broadcast: broadcast,
    tellGuest: tellGuest,
    sendIntent: sendIntent,
    leave: leave,
    isOnline: isOnline,
    role: role,
    mySeat: mySeat,

    // views
    encodeView: encodeView,
    decodeView: decodeView,

    // signalling
    createOffer: createOffer,
    answerOffer: answerOffer,
    acceptAnswer: acceptAnswer,
    packCode: packCode,
    unpackCode: unpackCode,

    // transports
    createPipe: createPipe,
    createLocalTransport: createLocalTransport
  };
})();
