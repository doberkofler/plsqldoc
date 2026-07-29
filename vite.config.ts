import {defineConfig} from 'vitest/config';
import path from 'node:path';

export default defineConfig({
	build: {
		ssr: true,
		lib: {
			entry: path.resolve(__dirname, 'src/index.ts'),
			formats: ['es'],
			fileName: 'index',
		},
		outDir: 'dist',
		emptyOutDir: true,
		target: 'node22',
	},
	test: {
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json', 'html', 'lcov'],
		},
	},
});
