# StakeLess

Free-to-play football prediction league. Points and bragging rights only. No money, no betting.

## Run it

Requires Node 18 or newer. No npm install needed (zero dependencies).

    cd stakeless
    node server/index.js

Then open http://localhost:3000

## Add your football-data.org API key (optional)

1. Sign up free at https://www.football-data.org/client/register
2. Open server/config.js and replace YOUR_FOOTBALL_DATA_API_KEY with your key.
3. Restart the server.

Without a key, the app uses built-in demo fixtures, and the header shows a Demo data badge. If a live fetch fails, the app shows a notice and falls back to demo data.

## Leagues covered

Premier League, La Liga, Serie A, Bundesliga, Ligue 1, UEFA Champions League, Eredivisie, Primeira Liga. These are the competitions in football-data.org's free tier. Saudi Pro League and MLS are not on the free tier, so they are not included yet.

## Scoring

- Correct outcome (home win, draw or away win): 3 points
- Exact score on top of a correct outcome: +2 bonus (5 total)
- Wrong outcome: 0

Predictions lock at kickoff. Settlement runs automatically when you load a league and on each fixtures or standings request, and each finished match settles only once.

## Where data lives

Leagues, members, and predictions are saved to server/data.json. Delete that file to reset everything.

## Files

- server/config.js: API key placeholder and league list
- server/demo.js: built-in demo fixtures
- server/football.js: football-data.org fetch with demo fallback
- server/store.js: JSON file storage
- server/rooms.js: rooms, predictions, settlement, standings
- server/index.js: HTTP server and API routes
- public/: frontend (index.html, style.css, app.js)
