// Entry point for the browser app. Phase 2 (MVC + three.js) wires up here.
// During Phase 1 this is intentionally a stub so `npm run dev` still works.
const app = document.querySelector<HTMLDivElement>('#app');
if (app) {
	app.textContent = 'Phase 1 in progress — run `npm test` for the core blockchain.';
}

export {};
