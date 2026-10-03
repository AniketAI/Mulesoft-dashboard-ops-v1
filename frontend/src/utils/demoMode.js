// ── Demo-mode helpers ─────────────────────────────────────────────────────────
// Extracted from api.js so they can be imported by axiosClient.js without
// creating a circular dependency (api.js → axiosClient.js → api.js).

export const DEMO_MODE_KEY = 'mulesoft_demo_mode';
export const isDemoMode = () => localStorage.getItem(DEMO_MODE_KEY) === 'true';
export const enableDemoMode = () => localStorage.setItem(DEMO_MODE_KEY, 'true');
export const disableDemoMode = () => localStorage.removeItem(DEMO_MODE_KEY);