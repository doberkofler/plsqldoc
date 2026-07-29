import * as fs from 'node:fs/promises';
import path from 'node:path';
import Handlebars from 'handlebars';
import {type PackageDoc, type ProjectDoc, type RoutineDoc} from './ast.js';

export type GeneratorOptions = {
	readonly outputDir: string;
};

type RoutineView = RoutineDoc & {
	readonly signature: string;
};

type PackageView = PackageDoc & {
	readonly fileName: string;
	readonly routines: readonly RoutineView[];
};

const indexTemplateSource = `
<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>PL/SQL API Reference</title>
	<style>{{> styles}}</style>
</head>
<body>
	<main class="index">
		<h1>PL/SQL API Reference</h1>
		{{#if packages.length}}
			<h2>Packages</h2>
			<ul class="cards">
				{{#each packages}}
					<li><a href="{{this.fileName}}">{{this.name}}</a><span>{{this.routines.length}} routine(s)</span></li>
				{{/each}}
			</ul>
		{{/if}}
		{{#if standaloneRoutines.length}}
			<h2>Standalone Routines</h2>
			<ul class="cards">
				{{#each standaloneRoutines}}
					<li><code>{{this.signature}}</code></li>
				{{/each}}
			</ul>
		{{/if}}
		{{#if warnings.length}}
			<h2>Warnings</h2>
			<ul class="warnings">
				{{#each warnings}}<li>{{this}}</li>{{/each}}
			</ul>
		{{/if}}
	</main>
</body>
</html>
`;

const templateSource = `
<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>{{pkg.name}} - PL/SQL API Reference</title>
	<style>{{> styles}}</style>
</head>
<body>
	<nav>
		<a class="home" href="index.html">API Reference</a>
		<h3>Packages</h3>
		<ul>
			{{#each allPackages}}
				<li><a href="{{this.fileName}}" {{#if (eq this.name ../pkg.name)}}class="active"{{/if}}>{{this.name}}</a></li>
			{{/each}}
		</ul>
	</nav>
	<main>
		<h1><span class="badge">Package</span> {{pkg.name}}</h1>
		{{#if pkg.doc.description}}<p class="lead">{{pkg.doc.description}}</p>{{/if}}
		<h2>Routines</h2>
		{{#each pkg.routines}}
			<section id="{{this.name}}">
				<h3><span class="badge">{{this.kind}}</span> {{this.name}}</h3>
				{{#if this.doc.description}}<p>{{this.doc.description}}</p>{{/if}}
				<pre class="signature"><code>{{this.signature}}</code></pre>
				{{#if this.parameters.length}}
					<h4>Parameters</h4>
					<table>
						<thead><tr><th>Name</th><th>Mode</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
						<tbody>
							{{#each this.parameters}}
								<tr><td><code>{{this.name}}</code></td><td>{{this.mode}}</td><td><code>{{this.type}}</code></td><td>{{#if this.defaultValue}}<code>{{this.defaultValue}}</code>{{else}}-{{/if}}</td><td>{{#if this.doc}}{{this.doc}}{{else}}-{{/if}}</td></tr>
							{{/each}}
						</tbody>
					</table>
				{{/if}}
				{{#if this.returnDoc}}<h4>Returns</h4><p>{{this.returnDoc}}</p>{{/if}}
			</section>
		{{/each}}
	</main>
</body>
</html>
`;

Handlebars.registerPartial(
	'styles',
	`:root { --bg: #ffffff; --sidebar-bg: #f8f9fa; --border: #e9ecef; --text: #212529; --accent: #0969da; }
body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: var(--text); display: flex; min-height: 100vh; }
nav { width: 280px; background: var(--sidebar-bg); border-right: 1px solid var(--border); padding: 1.5rem; overflow-y: auto; box-sizing: border-box; }
nav h3 { font-size: 0.9rem; text-transform: uppercase; letter-spacing: 0.05em; color: #6c757d; }
nav ul, .cards, .warnings { list-style: none; padding: 0; margin: 0; }
nav li a, .home { display: block; padding: 0.4rem 0.6rem; color: var(--text); text-decoration: none; border-radius: 4px; }
nav li a:hover, nav li a.active { background: #e9ecef; color: var(--accent); }
main { flex: 1; padding: 2.5rem 4rem; overflow-y: auto; }
.index { max-width: 980px; }
.cards li, .warnings li { border: 1px solid var(--border); border-radius: 8px; padding: 1rem; margin: 0.75rem 0; }
.cards a { color: var(--accent); font-weight: 700; text-decoration: none; }
.cards span { color: #6c757d; margin-left: 0.75rem; }
.badge { font-size: 0.75rem; font-weight: 600; padding: 0.2rem 0.5rem; border-radius: 4px; text-transform: uppercase; background: #ddf4ff; color: #0969da; }
.lead { font-size: 1.1rem; }
.signature { background: #f6f8fa; padding: 1rem; border-radius: 6px; border: 1px solid var(--border); overflow-x: auto; }
code, .signature { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9rem; }
table { width: 100%; border-collapse: collapse; margin-top: 1rem; font-size: 0.9rem; }
th, td { text-align: left; padding: 0.6rem 0.8rem; border-bottom: 1px solid var(--border); vertical-align: top; }
th { background: var(--sidebar-bg); font-weight: 600; }
section { margin-bottom: 3rem; border-bottom: 1px solid var(--border); padding-bottom: 2rem; }
@media (max-width: 760px) { body { display: block; } nav { width: auto; border-right: 0; border-bottom: 1px solid var(--border); } main { padding: 1.5rem; } }`,
);

const formatRoutineSignature = (routine: RoutineDoc): string => {
	const params: string = routine.parameters
		.map((parameter): string => {
			const defaultValue: string = parameter.defaultValue === null ? '' : ` DEFAULT ${parameter.defaultValue}`;
			return `${parameter.name} ${parameter.mode} ${parameter.type}${defaultValue}`;
		})
		.join(', ');
	const returns: string = routine.returnType === null ? '' : ` RETURN ${routine.returnType}`;
	return `${routine.kind} ${routine.name}(${params})${returns};`;
};

const toRoutineView = (routine: RoutineDoc): RoutineView => ({...routine, signature: formatRoutineSignature(routine)});

const safeFileName = (name: string): string => name.replaceAll(/[^\w.-]/gu, '_');

/**
 * Generates static HTML documentation for a parsed PL/SQL project.
 *
 * @param project Parsed project documentation model.
 * @param options Renderer options.
 */
export const generateHtmlDocs = async (project: ProjectDoc, options: GeneratorOptions): Promise<void> => {
	if (project.packages.length === 0 && project.routines.length === 0) {
		throw new Error('Generator error: documentation project cannot be empty.');
	}

	Handlebars.registerHelper('eq', (a: unknown, b: unknown): boolean => a === b);

	const packageTemplate = Handlebars.compile(templateSource);
	const indexTemplate = Handlebars.compile(indexTemplateSource);
	const resolvedPath: string = path.resolve(options.outputDir);
	await fs.mkdir(resolvedPath, {recursive: true});

	const packageViews: PackageView[] = project.packages.map(
		(pkg: PackageDoc): PackageView => ({
			...pkg,
			fileName: `${safeFileName(pkg.name)}.html`,
			routines: pkg.routines.map(toRoutineView),
		}),
	);
	const standaloneRoutines: RoutineView[] = project.routines.map(toRoutineView);

	await Promise.all(
		packageViews.map(async (pkg: PackageView): Promise<void> => {
			const renderedHtml: string = packageTemplate({allPackages: packageViews, pkg, standaloneRoutines});
			await fs.writeFile(path.join(resolvedPath, pkg.fileName), renderedHtml, 'utf8');
		}),
	);

	await fs.writeFile(path.join(resolvedPath, 'index.html'), indexTemplate({packages: packageViews, standaloneRoutines, warnings: project.warnings}), 'utf8');
};
