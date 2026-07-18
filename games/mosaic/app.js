(() => {
  "use strict";

  const SAVE_KEY = "mosaic-rabbet-v2";
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const clamp = (n, min = 0, max = 100) => Math.max(min, Math.min(max, n));
  const money = (n) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(n);
  const seeded = (seed, turn, salt = 0) => { const x = Math.sin(seed * 12.9898 + turn * 78.233 + salt * 37.719) * 43758.5453; return x - Math.floor(x); };
  const ageText = (months) => `${Math.floor(months / 12)} years, ${months % 12} months`;
  const esc = (value) => String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);

  const basePeople = [
    { id: "alex", name: "Alex Morgan", role: "Partner · 2 years", emoji: "🧑🏽", closeness: 82, trust: 77, mood: "Thoughtful", memory: "You stayed when their father was in hospital." },
    { id: "nora", name: "Nora", role: "Parent · Newcastle", emoji: "👩🏻", closeness: 71, trust: 89, mood: "Busy", memory: "They are still proud of your university exhibition." },
    { id: "sam", name: "Sam Okafor", role: "Best friend · 8 years", emoji: "🧔🏿", closeness: 76, trust: 68, mood: "Restless", memory: "You promised to finally take that road trip." },
    { id: "meera", name: "Meera Iyer", role: "Team lead", emoji: "👩🏾‍💼", closeness: 48, trust: 55, mood: "Focused", memory: "Your last presentation recovered a difficult client meeting." }
  ];

  const wardrobe = [
    { id: "linen", name: "Blue linen shirt", detail: "Smart casual · breathable", emoji: "👕", condition: 91, equipped: true },
    { id: "trousers", name: "Tailored trousers", detail: "Office · formal", emoji: "👖", condition: 83, equipped: true },
    { id: "boots", name: "Leather boots", detail: "All-weather · repaired once", emoji: "🥾", condition: 68, equipped: true },
    { id: "jacket", name: "Vintage wool jacket", detail: "Warm · inherited", emoji: "🧥", condition: 72, equipped: false },
    { id: "trainers", name: "Running shoes", detail: "Sport · 412 km logged", emoji: "👟", condition: 57, equipped: false }
  ];

  function freshState(character) {
    const age = Number(character.age) || 24;
    const unemployed = character.career === "Unemployed" || character.career === "University Student";
    return {
      character: { ...character, age }, created: true, seed: Math.floor(Math.random() * 900000) + 100000,
      turn: 0, tab: "life", month: 6, ageMonths: age * 12 + 5,
      money: unemployed ? 4350 : 18420, salary: unemployed ? 0 : 4380, expenses: character.city === "Sydney" || character.city === "London" || character.city === "New York" ? 3180 : 2650,
      health: 88, wellbeing: 76, energy: 72, stress: character.trait === "Steady" ? 28 : 38,
      performance: unemployed ? 0 : 67, reputation: 43, homeCondition: 82,
      vehicle: { name: "2017 Harland M2", condition: 74, fuel: 68, mileage: 112640, value: 11400 },
      people: structuredClone(basePeople), wardrobe: structuredClone(wardrobe),
      goals: [
        { id: "deposit", title: "Build a home deposit", detail: "Move $850 aside each month", emoji: "🏡", progress: unemployed ? 1800 : 12600, target: 60000 },
        { id: "portfolio", title: unemployed ? "Find a direction" : "Lead a public project", detail: unemployed ? "Build skills and find work that fits" : "Earn Meera's trust and improve performance", emoji: unemployed ? "🧭" : "📐", progress: 3, target: 8 }
      ],
      events: [
        { id: "welcome", month: 6, ageMonths: age * 12 + 5, icon: "🌤️", title: `${character.name}'s life begins here`, body: `A clear Sunday morning in ${character.city}. Alex sent: “Drive somewhere green today?”`, tone: "neutral" },
        { id: "work", month: 5, ageMonths: age * 12 + 4, icon: "📐", title: "You saved the presentation", body: "When the client challenged the accessibility plan, you found the missing measurements and regained the room's confidence.", tone: "good" },
        { id: "car", month: 4, ageMonths: age * 12 + 3, icon: "🚗", title: "The Harland needed attention", body: "A mechanic replaced the front brake pads. You paid $460 and kept the invoice in the glove box.", tone: "warn" }
      ],
      actionHeat: {}, spamMode: "soft", autoResolve: true
    };
  }

  let state = null;
  let previous = null;
  let lastAction = { key: "", at: 0 };
  let toastTimer = null;

  try { state = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch { state = null; }

  function save() { if (state) localStorage.setItem(SAVE_KEY, JSON.stringify(state)); }
  function commit(next, message) { previous = structuredClone(state); state = next; save(); render(); if (message) toast(message); }
  function toast(message) { const el = $("#toast"); el.textContent = message; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 2600); }
  function event(next, icon, title, body, tone = "neutral") { next.events.unshift({ id: `${next.turn}-${Date.now()}`, month: next.month, ageMonths: next.ageMonths, icon, title, body, tone }); next.events = next.events.slice(0, 80); }
  function guard(key) { const now = Date.now(); const repeated = lastAction.key === key && now - lastAction.at < 1700; lastAction = { key, at: now }; if (repeated && state.spamMode === "strict") { toast("Repeat blocked — choose another action."); return false; } if (repeated && state.spamMode === "soft") toast("Repeated actions have diminishing returns."); return true; }
  function stat(label, value, tone = "") { return `<div class="stat"><div class="stat-label"><span>${label}</span><strong>${Math.round(value)}</strong></div><div class="bar"><span class="${tone}" style="width:${clamp(value)}%"></span></div></div>`; }
  function ring(value, label) { return `<div class="ring-wrap"><div class="ring" style="--value:${value * 3.6}deg"><span>${Math.round(value)}</span></div><small>${label}</small></div>`; }

  function renderHeader() {
    $("#dateLabel").textContent = `${MONTHS[state.month]} 2026`;
    $("#moneyLabel").textContent = money(state.money);
    $("#surplusLabel").textContent = `${state.salary - state.expenses >= 0 ? "+" : ""}${money(state.salary - state.expenses)}`;
    $("#undoButton").hidden = !previous;
    const c = state.character;
    $("#profileBlock").innerHTML = `<div class="portrait"><span>${c.emoji}</span><i>${Math.floor(state.ageMonths / 12)}</i></div><div><h1>${esc(c.name)}</h1><p>${esc(c.career)}</p><small>📍 ${esc(c.city)} · ${esc(c.pronouns)}</small></div>`;
    $$('[data-tab]').forEach((button) => button.classList.toggle("active", button.dataset.tab === state.tab));
  }

  function renderLife() {
    const grouped = [];
    state.events.forEach((item) => { const label = `${MONTHS[item.month]} · Age ${Math.floor(item.ageMonths / 12)}`; let group = grouped.find((g) => g.label === label); if (!group) { group = { label, items: [] }; grouped.push(group); } group.items.push(item); });
    return `<section class="hero-card"><div class="hero-copy"><span class="eyebrow">YOUR LIFE, RIGHT NOW</span><h2>${ageText(state.ageMonths)}</h2><p>${esc(state.character.career)} in ${esc(state.character.city)}. ${esc(state.character.trait)}, imperfect, and still becoming.</p></div><div class="rings">${ring(state.health, "Health")}${ring(state.wellbeing, "Wellbeing")}${ring(100 - state.stress, "Calm")}</div></section>
      <div class="section-heading"><div><span class="eyebrow">LIFE STORY</span><h2>What happened</h2></div><button class="filter-button">Newest first ▾</button></div>
      <section class="timeline">${grouped.map((group) => `<div class="timeline-group"><div class="timeline-date">${group.label}</div>${group.items.map((item) => `<article class="event-card ${item.tone}"><div class="event-icon">${item.icon}</div><div><h3>${esc(item.title)}</h3><p>${esc(item.body)}</p></div></article>`).join("")}</div>`).join("")}</section>`;
  }

  function renderPeople() {
    return `<section class="section-page"><div class="page-title"><span class="eyebrow">YOUR SOCIAL WORLD</span><h2>People who know ${esc(state.character.name.split(" ")[0])}</h2><p>Trust and closeness grow differently. People remember what you actually do.</p></div><div class="people-grid">${state.people.map((p) => `<article class="person-card"><div class="person-top"><div class="person-avatar">${p.emoji}</div><div><h3>${esc(p.name)}</h3><p>${esc(p.role)}</p></div><span class="mood">${esc(p.mood)}</span></div><div class="person-stats">${stat("Closeness", p.closeness)}${stat("Trust", p.trust, "blue")}</div><blockquote>“${esc(p.memory)}”</blockquote><div class="card-actions"><button data-act="${p.id === "alex" ? "talk" : p.id === "sam" ? "coffee" : p.id === "nora" ? "call" : "feedback"}">Spend time</button>${p.id === "alex" ? '<button class="primary-small" data-act="drive">🚗 Take out</button>' : ""}</div></article>`).join("")}</div></section>`;
  }

  function renderThings() {
    const worn = state.wardrobe.filter((w) => w.equipped);
    return `<section class="section-page"><div class="page-title"><span class="eyebrow">OWNED, USED, REMEMBERED</span><h2>Your belongings</h2><p>Everything has a place, condition, history and purpose.</p></div>
      <article class="asset-feature"><div class="asset-visual">🚙<span>${state.vehicle.condition < 50 ? "SERVICE" : "OWNED"}</span></div><div class="asset-main"><span class="eyebrow">YOUR VEHICLE</span><h3>${state.vehicle.name}</h3><p>Used hatchback · graphite · parked at home</p><div class="asset-metrics">${stat("Condition", state.vehicle.condition)}${stat("Fuel", state.vehicle.fuel, "blue")}</div><div class="asset-facts"><span><b>${state.vehicle.mileage.toLocaleString()} km</b> mileage</span><span><b>${money(state.vehicle.value)}</b> estimated value</span><span><b>${esc(state.character.name)}</b> legal owner</span></div><div class="card-actions"><button data-act="drive">🚗 Take Alex out</button><button class="primary-small" id="maintainButton">🔧 Maintain</button></div></div></article>
      <div class="subsection-title"><div><h3>👕 Wardrobe</h3><p>${worn.length} items in today's outfit</p></div><span class="context-chip">12°C · light rain</span></div><div class="wardrobe-grid">${state.wardrobe.map((item) => `<button class="wardrobe-card ${item.equipped ? "equipped" : ""}" data-wear="${item.id}"><span class="wardrobe-icon">${item.emoji}</span><span class="wearing">${item.equipped ? "WEARING" : "IN WARDROBE"}</span><strong>${esc(item.name)}</strong><small>${esc(item.detail)}</small><span class="condition-line"><i style="width:${item.condition}%"></i>${item.condition}% condition</span></button>`).join("")}</div>
      <div class="home-card"><div class="home-icon">🏠</div><div><span class="eyebrow">YOUR HOME</span><h3>2-bedroom apartment</h3><p>${esc(state.character.city)} · rented with Alex · ${money(Math.round(state.expenses * .77))}/month</p></div><div class="home-condition"><b>${state.homeCondition}%</b><small>condition</small></div></div></section>`;
  }

  function renderPlans() {
    return `<section class="section-page"><div class="page-title"><span class="eyebrow">INTENTION, MEET REALITY</span><h2>Plans and commitments</h2><p>Goals compete for money, energy and calendar space.</p></div><div class="goal-grid">${state.goals.map((g) => `<article class="goal-card"><div class="goal-icon">${g.emoji}</div><div><h3>${esc(g.title)}</h3><p>${esc(g.detail)}</p><div class="goal-progress"><span style="width:${clamp(g.progress / g.target * 100)}%"></span></div><small>${Math.round(g.progress / g.target * 100)}% complete</small></div></article>`).join("")}</div><div class="subsection-title"><div><h3>Add a direction</h3><p>A plan creates reminders and meaningful interruptions.</p></div></div><div class="plan-options"><button data-goal="roadtrip"><span>🗺️</span><strong>Coast road trip</strong><small>Repair a promise to Sam</small></button><button data-goal="promotion"><span>📈</span><strong>Earn a promotion</strong><small>Skills, trust and performance</small></button><button data-goal="health"><span>🌿</span><strong>Healthier routine</strong><small>Consistency without grinding</small></button></div><article class="calendar-card"><div><span class="calendar-day">24</span><span><b>Monday</b><small>Work review · 9:30 AM</small></span></div><div><span class="calendar-day">27</span><span><b>Thursday</b><small>Therapy · 5:00 PM</small></span></div><div><span class="calendar-day">30</span><span><b>Sunday</b><small>Rent and bills · ${money(state.expenses)}</small></span></div></article></section>`;
  }

  const paths = [["🏢","Build a company","Products, hiring, debt and ownership"],["🏘️","Property & land","Mortgages, tenants and renovation"],["📈","Invest & trade","Markets, tax, risk and advice"],["🎭","Stage & screen","Auditions, contracts and production"],["🚀","Space programme","Training, missions and research"],["🗳️","Public office","Campaigns, policy and public trust"],["🏅","Elite sport","Training, teams, injury and retirement"],["🎵","Make music","Practice, recording and touring"],["🕵️","Intelligence","Recruitment, cover and consequences"],["🏎️","Motorsport","Engineering, sponsors and racing"],["🦁","Wildlife & zoos","Conservation, welfare and visitors"],["🏕️","Outdoor life","Camping, expeditions and survival"]];
  function renderPaths() { return `<section class="section-page"><div class="page-title"><span class="eyebrow">A BIGGER LIFE</span><h2>Possible paths</h2><p>Your education, network, location, health and history determine what opens next.</p></div><div class="paths-grid">${paths.map((p, i) => `<button data-path="${esc(p[1])}"><span>${p[0]}</span><div><strong>${p[1]}</strong><small>${p[2]}</small></div><i>${i < 3 ? "Available" : "Explore"}</i></button>`).join("")}</div><div class="world-note"><span>🌏</span><div><h3>The world keeps moving</h3><p>Costs, laws, jobs and people change while you live. ${esc(state.character.city)} already shapes housing costs and opportunities.</p></div></div></section>`; }

  function renderRight() {
    const worn = state.wardrobe.filter((w) => w.equipped).map((w) => w.name.split(" ")[0]).join(" · ");
    $("#rightRail").innerHTML = `<section class="snapshot"><div class="rail-heading"><span>MONTHLY SNAPSHOT</span><small>${MONTHS[state.month]} 2026</small></div>${stat("Health", state.health)}${stat("Wellbeing", state.wellbeing, "blue")}${stat("Energy", state.energy, "gold")}${stat("Stress", state.stress, "red")}</section><section class="now-card"><span class="eyebrow">RIGHT NOW</span><div class="now-row"><span>👔</span><div><b>${esc(worn || "No outfit selected")}</b><small>${worn ? "Suitable for a casual day" : "Choose clothing in Belongings"}</small></div></div><div class="now-row"><span>🚙</span><div><b>${state.vehicle.name}</b><small>${state.vehicle.condition}% condition · ${state.vehicle.fuel}% fuel</small></div></div></section><section class="commitment-card"><span class="eyebrow">NEEDS ATTENTION</span><button data-tab="plans"><span>🗺️</span><div><b>Sam's road trip</b><small>Choose dates before it becomes another broken promise.</small></div><i>→</i></button></section>`;
  }

  function bindDynamic() {
    $$('[data-tab]').forEach((el) => el.onclick = () => { state.tab = el.dataset.tab; save(); render(); });
    $$('[data-act]').forEach((el) => el.onclick = () => act(el.dataset.act));
    $$('[data-wear]').forEach((el) => el.onclick = () => toggleWear(el.dataset.wear));
    $$('[data-goal]').forEach((el) => el.onclick = () => addGoal(el.dataset.goal));
    $$('[data-path]').forEach((el) => el.onclick = () => toast(`${el.dataset.path} added to your opportunities`));
    const maintain = $("#maintainButton"); if (maintain) maintain.onclick = maintainVehicle;
  }

  function render() {
    if (!state) return;
    renderHeader();
    const views = { life: renderLife, people: renderPeople, things: renderThings, plans: renderPlans, paths: renderPaths };
    $("#mainContent").innerHTML = views[state.tab]();
    renderRight(); bindDynamic();
  }

  function person(id, changes) { state.people = state.people.map((p) => p.id === id ? { ...p, ...changes(p) } : p); }
  function act(key) {
    if (!guard(key)) return;
    const next = structuredClone(state); next.turn++; const heat = next.actionHeat[key] || 0; next.actionHeat[key] = heat + 1; const effect = Math.max(.25, 1 - heat * .22);
    let icon = "✨", title = "A small choice", body = "You made time for something that mattered.", tone = "good";
    if (key === "talk") { next.people = next.people.map((p) => p.id === "alex" ? { ...p, closeness: clamp(p.closeness + 5 * effect), trust: clamp(p.trust + 3 * effect), mood: "Reassured", memory: "You put your phone away and really listened." } : p); next.wellbeing = clamp(next.wellbeing + 3 * effect); icon="💬"; title="You and Alex talked properly"; body="Alex admitted work has felt uncertain. You listened before offering advice."; }
    else if (key === "coffee") { next.money -= 12; next.energy = clamp(next.energy - 4); next.wellbeing = clamp(next.wellbeing + 5 * effect); next.people = next.people.map((p) => p.id === "sam" ? { ...p, closeness: clamp(p.closeness + 6 * effect), mood: "Energised", memory: "You made real plans instead of saying 'sometime'." } : p); icon="☕"; title="Coffee turned into a plan"; body="Sam wants to drive the coast in September. You agreed to choose dates."; }
    else if (key === "call") { next.people = next.people.map((p) => p.id === "nora" ? { ...p, closeness: clamp(p.closeness + 5 * effect), mood: "Relieved", memory: "You called without needing anything." } : p); icon="📞"; title="Nora answered on the third ring"; body="They sounded relieved just to hear your voice."; }
    else if (key === "drive") { next.money -= 34; next.energy = clamp(next.energy - 8); next.wellbeing = clamp(next.wellbeing + 8 * effect); next.vehicle.fuel = clamp(next.vehicle.fuel - 18); next.vehicle.condition = clamp(next.vehicle.condition - 1); next.vehicle.mileage += 126; next.people = next.people.map((p) => p.id === "alex" ? { ...p, closeness: clamp(p.closeness + 8 * effect), trust: clamp(p.trust + 3 * effect), mood: "Content", memory: "You drove to the coast and let the day unfold." } : p); icon="🚗"; title="A long drive with Alex"; body="You took the coast road, stopped for chips and talked with the windows cracked open."; }
    else if (key === "work" || key === "feedback") { next.performance = clamp(next.performance + 5 * effect); next.stress = clamp(next.stress + 5); icon="📐"; title="The work finally explained itself"; body="Focused time produced a cleaner plan. Meera noticed the improvement."; }
    else if (key === "run") { next.health = clamp(next.health + 4 * effect); next.energy = clamp(next.energy - 9); next.stress = clamp(next.stress - 5 * effect); icon="🏃"; title="Five kilometres, slowly"; body="You kept an easy pace and turned home before effort became injury."; }
    else if (key === "rest") { next.energy = clamp(next.energy + 15 * effect); next.stress = clamp(next.stress - 9 * effect); icon="🛋️"; title="You protected an empty evening"; body="No productivity project, no guilt. You went to bed early."; }
    else if (key === "cook") { next.money -= 16; next.health = clamp(next.health + 3 * effect); icon="🥘"; title="Dinner took longer than delivery"; body="The lentil stew was worth the washing up. There are leftovers for work."; }
    else if (key === "therapy") { next.money -= 110; next.stress = clamp(next.stress - 14 * effect); next.wellbeing = clamp(next.wellbeing + 7 * effect); icon="🧠"; title="You named the pressure"; body="You made a less punishing plan for handling uncertainty."; }
    event(next, icon, title, body, tone); closeModal(); commit(next, heat > 1 ? "Diminishing returns: vary your routine." : "Life updated");
  }

  function advance() {
    if (!guard("advance")) return;
    const next = structuredClone(state), roll = seeded(next.seed, next.turn + 1), surplus = next.salary - next.expenses;
    next.turn++; next.month = (next.month + 1) % 12; next.ageMonths++; next.money += surplus; next.energy = clamp(next.energy + 5); next.stress = clamp(next.stress - 3); next.vehicle.condition = clamp(next.vehicle.condition - 1); next.actionHeat = Object.fromEntries(Object.entries(next.actionHeat).map(([k,v]) => [k, Math.max(0, v - 2)])); next.goals = next.goals.map((g) => g.id === "deposit" ? { ...g, progress: Math.min(g.target, g.progress + Math.max(0, Math.min(850, surplus))) } : g);
    if (roll < .25) { next.money -= 285; next.homeCondition -= 6; event(next,"🔧","The washing machine leaked","The landlord covered the appliance; you paid $285 to replace a damaged rug.","warn"); }
    else if (roll < .5) { next.performance = clamp(next.performance + 5); next.reputation = clamp(next.reputation + 4); event(next,"🏛️","Your proposal made the shortlist","Meera credited your accessibility work in front of the team.","good"); }
    else if (roll < .75) { next.people = next.people.map((p) => p.id === "sam" ? {...p, closeness: clamp(p.closeness - 5), mood:"Disappointed"} : p); event(next,"📅","Sam stopped asking about September","The short reply made it clear the promise is becoming a pattern.","warn"); }
    else { next.wellbeing = clamp(next.wellbeing + 4); event(next,"🥟","Sunday lunch became a full table","You stayed until the tea went cold and took leftovers home.","good"); }
    commit(next, `${MONTHS[next.month]} simulated · ${money(surplus)} net`);
  }

  function toggleWear(id) { const next = structuredClone(state); next.wardrobe = next.wardrobe.map((w) => w.id === id ? { ...w, equipped: !w.equipped } : w); commit(next, "Outfit updated"); }
  function maintainVehicle() { if (state.vehicle.condition >= 96) return toast("The Harland does not need maintenance yet."); const next = structuredClone(state), cost = Math.round((100 - next.vehicle.condition) * 14 + 120); next.money -= cost; next.vehicle.condition = clamp(next.vehicle.condition + 28); next.vehicle.fuel = 100; event(next,"🔧","The Harland had a proper service",`Fluids, filters and a worn belt were replaced for ${money(cost)}.`,"good"); commit(next,"Vehicle serviced"); }
  function addGoal(kind) { if (state.goals.some((g) => g.id === kind)) return toast("That plan is already active."); const choices = { roadtrip:{id:"roadtrip",title:"Take the coast road with Sam",detail:"Choose dates, service the car and save $900",emoji:"🗺️",progress:1,target:4}, promotion:{id:"promotion",title:"Earn a project architect role",detail:"Build performance and Meera's trust",emoji:"📈",progress:2,target:10}, health:{id:"health",title:"Build a sustainable routine",detail:"Move, rest and cook without overtraining",emoji:"🌿",progress:1,target:12} }; const next = structuredClone(state); next.goals.push(choices[kind]); event(next,choices[kind].emoji,"You made a real plan",choices[kind].detail,"good"); commit(next,"Plan added"); }

  function actionModal() {
    const groups = [["People",[["💬","Talk with Alex","20 minutes","talk"],["☕","Meet Sam","$12 · 1 hour","coffee"],["📞","Call Nora","30 minutes","call"],["🚗","Take Alex out","$34 · 4 hours","drive"]]],["Work & growth",[["📐","Focus on work","2 hours · +stress","work"],["🗣️","Ask for feedback","30 minutes","feedback"]]],["Wellbeing",[["🏃","Go for a run","45 minutes · energy","run"],["🛋️","Have a quiet evening","3 hours","rest"],["🥘","Cook a proper dinner","$16 · 1 hour","cook"],["🧠","Therapy appointment","$110 · 1 hour","therapy"]]]];
    openModal(`<section class="activity-sheet" role="dialog" aria-modal="true"><div class="sheet-header"><div><span class="eyebrow">MAKE TIME FOR LIFE</span><h2>What will you do?</h2></div><button data-close aria-label="Close">×</button></div><p class="sheet-note">Actions consume time and have diminishing returns when repeated. People notice patterns.</p>${groups.map((g) => `<div class="activity-group"><h3>${g[0]}</h3><div>${g[1].map((a) => `<button data-act="${a[3]}"><span>${a[0]}</span><div><b>${a[1]}</b><small>${a[2]}</small></div><i>→</i></button>`).join("")}</div></div>`).join("")}</section>`);
  }
  function settingsModal() { openModal(`<section class="settings-sheet" role="dialog" aria-modal="true"><div class="sheet-header"><div><span class="eyebrow">YOUR EXPERIENCE</span><h2>Preferences</h2></div><button data-close aria-label="Close">×</button></div><label class="setting-row"><span><b>Repeat-action guard</b><small>Protect against accidental grinding</small></span><select id="spamSelect"><option value="off">Off</option><option value="soft">Soft warning</option><option value="strict">Strict block</option></select></label><label class="setting-row"><span><b>Resolve skill checks automatically</b><small>Use character ability instead of minigames</small></span><input id="autoCheck" type="checkbox" ${state.autoResolve ? "checked" : ""}></label><div class="setting-info"><span>🎲</span><p>This life uses deterministic seed <b>#${state.seed}</b>. The same choices produce the same outcomes.</p></div><button class="new-character-button" id="newCharacter">＋ Create a different character</button><button class="danger-button" id="resetTimeline">Restart this timeline</button></section>`); $("#spamSelect").value = state.spamMode; $("#spamSelect").onchange = (e) => { state.spamMode = e.target.value; save(); }; $("#autoCheck").onchange = (e) => { state.autoResolve = e.target.checked; save(); }; $("#newCharacter").onclick = () => { closeModal(); showCreator(true); }; $("#resetTimeline").onclick = () => { if (confirm("Restart this character's timeline?")) { const c = state.character; state = freshState(c); previous = null; save(); closeModal(); render(); toast("Timeline restarted"); } }; }
  function openModal(html) { const m = $("#modalBackdrop"); m.innerHTML = html; m.hidden = false; m.onclick = (e) => { if (e.target === m || e.target.closest("[data-close]")) closeModal(); }; $$('[data-act]').forEach((el) => el.onclick = () => act(el.dataset.act)); }
  function closeModal() { const m = $("#modalBackdrop"); m.hidden = true; m.innerHTML = ""; }

  function showCreator(replacing = false) { const c = $("#creatorBackdrop"); c.hidden = false; c.dataset.replacing = replacing ? "true" : "false"; if (replacing && state) { $("#creatorName").value = state.character.name; $("#creatorAge").value = Math.floor(state.ageMonths / 12); } updateCreatorPreview(); }
  function updateCreatorPreview() { const form = $("#creatorForm"), data = new FormData(form); $("#creatorEmoji").textContent = data.get("emoji") || "🧑"; $("#creatorPreviewName").textContent = data.get("name") || "Your person"; $("#creatorPreviewDetail").textContent = `${data.get("age") || 24} · ${data.get("city") || "Sydney"}`; }

  $("#creatorForm").addEventListener("input", updateCreatorPreview);
  $("#creatorForm").addEventListener("submit", (e) => { e.preventDefault(); const data = Object.fromEntries(new FormData(e.currentTarget)); if (!String(data.name).trim()) return; state = freshState({ name:String(data.name).trim(), age:Number(data.age), pronouns:data.pronouns, city:data.city, career:data.career, emoji:data.emoji, trait:data.trait }); previous = null; save(); $("#creatorBackdrop").hidden = true; render(); toast(`Welcome to ${state.character.name}'s life`); });
  $("#activityButton").onclick = actionModal; $("#advanceButton").onclick = advance; $("#settingsButton").onclick = settingsModal; $("#preferencesButton").onclick = settingsModal; $("#undoButton").onclick = () => { if (!previous) return; const current = structuredClone(state); state = previous; previous = null; save(); render(); toast("Last decision undone"); };

  if (!state?.created) showCreator(false); else render();
})();
