-- =====================================================================
-- VIMEDIC · Migración 008 · Bodega, logística y servicio técnico
-- Reemplaza: Despachos, Entregas, Encuestas, Equipos, Ordenes Servicio,
--            Técnicos, Protocolos ST, ST Incidencias Inventario.
-- =====================================================================

create table public.despachos (
  id                   uuid primary key default gen_random_uuid(),
  codigo               text unique,                 -- "ID Despacho"
  empresa              text not null default 'VIMEDIC' check (empresa = any (app.empresas_validas())),
  factura_id           uuid references public.facturas(id) on delete set null,
  operacion_codigo     text,                        -- "ID Operacion"
  fecha                timestamptz not null default now(),
  cliente_id           uuid references public.clientes(id) on delete set null,
  cliente_texto        text,
  identificacion       text,
  telefono             text,
  asesor_id            uuid references public.empleados(id) on delete set null,
  factura_texto        text,
  factura_url          text,
  estado               text not null default 'Por preparar'
                       check (estado in ('Por preparar', 'En preparación', 'Lista', 'Parcial', 'Despachada')),
  entrega              jsonb not null default '{}'::jsonb,
  productos            jsonb not null default '[]'::jsonb,
  series               jsonb not null default '[]'::jsonb,
  evidencias           jsonb not null default '[]'::jsonb,
  novedades            jsonb not null default '[]'::jsonb,
  envios               jsonb not null default '[]'::jsonb,
  historial            jsonb not null default '[]'::jsonb,
  preparado_por        uuid references public.empleados(id) on delete set null,
  inicio_preparacion   timestamptz,
  verificado_por       uuid references public.empleados(id) on delete set null,
  despachado_por       uuid references public.empleados(id) on delete set null,
  fecha_despacho       timestamptz,
  token_seguimiento    text unique                  -- enlace público de seguimiento para el cliente
);
select app.estandarizar('public.despachos');
create index despachos_estado_idx  on public.despachos (estado, fecha desc);
create index despachos_factura_idx on public.despachos (factura_id);

create table public.entregas (
  id                  uuid primary key default gen_random_uuid(),
  codigo              text unique,                  -- "ID Entrega"
  empresa             text not null default 'VIMEDIC' check (empresa = any (app.empresas_validas())),
  despacho_id         uuid references public.despachos(id) on delete set null,
  factura_id          uuid references public.facturas(id) on delete set null,
  operacion_codigo    text,
  envio_numero        integer,
  fecha               timestamptz not null default now(),
  cliente_id          uuid references public.clientes(id) on delete set null,
  cliente_texto       text,
  identificacion      text,
  telefono            text,
  email               text,
  asesor_id           uuid references public.empleados(id) on delete set null,
  factura_texto       text,
  tipo_entrega        text,
  modalidad           text,
  transportista       text,                         -- Servientrega, Tramaco, Laar…
  chofer              text,
  estado              text,
  fecha_programada    date,
  ventana             text,
  guia_numero         text,
  guia_url            text,
  costo_flete         numeric(12,2),
  eta                 timestamptz,
  constancia_url      text,
  fecha_entrega       timestamptz,
  postventa_fecha     timestamptz,
  postventa_codigo    text,
  token_seguimiento   text unique,
  entrega             jsonb not null default '{}'::jsonb,
  productos           jsonb not null default '[]'::jsonb,
  confirmacion        jsonb not null default '{}'::jsonb,
  eventos             jsonb not null default '[]'::jsonb,
  prueba              jsonb not null default '{}'::jsonb,
  incidencias         jsonb not null default '[]'::jsonb
);
select app.estandarizar('public.entregas');
create index entregas_estado_idx   on public.entregas (estado, fecha_programada);
create index entregas_despacho_idx on public.entregas (despacho_id);

-- Encuesta de satisfacción posventa
create table public.encuestas (
  id                  uuid primary key default gen_random_uuid(),
  codigo              text unique,
  fecha               timestamptz not null default now(),
  despacho_id         uuid references public.despachos(id) on delete set null,
  entrega_id          uuid references public.entregas(id) on delete set null,
  factura_id          uuid references public.facturas(id) on delete set null,
  empresa             text not null default 'VIMEDIC' check (empresa = any (app.empresas_validas())),
  cliente_texto       text,
  factura_texto       text,
  asesor_id           uuid references public.empleados(id) on delete set null,
  general             smallint,
  atencion_asesor     smallint,
  entrega             smallint,
  estado_producto     smallint,
  recomendaria        smallint check (recomendaria between 0 and 10),
  comentario          text,
  queja               text,
  tipo_queja          text,
  desea_contacto      boolean
);
select app.estandarizar('public.encuestas');

create table public.st_tecnicos (
  id            uuid primary key default gen_random_uuid(),
  empleado_id   uuid references public.empleados(id) on delete set null,
  nombre        text not null,
  tipo          text,                    -- interno / externo
  empresa       text,
  email         text,
  telefono      text,
  especialidad  text,
  activo        boolean not null default true
);
select app.estandarizar('public.st_tecnicos');

-- Equipos vendidos e instalados (base instalada, garantías y mantenimientos)
create table public.st_equipos (
  id                     uuid primary key default gen_random_uuid(),
  codigo                 text unique,                 -- "ID Equipo"
  empresa                text not null default 'VIMEDIC' check (empresa = any (app.empresas_validas())),
  serie                  text,
  producto_id            uuid references public.productos(id) on delete set null,
  producto_texto         text,
  marca                  text,
  modelo                 text,
  lote                   text,
  fabricacion            text,
  proveedor_texto        text,
  importacion_codigo     text,
  factura_id             uuid references public.facturas(id) on delete set null,
  operacion_codigo       text,
  factura_texto          text,
  clave_venta            text,
  cliente_id             uuid references public.clientes(id) on delete set null,
  cliente_texto          text,
  identificacion         text,
  telefono               text,
  email                  text,
  ciudad                 text,
  direccion              text,
  ubicacion              text,
  asesor_id              uuid references public.empleados(id) on delete set null,
  fecha_venta            date,
  fecha_entrega          date,
  garantia_meses         integer,
  garantia_hasta         date,
  plan_mantenimiento     text check (plan_mantenimiento in ('Facturable', 'Incluido', 'Contrato', 'Sin plan')),
  frecuencia_meses       integer,
  proximo_mantenimiento  date,
  estado                 text check (estado in ('Operativo', 'Operativo con observaciones', 'No operativo', 'Dado de baja')),
  origen                 text,
  notas                  text
);
select app.estandarizar('public.st_equipos');
create index st_equipos_serie_idx         on public.st_equipos (serie);
create index st_equipos_cliente_idx       on public.st_equipos (cliente_id);
create index st_equipos_mantenimiento_idx on public.st_equipos (proximo_mantenimiento) where proximo_mantenimiento is not null;

create table public.st_ordenes (
  id                     uuid primary key default gen_random_uuid(),
  codigo                 text unique,                 -- "ID Orden"
  empresa                text not null default 'VIMEDIC' check (empresa = any (app.empresas_validas())),
  fecha                  timestamptz not null default now(),
  tipo                   text check (tipo in ('Instalación', 'Capacitación', 'Mantenimiento preventivo',
                           'Mantenimiento correctivo', 'Diagnóstico', 'Inspección técnica', 'Calibración', 'Baja técnica')),
  origen                 text,
  prioridad              text not null default 'Normal' check (prioridad in ('Normal', 'Alta', 'Urgente')),
  estado                 text not null default 'Recibida'
                         check (estado in ('Recibida', 'Agendada', 'En proceso', 'Esperando aprobación',
                           'Esperando repuesto', 'Finalizada', 'Cancelada')),
  modalidad              text check (modalidad in ('En sitio', 'Taller', 'Remoto')),
  cobertura              text check (cobertura in ('Garantía', 'Incluido en la venta', 'Contrato', 'Facturable', 'Cortesía')),
  equipo_id              uuid references public.st_equipos(id) on delete set null,
  serie                  text,
  producto_texto         text,
  cliente_id             uuid references public.clientes(id) on delete set null,
  cliente_texto          text,
  identificacion         text,
  contacto               text,
  telefono               text,
  email                  text,
  direccion              text,
  ciudad                 text,
  factura_id             uuid references public.facturas(id) on delete set null,
  operacion_codigo       text,
  factura_texto          text,
  asesor_id              uuid references public.empleados(id) on delete set null,
  tecnico_id             uuid references public.st_tecnicos(id) on delete set null,
  tecnico_texto          text,
  fecha_programada       timestamptz,
  falla_reportada        text,
  diagnostico            text,
  trabajo_realizado      text,
  recomendaciones        text,
  estado_final           text check (estado_final in ('Operativo', 'Operativo con observaciones', 'No operativo', 'Dado de baja')),
  proximo_mantenimiento  date,
  horas                  numeric(6,2),
  inicio                 timestamptz,
  cierre                 timestamptz,
  informe_numero         text,
  informe_url            text,
  recepcion_numero       text,
  recepcion_url          text,
  repuestos_descontados  boolean not null default false,
  facturacion            text,
  token                  text unique,                 -- enlace público para el cliente / firma
  recepcion              jsonb not null default '{}'::jsonb,
  cotizacion             jsonb not null default '{}'::jsonb,
  checklist              jsonb not null default '[]'::jsonb,
  mediciones             jsonb not null default '[]'::jsonb,
  repuestos              jsonb not null default '[]'::jsonb,
  asistentes             jsonb not null default '[]'::jsonb,
  fotos                  jsonb not null default '[]'::jsonb,
  firma                  jsonb,
  eventos                jsonb not null default '[]'::jsonb
);
select app.estandarizar('public.st_ordenes');
create index st_ordenes_estado_idx  on public.st_ordenes (estado, fecha_programada);
create index st_ordenes_tecnico_idx on public.st_ordenes (tecnico_id, fecha_programada);
create index st_ordenes_equipo_idx  on public.st_ordenes (equipo_id);

-- Plantillas de checklist por tipo de servicio y tipo de equipo
create table public.st_protocolos (
  id             uuid primary key default gen_random_uuid(),
  tipo_servicio  text not null,
  aplica_a       text not null default '*',     -- '*', 'autoclave', 'monitor', 'desfibrilador'…
  orden          integer not null,
  actividad      text not null
);
select app.estandarizar('public.st_protocolos');
create index st_protocolos_tipo_idx on public.st_protocolos (tipo_servicio, aplica_a, orden);

-- Seguimiento técnico de productos en inventario (unidades con fallas en bodega)
create table public.st_incidencias_inventario (
  id               uuid primary key default gen_random_uuid(),
  codigo           text unique,                 -- "ID Seguimiento"
  producto_id      uuid references public.productos(id) on delete set null,
  producto_codigo  text,
  serie            text,
  unidad_id        uuid references public.imp_unidades(id) on delete set null,
  estado           text check (estado in ('Pendiente de revisión', 'En diagnóstico', 'En reparación',
                     'Esperando repuesto', 'Listo para revisión de Bodega', 'No reparable', 'Resuelto')),
  falla            text,
  diagnostico      text,
  trabajo          text,
  pruebas          text,
  recomendaciones  text,
  tecnico_texto    text,
  historial        jsonb not null default '[]'::jsonb,
  evidencias       jsonb not null default '[]'::jsonb
);
select app.estandarizar('public.st_incidencias_inventario');
create index st_incidencias_producto_idx on public.st_incidencias_inventario (producto_id);
