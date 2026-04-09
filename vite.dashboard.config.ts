import { defineConfig } from 'vite'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'

const clientSrcPath = resolve(process.cwd(), 'src/client/index.ts');

/**
 * Vite plugin that injects `window.__TRACKER_CONFIG__` into the dashboard
 * HTML and enables overly **only during development** (`vite dev`).
 *
 * During `vite build` this plugin is a no-op - the config injected here
 * would be baked into the static HTML, but in production the plugin consumer
 * overwrites it via `generateConfigScript()` at serve time anyway. Keeping it
 * out of the build output avoids shipping hardcoded dev endpoints.
 */
function injectDevConfig(): Plugin {
	return {
		name: 'inject-dev-tracker-config',
		apply: 'serve',   // INFO only active during vite dev, not vite build
		transformIndexHtml(html) {
			const config = {
				mode: 'standalone',
				appId: 'dev',
				writeEndpoint: 'http://localhost:4242/_tracker/events',
				readEndpoint: 'http://localhost:4242/_tracker',
				pingEndpoint: '',
				wsEndpoint: '',
				apiKey: '',
				batchSize: 25,
				flushInterval: 3000,
				track: {
					clicks: true,
					http: true,
					errors: true,
					navigation: true,
					console: false,
					level: 'info',
					ignoreUrls: []
				},
				dashboard: {
					enabled: true,
					route: '/_dashboard',
					pollInterval: 3000,
					auth: {
						username: '0a26ba53f50677da78a8ca98adcfd46d05cbee580ce6f30311ad336b1d386841',
						password: '0a26ba53f50677da78a8ca98adcfd46d05cbee580ce6f30311ad336b1d386841'
					}
				},
				overlay: {
					enabled: true,
					position: 'bottom-right'
				}
			}

			return html.replace(
				'</head>',
				`<script>window.__TRACKER_CONFIG__ = Object.freeze(${JSON.stringify(config)})</script>
<script type="module">
import { setupTrackers, tracker } from '/@fs/${clientSrcPath}';
setupTrackers();
if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', () => {
		debugger;
		tracker.init(() => 'dev-user');
	});
} else {
	tracker.init(() => 'dev-user');
}
</script>\n</head>`,
			);
		}
	}
}

export default defineConfig({
	base: './',
	root: resolve(__dirname, 'src/dashboard'),
	plugins: [injectDevConfig()],

	build: {
		outDir: resolve(__dirname, 'dist/dashboard'),
		emptyOutDir: true,
		rollupOptions: {
			input: resolve(__dirname, 'src/dashboard/index.html'),
			output: {
				entryFileNames: 'assets/[name].js',
				chunkFileNames: 'assets/[name]-[hash].js',
				assetFileNames: 'assets/[name][extname]'
			}
		}
	},

	server: {
		fs: {
			// INFO allow to import src/client from root in src/dashboard
			allow: ['..']
		},
		proxy: {
			'/_tracker': {
				target: 'http://localhost:4242',
				changeOrigin: true
			}
		}
	}
})
