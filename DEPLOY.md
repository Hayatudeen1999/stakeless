# StakeLess deployment

StakeLess is a plain Node server with no npm dependencies. Node 18 or newer is required (Node 20 LTS recommended).

Set these environment variables on the host:
- FOOTBALL_DATA_API_KEY: your football-data.org key (free at football-data.org/client/register). Without it the app runs on demo fixtures, which is for local dev only.
- APP_URL: the public URL, for example https://stakeless.example.com
- PORT: the port Node listens on (default 3000)
- TRUST_PROXY=1: set this when running behind nginx or Railway, so the rate limiter sees real client IPs.

## Option A: small Linux VPS (Ubuntu 22.04 or 24.04)

1. Install Node 20:
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs nginx
2. Upload the project to /opt/stakeless (git clone or scp), then:
   cd /opt/stakeless && mkdir -p server/backups
3. Install pm2 and start the app:
   sudo npm install -g pm2
   cd /opt/stakeless
   FOOTBALL_DATA_API_KEY=your_key APP_URL=https://your-domain PORT=3000 TRUST_PROXY=1 pm2 start server/index.js --name stakeless
   pm2 save && pm2 startup   (run the command it prints)
4. nginx on port 80:
   sudo nano /etc/nginx/sites-available/stakeless
   server {
     listen 80;
     server_name your-domain;
     client_max_body_size 2m;
     location / {
       proxy_pass http://127.0.0.1:3000;
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
     }
   }
   sudo ln -s /etc/nginx/sites-available/stakeless /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
5. Open the firewall: sudo ufw allow 'Nginx Full'
6. Add HTTPS (free): sudo apt-get install -y certbot python3-certbot-nginx && sudo certbot --nginx -d your-domain

Data lives in /opt/stakeless/server/data.json, with rolling backups in server/backups/ (last 5 kept). Back up that folder as well.

## Option B: Railway (from a GitHub repo)

1. Push the stakeless folder to a GitHub repo.
2. In Railway: New Project -> Deploy from GitHub repo -> pick the repo.
3. Variables tab: add FOOTBALL_DATA_API_KEY, APP_URL (your Railway domain, e.g. https://stakeless-production.up.railway.app), and TRUST_PROXY=1. Railway sets PORT for you.
4. Start command: node server/index.js (no build step needed).
5. Settings -> Networking -> Generate Domain. Then set APP_URL to that domain and redeploy.
6. Persistence: data.json lives on the container disk, which is wiped on redeploy. Add a Volume mounted at /app/server (or use a volume and point the data path there) before going live with real leagues.

## Cloud backup on GitHub (recommended for Render free tier)

Render's free tier wipes the disk on every sleep, restart and redeploy, which deletes data.json. StakeLess can keep a copy of the league data in a private GitHub repo. Every save is pushed there (at most once a minute), and on boot the app pulls it back if the local data.json is missing or empty. If the sync is not configured, the app works exactly as before.

1. Create a private GitHub repo, for example username/stakeless-data. It can be empty; the app creates the data file on the first save.
2. Create a fine-grained personal access token: GitHub -> Settings -> Developer settings -> Personal access tokens -> Fine-grained tokens -> Generate new token. Set Repository access to "Only select repositories" and pick only the data repo. Under Repository permissions, set Contents to Read and write. Nothing else is needed. Copy the token once; GitHub will not show it again.
3. On Render, open your web service -> Environment (Dashboard > your service > Environment) and add:
   - GITHUB_TOKEN: the token from step 2
   - GITHUB_REPO: the repo as owner/name, for example username/stakeless-data
   - GITHUB_BRANCH (optional): defaults to main
   Save, then redeploy.
4. Check the Render logs on boot. You should see one of these lines:
   - "cloud sync: enabled (username/stakeless-data@main:data/stakeless-data.json)" when it is on
   - "cloud sync: disabled" when GITHUB_TOKEN or GITHUB_REPO is missing
   - "cloud sync: restored data.json from GitHub" when the disk was wiped and the copy was pulled back
   The data file is stored in the repo at data/stakeless-data.json.

Notes: a failed push is logged as "[cloudsync] push failed" and never stops the app; the next save retries. Keep the token secret. Anyone with it can read and write that one repo. If you ever rotate the token, update GITHUB_TOKEN on Render and redeploy.

## Checks after deploy
- curl -I https://your-domain returns 200.
- Create a room, join from a second device, and confirm standings load.
- pm2 logs stakeless shows no errors.
