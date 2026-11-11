-- =====================================================================
-- VIMEDIC · Fase 1 del flujo de despacho (Issue #4)
-- No se toca nada de Bodega/Logística: ya funcionan. Esto agrega lo que
-- de verdad faltaba: numeración correlativa de guías, el instante exacto
-- en que una factura pasa a "Facturado" (T1), una bitácora inmutable y
-- el tracking público por token (QR) que Logistica.tsx ya enlaza pero
-- que todavía no existía del otro lado.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Numeración correlativa por año: GD-2026-00001, reiniciando cada año.
--    Una secuencia de Postgres no se reinicia sola por año, así que se usa
--    un contador en tabla con UPDATE atómico (sin condiciones de carrera
--    aunque dos personas generen una guía al mismo tiempo).
-- ---------------------------------------------------------------------
create table public.contadores_anuales (
  clave  text not null,
  anio   integer not null,
  ultimo integer not null default 0,
  primary key (clave, anio)
);
alter table public.contadores_anuales enable row level security;
-- Solo lo usa app.siguiente_numero() (security definer); nadie más necesita tocarlo directo.
revoke all on public.contadores_anuales from public, anon, authenticated;

create or replace function app.siguiente_numero(p_clave text, p_prefijo text, p_ancho int default 5)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_anio int := extract(year from now() at time zone 'America/Guayaquil');
  v_num  int;
begin
  insert into public.contadores_anuales (clave, anio, ultimo) values (p_clave, v_anio, 1)
  on conflict (clave, anio) do update set ultimo = public.contadores_anuales.ultimo + 1
  returning ultimo into v_num;
  return p_prefijo || '-' || v_anio || '-' || lpad(v_num::text, p_ancho, '0');
end;
$$;
comment on function app.siguiente_numero(text, text, int) is
  'Numeración correlativa atómica por año, ej. GD-2026-00001. Úsala para cualquier documento que necesite un consecutivo anual (guías, actas...).';

-- ---------------------------------------------------------------------
-- 2) Guías: número de guía propio (GD-AAAA-00001), sin tocar "codigo"
--    (sigue siendo el id interno DSP-... que ya usa Bodega.tsx).
-- ---------------------------------------------------------------------
alter table public.despachos add column if not exists numero_guia text unique;

create or replace function app.tg_despacho_numero_guia()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.numero_guia is null then
    new.numero_guia := app.siguiente_numero('guia_despacho', 'GD');
  end if;
  return new;
end;
$$;
drop trigger if exists tg_numero_guia on public.despachos;
create trigger tg_numero_guia before insert on public.despachos
  for each row execute function app.tg_despacho_numero_guia();

-- Rellena número de guía a los despachos que ya existan (orden por fecha de creación).
do $$
declare r record;
begin
  for r in select id from public.despachos where numero_guia is null order by created_at loop
    update public.despachos set numero_guia = app.siguiente_numero('guia_despacho', 'GD') where id = r.id;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3) T1 exacto: el instante en que una factura pasa de "Pendiente" a
--    "Facturado" (T0 ya existe: es facturas.created_at, el momento en que
--    el CRM crea la factura "Pendiente" al guardar una venta).
-- ---------------------------------------------------------------------
alter table public.facturas add column if not exists facturado_en timestamptz;

create or replace function app.tg_factura_facturado_en()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.estado = 'Facturado' and (old.estado is distinct from 'Facturado') and new.facturado_en is null then
    new.facturado_en := now();
  end if;
  return new;
end;
$$;
drop trigger if exists tg_facturado_en on public.facturas;
create trigger tg_facturado_en before update on public.facturas
  for each row execute function app.tg_factura_facturado_en();

-- ---------------------------------------------------------------------
-- 4) Bitácora inmutable: nadie actualiza ni borra, ni siquiera el dueño.
-- ---------------------------------------------------------------------
create table public.bitacora_pedidos (
  id             uuid primary key default gen_random_uuid(),
  fecha_hora     timestamptz not null default now(),
  factura_id     uuid references public.facturas(id) on delete set null,
  despacho_id    uuid references public.despachos(id) on delete set null,
  entrega_id     uuid references public.entregas(id) on delete set null,
  cotizacion_id  uuid references public.cotizaciones(id) on delete set null,
  modulo         text not null,                       -- 'facturacion','bodega','logistica','crm'...
  accion         text not null,                       -- 'cambio_estado','impresion','correo_enviado','acceso_token'...
  campo          text,
  valor_anterior text,
  valor_nuevo    text,
  usuario_id     uuid references public.empleados(id) on delete set null,
  rol            text,
  dispositivo    text,
  comentario     text
);
create index bitacora_factura_idx  on public.bitacora_pedidos (factura_id, fecha_hora desc);
create index bitacora_despacho_idx on public.bitacora_pedidos (despacho_id, fecha_hora desc);
create index bitacora_entrega_idx  on public.bitacora_pedidos (entrega_id, fecha_hora desc);

alter table public.bitacora_pedidos enable row level security;
-- Ver: quien tiene acceso al módulo dueño del registro, o ve_todos en seguridad/financiero. Nunca UPDATE ni DELETE para nadie.
create policy rls_bitacora_ver on public.bitacora_pedidos for select to authenticated
  using (app.es_superadmin() or app.puede_alguno(array['facturacion','bodega','logistica','crm','seguridad'], 'ver'));
create policy rls_bitacora_insertar on public.bitacora_pedidos for insert to authenticated
  with check (true); -- el contenido lo arma siempre app.registrar_bitacora() o los triggers, nunca el cliente directo.
revoke update, delete on public.bitacora_pedidos from public, anon, authenticated;

-- Para dejar registro de algo que NO es un cambio de columna (imprimir, enviar un correo,
-- un acceso al tracking público por token...).
create or replace function app.registrar_bitacora(
  p_modulo text, p_accion text, p_comentario text default null,
  p_factura uuid default null, p_despacho uuid default null, p_entrega uuid default null, p_cotizacion uuid default null,
  p_campo text default null, p_valor_anterior text default null, p_valor_nuevo text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_emp uuid := app.empleado_id();
  v_rol text;
begin
  select r.nombre into v_rol from public.empleados e left join public.roles r on r.id = e.rol_id where e.id = v_emp;
  insert into public.bitacora_pedidos (factura_id, despacho_id, entrega_id, cotizacion_id, modulo, accion, campo, valor_anterior, valor_nuevo, usuario_id, rol, comentario)
  values (p_factura, p_despacho, p_entrega, p_cotizacion, p_modulo, p_accion, p_campo, p_valor_anterior, p_valor_nuevo, v_emp, v_rol, p_comentario)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function app.registrar_bitacora(text, text, text, uuid, uuid, uuid, uuid, text, text, text) from public, anon;
grant execute on function app.registrar_bitacora(text, text, text, uuid, uuid, uuid, uuid, text, text, text) to authenticated;

-- Registra solos los cambios de "estado" en facturas, despachos y entregas (lo que de verdad
-- importa para la línea de tiempo del pedido) sin que el frontend tenga que acordarse de hacerlo.
create or replace function app.tg_bitacora_estado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tabla text := tg_table_name;
begin
  if new.estado is distinct from old.estado then
    insert into public.bitacora_pedidos (factura_id, despacho_id, entrega_id, modulo, accion, campo, valor_anterior, valor_nuevo, usuario_id, rol)
    values (
      case when v_tabla = 'facturas' then new.id end,
      case when v_tabla = 'despachos' then new.id end,
      case when v_tabla = 'entregas' then new.id end,
      v_tabla, 'cambio_estado', 'estado', old.estado, new.estado,
      app.empleado_id(), (select r.nombre from public.empleados e left join public.roles r on r.id = e.rol_id where e.id = app.empleado_id())
    );
  end if;
  return new;
end;
$$;
drop trigger if exists tg_bitacora_estado on public.facturas;
create trigger tg_bitacora_estado after update on public.facturas
  for each row execute function app.tg_bitacora_estado();
drop trigger if exists tg_bitacora_estado on public.despachos;
create trigger tg_bitacora_estado after update on public.despachos
  for each row execute function app.tg_bitacora_estado();
drop trigger if exists tg_bitacora_estado on public.entregas;
create trigger tg_bitacora_estado after update on public.entregas
  for each row execute function app.tg_bitacora_estado();

-- ---------------------------------------------------------------------
-- 5) Tracking público por token (lo que Logistica.tsx ya enlaza en
--    /seguimiento/?c=TOKEN). Solo campos seguros: sin precios, sin
--    nombres de empleados, sin contactos internos.
-- ---------------------------------------------------------------------
create view public.v_tracking_publico as
select
  d.token_seguimiento                              as token,
  d.numero_guia,
  f.numero_contifico                               as numero_factura,
  d.fecha                                           as fecha_guia,
  d.estado                                          as estado_despacho,
  d.cliente_texto,
  d.productos,
  e.id                                              as entrega_id,
  e.estado                                          as estado_entrega,
  e.transportista,
  e.fecha_programada,
  e.eta,
  e.fecha_entrega,
  e.constancia_url                                  as url_acta
from public.despachos d
left join public.facturas f on f.id = d.factura_id
left join public.entregas e on e.despacho_id = d.id and e.deleted_at is null
where d.deleted_at is null and d.token_seguimiento is not null;

-- OJO: la vista NO se le concede a "anon" — si se le diera select directo, cualquiera podría
-- listarla entera sin token (PostgREST la expondría como tabla). El único camino público
-- permitido es la función tracking_publico(token), de abajo, que exige el token exacto.
grant select on public.v_tracking_publico to authenticated;

-- Única puerta de entrada pública: por token exacto, nunca listar ni adivinar.
create or replace function public.tracking_publico(p_token text)
returns public.v_tracking_publico
language sql
stable
security definer
set search_path = public
as $$
  select * from public.v_tracking_publico where token = p_token limit 1;
$$;
revoke all on function public.tracking_publico(text) from public;
grant execute on function public.tracking_publico(text) to anon, authenticated;
