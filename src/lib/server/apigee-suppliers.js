import { env } from '$env/dynamic/private';
import { normalizeForMatch } from './vendor-sites.js';

/** @typedef {'nonprod' | 'development' | 'dev' | 'test' | 'prod' | 'production'} ApigeeEnvKey */
/** @typedef {{ id: string, name: string, city: string, state: string }} VendorSuggestion */
/** @typedef {{ type: string, id: string, name: string, address: string, city: string, state: string, zip: string, country: string, status: string, status_details: string }} VendorSite */
/** @typedef {{ vendorId?: string | null, vendorName?: string | null }} VendorFilters */
/** @typedef {{ query: string, suggestions: VendorSuggestion[], exactMatch: VendorSuggestion | null, loadedAt: number }} VendorSearchSnapshot */
/** @typedef {{ sites: VendorSite[], loadedAt: number }} VendorSitesSnapshot */
/** @typedef {{ retryOnUnauthorized?: boolean }} GetOptions */
/** @typedef {Record<string, string | number | boolean | null | undefined>} QueryParams */

const DEFAULT_NONPROD_BASE_URL = 'https://api-nonprod.burnsmcd.app/epc-tools-external';
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_TOKEN_REFRESH_WINDOW_MS = 30000;
const DEFAULT_RETRY_COUNT = 1;
const DEFAULT_RETRY_DELAY_MS = 250;
const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 50;
const DEFAULT_VENDOR_MATCH_LIMIT = 20;
const MAX_VENDOR_MATCH_LIMIT = 50;

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

/** @type {Map<string, VendorSitesSnapshot>} */
const vendorSitesFallbackCache = new Map();
/** @type {VendorSitesSnapshot | null} */
let lastVendorSitesFallback = null;

/** @type {Map<string, VendorSearchSnapshot>} */
const vendorSearchFallbackCache = new Map();
/** @type {VendorSearchSnapshot | null} */
let lastVendorSearchFallback = null;

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

/** @param {unknown} value */
const getSearchLimit = (value) => {
	const fallback = toPositiveInt(env.APIGEE_SEARCH_LIMIT, DEFAULT_SEARCH_LIMIT);
	const parsed = Number(value ?? fallback);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.max(1, Math.min(MAX_SEARCH_LIMIT, Math.floor(parsed)));
};

const getVendorMatchLimit = () => {
	const fallback = toPositiveInt(env.APIGEE_VENDOR_MATCH_LIMIT, DEFAULT_VENDOR_MATCH_LIMIT);
	return Math.max(1, Math.min(MAX_VENDOR_MATCH_LIMIT, fallback));
};

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

/** @param {any} site */
const joinAddressLines = (site) =>
	[site?.address_line_1, site?.address_line_2, site?.address_line_3]
		.map((part) => asString(part))
		.filter(Boolean)
		.join(' ');

/** @param {any} supplier
 * @returns {VendorSite[]}
 */
const mapSupplierToVendorSites = (supplier) => {
	const header = supplier?.supplier_header ?? {};
	const supplierId = asString(header?.supplier_number);
	const supplierName = asString(header?.supplier_name);
	const supplierType = asString(header?.supplier_type);
	const supplierStatus = asString(header?.supplier_status);
	const supplierStatusDetails = asString(header?.supplier_status_details);
	const supplierSites = Array.isArray(supplier?.supplier_sites) ? supplier.supplier_sites : [];

	return supplierSites.map((/** @type {any} */ site) => ({
		type: asString(site?.address_purpose) || supplierType,
		id: supplierId,
		name: supplierName,
		address: joinAddressLines(site),
		city: asString(site?.city),
		state: asString(site?.state) || asString(site?.province),
		zip: asString(site?.postal_code),
		country: asString(site?.country),
		status: supplierStatus,
		status_details: supplierStatusDetails
	}));
};

/** @param {any[]} rows */
const dedupeBySupplierNumber = (rows) => {
	const seen = new Set();
	const deduped = [];
	for (const row of rows) {
		const key = asString(row?.supplier_number);
		if (!key || seen.has(key)) continue;
		seen.add(key);
		deduped.push(row);
	}
	return deduped;
};

/** @param {string} query
 * @param {number} limit
 */
const getSearchCacheKey = (query, limit) => `${normalizeForMatch(query)}::${limit}`;

/** @param {string} query
 * @param {number} limit
 * @param {VendorSuggestion[]} suggestions
 * @param {VendorSuggestion | null} exactMatch
 */
const cacheVendorSearchResult = (query, limit, suggestions, exactMatch) => {
	const snapshot = { query, suggestions, exactMatch, loadedAt: Date.now() };
	vendorSearchFallbackCache.set(getSearchCacheKey(query, limit), snapshot);
	lastVendorSearchFallback = snapshot;
};

/** @param {string} query
 * @param {number} limit
 */
const getCachedVendorSearchResult = (query, limit) =>
	vendorSearchFallbackCache.get(getSearchCacheKey(query, limit)) ?? lastVendorSearchFallback;

/** @param {VendorFilters} filters */
const getVendorSitesCacheKey = (filters) => {
	const id = asString(filters.vendorId);
	if (id) return `id:${id}`;
	return `name:${normalizeForMatch(filters.vendorName)}`;
};

/** @param {VendorFilters} filters
 * @param {VendorSite[]} sites
 */
const cacheVendorSitesResult = (filters, sites) => {
	const snapshot = { sites, loadedAt: Date.now() };
	vendorSitesFallbackCache.set(getVendorSitesCacheKey(filters), snapshot);
	lastVendorSitesFallback = snapshot;
};

/** @param {VendorFilters} filters */
const getCachedVendorSitesResult = (filters) =>
	vendorSitesFallbackCache.get(getVendorSitesCacheKey(filters)) ?? lastVendorSitesFallback;

/** @param {string | number | null | undefined} supplierId */
const fetchSupplierById = async (supplierId) => {
	const id = asString(supplierId);
	if (!id) return null;
	return apigeeGet(`/api/suppliers/${encodeURIComponent(id)}`);
};

/** @param {string} query
 * @param {number | null | undefined} requestedLimit
 */
export const searchSuppliers = async (query, requestedLimit) => {
	const trimmed = asString(query);
	const limit = getSearchLimit(requestedLimit);
	if (!trimmed) {
		return { source: 'none', query: trimmed, suggestions: [], exactMatch: null };
	}

	const rows = await apigeeGet('/api/suppliers/search', {
		supplier_name: trimmed,
		limit
	});

	const suppliers = dedupeBySupplierNumber(Array.isArray(rows) ? rows : []);
	/** @type {VendorSuggestion[]} */
	const suggestions = suppliers.map((supplier) => ({
		id: asString(supplier.supplier_number),
		name: asString(supplier.supplier_name),
		city: '',
		state: ''
	}));

	const normalizedQuery = normalizeForMatch(trimmed);
	const exact = suggestions.find((item) => normalizeForMatch(item.name) === normalizedQuery) ?? null;

	cacheVendorSearchResult(trimmed, limit, suggestions, exact);

	return {
		source: 'apigee',
		query: trimmed,
		suggestions,
		exactMatch: exact,
		loadedAt: Date.now()
	};
};

/** @param {string} query
 * @param {number | null | undefined} requestedLimit
 */
export const searchSuppliersWithFallback = async (query, requestedLimit) => {
	const trimmed = asString(query);
	const limit = getSearchLimit(requestedLimit);
	try {
		return await searchSuppliers(trimmed, limit);
	} catch (err) {
		console.error('Failed to search suppliers from APIGEE', err);
		const cached = getCachedVendorSearchResult(trimmed, limit);
		if (cached) {
			return {
				source: 'apigee_cache',
				error: 'apigee_unavailable',
				query: trimmed,
				suggestions: cached.suggestions,
				exactMatch: cached.exactMatch,
				loadedAt: cached.loadedAt
			};
		}
		throw err;
	}
};

/** @param {VendorFilters} filters */
const resolveSupplierCandidates = async (filters) => {
	const resolvedVendorId = asString(filters.vendorId);
	if (resolvedVendorId) {
		return [resolvedVendorId];
	}

	const normalizedName = normalizeForMatch(filters.vendorName);
	if (!normalizedName) return [];

	const matches = await apigeeGet('/api/suppliers/search', {
		supplier_name: filters.vendorName,
		limit: getVendorMatchLimit()
	});
	const suppliers = dedupeBySupplierNumber(Array.isArray(matches) ? matches : []);
	const exactMatches = suppliers.filter(
		(supplier) => normalizeForMatch(supplier?.supplier_name) === normalizedName
	);

	const picked = exactMatches.length > 0 ? exactMatches : suppliers.slice(0, 1);
	return picked.map((supplier) => asString(supplier?.supplier_number)).filter(Boolean);
};

/** @param {VendorFilters} filters */
export const fetchVendorSitesFromApigee = async (filters) => {
	const supplierIds = await resolveSupplierCandidates(filters);
	if (supplierIds.length === 0) {
		/** @type {VendorSite[]} */
		const emptySites = [];
		cacheVendorSitesResult(filters, emptySites);
		return { source: 'apigee', sites: emptySites, loadedAt: Date.now() };
	}

	const supplierResponses = await Promise.all(supplierIds.map((id) => fetchSupplierById(id)));
	const sites = supplierResponses.flatMap((supplier) => mapSupplierToVendorSites(supplier));
	cacheVendorSitesResult(filters, sites);
	return {
		source: 'apigee',
		sites,
		loadedAt: Date.now()
	};
};

/** @param {VendorFilters} filters */
export const fetchVendorSitesFromApigeeWithFallback = async (filters) => {
	try {
		return await fetchVendorSitesFromApigee(filters);
	} catch (err) {
		console.error('Failed to load vendor sites from APIGEE', err);
		const cached = getCachedVendorSitesResult(filters);
		if (cached) {
			return {
				source: 'apigee_cache',
				sites: cached.sites,
				loadedAt: cached.loadedAt,
				error: 'apigee_unavailable'
			};
		}
		throw err;
	}
};
