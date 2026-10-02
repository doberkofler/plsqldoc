import {createHash} from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';

import Handlebars from 'handlebars';
import MarkdownIt from 'markdown-it';
import sanitizeHtml from 'sanitize-html';

import {
	type DocComment,
	type FieldDoc,
	isRoutineDoc,
	type ObjectTypeDoc,
	type PackageDoc,
	type PackageMemberDoc,
	type ParameterDoc,
	type ProjectDoc,
	type RoutineDoc,
	type SourceLocation,
	type StandaloneTypeDoc,
} from './ast.js';

export type GeneratorOptions = {
	readonly cleanOutput?: boolean;
	readonly outputDir: string;
};

type SeeView = {readonly href: string | null; readonly text: string};
type DocView = {readonly descriptionHtml: string; readonly examples: readonly string[]; readonly resources: readonly SeeView[]};
type ParameterView = ParameterDoc & {readonly docHtml: string};
type FieldView = FieldDoc & {readonly docHtml: string};
type MemberView = PackageMemberDoc &
	DocView & {
		readonly anchor: string;
		readonly fields?: readonly FieldView[];
		readonly parameters?: readonly ParameterView[];
		readonly returnDocHtml?: string;
	};
type NavigationGroup = {readonly kind: string; readonly members: readonly MemberView[]};
type PackageView = PackageDoc &
	DocView & {
		readonly counts: string;
		readonly fileName: string;
		readonly memberViews: readonly MemberView[];
		readonly navigationGroups: readonly NavigationGroup[];
	};
type TypeView = StandaloneTypeDoc &
	DocView & {
		readonly attributeViews: readonly (ObjectTypeDoc['attributes'][number] & DocView)[];
		readonly fileName: string;
		readonly methodViews: readonly MemberView[];
	};
type RoutineView = RoutineDoc & DocView & {readonly parameters: readonly ParameterView[]; readonly returnDocHtml: string};
type OutputTarget = {readonly fileName: string; readonly source: string};

const markdown = new MarkdownIt({html: false, linkify: false, typographer: false});
markdown.validateLink = (url: string): boolean => {
	try {
		const parsed = new URL(url);
		return parsed.protocol === 'http:' || parsed.protocol === 'https:';
	} catch {
		return false;
	}
};

const styles = `:root { --bg: #fff; --surface: #f6f8fa; --border: #d8dee4; --text: #1f2328; --muted: #59636e; --accent: #0969da; --badge: #ddf4ff; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); display: flex; min-height: 100vh; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
nav { width: 290px; flex: 0 0 auto; padding: 1.5rem; background: var(--surface); border-right: 1px solid var(--border); overflow-y: auto; }
nav h3 { margin-top: 1.5rem; color: var(--muted); font-size: .75rem; letter-spacing: .08em; text-transform: uppercase; }
nav ul, .cards, .warnings, .resources { margin: 0; padding: 0; list-style: none; }
nav a, .home { display: block; padding: .35rem .5rem; border-radius: 5px; color: var(--text); text-decoration: none; }
nav a:hover, nav a.active { background: #eaeef2; color: var(--accent); }
main { width: min(100%, 1100px); padding: 3rem 4rem; }
.index { margin: 0 auto; }
.cards li, .warnings li { margin: .75rem 0; padding: 1rem; border: 1px solid var(--border); border-radius: 8px; }
.cards a { color: var(--accent); font-weight: 700; text-decoration: none; }
.cards span { margin-left: .75rem; color: var(--muted); }
.badge { display: inline-block; padding: .2rem .5rem; border-radius: 4px; background: var(--badge); color: var(--accent); font-size: .7rem; font-weight: 700; text-transform: uppercase; }
.lead { font-size: 1.1rem; }
section { margin: 2.5rem 0; padding-bottom: 2rem; border-bottom: 1px solid var(--border); }
pre { overflow-x: auto; padding: 1rem; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); }
code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .9rem; }
table { width: 100%; margin-top: 1rem; border-collapse: collapse; font-size: .9rem; }
th, td { padding: .6rem .8rem; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; }
th { background: var(--surface); }
.meta { color: var(--muted); }
@media (max-width: 760px) { body { display: block; } nav { width: auto; border-right: 0; border-bottom: 1px solid var(--border); } main { padding: 1.5rem; } }`;

const indexTemplateSource = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>PL/SQL API Reference</title><style>{{> styles}}</style></head>
<body><main class="index"><h1>PL/SQL API Reference</h1>
{{#if packages.length}}<h2>Packages</h2><ul class="cards">{{#each packages}}<li><a href="{{fileName}}">{{name}}</a><span>{{counts}}</span></li>{{/each}}</ul>{{/if}}
{{#if types.length}}<h2>Standalone Types</h2><ul class="cards">{{#each types}}<li><a href="{{fileName}}">{{name}}</a><span>{{kind}}</span></li>{{/each}}</ul>{{/if}}
{{#if routines.length}}<h2>Standalone Routines</h2><ul class="cards">{{#each routines}}<li><code>{{declaration}}</code>{{#if descriptionHtml}}<div>{{{descriptionHtml}}}</div>{{/if}}</li>{{/each}}</ul>{{/if}}
{{#if warnings.length}}<h2>Warnings</h2><ul class="warnings">{{#each warnings}}<li>{{this}}</li>{{/each}}</ul>{{/if}}
</main></body></html>`;

const memberTemplateSource = `
<section id="{{anchor}}"><h3><span class="badge">{{kind}}</span> {{name}}</h3>
{{#if descriptionHtml}}<div>{{{descriptionHtml}}}</div>{{/if}}<pre><code>{{declaration}}</code></pre>
{{#if fields.length}}<h4>Fields</h4><table><thead><tr><th>Name</th><th>Type</th><th>Default</th><th>Description</th></tr></thead><tbody>{{#each fields}}<tr><td><code>{{name}}</code></td><td><code>{{type}}</code></td><td>{{#if defaultValue}}<code>{{defaultValue}}</code>{{else}}-{{/if}}</td><td>{{#if docHtml}}{{{docHtml}}}{{else}}-{{/if}}</td></tr>{{/each}}</tbody></table>{{/if}}
{{#if parameters.length}}<h4>Parameters</h4><table><thead><tr><th>Name</th><th>Mode</th><th>Type</th><th>Default</th><th>Description</th></tr></thead><tbody>{{#each parameters}}<tr><td><code>{{name}}</code></td><td>{{mode}}</td><td><code>{{type}}</code></td><td>{{#if defaultValue}}<code>{{defaultValue}}</code>{{else}}-{{/if}}</td><td>{{{docHtml}}}</td></tr>{{/each}}</tbody></table>{{/if}}
{{#if returnType}}<h4>Returns</h4><p><code>{{returnType}}</code>{{#if returnDocHtml}}: {{{returnDocHtml}}}{{/if}}</p>{{/if}}
{{#if elementType}}<dl><dt>Element type</dt><dd><code>{{elementType}}</code></dd>{{#if indexType}}<dt>Index type</dt><dd><code>{{indexType}}</code></dd>{{/if}}{{#if bound}}<dt>Bound</dt><dd><code>{{bound}}</code></dd>{{/if}}</dl>{{/if}}
{{#if baseType}}<p><strong>Base type:</strong> <code>{{baseType}}</code></p>{{/if}}{{#if type}}<p><strong>Type:</strong> <code>{{type}}</code></p>{{/if}}{{#if value}}<p><strong>Value:</strong> <code>{{value}}</code></p>{{/if}}
{{#if examples.length}}<h4>Examples</h4>{{#each examples}}<pre><code>{{this}}</code></pre>{{/each}}{{/if}}
{{#if resources.length}}<h4>See also</h4><ul class="resources">{{#each resources}}<li>{{#if href}}<a href="{{href}}">{{text}}</a>{{else}}{{text}}{{/if}}</li>{{/each}}</ul>{{/if}}</section>`;

const packageTemplateSource = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>{{pkg.name}} - PL/SQL API Reference</title><style>{{> styles}}</style></head>
<body><nav><a class="home" href="index.html">API Reference</a>{{#each pkg.navigationGroups}}<h3>{{kind}}</h3><ul>{{#each members}}<li><a href="#{{anchor}}">{{name}}</a></li>{{/each}}</ul>{{/each}}</nav>
<main><h1><span class="badge">Package</span> {{pkg.name}}</h1>{{#if pkg.descriptionHtml}}<div class="lead">{{{pkg.descriptionHtml}}}</div>{{/if}}
{{#if pkg.examples.length}}<h2>Examples</h2>{{#each pkg.examples}}<pre><code>{{this}}</code></pre>{{/each}}{{/if}}
{{#if pkg.resources.length}}<h2>See also</h2><ul class="resources">{{#each pkg.resources}}<li>{{#if href}}<a href="{{href}}">{{text}}</a>{{else}}{{text}}{{/if}}</li>{{/each}}</ul>{{/if}}
{{#each pkg.memberViews}}${memberTemplateSource}{{/each}}</main></body></html>`;

const typeTemplateSource = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>{{type.name}} - PL/SQL API Reference</title><style>{{> styles}}</style></head>
<body><nav><a class="home" href="index.html">API Reference</a><h3>Types</h3><ul>{{#each allTypes}}<li><a href="{{fileName}}" class="{{#if active}}active{{/if}}">{{name}}</a></li>{{/each}}</ul></nav>
<main><h1><span class="badge">{{type.kind}}</span> {{type.name}}</h1>{{#if type.descriptionHtml}}<div class="lead">{{{type.descriptionHtml}}}</div>{{/if}}<pre><code>{{type.declaration}}</code></pre>
{{#if type.supertype}}<p><strong>Under:</strong> <code>{{type.supertype}}</code></p>{{/if}}{{#if type.elementType}}<p><strong>Element type:</strong> <code>{{type.elementType}}</code></p>{{/if}}{{#if type.bound}}<p><strong>Bound:</strong> <code>{{type.bound}}</code></p>{{/if}}
{{#if type.attributeViews.length}}<h2>Attributes</h2>{{#each type.attributeViews}}<section><h3><span class="badge">Attribute</span> {{name}}</h3>{{#if descriptionHtml}}<div>{{{descriptionHtml}}}</div>{{/if}}<pre><code>{{declaration}}</code></pre></section>{{/each}}{{/if}}
{{#if type.methodViews.length}}<h2>Methods</h2>{{#each type.methodViews}}${memberTemplateSource}{{/each}}{{/if}}
{{#if type.examples.length}}<h2>Examples</h2>{{#each type.examples}}<pre><code>{{this}}</code></pre>{{/each}}{{/if}}
{{#if type.resources.length}}<h2>See also</h2><ul class="resources">{{#each type.resources}}<li>{{#if href}}<a href="{{href}}">{{text}}</a>{{else}}{{text}}{{/if}}</li>{{/each}}</ul>{{/if}}</main></body></html>`;

Handlebars.registerPartial('styles', styles);

const renderMarkdown = (value: string | null): string => {
	if (value === null || value.trim() === '') {
		return '';
	}
	return sanitizeHtml(markdown.render(value), {
		allowedAttributes: {a: ['href', 'title']},
		allowedSchemes: ['http', 'https'],
		allowedSchemesAppliedToAttributes: ['href'],
		allowedTags: ['a', 'blockquote', 'br', 'code', 'em', 'li', 'ol', 'p', 'pre', 'strong', 'ul'],
		allowProtocolRelative: false,
	});
};

const toDocView = (doc: DocComment | null): DocView => ({
	descriptionHtml: renderMarkdown(doc?.description ?? null),
	examples: doc?.tags.filter((tag): boolean => tag.name.toLowerCase() === 'example').map((tag): string => tag.value) ?? [],
	resources:
		doc?.tags
			.filter((tag): boolean => tag.name.toLowerCase() === 'see')
			.map((tag): SeeView => {
				try {
					const parsed = new URL(tag.value);
					const href: string | null = parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
					return {href, text: tag.value};
				} catch {
					return {href: null, text: tag.value};
				}
			}) ?? [],
});

const toParameterViews = (parameters: readonly ParameterDoc[]): ParameterView[] =>
	parameters.map((parameter: ParameterDoc): ParameterView => ({...parameter, docHtml: renderMarkdown(parameter.doc)}));

const stableAnchor = (member: PackageMemberDoc): string => {
	const digest: string = createHash('sha256').update(member.declaration).digest('hex').slice(0, 12);
	return `${encodeURIComponent(member.kind.toLowerCase())}-${encodeURIComponent(member.name)}-${digest}`;
};

const toMemberView = (member: PackageMemberDoc): MemberView => {
	const docView: DocView = toDocView(member.doc);
	if (isRoutineDoc(member)) {
		return {
			...member,
			...docView,
			anchor: stableAnchor(member),
			parameters: toParameterViews(member.parameters),
			returnDocHtml: renderMarkdown(member.returnDoc),
		};
	}
	if (member.kind === 'CURSOR') {
		return {...member, ...docView, anchor: stableAnchor(member), parameters: toParameterViews(member.parameters)};
	}
	if (member.kind === 'RECORD') {
		return {
			...member,
			...docView,
			anchor: stableAnchor(member),
			fields: member.fields.map((field: FieldDoc): FieldView => ({...field, docHtml: renderMarkdown(field.doc?.description ?? null)})),
		};
	}
	return {...member, ...docView, anchor: stableAnchor(member)};
};

const encodedFileName = (category: 'package' | 'type', name: string): string => `${category}-${encodeURIComponent(name)}.html`;

const toPackageView = (pkg: PackageDoc): PackageView => {
	const memberViews: MemberView[] = pkg.members.map(toMemberView);
	const grouped = new Map<string, MemberView[]>();
	for (const member of memberViews) {
		const members: MemberView[] = grouped.get(member.kind) ?? [];
		members.push(member);
		grouped.set(member.kind, members);
	}
	const countText: string = [...grouped.entries()]
		.map(([kind, members]: [string, MemberView[]]): string => `${members.length} ${kind.toLowerCase()}`)
		.join(', ');
	return {
		...pkg,
		...toDocView(pkg.doc),
		counts: countText || '0 members',
		fileName: encodedFileName('package', pkg.name),
		memberViews,
		navigationGroups: [...grouped.entries()].map(([kind, members]: [string, MemberView[]]): NavigationGroup => ({kind, members})),
	};
};

const toTypeView = (type: StandaloneTypeDoc): TypeView => ({
	...type,
	...toDocView(type.doc),
	attributeViews: type.kind === 'OBJECT_TYPE' ? type.attributes.map((attribute) => ({...attribute, ...toDocView(attribute.doc)})) : [],
	fileName: encodedFileName('type', type.name),
	methodViews: type.kind === 'OBJECT_TYPE' ? type.methods.map(toMemberView) : [],
});

const toRoutineView = (routine: RoutineDoc): RoutineView => ({
	...routine,
	...toDocView(routine.doc),
	parameters: toParameterViews(routine.parameters),
	returnDocHtml: renderMarkdown(routine.returnDoc),
});

const assertSafeOutputCleanPath = (resolvedPath: string): void => {
	if (resolvedPath === path.parse(resolvedPath).root) {
		throw new Error('Generator error: refusing to clean filesystem root.');
	}
};

const declarationSource = (category: 'package' | 'type', name: string, location: SourceLocation): string =>
	`${category} "${name}" at ${location.filePath ?? '<input>'}:${location.line}:${location.column}`;

const assertUniqueOutputPaths = (targets: readonly OutputTarget[]): void => {
	const seen = new Map<string, OutputTarget>();
	for (const target of targets) {
		const collisionKey: string = target.fileName.normalize('NFC').toLowerCase();
		const existing: OutputTarget | undefined = seen.get(collisionKey);
		if (existing !== undefined) {
			throw new Error(
				`Generator error: output filename collision for "${existing.fileName}": ${existing.source} and ${target.source} map to the same output path.`,
			);
		}
		seen.set(collisionKey, target);
	}
};

/**
 * Generates static HTML documentation for a parsed PL/SQL project.
 *
 * @param project Parsed project documentation.
 * @param options Output options.
 * @returns Promise resolved after every output file is written.
 */
export const generateHtmlDocs = async (project: ProjectDoc, options: GeneratorOptions): Promise<void> => {
	if (project.packages.length === 0 && project.types.length === 0 && project.routines.length === 0) {
		throw new Error('Generator error: documentation project cannot be empty.');
	}

	const packageViews: PackageView[] = project.packages.map(toPackageView);
	const typeViews: TypeView[] = project.types.map(toTypeView);
	const routineViews: RoutineView[] = project.routines.map(toRoutineView);
	assertUniqueOutputPaths([
		{fileName: 'index.html', source: 'project index'},
		...packageViews.map((pkg: PackageView): OutputTarget => ({fileName: pkg.fileName, source: declarationSource('package', pkg.name, pkg.location)})),
		...typeViews.map((type: TypeView): OutputTarget => ({fileName: type.fileName, source: declarationSource('type', type.name, type.location)})),
	]);

	const resolvedPath: string = path.resolve(options.outputDir);
	if (options.cleanOutput === true) {
		assertSafeOutputCleanPath(resolvedPath);
		await fs.rm(resolvedPath, {force: true, recursive: true});
	}
	await fs.mkdir(resolvedPath, {recursive: true});

	const packageTemplate = Handlebars.compile(packageTemplateSource);
	const typeTemplate = Handlebars.compile(typeTemplateSource);
	const indexTemplate = Handlebars.compile(indexTemplateSource);
	await Promise.all([
		...packageViews.map(async (pkg: PackageView): Promise<void> => {
			await fs.writeFile(path.join(resolvedPath, pkg.fileName), packageTemplate({pkg}), 'utf8');
		}),
		...typeViews.map(async (type: TypeView): Promise<void> => {
			const allTypes = typeViews.map((candidate: TypeView) => ({...candidate, active: candidate.fileName === type.fileName}));
			await fs.writeFile(path.join(resolvedPath, type.fileName), typeTemplate({allTypes, type}), 'utf8');
		}),
	]);
	await fs.writeFile(
		path.join(resolvedPath, 'index.html'),
		indexTemplate({packages: packageViews, routines: routineViews, types: typeViews, warnings: project.warnings}),
		'utf8',
	);
};
