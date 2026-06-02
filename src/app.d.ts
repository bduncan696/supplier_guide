// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

declare module 'https://cdn.skypack.dev/@flexbase-eng/procore-iframe-helpers' {
	interface ProcoreIframeContext {
		authentication?: {
			authenticate?: (options: {
				url: string;
				onSuccess: (payload: unknown) => void;
				onFailure: (error: unknown) => void;
			}) => void;
		};
	}

	interface ProcoreIframeHelpers {
		initialize?: () => ProcoreIframeContext | null;
	}

	const helpers: ProcoreIframeHelpers;
	export default helpers;
}

export {};
