const express = require('express');

const router =
  express.Router();

const authMiddleware =
  require('../middleware/authMiddleware');

const {
  createClient,
} = require('../utils/anypointClient');

const {
  discoverDependencies,
  syncDependencyInventory,
} = require('../utils/dependencyHelpers');

function normalizeEnvironment(
  environment
) {
  return {
    bgId:
      environment?.bgId ||
      '',

    envId:
      environment?.envId ||
      '',

    envName:
      environment?.envName ||
      environment?.name ||
      environment?.environmentName ||
      '',
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

/*
 * POST /api/dependencies/discover
 *
 * Body:
 *
 * {
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
  '/discover',
  (req, res, next) => {
    console.info('[Dependencies] /discover request reached router', {
      method: req.method,
      body: req.body,
      hasSession: Boolean(req.session),
      hasToken: Boolean(req.anypointToken),
    });

    next();
  },
  authMiddleware,
  async (req, res) => {
    const startedAt =
      Date.now();

    try {
      const scopes =
        validateEnvironmentScopes(
          req.body?.environments
        );

      if (!scopes.length) {
        return res
          .status(400)
          .json({
            success: false,
            error:
              'At least one selected environment is required.',
          });
      }

      const client =
        createClient(
          req.anypointToken
        );

      console.info(
        '[Dependencies] Discovery started',
        {
          selectedScopes:
            scopes.length,
        }
      );

      const result =
        await discoverDependencies(
          req,
          client,
          scopes
        );

      const elapsedMs =
        Date.now() -
        startedAt;

      console.info(
        '[Dependencies] Discovery completed',
        {
          selectedScopes:
            scopes.length,

          applications:
            result.applications
              .length,

          dependencies:
            result.dependencies
              .length,

          failures:
            result.failures
              .length,

          elapsedMs,
        }
      );

      return res.json({
        success: true,

        data: {
          applications:
            result.applications,

          dependencies:
            result.dependencies,
        },

        meta: {
          selectedScopes:
            scopes.length,

          applicationsDiscovered:
            result.applications
              .length,

          dependenciesFound:
            result.dependencies
              .length,

          elapsedMs,
        },

        failures:
          result.failures,
      });
    } catch (error) {
      console.error(
        '[Dependencies] Fatal error',
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
            'Failed to discover application dependencies.',

          message:
            error.message,
        });
    }
  }
);


/**
 * POST /api/dependencies/sync
 *
 * Synchronizes the selected environments into the dependency database.
 * Uses the existing authentication and Anypoint client.
 */
router.post(
  '/sync',
  authMiddleware,
  async (req, res) => {
    const startedAt = Date.now();

    try {
      const scopes = validateEnvironmentScopes(
        req.body?.environments
      );

      if (!scopes.length) {
        return res.status(400).json({
          success: false,
          error:
            'At least one selected environment is required.',
        });
      }

      const client = createClient(req.anypointToken);

      console.info('[Dependencies] Inventory sync started', {
        selectedScopes: scopes.length,
      });

      const result = await syncDependencyInventory(
        req,
        client,
        scopes
      );

      const elapsedMs = Date.now() - startedAt;

      console.info('[Dependencies] Inventory sync completed', {
        syncRunId: result.syncRunId,
        status: result.status,
        applicationsDiscovered: result.applicationsDiscovered,
        applicationsSaved: result.applications,
        propertiesSaved: result.properties,
        failures: result.failures?.length || 0,
        elapsedMs,
      });

      const httpStatus =
        result.status === 'FAILED' ? 500 : 200;

      return res.status(httpStatus).json({
        success: result.status !== 'FAILED',
        data: {
          syncRunId: result.syncRunId,
          status: result.status,
          applicationsDiscovered:
            result.applicationsDiscovered,
          applicationsSaved: result.applications,
          propertiesSaved: result.properties,
          endpointsSaved: result.endpoints,
        },
        failures: result.failures || [],
        meta: {
          selectedScopes: scopes.length,
          elapsedMs,
        },
      });
    } catch (error) {
      console.error('[Dependencies] Inventory sync error', {
        message: error.message,
        stack: error.stack,
      });

      return res.status(500).json({
        success: false,
        error: 'Failed to synchronize dependency inventory.',
        message: error.message,
      });
    }
  }
);


module.exports = router;