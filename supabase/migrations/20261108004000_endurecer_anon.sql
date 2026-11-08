-- Defensa en profundidad: el rol anónimo (sin sesión) no necesita leer tablas ni ejecutar funciones del sistema.
-- Lo único público es el catálogo: categorías, aliados y v_catalogo_publico. La RLS ya bloqueaba el resto; esto quita el permiso de raíz.
revoke all on all tables in schema public from anon;
grant select on public.categorias, public.aliados, public.v_catalogo_publico to anon;
revoke all on all sequences in schema public from anon;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as f
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind in ('f', 'p')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke execute on function %s from public, anon', r.f);
  end loop;
end $$;

alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke execute on functions from anon;
