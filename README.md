# plsqldoc

Modern static documentation generator for Oracle PL/SQL APIs.

The tool scans PL/SQL source files, extracts the public declaration surface of packages, standalone object and collection types, and standalone routines, then renders static HTML documentation.

## Usage

No project installation is required. Run the published CLI directly with:

```sh
pnpm dlx plsqldoc ./packages -o ./docs --clean
```

or with npm:

```sh
npx plsqldoc ./packages -o ./docs --clean
```

To install it into a project instead:

```sh
pnpm add -D plsqldoc
pnpm exec plsqldoc ./packages -o ./docs --clean
```

Open `docs/index.html` in a browser after the command completes.

## CLI

```sh
plsqldoc <directories...> [options]
```

Options:

- `-o, --out <directory>`: Output directory. Defaults to `./docs`.
- `--extensions <extensions>`: Comma-separated source extensions. Defaults to `.pks,.pkb,.pkg,.typ,.tyb,.tps,.tpb,.prc,.fnc`.
- `-p, --pattern <pattern>`: Advanced source glob override. Takes precedence over `--extensions`.
- `--clean`: Remove the output directory before generating documentation.
- `--exclude <patterns...>`: Glob pattern(s) to exclude from input discovery.
- `-r, --recursive`: Recursively discover source files. By default, only files directly inside each supplied directory are scanned.
- `-v, --verbose`: Add per-directory and per-file counts. The aggregate summary is always printed.
- `--fail-on-warning`: Exit non-zero when parser warnings are emitted.
- `--fail-on-undocumented`: Exit non-zero when a public declaration, field, attribute, parameter, or function return is undocumented.

Default extensions:

| Extension | Purpose |
| --- | --- |
| `.pks` | Package specifications |
| `.pkb` | Package bodies; public body declarations remain ignored |
| `.pkg` | Package specifications using the newer global convention |
| `.tps` | Object type specifications |
| `.tpb` | Object type bodies; public body declarations remain ignored |
| `.typ` | Object type specifications using the newer global convention |
| `.tyb` | Object type bodies using the newer global convention; public body declarations remain ignored |
| `.prc` | Standalone procedures |
| `.fnc` | Standalone functions |

Explicit extensions replace this list rather than augmenting it. Leading dots are optional, and extension values are normalized to lowercase:

```sh
plsqldoc ./packages --extensions .sql,.pks,.fnc
```

`.sql` is opt-in because general SQL and installation scripts commonly contain duplicate or unrelated declarations. Extensions such as `.trg` and `.pls` are also not enabled by default, but can be selected explicitly. Use `--pattern` when discovery cannot be expressed as an extension list.

Directory discovery is non-recursive by default. Add `--recursive` to scan subdirectories. An explicit `--pattern` controls its own depth and takes precedence over `--recursive`.

Example excluding test packages:

```sh
pnpm dlx plsqldoc ./packages -o ./docs --clean --recursive --verbose --exclude '**/tst_*'
```

## Demo From Source

The `examples/` directory contains package specs, package bodies, and standalone routine files that show how real PL/SQL input is processed.

```sh
pnpm install
pnpm grammar:generate
pnpm build
node dist/index.js ./examples -o ./docs --verbose --extensions .sql,.pks,.pkb,.tps
```

The demo demonstrates:

- Package-level `/** */` documentation with multiline `@example` and repeated `@see` tags.
- Contiguous `--` documentation comments.
- Procedure and function declarations from a package spec.
- `@param` and `@return` tag extraction.
- Standalone procedure extraction from `.sql` files.
- Package members including records, collections, ref cursors, subtypes, constants, exceptions, cursors, and variables.
- Standalone object and schema collection types.
- Package and type body implementation details ignored.

## Development

Install dependencies and build from source with:

```sh
pnpm install
pnpm grammar:generate
pnpm build
```

Run individual checks with:

```sh
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm test:integration
pnpm build
```

Run all checks with:

```sh
pnpm run ci
```

## Documentation Comments

Documentation comments can be written as PLDoc/Javadoc-style block comments beginning with `/**` or as contiguous `--` line comments immediately before a declaration. Section separator comments such as `-- -----` are treated as boundaries, so banner headings are not attached to the following routine. A same-line trailing `--` comment after a routine declaration can document that routine when no leading documentation comment is present.

Canonical top-level documentation remains inside the stored Oracle source so it is visible through source views such as `USER_SOURCE`. Put package documentation in the package preamble after `AS` or `IS` and after any `$Id$` comment. Leave a blank line after the package documentation block. Put standalone type, procedure, and function documentation immediately after the qualified object name:

```sql
create or replace package mail_api is

-- $Id$

/** Sends mail through the configured SMTP service. */

/** Sends one message. */
procedure send_mail;
end mail_api;
/

create type mail_ids /** Collection of mail identifiers. */ as table of number;
/
```

Documentation immediately before `CREATE` remains supported for compatibility, but it is outside Oracle's stored object source and is not the canonical placement.

Descriptions and tag values support Markdown. Raw HTML is disabled and rendered output is sanitized. Resource links accept only absolute `http` and `https` URLs. Use `\@` when a multiline tag value needs a physical line beginning with a literal `@`.

### Validation Directives

Package documentation can exempt constants from `--fail-on-undocumented` validation:

```sql
create or replace package preferences is
	/**
	 * Public preferences.
	 *
	 * @plsqldoc-ignore-undocumented constant
	 */

	k_default constant varchar2(30) := 'default';
end preferences;
/
```

`constant` is the only supported value. The tag name and value are case-insensitive, and the exemption applies to every constant in that package. Exempt constants remain in generated HTML, and documented constants retain their descriptions. Other declarations, parameters, return values, and the package description remain required. The directive is not rendered.

The directive is recognized only in package documentation; occurrences elsewhere are ignored. Empty or unsupported values produce a validation warning and cause `--fail-on-undocumented` to fail. Repeating an identical directive has no additional effect.

```sql
create or replace package mail_api is
	/**
	 * Sends queued messages.
	 *
	 * @example
	 * begin
	 * 	mail_api.send_pending;
	 * end;
	 *
	 * @see logging_api
	 * @see https://example.org/mail
	 */

	/** Sends pending messages. */
	procedure send_pending;
end mail_api;
/
```

Supported package declarations are procedures, functions, records, associative arrays, nested tables, varrays, ref cursors, subtypes, constants, exceptions, explicit cursors, and public variables. Standalone declarations include procedures, functions, object types, nested tables, and varrays. Object types include attributes, inheritance, constructors, member/static procedures and functions, map/order methods, modifiers, and overloads.

## Parser Strategy

This project intentionally uses a lexer-first scanner rather than a full PL/SQL parser. The scanner focuses on public API declarations and documentation comments, similar to TypeDoc's declaration-oriented model.

Lexing uses the canonical ANTLR grammars-v4 PL/SQL lexer with its Antlr4ng runtime base. The vendored upstream revision and local adaptations are recorded in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md). `pnpm grammar:download` updates the sources from upstream `master`; `pnpm grammar:generate` regenerates the TypeScript artifacts.
