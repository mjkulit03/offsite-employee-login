require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDatabase } = require('./db/schema');

const authRoutes = require('./routes/auth');
const attendanceRoutes = require('./routes/attendance');
const employeeRoutes = require('./routes/employees');
const geofenceRoutes = require('./routes/geofences');
const auditRoutes = require('./routes/audit');
const reportRoutes = require('./routes/reports');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
