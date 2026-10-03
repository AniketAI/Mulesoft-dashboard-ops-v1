const express = require('express');
const axios = require('axios');
const router = express.Router();

const authMiddleware = require('../middleware/authMiddleware');
const { createClient } = require('../utils/anypointClient');
const {
  parseCH2Apps,
  makeCh1Headers,
} = require('../utils/appHelpers');

const cpsRoutes = require('./cps');

const ENV_CONCURRENCY = 4;
const APP_CONCURRENCY = 4;
const CPS_CONCURRENCY = 4;

const cpsHelpers = cpsRoutes._cpsHelpers;

const asString = (value) =>
  value === undefined || value === null
    ? ''
    : String(value).trim();

const firstValue = (...values) =>
  values.find(
    (value) =>
      value !== undefined &&
      value !== null &&
      String(value).trim() !== ''
  );

const normalizeJobName = (value) =>
  asString(value)
    .replace(/\s+/g, ' ')
    .toLowerCase();

const extractSchedulers = (data) => {
  if (Array.isArray(data)) return data;

  if (Array.isArray(data?.schedulers)) {
    return data.schedulers;
  }

  if (Array.isArray(data?.schedules)) {
    return data.schedules;
  }

  if (Array.isArray(data?.items)) {
    return data.items;
  }

  if (Array.isArray(data?.data)) {
    return data.data;
  }

  return [];
};

const extractCh1Apps = (data) => {
  if (Array.isArray(data)) return data;

  if (Array.isArray(data?.applications)) {
    return data.applications;
  }

  if (Array.isArray(data?.items)) {
    return data.items;
  }

  if (Array.isArray(data?.data)) {
    return data.data;
  }

  return [];
};

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);

  let cursor = 0;

  async function runner() {
    while (true) {
      const index = cursor++;

      if (index >= items.length) {
        return;
      }

      try {
        results[index] = await worker(items[index], index);
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
        Math.max(items.length, 1)
      ),
    },
    () => runner()
  );

  await Promise.all(workers);

  return results;
}

function normalizeEnvironment(environment) {
  return {
    bgId: asString(environment?.bgId),
    envId: asString(environment?.envId),

    envName:
      asString(environment?.envName) ||
      asString(environment?.name) ||
      asString(environment?.environmentName),
  };
}

function validateEnvironmentScopes(environments) {
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
      environment: scope.envName,
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
    environment: scope.envName,
    raw: app,
  };
}

async function fetchEnvironmentApps(
  client,
  scope
) {
  const output = [];
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
        headers: makeCh1Headers(
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
    const apps =
      parseCH2Apps(
        ch2Result.value.data
      );

    for (const app of apps) {
      const identity =
        extractAppIdentity(
          app,
          'CloudHub 2.0',
          scope
        );

      if (identity.id) {
        output.push(identity);
      }
    }
  } else {
    failures.push({
      stage:
        'application-discovery',
      deploymentType:
        'CloudHub 2.0',
      bgId: scope.bgId,
      envId: scope.envId,
      environment:
        scope.envName,
      message:
        ch2Result.reason?.message ||
        'Failed to fetch CH2 applications',
    });
  }

  if (
    ch1Result.status ===
    'fulfilled'
  ) {
    const apps =
      extractCh1Apps(
        ch1Result.value.data
      );

    for (const app of apps) {
      const identity =
        extractAppIdentity(
          app,
          'CloudHub 1.0',
          scope
        );

      if (identity.id) {
        output.push(identity);
      }
    }
  } else {
    failures.push({
      stage:
        'application-discovery',
      deploymentType:
        'CloudHub 1.0',
      bgId: scope.bgId,
      envId: scope.envId,
      environment:
        scope.envName,
      message:
        ch1Result.reason?.message ||
        'Failed to fetch CH1 applications',
    });
  }

  return {
    apps: output,
    failures,
  };
}

/*
 * Extract runtime/application properties from
 * the application detail response.
 */
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
    ...(propertiesService.properties || {}),
    ...(deploymentSettings.properties || {}),
    ...(deploymentSettings.environmentVariables || {}),
    ...(deploymentSettings.environmentVars || {}),
    ...(detail?.properties || {}),
    ...(app?.properties || {}),
  };
}

/*
 * Resolve:
 *
 * ${property.name}
 *
 * from runtime properties first,
 * then CPS non-secure properties.
 */
function resolveCronExpression(
  rawCron,
  runtimeProps = {},
  cpsProps = {}
) {
  if (!rawCron) {
    return '';
  }

  return String(rawCron).replace(
    /\$\{([^}]+)\}/g,
    (match, key) => {
      const value =
        runtimeProps[key] ??
        runtimeProps[key.toLowerCase()] ??
        cpsProps[key] ??
        cpsProps[key.toLowerCase()];

      return value !== undefined &&
        value !== null
        ? String(value)
        : match;
    }
  );
}

/*
 * CPS response → plain property map.
 */
function normalizeCpsResponse(
  data,
  projectName
) {
  if (!data) {
    return {};
  }

  if (
    Array.isArray(data)
  ) {
    const match =
      data.find(
        (item) =>
          item?.key ===
          projectName
      ) || data[0];

    const properties =
      match?.properties ||
      match;

    return properties &&
      typeof properties ===
        'object' &&
      !Array.isArray(properties)
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
      !Array.isArray(properties)
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
      !Array.isArray(properties)
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

/*
 * Direct CPS lookup.
 *
 * Important:
 * We do NOT call /api/cps/fetch over HTTP.
 * We reuse the existing CPS credential/session logic.
 */
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
  if (!baseUrl) {
    return {
      properties: {},
      configured: false,
      reason:
        'CPS base URL not configured',
    };
  }

  if (!projectName) {
    return {
      properties: {},
      configured: false,
      reason:
        'CPS project name not configured',
    };
  }

  const envType =
    cpsHelpers.detectEnvType(
      baseUrl,
      environment,
      envName
    );

  const chType =
    cpsHelpers.detectChType(
      deploymentType
    );

  const credentials =
    cpsHelpers.getCredentials(
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
    cpsHelpers.normaliseUrl(
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

  const makeRequest =
    async (
      clientId,
      clientSecret
    ) => {
      return axios.get(
        fullUrl,
        {
          headers: {
            client_id:
              clientId,
            client_secret:
              clientSecret,
            'Content-Type':
              'application/json',
          },
          params,
          timeout: 15000,
          httpsAgent:
            cpsHelpers.httpsAgent,
          validateStatus:
            () => true,
        }
      );
    };

  try {
    console.info(
      '[Helper/CPS] Fetching non-secure properties',
      {
        projectName,
        bgOrgId,
        deploymentType,
      }
    );

    let response =
      await makeRequest(
        credentials.clientId,
        credentials.clientSecret
      );

    /*
     * CPS can return HTTP 200 with
     * "COULD NOT ACCESS".
     */
    const hasNoAccess =
      (response.status ===
        401) ||
      (
        response.status ===
          200 &&
        Array.isArray(
          response.data?.responses
        ) &&
        response.data.responses.some(
          (item) =>
            typeof item?.properties ===
            'string'
        )
      );

    /*
     * If the primary credential fails,
     * try other credentials belonging
     * to this CPS server.
     */
    if (hasNoAccess) {
      const sessionCreds =
        req.session.cpsCreds ||
        {};

      const prefix =
        `${cleanBaseUrl}::`;

      const alternateCredentials =
        Object.entries(
          sessionCreds
        )
          .filter(
            ([key, value]) =>
              key.startsWith(prefix) &&
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
          alternateCredentials
      ) {
        const retry =
          await makeRequest(
            alternate.clientId,
            alternate.clientSecret
          );

        const usable =
          retry.status !==
            401 &&
          !(
            retry.status ===
              200 &&
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
          response = retry;

          if (bgOrgId) {
            req.session.cpsCreds[
              `${cleanBaseUrl}::${bgOrgId}`
            ] = {
              clientId:
                alternate.clientId,
              clientSecret:
                alternate.clientSecret,
            };
          }

          req.session.cpsCreds[
            cleanBaseUrl
          ] = {
            clientId:
              alternate.clientId,
            clientSecret:
              alternate.clientSecret,
          };

          break;
        }
      }
    }

    if (
      response.status <
        200 ||
      response.status >=
        300
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
    console.warn(
      '[Helper/CPS] Failed',
      {
        projectName,
        message:
          error.message,
      }
    );

    return {
      properties: {},
      configured: true,
      reason:
        error.message ||
        'CPS request failed',
    };
  }
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

      return response.data ||
        app.raw ||
        app;
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

    return response.data ||
      app.raw ||
      app;
  } catch (error) {
    console.warn(
      '[Helper] Application detail failed',
      {
        appName: app.name,
        deploymentType:
          app.deploymentType,
        message:
          error.message,
      }
    );

    return (
      app.raw ||
      app
    );
  }
}

async function fetchSchedulersForApp(
  req,
  client,
  app
) {
  try {
    const [
      detail,
      schedulerResponse,
    ] = await Promise.all([
      fetchApplicationDetail(
        client,
        app
      ),

      app.deploymentType ===
      'CloudHub 2.0'
        ? client.get(
            `/amc/application-manager/api/v2/organizations/${encodeURIComponent(
              app.bgId
            )}/environments/${encodeURIComponent(
              app.envId
            )}/deployments/${encodeURIComponent(
              app.id
            )}/schedulers`
          )
        : client.get(
            `/cloudhub/api/applications/${encodeURIComponent(
              app.id
            )}/schedules`,
            {
              headers:
                makeCh1Headers(
                  app.envId,
                  app.bgId
                ),
            }
          ),
    ]);

    const runtimeProps =
      extractRuntimeProperties(
        detail,
        app
      );

    const cpsBaseUrl =
      runtimeProps[
        'cps.configServerBaseUrl'
      ] ||
      runtimeProps[
        'config.server.base.url'
      ];

    const projectName =
      runtimeProps[
        'cps.projectName'
      ] ||
      runtimeProps[
        'cloudhub.api.name'
      ] ||
      app.name;

    const cpsEnvironment =
      runtimeProps[
        'cps.prefix'
      ] ||
      runtimeProps[
        'cps.environment'
      ] ||
      runtimeProps[
        'cps.environmentName'
      ] ||
      'uat';

    let cpsProperties = {};

    if (cpsBaseUrl) {
      const cpsResult =
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

      cpsProperties =
        cpsResult.properties;

      if (
        !cpsResult.configured
      ) {
        console.info(
          '[Helper/CPS] Not configured',
          {
            appName:
              app.name,
            reason:
              cpsResult.reason,
          }
        );
      }
    }

    const schedulers =
      extractSchedulers(
        schedulerResponse.data
      );

    return schedulers.map(
      (scheduler, index) => {
        const jobName =
          asString(
            firstValue(
              scheduler?.flow,
              scheduler?.flowName,
              scheduler?.name,
              scheduler?.schedulerName,
              `scheduler-${index + 1}`
            )
          );

        const rawCron =
          asString(
            firstValue(
              scheduler?.schedule
                ?.cronExpression,
              scheduler?.schedule
                ?.expression,
              scheduler?.expression,
              scheduler?.cronExpression
            )
          );

        const resolvedCron =
          resolveCronExpression(
            rawCron,
            runtimeProps,
            cpsProperties
          );

        const startTime =
          firstValue(
            scheduler?.startTime,
            scheduler?.startDate,
            scheduler?.startedAt,
            scheduler?.schedule
              ?.startTime,
            scheduler?.schedule
              ?.startDate
          );

        const nextExecution =
          firstValue(
            scheduler?.nextRun,
            scheduler?.nextExecution,
            scheduler?.schedule
              ?.nextRun,
            scheduler?.schedule
              ?.nextExecution,
            scheduler?.nextRunTime
          );

        return {
          id:
            `${app.deploymentType}:${app.bgId}:${app.envId}:${app.id}:${jobName}:${index}`,

          jobName,

          appName:
            app.name,

          application:
            app.name,

          environment:
            app.environment,

          environmentId:
            app.envId,

          businessGroupId:
            app.bgId,

          deploymentType:
            app.deploymentType,

          cron:
            resolvedCron,

          rawCron,

          decryptedCron: '',

          startTime:
            startTime ||
            null,

          nextExecution:
            nextExecution ||
            null,

          cpsResolved:
            resolvedCron !==
              rawCron,

          cpsProject:
            projectName,

          cpsEnvironment:
            cpsEnvironment,
        };
      }
    );
  } catch (error) {
    return {
      __error: error,
      rows: [],
    };
  }
}

/*
 * POST /api/helper/scheduler-details
 *
 * Body:
 *
 * {
 *   "jobNames": [
 *     "scheduler-name"
 *   ],
 *   "environments": [
 *     {
 *       "bgId": "...",
 *       "envId": "...",
 *       "envName": "Production"
 *     }
 *   ]
 * }
 */
router.post(
  '/scheduler-details',
  authMiddleware,
  async (req, res) => {
    const startedAt =
      Date.now();

    try {
      const client =
        createClient(
          req.anypointToken
        );

      const scopes =
        validateEnvironmentScopes(
          req.body?.environments
        );

      const requestedJobNames =
        Array.isArray(
          req.body?.jobNames
        )
          ? req.body.jobNames
              .map(
                normalizeJobName
              )
              .filter(Boolean)
          : [];

      const jobNameSet =
        requestedJobNames.length
          ? new Set(
              requestedJobNames
            )
          : null;

      console.info(
        '[Helper] Request received',
        {
          scopes:
            scopes.length,
          requestedJobs:
            requestedJobNames.length,
        }
      );

      if (!scopes.length) {
        return res
          .status(400)
          .json({
            error:
              'At least one selected environment is required.',
          });
      }

      /*
       * STEP 1
       * Discover applications only
       * inside the selected scopes.
       */
      const scopeResults =
        await mapWithConcurrency(
          scopes,
          ENV_CONCURRENCY,
          async (scope) => {
            const result =
              await fetchEnvironmentApps(
                client,
                scope
              );

            console.info(
              '[Helper] Scope complete',
              {
                bgId:
                  scope.bgId,
                envId:
                  scope.envId,
                envName:
                  scope.envName,
                applications:
                  result.apps.length,
              }
            );

            return {
              scope,
              ...result,
            };
          }
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

      /*
       * Remove duplicate deployments.
       */
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

      console.info(
        '[Helper] Applications discovered',
        {
          selectedScopes:
            scopes.length,
          uniqueApplications:
            uniqueApps.length,
        }
      );

      /*
       * STEP 2
       * Scheduler + application detail + CPS.
       */
      const appResults =
        await mapWithConcurrency(
          uniqueApps,
          APP_CONCURRENCY,
          async (app) =>
            fetchSchedulersForApp(
              req,
              client,
              app
            )
        );

      const rows = [];

      for (
        let index = 0;
        index <
        appResults.length;
        index += 1
      ) {
        const result =
          appResults[index];

        const app =
          uniqueApps[index];

        if (
          !result ||
          result.__error
        ) {
          failures.push({
            stage:
              'scheduler-discovery',
            appName:
              app.name,
            environment:
              app.environment,
            deploymentType:
              app.deploymentType,
            message:
              result?.__error
                ?.message ||
              'Scheduler processing failed',
          });

          continue;
        }

        const schedulerRows =
          Array.isArray(result)
            ? result
            : result.rows || [];

        const filtered =
          jobNameSet
            ? schedulerRows.filter(
                (row) =>
                  jobNameSet.has(
                    normalizeJobName(
                      row.jobName
                    )
                  )
              )
            : schedulerRows;

        rows.push(
          ...filtered
        );
      }

      /*
       * Explicitly return requested jobs
       * that were not found.
       */
      if (
        requestedJobNames.length
      ) {
        const foundNames =
          new Set(
            rows.map(
              (row) =>
                normalizeJobName(
                  row.jobName
                )
            )
          );

        for (
          const requestedName of
            requestedJobNames
        ) {
          if (
            foundNames.has(
              requestedName
            )
          ) {
            continue;
          }

          rows.push({
            id:
              `not-found:${requestedName}`,

            jobName:
              requestedName,

            appName:
              'Not found',

            application:
              'Not found',

            environment:
              scopes
                .map(
                  (scope) =>
                    scope.envName
                )
                .filter(Boolean)
                .join(', '),

            environmentId:
              '',

            businessGroupId:
              '',

            deploymentType:
              '',

            cron:
              '',

            rawCron:
              '',

            decryptedCron:
              '',

            startTime:
              null,

            nextExecution:
              null,

            cpsResolved:
              false,
          });
        }
      }

      const elapsedMs =
        Date.now() -
        startedAt;

      console.info(
        '[Helper] Completed',
        {
          applicationsChecked:
            uniqueApps.length,
          schedulerRows:
            rows.length,
          failures:
            failures.length,
          elapsedMs,
        }
      );

      return res.json({
        success: true,

        data: rows,

        meta: {
          selectedScopes:
            scopes.length,

          applicationsChecked:
            uniqueApps.length,

          schedulerRows:
            rows.length,

          requestedJobs:
            requestedJobNames.length,

          elapsedMs,
        },

        failures,
      });
    } catch (error) {
      console.error(
        '[Helper] Fatal error',
        {
          message:
            error.message,
          stack:
            error.stack,
        }
      );

      return res
        .status(500)
        .json({
          success: false,
          error:
            'Failed to resolve scheduler details.',
          message:
            error.message,
        });
    }
  }
);

module.exports = router;