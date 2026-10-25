// JSON-file persistence with atomic writes, write-behind batching and rolling backups.
//
// - save() only marks the data dirty and schedules a flush (write-behind, 250ms batch).
// - flushNow() writes data.json via temp file + fsync + rename, so a crash mid-write
//   never leaves a half-written data.json.
// - A snapshot is copied into backups/ at most every BACKUP_INTERVAL_MS (default 2 min)
//   and on the first save after boot; only the newest 5 are kept.
// - On boot, if data.json is unreadable, it is kept as backups/data.corrupt-*.json and the
//   newest valid backup is restored automatically.
//
// Shape: { rooms, predictions, settledFixtures, nextId, streaks, duels, chats, fixtureCache }
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cloud from './cloudsync.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// Where data.json and backups/ live. DATA_DIR overrides it (used by tests and any custom host).
// Test scripts (test_*.mjs) never touch real data: they get a fresh temp dir automatically, even
// when they forget to set DATA_DIR (ESM imports run before a test can set process.env).
const IS_TEST_RUN = /(^|[\\/])test_[^\\/]*\.mjs$/.test(process.argv[1] || '');
export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : IS_TEST_RUN
    ? fs.mkdtempSync(path.join(os.tmpdir(), 'stakeless-test-'))
    : here;
const FILE = path.join(DATA_DIR, 'data.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const KEEP = 5;
const FLUSH_MS = 250;
const BACKUP_EVERY_MS = Number(process.env.BACKUP_INTERVAL_MS) || 2 * 60 * 1000;

const emptyDb = () => ({ rooms: {}, predictions: [], settledFixtures: {}, nextId: 1 });

function validDb(obj) {
  return Boolean(obj) && typeof obj === 'object' && !Array.isArray(obj)
    && obj.rooms && typeof obj.rooms === 'object' && !Array.isArray(obj.rooms)
    && Array.isArray(obj.predictions);
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

function readDbFile(file) {
  const obj = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!validDb(obj)) throw new Error('unexpected data shape');
  return obj;
}

// Newest first. Backup names are ISO timestamps, so lexical order is time order.
function listBackups() {
  try {
    return fs.readdirSync(BACKUP_DIR)
      .filter((f) => /^data-.*\.json$/.test(f))
      .sort()
      .reverse()
      .map((f) => path.join(BACKUP_DIR, f));
  } catch {
    return [];
  }
}

// Write to a temp file, fsync it, then rename over the target. Rename is atomic on one filesystem.
function writeAtomic(file, text) {
  const tmp = `${file}.tmp-${process.pid}`;
  const buf = Buffer.from(text, 'utf8');
  const fd = fs.openSync(tmp, 'w');
  try {
    let off = 0;
    while (off < buf.length) off += fs.writeSync(fd, buf, off, buf.length - off);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

function removeLeftoverTemp() {
  try {
    for (const f of fs.readdirSync(DATA_DIR)) {
      if (f.startsWith('data.json.tmp-')) fs.unlinkSync(path.join(here, f));
    }
  } catch { /* nothing to clean */ }
}

function boot() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  removeLeftoverTemp();
  if (DATA_DIR !== here) console.log(`[store] data dir: ${DATA_DIR}`);
  if (!fs.existsSync(FILE)) return { db: emptyDb(), restored: false };
  // An empty file is treated like a missing one: restoreFromCloud() fills it before the server listens.
  if (fs.readFileSync(FILE, 'utf8').trim() === '') return { db: emptyDb(), restored: false };
  try {
    return { db: readDbFile(FILE), restored: false };
  } catch (err) {
    console.error(`[store] data.json is unreadable (${err.message}). Keeping a copy and looking for a backup.`);
    try { fs.copyFileSync(FILE, path.join(BACKUP_DIR, `data.corrupt-${stamp()}.json`)); } catch { /* best effort */ }
    for (const f of listBackups()) {
      try {
        const db = readDbFile(f);
        console.error(`[store] restored from backup ${path.basename(f)}`);
        return { db, restored: true };
      } catch {
        console.error(`[store] skipping unreadable backup ${path.basename(f)}`);
      }
    }
    console.error('[store] no valid backup found, starting with empty data.');
    return { db: emptyDb(), restored: false };
  }
}

const booted = boot();
let db = booted.db;
let dirty = booted.restored;
let timer = null;
let lastBackup = 0;
let cloudTimer = null;
let cloudLastPush = 0;
const CLOUD_EVERY_MS = 15 * 1000;

// True when data.json is missing, zero bytes, or only whitespace.
function localIsEmpty() {
  try {
    return fs.readFileSync(FILE, 'utf8').trim() === '';
  } catch {
    return true;
  }
}

// Number of leagues (rooms) in a database object.
function roomCount(obj) {
  return obj && obj.rooms && typeof obj.rooms === 'object' ? Object.keys(obj.rooms).length : 0;
}

// Known synthetic leagues from the build worker's tests (shipped by mistake in v34). A local data.json that
// contains any of these is never trusted over the GitHub copy, whatever its league count.
export const MOCK_CODES = new Set([
  '2LU9J6', 'AWS8S8', 'QRW4PQ', '9YK4YV', 'G4MPYZ', 'D4NZMN',
  'ZDWTEZ', 'KF3M7L', '99WGLX', 'D7S4WC', 'TK4BFS', 'C8ZV74',
]);

function localHasMockLeagues() {
  return Object.keys(db.rooms || {}).filter((code) => MOCK_CODES.has(code));
}

// Cloud safety: pushes are BLOCKED until a restore has succeeded (or the remote is
// confirmed empty/local). A failed restore followed by a push would overwrite the
// good backup with empty data - the exact bug that wiped leagues on 2026-10-24.
let cloudReady = false;

// Boot-time restore from the private GitHub repo. It ALWAYS checks the cloud copy. The old rule
// ("only restore when data.json is empty") never fired, because a deploy ships a data.json with
// no leagues in it (it is never zero bytes), so every deploy started with empty leagues.
// Rule: the copy with MORE leagues wins. Leagues are never deleted, so the copy with more is the newer one.
// Must run before the server starts listening.
export async function restoreFromCloud({ attempt = 0 } = {}) {
  if (!cloud.enabled) {
    console.log('cloud sync: disabled');
    cloudReady = true;
    return 'disabled';
  }
  console.log(`cloud sync: enabled (${cloud.describe()})`);
  let text;
  try {
    text = await cloud.syncDown();
  } catch (err) {
    console.error(`[cloudsync] restore failed (attempt ${attempt + 1}):`, err.message);
    if (attempt < 3) {
      await new Promise((r2) => setTimeout(r2, 5000));
      return restoreFromCloud({ attempt: attempt + 1 });
    }
    console.error('[cloudsync] restore failed after retries. Cloud pushes are BLOCKED until a restore succeeds.');
    return 'failed';
  }
  if (!text || !text.trim()) {
    console.log('cloud sync: no remote copy yet, starting fresh');
    cloudReady = true;
    return 'none';
  }
  let obj;
  try {
    obj = JSON.parse(text);
    if (!validDb(obj)) throw new Error('unexpected data shape');
  } catch (err) {
    console.error('[cloudsync] remote copy is unreadable, ignoring it:', err.message);
    cloudReady = true;
    return 'invalid';
  }
  // Tombstones: a league deleted on either side stays deleted. Union the tombstones, then drop
  // any league that has one, so a deleted league cannot come back from the GitHub copy.
  const tombs = { ...(obj.deletedRooms || {}), ...(db.deletedRooms || {}) };
  if (Object.keys(tombs).length) {
    obj.deletedRooms = tombs;
    for (const code of Object.keys(tombs)) {
      if (obj.rooms?.[code]) delete obj.rooms[code];
      if (Array.isArray(obj.predictions)) obj.predictions = obj.predictions.filter((p) => p.roomCode !== code);
      for (const key of ['chats', 'duels', 'streaks', 'shame']) if (obj[key]) delete obj[key][code];
    }
    for (const code of Object.keys(tombs)) {
      if (db.rooms?.[code]) {
        delete db.rooms[code];
        db.predictions = db.predictions.filter((p) => p.roomCode !== code);
        for (const key of ['chats', 'duels', 'streaks', 'shame']) if (db[key]) delete db[key][code];
      }
    }
    db.deletedRooms = tombs;
    obj.deletedRooms = tombs;
  }
  const localRooms = roomCount(db);
  const remoteRooms = roomCount(obj);
  cloudReady = true;
  const mocks = localHasMockLeagues();
  if (mocks.length) {
    // One-time guard: synthetic data on the local disk loses to the GitHub copy, regardless of count.
    console.log(`[store] local data.json contains ${mocks.length} mock league(s) (${mocks.join(', ')}); trusting the GitHub copy (${remoteRooms} leagues).`);
    writeAtomic(FILE, text);
    db = obj;
    dirty = false;
    return 'restored';
  }
  if (remoteRooms > localRooms) {
    writeAtomic(FILE, text);
    db = obj;
    dirty = false;
    console.log(`cloud sync: restored data.json from GitHub (${remoteRooms} leagues, local had ${localRooms})`);
    return 'restored';
  }
  console.log(`cloud sync: local has ${localRooms} leagues, remote has ${remoteRooms}, keeping local`);
  return 'local-kept';
}

// Pushes the latest data to GitHub at most once per minute. Fire-and-forget: failures are logged only.
let cloudFailures = 0;
function scheduleCloudPush() {
  if (!cloud.enabled || cloudTimer) return;
  if (!cloudReady) {
    console.error('[cloudsync] push skipped: no successful restore this boot. Retrying restore in 10s.');
    cloudTimer = setTimeout(() => { cloudTimer = null; restoreFromCloud().catch(() => {}); }, 10000);
    cloudTimer.unref?.();
    return;
  }
  const wait = Math.max(0, cloudLastPush + CLOUD_EVERY_MS - Date.now());
  cloudTimer = setTimeout(() => {
    cloudTimer = null;
    cloudLastPush = Date.now();
    cloud.syncUp(db).then(() => { cloudFailures = 0; }).catch((err) => {
      cloudFailures++;
      console.error(`[cloudsync] push failed (attempt ${cloudFailures}):`, err.message);
      // A failed push must not be dropped: retry quickly, then keep the data dirty
      // so the next save or a later retry still gets it to GitHub.
      if (cloudFailures <= 5) {
        cloudTimer = setTimeout(() => { cloudTimer = null; scheduleCloudPush(); }, 15000);
        cloudTimer.unref?.();
      } else {
        dirty = true;
      }
    });
  }, wait);
  cloudTimer.unref?.();
}

function writeBackup(text) {
  writeAtomic(path.join(BACKUP_DIR, `data-${stamp()}.json`), text);
  lastBackup = Date.now();
  for (const old of listBackups().slice(KEEP)) {
    try { fs.unlinkSync(old); } catch { /* already gone */ }
  }
}

// Writes data.json now. Returns true when something was written.
export function flushNow({ backup = false } = {}) {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!dirty && !backup) return false;
  const text = JSON.stringify(db, null, 2);
  writeAtomic(FILE, text);
  dirty = false;
  if (backup || Date.now() - lastBackup >= BACKUP_EVERY_MS) writeBackup(text);
  scheduleCloudPush();
  return true;
}

// Write-behind: callers keep calling save() freely, the disk is hit at most once per batch.
export function save() {
  dirty = true;
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    try {
      flushNow();
    } catch (err) {
      console.error('[store] write failed, retrying shortly:', err.message);
      dirty = true;
      timer = setTimeout(() => { timer = null; save(); }, 2000);
    }
  }, FLUSH_MS);
}

export function data() {
  return db;
}

export function nextId() {
  db.nextId = (db.nextId || 1) + 1;
  return db.nextId;
}

// Used by the shutdown handlers so a clean stop never loses the last batch.
// Delete must reach GitHub right away, not after the 1-minute push debounce, so a redeploy
// in that window cannot restore the league from an older cloud copy.
export function flushAndSyncNow() {
  flushNow({ backup: true });
  if (cloud.enabled && cloudReady) {
    return cloud.syncUp(db).catch((err) => console.error('[cloudsync] delete sync failed:', err.message));
  }
  return Promise.resolve();
}

export function flushOnExit() {
  try { flushNow({ backup: true }); } catch (err) { console.error('[store] final flush failed:', err.message); }
}
