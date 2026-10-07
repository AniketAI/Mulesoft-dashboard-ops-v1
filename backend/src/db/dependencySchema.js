const { db } = require('./dependencyDatabase');

function initializeDependencySchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS environments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bg_id TEXT NOT NULL,
      env_id TEXT NOT NULL,
      environment_name TEXT,
      environment_type TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(bg_id, env_id)
    );

    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      external_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'UNKNOWN',
      deployment_type TEXT,
      bg_id TEXT NOT NULL,
      env_id TEXT NOT NULL,
      environment_name TEXT,
      last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(external_id, bg_id, env_id, deployment_type)
    );

    CREATE TABLE IF NOT EXISTS properties (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      application_id INTEGER NOT NULL,
      property_key TEXT NOT NULL,
      property_value TEXT,
      property_type TEXT NOT NULL DEFAULT 'NON_SECURE',
      source TEXT,
      is_sensitive INTEGER NOT NULL DEFAULT 0,
      last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(application_id)
        REFERENCES applications(id)
        ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS endpoints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      application_id INTEGER NOT NULL,
      environment_id INTEGER,
      protocol TEXT,
      host TEXT,
      port INTEGER,
      base_path TEXT,
      endpoint_path TEXT,
      normalized_url TEXT,
      source TEXT,
      source_property_key TEXT,
      confidence TEXT,
      last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(application_id)
        REFERENCES applications(id)
        ON DELETE CASCADE,
      FOREIGN KEY(environment_id)
        REFERENCES environments(id)
        ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS dependencies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_application_id INTEGER NOT NULL,
      target_application_id INTEGER NOT NULL,
      source_environment_id INTEGER,
      target_environment_id INTEGER,
      relationship TEXT NOT NULL,
      match_type TEXT,
      matched_value TEXT,
      confidence TEXT,
      evidence_source TEXT,
      evidence_key TEXT,
      last_verified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(source_application_id)
        REFERENCES applications(id)
        ON DELETE CASCADE,
      FOREIGN KEY(target_application_id)
        REFERENCES applications(id)
        ON DELETE CASCADE,
      FOREIGN KEY(source_environment_id)
        REFERENCES environments(id)
        ON DELETE SET NULL,
      FOREIGN KEY(target_environment_id)
        REFERENCES environments(id)
        ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS cache_metadata (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cache_key TEXT NOT NULL UNIQUE,
      last_refresh_at TEXT,
      expires_at TEXT,
      status TEXT NOT NULL DEFAULT 'STALE',
      records_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_applications_environment
      ON applications(bg_id, env_id);

    CREATE INDEX IF NOT EXISTS idx_applications_name
      ON applications(name);

    CREATE INDEX IF NOT EXISTS idx_properties_application
      ON properties(application_id);

    CREATE INDEX IF NOT EXISTS idx_properties_key
      ON properties(property_key);

    CREATE INDEX IF NOT EXISTS idx_endpoints_application
      ON endpoints(application_id);

    CREATE INDEX IF NOT EXISTS idx_endpoints_host
      ON endpoints(host);

    CREATE INDEX IF NOT EXISTS idx_endpoints_normalized_url
      ON endpoints(normalized_url);

    CREATE INDEX IF NOT EXISTS idx_dependencies_source
      ON dependencies(source_application_id);

    CREATE INDEX IF NOT EXISTS idx_dependencies_target
      ON dependencies(target_application_id);
  `);
}

module.exports = {
  initializeDependencySchema,
};