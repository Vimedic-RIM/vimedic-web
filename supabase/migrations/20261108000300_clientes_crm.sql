-- =====================================================================
-- VIMEDIC · Migración 003 · Clientes y CRM
-- Reemplaza: Clientes, Clientes Femedics, Clientes_DatosVenta, Sugerencias Clientes,
--            Contactos, LeadsWhatsApp, Citas, Clientes Potenciales Meta,
--            Cotizaciones, Cotizaciones Femedics, Interacciones, EtapasPipeline,
--            Solicitudes Cambio Asesor, Rutas, Viaticos, Mensajes, AsignacionMensajes,
--            Catálogos Generados, Catálogo Asesores - Actividad, Asesores (→ empleados).
--
-- Las ~25 columnas de atribución publicitaria (UTM, GCLID, FBCLID, ID Campaña…) que
-- se repiten en varias hojas se guardan juntas en la columna jsonb "atribucion".
-- =====================================================================

create table public.clientes (
  id                     uuid primary key default gen_random_uuid(),
  codigo                 text,                     -- "ID Cliente" original
  empresa                text not null default 'VIMEDIC' check (empresa = any (app.empresas_validas())),
  identificacion         text,                     -- cédula / RUC normalizado (texto, con ceros)
  nombre                 text not null,
  institucion            text,
  email                  text,
  telefono               text,
  telefono2              text,
  provincia              text,
  ciudad                 text,
  direccion              text,
  url_maps               text,
  medio_captacion        text,
  persona_contacto       text,
  cargo_contacto         text,
  cumpleanos             date,
  aniversario_empresa    date,
  tipo_cliente           text not null default 'PVP' check (tipo_cliente in ('PVP', 'DIS')),
  descuento_fijo         numeric(5,2),
  asesor_id              uuid references public.empleados(id) on delete set null,
  responsable_id         uuid references public.empleados(id) on delete set null,
  fecha_registro         timestamptz,
  datos_venta            jsonb not null default '{}'::jsonb,  -- Clientes_DatosVenta
  atribucion             jsonb not null default '{}'::jsonb,
  -- Portal de clientes (el login lo maneja Supabase Auth; aquí solo el vínculo)
  portal_auth_user_id    uuid unique references auth.users(id) on delete set null,
  estado_acceso          text
);
select app.estandarizar('public.clientes');
create unique index clientes_empresa_identificacion_uk
  on public.clientes (empresa, identificacion)
  where identificacion is not null and deleted_at is null;
create index clientes_asesor_idx      on public.clientes (asesor_id);
create index clientes_ciudad_idx      on public.clientes (ciudad);
create index clientes_nombre_trgm     on public.clientes using gin (nombre gin_trgm_ops);
create index clientes_institucion_trgm on public.clientes using gin (institucion gin_trgm_ops);
create index clientes_identif_trgm    on public.clientes using gin (identificacion gin_trgm_ops);

create or replace function app.tg_normalizar_identificacion()
returns trigger
language plpgsql
as $$
begin
  new.identificacion := app.normalizar_identificacion(new.identificacion);
  return new;
end;
$$;

create trigger tg_normalizar_identificacion
before insert or update of identificacion on public.clientes
for each row execute function app.tg_normalizar_identificacion();

create table public.sugerencias_clientes (
  id          uuid primary key default gen_random_uuid(),
  cliente_id  uuid references public.clientes(id) on delete cascade,
  fecha       timestamptz not null default now(),
  cambios     text not null,
  origen      text,
  estado      text not null default 'Pendiente'
);
select app.estandarizar('public.sugerencias_clientes');

create table public.etapas_pipeline (
  id      uuid primary key default gen_random_uuid(),
  orden   integer not null,
  nombre  text not null unique,
  es_final boolean not null default false
);
select app.estandarizar('public.etapas_pipeline');

-- Leads: une Contactos, LeadsWhatsApp, Citas y Clientes Potenciales Meta
create table public.leads (
  id                   uuid primary key default gen_random_uuid(),
  codigo               text unique,               -- "ID Contacto" / "ID Lead" / "ID Cita" / id de Meta
  empresa              text not null default 'VIMEDIC' check (empresa = any (app.empresas_validas())),
  origen_tipo          text not null default 'contacto'
                       check (origen_tipo in ('contacto', 'whatsapp', 'cita', 'meta', 'web', 'otro')),
  fecha                timestamptz not null default now(),
  nombre               text,
  telefono             text,
  email                text,
  identificacion       text,
  ciudad               text,
  empresa_cliente      text,                     -- empresa / institución que indica el lead
  interes              text,
  canal                text,
  anuncio              text,
  contesto             boolean,
  medio_captacion      text,
  conversacion_id      text,                     -- conversación de Zernio / WhatsApp
  meta_lead_id         text unique,              -- "ID Lead Meta"
  meta_datos           jsonb not null default '{}'::jsonb, -- campos crudos del formulario de Meta
  -- Citas
  fecha_deseada        date,
  hora_deseada         time,
  motivo               text,
  -- Seguimiento
  asesor_id            uuid references public.empleados(id) on delete set null,
  estado_crm           text not null default 'Nuevo',
  ultima_actividad     timestamptz,
  proximo_seguimiento  timestamptz,
  cliente_id           uuid references public.clientes(id) on delete set null,
  atribucion           jsonb not null default '{}'::jsonb
);
select app.estandarizar('public.leads');
create index leads_asesor_estado_idx on public.leads (asesor_id, estado_crm);
create index leads_fecha_idx         on public.leads (fecha desc);
create index leads_seguimiento_idx   on public.leads (proximo_seguimiento) where proximo_seguimiento is not null;
create index leads_telefono_idx      on public.leads (telefono);
create index leads_cliente_idx       on public.leads (cliente_id);
create index leads_conversacion_idx  on public.leads (conversacion_id);

-- Cotizaciones / proformas (incluye las de FEMEDICS con empresa = 'FEMEDICS')
create table public.cotizaciones (
  id                       uuid primary key default gen_random_uuid(),
  codigo                   text unique,           -- "ID Cotización"
  empresa                  text not null default 'VIMEDIC' check (empresa = any (app.empresas_validas())),
  fecha                    timestamptz not null default now(),
  tipo_registro            text not null default 'Cotización'
                           check (tipo_registro in ('Cotización', 'Venta', 'Histórico')),
  cliente_id               uuid references public.clientes(id) on delete set null,
  lead_id                  uuid references public.leads(id) on delete set null,
  -- Datos del cliente en el momento de la cotización (copia)
  solo_nombre              text,                  -- "Cotizacion Solo Nombre" (p. ej. Consumidor Final)
  identificacion           text,
  nombre                   text,
  email                    text,
  telefono                 text,
  direccion                text,
  ciudad                   text,
  empresa_cliente          text,
  lead_sin_cliente         boolean not null default false,
  -- Comercial
  asesor_id                uuid references public.empleados(id) on delete set null,
  responsable_proforma_id  uuid references public.empleados(id) on delete set null,
  detalle_equipos          text,
  estado                   text,
  estado_crm               text not null default 'Nuevo',
  ultima_actividad         timestamptz,
  proximo_seguimiento      timestamptz,
  items                    jsonb not null default '[]'::jsonb, -- "Carrito JSON"
  total                    numeric(12,2),
  pdf_url                  text,
  -- Pago y entrega
  pago_entrega             jsonb not null default '{}'::jsonb,
  metodo_pago              text,
  estado_pago              text,
  anticipo                 numeric(12,2),
  tipo_entrega             text,
  direccion_entrega        text,
  fecha_entrega            date,
  flete                    numeric(12,2),
  flete_lo_paga            text,
  -- Marketing y notas
  medio_captacion_lead     text,
  medio_captacion_venta    text,
  productos_solicitados    jsonb not null default '[]'::jsonb,
  atribucion               jsonb not null default '{}'::jsonb,
  nota_general             text,
  nota_cotizacion          text,
  nota_venta               text,
  notas_separadas          text,
  fecha_venta              timestamptz
);
select app.estandarizar('public.cotizaciones');
create index cotizaciones_asesor_estado_idx on public.cotizaciones (asesor_id, estado_crm);
create index cotizaciones_cliente_idx       on public.cotizaciones (cliente_id);
create index cotizaciones_fecha_idx         on public.cotizaciones (fecha desc);
create index cotizaciones_identif_idx       on public.cotizaciones (identificacion);
create index cotizaciones_seguimiento_idx   on public.cotizaciones (proximo_seguimiento) where proximo_seguimiento is not null;
create index cotizaciones_empresa_idx       on public.cotizaciones (empresa, tipo_registro);

create trigger tg_normalizar_identificacion
before insert or update of identificacion on public.cotizaciones
for each row execute function app.tg_normalizar_identificacion();

-- Historial de gestiones del CRM
create table public.interacciones (
  id              uuid primary key default gen_random_uuid(),
  codigo          text unique,                 -- "INT-9a1e1678"
  ref_tipo        text not null,               -- Cotización, Contacto, Catálogo, Chat WhatsApp, Cita, Inventario, Viático
  ref_codigo      text,                        -- "RefID" original (COT-660147, WA-1494…)
  lead_id         uuid references public.leads(id) on delete cascade,
  cotizacion_id   uuid references public.cotizaciones(id) on delete cascade,
  cliente_id      uuid references public.clientes(id) on delete cascade,
  fecha           timestamptz not null default now(),
  tipo            text not null,               -- "Tipo Interacción"
  nota            text,
  empleado_id     uuid references public.empleados(id) on delete set null,
  usuario_texto   text                         -- "CRM (arrastrar)", nombres antiguos…
);
select app.estandarizar('public.interacciones');
create index interacciones_lead_idx       on public.interacciones (lead_id, fecha desc);
create index interacciones_cotizacion_idx on public.interacciones (cotizacion_id, fecha desc);
create index interacciones_cliente_idx    on public.interacciones (cliente_id, fecha desc);
create index interacciones_ref_idx        on public.interacciones (ref_codigo);

create table public.solicitudes_cambio_asesor (
  id                uuid primary key default gen_random_uuid(),
  fecha             timestamptz not null default now(),
  nombre            text,
  contacto          text,
  asesor_actual_id  uuid references public.empleados(id) on delete set null,
  motivo            text,
  estado            text not null default 'Pendiente'
);
select app.estandarizar('public.solicitudes_cambio_asesor');

create table public.rutas (
  id                uuid primary key default gen_random_uuid(),
  codigo            text unique,
  asesor_id         uuid references public.empleados(id) on delete set null,
  nombre            text not null,
  fecha_inicio      date,
  fecha_fin         date,
  clientes          jsonb not null default '[]'::jsonb,
  estado            text,
  ultima_actividad  timestamptz,
  pdf_url           text
);
select app.estandarizar('public.rutas');
create index rutas_asesor_idx on public.rutas (asesor_id, fecha_inicio desc);

create table public.viaticos (
  id                uuid primary key default gen_random_uuid(),
  codigo            text unique,
  asesor_id         uuid references public.empleados(id) on delete set null,
  fecha_solicitud   timestamptz not null default now(),
  departamento      text,
  local             text,
  jefe_id           uuid references public.empleados(id) on delete set null,
  apellidos         text,
  nombres           text,
  cedula            text,
  motivos           text,
  ruta_id           uuid references public.rutas(id) on delete set null,
  destinos          jsonb not null default '[]'::jsonb,
  gastos            jsonb not null default '[]'::jsonb,
  monto_total       numeric(12,2),
  pdf_url           text,
  estado            text not null default 'Pendiente',
  aprobado_por      uuid references public.empleados(id) on delete set null,
  fecha_resolucion  timestamptz
);
select app.estandarizar('public.viaticos');
create index viaticos_asesor_idx on public.viaticos (asesor_id, fecha_solicitud desc);

-- Mensajería de redes (Zernio / WhatsApp / Messenger / Instagram)
create table public.mensajes (
  id                uuid primary key default gen_random_uuid(),
  codigo            text unique,               -- "ID Mensaje"
  canal             text,
  conversacion_id   text not null,
  cuenta_id         text,
  nombre_contacto   text,
  direccion         text,                      -- entrante / saliente
  texto             text,
  fecha             timestamptz not null default now(),
  leido             boolean not null default false,
  zernio_id         text unique,
  payload           jsonb
);
select app.estandarizar('public.mensajes');
create index mensajes_conversacion_idx on public.mensajes (conversacion_id, fecha);

create table public.asignacion_conversaciones (
  id                uuid primary key default gen_random_uuid(),
  conversacion_id   text not null unique,
  asesor_id         uuid references public.empleados(id) on delete set null,
  fecha_asignacion  timestamptz not null default now(),
  nombre_contacto   text,
  canal             text,
  asignado_por      text
);
select app.estandarizar('public.asignacion_conversaciones');
create index asignacion_conversaciones_asesor_idx on public.asignacion_conversaciones (asesor_id);

create table public.catalogos_generados (
  id            uuid primary key default gen_random_uuid(),
  codigo        text unique,
  fecha         timestamptz not null default now(),
  asesor_id     uuid references public.empleados(id) on delete set null,
  cliente_texto text,
  formato       text,
  precios       text,
  contraportada boolean,
  segmentos     text,
  n_productos   integer,
  productos     text,
  paginas       integer,
  tamano_kb     numeric(10,1)
);
select app.estandarizar('public.catalogos_generados');

create table public.catalogo_actividad (
  id         uuid primary key default gen_random_uuid(),
  fecha      timestamptz not null default now(),
  asesor_id  uuid references public.empleados(id) on delete set null,
  enlace     text,
  accion     text,
  productos  text,
  detalle    text,
  origen     text
);
select app.estandarizar('public.catalogo_actividad');
create index catalogo_actividad_fecha_idx on public.catalogo_actividad (fecha desc);
