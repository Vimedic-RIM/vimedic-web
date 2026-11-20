-- Pruebas: ofertas para la web pública (migración 20261120140000). Correr SOLO en PRUEBAS; se deshace.
--   npx supabase db query --remote --yes -f supabase/tests/ofertas_web_publica.sql
begin;
create temp table r (n int, prueba text, esperado text, obtenido text) on commit drop;
grant all on r to authenticated, anon;

insert into categorias (id, nombre, orden) values ('00000000-0000-0000-0000-0000000c0b01', 'T Cat Black', 1);
insert into promo_campanas (id, codigo, nombre, inicio, fin, estado) values ('00000000-0000-0000-0000-0000000c0b10', 'T-BLACK', 'T Black Prueba', current_date - 1, current_date + 10, 'Aprobada');
insert into productos (id, codigo, nombre, pvp, en_catalogo, oculto, categoria_id, imagen_url) values
  ('00000000-0000-0000-0000-0000000c0b21', 'T-BLK-1', 'Equipo Black visible', 1000, true, false, '00000000-0000-0000-0000-0000000c0b01', 'https://drive.google.com/file/d/abc123456789012345678901/view'),
  ('00000000-0000-0000-0000-0000000c0b22', 'T-BLK-2', 'Equipo Black oculto', 1000, true, true, '00000000-0000-0000-0000-0000000c0b01', null),
  ('00000000-0000-0000-0000-0000000c0b23', 'T-BLK-3', 'Equipo solo distribuidor', 1000, true, false, '00000000-0000-0000-0000-0000000c0b01', null),
  ('00000000-0000-0000-0000-0000000c0b24', 'T-BLK-4', 'Equipo oferta vencida', 1000, true, false, '00000000-0000-0000-0000-0000000c0b01', null);
insert into ofertas (producto_id, campana_id, tipo, descuento_pct, precio_oferta, pvp_base, costo, inicio, fin, aplica_a) values
  ('00000000-0000-0000-0000-0000000c0b21', '00000000-0000-0000-0000-0000000c0b10', 'Campaña', 20, 800, 1000, 500, current_date - 1, current_date + 10, 'AMBOS'),
  ('00000000-0000-0000-0000-0000000c0b21', '00000000-0000-0000-0000-0000000c0b10', 'Campaña', 30, 700, 1000, 500, current_date - 1, current_date + 10, 'PVP'),
  ('00000000-0000-0000-0000-0000000c0b22', '00000000-0000-0000-0000-0000000c0b10', 'Campaña', 25, 750, 1000, 500, current_date - 1, current_date + 10, 'AMBOS'),
  ('00000000-0000-0000-0000-0000000c0b23', '00000000-0000-0000-0000-0000000c0b10', 'Campaña', 40, 600, 1000, 500, current_date - 1, current_date + 10, 'DIS'),
  ('00000000-0000-0000-0000-0000000c0b24', '00000000-0000-0000-0000-0000000c0b10', 'Campaña', 15, 850, 1000, 500, current_date - 20, current_date - 2, 'AMBOS');

create temp table x as select public.web_ofertas_publicas() as v;
insert into r select 1, 'producto visible con oferta vigente: el mayor descuento', '30',
  (select e ->> 'descuento' from x, jsonb_array_elements(v -> 'productos') e where e ->> 'codigo' = 'T-BLK-1');
insert into r select 2, 'no salen ocultos, solo-distribuidor ni vencidas', '0',
  (select count(*)::text from x, jsonb_array_elements(v -> 'productos') e where e ->> 'codigo' in ('T-BLK-2', 'T-BLK-3', 'T-BLK-4'));
insert into r select 3, 'sin precios, costos ni márgenes', 'no',
  (select case when v::text ~ '"(precio|pvp|costo|margen|precio_oferta|pvp_base)"' then 'sí' else 'no' end from x);
insert into r select 4, 'campaña con su máximo descuento', 'T Black Prueba · 30',
  (select (e ->> 'nombre') || ' · ' || (e ->> 'maxDescuento')::numeric::int from x, jsonb_array_elements(v -> 'campanas') e where e ->> 'nombre' = 'T Black Prueba');
-- 5) El público y los usuarios con sesión no pueden ejecutarla directo (solo la Edge Function)
set local role anon;
do $$ begin perform public.web_ofertas_publicas(); insert into r values (5, 'anon no la ejecuta', 'sin permiso', 'la ejecutó');
exception when insufficient_privilege then insert into r values (5, 'anon no la ejecuta', 'sin permiso', 'sin permiso'); end $$;
reset role;

select n, case when esperado = obtenido then 'OK' else 'FALLA' end as resultado, prueba, esperado, obtenido from r order by n;
rollback;
