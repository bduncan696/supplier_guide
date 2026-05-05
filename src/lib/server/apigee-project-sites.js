import { env } from '$env/dynamic/private';

/** @typedef {'nonprod' | 'development' | 'dev' | 'test' | 'prod' | 'production'} ApigeeEnvKey */
/** @typedef {{ source: string, sites: ProjectSite[], loadedAt: number, error?: string, projectCode?: string }} ProjectSitesPayload */
/** @typedef {{ type: string, id: string, name: string, address: string, address_line_1?: string, address_line_2?: string, address_line_3?: string, city: string, state: string, zip: string }} ProjectSite */
/** @typedef {{ retryOnUnauthorized?: boolean }} GetOptions */
/** @typedef {Record<string, string | number | boolean | null | undefined>} QueryParams */

const DEFAULT_NONPROD_BASE_URL = 'https://api-nonprod.burnsmcd.app/epc-tools-external';
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_TOKEN_REFRESH_WINDOW_MS = 30000;
const DEFAULT_RETRY_COUNT = 1;
const DEFAULT_RETRY_DELAY_MS = 250;

/** @type {Record<ApigeeEnvKey, string>} */
const APIGEE_ENV_CONFIG = {
	nonprod: DEFAULT_NONPROD_BASE_URL,
	development: DEFAULT_NONPROD_BASE_URL,
	dev: DEFAULT_NONPROD_BASE_URL,
	test: DEFAULT_NONPROD_BASE_URL,
	prod: DEFAULT_NONPROD_BASE_URL,
	production: DEFAULT_NONPROD_BASE_URL
};

/** @type {{ token: string, expiresAt: number } | null} */
let tokenCache = null;

/** @type {Map<string, ProjectSitesPayload>} */
const projectSitesFallbackCache = new Map();
/** @type {ProjectSitesPayload | null} */
let lastProjectSitesFallback = null;

/** @param {unknown} value
 * @param {number} fallback
 */
const toPositiveInt = (value, fallback) => {
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
	return Math.floor(parsed);
};

const getTimeoutMs = () => toPositiveInt(env.APIGEE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
const getTokenRefreshWindowMs = () =>
	toPositiveInt(env.APIGEE_TOKEN_REFRESH_WINDOW_MS, DEFAULT_TOKEN_REFRESH_WINDOW_MS);
const getRetryCount = () => toPositiveInt(env.APIGEE_RETRY_COUNT, DEFAULT_RETRY_COUNT);
const getRetryDelayMs = () => toPositiveInt(env.APIGEE_RETRY_DELAY_MS, DEFAULT_RETRY_DELAY_MS);

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const resolveBaseUrl = () => {
	const explicit = String(env.APIGEE_BASE_URL ?? '').trim();
	if (explicit) return explicit.replace(/\/$/, '');

	const rawEnv = String(env.APIGEE_ENV ?? 'nonprod').trim().toLowerCase();
	const envKey = /** @type {ApigeeEnvKey} */ (
		rawEnv in APIGEE_ENV_CONFIG ? rawEnv : 'nonprod'
	);
	return APIGEE_ENV_CONFIG[envKey].replace(/\/$/, '');
};

const resolveCredentials = () => {
	const key = String(env.APIGEE_CONSUMER_KEY ?? env.APIGEE_CLIENT_ID ?? '').trim();
	const secret = String(env.APIGEE_CONSUMER_SECRET ?? env.APIGEE_CLIENT_SECRET ?? '').trim();
	if (!key || !secret) {
		throw new Error('Missing APIGEE credentials. Set APIGEE_CONSUMER_KEY and APIGEE_CONSUMER_SECRET.');
	}
	return { key, secret };
};

/** @param {string} value */
const toBase64 = (value) => {
	if (typeof btoa === 'function') return btoa(value);
	const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
	let output = '';
	for (let i = 0; i < value.length; i += 3) {
		const c1 = value.charCodeAt(i);
		const c2 = i + 1 < value.length ? value.charCodeAt(i + 1) : NaN;
		const c3 = i + 2 < value.length ? value.charCodeAt(i + 2) : NaN;
		const n = (c1 << 16) | ((Number.isNaN(c2) ? 0 : c2) << 8) | (Number.isNaN(c3) ? 0 : c3);
		output += alphabet[(n >> 18) & 63];
		output += alphabet[(n >> 12) & 63];
		output += Number.isNaN(c2) ? '=' : alphabet[(n >> 6) & 63];
		output += Number.isNaN(c3) ? '=' : alphabet[n & 63];
	}
	return output;
};

/** @param {RequestInfo | URL} input
 * @param {RequestInit} [init]
 */
const withTimeout = async (input, init = {}) => {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), getTimeoutMs());
	try {
		return await fetch(input, { ...init, signal: controller.signal });
	} finally {
		clearTimeout(timeout);
	}
};

const requestToken = async () => {
	const { key, secret } = resolveCredentials();
	const baseUrl = resolveBaseUrl();
	const basic = toBase64(`${key}:${secret}`);
	const body = new URLSearchParams({ grant_type: 'client_credentials' });

	const response = await withTimeout(`${baseUrl}/token`, {
		method: 'POST',
		headers: {
			Authorization: `Basic ${basic}`,
			'Content-Type': 'application/x-www-form-urlencoded',
			Accept: 'application/json'
		},
		body: body.toString()
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`APIGEE token request failed (${response.status}): ${text}`);
	}

	const payload = await response.json();
	const accessToken = String(payload?.access_token ?? '').trim();
	const expiresInSec = Number(payload?.expires_in ?? 1800);
	if (!accessToken) throw new Error('APIGEE token response missing access_token');

	const refreshWindowMs = getTokenRefreshWindowMs();
	const expiresAt = Date.now() + Math.max(1, expiresInSec) * 1000 - refreshWindowMs;
	tokenCache = { token: accessToken, expiresAt };
	return tokenCache.token;
};

const getAccessToken = async () => {
	if (tokenCache && tokenCache.expiresAt > Date.now()) {
		return tokenCache.token;
	}
	return requestToken();
};

/** @param {Response} response */
const parseApigeeError = async (response) => {
	const text = await response.text();
	if (!text) return `${response.status}`;
	try {
		const payload = JSON.parse(text);
		const code = String(payload?.code ?? '').trim();
		const message = String(payload?.message ?? '').trim();
		if (code || message) return [code, message].filter(Boolean).join(': ');
		return text;
	} catch {
		return text;
	}
};

/** @param {string} path
 * @param {QueryParams | null} [searchParams]
 * @param {GetOptions} [options]
 */
const apigeeGet = async (path, searchParams = null, options = {}) => {
	const { retryOnUnauthorized = true } = options;
	const url = new URL(`${resolveBaseUrl()}${path}`);
	if (searchParams) {
		for (const [key, value] of Object.entries(searchParams)) {
			if (value === undefined || value === null) continue;
			const str = String(value).trim();
			if (str) url.searchParams.set(key, str);
		}
	}

	let attemptsRemaining = getRetryCount() + 1;
	let attemptedUnauthorizedRefresh = false;

	while (attemptsRemaining > 0) {
		attemptsRemaining -= 1;
		const token = await getAccessToken();
		const response = await withTimeout(url.toString(), {
			method: 'GET',
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: 'application/json'
			}
		});

		if (response.ok) return response.json();

		if (response.status === 401 && retryOnUnauthorized && !attemptedUnauthorizedRefresh) {
			attemptedUnauthorizedRefresh = true;
			tokenCache = null;
			continue;
		}

		if ((response.status >= 500 || response.status === 429) && attemptsRemaining > 0) {
			await sleep(getRetryDelayMs());
			continue;
		}

		const details = await parseApigeeError(response);
		throw new Error(`APIGEE GET ${path} failed (${response.status}): ${details}`);
	}

	throw new Error(`APIGEE GET ${path} failed after retry attempts`);
};

/** @param {unknown} value */
const asString = (value) => String(value ?? '').trim();

/** @param {string | null | undefined} value */
export const extractProjectCode = (value) => {
	const match = String(value ?? '')
		.trim()
		.match(/^([A-Za-z0-9.-]+)/);
	return match ? match[1].trim() : '';
};

/** @param {any} row
 * @param {string[]} keys
 */
const pickFirstString = (row, keys) => {
	for (const key of keys) {
		const resolved = asString(row?.[key]);
		if (resolved) return resolved;
	}
	return '';
};

/** @param {any} row */
const joinAddressLines = (row) =>
	[
		pickFirstString(row, ['address_line_1', 'address1', 'street_1', 'line_1']),
		pickFirstString(row, ['address_line_2', 'address2', 'street_2', 'line_2']),
		pickFirstString(row, ['address_line_3', 'address3', 'street_3', 'line_3'])
	]
		.filter(Boolean)
		.join(' ');

/** @param {any} row
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
	const record = /** @type {any} */ (payload);
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
			.map((/** @type {any} */ row) => mapProjectSite(row))
			.filter(
				(/** @type {ProjectSite} */ site) =>
					site.name || site.address || site.city || site.state || site.zip
			)
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
			.map((/** @type {any} */ row) => mapProjectSite(row))
			.filter(
				(/** @type {ProjectSite} */ site) =>
					site.name || site.address || site.city || site.state || site.zip
			)
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
