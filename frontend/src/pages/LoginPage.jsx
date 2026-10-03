import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { Eye, EyeOff, Key, User, Zap, Link2, Info, Sun, Moon, ShieldCheck, Activity, GitCompare, Database } from 'lucide-react';

const TABS = [
  { id: 'app', label: 'Connected App' },
  { id: 'credentials', label: 'Username & Password' },
  { id: 'token', label: 'Bearer Token' }
];

const FEATURES = [
  { icon: Activity, label: 'Real-time health & ping diagnostics' },
  { icon: GitCompare, label: 'Side-by-side CPS property comparison' },
  { icon: Database, label: 'Centralized Config Property Server management' },
  { icon: ShieldCheck, label: 'API Manager contracts & access control' },
];

export default function LoginPage() {
  const { login, tokenLogin, connectedAppLogin, demoLogin } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [tab, setTab] = useState('app');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showTokenGuide, setShowTokenGuide] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (tab === 'credentials') {
        await login(username, password);
      } else if (tab === 'token') {
        await tokenLogin(token);
      } else if (tab === 'app') {
        await connectedAppLogin(clientId, clientSecret);
      }
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleDemoLogin = () => {
    demoLogin();
    navigate('/');
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden bg-gray-50 dark:bg-gray-950 p-4 sm:p-8">
      {/* Unified theme-aware background canvas — soft mesh gradient + floating glow orbs.
          No hard color block: the same layer adapts its intensity for light vs dark
          so the whole page reads as one cohesive surface instead of two palettes. */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-sf-50 via-gray-50 to-sfteal-50/60 dark:from-gray-950 dark:via-gray-950 dark:to-gray-900" />
        <div className="absolute -top-40 -left-32 w-[32rem] h-[32rem] rounded-full bg-sf-400/20 dark:bg-sf-500/10 blur-3xl" />
        <div className="absolute top-1/3 -right-32 w-[28rem] h-[28rem] rounded-full bg-sfpurple-400/15 dark:bg-sfpurple-500/10 blur-3xl" />
        <div className="absolute -bottom-32 left-1/4 w-96 h-96 rounded-full bg-sfteal-400/15 dark:bg-sfteal-500/10 blur-3xl" />
        <div
          className="absolute inset-0 opacity-[0.4] dark:opacity-[0.05]"
          style={{ backgroundImage: 'radial-gradient(circle, #0176d3 1px, transparent 1px)', backgroundSize: '32px 32px' }}
        />
      </div>

      {/* Top brand accent strip, consistent with the authenticated app shell */}
      <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-sf-500 via-sfteal-400 to-sfpurple-500 z-40 shadow-[0_1px_8px_rgba(1,118,211,0.35)]" />

      {/* Theme toggle */}
      <button
        onClick={toggleTheme}
        title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        className="absolute top-5 right-5 z-30 p-2.5 rounded-xl text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 bg-white/80 dark:bg-gray-800/80 hover:bg-white dark:hover:bg-gray-800 border border-gray-200/80 dark:border-gray-700/80 shadow-sm backdrop-blur-sm transition-all"
      >
        <Sun size={16} className={`absolute inset-0 m-auto transition-all duration-300 ${isDark ? 'opacity-100 rotate-0 scale-100' : 'opacity-0 -rotate-90 scale-0'}`} />
        <Moon size={16} className={`transition-all duration-300 ${isDark ? 'opacity-0 rotate-90 scale-0' : 'opacity-100 rotate-0 scale-100'}`} />
      </button>

      {/* ── Centered content ── */}
      <div className="relative z-10 w-full max-w-md">
        {/* Logo + heading */}
        <div className="text-center mb-7">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-sf-500 to-sf-700 mb-4 shadow-lg shadow-sf-500/30 ring-1 ring-white/20">
            <span className="text-white font-bold text-xl">M</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 tracking-tight">Welcome back</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-1.5">Sign in to your MuleSoft Ops Dashboard</p>
        </div>

        {/* Feature pills */}
        <div className="flex items-center justify-center gap-2 flex-wrap mb-7">
          {FEATURES.map(({ icon: Icon, label }) => (
            <span key={label} title={label}
              className="flex items-center gap-1.5 text-[11px] font-medium text-gray-500 dark:text-gray-400 bg-white/70 dark:bg-gray-800/60 border border-gray-200/70 dark:border-gray-700/60 rounded-full px-2.5 py-1 backdrop-blur-sm">
              <Icon size={11} className="text-sf-500 dark:text-sf-400 flex-shrink-0" />
              {label}
            </span>
          ))}
        </div>

        {/* Demo button */}
        <button
          onClick={handleDemoLogin}
          className="w-full mb-5 flex items-center justify-center gap-2 bg-gradient-to-b from-sfpurple-500 to-sfpurple-600 hover:from-sfpurple-400 hover:to-sfpurple-500 text-white font-semibold py-3 rounded-xl shadow-md shadow-sfpurple-500/30 hover:shadow-lg hover:shadow-sfpurple-500/40 ring-1 ring-inset ring-white/20 transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0"
        >
          <Zap size={18} />
          Try Demo Mode — No login required
        </button>

        <div className="flex items-center gap-3 mb-5">
          <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700"></div>
          <span className="text-gray-400 dark:text-gray-500 text-xs font-medium">or sign in with your account</span>
          <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700"></div>
        </div>

        {/* Card */}
        <div className="bg-white/90 dark:bg-gray-800/90 backdrop-blur-xl border border-gray-200/80 dark:border-gray-700/80 rounded-3xl p-6 shadow-xl shadow-gray-900/5 dark:shadow-black/30">
            {/* Tabs */}
            <div className="flex rounded-xl bg-gray-100 dark:bg-gray-900/60 p-1 mb-5 gap-0.5">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => { setTab(t.id); setError(''); }}
                  className={`flex-1 py-2 px-2 rounded-lg text-xs font-semibold transition-all ${
                    tab === t.id ? 'bg-white dark:bg-gray-800 text-sf-700 dark:text-sf-300 shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Connected App tab */}
            {tab === 'app' && (
              <div className="mb-4 bg-gradient-to-br from-sf-50 to-sf-50/40 dark:from-sf-500/10 dark:to-sf-500/5 border border-sf-200/70 dark:border-sf-400/20 rounded-2xl p-4 text-sm">
                <div className="flex items-start gap-2.5">
                  <span className="flex items-center justify-center w-7 h-7 rounded-xl bg-sf-100 dark:bg-sf-500/20 flex-shrink-0">
                    <Link2 size={14} className="text-sf-600 dark:text-sf-400" />
                  </span>
                  <div className="text-gray-700 dark:text-gray-300 min-w-0">
                    <p className="font-semibold text-sf-700 dark:text-sf-300 mb-1">Recommended for SSO users</p>
                    <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
                      Create a <strong className="text-gray-900 dark:text-gray-100">Connected App</strong> in Anypoint Platform with Client Credentials grant.
                      This works independently of SSO.
                    </p>
                    <p className="text-xs text-sf-700 dark:text-sf-300 mt-2 font-semibold">
                      Anypoint Platform → Access Management → Connected Apps → Create App
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      Required scopes: Runtime Manager, API Manager, Exchange Viewer, General Profile
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Bearer Token tab — guide */}
            {tab === 'token' && (
              <div className="mb-4">
                <button
                  type="button"
                  onClick={() => setShowTokenGuide(!showTokenGuide)}
                  className="flex items-center gap-1.5 text-xs font-semibold text-sf-600 dark:text-sf-400 hover:text-sf-700 dark:hover:text-sf-300 mb-3 transition-colors"
                >
                  <Info size={13} />
                  How to get your bearer token from browser DevTools (SSO users)
                </button>
                {showTokenGuide && (
                  <div className="bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700/60 rounded-2xl p-4 text-xs text-gray-700 dark:text-gray-300 space-y-1.5 mb-3 leading-relaxed">
                    <p className="text-gray-400 dark:text-gray-500 font-semibold mb-2 uppercase tracking-wide text-[10px]">Steps to grab your token</p>
                    <p>1. Log in to <span className="text-sf-600 dark:text-sf-400 font-semibold">anypoint.mulesoft.com</span> via SSO as usual</p>
                    <p>2. Open browser DevTools → <span className="text-amber-600 dark:text-amber-400 font-semibold">Network</span> tab</p>
                    <p>3. Filter by <span className="text-emerald-600 dark:text-emerald-400 font-semibold">XHR</span> and reload the page</p>
                    <p>4. Click any API request (e.g. to <span className="font-mono text-gray-900 dark:text-gray-100">/accounts/api/me</span>)</p>
                    <p>5. In Request Headers find <span className="font-mono text-amber-600 dark:text-amber-400">{'Authorization: Bearer <token>'}</span></p>
                    <p>6. Copy everything after <span className="font-mono">Bearer </span> and paste below</p>
                    <p className="text-gray-400 dark:text-gray-500 pt-1">⚠ Tokens expire — typically valid for a few hours.</p>
                  </div>
                )}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {tab === 'app' && (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Client ID</label>
                    <div className="relative">
                      <Link2 size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
                      <input
                        type="text"
                        value={clientId}
                        onChange={(e) => setClientId(e.target.value)}
                        placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                        required
                        className="w-full bg-gray-50 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700 rounded-xl pl-10 pr-4 py-2.5 text-gray-900 dark:text-gray-100 text-sm placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-sf-500 dark:focus:border-sf-400 focus:ring-2 focus:ring-sf-500/15 font-mono transition-all"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Client Secret</label>
                    <div className="relative">
                      <Key size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
                      <input
                        type={showSecret ? 'text' : 'password'}
                        value={clientSecret}
                        onChange={(e) => setClientSecret(e.target.value)}
                        placeholder="••••••••••••••••••••••••••••••••"
                        required
                        className="w-full bg-gray-50 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700 rounded-xl pl-10 pr-10 py-2.5 text-gray-900 dark:text-gray-100 text-sm placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-sf-500 dark:focus:border-sf-400 focus:ring-2 focus:ring-sf-500/15 font-mono transition-all"
                      />
                      <button type="button" onClick={() => setShowSecret(!showSecret)}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
                        {showSecret ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </div>
                  </div>
                </>
              )}

              {tab === 'credentials' && (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Username</label>
                    <div className="relative">
                      <User size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
                      <input type="text" value={username} onChange={(e) => setUsername(e.target.value)}
                        placeholder="your@email.com" required
                        className="w-full bg-gray-50 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700 rounded-xl pl-10 pr-4 py-2.5 text-gray-900 dark:text-gray-100 text-sm placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-sf-500 dark:focus:border-sf-400 focus:ring-2 focus:ring-sf-500/15 transition-all" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Password</label>
                    <div className="relative">
                      <Key size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
                      <input type={showPassword ? 'text' : 'password'} value={password}
                        onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required
                        className="w-full bg-gray-50 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700 rounded-xl pl-10 pr-10 py-2.5 text-gray-900 dark:text-gray-100 text-sm placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-sf-500 dark:focus:border-sf-400 focus:ring-2 focus:ring-sf-500/15 transition-all" />
                      <button type="button" onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
                        {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </div>
                  </div>
                </>
              )}

              {tab === 'token' && (
                <div>
                  <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Bearer Token</label>
                  <textarea value={token} onChange={(e) => setToken(e.target.value)}
                    placeholder="Paste your bearer token here..." required rows={4}
                    className="w-full bg-gray-50 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-2.5 text-gray-900 dark:text-gray-100 text-sm placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-sf-500 dark:focus:border-sf-400 focus:ring-2 focus:ring-sf-500/15 resize-none font-mono transition-all" />
                </div>
              )}

              {error && (
                <div className="bg-red-50 dark:bg-red-500/10 border border-red-200/70 dark:border-red-400/30 rounded-xl px-4 py-3 text-red-700 dark:text-red-300 text-sm font-medium">
                  {error}
                </div>
              )}

              <button type="submit" disabled={loading}
                className="w-full bg-gradient-to-b from-sf-500 to-sf-600 hover:from-sf-400 hover:to-sf-500 disabled:opacity-60 text-white font-semibold py-3 rounded-xl shadow-md shadow-sf-500/30 hover:shadow-lg hover:shadow-sf-500/40 ring-1 ring-inset ring-white/20 transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 flex items-center justify-center gap-2">
                {loading ? (
                  <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>Connecting...</>
                ) : (
                  tab === 'app' ? 'Connect with Connected App' :
                  tab === 'credentials' ? 'Sign In' :
                  'Connect with Token'
                )}
              </button>
            </form>
          </div>

          <p className="text-center text-xs text-gray-400 dark:text-gray-500 mt-6">
            MuleSoft Integration Dashboard · Credentials are never stored
          </p>
      </div>
    </div>
  );
}
