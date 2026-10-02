export type ParamMode = 'IN' | 'OUT' | 'IN OUT';

export type SourceLocation = {
	readonly filePath: string | null;
	readonly line: number;
	readonly column: number;
};

export type DocTag = {
	readonly name: string;
	readonly value: string;
};

export type DocComment = {
	readonly raw: string;
	readonly description: string;
	readonly tags: readonly DocTag[];
};

export type ParameterDoc = {
	readonly name: string;
	readonly mode: ParamMode;
	readonly type: string;
	readonly defaultValue: string | null;
	readonly doc: string | null;
	readonly location: SourceLocation;
};

export type RoutineDoc = {
	readonly kind: 'PROCEDURE' | 'FUNCTION';
	readonly name: string;
	readonly declaration: string;
	readonly parameters: readonly ParameterDoc[];
	readonly returnType: string | null;
	readonly returnDoc: string | null;
	readonly modifiers: readonly string[];
	readonly doc: DocComment | null;
	readonly location: SourceLocation;
};

export type FieldDoc = {
	readonly name: string;
	readonly type: string;
	readonly defaultValue: string | null;
	readonly doc: DocComment | null;
	readonly declaration: string;
	readonly location: SourceLocation;
};

export type RecordTypeDoc = {
	readonly kind: 'RECORD';
	readonly name: string;
	readonly fields: readonly FieldDoc[];
	readonly declaration: string;
	readonly doc: DocComment | null;
	readonly location: SourceLocation;
};

export type CollectionTypeDoc = {
	readonly kind: 'ASSOCIATIVE_ARRAY' | 'NESTED_TABLE' | 'VARRAY';
	readonly name: string;
	readonly elementType: string;
	readonly indexType: string | null;
	readonly bound: string | null;
	readonly declaration: string;
	readonly doc: DocComment | null;
	readonly location: SourceLocation;
};

export type RefCursorTypeDoc = {
	readonly kind: 'REF_CURSOR';
	readonly name: string;
	readonly returnType: string | null;
	readonly declaration: string;
	readonly doc: DocComment | null;
	readonly location: SourceLocation;
};

export type SubtypeDoc = {
	readonly kind: 'SUBTYPE';
	readonly name: string;
	readonly baseType: string;
	readonly declaration: string;
	readonly doc: DocComment | null;
	readonly location: SourceLocation;
};

export type ValueDoc = {
	readonly kind: 'CONSTANT' | 'VARIABLE';
	readonly name: string;
	readonly type: string;
	readonly value: string | null;
	readonly declaration: string;
	readonly doc: DocComment | null;
	readonly location: SourceLocation;
};

export type ExceptionDoc = {
	readonly kind: 'EXCEPTION';
	readonly name: string;
	readonly declaration: string;
	readonly doc: DocComment | null;
	readonly location: SourceLocation;
};

export type CursorDoc = {
	readonly kind: 'CURSOR';
	readonly name: string;
	readonly parameters: readonly ParameterDoc[];
	readonly returnType: string | null;
	readonly declaration: string;
	readonly doc: DocComment | null;
	readonly location: SourceLocation;
};

export type UnsupportedMemberDoc = {
	readonly kind: 'UNSUPPORTED';
	readonly name: string;
	readonly declaration: string;
	readonly doc: DocComment | null;
	readonly location: SourceLocation;
};

export type PackageMemberDoc =
	| RoutineDoc
	| RecordTypeDoc
	| CollectionTypeDoc
	| RefCursorTypeDoc
	| SubtypeDoc
	| ValueDoc
	| ExceptionDoc
	| CursorDoc
	| UnsupportedMemberDoc;

export type PackageDoc = {
	readonly kind: 'PACKAGE';
	readonly name: string;
	readonly declaration: string;
	readonly doc: DocComment | null;
	readonly members: readonly PackageMemberDoc[];
	readonly location: SourceLocation;
};

export type ObjectAttributeDoc = FieldDoc & {
	readonly kind: 'ATTRIBUTE';
};

export type ObjectTypeDoc = {
	readonly kind: 'OBJECT_TYPE';
	readonly name: string;
	readonly supertype: string | null;
	readonly attributes: readonly ObjectAttributeDoc[];
	readonly methods: readonly RoutineDoc[];
	readonly declaration: string;
	readonly doc: DocComment | null;
	readonly location: SourceLocation;
};

export type SchemaCollectionTypeDoc = CollectionTypeDoc & {
	readonly kind: 'NESTED_TABLE' | 'VARRAY';
};

export type StandaloneTypeDoc = ObjectTypeDoc | SchemaCollectionTypeDoc;

export type SourceFileDoc = {
	readonly filePath: string | null;
	readonly packages: readonly PackageDoc[];
	readonly routines: readonly RoutineDoc[];
	readonly types: readonly StandaloneTypeDoc[];
	readonly warnings: readonly string[];
};

export type ProjectDoc = {
	readonly packages: readonly PackageDoc[];
	readonly routines: readonly RoutineDoc[];
	readonly types: readonly StandaloneTypeDoc[];
	readonly warnings: readonly string[];
};

/**
 * Returns whether a package member is a routine declaration.
 *
 * @param member Package member to test.
 * @returns Whether the member is a procedure or function.
 */
export const isRoutineDoc = (member: PackageMemberDoc): member is RoutineDoc => member.kind === 'PROCEDURE' || member.kind === 'FUNCTION';
