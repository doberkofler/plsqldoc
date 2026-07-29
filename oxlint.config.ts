import {linter as defaults} from './oxc.config.ts';

// Add custom oxlint rule overrides here.
// This file is preserved on template updates.
//
// Example:
//   rules: { 'no-console': 'off' }
//   overrides: [{ files: ['scripts/**'], rules: { 'no-console': 'off' } }]
const rules: Partial<typeof defaults.rules> = {};
const overrides: Partial<NonNullable<typeof defaults.overrides>[number]>[] = [];

const config = {
	...defaults,
	rules: {...defaults.rules, ...rules},
	overrides: [...defaults.overrides, ...overrides],
};

export default config;
