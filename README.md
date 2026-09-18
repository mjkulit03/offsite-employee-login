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
│   └── app.js          # Frontend application logic
├── README.md
└── .gitignore
```

## Deployment

The app is hosted on **GitHub Pages**. Push to `main` and it auto-deploys.

No server, no database, no backend — just static files.

## License

MIT
