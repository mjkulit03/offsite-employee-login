require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDatabase } = require('./db/schema');
const { seed } = require('./db/seed');

const authRoutes = require('./routes/auth');
const attendanceRoutes = require('./routes/attendance');
const employeeRoutes = require('./routes/employees');
const geofenceRoutes = require('./routes/geofences');
const auditRoutes = require('./routes/audit');
const reportRoutes = require('./routes/reports');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ──────────────────────────────────────────────────────────────
// CORS_ORIGIN accepts a single origin or a comma-separated list, e.g. the
// GitHub Pages site plus the app's own host. "*" allows everything (fine for
// a demo; tighten this in production).
const allowedOrigins = (process.env.CORS_ORIGIN || '*')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const corsOptions =
  allowedOrigins.includes('*')
    ? { origin: true, credentials: true }
    : {
        origin(origin, callback) {
          // Allow non-browser tools (curl, health checks) that send no Origin.
          if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
          // Disallowed origin: no CORS headers are emitted, so browsers block
          // the response. The request still runs (no 5xx noise in the logs).
          return callback(null, false);
        },
        credentials: true,
      };

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Health check (used by Render to verify the server is alive) ──────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── API Routes ─────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/geofences', geofenceRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/reports', reportRoutes);

// ── Serve static frontend ──────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../public')));

// SPA fallback: serve index.html for all non-API routes
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, '../public/index.html'));
  }
});

// ── Error handler ──────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ──────────────────────────────────────────────────────────────────
async function start() {
  // Initialize database first
  await initDatabase();
  console.log('✅ Database initialized');

  // Run seed on every startup to ensure default users exist and have
  // correct credentials. Render may run 'node src/server.js' directly
  // instead of 'npm start', which skips the prestart hook.
  await seed().catch((err) => {
    console.error('⚠️  Seed failed (server will still start):', err.message || err);
  });

  app.listen(PORT, () => {
    console.log(`\n🚀 Attendance Tracker running on http://localhost:${PORT}`);
    console.log(`   API: http://localhost:${PORT}/api`);
    console.log(`   Docs: See README.md\n`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

module.exports = app;
