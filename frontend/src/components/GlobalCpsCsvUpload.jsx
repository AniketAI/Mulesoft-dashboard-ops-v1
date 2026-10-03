import React from 'react';
import { ImportCredentialButton } from './CredentialImportButton';
import { useCpsCredentialStore } from '../context/CpsCredentialStoreContext';

/**
 * GlobalCpsCsvUpload
 *
 * Import button for Global CPS credentials.
 * Uses the ImportCredentialButton wrapper for consistency.
 */
export default function GlobalCpsCsvUpload({ compact = false }) {
  const { globalCredentials, hasGlobalCredentials, loadGlobalFromCsv, clearCredentials } =
    useCpsCredentialStore();

  return (
    <ImportCredentialButton
      loadedCount={globalCredentials.length}
      hasCredentials={hasGlobalCredentials}
      loadFromCsv={loadGlobalFromCsv}
      clearCredentials={clearCredentials}
      compact={compact}
      accentColor="indigo"
      loadedLabel={(n) => `${n} BG creds`}
      importLabel="Import Global CPS CSV"
      logPrefix="[GlobalCpsCredentialImport]"
      ariaLabel="Import Global CPS credentials CSV file"
      importTitle="Import Global CPS CSV — parsed locally, never uploaded"
      loadedTitle="Global CPS credentials are loaded in memory — never stored to disk or sent to the server"
      clearTitle="Clear Global CPS credentials from memory"
    />
  );
}
