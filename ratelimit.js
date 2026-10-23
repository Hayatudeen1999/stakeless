// In-memory per-IP limiter for POST routes. Fixed 10 second window, max 30 requests.
// Behind a reverse proxy set TRUST_PROXY=1 so the client IP comes from X-Real-IP
// (nginx) or the last X-Forwarded-For entry (Railway and other hosts).
const WINDOW_MS = 10 * 1000;
const MAX_REQUESTS = 30;
const hits = new Map();

export function clientIp(req) {
  if (process.env.TRUST_PROXY) {
    const real = req.headers['x-real-ip'];
    if (real) return String(real).trim();
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (fwd.length) return fwd[fwd.length - 1];
  }
  return req.socket.remoteAddress || 'unknown';
}

export function allow(ip) {
  const now = Date.now();
  let e = hits.get(ip);
  if (!e || now - e.start >= WINDOW_MS) {
    e = { start: now, count: 0 };
    hits.set(ip, e);
  }
  e.count += 1;
  if (e.count <= MAX_REQUESTS) return { ok: true };
  return { ok: false, retryAfter: Math.max(1, Math.ceil((e.start + WINDOW_MS - now) / 1000)) };
}

// Drop idle entries so the map cannot grow forever.
setInterval(() => {
  const now = Date.now();
  for (const [ip, e] of hits) if (now - e.start >= WINDOW_MS) hits.delete(ip);
}, 30 * 1000).unref();
