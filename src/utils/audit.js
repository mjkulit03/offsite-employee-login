const { run } = require('../db/schema');

/**
 * Log an audit event.
 * @param {number|null} userId  - The user who performed the action
 * @param {string}      action  - Short action label (e.g. 'CLOCK_IN', 'USER_LOGIN')
 * @param {string}      details - Human-readable detail string
 * @param {object}      req     - Express request (optional, for IP / UA)
 */
function logAudit(userId, action, details, req = null) {
  const ip = req ? (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim() : '';
  const ua = req ? (req.headers['user-agent'] || '') : '';

  run(`
    INSERT INTO audit_logs (user_id, action, details, ip_address, user_agent)
    VALUES (?, ?, ?, ?, ?)
  `, [userId, action, details, ip, ua]);
}

module.exports = { logAudit };
