CREATE OR REPLACE PACKAGE BODY hr_api AS
	PROCEDURE private_audit(p_message IN VARCHAR2) IS
	BEGIN
		NULL;
	END private_audit;

	PROCEDURE save_employee(
		p_employee_id IN OUT employees.employee_id%TYPE,
		p_name IN VARCHAR2,
		p_salary IN NUMBER DEFAULT 0
	) IS
	BEGIN
		private_audit(q'[saving employee, including comma]');
	END save_employee;

	FUNCTION employee_label(
		p_employee_id IN employees.employee_id%TYPE
	) RETURN VARCHAR2 IS
	BEGIN
		RETURN 'Employee #' || p_employee_id;
	END employee_label;
END hr_api;
/
