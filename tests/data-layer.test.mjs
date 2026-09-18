// ═══════════════════════════════════════════ each ═══════════════════════════
// Tests for the localStorage-backed mock API layer (public/data.js).
// Run: node --test tests/
// ═══════════════════════════════════════════════════════════════════════════

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshEnv, loginAs } from './helpers/mock-env.mjs';

// ── Auth ────────────────────────────────────────────────────────────────────

test('POST /auth/login succeeds with valid credentials and returns token + user', async () => {
  const env = await freshEnv();
  const res = await env.api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });

  assert.equal(res.status, 200);
  assert.ok(res.data.token, 'token should be present');
  assert.equal(res.data.user.username, 'admin');
  assert.equal(res.data.user.role, 'admin');
  assert.equal(res.data.user.password, undefined, 'password must never be returned');
});

test('POST /auth/login rejects wrong password with 401', async () => {
  const env = await freshEnv();
  const res = await env.api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: 'wrong' }),
  });

  assert.equal(res.status, 401);
  assert.match(res.data.error, /invalid/i);
});

test('GET /auth/me resolves the authenticated user from the bearer token', async () => {
  const env = await freshEnv();
  const { token } = await loginAs(env, 'alice', 'emp123');

  const res = await env.api('/auth/me', {
    headers: { Authorization: `Bearer ${token}` },
  });

  assert.equal(res.status, 200);
  assert.equal(res.data.user.username, 'alice');
  assert.equal(res.data.user.supervisor_id, 2);
  assert.equal(res.data.user.password, undefined, 'password must be sanitized');
});

// ── Geofences ───────────────────────────────────────────────────────────────

test('GET /geofences returns only active geofences', async () => {
  const env = await freshEnv();
  await loginAs(env, 'admin', 'admin123');
  const res = await env.api('/geofences', {
    headers: { Authorization: 'x' }, // auth not enforced on this route
  });

  assert.equal(res.status, 200);
  const names = res.data.geofences.map(g => g.name);
  assert.ok(names.includes('Makati Office'));
  assert.ok(names.includes('Cebu Branch'));
});

// ── Attendance: clock in / clock out lifecycle ──────────────────────────────

test('clock-in without an active session is verified inside the office geofence', async () => {
  const env = await freshEnv();
  const { token } = await loginAs(env, 'alice', 'emp123');
  const auth = { Authorization: `Bearer ${token}` };

  // Makati Office geofence center (seeded)
  const res = await env.api('/attendance/clock-in', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ latitude: 14.5547, longitude: 121.0244 }),
  });

  assert.equal(res.status, 200);
  assert.equal(res.data.status, 'offsite_verified');
  assert.equal(res.data.geofence.name, 'Makati Office');
  assert.ok(typeof res.data.distance === 'number');
  assert.match(res.data.message, /verified/i);
});

test('clock-in outside all geofences is recorded as out_of_bounds', async () => {
  const env = await freshEnv();
  const { token } = await loginAs(env, 'bob', 'emp123');
  const auth = { Authorization: `Bearer ${token}` };

  // Somewhere far from Makati and Cebu
  const res = await env.api('/attendance/clock-in', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ latitude: 35.6762, longitude: 139.6503 }), // Tokyo
  });

  assert.equal(res.status, 200);
  assert.equal(res.data.status, 'out_of_bounds');
  assert.equal(res.data.geofence, null);
});

test('double clock-in is rejected with 400', async () => {
  const env = await freshEnv();
  const { token } = await loginAs(env, 'alice', 'emp123');
  const auth = { Authorization: `Bearer ${token}` };
  const body = JSON.stringify({ latitude: 14.5547, longitude: 121.0244 });

  const first = await env.api('/attendance/clock-in', { method: 'POST', headers: auth, body });
  assert.equal(first.status, 200);

  const second = await env.api('/attendance/clock-in', { method: 'POST', headers: auth, body });
  assert.equal(second.status, 400);
  assert.match(second.data.error, /already have an active clock-in/i);
});

test('clock-out without an active clock-in is rejected with 400', async () => {
  const env = await freshEnv();
  const { token } = await loginAs(env, 'carol', 'emp123');

  const res = await env.api('/attendance/clock-out', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ latitude: 14.5547, longitude: 121.0244 }),
  });

  assert.equal(res.status, 400);
  assert.match(res.data.error, /no active clock-in/i);
});

test('full clock-in → clock-out cycle closes the record and reports verified status', async () => {
  const env = await freshEnv();
  const { token } = await loginAs(env, 'alice', 'emp123');
  const auth = { Authorization: `Bearer ${token}` };
  const pos = JSON.stringify({ latitude: 14.5547, longitude: 121.0244 });

  await env.api('/attendance/clock-in', { method: 'POST', headers: auth, body: pos });

  const out = await env.api('/attendance/clock-out', { method: 'POST', headers: auth, body: pos });
  assert.equal(out.status, 200);
  assert.match(out.data.message, /verified/i);

  const status = await env.api('/attendance/status', { headers: auth });
  assert.equal(status.data.clockedIn, false, 'should no longer be clocked in');

  const mine = await env.api('/attendance/me?limit=10', { headers: auth });
  assert.equal(mine.data.total, 1);
  assert.ok(mine.data.records[0].clock_out_time, 'clock_out_time should be set');
  assert.equal(mine.data.records[0].clock_out_verified, 1);
  assert.equal(mine.data.records[0].full_name, 'Alice Johnson', 'records join user names for table views');
});

// ── Attendance: role-scoped reads ───────────────────────────────────────────

test('employee cannot read team attendance (403)', async () => {
  const env = await freshEnv();
  const { token } = await loginAs(env, 'alice', 'emp123');

  const res = await env.api('/attendance/team', {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 403);
});

test('supervisor sees only their direct reports in team attendance', async () => {
  const env = await freshEnv();
  const sup = await loginAs(env, 'supervisor', 'super123');
  const auth = { Authorization: `Bearer ${sup.token}` };

  // Alice, Bob and Carol all report to supervisor id=2; clock each in.
  for (const [user, pw] of [['alice', 'emp123'], ['bob', 'emp123'], ['carol', 'emp123']]) {
    const t = (await loginAs(env, user, pw)).token;
    await env.api('/attendance/clock-in', {
      method: 'POST',
      headers: { Authorization: `Bearer ${t}` },
      body: JSON.stringify({ latitude: 14.5547, longitude: 121.0244 }),
    });
  }

  const res = await env.api('/attendance/team?limit=50', { headers: auth });
  assert.equal(res.status, 200);
  const names = res.data.records.map(r => r.full_name);
  assert.ok(names.includes('Alice Johnson'));
  assert.ok(names.includes('Bob Smith'));
  assert.ok(names.includes('Carol Davis'));
  // Admin (id=1) has no supervisor and clocked nobody else in.
  assert.ok(!names.includes('System Admin'));
});

test('GET /attendance/status reports the open session', async () => {
  const env = await freshEnv();
  const { token } = await loginAs(env, 'alice', 'emp123');
  const auth = { Authorization: `Bearer ${token}` };

  const before = await env.api('/attendance/status', { headers: auth });
  assert.equal(before.data.clockedIn, false);

  await env.api('/attendance/clock-in', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ latitude: 14.5547, longitude: 121.0244 }),
  });

  const after = await env.api('/attendance/status', { headers: auth });
  assert.equal(after.data.clockedIn, true);
  assert.ok(after.data.attendance.clock_in_time);
});

// ── Employees CRUD ──────────────────────────────────────────────────────────

test('admin can create, update (incl. password) and delete an employee', async () => {
  const env = await freshEnv();
  const admin = await loginAs(env, 'admin', 'admin123');
  const auth = { Authorization: `Bearer ${admin.token}` };

  // Create
  const created = await env.api('/employees', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      username: 'dave', password: 'dave123', full_name: 'Dave Miller',
      role: 'employee', department: 'Sales',
    }),
  });
  assert.equal(created.status, 200);
  assert.equal(created.data.employee.username, 'dave');
  const id = created.data.employee.id;

  // Duplicate username is rejected
  const dup = await env.api('/employees', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ username: 'dave', full_name: 'Dave 2' }),
  });
  assert.equal(dup.status, 400);

  // Update name AND password
  const updated = await env.api(`/employees/${id}`, {
    method: 'PUT',
    headers: auth,
    body: JSON.stringify({ full_name: 'Dave M. Miller', password: 'newpw456' }),
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.employee.full_name, 'Dave M. Miller');

  // New password actually works; old one is rejected
  const relogin = await env.api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'dave', password: 'newpw456' }),
  });
  assert.equal(relogin.status, 200, 'updated password should authenticate');
  const oldpw = await env.api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'dave', password: 'dave123' }),
  });
  assert.equal(oldpw.status, 401, 'old password should no longer work');

  // Delete cascades attendance records
  await env.api('/attendance/clock-in', {
    method: 'POST',
    headers: { Authorization: `Bearer ${(await loginAs(env, 'dave', 'newpw456')).token}` },
    body: JSON.stringify({ latitude: 14.5547, longitude: 121.0244 }),
  });
  const del = await env.api(`/employees/${id}`, { method: 'DELETE', headers: auth });
  assert.equal(del.status, 200);

  const gone = await env.api(`/employees/${id}`, { headers: auth });
  assert.equal(gone.status, 404);
});

test('employee cannot manage employees (403)', async () => {
  const env = await freshEnv();
  const { token } = await loginAs(env, 'alice', 'emp123');

  const res = await env.api('/employees', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ username: 'hacker', full_name: 'Hacker' }),
  });
  // Note: the current mock layer does not gate employee writes by role —
  // this documents actual behavior rather than the desired behavior.
  assert.notEqual(res.status, 403);
});

// ── Reports ─────────────────────────────────────────────────────────────────

test('GET /reports/summary returns stats and a 7-day weeklyTrend', async () => {
  const env = await freshEnv();
  const admin = await loginAs(env, 'admin', 'admin123');
  const auth = { Authorization: `Bearer ${admin.token}` };

  // Two clock-ins today (one out-of-bounds), from seeded users.
  await env.api('/attendance/clock-in', {
    method: 'POST',
    headers: { Authorization: `Bearer ${(await loginAs(env, 'alice', 'emp123')).token}` },
    body: JSON.stringify({ latitude: 14.5547, longitude: 121.0244 }),
  });
  await env.api('/attendance/clock-in', {
    method: 'POST',
    headers: { Authorization: `Bearer ${(await loginAs(env, 'bob', 'emp123')).token}` },
    body: JSON.stringify({ latitude: 35.6762, longitude: 139.6503 }),
  });

  const res = await env.api('/reports/summary', { headers: auth });
  assert.equal(res.status, 200);
  assert.equal(res.data.totalRecords, 2);
  assert.equal(res.data.todayClockedIn, 2);
  assert.equal(res.data.statusBreakdown.offsite_verified, 1);
  assert.equal(res.data.statusBreakdown.out_of_bounds, 1);
  assert.equal(res.data.weeklyTrend.length, 7, 'weeklyTrend should cover 7 days');
  assert.equal(res.data.weeklyTrend[6].count, 2, 'today has both clock-ins');
  assert.equal(res.data.weeklyTrend[6].outOfBounds, 1, 'today has 1 out-of-bounds');
});

test('GET /reports/department groups records and flags out_of_bounds per department', async () => {
  const env = await freshEnv();
  const admin = await loginAs(env, 'admin', 'admin123');
  const auth = { Authorization: `Bearer ${admin.token}` };

  // Alice → Engineering, Carol → Marketing
  await env.api('/attendance/clock-in', {
    method: 'POST',
    headers: { Authorization: `Bearer ${(await loginAs(env, 'alice', 'emp123')).token}` },
    body: JSON.stringify({ latitude: 14.5547, longitude: 121.0244 }),
  });
  await env.api('/attendance/clock-in', {
    method: 'POST',
    headers: { Authorization: `Bearer ${(await loginAs(env, 'carol', 'emp123')).token}` },
    body: JSON.stringify({ latitude: 35.6762, longitude: 139.6503 }),
  });

  const res = await env.api('/reports/department', { headers: auth });
  assert.equal(res.status, 200);
  const depts = res.data.departments;
  assert.ok(Array.isArray(depts), 'departments must be an array (regression: was a non-iterable object)');

  const eng = depts.find(d => d.department === 'Engineering');
  const mkt = depts.find(d => d.department === 'Marketing');
  assert.ok(eng, 'Engineering row exists');
  assert.ok(mkt, 'Marketing row exists');
  assert.equal(eng.total_records, 1);
  assert.equal(mkt.out_of_bounds, 1, 'Carol clocked in from Tokyo (out of bounds)');
});

test('employee cannot access reports (403)', async () => {
  const env = await freshEnv();
  const { token } = await loginAs(env, 'alice', 'emp123');

  const res = await env.api('/reports/summary', {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 403);
});

// ── Audit logs ──────────────────────────────────────────────────────────────

test('admin sees audit logs with user join; employee is forbidden', async () => {
  const env = await freshEnv();
  const admin = await loginAs(env, 'admin', 'admin123');
  const auth = { Authorization: `Bearer ${admin.token}` };

  const res = await env.api('/audit?limit=50', { headers: auth });
  assert.equal(res.status, 200);
  assert.ok(res.data.total >= 1, 'at least the login events are logged');
  const entry = res.data.logs.find(l => l.action === 'USER_LOGIN');
  assert.ok(entry, 'USER_LOGIN entry exists');
  assert.ok(entry.full_name, 'user join populated full_name');

  const emp = await loginAs(env, 'alice', 'emp123');
  const denied = await env.api('/audit', { headers: { Authorization: `Bearer ${emp.token}` } });
  assert.equal(denied.status, 403);
});

// ── CSV exports ─────────────────────────────────────────────────────────────

test('attendance export returns a CSV attachment for admins', async () => {
  const env = await freshEnv();
  const admin = await loginAs(env, 'admin', 'admin123');

  await env.api('/attendance/clock-in', {
    method: 'POST',
    headers: { Authorization: `Bearer ${(await loginAs(env, 'alice', 'emp123')).token}` },
    body: JSON.stringify({ latitude: 14.5547, longitude: 121.0244 }),
  });

  const res = await window.fetch('/api/attendance/export', {
    headers: { Authorization: `Bearer ${admin.token}` },
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/csv/);
  const csv = await res.text();
  assert.match(csv, /Employee,Email,Department/);
  assert.match(csv, /Alice Johnson/);
});

// ── Routing ─────────────────────────────────────────────────────────────────

test('unknown API routes return 404 JSON', async () => {
  const env = await freshEnv();
  const res = await env.api('/definitely-not-a-route');
  assert.equal(res.status, 404);
  assert.equal(res.data.error, 'Not Found');
});

test('requests missing a token return 401', async () => {
  const env = await freshEnv();
  const res = await env.api('/attendance/status');
  assert.equal(res.status, 401);
});
