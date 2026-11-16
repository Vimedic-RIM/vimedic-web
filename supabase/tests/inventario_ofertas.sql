-- Pruebas de inv_ofertas_vigentes (Issue #39). Correr SOLO en el proyecto de PRUEBAS; todo se deshace al final.
--   npx supabase db query --remote --yes -f supabase/tests/inventario_ofertas.sql
-- Casos: vigente, cancelada, pausada, próxima, terminada ayer, producto inactivo, dos vigentes (gana la más reciente),
-- vigente + próxima (gana la vigente), sin precio; que no salgan costo ni margen; y quién puede llamarla.
begin;
create temp table r (n int, prueba text, esperado text, obtenido text) on commit drop;
grant all on r to authenticated;

do $$
declare
  hoy date := (now() at time zone 'America/Guayaquil')::date;
  cat uuid; p uuid[] := array[]::uuid[]; i int; v uuid; o7 uuid; o8 uuid;
begin
  insert into categorias (nombre, orden) values ('ZZ Prueba ofertas #39', 999) returning id into cat;
  for i in 1..9 loop
    insert into productos (codigo, nombre, categoria_id, pvp, stock, en_catalogo, estado)
    values ('ZZOF' || i, 'Producto prueba ' || i, cat, 100, 3, i % 2 = 0, case when i = 6 then 'Inactivo' else null end)
    returning id into v;
    p := p || v;
  end loop;
  insert into ofertas (producto_id, tipo, descuento_pct, precio_oferta, pvp_base, costo, margen_pct, inicio, fin, estado) values
    (p[1], 'Precio especial', 20, 80, 100, 50, 37.5, hoy - 3, hoy + 10, null),        -- vigente
    (p[2], 'Precio especial', 20, 80, 100, 50, 37.5, hoy - 3, hoy + 10, 'Cancelada'), -- cancelada
    (p[3], 'Precio especial', 20, 80, 100, 50, 37.5, hoy - 3, hoy + 10, 'Pausada'),   -- pausada
    (p[4], 'Precio especial', 20, 80, 100, 50, 37.5, hoy + 2, hoy + 10, null),        -- próxima
    (p[5], 'Precio especial', 20, 80, 100, 50, 37.5, hoy - 9, hoy - 1, null),         -- terminó ayer
    (p[6], 'Precio especial', 20, 80, 100, 50, 37.5, hoy - 3, hoy + 10, null),        -- producto inactivo
    (p[9], 'Precio especial', 20, null, 100, 50, 37.5, hoy - 3, hoy + 10, null);      -- sin precio de oferta
  insert into ofertas (producto_id, tipo, descuento_pct, precio_oferta, pvp_base, inicio, fin, created_at) values
    (p[7], 'Liquidación', 10, 90, 100, hoy - 5, hoy + 5, now() - interval '2 days');
  insert into ofertas (producto_id, tipo, descuento_pct, precio_oferta, pvp_base, inicio, fin) values
    (p[7], 'Liquidación', 30, 70, 100, hoy - 1, hoy + 5) returning id into o7;         -- la más reciente gana
  insert into ofertas (producto_id, tipo, descuento_pct, precio_oferta, pvp_base, inicio, fin) values
    (p[8], 'Precio especial', 15, 85, 100, hoy - 1, hoy + 5) returning id into o8;
  insert into ofertas (producto_id, tipo, descuento_pct, precio_oferta, pvp_base, inicio, fin) values
    (p[8], 'Precio especial', 40, 60, 100, hoy + 1, hoy + 9);                          -- próxima: no reemplaza a la vigente
  perform set_config('prueba.o7', o7::text, true);
  perform set_config('prueba.o8', o8::text, true);
end $$;

-- ===== Asesor con Inventario (Jessica)
select set_config('request.jwt.claims', json_build_object('sub', (select auth_user_id from empleados where nombre = 'Jessica Maldonado' and deleted_at is null limit 1), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into r select 1, 'vigentes de prueba', 'ZZOF1,ZZOF7,ZZOF8',
  (select string_agg(x ->> 'codigo', ',' order by x ->> 'codigo') from jsonb_array_elements(public.inv_ofertas_vigentes(false)) x where x ->> 'codigo' like 'ZZOF%');
insert into r select 2, 'con próximas', 'ZZOF1,ZZOF4,ZZOF7,ZZOF8',
  (select string_agg(x ->> 'codigo', ',' order by x ->> 'codigo') from jsonb_array_elements(public.inv_ofertas_vigentes(true)) x where x ->> 'codigo' like 'ZZOF%');
insert into r select 3, 'ZZOF4 marcada como próxima', 'true',
  (select x ->> 'proxima' from jsonb_array_elements(public.inv_ofertas_vigentes(true)) x where x ->> 'codigo' = 'ZZOF4');
insert into r select 4, 'dos vigentes: gana la más reciente', current_setting('prueba.o7'),
  (select x ->> 'ofertaId' from jsonb_array_elements(public.inv_ofertas_vigentes(false)) x where x ->> 'codigo' = 'ZZOF7');
insert into r select 5, 'vigente + próxima: gana la vigente', current_setting('prueba.o8'),
  (select x ->> 'ofertaId' from jsonb_array_elements(public.inv_ofertas_vigentes(true)) x where x ->> 'codigo' = 'ZZOF8');
insert into r select 6, 'sin costo ni margen', 'false',
  (select (count(*) > 0)::text from jsonb_array_elements(public.inv_ofertas_vigentes(true)) x, jsonb_object_keys(x) k where k ilike '%costo%' or k ilike '%margen%');
insert into r select 7, 'precio y descuento de ZZOF1', '80.00 · 20.00 · 100.00',
  (select concat_ws(' · ', x ->> 'precio', x ->> 'descuento', x ->> 'pvp') from jsonb_array_elements(public.inv_ofertas_vigentes(false)) x where x ->> 'codigo' = 'ZZOF1');
reset role;

-- ===== Empleado sin ningún permiso (rol quitado dentro de la transacción)
select set_config('request.jwt.claims', '', true);
update empleados set rol_id = null, permisos_extra = '{}'::jsonb where nombre = 'Steban Gines';
select set_config('request.jwt.claims', json_build_object('sub', (select auth_user_id from empleados where nombre = 'Steban Gines' limit 1), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  begin perform public.inv_ofertas_vigentes(false); insert into r values (8, 'sin permiso: bloqueado', 'bloqueado', 'PERMITIDO');
  exception when others then insert into r values (8, 'sin permiso: bloqueado', 'bloqueado', case when sqlerrm like 'Sin permiso%' then 'bloqueado' else sqlerrm end); end;
end $$;
reset role;

-- ===== Solo Inventario › ver (rol temporal)
select set_config('request.jwt.claims', '', true);
insert into roles (nombre, permisos) values ('ZZ Solo inventario #39', '{"inventario": ["ver"]}'::jsonb);
update empleados set rol_id = (select id from roles where nombre = 'ZZ Solo inventario #39') where nombre = 'Steban Gines';
select set_config('request.jwt.claims', json_build_object('sub', (select auth_user_id from empleados where nombre = 'Steban Gines' limit 1), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into r select 9, 'solo inventario: ve las vigentes', 'ZZOF1,ZZOF7,ZZOF8',
  (select string_agg(x ->> 'codigo', ',' order by x ->> 'codigo') from jsonb_array_elements(public.inv_ofertas_vigentes(false)) x where x ->> 'codigo' like 'ZZOF%');
reset role;

select n, prueba, esperado, obtenido, case when esperado = obtenido then 'OK' else 'FALLA' end as resultado from r order by n;
rollback;
