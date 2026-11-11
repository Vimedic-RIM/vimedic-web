-- =====================================================================
-- Ficha técnica (Biblioteca de Marketing): hasta 3 especificaciones
-- elegidas para resaltar en la ficha. Guarda las claves ("Dato") tal
-- como aparecen en productos.especificaciones, separadas por "|".
-- =====================================================================
alter table public.productos add column if not exists destacados text;
comment on column public.productos.destacados is 'Hasta 3 claves de especificaciones destacadas en la ficha técnica, separadas por "|". Vacío = se usan las 3 primeras.';
