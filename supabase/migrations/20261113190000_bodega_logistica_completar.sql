-- =====================================================================
-- VIMEDIC · Bodega y Logística: lo que faltaba frente al original (Issue #28)
--   · Encuesta de satisfacción del cliente por el enlace de seguimiento
--     (vmEncuestaDatos / vmEncuestaGuardar): funciones públicas por token.
--   · Al despachar: solo salen equipos importados revisados en la Bodega
--     principal y su serie pasa a "Vendida" (impValidarSeriesDespacho_ /
--     impMarcarVendidas_).
--   · Historial del CRM: "Despachado completo / parcial" y "Entregado"
--     (logInteraction_ de Bodega.gs y Logistica.gs).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Ayuda: registra una interacción en la cotización de la venta
-- ---------------------------------------------------------------------
create or replace function app.registrar_interaccion_venta(p_factura uuid, p_operacion text, p_cliente uuid, p_tipo text, p_nota text, p_usuario text)
returns void language plpgsql security definer set search_path = public as $$
declare v_cot uuid; v_cod text;
begin
  if p_factura is not null then select f.cotizacion_id into v_cot from public.facturas f where f.id = p_factura; end if;
  if v_cot is null and coalesce(p_operacion, '') <> '' then select c.id into v_cot from public.cotizaciones c where c.codigo = p_operacion and c.deleted_at is null limit 1; end if;
  if v_cot is not null then select c.codigo into v_cod from public.cotizaciones c where c.id = v_cot; end if;
  insert into public.interacciones (id, codigo, ref_tipo, ref_codigo, cotizacion_id, cliente_id, fecha, tipo, nota, empleado_id, usuario_texto)
  values (gen_random_uuid(), 'INT-' || left(replace(gen_random_uuid()::text, '-', ''), 10), 'Cotización', coalesce(v_cod, p_operacion), v_cot, p_cliente, now(),
          p_tipo, left(p_nota, 2000), app.empleado_id(), coalesce(nullif(p_usuario, ''), p_tipo));
exception when others then
  raise warning 'No se registró la interacción (%): %', p_tipo, sqlerrm;  -- nunca bloquea el despacho ni la entrega
end;
$$;
revoke all on function app.registrar_interaccion_venta(uuid, text, uuid, text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 1) Despacho: series de importación y CRM
--    Se dispara cuando se agrega un envío (bodega_despachar).
-- ---------------------------------------------------------------------
create or replace function app.tg_despacho_envio()
returns trigger language plpgsql security definer set search_path = public as $$
declare env jsonb; v_series text[]; s text; v_estado text; malas text[] := '{}'; total int;
begin
  if jsonb_array_length(coalesce(new.envios, '[]'::jsonb)) <= jsonb_array_length(coalesce(old.envios, '[]'::jsonb)) then return new; end if;
  env := new.envios -> -1;
  select coalesce(array_agg(distinct upper(btrim(x))), '{}') into v_series
    from jsonb_each(case when jsonb_typeof(env->'series') = 'object' then env->'series' else '{}'::jsonb end) k,
         jsonb_array_elements_text(case when jsonb_typeof(k.value) = 'array' then k.value else '[]'::jsonb end) x
   where btrim(x) <> '';
  -- Solo salen equipos revisados en la Bodega principal (los anteriores al portal de importaciones no están registrados y se permiten)
  foreach s in array v_series loop
    select u.estado into v_estado from public.imp_unidades u where upper(btrim(u.serie)) = s and u.deleted_at is null order by u.updated_at desc limit 1;
    if found and coalesce(v_estado, '') not in ('Principal', 'Vendida') then
      malas := malas || (s || case when coalesce(v_estado, '') <> '' then ' (' || lower(v_estado) || ')' else ' (aún no ingresa a bodega)' end);
    end if;
  end loop;
  if cardinality(malas) > 0 then
    raise exception 'No se puede despachar: %. Solo salen equipos revisados en la Bodega principal.', array_to_string(malas, ', ');
  end if;
  if cardinality(v_series) > 0 then
    update public.imp_unidades set estado = 'Vendida',
      historial = (coalesce(historial, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('fecha', now(), 'por', 'Bodega', 'nota', 'Despachada en ' || coalesce(new.codigo, '') || '.')))
    where deleted_at is null and estado = 'Principal' and upper(btrim(serie)) = any (v_series);
  end if;
  select coalesce(sum((v.value)::int), 0) into total from jsonb_each_text(case when jsonb_typeof(env->'cantidades') = 'object' then env->'cantidades' else '{}'::jsonb end) v where v.value ~ '^\d+$';
  perform app.registrar_interaccion_venta(new.factura_id, new.operacion_codigo, new.cliente_id, 'Bodega',
    case when new.estado = 'Despachada' then 'Despachado completo' else 'Despacho parcial' end || ' por ' || coalesce(env->>'por', 'Bodega') || ' (' || coalesce(new.codigo, '') || ', ' || total || ' unidad(es)).',
    env->>'por');
  return new;
end;
$$;
drop trigger if exists tg_despacho_envio on public.despachos;
create trigger tg_despacho_envio before update of envios on public.despachos
  for each row execute function app.tg_despacho_envio();

-- ---------------------------------------------------------------------
-- 2) Entrega realizada → historial del CRM
-- ---------------------------------------------------------------------
create or replace function app.tg_entrega_entregada()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_quien text;
begin
  if new.estado = 'Entregada' and old.estado is distinct from 'Entregada' then
    select nombre into v_quien from public.empleados where id = app.empleado_id();
    perform app.registrar_interaccion_venta(new.factura_id, new.operacion_codigo, new.cliente_id, 'Logística',
      'Entregado (' || coalesce(new.codigo, '') || ') — recibió ' || coalesce(nullif(btrim(new.prueba->>'nombre'), ''), 'cliente') || '.', coalesce(v_quien, 'Logística'));
  end if;
  return new;
end;
$$;
drop trigger if exists tg_entrega_entregada on public.entregas;
create trigger tg_entrega_entregada after update of estado on public.entregas
  for each row execute function app.tg_entrega_entregada();

-- ---------------------------------------------------------------------
-- 3) Encuesta de satisfacción (página pública /encuesta/?c=<código>)
--    El código es el mismo del seguimiento: del despacho o de un envío.
-- ---------------------------------------------------------------------
create or replace function app.despacho_por_token(p_token text)
returns public.despachos language plpgsql stable security definer set search_path = public as $$
declare d public.despachos;
begin
  if p_token is null or p_token !~* '^[a-f0-9]{24,64}$' then raise exception 'Enlace no válido.'; end if;
  select * into d from public.despachos where token_seguimiento = p_token and deleted_at is null limit 1;
  if not found then
    select x.* into d from public.entregas e join public.despachos x on x.id = e.despacho_id
     where e.token_seguimiento = p_token and e.deleted_at is null and x.deleted_at is null limit 1;
  end if;
  if d.id is null then raise exception 'No encontramos este pedido. Revisa el enlace.'; end if;
  if coalesce(btrim(d.cliente_texto), '') = '' and d.cliente_id is not null then select c.nombre into d.cliente_texto from public.clientes c where c.id = d.cliente_id; end if;
  return d;
end;
$$;
revoke all on function app.despacho_por_token(text) from public, anon, authenticated;

create or replace function app.tipos_queja()
returns text[] language sql immutable as $$
  select array['Producto con fallas o dañado', 'Faltó algo en el pedido', 'Demora en la entrega', 'Atención del personal', 'Facturación o cobro', 'Otro']
$$;

create or replace function public.encuesta_datos(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public, app as $$
declare d public.despachos; e public.encuestas; v_asesor text;
begin
  d := app.despacho_por_token(p_token);
  select * into e from public.encuestas where codigo = p_token and deleted_at is null;
  select nombre into v_asesor from public.empleados where id = d.asesor_id;
  return jsonb_build_object(
    'marca', case when d.empresa = 'FEMEDICS' then 'FEMEDICS' else 'VIMEDIC' end,
    'cliente', coalesce(d.cliente_texto, ''), 'factura', coalesce(d.factura_texto, ''), 'asesor', coalesce(split_part(v_asesor, ' (', 1), ''),
    'productos', (select coalesce(jsonb_agg(p->>'nombre'), '[]'::jsonb) from jsonb_array_elements(coalesce(d.productos, '[]'::jsonb)) p),
    'tiposQueja', to_jsonb(app.tipos_queja()),
    'respuesta', case when e.id is null then null else jsonb_build_object('general', e.general, 'asesor', e.atencion_asesor, 'entrega', e.entrega,
      'producto', e.estado_producto, 'recomienda', e.recomendaria, 'comentario', coalesce(e.comentario, ''), 'queja', e.queja = 'SI',
      'tipoQueja', coalesce(e.tipo_queja, ''), 'contactar', coalesce(e.desea_contacto, false)) end);
end;
$$;
revoke all on function public.encuesta_datos(text) from public;
grant execute on function public.encuesta_datos(text) to anon, authenticated;

create or replace function public.encuesta_guardar(p_token text, p jsonb)
returns jsonb language plpgsql security definer set search_path = public, app as $$
declare d public.despachos; v_general int; v_asesor int; v_entrega int; v_producto int; v_rec int; v_queja boolean; v_tipo text; v_com text; v_contactar boolean;
  v_ent uuid; v_cot uuid; v_nota text;
  n5 constant text := '^[1-5]$';
begin
  d := app.despacho_por_token(p_token);
  p := coalesce(p, '{}'::jsonb);
  v_general := case when coalesce(p->>'general', '') ~ n5 then (p->>'general')::int end;
  if v_general is null then raise exception 'Califica tu experiencia general.'; end if;
  v_asesor := case when coalesce(p->>'asesor', '') ~ n5 then (p->>'asesor')::int end;
  v_entrega := case when coalesce(p->>'entrega', '') ~ n5 then (p->>'entrega')::int end;
  v_producto := case when coalesce(p->>'producto', '') ~ n5 then (p->>'producto')::int end;
  v_rec := case when coalesce(p->>'recomienda', '') ~ '^([0-9]|10)$' then (p->>'recomienda')::int end;
  v_queja := coalesce(p->>'queja', 'false') in ('true', 't', '1', 'SI');
  v_tipo := case when (p->>'tipoQueja') = any (app.tipos_queja()) then p->>'tipoQueja' when v_queja then 'Otro' else '' end;
  v_com := left(btrim(coalesce(p->>'comentario', '')), 2000);
  v_contactar := coalesce(p->>'contactar', 'false') in ('true', 't', '1', 'SI');
  if v_queja and v_com = '' then raise exception 'Cuéntanos qué pasó para poder ayudarte.'; end if;

  select e.id into v_ent from public.entregas e where e.token_seguimiento = p_token and e.deleted_at is null limit 1;
  insert into public.encuestas (id, codigo, fecha, despacho_id, entrega_id, factura_id, empresa, cliente_texto, factura_texto, asesor_id,
    general, atencion_asesor, entrega, estado_producto, recomendaria, comentario, queja, tipo_queja, desea_contacto)
  values (gen_random_uuid(), p_token, now(), d.id, v_ent, d.factura_id, coalesce(d.empresa, 'VIMEDIC'), d.cliente_texto, d.factura_texto, d.asesor_id,
    v_general, v_asesor, v_entrega, v_producto, v_rec, nullif(v_com, ''), case when v_queja then 'SI' else 'NO' end, nullif(v_tipo, ''), v_contactar)
  on conflict (codigo) do update set general = excluded.general, atencion_asesor = excluded.atencion_asesor, entrega = excluded.entrega,
    estado_producto = excluded.estado_producto, recomendaria = excluded.recomendaria, comentario = excluded.comentario, queja = excluded.queja,
    tipo_queja = excluded.tipo_queja, desea_contacto = excluded.desea_contacto, deleted_at = null;

  v_nota := 'Encuesta del cliente: ' || v_general || '/5' || case when v_rec is not null then ' · recomendaría ' || v_rec || '/10' else '' end
    || case when v_queja then ' · QUEJA: ' || v_tipo else '' end || case when v_com <> '' then ' — ' || v_com else '' end;
  perform app.registrar_interaccion_venta(d.factura_id, d.operacion_codigo, d.cliente_id, 'Encuesta', v_nota, 'Cliente');

  -- Queja, baja calificación o pide contacto: aviso al asesor (el original enviaba un correo)
  if (v_queja or v_general <= 2 or (v_rec is not null and v_rec <= 6) or v_contactar) and d.asesor_id is not null then
    select f.cotizacion_id into v_cot from public.facturas f where f.id = d.factura_id;
    insert into public.notificaciones (para_id, modulo, evento, tipo, texto, entidad, entidad_id)
    values (d.asesor_id, 'crm', 'encuesta', 'aviso',
      case when v_queja then 'QUEJA de cliente' else 'Encuesta con baja calificación' end || ' — ' || coalesce(d.cliente_texto, '') ||
      ' (factura ' || coalesce(d.factura_texto, '—') || '): ' || v_general || '/5' || case when v_contactar then ' · pide que lo contacten' else '' end ||
      case when v_com <> '' then ' — ' || left(v_com, 300) else '' end,
      case when v_cot is not null then 'cotizaciones' end, v_cot);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.encuesta_guardar(text, jsonb) from public;
grant execute on function public.encuesta_guardar(text, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
