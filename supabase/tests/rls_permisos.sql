-- Pruebas de seguridad (RLS). Correr SOLO en el proyecto de PRUEBAS, nunca en producción.
-- Se corre con psql:  psql "$DATABASE_URL_PRUEBAS" -f supabase/tests/rls_permisos.sql
-- Crea usuarios ficticios y verifica qué ve cada rol. Cada 'ERROR' de abajo es una denegación esperada:
--   borrar sin permiso, crear producto siendo asesor, crear lead de otra empresa, aprobar su propia solicitud.
\set ON_ERROR_ROLLBACK on
begin;
\set ON_ERROR_STOP 0
-- Usuarios de prueba
insert into auth.users (id, email) values
 ('00000000-0000-0000-0000-00000000000a','asesor.a@vimedic.com.ec'),
 ('00000000-0000-0000-0000-00000000000b','asesor.b@vimedic.com.ec'),
 ('00000000-0000-0000-0000-00000000000c','supervisor@vimedic.com.ec'),
 ('00000000-0000-0000-0000-00000000000f','femedics@vimedic.com.ec');
insert into empleados (email, nombre, rol_id, empresa) values
 ('supervisor@vimedic.com.ec','Supervisor',(select id from roles where nombre='Supervisor Comercial'),'VIMEDIC'),
 ('femedics@vimedic.com.ec','Vendedor Femedics',(select id from roles where nombre='Asesor'),'FEMEDICS');
-- los asesores se crean DESPUÉS del auth user: el vínculo debe hacerse igual (lo probamos con update manual abajo)
insert into empleados (email, nombre, rol_id, jefe_id) values
 ('asesor.a@vimedic.com.ec','Asesor A',(select id from roles where nombre='Asesor'),(select id from empleados where email='supervisor@vimedic.com.ec')),
 ('asesor.b@vimedic.com.ec','Asesor B',(select id from roles where nombre='Asesor'),null);
update empleados e set auth_user_id = u.id from auth.users u where u.email = e.email and e.auth_user_id is null;
-- Vínculo automático al crear el usuario de Auth después del empleado
insert into empleados (email, nombre) values ('nuevo@vimedic.com.ec','Nuevo');
insert into auth.users (id,email) values ('00000000-0000-0000-0000-0000000000ee','NUEVO@vimedic.com.ec');
select 'vinculo_automatico', auth_user_id is not null from empleados where email='nuevo@vimedic.com.ec';

insert into categorias (nombre) values ('🏥 Quirófano');
insert into productos (codigo,nombre,categoria_id,pvp,stock,en_catalogo) values ('EQM113','Máquina De Succión',(select id from categorias),680.54,2,true);
insert into productos_costos (producto_id, costo_importacion) select id, 300 from productos;
insert into leads (codigo,nombre,asesor_id) values
 ('L-A','Lead de A',(select id from empleados where email='asesor.a@vimedic.com.ec')),
 ('L-B','Lead de B',(select id from empleados where email='asesor.b@vimedic.com.ec'));
insert into leads (codigo,nombre,asesor_id,empresa) values ('L-F','Lead Femedics',(select id from empleados where email='femedics@vimedic.com.ec'),'FEMEDICS');
insert into clientes (identificacion,nombre,asesor_id) values ('602468860','Cliente de A',(select id from empleados where email='asesor.a@vimedic.com.ec'));
select 'cedula_normalizada', identificacion from clientes;

-- ===== Como Asesor A
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false);
select 'A ve leads', string_agg(codigo, ',' order by codigo) from leads;
select 'A ve productos', count(*) from productos;
select 'A ve costos', count(*) from productos_costos;
select 'A ve clientes', count(*) from clientes;
select 'A ve directorio', count(*) from v_directorio_empleados;
select 'A ve empleados (solo él)', count(*) from empleados;
update leads set estado_crm='Contactado' where codigo='L-A';
select 'A editó su lead', estado_crm from leads where codigo='L-A';
update leads set estado_crm='Ganado' where codigo='L-B';  -- no lo ve: 0 filas
update leads set deleted_at = now() where codigo='L-A';   -- debe fallar (no tiene eliminar)
update empleados set es_superadmin = true where email='asesor.a@vimedic.com.ec'; -- 0 filas (no puede editar empleados)
insert into productos (codigo,nombre) values ('X1','No debería'); -- debe fallar
insert into bitacora (modulo, accion) values ('crm','prueba');
select 'A ve bitácora', count(*) from bitacora;
select 'mi_perfil A', mi_perfil() ->> 'rol', mi_perfil() -> 'permisos' -> 'crm';
reset role;

-- ===== Como Supervisor (ver_todos, jefe de A)
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000c',false);
select 'Supervisor ve leads', string_agg(codigo, ',' order by codigo) from leads;
reset role;

-- ===== Como vendedor FEMEDICS
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000f',false);
select 'Femedics ve leads', string_agg(codigo, ',' order by codigo) from leads;
insert into leads (codigo,nombre,empresa,asesor_id) values ('L-F2','Intento VIMEDIC','VIMEDIC',(select id from empleados where auth_user_id = auth.uid())); -- debe fallar
reset role;

-- ===== Talento humano: no puede aprobar su propia solicitud
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false);
insert into th_solicitudes (tipo, empleado_id) values ('Permiso', (select id from empleados where auth_user_id = auth.uid()));
update th_solicitudes set estado='Aprobada';  -- debe fallar
select 'TH estado', estado from th_solicitudes;
reset role;
select 'Supervisor aprueba', 1; set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000c',false);
update th_solicitudes set estado='Aprobada';
select 'TH estado tras jefe', estado from th_solicitudes;
reset role;

-- ===== Anónimo (web pública)
set role anon; select set_config('request.jwt.claim.sub','',false);
select 'anon catálogo', count(*), max(nombre) from v_catalogo_publico;
select 'anon productos', count(*) from productos;
select 'anon categorías', count(*) from categorias;
select 'anon directorio', count(*) from v_directorio_empleados;
reset role;
rollback;  -- deshace todo
