/** @typedef {{ id?: string, name?: string }} SupplierSiteLike */
/** @typedef {{ resolvedSupplierId: string, resolvedSupplierName: string, supplierRegistrationUrl: string, supplierActionUrl: string, supplierActionLabel: string, showSupplierActionLink: boolean }} SupplierActionState */

export const VENDOR_SUGGESTION_LIMIT = 5;
export const VENDOR_SEARCH_DEBOUNCE_MS = 300;
export const SUPPLIER_INTELLIGENCE_REQUEST_URL =
	'https://burnsmcd.palantirfoundry.com/workspace/module/view/latest/ri.workshop.main.module.e074b65c-dfc2-40bd-abdc-5e5bbaba4846/requestsetup-1';
export const SUPPLIER_REGISTRATION_BASE_URL =
	'https://burnsmcd.palantirfoundry.com/workspace/module/view/latest/ri.workshop.main.module.e074b65c-dfc2-40bd-abdc-5e5bbaba4846/main-page?pageId=Registration&ConfirmSupplier=true';

/** @param {string} value */
export const hasVendorSearchSeed = (value) => {
	const firstToken = value.trim().split(/\s+/)[0] ?? '';
	return firstToken.length > 0;
};

/**
 * @param {{
 *   selectedVendorId?: string | null,
 *   selectedVendorName?: string | null,
 *   vendorSites?: SupplierSiteLike[],
 *   vendorName?: string | null
 * }} input
 */
export const resolveSupplierIdentity = (input) => {
	const vendorSites = Array.isArray(input.vendorSites) ? input.vendorSites : [];
	const resolvedSupplierId =
		String(input.selectedVendorId ?? '').trim() || String(vendorSites[0]?.id ?? '').trim();
	const resolvedSupplierName =
		String(input.selectedVendorName ?? '').trim() ||
		String(vendorSites[0]?.name ?? '').trim() ||
		String(input.vendorName ?? '').trim();

	return { resolvedSupplierId, resolvedSupplierName };
};

/** @param {string} resolvedSupplierId */
export const buildSupplierRegistrationUrl = (resolvedSupplierId) => {
	if (!resolvedSupplierId) return SUPPLIER_INTELLIGENCE_REQUEST_URL;

	const url = new URL(SUPPLIER_REGISTRATION_BASE_URL);
	url.searchParams.set('activeSupplierId', resolvedSupplierId);
	return url.toString();
};

/**
 * @param {{
 *   selectedVendorId?: string | null,
 *   selectedVendorName?: string | null,
 *   vendorSites?: SupplierSiteLike[],
 *   vendorName?: string | null,
 *   vendorLookupCompleted?: boolean
 * }} input
 * @returns {SupplierActionState}
 */
export const buildSupplierActionState = (input) => {
	const { resolvedSupplierId, resolvedSupplierName } = resolveSupplierIdentity(input);
	const supplierRegistrationUrl = buildSupplierRegistrationUrl(resolvedSupplierId);
	const showSupplierActionLink =
		Boolean(resolvedSupplierId) ||
		(Boolean(input.vendorLookupCompleted) && String(input.vendorName ?? '').trim().length > 0);

	if (resolvedSupplierId) {
		return {
			resolvedSupplierId,
			resolvedSupplierName,
			supplierRegistrationUrl,
			supplierActionUrl: supplierRegistrationUrl,
			supplierActionLabel: `Request an Address Update for ${resolvedSupplierName}`,
			showSupplierActionLink
		};
	}

	return {
		resolvedSupplierId,
		resolvedSupplierName,
		supplierRegistrationUrl,
		supplierActionUrl: SUPPLIER_INTELLIGENCE_REQUEST_URL,
		supplierActionLabel:
			"If you don't see the vendor you need please verify they have an active registration, or click here to upload their W9 for bidding.",
		showSupplierActionLink
	};
};
