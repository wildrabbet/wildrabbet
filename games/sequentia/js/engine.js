/* Sequentia — pure rules engine.
 *
 * No DOM, no side effects, no randomness that isn't seeded. Everything the UI
 * needs to know about the game is derivable from a state object produced here.
 *
 * Depends on: SQ.Cards (for card identity helpers), SQ.Board (for the layout).
 */
(function () {
  'use strict';
  var SQ = (window.SQ = window.SQ || {});

  var N = 10;                 // board is N x N
  var SEQ_LEN = 5;            // chips in a row to score
  var DIRS = [
    { dr: 0, dc: 1, name: 'row' },
    { dr: 1, dc: 0, name: 'col' },
    { dr: 1, dc: 1, name: 'diag' },
    { dr: 1, dc: -1, name: 'anti' }
  ];

  /* ---------------------------------------------------------------- random */

  // mulberry32 — small, fast, seedable. Seeded so games can be replayed/debugged.
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rand) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /* ------------------------------------------------------------ presets */

  // Official deal sizes by player count.
  var HAND_SIZE = { 2: 7, 3: 6, 4: 6, 6: 5, 8: 4, 9: 4, 10: 3, 12: 3 };

  function handSizeFor(playerCount) {
    return HAND_SIZE[playerCount] || 6;
  }

  // Official: 2 teams -> 2 sequences to win; 3 teams -> 1 sequence.
  function sequencesToWin(teamCount) {
    return teamCount >= 3 ? 1 : 2;
  }

  // Player counts the official game supports. Every one of these divides evenly
  // into either 2 or 3 teams, which is what makes the seating rule below work.
  var PLAYER_COUNTS = [2, 3, 4, 6, 8, 9, 10, 12];

  // One colour per team — teammates share a chip colour, exactly as in the box.
  var TEAM_COLORS = ['crimson', 'azure', 'amber'];

  /* How many teams a given headcount can be split into. Two and three are the
   * only official team counts; a count equal to the headcount means everybody
   * plays for themselves, which is the same thing as "one player per team". */
  function validTeamCounts(playerCount) {
    var out = [];
    [2, 3].forEach(function (t) { if (playerCount % t === 0) out.push(t); });
    return out;
  }

  function teamSizeFor(playerCount, teamCount) {
    return Math.floor(playerCount / teamCount);
  }

  /* Build a seated roster.
   *
   * Official seating alternates teams around the table so no two teammates ever
   * play consecutively — with four players in two teams that is A B A B, and with
   * six in three teams A B C A B C. Since this array *is* the turn order, taking
   * the team as `index % teamCount` gives exactly that for free. */
  function makeRoster(playerCount, teamCount, opts) {
    opts = opts || {};
    var names = opts.names || [];
    var kinds = opts.kinds || [];
    var solo = teamCount === playerCount;
    var out = [];
    for (var i = 0; i < playerCount; i++) {
      var team = i % teamCount;
      out.push({
        name: (names[i] && String(names[i]).trim()) || 'Player ' + (i + 1),
        color: TEAM_COLORS[team % TEAM_COLORS.length],
        team: team,
        kind: kinds[i] || 'human',
        solo: solo
      });
    }
    return out;
  }

  var DEFAULT_PLAYERS = makeRoster(2, 2, {});

  /* -------------------------------------------------------------- setup */

  function createGame(opts) {
    opts = opts || {};
    var players = (opts.players || DEFAULT_PLAYERS).map(function (p, i) {
      return {
        index: i,
        name: p.name || 'Player ' + (i + 1),
        color: p.color || 'crimson',
        team: p.team == null ? i : p.team,
        kind: p.kind || 'human'          // 'human' | 'ai' | 'remote' (future)
      };
    });

    var teams = [];
    players.forEach(function (p) { if (teams.indexOf(p.team) < 0) teams.push(p.team); });
    teams.sort(function (a, b) { return a - b; });

    var layout = SQ.Board.LAYOUT_FLAT;   // 100 entries, 'FREE' or a card id
    var board = layout.map(function (card, i) {
      return {
        i: i,
        r: Math.floor(i / N),
        c: i % N,
        card: card,                       // 'FREE' or e.g. '6S'
        free: card === 'FREE',
        chip: null,                       // player index that owns the chip
        seqs: []                          // ids of completed sequences using this cell
      };
    });

    var seed = opts.seed == null ? (Date.now() & 0x7fffffff) : opts.seed;
    var rand = rng(seed);

    // Draw pile: two complete 52-card decks (jacks included).
    var deck = [];
    for (var d = 0; d < 2; d++) {
      SQ.Cards.fullDeck().forEach(function (id) { deck.push(id); });
    }
    shuffle(deck, rand);

    var hand = handSizeFor(players.length);
    var hands = players.map(function () { return []; });
    for (var k = 0; k < hand; k++) {
      for (var p = 0; p < players.length; p++) hands[p].push(deck.pop());
    }

    var state = {
      seed: seed,
      _rand: rand,
      players: players,
      teams: teams,
      seqToWin: opts.seqToWin || sequencesToWin(teams.length),
      handSize: hand,
      board: board,
      deck: deck,
      discard: [],
      hands: hands,
      turn: opts.firstPlayer || 0,
      phase: 'play',                      // 'play' | 'gameover'
      sequences: [],                      // {id, team, by, cells:[...], dir}
      seqCount: {},
      winner: null,                       // team id
      deadUsedThisTurn: false,
      lastMove: null,                     // {kind, cell, card, by}
      turnNumber: 1,
      log: []
    };
    teams.forEach(function (t) { state.seqCount[t] = 0; });

    // Read the table out by side, not by seat: in a team game "A & C vs B & D" is
    // the useful summary, and listing six names in seat order is not.
    var sides = teams.map(function (t) { return teamName(state, t); }).join(' vs ');
    logMsg(state, 'system', 'Game start — ' + sides +
      '. First to ' + state.seqToWin + ' sequence' + (state.seqToWin > 1 ? 's' : '') + ' wins.');
    return state;
  }

  function logMsg(state, kind, text, extra) {
    var entry = { kind: kind, text: text, turn: state.turnNumber, at: state.log.length };
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) entry[k] = extra[k];
    state.log.push(entry);
    return entry;
  }

  /* ------------------------------------------------------------ queries */

  function current(state) { return state.players[state.turn]; }
  function teamOf(state, playerIndex) { return state.players[playerIndex].team; }
  function hand(state, playerIndex) { return state.hands[playerIndex]; }

  // Board cells (0-2 of them) that display a given card.
  function cellsForCard(state, cardId) {
    return SQ.Board.cellsForCard(cardId);
  }

  function isOpen(cell) { return !cell.free && cell.chip === null; }

  // A chip is protected from one-eyed jacks once it is part of a completed sequence.
  function isProtected(cell) { return cell.seqs.length > 0; }

  /* Which board cells may this card legally target right now?
   *
   * `playerIndex` defaults to whoever is up, which is what a hotseat game wants.
   * It is passed explicitly when showing a player their own options while someone
   * else is to move — online, where each screen always displays its own hand, a
   * one-eyed jack asked about from the wrong seat would list the wrong chips. */
  function legalTargets(state, cardId, playerIndex) {
    var out = [];
    if (!cardId) return out;
    var who = playerIndex == null ? state.turn : playerIndex;
    var b = state.board;
    if (SQ.Cards.isTwoEyedJack(cardId)) {
      for (var i = 0; i < b.length; i++) if (isOpen(b[i])) out.push(i);
      return out;
    }
    if (SQ.Cards.isOneEyedJack(cardId)) {
      var me = teamOf(state, who);
      for (var j = 0; j < b.length; j++) {
        var c = b[j];
        if (c.free || c.chip === null) continue;
        if (teamOf(state, c.chip) === me) continue;    // can't remove your own team's
        if (isProtected(c)) continue;                  // locked into a sequence
        out.push(j);
      }
      return out;
    }
    cellsForCard(state, cardId).forEach(function (i) { if (isOpen(b[i])) out.push(i); });
    return out;
  }

  function moveKind(cardId) {
    if (SQ.Cards.isOneEyedJack(cardId)) return 'remove';
    if (SQ.Cards.isTwoEyedJack(cardId)) return 'wild';
    return 'place';
  }

  /* A non-jack card is "dead" when both of its board spaces are already taken. */
  function isDead(state, cardId) {
    if (SQ.Cards.isJack(cardId)) return false;
    var cells = cellsForCard(state, cardId);
    if (!cells.length) return true;
    for (var i = 0; i < cells.length; i++) if (isOpen(state.board[cells[i]])) return false;
    return true;
  }

  function deadCardsInHand(state, playerIndex) {
    return hand(state, playerIndex).filter(function (id) { return isDead(state, id); });
  }

  /* Does the player have any playable card at all? */
  function hasAnyMove(state, playerIndex) {
    var h = hand(state, playerIndex);
    for (var i = 0; i < h.length; i++) if (legalTargets(state, h[i]).length) return true;
    return false;
  }

  /* -------------------------------------------------- sequence detection */

  function idx(r, c) { return r * N + c; }
  function inBounds(r, c) { return r >= 0 && r < N && c >= 0 && c < N; }

  // Does this cell count toward `team`'s line? Free corners count for everybody.
  function counts(state, cell, team) {
    if (cell.free) return true;
    return cell.chip !== null && teamOf(state, cell.chip) === team;
  }

  // Is this cell already locked into a completed sequence belonging to `team`?
  // Free corners are shared by everyone and never consume the sharing allowance.
  function lockedFor(state, cell, team) {
    if (cell.free) return false;
    for (var i = 0; i < cell.seqs.length; i++) {
      var s = state.sequences[cell.seqs[i]];
      if (s && s.team === team) return true;
    }
    return false;
  }

  /* Find sequences newly completed by placing a chip at `cellIndex`.
   * Returns an array of {dir, cells}. A candidate window is rejected if it would
   * reuse more than one chip from this team's existing sequences.
   */
  function findNewSequences(state, cellIndex, team) {
    var found = [];
    var r0 = Math.floor(cellIndex / N), c0 = cellIndex % N;

    for (var d = 0; d < DIRS.length; d++) {
      var dir = DIRS[d];
      // Walk out both ways to build the maximal contiguous owned line.
      var line = [cellIndex];
      var r = r0 - dir.dr, c = c0 - dir.dc;
      while (inBounds(r, c) && counts(state, state.board[idx(r, c)], team)) {
        line.unshift(idx(r, c)); r -= dir.dr; c -= dir.dc;
      }
      r = r0 + dir.dr; c = c0 + dir.dc;
      while (inBounds(r, c) && counts(state, state.board[idx(r, c)], team)) {
        line.push(idx(r, c)); r += dir.dr; c += dir.dc;
      }
      if (line.length < SEQ_LEN) continue;

      // Prefer the window that reuses the fewest already-locked chips.
      var best = null, bestShared = 99;
      for (var s = 0; s + SEQ_LEN <= line.length; s++) {
        var win = line.slice(s, s + SEQ_LEN);
        if (win.indexOf(cellIndex) < 0) continue;      // must include the new chip
        var shared = 0;
        for (var w = 0; w < win.length; w++) {
          if (lockedFor(state, state.board[win[w]], team)) shared++;
        }
        if (shared > 1) continue;                      // at most one chip may be reused
        if (shared < bestShared) { bestShared = shared; best = win; }
        if (shared === 0) break;                       // can't do better
      }
      if (best) found.push({ dir: dir.name, cells: best });
    }
    return found;
  }

  function recordSequence(state, seq, playerIndex) {
    var id = state.sequences.length;
    var team = teamOf(state, playerIndex);
    var rec = { id: id, team: team, by: playerIndex, cells: seq.cells.slice(), dir: seq.dir };
    state.sequences.push(rec);
    rec.cells.forEach(function (ci) {
      var cell = state.board[ci];
      if (cell.seqs.indexOf(id) < 0) cell.seqs.push(id);
    });
    state.seqCount[team] = (state.seqCount[team] || 0) + 1;
    return rec;
  }

  /* ------------------------------------------------------------- actions */

  function drawFor(state, playerIndex) {
    if (!state.deck.length && state.discard.length) {
      state.deck = shuffle(state.discard.slice(), state._rand);
      state.discard = [];
      logMsg(state, 'system', 'Draw pile exhausted — discards reshuffled.');
    }
    if (!state.deck.length) return null;               // truly out of cards
    var card = state.deck.pop();
    state.hands[playerIndex].push(card);
    return card;
  }

  function removeFromHand(state, playerIndex, cardId) {
    var h = state.hands[playerIndex];
    var i = h.indexOf(cardId);
    if (i < 0) return false;
    h.splice(i, 1);
    return true;
  }

  /* Validate a proposed move without mutating anything. */
  function validate(state, playerIndex, cardId, cellIndex) {
    if (state.phase !== 'play') return { ok: false, why: 'The game is over.' };
    if (playerIndex !== state.turn) return { ok: false, why: "It isn't your turn." };
    if (state.hands[playerIndex].indexOf(cardId) < 0) return { ok: false, why: 'That card is not in your hand.' };
    if (legalTargets(state, cardId).indexOf(cellIndex) < 0) {
      return { ok: false, why: reasonIllegal(state, cardId, cellIndex) };
    }
    return { ok: true };
  }

  function reasonIllegal(state, cardId, cellIndex) {
    var cell = state.board[cellIndex];
    if (!cell) return 'That space does not exist.';
    if (SQ.Cards.isOneEyedJack(cardId)) {
      if (cell.free) return 'Corners are free spaces — nothing to remove.';
      if (cell.chip === null) return 'That space is empty — nothing to remove.';
      if (teamOf(state, cell.chip) === teamOf(state, state.turn)) return "That's your own chip.";
      if (isProtected(cell)) return 'That chip is part of a completed sequence and cannot be removed.';
    }
    if (cell.free) return 'Corners are free spaces and cannot be played on.';
    if (cell.chip !== null) return 'That space is already taken.';
    if (!SQ.Cards.isJack(cardId)) return SQ.Cards.label(cardId) + ' cannot be played there.';
    return 'Illegal move.';
  }

  /* Play a card. Returns a result describing what happened (for animation). */
  function play(state, cardId, cellIndex) {
    var playerIndex = state.turn;
    var v = validate(state, playerIndex, cardId, cellIndex);
    if (!v.ok) return { ok: false, why: v.why };

    var kind = moveKind(cardId);
    var cell = state.board[cellIndex];
    var player = state.players[playerIndex];
    var result = { ok: true, kind: kind, cell: cellIndex, card: cardId, by: playerIndex, newSequences: [], removed: null };

    if (kind === 'remove') {
      result.removed = { cell: cellIndex, from: cell.chip };
      var victim = state.players[cell.chip];
      cell.chip = null;
      removeFromHand(state, playerIndex, cardId);
      state.discard.push(cardId);
      logMsg(state, 'remove', player.name + ' played ' + SQ.Cards.label(cardId) + ' and removed ' +
        victim.name + "'s chip from " + SQ.Board.coord(cellIndex) + '.', { cell: cellIndex, card: cardId, by: playerIndex });
    } else {
      cell.chip = playerIndex;
      removeFromHand(state, playerIndex, cardId);
      state.discard.push(cardId);
      logMsg(state, kind === 'wild' ? 'wild' : 'place',
        player.name + ' played ' + SQ.Cards.label(cardId) +
        (kind === 'wild' ? ' as a wild on ' : ' on ') + SQ.Board.coord(cellIndex) + '.',
        { cell: cellIndex, card: cardId, by: playerIndex });

      var seqs = findNewSequences(state, cellIndex, teamOf(state, playerIndex));
      seqs.forEach(function (s) {
        var rec = recordSequence(state, s, playerIndex);
        result.newSequences.push(rec);
        logMsg(state, 'sequence', player.name + ' completed a SEQUENCE! (' +
          state.seqCount[rec.team] + ' of ' + state.seqToWin + ')', { seq: rec.id, by: playerIndex });
      });
    }

    result.drew = drawFor(state, playerIndex);
    state.lastMove = { kind: kind, cell: cellIndex, card: cardId, by: playerIndex };

    // Win check.
    var team = teamOf(state, playerIndex);
    if (state.seqCount[team] >= state.seqToWin) {
      state.phase = 'gameover';
      state.winner = team;
      result.winner = team;
      logMsg(state, 'win', teamName(state, team) + ' wins the game!');
      return result;
    }

    endTurn(state);
    result.nextTurn = state.turn;
    return result;
  }

  function teamMembers(state, team) {
    return state.players.filter(function (p) { return p.team === team; });
  }

  /* Full name, for headlines: "Alice" solo, or "Alice & Carol" for a team. */
  function teamName(state, team) {
    var members = teamMembers(state, team);
    return members.length === 1 ? members[0].name : members.map(function (p) { return p.name; }).join(' & ');
  }

  /* Short name, for the scoreboard, where a six-person team would not fit. */
  function teamLabel(state, team) {
    var members = teamMembers(state, team);
    return members.length === 1 ? members[0].name : 'Team ' + (team + 1);
  }

  function endTurn(state) {
    state.deadUsedThisTurn = false;
    state.turn = (state.turn + 1) % state.players.length;
    state.turnNumber++;

    // Stalemate guard: nobody can move and no cards left to draw.
    if (!hasAnyMove(state, state.turn) && !state.deck.length && !state.discard.length) {
      var anyone = false;
      for (var i = 0; i < state.players.length; i++) if (hasAnyMove(state, i)) anyone = true;
      if (!anyone) {
        state.phase = 'gameover';
        state.winner = null;
        logMsg(state, 'system', 'No legal moves remain — the game is a draw.');
      }
    }
  }

  /* Discard a dead card and draw a replacement. Free action, once per turn. */
  function discardDead(state, cardId) {
    if (state.phase !== 'play') return { ok: false, why: 'The game is over.' };
    var playerIndex = state.turn;
    if (state.hands[playerIndex].indexOf(cardId) < 0) return { ok: false, why: 'That card is not in your hand.' };
    if (!isDead(state, cardId)) return { ok: false, why: SQ.Cards.label(cardId) + ' is not dead — it still has an open space.' };
    if (state.deadUsedThisTurn) return { ok: false, why: 'Only one dead card may be swapped per turn.' };
    removeFromHand(state, playerIndex, cardId);
    state.discard.push(cardId);
    var drew = drawFor(state, playerIndex);
    state.deadUsedThisTurn = true;
    logMsg(state, 'dead', state.players[playerIndex].name + ' declared ' + SQ.Cards.label(cardId) +
      ' a dead card and drew a replacement.', { card: cardId, by: playerIndex });
    return { ok: true, drew: drew, discarded: cardId };
  }

  /* A player with no legal move at all must pass (can only happen when their
   * whole hand is dead and the deck is empty). */
  function pass(state) {
    if (state.phase !== 'play') return { ok: false, why: 'The game is over.' };
    if (hasAnyMove(state, state.turn)) return { ok: false, why: 'You still have a legal move.' };
    logMsg(state, 'system', state.players[state.turn].name + ' has no legal move and passes.');
    endTurn(state);
    return { ok: true, nextTurn: state.turn };
  }

  /* --------------------------------------------------------- diagnostics */

  // Cheap serialisable snapshot (drops _rand). Useful for tests/replays.
  function snapshot(state) {
    return JSON.stringify({
      board: state.board.map(function (c) { return c.chip === null ? '.' : c.chip; }),
      hands: state.hands, turn: state.turn, seqCount: state.seqCount,
      seqs: state.sequences.length, deck: state.deck.length, phase: state.phase
    });
  }

  SQ.Engine = {
    N: N,
    SEQ_LEN: SEQ_LEN,
    DIRS: DIRS,
    rng: rng,
    shuffle: shuffle,
    handSizeFor: handSizeFor,
    sequencesToWin: sequencesToWin,
    PLAYER_COUNTS: PLAYER_COUNTS,
    TEAM_COLORS: TEAM_COLORS,
    validTeamCounts: validTeamCounts,
    teamSizeFor: teamSizeFor,
    makeRoster: makeRoster,
    createGame: createGame,
    current: current,
    teamOf: teamOf,
    teamName: teamName,
    teamLabel: teamLabel,
    teamMembers: teamMembers,
    hand: hand,
    isOpen: isOpen,
    isProtected: isProtected,
    legalTargets: legalTargets,
    moveKind: moveKind,
    isDead: isDead,
    deadCardsInHand: deadCardsInHand,
    hasAnyMove: hasAnyMove,
    findNewSequences: findNewSequences,
    validate: validate,
    reasonIllegal: reasonIllegal,
    play: play,
    discardDead: discardDead,
    pass: pass,
    snapshot: snapshot,
    cellsForCard: cellsForCard
  };
})();
