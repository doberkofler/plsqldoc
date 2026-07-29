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
});
