(function () {
  'use strict';
  var KEY = 'sequentia.sq.v1';
  var REWARD = 50;
  var items = [
    { id: 'felt-midnight', name: 'Midnight felt', cost: 250, kind: 'table reskin' },
    { id: 'gold-tokens', name: 'Gold tokens', cost: 400, kind: 'token reskin' },
    { id: 'holo-cards', name: 'Holographic cards', cost: 750, kind: 'card reskin' },
    { id: 'modes', name: 'New game modes', cost: 1200, kind: 'placeholder' }
  ];
  var state;
  try { state = JSON.parse(localStorage.getItem(KEY) || '') || { balance: 0, owned: [] }; }
  catch (e) { state = { balance: 0, owned: [] }; }

  function save() { localStorage.setItem(KEY, JSON.stringify(state)); render(); }
  function render() {
    var balance = document.getElementById('sq-balance');
    if (balance) balance.textContent = String(state.balance);
  }
  function toast(text) {
    var el = document.createElement('div');
    el.className = 'sq-toast'; el.textContent = text;
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 2600);
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
  function openStore() {
    var lines = ['SQ Store', '', 'Your balance: ' + state.balance + ' SQ', ''];
    items.forEach(function (item, i) {
      var owned = state.owned.indexOf(item.id) >= 0;
      lines.push((i + 1) + '. ' + item.name + ' — ' + (owned ? 'owned' : item.cost + ' SQ'));
    });
    lines.push('', 'The first build uses a local demo wallet. Online wallet, purchases, and rankings come after the secure backend is connected.');
    var choice = window.prompt(lines.join('\n') + '\n\nType an item number to buy, or Cancel.');
    var index = Number(choice) - 1;
    var item = items[index];
    if (!item || state.owned.indexOf(item.id) >= 0) return;
    if (item.kind === 'placeholder') { toast('This mode is reserved for the online store.'); return; }
    if (state.balance < item.cost) { toast('Not enough SQ yet.'); return; }
    state.balance -= item.cost; state.owned.push(item.id); save();
    toast(item.name + ' unlocked.');
  }
  window.SequentiaAds = {
    rewarded: reward,
    adUnavailable: function () { toast('The ad is still loading. Try again in a moment.'); }
  };
  var earn = document.getElementById('btn-earn-sq');
  var store = document.getElementById('btn-sq-store');
  if (earn) earn.addEventListener('click', requestRewarded);
  if (store) store.addEventListener('click', openStore);
  render();
}());
