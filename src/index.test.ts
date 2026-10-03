import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {runCli} from './index.js';

describe('runCli', () => {
	beforeEach(() => {
		vi.spyOn(console, 'log').mockReturnValue();
		vi.spyOn(console, 'warn').mockReturnValue();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('generates documentation from command-line arguments', async () => {
		const sourceDir: string = await fs.mkdtemp(path.join(os.tmpdir(), 'pldoc-cli-source-'));
		const outputDir: string = await fs.mkdtemp(path.join(os.tmpdir(), 'pldoc-cli-output-'));
		await fs.writeFile(path.join(sourceDir, 'sample.pks'), 'CREATE OR REPLACE PACKAGE sample_api AS PROCEDURE run; END sample_api; /', 'utf8');
		const log = vi.mocked(console.log);

		const exitCode: number = await runCli(['node', 'pldoc', '--', sourceDir, '--out', outputDir, '--verbose']);

		expect(exitCode).toBe(0);
		await expect(fs.readFile(path.join(outputDir, 'package-sample_api.html'), 'utf8')).resolves.toContain('PROCEDURE run');
		expect(log).toHaveBeenCalledWith(`Directory [${sourceDir}]: Found 1 file(s).`);
		expect(log).toHaveBeenCalledWith('Parsed sample.pks: 1 package(s), 1 package member(s), 0 standalone type(s), 0 standalone routine(s).');
		expect(log).toHaveBeenLastCalledWith(
			'Summary: 1 file(s), 1 package(s), 1 package member(s), 0 standalone type(s), 0 standalone routine(s), 0 warning(s), 0 error(s).',
		);
	});

	it('returns success with a warning when no declarations are found', async () => {
		const sourceDir: string = await fs.mkdtemp(path.join(os.tmpdir(), 'pldoc-cli-empty-'));
		const outputDir: string = path.join(sourceDir, 'docs');
		await fs.writeFile(path.join(sourceDir, 'empty.sql'), 'SELECT 1 FROM dual;', 'utf8');
		const log = vi.mocked(console.log);
		const warn = vi.mocked(console.warn);

		const exitCode: number = await runCli(['node', 'pldoc', sourceDir, '--out', outputDir]);

		expect(exitCode).toBe(0);
		expect(warn).toHaveBeenCalledWith('Warning: No valid PL/SQL API declarations found matching criteria.');
		expect(log).toHaveBeenLastCalledWith(
			'Summary: 0 file(s), 0 package(s), 0 package member(s), 0 standalone type(s), 0 standalone routine(s), 1 warning(s), 0 error(s).',
		);
		expect(log).not.toHaveBeenCalledWith(expect.stringContaining('Parsed '));
		await expect(fs.access(outputDir)).rejects.toThrow('ENOENT');
	});

	it('returns failure without rendering when fail-on-warning is enabled', async () => {
		const sourceDir: string = await fs.mkdtemp(path.join(os.tmpdir(), 'pldoc-cli-warning-'));
		const outputDir: string = path.join(sourceDir, 'docs');
		await fs.writeFile(path.join(sourceDir, 'warning.pks'), '⌘ CREATE OR REPLACE PACKAGE warning_api AS PROCEDURE run; END warning_api; /', 'utf8');
		const warn = vi.mocked(console.warn);

		const exitCode: number = await runCli(['node', 'pldoc', sourceDir, '--out', outputDir, '--fail-on-warning']);

		expect(exitCode).toBe(1);
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('token recognition error'));
		await expect(fs.access(outputDir)).rejects.toThrow('ENOENT');
	});

	it('fails on undocumented declarations only when strict documentation is requested', async () => {
		const sourceDir: string = await fs.mkdtemp(path.join(os.tmpdir(), 'pldoc-cli-undocumented-'));
		const outputDir: string = path.join(sourceDir, 'docs');
		await fs.writeFile(path.join(sourceDir, 'sample.pkg'), 'CREATE PACKAGE sample_api IS FUNCTION value(p_id NUMBER) RETURN NUMBER; END sample_api;', 'utf8');
		const warn = vi.mocked(console.warn);

		const defaultExitCode: number = await runCli(['node', 'pldoc', sourceDir, '--out', outputDir]);
		const strictExitCode: number = await runCli(['node', 'pldoc', sourceDir, '--out', outputDir, '--fail-on-undocumented']);
		await fs.writeFile(
			path.join(sourceDir, 'sample.pkg'),
			`/** Package. */ CREATE PACKAGE sample_api IS
/**
 * Value.
 * @param p_id Identifier.
 * @return Value.
 */
FUNCTION value(p_id NUMBER) RETURN NUMBER;
END sample_api;`,
			'utf8',
		);
		const documentedExitCode: number = await runCli(['node', 'pldoc', sourceDir, '--out', outputDir, '--fail-on-undocumented']);

		expect(defaultExitCode).toBe(0);
		expect(strictExitCode).toBe(1);
		expect(documentedExitCode).toBe(0);
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('Undocumented package sample_api.'));
	});

	it('renders exempt constants under strict documentation validation', async () => {
		const sourceDir: string = await fs.mkdtemp(path.join(os.tmpdir(), 'pldoc-cli-exempt-constant-source-'));
		const outputDir: string = path.join(sourceDir, 'docs');
		await fs.writeFile(
			path.join(sourceDir, 'preferences.pkg'),
			`CREATE PACKAGE preferences IS
/**
 * Preferences.
 * @PLSQLDOC-IGNORE-UNDOCUMENTED CONSTANT
 */

k_default CONSTANT VARCHAR2(10) := 'default';
END preferences;`,
			'utf8',
		);

		const exitCode: number = await runCli(['node', 'pldoc', sourceDir, '--out', outputDir, '--fail-on-undocumented']);

		expect(exitCode).toBe(0);
		await expect(fs.readFile(path.join(outputDir, 'package-preferences.html'), 'utf8')).resolves.toContain('k_default');
	});

	it('fails strict documentation validation for invalid exemption values', async () => {
		const sourceDir: string = await fs.mkdtemp(path.join(os.tmpdir(), 'pldoc-cli-invalid-exemption-source-'));
		const outputDir: string = path.join(sourceDir, 'docs');
		await fs.writeFile(
			path.join(sourceDir, 'preferences.pkg'),
			`CREATE PACKAGE preferences IS
/**
 * Preferences.
 * @plsqldoc-ignore-undocumented
 * @plsqldoc-ignore-undocumented variable
 */

/** Default. */
k_default CONSTANT VARCHAR2(10) := 'default';
END preferences;`,
			'utf8',
		);
		const warn = vi.mocked(console.warn);

		const exitCode: number = await runCli(['node', 'pldoc', sourceDir, '--out', outputDir, '--fail-on-undocumented']);

		expect(exitCode).toBe(1);
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('Invalid @plsqldoc-ignore-undocumented value "<empty>"'));
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('Invalid @plsqldoc-ignore-undocumented value "variable"'));
		await expect(fs.access(outputDir)).rejects.toThrow('ENOENT');
	});

	it('discovers default extensions while excluding SQL files and bodies by syntax', async () => {
		const sourceDir: string = await fs.mkdtemp(path.join(os.tmpdir(), 'pldoc-cli-extensions-'));
		const outputDir: string = path.join(sourceDir, 'docs');
		const files: Readonly<Record<string, string>> = {
			'api.pks': '/** P. */ CREATE PACKAGE pks_api IS END pks_api;',
			'body.pkb': 'CREATE PACKAGE BODY ignored_package IS END ignored_package;',
			'generic.pkg': '/** P. */ CREATE PACKAGE pkg_api IS END pkg_api;',
			'object.tps': '/** T. */ CREATE TYPE tps_type AS OBJECT (/** A. */ value NUMBER);',
			'object-body.tpb': 'CREATE TYPE BODY ignored_type AS END;',
			'object.typ': '/** T. */ CREATE TYPE typ_type AS TABLE OF NUMBER;',
			'object-body.tyb': 'CREATE TYPE BODY ignored_type_two AS END;',
			'procedure.prc': '/** P. */ CREATE PROCEDURE prc_run IS BEGIN NULL; END;',
			'function.fnc': '/** F. @return R. */ CREATE FUNCTION fnc_run RETURN NUMBER IS BEGIN RETURN 1; END;',
			'mixed.sql': '/** T. */ CREATE TYPE sql_type AS VARRAY(3) OF VARCHAR2(10);',
		};
		await Promise.all(
			Object.entries(files).map(async ([name, source]): Promise<void> => {
				await fs.writeFile(path.join(sourceDir, name), source, 'utf8');
			}),
		);
		const log = vi.mocked(console.log);

		const exitCode: number = await runCli(['node', 'pldoc', sourceDir, '--out', outputDir, '--verbose']);

		expect(exitCode).toBe(0);
		expect(log).toHaveBeenCalledWith(`Directory [${sourceDir}]: Found 9 file(s).`);
		await expect(fs.readdir(outputDir)).resolves.toStrictEqual(
			expect.arrayContaining(['index.html', 'package-pks_api.html', 'package-pkg_api.html', 'type-tps_type.html', 'type-typ_type.html']),
		);
		await expect(fs.access(path.join(outputDir, 'type-sql_type.html'))).rejects.toThrow('ENOENT');
	});

	it('replaces default extensions and lets an explicit pattern take precedence', async () => {
		const sourceDir: string = await fs.mkdtemp(path.join(os.tmpdir(), 'pldoc-cli-custom-extensions-'));
		const extensionOutputDir: string = path.join(sourceDir, 'extension-docs');
		const patternOutputDir: string = path.join(sourceDir, 'pattern-docs');
		await fs.writeFile(path.join(sourceDir, 'included.custom'), 'CREATE PACKAGE custom_api IS END custom_api;', 'utf8');
		await fs.writeFile(path.join(sourceDir, 'ignored.sql'), 'CREATE PACKAGE sql_api IS END sql_api;', 'utf8');
		const log = vi.mocked(console.log);

		const extensionExitCode: number = await runCli(['node', 'pldoc', sourceDir, '--out', extensionOutputDir, '--extensions', ' .CUSTOM,custom ', '--verbose']);
		const patternExitCode: number = await runCli(['node', 'pldoc', sourceDir, '--out', patternOutputDir, '--extensions', '.sql', '--pattern', '**/*.custom']);

		expect(extensionExitCode).toBe(0);
		expect(patternExitCode).toBe(0);
		expect(log).toHaveBeenCalledWith(`Directory [${sourceDir}]: Found 1 file(s).`);
		await expect(fs.readdir(extensionOutputDir)).resolves.toStrictEqual(['index.html', 'package-custom_api.html']);
		await expect(fs.readdir(patternOutputDir)).resolves.toStrictEqual(['index.html', 'package-custom_api.html']);
	});

	it('discovers nested source files only when recursive discovery is requested', async () => {
		const sourceDir: string = await fs.mkdtemp(path.join(os.tmpdir(), 'pldoc-cli-recursive-'));
		const nestedDir: string = path.join(sourceDir, 'nested');
		const defaultOutputDir: string = path.join(sourceDir, 'default-docs');
		const recursiveOutputDir: string = path.join(sourceDir, 'recursive-docs');
		await fs.mkdir(nestedDir);
		await fs.writeFile(path.join(sourceDir, 'root.pks'), 'CREATE PACKAGE root_api IS END root_api;', 'utf8');
		await fs.writeFile(path.join(nestedDir, 'nested.pks'), 'CREATE PACKAGE nested_api IS END nested_api;', 'utf8');

		const defaultExitCode: number = await runCli(['node', 'pldoc', sourceDir, '--out', defaultOutputDir]);
		const recursiveExitCode: number = await runCli(['node', 'pldoc', sourceDir, '--out', recursiveOutputDir, '--recursive']);

		expect(defaultExitCode).toBe(0);
		expect(recursiveExitCode).toBe(0);
		await expect(fs.readdir(defaultOutputDir)).resolves.toStrictEqual(['index.html', 'package-root_api.html']);
		await expect(fs.readdir(recursiveOutputDir)).resolves.toStrictEqual(['index.html', 'package-nested_api.html', 'package-root_api.html']);
	});

	it('rejects empty and malformed extension lists', async () => {
		const sourceDir: string = await fs.mkdtemp(path.join(os.tmpdir(), 'pldoc-cli-invalid-extensions-'));

		await expect(runCli(['node', 'pldoc', sourceDir, '--extensions', ''])).rejects.toThrow('Extension list must not be empty.');
		await expect(runCli(['node', 'pldoc', sourceDir, '--extensions', '.sql,../secret'])).rejects.toThrow('Invalid source extension: ../secret');
	});

	it('rejects inaccessible input directories', async () => {
		const parentDirectory: string = await fs.mkdtemp(path.join(os.tmpdir(), 'pldoc-cli-missing-'));
		const missingDirectory: string = path.join(parentDirectory, 'missing');
		const filePath: string = path.join(parentDirectory, 'file.sql');
		await fs.writeFile(filePath, '', 'utf8');

		await expect(runCli(['node', 'pldoc', missingDirectory])).rejects.toThrow(`Directory access failed for "${missingDirectory}"`);
		await expect(runCli(['node', 'pldoc', filePath])).rejects.toThrow(`Directory access failed for "${filePath}": path is not a directory`);
	});
});
