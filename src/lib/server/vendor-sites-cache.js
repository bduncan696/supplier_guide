import { env } from '$env/dynamic/private';
import { fetchVendorSites } from './vendor-sites.js';
import { sampleVendorSites } from './sample-vendor-sites.js';

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;

/** @type {{ source: 'database' | 'sample', sites: any[], loadedAt: number, error?: string } | null} */
let vendorSitesCache = null;

const getCacheTtlMs = () => {
	const ttl = Number(env.VENDOR_SITES_CACHE_TTL_MS ?? DEFAULT_CACHE_TTL_MS);
	return Number.isFinite(ttl) && ttl > 0 ? ttl : DEFAULT_CACHE_TTL_MS;
};

export const getCachedVendorSites = async () => {
	const cacheTtlMs = getCacheTtlMs();
	const now = Date.now();
	if (vendorSitesCache && now - vendorSitesCache.loadedAt < cacheTtlMs) {
		return vendorSitesCache;
	}

	if (env.VENDOR_DB_ENABLED !== 'true') {
		vendorSitesCache = { source: 'sample', sites: sampleVendorSites, loadedAt: now };
		return vendorSitesCache;
	}

	try {
		const sites = await fetchVendorSites();
		vendorSitesCache = { source: 'database', sites, loadedAt: now };
		return vendorSitesCache;
	} catch (err) {
		console.error('Failed to load vendor sites from database', err);
		vendorSitesCache = {
			source: 'sample',
			sites: sampleVendorSites,
			loadedAt: now,
			error: 'db_unavailable'
		};
		return vendorSitesCache;
	}
};
