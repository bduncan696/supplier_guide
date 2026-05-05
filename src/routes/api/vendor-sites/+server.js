import { json } from '@sveltejs/kit';
import { fetchVendorSitesFromApigeeWithFallback } from '$lib/server/apigee-suppliers.js';

export const GET = async ({ url }) => {
	const vendorId = url.searchParams.get('vendor_id');
	const vendorName = url.searchParams.get('vendor_name');

	if (!String(vendorId ?? '').trim() && !String(vendorName ?? '').trim()) {
		return json({ source: 'none', sites: [], loadedAt: Date.now() });
	}

	try {
		const payload = await fetchVendorSitesFromApigeeWithFallback({ vendorId, vendorName });
		return json(payload);
	} catch (err) {
		console.error('Vendor sites API error', err);
		return json(
			{
				source: 'error',
				error: 'supplier_lookup_failed',
				sites: [],
				loadedAt: Date.now()
			},
			{ status: 502 }
		);
	}
};
