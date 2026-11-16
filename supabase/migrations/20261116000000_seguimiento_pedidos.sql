-- =====================================================================
-- Seguimiento de pedidos (Trackings) · Fase 1 — Issue #38
-- Proceso NUEVO: solo para las ventas que se envían a Facturación desde ahora.
--   Venta confirmada → Enviada a facturar → Facturada → En preparación → Lista para despacho →
--   Despachada → En camino → Entregada → Instalación / capacitación (si Logística la marca).
-- Las etapas avanzan solas con lo que cada área ya hace (facturar, preparar, despachar, entregar,
-- cerrar la orden de instalación): estos disparadores solo ESCUCHAN; nunca bloquean a Facturación,
-- Bodega, Logística ni Servicio Técnico (si algo falla aquí, se registra un aviso y se sigue).
-- Un solo código por pedido: el despacho de Bodega toma el código del pedido, así el QR de la guía,
-- el enlace del CRM, la encuesta y Logística apuntan al mismo pedido.
-- =====================================================================

-- 1) Tablas -------------------------------------------------------------
create table public.pedidos_seguimiento (
  id                    uuid primary key default gen_random_uuid(),
  codigo                text unique,
  token                 text not null unique,
  empresa               text not null default 'VIMEDIC' check (empresa = any (app.empresas_validas())),
  cotizacion_id         uuid unique references public.cotizaciones(id) on delete set null,
  factura_id            uuid references public.facturas(id) on delete set null,
  despacho_id           uuid references public.despachos(id) on delete set null,
  asesor_id             uuid references public.empleados(id) on delete set null,
  cliente_id            uuid references public.clientes(id) on delete set null,
  cliente_texto         text,
  zona                  text not null default 'local' check (zona in ('local', 'provincia')),
  requiere_instalacion  boolean not null default false,
  etapa                 text not null default 'venta',
  etapa_desde           timestamptz not null default now(),
  estado                text not null default 'En curso' check (estado in ('En curso', 'Completado', 'Cancelado')),
  fecha_estimada        date,
  completado_en         timestamptz
);
select app.estandarizar('public.pedidos_seguimiento');
create index pedidos_seguimiento_estado_idx on public.pedidos_seguimiento (estado, etapa);
create index pedidos_seguimiento_factura_idx on public.pedidos_seguimiento (factura_id);
create index pedidos_seguimiento_despacho_idx on public.pedidos_seguimiento (despacho_id);
create index pedidos_seguimiento_asesor_idx on public.pedidos_seguimiento (asesor_id);

-- Bitácora del pedido: solo se agregan filas (avances, errores, notas, escaneos).
create table public.pedidos_eventos (
  id          uuid primary key default gen_random_uuid(),
  pedido_id   uuid not null references public.pedidos_seguimiento(id) on delete cascade,
  fecha       timestamptz not null default now(),
  etapa       text,
  tipo        text not null check (tipo in ('avance', 'error', 'resuelto', 'nota', 'escaneo')),
  titulo      text not null,
  detalle     text,
  publico     boolean not null default false,
  usuario_id  uuid references public.empleados(id) on delete set null,
  area        text,
  dispositivo text,
  lat         numeric(10, 6),
  lng         numeric(10, 6),
  fotos       jsonb not null default '[]'::jsonb,
  datos       jsonb not null default '{}'::jsonb
);
select app.estandarizar('public.pedidos_eventos');
create index pedidos_eventos_pedido_idx on public.pedidos_eventos (pedido_id, fecha);
create index pedidos_eventos_tipo_idx on public.pedidos_eventos (tipo, fecha desc);

create table public.tracking_configuracion (
  id     uuid primary key default gen_random_uuid(),
  clave  text not null unique,
  valor  jsonb not null default '{}'::jsonb
);
select app.estandarizar('public.tracking_configuracion');
select app.aplicar_rls('public.tracking_configuracion', array['tracking'], array['tracking']);

-- 2) Etapas, nombres y tiempos objetivo ------------------------------------
create or replace function app.trk_etapas() returns text[] language sql immutable as $$
  select array['venta', 'facturar', 'facturada', 'preparacion', 'lista', 'despachada', 'en_ruta', 'entregada', 'instalacion'];
$$;
create or replace function app.trk_orden(p text) returns int language sql immutable as $$
  select coalesce(array_position(app.trk_etapas(), p), 0);
$$;
create or replace function app.trk_nombre(p text) returns text language sql immutable as $$
  select case p when 'venta' then 'Venta confirmada' when 'facturar' then 'Enviada a facturar' when 'facturada' then 'Facturada'
    when 'preparacion' then 'En preparación' when 'lista' then 'Lista para despacho' when 'despachada' then 'Despachada'
    when 'en_ruta' then 'En camino' when 'entregada' then 'Entregada' when 'instalacion' then 'Instalación / capacitación' else p end;
$$;
/** Área que mueve cada etapa (para el escáner y el mapa de proceso). */
create or replace function app.trk_area(p text) returns text language sql immutable as $$
  select case p when 'venta' then 'CRM' when 'facturar' then 'Facturación' when 'facturada' then 'Bodega' when 'preparacion' then 'Bodega'
    when 'lista' then 'Bodega' when 'despachada' then 'Logística' when 'en_ruta' then 'Logística' when 'entregada' then 'Servicio Técnico'
    when 'instalacion' then 'Servicio Técnico' else '' end;
$$;

-- Días hábiles que se puede quedar un pedido en cada etapa antes de pasar a la siguiente.
-- en_ruta tiene dos valores: local (Quito, entrega en el local o retiro) y provincia (envío por transporte).
create or replace function app.trk_config() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
      'habiles', true, 'feriados', '[]'::jsonb,
      'objetivos', jsonb_build_object('venta', 0, 'facturar', 1, 'facturada', 1, 'preparacion', 2, 'lista', 1, 'despachada', 1, 'instalacion', 3),
      'en_ruta', jsonb_build_object('local', 1, 'provincia', 4))
    || coalesce((select valor from public.tracking_configuracion where clave = 'tiempos' and deleted_at is null), '{}'::jsonb);
$$;

create or replace function app.trk_objetivo(p_etapa text, p_zona text, c jsonb) returns numeric language sql immutable as $$
  select case when p_etapa = 'en_ruta' then coalesce((c -> 'en_ruta' ->> p_zona)::numeric, 1)
              else coalesce((c -> 'objetivos' ->> p_etapa)::numeric, 1) end;
$$;

create or replace function app.trk_hoy() returns date language sql stable as $$
  select (now() at time zone 'America/Guayaquil')::date;
$$;

/** Días transcurridos entre dos momentos (hábiles: lunes a viernes sin feriados), con fracción del día en curso. */
create or replace function app.trk_dias(p_desde timestamptz, p_hasta timestamptz, c jsonb) returns numeric
language plpgsql stable as $$
declare d1 timestamp := p_desde at time zone 'America/Guayaquil'; d2 timestamp := p_hasta at time zone 'America/Guayaquil'; n numeric := 0; d date;
begin
  if p_desde is null or p_hasta is null or p_hasta <= p_desde then return 0; end if;
  if not coalesce((c ->> 'habiles')::boolean, true) then return round(extract(epoch from p_hasta - p_desde) / 86400, 2); end if;
  -- Días completos hábiles entre las dos fechas + la fracción del primer y del último día si son hábiles.
  for d in select generate_series(d1::date, least(d2::date, d1::date + 400), interval '1 day')::date loop
    if extract(isodow from d) < 6 and not coalesce(c -> 'feriados', '[]'::jsonb) ? to_char(d, 'YYYY-MM-DD') then
      n := n + extract(epoch from least(d2, (d + 1)::timestamp) - greatest(d1, d::timestamp)) / 86400;
    end if;
  end loop;
  return round(greatest(n, 0), 2);
end $$;

/** Suma n días hábiles a una fecha. */
create or replace function app.trk_sumar(p_fecha date, p_n numeric, c jsonb) returns date language plpgsql stable as $$
declare d date := p_fecha; k int := ceil(coalesce(p_n, 0));
begin
  if not coalesce((c ->> 'habiles')::boolean, true) then return p_fecha + k; end if;
  while k > 0 loop
    d := d + 1;
    if extract(isodow from d) < 6 and not coalesce(c -> 'feriados', '[]'::jsonb) ? to_char(d, 'YYYY-MM-DD') then k := k - 1; end if;
  end loop;
  return d;
end $$;

/** Fecha estimada de entrega (o de instalación): inicio de la etapa actual + lo que falta según los objetivos. */
create or replace function app.trk_estimada(p public.pedidos_seguimiento) returns date language plpgsql stable security definer set search_path = public as $$
declare c jsonb := app.trk_config(); e text; suma numeric := 0; ult text;
begin
  ult := case when p.requiere_instalacion then 'instalacion' else 'entregada' end;
  if app.trk_orden(p.etapa) >= app.trk_orden(ult) and p.estado <> 'En curso' then return null; end if;
  foreach e in array app.trk_etapas() loop
    if app.trk_orden(e) >= app.trk_orden(p.etapa) and app.trk_orden(e) < app.trk_orden(ult) then suma := suma + app.trk_objetivo(e, p.zona, c); end if;
  end loop;
  if p.etapa = 'instalacion' then suma := app.trk_objetivo('instalacion', p.zona, c); end if;
  return app.trk_sumar((p.etapa_desde at time zone 'America/Guayaquil')::date, suma, c);
end $$;

-- 3) Avanzar y registrar ------------------------------------------------------
create or replace function app.trk_evento(p_pedido uuid, p_tipo text, p_titulo text, p_detalle text default null, p_publico boolean default false,
  p_datos jsonb default '{}'::jsonb, p_etapa text default null, p_fecha timestamptz default now()) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.pedidos_eventos (pedido_id, fecha, etapa, tipo, titulo, detalle, publico, usuario_id, area, dispositivo, lat, lng, fotos, datos)
  values (p_pedido, coalesce(p_fecha, now()), coalesce(p_etapa, (select etapa from public.pedidos_seguimiento where id = p_pedido)), p_tipo, left(p_titulo, 200), left(p_detalle, 2000),
    p_publico, app.empleado_id(), nullif(p_datos ->> 'area', ''), nullif(p_datos ->> 'dispositivo', ''),
    nullif(p_datos ->> 'lat', '')::numeric, nullif(p_datos ->> 'lng', '')::numeric, coalesce(p_datos -> 'fotos', '[]'::jsonb), coalesce(p_datos - 'fotos', '{}'::jsonb));
end $$;

/** Mueve el pedido a una etapa posterior (nunca hacia atrás). Al entregar avisa al asesor de la venta. */
create or replace function app.trk_avanzar(p_pedido uuid, p_etapa text, p_detalle text default null, p_datos jsonb default '{}'::jsonb, p_fecha timestamptz default now())
returns void language plpgsql security definer set search_path = public as $$
declare p public.pedidos_seguimiento; v_fecha timestamptz := coalesce(p_fecha, now());
begin
  select * into p from public.pedidos_seguimiento where id = p_pedido and deleted_at is null for update;
  if p.id is null or p.estado = 'Cancelado' then return; end if;
  if app.trk_orden(p_etapa) <= app.trk_orden(p.etapa) then return; end if;
  perform app.trk_evento(p.id, 'avance', app.trk_nombre(p_etapa), p_detalle, true, p_datos, p_etapa, v_fecha);
  update public.pedidos_seguimiento set etapa = p_etapa, etapa_desde = v_fecha where id = p.id returning * into p;

  if p_etapa = 'entregada' then
    -- Aviso al asesor de la venta (una sola vez).
    if p.asesor_id is not null then
      insert into public.notificaciones (para_id, modulo, evento, tipo, texto, entidad, entidad_id)
      values (p.asesor_id, 'crm', 'pedido_entregado', 'aviso',
        'Pedido entregado — ' || coalesce(p.codigo, '') || ' · ' || coalesce(p.cliente_texto, '') ||
        coalesce(' · factura ' || (select numero_contifico from public.facturas where id = p.factura_id), ''), 'pedidos_seguimiento', p.id);
    end if;
    if p.requiere_instalacion then
      perform app.trk_evento(p.id, 'avance', app.trk_nombre('instalacion'), 'Pendiente de instalación o capacitación.', true, '{}'::jsonb, 'instalacion', v_fecha);
      update public.pedidos_seguimiento set etapa = 'instalacion', etapa_desde = v_fecha where id = p.id returning * into p;
    else
      update public.pedidos_seguimiento set estado = 'Completado', completado_en = v_fecha where id = p.id returning * into p;
    end if;
  end if;
  update public.pedidos_seguimiento set fecha_estimada = app.trk_estimada(p) where id = p.id;
end $$;

create or replace function app.trk_completar(p_pedido uuid, p_detalle text, p_datos jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare p public.pedidos_seguimiento;
begin
  select * into p from public.pedidos_seguimiento where id = p_pedido and deleted_at is null for update;
  if p.id is null or p.estado <> 'En curso' or p.etapa <> 'instalacion' then return; end if;
  perform app.trk_evento(p.id, 'avance', 'Instalación / capacitación realizada', p_detalle, true, p_datos, 'instalacion');
  update public.pedidos_seguimiento set estado = 'Completado', completado_en = now(), fecha_estimada = null where id = p.id;
end $$;

/** Pedido de una factura (si se creó con el proceso nuevo). */
create or replace function app.trk_de_factura(p_factura uuid) returns uuid language sql stable security definer set search_path = public as $$
  select id from public.pedidos_seguimiento where factura_id = p_factura and deleted_at is null limit 1;
$$;
create or replace function app.trk_de_despacho(p_despacho uuid) returns uuid language sql stable security definer set search_path = public as $$
  select id from public.pedidos_seguimiento where despacho_id = p_despacho and deleted_at is null limit 1;
$$;

-- 4) Disparadores: escuchan lo que ya hace cada área -----------------------------
-- 4a) Facturación: la venta llega (crea el pedido) y se factura.
create or replace function app.tg_trk_factura() returns trigger language plpgsql security definer set search_path = public as $$
declare v_id uuid; q public.cotizaciones; v_cod text;
begin
  begin
    v_id := app.trk_de_factura(new.id);
    if v_id is null and tg_op = 'INSERT' and new.cotizacion_id is not null
       and not exists (select 1 from public.pedidos_seguimiento where cotizacion_id = new.cotizacion_id) then
      select * into q from public.cotizaciones where id = new.cotizacion_id;
      v_cod := app.siguiente_numero('seguimiento', 'TRK', 5);
      insert into public.pedidos_seguimiento (codigo, token, empresa, cotizacion_id, factura_id, asesor_id, cliente_id, cliente_texto, etapa, etapa_desde, creado_por)
      values (v_cod, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), new.empresa, new.cotizacion_id, new.id,
        coalesce(new.asesor_id, q.asesor_id), coalesce(new.cliente_id, q.cliente_id), coalesce(q.nombre, ''), 'venta', now(), app.empleado_id())
      returning id into v_id;
      perform app.trk_evento(v_id, 'avance', app.trk_nombre('venta'), 'Venta ' || coalesce(new.codigo, '') || ' confirmada.', true, '{"area":"CRM"}', 'venta');
      perform app.trk_avanzar(v_id, 'facturar', null, '{"area":"Facturación"}');
      -- Si la factura nació ya facturada, Bodega creó su despacho antes que el pedido: se enlazan aquí con un solo código.
      update public.despachos d set token_seguimiento = p.token from public.pedidos_seguimiento p
       where p.id = v_id and d.factura_id = new.id and d.deleted_at is null;
      update public.pedidos_seguimiento p set despacho_id = d.id, zona = case when coalesce(d.entrega ->> 'entrega', '') = 'Envío' then 'provincia' else 'local' end
        from public.despachos d where p.id = v_id and d.factura_id = new.id and d.deleted_at is null and p.despacho_id is null;
    end if;
    if v_id is not null and new.estado = 'Facturado' and (tg_op = 'INSERT' or old.estado is distinct from 'Facturado') then
      perform app.trk_avanzar(v_id, 'facturada', coalesce('Factura ' || new.numero_contifico, null), '{"area":"Facturación"}', coalesce(new.facturado_en, now()));
    end if;
  exception when others then raise warning 'Seguimiento (factura %): %', new.id, sqlerrm;
  end;
  return null;
end $$;
create trigger tg_trk_factura after insert or update of estado on public.facturas
  for each row execute function app.tg_trk_factura();

-- 4b) Bodega: el despacho toma el código del pedido (antes de guardarse) y sus estados mueven el pedido.
create or replace function app.tg_trk_despacho_token() returns trigger language plpgsql security definer set search_path = public as $$
declare v_token text;
begin
  begin
    select token into v_token from public.pedidos_seguimiento where factura_id = new.factura_id and deleted_at is null limit 1;
    if v_token is not null then new.token_seguimiento := v_token; end if;
  exception when others then raise warning 'Seguimiento (token despacho): %', sqlerrm;
  end;
  return new;
end $$;
create trigger tg_trk_despacho_token before insert on public.despachos
  for each row execute function app.tg_trk_despacho_token();

create or replace function app.tg_trk_despacho() returns trigger language plpgsql security definer set search_path = public as $$
declare v_id uuid; x jsonb; i int;
begin
  begin
    if tg_op = 'INSERT' then
      update public.pedidos_seguimiento set despacho_id = new.id, zona = case when coalesce(new.entrega ->> 'entrega', '') = 'Envío' then 'provincia' else 'local' end
       where factura_id = new.factura_id and deleted_at is null and despacho_id is null returning id into v_id;
    else
      v_id := app.trk_de_despacho(new.id);
    end if;
    if v_id is null then return null; end if;
    if tg_op = 'UPDATE' and new.estado is distinct from old.estado then
      if new.estado = 'En preparación' then perform app.trk_avanzar(v_id, 'preparacion', null, '{"area":"Bodega"}', coalesce(new.inicio_preparacion, now()));
      elsif new.estado = 'Lista' then perform app.trk_avanzar(v_id, 'lista', null, '{"area":"Bodega"}');
      elsif new.estado in ('Parcial', 'Despachada') then
        perform app.trk_avanzar(v_id, 'despachada', case when new.estado = 'Parcial' then 'Salió una parte del pedido; el resto sale en otro envío.' end,
          jsonb_build_object('area', 'Bodega', 'guia', new.numero_guia), coalesce(new.fecha_despacho, now()));
        if new.estado = 'Despachada' and old.estado = 'Parcial' then
          perform app.trk_evento(v_id, 'nota', 'Salió el resto del pedido', null, true, '{"area":"Bodega"}');
        end if;
      end if;
    end if;
    -- Novedades de bodega (daño, faltante…) = errores del proceso.
    if tg_op = 'UPDATE' and jsonb_array_length(coalesce(new.novedades, '[]')) > jsonb_array_length(coalesce(old.novedades, '[]')) then
      for i in jsonb_array_length(coalesce(old.novedades, '[]')) .. jsonb_array_length(new.novedades) - 1 loop
        x := new.novedades -> i;
        perform app.trk_evento(v_id, 'error', 'Novedad en bodega: ' || coalesce(x ->> 'tipo', 'novedad'),
          coalesce(x ->> 'detalle', x ->> 'nota', x ->> 'descripcion', ''), false, '{"area":"Bodega"}');
      end loop;
    end if;
  exception when others then raise warning 'Seguimiento (despacho %): %', new.id, sqlerrm;
  end;
  return null;
end $$;
create trigger tg_trk_despacho after insert or update on public.despachos
  for each row execute function app.tg_trk_despacho();

-- 4c) Logística: en camino, entregada (con firma, foto y GPS), no entregada e incidencias.
create or replace function app.tg_trk_entrega() returns trigger language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_pend int; v_desp text; x jsonb; i int; v_inst boolean; v_ant text; v_inc_ant int := 0;
begin
  begin
    v_id := app.trk_de_despacho(new.despacho_id);
    if v_id is null then return null; end if;
    if tg_op = 'UPDATE' then v_ant := old.estado; v_inc_ant := jsonb_array_length(coalesce(old.incidencias, '[]')); end if;
    if new.estado is distinct from v_ant then
      if new.estado in ('En ruta', 'Con transportista') then
        perform app.trk_avanzar(v_id, 'en_ruta', case when new.estado = 'Con transportista' then 'Con ' || coalesce(new.transportista, 'transportista') ||
          coalesce(' · guía ' || nullif(new.guia_numero, ''), '') else 'Va con nuestro equipo de entregas.' end,
          jsonb_build_object('area', 'Logística', 'transportista', new.transportista, 'guia', new.guia_numero));
      elsif new.estado = 'Entregada' then
        select count(*) into v_pend from public.entregas where despacho_id = new.despacho_id and deleted_at is null and id <> new.id and estado <> 'Entregada';
        select estado into v_desp from public.despachos where id = new.despacho_id;
        v_inst := coalesce(new.confirmacion ->> 'instalacion', '') in ('Instalación', 'Capacitación', 'Ambas');
        if v_inst then update public.pedidos_seguimiento set requiere_instalacion = true where id = v_id; end if;
        if v_pend = 0 and v_desp = 'Despachada' then
          perform app.trk_avanzar(v_id, 'entregada', coalesce('Recibió ' || nullif(new.prueba ->> 'nombre', ''), null),
            jsonb_build_object('area', 'Logística', 'lat', new.prueba ->> 'lat', 'lng', new.prueba ->> 'lng', 'fotos', coalesce(new.prueba -> 'fotos', '[]'::jsonb), 'entrega_id', new.id),
            coalesce(new.fecha_entrega, now()));
        else
          perform app.trk_evento(v_id, 'nota', 'Entrega parcial ' || coalesce(new.envio_numero::text, ''), 'Se entregó una parte del pedido.', true,
            jsonb_build_object('area', 'Logística', 'lat', new.prueba ->> 'lat', 'lng', new.prueba ->> 'lng'));
        end if;
      elsif new.estado = 'Por reprogramar' then
        perform app.trk_evento(v_id, 'error', 'Entrega no realizada', 'La entrega se debe reprogramar.', false, '{"area":"Logística"}');
      end if;
    end if;
    if jsonb_array_length(coalesce(new.incidencias, '[]')) > v_inc_ant then
      for i in v_inc_ant .. jsonb_array_length(new.incidencias) - 1 loop
        x := new.incidencias -> i;
        perform app.trk_evento(v_id, 'error', 'Incidencia en la entrega: ' || coalesce(x ->> 'tipo', 'incidencia'),
          coalesce(x ->> 'detalle', x ->> 'nota', x ->> 'descripcion', ''), false, '{"area":"Logística"}');
      end loop;
    end if;
  exception when others then raise warning 'Seguimiento (entrega %): %', new.id, sqlerrm;
  end;
  return null;
end $$;
create trigger tg_trk_entrega after insert or update on public.entregas
  for each row execute function app.tg_trk_entrega();

-- 4d) Servicio Técnico: la orden de instalación o capacitación de la factura se finaliza.
create or replace function app.tg_trk_st() returns trigger language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  begin
    if new.factura_id is null or new.tipo not in ('Instalación', 'Capacitación') then return null; end if;
    v_id := app.trk_de_factura(new.factura_id);
    if v_id is null then return null; end if;
    if tg_op = 'INSERT' then
      perform app.trk_evento(v_id, 'nota', new.tipo || ' agendada', coalesce('Orden ' || new.codigo, null), true, '{"area":"Servicio Técnico"}');
    elsif new.estado = 'Finalizada' and old.estado is distinct from 'Finalizada' then
      perform app.trk_completar(v_id, coalesce('Orden ' || new.codigo, null), '{"area":"Servicio Técnico"}');
    end if;
  exception when others then raise warning 'Seguimiento (servicio técnico %): %', new.id, sqlerrm;
  end;
  return null;
end $$;
create trigger tg_trk_st after insert or update of estado on public.st_ordenes
  for each row execute function app.tg_trk_st();

-- 4e) Encuesta del cliente.
create or replace function app.tg_trk_encuesta() returns trigger language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  begin
    v_id := app.trk_de_despacho(new.despacho_id);
    if v_id is not null then
      perform app.trk_evento(v_id, 'nota', 'Encuesta respondida', coalesce('Calificación general ' || new.general || '/5', null), false, '{"area":"Cliente"}');
    end if;
  exception when others then raise warning 'Seguimiento (encuesta): %', sqlerrm;
  end;
  return null;
end $$;
create trigger tg_trk_encuesta after insert on public.encuestas
  for each row execute function app.tg_trk_encuesta();

-- 5) Quién ve qué ---------------------------------------------------------------
create or replace function app.trk_ve(p_asesor uuid) returns boolean language sql stable security definer set search_path = public as $$
  select app.puede('tracking', 'ver') or app.puede_alguno(array['crm', 'femedics'], 'ver_todos')
      or (p_asesor is not null and app.es_yo_o_subordinado(p_asesor));
$$;
grant execute on function app.trk_ve(uuid) to authenticated;
alter table public.pedidos_seguimiento enable row level security;
create policy pedidos_seguimiento_ver on public.pedidos_seguimiento for select to authenticated using (deleted_at is null and app.trk_ve(asesor_id));
alter table public.pedidos_eventos enable row level security;
create policy pedidos_eventos_ver on public.pedidos_eventos for select to authenticated
  using (deleted_at is null and exists (select 1 from public.pedidos_seguimiento p where p.id = pedido_id and app.trk_ve(p.asesor_id)));

-- 6) Funciones del módulo Trackings ---------------------------------------------------
/** Situación de un pedido: días en la etapa, objetivo y si está atrasado. */
create or replace function app.trk_situacion(p public.pedidos_seguimiento, c jsonb) returns jsonb language sql stable as $$
  select jsonb_build_object('dias', d, 'objetivo', o, 'atrasado', p.estado = 'En curso' and o > 0 and d > o)
  from (select app.trk_dias(p.etapa_desde, now(), c) as d, app.trk_objetivo(p.etapa, p.zona, c) as o) x;
$$;

create or replace function public.trk_lista(p_estado text default 'En curso', p_dias int default 60) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c jsonb := app.trk_config();
begin
  return jsonb_build_object('config', c, 'etapas', app.trk_etapas(), 'pedidos', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'codigo', p.codigo, 'token', p.token, 'empresa', p.empresa, 'cliente', p.cliente_texto, 'asesor', coalesce(split_part(e.nombre, ' (', 1), ''),
      'factura', coalesce(f.numero_contifico, ''), 'venta', coalesce(q.codigo, ''), 'etapa', p.etapa, 'etapaNombre', app.trk_nombre(p.etapa), 'area', app.trk_area(p.etapa),
      'etapaDesde', p.etapa_desde, 'estado', p.estado, 'zona', p.zona, 'instalacion', p.requiere_instalacion, 'estimada', p.fecha_estimada,
      'creado', p.created_at, 'completado', p.completado_en,
      'errores', (select count(*) from public.pedidos_eventos v where v.pedido_id = p.id and v.tipo = 'error' and v.deleted_at is null)) || app.trk_situacion(p, c)
      order by p.created_at desc), '[]'::jsonb)
    from public.pedidos_seguimiento p
    left join public.empleados e on e.id = p.asesor_id
    left join public.facturas f on f.id = p.factura_id
    left join public.cotizaciones q on q.id = p.cotizacion_id
    where p.deleted_at is null and app.trk_ve(p.asesor_id)
      and (coalesce(p_estado, '') = '' or p.estado = p_estado or (p_estado = 'En curso' and p.estado = 'En curso'))
      and (p.estado = 'En curso' or p.created_at > now() - make_interval(days => greatest(p_dias, 1)))));
end $$;

create or replace function public.trk_detalle(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p public.pedidos_seguimiento; c jsonb := app.trk_config();
begin
  select * into p from public.pedidos_seguimiento where id = p_id and deleted_at is null;
  if p.id is null or not app.trk_ve(p.asesor_id) then raise exception 'No se encontró el pedido.'; end if;
  return to_jsonb(p) || app.trk_situacion(p, c) || jsonb_build_object(
    'etapaNombre', app.trk_nombre(p.etapa), 'area', app.trk_area(p.etapa),
    'asesor', (select split_part(nombre, ' (', 1) from public.empleados where id = p.asesor_id),
    'factura', (select numero_contifico from public.facturas where id = p.factura_id),
    'venta', (select codigo from public.cotizaciones where id = p.cotizacion_id),
    'guia', (select numero_guia from public.despachos where id = p.despacho_id),
    'eventos', (select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'fecha', v.fecha, 'etapa', v.etapa, 'tipo', v.tipo, 'titulo', v.titulo, 'detalle', v.detalle,
        'publico', v.publico, 'area', v.area, 'por', coalesce(split_part(u.nombre, ' (', 1), ''), 'lat', v.lat, 'lng', v.lng) order by v.fecha), '[]'::jsonb)
      from public.pedidos_eventos v left join public.empleados u on u.id = v.usuario_id where v.pedido_id = p.id and v.deleted_at is null));
end $$;

/** Nota o error manual (cualquier área que vea el pedido; errores solo quien edita Trackings o un área operativa). */
create or replace function public.trk_nota(p_id uuid, p_texto text, p_tipo text default 'nota', p_publico boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare p public.pedidos_seguimiento;
begin
  select * into p from public.pedidos_seguimiento where id = p_id and deleted_at is null;
  if p.id is null or not (app.trk_ve(p.asesor_id) or app.puede_alguno(array['bodega', 'logistica', 'facturacion', 'servicio_tecnico'], 'editar')) then raise exception 'No se encontró el pedido.'; end if;
  if btrim(coalesce(p_texto, '')) = '' then raise exception 'Escribe la nota.'; end if;
  if p_tipo not in ('nota', 'error', 'resuelto') then raise exception 'Tipo no válido.'; end if;
  perform app.trk_evento(p.id, p_tipo, case p_tipo when 'error' then 'Problema reportado' when 'resuelto' then 'Problema resuelto' else 'Nota' end,
    left(btrim(p_texto), 1000), coalesce(p_publico, false) and p_tipo = 'nota', '{}'::jsonb);
end $$;

create or replace function public.trk_instalacion(p_id uuid, p_requiere boolean) returns void
language plpgsql security definer set search_path = public as $$
declare p public.pedidos_seguimiento;
begin
  if not app.puede_alguno(array['tracking', 'logistica', 'servicio_tecnico'], 'editar') then raise exception 'Sin permiso.'; end if;
  select * into p from public.pedidos_seguimiento where id = p_id and deleted_at is null for update;
  if p.id is null then raise exception 'No se encontró el pedido.'; end if;
  if p.estado <> 'En curso' then raise exception 'El pedido ya está %.', lower(p.estado); end if;
  update public.pedidos_seguimiento set requiere_instalacion = p_requiere where id = p.id returning * into p;
  perform app.trk_evento(p.id, 'nota', case when p_requiere then 'Requiere instalación o capacitación' else 'Sin instalación' end, null, false, '{}'::jsonb);
  update public.pedidos_seguimiento set fecha_estimada = app.trk_estimada(p) where id = p.id;
end $$;

create or replace function public.trk_instalacion_realizada(p_id uuid, p_nota text default null) returns void
language plpgsql security definer set search_path = public as $$
declare p public.pedidos_seguimiento;
begin
  if not app.puede_alguno(array['tracking', 'servicio_tecnico'], 'editar') then raise exception 'Sin permiso.'; end if;
  select * into p from public.pedidos_seguimiento where id = p_id and deleted_at is null;
  if p.id is null or p.etapa <> 'instalacion' or p.estado <> 'En curso' then raise exception 'El pedido no está esperando instalación.'; end if;
  perform app.trk_completar(p.id, nullif(btrim(coalesce(p_nota, '')), ''), '{"area":"Servicio Técnico"}');
end $$;

create or replace function public.trk_cancelar(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare p public.pedidos_seguimiento;
begin
  if not app.puede('tracking', 'editar') then raise exception 'Sin permiso.'; end if;
  if length(btrim(coalesce(p_motivo, ''))) < 5 then raise exception 'Escribe el motivo.'; end if;
  select * into p from public.pedidos_seguimiento where id = p_id and deleted_at is null for update;
  if p.id is null or p.estado <> 'En curso' then raise exception 'El pedido ya no está en curso.'; end if;
  perform app.trk_evento(p.id, 'error', 'Pedido cancelado', btrim(p_motivo), false, '{}'::jsonb);
  update public.pedidos_seguimiento set estado = 'Cancelado', fecha_estimada = null where id = p.id;
end $$;

create or replace function public.trk_config_guardar(c jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n jsonb; fer jsonb; k text; o jsonb := '{}'::jsonb;
begin
  if not app.puede('tracking', 'editar') then raise exception 'Solo quien edita Trackings cambia los tiempos.'; end if;
  foreach k in array array['facturar', 'facturada', 'preparacion', 'lista', 'despachada', 'instalacion'] loop
    o := o || jsonb_build_object(k, greatest(0, least(60, coalesce(nullif(c -> 'objetivos' ->> k, '')::numeric, (app.trk_config() -> 'objetivos' ->> k)::numeric))));
  end loop;
  select coalesce(jsonb_agg(distinct x order by x), '[]'::jsonb) into fer from (
    select left(btrim(v), 10) x from jsonb_array_elements_text(case when jsonb_typeof(c -> 'feriados') = 'array' then c -> 'feriados' else '[]'::jsonb end) v
     where btrim(v) ~ '^\d{4}-\d{2}-\d{2}$') f;
  n := jsonb_build_object('habiles', coalesce((c ->> 'habiles')::boolean, true), 'feriados', fer, 'objetivos', o || '{"venta":0}'::jsonb,
    'en_ruta', jsonb_build_object('local', greatest(0, least(60, coalesce(nullif(c -> 'en_ruta' ->> 'local', '')::numeric, 1))),
                                  'provincia', greatest(0, least(60, coalesce(nullif(c -> 'en_ruta' ->> 'provincia', '')::numeric, 4)))));
  insert into public.tracking_configuracion (clave, valor, creado_por) values ('tiempos', n, app.empleado_id())
  on conflict (clave) do update set valor = excluded.valor, deleted_at = null;
  perform app.auditar('tracking', 'Tiempos objetivo', 'tiempos', 'OK', left(n::text, 400));
  return n;
end $$;

-- Permisos de ejecución
do $$
declare f text;
begin
  foreach f in array array['app.trk_config()', 'app.trk_estimada(public.pedidos_seguimiento)', 'app.trk_evento(uuid, text, text, text, boolean, jsonb, text, timestamptz)',
    'app.trk_avanzar(uuid, text, text, jsonb, timestamptz)', 'app.trk_completar(uuid, text, jsonb)', 'app.trk_de_factura(uuid)', 'app.trk_de_despacho(uuid)',
    'app.tg_trk_factura()', 'app.tg_trk_despacho_token()', 'app.tg_trk_despacho()', 'app.tg_trk_entrega()', 'app.tg_trk_st()', 'app.tg_trk_encuesta()'] loop
    execute 'revoke all on function ' || f || ' from public, anon, authenticated';
  end loop;
  foreach f in array array['public.trk_lista(text, int)', 'public.trk_detalle(uuid)', 'public.trk_nota(uuid, text, text, boolean)', 'public.trk_instalacion(uuid, boolean)',
    'public.trk_instalacion_realizada(uuid, text)', 'public.trk_cancelar(uuid, text)', 'public.trk_config_guardar(jsonb)'] loop
    execute 'revoke all on function ' || f || ' from public, anon';
    execute 'grant execute on function ' || f || ' to authenticated';
  end loop;
end $$;

notify pgrst, 'reload schema';
