-- =====================================================================
-- Corrige app.aprobar_campana_promocion(): productos_costos no tiene
-- columna "costo", es "costo_importacion" (como ya usa of_analisis).
-- =====================================================================
create or replace function app.aprobar_campana_promocion(p_campana_id uuid, p_comentario text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_camp record;
  v_emp uuid := app.empleado_id();
  v_emp_nombre text := (select nombre from public.empleados where id = app.empleado_id());
  v_margen_minimo numeric;
  v_item jsonb;
  v_prod record;
  v_desc numeric;
  v_precio numeric;
  v_margen numeric;
  v_piso numeric;
  v_errores text[] := '{}';
  v_existente uuid;
  v_ahora timestamptz := now();
  v_creadas int := 0;
  v_actualizadas int := 0;
begin
  if not app.puede_alguno(array['marketing','promociones'], 'aprobar') then
    raise exception 'No autorizado para aprobar campañas.';
  end if;

  select * into v_camp from public.promo_campanas where id = p_campana_id and deleted_at is null;
  if v_camp.id is null then raise exception 'Campaña no encontrada.'; end if;
  if v_camp.estado <> 'En aprobación' then raise exception 'Esta campaña no está en aprobación.'; end if;

  select coalesce((valor->>'margenMinimo')::numeric, 10) into v_margen_minimo
    from public.ofertas_config where deleted_at is null order by created_at limit 1;
  v_margen_minimo := coalesce(v_margen_minimo, 10);

  for v_item in select * from jsonb_array_elements(coalesce(v_camp.items, '[]'::jsonb))
  loop
    v_desc := coalesce((v_item->>'desc')::numeric, 0);
    continue when v_desc <= 0;
    select p.id, p.pvp, coalesce(pc.costo_importacion, 0) as costo into v_prod
      from public.productos p left join public.productos_costos pc on pc.producto_id = p.id and pc.deleted_at is null
      where p.codigo = (v_item->>'id') and p.deleted_at is null limit 1;
    if v_prod.id is null then
      v_errores := array_append(v_errores, (v_item->>'id') || ': el producto ya no existe.');
      continue;
    end if;
    v_precio := round(coalesce(v_prod.pvp, 0) * (1 - v_desc / 100), 2);
    if v_prod.costo > 0 then
      v_piso := round(v_prod.costo * (1 + v_margen_minimo / 100), 2);
      if v_precio < v_piso then
        v_errores := array_append(v_errores, (v_item->>'id') || ': con ' || v_desc || '% el precio ($' || v_precio || ') queda bajo el piso (costo + ' || v_margen_minimo || '% = $' || v_piso || ').');
      end if;
    elsif v_desc > 35 then
      v_errores := array_append(v_errores, (v_item->>'id') || ': sin costo cargado no se permite más de 35% de descuento.');
    end if;
  end loop;

  if array_length(v_errores, 1) > 0 then
    raise exception '%', array_to_string(v_errores, E'\n');
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(v_camp.items, '[]'::jsonb))
  loop
    v_desc := coalesce((v_item->>'desc')::numeric, 0);
    continue when v_desc <= 0;
    select p.id, p.pvp, coalesce(pc.costo_importacion, 0) as costo into v_prod
      from public.productos p left join public.productos_costos pc on pc.producto_id = p.id and pc.deleted_at is null
      where p.codigo = (v_item->>'id') and p.deleted_at is null limit 1;
    continue when v_prod.id is null;
    v_precio := round(coalesce(v_prod.pvp, 0) * (1 - v_desc / 100), 2);
    v_margen := case when v_prod.costo > 0 and v_precio > 0 then round((v_precio - v_prod.costo) / v_precio * 1000) / 10 else null end;

    select id into v_existente from public.ofertas where campana_id = p_campana_id and producto_id = v_prod.id and deleted_at is null limit 1;
    if v_existente is not null then
      update public.ofertas set
        descuento_pct = v_desc, precio_oferta = v_precio, pvp_base = v_prod.pvp, costo = nullif(v_prod.costo, 0), margen_pct = v_margen,
        inicio = v_camp.inicio, fin = v_camp.fin, actualizado_por = v_emp,
        historial = historial || jsonb_build_array(jsonb_build_object('f', v_ahora, 'por', v_emp_nombre, 'n', 'Actualizada al aprobar la campaña ' || v_camp.nombre))
      where id = v_existente;
      v_actualizadas := v_actualizadas + 1;
    else
      insert into public.ofertas (
        id, codigo, producto_id, campana_id, tipo, descuento_pct, precio_oferta, pvp_base, costo, margen_pct, inicio, fin,
        stock_inicial, historial, creado_por, actualizado_por
      ) values (
        gen_random_uuid(), 'OF-' || to_char(v_ahora, 'YYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 4)),
        v_prod.id, p_campana_id, 'Campaña', v_desc, v_precio, v_prod.pvp, nullif(v_prod.costo, 0), v_margen, v_camp.inicio, v_camp.fin,
        (select stock from public.productos where id = v_prod.id),
        jsonb_build_array(jsonb_build_object('f', v_ahora, 'por', v_emp_nombre, 'n', 'Creada desde la campaña ' || v_camp.nombre)),
        v_emp, v_emp
      );
      v_creadas := v_creadas + 1;
    end if;
  end loop;

  update public.promo_campanas set
    estado = 'Aprobada', comentario = p_comentario, aprobado_por = v_emp, fecha_aprobacion = v_ahora,
    historial = coalesce(historial, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('fecha', v_ahora, 'por', v_emp_nombre, 'accion', 'Aprobada', 'comentario', p_comentario))
  where id = p_campana_id;

  return jsonb_build_object('success', true, 'creadas', v_creadas, 'actualizadas', v_actualizadas);
end;
$$;
