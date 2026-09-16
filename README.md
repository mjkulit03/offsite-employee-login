# 📍 Attendance & Location Tracking System

A full-stack web application for tracking remote/offsite employee attendance with geolocation verification, geofencing, and comprehensive audit trails.

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (SPA)                           │
│  HTML5 + Tailwind CSS + Leaflet.js + Chart.js                  │
│  Login │ Dashboard │ Map │ Clock In/Out │ Reports              │
├─────────────────────────────────────────────────────────────────┤
│                     REST API (Express.js)                      │
│  /api/auth  /api/attendance  /api/employees  /api/geofences   │
│  /api/audit  /api/reports                                     │
├─────────────────────────────────────────────────────────────────┤
│              SQLite + better-sqlite3                           │
│  users │ attendance │ geofences │ audit_logs                   │
└─────────────────────────────────────────────────────────────────┘
```

## 🗂️ Folder Structure

```
attendance-tracker/
├── public/                     # Static frontend files
│   ├── index.html              # SPA shell
│   └── app.js                  # Frontend application logic
├── src/                        # Backend source code
│   ├── server.js               # Express server entry point
│   ├── db/
│   │   ├── schema.js           # Database schema & connection
│   │   └── seed.js             # Seed data script
│   ├── middleware/
│   │   └── auth.js             # JWT auth & RBAC middleware
│   ├── routes/
│   │   ├── auth.js             # Login/logout/profile
│   │   ├── attendance.js       # Clock in/out, history, export
│   │   ├── employees.js        # Employee CRUD (admin)
│   │   ├── geofences.js        # Geofence CRUD (admin)
│   │   ├── audit.js            # Audit log viewing/export
│   │   └── reports.js          # Dashboard analytics & reports
│   └── utils/
│       ├── geofence.js         # Haversine distance & verification
│       └── audit.js            # Audit logging helper
├── data/                       # SQLite database (gitignored)
├── .env.example                # Environment template
├── .env                        # Local environment config
├── .gitignore
├── package.json
└── README.md
```

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ (recommended 20+)
- npm or yarn

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
# Edit .env with your settings (especially JWT_SECRET for production)
```

### 3. Seed the Database
```bash
npm run seed
```

This creates default users:
| Email | Password | Role |
|---|---|---|
| admin@company.com | admin123 | Admin |
| supervisor@company.com | super123 | Supervisor |
| alice@company.com | emp123 | Employee |
| bob@company.com | emp123 | Employee |
| carol@company.com | emp123 | Employee |

### 4. Start the Server
```bash
npm start
```

Open http://localhost:3000 in your browser.

## 📡 API Endpoints

### Authentication
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/api/auth/login` | Login and receive JWT | No |
| POST | `/api/auth/logout` | Log out (audit trail) | Yes |
| GET | `/api/auth/me` | Get current user profile | Yes |

### Attendance
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/api/attendance/clock-in` | Clock in with location | Yes |
| POST | `/api/attendance/clock-out` | Clock out with location | Yes |
| GET | `/api/attendance/status` | Current clock-in status | Yes |
| GET | `/api/attendance/me` | Personal attendance history | Yes |
| GET | `/api/attendance/team` | Team attendance (admin/sup) | Yes |
| GET | `/api/attendance/export` | Export to CSV/Excel | Yes |

### Employee Management
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/employees` | List employees | Admin/Sup |
| GET | `/api/employees/:id` | Get employee details | Admin/Sup |
| POST | `/api/employees` | Create employee | Admin |
| PUT | `/api/employees/:id` | Update employee | Admin |
| DELETE | `/api/employees/:id` | Deactivate employee | Admin |

### Geofences
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/geofences` | List active geofences | All |
| GET | `/api/geofences/all` | List all (incl. inactive) | Admin |
| POST | `/api/geofences` | Create geofence | Admin |
| PUT | `/api/geofences/:id` | Update geofence | Admin |
| DELETE | `/api/geofences/:id` | Deactivate geofence | Admin |

### Audit Logs
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/audit` | List audit logs | Admin |
| GET | `/api/audit/actions` | Distinct action types | Admin |
| GET | `/api/audit/export` | Export logs to CSV/Excel | Admin |

### Reports
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/reports/summary` | Dashboard statistics | Admin/Sup |
| GET | `/api/reports/department` | Department breakdown | Admin/Sup |

## 🗺️ Geofencing & Tamper Detection

The system uses the **Haversine formula** to calculate distance between the user's coordinates and the center of each active geofence:

1. On **Clock In/Out**, the browser captures GPS coordinates via the Geolocation API
2. The server calculates distance to all active geofences
3. If within any geofence radius → status is `offsite_verified`
4. If outside all geofences → status is `out_of_bounds` (flagged for review)
5. All actions are logged to the **audit trail** with coordinates and distance

## 🔒 Security

- **JWT Authentication**: Stateless tokens (no expiry by default; sessions last until logout/secret change)
- **RBAC**: Three roles (Admin, Supervisor, Employee) with route-level enforcement
- **Supervisor Scope**: Supervisors can only view their assigned team
- **Audit Trail**: All critical actions logged with user, timestamp, IP, and user agent
- **HTTPS Required**: Geolocation API requires HTTPS in production
- **CORS**: Configurable origin for web hosting

## 📊 Export Features

- **CSV Export**: Attendance records and audit logs
- **Excel Export**: Native .xlsx format using the xlsx library
- **Filters**: Date range, department, status, employee

## 🌐 Deployment — Access the App from Anywhere

Your code lives on GitHub ([mjkulit03/offsite-employee-login](https://github.com/mjkulit03/offsite-employee-login)), but GitHub only stores code — to open the app in a browser from anywhere, run it on a hosting service that deploys from GitHub. GitHub Pages will **not** work here: it hosts static files only and cannot run the Express backend or SQLite database.

This app needs a host with a **persistent disk** (the SQLite file must survive restarts) and **HTTPS** (browser geolocation is blocked on plain HTTP). Render with the blueprint in this repo satisfies both.

### Deploy to Render (recommended, ~5 minutes)

A `render.yaml` blueprint is included, so most settings are automatic.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/mjkulit03/offsite-employee-login)

**If the button doesn't work, do it manually (always works):**

1. Sign up / log in at [render.com](https://render.com) with your GitHub account
2. Go to **Blueprints** → **New Blueprint Instance** → select `mjkulit03/offsite-employee-login`
3. Render reads `render.yaml` and pre-fills everything:
   - Build: `npm install` · Start: `npm start` (seeds default users on first boot)
   - Persistent disk mounted at `/var/data` → `DB_PATH=/var/data/attendance.db`
   - `JWT_SECRET` is generated automatically
4. Click **Apply** and wait for the first deploy to finish
5. Your app is now live at `https://offsite-employee-login.onrender.com` (exact URL shown on the dashboard)

Log in with the seeded admin account and **change the password right away** (Employees → Edit). Every future `git push` to `main` auto-deploys.

> **Note:** the cheapest Render plan with a persistent disk is paid (~$7/mo). Without a disk, the SQLite file resets on every restart and all attendance data would be lost.

### Free alternative: Cloudflare Tunnel from your own PC

Zero monthly cost; data stays on your machine. Requires your PC to stay on:

1. Install cloudflared and run `npm start` locally
2. In a second terminal: `cloudflared tunnel --url http://localhost:3000`
3. You get a public HTTPS URL like `https://random-name.trycloudflare.com` — share it with your team

### Office LAN only (no internet needed)

Run `npm start`, then employees on the same Wi-Fi open `http://<your-PC-IP>:3000`. Geolocation clock-in will **not** work on phones this way (browsers require HTTPS for location).

### After deploying to any host

| Setting | Value |
|---|---|
| `JWT_SECRET` | Strong random value (Render generates one) |
| `DB_PATH` | Path on the persistent disk, e.g. `/var/data/attendance.db` |
| `CORS_ORIGIN` | Your app's URL once you have a domain |
| Admin password | Change `admin123` immediately after first login |

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | HTML5, Tailwind CSS, JavaScript |
| Maps | Leaflet.js + OpenStreetMap |
| Charts | Chart.js |
| Icons | Lucide Icons |
| Backend | Node.js + Express |
| Database | SQLite (via sql.js) |
| Auth | JWT (jsonwebtoken) |
| Passwords | bcryptjs |
| Export | xlsx library |

## 📝 License

MIT
