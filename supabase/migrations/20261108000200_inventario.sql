-- =====================================================================
-- VIMEDIC · Migración 002 · Inventario y catálogo
-- Reemplaza: Productos (e INVENTARIO, hoja anterior), Catálogo Categorías,
--            Galería Productos, Proveedores, Fichas Técnicas, Documentos Técnicos,
--            notas internas de productos y clientes, Aliados.
-- =====================================================================

create table public.categorias (
  id          uuid primary key default gen_random_uuid(),
  codigo      text unique,
  nombre      text not null unique,          -- tal como está hoy, p. ej. '🏥 Quirófano'
  imagen_url  text,
  texto       text,
  orden       integer,
  activo      boolean not null default true
);
select app.estandarizar('public.categorias');

create table public.proveedores (
  id                uuid primary key default gen_random_uuid(),
  codigo            text unique,             -- "ID Proveedor"
  ruc               text,
  razon_social      text not null,
  nombre_comercial  text,
  contacto          text,
  telefono          text,
  email             text,
  pais              text default 'Ecuador',
  ciudad            text,
  direccion         text,
  estado            text not null default 'Activo',
  observacion       text,
  fecha_registro    timestamptz
);
select app.estandarizar('public.proveedores');
create index proveedores_ruc_idx on public.proveedores (ruc);

create table public.productos (
  id                     uuid primary key default gen_random_uuid(),
  codigo                 text not null unique,   -- "ID" (EQM113, INM474…)
  codigo_unico           text,                   -- "Código Unico" / modelo (HLE-C233)
  nombre                 text not null,
  categoria_id           uuid references public.categorias(id) on delete set null,
  marca                  text,
  proveedor_id           uuid references public.proveedores(id) on delete set null,
  referencia_proveedor   text,
  -- Contenido comercial
  descripcion            text,
  caracteristicas        text,
  especificaciones       text,
  accesorios             text,
  certificaciones        text,
  ficha_tecnica_url      text,
  imagen_url             text,                   -- se reemplaza por la URL de R2 al migrar
  drive_carpeta_url      text,
  -- Precios
  pvp                    numeric(12,2),
  precio_dis             numeric(12,2),
  aplica_iva             boolean not null default true,
  precios_promocion      jsonb not null default '{}'::jsonb, -- {"black_friday_pvp": 0, "promo_verano": 0}
  -- Stock
  stock                  integer not null default 0,
  stock_fisico           integer not null default 0,
  stock_no_disponible_nc integer not null default 0,
  stock_por_reparar      integer not null default 0,
  stock_minimo           integer,
  stock_maximo           integer,
  reservaciones          text,                   -- observaciones de stock
  requiere_serie         boolean not null default false,
  -- Visibilidad
  estado                 text,
  en_catalogo            boolean not null default false,
  oculto                 boolean not null default false,
  sin_etiqueta_nuevo     boolean not null default false,
  orden                  integer,
  fecha_creacion         date
);
select app.estandarizar('public.productos');
create index productos_categoria_idx   on public.productos (categoria_id);
create index productos_marca_idx       on public.productos (marca);
create index productos_codigo_unico_idx on public.productos (codigo_unico);
create index productos_nombre_trgm     on public.productos using gin (nombre gin_trgm_ops);
create index productos_codigo_trgm     on public.productos using gin (codigo gin_trgm_ops);
create index productos_catalogo_idx    on public.productos (orden) where en_catalogo and not oculto and deleted_at is null;

-- Costos en tabla aparte: los asesores ven el producto pero no el costo.
create table public.productos_costos (
  producto_id         uuid primary key references public.productos(id) on delete cascade,
  costo_importacion   numeric(12,2),
  costo_promedio      numeric(12,2),
  ultima_importacion  text,
  moneda              text not null default 'USD'
);
select app.estandarizar('public.productos_costos');

create table public.producto_galeria (
  id           uuid primary key default gen_random_uuid(),
  producto_id  uuid not null references public.productos(id) on delete cascade,
  orden        integer not null default 0,
  tipo         text not null default 'imagen' check (tipo in ('imagen', 'video')),
  tipo_video   text,
  archivo_url  text not null,
  archivo_id   uuid references public.archivos(id) on delete set null,
  descripcion  text
);
select app.estandarizar('public.producto_galeria');
create index producto_galeria_producto_idx on public.producto_galeria (producto_id, orden);

create table public.fichas_tecnicas (
  id               uuid primary key default gen_random_uuid(),
  producto_id      uuid not null references public.productos(id) on delete cascade,
  fecha            timestamptz not null default now(),
  version          integer not null default 1,
  url              text,
  drive_id         text,
  hash             text,
  generada_por     uuid references public.empleados(id) on delete set null,
  anterior_url     text
);
select app.estandarizar('public.fichas_tecnicas');
create index fichas_tecnicas_producto_idx on public.fichas_tecnicas (producto_id, version desc);

create table public.documentos_tecnicos (
  id           uuid primary key default gen_random_uuid(),
  codigo       text unique,
  producto_id  uuid not null references public.productos(id) on delete cascade,
  tipo         text not null check (tipo in ('Manual de usuario', 'Manual de servicio',
                 'Hoja de datos del fabricante', 'Certificado', 'Registro sanitario', 'Otro')),
  nombre       text not null,
  drive_id     text,
  url          text,
  version      text,
  vence        date,
  notas        text,
  detalle      text,
  subido_por   uuid references public.empleados(id) on delete set null
);
select app.estandarizar('public.documentos_tecnicos');
create index documentos_tecnicos_producto_idx on public.documentos_tecnicos (producto_id);
create index documentos_tecnicos_vence_idx    on public.documentos_tecnicos (vence) where vence is not null;

-- Notas internas de productos y clientes (Clientes Notas Internas, notas de Artículos a importar)
create table public.notas_internas (
  id          uuid primary key default gen_random_uuid(),
  entidad     text not null check (entidad in ('producto', 'cliente')),
  entidad_id  uuid not null,
  nota        text not null,
  fecha       timestamptz not null default now(),
  autor_id    uuid references public.empleados(id) on delete set null
);
select app.estandarizar('public.notas_internas');
create index notas_internas_entidad_idx on public.notas_internas (entidad, entidad_id, fecha desc);

-- Logos de universidades y hospitales para la web pública
create table public.aliados (
  id         uuid primary key default gen_random_uuid(),
  codigo     text unique,
  nombre     text not null,
  categoria  text,                 -- Universidad / Hospital
  logo_url   text,
  orden      integer,
  activo     boolean not null default true
);
select app.estandarizar('public.aliados');
