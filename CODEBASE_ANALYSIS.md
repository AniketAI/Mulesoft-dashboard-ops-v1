# MuleSoft Integration Dashboard — Complete Codebase Analysis

> **Generated:** September 2026 · **Updated:** January 2026
> **Repository:** `mastanpanasala/mulesoft-ops-dashboard`
> **Branch:** `salesforce-theme`
> **Analysis Scope:** All source files in `backend/` and `frontend/`
>
> **Note:** The Topology / Dependency Graph feature (`topologyController.js`, `dependencyGraphService.js`, the `/api/topology` route, `TopologyPage.jsx`, `DependencyGraph.jsx`, and the `@xyflow/react` dependency) described in earlier versions of this document was removed from the codebase (commit `4e78abe "topology removed"`). All references to it have been removed below to match the current source tree.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture Diagram](#2-architecture-diagram)
3. [Tech Stack](#3-tech-stack)
4. [Directory Structure](#4-directory-structure)
5. [Backend — Deep Dive](#5-backend--deep-dive)
6. [Frontend — Deep Dive](#6-frontend--deep-dive)
7. [Complete Feature Inventory](#7-complete-feature-inventory)
8. [Backend API Reference](#8-backend-api-reference)
9. [Data Flow & State Management](#9-data-flow--state-management)
10. [Caching Strategy](#10-caching-strategy)
11. [Security Implementation](#11-security-implementation)
12. [Demo / Dev Mode](#12-demo--dev-mode)
13. [Configuration & Environment Variables](#13-configuration--environment-variables)
14. [Component Dependency Map](#14-component-dependency-map)
15. [Design Decisions & Patterns](#15-design-decisions--patterns)

---

## 1. Project Overview

The **MuleSoft Integration Dashboard** is an internal full-stack web application that provides a unified, browser-based interface for managing Anypoint Platform resources. It consolidates visibility and operational control over **all Business Groups and Environments** from a single screen.

### Core Objectives

| Objective | Description |
|---|---|
| **Unified Visibility** | Single pane of glass for all CloudHub applications (CH1 & CH2) |
| **Config Management** | Full CRUD interface for CPS (Config Property Server) properties |
| **Health Monitoring** | Automated ping/health checks with credential auto-resolution |
| **API Governance** | Browse API Manager instances and Anypoint Exchange assets |
| **Dependency Mapping** | Visual topology graph of inter-application dependencies |
| **Operational Safety** | Production safety banners, diff review modals, undo support |
| **CPS Comparison** | Side-by-side diff of CPS property sets across environments |
| **User Search** | Platform user discovery across all Business Groups |

> Note: an earlier **Dependency Mapping** objective (visual topology graph) existed in a previous iteration of this app and has since been removed.

### Application Details

- **Name:** `mulesoft-dashboard-backend` / `mulesoft-dashboard-frontend`
- **GitHub:** `mastanpanasala/mulesoft-ops-dashboard`
- **Version:** 1.0.0
- **Audience:** Platform/Integration Operations teams
- **Node.js:** >= 18 required

---

## 2. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                  Browser — React 18 SPA (port 5173)             │
│                                                                 │
│  React Router v7  ·  TailwindCSS (dark theme, bg-gray-950)     │
│  Axios + SWR in-memory cache (3-min fresh / 20-min stale)      │
│  Context API: Auth, Toast, Notification, Credentials           │
│  xlsx  ·  Lucide React icons  ·  cronstrue                     │
└──────────────────────────────┬──────────────────────────────────┘
                               │ HTTP/JSON  (:5000)
                               │ Cookie: express-session
                               │ (httpOnly, SameSite=lax, 24h)
┌──────────────────────────────▼──────────────────────────────────┐
│               Node.js / Express Backend (port 5000)             │
│                                                                 │
│  express-session → SQLite store (data/sessions.db)             │
│  Rate-limiting (auth endpoints — 20/15min in production)       │
│  CORS: localhost:5173 + localhost:3000                          │
│  Body limits: 1MB (general) / 50MB (CPS routes)                │
│  Axios proxy → Anypoint Platform REST APIs                     │
└──────────────────────────────┬──────────────────────────────────┘
                               │ HTTPS
                               │ Bearer token (from session)
┌──────────────────────────────▼──────────────────────────────────┐
│            Anypoint Platform API (anypoint.mulesoft.com)        │
│                                                                 │
│  Accounts API  ·  ARM (Runtime Manager)  ·  API Manager        │
│  Exchange  ·  CloudHub 1.0  ·  CloudHub 2.0  ·  User API       │
└─────────────────────────────────────────────────────────────────┘
                               │ HTTPS (separate)
┌──────────────────────────────▼──────────────────────────────────┐
│           CPS Server (Config Property Server — internal)        │
│                                                                 │
│  Non-secure properties  ·  Secure properties  ·  Binaries     │
│  Auth/ACL management  ·  OAuth2 client credentials             │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Tech Stack

### Backend

| Package | Version | Purpose |
|---|---|---|
| `express` | ^4.18.2 | HTTP server framework |
| `express-session` | ^1.17.3 | Session management |
| `connect-sqlite3` | ^0.9.18 | SQLite-backed session store (persists across restarts) |
| `axios` | ^1.6.0 | HTTP client for proxying to Anypoint Platform & CPS |
| `cors` | ^2.8.5 | CORS middleware (allows `:5173`, `:3000`) |
| `express-rate-limit` | ^8.6.2 | Rate limiting for auth endpoints (prod only) |
| `dotenv` | ^16.3.1 | Environment variable loading |
| `node-cache` | ^5.1.2 | In-process server-side cache |
| `js-yaml` | ^5.2.3 | YAML serialization for CPS export |
| `nodemon` | ^3.0.2 | Dev auto-restart |

### Frontend

| Package | Version | Purpose |
|---|---|---|
| `react` | ^18.2.0 | UI framework |
| `react-dom` | ^18.2.0 | DOM rendering |
| `react-router-dom` | ^7.18.3 | Client-side routing (v7) |
| `axios` | ^1.6.0 | HTTP client (to backend) |
| `xlsx` | ^0.18.5 | Excel export (CPS comparison, bulk CPS export) |
| `lucide-react` | ^0.303.0 | Icon library |
| `cronstrue` | ^3.27.0 | Human-readable cron expressions |
| `tailwindcss` | ^3.4.0 | Utility-first CSS framework |
| `vite` | ^8.2.1 | Build tool & dev server |
| `@vitejs/plugin-react` | ^6.0.5 | Vite React plugin |
| `autoprefixer` | ^10.4.16 | CSS vendor prefixing |
| `postcss` | ^8.4.32 | CSS processing |

---

## 4. Directory Structure

```
mulesoft-dashboard/
├── .gitattributes
├── .gitignore
├── jsconfig.json
├── SOP-Dashboard-Usage.md          ← Full user manual
├── CODEBASE_ANALYSIS.md            ← This file
│
├── backend/
│   ├── .env.example                ← Environment variable template
│   ├── package.json
│   ├── data/                       ← SQLite session DB (git-ignored)
│   └── src/
│       ├── server.js               ← Express app entry point
│       ├── controllers/            ← (currently empty)
│       ├── middleware/
│       │   └── authMiddleware.js   ← Session auth guard
│       ├── routes/
│       │   ├── auth.js             ← Login / logout / session
│       │   ├── organizations.js    ← Business groups
│       │   ├── environments.js     ← Environment listing
│       │   ├── applications.js     ← App listing, details, actions
│       │   ├── apis.js             ← API Manager instances
│       │   ├── exchange.js         ← Exchange asset search
│       │   ├── metrics.js          ← Application metrics
│       │   ├── cps.js              ← CPS CRUD (largest route file)
│       │   └── health.js           ← Ping test + credential resolution
│       ├── services/                ← (currently empty)
│       └── utils/
│           ├── anypointClient.js   ← Axios factory for Anypoint API
│           ├── appHelpers.js       ← Application data helpers
│           ├── db.js               ← Database utilities
│           ├── exchangeHelpers.js  ← Exchange data helpers
│           ├── orgHelpers.js       ← Organization/BG data helpers
│           └── responseHelpers.js  ← Unified response formatting
│
└── frontend/
    ├── index.html
    ├── package.json
    ├── vite.config.js
    ├── tailwind.config.js
    ├── postcss.config.js
    └── src/
        ├── App.jsx                 ← Root: routes + context providers
        ├── main.jsx                ← React DOM entry
        ├── index.css               ← Global styles
        │
        ├── pages/                  ← 10 top-level pages
        │   ├── LoginPage.jsx
        │   ├── ApplicationsPage.jsx
        │   ├── ApplicationDetailPage.jsx
        │   ├── ApiManagerPage.jsx
        │   ├── ExchangePage.jsx
        │   ├── PingTestPage.jsx
        │   ├── CpsManagerPage.jsx
        │   ├── CpsComparisonPage.jsx
        │   ├── GlobalCpsManagerPage.jsx
        │   └── GlobalSearchPage.jsx
        │
        ├── components/             ← 28 reusable components
        │   ├── Layout.jsx          ← App shell (sidebar + content)
        │   ├── Sidebar.jsx
        │   ├── Header.jsx
        │   ├── StatusBadge.jsx
        │   ├── Skeleton.jsx
        │   ├── EmptyState.jsx
        │   ├── ErrorBanner.jsx
        │   ├── Select.jsx
        │   ├── Tooltip.jsx
        │   ├── CopyBtn.jsx
        │   ├── PingTestPanel.jsx
        │   ├── PingResultCard.jsx
        │   ├── AttemptLog.jsx
        │   ├── BgFilterModal.jsx
        │   ├── EnvFilterModal.jsx
        │   ├── CredentialImportButton.jsx
        │   ├── GlobalCpsCsvUpload.jsx
        │   ├── CpsAuthPanel.jsx
        │   ├── CpsBinaryUploadPanel.jsx
        │   ├── CpsCreateModal.jsx
        │   ├── CpsCredentialImportButton.jsx
        │   ├── CpsCredTestButton.jsx
        │   ├── CpsDeleteProjectModal.jsx
        │   ├── CpsExportModal.jsx
        │   ├── CpsImportModal.jsx
        │   ├── CpsRawJsonModal.jsx
        │   ├── CpsRequestResponsePanel.jsx
        │   └── CpsSettingsModal.jsx
        │
        ├── context/                ← 5 React Context providers
        │   ├── AuthContext.jsx
        │   ├── CredentialStoreContext.jsx
        │   ├── CpsCredentialStoreContext.jsx
        │   ├── NotificationContext.jsx
        │   └── ToastContext.jsx
        │
        ├── services/               ← API layer + caching
        │   ├── api.js              ← Unified API facade (demo/real branching)
        │   ├── apiCache.js         ← SWR in-memory cache engine
        │   ├── axiosClient.js      ← Axios instance + interceptors
        │   ├── cacheKeys.js        ← Centralized cache key constants
        │   ├── prefetch.js         ← Background data prefetching
        │   ├── mockData.js         ← Demo mode mock data
        │   └── mockCpsData.json    ← Demo mode CPS mock data
        │
        └── utils/                  ← Pure utility functions
            ├── appUtils.js         ← App data transformation
            ├── cpsHelpers.js       ← CPS data parsing helpers
            ├── csvCredentialStore.js ← In-memory CSV credential store
            ├── demoMode.js         ← Demo mode localStorage flag
            ├── exportCps.js        ← Excel/CSV export logic
            ├── filterUtils.js      ← BG/Env filter helpers
            ├── globalCpsCsvParser.js ← CSV bulk credential parser
            └── mockCpsData.js      ← Additional mock CPS utilities
```

---

## 5. Backend — Deep Dive

### 5.1 Entry Point — `server.js`

The Express application bootstraps with these responsibilities in order:

1. **Session secret validation** — fails fast in production if `SESSION_SECRET` is unset or default
2. **SQLite session store** — replaces MemoryStore; sessions persist across restarts in `./data/sessions.db`
3. **Trust proxy** — enabled in production for nginx/load-balancer deployments
4. **CORS** — allows `localhost:5173` and `localhost:3000` with credentials
5. **Body parsing** — 1MB limit globally; 50MB for `/api/cps` routes (large property payloads)
6. **Session middleware** — 24-hour cookie, `httpOnly: true`, `sameSite: lax`, `secure: true` in production
7. **Rate limiting** — 20 auth requests per 15 minutes per IP (production only)
8. **Route mounting** — 9 route groups under `/api/`
9. **Global error handler** — 4-parameter Express error middleware catches all `next(err)` calls

**Key configuration:**
```
PORT=5000
SESSION_SECRET=<64-char random hex>
NODE_ENV=production|development
SESSION_DB_DIR=./data (default)
```

### 5.2 Middleware

#### `authMiddleware.js`
- Guards all protected routes
- Checks `req.session.token` existence
- Returns `401 Unauthorized` if not authenticated
- Used on every route except `/api/auth/*`

### 5.3 Routes

#### `auth.js` — Authentication
Three login strategies, all sharing a common `storeSession()` helper:

| Endpoint | Method | Strategy |
|---|---|---|
| `/api/auth/login` | POST | Username + Password → `POST /accounts/login` |
| `/api/auth/token-login` | POST | Bearer token (strips "Bearer " prefix) → validate via `/accounts/api/me` |
| `/api/auth/connected-app-login` | POST | OAuth2 client credentials → `POST /accounts/api/v2/oauth2/token` |
| `/api/auth/logout` | POST | Destroys session |
| `/api/auth/session` | GET | Returns session state (user, orgId, memberOrgs, accessibleEnvironments) |

**`storeSession()` logic:**
- Calls `/accounts/api/me` to fetch full user profile
- Finds root organization (no parentId)
- Builds `accessibleEnvironments` map per org filtered by role-scoped environment IDs
- Stores token, user profile, and org membership in session (never sent to client)

#### `cps.js` — Config Property Server (Most Complex Route)

The CPS route handles all operations against the internal Config Property Server. Key features:

**Credential Resolution (4-tier priority):**
1. Session key `{normalised-url}::{bgOrgId}` — per-server × per-BG (most specific)
2. Session key `{normalised-url}` — per-server fallback
3. Legacy session keys (`ch1_prod`, `ch2_prod`, `ch1_uat`, `ch2_uat`)
4. Environment variables `CPS_CH1_PROD_CLIENT_ID` / `CPS_CH1_PROD_CLIENT_SECRET`

**CPS Fetch with Intelligent Retry (`GET /api/cps/fetch`):**
- Detects wrong credentials via HTTP 401 or `"COULD NOT ACCESS"` string in response
- Retries in batches of 5 across all session credentials for that CPS base URL
- Promotes working credential to primary position to avoid repeated retries
- Per-group retry for secure properties — different groups may need different credentials
- Supports self-signed certificates (`rejectUnauthorized: false`)

**Endpoints:**

| Endpoint | Method | Description |
|---|---|---|
| `GET /api/cps/credentials` | GET | List configured credentials (masked) |
| `POST /api/cps/credentials` | POST | Store CPS credentials in session |
| `DELETE /api/cps/credentials/:key` | DELETE | Remove a credential from session |
| `GET /api/cps/fetch` | GET | Fetch properties (non-secure / secure / binaries) with retry |
| `POST /api/cps/write` | POST | Create or update CPS properties (POST/PUT) |
| `DELETE /api/cps/project` | DELETE | Delete entire CPS project entry |
| `GET /api/cps/auth` | GET | Fetch access control list for a project key |
| `POST /api/cps/auth` | POST | Update ACL (replace or non-destructive add) |
| `POST /api/cps/credentials/test` | POST | Test credentials without saving |
| `POST /api/cps/binary` | POST | Upload binary file (base64 → Buffer → CPS) |
| `POST /api/cps/search-user` | POST | Fan-out search: find apps containing a username in properties |

**`POST /api/cps/search-user` highlights:**
- Accepts up to 30 concurrent app scans (batches of 30)
- Supports comma-separated search terms
- Searches both non-secure and secure CPS properties
- Credential retry logic per app — promotes working credential to session for subsequent apps
- Returns matched property key/value, source (non-secure/secure), and related password property

**CPS property path mapping:**
```
non-secure     → /api/v2/properties/non-secure
non-secure-all → /api/v2/properties/non-secure/all
secure         → /api/v2/properties/secure
secure-all     → /api/v2/properties/secure/all
binaries       → /api/v2/binaries/secure
binaries-auth  → /api/v2/binaries/secure/auth
```

#### `health.js` — Ping Test & Credential Auto-Resolution

**Ping endpoint tries paths in order:**
1. `/api/v1/ping`
2. `/api/v2/ping`
3. `/api/ping`
4. `/ping`

**Status codes:**
- `SUCCESS` — 2xx response
- `PARTIAL` — 4xx/5xx response received
- `FAILED` — Connection error / timeout
- `SKIPPED_CONTRACT_PENDING` — OAuth contract awaiting approval

**Auto-credential resolution (5 layers):**
1. Match by `api.id` from CPS non-secure properties
2. Match by API Manager instance ID
3. Match by application name (exact)
4. Match by application name (fuzzy/partial)
5. Match by domain name

Additional endpoints:
- `POST /api/health/auto-contract-creds` — fetch contract credentials from API Manager
- `POST /api/health/oauth2-token` — obtain OAuth2 token for JWT-authenticated pings

#### `applications.js` — Application Management

| Endpoint | Description |
|---|---|
| `GET /api/applications/summary/:orgId` | List all apps (CH1 + CH2) in a BG |
| `GET /api/applications/cloudhub2/:orgId/:envId/:appId` | CloudHub 2.0 app details |
| `GET /api/applications/cloudhub1/:envId/:appId` | CloudHub 1.0 app details |
| `POST /api/applications/cloudhub2/:orgId/:envId/:appId/action` | Start/stop/restart CH2 app |
| `POST /api/applications/cloudhub1/:envId/:appId/action` | Start/stop/restart CH1 app |

#### Other Routes

| Route file | Endpoints |
|---|---|
| `organizations.js` | `GET /api/organizations/business-groups` |
| `environments.js` | `GET /api/environments/:orgId` |
| `apis.js` | `GET /api/apis/:orgId/:envId` — API Manager instances |
| `exchange.js` | `GET /api/exchange/search` — Exchange asset search |
| `metrics.js` | `GET /api/metrics/:orgId/:envId/:appId` — App metrics |

### 5.4 Controllers & Services

The `backend/src/controllers/` and `backend/src/services/` directories currently contain no files. A previous iteration of the app had a `topologyController.js` and `dependencyGraphService.js` here (dependency-graph/topology computation engine); this was removed (commit `4e78abe`) along with the `/api/topology` route and its frontend page.

### 5.5 Utilities

| File | Purpose |
|---|---|
| `anypointClient.js` | Creates an Axios instance pre-configured with `baseURL=anypoint.mulesoft.com`, `Authorization: Bearer {token}`, 30s timeout |
| `appHelpers.js` | Normalizes CH1/CH2 app response shapes into a unified schema |
| `db.js` | SQLite helpers (session store setup) |
| `exchangeHelpers.js` | Transforms Exchange API response into a simplified asset shape |
| `orgHelpers.js` | `mapOrgShape()` — normalizes Anypoint org objects; used during login to build `memberOrgs` |
| `responseHelpers.js` | Unified response envelope (`{ data, total, error }`) |

---

## 6. Frontend — Deep Dive

### 6.1 Application Root — `App.jsx`

**Context provider nesting order (outermost first):**
```
ToastProvider
  NotificationProvider
    CpsCredentialStoreProvider
      CredentialStoreProvider
        AuthProvider
          BrowserRouter
            Routes
```

**Route definitions:**

| Path | Component | Protected |
|---|---|---|
| `/login` | `LoginPage` | No |
| `/` | Redirect to `/applications` | Yes |
| `/applications` | `ApplicationsPage` | Yes |
| `/applications/:orgId/:envId/:appId` | `ApplicationDetailPage` | Yes |
| `/api-manager` | `ApiManagerPage` | Yes |
| `/exchange` | `ExchangePage` | Yes |
| `/ping-test` | `PingTestPage` | Yes |
| `/cps-compare` | `CpsComparisonPage` | Yes |
| `/user-search` | `GlobalSearchPage` | Yes |
| `/cps-manager` | `CpsManagerPage` | Yes |
| `/global-cps-manager` | `GlobalCpsManagerPage` | Yes |

**`ProtectedRoute` component:** Shows a centered spinner while `AuthContext.loading === true`, redirects to `/login` if `user` is falsy.

### 6.2 Context Providers

#### `AuthContext.jsx`
- On mount: calls `GET /auth/session` to restore session from cookie
- Exposes: `user`, `orgId`, `orgName`, `memberOrgs`, `accessibleEnvironments`, `loading`
- `login()`: calls backend `/auth/login` or `/auth/token-login` or `/auth/connected-app-login`
- `logout()`: calls `/auth/logout`, clears cache (`clearCache()`), resets state
- Auto-redirect to `/login` on 401 responses (handled via Axios interceptor in `axiosClient.js`)

#### `CredentialStoreContext.jsx`
- In-memory store for **Ping credentials** (client_id / client_secret pairs)
- Populated by importing a CSV file via `CredentialImportButton`
- Never persisted to localStorage or sent to backend
- Exposes: `credentials[]`, `importCredentials(csvText)`, `clearCredentials()`

#### `CpsCredentialStoreContext.jsx`
- In-memory store for **CPS credentials** (client_id / client_secret pairs)
- Populated via `CpsCredentialImportButton` or `GlobalCpsCsvUpload`
- Sent to backend via `POST /api/cps/credentials` when a CPS operation is performed
- Exposes: `cpsCredentials[]`, `importCpsCredentials(csvText)`, `clearCpsCredentials()`

#### `ToastContext.jsx`
- Global toast notification system
- Methods: `showToast(message, type)` where type is `success | error | warning | info`
- Auto-dismiss with configurable duration

#### `NotificationContext.jsx`
- Persistent in-app notification bell/panel
- Stores operation completion events (CPS saves, app start/stop results)
- Separate from transient toasts

### 6.3 Pages

#### `LoginPage.jsx`
Three login tabs: Username/Password, Access Token, Connected App. Handles form validation, error display, and demo mode activation.

#### `ApplicationsPage.jsx` — Main Dashboard
The most feature-rich page. Key capabilities:
- **Data loading:** Fans out across all visible BGs → fetches apps per BG in parallel
- **Filtering:** Name search (substring), BG selector, environment selector, status filter, type filter (CH1/CH2)
- **Filter persistence:** All filter selections saved to `localStorage`
- **Sorting:** All columns sortable (click header)
- **Row selection:** Checkboxes per row + header select-all; selected rows float to top
- **Bulk actions:** Start All / Stop All / Restart All on selected apps
- **Bulk Ping:** Opens ping panel for selected (or all visible) apps
- **Bulk CPS Export:** Exports CPS properties for selected apps to Excel (one sheet per app)
- **CSV Upload:** Upload a CSV of app names to bulk-select matching rows; supports exact/fuzzy matching and env filtering
- **Per-row actions:** Start, Stop, Restart, CPS Manager (deep link), Open in Anypoint
- **Deep link to CPS:** Clicking database icon navigates to `/cps-manager` with BG + Env + App pre-selected

#### `ApplicationDetailPage.jsx`
Displays full details for a single app (`/applications/:orgId/:envId/:appId`). Sections: hero header with status, deployment properties, runtime info, ingress URLs. CPS Manager button in hero pre-selects the app in CPS Manager.

#### `ApiManagerPage.jsx`
Lists API instances from Anypoint API Manager. Filterable by BG and Environment. Shows instance name, version, status, applied policies. Row click reveals full instance details and allows copying the instance ID.

#### `ExchangePage.jsx`
Anypoint Exchange browser. Full-text search with asset type filters (RAML, OAS, connector, template, example, etc.). Displays asset coordinates (groupId, assetId, version) with copy buttons. Version history and documentation links.

#### `PingTestPage.jsx`
Health check center. Shows live ping results with status color coding. Displays attempt log (each path tried), response time, HTTP status, credential used. Receives pre-populated app list from Applications page via navigation state for bulk pings.

#### `CpsManagerPage.jsx` — Primary Config Management Tool
Full CRUD interface for CPS properties. Key features:
- **Selector panel:** BG → Environment → Application cascade; auto-fills CPS connection fields from app's ARM properties when an app is selected
- **Connection presets:** Up to 5 CPS Base URLs saved to localStorage for quick reuse
- **Non-Secure tab:** Inline-editable property table with change tracking (NEW/MOD/DEL badges)
- **Secure tab:** Per-group property editors with Auth button and Delete Group
- **Binaries tab:** List and upload binary files (JKS keystores, PEM certs)
- **Access Control tab:** Manage OAuth2 client credentials per project key
- **Undo:** `Ctrl+Z` to undo last property change; up to N levels
- **Auto-draft:** Pending changes auto-saved to localStorage; restores on return
- **Production safety:** Red banner + red Save button when environment is production
- **Diff modal:** Shows old → new values before confirming save
- **Session change log:** Records every save action with timestamp and outcome
- **Request/Response panel:** Shows exact HTTP request sent and raw response for debugging
- **Import/Export:** CSV import, multi-format export (JSON / .properties / YAML / Env vars / CSV)
- **Bulk Add:** Paste `key=value` lines or JSON to add multiple properties at once
- **Find & Replace:** Search in values, replace all occurrences
- **Value type detection:** Automatically identifies placeholders, URLs, UUIDs, booleans, numbers, JSON

#### `CpsComparisonPage.jsx`
Compares CPS property sets side-by-side across 2–4 environments for the same application. Color-coded differences (yellow = differs, red = missing, gray = matches). Excel export of the full comparison matrix.

#### `GlobalCpsManagerPage.jsx`
Cross-BG, cross-environment CPS manager. Allows managing CPS properties for apps across multiple Business Groups simultaneously. Includes the `GlobalCpsCsvUpload` component for bulk credential management.

#### `GlobalSearchPage.jsx`
Search Anypoint Platform users by name or email. Fans out across all BGs. Shows user details, roles, and BG membership. Copy user ID and email buttons.

### 6.4 Components

#### Layout Components
| Component | Role |
|---|---|
| `Layout.jsx` | App shell — sidebar + `<Outlet>` for page content |
| `Sidebar.jsx` | Navigation links to all 11 pages; collapsible |
| `Header.jsx` | Top bar — user info, BG filter, Env filter, credential import buttons |

#### Shared UI Components
| Component | Role |
|---|---|
| `StatusBadge.jsx` | Colored pill for app status (RUNNING=green, STOPPED=gray, FAILED=red, etc.) |
| `Skeleton.jsx` | Loading placeholder shimmer animations |
| `EmptyState.jsx` | Illustrated empty-state message with optional action button |
| `ErrorBanner.jsx` | Red dismissible error banner |
| `Select.jsx` | Styled `<select>` wrapper |
| `Tooltip.jsx` | Hover tooltip using portal rendering |
| `CopyBtn.jsx` | Click-to-copy button with confirmation checkmark |

#### CPS-Specific Components
| Component | Role |
|---|---|
| `CpsAuthPanel.jsx` | OAuth2 ACL management panel (allowedClientIds / readOnlyClientIds) |
| `CpsBinaryUploadPanel.jsx` | Binary file upload (JKS, PEM, etc.) with drag-drop |
| `CpsCreateModal.jsx` | Modal to create a new CPS project entry |
| `CpsCredentialImportButton.jsx` | CSV import for CPS credentials |
| `CpsCredTestButton.jsx` | Test a CPS credential pair without saving |
| `CpsDeleteProjectModal.jsx` | Delete-project confirmation (requires typing project key in Production) |
| `CpsExportModal.jsx` | Multi-format property export (CSV / JSON / .properties / YAML / Env vars) |
| `CpsImportModal.jsx` | Bulk CSV property import with preview |
| `CpsRawJsonModal.jsx` | View raw CPS API response JSON |
| `CpsRequestResponsePanel.jsx` | Collapsible debug panel showing exact HTTP req/res |
| `CpsSettingsModal.jsx` | CPS connection settings (Base URL presets, environment, project key) |

#### Health / Ping Components
| Component | Role |
|---|---|
| `PingTestPanel.jsx` | Main ping test form + results table |
| `PingResultCard.jsx` | Per-app ping result card (status, time, endpoint, credentials) |
| `AttemptLog.jsx` | Shows each URL path tried during a ping attempt |

#### Filter & Credential Components
| Component | Role |
|---|---|
| `BgFilterModal.jsx` | Multi-select Business Group visibility filter |
| `EnvFilterModal.jsx` | Multi-select Environment visibility filter |
| `CredentialImportButton.jsx` | CSV import for Ping credentials |
| `GlobalCpsCsvUpload.jsx` | Bulk CSV upload for CPS credentials (multi-BG) |

### 6.5 Services Layer

#### `api.js` — Unified API Facade
The central API module that wraps all HTTP calls with demo-mode short-circuiting:
- **Real mode:** Delegates to `axiosClient` (which handles interceptors, base URL, auth)
- **Demo mode:** Routes requests to `mockHandler()` which returns pre-defined mock data with a 350ms artificial delay
- Exports: `api.get()`, `api.post()`, `api.delete()`, `api.patch()`, `api.put()`
- Also re-exports demo mode helpers for backwards compatibility

#### `axiosClient.js` — HTTP Client
Axios instance configured with:
- `baseURL: /api` (relative, proxied by Vite dev server to `:5000`)
- `withCredentials: true` (sends session cookie)
- **Response interceptor:** Redirects to `/login` on 401; shows error toast on 5xx

#### `apiCache.js` — SWR Cache Engine
Sophisticated in-memory cache (see §10 for full details). Key exports:
- `getCached(key)` — simple read
- `getCachedSWR(key)` — returns `{ data, stale }` for SWR pattern
- `setCached(key, data, staleMs)` — write with custom TTL
- `getOrFetch(key, fetchFn, staleMs)` — fetch-or-cache with inflight deduplication
- `bustCache(keyPrefix)` — invalidate by prefix
- `clearCache()` — full clear (called on logout)
- `keepFresh(key, fetchFn)` — register for background proactive refresh
- `stopKeepingFresh(key)` — deregister

#### `cacheKeys.js`
Centralized constants for all cache keys, preventing key collision across pages.

#### `prefetch.js`
Background prefetching module — preloads BG list, environments, and apps in the background immediately after login so subsequent navigations feel instant.

#### `mockData.js` + `mockCpsData.json`
Complete mock data sets for demo mode: mock user, orgs, environments, apps, app detail, APIs, Exchange assets, CPS properties, ping history, topology graph.

### 6.6 Utilities

| File | Purpose |
|---|---|
| `appUtils.js` | Normalizes CH1/CH2 app objects into a unified shape; generates `compositeId = appId\|envId\|bgId` |
| `cpsHelpers.js` | Parses all CPS response formats (array, responses[], flat object) into a uniform `{key: value}` map; detects value types (URL, UUID, boolean, number, placeholder, JSON) |
| `csvCredentialStore.js` | Parses credential CSV, stores pairs in memory, provides lookup by app name or client ID |
| `demoMode.js` | `isDemoMode()`, `enableDemoMode()`, `disableDemoMode()` — all backed by `localStorage` key `mulesoft_demo_mode` |
| `exportCps.js` | Generates Excel workbooks (`xlsx`) from CPS property sets; one sheet per app for bulk export |
| `filterUtils.js` | Reads/writes BG and Env filter selections from `localStorage`; provides filtered views of org and environment lists |
| `globalCpsCsvParser.js` | Parses a multi-credential CSV (format: `clientId,clientSecret`) into a keyed map; used by `GlobalCpsCsvUpload` |
| `mockCpsData.js` | Additional mock helpers for CPS demo mode |

---

## 7. Complete Feature Inventory

### Feature 1 — Authentication
- **Login methods:** Username/Password, Bearer Token (paste from browser/CLI), Connected App (OAuth2 client credentials)
- **Session persistence:** SQLite-backed — survives server restarts without logging out users
- **Session duration:** 24 hours
- **Security:** Credentials stored in session only (server-side), never in browser storage
- **Auto-logout:** 401 interceptor in `axiosClient.js` redirects to `/login`
- **Token cleanup:** `Bearer ` prefix auto-stripped from token input

### Feature 2 — Applications Management (Main Dashboard)
- **Multi-BG fan-out:** Fetches apps from all accessible Business Groups in parallel
- **Unified view:** CH1 and CH2 apps displayed in a single table
- **Column sorting:** Name, Status, Environment, Type, Mule Version, Last Modified
- **Filters:** Name search, BG, Environment, Status (RUNNING/STOPPED/FAILED/DEPLOYING/etc.), Type (CH1/CH2)
- **Filter persistence:** All filters saved to `localStorage`
- **Row selection:** Per-row checkbox + header select-all; selected rows float to top
- **Actions per row:** Start, Stop, Restart (with confirmation modal), CPS Manager deep link, Open in Anypoint
- **Bulk operations:** Start All / Stop All / Restart All on selected rows with result tracking
- **Bulk Ping:** Run health checks on selected (or all visible) apps
- **Bulk CPS Export:** Excel file with one sheet per selected app's CPS properties
- **CSV bulk select:** Upload CSV of app names → matching rows auto-selected; supports exact/fuzzy and env filter
- **SWR cache:** 3-min fresh window; Refresh button bypasses cache

### Feature 3 — Application Detail Page
- Deep-link route: `/applications/:orgId/:envId/:appId`
- **Sections:** Hero (name, status, type, env, Mule version), Start/Stop/Restart/Open actions, ARM deployment properties, runtime info, CloudHub 2.0 ingress URLs
- **CPS Manager button:** Pre-selects BG + Env + App in CPS Manager on navigate

### Feature 4 — API Manager
- Lists all API instances for a selected BG + Environment
- Shows: name, version, status, applied policies
- Copy API instance ID
- Row expand: full instance details

### Feature 5 — Anypoint Exchange Browser
- Full-text search across all Exchange asset types
- Filter by type: RAML, OAS, connector, template, example, integration, etc.
- Shows asset coordinates: `groupId:assetId:version` with copy buttons
- Version history and documentation preview

### Feature 6 — Ping Test (Health Monitoring)
- **Path probing:** Tries 4 paths per app (`/api/v1/ping`, `/api/v2/ping`, `/api/ping`, `/ping`)
- **Status codes:** SUCCESS (2xx), PARTIAL (4xx/5xx), FAILED (connection error), SKIPPED_CONTRACT_PENDING
- **Auto-credential resolution (5 layers):** api.id from CPS → API Manager match → exact name → fuzzy name → domain
- **Manual override:** Enter client_id/client_secret per app
- **Bulk mode:** Launched from Applications page with pre-selected app list
- **Concurrency:** Batched parallel execution
- **Attempt log:** Shows each URL tried, HTTP status, response time
- **JWT ping support:** OAuth2 token obtained before pinging JWT-secured APIs
- **Contract credential fetch:** Resolves credentials from API Manager contracts

### Feature 7 — CPS Property Manager (Full CRUD)
- **Selector cascade:** BG → Environment → Application; auto-fills CPS URL/env/key from ARM properties
- **Base URL presets:** Up to 5 saved in localStorage
- **Non-secure properties:**
  - Inline cell editing (click value → type → Enter to commit, Escape to cancel)
  - Add row (bottom of table)
  - Bulk Add (paste `key=value` lines or JSON)
  - Delete row (marked as pending DEL)
  - Find & Replace across all values
  - Search/filter visible rows
  - Change indicators: NEW (green), MOD (blue), DEL (red)
  - Undo with Ctrl+Z (up to N steps)
  - Auto-draft to localStorage; restore banner on return
  - Save with diff preview modal
  - Production safety: red banner + red Save button + explicit confirmation
- **Secure properties:** Per-group editors; Auth button; Delete Group (requires typing key in prod)
- **Binary properties:** List existing binaries; upload new binary files (base64 → CPS)
- **Access Control:** View/manage OAuth2 allowedClientIds and readOnlyClientIds per project key
- **Export formats:** CSV, JSON, Java `.properties`, YAML, environment variable format
- **Import:** CSV upload with preview (N properties to add/update)
- **Session Change Log:** Collapsible audit trail at bottom of page
- **Request/Response debug panel:** Exact HTTP details after every write

### Feature 8 — CPS Comparison
- Select BG + Application + 2 to 4 environments
- Fetches CPS properties for each environment in parallel
- Diff matrix: yellow = value differs, red = key missing, gray = matches all
- Excel export of comparison with color coding
- Primary use case: UAT vs Production pre-release validation

### Feature 9 — Global CPS Manager
- Cross-BG CPS management
- Bulk credential CSV upload via `GlobalCpsCsvUpload`
- Manage properties across multiple BGs from one interface

> **Removed feature:** Topology / Dependency Graph (directed graph of inter-app dependencies, built with `@xyflow/react`) existed in a prior iteration and was removed from the codebase.

### Feature 11 — User Search
- Search platform users by name or email across all BGs
- Fan-out across root org and all sub-BGs
- Shows: name, email, roles, BG membership
- Copy user ID and email

### Feature 12 — Credential Management
- **Two independent stores** (both in-memory, cleared on tab close):
  - `CredentialStoreContext` — Ping credentials (client_id/client_secret for API calls)
  - `CpsCredentialStoreContext` — CPS credentials (for CPS server authentication)
- **CSV formats:** `clientId,clientSecret` per line
- **Backend pre-configuration:** CPS credentials can be pre-set in `.env` for shared team use
- **Credential test button:** Verify CPS credentials before saving
- **Auto-resolution for ping:** 5-layer matching algorithm

### Feature 13 — Global Filters (BG & Environment)
- **BG Filter:** Hide specific Business Groups globally across all pages
- **Env Filter:** Hide specific environments globally
- Both persisted in `localStorage`
- Reduces noise in fan-out API calls for large organizations

### Feature 14 — Demo Mode
- Toggle via `localStorage` key `mulesoft_demo_mode`
- All API calls short-circuit to `mockHandler()` — no backend needed
- Full mock data: users, orgs, envs, apps, CPS properties, ping history, topology
- 350ms artificial delay for realistic feel
- CPS write operations simulate success without actual calls

### Feature 15 — SWR Caching & Performance
- In-memory cache with 3-min fresh / 20-min stale windows
- Inflight request deduplication (multiple components requesting same key share one HTTP call)
- Proactive background refresh via `keepFresh()` registry
- `requestIdleCallback`-based sweep (Safari fallback: `setTimeout`)
- LRU eviction at 300-entry cap
- Per-key custom TTL (BG data: 30min, app data: 3min)
- `bustCache(prefix)` for targeted invalidation after mutations

### Feature 16 — Keyboard Shortcuts
| Shortcut | Context | Action |
|---|---|---|
| `Ctrl+Z` | CPS Manager non-secure table | Undo last property change |
| `Enter` | CPS property edit cell | Commit and move to next |
| `Escape` | CPS property edit cell | Cancel edit |
| `Enter` | Add new property row | Add the property |

---

## 8. Backend API Reference

### Auth Routes (`/api/auth`)
| Method | Endpoint | Body | Response |
|---|---|---|---|
| POST | `/login` | `{username, password}` | `{success, user, orgId}` |
| POST | `/token-login` | `{token}` | `{success, user, orgId}` |
| POST | `/connected-app-login` | `{clientId, clientSecret}` | `{success, user, orgId}` |
| POST | `/logout` | — | `{success}` |
| GET | `/session` | — | `{authenticated, user, memberOrgs, accessibleEnvironments}` |

### Organizations (`/api/organizations`)
| Method | Endpoint | Response |
|---|---|---|
| GET | `/business-groups` | `{data: BG[], total}` |

### Environments (`/api/environments`)
| Method | Endpoint | Response |
|---|---|---|
| GET | `/:orgId` | `{data: Env[], total}` |

### Applications (`/api/applications`)
| Method | Endpoint | Response |
|---|---|---|
| GET | `/summary/:orgId` | `{data: App[], total, environments}` |
| GET | `/cloudhub2/:orgId/:envId/:appId` | Full CH2 app detail |
| GET | `/cloudhub1/:envId/:appId` | Full CH1 app detail |
| POST | `/cloudhub2/:orgId/:envId/:appId/action` | `{success, status}` |
| POST | `/cloudhub1/:envId/:appId/action` | `{success, status}` |

### APIs (`/api/apis`)
| Method | Endpoint | Response |
|---|---|---|
| GET | `/:orgId/:envId` | `{assets: APIInstance[], total}` |

### Exchange (`/api/exchange`)
| Method | Endpoint | Query | Response |
|---|---|---|---|
| GET | `/search` | `search, type, offset, limit` | `{assets[], total}` |

### Metrics (`/api/metrics`)
| Method | Endpoint | Response |
|---|---|---|
| GET | `/:orgId/:envId/:appId` | App metrics object |

### CPS (`/api/cps`)
| Method | Endpoint | Description |
|---|---|---|
| GET | `/credentials` | List configured credentials (masked) |
| POST | `/credentials` | Store credentials in session |
| DELETE | `/credentials/:key` | Remove credential by key |
| GET | `/fetch` | Fetch CPS properties (non-secure/secure/binaries) |
| POST | `/write` | Write CPS properties (POST=create, PUT=update) |
| DELETE | `/project` | Delete entire CPS project entry |
| GET | `/auth` | Get ACL for project key |
| POST | `/auth` | Update ACL (replace or add) |
| POST | `/credentials/test` | Test credentials without saving |
| POST | `/binary` | Upload binary file |
| POST | `/search-user` | Fan-out username search across app CPS properties |

### Health (`/api/health`)
| Method | Endpoint | Description |
|---|---|---|
| POST | `/ping` | Ping a single app endpoint |
| POST | `/auto-credentials` | Auto-resolve credentials for an app |
| POST | `/auto-contract-creds` | Fetch contract credentials from API Manager |
| POST | `/oauth2-token` | Obtain OAuth2 token for JWT ping |

### Topology (`/api/topology`)
| Method | Endpoint | Query | Response |
|---|---|---|---|
| GET | `/` | `orgId, envId, cpsBaseUrl, cpsEnvironment` | `{nodes[], edges[]}` |

### Server Health
| Method | Endpoint | Response |
|---|---|---|
| GET | `/api/ping` | `{status: "ok", timestamp}` |

---

## 9. Data Flow & State Management

### Authentication Flow
```
LoginPage → api.post('/auth/login') → backend storeSession()
  → Anypoint /accounts/login → access_token
  → Anypoint /accounts/api/me → user profile
  → session.token + session.user + session.memberOrgs stored server-side
  → AuthContext.user populated from /auth/session on mount
```

### Applications Load Flow
```
ApplicationsPage mount
  → prefetch.js (if not already done) loads BG list
  → For each visible BG (not in BG filter):
      GET /api/applications/summary/:orgId
      → backend fans out CH1 + CH2 API calls
      → returns normalized app array
  → getOrFetch(cacheKey, fetchFn) → SWR cache hit or HTTP call
  → React state: apps[], loading, error
  → Client-side filter/sort
```

### CPS Property Edit Flow
```
CpsManagerPage:
  1. Select BG → env → app
  2. App selection → auto-fill cpsBaseUrl, cpsEnv, projectKey from ARM properties
  3. Load Properties → GET /api/cps/fetch?baseUrl&type&environment&keys
     → backend credential resolution (4-tier)
     → CPS GET /api/v2/properties/non-secure
     → retry on 401 or COULD NOT ACCESS
  4. Inline edit → local pendingChanges state (NEW/MOD/DEL)
  5. Auto-draft → pendingChanges serialized to localStorage
  6. Save → diff modal → confirm
     → POST /api/cps/write {baseUrl, type, environment, projectKey, properties}
     → backend builds CPS body format + PUT to CPS server
     → session change log entry + request/response panel update
```

### CPS Credential Resolution (Backend)
```
Session cpsCreds map:
  Priority 1: "{normalizedUrl}::{bgOrgId}"  (most specific)
  Priority 2: "{normalizedUrl}"             (per-server)
  Priority 3: "ch1_prod" etc.              (legacy)
  Priority 4: process.env.CPS_*_CLIENT_*   (env vars)

On 401 / COULD NOT ACCESS:
  → collect all session entries starting with "{normalizedUrl}::"
  → retry in batches of 5
  → promote working credential to priority 1 + 2
```

---

## 10. Caching Strategy

The frontend uses a custom **Stale-While-Revalidate (SWR)** in-memory cache implemented in `apiCache.js`.

### Cache Windows

| Window | Duration | Meaning |
|---|---|---|
| `FRESH_MS` | 3 minutes | Data is fresh — no network call |
| `STALE_MS` | 20 minutes | Data is stale-but-usable — background refetch triggered |
| `> STALE_MS` | Expired | Entry evicted on next read |

### Key Operations

| Function | Behaviour |
|---|---|
| `getOrFetch(key, fn)` | Fresh hit → instant return. Stale hit → return stale + background refetch. Miss → deduplicated HTTP call |
| `getCachedSWR(key)` | Returns `{data, stale}` — callers decide whether to trigger background refresh |
| `setCached(key, data, staleMs)` | Write with per-entry custom TTL |
| `bustCache(prefix)` | Invalidate all keys matching prefix (used after mutations) |
| `clearCache()` | Full clear on logout |
| `keepFresh(key, fn)` | Register for proactive background refresh |

### LRU Eviction
- Hard cap: **300 entries**
- On overflow: evict one expired entry, or if all fresh — evict oldest (Map insertion order)

### Background Sweep
- Uses `requestIdleCallback` (Safari fallback: `setTimeout` at 3-min interval)
- **Job 1:** Evict expired entries
- **Job 2:** Proactively refresh stale registered keys (keepFresh registry)

### Inflight Deduplication
Multiple React components mounting simultaneously and requesting the same key share **one** HTTP call. All waiters receive the same resolved promise.

### Per-Key Custom TTL
- Business Groups: 30 minutes (slow-changing)
- Applications: 3 minutes (fast-changing operational data)
- Environments: 30 minutes

### Dev Diagnostics
In development, `window.__cacheStats()` in the browser console shows all cache entries, ages, stale status, and inflight count.

---

## 11. Security Implementation

### Authentication Security
| Measure | Implementation |
|---|---|
| Credentials never in browser | Token stored server-side in express-session |
| Session cookie flags | `httpOnly: true`, `sameSite: lax`, `secure: true` (prod) |
| Session duration | 24 hours (`maxAge`) |
| Session persistence | SQLite — survives restart without re-auth |
| Rate limiting | 20 login attempts / 15 min / IP (production only) |
| Session secret validation | Fails fast in production if default/missing |
| Trust proxy | Set for correct `req.secure` behind load balancer |

### CPS Security
| Measure | Implementation |
|---|---|
| Credentials in session | CPS client_id/secret stored server-side only |
| Masked credential list | `GET /cps/credentials` returns only first 8 chars + `…` |
| Credential test endpoint | Test without storing — `POST /cps/credentials/test` |
| Self-signed cert support | `rejectUnauthorized: false` for internal CA certs |
| Production safety banner | Red UI warning + red Save button when env is production |
| Delete confirmation | Requires typing project key when deleting in production |

### Input Validation
- All CPS write endpoints validate `baseUrl`, `environment`, `projectKey` presence
- HTTP method validation (`POST` or `PUT` only)
- CPS type validation against allowed values
- Binary file: base64 decoded, max 50MB

### CSRF Protection
- `sameSite: lax` on session cookie blocks cross-site POST requests
- CORS restricted to known origins (`localhost:5173`, `localhost:3000`)

### Operational Best Practices (from SOP)
- Never commit `.env` to git
- Each team member logs in individually (no shared credentials)
- Rate limiting enforced in production only
- Production CPS changes require diff review + explicit confirmation
- CPS credentials imported via CSV (in-memory) — never pasted into properties

---

## 12. Demo / Dev Mode

### Activation
```javascript
// Enable
localStorage.setItem('mulesoft_demo_mode', 'true')

// Check
localStorage.getItem('mulesoft_demo_mode') === 'true'

// Disable
localStorage.removeItem('mulesoft_demo_mode')
```

### Behaviour in Demo Mode
- All `api.get()`, `api.post()`, `api.delete()`, `api.patch()`, `api.put()` calls short-circuit to `mockHandler()`
- No backend server required
- 350ms artificial delay on each call for realism
- Full mock data available for every route

### Mock Data Coverage
| Route | Mock Data |
|---|---|
| `/auth/session` | Demo user, org, BG |
| `/environments` | 3 mock environments |
| `/applications/summary` | 10+ mock apps (CH1 + CH2) |
| `/applications/cloudhub2` | Full app detail |
| `/organizations/business-groups` | 3 mock BGs |
| `/apis` | 5 mock API instances |
| `/exchange/search` | 8 mock Exchange assets |
| `/cps/fetch` | Non-secure + secure mock properties |
| `/cps/write` | Simulated success |
| `/topology` | 5 nodes, 4 edges (XAPI→PAPI→SAPI) |
| `/health/ping` | Random success with ~100ms response time |
| `/health/ping/history` | 2 pre-seeded history entries |

### Circular Dependency Prevention
`demoMode.js` is extracted from `api.js` so `axiosClient.js` can import `isDemoMode()` without creating a circular dependency (`api.js → axiosClient.js → api.js`).

---

## 13. Configuration & Environment Variables

### Backend — `backend/.env`

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `5000` | Backend HTTP port |
| `SESSION_SECRET` | **Yes (prod)** | `mulesoft-dashboard-secret` | Session signing secret (min 64 chars in prod) |
| `ANYPOINT_PLATFORM_URL` | No | `https://anypoint.mulesoft.com` | Anypoint Platform base URL |
| `SESSION_DB_DIR` | No | `./data` | Directory for SQLite session database |
| `NODE_ENV` | No | — | Set to `production` for prod features |
| `CPS_CH1_PROD_CLIENT_ID` | No | — | CPS CloudHub 1.0 Production client ID |
| `CPS_CH1_PROD_CLIENT_SECRET` | No | — | CPS CloudHub 1.0 Production client secret |
| `CPS_CH2_PROD_CLIENT_ID` | No | — | CPS CloudHub 2.0 Production client ID |
| `CPS_CH2_PROD_CLIENT_SECRET` | No | — | CPS CloudHub 2.0 Production client secret |
| `CPS_CH1_UAT_CLIENT_ID` | No | — | CPS CloudHub 1.0 UAT client ID |
| `CPS_CH1_UAT_CLIENT_SECRET` | No | — | CPS CloudHub 1.0 UAT client secret |
| `CPS_CH2_UAT_CLIENT_ID` | No | — | CPS CloudHub 2.0 UAT client ID |
| `CPS_CH2_UAT_CLIENT_SECRET` | No | — | CPS CloudHub 2.0 UAT client secret |

### Frontend — `localStorage` Keys

| Key | Purpose |
|---|---|
| `mulesoft_demo_mode` | Demo mode flag (`true`/absent) |
| `bg_filter` | Hidden Business Group IDs (JSON array) |
| `env_filter` | Hidden Environment IDs (JSON array) |
| `cps_url_presets` | Up to 5 CPS Base URL presets (JSON array) |
| `cps_pending_draft_{key}` | Auto-saved CPS property draft (JSON) |
| Various filter keys | Applications page filter selections (BG, env, status, type) |

### npm Scripts

| Location | Script | Command |
|---|---|---|
| Backend | `npm start` | `node src/server.js` |
| Backend | `npm run dev` | `nodemon src/server.js` |
| Backend | `npm run clean:all` | Remove `node_modules` |
| Frontend | `npm run dev` | `vite` (port 5173) |
| Frontend | `npm run build` | `vite build` |
| Frontend | `npm run preview` | `vite preview` |
| Frontend | `npm run clean:all` | Remove `node_modules` |

---

## 14. Component Dependency Map

### Context Consumer Map

| Component/Page | Contexts Used |
|---|---|
| All protected pages | `AuthContext` |
| `Header.jsx` | `AuthContext`, `ToastContext` |
| `PingTestPage`, `PingTestPanel` | `CredentialStoreContext`, `AuthContext` |
| `CpsManagerPage`, `GlobalCpsManagerPage` | `CpsCredentialStoreContext`, `AuthContext`, `ToastContext` |
| `GlobalSearchPage` | `AuthContext`, `ToastContext` |
| `CpsCredentialImportButton` | `CpsCredentialStoreContext` |
| `CredentialImportButton` | `CredentialStoreContext` |
| All pages with mutations | `ToastContext`, `NotificationContext` |

### Page → Component Dependencies

```
ApplicationsPage
  ├── Sidebar, Header, Layout
  ├── StatusBadge
  ├── Skeleton, EmptyState, ErrorBanner
  ├── BgFilterModal, EnvFilterModal
  ├── CredentialImportButton
  └── Select, Tooltip, CopyBtn

CpsManagerPage
  ├── Sidebar, Header, Layout
  ├── Select, Skeleton, ErrorBanner, Tooltip
  ├── CpsSettingsModal
  ├── CpsAuthPanel
  ├── CpsBinaryUploadPanel
  ├── CpsCreateModal
  ├── CpsDeleteProjectModal
  ├── CpsExportModal
  ├── CpsImportModal
  ├── CpsRawJsonModal
  ├── CpsRequestResponsePanel
  ├── CpsCredentialImportButton
  └── CpsCredTestButton

PingTestPage
  ├── PingTestPanel
  │   └── PingResultCard
  │       └── AttemptLog
  └── CredentialImportButton

CpsComparisonPage
  ├── Select, Skeleton
  └── ErrorBanner
```

### Service Layer Dependencies

```
api.js
  ├── axiosClient.js (real mode HTTP)
  ├── demoMode.js (isDemoMode check)
  ├── mockData.js (demo data)
  └── mockCpsData.json (demo CPS data)

apiCache.js (standalone — no imports)

Pages → api.js → apiCache.js (via getOrFetch)
      → apiCache.js (direct cache calls)
```

---

## 15. Design Decisions & Patterns

### 1. Backend-as-Proxy (Credential Isolation)
All Anypoint Platform calls go through the Express backend. The browser **never** holds a bearer token — only an HTTP-only session cookie. This prevents XSS-based token theft.

### 2. SQLite Session Store
Using `connect-sqlite3` instead of the default in-memory `MemoryStore` means:
- Sessions survive backend restarts (critical for team use)
- No external Redis/database dependency
- Zero config for development

### 3. SWR Cache Architecture
Rather than using a library (React Query, SWR npm), a custom cache was built to:
- Work with the existing `api.js` facade without wrapping components
- Support proactive background refresh (`keepFresh`) independent of component lifecycle
- Provide `window.__cacheStats()` for dev debugging

### 4. Demo Mode via API Facade
All API calls go through `api.js`, which checks `isDemoMode()` before every call. This pattern means:
- No mock code in components
- Switching between demo/real requires zero component changes
- Mock data is centralized and easily maintained

### 5. 4-Tier CPS Credential Resolution
The tiered fallback (per-BG → per-server → legacy → env vars) handles the real-world complexity where:
- Different Business Groups may have different CPS credentials for the same server
- Backwards-compatible legacy key format still works
- Team-wide credentials can be pre-configured without UI interaction

### 6. CPS Intelligent Retry (Batch Promotion)
When a CPS credential returns 401 or "COULD NOT ACCESS", the system tries all other session credentials in batches of 5, then **promotes** the working credential to priority 1. This means:
- First access to a new CPS project is slow (retries all credentials)
- Subsequent accesses are fast (promoted credential is used directly)
- Works correctly for large credential CSV uploads (70+ entries)

### 7. compositeId Pattern
Each application is identified by `appId|envId|bgId` (the `compositeId`). This is necessary because:
- The same app name can exist in multiple BGs
- App IDs may not be globally unique across BGs
- The composite key ensures uniqueness for row selection, caching, and navigation

### 8. Context Provider Layering
The provider stack (`Toast → Notification → CpsCreds → Creds → Auth`) ensures:
- `AuthContext` can call `showToast()` on login errors
- `CpsCredentialStoreContext` can call `showToast()` on import success
- No circular dependency in the provider hierarchy

### 9. Pure Utility Separation
CPS data parsing (`cpsHelpers.js`) and filter management (`filterUtils.js`) are pure functions extracted from components. This makes them:
- Independently testable
- Reusable across multiple pages (CpsManager, CpsComparison, GlobalCpsManager)
- Free from React lifecycle concerns

### 10. Production Safety UI Pattern
The CPS Manager implements a layered production safety pattern:
1. **Visual warning** — red banner + environment badge
2. **Save button color change** — turns red in production
3. **Diff preview modal** — shows exact before/after values
4. **Explicit confirmation** — requires clicking "Confirm Save"
5. **Delete confirmation** — requires typing the project key (not just clicking)

This prevents accidental production config changes without blocking legitimate updates.

---

*End of Codebase Analysis — MuleSoft Integration Dashboard v1.0*

*Document covers: 2 package manifests, 1 entry point, 1 middleware, 9 route files, 0 controllers, 0 services (both dirs empty — topology feature removed), 6 backend utilities, 1 root component, 10 pages, 28 components, 5 context providers, 7 service files, 8 utility files.*
