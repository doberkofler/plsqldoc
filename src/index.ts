#!/usr/bin/env node
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {Command} from 'commander';
import {glob} from 'glob';
import {type PackageDoc, type ProjectDoc, type RoutineDoc, type SourceFileDoc, type StandaloneTypeDoc} from './ast.js';
import {findUndocumentedDeclarations} from './documentationValidator.js';
import {generateHtmlDocs} from './renderer.js';
import {PLSqlDocScanner} from './scanner.js';

declare const PACKAGE_VERSION: string;

const DEFAULT_EXTENSIONS = '.pks,.pkb,.pkg,.typ,.tyb,.tps,.tpb,.prc,.fnc';

type CliOptions = {
	readonly clean?: boolean;
	readonly exclude?: string[];
	readonly extensions: string;
	readonly failOnWarning?: boolean;
	readonly failOnUndocumented?: boolean;
	readonly out: string;
	readonly pattern?: string;
	readonly recursive?: boolean;
	readonly verbose?: boolean;
};

type ParsedProject = ProjectDoc & {
	readonly fileCount: number;
};

const extensionPattern = (extensionsText: string, recursive: boolean): string => {
	if (extensionsText.trim() === '') {
		throw new Error('Extension list must not be empty.');
	}

	const extensions = new Set<string>();
	for (const extensionText of extensionsText.split(',')) {
		const trimmed: string = extensionText.trim();
		const normalized: string = (trimmed.startsWith('.') ? trimmed.slice(1) : trimmed).toLowerCase();
		if (!/^[a-z0-9]+$/u.test(normalized)) {
			throw new Error(`Invalid source extension: ${trimmed || '<empty>'}`);
		}
		extensions.add(normalized);
	}

	const values: string[] = [...extensions];
	const filePattern: string = recursive ? '**/*' : '*';
	return values.length === 1 ? `${filePattern}.${values[0]}` : `${filePattern}.{${values.join(',')}}`;
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

const parseProject = async (directories: readonly string[], options: CliOptions): Promise<ParsedProject> => {
	const parsedDirectories = await Promise.all(
		directories.map(async (dir: string): Promise<ParsedProject> => {
			const absoluteDir: string = path.resolve(dir);
			await assertDirectory(absoluteDir);
			const sourcePattern: string = options.pattern ?? extensionPattern(options.extensions, options.recursive === true);

			const discoveredFiles: string[] = await glob(sourcePattern, {
				absolute: true,
				cwd: absoluteDir,
				ignore: options.exclude ?? [],
				nodir: true,
			});
			const matchedFiles: string[] = discoveredFiles.toSorted();

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
							const memberCount: number = sourceDoc.packages.reduce((total: number, pkg: PackageDoc): number => total + pkg.members.length, 0);
							console.log(
								`Parsed ${path.basename(filePath)}: ${sourceDoc.packages.length} package(s), ${memberCount} package member(s), ${sourceDoc.types.length} standalone type(s), ${sourceDoc.routines.length} standalone routine(s).`,
							);
						}

						return sourceDoc;
					} catch (error: unknown) {
						const msg: string = error instanceof Error ? error.message : String(error);
						return {filePath, packages: [], routines: [], types: [], warnings: [`${filePath}: ${msg}`]};
					}
				}),
			);

			return {
				fileCount: matchedFiles.length,
				packages: parsedFiles.flatMap((sourceDoc: SourceFileDoc): readonly PackageDoc[] => sourceDoc.packages),
				routines: parsedFiles.flatMap((sourceDoc: SourceFileDoc): readonly RoutineDoc[] => sourceDoc.routines),
				types: parsedFiles.flatMap((sourceDoc: SourceFileDoc): readonly StandaloneTypeDoc[] => sourceDoc.types),
				warnings: parsedFiles.flatMap((sourceDoc: SourceFileDoc): readonly string[] => sourceDoc.warnings),
			};
		}),
	);

	return {
		fileCount: parsedDirectories.reduce((total: number, project: ParsedProject): number => total + project.fileCount, 0),
		packages: parsedDirectories.flatMap((project: ParsedProject): readonly PackageDoc[] => project.packages),
		routines: parsedDirectories.flatMap((project: ParsedProject): readonly RoutineDoc[] => project.routines),
		types: parsedDirectories.flatMap((project: ParsedProject): readonly StandaloneTypeDoc[] => project.types),
		warnings: parsedDirectories.flatMap((project: ParsedProject): readonly string[] => project.warnings),
	};
};

const logSummary = (project: ParsedProject, warningCount: number, errorCount: number): void => {
	const packageMemberCount: number = project.packages.reduce((total: number, pkg: PackageDoc): number => total + pkg.members.length, 0);
	console.log(
		`Summary: ${project.fileCount} file(s), ${project.packages.length} package(s), ${packageMemberCount} package member(s), ${project.types.length} standalone type(s), ${project.routines.length} standalone routine(s), ${warningCount} warning(s), ${errorCount} error(s).`,
	);
};

const normalizeArgv = (argv: readonly string[]): string[] => {
	if (argv[2] === '--') {
		return [argv[0], argv[1], ...argv.slice(3)];
	}

	return [...argv];
};

/**
 * Runs the documentation CLI with an explicit argument vector.
 *
 * @param argv Node-style argument vector.
 * @returns Process exit code.
 */
export const runCli = async (argv: readonly string[]): Promise<number> => {
	const program = new Command();
	let exitCode = 0;

	program
		.name('pldoc')
		.description('Modern static documentation generator for Oracle PL/SQL codebases')
		.version(PACKAGE_VERSION)
		.argument('<directories...>', 'Target directories containing PL/SQL source files')
		.option('-o, --out <directory>', 'Output HTML directory path', './docs')
		.option('--extensions <extensions>', 'Comma-separated source extensions', DEFAULT_EXTENSIONS)
		.option('-p, --pattern <pattern>', 'Advanced source glob override; takes precedence over --extensions')
		.option('--clean', 'Clean the output directory before generating documentation')
		.option('--exclude <patterns...>', 'Glob pattern(s) to exclude from input discovery')
		.option('-r, --recursive', 'Recursively discover source files in subdirectories')
		.option('-v, --verbose', 'Enable verbose logging')
		.option('--fail-on-warning', 'Exit with failure if parse warnings are emitted')
		.option('--fail-on-undocumented', 'Exit with failure if public declarations are undocumented')
		.action(async (directories: string[], options: CliOptions) => {
			const project: ParsedProject = await parseProject(directories, options);
			const undocumentedWarnings: readonly string[] = options.failOnUndocumented === true ? findUndocumentedDeclarations(project) : [];
			const displayedWarnings: readonly string[] = [...project.warnings, ...undocumentedWarnings];
			if (displayedWarnings.length > 0) {
				for (const warning of displayedWarnings) {
					console.warn(`Warning: ${warning}`);
				}

				if (options.failOnUndocumented === true && undocumentedWarnings.length > 0) {
					exitCode = 1;
					logSummary(project, displayedWarnings.length, 0);
					return;
				}
				if (options.failOnWarning === true && project.warnings.length > 0) {
					exitCode = 1;
					logSummary(project, displayedWarnings.length, 0);
					return;
				}
			}

			if (project.packages.length === 0 && project.types.length === 0 && project.routines.length === 0) {
				console.warn('Warning: No valid PL/SQL API declarations found matching criteria.');
				logSummary(project, displayedWarnings.length + 1, 0);
				return;
			}

			const resolvedOutDir: string = path.resolve(options.out);
			let errorCount = 0;
			try {
				await generateHtmlDocs(project, {cleanOutput: options.clean, outputDir: resolvedOutDir});
				console.log(`Documentation successfully generated at: ${resolvedOutDir}`);
			} catch (error: unknown) {
				const msg: string = error instanceof Error ? error.message : String(error);
				console.error(`Error: ${msg}`);
				errorCount = 1;
				exitCode = 1;
			}
			logSummary(project, displayedWarnings.length, errorCount);
		});

	await program.parseAsync(normalizeArgv(argv));
	return exitCode;
};

const entryPath: string | undefined = process.argv.at(1);
if (entryPath !== undefined && import.meta.url === pathToFileURL(path.resolve(entryPath)).href) {
	try {
		process.exitCode = await runCli(process.argv);
	} catch (error: unknown) {
		const msg: string = error instanceof Error ? error.message : String(error);
		console.error(`Error: ${msg}`);
		process.exitCode = 1;
	}
}
