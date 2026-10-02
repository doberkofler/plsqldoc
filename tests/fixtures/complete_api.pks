create or replace package complete_api is
	/**
	 * Demonstrates every supported package member category.
	 *
	 * @example
	 * begin
	 * 	complete_api.run;
	 * end;
	 *
	 * @see https://example.org/complete-api
	 */

	/** Result record. */
	type result_record is record
	( /** Result identifier. */ result_id number
	, /** Result label. */ result_label varchar2(100) );

	/** Result list. */
	type result_list is table of result_record index by pls_integer;

	/** Result cursor. */
	type result_cursor is ref cursor return result_record;

	/** Identifier. */
	subtype identifier is number(10);

	/** Enabled value. */
	k_enabled constant boolean := true;

	/** Raised when no result exists. */
	no_result exception;

	/**
	 * Active results.
	 * @param p_limit Maximum rows.
	 */
	cursor active_results(p_limit number) return result_record is select null from dual;

	/** Current label. */
	g_label varchar2(100);

	/** Runs processing. */
	procedure run;
end complete_api;
/
