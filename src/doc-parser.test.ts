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

	it('preserves multiline repeated tags and source order', () => {
		const raw =
			'/**\r\n * Overview.\r\n *\r\n * @example\r\n * begin\r\n *\tnull;\r\n * end;\r\n * @see first_symbol\r\n * continued text\r\n * @example SELECT 1\r\n * FROM dual\r\n */';
		const doc = parseDocComment(raw);

		expect(doc?.raw).toBe(raw);
		expect(doc?.description).toBe('Overview.');
		expect(doc?.tags).toStrictEqual([
			{name: 'example', value: 'begin\n\tnull;\nend;'},
			{name: 'see', value: 'first_symbol\ncontinued text'},
			{name: 'example', value: 'SELECT 1\nFROM dual'},
		]);
	});

	it('preserves unknown tags and escaped line-leading at signs', () => {
		const doc = parseDocComment('/**\n * @example\n * \\@annotation\n * email@example.org\n * @custom first\n * second\n */');

		expect(doc?.tags).toStrictEqual([
			{name: 'example', value: '@annotation\nemail@example.org'},
			{name: 'custom', value: 'first\nsecond'},
		]);
	});
});
