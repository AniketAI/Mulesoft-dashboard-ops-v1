const axios = require('axios');
const https = require('https');

const {
  parseCH2Apps,
  makeCh1Headers,
} = require('./appHelpers');

const cpsRoutes = require('../routes/cps');

const {
  normaliseUrl,
  getCredentials,
  detectEnvType,
  detectChType,
  httpsAgent,
} = cpsRoutes._cpsHelpers;

const dependencyHttpsAgent =
  httpsAgent ||
  new https.Agent({
    rejectUnauthorized: false,
  });

const ENV_CONCURRENCY = 4;
const APP_CONCURRENCY = 4;
const CPS_CONCURRENCY = 4;

const asString = (value) => {
  if (
    value === undefined ||
    value === null
  ) {
    return '';
  }

  return String(value).trim();
};

const firstValue = (...values) =>
  values.find(
    (value) =>
      value !== undefined &&
      value !== null &&
      String(value).trim() !== ''
  );

function mapWithConcurrency(
  items,
  limit,
  worker
) {
  const results =
    new Array(items.length);

  let cursor = 0;

  async function runner() {
    while (true) {
      const index = cursor++;

      if (index >= items.length) {
        return;
      }

      try {
        results[index] =
          await worker(
            items[index],
            index
          );
      } catch (error) {
        results[index] = {
          __error: error,
        };
      }
    }
  }

  const workers = Array.from(
    {
      length: Math.min(
        limit,
        Math.max(
          items.length,
          1
        )
      ),
    },
    () => runner()
  );

  return Promise.all(workers)
    .then(() => results);
}

function normalizeEnvironment(
  environment
) {
  return {
    bgId: asString(
      environment?.bgId
    ),

    envId: asString(
      environment?.envId
    ),

    envName:
      asString(
        environment?.envName
      ) ||
      asString(
        environment?.name
      ) ||
      asString(
        environment?.environmentName
      ),
  };
}

function validateEnvironmentScopes(
  environments
) {
  if (!Array.isArray(environments)) {
    return [];
  }

  const seen = new Set();

  return environments
    .map(normalizeEnvironment)
    .filter(
      (scope) =>
        scope.bgId &&
        scope.envId
    )
    .filter((scope) => {
      const key =
        `${scope.bgId}:${scope.envId}`;

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);

      return true;
    });
}

function extractCh1Apps(data) {
  if (Array.isArray(data)) {
    return data;
  }

  if (
    Array.isArray(
      data?.applications
    )
  ) {
    return data.applications;
  }

  if (
    Array.isArray(data?.items)
  ) {
    return data.items;
  }

  if (
    Array.isArray(data?.data)
  ) {
    return data.data;
  }

  return [];
}

function extractAppIdentity(
  app,
  deploymentType,
  scope
) {
  if (
    deploymentType ===
    'CloudHub 2.0'
  ) {
    const id = firstValue(
      app?.id,
      app?.deploymentId,
      app?.applicationId
    );

    const name = firstValue(
      app?.name,
      app?.application?.name,
      app?.artifact?.name,
      app?.deployment?.name,
      id
    );

    return {
      id: asString(id),
      name: asString(name),
      deploymentType,
      bgId: scope.bgId,
      envId: scope.envId,
      environment:
        scope.envName,
      raw: app,
    };
  }

  const name = firstValue(
    app?.name,
    app?.applicationName,
    app?.domain,
    app?.artifactName,
    app?.id
  );

  return {
    id: asString(name),
    name: asString(name),
    deploymentType,
    bgId: scope.bgId,
    envId: scope.envId,
    environment:
      scope.envName,
    raw: app,
  };
}

async function discoverAppsForEnvironment(
  client,
  scope
) {
  const apps = [];
  const failures = [];

  const [
    ch2Result,
    ch1Result,
  ] = await Promise.allSettled([
    client.get(
      `/amc/application-manager/api/v2/organizations/${encodeURIComponent(
        scope.bgId
      )}/environments/${encodeURIComponent(
        scope.envId
      )}/deployments`,
      {
        params: {
          limit: 500,
          offset: 0,
        },
      }
    ),

    client.get(
      '/cloudhub/api/applications',
      {
        headers:
          makeCh1Headers(
            scope.envId,
            scope.bgId
          ),
      }
    ),
  ]);

  if (
    ch2Result.status ===
    'fulfilled'
  ) {
    const ch2Apps =
      parseCH2Apps(
        ch2Result.value.data
      );

    for (
      const app of ch2Apps
    ) {
      const identity =
        extractAppIdentity(
          app,
          'CloudHub 2.0',
          scope
        );

      if (identity.id) {
        apps.push(identity);
      }
    }
  } else {
    failures.push({
      stage:
        'application-discovery',
      deploymentType:
        'CloudHub 2.0',
      bgId:
        scope.bgId,
      envId:
        scope.envId,
      environment:
        scope.envName,
      message:
        ch2Result.reason
          ?.message ||
        'Failed to fetch CH2 applications',
    });
  }

  if (
    ch1Result.status ===
    'fulfilled'
  ) {
    const ch1Apps =
      extractCh1Apps(
        ch1Result.value.data
      );

    for (
      const app of ch1Apps
    ) {
      const identity =
        extractAppIdentity(
          app,
          'CloudHub 1.0',
          scope
        );

      if (identity.id) {
        apps.push(identity);
      }
    }
  } else {
    failures.push({
      stage:
        'application-discovery',
      deploymentType:
        'CloudHub 1.0',
      bgId:
        scope.bgId,
      envId:
        scope.envId,
      environment:
        scope.envName,
      message:
        ch1Result.reason
          ?.message ||
        'Failed to fetch CH1 applications',
    });
  }

  return {
    apps,
    failures,
  };
}

async function fetchApplicationDetail(
  client,
  app
) {
  try {
    if (
      app.deploymentType ===
      'CloudHub 2.0'
    ) {
      const response =
        await client.get(
          `/amc/application-manager/api/v2/organizations/${encodeURIComponent(
            app.bgId
          )}/environments/${encodeURIComponent(
            app.envId
          )}/deployments/${encodeURIComponent(
            app.id
          )}`
        );

      return (
        response.data ||
        app.raw ||
        app
      );
    }

    const response =
      await client.get(
        `/cloudhub/api/applications/${encodeURIComponent(
          app.id
        )}`,
        {
          headers:
            makeCh1Headers(
              app.envId,
              app.bgId
            ),
        }
      );

    return (
      response.data ||
      app.raw ||
      app
    );
  } catch (error) {
    return (
      app.raw ||
      app
    );
  }
}

function extractRuntimeProperties(
  detail,
  app
) {
  const deploymentSettings =
    detail?.target
      ?.deploymentSettings ||
    detail?.deploymentSettings ||
    {};

  const applicationConfiguration =
    detail?.application
      ?.configuration ||
    {};

  const propertiesService =
    applicationConfiguration[
      'mule.agent.application.properties.service'
    ] || {};

  return {
    ...(propertiesService.properties ||
      {}),

    ...(deploymentSettings.properties ||
      {}),

    ...(deploymentSettings.environmentVariables ||
      {}),

    ...(deploymentSettings.environmentVars ||
      {}),

    ...(detail?.properties ||
      {}),

    ...(app?.properties ||
      {}),
  };
}

function normalizeCpsResponse(
  data,
  projectName
) {
  if (!data) {
    return {};
  }

  if (Array.isArray(data)) {
    const match =
      data.find(
        (item) =>
          item?.key ===
          projectName
      ) ||
      data[0];

    const properties =
      match?.properties ||
      match;

    return properties &&
      typeof properties ===
        'object' &&
      !Array.isArray(
        properties
      )
      ? properties
      : {};
  }

  if (
    Array.isArray(
      data.responses
    )
  ) {
    const match =
      data.responses.find(
        (item) =>
          item?.key ===
          projectName
      ) ||
      data.responses[0];

    const properties =
      match?.properties;

    if (
      properties &&
      typeof properties ===
        'object' &&
      !Array.isArray(
        properties
      )
    ) {
      return properties;
    }
  }

  if (
    Array.isArray(
      data.properties
    )
  ) {
    const match =
      data.properties.find(
        (item) =>
          item?.key ===
          projectName
      ) ||
      data.properties[0];

    const properties =
      match?.properties ||
      match;

    if (
      properties &&
      typeof properties ===
        'object' &&
      !Array.isArray(
        properties
      )
    ) {
      return properties;
    }
  }

  if (
    typeof data ===
      'object' &&
    !Array.isArray(data)
  ) {
    const first =
      Object.values(data)[0];

    if (
      first &&
      typeof first ===
        'object' &&
      !Array.isArray(first)
    ) {
      return first;
    }

    return data;
  }

  return {};
}

async function fetchCpsProperties(
  req,
  {
    baseUrl,
    environment,
    envName,
    deploymentType,
    bgOrgId,
    projectName,
  }
) {
  if (
    !baseUrl ||
    !projectName
  ) {
    return {
      properties: {},
      configured: false,
      reason:
        'CPS configuration is incomplete',
    };
  }

  const envType =
    detectEnvType(
      baseUrl,
      environment,
      envName
    );

  const chType =
    detectChType(
      deploymentType
    );

  const credentials =
    getCredentials(
      req,
      baseUrl,
      bgOrgId,
      envType,
      chType
    );

  if (!credentials) {
    return {
      properties: {},
      configured: false,
      reason:
        'CPS credentials not configured',
    };
  }

  const cleanBaseUrl =
    normaliseUrl(
      baseUrl
    );

  const fullUrl =
    `${cleanBaseUrl}/api/v2/properties/non-secure`;

  const params = {
    keys: projectName,
  };

  if (environment) {
    params.environment =
      environment;
  }

  try {
    let response =
      await axios.get(
        fullUrl,
        {
          headers: {
            client_id:
              credentials.clientId,
            client_secret:
              credentials.clientSecret,
            'Content-Type':
              'application/json',
          },
          params,
          timeout: 15000,
          httpsAgent:
            dependencyHttpsAgent,
          validateStatus:
            () => true,
        }
      );

    const denied =
      response.status === 401 ||
      (
        response.status === 200 &&
        Array.isArray(
          response.data?.responses
        ) &&
        response.data.responses.some(
          (item) =>
            typeof item?.properties ===
            'string'
        )
      );

    if (denied) {
      const sessionCreds =
        req.session?.cpsCreds ||
        {};

      const prefix =
        `${cleanBaseUrl}::`;

      const alternatives =
        Object.entries(
          sessionCreds
        )
          .filter(
            ([key, value]) =>
              key.startsWith(
                prefix
              ) &&
              value?.clientId &&
              value?.clientSecret &&
              value.clientId !==
                credentials.clientId
          )
          .map(
            ([, value]) =>
              value
          );

      for (
        const alternate of
          alternatives
      ) {
        const retry =
          await axios.get(
            fullUrl,
            {
              headers: {
                client_id:
                  alternate.clientId,
                client_secret:
                  alternate.clientSecret,
                'Content-Type':
                  'application/json',
              },
              params,
              timeout: 15000,
              httpsAgent:
                dependencyHttpsAgent,
              validateStatus:
                () => true,
            }
          );

        const usable =
          retry.status >= 200 &&
          retry.status < 300 &&
          !(
            Array.isArray(
              retry.data?.responses
            ) &&
            retry.data.responses.some(
              (item) =>
                typeof item?.properties ===
                'string'
            )
          );

        if (usable) {
          response =
            retry;
          break;
        }
      }
    }

    if (
      response.status < 200 ||
      response.status >= 300
    ) {
      return {
        properties: {},
        configured: true,
        reason:
          `CPS returned HTTP ${response.status}`,
      };
    }

    return {
      properties:
        normalizeCpsResponse(
          response.data,
          projectName
        ),

      configured: true,
      reason: '',
    };
  } catch (error) {
    return {
      properties: {},
      configured: true,
      reason:
        error.message ||
        'CPS request failed',
    };
  }
}

function classifyApplication(appName) {
  const name = asString(appName).toLowerCase();

  // XAPI
  if (
    /(^|[-_.])xapi($|[-_.])/.test(name) ||
    name.endsWith('xapi')
  ) {
    return 'XAPI';
  }

  // PAPI
  if (
    /(^|[-_.])papi($|[-_.])/.test(name) ||
    name.endsWith('papi')
  ) {
    return 'PAPI';
  }

  // SAPI
  if (
    /(^|[-_.])sapi($|[-_.])/.test(name) ||
    name.endsWith('sapi')
  ) {
    return 'SAPI';
  }

  // JOB
  if (
    /(^|[-_.])job($|[-_.])/.test(name) ||
    name.endsWith('job')
  ) {
    return 'JOB';
  }

  // Nothing identifies the application type
  return 'UNKNOWN';
}

function normalizeComparable(
  value
) {
  return asString(value)
    .toLowerCase()
    .replace(
      /^https?:\/\//,
      ''
    )
    .replace(
      /\/.*$/,
      ''
    )
    .replace(
      /[^a-z0-9]/g,
      ''
    );
}

function normalizeAppName(
  name
) {
  return asString(name)
    .toLowerCase()
    .replace(
      /^https?:\/\//,
      ''
    )
    .replace(
      /[^a-z0-9]/g,
      '');
}

function valueContainsAppReference(
  value,
  targetApp
) {
  const normalizedValue =
    normalizeComparable(
      value
    );

  const normalizedTarget =
    normalizeAppName(
      targetApp.name
    );

  if (
    !normalizedValue ||
    !normalizedTarget
  ) {
    return false;
  }

  /*
   * Avoid very short application names
   * causing false-positive matches.
   */
  if (
    normalizedTarget.length <
    6
  ) {
    return false;
  }

  return normalizedValue.includes(
    normalizedTarget
  );
}

function extractDependencyEvidence(
  sourceApp,
  targetApps,
  runtimeProperties,
  cpsProperties
) {
  const dependencies = [];

  const propertyGroups = [
    {
      source:
        'RUNTIME_PROPERTY',

      properties:
        runtimeProperties,
    },

    {
      source:
        'CPS_NON_SECURE_PROPERTY',

      properties:
        cpsProperties,
    },
  ];

  for (
    const group of propertyGroups
  ) {
    for (
      const [
        key,
        rawValue,
      ] of Object.entries(
        group.properties ||
          {}
      )
    ) {
      if (
        rawValue ===
          undefined ||
        rawValue ===
          null
      ) {
        continue;
      }

      const value =
        String(rawValue);

      /*
       * Do not inspect very large
       * property values.
       */
      if (
        value.length >
        5000
      ) {
        continue;
      }

      for (
        const targetApp of
          targetApps
      ) {
        if (
          targetApp.id ===
            sourceApp.id &&
          targetApp.deploymentType ===
            sourceApp.deploymentType
        ) {
          continue;
        }

        if (
          targetApp.name ===
          sourceApp.name
        ) {
          continue;
        }

        if (
          valueContainsAppReference(
            value,
            targetApp
          )
        ) {
          dependencies.push({
            sourceApp:
              sourceApp.name,

            sourceType:
              classifyApplication(
                sourceApp.name
              ),

            targetApp:
              targetApp.name,

            targetType:
              classifyApplication(
                targetApp.name
              ),

            dependencyType:
              'CONFIGURATION_REFERENCE',

            evidenceSource:
              group.source,

            evidenceKey:
              key,

            evidenceValue:
              value,

            confidence:
              group.source ===
              'CPS_NON_SECURE_PROPERTY'
                ? 'HIGH'
                : 'MEDIUM',
          });
        }
      }
    }
  }

  return dependencies;
}

async function processApplication(
  req,
  client,
  app,
  allApps
) {
  const detail =
    await fetchApplicationDetail(
      client,
      app
    );

  const runtimeProperties =
    extractRuntimeProperties(
      detail,
      app
    );

  const cpsBaseUrl =
    firstValue(
      runtimeProperties[
        'cps.configServerBaseUrl'
      ],

      runtimeProperties[
        'config.server.base.url'
      ]
    );

  const projectName =
    firstValue(
      runtimeProperties[
        'cps.projectName'
      ],

      runtimeProperties[
        'cloudhub.api.name'
      ],

      app.name
    );

  const cpsEnvironment =
    firstValue(
      runtimeProperties[
        'cps.prefix'
      ],

      runtimeProperties[
        'cps.environment'
      ],

      runtimeProperties[
        'cps.environmentName'
      ],

      app.environment
    );

  let cpsResult = {
    properties: {},
    configured: false,
    reason:
      'CPS not configured',
  };

  if (cpsBaseUrl) {
    cpsResult =
      await fetchCpsProperties(
        req,
        {
          baseUrl:
            cpsBaseUrl,

          environment:
            cpsEnvironment,

          envName:
            app.environment,

          deploymentType:
            app.deploymentType,

          bgOrgId:
            app.bgId,

          projectName,
        }
      );
  }

  const dependencies =
    extractDependencyEvidence(
      app,
      allApps,
      runtimeProperties,
      cpsResult.properties
    );

  return {
    app: {
      id: app.id,
      name: app.name,
      deploymentType:
        app.deploymentType,
      bgId: app.bgId,
      envId: app.envId,
      environment:
        app.environment,

      type:
        classifyApplication(
          app.name
        ),

      cpsConfigured:
        cpsResult.configured,

      cpsPropertyCount:
        Object.keys(
          cpsResult.properties ||
            {}
        ).length,

      runtimePropertyCount:
        Object.keys(
          runtimeProperties ||
            {}
        ).length,
    },

    dependencies,
  };
}

function buildDependencyHierarchy(applications, dependencies) {
  const appMap = new Map();

  // Index every discovered application
  for (const app of applications || []) {
    const key = `${app.bgId || ''}:${app.envId || ''}:${app.deploymentType || ''}:${app.id || app.name}`;

    appMap.set(key, {
      ...app,
      children: [],
    });
  }

  // Map application names to all matching applications.
  // Names are used because dependency edges currently
  // identify sourceApp and targetApp by application name.
  const appsByName = new Map();

  for (const app of applications || []) {
    const name = String(app.name || '').toLowerCase();

    if (!name) {
      continue;
    }

    if (!appsByName.has(name)) {
      appsByName.set(name, []);
    }

    appsByName.get(name).push(app);
  }

  // Build source -> target adjacency map
  const dependencyMap = new Map();

  for (const dependency of dependencies || []) {
    const sourceName =
      String(dependency.sourceApp || '').toLowerCase();

    const targetName =
      String(dependency.targetApp || '').toLowerCase();

    if (!sourceName || !targetName) {
      continue;
    }

    if (!dependencyMap.has(sourceName)) {
      dependencyMap.set(sourceName, []);
    }

    const targets = dependencyMap.get(sourceName);

    const duplicate = targets.some(
      (existing) =>
        existing.targetApp === targetName
    );

    if (!duplicate) {
      targets.push({
        ...dependency,
        targetApp: targetName,
      });
    }
  }

  // Find applications that are targets of another application.
  const dependedOnNames = new Set();

  for (const dependency of dependencies || []) {
    const targetName =
      String(dependency.targetApp || '').toLowerCase();

    if (targetName) {
      dependedOnNames.add(targetName);
    }
  }

  // Applications that nobody depends on become hierarchy roots.
  const roots = [];

  for (const app of applications || []) {
    const appName =
      String(app.name || '').toLowerCase();

    if (!appName) {
      continue;
    }

    if (!dependedOnNames.has(appName)) {
      roots.push(app);
    }
  }

  function buildNode(app, level, path, visited) {
    const appName =
      String(app.name || '').toLowerCase();

    const node = {
      id: app.id,
      name: app.name,
      type: app.type || 'UNKNOWN',
      deploymentType: app.deploymentType,
      bgId: app.bgId,
      envId: app.envId,
      environment: app.environment,
      level,
      path: [...path, app.name],
      children: [],
    };

    // Prevent circular dependencies such as:
    // A -> B -> C -> A
    const currentPath = new Set(visited);
    currentPath.add(appName);

    const childDependencies =
      dependencyMap.get(appName) || [];

    for (const dependency of childDependencies) {
      const targetCandidates =
        appsByName.get(
          String(dependency.targetApp || '').toLowerCase()
        ) || [];

      for (const targetApp of targetCandidates) {
        const targetName =
          String(targetApp.name || '').toLowerCase();

        if (currentPath.has(targetName)) {
          continue;
        }

        const childNode = buildNode(
          targetApp,
          level + 1,
          [...path, app.name],
          currentPath
        );

        childNode.relationship =
          dependency.dependencyType || 'DEPENDS_ON';

        childNode.dependsOn = targetApp.name;

        childNode.dependency = {
          sourceApp: app.name,
          sourceType: app.type || 'UNKNOWN',
          targetApp: targetApp.name,
          targetType: targetApp.type || 'UNKNOWN',
          relationship:
            dependency.dependencyType || 'DEPENDS_ON',
          evidenceSource:
            dependency.evidenceSource || '',
          evidenceKey:
            dependency.evidenceKey || '',
          confidence:
            dependency.confidence || '',
        };

        node.children.push(childNode);
      }
    }

    return node;
  }

  return roots.map((root) =>
    buildNode(
      root,
      0,
      [],
      new Set()
    )
  );
}

async function discoverDependencies(
  req,
  client,
  scopes
) {
  const scopeResults =
    await mapWithConcurrency(
      scopes,
      ENV_CONCURRENCY,
      async (scope) =>
        discoverAppsForEnvironment(
          client,
          scope
        )
    );

  const allApps = [];
  const failures = [];

  for (
    const result of
      scopeResults
  ) {
    if (
      !result ||
      result.__error
    ) {
      failures.push({
        stage:
          'application-discovery',

        message:
          result?.__error
            ?.message ||
          'Environment processing failed',
      });

      continue;
    }

    allApps.push(
      ...result.apps
    );

    failures.push(
      ...result.failures
    );
  }

  const uniqueApps =
    Array.from(
      new Map(
        allApps.map(
          (app) => [
            `${app.bgId}:${app.envId}:${app.deploymentType}:${app.id}`,
            app,
          ]
        )
      ).values()
    );

  const results =
    await mapWithConcurrency(
      uniqueApps,
      APP_CONCURRENCY,
      async (app) =>
        processApplication(
          req,
          client,
          app,
          uniqueApps
        )
    );

  const applications = [];
  const dependencies = [];

  for (
    let index = 0;
    index <
    results.length;
    index += 1
  ) {
    const result =
      results[index];

    const app =
      uniqueApps[index];

    if (
      !result ||
      result.__error
    ) {
      failures.push({
        stage:
          'dependency-processing',

        appName:
          app?.name,

        environment:
          app?.environment,

        message:
          result?.__error
            ?.message ||
          'Dependency processing failed',
      });

      continue;
    }

    applications.push(
      result.app
    );

    dependencies.push(
      ...result.dependencies
    );
  }

  /*
   * Remove duplicate relationships.
   */
  const uniqueDependencies =
    Array.from(
      new Map(
        dependencies.map(
          (dependency) => [
            [
              dependency.sourceApp,
              dependency.targetApp,
              dependency.evidenceSource,
              dependency.evidenceKey,
            ].join('|'),

            dependency,
          ]
        )
      ).values()
    );

  const dependencyHierarchy =
  buildDependencyHierarchy(
    applications,
    uniqueDependencies
  );

  return {
    applications,
    dependencies: uniqueDependencies,
    dependencyHierarchy,
    failures,
  };
}

module.exports = {
  discoverDependencies,
  classifyApplication,
};