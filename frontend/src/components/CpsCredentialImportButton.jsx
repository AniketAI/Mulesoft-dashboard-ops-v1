import React from 'react';
import { ImportCredentialButton } from './CredentialImportButton';
import { useCpsCredentialStore } from '../context/CpsCredentialStoreContext';

/**
 * CpsCredentialImportButton
 *
 * Import button for CPS (Config Property Server) credentials.
 * Separate from CredentialImportButton which is used for Ping Test credentials.
 *
 * This is now a thin wrapper around the shared ImportCredentialButton
 * component defined in CredentialImportButton.jsx — no logic is duplicated.
 *
 * Props:
 *   compact {boolean} – smaller size variant
 */
export default function CpsCredentialImportButton({ compact = false }) {
  const { loadedCount, hasCredentials, loadFromCsv, clearCredentials } =
    useCpsCredentialStore();

  return (
    <ImportCredentialButton
      loadedCount={loadedCount}
      hasCredentials={hasCredentials}
      loadFromCsv={loadFromCsv}
      clearCredentials={clearCredentials}
      compact={compact}
      accentColor="purple"
      loadedLabel={(n) => `${n} CPS creds`}
      importLabel="CPS Creds"
      logPrefix="[CpsCredentialImport]"
      ariaLabel="Import CPS credentials CSV file"
      importTitle="Import CPS client_id/client_secret CSV — parsed locally, never uploaded"
      loadedTitle="CPS credentials are loaded in memory — never stored to disk or sent to the server"
      clearTitle="Clear CPS credentials from memory"
    />
  );
}
