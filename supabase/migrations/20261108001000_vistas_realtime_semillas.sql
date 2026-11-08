-- =====================================================================
-- VIMEDIC · Migración 010 · Vistas, tiempo real y datos iniciales
-- =====================================================================

-- ---------------------------------------------------------------------
-- Catálogo público (vimedic.com.ec). Corre con permisos del dueño A PROPÓSITO:
-- expone solo columnas seguras (sin costos, stock exacto ni reservaciones).
-- ---------------------------------------------------------------------
create view public.v_catalogo_publico as
select p.id,
       p.codigo,
       p.nombre,
       c.nombre       as categoria,
       c.orden        as categoria_orden,
       p.marca,
       p.descripcion,
       p.caracteristicas,
       p.especificaciones,
       p.accesorios,
       p.certificaciones,
       p.imagen_url,
       p.ficha_tecnica_url,
       (p.stock > 0)  as disponible,
       not p.sin_etiqueta_nuevo and p.fecha_creacion > current_date - 90 as es_nuevo,
       p.orden,
       coalesce((
         select jsonb_agg(jsonb_build_object('tipo', g.tipo, 'url', g.archivo_url, 'descripcion', g.descripcion)
                          order by g.orden)
         from public.producto_galeria g
         where g.producto_id = p.id and g.deleted_at is null
       ), '[]'::jsonb) as galeria
from public.productos p
left join public.categorias c on c.id = p.categoria_id
where p.en_catalogo and not p.oculto and p.deleted_at is null;

grant select on public.v_catalogo_publico to anon, authenticated;

-- ---------------------------------------------------------------------
-- Vistas internas: respetan el RLS de quien consulta (security_invoker)
-- ---------------------------------------------------------------------

-- Reemplaza las columnas calculadas a mano en Clientes (Total Cotizaciones, Última Venta…)
create view public.v_clientes_resumen
with (security_invoker = true)
as
select c.id,
       c.empresa,
       c.identificacion,
       c.nombre,
       c.institucion,
       c.ciudad,
       c.tipo_cliente,
       c.asesor_id,
       (select count(*) from public.cotizaciones q
         where q.cliente_id = c.id and q.deleted_at is null and q.tipo_registro <> 'Venta') as total_cotizaciones,
       (select max(q.fecha) from public.cotizaciones q
         where q.cliente_id = c.id and q.deleted_at is null) as ultima_cotizacion,
       (select count(*) from public.facturas f
         where f.cliente_id = c.id and f.deleted_at is null) as total_ventas,
       (select coalesce(sum(coalesce(f.total_neto, f.total)), 0) from public.facturas f
         where f.cliente_id = c.id and f.deleted_at is null) as monto_ventas,
       (select max(f.fecha_facturacion) from public.facturas f
         where f.cliente_id = c.id and f.deleted_at is null) as ultima_venta
from public.clientes c
where c.deleted_at is null;

-- Embudo del CRM por asesor y estado (para el dashboard)
create view public.v_embudo_crm
with (security_invoker = true)
as
select 'lead'::text as tipo, l.empresa, l.asesor_id, l.estado_crm, date_trunc('month', l.fecha) as mes, count(*) as cantidad
from public.leads l where l.deleted_at is null
group by 1, 2, 3, 4, 5
union all
select 'cotizacion', q.empresa, q.asesor_id, q.estado_crm, date_trunc('month', q.fecha), count(*)
from public.cotizaciones q where q.deleted_at is null and q.tipo_registro <> 'Histórico'
group by 1, 2, 3, 4, 5;

-- Ventas por mes y asesor
create view public.v_ventas_mensuales
with (security_invoker = true)
as
select f.empresa,
       date_trunc('month', f.fecha_facturacion)::date as mes,
       f.asesor_id,
       count(*)                                         as facturas,
       sum(coalesce(f.total_neto, f.total, 0))          as monto
from public.facturas f
where f.deleted_at is null and f.fecha_facturacion is not null
group by 1, 2, 3;

-- Kardex: entradas y salidas por producto
create view public.v_kardex
with (security_invoker = true)
as
select m.producto_id,
       p.codigo,
       p.nombre,
       m.fecha,
       m.tipo,
       case when m.tipo in ('INGRESO', 'DEVOLUCION') then m.cantidad else -m.cantidad end as cantidad_signo,
       sum(case when m.tipo in ('INGRESO', 'DEVOLUCION') then m.cantidad else -m.cantidad end)
         over (partition by m.producto_id order by m.fecha, m.created_at) as saldo,
       m.factura_texto,
       m.cliente_texto,
       m.responsable_texto,
       m.observacion
from public.movimientos_inventario m
join public.productos p on p.id = m.producto_id
where m.deleted_at is null;

-- ---------------------------------------------------------------------
-- Tiempo real: reemplaza el watcher de 15 s de Facturación y el refresco del CRM.
-- (La publicación supabase_realtime existe solo en Supabase.)
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.facturas, public.cotizaciones, public.leads, public.interacciones,
      public.mensajes, public.despachos, public.entregas, public.actividades,
      public.notificaciones, public.productos;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Datos iniciales
-- ---------------------------------------------------------------------
insert into public.etapas_pipeline (orden, nombre, es_final) values
  (1, 'Nuevo', false),
  (2, 'Contactado', false),
  (3, 'Sin Respuesta', false),
  (4, 'Seguimiento', false),
  (5, 'En Negociación', false),
  (6, 'Visita', false),
  (7, 'Ganado', true),
  (8, 'Perdido', true)
on conflict (nombre) do nothing;

-- Roles base. Ajusta los permisos desde el módulo Seguridad cuando esté listo.
insert into public.roles (nombre, descripcion, rol_crm, alcance, es_superadmin, es_sistema, permisos) values
  ('Superadministrador', 'Acceso total', null, 'organizacion', true, true, '{}'),
  ('Alta Dirección', 'Gerencia: ve todo, aprueba', 'Alta Dirección', 'organizacion', false, true, '{
     "crm": ["ver","crear","editar","ver_todos","exportar"],
     "clientes": ["ver","crear","editar","exportar"],
     "facturacion": ["ver","exportar"],
     "inventario": ["ver"],
     "movimientos": ["ver"],
     "dashboard": ["ver","exportar"],
     "importaciones": ["ver","aprobar"],
     "promociones": ["ver","aprobar"],
     "agenda": ["ver","crear","editar"],
     "empleados": ["ver"]
   }'),
  ('Supervisor Comercial', 'Ve los leads de todo el equipo', 'Supervisor Comercial', 'subordinados', false, true, '{
     "crm": ["ver","crear","editar","ver_todos"],
     "clientes": ["ver","crear","editar"],
     "inventario": ["ver"],
     "catalogos": ["ver","crear"],
     "ofertas": ["ver"],
     "agenda": ["ver","crear","editar"]
   }'),
  ('Asesor', 'Ve sus propios leads y clientes', 'Asesor', 'propio', false, true, '{
     "crm": ["ver","crear","editar"],
     "inventario": ["ver"],
     "catalogos": ["ver","crear"],
     "ofertas": ["ver"],
     "agenda": ["ver","crear","editar"]
   }'),
  ('Marketing', 'Contenido, catálogo y campañas', 'Marketing', 'organizacion', false, true, '{
     "marketing": ["ver","crear","editar"],
     "crm": ["ver","ver_todos"],
     "inventario": ["ver"],
     "catalogos": ["ver","crear"],
     "promociones": ["ver","crear","editar"],
     "agenda": ["ver","crear","editar"]
   }'),
  ('Facturación', 'Facturas, ingresos y notas de crédito', null, 'organizacion', false, true, '{
     "facturacion": ["ver","crear","editar","exportar"],
     "clientes": ["ver","crear","editar"],
     "movimientos": ["ver","crear","editar"],
     "inventario": ["ver"],
     "agenda": ["ver","crear","editar"]
   }'),
  ('Bodega', 'Despachos, recepción e inventario físico', null, 'organizacion', false, true, '{
     "bodega": ["ver","crear","editar"],
     "movimientos": ["ver","crear"],
     "inventario": ["ver","editar"],
     "importaciones": ["ver"],
     "agenda": ["ver","crear","editar"]
   }'),
  ('Logística', 'Entregas y posventa', null, 'organizacion', false, true, '{
     "logistica": ["ver","crear","editar"],
     "bodega": ["ver"],
     "agenda": ["ver","crear","editar"]
   }'),
  ('Servicio Técnico', 'Equipos, órdenes de servicio e informes', null, 'organizacion', false, true, '{
     "servicio_tecnico": ["ver","crear","editar"],
     "documentos_tecnicos": ["ver","crear","editar"],
     "inventario": ["ver"],
     "importaciones": ["ver"],
     "agenda": ["ver","crear","editar"]
   }')
on conflict (nombre) do nothing;

-- Protocolos de servicio técnico (checklists por tipo de servicio y equipo)
insert into public.st_protocolos (tipo_servicio, aplica_a, orden, actividad)
select v.tipo, v.aplica, v.ord, v.act
from (values
  ('Instalación', 'autoclave', 1, 'Llenado del tanque de agua destilada'),
  ('Instalación', 'autoclave', 2, 'Ciclo de prueba en vacío'),
  ('Instalación', 'autoclave', 3, 'Prueba de vacío (Vacuum test)'),
  ('Instalación', 'autoclave', 4, 'Prueba Bowie-Dick / Helix'),
  ('Capacitación', '*', 1, 'Descripción general y partes del equipo'),
  ('Capacitación', '*', 2, 'Encendido, apagado y operación básica'),
  ('Capacitación', '*', 3, 'Configuración y funciones principales'),
  ('Capacitación', '*', 4, 'Limpieza y desinfección'),
  ('Capacitación', '*', 5, 'Cuidados y mantenimiento por el usuario'),
  ('Capacitación', '*', 6, 'Alarmas y solución de problemas frecuentes'),
  ('Capacitación', '*', 7, 'Normas de seguridad'),
  ('Capacitación', '*', 8, 'Condiciones de la garantía y plan de mantenimiento'),
  ('Mantenimiento preventivo', '*', 1, 'Inspección visual de carcasa, estructura y etiquetas'),
  ('Mantenimiento preventivo', '*', 2, 'Revisión de cable de poder, enchufe y conexiones'),
  ('Mantenimiento preventivo', '*', 3, 'Limpieza interna y externa'),
  ('Mantenimiento preventivo', '*', 4, 'Ajuste de tornillería y partes móviles'),
  ('Mantenimiento preventivo', '*', 5, 'Verificación de alarmas e indicadores'),
  ('Mantenimiento preventivo', '*', 6, 'Prueba de seguridad eléctrica (tierra y fugas)'),
  ('Mantenimiento preventivo', '*', 7, 'Revisión de accesorios'),
  ('Mantenimiento preventivo', '*', 8, 'Prueba de funcionamiento general'),
  ('Mantenimiento correctivo', '*', 1, 'Verificación de la falla reportada'),
  ('Mantenimiento correctivo', '*', 2, 'Identificación de la causa'),
  ('Mantenimiento correctivo', '*', 3, 'Reparación o reemplazo de componentes'),
  ('Mantenimiento correctivo', '*', 4, 'Prueba de funcionamiento posterior'),
  ('Mantenimiento correctivo', '*', 5, 'Verificación de seguridad eléctrica'),
  ('Diagnóstico', '*', 1, 'Verificación de la falla reportada'),
  ('Diagnóstico', '*', 2, 'Inspección visual'),
  ('Diagnóstico', '*', 3, 'Pruebas eléctricas y funcionales'),
  ('Diagnóstico', '*', 4, 'Identificación de la causa')
) as v(tipo, aplica, ord, act)
where not exists (select 1 from public.st_protocolos);
