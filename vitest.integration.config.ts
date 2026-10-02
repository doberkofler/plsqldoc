import {defineConfig} from 'vitest/config';

export default defineConfig({
	test: {
		coverage: {enabled: false},
		include: ['tests/integration/**/*.integration.test.ts'],
	},
});
