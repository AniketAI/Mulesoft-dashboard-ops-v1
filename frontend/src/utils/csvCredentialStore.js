/**
 * Shared CSV credential store utilities.
 *
 * Both CredentialStoreContext (ping credentials) and
 * CpsCredentialStoreContext (CPS credentials) use identical CSV parsing
 * and in-memory store logic.  Centralising here ensures:
 *   - One place to fix CSV parsing edge-cases
 *   - Consistent header-detection heuristics
 *   - No behavioral drift between the two stores
 */

/**
 * Parse a single CSV line, handling quoted fields and comma/semicolon
 * delimiters.  Returns an array of unquoted, trimmed string values.
 *
 * @param {string} line
 * @returns {string[]}
 */
export function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if ((ch === ',' || ch === ';') && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Parse a CSV text string into a Map<clientId, clientSecret>.
 *
 * Auto-detects a header row: if the first cell is not a long hex/alphanumeric
 * string (≥ 16 chars, no spaces) it is treated as a header and skipped.
 *
 * @param {string} text  Raw CSV file content
 * @returns {Map<string, string>}
 */
export function parseCsvToCredentialMap(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) return new Map();

  // Auto-detect header: if the first cell looks like a label (not a UUID/hex),
  // skip it.  A real clientId is typically a long hex/alphanumeric string
  // (≥ 16 chars, no spaces).
  let startIndex = 0;
  const firstCell = parseCsvLine(lines[0])[0] || '';
  const cleanFirst = firstCell.replace(/^"|"$/g, '').trim();
  const looksLikeId = /^[0-9a-zA-Z_\-]{16,}$/.test(cleanFirst);
  if (!looksLikeId) startIndex = 1;

  const map = new Map();
  for (let i = startIndex; i < lines.length; i++) {
    const parts = parseCsvLine(lines[i]);
    const clientId     = (parts[0] || '').replace(/^"|"$/g, '').trim();
    const clientSecret = (parts[1] || '').replace(/^"|"$/g, '').trim();
    if (clientId && clientSecret) map.set(clientId, clientSecret);
  }
  return map;
}