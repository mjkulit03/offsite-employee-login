const { all } = require('../db/schema');

/**
 * Calculate distance between two coordinates using the Haversine formula.
 * Returns distance in meters.
 */
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth's radius in meters
  const toRad = (deg) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Verify if a given coordinate falls within any active geofence.
 * Returns { verified: boolean, geofence: object|null, distance: number|null }
 */
function verifyLocation(lat, lng) {
  const geofences = all('SELECT * FROM geofences WHERE is_active = 1');

  for (const gf of geofences) {
    const distance = haversineDistance(lat, lng, gf.latitude, gf.longitude);
    if (distance <= gf.radius_m) {
      return { verified: true, geofence: gf, distance: Math.round(distance) };
    }
  }

  return { verified: false, geofence: null, distance: null };
}

/**
 * Get nearest geofence info for display purposes.
 */
function getNearestGeofence(lat, lng) {
  const geofences = all('SELECT * FROM geofences WHERE is_active = 1');
  let nearest = null;
  let minDist = Infinity;

  for (const gf of geofences) {
    const distance = haversineDistance(lat, lng, gf.latitude, gf.longitude);
    if (distance < minDist) {
      minDist = distance;
      nearest = { ...gf, distance: Math.round(distance) };
    }
  }

  return nearest;
}

module.exports = { haversineDistance, verifyLocation, getNearestGeofence };
