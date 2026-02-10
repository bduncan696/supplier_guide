import { json } from '@sveltejs/kit';
import {
	ensureSessionId,
	getAccessTokenForSession,
	getSessionIdForHandle,
	resolveEnvironment
} from '$lib/server/procore-auth.js';

const COMMITMENT_ENDPOINTS = {
	'commitments.purchase_order_contracts.edit': 'purchase_order_contracts',
	'commitments.work_order_contracts.edit': 'work_order_contracts'
};

export const GET = async ({ url, fetch, cookies }) => {
	const { apiBaseUrl, name: envName } = resolveEnvironment();
	const view = url.searchParams.get('view');
	const id = url.searchParams.get('id');
	const projectId = url.searchParams.get('project_id');
	const companyId = url.searchParams.get('company_id');
	const authHandle = url.searchParams.get('auth_handle');

	if (!view || !id || !projectId || !companyId) {
		return json({ error: 'missing_required_params' }, { status: 400 });
	}

	/** @type {'commitments.purchase_order_contracts.edit' | 'commitments.work_order_contracts.edit' | null} */
	const viewKey =
		view === 'commitments.purchase_order_contracts.edit' || view === 'commitments.work_order_contracts.edit'
			? view
			: null;

	const endpoint = viewKey ? COMMITMENT_ENDPOINTS[viewKey] : null;
	if (!endpoint) {
		return json({ error: 'unsupported_view' }, { status: 400 });
	}

	const sessionId = authHandle ? getSessionIdForHandle(authHandle) : ensureSessionId(cookies);
	const accessToken = sessionId ? await getAccessTokenForSession(sessionId, fetch, url) : null;
	if (!accessToken) {
		return json({ error: 'missing_user_token', environment: envName }, { status: 401 });
	}

	const apiUrl = new URL(`https://api.procore.com/rest/v1.0/${endpoint}/${encodeURIComponent(id)}`);
	apiUrl.hostname = new URL(apiBaseUrl).hostname;
	apiUrl.searchParams.set('project_id', projectId);

	try {
		const response = await fetch(apiUrl.toString(), {
			method: 'GET',
			headers: {
				Accept: 'application/json',
				Authorization: `Bearer ${accessToken}`,
				'Procore-Company-Id': companyId
			}
		});

		const contentType = response.headers.get('content-type') ?? '';
		const isJson = contentType.includes('application/json');
		const payload = isJson ? await response.json() : await response.text();
		if (!response.ok) {
			return json(
				{
					error: 'procore_error',
					status: response.status,
					body: isJson ? payload : String(payload),
					environment: envName
				},
				{ status: response.status }
			);
		}

		return json(payload);
	} catch (err) {
		console.error('Procore proxy request failed', err);
		return json({ error: 'proxy_request_failed' }, { status: 502 });
	}
};
