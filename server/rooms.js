// Rooms, predictions, settlement, standings, streaks, weekly duels, chat, and room privacy.
import { data, save, nextId } from './store.js';
import { LEAGUES } from './config.js';
import * as cloud from './cloudsync.js';
import { getFixtures } from './football.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const POINTS_OUTCOME = 3;
const POINTS_EXACT_BONUS = 2;
const LOCK_SECONDS = 0;
const NAME_MAX = 24;
const ROOM_NAME_MAX = 40;
const CHAT_MAX = 300;
const CHAT_TEXT_MAX = 280;

export function makeCode() {
  let code;
  do {
    code = Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  } while (data().rooms[code]);
  return code;
}

const cleanName = (s, max) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);
const memberStatus = (m) => m.status || 'active';
const ownerId = (room) => room.ownerId ?? room.members[0]?.id;

// Duplicate display names in one room get " (2)", " (3)", ... so every player keeps their own identity.
function uniqueName(room, name) {
  const taken = new Set(room.members.map((m) => m.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let n = 2; ; n++) {
    const suffix = ` (${n})`;
    const candidate = `${name.slice(0, NAME_MAX - suffix.length)}${suffix}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

export function createRoom({ name, playerName }) {
  const roomName = cleanName(name, ROOM_NAME_MAX);
  const player = cleanName(playerName, NAME_MAX);
  if (!roomName || !player) throw new Error('Room name and your name are required.');
  const code = makeCode();
  const me = { id: nextId(), name: player, status: 'active' };
  data().rooms[code] = {
    code,
    name: roomName,
    competitions: LEAGUES.map((l) => l.code),
    createdAt: new Date().toISOString(),
    ownerId: me.id,
    approvalRequired: false,
    members: [me],
  };
  save();
  return { code, memberId: me.id };
}

// Open-join is the default. With approvalRequired the new member starts as "pending" until the owner approves.
export function joinRoom({ code, playerName }) {
  const room = data().rooms[String(code || '').trim().toUpperCase()];
  if (!room) throw new Error('No league found with that code.');
  const name = cleanName(playerName, NAME_MAX);
  if (!name) throw new Error('Enter your name.');
  const pending = !!room.approvalRequired;
  const me = { id: nextId(), name: uniqueName(room, name), status: pending ? 'pending' : 'active' };
  room.members.push(me);
  save();
  return { code: room.code, memberId: me.id, name: me.name, roomName: room.name, pending };
}

export function getRoom(code) {
  const room = data().rooms[code];
  if (!room) throw new Error('League not found.');
  return room;
}

function findMember(room, memberId) {
  const id = Number(memberId);
  return room.members.find((m) => m.id === id) || null;
}

// Writes need an active member. Pending or removed members are refused.
function requireActive(room, memberId) {
  const m = findMember(room, memberId);
  if (!m) throw new Error('You are not in this league. Join it first.');
  if (memberStatus(m) === 'pending') throw new Error('Waiting for the owner to approve you.');
  return m;
}

// Reads: open rooms stay readable by code. Approval rooms need an active member. Removed members lose access either way.
function gateRead(room, memberId) {
  if (memberId != null && memberId !== '') {
    const m = findMember(room, memberId);
    if (!m) throw new Error('You are not in this league.');
    if (memberStatus(m) === 'pending') throw new Error('Waiting for the owner to approve you.');
    return;
  }
  if (room.approvalRequired) throw new Error('Sign in to this league to view it.');
}

function requireOwner(room, memberId) {
  const m = requireActive(room, memberId);
  if (m.id !== ownerId(room)) throw new Error('Only the league owner can do that.');
  return m;
}

// Room status for the client: who you are in this room and whether you can manage it.
export function roomStatus(code, memberId) {
  const room = getRoom(code);
  const m = findMember(room, memberId);
  return {
    code: room.code,
    name: room.name,
    approvalRequired: !!room.approvalRequired,
    status: m ? memberStatus(m) : 'none',
    isOwner: !!m && m.id === ownerId(room),
  };
}

export function listMembers(code, memberId) {
  const room = getRoom(code);
  requireOwner(room, memberId);
  return room.members.map((m) => ({ id: m.id, name: m.name, status: memberStatus(m), owner: m.id === ownerId(room) }));
}

export function setApproval({ code, memberId, approvalRequired }) {
  const room = getRoom(code);
  requireOwner(room, memberId);
  room.approvalRequired = !!approvalRequired;
  save();
  return { approvalRequired: room.approvalRequired };
}

export function approveMember({ code, memberId, targetId }) {
  const room = getRoom(code);
  requireOwner(room, memberId);
  const t = findMember(room, targetId);
  if (!t) throw new Error('That member is not in this league.');
  t.status = 'active';
  save();
  return { approved: t.name };
}

// Owner deletes the whole league. Irreversible: removes the league and everything in it
// (members, predictions, chat, duels, streaks, shame log), and records a tombstone so a
// cloud restore or later push cannot bring it back.
export function deleteRoom({ code, memberId, confirm }) {
  const room = getRoom(code);
  requireOwner(room, memberId);
  if (confirm !== code) throw new Error('Type the league code to confirm deletion.');
  const db = data();
  db.deletedRooms ||= {};
  db.deletedRooms[code] = new Date().toISOString();
  delete db.rooms[code];
  db.predictions = db.predictions.filter((p) => p.roomCode !== code);
  for (const key of ['chats', 'duels', 'streaks', 'shame']) {
    if (db[key]) delete db[key][code];
  }
  save();
  return { deleted: code };
}

// Owner removes a member. Their predictions and streak go with them, and any unfinished duel
// they were in gives the opponent a bye for the week.
export function kickMember({ code, memberId, targetId }) {
  const room = getRoom(code);
  requireOwner(room, memberId);
  const t = Number(targetId);
  if (t === ownerId(room)) throw new Error('The owner cannot be kicked.');
  const idx = room.members.findIndex((m) => m.id === t);
  if (idx < 0) throw new Error('That member is not in this league.');
  const name = room.members[idx].name;
  room.members.splice(idx, 1);
  const db = data();
  db.predictions = db.predictions.filter((p) => !(p.roomCode === code && p.memberId === t));
  if (db.streaks?.[code]) delete db.streaks[code][t];
  const weeks = db.duels?.[code] || {};
  for (const wk of Object.values(weeks)) {
    if (Date.parse(wk.end) <= Date.now()) continue;
    wk.pairs = wk.pairs.filter((p) => {
      if (p.a !== t && p.b !== t) return true;
      const other = p.a === t ? p.b : p.a;
      if (!p.finalized) wk.byes.push(other);
      return false;
    });
    wk.byes = wk.byes.filter((id) => id !== t);
  }
  save();
  return { removed: name };
}

export async function listFixtures(code, memberId) {
  const room = getRoom(code);
  gateRead(room, memberId);
  const { data: fixtures, source, notice, updatedAt } = await getFixtures();
  const upcoming = fixtures
    .filter((f) => room.competitions.includes(f.competition))
    .filter((f) => {
      const t = new Date(f.kickoff).getTime();
      return t > Date.now() - 2 * 3600e3 && t < Date.now() + 14 * 864e5;
    })
    .sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));
  return { fixtures: upcoming, source, notice, updatedAt, leagues: LEAGUES };
}

export function pickOutcome(hg, ag) {
  if (hg > ag) return 'H';
  if (hg < ag) return 'A';
  return 'D';
}

function lockedAt(fixture) {
  return Date.now() >= new Date(fixture.kickoff).getTime() - LOCK_SECONDS * 1000;
}

export function predict({ code, memberId, fixtureId, pick, hg, ag }, fixtures) {
  const room = getRoom(code);
  requireActive(room, memberId);
  const fixture = fixtures.find((f) => f.id === fixtureId);
  if (!fixture) throw new Error('Fixture not found.');
  if (fixture.status === 'VOID') throw new Error('This match was postponed or cancelled, so picks are closed.');
  if (fixture.status === 'FINISHED' || lockedAt(fixture)) throw new Error('Predictions are locked at kickoff.');
  if (!['H', 'D', 'A'].includes(pick)) throw new Error('Pick must be H, D or A.');
  // Daily cap: at most 2 picks per league per game day, per member. The day is the fixture's
  // kickoff date (UTC), so picks for the same day's games are counted together.
  const dayOf = (fid) => {
    const f = fixtures.find((x) => x.id === fid);
    return f?.kickoff ? new Date(f.kickoff).toISOString().slice(0, 10) : null;
  };
  const compOf = (fid) => fixtures.find((x) => x.id === fid)?.competition;
  const thisComp = fixture.competition;
  const thisDay = dayOf(fixtureId);
  const sameLeagueDay = data().predictions.filter((p) =>
    p.roomCode === code && p.memberId === Number(memberId) && p.fixtureId !== fixtureId
    && compOf(p.fixtureId) === thisComp && dayOf(p.fixtureId) === thisDay);
  if (sameLeagueDay.length >= 2) throw new Error('max 2 picks per league per day');
  const store = data().predictions;
  const existing = store.find((p) => p.roomCode === code && p.memberId === Number(memberId) && p.fixtureId === fixtureId);
  const exact = hg !== '' && hg != null && ag !== '' && ag != null;
  const row = {
    roomCode: code,
    memberId: Number(memberId),
    fixtureId,
    pick,
    hg: exact ? Number(hg) : null,
    ag: exact ? Number(ag) : null,
    points: null,
    settled: false,
    void: false,
    createdAt: new Date().toISOString(),
  };
  if (existing) Object.assign(existing, row);
  else store.push({ id: nextId(), ...row });
  save();
  return row;
}

// Removes a member's saved pick on one fixture (the user un-ticked it). Idempotent: removing a
// pick that is not there is a no-op. Locked, finished or settled picks cannot be removed.
export function unpredict({ code, memberId, fixtureId }, fixtures) {
  const room = getRoom(code);
  requireActive(room, memberId);
  const fixture = fixtures.find((f) => f.id === fixtureId);
  if (!fixture) throw new Error('Fixture not found.');
  if (fixture.status === 'VOID') throw new Error('This match was postponed or cancelled, so picks are closed.');
  if (fixture.status === 'FINISHED' || lockedAt(fixture)) throw new Error('Predictions are locked at kickoff.');
  const store = data().predictions;
  const idx = store.findIndex((p) => p.roomCode === code && p.memberId === Number(memberId) && p.fixtureId === fixtureId);
  if (idx === -1) return { removed: false, fixtureId };
  if (store[idx].settled) throw new Error('This pick is already settled and cannot be removed.');
  store.splice(idx, 1);
  save();
  return { removed: true, fixtureId };
}

// ---------- Streaks ----------
// Stored per room per member in data.streaks[code][memberId] = { current, best }.
// A settled prediction that earned points extends the streak; a miss resets it.
// Void (postponed/cancelled) predictions are never settled, so they never touch a streak.

function getStreak(code, memberId) {
  return (data().streaks?.[code]?.[memberId]) || { current: 0, best: 0 };
}

const STREAK_MILESTONES = [5, 10, 15, 20, 25];
function applyStreak(code, memberId, won) {
  const db = data();
  db.streaks ||= {};
  const room = (db.streaks[code] ||= {});
  const s = (room[memberId] ||= { current: 0, best: 0 });
  s.current = won ? s.current + 1 : 0;
  s.best = Math.max(s.best, s.current);
  // milestone -> chat line
  if (STREAK_MILESTONES.includes(s.current)) {
    db.chats ||= {};
    const list = (db.chats[code] ||= []);
    const name = data().rooms[code]?.members.find((m) => m.id === memberId)?.name || 'Someone';
    list.push({ id: nextId(), memberId: 0, name: 'StakeLess', text: `${name} is on a ${s.current}-pick winning streak. Who's ending it?`, at: new Date().toISOString(), system: true });
    if (list.length > CHAT_MAX) list.splice(0, list.length - CHAT_MAX);
  }
}

// One-time backfill: rebuild stored streaks from every settled prediction.
export function ensureStreakStore() {
  const db = data();
  if (db.streaksVersion === 1) return;
  db.streaks = {};
  const settled = db.predictions
    .filter((p) => p.settled)
    .sort((a, b) => String(a.settledAt || '').localeCompare(String(b.settledAt || '')) || a.id - b.id);
  for (const p of settled) applyStreak(p.roomCode, p.memberId, p.points > 0);
  db.streaksVersion = 1;
  save();
}

// Keeps predictions on postponed/cancelled fixtures flagged as void (no points, no streak),
// and clears the flag if the match is rescheduled. Returns true if anything changed.
function syncVoidFlags(fixtures) {
  const byFixture = new Map();
  for (const p of data().predictions) {
    if (p.settled) continue;
    if (!byFixture.has(p.fixtureId)) byFixture.set(p.fixtureId, []);
    byFixture.get(p.fixtureId).push(p);
  }
  let changed = false;
  for (const f of fixtures) {
    const want = f.status === 'VOID';
    for (const p of byFixture.get(f.id) || []) {
      if (!!p.void !== want) { p.void = want; changed = true; }
    }
  }
  return changed;
}

// Idempotent settlement: a fixture settles once, when FINISHED with a score.
export async function settleFinished(fixturesOverride) {
  const { data: fixtures } = fixturesOverride ? { data: fixturesOverride } : await getFixtures();
  const done = data().settledFixtures;
  let changed = syncVoidFlags(fixtures);
  const fresh = [];
  const finishedById = {};
  for (const f of fixtures) {
    if (f.status === 'FINISHED' && f.homeScore != null) finishedById[f.id] = f;
    if (f.status !== 'FINISHED' || done[f.id] || f.homeScore == null) continue;
    const outcome = pickOutcome(f.homeScore, f.awayScore);
    for (const p of data().predictions) {
      if (p.fixtureId !== f.id || p.settled) continue;
      let pts = 0;
      if (p.pick === outcome) pts += POINTS_OUTCOME;
      if (p.hg != null && p.hg === f.homeScore && p.ag === f.awayScore) pts += POINTS_EXACT_BONUS;
      p.points = pts;
      p.settled = true;
      p.void = false;
      p.settledAt = new Date().toISOString();
      p.result = { hg: f.homeScore, ag: f.awayScore, outcome };
      fresh.push({ p, kickoff: f.kickoff });
      changed = true;
    }
    done[f.id] = true;
  }
  // Streaks move in kickoff order so a run of picks builds the way it played out.
  fresh.sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff) || a.p.id - b.p.id);
  for (const { p } of fresh) applyStreak(p.roomCode, p.memberId, p.points > 0);
  // Settlement alerts: drop a result line into each affected room's chat.
  if (fresh.length) pushSettlementAlerts(fresh, finishedById);
  // Duels: pair this week's members, then close any duel whose week has ended.
  for (const code of Object.keys(data().rooms)) ensureDuels(code);
  finalizeDuels();
  if (changed) save();
  return fresh.length;
}

export function standings(code) {
  const room = getRoom(code);
  const weekAgo = Date.now() - 7 * 864e5;
  const rows = room.members.filter((m) => memberStatus(m) === 'active').map((m) => {
    const mine = data().predictions.filter((p) => p.roomCode === code && p.memberId === m.id && p.settled);
    mine.sort((a, b) => new Date(a.settledAt) - new Date(b.settledAt));
    const st = getStreak(code, m.id);
    const week = mine.filter((p) => new Date(p.settledAt).getTime() >= weekAgo);
    const weekWon = week.filter((p) => p.points >= POINTS_OUTCOME).length;
    return {
      memberId: m.id,
      name: m.name,
      points: mine.reduce((s, p) => s + p.points, 0),
      settled: mine.length,
      correct: mine.filter((p) => p.points >= POINTS_OUTCOME).length,
      exact: mine.filter((p) => p.points === POINTS_OUTCOME + POINTS_EXACT_BONUS).length,
      streak: st.current,
      bestStreak: st.best,
      recent: mine.slice(-5).reverse(),
      week: { points: week.reduce((s, p) => s + p.points, 0), won: weekWon, lost: week.length - weekWon, settled: week.length },
    };
  });
  rows.sort((a, b) => b.points - a.points || b.exact - a.exact || a.name.localeCompare(b.name));
  // Weekly leader: most points settled in the last 7 days (ties share it).
  const topWeek = Math.max(0, ...rows.map((r) => r.week.points));
  rows.forEach((r) => { r.weekLeader = topWeek > 0 && r.week.points === topWeek; });
  wallOfShame(code, rows);
  return rows;
}

// Wall of shame: once a day, roast the last-place player (min 2 players, min 3 settled).
function wallOfShame(code, rows) {
  if (rows.length < 2) return;
  const today = new Date().toISOString().slice(0, 10);
  const db = data();
  db.shame = db.shame || {};
  if (db.shame[code] === today) return;
  const last = rows[rows.length - 1];
  if (!last || last.settled < 3) return;
  db.shame[code] = today;
  db.chats ||= {};
  const list = (db.chats[code] ||= []);
  const pickLine = last.recent[0] ? `Last call: ${last.recent[0].pick.toUpperCase()} on fixture #${last.recent[0].fixtureId}.` : '';
  list.push({ id: nextId(), memberId: 0, name: 'StakeLess', text: `WALL OF SHAME: ${last.name} sits last with ${last.points} pts from ${last.settled} picks. ${pickLine} Do better.`, at: new Date().toISOString(), system: true });
  if (list.length > CHAT_MAX) list.splice(0, list.length - CHAT_MAX);
  save();
}


// Result lines in the room chat the moment matches settle: "FULL-TIME Man City 2-0 Villa. 3 nailed it."
function pushSettlementAlerts(fresh, finishedById) {
  const db = data();
  db.chats = db.chats || {};
  const byRoom = new Map();
  for (const { p } of fresh) {
    if (!byRoom.has(p.roomCode)) byRoom.set(p.roomCode, []);
    byRoom.get(p.roomCode).push(p);
  }
  for (const [code, preds] of byRoom) {
    const room = db.rooms[code];
    if (!room) continue;
    const list = db.chats[code] || (db.chats[code] = []);
    const seen = new Set();
    for (const { p } of preds) {
      const f = finishedById[p.fixtureId];
      if (!f || seen.has(f.id)) continue;
      seen.add(f.id);
      const all = db.predictions.filter((x) => x.fixtureId === f.id && x.settled && x.roomCode === code);
      const nailed = all.filter((x) => x.points >= 3).length;
      const line = `FULL-TIME ${f.home} ${f.homeScore}-${f.awayScore} ${f.away}. ${all.length} picked it, ${nailed} nailed it.`;
      list.push({ id: nextId(), memberId: 0, name: 'StakeLess', text: line, at: new Date().toISOString(), system: true });
    }
    if (list.length > CHAT_MAX) list.splice(0, list.length - CHAT_MAX);
  }
}

// Head-to-head record between two members across settled fixtures they both picked.
export function h2h(code, meId, otherId) {
  const room = getRoom(code);
  gateRead(room, meId);
  const a = Number(meId); const b = Number(otherId);
  const other = room.members.find((m) => m.id === b);
  if (!other) throw new Error('Player not found.');
  const mine = data().predictions.filter((p) => p.roomCode === code && p.memberId === a && p.settled);
  const theirs = new Map(data().predictions.filter((p) => p.roomCode === code && p.memberId === b && p.settled).map((p) => [p.fixtureId, p]));
  let meWins = 0, otherWins = 0, draws = 0;
  for (const p of mine) {
    const o = theirs.get(p.fixtureId);
    if (!o || o.points == null || p.points == null) continue;
    if (p.points > o.points) meWins++;
    else if (p.points < o.points) otherWins++;
    else draws++;
  }
  return { me: { name: room.members.find((m) => m.id === a)?.name || 'You', wins: meWins }, other: { name: other.name, wins: otherWins }, draws, games: meWins + otherWins + draws };
}

// ---------- Weekly head-to-head duels ----------
// Gameweek = ISO week (Monday 00:00 UTC to next Monday). Pairings are seeded by
// room code + week key, stored once, and stay fixed for the whole week.

export function weekInfo(date = new Date()) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - dow);
  const thursday = new Date(monday);
  thursday.setUTCDate(monday.getUTCDate() + 3);
  const isoYear = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4Dow = (jan4.getUTCDay() + 6) % 7;
  const week1Mon = new Date(jan4);
  week1Mon.setUTCDate(4 - jan4Dow);
  const week = 1 + Math.round((monday - week1Mon) / (7 * 864e5));
  const end = new Date(monday);
  end.setUTCDate(monday.getUTCDate() + 7);
  return {
    key: `${isoYear}-W${String(week).padStart(2, '0')}`,
    label: `Week ${week}`,
    start: monday.toISOString(),
    end: end.toISOString(),
  };
}

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededRandom(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle(list, seed) {
  const rnd = seededRandom(hashSeed(seed));
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Creates this week's pairing the first time it is needed. Members who join
// mid-week are paired among themselves (plus any bye) and nobody already paired moves.
// Only active members are paired; pending members wait for approval.
export function ensureDuels(code) {
  const room = getRoom(code);
  const w = weekInfo();
  const db = data();
  db.duels ||= {};
  const weeks = (db.duels[code] ||= {});
  let wk = weeks[w.key];
  if (!wk) {
    wk = weeks[w.key] = { key: w.key, label: w.label, start: w.start, end: w.end, pairs: [], byes: [] };
  }
  const paired = new Set([...wk.pairs.flatMap((p) => [p.a, p.b]), ...wk.byes]);
  const active = room.members.filter((m) => memberStatus(m) === 'active').map((m) => m.id);
  const fresh = active.filter((id) => !paired.has(id));
  if (!fresh.length) { save(); return wk; }
  const pool = [...wk.byes, ...fresh].sort((a, b) => a - b);
  wk.byes = [];
  const shuffled = seededShuffle(pool, `${code}|${w.key}|${wk.pairs.length}`);
  for (let i = 0; i < shuffled.length; i += 2) {
    if (i + 1 < shuffled.length) {
      wk.pairs.push({ a: shuffled[i], b: shuffled[i + 1], aPts: null, bPts: null, winnerId: null, finalized: false });
    } else {
      wk.byes.push(shuffled[i]);
    }
  }
  save();
  return wk;
}

export function ensureAllDuels() {
  for (const code of Object.keys(data().rooms)) ensureDuels(code);
}

function pointsInWindow(code, memberId, start, end) {
  return data().predictions
    .filter((p) => p.roomCode === code && p.memberId === memberId && p.settled && p.settledAt >= start && p.settledAt < end)
    .reduce((s, p) => s + (p.points || 0), 0);
}

// Closes a duel once its week has ended: compares points earned inside that week.
export function finalizeDuels() {
  const now = Date.now();
  let touched = false;
  for (const [code, weeks] of Object.entries(data().duels || {})) {
    if (!data().rooms[code]) continue;
    for (const wk of Object.values(weeks)) {
      if (Date.parse(wk.end) > now) continue;
      for (const p of wk.pairs) {
        if (p.finalized) continue;
        p.aPts = pointsInWindow(code, p.a, wk.start, wk.end);
        p.bPts = pointsInWindow(code, p.b, wk.start, wk.end);
        p.winnerId = p.aPts > p.bPts ? p.a : p.bPts > p.aPts ? p.b : null;
        p.finalized = true;
        touched = true;
      }
    }
  }
  if (touched) save();
}

export function duelsView(code, memberId) {
  const room = getRoom(code);
  gateRead(room, memberId);
  ensureDuels(code);
  finalizeDuels();
  const names = new Map(room.members.map((m) => [m.id, m.name]));
  const weeks = (data().duels || {})[code] || {};
  const w = weekInfo();
  const cur = weeks[w.key];
  const side = (id, wk, pts) => ({
    id,
    name: names.get(id) || 'Unknown',
    points: pts,
    streak: getStreak(code, id).current,
  });
  const row = (p, wk) => {
    const live = !p.finalized;
    const aPts = live ? pointsInWindow(code, p.a, wk.start, wk.end) : p.aPts;
    const bPts = live ? pointsInWindow(code, p.b, wk.start, wk.end) : p.bPts;
    return {
      a: side(p.a, wk, aPts),
      b: side(p.b, wk, bPts),
      winnerId: p.finalized ? p.winnerId : null,
      finalized: p.finalized,
    };
  };
  const current = cur ? cur.pairs.map((p) => row(p, cur)) : [];
  const currentBye = cur ? cur.byes.map((id) => ({ id, name: names.get(id) || 'Unknown' })) : [];

  let you = null;
  if (memberId && cur) {
    const id = Number(memberId);
    const mine = cur.pairs.find((p) => p.a === id || p.b === id);
    if (mine) {
      const r = row(mine, cur);
      const isA = mine.a === id;
      const opp = isA ? r.b : r.a;
      const yourPts = isA ? r.a.points : r.b.points;
      let status = 'live';
      if (r.finalized) status = r.winnerId == null ? 'drawn' : r.winnerId === id ? 'won' : 'lost';
      you = { opponent: opp, yourPoints: yourPts, opponentPoints: opp.points, status, bye: false, week: w.label };
    } else if (cur.byes.includes(id)) {
      you = { opponent: null, yourPoints: 0, opponentPoints: 0, status: 'bye', bye: true, week: w.label };
    } else {
      you = { opponent: null, yourPoints: 0, opponentPoints: 0, status: 'unpaired', bye: false, week: w.label };
    }
  }

  // Past duels, newest first (only closed weeks).
  const past = Object.values(weeks)
    .filter((wk) => Date.parse(wk.end) <= Date.now())
    .sort((a, b) => (a.start < b.start ? 1 : -1))
    .slice(0, 12)
    .map((wk) => ({
      key: wk.key,
      label: wk.label,
      start: wk.start,
      pairs: wk.pairs.map((p) => ({
        a: side(p.a, wk, p.aPts ?? 0),
        b: side(p.b, wk, p.bPts ?? 0),
        winnerId: p.winnerId ?? null,
        finalized: !!p.finalized,
      })),
      byes: wk.byes.map((id) => names.get(id) || 'Unknown'),
    }));

  // Season duel record per active member (finalized duels only; draws count for neither side).
  const season = new Map(room.members.filter((m) => memberStatus(m) === 'active').map((m) => [m.id, { memberId: m.id, name: m.name, w: 0, l: 0, d: 0 }]));
  for (const wk of Object.values(weeks)) {
    for (const p of wk.pairs) {
      if (!p.finalized) continue;
      const a = season.get(p.a);
      const b = season.get(p.b);
      if (p.winnerId == null) { if (a) a.d++; if (b) b.d++; }
      else if (p.winnerId === p.a) { if (a) a.w++; if (b) b.l++; }
      else { if (b) b.w++; if (a) a.l++; }
    }
  }
  const seasonRows = [...season.values()].sort((x, y) => y.w - x.w || x.l - y.l || x.name.localeCompare(y.name));

  return {
    week: { key: w.key, label: w.label, start: w.start, end: w.end },
    you,
    current,
    currentBye,
    past,
    season: seasonRows,
  };
}

export function myPredictions(code, memberId) {
  return data().predictions.filter((p) => p.roomCode === code && p.memberId === Number(memberId));
}

// Room chat: plain messages per room code, polled by the client.
// A voice note arrives as { audioBase64, audioMime } and is uploaded to the data repo
// right away; the message only stores the id, so data.json stays small.
const VOICE_B64_MAX = 400000; // ~300 KB of audio, roughly a minute of opus
export async function postChat(code, { memberId, text, audioBase64, audioMime }) {
  const room = getRoom(code);
  const member = requireActive(room, memberId);
  const body = String(text || '').replace(/\s+/g, ' ').trim().slice(0, CHAT_TEXT_MAX);
  let audio = null;
  const b64 = String(audioBase64 || '');
  if (b64) {
    if (b64.length > VOICE_B64_MAX) throw new Error('Voice note too long (30 seconds max).');
    if (!/^audio\/(webm|ogg|mp4|mpeg|wav)/.test(String(audioMime || ''))) throw new Error('Unsupported audio.');
    audio = { id: `vn-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`, mime: String(audioMime) };
  }
  if (!body && !audio) throw new Error('Type a message first.');
  const db = data();
  db.chats = db.chats || {};
  const list = db.chats[code] || (db.chats[code] = []);
  const msg = { id: nextId(), memberId: member.id, name: member.name, text: body, at: new Date().toISOString() };
  if (audio) {
    msg.audio = audio;
    // Await the upload so the message never exists without its audio being playable.
    try {
      await cloud.putFile('audio/' + audio.id + '.b64', b64);
    } catch (err) {
      console.error('[cloudsync] voice note upload failed:', err.message);
      throw new Error('Voice note could not be saved, try sending it again.');
    }
  }
  list.push(msg);
  if (list.length > CHAT_MAX) list.splice(0, list.length - CHAT_MAX);
  save();
  return { ...msg, streak: getStreak(code, member.id).current };
}

export function listChat(code, since = 0, memberId) {
  const room = getRoom(code);
  gateRead(room, memberId);
  const list = (data().chats || {})[code] || [];
  return list
    .filter((m) => m.id > since)
    .map((m) => ({ ...m, streak: getStreak(code, m.memberId).current }));
}
