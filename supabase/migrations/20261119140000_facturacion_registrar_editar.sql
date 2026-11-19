-- =====================================================================
-- Facturación › Registrar y editar la factura de una venta en un solo paso (servidor).
--   · Antes la pantalla leía el historial, lo armaba y guardaba aparte (dos viajes); si la vista no se refrescaba,
--     se volvía a registrar la misma factura (en QA hubo 5 ventas con «Factura registrada» dos veces).
--   · Ahora fact_registrar_factura:
--       - Venta pendiente → la marca «Facturado» con número, PDF y fecha de Ecuador (el descargo de inventario sigue
--         saliendo del trigger tg_factura_descargo, una sola vez).
--       - Venta ya facturada → edita el número y/o el PDF (no vuelve a descargar nada) y lo deja en el historial
--         («Nº 16232 → 16233»); las salidas de inventario de esa venta muestran el número y el PDF nuevos.
--       - Mismos datos → no hace nada (no duplica el historial).
--       - Número repetido en otra venta de la misma empresa (16232 = 001-002-000016232) → avisa y pide confirmar.
-- =====================================================================

create or replace function public.fact_registrar_factura(p_id uuid, p_numero text, p_pdf_url text default null, p_confirmar_repetido boolean default false)
returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare
  f public.facturas; yo uuid := app.empleado_id(); v_nombre text;
  v_num text := btrim(coalesce(p_numero, '')); v_url text := nullif(btrim(coalesce(p_pdf_url, '')), '');
  v_cola text; v_rep_cod text; v_rep_cli text; v_rep_num text; v_det text; v_hist jsonb;
begin
  if not app.puede('facturacion', 'editar') then raise exception 'No tienes permiso para registrar facturas.'; end if;
  if v_num = '' then raise exception 'Ingresa el número de factura.'; end if;
  if v_num !~ '^[0-9][0-9-]*$' or length(v_num) > 30 then raise exception 'El número de factura lleva solo dígitos y guiones (ej. 16232 o 001-002-000016232).'; end if;
  if v_url is not null and v_url !~* '^https?://' then raise exception 'El enlace del PDF debe empezar con https://'; end if;

  select * into f from public.facturas where id = p_id and deleted_at is null for update;
  if not found then raise exception 'Venta no encontrada.'; end if;
  if f.estado not in ('Pendiente', 'Facturado') then raise exception 'Esta venta está «%»: no se puede registrar la factura.', f.estado; end if;
  if f.estado = 'Pendiente' and f.datos_completos is false then raise exception 'Faltan datos de pago/entrega: regularízalos desde el CRM.'; end if;

  -- ¿El mismo número ya está en otra venta? (se compara la parte final: 16232 = 001-002-000016232)
  v_cola := ltrim(regexp_replace(v_num, '^.*-', ''), '0');
  if not coalesce(p_confirmar_repetido, false) then
    select x.codigo, coalesce(c.nombre, q.nombre, ''), x.numero_contifico into v_rep_cod, v_rep_cli, v_rep_num
      from public.facturas x
      left join public.clientes c on c.id = x.cliente_id
      left join public.cotizaciones q on q.id = x.cotizacion_id
     where x.id <> p_id and x.deleted_at is null and x.empresa is not distinct from f.empresa
       and coalesce(btrim(x.numero_contifico), '') <> ''
       and ltrim(regexp_replace(btrim(x.numero_contifico), '^.*-', ''), '0') = v_cola
     order by x.created_at desc limit 1;
    if v_rep_cod is not null then
      return jsonb_build_object('ok', false, 'repetido', jsonb_build_object('codigo', v_rep_cod, 'cliente', v_rep_cli, 'numero', v_rep_num));
    end if;
  end if;

  select nombre into v_nombre from public.empleados where id = yo;
  v_hist := case when jsonb_typeof(f.historial) = 'array' then f.historial else '[]'::jsonb end;

  if f.estado = 'Pendiente' then
    update public.facturas
       set estado = 'Facturado', numero_contifico = v_num, pdf_url = v_url,
           fecha_facturacion = (now() at time zone 'America/Guayaquil')::date, facturado_por = yo,
           historial = v_hist || jsonb_build_array(jsonb_build_object('fecha', now(), 'por', coalesce(v_nombre, ''), 'accion', 'Factura registrada',
                                                                     'detalle', 'Nº ' || v_num || case when v_url is null then ' · sin PDF' else '' end))
     where id = p_id;
    return jsonb_build_object('ok', true, 'accion', 'registrada', 'numero', v_num, 'pdf_url', v_url);
  end if;

  -- Ya facturada: editar número y/o PDF (no se vuelve a descargar el inventario)
  if f.numero_contifico is not distinct from v_num and f.pdf_url is not distinct from v_url then
    return jsonb_build_object('ok', true, 'accion', 'sin_cambios', 'numero', v_num, 'pdf_url', v_url);
  end if;
  v_det := concat_ws(' · ',
    case when f.numero_contifico is distinct from v_num then 'Nº ' || coalesce(nullif(f.numero_contifico, ''), '—') || ' → ' || v_num end,
    case when f.pdf_url is distinct from v_url then case when v_url is null then 'quitó el PDF' when f.pdf_url is null then 'agregó el PDF' else 'cambió el PDF' end end);
  update public.facturas
     set numero_contifico = v_num, pdf_url = v_url,
         historial = v_hist || jsonb_build_array(jsonb_build_object('fecha', now(), 'por', coalesce(v_nombre, ''), 'accion', 'Factura editada', 'detalle', v_det))
   where id = p_id;
  -- Las salidas de inventario de esta venta muestran el número y el PDF nuevos (solo texto: no cambia el stock)
  update public.movimientos_inventario set factura_texto = v_num, factura_url = v_url
   where factura_id = p_id and deleted_at is null and tipo = 'SALIDA';
  return jsonb_build_object('ok', true, 'accion', 'editada', 'numero', v_num, 'pdf_url', v_url, 'detalle', v_det);
end;
$$;
revoke all on function public.fact_registrar_factura(uuid, text, text, boolean) from public, anon;
grant execute on function public.fact_registrar_factura(uuid, text, text, boolean) to authenticated;

notify pgrst, 'reload schema';
