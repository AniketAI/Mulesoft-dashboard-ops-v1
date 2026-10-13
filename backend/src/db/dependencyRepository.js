
const { db } = require('./dependencyDatabase');

const SENSITIVE_KEY_PATTERN =
  /(password|passwd|secret|token|credential|private.?key|client.?secret|api.?key|access.?key)/i;

function normalizeDeploymentType(value) {
  return String(value || 'UNKNOWN').trim() || 'UNKNOWN';
}

function normalizePropertyEntries(properties, options = {}) {
  if (Array.isArray(properties)) {
    return properties
      .map((item) => ({
        key: item?.key ?? item?.property_key ?? item?.name,
        value: item?.value ?? item?.property_value,
        type: item?.propertyType ?? item?.property_type ?? options.propertyType,
        source: item?.source ?? options.source,
      }))
      .filter((item) => item.key !== undefined && item.key !== null);
  }

  if (!properties || typeof properties !== 'object') {
    return [];
  }

  return Object.entries(properties).map(([key, value]) => ({
    key,
    value,
    type: options.propertyType,
    source: options.source,
  }));
}

function saveEnvironmentInternal(environment) {
  db.prepare(`
    INSERT INTO environments (
      bg_id, env_id, environment_name, environment_type, updated_at
    )
    VALUES (
      @bgId, @envId, @environmentName, @environmentType,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT(bg_id, env_id)
    DO UPDATE SET
      environment_name = excluded.environment_name,
      environment_type = excluded.environment_type,
      updated_at = CURRENT_TIMESTAMP
  `).run({
    bgId: environment.bgId,
    envId: environment.envId,
    environmentName: environment.envName || null,
    environmentType: environment.environmentType || null,
  });

  const row = db.prepare(`
    SELECT id FROM environments
    WHERE bg_id = ? AND env_id = ?
  `).get(environment.bgId, environment.envId);

  return row?.id || null;
}

function saveApplicationInternal(application) {
  const deploymentType = normalizeDeploymentType(
    application.deploymentType
  );

  db.prepare(`
    INSERT INTO applications (
      external_id, name, type, deployment_type,
      bg_id, env_id, environment_name,
      last_seen_at, updated_at
    )
    VALUES (
      @externalId, @name, @type, @deploymentType,
      @bgId, @envId, @environmentName,
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
    ON CONFLICT(external_id, bg_id, env_id, deployment_type)
    DO UPDATE SET
      name = excluded.name,
      type = excluded.type,
      environment_name = excluded.environment_name,
      last_seen_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  `).run({
    externalId: String(application.id),
    name: String(application.name),
    type: application.type || 'UNKNOWN',
    deploymentType,
    bgId: String(application.bgId),
    envId: String(application.envId),
    environmentName: application.environment || null,
  });

  const row = db.prepare(`
    SELECT id FROM applications
    WHERE external_id = ?
      AND bg_id = ?
      AND env_id = ?
      AND deployment_type = ?
  `).get(
    String(application.id),
    String(application.bgId),
    String(application.envId),
    deploymentType
  );

  return row?.id || null;
}

function saveDiscoveredApplication(application) {
  if (
    !application ||
    !application.id ||
    !application.name ||
    !application.bgId ||
    !application.envId
  ) {
    throw new Error(
      'Invalid application data: id, name, bgId and envId are required'
    );
  }

  return db.transaction(() => {
    const environmentId = saveEnvironmentInternal({
      bgId: application.bgId,
      envId: application.envId,
      envName: application.environment,
      environmentType: application.deploymentType,
    });

    const applicationId = saveApplicationInternal(application);

    return { environmentId, applicationId };
  })();
}

function saveDiscoveredApplications(applications) {
  if (!Array.isArray(applications)) {
    return { saved: 0, failed: 0, failures: [] };
  }

  const failures = [];
  let saved = 0;

  for (const application of applications) {
    try {
      saveDiscoveredApplication(application);
      saved += 1;
    } catch (error) {
      failures.push({
        application: application?.name || '',
        message: error.message || 'Failed to save application',
      });
    }
  }

  return { saved, failed: failures.length, failures };
}


function saveApplicationProperties(
  applicationId,
  properties,
  options = {}
) {
  if (
    !Number.isInteger(Number(applicationId)) ||
    Number(applicationId) <= 0
  ) {
    throw new Error('A valid applicationId is required');
  }

  const entries = normalizePropertyEntries(properties, options);
  const propertyType = String(
    options.propertyType || 'NON_SECURE'
  ).toUpperCase();
  const source = options.source || 'UNKNOWN';

  const saveTransaction = db.transaction(() => {
    let saved = 0;
    const currentKeys = new Set();

    for (const entry of entries) {
      const key = String(entry.key ?? '').trim();

      if (!key) continue;

      const type = String(
        entry.type || propertyType
      ).toUpperCase();

      const entrySource = entry.source || source;
      const sensitive =
        type === 'SECURE' ||
        SENSITIVE_KEY_PATTERN.test(key);

      const value =
        sensitive ||
        entry.value === undefined ||
        entry.value === null
          ? null
          : typeof entry.value === 'object'
            ? JSON.stringify(entry.value)
            : String(entry.value);

      db.prepare(`
        INSERT INTO properties (
          application_id, property_key, property_value,
          property_type, source, is_sensitive,
          last_seen_at, updated_at
        )
        VALUES (
          @applicationId, @propertyKey, @propertyValue,
          @propertyType, @source, @isSensitive,
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
        ON CONFLICT(
          application_id, property_key, property_type
        )
        DO UPDATE SET
          property_value = excluded.property_value,
          source = excluded.source,
          is_sensitive = excluded.is_sensitive,
          last_seen_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      `).run({
        applicationId: Number(applicationId),
        propertyKey: key,
        propertyValue: value,
        propertyType: type,
        source: entrySource,
        isSensitive: sensitive ? 1 : 0,
      });

      if (type === propertyType && entrySource === source) {
        currentKeys.add(key);
      }

      saved += 1;
    }

    // Only reconcile when the caller confirms that the source
    // was fetched successfully.
    if (options.reconcile === true) {
      const existing = db.prepare(`
        SELECT property_key
        FROM properties
        WHERE application_id = ?
          AND property_type = ?
          AND source = ?
      `).all(
        Number(applicationId),
        propertyType,
        source
      );

      const deleteProperty = db.prepare(`
        DELETE FROM properties
        WHERE application_id = ?
          AND property_type = ?
          AND source = ?
          AND property_key = ?
      `);

      for (const row of existing) {
        if (!currentKeys.has(row.property_key)) {
          deleteProperty.run(
            Number(applicationId),
            propertyType,
            source,
            row.property_key
          );
        }
      }
    }

    return saved;
  });

  return saveTransaction();
}


function saveApplicationEndpoints(
  applicationId,
  environmentId,
  endpoints
) {
  if (!Array.isArray(endpoints)) return 0;

  const saveEndpointsTransaction = db.transaction(() => {
    let saved = 0;

    for (const endpoint of endpoints) {
      if (!endpoint || !endpoint.normalized_url) continue;

      const identity = {
        applicationId: Number(applicationId),
        normalizedUrl: String(endpoint.normalized_url),
        sourcePropertyKey: endpoint.source_property_key || null,
      };

      const existing = db.prepare(`
        SELECT id FROM endpoints
        WHERE application_id = ?
          AND normalized_url = ?
          AND source_property_key IS ?
      `).get(
        identity.applicationId,
        identity.normalizedUrl,
        identity.sourcePropertyKey
      );

      const values = {
        applicationId: identity.applicationId,
        environmentId: environmentId || null,
        protocol: endpoint.protocol || null,
        host: endpoint.host || null,
        port: endpoint.port ?? null,
        basePath: endpoint.base_path || null,
        endpointPath: endpoint.endpoint_path || null,
        normalizedUrl: identity.normalizedUrl,
        source: endpoint.source || 'UNKNOWN',
        sourcePropertyKey: identity.sourcePropertyKey,
        confidence: endpoint.confidence || null,
      };

      if (existing) {
        db.prepare(`
          UPDATE endpoints SET
            environment_id = @environmentId,
            protocol = @protocol,
            host = @host,
            port = @port,
            base_path = @basePath,
            endpoint_path = @endpointPath,
            source = @source,
            confidence = @confidence,
            last_seen_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = @id
        `).run({ ...values, id: existing.id });
      } else {
        db.prepare(`
          INSERT INTO endpoints (
            application_id, environment_id, protocol, host,
            port, base_path, endpoint_path, normalized_url,
            source, source_property_key, confidence,
            last_seen_at, updated_at
          )
          VALUES (
            @applicationId, @environmentId, @protocol, @host,
            @port, @basePath, @endpointPath, @normalizedUrl,
            @source, @sourcePropertyKey, @confidence,
            CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
          )
        `).run(values);
      }

      saved += 1;
    }

    return saved;
  });

  return saveEndpointsTransaction();
}

function startSyncRun(selectedScopes) {
  const result = db.prepare(`
    INSERT INTO sync_runs (status, selected_scopes)
    VALUES ('RUNNING', ?)
  `).run(Number(selectedScopes) || 0);

  return Number(result.lastInsertRowid);
}

function finishSyncRun(syncRunId, summary = {}) {
  const allowedStatuses = new Set([
    'SUCCEEDED',
    'PARTIAL',
    'FAILED',
  ]);

  const status = allowedStatuses.has(summary.status)
    ? summary.status
    : 'FAILED';

  const errors = summary.failures || summary.errors || [];

  db.prepare(`
    UPDATE sync_runs SET
      status = @status,
      applications_discovered = @applications,
      properties_discovered = @properties,
      endpoints_discovered = @endpoints,
      failures_count = @failures,
      error_summary = @errorSummary,
      completed_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `).run({
    id: syncRunId,
    status,
    applications: Number(summary.applications) || 0,
    properties: Number(summary.properties) || 0,
    endpoints: Number(summary.endpoints) || 0,
    failures: Number(summary.failuresCount ?? errors.length) || 0,
    errorSummary: errors.length ? JSON.stringify(errors) : null,
  });

  return getSyncRun(syncRunId);
}

function getSyncRun(syncRunId) {
  return db.prepare(`
    SELECT * FROM sync_runs WHERE id = ?
  `).get(syncRunId) || null;
}

function getLatestSyncRun() {
  return db.prepare(`
    SELECT * FROM sync_runs
    ORDER BY id DESC
    LIMIT 1
  `).get() || null;
}

function getStoredInventory(filters = {}) {
  const conditions = [];
  const params = [];

  if (filters.bgId) {
    conditions.push('bg_id = ?');
    params.push(String(filters.bgId));
  }

  if (filters.envId) {
    conditions.push('env_id = ?');
    params.push(String(filters.envId));
  }

  const where = conditions.length
    ? `WHERE ${conditions.join(' AND ')}`
    : '';

  const applications = db.prepare(`
    SELECT * FROM applications
    ${where}
    ORDER BY name
  `).all(...params);

  const applicationIds = applications.map((app) => app.id);

  if (!applicationIds.length) {
    return { applications, properties: [], endpoints: [] };
  }

  const placeholders = applicationIds.map(() => '?').join(',');

  const properties = db.prepare(`
    SELECT * FROM properties
    WHERE application_id IN (${placeholders})
    ORDER BY application_id, property_key
  `).all(...applicationIds);

  const endpoints = db.prepare(`
    SELECT * FROM endpoints
    WHERE application_id IN (${placeholders})
    ORDER BY application_id, host
  `).all(...applicationIds);

  return { applications, properties, endpoints };
}

module.exports = {
  saveDiscoveredApplication,
  saveDiscoveredApplications,
  saveApplicationProperties,
  saveApplicationEndpoints,
  startSyncRun,
  finishSyncRun,
  getSyncRun,
  getLatestSyncRun,
  getStoredInventory,
};
