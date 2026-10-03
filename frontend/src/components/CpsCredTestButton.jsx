import React, { useState } from 'react';
import { CheckCircle, XCircle, RefreshCw, Wifi } from 'lucide-react';
import api from '../services/api';

/**
 * CpsCredTestButton
 *
 * Tests a CPS credential pair against the CPS server and shows a
 * green ✓ Valid or red ✗ Invalid badge.
 *
 * Props:
 *   baseUrl      {string}  CPS server base URL
 *   clientId     {string}  client_id to test
 *   clientSecret {string}  client_secret to test
 *   environment  {string}  CPS environment prefix (e.g. 'prod')
 *   projectKey   {string}  CPS project key (optional — used to narrow the test)
 *   compact      {boolean} Smaller button variant
 */
export default function CpsCredTestButton({
  baseUrl,
  clientId,
  clientSecret,
  environment,
  projectKey,
  compact = false,
}) {
  const [status, setStatus] = useState(null); // null | 'testing' | 'valid' | 'invalid'
  const [message, setMessage] = useState('');

  const canTest = !!(baseUrl && clientId && clientSecret);

  const runTest = async () => {
    if (!canTest) return;
    setStatus('testing');
    setMessage('');
    try {
      const res = await api.post('/cps/credentials/test', {
        baseUrl,
        clientId,
        clientSecret,
        environment: environment || 'prod',
        projectKey: projectKey || '',
      });
      const { valid, message: msg } = res.data;
      setStatus(valid ? 'valid' : 'invalid');
      setMessage(msg || (valid ? 'Connected successfully' : 'Connection failed'));
    } catch (err) {
      setStatus('invalid');
      setMessage(err.response?.data?.error || err.message || 'Test request failed');
    }
  };

  const iconSize = compact ? 11 : 13;
  const sizeClass = compact ? 'text-[10px] px-2 py-1 gap-1' : 'text-xs px-3 py-1.5 gap-1.5';

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={runTest}
        disabled={!canTest || status === 'testing'}
        title={canTest ? 'Test these credentials against the CPS server' : 'Enter credentials first'}
        className={`flex items-center ${sizeClass} rounded-lg border font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
          status === 'valid'
            ? 'bg-emerald-100 border-emerald-300/50 text-emerald-700 hover:bg-emerald-600/30'
            : status === 'invalid'
            ? 'bg-red-100 border-red-300/50 text-red-700 hover:bg-red-600/30'
            : 'bg-gray-100 border-gray-300 text-gray-500 hover:text-gray-900 hover:border-gray-300'
        }`}
      >
        {status === 'testing' ? (
          <><RefreshCw size={iconSize} className="animate-spin" /> Testing…</>
        ) : status === 'valid' ? (
          <><CheckCircle size={iconSize} className="text-emerald-600" /> Valid</>
        ) : status === 'invalid' ? (
          <><XCircle size={iconSize} className="text-red-600" /> Invalid</>
        ) : (
          <><Wifi size={iconSize} /> Test Credential</>
        )}
      </button>

      {message && status !== 'testing' && (
        <span className={`text-[10px] ${status === 'valid' ? 'text-emerald-500' : 'text-red-500'} max-w-xs truncate`}
          title={message}>
          {message}
        </span>
      )}
    </div>
  );
}