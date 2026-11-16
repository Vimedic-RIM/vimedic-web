-- =====================================================================
-- Seguimiento de pedidos · Fase 3: escáner del QR — Issue #38
-- El personal escanea el QR de la guía (o escribe el código TRK / número de guía) y el sistema le
-- muestra la acción que le toca según su área y la etapa del pedido. Las acciones rápidas aplican las
-- MISMAS reglas que las pantallas de Bodega y Logística; lo que necesita series, fotos o firma abre
-- directamente ese pedido en su módulo. Cada escaneo queda en la bitácora del pedido.
-- =====================================================================

/** Busca el pedido por el texto leído: enlace con ?c=, código del QR, TRK-… o número de guía GD-…. */
create or replace function app.trk_buscar(p_texto text) returns uuid language plpgsql stable security definer set search_path = public as $$
declare t text := btrim(coalesce(p_texto, '')); v uuid;
begin
  if t ~* '[?&]c=[a-f0-9]{32,80}' then t := substring(t from '[?&][cC]=([a-fA-F0-9]{32,80})'); end if;
  if t = '' then return null; end if;
  select id into v from public.pedidos_seguimiento where deleted_at is null and (token = lower(t) or upper(codigo) = upper(t)) limit 1;
  if v is null then
    select p.id into v from public.pedidos_seguimiento p join public.despachos d on d.id = p.despacho_id
     where p.deleted_at is null and upper(d.numero_guia) = upper(t) limit 1;
  end if;
  return v;
end $$;

/** ¿Ya están todas las series que pide Bodega para marcar el pedido como listo? (igual que faltanSeriesMsg) */
create or replace function app.trk_series_completas(d public.despachos) returns boolean language sql stable as $$
  select not exists (
    select 1 from jsonb_array_elements(coalesce(d.productos, '[]'::jsonb)) p
     where coalesce((p ->> 'requiereSerie')::boolean, false)
       and (select count(*) from jsonb_array_elements_text(coalesce(d.series -> (p ->> 'key'), '[]'::jsonb)) s where btrim(s) <> '') < coalesce((p ->> 'cantidad')::int, 0));
$$;

create or replace function public.trk_escanear(p_texto text, p_dispositivo text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid; p public.pedidos_seguimiento; d public.despachos; e public.entregas; o public.st_ordenes; c jsonb := app.trk_config();
  acc jsonb := '[]'::jsonb; mio boolean := false; area text;
begin
  if not (app.puede_alguno(array['tracking', 'bodega', 'logistica', 'servicio_tecnico', 'facturacion'], 'ver') or app.puede_alguno(array['crm', 'femedics'], 'ver_todos')) then
    raise exception 'No tienes acceso al escáner de pedidos.';
  end if;
  v := app.trk_buscar(p_texto);
  if v is null then raise exception 'No se encontró un pedido con ese código. Los pedidos anteriores al 16-nov-2026 se buscan en Bodega o Logística.'; end if;
  select * into p from public.pedidos_seguimiento where id = v;
  select * into d from public.despachos where id = p.despacho_id;
  select * into e from public.entregas where despacho_id = p.despacho_id and deleted_at is null and estado <> 'Entregada' order by envio_numero desc limit 1;
  select * into o from public.st_ordenes where factura_id = p.factura_id and deleted_at is null and tipo in ('Instalación', 'Capacitación') and estado <> 'Cancelada' order by created_at desc limit 1;
  area := app.trk_area(p.etapa);

  if p.estado = 'En curso' then
    if p.etapa = 'facturar' and app.puede('facturacion', 'editar') then
      mio := true; acc := acc || jsonb_build_object('clave', 'abrir', 'titulo', 'Facturar en Facturación', 'destino', 'facturacion');
    end if;
    if p.etapa in ('facturada', 'preparacion', 'lista') and d.id is not null and app.puede('bodega', 'editar') then
      mio := true;
      if d.estado = 'Por preparar' then acc := acc || jsonb_build_object('clave', 'iniciar_preparacion', 'titulo', 'Iniciar preparación', 'principal', true); end if;
      if d.estado = 'En preparación' and app.trk_series_completas(d) then acc := acc || jsonb_build_object('clave', 'marcar_lista', 'titulo', 'Marcar lista para despacho', 'principal', true); end if;
      acc := acc || jsonb_build_object('clave', 'abrir', 'destino', 'bodega/' || d.id,
        'titulo', case when d.estado = 'Lista' then 'Despachar en Bodega (cantidades y fotos)' when d.estado = 'En preparación' then 'Abrir en Bodega (escanear series)' else 'Abrir en Bodega' end,
        'principal', d.estado = 'Lista' or (d.estado = 'En preparación' and not app.trk_series_completas(d)));
    end if;
    if p.etapa in ('despachada', 'en_ruta') and e.id is not null and app.puede('logistica', 'editar') then
      mio := true;
      if e.estado = 'Programada' and e.modalidad = 'Chofer propio' then acc := acc || jsonb_build_object('clave', 'en_ruta', 'titulo', 'Salir a entregar (en ruta)', 'principal', true); end if;
      acc := acc || jsonb_build_object('clave', 'abrir', 'destino', 'logistica/' || e.id,
        'titulo', case when e.estado in ('En ruta', 'Con transportista') then 'Registrar la entrega (firma, foto y GPS)' when e.estado = 'Programada' then 'Abrir en Logística' else 'Confirmar y programar la entrega' end,
        'principal', e.estado in ('En ruta', 'Con transportista', 'Por confirmar', 'Por reprogramar'));
    end if;
    if p.etapa = 'instalacion' and app.puede('servicio_tecnico', 'editar') then
      mio := true;
      if o.id is not null then acc := acc || jsonb_build_object('clave', 'abrir', 'destino', 'serviciotecnico/' || o.id, 'titulo', 'Abrir la orden ' || coalesce(o.codigo, '') || ' en Servicio Técnico', 'principal', true);
      else acc := acc || jsonb_build_object('clave', 'instalacion_realizada', 'titulo', 'Marcar instalación / capacitación realizada', 'principal', true);
      end if;
    end if;
  end if;
  if app.trk_ve(p.asesor_id) then acc := acc || jsonb_build_object('clave', 'abrir', 'destino', 'tracking/' || p.id, 'titulo', 'Ver el pedido completo en Trackings'); end if;

  perform app.trk_evento(p.id, 'escaneo', 'QR escaneado', null, false, jsonb_build_object('dispositivo', left(coalesce(p_dispositivo, ''), 160), 'area', area));
  return jsonb_build_object('id', p.id, 'codigo', p.codigo, 'token', p.token, 'cliente', p.cliente_texto, 'empresa', p.empresa, 'etapa', p.etapa, 'etapaNombre', app.trk_nombre(p.etapa),
    'estado', p.estado, 'area', area, 'mio', mio, 'acciones', acc, 'guia', d.numero_guia, 'factura', (select numero_contifico from public.facturas where id = p.factura_id),
    'despacho', d.estado, 'entrega', e.estado, 'estimada', p.fecha_estimada) || app.trk_situacion(p, c);
end $$;

/** Acciones rápidas del escáner (mismas reglas que las pantallas). El avance del pedido lo hacen los disparadores de cada tabla. */
create or replace function public.trk_accion(p_pedido uuid, p_accion text, p_dispositivo text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p public.pedidos_seguimiento; d public.despachos; e public.entregas; yo uuid := app.empleado_id(); quien text;
begin
  select * into p from public.pedidos_seguimiento where id = p_pedido and deleted_at is null;
  if p.id is null then raise exception 'No se encontró el pedido.'; end if;
  if p.estado <> 'En curso' then raise exception 'El pedido ya está %.', lower(p.estado); end if;
  select coalesce(split_part(nombre, ' (', 1), email) into quien from public.empleados where id = yo;
  quien := coalesce(quien, 'Escáner');

  if p_accion in ('iniciar_preparacion', 'marcar_lista') then
    if not app.puede('bodega', 'editar') then raise exception 'Sin permiso en Bodega.'; end if;
    select * into d from public.despachos where id = p.despacho_id and deleted_at is null for update;
    if d.id is null then raise exception 'El pedido todavía no tiene despacho en Bodega.'; end if;
    if p_accion = 'iniciar_preparacion' then
      if d.estado <> 'Por preparar' then raise exception 'Ya está en preparación.'; end if;
      update public.despachos set estado = 'En preparación', preparado_por = coalesce(preparado_por, yo), inicio_preparacion = now(),
        historial = (coalesce(historial, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('fecha', now(), 'por', quien, 'nota', 'Inició la preparación (escaneó el QR).')))
      where id = d.id;
    else
      if d.estado <> 'En preparación' then raise exception 'El pedido no está en preparación.'; end if;
      if not app.trk_series_completas(d) then raise exception 'Faltan series: ábrelo en Bodega para escanearlas.'; end if;
      update public.despachos set estado = 'Lista', preparado_por = coalesce(preparado_por, yo),
        historial = (coalesce(historial, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('fecha', now(), 'por', quien, 'nota', 'Marcó el pedido como listo para despachar (escaneó el QR).')))
      where id = d.id;
    end if;
  elsif p_accion = 'en_ruta' then
    if not app.puede('logistica', 'editar') then raise exception 'Sin permiso en Logística.'; end if;
    select * into e from public.entregas where despacho_id = p.despacho_id and deleted_at is null and estado <> 'Entregada' order by envio_numero desc limit 1 for update;
    if e.id is null then raise exception 'No hay una entrega pendiente.'; end if;
    if e.estado <> 'Programada' then raise exception 'Primero confirma y programa la entrega en Logística.'; end if;
    if e.modalidad <> 'Chofer propio' then raise exception '"En ruta" es para entregas con chofer propio.'; end if;
    update public.entregas set estado = 'En ruta', chofer = coalesce(nullif(chofer, ''), quien),
      eventos = (coalesce(eventos, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('fecha', now(), 'por', quien, 'nota', 'Tu pedido va en camino con nuestro equipo de entregas.', 'publico', true, 'clave', 'camino')))
    where id = e.id;
  elsif p_accion = 'instalacion_realizada' then
    if not app.puede('servicio_tecnico', 'editar') then raise exception 'Sin permiso en Servicio Técnico.'; end if;
    if p.etapa <> 'instalacion' then raise exception 'El pedido no está esperando instalación.'; end if;
    perform app.trk_completar(p.id, 'Registrada al escanear el QR.', jsonb_build_object('area', 'Servicio Técnico', 'dispositivo', left(coalesce(p_dispositivo, ''), 160)));
  else
    raise exception 'Acción no válida.';
  end if;
  select * into p from public.pedidos_seguimiento where id = p.id;
  return jsonb_build_object('ok', true, 'etapa', p.etapa, 'etapaNombre', app.trk_nombre(p.etapa), 'estado', p.estado);
end $$;

revoke all on function app.trk_buscar(text) from public, anon, authenticated;
revoke all on function app.trk_series_completas(public.despachos) from public, anon, authenticated;
revoke all on function public.trk_escanear(text, text) from public, anon;
revoke all on function public.trk_accion(uuid, text, text) from public, anon;
grant execute on function public.trk_escanear(text, text) to authenticated;
grant execute on function public.trk_accion(uuid, text, text) to authenticated;
notify pgrst, 'reload schema';
