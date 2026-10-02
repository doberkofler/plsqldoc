import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import path from 'node:path';

import {afterEach, describe, expect, it, vi} from 'vitest';

import {runCli} from './index.js';

describe('runCli', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('generates documentation from command-line arguments', async () => {
		const sourceDir: string = await fs.mkdtemp(path.join(os.tmpdir(), 'pldoc-cli-source-'));
		const outputDir: string = await fs.mkdtemp(path.join(os.tmpdir(), 'pldoc-cli-output-'));
		await fs.writeFile(path.join(sourceDir, 'sample.pks'), 'CREATE OR REPLACE PACKAGE sample_api AS PROCEDURE run; END sample_api; /', 'utf8');
		const log = vi.spyOn(console, 'log').mockReturnValue();

		const exitCode: number = await runCli(['node', 'pldoc', '--', sourceDir, '--out', outputDir, '--verbose']);

		expect(exitCode).toBe(0);
		await expect(fs.readFile(path.join(outputDir, 'sample_api.html'), 'utf8')).resolves.toContain('PROCEDURE run');
		expect(log).toHaveBeenCalledWith(`Directory [${sourceDir}]: Found 1 file(s).`);
		expect(log).toHaveBeenCalledWith('Parsed sample.pks: 1 package(s), 0 standalone routine(s).');
	});

	it('returns success with a warning when no declarations are found', async () => {
		const sourceDir: string = await fs.mkdtemp(path.join(os.tmpdir(), 'pldoc-cli-empty-'));
		const outputDir: string = path.join(sourceDir, 'docs');
		await fs.writeFile(path.join(sourceDir, 'empty.sql'), 'SELECT 1 FROM dual;', 'utf8');
		const warn = vi.spyOn(console, 'warn').mockReturnValue();

		const exitCode: number = await runCli(['node', 'pldoc', sourceDir, '--out', outputDir]);

		expect(exitCode).toBe(0);
		expect(warn).toHaveBeenCalledWith('Warning: No valid PL/SQL API declarations found matching criteria.');
		await expect(fs.access(outputDir)).rejects.toThrow('ENOENT');
	});

	it('returns failure without rendering when fail-on-warning is enabled', async () => {
		const sourceDir: string = await fs.mkdtemp(path.join(os.tmpdir(), 'pldoc-cli-warning-'));
		const outputDir: string = path.join(sourceDir, 'docs');
		await fs.writeFile(path.join(sourceDir, 'warning.pks'), '⌘ CREATE OR REPLACE PACKAGE warning_api AS PROCEDURE run; END warning_api; /', 'utf8');
		const warn = vi.spyOn(console, 'warn').mockReturnValue();

		const exitCode: number = await runCli(['node', 'pldoc', sourceDir, '--out', outputDir, '--fail-on-warning']);

		expect(exitCode).toBe(1);
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('token recognition error'));
		await expect(fs.access(outputDir)).rejects.toThrow('ENOENT');
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
