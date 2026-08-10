/* Sequentia — zoom & pan for the board stage.
 *
 * Owns exactly one thing: the `transform` on #world. Everything else (tiles,
 * chips, overlays) lives in unscaled layout coordinates inside #world and comes
 * along for the ride.
 *
 * Model
 * -----
 *   target   the view we are heading for (what get() reports; what all the
 *            public setters write to)
 *   current  the view actually painted this frame; exponentially eased toward
 *            target inside a single rAF loop
 *
 * Pointer-driven gestures (drag-pan, pinch) snap current==target so they track
 * the finger 1:1; wheel, buttons, keys, fit() and center() glide.
 *
 * The transform string is written at most once per animation frame, and the loop
 * shuts itself down as soon as the view has settled.
 *
 * No ES modules — plain script, attaches to window.SQ.
 */
(function () {
  'use strict';
  var SQ = (window.SQ = window.SQ || {});

  /* ------------------------------------------------------------- tunables */

  var MIN = 0.3;              // hard scale floor
  var MAX = 9;                // hard scale ceiling
  var FIT_PAD = 28;           // px of breathing room around the board in fit()
  var FIT_MAX = 1;            // fit() never enlarges past natural size
  var EDGE_KEEP = 120;        // px of content that must stay on screen
  var SMOOTH = 0.22;          // per-60fps-frame easing fraction
  var EPS_POS = 0.01;         // settle thresholds
  var EPS_SCALE = 0.0005;
  var BTN_STEP = 1.25;        // HUD button zoom factor
  var WHEEL_K = 0.0022;       // exp() gain for a normal wheel/trackpad scroll
  var PINCH_K = 0.011;        // exp() gain for ctrl+wheel (pinch emulation)
  var WHEEL_CLAMP = 180;      // px, per event, so a violent flick can't teleport
  var PAN_SLOP_MOUSE = 3;     // px before a mousedown becomes a pan
  var PAN_SLOP_TOUCH = 8;     // px before a touch becomes a pan (taps survive)
  var KEY_PAN = 80;           // arrow key pan distance
  var KEY_PAN_BIG = 320;      // ...with shift
  var DBL_SCALE = 2.2;        // double-click zoom level
  var DBL_BACK = 2;           // ...above this, double-click zooms back out

  /* ----------------------------------------------------------------- state */

  var stage = null, world = null, content = null, onChange = null;
  var hud = {};

  var cur = { x: 0, y: 0, scale: 1 };
  var tgt = { x: 0, y: 0, scale: 1 };
  var wrote = { x: NaN, y: NaN, scale: NaN };

  var vw = 0, vh = 0;         // stage (viewport) size
  var cw = 0, ch = 0;         // content size, unscaled layout px
  var ox = 0, oy = 0;         // content offset inside #world, unscaled

  var raf = 0, lastTs = 0;
  var anchor = null;          // {sx, sy, wx, wy} — screen point pinned to world point
  var inited = false;
  var pendingFit = null;      // fit() args awaiting a usable layout
  var fitRetries = 0;         // ...and a leash so we never spin forever
  var fitTimer = 0;
  var hasFitted = false;
  var fitCw = 0, fitCh = 0;   // content size at the last successful fit
  var spaceHeld = false;
  var resizeTimer = 0;
  var ro = null;

  var pointers = new Map();   // pointerId -> {x, y, x0, y0, touch}
  var mode = null;            // null | 'pan' | 'pinch'
  var panMoved = false;
  var panStart = null;        // {px, py, x, y, slop}
  var pinch = null;           // {d0, s0, wx, wy}

  /* ----------------------------------------------------------------- utils */

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function clampScale(s) {
    if (!isFinite(s)) return 1;
    return clamp(s, MIN, MAX);
  }

  function measure() {
    if (!stage) return false;
    var r = stage.getBoundingClientRect();
    vw = r.width || stage.clientWidth || 0;
    vh = r.height || stage.clientHeight || 0;
    if (content) {
      // offsetWidth/Height are layout px — unaffected by our own transform.
      cw = content.offsetWidth || 0;
      ch = content.offsetHeight || 0;
      ox = content.offsetLeft || 0;
      oy = content.offsetTop || 0;
    }
    return vw > 1 && vh > 1 && cw > 1 && ch > 1;
  }

  /* Keep the content reachable: centre it on any axis where it is smaller than
   * the viewport, otherwise never let it slide further than EDGE_KEEP off. */
  function clampAxis(t, size, off, view, s) {
    var span = size * s;
    if (span <= view) return (view - span) / 2 - off * s;
    var keep = Math.min(EDGE_KEEP, span);
    var lo = keep - (off + size) * s;   // content's far edge >= keep
    var hi = view - keep - off * s;     // content's near edge <= view - keep
    if (hi < lo) return (lo + hi) / 2;
    return clamp(t, lo, hi);
  }

  function clampPos(x, y, s) {
    return {
      x: clampAxis(x, cw, ox, vw, s),
      y: clampAxis(y, ch, oy, vh, s)
    };
  }

  function setTarget(x, y, s, opts) {
    s = clampScale(s);
    var p = clampPos(x, y, s);
    tgt.x = p.x; tgt.y = p.y; tgt.scale = s;
    if (!opts || opts.animate === false) {
      cur.x = tgt.x; cur.y = tgt.y; cur.scale = tgt.scale;
      anchor = null;
    }
    requestFrame();
  }

  /* --------------------------------------------------------- the rAF loop */

  function requestFrame() {
    if (!raf) raf = requestAnimationFrame(frame);
  }

  function settled() {
    return Math.abs(tgt.scale - cur.scale) < EPS_SCALE &&
           Math.abs(tgt.x - cur.x) < EPS_POS &&
           Math.abs(tgt.y - cur.y) < EPS_POS;
  }

  function frame(ts) {
    raf = 0;

    if (pendingFit) flushPendingFit();

    var done = settled();
    if (done) {
      cur.x = tgt.x; cur.y = tgt.y; cur.scale = tgt.scale;
      anchor = null;
      lastTs = 0;
    } else {
      var dt = lastTs ? Math.min(64, ts - lastTs) : 1000 / 60;
      lastTs = ts;
      // frame-rate independent exponential ease
      var a = 1 - Math.pow(1 - SMOOTH, dt / (1000 / 60));

      cur.scale += (tgt.scale - cur.scale) * a;
      if (Math.abs(tgt.scale - cur.scale) < EPS_SCALE) cur.scale = tgt.scale;

      if (anchor) {
        // Derive the translation from the pinned point so the anchor stays
        // exactly under the cursor for every intermediate frame, not just the
        // final one.
        var p = clampPos(anchor.sx - anchor.wx * cur.scale,
                         anchor.sy - anchor.wy * cur.scale, cur.scale);
        cur.x = p.x; cur.y = p.y;
      } else {
        cur.x += (tgt.x - cur.x) * a;
        cur.y += (tgt.y - cur.y) * a;
        if (Math.abs(tgt.x - cur.x) < EPS_POS) cur.x = tgt.x;
        if (Math.abs(tgt.y - cur.y) < EPS_POS) cur.y = tgt.y;
      }
      requestFrame();
    }

    render();
  }

  function render() {
    if (cur.x === wrote.x && cur.y === wrote.y && cur.scale === wrote.scale) return;
    wrote.x = cur.x; wrote.y = cur.y; wrote.scale = cur.scale;
    world.style.transform =
      'translate3d(' + cur.x.toFixed(2) + 'px,' + cur.y.toFixed(2) + 'px,0) scale(' +
      cur.scale.toFixed(5) + ')';
    if (hud.level) hud.level.textContent = Math.round(cur.scale * 100) + '%';
    if (onChange) {
      try { onChange({ x: cur.x, y: cur.y, scale: cur.scale }); }
      catch (err) { /* an overlay bug must never wedge the view */ }
    }
  }

  /* ------------------------------------------------------------ conversion */

  function stageOrigin() {
    var r = stage.getBoundingClientRect();
    return { left: r.left, top: r.top };
  }

  /* viewport (clientX/Y) -> unscaled world coords */
  function screenToWorld(cx, cy, useRendered) {
    var o = stageOrigin(), v = useRendered ? cur : tgt;
    return { x: (cx - o.left - v.x) / v.scale, y: (cy - o.top - v.y) / v.scale };
  }

  /* unscaled world coords -> viewport (clientX/Y) */
  function worldToScreen(x, y, useRendered) {
    var o = stageOrigin(), v = useRendered ? cur : tgt;
    return { x: o.left + v.x + x * v.scale, y: o.top + v.y + y * v.scale };
  }

  /* --------------------------------------------------------------- zooming */

  function centreClient() {
    var o = stageOrigin();
    return { x: o.left + vw / 2, y: o.top + vh / 2 };
  }

  function zoomTo(scale, cx, cy, opts) {
    if (!inited) return;
    measure();
    if (cx == null || cy == null) { var c = centreClient(); cx = c.x; cy = c.y; }
    var s = clampScale(scale);
    var o = stageOrigin();
    var sx = cx - o.left, sy = cy - o.top;      // stage-local anchor
    var w = { x: (sx - tgt.x) / tgt.scale, y: (sy - tgt.y) / tgt.scale };
    var animate = !opts || opts.animate !== false;
    setTarget(sx - w.x * s, sy - w.y * s, s, { animate: animate });
    if (animate) anchor = { sx: sx, sy: sy, wx: w.x, wy: w.y };
    return get();
  }

  function zoomBy(factor, cx, cy, opts) {
    if (!isFinite(factor) || factor <= 0) return get();
    return zoomTo(tgt.scale * factor, cx, cy, opts);
  }

  /* ------------------------------------------------------------------- fit */

  function flushPendingFit() {
    fitTimer = 0;
    if (!pendingFit) return;
    var o = pendingFit; pendingFit = null;
    fit(o);
  }

  function fit(opts) {
    opts = opts || {};
    if (!inited) return false;
    if (!measure()) {
      // Layout hasn't settled (display:none, web font, first paint…). Retry on
      // the next frame — but only for a couple of seconds, then wait for a
      // resize instead of burning a rAF loop forever.
      if (fitRetries++ < 150) {
        pendingFit = opts;
        requestFrame();
        // Belt and braces: rAF is throttled while the tab is hidden, and the
        // very first fit often lands before the stylesheet has applied.
        if (!fitTimer) fitTimer = setTimeout(flushPendingFit, 48);
      }
      return false;
    }
    fitRetries = 0;
    hasFitted = true;
    fitCw = cw; fitCh = ch;
    var pad = opts.padding == null ? FIT_PAD : opts.padding;
    var cap = opts.max == null ? FIT_MAX : opts.max;
    var s = Math.min((vw - pad * 2) / cw, (vh - pad * 2) / ch);
    if (cap) s = Math.min(s, cap);
    s = clampScale(s);
    var animate = opts.animate !== false;
    anchor = null;
    setTarget((vw - cw * s) / 2 - ox * s, (vh - ch * s) / 2 - oy * s, s,
              { animate: animate });
    return true;
  }

  function reset() { return fit({ animate: true }); }

  /* --------------------------------------------------------------- centring */

  function center(node, opts) {
    opts = opts || {};
    if (!inited || !node) return get();
    measure();
    var r = node.getBoundingClientRect();
    if (!r.width && !r.height) return get();
    var o = stageOrigin();
    // Derive from the *rendered* transform: that is what the rect reflects.
    var wx = (r.left + r.width / 2 - o.left - cur.x) / cur.scale;
    var wy = (r.top + r.height / 2 - o.top - cur.y) / cur.scale;
    var s = clampScale(opts.scale == null ? tgt.scale : opts.scale);
    anchor = null;
    setTarget(vw / 2 - wx * s, vh / 2 - wy * s, s,
              { animate: opts.animate !== false });
    return get();
  }

  function tileFor(cellIndex) {
    if (SQ.View && typeof SQ.View.tileEl === 'function') {
      var t = SQ.View.tileEl(cellIndex);
      if (t) return t;
    }
    return content ? content.querySelector('[data-cell="' + cellIndex + '"]') : null;
  }

  function focusCell(cellIndex, opts) {
    return center(tileFor(cellIndex), opts);
  }

  /* ----------------------------------------------------------------- wheel */

  function onWheel(e) {
    if (!inited) return;
    if (e.target && e.target.closest && e.target.closest('#zoom-hud, #hand')) return;
    // Always: otherwise the browser page-zooms on ctrl+wheel and rubber-bands
    // on trackpads.
    e.preventDefault();

    var d = e.deltaY;
    if (!d && e.deltaX) d = e.deltaX;
    if (e.deltaMode === 1) d *= 16;                 // DOM_DELTA_LINE
    else if (e.deltaMode === 2) d *= vh || 600;     // DOM_DELTA_PAGE
    d = clamp(d, -WHEEL_CLAMP, WHEEL_CLAMP);
    if (!d) return;

    var k = e.ctrlKey ? PINCH_K : WHEEL_K;
    zoomBy(Math.exp(-d * k), e.clientX, e.clientY);
  }

  /* -------------------------------------------------------- pointer / pan */

  /* Anything the drag-and-drop module owns, or our own chrome. */
  function isBlocked(e) {
    var t = e.target;
    return !!(t && t.closest && t.closest('#zoom-hud, #hand'));
  }
  function isCard(e) {
    var t = e.target;
    return !!(t && t.closest && t.closest('.tile, .hand-card'));
  }

  function onPointerDown(e) {
    if (!inited || isBlocked(e)) return;
    var touch = e.pointerType === 'touch' || e.pointerType === 'pen';

    if (!touch) {
      var left = e.button === 0;
      var middle = e.button === 1;
      var right = e.button === 2;
      if (!left && !middle && !right) return;
      // A left-drag that starts on a card belongs to the drag module. Right- and
      // middle-drag always pan, even when they start on a card: nothing else
      // claims those buttons, so holding right and hauling the board around is
      // unambiguous at any zoom level.
      if (left && !spaceHeld && isCard(e)) return;
      e.preventDefault();
    }

    pointers.set(e.pointerId, {
      x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, touch: touch
    });

    if (pointers.size === 2) { startPinch(); return; }
    if (pointers.size > 2) return;

    measure();
    mode = 'pan';
    panMoved = false;
    panStart = {
      px: e.clientX, py: e.clientY, x: tgt.x, y: tgt.y,
      slop: touch ? PAN_SLOP_TOUCH : PAN_SLOP_MOUSE
    };
    anchor = null;
  }

  function twoPointers() {
    var out = [];
    pointers.forEach(function (p) { if (out.length < 2) out.push(p); });
    return out;
  }

  function startPinch() {
    measure();
    var p = twoPointers();
    if (p.length < 2) return;
    var dx = p[1].x - p[0].x, dy = p[1].y - p[0].y;
    var d0 = Math.sqrt(dx * dx + dy * dy);
    if (d0 < 1) return;
    var o = stageOrigin();
    var mx = (p[0].x + p[1].x) / 2 - o.left, my = (p[0].y + p[1].y) / 2 - o.top;
    pinch = {
      d0: d0, s0: tgt.scale,
      wx: (mx - tgt.x) / tgt.scale, wy: (my - tgt.y) / tgt.scale
    };
    mode = 'pinch';
    panMoved = true;
    anchor = null;
    stage.classList.add('panning');
  }

  function updatePinch() {
    var p = twoPointers();
    if (!pinch || p.length < 2) return;
    var dx = p[1].x - p[0].x, dy = p[1].y - p[0].y;
    var d = Math.sqrt(dx * dx + dy * dy);
    if (d < 1) return;
    var s = clampScale(pinch.s0 * (d / pinch.d0));
    var o = stageOrigin();
    var mx = (p[0].x + p[1].x) / 2 - o.left, my = (p[0].y + p[1].y) / 2 - o.top;
    setTarget(mx - pinch.wx * s, my - pinch.wy * s, s, { animate: false });
  }

  function onPointerMove(e) {
    var p = pointers.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX; p.y = e.clientY;

    if (mode === 'pinch') { updatePinch(); return; }
    if (mode !== 'pan' || !panStart) return;

    var dx = e.clientX - panStart.px, dy = e.clientY - panStart.py;
    if (!panMoved) {
      if (Math.abs(dx) + Math.abs(dy) < panStart.slop) return;
      panMoved = true;
      stage.classList.add('panning');
    }
    // Translation lives in screen px (translate applied before scale), so the
    // drag is 1:1 at any zoom level.
    setTarget(panStart.x + dx, panStart.y + dy, tgt.scale, { animate: false });
  }

  function onPointerUp(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);

    if (pointers.size >= 2) { startPinch(); return; }

    if (pointers.size === 1) {
      // Pinch released a finger — carry on panning with the survivor.
      pinch = null;
      var only = twoPointers()[0];
      mode = 'pan';
      panStart = { px: only.x, py: only.y, x: tgt.x, y: tgt.y,
                   slop: only.touch ? PAN_SLOP_TOUCH : PAN_SLOP_MOUSE };
      panMoved = true;
      return;
    }

    mode = null; pinch = null; panStart = null; panMoved = false;
    stage.classList.remove('panning');
  }

  function isPanning() { return !!(panMoved && (mode === 'pan' || mode === 'pinch')); }

  /* ------------------------------------------------------------ dbl-click */

  function onDblClick(e) {
    if (!inited || isBlocked(e)) return;
    var t = e.target.closest && e.target.closest('.tile');
    if (!t) return;
    if (tgt.scale > DBL_BACK) fit({ animate: true });
    else center(t, { scale: DBL_SCALE, animate: true });
  }

  /* ------------------------------------------------------------- keyboard */

  function typing(e) {
    var t = e.target;
    if (!t) return false;
    var tag = (t.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' ||
           t.isContentEditable === true;
  }

  function setPannableCursor(on) {
    if (stage) stage.classList.toggle('pannable', !!on);
  }

  function onKeyDown(e) {
    if (!inited || typing(e)) return;

    if (e.code === 'Space' || e.key === ' ') {
      if (!spaceHeld) { spaceHeld = true; setPannableCursor(true); }
      // Only eat the key when nothing focusable would have used it.
      if (e.target === document.body || e.target === stage) e.preventDefault();
      return;
    }

    if (e.ctrlKey || e.metaKey || e.altKey) return;   // not ours

    var c = centreClient();
    switch (e.key) {
      case '+': case '=': case 'Add':
        e.preventDefault(); zoomBy(BTN_STEP, c.x, c.y); return;
      case '-': case '_': case 'Subtract':
        e.preventDefault(); zoomBy(1 / BTN_STEP, c.x, c.y); return;
      case '0':
        e.preventDefault(); reset(); return;
      case 'f': case 'F':
        e.preventDefault(); fit({ animate: true }); return;
    }

    var step = e.shiftKey ? KEY_PAN_BIG : KEY_PAN, dx = 0, dy = 0;
    if (e.key === 'ArrowLeft') dx = step;
    else if (e.key === 'ArrowRight') dx = -step;
    else if (e.key === 'ArrowUp') dy = step;
    else if (e.key === 'ArrowDown') dy = -step;
    else return;
    e.preventDefault();
    anchor = null;
    setTarget(tgt.x + dx, tgt.y + dy, tgt.scale, { animate: true });
  }

  function onKeyUp(e) {
    if (e.code === 'Space' || e.key === ' ') {
      spaceHeld = false;
      setPannableCursor(false);
    }
  }

  function onBlur() {
    spaceHeld = false;
    setPannableCursor(false);
    pointers.clear();
    mode = null; pinch = null; panStart = null; panMoved = false;
    if (stage) stage.classList.remove('panning');
  }

  /* ---------------------------------------------------------------- resize */

  function onResize() {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(applyResize, 60);
  }

  function applyResize() {
    resizeTimer = 0;
    if (!inited) return;
    fitRetries = 0;
    var oldW = vw, oldH = vh;
    // world point currently under the middle of the stage
    var wx = oldW ? (oldW / 2 - tgt.x) / tgt.scale : 0;
    var wy = oldH ? (oldH / 2 - tgt.y) / tgt.scale : 0;
    if (!measure()) { pendingFit = pendingFit || { animate: false }; requestFrame(); return; }
    if (!oldW || !oldH) { fit({ animate: false }); return; }
    anchor = null;
    setTarget(vw / 2 - wx * tgt.scale, vh / 2 - wy * tgt.scale, tgt.scale,
              { animate: false });
  }

  /* ------------------------------------------------------------------ HUD */

  function wireHud() {
    hud.level = document.getElementById('zoom-level');
    var pairs = [
      ['zoom-in', function () { var c = centreClient(); zoomBy(BTN_STEP, c.x, c.y); }],
      ['zoom-out', function () { var c = centreClient(); zoomBy(1 / BTN_STEP, c.x, c.y); }],
      ['zoom-reset', function () { reset(); }],
      ['btn-fit', function () { fit({ animate: true }); }]
    ];
    pairs.forEach(function (p) {
      var n = document.getElementById(p[0]);
      if (!n || n.dataset.sqZoomWired) return;
      n.dataset.sqZoomWired = '1';
      n.addEventListener('click', function (e) { e.preventDefault(); p[1](); });
    });
  }

  /* Small runtime-injected sheet: index.html doesn't link a zoom stylesheet, so
   * the two rules we genuinely need go in here rather than a file nobody loads. */
  function injectStyles() {
    if (document.getElementById('sq-zoom-style')) return;
    var s = document.createElement('style');
    s.id = 'sq-zoom-style';
    // Selection is disabled globally in the stylesheet, so only the cursor and the
    // hover-suppression need saying here.
    s.textContent =
      '#stage.panning .tile:hover{transform:none;}' +
      '#stage.pannable{cursor:grab;}' +
      '#stage.panning{cursor:grabbing;}';
    document.head.appendChild(s);
  }

  /* ----------------------------------------------------------------- init */

  function init(opts) {
    opts = opts || {};
    stage = opts.stage || document.getElementById('stage');
    world = opts.world || document.getElementById('world');
    content = opts.content || document.getElementById('board');
    onChange = typeof opts.onChange === 'function' ? opts.onChange : null;
    if (!stage || !world) return null;

    if (!inited) {
      injectStyles();

      stage.addEventListener('wheel', onWheel, { passive: false });
      stage.addEventListener('pointerdown', onPointerDown);
      stage.addEventListener('dblclick', onDblClick);
      window.addEventListener('pointermove', onPointerMove, { passive: true });
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerUp);
      document.addEventListener('keydown', onKeyDown);
      document.addEventListener('keyup', onKeyUp);
      window.addEventListener('blur', onBlur);
      window.addEventListener('resize', onResize);
      // Late-arriving stylesheet / web font can change the board's size.
      window.addEventListener('load', function () {
        fitRetries = 0;
        var w = content ? content.offsetWidth : 0, h = content ? content.offsetHeight : 0;
        if (!hasFitted || w !== fitCw || h !== fitCh) fit({ animate: false });
        else onResize();
      });
      // Stop the browser's own pinch-zoom / page-zoom gesture over the stage.
      stage.addEventListener('gesturestart', function (e) { e.preventDefault(); });
      // Right-drag pans, so the native menu must never open over the board. It is
      // suppressed for the whole stage rather than only after a drag has begun:
      // a menu that appears on the press and then vanishes once you move reads as
      // a glitch, and there is nothing on the felt worth right-clicking for.
      stage.addEventListener('contextmenu', function (e) { e.preventDefault(); });

      if (typeof ResizeObserver === 'function') {
        ro = new ResizeObserver(onResize);
        ro.observe(stage);
        if (content) ro.observe(content);
      }
      inited = true;
    }

    wireHud();
    fit({ animate: false });
    requestFrame();
    return SQ.Zoom;
  }

  /* --------------------------------------------------------------- public */

  function get() { return { x: tgt.x, y: tgt.y, scale: tgt.scale }; }
  function getRendered() { return { x: cur.x, y: cur.y, scale: cur.scale }; }
  function set(x, y, scale) {
    if (!inited) return get();
    measure();
    anchor = null;
    setTarget(x, y, scale == null ? tgt.scale : scale, { animate: false });
    return get();
  }

  SQ.Zoom = {
    init: init,
    get: get,
    getRendered: getRendered,
    set: set,
    zoomBy: zoomBy,
    zoomTo: zoomTo,
    fit: fit,
    reset: reset,
    center: center,
    focusCell: focusCell,
    screenToWorld: screenToWorld,
    worldToScreen: worldToScreen,
    isPanning: isPanning,
    MIN: MIN,
    MAX: MAX
  };
})();
