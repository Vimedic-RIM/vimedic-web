-- La hoja original guarda en "Descuento Fijo" un porcentaje ("10") o la palabra "VIP" (precio distribuidor).
-- El CRM ya lo trata como texto; la columna numeric no podía guardar "VIP".
alter table public.clientes alter column descuento_fijo type text using descuento_fijo::text;
