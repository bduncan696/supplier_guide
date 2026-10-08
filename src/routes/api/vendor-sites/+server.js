import { json } from '@sveltejs/kit';
import { getSeedVendorSites } from '$lib/server/seed-sites.js';

export const GET = async ({ url }) => {
	const vendorId = url.searchParams.get('vendor_id');
	const vendorName = url.searchParams.get('vendor_name');

	if (!String(vendorId ?? '').trim() && !String(vendorName ?? '').trim()) {
		return json({ source: 'none', sites: [], loadedAt: Date.now() });
	}

	return json(getSeedVendorSites({ vendorId, vendorName }));
};
