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
		const project: ProjectDoc = {packages: sourceDoc.packages, routines: sourceDoc.routines, warnings: []};
		const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pldoc-ts-'));

		await generateHtmlDocs(project, {outputDir});

		const indexHtml = await fs.readFile(path.join(outputDir, 'index.html'), 'utf8');
		const packageHtml = await fs.readFile(path.join(outputDir, 'hr_api.html'), 'utf8');

		expect(indexHtml).toContain('PL/SQL API Reference');
		expect(packageHtml).toContain('PROCEDURE save_employee');
		expect(packageHtml).toContain('Human readable employee label.');
	});
});
