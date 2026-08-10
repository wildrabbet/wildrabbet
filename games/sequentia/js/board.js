/* Sequentia — the official Sequence board layout.
 *
 * Verified against three independent open-source implementations and
 * programmatically validated: 10x10, four FREE corners, 96 card spaces, all 48
 * non-jack cards appearing exactly twice, no jacks on the board.
 *
 * The physical board has no printed "up"; this is the standard published
 * orientation (the 2..9 spade run along the top edge, the A..6 diamond run
 * along the bottom). The layout is a double spiral, which is why some rows look
 * like they contain a duplicate (e.g. K-spades twice in row 4) — the two
 * spirals pass each other there. That is correct, not a typo.
 */
(function () {
  'use strict';
  var SQ = (window.SQ = window.SQ || {});

  var LAYOUT = [
    ['FREE', '2S', '3S', '4S', '5S', '6S', '7S', '8S', '9S', 'FREE'],
    ['6C', '5C', '4C', '3C', '2C', 'AH', 'KH', 'QH', 'TH', 'TS'],
    ['7C', 'AS', '2D', '3D', '4D', '5D', '6D', '7D', '9H', 'QS'],
    ['8C', 'KS', '6C', '5C', '4C', '3C', '2C', '8D', '8H', 'KS'],
    ['9C', 'QS', '7C', '6H', '5H', '4H', 'AH', '9D', '7H', 'AS'],
    ['TC', 'TS', '8C', '7H', '2H', '3H', 'KH', 'TD', '6H', '2D'],
    ['QC', '9S', '9C', '8H', '9H', 'TH', 'QH', 'QD', '5H', '3D'],
    ['KC', '8S', 'TC', 'QC', 'KC', 'AC', 'AD', 'KD', '4H', '4D'],
    ['AC', '7S', '6S', '5S', '4S', '3S', '2S', '2H', '3H', '5D'],
    ['FREE', 'AD', 'KD', 'QD', 'TD', '9D', '8D', '7D', '6D', 'FREE']
  ];

  var FLAT = [];
  LAYOUT.forEach(function (row) { row.forEach(function (c) { FLAT.push(c); }); });

  // card id -> [cellIndex, cellIndex]
  var BY_CARD = {};
  FLAT.forEach(function (card, i) {
    if (card === 'FREE') return;
    (BY_CARD[card] || (BY_CARD[card] = [])).push(i);
  });

  var COLS = 'ABCDEFGHIJ';

  function coord(i) { return COLS[i % 10] + (Math.floor(i / 10) + 1); }

  function cellName(i) {
    var card = FLAT[i];
    if (card === 'FREE') return coord(i) + ' (free corner)';
    return coord(i) + ' — ' + SQ.Cards.label(card);
  }

  function cellsForCard(cardId) { return BY_CARD[cardId] || []; }

  /* Self-validation — cheap, runs once, surfaces layout corruption immediately
   * rather than as a mysterious gameplay bug later. */
  function validate() {
    var problems = [];
    if (LAYOUT.length !== 10) problems.push('expected 10 rows, got ' + LAYOUT.length);
    LAYOUT.forEach(function (row, r) {
      if (row.length !== 10) problems.push('row ' + r + ' has ' + row.length + ' cells');
    });
    [0, 9, 90, 99].forEach(function (i) {
      if (FLAT[i] !== 'FREE') problems.push('corner ' + i + ' is not FREE');
    });
    var cards = FLAT.filter(function (c) { return c !== 'FREE'; });
    if (cards.length !== 96) problems.push('expected 96 card spaces, got ' + cards.length);
    var expect = SQ.Cards.fullDeck().filter(function (id) { return !SQ.Cards.isJack(id); });
    if (expect.length !== 48) problems.push('deck minus jacks should be 48, got ' + expect.length);
    expect.forEach(function (id) {
      var n = cellsForCard(id).length;
      if (n !== 2) problems.push(id + ' appears ' + n + ' times (expected 2)');
    });
    Object.keys(BY_CARD).forEach(function (id) {
      if (SQ.Cards.isJack(id)) problems.push('jack ' + id + ' should not be on the board');
      if (expect.indexOf(id) < 0) problems.push('unknown card on board: ' + id);
    });
    return problems;
  }

  SQ.Board = {
    LAYOUT: LAYOUT,
    LAYOUT_FLAT: FLAT,
    CORNERS: [0, 9, 90, 99],
    COLS: COLS,
    coord: coord,
    cellName: cellName,
    cellsForCard: cellsForCard,
    validate: validate
  };
})();
