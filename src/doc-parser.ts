import {type DocComment, type DocTag} from './ast.js';

/**
 * Parses a PLDoc/Javadoc-style comment into description text and ordered tags.
 *
 * @param commentText Raw lexer comment text.
 * @returns Parsed documentation comment, or null for null input.
 */
export const parseDocComment = (commentText: string | null): DocComment | null => {
	if (commentText === null) {
		return null;
	}

	const cleaned: string = commentText
		.replaceAll(/^\/\*\*|\*\/$/gu, '')
		.replaceAll(/^\s*--\s?/gmu, '')
		.replaceAll(/^\s*\*\s?/gmu, '')
		.trim();

	const descriptionLines: string[] = [];
	const tags: DocTag[] = [];

	for (const line of cleaned.split('\n')) {
		const trimmedLine: string = line.trimStart();
		if (trimmedLine.startsWith('@')) {
			const tagText: string = trimmedLine.slice(1);
			const separatorIndex: number = tagText.search(/\s/u);
			const name: string = separatorIndex < 0 ? tagText : tagText.slice(0, separatorIndex);
			const value: string = separatorIndex < 0 ? '' : tagText.slice(separatorIndex + 1).trim();
			tags.push({name, value});
			continue;
		}

		descriptionLines.push(line);
	}

	return {
		description: descriptionLines.join('\n').trim(),
		raw: commentText,
		tags,
	};
};

/**
 * Finds the first return tag value for a routine doc block.
 *
 * @param doc Routine documentation.
 * @returns Return documentation text, or null when absent.
 */
export const findReturnDoc = (doc: DocComment | null): string | null =>
	doc?.tags.find((tag: DocTag): boolean => tag.name.toLowerCase() === 'return')?.value ?? null;

/**
 * Finds documentation for a named routine parameter.
 *
 * @param doc Routine documentation.
 * @param parameterName Parameter name to match against @param tags.
 * @returns Parameter documentation text, or null when absent.
 */
export const findParamDoc = (doc: DocComment | null, parameterName: string): string | null => {
	const normalizedName: string = parameterName.toLowerCase();
	const tag: DocTag | undefined = doc?.tags.find((candidate: DocTag): boolean => {
		if (candidate.name.toLowerCase() !== 'param') {
			return false;
		}

		const [name = ''] = candidate.value.split(/\s+/u, 1);
		return name.toLowerCase() === normalizedName;
	});

	if (tag === undefined) {
		return null;
	}

	return tag.value.replace(/^\S+\s*/u, '').trim();
};
