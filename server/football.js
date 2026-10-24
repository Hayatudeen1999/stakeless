// Fixture source: football-data.org when a key is set, otherwise demo data (local dev only).
// Live mode never falls back to demo data: if the API fails it serves the last saved live
// fixtures with a "showing last update" notice, and only shows an "unavailable" note if nothing was ever saved.
import { CONFIG, LEAGUES } from './config.js';
import { demoFixtures } from './demo.js';
import { data, save } from './store.js';

const FETCH_TIMEOUT_MS = 8000;
const RETRY_AFTER_FAILURE_MS = 60 * 1000;

// football-data.org status -> our status. Postponed and cancelled matches are VOID (no points).
const STATUS = {
  FINISHED: 'FINISHED',
  AWARDED: 'FINISHED',
  SCHEDULED: 'SCHEDULED',
  TIMED: 'SCHEDULED',
  IN_PLAY: 'LIVE',
  PAUSED: 'LIVE',
  LIVE: 'LIVE',
  EXTRA_TIME: 'LIVE',
  PENALTY_SHOOTOUT: 'LIVE',
  SUSPENDED: 'LIVE',
  POSTPONED: 'VOID',
  CANCELLED: 'VOID',
};

let mem = { at: 0, updatedAt: 0, data: null, source: null, notice: null };
let inflight = null;

export function hasLiveKey() {
  const k = CONFIG.footballDataApiKey;
  return Boolean(k) && k !== 'YOUR_FOOTBALL_DATA_API_KEY';
}

const isoDay = (d) => d.toISOString().slice(0, 10);

function mapMatch(m) {
  return {
    id: `fd-${m.id}`,
    competition: m.competition.code,
    home: m.homeTeam.shortName || m.homeTeam.name || 'TBD',
    away: m.awayTeam.shortName || m.awayTeam.name || 'TBD',
    kickoff: m.utcDate,
    status: STATUS[m.status] || 'SCHEDULED',
    rawStatus: m.status,
    homeScore: m.score?.fullTime?.home ?? null,
    awayScore: m.score?.fullTime?.away ?? null,
  };
}

async function fetchCompetition(league) {
  // Scoped to the current week (yesterday to next Sunday): keeps fixtures fresh
  // without overwhelming users with games 2-3 weeks away.
  const from = new Date(Date.now() - 1 * 864e5);
  const to = new Date(Date.now() + 7 * 864e5);
  const url = `https://api.football-data.org/v4/competitions/${league.code}/matches?dateFrom=${isoDay(from)}&dateTo=${isoDay(to)}`;
  const res = await fetch(url, {
    headers: { 'X-Auth-Token': CONFIG.footballDataApiKey },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${league.code} returned HTTP ${res.status}`);
  const json = await res.json();
  if (!Array.isArray(json.matches)) throw new Error(`${league.code} returned an unexpected payload`);
  return json.matches.map(mapMatch);
}

// The free tier rejects multi-competition queries, so each league is fetched alone.
// A league that fails keeps its last saved fixtures; if every league fails, the caller falls back to the cache.
async function refreshLive() {
  const cached = data().fixtureCache || null;
  const results = await Promise.allSettled(LEAGUES.map((l) => fetchCompetition(l)));
  const failed = [];
  const fixtures = [];
  results.forEach((r, i) => {
    const code = LEAGUES[i].code;
    if (r.status === 'fulfilled') {
      fixtures.push(...r.value);
    } else {
      failed.push(code);
      console.warn(`[football] ${code} refresh failed: ${r.reason?.message || r.reason}`);
      fixtures.push(...(cached?.fixtures || []).filter((f) => f.competition === code));
    }
  });
  if (failed.length === LEAGUES.length) throw new Error('every league request failed');
  data().fixtureCache = { at: Date.now(), fixtures };
  save();
  const notice = failed.length
    ? `Some leagues (${failed.join(', ')}) did not refresh, so their last update is shown.`
    : null;
  return { fixtures, notice };
}

function stamp(ms) {
  return new Date(ms).toLocaleString('en-GB', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' }) + ' UTC';
}

async function refresh() {
  try {
    const out = await refreshLive();
    mem = { at: Date.now(), updatedAt: Date.now(), data: out.fixtures, source: 'live', notice: out.notice };
  } catch (err) {
    console.error(`[football] live fetch failed: ${err.message}`);
    const cached = data().fixtureCache;
    if (cached?.fixtures) {
      mem = {
        at: Date.now() - CONFIG.cacheMinutes * 60e3 + RETRY_AFTER_FAILURE_MS,
        updatedAt: cached.at,
        data: cached.fixtures,
        source: 'cache',
        notice: `Live scores are unavailable right now. Showing the last update from ${stamp(cached.at)}.`,
      };
    } else {
      mem = {
        at: Date.now() - CONFIG.cacheMinutes * 60e3 + RETRY_AFTER_FAILURE_MS,
        updatedAt: 0,
        data: [],
        source: 'unavailable',
        notice: 'Live fixtures are unavailable right now. We will retry automatically.',
      };
    }
  }
  return mem;
}

// Returns { data, source, notice, updatedAt }. source: 'live' | 'cache' | 'unavailable' | 'demo'.
export async function getFixtures({ force = false } = {}) {
  if (!hasLiveKey()) {
    return { data: demoFixtures(), source: 'demo', notice: null, updatedAt: Date.now() };
  }
  const fresh = Date.now() - mem.at < CONFIG.cacheMinutes * 60e3;
  if (!force && mem.data && fresh) return mem;
  if (!inflight) inflight = refresh().finally(() => { inflight = null; });
  return inflight;
}
