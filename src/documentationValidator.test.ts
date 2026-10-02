import {describe, expect, it} from 'vitest';

import {findUndocumentedDeclarations} from './documentationValidator.js';
import {PLSqlDocScanner} from './scanner.js';

describe('findUndocumentedDeclarations', () => {
	it('reports missing declaration, field, attribute, parameter, and return documentation', () => {
		const source = `
CREATE PACKAGE missing_docs IS
	TYPE row_type IS RECORD (field_name VARCHAR2);
	CURSOR rows(p_limit NUMBER) IS SELECT 1 FROM dual;
	FUNCTION lookup(p_id NUMBER) RETURN VARCHAR2;
END missing_docs;
/
CREATE TYPE missing_type AS OBJECT (
	attribute_name NUMBER,
	MEMBER FUNCTION value(p_input NUMBER) RETURN NUMBER
);`;
		const sourceDoc = new PLSqlDocScanner(source, 'missing.sql').parseFile();
		const standaloneDoc = new PLSqlDocScanner('CREATE PROCEDURE standalone(p_value NUMBER);', 'routine.sql').parseFile();
		const warnings = findUndocumentedDeclarations({
			packages: sourceDoc.packages,
			routines: standaloneDoc.routines,
			types: sourceDoc.types,
			warnings: [],
		});

		expect(warnings).toStrictEqual(
			expect.arrayContaining([
				expect.stringContaining('Undocumented package missing_docs.'),
				expect.stringContaining('Undocumented field field_name in row_type.'),
				expect.stringContaining('Undocumented parameter p_limit in rows.'),
				expect.stringContaining('Undocumented parameter p_id in lookup.'),
				expect.stringContaining('Undocumented return value for function lookup.'),
				expect.stringContaining('Undocumented type missing_type.'),
				expect.stringContaining('Undocumented attribute attribute_name in missing_type.'),
				expect.stringContaining('Undocumented parameter p_input in value.'),
				expect.stringContaining('Undocumented procedure standalone.'),
			]),
		);
	});

	it('accepts a completely documented public surface', () => {
		const source = `
CREATE PACKAGE documented IS
	/** Package. */

	/** Record. */ TYPE row_type IS RECORD (/** Field. */ field_name VARCHAR2);
	/** Invalid session. */ INVALID_SESSION EXCEPTION;
	PRAGMA EXCEPTION_INIT(INVALID_SESSION, -20500);
	/**
	 * Lookup.
	 * @param p_id Identifier.
	 * @return Value.
	 */
	FUNCTION lookup(p_id NUMBER) RETURN VARCHAR2;
END documented;
/
CREATE TYPE documented_type
/** Type. */
AS OBJECT (
	/** Attribute. */ attribute_name NUMBER,
	/**
	 * Value.
	 * @param p_input Input.
	 * @return Result.
	 */
	MEMBER FUNCTION value(p_input NUMBER) RETURN NUMBER
);`;
		const sourceDoc = new PLSqlDocScanner(source).parseFile();

		expect(findUndocumentedDeclarations({...sourceDoc, warnings: []})).toStrictEqual([]);
	});

	it('accepts a documented procedure after a same-line conditional directive', () => {
		const source = `CREATE PACKAGE conditional_api IS
	/** Package. */

	/**
	 * Opens rows.
	 * @param p_rc Returned rows.
	 */
$if false $then PROCEDURE open_rows
	( p_rc OUT SYS_REFCURSOR );
$end
END conditional_api;`;
		const sourceDoc = new PLSqlDocScanner(source).parseFile();

		expect(findUndocumentedDeclarations({...sourceDoc, warnings: []})).toStrictEqual([]);
	});

	it('rejects duplicate and unknown routine tags', () => {
		const source = `CREATE PACKAGE invalid_tags IS
	/** Package. */

	/**
	 * Lookup.
	 * @param p_id Identifier.
	 * @param p_id Duplicate identifier.
	 * @param p_unknown Unknown parameter.
	 * @return Value.
	 * @return Duplicate value.
	 */
	FUNCTION lookup(p_id NUMBER) RETURN VARCHAR2;
END invalid_tags;`;
		const sourceDoc = new PLSqlDocScanner(source).parseFile();
		const warnings = findUndocumentedDeclarations({...sourceDoc, warnings: []});

		expect(warnings).toStrictEqual(
			expect.arrayContaining([
				expect.stringContaining('Duplicate @param documentation for p_id in lookup.'),
				expect.stringContaining('Unknown @param p_unknown in lookup.'),
				expect.stringContaining('Duplicate @return documentation for function lookup.'),
			]),
		);
	});
});
