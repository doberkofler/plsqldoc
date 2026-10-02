import {type DocComment, type DocTag} from './ast.js';

const cleanCommentLines = (commentText: string): string[] => {
	const normalized: string = commentText.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
	const withoutDelimiters: string = normalized.replace(/^\s*\/\*\*/u, '').replace(/\*\/\s*$/u, '');
	const lines: string[] = withoutDelimiters.split('\n').map((line: string): string => {
		if (/^\s*--/u.test(line)) {
			return line.replace(/^\s*--\s?/u, '');
		}

		return line.replace(/^\s*\* ?/u, '');
	});

	while (lines[0]?.trim() === '') {
		lines.shift();
	}
	while (lines.at(-1)?.trim() === '') {
		lines.pop();
	}

	return lines;
};

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

	const descriptionLines: string[] = [];
	const mutableTags: {name: string; lines: string[]}[] = [];
	let currentTag: {name: string; lines: string[]} | null = null;

	for (const originalLine of cleanCommentLines(commentText)) {
		const contentIndex: number = originalLine.search(/\S/u);
		const leadingWhitespace: string = contentIndex < 0 ? originalLine : originalLine.slice(0, contentIndex);
		const trimmedLine: string = originalLine.slice(leadingWhitespace.length);
		if (trimmedLine.startsWith(String.raw`\@`)) {
			const literalLine = `${leadingWhitespace}${trimmedLine.slice(1)}`;
			(currentTag?.lines ?? descriptionLines).push(literalLine);
			continue;
		}

		if (trimmedLine.startsWith('@')) {
			const tagText: string = trimmedLine.slice(1);
			const separatorIndex: number = tagText.search(/\s/u);
			const name: string = separatorIndex === -1 ? tagText : tagText.slice(0, separatorIndex);
			const value: string = separatorIndex === -1 ? '' : tagText.slice(separatorIndex).trimStart();
			currentTag = {lines: [value], name};
			mutableTags.push(currentTag);
			continue;
		}

		(currentTag?.lines ?? descriptionLines).push(originalLine);
	}

	const tags: DocTag[] = mutableTags.map((tag): DocTag => ({
		name: tag.name,
		value: tag.lines.join('\n').trim(),
	}));

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
 * @returns Return documentation, or null when absent.
 */
export const findReturnDoc = (doc: DocComment | null): string | null =>
	doc?.tags.find((tag: DocTag): boolean => tag.name.toLowerCase() === 'return')?.value ?? null;

/**
 * Finds documentation for a named routine parameter.
 *
 * @param doc Routine documentation.
 * @param parameterName Parameter name to find.
 * @returns Parameter documentation, or null when absent.
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
