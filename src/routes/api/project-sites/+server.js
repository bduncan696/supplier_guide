import { json } from '@sveltejs/kit';
import { sampleProjectSites } from '$lib/server/sample-project-sites.js';

export const GET = async () => {
	return json({ source: 'sample', sites: sampleProjectSites });
};
