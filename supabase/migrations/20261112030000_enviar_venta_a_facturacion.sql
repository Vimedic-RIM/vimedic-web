-- =====================================================================
-- "Enviar a Facturación" desde el CRM: en la app original esto lo hacía
-- el servidor de Apps Script (crearRegistroFacturacion_), con privilegios
-- propios, nunca con el acceso del asesor. Aquí el insert/update directo
-- en "facturas" desde el frontend quedaba bloqueado por su RLS (solo
-- permiso del módulo "facturacion" puede escribir ahí — ver
-- 20261108000900_seguridad_rls.sql), así que las ventas creadas por un
-- asesor de CRM se marcaban "Ganado" pero nunca llegaban a Facturación.
-- Esta función corre con security definer (como app.registrar_bitacora)
-- para que cualquiera que puede crear/editar en CRM pueda enviar su venta
-- a la cola de Facturación, sin necesitar el permiso de ese otro módulo.
-- =====================================================================
create or replace function app.enviar_venta_a_facturacion(
  p_codigo text, p_empresa text, p_cotizacion_id uuid,
  p_cliente_id uuid default null, p_identificacion text default null, p_asesor_id uuid default null,
  p_medio text default null, p_observacion text default null,
  p_items jsonb default '[]'::jsonb, p_pago_entrega jsonb default '{}'::jsonb,
  p_subtotal numeric default 0, p_iva numeric default 0, p_total numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_estado text;
  v_numero text;
begin
  if not (app.puede_alguno(array['crm','femedics'], 'crear') or app.puede_alguno(array['crm','femedics'], 'editar')) then
    raise exception 'No autorizado para enviar ventas a Facturación.';
  end if;

  select id, estado, numero_contifico into v_id, v_estado, v_numero
    from public.facturas where codigo = p_codigo and deleted_at is null limit 1;

  if v_id is not null and v_estado = 'Facturado' then
    return jsonb_build_object('success', false, 'ya_facturado', true, 'numero_contifico', v_numero);
  end if;

  if v_id is not null then
    update public.facturas set
      empresa = p_empresa, cliente_id = p_cliente_id, identificacion = p_identificacion, cotizacion_id = p_cotizacion_id,
      asesor_id = p_asesor_id, estado = 'Pendiente', fecha_ganado = current_date, medio_captacion_venta = p_medio,
      observacion = p_observacion, datos_completos = true, items = p_items, pago_entrega = p_pago_entrega,
      subtotal = p_subtotal, iva = p_iva, total = p_total, total_neto = p_total
    where id = v_id;
  else
    insert into public.facturas (
      id, codigo, empresa, cliente_id, identificacion, cotizacion_id, asesor_id, estado, fecha_ganado,
      medio_captacion_venta, observacion, datos_completos, items, pago_entrega, subtotal, iva, total, total_neto
    ) values (
      gen_random_uuid(), p_codigo, p_empresa, p_cliente_id, p_identificacion, p_cotizacion_id, p_asesor_id, 'Pendiente', current_date,
      p_medio, p_observacion, true, p_items, p_pago_entrega, p_subtotal, p_iva, p_total, p_total
    );
  end if;

  return jsonb_build_object('success', true);
end;
$$;
revoke all on function app.enviar_venta_a_facturacion(text, text, uuid, uuid, text, uuid, text, text, jsonb, jsonb, numeric, numeric, numeric) from public, anon;
grant execute on function app.enviar_venta_a_facturacion(text, text, uuid, uuid, text, uuid, text, text, jsonb, jsonb, numeric, numeric, numeric) to authenticated;

-- Rellena ahora mismo las ventas de hoy que se quedaron en "Ganado" sin llegar a Facturación.
do $$
declare r record;
begin
  for r in
    select c.codigo, c.empresa, c.id as cotizacion_id, c.cliente_id, c.identificacion, c.asesor_id,
           coalesce(c.medio_captacion_venta, c.medio_captacion_lead) as medio, c.nota_venta, c.items,
           coalesce(c.total, 0) as total
    from public.cotizaciones c
    where c.estado_crm = 'Ganado' and c.deleted_at is null
      and not exists (select 1 from public.facturas f where f.codigo = c.codigo and f.deleted_at is null)
  loop
    insert into public.facturas (
      id, codigo, empresa, cliente_id, identificacion, cotizacion_id, asesor_id, estado, fecha_ganado,
      medio_captacion_venta, observacion, datos_completos, items, subtotal, iva, total, total_neto
    ) values (
      gen_random_uuid(), r.codigo, r.empresa, r.cliente_id, r.identificacion, r.cotizacion_id, r.asesor_id, 'Pendiente', current_date,
      r.medio, r.nota_venta, true, coalesce(r.items, '[]'::jsonb), 0, 0, r.total, r.total
    );
  end loop;
end $$;
