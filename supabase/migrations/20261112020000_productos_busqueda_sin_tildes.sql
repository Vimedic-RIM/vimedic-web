-- =====================================================================
-- Búsqueda de productos más efectiva: una sola columna normalizada
-- (minúsculas, sin tildes) con nombre + código + código único + marca,
-- indexada con trigram. El buscador de Inventario (y otros que reusan
-- el mismo patrón) comparan contra esta columna en vez de 4 ilike OR
-- por palabra, así "generador" encuentra "Generador" y "GENERADOR", y
-- "camara" encuentra "cámara".
-- =====================================================================
create extension if not exists unaccent;

create or replace function app.normalizar_busqueda(texto text) returns text
language sql stable as $$
  select lower(unaccent(coalesce(texto, '')))
$$;

alter table public.productos add column if not exists busqueda_normalizada text;

create or replace function app.tg_productos_busqueda_normalizada() returns trigger
language plpgsql as $$
begin
  new.busqueda_normalizada := app.normalizar_busqueda(
    coalesce(new.nombre, '') || ' ' || coalesce(new.codigo, '') || ' ' || coalesce(new.codigo_unico, '') || ' ' || coalesce(new.marca, '')
  );
  return new;
end;
$$;

drop trigger if exists tg_productos_busqueda_normalizada on public.productos;
create trigger tg_productos_busqueda_normalizada before insert or update
  on public.productos for each row execute function app.tg_productos_busqueda_normalizada();

update public.productos set busqueda_normalizada = app.normalizar_busqueda(
  coalesce(nombre, '') || ' ' || coalesce(codigo, '') || ' ' || coalesce(codigo_unico, '') || ' ' || coalesce(marca, '')
);

create index if not exists productos_busqueda_normalizada_trgm_idx
  on public.productos using gin (busqueda_normalizada gin_trgm_ops);
