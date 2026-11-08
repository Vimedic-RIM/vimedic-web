-- Tablero genérico de Talento Humano / Financiero: motivo al eliminar (papelera).
alter table public.tareas_modulo add column if not exists motivo_eliminacion text;
