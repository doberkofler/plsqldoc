## Commit Message Guidelines

We follow the **Conventional Commits** specification. This is **enforced** by `commitlint` and is required for automated changelog generation.

**Format:** `type(scope): subject`

**Common Types:**
- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation only changes
- `style`: Changes that do not affect the meaning of the code (white-space, formatting, missing semi-colons, etc)
- `refactor`: A code change that neither fixes a bug nor adds a feature
- `perf`: A code change that improves performance
- `test`: Adding missing tests or correcting existing tests
- `chore`: Changes to the build process or auxiliary tools and libraries such as documentation generation

**Examples:**
- `feat(cli): add support for jsonc files`
- `fix(parser): handle empty input gracefully`
- `docs: update contributing guidelines`

## Development Workflow

Use `pnpm` for all project commands.

```sh
pnpm install
pnpm run ci
```

Run `pnpm antlr` before `pnpm run ci` when changing `PlSqlLexer.g4`. Do not edit files under `src/generated/` directly.

Generated output directories such as `dist/`, `docs/`, and `coverage/` should be regenerated from source changes rather than edited manually. Use the CLI `--clean` option when you need to remove stale generated documentation before rendering.

## Parser and Scanner Changes

Keep extraction lexer-first and scanner-based. The current scope is public package specs and standalone routine signatures, not full PL/SQL semantic analysis.

When changing documentation comment behavior, preserve support for:

- PLDoc/Javadoc-style `/** */` block comments.
- Contiguous leading `--` line comments.
- `@param`, `@return`, repeated tags, and unknown tags.
- Separator comments as documentation boundaries.
- Same-line trailing `--` comments attached only to the declaration on that line.

Add or update colocated Vitest coverage in `src/*.test.ts` for scanner and parser behavior changes.

## Release Process

To release a new version:

```sh
pnpm release -- patch   # or minor / major
```

This will automatically:
1. Run the CI suite (`pnpm run ci`).
2. Bump the version in `package.json`.
3. Update the `CHANGELOG.md` using `conventional-changelog` with the Angular preset.
4. Commit, tag, and push the changes.
5. Create a GitHub release with auto-generated notes.
6. Publish to npm (if configured).

**Note:** NPM publishing is **disabled** by default for new projects. To enable it:
1. Set `"private": false` in `package.json`.
2. Set `"publish": true` in `.release-it.json`.
3. Ensure you have the necessary `NPM_TOKEN` configured.

## Dependencies

- **zod**: TypeScript-first schema validation with static type inference.
- **eslint-plugin-regexp**: ESLint plugin for finding regexp mistakes and style guide violations.
- **release-it**: Interactive release-tool for Git repositories.
- **debug**: A tiny JavaScript debugging utility modelled after Node.js core debugging technique.
- **@commitlint/cli**: Lint commit messages to ensure they follow conventional commits.
- **@commitlint/config-conventional**: Shareable commitlint config enforcing conventional commits.
- **@types/debug**: TypeScript definitions for debug.
- **@types/node**: TypeScript definitions for Node.js.
- **@vitest/coverage-v8**: V8 coverage provider for Vitest.
- **conventional-changelog**: Generate a changelog from git metadata.
- **conventional-changelog-angular**: Angular preset for conventional-changelog.
- **husky**: Modern native git hooks made easy.
- **oxlint**: A JavaScript linter written in Rust.
- **oxlint-tsgolint**: TypeScript-specific rules for oxlint.
- **oxfmt**: High performance JavaScript / TypeScript formatter.
- **typescript**: A superset of JavaScript that compiles to clean JavaScript output.
- **vitest**: A Vite-native unit test framework.
- **vite**: Native-ESM powered web dev build tool
- **commander**: The complete solution for node.js command-line interfaces.
- **cli-progress**: Easy to use progress-bar for command-line/terminal applications.
- **@types/cli-progress**: TypeScript definitions for cli-progress.
