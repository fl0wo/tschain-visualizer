/**
 * # Narrator — "what's happening right now"
 *
 * The ticker logs history; the narrator explains the PRESENT. One panel,
 * one phase at a time: a short title plus one or two plain-English
 * sentences that tell the spectator what the animation they're watching
 * actually means (why signatures, why a race, why fees, why rejection).
 *
 * Event-driven and stateless on purpose: the controller pushes a phase
 * per model event, which is exactly the shape a future step-by-step
 * "debugger" mode can replay one event at a time.
 */
export class Narrator {
	private readonly title: HTMLElement;
	private readonly body: HTMLElement;
	private readonly panel: HTMLElement;

	constructor(root: HTMLElement) {
		this.panel = document.createElement('div');
		this.panel.className = 'panel narrator';
		this.panel.innerHTML = `
			<h2>What's happening</h2>
			<div class="narrator-title" data-narrator-title>Booting the network…</div>
			<div class="narrator-body" data-narrator-body>Wallets are about to appear and start transacting.</div>`;
		root.appendChild(this.panel);
		this.title = this.panel.querySelector('[data-narrator-title]')!;
		this.body = this.panel.querySelector('[data-narrator-body]')!;
	}

	/** Swap to a new phase with a brief fade so changes catch the eye. */
	say(title: string, body: string, kind: 'info' | 'success' | 'error' = 'info'): void {
		this.title.textContent = title;
		this.body.textContent = body;
		this.title.className = `narrator-title narrator-${kind}`;
		// retrigger the CSS entrance animation
		this.panel.classList.remove('narrator-pulse');
		void this.panel.offsetWidth;
		this.panel.classList.add('narrator-pulse');
	}
}
