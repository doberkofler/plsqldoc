import {
	type DocComment,
	type DocTag,
	isRoutineDoc,
	type ObjectTypeDoc,
	type PackageDoc,
	type PackageMemberDoc,
	type ParameterDoc,
	type ProjectDoc,
	type RoutineDoc,
	type SourceLocation,
} from './ast.js';

const IGNORE_UNDOCUMENTED_TAG = 'plsqldoc-ignore-undocumented';
const SUPPORTED_IGNORE_UNDOCUMENTED_VALUE = 'constant';

type PackageValidationPolicy = {
	readonly ignoreUndocumentedConstants: boolean;
	readonly warnings: readonly string[];
};

const formatWarning = (location: SourceLocation, message: string): string =>
	`${location.filePath ?? '<input>'}:${location.line}:${location.column}: ${message}`;

const hasDescription = (doc: DocComment | null): boolean => (doc?.description.trim().length ?? 0) > 0;

const tagsNamed = (doc: DocComment | null, name: string): readonly DocTag[] =>
	doc?.tags.filter((tag: DocTag): boolean => tag.name.toLowerCase() === name) ?? [];

const packageValidationPolicy = (pkg: PackageDoc): PackageValidationPolicy => {
	const values = new Set(tagsNamed(pkg.doc, IGNORE_UNDOCUMENTED_TAG).map((tag: DocTag): string => tag.value.trim().toLowerCase()));
	const warnings: string[] = [];
	for (const value of values) {
		if (value !== SUPPORTED_IGNORE_UNDOCUMENTED_VALUE) {
			warnings.push(
				formatWarning(
					pkg.location,
					`Invalid @${IGNORE_UNDOCUMENTED_TAG} value "${value || '<empty>'}" in package ${pkg.name}. Supported value: ${SUPPORTED_IGNORE_UNDOCUMENTED_VALUE}.`,
				),
			);
		}
	}
	return {
		ignoreUndocumentedConstants: values.has(SUPPORTED_IGNORE_UNDOCUMENTED_VALUE),
		warnings,
	};
};

const parameterNameFromTag = (tag: DocTag): string => tag.value.trim().split(/\s+/u, 1)[0] ?? '';

const validateParameters = (parameters: readonly ParameterDoc[], ownerName: string, doc: DocComment | null, ownerLocation: SourceLocation): string[] => {
	const warnings: string[] = [];
	const parameterTags: readonly DocTag[] = tagsNamed(doc, 'param');
	for (const parameter of parameters) {
		const matchingTags: readonly DocTag[] = parameterTags.filter(
			(tag: DocTag): boolean => parameterNameFromTag(tag).toLowerCase() === parameter.name.toLowerCase(),
		);
		if (matchingTags.length === 0 || parameter.doc === null || parameter.doc.trim() === '') {
			warnings.push(formatWarning(parameter.location, `Undocumented parameter ${parameter.name} in ${ownerName}.`));
		} else if (matchingTags.length > 1) {
			warnings.push(formatWarning(parameter.location, `Duplicate @param documentation for ${parameter.name} in ${ownerName}.`));
		}
	}
	for (const tag of parameterTags) {
		const parameterName: string = parameterNameFromTag(tag);
		if (!parameters.some((parameter: ParameterDoc): boolean => parameter.name.toLowerCase() === parameterName.toLowerCase())) {
			warnings.push(formatWarning(ownerLocation, `Unknown @param ${parameterName || '<missing>'} in ${ownerName}.`));
		}
	}
	return warnings;
};

const validateRoutine = (routine: RoutineDoc): string[] => {
	const warnings: string[] = [];
	if (!hasDescription(routine.doc)) {
		warnings.push(formatWarning(routine.location, `Undocumented ${routine.kind.toLowerCase()} ${routine.name}.`));
	}
	warnings.push(...validateParameters(routine.parameters, routine.name, routine.doc, routine.location));
	const returnTags: readonly DocTag[] = tagsNamed(routine.doc, 'return');
	if (routine.kind === 'FUNCTION') {
		if (returnTags.length === 0 || routine.returnDoc === null || routine.returnDoc.trim() === '') {
			warnings.push(formatWarning(routine.location, `Undocumented return value for function ${routine.name}.`));
		} else if (returnTags.length > 1) {
			warnings.push(formatWarning(routine.location, `Duplicate @return documentation for function ${routine.name}.`));
		}
	} else if (returnTags.length > 0) {
		warnings.push(formatWarning(routine.location, `Unexpected @return documentation for procedure ${routine.name}.`));
	}
	return warnings;
};

const validatePackageMember = (member: PackageMemberDoc): string[] => {
	if (isRoutineDoc(member)) {
		return validateRoutine(member);
	}
	const warnings: string[] = [];
	if (!hasDescription(member.doc)) {
		warnings.push(formatWarning(member.location, `Undocumented ${member.kind.toLowerCase()} ${member.name}.`));
	}
	if (member.kind === 'RECORD') {
		for (const field of member.fields) {
			if (!hasDescription(field.doc)) {
				warnings.push(formatWarning(field.location, `Undocumented field ${field.name} in ${member.name}.`));
			}
		}
	}
	if (member.kind === 'CURSOR') {
		warnings.push(...validateParameters(member.parameters, member.name, member.doc, member.location));
	}
	return warnings;
};

const validateObjectType = (type: ObjectTypeDoc): string[] => {
	const warnings: string[] = [];
	for (const attribute of type.attributes) {
		if (!hasDescription(attribute.doc)) {
			warnings.push(formatWarning(attribute.location, `Undocumented attribute ${attribute.name} in ${type.name}.`));
		}
	}
	for (const method of type.methods) {
		warnings.push(...validateRoutine(method));
	}
	return warnings;
};

/**
 * Reports every public declaration surface lacking documentation.
 *
 * @param project Documentation project to validate.
 * @returns Source-located missing-documentation warnings.
 */
export const findUndocumentedDeclarations = (project: ProjectDoc): readonly string[] => {
	const warnings: string[] = [];
	for (const pkg of project.packages) {
		const policy: PackageValidationPolicy = packageValidationPolicy(pkg);
		warnings.push(...policy.warnings);
		if (!hasDescription(pkg.doc)) {
			warnings.push(formatWarning(pkg.location, `Undocumented package ${pkg.name}.`));
		}
		for (const member of pkg.members) {
			if (policy.ignoreUndocumentedConstants && member.kind === 'CONSTANT') {
				continue;
			}
			warnings.push(...validatePackageMember(member));
		}
	}
	for (const type of project.types) {
		if (!hasDescription(type.doc)) {
			warnings.push(formatWarning(type.location, `Undocumented type ${type.name}.`));
		}
		if (type.kind === 'OBJECT_TYPE') {
			warnings.push(...validateObjectType(type));
		}
	}
	for (const routine of project.routines) {
		warnings.push(...validateRoutine(routine));
	}
	return warnings;
};
