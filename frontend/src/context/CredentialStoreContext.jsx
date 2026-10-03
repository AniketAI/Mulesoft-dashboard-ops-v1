import React, { createContext, useContext, useState, useCallback } from 'react';
import { parseCsvToCredentialMap } from '../utils/csvCredentialStore';

const CredentialStoreContext = createContext(null);

/**
 * CredentialStoreProvider
 *
 * Holds a Map<clientId, clientSecret> in React state ONLY.
 * Credentials are NEVER written to localStorage, sessionStorage, or any
 * server — they live purely in browser RAM and are cleared on logout or
 * when the user explicitly clears them.
 *
 * Security model:
 *   - The CSV is parsed client-side; file bytes never leave the browser.
 *   - clientSecrets are not sent to the backend; only the single matched
 *     clientId+secret pair travels over HTTPS at the moment a ping fires.
 *   - On logout, the AuthContext should call clearCredentials() (or the
 *     React tree unmount handles it automatically).
 *
 * CSV parsing is handled by the shared parseCsvToCredentialMap utility
 * (utils/csvCredentialStore.js) so the logic stays in sync with
 * CpsCredentialStoreContext.
 */
export function CredentialStoreProvider({ children }) {
  // Map<string clientId, string clientSecret> — in-memory only
  const [credentialMap, setCredentialMap] = useState(new Map());
  const [loadedCount, setLoadedCount] = useState(0);

  /**
   * Parse a CSV text string and populate the credential map.
   * Returns the number of credential pairs loaded.
   */
  const loadFromCsv = useCallback((text) => {
    const map = parseCsvToCredentialMap(text);
    setCredentialMap(map);
    setLoadedCount(map.size);
    return map.size;
  }, []);

  /** Wipe all credentials from memory immediately. */
  const clearCredentials = useCallback(() => {
    setCredentialMap(new Map());
    setLoadedCount(0);
  }, []);

  /** Look up the secret for a given clientId. Returns null if not found. */
  const getSecret = useCallback(
    (clientId) => credentialMap.get(clientId) ?? null,
    [credentialMap]
  );

  /** Returns true if we have a secret stored for this clientId. */
  const hasCredential = useCallback(
    (clientId) => credentialMap.has(clientId),
    [credentialMap]
  );

  /**
   * Given an array of candidate clientIds (returned by the backend's
   * /auto-credentials endpoint), find the first one whose secret we hold.
   * Returns { clientId, clientSecret } or null.
   */
  const resolveFromCandidates = useCallback(
    (candidates = []) => {
      for (const id of candidates) {
        const secret = credentialMap.get(id);
        if (secret) return { clientId: id, clientSecret: secret };
      }
      return null;
    },
    [credentialMap]
  );

  return (
    <CredentialStoreContext.Provider
      value={{
        loadedCount,
        hasCredentials: loadedCount > 0,
        loadFromCsv,
        clearCredentials,
        getSecret,
        hasCredential,
        resolveFromCandidates,
      }}
    >
      {children}
    </CredentialStoreContext.Provider>
  );
}

export function useCredentialStore() {
  const ctx = useContext(CredentialStoreContext);
  if (!ctx) {
    throw new Error('useCredentialStore must be used within a CredentialStoreProvider');
  }
  return ctx;
}