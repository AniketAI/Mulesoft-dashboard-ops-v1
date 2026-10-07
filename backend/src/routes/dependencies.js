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

module.exports = router;