// Built-in demo fixtures, generated relative to now so they are always upcoming or recently finished.
const TEAMS = {
  PL: [['Arsenal', 'Chelsea'], ['Liverpool', 'Man City'], ['Spurs', 'Man Utd'], ['Newcastle', 'Aston Villa']],
  PD: [['Real Madrid', 'Barcelona'], ['Atletico', 'Sevilla'], ['Real Sociedad', 'Villarreal'], ['Betis', 'Valencia']],
  SA: [['Inter', 'Milan'], ['Juventus', 'Napoli'], ['Roma', 'Lazio'], ['Atalanta', 'Fiorentina']],
  BL1: [['Bayern', 'Dortmund'], ['Leverkusen', 'Leipzig'], ['Stuttgart', 'Frankfurt'], ['Wolfsburg', 'Freiburg']],
  FL1: [['PSG', 'Marseille'], ['Lyon', 'Monaco'], ['Lille', 'Nice'], ['Rennes', 'Lens']],
  CL: [['Man City', 'Real Madrid'], ['Bayern', 'Inter'], ['Arsenal', 'Barcelona'], ['PSG', 'Liverpool']],
  DED: [['Ajax', 'PSV'], ['Feyenoord', 'AZ'], ['Twente', 'Utrecht'], ['Vitesse', 'Heerenveen']],
  PPL: [['Benfica', 'Porto'], ['Sporting', 'Braga'], ['Vitoria', 'Boavista'], ['Famalicao', 'Rio Ave']],
};

// Deterministic pseudo-random score from an id string.
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

// Anchored to server start so kickoffs do not drift on cache refresh.
// First match of each league: kicks off 8 minutes after start, finishes at 12 minutes,
// so predictions and settlement are visible during a demo click-through.
const BASE = Date.now();
export function demoFixtures() {
  const out = [];
  Object.entries(TEAMS).forEach(([code, pairs]) => {
    pairs.forEach(([home, away], i) => {
      const offsetMin = i === 0 ? 8 : (6 + i * 20 + (code.length % 3) * 5) * 60;
      const kick = BASE + offsetMin * 60e3;
      const kickoff = new Date(kick).toISOString();
      const id = `demo-${code}-${i}`;
      const finished = i === 0 && Date.now() >= BASE + 12 * 60e3;
      const h = hash(id);
      out.push({
        id,
        competition: code,
        home,
        away,
        kickoff,
        status: finished ? 'FINISHED' : 'SCHEDULED',
        homeScore: finished ? h % 4 : null,
        awayScore: finished ? Math.floor(h / 7) % 4 : null,
      });
    });
  });
  return out;
}
