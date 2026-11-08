-- Motivo opcional al enviar a la Papelera (gestiones, cotizaciones/ventas y clientes).
alter table public.leads        add column if not exists motivo_eliminacion text;
alter table public.cotizaciones add column if not exists motivo_eliminacion text;
alter table public.clientes     add column if not exists motivo_eliminacion text;
