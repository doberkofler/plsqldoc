create or replace force type employee_type /** Employee value with sortable labels. */ under person_type
(	/** Salary amount. */ salary number(10,2)
,	/**
	 * Creates an employee.
	 * @param p_name Employee name.
	 * @return Employee value.
	 */
	constructor function employee_type(p_name varchar2) return self as result
,	/**
	 * Returns the label.
	 * @return Employee label.
	 */
	member function label return varchar2
,	/**
	 * Returns a formatted label.
	 * @param p_format Label format.
	 * @return Employee label.
	 */
	member function label(p_format varchar2) return varchar2
,	/**
	 * Returns the sort key.
	 * @return Sort key.
	 */
	map member function sort_key return number
) not final;
/
