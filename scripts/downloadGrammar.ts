import * as fs from 'node:fs/promises';

import {z} from 'zod';

const REPOSITORY = 'antlr/grammars-v4';
const GRAMMAR_PATH = 'sql/plsql/PlSqlLexer.g4';
const BASE_PATH = 'sql/plsql/Antlr4ng/PlSqlLexerBase.ts';
const COMMIT_URL = `https://api.github.com/repos/${REPOSITORY}/commits/master`;
const HEADER_MARKER = '// Insert here @header for C++ lexer.';
const HEADER_ADAPTATION = `@header {import {PlSqlLexerBase} from "../plSqlLexerBase.js";}

@members {
public isValidAlternativeQuotedString(): boolean {
    const characters = Array.from(this.text);
    const openingDelimiter = characters[2];
    const closingDelimiter = characters.at(-2);
    if (openingDelimiter === undefined || closingDelimiter === undefined || /\\s/u.test(openingDelimiter)) {
        return false;
    }

    switch (openingDelimiter) {
        case '[':
            return closingDelimiter === ']';
        case '{':
            return closingDelimiter === '}';
        case '<':
            return closingDelimiter === '>';
        case '(':
            return closingDelimiter === ')';
        default:
            return closingDelimiter === openingDelimiter;
    }
}
}`;
const UPSTREAM_Q_STRING = `// See https://livesql.oracle.com/apex/livesql/file/content_CIREYU9EA54EOKQ7LAMZKRF6P.html
// TODO: context sensitive string quotes (any characted after quote)
CHAR_STRING_PERL:
    'Q' '\\'' (
        QS_ANGLE
        | QS_BRACE
        | QS_BRACK
        | QS_PAREN
        | QS_EXCLAM
        | QS_SHARP
        | QS_QUOTE
        | QS_DQUOTE
        | QS_TILDA
        | QS_SOLIDUS
        | QS_RSOLIDUS
    ) '\\'' -> type(CHAR_STRING)
;
fragment QS_ANGLE    : '<' .*? '>';
fragment QS_BRACE    : '{' .*? '}';
fragment QS_BRACK    : '[' .*? ']';
fragment QS_PAREN    : '(' .*? ')';
fragment QS_EXCLAM   : '!' .*? '!';
fragment QS_SHARP    : '#' .*? '#';
fragment QS_QUOTE    : '\\'' .*? '\\'';
fragment QS_DQUOTE   : '"' .*? '"';
fragment QS_TILDA    : '~' .*? '~';
fragment QS_SOLIDUS  : '/' .*? '/';
fragment QS_RSOLIDUS : '\\\\' .*? '\\\\';`;
const ADAPTED_Q_STRING = `// See https://docs.oracle.com/en/database/oracle/oracle-database/26/sqlrf/Literals.html
CHAR_STRING_PERL:
    'Q' '\\'' . .*? . '\\'' {this.isValidAlternativeQuotedString()}? -> type(CHAR_STRING)
;`;
const NOTICE_REVISION_PATTERN = /at commit \[`[0-9a-f]{40}`\]\(https:\/\/github\.com\/antlr\/grammars-v4\/tree\/[0-9a-f]{40}\/sql\/plsql\)/u;

const CommitSchema = z.object({sha: z.string().regex(/^[0-9a-f]{40}$/u)});

const fetchResponse = async (url: string): Promise<Response> => {
	const response: Response = await fetch(url, {
		headers: {Accept: 'application/vnd.github+json', 'User-Agent': 'plsqldoc-grammar-updater'},
	});
	if (!response.ok) {
		throw new Error(`Download failed (${response.status} ${response.statusText}): ${url}`);
	}

	return response;
};

const replaceExactlyOnce = (source: string, search: string, replacement: string, description: string): string => {
	const firstIndex: number = source.indexOf(search);
	if (firstIndex === -1 || firstIndex !== source.lastIndexOf(search)) {
		throw new Error(`Expected exactly one ${description} in the upstream grammar.`);
	}

	return source.replace(search, replacement);
};

const adaptGrammar = (upstreamGrammar: string): string => {
	const withHeader: string = replaceExactlyOnce(upstreamGrammar, HEADER_MARKER, HEADER_ADAPTATION, 'target-language header marker');
	return replaceExactlyOnce(withHeader, UPSTREAM_Q_STRING, ADAPTED_Q_STRING, 'alternative-quoted string rule');
};

const main = async (): Promise<void> => {
	const commitResponse: Response = await fetchResponse(COMMIT_URL);
	const commitData: unknown = await commitResponse.json();
	const {sha} = CommitSchema.parse(commitData);
	const rawRoot = `https://raw.githubusercontent.com/${REPOSITORY}/${sha}`;
	const [grammarResponse, baseResponse, notice] = await Promise.all([
		fetchResponse(`${rawRoot}/${GRAMMAR_PATH}`),
		fetchResponse(`${rawRoot}/${BASE_PATH}`),
		fs.readFile('THIRD_PARTY_NOTICES.md', 'utf8'),
	]);
	const [upstreamGrammar, upstreamBase] = await Promise.all([grammarResponse.text(), baseResponse.text()]);
	const grammar: string = adaptGrammar(upstreamGrammar);
	if (!NOTICE_REVISION_PATTERN.test(notice)) {
		throw new Error('Could not locate the upstream grammar revision in THIRD_PARTY_NOTICES.md.');
	}

	const revision = `at commit [\`${sha}\`](https://github.com/${REPOSITORY}/tree/${sha}/sql/plsql)`;
	const updatedNotice: string = notice.replace(NOTICE_REVISION_PATTERN, revision);
	await Promise.all([
		fs.writeFile('PlSqlLexer.g4', grammar),
		fs.writeFile('src/plSqlLexerBase.ts', upstreamBase),
		fs.writeFile('THIRD_PARTY_NOTICES.md', updatedNotice),
	]);
	console.log(`Downloaded PL/SQL grammar from ${REPOSITORY}@${sha}.`);
};

try {
	await main();
} catch (error: unknown) {
	const message: string = error instanceof Error ? error.message : String(error);
	console.error(message);
	process.exitCode = 1;
}
