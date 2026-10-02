# TODO

## Deferred Parser Hardening

- Add fixtures for remaining Oracle edge cases covered by the full lexer: national character literals, hints, compiler directives, and SQL*Plus separators.

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
