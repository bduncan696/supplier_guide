import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { fetchVendorSites } from '$lib/server/vendor-sites.js';
import { sampleVendorSites } from '$lib/server/sample-vendor-sites.js';

export const GET = async () => {
	if (env.VENDOR_DB_ENABLED !== 'true') {
		return json({ source: 'sample', sites: sampleVendorSites });
	}

	try {
		const sites = await fetchVendorSites();
		return json({ source: 'database', sites });
	} catch (err) {
		console.error('Failed to load vendor sites from database', err);
		return json({ source: 'sample', sites: sampleVendorSites, error: 'db_unavailable' });
	}
};
