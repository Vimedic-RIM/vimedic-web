-- Pruebas: ficha técnica C3 (migración 20261121110000). Base de PRODUCCIÓN: todo dentro de la transacción y se deshace.
--   npx supabase db query --remote --yes -f supabase/tests/ficha_tecnica_c3.sql
begin;
create temp table r (n int, prueba text, esperado text, obtenido text) on commit drop;
grant all on r to authenticated;
create temp table x (k text primary key, v text) on commit drop;
grant all on x to authenticated;

insert into empleados (id, email, nombre, empresa, estado, cargo, permisos_extra) values
  ('00000000-0000-0000-0000-0000000f1c01', 't.fc.mkt@vimedic.test', 'T Ficha Marketing', 'VIMEDIC', 'activo', 'Marketing', '{"marketing":["ver","crear","editar"]}'),
  ('00000000-0000-0000-0000-0000000f1c02', 't.fc.ase@vimedic.test', 'T Ficha Asesor', 'VIMEDIC', 'activo', 'Asesor', '{"crm":["ver","crear"]}'),
  ('00000000-0000-0000-0000-0000000f1c03', 't.fc.nada@vimedic.test', 'T Ficha Sin acceso', 'VIMEDIC', 'activo', 'Otro', '{"agenda":["ver"]}');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000f1d01', 't.fc.mkt@vimedic.test'), ('00000000-0000-0000-0000-0000000f1d02', 't.fc.ase@vimedic.test'), ('00000000-0000-0000-0000-0000000f1d03', 't.fc.nada@vimedic.test');
update empleados e set auth_user_id = u.id from auth.users u where u.email = e.email and e.email like 't.fc.%';
insert into productos (id, codigo, nombre, en_catalogo, imagen_url, descripcion, especificaciones, caracteristicas, destacados)
values ('00000000-0000-0000-0000-0000000f1e01', 'T-FICHA-1', 'Autoclave de prueba', true, 'https://drive.google.com/file/d/abc/view', 'Descripción web larga',
        'Capacidad: 18 L' || chr(10) || 'Voltaje: 220 V', '🔥 Dos ciclos' || chr(10) || '🧪 Acero inoxidable', 'Capacidad');

-- 1-3) Marketing guarda la ficha; más de 3 destacados se rechaza
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000f1d01', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into x select 'g1', public.ficha_guardar('00000000-0000-0000-0000-0000000f1e01',
  '{"modelo":"SC-18","descripcion":"Autoclave clase B","caracteristicas":["Dos ciclos","Acero inoxidable",""],"accesorios":["Bandejas ×3"],"ia":true,"ia_notas":"sin garantía"}',
  '[{"grupo":"Generales","etiqueta":"Capacidad","valor":"18","unidad":"L","destacado":true},{"grupo":"Eléctricas","etiqueta":"Voltaje","valor":"220","unidad":"V","destacado":true},{"grupo":"Eléctricas","etiqueta":"Potencia","valor":"2200","unidad":"VA"},{"grupo":"Físicas","etiqueta":"","valor":"x"}]')::text;
do $$ begin perform public.ficha_guardar('00000000-0000-0000-0000-0000000f1e01', '{}', '[{"etiqueta":"a","valor":"1","destacado":true},{"etiqueta":"b","valor":"1","destacado":true},{"etiqueta":"c","valor":"1","destacado":true},{"etiqueta":"d","valor":"1","destacado":true}]');
  insert into x values ('cuatro', 'guardó'); exception when others then insert into x values ('cuatro', case when sqlerrm like 'Elige máximo 3%' then 'rechazado' else sqlerrm end); end $$;
-- 4) Guardar otra vez reemplaza (las anteriores quedan dadas de baja)
insert into x select 'g2', public.ficha_guardar('00000000-0000-0000-0000-0000000f1e01', '{"modelo":"SC-18","descripcion":"Autoclave clase B","caracteristicas":["Dos ciclos"]}',
  '[{"grupo":"Generales","etiqueta":"Capacidad","valor":"18","unidad":"L","destacado":true},{"grupo":"Eléctricas","etiqueta":"Voltaje","valor":"220","unidad":"V"}]')::text;
insert into x select 'f_mkt', public.ficha_tecnica('00000000-0000-0000-0000-0000000f1e01')::text;
reset role;
insert into r select 1, 'guardar: 3 filas válidas (la vacía no), 2 destacados', '3 · 2', (select (v::jsonb ->> 'especificaciones') || ' · ' || (v::jsonb ->> 'destacados') from x where k = 'g1');
insert into r select 2, 'más de 3 destacados: rechazado', 'rechazado', (select v from x where k = 'cuatro');
insert into r select 3, 'guardar otra vez: quedan solo las nuevas (2), las otras de baja', '2 · 3',
  (select count(*) filter (where deleted_at is null)::text || ' · ' || count(*) filter (where deleted_at is not null)::text from producto_especificaciones where producto_id = '00000000-0000-0000-0000-0000000f1e01');
insert into r select 4, 'ficha: modelo, características sin vacías y fecha de IA conservada', 'SC-18 · 1 · sí',
  (select (v::jsonb -> 'ficha' ->> 'modelo') || ' · ' || jsonb_array_length(v::jsonb -> 'ficha' -> 'caracteristicas') || ' · ' || case when v::jsonb -> 'ficha' ->> 'ia_generada_en' is not null then 'sí' else 'no' end from x where k = 'f_mkt');
insert into r select 5, 'especificaciones en orden con grupo y unidad', 'Generales/Capacidad/18/L/true, Eléctricas/Voltaje/220/V/false',
  (select string_agg((e ->> 'grupo') || '/' || (e ->> 'etiqueta') || '/' || (e ->> 'valor') || '/' || (e ->> 'unidad') || '/' || (e ->> 'destacado'), ', ') from x, jsonb_array_elements(v::jsonb -> 'especificaciones') e where x.k = 'f_mkt');
insert into r select 6, 'nunca costo, stock, proveedor ni precios', 'sí',
  (select case when v !~* '(costo|stock|proveedor|pvp|precio|importa)' then 'sí' else 'no' end from x where k = 'f_mkt');
insert into r select 7, 'respaldo con los textos de la web y contacto de VIMEDIC', 'sí · sí',
  (select case when v::jsonb -> 'respaldo' ->> 'especificaciones' like 'Capacidad: 18 L%' then 'sí' else 'no' end || ' · ' || case when v::jsonb -> 'contacto' ->> 'web' <> '' then 'sí' else 'no' end from x where k = 'f_mkt');

-- 8-9) Asesor (CRM): ve la ficha pero no la puede guardar
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000f1d02', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin perform public.ficha_tecnica('00000000-0000-0000-0000-0000000f1e01'); insert into x values ('ase_ver', 've'); exception when others then insert into x values ('ase_ver', sqlerrm); end $$;
do $$ begin perform public.ficha_guardar('00000000-0000-0000-0000-0000000f1e01', '{}', '[]'); insert into x values ('ase_guardar', 'guardó');
  exception when others then insert into x values ('ase_guardar', case when sqlerrm like 'Solo quien edita Marketing%' then 'rechazado' else sqlerrm end); end $$;
reset role;
insert into r select 8, 'asesor (CRM) ve y descarga la ficha', 've', (select v from x where k = 'ase_ver');
insert into r select 9, 'asesor no puede guardar la ficha', 'rechazado', (select v from x where k = 'ase_guardar');

-- 10) Sin acceso a productos: no ve la ficha
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000f1d03', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin perform public.ficha_tecnica('00000000-0000-0000-0000-0000000f1e01'); insert into x values ('nada', 've'); exception when others then insert into x values ('nada', case when sqlerrm like 'No tienes acceso%' then 'sin acceso' else sqlerrm end); end $$;
reset role;
insert into r select 10, 'sin acceso a productos: no ve la ficha', 'sin acceso', (select v from x where k = 'nada');

select n, case when esperado = obtenido then 'OK' else 'FALLA' end as resultado, prueba, esperado, obtenido from r order by n;
rollback;
