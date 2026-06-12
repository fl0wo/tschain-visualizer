import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		// Core blockchain logic is pure TypeScript — it runs in plain Node,
		// no browser or DOM environment needed.
		environment: 'node',
		include: ['tests/**/*.test.ts'],
	},
});
