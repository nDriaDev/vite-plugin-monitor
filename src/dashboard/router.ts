import { AppTab } from "@tracker/types";
import { store } from "./state";

const HASH_TO_TAB: Record<string, AppTab> = {
	'#/metrics': 'metrics',
	'#/events':  'events',
}

const TAB_TO_HASH: Record<AppTab, string> = {
	metrics: '#/metrics',
	events:  '#/events',
}

function resolveTab(): AppTab {
	return HASH_TO_TAB[window.location.hash] ?? 'metrics'
}

/**
* Minimal hash-based router.
*
* @remarks
* Routes:
*   #/metrics  -> Metrics tab (default)
*   #/events   -> Events tab
*
* The router is intentionally thin: it just syncs the URL hash
* with store.tab so the user can bookmark or share a direct link
* to a specific tab.
*/
export function initRouter(): void {
	store.setTab(resolveTab());

	window.addEventListener('hashchange', () => {
		const tab = resolveTab();
		if (tab !== store.get().tab) {
			store.setTab(tab);
		}
	});

	store.on('tab:change', (tab) => {
		const hash = TAB_TO_HASH[tab];
		if (window.location.hash !== hash) {
			history.replaceState(null, '', hash);
		}
	});
}

export function navigateTo(tab: AppTab): void {
	store.setTab(tab);
}
