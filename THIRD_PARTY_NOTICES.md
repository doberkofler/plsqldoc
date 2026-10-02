# Third-Party Notices

## ANTLR PL/SQL Lexer

`PlSqlLexer.g4` and `src/plSqlLexerBase.ts` are derived from the ANTLR grammars-v4 PL/SQL grammar at commit [`e199816b3f1a7a49ea1ad84fb6b87c382ea36a33`](https://github.com/antlr/grammars-v4/tree/e199816b3f1a7a49ea1ad84fb6b87c382ea36a33/sql/plsql).

The upstream files are licensed under the Apache License 2.0. The grammar retains its original copyright and license header.

`src/plSqlLexerBase.ts` is retained verbatim from upstream and excluded from project linting and formatting.

Local grammar adaptations:

- Added the Antlr4ng import header required by generated TypeScript output.
- Generalized alternative-quoted string delimiters to match Oracle's documented syntax; reported upstream as [antlr/grammars-v4#5029](https://github.com/antlr/grammars-v4/issues/5029).
