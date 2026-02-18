import { env } from '$env/dynamic/private';
import { getPool } from './db.js';

const DEFAULT_LIMIT = 200;
const SPACE_REGEX = /\s+/g;
const DIACRITIC_REGEX = /[\u0300-\u036f]/g;
const PUNCTUATION_REGEX = /[^a-z0-9\s]/g;

export const fetchVendorSites = async () => {
	const pool = await getPool();
	const limit = Number(env.VENDOR_DB_LIMIT ?? DEFAULT_LIMIT);

	const result = await pool.query(
		`
			select
				VENDOR_SITE_ID as id,
				VENDOR_SITE_CODE as name,
				ADDRESS_LINE1 as address,
				CITY as city,
				STATE as state,
				ZIP as zip
			from BMCD_TADP_SUPP_SITES_T
			where INACTIVE_DATE is null
			fetch first $1 rows only
		`,
		[limit]
	);

	return result.rows;
};

/** @param {unknown} value */
export const normalizeForMatch = (value) =>
	String(value ?? '')
		.normalize('NFD')
		.replace(DIACRITIC_REGEX, '')
		.toLowerCase()
		.replace(PUNCTUATION_REGEX, ' ')
		.replace(SPACE_REGEX, ' ')
		.trim();

/** @param {string} query */
export const getFirstToken = (query) => {
	const normalized = normalizeForMatch(query);
	const [firstToken = ''] = normalized.split(' ');
	return firstToken;
};

/** @param {string} a
 * @param {string} b
 */
const levenshteinDistance = (a, b) => {
	if (a === b) return 0;
	if (!a.length) return b.length;
	if (!b.length) return a.length;
	const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i += 1) {
		let previous = i - 1;
		dp[0] = i;
		for (let j = 1; j <= b.length; j += 1) {
			const temp = dp[j];
			const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
			dp[j] = Math.min(
				dp[j] + 1,
				dp[j - 1] + 1,
				previous + substitutionCost
			);
			previous = temp;
		}
	}
	return dp[b.length];
};

/**
 * @param {Array<{ id: string, name: string, city?: string, state?: string }>} sites
 * @param {string} query
 * @param {number} limit
 */
export const buildVendorSuggestions = (sites, query, limit = 5) => {
	const normalizedQuery = normalizeForMatch(query);
	if (!normalizedQuery) return [];

	/** @type {Map<string, { id: string, name: string, normalizedName: string, city: string, state: string, popularity: number, bestDistance: number, bestPrefixRank: number }>} */
	const byVendor = new Map();

	for (const site of sites) {
		const id = String(site.id ?? '').trim();
		const name = String(site.name ?? '').trim();
		if (!id || !name) continue;

		const normalizedName = normalizeForMatch(name);
		if (!normalizedName) continue;
		if (!normalizedName.startsWith(normalizedQuery)) continue;

		const vendorKey = normalizedName;
		const existing = byVendor.get(vendorKey);
		if (existing) {
			existing.popularity += 1;
			if (!existing.city && site.city) existing.city = String(site.city).trim();
			if (!existing.state && site.state) existing.state = String(site.state).trim();
			continue;
		}

		byVendor.set(vendorKey, {
			id,
			name,
			normalizedName,
			city: String(site.city ?? '').trim(),
			state: String(site.state ?? '').trim(),
			popularity: 1,
			bestDistance: 0,
			bestPrefixRank: 0
		});
	}

	return Array.from(byVendor.values())
		.sort((a, b) => {
			if (a.popularity !== b.popularity) return b.popularity - a.popularity;
			return a.name.localeCompare(b.name);
		})
		.slice(0, limit)
		.map((vendor) => ({
			id: vendor.id,
			name: vendor.name,
			city: vendor.city,
			state: vendor.state
		}));
};

/**
 * @param {Array<{ id: string, name: string, city?: string, state?: string }>} sites
 * @param {string} query
 */
export const findExactVendorMatch = (sites, query) => {
	const normalizedQuery = normalizeForMatch(query);
	if (!normalizedQuery) return null;

	/** @type {Map<string, { id: string, name: string, city: string, state: string, popularity: number }>} */
	const exactMatches = new Map();

	for (const site of sites) {
		const id = String(site.id ?? '').trim();
		const name = String(site.name ?? '').trim();
		if (!id || !name) continue;
		if (normalizeForMatch(name) !== normalizedQuery) continue;

		const existing = exactMatches.get(normalizedQuery);
		if (existing) {
			existing.popularity += 1;
			if (!existing.city && site.city) existing.city = String(site.city).trim();
			if (!existing.state && site.state) existing.state = String(site.state).trim();
			continue;
		}
		exactMatches.set(normalizedQuery, {
			id,
			name,
			city: String(site.city ?? '').trim(),
			state: String(site.state ?? '').trim(),
			popularity: 1
		});
	}

	const bestMatch = Array.from(exactMatches.values()).sort((a, b) => b.popularity - a.popularity)[0];
	return bestMatch
		? { id: bestMatch.id, name: bestMatch.name, city: bestMatch.city, state: bestMatch.state }
		: null;
};

/**
 * @param {Array<{ id: string, name: string }>} sites
 * @param {{ vendorId?: string | null, vendorName?: string | null }} filters
 */
export const filterVendorSites = (sites, filters) => {
	const vendorId = String(filters.vendorId ?? '').trim();
	const vendorName = String(filters.vendorName ?? '').trim();
	const normalizedName = normalizeForMatch(vendorName);

	return sites.filter((site) => {
		if (vendorId && String(site.id ?? '').trim() === vendorId) return true;
		if (normalizedName && normalizeForMatch(site.name) === normalizedName) return true;
		return false;
	});
};
