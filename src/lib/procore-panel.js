/** @typedef {{ company_id?: unknown, project_id?: unknown, id?: unknown, view?: unknown }} ProcoreContext */
/** @typedef {{ context?: ProcoreContext, view?: unknown }} ProcorePayloadLike */
/** @typedef {{ context?: ProcoreContext, payload?: ProcorePayloadLike | ProcoreContext, data?: { context?: ProcoreContext }, view?: unknown, type?: unknown }} ProcoreEventData */
/** @typedef {{ name?: unknown }} NamedValue */
/** @typedef {{ company?: unknown, company_name?: unknown, name?: unknown, vendor_name?: unknown }} VendorLike */
/** @typedef {{ vendor?: VendorLike, vendor_company?: unknown, invoice_contacts?: Array<{ name?: unknown, vendor_name?: unknown }>, project?: { name?: unknown }, project_name?: unknown }} ProcoreCommitmentPayload */

export const PROCORE_ALLOWED_ORIGINS = new Set([
	'http://api.procore.com',
	'https://api.procore.com',
	'https://app.procore.com',
	'https://us01.procore.com',
	'https://us02.procore.com'
]);

export const PROCORE_PROXY_ENDPOINT = '/api/procore/commitment';

export const DETAIL_VIEWS = new Set([
	'commitments.purchase_order_contracts.detail',
	'commitments.work_order_contracts.detail'
]);

export const COMMITMENT_ENDPOINTS = {
	'commitments.purchase_order_contracts.edit': 'purchase_order_contracts',
	'commitments.work_order_contracts.edit': 'work_order_contracts'
};

/** @param {string} label
 * @param {unknown | null} details
 */
export const debugProcore = (label, details = null) => {
	if (!shouldDebugProcore()) return;
	if (details === null) {
		console.info(`[procore-debug] ${label}`);
		return;
	}
	console.info(`[procore-debug] ${label}`, details);
};

export const shouldDebugProcore = () => {
	if (typeof window === 'undefined') return false;
	try {
		const params = new URLSearchParams(window.location.search);
		return (
			params.get('debug_procore') === '1' ||
			window.localStorage?.getItem('debug_procore') === '1'
		);
	} catch {
		return false;
	}
};

/** @param {unknown} value */
export const asString = (value) => (value === null || value === undefined ? '' : String(value));

/** @param {unknown} data */
export const extractContext = (data) => {
	const typed = /** @type {ProcoreEventData | null} */ (data);
	const payloadObject =
		typed?.payload && typeof typed.payload === 'object'
			? /** @type {ProcorePayloadLike} */ (typed.payload)
			: null;
	const payloadContext =
		typed?.payload && typeof typed.payload === 'object'
			? /** @type {ProcoreContext} */ (typed.payload)
			: null;
	const candidates = [
		typed?.context,
		payloadObject?.context,
		payloadContext,
		typed?.data?.context
	];

	for (const ctx of candidates) {
		if (
			ctx &&
			typeof ctx === 'object' &&
			('company_id' in ctx || 'project_id' in ctx || 'id' in ctx || 'view' in ctx)
		) {
			return /** @type {ProcoreContext} */ (ctx);
		}
	}
	return null;
};

/** @param {unknown} data */
export const extractView = (data) => {
	const fromContext = extractContext(data)?.view;
	if (typeof fromContext === 'string') return fromContext;
	const typed = /** @type {ProcoreEventData | null} */ (data);
	const payloadObject =
		typed?.payload && typeof typed.payload === 'object'
			? /** @type {ProcorePayloadLike} */ (typed.payload)
			: null;
	const fromPayload = payloadObject?.view;
	if (typeof fromPayload === 'string') return fromPayload;
	const directView = typed?.view;
	if (typeof directView === 'string') return directView;
	return null;
};

/** @param {unknown} data */
export const hasRequiredProcoreContext = (data) => {
	const context = extractContext(data);
	return Boolean(
		context &&
			context.company_id !== undefined &&
			context.project_id !== undefined &&
			context.id !== undefined
	);
};

/** @param {unknown} payload */
export const extractVendorCompany = (payload) => {
	const typed = /** @type {ProcoreCommitmentPayload | null} */ (payload);
	const vendorCompany =
		typed?.vendor?.company ??
		typed?.vendor_company ??
		typed?.vendor?.company_name ??
		typed?.vendor?.name ??
		typed?.vendor?.vendor_name ??
		typed?.invoice_contacts?.[0]?.name ??
		typed?.invoice_contacts?.[0]?.vendor_name;
	if (typeof vendorCompany === 'string') return vendorCompany;
	if (vendorCompany && typeof vendorCompany === 'object') {
		const named = /** @type {NamedValue} */ (vendorCompany);
		if (typeof named.name === 'string') return named.name;
	}
	return '';
};

/** @param {string} value */
const normalizeProjectName = (value) => value.replace(/\s*-\s*/, ' ').trim();

/** @param {unknown} payload */
export const extractProjectName = (payload) => {
	const typed = /** @type {ProcoreCommitmentPayload | null} */ (payload);
	const projectName = typed?.project?.name ?? typed?.project_name;
	if (typeof projectName === 'string') return normalizeProjectName(projectName);
	if (projectName && typeof projectName === 'object') {
		const named = /** @type {NamedValue} */ (projectName);
		if (typeof named.name === 'string') return normalizeProjectName(named.name);
	}
	return '';
};

/** @param {'vendor_app.ready' | 'vendor_app.request_context' | 'vendor_app.request_parent_url'} type */
export const buildVendorAppMessage = (type) => ({
	type,
	payload: { timestamp: Date.now(), source: 'vendor_app' }
});
