# Attendance & Location Tracker

A web-based attendance and location tracking system for remote/offsite employees. **Pure client-side** — runs entirely in the browser with `localStorage`. No backend server required.

## Live Demo

**https://mjkulit03.github.io/offsite-employee-login/**

## Features

- **Clock In / Clock Out** with GPS geolocation verification
- **Geofence management** — define office boundaries and auto-verify location
- **Employee management** — add, edit, deactivate employees
- **Attendance history** — personal and team views with filters
- **Audit logs** — track all user actions
- **Reports** — dashboard stats, status breakdowns
- **CSV export** — download attendance and audit data
- **Role-based access** — Admin, Supervisor, Employee

## Login Credentials

| Username   | Password  | Role       |
|------------|-----------|------------|
| `admin`    | `admin123`| Admin      |
| `supervisor`| `super123`| Supervisor |
| `alice`    | `emp123`  | Employee   |
| `bob`      | `emp123`  | Employee   |
| `carol`    | `emp123`  | Employee   |

## Tech Stack

- **HTML / CSS / JavaScript** — no frameworks, no build step
- **Tailwind CSS** (CDN) — styling
- **Leaflet.js** (CDN) — maps and geofence visualization
- **Chart.js** (CDN) — dashboard charts
- **Lucide Icons** (CDN) — icons
- **localStorage** — all data persistence (users, attendance, geofences, audit logs)

## How It Works

1. `data.js` intercepts all `fetch()` calls to `/api/*` and routes them to localStorage
2. `app.js` makes API calls exactly like it would with a real backend — the mock layer handles everything
3. All data persists in your browser until you clear it

## Project Structure

```
├── public/
│   ├── index.html      # Main app shell (login + app layout)
│   ├── data.js         # localStorage-backed mock API layer
│   ├── config.js       # Runtime configuration
│   ├── app.js          # Frontend application logic
│   └── .nojekyll       # Serves dotfiles as-is on GitHub Pages
├── tests/
│   ├── data-layer.test.mjs   # API layer tests (auth, attendance, reports…)
│   └── helpers/mock-env.mjs  # Browser-global stubs + data.js loader
├── .github/workflows/deploy-pages.yml  # Auto-deploy to GitHub Pages
├── package.json        # Test scripts only — no dependencies, no build step
└── README.md
```

## Development

No install step needed — everything is dependency-free. To run the test suite
(exercises the mock API layer with Node's built-in test runner, Node 18+):

```bash
npm test

# Syntax-check the browser scripts:
npm run check

# Local preview:
cd public && python -m http.server 8000
# then open http://localhost:8000
```

### Testing clock-in without GPS

The employee dashboard has a **"Demo: use office location instead of GPS"**
link under the map. Click it to clock in at the first active geofence without
granting location permissions — handy for demos and local testing.

## Deployment

The app is hosted on **GitHub Pages**. Push to `main` and it auto-deploys.

No server, no database, no backend — just static files.

## License

MIT
