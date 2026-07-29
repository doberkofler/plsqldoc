lexer grammar PlSqlLexer;

CREATE: [cC][rR][eE][aA][tT][eE];
OR: [oO][rR];
REPLACE: [rR][eE][pP][lL][aA][cC][eE];
EDITIONABLE: [eE][dD][iI][tT][iI][oO][nN][aA][bB][lL][eE];
NONEDITIONABLE: [nN][oO][nN][eE][dD][iI][tT][iI][oO][nN][aA][bB][lL][eE];
PACKAGE: [pP][aA][cC][kK][aA][gG][eE];
BODY: [bB][oO][dD][yY];
PROCEDURE: [pP][rR][oO][cC][eE][dD][uU][rR][eE];
FUNCTION: [fF][uU][nN][cC][tT][iI][oO][nN];
RETURN: [rR][eE][tT][uU][rR][nN];
TYPE: [tT][yY][pP][eE];
TRIGGER: [tT][rR][iI][gG][gG][eE][rR];
END: [eE][nN][dD];
AUTHID: [aA][uU][tT][hH][iI][dD];
DETERMINISTIC: [dD][eE][tT][eE][rR][mM][iI][nN][iI][sS][tT][iI][cC];
PIPELINED: [pP][iI][pP][eE][lL][iI][nN][eE][dD];
RESULT_CACHE: [rR][eE][sS][uU][lL][tT] '_' [cC][aA][cC][hH][eE];
PARALLEL_ENABLE: [pP][aA][rR][aA][lL][lL][eE][lL] '_' [eE][nN][aA][bB][lL][eE];
IN: [iI][nN];
OUT: [oO][uU][tT];
NOCOPY: [nN][oO][cC][oO][pP][yY];
DEFAULT: [dD][eE][fF][aA][uU][lL][tT];
IS: [iI][sS];
AS: [aA][sS];

SEMI: ';';
LPAREN: '(';
RPAREN: ')';
COMMA: ',';
ASSIGN: ':=';
ARROW: '=>';
DOT: '.';
PERCENT: '%';

COMMENT: ('/*' .*? '*/' | '--' ~[\r\n]*) -> channel(HIDDEN);
SPACE: [ \t\r\n]+ -> channel(HIDDEN);

Q_STRING: [qQ] '\'' ('[' .*? ']' | '(' .*? ')' | '{' .*? '}' | '<' .*? '>' | . .*? .) '\'';
QUOTED_ID: '"' ('""' | ~["])* '"';
ID: [a-zA-Z_][a-zA-Z0-9_$#]*;
STRING: '\'' ( '\'\'' | ~['\r\n] )* '\'';
NUMBER: [0-9]+ ('.' [0-9]+)?;
ANY: .;
