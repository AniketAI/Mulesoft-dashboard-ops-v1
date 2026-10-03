import { parseCsvLine } from './csvCredentialStore';

/**
 * Parses the Global CPS CSV format with headers:
 * ch1_uat_client_id, ch1_uat_client_secret, ch1_prod_client_id, ch1_prod_client_secret,
 * ch2_uat_client_id, ch2_uat_client_secret, ch2_prod_client_id, ch2_prod_client_secret,
 * business-group
 * 
 * Returns an array of objects representing each business group's credentials.
 */
export function parseGlobalCpsCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]).map(h => h.toLowerCase().trim());
  
  // Find indices for each expected header with lenient matching
  const idxMap = {
    ch1_uat_client_id: headers.findIndex(h => h.includes('ch1') && h.includes('uat') && h.includes('id')),
    ch1_uat_client_secret: headers.findIndex(h => h.includes('ch1') && h.includes('uat') && h.includes('secret')),
    ch1_prod_client_id: headers.findIndex(h => h.includes('ch1') && h.includes('prod') && h.includes('id')),
    ch1_prod_client_secret: headers.findIndex(h => h.includes('ch1') && h.includes('prod') && h.includes('secret')),
    ch2_uat_client_id: headers.findIndex(h => h.includes('ch2') && h.includes('uat') && h.includes('id')),
    ch2_uat_client_secret: headers.findIndex(h => h.includes('ch2') && h.includes('uat') && h.includes('secret')),
    ch2_prod_client_id: headers.findIndex(h => h.includes('ch2') && h.includes('prod') && h.includes('id')),
    ch2_prod_client_secret: headers.findIndex(h => h.includes('ch2') && h.includes('prod') && h.includes('secret')),
    business_group: headers.findIndex(h => h.includes('business') && h.includes('group') || h.includes('bg') || h.includes('bussiness')),
  };

  const results = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = parseCsvLine(lines[i]);
    const getVal = (idx) => idx >= 0 && idx < parts.length ? parts[idx].replace(/^"|"$/g, '').trim() : '';
    
    const bg = getVal(idxMap.business_group);
    if (!bg) continue;

    results.push({
      businessGroup: bg,
      ch1: {
        uat: { clientId: getVal(idxMap.ch1_uat_client_id), clientSecret: getVal(idxMap.ch1_uat_client_secret) },
        prod: { clientId: getVal(idxMap.ch1_prod_client_id), clientSecret: getVal(idxMap.ch1_prod_client_secret) },
      },
      ch2: {
        uat: { clientId: getVal(idxMap.ch2_uat_client_id), clientSecret: getVal(idxMap.ch2_uat_client_secret) },
        prod: { clientId: getVal(idxMap.ch2_prod_client_id), clientSecret: getVal(idxMap.ch2_prod_client_secret) },
      }
    });
  }

  return results;
}
