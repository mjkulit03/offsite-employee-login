// ═══════════════════════════════════════════════════════════════════════════
// Client-side data layer — replaces the Express/SQLite backend entirely.
// Intercepts window.fetch() so every existing API call in app.js works
// unchanged, backed by localStorage for persistence.
// ═══════════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ── Storage helpers ──────────────────────────────────────────────────────
  const PFX = 'at_';
  function getStore(key) {
    try { return JSON.parse(localStorage.getItem(PFX + key)) || []; }
    catch { return []; }
  }
  function setStore(key, data) { localStorage.setItem(PFX + key, JSON.stringify(data)); }
  function nextId(items) { return items.length ? Math.max(...items.map(i => i.id)) + 1; }
  function now() { return new Date().toISOString().replace('T', ' ').slice(0, 19); }
  function today() { return new Date().toISOString().slice(0, 10); }

  // ── Haversine distance (meters) ──────────────────────────────────────────
  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000, toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function verifyLocation(lat, lng) {
    const geofences = getStore('geofences').filter(g => g.is_active);
    for (const gf of geofences) {
      const d = haversine(lat, lng, gf.latitude, gf.longitude);
      if (d <= gf.radius_m) return { verified: true, geofence: gf, distance: Math.round(d) };
    }
    return { verified: false, geofence: null, distance: null };
  }

  // ── Seed default data on first visit ─────────────────────────────────────
  function seedIfNeeded() {
    if (getStore('seeded').length) return;

    const hash = s => s; // plain-text passwords (client-side demo)

    setStore('users', [
      { id: 1, username: 'admin', email: 'admin@company.com', password: hash('admin123'), full_name: 'System Admin', role: 'admin', department: 'Administration', supervisor_id: null, is_active: 1, created_at: '2025-01-01 00:00:00', updated_at: '2025-01-01 00:00:00' },
      { id: 2, username: 'supervisor', email: 'supervisor@company.com', password: hash('super123'), full_name: 'Team Supervisor', role: 'supervisor', department: 'Engineering', supervisor_id: null, is_active: 1, created_at: '2025-01-01 00:00:00', updated_at: '2025-01-01 00:00:00' },
      { id: 3, username: 'alice', email: 'alice@company.com', password: hash('emp123'), full_name: 'Alice Johnson', role: 'employee', department: 'Engineering', supervisor_id: 2, is_active: 1, created_at: '2025-01-01 00:00:00', updated_at: '2025-01-01 00:00:00' },
      { id: 4, username: 'bob', email: 'bob@company.com', password: hash('emp123'), full_name: 'Bob Smith', role: 'employee', department: 'Engineering', supervisor_id: 2, is_active: 1, created_at: '2025-01-01 00:00:00', updated_at: '2025-01-01 00:00:00' },
      { id: 5, username: 'carol', email: 'carol@company.com', password: hash('emp123'), full_name: 'Carol Davis', role: 'employee', department: 'Marketing', supervisor_id: 2, is_active: 1, created_at: '2025-01-01 00:00:00', updated_at: '2025-01-01 00:00:00' },
    ]);

    setStore('geofences', [
      { id: 1, name: 'Makati Office', latitude: 14.5547, longitude: 121.0244, radius_m: 500, description: 'Main office - Makati City', is_active: 1, created_by: 1, created_at: '2025-01-01 00:00:00' },
      { id: 2, name: 'Cebu Branch', latitude: 10.3157, longitude: 123.8854, radius_m: 750, description: 'Branch office - Cebu City', is_active: 1, created_by: 1, created_at: '2025-01-01 00:00:00' },
    ]);

    setStore('attendance', []);
    setStore('audit_logs', []);
    setStore('seeded', [true]);
  }

  seedIfNeeded();

  // ── Route handlers ───────────────────────────────────────────────────────

  // --- Auth ---
  function handleLogin(body) {
    const users = getStore('users');
    const user = users.find(u => u.username === body.username && u.password === body.password);
    if (!user) return err(401, 'Invalid username or password');
    if (!user.is_active) return err(403, 'Account is deactivated');
    const token = btoa(JSON.stringify({ userId: user.id, role: user.role, ts: Date.now() }));
    logAudit(user.id, 'USER_LOGIN', 'User logged in: ' + user.username);
    return ok({ token, user: { id: user.id, username: user.username, full_name: user.full_name, role: user.role, department: user.department } });
  }

  function handleGetMe(token) {
    const u = getUserFromToken(token);
    if (!u) return err(401, 'Authentication required');
    return ok({ user: { id: u.id, username: u.username, full_name: u.full_name, role: u.role, department: u.department, supervisor_id: u.supervisor_id, is_active: u.is_active, created_at: u.created_at } });
  }

  // --- Employees ---
  function handleGetEmployees(url) {
    let users = getStore('users').map(sanitize);
    // query params
    const q = new URL(url, location.href);
    const limit = Number(q.searchParams.get('limit')) || 200;
    return ok({ employees: users.slice(0, limit), total: users.length });
  }

  function handleGetEmployee(id) {
    const users = getStore('users');
    const u = users.find(x => x.id === id);
    if (!u) return err(404, 'Employee not found');
    return ok({ employee: sanitize(u) });
  }

  function handleCreateEmployee(body) {
    const users = getStore('users');
    if (users.find(u => u.username === body.username)) return err(400, 'Username already exists');
    const emp = {
      id: nextId(users), username: body.username, email: body.email || '',
      password: body.password || 'changeme', full_name: body.full_name,
      role: body.role || 'employee', department: body.department || '',
      supervisor_id: body.supervisor_id || null, is_active: 1,
      created_at: now(), updated_at: now()
    };
    users.push(emp); setStore('users', users);
    logAudit(null, 'EMPLOYEE_CREATED', 'Created employee: ' + emp.username);
    return ok({ employee: sanitize(emp) });
  }

  function handleUpdateEmployee(id, body) {
    const users = getStore('users');
    const idx = users.findIndex(x => x.id === id);
    if (idx === -1) return err(404, 'Employee not found');
    Object.assign(users[idx], {
      full_name: body.full_name || users[idx].full_name,
      email: body.email ?? users[idx].email,
      role: body.role || users[idx].role,
      department: body.department ?? users[idx].department,
      supervisor_id: body.supervisor_id ?? users[idx].supervisor_id,
      updated_at: now()
    });
    if (body.password) users[idx].password = body.password;
    setStore('users', users);
    logAudit(null, 'EMPLOYEE_UPDATED', 'Updated employee: ' + users[idx].username);
    return ok({ employee: sanitize(users[idx]) });
  }

  function handleDeleteEmployee(id) {
    let users = getStore('users');
    const u = users.find(x => x.id === id);
    if (!u) return err(404, 'Employee not found');
    users = users.filter(x => x.id !== id);
    setStore('users', users);
    let att = getStore('attendance').filter(a => a.user_id !== id);
    setStore('attendance', att);
    logAudit(null, 'EMPLOYEE_DELETED', 'Deleted employee: ' + u.username);
    return ok({ message: 'Employee deleted' });
  }

  // --- Geofences ---
  function handleGetGeofences() {
    return ok({ geofences: getStore('geofences').filter(g => g.is_active) });
  }
  function handleGetAllGeofences() {
    return ok({ geofences: getStore('geofences') });
  }
  function handleGetGeofence(id) {
    const gf = getStore('geofences').find(g => g.id === id);
    if (!gf) return err(404, 'Geofence not found');
    return ok({ geofence: gf });
  }
  function handleCreateGeofence(body) {
    const geos = getStore('geofences');
    const gf = {
      id: nextId(geos), name: body.name, latitude: body.latitude, longitude: body.longitude,
      radius_m: body.radius_m || 500, description: body.description || '', is_active: 1,
      created_by: body.created_by || null, created_at: now()
    };
    geos.push(gf); setStore('geofences', geos);
    return ok({ geofence: gf });
  }
  function handleUpdateGeofence(id, body) {
    const geos = getStore('geofences');
    const idx = geos.findIndex(g => g.id === id);
    if (idx === -1) return err(404, 'Geofence not found');
    Object.assign(geos[idx], { name: body.name, latitude: body.latitude, longitude: body.longitude, radius_m: body.radius_m, description: body.description });
    setStore('geofences', geos);
    return ok({ geofence: geos[idx] });
  }
  function handleDeleteGeofence(id) {
    const geos = getStore('geofences');
    const idx = geos.findIndex(g => g.id === id);
    if (idx === -1) return err(404, 'Geofence not found');
    geos[idx].is_active = 0;
    setStore('geofences', geos);
    return ok({ message: 'Geofence deactivated' });
  }

  // --- Attendance ---
  function handleClockIn(body, token) {
    const u = getUserFromToken(token);
    if (!u) return err(401, 'Authentication required');
    const att = getStore('attendance');
    const open = att.find(a => a.user_id === u.id && !a.clock_out_time);
    if (open) return err(400, 'You already have an active clock-in. Please clock out first.');
    const geo = verifyLocation(body.latitude, body.longitude);
    const status = geo.verified ? 'offsite_verified' : 'out_of_bounds';
    const rec = {
      id: nextId(att), user_id: u.id, clock_in_time: now(), clock_in_lat: body.latitude, clock_in_lng: body.longitude,
      clock_out_time: null, clock_out_lat: null, clock_out_lng: null,
      status, clock_in_verified: geo.verified ? 1 : 0, clock_out_verified: 0,
      notes: '', created_at: now(), updated_at: now()
    };
    att.push(rec); setStore('attendance', att);
    logAudit(u.id, 'CLOCK_IN', 'Clocked in — ' + (geo.verified ? 'verified at ' + geo.geofence.name : 'outside geofences'));
    return ok({ id: rec.id, status, geofence: geo.verified ? geo.geofence : null, distance: geo.distance, message: geo.verified ? 'Clocked in – verified at ' + geo.geofence.name : 'Clocked in – outside all office boundaries' });
  }

  function handleClockOut(body, token) {
    const u = getUserFromToken(token);
    if (!u) return err(401, 'Authentication required');
    const att = getStore('attendance');
    const idx = att.findIndex(a => a.user_id === u.id && !a.clock_out_time);
    if (idx === -1) return err(400, 'No active clock-in found');
    const geo = verifyLocation(body.latitude, body.longitude);
    att[idx].clock_out_time = now();
    att[idx].clock_out_lat = body.latitude;
    att[idx].clock_out_lng = body.longitude;
    att[idx].clock_out_verified = geo.verified ? 1 : 0;
    att[idx].updated_at = now();
    setStore('attendance', att);
    logAudit(u.id, 'CLOCK_OUT', 'Clocked out — ' + (geo.verified ? 'verified at ' + geo.geofence.name : 'outside geofences'));
    return ok({ id: att[idx].id, status: att[idx].status, geofence: geo.verified ? geo.geofence : null, distance: geo.distance, message: geo.verified ? 'Clocked out – verified at ' + geo.geofence.name : 'Clocked out – outside all office boundaries' });
  }

  function handleAttendanceStatus(token) {
    const u = getUserFromToken(token);
    if (!u) return err(401, 'Authentication required');
    const att = getStore('attendance').find(a => a.user_id === u.id && !a.clock_out_time);
    return ok({ clockedIn: !!att, attendance: att || null });
  }

  function handleAttendanceMe(url, token) {
    const u = getUserFromToken(token);
    if (!u) return err(401, 'Authentication required');
    const q = new URL(url, location.href);
    let records = getStore('attendance').filter(a => a.user_id === u.id);
    const start = q.searchParams.get('start');
    const end = q.searchParams.get('end');
    if (start) records = records.filter(a => a.clock_in_time >= start);
    if (end) records = records.filter(a => a.clock_in_time <= end + ' 23:59:59');
    records.sort((a, b) => b.clock_in_time.localeCompare(a.clock_in_time));
    const limit = Number(q.searchParams.get('limit')) || 20;
    const page = Number(q.searchParams.get('page')) || 1;
    const offset = (page - 1) * limit;
    return ok({ total: records.length, page, limit, records: records.slice(offset, offset + limit) });
  }

  function handleAttendanceTeam(url, token) {
    const u = getUserFromToken(token);
    if (!u) return err(401, 'Authentication required');
    if (!['admin', 'supervisor'].includes(u.role)) return err(403, 'Insufficient permissions');
    const q = new URL(url, location.href);
    const users = getStore('users');
    let att = getStore('attendance');
    if (u.role === 'supervisor') {
      const teamIds = users.filter(x => x.supervisor_id === u.id).map(x => x.id);
      att = att.filter(a => teamIds.includes(a.user_id));
    }
    const start = q.searchParams.get('start');
    const end = q.searchParams.get('end');
    const statusF = q.searchParams.get('status');
    const empId = q.searchParams.get('employee_id');
    if (start) att = att.filter(a => a.clock_in_time >= start);
    if (end) att = att.filter(a => a.clock_in_time <= end + ' 23:59:59');
    if (statusF) att = att.filter(a => a.status === statusF);
    if (empId) att = att.filter(a => a.user_id === Number(empId));
    // Join with user data
    att = att.map(a => {
      const usr = users.find(x => x.id === a.user_id) || {};
      return { ...a, full_name: usr.full_name || 'Unknown', department: usr.department || '', email: usr.email || '' };
    });
    att.sort((a, b) => b.clock_in_time.localeCompare(a.clock_in_time));
    const limit = Number(q.searchParams.get('limit')) || 50;
    const page = Number(q.searchParams.get('page')) || 1;
    const offset = (page - 1) * limit;
    return ok({ total: att.length, page, limit, records: att.slice(offset, offset + limit) });
  }

  function handleAttendanceExport(url, token) {
    const u = getUserFromToken(token);
    if (!u) return err(401, 'Authentication required');
    if (!['admin', 'supervisor'].includes(u.role)) return err(403, 'Insufficient permissions');
    const q = new URL(url, location.href);
    const format = q.searchParams.get('format') || 'csv';
    const users = getStore('users');
    let att = getStore('attendance');
    if (u.role === 'supervisor') {
      const teamIds = users.filter(x => x.supervisor_id === u.id).map(x => x.id);
      att = att.filter(a => teamIds.includes(a.user_id));
    }
    att = att.map(a => {
      const usr = users.find(x => x.id === a.user_id) || {};
      return { full_name: usr.full_name || 'Unknown', email: usr.email || '', department: usr.department || '', clock_in_time: a.clock_in_time, clock_in_lat: a.clock_in_lat, clock_in_lng: a.clock_in_lng, clock_in_verified: a.clock_in_verified ? 'Yes' : 'No', clock_out_time: a.clock_out_time || '', clock_out_lat: a.clock_out_lat || '', clock_out_lng: a.clock_out_lng || '', clock_out_verified: a.clock_out_verified ? 'Yes' : 'No', status: a.status, notes: a.notes || '' };
    });
    const header = 'Employee,Email,Department,Clock In,Clock In Lat,Clock In Lng,In Verified,Clock Out,Clock Out Lat,Clock Out Lng,Out Verified,Status,Notes\n';
    const csv = att.map(r => [r.full_name, r.email, r.department, r.clock_in_time, r.clock_in_lat, r.clock_in_lng, r.clock_in_verified, r.clock_out_time, r.clock_out_lat, r.clock_out_lng, r.clock_out_verified, r.status, r.notes].map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\n');
    // Return CSV as a blob-like response
    return { ok: true, status: 200, isCsv: true, csv: header + csv, headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename=attendance.csv' } };
  }

  // --- Audit Logs ---
  function handleGetAudit(url, token) {
    const u = getUserFromToken(token);
    if (!u || u.role !== 'admin') return err(403, 'Insufficient permissions');
    const q = new URL(url, location.href);
    const users = getStore('users');
    let logs = getStore('audit_logs');
    const actionF = q.searchParams.get('action');
    const userIdF = q.searchParams.get('user_id');
    const startF = q.searchParams.get('start');
    const endF = q.searchParams.get('end');
    if (actionF) logs = logs.filter(l => l.action === actionF);
    if (userIdF) logs = logs.filter(l => l.user_id === Number(userIdF));
    if (startF) logs = logs.filter(l => l.created_at >= startF);
    if (endF) logs = logs.filter(l => l.created_at <= endF + ' 23:59:59');
    logs = logs.map(l => {
      const usr = users.find(x => x.id === l.user_id) || {};
      return { ...l, full_name: usr.full_name || 'System', email: usr.email || '' };
    });
    logs.sort((a, b) => b.created_at.localeCompare(a.created_at));
    const limit = Number(q.searchParams.get('limit')) || 50;
    const page = Number(q.searchParams.get('page')) || 1;
    const offset = (page - 1) * limit;
    return ok({ total: logs.length, page, limit, logs: logs.slice(offset, offset + limit) });
  }

  function handleGetAuditActions(token) {
    const u = getUserFromToken(token);
    if (!u || u.role !== 'admin') return err(403, 'Insufficient permissions');
    const actions = [...new Set(getStore('audit_logs').map(l => l.action))].sort();
    return ok({ actions });
  }

  function handleAuditExport(url, token) {
    const u = getUserFromToken(token);
    if (!u || u.role !== 'admin') return err(403, 'Insufficient permissions');
    const users = getStore('users');
    let logs = getStore('audit_logs');
    logs = logs.map(l => {
      const usr = users.find(x => x.id === l.user_id) || {};
      return { created_at: l.created_at, full_name: usr.full_name || 'System', email: usr.email || '', action: l.action, details: l.details, ip_address: l.ip_address || '', user_agent: l.user_agent || '' };
    });
    logs.sort((a, b) => b.created_at.localeCompare(a.created_at));
    const header = 'Timestamp,User,Email,Action,Details,IP Address,User Agent\n';
    const csv = logs.map(r => [r.created_at, r.full_name, r.email, r.action, r.details, r.ip_address, r.user_agent].map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\n');
    return { ok: true, status: 200, isCsv: true, csv: header + csv, headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename=audit_log.csv' } };
  }

  // --- Reports ---
  function handleReportSummary(token) {
    const u = getUserFromToken(token);
    if (!u || !['admin', 'supervisor'].includes(u.role)) return err(403, 'Insufficient permissions');
    const users = getStore('users');
    let att = getStore('attendance');
    if (u.role === 'supervisor') {
      const teamIds = users.filter(x => x.supervisor_id === u.id).map(x => x.id);
      att = att.filter(a => teamIds.includes(a.user_id));
    }
    const activeEmps = users.filter(x => x.is_active && x.role !== 'admin');
    const todayStr = today();
    const todayAtt = att.filter(a => a.clock_in_time && a.clock_in_time.startsWith(todayStr));
    const statusBreakdown = {};
    att.forEach(a => { statusBreakdown[a.status] = (statusBreakdown[a.status] || 0) + 1; });
    return ok({ totalEmployees: activeEmps.length, activeEmployees: activeEmps.length, totalRecords: att.length, todayClockedIn: todayAtt.length, statusBreakdown, weeklyTrend: [] });
  }

  // --- Helpers ---
  function sanitize(u) {
    const { password, ...rest } = u; return rest;
  }

  function getUserFromToken(token) {
    if (!token) return null;
    try {
      const payload = JSON.parse(atob(token));
      const users = getStore('users');
      return users.find(u => u.id === payload.userId) || null;
    } catch { return null; }
  }

  function logAudit(userId, action, details) {
    const logs = getStore('audit_logs');
    logs.push({ id: nextId(logs), user_id: userId, action, details, ip_address: '', user_agent: navigator.userAgent, created_at: now() });
    setStore('audit_logs', logs);
  }

  function ok(data) { return { ok: true, status: 200, data }; }
  function err(status, message) { return { ok: false, status, data: { error: message } }; }

  // ── URL matcher ──────────────────────────────────────────────────────────
  function matchRoute(method, pathname) {
    // Returns [handlerKey, params] or null
    const m = method.toUpperCase();
    // Auth
    if (m === 'POST' && pathname === '/api/auth/login') return ['login'];
    if (m === 'POST' && pathname === '/api/auth/logout') return ['logout'];
    if (m === 'GET' && pathname === '/api/auth/me') return ['me'];
    // Health
    if (m === 'GET' && pathname === '/api/health') return ['health'];
    // Employees
    if (m === 'GET' && /^\/api\/employees\/(\d+)$/.test(pathname)) return ['getEmployee', Number(pathname.split('/')[3])];
    if (m === 'GET' && pathname === '/api/employees') return ['getEmployees'];
    if (m === 'POST' && pathname === '/api/employees') return ['createEmployee'];
    if (m === 'PUT' && /^\/api\/employees\/(\d+)$/.test(pathname)) return ['updateEmployee', Number(pathname.split('/')[3])];
    if (m === 'DELETE' && /^\/api\/employees\/(\d+)$/.test(pathname)) return ['deleteEmployee', Number(pathname.split('/')[3])];
    // Geofences
    if (m === 'GET' && pathname === '/api/geofences/all') return ['getAllGeofences'];
    if (m === 'GET' && /^\/api\/geofences\/(\d+)$/.test(pathname)) return ['getGeofence', Number(pathname.split('/')[3])];
    if (m === 'GET' && pathname === '/api/geofences') return ['getGeofences'];
    if (m === 'POST' && pathname === '/api/geofences') return ['createGeofence'];
    if (m === 'PUT' && /^\/api\/geofences\/(\d+)$/.test(pathname)) return ['updateGeofence', Number(pathname.split('/')[3])];
    if (m === 'DELETE' && /^\/api\/geofences\/(\d+)$/.test(pathname)) return ['deleteGeofence', Number(pathname.split('/')[3])];
    // Attendance
    if (m === 'POST' && pathname === '/api/attendance/clock-in') return ['clockIn'];
    if (m === 'POST' && pathname === '/api/attendance/clock-out') return ['clockOut'];
    if (m === 'GET' && pathname === '/api/attendance/status') return ['attendanceStatus'];
    if (m === 'GET' && pathname === '/api/attendance/export') return ['attendanceExport'];
    if (m === 'GET' && pathname === '/api/attendance/me') return ['attendanceMe'];
    if (m === 'GET' && pathname === '/api/attendance/team') return ['attendanceTeam'];
    // Audit
    if (m === 'GET' && pathname === '/api/audit/actions') return ['auditActions'];
    if (m === 'GET' && pathname === '/api/audit/export') return ['auditExport'];
    if (m === 'GET' && pathname === '/api/audit') return ['getAudit'];
    // Reports
    if (m === 'GET' && pathname === '/api/reports/summary') return ['reportSummary'];
    if (m === 'GET' && pathname === '/api/reports/department') return ok({ departments: [] });
    return null;
  }

  // ── Fetch interceptor ────────────────────────────────────────────────────
  const _fetch = window.fetch;

  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
    // Only intercept /api/ calls
    if (!url.includes('/api/')) return _fetch.call(window, input, init);

    try {
      // Extract the /api/... path directly. Using new URL() with a
      // relative path on GitHub Pages would prepend the subpath
      // (e.g. /offsite-employee-login/api/...) and break routing.
      const apiIdx = url.indexOf('/api/');
      const apiPath = apiIdx >= 0 ? url.slice(apiIdx) : url;
      const method = (init && init.method) || 'GET';
      const token = (init && init.headers && (init.headers['Authorization'] || init.headers.authorization)) || '';
      const bearer = token.startsWith('Bearer ') ? token.slice(7) : token;
      const body = init && init.body ? JSON.parse(init.body) : {};

      const route = matchRoute(method, apiPath);
      if (!route) return makeResponse(err(404, 'Not Found'));

      const [key, ...params] = route;
      let result;

      switch (key) {
        case 'login': result = handleLogin(body); break;
        case 'logout': result = ok({ message: 'Logged out successfully' }); break;
        case 'me': result = handleGetMe(bearer); break;
        case 'health': result = ok({ status: 'ok', timestamp: new Date().toISOString() }); break;
        case 'getEmployees': result = handleGetEmployees(url); break;
        case 'getEmployee': result = handleGetEmployee(params[0]); break;
        case 'createEmployee': result = handleCreateEmployee(body); break;
        case 'updateEmployee': result = handleUpdateEmployee(params[0], body); break;
        case 'deleteEmployee': result = handleDeleteEmployee(params[0]); break;
        case 'getGeofences': result = handleGetGeofences(); break;
        case 'getAllGeofences': result = handleGetAllGeofences(); break;
        case 'getGeofence': result = handleGetGeofence(params[0]); break;
        case 'createGeofence': result = handleCreateGeofence(body); break;
        case 'updateGeofence': result = handleUpdateGeofence(params[0], body); break;
        case 'deleteGeofence': result = handleDeleteGeofence(params[0]); break;
        case 'clockIn': result = handleClockIn(body, bearer); break;
        case 'clockOut': result = handleClockOut(body, bearer); break;
        case 'attendanceStatus': result = handleAttendanceStatus(bearer); break;
        case 'attendanceMe': result = handleAttendanceMe(url, bearer); break;
        case 'attendanceTeam': result = handleAttendanceTeam(url, bearer); break;
        case 'attendanceExport': result = handleAttendanceExport(url, bearer); break;
        case 'getAudit': result = handleGetAudit(url, bearer); break;
        case 'auditActions': result = handleGetAuditActions(bearer); break;
        case 'auditExport': result = handleAuditExport(url, bearer); break;
        case 'reportSummary': result = handleReportSummary(bearer); break;
        default: result = err(404, 'Not Found');
      }

      // Special case: CSV export returns raw content
      if (result.isCsv) {
        return new Response(result.csv, { status: 200, headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename=attendance.csv' } });
      }

      return makeResponse(result);
    } catch (e) {
      console.error('[data.js] Mock API error:', e);
      return makeResponse(err(500, 'Internal error'));
    }
  };

  function makeResponse(result) {
    return new Response(JSON.stringify(result.data), {
      status: result.status,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  console.log('✅ Local data layer active — no backend server required');
})();
