import { json } from '@sveltejs/kit';
import { getFirstToken } from '$lib/server/vendor-sites.js';
import { searchSeedSuppliers } from '$lib/server/seed-sites.js';

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

	return json(searchSeedSuppliers(query, limit));
};
