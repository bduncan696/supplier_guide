import { json } from '@sveltejs/kit';
import { filterVendorSites } from '$lib/server/vendor-sites.js';
import { getCachedVendorSites } from '$lib/server/vendor-sites-cache.js';

export const GET = async ({ url }) => {
	const payload = await getCachedVendorSites();
	const vendorId = url.searchParams.get('vendor_id');
	const vendorName = url.searchParams.get('vendor_name');
	const filteredSites =
		(vendorId && vendorId.trim()) || (vendorName && vendorName.trim())
			? filterVendorSites(payload.sites, { vendorId, vendorName })
			: payload.sites;

	return json({ ...payload, sites: filteredSites });
};
