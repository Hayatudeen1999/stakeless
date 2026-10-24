// GitHub-backed snapshot of data.json. Render's free tier wipes the disk on every sleep,
// restart and redeploy, so the league data is pushed to a private GitHub repo and pulled
// back on boot. Uses only Node's built-in fetch and the GitHub REST API (no npm deps).
//
// Enabled only when GITHUB_TOKEN and GITHUB_REPO are both set. Otherwise every function
// here is a no-op and the app behaves exactly as it did before.
//
// Env vars:
//   GITHUB_TOKEN   fine-grained PAT with Contents read/write on the data repo only
//   GITHUB_REPO    owner/name of the private data repo, e.g. username/stakeless-data
//   GITHUB_BRANCH  branch to read and write (default 'main')

const TOKEN = process.env.GITHUB_TOKEN || '';
const REPO = process.env.GITHUB_REPO || '';
const BRANCH = process.env.GITHUB_BRANCH || 'main';
// Overridable only so the sync can be tested against a local mock server.
const API = process.env.GITHUB_API_URL || 'https://api.github.com';
export const DATA_PATH = 'data/stakeless-data.json';
const TIMEOUT_MS = 15000;

export const enabled = Boolean(TOKEN && REPO);

export function describe() {
  return enabled ? `${REPO}@${BRANCH}:${DATA_PATH}` : '';
}

function headers(extra = {}) {
  return {
    Authorization: `Bearer ${TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'stakeless-cloud-sync',
    ...extra,
  };
}

function url(rel = DATA_PATH) {
  const p = rel.split('/').map(encodeURIComponent).join('/');
  return `${API}/repos/${REPO}/contents/${p}`;
}

async function ghFetch(u, init = {}) {
  return fetch(u, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
}

// Returns the current blob sha of the data file on the branch, or null if it does not exist yet.
async function currentSha(rel = DATA_PATH) {
  const res = await ghFetch(`${url(rel)}?ref=${encodeURIComponent(BRANCH)}`, { headers: headers() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub GET contents failed: HTTP ${res.status}`);
  const body = await res.json();
  return body.sha || null;
}

// Pushes the data object as JSON. Fire-and-forget callers should catch errors.
export async function syncUp(data) {
  if (!enabled) return false;
  const text = JSON.stringify(data, null, 2);
  const sha = await currentSha();
  const body = {
    message: `stakeless data sync ${new Date().toISOString()}`,
    content: Buffer.from(text, 'utf8').toString('base64'),
    branch: BRANCH,
  };
  if (sha) body.sha = sha;
  const res = await ghFetch(url(), {
    method: 'PUT',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`GitHub PUT contents failed: HTTP ${res.status} ${detail.slice(0, 200)}`);
  }
  return true;
}

// Returns the stored file as a UTF-8 string, or null when there is no file yet.
// Uses the raw media type so files over GitHub's 1 MB JSON limit still come back whole.
export async function syncDown() {
  if (!enabled) return null;
  const res = await ghFetch(`${url()}?ref=${encodeURIComponent(BRANCH)}`, {
    headers: headers({ Accept: 'application/vnd.github.raw' }),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub GET contents failed: HTTP ${res.status}`);
  return res.text();
}

// --- Generic binary-adjacent helpers for chat voice notes (base64 text blobs). ---

// Saves a base64 payload as a file in the data repo. Fails loudly; callers log.
export async function putFile(rel, textB64) {
  if (!enabled) return false;
  const sha = await currentSha(rel);
  const body = {
    message: `stakeless voice note ${rel} ${new Date().toISOString()}`,
    content: Buffer.from(textB64, 'utf8').toString('base64'),
    branch: BRANCH,
  };
  if (sha) body.sha = sha;
  const res = await ghFetch(url(rel), {
    method: 'PUT',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`GitHub PUT ${rel} failed: HTTP ${res.status} ${detail.slice(0, 120)}`);
  }
  return true;
}

// Returns the stored base64 payload for a file, or null when it does not exist.
export async function getFile(rel) {
  if (!enabled) return null;
  const res = await ghFetch(`${url(rel)}?ref=${encodeURIComponent(BRANCH)}`, {
    headers: headers({ Accept: 'application/vnd.github.raw' }),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub GET ${rel} failed: HTTP ${res.status}`);
  return res.text();
}
