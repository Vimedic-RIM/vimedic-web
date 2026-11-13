-- =====================================================================
-- Aprobación por producto (no toda la campaña a la vez): quien aprueba
-- trabaja desde Ofertas y Liquidación › "Por aprobar", una tarjeta por
-- producto, pudiendo editar el % propuesto, rechazar solo ese producto o
-- aprobarlo. Al aprobar un producto se crea/actualiza su oferta real
-- (mismo piso de margen que app.aprobar_campana_promocion). Cuando ya no
-- queda ningún producto pendiente, la campaña pasa sola a Aprobada
-- (si aprobó al menos uno) o Rechazada (si se rechazaron todos).
-- =====================================================================
create or replace function app.revisar_item_promocion(
  p_campana_id uuid, p_item_codigo text, p_decision text, p_desc_aprobado numeric default null, p_comentario text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_camp record;
  v_emp uuid := app.empleado_id();
  v_emp_nombre text := (select nombre from public.empleados where id = app.empleado_id());
  v_items jsonb;
  v_item jsonb;
  v_idx int;
  v_prod record;
  v_margen_minimo numeric;
  v_desc numeric;
  v_precio numeric;
  v_margen numeric;
  v_piso numeric;
  v_ahora timestamptz := now();
  v_oferta_id uuid;
  v_pendientes int;
  v_aprobados int;
  v_estado_final text;
begin
  if not app.puede_alguno(array['ofertas', 'marketing', 'promociones'], 'aprobar') then
    raise exception 'No autorizado para aprobar o rechazar productos de promociones.';
  end if;
  if p_decision not in ('Aprobar', 'Rechazar') then raise exception 'Decisión no válida.'; end if;

  select * into v_camp from public.promo_campanas where id = p_campana_id and deleted_at is null;
  if v_camp.id is null then raise exception 'Campaña no encontrada.'; end if;
  if v_camp.estado <> 'En aprobación' then raise exception 'Esta campaña no está en aprobación.'; end if;

  v_items := coalesce(v_camp.items, '[]'::jsonb);
  select (t.i - 1) into v_idx from jsonb_array_elements(v_items) with ordinality as t(elem, i) where t.elem ->> 'id' = p_item_codigo limit 1;
  if v_idx is null then raise exception 'Producto no encontrado en la campaña.'; end if;
  v_item := v_items -> v_idx;

  if coalesce(v_item ->> 'estadoAprobacion', 'Pendiente') <> 'Pendiente' then
    raise exception 'Este producto ya fue revisado.';
  end if;

  select p.id, p.pvp, coalesce(pc.costo_importacion, 0) as costo into v_prod
    from public.productos p left join public.productos_costos pc on pc.producto_id = p.id and pc.deleted_at is null
    where p.codigo = p_item_codigo and p.deleted_at is null limit 1;
  if v_prod.id is null then raise exception 'El producto ya no existe.'; end if;

  if p_decision = 'Rechazar' then
    v_item := v_item || jsonb_build_object('estadoAprobacion', 'Rechazado', 'revisadoPor', v_emp_nombre, 'fechaRevision', v_ahora, 'motivoRechazo', p_comentario);
  else
    v_desc := coalesce(p_desc_aprobado, (v_item ->> 'desc')::numeric, 0);
    if v_desc <= 0 then raise exception 'El %% de descuento debe ser mayor a cero para aprobar.'; end if;

    select coalesce((valor ->> 'margenMinimo')::numeric, 10) into v_margen_minimo from public.ofertas_config where deleted_at is null order by created_at limit 1;
    v_margen_minimo := coalesce(v_margen_minimo, 10);
    v_precio := round(v_prod.pvp * (1 - v_desc / 100), 2);
    if v_prod.costo > 0 then
      v_piso := round(v_prod.costo * (1 + v_margen_minimo / 100), 2);
      if v_precio < v_piso then
        raise exception '%', 'Con ' || v_desc || '% el precio ($' || v_precio || ') queda bajo el piso (costo + ' || v_margen_minimo || '% = $' || v_piso || ').';
      end if;
    elsif v_desc > 35 then
      raise exception '%', 'Sin costo cargado no se permite más de 35% de descuento.';
    end if;
    v_margen := case when v_prod.costo > 0 and v_precio > 0 then round((v_precio - v_prod.costo) / v_precio * 1000) / 10 else null end;

    select id into v_oferta_id from public.ofertas where campana_id = p_campana_id and producto_id = v_prod.id and deleted_at is null limit 1;
    if v_oferta_id is not null then
      update public.ofertas set
        descuento_pct = v_desc, precio_oferta = v_precio, pvp_base = v_prod.pvp, costo = nullif(v_prod.costo, 0), margen_pct = v_margen,
        inicio = v_camp.inicio, fin = v_camp.fin, actualizado_por = v_emp,
        historial = historial || jsonb_build_array(jsonb_build_object('f', v_ahora, 'por', v_emp_nombre, 'n', 'Aprobada desde Ofertas (' || v_camp.nombre || ')'))
      where id = v_oferta_id;
    else
      v_oferta_id := gen_random_uuid();
      insert into public.ofertas (
        id, codigo, producto_id, campana_id, tipo, descuento_pct, precio_oferta, pvp_base, costo, margen_pct, inicio, fin,
        stock_inicial, historial, creado_por, actualizado_por
      ) values (
        v_oferta_id, 'OF-' || to_char(v_ahora, 'YYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 4)),
        v_prod.id, p_campana_id, 'Campaña', v_desc, v_precio, v_prod.pvp, nullif(v_prod.costo, 0), v_margen, v_camp.inicio, v_camp.fin,
        (select stock from public.productos where id = v_prod.id),
        jsonb_build_array(jsonb_build_object('f', v_ahora, 'por', v_emp_nombre, 'n', 'Aprobada desde Ofertas (' || v_camp.nombre || ')')),
        v_emp, v_emp
      );
    end if;

    v_item := v_item || jsonb_build_object('estadoAprobacion', 'Aprobado', 'descAprobado', v_desc, 'revisadoPor', v_emp_nombre, 'fechaRevision', v_ahora, 'ofertaId', v_oferta_id);
  end if;

  v_items := jsonb_set(v_items, array[v_idx::text], v_item);

  select
    count(*) filter (where coalesce(x ->> 'estadoAprobacion', 'Pendiente') = 'Pendiente' and coalesce((x ->> 'desc')::numeric, 0) > 0),
    count(*) filter (where x ->> 'estadoAprobacion' = 'Aprobado')
    into v_pendientes, v_aprobados
    from jsonb_array_elements(v_items) x;

  v_estado_final := case when v_pendientes > 0 then v_camp.estado when v_aprobados > 0 then 'Aprobada' else 'Rechazada' end;

  update public.promo_campanas set
    items = v_items,
    estado = v_estado_final,
    aprobado_por = case when v_pendientes = 0 then v_emp else aprobado_por end,
    fecha_aprobacion = case when v_pendientes = 0 then v_ahora else fecha_aprobacion end,
    historial = case when v_pendientes = 0
      then coalesce(historial, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('fecha', v_ahora, 'por', v_emp_nombre, 'accion', v_estado_final, 'comentario', 'Todos los productos revisados desde Ofertas'))
      else historial end
  where id = p_campana_id;

  return jsonb_build_object('success', true, 'decision', p_decision, 'oferta_id', v_oferta_id, 'pendientes', v_pendientes, 'estado_campana', v_estado_final);
end;
$$;
revoke all on function app.revisar_item_promocion(uuid, text, text, numeric, text) from public, anon;
grant execute on function app.revisar_item_promocion(uuid, text, text, numeric, text) to authenticated;
