import React, { useState } from 'react';
import { X, Plus, Trash2, Database, AlertTriangle, RefreshCw } from 'lucide-react';
import api from '../services/api';

/**
 * CpsCreateModal
 *
 * Modal for creating a new CPS project entry (POST).
 * Sends { "properties": [{ environment, key, properties: { k:v } }] }
 *
 * Props:
 *   baseUrl     {string}   CPS server base URL
 *   environment {string}   CPS environment prefix (e.g. 'prod')
 *   bgOrgId     {string}   Business Group org ID for credential lookup
 *   isProd      {boolean}  Whether this is a production environment
 *   onClose     {function} Called when modal closes
 *   onCreated   {function} Called after successful creation, receives projectKey
 */
export default function CpsCreateModal({
  baseUrl,
  environment,
  bgOrgId,
  isProd = false,
  onClose,
  onCreated,
  onResult,
}) {
  const [projectKey, setProjectKey] = useState('');
  const [type, setType] = useState('non-secure');
  const [rows, setRows] = useState([{ key: '', value: '' }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [prodConfirmed, setProdConfirmed] = useState(false);

  const addRow = () => setRows(r => [...r, { key: '', value: '' }]);
  const removeRow = (i) => setRows(r => r.filter((_, idx) => idx !== i));
  const updateRow = (i, field, val) =>
    setRows(r => r.map((row, idx) => idx === i ? { ...row, [field]: val } : row));

  const handleCreate = async () => {
    if (!projectKey.trim()) { setError('Project Key is required'); return; }
    if (isProd && !prodConfirmed) {
      setError('Please confirm you understand this is a PRODUCTION environment');
      return;
    }
    setError('');
    setSaving(true);

    // Build properties object from rows (skip empty keys)
    const properties = {};
    rows.forEach(({ key, value }) => {
      if (key.trim()) properties[key.trim()] = value;
    });

    // Build a fallback requestDetails in case backend doesn't return one (demo mode)
    const pathSuffix = type === 'secure' ? '/api/v2/properties/secure' : '/api/v2/properties/non-secure';
    const fallbackReqDetails = {
      method: 'POST',
      url: `${baseUrl.replace(/\/+$/, '').replace(/\/api\/v2\/?$/, '')}${pathSuffix}`,
      body: { properties: [{ environment, key: projectKey.trim(), properties }] },
    };

    try {
      const resp = await api.post('/cps/write', {
        baseUrl,
        type,
        method: 'POST',
        environment,
        projectKey: projectKey.trim(),
        properties,
        bgOrgId,
      });
      const { requestDetails, responseDetails } = resp.data || {};
      onResult?.({
        label: 'Create Project',
        timestamp: new Date().toISOString(),
        requestDetails: requestDetails || fallbackReqDetails,
        responseDetails: responseDetails || { status: 200, body: resp.data },
        success: true,
      });
      onCreated?.(projectKey.trim());
      onClose();
    } catch (err) {
      const { requestDetails, responseDetails } = err.response?.data || {};
      onResult?.({
        label: 'Create Project',
        timestamp: new Date().toISOString(),
        requestDetails: requestDetails || fallbackReqDetails,
        responseDetails: responseDetails || { status: err.response?.status, body: err.response?.data },
        success: false,
      });
      setError(err.response?.data?.error || err.message || 'Failed to create CPS project entry');
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-white border border-gray-300 rounded-2xl w-full max-w-xl shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-emerald-50/50 border border-emerald-200/40">
              <Database size={15} className="text-emerald-600" />
            </div>
            <div>
              <h2 className="text-gray-900 font-semibold text-base">Create New CPS Project Entry</h2>
              <p className="text-gray-500 text-xs mt-0.5">
                {environment} · {baseUrl?.replace(/^https?:\/\//, '').split('.')[0]}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-900 p-1">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-4">
          {/* Production warning */}
          {isProd && (
            <div className="flex items-start gap-3 bg-red-50/30 border border-red-200/50 rounded-xl px-4 py-3">
              <AlertTriangle size={15} className="text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-red-700 text-xs leading-relaxed">
                ⚠️ <strong>PRODUCTION</strong> — This will immediately create a new CPS project entry in the production environment. Changes take effect at the next app restart.
              </p>
            </div>
          )}

          {/* Project Key */}
          <div>
            <label className="block text-xs text-gray-500 font-medium uppercase tracking-wider mb-1.5">
              Project Key <span className="text-red-600">*</span>
            </label>
            <input
              value={projectKey}
              onChange={e => setProjectKey(e.target.value)}
              placeholder="e.g. my-api-name-v1-uw2-pd"
              className="w-full bg-gray-100 border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 font-mono placeholder-gray-400 focus:outline-none focus:border-emerald-300/50"
            />
            <p className="text-[10px] text-gray-500 mt-1">
              Must match the <code className="text-gray-500">cps.projectName</code> or <code className="text-gray-500">cloudhub.api.name</code> in the app deployment properties.
            </p>
          </div>

          {/* Property Type */}
          <div>
            <label className="block text-xs text-gray-500 font-medium uppercase tracking-wider mb-1.5">Property Type</label>
            <div className="flex gap-2">
              {[
                { value: 'non-secure', label: 'Non-Secure' },
                { value: 'secure', label: 'Secure' },
              ].map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setType(opt.value)}
                  className={`flex-1 text-xs py-2 px-3 rounded-lg border font-medium transition-all ${
                    type === opt.value
                      ? 'bg-emerald-100 border-emerald-300/50 text-emerald-700'
                      : 'bg-gray-100 border-gray-300 text-gray-500 hover:text-gray-900'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Initial Properties */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-gray-500 font-medium uppercase tracking-wider">
                Initial Properties <span className="text-gray-500 normal-case font-normal">(optional)</span>
              </label>
              <button
                onClick={addRow}
                className="flex items-center gap-1 text-[10px] text-emerald-600 hover:text-emerald-700 bg-emerald-50/30 border border-emerald-200/40 px-2 py-1 rounded-lg transition-colors"
              >
                <Plus size={9} /> Add Row
              </button>
            </div>
            <div className="space-y-2">
              {rows.map((row, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={row.key}
                    onChange={e => updateRow(i, 'key', e.target.value)}
                    placeholder="property.key"
                    className="flex-1 bg-gray-100 border border-gray-300 rounded-lg px-3 py-1.5 text-xs text-gray-700 font-mono placeholder-gray-400 focus:outline-none focus:border-emerald-300/50"
                  />
                  <input
                    value={row.value}
                    onChange={e => updateRow(i, 'value', e.target.value)}
                    placeholder="value"
                    className="flex-1 bg-gray-100 border border-gray-300 rounded-lg px-3 py-1.5 text-xs text-gray-700 font-mono placeholder-gray-400 focus:outline-none focus:border-emerald-300/50"
                  />
                  <button
                    onClick={() => removeRow(i)}
                    disabled={rows.length === 1}
                    className="text-gray-500 hover:text-red-600 transition-colors p-1 rounded disabled:opacity-30"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Production confirmation */}
          {isProd && (
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={prodConfirmed}
                onChange={e => setProdConfirmed(e.target.checked)}
                className="mt-0.5 rounded border-red-300 bg-red-50/30 text-red-500 focus:ring-red-500"
              />
              <span className="text-xs text-red-600">
                I understand this will create a new entry in the <strong>PRODUCTION</strong> CPS server
              </span>
            </label>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 bg-red-50/30 border border-red-200/50 rounded-xl px-4 py-3 text-red-600 text-xs">
              <AlertTriangle size={12} className="flex-shrink-0" />
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 gap-3">
          <p className="text-gray-500 text-xs">
            ⚠️ Changes take effect immediately
          </p>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 text-sm text-gray-500 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={saving || !projectKey.trim()}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg disabled:opacity-50 transition-colors"
            >
              {saving
                ? <><RefreshCw size={13} className="animate-spin" /> Creating…</>
                : <><Database size={13} /> Create Project Entry</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}