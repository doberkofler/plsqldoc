/**
 * Public HR package used by the demo documentation build.
 * @author Example Team
 */
CREATE OR REPLACE PACKAGE hr_api AS
	/**
	 * Creates or updates an employee.
	 * @param p_employee_id Existing employee id. Null creates a new employee.
	 * @param p_name Display name for the employee.
	 * @param p_salary Initial salary amount.
	 */
	PROCEDURE save_employee(
		p_employee_id IN OUT employees.employee_id%TYPE,
		p_name IN VARCHAR2,
		p_salary IN NUMBER DEFAULT 0
	);

	/**
	 * Formats an employee label for UI display.
	 * @param p_employee_id Employee identifier.
	 * @return Human readable employee label.
	 */
	FUNCTION employee_label(
		p_employee_id IN employees.employee_id%TYPE
	) RETURN VARCHAR2;
END hr_api;
/
