/**
 * # TypedEventEmitter
 *
 * A tiny pub/sub hub — the seam that lets Phase 2's Model say "a block
 * was mined" without importing, or even knowing about, the three.js View.
 * Dependencies point one way (View → Model), updates flow the other way
 * (Model → events → View). That inversion is the core of MVC.
 *
 * "Typed" is the TypeScript twist: the `Events` map ties every event
 * name to its payload type, so subscribing to 'block:mined' with a
 * handler expecting the wrong payload is a *compile* error, not a
 * runtime surprise.
 */
export class TypedEventEmitter<Events> {
	private listeners = new Map<keyof Events, Set<(payload: never) => void>>();

	/**
	 * Subscribe. Returns a disposer instead of requiring an `off(event,
	 * fn)` pair — the caller can't get the unsubscribe arguments wrong.
	 */
	on<K extends keyof Events>(event: K, listener: (payload: Events[K]) => void): () => void {
		let set = this.listeners.get(event);
		if (!set) {
			set = new Set();
			this.listeners.set(event, set);
		}
		set.add(listener as (payload: never) => void);
		return () => set.delete(listener as (payload: never) => void);
	}

	emit<K extends keyof Events>(event: K, payload: Events[K]): void {
		const set = this.listeners.get(event);
		if (!set) return;
		// Copy before iterating so a listener that unsubscribes (or
		// subscribes) during emit can't corrupt the iteration.
		for (const listener of [...set]) {
			(listener as (payload: Events[K]) => void)(payload);
		}
	}
}
