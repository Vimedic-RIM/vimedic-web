-- Buscador de Inventario más efectivo — Issue #32
-- La columna productos.busqueda_normalizada (minúsculas y sin tildes) ahora incluye además:
--   · la categoría y el modelo / referencia del proveedor;
--   · los códigos sin guiones ni espacios, para que "hce3000" encuentre "HCE-3000".
-- Cada palabra que escribe la persona se busca en esta columna (índice trigram), sin importar el orden.

create or replace function app.productos_texto_busqueda(p_nombre text, p_codigo text, p_codigo_unico text, p_referencia text, p_marca text, p_categoria uuid)
returns text language sql stable security definer set search_path = public as $$
  select app.normalizar_busqueda(
    coalesce(p_nombre, '') || ' ' || coalesce(p_codigo, '') || ' ' || coalesce(p_codigo_unico, '') || ' ' || coalesce(p_referencia, '') || ' ' ||
    coalesce(p_marca, '') || ' ' || coalesce((select c.nombre from public.categorias c where c.id = p_categoria), '') || ' ' ||
    regexp_replace(coalesce(p_codigo, '') || ' ' || coalesce(p_codigo_unico, '') || ' ' || coalesce(p_referencia, ''), '[^[:alnum:] ]', '', 'g'));
$$;

create or replace function app.tg_productos_busqueda_normalizada() returns trigger
language plpgsql as $$
begin
  new.busqueda_normalizada := app.productos_texto_busqueda(new.nombre, new.codigo, new.codigo_unico, new.referencia_proveedor, new.marca, new.categoria_id);
  return new;
end;
$$;

-- Si cambia el nombre de una categoría, sus productos se vuelven a indexar.
create or replace function app.tg_categorias_busqueda() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.nombre is distinct from old.nombre then
    update public.productos p
       set busqueda_normalizada = app.productos_texto_busqueda(p.nombre, p.codigo, p.codigo_unico, p.referencia_proveedor, p.marca, p.categoria_id)
     where p.categoria_id = new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists tg_categorias_busqueda on public.categorias;
create trigger tg_categorias_busqueda after update of nombre on public.categorias
  for each row execute function app.tg_categorias_busqueda();

update public.productos p
   set busqueda_normalizada = app.productos_texto_busqueda(p.nombre, p.codigo, p.codigo_unico, p.referencia_proveedor, p.marca, p.categoria_id)
 where p.busqueda_normalizada is distinct from app.productos_texto_busqueda(p.nombre, p.codigo, p.codigo_unico, p.referencia_proveedor, p.marca, p.categoria_id);

revoke all on function app.tg_categorias_busqueda() from public, anon, authenticated;
