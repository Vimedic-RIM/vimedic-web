-- Motivo opcional al enviar un empleado a la Papelera.
alter table public.empleados add column if not exists motivo_eliminacion text;
