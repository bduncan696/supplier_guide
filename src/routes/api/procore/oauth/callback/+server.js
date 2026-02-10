const helperScript = () => `
<script type="module">
	import helpers from 'https://cdn.skypack.dev/@flexbase-eng/procore-iframe-helpers';
	const context = helpers?.initialize?.();
	const payload = window.__PROCORE_OAUTH_PAYLOAD__;
	if (context?.authentication?.notifySuccess && payload?.success) {
		context.authentication.notifySuccess(payload);
	} else if (context?.authentication?.notifyFailure) {
		context.authentication.notifyFailure(payload || { success: false, error: 'auth_failed' });
	}
</script>
`;

/** @param {{ success: boolean, error?: string, handle?: string }} payload */
const buildHtml = (payload) => `<!DOCTYPE html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>Procore OAuth</title>
	</head>
	<body>
		<p>Completing Procore authentication…</p>
		<script>
			window.__PROCORE_OAUTH_PAYLOAD__ = ${JSON.stringify(payload)};
		</script>
		${helperScript()}
	</body>
</html>`;

import {
	consumeState,
	ensureSessionId,
	issueAuthHandle,
	requestToken,
	storeToken
} from '$lib/server/procore-auth.js';

export const GET = async ({ url, fetch, cookies }) => {
	const sessionId = ensureSessionId(cookies);
	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');

	if (!code || !state) {
		return new Response(buildHtml({ success: false, error: 'missing_params' }), {
			headers: { 'content-type': 'text/html' }
		});
	}

	if (!consumeState(sessionId, state)) {
		return new Response(buildHtml({ success: false, error: 'invalid_state' }), {
			headers: { 'content-type': 'text/html' }
		});
	}

	try {
		const payload = await requestToken(fetch, url, code);
		storeToken(sessionId, payload);
		const handle = issueAuthHandle(sessionId);
		return new Response(buildHtml({ success: true, handle }), {
			headers: { 'content-type': 'text/html' }
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : 'token_error';
		return new Response(buildHtml({ success: false, error: message }), {
			headers: { 'content-type': 'text/html' }
		});
	}
};
