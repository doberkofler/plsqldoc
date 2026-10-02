import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {type ProjectDoc} from './ast.js';
import {generateHtmlDocs} from './renderer.js';
import {PLSqlDocScanner} from './scanner.js';

describe('generateHtmlDocs', () => {
	it('renders package documentation and an index page', async () => {
		const sourcePath = path.resolve('tests/fixtures/hr_api.pks');
		const source = await fs.readFile(sourcePath, 'utf8');
		const sourceDoc = new PLSqlDocScanner(source, sourcePath).parseFile();
		const project: ProjectDoc = {packages: sourceDoc.packages, routines: sourceDoc.routines, types: sourceDoc.types, warnings: []};
		const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pldoc-ts-'));

		await generateHtmlDocs(project, {outputDir});

		const indexHtml = await fs.readFile(path.join(outputDir, 'index.html'), 'utf8');
		const packageHtml = await fs.readFile(path.join(outputDir, 'package-hr_api.html'), 'utf8');

		expect(indexHtml).toContain('PL/SQL API Reference');
		expect(packageHtml).toContain('PROCEDURE save_employee');
		expect(packageHtml).toContain('Human readable employee label.');
	});

	it('cleans the output directory before rendering when requested', async () => {
		const sourcePath = path.resolve('tests/fixtures/hr_api.pks');
		const source = await fs.readFile(sourcePath, 'utf8');
		const sourceDoc = new PLSqlDocScanner(source, sourcePath).parseFile();
		const project: ProjectDoc = {packages: sourceDoc.packages, routines: sourceDoc.routines, types: sourceDoc.types, warnings: []};
		const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pldoc-ts-'));
		const stalePath = path.join(outputDir, 'stale.html');
		await fs.writeFile(stalePath, 'stale', 'utf8');

		await generateHtmlDocs(project, {cleanOutput: true, outputDir});

		await expect(fs.access(stalePath)).rejects.toThrow('ENOENT');
		await expect(fs.readFile(path.join(outputDir, 'index.html'), 'utf8')).resolves.toContain('PL/SQL API Reference');
	});

	it('rejects an empty documentation project', async () => {
		const project: ProjectDoc = {packages: [], routines: [], types: [], warnings: []};

		await expect(generateHtmlDocs(project, {outputDir: os.tmpdir()})).rejects.toThrow('Generator error: documentation project cannot be empty.');
	});

	it('refuses to clean the filesystem root', async () => {
		const sourcePath = path.resolve('tests/fixtures/hr_api.pks');
		const source = await fs.readFile(sourcePath, 'utf8');
		const sourceDoc = new PLSqlDocScanner(source, sourcePath).parseFile();
		const project: ProjectDoc = {packages: sourceDoc.packages, routines: sourceDoc.routines, types: sourceDoc.types, warnings: []};
		const filesystemRoot: string = path.parse(process.cwd()).root;

		await expect(generateHtmlDocs(project, {cleanOutput: true, outputDir: filesystemRoot})).rejects.toThrow(
			'Generator error: refusing to clean filesystem root.',
		);
	});

	it('renders standalone object and collection types, escaped examples, resources, and unique overload anchors', async () => {
		const source = `
/**
 * **Object** docs <script>alert(1)</script>.
 * @example
 * <unsafe>&value
 * @see https://example.org/reference
 * @see javascript:alert(1)
	 * @see object_symbol
 */
CREATE TYPE object_type AS OBJECT (
	/** Attribute. */ value NUMBER,
	/** First. @return Label. */ MEMBER FUNCTION label RETURN VARCHAR2,
	/** Second. @param p_format Format. @return Label. */ MEMBER FUNCTION label(p_format VARCHAR2) RETURN VARCHAR2
);
/** Collection. */ CREATE TYPE object_list AS TABLE OF object_type;`;
		const sourceDoc = new PLSqlDocScanner(source).parseFile();
		const project: ProjectDoc = {...sourceDoc, warnings: ['sample warning']};
		const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pldoc-ts-types-'));

		await generateHtmlDocs(project, {outputDir});

		const indexHtml = await fs.readFile(path.join(outputDir, 'index.html'), 'utf8');
		const objectHtml = await fs.readFile(path.join(outputDir, 'type-object_type.html'), 'utf8');
		const collectionHtml = await fs.readFile(path.join(outputDir, 'type-object_list.html'), 'utf8');
		const anchorMatches: RegExpMatchArray[] = [...objectHtml.matchAll(/id="function-label-[a-f0-9]+"/gu)];
		expect(indexHtml).toContain('sample warning');
		expect(objectHtml).toContain('<strong>Object</strong> docs &lt;script&gt;alert(1)&lt;/script&gt;.');
		expect(objectHtml).toContain('&lt;unsafe&gt;&amp;value');
		expect(objectHtml).toContain('href="https://example.org/reference"');
		expect(objectHtml).not.toContain('href="javascript:');
		expect(new Set(anchorMatches.map((match: RegExpMatchArray): string => match[0])).size).toBe(2);
		expect(collectionHtml).toContain('object_type');
	});

	it('renders package member categories in source order', async () => {
		const source = `/** Package. */ CREATE PACKAGE members_api IS
		/** Constant. */ k_value CONSTANT NUMBER := 1;
		/** Rows. */ TYPE rows IS TABLE OF VARCHAR2(10);
		/** Run. */ PROCEDURE run;
	END members_api;`;
		const sourceDoc = new PLSqlDocScanner(source).parseFile();
		const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pldoc-ts-members-'));

		await generateHtmlDocs({...sourceDoc, warnings: []}, {outputDir});

		const packageHtml = await fs.readFile(path.join(outputDir, 'package-members_api.html'), 'utf8');
		expect(packageHtml.indexOf('k_value')).toBeLessThan(packageHtml.indexOf('rows'));
		expect(packageHtml.indexOf('rows')).toBeLessThan(packageHtml.indexOf('run'));
		expect(packageHtml).toContain('Element type');
	});

	it('preflights output collisions before cleaning or writing', async () => {
		const firstSourcePath: string = path.resolve('first.pks');
		const secondSourcePath: string = path.resolve('second.pks');
		const [first] = new PLSqlDocScanner('/** First. */ CREATE PACKAGE duplicate IS END duplicate;', firstSourcePath).parseFile().packages;
		const [second] = new PLSqlDocScanner('/** Second. */ CREATE PACKAGE DUPLICATE IS END DUPLICATE;', secondSourcePath).parseFile().packages;
		const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pldoc-ts-collision-'));
		const stalePath = path.join(outputDir, 'stale.html');
		await fs.writeFile(stalePath, 'stale', 'utf8');
		const project: ProjectDoc = {packages: [first, second], routines: [], types: [], warnings: []};

		await expect(generateHtmlDocs(project, {cleanOutput: true, outputDir})).rejects.toThrow(
			`output filename collision for "package-duplicate.html": package "duplicate" at ${firstSourcePath}:1:21 and package "DUPLICATE" at ${secondSourcePath}:1:22 map to the same output path`,
		);
		await expect(fs.readFile(stalePath, 'utf8')).resolves.toBe('stale');
	});
});
