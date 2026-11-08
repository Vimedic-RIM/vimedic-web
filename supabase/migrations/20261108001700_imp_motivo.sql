-- Motivo opcional al enviar un borrador de importación a la papelera.
alter table public.imp_expedientes add column if not exists motivo_eliminacion text;
