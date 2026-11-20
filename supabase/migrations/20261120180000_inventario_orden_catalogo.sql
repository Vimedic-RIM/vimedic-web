-- =====================================================================
-- Inventario › Ordenar catálogo: orden de las CATEGORÍAS y, dentro de cada una, de los PRODUCTOS.
--   · Solo las personas de inventario_ajustes 'orden_catalogo' (hoy: Jonathan Ruiz) pueden ordenar; ni otros
--     superadministradores ni quien edita Inventario. La lista la cambia solo Seguridad.
--   · inv_guardar_orden_catalogo(categorias, productos): guarda las dos cosas a la vez (categorias.orden y
--     productos.orden siguiendo el orden de las categorías). Solo escribe las filas que cambian.
--   · inv_guardar_orden (el «Reordenar» anterior) queda con la misma restricción.
-- =====================================================================

create table if not exists public.inventario_ajustes (
  id    uuid primary key default gen_random_uuid(),
  clave text not null unique,
  valor jsonb not null default '{}'::jsonb
);
select app.estandarizar('public.inventario_ajustes');
select app.aplicar_rls('public.inventario_ajustes', array['inventario'], array['seguridad']);

insert into public.inventario_ajustes (clave, valor)
select 'orden_catalogo', jsonb_build_object(
         'empleados', coalesce(jsonb_agg(e.id), '[]'::jsonb),
         'nota', 'Quién puede ordenar las categorías y los productos del catálogo (Inventario › Ordenar catálogo).')
  from public.empleados e
 where e.deleted_at is null and lower(btrim(e.nombre)) = 'jonathan ruiz'
on conflict (clave) do nothing;

create or replace function app.inv_puede_ordenar()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select app.empleado_id() is not null and (a.valor -> 'empleados') ? app.empleado_id()::text
      from public.inventario_ajustes a
     where a.clave = 'orden_catalogo' and a.deleted_at is null
  ), false);
$$;
revoke all on function app.inv_puede_ordenar() from public, anon;
grant execute on function app.inv_puede_ordenar() to authenticated;

-- Para la pantalla: ¿muestro «Ordenar catálogo»?
create or replace function public.inv_puede_ordenar()
returns boolean language sql stable security invoker set search_path = public, app
as $$ select app.inv_puede_ordenar() $$;
revoke all on function public.inv_puede_ordenar() from public, anon;
grant execute on function public.inv_puede_ordenar() to authenticated;

-- Guardar el orden de categorías y productos (en una sola transacción).
create or replace function public.inv_guardar_orden_catalogo(p_categorias uuid[], p_productos uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  n_cat integer := 0;
  n_prod integer := 0;
begin
  if not app.inv_puede_ordenar() then
    raise exception 'Solo la persona autorizada puede ordenar el catálogo.';
  end if;
  if coalesce(array_length(p_categorias, 1), 0) = 0 and coalesce(array_length(p_productos, 1), 0) = 0 then
    raise exception 'No se recibió ningún orden para guardar.';
  end if;

  update public.categorias c
     set orden = t.pos
    from unnest(coalesce(p_categorias, '{}'::uuid[])) with ordinality as t(id, pos)
   where c.id = t.id and c.deleted_at is null and c.orden is distinct from t.pos;
  get diagnostics n_cat = row_count;

  update public.productos p
     set orden = t.pos
    from unnest(coalesce(p_productos, '{}'::uuid[])) with ordinality as t(id, pos)
   where p.id = t.id and p.deleted_at is null and p.orden is distinct from t.pos;
  get diagnostics n_prod = row_count;

  return jsonb_build_object('categorias', n_cat, 'productos', n_prod);
end;
$$;
revoke all on function public.inv_guardar_orden_catalogo(uuid[], uuid[]) from public, anon;
grant execute on function public.inv_guardar_orden_catalogo(uuid[], uuid[]) to authenticated;

-- El «Reordenar» anterior: misma restricción (y solo escribe lo que cambia).
create or replace function public.inv_guardar_orden(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public, app
as $$
declare
  n integer;
begin
  if not app.inv_puede_ordenar() then
    raise exception 'Solo la persona autorizada puede ordenar el catálogo.';
  end if;
  if p_ids is null or array_length(p_ids, 1) is null then
    raise exception 'No se recibió ningún orden para guardar.';
  end if;
  update public.productos p
     set orden = t.pos
    from unnest(p_ids) with ordinality as t(id, pos)
   where p.id = t.id and p.deleted_at is null and p.orden is distinct from t.pos;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.inv_guardar_orden(uuid[]) from public, anon;
grant execute on function public.inv_guardar_orden(uuid[]) to authenticated;

notify pgrst, 'reload schema';
