import { el, qs, on, show, hide } from '../utils/dom';
import { store } from '../state';

const SESSION_KEY = '__tracker_auth__';

export function checkStoredAuth(): boolean {
	try {
		const stored = sessionStorage.getItem(SESSION_KEY);
		if (!stored) {
			return false;
		}
		const cfg = (window as any).__TRACKER_CONFIG__?.dashboard?.auth;
		if (!cfg) {
			return true;
		}
		const { username, password } = JSON.parse(stored);
		return username === cfg.username && password === cfg.password;
	} catch {
		return false;
	}
}

function saveAuth(username: string, password: string) {
	try {
		sessionStorage.setItem(SESSION_KEY, JSON.stringify({ username, password }));
	} catch { /* ignore */ }
}

export function clearAuth() {
	try {
		sessionStorage.removeItem(SESSION_KEY);
	} catch { /* ignore */ }
	store.setAuth(false);
}

/**
* Login screen: shown when the user is not authenticated.
*
* @remarks
* Credentials are compared against window.__TRACKER_CONFIG__.dashboard.auth
* (injected by the plugin). On success, saves a flag in sessionStorage so
* the user doesn't have to log in again after a page reload.
*/
export function createLoginScreen(): HTMLElement {
	const cfg = (window as any).__TRACKER_CONFIG__?.dashboard?.auth;

	if (!cfg) {
		store.setAuth(true);
		const placeholder = el('div');
		placeholder.hidden = true;
		return placeholder;
	}

	const screen = el('div', { class: 'login-screen' });

	screen.innerHTML = `
    <div class="login-card">
		<div class="login-logo">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<circle cx="12" cy="12" r="3"/>
				<circle cx="12" cy="12" r="8" stroke-dasharray="3 2"/>
				<line x1="12" y1="2" x2="12" y2="5"/>
				<line x1="12" y1="19" x2="12" y2="22"/>
				<line x1="2" y1="12" x2="5" y2="12"/>
				<line x1="19" y1="12" x2="22" y2="12"/>
			</svg>
			<span>Monitor Dashboard</span>
		</div>

		<div class="login-error" id="login-error" hidden></div>

		<div class="login-field">
			<label for="login-username">Username</label>
			<input id="login-username" type="text" autocomplete="username" spellcheck="false" />
		</div>

		<div class="login-field">
			<label for="login-password">Password</label>
			<input id="login-password" type="password" autocomplete="current-password" />
		</div>

		<button class="login-btn" id="login-submit">Sign in</button>
    </div>
`;

	const usernameInput = qs<HTMLInputElement>('#login-username', screen);
	const passwordInput = qs<HTMLInputElement>('#login-password', screen);
	const errorBox = qs<HTMLElement>('#login-error', screen);
	const submitBtn = qs<HTMLButtonElement>('#login-submit', screen);

	function attempt() {
		const username = usernameInput.value.trim();
		const password = passwordInput.value;

		if (!username || !password) {
			errorBox.textContent = 'Please enter username and password.';
			show(errorBox);
			return;
		}

		if (username === cfg.username && password === cfg.password) {
			saveAuth(username, password);
			hide(errorBox);
			store.setAuth(true);
		} else {
			errorBox.textContent = 'Invalid credentials.';
			show(errorBox);
			passwordInput.value = '';
			passwordInput.focus();
		}
	}

	on(submitBtn, 'click', attempt);
	on(passwordInput, 'keydown', (e) => {
		if (e.key === 'Enter') {
			attempt();
		}
	});
	on(usernameInput, 'keydown', (e) => {
		if (e.key === 'Enter') {
			passwordInput.focus();
		}
	})

	requestAnimationFrame(() => usernameInput.focus());

	return screen;
}
