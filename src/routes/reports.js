const express = require('express');
const { get, all } = require('../db/schema');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/reports/summary – dashboard stats
router.get('/summary', authenticate, requireRole('admin', 'supervisor'), (req, res) => {
  const { start, end, department } = req.query;

  let userWhere = 'WHERE is_active = 1';
  let attWhere = 'WHERE 1=1';
  const userParams = [];
  const attParams = [];

  if (req.user.role === 'supervisor') {
    userWhere += ' AND supervisor_id = ?';
    userParams.push(req.user.id);
    attWhere += ' AND a.user_id IN (SELECT id FROM users WHERE supervisor_id = ?)';
    attParams.push(req.user.id);
  }
  if (department) {
    userWhere += ' AND department = ?';
    userParams.push(department);
    attWhere += ' AND u.department = ?';
    attParams.push(department);
  }
  if (start) { attWhere += ' AND a.clock_in_time >= ?'; attParams.push(start); }
  if (end) { attWhere += ' AND a.clock_in_time <= ?'; attParams.push(end + ' 23:59:59'); }

  const totalEmpRow = get(`SELECT COUNT(*) as c FROM users ${userWhere}`, userParams);
  const totalEmployees = totalEmpRow ? totalEmpRow.c : 0;

  const totalRecRow = get(
    `SELECT COUNT(*) as c FROM attendance a JOIN users u ON u.id = a.user_id ${attWhere}`,
    attParams
  );
  const totalRecords = totalRecRow ? totalRecRow.c : 0;

  const statusCounts = all(`
    SELECT a.status, COUNT(*) as count
    FROM attendance a JOIN users u ON u.id = a.user_id
    ${attWhere} GROUP BY a.status
  `, attParams);

  const statusBreakdown = {};
  for (const s of statusCounts) {
    statusBreakdown[s.status] = s.count;
  }

  // Today's stats
  const todayAttWhere = attWhere + " AND a.clock_in_time >= date('now') AND a.clock_in_time < date('now', '+1 day')";
  const todayRow = get(
    `SELECT COUNT(*) as c FROM attendance a JOIN users u ON u.id = a.user_id ${todayAttWhere}`,
    attParams
  );
  const todayClockedIn = todayRow ? todayRow.c : 0;

  // Weekly trend (last 7 days)
  const weeklyTrend = all(`
    SELECT date(a.clock_in_time) as day, COUNT(*) as count
    FROM attendance a JOIN users u ON u.id = a.user_id
    ${attWhere} AND a.clock_in_time >= date('now', '-7 days')
    GROUP BY day ORDER BY day
  `, attParams);

  res.json({
    totalEmployees,
    activeEmployees: totalEmployees,
    totalRecords,
    todayClockedIn,
    statusBreakdown,
    weeklyTrend,
  });
});

// GET /api/reports/department – per-department breakdown
router.get('/department', authenticate, requireRole('admin', 'supervisor'), (req, res) => {
  let where = 'WHERE 1=1';
  const params = [];

  if (req.user.role === 'supervisor') {
    where += ' AND u.supervisor_id = ?';
    params.push(req.user.id);
  }

  const rows = all(`
    SELECT u.department,
           COUNT(DISTINCT u.id) as employees,
           COUNT(a.id) as total_records,
           SUM(CASE WHEN a.status = 'out_of_bounds' THEN 1 ELSE 0 END) as out_of_bounds
    FROM users u
    LEFT JOIN attendance a ON a.user_id = u.id
    ${where}
    GROUP BY u.department ORDER BY u.department
  `, params);

  res.json({ departments: rows });
});

module.exports = router;
