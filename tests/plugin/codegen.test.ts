import { describe, it, expect } from 'vitest'
import { generateAutoInitScript, generateConfigScript, generateSetupScript } from '../../src/plugin/codegen'
import { resolveOptions } from '../../src/plugin/config'
import type { ResolvedTrackerOptions } from '../../src/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOpts(overrides: Partial<Parameters<typeof resolveOptions>[0]> = {}): ResolvedTrackerOptions {
	return resolveOptions({ appId: 'test-app', ...overrides })
}

// ---------------------------------------------------------------------------
// generateAutoInitScript()
// ---------------------------------------------------------------------------

describe('generateAutoInitScript()', () => {

	it('contiene un import da client/index.js', () => {
		const script = generateAutoInitScript(makeOpts())
		expect(script).toContain("import { tracker } from '")
		expect(script).toContain('client/index.js')
	})

	it('contiene la chiamata tracker.init()', () => {
		const script = generateAutoInitScript(makeOpts())
		expect(script).toContain('tracker.init(')
	})

	it('serializza la userId fn di default () => null', () => {
		const script = generateAutoInitScript(makeOpts())
		expect(script).toContain('() => null')
	})

	it('serializza una userId fn custom tramite .toString()', () => {
		const customFn = () => 'user-abc'
		const script = generateAutoInitScript(
			makeOpts({ track: { userId: customFn } as any })
		)
		expect(script).toContain(customFn.toString())
	})
})

// ---------------------------------------------------------------------------
// generateConfigScript()
// ---------------------------------------------------------------------------

describe('generateConfigScript()', () => {

	it('contiene Object.defineProperty su window.__TRACKER_CONFIG__', () => {
		const script = generateConfigScript(makeOpts())
		expect(script).toContain("Object.defineProperty(window, '__TRACKER_CONFIG__'")
	})

	it('contiene Object.freeze del config', () => {
		const script = generateConfigScript(makeOpts())
		expect(script).toContain('Object.freeze(')
	})

	it('contiene writable: false', () => {
		const script = generateConfigScript(makeOpts())
		expect(script).toContain('writable:     false')
	})

	it('contiene configurable: false', () => {
		const script = generateConfigScript(makeOpts())
		expect(script).toContain('configurable: false')
	})

	it('include appId nel JSON serializzato', () => {
		const script = generateConfigScript(makeOpts())
		expect(script).toContain('"appId": "test-app"')
	})

	it('per mode middleware include writeEndpoint e readEndpoint', () => {
		// mode auto in un non-build context → sarà serializzato come "auto"
		// Il JSON del config deve contenere writeEndpoint e readEndpoint
		const opts = makeOpts()
		const script = generateConfigScript(opts)
		expect(script).toContain('"writeEndpoint"')
		expect(script).toContain('"readEndpoint"')
	})

	it('per mode websocket include wsEndpoint nel JSON', () => {
		const opts = makeOpts({
			storage: { mode: 'websocket', wsEndpoint: 'ws://remote:9000' } as any
		})
		const script = generateConfigScript(opts)
		expect(script).toContain('"wsEndpoint": "ws://remote:9000"')
	})

	it('include le opzioni overlay nel JSON', () => {
		const opts = makeOpts({ overlay: { enabled: true, position: 'top-left' } })
		const script = generateConfigScript(opts)
		expect(script).toContain('"enabled": true')
		expect(script).toContain('"position": "top-left"')
	})
})

// ---------------------------------------------------------------------------
// generateSetupScript()
// ---------------------------------------------------------------------------

describe('generateSetupScript()', () => {

	it('contiene import di setupTrackers da client/index.js', () => {
		const script = generateSetupScript(makeOpts())
		expect(script).toContain("import { setupTrackers } from '")
		expect(script).toContain('client/index.js')
	})

	it('contiene Object.defineProperty su window.__TRACKER_CONFIG__', () => {
		const script = generateSetupScript(makeOpts())
		expect(script).toContain("Object.defineProperty(window, '__TRACKER_CONFIG__'")
	})

	it('contiene la chiamata setupTrackers()', () => {
		const script = generateSetupScript(makeOpts())
		expect(script).toContain('setupTrackers(')
	})

	it('serializza la userId fn di default () => null', () => {
		const script = generateSetupScript(makeOpts())
		expect(script).toContain('() => null')
	})

	it('serializza una userId fn custom tramite .toString()', () => {
		const customFn = () => 'user-xyz'
		const script = generateSetupScript(
			makeOpts({ track: { userId: customFn } as any })
		)
		expect(script).toContain(customFn.toString())
	})

	it('include appId nel JSON serializzato', () => {
		const script = generateSetupScript(makeOpts())
		expect(script).toContain('"appId": "test-app"')
	})

	it('contiene Object.freeze del config', () => {
		const script = generateSetupScript(makeOpts())
		expect(script).toContain('Object.freeze(')
	})

	it('contiene writable: false e configurable: false', () => {
		const script = generateSetupScript(makeOpts())
		expect(script).toContain('writable:     false')
		expect(script).toContain('configurable: false')
	})
})
