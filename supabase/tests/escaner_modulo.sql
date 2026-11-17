-- Pruebas del escáner por módulo (mod_escanear). Correr SOLO en PRUEBAS; se deshace.
--   npx supabase db query --remote --yes -f supabase/tests/escaner_modulo.sql
begin;
create temp table r (n int, prueba text, obtenido text) on commit drop;
grant all on r to authenticated;
insert into empleados (email, nombre, empresa, permisos_extra) values ('t.esc.bod@vimedic.test', 'T Bodega Esc', 'VIMEDIC', '{"bodega":["ver","editar"]}');
insert into empleados (email, nombre, empresa, rol_id) values ('t.esc.ase@vimedic.test', 'T Asesor Esc', 'VIMEDIC', (select id from roles where nombre = 'Asesor'));
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d7', 't.esc.bod@vimedic.test'), ('00000000-0000-0000-0000-0000000000d8', 't.esc.ase@vimedic.test');
update empleados e set auth_user_id = u.id from auth.users u where u.email = e.email and e.auth_user_id is null and e.email like 't.esc.%';
insert into despachos (id, codigo, numero_guia, cliente_texto, estado, token_seguimiento) values ('00000000-0000-0000-0000-00000000dd01', 'DSP-ZZESC', 'GD-ZZ-1', 'Cliente Escáner', 'Por preparar', 'abcdef0123456789abcdef0123456789');
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000d7', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into r select 1, 'por código de despacho', (public.mod_escanear('dsp-zzesc') ->> 'despacho');
insert into r select 2, 'por número de guía', (public.mod_escanear('GD-ZZ-1') ->> 'cliente');
insert into r select 3, 'por el enlace del QR', (public.mod_escanear('https://vimedic.com.ec/seguimiento/?c=abcdef0123456789abcdef0123456789') ->> 'despacho');
do $$ begin perform public.mod_escanear('NO-EXISTE-123'); insert into r values (4, 'código inexistente', 'PERMITIDO'); exception when others then insert into r values (4, 'código inexistente', left(sqlerrm, 60)); end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000d8', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin perform public.mod_escanear('DSP-ZZESC'); insert into r values (5, 'asesor sin acceso', 'PERMITIDO'); exception when others then insert into r values (5, 'asesor sin acceso', left(sqlerrm, 60)); end $$;
reset role;
select * from r order by n;
rollback;
