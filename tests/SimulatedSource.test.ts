import { describe, it, expect } from 'vitest';
import { Simulation } from '../src/app/controller/Simulation';
import { SimulatedSource } from '../src/app/datasources/SimulatedSource';
import { ChainModel } from '../src/app/model/ChainModel';

/**
 * The DataSource seam must be a pure wrapper: same event emitter object
 * (consumers keep their streams), status reflecting start/stop, and the
 * simulation actually driven.
 */
describe('SimulatedSource', () => {
	it('exposes the model emitter and reports status transitions', async () => {
		const model = new ChainModel(1);
		const simulation = new Simulation(model);
		const source = new SimulatedSource(model, simulation);

		// the EXACT emitter — not a relay; existing listeners keep working
		expect(source.events).toBe(model.events);
		expect(source.kind).toBe('simulated');
		expect(source.status).toBe('idle');

		const statuses: string[] = [];
		source.events.on('source:status', (p) => statuses.push(p.status));

		await source.start();
		expect(source.status).toBe('live');
		// start() boots the simulation — the world gets seeded
		expect(model.walletNames.length).toBeGreaterThan(0);

		source.stop();
		expect(source.status).toBe('idle');
		expect(statuses).toEqual(['live', 'idle']);
		simulation.stop();
	});
});
