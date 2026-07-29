# AGENTS.md

## Project Overview

This project is `plsqldoc`, a TypeScript CLI documentation generator for Oracle PL/SQL code, similar in spirit to TypeDoc but focused on PL/SQL package APIs and standalone routines.

The intended architecture is:

- Use `antlr-ng` and `antlr4ng` for pure TypeScript PL/SQL lexing.
- Generate lexer code from `PlSqlLexer.g4`.
- Use a lexer-first, hand-written scanner over tokens for API declaration extraction.
- Avoid the full ANTLR parser grammar unless there is a clear need.
- Render static HTML documentation from the extracted project AST.

## Important Files

- `src/index.ts`: CLI entrypoint using Commander and glob input discovery.
- `src/scanner.ts`: PL/SQL token scanner and signature extractor.
- `src/doc-parser.ts`: PLDoc/Javadoc-style comment parser.
- `src/ast.ts`: Documentation AST types.
- `src/renderer.ts`: Static HTML renderer.
- `src/*.test.ts`: Vitest tests colocated with source modules.
- `tests/fixtures/`: PL/SQL fixture files for scanner/renderer tests.
- `examples/`: Demo PL/SQL input files used by the integration demo.
- `PlSqlLexer.g4`: Source grammar for generated lexer code.
- `src/generated/`: Generated lexer artifacts. Do not edit these manually.
- `vite.config.ts`: Vite CLI build and Vitest coverage configuration.
- `oxc.config.ts`: Shared oxlint/oxfmt defaults and ignore patterns.
- `oxlint.config.ts`: Project oxlint override hook.
- `oxfmt.config.ts`: Project oxfmt override hook.
- `TODO.md`: Deferred parser and product hardening items.
- `.release-it.json`: Release workflow configuration.
- `commitlint.config.js`: Conventional commit lint configuration.
- `dist/`, `docs/`, `coverage/`: Generated output. Do not edit these manually.

## Commands

Use pnpm.

- Install dependencies: `pnpm install`
- Regenerate lexer: `pnpm antlr`
- Type-check: `pnpm typecheck`
- Lint: `pnpm lint`
- Format: `pnpm format`
- Check formatting: `pnpm format:check`
- Build with Vite: `pnpm build`
- Test with coverage: `pnpm test`
- Full CI verification: `pnpm run ci`
- Watch build: `pnpm dev`
- Demo/integration run: `pnpm run integration-test`
- Direct CLI demo after build: `node dist/index.js ./examples -o ./docs --verbose`

Use the existing `oxlint.config.ts` and `oxfmt.config.ts` files for linting and formatting.

## Coding Guidelines

- Keep the parser strategy lexer-first and scanner-based.
- Avoid regex-only PL/SQL parsing for syntax-sensitive behavior.
- Prefer small, direct changes over large abstractions.
- Keep TypeScript strict-mode clean.
- Preserve the existing style:
- Tabs for indentation.
- Single quotes.
- ESM imports with `.js` extensions for local TypeScript modules.
- Inline type-only import specifiers, matching the current lint profile.
- Explicit types where the current code uses them.
- Do not add Java, C, C++, or native parser dependencies.
- Do not change lint rules, lint categories, or lint config behavior without explicit user approval.
- Document intentionally deferred production hardening work in `TODO.md`.
- Do not edit generated files under `src/generated/` directly. Update `PlSqlLexer.g4` and run `pnpm antlr` instead.
- Do not edit generated output under `dist/`, `docs/`, or `coverage/` directly. Update source files and rerun the relevant command.

## Parser Scope

The current scope is signature and documentation extraction, not full PL/SQL semantic analysis.

Prefer supporting:

- `CREATE [OR REPLACE] PACKAGE` package specs.
- Package-level documentation comments.
- Public `PROCEDURE` declarations.
- Public `FUNCTION` declarations.
- Standalone `CREATE [OR REPLACE] PROCEDURE` declarations.
- Standalone `CREATE [OR REPLACE] FUNCTION` declarations.
- Parameter names, modes, types, defaults, and `@param` descriptions.
- Function return types and `@return` descriptions.
- PLDoc/Javadoc-style tags such as `@param`, `@return`, `@author`, and unknown tags.

Package body implementation routines are ignored by default. Object types, triggers, private/body APIs, JSON output, search, and full upstream lexer integration are deferred in `TODO.md`.

Avoid expanding into full statement/body parsing unless explicitly required.

## Documentation Comments

Supported comment styles should remain PLDoc/Javadoc-like:

- Block comments beginning with `/**`.
- Contiguous line comments beginning with `--`.
- Tags in the form `@tag content`.

When changing doc parsing, preserve description extraction, repeated tag collection, parameter tag attachment, and return tag attachment unless intentionally redesigning the format.

## Verification

Before considering code changes complete, run:

```sh
pnpm run ci
```

If lexer grammar changes were made, run:

```sh
pnpm antlr
pnpm run ci
```

For CLI/demo behavior changes, also run:

```sh
pnpm run integration-test
```
