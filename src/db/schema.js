const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const dbDir = path.join(__dirname, '../../data');
const dbPath = process.env.DB_PATH || path.join(dbDir, 'attendance.db');

// Ensure the parent directory of the database file exists.
// On Render the DB lives on a persistent disk at /var/data; if the
// directory is missing (first boot, disk mount delay) the server would
// crash on the first saveDatabase() call.
const dbParent = path.dirname(dbPath);
if (!fs.existsSync(dbParent)) {
  fs.mkdirSync(dbParent, { recursive: true });
}

let db = null;

/**
 * Initialize the database. Must be called before any queries.
 * Returns the database instance.
 */
async function initDatabase() {
  const SQL = await initSqlJs();

  // Load existing database or create new one
  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // Enable foreign keys
  db.run('PRAGMA foreign_keys = ON;');

  // ── Schema ──────────────────────────────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT    NOT NULL UNIQUE,
      email         TEXT    DEFAULT '',
      password_hash TEXT    NOT NULL,
      full_name     TEXT    NOT NULL,
      role          TEXT    NOT NULL CHECK(role IN ('admin','supervisor','employee')),
      department    TEXT    DEFAULT '',
      supervisor_id INTEGER,
      is_active     INTEGER DEFAULT 1,
      created_at    TEXT    DEFAULT (datetime('now')),
      updated_at    TEXT    DEFAULT (datetime('now')),
      FOREIGN KEY (supervisor_id) REFERENCES users(id) ON DELETE SET NULL
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS geofences (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      latitude    REAL    NOT NULL,
      longitude   REAL    NOT NULL,
      radius_m    REAL    NOT NULL DEFAULT 500,
      description TEXT    DEFAULT '',
      is_active   INTEGER DEFAULT 1,
      created_by  INTEGER,
      created_at  TEXT    DEFAULT (datetime('now')),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS attendance (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         INTEGER NOT NULL,
      clock_in_time   TEXT    DEFAULT (datetime('now')),
      clock_in_lat    REAL,
      clock_in_lng    REAL,
      clock_out_time  TEXT,
      clock_out_lat   REAL,
      clock_out_lng   REAL,
      status          TEXT    DEFAULT 'on_time' CHECK(status IN (
                        'on_time','late','early','offsite_verified',
                        'out_of_bounds','pending','clocked_in'
                      )),
      clock_in_verified   INTEGER DEFAULT 0,
      clock_out_verified  INTEGER DEFAULT 0,
      notes           TEXT    DEFAULT '',
      created_at      TEXT    DEFAULT (datetime('now')),
      updated_at      TEXT    DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER,
      action      TEXT    NOT NULL,
      details     TEXT    DEFAULT '',
      ip_address  TEXT    DEFAULT '',
      user_agent  TEXT    DEFAULT '',
      created_at  TEXT    DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  // Create indexes (ignore errors if they already exist)
  try { db.run('CREATE INDEX IF NOT EXISTS idx_attendance_user ON attendance(user_id)'); } catch {}
  try { db.run('CREATE INDEX IF NOT EXISTS idx_attendance_time ON attendance(clock_in_time)'); } catch {}
  try { db.run('CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id)'); } catch {}
  try { db.run('CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action)'); } catch {}
  try { db.run('CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at)'); } catch {}

  // Guarantee the built-in admin account is permanently activated
  ensureAdminActive();

  saveDatabase();
  return db;
}

/**
 * Force-activate every admin user so the admin account can never be
 * locked out by an is_active = 0 flag in the database.
 */
function ensureAdminActive() {
  if (!db) return;
  try {
    db.run("UPDATE users SET is_active = 1 WHERE role = 'admin' AND is_active != 1");
    const modified = db.getRowsModified();
    if (modified > 0) {
      console.log(`✅ Re-activated ${modified} admin account(s)`);
    }
  } catch (err) {
    console.error('ensureAdminActive failed:', err.message);
  }
}

/**
 * Save the database to disk after mutations.
 */
function saveDatabase() {
  if (!db) return;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
  } catch (err) {
    console.error('saveDatabase failed:', err.message);
    // Don't crash the process — log and continue. The in-memory DB is
    // still usable for the current request; data just won't persist.
  }
}

/**
 * Get a single row by running a SQL query with params.
 * Returns the first matching row or undefined.
 */
function get(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return undefined;
}

/**
 * Get all matching rows.
 */
function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

/**
 * Run a mutation (INSERT, UPDATE, DELETE).
 * Returns { changes, lastInsertRowid }.
 */
function run(sql, params = []) {
  db.run(sql, params);
  const changes = db.getRowsModified();
  const lastRow = get('SELECT last_insert_rowid() as id');
  saveDatabase();
  return { changes, lastInsertRowid: lastRow ? lastRow.id : null };
}

module.exports = { initDatabase, saveDatabase, get, all, run, ensureAdminActive, getDb: () => db };
