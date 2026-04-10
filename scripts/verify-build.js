#!/usr/bin/env node
/* eslint-disable no-undef */


import { readFileSync, existsSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

const c = {
	reset: '\x1b[0m',
	bright: '\x1b[1m',
	red: '\x1b[31m',
	green: '\x1b[32m',
	yellow: '\x1b[33m',
	blue: '\x1b[34m',
	dim: '\x1b[2m',
};

const log = (msg, color = 'reset') => console.log(`${c[color]}${msg}${c.reset}`);
const pass = (msg) => log(`  ✅ ${msg}`, 'green');
const fail = (msg) => log(`  ❌ ${msg}`, 'red');
const hr = () => log('━'.repeat(62), 'blue');

/**
 * Recursively collect every leaf string value in a nested object,
 * paired with the dot-path that leads to it.
 *
 * Example:
 *   { import: { types: './dist/index.d.mts', default: './dist/index.mjs' } }
 *   → [ ['import.types', './dist/index.d.mts'], ['import.default', './dist/index.mjs'] ]
 */
function collectLeafPaths(obj, prefix = '') {
	const results = [];
	for (const [key, value] of Object.entries(obj ?? {})) {
		const path = prefix ? `${prefix}.${key}` : key;
		if (value !== null && typeof value === 'object') {
			results.push(...collectLeafPaths(value, path));
		} else if (typeof value === 'string') {
			results.push([path, value]);
		}
	}
	return results;
}

/** Resolve a package.json-relative path to an absolute filesystem path. */
function resolveField(value) {
	return resolve(rootDir, value.replace(/^\.\//, ''));
}

/** Human-readable file size in KB. */
function fileSize(absPath) {
	return (statSync(absPath).size / 1024).toFixed(2);
}

/**
 * Returns a Map<absPath, label> of every file path declared in package.json.
 *
 * Inspected fields:
 *   - top-level: "main", "module", "types"
 *   - every leaf string inside "exports" that starts with "./"
 *
 * Duplicate paths (same file referenced by multiple fields) are deduplicated —
 * the first label encountered wins.
 */
function collectDeclaredFiles(pkg) {
	const files = new Map(); // absPath → label

	const addFile = (absPath, label) => {
		if (!files.has(absPath)) files.set(absPath, label);
	};

	for (const field of ['main', 'module', 'types']) {
		if (typeof pkg[field] === 'string') {
			addFile(resolveField(pkg[field]), `${field}: "${pkg[field]}"`);
		}
	}

	if (pkg.exports && typeof pkg.exports === 'object') {
		for (const [exportKey, exportValue] of Object.entries(pkg.exports)) {
			const subtree = typeof exportValue === 'string'
				? { default: exportValue }
				: exportValue;

			for (const [dotPath, value] of collectLeafPaths(subtree)) {
				if (typeof value === 'string' && value.startsWith('./')) {
					addFile(
						resolveField(value),
						`exports["${exportKey}"].${dotPath}: "${value}"`
					);
				}
			}
		}
	}

	return files;
}

function main() {
	hr();
	log('🔍 Build Verification', 'bright');
	hr();

	const pkgPath = join(rootDir, 'package.json');
	if (!existsSync(pkgPath)) {
		fail('package.json not found in project root');
		process.exit(1);
	}

	const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
	const declaredFiles = collectDeclaredFiles(pkg);

	if (declaredFiles.size === 0) {
		log('\n⚠️  No output files found in package.json (checked: main, module, types, exports)', 'yellow');
		log('   Nothing to verify.\n', 'yellow');
		process.exit(0);
	}

	log(`\n📁 Checking ${declaredFiles.size} file(s) declared in package.json:`, 'blue');

	let allOk = true;

	for (const [absPath, label] of declaredFiles) {
		if (existsSync(absPath)) {
			pass(`${label}  (${fileSize(absPath)} KB)`);
		} else {
			fail(`${label}  — FILE NOT FOUND`);
			allOk = false;
		}
	}

	log('');
	hr();

	if (allOk) {
		log('✅ Build verification PASSED!', 'green');
		log('');
		log(`All ${declaredFiles.size} declared file(s) are present. Ready to publish 🚀`, 'green');
	} else {
		log('❌ Build verification FAILED!', 'red');
		log('');
		log('One or more files declared in package.json are missing.', 'yellow');
		log('Run the build command and try again.', 'yellow');
	}

	hr();
	log('');

	process.exit(allOk ? 0 : 1);
}

main();
