import * as fs from 'node:fs/promises';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
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
		expect(pkg.routines.map((routine) => routine.name)).toStrictEqual(['save_employee', 'employee_label']);

		const [saveEmployee, label] = pkg.routines;
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
		const [routine] = doc.routines;

		expect(routine.doc?.description).toBe('Get open/close tags');
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
		const [openTag, closeTag, tag] = doc.routines;

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
		const [routine] = doc.routines;

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
		const [writeValue, readValues, measure] = pkg.routines;

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

		expect(doc.routines[0].doc).toBeNull();
	});

	it('reports unreadable declarations and returns an unknown package fallback', () => {
		const doc = new PLSqlDocScanner('CREATE PACKAGE ; CREATE FUNCTION ;', 'broken.sql').parseFile();
		const fallback = new PLSqlDocScanner('', 'empty.sql').parsePackage();

		expect(doc.packages).toHaveLength(0);
		expect(doc.routines).toHaveLength(0);
		expect(doc.warnings).toStrictEqual(['broken.sql:1:7: Unable to read package name.', 'broken.sql:1:24: Unable to read function name.']);
		expect(fallback).toStrictEqual({
			doc: null,
			location: {column: 0, filePath: 'empty.sql', line: 0},
			name: 'UNKNOWN',
			routines: [],
		});
	});
});
