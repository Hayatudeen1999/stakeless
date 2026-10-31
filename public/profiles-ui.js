const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DEFAULT_AVATAR = '/football-mark.svg';
async function getProfile(id) {
  const res = await fetch(`/api/profiles/${encodeURIComponent(id)}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'Profile could not load.');
  return body.profile;
}
async function saveProfile(id, body) {
  const res = await fetch(`/api/profiles/${encodeURIComponent(id)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'Profile could not save.');
  return json.profile;
}
function closeProfile() { document.getElementById('profile-modal')?.remove(); }
function showProfile(profile, ownId = null) {
  closeProfile();
  const modal = document.createElement('div');
  modal.id = 'profile-modal';
  modal.className = 'profile-overlay';
  const p = profile;
  const avatar = p.avatarUrl || p.defaultAvatarUrl || DEFAULT_AVATAR;
  const socials = [
    ['x', '𝕏', 'X'], ['tiktok', '♪', 'TikTok'], ['facebook', 'f', 'Facebook'],
  ].filter(([key]) => p.social?.[key]).map(([key, icon, label]) => `<a class="profile-social" href="${esc(p.social[key])}" target="_blank" rel="noopener noreferrer" aria-label="${label}" title="${label}">${icon}</a>`).join('');
  modal.innerHTML = `<section class="profile-dialog" role="dialog" aria-modal="true" aria-label="${esc(p.displayName)} profile"><button type="button" class="profile-close" aria-label="Close">×</button><img class="profile-avatar-large" src="${esc(avatar)}" alt="${esc(p.displayName)}" onerror="this.onerror=null;this.src='${DEFAULT_AVATAR}'"><h2>${esc(p.displayName)}</h2>${p.bio ? `<p class="profile-bio">${esc(p.bio)}</p>` : '<p class="profile-bio muted">No bio yet</p>'}<nav class="profile-socials">${socials || '<span class="muted">No social links yet</span>'}</nav>${ownId != null ? '<button type="button" class="profile-edit-button">Edit profile</button>' : ''}<p class="profile-error" role="status"></p></section>`;
  modal.addEventListener('click', (e) => { if (e.target === modal || e.target.closest('.profile-close')) closeProfile(); });
  document.body.appendChild(modal);
  const edit = modal.querySelector('.profile-edit-button');
  if (edit) edit.onclick = () => editProfile(p.memberId, ownId);
}
async function editProfile(targetId, memberId) {
  const modal = document.getElementById('profile-modal');
  if (!modal) return;
  const p = await getProfile(targetId);
  const dialog = modal.querySelector('.profile-dialog');
  dialog.innerHTML = `<button type="button" class="profile-close" aria-label="Close">×</button><h2>Edit profile</h2><label>Display name<input id="profile-name" maxlength="32" required value="${esc(p.displayName)}"></label><label>Bio <span class="muted">(max 140)</span><textarea id="profile-bio" maxlength="140" rows="4">${esc(p.bio)}</textarea></label><label>Profile picture <span class="muted">(PNG, JPG or WebP, max 10 MB)</span><input id="profile-image" type="file" accept="image/png,image/jpeg,image/webp"></label><img class="profile-avatar-preview" src="${esc(p.avatarUrl || DEFAULT_AVATAR)}" alt="Profile picture preview"><label>X profile URL<input id="profile-x" type="url" placeholder="https://x.com/yourname" value="${esc(p.social?.x || '')}"></label><label>TikTok profile URL<input id="profile-tiktok" type="url" placeholder="https://www.tiktok.com/@yourname" value="${esc(p.social?.tiktok || '')}"></label><label>Facebook profile URL<input id="profile-facebook" type="url" placeholder="https://www.facebook.com/yourname" value="${esc(p.social?.facebook || '')}"></label><p class="profile-error" role="status"></p><button type="button" class="profile-save">Save profile</button>`;
  dialog.querySelector('.profile-close').onclick = closeProfile;
  const imageInput = dialog.querySelector('#profile-image');
  imageInput.onchange = () => {
    const file = imageInput.files?.[0];
    if (file && file.size > 10 * 1024 * 1024) { imageInput.value = ''; dialog.querySelector('.profile-error').textContent = 'Choose an image no larger than 10 MB.'; return; }
    if (file && !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { imageInput.value = ''; dialog.querySelector('.profile-error').textContent = 'Choose a PNG, JPG or WebP image.'; return; }
    if (file) dialog.querySelector('.profile-avatar-preview').src = URL.createObjectURL(file);
  };
  dialog.querySelector('.profile-save').onclick = async () => {
    const error = dialog.querySelector('.profile-error');
    error.textContent = '';
    const file = imageInput.files?.[0];
    if (file && file.size > 10 * 1024 * 1024) { error.textContent = 'Choose an image no larger than 10 MB.'; return; }
    if (file && !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { error.textContent = 'Choose a PNG, JPG or WebP image.'; return; }
    const body = { memberId: Number(memberId), displayName: dialog.querySelector('#profile-name').value, bio: dialog.querySelector('#profile-bio').value, social: { x: dialog.querySelector('#profile-x').value, tiktok: dialog.querySelector('#profile-tiktok').value, facebook: dialog.querySelector('#profile-facebook').value } };
    if (file) body.avatarData = `data:${file.type};base64,${await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1]); r.onerror = reject; r.readAsDataURL(file); })}`;
    try { showProfile(await saveProfile(targetId, body), memberId); }
    catch (e) { error.textContent = e.message; }
  };
}
document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-profile]');
  if (!button) return;
  const targetId = Number(button.dataset.profile);
  const ownId = button.dataset.ownProfile ? Number(button.dataset.ownProfile) : null;
  if (!targetId) return;
  try { showProfile(await getProfile(targetId), ownId); }
  catch (e) { const existing = document.getElementById('profile-modal'); if (existing) existing.querySelector('.profile-error').textContent = e.message; }
});
