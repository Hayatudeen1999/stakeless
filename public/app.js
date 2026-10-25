// Frontend: home, create/join, league view with Fixtures, Standings, Room chat, My predictions tabs.
const app = document.getElementById('app');
const badge = document.getElementById('badge');
const KEY = 'stakeless.rooms';

// Draws the streak badge icon (crown or flame) as vectors on the share poster canvas.
function drawStreakIcon(ctx, tier, x, y) {
  ctx.save();
  ctx.fillStyle = tier === 'crown' ? '#ffc94d' : '#ff9f43';
  if (tier === 'crown') {
    ctx.beginPath();
    ctx.moveTo(x, y + 26); ctx.lineTo(x, y + 8); ctx.lineTo(x + 5, y + 13);
    ctx.lineTo(x + 9, y + 5); ctx.lineTo(x + 13, y + 13); ctx.lineTo(x + 18, y + 8);
    ctx.lineTo(x + 18, y + 26); ctx.closePath(); ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(x + 11, y + 2);
    ctx.bezierCurveTo(x + 13, y + 9, x + 18, y + 11, x + 18, y + 18);
    ctx.bezierCurveTo(x + 18, y + 23, x + 14.5, y + 26, x + 9, y + 26);
    ctx.bezierCurveTo(x + 3.5, y + 26, x + 1, y + 22, x + 1, y + 18);
    ctx.bezierCurveTo(x + 1, y + 13, x + 6, y + 11, x + 7.5, y + 6);
    ctx.bezierCurveTo(x + 9, y + 8.5, x + 9.5, y + 10, x + 9.5, y + 12);
    ctx.bezierCurveTo(x + 12, y + 9, x + 11, y + 5, x + 11, y + 2);
    ctx.fill();
  }
  ctx.restore();
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Streak badges: 3+ flame, 5+ bigger flame with "on fire", 10+ crown "unstoppable".
// Vector icons instead of emoji so they render identically on every device.
const FLAME_ICON = '<svg class="sk-ico" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M13.5 0.7s.9 3-1.3 5.6c-1.5 1.8-3.7 3-4.9 5.4-1.7 3.4-.4 7.6 3 9.6-1.6-2.4-1.3-5.1.6-7 1.2-1.2 2.6-2 3.6-3.5 1.9 2.5 3.6 4.6 3 7.7-.3 1.4-1.1 2.6-2.2 3.5 3.9-1 6.6-4.4 6.2-8.4-.3-3-2.4-4.7-3.9-6.7-1.2-1.7-2.4-3.6-4.1-6.2z"/></svg>';
const CROWN_ICON = '<svg class="sk-ico" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M2.8 7.3 7 10.9l4.2-6.4c.3-.5 1.1-.5 1.4 0l4.2 6.4 4.4-3.6c.6-.5 1.5.1 1.3.9l-2.2 9.1c-.1.5-.6.9-1.1.9H4.8c-.5 0-1-.4-1.1-.9L1.5 8.2c-.2-.8.7-1.4 1.3-.9zM4.5 19.6h15c.4 0 .8.3.8.8s-.4.8-.8.8h-15c-.4 0-.8-.3-.8-.8s.4-.8.8-.8z"/></svg>';
function streakTier(n) {
  if (n >= 10) return { tier: 'crown', icon: CROWN_ICON + FLAME_ICON, label: 'Unstoppable' };
  if (n >= 5) return { tier: 'fire', icon: FLAME_ICON + FLAME_ICON, label: 'On fire' };
  if (n >= 3) return { tier: 'flame', icon: FLAME_ICON, label: '' };
  return null;
}
function streakBadge(n) {
  const t = streakTier(n);
  if (!t) return '';
  const line = t.label ? `<span class="sk-line">${t.label}</span>` : '';
  return `<span class="sk sk-${t.tier}" title="${n} correct in a row">${t.icon}<b>${n}</b>${line}</span>`;
}

const rooms = () => JSON.parse(localStorage.getItem(KEY) || '[]');
const saveRoom = (r) => {
  // Keep at most 3 leagues visible: the newest stays, the oldest drops off the list.
  const list = rooms().filter((x) => x.code !== r.code);
  list.unshift(r);
  localStorage.setItem(KEY, JSON.stringify(list));
};

// Friendly global error banner: shown on any failed request or uncaught error, never a blank screen.
function showBanner(msg) {
  let el = document.getElementById('err-banner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'err-banner';
    el.className = 'err-banner';
    el.setAttribute('role', 'alert');
    el.innerHTML = `<span class="err-msg"></span><button type="button" class="err-x" aria-label="Dismiss">×</button>`;
    el.querySelector('.err-x').onclick = () => el.remove();
    document.body.prepend(el);
  }
  el.querySelector('.err-msg').textContent = msg;
  clearTimeout(showBanner._t);
  showBanner._t = setTimeout(() => el.remove(), 8000);
}
window.addEventListener('error', () => showBanner('Something glitched on this page. Try again, your picks are safe.'));
window.addEventListener('unhandledrejection', () => showBanner('Something went wrong. Check your connection and try again.'));

async function api(path, body) {
  let res;
  try {
    res = await fetch(path, body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : undefined);
  } catch (e) {
    throw new Error('No connection. Check your internet and try again.');
  }
  let json = null;
  try { json = await res.json(); } catch (e) { json = null; }
  if (!res.ok) {
    if (res.status === 429) throw new Error(json?.error || 'Easy there, too many requests. Give it a few seconds.');
    throw new Error(json?.error || (res.status >= 500 ? 'Our server had a hiccup. Try again in a moment.' : 'Something went wrong'));
  }
  return json || {};
}

function setBadge(source, notice) {
  badge.className = `badge ${source === 'live' ? 'live' : source === 'cache' ? 'cache' : 'demo'}`;
  badge.textContent = source === 'live' ? 'Live data' : source === 'cache' ? 'Last update' : source === 'unavailable' ? 'Data offline' : 'Demo data';
  badge.title = notice || '';
  badge.classList.remove('hidden');
}

// House ads: a rotating banner at the top. Each ad slides in horizontally every 6s.
let adTimer = null;
async function loadHouseAd() {
  const el = document.getElementById('house-ad');
  if (!el) return;
  clearInterval(adTimer); adTimer = null;
  try {
    const { ads } = await fetch('/api/house-ads').then((r) => r.json());
    const list = (ads || []).filter((a) => a && (a.headline || a.image));
    if (!list.length) { el.classList.add('hidden'); el.innerHTML = ''; return; }
    const renderAd = (ad) => {
      const inner = ad.image
        ? `<img src="${esc(ad.image)}" alt="${esc(ad.alt || 'Advertisement')}" />`
        : `<div class="ad-copy"><span class="ad-kicker">${esc(ad.kicker || 'Sponsored')}</span><strong>${esc(ad.headline || '')}</strong>${ad.body ? `<span>${esc(ad.body)}</span>` : ''}</div>${ad.cta ? `<span class="ad-cta">${esc(ad.cta)}</span>` : ''}`;
      const href = String(ad.href || '');
      const external = /^https?:\/\//.test(href);
      return href
        ? `<a class="ad-link" href="${esc(href)}"${external ? ' target="_blank" rel="sponsored noopener"' : ''}>${inner}</a>`
        : `<div class="ad-body">${inner}</div>`;
    };
    if (list.length === 1) {
      el.innerHTML = `<div class="ad"><span class="ad-label">Ad</span>${renderAd(list[0])}</div>`;
      el.classList.remove('hidden');
      return;
    }
    el.innerHTML = `<div class="ad ad-carousel"><span class="ad-label">Ad</span><div class="ad-track">${list.map((a) => `<div class="ad-slide">${renderAd(a)}</div>`).join('')}</div><div class="ad-dots">${list.map((_, i) => `<i data-dot="${i}"${i === 0 ? ' class="on"' : ''}></i>`).join('')}</div></div>`;
    el.classList.remove('hidden');
    let idx = 0;
    const track = el.querySelector('.ad-track');
    const dots = el.querySelectorAll('[data-dot]');
    const go = (n) => {
      idx = (n + list.length) % list.length;
      track.style.transform = `translateX(-${idx * 100}%)`;
      dots.forEach((d, i) => d.classList.toggle('on', i === idx));
    };
    adTimer = setInterval(() => go(idx + 1), 6000);
    dots.forEach((d) => d.onclick = () => go(Number(d.dataset.dot)));
  } catch (e) {
    el.classList.add('hidden');
    el.innerHTML = '';
  }
}

// Desktop side column: compact table next to the fixtures. Only shown at desktop width via CSS.
function setSide(html) {
  const side = document.getElementById('side');
  if (!side) return;
  if (!html) { side.classList.add('hidden'); side.innerHTML = ''; return; }
  side.innerHTML = html;
  side.classList.remove('hidden');
}

async function renderSide() {
  if (!current) return setSide('');
  try {
    const { standings } = await api(`/api/rooms/${current.code}/standings`);
    const top = standings.slice(0, 6);
    const rows = top.length
      ? `<ol class="side-list">${top.map((s, i) => `<li class="${s.memberId === current.memberId ? 'me' : ''}"><span class="pos">${i + 1}</span><span class="nm">${esc(s.name)}</span><b>${s.points}</b></li>`).join('')}</ol>`
      : '<p class="muted">Nobody on the table yet.</p>';
    setSide(`<div class="card side-card">
      <div class="side-head"><h3>Table</h3><span class="muted">${esc(current.name)}</span></div>
      ${rows}
      <button class="secondary" data-side-tab="standings">Full standings</button>
    </div>`);
    const btn = document.querySelector('#side [data-side-tab]');
    if (btn) btn.onclick = () => { tab = 'standings'; renderRoom(); };
  } catch (e) { setSide(''); }
}

function home() {
  stopPoll();
  badge.classList.add('hidden');
  current = null;
  setSide('');
  const mine = rooms();
  app.innerHTML = `
    <video class="bg-video" autoplay muted loop playsinline aria-hidden="true"><source src="/bg.mp4" type="video/mp4" /></video>
    <div class="bg-veil" aria-hidden="true"></div>
    <div class="card">
      <div class="kicker">Matchday predictions</div>
      <h2>Predict the football. Settle the bragging rights.</h2>
      <p class="muted">Make a league with your friends, pick results on real fixtures, and the points update automatically when matches finish.</p>
      <div class="row">
        <button id="go-create">Create league</button>
        <button id="go-join" class="secondary">Join league</button>
      </div>
    </div>
    ${mine.length ? `<div class="card"><h3>Your leagues</h3>${mine.map((r) =>
      `<div class="league-row">
        <span>${esc(r.name)} <span class="muted">(${esc(r.code)})</span></span>
        <button data-open="${esc(r.code)}" class="secondary">Open</button>
      </div>`).join('')}</div>` : ''}
    <div class="card" id="picks-card"><h3>Today's picks</h3><p class="muted">Loading…</p></div>`;
  loadDailyPicks();
  document.getElementById('go-create').onclick = createForm;
  document.getElementById('go-join').onclick = joinForm;
  app.querySelectorAll('[data-open]').forEach((b) => b.onclick = () => {
    const r = rooms().find((x) => x.code === b.dataset.open);
    openRoom(r);
  });
}

// Today's picks: algorithmic fun-only suggestions, clearly disclaimed.
async function loadDailyPicks() {
  const card = document.getElementById('picks-card');
  if (!card) return;
  try {
    const { picks, disclaimer } = await api('/api/daily-picks');
    if (!picks.length) { card.innerHTML = "<h3>Today\u2019s picks</h3><p class=\"muted\">No matches scheduled today. Check back tomorrow.</p>"; return; }
    card.innerHTML = `
      <h3>Today's picks</h3>
      <div class="picks-disclaimer">${esc(disclaimer)}</div>
      ${picks.slice(0, 8).map((p) => {
        if (!p.pick) return '';
        const f = p.fixture;
        const when = new Date(f.kickoff).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
        return `<div class="pick-row">
          <div class="pick-main">
            <span class="pick-comp">${esc(f.competition)}</span>
            <span class="pick-game">${esc(f.home)} v ${esc(f.away)}</span>
            <span class="muted">${esc(when)}</span>
          </div>
          <div class="pick-call"><b>${esc(p.pick)}</b> <span class="conf conf-${p.confidence}">${esc(p.label)}</span></div>
        </div>`;
      }).join('')}`;
  } catch (e) {
    card.innerHTML = "<h3>Today\u2019s picks</h3><p class=\"muted\">Picks unavailable right now.</p>";
  }
}

function createForm() {
  stopPoll();
  setSide('');
  app.innerHTML = `
    <div class="card">
      <div class="kicker">New league</div>
      <h2>Create a league</h2>
      <input id="room-name" placeholder="League name (e.g. The Lads)" maxlength="40" />
      <input id="player" placeholder="Your display name" maxlength="24" />
      <p class="muted">Covers 8 leagues: Premier League, La Liga, Serie A, Bundesliga, Ligue 1, Champions League, Eredivisie, Primeira Liga.</p>
      <p class="error" id="err"></p>
      <div class="row"><button id="submit">Create</button><button class="secondary" id="back">Back</button></div>
    </div>`;
  document.getElementById('back').onclick = home;
  document.getElementById('submit').onclick = async () => {
    try {
      const name = document.getElementById('room-name').value;
      const player = document.getElementById('player').value;
      const { code, memberId } = await api('/api/rooms', { name, playerName: player });
      const room = { code, name, memberId, playerName: player };
      saveRoom(room);
      openRoom(room, true);
    } catch (e) { document.getElementById('err').textContent = e.message; }
  };
}

function joinForm() {
  stopPoll();
  setSide('');
  app.innerHTML = `
    <div class="card">
      <div class="kicker">Got a code?</div>
      <h2>Join a league</h2>
      <input id="code" placeholder="6-character code" maxlength="6" style="text-transform:uppercase" />
      <input id="player" placeholder="Your display name" maxlength="24" />
      <p class="error" id="err"></p>
      <div class="row"><button id="submit">Join</button><button class="secondary" id="back">Back</button></div>
    </div>`;
  document.getElementById('back').onclick = home;
  document.getElementById('submit').onclick = async () => {
    try {
      const code = document.getElementById('code').value.trim().toUpperCase();
      const player = document.getElementById('player').value;
      const { memberId } = await api('/api/rooms/join', { code, playerName: player });
      const room = { code, name: code, memberId, playerName: player };
      const detail = await api(`/api/rooms/${code}/fixtures`);
      room.name = detail.room.name;
      saveRoom(room);
      openRoom(room, true);
    } catch (e) { document.getElementById('err').textContent = e.message; }
  };
}

let current = null;
let tab = 'fixtures';
let lastStandings = null;
let pollTimer = null;

function stopPoll() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

async function openRoom(room, fresh = false) {
  current = room;
  if (fresh) tab = 'fixtures';
  renderRoom();
}

async function renderRoom() {
  stopPoll();
  const r = current;
  app.innerHTML = `
    <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:12px">
      <div><strong>${esc(r.name)}</strong> <span class="muted">code ${esc(r.code)}</span></div>
      <button class="secondary" id="invite-poster">Invite</button>
      <button class="secondary" id="home">Home</button>
    </div>
    <div class="tabs">
      <button data-tab="fixtures" class="${tab === 'fixtures' ? 'active' : ''}">Fixtures</button>
      <button data-tab="standings" class="${tab === 'standings' ? 'active' : ''}">Standings</button>
      <button data-tab="duels" class="${tab === 'duels' ? 'active' : ''}">Duels</button>
      <button data-tab="chat" class="${tab === 'chat' ? 'active' : ''}">Chat</button>
      <button data-tab="mine" class="${tab === 'mine' ? 'active' : ''}">My predictions</button>
    </div>
    <div id="manage"></div>
    <div id="panel"><p class="muted">Loading...</p></div>`;
  document.getElementById('home').onclick = home;
  document.getElementById('invite-poster').onclick = () => invitePoster(r);
  app.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => { tab = b.dataset.tab; renderRoom(); });
  renderSide();
  try {
    const st = await api(`/api/rooms/${r.code}/status?member=${r.memberId}`);
    if (st.status === 'pending') {
      document.getElementById('panel').innerHTML = '<div class="empty"><b>Waiting for approval</b><span>The league owner has to approve you before you can see the fixtures. Check back later.</span></div>';
      return;
    }
    if (st.isOwner) await renderManage(document.getElementById('manage'));
    if (tab === 'fixtures') await renderFixtures();
    else if (tab === 'standings') await renderStandings();
    else if (tab === 'duels') await renderDuels();
    else if (tab === 'chat') await renderChat();
    else await renderMine();
  } catch (e) {
    document.getElementById('panel').innerHTML = `<p class="error">${esc(e.message)}</p>`;
  }
}

function fmtKick(iso) {
  const d = new Date(iso);
  const local = d.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const wat = d.toLocaleString('en-GB', { timeZone: 'Africa/Lagos', hour: '2-digit', minute: '2-digit' });
  return { local, wat };
}

// Owner-only room settings: approval toggle, pending requests, and kick. Hidden for everyone else.
// It renders into its own #manage container (above #panel), so tab renders that replace #panel never wipe it.
async function renderManage(manageEl) {
  const { members } = await api(`/api/rooms/${current.code}/members?member=${current.memberId}`);
  const pending = members.filter((m) => m.status === 'pending');
  const others = members.filter((m) => !m.owner && m.status === 'active');
  const status = await api(`/api/rooms/${current.code}/status?member=${current.memberId}`);
  const row = (m, actions) => `<div class="league-row"><span>${esc(m.name)}${m.owner ? ' <span class="muted">(owner)</span>' : ''}</span><span class="row">${actions}</span></div>`;
  // innerHTML (not insertAdjacentHTML) so a repeat render replaces the card instead of stacking a second one.
  manageEl.innerHTML = `
    <div class="card room-settings">
      <div class="kicker">Room settings</div>
      <label class="toggle-row"><input type="checkbox" id="approval-toggle" ${status.approvalRequired ? 'checked' : ''} /> <span>Approval required to join</span></label>
      <p class="muted">When on, new joiners wait as pending until you approve them.</p>
      ${pending.length ? `<h3>Pending requests</h3>${pending.map((m) => row(m, `<button data-approve="${m.id}">Approve</button><button class="secondary" data-kick="${m.id}">Decline</button>`)).join('')}` : '<p class="muted">No pending requests.</p>'}
      ${others.length ? `<h3>Members</h3>${others.map((m) => row(m, `<button class="secondary" data-kick="${m.id}">Kick</button>`)).join('')}` : ''}
      <div class="danger-zone">
        <h3>Delete league</h3>
        <p class="muted">Removes this league and all its predictions, chat and standings for everyone. Cannot be undone.</p>
        <button class="danger" id="delete-league-btn">Delete league</button>
      </div>
      <p class="error" id="manage-err"></p>
    </div>`;
  const err = (msg) => { document.getElementById('manage-err').textContent = msg; };
  document.getElementById('approval-toggle').onchange = async (e) => {
    try { await api(`/api/rooms/${current.code}/settings`, { memberId: current.memberId, approvalRequired: e.target.checked }); renderRoom(); }
    catch (x) { err(x.message); }
  };
  manageEl.querySelectorAll('[data-approve]').forEach((b) => b.onclick = async () => {
    try { await api(`/api/rooms/${current.code}/approve`, { memberId: current.memberId, targetId: Number(b.dataset.approve) }); renderRoom(); }
    catch (x) { err(x.message); }
  });
  // Delete league: owner only, irreversible. Confirm first with a plain popup, then type the code.
  document.getElementById('delete-league-btn').onclick = async () => {
    if (!confirm(`Delete "${current.name || current.code}" for everyone? This cannot be undone.`)) return;
    const typed = prompt(`To confirm, type the league code: ${current.code}`);
    if (typed === null) return;
    if (typed.trim().toUpperCase() !== current.code) { err('That code does not match. Nothing was deleted.'); return; }
    try {
      await api(`/api/rooms/${current.code}/delete`, { memberId: current.memberId, confirm: current.code });
      localStorage.setItem(KEY, JSON.stringify(rooms().filter((x) => x.code !== current.code)));
      current = null;
      home();
    } catch (x) { err(x.message); }
  };
  manageEl.querySelectorAll('[data-kick]').forEach((b) => b.onclick = async () => {
    if (!confirm('Remove this member from the league? Their predictions and streak go with them.')) return;
    try { await api(`/api/rooms/${current.code}/kick`, { memberId: current.memberId, targetId: Number(b.dataset.kick) }); renderRoom(); }
    catch (x) { err(x.message); }
  });
}

// League filter for the fixtures view. The choice (a competition code, or '' for All leagues) persists in localStorage.
const LEAGUE_KEY = 'stakeless.league';
const LEAGUE_FILTER = [
  ['', 'All leagues'],
  ['PL', 'Premier League'],
  ['PD', 'La Liga'],
  ['SA', 'Serie A'],
  ['BL1', 'Bundesliga'],
  ['FL1', 'Ligue 1'],
  ['CL', 'Champions League'],
  ['DED', 'Eredivisie'],
  ['PPL', 'Primeira Liga'],
];
let fixtureData = null;
function savedLeague() {
  let v = '';
  try { v = localStorage.getItem(LEAGUE_KEY) || ''; } catch (e) { v = ''; }
  return LEAGUE_FILTER.some(([code]) => code === v) ? v : '';
}

async function renderFixtures() {
  fixtureData = await api(`/api/rooms/${current.code}/fixtures?member=${current.memberId}`);
  setBadge(fixtureData.source, fixtureData.notice);
  drawFixtures();
}

// Draws the league dropdown plus the fixture cards from the last fetch. Changing the league redraws without refetching.
function drawFixtures() {
  const { fixtures, notice, mine } = fixtureData;
  const panel = document.getElementById('panel');
  const savedPicks = new Map();
  const mineMap = new Map((mine || []).map((p) => [p.fixtureId, p]));
  if (!fixtures.length) {
    panel.innerHTML = '<div class="empty"><b>Quiet on the pitch</b><span>No fixtures this week. The fixtures always come back round, so check again closer to the weekend.</span></div>';
    return;
  }
  const league = savedLeague();
  const shown = league ? fixtures.filter((f) => f.competition === league) : fixtures;
  const leagueName = (LEAGUE_FILTER.find(([code]) => code === league) || [])[1] || '';
  const picker = `<div class="league-filter"><label for="league-filter">League</label><select id="league-filter" aria-label="Filter fixtures by league">${LEAGUE_FILTER.map(([code, name]) => `<option value="${code}"${code === league ? ' selected' : ''}>${esc(name)}</option>`).join('')}</select></div>`;
  const cards = shown.length ? shown.map((f) => {
    const { local, wat } = fmtKick(f.kickoff);
    const p = mineMap.get(f.id);
    const locked = Date.now() >= new Date(f.kickoff).getTime();
    const finished = f.status === 'FINISHED';
    const pickLabel = { H: f.home, D: 'Draw', A: f.away };
    savedPicks.set(f.id, { pick: p?.pick || null, hg: p?.hg ?? '', ag: p?.ag ?? '', savedPick: p?.pick || null, savedHg: p?.hg ?? '', savedAg: p?.ag ?? '', locked: locked || finished });
    const board = finished
      ? `<div class="fx-score" aria-label="Full time ${esc(f.homeScore)} to ${esc(f.awayScore)}">${esc(f.homeScore)}<i>-</i>${esc(f.awayScore)}</div>`
      : `<div class="fx-chip"><span>${esc(wat)}</span><small>${locked ? 'locked' : 'kick off'}</small></div>`;
    const status = locked || finished
      ? (p
        ? `<div class="fx-strip">Your pick: <b>${esc(pickLabel[p.pick])}</b>${p.hg != null ? ` (${p.hg}-${p.ag})` : ''}${p.settled ? ` · <b>${p.points} pts</b>` : ''}</div>`
        : '<div class="fx-strip muted">No prediction on this one.</div>')
      : `<div class="fx-body">
      <div class="pick-group">
        <button data-pick="H" class="${p?.pick === 'H' ? 'on' : ''}">${esc(f.home)}</button>
        <button data-pick="D" class="${p?.pick === 'D' ? 'on' : ''}">Draw</button>
        <button data-pick="A" class="${p?.pick === 'A' ? 'on' : ''}">${esc(f.away)}</button>
      </div>
      <div class="exact"><span class="muted">Exact score (optional)</span>
        <input type="number" min="0" max="20" data-hg value="${p?.hg ?? ''}" aria-label="Home goals" />
        <span>-</span>
        <input type="number" min="0" max="20" data-ag value="${p?.ag ?? ''}" aria-label="Away goals" />
      </div>
    </div>`;
    return `<div class="card fx" data-f="${esc(f.id)}">
      <div class="fx-top">
        <span class="fx-comp">${esc(f.competition)}</span>
        <span class="fx-date"><b>${esc(wat)} WAT</b> · ${esc(local)}${locked && !finished ? ' <span class="fx-lock">🔒</span>' : ''}</span>
      </div>
      <div class="fx-board">
        <div class="fx-team"><span class="fx-name">${esc(f.home)}</span></div>
        ${board}
        <div class="fx-team away"><span class="fx-name">${esc(f.away)}</span></div>
      </div>
      ${status}
    </div>`;
  }).join('') : `<div class="empty"><b>No ${esc(leagueName)} fixtures</b><span>Nothing this week for this league. Pick another league or All leagues.</span></div>`;
  panel.innerHTML = picker + (notice ? `<div class="notice">${esc(notice)}</div>` : '') + cards;
  panel.querySelector('#league-filter').onchange = (e) => {
    try { localStorage.setItem(LEAGUE_KEY, e.target.value); } catch (x) { /* private mode: still filter this session */ }
    drawFixtures();
  };
  // Sticky batch bar: selections collect locally, one tap saves everything at once.
  const bar = document.createElement('div');
  bar.className = 'pick-bar hidden';
  bar.id = 'pick-bar';
  panel.appendChild(bar);
  const refreshBar = () => {
    const changed = [...savedPicks.entries()].filter(([fid, rr]) => !rr.locked && (rr.pick !== rr.savedPick || String(rr.hg) !== String(rr.savedHg) || String(rr.ag) !== String(rr.savedAg)));
    bar.classList.toggle('hidden', !changed.length);
    bar.innerHTML = `<span>${changed.length} pick${changed.length === 1 ? '' : 's'} selected</span>
      <button id="save-all">Save all</button>
      <p class="error" id="bar-err"></p>`;
    document.getElementById('save-all').onclick = async () => {
      const err = document.getElementById('bar-err');
      const btn = document.getElementById('save-all');
      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        // Client-side mirror of the server cap: max 2 picks per league per game day (kickoff date, UTC).
        const fxById = new Map(fixtureData.fixtures.map((f) => [String(f.id), f]));
        const dayKey = (f) => new Date(f.kickoff).toISOString().slice(0, 10);
        const perKey = new Map();
        for (const [fid, rr] of savedPicks.entries()) {
          const picked = !rr.locked && (rr.pick !== rr.savedPick || String(rr.hg) !== String(rr.savedHg) || String(rr.ag) !== String(rr.savedAg))
            ? !!rr.pick
            : !!rr.savedPick;
          const f = fxById.get(String(fid));
          if (!picked || !f) continue;
          const k = `${f.competition}|${dayKey(f)}`;
          perKey.set(k, (perKey.get(k) || 0) + 1);
        }
        for (const [, n] of perKey) {
          if (n > 2) throw new Error('max 2 picks per league per day');
        }
        for (const [fid, rr] of changed) {
          if (!rr.pick) throw new Error('Pick a winner or draw for every selected game.');
          await api(`/api/rooms/${current.code}/predict`, { memberId: current.memberId, fixtureId: fid, pick: rr.pick, hg: rr.hg, ag: rr.ag });
        }
        await renderFixtures();
      } catch (e) {
        err.textContent = e.message;
        btn.disabled = false; btn.textContent = 'Save all';
      }
    };
  };
  panel.querySelectorAll('[data-f]').forEach((card) => {
    const fid = card.dataset.f;
    const row = savedPicks.get(fid);
    card.querySelectorAll('[data-pick]').forEach((b) => b.onclick = () => {
      row.pick = b.dataset.pick;
      card.querySelectorAll('[data-pick]').forEach((x) => x.classList.toggle('on', x === b));
      refreshBar();
    });
    const hg = card.querySelector('[data-hg]');
    const ag = card.querySelector('[data-ag]');
    if (hg) hg.oninput = () => { row.hg = hg.value; refreshBar(); };
    if (ag) ag.oninput = () => { row.ag = ag.value; refreshBar(); };
  });
  refreshBar();
}

async function renderStandings() {
  const { standings } = await api(`/api/rooms/${current.code}/standings`);
  lastStandings = standings;
  const rows = standings.map((s, i) => `<tr>
    <td>${i + 1}</td><td><span class="h2h-link" data-h2h="${s.memberId}" data-name="${esc(s.name)}">${esc(s.name)}${s.memberId === current.memberId ? ' (you)' : ''}</span>${s.weekLeader ? ' <span class="mvp" title="Weekly MVP">MVP</span>' : ''} ${streakBadge(s.streak)}</td>
    <td><strong>${s.points}</strong></td><td>${s.correct}</td><td>${s.exact}</td><td>${s.streak}</td><td>${s.bestStreak}</td></tr>`).join('');
  panel.querySelectorAll('[data-h2h]').forEach((el) => {
    el.onclick = async () => {
      const other = Number(el.dataset.h2h);
      if (other === current.memberId) return;
      const box = document.getElementById('h2h-box');
      box.innerHTML = '<p class="muted">Loading…</p>';
      try {
        const r = await api(`/api/rooms/${current.code}/h2h?me=${current.memberId}&other=${other}`);
        box.innerHTML = `<div class="h2h-card"><b>You ${r.me.wins} - ${r.other.wins} ${esc(r.other.name)}</b><span class="muted">${r.draws} level of ${r.games} shared games</span></div>`;
      } catch (e) { box.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
    };
  });
  const recent = standings.flatMap((s) => s.recent.map((p) => ({ name: s.name, p }))).slice(0, 10);
  document.getElementById('panel').innerHTML = `
    <div id="h2h-box"></div>
    <div class="card" style="overflow-x:auto">
      <table><thead><tr><th>#</th><th>Player</th><th>Pts</th><th>Right</th><th>Exact</th><th>Current streak</th><th>Best streak</th></tr></thead>
      <tbody>${rows}</tbody></table>
    </div>
    <div class="card share-card">
      <h3>Brag about it</h3>
      <p class="muted">Make a poster of your record to post on WhatsApp status or X.</p>
      <div class="row"><button id="share-record">Share my record</button></div>
      <div id="share-out"></div>
    </div>
    <div class="card"><h3>Recently settled</h3>${recent.length ? recent.map((x) =>
      `<div class="settled"><span>${esc(x.name)}: picked ${esc(x.p.pick)} · result ${esc(x.p.result.outcome)}</span><b>${x.p.points} pts</b></div>`).join('') : '<div class="empty"><b>Nothing settled yet</b><span>Results land here when the matches finish. Until then, everyone is still a genius.</span></div>'}</div>`;
  document.getElementById('share-record').onclick = () => makeShareCard();
}

// ---------- Weekly head-to-head duels ----------
async function renderDuels() {
  const { duels } = await api(`/api/rooms/${current.code}/duels?member=${current.memberId}`);
  const panel = document.getElementById('panel');
  const sideRow = (sd) => `<span class="duel-name">${esc(sd.name)} ${streakBadge(sd.streak || 0)}</span><b>${sd.points} pts</b>`;
  const statusText = { live: 'Live, the week is still on', won: 'You won the duel', lost: 'You lost the duel', drawn: 'Duel drawn', bye: 'Bye this week, no opponent', unpaired: 'Not paired yet' };
  const you = duels.you;
  let yourCard;
  if (!you) yourCard = '<p class="muted">Nothing to show yet.</p>';
  else if (you.bye || !you.opponent) yourCard = `<div class="duel-you"><span class="duel-status">${esc(statusText[you.status] || '')}</span><p class="muted">An odd member count leaves one player with a bye each week. You will be paired next week.</p></div>`;
  else {
    const mine = you.yourPoints, theirs = you.opponentPoints;
    const lead = mine === theirs ? 'Level on points' : mine > theirs ? 'You are ahead' : 'They are ahead';
    yourCard = `<div class="duel-you">
      <span class="duel-status ${you.status}">${esc(statusText[you.status] || '')}</span>
      <div class="duel-vs">
        <div class="duel-side me"><span class="duel-label">You</span><b class="duel-pts">${mine}</b></div>
        <span class="duel-x">vs</span>
        <div class="duel-side"><span class="duel-label">${esc(you.opponent.name)}</span><b class="duel-pts">${theirs}</b>${streakBadge(you.opponent.streak || 0)}</div>
      </div>
      <p class="muted duel-foot">${esc(lead)} · ${esc(duels.week.label)} points so far</p>
    </div>`;
  }
  const pairs = (duels.current || []).map((p) => {
    const win = p.finalized ? p.winnerId : null;
    return `<div class="duel-row${win ? ' done' : ''}"><span class="duel-who${win === p.a.id ? ' won' : ''}">${sideRow(p.a)}</span><span class="duel-x">vs</span><span class="duel-who right${win === p.b.id ? ' won' : ''}">${sideRow(p.b)}</span></div>`;
  }).join('');
  const byes = (duels.currentBye || []).map((b) => `<div class="duel-row"><span class="duel-who">${esc(b.name)}</span><span class="muted">bye</span></div>`).join('');
  const past = (duels.past || []).map((wk) => `<div class="card"><h3 style="margin-bottom:6px">${esc(wk.label)}</h3>${wk.pairs.map((p) => {
    const res = !p.finalized ? 'not final' : p.winnerId == null ? 'drawn' : `${esc((p.winnerId === p.a.id ? p.a : p.b).name)} won`;
    return `<div class="settled"><span>${esc(p.a.name)} ${p.a.points} vs ${p.b.points} ${esc(p.b.name)}</span><b>${res}</b></div>`;
  }).join('')}${wk.byes.length ? `<div class="muted">Bye: ${esc(wk.byes.join(', '))}</div>` : ''}</div>`).join('');
  const season = (duels.season || []).map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.name)}${current.memberId === r.memberId ? ' (you)' : ''}</td><td><strong>${r.w}</strong></td><td>${r.l}</td><td>${r.d}</td></tr>`).join('');
  panel.innerHTML = `
    <div class="card duel-card">
      <div class="kicker">${esc(duels.week.label)} head-to-head</div>
      <h3>Your duel</h3>
      ${yourCard}
    </div>
    <div class="card"><h3>This week's pairings</h3>${pairs || '<p class="muted">Pairings are made when the room has members.</p>'}${byes}<p class="muted duel-foot">Pairings are fixed for the whole week. Points count settled picks made inside the week.</p></div>
    <div class="card" style="overflow-x:auto"><h3>Season duel record</h3>
      <table><thead><tr><th>#</th><th>Player</th><th>W</th><th>L</th><th>D</th></tr></thead><tbody>${season || '<tr><td colspan="5">No duels yet.</td></tr>'}</tbody></table>
    </div>
    <div class="card"><h3>Past duels</h3>${past || '<div class="empty"><b>No closed duels yet</b><span>Results land here when the week ends.</span></div>'}</div>`;
}

// ---------- Room chat (polled, no websockets) ----------
async function renderChat() {
  const panel = document.getElementById('panel');
  panel.innerHTML = `
    <div class="card">
      <h3>Room chat</h3>
      <div id="chat-log" class="chat-log"><div class="empty" id="chat-empty"><b>Dead quiet</b><span>No messages yet. Post your bold prediction and let the room argue with it.</span></div></div>
      <form id="chat-form" class="chat-form">
        <button id="emoji-toggle" type="button" class="chat-circle" title="Emoji" aria-label="Emoji picker">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zM8.5 11a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zm7 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM12 17.5c2.3 0 4.2-1.5 4.8-3.5H7.2c.6 2 2.5 3.5 4.8 3.5z"/></svg>
        </button>
        <button id="chat-mic" type="button" class="chat-circle" title="Record a voice note (30s max)" aria-label="Voice note">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 15a3.5 3.5 0 0 0 3.5-3.5v-5a3.5 3.5 0 1 0-7 0v5A3.5 3.5 0 0 0 12 15zm5.5-3.5a5.5 5.5 0 0 1-4.75 5.45V20h2.25a.75.75 0 0 1 0 1.5h-6a.75.75 0 0 1 0-1.5h2.25v-3.05A5.5 5.5 0 0 1 6.5 11.5a.75.75 0 0 1 1.5 0 4 4 0 1 0 8 0 4 4 0 0 1 .01-.08.75.75 0 0 1 1.49.08z"/></svg>
        </button>
        <textarea id="chat-input" rows="1" maxlength="280" placeholder="Message" autocomplete="off"></textarea>
        <button id="chat-send" type="submit" class="chat-circle chat-send" aria-label="Send">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M3.4 20.4 20.85 12 3.4 3.6l-.01 6.53L14 12 3.39 13.87z"/></svg>
        </button>
        <div id="emoji-pop" class="emoji-pop hidden" aria-label="Pick an emoji"></div>
      </form>
      <p class="error" id="chat-err"></p>
    </div>`;
  const log = document.getElementById('chat-log');
  let lastId = 0;
  let busy = false;

  // Multi-line input: grows downward line by line up to ~6 lines, then scrolls inside the box.
  const chatInput = document.getElementById('chat-input');
  const fitInput = () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight + 2, 140) + 'px';
  };
  chatInput.addEventListener('input', fitInput);
  // Desktop: Enter sends, Shift+Enter adds a new line. Touch keyboards: Enter adds a new line.
  chatInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing && window.matchMedia('(pointer: fine)').matches) {
      ev.preventDefault();
      document.getElementById('chat-form').requestSubmit();
    }
  });

  // Emoji picker: smiley icon opens a small dropdown above the input, like WhatsApp.
  const EMOJIS = ['🔥','😂','😭','👀','🐐','⚽','💪','🥶','💀','🤝','😤','🎯','🥳','🤡','🤐','🚀'];
  const epop = document.getElementById('emoji-pop');
  epop.innerHTML = EMOJIS.map((e) => `<button type="button" class="emoji-btn" data-e="${e}">${e}</button>`).join('');
  document.getElementById('emoji-toggle').onclick = (ev) => {
    ev.stopPropagation();
    epop.classList.toggle('hidden');
  };
  epop.onclick = (ev) => {
    const btn = ev.target.closest('.emoji-btn');
    if (!btn) return;
    const input = document.getElementById('chat-input');
    if ((input.value + btn.dataset.e).length <= 280) input.value += btn.dataset.e;
    input.dispatchEvent(new Event('input'));
    input.focus();
  };
  document.addEventListener('click', (ev) => {
    if (!epop.classList.contains('hidden') && !ev.target.closest('.emoji-wrap')) epop.classList.add('hidden');
  });

  const append = (messages) => {
    if (!messages.length) return;
    const empty = document.getElementById('chat-empty');
    if (empty) empty.remove();
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
    for (const m of messages) {
      const mine = m.memberId === current.memberId;
      const t = new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const div = document.createElement('div');
      div.className = `chat-msg${mine ? ' me' : ''}${m.system ? ' system' : ''}`;
      const bodyHtml = m.audio
        ? `${m.text ? `<div>${esc(m.text)}</div>` : ''}<audio class="chat-audio" controls preload="metadata" src="/api/rooms/${esc(current.code)}/audio/${esc(m.audio.id)}?member=${current.memberId}" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'chat-audio-missing',textContent:'voice note unavailable'}))"></audio>`
        : `<div>${esc(m.text)}</div>`;
      div.innerHTML = `<div class="chat-meta"><strong>${esc(m.name)}</strong> ${streakBadge(m.streak || 0)} · ${esc(t)}</div>${bodyHtml}`;
      log.appendChild(div);
      lastId = Math.max(lastId, m.id);
    }
    if (atBottom || messages.some((m) => m.memberId === current.memberId)) log.scrollTop = log.scrollHeight;
  };

  const pull = async () => {
    if (busy || tab !== 'chat' || !document.getElementById('chat-log')) return;
    busy = true;
    try {
      const { messages } = await api(`/api/rooms/${current.code}/chat?since=${lastId}`);
      if (tab === 'chat' && document.getElementById('chat-log')) append(messages);
    } catch (e) { /* transient, next poll retries */ }
    busy = false;
  };

  await pull();
  log.scrollTop = log.scrollHeight;
  stopPoll();
  pollTimer = setInterval(pull, 4000);

  // Voice notes: MediaRecorder, 30s cap, sent as base64 with the message.
  let recorder = null; let recChunks = []; let recTimer = null;
  const micBtn = document.getElementById('chat-mic');
  micBtn.onclick = async () => {
    const err = document.getElementById('chat-err');
    if (recorder && recorder.state === 'recording') { recorder.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recChunks = [];
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '';
      recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recorder.ondataavailable = (e) => { if (e.data.size) recChunks.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        clearTimeout(recTimer);
        micBtn.classList.remove('recording');
        const blob = new Blob(recChunks, { type: recorder.mimeType || 'audio/webm' });
        if (blob.size < 800) { err.textContent = 'Hold the mic a bit longer.'; return; }
        const reader = new FileReader();
        reader.onload = async () => {
          const b64 = String(reader.result).split(',')[1];
          const input = document.getElementById('chat-input');
          const text = input.value.trim();
          try {
            input.value = ''; input.dispatchEvent(new Event('input'));
            await api(`/api/rooms/${current.code}/chat`, { memberId: current.memberId, text, audioBase64: b64, audioMime: (recorder.mimeType || 'audio/webm').split(';')[0] });
            await pull();
          } catch (e) { input.value = text; input.dispatchEvent(new Event('input')); err.textContent = e.message; }
        };
        reader.readAsDataURL(blob);
      };
      recorder.start();
      micBtn.classList.add('recording');
      recTimer = setTimeout(() => { if (recorder && recorder.state === 'recording') recorder.stop(); }, 30000);
      err.textContent = '';
    } catch (e) {
      err.textContent = 'Microphone blocked, allow it in ur browser settings.';
    }
  };

  document.getElementById('chat-form').onsubmit = async (ev) => {
    ev.preventDefault();
    const input = document.getElementById('chat-input');
    const err = document.getElementById('chat-err');
    const text = input.value.trim();
    if (!text) return;
    err.textContent = '';
    try {
      input.value = ''; input.dispatchEvent(new Event('input'));
      await api(`/api/rooms/${current.code}/chat`, { memberId: current.memberId, text });
      await pull();
    } catch (e) {
      input.value = text; input.dispatchEvent(new Event('input'));
      err.textContent = e.message;
    }
  };
}


// ---------- Invite poster: shareable image with the league code big and centered ----------
function invitePoster(room) {
  const W = 1080, H = 1080;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#0b1020');
  grad.addColorStop(1, '#151d33');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  // pitch ring decoration
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(W / 2, H / 2, 420, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(W / 2, H / 2, 330, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#f1f5ff';
  ctx.textAlign = 'center';
  ctx.font = '800 64px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.fillText('StakeLess', W / 2, 200);
  ctx.fillStyle = '#aab3c5';
  ctx.font = '500 40px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.fillText(`${room.name} - predict. settle. brag.`, W / 2, 270);
  ctx.fillStyle = '#ffc94d';
  ctx.font = '900 190px "Barlow Condensed", system-ui, sans-serif';
  ctx.fillText(room.code.split('').join(' '), W / 2, 600);
  ctx.fillStyle = '#f1f5ff';
  ctx.font = '600 44px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.fillText('join with this code', W / 2, 700);
  ctx.fillStyle = '#aab3c5';
  ctx.font = '400 34px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.fillText('stakeless-7ido.onrender.com', W / 2, 780);
  ctx.fillText('free to play. no money involved.', W / 2, 950);
  c.toBlob((blob) => {
    const file = new File([blob], `stakeless-invite-${room.code}.png`, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: `Join ${room.name} on StakeLess`, text: `Join my league, code ${room.code}` }).catch(() => {});
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `stakeless-invite-${room.code}.png`;
      a.click();
    }
  });
}

// ---------- Share card: square PNG poster drawn on canvas ----------
const SIZE = 1080;

function fitText(ctx, text, maxWidth) {
  let t = String(text);
  if (ctx.measureText(t).width <= maxWidth) return t;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
  return t + '…';
}

function drawStakelessLogo(ctx, x, y, r) {
  ctx.save();
  ctx.strokeStyle = '#00e676';
  ctx.lineWidth = r * 0.12;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  // simple pentagon "ball" in the centre
  ctx.fillStyle = '#00e676';
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    const px = x + Math.cos(a) * r * 0.42;
    const py = y + Math.sin(a) * r * 0.42;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}


// ---------- Video poster: records the poster canvas while the user's video plays behind ----------
// Exports a .webm (plays on WhatsApp, Telegram, X DMs). Capped at 40s or the video length.
async function makeVideoPoster(s, leagueName) {
  const out = document.getElementById('share-out');
  const status = document.getElementById('bg-status');
  if (!posterVideoFile) return;
  const maxLen = 40;
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.src = URL.createObjectURL(posterVideoFile);
  try {
    await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('video failed to load')); setTimeout(rej, 10000); });
  } catch (e) { if (status) status.textContent = "Couldn't read that video."; return; }
  const dur = Math.min(isFinite(v.duration) && v.duration > 0 ? v.duration : maxLen, maxLen);
  const c = document.createElement('canvas');
  c.width = SIZE; c.height = SIZE;
  const ctx = c.getContext('2d');
  const drawFrame = () => {
    // video cover-fit behind
    const vw = v.videoWidth || SIZE, vh = v.videoHeight || SIZE;
    const scale = Math.max(SIZE / vw, SIZE / vh);
    const dw = vw * scale, dh = vh * scale;
    ctx.drawImage(v, (SIZE - dw) / 2, (SIZE - dh) / 2, dw, dh);
    ctx.fillStyle = 'rgba(8,12,24,0.55)';
    ctx.fillRect(0, 0, SIZE, SIZE);
    // poster content on top, using the normal renderer minus its own background
    const content = renderPosterContent(s, leagueName);
    ctx.drawImage(content, 0, 0);
  };
  drawFrame();
  if (!('MediaRecorder' in window) || !c.captureStream) { if (status) status.textContent = 'This browser cannot record video posters. Try Chrome on Android or desktop.'; return; }
  const stream = c.captureStream(30);
  // iPhone Safari records mp4, Chrome/Firefox record webm. Pick whatever actually works.
  const candidates = ['video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
  const mime = candidates.find((m) => { try { return MediaRecorder.isTypeSupported(m); } catch { return false; } });
  if (!mime) { if (status) status.textContent = 'This browser cannot record video posters. Try Chrome.'; return; }
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4000000 });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  rec.onstop = () => {
    v.pause();
    URL.revokeObjectURL(v.src);
    const blob = new Blob(chunks, { type: 'video/webm' });
    const ext = mime.includes('mp4') ? 'mp4' : 'webm';
    const file = new File([blob], `stakeless-${current.code}-${s.position}.${ext}`, { type: mime.split(';')[0] });
    const url = URL.createObjectURL(blob);
    const prev = document.querySelector('.share-preview');
    if (prev) prev.innerHTML = `<video src="${url}" controls autoplay loop muted playsinline style="display:block;width:100%"></video>`;
    const canShareFile = navigator.canShare && navigator.canShare({ files: [file] });
    const row = document.createElement('div');
    row.className = 'row share-actions';
    row.innerHTML = `<a class="share-btn" href="${url}" download="${esc(file.name)}">Download video</a>${canShareFile ? '<button class="secondary" id="native-video-share">Share</button>' : ''}`;
    out.querySelector('.share-socials').before(row);
    const nvs = document.getElementById('native-video-share');
    if (nvs) nvs.onclick = () => navigator.share({ files: [file], title: 'My StakeLess record' }).catch(() => {});
    if (status) status.textContent = `Video poster ready (${Math.round(dur)}s).`;
  };
  v.loop = true;
  await v.play();
  rec.start();
  if (status) status.textContent = 'Recording your video poster... keep this tab open.';
  const tick = () => { if (!rec || rec.state !== 'recording') return; drawFrame(); requestAnimationFrame(tick); };
  tick();
  const stopTimer = setTimeout(() => { try { if (rec.state === 'recording') rec.stop(); } catch {} }, dur * 1000);
  rec.onerror = () => { clearTimeout(stopTimer); if (status) status.textContent = 'Recording failed. Try a shorter video.'; };
}

// ---------- Poster backgrounds: custom image, video frame, or built-in preset ----------
// null = default dark matchday theme. Otherwise a canvas drawn full-bleed under a dark overlay.
let posterBg = null;
let posterBgLabel = '';
let posterVideoFile = null;

function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      resolve(c);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image')); };
    img.src = url;
  });
}

// Grabs a still frame ~1s in (or mid-clip for very short videos). Not a live video poster.
function captureVideoFrame(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    let timer = null;
    const finish = (fn, val) => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      v.removeAttribute('src');
      v.load();
      fn(val);
    };
    timer = setTimeout(() => finish(reject, new Error('timeout')), 10000);
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.onerror = () => finish(reject, new Error('video'));
    v.onloadeddata = () => {
      const d = isFinite(v.duration) && v.duration > 0 ? v.duration : 1;
      v.currentTime = Math.min(1, d / 2);
    };
    v.onseeked = () => {
      if (!v.videoWidth || !v.videoHeight) return finish(reject, new Error('no frame'));
      const c = document.createElement('canvas');
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      c.getContext('2d').drawImage(v, 0, 0);
      finish(resolve, c);
    };
    v.src = url;
  });
}

const BG_PRESETS = {
  pitch: 'Pitch green',
  night: 'Night blue',
  ember: 'Ember',
  neon: 'Neon',
};

function presetCanvas(id) {
  const W = SIZE;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = W;
  const ctx = c.getContext('2d');
  const glow = (x, y, r, color) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, W);
  };
  if (id === 'pitch') {
    const g = ctx.createLinearGradient(0, 0, 0, W);
    g.addColorStop(0, '#0f5a3a');
    g.addColorStop(1, '#063522');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, W);
    ctx.fillStyle = 'rgba(0,0,0,0.07)';
    for (let i = 0; i < 8; i += 2) ctx.fillRect(0, (i * W) / 8, W, W / 8);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(0, W / 2);
    ctx.lineTo(W, W / 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(W / 2, W / 2, 230, 0, Math.PI * 2);
    ctx.stroke();
  } else if (id === 'night') {
    const g = ctx.createLinearGradient(0, 0, W, W);
    g.addColorStop(0, '#0b1f4d');
    g.addColorStop(1, '#1d2f7a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, W);
    glow(W, 0, 800, 'rgba(120,160,255,0.35)');
  } else if (id === 'ember') {
    const g = ctx.createLinearGradient(0, 0, W, W);
    g.addColorStop(0, '#5a1d0c');
    g.addColorStop(1, '#1a0a06');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, W);
    glow(W, W, 800, 'rgba(255,122,46,0.45)');
  } else {
    const g = ctx.createLinearGradient(0, 0, W, W);
    g.addColorStop(0, '#2a0f4a');
    g.addColorStop(1, '#0b0620');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, W);
    glow(0, 0, 800, 'rgba(255,60,200,0.35)');
    glow(W, W, 800, 'rgba(0,220,255,0.3)');
  }
  return c;
}

// Cover-fit the source to the poster, then a dark gradient so the stats stay readable.
function drawPosterBackground(ctx, W, src) {
  const scale = Math.max(W / src.width, W / src.height);
  const dw = src.width * scale;
  const dh = src.height * scale;
  ctx.drawImage(src, (W - dw) / 2, (W - dh) / 2, dw, dh);
  const shade = ctx.createLinearGradient(0, 0, 0, W);
  shade.addColorStop(0, 'rgba(11,15,26,0.55)');
  shade.addColorStop(0.45, 'rgba(11,15,26,0.72)');
  shade.addColorStop(1, 'rgba(11,15,26,0.92)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, W, W);
}

function renderPoster(s, leagueName) {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  const W = SIZE;
  const pad = 80;

  if (posterBg) {
    drawPosterBackground(ctx, W, posterBg);
  } else {
  // background: dark matchday gradient with green and blue glows
  const bg = ctx.createLinearGradient(0, 0, W, W);
  bg.addColorStop(0, '#0b0f1a');
  bg.addColorStop(1, '#111827');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, W);
  const g1 = ctx.createRadialGradient(0, 0, 0, 0, 0, 700);
  g1.addColorStop(0, 'rgba(0,230,118,0.22)');
  g1.addColorStop(1, 'rgba(0,230,118,0)');
  ctx.fillStyle = g1;
  ctx.fillRect(0, 0, W, W);
  const g2 = ctx.createRadialGradient(W, 0, 0, W, 0, 700);
  g2.addColorStop(0, 'rgba(90,120,255,0.22)');
  g2.addColorStop(1, 'rgba(90,120,255,0)');
  ctx.fillStyle = g2;
  ctx.fillRect(0, 0, W, W);
  }

  // header: logo + wordmark + tagline
  drawStakelessLogo(ctx, pad + 36, pad + 36, 36);
  ctx.fillStyle = '#f1f5ff';
  ctx.font = '800 52px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText('StakeLess', pad + 92, pad + 36);
  ctx.fillStyle = '#8a96b3';
  ctx.font = '600 24px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.fillText('PREDICT. SETTLE. BRAG.', pad, pad + 110);

  // league name
  ctx.fillStyle = '#8a96b3';
  ctx.font = '700 26px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('LEAGUE', pad, 330);
  ctx.fillStyle = '#f1f5ff';
  ctx.font = '800 60px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.fillText(fitText(ctx, leagueName, W - pad * 2), pad, 400);

  // player name
  ctx.fillStyle = '#8a96b3';
  ctx.font = '700 26px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.fillText('PLAYER', pad, 480);
  const sTier = streakTier(s.streak || 0);
  if (sTier) {
    const label = sTier.tier === 'crown' ? `UNSTOPPABLE ${s.streak} IN A ROW` : sTier.tier === 'fire' ? `ON FIRE ${s.streak} IN A ROW` : `${s.streak} IN A ROW`;
    ctx.font = '800 26px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    const tw = ctx.measureText(label).width;
    const bx = pad + ctx.measureText('PLAYER').width + 30;
    ctx.fillStyle = sTier.tier === 'crown' ? 'rgba(255,201,77,0.2)' : 'rgba(255,120,40,0.2)';
    roundRect(ctx, bx, 452, tw + 52, 42, 21);
    ctx.fill();
    ctx.fillStyle = sTier.tier === 'crown' ? '#ffc94d' : '#ff9f43';
    ctx.fillText(label, bx + 26, 482);
    drawStreakIcon(ctx, sTier.tier, bx + 8, 452);
  }
  ctx.fillStyle = '#f1f5ff';
  ctx.font = '800 84px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.fillText(fitText(ctx, s.name, W - pad * 2), pad, 570);

  // position and points
  const total = lastStandings ? lastStandings.length : 1;
  ctx.fillStyle = '#00e676';
  ctx.font = '900 200px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.fillText(`#${s.position}`, pad, 790);
  const posW = ctx.measureText(`#${s.position}`).width;
  ctx.fillStyle = '#8a96b3';
  ctx.font = '700 26px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.fillText(`of ${total} in the league`, pad, 840);

  ctx.fillStyle = '#ffc94d';
  ctx.font = '900 140px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  const ptsText = String(s.points);
  const ptsX = Math.max(pad + posW + 90, W - pad - ctx.measureText(ptsText).width);
  ctx.fillText(ptsText, ptsX, 780);
  ctx.fillStyle = '#8a96b3';
  ctx.font = '700 26px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.fillText('POINTS', ptsX, 830);

  // record boxes: season and this week
  const boxY = 880;
  const boxH = 110;
  const boxW = (W - pad * 2 - 24) / 2;
  const boxes = [
    { label: 'SEASON W-L', value: `${s.correct}-${s.settled - s.correct}` },
    { label: 'THIS WEEK W-L', value: `${s.week.won}-${s.week.lost} · ${s.week.points} pts` },
  ];
  boxes.forEach((b, i) => {
    const x = pad + i * (boxW + 24);
    ctx.fillStyle = 'rgba(29,39,64,0.9)';
    roundRect(ctx, x, boxY, boxW, boxH, 18);
    ctx.fill();
    ctx.fillStyle = '#8a96b3';
    ctx.font = '700 20px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.fillText(b.label, x + 22, boxY + 36);
    ctx.fillStyle = '#f1f5ff';
    ctx.font = '800 40px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.fillText(fitText(ctx, b.value, boxW - 44), x + 22, boxY + 84);
  });

  // congrats line for the weekly leader (sits above the footer, below the record boxes)
  if (s.weekLeader) {
    ctx.fillStyle = '#ffc94d';
    ctx.font = '800 30px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.fillText(fitText(ctx, 'Weekly leader. Congrats!', W - pad * 2), pad, 1020);
  }

  // footer
  ctx.fillStyle = '#5b6684';
  ctx.font = '600 22px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.fillText('free to play. points and bragging rights only.', pad, 1070);
  return canvas;
}
function renderPosterContent(s, leagueName) {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  const W = SIZE;
  const pad = 80;


  // header: logo + wordmark + tagline
  drawStakelessLogo(ctx, pad + 36, pad + 36, 36);
  ctx.fillStyle = '#f1f5ff';
  ctx.font = '800 52px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText('StakeLess', pad + 92, pad + 36);
  ctx.fillStyle = '#8a96b3';
  ctx.font = '600 24px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.fillText('PREDICT. SETTLE. BRAG.', pad, pad + 110);

  // league name
  ctx.fillStyle = '#8a96b3';
  ctx.font = '700 26px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('LEAGUE', pad, 330);
  ctx.fillStyle = '#f1f5ff';
  ctx.font = '800 60px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.fillText(fitText(ctx, leagueName, W - pad * 2), pad, 400);

  // player name
  ctx.fillStyle = '#8a96b3';
  ctx.font = '700 26px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.fillText('PLAYER', pad, 480);
  const sTier = streakTier(s.streak || 0);
  if (sTier) {
    const label = sTier.tier === 'crown' ? `UNSTOPPABLE ${s.streak} IN A ROW` : sTier.tier === 'fire' ? `ON FIRE ${s.streak} IN A ROW` : `${s.streak} IN A ROW`;
    ctx.font = '800 26px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    const tw = ctx.measureText(label).width;
    const bx = pad + ctx.measureText('PLAYER').width + 30;
    ctx.fillStyle = sTier.tier === 'crown' ? 'rgba(255,201,77,0.2)' : 'rgba(255,120,40,0.2)';
    roundRect(ctx, bx, 452, tw + 52, 42, 21);
    ctx.fill();
    ctx.fillStyle = sTier.tier === 'crown' ? '#ffc94d' : '#ff9f43';
    ctx.fillText(label, bx + 26, 482);
    drawStreakIcon(ctx, sTier.tier, bx + 8, 452);
  }
  ctx.fillStyle = '#f1f5ff';
  ctx.font = '800 84px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.fillText(fitText(ctx, s.name, W - pad * 2), pad, 570);

  // position and points
  const total = lastStandings ? lastStandings.length : 1;
  ctx.fillStyle = '#00e676';
  ctx.font = '900 200px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.fillText(`#${s.position}`, pad, 790);
  const posW = ctx.measureText(`#${s.position}`).width;
  ctx.fillStyle = '#8a96b3';
  ctx.font = '700 26px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.fillText(`of ${total} in the league`, pad, 840);

  ctx.fillStyle = '#ffc94d';
  ctx.font = '900 140px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  const ptsText = String(s.points);
  const ptsX = Math.max(pad + posW + 90, W - pad - ctx.measureText(ptsText).width);
  ctx.fillText(ptsText, ptsX, 780);
  ctx.fillStyle = '#8a96b3';
  ctx.font = '700 26px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.fillText('POINTS', ptsX, 830);

  // record boxes: season and this week
  const boxY = 880;
  const boxH = 110;
  const boxW = (W - pad * 2 - 24) / 2;
  const boxes = [
    { label: 'SEASON W-L', value: `${s.correct}-${s.settled - s.correct}` },
    { label: 'THIS WEEK W-L', value: `${s.week.won}-${s.week.lost} · ${s.week.points} pts` },
  ];
  boxes.forEach((b, i) => {
    const x = pad + i * (boxW + 24);
    ctx.fillStyle = 'rgba(29,39,64,0.9)';
    roundRect(ctx, x, boxY, boxW, boxH, 18);
    ctx.fill();
    ctx.fillStyle = '#8a96b3';
    ctx.font = '700 20px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.fillText(b.label, x + 22, boxY + 36);
    ctx.fillStyle = '#f1f5ff';
    ctx.font = '800 40px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.fillText(fitText(ctx, b.value, boxW - 44), x + 22, boxY + 84);
  });

  // congrats line for the weekly leader (sits above the footer, below the record boxes)
  if (s.weekLeader) {
    ctx.fillStyle = '#ffc94d';
    ctx.font = '800 30px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.fillText(fitText(ctx, 'Weekly leader. Congrats!', W - pad * 2), pad, 1020);
  }

  // footer
  ctx.fillStyle = '#5b6684';
  ctx.font = '600 22px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.fillText('free to play. points and bragging rights only.', pad, 1070);
  return canvas;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

let appUrlCache = null;
async function getAppUrl() {
  if (appUrlCache) return appUrlCache;
  try {
    const cfg = await fetch('/api/share-config').then((r) => r.json());
    appUrlCache = (cfg.appUrl || '').trim() || window.location.origin;
  } catch (e) {
    appUrlCache = window.location.origin;
  }
  return appUrlCache;
}

// Short brag line for X / WhatsApp / Facebook. Kept under 200 chars.
function buildCaption(s, roomName, appUrl) {
  const room = String(roomName || 'league');
  const pts = s.week ? s.week.points : 0;
  let text = `I'm #${s.position} in the ${room} room on StakeLess, ${pts} pts this week 🔥 Predict with us: ${appUrl}`;
  if (text.length > 200) {
    const short = room.slice(0, Math.max(3, room.length - (text.length - 200) - 1));
    text = `I'm #${s.position} in the ${short}… room on StakeLess, ${pts} pts this week 🔥 Predict with us: ${appUrl}`;
  }
  return text;
}

async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) { /* fall through */ }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  document.body.removeChild(ta);
  return ok;
}

let lastShareRow = null;
async function makeShareCard() {
  const out = document.getElementById('share-out');
  const me = (lastStandings || []).findIndex((x) => x.memberId === current.memberId);
  if (me < 0) { out.innerHTML = '<p class="error">Could not find your standing yet.</p>'; return; }
  const s = { ...lastStandings[me], position: me + 1 };
  lastShareRow = s;
  const appUrl = await getAppUrl();
  const caption = buildCaption(s, current.name, appUrl);
  const enc = encodeURIComponent;
  const xUrl = `https://twitter.com/intent/tweet?text=${enc(caption)}`;
  const waUrl = `https://wa.me/?text=${enc(caption)}`;
  const fbUrl = `https://www.facebook.com/sharer/sharer.php?u=${enc(appUrl)}&quote=${enc(caption)}`;
  const canvas = renderPoster(s, current.name);
  canvas.toBlob((blob) => {
    if (!blob) { out.innerHTML = '<p class="error">Could not make the image.</p>'; return; }
    const url = URL.createObjectURL(blob);
    const file = new File([blob], `stakeless-${current.code}-${s.position}.png`, { type: 'image/png' });
    const canShareFile = navigator.canShare && navigator.canShare({ files: [file] });
    out.innerHTML = `
      <div class="share-preview"><img src="${url}" alt="Your StakeLess record poster" /></div>
      <div class="row share-actions">
        <a class="share-btn" href="${url}" download="${esc(file.name)}">Download PNG</a>
        <button class="secondary" id="add-bg">Add background</button>
        ${posterVideoFile ? '<button class="secondary" id="video-poster">Make video poster</button>' : ''}
        <button class="secondary" id="reset-bg">Reset</button>
        ${canShareFile ? '<button class="secondary" id="native-share">Share</button>' : ''}
      </div>
      <div class="row share-actions">
        <button class="secondary" data-bg-preset="pitch">Pitch green</button>
        <button class="secondary" data-bg-preset="night">Night blue</button>
        <button class="secondary" data-bg-preset="ember">Ember</button>
        <button class="secondary" data-bg-preset="neon">Neon</button>
      </div>
      <input type="file" id="bg-file" accept="image/*,video/*" hidden />
      <p class="share-hint muted" id="bg-status">${posterBgLabel ? `Background: ${esc(posterBgLabel)}.` : 'Default dark theme.'} Pick a video, then Make video poster exports it as a real video (up to 40s).</p>
      <div class="share-socials">
        <a class="share-btn social x" href="${xUrl}" target="_blank" rel="noopener">Post on X</a>
        <a class="share-btn social wa" href="${waUrl}" target="_blank" rel="noopener">Share on WhatsApp</a>
        <a class="share-btn social fb" href="${fbUrl}" target="_blank" rel="noopener">Share on Facebook</a>
        <button class="secondary" id="copy-caption">Copy caption</button>
      </div>
      <p class="share-caption muted">${esc(caption)}</p>
      <p class="share-hint muted">IG/TikTok: download the poster, then upload it</p>`;
    bindBgControls();
    const ns = document.getElementById('native-share');
    if (ns) ns.onclick = () => navigator.share({ files: [file], title: 'My StakeLess record', text: caption }).catch(() => {});
    const cc = document.getElementById('copy-caption');
    if (cc) cc.onclick = async () => {
      const ok = await copyText(caption);
      cc.textContent = ok ? 'Copied!' : 'Copy failed';
      setTimeout(() => { cc.textContent = 'Copy caption'; }, 1800);
    };
  }, 'image/png');
}

function setBgStatus(text) {
  const el = document.getElementById('bg-status');
  if (el) el.textContent = text;
}

function bindBgControls() {
  const fileInput = document.getElementById('bg-file');
  const addBtn = document.getElementById('add-bg');
  if (addBtn && fileInput) addBtn.onclick = () => fileInput.click();
  if (fileInput) fileInput.onchange = async () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;
    const isVideo = f.type.startsWith('video/');
    setBgStatus(isVideo ? 'Loading your video...' : 'Loading your image...');
    try {
      posterVideoFile = isVideo ? f : null;
      posterBg = isVideo ? await captureVideoFrame(f) : await loadImageFile(f);
      posterBgLabel = isVideo ? 'your video' : 'your image';
    } catch (e) {
      setBgStatus("Couldn't read that file. Try a JPG, PNG, or a short MP4.");
      return;
    }
    fileInput.value = '';
    makeShareCard();
  };
  document.querySelectorAll('[data-bg-preset]').forEach((b) => {
    b.onclick = () => {
      const id = b.dataset.bgPreset;
      posterBg = presetCanvas(id);
      posterBgLabel = BG_PRESETS[id] || 'preset';
      makeShareCard();
    };
  });
  const resetBtn = document.getElementById('reset-bg');
  if (resetBtn) resetBtn.onclick = () => {
    posterBg = null;
    posterBgLabel = '';
    posterVideoFile = null;
    makeShareCard();
  };
  const vp = document.getElementById('video-poster');
  if (vp) vp.onclick = async () => {
    try { await makeVideoPoster(lastShareRow, current.name); }
    catch (e) { const st = document.getElementById('bg-status'); if (st) st.textContent = 'Could not make the video: ' + e.message; }
  };
}

async function renderMine() {
  const { mine, fixtures, source } = await api(`/api/rooms/${current.code}/fixtures?member=${current.memberId}`);
  setBadge(source);
  const byId = new Map(fixtures.map((f) => [f.id, f]));
  const panel = document.getElementById('panel');
  if (!mine.length) { panel.innerHTML = '<div class="empty"><b>No picks yet</b><span>Head to Fixtures and make your first call. Future you will want the receipts.</span></div>'; return; }
  panel.innerHTML = mine.map((p) => {
    const f = byId.get(p.fixtureId);
    const label = f ? `${esc(f.home)} vs ${esc(f.away)}` : esc(p.fixtureId);
    const status = p.settled ? `settled · ${p.points} pts` : (f && Date.now() >= new Date(f.kickoff).getTime() ? 'locked' : 'pending');
    return `<div class="card"><h3 style="margin-bottom:4px">${label}</h3><div class="muted">pick ${esc(p.pick)}${p.hg != null ? ` (${p.hg}-${p.ag})` : ''} · ${status}</div></div>`;
  }).join('');
}

loadHouseAd();
home();
