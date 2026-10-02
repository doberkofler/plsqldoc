create or replace type employee_list /** Collection of employees. */ as table of employee_type;
/

create or replace type employee_id_array /** Small bounded collection of employee identifiers. */ as varray(100) of number;
/
