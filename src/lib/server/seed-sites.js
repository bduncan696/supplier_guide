import { sampleProjectSites } from './sample-project-sites.js';
import { sampleVendorSites } from './sample-vendor-sites.js';
import {
	buildVendorSuggestions,
	filterVendorSites,
	findExactVendorMatch,
	getFirstToken,
	normalizeForMatch
} from './vendor-sites.js';

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;

/** @param {unknown} value */
const asSearchText = (value) => String(value ?? '').trim();

/** @param {unknown} value */
const parseLimit = (value) => {
	const parsed = Number(value ?? DEFAULT_LIMIT);
	if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
	return Math.max(1, Math.min(MAX_LIMIT, Math.floor(parsed)));
};

/** @param {string | null | undefined} value */
export const extractProjectCode = (value) => {
	const match = String(value ?? '')
		.trim()
		.match(/^([A-Za-z0-9.-]+)/);
	return match ? match[1].trim() : '';
};

/** @param {{ vendorId?: string | null, vendorName?: string | null }} filters */
export const getSeedVendorSites = (filters) => {
	const sites = filterVendorSites(sampleVendorSites, filters);
	return {
		source: 'seed',
		sites,
		loadedAt: Date.now()
	};
};

/** @param {string | null | undefined} query
 * @param {unknown} requestedLimit
 */
export const searchSeedSuppliers = (query, requestedLimit) => {
	const trimmed = asSearchText(query);
	if (!getFirstToken(trimmed)) {
		return { source: 'none', query: trimmed, suggestions: [], exactMatch: null };
	}

	const limit = parseLimit(requestedLimit);
	const suggestions = buildVendorSuggestions(sampleVendorSites, trimmed, limit);
	const exactMatch = findExactVendorMatch(sampleVendorSites, trimmed);

	return {
		source: 'seed',
		query: trimmed,
		suggestions,
		exactMatch,
		loadedAt: Date.now()
	};
};

/** @param {string | null | undefined} projectLookupValue */
export const getSeedProjectSites = (projectLookupValue) => {
	const projectCode = extractProjectCode(projectLookupValue);
	if (!projectCode) {
		return { source: 'none', sites: [], loadedAt: Date.now() };
	}

	const normalizedProjectCode = normalizeForMatch(projectCode);
	const sites = sampleProjectSites.filter((site) => {
		const normalizedId = normalizeForMatch(site.id);
		const normalizedName = normalizeForMatch(site.name);
		return (
			normalizedId.startsWith(normalizedProjectCode) ||
			normalizedName.startsWith(normalizedProjectCode)
		);
	});

	return {
		source: 'seed',
		projectCode,
		sites,
		loadedAt: Date.now()
	};
};
