import { describe, it, expect } from 'vitest';
import { TypedEventEmitter } from '../src/core/events';

/**
 * The emitter is the seam between Model and View in Phase 2: the Model
 * announces what happened, without knowing who is listening. "Typed"
 * means each event name carries a payload type, so a listener for
 * 'block:mined' can never be handed a tx:rejected payload — the compiler
 * checks the wiring that MVC frameworks usually leave to runtime.
 */
interface TestEvents {
	greeting: { name: string };
	count: number;
}

describe('TypedEventEmitter', () => {
	it('delivers payloads to subscribed listeners', () => {
		const emitter = new TypedEventEmitter<TestEvents>();
		const received: string[] = [];
		emitter.on('greeting', (payload) => received.push(payload.name));
		emitter.emit('greeting', { name: 'satoshi' });
		expect(received).toEqual(['satoshi']);
	});

	it('supports multiple listeners and different events independently', () => {
		const emitter = new TypedEventEmitter<TestEvents>();
		const log: Array<string | number> = [];
		emitter.on('greeting', (p) => log.push(p.name));
		emitter.on('greeting', (p) => log.push(p.name.toUpperCase()));
		emitter.on('count', (n) => log.push(n));
		emitter.emit('count', 7);
		emitter.emit('greeting', { name: 'hal' });
		expect(log).toEqual([7, 'hal', 'HAL']);
	});

	it('unsubscribes via the returned disposer', () => {
		const emitter = new TypedEventEmitter<TestEvents>();
		let calls = 0;
		const dispose = emitter.on('count', () => calls++);
		emitter.emit('count', 1);
		dispose();
		emitter.emit('count', 2);
		expect(calls).toBe(1);
	});
});
