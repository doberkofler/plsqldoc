import * as fs from 'node:fs/promises';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {isRoutineDoc} from './ast.js';
import {PLSqlDocScanner} from './scanner.js';

const fixtureDir = path.resolve('tests/fixtures');

describe('PLSqlDocScanner', () => {
	it('extracts package spec routines, params, and return docs', async () => {
		const filePath = path.join(fixtureDir, 'hr_api.pks');
		const source = await fs.readFile(filePath, 'utf8');
		const doc = new PLSqlDocScanner(source, filePath).parseFile();
		const [pkg] = doc.packages;

		expect(doc.packages).toHaveLength(1);
		expect(pkg.name).toBe('hr_api');
		expect(pkg.doc?.description).toContain('Public HR package');
		const routines = pkg.members.filter(isRoutineDoc);
		expect(routines.map((routine) => routine.name)).toStrictEqual(['save_employee', 'employee_label']);

		const [saveEmployee, label] = routines;
		expect(saveEmployee.parameters).toStrictEqual([
			expect.objectContaining({
				doc: 'Existing employee id. Null creates a new employee.',
				mode: 'IN OUT',
				name: 'p_employee_id',
				type: 'employees.employee_id%TYPE',
			}),
			expect.objectContaining({doc: 'Display name for the employee.', mode: 'IN', name: 'p_name', type: 'VARCHAR2'}),
			expect.objectContaining({defaultValue: '0', doc: 'Initial salary amount.', mode: 'IN', name: 'p_salary', type: 'NUMBER'}),
		]);
		expect(label.returnType).toBe('VARCHAR2');
		expect(label.returnDoc).toBe('Human readable employee label.');
	});

	it('does not expose package body implementation routines', async () => {
		const filePath = path.join(fixtureDir, 'hr_api.pkb');
		const source = await fs.readFile(filePath, 'utf8');
		const doc = new PLSqlDocScanner(source, filePath).parseFile();

		expect(doc.packages).toHaveLength(0);
		expect(doc.routines).toHaveLength(0);
	});

	it('extracts standalone routines with contiguous line docs', async () => {
		const filePath = path.join(fixtureDir, 'maintenance.sql');
		const source = await fs.readFile(filePath, 'utf8');
		const doc = new PLSqlDocScanner(source, filePath).parseFile();
		const [routine] = doc.routines;

		expect(doc.routines).toHaveLength(1);
		expect(routine).toStrictEqual(expect.objectContaining({kind: 'PROCEDURE', name: 'rebuild_indexes'}));
		expect(routine.doc?.description).toBe('Rebuilds all application indexes.');
		expect(routine.parameters[0]).toStrictEqual(expect.objectContaining({defaultValue: 'USER', doc: 'Schema owner to process.', name: 'p_owner'}));
	});

	it('stops line docs at section separators', () => {
		const source = `
CREATE OR REPLACE PACKAGE xml_api AS
	-------------------------------------------------------
	-- GLOBAL PUBLIC MODULES
	-------------------------------------------------------
	-- Get open/close tags
	--
	FUNCTION getTagOpen(theTag IN VARCHAR2) RETURN VARCHAR2;
END xml_api;
/`;
		const doc = new PLSqlDocScanner(source).parsePackage();
		const routine = doc.members.find(isRoutineDoc);
		if (routine === undefined) {
			throw new Error('Expected routine member.');
		}

		expect(routine.doc?.description).toBe('Get open/close tags');
	});

	it('does not treat an $Id$ metadata comment as declaration documentation', () => {
		const source = `CREATE PACKAGE metadata_api IS
-- $Id$
PROCEDURE run;
END metadata_api;`;
		const pkg = new PLSqlDocScanner(source).parsePackage();
		const [standalone] = new PLSqlDocScanner('CREATE PROCEDURE metadata_run; -- $Id$').parseFile().routines;

		expect(pkg.doc).toBeNull();
		expect(pkg.members.find(isRoutineDoc)?.doc).toBeNull();
		expect(standalone.doc).toBeNull();
	});

	it('uses trailing inline comments only for the same routine', () => {
		const source = `
CREATE OR REPLACE PACKAGE xml_api AS
	-- Get open tag
	FUNCTION getTagOpen(theTag IN VARCHAR2) RETURN VARCHAR2; -- Example: <Invoice>
	FUNCTION getTagClose(theTag IN VARCHAR2) RETURN VARCHAR2; -- Example: </Invoice>
	-- Get complete tag
	FUNCTION getTag(theTag IN VARCHAR2) RETURN VARCHAR2;
END xml_api;
/`;
		const doc = new PLSqlDocScanner(source).parsePackage();
		const [openTag, closeTag, tag] = doc.members.filter(isRoutineDoc);

		expect(openTag.doc?.description).toBe('Get open tag');
		expect(closeTag.doc?.description).toBe('Example: </Invoice>');
		expect(tag.doc?.description).toBe('Get complete tag');
	});

	it('handles canonical lexer identifiers and q-string delimiters', () => {
		const source = `
CREATE OR REPLACE PACKAGE "Unicode API" AS
	/**
	* Returns a JSON label.
	* @param p_json JSON text
	* @param p_text label text
	* @return JSON label
	*/
	FUNCTION json(
		p_json IN VARCHAR2 DEFAULT q'[a,b]',
		p_text IN VARCHAR2 DEFAULT q'Xdon't, failX'
	) RETURN VARCHAR2;
END "Unicode API";
/`;
		const doc = new PLSqlDocScanner(source).parsePackage();
		const routine = doc.members.find(isRoutineDoc);
		if (routine === undefined) {
			throw new Error('Expected routine member.');
		}

		expect(doc.name).toBe('"Unicode API"');
		expect(routine.name).toBe('json');
		expect(routine.parameters).toHaveLength(2);
		expect(routine.parameters[0]).toStrictEqual(expect.objectContaining({defaultValue: "q'[a,b]'", name: 'p_json'}));
		expect(routine.parameters[1]).toStrictEqual(expect.objectContaining({defaultValue: "q'Xdon't, failX'", name: 'p_text'}));
	});

	it('reports canonical lexer errors as scanner warnings', () => {
		const doc = new PLSqlDocScanner('⌘ CREATE OR REPLACE PACKAGE test_api AS END test_api;').parseFile();

		expect(doc.warnings).toStrictEqual([expect.stringContaining('<input>:1:0: token recognition error')]);
	});

	it('handles qualified declarations, modifiers, and parameter modes', () => {
		const source = `
CREATE OR REPLACE EDITIONABLE PACKAGE app.types_api AS
	PROCEDURE write_value(
		p_result OUT NOCOPY app.value_type,
		p_text IN VARCHAR2(100) := upper('text'),
		p_count NUMBER
	);
	FUNCTION read_values RETURN app.value_table PIPELINED;
	FUNCTION measure RETURN NUMBER(10, 2) DETERMINISTIC;
END app.types_api;
/`;
		const doc = new PLSqlDocScanner(source).parseFile();
		const [pkg] = doc.packages;
		const [writeValue, readValues, measure] = pkg.members.filter(isRoutineDoc);

		expect(pkg.name).toBe('app.types_api');
		expect(writeValue.parameters).toStrictEqual([
			expect.objectContaining({defaultValue: null, mode: 'OUT', name: 'p_result', type: 'app.value_type'}),
			expect.objectContaining({defaultValue: "upper('text')", mode: 'IN', name: 'p_text', type: 'VARCHAR2(100)'}),
			expect.objectContaining({defaultValue: null, mode: 'IN', name: 'p_count', type: 'NUMBER'}),
		]);
		expect(readValues).toStrictEqual(expect.objectContaining({returnType: 'app.value_table'}));
		expect(measure).toStrictEqual(expect.objectContaining({returnType: 'NUMBER(10,2)'}));
	});

	it('does not treat ordinary block comments as documentation', () => {
		const source = `
CREATE PACKAGE comments_api AS
	/* Implementation note, not API documentation. */
	PROCEDURE run;
END comments_api;
/`;
		const doc = new PLSqlDocScanner(source).parsePackage();

		expect(doc.members.find(isRoutineDoc)?.doc).toBeNull();
	});

	it('reports unreadable declarations and returns an unknown package fallback', () => {
		const doc = new PLSqlDocScanner('CREATE PACKAGE ; CREATE FUNCTION ;', 'broken.sql').parseFile();
		const fallback = new PLSqlDocScanner('', 'empty.sql').parsePackage();

		expect(doc.packages).toHaveLength(0);
		expect(doc.routines).toHaveLength(0);
		expect(doc.warnings).toStrictEqual(['broken.sql:1:7: Unable to read package name.', 'broken.sql:1:24: Unable to read function name.']);
		expect(fallback).toStrictEqual({
			declaration: '',
			doc: null,
			kind: 'PACKAGE',
			location: {column: 0, filePath: 'empty.sql', line: 0},
			members: [],
			name: 'UNKNOWN',
		});
	});

	it('extracts source-ordered package members without treating nested tokens as routines', () => {
		const source = `
/** Package docs. */
CREATE PACKAGE complete_api IS
	/** Status record. */
	TYPE status_record IS RECORD (
		/** Identifier. */ id NUMBER(10, 2),
		label VARCHAR2(100), -- Label text.
		created_at TIMESTAMP WITH TIME ZONE
	);
	TYPE names IS TABLE OF VARCHAR2(100) INDEX BY PLS_INTEGER;
	TYPE rows_cursor IS REF CURSOR RETURN app.rows%ROWTYPE;
	SUBTYPE identifier IS NUMBER(10);
	k_enabled CONSTANT BOOLEAN := CASE WHEN 1 = 1 THEN TRUE ELSE FALSE END;
	changed EXCEPTION;
	CURSOR active_rows(p_limit NUMBER DEFAULT greatest(1, 2)) RETURN app.rows%ROWTYPE IS SELECT * FROM app.rows;
	g_name VARCHAR2(100) := 'x';
	PROCEDURE run(p_at TIMESTAMP WITH TIME ZONE);
END complete_api;
/`;
		const pkg = new PLSqlDocScanner(source).parsePackage();

		expect(pkg.members.map((member) => member.kind)).toStrictEqual([
			'RECORD',
			'ASSOCIATIVE_ARRAY',
			'REF_CURSOR',
			'SUBTYPE',
			'CONSTANT',
			'EXCEPTION',
			'CURSOR',
			'VARIABLE',
			'PROCEDURE',
		]);
		const [record] = pkg.members;
		expect(record).toStrictEqual(expect.objectContaining({kind: 'RECORD'}));
		if (record.kind !== 'RECORD') {
			throw new Error('Expected record member.');
		}
		expect(record.fields.map((field) => [field.name, field.type, field.doc?.description])).toStrictEqual([
			['id', 'NUMBER(10,2)', 'Identifier.'],
			['label', 'VARCHAR2(100)', 'Label text.'],
			['created_at', 'TIMESTAMP WITH TIME ZONE', undefined],
		]);
		const routine = pkg.members.at(-1);
		expect(routine).toStrictEqual(expect.objectContaining({kind: 'PROCEDURE'}));
		if (routine?.kind !== 'PROCEDURE') {
			throw new Error('Expected procedure member.');
		}
		expect(routine.parameters[0]?.type).toBe('TIMESTAMP WITH TIME ZONE');
	});

	it('ignores package pragmas without hiding their associated declarations', () => {
		const source = `CREATE PACKAGE exception_api IS
	INVALID_SESSION EXCEPTION;
	PRAGMA EXCEPTION_INIT(INVALID_SESSION, -20500);
END exception_api;`;
		const doc = new PLSqlDocScanner(source).parseFile();
		const [pkg] = doc.packages;

		expect(pkg.members).toStrictEqual([expect.objectContaining({kind: 'EXCEPTION', name: 'INVALID_SESSION'})]);
		expect(doc.warnings).toStrictEqual([]);
	});

	it('attaches field comments with leading-comma formatting', () => {
		const source = `CREATE PACKAGE records_api IS
	TYPE row_type IS RECORD
	( first_value NUMBER -- First field.
	, second_value VARCHAR2(10) -- Second field.
	);
END records_api;`;
		const pkg = new PLSqlDocScanner(source).parsePackage();
		const [record] = pkg.members;
		if (record.kind !== 'RECORD') {
			throw new Error('Expected record member.');
		}

		expect(record.fields.map((field) => field.doc?.description)).toStrictEqual(['First field.', 'Second field.']);
	});

	it('extracts multiple top-level declarations and ignores bodies', () => {
		const source = `
CREATE TYPE BODY ignored_type AS MEMBER PROCEDURE run IS BEGIN NULL; END; END;
/
/** IDs. */ CREATE TYPE id_list AS TABLE OF NUMBER;
/
/** Worker. */ CREATE PROCEDURE run_job(p_id NUMBER) IS BEGIN NULL; END;
/
CREATE PACKAGE BODY ignored_package IS PROCEDURE hidden IS BEGIN NULL; END; END;
/
/** Public package. */ CREATE PACKAGE visible_package IS PROCEDURE run; END visible_package;
/`;
		const doc = new PLSqlDocScanner(source).parseFile();

		expect(doc.types).toStrictEqual([expect.objectContaining({kind: 'NESTED_TABLE', name: 'id_list'})]);
		expect(doc.routines).toStrictEqual([expect.objectContaining({name: 'run_job'})]);
		expect(doc.packages).toStrictEqual([expect.objectContaining({name: 'visible_package'})]);
	});

	it('extracts database-resident top-level documentation', () => {
		const source = `CREATE OR REPLACE PACKAGE stored_package IS
-- $Id$
/** Stored package documentation. */

/** Stored member documentation. */
PROCEDURE run;
END stored_package;
/
CREATE PROCEDURE stored_procedure
/** Stored procedure documentation. */
(p_value NUMBER) IS BEGIN NULL; END;
/
CREATE TYPE stored_values
/** Stored type documentation. */
AS TABLE OF NUMBER;`;
		const doc = new PLSqlDocScanner(source).parseFile();
		const [pkg] = doc.packages;
		const member = pkg.members.find(isRoutineDoc);

		expect(pkg.doc?.description).toBe('Stored package documentation.');
		expect(member?.doc?.description).toBe('Stored member documentation.');
		expect(doc.routines[0]?.doc?.description).toBe('Stored procedure documentation.');
		expect(doc.types[0]?.doc?.description).toBe('Stored type documentation.');
	});

	it('extracts object inheritance, attributes, and overloaded method forms', () => {
		const source = `
/** Employee object. */
CREATE OR REPLACE FORCE TYPE employee_type UNDER person_type (
	/** Salary. */ salary NUMBER(10, 2),
	/** Constructor. */ CONSTRUCTOR FUNCTION employee_type(p_name VARCHAR2) RETURN SELF AS RESULT,
	/** Setter. */ MEMBER PROCEDURE set_name(p_name VARCHAR2),
	/** First overload. */ MEMBER FUNCTION label RETURN VARCHAR2,
	/** Second overload. */ MEMBER FUNCTION label(p_format VARCHAR2) RETURN VARCHAR2,
	/** Factory. */ STATIC FUNCTION make RETURN employee_type,
	/** Mapping. */ MAP MEMBER FUNCTION sort_key RETURN NUMBER,
	/** Ordering. */ ORDER MEMBER FUNCTION compare(p_other employee_type) RETURN INTEGER
) NOT FINAL;`;
		const doc = new PLSqlDocScanner(source).parseFile();
		const [type] = doc.types;

		expect(type).toStrictEqual(expect.objectContaining({kind: 'OBJECT_TYPE', name: 'employee_type', supertype: 'person_type'}));
		if (type.kind !== 'OBJECT_TYPE') {
			throw new Error('Expected object type.');
		}
		const [attribute] = type.attributes;
		expect(attribute).toStrictEqual(expect.objectContaining({name: 'salary'}));
		expect(attribute.doc?.description).toBe('Salary.');
		expect(type.methods.map((method) => method.name)).toStrictEqual(['employee_type', 'set_name', 'label', 'label', 'make', 'sort_key', 'compare']);
		expect(type.methods[0]?.modifiers).toContain('CONSTRUCTOR');
		expect(type.methods[4]?.modifiers).toContain('STATIC');
	});

	it('accepts FORCE after a type name and SQL*Plus slash termination', () => {
		const source = `CREATE TYPE option_type FORCE IS OBJECT
(
	key VARCHAR2(256),
	val VARCHAR2(32767)
)
/
CREATE TYPE option_list FORCE IS TABLE OF option_type
/`;
		const doc = new PLSqlDocScanner(source).parseFile();

		expect(doc.types).toStrictEqual([
			expect.objectContaining({kind: 'OBJECT_TYPE', name: 'option_type'}),
			expect.objectContaining({kind: 'NESTED_TABLE', name: 'option_list'}),
		]);
		expect(doc.warnings).toStrictEqual([]);
	});

	it('ignores wrapped packages and preserves declarations inside conditional directives', () => {
		const source = `CREATE PACKAGE wrapped_api wrapped payload
/
CREATE PACKAGE conditional_api IS
$if false $then
	PROCEDURE conditional_run;
$end
	PROCEDURE regular_run;
END conditional_api;`;
		const doc = new PLSqlDocScanner(source).parseFile();

		expect(doc.packages).toHaveLength(1);
		expect(doc.packages[0].members.filter(isRoutineDoc).map((routine) => routine.name)).toStrictEqual(['conditional_run', 'regular_run']);
		expect(doc.warnings).toStrictEqual([]);
	});

	it('preserves a multiline procedure beginning after a same-line conditional directive', () => {
		const source = `CREATE PACKAGE conditional_api IS
	/**
	 * Opens rows.
	 * @param p_rc Returned rows.
	 */
$if false $then PROCEDURE open_rows
		( p_rc OUT SYS_REFCURSOR );
$end
END conditional_api;`;
		const doc = new PLSqlDocScanner(source).parseFile();
		const [pkg] = doc.packages;
		const {members} = pkg;

		expect(members).toStrictEqual([expect.objectContaining({kind: 'PROCEDURE', name: 'open_rows'})]);
		expect(members[0]).toStrictEqual(expect.objectContaining({parameters: [expect.objectContaining({name: 'p_rc'})]}));
		expect(doc.warnings).toStrictEqual([]);
	});

	it('warns for malformed recognized declarations with locations', () => {
		const source = 'CREATE PACKAGE broken IS TYPE row_type IS RECORD (id NUMBER; FUNCTION missing(; END broken;';
		const doc = new PLSqlDocScanner(source, 'broken.pks').parseFile();

		expect(doc.warnings).toStrictEqual(
			expect.arrayContaining([expect.stringContaining('broken.pks:1:'), expect.stringContaining('Unclosed record field list')]),
		);
	});

	it.each([
		['package missing AS', 'CREATE PACKAGE broken;'],
		['package missing END', 'CREATE PACKAGE broken IS PROCEDURE run;'],
		['unreadable package type', 'CREATE PACKAGE broken IS TYPE ; END broken;'],
		['package type missing IS', 'CREATE PACKAGE broken IS TYPE item NUMBER; END broken;'],
		['unsupported package type', 'CREATE PACKAGE broken IS TYPE item IS BOOLEAN; END broken;'],
		['collection missing OF', 'CREATE PACKAGE broken IS TYPE items IS TABLE NUMBER; END broken;'],
		['unclosed varray bound', 'CREATE PACKAGE broken IS TYPE items IS VARRAY(10 OF NUMBER; END broken;'],
		['unreadable subtype', 'CREATE PACKAGE broken IS SUBTYPE ; END broken;'],
		['subtype missing IS', 'CREATE PACKAGE broken IS SUBTYPE item NUMBER; END broken;'],
		['unreadable cursor', 'CREATE PACKAGE broken IS CURSOR ; END broken;'],
		['unclosed cursor parameters', 'CREATE PACKAGE broken IS CURSOR rows(p_id NUMBER; END broken;'],
		['unreadable parameter', 'CREATE PACKAGE broken IS PROCEDURE run(1 NUMBER); END broken;'],
		['unsupported package member', 'CREATE PACKAGE broken IS + invalid; END broken;'],
		['unreadable standalone type', 'CREATE TYPE ;'],
		['standalone type missing AS', 'CREATE TYPE broken NUMBER;'],
		['unsupported standalone type', 'CREATE TYPE broken AS BOOLEAN;'],
		['unreadable supertype', 'CREATE TYPE broken UNDER ;'],
		['object missing member list', 'CREATE TYPE broken AS OBJECT;'],
		['unclosed object member list', 'CREATE TYPE broken AS OBJECT(value NUMBER;'],
		['schema collection missing OF', 'CREATE TYPE broken AS TABLE NUMBER;'],
	])('recovers from malformed %s declarations', (_description, source) => {
		const doc = new PLSqlDocScanner(source, 'malformed.sql').parseFile();

		expect(doc.warnings.length + doc.packages.length + doc.types.length).toBeGreaterThan(0);
	});

	it.each(['CREATE TYPE broken AS TABLE OF NUMBER INDEX BY PLS_INTEGER;', 'CREATE TYPE BODY broken AS END;'])('ignores non-public type form %s', (source) => {
		const doc = new PLSqlDocScanner(source).parseFile();

		expect(doc.types).toStrictEqual([]);
	});
});
