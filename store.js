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
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cloud from './cloudsync.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, 'data.json');
const BACKUP_DIR = path.join(here, 'backups');
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
    for (const f of fs.readdirSync(here)) {
      if (f.startsWith('data.json.tmp-')) fs.unlinkSync(path.join(here, f));
    }
  } catch { /* nothing to clean */ }
}

function boot() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  removeLeftoverTemp();
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
const CLOUD_EVERY_MS = 60 * 1000;

// True when data.json is missing, zero bytes, or only whitespace.
function localIsEmpty() {
  try {
    return fs.readFileSync(FILE, 'utf8').trim() === '';
  } catch {
    return true;
  }
}

// Boot-time restore from the private GitHub repo. Only runs when the local file is missing or empty;
// an existing data.json is always kept because it is newer. Must run before the server starts listening.
export async function restoreFromCloud() {
  if (!cloud.enabled) {
    console.log('cloud sync: disabled');
    return 'disabled';
  }
  console.log(`cloud sync: enabled (${cloud.describe()})`);
  if (!localIsEmpty()) {
    console.log('cloud sync: local data.json present, keeping it');
    return 'local-kept';
  }
  let text;
  try {
    text = await cloud.syncDown();
  } catch (err) {
    console.error('[cloudsync] restore failed, starting with local data:', err.message);
    return 'failed';
  }
  if (!text || !text.trim()) {
    console.log('cloud sync: no remote copy yet, starting fresh');
    return 'none';
  }
  let obj;
  try {
    obj = JSON.parse(text);
    if (!validDb(obj)) throw new Error('unexpected data shape');
  } catch (err) {
    console.error('[cloudsync] remote copy is unreadable, ignoring it:', err.message);
    return 'invalid';
  }
  writeAtomic(FILE, text);
  db = obj;
  dirty = false;
  console.log('cloud sync: restored data.json from GitHub');
  return 'restored';
}

// Pushes the latest data to GitHub at most once per minute. Fire-and-forget: failures are logged only.
function scheduleCloudPush() {
  if (!cloud.enabled || cloudTimer) return;
  const wait = Math.max(0, cloudLastPush + CLOUD_EVERY_MS - Date.now());
  cloudTimer = setTimeout(() => {
    cloudTimer = null;
    cloudLastPush = Date.now();
    cloud.syncUp(db).catch((err) => console.error('[cloudsync] push failed:', err.message));
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
export function flushOnExit() {
  try { flushNow({ backup: true }); } catch (err) { console.error('[store] final flush failed:', err.message); }
}
