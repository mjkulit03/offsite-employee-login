const express = require('express');
const bcrypt = require('bcryptjs');
const { get, all, run } = require('../db/schema');
const { authenticate, requireRole } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');

const router = express.Router();

// GET /api/employees
router.get('/', authenticate, requireRole('admin', 'supervisor'), (req, res) => {
  const { department, role, search, page = 1, limit = 50 } = req.query;
  const offset = (page - 1) * limit;

  let where = 'WHERE 1=1';
  const params = [];

  if (req.user.role === 'supervisor') {
    where += ' AND (id = ? OR supervisor_id = ?)';
    params.push(req.user.id, req.user.id);
  }
  if (department) { where += ' AND department = ?'; params.push(department); }
  if (role) { where += ' AND role = ?'; params.push(role); }
  if (search) { where += ' AND (full_name LIKE ? OR username LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

  const totalRow = get(`SELECT COUNT(*) as count FROM users ${where}`, params);
  const total = totalRow ? totalRow.count : 0;

  const rows = all(
    `SELECT id, username, email, full_name, role, department, supervisor_id, is_active, created_at
     FROM users ${where} ORDER BY full_name LIMIT ? OFFSET ?`,
    [...params, Number(limit), Number(offset)]
  );

  res.json({ total, page: Number(page), limit: Number(limit), employees: rows });
});

// GET /api/employees/:id
router.get('/:id', authenticate, requireRole('admin', 'supervisor'), (req, res) => {
  const user = get(
    'SELECT id, username, email, full_name, role, department, supervisor_id, is_active, created_at FROM users WHERE id = ?',
    [req.params.id]
  );

  if (!user) return res.status(404).json({ error: 'Employee not found' });

  if (req.user.role === 'supervisor' && user.supervisor_id !== req.user.id && user.id !== req.user.id) {
    return res.status(403).json({ error: 'Access denied' });
  }

  res.json({ employee: user });
});

// POST /api/employees
router.post('/', authenticate, requireRole('admin'), (req, res) => {
  const { username, email = '', full_name, password, role = 'employee', department = '', supervisor_id } = req.body;

  if (!username || !full_name || !password) {
    return res.status(400).json({ error: 'Username, full name, and password are required' });
  }

  const exists = get('SELECT id FROM users WHERE username = ?', [username]);
  if (exists) {
    return res.status(409).json({ error: 'Username already exists' });
  }

  const hash = bcrypt.hashSync(password, 10);
  const result = run(`
    INSERT INTO users (username, email, password_hash, full_name, role, department, supervisor_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [username, email, hash, full_name, role, department, supervisor_id || null]);

  logAudit(req.user.id, 'EMPLOYEE_CREATED', `Created employee: ${full_name} (${username}) role=${role}`, req);

  res.status(201).json({
    id: result.lastInsertRowid,
    message: 'Employee created successfully',
  });
});

// PUT /api/employees/:id
router.put('/:id', authenticate, requireRole('admin'), (req, res) => {
  const { full_name, role, department, supervisor_id, is_active, password } = req.body;
  const target = get('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (!target) return res.status(404).json({ error: 'Employee not found' });

  const changes = [];
  const params = [];

  if (full_name) { changes.push('full_name = ?'); params.push(full_name); }
  if (department !== undefined) { changes.push('department = ?'); params.push(department); }
  if (supervisor_id !== undefined) { changes.push('supervisor_id = ?'); params.push(supervisor_id || null); }
  if (is_active !== undefined) {
    if (!is_active && target.role === 'admin') {
      return res.status(403).json({ error: 'Admin accounts cannot be deactivated' });
    }
    changes.push('is_active = ?'); params.push(is_active ? 1 : 0);
  }
  if (password) { changes.push('password_hash = ?'); params.push(bcrypt.hashSync(password, 10)); }

  if (role && role !== target.role) {
    changes.push('role = ?');
    params.push(role);
    logAudit(req.user.id, 'ROLE_CHANGED', `Changed ${target.full_name} role: ${target.role} → ${role}`, req);
  }

  if (changes.length > 0) {
    changes.push("updated_at = datetime('now')");
    params.push(req.params.id);
    run(`UPDATE users SET ${changes.join(', ')} WHERE id = ?`, params);
  }

  logAudit(req.user.id, 'EMPLOYEE_UPDATED', `Updated employee: ${target.full_name} (id=${target.id})`, req);

  res.json({ message: 'Employee updated successfully' });
});

// DELETE /api/employees/:id  (hard-delete)
router.delete('/:id', authenticate, requireRole('admin'), (req, res) => {
  // Prevent admin from deleting themselves
  if (Number(req.params.id) === req.user.id) {
    return res.status(400).json({ error: 'You cannot delete your own account' });
  }

  const target = get('SELECT id, full_name, username, role FROM users WHERE id = ?', [req.params.id]);
  if (!target) return res.status(404).json({ error: 'Employee not found' });

  // Prevent deleting other admins
  if (target.role === 'admin') {
    return res.status(403).json({ error: 'Cannot delete another admin account' });
  }

  run('DELETE FROM attendance WHERE user_id = ?', [req.params.id]);
  run('DELETE FROM users WHERE id = ?', [req.params.id]);
  logAudit(req.user.id, 'EMPLOYEE_DELETED', `Deleted employee: ${target.full_name} (${target.username})`, req);

  res.json({ message: 'Employee deleted permanently' });
});

module.exports = router;
