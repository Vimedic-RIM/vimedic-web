-- =====================================================================
-- Biblioteca de productos (Marketing): el formulario original tenía un
-- campo "Garantía" (Ej. 1 año) que todavía no existía en productos.
-- =====================================================================
alter table public.productos add column if not exists garantia text;
comment on column public.productos.garantia is 'Garantía del producto (Ej. "1 año"). Se edita en Marketing › Biblioteca.';
