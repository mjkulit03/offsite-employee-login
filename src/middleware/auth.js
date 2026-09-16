const jwt = require('jsonwebtoken');
const { get } = require('../db/schema');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

// ── Authenticate JWT ────────────────────────────────────────────────────────
function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const token = header.split(' ')[1];
    const payload = jwt.verify(token, JWT_SECRET);
    const user = get('SELECT id, username, full_name, role, department, is_active FROM users WHERE id = ?', [payload.userId]);

    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'User not found or inactive' });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ── Role-based access control ───────────────────────────────────────────────
function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

// ── Supervisor scope: can only access their own team ────────────────────────
function supervisorScope(req, res, next) {
  if (req.user.role === 'admin') return next();
  req.supervisorId = req.user.id;
  next();
}

module.exports = { authenticate, requireRole, supervisorScope, JWT_SECRET };
