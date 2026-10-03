import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CalendarClock, Check, ChevronDown, Clock3, FileText, Layers3, PlayCircle, Search, Upload, Wrench } from 'lucide-react';
import cronstrue from 'cronstrue';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { downloadCsv } from '../utils/appUtils';

const normalizeHeader = (value = '') => String(value).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
const normalizeName = (value = '') => String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
const normalizeCell = (value) => String(value ?? '').trim();

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      values.push(current);
      current = '';
    } else {
      current += ch;
    }
  }

  values.push(current);
  return values.map((v) => v.replace(/^"|"$/g, '').trim());
}

function parseDateValue(value) {
  if (!value) return null;
  const cleaned = String(value).trim();
  if (!cleaned) return null;

  const d = new Date(cleaned);
  if (!Number.isNaN(d.getTime())) return d;

  const num = Number(cleaned);
  if (!Number.isNaN(num)) {
    const parsed = new Date(num);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  return null;
}

function getNextCronRun(cronExpr) {
  if (!cronExpr || typeof cronExpr !== 'string') return null;

  try {
    const clean = cronExpr.trim().replace(/\s+/g, ' ');
    const parts = clean.split(' ');
    if (parts.length < 5 || parts.length > 7) return null;

    const parseField = (field, min, max) => {
      if (field === '*' || field === '?') return null;
      const values = new Set();
      for (const seg of field.split(',')) {
        if (seg.includes('/')) {
          const [rangePart, stepStr] = seg.split('/');
          const step = Math.max(1, Number.parseInt(stepStr, 10));
          let start = min;
          let end = max;
          if (rangePart !== '*' && rangePart !== '') {
            if (rangePart.includes('-')) {
              const [a, b] = rangePart.split('-').map(Number);
              start = a;
              end = b;
            } else {
              start = Number.parseInt(rangePart, 10);
            }
          }
          for (let i = start; i <= end; i += step) values.add(i);
        } else if (seg.includes('-')) {
          const [a, b] = seg.split('-').map(Number);
          for (let i = a; i <= b; i += 1) values.add(i);
        } else {
          const n = Number.parseInt(seg, 10);
          if (!Number.isNaN(n)) values.add(n);
        }
      }
      return values.size > 0 ? values : null;
    };

    let secSet;
    let minSet;
    let hourSet;
    let domSet;
    let monSet;
    let dowSet;

    if (parts.length === 5) {
      secSet = new Set([0]);
      minSet = parseField(parts[0], 0, 59);
      hourSet = parseField(parts[1], 0, 23);
      domSet = parseField(parts[2], 1, 31);
      monSet = parseField(parts[3], 1, 12);
      dowSet = parseField(parts[4], 0, 6);
    } else {
      secSet = parseField(parts[0], 0, 59);
      minSet = parseField(parts[1], 0, 59);
      hourSet = parseField(parts[2], 0, 23);
      domSet = parseField(parts[3], 1, 31);
      monSet = parseField(parts[4], 1, 12);
      const rawDow = parseField(parts[5], 1, 7);
      dowSet = rawDow ? new Set([...rawDow].map((d) => d - 1)) : null;
    }

    const hit = (set, value) => set === null || set.has(value);
    const nextHigher = (set, current) => {
      if (!set) return null;
      const arr = [...set].filter((v) => v > current).sort((a, b) => a - b);
      return arr.length > 0 ? arr[0] : null;
    };

    const domRaw = parts.length === 5 ? parts[2] : parts[3];
    const dowRaw = parts.length === 5 ? parts[4] : parts[5];
    const domWild = domRaw === '*' || domRaw === '?';
    const dowWild = dowRaw === '*' || dowRaw === '?';

    const d = new Date();
    d.setMilliseconds(0);
    d.setSeconds(d.getSeconds() + 1);

    const endLimit = new Date(d.getTime() + 366 * 24 * 60 * 60 * 1000);

    while (d <= endLimit) {
      if (!hit(monSet, d.getMonth() + 1)) {
        const next = nextHigher(monSet, d.getMonth() + 1);
        if (next === null) {
          d.setFullYear(d.getFullYear() + 1, 0, 1);
          d.setHours(0, 0, 0, 0);
        } else {
          d.setMonth(next - 1, 1);
          d.setHours(0, 0, 0, 0);
        }
        continue;
      }

      const domOk = hit(domSet, d.getDate());
      const dowOk = hit(dowSet, d.getDay());
      const dayIsValid = (!domWild && !dowWild)
        ? (domOk || dowOk)
        : domWild
          ? dowOk
          : domOk;

      if (!dayIsValid) {
        d.setDate(d.getDate() + 1);
        d.setHours(0, 0, 0, 0);
        continue;
      }

      if (!hit(hourSet, d.getHours())) {
        const next = nextHigher(hourSet, d.getHours());
        if (next === null) {
          d.setDate(d.getDate() + 1);
          d.setHours(0, 0, 0, 0);
        } else {
          d.setHours(next, 0, 0, 0);
        }
        continue;
      }

      if (!hit(minSet, d.getMinutes())) {
        const next = nextHigher(minSet, d.getMinutes());
        if (next === null) {
          d.setHours(d.getHours() + 1, 0, 0, 0);
        } else {
          d.setMinutes(next, 0, 0);
        }
        continue;
      }

      if (!hit(secSet, d.getSeconds())) {
        const next = nextHigher(secSet, d.getSeconds());
        if (next === null) {
          d.setMinutes(d.getMinutes() + 1, 0, 0);
        } else {
          d.setSeconds(next);
        }
        continue;
      }

      return new Date(d);
    }

    return null;
  } catch {
    return null;
  }
}

function resolveCronExpression(rawCron, propsMap = {}, cpsMap = {}) {
  if (!rawCron) return '';
  return String(rawCron).replace(/\$\{([^}]+)\}/g, (match, key) => {
    const direct = propsMap[key] ?? propsMap[key.toLowerCase()] ?? cpsMap[key] ?? cpsMap[key.toLowerCase()];
    if (direct !== undefined && direct !== null) return String(direct);
    return match;
  });
}

function findColumn(row, aliases) {
  const keys = Object.keys(row);
  for (const alias of aliases) {
    const aliasNorm = normalizeHeader(alias);
    const match = keys.find((key) => normalizeHeader(key) === aliasNorm);
    if (match) return row[match];

    const partial = keys.find((key) => {
      const keyNorm = normalizeHeader(key);
      return keyNorm.includes(aliasNorm) || aliasNorm.includes(keyNorm);
    });
    if (partial) return row[partial];
  }
  return '';
}

function parseCsvJobs(csvText) {
  if (!csvText || !csvText.trim()) return [];

  const lines = csvText.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];

  const rows = lines.map(parseCsvLine);
  const headers = rows[0].map((header) => normalizeHeader(header));

  const records = rows.slice(1).map((values, index) => {
    const obj = {};
    headers.forEach((header, idx) => {
      obj[header] = values[idx] ?? '';
    });
    return { ...obj, __rowIndex: index };
  });

  return records
    .map((row, index) => {
      const jobName = normalizeCell(findColumn(row, ['jobname', 'job', 'schedulername', 'scheduler', 'name', 'flowname', 'taskname', 'title'])) || `Job ${index + 1}`;
      const appName = normalizeCell(findColumn(row, ['application', 'appname', 'app', 'integration', 'project', 'jobapplication', 'source'])) || 'N/A';
      const rawCron = normalizeCell(findColumn(row, ['cron', 'cronexpression', 'schedule', 'scheduleexpression', 'expression', 'trigger', 'cronexpr']));
      const startValue = normalizeCell(findColumn(row, ['starttime', 'startedat', 'start', 'startdate', 'schedulestart', 'runstart', 'executionstart']));
      const nextValue = normalizeCell(findColumn(row, ['nextrun', 'nextexecution', 'nexttime', 'nextscheduledtime', 'nextschedule', 'next_run', 'executiontime', 'runtime']));

      const resolvedCron = resolveCronExpression(rawCron, row);
      let readableCron = '';
      if (resolvedCron) {
        try {
          readableCron = cronstrue.toString(resolvedCron, { throwExceptionOnParseError: true });
        } catch {
          readableCron = '';
        }
      }

      const parsedStart = parseDateValue(startValue) || parseDateValue(findColumn(row, ['lastrun', 'lastexecution', 'lastexecuted', 'laststarted']));
      const nextExecutionDate = parseDateValue(nextValue) || (resolvedCron ? getNextCronRun(resolvedCron) : null);

      const record = {
        id: `${jobName}-${index}-${appName}`,
        jobName,
        appName,
        environment: '',
        cron: resolvedCron,
        decryptedCron: readableCron,
        startTime: parsedStart,
        nextExecution: nextExecutionDate,
        rawStartTime: startValue,
        rawNextExecution: nextValue,
      };

      if (!record.jobName && !record.cron) return null;
      return record;
    })
    .filter(Boolean);
}

function extractJobNames(csvText) {
  if (!csvText || !csvText.trim()) return [];

  const lines = csvText.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];

  const rows = lines.map(parseCsvLine);
  const headers = rows[0].map((header) => normalizeHeader(header));
  const jobIndex = headers.findIndex((header) => ['jobname', 'job', 'schedulername', 'scheduler', 'name', 'flowname', 'taskname', 'title'].includes(header));

  if (jobIndex >= 0) {
    return rows.slice(1).map((row) => normalizeCell(row[jobIndex])).filter(Boolean);
  }

  if (rows[0].length === 1) {
    return rows.slice(1).map((row) => normalizeCell(row[0])).filter(Boolean);
  }

  return rows.slice(1).map((row) => normalizeCell(row[0])).filter(Boolean);
}

async function fetchCpsProperties(app, orgId) {
  try {
    const ds = app?.target?.deploymentSettings || {};
    const appCfg = app?.application?.configuration || {};
    const propsSvc = appCfg['mule.agent.application.properties.service'] || {};
    const runtimeProps = {
      ...(propsSvc.properties || {}),
      ...(ds.properties || {}),
      ...(ds.environmentVariables || ds.environmentVars || {}),
      ...(app?.properties || {}),
    };

    const cpsBaseUrl = runtimeProps['cps.configServerBaseUrl'] || runtimeProps['config.server.base.url'];
    if (!cpsBaseUrl) return {};

    const projectName = runtimeProps['cps.projectName'] || runtimeProps['cloudhub.api.name'] || app?.name;
    const cpsEnv = runtimeProps['cps.prefix'] || runtimeProps['cps.environment'] || 'uat';

    const response = await api.get('/cps/fetch', {
      params: {
        baseUrl: cpsBaseUrl,
        type: 'non-secure',
        environment: cpsEnv,
        keys: projectName,
        bgOrgId: orgId,
      },
    });

    const data = response?.data || {};
    const entries = Array.isArray(data) ? data : Array.isArray(data.responses) ? data.responses : Array.isArray(data.properties) ? data.properties : null;
    if (entries) {
      const match = entries.find((entry) => entry.key === projectName) || entries[0];
      const properties = match?.properties || match;
      if (properties && typeof properties === 'object' && !Array.isArray(properties)) return properties;
    }

    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const first = Object.values(data)[0];
      if (first && typeof first === 'object' && !Array.isArray(first)) return first;
      return data;
    }

    return {};
  } catch {
    return {};
  }
}

async function fetchSchedulerRecordsForApp(app, orgId) {
  const envId = app?.environment?.id;
  const bgId = app?._bgId || orgId;
  if (!bgId || !envId) return [];

  try {
    const detailUrl = app?.deploymentType === 'CloudHub 2.0'
      ? `/applications/cloudhub2/${bgId}/${envId}/${app.id}`
      : `/applications/cloudhub1/${envId}/${app.id}?orgId=${bgId}`;

    const detailRes = await api.get(detailUrl);
    const detail = detailRes?.data || app;

    const ds = detail.target?.deploymentSettings || {};
    const appCfg = detail.application?.configuration || {};
    const propsSvc = appCfg['mule.agent.application.properties.service'] || {};
    const runtimeProps = {
      ...(propsSvc.properties || {}),
      ...(ds.properties || {}),
      ...(ds.environmentVariables || ds.environmentVars || {}),
      ...(detail.properties || {}),
      ...(detail.application?.properties || {}),
    };

    const cpsMap = await fetchCpsProperties(detail, bgId);

    const schedUrl = app?.deploymentType === 'CloudHub 2.0'
      ? `/applications/cloudhub2/${bgId}/${envId}/${app.id}/schedulers`
      : `/applications/cloudhub1/${envId}/${app.id}/schedules?orgId=${bgId}`;

    const schedRes = await api.get(schedUrl);
    const data = schedRes?.data || [];
    const rawItems = Array.isArray(data)
      ? data
      : (Array.isArray(data.schedulers) ? data.schedulers : Array.isArray(data.schedules) ? data.schedules : Array.isArray(data.items) ? data.items : []);

    return rawItems.map((scheduler, index) => {
      const flowName = scheduler.flow || scheduler.flowName || scheduler.name || scheduler.schedulerName || `scheduler-${index}`;
      const rawCron = scheduler.schedule?.cronExpression || scheduler.schedule?.expression || scheduler.expression || scheduler.cronExpression || '';
      const startValue = scheduler.startTime || scheduler.startDate || scheduler.startedAt || scheduler.schedule?.startTime || scheduler.schedule?.startDate || '';
      const nextRawValue = scheduler.nextRun || scheduler.nextExecution || scheduler.schedule?.nextRun || scheduler.schedule?.nextExecution || scheduler.nextRunTime || '';
      const resolvedCron = resolveCronExpression(rawCron, runtimeProps, cpsMap);

      let readableCron = '';
      if (resolvedCron) {
        try {
          readableCron = cronstrue.toString(resolvedCron, { throwExceptionOnParseError: true });
        } catch {
          readableCron = '';
        }
      }

      const startTime = parseDateValue(startValue);
      const nextExecution = parseDateValue(nextRawValue) || (resolvedCron ? getNextCronRun(resolvedCron) : null);

      return {
        id: `${detail.name || app.name}-${flowName}-${index}`,
        jobName: flowName,
        appName: detail.name || app.name,
        environment: detail.environment?.name || detail.environment?.environmentName || app.environment?.name || app.environment?.environmentName || '',
        cron: resolvedCron,
        decryptedCron: readableCron,
        startTime,
        nextExecution,
      };
    });
  } catch (error) {
    console.warn('[HelperPage] fetchSchedulerRecordsForApp failed:', error);
    return [];
  }
}

async function resolveJobsFromCsv(csvText, orgId, envIds = [], envLabels = []) {
  const names = extractJobNames(csvText)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => value.replace(/\s+/g, ' '));

  const activeEnvIds = Array.isArray(envIds) && envIds.length ? new Set(envIds) : null;
  const envScopeLabel = Array.isArray(envLabels) && envLabels.length ? envLabels.join(', ') : 'Selected env scope';

  console.debug('[HelperPage] CSV names extracted:', names);
  console.debug('[HelperPage] Selected env ids:', envIds);

  if (!names.length) {
    const parsed = parseCsvJobs(csvText);
    console.debug('[HelperPage] Parsed schedule rows:', parsed.length);
    return parsed.length ? parsed : [];
  }

  try {
    let groups = [];
    try {
      const groupRes = await api.get('/organizations/business-groups');
      groups = groupRes?.data?.data || groupRes?.data?.businessGroups || groupRes?.data || [];
    } catch (error) {
      console.warn('[HelperPage] /organizations/business-groups fetch failed:', error);
      groups = [];
    }

    const apps = [];
    for (const group of groups) {
      const groupId = group.id || group.orgId || group.organizationId;
      if (!groupId) continue;
      try {
        const appRes = await api.get(`/applications/summary/${groupId}`);
        const list = appRes?.data?.data || appRes?.data?.applications || appRes?.data || [];
        list.forEach((app) => {
          const appEnvId = app?.environment?.id || app?.environmentId || app?.envId || app?.target?.environment?.id;
          if (activeEnvIds && appEnvId && !activeEnvIds.has(appEnvId)) return;
          if (activeEnvIds && !appEnvId) return;
          apps.push({ ...app, _bgId: groupId, _envId: appEnvId || null });
        });
      } catch (error) {
        console.warn(`[HelperPage] Failed to fetch apps for BG ${groupId}:`, error);
      }
    }

    if (!apps.length) {
      console.warn('[HelperPage] No apps matched the selected environment scope, returning fallback rows.');
      return names.map((name, index) => ({
        id: `fallback-${index}`,
        jobName: name,
        appName: 'N/A',
        environment: envScopeLabel,
        cron: '',
        decryptedCron: '',
        startTime: null,
        nextExecution: null,
      }));
    }

    const matched = [];
    const normalizedNames = names.map((name) => normalizeName(name));

    for (const app of apps) {
      const schedulers = await fetchSchedulerRecordsForApp(app, orgId || app._bgId);
      for (const scheduler of schedulers) {
        const schedulerName = normalizeName(scheduler.jobName);
        const isMatch = normalizedNames.some((name) => {
          if (!name) return false;
          return schedulerName === name || schedulerName.includes(name) || name.includes(schedulerName);
        });
        if (isMatch) matched.push({
          ...scheduler,
          environment: scheduler.environment || app.environment?.name || app.environment?.environmentName || envScopeLabel,
        });
      }
    }

    if (matched.length) return matched;

    console.warn('[HelperPage] No scheduler matches found for uploaded names, returning fallback labels.');
    return names.map((name, index) => ({
      id: `fallback-${index}`,
      jobName: name,
      appName: 'N/A',
      environment: envScopeLabel,
      cron: '',
      decryptedCron: '',
      startTime: null,
      nextExecution: null,
    }));
  } catch (error) {
    console.warn('[HelperPage] resolveJobsFromCsv failed:', error);
    const fallback = names.map((name, index) => ({
      id: `fallback-${index}`,
      jobName: name,
      appName: 'N/A',
      environment: envScopeLabel,
      cron: '',
      decryptedCron: '',
      startTime: null,
      nextExecution: null,
    }));
    return fallback.length ? fallback : parseCsvJobs(csvText);
  }
}

export default function HelperPage() {
  const { orgId } = useAuth();
  const [rows, setRows] = useState([]);
  const [fileName, setFileName] = useState('');
  const [csvText, setCsvText] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [envOptions, setEnvOptions] = useState([]);
  const [selectedEnvIds, setSelectedEnvIds] = useState([]);
  const [envLoading, setEnvLoading] = useState(false);
  const [envMenuOpen, setEnvMenuOpen] = useState(false);
  const fileInputRef = useRef(null);
  const envMenuRef = useRef(null);

  const jobs = useMemo(() => rows, [rows]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (envMenuRef.current && !envMenuRef.current.contains(event.target)) {
        setEnvMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!orgId) return;

    let isMounted = true;
    const loadEnvironmentOptions = async () => {
      setEnvLoading(true);
      try {
        const groupRes = await api.get('/organizations/business-groups');
        const groups = groupRes?.data?.data || groupRes?.data?.businessGroups || groupRes?.data || [];
        const envs = [];

        for (const group of groups) {
          const groupId = group.id || group.orgId || group.organizationId;
          if (!groupId) continue;
          try {
            const envRes = await api.get(`/environments/${groupId}`);
            const list = envRes?.data?.data || envRes?.data?.environments || envRes?.data || [];
            list.forEach((env) => {
              const id = env.id || env.environmentId || env.envId;
              if (!id || envs.some((item) => item.id === id)) return;
              envs.push({
                id,
                name: env.name || env.environmentName || 'Unnamed environment',
                type: env.type || env.environmentType || 'unknown',
                bgName: group.name || group.organizationName || 'Business Group',
              });
            });
          } catch (envError) {
            console.warn(`[HelperPage] Failed to load environments for BG ${groupId}:`, envError);
          }
        }

        if (!isMounted) return;
        setEnvOptions(envs);
        setSelectedEnvIds((prev) => {
          const validPrev = prev.filter((id) => envs.some((env) => env.id === id));
          if (validPrev.length > 0) return validPrev;
          return envs.map((env) => env.id);
        });
      } catch (error) {
        console.warn('[HelperPage] Failed to load environment list:', error);
      } finally {
        if (isMounted) setEnvLoading(false);
      }
    };

    loadEnvironmentOptions();
    return () => {
      isMounted = false;
    };
  }, [orgId]);

  const handleEnvToggle = (envId) => {
    setSelectedEnvIds((prev) => {
      if (prev.includes(envId)) return prev.filter((id) => id !== envId);
      return [...prev, envId];
    });
  };

  const handleSelectAllEnvs = () => {
    setSelectedEnvIds(envOptions.map((env) => env.id));
  };

  const handleClearEnvSelection = () => {
    setSelectedEnvIds([]);
  };

  const selectedEnvNames = envOptions
    .filter((env) => selectedEnvIds.includes(env.id))
    .map((env) => env.name);

  const selectedEnvSummary = selectedEnvNames.length === 0
    ? 'Select environment'
    : selectedEnvNames.length === envOptions.length && envOptions.length > 0
      ? 'All environments'
      : selectedEnvNames.length > 2
        ? `${selectedEnvNames.slice(0, 2).join(', ')}, +${selectedEnvNames.length - 2}`
        : selectedEnvNames.join(', ');

  const handleUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (selectedEnvIds.length === 0) {
      setRows([]);
      setError('Please select at least one environment before uploading the CSV.');
      event.target.value = '';
      return;
    }

    setFileName(file.name);
    setError('');
    setRows([]);

    const reader = new FileReader();
    reader.onload = () => {
      const nextCsvText = String(reader.result || '');
      setCsvText(nextCsvText);
      event.target.value = '';
    };
    reader.readAsText(file);
  };

  const handleGetDetails = async () => {
    if (!csvText.trim()) {
      setError('Upload a CSV file before fetching job details.');
      return;
    }

    if (selectedEnvIds.length === 0) {
      setRows([]);
      setError('Please select at least one environment before fetching job details.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const parsed = await resolveJobsFromCsv(csvText, orgId, selectedEnvIds, selectedEnvNames);
      setRows(parsed);
      setError(parsed.length ? '' : 'No matching job schedules were found in the selected environment scope.');
    } catch {
      setRows([]);
      setError('The uploaded file could not be parsed or no job details could be resolved for the selected environment.');
    } finally {
      setLoading(false);
    }
  };

  const handleExport = () => {
    if (!jobs.length) return;

    const headers = ['Job Name', 'Application', 'Environment', 'Start Time', 'Next Execution', 'Cron', 'Decoded Schedule'];
    const rowsForCsv = jobs.map((job) => [
      job.jobName || '',
      job.appName || '',
      job.environment || '',
      job.startTime ? job.startTime.toISOString() : '',
      job.nextExecution ? job.nextExecution.toISOString() : '',
      job.cron || '',
      job.decryptedCron || '',
    ]);

    downloadCsv([headers, ...rowsForCsv], `scheduler-helper-${new Date().toISOString().slice(0, 10)}.csv`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-sf-600 dark:text-sf-400 font-bold">Helper</p>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">Scheduler Helper</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-xl border border-sf-200 bg-sf-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-sf-500 transition-colors"
          >
            <Upload size={16} />
            Upload CSV
          </button>

          <button
            type="button"
            onClick={handleGetDetails}
            disabled={!csvText.trim() || loading || selectedEnvIds.length === 0}
            className="inline-flex items-center gap-2 rounded-xl border border-sf-200 bg-white px-4 py-2.5 text-sm font-semibold text-sf-700 shadow-sm transition hover:bg-sf-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-sf-500/30 dark:bg-gray-900 dark:text-sf-200 dark:hover:bg-sf-500/5"
          >
            <Search size={16} />
            {loading ? 'Fetching…' : 'Get Details'}
          </button>

          {jobs.length > 0 && (
            <button
              onClick={handleExport}
              className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-500 transition-colors"
            >
              <FileText size={16} />
              Export CSV
            </button>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-sf-200 bg-white/80 p-4 dark:bg-gray-900/60 dark:border-sf-500/30">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-[0.2em] text-sf-600 dark:text-sf-400 font-bold">Environment scope</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">Select the environments to scan before fetching job details.</p>
          </div>

          <div ref={envMenuRef} className="relative w-full max-w-md">
            <button
              type="button"
              onClick={() => setEnvMenuOpen((prev) => !prev)}
              className="flex w-full items-center justify-between gap-2 rounded-xl border border-sf-200 bg-white px-3 py-2.5 text-left text-sm shadow-sm transition hover:border-sf-300 dark:border-sf-500/30 dark:bg-sf-500/5 dark:text-sf-200"
            >
              <div className="flex min-w-0 items-center gap-2">
                <Layers3 size={15} className="text-sf-600 dark:text-sf-300" />
                <span className="truncate font-medium text-gray-700 dark:text-gray-100">{selectedEnvSummary}</span>
              </div>
              <ChevronDown size={14} className={`text-gray-400 transition ${envMenuOpen ? 'rotate-180' : ''}`} />
            </button>

            {envMenuOpen && (
              <div className="absolute left-0 right-0 z-30 mt-2 overflow-hidden rounded-2xl border border-gray-200 bg-white p-2 shadow-xl dark:border-gray-700 dark:bg-gray-900">
                <div className="mb-2 flex items-center justify-between gap-2 px-1">
                  <button type="button" onClick={handleSelectAllEnvs} className="rounded-lg border border-sf-200 bg-sf-50 px-2 py-1 text-[11px] font-medium text-sf-700 dark:border-sf-500/30 dark:bg-sf-500/10 dark:text-sf-200">
                    All
                  </button>
                  <button type="button" onClick={handleClearEnvSelection} className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
                    Clear
                  </button>
                </div>

                <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
                  {envLoading ? (
                    <div className="px-2 py-3 text-sm text-gray-500 dark:text-gray-400">Loading environments…</div>
                  ) : envOptions.length === 0 ? (
                    <div className="px-2 py-3 text-sm text-gray-500 dark:text-gray-400">No environments were found for the current org.</div>
                  ) : (
                    envOptions.map((env) => {
                      const active = selectedEnvIds.includes(env.id);
                      return (
                        <button
                          key={env.id}
                          type="button"
                          onClick={() => handleEnvToggle(env.id)}
                          className={`flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left transition ${
                            active ? 'bg-sf-50 text-sf-700 dark:bg-sf-500/10 dark:text-sf-200' : 'text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800/80'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">{env.name}</div>
                            <div className="truncate text-[11px] text-gray-500 dark:text-gray-400">{env.bgName}</div>
                          </div>
                          {active ? <Check size={14} className="text-sf-600 dark:text-sf-400" /> : <span className="h-4 w-4 rounded border border-gray-300 dark:border-gray-600" />}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <input ref={fileInputRef} type="file" accept=".csv,text/csv" onChange={handleUpload} className="hidden" />

      <div className="rounded-2xl border border-dashed border-sf-200 bg-white/80 p-6 dark:bg-gray-900/60 dark:border-sf-500/30">
        <div className="flex items-center gap-3 text-sf-700 dark:text-sf-300">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sf-100 dark:bg-sf-500/10">
            <Wrench size={18} />
          </div>
          <div>
            <p className="font-semibold">Select the environment(s) and upload a CSV of job names or scheduler rows</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">The helper resolves live app data, scheduler definitions, and CPS property values for the selected scope and prints the job details in a table.</p>
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {fileName && (
        <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
          <FileText size={16} className="text-sf-600" />
          <span className="font-medium">Loaded file:</span>
          <span className="font-mono break-all">{fileName}</span>
        </div>
      )}

      {loading && (
        <div className="rounded-2xl border border-sf-200 bg-sf-50 px-4 py-3 text-sm text-sf-700 dark:border-sf-500/30 dark:bg-sf-500/10 dark:text-sf-200">
          Resolving scheduler details for {selectedEnvNames.length ? selectedEnvNames.join(', ') : 'the selected environment scope'}…
        </div>
      )}

      {jobs.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white/70 p-8 text-center text-gray-500 dark:border-gray-700 dark:bg-gray-900/50 dark:text-gray-400">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-300">
            <Search size={20} />
          </div>
          <p className="text-base font-medium text-gray-700 dark:text-gray-200">No jobs resolved yet</p>
          <p className="mt-1 text-sm">Select one or more environments and upload a CSV of job names to resolve the app, cron, start time, and next execution values from the live scheduler data.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-900">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-left">
              <thead className="bg-gray-50 dark:bg-gray-800/80">
                <tr>
                  <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Job</th>
                  <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Application</th>
                  <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Environment</th>
                  <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Start Time</th>
                  <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Next Execution</th>
                  <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Cron</th>
                  <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Decoded Schedule</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {jobs.map((job) => (
                  <tr key={job.id} className="align-top hover:bg-sf-50/40 dark:hover:bg-sf-500/5">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-gray-800 dark:text-gray-100">{job.jobName}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">{job.appName}</td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">{job.environment || '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-200">
                      {job.startTime ? (
                        <div className="flex items-center gap-2">
                          <Clock3 size={12} className="text-sf-600" />
                          <span>{job.startTime.toLocaleString()}</span>
                        </div>
                      ) : (
                        <span className="text-gray-400 dark:text-gray-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-200">
                      {job.nextExecution ? (
                        <div className="flex items-center gap-2">
                          <CalendarClock size={12} className="text-sfpurple-600" />
                          <span>{job.nextExecution.toLocaleString()}</span>
                        </div>
                      ) : (
                        <span className="text-gray-400 dark:text-gray-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-gray-700 dark:text-gray-200 break-all max-w-[220px]">
                      {job.cron || <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-200 max-w-[260px]">
                      {job.decryptedCron ? (
                        <span className="inline-flex items-center gap-2 rounded-lg bg-sfteal-50 px-2 py-1 text-sfteal-700 dark:bg-sfteal-500/10 dark:text-sfteal-300">
                          <PlayCircle size={12} />
                          {job.decryptedCron}
                        </span>
                      ) : (
                        <span className="text-gray-400 dark:text-gray-500">No readable cron</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
