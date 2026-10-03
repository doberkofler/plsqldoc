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

	it('reports an undocumented constant without a package exemption', () => {
		const source = `CREATE PACKAGE preferences IS
	/** Preferences. */

	k_default CONSTANT VARCHAR2(10) := 'default';
END preferences;`;
		const sourceDoc = new PLSqlDocScanner(source).parseFile();

		expect(findUndocumentedDeclarations({...sourceDoc, warnings: []})).toStrictEqual([expect.stringContaining('Undocumented constant k_default.')]);
	});

	it('case-insensitively exempts only constants through package documentation', () => {
		const source = `CREATE PACKAGE preferences IS
	/**
	 * Preferences.
	 * @PLSQLDOC-IGNORE-UNDOCUMENTED CONSTANT
	 * @plsqldoc-ignore-undocumented constant
	 */

	k_default CONSTANT VARCHAR2(10) := 'default';
	g_value VARCHAR2(10);
	/** @plsqldoc-ignore-undocumented constant */
	k_member_directive CONSTANT NUMBER := 1;
END preferences;`;
		const sourceDoc = new PLSqlDocScanner(source).parseFile();
		const warnings = findUndocumentedDeclarations({...sourceDoc, warnings: []});

		expect(warnings).toStrictEqual([expect.stringContaining('Undocumented variable g_value.')]);
		expect(sourceDoc.packages[0]?.members.map((member) => member.name)).toStrictEqual(['k_default', 'g_value', 'k_member_directive']);
	});

	it('reports each distinct invalid package exemption value once', () => {
		const source = `CREATE PACKAGE preferences IS
	/**
	 * Preferences.
	 * @plsqldoc-ignore-undocumented constant
	 * @plsqldoc-ignore-undocumented
	 * @plsqldoc-ignore-undocumented variable
	 * @plsqldoc-ignore-undocumented VARIABLE
	 */

	k_default CONSTANT VARCHAR2(10) := 'default';
END preferences;`;
		const sourceDoc = new PLSqlDocScanner(source).parseFile();
		const warnings = findUndocumentedDeclarations({...sourceDoc, warnings: []});

		expect(warnings).toHaveLength(2);
		expect(warnings).toStrictEqual(
			expect.arrayContaining([
				expect.stringContaining('Invalid @plsqldoc-ignore-undocumented value "<empty>" in package preferences.'),
				expect.stringContaining('Invalid @plsqldoc-ignore-undocumented value "variable" in package preferences.'),
			]),
		);
	});

	it('ignores the exemption directive outside package documentation', () => {
		const source = `CREATE PACKAGE preferences IS
	/** Preferences. */

	/** @plsqldoc-ignore-undocumented constant */
	k_default CONSTANT VARCHAR2(10) := 'default';
END preferences;`;
		const sourceDoc = new PLSqlDocScanner(source).parseFile();

		expect(findUndocumentedDeclarations({...sourceDoc, warnings: []})).toStrictEqual([expect.stringContaining('Undocumented constant k_default.')]);
	});
});
