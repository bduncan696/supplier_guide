import { json } from '@sveltejs/kit';
import { getFirstToken } from '$lib/server/vendor-sites.js';
import { searchSuppliersWithFallback } from '$lib/server/apigee-suppliers.js';

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;

export const GET = async ({ url }) => {
	const query = url.searchParams.get('q') ?? '';
	const firstToken = getFirstToken(query);
	if (!firstToken) {
		return json({ source: 'none', query, suggestions: [], exactMatch: null });
	}

	const parsedLimit = Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT);
	const limit = Number.isFinite(parsedLimit)
		? Math.max(1, Math.min(MAX_LIMIT, parsedLimit))
		: DEFAULT_LIMIT;

	try {
		const payload = await searchSuppliersWithFallback(query, limit);
		return json(payload);
	} catch (err) {
		console.error('Vendor supplier search API error', err);
		return json(
			{
				source: 'error',
				error: 'supplier_search_failed',
				query,
				suggestions: [],
				exactMatch: null
			},
			{ status: 502 }
		);
	}
};
