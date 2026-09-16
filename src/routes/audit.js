const express = require('express');
const { get, all } = require('../db/schema');
const { authenticate, requireRole } = require('../middleware/auth');
const XLSX = require('xlsx');

const router = express.Router();

// GET /api/audit
router.get('/', authenticate, requireRole('admin'), (req, res) => {
  const { user_id, action, start, end, page = 1, limit = 50 } = req.query;
  const offset = (page - 1) * limit;

  let where = 'WHERE 1=1';
  const params = [];

  if (user_id) { where += ' AND l.user_id = ?'; params.push(Number(user_id)); }
  if (action) { where += ' AND l.action = ?'; params.push(action); }
  if (start) { where += ' AND l.created_at >= ?'; params.push(start); }
  if (end) { where += ' AND l.created_at <= ?'; params.push(end + ' 23:59:59'); }

  const totalRow = get(`SELECT COUNT(*) as count FROM audit_logs l ${where}`, params);
  const total = totalRow ? totalRow.count : 0;

  const rows = all(`
    SELECT l.*, u.full_name, u.email
    FROM audit_logs l LEFT JOIN users u ON u.id = l.user_id
    ${where} ORDER BY l.created_at DESC LIMIT ? OFFSET ?
  `, [...params, Number(limit), Number(offset)]);

  res.json({ total, page: Number(page), limit: Number(limit), logs: rows });
});

// GET /api/audit/actions  – distinct action types for filter dropdown
router.get('/actions', authenticate, requireRole('admin'), (req, res) => {
  const rows = all('SELECT DISTINCT action FROM audit_logs ORDER BY action');
  res.json({ actions: rows.map((a) => a.action) });
});

// GET /api/audit/export
router.get('/export', authenticate, requireRole('admin'), (req, res) => {
  const { user_id, action, start, end, format = 'csv' } = req.query;

  let where = 'WHERE 1=1';
  const params = [];

  if (user_id) { where += ' AND l.user_id = ?'; params.push(Number(user_id)); }
  if (action) { where += ' AND l.action = ?'; params.push(action); }
  if (start) { where += ' AND l.created_at >= ?'; params.push(start); }
  if (end) { where += ' AND l.created_at <= ?'; params.push(end + ' 23:59:59'); }

  const rows = all(`
    SELECT l.created_at, u.full_name, u.email, l.action, l.details, l.ip_address, l.user_agent
    FROM audit_logs l LEFT JOIN users u ON u.id = l.user_id
    ${where} ORDER BY l.created_at DESC
  `, params);

  if (format === 'xlsx') {
    const ws = XLSX.utils.json_to_sheet(rows.map(r => ({
      'Timestamp': r.created_at,
      'User': r.full_name || 'System',
      'Email': r.email || '',
      'Action': r.action,
      'Details': r.details,
      'IP Address': r.ip_address,
      'User Agent': r.user_agent,
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Audit Log');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', 'attachment; filename=audit_log.xlsx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return res.send(buf);
  }

  const header = 'Timestamp,User,Email,Action,Details,IP Address,User Agent\n';
  const csv = rows.map(r =>
    [r.created_at, r.full_name || 'System', r.email || '', r.action, r.details, r.ip_address, r.user_agent]
    .map(v => `"${String(v).replace(/"/g, '""')}"`)
    .join(',')
  ).join('\n');

  res.setHeader('Content-Disposition', 'attachment; filename=audit_log.csv');
  res.setHeader('Content-Type', 'text/csv');
  res.send(header + csv);
});

module.exports = router;
