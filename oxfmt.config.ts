import {formatter as defaults} from './oxc.config.ts';

// Add custom oxfmt formatter overrides here.
// This file is preserved on template updates.
const formatter: Partial<typeof defaults> = {};

const config = {...defaults, ...formatter};

export default config;
