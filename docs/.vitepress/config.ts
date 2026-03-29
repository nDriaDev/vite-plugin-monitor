import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DefaultTheme, defineConfig } from 'vitepress';
import packageJson from '../../package.json';

const nav: DefaultTheme.NavItem[] = [
	{ text: 'Guide', link: '/guide/introduction' },
	{ text: 'Configuration', link: '/configuration/plugin-options' },
	{ text: 'Client API', link: '/client-api/overview' },
	{ text: 'Reference', link: '/reference/event-types' },
];

function buildNav(): DefaultTheme.NavItem[] {
	nav.push({
		text: packageJson.version,
		items: [
			{ text: 'Changelog', link: 'https://github.com/nDriaDev/vite-plugin-monitor/blob/main/CHANGELOG.md' }
		]
	});
	return nav;
}

export default defineConfig({
	title: 'vite-plugin-monitor',
	description: 'Automatic User Interaction Tracking, Real-Time Dashboard & File Logging for Vite',
	base: "/",
	buildEnd() {
		const sitemapPath = resolve(join(__dirname, "dist", "sitemap.xml"));
		const humansPath = resolve(join(__dirname, "dist", "humans.txt"));
		if (!existsSync(sitemapPath)) {
			return;
		}
		let xml = readFileSync(sitemapPath, "utf-8");
		const now = new Date();
		xml = xml.replace(/<lastmod>.*?<\/lastmod>/g, `<lastmod>${now.toISOString()}</lastmod >`);
		writeFileSync(sitemapPath, xml);
		if (!existsSync(humansPath)) {
			return;
		}
		const [month, day, year] = now.toLocaleDateString().split("/");
		let humans = readFileSync(humansPath, "utf-8");
		humans = humans.replace(
			/(Last update:\s*).*/,
			`$1${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year}`
		);
		writeFileSync(humansPath, humans);
	},
	cleanUrls: true,
	head: [
		['link', { rel: 'icon', type: 'image/png', href: '/favicon-96x96.png' }],
		['meta', { name: 'theme-color', content: '#646cff' }],
		['meta', { property: 'og:type', content: 'website' }],
		['meta', { property: 'og:title', content: 'vite-plugin-monitor' }],
		['meta', { property: 'og:description', content: 'Automatic User Interaction Tracking, Real-Time Dashboard & File Logging for Vite' }],
	],
	ignoreDeadLinks: [
		"http://localhost:5173",
		"http://localhost:5173/_dashboard"
	],
	themeConfig: {
		logo: '/logo.png',
		nav: buildNav(),
		sidebar: [
			{
				text: 'Getting Started',
				items: [
					{ text: 'Introduction', link: '/guide/introduction' },
					{ text: 'Installation', link: '/guide/installation' },
					{ text: 'Quick Start', link: '/guide/quick-start' },
				],
			},
			{
				text: 'Storage Modes',
				items: [
					{ text: 'Overview', link: '/guide/storage-modes' },
					{ text: 'Middleware Mode', link: '/guide/storage-modes#middleware-mode' },
					{ text: 'Standalone Mode', link: '/guide/storage-modes#standalone-mode' },
					{ text: 'HTTP Mode', link: '/guide/storage-modes#http-mode' },
					{ text: 'WebSocket Mode', link: '/guide/storage-modes#websocket-mode' },
				],
			},
			{
				text: 'Configuration',
				items: [
					{ text: 'Plugin Options', link: '/configuration/plugin-options' },
					{ text: 'Trackers', link: '/configuration/trackers' },
					{ text: 'Storage', link: '/configuration/storage' },
					{ text: 'Logging', link: '/configuration/logging' },
					{ text: 'Dashboard', link: '/configuration/dashboard' },
					{ text: 'Overlay', link: '/configuration/overlay' },
				],
			},
			{
				text: 'Client API',
				items: [
					{ text: 'Overview', link: '/client-api/overview' },
					{ text: 'tracker.init()', link: '/client-api/init' },
					{ text: 'tracker.track()', link: '/client-api/track' },
					{ text: 'tracker.setUser()', link: '/client-api/set-user' },
					{ text: 'tracker.setContext()', link: '/client-api/set-context' },
					{ text: 'tracker.time()', link: '/client-api/timers' },
					{ text: 'tracker.group()', link: '/client-api/groups' },
					{ text: 'tracker.destroy()', link: '/client-api/destroy' },
				],
			},
			{
				text: 'Features',
				items: [
					{ text: 'Dashboard', link: '/advanced/dashboard' },
					{ text: 'Debug Overlay', link: '/advanced/overlay' },
					{ text: 'Log Files', link: '/advanced/logging' },
					{ text: 'Security & Redaction', link: '/advanced/security' },
					{ text: 'Manual Initialization', link: '/advanced/manual-init' },
					{ text: 'Production Builds', link: '/advanced/production' },
				],
			},
			{
				text: 'API Contracts',
				items: [
					{ text: 'Ingest Endpoint', link: '/reference/api-contracts#ingest-endpoint-http' },
					{ text: 'Read Endpoint', link: '/reference/api-contracts#read-endpoint-http' },
					{ text: 'WebSocket Protocol', link: '/reference/api-contracts#websocket-protocol' },
				],
			},
			{
				text: 'Reference',
				items: [
					{ text: 'Event Types & Payloads', link: '/reference/event-types' },
					{ text: 'API Contracts', link: '/reference/api-contracts' },
					{ text: 'Troubleshooting', link: '/reference/troubleshooting' },
				],
			},
		],
		socialLinks: [
			{ icon: 'github', link: 'https://github.com/nDriaDev/vite-plugin-monitor' },
			{ icon: 'npm', link: 'https://www.npmjs.com/package/@ndriadev/vite-plugin-monitor' },
		],
		footer: {
			message: 'Released under the MIT License.',
			copyright: 'Copyright © 2024 nDriaDev',
		},
		editLink: {
			pattern: 'https://github.com/nDriaDev/vite-plugin-monitor/edit/main/docs/:path',
			text: 'Edit this page on GitHub',
		},
		search: {
			provider: 'local',
		},
	},
	markdown: {
		theme: {
			light: 'github-light',
			dark: 'github-dark'
		},
		lineNumbers: true
	},
	vite: {
		build: {
			minify: true
		}
	}
})
