/** @typedef {{ type?: string, address_purpose?: string, purchasing_site_flag?: boolean | string | number | null, pay_site_flag?: boolean | string | number | null, purchase_order_hold_flags?: boolean | string | number | null, id: string, name: string, address: string, address_line_1?: string, address_line_2?: string, address_line_3?: string, city: string, state: string, zip: string, status?: string, status_details?: string }} Site */
/** @typedef {{ key: string, id: string, name: string, address: string, address_line_1?: string, address_line_2?: string, address_line_3?: string, city: string, state: string, zip: string, types: string[], siteIds: string[], purchasing_site_flag: boolean, pay_site_flag: boolean }} GroupedSite */
/** @typedef {{ status: string, details: string, tone: 'red' | 'yellow' | 'gray' | 'green', purchaseOrderHold: boolean }} VendorStatusSummary */

/** @type {Record<string, number>} */
const STATUS_PRIORITY = {
	do_not_use: 4,
	caution: 3,
	prospective: 2,
	expired: 2,
	registered: 1
};

/** @param {Site} site */
export const getSitePurpose = (site) => String(site.address_purpose ?? site.type ?? '').trim();

/** @param {unknown} value */
export const parseTypes = (value) => {
	if (typeof value !== 'string') return [];
	return value
		.split(',')
		.map((entry) => entry.trim())
		.filter(Boolean);
};

/** @param {Site[]} sites */
export const deriveTypeOptions = (sites) =>
	Array.from(new Set(sites.flatMap((site) => parseTypes(getSitePurpose(site)))));

/** @param {{ address?: string, address_line_1?: string, address_line_2?: string, address_line_3?: string }} site */
export const getAddressLines = (site) => {
	const lines = [
		String(site.address_line_1 ?? '').trim(),
		String(site.address_line_2 ?? '').trim(),
		String(site.address_line_3 ?? '').trim()
	].filter(Boolean);
	if (lines.length > 0) return lines;

	const fallback = String(site.address ?? '').trim();
	return fallback ? [fallback] : [];
};

/** @param {{ city?: string, state?: string, zip?: string }} site */
export const formatCityStateZip = (site) => {
	const city = String(site.city ?? '').trim();
	const state = String(site.state ?? '').trim();
	const zip = String(site.zip ?? '').trim();
	const locality = [city, state].filter(Boolean).join(', ');
	return [locality, zip].filter(Boolean).join(' ');
};

/** @param {Site} site */
export const formatAddressBlock = (site) =>
	[...getAddressLines(site), formatCityStateZip(site)].filter(Boolean).join('\n');

/** @param {{ address?: string, address_line_1?: string, address_line_2?: string, address_line_3?: string, city?: string, state?: string, zip?: string }} location */
export const formatAddressBlockFromParts = (location) =>
	[...getAddressLines(location), formatCityStateZip(location)].filter(Boolean).join('\n');

/** @param {string} value */
export const typeIconKey = (value) => {
	const normalized = value.trim().toLowerCase();
	if (normalized === 'purchasing') return 'purchasing';
	if (normalized === 'payment' || normalized === 'pay') return 'payment';
	return '';
};

/** @param {string} value */
export const typeFilterLabel = (value) => {
	const key = typeIconKey(value);
	if (key === 'purchasing') return 'Legal Address';
	if (key === 'payment') return 'Remit To';
	return value;
};

/** @param {unknown} value */
const isTruthyFlag = (value) => {
	if (typeof value === 'boolean') return value;
	if (typeof value === 'number') return value !== 0;
	if (typeof value === 'string') {
		const normalized = value.trim().toLowerCase();
		return ['1', 'true', 't', 'yes', 'y'].includes(normalized);
	}
	return false;
};

/** @param {{ purchasing_site_flag?: unknown, pay_site_flag?: unknown }} site */
export const getSiteIconKeys = (site) => {
	/** @type {string[]} */
	const keys = [];
	if (isTruthyFlag(site.purchasing_site_flag)) keys.push('purchasing');
	if (isTruthyFlag(site.pay_site_flag)) keys.push('payment');
	return keys;
};

/** @param {string} key */
export const iconLabelForKey = (key) => {
	if (key === 'purchasing') return 'Legal Address';
	if (key === 'payment') return 'Remit To';
	return key;
};

/** @param {Site[]} sites */
export const groupSites = (sites) => {
	/** @type {Map<string, GroupedSite>} */
	const map = new Map();
	for (const site of sites) {
		const key = `${site.name}|${getAddressLines(site).join('|')}|${site.city}|${site.state}|${site.zip}`;
		const existing = map.get(key);
		const types = parseTypes(getSitePurpose(site));
		if (existing) {
			for (const entry of types) {
				if (!existing.types.includes(entry)) {
					existing.types = [...existing.types, entry];
				}
			}
			if (!existing.siteIds.includes(site.id)) {
				existing.siteIds = [...existing.siteIds, site.id];
			}
			existing.purchasing_site_flag = existing.purchasing_site_flag || isTruthyFlag(site.purchasing_site_flag);
			existing.pay_site_flag = existing.pay_site_flag || isTruthyFlag(site.pay_site_flag);
			continue;
		}
		map.set(key, {
			key,
			id: site.id,
			name: site.name,
			address: site.address,
			address_line_1: site.address_line_1,
			address_line_2: site.address_line_2,
			address_line_3: site.address_line_3,
			city: site.city,
			state: site.state,
			zip: site.zip,
			types,
			siteIds: [site.id],
			purchasing_site_flag: isTruthyFlag(site.purchasing_site_flag),
			pay_site_flag: isTruthyFlag(site.pay_site_flag)
		});
	}
	return Array.from(map.values());
};

/** @param {string} raw */
const normalizeStatusKey = (raw) =>
	raw
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_|_$/g, '');

/** @param {string} key */
const toStatusTone = (key) => {
	if (key === 'do_not_use') return 'red';
	if (key === 'caution') return 'yellow';
	if (key === 'registered') return 'green';
	return 'gray';
};

/** @param {string} key */
const toStatusLabel = (key) => {
	if (key === 'do_not_use') return 'Do not use';
	if (key === 'caution') return 'Caution';
	if (key === 'prospective') return 'Prospective';
	if (key === 'expired') return 'Expired';
	if (key === 'registered') return 'Registered';
	return 'Prospective';
};

/** @param {unknown} raw */
const formatStatusDisplay = (raw) =>
	String(raw ?? '')
		.trim()
		.replace(/\s*,\s*/g, ' / ')
		.replace(/\s*\/\s*/g, ' / ')
		.replace(/\s+/g, ' ')
		.trim();

/** @param {unknown} rawStatus */
const parseStatusInfo = (rawStatus) => {
	const value = String(rawStatus ?? '').trim();
	if (!value) return null;
	const normalized = value.toLowerCase();
	const display = formatStatusDisplay(value);

	if (/do\s*not\s*use/.test(normalized)) {
		return { key: 'do_not_use', label: display || 'Do not use' };
	}
	if (/\bcaution\b/.test(normalized)) {
		return { key: 'caution', label: display || 'Caution' };
	}
	const hasProspective = /\bprospective\b/.test(normalized);
	const hasExpired = /\bexpired\b/.test(normalized);
	if (hasProspective && hasExpired) {
		return { key: 'prospective', label: display || 'Prospective / Expired' };
	}
	if (hasProspective) {
		return { key: 'prospective', label: display || 'Prospective' };
	}
	if (hasExpired) {
		return { key: 'expired', label: display || 'Expired' };
	}
	if (/\bregistered\b/.test(normalized)) {
		return { key: 'registered', label: display || 'Registered' };
	}

	const normalizedKey = normalizeStatusKey(value);
	if ((STATUS_PRIORITY[normalizedKey] ?? 0) > 0) {
		return { key: normalizedKey, label: display || toStatusLabel(normalizedKey) };
	}
	return null;
};

/** @param {Site[]} sites
 * @returns {VendorStatusSummary | null}
 */
export const buildVendorStatusSummary = (sites) => {
	let chosenKey = '';
	let chosenLabel = '';
	let chosenRank = 0;

	for (const site of sites) {
		const parsed = parseStatusInfo(site.status);
		if (!parsed) continue;
		const rank = STATUS_PRIORITY[parsed.key] ?? 0;
		if (rank > chosenRank) {
			chosenRank = rank;
			chosenKey = parsed.key;
			chosenLabel = parsed.label;
		}
	}

	if (!chosenKey) return null;

	const details = Array.from(
		new Set(
			sites
				.filter((site) => parseStatusInfo(site.status)?.key === chosenKey)
				.map((site) => String(site.status_details ?? '').trim())
				.filter(Boolean)
		)
	).join('\n');

	return {
		status: chosenLabel || toStatusLabel(chosenKey),
		details,
		tone: toStatusTone(chosenKey),
		purchaseOrderHold: sites.some((site) => isTruthyFlag(site.purchase_order_hold_flags))
	};
};
