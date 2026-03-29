#!/usr/bin/env node
/* eslint-disable no-undef */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');
const distDir = join(rootDir, 'dist');

const colors = {
	reset: '\x1b[0m',
	bright: '\x1b[1m',
	red: '\x1b[31m',
	green: '\x1b[32m',
	yellow: '\x1b[33m',
	blue: '\x1b[34m',
};

function log(message, color = 'reset') {
	console.log(`${colors[color]}${message}${colors.reset}`);
}

function checkFile(filename, description) {
	const filepath = join(distDir, filename);
	const exists = existsSync(filepath);

	if (exists) {
		const stats = readFileSync(filepath, 'utf-8');
		const size = (stats.length / 1024).toFixed(2);
		log(`  ✅ ${description}: ${filename} (${size} KB)`, 'green');
		return true;
	} else {
		log(`  ❌ ${description}: ${filename} NOT FOUND`, 'red');
		return false;
	}
}

function verifyPackageJson() {
	const packageJson = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf-8'));

	log('\n📦 Package.json Verification:', 'blue');

	const checks = [
		{ field: 'main', expected: './dist/index.cjs', description: 'CommonJS entry' },
		{ field: 'module', expected: './dist/index.js', description: 'ESM entry' },
		{ field: 'types', expected: './dist/index.d.ts', description: 'TypeScript types' },
	];

	let allGood = true;

	checks.forEach(({ field, expected }) => {
		const actual = packageJson[field];
		if (actual === expected) {
			log(`  ✅ ${field}: ${actual}`, 'green');
		} else {
			log(`  ❌ ${field}: ${actual} (expected: ${expected})`, 'red');
			allGood = false;
		}
	});

	// Check exports
	if (packageJson.exports && packageJson.exports['.']) {
		const exp = packageJson.exports['.'];
		log(`  ✅ exports configuration present`, 'green');

		if (exp.types === './dist/index.d.ts') {
			log(`    ✅ types: ${exp.types}`, 'green');
		} else {
			log(`    ❌ types: ${exp.types} (expected: ./dist/index.d.ts)`, 'red');
			allGood = false;
		}

		if (exp.import === './dist/index.js') {
			log(`    ✅ import: ${exp.import}`, 'green');
		} else {
			log(`    ❌ import: ${exp.import} (expected: ./dist/index.js)`, 'red');
			allGood = false;
		}

		if (exp.require === './dist/index.cjs') {
			log(`    ✅ require: ${exp.require}`, 'green');
		} else {
			log(`    ❌ require: ${exp.require} (expected: ./dist/index.cjs)`, 'red');
			allGood = false;
		}
	} else {
		log(`  ❌ exports configuration missing`, 'red');
		allGood = false;
	}

	return allGood;
}

function main() {
	log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'blue');
	log('🔍 Build Verification Script', 'bright');
	log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n', 'blue');

	if (!existsSync(distDir)) {
		log('❌ dist/ directory not found!', 'red');
		log('\nPlease run: pnpm build', 'yellow');
		process.exit(1);
	}

	log('📁 Checking Build Output Files:', 'blue');

	let allFilesExist = true;

	allFilesExist &= checkFile('index.cjs', 'CommonJS build');
	allFilesExist &= checkFile('index.js', 'ESM build');
	allFilesExist &= checkFile('index.d.ts', 'TypeScript declarations');
	allFilesExist &= checkFile('plugin/logger-worker.js', 'Logger worker (ESM)');
	allFilesExist &= checkFile('plugin/logger-worker.cjs', 'Logger worker (CJS)');
	allFilesExist &= checkFile('client/index.js', 'Browser client');
	allFilesExist &= checkFile('client/index.d.ts', 'Browser client types');
	allFilesExist &= checkFile('dashboard/index.html', 'Dashboard SPA');

	const packageJsonOk = verifyPackageJson();

	log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'blue');

	if (allFilesExist && packageJsonOk) {
		log('✅ Build verification PASSED!', 'green');
		log('\nYour package is ready for publishing! 🚀', 'green');
		log('\nSupported usage patterns:', 'blue');
		log('  • CommonJS: require("@ndriadev/vite-plugin-monitor")', 'yellow');
		log('  • ESM: import mockApi from "@ndriadev/vite-plugin-monitor"', 'yellow');
		log('  • TypeScript: Full type support ✨', 'yellow');
		log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n', 'blue');
		process.exit(0);
	} else {
		log('❌ Build verification FAILED!', 'red');
		log('\nPlease fix the issues above before publishing.', 'yellow');
		log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n', 'blue');
		process.exit(1);
	}
}

main();
