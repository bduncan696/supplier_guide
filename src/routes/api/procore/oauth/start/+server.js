import { redirect } from '@sveltejs/kit';
import {
	ensureSessionId,
	getAuthorizeUrl,
	saveState
} from '$lib/server/procore-auth.js';

export const GET = async ({ url, cookies }) => {
	const sessionId = ensureSessionId(cookies);
	const state = crypto.randomUUID();
	saveState(sessionId, state);

	const authorizeUrl = getAuthorizeUrl(url, state);
	throw redirect(302, authorizeUrl.toString());
};
