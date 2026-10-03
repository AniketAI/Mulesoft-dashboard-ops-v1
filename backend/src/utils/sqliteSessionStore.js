const { Store } = require('express-session');
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

class SQLiteSessionStore extends Store {
  constructor(options = {}) {
    super();
    const dir = options.dir || '.';
    const file = options.db || 'sessions.db';
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.ttl = options.ttl || DEFAULT_TTL_MS;
    this.db = new DatabaseSync(path.join(dir, file));
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid TEXT PRIMARY KEY,
        sess TEXT NOT NULL,
        expired INTEGER NOT NULL
      )
    `);

    this._pruneTimer = setInterval(() => this._prune(), options.cleanupInterval || PRUNE_INTERVAL_MS);
    if (this._pruneTimer.unref) this._pruneTimer.unref();
  }

  _prune() {
    try {
      this.db.prepare('DELETE FROM sessions WHERE expired < ?').run(Date.now());
    } catch (err) {
      console.error('[SessionStore] prune error:', err.message);
    }
  }

  get(sid, callback) {
    try {
      const row = this.db.prepare('SELECT sess, expired FROM sessions WHERE sid = ?').get(sid);
      if (!row) return callback(null, null);
      if (row.expired < Date.now()) {
        return this.destroy(sid, () => callback(null, null));
      }
      return callback(null, JSON.parse(row.sess));
    } catch (err) {
      callback(err);
    }
  }

  set(sid, session, callback) {
    try {
      const expired = session.cookie && session.cookie.expires
        ? new Date(session.cookie.expires).getTime()
        : Date.now() + this.ttl;
      this.db.prepare(`
        INSERT INTO sessions (sid, sess, expired) VALUES (?, ?, ?)
        ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expired = excluded.expired
      `).run(sid, JSON.stringify(session), expired);
      if (callback) callback(null);
    } catch (err) {
      if (callback) callback(err);
    }
  }

  touch(sid, session, callback) {
    this.set(sid, session, callback);
  }

  destroy(sid, callback) {
    try {
      this.db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      if (callback) callback(null);
    } catch (err) {
      if (callback) callback(err);
    }
  }

  all(callback) {
    try {
      const rows = this.db.prepare('SELECT sess FROM sessions WHERE expired >= ?').all(Date.now());
      callback(null, rows.map((r) => JSON.parse(r.sess)));
    } catch (err) {
      callback(err);
    }
  }

  length(callback) {
    try {
      const row = this.db.prepare('SELECT COUNT(*) as count FROM sessions WHERE expired >= ?').get(Date.now());
      callback(null, row.count);
    } catch (err) {
      callback(err);
    }
  }

  clear(callback) {
    try {
      this.db.exec('DELETE FROM sessions');
      if (callback) callback(null);
    } catch (err) {
      if (callback) callback(err);
    }
  }
}

module.exports = SQLiteSessionStore;
