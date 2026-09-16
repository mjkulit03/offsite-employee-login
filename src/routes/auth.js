const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { get, run, ensureAdminActive } = require('../db/schema');
const { authenticate, JWT_SECRET } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');

const router = express.Router();

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const user = get('SELECT * FROM users WHERE username = ?', [username]);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  if (!user.is_active) {
    // The admin account is permanently activated: self-heal and allow login.
    if (user.role === 'admin') {
      ensureAdminActive();
      user.is_active = 1;
    } else {
      return res.status(403).json({ error: 'Account is deactivated' });
    }
  }

  // Sessions never expire: no expiresIn passed, so the token has no exp claim.
  const token = jwt.sign(
    { userId: user.id, role: user.role },
    JWT_SECRET
  );

  logAudit(user.id, 'USER_LOGIN', `User logged in: ${user.username}`, req);

  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      full_name: user.full_name,
      role: user.role,
      department: user.department,
    },
  });
});

// POST /api/auth/logout
router.post('/logout', authenticate, (req, res) => {
  logAudit(req.user.id, 'USER_LOGOUT', `User logged out: ${req.user.username}`, req);
  res.json({ message: 'Logged out successfully' });
});

// GET /api/auth/me
router.get('/me', authenticate, (req, res) => {
  const user = get(
    'SELECT id, username, full_name, role, department, supervisor_id, is_active, created_at FROM users WHERE id = ?',
    [req.user.id]
  );
  res.json({ user });
});

module.exports = router;
