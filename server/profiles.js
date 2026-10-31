// Additive per-member profiles. Existing room/member records are not rewritten.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { data, save } from './store.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const PROFILE_IMAGE_DIR = path.join(ROOT, '..', 'public', 'uploads', 'profiles');
export const PROFILE_IMAGE_MAX = 2 * 1024 * 1024;
export const BIO_MAX = 140;
export const PROFILE_NAME_MAX = 32;
const HOSTS = {
  x: new Set(['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com']),
  tiktok: new Set(['tiktok.com', 'www.tiktok.com']),
  facebook: new Set(['facebook.com', 'www.facebook.com', 'm.facebook.com']),
};

export function validateSocialUrl(platform, value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  let u;
  try { u = new URL(text); } catch { throw new Error(`Enter a full https URL for ${platform}.`); }
  if (u.protocol !== 'https:' || u.username || u.password || u.port || !HOSTS[platform]?.has(u.hostname.toLowerCase()) || !u.pathname || u.pathname === '/') {
    throw new Error(`Enter a valid ${platform} profile URL.`);
  }
  return u.href;
}

export function validateProfile(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Profile details are required.');
  const displayName = String(input.displayName ?? '').replace(/\s+/g, ' ').trim();
  if (!displayName || displayName.length > PROFILE_NAME_MAX) throw new Error(`Display name must be 1 to ${PROFILE_NAME_MAX} characters.`);
  const bio = String(input.bio ?? '').trim();
  if (bio.length > BIO_MAX) throw new Error(`Bio must be ${BIO_MAX} characters or fewer.`);
  return {
    displayName,
    bio,
    social: {
      x: validateSocialUrl('x', input.social?.x),
      tiktok: validateSocialUrl('tiktok', input.social?.tiktok),
      facebook: validateSocialUrl('facebook', input.social?.facebook),
    },
  };
}

function memberById(id) {
  const n = Number(id);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  for (const room of Object.values(data().rooms || {})) {
    const member = room?.members?.find((m) => Number(m.id) === n);
    if (member) return member;
  }
  return null;
}

function safeProfile(id) {
  const p = data().profiles?.[String(id)] || {};
  return {
    memberId: Number(id),
    displayName: p.displayName || memberById(id)?.name || 'Player',
    bio: p.bio || '',
    avatarUrl: p.avatarFile ? `/uploads/profiles/${encodeURIComponent(p.avatarFile)}` : null,
    defaultAvatarUrl: '/football-mark.svg',
    social: p.social || { x: '', tiktok: '', facebook: '' },
  };
}

export function profileForMember(member) {
  const p = data().profiles?.[String(member?.id)] || {};
  return {
    displayName: p.displayName || member?.name || 'Player',
    avatarUrl: p.avatarFile ? `/uploads/profiles/${encodeURIComponent(p.avatarFile)}` : null,
  };
}

export function getProfile(id) {
  const member = memberById(id);
  if (!member) throw new Error('Player profile not found.');
  return safeProfile(id);
}

export async function updateProfile(id, input = {}) {
  const member = memberById(id);
  if (!member) throw new Error('Player profile not found.');
  if (Number(input.memberId) !== Number(id)) throw new Error('You can only edit your own profile.');
  const fields = validateProfile(input);
  let avatarFile;
  if (input.avatarData) {
    const match = String(input.avatarData).match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]*={0,2})$/);
    if (!match) throw new Error('Choose a PNG, JPG or WebP image.');
    const bytes = Buffer.from(match[2], 'base64');
    if (!bytes.length || bytes.length > PROFILE_IMAGE_MAX || bytes.toString('base64').replace(/=+$/, '') !== match[2].replace(/=+$/, '')) {
      throw new Error('Profile pictures must be no larger than 2 MB.');
    }
    let image;
    try {
      image = sharp(bytes, { limitInputPixels: 20_000_000, failOn: 'error' });
      const meta = await image.metadata();
      if (!['png', 'jpeg', 'webp'].includes(meta.format)) throw new Error('unsupported format');
      fs.mkdirSync(PROFILE_IMAGE_DIR, { recursive: true });
      avatarFile = `${Number(id)}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}.png`;
      const dest = path.join(PROFILE_IMAGE_DIR, avatarFile);
      await image.rotate().resize(256, 256, { fit: 'cover', position: 'attention' }).png({ compressionLevel: 9 }).toFile(dest);
    } catch (err) {
      if (avatarFile) { try { fs.unlinkSync(path.join(PROFILE_IMAGE_DIR, avatarFile)); } catch {} }
      throw new Error(err.message?.includes('unsupported format') ? 'Choose a valid PNG, JPG or WebP image.' : 'Could not process that image. Choose a valid PNG, JPG or WebP file.');
    }
  }
  const db = data();
  db.profiles ||= {};
  const old = db.profiles[String(id)] || {};
  db.profiles[String(id)] = { ...fields, ...(avatarFile ? { avatarFile } : old.avatarFile ? { avatarFile: old.avatarFile } : {}) };
  save();
  return safeProfile(id);
}
