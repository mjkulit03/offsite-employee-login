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

- **JWT Authentication**: Stateless tokens with configurable expiry
- **RBAC**: Three roles (Admin, Supervisor, Employee) with route-level enforcement
- **Supervisor Scope**: Supervisors can only view their assigned team
- **Audit Trail**: All critical actions logged with user, timestamp, IP, and user agent
- **HTTPS Required**: Geolocation API requires HTTPS in production
- **CORS**: Configurable origin for web hosting

## 📊 Export Features

- **CSV Export**: Attendance records and audit logs
- **Excel Export**: Native .xlsx format using the xlsx library
- **Filters**: Date range, department, status, employee

## 🌐 Deployment

### Railway / Render / Fly.io
1. Push to GitHub
2. Connect your repo
3. Set environment variables (`JWT_SECRET`, etc.)
4. Deploy — the app runs on the configured `PORT`

### GitHub Pages (Static Frontend Only)
For a frontend-only deployment with a separate backend:
1. Build and deploy the `public/` folder to GitHub Pages
2. Host the backend on Render/Railway and set `API_BASE` in the frontend

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | HTML5, Tailwind CSS, JavaScript |
| Maps | Leaflet.js + OpenStreetMap |
| Charts | Chart.js |
| Icons | Lucide Icons |
| Backend | Node.js + Express |
| Database | SQLite (via better-sqlite3) |
| Auth | JWT (jsonwebtoken) |
| Passwords | bcryptjs |
| Export | xlsx library |

## 📝 License

MIT
