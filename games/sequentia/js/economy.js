(function () {
  'use strict';

  var KEY = 'sequentia.sq.v2';
  var REWARD = 50;
  var categories = [
    {
      id: 'tables', label: 'Tables', items: [
        { id: 'table-classic', name: 'Classic felt', cost: 0, desc: 'The original emerald table.', className: 'classic' },
        { id: 'table-midnight', name: 'Moonlit felt', cost: 180, desc: 'Deep navy with silver trim.', className: 'midnight' },
        { id: 'table-royal', name: 'Royal velvet', cost: 320, desc: 'Burgundy, brass, and ceremony.', className: 'royal' },
        { id: 'table-arcade', name: 'Arcade neon', cost: 450, desc: 'A bright electric night table.', className: 'arcade' },
        { id: 'table-paper', name: 'Study table', cost: 220, desc: 'Warm paper, ink, and wood.', className: 'paper' }
      ]
    },
    {
      id: 'cards', label: 'Card backs', items: [
        { id: 'cards-standard', name: 'Standard backs', cost: 0, desc: 'Clean, familiar, unmistakable.', className: 'standard' },
        { id: 'cards-rabbit', name: 'Rabbit gold', cost: 260, desc: 'A little royal mischief.', className: 'rabbit' },
        { id: 'cards-obsidian', name: 'Obsidian foil', cost: 380, desc: 'Black glass and a gold edge.', className: 'obsidian' },
        { id: 'cards-starlight', name: 'Starlight', cost: 520, desc: 'A quiet constellation in every hand.', className: 'starlight' },
        { id: 'cards-candy', name: 'Candy club', cost: 300, desc: 'Playful colour for cheerful tables.', className: 'candy' }
      ]
    },
    {
      id: 'tokens', label: 'Tokens', items: [
        { id: 'tokens-classic', name: 'Classic chips', cost: 0, desc: 'The standard four team colours.', className: 'classic' },
        { id: 'tokens-gold', name: 'Gold chips', cost: 340, desc: 'Warm metallic team tokens.', className: 'gold' },
        { id: 'tokens-crystal', name: 'Crystal chips', cost: 480, desc: 'Bright, glassy, and very readable.', className: 'crystal' },
        { id: 'tokens-ink', name: 'Ink stamps', cost: 240, desc: 'A hand-printed study aesthetic.', className: 'ink' }
      ]
    },
    {
      id: 'victories', label: 'Victory FX', items: [
        { id: 'fx-classic', name: 'Classic flourish', cost: 0, desc: 'The default win celebration.', className: 'classic' },
        { id: 'fx-fireworks', name: 'Fireworks', cost: 420, desc: 'A full-screen gold celebration.', className: 'fireworks' },
        { id: 'fx-crown', name: 'Crown moment', cost: 600, desc: 'A champion deserves a crown.', className: 'crown' },
        { id: 'fx-confetti', name: 'Confetti storm', cost: 360, desc: 'Ridiculous, colourful, joyful.', className: 'confetti' }
      ]
    },
    {
      id: 'features', label: 'Future modes', items: [
        { id: 'feature-draft', name: 'Draft mode', cost: 900, desc: 'Build a hand from a shared draft pool.', future: true },
        { id: 'feature-challenge', name: 'Daily challenges', cost: 700, desc: 'A new puzzle position every day.', future: true },
        { id: 'feature-tournament', name: 'Tournament tables', cost: 1400, desc: 'Private brackets and seasonal events.', future: true },
        { id: 'feature-custom', name: 'Custom rules', cost: 1000, desc: 'Make your own house rules and share them.', future: true },
        { id: 'feature-replays', name: 'Replay theatre', cost: 850, desc: 'Save, review, and share finished games.', future: true }
      ]
    }
  ];

  var state;
  try { state = JSON.parse(localStorage.getItem(KEY) || '') || null; } catch (e) { state = null; }
  if (!state || typeof state !== 'object') state = { balance: 0, owned: [], equipped: {} };
  state.owned = Array.isArray(state.owned) ? state.owned : [];
  state.equipped = state.equipped && typeof state.equipped === 'object' ? state.equipped : {};
  var activeCategory = 'tables';

  function allItems() {
    return categories.reduce(function (all, category) { return all.concat(category.items); }, []);
  }
  function findItem(id) {
    return allItems().find(function (item) { return item.id === id; });
  }
  function isOwned(item) { return item.cost === 0 || state.owned.indexOf(item.id) >= 0; }
  function save() { localStorage.setItem(KEY, JSON.stringify(state)); render(); }
  function toast(text) {
    var el = document.createElement('div');
    el.className = 'sq-toast'; el.textContent = text;
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 2600);
  }
  function renderBalance() {
    ['sq-balance', 'sq-store-balance'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.textContent = String(state.balance);
    });
  }
  function applyCosmetics() {
    var root = document.documentElement;
    var table = findItem(state.equipped.tables) || findItem('table-classic');
    var cards = findItem(state.equipped.cards) || findItem('cards-standard');
    var tokens = findItem(state.equipped.tokens) || findItem('tokens-classic');
    var fx = findItem(state.equipped.victories) || findItem('fx-classic');
    root.dataset.sqTable = table.className;
    root.dataset.sqCards = cards.className;
    root.dataset.sqTokens = tokens.className;
    root.dataset.sqVictory = fx.className;
  }
  function renderTabs() {
    var tabs = document.getElementById('sq-store-tabs');
    if (!tabs) return;
    tabs.innerHTML = categories.map(function (category) {
      return '<button type="button" class="sq-tab' + (category.id === activeCategory ? ' on' : '') +
        '" data-sq-category="' + category.id + '">' + category.label + '</button>';
    }).join('');
    tabs.querySelectorAll('[data-sq-category]').forEach(function (button) {
      button.addEventListener('click', function () { activeCategory = button.dataset.sqCategory; render(); });
    });
  }
  function renderGrid() {
    var grid = document.getElementById('sq-store-grid');
    if (!grid) return;
    var category = categories.find(function (item) { return item.id === activeCategory; }) || categories[0];
    grid.innerHTML = category.items.map(function (item) {
      var owned = isOwned(item);
      var equipped = state.equipped[category.id] === item.id;
      var action = item.future ? 'Coming soon' : (equipped ? 'Equipped' : (owned ? 'Equip' : (item.cost ? item.cost + ' SQ' : 'Free')));
      return '<article class="sq-item' + (equipped ? ' equipped' : '') + (item.future ? ' future' : '') +
        '" data-sq-id="' + item.id + '">' +
        '<div class="sq-item-preview sq-preview-' + (item.className || item.id) + '"></div>' +
        '<div class="sq-item-copy"><h3>' + item.name + '</h3><p>' + item.desc + '</p></div>' +
        '<button type="button" class="sq-buy" data-sq-buy="' + item.id + '" ' +
        (item.future ? 'disabled' : '') + '>' + action + '</button></article>';
    }).join('');
    grid.querySelectorAll('[data-sq-buy]').forEach(function (button) {
      button.addEventListener('click', function () { buyOrEquip(button.dataset.sqBuy); });
    });
  }
  function render() { renderBalance(); applyCosmetics(); renderTabs(); renderGrid(); }
  function buyOrEquip(id) {
    var item = findItem(id);
    if (!item || item.future) return;
    var category = categories.find(function (group) { return group.items.some(function (x) { return x.id === id; }); });
    if (!isOwned(item)) {
      if (state.balance < item.cost) { toast('Not enough SQ yet.'); return; }
      state.balance -= item.cost;
      state.owned.push(item.id);
      toast(item.name + ' unlocked.');
    }
    state.equipped[category.id] = item.id;
    save();
  }
  function openStore() {
    var panel = document.getElementById('sq-store');
    if (!panel) return;
    panel.hidden = false;
    render();
  }
  function closeStore() {
    var panel = document.getElementById('sq-store');
    if (panel) panel.hidden = true;
  }
  function reward(amount) {
    amount = Math.max(0, Number(amount) || REWARD);
    state.balance += amount; save();
    toast('+' + amount + ' SQ earned.');
  }
  function requestRewarded() {
    if (window.SequentiaAdsNative && window.SequentiaAdsNative.showRewardedAd) {
      window.SequentiaAdsNative.showRewardedAd();
      return;
    }
    toast('Rewarded ads are available in the Android app.');
  }
  window.SequentiaAds = {
    rewarded: reward,
    adUnavailable: function () { toast('The ad is still loading. Try again in a moment.'); }
  };
  var earn = document.getElementById('btn-earn-sq');
  var store = document.getElementById('btn-sq-store');
  var close = document.getElementById('sq-store-close');
  if (earn) earn.addEventListener('click', requestRewarded);
  if (store) store.addEventListener('click', openStore);
  if (close) close.addEventListener('click', closeStore);
  document.querySelectorAll('[data-sq-close]').forEach(function (el) { el.addEventListener('click', closeStore); });
  document.addEventListener('keydown', function (event) { if (event.key === 'Escape') closeStore(); });
  render();
}());
