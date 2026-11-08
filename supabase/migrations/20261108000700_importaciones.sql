-- =====================================================================
-- VIMEDIC · Migración 007 · Importaciones
-- Reemplaza: Importaciones Expedientes, IMP Pedidos, IMP Items, IMP Unidades,
--            IMP Códigos Reservados, IMP Listas Pedido, IMP Recepción, IMP Órdenes ST.
-- El código de importación (PI-…) une todas estas tablas.
-- =====================================================================

-- Expediente de cada importación: compra, aprobación, pagos, embarque, aduana, costeo
create table public.imp_expedientes (
  id             uuid primary key default gen_random_uuid(),
  codigo         text not null unique,          -- PI-…
  nombre         text,
  proveedor_id   uuid references public.proveedores(id) on delete set null,
  proveedor_texto text,
  referencia     text,
  incoterm       text check (incoterm in ('EXW', 'FCA', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DDP')),
  pais_origen    text,
  estado         text,                          -- Por aprobar, En producción, Embarcada, En aduana…
  origen         text,
  fecha_ingreso  date,
  total_fob      numeric(14,2),
  compra         jsonb not null default '{}'::jsonb,
  aprobacion     jsonb not null default '{}'::jsonb,
  pagos          jsonb not null default '[]'::jsonb,
  embarque       jsonb not null default '{}'::jsonb,
  aduana         jsonb not null default '{}'::jsonb,
  gastos         jsonb not null default '[]'::jsonb,
  costeo         jsonb not null default '{}'::jsonb,
  recepcion      jsonb not null default '{}'::jsonb,
  eventos        jsonb not null default '[]'::jsonb,
  flujo          jsonb not null default '{}'::jsonb
);
select app.estandarizar('public.imp_expedientes');

-- Pedido tal como lo registra el proveedor en el portal (vimedic.com.ec/proveedores)
create table public.imp_pedidos (
  id                    uuid primary key default gen_random_uuid(),
  codigo                text not null unique,
  expediente_id         uuid references public.imp_expedientes(id) on delete set null,
  portal_id             text,
  proveedor_texto       text,
  proveedor_email       text,
  pais                  text,
  referencia            text,
  estado_portal         text,
  eta_portal            date,
  notas                 text,
  embarque              jsonb not null default '{}'::jsonb,
  documentos            jsonb not null default '[]'::jsonb,
  unidades_total        integer,
  unidades_registradas  integer,
  progreso_pct          numeric(5,2),
  completo              boolean not null default false,
  historial             jsonb not null default '[]'::jsonb,
  creado_portal         timestamptz,
  actualizado_portal    timestamptz,
  sincronizado          timestamptz
);
select app.estandarizar('public.imp_pedidos');

-- Líneas (modelos) de cada importación
create table public.imp_items (
  id                  uuid primary key default gen_random_uuid(),
  codigo              text not null unique,         -- "ID Item"
  pedido_codigo       text not null,                -- "Código Pedido" (PI-…)
  expediente_id       uuid references public.imp_expedientes(id) on delete cascade,
  producto_id         uuid references public.productos(id) on delete set null,
  producto_padre_id   uuid references public.productos(id) on delete set null,
  modelo              text,
  descripcion         text,
  marca               text,
  categoria           text,
  cantidad            integer not null default 0,
  origen              text,
  tipo_linea          text,
  codigo_producto     text,                         -- código interno existente
  codigo_reservado    text,                         -- código nuevo reservado
  codigo_deseado      text,
  prefijo             text,
  nombre_snapshot     text,
  imagen_referencia   text,
  observaciones       text,
  docs                jsonb not null default '[]'::jsonb,
  accesorios          jsonb not null default '[]'::jsonb,
  sincronizado        timestamptz
);
select app.estandarizar('public.imp_items');
create index imp_items_pedido_idx   on public.imp_items (pedido_codigo);
create index imp_items_producto_idx on public.imp_items (producto_id);

-- Cada unidad física (serie / lote) recibida
create table public.imp_unidades (
  id                   uuid primary key default gen_random_uuid(),
  codigo               text not null unique,        -- "ID Unidad"
  pedido_codigo        text not null,
  item_id              uuid references public.imp_items(id) on delete cascade,
  producto_id          uuid references public.productos(id) on delete set null,
  modelo               text,
  descripcion          text,
  marca                text,
  lote                 text,
  serie                text,
  fabricacion          text,
  verificacion_portal  text,
  observacion_portal   text,
  estado               text,
  archivos             jsonb not null default '[]'::jsonb,
  revision_bodega      jsonb not null default '{}'::jsonb,
  revision_st          jsonb not null default '{}'::jsonb,
  historial            jsonb not null default '[]'::jsonb,
  sincronizado         timestamptz
);
select app.estandarizar('public.imp_unidades');
create index imp_unidades_item_idx  on public.imp_unidades (item_id);
create index imp_unidades_serie_idx on public.imp_unidades (serie);

create table public.imp_codigos_reservados (
  id             uuid primary key default gen_random_uuid(),
  codigo         text not null unique,
  prefijo        text,
  pedido_codigo  text,
  item_id        uuid references public.imp_items(id) on delete set null,
  fecha          timestamptz not null default now(),
  reservado_por  text,
  estado         text not null default 'Reservado'
);
select app.estandarizar('public.imp_codigos_reservados');

-- Listas de artículos sugeridos para pedir a un proveedor
create table public.imp_listas_pedido (
  id               uuid primary key default gen_random_uuid(),
  codigo           text unique,
  fecha            timestamptz not null default now(),
  proveedor_id     uuid references public.proveedores(id) on delete set null,
  proveedor_texto  text,
  estado           text not null default 'Borrador'
                   check (estado in ('Borrador', 'Enviada al proveedor', 'Convertida en importación', 'Anulada')),
  items            jsonb not null default '[]'::jsonb,
  total_unidades   integer,
  total_estimado   numeric(14,2),
  notas            text,
  parametros       jsonb not null default '{}'::jsonb,
  actualizado_por  uuid references public.empleados(id) on delete set null
);
select app.estandarizar('public.imp_listas_pedido');

-- Operaciones de recepción en bodega (ingreso, envío a ST, devolución…)
create table public.imp_recepciones (
  id             uuid primary key default gen_random_uuid(),
  codigo         text unique,                     -- "ID Operación"
  fecha          timestamptz not null default now(),
  pedido_codigo  text,
  item_id        uuid references public.imp_items(id) on delete set null,
  producto       text,
  tipo           text,
  cantidades     jsonb not null default '{}'::jsonb,
  orden_st_codigo text,
  origen         text,
  destino        text,
  responsable    text,
  observacion    text,
  series         jsonb not null default '[]'::jsonb,
  movimientos    jsonb not null default '[]'::jsonb
);
select app.estandarizar('public.imp_recepciones');
create index imp_recepciones_pedido_idx on public.imp_recepciones (pedido_codigo);

-- Órdenes de servicio técnico para unidades que llegaron con defectos
create table public.imp_ordenes_st (
  id                uuid primary key default gen_random_uuid(),
  codigo            text unique,                  -- "ID Orden"
  fecha             timestamptz not null default now(),
  pedido_codigo     text,
  item_id           uuid references public.imp_items(id) on delete set null,
  producto          text,
  modelo            text,
  cantidad          integer,
  defecto           text,
  operacion_origen  text,
  orden_anterior    text,
  estado            text,
  tecnico           text,
  diagnostico       text,
  trabajo           text,
  reparadas         integer,
  no_reparables     integer,
  fecha_devolucion  timestamptz,
  cerrada_por       text,
  repuestos         text,
  pruebas           text,
  recomendaciones   text,
  informe_url       text,
  series            jsonb not null default '[]'::jsonb,
  historial         jsonb not null default '[]'::jsonb,
  evidencias        jsonb not null default '[]'::jsonb,
  evidencias_st     jsonb not null default '[]'::jsonb,
  adjunto           jsonb
);
select app.estandarizar('public.imp_ordenes_st');
create index imp_ordenes_st_pedido_idx on public.imp_ordenes_st (pedido_codigo);
