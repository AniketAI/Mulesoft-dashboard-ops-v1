const { db } = require('./dependencyDatabase');

const upsertEnvironmentStatement = db.prepare(`
  INSERT INTO environments (
    bg_id,
    env_id,
    environment_name,
    environment_type,
    updated_at
  )
  VALUES (
    @bgId,
    @envId,
    @environmentName,
    @environmentType,
    CURRENT_TIMESTAMP
  )
  ON CONFLICT(bg_id, env_id)
  DO UPDATE SET
    environment_name = excluded.environment_name,
    environment_type = excluded.environment_type,
    updated_at = CURRENT_TIMESTAMP
`);

const getEnvironmentStatement = db.prepare(`
  SELECT id
  FROM environments
  WHERE bg_id = ?
    AND env_id = ?
`);

const upsertApplicationStatement = db.prepare(`
  INSERT INTO applications (
    external_id,
    name,
    type,
    deployment_type,
    bg_id,
    env_id,
    environment_name,
    last_seen_at,
    updated_at
  )
  VALUES (
    @externalId,
    @name,
    @type,
    @deploymentType,
    @bgId,
    @envId,
    @environmentName,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  )
  ON CONFLICT(
    external_id,
    bg_id,
    env_id,
    deployment_type
  )
  DO UPDATE SET
    name = excluded.name,
    type = excluded.type,
    environment_name = excluded.environment_name,
    last_seen_at = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP
`);

const getApplicationStatement = db.prepare(`
  SELECT id
  FROM applications
  WHERE external_id = ?
    AND bg_id = ?
    AND env_id = ?
    AND deployment_type = ?
`);

const saveEnvironment = db.transaction((environment) => {
  upsertEnvironmentStatement.run({
    bgId: environment.bgId,
    envId: environment.envId,
    environmentName:
      environment.envName || null,
    environmentType:
      environment.environmentType || null,
  });

  const row = getEnvironmentStatement.get(
    environment.bgId,
    environment.envId
  );

  return row?.id || null;
});

const saveApplication = db.transaction((application) => {
  upsertApplicationStatement.run({
    externalId: application.id,
    name: application.name,
    type: application.type || 'UNKNOWN',
    deploymentType:
      application.deploymentType || null,
    bgId: application.bgId,
    envId: application.envId,
    environmentName:
      application.environment || null,
  });

  const row = getApplicationStatement.get(
    application.id,
    application.bgId,
    application.envId,
    application.deploymentType
  );

  return row?.id || null;
});

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

  const environmentId = saveEnvironment({
    bgId: application.bgId,
    envId: application.envId,
    envName: application.environment,
    environmentType:
      application.deploymentType,
  });

  const applicationId = saveApplication(
    application
  );

  return {
    environmentId,
    applicationId,
  };
}

function saveDiscoveredApplications(
  applications
) {
  if (!Array.isArray(applications)) {
    return {
      saved: 0,
      failed: 0,
      failures: [],
    };
  }

  const failures = [];
  let saved = 0;

  for (const application of applications) {
    try {
      saveDiscoveredApplication(application);
      saved += 1;
    } catch (error) {
      failures.push({
        application:
          application?.name || '',
        message:
          error.message ||
          'Failed to save application',
      });
    }
  }

  return {
    saved,
    failed: failures.length,
    failures,
  };
}

module.exports = {
  saveDiscoveredApplication,
  saveDiscoveredApplications,
};