create type employee_list /** Employee collection. */ as table of employee_type;
/

create type employee_array /** Bounded employee collection. */ as varray(100) of employee_type;
/
