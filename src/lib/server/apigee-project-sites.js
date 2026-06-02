import { apigeeGet, asString } from './apigee-client.js';

/** @typedef {Record<string, unknown> & { locations?: unknown[], ship_to_locations?: unknown[], project_sites?: unknown[], items?: unknown[], data?: unknown[] }} ProjectSitesPayloadRecord */
/** @typedef {Record<string, unknown>} ProjectSiteRow */
/** @typedef {{ source: string, sites: ProjectSite[], loadedAt: number, error?: string, projectCode?: string }} ProjectSitesPayload */
/** @typedef {{ type: string, id: string, name: string, address: string, address_line_1?: string, address_line_2?: string, address_line_3?: string, city: string, state: string, zip: string }} ProjectSite */

/** @type {Map<string, ProjectSitesPayload>} */
const projectSitesFallbackCache = new Map();
/** @type {ProjectSitesPayload | null} */
let lastProjectSitesFallback = null;

/** @param {string | null | undefined} value */
export const extractProjectCode = (value) => {
	const match = String(value ?? '')
		.trim()
		.match(/^([A-Za-z0-9.-]+)/);
	return match ? match[1].trim() : '';
};

/** @param {ProjectSiteRow | null | undefined} row
 * @param {string[]} keys
 */
const pickFirstString = (row, keys) => {
	for (const key of keys) {
		const resolved = asString(row?.[key]);
		if (resolved) return resolved;
	}
	return '';
};

/** @param {ProjectSiteRow | null | undefined} row */
const joinAddressLines = (row) =>
	[
		pickFirstString(row, ['address_line_1', 'address1', 'street_1', 'line_1']),
		pickFirstString(row, ['address_line_2', 'address2', 'street_2', 'line_2']),
		pickFirstString(row, ['address_line_3', 'address3', 'street_3', 'line_3'])
	]
		.filter(Boolean)
		.join(' ');

/** @param {ProjectSiteRow | null | undefined} row
 * @returns {ProjectSite}
 */
const mapProjectSite = (row) => {
	const projectCode = pickFirstString(row, ['project_code', 'project_number']);
	const projectName = pickFirstString(row, ['project_name', 'project_description']);
	const locationId = pickFirstString(row, [
		'ship_to_location_id',
		'location_id',
		'site_id',
		'id'
	]);
	const locationCode = pickFirstString(row, [
		'ship_to_location_code',
		'location_code',
		'site_code'
	]);
	const locationName = pickFirstString(row, [
		'location_code',
		'ship_to_location_name',
		'location_name',
		'site_name',
		'name'
	]);
	const address =
		joinAddressLines(row) ||
		pickFirstString(row, ['address', 'full_address', 'street_address', 'ship_to_address']);
	const city = pickFirstString(row, ['city', 'city_or_town', 'town']);
	const state = pickFirstString(row, ['state', 'province', 'region']);
	const zip = pickFirstString(row, ['postal_code', 'zip', 'zip_code']);
	const name = locationName || projectName || locationCode || locationId || projectCode;
	const idParts = [projectCode, locationCode || locationId].filter(Boolean);

	return {
		type: pickFirstString(row, ['description', 'address_purpose', 'location_type', 'type']),
		id: idParts.join(' ') || name,
		name,
		address_line_1: pickFirstString(row, ['address_line_1', 'address1', 'street_1', 'line_1']),
		address_line_2: pickFirstString(row, ['address_line_2', 'address2', 'street_2', 'line_2']),
		address_line_3: pickFirstString(row, ['address_line_3', 'address3', 'street_3', 'line_3']),
		address,
		city,
		state,
		zip
	};
};

/** @param {unknown} payload */
const extractRows = (payload) => {
	const record = /** @type {ProjectSitesPayloadRecord | null} */ (payload);
	if (Array.isArray(payload)) return payload;
	if (Array.isArray(record?.locations)) return record.locations;
	if (Array.isArray(record?.ship_to_locations)) return record.ship_to_locations;
	if (Array.isArray(record?.project_sites)) return record.project_sites;
	if (Array.isArray(record?.items)) return record.items;
	if (Array.isArray(record?.data)) return record.data;
	return [];
};

/** @param {ProjectSite[]} sites */
const dedupeSites = (sites) => {
	const seen = new Set();
	return sites.filter((site) => {
		const key = [site.name, site.address, site.city, site.state, site.zip].join('|');
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
};

/** @param {string} projectCode
 * @param {ProjectSite[]} sites
 */
const cacheProjectSitesResult = (projectCode, sites) => {
	const payload = {
		source: 'apigee',
		projectCode,
		sites,
		loadedAt: Date.now()
	};
	projectSitesFallbackCache.set(projectCode, payload);
	lastProjectSitesFallback = payload;
};

/** @param {string} projectCode */
const getCachedProjectSitesResult = (projectCode) =>
	projectSitesFallbackCache.get(projectCode) ?? lastProjectSitesFallback;

/** @param {string | null | undefined} projectLookupValue */
export const fetchProjectSitesFromApigee = async (projectLookupValue) => {
	const projectCode = extractProjectCode(projectLookupValue);
	if (!projectCode) {
		return { source: 'none', sites: [], loadedAt: Date.now() };
	}

	const payload = await apigeeGet('/api/ship-to-locations/search', {
		project_code: projectCode
	});
	const sites = dedupeSites(
		extractRows(payload)
			.map((row) => mapProjectSite(/** @type {ProjectSiteRow} */ (row)))
			.filter((site) => site.name || site.address || site.city || site.state || site.zip)
	);

	cacheProjectSitesResult(projectCode, sites);
	return {
		source: 'apigee',
		projectCode,
		sites,
		loadedAt: Date.now()
	};
};

/** Ready for a future fallback path when project_number is not present. */
export const fetchAllProjectSitesFromApigee = async () => {
	const payload = await apigeeGet('/api/ship-to-locations');
	return dedupeSites(
		extractRows(payload)
			.map((row) => mapProjectSite(/** @type {ProjectSiteRow} */ (row)))
			.filter((site) => site.name || site.address || site.city || site.state || site.zip)
	);
};

/** @param {string | null | undefined} projectLookupValue */
export const fetchProjectSitesFromApigeeWithFallback = async (projectLookupValue) => {
	const projectCode = extractProjectCode(projectLookupValue);
	if (!projectCode) {
		return { source: 'none', sites: [], loadedAt: Date.now() };
	}

	try {
		return await fetchProjectSitesFromApigee(projectCode);
	} catch (err) {
		console.error('Failed to load project sites from APIGEE', err);
		const cached = getCachedProjectSitesResult(projectCode);
		if (cached) {
			return {
				source: 'apigee_cache',
				projectCode,
				sites: cached.sites,
				loadedAt: cached.loadedAt,
				error: 'apigee_unavailable'
			};
		}
		throw err;
	}
};
