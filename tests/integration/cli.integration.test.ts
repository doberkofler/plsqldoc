import {spawnSync} from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import path from 'node:path';

import {afterEach, describe, expect, it} from 'vitest';

type ProcessResult = {
	readonly exitCode: number;
	readonly stderr: string;
	readonly stdout: string;
};

const temporaryDirectories: string[] = [];
const cliPath: string = path.resolve('dist/index.js');
const fixtureDirectory: string = path.resolve('tests/fixtures');

const makeTemporaryDirectory = async (prefix: string): Promise<string> => {
	const directory: string = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
	temporaryDirectories.push(directory);
	return directory;
};

const writeSources = async (directory: string, sources: Readonly<Record<string, string>>): Promise<void> => {
	await Promise.all(
		Object.entries(sources).map(async ([fileName, source]): Promise<void> => {
			await fs.writeFile(path.join(directory, fileName), source, 'utf8');
		}),
	);
};

const runBuiltCli = (arguments_: readonly string[]): ProcessResult => {
	const result = spawnSync(process.execPath, [cliPath, ...arguments_], {cwd: path.resolve('.'), encoding: 'utf8'});
	if (result.error !== undefined) {
		throw result.error;
	}
	return {exitCode: result.status ?? 1, stderr: result.stderr, stdout: result.stdout};
};

describe('built CLI', () => {
	afterEach(async () => {
		await Promise.all(
			temporaryDirectories.splice(0).map(async (directory: string): Promise<void> => {
				await fs.rm(directory, {force: true, recursive: true});
			}),
		);
	});

	it('renders the complete fixture project through the compiled executable', async () => {
		const outputDirectory: string = await makeTemporaryDirectory('plsqldoc-integration-output-');

		const result: ProcessResult = runBuiltCli([
			fixtureDirectory,
			'--out',
			outputDirectory,
			'--clean',
			'--extensions',
			'.sql,.pks,.pkb,.pkg,.typ,.tyb,.tps,.tpb,.prc,.fnc',
		]);

		expect(result).toStrictEqual(expect.objectContaining({exitCode: 0, stderr: ''}));
		expect(result.stdout).toContain('Documentation successfully generated');
		await expect(fs.readdir(outputDirectory)).resolves.toStrictEqual(
			expect.arrayContaining([
				'index.html',
				'package-complete_api.html',
				'package-hr_api.html',
				'type-employee_array.html',
				'type-employee_list.html',
				'type-employee_type.html',
			]),
		);

		const packageHtml: string = await fs.readFile(path.join(outputDirectory, 'package-complete_api.html'), 'utf8');
		for (const declarationKind of ['RECORD', 'ASSOCIATIVE_ARRAY', 'REF_CURSOR', 'SUBTYPE', 'CONSTANT', 'EXCEPTION', 'CURSOR', 'VARIABLE', 'PROCEDURE']) {
			expect(packageHtml).toContain(`>${declarationKind}<`);
		}
		expect(packageHtml).toContain('Demonstrates every supported package member category.');
		expect(packageHtml).toContain('complete_api.run;');
		expect(packageHtml).toContain('href="https://example.org/complete-api"');

		const objectHtml: string = await fs.readFile(path.join(outputDirectory, 'type-employee_type.html'), 'utf8');
		expect(objectHtml).toContain('Employee value with sortable labels.');
		expect(objectHtml).toContain('<strong>Under:</strong> <code>person_type</code>');
		expect(objectHtml.match(/id="function-label-[a-f0-9]+"/gu)).toHaveLength(2);

		const indexHtml: string = await fs.readFile(path.join(outputDirectory, 'index.html'), 'utf8');
		expect(indexHtml).toContain('employee_list');
		expect(indexHtml).toContain('employee_array');
		expect(indexHtml).toContain('rebuild_indexes');
		expect(indexHtml).not.toContain('hidden_helper');
	});

	it('renders an object-only project with sanitized Markdown, examples, resources, and overload anchors', async () => {
		const sourceDirectory: string = await makeTemporaryDirectory('plsqldoc-integration-object-source-');
		const outputDirectory: string = await makeTemporaryDirectory('plsqldoc-integration-object-output-');
		await writeSources(sourceDirectory, {
			'secure_type.tps': `create type secure_type
/**
 * **Safe** documentation <script>alert('x')</script>.
 * @example
 * <unsafe>&value
 * @see https://example.org/type
 * @see secure_symbol
 * @see javascript:alert(1)
 */
as object (
	/** Identifier. */ id number,
	/** First label. @return Label. */ member function label return varchar2,
	/** Second label. @param p_format Format. @return Label. */ member function label(p_format varchar2) return varchar2
);`,
		});

		const result: ProcessResult = runBuiltCli([sourceDirectory, '--out', outputDirectory]);

		expect(result.exitCode).toBe(0);
		const files: string[] = await fs.readdir(outputDirectory);
		expect(files).toStrictEqual(['index.html', 'type-secure_type.html']);
		const typeHtml: string = await fs.readFile(path.join(outputDirectory, 'type-secure_type.html'), 'utf8');
		expect(typeHtml).toContain("<strong>Safe</strong> documentation &lt;script&gt;alert('x')&lt;/script&gt;.");
		expect(typeHtml).toContain('&lt;unsafe&gt;&amp;value');
		expect(typeHtml).toContain('href="https://example.org/type"');
		expect(typeHtml).toContain('secure_symbol');
		expect(typeHtml).not.toContain('href="javascript:');
		expect(typeHtml.match(/id="function-label-[a-f0-9]+"/gu)).toHaveLength(2);
	});

	it('discovers every default extension, excludes SQL files, and excludes bodies by declaration syntax', async () => {
		const sourceDirectory: string = await makeTemporaryDirectory('plsqldoc-integration-extension-source-');
		const outputDirectory: string = await makeTemporaryDirectory('plsqldoc-integration-extension-output-');
		await writeSources(sourceDirectory, {
			'api.pks': 'create package pks_api is end pks_api;',
			'body.pkb': 'create package body hidden_package is end hidden_package;',
			'generic.pkg': 'create package pkg_api is end pkg_api;',
			'object.typ': 'create type typ_type as table of number;',
			'object-body.tyb': 'create type body hidden_type is end;',
			'object.tps': 'create type tps_type as object (value number);',
			'object-body.tpb': 'create type body hidden_type_two is end;',
			'procedure.prc': 'create procedure prc_run is begin null; end;',
			'function.fnc': 'create function fnc_run return number is begin return 1; end;',
			'multiple.sql': 'create type sql_table as table of number; create type sql_array as varray(3) of number;',
		});

		const result: ProcessResult = runBuiltCli([sourceDirectory, '--out', outputDirectory, '--verbose']);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain(`Directory [${sourceDirectory}]: Found 9 file(s).`);
		expect(result.stdout.trimEnd()).toMatch(
			/Summary: 9 file\(s\), 2 package\(s\), 0 package member\(s\), 2 standalone type\(s\), 2 standalone routine\(s\), 0 warning\(s\), 0 error\(s\)\.$/u,
		);
		await expect(fs.readdir(outputDirectory)).resolves.toStrictEqual(
			expect.arrayContaining(['index.html', 'package-pkg_api.html', 'package-pks_api.html', 'type-tps_type.html', 'type-typ_type.html']),
		);
		const indexHtml: string = await fs.readFile(path.join(outputDirectory, 'index.html'), 'utf8');
		expect(indexHtml).toContain('prc_run');
		expect(indexHtml).toContain('fnc_run');
		expect(indexHtml).not.toContain('hidden_package');
		expect(indexHtml).not.toContain('hidden_type');
	});

	it('overrides extensions and gives an explicit pattern precedence', async () => {
		const sourceDirectory: string = await makeTemporaryDirectory('plsqldoc-integration-custom-extension-source-');
		const extensionOutputDirectory: string = await makeTemporaryDirectory('plsqldoc-integration-custom-extension-output-');
		const patternOutputDirectory: string = await makeTemporaryDirectory('plsqldoc-integration-pattern-output-');
		await writeSources(sourceDirectory, {
			'included.custom': 'create package custom_api is end custom_api;',
			'ignored.sql': 'create package sql_api is end sql_api;',
		});

		const extensionResult: ProcessResult = runBuiltCli([sourceDirectory, '--out', extensionOutputDirectory, '--extensions', '.CUSTOM,custom']);
		const patternResult: ProcessResult = runBuiltCli([sourceDirectory, '--out', patternOutputDirectory, '--extensions', '.sql', '--pattern', '**/*.custom']);

		expect(extensionResult.exitCode).toBe(0);
		expect(patternResult.exitCode).toBe(0);
		await expect(fs.readdir(extensionOutputDirectory)).resolves.toStrictEqual(['index.html', 'package-custom_api.html']);
		await expect(fs.readdir(patternOutputDirectory)).resolves.toStrictEqual(['index.html', 'package-custom_api.html']);
	});

	it('requires recursive discovery to include nested source files', async () => {
		const sourceDirectory: string = await makeTemporaryDirectory('plsqldoc-integration-recursive-source-');
		const nestedDirectory: string = path.join(sourceDirectory, 'nested');
		const defaultOutputDirectory: string = await makeTemporaryDirectory('plsqldoc-integration-recursive-default-output-');
		const recursiveOutputDirectory: string = await makeTemporaryDirectory('plsqldoc-integration-recursive-output-');
		await fs.mkdir(nestedDirectory);
		await writeSources(sourceDirectory, {'root.pks': 'create package root_api is end root_api;'});
		await writeSources(nestedDirectory, {'nested.pks': 'create package nested_api is end nested_api;'});

		const defaultResult: ProcessResult = runBuiltCli([sourceDirectory, '--out', defaultOutputDirectory]);
		const recursiveResult: ProcessResult = runBuiltCli([sourceDirectory, '--out', recursiveOutputDirectory, '--recursive']);

		expect(defaultResult.exitCode).toBe(0);
		expect(recursiveResult.exitCode).toBe(0);
		await expect(fs.readdir(defaultOutputDirectory)).resolves.toStrictEqual(['index.html', 'package-root_api.html']);
		await expect(fs.readdir(recursiveOutputDirectory)).resolves.toStrictEqual(['index.html', 'package-nested_api.html', 'package-root_api.html']);
	});

	it('reports every undocumented public category and accepts a fully documented project', async () => {
		const sourceDirectory: string = await makeTemporaryDirectory('plsqldoc-integration-strict-source-');
		const outputDirectory: string = await makeTemporaryDirectory('plsqldoc-integration-strict-output-');
		const sourcePath: string = path.join(sourceDirectory, 'strict.sql');
		await fs.writeFile(
			sourcePath,
			`create package missing_docs is
	type row_type is record (field_name varchar2(10));
	function lookup(p_id number) return varchar2;
end missing_docs;
create type missing_type as object (attribute_name number);`,
			'utf8',
		);

		const failure: ProcessResult = runBuiltCli([sourceDirectory, '--out', outputDirectory, '--fail-on-undocumented', '--extensions', '.sql']);

		expect(failure.exitCode).toBe(1);
		for (const expectedMessage of [
			'Undocumented package missing_docs.',
			'Undocumented field field_name in row_type.',
			'Undocumented parameter p_id in lookup.',
			'Undocumented return value for function lookup.',
			'Undocumented type missing_type.',
			'Undocumented attribute attribute_name in missing_type.',
		]) {
			expect(failure.stderr).toContain(expectedMessage);
		}
		await expect(fs.readdir(outputDirectory)).resolves.toStrictEqual([]);

		await fs.writeFile(
			sourcePath,
			`create package documented is
/** Package documentation. */

/** Record documentation. */
type row_type is record (/** Field documentation. */ field_name varchar2(10));
/**
 * Lookup documentation.
 * @param p_id Identifier.
 * @return Value.
 */
function lookup(p_id number) return varchar2;
end documented;
create type documented_type
/** Type documentation. */
as object (/** Attribute documentation. */ attribute_name number);`,
			'utf8',
		);

		const success: ProcessResult = runBuiltCli([sourceDirectory, '--out', outputDirectory, '--fail-on-undocumented', '--extensions', '.sql']);

		expect(success.exitCode).toBe(0);
		await expect(fs.readFile(path.join(outputDirectory, 'index.html'), 'utf8')).resolves.toContain('documented_type');
	});

	it('fails on parser warnings without writing output', async () => {
		const sourceDirectory: string = await makeTemporaryDirectory('plsqldoc-integration-warning-source-');
		const outputDirectory: string = await makeTemporaryDirectory('plsqldoc-integration-warning-output-');
		await writeSources(sourceDirectory, {'warning.pks': '⌘ create package warning_api is end warning_api;'});

		const result: ProcessResult = runBuiltCli([sourceDirectory, '--out', outputDirectory, '--fail-on-warning']);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain('token recognition error');
		await expect(fs.readdir(outputDirectory)).resolves.toStrictEqual([]);
	});

	it('rejects duplicate output identities before cleaning existing output', async () => {
		const sourceDirectory: string = await makeTemporaryDirectory('plsqldoc-integration-collision-source-');
		const outputDirectory: string = await makeTemporaryDirectory('plsqldoc-integration-collision-output-');
		const stalePath: string = path.join(outputDirectory, 'stale.html');
		await writeSources(sourceDirectory, {
			'first.pks': 'create package duplicate is end duplicate;',
			'second.pks': 'create package DUPLICATE is end DUPLICATE;',
		});
		await fs.writeFile(stalePath, 'stale', 'utf8');

		const result: ProcessResult = runBuiltCli([sourceDirectory, '--out', outputDirectory, '--clean']);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain('Error: Generator error: output filename collision');
		expect(result.stderr).toContain('output filename collision');
		expect(result.stderr).toContain(path.join(sourceDirectory, 'first.pks'));
		expect(result.stderr).toContain(path.join(sourceDirectory, 'second.pks'));
		expect(result.stdout.trimEnd()).toMatch(
			/Summary: 2 file\(s\), 2 package\(s\), 0 package member\(s\), 0 standalone type\(s\), 0 standalone routine\(s\), 0 warning\(s\), 1 error\(s\)\.$/u,
		);
		await expect(fs.readFile(stalePath, 'utf8')).resolves.toBe('stale');
	});
});
