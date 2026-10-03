import React, { createContext, useContext, useState, useEffect } from 'react';
import api, { isDemoMode, enableDemoMode, disableDemoMode } from '../services/api';
import { MOCK_USER } from '../services/mockData.js';
import { clearCache } from '../services/apiCache';
import { warmCache } from '../services/prefetch';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [orgId, setOrgId] = useState(null);
  const [orgName, setOrgName] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkSession();

    // Recheck session when the user switches back to this tab.
    // This handles the "server restarted while tab was open" case:
    // the React state still shows the user as logged in but the backend
    // session is gone — the visibility change triggers a re-validation.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        checkSession();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const checkSession = async () => {
    try {
      if (isDemoMode()) {
        setUser(MOCK_USER);
        setOrgId('demo-org-001');
        setOrgName('Demo Organization');
        setLoading(false);
        return;
      }
      const res = await api.get('/auth/session');
      if (res.data.authenticated) {
        setUser(res.data.user);
        setOrgId(res.data.orgId);
        setOrgName(res.data.orgName);
      } else {
        // Session expired or server restarted — clear stale user state
        // so the route guard redirects to the login page.
        setUser(null);
        setOrgId(null);
        setOrgName(null);
      }
    } catch (e) {
      // Network error or unexpected failure — clear user state to be safe
      setUser(null);
      setOrgId(null);
      setOrgName(null);
    } finally {
      setLoading(false);
    }
  };

  const applyResult = (data) => {
    setUser(data.user);
    setOrgId(data.orgId);
    setOrgName(data.orgName);
  };

  const login = async (username, password) => {
    const res = await api.post('/auth/login', { username, password });
    applyResult(res.data);
    warmCache(res.data.orgId); // fire-and-forget background prefetch
    return res.data;
  };

  const tokenLogin = async (token) => {
    const res = await api.post('/auth/token-login', { token });
    applyResult(res.data);
    warmCache(res.data.orgId); // fire-and-forget background prefetch
    return res.data;
  };

  const connectedAppLogin = async (clientId, clientSecret) => {
    const res = await api.post('/auth/connected-app-login', { clientId, clientSecret });
    applyResult(res.data);
    warmCache(res.data.orgId); // fire-and-forget background prefetch
    return res.data;
  };

  const demoLogin = () => {
    enableDemoMode();
    setUser(MOCK_USER);
    setOrgId('demo-org-001');
    setOrgName('Demo Organization');
  };

  const logout = async () => {
    disableDemoMode();
    await api.post('/auth/logout');
    clearCache(); // flush stale data so next user never sees previous session
    setUser(null);
    setOrgId(null);
    setOrgName(null);
  };

  return (
    <AuthContext.Provider
      value={{ user, orgId, orgName, loading, login, tokenLogin, connectedAppLogin, demoLogin, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);