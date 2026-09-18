// ═══════════════════════════════════════════════════════════════════════════
// Attendance & Location Tracker – Frontend Application
// ═══════════════════════════════════════════════════════════════════════════

// Set by config.js — same-origin `/api` when the backend serves this page,
// or the full Render API URL when the page is hosted on GitHub Pages.
const API_BASE = (window.APP_CONFIG && window.APP_CONFIG.API_BASE) || '/api';
let currentUser = null;
let authToken = null;
let map = null;
let marker = null;
let geofenceCircles = [];

// ── API Helper ─────────────────────────────────────────────────────────────
async function api(endpoint, options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

  let res;
  try {
    res = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers: { ...headers, ...options.headers },
    });
  } catch (err) {
    // fetch only throws for network-level failures (DNS, refused, TLS, CORS
    // blockers) — the server never answered. Show something actionable.
    console.error('Network error reaching API:', err);
    throw new Error(
      'Cannot reach the server. The backend may be offline or starting up ' +
      '(free tiers sleep after inactivity — try again in ~30 seconds).'
    );
  }

  if (res.status === 401) {
    // A failed login attempt is not an expired session — don't hijack it.
    if (!endpoint.startsWith('/auth/login')) {
      logout();
      throw new Error('Session expired');
    }
  }

  let data;
  try {
    data = await res.json();
  } catch {
    // Response was not JSON (e.g. a Render 404 page).
    throw new Error(
      res.status === 404
        ? 'Backend not found — the server may need to be redeployed.'
        : `Server returned ${res.status} ${res.statusText}`
    );
  }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ── Toast Notifications ────────────────────────────────────────────────────
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  const colors = { success: 'bg-green-600', error: 'bg-red-600', info: 'bg-brand-600', warning: 'bg-yellow-600' };
  toast.className = `toast ${colors[type] || colors.info}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3000);
}

// ── Sidebar Navigation ─────────────────────────────────────────────────────
const NAV_ITEMS = {
  admin: [
    { id: 'dashboard', icon: 'layout-dashboard', label: 'Dashboard' },
    { id: 'employees', icon: 'users', label: 'Employees' },
    { id: 'geofences', icon: 'map', label: 'Geofences' },
    { id: 'attendance-all', icon: 'calendar-check', label: 'All Attendance' },
    { id: 'audit-logs', icon: 'scroll-text', label: 'Audit Logs' },
    { id: 'reports', icon: 'bar-chart-3', label: 'Reports' },
  ],
  supervisor: [
    { id: 'dashboard', icon: 'layout-dashboard', label: 'Dashboard' },
    { id: 'team-attendance', icon: 'users', label: 'Team Attendance' },
    { id: 'reports', icon: 'bar-chart-3', label: 'Reports' },
  ],
  employee: [
    { id: 'dashboard', icon: 'layout-dashboard', label: 'Dashboard' },
    { id: 'my-attendance', icon: 'calendar-check', label: 'My Attendance' },
  ],
};

function buildSidebar() {
  const nav = document.getElementById('sidebar-nav');
  const items = NAV_ITEMS[currentUser.role] || [];
  nav.innerHTML = items.map(item => `
    <a href="#" data-page="${item.id}" class="sidebar-link flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-600 hover:bg-brand-50 hover:text-brand-600 transition">
      <i data-lucide="${item.icon}" class="w-5 h-5"></i>
      <span>${item.label}</span>
    </a>
  `).join('');

  // Bind clicks
  nav.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      navigateTo(link.dataset.page);
      if (window.innerWidth < 1024) toggleSidebar();
    });
  });
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  sidebar.classList.toggle('-translate-x-full');
  overlay.classList.toggle('hidden');
}

// ── Router ─────────────────────────────────────────────────────────────────
function navigateTo(page) {
  document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
  const activeLink = document.querySelector(`.sidebar-link[data-page="${page}"]`);
  if (activeLink) activeLink.classList.add('active');

  const main = document.getElementById('main-content');
  main.innerHTML = '<div class="flex items-center justify-center h-64"><div class="animate-spin w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full"></div></div>';

  const pages = {
    'dashboard': renderDashboard,
    'employees': renderEmployees,
    'geofences': renderGeofences,
    'attendance-all': renderAllAttendance,
    'audit-logs': renderAuditLogs,
    'reports': renderReports,
    'team-attendance': renderTeamAttendance,
    'my-attendance': renderMyAttendance,
  };

  const render = pages[page];
  if (render) {
    render(main);
  } else {
    main.innerHTML = '<p class="text-gray-500">Page not found</p>';
  }
}

// ── Auth ───────────────────────────────────────────────────────────────────
async function login(username, password) {
  const data = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  authToken = data.token;
  currentUser = data.user;
  localStorage.setItem('token', authToken);
  localStorage.setItem('user', JSON.stringify(currentUser));
  showApp();
}

function logout() {
  authToken = null;
  currentUser = null;
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  document.getElementById('app-shell').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('hidden');
  lucide.createIcons();
}

function showApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app-shell').classList.remove('hidden');

  document.getElementById('user-avatar').textContent = currentUser.full_name.charAt(0);
  document.getElementById('user-display-name').textContent = currentUser.full_name;
  document.getElementById('user-display-role').textContent = currentUser.role;

  buildSidebar();
  navigateTo('dashboard');
  lucide.createIcons();
}

// ── Geolocation ────────────────────────────────────────────────────────────
function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation not supported'));
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      (err) => reject(new Error('Location access denied. Please enable location permissions.')),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  });
}

// ── Map Initialization ─────────────────────────────────────────────────────
function initMap(containerId, lat, lng, geofences = []) {
  if (map) { map.remove(); map = null; }

  map = L.map(containerId).setView([0, 0], 2);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
  }).addTo(map);

  // Draw geofences
  geofenceCircles = [];
  const bounds = L.latLngBounds();

  geofences.forEach(gf => {
    const center = L.latLng(gf.latitude, gf.longitude);
    const circle = L.circle(center, {
      radius: gf.radius_m,
      color: '#6366f1',
      fillColor: '#6366f1',
      fillOpacity: 0.08,
      weight: 2,
    }).addTo(map);
    circle.bindPopup(`<b>${gf.name}</b><br>Radius: ${gf.radius_m}m<br>${gf.description || ''}`);
    geofenceCircles.push(circle);
    bounds.extend(center);
  });

  // User marker
  if (lat && lng) {
    marker = L.marker([lat, lng]).addTo(map)
      .bindPopup('Your location').openPopup();
    bounds.extend(L.latLng(lat, lng));
  }

  // Fit map to show all geofences and user location
  if (bounds.isValid()) {
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
  } else if (lat && lng) {
    map.setView([lat, lng], 15);
  } else {
    // Fallback: show first geofence or default (Philippines)
    map.setView([12.8797, 121.7740], 6);
  }

  setTimeout(() => map.invalidateSize(), 100);
}

function updateUserMarker(lat, lng) {
  if (marker) map.removeLayer(marker);
  marker = L.marker([lat, lng]).addTo(map)
    .bindPopup('Your current location').openPopup();
}

// ── Clock Display ──────────────────────────────────────────────────────────
function updateClock() {
  const el = document.getElementById('clock-display');
  if (el) {
    el.textContent = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  requestAnimationFrame(() => setTimeout(updateClock, 1000));
}

// ═══════════════════════════════════════════════════════════════════════════
// PAGE RENDERERS
// ═══════════════════════════════════════════════════════════════════════════

// ── Dashboard ──────────────────────────────────────────────────────────────
async function renderDashboard(container) {
  if (currentUser.role === 'employee') {
    await renderEmployeeDashboard(container);
  } else {
    await renderAdminDashboard(container);
  }
}

async function renderEmployeeDashboard(container) {
  const status = await api('/attendance/status');
  const history = await api('/attendance/me?limit=5');
  const geofences = await api('/geofences');

  container.innerHTML = `
    <div class="fade-in space-y-6">
      <div class="flex items-center justify-between">
        <h1 class="text-2xl font-bold">Dashboard</h1>
        <span class="text-sm text-gray-500">${new Date().toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' })}</span>
      </div>

      <!-- Status Card -->
      <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <div class="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <p class="text-sm text-gray-500">Current Status</p>
            <p class="text-2xl font-bold ${status.clockedIn ? 'text-green-600' : 'text-gray-400'}">
              ${status.clockedIn ? '🟢 Clocked In' : '⚪ Not Clocked In'}
            </p>
            ${status.clockedIn ? `<p class="text-sm text-gray-500 mt-1">Since ${new Date(status.attendance.clock_in_time).toLocaleTimeString()}</p>` : ''}
          </div>
          <button id="clock-btn"
            class="px-8 py-4 rounded-xl text-lg font-bold transition transform hover:scale-105 ${status.clockedIn
              ? 'bg-red-500 hover:bg-red-600 text-white'
              : 'bg-brand-600 hover:bg-brand-700 text-white'
            }">
            ${status.clockedIn ? 'Clock Out' : 'Clock In'}
          </button>
        </div>
      </div>

      <!-- Map Card -->
      <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h2 class="text-lg font-semibold mb-4 flex items-center gap-2">
          <i data-lucide="map" class="w-5 h-5 text-brand-500"></i> Office Geofences & Your Location
        </h2>
        <div id="map" class="w-full rounded-xl"></div>
        <p id="location-status" class="mt-3 text-sm text-gray-500 text-center">Click "Clock In/Out" to capture your location on the map.</p>
      </div>

      <!-- Recent History -->
      <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h2 class="text-lg font-semibold mb-4">Recent Attendance</h2>
        ${history.records.length === 0 ? '<p class="text-gray-400">No records yet.</p>' : `
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead><tr class="text-left text-gray-500 border-b">
              <th class="pb-2">Date</th><th class="pb-2">Clock In</th><th class="pb-2">Clock Out</th><th class="pb-2">Status</th>
            </tr></thead>
            <tbody>
              ${history.records.map(r => `
                <tr class="border-b border-gray-50">
                  <td class="py-2">${new Date(r.clock_in_time).toLocaleDateString()}</td>
                  <td>${new Date(r.clock_in_time).toLocaleTimeString()}</td>
                  <td>${r.clock_out_time ? new Date(r.clock_out_time).toLocaleTimeString() : '—'}</td>
                  <td><span class="status-badge ${statusColor(r.status)}">${r.status.replace(/_/g,' ')}</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>`}
      </div>
    </div>
  `;

  lucide.createIcons();

  // Init map with geofences (will auto-fit bounds)
  initMap('map', null, null, geofences.geofences);

  // Try to get user location on load
  try {
    const pos = await getCurrentPosition();
    updateUserMarker(pos.latitude, pos.longitude);
    document.getElementById('location-status').textContent =
      `Your location: ${pos.latitude.toFixed(5)}, ${pos.longitude.toFixed(5)}`;
    map.setView([pos.latitude, pos.longitude], 15);
  } catch (e) {
    document.getElementById('location-status').textContent = e.message;
  }

  // Clock button handler
  document.getElementById('clock-btn').addEventListener('click', async () => {
    const btn = document.getElementById('clock-btn');
    btn.disabled = true;
    btn.textContent = 'Capturing location...';

    try {
      const pos = await getCurrentPosition();
      updateUserMarker(pos.latitude, pos.longitude);

      const isClockedIn = status.clockedIn;
      const endpoint = isClockedIn ? '/attendance/clock-out' : '/attendance/clock-in';
      const result = await api(endpoint, {
        method: 'POST',
        body: JSON.stringify(pos),
      });

      showToast(result.message, result.geofence ? 'success' : 'warning');
      document.getElementById('location-status').textContent =
        `${result.message} | Distance: ${result.distance ?? 'N/A'}m`;

      // Refresh dashboard
      renderEmployeeDashboard(container);
    } catch (err) {
      showToast(err.message, 'error');
      btn.disabled = false;
      btn.textContent = status.clockedIn ? 'Clock Out' : 'Clock In';
    }
  });
}

async function renderAdminDashboard(container) {
  const summary = await api('/reports/summary');
  const geofences = await api('/geofences');
  const recent = await api('/attendance/team?limit=8&page=1');

  const statusColors = {
    on_time: 'text-green-600 bg-green-50',
    late: 'text-yellow-600 bg-yellow-50',
    offsite_verified: 'text-blue-600 bg-blue-50',
    out_of_bounds: 'text-red-600 bg-red-50',
    clocked_in: 'text-brand-600 bg-brand-50',
  };

  container.innerHTML = `
    <div class="fade-in space-y-6">
      <h1 class="text-2xl font-bold">Admin Dashboard</h1>

      <!-- Stats Cards -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div class="bg-white rounded-xl border p-5">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 bg-brand-100 rounded-lg flex items-center justify-center"><i data-lucide="users" class="w-5 h-5 text-brand-600"></i></div>
            <div><p class="text-xs text-gray-500">Total Employees</p><p class="text-xl font-bold">${summary.activeEmployees}</p></div>
          </div>
        </div>
        <div class="bg-white rounded-xl border p-5">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center"><i data-lucide="calendar-check" class="w-5 h-5 text-green-600"></i></div>
            <div><p class="text-xs text-gray-500">Today's Clock-ins</p><p class="text-xl font-bold">${summary.todayClockedIn}</p></div>
          </div>
        </div>
        <div class="bg-white rounded-xl border p-5">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center"><i data-lucide="database" class="w-5 h-5 text-blue-600"></i></div>
            <div><p class="text-xs text-gray-500">Total Records</p><p class="text-xl font-bold">${summary.totalRecords}</p></div>
          </div>
        </div>
        <div class="bg-white rounded-xl border p-5">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center"><i data-lucide="alert-triangle" class="w-5 h-5 text-red-600"></i></div>
            <div><p class="text-xs text-gray-500">Out of Bounds</p><p class="text-xl font-bold">${summary.statusBreakdown.out_of_bounds || 0}</p></div>
          </div>
        </div>
      </div>

      <!-- Recent Clock In / Out -->
      <div class="bg-white rounded-xl border p-6">
        <div class="flex items-center justify-between mb-4">
          <h3 class="font-semibold">Recent Clock In / Out</h3>
          <div class="flex items-center gap-3">
            <span id="recent-count" class="text-xs text-gray-400">Latest ${recent.records.length} of ${recent.total} records</span>
            <button id="refresh-recent" title="Refresh" class="p-1.5 rounded-lg text-gray-500 hover:text-brand-600 hover:bg-brand-50 transition">
              <i data-lucide="refresh-cw" class="w-4 h-4"></i>
            </button>
          </div>
        </div>
        <div id="recent-table-wrap">${recentTableHTML(recent)}</div>
      </div>

      <!-- Map -->
      <div class="bg-white rounded-xl border p-6">
        <h3 class="font-semibold mb-4">Geofences Overview</h3>
        <div id="map" class="w-full rounded-xl"></div>
      </div>
    </div>
  `;

  lucide.createIcons();
  initMap('map', null, null, geofences.geofences);

  // Refresh button: re-fetch only the recent table, keep the rest of the page intact
  document.getElementById('refresh-recent').addEventListener('click', async () => {
    const btn = document.getElementById('refresh-recent');
    const icon = btn.querySelector('i');
    if (btn.disabled) return;
    btn.disabled = true;
    if (icon) icon.classList.add('animate-spin');
    try {
      const fresh = await api('/attendance/team?limit=8&page=1');
      document.getElementById('recent-table-wrap').innerHTML = recentTableHTML(fresh);
      document.getElementById('recent-count').textContent =
        `Latest ${fresh.records.length} of ${fresh.total} records`;
      lucide.createIcons();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
      if (icon) icon.classList.remove('animate-spin');
    }
  });
}

function recentTableHTML(recent) {
  if (!recent.records || recent.records.length === 0) {
    return '<p class="text-gray-400 text-sm">No attendance records yet.</p>';
  }
  return `
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead><tr class="text-left text-gray-500 border-b">
          <th class="pb-2 pr-4">Employee</th><th class="pb-2 pr-4">Department</th><th class="pb-2 pr-4">Action</th><th class="pb-2 pr-4">Time</th><th class="pb-2">Status</th>
        </tr></thead>
        <tbody>
          ${recent.records.map(r => `
            <tr class="border-b border-gray-50">
              <td class="py-2 pr-4 font-medium">${r.full_name}</td>
              <td class="pr-4 text-gray-600">${r.department || '—'}</td>
              <td class="pr-4">
                ${r.clock_out_time
                  ? '<span class="inline-flex items-center gap-1 text-red-600 font-medium"><i data-lucide="log-out" class="w-4 h-4"></i> Clock Out</span>'
                  : '<span class="inline-flex items-center gap-1 text-green-600 font-medium"><i data-lucide="log-in" class="w-4 h-4"></i> Clock In</span>'}
              </td>
              <td class="pr-4 text-gray-600">${new Date(r.clock_out_time || r.clock_in_time).toLocaleString()}</td>
              <td><span class="status-badge ${statusColor(r.status)}">${(r.status || '').replace(/_/g, ' ')}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>`;
}

// ── Employee Management (Admin) ────────────────────────────────────────────
async function renderEmployees(container) {
  const data = await api('/employees?limit=200');

  container.innerHTML = `
    <div class="fade-in space-y-6">
      <div class="flex items-center justify-between flex-wrap gap-4">
        <h1 class="text-2xl font-bold">Employee Management</h1>
        <button id="add-emp-btn" class="bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition">
          <i data-lucide="user-plus" class="w-4 h-4"></i> Add Employee
        </button>
      </div>

      <!-- Filters -->
      <div class="bg-white rounded-xl border p-4 flex flex-wrap gap-3">
        <input id="emp-search" type="text" placeholder="Search name or email..." class="px-3 py-2 border rounded-lg text-sm flex-1 min-w-[200px]" />
        <select id="emp-dept-filter" class="px-3 py-2 border rounded-lg text-sm">
          <option value="">All Departments</option>
        </select>
        <select id="emp-role-filter" class="px-3 py-2 border rounded-lg text-sm">
          <option value="">All Roles</option>
          <option value="admin">Admin</option>
          <option value="supervisor">Supervisor</option>
          <option value="employee">Employee</option>
        </select>
      </div>

      <!-- Table -->
      <div class="bg-white rounded-xl border overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead><tr class="bg-gray-50 text-left text-gray-600">
              <th class="px-4 py-3">Name</th><th class="px-4 py-3">Username</th>
              <th class="px-4 py-3">Role</th><th class="px-4 py-3">Department</th>
              <th class="px-4 py-3">Status</th><th class="px-4 py-3">Actions</th>
            </tr></thead>
            <tbody id="emp-table-body">
              ${data.employees.map(empRow).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Add/Edit Modal -->
      <div id="emp-modal" class="hidden fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
        <div class="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-4">
          <h2 class="text-xl font-bold" id="modal-title">Add Employee</h2>
          <form id="emp-form" class="space-y-4">
            <input type="hidden" id="emp-id" />
            <div><label class="block text-sm font-medium mb-1">Full Name</label>
              <input id="emp-name" type="text" required class="w-full px-3 py-2 border rounded-lg" placeholder="John Doe" /></div>
            <div><label class="block text-sm font-medium mb-1">Username</label>
              <input id="emp-username" type="text" required class="w-full px-3 py-2 border rounded-lg" placeholder="johndoe" autocomplete="off" /></div>
            <div><label class="block text-sm font-medium mb-1">Email (optional)</label>
              <input id="emp-email" type="email" class="w-full px-3 py-2 border rounded-lg" placeholder="john@company.com" /></div>
            <div id="pw-field"><label class="block text-sm font-medium mb-1">Password</label>
              <input id="emp-pw" type="password" required class="w-full px-3 py-2 border rounded-lg" placeholder="••••••••" /></div>
            <div class="grid grid-cols-2 gap-4">
              <div><label class="block text-sm font-medium mb-1">Role</label>
                <select id="emp-role" class="w-full px-3 py-2 border rounded-lg">
                  <option value="employee">Employee</option><option value="supervisor">Supervisor</option><option value="admin">Admin</option>
                </select></div>
              <div><label class="block text-sm font-medium mb-1">Department</label>
                <input id="emp-dept" type="text" class="w-full px-3 py-2 border rounded-lg" placeholder="Engineering" /></div>
            </div>
            <div class="flex justify-end gap-3 pt-2">
              <button type="button" onclick="closeModal()" class="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">Cancel</button>
              <button type="submit" class="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700">Save</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  `;
  lucide.createIcons();

  // Populate department filter
  const depts = [...new Set(data.employees.map(e => e.department).filter(Boolean))];
  const deptSelect = document.getElementById('emp-dept-filter');
  depts.forEach(d => { const o = document.createElement('option'); o.value = d; o.textContent = d; deptSelect.appendChild(o); });

  // Search/filter
  const filterTable = () => {
    const q = document.getElementById('emp-search').value.toLowerCase();
    const dept = document.getElementById('emp-dept-filter').value;
    const role = document.getElementById('emp-role-filter').value;
    document.querySelectorAll('#emp-table-body tr').forEach(tr => {
      const text = tr.textContent.toLowerCase();
      const matchQ = !q || text.includes(q);
      const matchDept = !dept || tr.dataset.dept === dept;
      const matchRole = !role || tr.dataset.role === role;
      tr.style.display = (matchQ && matchDept && matchRole) ? '' : 'none';
    });
  };
  document.getElementById('emp-search').addEventListener('input', filterTable);
  document.getElementById('emp-dept-filter').addEventListener('change', filterTable);
  document.getElementById('emp-role-filter').addEventListener('change', filterTable);

  // Add employee button
  document.getElementById('add-emp-btn').addEventListener('click', () => {
    document.getElementById('emp-id').value = '';
    document.getElementById('emp-name').value = '';
    document.getElementById('emp-username').value = '';
    document.getElementById('emp-username').readOnly = false;
    document.getElementById('emp-email').value = '';
    document.getElementById('emp-pw').value = '';
    document.getElementById('emp-pw').required = true;
    document.getElementById('emp-role').value = 'employee';
    document.getElementById('emp-dept').value = '';
    document.getElementById('modal-title').textContent = 'Add Employee';
    document.getElementById('pw-field').style.display = '';
    document.getElementById('emp-modal').classList.remove('hidden');
  });

  // Form submit
  document.getElementById('emp-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('emp-id').value;
    const body = {
      full_name: document.getElementById('emp-name').value,
      username: document.getElementById('emp-username').value.trim(),
      email: document.getElementById('emp-email').value,
      role: document.getElementById('emp-role').value,
      department: document.getElementById('emp-dept').value,
    };
    const pw = document.getElementById('emp-pw').value;
    if (!id && pw) body.password = pw;

    try {
      if (id) {
        await api(`/employees/${id}`, { method: 'PUT', body: JSON.stringify(body) });
        showToast('Employee updated');
      } else {
        await api('/employees', { method: 'POST', body: JSON.stringify(body) });
        showToast('Employee created');
      }
      closeModal();
      renderEmployees(container);
    } catch (err) { showToast(err.message, 'error'); }
  });
}

function empRow(emp) {
  const roleColors = { admin: 'bg-purple-100 text-purple-700', supervisor: 'bg-blue-100 text-blue-700', employee: 'bg-gray-100 text-gray-700' };
  return `
    <tr class="border-t hover:bg-gray-50" data-dept="${emp.department}" data-role="${emp.role}">
      <td class="px-4 py-3 font-medium">${emp.full_name}</td>
      <td class="px-4 py-3 text-gray-600 font-mono text-xs">${emp.username}</td>
      <td class="px-4 py-3"><span class="px-2 py-0.5 rounded-full text-xs font-semibold ${roleColors[emp.role] || ''}">${emp.role}</span></td>
      <td class="px-4 py-3">${emp.department || '—'}</td>
      <td class="px-4 py-3"><span class="status-badge ${emp.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}">${emp.is_active ? 'Active' : 'Inactive'}</span></td>
      <td class="px-4 py-3">
        <button onclick="editEmployee(${emp.id})" class="text-brand-600 hover:text-brand-800 text-xs font-medium mr-2">Edit</button>
        <button onclick="deleteEmployee(${emp.id}, '${emp.full_name.replace(/'/g, "\\'")}')" class="text-red-500 hover:text-red-700 text-xs font-medium">Delete</button>
      </td>
    </tr>`;
}

// Global functions for inline onclick
window.editEmployee = async (id) => {
  const data = await api(`/employees/${id}`);
  const emp = data.employee;
  document.getElementById('emp-id').value = emp.id;
  document.getElementById('emp-name').value = emp.full_name;
  document.getElementById('emp-username').value = emp.username;
  document.getElementById('emp-username').readOnly = true;
  document.getElementById('emp-email').value = emp.email || '';
  document.getElementById('emp-role').value = emp.role;
  document.getElementById('emp-dept').value = emp.department;
  document.getElementById('emp-pw').required = false;
  document.getElementById('modal-title').textContent = 'Edit Employee';
  document.getElementById('pw-field').style.display = '';
  document.getElementById('emp-modal').classList.remove('hidden');
};

window.deleteEmployee = async (id, name) => {
  if (!confirm(`Are you sure you want to permanently delete ${name}?\n\nThis action cannot be undone and will remove all their attendance records.`)) return;
  try {
    await api(`/employees/${id}`, { method: 'DELETE' });
    showToast('Employee deleted');
    navigateTo('employees');
  } catch (err) { showToast(err.message, 'error'); }
};

function closeModal() { document.getElementById('emp-modal').classList.add('hidden'); }
window.closeModal = closeModal;

// ── Geofences Management (Admin) ──────────────────────────────────────────
async function renderGeofences(container) {
  const data = await api('/geofences/all');

  container.innerHTML = `
    <div class="fade-in space-y-6">
      <div class="flex items-center justify-between">
        <h1 class="text-2xl font-bold">Geofence Management</h1>
        <button id="add-gf-btn" class="bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition">
          <i data-lucide="plus-circle" class="w-4 h-4"></i> Add Geofence
        </button>
      </div>

      <!-- Map -->
      <div class="bg-white rounded-xl border p-6">
        <h3 class="font-semibold mb-4">Geofence Map</h3>
        <div id="map" class="w-full rounded-xl"></div>
      </div>

      <!-- Geofence List -->
      <div class="bg-white rounded-xl border overflow-hidden">
        <table class="w-full text-sm">
          <thead><tr class="bg-gray-50 text-left text-gray-600">
            <th class="px-4 py-3">Name</th><th class="px-4 py-3">Coordinates</th>
            <th class="px-4 py-3">Radius</th><th class="px-4 py-3">Status</th><th class="px-4 py-3">Actions</th>
          </tr></thead>
          <tbody>
            ${data.geofences.map(gf => `
              <tr class="border-t hover:bg-gray-50">
                <td class="px-4 py-3 font-medium">${gf.name}</td>
                <td class="px-4 py-3 font-mono text-xs">${gf.latitude.toFixed(5)}, ${gf.longitude.toFixed(5)}</td>
                <td class="px-4 py-3">${gf.radius_m}m</td>
                <td class="px-4 py-3"><span class="status-badge ${gf.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}">${gf.is_active ? 'Active' : 'Inactive'}</span></td>
                <td class="px-4 py-3 space-x-2">
                  <button onclick="editGeofence(${gf.id})" class="text-brand-600 hover:text-brand-800 text-xs font-medium">Edit</button>
                  <button onclick="deleteGeofence(${gf.id})" class="text-red-500 hover:text-red-700 text-xs font-medium">Deactivate</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <!-- Modal -->
      <div id="gf-modal" class="hidden fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
        <div class="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-4">
          <h2 class="text-xl font-bold" id="gf-modal-title">Add Geofence</h2>
          <form id="gf-form" class="space-y-4">
            <input type="hidden" id="gf-id" />
            <div><label class="block text-sm font-medium mb-1">Name</label>
              <input id="gf-name" type="text" required class="w-full px-3 py-2 border rounded-lg" placeholder="Downtown Office" /></div>
            <div class="grid grid-cols-2 gap-4">
              <div><label class="block text-sm font-medium mb-1">Latitude</label>
                <input id="gf-lat" type="number" step="any" required class="w-full px-3 py-2 border rounded-lg" placeholder="40.7128" /></div>
              <div><label class="block text-sm font-medium mb-1">Longitude</label>
                <input id="gf-lng" type="number" step="any" required class="w-full px-3 py-2 border rounded-lg" placeholder="-74.006" /></div>
            </div>
            <div><label class="block text-sm font-medium mb-1">Radius (meters)</label>
              <input id="gf-radius" type="number" min="50" max="50000" value="500" required class="w-full px-3 py-2 border rounded-lg" /></div>
            <div><label class="block text-sm font-medium mb-1">Description</label>
              <input id="gf-desc" type="text" class="w-full px-3 py-2 border rounded-lg" placeholder="Optional description" /></div>
            <div class="flex justify-end gap-3 pt-2">
              <button type="button" onclick="closeGfModal()" class="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">Cancel</button>
              <button type="submit" class="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700">Save</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  `;
  lucide.createIcons();
  initMap('map', null, null, data.geofences.filter(g => g.is_active));

  // Add button
  document.getElementById('add-gf-btn').addEventListener('click', () => {
    document.getElementById('gf-id').value = '';
    document.getElementById('gf-name').value = '';
    document.getElementById('gf-lat').value = '';
    document.getElementById('gf-lng').value = '';
    document.getElementById('gf-radius').value = '500';
    document.getElementById('gf-desc').value = '';
    document.getElementById('gf-modal-title').textContent = 'Add Geofence';
    document.getElementById('gf-modal').classList.remove('hidden');
  });

  // Form submit
  document.getElementById('gf-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('gf-id').value;
    const body = {
      name: document.getElementById('gf-name').value,
      latitude: parseFloat(document.getElementById('gf-lat').value),
      longitude: parseFloat(document.getElementById('gf-lng').value),
      radius_m: parseFloat(document.getElementById('gf-radius').value),
      description: document.getElementById('gf-desc').value,
    };
    try {
      if (id) {
        await api(`/geofences/${id}`, { method: 'PUT', body: JSON.stringify(body) });
        showToast('Geofence updated');
      } else {
        await api('/geofences', { method: 'POST', body: JSON.stringify(body) });
        showToast('Geofence created');
      }
      closeGfModal();
      renderGeofences(container);
    } catch (err) { showToast(err.message, 'error'); }
  });
}

window.editGeofence = async (id) => {
  const data = await api(`/geofences/${id}`);
  const gf = data.geofence;
  document.getElementById('gf-id').value = gf.id;
  document.getElementById('gf-name').value = gf.name;
  document.getElementById('gf-lat').value = gf.latitude;
  document.getElementById('gf-lng').value = gf.longitude;
  document.getElementById('gf-radius').value = gf.radius_m;
  document.getElementById('gf-desc').value = gf.description;
  document.getElementById('gf-modal-title').textContent = 'Edit Geofence';
  document.getElementById('gf-modal').classList.remove('hidden');
};

window.deleteGeofence = async (id) => {
  if (!confirm('Deactivate this geofence?')) return;
  try {
    await api(`/geofences/${id}`, { method: 'DELETE' });
    showToast('Geofence deactivated');
    navigateTo('geofences');
  } catch (err) { showToast(err.message, 'error'); }
};

function closeGfModal() { document.getElementById('gf-modal').classList.add('hidden'); }
window.closeGfModal = closeGfModal;

// ── Attendance Views ───────────────────────────────────────────────────────
function statusColor(status) {
  const map = {
    on_time: 'bg-green-100 text-green-700',
    late: 'bg-yellow-100 text-yellow-700',
    early: 'bg-blue-100 text-blue-700',
    offsite_verified: 'bg-blue-100 text-blue-700',
    out_of_bounds: 'bg-red-100 text-red-700',
    pending: 'bg-gray-100 text-gray-700',
    clocked_in: 'bg-brand-100 text-brand-700',
  };
  return map[status] || 'bg-gray-100 text-gray-700';
}

function attendanceTable(records) {
  if (!records.length) return '<p class="text-gray-400 p-4">No records found.</p>';
  return `
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead><tr class="bg-gray-50 text-left text-gray-600">
          <th class="px-4 py-3">Employee</th><th class="px-4 py-3">Dept</th>
          <th class="px-4 py-3">Clock In</th><th class="px-4 py-3">In Location</th>
          <th class="px-4 py-3">Clock Out</th><th class="px-4 py-3">Status</th>
        </tr></thead>
        <tbody>
          ${records.map(r => `
            <tr class="border-t hover:bg-gray-50">
              <td class="px-4 py-3 font-medium">${r.full_name}</td>
              <td class="px-4 py-3">${r.department || '—'}</td>
              <td class="px-4 py-3">${new Date(r.clock_in_time).toLocaleString()}</td>
              <td class="px-4 py-3 font-mono text-xs">${r.clock_in_lat?.toFixed(4)}, ${r.clock_in_lng?.toFixed(4)}</td>
              <td class="px-4 py-3">${r.clock_out_time ? new Date(r.clock_out_time).toLocaleString() : '—'}</td>
              <td class="px-4 py-3"><span class="status-badge ${statusColor(r.status)}">${r.status?.replace(/_/g, ' ')}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>`;
}

async function renderAllAttendance(container) {
  container.innerHTML = `
    <div class="fade-in space-y-6">
      <div class="flex items-center justify-between flex-wrap gap-4">
        <h1 class="text-2xl font-bold">All Attendance Records</h1>
        <div class="flex gap-2">
          <button onclick="exportAttendance('csv')" class="border px-3 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 flex items-center gap-1">
            <i data-lucide="download" class="w-4 h-4"></i> CSV
          </button>
          <button onclick="exportAttendance('xlsx')" class="border px-3 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 flex items-center gap-1">
            <i data-lucide="table" class="w-4 h-4"></i> Excel
          </button>
        </div>
      </div>

      <!-- Filters -->
      <div class="bg-white rounded-xl border p-4 flex flex-wrap gap-3">
        <input id="att-start" type="date" class="px-3 py-2 border rounded-lg text-sm" />
        <input id="att-end" type="date" class="px-3 py-2 border rounded-lg text-sm" />
        <select id="att-status-filter" class="px-3 py-2 border rounded-lg text-sm">
          <option value="">All Statuses</option>
          <option value="on_time">On Time</option><option value="late">Late</option>
          <option value="offsite_verified">Offsite Verified</option><option value="out_of_bounds">Out of Bounds</option>
        </select>
        <button onclick="loadAttendance()" class="bg-brand-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-brand-700">Filter</button>
      </div>

      <div id="att-results" class="bg-white rounded-xl border overflow-hidden">
        <div class="p-8 text-center text-gray-400">Loading...</div>
      </div>
    </div>
  `;
  lucide.createIcons();
  loadAttendance();
}

async function loadAttendance() {
  const start = document.getElementById('att-start').value;
  const end = document.getElementById('att-end').value;
  const status = document.getElementById('att-status-filter').value;
  let url = '/attendance/team?limit=200';
  if (start) url += `&start=${start}`;
  if (end) url += `&end=${end}`;
  if (status) url += `&status=${status}`;

  const data = await api(url);
  document.getElementById('att-results').innerHTML = attendanceTable(data.records);
}

window.exportAttendance = async (format) => {
  const start = document.getElementById('att-start')?.value;
  const end = document.getElementById('att-end')?.value;
  const status = document.getElementById('att-status-filter')?.value;
  let url = `/attendance/export?format=${format}`;
  if (start) url += `&start=${start}`;
  if (end) url += `&end=${end}`;
  if (status) url += `&status=${status}`;

  const headers = { Authorization: `Bearer ${authToken}` };
  const res = await fetch(`${API_BASE}${url}`, { headers });
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `attendance.${format === 'xlsx' ? 'xlsx' : 'csv'}`;
  a.click();
  showToast('Export downloaded');
};

// ── Team Attendance (Supervisor) ───────────────────────────────────────────
async function renderTeamAttendance(container) {
  container.innerHTML = `
    <div class="fade-in space-y-6">
      <h1 class="text-2xl font-bold">Team Attendance</h1>
      <div class="bg-white rounded-xl border p-4 flex flex-wrap gap-3">
        <input id="team-start" type="date" class="px-3 py-2 border rounded-lg text-sm" />
        <input id="team-end" type="date" class="px-3 py-2 border rounded-lg text-sm" />
        <button onclick="loadTeamAttendance()" class="bg-brand-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-brand-700">Filter</button>
      </div>
      <div id="team-results" class="bg-white rounded-xl border overflow-hidden"><div class="p-8 text-center text-gray-400">Loading...</div></div>
    </div>`;
  loadTeamAttendance();
}

async function loadTeamAttendance() {
  const start = document.getElementById('team-start')?.value;
  const end = document.getElementById('team-end')?.value;
  let url = '/attendance/team?limit=200';
  if (start) url += `&start=${start}`;
  if (end) url += `&end=${end}`;
  const data = await api(url);
  document.getElementById('team-results').innerHTML = attendanceTable(data.records);
}

// ── My Attendance (Employee) ───────────────────────────────────────────────
async function renderMyAttendance(container) {
  container.innerHTML = `
    <div class="fade-in space-y-6">
      <h1 class="text-2xl font-bold">My Attendance History</h1>
      <div class="bg-white rounded-xl border p-4 flex flex-wrap gap-3">
        <input id="my-start" type="date" class="px-3 py-2 border rounded-lg text-sm" />
        <input id="my-end" type="date" class="px-3 py-2 border rounded-lg text-sm" />
        <button onclick="loadMyAttendance()" class="bg-brand-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-brand-700">Filter</button>
      </div>
      <div id="my-results" class="bg-white rounded-xl border overflow-hidden"><div class="p-8 text-center text-gray-400">Loading...</div></div>
    </div>`;
  loadMyAttendance();
}

async function loadMyAttendance() {
  const start = document.getElementById('my-start')?.value;
  const end = document.getElementById('my-end')?.value;
  let url = '/attendance/me?limit=200';
  if (start) url += `&start=${start}`;
  if (end) url += `&end=${end}`;
  const data = await api(url);
  document.getElementById('my-results').innerHTML = attendanceTable(data.records);
}

// ── Audit Logs (Admin) ────────────────────────────────────────────────────
async function renderAuditLogs(container) {
  const actionsData = await api('/audit/actions');

  container.innerHTML = `
    <div class="fade-in space-y-6">
      <div class="flex items-center justify-between flex-wrap gap-4">
        <h1 class="text-2xl font-bold">Audit Logs</h1>
        <div class="flex gap-2">
          <button onclick="exportAudit('csv')" class="border px-3 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 flex items-center gap-1">
            <i data-lucide="download" class="w-4 h-4"></i> CSV
          </button>
          <button onclick="exportAudit('xlsx')" class="border px-3 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 flex items-center gap-1">
            <i data-lucide="table" class="w-4 h-4"></i> Excel
          </button>
        </div>
      </div>

      <div class="bg-white rounded-xl border p-4 flex flex-wrap gap-3">
        <input id="audit-start" type="date" class="px-3 py-2 border rounded-lg text-sm" />
        <input id="audit-end" type="date" class="px-3 py-2 border rounded-lg text-sm" />
        <select id="audit-action" class="px-3 py-2 border rounded-lg text-sm">
          <option value="">All Actions</option>
          ${actionsData.actions.map(a => `<option value="${a}">${a}</option>`).join('')}
        </select>
        <button onclick="loadAuditLogs()" class="bg-brand-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-brand-700">Filter</button>
      </div>

      <div id="audit-results" class="bg-white rounded-xl border overflow-hidden">
        <div class="p-8 text-center text-gray-400">Loading...</div>
      </div>
    </div>`;
  lucide.createIcons();
  loadAuditLogs();
}

async function loadAuditLogs() {
  const start = document.getElementById('audit-start')?.value;
  const end = document.getElementById('audit-end')?.value;
  const action = document.getElementById('audit-action')?.value;
  let url = '/audit?limit=200';
  if (start) url += `&start=${start}`;
  if (end) url += `&end=${end}`;
  if (action) url += `&action=${action}`;

  const data = await api(url);
  document.getElementById('audit-results').innerHTML = `
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead><tr class="bg-gray-50 text-left text-gray-600">
          <th class="px-4 py-3">Timestamp</th><th class="px-4 py-3">User</th>
          <th class="px-4 py-3">Action</th><th class="px-4 py-3">Details</th><th class="px-4 py-3">IP</th>
        </tr></thead>
        <tbody>
          ${data.logs.map(l => `
            <tr class="border-t hover:bg-gray-50">
              <td class="px-4 py-3 text-xs">${new Date(l.created_at).toLocaleString()}</td>
              <td class="px-4 py-3">${l.full_name || 'System'}</td>
              <td class="px-4 py-3"><span class="px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100">${l.action}</span></td>
              <td class="px-4 py-3 text-xs max-w-xs truncate">${l.details}</td>
              <td class="px-4 py-3 text-xs font-mono">${l.ip_address}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>`;
}

window.exportAudit = async (format) => {
  const start = document.getElementById('audit-start')?.value;
  const end = document.getElementById('audit-end')?.value;
  const action = document.getElementById('audit-action')?.value;
  let url = `/audit/export?format=${format}`;
  if (start) url += `&start=${start}`;
  if (end) url += `&end=${end}`;
  if (action) url += `&action=${action}`;

  const headers = { Authorization: `Bearer ${authToken}` };
  const res = await fetch(`${API_BASE}${url}`, { headers });
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `audit_log.${format === 'xlsx' ? 'xlsx' : 'csv'}`;
  a.click();
  showToast('Audit log exported');
};

// ── Reports ────────────────────────────────────────────────────────────────
async function renderReports(container) {
  const [summary, deptData] = await Promise.all([
    api('/reports/summary'),
    api('/reports/department'),
  ]);

  container.innerHTML = `
    <div class="fade-in space-y-6">
      <div class="flex items-center justify-between flex-wrap gap-4">
        <h1 class="text-2xl font-bold">Reports & Analytics</h1>
        <div class="flex gap-2">
          <button onclick="exportAttendance('csv')" class="border px-3 py-2 rounded-lg text-sm hover:bg-gray-50 flex items-center gap-1">
            <i data-lucide="download" class="w-4 h-4"></i> Export CSV
          </button>
          <button onclick="exportAttendance('xlsx')" class="border px-3 py-2 rounded-lg text-sm hover:bg-gray-50 flex items-center gap-1">
            <i data-lucide="table" class="w-4 h-4"></i> Export Excel
          </button>
        </div>
      </div>

      <!-- Summary Stats -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div class="bg-white rounded-xl border p-5 text-center">
          <p class="text-3xl font-bold text-brand-600">${summary.totalRecords}</p>
          <p class="text-sm text-gray-500">Total Attendance Records</p>
        </div>
        <div class="bg-white rounded-xl border p-5 text-center">
          <p class="text-3xl font-bold text-green-600">${summary.statusBreakdown.on_time || 0}</p>
          <p class="text-sm text-gray-500">On-Time Entries</p>
        </div>
        <div class="bg-white rounded-xl border p-5 text-center">
          <p class="text-3xl font-bold text-red-600">${summary.statusBreakdown.out_of_bounds || 0}</p>
          <p class="text-sm text-gray-500">Out-of-Bounds (Flagged)</p>
        </div>
      </div>

      <!-- Charts -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div class="bg-white rounded-xl border p-6">
          <h3 class="font-semibold mb-4">Attendance by Status</h3>
          <canvas id="report-status-chart" height="220"></canvas>
        </div>
        <div class="bg-white rounded-xl border p-6">
          <h3 class="font-semibold mb-4">Department Breakdown</h3>
          <canvas id="report-dept-chart" height="220"></canvas>
        </div>
      </div>

      <!-- Department Table -->
      <div class="bg-white rounded-xl border overflow-hidden">
        <div class="px-4 py-3 border-b font-semibold">Department Summary</div>
        <table class="w-full text-sm">
          <thead><tr class="bg-gray-50 text-left text-gray-600">
            <th class="px-4 py-3">Department</th><th class="px-4 py-3">Employees</th>
            <th class="px-4 py-3">Total Records</th><th class="px-4 py-3">Out of Bounds</th>
          </tr></thead>
          <tbody>
            ${deptData.departments.map(d => `
              <tr class="border-t hover:bg-gray-50">
                <td class="px-4 py-3 font-medium">${d.department || 'Unassigned'}</td>
                <td class="px-4 py-3">${d.employees}</td>
                <td class="px-4 py-3">${d.total_records}</td>
                <td class="px-4 py-3"><span class="${d.out_of_bounds > 0 ? 'text-red-600 font-semibold' : ''}">${d.out_of_bounds}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
  lucide.createIcons();

  // Status chart
  const sd = summary.statusBreakdown || {};
  new Chart(document.getElementById('report-status-chart'), {
    type: 'pie',
    data: {
      labels: Object.keys(sd).map(k => k.replace(/_/g, ' ')),
      datasets: [{ data: Object.values(sd), backgroundColor: ['#22c55e','#eab308','#3b82f6','#ef4444','#6366f1','#94a3b8','#f97316'] }],
    },
    options: { responsive: true, plugins: { legend: { position: 'bottom' } } },
  });

  // Dept chart
  const departments = deptData.departments.filter(d => d.department);
  new Chart(document.getElementById('report-dept-chart'), {
    type: 'bar',
    data: {
      labels: departments.map(d => d.department),
      datasets: [
        { label: 'Records', data: departments.map(d => d.total_records), backgroundColor: '#6366f1', borderRadius: 4 },
        { label: 'Out of Bounds', data: departments.map(d => d.out_of_bounds), backgroundColor: '#ef4444', borderRadius: 4 },
      ],
    },
    options: { responsive: true, scales: { y: { beginAtZero: true } } },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();
  updateClock();

  // Check for saved session
  const savedToken = localStorage.getItem('token');
  const savedUser = localStorage.getItem('user');
  if (savedToken && savedUser) {
    authToken = savedToken;
    currentUser = JSON.parse(savedUser);
    showApp();
  }

  // Login form
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    const errEl = document.getElementById('login-error');
    errEl.classList.add('hidden');

    try {
      await login(username, password);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
      if (err.message.startsWith('Cannot reach the server')) {
        showToast('Backend unreachable — see message above', 'warning');
      }
    }
  });

  // Logout
  document.getElementById('logout-btn').addEventListener('click', logout);

  // Sidebar toggle (mobile)
  document.getElementById('sidebar-toggle').addEventListener('click', toggleSidebar);
});
