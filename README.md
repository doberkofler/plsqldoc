# pldoc-ts

Modern static documentation generator for Oracle PL/SQL APIs.

The tool scans PL/SQL source files, extracts package and routine declarations with PLDoc/Javadoc-style comments, and renders static HTML documentation.

## Install

```sh
pnpm install
```

## Build

```sh
pnpm antlr
pnpm build
```

## Demo

The `examples/` directory contains package specs, package bodies, and standalone routine files that show how real PL/SQL input is processed.

```sh
pnpm antlr
pnpm build
pnpm start -- ./examples -o ./docs --verbose
```

Open `docs/index.html` in a browser after the command completes.

The demo demonstrates:

- Package-level `/** */` documentation.
- Procedure and function declarations from a package spec.
- `@param` and `@return` tag extraction.
- Standalone procedure extraction from `.sql` files.
- Package body implementation routines ignored by default.

## Quality Checks

```sh
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
```

Run all checks with:

```sh
pnpm check
```

## CLI

```sh
pldoc <directories...> [options]
```

Options:

- `-o, --out <directory>`: Output directory. Defaults to `./docs`.
- `-p, --pattern <pattern>`: Source glob. Defaults to `**/*.{sql,pks,pkb}`.
- `-v, --verbose`: Print parsed file counts.
- `--fail-on-warning`: Exit non-zero when parser warnings are emitted.

## Parser Strategy

This project intentionally uses a lexer-first scanner rather than a full PL/SQL parser. The scanner focuses on public API declarations and documentation comments, similar to TypeDoc's declaration-oriented model.
