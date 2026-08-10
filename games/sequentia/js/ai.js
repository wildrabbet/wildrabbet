/* Sequentia — computer opponent.
 *
 * Pure and stateless: hand it a game state and a seat, get a move back. It never
 * touches the DOM and never mutates the state it is given (it simulates by
 * placing a chip, measuring, and putting the board back exactly as it was).
 *
 * How it thinks
 * -------------
 * Every sequence lives inside one of the 192 five-cell "windows" on the board
 * (every run of five along a row, column or diagonal). A cell is worth playing to
 * the extent that the windows through it are still winnable and already contain
 * chips of the right colour. So the evaluation is:
 *
 *   offence  — for each window through the cell that no opponent has touched,
 *              add a value that climbs steeply with how many of our chips are
 *              already in it. Four-of-ours is worth vastly more than three.
 *   defence  — the same sum computed for the best-placed opponent, i.e. what
 *              taking this cell denies them. A window where they hold four is
 *              worth blocking above almost anything else.
 *
 * Free corners count for everybody, so they are counted as ours *and* theirs.
 *
 * Depends on: SQ.Engine (rules), SQ.Cards (jack classification).
 */
(function () {
  'use strict';
  var SQ = (window.SQ = window.SQ || {});

  var N = 10;
  var LEN = 5;

  /* ------------------------------------------------------- window geometry */

  // WINDOWS[cell] = every five-cell run passing through that cell.
  // ALL_WINDOWS  = each of the 192 runs exactly once, for whole-board evaluation.
  var WINDOWS = [];
  var ALL_WINDOWS = [];

  (function buildWindows() {
    for (var i = 0; i < N * N; i++) WINDOWS[i] = [];
    var dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
    for (var r = 0; r < N; r++) {
      for (var c = 0; c < N; c++) {
        for (var d = 0; d < dirs.length; d++) {
          var cells = [], ok = true;
          for (var k = 0; k < LEN; k++) {
            var rr = r + dirs[d][0] * k, cc = c + dirs[d][1] * k;
            if (rr < 0 || rr >= N || cc < 0 || cc >= N) { ok = false; break; }
            cells.push(rr * N + cc);
          }
          if (!ok) continue;
          ALL_WINDOWS.push(cells);
          for (var m = 0; m < cells.length; m++) WINDOWS[cells[m]].push(cells);
        }
      }
    }
  })();

  /* How much a window is worth once it holds this many of our chips. The jump
   * from 3 to 4 is deliberately brutal: a window with four of ours is one card
   * from scoring, and one with five *is* a sequence. */
  var VALUE = [0, 1, 6, 22, 90, 1000000];

  function valueOf(n) { return VALUE[n > LEN ? LEN : n]; }

  /* Count what a window holds from `team`'s point of view. Free corners belong to
   * everyone, so they read as ours. */
  function windowStats(state, win, team) {
    var mine = 0, theirs = 0, empty = 0;
    for (var i = 0; i < win.length; i++) {
      var cell = state.board[win[i]];
      if (cell.free) { mine++; continue; }
      if (cell.chip === null) { empty++; continue; }
      if (SQ.Engine.teamOf(state, cell.chip) === team) mine++;
      else theirs++;
    }
    return { mine: mine, theirs: theirs, empty: empty };
  }

  /* Value to `team` of taking an empty cell. */
  function offence(state, cellIndex, team) {
    var wins = WINDOWS[cellIndex], total = 0;
    for (var i = 0; i < wins.length; i++) {
      var s = windowStats(state, wins[i], team);
      if (s.theirs) continue;                 // dead window, no value to us
      total += valueOf(s.mine + 1);           // +1 for the chip we are about to add
    }
    return total;
  }

  /* Value the *best-placed opponent* would get from that same cell — which is what
   * we deny them by taking it first. */
  function defence(state, cellIndex, team) {
    var best = 0;
    for (var t = 0; t < state.teams.length; t++) {
      var other = state.teams[t];
      if (other === team) continue;
      var wins = WINDOWS[cellIndex], total = 0;
      for (var i = 0; i < wins.length; i++) {
        var s = windowStats(state, wins[i], other);
        if (s.theirs) continue;
        total += valueOf(s.mine + 1);
      }
      if (total > best) best = total;
    }
    return best;
  }

  /* What an existing chip is worth to its owner — used to pick the juiciest
   * target for a one-eyed jack. */
  function chipValue(state, cellIndex) {
    var owner = state.board[cellIndex].chip;
    if (owner === null) return 0;
    var team = SQ.Engine.teamOf(state, owner);
    var wins = WINDOWS[cellIndex], total = 0;
    for (var i = 0; i < wins.length; i++) {
      var s = windowStats(state, wins[i], team);
      if (s.theirs) continue;
      total += valueOf(s.mine);               // it is already in there
    }
    return total;
  }

  /* ------------------------------------------------- whole-board evaluation */

  /* Everything `team` could still build, summed over all 192 windows. Unlike the
   * per-cell offence score this sees the shape of the whole position, so blocking
   * shows up as a drop in the opponent's number rather than needing its own term. */
  function teamPotential(state, team) {
    var total = 0;
    for (var i = 0; i < ALL_WINDOWS.length; i++) {
      var s = windowStats(state, ALL_WINDOWS[i], team);
      if (s.theirs) continue;
      total += valueOf(s.mine);
    }
    return total;
  }

  /* Our position minus the strongest opponent's. This is what the hard level
   * maximises, which is why it blocks and builds with the same yardstick instead
   * of trading them off with a hand-tuned weight. */
  function evaluatePosition(state, team, defWeight) {
    var mine = teamPotential(state, team);
    var best = 0;
    for (var t = 0; t < state.teams.length; t++) {
      var other = state.teams[t];
      if (other === team) continue;
      var p = teamPotential(state, other);
      if (p > best) best = p;
    }
    return mine - best * defWeight;
  }

  /* Cells where an opponent would complete a sequence on their very next chip:
   * a window they own four of, with exactly one gap. Counting these after a
   * candidate move is how the hard level avoids leaving forks open. */
  function openThreats(state, team) {
    var seen = {}, count = 0;
    for (var t = 0; t < state.teams.length; t++) {
      var other = state.teams[t];
      if (other === team) continue;
      for (var c = 0; c < state.board.length; c++) {
        var cell = state.board[c];
        if (cell.free || cell.chip !== null) continue;
        var wins = WINDOWS[c];
        for (var i = 0; i < wins.length; i++) {
          var s = windowStats(state, wins[i], other);
          if (s.theirs === 0 && s.mine === LEN - 1 && !seen[c]) {
            seen[c] = 1; count++;
            break;
          }
        }
      }
    }
    return count;
  }

  /* Does placing here actually complete a sequence? Asks the engine rather than
   * trusting the window maths, so the "reuse at most one chip" rule is honoured.
   * Restores the board before returning. */
  function completesSequence(state, cellIndex, playerIndex) {
    var cell = state.board[cellIndex];
    var was = cell.chip;
    cell.chip = playerIndex;
    var found = SQ.Engine.findNewSequences(state, cellIndex, SQ.Engine.teamOf(state, playerIndex));
    cell.chip = was;
    return found.length;
  }

  /* ------------------------------------------------------------- difficulty */

  var LEVELS = {
    easy: {
      key: 'easy', name: 'Easy',
      blurb: 'Plays reasonably but misses threats and squanders its jacks.',
      def: 0.0,            // ignores what the opponent is building
      randomChance: 0.70,  // most of its moves are just *a* legal move
                           // (tuned: Medium beats it ~72% of the time, which reads
                           //  as clearly weaker without being a pushover)
      jackCost: 0,         // burns wilds as soon as it draws them
      threatPenalty: 0,
      noise: 0.5
    },
    medium: {
      key: 'medium', name: 'Medium',
      blurb: 'Builds its own lines and blocks the obvious ones.',
      def: 0.75,
      randomChance: 0.08,
      jackCost: 70,
      threatPenalty: 0,
      noise: 0.15
    },
    hard: {
      key: 'hard', name: 'Hard',
      blurb: 'Weighs the whole board after every move, counts threats, and hoards its jacks.',
      global: true,        // scores the resulting position, not just the square
      def: 0.9,
      randomChance: 0,
      jackCost: 90,
      threatPenalty: 260,  // punishes moves that leave opponents a free score
      noise: 0.02
    }
  };

  var LEVEL_LIST = ['easy', 'medium', 'hard'];

  function level(name) { return LEVELS[name] || LEVELS.medium; }

  /* --------------------------------------------------------------- randomness */

  /* Own generator, seeded off the game seed. Deliberately *not* the engine's rng:
   * consuming that would change how the discard pile reshuffles and make seeded
   * games stop reproducing. */
  function makeRand(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x9e3779b9) >>> 0;
      var t = a;
      t ^= t >>> 15; t = Math.imul(t, 0x85ebca6b);
      t ^= t >>> 13; t = Math.imul(t, 0xc2b2ae35);
      t ^= t >>> 16;
      return (t >>> 0) / 4294967296;
    };
  }

  /* ------------------------------------------------------------- move choice */

  /* Score one candidate move. Higher is better.
   *
   * `baseline` is the whole-board evaluation of the current position, computed
   * once per turn by the caller. Global scoring must be expressed as the *change*
   * a move produces, not the absolute position: an absolute score runs into the
   * thousands, which would dwarf the jack and threat terms and let the noise
   * factor swamp the real differences between candidate moves. */
  function scoreMove(state, playerIndex, cand, lvl, rand, baseline) {
    var team = SQ.Engine.teamOf(state, playerIndex);
    var score;

    if (lvl.global) {
      // Judge the position the move actually produces, rather than the cell in
      // isolation. Removals are covered for free: taking their chip off the board
      // lowers their potential exactly as much as it was worth.
      var cell0 = state.board[cand.cell], was0 = cell0.chip;
      cell0.chip = cand.kind === 'remove' ? null : playerIndex;
      score = evaluatePosition(state, team, lvl.def) - baseline;
      cell0.chip = was0;
      if (cand.kind !== 'place') score -= lvl.jackCost;
    } else if (cand.kind === 'remove') {
      // A one-eyed jack is worth exactly the damage it does.
      score = chipValue(state, cand.cell);
      // Pulling a chip out of a four-in-a-row is the whole point; anything less
      // is usually better saved for later.
      score -= lvl.jackCost;
    } else {
      var off = offence(state, cand.cell, team);
      var def = defence(state, cand.cell, team);
      score = off + def * lvl.def;

      // A wild can go anywhere, so spending one on an ordinary square wastes it.
      if (cand.kind === 'wild') score -= lvl.jackCost;
    }

    // Winning right now trumps every heuristic.
    var seqs = cand.kind === 'remove' ? 0 : completesSequence(state, cand.cell, playerIndex);
    if (seqs) {
      var after = state.seqCount[team] + seqs;
      score += after >= state.seqToWin ? 1e9 : 5e6 * seqs;
    }

    // Look at the position we would be handing over.
    if (lvl.threatPenalty) {
      var cell = state.board[cand.cell], was = cell.chip;
      if (cand.kind === 'remove') cell.chip = null; else cell.chip = playerIndex;
      score -= openThreats(state, team) * lvl.threatPenalty;
      cell.chip = was;
    }

    // Jitter proportional to the score keeps equal-looking moves from always
    // resolving the same way, without letting noise override a real difference.
    if (lvl.noise) score *= 1 + (rand() - 0.5) * 2 * lvl.noise;
    return score;
  }

  function candidates(state, playerIndex) {
    var out = [];
    var hand = state.hands[playerIndex] || [];
    var seen = {};
    for (var i = 0; i < hand.length; i++) {
      var card = hand[i];
      if (seen[card]) continue;               // duplicate card, identical options
      seen[card] = 1;
      var kind = SQ.Engine.moveKind(card);
      var targets = SQ.Engine.legalTargets(state, card);
      for (var j = 0; j < targets.length; j++) {
        out.push({ card: card, cell: targets[j], kind: kind });
      }
    }
    return out;
  }

  /* The move this seat wants to make, or null if it has none and must pass. */
  function chooseMove(state, playerIndex, levelName) {
    if (!state || state.phase !== 'play') return null;
    var lvl = level(levelName);
    var cands = candidates(state, playerIndex);
    if (!cands.length) return null;

    var rand = makeRand((state.seed || 1) + state.turnNumber * 7919 + playerIndex * 104729);

    // The easy level mostly just plays something legal — but it still takes a
    // winning move if one is staring at it, because losing to a bot that walked
    // past a win is more annoying than losing to one that took it.
    if (lvl.randomChance && rand() < lvl.randomChance) {
      var winning = null;
      for (var w = 0; w < cands.length; w++) {
        if (cands[w].kind !== 'remove' && completesSequence(state, cands[w].cell, playerIndex)) {
          winning = cands[w]; break;
        }
      }
      if (winning) return winning;
      var plain = cands.filter(function (c) { return c.kind === 'place'; });
      var pool = plain.length ? plain : cands;
      return pool[Math.floor(rand() * pool.length)];
    }

    var baseline = lvl.global ? evaluatePosition(state, SQ.Engine.teamOf(state, playerIndex), lvl.def) : 0;
    var best = null, bestScore = -Infinity;
    for (var i = 0; i < cands.length; i++) {
      var s = scoreMove(state, playerIndex, cands[i], lvl, rand, baseline);
      if (s > bestScore) { bestScore = s; best = cands[i]; }
    }
    return best;
  }

  /* A dead card should always be swapped — it is a free action and a dead card is
   * pure deadweight. Returns the card to swap, or null. */
  function deadSwap(state, playerIndex) {
    if (!state || state.phase !== 'play' || state.deadUsedThisTurn) return null;
    var dead = SQ.Engine.deadCardsInHand(state, playerIndex);
    return dead.length ? dead[0] : null;
  }

  /* Human-readable reason, for the move log. Cheap to compute after the fact. */
  function explain(state, playerIndex, move) {
    if (!move) return 'has no legal move';
    var team = SQ.Engine.teamOf(state, playerIndex);
    if (move.kind === 'remove') return 'knocked out the most dangerous chip it could reach';
    if (completesSequence(state, move.cell, playerIndex)) return 'completed a sequence';
    var off = offence(state, move.cell, team);
    var def = defence(state, move.cell, team);
    if (def > off) return 'blocked a line';
    if (move.kind === 'wild') return 'spent a wild jack on the best square available';
    return 'extended its own line';
  }

  SQ.AI = {
    LEVELS: LEVELS,
    LEVEL_LIST: LEVEL_LIST,
    chooseMove: chooseMove,
    deadSwap: deadSwap,
    explain: explain,
    // exposed for the test harness
    _internals: {
      WINDOWS: WINDOWS, ALL_WINDOWS: ALL_WINDOWS,
      offence: offence, defence: defence, chipValue: chipValue,
      openThreats: openThreats, windowStats: windowStats,
      teamPotential: teamPotential, evaluatePosition: evaluatePosition
    }
  };
})();
