import { env } from '$env/dynamic/private';

const ENVIRONMENT_CONFIG = {
	production: {
		authBaseUrl: 'https://login.procore.com/oauth',
		apiBaseUrl: 'https://api.procore.com'
	},
	development_sandbox: {
		authBaseUrl: 'https://login-sandbox.procore.com/oauth',
		apiBaseUrl: 'https://sandbox.procore.com'
	},
	monthly_sandbox: {
		authBaseUrl: 'https://login-sandbox-monthly.procore.com/oauth',
		apiBaseUrl: 'https://api-monthly.procore.com'
	}
};

const TOKEN_STORE = new Map();
const STATE_STORE = new Map();
const HANDLE_STORE = new Map();

const resolveEnvironment = () => {
	const rawEnv = env.PROCORE_ENV?.toLowerCase();
	const envKey =
		rawEnv === 'monthly' || rawEnv === 'monthly_sandbox'
			? 'monthly_sandbox'
			: rawEnv === 'development' || rawEnv === 'dev' || rawEnv === 'sandbox' || rawEnv === 'development_sandbox'
				? 'development_sandbox'
				: 'production';

	const fallback = ENVIRONMENT_CONFIG[envKey];
	return {
		name: envKey,
		authBaseUrl: env.PROCORE_AUTH_BASE_URL || fallback.authBaseUrl,
		apiBaseUrl: env.PROCORE_API_BASE_URL || fallback.apiBaseUrl
	};
};

/** @param {{ origin: string }} url */
const buildRedirectUri = (url) =>
	env.PROCORE_REDIRECT_URI || `${url.origin}/api/procore/oauth/callback`;

/** @param {{ get: (key: string) => string | undefined }} cookies */
const getSessionId = (cookies) => cookies.get('procore_session') || null;

/** @param {{ get: (key: string) => string | undefined, set: (key: string, value: string, options: any) => void }} cookies */
const ensureSessionId = (cookies) => {
	let sessionId = getSessionId(cookies);
	if (!sessionId) {
		sessionId = crypto.randomUUID();
		const isSecure = env.NODE_ENV === 'production';
		cookies.set('procore_session', sessionId, {
			path: '/',
			httpOnly: true,
			secure: isSecure,
			sameSite: 'lax',
			maxAge: 60 * 60 * 24 * 7
		});
	}
	return sessionId;
};

/**
 * @param {string} sessionId
 * @param {{ access_token: string, refresh_token?: string, expires_in: number, token_type?: string, scope?: string }} payload
 */
const storeToken = (sessionId, payload) => {
	const expiresAt = Date.now() + payload.expires_in * 1000 - 60_000;
	TOKEN_STORE.set(sessionId, {
		accessToken: payload.access_token,
		refreshToken: payload.refresh_token,
		expiresAt,
		tokenType: payload.token_type,
		scope: payload.scope
	});
};

/** @param {string} sessionId */
const getStoredToken = (sessionId) => TOKEN_STORE.get(sessionId) || null;

/**
 * @param {string} sessionId
 * @param {(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>} fetch
 * @param {{ origin: string }} url
 */
const refreshAccessToken = async (sessionId, fetch, url) => {
	const stored = getStoredToken(sessionId);
	if (!stored?.refreshToken) return null;
	const clientId = env.PROCORE_CLIENT_ID;
	const clientSecret = env.PROCORE_CLIENT_SECRET;
	if (!clientId || !clientSecret) return null;

	const { authBaseUrl, name: envName } = resolveEnvironment();
	const body = new URLSearchParams();
	body.set('grant_type', 'refresh_token');
	body.set('refresh_token', stored.refreshToken);
	body.set('client_id', clientId);
	body.set('client_secret', clientSecret);
	body.set('redirect_uri', buildRedirectUri(url));

	const response = await fetch(`${authBaseUrl.replace(/\/$/, '')}/token`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
			Accept: 'application/json'
		},
		body
	});

	if (!response.ok) {
		console.warn('Procore token refresh failed', { status: response.status, env: envName });
		return null;
	}

	const payload = await response.json();
	if (!payload?.access_token || !payload?.expires_in) {
		return null;
	}
	storeToken(sessionId, payload);
	return payload.access_token;
};

/**
 * @param {(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>} fetch
 * @param {{ origin: string }} url
 * @param {string} code
 */
const requestToken = async (fetch, url, code) => {
	const clientId = env.PROCORE_CLIENT_ID;
	const clientSecret = env.PROCORE_CLIENT_SECRET;
	const scopes = env.PROCORE_OAUTH_SCOPES;

	if (!clientId || !clientSecret) {
		throw new Error('missing_client_credentials');
	}

	const { authBaseUrl, name: envName } = resolveEnvironment();
	const body = new URLSearchParams();
	body.set('grant_type', 'authorization_code');
	body.set('client_id', clientId);
	body.set('client_secret', clientSecret);
	body.set('code', code);
	body.set('redirect_uri', buildRedirectUri(url));
	if (scopes) {
		body.set('scope', scopes);
	}

	const response = await fetch(`${authBaseUrl.replace(/\/$/, '')}/token`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
			Accept: 'application/json'
		},
		body
	});

	if (!response.ok) {
		const text = await response.text();
		console.warn('Procore token request failed', { status: response.status, env: envName });
		throw new Error(`token_request_failed:${response.status}:${text}`);
	}

	const payload = await response.json();
	if (!payload?.access_token || !payload?.expires_in) {
		throw new Error('token_response_invalid');
	}

	return payload;
};

/**
 * @param {{ origin: string }} url
 * @param {string} state
 */
const getAuthorizeUrl = (url, state) => {
	const clientId = env.PROCORE_CLIENT_ID;
	if (!clientId) {
		throw new Error('missing_client_id');
	}

	const scopes = env.PROCORE_OAUTH_SCOPES;
	const { authBaseUrl } = resolveEnvironment();
	const authorizeUrl = new URL(`${authBaseUrl.replace(/\/$/, '')}/authorize`);
	authorizeUrl.searchParams.set('response_type', 'code');
	authorizeUrl.searchParams.set('client_id', clientId);
	authorizeUrl.searchParams.set('redirect_uri', buildRedirectUri(url));
	authorizeUrl.searchParams.set('state', state);
	if (scopes) {
		authorizeUrl.searchParams.set('scope', scopes);
	}
	return authorizeUrl;
};

/**
 * @param {string} sessionId
 * @param {string} state
 */
const saveState = (sessionId, state) => {
	STATE_STORE.set(sessionId, { state, createdAt: Date.now() });
};

/**
 * @param {string} sessionId
 * @param {string} state
 */
const consumeState = (sessionId, state) => {
	const record = STATE_STORE.get(sessionId);
	if (!record || record.state !== state) {
		return false;
	}
	STATE_STORE.delete(sessionId);
	return true;
};

/** @param {string} sessionId */
const issueAuthHandle = (sessionId) => {
	const handle = crypto.randomUUID();
	HANDLE_STORE.set(handle, { sessionId, expiresAt: Date.now() + 1000 * 60 * 60 * 12 });
	return handle;
};

/** @param {string} handle */
const getSessionIdForHandle = (handle) => {
	const record = HANDLE_STORE.get(handle);
	if (!record) return null;
	if (Date.now() > record.expiresAt) {
		HANDLE_STORE.delete(handle);
		return null;
	}
	return record.sessionId;
};

/**
 * @param {string} sessionId
 * @param {(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>} fetch
 * @param {{ origin: string }} url
 */
const getAccessTokenForSession = async (sessionId, fetch, url) => {
	const stored = getStoredToken(sessionId);
	if (!stored) return null;
	if (Date.now() < stored.expiresAt) return stored.accessToken;
	return await refreshAccessToken(sessionId, fetch, url);
};

/**
 * @param {string} sessionId
 * @param {(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>} fetch
 * @param {{ origin: string }} url
 */
const getAccessTokenForSessionStatus = async (sessionId, fetch, url) => {
	const stored = getStoredToken(sessionId);
	if (!stored) {
		return { ok: false, reason: 'missing_token' };
	}
	if (Date.now() < stored.expiresAt) {
		return { ok: true, token: stored.accessToken };
	}
	const refreshed = await refreshAccessToken(sessionId, fetch, url);
	if (refreshed) {
		return { ok: true, token: refreshed };
	}
	return { ok: false, reason: 'refresh_failed' };
};

export {
	buildRedirectUri,
	consumeState,
	ensureSessionId,
	getAccessTokenForSession,
	getAuthorizeUrl,
	getSessionIdForHandle,
	issueAuthHandle,
	requestToken,
	resolveEnvironment,
	saveState,
	storeToken,
	getAccessTokenForSessionStatus
};
