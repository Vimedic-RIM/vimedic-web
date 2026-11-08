-- =====================================================================
-- VIMEDIC · Migración 004 · Facturación, ingresos y movimientos de inventario
-- Reemplaza: Facturacion, OPERACIONES (hoja anterior), Ingresos, Movimientos,
--            NotasCredito, RecepcionesNC, DetalleNotasCredito.
-- La factura electrónica se sigue emitiendo en Contífico; aquí se registra su número.
-- =====================================================================

create table public.facturas (
  id                     uuid primary key default gen_random_uuid(),
  codigo                 text unique,               -- "ID Facturacion" (= ID de la operación)
  empresa                text not null default 'VIMEDIC' check (empresa = any (app.empresas_validas())),
  cliente_id             uuid references public.clientes(id) on delete set null,
  identificacion         text,
  cotizacion_id          uuid references public.cotizaciones(id) on delete set null,
  asesor_id              uuid references public.empleados(id) on delete set null,
  facturado_por          uuid references public.empleados(id) on delete set null,
  numero_contifico       text,                      -- "Número Factura Contifico"
  estado                 text not null default 'Facturado',
  fecha_ganado           date,
  fecha_facturacion      date,
  medio_captacion_venta  text,
  observacion            text,
  datos_completos        boolean not null default false,
  -- Documentos
  pdf_url                text,
  acta_garantia_url      text,
  acta_conformidad_url   text,
  guia_envio_url         text,
  guia_datos             jsonb not null default '{}'::jsonb,
  acta_datos             jsonb not null default '{}'::jsonb,
  -- Detalle y totales
  items                  jsonb not null default '[]'::jsonb,  -- "Productos JSON"
  items_original         jsonb,                               -- antes de notas de crédito
  pago_entrega           jsonb not null default '{}'::jsonb,
  subtotal               numeric(12,2),
  iva                    numeric(12,2),
  total                  numeric(12,2),
  total_notas_credito    numeric(12,2) not null default 0,
  total_neto             numeric(12,2),
  historial              jsonb not null default '[]'::jsonb   -- "Historial Modificaciones"
);
select app.estandarizar('public.facturas');
create index facturas_cliente_idx      on public.facturas (cliente_id);
create index facturas_identif_idx      on public.facturas (identificacion);
create index facturas_asesor_fecha_idx on public.facturas (asesor_id, fecha_facturacion desc);
create index facturas_fecha_idx        on public.facturas (fecha_facturacion desc);
create index facturas_numero_idx       on public.facturas (numero_contifico);

create trigger tg_normalizar_identificacion
before insert or update of identificacion on public.facturas
for each row execute function app.tg_normalizar_identificacion();

-- Compras / ingresos de mercadería de proveedores locales
create table public.ingresos_proveedor (
  id                uuid primary key default gen_random_uuid(),
  codigo            text unique,                     -- "ID Operacion"
  proveedor_id      uuid references public.proveedores(id) on delete set null,
  proveedor_texto   text,
  numero_factura    text,
  fecha_factura     date,
  responsable_id    uuid references public.empleados(id) on delete set null,
  observacion       text,
  items             jsonb not null default '[]'::jsonb,
  subtotal          numeric(12,2),
  descuento         numeric(12,2),
  iva               numeric(12,2),
  total             numeric(12,2),
  solicitud_hash    text
);
select app.estandarizar('public.ingresos_proveedor');
create index ingresos_proveedor_fecha_idx on public.ingresos_proveedor (fecha_factura desc);

create table public.notas_credito (
  id           uuid primary key default gen_random_uuid(),
  codigo       text unique,
  tipo         text not null default 'nota_credito' check (tipo in ('nota_credito', 'recepcion')),
  solicitud    text,
  factura_id   uuid references public.facturas(id) on delete set null,
  numero       text,
  fecha        timestamptz not null default now(),
  usuario_id   uuid references public.empleados(id) on delete set null,
  estado       text,
  registrado   boolean not null default false,
  datos        jsonb not null default '{}'::jsonb
);
select app.estandarizar('public.notas_credito');
create index notas_credito_factura_idx on public.notas_credito (factura_id);

-- Cada línea de entrada o salida de inventario (ventas, compras, devoluciones, NC)
create table public.movimientos_inventario (
  id                       uuid primary key default gen_random_uuid(),
  codigo                   text unique,             -- "ID Movimiento"
  tipo                     text not null check (tipo in ('INGRESO', 'SALIDA', 'AJUSTE', 'DEVOLUCION')),
  operacion_codigo         text,                    -- "Id Operacion" original
  factura_id               uuid references public.facturas(id) on delete set null,
  ingreso_id               uuid references public.ingresos_proveedor(id) on delete set null,
  producto_id              uuid references public.productos(id) on delete restrict,
  producto_codigo          text,                    -- "Item Id" (copia para trazabilidad)
  nombre                   text,
  cliente_texto            text,
  factura_texto            text,
  cantidad                 numeric(12,2) not null,
  precio                   numeric(12,4),
  descuento                numeric(12,2),
  aplica_iva               boolean,
  responsable_id           uuid references public.empleados(id) on delete set null,
  responsable_texto        text,
  fecha                    timestamptz not null default now(),
  bodega                   text,
  observacion              text,
  factura_url              text,
  evidencia_url            text,
  imagen_url               text,
  -- Notas de crédito
  nota_credito_id          uuid references public.notas_credito(id) on delete set null,
  movimiento_original_id   uuid references public.movimientos_inventario(id) on delete set null,
  recepcion_nc_id          uuid references public.notas_credito(id) on delete set null,
  cantidad_acreditada_nc   numeric(12,2),
  base_acreditada_nc       numeric(12,2),
  iva_acreditado_nc        numeric(12,2),
  cantidad_vigente_nc      numeric(12,2),
  estado_nc                text,
  disponible               boolean
);
select app.estandarizar('public.movimientos_inventario');
create index movimientos_producto_fecha_idx on public.movimientos_inventario (producto_id, fecha desc);
create index movimientos_factura_idx        on public.movimientos_inventario (factura_id);
create index movimientos_ingreso_idx        on public.movimientos_inventario (ingreso_id);
create index movimientos_operacion_idx      on public.movimientos_inventario (operacion_codigo);
create index movimientos_fecha_idx          on public.movimientos_inventario (fecha desc);

create table public.nota_credito_detalle (
  id                       uuid primary key default gen_random_uuid(),
  codigo                   text unique,
  nota_credito_id          uuid not null references public.notas_credito(id) on delete cascade,
  factura_id               uuid references public.facturas(id) on delete set null,
  movimiento_original_id   uuid references public.movimientos_inventario(id) on delete set null,
  producto_id              uuid references public.productos(id) on delete set null,
  producto_texto           text,
  tipo                     text,
  cantidad                 numeric(12,2) not null,
  base                     numeric(12,2),
  iva                      numeric(12,2),
  total                    numeric(12,2)
);
select app.estandarizar('public.nota_credito_detalle');
create index nota_credito_detalle_nc_idx on public.nota_credito_detalle (nota_credito_id);
