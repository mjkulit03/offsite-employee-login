const express = require('express');
const { get, all, run } = require('../db/schema');
const { authenticate } = require('../middleware/auth');
const { verifyLocation } = require('../utils/geofence');
const { logAudit } = require('../utils/audit');

const router = express.Router();

// POST /api/attendance/clock-in
router.post('/clock-in', authenticate, (req, res) => {
  const { latitude, longitude } = req.body;
  if (latitude == null || longitude == null) {
    return res.status(400).json({ error: 'Location coordinates are required' });
  }

  // Check if user already has an open shift
  const open = get(
    'SELECT id FROM attendance WHERE user_id = ? AND clock_out_time IS NULL',
    [req.user.id]
  );
  if (open) {
    return res.status(400).json({ error: 'You already have an active clock-in. Please clock out first.' });
  }

  // Geofence verification
  const geo = verifyLocation(latitude, longitude);
  const status = geo.verified ? 'offsite_verified' : 'out_of_bounds';

  const result = run(`
    INSERT INTO attendance (user_id, clock_in_time, clock_in_lat, clock_in_lng, clock_in_verified, status)
    VALUES (?, datetime('now'), ?, ?, ?, ?)
  `, [req.user.id, latitude, longitude, geo.verified ? 1 : 0, status]);

  const detail = geo.verified
    ? `Clocked in within geofence "${geo.geofence.name}" (${geo.distance}m from center)`
    : `Clocked in OUTSIDE all geofences (${geo.distance ? geo.distance + 'm' : 'unknown'} from nearest)`;

  logAudit(req.user.id, 'CLOCK_IN', detail, req);

  res.json({
    id: result.lastInsertRowid,
    status,
    geofence: geo.verified ? geo.geofence : null,
    distance: geo.distance,
    message: geo.verified ? `Clocked in – verified at ${geo.geofence.name}` : 'Clocked in – outside all office boundaries',
  });
});

// POST /api/attendance/clock-out
router.post('/clock-out', authenticate, (req, res) => {
  const { latitude, longitude } = req.body;
  if (latitude == null || longitude == null) {
    return res.status(400).json({ error: 'Location coordinates are required' });
  }

  const open = get(
    'SELECT * FROM attendance WHERE user_id = ? AND clock_out_time IS NULL',
    [req.user.id]
  );
  if (!open) {
    return res.status(400).json({ error: 'No active clock-in found' });
  }

  const geo = verifyLocation(latitude, longitude);

  run(`
    UPDATE attendance
    SET clock_out_time = datetime('now'),
        clock_out_lat  = ?,
        clock_out_lng  = ?,
        clock_out_verified = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `, [latitude, longitude, geo.verified ? 1 : 0, open.id]);

  const detail = geo.verified
    ? `Clocked out within geofence "${geo.geofence.name}" (${geo.distance}m from center)`
    : `Clocked out OUTSIDE all geofences`;

  logAudit(req.user.id, 'CLOCK_OUT', detail, req);

  res.json({
    id: open.id,
    status: open.status,
    geofence: geo.verified ? geo.geofence : null,
    distance: geo.distance,
    message: geo.verified ? `Clocked out – verified at ${geo.geofence.name}` : 'Clocked out – outside all office boundaries',
  });
});

// GET /api/attendance/status  – current clock-in status
router.get('/status', authenticate, (req, res) => {
  const open = get(
    'SELECT * FROM attendance WHERE user_id = ? AND clock_out_time IS NULL ORDER BY clock_in_time DESC LIMIT 1',
    [req.user.id]
  );

  res.json({ clockedIn: !!open, attendance: open || null });
});

// GET /api/attendance/me – personal history
router.get('/me', authenticate, (req, res) => {
  const { start, end, page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;

  let where = 'WHERE a.user_id = ?';
  const params = [req.user.id];

  if (start) { where += ' AND a.clock_in_time >= ?'; params.push(start); }
  if (end) { where += ' AND a.clock_in_time <= ?'; params.push(end + ' 23:59:59'); }

  const totalRow = get(
    `SELECT COUNT(*) as count FROM attendance a ${where}`,
    params
  );
  const total = totalRow ? totalRow.count : 0;

  const rows = all(
    `SELECT a.*, u.full_name FROM attendance a
     JOIN users u ON u.id = a.user_id
     ${where} ORDER BY a.clock_in_time DESC LIMIT ? OFFSET ?`,
    [...params, Number(limit), Number(offset)]
  );

  res.json({ total, page: Number(page), limit: Number(limit), records: rows });
});

// GET /api/attendance/team – supervisor/admin view
router.get('/team', authenticate, (req, res) => {
  if (!['admin', 'supervisor'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

  const { start, end, employee_id, status: statusFilter, page = 1, limit = 50 } = req.query;
  const offset = (page - 1) * limit;

  let where = 'WHERE 1=1';
  const params = [];

  // Supervisor can only see their team
  if (req.user.role === 'supervisor') {
    where += ' AND a.user_id IN (SELECT id FROM users WHERE supervisor_id = ?)';
    params.push(req.user.id);
  }
  if (employee_id) { where += ' AND a.user_id = ?'; params.push(Number(employee_id)); }
  if (statusFilter) { where += ' AND a.status = ?'; params.push(statusFilter); }
  if (start) { where += ' AND a.clock_in_time >= ?'; params.push(start); }
  if (end) { where += ' AND a.clock_in_time <= ?'; params.push(end + ' 23:59:59'); }

  const totalRow = get(
    `SELECT COUNT(*) as count FROM attendance a ${where}`,
    params
  );
  const total = totalRow ? totalRow.count : 0;

  const rows = all(`
    SELECT a.*, u.full_name, u.department, u.email
    FROM attendance a JOIN users u ON u.id = a.user_id
    ${where} ORDER BY a.clock_in_time DESC LIMIT ? OFFSET ?
  `, [...params, Number(limit), Number(offset)]);

  res.json({ total, page: Number(page), limit: Number(limit), records: rows });
});

// GET /api/attendance/export – CSV/Excel export
router.get('/export', authenticate, (req, res) => {
  if (!['admin', 'supervisor'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

  const { start, end, department, status: statusFilter, format = 'csv' } = req.query;

  let where = 'WHERE 1=1';
  const params = [];

  if (req.user.role === 'supervisor') {
    where += ' AND a.user_id IN (SELECT id FROM users WHERE supervisor_id = ?)';
    params.push(req.user.id);
  }
  if (start) { where += ' AND a.clock_in_time >= ?'; params.push(start); }
  if (end) { where += ' AND a.clock_in_time <= ?'; params.push(end + ' 23:59:59'); }
  if (department) { where += ' AND u.department = ?'; params.push(department); }
  if (statusFilter) { where += ' AND a.status = ?'; params.push(statusFilter); }

  const rows = all(`
    SELECT u.full_name, u.email, u.department,
           a.clock_in_time, a.clock_in_lat, a.clock_in_lng, a.clock_in_verified,
           a.clock_out_time, a.clock_out_lat, a.clock_out_lng, a.clock_out_verified,
           a.status, a.notes
    FROM attendance a JOIN users u ON u.id = a.user_id
    ${where} ORDER BY a.clock_in_time DESC
  `, params);

  if (format === 'xlsx') {
    const XLSX = require('xlsx');
    const ws = XLSX.utils.json_to_sheet(rows.map(r => ({
      'Employee': r.full_name,
      'Email': r.email,
      'Department': r.department,
      'Clock In': r.clock_in_time,
      'Clock In Lat': r.clock_in_lat,
      'Clock In Lng': r.clock_in_lng,
      'In Verified': r.clock_in_verified ? 'Yes' : 'No',
      'Clock Out': r.clock_out_time || '',
      'Clock Out Lat': r.clock_out_lat || '',
      'Clock Out Lng': r.clock_out_lng || '',
      'Out Verified': r.clock_out_verified ? 'Yes' : 'No',
      'Status': r.status,
      'Notes': r.notes,
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Attendance');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', 'attachment; filename=attendance.xlsx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return res.send(buf);
  }

  // Default CSV
  const header = 'Employee,Email,Department,Clock In,Clock In Lat,Clock In Lng,In Verified,Clock Out,Clock Out Lat,Clock Out Lng,Out Verified,Status,Notes\n';
  const csv = rows.map(r =>
    [r.full_name, r.email, r.department, r.clock_in_time, r.clock_in_lat, r.clock_in_lng,
     r.clock_in_verified ? 'Yes' : 'No', r.clock_out_time || '', r.clock_out_lat || '',
     r.clock_out_lng || '', r.clock_out_verified ? 'Yes' : 'No', r.status, r.notes]
    .map(v => `"${String(v).replace(/"/g, '""')}"`)
    .join(',')
  ).join('\n');

  res.setHeader('Content-Disposition', 'attachment; filename=attendance.csv');
  res.setHeader('Content-Type', 'text/csv');
  res.send(header + csv);
});

module.exports = router;
