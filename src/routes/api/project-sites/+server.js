import { json } from '@sveltejs/kit';
import { getSeedProjectSites } from '$lib/server/seed-sites.js';

export const GET = async ({ url }) => {
	const projectNumber = url.searchParams.get('project_number');
	const projectName = url.searchParams.get('project_name');
	const lookupValue = String(projectNumber ?? '').trim() || String(projectName ?? '').trim();

	if (!lookupValue) {
		return json({ source: 'none', sites: [], loadedAt: Date.now() });
	}

	return json(getSeedProjectSites(lookupValue));
};
