/**
 * Shared organisation data helpers.
 *
 * The shape used to serialise an organisation to the session / API responses
 * must be consistent across auth.js (login, where the session is first built)
 * and organizations.js (where business-groups are re-fetched as a fallback).
 */

/**
 * Map a raw Anypoint Platform org object to the canonical shape stored in the
 * session and returned to the frontend.
 *
 * @param {{
 *   id: string,
 *   name: string,
 *   domain?: string,
 *   type?: string,
 *   parentId?: string | null,
 *   subOrganizationIds?: string[]
 * }} o  Raw org object from the Anypoint API
 * @returns {{ id, name, domain, type, parentId, subOrganizationIds }}
 */
const mapOrgShape = (o) => ({
  id: o.id,
  name: o.name,
  domain: o.domain,
  type: o.type,
  parentId: o.parentId || null,
  subOrganizationIds: o.subOrganizationIds || [],
});

module.exports = { mapOrgShape };