# TODO

## Deferred Parser Hardening

- Integrate the full upstream `antlr/grammars-v4/sql/plsql/PlSqlLexer.g4` once the API extraction behavior is stable.
- Port or adapt `PlSqlLexerBase` to `antlr4ng`; the upstream TypeScript helper currently targets a different ANTLR runtime.
- Validate `antlr-ng` compatibility with upstream lexer options such as `caseInsensitive = true` and `superClass = PlSqlLexerBase`.
- Replace the current pragmatic lexer subset only after full upstream lexer generation, runtime behavior, and tests are passing.
- Add fixtures for Oracle edge cases covered by the full lexer: alternative quoting, quoted identifiers, national character literals, hints, compiler directives, and SQL*Plus separators.

## Documentation Model

- Add support for documenting object types and trigger declarations if they become part of the public API scope.
- Add source links and exact source ranges once source maps/locations are tracked beyond declaration starts.
- Add warnings for undocumented public routines and undocumented parameters.

## Renderer

- Add search and symbol filtering for larger codebases.
- Split shared CSS into a static asset when multiple themes are introduced.
- Add a JSON output mode for downstream tooling and snapshot testing.

## CLI

- Add an option to include package body routines when teams intentionally document private/internal implementation APIs.
- Add configuration file support for large projects.
