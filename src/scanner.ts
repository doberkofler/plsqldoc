import {CharStream, CommonTokenStream, Token} from 'antlr4ng';
import {type DocComment, type PackageDoc, type ParameterDoc, type ParamMode, type RoutineDoc, type SourceFileDoc, type SourceLocation} from './ast.js';
import {findParamDoc, findReturnDoc, parseDocComment} from './doc-parser.js';
import {PlSqlLexer} from './generated/PlSqlLexer.js';

type RoutineKind = 'PROCEDURE' | 'FUNCTION';

export class PLSqlDocScanner {
	private readonly tokens: readonly Token[];
	private readonly filePath: string | null;
	private readonly warnings: string[] = [];

	public constructor(sourceInput: string, filePath: string | null = null) {
		const stream: CharStream = CharStream.fromString(sourceInput);
		const lexer: PlSqlLexer = new PlSqlLexer(stream);
		const tokenStream = new CommonTokenStream(lexer);
		tokenStream.fill();
		this.tokens = tokenStream.getTokens();
		this.filePath = filePath;
	}

	public parseFile(): SourceFileDoc {
		const packages: PackageDoc[] = [];
		const routines: RoutineDoc[] = [];

		for (let index = 0; index < this.tokens.length; index++) {
			if (this.isEof(index)) {
				break;
			}

			if (!this.isKeyword(index, 'CREATE')) {
				continue;
			}

			const declarationIndex: number = this.skipCreateModifiers(index);
			if (this.isKeyword(declarationIndex, 'PACKAGE')) {
				const parsedPackage: {doc: PackageDoc | null; nextIndex: number} = this.parsePackageDeclaration(declarationIndex, index);
				if (parsedPackage.doc !== null) {
					packages.push(parsedPackage.doc);
				}
				index = parsedPackage.nextIndex;
				continue;
			}

			if (this.isRoutineKeyword(declarationIndex)) {
				const routine: RoutineDoc | null = this.parseRoutine(declarationIndex, index);
				if (routine !== null) {
					routines.push(routine);
				}
			}
		}

		return {
			filePath: this.filePath,
			packages,
			routines,
			warnings: this.warnings,
		};
	}

	public parsePackage(): PackageDoc {
		return (
			this.parseFile().packages[0] ?? {
				doc: null,
				location: {column: 0, filePath: this.filePath, line: 0},
				name: 'UNKNOWN',
				routines: [],
			}
		);
	}

	private parsePackageDeclaration(packageIndex: number, docIndex: number): {doc: PackageDoc | null; nextIndex: number} {
		let cursor: number = this.nextVisibleIndex(packageIndex);
		if (this.isKeyword(cursor, 'BODY')) {
			return {doc: null, nextIndex: this.findStatementEnd(cursor)};
		}

		const nameResult: {name: string; nextIndex: number} | null = this.readQualifiedName(cursor);
		if (nameResult === null) {
			this.warn(packageIndex, 'Unable to read package name.');
			return {doc: null, nextIndex: packageIndex};
		}

		cursor = nameResult.nextIndex;
		const routines: RoutineDoc[] = [];
		const endIndex: number = this.findPackageSpecEnd(cursor, nameResult.name);

		while (cursor >= 0 && cursor < endIndex) {
			if (this.isRoutineKeyword(cursor)) {
				const routine: RoutineDoc | null = this.parseRoutine(cursor);
				if (routine !== null) {
					routines.push(routine);
				}
				cursor = this.findStatementEnd(cursor) + 1;
				continue;
			}

			cursor++;
		}

		return {
			doc: {
				doc: this.extractLeadingDoc(docIndex),
				location: this.location(packageIndex),
				name: nameResult.name,
				routines,
			},
			nextIndex: endIndex,
		};
	}

	private parseRoutine(routineIndex: number, docIndex: number = routineIndex): RoutineDoc | null {
		const kind: RoutineKind = this.isKeyword(routineIndex, 'FUNCTION') ? 'FUNCTION' : 'PROCEDURE';
		const nameResult: {name: string; nextIndex: number} | null = this.readQualifiedName(this.nextVisibleIndex(routineIndex));
		if (nameResult === null) {
			this.warn(routineIndex, `Unable to read ${kind.toLowerCase()} name.`);
			return null;
		}

		let doc: DocComment | null = this.extractLeadingDoc(docIndex);
		let cursor: number = nameResult.nextIndex;
		let parameters: ParameterDoc[] = [];

		if (this.text(cursor) === '(') {
			const parsed: {parameters: ParameterDoc[]; nextIndex: number} = this.parseParameterList(cursor, doc);
			({parameters} = parsed);
			cursor = parsed.nextIndex + 1;
		}

		let returnType: string | null = null;
		const statementEnd: number = this.findStatementEnd(routineIndex);
		doc ??= this.extractTrailingLineDoc(statementEnd);
		while (cursor >= 0 && cursor < statementEnd) {
			if (this.isKeyword(cursor, 'RETURN')) {
				returnType = this.consumeTypeSpecifier(this.nextVisibleIndex(cursor), statementEnd);
				break;
			}
			cursor++;
		}

		return {
			doc,
			kind,
			location: this.location(routineIndex),
			name: nameResult.name,
			parameters,
			returnDoc: findReturnDoc(doc),
			returnType,
		};
	}

	private parseParameterList(openParenIndex: number, routineDoc: DocComment | null): {parameters: ParameterDoc[]; nextIndex: number} {
		const parameters: ParameterDoc[] = [];
		let depth = 0;
		let currentTokens: Token[] = [];

		for (let index = openParenIndex; index < this.tokens.length; index++) {
			const token: Token = this.tokens[index];
			const text: string = token.text ?? '';

			if (text === '(') {
				depth++;
				if (depth === 1) {
					continue;
				}
			} else if (text === ')') {
				depth--;
				if (depth === 0) {
					if (currentTokens.length > 0) {
						parameters.push(PLSqlDocScanner.parseSingleParameter(currentTokens, routineDoc));
					}
					return {nextIndex: index, parameters};
				}
			}

			if (depth === 1 && text === ',') {
				if (currentTokens.length > 0) {
					parameters.push(PLSqlDocScanner.parseSingleParameter(currentTokens, routineDoc));
					currentTokens = [];
				}
				continue;
			}

			if (depth >= 1 && !PLSqlDocScanner.isTriviaToken(token)) {
				currentTokens.push(token);
			}
		}

		return {nextIndex: openParenIndex, parameters};
	}

	private static parseSingleParameter(paramTokens: readonly Token[], routineDoc: DocComment | null): ParameterDoc {
		const nameToken: Token = paramTokens[0];
		const name: string = nameToken.text ?? 'UNKNOWN';
		let mode: ParamMode = 'IN';
		const typeTokens: string[] = [];
		const defaultTokens: string[] = [];
		let parseState: 'MODE_OR_TYPE' | 'TYPE' | 'DEFAULT' = 'MODE_OR_TYPE';

		for (let index = 1; index < paramTokens.length; index++) {
			const text: string = paramTokens[index]?.text ?? '';
			const upper: string = text.toUpperCase();

			if (parseState === 'MODE_OR_TYPE') {
				if (upper === 'IN') {
					if (paramTokens[index + 1]?.text?.toUpperCase() === 'OUT') {
						mode = 'IN OUT';
						index++;
					} else {
						mode = 'IN';
					}
					parseState = 'TYPE';
					continue;
				}

				if (upper === 'OUT') {
					mode = 'OUT';
					parseState = 'TYPE';
					continue;
				}

				if (upper === 'NOCOPY') {
					continue;
				}

				parseState = 'TYPE';
			}

			if (parseState === 'TYPE') {
				if (upper === 'DEFAULT' || text === ':=') {
					parseState = 'DEFAULT';
					continue;
				}

				if (upper !== 'NOCOPY') {
					typeTokens.push(text);
				}
				continue;
			}

			defaultTokens.push(text);
		}

		return {
			defaultValue: defaultTokens.length > 0 ? PLSqlDocScanner.joinTokenTexts(defaultTokens) : null,
			doc: findParamDoc(routineDoc, name),
			mode,
			name,
			type: PLSqlDocScanner.joinTokenTexts(typeTokens),
		};
	}

	private skipCreateModifiers(createIndex: number): number {
		let cursor: number = this.nextVisibleIndex(createIndex);
		if (this.isKeyword(cursor, 'OR') && this.isKeyword(this.nextVisibleIndex(cursor), 'REPLACE')) {
			cursor = this.nextVisibleIndex(this.nextVisibleIndex(cursor));
		}

		while (this.isKeyword(cursor, 'EDITIONABLE') || this.isKeyword(cursor, 'NONEDITIONABLE')) {
			cursor = this.nextVisibleIndex(cursor);
		}

		return cursor;
	}

	private readQualifiedName(startIndex: number): {name: string; nextIndex: number} | null {
		const parts: string[] = [];
		let cursor: number = startIndex;

		while (cursor >= 0 && cursor < this.tokens.length) {
			const text: string = this.text(cursor);
			if (!this.isIdentifier(cursor) && text !== '.') {
				break;
			}

			parts.push(text);
			cursor = this.nextVisibleIndex(cursor);
		}

		if (parts.length === 0) {
			return null;
		}

		return {name: parts.join(''), nextIndex: cursor};
	}

	private consumeTypeSpecifier(startIndex: number, endIndex: number): string {
		const parts: string[] = [];
		let depth = 0;

		for (let index = startIndex; index < endIndex; index++) {
			if (this.isTrivia(index)) {
				continue;
			}

			const text: string = this.text(index);
			if (text === '(') {
				depth++;
			} else if (text === ')') {
				depth--;
			}

			const upper: string = text.toUpperCase();
			if (depth === 0 && ['IS', 'AS', 'DETERMINISTIC', 'PIPELINED', 'RESULT_CACHE', 'PARALLEL_ENABLE'].includes(upper)) {
				break;
			}

			parts.push(text);
		}

		return PLSqlDocScanner.joinTokenTexts(parts);
	}

	private findPackageSpecEnd(startIndex: number, packageName: string): number {
		for (let index = startIndex; index < this.tokens.length; index++) {
			if (this.isKeyword(index, 'END')) {
				const statementEnd: number = this.findStatementEnd(index);
				const afterEndName: {name: string; nextIndex: number} | null = this.readQualifiedName(this.nextVisibleIndex(index));
				if (afterEndName === null || afterEndName.name.toLowerCase() === packageName.toLowerCase()) {
					return statementEnd;
				}
			}
		}

		return this.tokens.length - 1;
	}

	private findStatementEnd(startIndex: number): number {
		let depth = 0;
		for (let index = startIndex; index < this.tokens.length; index++) {
			const text: string = this.text(index);
			if (text === '(') {
				depth++;
			} else if (text === ')') {
				depth--;
			} else if (text === ';' && depth === 0) {
				return index;
			}
		}

		return this.tokens.length - 1;
	}

	private extractLeadingDoc(index: number): DocComment | null {
		const comments: string[] = [];
		let cursor: number = index - 1;
		let expectedLine: number = this.tokens[index]?.line ?? 0;

		while (cursor >= 0) {
			const token: Token = this.tokens[cursor];
			if (token.type === PlSqlLexer.SPACE) {
				cursor--;
				continue;
			}

			if (token.type !== PlSqlLexer.COMMENT) {
				break;
			}

			const rawText: string = token.text ?? '';
			if (!rawText.startsWith('/**') && !rawText.startsWith('--')) {
				break;
			}

			if (rawText.startsWith('--')) {
				if (
					token.line >= expectedLine ||
					token.line < expectedLine - 1 ||
					this.hasVisibleTokenBeforeOnLine(cursor) ||
					PLSqlDocScanner.isSeparatorLineComment(rawText)
				) {
					break;
				}

				expectedLine = token.line;
			}

			comments.unshift(rawText);
			if (rawText.startsWith('/**')) {
				break;
			}
			cursor--;
		}

		return comments.length > 0 ? parseDocComment(comments.join('\n')) : null;
	}

	private extractTrailingLineDoc(index: number): DocComment | null {
		const line: number = this.tokens[index].line;
		let cursor: number = index + 1;

		while (cursor < this.tokens.length && this.tokens[cursor].type === PlSqlLexer.SPACE) {
			cursor++;
		}
		if (cursor >= this.tokens.length) {
			return null;
		}

		const token: Token = this.tokens[cursor];
		const rawText: string = token.text ?? '';
		if (token.type !== PlSqlLexer.COMMENT || token.line !== line || !rawText.startsWith('--')) {
			return null;
		}

		return parseDocComment(rawText);
	}

	private hasVisibleTokenBeforeOnLine(index: number): boolean {
		const line: number = this.tokens[index].line;

		for (let cursor = index - 1; cursor >= 0; cursor--) {
			const token: Token = this.tokens[cursor];
			if (token.line !== line) {
				return false;
			}

			if (!PLSqlDocScanner.isTriviaToken(token)) {
				return true;
			}
		}

		return false;
	}

	private static isSeparatorLineComment(rawText: string): boolean {
		return /^--\s*-{3,}\s*$/u.test(rawText);
	}

	private nextVisibleIndex(currentIndex: number): number {
		for (let index = currentIndex + 1; index < this.tokens.length; index++) {
			if (!this.isTrivia(index)) {
				return index;
			}
		}

		return -1;
	}

	private isRoutineKeyword(index: number): boolean {
		return this.isKeyword(index, 'PROCEDURE') || this.isKeyword(index, 'FUNCTION');
	}

	private isIdentifier(index: number): boolean {
		const type: number | undefined = this.tokens[index]?.type;
		return type === PlSqlLexer.ID || type === PlSqlLexer.QUOTED_ID;
	}

	private isTrivia(index: number): boolean {
		if (index < 0 || index >= this.tokens.length) {
			return true;
		}

		return PLSqlDocScanner.isTriviaToken(this.tokens[index]);
	}

	private static isTriviaToken(token: Token): boolean {
		return token.type === PlSqlLexer.SPACE || token.type === PlSqlLexer.COMMENT || token.channel === Token.HIDDEN_CHANNEL;
	}

	private isKeyword(index: number, keyword: string): boolean {
		return this.textUpper(index) === keyword;
	}

	private isEof(index: number): boolean {
		return this.tokens[index]?.type === Token.EOF;
	}

	private text(index: number): string {
		return this.tokens[index]?.text ?? '';
	}

	private textUpper(index: number): string {
		return this.text(index).toUpperCase();
	}

	private location(index: number): SourceLocation {
		if (index < 0 || index >= this.tokens.length) {
			return {column: 0, filePath: this.filePath, line: 0};
		}

		const token: Token = this.tokens[index];
		return {
			column: token.column,
			filePath: this.filePath,
			line: token.line,
		};
	}

	private warn(index: number, message: string): void {
		const location: SourceLocation = this.location(index);
		this.warnings.push(`${location.filePath ?? '<input>'}:${location.line}:${location.column}: ${message}`);
	}

	private static joinTokenTexts(parts: readonly string[]): string {
		return parts.join('').replaceAll(/\s+/gu, ' ').trim();
	}
}
