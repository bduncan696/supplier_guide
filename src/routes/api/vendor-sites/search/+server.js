import { json } from '@sveltejs/kit';
import { buildVendorSuggestions, findExactVendorMatch, getFirstToken } from '$lib/server/vendor-sites.js';
import { getCachedVendorSites } from '$lib/server/vendor-sites-cache.js';

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;

export const GET = async ({ url }) => {
	const query = url.searchParams.get('q') ?? '';
	const firstToken = getFirstToken(query);
	if (!firstToken) {
		return json({ source: 'none', query, suggestions: [] });
	}

	const parsedLimit = Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT);
	const limit = Number.isFinite(parsedLimit)
		? Math.max(1, Math.min(MAX_LIMIT, parsedLimit))
		: DEFAULT_LIMIT;

	const payload = await getCachedVendorSites();
	const suggestions = buildVendorSuggestions(payload.sites, query, limit);
	const exactMatch = findExactVendorMatch(payload.sites, query);

	return json({
		source: payload.source,
		error: payload.error,
		query,
		suggestions,
		exactMatch
	});
};
