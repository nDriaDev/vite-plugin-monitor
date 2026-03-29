import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
	resolve: {
		alias: {
			'@tracker': resolve(__dirname, 'src')
		}
	},
	test: {
		coverage: {
			provider: 'v8',
			include: ['src/**/*.ts'],
			exclude: [
				'src/env.d.ts',
				'src/resources/**',
				'src/types.ts',
				'src/index.ts',
				'src/dashboard/components/*',
				'src/dashboard/components/*',
				'src/dashboard/main.ts',
				'src/dashboard/**/*.css',
				'src/client/styles/*'
			]
		},
		projects: [
			{
				test: {
					environment: 'node',
					include: ['tests/plugin/**/*.test.ts'],
					pool: 'threads',
					maxConcurrency: 1,
					sequence: {
						concurrent: false
					}
				}
			},
			{
				test: {
					environment: 'jsdom',
					include: ['tests/client/**/*.test.ts'],
					setupFiles: ['tests/client/setup.ts'],
					pool: 'threads',
					maxConcurrency: 1,
					sequence: {
						concurrent: false
					}
				}
			},
			{
				test: {
					environment: 'jsdom',
					include: ['tests/dashboard/**/*.test.ts'],
					setupFiles: ['tests/dashboard/setup.ts'],
					pool: 'threads',
					maxConcurrency: 1,
					sequence: {
						concurrent: false
					}
				}
			}
		]
	}
})
