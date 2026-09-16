const express = require('express');
const { get, all, run } = require('../db/schema');
const { authenticate, requireRole } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');

const router = express.Router();

// GET /api/geofences
router.get('/', authenticate, requireRole('admin', 'supervisor', 'employee'), (req, res) => {
  const rows = all('SELECT * FROM geofences WHERE is_active = 1 ORDER BY name');
  res.json({ geofences: rows });
});

// GET /api/geofences/all  (admin only, includes inactive)
router.get('/all', authenticate, requireRole('admin'), (req, res) => {
  const rows = all('SELECT * FROM geofences ORDER BY name');
  res.json({ geofences: rows });
});

// GET /api/geofences/:id
router.get('/:id', authenticate, requireRole('admin'), (req, res) => {
  const gf = get('SELECT * FROM geofences WHERE id = ?', [req.params.id]);
  if (!gf) return res.status(404).json({ error: 'Geofence not found' });
  res.json({ geofence: gf });
});

// POST /api/geofences
router.post('/', authenticate, requireRole('admin'), (req, res) => {
  const { name, latitude, longitude, radius_m = 500, description = '' } = req.body;

  if (!name || latitude == null || longitude == null) {
    return res.status(400).json({ error: 'Name, latitude, and longitude are required' });
  }

  if (radius_m < 50 || radius_m > 50000) {
    return res.status(400).json({ error: 'Radius must be between 50 and 50000 meters' });
  }

  const result = run(`
    INSERT INTO geofences (name, latitude, longitude, radius_m, description, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [name, latitude, longitude, radius_m, description, req.user.id]);

  logAudit(req.user.id, 'GEOFENCE_CREATED', `Created geofence: ${name} (${latitude}, ${longitude}) radius=${radius_m}m`, req);

  res.status(201).json({ id: result.lastInsertRowid, message: 'Geofence created' });
});

// PUT /api/geofences/:id
router.put('/:id', authenticate, requireRole('admin'), (req, res) => {
  const gf = get('SELECT * FROM geofences WHERE id = ?', [req.params.id]);
  if (!gf) return res.status(404).json({ error: 'Geofence not found' });

  const { name, latitude, longitude, radius_m, description, is_active } = req.body;
  const changes = [];
  const params = [];

  if (name) { changes.push('name = ?'); params.push(name); }
  if (latitude != null) { changes.push('latitude = ?'); params.push(latitude); }
  if (longitude != null) { changes.push('longitude = ?'); params.push(longitude); }
  if (radius_m != null) { changes.push('radius_m = ?'); params.push(radius_m); }
  if (description !== undefined) { changes.push('description = ?'); params.push(description); }
  if (is_active !== undefined) { changes.push('is_active = ?'); params.push(is_active ? 1 : 0); }

  if (changes.length > 0) {
    params.push(req.params.id);
    run(`UPDATE geofences SET ${changes.join(', ')} WHERE id = ?`, params);
    logAudit(req.user.id, 'GEOFENCE_UPDATED', `Updated geofence: ${gf.name} (id=${gf.id})`, req);
  }

  res.json({ message: 'Geofence updated' });
});

// DELETE /api/geofences/:id  (soft-deactivate)
router.delete('/:id', authenticate, requireRole('admin'), (req, res) => {
  const gf = get('SELECT * FROM geofences WHERE id = ?', [req.params.id]);
  if (!gf) return res.status(404).json({ error: 'Geofence not found' });

  run('UPDATE geofences SET is_active = 0 WHERE id = ?', [req.params.id]);
  logAudit(req.user.id, 'GEOFENCE_DELETED', `Deactivated geofence: ${gf.name}`, req);

  res.json({ message: 'Geofence deactivated' });
});

module.exports = router;
