const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR =
  process.env.DEPENDENCY_DB_DIR ||
  path.resolve(__dirname, '../../data');

const DB_PATH =
  process.env.DEPENDENCY_DB_PATH ||
  path.join(DATA_DIR, 'mule-dependencies.db');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

module.exports = {
  db,
  DB_PATH,
  DATA_DIR,
};