-- Reordenar el Inventario / catálogo público arrastrando (guardarOrdenInventario de la app original).
-- Recibe los ids en el orden deseado y guarda la posición en productos.orden.
create or replace function public.inv_guardar_orden(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public, app
as $$
declare
  n integer;
begin
  if not app.puede('inventario', 'editar') then
    raise exception 'No tienes permiso para reordenar el inventario.';
  end if;
  if p_ids is null or array_length(p_ids, 1) is null then
    raise exception 'No se recibió ningún orden para guardar.';
  end if;
  update public.productos p
     set orden = t.pos
    from unnest(p_ids) with ordinality as t(id, pos)
   where p.id = t.id and p.deleted_at is null;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.inv_guardar_orden(uuid[]) from public, anon;
grant execute on function public.inv_guardar_orden(uuid[]) to authenticated;
