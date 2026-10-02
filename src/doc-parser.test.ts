import {describe, expect, it} from 'vitest';

import {findParamDoc, findReturnDoc, parseDocComment} from './doc-parser.js';

describe('documentation comments', () => {
	it('preserves descriptions and ordered tags', () => {
		const raw = `/**
		 * Summary line.
		 *
		 * @author Example Author
		 * @deprecated
		 */`;

		expect(parseDocComment(raw)).toStrictEqual({
			description: 'Summary line.',
			raw,
			tags: [
				{name: 'author', value: 'Example Author'},
				{name: 'deprecated', value: ''},
			],
		});
	});

	it('returns null for absent comments', () => {
		expect(parseDocComment(null)).toBeNull();
		expect(findReturnDoc(null)).toBeNull();
		expect(findParamDoc(null, 'p_value')).toBeNull();
	});

	it('finds return and parameter documentation case-insensitively', () => {
		const doc = parseDocComment(`-- @author Example Author
-- @param P_VALUE value description
-- @RETURN result description`);

		expect(findParamDoc(doc, 'p_value')).toBe('value description');
		expect(findParamDoc(doc, 'p_missing')).toBeNull();
		expect(findReturnDoc(doc)).toBe('result description');
	});
});
