// StakeLess config. Set your football-data.org key with the FOOTBALL_DATA_API_KEY environment variable
// (never commit a real key). Get one free at https://www.football-data.org/client/register
// If no key is set, the app runs on built-in demo fixtures (local development only).
export const CONFIG = {
  footballDataApiKey: process.env.FOOTBALL_DATA_API_KEY || 'YOUR_FOOTBALL_DATA_API_KEY',
  // Public URL of this app once deployed (used in share captions and the Facebook link).
  // Set APP_URL in production, e.g. 'https://stakeless.example.com'. Empty = the browser's own address.
  appUrl: process.env.APP_URL || 'https://stakeless-7ido.onrender.com',
  cacheMinutes: 5,
  port: process.env.PORT || 3000,
  // Leaderboard ad slot (below the header on phones, sidebar on desktop).
  // Set houseAd to null or {} to hide the slot entirely.
  houseAd: {
    kicker: 'Sponsored',
    headline: 'AsiaFilm',
    body: 'Stream the latest movies and series free.',
    cta: 'Watch now',
    href: 'https://asiafilm.org/4/300976ee774488f272fcb0221afcc2f2',
    image: '',
    alt: 'AsiaFilm ad',
  },
};

// The 8 leagues covered by football-data.org's free tier.
export const LEAGUES = [
  { code: 'PL', name: 'Premier League', country: 'England' },
  { code: 'PD', name: 'La Liga', country: 'Spain' },
  { code: 'SA', name: 'Serie A', country: 'Italy' },
  { code: 'BL1', name: 'Bundesliga', country: 'Germany' },
  { code: 'FL1', name: 'Ligue 1', country: 'France' },
  { code: 'CL', name: 'UEFA Champions League', country: 'Europe' },
  { code: 'DED', name: 'Eredivisie', country: 'Netherlands' },
  { code: 'PPL', name: 'Primeira Liga', country: 'Portugal' },
];
