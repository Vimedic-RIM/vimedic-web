-- =====================================================================
-- Funciones que el frontend llama con supabase.rpc() y solo existían en el esquema "app" (Issue #42, urgente)
-- El servicio de la API solo expone "public" y "graphql_public": una función que vive solo en "app" no se puede llamar
-- desde el navegador (PGRST202 "Could not find the function public.xxx in the schema cache").
-- Efecto: generar una venta en el CRM terminaba en "No se pudo enviar a Facturación" y la venta quedaba "Ganado" sin
-- factura; la bitácora de Facturación (guía de despacho y acta) y el ingreso de proveedores (Adquisiciones) fallaban igual.
-- Arreglo: una versión en "public" con la misma firma. Solo la ejecuta "authenticated"; la lógica y la revisión de
-- permisos siguen en las funciones de "app" (security definer), así que no se abre nada nuevo.
-- =====================================================================

-- 1) CRM → Facturación
create or replace function public.enviar_venta_a_facturacion(
  p_codigo text, p_empresa text, p_cotizacion_id uuid,
  p_cliente_id uuid default null, p_identificacion text default null, p_asesor_id uuid default null,
  p_medio text default null, p_observacion text default null,
  p_items jsonb default '[]'::jsonb, p_pago_entrega jsonb default '{}'::jsonb,
  p_subtotal numeric default 0, p_iva numeric default 0, p_total numeric default 0
) returns jsonb language sql set search_path = public as $$
  select app.enviar_venta_a_facturacion(p_codigo, p_empresa, p_cotizacion_id, p_cliente_id, p_identificacion, p_asesor_id,
                                        p_medio, p_observacion, p_items, p_pago_entrega, p_subtotal, p_iva, p_total)
$$;
revoke all on function public.enviar_venta_a_facturacion(text, text, uuid, uuid, text, uuid, text, text, jsonb, jsonb, numeric, numeric, numeric) from public, anon;
grant execute on function public.enviar_venta_a_facturacion(text, text, uuid, uuid, text, uuid, text, text, jsonb, jsonb, numeric, numeric, numeric) to authenticated;

-- 2) Bitácora de Facturación (guía de despacho, acta de conformidad)
create or replace function public.registrar_bitacora(
  p_modulo text, p_accion text, p_comentario text default null, p_factura uuid default null, p_despacho uuid default null,
  p_entrega uuid default null, p_cotizacion uuid default null, p_campo text default null,
  p_valor_anterior text default null, p_valor_nuevo text default null
) returns uuid language sql set search_path = public as $$
  select app.registrar_bitacora(p_modulo, p_accion, p_comentario, p_factura, p_despacho, p_entrega, p_cotizacion, p_campo, p_valor_anterior, p_valor_nuevo)
$$;
revoke all on function public.registrar_bitacora(text, text, text, uuid, uuid, uuid, uuid, text, text, text) from public, anon;
grant execute on function public.registrar_bitacora(text, text, text, uuid, uuid, uuid, uuid, text, text, text) to authenticated;

-- 3) Ingreso de proveedores (Adquisiciones)
create or replace function public.registrar_ingreso_proveedor(
  p_proveedor_texto text, p_numero_factura text, p_fecha_factura date, p_observacion text, p_items jsonb
) returns jsonb language sql set search_path = public as $$
  select app.registrar_ingreso_proveedor(p_proveedor_texto, p_numero_factura, p_fecha_factura, p_observacion, p_items)
$$;
revoke all on function public.registrar_ingreso_proveedor(text, text, date, text, jsonb) from public, anon;
grant execute on function public.registrar_ingreso_proveedor(text, text, date, text, jsonb) to authenticated;

notify pgrst, 'reload schema';
