import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
	base: "./",
	root: resolve(__dirname, 'src/dashboard'),
	plugins: [],
	build: {
		outDir: resolve(__dirname, 'dist/dashboard'),
		emptyOutDir: true,
		rollupOptions: {
			input: resolve(__dirname, 'src/dashboard/index.html'),
			output: {
				entryFileNames: 'assets/[name].js',
				chunkFileNames: 'assets/[name]-[hash].js',
				assetFileNames: 'assets/[name][extname]',
			},
		},
	},
	server: {
		proxy: {
			'/_tracker': {
				target:       'http://localhost:4242',
				changeOrigin: true,
			},
		},
	},
})
