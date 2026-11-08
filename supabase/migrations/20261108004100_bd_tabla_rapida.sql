-- bd_tabla ordenaba por la primera columna de salida (un jsonb armado para TODAS las filas) y repetía to_jsonb(fila) por cada columna:
-- ver "cotizaciones" tardaba 11 s. Ahora ordena por posición física y arma el jsonb de la fila una sola vez.
do $$
declare d text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'bd_tabla';
  d := replace(d, 'v_ord text := ''1'';', 'v_ord text := ''t.ctid'';');
  d := replace(d, 'select jsonb_build_object(''id'', to_jsonb(t)->>''id'',', 'select jsonb_build_object(''id'', z.j->>''id'',');
  d := replace(d, 'and to_jsonb(t)->u.c <> ''null''::jsonb then to_jsonb(''••••••''::text) else to_jsonb(t)->u.c end', 'and z.j->u.c <> ''null''::jsonb then to_jsonb(''••••••''::text) else z.j->u.c end');
  d := replace(d, 'from public.%3$I t where %4$s', 'from public.%3$I t cross join lateral (select to_jsonb(t) as j) z where %4$s');
  if d not like '%cross join lateral%' or d not like '%t.ctid%' then raise exception 'No se pudo reescribir bd_tabla'; end if;
  execute d;
end $$;
