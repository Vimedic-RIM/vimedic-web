-- =====================================================================
-- Escáner por módulo: con cualquier código (QR de la guía con su enlace de seguimiento, TRK-, número de guía GD-,
-- despacho DSP-, entrega ENT-, orden de servicio, factura o serie del equipo) devuelve los registros del pedido en
-- cada módulo, para abrirlo directo donde trabaja quien escanea (Bodega, Logística, Servicio Técnico, Facturación).
-- Solo devuelve ids y el nombre del cliente; cada módulo vuelve a leer el registro con sus propios permisos.
-- =====================================================================

create or replace function public.mod_escanear(p_texto text) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare
  t text := btrim(coalesce(p_texto, ''));
  v_ped uuid; p public.pedidos_seguimiento; v_desp uuid; v_fact uuid; v_ent uuid; v_ord uuid; v_cliente text; v_codigo text;
begin
  if not (app.puede_alguno(array['bodega', 'logistica', 'servicio_tecnico', 'facturacion', 'tracking'], 'ver') or app.puede_alguno(array['crm', 'femedics'], 'ver_todos')) then
    raise exception 'No tienes acceso al escáner de pedidos.';
  end if;
  if t ~* '[?&]c=[a-f0-9]{16,80}' then t := substring(t from '[?&][cC]=([a-fA-F0-9]{16,80})'); end if;
  if t = '' then raise exception 'Código vacío.'; end if;

  -- 1) Pedido de Trackings (TRK-, enlace del cliente o número de guía)
  v_ped := app.trk_buscar(t);
  if v_ped is not null then
    select * into p from public.pedidos_seguimiento where id = v_ped;
    v_desp := p.despacho_id; v_fact := p.factura_id; v_cliente := p.cliente_texto; v_codigo := p.codigo;
  end if;
  -- 2) Despacho de Bodega (código DSP-, número de guía o su enlace)
  if v_desp is null then
    select id, factura_id, cliente_texto, codigo into v_desp, v_fact, v_cliente, v_codigo from public.despachos
     where deleted_at is null and (upper(codigo) = upper(t) or upper(numero_guia) = upper(t) or token_seguimiento = lower(t)) limit 1;
  end if;
  -- 3) Entrega de Logística (código ENT- o su enlace)
  if v_desp is null and v_fact is null then
    select id, despacho_id, factura_id, cliente_texto, codigo into v_ent, v_desp, v_fact, v_cliente, v_codigo from public.entregas
     where deleted_at is null and (upper(codigo) = upper(t) or token_seguimiento = lower(t) or upper(coalesce(guia_numero, '')) = upper(t)) limit 1;
  end if;
  -- 4) Orden de Servicio Técnico (código, enlace o serie del equipo)
  if v_desp is null and v_fact is null and v_ent is null then
    select id, factura_id, cliente_texto, codigo into v_ord, v_fact, v_cliente, v_codigo from public.st_ordenes
     where deleted_at is null and (upper(codigo) = upper(t) or token = lower(t) or upper(coalesce(serie, '')) = upper(t)) order by created_at desc limit 1;
  end if;
  -- 5) Factura (número de Contífico)
  if v_desp is null and v_fact is null and v_ent is null and v_ord is null then
    select f.id, c.nombre, f.codigo into v_fact, v_cliente, v_codigo from public.facturas f left join public.clientes c on c.id = f.cliente_id
     where f.deleted_at is null and (f.numero_contifico = t or upper(f.codigo) = upper(t)) limit 1;
  end if;
  if v_desp is null and v_fact is null and v_ent is null and v_ord is null then
    raise exception 'No se encontró un pedido con ese código.';
  end if;

  -- Completar lo que falte entre despacho, factura, entrega y orden
  if v_desp is null and v_fact is not null then select id into v_desp from public.despachos where factura_id = v_fact and deleted_at is null order by created_at desc limit 1; end if;
  if v_fact is null and v_desp is not null then select factura_id into v_fact from public.despachos where id = v_desp; end if;
  if v_ent is null and v_desp is not null then
    select id into v_ent from public.entregas where despacho_id = v_desp and deleted_at is null order by (estado = 'Entregada'), envio_numero desc limit 1;
  end if;
  if v_ord is null and v_fact is not null then
    select id into v_ord from public.st_ordenes where factura_id = v_fact and deleted_at is null and estado <> 'Cancelada' order by created_at desc limit 1;
  end if;
  if v_ped is null and v_desp is not null then select id into v_ped from public.pedidos_seguimiento where despacho_id = v_desp and deleted_at is null limit 1; end if;
  if v_ped is not null then
    perform app.trk_evento(v_ped, 'escaneo', 'QR escaneado', null, false, jsonb_build_object('origen', 'modulo'));
  end if;

  return jsonb_build_object('pedido', v_ped, 'despacho', v_desp, 'entrega', v_ent, 'orden', v_ord, 'factura', v_fact,
    'cliente', coalesce(v_cliente, ''), 'codigo', coalesce(v_codigo, ''));
end;
$$;
revoke all on function public.mod_escanear(text) from public, anon;
grant execute on function public.mod_escanear(text) to authenticated;

notify pgrst, 'reload schema';
