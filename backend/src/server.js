require('dotenv').config();
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const rateLimit = require('express-rate-limit');

// ── Session secret validation ─────────────────────────────────────────────────
// Fail fast in production if SESSION_SECRET is not set or is the known default.
// In development, emit a warning but continue.
const SESSION_SECRET = process.env.SESSION_SECRET;
const DEFAULT_SECRET = 'mulesoft-dashboard-secret';
if (!SESSION_SECRET || SESSION_SECRET === DEFAULT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    console.error(
      'FATAL: SESSION_SECRET must be set to a strong random string in production. ' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"'
    );
    process.exit(1);
  } else {
    console.warn(
      'WARNING: SESSION_SECRET is not set or is the default. ' +
      'This is insecure — set SESSION_SECRET in .env before deploying to production.'
    );
  }
}

const fs = require('fs');
const authRoutes = require('./routes/auth');
const organizationsRoutes = require('./routes/organizations');
const environmentsRoutes = require('./routes/environments');
const applicationsRoutes = require('./routes/applications');
const apisRoutes = require('./routes/apis');
const exchangeRoutes = require('./routes/exchange');
const metricsRoutes = require('./routes/metrics');
const cpsRoutes = require('./routes/cps');
const healthRoutes = require('./routes/health');

// ── SQLite session store ──────────────────────────────────────────────────────
// Replaces the default MemoryStore (which loses all sessions on restart).
// Sessions are persisted to ./data/sessions.db — survives restarts, deploys,
// and OOM-induced process kills without logging out all users.
const SQLiteStore = require('./utils/sqliteSessionStore');
const SESSION_DB_DIR = process.env.SESSION_DB_DIR || './data';
try { if (!fs.existsSync(SESSION_DB_DIR)) fs.mkdirSync(SESSION_DB_DIR, { recursive: true }); } catch {}

const app = express();
const PORT = process.env.PORT || 5000;
const isProd = process.env.NODE_ENV === 'production';

// Trust the first proxy hop when running behind nginx / a load balancer.
// Required for req.secure and cookie.secure to work correctly in production.
if (isProd) {
  app.set('trust proxy', 1);
}

// Middleware
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000'],
  credentials: true
}));
// Default body size limit — small and safe for all general routes.
// CPS payloads (bulk property lists) can be large, so the limit is overridden
// specifically for /api/cps below before mounting its router.
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ limit: '1mb', extended: true }));
app.use(session({
  store: new SQLiteStore({ db: 'sessions.db', dir: SESSION_DB_DIR }),
  secret: SESSION_SECRET || DEFAULT_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: isProd,          // true in production (HTTPS only), false in dev
    httpOnly: true,          // prevents JavaScript access to the cookie
    sameSite: 'lax',         // CSRF mitigation — blocks cross-site POST requests
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// ── Rate limiting — auth endpoints only ─────────────────────────────────────
// Limit login attempts to prevent brute-force attacks.
// 20 attempts per IP per 15-minute window is generous for legitimate use
// while blocking automated credential-stuffing.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 20,                    // max 20 login attempts per IP per window
  standardHeaders: true,      // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false,       // Disable the `X-RateLimit-*` headers
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
  skip: (req) => process.env.NODE_ENV !== 'production', // only enforce in production
});

app.use('/api/auth/login', authLimiter);
app.use('/api/auth/token-login', authLimiter);
app.use('/api/auth/connected-app-login', authLimiter);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/organizations', organizationsRoutes);
app.use('/api/environments', environmentsRoutes);
app.use('/api/applications', applicationsRoutes);
app.use('/api/apis', apisRoutes);
app.use('/api/exchange', exchangeRoutes);
app.use('/api/metrics', metricsRoutes);
// CPS routes receive a higher body-size limit — property payloads can be large
app.use('/api/cps', express.json({ limit: '50mb' }));
app.use('/api/cps', cpsRoutes);
app.use('/api/health', healthRoutes);

// Server health check
app.get('/api/ping', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Global Error Handler ────────────────────────────────────────────────────
// Must be registered AFTER all routes. Express identifies this as an
// error-handling middleware by the 4-parameter signature (err, req, res, next).
// Any route that calls next(err) or throws will land here instead of hanging.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[GlobalError]', err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`MuleSoft Dashboard Backend running on port ${PORT}`);
});
