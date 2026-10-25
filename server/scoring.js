// Single source of truth for the game rules (v34). rooms.js uses these numbers for settling,
// picks and duels; the League rules popup and the Settings rules card read the text built
// here through GET /api/league-rules. Change a number here and the rules text follows.

export const SCORING = {
  pointsCorrectResult: 3,   // right home win / draw / away win
  pointsExactBonus: 2,      // extra points for the exact scoreline (on top of the result points)
  maxPicksPerLeagueDay: 2,  // per member, per competition, per game day (kickoff date UTC)
  lockSeconds: 0,           // picks lock this many seconds before kickoff (0 = at kickoff)
};

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Plain-language rules. Returned as a title, a short intro and a list of rule items.
// Every number in the text comes from SCORING, so the text cannot drift from the code.
export function leagueRules(s = SCORING) {
  const exactTotal = s.pointsCorrectResult + s.pointsExactBonus;
  const lock = s.lockSeconds > 0
    ? `${plural(Math.round(s.lockSeconds / 60), 'minute')} before kickoff`
    : 'at kickoff';
  return {
    title: 'League rules',
    intro: 'Here is how the game works. Free to play, points and bragging rights only.',
    items: [
      {
        heading: 'Points',
        text: `Call the result (home win, draw or away win) and you earn ${plural(s.pointsCorrectResult, 'point')}. Nail the exact score and you get ${s.pointsExactBonus} extra, so ${plural(exactTotal, 'point')} in total. Streaks are for bragging rights and add no points.`,
      },
      {
        heading: 'Daily picks',
        text: `You can make up to ${plural(s.maxPicksPerLeagueDay, 'pick')} per league, per competition, per game day. For example, ${s.maxPicksPerLeagueDay} Premier League games on the same day.`,
      },
      {
        heading: 'Lock time',
        text: `Picks lock ${lock}. Until then you can change or remove them. After kickoff they are frozen.`,
      },
      {
        heading: 'Weekly duels',
        text: 'Every week (Monday to Sunday, UTC) members are paired for a head-to-head duel. Whoever earns more points that week wins the duel. Same points is a draw. Members without a pair that week get a bye.',
      },
      {
        heading: 'Standings',
        text: 'Standings settle automatically once a match finishes. Nobody types in results. Ties on the table are broken by most exact scores, then by name.',
      },
      {
        heading: 'Fine print',
        text: 'Postponed or cancelled matches are void: picks on them earn nothing and do not touch your streak.',
      },
    ],
    footer: 'For fun only, not betting advice.',
    scoring: { ...s },
  };
}
