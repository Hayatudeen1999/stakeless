// Daily Picks: a public, algorithmic "likely outcome" for each day's biggest fixtures.
// Pure fun, no betting advice. Confidence is derived only from data football-data.org
// gives us: season points per game, goal difference and head-to-head table position.
import { getFixtures } from './football.js';
import { LEAGUES } from './config.js';

const CONF_LABEL = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence' };

// Pull a league table by asking for finished matches of the season so far. We reuse the
// fixtures cache (already fetched for rooms) plus a season-wide fetch done once per hour.
const tableCache = new Map(); // code -> { table: Map(team->pts/gd/gp), at }
const TABLE_TTL = 60 * 60 * 1000;

async function fetchSeason(code) {
  const url = `https://api.football-data.org/v4/competitions/${code}/matches?status=FINISHED`;
  try {
    const res = await fetch(url, { headers: { 'X-Auth-Token': process.env.FOOTBALL_DATA_API_KEY } });
    if (!res.ok) return null;
    const json = await res.json();
    return json.matches || [];
  } catch { return null; }
}

function buildTable(matches) {
  const t = new Map();
  const bump = (team, gf, ga) => {
    const row = t.get(team) || { team, gp: 0, pts: 0, gd: 0 };
    row.gp++; row.gd += gf - ga;
    row.pts += gf > ga ? 3 : gf === ga ? 1 : 0;
    t.set(team, row);
  };
  for (const m of matches) {
    if (m.score?.fullTime?.home == null) continue;
    bump(m.homeTeam.name, m.score.fullTime.home, m.score.fullTime.away);
    bump(m.awayTeam.name, m.score.fullTime.away, m.score.fullTime.home);
  }
  return t;
}

export async function dailyPicks({ member }) {
  const { fixtures } = await getFixtures();
  const day = new Date().toISOString().slice(0, 10);
  const todays = fixtures.filter((f) => f.kickoff && f.kickoff.slice(0, 10) === day);
  const seen = new Set();
  const picks = [];
  for (const f of todays) {
    if (seen.has(`${f.home}|${f.away}`)) continue;
    seen.add(`${f.home}|${f.away}`);
    let table = null; const key = f.competition; const now = Date.now();
    if (tableCache.has(key) && now - tableCache.get(key).at < TABLE_TTL) table = tableCache.get(key).table;
    else {
      const season = await fetchSeason(key);
      if (season) { table = buildTable(season); tableCache.set(key, { table, at: now }); }
    }
    // Team names in fixtures are shortNames, in season data full names: match loosely.
    const find = (name) => {
      if (!table) return null;
      for (const row of table.values()) {
        const a = row.team.toLowerCase(); const b = name.toLowerCase();
        if (a === b || a.includes(b) || b.includes(a)) return row;
      }
      return null;
    };
    const h = find(f.home); const a = find(f.away);
    if (!h || !a) { picks.push({ fixture: f, pick: null, why: 'not enough data yet' }); continue; }
    const hPpg = h.pts / h.gp, aPpg = a.pts / a.gp;
    const hScore = hPpg * 1.25 + (h.gd / h.gp) * 0.4 + 0.35; // home edge
    const aScore = aPpg + (a.gd / a.gp) * 0.4;
    const gap = hScore - aScore;
    const pick = gap >= 0 ? f.home : f.away;
    const strength = Math.min(Math.abs(gap), 1.2);
    const conf = strength > 0.7 ? 'high' : strength > 0.3 ? 'medium' : 'low';
    picks.push({
      fixture: f,
      pick,
      confidence: conf,
      label: CONF_LABEL[conf],
      why: `${pick} stronger this season (${(gap >= 0 ? hPpg : aPpg).toFixed(1)} pts/game vs ${(gap >= 0 ? aPpg : hPpg).toFixed(1)})`,
    });
  }
  // Big rooms only care about the strongest calls first.
  picks.sort((x, y) => (y.confidence === 'high' ? 1 : 0) - (x.confidence === 'high' ? 1 : 0) || x.fixture.kickoff.localeCompare(y.fixture.kickoff));
  return { day, picks, disclaimer: 'For fun only. These are algorithm guesses from season results, not betting advice. Stake nothing.' };
}
