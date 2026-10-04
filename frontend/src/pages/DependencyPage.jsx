import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  GitBranch,
  Loader2,
  Network,
  RefreshCw,
  Search,
  Server,
} from 'lucide-react';

import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import {
  getVisibleBgIds,
  getVisibleEnvIds,
} from '../utils/filterUtils';

const normalizeText = (value = '') =>
  String(value ?? '')
    .trim()
    .toLowerCase();

const typeStyles = {
  XAPI: {
    label:
      'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-500/10 dark:text-purple-300 dark:border-purple-500/20',
  },
  PAPI: {
    label:
      'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/20',
  },
  SAPI: {
    label:
      'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/20',
  },
  UNKNOWN: {
    label:
      'bg-gray-50 text-gray-600 border-gray-200 dark:bg-gray-500/10 dark:text-gray-300 dark:border-gray-500/20',
  },
};

function TypeBadge({ type }) {
  const normalized =
    String(type || 'UNKNOWN').toUpperCase();

  const style =
    typeStyles[normalized] ||
    typeStyles.UNKNOWN;

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold tracking-wide ${style.label}`}
    >
      {normalized}
    </span>
  );
}

function ConfidenceBadge({ confidence }) {
  const normalized =
    String(confidence || 'UNKNOWN').toUpperCase();

  const className =
    normalized === 'HIGH'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/20'
      : normalized === 'MEDIUM'
        ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/20'
        : 'bg-gray-50 text-gray-600 border-gray-200 dark:bg-gray-500/10 dark:text-gray-300 dark:border-gray-500/20';

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold ${className}`}
    >
      {normalized}
    </span>
  );
}

export default function DependencyPage() {
  const { orgId } = useAuth();

  const [envOptions, setEnvOptions] =
    useState([]);

  const [selectedEnvIds, setSelectedEnvIds] =
    useState([]);

  const [envLoading, setEnvLoading] =
    useState(false);

  const [envMenuOpen, setEnvMenuOpen] =
    useState(false);

  const [envSearch, setEnvSearch] =
    useState('');

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState('');

  const [failures, setFailures] =
    useState([]);

  const [applications, setApplications] =
    useState([]);

  const [dependencies, setDependencies] =
    useState([]);

  const [dependencySearch, setDependencySearch] =
    useState('');

  const [selectedType, setSelectedType] =
    useState('ALL');

  /*
   * ------------------------------------------------------------
   * LOAD ENVIRONMENTS
   *
   * This intentionally follows the same environment-scope
   * mechanism used by HelperPage.
   *
   * No bgId/envId is manually entered by the user.
   * ------------------------------------------------------------
   */
  useEffect(() => {
    if (!orgId) {
      return undefined;
    }

    let isMounted = true;

    const loadEnvironmentOptions = async () => {
      setEnvLoading(true);

      try {
        const visibleBgIds =
          getVisibleBgIds();

        const visibleEnvIds =
          getVisibleEnvIds();

        const groupResponse =
          await api.get(
            '/organizations/business-groups'
          );

        const groups =
          groupResponse?.data?.data ||
          groupResponse?.data?.businessGroups ||
          (
            Array.isArray(
              groupResponse?.data
            )
              ? groupResponse.data
              : []
          );

        if (!Array.isArray(groups)) {
          throw new Error(
            'Business Group API did not return an array.'
          );
        }

        const visibleGroups =
          visibleBgIds.size > 0
            ? groups.filter((group) => {
                const groupId =
                  group?.id ??
                  group?.orgId ??
                  group?.organizationId ??
                  group?.businessGroupId;

                return (
                  groupId != null &&
                  visibleBgIds.has(
                    String(groupId)
                  )
                );
              })
            : groups;

        const bgResults =
          await Promise.all(
            visibleGroups.map(
              async (group) => {
                const bgId =
                  group?.id ??
                  group?.orgId ??
                  group?.organizationId ??
                  group?.businessGroupId;

                const bgName =
                  group?.name ??
                  group?.organizationName ??
                  group?.businessGroupName ??
                  `Business Group ${bgId}`;

                if (bgId == null) {
                  return [];
                }

                try {
                  const response =
                    await api.get(
                      `/environments/${bgId}`
                    );

                  let environments =
                    response?.data?.data ||
                    response?.data?.environments ||
                    (
                      Array.isArray(
                        response?.data
                      )
                        ? response.data
                        : []
                    );

                  if (
                    !Array.isArray(
                      environments
                    ) &&
                    environments &&
                    typeof environments ===
                      'object'
                  ) {
                    environments =
                      environments.environments ||
                      environments.items ||
                      environments.data ||
                      [];
                  }

                  if (
                    !Array.isArray(
                      environments
                    )
                  ) {
                    return [];
                  }

                  return environments
                    .map(
                      (environment) => {
                        const envId =
                          environment?.id ??
                          environment?.environmentId ??
                          environment?.envId;

                        if (
                          envId == null
                        ) {
                          return null;
                        }

                        const envIdString =
                          String(envId);

                        const envName =
                          environment?.name ??
                          environment?.environmentName ??
                          `Environment ${envIdString}`;

                        const envType =
                          environment?.type ??
                          environment?.environmentType ??
                          environment?.environment?.type ??
                          'unknown';

                        return {
                          id:
                            envIdString,

                          key:
                            `${String(bgId)}:${envIdString}`,

                          name:
                            String(envName),

                          type:
                            String(envType),

                          bgId:
                            String(bgId),

                          bgName:
                            String(bgName),
                        };
                      }
                    )
                    .filter(Boolean);
                } catch (environmentError) {
                  console.error(
                    `[DependencyPage] Failed to load environments for BG ${bgId}:`,
                    environmentError
                  );

                  return [];
                }
              }
            )
          );

        const allEnvironmentOptions =
          bgResults.flat();

        /*
         * Apply the same top-navbar environment
         * visibility rules as HelperPage.
         */
        const environmentOptions =
          visibleEnvIds.size > 0
            ? allEnvironmentOptions.filter(
                (environment) =>
                  visibleEnvIds.has(
                    String(
                      environment.id
                    )
                  )
              )
            : allEnvironmentOptions;

        if (!isMounted) {
          return;
        }

        setEnvOptions(
          environmentOptions
        );

        /*
         * Important:
         * Do not automatically select everything.
         * User explicitly chooses dependency scope.
         */
        setSelectedEnvIds([]);

      } catch (loadError) {
        console.error(
          '[DependencyPage] Failed to load environments:',
          loadError
        );

        if (isMounted) {
          setEnvOptions([]);
          setSelectedEnvIds([]);
          setError(
            'Failed to load the available environments.'
          );
        }
      } finally {
        if (isMounted) {
          setEnvLoading(false);
        }
      }
    };

    loadEnvironmentOptions();

    const handleGlobalScopeChanged =
      () => {
        loadEnvironmentOptions();
      };

    window.addEventListener(
      'bgFilterChanged',
      handleGlobalScopeChanged
    );

    window.addEventListener(
      'envFilterChanged',
      handleGlobalScopeChanged
    );

    return () => {
      isMounted = false;

      window.removeEventListener(
        'bgFilterChanged',
        handleGlobalScopeChanged
      );

      window.removeEventListener(
        'envFilterChanged',
        handleGlobalScopeChanged
      );
    };
  }, [orgId]);

  /*
   * ------------------------------------------------------------
   * ENVIRONMENT SELECTION
   * ------------------------------------------------------------
   */

  const filteredEnvOptions =
    useMemo(() => {
      const query =
        envSearch
          .trim()
          .toLowerCase();

      if (!query) {
        return envOptions;
      }

      return envOptions.filter(
        (environment) =>
          environment.name
            .toLowerCase()
            .includes(query) ||
          environment.bgName
            .toLowerCase()
            .includes(query) ||
          environment.type
            .toLowerCase()
            .includes(query)
      );
    }, [
      envOptions,
      envSearch,
    ]);

  const groupedEnvOptions =
    useMemo(() => {
      const groups = new Map();

      for (
        const environment of
          filteredEnvOptions
      ) {
        if (
          !groups.has(
            environment.bgName
          )
        ) {
          groups.set(
            environment.bgName,
            []
          );
        }

        groups
          .get(
            environment.bgName
          )
          .push(environment);
      }

      return Array.from(
        groups.entries()
      );
    }, [
      filteredEnvOptions,
    ]);

  const selectedEnvNames =
    envOptions
      .filter((environment) =>
        selectedEnvIds.includes(
          environment.key
        )
      )
      .map(
        (environment) =>
          environment.name
      );

  const selectedEnvSummary =
    selectedEnvNames.length === 0
      ? 'Select environment'
      : selectedEnvNames.length ===
          envOptions.length &&
        envOptions.length > 0
        ? 'All environments'
        : selectedEnvNames.length >
            2
          ? `${selectedEnvNames.slice(0, 2).join(', ')}, +${selectedEnvNames.length - 2}`
          : selectedEnvNames.join(
              ', '
            );

  const handleEnvToggle =
    (envKey) => {
      setSelectedEnvIds(
        (previous) => {
          if (
            previous.includes(
              envKey
            )
          ) {
            return previous.filter(
              (key) =>
                key !== envKey
            );
          }

          return [
            ...previous,
            envKey,
          ];
        }
      );
    };

  const handleSelectAll =
    () => {
      setSelectedEnvIds(
        envOptions.map(
          (environment) =>
            environment.key
        )
      );
    };

  const handleClearAll =
    () => {
      setSelectedEnvIds([]);
    };

  /*
   * ------------------------------------------------------------
   * DEPENDENCY DISCOVERY
   * ------------------------------------------------------------
   */

  const handleGetDependencies =
    async () => {
      if (
        selectedEnvIds.length === 0
      ) {
        setError(
          'Please select at least one environment.'
        );
        return;
      }

      setLoading(true);
      setError('');
      setFailures([]);
      setApplications([]);
      setDependencies([]);

      try {
        /*
         * Convert the UI selection:
         *
         * BG_ID:ENV_ID
         *
         * into the backend environment objects.
         */
        const environments =
          envOptions
            .filter(
              (environment) =>
                selectedEnvIds.includes(
                  environment.key
                )
            )
            .map(
              (environment) => ({
                bgId:
                  environment.bgId,

                envId:
                  environment.id,

                envName:
                  environment.name,
              })
            );

        console.info(
          '[DependencyPage] Starting dependency discovery:',
          environments
        );

        const response =
          await api.post(
            '/dependencies/discover',
            {
              environments,
            }
          );

        const responseData =
          response?.data || {};

        const result =
          responseData?.data ||
          {};

        const nextApplications =
          Array.isArray(
            result.applications
          )
            ? result.applications
            : [];

        const nextDependencies =
          Array.isArray(
            result.dependencies
          )
            ? result.dependencies
            : [];

        const nextFailures =
          Array.isArray(
            responseData.failures
          )
            ? responseData.failures
            : [];

        setApplications(
          nextApplications
        );

        setDependencies(
          nextDependencies
        );

        setFailures(
          nextFailures
        );

        if (
          nextApplications.length ===
            0 &&
          nextDependencies.length ===
            0
        ) {
          setError(
            'No application dependency information was discovered for the selected environments.'
          );
        }

        console.info(
          '[DependencyPage] Dependency discovery completed:',
          {
            applications:
              nextApplications.length,

            dependencies:
              nextDependencies.length,

            failures:
              nextFailures.length,

            meta:
              responseData.meta,
          }
        );
      } catch (requestError) {
        console.error(
          '[DependencyPage] Dependency discovery failed:',
          requestError
        );

        setError(
          requestError?.response?.data?.message ||
          requestError?.response?.data?.error ||
          'Failed to discover application dependencies.'
        );
      } finally {
        setLoading(false);
      }
    };

  /*
   * ------------------------------------------------------------
   * FILTER DEPENDENCIES
   * ------------------------------------------------------------
   */

  const filteredDependencies =
    useMemo(() => {
      const query =
        normalizeText(
          dependencySearch
        );

      return dependencies.filter(
        (dependency) => {
          const matchesSearch =
            !query ||
            normalizeText(
              dependency.sourceApp
            ).includes(query) ||
            normalizeText(
              dependency.targetApp
            ).includes(query) ||
            normalizeText(
              dependency.evidenceKey
            ).includes(query);

          const matchesType =
            selectedType ===
              'ALL' ||
            String(
              dependency.sourceType ||
              'UNKNOWN'
            ).toUpperCase() ===
              selectedType ||
            String(
              dependency.targetType ||
              'UNKNOWN'
            ).toUpperCase() ===
              selectedType;

          return (
            matchesSearch &&
            matchesType
          );
        }
      );
    }, [
      dependencies,
      dependencySearch,
      selectedType,
    ]);

  const applicationTypeCounts =
    useMemo(() => {
      const counts = {
        XAPI: 0,
        PAPI: 0,
        SAPI: 0,
        UNKNOWN: 0,
      };

      for (
        const application of
          applications
      ) {
        const type =
          String(
            application.type ||
              'UNKNOWN'
          ).toUpperCase();

        if (
          Object.prototype.hasOwnProperty.call(
            counts,
            type
          )
        ) {
          counts[type] += 1;
        } else {
          counts.UNKNOWN += 1;
        }
      }

      return counts;
    }, [
      applications,
    ]);

  return (
    <div className="h-full flex flex-col overflow-hidden bg-gray-50/60 dark:bg-gray-950">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-gray-200/70 dark:border-white/[0.06] bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl">
        <div className="px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-sf-600 text-white flex items-center justify-center shadow-lg shadow-sf-500/20">
                  <Network
                    size={20}
                  />
                </div>

                <div>
                  <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                    API Dependency Mapping
                  </h1>

                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    Discover relationships between XAPI,
                    PAPI, SAPI and other Mule applications.
                  </p>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={
                handleGetDependencies
              }
              disabled={
                loading ||
                selectedEnvIds.length ===
                  0
              }
              className="inline-flex items-center gap-2 rounded-xl bg-sf-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-sf-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? (
                <Loader2
                  size={15}
                  className="animate-spin"
                />
              ) : (
                <GitBranch
                  size={15}
                />
              )}

              {loading
                ? 'Discovering...'
                : 'Get Dependencies'}
            </button>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-[1600px] mx-auto space-y-5">
          {/* Environment selector */}
          <div className="rounded-2xl border border-gray-200/80 bg-white shadow-sm dark:border-white/[0.06] dark:bg-gray-900">
            <div className="p-5">
              <div className="flex items-center justify-between gap-4 mb-3">
                <div>
                  <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100">
                    Environment Scope
                  </h2>

                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Select the environments where dependency discovery should run.
                  </p>
                </div>

                <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400">
                  {selectedEnvIds.length}/
                  {envOptions.length} selected
                </span>
              </div>

              <div className="relative">
                <button
                  type="button"
                  onClick={() =>
                    setEnvMenuOpen(
                      (value) =>
                        !value
                    )
                  }
                  disabled={
                    envLoading
                  }
                  className="w-full flex items-center justify-between rounded-xl border border-gray-200 bg-white px-3.5 py-3 text-left text-sm text-gray-700 shadow-sm hover:border-sf-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                >
                  <span className="truncate">
                    {envLoading
                      ? 'Loading environments...'
                      : selectedEnvSummary}
                  </span>

                  <ChevronDown
                    size={16}
                    className="flex-shrink-0 text-gray-400"
                  />
                </button>

                {envMenuOpen && (
                  <div className="absolute z-30 mt-2 w-full rounded-xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900">
                    <div className="p-3 border-b border-gray-100 dark:border-gray-800">
                      <div className="relative">
                        <Search
                          size={14}
                          className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                        />

                        <input
                          type="text"
                          value={
                            envSearch
                          }
                          onChange={(event) =>
                            setEnvSearch(
                              event.target
                                .value
                            )
                          }
                          placeholder="Search environments..."
                          className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-9 pr-3 text-xs outline-none focus:border-sf-400 dark:border-gray-700 dark:bg-gray-800"
                        />
                      </div>

                      <div className="flex items-center gap-2 mt-2">
                        <button
                          type="button"
                          onClick={
                            handleSelectAll
                          }
                          className="rounded-lg border border-gray-200 px-2.5 py-1 text-[10px] font-semibold text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                        >
                          Select All
                        </button>

                        <button
                          type="button"
                          onClick={
                            handleClearAll
                          }
                          className="rounded-lg border border-gray-200 px-2.5 py-1 text-[10px] font-semibold text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                        >
                          Clear
                        </button>
                      </div>
                    </div>

                    <div className="max-h-72 overflow-auto p-2">
                      {groupedEnvOptions.length ===
                      0 ? (
                        <div className="px-3 py-6 text-center text-xs text-gray-400">
                          No environments available.
                        </div>
                      ) : (
                        groupedEnvOptions.map(
                          ([
                            bgName,
                            environments,
                          ]) => (
                            <div
                              key={
                                bgName
                              }
                              className="mb-3 last:mb-0"
                            >
                              <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">
                                {bgName}
                              </div>

                              {environments.map(
                                (
                                  environment
                                ) => {
                                  const active =
                                    selectedEnvIds.includes(
                                      environment.key
                                    );

                                  return (
                                    <button
                                      type="button"
                                      key={
                                        environment.key
                                      }
                                      onClick={() =>
                                        handleEnvToggle(
                                          environment.key
                                        )
                                      }
                                      className={`w-full flex items-center justify-between rounded-lg px-3 py-2 text-left transition ${
                                        active
                                          ? 'bg-sf-50 dark:bg-sf-500/10'
                                          : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                                      }`}
                                    >
                                      <div className="min-w-0">
                                        <div className="text-xs font-semibold text-gray-800 dark:text-gray-200 truncate">
                                          {
                                            environment.name
                                          }
                                        </div>

                                        <div className="text-[10px] text-gray-400 mt-0.5">
                                          {
                                            environment.type
                                          }
                                        </div>
                                      </div>

                                      <div
                                        className={`w-4 h-4 rounded border flex items-center justify-center ${
                                          active
                                            ? 'border-sf-600 bg-sf-600'
                                            : 'border-gray-300 dark:border-gray-600'
                                        }`}
                                      >
                                        {active && (
                                          <span className="text-white text-[9px] font-bold">
                                            ✓
                                          </span>
                                        )}
                                      </div>
                                    </button>
                                  );
                                }
                              )}
                            </div>
                          )
                        )
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
              <AlertCircle
                size={17}
                className="mt-0.5 flex-shrink-0"
              />

              <span>
                {error}
              </span>
            </div>
          )}

          {/* Failures */}
          {failures.length >
            0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/20 dark:bg-amber-500/10">
              <div className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
                <AlertCircle
                  size={16}
                />
                Some applications could not be processed
              </div>

              <div className="mt-2 space-y-1">
                {failures
                  .slice(0, 8)
                  .map(
                    (
                      failure,
                      index
                    ) => (
                      <div
                        key={`${failure.appName || 'failure'}-${index}`}
                        className="text-xs text-amber-700 dark:text-amber-300"
                      >
                        {failure.appName
                          ? `${failure.appName}: `
                          : ''}
                        {failure.message ||
                          'Unknown error'}
                      </div>
                    )
                  )}
              </div>
            </div>
          )}

          {/* Summary */}
          {(applications.length >
            0 ||
            dependencies.length >
              0) && (
            <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
              <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-white/[0.06] dark:bg-gray-900">
                <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                  Applications
                </div>
                <div className="mt-1 text-xl font-bold text-gray-900 dark:text-gray-100">
                  {
                    applications.length
                  }
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-white/[0.06] dark:bg-gray-900">
                <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                  Dependencies
                </div>
                <div className="mt-1 text-xl font-bold text-gray-900 dark:text-gray-100">
                  {
                    dependencies.length
                  }
                </div>
              </div>

              {[
                'XAPI',
                'PAPI',
                'SAPI',
                'UNKNOWN',
              ].map(
                (type) => (
                  <div
                    key={type}
                    className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-white/[0.06] dark:bg-gray-900"
                  >
                    <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                      {type}
                    </div>

                    <div className="mt-1 text-xl font-bold text-gray-900 dark:text-gray-100">
                      {
                        applicationTypeCounts[
                          type
                        ]
                      }
                    </div>
                  </div>
                )
              )}
            </div>
          )}

          {/* Applications */}
          {applications.length >
            0 && (
            <div className="rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-white/[0.06] dark:bg-gray-900">
              <div className="border-b border-gray-100 px-5 py-4 dark:border-gray-800">
                <div className="flex items-center gap-2">
                  <Server
                    size={16}
                    className="text-sf-600"
                  />

                  <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100">
                    Discovered Applications
                  </h2>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-gray-100 dark:border-gray-800">
                      <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-wider text-gray-400">
                        Application
                      </th>

                      <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-wider text-gray-400">
                        Type
                      </th>

                      <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-wider text-gray-400">
                        Environment
                      </th>

                      <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-wider text-gray-400">
                        CPS
                      </th>

                      <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-wider text-gray-400">
                        Properties
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {applications.map(
                      (
                        application,
                        index
                      ) => (
                        <tr
                          key={`${application.id || application.name}-${application.envId}-${index}`}
                          className="border-b border-gray-50 last:border-0 dark:border-gray-800/60"
                        >
                          <td className="px-5 py-3">
                            <div className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                              {
                                application.name
                              }
                            </div>

                            <div className="text-[10px] text-gray-400 mt-0.5">
                              {
                                application.deploymentType
                              }
                            </div>
                          </td>

                          <td className="px-5 py-3">
                            <TypeBadge
                              type={
                                application.type
                              }
                            />
                          </td>

                          <td className="px-5 py-3 text-xs text-gray-600 dark:text-gray-300">
                            {
                              application.environment
                            }
                          </td>

                          <td className="px-5 py-3">
                            {application.cpsConfigured ? (
                              <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                                Available
                              </span>
                            ) : (
                              <span className="text-xs text-gray-400">
                                Not configured
                              </span>
                            )}
                          </td>

                          <td className="px-5 py-3 text-xs text-gray-600 dark:text-gray-300">
                            CPS:{' '}
                            {
                              application.cpsPropertyCount ??
                              0
                            }

                            <span className="mx-2 text-gray-300">
                              •
                            </span>

                            Runtime:{' '}
                            {
                              application.runtimePropertyCount ??
                              0
                            }
                          </td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Dependencies */}
          {dependencies.length >
            0 && (
            <div className="rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-white/[0.06] dark:bg-gray-900">
              <div className="border-b border-gray-100 px-5 py-4 dark:border-gray-800">
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <GitBranch
                      size={16}
                      className="text-sf-600"
                    />

                    <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100">
                      Application Dependencies
                    </h2>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2">
                    <div className="relative">
                      <Search
                        size={13}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                      />

                      <input
                        value={
                          dependencySearch
                        }
                        onChange={(event) =>
                          setDependencySearch(
                            event.target
                              .value
                          )
                        }
                        placeholder="Search applications..."
                        className="w-full sm:w-56 rounded-lg border border-gray-200 bg-gray-50 py-2 pl-8 pr-3 text-xs outline-none focus:border-sf-400 dark:border-gray-700 dark:bg-gray-800"
                      />
                    </div>

                    <select
                      value={
                        selectedType
                      }
                      onChange={(event) =>
                        setSelectedType(
                          event.target
                            .value
                        )
                      }
                      className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs outline-none dark:border-gray-700 dark:bg-gray-800"
                    >
                      <option value="ALL">
                        All Types
                      </option>
                      <option value="XAPI">
                        XAPI
                      </option>
                      <option value="PAPI">
                        PAPI
                      </option>
                      <option value="SAPI">
                        SAPI
                      </option>
                      <option value="UNKNOWN">
                        Unknown
                      </option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-gray-100 dark:border-gray-800">
                      <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-wider text-gray-400">
                        Source Application
                      </th>

                      <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-wider text-gray-400">
                        Dependency
                      </th>

                      <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-wider text-gray-400">
                        Evidence
                      </th>

                      <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-wider text-gray-400">
                        Confidence
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {filteredDependencies.length ===
                    0 ? (
                      <tr>
                        <td
                          colSpan={4}
                          className="px-5 py-8 text-center text-xs text-gray-400"
                        >
                          No dependencies match the current filter.
                        </td>
                      </tr>
                    ) : (
                      filteredDependencies.map(
                        (
                          dependency,
                          index
                        ) => (
                          <tr
                            key={`${dependency.sourceApp}-${dependency.targetApp}-${dependency.evidenceKey}-${index}`}
                            className="border-b border-gray-50 last:border-0 dark:border-gray-800/60"
                          >
                            <td className="px-5 py-4">
                              <div className="flex items-center gap-2">
                                <div className="min-w-0">
                                  <div className="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate">
                                    {
                                      dependency.sourceApp
                                    }
                                  </div>

                                  <div className="mt-1">
                                    <TypeBadge
                                      type={
                                        dependency.sourceType
                                      }
                                    />
                                  </div>
                                </div>

                                <ChevronRight
                                  size={15}
                                  className="flex-shrink-0 text-gray-400"
                                />
                              </div>
                            </td>

                            <td className="px-5 py-4">
                              <div className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                                {
                                  dependency.targetApp
                                }
                              </div>

                              <div className="mt-1">
                                <TypeBadge
                                  type={
                                    dependency.targetType
                                  }
                                />
                              </div>
                            </td>

                            <td className="px-5 py-4 max-w-[420px]">
                              <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                                {
                                  dependency.evidenceKey
                                }
                              </div>

                              <div className="mt-1 text-[10px] text-gray-400 break-all">
                                {
                                  dependency.evidenceSource
                                }
                              </div>

                              {dependency.evidenceValue && (
                                <div className="mt-1 text-[10px] text-gray-500 dark:text-gray-400 break-all">
                                  {
                                    dependency.evidenceValue
                                  }
                                </div>
                              )}
                            </td>

                            <td className="px-5 py-4">
                              <ConfidenceBadge
                                confidence={
                                  dependency.confidence
                                }
                              />
                            </td>
                          </tr>
                        )
                      )
                    )}
                  </tbody>
                </table>
              </div>

              <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-800 text-[10px] text-gray-400">
                Showing{' '}
                {
                  filteredDependencies.length
                }{' '}
                of{' '}
                {
                  dependencies.length
                }{' '}
                discovered dependencies.
              </div>
            </div>
          )}

          {/* Empty state */}
          {!loading &&
            applications.length ===
              0 &&
            dependencies.length ===
              0 &&
            !error && (
              <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-16 text-center dark:border-gray-700 dark:bg-gray-900">
                <Network
                  size={32}
                  className="mx-auto text-gray-300 dark:text-gray-600"
                />

                <h3 className="mt-4 text-sm font-bold text-gray-700 dark:text-gray-300">
                  No dependency analysis yet
                </h3>

                <p className="mt-1 text-xs text-gray-400">
                  Select one or more environments and click Get Dependencies.
                </p>
              </div>
            )}
        </div>
      </div>
    </div>
  );
}