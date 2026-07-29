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
};

export type RoutineDoc = {
	readonly kind: 'PROCEDURE' | 'FUNCTION';
	readonly name: string;
	readonly parameters: readonly ParameterDoc[];
	readonly returnType: string | null;
	readonly returnDoc: string | null;
	readonly doc: DocComment | null;
	readonly location: SourceLocation;
};

export type PackageDoc = {
	readonly name: string;
	readonly doc: DocComment | null;
	readonly routines: readonly RoutineDoc[];
	readonly location: SourceLocation;
};

export type SourceFileDoc = {
	readonly filePath: string | null;
	readonly packages: readonly PackageDoc[];
	readonly routines: readonly RoutineDoc[];
	readonly warnings: readonly string[];
};

export type ProjectDoc = {
	readonly packages: readonly PackageDoc[];
	readonly routines: readonly RoutineDoc[];
	readonly warnings: readonly string[];
};
