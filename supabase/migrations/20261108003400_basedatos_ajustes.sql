-- Ajustes a Bases de Datos: quien respalda también puede leer las tablas completas, y el panel entrega los nombres de columnas.
create or replace function app.bd_exigir_alguno(p_acciones text[]) returns void language plpgsql security definer set search_path = public as $$
declare a text;
begin
  foreach a in array p_acciones loop if app.puede('basedatos', a) then return; end if; end loop;
  raise exception 'No tienes el permiso "%" en Bases de Datos.', p_acciones[1];
end; $$;
revoke all on function app.bd_exigir_alguno(text[]) from public, anon, authenticated;

do $$
declare d text;
begin
  -- bd_tabla y bd_registros: en modo exportación también sirve el permiso "respaldar".
  for d in select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('bd_tabla', 'bd_registros') loop
    d := replace(d, 'perform app.bd_exigir(case when p_exportar then ''exportar'' else ''ver'' end);',
                    'if p_exportar then perform app.bd_exigir_alguno(array[''exportar'', ''respaldar'']); else perform app.bd_exigir(''ver''); end if;');
    execute d;
  end loop;
end $$;

create or replace function public.bd_panel() returns jsonb language plpgsql security definer set search_path = public as $$
declare v_sis jsonb; v_prop jsonb;
begin
  perform app.bd_exigir('ver');
  select coalesce(jsonb_agg(jsonb_build_object(
      'nombre', c.relname,
      'columnas', (select count(*) from information_schema.columns ic where ic.table_schema = 'public' and ic.table_name = c.relname),
      'cols', (select jsonb_agg(ic.column_name order by ic.ordinal_position) from information_schema.columns ic where ic.table_schema = 'public' and ic.table_name = c.relname),
      'filas', (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', c.relname), false, true, '')))[1]::text::bigint
    ) order by c.relname), '[]'::jsonb)
  into v_sis
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r';
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'nombre', t.nombre, 'base', t.base, 'modulo', t.modulo, 'descripcion', t.descripcion, 'campos', t.campos,
      'filas', (select count(*) from public.bd_registros r where r.tabla_id = t.id and r.activo and r.deleted_at is null)
    ) order by t.nombre), '[]'::jsonb)
  into v_prop from public.bd_tablas t where t.deleted_at is null;
  return jsonb_build_object('tablas', v_sis, 'propias', v_prop, 'tamano', pg_database_size(current_database()),
    'permisos', coalesce(app.permisos_actuales() -> 'basedatos', '[]'::jsonb), 'superadmin', app.es_superadmin());
end; $$;
