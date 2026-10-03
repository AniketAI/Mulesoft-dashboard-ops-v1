const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { createClient } = require('../utils/anypointClient');
const { stripDeploymentSuffix } = require('../utils/appHelpers');
const { sendProxyError } = require('../utils/responseHelpers');

// Search Exchange assets
router.get('/search', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    const {
      search = '',
      type,
      organizationId,
      offset = 0,
      limit = 20,
      sortBy = 'updatedAt',
      ascending = false
    } = req.query;

    const params = { offset, limit, sortBy, ascending };
    if (search) params.search = search;
    if (type) params.type = type;
    if (organizationId) params.organizationId = organizationId;

    const response = await client.get('/exchange/api/v2/assets', { params });
    res.json(response.data);
  } catch (error) {
    sendProxyError(res, error, 'Failed to search Exchange');
  }
});

// Organization assets summary
router.get('/org/:orgId/summary', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    const types = ['rest-api', 'soap-api', 'http-api', 'mule-application', 'mule-plugin', 'template', 'example'];
    const counts = {};

    await Promise.all(
      types.map(async (type) => {
        try {
          const response = await client.get('/exchange/api/v2/assets', {
            params: { organizationId: req.params.orgId, type, limit: 1 }
          });
          counts[type] = response.data.total || 0;
        } catch {
          counts[type] = 0;
        }
      })
    );

    res.json({ organizationId: req.params.orgId, assetCounts: counts });
  } catch (error) {
    sendProxyError(res, error, 'Failed to fetch Exchange summary');
  }
});

// Get asset versions list — MUST be before /:groupId/:assetId/:version to avoid collision
router.get('/:groupId/:assetId/versions', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    const response = await client.get(
      `/exchange/api/v2/assets/${req.params.groupId}/${req.params.assetId}`
    );
    res.json(response.data);
  } catch (error) {
    sendProxyError(res, error, 'Failed to fetch asset versions');
  }
});

// Get a specific Exchange asset by version — keep AFTER /versions route
router.get('/:groupId/:assetId/:version', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    const response = await client.get(
      `/exchange/api/v2/assets/${req.params.groupId}/${req.params.assetId}/${req.params.version}`
    );
    res.json(response.data);
  } catch (error) {
    sendProxyError(res, error, 'Failed to fetch Exchange asset');
  }
});

// ─── GET /api/exchange/ping-spec ─────────────────────────────────────────────
/**
 * Fetch and parse an API spec from Exchange to discover ping/health endpoints
 * along with their query parameters and required headers.
 *
 * Returns:
 *   {
 *     specType: 'oas' | 'raml' | 'unknown',
 *     pingEndpoints: [{ path, method, description, queryParams, headers }],
 *     allEndpoints: [...]
 *   }
 */
router.get('/ping-spec', authMiddleware, async (req, res) => {
  let { groupId, assetId, version, orgId, appName } = req.query;

  // ── Shared local helpers for spec parsing ────────────────────────────────

  /**
   * Convert a RAML queryParameters / headers object into the canonical
   * param array shape.  Used by walkResources for both RAML model shapes.
   */
  const toArr = (obj) =>
    Object.entries(obj || {}).map(([name, v]) => ({
      name,
      required: v.required === true || v.required === 'true',
      type: v.type || 'string',
      description: v.description || '',
      example: v.example != null ? String(v.example) : '',
    }));

  /**
   * Recursively walk a RAML resources tree and push endpoint objects into
   * the provided `out` array.
   *
   * @param {Array}  resources   RAML resource nodes
   * @param {string} parentPath  Accumulated path prefix
   * @param {Array}  out         Output array to push into
   * @param {boolean} useDisplayName  Whether to prefer displayName over description
   */
  const walkResources = (resources = [], parentPath = '', out = [], useDisplayName = false) => {
    for (const r of resources) {
      const path = parentPath + (r.relativeUri || r.path || '');
      for (const m of (r.methods || [])) {
        const method = (m.method || 'GET').toUpperCase();
        out.push({
          path,
          method,
          description: useDisplayName
            ? (m.description || m.displayName || '')
            : (m.description || ''),
          queryParams: toArr(m.queryParameters),
          headers: toArr(m.headers),
        });
      }
      if (r.resources?.length) walkResources(r.resources, path, out, useDisplayName);
    }
  };

  /**
   * Extract query or header params from an OAS parameters array.
   *
   * @param {Array}  params    OAS parameters array (path-level + operation-level merged)
   * @param {string} inFilter  'query' or 'header'
   */
  const extractOasParams = (params = [], inFilter) =>
    params
      .filter(p => p.in === inFilter)
      .map(p => ({
        name: p.name,
        required: !!p.required,
        type: p.schema?.type || p.type || 'string',
        description: p.description || '',
        example:
          p.example != null
            ? String(p.example)
            : p.schema?.example != null
            ? String(p.schema.example)
            : '',
      }));

  // If groupId/assetId/version not provided but appName is, search Exchange.
  // Use stripDeploymentSuffix (shared with health.js) to normalise the name.
  if ((!groupId || !assetId || !version) && appName && orgId) {
    try {
      const client = createClient(req.anypointToken);

      const normalizedName = stripDeploymentSuffix(appName);

      const parts = normalizedName.split('-').filter(Boolean);
      const prefix3 = parts.length >= 3 ? parts.slice(0, 3).join('-') : null;
      const prefix4 = parts.length >= 4 ? parts.slice(0, 4).join('-') : null;

      const searchTerms = [
        appName,
        normalizedName,
        prefix4,
        prefix3,
        `${normalizedName}-api`,
      ].filter((t, i, a) => t && a.indexOf(t) === i);
      console.log(`[ping-spec] Searching Exchange by: "${searchTerms.slice(0, 3).join('", "')}" (+variants) in org ${orgId}`);

      const searchStrategies = [
        { orgParam: orgId },
        { orgParam: undefined },
      ];

      const scoreAsset = (a) => {
        const aid = (a.assetId || '').toLowerCase();
        const nm = normalizedName;
        const pts = nm.split('-').filter(Boolean);
        let score = 0;
        if (aid === nm) score += 10;
        else if (aid.startsWith(nm)) score += 8;
        else if (pts.length >= 3 && aid.includes(pts.slice(0, 3).join('-'))) score += 6;
        else if (pts.length >= 2 && aid.includes(pts.slice(0, 2).join('-'))) score += 4;
        else if (pts.length >= 1 && aid.startsWith(pts[0])) score += 2;
        return score;
      };

      const allFoundAssets = new Map();

      for (const { orgParam } of searchStrategies) {
        for (const term of searchTerms) {
          try {
            const params = { search: term, limit: 10, type: 'rest-api' };
            if (orgParam) params.organizationId = orgParam;
            const searchRes = await client.get('/exchange/api/v2/assets', { params });
            const searchResults = Array.isArray(searchRes.data)
              ? searchRes.data
              : (searchRes.data?.assets || []);
            for (const a of searchResults) {
              const key = `${a.groupId}/${a.assetId}/${a.version}`;
              if (!allFoundAssets.has(key)) allFoundAssets.set(key, a);
            }
          } catch { /* skip failed search terms */ }
        }
        if (allFoundAssets.size > 0) break;
      }

      // Direct assetId variant probing
      const assetIdVariants = [
        `${normalizedName}-ch2-api`,
        `${normalizedName}-ch1-api`,
        `${normalizedName}-api`,
        `${normalizedName}-ch2`,
        `${normalizedName}-sapi-api`,
        `${normalizedName}-xapi-api`,
        `${normalizedName}-papi-api`,
      ];

      for (const variantId of assetIdVariants) {
        const orgIds = [...new Set(
          [...allFoundAssets.values()].map(a => a.groupId).concat([orgId])
        )];
        for (const gId of orgIds) {
          try {
            const probe = await client.get(`/exchange/api/v2/assets/${gId}/${variantId}`);
            const probeData = probe.data;
            const versions = probeData?.versions || (Array.isArray(probeData) ? probeData : [probeData]);
            const latestVersion = versions[0]?.version || probeData?.version;
            if (latestVersion) {
              const key = `${gId}/${variantId}/${latestVersion}`;
              if (!allFoundAssets.has(key)) {
                allFoundAssets.set(key, {
                  groupId: gId, assetId: variantId, version: latestVersion,
                  name: probeData.name || variantId,
                });
                console.log(`[ping-spec] Direct probe found: ${gId}/${variantId}/${latestVersion}`);
              }
              break;
            }
          } catch { /* 404 = doesn't exist */ }
        }
      }

      if (allFoundAssets.size > 0) {
        const scored = Array.from(allFoundAssets.values())
          .map(a => ({ a, score: scoreAsset(a) }))
          .sort((x, y) => y.score - x.score);
        const best = scored[0].a;
        groupId = best.groupId;
        assetId = best.assetId;
        version = best.version;
        req._extraCandidates = scored.slice(1).map(s => ({
          groupId: s.a.groupId, assetId: s.a.assetId, version: s.a.version
        }));
        console.log(`[ping-spec] Best candidate: ${groupId}/${assetId}/${version} (score=${scored[0].score})`);
        if (scored.length > 1) {
          console.log(`[ping-spec] ${scored.length - 1} runner-up(s): ${scored.slice(1, 5).map(s => `${s.a.assetId}/${s.a.version}(${s.score})`).join(', ')}`);
        }
      } else {
        console.log('[ping-spec] Name search exhausted all strategies — no asset found');
      }
    } catch (searchErr) {
      console.warn('[ping-spec] Name search failed:', searchErr.message);
    }
  }

  let assetCandidates = [];
  if (groupId && assetId && version) {
    assetCandidates = [{ groupId, assetId, version }];
  } else {
    return res.status(404).json({
      error: 'Could not resolve Exchange asset for this app. Ensure the app has an Exchange asset linked.',
      specType: 'unknown', pingEndpoints: [], allEndpoints: []
    });
  }

  if (req._extraCandidates?.length) {
    assetCandidates.push(...req._extraCandidates);
  }

  try {
    const client = createClient(req.anypointToken);

    const PING_KEYWORDS = ['ping', 'health', 'status', 'liveness', 'readiness', 'heartbeat'];
    const isPingPath = (path) => PING_KEYWORDS.some(k => (path || '').toLowerCase().includes(k));

    let assetName = assetId;
    let specType = 'unknown';
    let allEndpoints = [];

    for (const candidate of assetCandidates) {
      groupId = candidate.groupId;
      assetId = candidate.assetId;
      version = candidate.version;
      assetName = assetId;
      specType = 'unknown';
      allEndpoints = [];
      let modelParsed = false;

      // ── Step 1: Try the Exchange Portal Model API ──────────────────────
      try {
        const modelRes = await client.get(
          `/exchange/api/v2/assets/${groupId}/${assetId}/${version}/portal/model`
        );
        const model = modelRes.data;

        if (Array.isArray(model)) {
          console.log(`[ping-spec] Portal model is Array, length=${model.length}, first item keys:`, Object.keys(model[0] || {}).slice(0, 6));
        } else if (model && typeof model === 'object') {
          console.log(`[ping-spec] Portal model is Object, top-level keys:`, Object.keys(model).slice(0, 10));
        }

        // Helper: safely extract string value from AMF scalar node
        const scalar = (node) => {
          if (!node) return '';
          if (typeof node === 'string') return node;
          if (Array.isArray(node)) return scalar(node[0]);
          if (typeof node === 'object') {
            return node['@value'] || node.value || node.lexicalValue || '';
          }
          return String(node);
        };

        const boolVal = (node) => {
          const v = scalar(node);
          return v === true || v === 'true';
        };

        // Extract param list from AMF parameter nodes
        const extractAmfParams = (params = []) =>
          params.map(p => {
            const name = scalar(
              p['http://a.ml/vocabularies/apiContract#paramName'] ||
              p['http://schema.org/name'] ||
              p['@id'] || ''
            );
            const required = boolVal(
              p['http://a.ml/vocabularies/shapes#required'] ||
              p['http://www.w3.org/ns/hydra/core#required']
            );
            const schema = (p['http://a.ml/vocabularies/shapes#range'] || [])[0] || {};
            const type = scalar(
              schema['http://www.w3.org/1999/02/22-rdf-syntax-ns#type'] ||
              schema['xsd:type'] || schema['@type'] || 'string'
            ).replace(/.*#/, '').toLowerCase();
            const description = scalar(
              p['http://schema.org/description'] ||
              p['http://a.ml/vocabularies/core#description'] || ''
            );
            const example = scalar(
              p['http://a.ml/vocabularies/document#examples'] ||
              p['http://a.ml/vocabularies/apiContract#examples'] || ''
            );
            return { name, required, type: type || 'string', description, example };
          }).filter(p => p.name);

        // Shape A: AMF JSON-LD graph (array of @id nodes)
        if (Array.isArray(model) && model[0]?.['@type']) {
          specType = 'amf-jsonld';
          const docNode = model.find(n =>
            (n['@type'] || []).some(t => t.includes('Document') || t.includes('ParsedUnit'))
          ) || model[0];

          const encodes = docNode?.['http://a.ml/vocabularies/document#encodes'] || [];
          const apiNode = encodes[0] || {};
          assetName = scalar(
            apiNode['http://schema.org/name'] || apiNode['http://a.ml/vocabularies/core#name']
          ) || assetId;

          const allNodes = model;
          const nodeMap = {};
          for (const n of allNodes) {
            if (n['@id']) nodeMap[n['@id']] = n;
          }

          const deref = (node) => {
            if (!node) return node;
            if (Array.isArray(node)) return node.map(deref);
            if (typeof node === 'object' && node['@id'] && Object.keys(node).length === 1) {
              return nodeMap[node['@id']] || node;
            }
            return node;
          };

          const PATH_KEY    = 'http://a.ml/vocabularies/apiContract#path';
          const OP_KEY      = 'http://a.ml/vocabularies/apiContract#supportedOperation';
          const METHOD_KEY  = 'http://a.ml/vocabularies/apiContract#method';
          const EXPECTS_KEY = 'http://a.ml/vocabularies/apiContract#expects';
          const PARAM_KEY   = 'http://a.ml/vocabularies/apiContract#parameter';
          const HEADER_KEY  = 'http://a.ml/vocabularies/apiContract#header';

          for (const node of allNodes) {
            if (!node[PATH_KEY]) continue;
            const path = scalar(node[PATH_KEY]);
            if (!path) continue;
            const operations = (node[OP_KEY] || []).map(deref).flat().filter(Boolean);
            for (const op of operations) {
              const realOp = deref(op);
              if (!realOp) continue;
              const method = scalar(
                realOp[METHOD_KEY] || (Array.isArray(realOp) ? realOp[0]?.[METHOD_KEY] : null)
              ).toUpperCase() || 'GET';
              const description = scalar(
                realOp['http://schema.org/description'] ||
                realOp['http://a.ml/vocabularies/core#name'] || ''
              );
              const expects = ((realOp[EXPECTS_KEY] || []).map(deref).flat().filter(Boolean))[0] || {};
              const qpNodes = (expects[PARAM_KEY] || []).map(deref).flat().filter(Boolean);
              const hdrNodes = (expects[HEADER_KEY] || []).map(deref).flat().filter(Boolean);
              allEndpoints.push({
                path, method, description,
                queryParams: extractAmfParams(qpNodes),
                headers: extractAmfParams(hdrNodes),
              });
            }
          }
          if (allEndpoints.length > 0) {
            console.log(`[ping-spec] AMF JSON-LD: extracted ${allEndpoints.length} endpoint(s)`);
          }
          modelParsed = allEndpoints.length > 0;
        }

        // Shape B: RAML-style plain object with `resources` array
        if (!modelParsed && model && typeof model === 'object' && !Array.isArray(model)) {
          specType = model.specType || (model.resources ? 'raml' : 'oas');
          assetName = model.title || model.name || assetId;

          if (model.resources) {
            walkResources(model.resources, '', allEndpoints, true);
            modelParsed = allEndpoints.length > 0;
          }

          if (!modelParsed && model.paths) {
            specType = 'oas';
            const bp = (model.basePath || '').replace(/\/+$/, '');
            for (const [rawPath, pathItem] of Object.entries(model.paths)) {
              const normalizedRaw = ('/' + rawPath.replace(/^\/+/, '')).replace(/\/\//g, '/');
              const fullPath = (bp + normalizedRaw).replace(/\/\//g, '/');
              for (const meth of ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']) {
                const op = pathItem[meth];
                if (!op) continue;
                const params = [...(pathItem.parameters || []), ...(op.parameters || [])];
                allEndpoints.push({
                  path: fullPath,
                  method: meth.toUpperCase(),
                  description: op.summary || op.description || '',
                  queryParams: extractOasParams(params, 'query'),
                  headers: extractOasParams(params, 'header'),
                });
              }
            }
            modelParsed = allEndpoints.length > 0;
          }
        }

        // Shape C: Array of resources (some older console formats)
        if (!modelParsed && Array.isArray(model) && model[0]?.relativeUri) {
          specType = 'raml';
          walkResources(model, '', allEndpoints, false);
          modelParsed = allEndpoints.length > 0;
        }

      } catch (modelErr) {
        console.warn(`[ping-spec] Portal model API failed (${modelErr.response?.status || modelErr.message}), falling back to asset file download`);
      }

      // ── Step 2: Fallback — download and parse the spec file ─────────────
      if (!modelParsed) {
        const axios = require('axios');
        const zlib  = require('zlib');

        const extractFromZip = (buf) => {
          try {
            const cdEntries = [];
            let pos = 0;
            while (pos < buf.length - 4) {
              if (buf[pos]===0x50 && buf[pos+1]===0x4b && buf[pos+2]===0x01 && buf[pos+3]===0x02) {
                const compMethod  = buf.readUInt16LE(pos + 10);
                const compSize    = buf.readUInt32LE(pos + 20);
                const uncompSize  = buf.readUInt32LE(pos + 24);
                const fnLen       = buf.readUInt16LE(pos + 28);
                const extraLen    = buf.readUInt16LE(pos + 30);
                const commentLen  = buf.readUInt16LE(pos + 32);
                const localOffset = buf.readUInt32LE(pos + 42);
                const fn = buf.slice(pos + 46, pos + 46 + fnLen).toString('utf8');
                cdEntries.push({ fn, compMethod, compSize, uncompSize, localOffset });
                pos += 46 + fnLen + extraLen + commentLen;
              } else { pos++; }
            }
            const specEntry = cdEntries.find(e => e.fn === 'api.json')
              || cdEntries.find(e => e.fn.endsWith('.json') && e.fn !== 'exchange.json')
              || cdEntries.find(e => e.fn.endsWith('.yaml') || e.fn.endsWith('.yml'))
              || cdEntries.find(e => e.fn.endsWith('.raml') && e.fn !== 'exchange.json');
            if (!specEntry) {
              console.warn('[ping-spec] No spec file found in ZIP. Entries:', cdEntries.map(e => e.fn).slice(0, 15).join(', '));
              return null;
            }
            console.log(`[ping-spec] ZIP spec entry selected: "${specEntry.fn}" (method=${specEntry.compMethod}, size=${specEntry.uncompSize})`);
            const lh = specEntry.localOffset;
            const lfnLen    = buf.readUInt16LE(lh + 26);
            const lextraLen = buf.readUInt16LE(lh + 28);
            const dataStart = lh + 30 + lfnLen + lextraLen;
            const compressed = buf.slice(dataStart, dataStart + specEntry.compSize);
            const raw = specEntry.compMethod === 8
              ? zlib.inflateRawSync(compressed)
              : compressed;
            return raw.toString('utf8');
          } catch (e) {
            console.warn('[ping-spec] ZIP extraction error:', e.message);
            return null;
          }
        };

        try {
          const assetRes = await client.get(`/exchange/api/v2/assets/${groupId}/${assetId}/${version}`);
          const asset = assetRes.data;
          assetName = asset.name || assetId;
          const files = asset.files || [];

          const findFile = (...classifiers) => {
            for (const c of classifiers) {
              const f = files.find(fi => fi.classifier === c);
              if (f) return f;
            }
            return null;
          };
          const oasFile  = findFile('fat-oas', 'oas');
          const ramlFile = findFile('fat-raml', 'raml');
          const specFile = oasFile || ramlFile;

          if (specFile?.externalLink) {
            const isS3 = specFile.externalLink.includes('s3.amazonaws.com');
            const dlRes = await axios.get(specFile.externalLink, {
              headers: isS3 ? {} : { Authorization: `Bearer ${req.anypointToken}` },
              responseType: 'arraybuffer',
              timeout: 20000,
            });
            const buf = Buffer.from(dlRes.data);
            const isZip = buf[0] === 0x50 && buf[1] === 0x4b;
            let content;
            if (isZip) {
              content = extractFromZip(buf);
              console.log('[ping-spec] ZIP extracted:', content ? `${content.length} chars` : 'FAILED');
            } else {
              content = buf.toString('utf8');
            }
            if (!content) throw new Error('Could not extract spec content from file');

            if (oasFile) {
              specType = 'oas';
              let spec = null;
              try { spec = JSON.parse(content); } catch {
                try {
                  spec = require('js-yaml').load(content);
                  console.log('[ping-spec] OAS spec parsed as YAML');
                } catch (yamlErr) {
                  console.warn('[ping-spec] YAML parse failed:', yamlErr.message);
                }
              }
              if (spec?.paths) {
                let bp = (spec.basePath || '').replace(/\/+$/, '');
                if (!bp && spec.servers?.[0]?.url) {
                  try {
                    bp = new URL(spec.servers[0].url).pathname.replace(/\/+$/, '');
                  } catch {
                    const su = spec.servers[0].url || '';
                    bp = su.startsWith('/') ? su.replace(/\/+$/, '') : '';
                  }
                }
                console.log(`[ping-spec] OAS ${spec.openapi || spec.swagger || '?'}: ${Object.keys(spec.paths).length} path(s), basePath="${bp}"`);
                for (const [rawPath, pathItem] of Object.entries(spec.paths)) {
                  const normalizedPath = ('/' + rawPath.replace(/^\/+/, '')).replace(/\/\//g, '/');
                  for (const meth of ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']) {
                    const op = pathItem[meth];
                    if (!op) continue;
                    const params = [...(pathItem.parameters || []), ...(op.parameters || [])];
                    allEndpoints.push({
                      path: (bp + normalizedPath).replace(/\/\//g, '/'),
                      method: meth.toUpperCase(),
                      description: op.summary || op.description || '',
                      queryParams: extractOasParams(params, 'query'),
                      headers: extractOasParams(params, 'header'),
                    });
                  }
                }
              } else if (spec) {
                console.warn(`[ping-spec] OAS spec parsed but has no "paths". Top-level keys: ${Object.keys(spec).slice(0, 10).join(', ')}`);
              }
            } else if (ramlFile) {
              specType = 'raml';
              // Basic regex fallback for RAML text
              const lines = content.split('\n');
              let curPath = '', curEp = null, inQp = false, inHdr = false, curParam = '';
              for (const line of lines) {
                const pm = line.match(/^(\/[\w\-\/{}]*):\s*$/);
                if (pm) { curPath = pm[1]; curEp = null; inQp = false; inHdr = false; continue; }
                const mm = line.match(/^  (get|post|put|delete|patch):\s*$/);
                if (mm && curPath) {
                  curEp = { path: curPath, method: mm[1].toUpperCase(), description: '', queryParams: [], headers: [] };
                  allEndpoints.push(curEp); inQp = false; inHdr = false; continue;
                }
                if (curEp) {
                  if (/^    queryParameters:\s*$/.test(line)) { inQp = true; inHdr = false; continue; }
                  if (/^    headers:\s*$/.test(line)) { inHdr = true; inQp = false; continue; }
                  const paramM = line.match(/^      ([\w\-]+):\s*$/);
                  if (paramM && (inQp || inHdr)) {
                    curParam = paramM[1];
                    const p = { name: curParam, required: false, type: 'string', description: '', example: '' };
                    if (inQp) curEp.queryParams.push(p); else curEp.headers.push(p);
                    continue;
                  }
                  const propM = line.match(/^        (type|description|example|required):\s*(.+)$/);
                  if (propM && curParam) {
                    const arr = inQp ? curEp.queryParams : curEp.headers;
                    const p = arr.find(x => x.name === curParam);
                    if (p) {
                      const v = propM[2].trim().replace(/^["']|["']$/g, '');
                      if (propM[1] === 'type') p.type = v;
                      else if (propM[1] === 'description') p.description = v;
                      else if (propM[1] === 'example') p.example = v;
                      else if (propM[1] === 'required') p.required = v === 'true';
                    }
                  }
                }
              }
            }
          }
        } catch (fbErr) {
          console.warn('[ping-spec] Fallback file download also failed:', fbErr.message);
        }
      }

      // Done with this candidate — check if we got any endpoints
      const pingEndpoints = allEndpoints.filter(e => isPingPath(e.path));
      console.log(`[ping-spec] ${groupId}/${assetId}/${version} (${specType}): ${allEndpoints.length} endpoints, ${pingEndpoints.length} ping path(s)`);
      if (allEndpoints.length > 0) {
        return res.json({ specType, assetName, pingEndpoints, allEndpoints });
      }
      if (assetCandidates.length > 1) {
        console.log(`[ping-spec] 0 endpoints for ${assetId}/${version}, trying next candidate…`);
      }
    } // end candidate loop

    // All candidates exhausted with 0 endpoints
    console.log('[ping-spec] All candidates exhausted — returning empty spec');
    return res.json({ specType: 'unknown', assetName, pingEndpoints: [], allEndpoints: [] });

  } catch (error) {
    console.error('[ping-spec] Error:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.message || 'Failed to fetch ping spec',
      specType: 'unknown',
      pingEndpoints: [],
      allEndpoints: [],
    });
  }
});

module.exports = router;
