-- =====================================================================
-- Rendimiento: el equipo del asesor se calcula UNA vez por consulta, no una vez por fila.
--   Las políticas de clientes, cotizaciones, leads, rutas y viáticos usaban app.es_yo_o_subordinado(asesor_id), que
--   recorre el organigrama (consulta recursiva) por CADA fila. Como asesora, la lista del CRM tardaba ~230 ms en QA
--   (11 ms quien ve todo). Ahora: asesor_id = any((select app.mi_equipo())::uuid[]) → Postgres lo evalúa una sola vez.
--   La regla de acceso es exactamente la misma (mismo conjunto: yo + mis subordinados en cualquier nivel; sin asesor
--   no cuenta). Completa lo de 20261108003700_rls_lectura_rapida.
--   Políticas nuevas que filtren por equipo: usar «col = any((select app.mi_equipo())::uuid[])», no app.es_yo_o_subordinado(col).
-- También: listas cortas que la app armaba bajando miles de filas (Supabase corta cada respuesta en 1.000 filas):
--   · productos_marcas(): marcas distintas (sugerencias de marca en Inventario y Marketing).
--   · mov_responsables(): responsables distintos de los movimientos (filtro de Movimientos).
-- =====================================================================

create or replace function app.mi_equipo()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  with recursive equipo as (
    select app.empleado_id() as id
    union
    select e.id from public.empleados e join equipo q on e.jefe_id = q.id
  )
  select coalesce(array_agg(id) filter (where id is not null), '{}'::uuid[]) from equipo;
$$;
revoke all on function app.mi_equipo() from public, anon;
grant execute on function app.mi_equipo() to authenticated;

-- Misma política, mismo USING / WITH CHECK, con el equipo calculado una vez.
do $$
declare
  p record;
  v_sql text;
  v_patron constant text := 'app\.es_yo_o_subordinado\(([a-z_]+(\.[a-z_]+)?)\)';
  v_nuevo constant text := '(\1 = ANY ((SELECT app.mi_equipo() AS mi_equipo)::uuid[]))';
begin
  for p in
    select schemaname, tablename, policyname, qual, with_check from pg_policies
     where schemaname = 'public' and (qual like '%es_yo_o_subordinado%' or with_check like '%es_yo_o_subordinado%')
  loop
    v_sql := format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    if p.qual is not null then v_sql := v_sql || ' using (' || regexp_replace(p.qual, v_patron, v_nuevo, 'g') || ')'; end if;
    if p.with_check is not null then v_sql := v_sql || ' with check (' || regexp_replace(p.with_check, v_patron, v_nuevo, 'g') || ')'; end if;
    execute v_sql;
  end loop;
end $$;

-- Marcas distintas (respeta los permisos de productos: security invoker).
create or replace function public.productos_marcas()
returns setof text
language sql
stable
security invoker
set search_path = public
as $$
  select distinct btrim(marca) from public.productos
   where deleted_at is null and marca is not null and btrim(marca) <> ''
   order by 1;
$$;
revoke all on function public.productos_marcas() from public, anon;
grant execute on function public.productos_marcas() to authenticated;

-- Responsables distintos de los movimientos (respeta los permisos de la vista: security invoker).
create or replace function public.mov_responsables()
returns setof text
language sql
stable
security invoker
set search_path = public
as $$
  select distinct responsable from public.v_movimientos where responsable is not null and responsable <> '' order by 1;
$$;
revoke all on function public.mov_responsables() from public, anon;
grant execute on function public.mov_responsables() to authenticated;

notify pgrst, 'reload schema';
