# MuleSoft Integration Dashboard — Standard Operating Procedure (SOP)

> **Version:** 1.0 | **Last Updated:** September 2026 | **Audience:** MuleSoft Integration Team

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture & Tech Stack](#2-architecture--tech-stack)
3. [First-Time Setup](#3-first-time-setup)
4. [Logging In](#4-logging-in)
5. [Applications Page](#5-applications-page)
6. [Application Detail Page](#6-application-detail-page)
7. [API Manager Page](#7-api-manager-page)
8. [Anypoint Exchange Page](#8-anypoint-exchange-page)
9. [Ping Test Page](#9-ping-test-page)
10. [CPS Property Manager](#10-cps-property-manager)
11. [CPS Compare Page](#11-cps-compare-page)
12. [User Search Page](#12-user-search-page)
13. [Credential Management](#13-credential-management)
14. [Filters & Global Controls](#14-filters--global-controls)
15. [Navigating Between Pages (Deep Links)](#15-navigating-between-pages-deep-links)
16. [Common Workflows (Step-by-Step)](#16-common-workflows-step-by-step)
17. [Troubleshooting](#17-troubleshooting)
18. [Security & Best Practices](#18-security--best-practices)
19. [Backend API Reference](#19-backend-api-reference)

---

## 1. Overview

The **MuleSoft Integration Dashboard** is an internal web application that provides a unified, browser-based interface for managing MuleSoft Anypoint Platform resources across **all Business Groups and Environments** from a single screen.

### What it does

| Capability | Description |
|---|---|
| **Applications** | View, search, filter, start/stop/restart CloudHub 1.0 and 2.0 apps |
| **API Manager** | Browse and inspect API instances and policies |
| **Exchange** | Search and view Exchange assets (APIs, connectors, templates) |
| **Ping Test** | Smoke-test application `/ping` endpoints with auto-credential resolution |
| **CPS Property Manager** | Read, write, delete CPS (Config Property Server) non-secure/secure/binary properties |
| **CPS Compare** | Diff CPS property sets between multiple environments side-by-side |
| **User Search** | Find platform users by name or email across BGs |

---

## 2. Architecture & Tech Stack

```
┌─────────────────────────────────────┐
│           Browser (Vite + React)     │
│  React 18 · React Router v6          │
│  Tailwind CSS · Lucide Icons         │
│  Axios (API calls)                   │
└──────────────────┬──────────────────┘
                   │ HTTP (localhost:5173 → :5000)
┌──────────────────▼──────────────────┐
│        Node.js / Express Backend     │
│  express-session (SQLite store)      │
│  axios → Anypoint Platform REST APIs │
│  Rate limiting · CORS                │
└──────────────────┬──────────────────┘
                   │ HTTPS
         Anypoint Platform API
         (anypoint.mulesoft.com)
```

### Frontend (port 5173)
- **Framework:** React 18 with Vite
- **Routing:** React Router v6 — all routes are under `/` after login
- **Styling:** Tailwind CSS (dark theme, `bg-gray-950` base)
- **State:** React `useState` / `useContext` — no external state library
- **Caching:** In-memory SWR cache (`apiCache.js`) with 3-minute freshness windows

### Backend (port 5000)
- **Runtime:** Node.js + Express
- **Sessions:** SQLite-backed (`./data/sessions.db`) — survives restarts
- **Auth:** Anypoint Platform credentials stored in session (never in client)
- **Body limit:** 1 MB default, 50 MB for `/api/cps` routes

---

## 3. First-Time Setup

### Prerequisites
- Node.js ≥ 18
- npm ≥ 9

### Installation

```bash
# Clone the repository
git clone <repo-url>
cd mulesoft-dashboard

# Install backend dependencies
cd backend && npm install

# Install frontend dependencies
cd ../frontend && npm install
```

### Backend Configuration

```bash
cd backend
cp .env.example .env
```

Edit `backend/.env`:

```env
PORT=5000
SESSION_SECRET=<generate with: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))">
ANYPOINT_PLATFORM_URL=https://anypoint.mulesoft.com

# Optional: pre-configure CPS credentials
CPS_CH1_PROD_CLIENT_ID=
CPS_CH1_PROD_CLIENT_SECRET=
CPS_CH2_PROD_CLIENT_ID=
CPS_CH2_PROD_CLIENT_SECRET=
CPS_CH1_UAT_CLIENT_ID=
CPS_CH1_UAT_CLIENT_SECRET=
CPS_CH2_UAT_CLIENT_ID=
CPS_CH2_UAT_CLIENT_SECRET=
```

> ⚠️ **Never commit `.env` to git.** It contains secrets.

### Starting the Servers

**Terminal 1 — Backend:**
```bash
cd backend
npm run dev       # development (nodemon, auto-restart)
# or
npm start         # production
```

**Terminal 2 — Frontend:**
```bash
cd frontend
npm run dev       # Vite dev server on http://localhost:5173
```

Open `http://localhost:5173` in your browser.

---

## 4. Logging In

Navigate to `http://localhost:5173`. You will be redirected to `/login`.

### Login Methods

| Method | When to use |
|---|---|
| **Username + Password** | Standard Anypoint Platform username/password |
| **Access Token** | You have a valid bearer token (e.g. from CI/CD) |
| **Connected App** | OAuth2 client credentials (Client ID + Secret) |

> 💡 Your credentials are sent to the backend and used to obtain a session token from Anypoint. They are **never stored in the browser**.

After login you land on the **Applications** page.

---

## 5. Applications Page

**Route:** `/applications`

The main dashboard. Shows all deployed Mule applications across all visible Business Groups and Environments.

### Layout

```
[Search] [BG Selector] [Env Selector] [Status Filter] [Type Filter]
                                               [Upload CSV] [Ping] [Export] [Refresh]

┌──────────────────────────────────────────────────────────────────────────────┐
│ ☐  Application       Status   Environment   Type   Mule Ver  Last Modified  Actions │
│ ☐  my-api-v1        RUNNING   Production    CH2    4.6.0     Sep 8, 2026    ▶ 🗄 │
│ ☐  customer-sapi    STOPPED   Sandbox       CH1    4.5.1     Sep 7, 2026   ⏹ ▶ 🗄 │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Filters

| Control | What it does |
|---|---|
| **Search box** | Filter by application name (substring match) |
| **Business Group** | Show apps from one BG or all BGs |
| **Environment** | Filter by specific environment (Production, Sandbox, etc.) |
| **Status** | Filter by RUNNING / STOPPED / FAILED / DEPLOYING etc. |
| **Type** | CloudHub 1.0 or CloudHub 2.0 |

> 💡 Filter selections are **persisted in `localStorage`** and survive page navigation.

### Actions Per Row

| Icon | Action |
|---|---|
| ▶ Start | Start a stopped application |
| ⏹ Stop | Stop a running application |
| 🔄 Restart | Restart a running application |
| 🗄 CPS Manager | Navigate to CPS Manager with this app pre-selected |
| ↗ Open in Anypoint | Opens app in Anypoint Platform (copies app name to clipboard) |

> ⚠️ Stop and restart actions show a **confirmation modal** before executing.

### Bulk Operations

1. **Select rows** using the checkboxes (left column) or the header checkbox to select all visible
2. Selected rows float to the top
3. Bulk action buttons appear in the top toolbar: **Start All / Stop All / Restart All**
4. **Bulk Ping** button tests all selected apps (or all visible if none selected)
5. **Export CPS** exports CPS properties for all selected apps to Excel

### CSV Upload (Bulk Select by Name)

1. Click **Upload CSV**
2. Upload a CSV file with app names in a column (supported headers: `appname`, `name`, `domain`, `application` — or just the first column)
3. Matching apps are automatically selected
4. Use **Exact / ~** toggle for exact vs fuzzy matching
5. Filter by environment using the **env dropdown** in the banner

### Sorting

Click any column header to sort ascending/descending:
- Application name, Status, Environment, Type, Mule Version, Last Modified

### Refreshing

Click **Refresh** (top right) to force a fresh API fetch, bypassing the 3-minute SWR cache.

---

## 6. Application Detail Page

**Route:** `/applications/:orgId/:envId/:appId`

Click any application row to open the detail view.

### Sections

| Section | Content |
|---|---|
| **Hero Header** | App name, status badge, deployment type, environment, Mule version |
| **Actions** | Start / Stop / Restart / Open in Anypoint / CPS Manager |
| **Properties** | All deployment properties (ARM properties) |
| **Runtime Info** | Replica count, worker size, runtime version |
| **URLs** | Ingress URL(s) for CloudHub 2.0 apps |

### CPS Manager Button

In the hero header, the **CPS Manager** button navigates directly to CPS Manager with the BG, Environment, and Application **pre-selected**.

---

## 7. API Manager Page

**Route:** `/api-manager`

Displays API instances registered in Anypoint API Manager.

### Features
- Filter by Business Group and Environment
- View API instance name, version, status, and applied policies
- Click any row to see full API instance details
- Copy API instance ID

---

## 8. Anypoint Exchange Page

**Route:** `/exchange`

Search and browse assets published to Anypoint Exchange.

### Features
- Full-text search across all asset types
- Filter by asset type (RAML, OAS, connector, template, example, etc.)
- View asset details, version history, and documentation
- Copy asset coordinates (groupId, assetId, version)

---

## 9. Ping Test Page

**Route:** `/ping-test`

Tests application health endpoints. Supports both manual testing and bulk testing initiated from the Applications page.

### How Ping Works

For each app, the backend tries these paths in order:
1. `/api/v1/ping`
2. `/api/v2/ping`
3. `/api/ping`
4. `/ping`

### Status Codes

| Status | Meaning |
|---|---|
| **SUCCESS** (green) | 2xx response |
| **PARTIAL** (yellow) | Response received but with 4xx/5xx status |
| **FAILED** (red) | Connection error or timeout |
| **SKIPPED_CONTRACT_PENDING** | OAuth contract awaiting approval |

### Auto-Credential Resolution

If a **Credentials CSV** has been imported (see §13), the Ping page automatically resolves `client_id` / `client_secret` pairs for each app by:
1. Looking up the app's `api.id` from CPS properties (Layer 1)
2. Matching against API Manager instances (Layer 2)
3. Fuzzy name matching (Layers 3–5)

### Manual Credentials

You can override auto-resolved credentials by entering `client_id` and `client_secret` in the form.

---

## 10. CPS Property Manager

**Route:** `/cps-manager`

The most powerful feature of the dashboard — a full CRUD interface for CPS (Configuration Property Server) properties.

### What is CPS?

CPS is an internal config server that stores properties for Mule applications (database URLs, credentials, feature flags, etc.) separate from the deployment config. Apps fetch their config at startup via CPS REST APIs.

### Selector Panel (BG → Environment → Application)

1. **Business Group** — select a specific BG or "All Business Groups"
2. **Environment** — filtered by the selected BG
3. **Application** — filtered by the selected environment; selecting an app auto-fills the CPS connection fields from the app's ARM deployment properties

> 💡 When navigating from the Applications page via the 🗄 icon, all three dropdowns are **automatically pre-selected**.

### CPS Connection Fields

After selecting an app (or manually):

| Field | Description |
|---|---|
| **CPS Base URL** | The CPS server hostname (e.g. `https://cps.example.net`) |
| **CPS Env** | CPS environment name (e.g. `prod`, `uat`) |
| **Project Key** | The CPS project/key name (e.g. `my-api-name`) |

Click **+ save preset** to save a CPS Base URL for quick reuse (up to 5 presets stored in localStorage).

### Property Tabs

| Tab | Content |
|---|---|
| **Non-Secure** | Plain-text properties (most common). Inline editable table. |
| **Secure** | Encrypted property groups. Each group has its own editor. |
| **Binaries** | Binary file uploads (certificates, keystores) |
| **🔐 Access Control** | Manage OAuth2 credentials per project key |

### Non-Secure Properties — Operations

| Operation | How |
|---|---|
| **View** | Load Properties button → inline table |
| **Edit** | Click any value cell to edit in-place; press Enter or click away to commit |
| **Add** | Use the bottom row (new key + value → Add button) |
| **Bulk Add** | Click **Bulk Add** → paste `key=value` lines or JSON |
| **Delete** | Hover over a row → trash icon → row marked DEL (pending) |
| **Save** | Click **Save (N changes)** → diff preview modal → Confirm |
| **Discard** | Click **Discard** to revert all pending changes |
| **Undo** | Click **↩ Undo (N)** or press `Ctrl+Z` to undo last N changes |
| **Search** | Search box filters visible rows by key or value |
| **Find & Replace** | Click **Find & Replace** → search in values → Replace All |
| **Export** | Click **Export** → downloads `cps-{key}-{env}-{date}.csv` |
| **Import** | Click **Import** → upload CSV to batch-add/overwrite properties |
| **Copy as…** | Export all properties as JSON / .properties / YAML / Env vars |

### Change Indicators

| Color | Meaning |
|---|---|
| Green left border + **NEW** badge | Newly added property (unsaved) |
| Blue left border + **MOD** badge | Modified property (unsaved) |
| Red opacity + **DEL** badge | Marked for deletion (unsaved) |

### Value Type Icons

The table automatically identifies value types:
- ⚡ `${placeholder}` — placeholder reference
- 🌐 URL
- 🔑 UUID
- ✅/❌ Boolean
- 🔢 Number
- 📋 JSON object/array

### Auto-Draft Save

Pending changes are **automatically saved to `localStorage`** as a draft. If you navigate away and return, a **"📝 Unsaved draft found"** banner appears with a **Restore Draft** option.

### Production Safety

If the selected environment is marked as Production, a **⚠️ PRODUCTION** banner appears and the Save button turns **red**. The save diff modal also warns "⚠ PRODUCTION" and requires explicit confirmation.

### Secure Properties

Secure property groups are listed under the **Secure** tab. Each group:
- Shows all key-value pairs (if credentials allow)
- Supports inline editing with Save/Discard per group
- Shows **⚠ Access Denied** if credentials lack access (but still allows write)
- Has **Auth** button to manage OAuth2 access for that group
- Has **Delete Group** button (requires typing the group key in Production)

### Binary Properties

Upload binary files (JKS keystores, PEM certs, etc.) under the **Binaries** tab. Existing binary keys are listed from the `cps.secure.binaries` non-secure property.

### Access Control Tab

The **🔐 Access Control** tab lists all project keys (non-secure + all secure groups) and lets you manage OAuth2 client credentials per key. Use the search bar to find a specific project key.

### Session Change Log

At the bottom of the page, a collapsible **📋 Session Change Log** records every save action performed in the current session (timestamp, key, env, change count, success/fail).

### Request / Response Panel

After every CPS write operation a collapsible **Request / Response** panel appears showing the exact HTTP request sent and the raw response received — useful for debugging.

---

## 11. CPS Compare Page

**Route:** `/cps-compare`

Compare CPS property sets side-by-side across multiple environments for the same application.

### How to Use

1. Select a Business Group
2. Select an Application
3. Add 2–4 environments to compare
4. Click **Compare** — properties are fetched for each environment
5. Differences are highlighted:
   - 🟡 Value differs between environments
   - 🔴 Key missing in one or more environments
   - ⚪ Key exists and matches in all environments
6. Click **Export** to download the comparison as an Excel file

### Typical Use Case

Before a UAT → Production release:
- Compare `UAT` vs `Production` CPS properties
- Identify missing keys or incorrect values in Production
- Fix in CPS Manager before deploying

---

## 12. User Search Page

**Route:** `/user-search`

Search for Anypoint Platform users by name or email.

### Features
- Search across the root organization and all sub-Business Groups
- View user details: name, email, role, BG membership
- Copy user ID or email

---

## 13. Credential Management

The dashboard uses two types of in-memory credential stores. Both are **session-local** — they are never sent to the backend and are cleared when you close the tab.

### 13.1 Ping Credentials CSV

Used for auto-resolving `client_id` / `client_secret` when pinging applications.

**Format:**
```csv
clientId,clientSecret
abc123,secret456
def789,secret012
```

**How to import:**
1. Go to **Applications** page or **Ping Test** page
2. Click **Import Credentials** (shield icon in the header)
3. Upload the CSV
4. A green banner confirms "N credential pairs loaded"

### 13.2 CPS Credentials CSV

Used for authenticating with CPS servers that require OAuth2.

**Format:**
```csv
clientId,clientSecret
cps-client-id,cps-secret
```

**How to import:**
1. Go to **CPS Manager**
2. Click **Import CSV** (top right, next to "CPS Credentials")
3. Upload the CSV
4. Green "CPS creds auto-resolved" badge appears when an app's credentials are matched

### 13.3 CPS Credentials Modal

Click **CPS Credentials** button (top right of CPS Manager) to manually enter a `clientId` + `clientSecret` for a specific CPS base URL. This is persisted in the backend session for the duration of your login.

### 13.4 Backend `.env` Pre-configuration

For environments shared by the whole team, add CPS credentials to `backend/.env`:

```env
CPS_CH2_PROD_CLIENT_ID=your-client-id
CPS_CH2_PROD_CLIENT_SECRET=your-secret
```

These are loaded at server start and available to all users without manual import.

---

## 14. Filters & Global Controls

### BG Filter Modal

The **BG Filter** (accessible from the sidebar or filter icon) lets you restrict which Business Groups are visible across all pages. Hidden BGs are excluded from fan-out API calls, improving performance.

### Env Filter Modal

The **Env Filter** hides specific environments globally (e.g. hide all Sandbox environments to focus on Production).

Both filters persist in `localStorage` and survive page refreshes.

### Sidebar Navigation

| Link | Page |
|---|---|
| Applications | `/applications` |
| API Manager | `/api-manager` |
| Exchange | `/exchange` |
| Ping Test | `/ping-test` |
| CPS Compare | `/cps-compare` |
| CPS Manager | `/cps-manager` |
| User Search | `/user-search` |

---

## 15. Navigating Between Pages (Deep Links)

### Applications → CPS Manager

Every application row in the Applications page has a 🗄 **Database icon** in the Actions column.

Clicking it navigates to `/cps-manager` and **automatically pre-selects**:
- Business Group (from the app's BG)
- Environment (from the app's environment)
- Application (the exact app)

The CPS connection fields (Base URL, Env, Project Key) are then auto-filled from the app's ARM deployment properties.

### Application Detail → CPS Manager

The **CPS Manager** button in the Application Detail page hero header does the same.

### CPS Manager → Application Detail

When an app is selected in CPS Manager, a small **"Open {app} in Application Details"** link appears below the Application dropdown. Click it to jump to the detail page.

---

## 16. Common Workflows (Step-by-Step)

### 16.1 View All Running Applications

1. Go to **Applications** (`/applications`)
2. Set Status filter to **Running**
3. Set BG to **All Organizations** (default)
4. All running apps across all BGs and environments appear

---

### 16.2 Stop a Specific Application

1. Find the app (use Search or filters)
2. Click the **⏹ Stop** icon in the Actions column
3. Confirm in the modal
4. The row status updates to **STOPPING** → **STOPPED**

---

### 16.3 Bulk Restart All Failed Applications

1. Go to **Applications**
2. Set Status filter to **Failed**
3. Click the header checkbox to select all filtered apps
4. Click **Restart** in the bulk toolbar
5. Confirm in the bulk modal
6. Monitor the result list (✓ Done / ✗ Failed per app)

---

### 16.4 Update a CPS Property (Production)

> ⚠️ Always compare with UAT first (see 16.5)

1. Go to **Applications**
2. Find the production app → click 🗄 (CPS Manager icon)
3. CPS Manager opens with app pre-selected and ⚠️ PRODUCTION banner shown
4. Click **Load Properties**
5. Click the value you want to edit → type new value → press Enter
6. Value shows blue **MOD** indicator
7. Click **Save (1 change)** → review the diff (old value → new value) → click **Confirm Save**
8. Verify the change in the table

---

### 16.5 Compare CPS Properties Before a Release

1. Go to **CPS Compare** (`/cps-compare`)
2. Select the Business Group and Application
3. Add **UAT** and **Production** to the comparison slots
4. Click **Compare**
5. Review highlighted differences
6. For each missing or different key in Production:
   - Click 🗄 on the Production app (from Applications page) to open CPS Manager
   - Add/update the property
7. Re-run the compare to confirm everything matches

---

### 16.6 Ping Test All Production Apps

1. Go to **Applications**
2. Set Environment filter to **Production**
3. Ensure no rows are selected (or select specific apps)
4. Click **Ping Test** → **Bulk Ping Modal** opens
5. If credentials CSV is loaded, auto-resolution runs automatically
6. Click **Run All Pings**
7. Monitor results in real-time (batches of 10)
8. When complete, you are redirected to **Ping Test** results page
9. Green = healthy, Yellow = auth issue, Red = down

---

### 16.7 Add a New CPS Property to Multiple Environments

1. Go to **CPS Manager**
2. Select the app in **UAT** environment first
3. Load Properties → click **Add** row → enter key and value → click Add
4. Save → confirm in diff modal
5. Change Environment dropdown to **Production**
6. App re-selects automatically
7. Load Properties → Add the same key → Save

---

### 16.8 Export CPS Properties for Audit

1. Go to **CPS Manager**
2. Select the app and load properties
3. Click **Export** → CSV downloads with all non-secure properties
4. Or use **Copy as… → JSON** to copy to clipboard

For a bulk export across many apps:
1. Go to **Applications**
2. Select the apps you want (or all via header checkbox)
3. Click **Export CPS** → Excel file downloads with one sheet per app

---

### 16.9 Import Bulk Properties from a Config File

1. Go to **CPS Manager**
2. Select the app and load properties
3. Click **Import** → Upload a CSV (columns: `key`, `value`)
4. Preview shows N properties to be added/updated
5. Confirm → properties added as pending changes
6. Review in the table → Save

---

### 16.10 Find a User's Anypoint Account

1. Go to **User Search** (`/user-search`)
2. Type name or email in the search box
3. Results show all matching users across BGs with their roles

---

## 17. Troubleshooting

### "No applications found"

| Cause | Fix |
|---|---|
| BG filter hiding BGs | Open BG Filter modal → show all BGs |
| Wrong BG selected | Change BG selector to "All Organizations" |
| Session expired | Refresh the page — you'll be redirected to login |

### "Failed to load CPS properties"

| Cause | Fix |
|---|---|
| CPS credentials not set | Import CPS credentials CSV or enter via CPS Credentials modal |
| CPS server unreachable | Check VPN / network access to the CPS base URL |
| Wrong CPS Base URL | Verify the URL extracted from the app's ARM properties |
| Wrong CPS Env | Check `cps.prefix` or `cps.environment` in the app's deployment properties |

### CPS Manager dropdowns not auto-selecting

This was a known issue (fixed in commit `e0d8695`). If it recurs:
1. Hard refresh the page (`Ctrl+Shift+R`)
2. Manually select BG → Environment → Application

### "Ping PARTIAL / FAILED"

| Cause | Fix |
|---|---|
| Wrong credentials | Import/update the Credentials CSV |
| App not running | Check Status on Applications page |
| VPN not connected | Connect to the appropriate VPN for the environment |
| API contract pending | Approve the contract in API Manager |

### Session Lost After Backend Restart

Sessions are stored in SQLite (`backend/data/sessions.db`). They survive restarts. If sessions are lost:
1. Check the `data/` directory exists
2. Verify the `SESSION_SECRET` in `.env` has not changed (changing it invalidates all sessions)

### Backend Returns 401 / 403

Your Anypoint session has expired. Click anywhere in the app — you'll be redirected to the login page automatically.

### Properties Show "⚠ Placeholder key not found"

A property value references `${some.key}` but that key doesn't exist in the same property set. This is a validation warning only — not an error. Add the missing key or fix the reference.

---

## 18. Security & Best Practices

### ✅ Do

- Set a strong `SESSION_SECRET` in production (64 random hex chars minimum)
- Use HTTPS in production (configure nginx/load balancer in front of the Express server)
- Rotate CPS credentials regularly and update the `.env` accordingly
- Use the **CPS Compare** page before every Production deployment to catch config drift
- Import CPS credentials via CSV (in-memory only) — never paste them into properties
- Review the **diff modal** carefully before saving Production properties

### ❌ Don't

- Don't commit `.env` to git
- Don't share your Anypoint login credentials — each team member logs in individually
- Don't run `npm start` in production with `NODE_ENV` unset (rate limiting is only enforced in production)
- Don't edit Production CPS properties without first verifying on UAT
- Don't close the tab mid-save — use the **Discard** button if you need to abort

### Production Deployment Checklist

Before modifying Production CPS properties:

- [ ] Compare UAT vs Production (CPS Compare page)
- [ ] Identify all differences
- [ ] Test the change in UAT first
- [ ] Get approval from a second team member (four-eyes principle)
- [ ] Save the change in Production (you'll see the red ⚠️ PRODUCTION banner)
- [ ] Confirm in the diff modal
- [ ] Verify the app behaves correctly after config update

---

## 19. Backend API Reference

The frontend communicates exclusively with the backend. The backend proxies requests to Anypoint Platform.

### Auth Routes (`/api/auth`)

| Endpoint | Method | Description |
|---|---|---|
| `/api/auth/login` | POST | Login with username/password |
| `/api/auth/token-login` | POST | Login with bearer token |
| `/api/auth/connected-app-login` | POST | Login with Connected App credentials |
| `/api/auth/logout` | POST | Logout and destroy session |
| `/api/auth/me` | GET | Get current user info |

### Organizations (`/api/organizations`)

| Endpoint | Method | Description |
|---|---|---|
| `/api/organizations/business-groups` | GET | Get all Business Groups |

### Environments (`/api/environments`)

| Endpoint | Method | Description |
|---|---|---|
| `/api/environments/:orgId` | GET | Get environments for a BG |

### Applications (`/api/applications`)

| Endpoint | Method | Description |
|---|---|---|
| `/api/applications/summary/:orgId` | GET | List all apps in a BG |
| `/api/applications/cloudhub2/:orgId/:envId/:appId` | GET | Get CH2 app details |
| `/api/applications/cloudhub1/:envId/:appId` | GET | Get CH1 app details |
| `/api/applications/cloudhub2/:orgId/:envId/:appId/action` | POST | Start/stop/restart CH2 app |
| `/api/applications/cloudhub1/:envId/:appId/action` | POST | Start/stop/restart CH1 app |

### APIs (`/api/apis`)

| Endpoint | Method | Description |
|---|---|---|
| `/api/apis/:orgId/:envId` | GET | List API instances |

### Exchange (`/api/exchange`)

| Endpoint | Method | Description |
|---|---|---|
| `/api/exchange/search` | GET | Search Exchange assets |

### CPS (`/api/cps`)

| Endpoint | Method | Description |
|---|---|---|
| `/api/cps/fetch` | GET | Fetch CPS properties (non-secure or secure) |
| `/api/cps/write` | POST | Write CPS properties (PUT) |
| `/api/cps/project` | DELETE | Delete a CPS project |
| `/api/cps/credentials` | POST | Store CPS OAuth2 credentials in session |
| `/api/cps/auth` | GET/POST/DELETE | Manage CPS access control |

### Health (`/api/health`)

| Endpoint | Method | Description |
|---|---|---|
| `/api/health/ping` | POST | Ping an application endpoint |
| `/api/health/auto-credentials` | POST | Auto-resolve credentials for an app |
| `/api/health/auto-contract-creds` | POST | Fetch contract credentials from API Manager |
| `/api/health/oauth2-token` | POST | Obtain OAuth2 token for JWT ping |

### Metrics (`/api/metrics`)

| Endpoint | Method | Description |
|---|---|---|
| `/api/metrics/:orgId/:envId/:appId` | GET | Get application metrics |

---

## Appendix A — Keyboard Shortcuts

| Shortcut | Context | Action |
|---|---|---|
| `Ctrl+Z` | CPS Manager (non-secure table) | Undo last property change |
| `Enter` | CPS property edit cell | Commit edit and move to next |
| `Escape` | CPS property edit cell | Cancel edit |
| `Enter` | Add new property row | Add the property |

---

## Appendix B — Glossary

| Term | Definition |
|---|---|
| **BG** | Business Group — an organizational unit in Anypoint Platform |
| **CH1** | CloudHub 1.0 — legacy MuleSoft hosting platform |
| **CH2** | CloudHub 2.0 — current MuleSoft container-based hosting |
| **CPS** | Config Property Server — internal service storing app properties |
| **ARM** | Anypoint Runtime Manager — the deployment management API |
| **SWR** | Stale-While-Revalidate — caching strategy that shows cached data immediately while refreshing in background |
| **compositeId** | Internal app identifier: `appId|envId|bgId` used to uniquely identify an app across BGs |
| **Non-Secure** | CPS properties stored in plain text (readable by anyone with CPS access) |
| **Secure** | CPS properties stored encrypted (require OAuth2 credentials to read) |
| **Project Key** | The CPS identifier for an application's property set |
| **Session** | Server-side login state stored in SQLite � valid for 24 hours |
| **SWR Cache** | Frontend in-memory cache; entries expire after 3 minutes and refreshed in background |

---

*End of SOP � MuleSoft Integration Dashboard v1.0*
