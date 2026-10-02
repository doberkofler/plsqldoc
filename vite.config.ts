import {defineConfig} from 'vitest/config';
import path from 'node:path';
import packageMetadata from './package.json' with {type: 'json'};

export default defineConfig({
	define: {
		PACKAGE_VERSION: JSON.stringify(packageMetadata.version),
	},
	build: {
		ssr: true,
		lib: {
			entry: path.resolve(import.meta.dirname, 'src/index.ts'),
			formats: ['es'],
			fileName: 'index',
		},
		outDir: 'dist',
		emptyOutDir: true,
		target: 'node22',
	},
	test: {
		include: ['src/**/*.test.ts'],
		coverage: {
			exclude: ['src/generated/**', 'src/plSqlLexerBase.ts'],
			include: ['src/**/*.ts'],
			provider: 'v8',
			reporter: ['text', 'json', 'html', 'lcov'],
			thresholds: {
				branches: 85,
				functions: 95,
				lines: 95,
				statements: 95,
			},
		},
	},
});
