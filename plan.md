# Feature Implementation Plan: Auto-Discovered Dependency Tree

**Context for AI:**
I have an **existing, fully functional MuleSoft Operations Dashboard** built with:
- **Frontend:** React + Tailwind CSS + JavaScript
- **Backend:** Node.js + Express.js
- **Already Implemented:**
  1. Anypoint AMC API integration across 10 Business Groups and 40 environments (app deployment status, CH1/CH2 metrics, and environment dropdown selectors).
  2. CPS (Custom Properties System) REST API services on the backend using Client Credentials (`/api/v2/non-secure`, `/api/v2/secure`, `/api/v2/binaries`).

**Goal:**
Add a **new feature** to the existing dashboard: an **Auto-Discovered Dependency Tree (DAG)** showing how Experience, Process, and System APIs connect to one another and external systems. 

**STRICT DIRECTIVES:**
- **Do not rewrite or modify existing working features** (AMC status polling, CPS proxy endpoints, existing navigation, or styling).
- **Inspect and reuse** my existing CPS backend services to fetch non-secure properties. Do not build redundant fetchers.
- This is an **additive feature**: create new dedicated modules/routes/components and cleanly mount them into the existing dashboard.

---

### Step 1: Codebase Audit & Discovery
1. **Locate Existing CPS Services:**
   - Find the existing backend service/controller that fetches `/api/v2/non-secure` properties for an app and environment.
   - Verify its method signature and export it if needed so our new topology builder can call it.
2. **Locate Existing State & Routing:**
   - Identify where the current `businessGroupId` and `environmentId` state lives in the React app (context, Zustand, or props) so the new Dependency Tree component can inherit the selected environment seamlessly.

---

### Step 2: Backend — Endpoint Extraction & Redis Caching
*Target Directory: `backend/services/topology/` (or matching project structure)*

1. **`regexSweeper.js`:**
   - Create a helper that inspects the JSON returned by the existing CPS service.
   - Extract internal CloudHub/Mule URLs (`*.cloudhub.io`, internal host patterns) and external service domains (`api.stripe.com`, `*.salesforce.com`, etc.).
2. **`topologyCache.js` (Redis Integration):**
   - Connect using `ioredis`.
   - Store app host associations in Redis sets: `cps:hosts:{env}:{app}`.
   - Store the compiled graph in `topology:graph:{env}`.
   - Use `p-limit` (max 20–25 concurrent calls) when querying the existing CPS service across multiple apps during a sweep.

---

### Step 3: Backend — Server-Side Graph Layout (`elkjs`)
1. **Install:** `npm install elkjs`
2. **`graphBuilder.js`:**
   - Read the discovered nodes and dependency edges for the selected environment.
   - Tag nodes as:
     - `internal`: Matches a deployed Mule application name.
     - `external`: 3rd-party services (Salesforce, Stripe, SAP, DBs).
   - Run `elkjs` layout on the server with:
     ```javascript
     {
       'elk.algorithm': 'layered',
       'elk.direction': 'RIGHT',
       'elk.layered.spacing.nodeNodeBetweenLayers': '160',
       'elk.spacing.nodeNode': '80'
     }
     ```
   - Transform output into standard `@xyflow/react` format (`nodes` with fixed `{ x, y }` coordinates, and `edges`).
   - Save the final JSON into Redis `topology:graph:{env}`.

---

### Step 4: Backend — New API Routes
*Target File: `backend/routes/topologyRoutes.js`*

1. **`GET /api/topology/:envId`**
   - Checks Redis for `topology:graph:{envId}`.
   - If present: return immediately (`< 20ms`).
   - If cache miss: trigger layout build, cache result, and return.
2. **`POST /api/topology/:envId/sync`**
   - Forces a fresh sweep of CPS properties and recalculates the layout.
3. **Mount the Route:**
   - Register the router in `app.js` / `server.js` under `/api/topology` without touching other existing API routes.

---

### Step 5: Frontend — Dependency Tree Canvas (`@xyflow/react`)
*Target Directory: `frontend/src/components/topology/`*

1. **Install:** `npm install @xyflow/react`
2. **Custom Tailwind Node Components:**
   - `ApiNode.jsx`: Frosted glass dark-mode card. Displays API tier badge (Experience = Purple, Process = Blue, System = Emerald), app name, and a live health indicator dot.
   - `ExternalNode.jsx`: Dashed border pill for 3rd-party dependencies.
3. **`DependencyTree.jsx` (Core View):**
   - Mount `<ReactFlow>` with `onlyRenderVisibleElements={true}` for DOM virtualization.
   - Use the pre-computed coordinates directly from `GET /api/topology/:envId`.
   - Add a top control bar displaying:
     - "Last Synced" timestamp badge.
     - "Refresh Topology" button (triggers `POST /api/topology/:envId/sync`).

---

### Step 6: Frontend — Telemetry Overlay & Interactivity
1. **Non-Intrusive Health Updates:**
   - Pull app status (`STARTED`, `FAILED`, `STOPPED`) from your existing AMC state or polling hook.
   - Update the glowing dot on `ApiNode.jsx` dynamically without re-rendering or moving the graph canvas.
2. **Blast Radius / Impact Highlighter:**
   - On node hover or click, dim unconnected nodes (`opacity-25`) and highlight all upstream callers and downstream targets with glowing edge paths.
3. **Node Click Context Integration:**
   - When a node is clicked, trigger your existing app properties drawer/modal to show its CPS properties and AMC health metrics.

---

### Step 7: UI Navigation Integration
- Add a new view toggle (e.g., Tab switcher: **"Grid View"** vs. **"Dependency Map"**) alongside your existing environment dropdowns.
- Ensure switching environments updates both the current view and the Dependency Tree seamlessly.