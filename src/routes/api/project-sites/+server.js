import { json } from '@sveltejs/kit';
import { fetchProjectSitesFromApigeeWithFallback } from '$lib/server/apigee-project-sites.js';

export const GET = async ({ url }) => {
	const projectNumber = url.searchParams.get('project_number');
	const projectName = url.searchParams.get('project_name');
	const lookupValue = String(projectNumber ?? '').trim() || String(projectName ?? '').trim();

	if (!lookupValue) {
		return json({ source: 'none', sites: [], loadedAt: Date.now() });
	}

	try {
		const payload = await fetchProjectSitesFromApigeeWithFallback(lookupValue);
		return json(payload);
	} catch (err) {
		console.error('Project sites API error', err);
		return json(
			{
				source: 'error',
				error: 'project_sites_lookup_failed',
				sites: [],
				loadedAt: Date.now()
			},
			{ status: 502 }
		);
	}
};
