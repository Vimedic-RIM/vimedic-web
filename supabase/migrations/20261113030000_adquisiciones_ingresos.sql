-- =====================================================================
-- Adquisiciones (IngresosProveedores.gs): registrar una compra local a
-- proveedor que sube el stock. El menú ya existía marcado "listo: false"
-- en modulos.ts — nunca se construyó la pantalla.
--
-- Corre con privilegios propios porque ingresos_proveedor/movimientos_inventario
-- solo son editables por "facturacion" (según su RLS ya existente) y
-- productos.stock solo por "inventario", pero quien usa Adquisiciones
-- normalmente solo tiene el permiso del módulo "importaciones".
-- =====================================================================
create or replace function app.registrar_ingreso_proveedor(
  p_proveedor_texto text, p_numero_factura text, p_fecha_factura date, p_observacion text, p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp uuid := app.empleado_id();
  v_emp_nombre text := (select nombre from public.empleados where id = app.empleado_id());
  v_id uuid := gen_random_uuid();
  v_codigo text := 'ING-' || to_char(now(), 'YYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 4));
  v_item jsonb;
  v_prod record;
  v_cantidad numeric;
  v_precio numeric;
  v_subtotal numeric := 0;
  v_errores text[] := '{}';
begin
  if not app.puede_alguno(array['facturacion', 'importaciones'], 'crear') then
    raise exception 'No autorizado para registrar ingresos de proveedor.';
  end if;
  if p_proveedor_texto is null or trim(p_proveedor_texto) = '' then raise exception 'Falta el proveedor.'; end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then raise exception 'Agrega al menos un producto.'; end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select p.id, p.codigo, p.nombre into v_prod from public.productos p where p.codigo = (v_item->>'codigo') and p.deleted_at is null;
    if v_prod.id is null then v_errores := array_append(v_errores, (v_item->>'codigo') || ': producto no encontrado.'); continue; end if;
    v_cantidad := coalesce((v_item->>'cantidad')::numeric, 0);
    if v_cantidad <= 0 then v_errores := array_append(v_errores, v_prod.codigo || ': la cantidad debe ser mayor a cero.'); end if;
  end loop;
  if array_length(v_errores, 1) > 0 then raise exception '%', array_to_string(v_errores, E'\n'); end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select p.id, p.codigo, p.nombre into v_prod from public.productos p where p.codigo = (v_item->>'codigo') and p.deleted_at is null;
    v_cantidad := coalesce((v_item->>'cantidad')::numeric, 0);
    v_precio := coalesce((v_item->>'precio')::numeric, 0);
    v_subtotal := v_subtotal + v_cantidad * v_precio;

    insert into public.movimientos_inventario (
      id, codigo, tipo, operacion_codigo, ingreso_id, producto_id, producto_codigo, nombre,
      cantidad, precio, aplica_iva, responsable_id, responsable_texto, fecha, observacion, creado_por, actualizado_por
    ) values (
      gen_random_uuid(), 'MOV-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)), 'INGRESO', v_codigo, v_id,
      v_prod.id, v_prod.codigo, v_prod.nombre, abs(v_cantidad), v_precio, coalesce((v_item->>'aplicaIva')::boolean, true),
      v_emp, v_emp_nombre, now(), nullif(v_item->>'observacion', ''), v_emp, v_emp
    );
    update public.productos set stock = stock + v_cantidad where id = v_prod.id;
  end loop;

  insert into public.ingresos_proveedor (
    id, codigo, proveedor_texto, numero_factura, fecha_factura, responsable_id, observacion, items, subtotal, total, creado_por, actualizado_por
  ) values (
    v_id, v_codigo, trim(p_proveedor_texto), nullif(trim(coalesce(p_numero_factura, '')), ''), p_fecha_factura, v_emp,
    nullif(trim(coalesce(p_observacion, '')), ''), p_items, round(v_subtotal, 2), round(v_subtotal, 2), v_emp, v_emp
  );

  return jsonb_build_object('success', true, 'id', v_id, 'codigo', v_codigo);
end;
$$;
revoke all on function app.registrar_ingreso_proveedor(text, text, date, text, jsonb) from public, anon;
grant execute on function app.registrar_ingreso_proveedor(text, text, date, text, jsonb) to authenticated;
