-- =====================================================================
-- VIMEDIC · Migración 006 · Marketing
-- Reemplaza: Audiovisual, MK_PostMeta, Marketing Cambios, Marketing Enlaces,
--            Ofertas, Promo Campañas, Material Solicitudes, Material Archivos,
--            Anuncios Activos.
-- =====================================================================

create table public.audiovisual (
  id               uuid primary key default gen_random_uuid(),
  codigo           text unique,
  fecha            timestamptz not null default now(),
  titulo           text not null,
  tipo             text check (tipo in ('Foto', 'Video', 'Reel', 'Historia', 'Carrusel', 'Diseño')),
  estado           text not null default 'Idea'
                   check (estado in ('Idea', 'En producción', 'En edición', 'Listo', 'Programado', 'Publicado')),
  producto_id      uuid references public.productos(id) on delete set null,
  campana          text,
  responsable_id   uuid references public.empleados(id) on delete set null,
  archivo_id       uuid references public.archivos(id) on delete set null,
  archivo_drive_id text,
  archivo_url      text,
  mime             text,
  tamano_mb        numeric(10,2),
  miniatura_id     text,
  enlace_publico   text,
  publicacion_id   text,
  notas            text
);
select app.estandarizar('public.audiovisual');
create index audiovisual_estado_idx   on public.audiovisual (estado, fecha desc);
create index audiovisual_producto_idx on public.audiovisual (producto_id);

-- Publicaciones de Meta vinculadas a piezas audiovisuales y productos
create table public.marketing_publicaciones (
  id              uuid primary key default gen_random_uuid(),
  post_id         text not null unique,
  audiovisual_id  uuid references public.audiovisual(id) on delete set null,
  producto_id     uuid references public.productos(id) on delete set null,
  fecha           timestamptz not null default now(),
  por             text
);
select app.estandarizar('public.marketing_publicaciones');

-- Cambios a fichas de producto propuestos por Marketing (flujo de aprobación)
create table public.marketing_cambios (
  id                uuid primary key default gen_random_uuid(),
  codigo            text unique,
  fecha             timestamptz not null default now(),
  producto_id       uuid references public.productos(id) on delete cascade,
  producto_texto    text,
  campo             text not null,
  nivel             text,
  valor_anterior    text,
  valor_nuevo       text,
  estado            text not null default 'Pendiente',
  autor_id          uuid references public.empleados(id) on delete set null,
  autor_rol         text,
  revisado_por      uuid references public.empleados(id) on delete set null,
  fecha_revision    timestamptz,
  comentario        text,
  correcciones      integer not null default 0,
  fecha_devolucion  timestamptz,
  horas_correccion  numeric(8,2)
);
select app.estandarizar('public.marketing_cambios');
create index marketing_cambios_estado_idx   on public.marketing_cambios (estado, fecha desc);
create index marketing_cambios_producto_idx on public.marketing_cambios (producto_id);

-- Enlaces de aprobación enviados por correo (un solo uso)
create table public.marketing_enlaces (
  id         uuid primary key default gen_random_uuid(),
  hash       text not null unique,
  cambio_ids uuid[] not null default '{}',
  ids_texto  text,                         -- IDs originales de la hoja
  email      text,
  nombre     text,
  creado     timestamptz not null default now(),
  vence      timestamptz,
  usado_en   timestamptz
);
select app.estandarizar('public.marketing_enlaces');

create table public.promo_campanas (
  id                uuid primary key default gen_random_uuid(),
  codigo            text unique,
  nombre            text not null,
  inicio            date,
  fin               date,
  estado            text not null default 'Borrador'
                    check (estado in ('Borrador', 'En aprobación', 'Devuelta', 'Aprobada', 'Rechazada', 'Cancelada')),
  items             jsonb not null default '[]'::jsonb,
  combos            jsonb not null default '[]'::jsonb,
  preventa          boolean not null default false,
  preventa_dias     integer,
  enviado           timestamptz,
  aprobado_por      uuid references public.empleados(id) on delete set null,
  fecha_aprobacion  timestamptz,
  comentario        text,
  historial         jsonb not null default '[]'::jsonb,
  actualizado_por   uuid references public.empleados(id) on delete set null
);
select app.estandarizar('public.promo_campanas');

create table public.ofertas (
  id                 uuid primary key default gen_random_uuid(),
  codigo             text unique,
  producto_id        uuid references public.productos(id) on delete cascade,
  campana_id         uuid references public.promo_campanas(id) on delete set null,
  tipo               text check (tipo in ('Oferta relámpago', 'Precio especial', 'Combo', 'Regalo',
                       'Liquidación', 'Outlet', 'Lote distribuidor', 'Campaña')),
  descuento_pct      numeric(5,2),
  precio_oferta      numeric(12,2),
  pvp_base           numeric(12,2),
  costo              numeric(12,2),
  margen_pct         numeric(6,2),
  inicio             date,
  fin                date,
  estado             text,
  texto_cliente      text,
  combo_con          text,
  regalo             text,
  grupo              text,
  stock_inicial      integer,
  unidades_objetivo  integer,
  unidades_limite    integer,
  historial          jsonb not null default '[]'::jsonb,
  actualizado_por    uuid references public.empleados(id) on delete set null
);
select app.estandarizar('public.ofertas');
create index ofertas_producto_idx on public.ofertas (producto_id);
create index ofertas_vigencia_idx on public.ofertas (inicio, fin);

-- Solicitudes de material (fotos, videos, fichas) a proveedores mediante enlace con token
create table public.material_solicitudes (
  id               uuid primary key default gen_random_uuid(),
  codigo           text unique,
  token            text not null unique,
  proveedor_id     uuid references public.proveedores(id) on delete set null,
  proveedor_texto  text,
  titulo           text not null,
  estado           text not null default 'Abierta',
  vence            timestamptz,
  nota             text,
  productos        jsonb not null default '[]'::jsonb,
  actualizado_por  uuid references public.empleados(id) on delete set null
);
select app.estandarizar('public.material_solicitudes');

create table public.material_archivos (
  id            uuid primary key default gen_random_uuid(),
  codigo        text unique,
  solicitud_id  uuid not null references public.material_solicitudes(id) on delete cascade,
  clave         text,
  tipo          text,
  nombre        text,
  url           text,
  tamano        bigint,
  fecha         timestamptz not null default now(),
  origen        text,
  nota          text
);
select app.estandarizar('public.material_archivos');
create index material_archivos_solicitud_idx on public.material_archivos (solicitud_id);

create table public.anuncios_activos (
  id      uuid primary key default gen_random_uuid(),
  nombre  text not null unique
);
select app.estandarizar('public.anuncios_activos');
