// Minimal HTTP server, no dependencies.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG, LEAGUES } from './config.js';
import {
  createRoom, joinRoom, getRoom, listFixtures, predict, settleFinished, standings, myPredictions,
  postChat, listChat, duelsView, ensureStreakStore, ensureAllDuels, h2h,
  roomStatus, listMembers, setApproval, approveMember, kickMember,
} from './rooms.js';
import { flushOnExit, restoreFromCloud, data } from './store.js';
import { allow, clientIp } from './ratelimit.js';
import { dailyPicks } from './picks.js';
import * as cloud from './cloudsync.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(here, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const BODY_MAX = 600 * 1024; // room-chat voice notes ride along as base64
const RATE_MSG = 'Easy there, too many requests. Give it a few seconds and try again.';

function send(res, code, obj, extra = {}) {
  if (res.headersSent) return;
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra });
  res.end(JSON.stringify(obj));
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}


// Voice-note cache and mime lookup from the room's chat log.
const voiceCache = new Map();
function findAudioMime(code, audioId) {
  try {
    const list = (data().chats || {})[code] || [];
    const m = list.find((x) => x.audio && x.audio.id === audioId);
    return m ? m.audio.mime : null;
  } catch { return null; }
}


// Serves chat audio with byte-range support. Safari refuses media served without it.
function serveAudio(res, mime, b64, rangeHeader) {
  const buf = Buffer.from(b64, 'base64');
  const common = { 'Content-Type': mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=86400' };
  const m = rangeHeader && rangeHeader.match(/bytes=(\d*)-(\d*)/);
  if (m) {
    let start = m[1] === '' ? null : Number(m[1]);
    let end = m[2] === '' ? buf.length - 1 : Math.min(Number(m[2]), buf.length - 1);
    if (start == null) { start = buf.length - Number(m[2]); end = buf.length - 1; }
    if (Number.isNaN(start) || start < 0 || start > end) { start = 0; end = buf.length - 1; }
    res.writeHead(206, { ...common, 'Content-Range': `bytes ${start}-${end}/${buf.length}`, 'Content-Length': end - start + 1 });
    return res.end(buf.subarray(start, end + 1));
  }
  res.writeHead(200, { ...common, 'Content-Length': buf.length });
  return res.end(buf);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > BODY_MAX) { reject(new HttpError(413, 'That request is too large.')); req.destroy(); return; }
      raw += c;
    });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch { reject(new HttpError(400, 'Could not read that request.')); }
    });
    req.on('error', () => reject(new HttpError(400, 'Could not read that request.')));
  });
}

const CODE_RE = /^[A-Z0-9]{6}$/;

async function api(req, res, url) {
  const p = url.pathname;
  const m = req.method;
  const isWrite = m === 'POST';
  if (isWrite) {
    const verdict = allow(clientIp(req));
    if (!verdict.ok) {
      return send(res, 429, { error: RATE_MSG }, { 'Retry-After': String(verdict.retryAfter) });
    }
  }
  if (p === '/api/leagues' && m === 'GET') return send(res, 200, { leagues: LEAGUES });
  if (p === '/api/share-config' && m === 'GET') return send(res, 200, { appUrl: CONFIG.appUrl || '' });
  if (p === '/api/daily-picks' && m === 'GET') return send(res, 200, await dailyPicks({}));
  if (p === '/api/house-ads' && m === 'GET') {
    const list = Array.isArray(CONFIG.houseAds) ? CONFIG.houseAds : (CONFIG.houseAd ? [CONFIG.houseAd] : []);
    const usable = list.filter((a) => a && typeof a === 'object' && (a.headline || a.image));
    return send(res, 200, { ads: usable });
  }
  if (p === '/api/house-ad' && m === 'GET') {
    const ad = CONFIG.houseAd;
    const usable = ad && typeof ad === 'object' && (ad.headline || ad.image);
    return send(res, 200, { ad: usable ? ad : null });
  }
  if (p === '/api/rooms' && m === 'POST') return send(res, 200, createRoom(await readBody(req)));
  if (p === '/api/rooms/join' && m === 'POST') return send(res, 200, joinRoom(await readBody(req)));

  // Voice notes: stream a chat audio blob back to league members. Ids are unguessable
  // and the room membership is still checked, so audio never leaks outside the room.
  const audioMatch = p.match(/^\/api\/rooms\/([A-Z0-9]{6})\/audio\/([a-z0-9-]+)$/);
  if (audioMatch && m === 'GET') {
    const [, aCode, audioId] = audioMatch;
    if (!CODE_RE.test(aCode)) return send(res, 404, { error: 'League not found.' });
    const room = getRoom(aCode);
    const me = Number(url.searchParams.get('member')) || null;
    if (!me) return send(res, 403, { error: 'Members only.' });
    const member = room.members.find((mm) => mm.id === me);
    if (!member) return send(res, 403, { error: 'Members only.' });
    const cached = voiceCache.get(audioId);
    if (cached) return serveAudio(res, cached.mime, cached.b64, req.headers.range);
    let b64;
    try { b64 = await cloud.getFile(`audio/${audioId}.b64`); }
    catch (err) { return send(res, 502, { error: 'Voice note is still uploading, try again shortly.' }); }
    if (!b64) return send(res, 404, { error: 'Voice note not found.' });
    // Mime was stored in the chat message; fall back to webm.
    const mime = findAudioMime(aCode, audioId) || 'audio/webm';
    if (voiceCache.size > 200) voiceCache.clear();
    voiceCache.set(audioId, { b64, mime });
    return serveAudio(res, mime, b64, req.headers.range);
  }

  const roomMatch = p.match(/^\/api\/rooms\/([A-Z0-9]{6})\/(\w+)$/);
  if (!roomMatch) return send(res, 404, { error: 'Not found.' });
  const [, code, action] = roomMatch;
  if (!CODE_RE.test(code)) return send(res, 404, { error: 'League not found.' });

  if (action === 'status' && m === 'GET') {
    return send(res, 200, roomStatus(code, Number(url.searchParams.get('member')) || null));
  }
  if (action === 'fixtures' && m === 'GET') {
    const room = getRoom(code);
    const me = Number(url.searchParams.get('member')) || null;
    await settleFinished();
    const f = await listFixtures(code, me);
    const mine = me ? myPredictions(code, me) : [];
    return send(res, 200, { room: { code, name: room.name, members: room.members.length, approvalRequired: !!room.approvalRequired }, ...f, mine });
  }
  if (action === 'predict' && m === 'POST') {
    const b = await readBody(req);
    const f = await listFixtures(code, b.memberId);
    return send(res, 200, predict({ code, ...b }, f.fixtures));
  }
  if (action === 'standings' && m === 'GET') {
    await settleFinished();
    return send(res, 200, { standings: standings(code) });
  }
  if (action === 'h2h' && m === 'GET') {
    return send(res, 200, h2h(code, Number(url.searchParams.get('me')) || 0, Number(url.searchParams.get('other')) || 0));
  }
  if (action === 'duels' && m === 'GET') {
    await settleFinished();
    const me = Number(url.searchParams.get('member')) || null;
    return send(res, 200, { duels: duelsView(code, me) });
  }
  if (action === 'chat' && m === 'GET') {
    const since = Number(url.searchParams.get('since')) || 0;
    const me = Number(url.searchParams.get('member')) || null;
    return send(res, 200, { messages: listChat(code, since, me) });
  }
  if (action === 'chat' && m === 'POST') {
    const b = await readBody(req);
    return send(res, 200, { message: await postChat(code, b) });
  }
  // Owner room settings and member management.
  if (action === 'members' && m === 'GET') {
    const me = Number(url.searchParams.get('member')) || null;
    return send(res, 200, { members: listMembers(code, me) });
  }
  if (action === 'settings' && m === 'POST') {
    const b = await readBody(req);
    return send(res, 200, setApproval({ code, memberId: b.memberId, approvalRequired: !!b.approvalRequired }));
  }
  if (action === 'approve' && m === 'POST') {
    const b = await readBody(req);
    return send(res, 200, approveMember({ code, memberId: b.memberId, targetId: b.targetId }));
  }
  if (action === 'kick' && m === 'POST') {
    const b = await readBody(req);
    return send(res, 200, kickMember({ code, memberId: b.memberId, targetId: b.targetId }));
  }
  if (action === 'settle' && m === 'POST') {
    const changed = await settleFinished();
    return send(res, 200, { settled: changed });
  }
  return send(res, 404, { error: 'Not found.' });
}

function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    return res.end();
  }
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { rel = '/'; }
  const file = path.join(PUBLIC, rel === '/' ? 'index.html' : rel);
  if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Not found');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

// Every failure ends here: no request is left hanging, and clients always get JSON for /api.
function handleError(req, res, err) {
  if (err instanceof HttpError) return send(res, err.status, { error: err.message });
  const msg = String(err?.message || '');
  if (/not found|not in this league|locked|must|required|only the league owner|join|Waiting|Type|Enter|Pick|postponed|cannot|No league|already/i.test(msg)) {
    return send(res, 400, { error: msg });
  }
  console.error(`[server] ${req.method} ${req.url} failed:`, err);
  return send(res, 500, { error: 'Something went wrong on our side. Try again in a moment.' });
}

const server = http.createServer((req, res) => {
  let url;
  try { url = new URL(req.url, 'http://x'); }
  catch { res.writeHead(400); return res.end('Bad request'); }
  const run = url.pathname.startsWith('/api/')
    ? api(req, res, url)
    : Promise.resolve().then(() => serveStatic(req, res, url));
  run.catch((err) => handleError(req, res, err));
});

server.on('clientError', (err, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
});

try {
  ensureStreakStore();
  ensureAllDuels();
} catch (err) {
  console.error('[server] startup housekeeping failed (continuing):', err);
}

// Restore data.json from the GitHub backup before anything is served (no-op unless sync is configured).
await restoreFromCloud();
server.listen(CONFIG.port, () => console.log(`StakeLess running at http://localhost:${CONFIG.port}`));

// Flush the write-behind batch on clean shutdown so the last few seconds of changes are kept.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    flushOnExit();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
process.on('uncaughtException', (err) => {
  console.error('[server] uncaught exception:', err);
  flushOnExit();
});
process.on('unhandledRejection', (err) => {
  console.error('[server] unhandled rejection:', err);
});
