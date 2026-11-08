-- =====================================================================
-- VIMEDIC · Migración 011 · Rendimiento de las políticas RLS
-- Problema: las políticas llamaban a app.puede_alguno(...) una vez POR FILA
-- (función security definer, no se puede inlinear). Con ~3.000 productos una
-- lista tardaba más de 1 s. Envolviendo la llamada en (select ...) Postgres la
-- evalúa una sola vez por consulta (initPlan). El resultado es el mismo.
-- =====================================================================

create or replace function app.aplicar_rls(
  p_tabla           regclass,
  p_modulos_ver     text[],
  p_modulos_editar  text[]
)
returns void
language plpgsql
as $$
declare
  v_ver    text := quote_literal(p_modulos_ver::text);
  v_editar text := quote_literal(p_modulos_editar::text);
begin
  execute format('alter table %s enable row level security', p_tabla);

  execute format('drop policy if exists rls_ver on %s', p_tabla);
  execute format('drop policy if exists rls_crear on %s', p_tabla);
  execute format('drop policy if exists rls_editar on %s', p_tabla);
  execute format('drop policy if exists rls_borrar on %s', p_tabla);

  execute format($p$
    create policy rls_ver on %1$s for select to authenticated
    using ((select app.puede_alguno(%2$s::text[], 'ver'))
           and (deleted_at is null or (select app.puede_alguno(%3$s::text[], 'eliminar'))))
  $p$, p_tabla, v_ver, v_editar);

  execute format($p$
    create policy rls_crear on %1$s for insert to authenticated
    with check ((select app.puede_alguno(%2$s::text[], 'crear')))
  $p$, p_tabla, v_editar);

  execute format($p$
    create policy rls_editar on %1$s for update to authenticated
    using ((select app.puede_alguno(%2$s::text[], 'editar')))
    with check ((select app.puede_alguno(%2$s::text[], 'editar')))
  $p$, p_tabla, v_editar);

  execute format($p$
    create policy rls_borrar on %1$s for delete to authenticated
    using ((select app.es_superadmin()))
  $p$, p_tabla);

  execute format('drop trigger if exists tg_borrado_logico on %s', p_tabla);
  execute format(
    'create trigger tg_borrado_logico before update of deleted_at on %s for each row execute function app.tg_controlar_borrado_logico(%L)',
    p_tabla, array_to_string(p_modulos_editar, ','));
end;
$$;

-- Reaplica las políticas estándar en todas las tablas que ya las tenían,
-- recuperando los módulos de "ver" y "editar" desde la propia política rls_ver.
do $$
declare
  r record;
  v_arrays text[];
  v_ver text[];
  v_editar text[];
  v_n integer := 0;
begin
  for r in
    select schemaname, tablename, qual
    from pg_policies
    where schemaname = 'public' and policyname = 'rls_ver'
  loop
    select array_agg(m[1]) into v_arrays
    from regexp_matches(r.qual, '''(\{[^'']*\})''', 'g') as m;

    if v_arrays is null or array_length(v_arrays, 1) < 2 then
      raise notice 'No se pudo leer la política de %.%, se deja como estaba', r.schemaname, r.tablename;
      continue;
    end if;

    v_ver    := v_arrays[1]::text[];
    v_editar := v_arrays[2]::text[];
    perform app.aplicar_rls(format('%I.%I', r.schemaname, r.tablename)::regclass, v_ver, v_editar);
    v_n := v_n + 1;
  end loop;
  raise notice 'Políticas reaplicadas en % tablas', v_n;
end $$;
