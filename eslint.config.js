import js from '@eslint/js'
import tseslint from '@typescript-eslint/eslint-plugin'
import tsparser from '@typescript-eslint/parser'

export default [
    {
        ignores: ['docs/**', 'dist/**', 'node_modules/**'],
    },
    js.configs.recommended,
    {
        files: ['src/**/*.ts'],
        languageOptions: {
            parser: tsparser,
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
                sourceType: 'module',
            },
        },
        plugins: {
            '@typescript-eslint': tseslint,
        },
        rules: {
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
            '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
            '@typescript-eslint/no-floating-promises': 'error',
            '@typescript-eslint/await-thenable': 'error',
            '@typescript-eslint/no-misused-promises': 'error',
            'no-console': 'off',
            'eqeqeq': ['error', 'always'],
            'no-var': 'error',
            'prefer-const': 'error',
        },
    },
    {
        files: ['src/plugin/logger-worker.ts'],
        languageOptions: {
            parser: tsparser,
            parserOptions: {
                sourceType: 'module',
            },
        },
        plugins: {
            '@typescript-eslint': tseslint,
        },
        rules: {
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
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
