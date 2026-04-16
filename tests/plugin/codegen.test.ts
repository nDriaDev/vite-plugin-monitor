import { describe, it, expect } from 'vitest'
import { generateConfigScript, generateSetupScript } from '../../src/plugin/codegen'
import { resolveOptions } from '../../src/plugin/config'
import type { ResolvedTrackerOptions } from '../../src/types'

function makeOpts(overrides: Partial<Parameters<typeof resolveOptions>[0]> = {}): ResolvedTrackerOptions {
	return resolveOptions({ appId: 'test-app', ...overrides });
}

describe('generateConfigScript()', () => {

	it('contains Object.defineProperty on window.__TRACKER_CONFIG__', () => {
		const script = generateConfigScript(makeOpts());
		expect(script).toContain("Object.defineProperty(window, '__TRACKER_CONFIG__'");
	});

	it('contains Object.freeze of the config', () => {
		const script = generateConfigScript(makeOpts());
		expect(script).toContain('Object.freeze(');
	});

	it('contains writable: false', () => {
		const script = generateConfigScript(makeOpts());
		expect(script).toContain('writable:     false');
	});

	it('contains configurable: false', () => {
		const script = generateConfigScript(makeOpts());
		expect(script).toContain('configurable: false');
	});

	it('includes appId in the serialized JSON', () => {
		const script = generateConfigScript(makeOpts());
		expect(script).toContain('"appId": "test-app"');
	});

	it('for middleware mode includes writeEndpoint and readEndpoint', () => {
		const opts = makeOpts();
		const script = generateConfigScript(opts);
		expect(script).toContain('"writeEndpoint"');
		expect(script).toContain('"readEndpoint"');
	});

	it('for websocket mode includes wsEndpoint in the JSON', () => {
		const opts = makeOpts({
			storage: { mode: 'websocket', wsEndpoint: 'ws://remote:9000' } as any
		});
		const script = generateConfigScript(opts);
		expect(script).toContain('"wsEndpoint": "ws://remote:9000"');
	});

	it('includes overlay options in the JSON', () => {
		const opts = makeOpts({ overlay: { enabled: true, position: 'top-left' } });
		const script = generateConfigScript(opts);
		expect(script).toContain('"enabled": true');
		expect(script).toContain('"position": "top-left"');
	});
});

describe('generateSetupScript()', () => {

	it('contains import of setupTrackers from client/index.js', () => {
		const script = generateSetupScript(makeOpts({ autoInit: false }), false);
		expect(script).toContain("import { setupTrackers } from '");
		expect(script).toContain('client/index.js');
	});

	it('contains Object.defineProperty on window.__TRACKER_CONFIG__', () => {
		const script = generateSetupScript(makeOpts(), false);
		expect(script).toContain("Object.defineProperty(window, '__TRACKER_CONFIG__'");
	});

	it('contains the setupTrackers() call', () => {
		const script = generateSetupScript(makeOpts(), false);
		expect(script).toContain('setupTrackers(');
	});

	it('serializes the default userId fn () => null', () => {
		const script = generateSetupScript(makeOpts(), false);
		expect(script).toContain('() => null');
	});

	it('serializes a custom userId fn via .toString()', () => {
		const customFn = () => 'user-xyz';
		const script = generateSetupScript(
			makeOpts({ track: { userId: customFn } as any }),
			false
		);
		expect(script).toContain(customFn.toString());
	});

	it('includes appId in the serialized JSON', () => {
		const script = generateSetupScript(makeOpts(), false);
		expect(script).toContain('"appId": "test-app"');
	});

	it('contains Object.freeze of the config', () => {
		const script = generateSetupScript(makeOpts(), false);
		expect(script).toContain('Object.freeze(');
	});

	it('contains writable: false and configurable: false', () => {
		const script = generateSetupScript(makeOpts(), false);
		expect(script).toContain('writable:     false');
		expect(script).toContain('configurable: false');
	});
});
