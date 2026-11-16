-- Pruebas de las ofertas por tipo de cliente (PVP / DIS / ambos). Correr SOLO en el proyecto de PRUEBAS; todo se deshace al final.
--   npx supabase db query --remote --yes -f supabase/tests/ofertas_publico.sql
-- Casos: una oferta solo PVP y otra solo DIS del mismo producto salen las dos, cada una para su tipo; una oferta para ambos sale una vez para
-- los dos; si hay una solo-PVP y otra para ambos, PVP se queda con la mejor y DIS con la de ambos (y al revés); una oferta de una campaña PVP
-- hereda "PVP"; las ofertas que ya existían siguen para ambos; cambiar a quién se da la campaña (RPC) solo lo hace quien tiene permiso.
begin;
create temp table r (n int, prueba text, esperado text, obtenido text) on commit drop;
grant all on r to authenticated;

do $$
declare
  hoy date := (now() at time zone 'America/Guayaquil')::date;
  cat uuid; camp uuid; p uuid[] := array[]::uuid[]; i int; v uuid;
begin
  insert into categorias (nombre, orden) values ('ZZ Prueba público', 999) returning id into cat;
  insert into promo_campanas (nombre, inicio, fin, estado, aplica_a) values ('ZZ Campaña público', hoy - 1, hoy + 20, 'Aprobada', 'PVP') returning id into camp;
  for i in 1..5 loop
    insert into productos (codigo, nombre, categoria_id, pvp, stock, en_catalogo) values ('ZZPU' || i, 'Producto público ' || i, cat, 100, 5, true) returning id into v;
    p := p || v;
  end loop;
  -- 1: una solo PVP (30 %) y otra solo DIS (10 %): salen las dos
  insert into ofertas (producto_id, tipo, descuento_pct, precio_oferta, pvp_base, inicio, fin, aplica_a) values
    (p[1], 'Precio especial', 30, 70, 100, hoy - 1, hoy + 10, 'PVP'), (p[1], 'Precio especial', 10, 90, 100, hoy - 1, hoy + 10, 'DIS');
  -- 2: una para ambos (20 %): sale una vez, para los dos
  insert into ofertas (producto_id, tipo, descuento_pct, precio_oferta, pvp_base, inicio, fin, aplica_a) values
    (p[2], 'Precio especial', 20, 80, 100, hoy - 1, hoy + 10, 'AMBOS');
  -- 3: solo PVP 25 % + ambos 15 %: PVP gana la de 25, DIS se queda con la de ambos (15)
  insert into ofertas (producto_id, tipo, descuento_pct, precio_oferta, pvp_base, inicio, fin, aplica_a) values
    (p[3], 'Precio especial', 25, 75, 100, hoy - 1, hoy + 10, 'PVP'), (p[3], 'Precio especial', 15, 85, 100, hoy - 1, hoy + 10, 'AMBOS');
  -- 4: ambos 15 % + solo DIS 35 %: PVP se queda con la de ambos (15), DIS gana la de 35
  insert into ofertas (producto_id, tipo, descuento_pct, precio_oferta, pvp_base, inicio, fin, aplica_a) values
    (p[4], 'Precio especial', 15, 85, 100, hoy - 1, hoy + 10, 'AMBOS'), (p[4], 'Precio especial', 35, 65, 100, hoy - 1, hoy + 10, 'DIS');
  -- 5: sin decir a quién, pero de una campaña "PVP": hereda PVP
  insert into ofertas (producto_id, campana_id, tipo, descuento_pct, precio_oferta, pvp_base, inicio, fin) values
    (p[5], camp, 'Campaña', 30, 70, 100, hoy - 1, hoy + 20);
  perform set_config('prueba.camp', camp::text, true);
end $$;

-- ===== Asesor con CRM (Jessica): lee las ofertas
create or replace function pg_temp.f(cod text) returns text language sql as $$
  select string_agg((x ->> 'aplicaA') || ':' || (x -> 'ganaPara')::text || ':' || (x ->> 'descuento'), ' | ' order by x ->> 'aplicaA')
  from jsonb_array_elements(public.inv_ofertas_vigentes(false)) x where x ->> 'codigo' = cod $$;
select set_config('request.jwt.claims', json_build_object('sub', (select auth_user_id from empleados where nombre = 'Jessica Maldonado' and deleted_at is null limit 1), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into r select 1, 'una solo PVP y otra solo DIS: salen las dos, cada una para su tipo', 'DIS:["DIS"]:10.00 | PVP:["PVP"]:30.00', pg_temp.f('ZZPU1');
insert into r select 2, 'una para ambos: sale una vez para los dos', 'AMBOS:["DIS", "PVP"]:20.00', pg_temp.f('ZZPU2');
insert into r select 3, 'solo PVP 25 + ambos 15: PVP gana la de 25 y DIS se queda con la de ambos', 'AMBOS:["DIS"]:15.00 | PVP:["PVP"]:25.00', pg_temp.f('ZZPU3');
insert into r select 4, 'ambos 15 + solo DIS 35: PVP se queda con la de ambos y DIS gana la de 35', 'AMBOS:["PVP"]:15.00 | DIS:["DIS"]:35.00', pg_temp.f('ZZPU4');
insert into r select 5, 'la oferta de una campaña PVP hereda PVP', 'PVP:["PVP"]:30.00', pg_temp.f('ZZPU5');
insert into r select 6, 'las ofertas que ya existían siguen para ambos (ninguna con otro público)', '0',
  (select count(*)::text from jsonb_array_elements(public.inv_ofertas_vigentes(true)) x where x ->> 'codigo' not like 'ZZPU%' and x ->> 'aplicaA' <> 'AMBOS');
insert into r select 7, 'y cada una sale una sola vez, para los dos tipos', '0',
  (select count(*)::text from jsonb_array_elements(public.inv_ofertas_vigentes(true)) x where x ->> 'codigo' not like 'ZZPU%' and jsonb_array_length(x -> 'ganaPara') <> 2);
insert into r select 8, 'sin costo ni margen', 'false',
  (select (count(*) > 0)::text from jsonb_array_elements(public.inv_ofertas_vigentes(true)) x, jsonb_object_keys(x) k where k ilike '%costo%' or k ilike '%margen%');
-- un asesor no puede cambiar a quién se da la campaña
do $$ begin
  begin perform public.ofertas_aplicar_publico(current_setting('prueba.camp')::uuid, 'DIS'); insert into r values (9, 'un asesor NO puede cambiar el público de la campaña', 'bloqueado', 'PERMITIDO');
  exception when others then insert into r values (9, 'un asesor NO puede cambiar el público de la campaña', 'bloqueado', case when sqlerrm like 'Sin permiso%' then 'bloqueado' else left(sqlerrm, 80) end); end;
end $$;
reset role;

-- ===== Superadministrador: cambia el público de la campaña completa
select set_config('request.jwt.claims', json_build_object('sub', (select e.auth_user_id from empleados e join roles ro on ro.id = e.rol_id where ro.es_superadmin and e.deleted_at is null and e.estado = 'activo' limit 1), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ declare n int; begin
  n := public.ofertas_aplicar_publico(current_setting('prueba.camp')::uuid, 'DIS');
  insert into r values (10, 'el superadmin cambia la campaña a DIS: 1 oferta cambió', '1', n::text);
  begin perform public.ofertas_aplicar_publico(current_setting('prueba.camp')::uuid, 'XYZ'); insert into r values (11, 'un valor inválido se rechaza', 'rechazado', 'ACEPTADO');
  exception when others then insert into r values (11, 'un valor inválido se rechaza', 'rechazado', 'rechazado'); end;
  begin perform public.ofertas_aplicar_publico(gen_random_uuid(), 'PVP'); insert into r values (12, 'una campaña que no existe se rechaza', 'rechazado', 'ACEPTADO');
  exception when others then insert into r values (12, 'una campaña que no existe se rechaza', 'rechazado', 'rechazado'); end;
end $$;
insert into r select 13, 'la campaña y su oferta quedan en DIS, con rastro en el historial', 'DIS · DIS · true',
  (select c.aplica_a from promo_campanas c where c.id = current_setting('prueba.camp')::uuid) || ' · ' ||
  (select o.aplica_a from ofertas o where o.campana_id = current_setting('prueba.camp')::uuid) || ' · ' ||
  (select (o.historial -> -1 ->> 'n' like 'Se da a:%')::text from ofertas o where o.campana_id = current_setting('prueba.camp')::uuid);
insert into r select 14, 'ahora la oferta de la campaña solo sale para DIS', 'DIS:["DIS"]:30.00', pg_temp.f('ZZPU5');
reset role;
-- el valor tiene que ser PVP, DIS o AMBOS
do $$ begin
  begin update ofertas set aplica_a = 'XYZ' where id = (select id from ofertas limit 1); insert into r values (15, 'la base rechaza un público inválido', 'rechazado', 'ACEPTADO');
  exception when check_violation then insert into r values (15, 'la base rechaza un público inválido', 'rechazado', 'rechazado'); end;
end $$;

select n, prueba, esperado, obtenido, case when esperado = obtenido then 'OK' else 'FALLA' end as resultado from r order by n;
rollback;
