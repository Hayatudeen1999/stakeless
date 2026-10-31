// Mock tests for the v29 self-leave logic. Fake clock, real rooms.js functions, no real data file touched.
import assert from 'node:assert/strict';
import { createRoom, joinRoom, predict, leaveRoom, renameRoom } from './server/rooms.js';
import { data } from './server/store.js';

let passed = 0;
const ok = (name, fn) => { try { fn(); passed++; console.log('PASS', name); } catch (e) { console.log('FAIL', name, '-', e.message); process.exitCode = 1; } };

const fixtures = [
  { id: 'a1', competition: 'PL', kickoff: '2026-11-25T12:00:00Z', status: 'SCHEDULED', home: 'Arsenal', away: 'Chelsea' },
  { id: 'a2', competition: 'PL', kickoff: '2026-10-25T16:00:00Z', status: 'SCHEDULED', home: 'Spurs', away: 'Villa' },
];
const { code, memberId: owner } = createRoom({ name: 'Leave League', playerName: 'Owner' });
const { memberId: mem } = joinRoom({ code, playerName: 'Leaver' });
const { memberId: stay } = joinRoom({ code, playerName: 'Stayer' });

ok('member leaves: left=true and removed from members', () => {
  predict({ code, memberId: mem, fixtureId: 'a1', pick: 'H', hg: '', ag: '' }, fixtures);
  const out = leaveRoom({ code, memberId: mem });
  assert.equal(out.left, true);
  assert.equal(out.code, code);
  assert.ok(!data().rooms[code].members.some((m) => m.id === mem));
});
ok('leaver predictions are removed with them', () => {
  assert.equal(data().predictions.filter((p) => p.roomCode === code && p.memberId === mem).length, 0);
});
ok('other members stay in the league', () => {
  assert.ok(data().rooms[code].members.some((m) => m.id === stay));
  assert.ok(data().rooms[code].members.some((m) => m.id === owner));
});
ok('owner is refused with the Delete-league pointer (not removed)', () => {
  assert.throws(() => leaveRoom({ code, memberId: owner }), /owner cannot leave\. Delete the league instead/);
  assert.ok(data().rooms[code].members.some((m) => m.id === owner));
});
ok('non-member is a no-op (left=false, reason not_member), nothing changes', () => {
  const before = JSON.stringify(data().rooms[code].members);
  const out = leaveRoom({ code, memberId: 999999 });
  assert.equal(out.left, false);
  assert.equal(out.reason, 'not_member');
  assert.equal(JSON.stringify(data().rooms[code].members), before);
});
ok('unknown league code is a no-op (reason not_found)', () => {
  const out = leaveRoom({ code: 'ZZZZZZ', memberId: mem });
  assert.equal(out.left, false);
  assert.equal(out.reason, 'not_found');
});
ok('a second leave by the same person is a no-op, not an error', () => {
  const out = leaveRoom({ code, memberId: mem });
  assert.equal(out.left, false);
  assert.equal(out.reason, 'not_member');
});
ok('owner-only delete still refuses a non-owner (unchanged path)', () => {
  assert.throws(() => renameRoom({ code, memberId: stay, name: 'x' }), /Only the league owner/);
});
ok('code is case-insensitive and trimmed on leave', () => {
  const { memberId: m3 } = joinRoom({ code, playerName: 'Third' });
  const out = leaveRoom({ code: ` ${code.toLowerCase()} `, memberId: m3 });
  assert.equal(out.left, true);
});
console.log(`\n${passed} passed`);
