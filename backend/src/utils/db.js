const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DB_DIR = path.join(__dirname, '..', '..', 'data');
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const dbPath = path.join(DB_DIR, 'app.db');

const sqlite = new DatabaseSync(dbPath);
console.log('[DB] Connected to application database (app.db).');

const db = {
  run(sql, params, callback) {
    if (typeof params === 'function') {
      callback = params;
      params = [];
    }
    params = params || [];
    try {
      const stmt = sqlite.prepare(sql);
      const info = stmt.run(...params);
      if (typeof callback === 'function') {
        callback.call({ lastID: info.lastInsertRowid, changes: info.changes }, null);
      }
    } catch (err) {
      if (typeof callback === 'function') {
        callback.call({}, err);
      } else {
        console.error('[DB] run error:', err.message);
      }
    }
    return db;
  },

  get(sql, params, callback) {
    if (typeof params === 'function') {
      callback = params;
      params = [];
    }
    params = params || [];
    try {
      const stmt = sqlite.prepare(sql);
      const row = stmt.get(...params);
      if (typeof callback === 'function') callback(null, row);
    } catch (err) {
      if (typeof callback === 'function') callback(err);
    }
    return db;
  },

  all(sql, params, callback) {
    if (typeof params === 'function') {
      callback = params;
      params = [];
    }
    params = params || [];
    try {
      const stmt = sqlite.prepare(sql);
      const rows = stmt.all(...params);
      if (typeof callback === 'function') callback(null, rows);
    } catch (err) {
      if (typeof callback === 'function') callback(err);
    }
    return db;
  },

  exec(sql, callback) {
    try {
      sqlite.exec(sql);
      if (typeof callback === 'function') callback(null);
    } catch (err) {
      if (typeof callback === 'function') callback(err);
      else console.error('[DB] exec error:', err.message);
    }
    return db;
  },

  serialize(fn) {
    if (typeof fn === 'function') fn();
    return db;
  },

  close(callback) {
    try {
      sqlite.close();
      if (typeof callback === 'function') callback(null);
    } catch (err) {
      if (typeof callback === 'function') callback(err);
    }
  }
};

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS ping_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      org_id TEXT NOT NULL,
      env_id TEXT NOT NULL,
      app_name TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      status TEXT NOT NULL,
      response_time_ms INTEGER,
      endpoint TEXT,
      payload TEXT,
      error TEXT,
      env_name TEXT,
      target_type TEXT,
      credentials TEXT,
      http_status INTEGER
    )
  `);

  const addColumnIfMissing = (column, type) => {
    try {
      sqlite.exec(`ALTER TABLE ping_history ADD COLUMN ${column} ${type}`);
    } catch (err) {
      // Column already exists - ignore (mirrors previous sqlite3 behavior of swallowing errors)
    }
  };
  addColumnIfMissing('env_name', 'TEXT');
  addColumnIfMissing('target_type', 'TEXT');
  addColumnIfMissing('credentials', 'TEXT');
  addColumnIfMissing('http_status', 'INTEGER');

  db.run(`CREATE INDEX IF NOT EXISTS idx_ping_history_session_app ON ping_history(session_id, org_id, env_id, app_name)`);
});

module.exports = db;
