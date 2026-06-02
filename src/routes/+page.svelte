<script>
	import { onDestroy, onMount } from 'svelte';
	import './+page.css';
	import { helpTopics } from '$lib/help-topics';
	import { marked } from 'marked';
	import {
		buildVendorStatusSummary,
		deriveTypeOptions,
		formatAddressBlockFromParts,
		formatCityStateZip,
		getAddressLines,
		getSitePurpose,
		groupSites,
		parseTypes,
		typeFilterLabel,
		typeIconKey
	} from '$lib/site-display.js';
	import {
		buildSupplierActionState,
		hasVendorSearchSeed,
		VENDOR_SEARCH_DEBOUNCE_MS,
		VENDOR_SUGGESTION_LIMIT
	} from '$lib/vendor-search.js';
	import {
		asString,
		buildVendorAppMessage,
		COMMITMENT_ENDPOINTS,
		debugProcore,
		DETAIL_VIEWS,
		extractContext,
		extractProjectName,
		extractVendorCompany,
		extractView,
		hasRequiredProcoreContext,
		PROCORE_ALLOWED_ORIGINS,
		PROCORE_PROXY_ENDPOINT
	} from '$lib/procore-panel.js';
	import horizontalLogo from '$lib/assets/BurnsMcDonnell_Horiz_Small_RGB_R_high.png';

	/** @typedef {{ type?: string, address_purpose?: string, id: string, name: string, address: string, address_line_1?: string, address_line_2?: string, address_line_3?: string, city: string, state: string, zip: string, status?: string, status_details?: string }} Site */
	/** @typedef {{ key: string, id: string, name: string, address: string, address_line_1?: string, address_line_2?: string, address_line_3?: string, city: string, state: string, zip: string, types: string[], siteIds: string[] }} GroupedSite */
	/** @typedef {{ id: string, name: string, city: string, state: string }} VendorSuggestion */
	/** @typedef {{ authentication?: { authenticate?: (options: { url: string, onSuccess: (payload: unknown) => void, onFailure: (error: unknown) => void }) => void } }} ProcoreIframeContext */
	/** @typedef {{ initialize?: () => ProcoreIframeContext | null }} ProcoreIframeHelpers */

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
	/** @type {'vendor' | 'shipTo'} */
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
	/** @type {HTMLDivElement | null} */
	let helpButtonWrap = null;
	/** @type {HTMLDivElement | null} */
	let helpCardWrap = null;
	let vendorLookupInFlight = false;
	/** @type {string | null} */
	let lastVendorLookupKey = null;
	/** @type {ProcoreIframeHelpers | null} */
	let iframeHelpers = null;
	/** @type {ProcoreIframeContext | null} */
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
	let showHelpCard = false;
	let userSearchedVendor = false;
	let userSearchedShipTo = false;
	/** @type {VendorSuggestion[]} */
	let vendorSuggestions = [];
	let showVendorSuggestions = false;
	let vendorSearchInFlight = false;
	let vendorStatusExpanded = false;
	let vendorLookupCompleted = false;
	/** @type {number | null} */
	let vendorSearchTimer = null;
	/** @type {AbortController | null} */
	let vendorSearchAbortController = null;
	let vendorActiveSuggestionIndex = -1;
	/** @type {string | null} */
	let selectedVendorId = null;
	/** @type {string | null} */
	let selectedVendorName = null;
	/** @type {HTMLDivElement | null} */
	let vendorAutocompleteWrap = null;
	let supplierActionState = buildSupplierActionState({});

	const helpTopicsWithHtml = helpTopics.map((topic) => ({
		...topic,
		bodyHtml: marked.parse(topic.body)
	}));

	/** @type {Site[]} */
	let vendorSites = [];
	/** @type {Site[]} */
	let shipToSites = [];
	/** @type {string[]} */
	let typeOptions = [];
	/** @type {string[]} */
	let resolvedTypeOptions = [];
	/** @type {{ status: string, details: string, tone: 'red' | 'yellow' | 'gray' | 'green' } | null} */
	let vendorStatusSummary = null;

	let openHelpTopicId = '';

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
			const resolvedVendorName = String(selectedVendorName ?? '').trim() || vendorName.trim();
			const resolvedProjectName = shipToName.trim();
			if (tab === 'vendor' && !String(selectedVendorId ?? '').trim() && !resolvedVendorName) {
				vendorSites = [];
				typeOptions = [];
				vendorLookupCompleted = false;
				return;
			}
			if (tab === 'shipTo' && !resolvedProjectName) {
				shipToSites = [];
				typeOptions = [];
				return;
			}
			const endpoint = tab === 'vendor' ? '/api/vendor-sites' : '/api/project-sites';
			const requestUrl = new URL(endpoint, window.location.origin);
			if (tab === 'vendor') {
				const vendorId = String(selectedVendorId ?? '').trim();
				if (vendorId) {
					requestUrl.searchParams.set('vendor_id', vendorId);
				} else if (resolvedVendorName) {
					requestUrl.searchParams.set('vendor_name', resolvedVendorName);
				}
			} else if (resolvedProjectName) {
				requestUrl.searchParams.set('project_name', resolvedProjectName);
			}
			const response = await fetch(requestUrl.toString());
			if (!response.ok) throw new Error(`Failed to load ${tab} sites`);
			const payload = await response.json();
			const sites = Array.isArray(payload?.sites) ? payload.sites : [];
			if (tab === 'vendor') {
				vendorSites = sites;
				vendorLookupCompleted = true;
			} else {
				shipToSites = sites;
			}
			const allSitesForTab = tab === 'vendor' ? vendorSites : shipToSites;
			typeOptions = deriveTypeOptions(allSitesForTab);
		} catch (err) {
			console.warn('Unable to load sites', err);
			if (tab === 'vendor') {
				vendorLookupCompleted = true;
			}
		} finally {
			sitesLoading = false;
		}
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

	/** @param {'vendor' | 'shipTo'} tab */
	const setActiveTab = (tab) => {
		activeTab = tab;
		if (tab === 'vendor') {
			userSearchedVendor = false;
		} else if (tab === 'shipTo') {
			userSearchedShipTo = false;
		}
		showHelpCard = false;
	};

	const toggleHelpCard = () => {
		showHelpCard = !showHelpCard;
		if (showHelpCard) {
			showTypeFilter = false;
			openHelpTopicId = '';
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
		// @ts-ignore - remote URL imports are valid at runtime but unresolved by svelte-check.
		const importedModule = await import('https://cdn.skypack.dev/@flexbase-eng/procore-iframe-helpers');
		const module = /** @type {{ default?: ProcoreIframeHelpers } & ProcoreIframeHelpers} */ (
			importedModule
		);
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

	/** @param {'commitments.purchase_order_contracts.edit' | 'commitments.work_order_contracts.edit'} viewKey */
	const applyProcoreViewMode = (viewKey) => {
		vendorTabDisabled = false;
		setActiveTab('vendor');
		shipToTabLabel =
			viewKey === 'commitments.purchase_order_contracts.edit'
				? 'Ship To Address'
				: 'Project Address';
		shipToTabIsShipTo = viewKey === 'commitments.purchase_order_contracts.edit';
	};

	/** @param {unknown} payload */
	const applyProcorePayloadToSearchState = (payload) => {
		const vendorCompany = extractVendorCompany(payload);
		if (vendorCompany && !userSearchedVendor) {
			debugProcore('Vendor company extracted from Procore payload', { vendorCompany });
			vendorName = vendorCompany;
			selectedVendorId = null;
			selectedVendorName = null;
			vendorSites = [];
			vendorSuggestions = [];
			showVendorSuggestions = false;
			vendorActiveSuggestionIndex = -1;
			userSearchedVendor = false;
			void fetchVendorSuggestions(vendorCompany);
		}

		const projectName = extractProjectName(payload);
		if (projectName && !userSearchedShipTo) {
			debugProcore('Project name extracted from Procore payload', { projectName });
			shipToName = projectName;
			userSearchedShipTo = false;
			void loadSites('shipTo', false);
		}
	};

	/** @param {unknown} data */
	const requestVendorCompany = async (data) => {
		const context = extractContext(data);
		const view = extractView(data);
		const isEditView =
			view === 'commitments.purchase_order_contracts.edit' ||
			view === 'commitments.work_order_contracts.edit';
		/** @type {'commitments.purchase_order_contracts.edit' | 'commitments.work_order_contracts.edit' | null} */
		const viewKey = isEditView ? view : null;
		if (!context || !viewKey) {
			debugProcore('Skipping requestVendorCompany: missing context or unsupported view', {
				hasContext: Boolean(context),
				view
			});
			return;
		}
		const endpoint = COMMITMENT_ENDPOINTS[viewKey];
		if (!endpoint) {
			debugProcore('Skipping requestVendorCompany: no endpoint mapped for view', { viewKey });
			return;
		}
		applyProcoreViewMode(viewKey);
		if (!context?.id || !context?.project_id || !context?.company_id) {
			debugProcore('Skipping requestVendorCompany: incomplete context ids', {
				id: context?.id,
				project_id: context?.project_id,
				company_id: context?.company_id
			});
			return;
		}

		if (viewKey === 'commitments.purchase_order_contracts.edit' && !vendorName.trim()) {
			lastVendorLookupKey = null;
		}
		if (viewKey === 'commitments.work_order_contracts.edit' && !shipToName.trim()) {
			lastVendorLookupKey = null;
		}

		const requestKey = `${viewKey}:${context.id}:${context.project_id}:${context.company_id}`;
		if (vendorLookupInFlight || lastVendorLookupKey === requestKey) {
			debugProcore('Skipping requestVendorCompany: duplicate or in-flight request', {
				vendorLookupInFlight,
				lastVendorLookupKey,
				requestKey
			});
			return;
		}
		vendorLookupInFlight = true;
		lastVendorLookupKey = requestKey;
		debugProcore('Starting requestVendorCompany', {
			view: viewKey,
			id: context.id,
			project_id: context.project_id,
			company_id: context.company_id
		});

		try {
			const url = new URL(PROCORE_PROXY_ENDPOINT, window.location.origin);
			url.searchParams.set('view', viewKey);
			url.searchParams.set('id', asString(context.id));
			url.searchParams.set('project_id', asString(context.project_id));
			url.searchParams.set('company_id', asString(context.company_id));
			if (authHandle) {
				url.searchParams.set('auth_handle', authHandle);
			}
			debugProcore('Calling Procore proxy endpoint', { url: url.toString() });
			const response = await fetch(url.toString(), {
				method: 'GET',
				credentials: 'include',
				headers: {
					Accept: 'application/json'
				}
			});
			const isJson = response.headers.get('content-type')?.includes('application/json');
			const payload = isJson ? await response.json() : await response.text();
			debugProcore('Procore proxy response received', {
				status: response.status,
				ok: response.ok,
				contentType: response.headers.get('content-type') ?? null
			});
			if (!response.ok) {
				console.warn('Procore vendor lookup failed', { status: response.status, payload });
				if (response.status === 401) {
					authConnected = false;
					authInvalid = true;
				}
				lastVendorLookupKey = null;
				throw new Error(`Procore API request failed with status ${response.status}`);
			}
			applyProcorePayloadToSearchState(payload);
		} catch (err) {
			console.warn('Unable to fetch vendor company from Procore', err);
			lastVendorLookupKey = null;
		} finally {
			vendorLookupInFlight = false;
		}
	};

	/** @param {MessageEvent} event */
	const handleMessage = (event) => {
		const eventType =
			event.data && typeof event.data === 'object' && 'type' in event.data
				? /** @type {{ type?: unknown }} */ (event.data).type
				: null;
		debugProcore('message event received', {
			origin: event.origin,
			type: eventType,
			hasContext: hasRequiredProcoreContext(event.data),
			view: extractView(event.data)
		});

		if (!PROCORE_ALLOWED_ORIGINS.has(event.origin)) {
			console.warn('Blocked message from unexpected origin', event.origin);
			return; // guard against unexpected sources
		}

		const incomingView = extractView(event.data);
		if (typeof incomingView === 'string' && DETAIL_VIEWS.has(incomingView)) {
			clearSearchStateForDetailView();
			return;
		}
		if (event.data && typeof event.data === 'object' && 'type' in event.data) {
			const type = /** @type {{ type?: unknown }} */ (event.data).type;
			if (type === 'sidepanel:app:visible') {
				debugProcore('Received sidepanel visibility event');
				requestParentContext();
			}
			if (type === 'context') {
				debugProcore('Received context event');
				hasContext = true;
				if (contextPoller !== null) {
					clearInterval(contextPoller);
					contextPoller = null;
				}
			}
			if (type === 'vendor_app.parent_url') return;
		}

		if (!hasRequiredProcoreContext(event.data)) {
			debugProcore('Message ignored: missing required context identifiers');
			return;
		}

		debugProcore('Message accepted: requesting vendor company from Procore');
		requestVendorCompany(event.data);
	};

	const attachEarlyListener = () => {
		if (listenerAttached || typeof window === 'undefined') return;
		window.addEventListener('message', handleMessage);
		listenerAttached = true;
	};

	const sendReadySignal = () => {
		if (readySignaled || typeof window === 'undefined' || !window.parent) return;
		window.parent.postMessage(buildVendorAppMessage('vendor_app.ready'), '*');
		readySignaled = true;
	};

	const requestParentContext = () => {
		if (typeof window === 'undefined' || !window.parent) return;
		const now = Date.now();
		if (now - lastContextRequest < 250) return;
		window.parent.postMessage(buildVendorAppMessage('vendor_app.request_context'), '*');
		lastContextRequest = now;
	};

	const requestParentUrl = () => {
		if (requestedParentUrl || typeof window === 'undefined' || !window.parent) return;
		window.parent.postMessage(buildVendorAppMessage('vendor_app.request_parent_url'), '*');
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
		if (vendorSearchTimer !== null) {
			clearTimeout(vendorSearchTimer);
			vendorSearchTimer = null;
		}
		if (vendorSearchAbortController) {
			vendorSearchAbortController.abort();
			vendorSearchAbortController = null;
		}
	});

	/** @param {string} query */
	const fetchVendorSuggestions = async (query) => {
		const trimmedQuery = query.trim();
		if (!hasVendorSearchSeed(trimmedQuery)) {
			vendorSuggestions = [];
			showVendorSuggestions = false;
			vendorActiveSuggestionIndex = -1;
			return;
		}
		if (vendorSearchAbortController) {
			vendorSearchAbortController.abort();
		}
		vendorSearchAbortController = new AbortController();
		vendorSearchInFlight = true;
		showVendorSuggestions = true;
		try {
			const requestUrl = new URL('/api/vendor-sites/search', window.location.origin);
			requestUrl.searchParams.set('q', trimmedQuery);
			requestUrl.searchParams.set('limit', String(VENDOR_SUGGESTION_LIMIT));
			const response = await fetch(requestUrl.toString(), {
				signal: vendorSearchAbortController.signal
			});
			if (!response.ok) throw new Error(`Failed to search vendors (${response.status})`);
			const payload = await response.json();
			vendorSuggestions = Array.isArray(payload?.suggestions) ? payload.suggestions : [];
			const exactMatch = payload?.exactMatch;
			if (exactMatch?.name) {
				selectVendorSuggestion(exactMatch, true);
				return;
			}
			vendorActiveSuggestionIndex = vendorSuggestions.length > 0 ? 0 : -1;
			if (vendorName.trim() === trimmedQuery && !String(selectedVendorId ?? '').trim()) {
				vendorLookupCompleted = true;
			}
		} catch (err) {
			if (!(err instanceof DOMException && err.name === 'AbortError')) {
				console.warn('Unable to search vendors', err);
				vendorSuggestions = [];
				vendorActiveSuggestionIndex = -1;
			}
		} finally {
			vendorSearchInFlight = false;
			vendorSearchAbortController = null;
		}
	};

	const queueVendorSuggestions = () => {
		if (vendorSearchTimer !== null) {
			clearTimeout(vendorSearchTimer);
		}
		const query = vendorName.trim();
		if (!hasVendorSearchSeed(query)) {
			vendorSuggestions = [];
			showVendorSuggestions = false;
			vendorActiveSuggestionIndex = -1;
			return;
		}
		showVendorSuggestions = true;
		vendorSearchTimer = window.setTimeout(() => {
			vendorSearchTimer = null;
			void fetchVendorSuggestions(query);
		}, VENDOR_SEARCH_DEBOUNCE_MS);
	};

	/** @param {VendorSuggestion} suggestion
	 * @param {boolean} autoSelect
	 */
	const selectVendorSuggestion = (suggestion, autoSelect = false) => {
		selectedVendorId = suggestion.id;
		selectedVendorName = suggestion.name;
		vendorName = suggestion.name;
		vendorStatusExpanded = false;
		showVendorSuggestions = false;
		vendorSuggestions = [];
		vendorActiveSuggestionIndex = -1;
		userSearchedVendor = true;
		selectedSiteId = null;
		void loadSites('vendor', !autoSelect);
	};

	$: supplierActionState = buildSupplierActionState({
		selectedVendorId,
		selectedVendorName,
		vendorSites,
		vendorName,
		vendorLookupCompleted
	});

	const submitVendorSearch = async () => {
		const query = vendorName.trim();
		if (!query) {
			refreshSearch();
			return;
		}

		if (selectedVendorId) {
			await loadSites('vendor');
			return;
		}

		await fetchVendorSuggestions(query);
		if (selectedVendorId) return;

		vendorSites = [];
		typeOptions = [];
		selectedSiteId = null;
		showVendorSuggestions = vendorSuggestions.length > 0;
		vendorLookupCompleted = true;
	};

	/** @param {KeyboardEvent} event */
	const handleVendorInputKeydown = (event) => {
		if (event.key === 'Escape') {
			showVendorSuggestions = false;
			vendorActiveSuggestionIndex = -1;
			return;
		}
		if (event.key === 'ArrowDown') {
			if (!showVendorSuggestions && vendorSuggestions.length > 0) {
				showVendorSuggestions = true;
			}
			if (vendorSuggestions.length === 0) return;
			event.preventDefault();
			vendorActiveSuggestionIndex =
				vendorActiveSuggestionIndex < 0
					? 0
					: (vendorActiveSuggestionIndex + 1) % vendorSuggestions.length;
			return;
		}
		if (event.key === 'ArrowUp') {
			if (vendorSuggestions.length === 0) return;
			event.preventDefault();
			if (!showVendorSuggestions) {
				showVendorSuggestions = true;
			}
			vendorActiveSuggestionIndex =
				vendorActiveSuggestionIndex <= 0
					? vendorSuggestions.length - 1
					: vendorActiveSuggestionIndex - 1;
			return;
		}
		if (event.key === 'Enter') {
			event.preventDefault();
			void submitVendorSearch();
		}
	};

	/** @param {Event} event */
	const handleVendorInput = (event) => {
		const target = /** @type {HTMLInputElement | null} */ (event.currentTarget);
		const nextValue = target?.value ?? '';
		if (vendorSearchAbortController) {
			vendorSearchAbortController.abort();
			vendorSearchAbortController = null;
		}
		vendorName = nextValue;
		userSearchedVendor = true;
		selectedVendorId = null;
		selectedVendorName = null;
		selectedSiteId = null;
		vendorStatusExpanded = false;
		vendorSites = [];
		vendorLookupCompleted = false;
		vendorActiveSuggestionIndex = -1;
		queueVendorSuggestions();
	};

	const refreshSearch = () => {
		if (vendorSearchTimer !== null) {
			clearTimeout(vendorSearchTimer);
			vendorSearchTimer = null;
		}
		if (vendorSearchAbortController) {
			vendorSearchAbortController.abort();
			vendorSearchAbortController = null;
		}
		vendorName = '';
		selectedVendorId = null;
		selectedVendorName = null;
		vendorSites = [];
		vendorSuggestions = [];
		showVendorSuggestions = false;
		vendorActiveSuggestionIndex = -1;
		userSearchedVendor = false;
		vendorStatusExpanded = false;
		vendorLookupCompleted = false;
	};

	const refreshShipToSearch = () => {
		shipToName = '';
		userSearchedShipTo = false;
	};

	/** @param {KeyboardEvent} event */
	const handleShipToInputKeydown = (event) => {
		if (event.key === 'Enter') {
			event.preventDefault();
			void loadSites('shipTo');
		}
	};

	const clearSearchStateForDetailView = () => {
		refreshSearch();
		refreshShipToSearch();
		selectedSiteId = null;
		selectedShipToId = null;
		vendorSites = [];
		shipToSites = [];
		filteredVendorSites = [];
		filteredShipToSites = [];
		groupedVendorSites = [];
		groupedShipToSites = [];
		selectedTypes = [];
		typeOptions = [];
	};

	const toggleTypeFilter = () => {
		showTypeFilter = !showTypeFilter;
		if (showTypeFilter) {
			showHelpCard = false;
		}
	};

	const toggleVendorStatusExpanded = () => {
		vendorStatusExpanded = !vendorStatusExpanded;
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
		filteredVendorSites = selectedTypes.length
			? vendorSites.filter((site) =>
					parseTypes(getSitePurpose(site)).some((value) => selectedTypes.includes(value))
			  )
			: vendorSites;
	}

	$: {
		const query = shipToName.trim().toLowerCase();
		const nameFiltered = query
			? shipToSites.filter((site) =>
					`${site.id} ${site.name}`.toLowerCase().includes(query)
			  )
			: [];
		filteredShipToSites = nameFiltered;
	}

	$: groupedVendorSites = groupSites(filteredVendorSites);
	$: groupedShipToSites = groupSites(filteredShipToSites);
	$: {
		const sitesForTab = activeTab === 'vendor' ? vendorSites : shipToSites;
		const derivedTypes = deriveTypeOptions(sitesForTab);
		resolvedTypeOptions = typeOptions.length ? typeOptions : derivedTypes;
	}

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

	$: {
		const query = vendorName.trim();
		if (!query || activeTab !== 'vendor') {
			vendorStatusSummary = null;
		} else {
			vendorStatusSummary = buildVendorStatusSummary(vendorSites);
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

	/**
	 * @param {{ id?: string, name?: string, address?: string, address_line_1?: string, address_line_2?: string, address_line_3?: string, city?: string, state?: string, zip?: string }} site
	 * @param {'vendor' | 'shipTo'} tab
	 */
	const formatClipboardAddressBlock = (site, tab) => {
		const addressBlock = formatAddressBlockFromParts(site);
		if (tab !== 'vendor') return addressBlock;

		const supplierName = String(site.name ?? '').trim();
		const supplierNumber = String(site.id ?? '').trim();
		const supplierLabel =
			supplierName && supplierNumber ? `${supplierName}[${supplierNumber}]` : '';

		return [supplierLabel, addressBlock].filter(Boolean).join('\n');
	};

	/** @param {Site} site */
	const copyAddress = (site) => {
		if (typeof window === 'undefined' || !navigator?.clipboard?.writeText) return;
		const text = formatClipboardAddressBlock(site, activeTab);
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
		const text = formatClipboardAddressBlock(site, activeTab);
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
	 * @param {'vendor' | 'shipTo' | null} targetTab
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
	 * @param {'vendor' | 'shipTo' | null} targetTab
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
		const target = /** @type {Node | null} */ (event.target);
		if (showTypeFilter && !(filterWrap && target && filterWrap.contains(target))) {
			showTypeFilter = false;
		}
		if (
			showHelpCard &&
			!(
				(helpButtonWrap && target && helpButtonWrap.contains(target)) ||
				(helpCardWrap && target && helpCardWrap.contains(target))
			)
		) {
			showHelpCard = false;
		}
		if (showVendorSuggestions && !(vendorAutocompleteWrap && target && vendorAutocompleteWrap.contains(target))) {
			showVendorSuggestions = false;
			vendorActiveSuggestionIndex = -1;
		}
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
				<svg class="tab__icon" xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">
					<path fill="currentColor" fill-rule="evenodd" d="M6 16a2.5 2.5 0 0 1 2.5-2.5h40a2.5 2.5 0 0 1 0 5h-3v12h24A1.5 1.5 0 0 1 71 32v29.5h.5a2.5 2.5 0 0 1 0 5h-37V58a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8.5h-14a2.5 2.5 0 0 1 0-5h3v-43h-3A2.5 2.5 0 0 1 6 16m13.5 4.5a2.5 2.5 0 0 0 0 5h2a2.5 2.5 0 0 0 0-5zM25 23a2.5 2.5 0 0 1 2.5-2.5h2a2.5 2.5 0 0 1 0 5h-2A2.5 2.5 0 0 1 25 23m10.5-2.5a2.5 2.5 0 0 0 0 5h2a2.5 2.5 0 0 0 0-5zM17 31a2.5 2.5 0 0 1 2.5-2.5h2a2.5 2.5 0 0 1 0 5h-2A2.5 2.5 0 0 1 17 31m10.5-2.5a2.5 2.5 0 0 0 0 5h2a2.5 2.5 0 0 0 0-5zM33 31a2.5 2.5 0 0 1 2.5-2.5h2a2.5 2.5 0 0 1 0 5h-2A2.5 2.5 0 0 1 33 31m-13.5 5.5a2.5 2.5 0 0 0 0 5h2a2.5 2.5 0 0 0 0-5zM25 39a2.5 2.5 0 0 1 2.5-2.5h2a2.5 2.5 0 0 1 0 5h-2A2.5 2.5 0 0 1 25 39m10.5-2.5a2.5 2.5 0 0 0 0 5h2a2.5 2.5 0 0 0 0-5zM17 47a2.5 2.5 0 0 1 2.5-2.5h2a2.5 2.5 0 0 1 0 5h-2A2.5 2.5 0 0 1 17 47m10.5-2.5a2.5 2.5 0 0 0 0 5h2a2.5 2.5 0 0 0 0-5zM33 47a2.5 2.5 0 0 1 2.5-2.5h2a2.5 2.5 0 0 1 0 5h-2A2.5 2.5 0 0 1 33 47m31-8a2.5 2.5 0 0 0-5 0v2a2.5 2.5 0 0 0 5 0zm-2.5 5.5A2.5 2.5 0 0 1 64 47v2a2.5 2.5 0 0 1-5 0v-2a2.5 2.5 0 0 1 2.5-2.5M64 55a2.5 2.5 0 0 0-5 0v2a2.5 2.5 0 0 0 5 0zM53.5 36.5A2.5 2.5 0 0 1 56 39v2a2.5 2.5 0 0 1-5 0v-2a2.5 2.5 0 0 1 2.5-2.5M56 47a2.5 2.5 0 0 0-5 0v2a2.5 2.5 0 0 0 5 0zm-2.5 5.5A2.5 2.5 0 0 1 56 55v2a2.5 2.5 0 0 1-5 0v-2a2.5 2.5 0 0 1 2.5-2.5" clip-rule="evenodd" />
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
								Click to authorize
							{/if}
						</button>
						<div class="search__actions">
							<div class="search__filter-wrap" bind:this={filterWrap}>
								<button class="search__filter" aria-label="Filter by type" on:click|stopPropagation={toggleTypeFilter}>
									<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
										<path d="M3 4h18l-7 8v6l-4 2v-8z" />
									</svg>
								</button>
								{#if showTypeFilter}
									<div class="search__filter-panel" role="listbox" aria-label="Filter by type">
										{#if resolvedTypeOptions.length === 0}
											<div class="search__suggestion--empty">No type options available</div>
										{:else}
											{#each resolvedTypeOptions as type}
												<label class="filter-option">
													<input
														type="checkbox"
														checked={selectedTypes.includes(type)}
														on:change={() => toggleTypeSelection(type)}
													/>
													<span class="filter-option__dot" aria-hidden="true"></span>
													<span>{typeFilterLabel(type)}</span>
												</label>
											{/each}
										{/if}
									</div>
								{/if}
							</div>
							<div class="search__help-wrap" bind:this={helpButtonWrap}>
								<button
									class="search__help"
									type="button"
									aria-label="Open help topics"
									aria-expanded={showHelpCard}
									on:click={toggleHelpCard}
								>
									?
								</button>
							</div>
						</div>
					</div>
					{#if showHelpCard}
						<div class="help-inline" role="region" aria-label="Quick Help Topics" bind:this={helpCardWrap}>
							<div class="help">
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
												<span
													class="help__chevron"
													class:help__chevron--collapsed={openHelpTopicId !== topic.id}
													aria-hidden="true"
												>
													<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" focusable="false">
														<path fill-rule="evenodd" clip-rule="evenodd" d="M12 7L19 14.1611L17.2024 16L12 10.6779L6.79759 16L5 14.1611L12 7Z" fill="currentColor"></path>
													</svg>
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
						</div>
					{:else}
						<div class="search__autocomplete" bind:this={vendorAutocompleteWrap}>
							<div class="search__input">
								<input
									type="text"
									bind:value={vendorName}
									placeholder="enter Supplier Name"
									aria-label="Supplier Name"
									autocomplete="off"
									on:input={handleVendorInput}
									on:focus={() => {
										if (vendorSuggestions.length > 0) {
											showVendorSuggestions = true;
											if (vendorActiveSuggestionIndex < 0) {
												vendorActiveSuggestionIndex = 0;
											}
										}
									}}
									on:keydown={handleVendorInputKeydown}
								/>
								{#if vendorName.trim().length}
									<button class="search__refresh" aria-label="Clear" on:click={refreshSearch}>
										<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
											<line x1="6" y1="6" x2="18" y2="18" />
											<line x1="6" y1="18" x2="18" y2="6" />
										</svg>
									</button>
								{/if}
								<button class="search__submit" aria-label="Search" on:click={() => void submitVendorSearch()}>
									<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
										<circle cx="11" cy="11" r="7" />
										<path d="M21 21l-4.35-4.35" />
									</svg>
								</button>
							</div>
							{#if supplierActionState.showSupplierActionLink}
								<a
									class="search__external-link search__external-link--prominent"
									href={supplierActionState.supplierActionUrl}
									target="_blank"
									rel="noopener noreferrer"
								>
									<span>{supplierActionState.supplierActionLabel}</span>
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
										<path d="M7 17L17 7"></path>
										<path d="M9 7h8v8"></path>
									</svg>
								</a>
							{/if}
							{#if showVendorSuggestions}
								<ul class="search__suggestions" role="listbox" aria-label="Vendor suggestions">
									{#if vendorSuggestions.length === 0}
										<li class="search__suggestion search__suggestion--empty">
											{vendorSearchInFlight ? 'Searching vendors...' : 'No vendor matches'}
										</li>
									{:else}
										{#each vendorSuggestions as suggestion, index}
											<li
												class="search__suggestion"
												class:search__suggestion--active={index === vendorActiveSuggestionIndex}
												role="option"
												aria-selected={index === vendorActiveSuggestionIndex || selectedVendorId === suggestion.id}
											>
												<button
													type="button"
													on:mouseenter={() => (vendorActiveSuggestionIndex = index)}
													on:focus={() => (vendorActiveSuggestionIndex = index)}
													on:click={() => selectVendorSuggestion(suggestion)}
												>
													<span class="search__suggestion-name">{suggestion.name}</span>
													<span class="search__suggestion-meta">
														{suggestion.id}
														{#if suggestion.city || suggestion.state}
															- {suggestion.city}{suggestion.city && suggestion.state ? ', ' : ''}{suggestion.state}
														{/if}
													</span>
												</button>
											</li>
										{/each}
									{/if}
								</ul>
							{/if}
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
						{#if vendorName.trim().length > 0 && vendorStatusSummary}
							<div class="vendor-status-card">
								<button
									type="button"
									class="vendor-status-card__header"
									aria-expanded={vendorStatusExpanded}
									on:click={toggleVendorStatusExpanded}
								>
									<span class="vendor-status-card__title">
										<span
											class={`vendor-status-card__dot vendor-status-card__dot--${vendorStatusSummary.tone}`}
											aria-hidden="true"
										></span>
										<span>{vendorStatusSummary.status}</span>
									</span>
									<span class="vendor-status-card__label_details">Supplier Status Details</span>
									<span
										class="vendor-status-card__chevron"
										class:vendor-status-card__chevron--collapsed={!vendorStatusExpanded}
										aria-hidden="true"
									>
										<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" focusable="false">
											<path fill-rule="evenodd" clip-rule="evenodd" d="M12 7L19 14.1611L17.2024 16L12 10.6779L6.79759 16L5 14.1611L12 7Z" fill="currentColor"></path>
										</svg>
									</span>
								</button>
								{#if vendorStatusExpanded}
									<div class="vendor-status-card__body">
										{#if vendorStatusSummary.details}
											<div class="vendor-status-card__details">{vendorStatusSummary.details}</div>
										{:else}
											<div class="vendor-status-card__details vendor-status-card__details--empty">No additional details</div>
										{/if}
									</div>
								{/if}
							</div>
						{/if}
					{/if}
				</div>

			{#if !showHelpCard}
			<div class="list" role="list">
				{#if groupedVendorSites.length === 0}
					{#if sitesLoading}
						<div class="list__empty">Loading locations…</div>
					{:else if vendorLookupCompleted}
						<div class="list__empty">No results found</div>
					{:else}
						<div class="list__empty"></div>
					{/if}
				{:else}
					{#each groupedVendorSites as site}
						<section
							class="card"
							class:card--do-not-use={vendorStatusSummary?.tone === 'red'}
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
									{#if ['purchasing', 'payment', 'request_for_quote'].includes(typeIconKey(type))}
										<span
											class="card__chip"
											title={typeIconKey(type) === 'purchasing' ? 'Legal Address' : typeIconKey(type) === 'payment' ? 'Remit To' : type}
											aria-label={typeIconKey(type) === 'purchasing' ? 'Legal Address' : typeIconKey(type) === 'payment' ? 'Remit To' : type}
										>
											{#if typeIconKey(type) === 'purchasing'}
												<svg class="card__chip-icon card__chip-icon--purchasing" xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">
													<path fill="currentColor" fill-rule="evenodd" d="M6 16a2.5 2.5 0 0 1 2.5-2.5h40a2.5 2.5 0 0 1 0 5h-3v12h24A1.5 1.5 0 0 1 71 32v29.5h.5a2.5 2.5 0 0 1 0 5h-37V58a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8.5h-14a2.5 2.5 0 0 1 0-5h3v-43h-3A2.5 2.5 0 0 1 6 16m13.5 4.5a2.5 2.5 0 0 0 0 5h2a2.5 2.5 0 0 0 0-5zM25 23a2.5 2.5 0 0 1 2.5-2.5h2a2.5 2.5 0 0 1 0 5h-2A2.5 2.5 0 0 1 25 23m10.5-2.5a2.5 2.5 0 0 0 0 5h2a2.5 2.5 0 0 0 0-5zM17 31a2.5 2.5 0 0 1 2.5-2.5h2a2.5 2.5 0 0 1 0 5h-2A2.5 2.5 0 0 1 17 31m10.5-2.5a2.5 2.5 0 0 0 0 5h2a2.5 2.5 0 0 0 0-5zM33 31a2.5 2.5 0 0 1 2.5-2.5h2a2.5 2.5 0 0 1 0 5h-2A2.5 2.5 0 0 1 33 31m-13.5 5.5a2.5 2.5 0 0 0 0 5h2a2.5 2.5 0 0 0 0-5zM25 39a2.5 2.5 0 0 1 2.5-2.5h2a2.5 2.5 0 0 1 0 5h-2A2.5 2.5 0 0 1 25 39m10.5-2.5a2.5 2.5 0 0 0 0 5h2a2.5 2.5 0 0 0 0-5zM17 47a2.5 2.5 0 0 1 2.5-2.5h2a2.5 2.5 0 0 1 0 5h-2A2.5 2.5 0 0 1 17 47m10.5-2.5a2.5 2.5 0 0 0 0 5h2a2.5 2.5 0 0 0 0-5zM33 47a2.5 2.5 0 0 1 2.5-2.5h2a2.5 2.5 0 0 1 0 5h-2A2.5 2.5 0 0 1 33 47m31-8a2.5 2.5 0 0 0-5 0v2a2.5 2.5 0 0 0 5 0zm-2.5 5.5A2.5 2.5 0 0 1 64 47v2a2.5 2.5 0 0 1-5 0v-2a2.5 2.5 0 0 1 2.5-2.5M64 55a2.5 2.5 0 0 0-5 0v2a2.5 2.5 0 0 0 5 0zM53.5 36.5A2.5 2.5 0 0 1 56 39v2a2.5 2.5 0 0 1-5 0v-2a2.5 2.5 0 0 1 2.5-2.5M56 47a2.5 2.5 0 0 0-5 0v2a2.5 2.5 0 0 0 5 0zm-2.5 5.5A2.5 2.5 0 0 1 56 55v2a2.5 2.5 0 0 1-5 0v-2a2.5 2.5 0 0 1 2.5-2.5" clip-rule="evenodd" />
												</svg>
											{:else if typeIconKey(type) === 'payment'}
												<svg class="card__chip-icon card__chip-icon--payment" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">
													<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2">
														<circle cx="12" cy="12" r="10" />
														<path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8m4 2V6" />
													</g>
												</svg>
											{:else if typeIconKey(type) === 'request_for_quote'}
												<svg class="card__chip-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" aria-hidden="true">
													<path fill="currentColor" d="M2.5 1.75v11.5c0 .138.112.25.25.25h3.17a.75.75 0 0 1 0 1.5H2.75A1.75 1.75 0 0 1 1 13.25V1.75C1 .784 1.784 0 2.75 0h8.5C12.216 0 13 .784 13 1.75v7.736a.75.75 0 0 1-1.5 0V1.75a.25.25 0 0 0-.25-.25h-8.5a.25.25 0 0 0-.25.25m13.274 9.537l-4.557 4.45a.75.75 0 0 1-1.055-.008l-1.943-1.95a.75.75 0 0 1 1.062-1.058l1.419 1.425l4.026-3.932a.75.75 0 1 1 1.048 1.074M4.75 4h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5M4 7.75A.75.75 0 0 1 4.75 7h2a.75.75 0 0 1 0 1.5h-2A.75.75 0 0 1 4 7.75" />
												</svg>
											{/if}
										</span>
									{/if}
								{/each}
							</div>
							<div class="card__content">
								<div class="card__text">
									{#each getAddressLines(site) as addressLine}
										<div class="card__address">{addressLine}</div>
									{/each}
									{#if formatCityStateZip(site)}
										<div class="card__address">{formatCityStateZip(site)}</div>
									{/if}
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
			{/if}
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
						<div class="search__actions">
							<div class="search__help-wrap" bind:this={helpButtonWrap}>
								<button
									class="search__help"
									type="button"
									aria-label="Open help topics"
									aria-expanded={showHelpCard}
									on:click={toggleHelpCard}
								>
									?
								</button>
							</div>
						</div>
					</div>
					{#if showHelpCard}
						<div class="help-inline" role="region" aria-label="Quick Help Topics" bind:this={helpCardWrap}>
							<div class="help">
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
						</div>
					{:else}
						<div class="search__input">
							<input
								type="text"
								bind:value={shipToName}
								placeholder="Enter Project Name or Number"
								aria-label="Project Name or Number"
								on:keydown={handleShipToInputKeydown}
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
					{/if}
				</div>

			{#if !showHelpCard}
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
									{#if ['purchasing', 'payment', 'request_for_quote'].includes(typeIconKey(type))}
										<span
											class="card__chip"
											title={typeIconKey(type) === 'purchasing' ? 'Legal Address' : typeIconKey(type) === 'payment' ? 'Remit To' : type}
											aria-label={typeIconKey(type) === 'purchasing' ? 'Legal Address' : typeIconKey(type) === 'payment' ? 'Remit To' : type}
										>
											{#if typeIconKey(type) === 'purchasing'}
												<svg class="card__chip-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">
													<path fill="currentColor" d="M4 22h16v-2h-1V4H5v16H4zm3-4h2v2H7zm0-4h2v2H7zm0-4h2v2H7zm4 8h2v2h-2zm0-4h2v2h-2zm0-4h2v2h-2zm4 8h2v2h-2zm0-4h2v2h-2zm0-4h2v2h-2z" />
												</svg>
											{:else if typeIconKey(type) === 'payment'}
												<svg class="card__chip-icon card__chip-icon--payment" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">
													<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2">
														<circle cx="12" cy="12" r="10" />
														<path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8m4 2V6" />
													</g>
												</svg>
											{:else if typeIconKey(type) === 'request_for_quote'}
												<svg class="card__chip-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" aria-hidden="true">
													<path fill="currentColor" d="M2.5 1.75v11.5c0 .138.112.25.25.25h3.17a.75.75 0 0 1 0 1.5H2.75A1.75 1.75 0 0 1 1 13.25V1.75C1 .784 1.784 0 2.75 0h8.5C12.216 0 13 .784 13 1.75v7.736a.75.75 0 0 1-1.5 0V1.75a.25.25 0 0 0-.25-.25h-8.5a.25.25 0 0 0-.25.25m13.274 9.537l-4.557 4.45a.75.75 0 0 1-1.055-.008l-1.943-1.95a.75.75 0 0 1 1.062-1.058l1.419 1.425l4.026-3.932a.75.75 0 1 1 1.048 1.074M4.75 4h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5M4 7.75A.75.75 0 0 1 4.75 7h2a.75.75 0 0 1 0 1.5h-2A.75.75 0 0 1 4 7.75" />
												</svg>
											{/if}
										</span>
									{/if}
								{/each}
							</div>
							<div class="card__content">
								<div class="card__text">
									{#each getAddressLines(site) as addressLine}
										<div class="card__address">{addressLine}</div>
									{/each}
									{#if formatCityStateZip(site)}
										<div class="card__address">{formatCityStateZip(site)}</div>
									{/if}
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
			{/if}
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
