/* Sequentia — intent-aware drag & drop.
 *
 * The point of this module: a naive implementation snaps to whatever tile the
 * pointer happens to be over, which means a card flying across a 10x10 grid
 * flickers through a dozen wrong targets and often lands on the wrong one. Here
 * we instead infer *intent* from motion:
 *
 *   - While the pointer is moving fast, no target is committed at all.
 *   - When it slows below a threshold (or dwells inside a small radius) for a
 *     short while, we lock onto the nearest legal space and the card visibly
 *     magnetises to it.
 *   - Once locked, hysteresis keeps it locked: a competing space must be clearly
 *     closer before we switch, so tiny jitters don't flip the target.
 *   - Releasing while locked plays there. Releasing unlocked still works if the
 *     pointer is close enough to a legal space (forgiving), otherwise the card
 *     springs back to the hand.
 */
(function () {
  'use strict';
  var SQ = (window.SQ = window.SQ || {});

  /* ---- tuning ---------------------------------------------------------- */
  var START_THRESHOLD = 5;      // px before a press becomes a drag (clicks still work)
  var SLOW_SPEED = 0.30;        // px/ms — below this counts as "settling"
  var FAST_SPEED = 0.85;        // px/ms — above this we drop any lock
  var DWELL_MS = 95;            // how long we must stay slow before locking
  var SWITCH_MARGIN = 18;       // px a rival target must beat the locked one by
  var SPEED_WINDOW = 70;        // ms of pointer history used to measure speed
  var CATCH_RADIUS = 0.95;      // × tile width — max distance to consider a target
  var RELEASE_RADIUS = 0.78;    // × tile width — forgiving drop without a lock
  var FOLLOW = 0.42;            // ghost position smoothing per 16.7ms
  var TILT_MAX = 15;            // degrees of tilt from horizontal velocity

  var Cards, Engine, View;
  var cfg = {};
  var layer = null;

  var drag = null;              // active drag session
  var rects = null;             // cached screen rects for every tile
  var rectsScale = 1;
  var hoverCard = null;         // card id currently previewed from the hand

  function init(opts) {
    Cards = SQ.Cards; Engine = SQ.Engine; View = SQ.View;
    cfg = opts || {};
    layer = document.getElementById('drag-layer');
    var hand = document.getElementById('hand');
    hand.addEventListener('pointerdown', onHandPointerDown);
    hand.addEventListener('pointerover', onHandOver);
    hand.addEventListener('pointerout', onHandOut);
    hand.addEventListener('click', onHandClick);

    var board = document.getElementById('board');
    board.addEventListener('click', onBoardClick);

    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('blur', onCancel);

    /* Kill the browser's own drag-and-drop. Without this, pressing on card art and
     * moving starts a native image drag: the browser takes over the pointer, our
     * pointermove events stop arriving, and the card freezes mid-flight. CSS
     * `user-drag` only covers WebKit, so the event is cancelled outright. */
    document.addEventListener('dragstart', function (e) {
      var t = e.target;
      // Leave real text fields alone; everything else has nothing worth dragging.
      if (t && t.closest && t.closest('input, textarea, [contenteditable="true"]')) return;
      e.preventDefault();
    });
    // A selection that survives from before the drag has the same effect, so clear
    // it as soon as a card is picked up.
    hand.addEventListener('pointerdown', function () {
      var sel = window.getSelection && window.getSelection();
      if (sel && !sel.isCollapsed) sel.removeAllRanges();
    });
  }

  function state() { return cfg.getState(); }
  function interactive() { return !cfg.canInteract || cfg.canInteract(); }

  /* ---- tile geometry cache -------------------------------------------- */

  function measure() {
    var els = View.tiles();
    rects = new Array(els.length);
    for (var i = 0; i < els.length; i++) {
      var r = els[i].getBoundingClientRect();
      rects[i] = { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height };
    }
    rectsScale = rects.length && els[0].offsetWidth ? rects[0].w / els[0].offsetWidth : 1;
  }
  function invalidate() { if (drag) measure(); else rects = null; }
  function tileW() { return rects && rects[0] ? rects[0].w : 82; }

  function nearestTarget(x, y, legal) {
    var best = -1, bestD = Infinity;
    for (var k = 0; k < legal.length; k++) {
      var i = legal[k], r = rects[i];
      if (!r) continue;
      var dx = x - r.cx, dy = y - r.cy;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < bestD) { bestD = d; best = i; }
    }
    return { cell: best, dist: bestD };
  }

  /* ---- hover preview -------------------------------------------------- */

  function onHandOver(e) {
    var card = e.target.closest && e.target.closest('.hand-card');
    if (!card || drag) return;
    var id = card.dataset.card;
    if (!id || id === hoverCard) return;
    previewCard(id);
  }

  function onHandOut(e) {
    if (drag) return;
    var card = e.target.closest && e.target.closest('.hand-card');
    if (!card) return;
    var to = e.relatedTarget;
    if (to && to.closest && to.closest('.hand-card') === card) return;
    if (to && to.closest && to.closest('.hand-card')) return;   // moving to a sibling
    clearPreview();
  }

  /* Highlight every space this card can be played on, plus (dashed) the spaces
   * it *would* match but that are already taken — that context is what makes
   * the physical game annoying and this version pleasant. */
  function previewCard(id) {
    if (!interactive()) return;
    hoverCard = id;
    var st = state();
    var legal = Engine.legalTargets(st, id);
    var blocked = [];
    if (!Cards.isJack(id)) {
      SQ.Board.cellsForCard(id).forEach(function (i) {
        if (legal.indexOf(i) < 0) blocked.push(i);
      });
    }
    View.setTargets(legal, Engine.moveKind(id), blocked);
    if (cfg.onPreview) cfg.onPreview(id, legal, blocked);
  }

  function clearPreview() {
    if (!hoverCard) return;
    hoverCard = null;
    View.clearTargets();
    if (cfg.onPreview) cfg.onPreview(null, [], []);
  }

  /* ---- click-to-select fallback (touch / accessibility) --------------- */

  var selected = null;

  function onHandClick(e) {
    if (e.target.closest('.zoombtn')) {
      var zid = e.target.closest('.zoombtn').dataset.zoom;
      if (cfg.onInspect) cfg.onInspect(zid);
      return;
    }
    if (drag && drag.moved) return;
    var card = e.target.closest('.hand-card');
    if (!card || !interactive()) return;
    var id = card.dataset.card;
    if (selected === id) { setSelected(null); return; }
    setSelected(id);
  }

  function setSelected(id) {
    selected = id;
    View.handCardEls().forEach(function (n) {
      n.classList.toggle('selected', n.dataset.card === id);
    });
    if (id) previewCard(id); else clearPreview();
  }

  function onBoardClick(e) {
    if (!selected || !interactive()) return;
    var tile = e.target.closest('.tile');
    if (!tile) return;
    var cell = Number(tile.dataset.cell);
    var st = state();
    if (Engine.legalTargets(st, selected).indexOf(cell) < 0) {
      View.rejectCell(cell);
      return;
    }
    var card = selected;
    setSelected(null);
    commit(card, cell, null);
  }

  /* ---- the drag session ----------------------------------------------- */

  function onHandPointerDown(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (e.target.closest('.zoombtn')) return;
    var card = e.target.closest('.hand-card');
    if (!card || !interactive()) return;
    if (card.classList.contains('facedown')) return;

    var id = card.dataset.card;
    var st = state();
    var legal = Engine.legalTargets(st, id);

    drag = {
      id: id,
      pointerId: e.pointerId,
      source: card,
      legal: legal,
      mode: Engine.moveKind(id),
      startX: e.clientX, startY: e.clientY,
      x: e.clientX, y: e.clientY,          // pointer
      gx: 0, gy: 0,                        // ghost (smoothed)
      samples: [{ t: performance.now(), x: e.clientX, y: e.clientY }],
      speed: 0,
      moved: false,
      started: false,
      lock: null,                          // locked cell index
      slowSince: 0,
      ghost: null,
      raf: 0
    };
    // Don't preventDefault yet — a plain click must still work.
  }

  function beginDrag(e) {
    var d = drag;
    d.started = true;
    measure();

    var r = d.source.getBoundingClientRect();
    d.grabDX = d.startX - (r.left + r.width / 2);
    d.grabDY = d.startY - (r.top + r.height / 2);
    d.width = r.width;
    d.homeX = r.left + r.width / 2;
    d.homeY = r.top + r.height / 2;

    var g = document.createElement('div');
    g.className = 'drag-ghost';
    g.style.width = r.width + 'px';
    g.innerHTML = Cards.svg(d.id);
    layer.appendChild(g);
    d.ghost = g;
    d.gx = r.left + r.width / 2;
    d.gy = r.top + r.height / 2;
    d.tilt = 0;

    d.source.classList.add('dragging');
    document.body.classList.add('dragging-card');

    // Show every legal space for the whole drag.
    var blocked = [];
    if (!Cards.isJack(d.id)) {
      SQ.Board.cellsForCard(d.id).forEach(function (i) {
        if (d.legal.indexOf(i) < 0) blocked.push(i);
      });
    }
    // Nothing highlights when there is nowhere to go, which — together with the
    // card's own 0 badge and grey-out — is the whole message. No popup.
    View.setTargets(d.legal, d.mode, blocked);

    d.raf = requestAnimationFrame(tick);
  }

  function onMove(e) {
    var d = drag;
    if (!d || e.pointerId !== d.pointerId) return;

    d.x = e.clientX; d.y = e.clientY;

    if (!d.started) {
      var dx = d.x - d.startX, dy = d.y - d.startY;
      if (dx * dx + dy * dy < START_THRESHOLD * START_THRESHOLD) return;
      d.moved = true;
      beginDrag(e);
    }
    e.preventDefault();

    d.samples.push({ t: performance.now(), x: d.x, y: d.y });
    // Intent is evaluated in the animation loop rather than here: a pointer that
    // has come to a complete stop emits no further move events, and "they stopped
    // moving, so they've chosen" is precisely the case we must detect.
  }

  /* Age out stale samples and recompute speed against the *current* time, so a
   * stopped pointer decays to zero instead of keeping its last known velocity. */
  function refreshSpeed(d, now) {
    while (d.samples.length > 1 && now - d.samples[0].t > SPEED_WINDOW) d.samples.shift();
    d.speed = computeSpeed(d.samples);
  }

  function computeSpeed(samples) {
    if (samples.length < 2) return 0;
    var a = samples[0], b = samples[samples.length - 1];
    var dt = b.t - a.t;
    if (dt <= 0) return 0;
    var dx = b.x - a.x, dy = b.y - a.y;
    return Math.sqrt(dx * dx + dy * dy) / dt;
  }

  /* The heart of it: decide whether the player has settled on a target. */
  function updateIntent(now) {
    var d = drag;
    if (!d.legal.length) return;

    // "Settling" is purely a question of speed. Because refreshSpeed ages samples
    // against the current clock, a pointer that has stopped dead decays to 0 and
    // this becomes true on its own, with no further input events needed.
    var settling = d.speed < SLOW_SPEED;

    if (settling) {
      if (!d.slowSince) d.slowSince = now;
    } else {
      d.slowSince = 0;
    }

    // Moving fast again? Let go of the lock so the card doesn't drag a stale
    // highlight across the board.
    if (d.speed > FAST_SPEED && d.lock !== null) {
      setLock(null);
      return;
    }

    var near = nearestTarget(d.x, d.y, d.legal);
    var reach = tileW() * CATCH_RADIUS;

    if (d.lock !== null) {
      // Hysteresis: only switch if a rival is clearly closer, or we've wandered
      // well outside the locked tile.
      var lockR = rects[d.lock];
      var ldx = d.x - lockR.cx, ldy = d.y - lockR.cy;
      var lockDist = Math.sqrt(ldx * ldx + ldy * ldy);
      if (lockDist > reach * 1.5) {
        setLock(null);
      } else if (near.cell !== d.lock && near.dist < lockDist - SWITCH_MARGIN && d.speed < SLOW_SPEED) {
        setLock(near.cell);
      }
      return;
    }

    // Not locked: commit once we've settled for long enough near a legal space.
    var dwelled = d.slowSince && (now - d.slowSince) >= DWELL_MS;
    if (dwelled && near.cell >= 0 && near.dist < reach) setLock(near.cell);
  }

  function setLock(cell) {
    var d = drag;
    if (d.lock === cell) return;
    d.lock = cell;
    View.setSnap(cell);
    if (cell !== null && cfg.onSnap) cfg.onSnap(cell);
  }

  /* ---- ghost animation ------------------------------------------------ */

  function tick() {
    var d = drag;
    if (!d || !d.started) return;

    var now = performance.now();
    refreshSpeed(d, now);
    updateIntent(now);

    var targetX, targetY, targetW, targetTilt;

    if (d.lock !== null && rects[d.lock]) {
      // Magnetise: the card sits on the tile, squared up and sized to it.
      var r = rects[d.lock];
      targetX = r.cx; targetY = r.cy;
      targetW = r.w * 1.14;
      targetTilt = 0;
    } else {
      targetX = d.x - d.grabDX;
      targetY = d.y - d.grabDY;
      targetW = d.width;
      var vx = velocityX(d.samples);
      targetTilt = Math.max(-TILT_MAX, Math.min(TILT_MAX, vx * 22));
    }

    var k = d.lock !== null ? 0.30 : FOLLOW;
    d.gx += (targetX - d.gx) * k;
    d.gy += (targetY - d.gy) * k;
    d.tilt += (targetTilt - d.tilt) * 0.18;
    var curW = parseFloat(d.ghost.style.width) || d.width;
    var w = curW + (targetW - curW) * 0.28;
    d.ghost.style.width = w + 'px';

    var lift = d.lock !== null ? 1 : 1.06;
    d.ghost.style.transform = 'translate3d(' + (d.gx - w / 2) + 'px,' +
      (d.gy - w * 1.4 / 2) + 'px,0) rotate(' + d.tilt.toFixed(2) + 'deg) scale(' + lift + ')';

    d.raf = requestAnimationFrame(tick);
  }

  function velocityX(samples) {
    if (samples.length < 2) return 0;
    var a = samples[0], b = samples[samples.length - 1];
    var dt = b.t - a.t;
    return dt > 0 ? (b.x - a.x) / dt : 0;
  }

  /* ---- release -------------------------------------------------------- */

  function onUp(e) {
    var d = drag;
    if (!d || e.pointerId !== d.pointerId) return;

    if (!d.started) { drag = null; return; }   // it was a click; onHandClick handles it

    cancelAnimationFrame(d.raf);
    var cell = d.lock;

    // Forgiving release: no lock, but the pointer is right on top of a legal
    // space — the player clearly meant it, so take it.
    if (cell === null && d.legal.length) {
      var near = nearestTarget(d.x, d.y, d.legal);
      if (near.cell >= 0 && near.dist < tileW() * RELEASE_RADIUS) cell = near.cell;
    }

    if (cell === null) {
      returnGhost(d);
      finish(d);
      // Dropped on a real square that the card cannot go on — flash that square
      // red so the refusal is anchored to the thing they aimed at.
      var tile = document.elementFromPoint(d.x, d.y);
      var t = tile && tile.closest ? tile.closest('.tile') : null;
      if (t) View.rejectCell(Number(t.dataset.cell));
      return;
    }

    landGhost(d, cell);
    finish(d);
    commit(d.id, cell, d.mode);
  }

  function onCancel(e) {
    var d = drag;
    if (!d) return;
    if (e && e.pointerId != null && e.pointerId !== d.pointerId) return;
    if (d.started) { cancelAnimationFrame(d.raf); returnGhost(d); }
    finish(d);
  }

  function finish(d) {
    if (d.source) d.source.classList.remove('dragging');
    document.body.classList.remove('dragging-card');
    View.setSnap(null);
    View.clearTargets();
    hoverCard = null;
    drag = null;
  }

  /* Card flies home and dissolves back into the hand. */
  function returnGhost(d) {
    var g = d.ghost;
    if (!g) return;
    g.classList.add('returning');
    g.style.width = d.width + 'px';
    g.style.transform = 'translate3d(' + (d.homeX - d.width / 2) + 'px,' +
      (d.homeY - d.width * 1.4 / 2) + 'px,0) rotate(0deg) scale(1)';
    g.style.opacity = '0';
    setTimeout(function () { g.remove(); }, 380);
  }

  /* Card slams onto the target space and fades as the chip drops. */
  function landGhost(d, cell) {
    var g = d.ghost, r = rects[cell];
    if (!g || !r) { if (g) g.remove(); return; }
    g.classList.add('landing');
    g.style.width = r.w + 'px';
    g.style.transform = 'translate3d(' + (r.cx - r.w / 2) + 'px,' +
      (r.cy - r.w * 1.4 / 2) + 'px,0) rotate(0deg) scale(1)';
    g.style.opacity = '0';
    setTimeout(function () { g.remove(); }, 460);
  }

  /* ---- handing off to the game --------------------------------------- */

  function commit(cardId, cell, mode) {
    if (cfg.onDrop) cfg.onDrop(cardId, cell, mode);
  }

  SQ.Drag = {
    init: init,
    invalidate: invalidate,
    measure: measure,
    previewCard: previewCard,
    clearPreview: clearPreview,
    setSelected: setSelected,
    selected: function () { return selected; },
    isDragging: function () { return !!(drag && drag.started); },
    // Diagnostics for tuning the snap feel — inspect from the console mid-drag.
    debug: function () {
      if (!drag) return null;
      var near = drag.started && drag.legal.length ? nearestTarget(drag.x, drag.y, drag.legal) : null;
      return {
        started: drag.started, speed: +drag.speed.toFixed(4), lock: drag.lock,
        slowFor: drag.slowSince ? +(performance.now() - drag.slowSince).toFixed(0) : 0,
        legal: drag.legal.length, tileW: +tileW().toFixed(1),
        nearest: near && near.cell, nearestDist: near && +near.dist.toFixed(1),
        reach: +(tileW() * CATCH_RADIUS).toFixed(1)
      };
    },
    tuning: {
      SLOW_SPEED: SLOW_SPEED, FAST_SPEED: FAST_SPEED, DWELL_MS: DWELL_MS,
      SPEED_WINDOW: SPEED_WINDOW, SWITCH_MARGIN: SWITCH_MARGIN
    }
  };
})();
