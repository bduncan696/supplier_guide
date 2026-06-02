import { env } from '$env/dynamic/private';
import { apigeeGet, asString } from './apigee-client.js';
import { normalizeForMatch } from './vendor-sites.js';

/** @typedef {{ supplier_number?: unknown, supplier_name?: unknown, supplier_type?: unknown, supplier_status?: unknown, supplier_status_details?: unknown }} SupplierHeader */
/** @typedef {{ address_line_1?: unknown, address_line_2?: unknown, address_line_3?: unknown, address_purpose?: unknown, city?: unknown, state?: unknown, province?: unknown, postal_code?: unknown, country?: unknown }} SupplierSiteRow */
/** @typedef {{ supplier_header?: SupplierHeader, supplier_sites?: SupplierSiteRow[] }} SupplierRecord */
/** @typedef {{ supplier_number?: unknown, supplier_name?: unknown }} SupplierSearchRow */
/** @typedef {{ id: string, name: string, city: string, state: string }} VendorSuggestion */
/** @typedef {{ address_purpose: string, id: string, name: string, address: string, city: string, state: string, zip: string, country: string, status: string, status_details: string }} VendorSite */
/** @typedef {{ vendorId?: string | null, vendorName?: string | null }} VendorFilters */
/** @typedef {{ query: string, suggestions: VendorSuggestion[], exactMatch: VendorSuggestion | null, loadedAt: number }} VendorSearchSnapshot */
/** @typedef {{ sites: VendorSite[], loadedAt: number }} VendorSitesSnapshot */
const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 50;
const DEFAULT_VENDOR_MATCH_LIMIT = 20;
const MAX_VENDOR_MATCH_LIMIT = 50;

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

/** @param {SupplierSiteRow | null | undefined} site */
const joinAddressLines = (site) =>
	[site?.address_line_1, site?.address_line_2, site?.address_line_3]
		.map((part) => asString(part))
		.filter(Boolean)
		.join(' ');

/** @param {SupplierRecord | null | undefined} supplier
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

	return supplierSites.map((site) => ({
		address_purpose: asString(site?.address_purpose) || supplierType,
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

/** @param {SupplierSearchRow[]} rows */
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
