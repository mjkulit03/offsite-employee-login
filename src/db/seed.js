require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { initDatabase, get, run } = require('./schema');
const bcrypt = require('bcryptjs');

async function seed() {
  // Initialize database first
  await initDatabase();
  console.log('🌱 Seeding database...');

  const hashPassword = (pwd) => bcrypt.hashSync(pwd, 10);

  // ── Admin ───────────────────────────────────────────────────────────────
  // Always upsert: the password hash may be stale from a previous deploy,
  // or the admin may have been created manually. Keep the default
  // credentials (admin / admin123) in sync so the login page works.
  const existingAdmin = get('SELECT id FROM users WHERE username = ?', ['admin']);
  if (!existingAdmin) {
    run(`
      INSERT INTO users (username, email, password_hash, full_name, role, department, is_active)
      VALUES (?, ?, ?, ?, 'admin', 'Administration', 1)
    `, ['admin', 'admin@company.com', hashPassword('admin123'), 'System Admin']);
    console.log('  ✅ Admin user created (admin / admin123, permanently active)');
  } else {
    // Force-reset password + ensure the account is active.
    run(
      "UPDATE users SET password_hash = ?, is_active = 1, full_name = 'System Admin' WHERE username = 'admin'",
      [hashPassword('admin123')]
    );
    console.log('  ✅ Admin password reset to admin123, account activated');
  }

  // ── Supervisor ──────────────────────────────────────────────────────────
  const existingSup = get('SELECT id FROM users WHERE username = ?', ['supervisor']);
  if (!existingSup) {
    run(`
      INSERT INTO users (username, email, password_hash, full_name, role, department)
      VALUES (?, ?, ?, ?, 'supervisor', 'Engineering')
    `, ['supervisor', 'supervisor@company.com', hashPassword('super123'), 'Team Supervisor']);
    console.log('  ✅ Supervisor user created (supervisor / super123)');
  }

  // ── Employees ───────────────────────────────────────────────────────────
  const sup = get('SELECT id FROM users WHERE username = ?', ['supervisor']);
  const employees = [
    { username: 'alice', email: 'alice@company.com', name: 'Alice Johnson', dept: 'Engineering' },
    { username: 'bob', email: 'bob@company.com', name: 'Bob Smith', dept: 'Engineering' },
    { username: 'carol', email: 'carol@company.com', name: 'Carol Davis', dept: 'Marketing' },
  ];
  for (const emp of employees) {
    const exists = get('SELECT id FROM users WHERE username = ?', [emp.username]);
    if (!exists) {
      run(`
        INSERT INTO users (username, email, password_hash, full_name, role, department, supervisor_id)
        VALUES (?, ?, ?, ?, 'employee', ?, ?)
      `, [emp.username, emp.email, hashPassword('emp123'), emp.name, emp.dept, sup ? sup.id : null]);
      console.log(`  ✅ Employee ${emp.name} created (${emp.username} / emp123)`);
    }
  }

  // ── Sample geofences ────────────────────────────────────────────────────
  const admin = get('SELECT id FROM users WHERE username = ?', ['admin']);
  const existingGeo = get('SELECT id FROM geofences LIMIT 1');
  if (!existingGeo) {
    run(`
      INSERT INTO geofences (name, latitude, longitude, radius_m, description, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `, ['Makati Office', 14.5547, 121.0244, 500, 'Main office - Makati City', admin ? admin.id : null]);
    run(`
      INSERT INTO geofences (name, latitude, longitude, radius_m, description, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `, ['Cebu Branch', 10.3157, 123.8854, 750, 'Branch office - Cebu City', admin ? admin.id : null]);
    console.log('  ✅ Sample geofences created');
  }

  console.log('🌱 Seeding complete!');
}

// Allow this module to be required by server.js or run directly.
if (require.main === module) {
  seed().catch((err) => {
    console.error('⚠️  Seed failed (server will still start):', err.message || err);
  });
}

module.exports = { seed };
