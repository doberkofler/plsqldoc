import {CharStream, CommonTokenStream, Token} from 'antlr4ng';
import {
	type CollectionTypeDoc,
	type CursorDoc,
	type DocComment,
	type ExceptionDoc,
	type FieldDoc,
	type ObjectAttributeDoc,
	type ObjectTypeDoc,
	type PackageDoc,
	type PackageMemberDoc,
	type ParameterDoc,
	type ParamMode,
	type RecordTypeDoc,
	type RefCursorTypeDoc,
	type RoutineDoc,
	type SchemaCollectionTypeDoc,
	type SourceFileDoc,
	type SourceLocation,
	type StandaloneTypeDoc,
	type SubtypeDoc,
	type UnsupportedMemberDoc,
	type ValueDoc,
} from './ast.js';
import {findParamDoc, findReturnDoc, parseDocComment} from './doc-parser.js';
import {PlSqlLexer} from './generated/PlSqlLexer.js';
import {ScannerLexerErrorListener} from './scannerLexerErrorListener.js';

type Parsed<T> = {readonly value: T | null; readonly nextIndex: number};
type TokenRange = {readonly start: number; readonly end: number; readonly delimiter: number | null};

const ROUTINE_MODIFIERS = new Set(['CONSTRUCTOR', 'FINAL', 'INSTANTIABLE', 'MAP', 'MEMBER', 'NOT', 'ORDER', 'OVERRIDING', 'STATIC']);
const RETURN_TYPE_STOPS = new Set(['AS', 'DETERMINISTIC', 'IS', 'PARALLEL_ENABLE', 'PIPELINED', 'RESULT_CACHE']);

export class PLSqlDocScanner {
	private readonly tokens: readonly Token[];
	private readonly filePath: string | null;
	private readonly warnings: string[] = [];

	public constructor(sourceInput: string, filePath: string | null = null) {
		this.filePath = filePath;
		const stream: CharStream = CharStream.fromString(sourceInput);
		const lexer: PlSqlLexer = new PlSqlLexer(stream);
		lexer.removeErrorListeners();
		lexer.addErrorListener(
			new ScannerLexerErrorListener((line: number, column: number, message: string): void => {
				this.warnings.push(`${this.filePath ?? '<input>'}:${line}:${column}: ${message}`);
			}),
		);
		const tokenStream = new CommonTokenStream(lexer);
		tokenStream.fill();
		this.tokens = tokenStream.getTokens();
	}

	/** @returns Every supported top-level declaration in the source file. */
	public parseFile(): SourceFileDoc {
		const packages: PackageDoc[] = [];
		const routines: RoutineDoc[] = [];
		const types: StandaloneTypeDoc[] = [];

		for (let index = 0; index < this.tokens.length; index++) {
			if (this.isEof(index)) {
				break;
			}
			if (!this.isKeyword(index, 'CREATE')) {
				continue;
			}

			const declarationIndex: number = this.skipCreateModifiers(index);
			if (this.isKeyword(declarationIndex, 'PACKAGE')) {
				const parsed: Parsed<PackageDoc> = this.parsePackageDeclaration(declarationIndex, index);
				if (parsed.value !== null) {
					packages.push(parsed.value);
				}
				index = Math.max(index, parsed.nextIndex);
				continue;
			}
			if (this.isKeyword(declarationIndex, 'TYPE')) {
				const parsed: Parsed<StandaloneTypeDoc> = this.parseStandaloneType(declarationIndex, index);
				if (parsed.value !== null) {
					types.push(parsed.value);
				}
				index = Math.max(index, parsed.nextIndex);
				continue;
			}
			if (this.isRoutineKeyword(declarationIndex)) {
				const statementEnd: number = this.findDeclarationEnd(declarationIndex);
				const parsed: Parsed<RoutineDoc> = this.parseRoutine(declarationIndex, index, statementEnd);
				if (parsed.value !== null) {
					routines.push(parsed.value);
				}
				index = Math.max(index, parsed.nextIndex);
			}
		}

		return {filePath: this.filePath, packages, routines, types, warnings: this.warnings};
	}

	/** @returns The first package specification, or an empty fallback when absent. */
	public parsePackage(): PackageDoc {
		return (
			this.parseFile().packages[0] ?? {
				declaration: '',
				doc: null,
				kind: 'PACKAGE',
				location: {column: 0, filePath: this.filePath, line: 0},
				members: [],
				name: 'UNKNOWN',
			}
		);
	}

	private parsePackageDeclaration(packageIndex: number, docIndex: number): Parsed<PackageDoc> {
		let cursor: number = this.nextVisibleIndex(packageIndex);
		if (this.isKeyword(cursor, 'BODY')) {
			return {nextIndex: this.findUnitEnd(cursor), value: null};
		}

		const nameResult = this.readQualifiedName(cursor);
		if (nameResult === null) {
			this.warn(packageIndex, 'Unable to read package name.');
			return {nextIndex: this.findDeclarationEnd(packageIndex), value: null};
		}

		cursor = nameResult.nextIndex;
		if (this.isKeyword(cursor, 'WRAPPED')) {
			return {nextIndex: this.findUnitEnd(cursor), value: null};
		}
		while (cursor >= 0 && !this.isKeyword(cursor, 'AS') && !this.isKeyword(cursor, 'IS') && this.text(cursor) !== ';') {
			cursor = this.nextVisibleIndex(cursor);
		}
		if (!this.isKeyword(cursor, 'AS') && !this.isKeyword(cursor, 'IS')) {
			this.warn(packageIndex, 'Package specification is missing AS or IS.');
			return {nextIndex: this.findDeclarationEnd(packageIndex), value: null};
		}

		const members: PackageMemberDoc[] = [];
		const packageHeaderEnd: number = cursor;
		cursor = this.nextVisibleIndex(cursor);
		const doc: DocComment | null = this.extractPackagePreambleDoc(packageHeaderEnd, cursor) ?? this.extractLeadingDoc(docIndex);
		let packageEnd: number = this.tokens.length - 1;
		while (cursor >= 0 && cursor < this.tokens.length && !this.isEof(cursor)) {
			if (this.isKeyword(cursor, 'END')) {
				packageEnd = this.findDeclarationEnd(cursor);
				break;
			}
			if (this.text(cursor) === ';') {
				cursor = this.nextVisibleIndex(cursor);
				continue;
			}

			const parsed: Parsed<PackageMemberDoc> = this.parsePackageMember(cursor);
			if (parsed.value !== null) {
				members.push(parsed.value);
			}
			cursor = this.nextVisibleIndex(parsed.nextIndex <= cursor ? cursor : parsed.nextIndex);
		}

		if (packageEnd === this.tokens.length - 1) {
			this.warn(packageIndex, 'Package specification has no terminating END.');
		}

		return {
			nextIndex: packageEnd,
			value: {
				declaration: `${this.renderRange(packageIndex, packageHeaderEnd)};`,
				doc,
				kind: 'PACKAGE',
				location: this.location(packageIndex),
				members,
				name: nameResult.name,
			},
		};
	}

	private parsePackageMember(startIndex: number): Parsed<PackageMemberDoc> {
		if (this.text(startIndex).startsWith('$')) {
			return {nextIndex: this.findVisibleLineEnd(startIndex), value: null};
		}
		const endIndex: number = this.findDeclarationEnd(startIndex);
		if (this.isRoutineKeyword(startIndex)) {
			return this.parseRoutine(startIndex, startIndex, endIndex);
		}
		if (this.isKeyword(startIndex, 'TYPE')) {
			return this.parsePackageType(startIndex, endIndex);
		}
		if (this.isKeyword(startIndex, 'SUBTYPE')) {
			return this.parseSubtype(startIndex, endIndex);
		}
		if (this.isKeyword(startIndex, 'CURSOR')) {
			return this.parseCursor(startIndex, endIndex);
		}
		if (this.isIdentifier(startIndex)) {
			return this.parseNamedValue(startIndex, endIndex);
		}

		this.warn(startIndex, `Unsupported package declaration starting with ${this.text(startIndex) || '<unknown>'}.`);
		const unsupported: UnsupportedMemberDoc = {
			declaration: this.renderRange(startIndex, endIndex),
			doc: this.extractLeadingDoc(startIndex),
			kind: 'UNSUPPORTED',
			location: this.location(startIndex),
			name: this.text(startIndex) || 'UNKNOWN',
		};
		return {nextIndex: endIndex, value: unsupported};
	}

	private parseRoutine(routineIndex: number, docIndex: number, statementEnd: number, modifiers: readonly string[] = []): Parsed<RoutineDoc> {
		const kind: 'PROCEDURE' | 'FUNCTION' = this.isKeyword(routineIndex, 'FUNCTION') ? 'FUNCTION' : 'PROCEDURE';
		const nameResult = this.readQualifiedName(this.nextVisibleIndex(routineIndex));
		if (nameResult === null) {
			this.warn(routineIndex, `Unable to read ${kind.toLowerCase()} name.`);
			return {nextIndex: statementEnd, value: null};
		}

		let doc: DocComment | null = this.extractEmbeddedDoc(routineIndex, nameResult.nextIndex) ?? this.extractLeadingDoc(docIndex);
		let cursor: number = nameResult.nextIndex;
		let parameters: ParameterDoc[] = [];
		if (this.text(cursor) === '(') {
			const closeIndex: number | null = this.findBalancedClose(cursor, statementEnd);
			if (closeIndex === null) {
				this.warn(cursor, `Unclosed parameter list for ${kind.toLowerCase()} ${nameResult.name}.`);
			} else {
				parameters = this.parseParameters(cursor, closeIndex, doc);
				cursor = this.nextVisibleIndex(closeIndex);
			}
		}

		let returnType: string | null = null;
		while (cursor >= 0 && cursor < statementEnd) {
			if (kind === 'FUNCTION' && this.isKeyword(cursor, 'RETURN')) {
				const returnStart: number = this.nextVisibleIndex(cursor);
				let returnEnd: number = statementEnd - 1;
				for (let index = returnStart; index < statementEnd; index = this.nextVisibleIndex(index)) {
					if (RETURN_TYPE_STOPS.has(this.textUpper(index))) {
						returnEnd = this.previousVisibleIndex(index);
						break;
					}
				}
				returnType = this.renderRange(returnStart, returnEnd);
				break;
			}
			cursor = this.nextVisibleIndex(cursor);
		}

		doc ??= this.extractTrailingLineDoc(statementEnd);
		const routine: RoutineDoc = {
			declaration: this.renderRange(docIndex, statementEnd),
			doc,
			kind,
			location: this.location(docIndex),
			modifiers,
			name: nameResult.name,
			parameters,
			returnDoc: findReturnDoc(doc),
			returnType,
		};
		return {nextIndex: statementEnd, value: routine};
	}

	private parseParameters(openIndex: number, closeIndex: number, parentDoc: DocComment | null): ParameterDoc[] {
		return this.splitTopLevel(this.nextVisibleIndex(openIndex), this.previousVisibleIndex(closeIndex), ',').flatMap((range: TokenRange): ParameterDoc[] => {
			const parsed: ParameterDoc | null = this.parseParameter(range, parentDoc);
			return parsed === null ? [] : [parsed];
		});
	}

	private parseParameter(range: TokenRange, parentDoc: DocComment | null): ParameterDoc | null {
		const startIndex: number = this.firstVisibleInRange(range.start, range.end);
		if (!this.isIdentifier(startIndex)) {
			this.warn(startIndex, 'Unable to read parameter name.');
			return null;
		}

		const name: string = this.text(startIndex);
		const visible: number[] = this.visibleIndices(this.nextVisibleIndex(startIndex), range.end);
		let mode: ParamMode = 'IN';
		let cursor = 0;
		if (this.textUpper(visible[cursor] ?? -1) === 'IN' && this.textUpper(visible[cursor + 1] ?? -1) === 'OUT') {
			mode = 'IN OUT';
			cursor += 2;
		} else if (this.textUpper(visible[cursor] ?? -1) === 'OUT') {
			mode = 'OUT';
			cursor++;
		} else if (this.textUpper(visible[cursor] ?? -1) === 'IN') {
			mode = 'IN';
			cursor++;
		}
		if (this.textUpper(visible[cursor] ?? -1) === 'NOCOPY') {
			cursor++;
		}

		let defaultPosition = -1;
		for (let position = cursor; position < visible.length; position++) {
			if (this.textUpper(visible[position] ?? -1) === 'DEFAULT' || this.text(visible[position] ?? -1) === ':=') {
				defaultPosition = position;
				break;
			}
		}
		const typeIndices: number[] = visible.slice(cursor, defaultPosition < 0 ? undefined : defaultPosition);
		const defaultIndices: number[] = defaultPosition < 0 ? [] : visible.slice(defaultPosition + 1);
		const ownDoc: DocComment | null = this.extractLeadingDoc(startIndex) ?? this.extractTrailingForRange(range);
		return {
			defaultValue: defaultIndices.length === 0 ? null : this.renderIndices(defaultIndices),
			doc: findParamDoc(parentDoc, name) ?? ownDoc?.description ?? null,
			location: this.location(startIndex),
			mode,
			name,
			type: this.renderIndices(typeIndices),
		};
	}

	private parsePackageType(startIndex: number, endIndex: number): Parsed<PackageMemberDoc> {
		const nameIndex: number = this.nextVisibleIndex(startIndex);
		const nameResult = this.readQualifiedName(nameIndex);
		if (nameResult === null) {
			this.warn(startIndex, 'Unable to read type name.');
			return {nextIndex: endIndex, value: null};
		}

		let cursor: number = nameResult.nextIndex;
		if (!this.isKeyword(cursor, 'IS') && !this.isKeyword(cursor, 'AS')) {
			this.warn(startIndex, `Type ${nameResult.name} is missing AS or IS.`);
			return {nextIndex: endIndex, value: null};
		}
		cursor = this.nextVisibleIndex(cursor);
		if (this.isKeyword(cursor, 'RECORD')) {
			return this.parseRecordType(startIndex, nameResult.name, cursor, endIndex);
		}
		if (this.isKeyword(cursor, 'TABLE')) {
			return this.parseCollectionType(startIndex, nameResult.name, cursor, endIndex, 'NESTED_TABLE');
		}
		if (this.isKeyword(cursor, 'VARRAY')) {
			return this.parseCollectionType(startIndex, nameResult.name, cursor, endIndex, 'VARRAY');
		}
		if (this.isKeyword(cursor, 'REF') && this.isKeyword(this.nextVisibleIndex(cursor), 'CURSOR')) {
			let returnType: string | null = null;
			const returnIndex: number = this.findKeyword(cursor, endIndex, 'RETURN');
			if (returnIndex >= 0) {
				returnType = this.renderRange(this.nextVisibleIndex(returnIndex), this.previousVisibleIndex(endIndex));
			}
			const refCursor: RefCursorTypeDoc = {
				declaration: this.renderRange(startIndex, endIndex),
				doc: this.extractLeadingDoc(startIndex) ?? this.extractTrailingLineDoc(endIndex),
				kind: 'REF_CURSOR',
				location: this.location(startIndex),
				name: nameResult.name,
				returnType,
			};
			return {nextIndex: endIndex, value: refCursor};
		}

		this.warn(cursor, `Unsupported type declaration for ${nameResult.name}.`);
		return {
			nextIndex: endIndex,
			value: {
				declaration: this.renderRange(startIndex, endIndex),
				doc: this.extractLeadingDoc(startIndex),
				kind: 'UNSUPPORTED',
				location: this.location(startIndex),
				name: nameResult.name,
			},
		};
	}

	private parseRecordType(startIndex: number, name: string, recordIndex: number, endIndex: number): Parsed<RecordTypeDoc> {
		const openIndex: number = this.nextVisibleIndex(recordIndex);
		const closeIndex: number | null = this.text(openIndex) === '(' ? this.findBalancedClose(openIndex, endIndex) : null;
		if (closeIndex === null) {
			this.warn(recordIndex, `Unclosed record field list for ${name}.`);
			return {nextIndex: endIndex, value: null};
		}
		const fields: FieldDoc[] = this.splitTopLevel(this.nextVisibleIndex(openIndex), this.previousVisibleIndex(closeIndex), ',').flatMap(
			(range: TokenRange): FieldDoc[] => {
				const field: FieldDoc | null = this.parseField(range);
				return field === null ? [] : [field];
			},
		);
		return {
			nextIndex: endIndex,
			value: {
				declaration: this.renderRange(startIndex, endIndex),
				doc: this.extractLeadingDoc(startIndex) ?? this.extractTrailingLineDoc(endIndex),
				fields,
				kind: 'RECORD',
				location: this.location(startIndex),
				name,
			},
		};
	}

	private parseField(range: TokenRange): FieldDoc | null {
		const startIndex: number = this.firstVisibleInRange(range.start, range.end);
		if (!this.isIdentifier(startIndex)) {
			this.warn(startIndex, 'Unable to read field or attribute name.');
			return null;
		}
		const indices: number[] = this.visibleIndices(this.nextVisibleIndex(startIndex), range.end);
		let defaultPosition = -1;
		for (let position = 0; position < indices.length; position++) {
			if (this.textUpper(indices[position] ?? -1) === 'DEFAULT' || this.text(indices[position] ?? -1) === ':=') {
				defaultPosition = position;
				break;
			}
		}
		const typeIndices: number[] = indices.slice(0, defaultPosition < 0 ? undefined : defaultPosition);
		const defaultIndices: number[] = defaultPosition < 0 ? [] : indices.slice(defaultPosition + 1);
		return {
			declaration: this.renderRange(startIndex, range.end),
			defaultValue: defaultIndices.length === 0 ? null : this.renderIndices(defaultIndices),
			doc: this.extractLeadingDoc(startIndex) ?? this.extractTrailingForRange(range),
			location: this.location(startIndex),
			name: this.text(startIndex),
			type: this.renderIndices(typeIndices),
		};
	}

	private parseCollectionType(
		startIndex: number,
		name: string,
		collectionIndex: number,
		endIndex: number,
		initialKind: 'NESTED_TABLE' | 'VARRAY',
	): Parsed<CollectionTypeDoc> {
		let cursor: number = this.nextVisibleIndex(collectionIndex);
		let bound: string | null = null;
		if (initialKind === 'VARRAY' && this.text(cursor) === '(') {
			const closeIndex: number | null = this.findBalancedClose(cursor, endIndex);
			if (closeIndex === null) {
				this.warn(cursor, `Unclosed varray bound for ${name}.`);
				return {nextIndex: endIndex, value: null};
			}
			bound = this.renderRange(this.nextVisibleIndex(cursor), this.previousVisibleIndex(closeIndex));
			cursor = this.nextVisibleIndex(closeIndex);
		}
		if (!this.isKeyword(cursor, 'OF')) {
			this.warn(collectionIndex, `Collection type ${name} is missing OF.`);
			return {nextIndex: endIndex, value: null};
		}
		const elementStart: number = this.nextVisibleIndex(cursor);
		const indexBy: number = this.findKeyword(elementStart, endIndex, 'INDEX');
		let indexType: string | null = null;
		let elementEnd: number = this.previousVisibleIndex(endIndex);
		let kind: CollectionTypeDoc['kind'] = initialKind;
		if (indexBy >= 0 && this.isKeyword(this.nextVisibleIndex(indexBy), 'BY')) {
			kind = 'ASSOCIATIVE_ARRAY';
			elementEnd = this.previousVisibleIndex(indexBy);
			indexType = this.renderRange(this.nextVisibleIndex(this.nextVisibleIndex(indexBy)), this.previousVisibleIndex(endIndex));
		}
		return {
			nextIndex: endIndex,
			value: {
				bound,
				declaration: this.renderRange(startIndex, endIndex),
				doc: this.extractLeadingDoc(startIndex) ?? this.extractTrailingLineDoc(endIndex),
				elementType: this.renderRange(elementStart, elementEnd),
				indexType,
				kind,
				location: this.location(startIndex),
				name,
			},
		};
	}

	private parseSubtype(startIndex: number, endIndex: number): Parsed<SubtypeDoc> {
		const nameResult = this.readQualifiedName(this.nextVisibleIndex(startIndex));
		if (nameResult === null) {
			this.warn(startIndex, 'Unable to read subtype name.');
			return {nextIndex: endIndex, value: null};
		}
		if (!this.isKeyword(nameResult.nextIndex, 'IS')) {
			this.warn(startIndex, `Subtype ${nameResult.name} is missing IS.`);
		}
		const baseStart: number = this.isKeyword(nameResult.nextIndex, 'IS') ? this.nextVisibleIndex(nameResult.nextIndex) : nameResult.nextIndex;
		return {
			nextIndex: endIndex,
			value: {
				baseType: this.renderRange(baseStart, this.previousVisibleIndex(endIndex)),
				declaration: this.renderRange(startIndex, endIndex),
				doc: this.extractLeadingDoc(startIndex) ?? this.extractTrailingLineDoc(endIndex),
				kind: 'SUBTYPE',
				location: this.location(startIndex),
				name: nameResult.name,
			},
		};
	}

	private parseCursor(startIndex: number, endIndex: number): Parsed<CursorDoc> {
		const nameResult = this.readQualifiedName(this.nextVisibleIndex(startIndex));
		if (nameResult === null) {
			this.warn(startIndex, 'Unable to read cursor name.');
			return {nextIndex: endIndex, value: null};
		}
		const doc: DocComment | null = this.extractLeadingDoc(startIndex) ?? this.extractTrailingLineDoc(endIndex);
		let cursor: number = nameResult.nextIndex;
		let parameters: ParameterDoc[] = [];
		if (this.text(cursor) === '(') {
			const closeIndex: number | null = this.findBalancedClose(cursor, endIndex);
			if (closeIndex === null) {
				this.warn(cursor, `Unclosed cursor parameter list for ${nameResult.name}.`);
			} else {
				parameters = this.parseParameters(cursor, closeIndex, doc);
				cursor = this.nextVisibleIndex(closeIndex);
			}
		}
		let returnType: string | null = null;
		if (this.isKeyword(cursor, 'RETURN')) {
			const isIndex: number = this.findKeyword(this.nextVisibleIndex(cursor), endIndex, 'IS');
			const returnEnd: number = isIndex < 0 ? this.previousVisibleIndex(endIndex) : this.previousVisibleIndex(isIndex);
			returnType = this.renderRange(this.nextVisibleIndex(cursor), returnEnd);
		}
		return {
			nextIndex: endIndex,
			value: {
				declaration: this.renderRange(startIndex, endIndex),
				doc,
				kind: 'CURSOR',
				location: this.location(startIndex),
				name: nameResult.name,
				parameters,
				returnType,
			},
		};
	}

	private parseNamedValue(startIndex: number, endIndex: number): Parsed<ValueDoc | ExceptionDoc> {
		const name: string = this.text(startIndex);
		const afterName: number = this.nextVisibleIndex(startIndex);
		const common = {
			declaration: this.renderRange(startIndex, endIndex),
			doc: this.extractLeadingDoc(startIndex) ?? this.extractTrailingLineDoc(endIndex),
			location: this.location(startIndex),
			name,
		};
		if (this.isKeyword(afterName, 'EXCEPTION')) {
			return {nextIndex: endIndex, value: {...common, kind: 'EXCEPTION'}};
		}

		const indices: number[] = this.visibleIndices(afterName, this.previousVisibleIndex(endIndex));
		const constantPosition: number = indices.findIndex((index: number): boolean => this.isKeyword(index, 'CONSTANT'));
		const valuePosition: number = indices.findIndex((index: number): boolean => this.text(index) === ':=' || this.isKeyword(index, 'DEFAULT'));
		const typeStartPosition: number = constantPosition === 0 ? 1 : 0;
		const typeEndPosition: number = valuePosition === -1 ? indices.length : valuePosition;
		const value: ValueDoc = {
			...common,
			kind: constantPosition === 0 ? 'CONSTANT' : 'VARIABLE',
			type: this.renderIndices(indices.slice(typeStartPosition, typeEndPosition)),
			value: valuePosition === -1 ? null : this.renderIndices(indices.slice(valuePosition + 1)),
		};
		return {nextIndex: endIndex, value};
	}

	private parseStandaloneType(typeIndex: number, docIndex: number): Parsed<StandaloneTypeDoc> {
		let cursor: number = this.nextVisibleIndex(typeIndex);
		if (this.isKeyword(cursor, 'BODY')) {
			return {nextIndex: this.findUnitEnd(cursor), value: null};
		}
		while (this.isKeyword(cursor, 'FORCE')) {
			cursor = this.nextVisibleIndex(cursor);
		}
		const nameResult = this.readQualifiedName(cursor);
		if (nameResult === null) {
			this.warn(typeIndex, 'Unable to read type name.');
			return {nextIndex: this.findDeclarationEnd(typeIndex), value: null};
		}
		const doc: DocComment | null = this.extractEmbeddedDoc(typeIndex, nameResult.nextIndex) ?? this.extractLeadingDoc(docIndex);
		cursor = nameResult.nextIndex;
		while (this.isKeyword(cursor, 'FORCE') || this.isKeyword(cursor, 'AUTHID') || this.isKeyword(cursor, 'CURRENT_USER') || this.isKeyword(cursor, 'DEFINER')) {
			cursor = this.nextVisibleIndex(cursor);
		}
		while (cursor >= 0 && !this.isKeyword(cursor, 'AS') && !this.isKeyword(cursor, 'IS') && !this.isKeyword(cursor, 'UNDER') && this.text(cursor) !== ';') {
			cursor = this.nextVisibleIndex(cursor);
		}
		const endIndex: number = this.findStandaloneTypeEnd(typeIndex);
		if (this.isKeyword(cursor, 'UNDER')) {
			return this.parseObjectType(typeIndex, doc, nameResult.name, cursor, endIndex, true);
		}
		if (!this.isKeyword(cursor, 'AS') && !this.isKeyword(cursor, 'IS')) {
			this.warn(typeIndex, `Type ${nameResult.name} is missing AS or IS.`);
			return {nextIndex: endIndex, value: null};
		}
		const definitionIndex: number = this.nextVisibleIndex(cursor);
		if (this.isKeyword(definitionIndex, 'OBJECT')) {
			return this.parseObjectType(typeIndex, doc, nameResult.name, definitionIndex, endIndex, false);
		}
		if (this.isKeyword(definitionIndex, 'TABLE')) {
			return this.parseSchemaCollection(typeIndex, doc, nameResult.name, definitionIndex, endIndex, 'NESTED_TABLE');
		}
		if (this.isKeyword(definitionIndex, 'VARRAY')) {
			return this.parseSchemaCollection(typeIndex, doc, nameResult.name, definitionIndex, endIndex, 'VARRAY');
		}

		this.warn(definitionIndex, `Incomplete or unsupported type declaration for ${nameResult.name}.`);
		return {nextIndex: endIndex, value: null};
	}

	private parseSchemaCollection(
		startIndex: number,
		doc: DocComment | null,
		name: string,
		collectionIndex: number,
		endIndex: number,
		kind: 'NESTED_TABLE' | 'VARRAY',
	): Parsed<SchemaCollectionTypeDoc> {
		const parsed: Parsed<CollectionTypeDoc> = this.parseCollectionType(startIndex, name, collectionIndex, endIndex, kind);
		if (parsed.value === null || parsed.value.kind === 'ASSOCIATIVE_ARRAY') {
			return {nextIndex: endIndex, value: null};
		}
		return {nextIndex: endIndex, value: {...parsed.value, doc, kind}};
	}

	private parseObjectType(
		startIndex: number,
		doc: DocComment | null,
		name: string,
		definitionIndex: number,
		endIndex: number,
		under: boolean,
	): Parsed<ObjectTypeDoc> {
		let cursor: number = this.nextVisibleIndex(definitionIndex);
		let supertype: string | null = null;
		if (under) {
			const supertypeResult = this.readQualifiedName(cursor);
			if (supertypeResult === null) {
				this.warn(definitionIndex, `Unable to read supertype for ${name}.`);
				return {nextIndex: endIndex, value: null};
			}
			supertype = supertypeResult.name;
			cursor = supertypeResult.nextIndex;
		}
		if (this.text(cursor) !== '(') {
			this.warn(cursor, `Object type ${name} has no member list.`);
			return {nextIndex: endIndex, value: null};
		}
		const closeIndex: number | null = this.findBalancedClose(cursor, endIndex);
		if (closeIndex === null) {
			this.warn(cursor, `Unclosed object member list for ${name}.`);
			return {nextIndex: endIndex, value: null};
		}

		const attributes: ObjectAttributeDoc[] = [];
		const methods: RoutineDoc[] = [];
		for (const range of this.splitTopLevel(this.nextVisibleIndex(cursor), this.previousVisibleIndex(closeIndex), ',')) {
			const memberStart: number = this.firstVisibleInRange(range.start, range.end);
			const routineIndex: number = this.findRoutineKeyword(memberStart, range.end);
			if (routineIndex >= 0) {
				const modifiers: string[] = this.visibleIndices(memberStart, this.previousVisibleIndex(routineIndex))
					.map((index: number): string => this.textUpper(index))
					.filter((modifier: string): boolean => ROUTINE_MODIFIERS.has(modifier));
				const parsed: Parsed<RoutineDoc> = this.parseRoutine(routineIndex, memberStart, range.end, modifiers);
				if (parsed.value !== null) {
					methods.push(parsed.value);
				}
				continue;
			}

			const field: FieldDoc | null = this.parseField(range);
			if (field !== null) {
				attributes.push({...field, kind: 'ATTRIBUTE'});
			}
		}

		return {
			nextIndex: endIndex,
			value: {
				attributes,
				declaration: this.renderRange(startIndex, endIndex),
				doc: doc ?? this.extractTrailingLineDoc(endIndex),
				kind: 'OBJECT_TYPE',
				location: this.location(startIndex),
				methods,
				name,
				supertype,
			},
		};
	}

	private skipCreateModifiers(createIndex: number): number {
		let cursor: number = this.nextVisibleIndex(createIndex);
		if (this.isKeyword(cursor, 'OR') && this.isKeyword(this.nextVisibleIndex(cursor), 'REPLACE')) {
			cursor = this.nextVisibleIndex(this.nextVisibleIndex(cursor));
		}
		while (this.isKeyword(cursor, 'EDITIONABLE') || this.isKeyword(cursor, 'NONEDITIONABLE') || this.isKeyword(cursor, 'FORCE')) {
			cursor = this.nextVisibleIndex(cursor);
		}
		return cursor;
	}

	private findDeclarationEnd(startIndex: number): number {
		let parenthesisDepth = 0;
		let caseDepth = 0;
		for (let index = startIndex; index < this.tokens.length; index++) {
			if (this.isTrivia(index)) {
				continue;
			}
			const text: string = this.text(index);
			if (text === '(') {
				parenthesisDepth++;
			} else if (text === ')') {
				parenthesisDepth = Math.max(0, parenthesisDepth - 1);
			} else if (this.isKeyword(index, 'CASE')) {
				caseDepth++;
			} else if (this.isKeyword(index, 'END') && caseDepth > 0) {
				caseDepth--;
			} else if (text === ';' && parenthesisDepth === 0 && caseDepth === 0) {
				return index;
			}
		}
		this.warn(startIndex, 'Declaration has no terminating semicolon.');
		return this.tokens.length - 1;
	}

	private findUnitEnd(startIndex: number): number {
		for (let index = startIndex; index < this.tokens.length; index++) {
			if (this.text(index) === '/' && !this.hasVisibleTokenBeforeOnLine(index) && !this.hasVisibleTokenAfterOnLine(index)) {
				return index;
			}
		}
		return this.findDeclarationEnd(startIndex);
	}

	private findStandaloneTypeEnd(startIndex: number): number {
		let depth = 0;
		for (let index = startIndex; index < this.tokens.length; index++) {
			if (this.isTrivia(index)) {
				continue;
			}
			if (this.text(index) === '(') {
				depth++;
			} else if (this.text(index) === ')') {
				depth = Math.max(0, depth - 1);
			} else if (this.text(index) === ';' && depth === 0) {
				return index;
			} else if (this.text(index) === '/' && depth === 0 && !this.hasVisibleTokenBeforeOnLine(index) && !this.hasVisibleTokenAfterOnLine(index)) {
				return this.previousVisibleIndex(index);
			}
		}
		this.warn(startIndex, 'Declaration has no terminating semicolon or SQL*Plus slash.');
		return this.tokens.length - 1;
	}

	private findVisibleLineEnd(startIndex: number): number {
		const line: number = this.tokens[startIndex].line;
		let endIndex: number = startIndex;
		for (let index = startIndex + 1; index < this.tokens.length; index++) {
			if (this.tokens[index].line !== line) {
				break;
			}
			if (!this.isTrivia(index)) {
				endIndex = index;
			}
		}
		return endIndex;
	}

	private findBalancedClose(openIndex: number, boundary: number): number | null {
		let depth = 0;
		for (let index = openIndex; index <= boundary; index++) {
			if (this.isTrivia(index)) {
				continue;
			}
			if (this.text(index) === '(') {
				depth++;
			} else if (this.text(index) === ')') {
				depth--;
				if (depth === 0) {
					return index;
				}
			}
		}
		return null;
	}

	private splitTopLevel(startIndex: number, endIndex: number, delimiter: string): TokenRange[] {
		if (startIndex < 0 || endIndex < startIndex) {
			return [];
		}
		const ranges: TokenRange[] = [];
		let rangeStart: number = startIndex;
		let depth = 0;
		let caseDepth = 0;
		for (let index = startIndex; index <= endIndex; index++) {
			if (this.isTrivia(index)) {
				continue;
			}
			if (this.text(index) === '(') {
				depth++;
			} else if (this.text(index) === ')') {
				depth--;
			} else if (this.isKeyword(index, 'CASE')) {
				caseDepth++;
			} else if (this.isKeyword(index, 'END') && caseDepth > 0) {
				caseDepth--;
			} else if (this.text(index) === delimiter && depth === 0 && caseDepth === 0) {
				ranges.push({delimiter: index, end: this.previousVisibleIndex(index), start: rangeStart});
				rangeStart = this.nextVisibleIndex(index);
			}
		}
		if (rangeStart >= 0 && rangeStart <= endIndex) {
			ranges.push({delimiter: null, end: endIndex, start: rangeStart});
		}
		return ranges.filter((range: TokenRange): boolean => this.firstVisibleInRange(range.start, range.end) >= 0);
	}

	private readQualifiedName(startIndex: number): {readonly name: string; readonly nextIndex: number} | null {
		if (!this.isIdentifier(startIndex)) {
			return null;
		}
		const parts: string[] = [this.text(startIndex)];
		let cursor: number = startIndex;
		let dotIndex: number = this.nextVisibleIndex(cursor);
		while (this.text(dotIndex) === '.') {
			const identifierIndex: number = this.nextVisibleIndex(dotIndex);
			if (!this.isIdentifier(identifierIndex)) {
				break;
			}
			parts.push('.', this.text(identifierIndex));
			cursor = identifierIndex;
			dotIndex = this.nextVisibleIndex(cursor);
		}
		return {name: parts.join(''), nextIndex: this.nextVisibleIndex(cursor)};
	}

	private renderRange(startIndex: number, endIndex: number): string {
		return this.renderIndices(this.visibleIndices(startIndex, endIndex));
	}

	private renderIndices(indices: readonly number[]): string {
		let rendered = '';
		let previous = '';
		for (const index of indices) {
			const current: string = this.text(index);
			const noSpaceBefore: boolean = rendered.length === 0 || current.startsWith('%') || [')', ',', '.', ';', '(', '[', ']'].includes(current);
			const noSpaceAfterPrevious: boolean = ['(', '[', '.', '%', ','].includes(previous);
			const separator: string = noSpaceBefore || noSpaceAfterPrevious ? '' : ' ';
			rendered += `${separator}${current}`;
			previous = current;
		}
		return rendered.trim();
	}

	private extractLeadingDoc(index: number): DocComment | null {
		let cursor: number = index - 1;
		while (cursor >= 0 && this.tokens[cursor]?.type === PlSqlLexer.SPACES) {
			cursor--;
		}
		if (cursor < 0) {
			return null;
		}
		const closest: Token = this.tokens[cursor];
		const rawText: string = closest.text ?? '';
		if (!PLSqlDocScanner.isCommentToken(closest) || PLSqlDocScanner.isMetadataLineComment(rawText)) {
			return null;
		}
		if (rawText.startsWith('/**')) {
			const endLine: number = closest.line + (rawText.match(/\n/gu)?.length ?? 0);
			return (this.tokens[index]?.line ?? 0) <= endLine + 1 ? parseDocComment(rawText) : null;
		}
		if (!rawText.startsWith('--') || PLSqlDocScanner.isSeparatorLineComment(rawText)) {
			return null;
		}

		const comments: string[] = [];
		let expectedLine: number = this.tokens[index]?.line ?? 0;
		while (cursor >= 0) {
			const token: Token = this.tokens[cursor];
			if (token.type === PlSqlLexer.SPACES) {
				cursor--;
				continue;
			}
			const text: string = token.text ?? '';
			if (
				token.type !== PlSqlLexer.SINGLE_LINE_COMMENT ||
				token.line !== expectedLine - 1 ||
				this.hasVisibleTokenBeforeOnLine(cursor) ||
				PLSqlDocScanner.isSeparatorLineComment(text) ||
				PLSqlDocScanner.isMetadataLineComment(text)
			) {
				break;
			}
			comments.unshift(text);
			expectedLine = token.line;
			cursor--;
		}
		return comments.length === 0 ? null : parseDocComment(comments.join('\n'));
	}

	private extractEmbeddedDoc(startIndex: number, endIndex: number): DocComment | null {
		for (let index = startIndex + 1; index < endIndex; index++) {
			const rawText: string = this.tokens[index]?.text ?? '';
			if (this.tokens[index]?.type === PlSqlLexer.MULTI_LINE_COMMENT && rawText.startsWith('/**')) {
				return parseDocComment(rawText);
			}
		}
		return null;
	}

	private extractPackagePreambleDoc(headerEndIndex: number, firstDeclarationIndex: number): DocComment | null {
		for (let index = headerEndIndex + 1; index < firstDeclarationIndex; index++) {
			const token: Token = this.tokens[index];
			const rawText: string = token.text ?? '';
			if (token.type !== PlSqlLexer.MULTI_LINE_COMMENT || !rawText.startsWith('/**')) {
				continue;
			}
			const endLine: number = token.line + (rawText.match(/\n/gu)?.length ?? 0);
			if ((this.tokens[firstDeclarationIndex]?.line ?? endLine) > endLine + 1) {
				return parseDocComment(rawText);
			}
		}
		return null;
	}

	private extractTrailingForRange(range: TokenRange): DocComment | null {
		const fieldEnd: number = range.delimiter !== null && this.tokens[range.delimiter].line === this.tokens[range.end].line ? range.delimiter : range.end;
		return this.extractTrailingLineDoc(fieldEnd);
	}

	private extractTrailingLineDoc(index: number): DocComment | null {
		const line: number = index < 0 || index >= this.tokens.length ? -1 : this.tokens[index].line;
		let cursor: number = index + 1;
		while (cursor < this.tokens.length && this.tokens[cursor].type === PlSqlLexer.SPACES) {
			cursor++;
		}
		if (cursor >= this.tokens.length) {
			return null;
		}
		const token: Token = this.tokens[cursor];
		const rawText: string = token.text ?? '';
		if (token.type !== PlSqlLexer.SINGLE_LINE_COMMENT || token.line !== line || !rawText.startsWith('--') || PLSqlDocScanner.isMetadataLineComment(rawText)) {
			return null;
		}
		return parseDocComment(rawText);
	}

	private findKeyword(startIndex: number, endIndex: number, keyword: string): number {
		for (let index = startIndex; index <= endIndex; index++) {
			if (this.isKeyword(index, keyword)) {
				return index;
			}
		}
		return -1;
	}

	private findRoutineKeyword(startIndex: number, endIndex: number): number {
		for (let index = startIndex; index <= endIndex; index++) {
			if (this.isRoutineKeyword(index)) {
				return index;
			}
		}
		return -1;
	}

	private visibleIndices(startIndex: number, endIndex: number): number[] {
		const indices: number[] = [];
		for (let index = Math.max(0, startIndex); index <= endIndex && index < this.tokens.length; index++) {
			if (!this.isTrivia(index) && !this.isEof(index)) {
				indices.push(index);
			}
		}
		return indices;
	}

	private firstVisibleInRange(startIndex: number, endIndex: number): number {
		for (let index = Math.max(0, startIndex); index <= endIndex; index++) {
			if (!this.isTrivia(index)) {
				return index;
			}
		}
		return -1;
	}

	private nextVisibleIndex(currentIndex: number): number {
		for (let index = currentIndex + 1; index < this.tokens.length; index++) {
			if (!this.isTrivia(index)) {
				return index;
			}
		}
		return -1;
	}

	private previousVisibleIndex(currentIndex: number): number {
		for (let index = currentIndex - 1; index >= 0; index--) {
			if (!this.isTrivia(index)) {
				return index;
			}
		}
		return -1;
	}

	private hasVisibleTokenBeforeOnLine(index: number): boolean {
		const line: number = this.tokens[index]?.line ?? -1;
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

	private hasVisibleTokenAfterOnLine(index: number): boolean {
		const line: number = this.tokens[index]?.line ?? -1;
		for (let cursor = index + 1; cursor < this.tokens.length; cursor++) {
			const token: Token = this.tokens[cursor];
			if (token.type === Token.EOF) {
				return false;
			}
			if (token.line !== line) {
				return false;
			}
			if (!PLSqlDocScanner.isTriviaToken(token)) {
				return true;
			}
		}
		return false;
	}

	private isRoutineKeyword(index: number): boolean {
		return this.isKeyword(index, 'PROCEDURE') || this.isKeyword(index, 'FUNCTION');
	}

	private isIdentifier(index: number): boolean {
		if (index < 0 || index >= this.tokens.length) {
			return false;
		}
		const token: Token = this.tokens[index];
		return token.type === PlSqlLexer.DELIMITED_ID || /^\p{Letter}[\p{Letter}0-9_$#]*$/u.test(token.text ?? '');
	}

	private isTrivia(index: number): boolean {
		return index < 0 || index >= this.tokens.length || PLSqlDocScanner.isTriviaToken(this.tokens[index]);
	}

	private static isTriviaToken(token: Token): boolean {
		return token.channel === Token.HIDDEN_CHANNEL;
	}

	private static isCommentToken(token: Token): boolean {
		return token.type === PlSqlLexer.SINGLE_LINE_COMMENT || token.type === PlSqlLexer.MULTI_LINE_COMMENT;
	}

	private static isSeparatorLineComment(rawText: string): boolean {
		return /^--\s*-{3,}\s*$/u.test(rawText);
	}

	private static isMetadataLineComment(rawText: string): boolean {
		return rawText.startsWith('--') && /\$Id(?::[^$]*)?\$/u.test(rawText);
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
		return {column: token.column, filePath: this.filePath, line: token.line};
	}

	private warn(index: number, message: string): void {
		const location: SourceLocation = this.location(index);
		this.warnings.push(`${location.filePath ?? '<input>'}:${location.line}:${location.column}: ${message}`);
	}
}
