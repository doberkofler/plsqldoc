#!/usr/bin/env node
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {Command} from 'commander';
import {glob} from 'glob';
import {type PackageDoc, type ProjectDoc, type RoutineDoc, type SourceFileDoc} from './ast.js';
import {generateHtmlDocs} from './renderer.js';
import {PLSqlDocScanner} from './scanner.js';

type CliOptions = {
	readonly exclude?: string[];
	readonly failOnWarning?: boolean;
	readonly out: string;
	readonly pattern: string;
	readonly verbose?: boolean;
};

const assertDirectory = async (absoluteDir: string): Promise<void> => {
	try {
		const stats = await fs.stat(absoluteDir);
		if (!stats.isDirectory()) {
			throw new Error('path is not a directory');
		}
	} catch (error: unknown) {
		const msg: string = error instanceof Error ? error.message : String(error);
		throw new Error(`Directory access failed for "${absoluteDir}": ${msg}`, {cause: error});
	}
};

const parseProject = async (directories: readonly string[], options: CliOptions): Promise<ProjectDoc> => {
	const parsedDirectories = await Promise.all(
		directories.map(async (dir: string): Promise<ProjectDoc> => {
			const absoluteDir: string = path.resolve(dir);
			await assertDirectory(absoluteDir);

			const matchedFiles: string[] = await glob(options.pattern, {
				absolute: true,
				cwd: absoluteDir,
				ignore: options.exclude ?? [],
				nodir: true,
			});

			if (options.verbose === true) {
				console.log(`Directory [${dir}]: Found ${matchedFiles.length} file(s).`);
			}

			const parsedFiles = await Promise.all(
				matchedFiles.map(async (filePath: string): Promise<SourceFileDoc> => {
					try {
						const content: string = await fs.readFile(filePath, 'utf8');
						const scanner = new PLSqlDocScanner(content, filePath);
						const sourceDoc: SourceFileDoc = scanner.parseFile();

						if (options.verbose === true) {
							console.log(`Parsed ${path.basename(filePath)}: ${sourceDoc.packages.length} package(s), ${sourceDoc.routines.length} standalone routine(s).`);
						}

						return sourceDoc;
					} catch (error: unknown) {
						const msg: string = error instanceof Error ? error.message : String(error);
						return {filePath, packages: [], routines: [], warnings: [`${filePath}: ${msg}`]};
					}
				}),
			);

			return {
				packages: parsedFiles.flatMap((sourceDoc: SourceFileDoc): readonly PackageDoc[] => sourceDoc.packages),
				routines: parsedFiles.flatMap((sourceDoc: SourceFileDoc): readonly RoutineDoc[] => sourceDoc.routines),
				warnings: parsedFiles.flatMap((sourceDoc: SourceFileDoc): readonly string[] => sourceDoc.warnings),
			};
		}),
	);

	return {
		packages: parsedDirectories.flatMap((project: ProjectDoc): readonly PackageDoc[] => project.packages),
		routines: parsedDirectories.flatMap((project: ProjectDoc): readonly RoutineDoc[] => project.routines),
		warnings: parsedDirectories.flatMap((project: ProjectDoc): readonly string[] => project.warnings),
	};
};

const normalizeArgv = (argv: readonly string[]): string[] => {
	if (argv[2] === '--') {
		return [argv[0], argv[1], ...argv.slice(3)];
	}

	return [...argv];
};

const main = async (): Promise<void> => {
	const program = new Command();

	program
		.name('pldoc')
		.description('Modern static documentation generator for Oracle PL/SQL codebases')
		.version('0.1.0')
		.argument('<directories...>', 'Target directories containing PL/SQL source files')
		.option('-o, --out <directory>', 'Output HTML directory path', './docs')
		.option('-p, --pattern <pattern>', 'Glob pattern matching PL/SQL files', '**/*.{sql,pks,pkb}')
		.option('--exclude <patterns...>', 'Glob pattern(s) to exclude from input discovery')
		.option('-v, --verbose', 'Enable verbose logging')
		.option('--fail-on-warning', 'Exit with failure if parse warnings are emitted')
		.action(async (directories: string[], options: CliOptions) => {
			const project: ProjectDoc = await parseProject(directories, options);
			if (project.warnings.length > 0) {
				for (const warning of project.warnings) {
					console.warn(`Warning: ${warning}`);
				}

				if (options.failOnWarning === true) {
					process.exitCode = 1;
					return;
				}
			}

			if (project.packages.length === 0 && project.routines.length === 0) {
				console.warn('Warning: No valid PL/SQL API declarations found matching criteria.');
				return;
			}

			const resolvedOutDir: string = path.resolve(options.out);
			await generateHtmlDocs(project, {outputDir: resolvedOutDir});
			console.log(`Documentation successfully generated at: ${resolvedOutDir}`);
		});

	await program.parseAsync(normalizeArgv(process.argv));
};

try {
	await main();
} catch (error: unknown) {
	const msg: string = error instanceof Error ? error.message : String(error);
	console.error(`Fatal runtime exception: ${msg}`);
	process.exitCode = 1;
}
