import tseslint from '@typescript-eslint/eslint-plugin'
import tsparser from '@typescript-eslint/parser'
import globals from 'globals'

export default [
	{
		ignores: ['docs/**', 'dist/**', 'node_modules/**'],
	},
	// ─── Client code: runs in the browser ────────────────────────────────────
	{
		files: ['src/client/**/*.ts', 'src/dashboard/**/*.ts'],
		languageOptions: {
			parser: tsparser,
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
				sourceType: 'module',
			},
			globals: {
				...globals.browser,
			},
		},
		plugins: {
			'@typescript-eslint': tseslint,
		},
		rules: {
			'no-unused-vars': 'off',
			'@typescript-eslint/no-unused-vars': ['error', {
				argsIgnorePattern: '^_',
				varsIgnorePattern: '^_',
			}],

			'@typescript-eslint/no-explicit-any': 'warn',
			'@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],

			'@typescript-eslint/no-floating-promises': 'warn',
			'@typescript-eslint/await-thenable': 'error',
			'@typescript-eslint/no-misused-promises': 'warn',

			'no-case-declarations': 'off',
			'no-useless-escape': 'off',

			'no-console': 'off',
			'eqeqeq': ['error', 'always'],
			'no-var': 'error',
			'prefer-const': 'error',
		},
	},
	// ─── Plugin code: runs in Node.js ────────────────────────────────────────
	{
		files: ['src/plugin/**/*.ts', 'src/index.ts', 'src/types.ts', 'src/env.d.ts'],
		languageOptions: {
			parser: tsparser,
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
				sourceType: 'module',
			},
			globals: {
				// Causa 1: Node globals — process, __dirname, __filename, …
				...globals.node,
			},
		},
		plugins: {
			'@typescript-eslint': tseslint,
		},
		rules: {
			// Causa 2a: stessa correzione — regola base off, TS-aware on.
			'no-unused-vars': 'off',
			'@typescript-eslint/no-unused-vars': ['error', {
				argsIgnorePattern: '^_',
				varsIgnorePattern: '^_',
			}],

			'@typescript-eslint/no-explicit-any': 'warn',
			'@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],

			// Causa 2b: async callback a http.createServer e Connect.use
			// non sono "misuse" — la firma del callback non può essere tipata async
			// da quei framework, ma il comportamento è corretto e intenzionale.
			'@typescript-eslint/no-floating-promises': 'error',
			'@typescript-eslint/await-thenable': 'error',
			'@typescript-eslint/no-misused-promises': 'warn',

			'no-console': 'off',
			'eqeqeq': ['error', 'always'],
			'no-var': 'error',
			'prefer-const': 'error',
		},
	},
	// ─── Logger worker: Node.js worker thread, no type-aware linting ─────────
	// Il worker gira in un thread separato e non può accedere al module graph
	// del processo principale. projectService fallirebbe perché il worker usa
	// solo un sottoinsieme locale dei tipi. Le regole promise vengono disabilitate
	// perché il worker usa top-level await in modo sintetico tramite postMessage.
	{
		files: ['src/plugin/logger-worker.ts'],
		languageOptions: {
			parser: tsparser,
			parserOptions: {
				sourceType: 'module',
			},
			globals: {
				...globals.node,
			},
		},
		plugins: {
			'@typescript-eslint': tseslint,
		},
		rules: {
			'no-unused-vars': 'off',
			'@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
			'@typescript-eslint/no-explicit-any': 'warn',
			'@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
			'@typescript-eslint/no-floating-promises': 'off',
			'@typescript-eslint/await-thenable': 'off',
			'@typescript-eslint/no-misused-promises': 'off',
			'no-var': 'error',
			'prefer-const': 'error',
			'eqeqeq': ['error', 'always'],
		},
	},
]
