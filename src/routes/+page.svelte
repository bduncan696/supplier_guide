<script>
	import { onDestroy, onMount } from 'svelte';
	import './+page.css';
	import { helpTopics } from '$lib/help-topics';
	import { marked } from 'marked';
	import stackedLogo from '$lib/assets/BurnsMcDonnell_Stacked_RGB_R_high.png';
	import horizontalLogo from '$lib/assets/BurnsMcDonnell_Horiz_Small_RGB_R_high.png';


	const allowedOrigins = new Set([
		'http://api.procore.com',
		'https://api.procore.com',
		'https://app.procore.com'
	]);

	/** @typedef {{ type: string, id: string, name: string, address: string, city: string, state: string, zip: string }} Site */
	/** @typedef {{ key: string, id: string, name: string, address: string, city: string, state: string, zip: string, types: string[], siteIds: string[] }} GroupedSite */

	let vendorName = '';
	let shipToName = '';
	let listenerAttached = false;
	/** @type {number | null} */
	let contextPoller = null;
	let hasContext = false;
	/** @type {string | null} */
	let selectedSiteId = null;
	/** @type {string | null} */
	let selectedShipToId = null;
	/** @type {Site[]} */
	let filteredVendorSites = [];
	/** @type {Site[]} */
	let filteredShipToSites = [];
	/** @type {GroupedSite[]} */
	let groupedVendorSites = [];
	/** @type {GroupedSite[]} */
	let groupedShipToSites = [];
	/** @type {'vendor' | 'shipTo' | 'help'} */
	let activeTab = 'vendor';
	let showTypeFilter = false;
	/** @type {string[]} */
	let selectedTypes = [];
	let toastMessage = '';
	/** @type {number | null} */
	let toastTimer = null;
	/** @type {string | null} */
	let toastTargetId = null;
	/** @type {string | null} */
	let toastTargetTab = null;
	let readySignaled = false;
	let requestedParentUrl = false;
	let lastContextRequest = 0;
	/** @type {HTMLDivElement | null} */
	let filterWrap = null;
	let vendorLookupInFlight = false;
	/** @type {string | null} */
	let lastVendorLookupKey = null;
	/** @type {any} */
	let iframeHelpers = null;
	/** @type {any} */
	let iframeContext = null;
	/** @type {string | null} */
	let authHandle = null;
	let authConnected = false;
	let authInvalid = false;
	let autoAuthAttempted = false;
	let vendorTabDisabled = false;
	let sitesLoading = false;
	let shipToTabLabel = 'Project Address';
	let shipToTabIsShipTo = false;
	let userSearchedVendor = false;
	let userSearchedShipTo = false;

	const helpTopicsWithHtml = helpTopics.map((topic) => ({
		...topic,
		bodyHtml: marked.parse(topic.body)
	}));

	const PROCORE_PROXY_ENDPOINT = '/api/procore/commitment';
	const COMMITMENT_ENDPOINTS = {
		'commitments.purchase_order_contracts.edit': 'purchase_order_contracts',
		'commitments.work_order_contracts.edit': 'work_order_contracts'
	};

	/** @type {Site[]} */
	let vendorSites = [];
	/** @type {Site[]} */
	let shipToSites = [];
	/** @type {string[]} */
	let typeOptions = [];

	let openHelpTopicId = 'connect';

	/**
	 * @param {'vendor' | 'shipTo'} tab
	 * @param {boolean} markUserSearch
	 */
	const loadSites = async (tab, markUserSearch = true) => {
		if (markUserSearch) {
			if (tab === 'vendor') {
				userSearchedVendor = true;
			} else {
				userSearchedShipTo = true;
			}
		}
		sitesLoading = true;
		try {
			const response = await fetch(tab === 'vendor' ? '/api/vendor-sites' : '/api/project-sites');
			if (!response.ok) throw new Error(`Failed to load ${tab} sites`);
			const payload = await response.json();
			const sites = Array.isArray(payload?.sites) ? payload.sites : [];
			if (tab === 'vendor') {
				vendorSites = sites;
			} else {
				shipToSites = sites;
			}
			typeOptions = Array.from(
				new Set(sites.flatMap((/** @type {Site} */ site) => parseTypes(site.type)))
			);
		} catch (err) {
			console.warn('Unable to load sites', err);
		} finally {
			sitesLoading = false;
		}
	};

	/** @param {unknown} data */
	const extractContext = (data) => {
		const candidates = [
			// Typical Procore shape
			/** @type {any} */ (data)?.context,
			// Sometimes context is nested under payload
			/** @type {any} */ (data)?.payload?.context,
			// Fallback: payload might directly be the context
			/** @type {any} */ (data)?.payload,
			// Occasionally under data.context
			/** @type {any} */ (data)?.data?.context
		];

		for (const ctx of candidates) {
			if (ctx && typeof ctx === 'object' && ('company_id' in ctx || 'project_id' in ctx || 'id' in ctx || 'view' in ctx)) {
				return ctx;
			}
		}
		return null;
	};

	/** @param {string} handle */
	const storeAuthHandle = (handle) => {
		authHandle = handle;
		authConnected = true;
		authInvalid = false;
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem('procore_auth_handle', handle);
		}
	};

	/** @param {unknown} payload */
	const handleAuthSuccess = (payload) => {
		const typedPayload = /** @type {{ handle?: string } | null} */ (payload);
		if (typedPayload?.handle) {
			storeAuthHandle(typedPayload.handle);
		}
		// no-op
	};

	/** @param {'vendor' | 'shipTo' | 'help'} tab */
	const setActiveTab = (tab) => {
		activeTab = tab;
		if (tab === 'vendor') {
			userSearchedVendor = false;
		} else if (tab === 'shipTo') {
			userSearchedShipTo = false;
		}
	};

	/** @param {unknown} error */
	const handleAuthFailure = (error) => {
		const typedError = /** @type {{ message?: string } | null} */ (error);
		const message = typedError?.message ?? String(error ?? 'unknown_error');
		console.warn(`Procore auth failed: ${message}`);
	};
	const loadIframeHelpers = async () => {
		if (iframeHelpers) return iframeHelpers;
		// @ts-ignore - remote module has no local typings.
		const module = await import('https://cdn.skypack.dev/@flexbase-eng/procore-iframe-helpers');
		if (!module) return null;
		iframeHelpers = module.default ?? module;
		return iframeHelpers;
	};

	const getIframeContext = async () => {
		if (iframeContext) return iframeContext;
		const helpers = await loadIframeHelpers();
		if (!helpers?.initialize) return null;
		iframeContext = helpers.initialize();
		return iframeContext;
	};

	const startOAuth = async () => {
		if (typeof window === 'undefined') return;
		try {
			const context = await getIframeContext();
			if (!context?.authentication?.authenticate) {
				console.warn('Procore iframe helper unavailable. Falling back to direct auth.');
				window.location.assign('/api/procore/oauth/start');
				return;
			}
			context.authentication.authenticate({
				url: '/api/procore/oauth/start',
				onSuccess: handleAuthSuccess,
				onFailure: handleAuthFailure
			});
		} catch (err) {
			console.warn('Unable to start Procore auth', err);
			console.warn('Unable to start Procore auth. See console for details.');
		}
	};

	const checkAuthStatus = async () => {
		if (typeof window === 'undefined') return { ok: false, reason: 'no_window' };
		try {
			const url = new URL('/api/procore/oauth/status', window.location.origin);
			if (authHandle) {
				url.searchParams.set('auth_handle', authHandle);
			}
			const response = await fetch(url.toString(), {
				method: 'GET',
				credentials: 'include',
				headers: { Accept: 'application/json' }
			});
			if (response.ok) {
				authConnected = true;
				authInvalid = false;
				return { ok: true };
			} else {
				const payload = await response.json().catch(() => ({}));
				authConnected = false;
				authInvalid = payload?.reason === 'refresh_failed';
				return { ok: false, reason: payload?.reason };
			}
		} catch {
			authConnected = false;
			authInvalid = false;
			return { ok: false, reason: 'request_failed' };
		}
	};

	/** @param {unknown} value */
	const asString = (value) => (value === null || value === undefined ? '' : String(value));

	/** @param {any} payload */
	const extractVendorCompany = (payload) => {
		const vendorCompany =
			payload?.vendor?.company ??
			payload?.vendor_company ??
			payload?.vendor?.company_name ??
			payload?.vendor?.name ??
			payload?.vendor?.vendor_name ??
			payload?.invoice_contacts?.[0]?.name ??
			payload?.invoice_contacts?.[0]?.vendor_name;
		if (typeof vendorCompany === 'string') return vendorCompany;
		if (vendorCompany && typeof vendorCompany === 'object') {
			if (typeof vendorCompany.name === 'string') return vendorCompany.name;
		}
		return '';
	};

	/** @param {string} value */
	const normalizeProjectName = (value) => value.replace(/\s*-\s*/, ' ').trim();

	/** @param {any} payload */
	const extractProjectName = (payload) => {
		const projectName = payload?.project?.name ?? payload?.project_name;
		if (typeof projectName === 'string') return normalizeProjectName(projectName);
		if (projectName && typeof projectName === 'object') {
			if (typeof projectName.name === 'string') return normalizeProjectName(projectName.name);
		}
		return '';
	};

	/** @param {unknown} data */
	const extractView = (data) => {
		const fromContext = extractContext(data)?.view;
		if (typeof fromContext === 'string') return fromContext;
		const fromPayload = /** @type {any} */ (data)?.payload?.view;
		if (typeof fromPayload === 'string') return fromPayload;
		const directView = /** @type {any} */ (data)?.view;
		if (typeof directView === 'string') return directView;
		return null;
	};

	/** @param {unknown} data */
	const requestVendorCompany = async (data) => {
		const context = extractContext(data);
		const view = extractView(data);
		/** @type {'commitments.purchase_order_contracts.edit' | 'commitments.work_order_contracts.edit' | null} */
		const viewKey =
			view === 'commitments.purchase_order_contracts.edit' || view === 'commitments.work_order_contracts.edit'
				? view
				: null;
		if (!context || !viewKey) return;
		const endpoint = COMMITMENT_ENDPOINTS[viewKey];
		if (!endpoint) return;
		if (viewKey === 'commitments.purchase_order_contracts.edit') {
			vendorTabDisabled = false;
			setActiveTab('vendor');
			shipToTabLabel = 'Ship To Address';
			shipToTabIsShipTo = true;
		}
		if (viewKey === 'commitments.work_order_contracts.edit') {
			vendorTabDisabled = false;
			setActiveTab('vendor');
			shipToTabLabel = 'Project Address';
			shipToTabIsShipTo = false;
		}
		if (!context?.id || !context?.project_id || !context?.company_id) return;

		if (viewKey === 'commitments.purchase_order_contracts.edit' && !vendorName.trim()) {
			lastVendorLookupKey = null;
		}
		if (viewKey === 'commitments.work_order_contracts.edit' && !shipToName.trim()) {
			lastVendorLookupKey = null;
		}

		const requestKey = `${viewKey}:${context.id}:${context.project_id}:${context.company_id}`;
		if (vendorLookupInFlight || lastVendorLookupKey === requestKey) return;
		vendorLookupInFlight = true;
		lastVendorLookupKey = requestKey;

		try {
			const url = new URL(PROCORE_PROXY_ENDPOINT, window.location.origin);
			url.searchParams.set('view', viewKey);
			url.searchParams.set('id', asString(context.id));
			url.searchParams.set('project_id', asString(context.project_id));
			url.searchParams.set('company_id', asString(context.company_id));
			if (authHandle) {
				url.searchParams.set('auth_handle', authHandle);
			}
			const response = await fetch(url.toString(), {
				method: 'GET',
				credentials: 'include',
				headers: {
					Accept: 'application/json'
				}
			});
			const isJson = response.headers.get('content-type')?.includes('application/json');
			const payload = isJson ? await response.json() : await response.text();
			if (!response.ok) {
				console.warn('Procore vendor lookup failed', { status: response.status, payload });
				if (response.status === 401) {
					authConnected = false;
					authInvalid = true;
				}
				lastVendorLookupKey = null;
				throw new Error(`Procore API request failed with status ${response.status}`);
			}
			if (viewKey === 'commitments.purchase_order_contracts.edit') {
				const vendorCompany = extractVendorCompany(payload);
				if (vendorCompany && !userSearchedVendor) {
					vendorName = vendorCompany;
					userSearchedVendor = false;
					void loadSites('vendor', false);
				}
				const projectName = extractProjectName(payload);
				if (projectName && !userSearchedShipTo) {
					shipToName = projectName;
					userSearchedShipTo = false;
					void loadSites('shipTo', false);
				}
			}
			if (viewKey === 'commitments.work_order_contracts.edit') {
				const vendorCompany = extractVendorCompany(payload);
				if (vendorCompany && !userSearchedVendor) {
					vendorName = vendorCompany;
					userSearchedVendor = false;
					void loadSites('vendor', false);
				}
				const projectName = extractProjectName(payload);
				if (projectName && !userSearchedShipTo) {
					shipToName = projectName;
					userSearchedShipTo = false;
					void loadSites('shipTo', false);
				}
			}
		} catch (err) {
			console.warn('Unable to fetch vendor company from Procore', err);
			lastVendorLookupKey = null;
		} finally {
			vendorLookupInFlight = false;
		}
	};

	/** @param {unknown} data */
	const hasRequiredContext = (data) => {
		const context = extractContext(data);
		return Boolean(
			context &&
			context.company_id !== undefined &&
			context.project_id !== undefined &&
			context.id !== undefined
		);
	};

	/** @param {MessageEvent} event */
	const handleMessage = (event) => {
		if (!allowedOrigins.has(event.origin)) {
			console.warn('Blocked message from unexpected origin', event.origin);
			return; // guard against unexpected sources
		}

		const incomingView = extractView(event.data);
		if (event.data && typeof event.data === 'object' && 'type' in event.data) {
			const type = /** @type {{ type?: unknown }} */ (event.data).type;
			if (type === 'sidepanel:app:visible') {
				requestParentContext();
			}
			if (type === 'context') {
				hasContext = true;
				if (contextPoller !== null) {
					clearInterval(contextPoller);
					contextPoller = null;
				}
			}
			if (type === 'vendor_app.parent_url') {
				const payload = /** @type {{ payload?: { url?: string } }} */ (event.data).payload;
				return;
			}
		}

		if (!hasRequiredContext(event.data)) {
			return;
		}

		requestVendorCompany(event.data);
	};

	const attachEarlyListener = () => {
		if (listenerAttached || typeof window === 'undefined') return;
		window.addEventListener('message', handleMessage);
		listenerAttached = true;
	};

	const sendReadySignal = () => {
		if (readySignaled || typeof window === 'undefined' || !window.parent) return;
		window.parent.postMessage(
			{
				type: 'vendor_app.ready',
				payload: { timestamp: Date.now(), source: 'vendor_app' }
			},
			'*'
		);
		readySignaled = true;
	};

	const requestParentContext = () => {
		if (typeof window === 'undefined' || !window.parent) return;
		const now = Date.now();
		if (now - lastContextRequest < 250) return;
		window.parent.postMessage(
			{
				type: 'vendor_app.request_context',
				payload: { timestamp: Date.now(), source: 'vendor_app' }
			},
			'*'
		);
		lastContextRequest = now;
	};

	const requestParentUrl = () => {
		if (requestedParentUrl || typeof window === 'undefined' || !window.parent) return;
		window.parent.postMessage(
			{
				type: 'vendor_app.request_parent_url',
				payload: { timestamp: Date.now(), source: 'vendor_app' }
			},
			'*'
		);
		requestedParentUrl = true;
	};

	const scheduleContextBurst = () => {
		if (typeof window === 'undefined') return;
		for (let i = 0; i < 3; i += 1) {
			window.setTimeout(() => {
				if (!hasContext) {
					requestParentContext();
				}
			}, i * 250);
		}
	};

	// Attach as early as possible in the module scope for iframe scenarios where the host posts immediately.
	attachEarlyListener();
	sendReadySignal();
	requestParentContext();
	requestParentUrl();
	scheduleContextBurst();

	onMount(() => {
		attachEarlyListener();

		// Signal readiness to the parent/Procore host so it can send supported events.
		if (window?.parent) {
			sendReadySignal();
			requestParentContext();
			requestParentUrl();
			scheduleContextBurst();

			// Poll for context in case host only sends after visibility changes; stop once received.
			contextPoller = window.setInterval(() => {
				if (!hasContext) {
					requestParentContext();
				} else if (contextPoller !== null) {
					clearInterval(contextPoller);
					contextPoller = null;
				}
			}, 1500);
		}
	});

	onDestroy(() => {
		if (listenerAttached && typeof window !== 'undefined') {
			window.removeEventListener('message', handleMessage);
			listenerAttached = false;
		}
		if (contextPoller !== null) {
			clearInterval(contextPoller);
			contextPoller = null;
		}
		if (toastTimer !== null) {
			clearTimeout(toastTimer);
			toastTimer = null;
		}
	});

	const refreshSearch = () => {
		vendorName = '';
		userSearchedVendor = false;
	};

	const refreshShipToSearch = () => {
		shipToName = '';
		userSearchedShipTo = false;
	};

	const toggleTypeFilter = () => {
		showTypeFilter = !showTypeFilter;
	};

	/** @param {string} type */
	const toggleTypeSelection = (type) => {
		selectedTypes = selectedTypes.includes(type)
			? selectedTypes.filter((value) => value !== type)
			: [...selectedTypes, type];
	};

	/** @param {string} type */
	const clearTypeSelection = (type) => {
		selectedTypes = selectedTypes.filter((value) => value !== type);
	};

	$: {
		const query = vendorName.trim().toLowerCase();
		const nameFiltered = query
			? vendorSites.filter((site) =>
					`${site.id} ${site.name}`.toLowerCase().includes(query)
			  )
			: [];
		filteredVendorSites = selectedTypes.length
			? nameFiltered.filter((site) => selectedTypes.includes(site.type))
			: nameFiltered;
	}

	$: {
		const query = shipToName.trim().toLowerCase();
		const nameFiltered = query
			? shipToSites.filter((site) =>
					`${site.id} ${site.name}`.toLowerCase().includes(query)
			  )
			: [];
		filteredShipToSites = selectedTypes.length
			? nameFiltered.filter((site) => selectedTypes.includes(site.type))
			: nameFiltered;
	}

	$: groupedVendorSites = groupSites(filteredVendorSites);
	$: groupedShipToSites = groupSites(filteredShipToSites);

	$: {
		if (selectedSiteId && !groupedVendorSites.some((site) => site.key === selectedSiteId)) {
			selectedSiteId = null;
		}
	}

	$: {
		if (selectedShipToId && !groupedShipToSites.some((site) => site.key === selectedShipToId)) {
			selectedShipToId = null;
		}
	}

	/** @param {string} id */
	const toggleSelected = (id) => {
		const isSelecting = selectedSiteId !== id;
		selectedSiteId = isSelecting ? id : null;
		if (isSelecting) {
			const site = groupedVendorSites.find((entry) => entry.key === id);
			if (site) {
				copyAddressForGroup(site);
			}
		}
	};

	/** @param {string} id */
	const toggleShipToSelected = (id) => {
		const isSelecting = selectedShipToId !== id;
		selectedShipToId = isSelecting ? id : null;
		if (isSelecting) {
			const site = groupedShipToSites.find((entry) => entry.key === id);
			if (site) {
				copyAddressForGroup(site);
			}
		}
	};

	/** @param {Site} site */
	const formatAddressBlock = (site) =>
		`${site.address}\n${site.city}, ${site.state} ${site.zip}`;

	/** @param {unknown} value */
	const parseTypes = (value) => {
		if (typeof value !== 'string') return [];
		return value
			.split(',')
			.map((entry) => entry.trim())
			.filter(Boolean);
	};

	/** @param {string} value */
const typeIconKey = (value) => {
	const normalized = value.trim().toLowerCase();
	if (normalized === 'purchasing') return 'purchasing';
	if (normalized === 'payment' || normalized === 'pay') return 'payment';
	if (normalized === 'request for quote' || normalized === 'request for quotation') return 'request_for_quote';
	return '';
};

	/** @param {{ address: string, city: string, state: string, zip: string }} location */
	const formatAddressBlockFromParts = (location) =>
		`${location.address}\n${location.city}, ${location.state} ${location.zip}`;

	/** @param {Site[]} sites */
	const groupSites = (sites) => {
		/** @type {Map<string, GroupedSite>} */
		const map = new Map();
		for (const site of sites) {
			const key = `${site.name}${site.address}|${site.city}|${site.state}|${site.zip}`;
			const existing = map.get(key);
			const types = parseTypes(site.type);
			if (existing) {
				for (const entry of types) {
					if (!existing.types.includes(entry)) {
						existing.types = [...existing.types, entry];
					}
				}
				if (!existing.siteIds.includes(site.id)) {
					existing.siteIds = [...existing.siteIds, site.id];
				}
				continue;
			}
			map.set(key, {
				key,
				id: site.id,
				name: site.name,
				address: site.address,
				city: site.city,
				state: site.state,
				zip: site.zip,
				types,
				siteIds: [site.id]
			});
		}
		return Array.from(map.values());
	};

	/** @param {Site} site */
	const copyAddress = (site) => {
		if (typeof window === 'undefined' || !navigator?.clipboard?.writeText) return;
		const text = formatAddressBlock(site);
		navigator.clipboard
			.writeText(text)
			.then(() => showToast('Copied address block', site.id, activeTab))
			.catch((err) => {
				if (!fallbackCopy(text, site.id, activeTab)) {
					console.warn('Unable to copy address block', err);
					showToast('Copy blocked. Select and press Ctrl/Cmd+C', site.id, activeTab);
				}
			});
	};

	/** @param {GroupedSite} site */
	const copyAddressForGroup = (site) => {
		if (typeof window === 'undefined' || !navigator?.clipboard?.writeText) return;
		const text = formatAddressBlockFromParts(site);
		navigator.clipboard
			.writeText(text)
			.then(() => showToast('Copied address block', site.key, activeTab))
			.catch((err) => {
				if (!fallbackCopy(text, site.key, activeTab)) {
					console.warn('Unable to copy address block', err);
					showToast('Copy blocked. Select and press Ctrl/Cmd+C', site.key, activeTab);
				}
			});
	};

	/**
	 * @param {string} text
	 * @param {string | null} targetId
	 * @param {'vendor' | 'shipTo' | 'help' | null} targetTab
	 */
	const fallbackCopy = (text, targetId, targetTab) => {
		try {
			const textarea = document.createElement('textarea');
			textarea.value = text;
			textarea.setAttribute('readonly', '');
			textarea.style.position = 'fixed';
			textarea.style.opacity = '0';
			document.body.appendChild(textarea);
			textarea.select();
			const ok = document.execCommand('copy');
			document.body.removeChild(textarea);
			if (ok) {
				showToast('Copied address block', targetId, targetTab);
			}
			return ok;
		} catch {
			return false;
		}
	};

	/**
	 * @param {string} message
	 * @param {string | null} targetId
	 * @param {'vendor' | 'shipTo' | 'help' | null} targetTab
	 */
	const showToast = (message, targetId = null, targetTab = null) => {
		toastMessage = message;
		toastTargetId = targetId;
		toastTargetTab = targetTab;
		if (toastTimer !== null) {
			clearTimeout(toastTimer);
		}
		toastTimer = window.setTimeout(() => {
			toastMessage = '';
			toastTargetId = null;
			toastTargetTab = null;
			toastTimer = null;
		}, 2000);
	};

	/** @param {MouseEvent} event */
	const handleDocumentClick = (event) => {
		if (!showTypeFilter) return;
		const target = /** @type {Node | null} */ (event.target);
		if (filterWrap && target && filterWrap.contains(target)) return;
		showTypeFilter = false;
	};

	onMount(() => {
		shipToTabLabel = 'Project Address';
		shipToTabIsShipTo = false;
		if (typeof localStorage !== 'undefined') {
			const storedHandle = localStorage.getItem('procore_auth_handle');
			if (storedHandle) {
				authHandle = storedHandle;
				authConnected = true;
			}
		}
		Promise.resolve(checkAuthStatus()).then((status) => {
			if (status?.ok) return;
			if (!authHandle || autoAuthAttempted) return;
			autoAuthAttempted = true;
			startOAuth();
		});
		const statusTimer = window.setInterval(checkAuthStatus, 60000);
		if (typeof window === 'undefined') return;
		window.addEventListener('click', handleDocumentClick);
		return () => {
			clearInterval(statusTimer);
			window.removeEventListener('click', handleDocumentClick);
		};
	});
</script>

<main class="page">
	<section class="panel">
		<header class="panel__header">
			<div class="panel__header-row">
				<div class="panel__title"><img class='headerLogo' src={stackedLogo} alt="Logo" /></div>
			</div>
			<div class="tabs" role="tablist" aria-label="Location panels">
				<button
					class="tab"
					class:tab--active={activeTab === 'vendor'}
					role="tab"
					type="button"
					aria-selected={activeTab === 'vendor'}
					aria-disabled={vendorTabDisabled}
					disabled={vendorTabDisabled}
					on:click={() => setActiveTab('vendor')}
				>
				<svg class="tab__icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
					<g fill="none" stroke="currentColor" stroke-width="1.5">
						<path d="M2 7.5V22h20V7.5L12 2z" />
						<path d="M6 16v6h6v-6zm6 0v6h6v-6zm-3-6v6h6v-6z" />
					</g>
				</svg>
					Supplier Address
				</button>
				<button
					class="tab"
					class:tab--active={activeTab === 'shipTo'}
					role="tab"
					type="button"
					aria-selected={activeTab === 'shipTo'}
					on:click={() => setActiveTab('shipTo')}
				>
				{#if shipToTabIsShipTo}
					<svg class="tab__icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
						<path fill="currentColor" d="m.5 13.325l.5-2h5.5l-.5 2zM7 20q-1.25 0-2.125-.875T4 17H1.5l.5-2.175h5.175l.9-3.65h2.1l1.25-5H4.5l.15-.6q.15-.7.688-1.137T6.6 4H18l-.925 4H20l3 4l-1 5h-2q0 1.25-.875 2.125T17 20t-2.125-.875T14 17h-4q0 1.25-.875 2.125T7 20M2.5 9.675l.5-2h6.5l-.5 2zM7 18q.425 0 .713-.288T8 17t-.288-.712T7 16t-.712.288T6 17t.288.713T7 18m10 0q.425 0 .713-.288T18 17t-.288-.712T17 16t-.712.288T16 17t.288.713T17 18m-1.075-5h4.825l.1-.525L19 10h-2.375z" />
					</svg>
				{:else}
					<svg class="tab__icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 16 16">
						<path fill="currentColor" d="M3 14a1 1 0 1 0 0-2a1 1 0 0 0 0 2m7-1a1 1 0 1 1-2 0a1 1 0 0 1 2 0m-4 1a1 1 0 1 0 0-2a1 1 0 0 0 0 2" />
						<path fill="currentColor" fill-rule="evenodd" d="M13.9.146a.5.5 0 0 0-.674-.03l-5.94 4.95c-.407-.063-.898-.063-1.67-.063h-1.09c-.451 0-.815 0-1.11.02c-.304.02-.574.064-.828.17c-.613.254-1.1.74-1.35 1.35c-.106.255-.149.524-.17.828c-.02.296-.02.66-.02 1.11v2.28c-.614.549-1 1.35-1 2.24c0 1.66 1.34 3 3 3h6c1.66 0 3-1.34 3-3c0-.888-.386-1.69-1-2.24v-.764c-.002-.612-.016-1.02-.087-1.38a4.5 4.5 0 0 0-.494-1.33l3.58-3.58v6.56a1.998 1.998 0 0 0 1 3.73h.5a.5.5 0 0 0 0-1h-.5a1 1 0 0 1 0-2h.5a.5.5 0 0 0 0-1h-.5v-7.29l.354-.354a.5.5 0 0 0 0-.707zM3 9.996h-.994v-1.5c0-.473 0-.802.018-1.06c.017-.253.05-.401.096-.514c.152-.368.444-.66.812-.812c.113-.047.26-.079.514-.096c.258-.018.588-.018 1.06-.018h1c.953 0 1.36.002 1.68.067a3.5 3.5 0 0 1 2.75 2.75c.052.262.064.575.067 1.18H2.997zm6.83-3.53a4.4 4.4 0 0 0-1.44-1.05l5.08-4.24l.824.824l-4.47 4.47zM1 12.996a2 2 0 0 1 1.99-2H9c1.1.003 1.99.897 1.99 2c0 1.1-.895 2-2 2h-6c-1.1 0-2-.895-2-2z" clip-rule="evenodd" />
					</svg>
				{/if}
					{shipToTabLabel}
				</button>
				<button
					class="tab tab--help"
					class:tab--active={activeTab === 'help'}
					role="tab"
					type="button"
					aria-selected={activeTab === 'help'}
					on:click={() => setActiveTab('help')}
				>
				<svg class="tab__icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
					<path fill="currentColor" d="M10.6 16q0-2.025.363-2.912T12.5 11.15q1.025-.9 1.563-1.562t.537-1.513q0-1.025-.687-1.7T12 5.7q-1.275 0-1.937.775T9.125 8.05L6.55 6.95q.525-1.6 1.925-2.775T12 3q2.625 0 4.038 1.463t1.412 3.512q0 1.25-.537 2.138t-1.688 2.012Q14 13.3 13.738 13.913T13.475 16zm1.4 6q-.825 0-1.412-.587T10 20t.588-1.412T12 18t1.413.588T14 20t-.587 1.413T12 22" />
				</svg>
					Help
				</button>
			</div>
		</header>

		<div class="panel__content">
			{#if activeTab === 'vendor'}
				<div class="search" role="tabpanel" aria-label="Vendor Site ID">
					<div class="search__header">
						<button
							class="auth-button"
							class:auth-button--connected={authConnected}
							class:auth-button--invalid={authInvalid}
							type="button"
							title={authConnected ? 'Connected to Procore' : 'Not connected. Click to connect.'}
							aria-label={authConnected ? 'Connected to Procore' : 'Not connected. Click to connect.'}
							on:click={startOAuth}
						>
							{#if authConnected}
								<svg class="auth-button__icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 512" aria-hidden="true">
									<path fill="currentColor" d="m272.2 64.6l-51.1 51.1c-15.3 4.2-29.5 11.9-41.5 22.5L153 161.9c-10.2 9.1-23.5 14.1-37.2 14.1H96v128c20.4.6 39.8 8.9 54.3 23.4l35.6 35.6l7 7l27 27c6.2 6.2 16.4 6.2 22.6 0c1.7-1.7 3-3.7 3.7-5.8c2.8-7.7 9.3-13.5 17.3-15.3s16.4.6 22.2 6.5l10.8 10.6c11.6 11.6 30.4 11.6 41.9 0c5.4-5.4 8.3-12.3 8.6-19.4c.4-8.8 5.6-16.6 13.6-20.4s17.3-3 24.4 2.1c9.4 6.7 22.5 5.8 30.9-2.6c9.4-9.4 9.4-24.6 0-33.9L340.1 243l-35.8 33c-27.3 25.2-69.2 25.6-97 .9c-31.7-28.2-32.4-77.4-1.6-106.5l70.1-66.2C303.2 78.4 339.4 64 377.1 64c36.1 0 71 13.3 97.9 37.2l30.1 26.8H624c8.8 0 16 7.2 16 16v208c0 17.7-14.3 32-32 32h-32c-11.8 0-22.2-6.4-27.7-16h-84.9c-3.4 6.7-7.9 13.1-13.5 18.7c-17.1 17.1-40.8 23.8-63 20.1c-3.6 7.3-8.5 14.1-14.6 20.2c-27.3 27.3-70 30-100.4 8.1c-25.1 20.8-62.5 19.5-86-4.1L159 404l-7-7l-35.6-35.6c-5.5-5.5-12.7-8.7-20.4-9.3c0 17.6-14.4 31.9-32 31.9H32c-17.7 0-32-14.3-32-32V144c0-8.8 7.2-16 16-16h99.8c2 0 3.9-.7 5.3-2l26.5-23.6C175.5 77.7 211.4 64 248.7 64H259c4.4 0 8.9.2 13.2.6M544 320V176h-48c-5.9 0-11.6-2.2-15.9-6.1l-36.9-32.8C425 120.9 401.5 112 377.1 112c-25.4 0-49.8 9.7-68.3 27.1l-70.1 66.2c-10.3 9.8-10.1 26.3.5 35.7c9.3 8.3 23.4 8.1 32.5-.3l71.9-66.4c9.7-9 24.9-8.4 33.9 1.4s8.4 24.9-1.4 33.9l-.8.8l74.4 74.4c10 10 16.5 22.3 19.4 35.1h74.8zM64 336a16 16 0 1 0-32 0a16 16 0 1 0 32 0m528 16a16 16 0 1 0 0-32a16 16 0 1 0 0 32" />
								</svg>
							{:else}
								<svg class="auth-button__icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 512" aria-hidden="true">
									<path fill="currentColor" d="M38.8 5.1C28.4-3.1 13.3-1.2 5.1 9.2s-6.3 25.5 4.1 33.7l592 464c10.4 8.2 25.5 6.3 33.7-4.1s6.3-25.5-4.1-33.7l-135-105.8c-1.1-11.4-6.3-22.3-15.3-30.7l-134.2-123l-23.4 18.2l-26-20.3l77.2-60.1c7-5.4 17-4.2 22.5 2.8s4.2 17-2.8 22.5l-20.9 16.2L512 316.8V128h-.7l-3.9-2.5L434.8 79c-15.3-9.8-33.2-15-51.4-15c-21.8 0-43 7.5-60 21.2l-89.7 72.6l-25.8-20.3l81.8-66.2c-11.6-4.9-24.1-7.4-36.8-7.4C234 64 215.7 69.6 200 80l-35.5 23.7zM96 171.6L40.6 128H0v224c0 17.7 14.3 32 32 32h32c17.7 0 32-14.3 32-32zm317.6 250.3L128 196.9V352h28.2l91.4 83.4c19.6 17.9 49.9 16.5 67.8-3.1c5.5-6.1 9.2-13.2 11.1-20.6l17 15.6c19.5 17.9 49.9 16.6 67.8-2.9c.8-.8 1.5-1.7 2.2-2.6zM48 320a16 16 0 1 1 0 32a16 16 0 1 1 0-32m496-192v224c0 17.7 14.3 32 32 32h32c17.7 0 32-14.3 32-32V128zm32 208a16 16 0 1 1 32 0a16 16 0 1 1-32 0" />
								</svg>
							{/if}
						</button>
						<div class="search__filter-wrap" bind:this={filterWrap}>
							<button class="search__filter" aria-label="Filter by type" on:click={toggleTypeFilter}>
								<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<path d="M3 4h18l-7 8v6l-4 2v-8z" />
								</svg>
							</button>
							{#if showTypeFilter}
								<div class="search__filter-panel" role="listbox" aria-label="Filter by type">
									{#each typeOptions as type}
										<label class="filter-option">
											<input
												type="checkbox"
												checked={selectedTypes.includes(type)}
												on:change={() => toggleTypeSelection(type)}
											/>
											<span class="filter-option__dot" aria-hidden="true"></span>
											<span>{type}</span>
										</label>
									{/each}
								</div>
							{/if}
						</div>
					</div>
					<div class="search__input">
						<input
							type="text"
							bind:value={vendorName}
							placeholder="enter Supplier Name or ID"
							aria-label="Supplier Name or ID"
						/>
						{#if vendorName.trim().length}
							<button class="search__refresh" aria-label="Clear" on:click={refreshSearch}>
								<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<line x1="6" y1="6" x2="18" y2="18" />
									<line x1="6" y1="18" x2="18" y2="6" />
								</svg>
							</button>
						{/if}
						<button class="search__submit" aria-label="Search" on:click={() => loadSites('vendor')}>
							<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<circle cx="11" cy="11" r="7" />
								<path d="M21 21l-4.35-4.35" />
							</svg>
						</button>
					</div>
					{#if selectedTypes.length}
						<div class="filter-chips" aria-label="Active type filters">
							{#each selectedTypes as type}
								<button class="filter-chip" type="button" on:click={() => clearTypeSelection(type)}>
									<span>{type}</span>
									<span aria-hidden="true">&times;</span>
								</button>
							{/each}
						</div>
					{/if}
				</div>

			<div class="list" role="list">
				{#if groupedVendorSites.length === 0}
					<div class="list__empty">
						{sitesLoading ? 'Loading locations…' : 'No results found'}
					</div>
				{:else}
					{#each groupedVendorSites as site}
						<section
							class="card"
							class:selected={selectedSiteId === site.key}
							role="button"
							tabindex="0"
							on:click={() => toggleSelected(site.key)}
							on:keydown={(event) => {
								if (event.key === 'Enter' || event.key === ' ') {
									event.preventDefault();
									toggleSelected(site.key);
								}
							}}
							aria-pressed={selectedSiteId === site.key}
						>
							{#if toastMessage && toastTargetId === site.key && toastTargetTab === 'vendor'}
								<div class="card__toast" aria-live="polite">
									{toastMessage}
								</div>
							{/if}
							<div class="card__chip-row">
								{#each site.types as type}
									<span class="card__chip" title={type} aria-label={type}>
										{#if typeIconKey(type) === 'purchasing'}
											<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
												<path fill="currentColor" d="m.5 13.325l.5-2h5.5l-.5 2zM7 20q-1.25 0-2.125-.875T4 17H1.5l.5-2.175h5.175l.9-3.65h2.1l1.25-5H4.5l.15-.6q.15-.7.688-1.137T6.6 4H18l-.925 4H20l3 4l-1 5h-2q0 1.25-.875 2.125T17 20t-2.125-.875T14 17h-4q0 1.25-.875 2.125T7 20M2.5 9.675l.5-2h6.5l-.5 2zM7 18q.425 0 .713-.288T8 17t-.288-.712T7 16t-.712.288T6 17t.288.713T7 18m10 0q.425 0 .713-.288T18 17t-.288-.712T17 16t-.712.288T16 17t.288.713T17 18m-1.075-5h4.825l.1-.525L19 10h-2.375z" />
											</svg>
										{:else if typeIconKey(type) === 'payment'}
											<svg class="card__chip-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">
												<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2">
													<circle cx="12" cy="12" r="10" />
													<path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8m4 2V6" />
												</g>
											</svg>
										{:else if typeIconKey(type) === 'request_for_quote'}
											<svg class="card__chip-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" aria-hidden="true">
												<path fill="currentColor" d="M2.5 1.75v11.5c0 .138.112.25.25.25h3.17a.75.75 0 0 1 0 1.5H2.75A1.75 1.75 0 0 1 1 13.25V1.75C1 .784 1.784 0 2.75 0h8.5C12.216 0 13 .784 13 1.75v7.736a.75.75 0 0 1-1.5 0V1.75a.25.25 0 0 0-.25-.25h-8.5a.25.25 0 0 0-.25.25m13.274 9.537l-4.557 4.45a.75.75 0 0 1-1.055-.008l-1.943-1.95a.75.75 0 0 1 1.062-1.058l1.419 1.425l4.026-3.932a.75.75 0 1 1 1.048 1.074M4.75 4h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5M4 7.75A.75.75 0 0 1 4.75 7h2a.75.75 0 0 1 0 1.5h-2A.75.75 0 0 1 4 7.75" />
											</svg>
										{:else}
											<span class="card__chip-text">{type}</span>
										{/if}
									</span>
								{/each}
							</div>
							<div class="card__content">
								<div class="card__text">
									<div class="card__title">{site.id} - {site.name}</div>
									<div class="card__address">{site.address}</div>
									<div class="card__address">{site.city}, {site.state} {site.zip}</div>
								</div>
							</div>
							<span class="card__copy-icon" aria-hidden="true">
								<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
									<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
								</svg>
							</span>
						</section>
					{/each}
				{/if}
			</div>
			{:else if activeTab === 'shipTo'}
				<div class="search" role="tabpanel" aria-label="Ship To">
					<div class="search__header">
						<button
							class="auth-button"
							class:auth-button--connected={authConnected}
							class:auth-button--invalid={authInvalid}
							type="button"
							title={authConnected ? 'Connected to Procore' : 'Not connected. Click to connect.'}
							aria-label={authConnected ? 'Connected to Procore' : 'Not connected. Click to connect.'}
							on:click={startOAuth}
						>
							{#if authConnected}
								<svg class="auth-button__icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 512" aria-hidden="true">
									<path fill="currentColor" d="m272.2 64.6l-51.1 51.1c-15.3 4.2-29.5 11.9-41.5 22.5L153 161.9c-10.2 9.1-23.5 14.1-37.2 14.1H96v128c20.4.6 39.8 8.9 54.3 23.4l35.6 35.6l7 7l27 27c6.2 6.2 16.4 6.2 22.6 0c1.7-1.7 3-3.7 3.7-5.8c2.8-7.7 9.3-13.5 17.3-15.3s16.4.6 22.2 6.5l10.8 10.6c11.6 11.6 30.4 11.6 41.9 0c5.4-5.4 8.3-12.3 8.6-19.4c.4-8.8 5.6-16.6 13.6-20.4s17.3-3 24.4 2.1c9.4 6.7 22.5 5.8 30.9-2.6c9.4-9.4 9.4-24.6 0-33.9L340.1 243l-35.8 33c-27.3 25.2-69.2 25.6-97 .9c-31.7-28.2-32.4-77.4-1.6-106.5l70.1-66.2C303.2 78.4 339.4 64 377.1 64c36.1 0 71 13.3 97.9 37.2l30.1 26.8H624c8.8 0 16 7.2 16 16v208c0 17.7-14.3 32-32 32h-32c-11.8 0-22.2-6.4-27.7-16h-84.9c-3.4 6.7-7.9 13.1-13.5 18.7c-17.1 17.1-40.8 23.8-63 20.1c-3.6 7.3-8.5 14.1-14.6 20.2c-27.3 27.3-70 30-100.4 8.1c-25.1 20.8-62.5 19.5-86-4.1L159 404l-7-7l-35.6-35.6c-5.5-5.5-12.7-8.7-20.4-9.3c0 17.6-14.4 31.9-32 31.9H32c-17.7 0-32-14.3-32-32V144c0-8.8 7.2-16 16-16h99.8c2 0 3.9-.7 5.3-2l26.5-23.6C175.5 77.7 211.4 64 248.7 64H259c4.4 0 8.9.2 13.2.6M544 320V176h-48c-5.9 0-11.6-2.2-15.9-6.1l-36.9-32.8C425 120.9 401.5 112 377.1 112c-25.4 0-49.8 9.7-68.3 27.1l-70.1 66.2c-10.3 9.8-10.1 26.3.5 35.7c9.3 8.3 23.4 8.1 32.5-.3l71.9-66.4c9.7-9 24.9-8.4 33.9 1.4s8.4 24.9-1.4 33.9l-.8.8l74.4 74.4c10 10 16.5 22.3 19.4 35.1h74.8zM64 336a16 16 0 1 0-32 0a16 16 0 1 0 32 0m528 16a16 16 0 1 0 0-32a16 16 0 1 0 0 32" />
								</svg>
							{:else}
								<svg class="auth-button__icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 512" aria-hidden="true">
									<path fill="currentColor" d="M38.8 5.1C28.4-3.1 13.3-1.2 5.1 9.2s-6.3 25.5 4.1 33.7l592 464c10.4 8.2 25.5 6.3 33.7-4.1s6.3-25.5-4.1-33.7l-135-105.8c-1.1-11.4-6.3-22.3-15.3-30.7l-134.2-123l-23.4 18.2l-26-20.3l77.2-60.1c7-5.4 17-4.2 22.5 2.8s4.2 17-2.8 22.5l-20.9 16.2L512 316.8V128h-.7l-3.9-2.5L434.8 79c-15.3-9.8-33.2-15-51.4-15c-21.8 0-43 7.5-60 21.2l-89.7 72.6l-25.8-20.3l81.8-66.2c-11.6-4.9-24.1-7.4-36.8-7.4C234 64 215.7 69.6 200 80l-35.5 23.7zM96 171.6L40.6 128H0v224c0 17.7 14.3 32 32 32h32c17.7 0 32-14.3 32-32zm317.6 250.3L128 196.9V352h28.2l91.4 83.4c19.6 17.9 49.9 16.5 67.8-3.1c5.5-6.1 9.2-13.2 11.1-20.6l17 15.6c19.5 17.9 49.9 16.6 67.8-2.9c.8-.8 1.5-1.7 2.2-2.6zM48 320a16 16 0 1 1 0 32a16 16 0 1 1 0-32m496-192v224c0 17.7 14.3 32 32 32h32c17.7 0 32-14.3 32-32V128zm32 208a16 16 0 1 1 32 0a16 16 0 1 1-32 0" />
								</svg>
							{/if}
						</button>
						<div class="search__filter-wrap" bind:this={filterWrap}>
							<button class="search__filter" aria-label="Filter by type" on:click={toggleTypeFilter}>
								<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<path d="M3 4h18l-7 8v6l-4 2v-8z" />
								</svg>
							</button>
							{#if showTypeFilter}
								<div class="search__filter-panel" role="listbox" aria-label="Filter by type">
									{#each typeOptions as type}
										<label class="filter-option">
											<input
												type="checkbox"
												checked={selectedTypes.includes(type)}
												on:change={() => toggleTypeSelection(type)}
											/>
											<span class="filter-option__dot" aria-hidden="true"></span>
											<span>{type}</span>
										</label>
									{/each}
								</div>
							{/if}
						</div>
					</div>
					<div class="search__input">
						<input
							type="text"
							bind:value={shipToName}
							placeholder="enter Project Name or ID"
							aria-label="Project Name or ID"
						/>
						{#if shipToName.trim().length}
							<button class="search__refresh" aria-label="Clear" on:click={refreshShipToSearch}>
								<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<line x1="6" y1="6" x2="18" y2="18" />
									<line x1="6" y1="18" x2="18" y2="6" />
								</svg>
							</button>
						{/if}
						<button class="search__submit" aria-label="Search" on:click={() => loadSites('shipTo')}>
							<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<circle cx="11" cy="11" r="7" />
								<path d="M21 21l-4.35-4.35" />
							</svg>
						</button>
					</div>
					{#if selectedTypes.length}
						<div class="filter-chips" aria-label="Active type filters">
							{#each selectedTypes as type}
								<button class="filter-chip" type="button" on:click={() => clearTypeSelection(type)}>
									<span>{type}</span>
									<span aria-hidden="true">&times;</span>
								</button>
							{/each}
						</div>
					{/if}
				</div>

			<div class="list" role="list">
				{#if groupedShipToSites.length === 0}
					<div class="list__empty">
						{sitesLoading ? 'Loading locations…' : 'No results found'}
					</div>
				{:else}
					{#each groupedShipToSites as site}
						<section
							class="card"
							class:selected={selectedShipToId === site.key}
							role="button"
							tabindex="0"
							on:click={() => toggleShipToSelected(site.key)}
							on:keydown={(event) => {
								if (event.key === 'Enter' || event.key === ' ') {
									event.preventDefault();
									toggleShipToSelected(site.key);
								}
							}}
							aria-pressed={selectedShipToId === site.key}
						>
							{#if toastMessage && toastTargetId === site.key && toastTargetTab === 'shipTo'}
								<div class="card__toast" aria-live="polite">
									{toastMessage}
								</div>
							{/if}
							<div class="card__chip-row">
								{#each site.types as type}
									<span class="card__chip" title={type} aria-label={type}>
										{#if typeIconKey(type) === 'purchasing'}
											<svg class="card__chip-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">
												<path fill="currentColor" d="M7.502 19q-1.04 0-1.771-.73Q5 17.543 5 16.5H3.379q-.213 0-.356-.144t-.144-.357t.144-.356t.356-.143h1.877q.271-.667.875-1.084Q6.735 14 7.5 14t1.37.416q.603.417.874 1.084h4.618L16.558 6H6.212q-.213 0-.357-.144t-.143-.357t.143-.356T6.212 5h10.577q.384 0 .626.308q.243.308.156.686L16.998 8.5h1.271q.384 0 .727.172q.344.171.566.474l1.797 2.398q.218.292.283.609q.066.316.01.664l-.598 3.037q-.056.292-.284.469t-.518.177h-.483q0 1.039-.728 1.77t-1.77.73t-1.771-.73q-.73-.728-.73-1.77H10q0 1.039-.728 1.77t-1.77.73m8.385-5.75h4.651l.177-.89l-2.138-2.86h-1.818zm-1.283 1.248l.13-.58q.13-.58.33-1.42q.113-.46.198-.85q.084-.39.134-.646l.13-.58q.13-.58.33-1.42t.33-1.42l.13-.58L16.558 6l-2.197 9.5zm-12.315-1.5q-.205 0-.343-.144t-.138-.356t.143-.357t.357-.143h3.48q.213 0 .357.144t.143.357t-.143.356t-.357.143zm2-3.496q-.213 0-.357-.144t-.144-.357t.144-.356t.356-.143h4.5q.213 0 .357.144q.143.144.143.357t-.143.356t-.357.143zM7.5 18q.617 0 1.059-.441Q9 17.117 9 16.5t-.441-1.059T7.5 15t-1.059.441Q6 15.883 6 16.5t.441 1.059Q6.883 18 7.5 18m9.77 0q.617 0 1.058-.441q.441-.442.441-1.059t-.441-1.059T17.269 15t-1.058.441q-.442.442-.442 1.059t.441 1.059q.442.441 1.06.441" />
											</svg>
										{:else if typeIconKey(type) === 'payment'}
											<svg class="card__chip-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">
												<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2">
													<circle cx="12" cy="12" r="10" />
													<path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8m4 2V6" />
												</g>
											</svg>
										{:else if typeIconKey(type) === 'request_for_quote'}
											<svg class="card__chip-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" aria-hidden="true">
												<path fill="currentColor" d="M2.5 1.75v11.5c0 .138.112.25.25.25h3.17a.75.75 0 0 1 0 1.5H2.75A1.75 1.75 0 0 1 1 13.25V1.75C1 .784 1.784 0 2.75 0h8.5C12.216 0 13 .784 13 1.75v7.736a.75.75 0 0 1-1.5 0V1.75a.25.25 0 0 0-.25-.25h-8.5a.25.25 0 0 0-.25.25m13.274 9.537l-4.557 4.45a.75.75 0 0 1-1.055-.008l-1.943-1.95a.75.75 0 0 1 1.062-1.058l1.419 1.425l4.026-3.932a.75.75 0 1 1 1.048 1.074M4.75 4h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5M4 7.75A.75.75 0 0 1 4.75 7h2a.75.75 0 0 1 0 1.5h-2A.75.75 0 0 1 4 7.75" />
											</svg>
										{:else}
											<span class="card__chip-text">{type}</span>
										{/if}
									</span>
								{/each}
							</div>
							<div class="card__content">
								<div class="card__text">
									<div class="card__title">{site.id} - {site.name}</div>
									<div class="card__address">{site.address}</div>
									<div class="card__address">{site.city}, {site.state} {site.zip}</div>
								</div>
							</div>
							<span class="card__copy-icon" aria-hidden="true">
								<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
									<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
								</svg>
							</span>
						</section>
					{/each}
				{/if}
			</div>
			{:else}
				<div class="help" role="tabpanel" aria-label="Help">
					<h2>Quick Help Topics</h2>
					<div class="help__accordion">
						{#each helpTopicsWithHtml as topic}
							<div class="help__item">
								<button
									class="help__header"
									type="button"
									aria-expanded={openHelpTopicId === topic.id}
									on:click={() =>
										(openHelpTopicId = openHelpTopicId === topic.id ? '' : topic.id)}
								>
									<span>{topic.title}</span>
									<span class="help__chevron" aria-hidden="true">
										{openHelpTopicId === topic.id ? '−' : '+'}
									</span>
								</button>
								{#if openHelpTopicId === topic.id}
									<div class="help__body">
										<div class="help__body-text">{@html topic.bodyHtml}</div>
										{#if topic.image}
											<img class="help__image" src={topic.image} alt={topic.imageAlt ?? ''} />
										{/if}
									</div>
								{/if}
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</div>
		<footer class="panel__footer">
			<span>Data powered by</span>
			<img
				class="footer-logo"
				class:footer-logo--loading={sitesLoading}
				src={horizontalLogo}
				alt="Burns & McDonnell"
			/>
		</footer>
	</section>
</main>
