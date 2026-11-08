-- Datos estructurados de la venta (remitente/destinatario, preparación, observación de pago…).
alter table public.cotizaciones add column if not exists detalle_venta jsonb;
