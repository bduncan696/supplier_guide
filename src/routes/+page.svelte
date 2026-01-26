<script>
	import { onDestroy, onMount } from 'svelte';
	import './+page.css';

	const POP_MESSAGE_KEY = 'procore-popout-message';

	const allowedOrigins = new Set([
		'http://api.procore.com',
		'https://api.procore.com',
		'https://app.procore.com'
	]);

	/** @typedef {{ type: string, id: string, name: string, address: string, city: string, state: string, zip: string }} Site */

	let latestMessage = '';
	let showPopout = false;
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
	let activeTab = 'vendor';
	let showTypeFilter = false;
	/** @type {string[]} */
	let selectedTypes = [];
	let toastMessage = '';
	/** @type {number | null} */
	let toastTimer = null;
	let readySignaled = false;
	let requestedParentUrl = false;
	let lastContextRequest = 0;
	/** @type {HTMLDivElement | null} */
	let filterWrap = null;
	/** @type {string | null} */
	let parentUrl = null;

	/** @type {Site[]} */
	const vendorSites = [
		{
			type: 'HQ',
			id: '527258',
			name: 'BMCDUS',
			address: '4423 North Main St.',
			city: 'New York',
			state: 'NY',
			zip: '11252'
		},
		{
			type: 'Billing',
			id: '2500336',
			name: 'BMCDUS',
			address: '1234 West Main St.',
			city: 'New York',
			state: 'NY',
			zip: '11251'
		},
		{
			type: 'Primary',
			id: '3437121',
			name: 'AZCO OU',
			address: '223 Main St.',
			city: 'Tuscon',
			state: 'AZ',
			zip: '88324'
		},
		{
			type: 'Shipping',
			id: '527000',
			name: 'BMCDUS2',
			address: '4423 North Main St.',
			city: 'New York',
			state: 'NY',
			zip: '11252'
		},
		{
			type: 'Billing',
			id: '2500000',
			name: 'BMCDUS3',
			address: '1234 West Main St.',
			city: 'New York',
			state: 'NY',
			zip: '11251'
		},
		{
			type: 'HQ',
			id: '3437000',
			name: 'AZCO OU4',
			address: '223 Main St.',
			city: 'Tuscon',
			state: 'AZ',
			zip: '88324'
		}
	];

	/** @type {Site[]} */
	const shipToSites = vendorSites;

	filteredVendorSites = vendorSites;
	filteredShipToSites = shipToSites;
	const typeOptions = Array.from(new Set(vendorSites.map((site) => site.type)));

	/** @param {unknown} payload */
	const formatMessage = (payload) => {
		if (typeof payload === 'string') return payload;
		try {
			return JSON.stringify(payload, null, 2);
		} catch (err) {
			return 'Unable to read message payload';
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

	/** @param {unknown} data */
	const formatContextDetails = (data) => {
		const context = extractContext(data);
		if (!context) return '';

		const lines = [
			`company_id: ${context.company_id ?? 'n/a'}`,
			`project_id: ${context.project_id ?? 'n/a'}`,
			`resource_id: ${context.id ?? 'n/a'}`
		];

		return lines.join('\n');
	};

	const getParentUrlLine = () => (parentUrl ? `parent_url: ${parentUrl}` : '');

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
	const describeProcoreEvent = (event) => {
		const { data, origin } = event;
		const parentUrlLine = getParentUrlLine();

		if (data && typeof data === 'object' && 'type' in data) {
			const type = /** @type {{ type?: unknown }} */ (data).type;
			const payload = /** @type {{ payload?: unknown }} */ (data).payload;
			const contextDetails = formatContextDetails(data);
			if (contextDetails) {
				return `Procore context\n${contextDetails}${parentUrlLine ? `\n${parentUrlLine}` : ''}`;
			}
			return `Procore event\n${formatMessage(payload ?? data)}${parentUrlLine ? `\n${parentUrlLine}` : ''}`;
		}

		const contextDetails = formatContextDetails(data);
		if (contextDetails) {
			return `Procore context\n${contextDetails}${parentUrlLine ? `\n${parentUrlLine}` : ''}`;
		}
		return `Procore message:\n${formatMessage(data)}\ncontext: not provided${parentUrlLine ? `\n${parentUrlLine}` : ''}`;
	};

	/** @param {string} message */
	const persistMessage = (message) => {
		latestMessage = message;
		showPopout = true;
		if (typeof sessionStorage !== 'undefined') {
			sessionStorage.setItem(POP_MESSAGE_KEY, message);
		}
	};

	/** @param {MessageEvent} event */
	const handleMessage = (event) => {
		if (!allowedOrigins.has(event.origin)) {
			console.warn('Blocked message from unexpected origin', event.origin);
			return; // guard against unexpected sources
		}

		if (event.data && typeof event.data === 'object' && 'type' in event.data) {
			const type = /** @type {{ type?: unknown }} */ (event.data).type;
			if (type === 'context') {
				hasContext = true;
				if (contextPoller !== null) {
					clearInterval(contextPoller);
					contextPoller = null;
				}
			}
			if (type === 'vendor_app.parent_url') {
				const payload = /** @type {{ payload?: { url?: string } }} */ (event.data).payload;
				parentUrl = payload?.url ?? null;
				if (parentUrl) {
					persistMessage(`Parent URL\n${parentUrl}`);
				}
				return;
			}
		}

		if (!hasRequiredContext(event.data)) {
			return;
		}

		persistMessage(describeProcoreEvent(event));
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
		const cached = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(POP_MESSAGE_KEY) : null;
		if (cached) {
			persistMessage(cached);
		}

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

	const closePopout = () => {
		showPopout = false;
		if (typeof sessionStorage !== 'undefined') {
			sessionStorage.removeItem(POP_MESSAGE_KEY);
		}
	};

	const refreshSearch = () => {
		vendorName = '';
	};

	const refreshShipToSearch = () => {
		shipToName = '';
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
			: vendorSites;
		filteredVendorSites = selectedTypes.length
			? nameFiltered.filter((site) => selectedTypes.includes(site.type))
			: nameFiltered;
		if (selectedSiteId && !filteredVendorSites.some((site) => site.id === selectedSiteId)) {
			selectedSiteId = null;
		}
	}

	$: {
		const query = shipToName.trim().toLowerCase();
		const nameFiltered = query
			? shipToSites.filter((site) =>
					`${site.id} ${site.name}`.toLowerCase().includes(query)
			  )
			: shipToSites;
		filteredShipToSites = selectedTypes.length
			? nameFiltered.filter((site) => selectedTypes.includes(site.type))
			: nameFiltered;
		if (selectedShipToId && !filteredShipToSites.some((site) => site.id === selectedShipToId)) {
			selectedShipToId = null;
		}
	}

	/** @param {string} id */
	const toggleSelected = (id) => {
		const isSelecting = selectedSiteId !== id;
		selectedSiteId = isSelecting ? id : null;
		if (isSelecting) {
			const site = vendorSites.find((entry) => entry.id === id);
			if (site) {
				copyAddress(site);
			}
		}
	};

	/** @param {string} id */
	const toggleShipToSelected = (id) => {
		const isSelecting = selectedShipToId !== id;
		selectedShipToId = isSelecting ? id : null;
		if (isSelecting) {
			const site = shipToSites.find((entry) => entry.id === id);
			if (site) {
				copyAddress(site);
			}
		}
	};

	/** @param {Site} site */
	const formatAddressBlock = (site) =>
		`${site.id} - ${site.name}\n${site.address}\n${site.city}, ${site.state} ${site.zip}`;

	/** @param {Site} site */
	const copyAddress = (site) => {
		if (typeof window === 'undefined' || !navigator?.clipboard?.writeText) return;
		const text = formatAddressBlock(site);
		navigator.clipboard
			.writeText(text)
			.then(() => showToast('Copied address block'))
			.catch((err) => {
				if (!fallbackCopy(text)) {
					console.warn('Unable to copy address block', err);
					showToast('Copy blocked. Select and press Ctrl/Cmd+C');
				}
			});
	};

	/** @param {string} text */
	const fallbackCopy = (text) => {
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
				showToast('Copied address block');
			}
			return ok;
		} catch {
			return false;
		}
	};

	/** @param {string} message */
	const showToast = (message) => {
		toastMessage = message;
		if (toastTimer !== null) {
			clearTimeout(toastTimer);
		}
		toastTimer = window.setTimeout(() => {
			toastMessage = '';
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
		if (typeof window === 'undefined') return;
		window.addEventListener('click', handleDocumentClick);
		return () => {
			window.removeEventListener('click', handleDocumentClick);
		};
	});
</script>

<main class="page">
	<div class="toast" class:toast--show={toastMessage} aria-live="polite">
		{toastMessage}
	</div>
	<section class="panel">
		<header class="panel__header">
			<div class="panel__title">Commitment Details</div>
			<div class="tabs" role="tablist" aria-label="Location panels">
				<button
					class="tab"
					class:tab--active={activeTab === 'vendor'}
					role="tab"
					type="button"
					aria-selected={activeTab === 'vendor'}
					on:click={() => (activeTab = 'vendor')}
				>
					Vendor Site ID
				</button>
				<button
					class="tab"
					class:tab--active={activeTab === 'shipTo'}
					role="tab"
					type="button"
					aria-selected={activeTab === 'shipTo'}
					on:click={() => (activeTab = 'shipTo')}
				>
					Ship To
				</button>
			</div>
		</header>

		{#if showPopout}
			<div class="message-card">
				<div class="message-card__header">
					<span>Procore message</span>
					<button class="message-card__close" aria-label="Dismiss" on:click={closePopout}>&times;</button>
				</div>
				<pre class="message-card__body">{latestMessage}</pre>
			</div>
		{/if}

		{#if activeTab === 'vendor'}
			<div class="search" role="tabpanel" aria-label="Vendor Site ID">
				<div class="search__input">
					<input
						type="text"
						bind:value={vendorName}
						placeholder="enter Vendor name or ID"
						aria-label="Vendor Name or ID"
					/>
					<button class="search__refresh" aria-label="Refresh" on:click={refreshSearch}>
						<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path d="M21 12a9 9 0 1 1-9-9" />
							<polyline points="21 3 21 9 15 9" />
						</svg>
					</button>
				</div>
				<div class="search__filter-row">
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
				{#each filteredVendorSites as site}
					<section
						class="card"
						class:selected={selectedSiteId === site.id}
						role="button"
						tabindex="0"
						on:click={() => toggleSelected(site.id)}
						on:keydown={(event) => {
							if (event.key === 'Enter' || event.key === ' ') {
								event.preventDefault();
								toggleSelected(site.id);
							}
						}}
						aria-pressed={selectedSiteId === site.id}
					>
						<div class="card__chip-row">
							<span class="card__chip">{site.type}</span>
						</div>
						<div class="card__content">
							<div class="card__text">
								<div class="card__title">{site.id} - {site.name}</div>
								<div class="card__address">{site.address}</div>
								<div class="card__address">{site.city}, {site.state} {site.zip}</div>
							</div>
						</div>
					</section>
				{/each}
			</div>
		{:else}
			<div class="search" role="tabpanel" aria-label="Ship To">
				<div class="search__input">
					<input
						type="text"
						bind:value={shipToName}
						placeholder="enter Ship To name or ID"
						aria-label="Ship To Name or ID"
					/>
					<button class="search__refresh" aria-label="Refresh" on:click={refreshShipToSearch}>
						<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path d="M21 12a9 9 0 1 1-9-9" />
							<polyline points="21 3 21 9 15 9" />
						</svg>
					</button>
				</div>
				<div class="search__filter-row">
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
				{#each filteredShipToSites as site}
					<section
						class="card"
						class:selected={selectedShipToId === site.id}
						role="button"
						tabindex="0"
						on:click={() => toggleShipToSelected(site.id)}
						on:keydown={(event) => {
							if (event.key === 'Enter' || event.key === ' ') {
								event.preventDefault();
								toggleShipToSelected(site.id);
							}
						}}
						aria-pressed={selectedShipToId === site.id}
					>
						<div class="card__chip-row">
							<span class="card__chip">{site.type}</span>
						</div>
						<div class="card__content">
							<div class="card__text">
								<div class="card__title">{site.id} - {site.name}</div>
								<div class="card__address">{site.address}</div>
								<div class="card__address">{site.city}, {site.state} {site.zip}</div>
							</div>
						</div>
					</section>
				{/each}
			</div>
		{/if}
	</section>
</main>
