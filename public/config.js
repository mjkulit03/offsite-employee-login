// ═══════════════════════════════════════════════════════════════════════════
// Frontend runtime configuration
// ═══════════════════════════════════════════════════════════════════════════
// When the frontend is hosted on GitHub Pages it cannot reach `/api` on its
// own domain — it must call the Express backend (deployed on Render)
// directly. When the backend itself serves these files (localhost or
// onrender.com), the relative `/api` path is correct.
//
// If your Render URL differs from the default below, change API_BASE here.
// ═══════════════════════════════════════════════════════════════════════════

(function () {
  var hostname = window.location.hostname;
  var servedByBackend =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.endsWith('.onrender.com');

  window.APP_CONFIG = {
    API_BASE: servedByBackend
      ? '/api'
      : 'https://offsite-employee-login.onrender.com/api',
  };
})();
