create or replace type employee_type /**
 * Employee value exposed by the HR API.
 *
 * @example
 * declare
 * 	l_employee employee_type;
 * begin
 * 	l_employee := employee_type('Ada');
 * end;
 *
 * @see hr_api
 * @see https://example.org/hr/types
 */ as object
(	/** Employee identifier. */ employee_id number
,	/** Employee name. */ employee_name varchar2(100)
,	/**
	 * Creates an employee.
	 * @param p_name Employee name.
	 * @return Employee value.
	 */
	constructor function employee_type(p_name varchar2) return self as result
,	/**
	 * Formats the employee name.
	 * @return Formatted name.
	 */
	member function display_name return varchar2
);
/
