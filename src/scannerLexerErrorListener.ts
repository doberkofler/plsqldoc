import {BaseErrorListener, type ATNSimulator, type RecognitionException, type Recognizer, type Token} from 'antlr4ng';

/** Converts ANTLR lexer diagnostics into scanner warnings. */
export class ScannerLexerErrorListener extends BaseErrorListener {
	private readonly report: (line: number, column: number, message: string) => void;

	public constructor(report: (line: number, column: number, message: string) => void) {
		super();
		this.report = report;
	}

	public override syntaxError(
		_recognizer: Recognizer<ATNSimulator>,
		_offendingSymbol: Token | null,
		line: number,
		column: number,
		message: string,
		_error: RecognitionException | null,
	): void {
		this.report(line, column, message);
	}
}
