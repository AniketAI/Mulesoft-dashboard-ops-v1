import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { parseCsvToCredentialMap } from '../utils/csvCredentialStore';
import { parseGlobalCpsCsv } from '../utils/globalCpsCsvParser';

const GLOBAL_CREDS_KEY = 'mule_dashboard_global_cps_creds';

const CpsCredentialStoreContext = createContext(null);

export function CpsCredentialStoreProvider({ children }) {
  const [credentialMap, setCredentialMap] = useState(new Map());
  const [loadedCount, setLoadedCount] = useState(0);

  // Global CPS specific state — persisted to localStorage so credentials survive page refreshes
  const [globalCredentials, setGlobalCredentials] = useState(() => {
    try {
      const raw = localStorage.getItem(GLOBAL_CREDS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  // Persist to localStorage whenever globalCredentials changes
  useEffect(() => {
    try {
      localStorage.setItem(GLOBAL_CREDS_KEY, JSON.stringify(globalCredentials));
    } catch {
      // ignore quota errors
    }
  }, [globalCredentials]);

  const loadFromCsv = useCallback((text) => {
    const map = parseCsvToCredentialMap(text);
    setCredentialMap(map);
    setLoadedCount(map.size);
    return map.size;
  }, []);

  const loadGlobalFromCsv = useCallback((text) => {
    const parsed = parseGlobalCpsCsv(text);
    setGlobalCredentials(parsed);
    return parsed.length;
  }, []);

  const clearCredentials = useCallback(() => {
    setCredentialMap(new Map());
    setLoadedCount(0);
    setGlobalCredentials([]);
    try { localStorage.removeItem(GLOBAL_CREDS_KEY); } catch { /* ignore */ }
  }, []);

  const getSecret = useCallback(
    (clientId) => credentialMap.get(clientId) ?? null,
    [credentialMap]
  );

  const hasCredential = useCallback(
    (clientId) => credentialMap.has(clientId),
    [credentialMap]
  );

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

  const getAllCredentials = useCallback(
    () =>
      Array.from(credentialMap.entries()).map(([id, secret]) => ({
        clientId: id,
        clientSecret: secret,
      })),
    [credentialMap]
  );

  const getGlobalCredential = useCallback((bg, env, chVersion) => {
    const bgEntry = globalCredentials.find(g => g.businessGroup === bg);
    if (!bgEntry) return null;
    const versionEntry = bgEntry[chVersion.toLowerCase()];
    if (!versionEntry) return null;
    return versionEntry[env.toLowerCase()] || null;
  }, [globalCredentials]);

  return (
    <CpsCredentialStoreContext.Provider
      value={{
        loadedCount,
        hasCredentials: loadedCount > 0,
        loadFromCsv,
        loadGlobalFromCsv,
        globalCredentials,
        getGlobalCredential,
        hasGlobalCredentials: globalCredentials.length > 0,
        clearCredentials,
        getSecret,
        hasCredential,
        resolveFromCandidates,
        getAllCredentials,
      }}
    >
      {children}
    </CpsCredentialStoreContext.Provider>
  );
}

export function useCpsCredentialStore() {
  const ctx = useContext(CpsCredentialStoreContext);
  if (!ctx) {
    throw new Error('useCpsCredentialStore must be used within a CpsCredentialStoreProvider');
  }
  return ctx;
}