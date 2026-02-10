import { json } from '@sveltejs/kit';
import {
	ensureSessionId,
	getAccessTokenForSessionStatus,
	getSessionIdForHandle,
	resolveEnvironment
} from '$lib/server/procore-auth.js';

export const GET = async ({ url, fetch, cookies }) => {
	const { name: envName } = resolveEnvironment();
	const authHandle = url.searchParams.get('auth_handle');
	const sessionId = authHandle ? getSessionIdForHandle(authHandle) : ensureSessionId(cookies);
	if (!sessionId) {
		return json({ ok: false, environment: envName, reason: 'missing_token' }, { status: 401 });
	}

	const status = await getAccessTokenForSessionStatus(sessionId, fetch, url);
	if (!status.ok) {
		return json({ ok: false, environment: envName, reason: status.reason }, { status: 401 });
	}

	return json({ ok: true, environment: envName });
};
