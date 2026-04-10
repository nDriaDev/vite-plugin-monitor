import { defineConfig } from 'tsdown';

export default defineConfig([
	{
		entry: {
			'index':         'src/index.ts',
			'plugin/logger-worker': 'src/plugin/logger-worker.ts',
		},
		format: "esm",
		platform: 'node',
		dts: true,
		sourcemap: true,
		clean: true,   // INFO cleans dist/ on the first pass (prebuild already ran rimraf, but this is a safety net)
		external: ['vite'],
		outExtensions() {
			return { dts: ".ts" }
		}
	},
	{
		entry: {
			'index': 'src/index.ts',
			'plugin/logger-worker': 'src/plugin/logger-worker.ts',
		},
		format: "esm",
		platform: 'node',
		dts: true,
		sourcemap: true,
		clean: false,  // INFO must NOT clean: first config's output (index.*, plugin/*) is already in dist/
		external: ['vite'],
		outExtensions() {
			return { dts: ".mts", js: ".mjs" }
		}
	},
	{
		entry: {
			'index': 'src/index.ts',
			'plugin/logger-worker': 'src/plugin/logger-worker.ts',
		},
		format: "cjs",
		platform: 'node',
		dts: true,
		sourcemap: true,
		clean: false,  // INFO must NOT clean: first config's output (index.*, plugin/*) is already in dist/
		external: ['vite'],
		outExtensions() {
			return { dts: ".cts" }
		}
	},
	{
		entry: { 'client/index': 'src/client/index.ts' },
		format: ['esm'],
		platform: 'browser',
		dts: true,
		sourcemap: true,
		minify: true,
		clean: false,  // INFO must NOT clean: first config's output (index.*, plugin/*) is already in dist/
		outExtensions() {
			return { dts: ".ts" }
		}
	},
	{
		entry: { 'client/index': 'src/client/index.ts' },
		format: ['esm'],
		platform: 'browser',
		dts: true,
		sourcemap: true,
		minify: true,
		clean: false,  // INFO must NOT clean: first config's output (index.*, plugin/*) is already in dist/
		outExtensions() {
			return { dts: ".mts", js: ".mjs" }
		}
	},
	{
		entry: { 'client/index': 'src/client/index.ts' },
		format: ['cjs'],
		platform: 'browser',
		dts: true,
		sourcemap: true,
		minify: true,
		clean: false,  // INFO must NOT clean: first config's output (index.*, plugin/*) is already in dist/
		outExtensions() {
			return { dts: ".cts" }
		}
	}
])
