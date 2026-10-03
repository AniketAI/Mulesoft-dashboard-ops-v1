/**
 * Frontend in-memory API response cache.
 *
 * Lives in module scope — survives React component unmount/remount but
 * is cleared on browser refresh (intentional — ensures data freshness
 * after a full page reload).
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  FRESH_MS  (3 min)  — entry is fresh; no network call needed        │
 * │  STALE_MS  (20 min) — entry is stale-but-usable; trigger bg refetch │
 * │  > STALE_MS         — entry is evicted on next read                 │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * Per-key TTL: setCached(key, data, staleMs) lets callers store
 *   slow-changing data (BGs: 30 min) vs fast-changing data (apps: 3 min)
 *   with different eviction windows.
 */

const STALE_MS   = 20 * 60 * 1000;   // default eviction window  (20 min)
const FRESH_MS   =  3 * 60 * 1000;   // SWR freshness threshold   (3 min)
const MAX_ENTRIES = 300;              // LRU-style hard cap

const cache    = new Map();   // key → { data, ts, staleMs }
const inflight = new Map();   // key → Promise<data>  (request deduplication)

// ── Internal helpers ─────────────────────────────────────────────────────────

function _isExpired(entry) {
  return Date.now() - entry.ts > (entry.staleMs ?? STALE_MS);
}

function _isStale(entry) {
  return Date.now() - entry.ts > FRESH_MS;
}

/** Evict one expired entry or, if all fresh, the oldest entry (LRU). */
function _evictOne() {
  for (const [k, v] of cache.entries()) {
    if (_isExpired(v)) { cache.delete(k); return; }
  }
  // All entries are fresh — evict the oldest (Map preserves insertion order)
  const firstKey = cache.keys().next().value;
  if (firstKey !== undefined) cache.delete(firstKey);
}

// ── Core read / write ────────────────────────────────────────────────────────

/**
 * Return cached value if within eviction window, otherwise null.
 * Backward-compatible drop-in for the original getCached.
 */
export function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (_isExpired(entry)) { cache.delete(key); return null; }
  return entry.data;
}

/**
 * Stale-While-Revalidate read.
 * Returns { data, stale } if the entry exists within the eviction window.
 * Returns null on miss or eviction.
 *
 *  stale=false → data is fresh  (< FRESH_MS old)  — no network call needed
 *  stale=true  → data is usable (< STALE_MS old) — caller should trigger
 *                a silent background refetch without blocking the UI
 */
export function getCachedSWR(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (_isExpired(entry)) { cache.delete(key); return null; }
  return { data: entry.data, stale: _isStale(entry) };
}

/**
 * Store a value in the cache.
 * @param {string} key
 * @param {*}      data
 * @param {number} [staleMs]  Custom eviction window (ms). Defaults to STALE_MS (20 min).
 */
export function setCached(key, data, staleMs = STALE_MS) {
  if (cache.size >= MAX_ENTRIES) _evictOne();
  cache.set(key, { data, ts: Date.now(), staleMs });
}

// ── Inflight deduplication + SWR combo ───────────────────────────────────────

/**
 * Get-or-fetch with inflight deduplication and stale-while-revalidate.
 *
 * - Fresh hit  → returns data instantly, no network
 * - Stale hit  → returns stale data instantly AND kicks off fetchFn in background
 * - Cache miss → deduplicates concurrent requests; all waiters share one HTTP call
 *
 * @param {string}   key
 * @param {Function} fetchFn   () => Promise<data>
 * @param {number}   [staleMs] Custom eviction window passed to setCached
 * @returns {Promise<data>}
 */
export async function getOrFetch(key, fetchFn, staleMs = STALE_MS) {
  const swr = getCachedSWR(key);

  // Fresh — no network at all
  if (swr && !swr.stale) return swr.data;

  // Start a fetch if one isn't already in-flight
  if (!inflight.has(key)) {
    const promise = fetchFn()
      .then(data  => { setCached(key, data, staleMs); inflight.delete(key); return data; })
      .catch(err  => { inflight.delete(key); throw err; });
    inflight.set(key, promise);
  }

  // Stale hit → return stale data immediately; background promise updates cache
  if (swr?.stale) return swr.data;

  // True miss → await the single in-flight promise
  return inflight.get(key);
}

// ── Cache invalidation ───────────────────────────────────────────────────────

/** Remove all cache entries whose key starts with a given prefix. */
export function bustCache(keyPrefix) {
  for (const k of cache.keys()) {
    if (k.startsWith(keyPrefix)) cache.delete(k);
  }
}

/** Clear the entire cache, in-flight requests, and keep-fresh registry (e.g., on logout). */
export function clearCache() {
  cache.clear();
  inflight.clear();
  keepFreshRegistry.clear();
}

// ── Proactive keep-fresh registry ────────────────────────────────────────────
// Pages can register a fetchFn for a cache key so the background sweep
// automatically re-fetches stale entries — even when nobody navigates to the
// page. This ensures cache is NEVER cold for actively-monitored data.
//
// Usage:
//   keepFresh(key, async () => { const d = await fetchData(); setApps(d); return d; });
//   stopKeepingFresh(key);  // call in useEffect cleanup

const keepFreshRegistry = new Map(); // key → fetchFn

/**
 * Register a function that keeps a cache entry fresh in the background.
 * The fetchFn is called whenever the sweep finds the entry is stale.
 * If the entry no longer exists (expired), keepFresh is a no-op until the
 * entry is re-populated (e.g., on next navigation).
 *
 * @param {string}   key      Cache key to watch
 * @param {Function} fetchFn  async () => data  (called when entry goes stale)
 */
export function keepFresh(key, fetchFn) {
  keepFreshRegistry.set(key, fetchFn);
}

/**
 * Stop proactive background refresh for a key (call in useEffect cleanup).
 * @param {string} key
 */
export function stopKeepingFresh(key) {
  keepFreshRegistry.delete(key);
}

// ── Background TTL sweep + proactive refresh (requestIdleCallback) ────────────
// Two jobs per tick:
//   1. Evict expired entries so memory is bounded.
//   2. Proactively refresh any registered stale entries before they expire —
//      so the next navigation always gets an instant cache hit.
// Uses requestIdleCallback so it never competes with rendering or input.

function _scheduleSweep() {
  const sweep = () => {
    const now = Date.now();

    // Job 1 — evict expired entries
    for (const [k, v] of cache.entries()) {
      if (now - v.ts > (v.staleMs ?? STALE_MS)) cache.delete(k);
    }

    // Job 2 — proactively refresh stale registered entries
    for (const [key, fetchFn] of keepFreshRegistry.entries()) {
      const entry = cache.get(key);
      // Only refresh if the entry exists and is stale but NOT yet expired,
      // and there is no in-flight request for this key already running.
      if (entry && _isStale(entry) && !_isExpired(entry) && !inflight.has(key)) {
        const p = fetchFn()
          .then(data => {
            // fetchFn may return undefined if it only updates React state;
            // only store in cache when a value is returned.
            if (data !== undefined) setCached(key, data, entry.staleMs);
            inflight.delete(key);
          })
          .catch(() => { inflight.delete(key); });
        inflight.set(key, p);
      }
    }

    _scheduleSweep();
  };

  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(sweep, { timeout: 3 * 60 * 1000 }); // fire within 3 min
  } else {
    setTimeout(sweep, 3 * 60 * 1000);   // fallback for Safari < 16
  }
}

_scheduleSweep();

// ── Dev diagnostics ──────────────────────────────────────────────────────────
// Open browser console → window.__cacheStats() to inspect hit/miss ratios.
if (import.meta.env.DEV) {
  window.__cacheStats = () => {
    const entries = [...cache.entries()].map(([k, v]) => ({
      key: k,
      ageMs: Date.now() - v.ts,
      staleMs: v.staleMs ?? STALE_MS,
      stale: _isStale(v),
      expired: _isExpired(v),
    }));
    return { size: cache.size, inflight: inflight.size, entries };
  };
}